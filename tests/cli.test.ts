import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HELP_TEXT, parseArgv } from "../src/cli/parse.ts";
import {
  formatAlignedPrefix,
  formatDuration,
  formatImplementationReviewStartedLine,
  formatProducerStartedLine,
  formatReviewStartedLine,
  formatPlanReviewRecoveryLine,
  formatReviewTerminalLine,
  formatTransitionTerminalLine,
  isPlanReviewRecoveryEligible,
  isBuildStale,
  localDateTime,
  main,
  newestFileMtime,
  packageRootFromRunningModule,
  runWithElapsedTicker,
  staleBuildMessage,
  startElapsedTicker,
  STALE_BUILD_MESSAGE,
  STALE_BUILD_NEXT_ROUND_MESSAGE,
  type LocalDayTracker,
  type ProgressClock,
  type ProgressTimer,
} from "../src/cli/main.ts";
import { serializeStatus, serializeTransitionStatus } from "../src/core/serialize.ts";
import type { StatusDocument, TransitionStatusDocument } from "../src/core/contracts.ts";
import {
  constantSource,
  fileExists,
  HookThrowAdapter,
  makeRepo,
  passResult,
  testClock,
  testDeps,
  validAgentsMd,
  VALID_REGISTRY,
  withStructuredOutput,
} from "./helpers.ts";
import { runReview } from "../src/core/review.ts";
import { CursorAdapter, CURSOR_LAUNCHER_ID } from "../src/adapters/cursor.ts";
import { createLauncherCatalog, FakeAdapter, fakeCapabilities } from "../src/adapters/fake.ts";
import { formatReviewStreamLine } from "../src/adapters/review-stream.ts";
import type { ProcessRunner } from "../src/adapters/process.ts";

const cli = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));
const PINNED_TZ = "America/Sao_Paulo";
process.env.TZ = PINNED_TZ;
const TICKER_ORIGIN_MS = Date.parse("2026-08-16T12:00:00.000Z");
const STARTED_AT = "2026-08-16T12:00:00.000Z";
const OWNER_CREATED_AT = "2026-08-19T09:15:49.000Z";
const OWNER_UPDATED_AT = "2026-08-19T09:18:48.200Z";
const STARTED_INFO = {
  run_id: "run-11111111-1111-4111-8111-111111111111",
  host: "cursor" as const,
  model: "Composer-2.5",
  effort: "none" as const,
  client_context: "personal",
  created_at: STARTED_AT,
};

async function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", cli, ...args], {
      env: { ...env, NO_COLOR: "1", TZ: PINNED_TZ },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

test("wait prints phase and phase_since on the running line", async () => {
  const { root: r0 } = await makeRepo();
  const root = await fs.realpath(r0);
  const runId = "run-cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const updatedAt = "2026-09-02T11:05:00.000Z";
  const runDir = path.join(root, ".spartan-bridge", "runs", runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, "status.json"),
    `${JSON.stringify({
      schema_version: 2,
      run_id: runId,
      state: "reviewing",
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
      created_at: updatedAt,
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
  const result = await runCli(["wait", "--repo", root, "--run", runId, "--timeout-ms", "1"]);
  assert.equal(result.code, 0, result.stderr);
  const line = JSON.parse(result.stdout.trim()) as {
    state: string;
    run_id: string;
    phase: string;
    phase_since: string;
  };
  assert.equal(line.state, "running");
  assert.equal(line.run_id, runId);
  assert.equal(line.phase, "reviewing");
  assert.equal(line.phase_since, updatedAt);
  await fs.rm(root, { recursive: true, force: true });
});

// Task 0070 D3: `wait` names the rebuild after a terminal document, and only
// then. The fixtures keep the package (whose `src`/`dist` decide staleness)
// separate from the repository the run lives in, exactly as a linked install
// and a managed checkout are separate.
async function stageWaitRun(state: string): Promise<{ root: string; runId: string }> {
  const { root: r0 } = await makeRepo();
  const root = await fs.realpath(r0);
  const runId = "run-dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const runDir = path.join(root, ".spartan-bridge", "runs", runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, "status.json"),
    `${JSON.stringify({
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
      created_at: "2026-09-04T11:00:00.000Z",
      updated_at: "2026-09-04T11:00:00.000Z",
    })}\n`,
    "utf8",
  );
  await fs.mkdir(path.join(root, ".spartan-bridge", "invocations"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".spartan-bridge", "invocations", `${runId}.json`),
    `${JSON.stringify({ run_id: runId, pid: process.pid, detached: true, after_run: null, created_at: "" })}\n`,
    "utf8",
  );
  return { root, runId };
}

test("wait names the rebuild after a terminal document on a stale package", async () => {
  const staged = await stageTimedPackage("stale");
  const { root, runId } = await stageWaitRun("failed");
  const result = await runCliWithModule(staged.buildFile, [
    "wait",
    "--repo",
    root,
    "--run",
    runId,
    "--timeout-ms",
    "1",
  ]);
  const document = JSON.parse(result.stdout.trim()) as { run_id: string; state: string };
  assert.equal(document.run_id, runId);
  assert.equal(document.state, "failed");
  assert.equal(result.stderr.includes(STALE_BUILD_MESSAGE), true);
  assert.equal(result.stderr.includes(STALE_BUILD_NEXT_ROUND_MESSAGE), true);
  await fs.rm(staged.root, { recursive: true, force: true });
  await fs.rm(root, { recursive: true, force: true });
});

test("wait adds no rebuild line when the package is current", async () => {
  const staged = await stageTimedPackage("current");
  const { root, runId } = await stageWaitRun("failed");
  const result = await runCliWithModule(staged.buildFile, [
    "wait",
    "--repo",
    root,
    "--run",
    runId,
    "--timeout-ms",
    "1",
  ]);
  assert.equal((JSON.parse(result.stdout.trim()) as { state: string }).state, "failed");
  assert.equal(result.stderr.includes(STALE_BUILD_MESSAGE), false);
  assert.equal(result.stderr.includes(STALE_BUILD_NEXT_ROUND_MESSAGE), false);
  await fs.rm(staged.root, { recursive: true, force: true });
  await fs.rm(root, { recursive: true, force: true });
});

test("wait adds no rebuild line to a running document however stale the package", async () => {
  const staged = await stageTimedPackage("stale");
  const { root, runId } = await stageWaitRun("reviewing");
  const result = await runCliWithModule(staged.buildFile, [
    "wait",
    "--repo",
    root,
    "--run",
    runId,
    "--timeout-ms",
    "1",
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal((JSON.parse(result.stdout.trim()) as { state: string }).state, "running");
  assert.equal(result.stderr.includes(STALE_BUILD_MESSAGE), true);
  assert.equal(result.stderr.includes(STALE_BUILD_NEXT_ROUND_MESSAGE), false);
  await fs.rm(staged.root, { recursive: true, force: true });
  await fs.rm(root, { recursive: true, force: true });
});

test("wait adds no rebuild line to a stale_build document or to a chain that never ran", async () => {
  const staged = await stageTimedPackage("stale");
  const { root: r0 } = await makeRepo();
  const root = await fs.realpath(r0);
  const invocations = path.join(root, ".spartan-bridge", "invocations");
  await fs.mkdir(invocations, { recursive: true });

  // A dead child that left the stale-build marker: D-062 already governs it.
  const refusedId = "run-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  await fs.writeFile(
    path.join(invocations, `${refusedId}.json`),
    `${JSON.stringify({ run_id: refusedId, pid: 2147483646, detached: true, after_run: null, created_at: "" })}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(invocations, `${refusedId}.detach.log`),
    "dist/ is older than src/; run npm run build\n",
    "utf8",
  );
  const refused = await runCliWithModule(staged.buildFile, [
    "wait",
    "--repo",
    root,
    "--run",
    refusedId,
    "--timeout-ms",
    "1",
  ]);
  assert.equal((JSON.parse(refused.stdout.trim()) as { reason_code: string }).reason_code, "stale_build");
  assert.equal(refused.stderr.includes(STALE_BUILD_NEXT_ROUND_MESSAGE), false);

  // A dead child that created nothing: the resume error already governs it.
  const emptyId = "run-ffffffff-ffff-4fff-8fff-ffffffffffff";
  await fs.writeFile(
    path.join(invocations, `${emptyId}.json`),
    `${JSON.stringify({ run_id: emptyId, pid: 2147483646, detached: true, after_run: null, created_at: "" })}\n`,
    "utf8",
  );
  const empty = await runCliWithModule(staged.buildFile, [
    "wait",
    "--repo",
    root,
    "--run",
    emptyId,
    "--timeout-ms",
    "1",
  ]);
  assert.equal(empty.stderr.includes("never created a run"), true);
  assert.equal(empty.stderr.includes(STALE_BUILD_NEXT_ROUND_MESSAGE), false);

  await fs.rm(staged.root, { recursive: true, force: true });
  await fs.rm(root, { recursive: true, force: true });
});

test("help lists review status events doctor policy and mcp-stdio", async () => {
  const result = await runCli(["--help"]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, HELP_TEXT);
  assert.match(result.stdout, /\breview\b/);
  assert.match(result.stdout, /\bstatus\b/);
  assert.match(result.stdout, /\bevents\b/);
  assert.match(result.stdout, /\bdoctor\b/);
  assert.match(result.stdout, /\bpolicy\b/);
  assert.match(result.stdout, /\bmcp-stdio\b/);
  assert.doesNotMatch(result.stdout, /\bstart\b/);
});

test("CLI runs when invoked through a bin symlink", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-bridge-bin-"));
  const link = path.join(dir, "spartan-bridge");
  await fs.symlink(cli, link);
  assert.notEqual(path.resolve(link), await fs.realpath(link));
  const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", link, "--help"], {
      env: { ...process.env, NO_COLOR: "1", TZ: PINNED_TZ },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, HELP_TEXT);
  await fs.rm(dir, { recursive: true, force: true });
});

test("syntax failures and invalid repo roots create no run", async () => {
  const { root } = await makeRepo();
  const usage = await runCli(["review", "--repo", root, "--kind", "plan"]);
  assert.equal(usage.code, 2);
  assert.equal(await fileExists(path.join(root, ".spartan-bridge")), false);
  const missing = await runCli(["review", "--repo", path.join(root, "no-such-repo"), "--task", "spartan/tasks/x.md"]);
  assert.equal(missing.code, 1);
  assert.equal(await fileExists(path.join(root, ".spartan-bridge")), false);
  const notDir = await runCli(["review", "--repo", path.join(root, "AGENTS.md"), "--task", "spartan/tasks/x.md"]);
  assert.equal(notDir.code, 1);
  assert.equal(await fileExists(path.join(root, ".spartan-bridge")), false);
  await fs.rm(root, { recursive: true, force: true });
});

