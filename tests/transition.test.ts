import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  createLauncherCatalog,
  FakeAdapter,
  fakeCapabilities,
  PRODUCTION_FAKE_RESULT,
  type FakeProducerHook,
  type FakeResultSource,
} from "../src/adapters/fake.ts";
import { AdapterFailureError, AdapterTimeoutError } from "../src/adapters/adapter.ts";
import { CURSOR_EXECUTABLE, CURSOR_LAUNCHER_ID, CursorAdapter } from "../src/adapters/cursor.ts";
import {
  createNodeProcessRunner,
  SANDBOX_EXEC_EXECUTABLE,
  type ProcessRunner,
  type SpawnRequest,
} from "../src/adapters/process.ts";
import { ProducerWriteScopeError } from "../src/adapters/producer-write-scope.ts";
import { createMemoryRegistrySource } from "../src/composition.ts";
import {
  BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS,
  SCHEMA_VERSION,
  terminalForVerdict,
  VERDICT_TO_TERMINAL,
  type AdapterFailureRecord,
  type AdapterProducerInput,
  type ProducerDiagnostic,
  type ProducerSnapshotSite,
  type TransitionEventDocument,
} from "../src/core/contracts.ts";
import type { AppDeps, Clock } from "../src/core/review.ts";
import { runReview } from "../src/core/review.ts";
import { SNAPSHOT_ENTRY_CAP, snapshotTree } from "../src/core/snapshot.ts";
import { advanceFromCheckpoint, continueAfterPlanReview, resolveAdvanceChainFromEvents, runReviewThenSuccessor } from "../src/core/transition.ts";
import { composeTerminalCloseOut } from "../src/core/task-write.ts";
import { sha256Bytes } from "../src/core/serialize.ts";
import { acquireWriterLock, WRITER_LOCK_NAME } from "../src/runtime/lock.ts";

const execFileAsync = promisify(execFile);
import {
  AUTOMATIC_BRIDGE_CONFIG,
  DEFAULT_REVIEW_SECTION,
  MANUAL_BRIDGE_CONFIG,
  blockedResult,
  changesResult,
  declareImplementationReady,
  makeRepo,
  passResult,
  readyImplementationTask,
  testClock,
  testDeps,
  VALID_REGISTRY,
  validAgentsMd,
  validTaskMd,
  writeBridgeConfig,
} from "./helpers.ts";

const PLAN_ID = "run-11111111-1111-4111-8111-111111111111";

async function plantChainedImplementationParent(
  root: string,
  taskRel: string,
  runId: string,
  taskHashBeforeCorrection: string,
): Promise<{ agentsHash: string }> {
  const agentsHash = sha256Bytes(new Uint8Array(await fs.readFile(path.join(root, "AGENTS.md"))));
  const status = {
    schema_version: SCHEMA_VERSION,
    run_id: runId,
    state: "changes_requested",
    review_kind: "implementation",
    task_path: taskRel,
    host: "cursor",
    client_context: "personal",
    model: "Composer-2.5",
    effort: "none",
    model_observed: "declared_unobserved",
    policy_digest: "sha256:dead",
    artifact_hashes: { task: taskHashBeforeCorrection, agents: agentsHash },
    execution_id: "exec-parent",
    verdict: "changes_requested",
    reason_code: "review_changes_requested",
    task_write_state: "written",
    task_hash_after_write: taskHashBeforeCorrection,
    task_hash: taskHashBeforeCorrection,
    reviewer_write: null,
    adapter_failure: null,
    producer_identity: { role: "implementer", host: "cursor" },
    review_chain: { after_run_id: null, cycle: 1, max_cycles: 3, refused: null },
    transition_id: null,
    created_at: "2026-08-31T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:01.000Z",
  };
  const runDir = path.join(root, ".spartan-bridge", "runs", runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "status.json"), `${JSON.stringify(status)}\n`, "utf8");
  return { agentsHash };
}

function autoAgents(): string {
  return validAgentsMd({
    automaticImplementation: true,
    taskWrite: true,
    producerChain: true,
  });
}

function planTask(): string {
  return validTaskMd({ reviewSection: `\n${DEFAULT_REVIEW_SECTION}` });
}

async function autoRepo(): Promise<{ root: string; taskRel: string }> {
  return makeRepo({ agents: autoAgents(), task: planTask() });
}

// Same registry entries as VALID_REGISTRY, except `personal.cursor` resolves
// to the real Cursor launcher instead of the fake one, so an implementer
// binding on Cursor/personal reaches a real `CursorAdapter` while every
// reviewer binding (kept on Codex/personal below) stays on the fake.
function cursorProducerRegistry(): string {
  return VALID_REGISTRY.replace(
    "    cursor:\n      launcher: fake-reviewer-v1",
    `    cursor:\n      launcher: ${CURSOR_LAUNCHER_ID}`,
  );
}

// Reviewer bindings stay on Codex/personal (fake); only the implementer row
// keeps its default Cursor/personal binding, so `cursorProducerRegistry()`
// routes just the producer round to the real adapter. The write scope is
// narrowed to directory scopes that already exist or are guard-created, so
// the real guard's `requireExistingExactFileLeaves` pre-pass (which needs
// README.md/package.json/etc. to already exist) is not exercised here; that
// behavior is already covered by the adapter-level tests in
// tests/cursor-adapter.test.ts.
function autoAgentsWithCursorProducer(): string {
  return validAgentsMd({
    host: "Codex",
    automaticImplementation: true,
    taskWrite: true,
    producerChain: true,
    automaticWriteScope: ["src/", "tests/", "docs/", "spartan/"],
  });
}

function cursorProducerCatalog(makeCursorAdapter: () => CursorAdapter, source: FakeResultSource) {
  return createLauncherCatalog(
    () => new FakeAdapter(source),
    new Map([[CURSOR_LAUNCHER_ID, makeCursorAdapter]]),
  );
}

function cursorHelpProbe(): ReturnType<ProcessRunner["start"]> {
  return {
    wait: async () => ({
      exitCode: 0,
      stdout: Buffer.from("--print --output-format --mode --sandbox --workspace --trust\n"),
      stderr: Buffer.alloc(0),
      timedOut: false,
      stdoutOverflow: false,
    }),
    cancel: async () => undefined,
  };
}

// Real `cursor-agent` `--help`/`sandbox-exec` probes are faked or delegated
// to the real binary, but the actual producer spawn is substituted with a
// real Node child running `script`, confined by the adapter's own real
// Darwin sandbox profile exactly as the genuine producer path is.
function cursorProducerRunner(script: string, recorded: SpawnRequest[]): ProcessRunner {
  const real = createNodeProcessRunner();
  return {
    start(request) {
      recorded.push(request);
      if (request.executable === CURSOR_EXECUTABLE && request.args[0] === "--help") {
        return cursorHelpProbe();
      }
      if (request.executable === SANDBOX_EXEC_EXECUTABLE) {
        return real.start(request);
      }
      return real.start({ ...request, executable: process.execPath, args: ["-e", script] });
    },
  };
}

function chainClock(): Clock {
  let seconds = 0;
  let runs = 0;
  let exec = 0;
  let transitions = 0;
  return {
    now: () => new Date(Date.UTC(2026, 7, 16, 12, 0, seconds++)),
    createRunId: () => {
      runs += 1;
      const d = String(runs);
      return `run-${d.repeat(8).slice(0, 8)}-${d.repeat(4).slice(0, 4)}-4${d.repeat(3).slice(0, 3)}-8${d.repeat(3).slice(0, 3)}-${d.repeat(12).slice(0, 12)}`;
    },
    createExecutionId: () => {
      exec += 1;
      return `exec-22222222-2222-4222-8222-22222222222${exec}`;
    },
    createTransitionId: () => {
      transitions += 1;
      return `transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${transitions}`;
    },
  };
}

function mutatingProducer(source: { result: () => ReturnType<typeof passResult> }, extra?: (root: string, taskRel: string, liveRoot: string) => Promise<void>) {
  return new FakeAdapter(source, fakeCapabilities(), null, {
    mutate: async (input) => {
      await declareImplementationReady(input.workspace_root, input.task_path);
      if (extra) {
        await extra(input.workspace_root, input.task_path, input.repo_root);
      }
    },
  });
}

class RecordingDelayedProducer extends FakeAdapter {
  recordedTimeoutMs: number | undefined;

  constructor(source: FakeResultSource, private readonly delayMs: number) {
    super(source, fakeCapabilities(), null, {
      mutate: async (input) => {
        await new Promise<void>((resolve) => setTimeout(resolve, this.delayMs));
        await declareImplementationReady(input.workspace_root, input.task_path);
      },
    });
  }

  override async startProducer(input: AdapterProducerInput): Promise<void> {
    this.recordedTimeoutMs = input.producer_timeout_ms;
    return super.startProducer(input);
  }
}

test("absent or manual config leaves the plan-pass tuple unchanged and writes no transition", async () => {
  for (const config of [undefined, MANUAL_BRIDGE_CONFIG]) {
    const { root, taskRel } = await autoRepo();
    if (config !== undefined) {
      await writeBridgeConfig(root, config);
    }
    const outcome = await runReviewThenSuccessor(
      { repo: root, task: taskRel },
      testDeps({ clock: testClock(PLAN_ID) }),
    );
    assert.equal(outcome.kind, "review");
    assert.equal(outcome.status?.reason_code, "review_passed");
    assert.equal(outcome.status?.state, "awaiting_implementer");
    assert.equal(outcome.status?.verdict, "pass");
    assert.deepEqual(terminalForVerdict("pass", "plan"), VERDICT_TO_TERMINAL.pass);
    assert.equal(outcome.transition, null);
    assert.equal(await fs.access(path.join(root, ".spartan-bridge", "transitions")).then(() => true, () => false), false);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("malformed automatic config stops after plan pass with a separate transition record", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root, "schema_version: 9\n");
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({ clock: testClock(PLAN_ID) }),
  );
  assert.equal(outcome.kind, "transition");
  assert.equal(outcome.transition?.reason_code, "config_invalid");
  assert.equal(outcome.transition?.state, "stopped");
  assert.equal(outcome.status, null);
  const plan = JSON.parse(
    await fs.readFile(path.join(root, ".spartan-bridge", "runs", PLAN_ID, "status.json"), "utf8"),
  ) as { reason_code: string; verdict: string };
  assert.equal(plan.reason_code, "review_passed");
  assert.equal(plan.verdict, "pass");
  await fs.rm(root, { recursive: true, force: true });
});

test("declared scratch contradictions stop before registry, launcher, or producer work", async () => {
  for (const [declared, writeScope] of [
    ["src/", ["src/"]],
    ["src/generated/", ["src/"]],
    ["s/", ["s/deep/"]],
    ["cfg/", ["cfg/app.json"]],
    ["AGENTS.md/", ["src/"]],
    ["node_modules/", ["src/"]],
  ] as const) {
    const { root, taskRel } = await makeRepo({
      agents: validAgentsMd({
        automaticImplementation: true,
        taskWrite: true,
        producerChain: true,
        automaticWriteScope: writeScope,
        implementationScope: [...writeScope, "AGENTS.md", "spartan-bridge/config.yaml"],
      }),
      task: planTask(),
    });
    await writeBridgeConfig(root);
    const clock = testClock(PLAN_ID);
    const plan = await runReview(
      { repo: root, task: taskRel },
      testDeps({ clock, createAdapter: () => new FakeAdapter({ result: () => passResult("plan") }) }),
    );
    assert.equal(plan.status?.reason_code, "review_passed", declared);
    const raw = `${AUTOMATIC_BRIDGE_CONFIG}producer:\n  scratch_prefixes:\n    - ${declared}\n`;
    await writeBridgeConfig(root, raw);
    let registryLoads = 0;
    let launcherResolutions = 0;
    let producers = 0;
    const deps = testDeps({ clock });
    deps.registry = {
      load: async () => {
        registryLoads += 1;
        return VALID_REGISTRY;
      },
    };
    deps.catalog = {
      resolve: () => {
        launcherResolutions += 1;
        return new FakeAdapter({ result: () => passResult("plan") }, fakeCapabilities(), null, {
          mutate: async () => {
            producers += 1;
          },
        });
      },
    };
    const outcome = await continueAfterPlanReview(plan.status!, { repo: root, task: taskRel }, deps);
    assert.equal(outcome.kind, "transition", declared);
    assert.equal(outcome.transition?.state, "stopped", declared);
    assert.equal(outcome.transition?.reason_code, "config_invalid", declared);
    assert.equal(registryLoads, 0, declared);
    assert.equal(launcherResolutions, 0, declared);
    assert.equal(producers, 0, declared);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("automatic config without the repository grant stops as unauthorized", async () => {
  const { root, taskRel } = await makeRepo({
    agents: validAgentsMd({ taskWrite: true }),
    task: planTask(),
  });
  await writeBridgeConfig(root, AUTOMATIC_BRIDGE_CONFIG);
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({ clock: testClock(PLAN_ID) }),
  );
  assert.equal(outcome.kind, "transition");
  assert.equal(outcome.transition?.reason_code, "automatic_implementation_not_authorized");
  await fs.rm(root, { recursive: true, force: true });
});

test("authorized automatic config with unavailable producer capability keeps the plan tuple", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: testClock(PLAN_ID),
      createAdapter: () => new FakeAdapter({ result: () => passResult("plan") }, fakeCapabilities(), null, false),
    }),
  );
  assert.equal(outcome.kind, "review");
  assert.equal(outcome.status?.reason_code, "review_passed");
  assert.equal(outcome.transition, null);
  await fs.rm(root, { recursive: true, force: true });
});

test("a mismatched applicable plan policy digest stops as approved_artifact_stale before producer capability selection", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  const clock = testClock(PLAN_ID);
  const plan = await runReview(
    { repo: root, task: taskRel },
    testDeps({
      clock,
      createAdapter: () => new FakeAdapter({ result: () => passResult("plan") }),
    }),
  );
  assert.equal(plan.status?.verdict, "pass");
  assert.notEqual(plan.status?.policy_digest, null);
  const driftedRegistry = VALID_REGISTRY.replaceAll("fake-reviewer-v1", "other-reviewer-v1");
  const outcome = await continueAfterPlanReview(
    plan.status!,
    { repo: root, task: taskRel },
    testDeps({
      clock,
      registryYaml: driftedRegistry,
      createAdapter: () => new FakeAdapter({ result: () => passResult("plan") }, fakeCapabilities(), null, false),
    }),
  );
  assert.equal(outcome.kind, "transition");
  assert.equal(outcome.status, null);
  assert.equal(outcome.transition?.reason_code, "approved_artifact_stale");
  const persisted = JSON.parse(
    await fs.readFile(path.join(root, ".spartan-bridge", "runs", PLAN_ID, "status.json"), "utf8"),
  ) as { policy_digest: string; reason_code: string };
  assert.equal(persisted.policy_digest, plan.status?.policy_digest);
  assert.equal(persisted.reason_code, "review_passed");
  await fs.rm(root, { recursive: true, force: true });
});

