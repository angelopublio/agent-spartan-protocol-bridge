import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PRODUCER_ISOLATED_WORKSPACE_ENV, capabilitiesAllowed, producerCapabilitiesAllowed } from "../src/adapters/adapter.ts";
import {
  CODEX_EXECUTABLE,
  CODEX_IMPLEMENTATION_REVIEW_PROMPT,
  CODEX_OUTPUT_SCHEMA,
  CODEX_REVIEW_PROMPT,
  CODEX_SCHEMA_FILE,
  CodexAdapter,
  codexCapabilities,
  codexOutputSchema,
} from "../src/adapters/codex.ts";
import { CURSOR_EXECUTABLE, cursorCapabilities, cursorProducerCapabilities } from "../src/adapters/cursor.ts";
import { grokCapabilities } from "../src/adapters/grok.ts";
import { FakeAdapter, fakeCapabilities, fakeProducerCapabilities } from "../src/adapters/fake.ts";
import type { ProcessRunner } from "../src/adapters/process.ts";
import {
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  type AdapterReviewInput,
  type ReviewKind,
} from "../src/core/contracts.ts";
import { runReview } from "../src/core/review.ts";
import { validateReviewResult } from "../src/core/result.ts";
import {
  REGION_BYTE_CAP,
  REVIEW_BEGIN,
  REVIEW_END,
  REVIEW_IMPLEMENTATION_BEGIN,
  REVIEW_IMPLEMENTATION_END,
  REVIEW_PLAN_BEGIN,
  REVIEW_PLAN_END,
  preservedAuthorizedBytes,
  renderRegion,
  spliceRegion,
} from "../src/core/task-write.ts";
import { GIT_EXECUTABLE, ReviewerIsolationUnavailableError, cleanupReviewWorkspace } from "../src/core/workspace.ts";
import {
  IMPLEMENTATION_REVIEW_GRANT,
  IMPLEMENTATION_REVIEW_PROHIBITION,
  implementationProducerIdentity,
  implementationReviewAdmission,
  parseAgentsPolicy,
} from "../src/policy/agents-policy.ts";
import { parseTaskFrontmatter, parseTaskFrontmatterDocument } from "../src/policy/task-frontmatter.ts";
import { WORKSPACE_MANIFEST_FILE } from "../src/runtime/store.ts";
import {
  CountingAdapter,
  DEFAULT_REVIEW_SECTION,
  changesResult,
  constantSource,
  eventTypes,
  implementationTaskMd,
  loadRun,
  makeRepo,
  passResult,
  testClock,
  testDeps,
  validAgentsMd,
  validTaskMd,
  VALID_REGISTRY,
} from "./helpers.ts";

const IN_PRODUCER_WORKSPACE = process.env[PRODUCER_ISOLATED_WORKSPACE_ENV] === "1";

async function repositoryAgentsPolicy(): Promise<string> {
  return fs.readFile(new URL("../AGENTS.md", import.meta.url), "utf8");
}

const RUN_A = "run-aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const RUN_B = "run-bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const RUN_C = "run-ccccccc3-cccc-4ccc-8ccc-ccccccccccc3";
const RUN_D = "run-ddddddd4-dddd-4ddd-8ddd-ddddddddddd4";
const FIXTURE_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  ...(typeof process.env.HOME === "string" ? { HOME: process.env.HOME } : {}),
  ...(typeof process.env.TMPDIR === "string" ? { TMPDIR: process.env.TMPDIR } : {}),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

function implAgents(
  options?: Parameters<typeof validAgentsMd>[0],
): string {
  return validAgentsMd({
    implementationGrant: true,
    taskWrite: true,
    producerChain: true,
    ...options,
  });
}

function implTask(options?: Parameters<typeof implementationTaskMd>[0]): string {
  return implementationTaskMd({
    reviewSection: `\n${DEFAULT_REVIEW_SECTION}`,
    ...options,
  });
}

function planOnlyCaps() {
  return { ...fakeCapabilities(), review_kinds: ["plan"] as string[] };
}

function implementationOnlyCaps() {
  return { ...fakeCapabilities(), review_kinds: ["implementation"] as string[] };
}

function fakeReviewer(writeLastMessage?: string): ProcessRunner {
  return {
    start(request) {
      if (request.args.includes("--help")) {
        return {
          wait: async () => ({
            exitCode: 0,
            stdout: Buffer.from("--sandbox --cd --config --skip-git-repo-check --ephemeral --output-schema --output-last-message --json --color\n"),
            stderr: Buffer.alloc(0),
            timedOut: false,
            stdoutOverflow: false,
          }),
          cancel: async () => undefined,
        };
      }
      const lastIndex = request.args.indexOf("--output-last-message");
      const lastPath = lastIndex >= 0 ? request.args[lastIndex + 1] : undefined;
      return {
        wait: async () => {
          if (lastPath !== undefined && writeLastMessage !== undefined) {
            await fs.writeFile(lastPath, writeLastMessage);
          }
          return {
            exitCode: 0,
            stdout: Buffer.alloc(0),
            stderr: Buffer.alloc(0),
            timedOut: false,
            stdoutOverflow: false,
          };
        },
        cancel: async () => undefined,
      };
    },
  };
}

function adapterInput(
  root: string,
  taskRel: string,
  runDir: string,
  kind: ReviewKind,
  scope: readonly string[] = ["src/", "README.md"],
): AdapterReviewInput {
  return {
    execution_id: "exec-1",
    review_kind: kind,
    permission_mode: "read-only",
    repo_root: root,
    run_dir: runDir,
    task_path: taskRel,
    task_content: "task",
    task_hash: "sha256:task",
    agents_content: "agents",
    agents_hash: "sha256:agents",
    policy_digest: "sha256:policy",
    model: "gpt-5.6-terra",
    effort: "high",
    implementation_review_scope: scope,
  };
}