test("unsafe runtime root creates no run", async () => {
  const { root, taskRel } = await makeRepo();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-bridge-outside-"));
  await fs.symlink(outside, path.join(root, ".spartan-bridge"));
  const result = await runCli(["review", "--repo", root, "--task", taskRel]);
  assert.equal(result.code, 1);
  const entries = await fs.readdir(outside);
  assert.equal(entries.length, 0);
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

test("production CLI fake returns human_required and persists events", async () => {
  const { root, taskRel } = await makeRepo({ agents: validAgentsMd() });
  const xdg = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-xdg-"));
  await fs.mkdir(path.join(xdg, "spartan-bridge"), { recursive: true });
  await fs.writeFile(path.join(xdg, "spartan-bridge", "client-contexts.yaml"), VALID_REGISTRY, "utf8");
  const result = await runCli(["review", "--repo", root, "--task", taskRel], {
    ...process.env,
    XDG_CONFIG_HOME: xdg,
  });
  assert.equal(result.code, 0, result.stderr);
  const status = JSON.parse(result.stdout) as StatusDocument;
  assert.equal(status.reason_code, "review_human_required");
  assert.equal(status.state, "human_required");
  assert.equal(status.model, "Composer-2.5");
  assert.equal(status.effort, "none");
  assert.equal(status.model_observed, "declared_unobserved");
  assert.equal(result.stdout, serializeStatus(status));
  const start = localDateTime(Date.parse(status.created_at));
  const tracker: LocalDayTracker = { lastDayKey: start.dayKey };
  assert.equal(
    result.stderr,
    `${start.date} ${start.time} review ${status.run_id} host=cursor model=Composer-2.5 effort=none client-context=personal\n${formatReviewTerminalLine(status, tracker)}`,
  );
  assert.doesNotMatch(result.stderr, /^elapsed /m);
  assert.doesNotMatch(result.stderr, /quiet /);
  const inspect = await runCli(["status", "--repo", root, "--run", status.run_id], {
    ...process.env,
    XDG_CONFIG_HOME: xdg,
  });
  assert.equal(inspect.code, 0);
  const events = await runCli(["events", "--repo", root, "--run", status.run_id], {
    ...process.env,
    XDG_CONFIG_HOME: xdg,
  });
  assert.equal(events.code, 0);
  assert.match(events.stdout, /run_requested/);
  assert.match(events.stdout, /run_terminal/);
  const doctor = await runCli(["doctor", "--repo", root], { ...process.env, XDG_CONFIG_HOME: xdg });
  assert.equal(doctor.code, 0);
  assert.match(doctor.stdout, /^repo: readable\npolicy: configured; resolves\nregistry:/);
  assert.match(doctor.stdout, /fake-reviewer-v1/);
  assert.match(doctor.stdout, /cursor-plan-reviewer-v1/);
  assert.match(doctor.stdout, /binding reviewer\.plan: adapter available; launcher=fake-reviewer-v1/);
  assert.match(doctor.stdout, /binding reviewer\.implementation: adapter available; launcher=fake-reviewer-v1/);
  assert.match(doctor.stdout, /binding implementer: adapter available; launcher=fake-reviewer-v1/);
  assert.doesNotMatch(doctor.stdout, /Model \/ Effort/);
  assert.doesNotMatch(doctor.stdout, /binding_model/);
  assert.doesNotMatch(doctor.stdout, /authenti/i);
  assert.doesNotMatch(doctor.stdout, /billing/i);
  assert.doesNotMatch(doctor.stdout, /account identity/i);
  assert.doesNotMatch(doctor.stdout, /ready to review/i);
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(xdg, { recursive: true, force: true });
});

test("task and runtime symlink escapes are rejected", async () => {
  const { root, taskRel } = await makeRepo();
  const outsideFile = path.join(os.tmpdir(), `spartan-escape-${Date.now()}.md`);
  await fs.writeFile(outsideFile, validAgentsMd(), "utf8");
  const escapeRel = "spartan/tasks/escape.md";
  await fs.symlink(outsideFile, path.join(root, escapeRel));
  const xdg = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-xdg-"));
  await fs.mkdir(path.join(xdg, "spartan-bridge"), { recursive: true });
  await fs.writeFile(path.join(xdg, "spartan-bridge", "client-contexts.yaml"), VALID_REGISTRY, "utf8");
  const result = await runCli(["review", "--repo", root, "--task", escapeRel], {
    ...process.env,
    XDG_CONFIG_HOME: xdg,
  });
  assert.equal(result.code, 1);
  const status = JSON.parse(result.stdout) as { reason_code: string };
  assert.equal(status.reason_code, "path_invalid");
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(xdg, { recursive: true, force: true });
  await fs.rm(outsideFile, { force: true });
  void taskRel;
});

test("status prints stored schema-1 bytes verbatim", async () => {
  const { root } = await makeRepo();
  const runId = "run-aaaaaaaa-1111-4111-8111-111111111111";
  const runDir = path.join(root, ".spartan-bridge", "runs", runId);
  await fs.mkdir(runDir, { recursive: true });
  const stored =
    '{"schema_version":1,"run_id":"run-aaaaaaaa-1111-4111-8111-111111111111","state":"failed","review_kind":"plan","task_path":"spartan/tasks/x.md","policy_digest":null,"artifact_hashes":{"task":null,"agents":null},"execution_id":null,"verdict":null,"reason_code":"path_invalid","created_at":"2026-08-16T12:00:00.000Z","updated_at":"2026-08-16T12:00:00.000Z"}\n';
  await fs.writeFile(path.join(runDir, "status.json"), stored, "utf8");
  const result = await runCli(["status", "--repo", root, "--run", runId]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, stored);
  assert.equal(result.stdout.includes("task_write_state"), false);
  await fs.rm(root, { recursive: true, force: true });
});

test("doctor exits 0 when the repository is not configured for the Bridge", async () => {
  const { root } = await makeRepo({ agents: "# Project\n\nNo hosts.\n" });
  const result = await runCli(["doctor", "--repo", root]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^repo: readable\npolicy: not configured\nregistry:/);
  assert.match(result.stdout, /binding reviewer\.plan: adapter unavailable; reason=policy_unavailable/);
  assert.match(result.stdout, /binding reviewer\.implementation: adapter unavailable; reason=policy_unavailable/);
  assert.match(result.stdout, /binding implementer: adapter unavailable; reason=policy_unavailable/);
  await fs.rm(root, { recursive: true, force: true });
});

const T0 = new Date("2024-01-01T00:00:00Z");
const T1 = new Date("2024-01-01T00:00:10Z");
const T2 = new Date("2024-01-01T00:00:20Z");

async function stagePackage(options?: { src?: boolean }): Promise<{
  root: string;
  srcDir: string;
  nestedFile: string;
  topFile: string;
  buildFile: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-stale-"));
  const srcDir = path.join(root, "src");
  const nestedFile = path.join(srcDir, "nested", "file.ts");
  const topFile = path.join(srcDir, "top.ts");
  const buildFile = path.join(root, "dist", "cli", "main.js");
  await fs.mkdir(path.join(root, "dist", "cli"), { recursive: true });
  await fs.writeFile(buildFile, "build\n", "utf8");
  if (options?.src !== false) {
    await fs.mkdir(path.join(srcDir, "nested"), { recursive: true });
    await fs.writeFile(nestedFile, "nested\n", "utf8");
    await fs.writeFile(topFile, "top\n", "utf8");
  }
  return { root, srcDir, nestedFile, topFile, buildFile };
}

async function stageTimedPackage(freshness: "stale" | "current"): Promise<{
  root: string;
  srcDir: string;
  nestedFile: string;
  topFile: string;
  buildFile: string;
}> {
  const staged = await stagePackage();
  await fs.utimes(staged.topFile, T0, T0);
  await fs.utimes(staged.srcDir, T0, T0);
  await fs.utimes(staged.buildFile, T1, T1);
  const sourceTime = freshness === "stale" ? T2 : T0;
  await fs.utimes(staged.nestedFile, sourceTime, sourceTime);
  return staged;
}

const STORED_STATUS =
  '{"schema_version":1,"run_id":"run-aaaaaaaa-1111-4111-8111-111111111111","state":"failed","review_kind":"plan","task_path":"spartan/tasks/x.md","policy_digest":null,"artifact_hashes":{"task":null,"agents":null},"execution_id":null,"verdict":null,"reason_code":"path_invalid","created_at":"2026-08-16T12:00:00.000Z","updated_at":"2026-08-16T12:00:00.000Z"}\n';
const STORED_RUN_ID = "run-aaaaaaaa-1111-4111-8111-111111111111";
const STORED_EVENTS = '{"type":"run_requested"}\n';
const STORED_TRANSITION_ID = "transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STORED_TRANSITION_STATUS = '{"document":"transition","transition_id":"transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}\n';
const STORED_TRANSITION_EVENTS = '{"type":"authorization"}\n';

async function seedStoredRun(root: string): Promise<string> {
  const runDir = path.join(root, ".spartan-bridge", "runs", STORED_RUN_ID);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "status.json"), STORED_STATUS, "utf8");
  await fs.writeFile(path.join(runDir, "events.jsonl"), STORED_EVENTS, "utf8");
  return path.join(root, ".spartan-bridge", "runs");
}

async function seedStoredTransition(root: string): Promise<void> {
  const transitionDir = path.join(root, ".spartan-bridge", "transitions", STORED_TRANSITION_ID);
  await fs.mkdir(transitionDir, { recursive: true });
  await fs.writeFile(path.join(transitionDir, "status.json"), STORED_TRANSITION_STATUS, "utf8");
  await fs.writeFile(path.join(transitionDir, "events.jsonl"), STORED_TRANSITION_EVENTS, "utf8");
}

