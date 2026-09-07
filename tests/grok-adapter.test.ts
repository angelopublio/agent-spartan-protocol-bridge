import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  GROK_CONSTANT_ARGV_TABLES,
  GROK_ENV_ALLOWLIST,
  GROK_EXECUTABLE,
  GROK_FORBIDDEN_ARGV_TOKENS,
  GROK_IMPLEMENTATION_REVIEW_PROMPT,
  GROK_LAUNCHER_ID,
  GROK_PRODUCER_ARGV_AFTER_PROMPT,
  GROK_PRODUCER_ARGV_SUFFIX,
  GROK_PRODUCER_TIMEOUT_MS,
  GROK_REVIEW_PROMPT,
  GROK_REVIEW_TIMEOUT_MS,
  GrokAdapter,
  childEnvironment,
  composeGrokModelArgs,
  composeGrokProducerPrompt,
  composeGrokReviewPrompt,
  extractGrokReviewPayload,
  grokCapabilities,
  grokProducerCapabilities,
  unwrapGrokStdout,
} from "../src/adapters/grok.ts";
import { PRODUCER_ISOLATED_WORKSPACE_ENV, capabilitiesAllowed, producerCapabilitiesAllowed } from "../src/adapters/adapter.ts";
import { ProducerWriteScopeError } from "../src/adapters/producer-write-scope.ts";
import { createLauncherCatalog } from "../src/adapters/fake.ts";
import type { ProcessRunner, SpawnRequest } from "../src/adapters/process.ts";
import { createNodeProcessRunner } from "../src/adapters/process.ts";
import { snapshotTree } from "../src/core/snapshot.ts";
import { makeRepo } from "./helpers.ts";

function grokCatalog(create: () => GrokAdapter) {
  return createLauncherCatalog(() => {
    throw new Error("fake unused");
  }, new Map([[GROK_LAUNCHER_ID, create]]));
}

test("the grok plan-review prompt carries the severity rule and the implementation prompt does not", () => {
  assert.match(GROK_REVIEW_PROMPT, /Severity rule\./);
  assert.match(GROK_REVIEW_PROMPT, /never on its own justifies changes_requested/);
  assert.doesNotMatch(GROK_IMPLEMENTATION_REVIEW_PROMPT, /Severity rule\./);
});

test("grok-plan-reviewer-v1 is catalog-owned and passes the capability gate", () => {
  const adapter = new GrokAdapter();
  const caps = grokCapabilities();
  assert.equal(caps.launcher_id, GROK_LAUNCHER_ID);
  assert.deepEqual(caps.review_kinds, ["plan", "implementation"]);
  assert.deepEqual(caps.permission_modes, ["read-only"]);
  assert.equal(caps.workspace_write, false);
  assert.equal(caps.fresh_context, true);
  assert.equal(capabilitiesAllowed(caps), true);
  const producer = grokProducerCapabilities();
  assert.equal(producer.launcher_id, GROK_LAUNCHER_ID);
  assert.deepEqual(producer.roles, ["implementer"]);
  assert.equal(producerCapabilitiesAllowed(producer), true);
  const catalog = grokCatalog(() => adapter);
  assert.equal(catalog.resolve(GROK_LAUNCHER_ID), adapter);
});

test("constant argv tables never include a forbidden flag or the agent executable", () => {
  assert.equal(GROK_EXECUTABLE, "grok");
  for (const table of GROK_CONSTANT_ARGV_TABLES) {
    for (const token of table) {
      assert.equal(GROK_FORBIDDEN_ARGV_TOKENS.includes(token as never), false, token);
      assert.notEqual(token, "agent");
    }
  }
});

test("childEnvironment copies only the allowlist and drops credential-shaped names", () => {
  const env = childEnvironment({
    PATH: "/bin",
    HOME: "/tmp/home",
    TMPDIR: "/tmp",
    LANG: "C",
    LC_ALL: "C",
    TERM: "xterm",
    GROK_HOME: "/tmp/grok-home",
    XAI_API_KEY: "secret",
    GROK_API_KEY: "secret",
    EXTRA: "nope",
  });
  assert.deepEqual(Object.keys(env).sort(), [...GROK_ENV_ALLOWLIST].sort());
  assert.equal(env.GROK_HOME, "/tmp/grok-home");
  assert.equal(env.XAI_API_KEY, undefined);
  assert.equal(env.GROK_API_KEY, undefined);
  assert.equal(env.EXTRA, undefined);
});