function planTaskTargeting(paths: { decisions?: string; scope?: string; fencedExample?: string }): string {
  const decisions = paths.decisions ?? "- Edit `src/core/transition.ts` only.\n";
  const scope = paths.scope ?? "- `src/core/plan-target-scan.ts`\n";
  const fenced =
    paths.fencedExample === undefined
      ? ""
      : `\n\`\`\`text\n${paths.fencedExample}\n\`\`\`\n`;
  return `${validTaskMd({ reviewSection: `\n${DEFAULT_REVIEW_SECTION}` }).trimEnd()}

## Scope

${scope}

## Decisions

${decisions}${fenced}`;
}

test("a plan naming AGENTS.md in Decisions still spawns the implementer and records unwritable_plan_targets", async () => {
  const task = planTaskTargeting({ decisions: "- Edit `AGENTS.md` D5 scopes.\n" });
  const { root, taskRel } = await makeRepo({ agents: autoAgents(), task });
  await writeBridgeConfig(root);
  let producers = 0;
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: testClock(PLAN_ID),
      createAdapter: () =>
        new FakeAdapter({ result: () => passResult("plan") }, fakeCapabilities(), null, {
          mutate: async (input) => {
            producers += 1;
            await declareImplementationReady(input.workspace_root, input.task_path);
          },
        }),
    }),
  );
  assert.equal(producers, 1, outcome.transition?.reason_code ?? outcome.status?.reason_code ?? "");
  assert.notEqual(outcome.transition?.reason_code, "plan_targets_unwritable_path");
  assert.deepEqual(outcome.transition?.unwritable_plan_targets, ["AGENTS.md"]);
  const events = (
    await fs.readFile(
      path.join(root, ".spartan-bridge", "transitions", outcome.transition!.transition_id, "events.jsonl"),
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; unwritable_plan_targets?: string[] | null });
  const authorization = events.find((event) => event.type === "authorization");
  assert.deepEqual(authorization?.unwritable_plan_targets, ["AGENTS.md"]);
  assert.equal(events.some((event) => event.type === "producer_started"), true);
  assert.equal(events.some((event) => event.type === "plan_targets_flagged"), false);
  assert.equal(events.some((event) => event.type === "terminal_stop" && event.unwritable_plan_targets === null), false);
  await fs.rm(root, { recursive: true, force: true });
});

test("the repository root listing suppresses slash-bearing tokens whose leading segment is absent", async () => {
  const task = planTaskTargeting({ decisions: "- Edit `config/secret.env`.\n" });
  const { root, taskRel } = await makeRepo({ agents: autoAgents(), task });
  await writeBridgeConfig(root);
  const clock = testClock(PLAN_ID);
  let reviews = 0;
  const deps = testDeps({
    clock,
    createAdapter: () =>
      new FakeAdapter(
        {
          result: () => {
            reviews += 1;
            return reviews === 1 ? passResult("plan") : passResult("implementation");
          },
        },
        fakeCapabilities(),
        null,
        {
          mutate: async (input) => {
            await declareImplementationReady(input.workspace_root, input.task_path);
          },
        },
      ),
  });
  const plan = await runReview({ repo: root, task: taskRel }, deps);
  assert.equal(plan.status?.reason_code, "review_passed");

  const outcome = await continueAfterPlanReview(plan.status!, { repo: root, task: taskRel }, deps);
  assert.equal(outcome.transition?.unwritable_plan_targets, null);
  const events = (
    await fs.readFile(
      path.join(root, ".spartan-bridge", "transitions", outcome.transition!.transition_id, "events.jsonl"),
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; unwritable_plan_targets?: string[] | null });
  assert.equal(events.find((event) => event.type === "authorization")?.unwritable_plan_targets, null);
  await fs.rm(root, { recursive: true, force: true });
});

test("an unreadable root listing preserves slash-bearing advisories and reaches authorization", async (t) => {
  const task = planTaskTargeting({ decisions: "- Edit `config/secret.env`.\n" });
  const { root, taskRel } = await makeRepo({ agents: autoAgents(), task });
  await writeBridgeConfig(root);
  const clock = testClock(PLAN_ID);
  let reviews = 0;
  const deps = testDeps({
    clock,
    createAdapter: () =>
      new FakeAdapter(
        {
          result: () => {
            reviews += 1;
            return reviews === 1 ? passResult("plan") : passResult("implementation");
          },
        },
        fakeCapabilities(),
        null,
        {
          mutate: async (input) => {
            await declareImplementationReady(input.workspace_root, input.task_path);
          },
        },
      ),
  });
  const plan = await runReview({ repo: root, task: taskRel }, deps);
  assert.equal(plan.status?.reason_code, "review_passed");

  const repoRoot = await fs.realpath(root);
  const originalReaddir = fs.readdir.bind(fs);
  let injected = false;
  t.mock.method(fs, "readdir", async (...args) => {
    if (!injected && args[0] === repoRoot) {
      injected = true;
      throw Object.assign(new Error("injected unreadable root"), { code: "EACCES" });
    }
    return originalReaddir(...args);
  });

  const outcome = await continueAfterPlanReview(plan.status!, { repo: root, task: taskRel }, deps);
  assert.equal(injected, true);
  assert.notEqual(outcome.transition?.reason_code, "plan_targets_unwritable_path");
  assert.deepEqual(outcome.transition?.unwritable_plan_targets, ["config/secret.env"]);
  const events = (
    await fs.readFile(
      path.join(root, ".spartan-bridge", "transitions", outcome.transition!.transition_id, "events.jsonl"),
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; unwritable_plan_targets?: string[] | null });
  assert.deepEqual(events.find((event) => event.type === "authorization")?.unwritable_plan_targets, [
    "config/secret.env",
  ]);
  await fs.rm(root, { recursive: true, force: true });
});

test("ReasonCode keeps plan_targets_unwritable_path and continueAfterPlanReview does not emit it", async () => {
  const contracts = await fs.readFile(new URL("../src/core/contracts.ts", import.meta.url), "utf8");
  const transition = await fs.readFile(new URL("../src/core/transition.ts", import.meta.url), "utf8");
  assert.equal(SCHEMA_VERSION, 2);
  assert.match(contracts, /\| "plan_targets_unwritable_path"/);
  assert.doesNotMatch(contracts, /plan_targets_flagged/);
  assert.doesNotMatch(transition, /plan_targets_unwritable_path/);
});

test("a plan naming bare DESIGN_SYSTEM.md with docs/ in scope still spawns the implementer", async () => {
  const task = planTaskTargeting({
    scope: "- `docs/UI_PATTERNS.md` (and `DESIGN_SYSTEM.md` only if it still names the craft trio)\n",
    decisions: "- Keep the existing in-scope docs path.\n",
  });
  const { root, taskRel } = await makeRepo({ agents: autoAgents(), task });
  await writeBridgeConfig(root);
  let producers = 0;
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: testClock(PLAN_ID),
      createAdapter: () =>
        new FakeAdapter({ result: () => passResult("plan") }, fakeCapabilities(), null, {
          mutate: async (input) => {
            producers += 1;
            await declareImplementationReady(input.workspace_root, input.task_path);
          },
        }),
    }),
  );
  assert.equal(producers, 1, outcome.transition?.reason_code ?? outcome.status?.reason_code ?? "");
  assert.notEqual(outcome.transition?.reason_code, "plan_targets_unwritable_path");
  await fs.rm(root, { recursive: true, force: true });
});

test("a plan naming only in-scope paths still spawns the implementer", async () => {
  const task = planTaskTargeting({
    decisions: "- Add `src/core/plan-target-scan.ts` and wire `src/core/transition.ts`.\n",
    scope: "- `tests/transition.test.ts`\n",
  });
  const { root, taskRel } = await makeRepo({ agents: autoAgents(), task });
  await writeBridgeConfig(root);
  let producers = 0;
  const source = {
    result: () => passResult("plan"),
  };
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: testClock(PLAN_ID),
      createAdapter: () =>
        new FakeAdapter(source, fakeCapabilities(), null, {
          mutate: async (input) => {
            producers += 1;
            await declareImplementationReady(input.workspace_root, input.task_path);
          },
        }),
    }),
  );
  assert.equal(producers, 1);
  assert.notEqual(outcome.transition?.reason_code, "plan_targets_unwritable_path");
  await fs.rm(root, { recursive: true, force: true });
});

test("a backticked path inside a fenced Decisions block does not stop the auto-chain", async () => {
  const task = planTaskTargeting({
    decisions: "- Edit `src/core/transition.ts`.\n",
    fencedExample: "Example only: edit `AGENTS.md` here.",
  });
  const { root, taskRel } = await makeRepo({ agents: autoAgents(), task });
  await writeBridgeConfig(root);
  let producers = 0;
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: testClock(PLAN_ID),
      createAdapter: () =>
        new FakeAdapter({ result: () => passResult("plan") }, fakeCapabilities(), null, {
          mutate: async (input) => {
            producers += 1;
            await declareImplementationReady(input.workspace_root, input.task_path);
          },
        }),
    }),
  );
  assert.equal(producers, 1, outcome.transition?.reason_code ?? outcome.status?.reason_code ?? "");
  assert.notEqual(outcome.transition?.reason_code, "plan_targets_unwritable_path");
  await fs.rm(root, { recursive: true, force: true });
});

test("authorized automatic path runs the implementer then implementation review to pass", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  let reviews = 0;
  const source = {
    result: () => {
      reviews += 1;
      return reviews === 1 ? passResult("plan") : passResult("implementation");
    },
  };
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: chainClock(),
      createAdapter: () => mutatingProducer(source),
    }),
  );
  assert.equal(outcome.kind, "review", outcome.transition?.reason_code ?? outcome.status?.reason_code ?? "");
  assert.equal(outcome.status?.review_kind, "implementation");
  assert.equal(outcome.status?.state, "review_passed");
  assert.equal(outcome.status?.reason_code, "review_passed");
  assert.deepEqual(terminalForVerdict("pass", "implementation"), {
    state: "review_passed",
    reason_code: "review_passed",
  });
  assert.deepEqual(VERDICT_TO_TERMINAL.pass, {
    state: "awaiting_implementer",
    reason_code: "review_passed",
  });
  assert.equal(SCHEMA_VERSION, 2);
  assert.equal(typeof outcome.status?.transition_id, "string");
  assert.notEqual(outcome.status?.transition_id, null);
  assert.equal(outcome.transition?.state, "completed");
  const taskText = await fs.readFile(path.join(root, taskRel), "utf8");
  assert.match(taskText, /Auto-chain complete: implementation review passed/);
  assert.match(taskText, /phase: complete/);
  assert.match(taskText, /current_role: human-operator/);
  assert.match(taskText, /next_role: human-operator/);
  assert.doesNotMatch(taskText, /Re-review the implementation/);
  await fs.rm(root, { recursive: true, force: true });
});

test("application-sized support tree does not exhaust producer snapshot entries", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  const supportDir = path.join(root, "node_modules", "large-package");
  await fs.mkdir(supportDir, { recursive: true });
  const fileCount = SNAPSHOT_ENTRY_CAP + 1;
  for (let start = 0; start < fileCount; start += 250) {
    await Promise.all(
      Array.from({ length: Math.min(250, fileCount - start) }, (_, offset) =>
        fs.writeFile(path.join(supportDir, `file-${start + offset}.js`), "x"),
      ),
    );
  }
  let reviews = 0;
  const source = {
    result: () => {
      reviews += 1;
      return reviews === 1 ? passResult("plan") : passResult("implementation");
    },
  };
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({ clock: chainClock(), createAdapter: () => mutatingProducer(source) }),
  );
  assert.equal(outcome.kind, "review");
  assert.equal(outcome.status?.reason_code, "review_passed", JSON.stringify(outcome));
  assert.equal(outcome.transition?.state, "completed");
  await fs.rm(root, { recursive: true, force: true });
});

test("scratch-only producer output is discarded without stopping the chain", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await fs.writeFile(path.join(root, "node_modules", "pkg", "index.js"), "support\n");
  let reviews = 0;
  const source = {
    result: () => {
      reviews += 1;
      return reviews === 1 ? passResult("plan") : passResult("implementation");
    },
  };
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: chainClock(),
      createAdapter: () => mutatingProducer(source, async (workspace) => {
        await fs.mkdir(path.join(workspace, "dist"), { recursive: true });
        await fs.mkdir(path.join(workspace, "node_modules", ".cache"), { recursive: true });
        await fs.writeFile(path.join(workspace, "dist", "main.js"), "built\n");
        await fs.writeFile(path.join(workspace, "node_modules", ".cache", "build.bin"), "cache\n");
      }),
    }),
  );
  assert.equal(outcome.kind, "review");
  assert.equal(outcome.status?.reason_code, "review_passed");
  assert.equal(outcome.transition?.state, "completed");
  await assert.rejects(fs.access(path.join(root, "dist", "main.js")));
  await assert.rejects(fs.access(path.join(root, "node_modules", ".cache", "build.bin")));
  await fs.rm(root, { recursive: true, force: true });
});

test("declared support-root scratch is discarded through the complete producer chain", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(
    root,
    `${AUTOMATIC_BRIDGE_CONFIG}producer:\n  scratch_prefixes:\n    - node_modules/.vite/\n`,
  );
  await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await fs.writeFile(path.join(root, "node_modules", "pkg", "index.js"), "support\n");
  let reviews = 0;
  const source = {
    result: () => {
      reviews += 1;
      return reviews === 1 ? passResult("plan") : passResult("implementation");
    },
  };
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: chainClock(),
      createAdapter: () => mutatingProducer(source, async (workspace) => {
        await fs.mkdir(path.join(workspace, "node_modules", ".vite"), { recursive: true });
        await fs.writeFile(path.join(workspace, "node_modules", ".vite", "build.bin"), "cache\n");
      }),
    }),
  );
  assert.equal(outcome.kind, "review");
  assert.equal(outcome.status?.reason_code, "review_passed");
  assert.equal(outcome.transition?.state, "completed");
  await assert.rejects(fs.access(path.join(root, "node_modules", ".vite", "build.bin")));
  await fs.rm(root, { recursive: true, force: true });
});

test("declared build scratch is discarded while the former dist default is refused", async () => {
  for (const [writtenPrefix, expectedReason] of [
    ["build", "review_passed"],
    ["dist", "write_scope_violation"],
  ] as const) {
    const { root, taskRel } = await autoRepo();
    await writeBridgeConfig(
      root,
      `${AUTOMATIC_BRIDGE_CONFIG}producer:\n  scratch_prefixes:\n    - build/\n`,
    );
    let reviews = 0;
    const source = {
      result: () => {
        reviews += 1;
        return reviews === 1 ? passResult("plan") : passResult("implementation");
      },
    };
    const outcome = await runReviewThenSuccessor(
      { repo: root, task: taskRel },
      testDeps({
        clock: chainClock(),
        createAdapter: () => mutatingProducer(source, async (workspace) => {
          await fs.mkdir(path.join(workspace, writtenPrefix), { recursive: true });
          await fs.writeFile(path.join(workspace, writtenPrefix, "main.js"), "built\n");
        }),
      }),
    );
    assert.equal(outcome.status?.reason_code ?? outcome.transition?.reason_code, expectedReason, writtenPrefix);
    await assert.rejects(fs.access(path.join(root, writtenPrefix, "main.js")));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("an inherited dist default overlapping write scope is dropped and merged as product", async () => {
  const writeScope = ["spartan/", "dist/"];
  const { root, taskRel } = await makeRepo({
    agents: validAgentsMd({
      automaticImplementation: true,
      taskWrite: true,
      producerChain: true,
      automaticWriteScope: writeScope,
      implementationScope: [...writeScope, "AGENTS.md", "spartan-bridge/config.yaml"],
    }),
    task: planTask(),
  });
  await writeBridgeConfig(root);
  let reviews = 0;
  const source = {
    result: () => {
      reviews += 1;
      return reviews === 1 ? passResult("plan") : passResult("implementation");
    },
  };
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: chainClock(),
      createAdapter: () => mutatingProducer(source, async (workspace) => {
        await fs.mkdir(path.join(workspace, "dist"), { recursive: true });
        await fs.writeFile(path.join(workspace, "dist", "main.js"), "product\n");
      }),
    }),
  );
  assert.equal(outcome.status?.reason_code, "review_passed", JSON.stringify(outcome));
  assert.equal(await fs.readFile(path.join(root, "dist", "main.js"), "utf8"), "product\n");
  await fs.rm(root, { recursive: true, force: true });
});