async function repoGit(cwd: string, args: readonly string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(GIT_EXECUTABLE, [...args], {
      cwd,
      env: FIXTURE_ENV,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    const chunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`git ${args.join(" ")} exited ${code}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

async function makeGitRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-impl-repo-"));
  await repoGit(root, ["init", "-b", "main", "-q"]);
  await repoGit(root, ["config", "user.email", "t@t.invalid"]);
  await repoGit(root, ["config", "user.name", "t"]);
  await repoGit(root, ["config", "core.autocrlf", "false"]);
  return root;
}

async function writeRel(root: string, rel: string, contents: string | Uint8Array): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, contents);
}

async function commitAll(root: string, message: string): Promise<void> {
  await repoGit(root, ["add", "-A"]);
  await repoGit(root, ["commit", "-qm", message, "--allow-empty"]);
}

async function removeRun(runDir: string): Promise<void> {
  await cleanupReviewWorkspace(runDir).catch(() => undefined);
  await fs.rm(runDir, { recursive: true, force: true });
}

function changeLine(status: string, posix: string): string {
  return `${status}\t${JSON.stringify(posix)}\n`;
}

function worktreeAbs(workspaceRoot: string, rel: string): string {
  return path.join(workspaceRoot, "worktree", ...rel.split("/"));
}

async function restoreNextRole(root: string, taskRel: string): Promise<void> {
  const abs = path.join(root, taskRel);
  const text = await fs.readFile(abs, "utf8");
  await fs.writeFile(abs, `${text.replace(/^next_role: .+$/m, "next_role: reviewer")}\nrevision\n`, "utf8");
}

test("SCHEMA_VERSION stays 2 and PROTOCOL_VERSION is 0.7.0", () => {
  assert.equal(SCHEMA_VERSION, 2);
  assert.equal(PROTOCOL_VERSION, "0.7.0");
});

test("D3 capabilitiesAllowed accepts each kind list and refuses empty, duplicate, and unknown members", () => {
  const base = fakeCapabilities();
  assert.equal(capabilitiesAllowed({ ...base, review_kinds: ["plan"] }), true);
  assert.equal(capabilitiesAllowed({ ...base, review_kinds: ["implementation"] }), true);
  assert.equal(capabilitiesAllowed({ ...base, review_kinds: ["plan", "implementation"] }), true);
  assert.equal(capabilitiesAllowed({ ...base, review_kinds: [] }), false);
  assert.equal(capabilitiesAllowed({ ...base, review_kinds: ["plan", "plan"] }), false);
  assert.equal(capabilitiesAllowed({ ...base, review_kinds: ["plan", "other"] }), false);
  assert.equal(producerCapabilitiesAllowed(fakeProducerCapabilities()), true);
  assert.equal(producerCapabilitiesAllowed(cursorProducerCapabilities()), true);
  assert.equal(producerCapabilitiesAllowed({ ...fakeProducerCapabilities(), isolated_producer_workspace: false }), false);
  assert.equal(producerCapabilitiesAllowed({ ...fakeProducerCapabilities(), workspace_write: false }), false);
  assert.equal(producerCapabilitiesAllowed({ ...fakeProducerCapabilities(), roles: ["planner"] as never }), false);
});

test("D3 production declarations are exact and ordered", () => {
  assert.deepEqual(codexCapabilities().review_kinds, ["plan", "implementation"]);
  assert.deepEqual(fakeCapabilities().review_kinds, ["plan", "implementation"]);
  assert.deepEqual(cursorCapabilities().review_kinds, ["plan", "implementation"]);
  assert.deepEqual(grokCapabilities().review_kinds, ["plan", "implementation"]);
});

test("D3 kind support is checked before preflight", async () => {
  const impl = await makeRepo({ agents: implAgents(), task: implTask() });
  const implCounting = new CountingAdapter(new FakeAdapter(constantSource(passResult("implementation")), planOnlyCaps()));
  const implOutcome = await runReview(
    { repo: impl.root, task: impl.taskRel },
    testDeps({ clock: testClock(RUN_A), createAdapter: () => implCounting }),
  );
  assert.equal(implOutcome.status?.reason_code, "capability_denied");
  assert.equal(implCounting.preflightCount, 0);
  assert.equal(implCounting.prepareCount, 0);
  assert.equal(implCounting.startCount, 0);
  await fs.rm(impl.root, { recursive: true, force: true });

  const plan = await makeRepo();
  const planCounting = new CountingAdapter(new FakeAdapter(constantSource(passResult()), implementationOnlyCaps()));
  const planOutcome = await runReview(
    { repo: plan.root, task: plan.taskRel },
    testDeps({ clock: testClock(RUN_A), createAdapter: () => planCounting }),
  );
  assert.equal(planOutcome.status?.reason_code, "capability_denied");
  assert.equal(planCounting.preflightCount, 0);
  assert.equal(planCounting.prepareCount, 0);
  assert.equal(planCounting.startCount, 0);
  await fs.rm(plan.root, { recursive: true, force: true });
});

test("D3 review.ts keeps one lifecycle and passes kind on AdapterReviewInput", async () => {
  const source = await fs.readFile(new URL("../src/core/review.ts", import.meta.url), "utf8");
  assert.equal((source.match(/export async function runReview/g) ?? []).length, 1);
  assert.equal((source.match(/async function runReview/g) ?? []).length, 1);
  assert.match(source, /const adapterInput: AdapterReviewInput/);
  assert.match(source, /review_kind: reviewKind/);
  assert.doesNotMatch(source, /async function runImplementationReview/);
  assert.equal((source.match(/validateReviewResult\(/g) ?? []).length, 1);
});

test("D4 implementation reviewing with a non-reviewer next_role is task_invalid at dispatch", async () => {
  for (const nextRole of ["implementer", "human-operator", "verifier"] as const) {
    const { root, taskRel } = await makeRepo({
      agents: implAgents(),
      task: implTask({ nextRole }),
    });
    let created = 0;
    const outcome = await runReview(
      { repo: root, task: taskRel },
      testDeps({
        clock: testClock(RUN_A),
        createAdapter: () => {
          created += 1;
          return new FakeAdapter(constantSource(passResult("implementation")));
        },
      }),
    );
    assert.equal(outcome.status?.reason_code, "task_invalid", nextRole);
    assert.equal(created, 0, nextRole);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("D4 missing reviewer.implementation fails only implementation review", async () => {
  const missing = await makeRepo({
    agents: implAgents({ omitImplementationRow: true }),
    task: implTask(),
  });
  let created = 0;
  const implOutcome = await runReview(
    { repo: missing.root, task: missing.taskRel },
    testDeps({
      clock: testClock(RUN_A),
      createAdapter: () => {
        created += 1;
        return new FakeAdapter(constantSource(passResult("implementation")));
      },
    }),
  );
  assert.equal(implOutcome.status?.reason_code, "reviewer_binding_missing");
  const admission = implementationReviewAdmission(parseAgentsPolicy(implAgents({ omitImplementationRow: true })) as Extract<ReturnType<typeof parseAgentsPolicy>, { ok: true }>);
  assert.equal(admission.ok, false);
  if (!admission.ok) {
    assert.equal(admission.detail.check, "reviewer_implementation_row_missing");
  }
  assert.equal(created, 0);
  await fs.rm(missing.root, { recursive: true, force: true });

  const plan = await makeRepo({ agents: validAgentsMd({ omitImplementationRow: true }) });
  const planOutcome = await runReview(
    { repo: plan.root, task: plan.taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_B) }),
  );
  assert.equal(planOutcome.status?.reason_code, "review_passed");
  await fs.rm(plan.root, { recursive: true, force: true });
});

test("D4 phase implementing is task_invalid and starts no reviewer", async () => {
  const { root, taskRel } = await makeRepo({
    agents: implAgents(),
    task: implTask({ phase: "implementing", nextRole: "implementer" }),
  });
  let created = 0;
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({
      clock: testClock(RUN_A),
      createAdapter: () => {
        created += 1;
        return new FakeAdapter(constantSource(passResult("implementation")));
      },
    }),
  );
  assert.equal(outcome.status?.reason_code, "task_invalid");
  assert.equal(created, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test("D6 grant sentence is pinned and the automatic-implementer prohibition is absent; first half is not enough", { skip: IN_PRODUCER_WORKSPACE }, async () => {
  const agents = await repositoryAgentsPolicy();
  assert.equal(agents.includes(`- ${IMPLEMENTATION_REVIEW_GRANT}`), true);
  assert.equal(agents.includes(`- ${IMPLEMENTATION_REVIEW_PROHIBITION}`), false);
  assert.equal(agents.includes("The Bridge may not start an implementer round automatically"), false);
  assert.equal(agents.includes("The Bridge may not start implementation automatically unless this file is amended"), false);
  assert.match(IMPLEMENTATION_REVIEW_GRANT, /excluding only `\.git` metadata/);
  assert.match(IMPLEMENTATION_REVIEW_GRANT, /repository ignore rules do not classify or remove files/);
  assert.match(IMPLEMENTATION_REVIEW_GRANT, /ancestor directories are created only as containers for admitted files/);
  assert.match(IMPLEMENTATION_REVIEW_GRANT, /no repository file path outside that scope/);
  assert.doesNotMatch(IMPLEMENTATION_REVIEW_GRANT, /\.env|\.npmrc|credentials\.json|denial list/);
  const firstHalf = IMPLEMENTATION_REVIEW_GRANT.slice(0, IMPLEMENTATION_REVIEW_GRANT.indexOf(" That reviewer"));
  const half = validAgentsMd().replace(
    "- The human starts each producer phase.",
    `- ${firstHalf}\n- The human starts each producer phase.`,
  );
  const parsed = parseAgentsPolicy(half);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.implementation_review_authorized, false);
  }
});

test("D6 repo scope entries decode without backticks", { skip: IN_PRODUCER_WORKSPACE }, async () => {
  const agents = await repositoryAgentsPolicy();
  const parsed = parseAgentsPolicy(agents);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.implementation_review_scope, [
      "src/",
      "tests/",
      "docs/",
      "skills/",
      "agent-skill/skills/spbridge/SKILL.md",
      "spartan/",
      "README.md",
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "AGENTS.md",
      "spartan-bridge/config.yaml",
    ]);
  }
});

test("D6 missing grant or invalid scope refuses implementation review before adapter construction", async () => {
  const cases: { name: string; agents: string; check: string }[] = [
    { name: "missing grant", agents: validAgentsMd({ taskWrite: true }), check: "implementation_review_grant" },
    { name: "missing heading", agents: validAgentsMd({ implementationGrant: true, implementationScope: "missing", taskWrite: true }), check: "implementation_review_scope_invalid" },
    { name: "empty heading", agents: validAgentsMd({ implementationGrant: true, implementationScope: "empty", taskWrite: true }), check: "implementation_review_scope_invalid" },
    { name: "absolute", agents: validAgentsMd({ implementationGrant: true, implementationScope: ["/tmp/src/", "src/"], taskWrite: true }), check: "implementation_review_scope_invalid" },
    { name: "tilde", agents: validAgentsMd({ implementationGrant: true, implementationScope: ["~/src/", "src/"], taskWrite: true }), check: "implementation_review_scope_invalid" },
    { name: "dot-dot", agents: validAgentsMd({ implementationGrant: true, implementationScope: ["src/../etc", "src/"], taskWrite: true }), check: "implementation_review_scope_invalid" },
    { name: "glob", agents: validAgentsMd({ implementationGrant: true, implementationScope: ["src/*.ts", "src/"], taskWrite: true }), check: "implementation_review_scope_invalid" },
    { name: "negation", agents: validAgentsMd({ implementationGrant: true, implementationScope: ["!src/", "src/"], taskWrite: true }), check: "implementation_review_scope_invalid" },
    { name: "regex", agents: validAgentsMd({ implementationGrant: true, implementationScope: ["src/(a|b)", "src/"], taskWrite: true }), check: "implementation_review_scope_invalid" },
    { name: "prose", agents: validAgentsMd({ implementationGrant: true, implementationScope: ["src/"], taskWrite: true }).replace("- `src/`\n", "- `src/` extra\n"), check: "implementation_review_scope_invalid" },
  ];
  for (const testCase of cases) {
    const parsed = parseAgentsPolicy(testCase.agents);
    assert.equal(parsed.ok, true, testCase.name);
    if (parsed.ok) {
      const admission = implementationReviewAdmission(parsed);
      assert.equal(admission.ok, false, testCase.name);
      if (!admission.ok) {
        assert.equal(admission.detail.check, testCase.check, testCase.name);
      }
    }
    const { root, taskRel } = await makeRepo({ agents: testCase.agents, task: implTask() });
    let created = 0;
    const outcome = await runReview(
      { repo: root, task: taskRel },
      testDeps({
        clock: testClock(RUN_A),
        createAdapter: () => {
          created += 1;
          return new FakeAdapter(constantSource(passResult("implementation")));
        },
      }),
    );
    assert.equal(outcome.status?.reason_code, "automatic_review_not_authorized", testCase.name);
    assert.equal(created, 0, testCase.name);
    const planRepo = await makeRepo({
      agents: testCase.agents,
      task: validTaskMd({ reviewSection: `\n${DEFAULT_REVIEW_SECTION}` }),
    });
    const planOutcome = await runReview(
      { repo: planRepo.root, task: planRepo.taskRel },
      testDeps({ source: constantSource(passResult()), clock: testClock(RUN_B) }),
    );
    assert.equal(planOutcome.status?.reason_code, "review_passed", testCase.name);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(planRepo.root, { recursive: true, force: true });
  }
});

test("D6 grant does not read the task body for check outcomes", async () => {
  const source = await fs.readFile(new URL("../src/core/review.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /npm test|typecheck|check outcomes/);
  const { root, taskRel } = await makeRepo({
    agents: implAgents(),
    task: implTask(),
  });
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({
      source: constantSource(passResult("implementation")),
      clock: testClock(RUN_A),
    }),
  );
  assert.equal(outcome.status?.reason_code, "review_passed");
  await fs.rm(root, { recursive: true, force: true });
});

test("D7 implementation pass and changes_requested write the mapped next_role; plan mapping is unchanged", async () => {
  const passRepo = await makeRepo({ agents: implAgents(), task: implTask() });
  const passOutcome = await runReview(
    { repo: passRepo.root, task: passRepo.taskRel },
    testDeps({ source: constantSource(passResult("implementation")), clock: testClock(RUN_A) }),
  );
  assert.equal(passOutcome.status?.reason_code, "review_passed");
  assert.equal(passOutcome.status?.review_chain?.cycle, 1);
  const passText = await fs.readFile(path.join(passRepo.root, passRepo.taskRel), "utf8");
  assert.match(passText, /^next_role: human-operator$/m);
  assert.match(passText, new RegExp(REVIEW_IMPLEMENTATION_BEGIN));
  await fs.rm(passRepo.root, { recursive: true, force: true });

  const changesRepo = await makeRepo({ agents: implAgents(), task: implTask() });
  const changesOutcome = await runReview(
    { repo: changesRepo.root, task: changesRepo.taskRel },
    testDeps({ source: constantSource(changesResult("implementation")), clock: testClock(RUN_B) }),
  );
  assert.equal(changesOutcome.status?.reason_code, "review_changes_requested");
  const changesText = await fs.readFile(path.join(changesRepo.root, changesRepo.taskRel), "utf8");
  assert.match(changesText, /^next_role: implementer$/m);
  await fs.rm(changesRepo.root, { recursive: true, force: true });

  const planRepo = await makeRepo({ agents: validAgentsMd({ taskWrite: true }), task: validTaskMd({ reviewSection: `\n${DEFAULT_REVIEW_SECTION}` }) });
  const planPass = await runReview(
    { repo: planRepo.root, task: planRepo.taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_C) }),
  );
  assert.equal(planPass.status?.reason_code, "review_passed");
  const planText = await fs.readFile(path.join(planRepo.root, planRepo.taskRel), "utf8");
  assert.match(planText, /^next_role: implementer$/m);
  await fs.rm(planRepo.root, { recursive: true, force: true });
});

test("D4 post-write grammar check is not review admission", async () => {
  const cases: { label: string; source: ReturnType<typeof constantSource>; nextRole: string }[] = [
    { label: "pass", source: constantSource(passResult("implementation")), nextRole: "human-operator" },
    { label: "changes_requested", source: constantSource(changesResult("implementation")), nextRole: "implementer" },
  ];
  for (const testCase of cases) {
    const { root, taskRel } = await makeRepo({ agents: implAgents(), task: implTask() });
    const outcome = await runReview(
      { repo: root, task: taskRel },
      testDeps({ source: testCase.source, clock: testClock(RUN_A) }),
    );
    assert.equal(outcome.status?.task_write_state, "written", testCase.label);
    const taskAbs = path.join(root, taskRel);
    const written = new Uint8Array(await fs.readFile(taskAbs));
    const filename = path.basename(taskRel);
    assert.match(Buffer.from(written).toString("utf8"), new RegExp(`^next_role: ${testCase.nextRole}$`, "m"), testCase.label);
    parseTaskFrontmatterDocument(written, filename);
    assert.throws(() => parseTaskFrontmatter(written, filename), { message: "task_invalid" }, testCase.label);
    let created = 0;
    const redispatched = await runReview(
      { repo: root, task: taskRel },
      testDeps({
        clock: testClock(RUN_B),
        createAdapter: () => {
          created += 1;
          return new FakeAdapter(constantSource(passResult("implementation")));
        },
      }),
    );
    assert.equal(redispatched.status?.reason_code, "task_invalid", testCase.label);
    assert.equal(created, 0, testCase.label);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("D7 after-run reaches a second implementation review at cycle 2", async () => {
  const { root, taskRel } = await makeRepo({ agents: implAgents(), task: implTask() });
  const first = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(changesResult("implementation")), clock: testClock(RUN_A) }),
  );
  assert.equal(first.status?.run_id, RUN_A);
  assert.equal(first.status?.review_chain?.cycle, 1);
  assert.deepEqual(first.status?.producer_identity, { role: "implementer", host: "cursor" });
  await restoreNextRole(root, taskRel);
  const second = await runReview(
    { repo: root, task: taskRel, after_run: RUN_A },
    testDeps({ source: constantSource(passResult("implementation")), clock: testClock(RUN_B) }),
  );
  assert.equal(second.status?.run_id, RUN_B);
  assert.equal(second.status?.review_kind, "implementation");
  assert.equal(second.status?.review_chain?.cycle, 2);
  assert.equal(second.status?.review_chain?.after_run_id, RUN_A);
  await fs.rm(root, { recursive: true, force: true });
});

test("D7 chain stops on reviewer host mismatch", async () => {
  const { root, taskRel } = await makeRepo({
    agents: implAgents({ host: "Codex", model: "gpt-5.6-terra", effort: "high" }),
    task: implTask(),
  });
  const first = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(changesResult("implementation")), clock: testClock(RUN_A) }),
  );
  assert.equal(first.status?.host, "codex");
  assert.deepEqual(first.status?.producer_identity, { role: "implementer", host: "cursor" });
  await restoreNextRole(root, taskRel);
  await fs.writeFile(path.join(root, "AGENTS.md"), implAgents({ host: "Cursor", model: "Composer-2.5", effort: "none" }), "utf8");
  let created = 0;
  const second = await runReview(
    { repo: root, task: taskRel, after_run: RUN_A },
    testDeps({
      clock: testClock(RUN_B),
      createAdapter: () => {
        created += 1;
        return new FakeAdapter(constantSource(passResult("implementation")));
      },
    }),
  );
  assert.equal(second.status?.reason_code, "chain_refused");
  assert.equal(second.status?.review_chain?.refused, "not_authorized");
  assert.equal(created, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test("D7 chain stops on implementer producer host mismatch before adapter construction", async () => {
  const { root, taskRel } = await makeRepo({
    agents: implAgents({ implementerHost: "Cursor" }),
    task: implTask(),
  });
  const first = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(changesResult("implementation")), clock: testClock(RUN_A) }),
  );
  assert.equal(first.status?.host, "cursor");
  assert.deepEqual(first.status?.producer_identity, { role: "implementer", host: "cursor" });
  await restoreNextRole(root, taskRel);
  await fs.writeFile(path.join(root, "AGENTS.md"), implAgents({ implementerHost: "Codex" }), "utf8");
  let created = 0;
  const second = await runReview(
    { repo: root, task: taskRel, after_run: RUN_A },
    testDeps({
      clock: testClock(RUN_B),
      createAdapter: () => {
        created += 1;
        return new FakeAdapter(constantSource(passResult("implementation")));
      },
    }),
  );
  assert.equal(second.status?.reason_code, "chain_refused");
  assert.equal(second.status?.review_chain?.refused, "not_authorized");
  assert.notEqual(second.status?.review_chain?.refused, "agents_changed");
  assert.deepEqual(second.status?.producer_identity, { role: "implementer", host: "codex" });
  assert.equal(created, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test("D7 missing implementer row fails only implementation review", async () => {
  const missing = await makeRepo({
    agents: implAgents({ omitImplementerRow: true }),
    task: implTask(),
  });
  let created = 0;
  const implOutcome = await runReview(
    { repo: missing.root, task: missing.taskRel },
    testDeps({
      clock: testClock(RUN_A),
      createAdapter: () => {
        created += 1;
        return new FakeAdapter(constantSource(passResult("implementation")));
      },
    }),
  );
  assert.equal(implOutcome.status?.reason_code, "reviewer_binding_missing");
  const parsed = parseAgentsPolicy(implAgents({ omitImplementerRow: true }));
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    const producer = implementationProducerIdentity(parsed);
    assert.equal(producer.ok, false);
    if (!producer.ok) {
      assert.equal(producer.detail.check, "implementer_row_missing");
    }
  }
  assert.equal(created, 0);
  await fs.rm(missing.root, { recursive: true, force: true });

  const plan = await makeRepo({ agents: validAgentsMd({ omitImplementerRow: true }) });
  const planOutcome = await runReview(
    { repo: plan.root, task: plan.taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_B) }),
  );
  assert.equal(planOutcome.status?.reason_code, "review_passed");
  assert.equal(planOutcome.status?.producer_identity, null);
  await fs.rm(plan.root, { recursive: true, force: true });
});

test("D7 a spent plan chain does not carry into a fresh implementation review", async () => {
  const { root, taskRel } = await makeRepo({
    agents: implAgents(),
    task: validTaskMd({ reviewSection: `\n${DEFAULT_REVIEW_SECTION}` }),
  });
  const plan = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(changesResult()), clock: testClock(RUN_A) }),
  );
  assert.equal(plan.status?.review_kind, "plan");
  assert.equal(plan.status?.review_chain?.cycle, 1);
  await fs.writeFile(path.join(root, taskRel), implTask(), "utf8");
  const impl = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(passResult("implementation")), clock: testClock(RUN_B) }),
  );
  assert.equal(impl.status?.review_kind, "implementation");
  assert.deepEqual(impl.status?.review_chain, {
    after_run_id: null,
    cycle: 1,
    max_cycles: 3,
    refused: null,
  });
  await fs.rm(root, { recursive: true, force: true });
});

test("D7 implementation chain admits three cycles and refuses the fourth", async () => {
  const { root, taskRel } = await makeRepo({ agents: implAgents(), task: implTask() });
  const ids = [RUN_A, RUN_B, RUN_C];
  let parent: string | undefined;
  for (const [index, id] of ids.entries()) {
    if (index > 0) {
      await restoreNextRole(root, taskRel);
    }
    const counting = new CountingAdapter(new FakeAdapter(constantSource(changesResult("implementation"))));
    const outcome = await runReview(
      { repo: root, task: taskRel, after_run: parent },
      testDeps({ clock: testClock(id), createAdapter: () => counting }),
    );
    assert.equal(outcome.status?.reason_code, "review_changes_requested", id);
    assert.equal(outcome.status?.review_chain?.cycle, index + 1, id);
    assert.equal(counting.startCount, 1, id);
    parent = id;
  }
  await restoreNextRole(root, taskRel);
  const fourth = new CountingAdapter(new FakeAdapter(constantSource(passResult("implementation"))));
  const refused = await runReview(
    { repo: root, task: taskRel, after_run: RUN_C },
    testDeps({ clock: testClock(RUN_D), createAdapter: () => fourth }),
  );
  assert.equal(refused.status?.reason_code, "cycle_limit_reached");
  assert.equal(fourth.startCount, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test("D7 no producer is spawned across pass, changes, and cycle-limit chains", async () => {
  const changes = await makeRepo({ agents: implAgents(), task: implTask() });
  const first = new CountingAdapter(new FakeAdapter(constantSource(changesResult("implementation"))));
  await runReview(
    { repo: changes.root, task: changes.taskRel },
    testDeps({ clock: testClock(RUN_A), createAdapter: () => first }),
  );
  await restoreNextRole(changes.root, changes.taskRel);
  const second = new CountingAdapter(new FakeAdapter(constantSource(changesResult("implementation"))));
  await runReview(
    { repo: changes.root, task: changes.taskRel, after_run: RUN_A },
    testDeps({ clock: testClock(RUN_B), createAdapter: () => second }),
  );
  assert.equal(first.startCount, 1);
  assert.equal(second.startCount, 1);
  assert.equal(first.capabilities().launcher_id, "fake-reviewer-v1");
  await fs.rm(changes.root, { recursive: true, force: true });

  const pass = await makeRepo({ agents: implAgents(), task: implTask() });
  const passCounting = new CountingAdapter(new FakeAdapter(constantSource(passResult("implementation"))));
  const passOutcome = await runReview(
    { repo: pass.root, task: pass.taskRel },
    testDeps({ clock: testClock(RUN_C), createAdapter: () => passCounting }),
  );
  assert.equal(passOutcome.status?.reason_code, "review_passed");
  assert.match(await fs.readFile(path.join(pass.root, pass.taskRel), "utf8"), /^next_role: human-operator$/m);
  assert.equal(passCounting.startCount, 1);
  await fs.rm(pass.root, { recursive: true, force: true });

  const limit = await makeRepo({ agents: implAgents({ cycles: 1 }), task: implTask() });
  const limitFirst = new CountingAdapter(new FakeAdapter(constantSource(changesResult("implementation"))));
  await runReview(
    { repo: limit.root, task: limit.taskRel },
    testDeps({ clock: testClock(RUN_A), createAdapter: () => limitFirst }),
  );
  await restoreNextRole(limit.root, limit.taskRel);
  const limitSecond = new CountingAdapter(new FakeAdapter(constantSource(passResult("implementation"))));
  const limited = await runReview(
    { repo: limit.root, task: limit.taskRel, after_run: RUN_A },
    testDeps({ clock: testClock(RUN_B), createAdapter: () => limitSecond }),
  );
  assert.equal(limited.status?.reason_code, "cycle_limit_reached");
  assert.equal(limitSecond.startCount, 0);
  await fs.rm(limit.root, { recursive: true, force: true });
});

test("D7 chaining a plan parent into an implementation child is refused", async () => {
  const { root, taskRel } = await makeRepo({
    agents: implAgents(),
    task: validTaskMd({ reviewSection: `\n${DEFAULT_REVIEW_SECTION}` }),
  });
  const plan = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(changesResult()), clock: testClock(RUN_A) }),
  );
  assert.equal(plan.status?.review_kind, "plan");
  await fs.writeFile(path.join(root, taskRel), implTask(), "utf8");
  let created = 0;
  const child = await runReview(
    { repo: root, task: taskRel, after_run: RUN_A },
    testDeps({
      clock: testClock(RUN_B),
      createAdapter: () => {
        created += 1;
        return new FakeAdapter(constantSource(passResult("implementation")));
      },
    }),
  );
  assert.equal(child.status?.reason_code, "chain_refused");
  assert.equal(child.status?.review_chain?.refused, "not_authorized");
  assert.equal(created, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test("D8 result review_kind must equal the dispatched kind", async () => {
  const impl = await makeRepo({ agents: implAgents(), task: implTask() });
  const wrongPlan = await runReview(
    { repo: impl.root, task: impl.taskRel },
    testDeps({ source: constantSource(passResult("plan")), clock: testClock(RUN_A) }),
  );
  assert.equal(wrongPlan.status?.reason_code, "result_schema_invalid");
  const stubPlan = JSON.stringify(passResult("plan"));
  assert.equal(stubPlan.includes('"review_kind":"plan"'), true);
  await fs.rm(impl.root, { recursive: true, force: true });

  const plan = await makeRepo();
  const wrongImpl = await runReview(
    { repo: plan.root, task: plan.taskRel },
    testDeps({ source: constantSource(passResult("implementation")), clock: testClock(RUN_B) }),
  );
  assert.equal(wrongImpl.status?.reason_code, "result_schema_invalid");
  const stubImpl = JSON.stringify(passResult("implementation"));
  assert.equal(stubImpl.includes('"review_kind":"implementation"'), true);
  await fs.rm(plan.root, { recursive: true, force: true });
  assert.throws(() => validateReviewResult(passResult("plan"), "implementation"));
  assert.throws(() => validateReviewResult(passResult("implementation"), "plan"));
});

test("D8 Codex output schema const matches the dispatched kind", () => {
  const plan = JSON.parse(codexOutputSchema("plan")) as { properties: { review_kind: { const: string } } };
  const impl = JSON.parse(codexOutputSchema("implementation")) as { properties: { review_kind: { const: string } } };
  assert.equal(plan.properties.review_kind.const, "plan");
  assert.equal(impl.properties.review_kind.const, "implementation");
  const planRest = structuredClone(plan) as { properties: { review_kind: Record<string, unknown> } };
  const implRest = structuredClone(impl) as { properties: { review_kind: Record<string, unknown> } };
  delete planRest.properties.review_kind.const;
  delete implRest.properties.review_kind.const;
  assert.deepEqual(planRest, implRest);
  assert.equal(CODEX_OUTPUT_SCHEMA, codexOutputSchema("plan"));
});

test("D8 status and events carry the dispatched kind across the two admitted artifacts", async () => {
  const { root, taskRel } = await makeRepo({
    agents: implAgents(),
    task: validTaskMd({ reviewSection: `\n${DEFAULT_REVIEW_SECTION}` }),
  });
  const implRel = "spartan/tasks/0002-impl-fixture.md";
  await fs.mkdir(path.join(root, "spartan/tasks"), { recursive: true });
  await fs.writeFile(path.join(root, implRel), implementationTaskMd({ id: "impl-fixture", reviewSection: `\n${DEFAULT_REVIEW_SECTION}` }), "utf8");
  const planOutcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_A) }),
  );
  const implOutcome = await runReview(
    { repo: root, task: implRel },
    testDeps({ source: constantSource(passResult("implementation")), clock: testClock(RUN_B) }),
  );
  assert.equal(planOutcome.status?.review_kind, "plan");
  assert.equal(implOutcome.status?.review_kind, "implementation");
  assert.equal(planOutcome.status?.producer_identity, null);
  assert.deepEqual(implOutcome.status?.producer_identity, { role: "implementer", host: "cursor" });
  assert.equal(planOutcome.status?.schema_version, implOutcome.status?.schema_version);
  assert.equal(planOutcome.status?.state, "awaiting_implementer");
  assert.equal(implOutcome.status?.state, "review_passed");
  assert.equal(planOutcome.status?.verdict, implOutcome.status?.verdict);
  assert.equal(planOutcome.status?.reason_code, implOutcome.status?.reason_code);
  assert.equal(planOutcome.status?.host, implOutcome.status?.host);
  assert.equal(planOutcome.status?.client_context, implOutcome.status?.client_context);
  assert.equal(planOutcome.status?.model, implOutcome.status?.model);
  assert.equal(planOutcome.status?.effort, implOutcome.status?.effort);
  const planRun = await loadRun(root, RUN_A);
  const implRun = await loadRun(root, RUN_B);
  assert.deepEqual(eventTypes(planRun.events), eventTypes(implRun.events));
  for (const event of planRun.events) {
    assert.equal(event.review_kind, "plan");
    assert.equal("producer_identity" in event, false);
  }
  for (const event of implRun.events) {
    assert.equal(event.review_kind, "implementation");
    assert.equal("producer_identity" in event, false);
  }
  await fs.rm(root, { recursive: true, force: true });
});

test("D5 kind-scoped regions, preservation, legacy plan, and refusals", async () => {
  const planBlock = `${REVIEW_PLAN_BEGIN}\nVerdict: APPROVED\n\nFindings:\n\n- None recorded.\n\nBridge run: run_id=run-plan execution_id=exec-plan review_kind=plan verdict=pass reason_code=review_passed host=cursor launcher=fake-reviewer-v1 model=Composer-2.5 effort=none model_observed=declared_unobserved policy_digest=sha256:abc task_hash=sha256:def agents_hash=sha256:ghi timestamp=2026-08-16T12:00:00.000Z\n${REVIEW_PLAN_END}\n`;
  const body = `## Review\n\nAbove the first region.\n\n${planBlock}\nBetween the regions.\n\nBelow the last.\n`;
  const { root, taskRel } = await makeRepo({
    agents: implAgents(),
    task: implTask({ reviewSection: `\n${body}` }),
  });
  const before = await fs.readFile(path.join(root, taskRel), "utf8");
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(changesResult("implementation")), clock: testClock(RUN_A) }),
  );
  assert.equal(outcome.status?.task_write_state, "written");
  const after = await fs.readFile(path.join(root, taskRel), "utf8");
  assert.equal(after.includes(REVIEW_PLAN_BEGIN), true);
  assert.equal(after.includes(REVIEW_IMPLEMENTATION_BEGIN), true);
  assert.equal(after.indexOf(REVIEW_PLAN_BEGIN) < after.indexOf(REVIEW_IMPLEMENTATION_BEGIN), true);
  assert.equal(after.includes("Above the first region."), true);
  assert.equal(after.includes("Between the regions."), true);
  assert.equal(after.includes("Below the last."), true);
  const planBefore = before.slice(before.indexOf(REVIEW_PLAN_BEGIN), before.indexOf(REVIEW_PLAN_END) + REVIEW_PLAN_END.length);
  const planAfter = after.slice(after.indexOf(REVIEW_PLAN_BEGIN), after.indexOf(REVIEW_PLAN_END) + REVIEW_PLAN_END.length);
  assert.equal(planAfter, planBefore);
  assert.equal(preservedAuthorizedBytes(before, after), true);
  await restoreNextRole(root, taskRel);
  const replaced = await runReview(
    { repo: root, task: taskRel, after_run: RUN_A },
    testDeps({ source: constantSource(passResult("implementation")), clock: testClock(RUN_B) }),
  );
  assert.equal(replaced.status?.task_write_state, "written");
  const twice = await fs.readFile(path.join(root, taskRel), "utf8");
  const planTwice = twice.slice(twice.indexOf(REVIEW_PLAN_BEGIN), twice.indexOf(REVIEW_PLAN_END) + REVIEW_PLAN_END.length);
  assert.equal(planTwice, planBefore);
  await fs.rm(root, { recursive: true, force: true });

  const legacy = `${REVIEW_BEGIN}\nVerdict: APPROVED\n\nFindings:\n\n- None recorded.\n\nBridge run: leftover\n${REVIEW_END}\n`;
  const legacyRepo = await makeRepo({
    agents: implAgents(),
    task: implTask({ reviewSection: `\n## Review\n\n${legacy}` }),
  });
  const legacyBefore = await fs.readFile(path.join(legacyRepo.root, legacyRepo.taskRel), "utf8");
  const legacyOutcome = await runReview(
    { repo: legacyRepo.root, task: legacyRepo.taskRel },
    testDeps({ source: constantSource(passResult("implementation")), clock: testClock(RUN_C) }),
  );
  assert.equal(legacyOutcome.status?.task_write_state, "written");
  const legacyAfter = await fs.readFile(path.join(legacyRepo.root, legacyRepo.taskRel), "utf8");
  assert.equal(legacyAfter.includes(REVIEW_BEGIN), true);
  assert.equal(legacyAfter.includes(REVIEW_IMPLEMENTATION_BEGIN), true);
  assert.equal(legacyAfter.indexOf(REVIEW_BEGIN) < legacyAfter.indexOf(REVIEW_IMPLEMENTATION_BEGIN), true);
  const legacySlice = (text: string) => text.slice(text.indexOf(REVIEW_BEGIN), text.indexOf(REVIEW_END) + REVIEW_END.length);
  assert.equal(legacySlice(legacyAfter), legacySlice(legacyBefore));
  await fs.rm(legacyRepo.root, { recursive: true, force: true });

  const inverted = `## Review\n\n${REVIEW_IMPLEMENTATION_BEGIN}\nx\n${REVIEW_IMPLEMENTATION_END}\n${REVIEW_PLAN_BEGIN}\ny\n${REVIEW_PLAN_END}\n`;
  assert.equal(spliceRegion(`---\n---\n${inverted}`, `${REVIEW_IMPLEMENTATION_BEGIN}\nz\n${REVIEW_IMPLEMENTATION_END}\n`), null);
  const duplicate = `## Review\n\n${REVIEW_PLAN_BEGIN}\na\n${REVIEW_PLAN_END}\n${REVIEW_PLAN_BEGIN}\nb\n${REVIEW_PLAN_END}\n`;
  assert.equal(spliceRegion(`---\n---\n${duplicate}`, `${REVIEW_PLAN_BEGIN}\nc\n${REVIEW_PLAN_END}\n`), null);
  const oversize = renderRegion(
    {
      schema_version: 2,
      review_kind: "implementation",
      verdict: "pass",
      summary: "ok",
      findings: [{ id: "F1", severity: "error", message: "x".repeat(REGION_BYTE_CAP) }],
    },
    {
      run_id: "run-1",
      execution_id: "exec-1",
      review_kind: "implementation",
      verdict: "pass",
      reason_code: "review_passed",
      host: "cursor",
      launcher_id: "fake-reviewer-v1",
      model: "Composer-2.5",
      effort: "none",
      model_observed: "declared_unobserved",
      policy_digest: "sha256:abc",
      task_hash: "sha256:def",
      agents_hash: "sha256:ghi",
      timestamp: "2026-08-16T12:00:00.000Z",
    },
  );
  assert.equal(oversize, null);
});