test("composeGrokModelArgs maps effort onto --reasoning-effort and rejects bad input", () => {
  assert.deepEqual(composeGrokModelArgs("grok-4.5", "none"), ["-m", "grok-4.5"]);
  assert.deepEqual(composeGrokModelArgs("grok-4.5", "high"), [
    "-m",
    "grok-4.5",
    "--reasoning-effort",
    "high",
  ]);
  assert.throws(() => composeGrokModelArgs("-bad", "none"));
  assert.throws(() => composeGrokModelArgs("grok-4.5", "ultra" as never));
});

test("extractGrokReviewPayload unwraps headless {text} envelopes", () => {
  const payload = {
    schema_version: 2,
    review_kind: "plan",
    verdict: "pass",
    summary: "ok",
    findings: [],
  };
  const wrapped = JSON.stringify({ text: JSON.stringify(payload), stopReason: "end_turn" });
  assert.deepEqual(extractGrokReviewPayload(wrapped), payload);
  assert.equal(unwrapGrokStdout(wrapped).includes('"verdict":"pass"'), true);
  assert.deepEqual(extractGrokReviewPayload(`prose\n${JSON.stringify(payload)}`), payload);
});

test("Grok plan review prepares only AGENTS.md and task.md and places -p before the prompt", async () => {
  const { root, taskRel } = await makeRepo();
  const recorded: SpawnRequest[] = [];
  const runner: ProcessRunner = {
    start(request) {
      recorded.push(request);
      return {
        wait: async () => ({
          exitCode: 0,
          stdout: Buffer.from(
            JSON.stringify({
              text: JSON.stringify({
                schema_version: 2,
                review_kind: "plan",
                verdict: "pass",
                summary: "ok",
                findings: [],
              }),
            }),
          ),
          stderr: Buffer.alloc(0),
          timedOut: false,
          stdoutOverflow: false,
        }),
        cancel: async () => undefined,
      };
    },
  };
  const adapter = new GrokAdapter({
    runner,
    env: { PATH: "/usr/bin", HOME: "/tmp", TMPDIR: os.tmpdir() },
  });
  const input = {
    execution_id: "exec-grok-plan",
    review_kind: "plan" as const,
    permission_mode: "read-only" as const,
    repo_root: root,
    workspace_root: path.dirname(root),
    run_dir: path.join(root, ".spartan-bridge", "runs", "run-grok-plan"),
    task_path: taskRel,
    task_content: "",
    task_hash: "sha256:task",
    agents_content: "",
    agents_hash: "sha256:agents",
    policy_digest: "sha256:policy",
    model: "grok-4.5",
    effort: "high" as const,
    implementation_review_scope: [],
  };
  await fs.mkdir(input.run_dir, { recursive: true });
  await adapter.prepare(input);
  await adapter.start(input);
  assert.equal(recorded.length, 1);
  const spawn = recorded[0]!;
  assert.equal(spawn.executable, "grok");
  assert.equal(spawn.args[0], "-p");
  assert.equal(spawn.args[1], GROK_REVIEW_PROMPT);
  assert.equal(spawn.args.includes("agent"), false);
  assert.equal(spawn.args.includes("--always-approve"), false);
  assert.ok(spawn.cwd);
  const names = await fs.readdir(spawn.cwd!);
  assert.deepEqual(names.sort(), ["AGENTS.md", "task.md"]);
  const collected = await adapter.collect();
  assert.equal((collected as { verdict: string }).verdict, "pass");
  await adapter.verify();
  await adapter.cleanup();
  await fs.rm(root, { recursive: true, force: true });
});