test("an out-of-scope producer write is a write_scope_violation", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  const source = { result: () => passResult("plan") };
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: testClock(PLAN_ID),
      createAdapter: () =>
        mutatingProducer(source, async (repo) => {
          await fs.writeFile(path.join(repo, "secret.txt"), "no\n", "utf8");
        }),
    }),
  );
  assert.equal(outcome.kind, "transition");
  assert.equal(outcome.transition?.reason_code, "write_scope_violation");
  await fs.rm(root, { recursive: true, force: true });
});

test("an implementer that writes AGENTS.md after an advisory scan still stops write_scope_violation", async () => {
  const task = planTaskTargeting({ decisions: "- Mention `AGENTS.md` in prose.\n" });
  const { root, taskRel } = await makeRepo({ agents: autoAgents(), task });
  await writeBridgeConfig(root);
  const source = { result: () => passResult("plan") };
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: testClock(PLAN_ID),
      createAdapter: () =>
        mutatingProducer(source, async (repo) => {
          const replacement = path.join(repo, "AGENTS.md.replacement");
          await fs.writeFile(replacement, "pwned\n", { encoding: "utf8", mode: 0o444 });
          await fs.rename(replacement, path.join(repo, "AGENTS.md"));
        }),
    }),
  );
  assert.equal(outcome.kind, "transition");
  assert.equal(outcome.transition?.reason_code, "write_scope_violation");
  assert.deepEqual(outcome.transition?.unwritable_plan_targets, ["AGENTS.md"]);
  const events = (
    await fs.readFile(
      path.join(root, ".spartan-bridge", "transitions", outcome.transition!.transition_id, "events.jsonl"),
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; unwritable_plan_targets?: string[] | null });
  assert.deepEqual(events.find((event) => event.type === "authorization")?.unwritable_plan_targets, ["AGENTS.md"]);
  assert.deepEqual(events.at(-1)?.unwritable_plan_targets, ["AGENTS.md"]);
  await fs.rm(root, { recursive: true, force: true });
});

test("exit 0 without a coherent declaration is producer_declaration_invalid", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: testClock(PLAN_ID),
      createAdapter: () => new FakeAdapter({ result: () => passResult("plan") }, fakeCapabilities(), null, {}),
    }),
  );
  assert.equal(outcome.kind, "transition");
  assert.equal(outcome.transition?.reason_code, "producer_declaration_invalid");
  assert.equal(outcome.transition?.declaration_invalid_detail, "artifact_unchanged");
  assert.equal(outcome.transition?.producer_diagnostic, null);
  await fs.rm(root, { recursive: true, force: true });
});

test("a competing writer lock fails closed without stealing it", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  const repoRoot = await fs.realpath(root);
  const heldId = "transition-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const held = await acquireWriterLock(repoRoot, heldId, "2026-08-22T12:00:00.000Z");
  const source = { result: () => passResult("plan") };
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: testClock(PLAN_ID),
      createAdapter: () => mutatingProducer(source),
    }),
  );
  assert.equal(outcome.kind, "transition");
  assert.equal(outcome.transition?.reason_code, "writer_lock_unavailable");
  assert.equal(outcome.transition?.lock_identity, heldId);
  await fs.access(held.lockPath);
  await fs.rm(root, { recursive: true, force: true });
});

test("implementation-review cycle 3 changes_requested stops without a fourth producer", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  let producers = 0;
  let reviews = 0;
  const source = {
    result: () => {
      reviews += 1;
      return reviews === 1 ? passResult("plan") : changesResult("implementation");
    },
  };
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: chainClock(),
      createAdapter: () =>
        new FakeAdapter(source, fakeCapabilities(), null, {
          mutate: async (input) => {
            producers += 1;
            await declareImplementationReady(input.workspace_root, input.task_path, `HX-00${producers}`, `producer ${producers}\n`);
          },
        }),
    }),
  );
  assert.equal(outcome.transition?.reason_code, "cycle_limit_reached", outcome.status?.reason_code ?? "");
  assert.equal(producers, 3);
  assert.equal(reviews, 4);
  await fs.rm(root, { recursive: true, force: true });
});

test("an in-scope product write with unchanged task bytes is only a hash proof, not implementation proof", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: testClock(PLAN_ID),
      createAdapter: () =>
        new FakeAdapter({ result: () => passResult("plan") }, fakeCapabilities(), null, {
          mutate: async (input) => {
            await fs.mkdir(path.join(input.workspace_root, "src"), { recursive: true });
            await fs.writeFile(path.join(input.workspace_root, "src", "done.ts"), "export {}\n", "utf8");
          },
        }),
    }),
  );
  assert.equal(outcome.kind, "transition");
  assert.equal(outcome.transition?.reason_code, "producer_declaration_invalid");
  assert.equal(outcome.transition?.declaration_invalid_detail, "artifact_unchanged");
  assert.equal(outcome.transition?.producer_diagnostic, null);
  await fs.rm(root, { recursive: true, force: true });
});

test("a producer that writes implementation frontmatter plus an unfenced advisory is opening_shape", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: testClock(PLAN_ID),
      createAdapter: () =>
        new FakeAdapter({ result: () => passResult("plan") }, fakeCapabilities(), null, {
          mutate: async (input) => {
            const ready = readyImplementationTask(input.task_path);
            const unfenced = ready.replace(
              "## Next Handoff\n\n```text\nRecommended execution (human decides):",
              "## Next Handoff\n\nRecommended execution (human decides):",
            ).replace(
              "- Handoff: HX-001\n```\n\n```text\nOpen",
              "- Handoff: HX-001\n\n```text\nOpen",
            );
            await fs.writeFile(path.join(input.workspace_root, input.task_path), unfenced, "utf8");
          },
        }),
    }),
  );
  assert.equal(outcome.kind, "transition");
  assert.equal(outcome.transition?.reason_code, "producer_declaration_invalid");
  assert.equal(outcome.transition?.declaration_invalid_detail, "opening_shape");
  assert.equal(outcome.transition?.producer_diagnostic, null);
  await fs.rm(root, { recursive: true, force: true });
});

test("a symlink inside the write scope is a write_scope_violation", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: testClock(PLAN_ID),
      createAdapter: () =>
        mutatingProducer({ result: () => passResult("plan") }, async (repo) => {
          await fs.mkdir(path.join(repo, "src"), { recursive: true });
          await fs.symlink("../secret.txt", path.join(repo, "src", "escape"));
        }),
    }),
  );
  assert.equal(outcome.transition?.reason_code, "write_scope_violation");
  await fs.rm(root, { recursive: true, force: true });
});

test("a node_modules or .git appearance is a write_scope_violation without hashing .git content", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: testClock(PLAN_ID),
      createAdapter: () =>
        mutatingProducer({ result: () => passResult("plan") }, async (repo) => {
          await fs.mkdir(path.join(repo, ".git"), { recursive: true });
          await fs.writeFile(path.join(repo, ".git", "secret"), "nope\n", "utf8");
        }),
    }),
  );
  assert.equal(outcome.transition?.reason_code, "write_scope_violation");
  await fs.rm(root, { recursive: true, force: true });
});

test("a runtime-state mutation during the producer window is a runtime_state_violation", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: testClock(PLAN_ID),
      createAdapter: () =>
        mutatingProducer({ result: () => passResult("plan") }, async (_workspace, _task, repo) => {
          await fs.mkdir(path.join(repo, ".spartan-bridge", "planted"), { recursive: true });
          await fs.writeFile(path.join(repo, ".spartan-bridge", "planted", "x"), "no\n", "utf8");
        }),
    }),
  );
  assert.equal(outcome.transition?.reason_code, "runtime_state_violation");
  await fs.rm(root, { recursive: true, force: true });
});

test("an existing .git descendant write is a write_scope_violation without hashing .git content", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  const gitDir = path.join(root, ".git");
  await fs.mkdir(gitDir);
  const head = path.join(gitDir, "HEAD");
  await fs.writeFile(head, "ref: a\n", "utf8");
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: testClock(PLAN_ID),
      createAdapter: () =>
        mutatingProducer({ result: () => passResult("plan") }, async (_workspace, _task, repo) => {
          const dir = path.join(repo, ".git");
          const prior = await fs.stat(dir);
          await fs.writeFile(path.join(dir, "HEAD"), "ref: b\n", "utf8");
          await fs.utimes(dir, prior.atime, prior.mtime);
        }),
    }),
  );
  assert.equal(outcome.transition?.reason_code, "write_scope_violation");
  await fs.rm(root, { recursive: true, force: true });
});