test("D5 a plan write migrates a legacy unscoped region", async () => {
  const legacy = `\n## Review\n\n${REVIEW_BEGIN}\nold\n${REVIEW_END}\n`;
  const { root, taskRel } = await makeRepo({
    agents: validAgentsMd({ taskWrite: true }),
    task: validTaskMd({ reviewSection: legacy }),
  });
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_A) }),
  );
  assert.equal(outcome.status?.task_write_state, "written");
  const text = await fs.readFile(path.join(root, taskRel), "utf8");
  assert.equal(text.includes(REVIEW_PLAN_BEGIN), true);
  assert.equal(text.includes(REVIEW_BEGIN), false);
  await fs.rm(root, { recursive: true, force: true });
});

test("D1 and D8 Codex prompts and schema files", async () => {
  assert.equal(
    CODEX_REVIEW_PROMPT,
    `You are a read-only plan reviewer.

Review only the workspace files task.md and AGENTS.md. No other file is available for this review. Do not edit files. Do not inspect any other path.

Return a single JSON object. Use exactly these keys and no others: schema_version, review_kind, verdict, summary, findings. verdict must be exactly one of pass, changes_requested, human_required, blocked. finding id must match [A-Z][A-Z0-9_-]{0,31}. pass requires findings: []. changes_requested requires at least one finding whose severity is warning or error.

Length budget. Keep summary under 1200 characters and each finding message under 1200 characters. summary is a short orientation, not the review — put the substance in findings, which is what the task artifact records. An object that exceeds the schema's limits is rejected and the entire review is discarded, however good it was.

Severity rule. Reserve error or warning severity for a decision that is wrong, self-contradictory, or unimplementable as written, or for an ambiguity an implementer would plausibly resolve the wrong way. A wording, ordering, or evidence-precision improvement that does not change what gets built is severity info and never on its own justifies changes_requested. When the plan is implementable as written, return pass even if it could be tightened.
`,
  );
  assert.equal(
    CODEX_IMPLEMENTATION_REVIEW_PROMPT,
    `You are a read-only implementation reviewer.

Review the workspace files AGENTS.md, task.md, diff.patch, changes.txt, and anything under worktree/. No other path is available for this review. Do not edit files. Do not inspect any other path.

Return a single JSON object. Use exactly these keys and no others: schema_version, review_kind, verdict, summary, findings. verdict must be exactly one of pass, changes_requested, human_required, blocked. finding id must match [A-Z][A-Z0-9_-]{0,31}. pass requires findings: []. changes_requested requires at least one finding whose severity is warning or error.

Length budget. Keep summary under 1200 characters and each finding message under 1200 characters. summary is a short orientation, not the review — put the substance in findings, which is what the task artifact records. An object that exceeds the schema's limits is rejected and the entire review is discarded, however good it was.
`,
  );
  assert.match(CODEX_IMPLEMENTATION_REVIEW_PROMPT, /AGENTS\.md/);
  assert.match(CODEX_IMPLEMENTATION_REVIEW_PROMPT, /task\.md/);
  assert.match(CODEX_IMPLEMENTATION_REVIEW_PROMPT, /diff\.patch/);
  assert.match(CODEX_IMPLEMENTATION_REVIEW_PROMPT, /changes\.txt/);
  assert.match(CODEX_IMPLEMENTATION_REVIEW_PROMPT, /worktree\//);
  assert.match(CODEX_IMPLEMENTATION_REVIEW_PROMPT, /No other path is available/);
});

test("D2 executables are module constants and repository content is not a command", async () => {
  const [codex, cursor, review, workspace] = await Promise.all([
    fs.readFile(new URL("../src/adapters/codex.ts", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/adapters/cursor.ts", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/core/review.ts", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/core/workspace.ts", import.meta.url), "utf8"),
  ]);
  assert.equal(CODEX_EXECUTABLE, "codex");
  assert.equal(CURSOR_EXECUTABLE, "cursor-agent");
  assert.equal(GIT_EXECUTABLE, "git");
  assert.match(codex, /executable: CODEX_EXECUTABLE/);
  assert.match(cursor, /executable: CURSOR_EXECUTABLE/);
  assert.match(workspace, /spawn\(GIT_EXECUTABLE/);
  assert.doesNotMatch(review, /spawn\(/);
  assert.doesNotMatch(review, /executable: /);
  assert.match(codex, /composeCodexModelConfig\(input\.model\)/);
  assert.doesNotMatch(codex, /executable: input\./);
  assert.doesNotMatch(cursor, /executable: input\./);
});

test("D2 routing docs no longer condition implementation review on Bridge-evaluated checks", async () => {
  const routing = await fs.readFile(new URL("../docs/ROUTING-AND-WORKFLOWS.md", import.meta.url), "utf8");
  assert.doesNotMatch(routing, /after required checks pass/);
  assert.match(routing, /does not run\nthose checks and does not verify them/);
  assert.match(routing, /Recording check outcomes remains the\nimplementer round's obligation/);
  assert.match(routing, /\/spbridge` implementer round/);
  const skill = await fs.readFile(new URL("../agent-skill/skills/spbridge/SKILL.md", import.meta.url), "utf8");
  assert.doesNotMatch(skill, /implementer round is not entered through this skill/);
  assert.match(skill, /\/spbridge/);
});

test("D1 implementation workspace shape versus a plan workspace over the same fixture", async () => {
  const root = await makeGitRepo();
  await writeRel(root, "AGENTS.md", implAgents({ host: "Codex", model: "gpt-5.6-terra", effort: "high" }));
  await writeRel(root, "spartan/tasks/0001-bootstrap-fixture.md", implTask());
  await writeRel(root, "README.md", "readme\n");
  await writeRel(root, "src/a.ts", "a\n");
  await commitAll(root, "base");
  const implRun = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-impl-run-"));
  const implAdapter = new CodexAdapter({ runner: fakeReviewer() });
  await implAdapter.prepare(adapterInput(root, "spartan/tasks/0001-bootstrap-fixture.md", implRun, "implementation"));
  const implWorkspace = path.join(implRun, "reviewer-workspace");
  assert.deepEqual((await fs.readdir(implWorkspace)).sort(), ["AGENTS.md", "changes.txt", "diff.patch", "task.md", "worktree"]);

  const planRun = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-plan-run-"));
  let planNames: string[] = [];
  const planAdapter = new CodexAdapter({
    runner: {
      start(request) {
        if (request.args.includes("--help")) {
          return fakeReviewer().start(request);
        }
        const cd = request.args[request.args.indexOf("--cd") + 1]!;
        planNames = readdirSync(cd).sort();
        return fakeReviewer().start(request);
      },
    },
  });
  await planAdapter.prepare(adapterInput(root, "spartan/tasks/0001-bootstrap-fixture.md", planRun, "plan"));
  await planAdapter.start(adapterInput(root, "spartan/tasks/0001-bootstrap-fixture.md", planRun, "plan"));
  assert.deepEqual(planNames, ["AGENTS.md", "task.md"]);
  const planSchema = JSON.parse(await fs.readFile(path.join(planRun, CODEX_SCHEMA_FILE), "utf8")) as { properties: { review_kind: { const: string } } };
  const implSchema = JSON.parse(await fs.readFile(path.join(implRun, CODEX_SCHEMA_FILE), "utf8")) as { properties: { review_kind: { const: string } } };
  assert.equal(planSchema.properties.review_kind.const, "plan");
  assert.equal(implSchema.properties.review_kind.const, "implementation");
  await fs.rm(root, { recursive: true, force: true });
  await removeRun(implRun);
  await removeRun(planRun);
});

test("D1 confidentiality, agreement table, entry types, and fail-closed isolation", async () => {
  const root = await makeGitRepo();
  await writeRel(root, "AGENTS.md", implAgents());
  await writeRel(root, "spartan/tasks/0001-bootstrap-fixture.md", implTask());
  await writeRel(root, "README.md", "readme\n");
  await writeRel(root, "src/neighbour.ts", "neighbour\n");
  await writeRel(root, "src/secrets.json", "tracked-ignored\n");
  await writeRel(root, "src/modified.txt", "a\n");
  await writeRel(root, "src/binary.bin", Buffer.from("\x00\x01\x02binary\n"));
  await writeRel(root, "src/mode.sh", "#!/bin/sh\n");
  await writeRel(root, "src/unchanged.txt", "x\n");
  await writeRel(root, "src/deleted.txt", "d\n");
  await writeRel(root, "src/uncached.txt", "c\n");
  await writeRel(root, "src/git-rm.txt", "r\n");
  await writeRel(root, "src/renamed-from.txt", "from\n");
  await writeRel(root, "credentials.json", "secret-json\n");
  await writeRel(root, ".npmrc", "npm-secret\n");
  await writeRel(root, ".netrc", "netrc-secret\n");
  await writeRel(root, "outside-mod.txt", "out-mod\n");
  await writeRel(root, "outside-del.txt", "out-del\n");
  await writeRel(root, ".gitignore", "src/secrets.json\nsrc/.env.local\nignored-out.txt\n");
  await commitAll(root, "base");
  await writeRel(root, "src/modified.txt", "a\nb\n");
  await writeRel(root, "src/binary.bin", Buffer.from("\x00\x01\x03BINARY\n"));
  await fs.chmod(path.join(root, "src/mode.sh"), 0o755);
  await fs.rm(path.join(root, "src/deleted.txt"));
  await writeRel(root, "src/index-added.txt", "new\n");
  await repoGit(root, ["add", "src/index-added.txt"]);
  await writeRel(root, "src/staged-then-removed.txt", "ghost\n");
  await repoGit(root, ["add", "src/staged-then-removed.txt"]);
  await fs.rm(path.join(root, "src/staged-then-removed.txt"));
  await writeRel(root, "src/untracked.txt", "u\n");
  await writeRel(root, "src/.env.local", "ignored-untracked\n");
  await repoGit(root, ["rm", "-q", "--cached", "src/uncached.txt"]);
  await repoGit(root, ["rm", "-q", "src/git-rm.txt"]);
  await repoGit(root, ["mv", "src/renamed-from.txt", "src/renamed-to.txt"]);
  await writeRel(root, "outside-mod.txt", "out-mod-changed\n");
  await writeRel(root, "outside-add.txt", "staged-out\n");
  await repoGit(root, ["add", "outside-add.txt"]);
  await repoGit(root, ["rm", "-q", "outside-del.txt"]);
  await writeRel(root, "ignored-out.txt", "ignored-outside\n");

  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-impl-run-"));
  const recorded: string[][] = [];
  const adapter = new CodexAdapter({
    runner: {
      start(request) {
        recorded.push([...request.args]);
        return fakeReviewer(JSON.stringify(passResult("implementation"))).start(request);
      },
    },
  });
  await adapter.prepare(adapterInput(root, "spartan/tasks/0001-bootstrap-fixture.md", runDir, "implementation"));
  await adapter.start(adapterInput(root, "spartan/tasks/0001-bootstrap-fixture.md", runDir, "implementation"));
  assert.equal(recorded.some((args) => args[0] === "exec" && !args.includes("--help")), true);
  const workspace = path.join(runDir, "reviewer-workspace");
  const changes = await fs.readFile(path.join(workspace, "changes.txt"), "utf8");
  const patch = await fs.readFile(path.join(workspace, "diff.patch"), "utf8");
  const manifest = JSON.parse(await fs.readFile(path.join(runDir, WORKSPACE_MANIFEST_FILE), "utf8")) as {
    entries: Array<{ path: string }>;
  };
  const blob = `${changes}\n${patch}\n${JSON.stringify(manifest)}`;
  for (const secret of ["credentials.json", ".npmrc", ".netrc", "outside-mod.txt", "outside-add.txt", "outside-del.txt", "ignored-out.txt"]) {
    assert.equal(blob.includes(secret), false, secret);
    await assert.rejects(() => fs.access(worktreeAbs(workspace, secret)), { code: "ENOENT" });
  }
  assert.equal(await fs.readFile(worktreeAbs(workspace, "src/neighbour.ts"), "utf8"), "neighbour\n");
  assert.equal(await fs.readFile(worktreeAbs(workspace, "src/secrets.json"), "utf8"), "tracked-ignored\n");
  assert.equal(await fs.readFile(worktreeAbs(workspace, "src/.env.local"), "utf8"), "ignored-untracked\n");
  assert.equal(await fs.readFile(worktreeAbs(workspace, "src/unchanged.txt"), "utf8"), "x\n");
  assert.equal(await fs.readFile(worktreeAbs(workspace, "src/modified.txt"), "utf8"), "a\nb\n");
  assert.equal(await fs.readFile(worktreeAbs(workspace, "src/index-added.txt"), "utf8"), "new\n");
  assert.equal(await fs.readFile(worktreeAbs(workspace, "src/untracked.txt"), "utf8"), "u\n");
  assert.equal(await fs.readFile(worktreeAbs(workspace, "src/uncached.txt"), "utf8"), "c\n");
  await assert.rejects(() => fs.access(worktreeAbs(workspace, "src/deleted.txt")), { code: "ENOENT" });
  await assert.rejects(() => fs.access(worktreeAbs(workspace, "src/git-rm.txt")), { code: "ENOENT" });
  await assert.rejects(() => fs.access(worktreeAbs(workspace, "src/staged-then-removed.txt")), { code: "ENOENT" });
  await assert.rejects(() => fs.access(worktreeAbs(workspace, "src/renamed-from.txt")), { code: "ENOENT" });
  assert.equal(changes.includes(changeLine("modified", "src/modified.txt")), true);
  assert.equal(changes.includes("src/unchanged.txt"), false);
  assert.equal(changes.includes(changeLine("deleted", "src/deleted.txt")), true);
  assert.equal(changes.includes(changeLine("removed-from-index", "src/uncached.txt")), true);
  assert.equal(changes.includes(changeLine("deleted", "src/git-rm.txt")), true);
  assert.equal(changes.includes(changeLine("added", "src/index-added.txt")), true);
  assert.equal(changes.includes(changeLine("added-then-removed", "src/staged-then-removed.txt")), true);
  assert.equal(changes.includes(changeLine("untracked", "src/untracked.txt")), true);
  assert.equal(changes.includes(changeLine("deleted", "src/renamed-from.txt")), true);
  assert.equal(changes.includes(changeLine("added", "src/renamed-to.txt")), true);
  assert.match(patch, /^diff --git a\/src\/modified\.txt b\/src\/modified\.txt$/m);
  assert.equal(patch.includes("src/unchanged.txt"), false);
  assert.equal(patch.includes("src/staged-then-removed.txt"), false);
  assert.equal(patch.includes("src/untracked.txt"), false);
  assert.match(patch, /^diff --git a\/src\/binary\.bin b\/src\/binary\.bin$/m);
  assert.match(patch, /^diff --git a\/src\/mode\.sh b\/src\/mode\.sh$/m);
  assert.match(patch, /^diff --git a\/src\/uncached\.txt b\/src\/uncached\.txt$/m);
  assert.match(patch, /^diff --git a\/src\/git-rm\.txt b\/src\/git-rm\.txt$/m);
  assert.match(patch, /^diff --git a\/src\/renamed-from\.txt b\/src\/renamed-from\.txt$/m);
  assert.match(patch, /^diff --git a\/src\/renamed-to\.txt b\/src\/renamed-to\.txt$/m);
  assert.equal(patch.includes(".git/"), false);
  const top = await fs.readdir(workspace);
  assert.equal(top.includes(".git"), false);

  async function walk(abs: string, rel: string, files: string[], dirs: string[]): Promise<void> {
    const names = await fs.readdir(abs);
    for (const name of names) {
      const childAbs = path.join(abs, name);
      const childRel = rel.length === 0 ? name : `${rel}/${name}`;
      const stat = lstatSync(childAbs);
      assert.equal(stat.isSymbolicLink(), false, childRel);
      if (stat.isDirectory()) {
        dirs.push(childRel);
        await walk(childAbs, childRel, files, dirs);
      } else {
        assert.equal(stat.isFile(), true, childRel);
        files.push(childRel);
      }
    }
  }
  const files: string[] = [];
  const dirs: string[] = [];
  await walk(path.join(workspace, "worktree"), "", files, dirs);
  for (const dir of dirs) {
    assert.equal(files.some((file) => file === dir || file.startsWith(`${dir}/`)), true, dir);
    assert.equal(manifest.entries.some((entry) => entry.path === `worktree/${dir}`), false, dir);
  }

  await removeRun(runDir);
  await fs.rm(root, { recursive: true, force: true });

  const symlinkRoot = await makeGitRepo();
  await writeRel(symlinkRoot, "AGENTS.md", implAgents());
  await writeRel(symlinkRoot, "spartan/tasks/0001-bootstrap-fixture.md", implTask());
  await writeRel(symlinkRoot, "src/a.txt", "a\n");
  await commitAll(symlinkRoot, "base");
  await fs.symlink("a.txt", path.join(symlinkRoot, "src/link.txt"));
  const symlinkRun = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-impl-run-"));
  let starts = 0;
  const failing = new CodexAdapter({
    runner: {
      start(request) {
        starts += 1;
        return fakeReviewer().start(request);
      },
    },
  });
  await assert.rejects(
    () => failing.prepare(adapterInput(symlinkRoot, "spartan/tasks/0001-bootstrap-fixture.md", symlinkRun, "implementation")),
    { name: "AdapterIsolationError" },
  );
  assert.equal(starts, 0);
  await removeRun(symlinkRun);
  await fs.rm(symlinkRoot, { recursive: true, force: true });
});

test("D1 fail-closed isolation surfaces through runReview without spawning a reviewer", async () => {
  const { root, taskRel } = await makeRepo({ agents: implAgents({ host: "Codex", model: "gpt-5.6-terra", effort: "high" }), task: implTask() });
  let prepareCalls = 0;
  let startCount = 0;
  const adapter = new CodexAdapter({
    runner: {
      start(request) {
        if (!request.args.includes("--help")) {
          startCount += 1;
        }
        return fakeReviewer().start(request);
      },
    },
    prepareWorkspace: async ({ runDir }) => {
      prepareCalls += 1;
      await fs.writeFile(path.join(runDir, WORKSPACE_MANIFEST_FILE), `${JSON.stringify({ seen: ["src/a.ts"] })}\n`);
      throw new ReviewerIsolationUnavailableError();
    },
  });
  const outcome = await runReview(
    { repo: root, task: taskRel },
    {
      ...testDeps({
        registryYaml: VALID_REGISTRY.replaceAll("fake-reviewer-v1", "codex-plan-reviewer-v1"),
        clock: testClock(RUN_A),
      }),
      catalog: {
        resolve: () => adapter,
      },
    },
  );
  assert.equal(outcome.status?.reason_code, "reviewer_isolation_unavailable");
  assert.equal(prepareCalls, 1);
  assert.equal(startCount, 0);
  assert.equal(await fs.readFile(path.join(root, ".spartan-bridge", "runs", RUN_A, WORKSPACE_MANIFEST_FILE), "utf8"), `${JSON.stringify({ seen: ["src/a.ts"] })}\n`);
  await fs.rm(root, { recursive: true, force: true });
});

test("D1 exact matching and credential-shaped names follow ordinary admission", async () => {
  const root = await makeGitRepo();
  await writeRel(root, "AGENTS.md", implAgents());
  await writeRel(root, "spartan/tasks/0001-bootstrap-fixture.md", implTask());
  await writeRel(root, "README.md", "readme\n");
  await writeRel(root, "src/a.ts", "a\n");
  await writeRel(root, "src/nested/b.ts", "b\n");
  await writeRel(root, "srcfoo", "nope\n");
  await writeRel(root, "packages/src/a.ts", "nope\n");
  await writeRel(root, "packages/app/index.ts", "app\n");
  await writeRel(root, "packages/application/index.ts", "nope\n");
  await writeRel(root, ".env", "env\n");
  await writeRel(root, ".npmrc", "npm\n");
  await writeRel(root, "credentials.json", "creds\n");
  await commitAll(root, "base");
  const admitted = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-impl-run-"));
  const adapter = new CodexAdapter({ runner: fakeReviewer() });
  await adapter.prepare(
    adapterInput(root, "spartan/tasks/0001-bootstrap-fixture.md", admitted, "implementation", [
      "README.md",
      "src/",
      "packages/app/",
    ]),
  );
  const workspace = path.join(admitted, "reviewer-workspace");
  assert.equal(await fs.readFile(worktreeAbs(workspace, "README.md"), "utf8"), "readme\n");
  assert.equal(await fs.readFile(worktreeAbs(workspace, "src/a.ts"), "utf8"), "a\n");
  assert.equal(await fs.readFile(worktreeAbs(workspace, "src/nested/b.ts"), "utf8"), "b\n");
  assert.equal(await fs.readFile(worktreeAbs(workspace, "packages/app/index.ts"), "utf8"), "app\n");
  await assert.rejects(() => fs.access(worktreeAbs(workspace, "srcfoo")), { code: "ENOENT" });
  await assert.rejects(() => fs.access(worktreeAbs(workspace, "packages/src/a.ts")), { code: "ENOENT" });
  await assert.rejects(() => fs.access(worktreeAbs(workspace, "packages/application/index.ts")), { code: "ENOENT" });
  const dirs = ["src", "src/nested", "packages", "packages/app"];
  for (const dir of dirs) {
    assert.equal((lstatSync(worktreeAbs(workspace, dir)).isDirectory()), true, dir);
  }
  await removeRun(admitted);

  const named = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-impl-run-"));
  await adapter.prepare(
    adapterInput(root, "spartan/tasks/0001-bootstrap-fixture.md", named, "implementation", [
      ".env",
      ".npmrc",
      "credentials.json",
    ]),
  );
  const namedWorkspace = path.join(named, "reviewer-workspace");
  assert.equal(await fs.readFile(worktreeAbs(namedWorkspace, ".env"), "utf8"), "env\n");
  assert.equal(await fs.readFile(worktreeAbs(namedWorkspace, ".npmrc"), "utf8"), "npm\n");
  assert.equal(await fs.readFile(worktreeAbs(namedWorkspace, "credentials.json"), "utf8"), "creds\n");
  await removeRun(named);
  await fs.rm(root, { recursive: true, force: true });
});

test("D1 machine-local exclude files do not change the workspace", async () => {
  const root = await makeGitRepo();
  await writeRel(root, "AGENTS.md", implAgents());
  await writeRel(root, "spartan/tasks/0001-bootstrap-fixture.md", implTask());
  await writeRel(root, "src/keep.txt", "keep\n");
  await commitAll(root, "base");
  const firstRun = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-impl-run-"));
  const adapter = new CodexAdapter({ runner: fakeReviewer() });
  await adapter.prepare(adapterInput(root, "spartan/tasks/0001-bootstrap-fixture.md", firstRun, "implementation", ["src/"]));
  const first = readFileSync(path.join(firstRun, "reviewer-workspace", "changes.txt"));
  await fs.mkdir(path.join(root, ".git/info"), { recursive: true });
  await fs.writeFile(path.join(root, ".git/info/exclude"), "src/keep.txt\n");
  const excludeFile = path.join(root, "excludes");
  await fs.writeFile(excludeFile, "src/keep.txt\n");
  spawnSync(GIT_EXECUTABLE, ["config", "core.excludesFile", excludeFile], { cwd: root, env: FIXTURE_ENV });
  const secondRun = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-impl-run-"));
  await adapter.prepare(adapterInput(root, "spartan/tasks/0001-bootstrap-fixture.md", secondRun, "implementation", ["src/"]));
  const second = readFileSync(path.join(secondRun, "reviewer-workspace", "changes.txt"));
  assert.deepEqual(second, first);
  assert.equal(await fs.readFile(worktreeAbs(path.join(secondRun, "reviewer-workspace"), "src/keep.txt"), "utf8"), "keep\n");
  await removeRun(firstRun);
  await removeRun(secondRun);
  await fs.rm(root, { recursive: true, force: true });
});