test("Grok implementation review prepares the workspace library copy and uses the implementation prompt", async () => {
  const { root, taskRel } = await makeRepo();
  const recorded: SpawnRequest[] = [];
  const runner: ProcessRunner = {
    start(request) {
      recorded.push(request);
      return {
        wait: async () => ({
          exitCode: 0,
          stdout: Buffer.from(
            JSON.stringify({
              text: JSON.stringify({
                schema_version: 2,
                review_kind: "implementation",
                verdict: "pass",
                summary: "ok",
                findings: [],
              }),
            }),
          ),
          stderr: Buffer.alloc(0),
          timedOut: false,
          stdoutOverflow: false,
        }),
        cancel: async () => undefined,
      };
    },
  };
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-grok-impl-"));
  await fs.mkdir(path.join(workspace, "worktree"));
  const runDir = path.join(root, ".spartan-bridge", "runs", "run-grok-impl");
  await fs.mkdir(runDir, { recursive: true });
  let preparedScope: readonly string[] | undefined;
  const adapter = new GrokAdapter({
    runner,
    env: { PATH: "/usr/bin", HOME: "/tmp", TMPDIR: os.tmpdir() },
    prepareWorkspace: async (input) => {
      preparedScope = input.scope;
      return {
        workspaceRoot: workspace,
        baseline: await snapshotTree(workspace, { policy: "workspace" }),
        manifest: { baseCommit: "0".repeat(40), patchByteLength: 0, entries: [] },
      };
    },
  });
  const input = {
    execution_id: "exec-grok-impl",
    review_kind: "implementation" as const,
    permission_mode: "read-only" as const,
    repo_root: root,
    workspace_root: path.dirname(root),
    run_dir: runDir,
    task_path: taskRel,
    task_content: "",
    task_hash: "sha256:task",
    agents_content: "",
    agents_hash: "sha256:agents",
    policy_digest: "sha256:policy",
    model: "grok-4.5",
    effort: "high" as const,
    implementation_review_scope: ["src/", "tests/"],
  };
  await adapter.prepare(input);
  await adapter.start(input);
  assert.deepEqual(preparedScope, ["src/", "tests/"]);
  assert.equal(recorded.length, 1);
  const spawn = recorded[0]!;
  assert.equal(spawn.executable, "grok");
  assert.equal(spawn.args[0], "-p");
  assert.equal(spawn.args[1], GROK_IMPLEMENTATION_REVIEW_PROMPT);
  assert.equal(composeGrokReviewPrompt("implementation"), GROK_IMPLEMENTATION_REVIEW_PROMPT);
  assert.equal(spawn.args.includes("--sandbox"), true);
  assert.equal(spawn.args.includes("strict"), true);
  const names = await fs.readdir(workspace);
  assert.equal(names.includes("AGENTS.md"), true);
  assert.equal(names.includes("task.md"), true);
  const manifest = JSON.parse(await fs.readFile(path.join(runDir, "workspace-manifest.json"), "utf8")) as {
    entries: { path: string }[];
  };
  assert.deepEqual(
    manifest.entries.map((entry) => entry.path).sort(),
    ["AGENTS.md", "task.md"],
  );
  await adapter.cleanup();
  await fs.rm(root, { recursive: true, force: true });
});