test("transition-status and transition-events reject directory and file symlink escapes", async () => {
  const secret = "OUTSIDE-TRANSITION-SECRET\n";
  const { root } = await makeRepo();
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-transition-dir-"));
  await fs.writeFile(path.join(outsideDir, "status.json"), secret, "utf8");
  await fs.writeFile(path.join(outsideDir, "events.jsonl"), secret, "utf8");
  await fs.mkdir(path.join(root, ".spartan-bridge", "transitions"), { recursive: true });
  await fs.symlink(outsideDir, path.join(root, ".spartan-bridge", "transitions", STORED_TRANSITION_ID));
  for (const command of ["transition-status", "transition-events"] as const) {
    const result = await runCli([command, "--repo", root, "--transition", STORED_TRANSITION_ID]);
    assert.equal(result.code, 1, command);
    assert.equal(result.stdout, "", command);
    assert.equal(result.stderr, "error: transition does not exist\n", command);
  }
  assert.equal(await fs.readFile(path.join(outsideDir, "status.json"), "utf8"), secret);
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outsideDir, { recursive: true, force: true });

  const fileRoot = (await makeRepo()).root;
  await seedStoredTransition(fileRoot);
  const outsideStatus = path.join(os.tmpdir(), `spartan-transition-status-${Date.now()}.json`);
  const outsideEvents = path.join(os.tmpdir(), `spartan-transition-events-${Date.now()}.jsonl`);
  await fs.writeFile(outsideStatus, secret, "utf8");
  await fs.writeFile(outsideEvents, secret, "utf8");
  const statusPath = path.join(fileRoot, ".spartan-bridge", "transitions", STORED_TRANSITION_ID, "status.json");
  const eventsPath = path.join(fileRoot, ".spartan-bridge", "transitions", STORED_TRANSITION_ID, "events.jsonl");
  await fs.rm(statusPath);
  await fs.symlink(outsideStatus, statusPath);
  const statusResult = await runCli(["transition-status", "--repo", fileRoot, "--transition", STORED_TRANSITION_ID]);
  assert.equal(statusResult.code, 1);
  assert.equal(statusResult.stdout, "");
  assert.doesNotMatch(statusResult.stdout, /OUTSIDE-TRANSITION-SECRET/);
  assert.equal(statusResult.stderr, "error: transition does not exist\n");
  await fs.rm(eventsPath);
  await fs.symlink(outsideEvents, eventsPath);
  const eventsResult = await runCli(["transition-events", "--repo", fileRoot, "--transition", STORED_TRANSITION_ID]);
  assert.equal(eventsResult.code, 1);
  assert.equal(eventsResult.stdout, "");
  assert.doesNotMatch(eventsResult.stdout, /OUTSIDE-TRANSITION-SECRET/);
  assert.equal(eventsResult.stderr, "error: transition does not exist\n");
  assert.equal(await fs.readFile(outsideStatus, "utf8"), secret);
  assert.equal(await fs.readFile(outsideEvents, "utf8"), secret);
  await fs.rm(fileRoot, { recursive: true, force: true });
  await fs.rm(outsideStatus, { force: true });
  await fs.rm(outsideEvents, { force: true });
});