test("implementation human_required and blocked terminate the transition", async () => {
  for (const [label, second] of [
    [
      "human_required",
      { ...PRODUCTION_FAKE_RESULT, review_kind: "implementation" as const },
    ],
    ["blocked", blockedResult("implementation")],
  ] as const) {
    const { root, taskRel } = await autoRepo();
    await writeBridgeConfig(root);
    let reviews = 0;
    const source = {
      result: () => {
        reviews += 1;
        return reviews === 1 ? passResult("plan") : second;
      },
    };
    const outcome = await runReviewThenSuccessor(
      { repo: root, task: taskRel },
      testDeps({
        clock: chainClock(),
        createAdapter: () => mutatingProducer(source),
      }),
    );
    assert.equal(outcome.kind, "review", label);
    assert.equal(outcome.status?.review_kind, "implementation", label);
    assert.equal(outcome.transition?.state, "stopped", label);
    assert.equal(
      outcome.transition?.reason_code,
      label === "human_required" ? "review_human_required" : "review_blocked",
      label,
    );
    assert.equal(outcome.exitCode, 0, label);
    const events = (await fs.readFile(
      path.join(root, ".spartan-bridge", "transitions", outcome.transition!.transition_id, "events.jsonl"),
      "utf8",
    ))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; state: string });
    assert.equal(events.at(-1)?.type, "terminal_stop", label);
    assert.equal(events.at(-1)?.state, "stopped", label);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("snapshot and task-read failures after producer_started persist terminal_stop before lock release", async () => {
  for (const [label, reason, setup] of [
    [
      "pre-child snapshot cap",
      "producer_snapshot_cap_exceeded",
      async (root: string) => ({
        snapshotCaps: { entries: 1 },
        extra: undefined as ((repo: string, taskRel: string) => Promise<void>) | undefined,
        afterPlan: async () => root,
      }),
    ],
    [
      "pre-child snapshot hash cap",
      "producer_snapshot_cap_exceeded",
      async (root: string) => ({
        snapshotCaps: { hashBytes: 1 },
        extra: undefined as ((workspace: string, taskRel: string, liveRoot: string) => Promise<void>) | undefined,
        afterPlan: async () => root,
      }),
    ],
    [
      "producer repo_after snapshot cap",
      "producer_snapshot_cap_exceeded",
      async (root: string) => {
        const before = await snapshotTree(root, { policy: "producer" });
        return {
          snapshotCaps: { entries: before.entries.size },
          extra: async (_workspace: string, _taskRel: string, liveRoot: string) => {
            await fs.writeFile(path.join(liveRoot, "overflow.ts"), "export {}\n", "utf8");
          },
          afterPlan: async () => root,
        };
      },
    ],
    [
      "post-child snapshot cap",
      "adapter_error",
      async (root: string) => {
        const before = await snapshotTree(root, { policy: "producer" });
        return {
          snapshotCaps: { entries: before.entries.size },
          extra: async (repo: string) => {
            await fs.mkdir(path.join(repo, "src"), { recursive: true });
            await fs.writeFile(path.join(repo, "src", "overflow.ts"), "export {}\n", "utf8");
          },
          afterPlan: async () => root,
        };
      },
    ],
    [
      "post-child snapshot filesystem error",
      "adapter_error",
      async (root: string) => {
        const docs = path.join(root, "docs");
        return {
          snapshotCaps: undefined,
          extra: async () => {
            await fs.chmod(docs, 0o000);
          },
          afterPlan: async () => {
            await fs.chmod(docs, 0o755);
            return root;
          },
        };
      },
    ],
    [
      "post-child task-read failure",
      "task_unreadable",
      async () => ({
        snapshotCaps: undefined,
        extra: async (repo: string, taskRel: string) => {
          await fs.rm(path.join(repo, taskRel));
        },
        afterPlan: async () => undefined,
      }),
    ],
  ] as const) {
    const { root, taskRel } = await autoRepo();
    await writeBridgeConfig(root);
    const clock = testClock(PLAN_ID);
    const plan = await runReview(
      { repo: root, task: taskRel },
      testDeps({
        clock,
        createAdapter: () => new FakeAdapter({ result: () => passResult("plan") }),
      }),
    );
    assert.equal(plan.status?.verdict, "pass", label);
    let producers = 0;
    const configured = await setup(root);
    try {
      const outcome = await continueAfterPlanReview(
        plan.status!,
        { repo: root, task: taskRel },
        testDeps({
          clock,
          snapshotCaps: configured.snapshotCaps,
          createAdapter: () =>
            new FakeAdapter({ result: () => passResult("plan") }, fakeCapabilities(), null, {
              mutate: async (input) => {
                producers += 1;
                await declareImplementationReady(input.workspace_root, input.task_path);
                if (configured.extra) {
                  await configured.extra(input.workspace_root, input.task_path, input.repo_root);
                }
              },
            }),
        }),
      );
      assert.equal(outcome.kind, "transition", label);
      assert.equal(outcome.status, null, label);
      assert.equal(outcome.error, null, label);
      assert.equal(outcome.transition?.state, "stopped", label);
      assert.equal(outcome.transition?.reason_code, reason, label);
      if (label === "pre-child snapshot cap" || label === "pre-child snapshot hash cap") {
        assert.deepEqual(outcome.transition?.producer_diagnostic, {
          stage: "capture",
          exit_code: null,
          timed_out: false,
          write_scope_code: null,
          adapter_phase: null,
          adapter_cause: null,
          waited_ms: null,
          snapshot_site: "repo_before",
          snapshot_cap: label === "pre-child snapshot cap" ? "entries" : "hash_bytes",
        }, label);
      }
      if (label === "producer repo_after snapshot cap") {
        assert.equal(outcome.transition?.producer_diagnostic?.snapshot_site, "repo_after", label);
        assert.equal(outcome.transition?.producer_diagnostic?.snapshot_cap, "entries", label);
      }
      if (label === "post-child snapshot filesystem error") {
        assert.equal(outcome.transition?.producer_diagnostic?.snapshot_site, "repo_after", label);
        assert.equal(outcome.transition?.producer_diagnostic?.snapshot_cap, null, label);
      }
      const events = (
        await fs.readFile(
          path.join(root, ".spartan-bridge", "transitions", outcome.transition!.transition_id, "events.jsonl"),
          "utf8",
        )
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { type: string; state: string });
      assert.equal(events.some((event) => event.type === "producer_started"), true, label);
      assert.equal(
        events.some((event) => event.type === "producer_finished"),
        label === "post-child snapshot cap",
        label,
      );
      assert.equal(events.at(-1)?.type, "terminal_stop", label);
      assert.equal(events.at(-1)?.state, "stopped", label);
      await assert.rejects(() => fs.access(path.join(root, ".spartan-bridge", "locks", WRITER_LOCK_NAME)));
      if (label === "pre-child snapshot cap" || label === "pre-child snapshot hash cap") {
        assert.equal(producers, 0, label);
      } else {
        assert.equal(producers, 1, label);
      }
    } finally {
      await configured.afterPlan();
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

test("each producer snapshot cap stop records its exact site", async () => {
  const sites: readonly ProducerSnapshotSite[] = [
    "workspace_baseline",
    "repo_before",
    "runtime_before",
    "workspace_after",
    "repo_after",
    "runtime_after",
  ];

  for (const site of sites) {
    const { root, taskRel } = await autoRepo();
    await writeBridgeConfig(root);
    let producers = 0;
    const source = { result: () => passResult("plan") };
    const outcome = await runReviewThenSuccessor(
      { repo: root, task: taskRel },
      testDeps({
        clock: testClock(PLAN_ID),
        producerSnapshotCaps: { [site]: { entries: 1 } },
        createAdapter: () =>
          new FakeAdapter(source, fakeCapabilities(), null, {
            mutate: async (input) => {
              producers += 1;
              await declareImplementationReady(input.workspace_root, input.task_path);
            },
          }),
      }),
    );

    assert.equal(outcome.kind, "transition", site);
    assert.equal(outcome.transition?.state, "stopped", site);
    assert.equal(outcome.transition?.reason_code, "producer_snapshot_cap_exceeded", site);
    assert.deepEqual(outcome.transition?.producer_diagnostic, {
      stage: site === "workspace_baseline" ? "write_scope_lock" : "capture",
      exit_code: null,
      timed_out: false,
      write_scope_code: null,
      adapter_phase: null,
      adapter_cause: null,
      waited_ms: null,
      snapshot_site: site,
      snapshot_cap: "entries",
    }, site);
    assert.equal(
      producers,
      site === "workspace_after" || site === "repo_after" || site === "runtime_after" ? 1 : 0,
      site,
    );
    const terminal = await readTerminalTransitionEvent(root, outcome.transition!.transition_id);
    assert.equal(terminal.producer_diagnostic?.snapshot_site, site, site);
    assert.equal(terminal.producer_diagnostic?.snapshot_cap, "entries", site);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("releaseProducerIsolation is invoked once per producer round after wait and before cleanup", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  let reviews = 0;
  const source = {
    result: () => {
      reviews += 1;
      return reviews === 1 ? passResult("plan") : passResult("implementation");
    },
  };
  const adapter = mutatingProducer(source);
  const calls: string[] = [];
  const originalStart = adapter.startProducer.bind(adapter);
  adapter.startProducer = async (input) => {
    calls.push("startProducer");
    return originalStart(input);
  };
  const originalWait = adapter.waitProducer.bind(adapter);
  adapter.waitProducer = async () => {
    calls.push("waitProducer");
    return originalWait();
  };
  const originalRelease = adapter.releaseProducerIsolation.bind(adapter);
  adapter.releaseProducerIsolation = async () => {
    calls.push("releaseProducerIsolation");
    return originalRelease();
  };
  const originalCleanup = adapter.cleanupProducer.bind(adapter);
  adapter.cleanupProducer = async () => {
    calls.push("cleanupProducer");
    return originalCleanup();
  };
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({ clock: chainClock(), createAdapter: () => adapter }),
  );
  assert.equal(outcome.status?.reason_code, "review_passed", JSON.stringify(outcome));
  // D3_GUARD_RESTORE_BEFORE_POST_CAPTURE: the runtime, not the adapter's own
  // wait step, controls guard release, and it happens exactly once per
  // producer round, immediately after waitProducer resolves (with the
  // runtime's post-child captures and validation run against the
  // still-locked guard in between) and before the adapter's one final
  // cleanup for the whole chain.
  assert.deepEqual(calls, ["startProducer", "waitProducer", "releaseProducerIsolation", "cleanupProducer"]);
  await fs.rm(root, { recursive: true, force: true });
});

// D3_RUNTIME_WRITE_BEFORE_GUARD_RELEASE integration regressions below drive a
// real, OS-enforced lock on `.spartan-bridge` through the actual successor
// orchestration, not a fake. `ChflagsBridgeLockAdapter` uses the real macOS
// `chflags uchg` immutable flag (verified to make both new-file creation and
// appends to existing files fail with a real EPERM) rather than the write-
// scope guard's own POSIX-mode lock, specifically so this regression is not
// entangled with the pre-existing, unrelated interaction between that mode
// lock and the runtime-ownership snapshot's own mode comparison (`chflags`
// changes no field `snapshotTree` records, so it cannot itself trip
// `runtime_state_violation`). It is otherwise a real, additional-privilege
// filesystem lock established through the exact `lockProducerIsolation`/
// `releaseProducerIsolation` seam `finishProducerRound` uses, so a
// transition write attempted while it is active fails exactly like a write
// attempted while the real write-scope guard is active.
class ChflagsBridgeLockAdapter extends FakeAdapter {
  private lockedDir: string | undefined;

  constructor(
    source: FakeResultSource,
    private readonly repoRoot: string,
    producer: FakeProducerHook,
  ) {
    super(source, fakeCapabilities(), null, producer);
  }

  override async lockProducerIsolation(repoRoot: string, workspaceRoot: string): Promise<void> {
    assert.equal(process.platform, "darwin");
    const bridgeDir = path.join(this.repoRoot, ".spartan-bridge");
    await execFileAsync("chflags", ["-R", "uchg", bridgeDir]);
    this.lockedDir = bridgeDir;
    await super.lockProducerIsolation(repoRoot, workspaceRoot);
  }

  override async releaseProducerIsolation(): Promise<void> {
    if (this.lockedDir !== undefined) {
      const dir = this.lockedDir;
      this.lockedDir = undefined;
      await execFileAsync("chflags", ["-R", "nouchg", dir]);
    }
    await super.releaseProducerIsolation();
  }
}

test("a real chflags-locked .spartan-bridge is released before the runtime persists a successful producer_finished record", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  let reviews = 0;
  const source = {
    result: () => {
      reviews += 1;
      return reviews === 1 ? passResult("plan") : passResult("implementation");
    },
  };
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: chainClock(),
      createAdapter: () =>
        new ChflagsBridgeLockAdapter(source, root, {
          mutate: async (input) => {
            await declareImplementationReady(input.workspace_root, input.task_path);
          },
        }),
    }),
  );
  // Pre-fix, `finishProducerRound` persisted `path_validated`/`producer_finished`
  // while the real chflags lock still made `.spartan-bridge` non-writable, so
  // that write would throw EPERM and `runProducerRound`'s catch would remap
  // the whole round to the generic `adapter_error` reason instead of ever
  // completing.
  assert.equal(
    outcome.kind,
    "review",
    JSON.stringify({ status: outcome.status, transition: outcome.transition }),
  );
  assert.equal(outcome.status?.review_kind, "implementation");
  assert.equal(outcome.status?.reason_code, "review_passed");
  assert.equal(outcome.transition?.state, "completed");
  const events = (
    await fs.readFile(
      path.join(root, ".spartan-bridge", "transitions", outcome.transition!.transition_id, "events.jsonl"),
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string });
  assert.equal(events.some((event) => event.type === "path_validated"), true);
  assert.equal(events.some((event) => event.type === "producer_finished"), true);
  await fs.rm(root, { recursive: true, force: true });
});

test("a real chflags-locked .spartan-bridge is released before the runtime persists a terminal stop record", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  const source = { result: () => passResult("plan") };
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: testClock(PLAN_ID),
      createAdapter: () =>
        new ChflagsBridgeLockAdapter(source, root, {
          mutate: async (input) => {
            await fs.writeFile(path.join(input.repo_root, "secret.txt"), "no\n", "utf8");
          },
        }),
    }),
  );
  // Pre-fix, this exact `stopTransition` call would itself throw a real
  // EPERM while the chflags lock still made `.spartan-bridge` non-writable,
  // and the thrown error would be caught by `runProducerRound`'s outer
  // try/catch and remapped to the generic `adapter_error` reason instead of
  // the true `write_scope_violation` cause.
  assert.equal(outcome.kind, "transition", JSON.stringify(outcome.status));
  assert.equal(outcome.status, null);
  assert.equal(outcome.transition?.reason_code, "write_scope_violation");
  const events = (
    await fs.readFile(
      path.join(root, ".spartan-bridge", "transitions", outcome.transition!.transition_id, "events.jsonl"),
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; state: string });
  assert.equal(events.at(-1)?.type, "terminal_stop");
  assert.equal(events.at(-1)?.state, "stopped");
  await fs.rm(root, { recursive: true, force: true });
});

test("abort during producer wait cancels the child and stops cancelled", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  const controller = new AbortController();
  let cancelCount = 0;
  const source = { result: () => passResult("plan") };
  const adapter = new FakeAdapter(source, fakeCapabilities(), null, {
    wait: async () => {
      controller.abort();
      return { exitCode: 0, timedOut: false };
    },
  });
  const originalCancel = adapter.cancelProducer.bind(adapter);
  adapter.cancelProducer = async () => {
    cancelCount += 1;
    await originalCancel();
  };
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel, signal: controller.signal },
    testDeps({
      clock: testClock(PLAN_ID),
      createAdapter: () => adapter,
    }),
  );
  assert.equal(outcome.transition?.reason_code, "cancelled");
  assert.equal(cancelCount >= 1, true);
  await fs.rm(root, { recursive: true, force: true });
});

// D1/D2/D5 (task 0040): a producer execution stop now carries a closed,
// nullable `producer_diagnostic` classification alongside its reason code.
// Each adapter below throws or returns from exactly one of the guarded
// round's own catch/result boundaries, so the assertions prove the exact
// per-arm mapping in D2's table rather than only the pre-existing reason
// code.

class LockThrowAdapter extends FakeAdapter {
  constructor(
    source: FakeResultSource,
    private readonly error: Error,
  ) {
    super(source);
  }

  override async lockProducerIsolation(): Promise<void> {
    throw this.error;
  }
}

class SpawnThrowAdapter extends FakeAdapter {
  constructor(
    source: FakeResultSource,
    private readonly error: Error,
  ) {
    super(source);
  }

  override async startProducer(): Promise<void> {
    throw this.error;
  }
}

class WaitThrowAdapter extends FakeAdapter {
  constructor(
    source: FakeResultSource,
    private readonly error: Error,
  ) {
    super(source);
  }

  override async waitProducer(): Promise<{ exitCode: number | null; timedOut: boolean }> {
    throw this.error;
  }
}

class ExitAdapter extends FakeAdapter {
  constructor(
    source: FakeResultSource,
    private readonly outcome: { exitCode: number | null; timedOut: boolean },
  ) {
    super(source);
  }

  override async waitProducer(): Promise<{ exitCode: number | null; timedOut: boolean }> {
    return this.outcome;
  }
}

function adapterFailure(
  phase: AdapterFailureRecord["phase"],
  cause: AdapterFailureRecord["cause"],
  exitCode: number | null,
): AdapterFailureRecord {
  return {
    phase,
    cause,
    exit_code: exitCode,
    signal: null,
    http_status: null,
    stderr_bytes: 0,
    stderr_log: null,
    payload_log: null,
    output_excerpt_bytes: 0,
    output_excerpt: null,
  };
}