test("Grok producer spawn uses -p prompt, none sandbox, always-approve, allowlisted env, and write-scope profile", async () => {
  const { root, taskRel } = await makeRepo();
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  const recorded: SpawnRequest[] = [];
  const runner: ProcessRunner = {
    start(request) {
      recorded.push(request);
      return {
        wait: async () => ({
          exitCode: 0,
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
          timedOut: false,
          stdoutOverflow: false,
        }),
        cancel: async () => undefined,
      };
    },
  };
  const env: NodeJS.ProcessEnv = {
    PATH: "/usr/bin",
    HOME: "/tmp/home",
    TMPDIR: os.tmpdir(),
    LANG: "C",
    LC_ALL: "C",
    TERM: "xterm",
    GROK_HOME: "/tmp/grok-home",
    XAI_API_KEY: "must-not-forward",
  };
  const adapter = new GrokAdapter({ runner, env });
  const approved = "run-9aa88da2-de7b-479f-b838-59c09a3743ca";
  await adapter.startProducer({
    execution_id: "exec-grok-1",
    role: "implementer",
    permission_mode: "workspace-write",
    repo_root: root,
    workspace_root: path.dirname(root),
    task_path: taskRel,
    approved_plan_run_id: approved,
    model: "grok-4.5",
    effort: "high",
    write_scope: ["src/", "tests/"],
  });
  const wait = await adapter.waitProducer();
  assert.equal(wait.exitCode, 0);
  assert.equal(recorded.length, 1);
  const spawn = recorded[0]!;
  assert.equal(spawn.executable, GROK_EXECUTABLE);
  assert.equal(spawn.args[0], "-p");
  const prompt = composeGrokProducerPrompt(taskRel, approved, ["src/", "tests/"]);
  assert.equal(spawn.args[1], prompt);
  assert.deepEqual(spawn.args.slice(2, 2 + GROK_PRODUCER_ARGV_AFTER_PROMPT.length), [...GROK_PRODUCER_ARGV_AFTER_PROMPT]);
  assert.equal(spawn.args[2 + GROK_PRODUCER_ARGV_AFTER_PROMPT.length], path.dirname(root));
  assert.equal(spawn.cwd, path.dirname(root));
  assert.equal(spawn.detached, true);
  assert.ok(spawn.args.includes("-m"));
  assert.ok(spawn.args.includes("grok-4.5"));
  assert.ok(spawn.args.includes("--reasoning-effort"));
  assert.ok(spawn.args.includes("high"));
  for (const token of GROK_PRODUCER_ARGV_SUFFIX) {
    assert.ok(spawn.args.includes(token), token);
  }
  assert.equal(spawn.args.includes("agent"), false);
  assert.equal(spawn.env?.XAI_API_KEY, undefined);
  assert.equal(spawn.env?.GROK_HOME, "/tmp/grok-home");
  assert.equal(spawn.env?.[PRODUCER_ISOLATED_WORKSPACE_ENV], "1");
  assert.equal(typeof spawn.sandboxProfile, "string");
  assert.ok((spawn.sandboxProfile ?? "").length > 0);
  assert.equal(spawn.timeoutMs, GROK_PRODUCER_TIMEOUT_MS);
  assert.equal(GROK_PRODUCER_TIMEOUT_MS > GROK_REVIEW_TIMEOUT_MS, true);
  await adapter.releaseProducerIsolation();
  await adapter.cleanupProducer();
  await fs.rm(root, { recursive: true, force: true });
});

test("Grok producer spawn honors an injected producer_timeout_ms override", async () => {
  const { root, taskRel } = await makeRepo();
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  const recorded: SpawnRequest[] = [];
  const runner: ProcessRunner = {
    start(request) {
      recorded.push(request);
      return {
        wait: async () => ({
          exitCode: 0,
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
          timedOut: false,
          stdoutOverflow: false,
        }),
        cancel: async () => undefined,
      };
    },
  };
  const adapter = new GrokAdapter({ runner });
  const overrideMs = 3_600_000;
  await adapter.startProducer({
    execution_id: "exec-grok-timeout",
    role: "implementer",
    permission_mode: "workspace-write",
    repo_root: root,
    workspace_root: path.dirname(root),
    task_path: taskRel,
    approved_plan_run_id: "run-9aa88da2-de7b-479f-b838-59c09a3743ca",
    model: "grok-4.5",
    effort: "none",
    write_scope: ["src/", "tests/"],
    producer_timeout_ms: overrideMs,
  });
  assert.equal(recorded[0]?.timeoutMs, overrideMs);
  await adapter.cleanupProducer();
  await fs.rm(root, { recursive: true, force: true });
});