async function runCliWithModule(
  moduleFile: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-stale-run-"));
  const harness = path.join(dir, "run-main.mjs");
  const mainUrl = new URL("../src/cli/main.ts", import.meta.url).href;
  await fs.writeFile(
    harness,
    `import { main } from ${JSON.stringify(mainUrl)};\nconst code = await main(process.argv.slice(3), process.env, process.argv[2]);\nprocess.exit(code);\n`,
    "utf8",
  );
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", harness, moduleFile, ...args], {
      env: { ...env, NO_COLOR: "1", TZ: PINNED_TZ },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      void fs.rm(dir, { recursive: true, force: true });
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

test("newest file mtime ignores directory timestamps and comparison covers nested stale, newer build, equal, and absent src", async () => {
  const nestedNewer = await stagePackage();
  await fs.utimes(nestedNewer.topFile, T0, T0);
  await fs.utimes(nestedNewer.srcDir, T0, T0);
  await fs.utimes(nestedNewer.buildFile, T1, T1);
  await fs.utimes(nestedNewer.nestedFile, T2, T2);
  const srcDirStat = await fs.stat(nestedNewer.srcDir);
  const buildStat = await fs.stat(nestedNewer.buildFile);
  const nestedStat = await fs.stat(nestedNewer.nestedFile);
  assert.ok(srcDirStat.mtimeMs < buildStat.mtimeMs);
  assert.ok(buildStat.mtimeMs < nestedStat.mtimeMs);
  const nestedNewest = await newestFileMtime(nestedNewer.srcDir);
  assert.equal(nestedNewest, nestedStat.mtimeMs);
  assert.equal(isBuildStale(nestedNewest, buildStat.mtimeMs), true);
  assert.equal(await staleBuildMessage(nestedNewer.root), STALE_BUILD_MESSAGE);
  await fs.rm(nestedNewer.root, { recursive: true, force: true });

  const newerBuild = await stagePackage();
  await fs.utimes(newerBuild.topFile, T0, T0);
  await fs.utimes(newerBuild.nestedFile, T0, T0);
  await fs.utimes(newerBuild.srcDir, T0, T0);
  await fs.utimes(newerBuild.buildFile, T1, T1);
  const freshBuild = await fs.stat(newerBuild.buildFile);
  const freshNewest = await newestFileMtime(newerBuild.srcDir);
  assert.equal(isBuildStale(freshNewest, freshBuild.mtimeMs), false);
  assert.equal(await staleBuildMessage(newerBuild.root), undefined);
  await fs.rm(newerBuild.root, { recursive: true, force: true });

  const equalTimes = await stagePackage();
  await fs.utimes(equalTimes.topFile, T1, T1);
  await fs.utimes(equalTimes.nestedFile, T1, T1);
  await fs.utimes(equalTimes.srcDir, T1, T1);
  await fs.utimes(equalTimes.buildFile, T1, T1);
  const equalBuild = await fs.stat(equalTimes.buildFile);
  const equalNewest = await newestFileMtime(equalTimes.srcDir);
  assert.equal(isBuildStale(equalNewest, equalBuild.mtimeMs), false);
  assert.equal(await staleBuildMessage(equalTimes.root), undefined);
  await fs.rm(equalTimes.root, { recursive: true, force: true });

  const absentSrc = await stagePackage({ src: false });
  assert.equal(await newestFileMtime(absentSrc.srcDir), undefined);
  assert.equal(isBuildStale(undefined, T1.getTime()), false);
  assert.equal(await staleBuildMessage(absentSrc.root), undefined);
  await fs.rm(absentSrc.root, { recursive: true, force: true });
});

test("CLI warns on stderr for a nested newer source and continues with stdout unchanged", async () => {
  const staged = await stagePackage();
  await fs.utimes(staged.topFile, T0, T0);
  await fs.utimes(staged.srcDir, T0, T0);
  await fs.utimes(staged.buildFile, T1, T1);
  await fs.utimes(staged.nestedFile, T2, T2);
  const result = await runCliWithModule(staged.buildFile, ["--help"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, HELP_TEXT);
  assert.equal(result.stderr, `${STALE_BUILD_MESSAGE}\n`);
  await fs.rm(staged.root, { recursive: true, force: true });
});

test("CLI writes no stale-build message when the build is newer or the package has no src/", async () => {
  const newerBuild = await stagePackage();
  await fs.utimes(newerBuild.topFile, T0, T0);
  await fs.utimes(newerBuild.nestedFile, T0, T0);
  await fs.utimes(newerBuild.srcDir, T0, T0);
  await fs.utimes(newerBuild.buildFile, T1, T1);
  assert.equal(packageRootFromRunningModule(newerBuild.buildFile), newerBuild.root);
  const fresh = await runCliWithModule(newerBuild.buildFile, ["--help"]);
  assert.equal(fresh.code, 0, fresh.stderr);
  assert.equal(fresh.stdout, HELP_TEXT);
  assert.equal(fresh.stderr, "");
  await fs.rm(newerBuild.root, { recursive: true, force: true });

  const absentSrc = await stagePackage({ src: false });
  assert.equal(packageRootFromRunningModule(absentSrc.buildFile), absentSrc.root);
  const none = await runCliWithModule(absentSrc.buildFile, ["--help"]);
  assert.equal(none.code, 0, none.stderr);
  assert.equal(none.stdout, HELP_TEXT);
  assert.equal(none.stderr, "");
  await fs.rm(absentSrc.root, { recursive: true, force: true });
});

function captureStream(isTTY?: boolean): {
  write(chunk: string): boolean;
  text(): string;
  bytes(): Buffer;
} & { isTTY?: boolean } {
  const chunks: Buffer[] = [];
  const stream: {
    write(chunk: string): boolean;
    text(): string;
    bytes(): Buffer;
    isTTY?: boolean;
  } = {
    write(chunk: string) {
      chunks.push(Buffer.from(String(chunk), "utf8"));
      return true;
    },
    text() {
      return Buffer.concat(chunks).toString("utf8");
    },
    bytes() {
      return Buffer.concat(chunks);
    },
  };
  if (isTTY !== undefined) {
    stream.isTTY = isTTY;
  }
  return stream;
}

function assertStderrBytes(bytes: Buffer): void {
  assert.equal(bytes.includes(0x0d), false);
  assert.equal(bytes.includes(0x1b), false);
  const text = bytes.toString("utf8");
  if (text.length > 0) {
    assert.equal(text.endsWith("\n"), true);
  }
}

function assertAuthBoundary(text: string): void {
  assert.doesNotMatch(text, /\/Users\/|\/home\/|~\/\.config|\\Users\\/);
  assert.doesNotMatch(text, /CURSOR_API_KEY|api[_-]?key|Bearer |codex login|claude login/i);
  assert.doesNotMatch(text, /fake-reviewer-v1|cursor-plan-reviewer-v1|--print|--api-key/);
}

async function withXdg(): Promise<{ env: NodeJS.ProcessEnv; cleanup: () => Promise<void> }> {
  const xdg = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-xdg-"));
  await fs.mkdir(path.join(xdg, "spartan-bridge"), { recursive: true });
  await fs.writeFile(path.join(xdg, "spartan-bridge", "client-contexts.yaml"), VALID_REGISTRY, "utf8");
  return {
    env: { ...process.env, XDG_CONFIG_HOME: xdg },
    cleanup: async () => {
      await fs.rm(xdg, { recursive: true, force: true });
    },
  };
}

function captureStdout(): { write(chunk: string): boolean; text(): string } {
  const chunks: string[] = [];
  return {
    write(chunk: string) {
      chunks.push(String(chunk));
      return true;
    },
    text() {
      return chunks.join("");
    },
  };
}

function cadenceTimer(originMs = TICKER_ORIGIN_MS): {
  clock: ProgressClock;
  timer: ProgressTimer;
  unrefed: boolean;
  cleared: boolean;
  delayMs: number | undefined;
  originMs: number;
  tick(): void;
} {
  let now = originMs;
  let callback: (() => void) | undefined;
  const state = {
    clock: { now: () => now },
    unrefed: false,
    cleared: false,
    delayMs: undefined as number | undefined,
    originMs,
    tick() {
      now += state.delayMs ?? 10_000;
      callback?.();
    },
    timer: {
      setInterval(cb: () => void, delay: number) {
        state.delayMs = delay;
        callback = cb;
        return {
          unref() {
            state.unrefed = true;
          },
        };
      },
      clearInterval() {
        state.cleared = true;
        callback = undefined;
      },
    },
  };
  return state;
}

function immediateTicks(times: number, originMs = Date.now()): {
  clock: ProgressClock;
  timer: ProgressTimer;
  unrefed: boolean;
  cleared: boolean;
  originMs: number;
} {
  let now = originMs;
  const state = {
    originMs,
    clock: { now: () => now },
    unrefed: false,
    cleared: false,
    timer: {
      setInterval(cb: () => void, delay: number) {
        for (let i = 0; i < times; i++) {
          now += delay;
          cb();
        }
        return {
          unref() {
            state.unrefed = true;
          },
        };
      },
      clearInterval() {
        state.cleared = true;
      },
    },
  };
  return state;
}

test("quiet ticker emits every 10s on a TTY and nothing off a TTY", () => {
  const tty = captureStream(true);
  const cadence = cadenceTimer();
  const ticker = startElapsedTicker(tty, cadence.clock, cadence.timer);
  assert.equal(cadence.delayMs, 10_000);
  assert.equal(cadence.unrefed, true);
  assert.equal(tty.text(), "");
  cadence.tick();
  cadence.tick();
  assert.equal(tty.text(), "16/08 09:00:10 quiet 10s\n      09:00:20 quiet 20s\n");
  ticker.stop();
  assert.equal(cadence.cleared, true);
  ticker.stop();
  assertStderrBytes(tty.bytes());
  assert.doesNotMatch(tty.text(), /elapsed /);

  const pipe = captureStream(false);
  let setCalled = false;
  const silent = startElapsedTicker(pipe, { now: () => TICKER_ORIGIN_MS }, {
    setInterval() {
      setCalled = true;
      return {
        unref() {
          return;
        },
      };
    },
    clearInterval() {
      return;
    },
  });
  assert.equal(setCalled, false);
  assert.equal(pipe.text(), "");
  silent.stop();

  const unmarked = captureStream();
  startElapsedTicker(unmarked, { now: () => TICKER_ORIGIN_MS }, {
    setInterval() {
      throw new Error("non-TTY must not start an interval");
    },
    clearInterval() {
      return;
    },
  });
  assert.equal(unmarked.text(), "");
});

test("quiet ticker stops on thrown review bodies and never starts when review_started is skipped", async () => {
  const thrown = captureStream(true);
  const thrownTimer = cadenceTimer();
  await assert.rejects(
    () =>
      runWithElapsedTicker(thrown, thrownTimer.clock, thrownTimer.timer, async (progress) => {
        progress.started(STARTED_INFO);
        throw new Error("boom");
      }),
    /boom/,
  );
  assert.equal(thrownTimer.unrefed, true);
  assert.equal(thrownTimer.cleared, true);
  assert.equal(
    thrown.text(),
    "16/08 09:00:00 review run-11111111-1111-4111-8111-111111111111 host=cursor model=Composer-2.5 effort=none client-context=personal\n",
  );

  const skipped = captureStream(true);
  const skippedTimer = cadenceTimer();
  const { root, taskRel } = await makeRepo();
  const outcome = await runWithElapsedTicker(skipped, skippedTimer.clock, skippedTimer.timer, (progress) =>
    runReview(
      { repo: root, task: taskRel },
      testDeps({
        clock: testClock(),
        createAdapter: () => new HookThrowAdapter(constantSource(passResult()), "prepare", new Error("nope")),
      }),
      progress,
    ),
  );
  assert.equal(outcome.status?.reason_code, "adapter_error");
  assert.equal(skippedTimer.delayMs, undefined);
  assert.equal(skippedTimer.cleared, false);
  assert.equal(skipped.text(), "");
  await fs.rm(root, { recursive: true, force: true });
});

test("review stderr order on a TTY is resolved, quiet, then terminal", async () => {
  const staged = await stageTimedPackage("current");
  const { root, taskRel } = await makeRepo({ agents: validAgentsMd() });
  const xdg = await withXdg();
  const stdout = captureStdout();
  const stderr = captureStream(true);
  const ticks = immediateTicks(2);
  try {
    const code = await main(["review", "--repo", root, "--task", taskRel], xdg.env, staged.buildFile, {
      stdout,
      stderr,
      clock: ticks.clock,
      timer: ticks.timer,
    });
    assert.equal(code, 0, stderr.text());
    const status = JSON.parse(stdout.text()) as StatusDocument;
    assert.equal(stdout.text(), serializeStatus(status));
    assert.equal(status.state, "human_required");
    const start = localDateTime(Date.parse(status.created_at));
    const tracker: LocalDayTracker = { lastDayKey: start.dayKey };
    const expected = [
      `${start.date} ${start.time} review ${status.run_id} host=cursor model=Composer-2.5 effort=none client-context=personal`,
      `${formatAlignedPrefix(ticks.originMs + 10_000, tracker)}quiet 10s`,
      `${formatAlignedPrefix(ticks.originMs + 20_000, tracker)}quiet 20s`,
      formatReviewTerminalLine(status, tracker).trimEnd(),
      "",
    ].join("\n");
    assert.equal(stderr.text(), expected);
    assert.doesNotMatch(stderr.text(), /elapsed /);
    assert.doesNotMatch(stderr.text(), new RegExp(STALE_BUILD_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(ticks.unrefed, true);
    assert.equal(ticks.cleared, true);
    assertStderrBytes(stderr.bytes());
    assertAuthBoundary(stderr.text());
  } finally {
    await xdg.cleanup();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(staged.root, { recursive: true, force: true });
  }
});

test("review stderr off a TTY has no quiet line and still names the terminal reason when verdict is null", async () => {
  const staged = await stagePackage();
  await fs.utimes(staged.topFile, T0, T0);
  await fs.utimes(staged.nestedFile, T0, T0);
  await fs.utimes(staged.srcDir, T0, T0);
  await fs.utimes(staged.buildFile, T1, T1);
  const { root } = await makeRepo({ agents: validAgentsMd() });
  const xdg = await withXdg();
  const stdout = captureStdout();
  const stderr = captureStream(false);
  let setCalled = false;
  try {
    const code = await main(["review", "--repo", root, "--task", "../secret.md"], xdg.env, staged.buildFile, {
      stdout,
      stderr,
      clock: { now: () => 0 },
      timer: {
        setInterval() {
          setCalled = true;
          return {
            unref() {
              return;
            },
          };
        },
        clearInterval() {
          return;
        },
      },
    });
    assert.equal(code, 1);
    const status = JSON.parse(stdout.text()) as StatusDocument;
    assert.equal(stdout.text(), serializeStatus(status));
    assert.equal(status.verdict, null);
    assert.equal(status.reason_code, "path_invalid");
    assert.equal(setCalled, false);
    assert.equal(stderr.text(), formatReviewTerminalLine(status, { lastDayKey: undefined }));
    assert.match(stderr.text(), /^\d{2}\/\d{2} \d{2}:\d{2}:\d{2} review failed reason=path_invalid took /);
    assert.doesNotMatch(stderr.text(), /elapsed |quiet /);
    assertStderrBytes(stderr.bytes());
    assertAuthBoundary(stderr.text());
  } finally {
    await xdg.cleanup();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(staged.root, { recursive: true, force: true });
  }
});

test("review stderr off a TTY omits quiet lines", async () => {
  const staged = await stageTimedPackage("current");
  const { root, taskRel } = await makeRepo({ agents: validAgentsMd() });
  const xdg = await withXdg();
  const stdout = captureStdout();
  const stderr = captureStream(false);
  try {
    const code = await main(["review", "--repo", root, "--task", taskRel], xdg.env, staged.buildFile, {
      stdout,
      stderr,
    });
    assert.equal(code, 0, stderr.text());
    const status = JSON.parse(stdout.text()) as StatusDocument;
    assert.equal(stdout.text(), serializeStatus(status));
    const start = localDateTime(Date.parse(status.created_at));
    const tracker: LocalDayTracker = { lastDayKey: start.dayKey };
    assert.equal(
      stderr.text(),
      `${start.date} ${start.time} review ${status.run_id} host=cursor model=Composer-2.5 effort=none client-context=personal\n${formatReviewTerminalLine(status, tracker)}`,
    );
    assert.doesNotMatch(stderr.text(), /elapsed |quiet /);
    assert.doesNotMatch(stderr.text(), new RegExp(STALE_BUILD_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assertStderrBytes(stderr.bytes());
    assertAuthBoundary(stderr.text());
  } finally {
    await xdg.cleanup();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(staged.root, { recursive: true, force: true });
  }
});

test("stale review writes the warning, exits 1, and creates no run", async () => {
  const staged = await stageTimedPackage("stale");
  const { root, taskRel } = await makeRepo({ agents: validAgentsMd() });
  const runsDir = path.join(root, ".spartan-bridge", "runs");
  await fs.mkdir(runsDir, { recursive: true });
  const before = await fs.readdir(runsDir);
  assert.deepEqual(before, []);
  const xdg = await withXdg();
  const stdout = captureStream();
  const stderr = captureStream();
  try {
    const code = await main(
      ["review", "--repo", root, "--task", taskRel],
      {
        ...xdg.env,
        SPARTAN_BRIDGE_ALLOW_STALE: "1",
        FORCE: "1",
      },
      staged.buildFile,
      { stdout, stderr },
    );
    assert.equal(code, 1);
    assert.equal(stdout.bytes().equals(Buffer.alloc(0)), true);
    assert.equal(stderr.text(), `${STALE_BUILD_MESSAGE}\n`);
    assert.deepEqual(await fs.readdir(runsDir), before);
  } finally {
    await xdg.cleanup();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(staged.root, { recursive: true, force: true });
  }
});

test("stale mcp-stdio writes the warning, exits 1, and does not serve", async () => {
  const staged = await stageTimedPackage("stale");
  const { root } = await makeRepo();
  const result = await runCliWithModule(staged.buildFile, ["mcp-stdio", "--repo", root]);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `${STALE_BUILD_MESSAGE}\n`);
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(staged.root, { recursive: true, force: true });
});

test("status, events, and doctor still run on a stale build and keep the warning on stderr", async () => {
  const staged = await stageTimedPackage("stale");
  const { root } = await makeRepo({ agents: validAgentsMd() });
  await seedStoredRun(root);
  const xdg = await withXdg();
  try {
    const statusNow = await runCli(["status", "--repo", root, "--run", STORED_RUN_ID]);
    const statusStale = await runCliWithModule(staged.buildFile, ["status", "--repo", root, "--run", STORED_RUN_ID]);
    assert.equal(statusNow.code, 0);
    assert.equal(statusStale.code, statusNow.code);
    assert.equal(statusStale.stdout, statusNow.stdout);
    assert.equal(statusStale.stderr, `${STALE_BUILD_MESSAGE}\n${statusNow.stderr}`);

    const eventsNow = await runCli(["events", "--repo", root, "--run", STORED_RUN_ID]);
    const eventsStale = await runCliWithModule(staged.buildFile, ["events", "--repo", root, "--run", STORED_RUN_ID]);
    assert.equal(eventsNow.code, 0);
    assert.equal(eventsStale.code, eventsNow.code);
    assert.equal(eventsStale.stdout, eventsNow.stdout);
    assert.equal(eventsStale.stderr, `${STALE_BUILD_MESSAGE}\n${eventsNow.stderr}`);

    const doctorNow = await runCli(["doctor", "--repo", root], xdg.env);
    const doctorStale = await runCliWithModule(staged.buildFile, ["doctor", "--repo", root], xdg.env);
    assert.equal(doctorNow.code, 0);
    assert.equal(doctorStale.code, doctorNow.code);
    assert.equal(doctorStale.stdout, doctorNow.stdout);
    assert.equal(doctorStale.stderr, `${STALE_BUILD_MESSAGE}\n${doctorNow.stderr}`);
  } finally {
    await xdg.cleanup();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(staged.root, { recursive: true, force: true });
  }
});

test("stale usage still exits 2 with the warning and the error line", async () => {
  const staged = await stageTimedPackage("stale");
  const result = await runCliWithModule(staged.buildFile, ["start"]);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `${STALE_BUILD_MESSAGE}\nerror: unknown command 'start'\n`);
  await fs.rm(staged.root, { recursive: true, force: true });
});

test("a current build leaves all CLI kinds without a stale warning", async () => {
  const staged = await stageTimedPackage("current");
  const { root, taskRel } = await makeRepo({ agents: validAgentsMd() });
  await seedStoredRun(root);
  await seedStoredTransition(root);
  const xdg = await withXdg();
  try {
    const help = await runCliWithModule(staged.buildFile, ["--help"]);
    assert.equal(help.code, 0);
    assert.equal(help.stdout, HELP_TEXT);
    assert.equal(help.stderr, "");

    const usage = await runCliWithModule(staged.buildFile, ["start"]);
    assert.equal(usage.code, 2);
    assert.equal(usage.stdout, "");
    assert.equal(usage.stderr, "error: unknown command 'start'\n");

    const review = await runCliWithModule(
      staged.buildFile,
      ["review", "--repo", root, "--task", taskRel],
      xdg.env,
    );
    assert.equal(review.code, 0, review.stderr);
    JSON.parse(review.stdout);
    assert.doesNotMatch(review.stderr, new RegExp(STALE_BUILD_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const status = await runCliWithModule(staged.buildFile, ["status", "--repo", root, "--run", STORED_RUN_ID]);
    assert.equal(status.code, 0);
    assert.equal(status.stdout, STORED_STATUS);
    assert.equal(status.stderr, "");

    const events = await runCliWithModule(staged.buildFile, ["events", "--repo", root, "--run", STORED_RUN_ID]);
    assert.equal(events.code, 0);
    assert.equal(events.stdout, STORED_EVENTS);
    assert.equal(events.stderr, "");

    const transitionStatus = await runCliWithModule(staged.buildFile, [
      "transition-status",
      "--repo",
      root,
      "--transition",
      STORED_TRANSITION_ID,
    ]);
    assert.equal(transitionStatus.code, 0);
    assert.equal(transitionStatus.stdout, STORED_TRANSITION_STATUS);
    assert.equal(transitionStatus.stderr, "");

    const transitionEvents = await runCliWithModule(staged.buildFile, [
      "transition-events",
      "--repo",
      root,
      "--transition",
      STORED_TRANSITION_ID,
    ]);
    assert.equal(transitionEvents.code, 0);
    assert.equal(transitionEvents.stdout, STORED_TRANSITION_EVENTS);
    assert.equal(transitionEvents.stderr, "");

    const doctor = await runCliWithModule(staged.buildFile, ["doctor", "--repo", root], xdg.env);
    assert.equal(doctor.code, 0);
    assert.equal(doctor.stderr, "");

    const mcp = await runCliWithModule(staged.buildFile, ["mcp-stdio", "--repo", root]);
    assert.equal(mcp.code, 0);
    assert.equal(mcp.stdout, "");
    assert.equal(mcp.stderr, "");
  } finally {
    await xdg.cleanup();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(staged.root, { recursive: true, force: true });
  }
});

test("a package with no src/ writes no stale message on any command", async () => {
  const staged = await stagePackage({ src: false });
  const { root, taskRel } = await makeRepo({ agents: validAgentsMd() });
  await seedStoredRun(root);
  await seedStoredTransition(root);
  const xdg = await withXdg();
  try {
    assert.equal(await newestFileMtime(staged.srcDir), undefined);
    assert.equal(isBuildStale(undefined, T1.getTime()), false);
    assert.equal(await staleBuildMessage(staged.root), undefined);

    const help = await runCliWithModule(staged.buildFile, ["--help"]);
    assert.equal(help.code, 0);
    assert.equal(help.stdout, HELP_TEXT);
    assert.equal(help.stderr, "");

    const usage = await runCliWithModule(staged.buildFile, ["start"]);
    assert.equal(usage.code, 2);
    assert.equal(usage.stdout, "");
    assert.equal(usage.stderr, "error: unknown command 'start'\n");

    const review = await runCliWithModule(
      staged.buildFile,
      ["review", "--repo", root, "--task", taskRel],
      xdg.env,
    );
    assert.equal(review.code, 0, review.stderr);
    JSON.parse(review.stdout);
    assert.equal(review.stderr.includes(STALE_BUILD_MESSAGE), false);

    const status = await runCliWithModule(staged.buildFile, ["status", "--repo", root, "--run", STORED_RUN_ID]);
    assert.equal(status.code, 0);
    assert.equal(status.stdout, STORED_STATUS);
    assert.equal(status.stderr, "");

    const events = await runCliWithModule(staged.buildFile, ["events", "--repo", root, "--run", STORED_RUN_ID]);
    assert.equal(events.code, 0);
    assert.equal(events.stdout, STORED_EVENTS);
    assert.equal(events.stderr, "");

    const transitionStatus = await runCliWithModule(staged.buildFile, [
      "transition-status",
      "--repo",
      root,
      "--transition",
      STORED_TRANSITION_ID,
    ]);
    assert.equal(transitionStatus.code, 0);
    assert.equal(transitionStatus.stdout, STORED_TRANSITION_STATUS);
    assert.equal(transitionStatus.stderr, "");

    const transitionEvents = await runCliWithModule(staged.buildFile, [
      "transition-events",
      "--repo",
      root,
      "--transition",
      STORED_TRANSITION_ID,
    ]);
    assert.equal(transitionEvents.code, 0);
    assert.equal(transitionEvents.stdout, STORED_TRANSITION_EVENTS);
    assert.equal(transitionEvents.stderr, "");

    const doctor = await runCliWithModule(staged.buildFile, ["doctor", "--repo", root], xdg.env);
    assert.equal(doctor.code, 0);
    assert.equal(doctor.stderr, "");

    const mcp = await runCliWithModule(staged.buildFile, ["mcp-stdio", "--repo", root]);
    assert.equal(mcp.code, 0);
    assert.equal(mcp.stdout, "");
    assert.equal(mcp.stderr, "");
  } finally {
    await xdg.cleanup();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(staged.root, { recursive: true, force: true });
  }
});

test("the stale-build refusal branch does not read env", async () => {
  const source = await fs.readFile(new URL("../src/cli/main.ts", import.meta.url), "utf8");
  const start = source.indexOf("const parsed = parseArgv(argv);");
  const help = source.indexOf('if (parsed.kind === "help")');
  assert.ok(start >= 0);
  assert.ok(help > start);
  const branch = source.slice(start, help);
  assert.doesNotMatch(branch, /\benv\b/);
  assert.match(branch, /parsed\.kind === "review"/);
  assert.match(branch, /parsed\.kind === "mcp-stdio"/);
  assert.match(branch, /return 1/);
});

test("doctor exits 1 when the repository is configured but invalid", async () => {
  const { root } = await makeRepo({ agents: validAgentsMd({ omitPlan: true }) });
  const result = await runCli(["doctor", "--repo", root]);
  assert.equal(result.code, 1);
  assert.match(
    result.stdout,
    /^repo: readable\npolicy: configured; invalid \(reviewer_binding_missing\): The host-binding table must include a reviewer\.plan row\.\nregistry:/,
  );
  assert.match(result.stdout, /binding reviewer\.plan: adapter unavailable; reason=policy_unavailable/);
  assert.match(result.stdout, /binding reviewer\.implementation: adapter unavailable; reason=policy_unavailable/);
  assert.match(result.stdout, /binding implementer: adapter unavailable; reason=policy_unavailable/);
  await fs.rm(root, { recursive: true, force: true });
});

function cursorRegistry(): string {
  return VALID_REGISTRY.replaceAll("fake-reviewer-v1", CURSOR_LAUNCHER_ID);
}

function cursorCatalog(create: () => CursorAdapter) {
  return createLauncherCatalog(() => {
    throw new Error("fake unused");
  }, new Map([[CURSOR_LAUNCHER_ID, () => withStructuredOutput(create())]]));
}

function streamJsonHelp(): string {
  return "--print --output-format text | json | stream-json --mode --sandbox --workspace --trust\n";
}

function streamingCursorRunner(
  chunks: readonly string[],
  hooks?: { beforeChunks?: () => void; afterChunks?: () => void; afterChunk?: (index: number) => void },
): ProcessRunner {
  return {
    start(request) {
      if (request.args[0] === "--help") {
        return {
          wait: async () => ({
            exitCode: 0,
            stdout: Buffer.from(streamJsonHelp()),
            stderr: Buffer.alloc(0),
            timedOut: false,
            stdoutOverflow: false,
          }),
          cancel: async () => undefined,
        };
      }
      return {
        wait: async () => {
          hooks?.beforeChunks?.();
          for (let index = 0; index < chunks.length; index += 1) {
            request.onStdoutChunk?.(Buffer.from(chunks[index]!));
            hooks?.afterChunk?.(index);
          }
          hooks?.afterChunks?.();
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

test("TTY review progress lines change with the stub stream and stay off a pipe", async () => {
  const payload = {
    schema_version: 2,
    review_kind: "plan",
    verdict: "pass",
    summary: "ok",
    findings: [],
  };
  const chunks = [
    `${JSON.stringify({ type: "thinking", subtype: "delta", text: "working" })}\n`,
    `${JSON.stringify({ type: "tool_call", subtype: "started", name: "ReadFile" })}\n`,
    `${JSON.stringify({ type: "thinking", subtype: "delta", text: "again" })}\n`,
    `${JSON.stringify({ type: "result", subtype: "success", result: JSON.stringify(payload) })}\n`,
  ];
  const { root, taskRel } = await makeRepo();
  const tty = captureStream(true);
  const ticks = immediateTicks(1, TICKER_ORIGIN_MS);
  const ttyOutcome = await runWithElapsedTicker(tty, ticks.clock, ticks.timer, (progress) =>
    runReview(
      { repo: root, task: taskRel },
      {
        ...testDeps({ registryYaml: cursorRegistry(), clock: testClock() }),
        catalog: cursorCatalog(() => new CursorAdapter({ runner: streamingCursorRunner(chunks) })),
      },
      progress,
    ),
  );
  assert.equal(ttyOutcome.status?.reason_code, "review_passed");
  const ttyText = tty.text();
  assert.match(ttyText, /^\d{2}\/\d{2} \d{2}:\d{2}:\d{2} review run-/m);
  assert.match(ttyText, /^ {6}\d{2}:\d{2}:\d{2} working records=1 tools=0$/m);
  assert.match(ttyText, /^ {6}\d{2}:\d{2}:\d{2} tool records=2 tools=1$/m);
  assert.match(ttyText, /^ {6}\d{2}:\d{2}:\d{2} working records=3 tools=1$/m);
  assert.match(ttyText, /^ {6}\d{2}:\d{2}:\d{2} result records=4 tools=1$/m);
  assert.match(ttyText, /^ {6}\d{2}:\d{2}:\d{2} quiet 10s$/m);
  assert.equal(ttyText.includes("ReadFile"), false);
  assertStderrBytes(tty.bytes());
  assertAuthBoundary(ttyText);
  assert.doesNotMatch(serializeStatus(ttyOutcome.status!), /working records=|elapsed |quiet /);

  const pipe = captureStream(false);
  const pipeOutcome = await runWithElapsedTicker(pipe, { now: () => 0 }, {
    setInterval() {
      return {
        unref() {
          return;
        },
      };
    },
    clearInterval() {
      return;
    },
  }, (progress) =>
    runReview(
      { repo: root, task: taskRel },
      {
        ...testDeps({
          registryYaml: cursorRegistry(),
          clock: testClock("run-66666666-6666-4666-8666-666666666666"),
        }),
        catalog: cursorCatalog(() => new CursorAdapter({ runner: streamingCursorRunner(chunks) })),
      },
      progress,
    ),
  );
  assert.equal(pipeOutcome.status?.reason_code, "review_passed");
  assert.doesNotMatch(pipe.text(), /working |tool |result |elapsed |quiet /);
  assert.equal(JSON.parse(serializeStatus(pipeOutcome.status!)).reason_code, "review_passed");
  await fs.rm(root, { recursive: true, force: true });
});

test("same-class stream counts advance on ticker ticks", async () => {
  const payload = {
    schema_version: 2,
    review_kind: "plan",
    verdict: "pass",
    summary: "ok",
    findings: [],
  };
  const thinking = (text: string) => `${JSON.stringify({ type: "thinking", subtype: "delta", text })}\n`;
  const chunks = [
    thinking("a"),
    thinking("b"),
    thinking("c"),
    thinking("d"),
    `${JSON.stringify({ type: "result", subtype: "success", result: JSON.stringify(payload) })}\n`,
  ];
  const { root, taskRel } = await makeRepo();
  const tty = captureStream(true);
  const cadence = cadenceTimer();
  const outcome = await runWithElapsedTicker(tty, cadence.clock, cadence.timer, (progress) =>
    runReview(
      { repo: root, task: taskRel },
      {
        ...testDeps({ registryYaml: cursorRegistry(), clock: testClock() }),
        catalog: cursorCatalog(
          () =>
            new CursorAdapter({
              runner: streamingCursorRunner(chunks, {
                afterChunk: (index) => {
                  if (index >= 1 && index <= 3) {
                    cadence.tick();
                  }
                },
              }),
            }),
        ),
      },
      progress,
    ),
  );
  assert.equal(outcome.status?.reason_code, "review_passed");
  const text = tty.text();
  const working = [...text.matchAll(/^ {6}\d{2}:\d{2}:\d{2} working records=(\d+) tools=0$/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(working, ["1", "2", "3", "4"]);
  assert.match(text, /^ {6}09:00:00 working records=1 tools=0$/m);
  assert.match(text, /^ {6}09:00:10 working records=2 tools=0$/m);
  assert.match(text, /^ {6}09:00:20 working records=3 tools=0$/m);
  assert.match(text, /^ {6}09:00:30 working records=4 tools=0$/m);
  assert.match(text, /^ {6}09:00:30 result records=5 tools=0$/m);
  const beforeResult = text.slice(0, text.search(/result records=/));
  assert.doesNotMatch(beforeResult, /quiet /);
  assert.doesNotMatch(text, /elapsed /);
  assert.doesNotMatch(text, /working records=.*quiet /);
  assertStderrBytes(tty.bytes());
  await fs.rm(root, { recursive: true, force: true });
});

test("streamed child text never reaches TTY progress lines", async () => {
  const home = os.homedir();
  const payload = {
    schema_version: 2,
    review_kind: "plan",
    verdict: "pass",
    summary: "ok",
    findings: [],
  };
  const chunks = [
    `${JSON.stringify({ type: "thinking", subtype: "delta", text: `Bearer tok_secret ${home}/.cursor \u001b[31m` })}\n`,
    `${JSON.stringify({ type: "weird_kind", message: "should-not-leak" })}\n`,
    `${JSON.stringify({ type: "result", subtype: "success", result: JSON.stringify(payload) })}\n`,
  ];
  const { root, taskRel } = await makeRepo();
  const tty = captureStream(true);
  const cadence = cadenceTimer();
  const outcome = await runWithElapsedTicker(tty, cadence.clock, cadence.timer, (progress) =>
    runReview(
      { repo: root, task: taskRel },
      {
        ...testDeps({ registryYaml: cursorRegistry(), clock: testClock() }),
        catalog: cursorCatalog(() => new CursorAdapter({ runner: streamingCursorRunner(chunks) })),
      },
      progress,
    ),
  );
  assert.equal(outcome.status?.reason_code, "review_passed");
  const text = tty.text();
  assert.match(text, /^ {6}\d{2}:\d{2}:\d{2} working records=1 tools=0$/m);
  assert.match(text, /^ {6}\d{2}:\d{2}:\d{2} result records=3 tools=0$/m);
  assert.equal(text.includes("tok_secret"), false);
  assert.equal(text.includes(home), false);
  assert.equal(text.includes("should-not-leak"), false);
  assert.equal(text.includes("weird_kind"), false);
  assert.equal(text.includes("\u001b"), false);
  assert.equal(text.includes(formatReviewStreamLine({ class: "working", records: 1, tools: 0 }).trim()), true);
  assertStderrBytes(tty.bytes());
  assertAuthBoundary(text);
  await fs.rm(root, { recursive: true, force: true });
});

test("header and terminal derive local strings from status timestamps under pinned TZ", () => {
  assert.equal(process.env.TZ, PINNED_TZ);
  const info = {
    ...STARTED_INFO,
    run_id: "run-a421fd20-0000-4000-8000-000000000000",
    created_at: OWNER_CREATED_AT,
  };
  assert.equal(
    formatReviewStartedLine(info),
    "19/08 06:15:49 review run-a421fd20-0000-4000-8000-000000000000 host=cursor model=Composer-2.5 effort=none client-context=personal\n",
  );
  assert.equal(
    formatProducerStartedLine({
      transition_id: "transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      host: "cursor",
      model: "cursor-grok-4.6-high-fast",
      effort: "none",
      created_at: OWNER_CREATED_AT,
    }),
    "19/08 06:15:49 implementer transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1 host=cursor model=cursor-grok-4.6-high-fast effort=none\n",
  );
  assert.equal(
    formatImplementationReviewStartedLine(info),
    "19/08 06:15:49 implementation review run-a421fd20-0000-4000-8000-000000000000 host=cursor model=Composer-2.5 effort=none client-context=personal\n",
  );
  const status = {
    created_at: OWNER_CREATED_AT,
    updated_at: OWNER_UPDATED_AT,
    state: "changes_requested",
    verdict: "changes_requested",
    reason_code: "review_changes_requested",
  } as StatusDocument;
  const tracker: LocalDayTracker = { lastDayKey: localDateTime(Date.parse(OWNER_CREATED_AT)).dayKey };
  assert.equal(formatReviewTerminalLine(status, tracker), "      06:18:48 review changes_requested took 2m59s\n");
  const transition = {
    created_at: OWNER_CREATED_AT,
    updated_at: OWNER_UPDATED_AT,
    state: "stopped",
    reason_code: "cancelled",
  } as TransitionStatusDocument;
  assert.equal(formatTransitionTerminalLine(transition, tracker), "      06:18:48 implementer stopped reason=cancelled took 2m59s\n");
  const unwritableStop = {
    created_at: OWNER_CREATED_AT,
    updated_at: OWNER_UPDATED_AT,
    state: "stopped",
    reason_code: "plan_targets_unwritable_path",
    unwritable_plan_targets: ["AGENTS.md", "config/secret.env"],
    declaration_invalid_detail: null,
  } as TransitionStatusDocument;
  assert.equal(
    formatTransitionTerminalLine(unwritableStop, tracker),
    "      06:18:48 implementer stopped reason=plan_targets_unwritable_path targets=AGENTS.md,config/secret.env took 2m59s\n",
  );
  const advisoryOnOtherStop = {
    created_at: OWNER_CREATED_AT,
    updated_at: OWNER_UPDATED_AT,
    state: "stopped",
    reason_code: "write_scope_violation",
    unwritable_plan_targets: ["AGENTS.md"],
    declaration_invalid_detail: null,
  } as TransitionStatusDocument;
  assert.equal(
    formatTransitionTerminalLine(advisoryOnOtherStop, tracker),
    "      06:18:48 implementer stopped reason=write_scope_violation targets=AGENTS.md took 2m59s\n",
  );
  const declarationStop = {
    created_at: OWNER_CREATED_AT,
    updated_at: OWNER_UPDATED_AT,
    state: "stopped",
    reason_code: "producer_declaration_invalid",
    declaration_invalid_detail: "opening_shape",
  } as TransitionStatusDocument;
  assert.equal(
    formatTransitionTerminalLine(declarationStop, tracker),
    "      06:18:48 implementer stopped reason=producer_declaration_invalid detail=opening_shape took 2m59s\n",
  );
  assert.equal(formatDuration(Date.parse(OWNER_UPDATED_AT) - Date.parse(OWNER_CREATED_AT)), "2m59s");
  assert.equal(formatDuration(179_200), "2m59s");
  assert.equal(formatDuration(179_999), "2m59s");
  assert.equal(formatDuration(5_000), "5s");
  assert.equal(formatDuration(3_661_000), "1h1m1s");
  const align: LocalDayTracker = { lastDayKey: undefined };
  assert.equal(formatAlignedPrefix(Date.parse(OWNER_CREATED_AT), align), "19/08 06:15:49 ");
  assert.equal(formatAlignedPrefix(Date.parse("2026-08-19T09:15:52.000Z"), align), "      06:15:52 ");
  assert.equal("19/08 06:15:49 ".length - "06:15:49 ".length, 6);
});

test("date reprints on the first line after the local day changes", () => {
  const beforeMidnight = Date.parse("2026-08-17T02:59:50.000Z");
  const tty = captureStream(true);
  const cadence = cadenceTimer(beforeMidnight);
  const ticker = startElapsedTicker(tty, cadence.clock, cadence.timer);
  cadence.tick();
  cadence.tick();
  ticker.stop();
  assert.equal(tty.text(), "17/08 00:00:00 quiet 10s\n      00:00:10 quiet 20s\n");
  assertStderrBytes(tty.bytes());

  const created = "2026-08-17T02:59:50.000Z";
  const updated = "2026-08-17T03:00:10.200Z";
  const header = formatReviewStartedLine({ ...STARTED_INFO, created_at: created });
  assert.equal(
    header,
    "16/08 23:59:50 review run-11111111-1111-4111-8111-111111111111 host=cursor model=Composer-2.5 effort=none client-context=personal\n",
  );
  const sameDay: LocalDayTracker = { lastDayKey: localDateTime(Date.parse(created)).dayKey };
  const status = {
    created_at: created,
    updated_at: updated,
    state: "changes_requested",
    verdict: "changes_requested",
    reason_code: "review_changes_requested",
  } as StatusDocument;
  assert.equal(formatReviewTerminalLine(status, sameDay), "17/08 00:00:10 review changes_requested took 20s\n");
  const fresh: LocalDayTracker = { lastDayKey: undefined };
  assert.equal(formatReviewTerminalLine(status, fresh), "17/08 00:00:10 review changes_requested took 20s\n");
  assert.equal(formatDuration(Date.parse(updated) - Date.parse(created)), "20s");
});

test("quiet ticker with no stream records is measured from the run start", async () => {
  const { root, taskRel } = await makeRepo();
  const tty = captureStream(true);
  const ticks = immediateTicks(2, TICKER_ORIGIN_MS);
  const outcome = await runWithElapsedTicker(tty, ticks.clock, ticks.timer, (progress) =>
    runReview({ repo: root, task: taskRel }, testDeps({ clock: testClock() }), progress),
  );
  assert.equal(outcome.status?.reason_code, "review_passed");
  assert.match(
    tty.text(),
    /^16\/08 09:00:00 review run-11111111-1111-4111-8111-111111111111 host=cursor model=Composer-2.5 effort=none client-context=personal$/m,
  );
  assert.match(tty.text(), /^ {6}09:00:10 quiet 10s$/m);
  assert.match(tty.text(), /^ {6}09:00:20 quiet 20s$/m);
  assert.doesNotMatch(tty.text(), /working |tool |result |elapsed /);
  assert.doesNotMatch(tty.text(), /quiet \d+s records=/);
  assertStderrBytes(tty.bytes());
  await fs.rm(root, { recursive: true, force: true });
});

test("quiet ticker after stream records measures silence since the last record", async () => {
  const payload = {
    schema_version: 2,
    review_kind: "plan",
    verdict: "pass",
    summary: "ok",
    findings: [],
  };
  const chunks = [
    `${JSON.stringify({ type: "thinking", subtype: "delta", text: "working" })}\n`,
    `${JSON.stringify({ type: "result", subtype: "success", result: JSON.stringify(payload) })}\n`,
  ];
  const { root, taskRel } = await makeRepo();
  const tty = captureStream(true);
  const cadence = cadenceTimer();
  const outcome = await runWithElapsedTicker(tty, cadence.clock, cadence.timer, (progress) =>
    runReview(
      { repo: root, task: taskRel },
      {
        ...testDeps({ registryYaml: cursorRegistry(), clock: testClock() }),
        catalog: cursorCatalog(
          () =>
            new CursorAdapter({
              runner: streamingCursorRunner(chunks, {
                beforeChunks: () => {
                  cadence.tick();
                },
                afterChunks: () => {
                  cadence.tick();
                },
              }),
            }),
        ),
      },
      progress,
    ),
  );
  assert.equal(outcome.status?.reason_code, "review_passed");
  const text = tty.text();
  assert.match(text, /^ {6}09:00:10 working records=1 tools=0$/m);
  assert.match(text, /^ {6}09:00:10 result records=2 tools=0$/m);
  const quiets = [...text.matchAll(/quiet (\d+)s/g)].map((match) => match[1]);
  assert.deepEqual(quiets, ["10", "10"]);
  assert.match(text, /^ {6}09:00:10 quiet 10s$/m);
  assert.match(text, /^ {6}09:00:20 quiet 10s$/m);
  assert.doesNotMatch(text, /elapsed /);
  assert.doesNotMatch(text, /quiet \d+s records=/);
  assert.doesNotMatch(text, /working records=.*quiet /);
  assertStderrBytes(tty.bytes());
  await fs.rm(root, { recursive: true, force: true });
});


test("plan review recovery line eligibility and bytes follow D1/D2", () => {
  const parent = "run-1badf7fe-ecac-497f-a928-9084894c2512";
  const parentAlt = "run-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const base = {
    schema_version: 2,
    run_id: "run-7f0ce6c2-7348-4217-a4a8-732896658285",
    state: "failed",
    review_kind: "plan",
    task_path: "spartan/tasks/x.md",
    host: "grok",
    client_context: "personal",
    model: "grok-4.5",
    effort: "high",
    model_observed: "declared_unobserved",
    policy_digest: "sha256:policy",
    artifact_hashes: { task: "sha256:task", agents: "sha256:agents" },
    execution_id: "exec-1",
    verdict: null,
    reason_code: "adapter_error",
    task_write_state: null,
    task_hash_after_write: null,
    reviewer_write: null,
    adapter_failure: {
      phase: "collect",
      cause: "output_unparsable",
      exit_code: 0,
      stderr_bytes: 0,
      stderr_log: null,
      payload_log: null,
    },
    producer_identity: null,
    review_chain: { after_run_id: parent, cycle: 2, max_cycles: 3, refused: null },
    transition_id: null,
    created_at: "2026-08-20T12:00:00.000Z",
    updated_at: "2026-08-20T12:01:00.000Z",
  } as const;
  const tracker: LocalDayTracker = { lastDayKey: undefined };
  assert.equal(isPlanReviewRecoveryEligible(base as never), true);
  assert.equal(
    formatPlanReviewRecoveryLine(base as never),
    `resume plan review: --after-run ${parent} retries cycle 2; interrupted attempt did not consume the limit\n`,
  );
  const cycle3 = {
    ...base,
    review_chain: { after_run_id: parentAlt, cycle: 3, max_cycles: 3, refused: null },
  } as const;
  assert.equal(isPlanReviewRecoveryEligible(cycle3 as never), true);
  assert.equal(
    formatPlanReviewRecoveryLine(cycle3 as never),
    `resume plan review: --after-run ${parentAlt} retries cycle 3; interrupted attempt did not consume the limit\n`,
  );
  const schemaInvalid = {
    ...base,
    reason_code: "result_schema_invalid",
    adapter_failure: null,
  } as const;
  assert.equal(isPlanReviewRecoveryEligible(schemaInvalid as never), true);
  assert.equal(formatPlanReviewRecoveryLine(schemaInvalid as never), formatPlanReviewRecoveryLine(base as never));
  assert.match(formatReviewTerminalLine(base as never, tracker), /reason=adapter_error/);
  assert.match(formatReviewTerminalLine(schemaInvalid as never, { lastDayKey: undefined }), /reason=result_schema_invalid/);

  const negatives: Array<{ name: string; status: Record<string, unknown> }> = [
    {
      name: "changes_requested route",
      status: { ...base, state: "changes_requested", verdict: "changes_requested", reason_code: "review_changes_requested", adapter_failure: null },
    },
    {
      name: "awaiting_implementer pass route",
      status: { ...base, state: "awaiting_implementer", verdict: "pass", reason_code: "review_passed", adapter_failure: null },
    },
    {
      name: "human_required gate",
      status: { ...base, state: "human_required", reason_code: "transition_next_role_not_reviewer", adapter_failure: null },
    },
    {
      name: "blocked reviewer_write_detected",
      status: { ...base, state: "blocked", reason_code: "reviewer_write_detected", adapter_failure: null },
    },
    {
      name: "pre-policy chain null",
      status: { ...base, review_chain: null },
    },
    {
      name: "unchained missing parent",
      status: { ...base, review_chain: { after_run_id: null, cycle: 1, max_cycles: 3, refused: null } },
    },
    {
      name: "refused record",
      status: {
        ...base,
        state: "blocked",
        reason_code: "chain_refused",
        review_chain: { after_run_id: parent, cycle: null, max_cycles: 3, refused: "verdict_not_chainable" },
        adapter_failure: null,
      },
    },
    {
      name: "defensive missing cycle",
      status: { ...base, review_chain: { after_run_id: parent, cycle: null, max_cycles: 3, refused: null } },
    },
    {
      name: "defensive numeric refusal",
      status: { ...base, review_chain: { after_run_id: parent, cycle: 2, max_cycles: 3, refused: "verdict_not_chainable" } },
    },
    {
      name: "defensive failed with pass verdict",
      status: { ...base, verdict: "pass", reason_code: "review_passed", adapter_failure: null },
    },
    {
      name: "defensive failed with changes_requested verdict",
      status: { ...base, verdict: "changes_requested", reason_code: "review_changes_requested", adapter_failure: null },
    },
    {
      name: "implementation review",
      status: { ...base, review_kind: "implementation" },
    },
  ];
  for (const entry of negatives) {
    assert.equal(isPlanReviewRecoveryEligible(entry.status as never), false, entry.name);
  }

  const diagnostic = {
    stage: "wait",
    exit_code: 1,
    timed_out: false,
    write_scope_code: null,
    adapter_phase: null,
    adapter_cause: null,
    waited_ms: null,
    snapshot_site: null,
    snapshot_cap: null,
  } as const;
  const transition = {
    schema_version: 2,
    document: "transition",
    transition_id: "transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    state: "stopped",
    parent_run_id: parent,
    task_path: "spartan/tasks/x.md",
    approved_task_hash: "sha256:abc",
    policy_digest: "sha256:def",
    implementer_host: "grok",
    implementer_launcher_id: "grok-plan-reviewer-v1",
    lock_identity: "transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    reason_code: "producer_failure",
    producer_diagnostic: diagnostic,
    unwritable_plan_targets: null,
    declaration_invalid_detail: null,
    current_review_run_id: null,
    linked_review_run_ids: [],
    created_at: "2026-08-20T12:00:00.000Z",
    updated_at: "2026-08-20T12:01:00.000Z",
  } as const;
  const transitionLine = formatTransitionTerminalLine(transition as never, { lastDayKey: undefined });
  assert.match(transitionLine, /implementer stopped reason=producer_failure/);
  assert.doesNotMatch(transitionLine, /resume plan review/);
  const transitionStdout = serializeTransitionStatus(transition as never);
  assert.equal(transitionStdout, serializeTransitionStatus(transition as never));
  const parsedTransition = JSON.parse(transitionStdout) as { producer_diagnostic: unknown };
  assert.deepEqual(parsedTransition.producer_diagnostic, diagnostic);
  assert.doesNotMatch(transitionStdout, /resume plan review/);
  // Mirror main()'s transition branch: terminal line then serialized stdout, no recovery line.
  const transitionStderr = captureStream(false);
  const transitionOut = captureStdout();
  transitionStderr.write(formatTransitionTerminalLine(transition as never, { lastDayKey: undefined }));
  transitionOut.write(serializeTransitionStatus(transition as never));
  assert.equal(transitionStderr.text(), transitionLine);
  assert.equal(transitionOut.text(), transitionStdout);
  assert.doesNotMatch(transitionStderr.text(), /resume plan review/);

  const parsed = parseArgv(["review", "--repo", "/tmp/repo", "--task", "spartan/tasks/x.md", "--after-run", parent]);
  assert.equal(parsed.kind, "review");
  if (parsed.kind === "review") {
    assert.equal(parsed.after_run, parent);
  }
});


test("eligible failed plan-chain review writes recovery line after terminal on TTY and non-TTY", async () => {
  const staged = await stageTimedPackage("current");
  const cases = [
    {
      parent: "run-1badf7fe-ecac-497f-a928-9084894c2512",
      parentCycle: 1,
      expectedCycle: 2,
      childId: "run-7f0ce6c2-7348-4217-a4a8-732896658285",
    },
    {
      parent: "run-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      parentCycle: 2,
      expectedCycle: 3,
      childId: "run-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    },
  ] as const;
  for (const isTTY of [true, false]) {
    for (const testCase of cases) {
      const { root, taskRel } = await makeRepo({ agents: validAgentsMd({ producerChain: true }) });
      const xdg = await withXdg();
      const runDir = path.join(root, ".spartan-bridge", "runs", testCase.parent);
      await fs.mkdir(runDir, { recursive: true });
      const taskBytes = new Uint8Array(await fs.readFile(path.join(root, taskRel)));
      const agentsBytes = new Uint8Array(await fs.readFile(path.join(root, "AGENTS.md")));
      const { sha256Bytes } = await import("../src/core/serialize.ts");
      const parentStatus = {
        schema_version: 2,
        run_id: testCase.parent,
        state: "changes_requested",
        review_kind: "plan",
        task_path: taskRel,
        host: "cursor",
        client_context: "personal",
        model: "Composer-2.5",
        effort: "none",
        model_observed: "declared_unobserved",
        policy_digest: "sha256:policy",
        artifact_hashes: { task: sha256Bytes(taskBytes), agents: sha256Bytes(agentsBytes) },
        execution_id: "exec-parent",
        verdict: "changes_requested",
        reason_code: "review_changes_requested",
        task_write_state: "written",
        task_hash_after_write: sha256Bytes(taskBytes),
        reviewer_write: null,
        adapter_failure: null,
        producer_identity: null,
        review_chain: { after_run_id: null, cycle: testCase.parentCycle, max_cycles: 3, refused: null },
        transition_id: null,
        created_at: "2026-08-20T12:00:00.000Z",
        updated_at: "2026-08-20T12:00:30.000Z",
      };
      await fs.writeFile(path.join(runDir, "status.json"), `${JSON.stringify(parentStatus)}\n`, "utf8");
      const current = await fs.readFile(path.join(root, taskRel), "utf8");
      await fs.writeFile(path.join(root, taskRel), `${current}\n\n<!-- revise -->\n`, "utf8");
      const stdout = captureStdout();
      const stderr = captureStream(isTTY);
      const code = await main(
        ["review", "--repo", root, "--task", taskRel, "--after-run", testCase.parent],
        xdg.env,
        staged.buildFile,
        {
          stdout,
          stderr,
          deps: testDeps({
            clock: testClock(testCase.childId),
            createAdapter: () => new HookThrowAdapter(constantSource(passResult()), "collect", new Error("boom")),
          }),
        },
      );
      assert.equal(code, 1);
      const status = JSON.parse(stdout.text()) as StatusDocument;
      assert.equal(stdout.text(), serializeStatus(status));
      assert.equal(status.state, "failed");
      assert.equal(status.verdict, null);
      assert.equal(status.review_chain?.after_run_id, testCase.parent);
      assert.equal(status.review_chain?.cycle, testCase.expectedCycle);
      const recovery = formatPlanReviewRecoveryLine(status);
      assert.match(stderr.text(), new RegExp(`review failed reason=${status.reason_code} took `));
      assert.equal(stderr.text().endsWith(recovery), true, stderr.text());
      assert.match(
        stderr.text(),
        new RegExp(
          `resume plan review: --after-run ${testCase.parent} retries cycle ${testCase.expectedCycle}; interrupted attempt did not consume the limit\\n$`,
        ),
      );
      await xdg.cleanup();
      await fs.rm(root, { recursive: true, force: true });
    }
  }
  await fs.rm(staged.root, { recursive: true, force: true });
});

test("D6.2: review blocked on reviewer_output_unconstrained writes one stderr fix line with the status JSON unchanged", async () => {
  const { root, taskRel } = await makeRepo({ agents: validAgentsMd() });
  const xdg = await withXdg();
  const stdout = captureStdout();
  const stderr = captureStream(false);
  try {
    const code = await main(["review", "--repo", root, "--task", taskRel], xdg.env, cli, {
      stdout,
      stderr,
      deps: testDeps({
        clock: testClock(),
        createAdapter: () => {
          const adapter = new FakeAdapter(constantSource(passResult()));
          adapter.capabilities = () => ({ ...fakeCapabilities(), structured_output: false });
          return adapter;
        },
      }),
    });
    assert.equal(code, 1);
    const status = JSON.parse(stdout.text()) as StatusDocument;
    assert.equal(stdout.text(), serializeStatus(status));
    assert.equal(status.state, "blocked");
    assert.equal(status.reason_code, "reviewer_output_unconstrained");
    assert.match(
      stderr.text(),
      /reviewer\.plan binding refused: its host CLI has no structured-output flag \(--json-schema \/ --output-schema\); rebind reviewer\.plan in AGENTS\.md to Codex, Grok, or Claude Code and re-run\n$/,
    );
  } finally {
    await xdg.cleanup();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("D6.2: a different blocked terminal reason gains no rebind message", async () => {
  const { root, taskRel } = await makeRepo({ agents: validAgentsMd() });
  const xdg = await withXdg();
  const stdout = captureStdout();
  const stderr = captureStream(false);
  try {
    const code = await main(["review", "--repo", root, "--task", taskRel], xdg.env, cli, {
      stdout,
      stderr,
      deps: testDeps({
        clock: testClock(),
        createAdapter: () => new FakeAdapter(constantSource(passResult()), { ...fakeCapabilities(), workspace_write: true }),
      }),
    });
    assert.equal(code, 1);
    const status = JSON.parse(stdout.text()) as StatusDocument;
    assert.equal(status.reason_code, "capability_denied");
    assert.doesNotMatch(stderr.text(), /rebind reviewer/);
  } finally {
    await xdg.cleanup();
    await fs.rm(root, { recursive: true, force: true });
  }
});