async function readTerminalTransitionEvent(root: string, transitionId: string): Promise<TransitionEventDocument> {
  const lines = (
    await fs.readFile(path.join(root, ".spartan-bridge", "transitions", transitionId, "events.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as TransitionEventDocument);
  const last = lines.at(-1);
  assert.ok(last !== undefined);
  return last;
}

async function readAllTransitionEvents(root: string, transitionId: string): Promise<TransitionEventDocument[]> {
  return (
    await fs.readFile(path.join(root, ".spartan-bridge", "transitions", transitionId, "events.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as TransitionEventDocument);
}

test("scaled delayed producer round completes under the resolved producer timeout", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  let reviews = 0;
  const source = {
    result: () => {
      reviews += 1;
      return reviews === 1 ? passResult("plan") : passResult("implementation");
    },
  };
  const adapter = new RecordingDelayedProducer(source, 200);
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({ clock: chainClock(), createAdapter: () => adapter }),
  );
  assert.equal(outcome.kind, "review");
  assert.equal(outcome.status?.reason_code, "review_passed");
  assert.equal(outcome.transition?.state, "completed");
  assert.equal(adapter.recordedTimeoutMs, BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS);
  await fs.rm(root, { recursive: true, force: true });
});

test("every collapsed producer_failure arm and the producer_timeout arm carry the exact D2 diagnostic", async () => {
  const cases: Array<{
    label: string;
    createAdapter: (source: FakeResultSource) => FakeAdapter;
    reason: "producer_failure" | "producer_timeout";
    diagnostic: ProducerDiagnostic;
  }> = [
    {
      label: "lock throws a recognized symlink write-scope failure",
      createAdapter: (source) => new LockThrowAdapter(source, new ProducerWriteScopeError("symlink")),
      reason: "producer_failure",
      diagnostic: {
        stage: "write_scope_lock",
        exit_code: null,
        timed_out: false,
        write_scope_code: "symlink",
        adapter_phase: null,
        adapter_cause: null,
        waited_ms: null,
      },
    },
    {
      label: "lock throws a recognized exact_file_missing write-scope failure",
      createAdapter: (source) => new LockThrowAdapter(source, new ProducerWriteScopeError("exact_file_missing")),
      reason: "producer_failure",
      diagnostic: {
        stage: "write_scope_lock",
        exit_code: null,
        timed_out: false,
        write_scope_code: "exact_file_missing",
        adapter_phase: null,
        adapter_cause: null,
        waited_ms: null,
      },
    },
    {
      label: "lock throws a recognized confine_unavailable write-scope failure",
      createAdapter: (source) => new LockThrowAdapter(source, new ProducerWriteScopeError("confine_unavailable")),
      reason: "producer_failure",
      diagnostic: {
        stage: "write_scope_lock",
        exit_code: null,
        timed_out: false,
        write_scope_code: "confine_unavailable",
        adapter_phase: null,
        adapter_cause: null,
        waited_ms: null,
      },
    },
    {
      label: "lock throws a recognized hardlink write-scope failure",
      createAdapter: (source) => new LockThrowAdapter(source, new ProducerWriteScopeError("hardlink")),
      reason: "producer_failure",
      diagnostic: {
        stage: "write_scope_lock",
        exit_code: null,
        timed_out: false,
        write_scope_code: "hardlink",
        adapter_phase: null,
        adapter_cause: null,
        waited_ms: null,
      },
    },
    {
      label: "lock throws an unrecognized error",
      createAdapter: (source) => new LockThrowAdapter(source, new Error("disk exploded")),
      reason: "producer_failure",
      diagnostic: {
        stage: "write_scope_lock",
        exit_code: null,
        timed_out: false,
        write_scope_code: null,
        adapter_phase: null,
        adapter_cause: null,
        waited_ms: null,
      },
    },
    {
      label: "startProducer throws a recognized AdapterFailureError",
      createAdapter: (source) =>
        new SpawnThrowAdapter(source, new AdapterFailureError(adapterFailure("start", "spawn_failed", null))),
      reason: "producer_failure",
      diagnostic: {
        stage: "spawn",
        exit_code: null,
        timed_out: false,
        write_scope_code: null,
        adapter_phase: "start",
        adapter_cause: "spawn_failed",
        waited_ms: null,
      },
    },
    {
      label: "startProducer throws an unrecognized error",
      createAdapter: (source) => new SpawnThrowAdapter(source, new Error("cursor-agent missing")),
      reason: "producer_failure",
      diagnostic: {
        stage: "spawn",
        exit_code: null,
        timed_out: false,
        write_scope_code: null,
        adapter_phase: null,
        adapter_cause: null,
        waited_ms: null,
      },
    },
    {
      label: "waitProducer throws a recognized AdapterTimeoutError",
      createAdapter: (source) =>
        new WaitThrowAdapter(
          source,
          new AdapterTimeoutError("adapter_timeout", adapterFailure("collect", "timed_out", null)),
        ),
      reason: "producer_failure",
      diagnostic: {
        stage: "wait",
        exit_code: null,
        timed_out: false,
        write_scope_code: null,
        adapter_phase: "collect",
        adapter_cause: "timed_out",
        waited_ms: null,
      },
    },
    {
      label: "waitProducer throws an unrecognized error",
      createAdapter: (source) => new WaitThrowAdapter(source, new Error("wait() rejected")),
      reason: "producer_failure",
      diagnostic: {
        stage: "wait",
        exit_code: null,
        timed_out: false,
        write_scope_code: null,
        adapter_phase: null,
        adapter_cause: null,
        waited_ms: null,
      },
    },
    {
      label: "waitProducer returns a timeout",
      createAdapter: (source) => new ExitAdapter(source, { exitCode: null, timedOut: true }),
      reason: "producer_timeout",
      diagnostic: {
        stage: "wait",
        exit_code: null,
        timed_out: true,
        write_scope_code: null,
        adapter_phase: null,
        adapter_cause: null,
        waited_ms: BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS,
      },
    },
    {
      label: "waitProducer returns a nonzero exit",
      createAdapter: (source) => new ExitAdapter(source, { exitCode: 17, timedOut: false }),
      reason: "producer_failure",
      diagnostic: {
        stage: "exit_nonzero",
        exit_code: 17,
        timed_out: false,
        write_scope_code: null,
        adapter_phase: null,
        adapter_cause: null,
        waited_ms: null,
      },
    },
    {
      label: "waitProducer returns a null exit without a timeout",
      createAdapter: (source) => new ExitAdapter(source, { exitCode: null, timedOut: false }),
      reason: "producer_failure",
      diagnostic: {
        stage: "exit_nonzero",
        exit_code: null,
        timed_out: false,
        write_scope_code: null,
        adapter_phase: null,
        adapter_cause: null,
        waited_ms: null,
      },
    },
  ];

  for (const testCase of cases) {
    const { root, taskRel } = await autoRepo();
    await writeBridgeConfig(root);
    const source = { result: () => passResult("plan") };
    const outcome = await runReviewThenSuccessor(
      { repo: root, task: taskRel },
      testDeps({ clock: testClock(PLAN_ID), createAdapter: () => testCase.createAdapter(source) }),
    );
    assert.equal(outcome.kind, "transition", testCase.label);
    assert.equal(outcome.status, null, testCase.label);
    assert.equal(outcome.transition?.state, "stopped", testCase.label);
    assert.equal(outcome.transition?.reason_code, testCase.reason, testCase.label);
    const expectedDiagnostic = {
      ...testCase.diagnostic,
      snapshot_site: null,
      snapshot_cap: null,
    };
    assert.deepEqual(outcome.transition?.producer_diagnostic, expectedDiagnostic, testCase.label);

    const transitionId = outcome.transition!.transition_id;
    const events = await readAllTransitionEvents(root, transitionId);
    assert.equal(events.some((event) => event.type === "producer_started"), true, testCase.label);
    assert.equal(events.some((event) => event.type === "producer_finished"), false, testCase.label);
    assert.equal(
      events.some((event) => event.type === "implementation_review_dispatched"),
      false,
      testCase.label,
    );
    const terminal = await readTerminalTransitionEvent(root, transitionId);
    assert.equal(terminal.type, "terminal_stop", testCase.label);
    assert.equal(terminal.state, "stopped", testCase.label);
    assert.equal(terminal.reason_code, testCase.reason, testCase.label);
    assert.deepEqual(terminal.producer_diagnostic, expectedDiagnostic, testCase.label);

    // Every non-terminal event carries a null diagnostic (D1): only the
    // final terminal_stop record ever carries the non-null classification.
    for (const event of events.slice(0, -1)) {
      assert.equal(event.producer_diagnostic, null, `${testCase.label}: ${event.type}`);
    }

    await assert.rejects(() => fs.access(path.join(root, ".spartan-bridge", "locks", WRITER_LOCK_NAME)), testCase.label);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("passing implementation review without a replaceable Next Action stops the transition on close-out failure", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  let reviews = 0;
  const source = {
    result: () => {
      reviews += 1;
      return reviews === 1 ? passResult("plan") : passResult("implementation");
    },
  };
  const producer = new FakeAdapter(source, fakeCapabilities(), null, {
    mutate: async (input) => {
      const text = readyImplementationTask(input.task_path).replace(
        "## Next Action\n\nRe-review the implementation against all acceptance criteria.\n\n",
        "",
      );
      await fs.writeFile(path.join(input.workspace_root, input.task_path), text, "utf8");
    },
  });
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({ clock: chainClock(), createAdapter: () => producer }),
  );
  assert.equal(outcome.kind, "transition");
  assert.equal(outcome.transition?.state, "stopped");
  assert.equal(outcome.transition?.reason_code, "task_artifact_write_rejected");
  await fs.rm(root, { recursive: true, force: true });
});

test("a full successful producer/reviewer chain returns and persists a null producer_diagnostic throughout", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  let reviews = 0;
  const source = {
    result: () => {
      reviews += 1;
      return reviews === 1 ? passResult("plan") : passResult("implementation");
    },
  };
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({ clock: chainClock(), createAdapter: () => mutatingProducer(source) }),
  );
  assert.equal(outcome.kind, "review", outcome.transition?.reason_code ?? "");
  assert.equal(outcome.status?.reason_code, "review_passed");
  assert.equal(outcome.transition?.state, "completed");
  assert.equal(outcome.transition?.producer_diagnostic, null);
  const events = await readAllTransitionEvents(root, outcome.transition!.transition_id);
  assert.equal(events.length > 0, true);
  for (const event of events) {
    assert.equal(event.producer_diagnostic, null, event.type);
  }
  await fs.rm(root, { recursive: true, force: true });
});

test("a hard-link write after productAfter pins the documented detection-window residual without changing captured merge bytes", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  const protectedPath = path.join(root, "outside-scope.txt");
  await fs.writeFile(protectedPath, "before\n");
  const aliasRoot = await fs.mkdtemp(path.join(root, "..", "spartan-delayed-alias-"));
  const alias = path.join(aliasRoot, "alias");
  await fs.link(protectedPath, alias);
  let reviews = 0;
  const source = { result: () => (++reviews === 1 ? passResult("plan") : passResult("implementation")) };
  const base = testDeps({
    clock: chainClock(),
    createAdapter: () => mutatingProducer(source, async (workspaceRoot) => {
      await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
      await fs.writeFile(path.join(workspaceRoot, "src", "captured.ts"), "captured\n");
    }),
  });
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    {
      ...base,
      // D-072: this deterministic seam is after productAfter and therefore
      // outside the deliberately bounded hard-link detection window.
      afterProducerSnapshots: async () => fs.writeFile(alias, "delayed\n"),
    },
  );
  assert.equal(outcome.kind, "review", outcome.transition?.reason_code ?? "");
  assert.equal(outcome.status?.reason_code, "review_passed");
  assert.equal(await fs.readFile(protectedPath, "utf8"), "delayed\n");
  assert.equal(await fs.readFile(path.join(root, "src", "captured.ts"), "utf8"), "captured\n");
  await fs.rm(aliasRoot, { recursive: true, force: true });
  await fs.rm(root, { recursive: true, force: true });
});

test("hard-link writes inside the snapshot window are detected outside and inside skipped subtrees before merge", async () => {
  for (const rel of ["outside-scope.txt", "node_modules/pkg/x", ".venv/pkg/x"]) {
    const { root, taskRel } = await autoRepo();
    await writeBridgeConfig(root);
    const target = path.join(root, ...rel.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "before\n");
    const aliasRoot = await fs.mkdtemp(path.join(root, "..", "spartan-window-alias-"));
    const alias = path.join(aliasRoot, "alias");
    await fs.link(target, alias);
    const source = { result: () => passResult("plan") };
    const outcome = await runReviewThenSuccessor(
      { repo: root, task: taskRel },
      testDeps({
        clock: chainClock(),
        createAdapter: () => mutatingProducer(source, async (workspaceRoot) => {
          await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
          await fs.writeFile(path.join(workspaceRoot, "src", "must-not-merge.ts"), "captured\n");
          await fs.writeFile(alias, "mutation-in-window\n");
        }),
      }),
    );
    assert.equal(outcome.kind, "transition", rel);
    assert.equal(outcome.transition?.reason_code, "write_scope_violation", rel);
    assert.equal(await fs.readFile(target, "utf8"), "mutation-in-window\n", rel);
    await assert.rejects(fs.access(path.join(root, "src", "must-not-merge.ts")), undefined, rel);
    await fs.rm(aliasRoot, { recursive: true, force: true });
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("live non-admitted leftovers do not block a producer and only admitted untracked files enter its copy", async () => {
  const { root, taskRel } = await autoRepo();
  await writeBridgeConfig(root);
  await fs.mkdir(path.join(root, "build"));
  await fs.writeFile(path.join(root, "build", "leftover.txt"), "leftover\n");
  await fs.symlink("/tmp/spartan-live-leftover", path.join(root, "build", "out"));
  await fs.mkdir(path.join(root, "node_modules"));
  await fs.symlink("/tmp", path.join(root, "node_modules", "x"));
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src", "untracked.ts"), "visible\n");
  let reviews = 0;
  const source = { result: () => (++reviews === 1 ? passResult("plan") : passResult("implementation")) };
  const outcome = await runReviewThenSuccessor(
    { repo: root, task: taskRel },
    testDeps({
      clock: chainClock(),
      createAdapter: () => mutatingProducer(source, async (workspaceRoot) => {
        await assert.rejects(fs.access(path.join(workspaceRoot, "build", "leftover.txt")));
        await assert.rejects(fs.lstat(path.join(workspaceRoot, "node_modules", "x")));
        assert.equal(await fs.readFile(path.join(workspaceRoot, "src", "untracked.ts"), "utf8"), "visible\n");
      }),
    }),
  );
  assert.equal(outcome.kind, "review", outcome.transition?.reason_code ?? "");
  assert.equal(outcome.status?.reason_code, "review_passed");
  await fs.rm(root, { recursive: true, force: true });
});

// CURSOR_GUARD_RUNTIME_SNAPSHOT_CONFLICT regressions below drive the real
// production path: the real `CursorAdapter`, its real Darwin write-scope
// guard (recursive POSIX-mode locking, including `.spartan-bridge`), and a
// real, sandbox-confined child process. Only the implementer round uses
// this real adapter (via `cursorProducerRegistry()`); both reviewer rounds
// stay on the fake adapter so the tests need no real Cursor review-mode
// stub. Before the fix, `finishProducerRound` captured its runtime/product
// "before" snapshot ahead of the guard's own recursive chmod pass and its
// "after" snapshot while that same guard was still active, so the guard's
// own controlled mode transitions (which cover every path outside the
// admitted scope, including `.spartan-bridge`) were indistinguishable from
// a producer mutation and always tripped `runtime_state_violation`,
// regardless of what the producer actually did.
test("a real Cursor isolated producer can merge a valid workspace declaration", async () => {
  assert.equal(process.platform, "darwin");
  const { root, taskRel } = await makeRepo({
    agents: autoAgentsWithCursorProducer(),
    task: planTask(),
  });
  await writeBridgeConfig(root);
  let reviews = 0;
  const source: FakeResultSource = {
    result: () => {
      reviews += 1;
      return reviews === 1 ? passResult("plan") : passResult("implementation");
    },
  };
  const implementationTask = readyImplementationTask(taskRel, "HX-777");
  const script = `
    const fs = require("node:fs");
    const path = require("node:path"); const root = process.cwd();
    fs.writeFileSync(path.join(root, ${JSON.stringify(taskRel)}), ${JSON.stringify(implementationTask)});
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "ok.ts"), "export {}\\n");
  `;
  const recorded: SpawnRequest[] = [];
  const deps: AppDeps = {
    registry: createMemoryRegistrySource(cursorProducerRegistry()),
    catalog: cursorProducerCatalog(() => new CursorAdapter({ runner: cursorProducerRunner(script, recorded) }), source),
    clock: chainClock(),
  };
  const outcome = await runReviewThenSuccessor({ repo: root, task: taskRel }, deps);
  if (outcome.kind === "review" && outcome.status?.review_kind === "plan") {
    await fs.rm(root, { recursive: true, force: true });
    return;
  }
  assert.equal(
    outcome.kind,
    "review",
    JSON.stringify({ status: outcome.status, transition: outcome.transition }),
  );
  assert.equal(outcome.status?.review_kind, "implementation");
  assert.equal(outcome.status?.reason_code, "review_passed");
  assert.equal(outcome.transition?.state, "completed");
  const producerCalls = recorded.filter(
    (item) => item.executable === CURSOR_EXECUTABLE && item.args[0] === "-p" && !item.args.includes("--mode"),
  );
  assert.equal(producerCalls.length, 1);
  const events = (
    await fs.readFile(
      path.join(root, ".spartan-bridge", "transitions", outcome.transition!.transition_id, "events.jsonl"),
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; reason_code: string | null });
  assert.equal(events.some((event) => event.type === "path_validated"), true);
  assert.equal(events.some((event) => event.type === "producer_finished"), true);
  assert.equal(events.every((event) => event.reason_code !== "runtime_state_violation"), true);
  assert.equal(events.every((event) => event.reason_code !== "write_scope_violation"), true);
  await fs.rm(root, { recursive: true, force: true });
});

test("a real Cursor isolated producer persists a genuine declaration stop", async () => {
  assert.equal(process.platform, "darwin");
  const { root, taskRel } = await makeRepo({
    agents: autoAgentsWithCursorProducer(),
    task: planTask(),
  });
  await writeBridgeConfig(root);
  const source: FakeResultSource = { result: () => passResult("plan") };
  // The producer writes an ordinary in-scope file but never updates the task
  // artifact, so the task hash is unchanged after a clean exit. Reaching
  // `producer_declaration_invalid` (rather than a masking
  // `runtime_state_violation` from the guard's own mode changes) proves the
  // guard fix does not just make every round "pass": a real, non-guard-
  // related stop is still detected and correctly reported, and its
  // transition record is still written only after the guard releases.
  const script = `
    const fs = require("node:fs");
    const path = require("node:path"); const root = process.cwd();
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "ok.ts"), "export {}\\n");
  `;
  const recorded: SpawnRequest[] = [];
  const deps: AppDeps = {
    registry: createMemoryRegistrySource(cursorProducerRegistry()),
    catalog: cursorProducerCatalog(() => new CursorAdapter({ runner: cursorProducerRunner(script, recorded) }), source),
    clock: chainClock(),
  };
  const outcome = await runReviewThenSuccessor({ repo: root, task: taskRel }, deps);
  if (outcome.kind === "review" && outcome.status?.review_kind === "plan") {
    await fs.rm(root, { recursive: true, force: true });
    return;
  }
  assert.equal(outcome.kind, "transition", JSON.stringify(outcome.status));
  assert.equal(outcome.status, null);
  assert.equal(outcome.transition?.reason_code, "producer_declaration_invalid");
  assert.equal(outcome.transition?.declaration_invalid_detail, "artifact_unchanged");
  assert.equal(outcome.transition?.producer_diagnostic, null);
  const events = (
    await fs.readFile(
      path.join(root, ".spartan-bridge", "transitions", outcome.transition!.transition_id, "events.jsonl"),
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; state: string; reason_code: string | null; declaration_invalid_detail?: string | null });
  assert.equal(events.at(-1)?.type, "terminal_stop");
  assert.equal(events.at(-1)?.state, "stopped");
  assert.equal(events.at(-1)?.reason_code, "producer_declaration_invalid");
  assert.equal(events.at(-1)?.declaration_invalid_detail, "artifact_unchanged");
  await fs.rm(root, { recursive: true, force: true });
});

test("advanceFromCheckpoint: producer_finished dispatches implementation review once", async () => {
  const { root: r0, taskRel } = await autoRepo();
  const root = await fs.realpath(r0);
  await writeBridgeConfig(root);
  const transitionId = "transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const transDir = path.join(root, ".spartan-bridge", "transitions", transitionId);
  await fs.mkdir(transDir, { recursive: true });
  await fs.writeFile(path.join(root, taskRel), readyImplementationTask(taskRel), "utf8");
  await fs.writeFile(
    path.join(transDir, "status.json"),
    `${JSON.stringify({
      schema_version: SCHEMA_VERSION,
      document: "transition",
      transition_id: transitionId,
      state: "producer_finished",
      parent_run_id: PLAN_ID,
      task_path: taskRel,
      approved_task_hash: null,
      policy_digest: null,
      implementer_host: null,
      implementer_launcher_id: null,
      lock_identity: null,
      reason_code: null,
      producer_diagnostic: null,
      unwritable_plan_targets: null,
      declaration_invalid_detail: null,
      current_review_run_id: null,
      linked_review_run_ids: [],
      created_at: "2026-08-31T00:00:00.000Z",
      updated_at: "2026-08-31T00:00:00.000Z",
    })}\n`,
    "utf8",
  );
  const eventLine = (sequence: number, type: string, state: string): string =>
    `${JSON.stringify({
      schema_version: SCHEMA_VERSION,
      sequence,
      timestamp: "2026-08-31T00:00:00.000Z",
      transition_id: transitionId,
      type,
      state,
      reason_code: null,
      producer_diagnostic: null,
      unwritable_plan_targets: null,
      declaration_invalid_detail: null,
      review_run_id: null,
    })}\n`;
  await fs.writeFile(
    path.join(transDir, "events.jsonl"),
    [eventLine(1, "producer_started", "producer_running"), eventLine(2, "producer_finished", "producer_finished")].join(""),
    "utf8",
  );
  let reviews = 0;
  const outcome = await advanceFromCheckpoint({
    repoRoot: root,
    repoArg: root,
    taskPath: taskRel,
    transition: { transitionDir: transDir, sequence: 2, status: JSON.parse(await fs.readFile(path.join(transDir, "status.json"), "utf8")) },
    deps: testDeps({
      createAdapter: () =>
        new FakeAdapter({
          result: () => {
            reviews += 1;
            return passResult("implementation");
          },
        }),
    }),
    allowCorrection: false,
    parentRunId: PLAN_ID,
    planRunId: PLAN_ID,
  });
  assert.notEqual(outcome, null);
  assert.equal(reviews, 1);
  if (outcome !== null && (outcome.kind === "review" || outcome.kind === "transition")) {
    assert.equal(outcome.transition?.state, "completed");
  }
  await fs.rm(root, { recursive: true, force: true });
});

test("advanceFromCheckpoint: finaliseOnly at producer_finished without a terminal linked run returns needs_dispatch", async () => {
  const { root: r0, taskRel } = await autoRepo();
  const root = await fs.realpath(r0);
  await writeBridgeConfig(root);
  const transitionId = "transition-a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1";
  const transDir = path.join(root, ".spartan-bridge", "transitions", transitionId);
  await fs.mkdir(transDir, { recursive: true });
  await fs.writeFile(path.join(root, taskRel), readyImplementationTask(taskRel), "utf8");
  const status = {
    schema_version: SCHEMA_VERSION,
    document: "transition",
    transition_id: transitionId,
    state: "producer_finished",
    parent_run_id: PLAN_ID,
    task_path: taskRel,
    approved_task_hash: null,
    policy_digest: null,
    implementer_host: null,
    implementer_launcher_id: null,
    lock_identity: null,
    reason_code: null,
    producer_diagnostic: null,
    unwritable_plan_targets: null,
    declaration_invalid_detail: null,
    current_review_run_id: null,
    linked_review_run_ids: [],
    created_at: "2026-08-31T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:00.000Z",
  };
  await fs.writeFile(path.join(transDir, "status.json"), `${JSON.stringify(status)}\n`, "utf8");
  await fs.writeFile(
    path.join(transDir, "events.jsonl"),
    `${JSON.stringify({
      schema_version: SCHEMA_VERSION,
      sequence: 1,
      timestamp: "2026-08-31T00:00:00.000Z",
      transition_id: transitionId,
      type: "producer_finished",
      state: "producer_finished",
      reason_code: null,
      producer_diagnostic: null,
      unwritable_plan_targets: null,
      declaration_invalid_detail: null,
      review_run_id: null,
    })}\n`,
    "utf8",
  );
  let reviews = 0;
  const outcome = await advanceFromCheckpoint({
    repoRoot: root,
    repoArg: root,
    taskPath: taskRel,
    transition: { transitionDir: transDir, sequence: 1, status },
    deps: testDeps({
      createAdapter: () =>
        new FakeAdapter({
          result: () => {
            reviews += 1;
            return passResult("implementation");
          },
        }),
    }),
    allowCorrection: false,
    finaliseOnly: true,
    parentRunId: PLAN_ID,
    planRunId: PLAN_ID,
  });
  assert.deepEqual(outcome, { kind: "needs_dispatch" });
  assert.equal(reviews, 0);
  const trans = JSON.parse(await fs.readFile(path.join(transDir, "status.json"), "utf8")) as { state: string };
  assert.equal(trans.state, "producer_finished");
  await fs.rm(root, { recursive: true, force: true });
});

test("advanceFromCheckpoint: terminal linked review at producer_finished does not re-dispatch", async () => {
  const { root: r0, taskRel } = await autoRepo();
  const root = await fs.realpath(r0);
  await writeBridgeConfig(root);
  const transitionId = "transition-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const reviewRunId = "run-cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const transDir = path.join(root, ".spartan-bridge", "transitions", transitionId);
  await fs.mkdir(transDir, { recursive: true });
  const reviewDir = path.join(root, ".spartan-bridge", "runs", reviewRunId);
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(
    path.join(reviewDir, "status.json"),
    `${JSON.stringify({
      schema_version: SCHEMA_VERSION,
      run_id: reviewRunId,
      state: "awaiting_implementer",
      review_kind: "implementation",
      verdict: "pass",
      reason_code: "review_passed",
      task_hash_after_write: null,
    })}\n`,
    "utf8",
  );
  const status = {
    schema_version: SCHEMA_VERSION,
    document: "transition",
    transition_id: transitionId,
    state: "producer_finished",
    parent_run_id: PLAN_ID,
    task_path: taskRel,
    approved_task_hash: null,
    policy_digest: null,
    implementer_host: null,
    implementer_launcher_id: null,
    lock_identity: null,
    reason_code: null,
    producer_diagnostic: null,
    unwritable_plan_targets: null,
    declaration_invalid_detail: null,
    current_review_run_id: reviewRunId,
    linked_review_run_ids: [reviewRunId],
    created_at: "2026-08-31T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:00.000Z",
  };
  await fs.writeFile(path.join(transDir, "status.json"), `${JSON.stringify(status)}\n`, "utf8");
  await fs.writeFile(
    path.join(transDir, "events.jsonl"),
    `${JSON.stringify({
      schema_version: SCHEMA_VERSION,
      sequence: 1,
      timestamp: "2026-08-31T00:00:00.000Z",
      transition_id: transitionId,
      type: "producer_finished",
      state: "producer_finished",
      reason_code: null,
      producer_diagnostic: null,
      unwritable_plan_targets: null,
      declaration_invalid_detail: null,
      review_run_id: null,
    })}\n`,
    "utf8",
  );
  let reviews = 0;
  const outcome = await advanceFromCheckpoint({
    repoRoot: root,
    repoArg: root,
    taskPath: taskRel,
    transition: { transitionDir: transDir, sequence: 1, status },
    deps: testDeps({
      createAdapter: () =>
        new FakeAdapter({
          result: () => {
            reviews += 1;
            return passResult("implementation");
          },
        }),
    }),
    allowCorrection: false,
    parentRunId: PLAN_ID,
    planRunId: PLAN_ID,
  });
  assert.equal(reviews, 0);
  if (outcome !== null && (outcome.kind === "review" || outcome.kind === "transition")) {
    assert.equal(outcome.transition?.state, "completed");
  }
  await fs.rm(root, { recursive: true, force: true });
});

test("advanceFromCheckpoint: path_validated after correction_dispatched dispatches a fresh review", async () => {
  const { root: r0, taskRel } = await autoRepo();
  const root = await fs.realpath(r0);
  await writeBridgeConfig(root);
  const transitionId = "transition-cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const priorReviewRunId = "run-dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const transDir = path.join(root, ".spartan-bridge", "transitions", transitionId);
  await fs.mkdir(transDir, { recursive: true });
  const preCorrectionText = validTaskMd({
    taskType: "implementation",
    phase: "reviewing",
    role: "implementer",
    nextRole: "reviewer",
    reviewSection: `\n${DEFAULT_REVIEW_SECTION}`,
  });
  await fs.writeFile(path.join(root, taskRel), preCorrectionText, "utf8");
  const taskHashBeforeCorrection = sha256Bytes(new Uint8Array(await fs.readFile(path.join(root, taskRel))));
  await plantChainedImplementationParent(root, taskRel, priorReviewRunId, taskHashBeforeCorrection);
  await fs.writeFile(path.join(root, taskRel), readyImplementationTask(taskRel), "utf8");
  const status = {
    schema_version: SCHEMA_VERSION,
    document: "transition",
    transition_id: transitionId,
    state: "producer_finished",
    parent_run_id: PLAN_ID,
    task_path: taskRel,
    approved_task_hash: null,
    policy_digest: null,
    implementer_host: null,
    implementer_launcher_id: null,
    lock_identity: null,
    reason_code: null,
    producer_diagnostic: null,
    unwritable_plan_targets: null,
    declaration_invalid_detail: null,
    current_review_run_id: priorReviewRunId,
    linked_review_run_ids: [priorReviewRunId],
    created_at: "2026-08-31T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:00.000Z",
  };
  await fs.writeFile(path.join(transDir, "status.json"), `${JSON.stringify(status)}\n`, "utf8");
  const eventLine = (sequence: number, type: string, state: string, reviewRunId: string | null = null): string =>
    `${JSON.stringify({
      schema_version: SCHEMA_VERSION,
      sequence,
      timestamp: "2026-08-31T00:00:00.000Z",
      transition_id: transitionId,
      type,
      state,
      reason_code: null,
      producer_diagnostic: null,
      unwritable_plan_targets: null,
      declaration_invalid_detail: null,
      review_run_id: reviewRunId,
    })}\n`;
  await fs.writeFile(
    path.join(transDir, "events.jsonl"),
    [
      eventLine(1, "producer_started", "producer_running"),
      eventLine(2, "producer_finished", "producer_finished"),
      eventLine(3, "implementation_review_dispatched", "reviewing", priorReviewRunId),
      eventLine(4, "implementation_review_result", "reviewing", priorReviewRunId),
      eventLine(5, "correction_dispatched", "reviewing", priorReviewRunId),
      eventLine(6, "producer_started", "producer_running"),
      eventLine(7, "path_validated", "producer_finished"),
    ].join(""),
    "utf8",
  );
  let reviews = 0;
  const outcome = await advanceFromCheckpoint({
    repoRoot: root,
    repoArg: root,
    taskPath: taskRel,
    transition: { transitionDir: transDir, sequence: 7, status },
    deps: testDeps({
      createAdapter: () =>
        new FakeAdapter({
          result: () => {
            reviews += 1;
            return passResult("implementation");
          },
        }),
    }),
    allowCorrection: false,
    parentRunId: priorReviewRunId,
    planRunId: PLAN_ID,
    cycle: 2,
    maxCycles: 3,
  });
  assert.equal(reviews, 1);
  if (outcome !== null && (outcome.kind === "review" || outcome.kind === "transition")) {
    assert.equal(outcome.transition?.state, "completed");
  }
  await fs.rm(root, { recursive: true, force: true });
});

test("advanceFromCheckpoint: producer_finished after correction_dispatched does not finalise the prior review", async () => {
  const { root: r0, taskRel } = await autoRepo();
  const root = await fs.realpath(r0);
  await writeBridgeConfig(root);
  const transitionId = "transition-dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const priorReviewRunId = "run-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const transDir = path.join(root, ".spartan-bridge", "transitions", transitionId);
  await fs.mkdir(transDir, { recursive: true });
  const preCorrectionText = validTaskMd({
    taskType: "implementation",
    phase: "reviewing",
    role: "implementer",
    nextRole: "reviewer",
    reviewSection: `\n${DEFAULT_REVIEW_SECTION}`,
  });
  await fs.writeFile(path.join(root, taskRel), preCorrectionText, "utf8");
  const taskHashBeforeCorrection = sha256Bytes(new Uint8Array(await fs.readFile(path.join(root, taskRel))));
  await plantChainedImplementationParent(root, taskRel, priorReviewRunId, taskHashBeforeCorrection);
  await fs.writeFile(path.join(root, taskRel), readyImplementationTask(taskRel), "utf8");
  const status = {
    schema_version: SCHEMA_VERSION,
    document: "transition",
    transition_id: transitionId,
    state: "producer_finished",
    parent_run_id: PLAN_ID,
    task_path: taskRel,
    approved_task_hash: null,
    policy_digest: null,
    implementer_host: null,
    implementer_launcher_id: null,
    lock_identity: null,
    reason_code: null,
    producer_diagnostic: null,
    unwritable_plan_targets: null,
    declaration_invalid_detail: null,
    current_review_run_id: priorReviewRunId,
    linked_review_run_ids: [priorReviewRunId],
    created_at: "2026-08-31T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:00.000Z",
  };
  await fs.writeFile(path.join(transDir, "status.json"), `${JSON.stringify(status)}\n`, "utf8");
  const eventLine = (sequence: number, type: string, state: string, reviewRunId: string | null = null): string =>
    `${JSON.stringify({
      schema_version: SCHEMA_VERSION,
      sequence,
      timestamp: "2026-08-31T00:00:00.000Z",
      transition_id: transitionId,
      type,
      state,
      reason_code: null,
      producer_diagnostic: null,
      unwritable_plan_targets: null,
      declaration_invalid_detail: null,
      review_run_id: reviewRunId,
    })}\n`;
  await fs.writeFile(
    path.join(transDir, "events.jsonl"),
    [
      eventLine(1, "producer_finished", "producer_finished"),
      eventLine(2, "implementation_review_dispatched", "reviewing", priorReviewRunId),
      eventLine(3, "implementation_review_result", "reviewing", priorReviewRunId),
      eventLine(4, "correction_dispatched", "reviewing", priorReviewRunId),
      eventLine(5, "producer_started", "producer_running"),
      eventLine(6, "path_validated", "producer_finished"),
      eventLine(7, "producer_finished", "producer_finished"),
    ].join(""),
    "utf8",
  );
  let reviews = 0;
  const outcome = await advanceFromCheckpoint({
    repoRoot: root,
    repoArg: root,
    taskPath: taskRel,
    transition: { transitionDir: transDir, sequence: 7, status },
    deps: testDeps({
      createAdapter: () =>
        new FakeAdapter({
          result: () => {
            reviews += 1;
            return passResult("implementation");
          },
        }),
    }),
    allowCorrection: false,
    parentRunId: priorReviewRunId,
    planRunId: PLAN_ID,
    cycle: 2,
    maxCycles: 3,
  });
  assert.equal(reviews, 1);
  if (outcome !== null && (outcome.kind === "review" || outcome.kind === "transition")) {
    assert.equal(outcome.transition?.state, "completed");
  }
  await fs.rm(root, { recursive: true, force: true });
});

test("advanceFromCheckpoint: unlinked review run with transition_id finalises without re-dispatch", async () => {
  const { root: r0, taskRel } = await autoRepo();
  const root = await fs.realpath(r0);
  await writeBridgeConfig(root);
  const transitionId = "transition-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const reviewRunId = "run-ffffffff-ffff-4fff-8fff-ffffffffffff";
  const transDir = path.join(root, ".spartan-bridge", "transitions", transitionId);
  await fs.mkdir(transDir, { recursive: true });
  const reviewDir = path.join(root, ".spartan-bridge", "runs", reviewRunId);
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(
    path.join(reviewDir, "status.json"),
    `${JSON.stringify({
      schema_version: SCHEMA_VERSION,
      run_id: reviewRunId,
      state: "awaiting_implementer",
      review_kind: "implementation",
      verdict: "pass",
      reason_code: "review_passed",
      task_hash_after_write: null,
      transition_id: transitionId,
      updated_at: "2026-08-31T01:00:00.000Z",
    })}\n`,
    "utf8",
  );
  const status = {
    schema_version: SCHEMA_VERSION,
    document: "transition",
    transition_id: transitionId,
    state: "producer_finished",
    parent_run_id: PLAN_ID,
    task_path: taskRel,
    approved_task_hash: null,
    policy_digest: null,
    implementer_host: null,
    implementer_launcher_id: null,
    lock_identity: null,
    reason_code: null,
    producer_diagnostic: null,
    unwritable_plan_targets: null,
    declaration_invalid_detail: null,
    current_review_run_id: null,
    linked_review_run_ids: [],
    created_at: "2026-08-31T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:00.000Z",
  };
  await fs.writeFile(path.join(transDir, "status.json"), `${JSON.stringify(status)}\n`, "utf8");
  await fs.writeFile(
    path.join(transDir, "events.jsonl"),
    `${JSON.stringify({
      schema_version: SCHEMA_VERSION,
      sequence: 1,
      timestamp: "2026-08-31T00:00:00.000Z",
      transition_id: transitionId,
      type: "producer_finished",
      state: "producer_finished",
      reason_code: null,
      producer_diagnostic: null,
      unwritable_plan_targets: null,
      declaration_invalid_detail: null,
      review_run_id: null,
    })}\n`,
    "utf8",
  );
  let reviews = 0;
  const outcome = await advanceFromCheckpoint({
    repoRoot: root,
    repoArg: root,
    taskPath: taskRel,
    transition: { transitionDir: transDir, sequence: 1, status },
    deps: testDeps({
      createAdapter: () =>
        new FakeAdapter({
          result: () => {
            reviews += 1;
            return passResult("implementation");
          },
        }),
    }),
    allowCorrection: false,
    parentRunId: PLAN_ID,
    planRunId: PLAN_ID,
  });
  assert.equal(reviews, 0);
  if (outcome !== null && (outcome.kind === "review" || outcome.kind === "transition")) {
    assert.equal(outcome.transition?.state, "completed");
  }
  await fs.rm(root, { recursive: true, force: true });
});

test("advanceFromCheckpoint: implementation_review_result replays terminal close-out without task_artifact_write_rejected", async () => {
  const { root: r0, taskRel } = await autoRepo();
  const root = await fs.realpath(r0);
  await writeBridgeConfig(root);
  const transitionId = "transition-12121212-1212-4121-8121-121212121212";
  const reviewRunId = "run-23232323-2323-4232-8232-232323232323";
  const transDir = path.join(root, ".spartan-bridge", "transitions", transitionId);
  await fs.mkdir(transDir, { recursive: true });
  const taskAbs = path.join(root, taskRel);
  const preCloseText = readyImplementationTask(taskRel);
  await fs.writeFile(taskAbs, preCloseText, "utf8");
  const preCloseHash = sha256Bytes(new Uint8Array(await fs.readFile(taskAbs)));
  const closed = composeTerminalCloseOut(preCloseText, reviewRunId, "2026-09-02");
  assert.notEqual(closed, null);
  await fs.writeFile(taskAbs, closed!, "utf8");
  const reviewDir = path.join(root, ".spartan-bridge", "runs", reviewRunId);
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(
    path.join(reviewDir, "status.json"),
    `${JSON.stringify({
      schema_version: SCHEMA_VERSION,
      run_id: reviewRunId,
      state: "awaiting_implementer",
      review_kind: "implementation",
      verdict: "pass",
      reason_code: "review_passed",
      task_hash_after_write: preCloseHash,
    })}\n`,
    "utf8",
  );
  const status = {
    schema_version: SCHEMA_VERSION,
    document: "transition",
    transition_id: transitionId,
    state: "reviewing",
    parent_run_id: PLAN_ID,
    task_path: taskRel,
    approved_task_hash: null,
    policy_digest: null,
    implementer_host: null,
    implementer_launcher_id: null,
    lock_identity: null,
    reason_code: null,
    producer_diagnostic: null,
    unwritable_plan_targets: null,
    declaration_invalid_detail: null,
    current_review_run_id: reviewRunId,
    linked_review_run_ids: [reviewRunId],
    created_at: "2026-08-31T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:00.000Z",
  };
  await fs.writeFile(path.join(transDir, "status.json"), `${JSON.stringify(status)}\n`, "utf8");
  const eventLine = (sequence: number, type: string, state: string, runId: string): string =>
    `${JSON.stringify({
      schema_version: SCHEMA_VERSION,
      sequence,
      timestamp: "2026-08-31T00:00:00.000Z",
      transition_id: transitionId,
      type,
      state,
      reason_code: null,
      producer_diagnostic: null,
      unwritable_plan_targets: null,
      declaration_invalid_detail: null,
      review_run_id: runId,
    })}\n`;
  await fs.writeFile(
    path.join(transDir, "events.jsonl"),
    [
      eventLine(1, "producer_finished", "producer_finished", reviewRunId),
      eventLine(2, "implementation_review_dispatched", "reviewing", reviewRunId),
      eventLine(3, "implementation_review_result", "reviewing", reviewRunId),
    ].join(""),
    "utf8",
  );
  const outcome = await advanceFromCheckpoint({
    repoRoot: root,
    repoArg: root,
    taskPath: taskRel,
    transition: { transitionDir: transDir, sequence: 3, status },
    deps: testDeps(),
    allowCorrection: false,
    parentRunId: PLAN_ID,
    planRunId: PLAN_ID,
  });
  assert.notEqual(outcome, null);
  if (outcome !== null && (outcome.kind === "review" || outcome.kind === "transition")) {
    assert.equal(outcome.transition?.state, "completed");
    assert.notEqual(outcome.transition?.reason_code, "task_artifact_write_rejected");
  }
  await fs.rm(root, { recursive: true, force: true });
});

test("advanceFromCheckpoint: a task file removed before the pass close-out stops the transition, does not throw", async () => {
  const { root: r0, taskRel } = await autoRepo();
  const root = await fs.realpath(r0);
  await writeBridgeConfig(root);
  const transitionId = "transition-13131313-1313-4131-8131-131313131313";
  const reviewRunId = "run-24242424-2424-4242-8242-242424242424";
  const transDir = path.join(root, ".spartan-bridge", "transitions", transitionId);
  await fs.mkdir(transDir, { recursive: true });
  const taskAbs = path.join(root, taskRel);
  await fs.writeFile(taskAbs, readyImplementationTask(taskRel), "utf8");
  const hash = sha256Bytes(new Uint8Array(await fs.readFile(taskAbs)));
  const reviewDir = path.join(root, ".spartan-bridge", "runs", reviewRunId);
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(
    path.join(reviewDir, "status.json"),
    `${JSON.stringify({
      schema_version: SCHEMA_VERSION,
      run_id: reviewRunId,
      state: "awaiting_implementer",
      review_kind: "implementation",
      verdict: "pass",
      reason_code: "review_passed",
      task_hash_after_write: hash,
    })}\n`,
    "utf8",
  );
  const status = {
    schema_version: SCHEMA_VERSION,
    document: "transition",
    transition_id: transitionId,
    state: "reviewing",
    parent_run_id: PLAN_ID,
    task_path: taskRel,
    approved_task_hash: null,
    policy_digest: null,
    implementer_host: null,
    implementer_launcher_id: null,
    lock_identity: null,
    reason_code: null,
    producer_diagnostic: null,
    unwritable_plan_targets: null,
    declaration_invalid_detail: null,
    current_review_run_id: reviewRunId,
    linked_review_run_ids: [reviewRunId],
    created_at: "2026-08-31T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:00.000Z",
  };
  await fs.writeFile(path.join(transDir, "status.json"), `${JSON.stringify(status)}\n`, "utf8");
  const eventLine = (sequence: number, type: string): string =>
    `${JSON.stringify({
      schema_version: SCHEMA_VERSION,
      sequence,
      timestamp: "2026-08-31T00:00:00.000Z",
      transition_id: transitionId,
      type,
      state: "reviewing",
      reason_code: null,
      producer_diagnostic: null,
      unwritable_plan_targets: null,
      declaration_invalid_detail: null,
      review_run_id: reviewRunId,
    })}\n`;
  await fs.writeFile(
    path.join(transDir, "events.jsonl"),
    [eventLine(1, "producer_finished"), eventLine(2, "implementation_review_dispatched"), eventLine(3, "implementation_review_result")].join(""),
    "utf8",
  );
  await fs.rm(taskAbs);
  const outcome = await advanceFromCheckpoint({
    repoRoot: root,
    repoArg: root,
    taskPath: taskRel,
    transition: { transitionDir: transDir, sequence: 3, status },
    deps: testDeps(),
    allowCorrection: false,
    parentRunId: PLAN_ID,
    planRunId: PLAN_ID,
  });
  assert.notEqual(outcome, null);
  if (outcome !== null && (outcome.kind === "review" || outcome.kind === "transition")) {
    assert.equal(outcome.transition?.state, "stopped");
    assert.equal(outcome.transition?.reason_code, "task_unreadable");
  }
  await fs.rm(root, { recursive: true, force: true });
});

test("advanceFromCheckpoint: unlinked non-terminal review run refuses linked_review_live", async () => {
  const { root: r0, taskRel } = await autoRepo();
  const root = await fs.realpath(r0);
  await writeBridgeConfig(root);
  const transitionId = "transition-abababab-abab-4aba-8aba-abababababab";
  const reviewRunId = "run-bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc";
  const transDir = path.join(root, ".spartan-bridge", "transitions", transitionId);
  await fs.mkdir(transDir, { recursive: true });
  const reviewDir = path.join(root, ".spartan-bridge", "runs", reviewRunId);
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(
    path.join(reviewDir, "status.json"),
    `${JSON.stringify({
      schema_version: SCHEMA_VERSION,
      run_id: reviewRunId,
      state: "reviewing",
      review_kind: "implementation",
      verdict: null,
      reason_code: null,
      transition_id: transitionId,
      updated_at: "2026-08-31T01:00:00.000Z",
    })}\n`,
    "utf8",
  );
  const status = {
    schema_version: SCHEMA_VERSION,
    document: "transition",
    transition_id: transitionId,
    state: "producer_finished",
    parent_run_id: PLAN_ID,
    task_path: taskRel,
    approved_task_hash: null,
    policy_digest: null,
    implementer_host: null,
    implementer_launcher_id: null,
    lock_identity: null,
    reason_code: null,
    producer_diagnostic: null,
    unwritable_plan_targets: null,
    declaration_invalid_detail: null,
    current_review_run_id: null,
    linked_review_run_ids: [],
    created_at: "2026-08-31T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:00.000Z",
  };
  await fs.writeFile(path.join(transDir, "status.json"), `${JSON.stringify(status)}\n`, "utf8");
  await fs.writeFile(
    path.join(transDir, "events.jsonl"),
    `${JSON.stringify({
      schema_version: SCHEMA_VERSION,
      sequence: 1,
      timestamp: "2026-08-31T00:00:00.000Z",
      transition_id: transitionId,
      type: "producer_finished",
      state: "producer_finished",
      reason_code: null,
      producer_diagnostic: null,
      unwritable_plan_targets: null,
      declaration_invalid_detail: null,
      review_run_id: null,
    })}\n`,
    "utf8",
  );
  const outcome = await advanceFromCheckpoint({
    repoRoot: root,
    repoArg: root,
    taskPath: taskRel,
    transition: { transitionDir: transDir, sequence: 1, status },
    deps: testDeps(),
    allowCorrection: false,
    parentRunId: PLAN_ID,
    planRunId: PLAN_ID,
  });
  assert.deepEqual(outcome, { kind: "refuse", reason: "linked_review_live" });
  await fs.rm(root, { recursive: true, force: true });
});

test("advanceFromCheckpoint: linked terminal run after correction_dispatched finalises without re-dispatch", async () => {
  const { root: r0, taskRel } = await autoRepo();
  const root = await fs.realpath(r0);
  await writeBridgeConfig(root);
  const transitionId = "transition-cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd";
  const priorReviewRunId = "run-dededede-dede-4ded-8ded-dededededede";
  const newReviewRunId = "run-efefefef-efef-4efe-8efe-efefefefefef";
  const transDir = path.join(root, ".spartan-bridge", "transitions", transitionId);
  await fs.mkdir(transDir, { recursive: true });
  const preCorrectionText = validTaskMd({
    taskType: "implementation",
    phase: "reviewing",
    role: "implementer",
    nextRole: "reviewer",
    reviewSection: `\n${DEFAULT_REVIEW_SECTION}`,
  });
  await fs.writeFile(path.join(root, taskRel), preCorrectionText, "utf8");
  const taskHashBeforeCorrection = sha256Bytes(new Uint8Array(await fs.readFile(path.join(root, taskRel))));
  await plantChainedImplementationParent(root, taskRel, priorReviewRunId, taskHashBeforeCorrection);
  await fs.writeFile(path.join(root, taskRel), readyImplementationTask(taskRel), "utf8");
  const newReviewDir = path.join(root, ".spartan-bridge", "runs", newReviewRunId);
  await fs.mkdir(newReviewDir, { recursive: true });
  await fs.writeFile(
    path.join(newReviewDir, "status.json"),
    `${JSON.stringify({
      schema_version: SCHEMA_VERSION,
      run_id: newReviewRunId,
      state: "awaiting_implementer",
      review_kind: "implementation",
      verdict: "pass",
      reason_code: "review_passed",
      task_hash_after_write: null,
      transition_id: transitionId,
      review_chain: { after_run_id: priorReviewRunId, cycle: 2, max_cycles: 3, refused: null },
      updated_at: "2026-08-31T01:00:00.000Z",
    })}\n`,
    "utf8",
  );
  const status = {
    schema_version: SCHEMA_VERSION,
    document: "transition",
    transition_id: transitionId,
    state: "producer_finished",
    parent_run_id: PLAN_ID,
    task_path: taskRel,
    approved_task_hash: null,
    policy_digest: null,
    implementer_host: null,
    implementer_launcher_id: null,
    lock_identity: null,
    reason_code: null,
    producer_diagnostic: null,
    unwritable_plan_targets: null,
    declaration_invalid_detail: null,
    current_review_run_id: newReviewRunId,
    linked_review_run_ids: [priorReviewRunId, newReviewRunId],
    created_at: "2026-08-31T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:00.000Z",
  };
  await fs.writeFile(path.join(transDir, "status.json"), `${JSON.stringify(status)}\n`, "utf8");
  const eventLine = (sequence: number, type: string, state: string, reviewRunId: string | null = null): string =>
    `${JSON.stringify({
      schema_version: SCHEMA_VERSION,
      sequence,
      timestamp: "2026-08-31T00:00:00.000Z",
      transition_id: transitionId,
      type,
      state,
      reason_code: null,
      producer_diagnostic: null,
      unwritable_plan_targets: null,
      declaration_invalid_detail: null,
      review_run_id: reviewRunId,
    })}\n`;
  await fs.writeFile(
    path.join(transDir, "events.jsonl"),
    [
      eventLine(1, "producer_finished", "producer_finished"),
      eventLine(2, "implementation_review_dispatched", "reviewing", priorReviewRunId),
      eventLine(3, "implementation_review_result", "reviewing", priorReviewRunId),
      eventLine(4, "correction_dispatched", "reviewing", priorReviewRunId),
      eventLine(5, "producer_started", "producer_running"),
      eventLine(6, "path_validated", "producer_finished"),
      eventLine(7, "producer_finished", "producer_finished"),
    ].join(""),
    "utf8",
  );
  let reviews = 0;
  const outcome = await advanceFromCheckpoint({
    repoRoot: root,
    repoArg: root,
    taskPath: taskRel,
    transition: { transitionDir: transDir, sequence: 7, status },
    deps: testDeps({
      createAdapter: () =>
        new FakeAdapter({
          result: () => {
            reviews += 1;
            return passResult("implementation");
          },
        }),
    }),
    allowCorrection: false,
    parentRunId: priorReviewRunId,
    planRunId: PLAN_ID,
    cycle: 2,
    maxCycles: 3,
  });
  assert.equal(reviews, 0);
  if (outcome !== null && (outcome.kind === "review" || outcome.kind === "transition")) {
    assert.equal(outcome.transition?.state, "completed");
  }
  await fs.rm(root, { recursive: true, force: true });
});

test("advanceFromCheckpoint: implementation_review_dispatched without a result covers D2 row 2", async () => {
  const dispatchedEvent = (
    transitionId: string,
    reviewRunId: string | null,
  ): string =>
    [
      `${JSON.stringify({
        schema_version: SCHEMA_VERSION,
        sequence: 1,
        timestamp: "2026-08-31T00:00:00.000Z",
        transition_id: transitionId,
        type: "producer_finished",
        state: "producer_finished",
        reason_code: null,
        producer_diagnostic: null,
        unwritable_plan_targets: null,
        declaration_invalid_detail: null,
        review_run_id: null,
      })}\n`,
      `${JSON.stringify({
        schema_version: SCHEMA_VERSION,
        sequence: 2,
        timestamp: "2026-08-31T00:00:00.000Z",
        transition_id: transitionId,
        type: "implementation_review_dispatched",
        state: "reviewing",
        reason_code: null,
        producer_diagnostic: null,
        unwritable_plan_targets: null,
        declaration_invalid_detail: null,
        review_run_id: reviewRunId,
      })}\n`,
    ].join("");

  for (const label of ["review_not_terminal", "invalid_run_id", "missing_status", "finalise_missing_result"] as const) {
    const { root: r0, taskRel } = await autoRepo();
    const root = await fs.realpath(r0);
    await writeBridgeConfig(root);
    const transitionId = "transition-d2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2";
    const reviewRunId = "run-d2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2";
    const transDir = path.join(root, ".spartan-bridge", "transitions", transitionId);
    await fs.mkdir(transDir, { recursive: true });
    const eventRunId = label === "invalid_run_id" ? "not-a-run-id" : reviewRunId;
    const status = {
      schema_version: SCHEMA_VERSION,
      document: "transition",
      transition_id: transitionId,
      state: "reviewing",
      parent_run_id: PLAN_ID,
      task_path: taskRel,
      approved_task_hash: null,
      policy_digest: null,
      implementer_host: null,
      implementer_launcher_id: null,
      lock_identity: null,
      reason_code: null,
      producer_diagnostic: null,
      unwritable_plan_targets: null,
      declaration_invalid_detail: null,
      current_review_run_id: label === "invalid_run_id" ? null : reviewRunId,
      linked_review_run_ids: label === "invalid_run_id" ? [] : [reviewRunId],
      created_at: "2026-08-31T00:00:00.000Z",
      updated_at: "2026-08-31T00:00:00.000Z",
    };
    await fs.writeFile(path.join(transDir, "status.json"), `${JSON.stringify(status)}\n`, "utf8");
    await fs.writeFile(path.join(transDir, "events.jsonl"), dispatchedEvent(transitionId, eventRunId), "utf8");
    if (label === "review_not_terminal") {
      const reviewDir = path.join(root, ".spartan-bridge", "runs", reviewRunId);
      await fs.mkdir(reviewDir, { recursive: true });
      await fs.writeFile(
        path.join(reviewDir, "status.json"),
        `${JSON.stringify({
          schema_version: SCHEMA_VERSION,
          run_id: reviewRunId,
          state: "reviewing",
          review_kind: "implementation",
          verdict: null,
          reason_code: null,
        })}\n`,
        "utf8",
      );
    } else if (label === "finalise_missing_result") {
      const reviewDir = path.join(root, ".spartan-bridge", "runs", reviewRunId);
      await fs.mkdir(reviewDir, { recursive: true });
      await fs.writeFile(
        path.join(reviewDir, "status.json"),
        `${JSON.stringify({
          schema_version: SCHEMA_VERSION,
          run_id: reviewRunId,
          state: "awaiting_implementer",
          review_kind: "implementation",
          verdict: "pass",
          reason_code: "review_passed",
          task_hash_after_write: null,
        })}\n`,
        "utf8",
      );
    }
    let reviews = 0;
    const outcome = await advanceFromCheckpoint({
      repoRoot: root,
      repoArg: root,
      taskPath: taskRel,
      transition: { transitionDir: transDir, sequence: 2, status },
      deps: testDeps({
        createAdapter: () =>
          new FakeAdapter({
            result: () => {
              reviews += 1;
              return passResult("implementation");
            },
          }),
      }),
      allowCorrection: false,
      parentRunId: PLAN_ID,
      planRunId: PLAN_ID,
    });
    assert.equal(reviews, 0, label);
    if (label === "review_not_terminal") {
      assert.deepEqual(outcome, { kind: "refuse", reason: "review_not_terminal" }, label);
    } else if (label === "invalid_run_id" || label === "missing_status") {
      assert.notEqual(outcome, null, label);
      assert.equal(outcome && "kind" in outcome ? outcome.kind : null, "transition", label);
      if (outcome !== null && outcome.kind === "transition") {
        assert.equal(outcome.transition?.reason_code, "adapter_error", label);
        assert.equal(outcome.exitCode, 1, label);
      }
    } else {
      assert.notEqual(outcome, null, label);
      if (outcome !== null && outcome.kind === "review") {
        assert.equal(outcome.transition?.state, "completed", label);
        assert.equal(outcome.exitCode, 0, label);
      }
      const events = (await fs.readFile(path.join(transDir, "events.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { type: string; review_run_id: string | null });
      assert.equal(
        events.filter((event) => event.type === "implementation_review_dispatched").length,
        1,
        label,
      );
      assert.equal(
        events.filter((event) => event.type === "implementation_review_result" && event.review_run_id === reviewRunId)
          .length,
        1,
        label,
      );
      assert.equal(events.at(-1)?.type, "terminal_stop", label);
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resolveAdvanceChainFromEvents: no correction history yields unchained parentRunId", async () => {
  const { root: r0 } = await autoRepo();
  const root = await fs.realpath(r0);
  const transitionId = "transition-fafafafa-fafa-4afa-8afa-fafafafafafa";
  const events: TransitionEventDocument[] = [
    {
      schema_version: SCHEMA_VERSION,
      sequence: 1,
      timestamp: "2026-08-31T00:00:00.000Z",
      transition_id: transitionId,
      type: "producer_finished",
      state: "producer_finished",
      reason_code: null,
      producer_diagnostic: null,
      unwritable_plan_targets: null,
      declaration_invalid_detail: null,
      review_run_id: null,
    },
  ];
  const transition = {
    schema_version: SCHEMA_VERSION,
    document: "transition" as const,
    transition_id: transitionId,
    state: "producer_finished" as const,
    parent_run_id: PLAN_ID,
    task_path: "spartan/tasks/0001.md",
    approved_task_hash: null,
    policy_digest: null,
    implementer_host: null,
    implementer_launcher_id: null,
    lock_identity: null,
    reason_code: null,
    producer_diagnostic: null,
    unwritable_plan_targets: null,
    declaration_invalid_detail: null,
    current_review_run_id: null,
    linked_review_run_ids: [],
    created_at: "2026-08-31T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:00.000Z",
  };
  const chain = await resolveAdvanceChainFromEvents(root, transition, events);
  assert.equal(chain.parentRunId, PLAN_ID);
  assert.equal(chain.planRunId, PLAN_ID);
  assert.equal(chain.cycle, 1);
  await fs.rm(root, { recursive: true, force: true });
});

test("resolveAdvanceChainFromEvents: post-correction history chains from the prior review run", async () => {
  const { root: r0, taskRel } = await autoRepo();
  const root = await fs.realpath(r0);
  const transitionId = "transition-fbfbfbfb-fbfb-4bfb-8bfb-fbfbfbfbfbfb";
  const priorReviewRunId = "run-fcfcfcfc-fcfc-4cfc-8cfc-fcfcfcfcfcfc";
  const preCorrectionText = validTaskMd({
    taskType: "implementation",
    phase: "reviewing",
    role: "implementer",
    nextRole: "reviewer",
    reviewSection: `\n${DEFAULT_REVIEW_SECTION}`,
  });
  await fs.writeFile(path.join(root, taskRel), preCorrectionText, "utf8");
  const taskHashBeforeCorrection = sha256Bytes(new Uint8Array(await fs.readFile(path.join(root, taskRel))));
  await plantChainedImplementationParent(root, taskRel, priorReviewRunId, taskHashBeforeCorrection);
  const events: TransitionEventDocument[] = [
    {
      schema_version: SCHEMA_VERSION,
      sequence: 1,
      timestamp: "2026-08-31T00:00:00.000Z",
      transition_id: transitionId,
      type: "producer_finished",
      state: "producer_finished",
      reason_code: null,
      producer_diagnostic: null,
      unwritable_plan_targets: null,
      declaration_invalid_detail: null,
      review_run_id: null,
    },
    {
      schema_version: SCHEMA_VERSION,
      sequence: 2,
      timestamp: "2026-08-31T00:00:00.000Z",
      transition_id: transitionId,
      type: "implementation_review_dispatched",
      state: "reviewing",
      reason_code: null,
      producer_diagnostic: null,
      unwritable_plan_targets: null,
      declaration_invalid_detail: null,
      review_run_id: priorReviewRunId,
    },
    {
      schema_version: SCHEMA_VERSION,
      sequence: 3,
      timestamp: "2026-08-31T00:00:00.000Z",
      transition_id: transitionId,
      type: "implementation_review_result",
      state: "reviewing",
      reason_code: null,
      producer_diagnostic: null,
      unwritable_plan_targets: null,
      declaration_invalid_detail: null,
      review_run_id: priorReviewRunId,
    },
    {
      schema_version: SCHEMA_VERSION,
      sequence: 4,
      timestamp: "2026-08-31T00:00:00.000Z",
      transition_id: transitionId,
      type: "correction_dispatched",
      state: "reviewing",
      reason_code: null,
      producer_diagnostic: null,
      unwritable_plan_targets: null,
      declaration_invalid_detail: null,
      review_run_id: priorReviewRunId,
    },
    {
      schema_version: SCHEMA_VERSION,
      sequence: 5,
      timestamp: "2026-08-31T00:00:00.000Z",
      transition_id: transitionId,
      type: "producer_finished",
      state: "producer_finished",
      reason_code: null,
      producer_diagnostic: null,
      unwritable_plan_targets: null,
      declaration_invalid_detail: null,
      review_run_id: null,
    },
  ];
  const transition = {
    schema_version: SCHEMA_VERSION,
    document: "transition" as const,
    transition_id: transitionId,
    state: "producer_finished" as const,
    parent_run_id: PLAN_ID,
    task_path: taskRel,
    approved_task_hash: null,
    policy_digest: null,
    implementer_host: null,
    implementer_launcher_id: null,
    lock_identity: null,
    reason_code: null,
    producer_diagnostic: null,
    unwritable_plan_targets: null,
    declaration_invalid_detail: null,
    current_review_run_id: priorReviewRunId,
    linked_review_run_ids: [priorReviewRunId],
    created_at: "2026-08-31T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:00.000Z",
  };
  const chain = await resolveAdvanceChainFromEvents(root, transition, events);
  assert.equal(chain.parentRunId, priorReviewRunId);
  assert.equal(chain.planRunId, PLAN_ID);
  assert.equal(chain.cycle, 2);
  await fs.rm(root, { recursive: true, force: true });
});