test("scaled Grok producer spawn completes when work duration stays below injected producer timeout", async () => {
  const { root, taskRel } = await makeRepo();
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  const delayMs = 200;
  const timeoutMs = 2_000;
  const recorded: SpawnRequest[] = [];
  const real = createNodeProcessRunner();
  const runner: ProcessRunner = {
    start(request) {
      recorded.push(request);
      return real.start({
        ...request,
        executable: process.execPath,
        args: ["-e", `setTimeout(() => {}, ${delayMs})`],
      });
    },
  };
  const adapter = new GrokAdapter({ runner });
  await adapter.startProducer({
    execution_id: "exec-grok-scaled",
    role: "implementer",
    permission_mode: "workspace-write",
    repo_root: root,
    workspace_root: path.dirname(root),
    task_path: taskRel,
    approved_plan_run_id: "run-9aa88da2-de7b-479f-b838-59c09a3743ca",
    model: "grok-4.5",
    effort: "none",
    write_scope: ["src/", "tests/"],
    producer_timeout_ms: timeoutMs,
  });
  const wait = await adapter.waitProducer();
  assert.equal(wait.timedOut, false);
  assert.equal(recorded[0]?.timeoutMs, timeoutMs);
  await adapter.cleanupProducer();
  await fs.rm(root, { recursive: true, force: true });
});

test("Grok producer isolation leaves live-tree modes unchanged through release", async () => {
  const { root, taskRel } = await makeRepo();
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  const agentsAbs = path.join(root, "AGENTS.md");
  const originalAgentsMode = (await fs.stat(agentsAbs)).mode & 0o777;
  const adapter = new GrokAdapter({
    runner: {
      start() {
        return {
          wait: async () => ({
            exitCode: 0,
            stdout: Buffer.alloc(0),
            stderr: Buffer.alloc(0),
            timedOut: false,
            stdoutOverflow: false,
          }),
          cancel: async () => undefined,
        };
      },
    },
  });
  await adapter.startProducer({
    execution_id: "exec-grok-scope",
    role: "implementer",
    permission_mode: "workspace-write",
    repo_root: root,
    workspace_root: path.dirname(root),
    task_path: taskRel,
    approved_plan_run_id: "run-9aa88da2-de7b-479f-b838-59c09a3743ca",
    model: "grok-4.5",
    effort: "none",
    write_scope: ["src/", "tests/"],
  });
  assert.equal((await fs.stat(agentsAbs)).mode & 0o777, originalAgentsMode);
  await adapter.waitProducer();
  assert.equal((await fs.stat(agentsAbs)).mode & 0o777, originalAgentsMode);
  await adapter.releaseProducerIsolation();
  assert.equal((await fs.stat(agentsAbs)).mode & 0o777, originalAgentsMode);
  await adapter.cleanupProducer();
  await fs.rm(root, { recursive: true, force: true });
});

function grokProbeOk() {
  return {
    wait: async () => ({
      exitCode: 0,
      stdout: Buffer.from(
        "-p\n--single\n--cwd\n--sandbox\n--output-format\n--json-schema\n-m\n--model\n--tools\n--disallowed-tools\n--always-approve\n--no-subagents\n",
      ),
      stderr: Buffer.alloc(0),
      timedOut: false,
      stdoutOverflow: false,
    }),
    cancel: async () => undefined,
  };
}

test("Grok producer preflight fails closed off Darwin without spawning sandbox-exec", async () => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "linux" });
  try {
    const executed: string[] = [];
    const adapter = new GrokAdapter({
      runner: {
        start(request) {
          executed.push(request.executable);
          return grokProbeOk();
        },
      },
      env: { PATH: "/usr/bin", HOME: "/tmp", TMPDIR: os.tmpdir() },
    });
    await assert.rejects(() => adapter.producerPreflight());
    assert.deepEqual(executed, [GROK_EXECUTABLE]);
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  }
});

test("Grok producer preflight probes grok then sandbox-exec on Darwin", async () => {
  assert.equal(process.platform, "darwin");
  const executed: string[] = [];
  const adapter = new GrokAdapter({
    runner: {
      start(request) {
        executed.push(request.executable);
        return grokProbeOk();
      },
    },
    env: { PATH: "/usr/bin", HOME: "/tmp", TMPDIR: os.tmpdir() },
  });
  await adapter.producerPreflight();
  assert.deepEqual(executed, [GROK_EXECUTABLE, "/usr/bin/sandbox-exec"]);
});
