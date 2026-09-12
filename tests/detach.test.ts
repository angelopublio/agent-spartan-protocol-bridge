import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseArgv } from "../src/cli/parse.ts";
import {
  pidAlive,
  readInvocation,
  resumeInterrupted,
  spawnDetachedReview,
  waitForRun,
} from "../src/cli/detach.ts";
import { FakeAdapter } from "../src/adapters/fake.ts";
import { DEFAULT_REVIEW_SECTION, makeRepo, passResult, readyImplementationTask, testDeps, validAgentsMd, validTaskMd, writeBridgeConfig, VALID_REGISTRY } from "./helpers.ts";
import { sha256Bytes } from "../src/core/serialize.ts";
import { acquireWriterLock } from "../src/runtime/lock.ts";
import { SCHEMA_VERSION } from "../src/core/contracts.ts";

const cli = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));
const detachAutoChainChild = fileURLToPath(new URL("./fixtures/detach-auto-chain-child.ts", import.meta.url));

function statusFixture(runId: string, state: string, extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    schema_version: 2,
    run_id: runId,
    state,
    review_kind: "plan",
    task_path: "spartan/tasks/0001-bootstrap-fixture.md",
    host: null,
    client_context: null,
    model: null,
    effort: null,
    model_observed: null,
    policy_digest: null,
    artifact_hashes: { task: null, agents: null },
    execution_id: null,
    verdict: null,
    reason_code: null,
    task_write_state: null,
    task_hash_after_write: null,
    task_write_rejection_cause: null,
    review_verdict_log: null,
    reviewer_write: null,
    adapter_failure: null,
    producer_identity: null,
    review_chain: null,
    transition_id: null,
    created_at: "",
    updated_at: "",
    ...extra,
  })}\n`;
}

async function runCli(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", cli, ...args], {
      env: { ...env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function fakeXdg(): Promise<string> {
  const xdg = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-xdg-"));
  await fs.mkdir(path.join(xdg, "spartan-bridge"), { recursive: true });
  await fs.writeFile(path.join(xdg, "spartan-bridge", "client-contexts.yaml"), VALID_REGISTRY, "utf8");
  return xdg;
}

test("parseArgv: --detach, --run-id, wait, resume", () => {
  assert.deepEqual(parseArgv(["review", "--repo", ".", "--task", "t", "--detach"]), {
    kind: "review",
    repo: ".",
    task: "t",
    detach: true,
  });
  assert.deepEqual(parseArgv(["review", "--repo", ".", "--task", "t", "--run-id", "run-1", "--after-run", "run-0"]), {
    kind: "review",
    repo: ".",
    task: "t",
    run_id: "run-1",
    after_run: "run-0",
  });
  assert.deepEqual(parseArgv(["wait", "--repo", ".", "--run", "run-1", "--timeout-ms", "5000"]), {
    kind: "wait",
    repo: ".",
    run: "run-1",
    timeout_ms: 5000,
  });
  assert.deepEqual(parseArgv(["resume", "--repo", "."]), { kind: "resume", repo: "." });
  assert.deepEqual(parseArgv(["status", "--repo", ".", "--task", "spartan/tasks/t.md"]), {
    kind: "status",
    repo: ".",
    task: "spartan/tasks/t.md",
  });
  assert.equal(parseArgv(["status", "--repo", ".", "--run", "r", "--task", "t"]).kind, "usage");
  assert.equal(parseArgv(["wait", "--repo", ".", "--run", "r", "--timeout-ms", "-1"]).kind, "usage");
  assert.equal(parseArgv(["resume", "--repo", ".", "--extra", "x"]).kind, "usage");
});

test("pidAlive: current process yes, pid 1 and a freed pid no", () => {
  assert.equal(pidAlive(process.pid), true);
  assert.equal(pidAlive(1), false);
  assert.equal(pidAlive(2 ** 30), false);
});

test("the writer-lock record carries a pid", async () => {
  const { root: r0 } = await makeRepo();
  const root = await fs.realpath(r0);
  const lock = await acquireWriterLock(root, "transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", new Date().toISOString());
  const raw = JSON.parse(await fs.readFile(lock.lockPath, "utf8")) as { pid?: number; transition_id?: string };
  assert.equal(raw.pid, process.pid);
  assert.equal(raw.transition_id, "transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  await fs.rm(root, { recursive: true, force: true });
});

test("review --detach prints an ack and wait follows the chain to a terminal document", async () => {
  const { root, taskRel } = await makeRepo({ agents: validAgentsMd() });
  const xdg = await fakeXdg();
  const env = { ...process.env, XDG_CONFIG_HOME: xdg };

  const start = await runCli(["review", "--repo", root, "--task", taskRel, "--detach"], env);
  assert.equal(start.code, 0);
  const ack = JSON.parse(start.stdout.trim()) as { detached: boolean; run_id: string; pid: number };
  assert.equal(ack.detached, true);
  assert.match(ack.run_id, /^run-/);
  assert.equal(typeof ack.pid, "number");

  // The invocation record exists before the run directory necessarily does.
  const invocation = await readInvocation(root, ack.run_id);
  assert.ok(invocation);
  assert.equal(invocation?.run_id, ack.run_id);

  // Poll wait until it reports a terminal document.
  let doc: Record<string, unknown> | null = null;
  for (let i = 0; i < 40 && doc === null; i += 1) {
    const w = await runCli(["wait", "--repo", root, "--run", ack.run_id, "--timeout-ms", "2000"], env);
    const parsed = JSON.parse(w.stdout.trim() || "{}") as Record<string, unknown>;
    if (parsed.state === "running") {
      continue;
    }
    doc = parsed;
  }
  assert.ok(doc, "wait never returned a terminal document");
  assert.equal(doc?.run_id, ack.run_id);
  assert.ok(typeof doc?.state === "string");

  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(xdg, { recursive: true, force: true });
});

test("review --detach auto-chain reaches completed and closes the artifact", async () => {
  const autoAgents = validAgentsMd({ automaticImplementation: true, taskWrite: true, producerChain: true });
  const { root: r0, taskRel } = await makeRepo({
    agents: autoAgents,
    task: validTaskMd({ reviewSection: `\n${DEFAULT_REVIEW_SECTION}` }),
  });
  const root = await fs.realpath(r0);
  await writeBridgeConfig(root);
  const xdg = await fakeXdg();
  const priorXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = xdg;

  const runId = "run-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  try {
    const ack = await spawnDetachedReview({
      repoRoot: root,
      scriptPath: detachAutoChainChild,
      execPath: process.execPath,
      repoArg: root,
      taskArg: taskRel,
      runId,
      now: () => Date.now(),
    });
    assert.equal(ack.detached, true);
    assert.equal(ack.run_id, runId);

    let doc: Record<string, unknown> | null = null;
    for (let i = 0; i < 60 && doc === null; i += 1) {
      const outcome = await waitForRun(root, runId);
      if (!outcome.done) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      doc = JSON.parse(outcome.document || "{}") as Record<string, unknown>;
      if (doc.state === "running") {
        doc = null;
        continue;
      }
    }
    assert.ok(doc, "wait never returned a terminal document");
    assert.equal(doc?.reason_code, "review_passed");
    assert.equal(doc?.review_kind, "implementation");

    const taskText = await fs.readFile(path.join(root, taskRel), "utf8");
    assert.match(taskText, /Auto-chain complete: implementation review passed/);
    assert.match(taskText, /phase: complete/);
    assert.match(taskText, /current_role: human-operator/);
    assert.match(taskText, /next_role: human-operator/);
    assert.doesNotMatch(taskText, /Re-review the implementation/);
  } finally {
    if (priorXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = priorXdg;
    }
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(xdg, { recursive: true, force: true });
  }
});

test("waitForRun: alive pid, no run dir yet -> not done with admission phase", async () => {
  const { root: r0 } = await makeRepo();
  const root = await fs.realpath(r0);
  const createdAt = "2026-09-02T11:00:00.000Z";
  await fs.mkdir(path.join(root, ".spartan-bridge", "invocations"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".spartan-bridge", "invocations", "run-cccccccc-cccc-4ccc-8ccc-cccccccccccc.json"),
    `${JSON.stringify({ run_id: "run-cccccccc-cccc-4ccc-8ccc-cccccccccccc", pid: process.pid, detached: true, after_run: null, created_at: createdAt })}\n`,
    "utf8",
  );
  const outcome = await waitForRun(root, "run-cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  assert.equal(outcome.done, false);
  if (!outcome.done) {
    assert.equal(outcome.phase, "requested");
    assert.equal(outcome.phase_since, createdAt);
  }
  await fs.rm(root, { recursive: true, force: true });
});

test("waitForRun: plan run reviewing, alive pid -> phase from run status", async () => {
  const { root: r0 } = await makeRepo();
  const root = await fs.realpath(r0);
  const runId = "run-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const updatedAt = "2026-09-02T11:05:00.000Z";
  const runDir = path.join(root, ".spartan-bridge", "runs", runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, "status.json"),
    statusFixture(runId, "reviewing", { updated_at: updatedAt }),
    "utf8",
  );
  await fs.mkdir(path.join(root, ".spartan-bridge", "invocations"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".spartan-bridge", "invocations", `${runId}.json`),
    `${JSON.stringify({ run_id: runId, pid: process.pid, detached: true, after_run: null, created_at: "" })}\n`,
    "utf8",
  );
  const outcome = await waitForRun(root, runId);
  assert.equal(outcome.done, false);
  if (!outcome.done) {
    assert.equal(outcome.phase, "reviewing");
    assert.equal(outcome.phase_since, updatedAt);
  }
  await fs.rm(root, { recursive: true, force: true });
});

test("waitForRun: awaiting_implementer gap before transition -> phase from run status", async () => {
  const { root: r0 } = await makeRepo();
  const root = await fs.realpath(r0);
  const runId = "run-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const updatedAt = "2026-09-02T11:10:00.000Z";
  const runDir = path.join(root, ".spartan-bridge", "runs", runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, "status.json"),
    statusFixture(runId, "awaiting_implementer", { updated_at: updatedAt }),
    "utf8",
  );
  await fs.mkdir(path.join(root, ".spartan-bridge", "invocations"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".spartan-bridge", "invocations", `${runId}.json`),
    `${JSON.stringify({ run_id: runId, pid: process.pid, detached: true, after_run: null, created_at: "" })}\n`,
    "utf8",
  );
  const outcome = await waitForRun(root, runId);
  assert.equal(outcome.done, false);
  if (!outcome.done) {
    assert.equal(outcome.phase, "awaiting_implementer");
    assert.equal(outcome.phase_since, updatedAt);
  }
  await fs.rm(root, { recursive: true, force: true });
});

test("waitForRun: dead pid, no run dir -> done with empty document (never started)", async () => {
  const { root: r0 } = await makeRepo();
  const root = await fs.realpath(r0);
  await fs.mkdir(path.join(root, ".spartan-bridge", "invocations"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".spartan-bridge", "invocations", "run-dddddddd-dddd-4ddd-8ddd-dddddddddddd.json"),
    `${JSON.stringify({ run_id: "run-dddddddd-dddd-4ddd-8ddd-dddddddddddd", pid: 2 ** 30, detached: true, after_run: null, created_at: "" })}\n`,
    "utf8",
  );
  const outcome = await waitForRun(root, "run-dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  assert.equal(outcome.done, true);
  assert.equal(outcome.done && outcome.document, "");
  await fs.rm(root, { recursive: true, force: true });
});

test("0060 D1: waitForRun names the stale-build refuse from the detach log tail", async () => {
  const { root: r0 } = await makeRepo();
  const root = await fs.realpath(r0);
  const runId = "run-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const inv = path.join(root, ".spartan-bridge", "invocations");
  await fs.mkdir(inv, { recursive: true });
  await fs.writeFile(
    path.join(inv, `${runId}.json`),
    `${JSON.stringify({ run_id: runId, pid: 2 ** 30, detached: true, after_run: null, created_at: "" })}\n`,
    "utf8",
  );
  await fs.writeFile(path.join(inv, `${runId}.detach.log`), "dist/ is older than src/; run npm run build\n", "utf8");
  const outcome = await waitForRun(root, runId);
  assert.equal(outcome.done, true);
  assert.ok(outcome.done && outcome.document.includes(`"reason_code":"stale_build"`));
  assert.ok(outcome.done && outcome.exitCode === 1);
  await fs.rm(root, { recursive: true, force: true });
});

test("waitForRun: review_passed emits the run status with exit 0 and does not follow a successor", async () => {
  const { root: r0 } = await makeRepo();
  const root = await fs.realpath(r0);
  const runId = "run-cafecafe-cafe-4afe-8afe-cafecafecafe";
  const transitionId = "transition-cafecafe-cafe-4afe-8afe-cafecafecafe";
  const runDir = path.join(root, ".spartan-bridge", "runs", runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, "status.json"),
    statusFixture(runId, "review_passed", {
      review_kind: "implementation",
      verdict: "pass",
      reason_code: "review_passed",
    }),
    "utf8",
  );
  const transDir = path.join(root, ".spartan-bridge", "transitions", transitionId);
  await fs.mkdir(transDir, { recursive: true });
  await fs.writeFile(
    path.join(transDir, "status.json"),
    `${JSON.stringify({
      schema_version: 2,
      document: "transition",
      transition_id: transitionId,
      state: "running",
      parent_run_id: runId,
      task_path: "spartan/tasks/0001-bootstrap-fixture.md",
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
      created_at: "2026-09-03T00:00:00.000Z",
      updated_at: "2026-09-03T00:00:00.000Z",
    })}\n`,
    "utf8",
  );
  const outcome = await waitForRun(root, runId);
  assert.equal(outcome.done, true);
  assert.equal(outcome.done && outcome.exitCode, 0);
  assert.ok(outcome.done && outcome.document.includes(`"state":"review_passed"`));
  assert.ok(outcome.done && outcome.document.includes(runId));
  assert.ok(outcome.done && !outcome.document.includes(`"document":"transition"`));
  await fs.rm(root, { recursive: true, force: true });
});

test("waitForRun: plan run terminal and not chaining -> prints that status, exit 1", async () => {
  const { root: r0 } = await makeRepo();
  const root = await fs.realpath(r0);
  const runId = "run-11111111-1111-4111-8111-111111111111";
  const runDir = path.join(root, ".spartan-bridge", "runs", runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "status.json"), statusFixture(runId, "changes_requested"), "utf8");
  const outcome = await waitForRun(root, runId);
  assert.equal(outcome.done, true);
  assert.equal(outcome.done && outcome.exitCode, 1);
  assert.ok(outcome.done && outcome.document.includes(runId));
  await fs.rm(root, { recursive: true, force: true });
});

test("waitForRun: awaiting_implementer, dead pid, no transition -> plan status is the outcome, exit 0", async () => {
  const { root: r0 } = await makeRepo();
  const root = await fs.realpath(r0);
  const runId = "run-22222222-2222-4222-8222-222222222222";
  const runDir = path.join(root, ".spartan-bridge", "runs", runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "status.json"), statusFixture(runId, "awaiting_implementer"), "utf8");
  await fs.mkdir(path.join(root, ".spartan-bridge", "invocations"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".spartan-bridge", "invocations", `${runId}.json`),
    `${JSON.stringify({ run_id: runId, pid: 2 ** 30, detached: true, after_run: null, created_at: "" })}\n`,
    "utf8",
  );
  const outcome = await waitForRun(root, runId);
  assert.equal(outcome.done, true);
  assert.equal(outcome.done && outcome.exitCode, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test("waitForRun: stopped plan_targets_unwritable_path includes unwritable_plan_targets", async () => {
  const { root: r0 } = await makeRepo();
  const root = await fs.realpath(r0);
  const runId = "run-abababab-abab-4bab-8bab-abababababab";
  const transitionId = "transition-abababab-abab-4bab-8bab-abababababab";
  const runDir = path.join(root, ".spartan-bridge", "runs", runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "status.json"), statusFixture(runId, "awaiting_implementer"), "utf8");
  const transDir = path.join(root, ".spartan-bridge", "transitions", transitionId);
  await fs.mkdir(transDir, { recursive: true });
  await fs.writeFile(
    path.join(transDir, "status.json"),
    `${JSON.stringify({
      schema_version: 2,
      document: "transition",
      transition_id: transitionId,
      state: "stopped",
      parent_run_id: runId,
      task_path: "spartan/tasks/0001-bootstrap-fixture.md",
      approved_task_hash: null,
      policy_digest: null,
      implementer_host: null,
      implementer_launcher_id: null,
      lock_identity: null,
      reason_code: "plan_targets_unwritable_path",
      producer_diagnostic: null,
      unwritable_plan_targets: ["AGENTS.md", "config/secret.env"],
      declaration_invalid_detail: null,
      current_review_run_id: null,
      linked_review_run_ids: [],
      created_at: "2026-08-31T00:00:00.000Z",
      updated_at: "2026-08-31T00:00:00.000Z",
    })}\n`,
    "utf8",
  );
  const outcome = await waitForRun(root, runId);
  assert.equal(outcome.done, true);
  assert.equal(outcome.done && outcome.exitCode, 1);
  assert.ok(outcome.done && outcome.document.includes('"unwritable_plan_targets":["AGENTS.md","config/secret.env"]'));
  assert.ok(outcome.done && outcome.document.includes('"producer_diagnostic":null'));
  await fs.rm(root, { recursive: true, force: true });
});

test("waitForRun: terminal write_scope_violation still includes unwritable_plan_targets", async () => {
  const { root: r0 } = await makeRepo();
  const root = await fs.realpath(r0);
  const runId = "run-efefefef-efef-4efe-8efe-efefefefefef";
  const transitionId = "transition-efefefef-efef-4efe-8efe-efefefefefef";
  const runDir = path.join(root, ".spartan-bridge", "runs", runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "status.json"), statusFixture(runId, "awaiting_implementer"), "utf8");
  const transDir = path.join(root, ".spartan-bridge", "transitions", transitionId);
  await fs.mkdir(transDir, { recursive: true });
  await fs.writeFile(
    path.join(transDir, "status.json"),
    `${JSON.stringify({
      schema_version: 2,
      document: "transition",
      transition_id: transitionId,
      state: "stopped",
      parent_run_id: runId,
      task_path: "spartan/tasks/0001-bootstrap-fixture.md",
      approved_task_hash: null,
      policy_digest: null,
      implementer_host: null,
      implementer_launcher_id: null,
      lock_identity: null,
      reason_code: "write_scope_violation",
      producer_diagnostic: null,
      unwritable_plan_targets: ["AGENTS.md"],
      producer_refused_paths: ["spartan-bridge/config.yaml"],
      declaration_invalid_detail: null,
      current_review_run_id: null,
      linked_review_run_ids: [],
      created_at: "2026-08-31T00:00:00.000Z",
      updated_at: "2026-08-31T00:00:00.000Z",
    })}\n`,
    "utf8",
  );
  const outcome = await waitForRun(root, runId);
  assert.equal(outcome.done, true);
  assert.equal(outcome.done && outcome.exitCode, 1);
  assert.ok(outcome.done && outcome.document.includes('"reason_code":"write_scope_violation"'));
  assert.ok(outcome.done && outcome.document.includes('"unwritable_plan_targets":["AGENTS.md"]'));
  assert.ok(outcome.done && outcome.document.includes('"producer_refused_paths":["spartan-bridge/config.yaml"]'));
  await fs.rm(root, { recursive: true, force: true });
});

test("waitForRun: stopped producer_declaration_invalid includes declaration_invalid_detail", async () => {
  const { root: r0 } = await makeRepo();
  const root = await fs.realpath(r0);
  const runId = "run-cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd";
  const transitionId = "transition-cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd";
  const runDir = path.join(root, ".spartan-bridge", "runs", runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "status.json"), statusFixture(runId, "awaiting_implementer"), "utf8");
  const transDir = path.join(root, ".spartan-bridge", "transitions", transitionId);
  await fs.mkdir(transDir, { recursive: true });
  await fs.writeFile(
    path.join(transDir, "status.json"),
    `${JSON.stringify({
      schema_version: 2,
      document: "transition",
      transition_id: transitionId,
      state: "stopped",
      parent_run_id: runId,
      task_path: "spartan/tasks/0001-bootstrap-fixture.md",
      approved_task_hash: null,
      policy_digest: null,
      implementer_host: null,
      implementer_launcher_id: null,
      lock_identity: null,
      reason_code: "producer_declaration_invalid",
      producer_diagnostic: null,
      unwritable_plan_targets: null,
      declaration_invalid_detail: "opening_shape",
      current_review_run_id: null,
      linked_review_run_ids: [],
      created_at: "2026-08-31T00:00:00.000Z",
      updated_at: "2026-08-31T00:00:00.000Z",
    })}\n`,
    "utf8",
  );
  const outcome = await waitForRun(root, runId);
  assert.equal(outcome.done, true);
  assert.equal(outcome.done && outcome.exitCode, 1);
  assert.ok(outcome.done && outcome.document.includes('"declaration_invalid_detail":"opening_shape"'));
  assert.ok(outcome.done && outcome.document.includes('"producer_diagnostic":null'));
  await fs.rm(root, { recursive: true, force: true });
});

test("waitForRun: awaiting_implementer, terminal transition -> emits the linked review status", async () => {
  const { root: r0 } = await makeRepo();
  const root = await fs.realpath(r0);
  const runId = "run-33333333-3333-4333-8333-333333333333";
  const reviewRunId = "run-44444444-4444-4444-8444-444444444444";
  const transitionId = "transition-33333333-3333-4333-8333-333333333333";
  const runDir = path.join(root, ".spartan-bridge", "runs", runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "status.json"), statusFixture(runId, "awaiting_implementer"), "utf8");
  const reviewDir = path.join(root, ".spartan-bridge", "runs", reviewRunId);
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(
    path.join(reviewDir, "status.json"),
    statusFixture(reviewRunId, "changes_requested", { review_kind: "implementation", reason_code: "review_passed" }),
    "utf8",
  );
  const transDir = path.join(root, ".spartan-bridge", "transitions", transitionId);
  await fs.mkdir(transDir, { recursive: true });
  await fs.writeFile(
    path.join(transDir, "status.json"),
    `${JSON.stringify({
      schema_version: 2,
      document: "transition",
      transition_id: transitionId,
      state: "completed",
      parent_run_id: runId,
      task_path: "spartan/tasks/0001-bootstrap-fixture.md",
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
    })}\n`,
    "utf8",
  );
  const outcome = await waitForRun(root, runId);
  assert.equal(outcome.done, true);
  assert.equal(outcome.done && outcome.exitCode, 0);
  assert.ok(outcome.done && outcome.document.includes(reviewRunId));
  await fs.rm(root, { recursive: true, force: true });
});

test("waitForRun: awaiting_implementer, non-terminal transition, alive pid -> phase from transition", async () => {
  const { root: r0 } = await makeRepo();
  const root = await fs.realpath(r0);
  const runId = "run-55555555-5555-4555-8555-555555555555";
  const transitionId = "transition-55555555-5555-4555-8555-555555555555";
  const updatedAt = "2026-09-02T11:31:40.000Z";
  const runDir = path.join(root, ".spartan-bridge", "runs", runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "status.json"), statusFixture(runId, "awaiting_implementer"), "utf8");
  const transDir = path.join(root, ".spartan-bridge", "transitions", transitionId);
  await fs.mkdir(transDir, { recursive: true });
  await fs.writeFile(
    path.join(transDir, "status.json"),
    `${JSON.stringify({
      schema_version: 2,
      document: "transition",
      transition_id: transitionId,
      state: "producer_running",
      parent_run_id: runId,
      task_path: "spartan/tasks/0001-bootstrap-fixture.md",
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
      updated_at: updatedAt,
    })}\n`,
    "utf8",
  );
  await fs.mkdir(path.join(root, ".spartan-bridge", "invocations"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".spartan-bridge", "invocations", `${runId}.json`),
    `${JSON.stringify({ run_id: runId, pid: process.pid, detached: true, after_run: null, created_at: "" })}\n`,
    "utf8",
  );
  const outcome = await waitForRun(root, runId);
  assert.equal(outcome.done, false);
  if (!outcome.done) {
    assert.equal(outcome.phase, "producer_running");
    assert.equal(outcome.phase_since, updatedAt);
  }
  await fs.rm(root, { recursive: true, force: true });
});

test("waitForRun: awaiting_implementer, non-terminal transition, dead pid, linked review still reviewing -> phase from transition", async () => {
  const { root: r0 } = await makeRepo();
  const root = await fs.realpath(r0);
  const runId = "run-66666666-6666-4666-8666-666666666666";
  const reviewRunId = "run-77777777-7777-4777-8777-777777777777";
  const transitionId = "transition-66666666-6666-4666-8666-666666666666";
  const runDir = path.join(root, ".spartan-bridge", "runs", runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "status.json"), statusFixture(runId, "awaiting_implementer"), "utf8");
  const reviewDir = path.join(root, ".spartan-bridge", "runs", reviewRunId);
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(
    path.join(reviewDir, "status.json"),
    statusFixture(reviewRunId, "reviewing", { review_kind: "implementation" }),
    "utf8",
  );
  const transitionUpdatedAt = "2026-09-02T11:38:37.000Z";
  const transDir = path.join(root, ".spartan-bridge", "transitions", transitionId);
  await fs.mkdir(transDir, { recursive: true });
  await fs.writeFile(
    path.join(transDir, "status.json"),
    `${JSON.stringify({
      schema_version: 2,
      document: "transition",
      transition_id: transitionId,
      state: "reviewing",
      parent_run_id: runId,
      task_path: "spartan/tasks/0001-bootstrap-fixture.md",
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
      updated_at: transitionUpdatedAt,
    })}\n`,
    "utf8",
  );
  await fs.mkdir(path.join(root, ".spartan-bridge", "invocations"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".spartan-bridge", "invocations", `${runId}.json`),
    `${JSON.stringify({ run_id: runId, pid: 2 ** 30, detached: true, after_run: null, created_at: "" })}\n`,
    "utf8",
  );
  const outcome = await waitForRun(root, runId);
  assert.equal(outcome.done, false);
  if (!outcome.done) {
    assert.equal(outcome.phase, "reviewing");
    assert.equal(outcome.phase_since, transitionUpdatedAt);
  }
  await fs.rm(root, { recursive: true, force: true });
});

test("resumeInterrupted: dead pid + non-terminal transition -> interrupted record + stale lock released", async () => {
  const { root: r0 } = await makeRepo();
  const root = await fs.realpath(r0);
  const runId = "run-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const transitionId = "transition-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

  // an awaiting_implementer plan run
  const runDir = path.join(root, ".spartan-bridge", "runs", runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, "status.json"),
    `${JSON.stringify({ schema_version: 2, run_id: runId, state: "awaiting_implementer", review_kind: "plan" })}\n`,
    "utf8",
  );
  // a non-terminal transition whose parent is that run
  const transDir = path.join(root, ".spartan-bridge", "transitions", transitionId);
  await fs.mkdir(transDir, { recursive: true });
  await fs.writeFile(
    path.join(transDir, "status.json"),
    `${JSON.stringify({
      schema_version: 2,
      document: "transition",
      transition_id: transitionId,
      state: "producer_finished",
      parent_run_id: runId,
      task_path: "spartan/tasks/0001-bootstrap-fixture.md",
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
  await fs.writeFile(path.join(transDir, "events.jsonl"), "", "utf8");
  // a stale writer lock held by that transition and a dead pid
  await fs.mkdir(path.join(root, ".spartan-bridge", "locks"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".spartan-bridge", "locks", "writer.lock"),
    `${JSON.stringify({ transition_id: transitionId, pid: 2 ** 30, repo_identity: root, acquired_at: "x" })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  // the dead invocation
  await fs.mkdir(path.join(root, ".spartan-bridge", "invocations"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".spartan-bridge", "invocations", `${runId}.json`),
    `${JSON.stringify({ run_id: runId, pid: 2 ** 30, detached: true, after_run: null, created_at: "" })}\n`,
    "utf8",
  );

  const report = await resumeInterrupted(root, () => Date.parse("2026-08-31T01:00:00.000Z"), testDeps());
  assert.equal(report.acted, true);

  const trans = JSON.parse(await fs.readFile(path.join(transDir, "status.json"), "utf8")) as { state: string; reason_code: string };
  assert.equal(trans.state, "stopped");
  assert.equal(trans.reason_code, "interrupted");
  await assert.rejects(fs.stat(path.join(root, ".spartan-bridge", "locks", "writer.lock")));

  await fs.rm(root, { recursive: true, force: true });
});

test("resumeInterrupted: no invocations -> reports nothing to do", async () => {
  const { root } = await makeRepo();
  const report = await resumeInterrupted(root, () => Date.now(), testDeps());
  assert.equal(report.acted, false);
  await fs.rm(root, { recursive: true, force: true });
});

function autoAgentsForResume(): string {
  return validAgentsMd({
    automaticImplementation: true,
    taskWrite: true,
    producerChain: true,
  });
}

async function plantChainedImplementationParent(
  root: string,
  taskRel: string,
  runId: string,
  taskHashBeforeCorrection: string,
): Promise<void> {
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
}

function transitionEventLine(
  transitionId: string,
  sequence: number,
  type: string,
  state: string,
  reviewRunId: string | null = null,
): string {
  return `${JSON.stringify({
    schema_version: SCHEMA_VERSION,
    sequence,
    timestamp: "2026-08-31T00:00:00.000Z",
    transition_id: transitionId,
    type,
    state,
    reason_code: null,
    producer_diagnostic: null,
    unwritable_plan_targets: null,
    producer_refused_paths: null,
    declaration_invalid_detail: null,
    review_run_id: reviewRunId,
  })}\n`;
}

async function seedDetachedChain(input: {
  root: string;
  runId: string;
  transitionId: string;
  taskRel: string;
  events: string[];
  transitionState?: string;
  linkedReviewRunIds?: string[];
  currentReviewRunId?: string | null;
  deadPid?: number;
  unwritablePlanTargets?: string[] | null;
  producerRefusedPaths?: string[] | null;
}): Promise<void> {
  const runDir = path.join(input.root, ".spartan-bridge", "runs", input.runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, "status.json"),
    statusFixture(input.runId, "awaiting_implementer"),
    "utf8",
  );
  const transDir = path.join(input.root, ".spartan-bridge", "transitions", input.transitionId);
  await fs.mkdir(transDir, { recursive: true });
  await fs.writeFile(
    path.join(transDir, "status.json"),
    `${JSON.stringify({
      schema_version: SCHEMA_VERSION,
      document: "transition",
      transition_id: input.transitionId,
      state: input.transitionState ?? "producer_finished",
      parent_run_id: input.runId,
      task_path: input.taskRel,
      approved_task_hash: null,
      policy_digest: null,
      implementer_host: null,
      implementer_launcher_id: null,
      lock_identity: null,
      reason_code: null,
      producer_diagnostic: null,
      unwritable_plan_targets: input.unwritablePlanTargets ?? null,
      producer_refused_paths: input.producerRefusedPaths ?? null,
      declaration_invalid_detail: null,
      current_review_run_id: input.currentReviewRunId ?? null,
      linked_review_run_ids: input.linkedReviewRunIds ?? [],
      created_at: "2026-08-31T00:00:00.000Z",
      updated_at: "2026-08-31T00:00:00.000Z",
    })}\n`,
    "utf8",
  );
  await fs.writeFile(path.join(transDir, "events.jsonl"), input.events.join(""), "utf8");
  await fs.mkdir(path.join(input.root, ".spartan-bridge", "invocations"), { recursive: true });
  await fs.writeFile(
    path.join(input.root, ".spartan-bridge", "invocations", `${input.runId}.json`),
    `${JSON.stringify({
      run_id: input.runId,
      pid: input.deadPid ?? 2 ** 30,
      detached: true,
      after_run: null,
      created_at: "2026-08-31T00:00:00.000Z",
    })}\n`,
    "utf8",
  );
}

test("resumeInterrupted: producer_finished checkpoint without a terminal linked run instructs /spbridge and does not dispatch", async () => {
  const runId = "run-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const transitionId = "transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const { root: r0, taskRel } = await makeRepo({
    agents: autoAgentsForResume(),
    task: validTaskMd({ reviewSection: `\n${DEFAULT_REVIEW_SECTION}` }),
  });
  const root = await fs.realpath(r0);
  await writeBridgeConfig(root);
  await fs.writeFile(path.join(root, taskRel), readyImplementationTask(taskRel), "utf8");
  const events = [
    transitionEventLine(transitionId, 1, "authorization", "authorized"),
    transitionEventLine(transitionId, 2, "lock_acquired", "locked"),
    transitionEventLine(transitionId, 3, "producer_started", "producer_running"),
    transitionEventLine(transitionId, 4, "path_validated", "producer_finished"),
    transitionEventLine(transitionId, 5, "producer_finished", "producer_finished"),
  ];
  await seedDetachedChain({ root, runId, transitionId, taskRel, events });
  const before = await fs.readFile(
    path.join(root, ".spartan-bridge", "transitions", transitionId, "status.json"),
    "utf8",
  );
  let reviews = 0;
  const report = await resumeInterrupted(
    root,
    () => Date.parse("2026-08-31T01:00:00.000Z"),
    testDeps({
      createAdapter: () =>
        new FakeAdapter({
          result: () => {
            reviews += 1;
            return passResult("implementation");
          },
        }),
    }),
  );
  assert.equal(report.acted, false);
  assert.equal(reviews, 0);
  assert.match(report.lines.join("\n"), /run \/spbridge on this task to dispatch the implementation review/);
  assert.match(report.lines.join("\n"), new RegExp(taskRel.replaceAll("/", "\\/")));
  const after = await fs.readFile(
    path.join(root, ".spartan-bridge", "transitions", transitionId, "status.json"),
    "utf8",
  );
  assert.equal(after, before);
  await fs.rm(root, { recursive: true, force: true });
});

test("resumeInterrupted: producer_finished with terminal linked review finalises without dispatch", async () => {
  const runId = "run-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const transitionId = "transition-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const reviewRunId = "run-cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const { root: r0, taskRel } = await makeRepo({ agents: autoAgentsForResume() });
  const root = await fs.realpath(r0);
  await writeBridgeConfig(root);
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
  const events = [
    transitionEventLine(transitionId, 1, "authorization", "authorized"),
    transitionEventLine(transitionId, 2, "lock_acquired", "locked"),
    transitionEventLine(transitionId, 3, "producer_started", "producer_running"),
    transitionEventLine(transitionId, 4, "path_validated", "producer_finished"),
    transitionEventLine(transitionId, 5, "producer_finished", "producer_finished"),
  ];
  await seedDetachedChain({
    root,
    runId,
    transitionId,
    taskRel,
    events,
    linkedReviewRunIds: [reviewRunId],
    currentReviewRunId: reviewRunId,
  });
  let reviews = 0;
  const report = await resumeInterrupted(
    root,
    () => Date.parse("2026-08-31T01:00:00.000Z"),
    testDeps({
      createAdapter: () =>
        new FakeAdapter({
          result: () => {
            reviews += 1;
            return passResult("implementation");
          },
        }),
    }),
  );
  assert.equal(report.acted, true);
  assert.equal(reviews, 0);
  const trans = JSON.parse(
    await fs.readFile(path.join(root, ".spartan-bridge", "transitions", transitionId, "status.json"), "utf8"),
  ) as { state: string };
  assert.equal(trans.state, "completed");
  await fs.rm(root, { recursive: true, force: true });
});

test("resumeInterrupted: implementation_review_result checkpoint writes terminal record", async () => {
  const runId = "run-dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const transitionId = "transition-dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const reviewRunId = "run-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const { root: r0, taskRel } = await makeRepo({ agents: autoAgentsForResume() });
  const root = await fs.realpath(r0);
  await writeBridgeConfig(root);
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
  const events = [
    transitionEventLine(transitionId, 1, "producer_finished", "producer_finished"),
    transitionEventLine(transitionId, 2, "implementation_review_dispatched", "reviewing", reviewRunId),
    transitionEventLine(transitionId, 3, "implementation_review_result", "reviewing", reviewRunId),
  ];
  await seedDetachedChain({
    root,
    runId,
    transitionId,
    taskRel,
    events,
    transitionState: "reviewing",
    linkedReviewRunIds: [reviewRunId],
    currentReviewRunId: reviewRunId,
  });
  const report = await resumeInterrupted(root, () => Date.parse("2026-08-31T01:00:00.000Z"), testDeps());
  assert.equal(report.acted, true);
  const trans = JSON.parse(
    await fs.readFile(path.join(root, ".spartan-bridge", "transitions", transitionId, "status.json"), "utf8"),
  ) as { state: string };
  assert.equal(trans.state, "completed");
  await fs.rm(root, { recursive: true, force: true });
});

test("resumeInterrupted: live invocation pid is refused without mutating the transition", async () => {
  const runId = "run-ffffffff-ffff-4fff-8fff-ffffffffffff";
  const transitionId = "transition-ffffffff-ffff-4fff-8fff-ffffffffffff";
  const { root: r0, taskRel } = await makeRepo({ agents: autoAgentsForResume() });
  const root = await fs.realpath(r0);
  await writeBridgeConfig(root);
  const events = [transitionEventLine(transitionId, 1, "producer_finished", "producer_finished")];
  await seedDetachedChain({ root, runId, transitionId, taskRel, events, deadPid: process.pid });
  const before = await fs.readFile(
    path.join(root, ".spartan-bridge", "transitions", transitionId, "status.json"),
    "utf8",
  );
  const report = await resumeInterrupted(root, () => Date.now(), testDeps());
  assert.equal(report.acted, false);
  assert.match(report.lines.join("\n"), /still alive/);
  const after = await fs.readFile(
    path.join(root, ".spartan-bridge", "transitions", transitionId, "status.json"),
    "utf8",
  );
  assert.equal(after, before);
  await fs.rm(root, { recursive: true, force: true });
});

test("resumeInterrupted: a non-terminal linked review run is refused before the lock, transition unchanged", async () => {
  const runId = "run-1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a";
  const transitionId = "transition-1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a";
  const reviewRunId = "run-2b2b2b2b-2b2b-42b2-82b2-2b2b2b2b2b2b";
  const { root: r0, taskRel } = await makeRepo({ agents: autoAgentsForResume() });
  const root = await fs.realpath(r0);
  await writeBridgeConfig(root);
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
      task_hash_after_write: null,
    })}\n`,
    "utf8",
  );
  const events = [
    transitionEventLine(transitionId, 1, "producer_finished", "producer_finished"),
    transitionEventLine(transitionId, 2, "implementation_review_dispatched", "reviewing"),
  ];
  await seedDetachedChain({
    root,
    runId,
    transitionId,
    taskRel,
    events,
    linkedReviewRunIds: [reviewRunId],
    currentReviewRunId: reviewRunId,
  });
  const transPath = path.join(root, ".spartan-bridge", "transitions", transitionId, "status.json");
  const before = await fs.readFile(transPath, "utf8");
  const report = await resumeInterrupted(root, () => Date.parse("2026-08-31T01:00:00.000Z"), testDeps());
  assert.equal(report.acted, false);
  assert.match(report.lines.join("\n"), /linked implementation-review run still live/);
  assert.equal(await fs.readFile(transPath, "utf8"), before);
  await assert.rejects(fs.stat(path.join(root, ".spartan-bridge", "locks", "writer.lock")));
  await fs.rm(root, { recursive: true, force: true });
});

test("resumeInterrupted: producer_started death stays interrupted", async () => {
  const runId = "run-12121212-1212-4121-8121-121212121212";
  const transitionId = "transition-12121212-1212-4121-8121-121212121212";
  const { root: r0, taskRel } = await makeRepo({ agents: autoAgentsForResume() });
  const root = await fs.realpath(r0);
  await writeBridgeConfig(root);
  const events = [
    transitionEventLine(transitionId, 1, "authorization", "authorized"),
    transitionEventLine(transitionId, 2, "lock_acquired", "locked"),
    transitionEventLine(transitionId, 3, "producer_started", "producer_running"),
  ];
  await seedDetachedChain({
    root,
    runId,
    transitionId,
    taskRel,
    events,
    transitionState: "producer_running",
    unwritablePlanTargets: ["AGENTS.md"],
    producerRefusedPaths: ["spartan-bridge/config.yaml"],
  });
  const report = await resumeInterrupted(root, () => Date.parse("2026-08-31T01:00:00.000Z"), testDeps());
  assert.equal(report.acted, true);
  const trans = JSON.parse(
    await fs.readFile(path.join(root, ".spartan-bridge", "transitions", transitionId, "status.json"), "utf8"),
  ) as { state: string; reason_code: string; unwritable_plan_targets: string[] | null; producer_refused_paths: string[] | null };
  assert.equal(trans.state, "stopped");
  assert.equal(trans.reason_code, "interrupted");
  assert.deepEqual(trans.unwritable_plan_targets, ["AGENTS.md"]);
  assert.deepEqual(trans.producer_refused_paths, ["spartan-bridge/config.yaml"]);
  const eventLines = (await fs.readFile(path.join(root, ".spartan-bridge", "transitions", transitionId, "events.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; unwritable_plan_targets?: string[] | null; producer_refused_paths?: string[] | null });
  assert.deepEqual(eventLines.at(-1)?.unwritable_plan_targets, ["AGENTS.md"]);
  assert.deepEqual(eventLines.at(-1)?.producer_refused_paths, ["spartan-bridge/config.yaml"]);
  await fs.rm(root, { recursive: true, force: true });
});

test("resumeInterrupted: producer_finished after correction_dispatched without a terminal linked run instructs /spbridge", async () => {
  const runId = "run-34343434-3434-4343-8343-343434343434";
  const transitionId = "transition-34343434-3434-4343-8343-343434343434";
  const priorReviewRunId = "run-45454545-4545-4545-8545-454545454545";
  const { root: r0, taskRel } = await makeRepo({
    agents: autoAgentsForResume(),
    task: validTaskMd({ reviewSection: `\n${DEFAULT_REVIEW_SECTION}` }),
  });
  const root = await fs.realpath(r0);
  await writeBridgeConfig(root);
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
  const events = [
    transitionEventLine(transitionId, 1, "producer_finished", "producer_finished"),
    transitionEventLine(transitionId, 2, "implementation_review_dispatched", "reviewing", priorReviewRunId),
    transitionEventLine(transitionId, 3, "implementation_review_result", "reviewing", priorReviewRunId),
    transitionEventLine(transitionId, 4, "correction_dispatched", "reviewing", priorReviewRunId),
    transitionEventLine(transitionId, 5, "producer_started", "producer_running"),
    transitionEventLine(transitionId, 6, "path_validated", "producer_finished"),
    transitionEventLine(transitionId, 7, "producer_finished", "producer_finished"),
  ];
  await seedDetachedChain({
    root,
    runId,
    transitionId,
    taskRel,
    events,
    linkedReviewRunIds: [priorReviewRunId],
    currentReviewRunId: priorReviewRunId,
  });
  const before = await fs.readFile(
    path.join(root, ".spartan-bridge", "transitions", transitionId, "status.json"),
    "utf8",
  );
  let reviews = 0;
  const report = await resumeInterrupted(
    root,
    () => Date.parse("2026-08-31T01:00:00.000Z"),
    testDeps({
      createAdapter: () =>
        new FakeAdapter({
          result: () => {
            reviews += 1;
            return passResult("implementation");
          },
        }),
    }),
  );
  assert.equal(report.acted, false);
  assert.equal(reviews, 0);
  assert.match(report.lines.join("\n"), /run \/spbridge on this task to dispatch the implementation review/);
  const after = await fs.readFile(
    path.join(root, ".spartan-bridge", "transitions", transitionId, "status.json"),
    "utf8",
  );
  assert.equal(after, before);
  await fs.rm(root, { recursive: true, force: true });
});

test("resumeInterrupted: linked terminal run after correction_dispatched finalises without re-dispatch", async () => {
  const runId = "run-78787878-7878-4787-8787-787878787878";
  const transitionId = "transition-89898989-8989-4898-8989-898989898989";
  const priorReviewRunId = "run-9a9a9a9a-9a9a-49a9-89a9-9a9a9a9a9a9a";
  const newReviewRunId = "run-abababab-abab-4aba-8aba-abababababab";
  const { root: r0, taskRel } = await makeRepo({
    agents: autoAgentsForResume(),
    task: validTaskMd({ reviewSection: `\n${DEFAULT_REVIEW_SECTION}` }),
  });
  const root = await fs.realpath(r0);
  await writeBridgeConfig(root);
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
  const events = [
    transitionEventLine(transitionId, 1, "producer_finished", "producer_finished"),
    transitionEventLine(transitionId, 2, "implementation_review_dispatched", "reviewing", priorReviewRunId),
    transitionEventLine(transitionId, 3, "implementation_review_result", "reviewing", priorReviewRunId),
    transitionEventLine(transitionId, 4, "correction_dispatched", "reviewing", priorReviewRunId),
    transitionEventLine(transitionId, 5, "producer_started", "producer_running"),
    transitionEventLine(transitionId, 6, "path_validated", "producer_finished"),
    transitionEventLine(transitionId, 7, "producer_finished", "producer_finished"),
  ];
  await seedDetachedChain({
    root,
    runId,
    transitionId,
    taskRel,
    events,
    linkedReviewRunIds: [priorReviewRunId, newReviewRunId],
    currentReviewRunId: newReviewRunId,
  });
  let reviews = 0;
  const report = await resumeInterrupted(
    root,
    () => Date.parse("2026-08-31T01:00:00.000Z"),
    testDeps({
      createAdapter: () =>
        new FakeAdapter({
          result: () => {
            reviews += 1;
            return passResult("implementation");
          },
        }),
    }),
  );
  assert.equal(report.acted, true);
  assert.equal(reviews, 0);
  const trans = JSON.parse(
    await fs.readFile(path.join(root, ".spartan-bridge", "transitions", transitionId, "status.json"), "utf8"),
  ) as { state: string };
  assert.equal(trans.state, "completed");
  await fs.rm(root, { recursive: true, force: true });
});

test("resumeInterrupted: second resume after close-out completes without task_artifact_write_rejected", async () => {
  const runId = "run-56565656-5656-4565-8565-565656565656";
  const transitionId = "transition-56565656-5656-4565-8565-565656565656";
  const reviewRunId = "run-67676767-6767-4676-8676-676767676767";
  const { root: r0, taskRel } = await makeRepo({ agents: autoAgentsForResume() });
  const root = await fs.realpath(r0);
  await writeBridgeConfig(root);
  const { composeTerminalCloseOut } = await import("../src/core/task-write.ts");
  const { sha256Bytes } = await import("../src/core/serialize.ts");
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
  const events = [
    transitionEventLine(transitionId, 1, "producer_finished", "producer_finished"),
    transitionEventLine(transitionId, 2, "implementation_review_dispatched", "reviewing", reviewRunId),
    transitionEventLine(transitionId, 3, "implementation_review_result", "reviewing", reviewRunId),
  ];
  await seedDetachedChain({
    root,
    runId,
    transitionId,
    taskRel,
    events,
    transitionState: "reviewing",
    linkedReviewRunIds: [reviewRunId],
    currentReviewRunId: reviewRunId,
  });
  const report = await resumeInterrupted(root, () => Date.parse("2026-08-31T01:00:00.000Z"), testDeps());
  assert.equal(report.acted, true);
  const trans = JSON.parse(
    await fs.readFile(path.join(root, ".spartan-bridge", "transitions", transitionId, "status.json"), "utf8"),
  ) as { state: string; reason_code: string | null };
  assert.equal(trans.state, "completed");
  assert.notEqual(trans.reason_code, "task_artifact_write_rejected");
  await fs.rm(root, { recursive: true, force: true });
});
