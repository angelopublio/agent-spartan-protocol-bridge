import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CURSOR_CANDIDATE_SCAN_CAP,
  CURSOR_CONSTANT_ARGV_TABLES,
  CURSOR_ENV_ALLOWLIST,
  CURSOR_EXECUTABLE,
  CURSOR_FORBIDDEN_ARGV_TOKENS,
  CURSOR_LAUNCHER_ID,
  CURSOR_MODEL_FLAG,
  CURSOR_PROBE_ARGV,
  CURSOR_PRODUCER_ARGV_PREFIX,
  CURSOR_PRODUCER_TIMEOUT_MS,
  CURSOR_IMPLEMENTATION_REVIEW_PROMPT,
  CURSOR_REVIEW_ARGV_PREFIX,
  CURSOR_REVIEW_PROMPT,
  CURSOR_REVIEW_STDOUT_CAP,
  CURSOR_REVIEW_TIMEOUT_MS,
  CURSOR_REVIEW_STREAM_ARGV_PREFIX,
  CURSOR_WORKSPACE_FILE_MODE,
  CursorAdapter,
  childEnvironment,
  composeCursorModelArg,
  composeCursorProducerPrompt,
  composeCursorReviewPrompt,
  cursorCapabilities,
  extractReviewPayload,
} from "../src/adapters/cursor.ts";
import { createLauncherCatalog } from "../src/adapters/fake.ts";
import { PRODUCER_ISOLATED_WORKSPACE_ENV, capabilitiesAllowed } from "../src/adapters/adapter.ts";
import {
  createNodeProcessRunner,
  SANDBOX_EXEC_EXECUTABLE,
  type ProcessRunner,
  type SpawnRequest,
} from "../src/adapters/process.ts";
import {
  formatReviewStreamLine,
  ReviewStreamParser,
  REVIEW_PROGRESS_CLASSES,
} from "../src/adapters/review-stream.ts";
import { sha256Bytes } from "../src/core/serialize.ts";
import { snapshotTree } from "../src/core/snapshot.ts";
import { runReview } from "../src/core/review.ts";
import {
  RETAINED_PAYLOAD_CAP_BYTES,
  RETAINED_PAYLOAD_TRUNCATION_MARKER,
  redactAdapterStderrText,
} from "../src/policy/redact.ts";
import { VALID_REGISTRY, makeRepo, testClock, testDeps, validAgentsMd, withStructuredOutput } from "./helpers.ts";

const IN_PRODUCER_WORKSPACE = process.env[PRODUCER_ISOLATED_WORKSPACE_ENV] === "1";

async function sandboxExecProfileUnavailable(): Promise<boolean> {
  const outcome = await createNodeProcessRunner().start({
    executable: SANDBOX_EXEC_EXECUTABLE,
    args: ["-p", "(version 1)\n(allow default)\n", "/usr/bin/true"],
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH ?? "" },
    timeoutMs: 5000,
    stdoutCapBytes: 1024,
  }).wait();
  return outcome.exitCode === 71 && outcome.stderr.toString().includes("sandbox_apply");
}

const RUN_ID = "run-33333333-3333-4333-8333-333333333333";
const stubSource = fileURLToPath(new URL("./fixtures/cursor-agent-stub.mjs", import.meta.url));

function cursorCatalog(create: () => CursorAdapter) {
  return createLauncherCatalog(() => {
    throw new Error("fake unused");
  }, new Map([[CURSOR_LAUNCHER_ID, () => withStructuredOutput(create())]]));
}

function cursorRegistry(): string {
  return VALID_REGISTRY.replaceAll("fake-reviewer-v1", CURSOR_LAUNCHER_ID);
}

test("cursor-plan-reviewer-v1 is catalog-owned and passes the capability gate", () => {
  const adapter = new CursorAdapter({ runner: createNodeProcessRunner() });
  const caps = cursorCapabilities();
  assert.equal(caps.launcher_id, CURSOR_LAUNCHER_ID);
  assert.deepEqual(caps.review_kinds, ["plan", "implementation"]);
  assert.deepEqual(caps.permission_modes, ["read-only"]);
  assert.equal(caps.workspace_write, false);
  assert.equal(caps.fresh_context, true);
  assert.equal(caps.observes_model, false);
  assert.equal(capabilitiesAllowed(caps), true);
  const catalog = cursorCatalog(() => adapter);
  assert.equal(catalog.resolve(CURSOR_LAUNCHER_ID), adapter);
  assert.throws(() => catalog.resolve("not-a-real-launcher"));
});

test("constant argv tables never include a forbidden flag or subcommand", () => {
  const tokens = CURSOR_CONSTANT_ARGV_TABLES.flat();
  for (const forbidden of CURSOR_FORBIDDEN_ARGV_TOKENS) {
    assert.equal(tokens.includes(forbidden), false, forbidden);
  }
  assert.deepEqual([...CURSOR_PROBE_ARGV], ["--help"]);
  assert.equal(tokens.includes("--sandbox"), true);
  assert.equal(tokens.includes("enabled"), true);
  assert.equal(CURSOR_REVIEW_ARGV_PREFIX.includes("--mode"), true);
  assert.equal(CURSOR_REVIEW_ARGV_PREFIX.includes("plan"), true);
  assert.equal(CURSOR_PRODUCER_ARGV_PREFIX.includes("--mode"), false);
  assert.equal(CURSOR_PRODUCER_ARGV_PREFIX.includes("plan"), false);
  assert.deepEqual([...CURSOR_PRODUCER_ARGV_PREFIX], [
    "-p",
    "--output-format",
    "json",
    "--sandbox",
    "enabled",
    "--trust",
    "--workspace",
  ]);
  assert.equal(CURSOR_FORBIDDEN_ARGV_TOKENS.includes("--model" as never), false);
  assert.equal(CURSOR_FORBIDDEN_ARGV_TOKENS.includes("about"), true);
  assert.equal(CURSOR_MODEL_FLAG, "--model");
  assert.equal(tokens.includes(CURSOR_MODEL_FLAG), false);
});

test("Cursor producer spawn uses canonical repo, mapped model, sandboxed argv, allowlisted env, and Bridge prompt", async (t) => {
  const { root, taskRel } = await makeRepo();
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
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: os.tmpdir(),
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    TERM: process.env.TERM,
    CURSOR_API_KEY: "must-not-forward",
    CURSOR_CONFIG_DIR: "/must/not/forward",
    AGENT_CLI_CREDENTIAL_STORE: "file",
  };
  const adapter = new CursorAdapter({ runner, env });
  const approved = "run-9aa88da2-de7b-479f-b838-59c09a3743ca";
  await adapter.startProducer({
    execution_id: "exec-1",
    role: "implementer",
    permission_mode: "workspace-write",
    repo_root: root,
    workspace_root: path.dirname(root),
    task_path: taskRel,
    approved_plan_run_id: approved,
    model: "cursor-grok-4.6-high-fast",
    effort: "none",
    write_scope: ["src/", "tests/"],
  });
  const wait = await adapter.waitProducer();
  if (wait.exitCode === 71 && (IN_PRODUCER_WORKSPACE || await sandboxExecProfileUnavailable())) {
    t.skip("the producer copy or enclosing sandbox cannot apply a nested profile");
    // The enclosing CI sandbox can forbid applying a nested Darwin profile.
    await adapter.cleanupProducer();
    await fs.rm(root, { recursive: true, force: true });
    return;
  }
  assert.equal(wait.exitCode, 0);
  assert.equal(recorded.length, 1);
  const spawn = recorded[0]!;
  assert.equal(spawn.executable, CURSOR_EXECUTABLE);
  assert.deepEqual(spawn.args.slice(0, CURSOR_PRODUCER_ARGV_PREFIX.length), [...CURSOR_PRODUCER_ARGV_PREFIX]);
  assert.equal(spawn.args[CURSOR_PRODUCER_ARGV_PREFIX.length], path.dirname(root));
  assert.equal(spawn.args[CURSOR_PRODUCER_ARGV_PREFIX.length + 1], CURSOR_MODEL_FLAG);
  assert.equal(spawn.args[CURSOR_PRODUCER_ARGV_PREFIX.length + 2], "cursor-grok-4.6-high-fast");
  const prompt = composeCursorProducerPrompt(taskRel, approved, ["src/", "tests/"]);
  assert.equal(spawn.args[CURSOR_PRODUCER_ARGV_PREFIX.length + 3], prompt);
  assert.match(prompt, /`src\/`/);
  assert.match(prompt, /`tests\/`/);
  assert.match(prompt, /`AGENTS\.md`/);
  assert.equal(spawn.cwd, path.dirname(root));
  assert.equal(spawn.detached, true);
  assert.equal(spawn.env.CURSOR_API_KEY, undefined);
  assert.equal(spawn.env.CURSOR_CONFIG_DIR, undefined);
  assert.equal(spawn.env.AGENT_CLI_CREDENTIAL_STORE, "file");
  assert.equal(spawn.env[PRODUCER_ISOLATED_WORKSPACE_ENV], "1");
  assert.equal(spawn.args.includes("--mode"), false);
  assert.equal(spawn.args.includes("plan"), false);
  assert.equal(typeof spawn.sandboxProfile, "string");
  assert.match(spawn.sandboxProfile ?? "", /\(deny file-write\*/);
  assert.match(spawn.sandboxProfile ?? "", /\(vnode-type SYMLINK\)/);
  assert.match(spawn.sandboxProfile ?? "", /allow file-write/);
  const realRoot = await fs.realpath(root);
  const escapedRoot = realRoot.replaceAll("\\", "\\\\");
  assert.match(spawn.sandboxProfile ?? "", new RegExp(`\\(subpath "${escapedRoot}"\\)`));
  assert.match(spawn.sandboxProfile ?? "", new RegExp(escapedRoot));
  assert.equal(spawn.timeoutMs, CURSOR_PRODUCER_TIMEOUT_MS);
  assert.equal(CURSOR_PRODUCER_TIMEOUT_MS > CURSOR_REVIEW_TIMEOUT_MS, true);
  await adapter.cleanupProducer();
  await fs.rm(root, { recursive: true, force: true });
});

test("Cursor producer spawn honors an injected producer_timeout_ms override", async () => {
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
  const adapter = new CursorAdapter({ runner });
  const overrideMs = 3_600_000;
  await adapter.startProducer({
    execution_id: "exec-timeout",
    role: "implementer",
    permission_mode: "workspace-write",
    repo_root: root,
    workspace_root: path.dirname(root),
    task_path: taskRel,
    approved_plan_run_id: "run-9aa88da2-de7b-479f-b838-59c09a3743ca",
    model: "composer-2.5",
    effort: "none",
    write_scope: ["src/", "tests/"],
    producer_timeout_ms: overrideMs,
  });
  assert.equal(recorded[0]?.timeoutMs, overrideMs);
  await adapter.cleanupProducer();
  await fs.rm(root, { recursive: true, force: true });
});

test("scaled Cursor producer spawn completes when work duration stays below injected producer timeout", async () => {
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
  const adapter = new CursorAdapter({ runner });
  await adapter.startProducer({
    execution_id: "exec-scaled",
    role: "implementer",
    permission_mode: "workspace-write",
    repo_root: root,
    workspace_root: path.dirname(root),
    task_path: taskRel,
    approved_plan_run_id: "run-9aa88da2-de7b-479f-b838-59c09a3743ca",
    model: "composer-2.5",
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

test("Cursor producer isolation leaves the live repository modes unchanged", async () => {
  const { root, taskRel } = await makeRepo();
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  const agentsAbs = path.join(root, "AGENTS.md");
  const originalAgentsMode = (await fs.stat(agentsAbs)).mode & 0o777;
  const runner: ProcessRunner = {
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
  };
  const adapter = new CursorAdapter({ runner });
  await adapter.startProducer({
    execution_id: "exec-scope",
    role: "implementer",
    permission_mode: "workspace-write",
    repo_root: root,
    workspace_root: path.dirname(root),
    task_path: taskRel,
    approved_plan_run_id: "run-9aa88da2-de7b-479f-b838-59c09a3743ca",
    model: "cursor-grok-4.6-high-fast",
    effort: "none",
    write_scope: ["src/", "tests/"],
  });
  assert.equal((await fs.stat(agentsAbs)).mode & 0o777, originalAgentsMode);
  await adapter.waitProducer();
  // D3_GUARD_RESTORE_BEFORE_POST_CAPTURE: waitProducer() must not restore the
  // guard on its own. It stays locked here, exactly as the runtime's
  // post-child captures and validation would observe it, until the caller
  // explicitly releases it.
  assert.equal((await fs.stat(agentsAbs)).mode & 0o777, originalAgentsMode);
  await adapter.releaseProducerIsolation();
  assert.equal((await fs.stat(agentsAbs)).mode & 0o777, originalAgentsMode);
  await adapter.cleanupProducer();
  await fs.rm(root, { recursive: true, force: true });
});

test("the isolated profile denies a producer mode mutation in the live repository", async (t) => {
  assert.equal(process.platform, "darwin");
  const { root, taskRel } = await makeRepo();
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  const filePath = path.join(root, "src", "ok.ts");
  await fs.writeFile(filePath, "export {}\n", "utf8");
  // Strip the owner-write bit so the guard's lock pass actually changes the
  // mode (a file that already has it would compute the same target mode and
  // record no restore point, which would prove nothing about ordering).
  await fs.chmod(filePath, 0o444);
  const attackScript = `
    const fs = require("node:fs");
    try { fs.chmodSync(${JSON.stringify(filePath)}, 0o777); } catch {}
  `;
  const recorded: SpawnRequest[] = [];
  const real = createNodeProcessRunner();
  const runner: ProcessRunner = {
    start(request) {
      recorded.push(request);
      const target =
        request.executable === CURSOR_EXECUTABLE
          ? { ...request, executable: process.execPath, args: ["-e", attackScript] }
          : request;
      return real.start(target);
    },
  };
  const adapter = new CursorAdapter({ runner });
  await adapter.startProducer({
    execution_id: "exec-mode-order",
    role: "implementer",
    permission_mode: "workspace-write",
    repo_root: root,
    workspace_root: path.dirname(root),
    task_path: taskRel,
    approved_plan_run_id: "run-9aa88da2-de7b-479f-b838-59c09a3743ca",
    model: "cursor-grok-4.6-high-fast",
    effort: "none",
    write_scope: ["src/", "tests/"],
  });
  assert.equal(recorded.length, 1);
  assert.equal((await fs.stat(filePath)).mode & 0o777, 0o444);
  const wait = await adapter.waitProducer();
  if (wait.exitCode === 71 && (IN_PRODUCER_WORKSPACE || await sandboxExecProfileUnavailable())) {
    t.skip("the producer copy or enclosing sandbox cannot apply a nested profile");
    await adapter.cleanupProducer();
    await fs.rm(root, { recursive: true, force: true });
    return;
  }
  assert.equal(wait.exitCode, 0);
  assert.equal((await fs.stat(filePath)).mode & 0o777, 0o444);
  await adapter.releaseProducerIsolation();
  assert.equal((await fs.stat(filePath)).mode & 0o777, 0o444);
  await adapter.cleanupProducer();
  await fs.rm(root, { recursive: true, force: true });
});

test("producer preflight probes both cursor-agent and sandbox-exec before any dispatch", async () => {
  const executables: string[] = [];
  const adapter = new CursorAdapter({
    runner: {
      start(request) {
        executables.push(request.executable);
        if (request.executable === CURSOR_EXECUTABLE) {
          return probeOk();
        }
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
  await adapter.producerPreflight();
  assert.deepEqual(executables, [CURSOR_EXECUTABLE, SANDBOX_EXEC_EXECUTABLE]);
});

test("producer preflight fails closed when sandbox-exec is unavailable even though cursor-agent probes fine", async () => {
  const adapter = new CursorAdapter({
    runner: {
      start(request) {
        if (request.executable === CURSOR_EXECUTABLE) {
          return probeOk();
        }
        return {
          wait: async () => ({
            exitCode: 1,
            stdout: Buffer.alloc(0),
            stderr: Buffer.from("sandbox-exec: profile compile error\n"),
            timedOut: false,
            stdoutOverflow: false,
          }),
          cancel: async () => undefined,
        };
      },
    },
  });
  await assert.rejects(() => adapter.producerPreflight());
});

test("producer preflight fails closed off Darwin without spawning sandbox-exec", async () => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "linux" });
  try {
    const executed: string[] = [];
    const adapter = new CursorAdapter({
      runner: {
        start(request) {
          executed.push(request.executable);
          return probeOk();
        },
      },
    });
    await assert.rejects(() => adapter.producerPreflight());
    assert.deepEqual(executed, [CURSOR_EXECUTABLE]);
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  }
});

test("Cursor producer isolation does not scan live symlinks before spawn", async () => {
  const { root, taskRel } = await makeRepo();
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.symlink("missing-target", path.join(root, "src", "escape"));
  const recorded: SpawnRequest[] = [];
  const adapter = new CursorAdapter({
    runner: {
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
    },
  });
  await adapter.startProducer({
        execution_id: "exec-symlink",
        role: "implementer",
        permission_mode: "workspace-write",
      repo_root: root,
      workspace_root: path.dirname(root),
        task_path: taskRel,
        approved_plan_run_id: "run-9aa88da2-de7b-479f-b838-59c09a3743ca",
        model: "cursor-grok-4.6-high-fast",
        effort: "none",
        write_scope: ["src/", "tests/"],
      });
  assert.equal(recorded.length, 1);
  await adapter.cleanupProducer();
  await fs.rm(root, { recursive: true, force: true });
});

test("Cursor producer isolation does not scan live hard links before spawn", async () => {
  const { root, taskRel } = await makeRepo();
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-cursor-hardlink-"));
  const outsideFile = path.join(outsideDir, "secret.txt");
  await fs.writeFile(outsideFile, "outside-secret\n", "utf8");
  const outsideMode = (await fs.stat(outsideFile)).mode;
  await fs.link(outsideFile, path.join(root, "src", "alias.txt"));
  const recorded: SpawnRequest[] = [];
  const adapter = new CursorAdapter({
    runner: {
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
    },
  });
  await adapter.startProducer({
        execution_id: "exec-hardlink",
        role: "implementer",
        permission_mode: "workspace-write",
      repo_root: root,
      workspace_root: path.dirname(root),
        task_path: taskRel,
        approved_plan_run_id: "run-9aa88da2-de7b-479f-b838-59c09a3743ca",
        model: "cursor-grok-4.6-high-fast",
        effort: "none",
        write_scope: ["src/", "tests/"],
      });
  assert.equal(recorded.length, 1);
  assert.equal((await fs.stat(outsideFile)).mode, outsideMode);
  assert.equal(await fs.readFile(outsideFile, "utf8"), "outside-secret\n");
  await adapter.cleanupProducer();
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outsideDir, { recursive: true, force: true });
});

test("Cursor producer spawns normally on a denied-tree hard-link alias, never chmods it, and the sandbox still denies writing through it", async (t) => {
  assert.equal(process.platform, "darwin");
  const { root, taskRel } = await makeRepo();
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-cursor-denied-hardlink-"));
  const outsideFile = path.join(outsideDir, "secret.txt");
  await fs.writeFile(outsideFile, "outside-secret\n", "utf8");
  await fs.chmod(outsideFile, 0o640);
  const outsideMode = (await fs.stat(outsideFile)).mode;
  const aliasPath = path.join(root, "node_modules", "pkg", "alias.js");
  await fs.link(outsideFile, aliasPath);
  const attackScript = `
    const fs = require("node:fs");
    try { fs.writeFileSync(${JSON.stringify(aliasPath)}, "pwned\\n"); process.stderr.write("alias-write:OK\\n"); } catch (error) { process.stderr.write("alias-write:" + error.code + "\\n"); }
    try { fs.chmodSync(${JSON.stringify(aliasPath)}, 0o666); process.stderr.write("alias-chmod:OK\\n"); } catch (error) { process.stderr.write("alias-chmod:" + error.code + "\\n"); }
    try { fs.writeFileSync(${JSON.stringify(path.join(root, "src", "ok.ts"))}, "export {}\\n"); process.stderr.write("in-scope:OK\\n"); } catch (error) { process.stderr.write("in-scope:" + error.code + "\\n"); }
  `;
  const recorded: SpawnRequest[] = [];
  const handles: ReturnType<ProcessRunner["start"]>[] = [];
  const real = createNodeProcessRunner();
  const runner: ProcessRunner = {
    start(request) {
      recorded.push(request);
      const target =
        request.executable === CURSOR_EXECUTABLE
          ? { ...request, executable: process.execPath, args: ["-e", attackScript] }
          : request;
      const handle = real.start(target);
      handles.push(handle);
      return handle;
    },
  };
  const adapter = new CursorAdapter({ runner });
  await adapter.startProducer({
    execution_id: "exec-denied-hardlink",
    role: "implementer",
    permission_mode: "workspace-write",
    repo_root: root,
    workspace_root: path.dirname(root),
    task_path: taskRel,
    approved_plan_run_id: "run-9aa88da2-de7b-479f-b838-59c09a3743ca",
    model: "cursor-grok-4.6-high-fast",
    effort: "none",
    write_scope: ["src/", "tests/"],
  });
  // The write-scope guard ran and did not reject solely for the denied-tree alias,
  // and its lock pass did not chmod the shared inode before the producer spawned.
  assert.equal(recorded.length, 1);
  assert.equal((await fs.stat(outsideFile)).mode, outsideMode);
  assert.equal((await fs.stat(aliasPath)).mode, outsideMode);
  const wait = await adapter.waitProducer();
  if (wait.exitCode === 71 && (IN_PRODUCER_WORKSPACE || await sandboxExecProfileUnavailable())) {
    t.skip("the producer copy or enclosing sandbox cannot apply a nested profile");
    await adapter.cleanupProducer();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
    return;
  }
  assert.equal(wait.exitCode, 0);
  const outcome = await handles[0]!.wait();
  const stderr = outcome.stderr.toString("utf8");
  assert.match(stderr, /alias-write:EPERM/);
  assert.match(stderr, /alias-chmod:EPERM/);
  assert.match(stderr, /in-scope:EPERM/);
  assert.equal((await fs.stat(outsideFile)).mode, outsideMode);
  assert.equal(await fs.readFile(outsideFile, "utf8"), "outside-secret\n");
  await adapter.cleanupProducer();
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outsideDir, { recursive: true, force: true });
});

test("Cursor producer isolation does not chmod exact-file parents", async () => {
  const { root, taskRel } = await makeRepo();
  const exactRel = "agent-skill/skills/spbridge/SKILL.md";
  const parent = path.join(root, "agent-skill", "skills", "spbridge");
  await fs.mkdir(parent, { recursive: true });
  await fs.writeFile(path.join(root, exactRel), "skill\n", "utf8");
  const runner: ProcessRunner = {
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
  };
  const adapter = new CursorAdapter({ runner });
  await adapter.startProducer({
    execution_id: "exec-exact",
    role: "implementer",
    permission_mode: "workspace-write",
    repo_root: root,
    workspace_root: path.dirname(root),
    task_path: taskRel,
    approved_plan_run_id: "run-9aa88da2-de7b-479f-b838-59c09a3743ca",
    model: "cursor-grok-4.6-high-fast",
    effort: "none",
    write_scope: ["src/", "tests/", exactRel],
  });
  assert.equal((await fs.stat(parent)).mode & 0o777, 0o755);
  await adapter.waitProducer();
  await adapter.cleanupProducer();
  await fs.rm(root, { recursive: true, force: true });
});

test("spawn-level stub pins argv, cwd, environment, and artifact-only workspace", async () => {
  const { root, taskRel } = await makeRepo();
  const agentsBytes = new Uint8Array(await fs.readFile(path.join(root, "AGENTS.md")));
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-bin-"));
  const stubPath = path.join(bin, CURSOR_EXECUTABLE);
  await fs.copyFile(stubSource, stubPath);
  await fs.chmod(stubPath, 0o755);
  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    HOME: process.env.HOME,
    TMPDIR: os.tmpdir(),
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    TERM: process.env.TERM,
    CURSOR_API_KEY: "must-not-forward",
    CURSOR_CONFIG_DIR: "/must/not/forward",
    AGENT_CLI_CREDENTIAL_STORE: "file",
  };
  type Recorded = SpawnRequest & {
    names: string[];
    agentsHash: string;
    dirMode: number;
    fileModes: { agents: number; task: number };
  };
  const recorded: Recorded[] = [];
  const real = createNodeProcessRunner();
  const runner: ProcessRunner = {
    start(request) {
      const isReview = request.args.includes("-p");
      const sync = {
        names: isReview ? readdirSync(request.cwd) : [],
        agentsHash: isReview
          ? sha256Bytes(new Uint8Array(readFileSync(path.join(request.cwd, "AGENTS.md"))))
          : "",
        dirMode: isReview ? statSync(request.cwd).mode : 0,
        fileModes: isReview
          ? {
              agents: statSync(path.join(request.cwd, "AGENTS.md")).mode & 0o777,
              task: statSync(path.join(request.cwd, "task.md")).mode & 0o777,
            }
          : { agents: 0, task: 0 },
      };
      recorded.push({ ...request, ...sync });
      return real.start(request);
    },
  };

  const makeAdapter = () => new CursorAdapter({ runner, env });
  let seconds = 0;
  let runs = 0;
  let execs = 0;
  const clock = {
    now: () => new Date(Date.UTC(2026, 7, 16, 12, 0, seconds++)),
    createRunId: () => {
      runs += 1;
      return runs === 1 ? RUN_ID : "run-44444444-4444-4444-8444-444444444444";
    },
    createExecutionId: () => {
      execs += 1;
      return `exec-${execs}`;
    },
    createTransitionId: () => "transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  };
  const first = await runReview(
    { repo: root, task: taskRel },
    { ...testDeps({ registryYaml: cursorRegistry(), clock }), catalog: cursorCatalog(makeAdapter) },
  );
  assert.equal(first.status?.reason_code, "review_passed", first.status?.reason_code ?? "");
  const reviews = recorded.filter((item) => item.args[0] === "-p");
  const probes = recorded.filter((item) => item.args[0] === "--help");
  assert.equal(probes.length >= 1, true);
  assert.equal(reviews.length, 1);
  const review = reviews[0]!;
  assert.deepEqual(review.args.slice(0, CURSOR_REVIEW_ARGV_PREFIX.length), [...CURSOR_REVIEW_ARGV_PREFIX]);
  const workspace = review.args[CURSOR_REVIEW_ARGV_PREFIX.length];
  assert.equal(typeof workspace, "string");
  assert.equal(review.args[CURSOR_REVIEW_ARGV_PREFIX.length + 1], CURSOR_MODEL_FLAG);
  assert.equal(review.args[CURSOR_REVIEW_ARGV_PREFIX.length + 2], "Composer-2.5");
  assert.equal(review.args[CURSOR_REVIEW_ARGV_PREFIX.length + 3], CURSOR_REVIEW_PROMPT);
  assert.equal(first.status?.model, "Composer-2.5");
  assert.equal(first.status?.effort, "none");
  assert.equal(first.status?.model_observed, "declared_unobserved");
  const cursorAdapter = makeAdapter();
  assert.equal(cursorAdapter.observedModel(), null);
  assert.equal(review.cwd, workspace);
  assert.equal(review.executable, CURSOR_EXECUTABLE);
  assert.equal(review.args.includes("--add-dir"), false);
  const repoReal = await fs.realpath(root);
  assert.equal(review.args.some((item) => String(item).includes(repoReal)), false);
  assert.equal(CURSOR_REVIEW_PROMPT.includes(repoReal), false);
  assert.deepEqual(Object.keys(review.env).sort(), [...CURSOR_ENV_ALLOWLIST].filter((key) => env[key] !== undefined).sort());
  assert.equal(review.env.CURSOR_API_KEY, undefined);
  assert.equal(review.env.CURSOR_CONFIG_DIR, undefined);
  assert.equal(review.env.AGENT_CLI_CREDENTIAL_STORE, "file");
  for (const value of Object.values(review.env)) {
    if (typeof value === "string") {
      assert.equal(value.includes(repoReal), false, value);
    }
  }
  assert.deepEqual(review.names.sort(), ["AGENTS.md", "task.md"]);
  assert.equal(review.agentsHash, sha256Bytes(agentsBytes));
  assert.equal(review.dirMode & 0o777, 0o555);
  assert.equal(CURSOR_WORKSPACE_FILE_MODE, 0o444);
  assert.equal(review.fileModes.agents, 0o444);
  assert.equal(review.fileModes.task, 0o444);
  const execId = first.status?.execution_id ?? "";
  const persisted = JSON.parse(
    await fs.readFile(path.join(root, ".spartan-bridge", "runs", RUN_ID, "reviews", `${execId}.json`), "utf8"),
  ) as { verdict: string };
  assert.equal(persisted.verdict, "pass");
  await assert.rejects(fs.access(workspace as string));

  const second = await runReview(
    { repo: root, task: taskRel },
    {
      ...testDeps({ registryYaml: cursorRegistry(), clock }),
      catalog: cursorCatalog(makeAdapter),
    },
  );
  assert.equal(second.status?.reason_code, "review_passed");
  const reviews2 = recorded.filter((item) => item.args[0] === "-p");
  assert.equal(reviews2.length, 2);
  assert.notEqual(reviews2[0]?.cwd, reviews2[1]?.cwd);
  assert.notEqual(first.status?.execution_id, second.status?.execution_id);
  await assert.rejects(fs.access(reviews2[1]?.cwd ?? ""));

  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(bin, { recursive: true, force: true });
});

test("Cursor implementation review prepares the workspace library copy and uses the implementation prompt", async () => {
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
              schema_version: 2,
              review_kind: "implementation",
              verdict: "pass",
              summary: "ok",
              findings: [],
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
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-cursor-impl-"));
  await fs.mkdir(path.join(workspace, "worktree"));
  const runDir = path.join(root, ".spartan-bridge", "runs", "run-impl");
  await fs.mkdir(runDir, { recursive: true });
  let preparedScope: readonly string[] | undefined;
  const adapter = new CursorAdapter({
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
    execution_id: "exec-impl",
    review_kind: "implementation" as const,
    permission_mode: "read-only" as const,
    repo_root: root,
    run_dir: runDir,
    task_path: taskRel,
    task_content: "",
    task_hash: "sha256:task",
    agents_content: "",
    agents_hash: "sha256:agents",
    policy_digest: "sha256:policy",
    model: "gpt-5.6-terra",
    effort: "high" as const,
    implementation_review_scope: ["src/", "tests/"],
  };
  await adapter.prepare(input);
  await adapter.start(input);
  assert.deepEqual(preparedScope, ["src/", "tests/"]);
  assert.equal(recorded.length, 1);
  const spawn = recorded[0]!;
  assert.deepEqual(spawn.args.slice(0, CURSOR_REVIEW_ARGV_PREFIX.length), [...CURSOR_REVIEW_ARGV_PREFIX]);
  assert.equal(spawn.args.at(-1), CURSOR_IMPLEMENTATION_REVIEW_PROMPT);
  assert.equal(spawn.cwd, workspace);
  assert.equal(composeCursorReviewPrompt("implementation"), CURSOR_IMPLEMENTATION_REVIEW_PROMPT);
  assert.equal(composeCursorReviewPrompt("plan"), CURSOR_REVIEW_PROMPT);
  const repoReal = await fs.realpath(root);
  assert.equal(CURSOR_IMPLEMENTATION_REVIEW_PROMPT.includes(repoReal), false);
  const names = await fs.readdir(workspace);
  assert.equal(names.includes("AGENTS.md"), true);
  assert.equal(names.includes("task.md"), true);
  assert.equal(names.includes("worktree"), true);
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

test("composeCursorModelArg is required, composed from validated pieces, and observedModel stays null", () => {
  assert.equal(composeCursorModelArg("Composer-2.5", "none"), "Composer-2.5");
  assert.equal(composeCursorModelArg("Composer-2.5", "high"), "Composer-2.5[effort=high]");
  assert.equal(
    composeCursorModelArg("cursor-grok-4.6-high-fast", "high"),
    "cursor-grok-4.6-high-fast",
  );
  assert.equal(composeCursorModelArg("cursor-grok-4.6-max", "max"), "cursor-grok-4.6-max");
  assert.throws(() => composeCursorModelArg("cursor-grok-4.6-high-fast", "medium"));
  assert.equal(composeCursorModelArg("cursor-grok-4.6-high-fast", "none"), "cursor-grok-4.6-high-fast");
  assert.throws(() => composeCursorModelArg("-bad", "none"));
  assert.throws(() => composeCursorModelArg("Composer-2.5", "ultra" as never));
  const adapter = stubCursorAdapter({
    exitCode: 0,
    stdout: Buffer.from(
      JSON.stringify({
        result: JSON.stringify({
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
  });
  assert.equal(adapter.observedModel(), null);
  assert.equal(cursorCapabilities().observes_model, false);
  assert.equal(capabilitiesAllowed({ ...cursorCapabilities(), observes_model: true }), true);
});

test("review spawn with a non-none effort inserts the composed model token", async () => {
  const { root, taskRel } = await makeRepo({
    agents: validAgentsMd({ effort: "high" }),
  });
  const recorded: string[][] = [];
  const adapter = new CursorAdapter({
    runner: {
      start(request) {
        recorded.push(request.args);
        if (request.args[0] === "--help") {
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
        return {
          wait: async () => ({
            exitCode: 0,
            stdout: Buffer.from(
              JSON.stringify({
                result: JSON.stringify({
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
    },
  });
  const outcome = await runReview(
    { repo: root, task: taskRel },
    { ...testDeps({ registryYaml: cursorRegistry(), clock: testClock(RUN_ID) }), catalog: cursorCatalog(() => adapter) },
  );
  assert.equal(outcome.status?.reason_code, "review_passed");
  const reviewArgs = recorded.find((args) => args[0] === "-p");
  assert.equal(reviewArgs?.includes(CURSOR_MODEL_FLAG), true);
  const modelIndex = reviewArgs?.indexOf(CURSOR_MODEL_FLAG) ?? -1;
  assert.equal(reviewArgs?.[modelIndex + 1], "Composer-2.5[effort=high]");
  assert.equal(adapter.observedModel(), null);
  assert.equal(outcome.status?.model_observed, "declared_unobserved");
  await fs.rm(root, { recursive: true, force: true });
});

test("childEnvironment forwards AGENT_CLI_CREDENTIAL_STORE for file and keychain", () => {
  for (const store of ["file", "keychain"]) {
    const env = childEnvironment({
      PATH: "/bin",
      HOME: "/home/user",
      TMPDIR: "/tmp",
      AGENT_CLI_CREDENTIAL_STORE: store,
    });
    assert.equal(env.AGENT_CLI_CREDENTIAL_STORE, store);
  }
});

test("childEnvironment omits AGENT_CLI_CREDENTIAL_STORE when the parent does not set it", () => {
  const env = childEnvironment({
    PATH: "/bin",
    HOME: "/home/user",
    TMPDIR: "/tmp",
  });
  assert.equal(env.AGENT_CLI_CREDENTIAL_STORE, undefined);
});

test("childEnvironment drops an AGENT_CLI_CREDENTIAL_STORE value outside file|keychain", () => {
  const env = childEnvironment({
    PATH: "/bin",
    AGENT_CLI_CREDENTIAL_STORE: "future-store-kind",
  });
  assert.equal(env.AGENT_CLI_CREDENTIAL_STORE, undefined);
});

test("childEnvironment copies only the allowlist and drops credential-shaped names", () => {
  const env = childEnvironment({
    PATH: "/bin",
    HOME: "/home/user",
    TMPDIR: "/tmp",
    CURSOR_API_KEY: "secret",
    TOKEN: "nope",
  });
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "PATH", "TMPDIR"]);
  assert.equal(env.CURSOR_API_KEY, undefined);
  assert.equal(env.TOKEN, undefined);
});

test("a real Cursor reviewer binding is refused reviewer_output_unconstrained before any spawn", async () => {
  const { root, taskRel } = await makeRepo();
  const recorded: string[][] = [];
  const runner: ProcessRunner = {
    start(request) {
      recorded.push([...request.args]);
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
  // Unwrapped catalog: the real CursorAdapter capabilities report
  // structured_output: false.
  const catalog = createLauncherCatalog(
    () => {
      throw new Error("fake unused");
    },
    new Map([[CURSOR_LAUNCHER_ID, () => new CursorAdapter({ runner })]]),
  );
  const outcome = await runReview(
    { repo: root, task: taskRel },
    { ...testDeps({ registryYaml: cursorRegistry(), clock: testClock(RUN_ID) }), catalog },
  );
  assert.equal(outcome.status?.reason_code, "reviewer_output_unconstrained");
  assert.equal(outcome.status?.state, "blocked");
  assert.equal(outcome.status?.execution_id, null);
  assert.equal(recorded.length, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test("extractReviewPayload accepts prose then a bare object, keeps prior shapes, and fails closed", () => {
  const payload = {
    schema_version: 2,
    review_kind: "plan",
    verdict: "pass",
    summary: "ok",
    findings: [],
  };
  const wrapped = (result: string): string => JSON.stringify({ result });

  assert.deepEqual(
    extractReviewPayload(
      wrapped(
        `I'll review only the workspace files task.md and AGENTS.md against the schema.${JSON.stringify(payload)}`,
      ),
    ),
    payload,
  );
  assert.deepEqual(extractReviewPayload(wrapped(JSON.stringify(payload))), payload);
  assert.deepEqual(
    extractReviewPayload(wrapped(`Here is the review.\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`)),
    payload,
  );
  assert.deepEqual(
    extractReviewPayload(wrapped(`${JSON.stringify(payload)} trailing commentary after the object`)),
    payload,
  );
  assert.equal(extractReviewPayload(wrapped("I'll review only the files. No object follows.")), undefined);
  assert.equal(extractReviewPayload(wrapped("{not json}")), undefined);
  assert.equal(extractReviewPayload("this is not json"), undefined);

  const nested = {
    schema_version: 2,
    review_kind: "plan",
    verdict: "changes_requested",
    summary: "needs changes",
    findings: [{ id: "F1", severity: "error", message: "nested object must not be the extract target" }],
  };
  assert.deepEqual(
    extractReviewPayload(wrapped(`I'll review only the workspace files.${JSON.stringify(nested)}`)),
    nested,
  );
});

test("extractReviewPayload returns the payload after prose with an odd number of double quotes", () => {
  const payload = {
    schema_version: 2,
    review_kind: "plan",
    verdict: "pass",
    summary: "ok",
    findings: [],
  };
  const wrapped = (result: string): string => JSON.stringify({ result });
  assert.deepEqual(
    extractReviewPayload(
      wrapped(`The plan says the reviewer "must not write files.${JSON.stringify(payload)}`),
    ),
    payload,
  );
});

test("extractReviewPayload stays bounded on a large unmatched-brace prefix", () => {
  const payload = {
    schema_version: 2,
    review_kind: "plan",
    verdict: "pass",
    summary: "ok",
    findings: [],
  };
  const braces = "{".repeat(250_000);
  const stdout = JSON.stringify({ result: `${braces}${JSON.stringify(payload)}` });
  assert.equal(stdout.length < CURSOR_REVIEW_STDOUT_CAP, true);
  const started = Date.now();
  assert.deepEqual(extractReviewPayload(stdout), payload);
  assert.equal(Date.now() - started < 1_000, true);
});

test("extractReviewPayload recovers the captured trailing-prose shapes and pins the scan cap", () => {
  const payload = {
    schema_version: 2,
    review_kind: "plan",
    verdict: "changes_requested",
    summary: "needs changes",
    findings: [{ id: "D1", severity: "error", message: "scan from the end" }],
  };
  const wrapped = (result: string): string => JSON.stringify({ result });
  const captured = `I'll review only task.md and AGENTS.md as specified, then return the JSON verdict.${JSON.stringify(payload)}`;

  assert.deepEqual(extractReviewPayload(wrapped(captured)), payload);
  assert.deepEqual(
    extractReviewPayload(wrapped(`${captured} The record already names the refused field.`)),
    payload,
  );
  assert.deepEqual(
    extractReviewPayload(wrapped(`${captured} A lone unmatched brace { does not close a span.`)),
    payload,
  );
  assert.deepEqual(
    extractReviewPayload(
      wrapped(`${captured} See { after_run_id, cycle, max_cycles, refused } on the parent record.`),
    ),
    payload,
  );
  assert.deepEqual(
    extractReviewPayload(
      wrapped(`${captured}\n\`\`\`json\n{ after_run_id, cycle, max_cycles, refused }\n\`\`\`\n`),
    ),
    payload,
  );

  const malformed = { schema_version: 2, review_kind: "plan" };
  assert.deepEqual(extractReviewPayload(JSON.stringify(malformed)), malformed);

  const tail = Array.from({ length: CURSOR_CANDIDATE_SCAN_CAP + 1 }, () => "{ x }").join(" ");
  const overCap = wrapped(`${JSON.stringify(payload)} trailing ${tail}`);
  const started = Date.now();
  assert.equal(extractReviewPayload(overCap), undefined);
  assert.equal(Date.now() - started < 1_000, true);
});

test("timeout, unparsable output, nonzero exit, oversized output, and schema-invalid payloads fail closed", async () => {
  const timeoutAdapter = stubCursorAdapter({
    exitCode: null,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    timedOut: true,
    stdoutOverflow: false,
  });
  const { root, taskRel } = await makeRepo();
  const timeoutOutcome = await runReview(
    { repo: root, task: taskRel },
    { ...testDeps({ registryYaml: cursorRegistry(), clock: testClock(RUN_ID) }), catalog: cursorCatalog(() => timeoutAdapter) },
  );
  assert.equal(timeoutOutcome.status?.reason_code, "adapter_timeout");
  assert.equal(timeoutOutcome.exitCode, 1);
  assert.equal(timeoutOutcome.status?.adapter_failure?.phase, "collect");
  assert.equal(timeoutOutcome.status?.adapter_failure?.cause, "timed_out");
  assert.equal(timeoutOutcome.status?.adapter_failure?.exit_code, null);

  const badAdapter = stubCursorAdapter({
    exitCode: 0,
    stdout: Buffer.from("this is not json"),
    stderr: Buffer.alloc(0),
    timedOut: false,
    stdoutOverflow: false,
  });
  const badRepo = await makeRepo();
  const badOutcome = await runReview(
    { repo: badRepo.root, task: badRepo.taskRel },
    { ...testDeps({ registryYaml: cursorRegistry(), clock: testClock(RUN_ID) }), catalog: cursorCatalog(() => badAdapter) },
  );
  assert.equal(badOutcome.status?.reason_code, "adapter_error");
  assert.equal(badOutcome.status?.adapter_failure?.phase, "collect");
  assert.equal(badOutcome.status?.adapter_failure?.cause, "output_unparsable");
  assert.equal(badOutcome.status?.adapter_failure?.exit_code, 0);

  const nonzeroAdapter = stubCursorAdapter({
    exitCode: 1,
    stdout: Buffer.from("client failed"),
    stderr: Buffer.alloc(0),
    timedOut: false,
    stdoutOverflow: false,
  });
  const nonzeroRepo = await makeRepo();
  const nonzeroOutcome = await runReview(
    { repo: nonzeroRepo.root, task: nonzeroRepo.taskRel },
    { ...testDeps({ registryYaml: cursorRegistry(), clock: testClock(RUN_ID) }), catalog: cursorCatalog(() => nonzeroAdapter) },
  );
  assert.equal(nonzeroOutcome.status?.reason_code, "adapter_error");
  assert.equal(nonzeroOutcome.exitCode, 1);
  assert.equal(nonzeroOutcome.status?.adapter_failure?.phase, "collect");
  assert.equal(nonzeroOutcome.status?.adapter_failure?.cause, "output_unparsable");
  assert.equal(nonzeroOutcome.status?.adapter_failure?.payload_log, "adapter-payload.log");
  assert.equal(nonzeroOutcome.status?.adapter_failure?.exit_code, 1);
  assert.equal(nonzeroOutcome.status?.model, "Composer-2.5");
  assert.equal(nonzeroOutcome.status?.effort, "none");
  assert.equal(nonzeroOutcome.status?.model_observed, null);
  assert.equal(nonzeroAdapter.observedModel(), null);

  const overflowAdapter = stubCursorAdapter({
    exitCode: 0,
    stdout: Buffer.from("truncated"),
    stderr: Buffer.alloc(0),
    timedOut: false,
    stdoutOverflow: true,
  });
  const overflowRepo = await makeRepo();
  const overflowOutcome = await runReview(
    { repo: overflowRepo.root, task: overflowRepo.taskRel },
    { ...testDeps({ registryYaml: cursorRegistry(), clock: testClock(RUN_ID) }), catalog: cursorCatalog(() => overflowAdapter) },
  );
  assert.equal(overflowOutcome.status?.reason_code, "adapter_error");
  assert.equal(overflowOutcome.exitCode, 1);
  assert.equal(overflowOutcome.status?.adapter_failure?.phase, "collect");
  assert.equal(overflowOutcome.status?.adapter_failure?.cause, "output_overflow");

  const invalidAdapter = stubCursorAdapter({
    exitCode: 0,
    stdout: Buffer.from(JSON.stringify({ schema_version: 2, review_kind: "plan" })),
    stderr: Buffer.alloc(0),
    timedOut: false,
    stdoutOverflow: false,
  });
  const invalidRepo = await makeRepo();
  const invalidOutcome = await runReview(
    { repo: invalidRepo.root, task: invalidRepo.taskRel },
    { ...testDeps({ registryYaml: cursorRegistry(), clock: testClock(RUN_ID) }), catalog: cursorCatalog(() => invalidAdapter) },
  );
  assert.equal(invalidOutcome.status?.reason_code, "result_schema_invalid");

  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(badRepo.root, { recursive: true, force: true });
  await fs.rm(nonzeroRepo.root, { recursive: true, force: true });
  await fs.rm(overflowRepo.root, { recursive: true, force: true });
  await fs.rm(invalidRepo.root, { recursive: true, force: true });
});

function stubCursorAdapter(outcome: {
  exitCode: number | null;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
  stdoutOverflow: boolean;
}): CursorAdapter {
  const adapter = new CursorAdapter({
    runner: {
      start() {
        return {
          wait: async () => outcome,
          cancel: async () => undefined,
        };
      },
    },
  });
  adapter.preflight = async () => undefined;
  return adapter;
}

const HELP_STDOUT = "--print --output-format --mode --sandbox --workspace --trust\n";
const PASS_STDOUT = Buffer.from(
  JSON.stringify({
    result: JSON.stringify({
      schema_version: 2,
      review_kind: "plan",
      verdict: "pass",
      summary: "ok",
      findings: [],
    }),
  }),
);

function probeOk() {
  return {
    wait: async () => ({
      exitCode: 0,
      stdout: Buffer.from(HELP_STDOUT),
      stderr: Buffer.alloc(0),
      timedOut: false,
      stdoutOverflow: false,
    }),
    cancel: async () => undefined,
  };
}

test("stub runner records spawn_failed from a rejected start and the named failure pairs", async () => {
  const startThrowAdapter = new CursorAdapter({
    runner: {
      start(request) {
        if (request.args[0] === "--help") {
          return probeOk();
        }
        throw new Error("spawn rejected");
      },
    },
  });
  const startRepo = await makeRepo();
  const startOutcome = await runReview(
    { repo: startRepo.root, task: startRepo.taskRel },
    {
      ...testDeps({ registryYaml: cursorRegistry(), clock: testClock(RUN_ID) }),
      catalog: cursorCatalog(() => startThrowAdapter),
    },
  );
  assert.equal(startOutcome.status?.reason_code, "adapter_error");
  assert.equal(startOutcome.status?.adapter_failure?.phase, "start");
  assert.equal(startOutcome.status?.adapter_failure?.cause, "spawn_failed");
  assert.equal(startOutcome.status?.adapter_failure?.exit_code, null);

  const collectAdapter = stubCursorAdapter({
    exitCode: 1,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    timedOut: false,
    stdoutOverflow: false,
  });
  const collectRepo = await makeRepo();
  const collectOutcome = await runReview(
    { repo: collectRepo.root, task: collectRepo.taskRel },
    {
      ...testDeps({ registryYaml: cursorRegistry(), clock: testClock(RUN_ID) }),
      catalog: cursorCatalog(() => collectAdapter),
    },
  );
  assert.equal(collectOutcome.status?.reason_code, "adapter_error");
  assert.equal(collectOutcome.status?.adapter_failure?.phase, "collect");
  assert.equal(collectOutcome.status?.adapter_failure?.cause, "exit_nonzero");
  assert.notEqual(startOutcome.status?.adapter_failure?.cause, collectOutcome.status?.adapter_failure?.cause);

  const probeAdapter = new CursorAdapter({
    runner: {
      start() {
        return {
          wait: async () => {
            throw new Error("spawn rejected");
          },
          cancel: async () => undefined,
        };
      },
    },
  });
  const probeRepo = await makeRepo();
  const probeOutcome = await runReview(
    { repo: probeRepo.root, task: probeRepo.taskRel },
    {
      ...testDeps({ registryYaml: cursorRegistry(), clock: testClock(RUN_ID) }),
      catalog: cursorCatalog(() => probeAdapter),
    },
  );
  assert.equal(probeOutcome.status?.reason_code, "capability_denied");
  assert.equal(probeOutcome.status?.adapter_failure?.phase, "preflight");
  assert.equal(probeOutcome.status?.adapter_failure?.cause, "spawn_failed");
  assert.notEqual(probeOutcome.status?.adapter_failure?.cause, "unexpected_error");
  assert.notEqual(probeOutcome.status?.adapter_failure?.phase, collectOutcome.status?.adapter_failure?.phase);
  const probeStatus = await fs.readFile(
    path.join(probeRepo.root, ".spartan-bridge", "runs", RUN_ID, "status.json"),
    "utf8",
  );
  assert.equal(probeStatus.includes("adapter-stderr.log"), false);

  const probeStartThrowAdapter = new CursorAdapter({
    runner: {
      start() {
        throw new Error("spawn rejected");
      },
    },
  });
  const probeStartThrowRepo = await makeRepo();
  const probeStartThrowOutcome = await runReview(
    { repo: probeStartThrowRepo.root, task: probeStartThrowRepo.taskRel },
    {
      ...testDeps({ registryYaml: cursorRegistry(), clock: testClock(RUN_ID) }),
      catalog: cursorCatalog(() => probeStartThrowAdapter),
    },
  );
  assert.equal(probeStartThrowOutcome.status?.reason_code, "capability_denied");
  assert.equal(probeStartThrowOutcome.status?.adapter_failure?.phase, "preflight");
  assert.equal(probeStartThrowOutcome.status?.adapter_failure?.cause, "spawn_failed");
  assert.notEqual(probeStartThrowOutcome.status?.adapter_failure?.cause, "unexpected_error");

  await fs.rm(startRepo.root, { recursive: true, force: true });
  await fs.rm(collectRepo.root, { recursive: true, force: true });
  await fs.rm(probeRepo.root, { recursive: true, force: true });
  await fs.rm(probeStartThrowRepo.root, { recursive: true, force: true });
});

test("preflight probe failures persist observed causes, never unexpected_error", async () => {
  const cases: {
    name: string;
    probe: {
      exitCode: number | null;
      stdout: Buffer;
      stderr: Buffer;
      timedOut: boolean;
      stdoutOverflow: boolean;
    };
    cause: string;
  }[] = [
    {
      name: "timed_out",
      probe: {
        exitCode: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        timedOut: true,
        stdoutOverflow: false,
      },
      cause: "timed_out",
    },
    {
      name: "exit_nonzero",
      probe: {
        exitCode: 127,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        timedOut: false,
        stdoutOverflow: false,
      },
      cause: "exit_nonzero",
    },
    {
      name: "output_overflow",
      probe: {
        exitCode: 0,
        stdout: Buffer.from("truncated"),
        stderr: Buffer.alloc(0),
        timedOut: false,
        stdoutOverflow: true,
      },
      cause: "output_overflow",
    },
    {
      name: "interface_unrecognized",
      probe: {
        exitCode: 0,
        stdout: Buffer.from("some other CLI\n"),
        stderr: Buffer.alloc(0),
        timedOut: false,
        stdoutOverflow: false,
      },
      cause: "interface_unrecognized",
    },
  ];
  for (const testCase of cases) {
    const adapter = new CursorAdapter({
      runner: {
        start() {
          return {
            wait: async () => testCase.probe,
            cancel: async () => undefined,
          };
        },
      },
    });
    const { root, taskRel } = await makeRepo();
    const outcome = await runReview(
      { repo: root, task: taskRel },
      { ...testDeps({ registryYaml: cursorRegistry(), clock: testClock(RUN_ID) }), catalog: cursorCatalog(() => adapter) },
    );
    const { status } = await loadRunStatus(root);
    assert.equal(status.reason_code, "capability_denied", testCase.name);
    assert.equal(status.adapter_failure?.phase, "preflight", testCase.name);
    assert.equal(status.adapter_failure?.cause, testCase.cause, testCase.name);
    assert.notEqual(status.adapter_failure?.cause, "unexpected_error", testCase.name);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("not_spawned is persisted for an unprepared adapter and an invalid model argument", async () => {
  const unprepared = new CursorAdapter({
    runner: {
      start(request) {
        if (request.args[0] === "--help") {
          return probeOk();
        }
        throw new Error("should not spawn");
      },
    },
  });
  unprepared.prepare = async () => undefined;
  const unpreparedRepo = await makeRepo();
  const unpreparedOutcome = await runReview(
    { repo: unpreparedRepo.root, task: unpreparedRepo.taskRel },
    {
      ...testDeps({ registryYaml: cursorRegistry(), clock: testClock(RUN_ID) }),
      catalog: cursorCatalog(() => unprepared),
    },
  );
  assert.equal(unpreparedOutcome.status?.reason_code, "adapter_error");
  assert.equal(unpreparedOutcome.status?.adapter_failure?.phase, "start");
  assert.equal(unpreparedOutcome.status?.adapter_failure?.cause, "not_spawned");

  const invalidModel = new CursorAdapter({
    runner: {
      start(request) {
        if (request.args[0] === "--help") {
          return probeOk();
        }
        return {
          wait: async () => ({
            exitCode: 0,
            stdout: PASS_STDOUT,
            stderr: Buffer.alloc(0),
            timedOut: false,
            stdoutOverflow: false,
          }),
          cancel: async () => undefined,
        };
      },
    },
  });
  const originalStart = invalidModel.start.bind(invalidModel);
  invalidModel.start = async (input) => originalStart({ ...input, model: "-bad" });
  const invalidRepo = await makeRepo();
  const invalidOutcome = await runReview(
    { repo: invalidRepo.root, task: invalidRepo.taskRel },
    {
      ...testDeps({ registryYaml: cursorRegistry(), clock: testClock(RUN_ID) }),
      catalog: cursorCatalog(() => invalidModel),
    },
  );
  assert.equal(invalidOutcome.status?.reason_code, "adapter_error");
  assert.equal(invalidOutcome.status?.adapter_failure?.cause, "not_spawned");
  assert.equal(invalidOutcome.status?.adapter_failure?.phase, "start");

  await fs.rm(unpreparedRepo.root, { recursive: true, force: true });
  await fs.rm(invalidRepo.root, { recursive: true, force: true });
});

test("failing child stderr is written to the run directory and never into status.json", async () => {
  const home = os.homedir();
  const secretLine = `provider outage: rate limit exceeded. Bearer tok_secret Authorization: hdr_secret Authorization: Bearer tok_live_SECRETVALUE sk-live123secret eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sigpart api_key=supersecret ${path.join(home, ".cursor", "config.json")}`;
  const adapter = stubCursorAdapter({
    exitCode: 1,
    stdout: Buffer.alloc(0),
    stderr: Buffer.from(`${secretLine}\n`),
    timedOut: false,
    stdoutOverflow: false,
  });
  const { root, taskRel } = await makeRepo();
  const outcome = await runReview(
    { repo: root, task: taskRel },
    { ...testDeps({ registryYaml: cursorRegistry(), clock: testClock(RUN_ID) }), catalog: cursorCatalog(() => adapter) },
  );
  assert.equal(outcome.status?.reason_code, "adapter_error");
  assert.equal(outcome.status?.adapter_failure?.stderr_log, "adapter-stderr.log");
  assert.equal((outcome.status?.adapter_failure?.stderr_bytes ?? 0) > 0, true);
  const runDir = path.join(root, ".spartan-bridge", "runs", RUN_ID);
  const logPath = path.join(runDir, "adapter-stderr.log");
  const logStat = await fs.stat(logPath);
  assert.equal(logStat.mode & 0o777, 0o600);
  const logText = await fs.readFile(logPath, "utf8");
  assert.equal(logText.includes("provider outage: rate limit exceeded."), true);
  assert.equal(logText.includes("tok_secret"), false);
  assert.equal(logText.includes("tok_live_SECRETVALUE"), false);
  assert.equal(logText.includes("supersecret"), false);
  assert.equal(logText.includes(home), false);
  const statusBytes = await fs.readFile(path.join(runDir, "status.json"), "utf8");
  assert.equal(statusBytes.includes(secretLine), false);
  assert.equal(statusBytes.includes("tok_secret"), false);
  assert.equal(statusBytes.includes(home), false);
  assert.equal(statusBytes.includes(root), false);

  const emptyAdapter = stubCursorAdapter({
    exitCode: 1,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    timedOut: false,
    stdoutOverflow: false,
  });
  const emptyRepo = await makeRepo();
  const emptyOutcome = await runReview(
    { repo: emptyRepo.root, task: emptyRepo.taskRel },
    {
      ...testDeps({ registryYaml: cursorRegistry(), clock: testClock("run-55555555-5555-4555-8555-555555555555") }),
      catalog: cursorCatalog(() => emptyAdapter),
    },
  );
  assert.equal(emptyOutcome.status?.adapter_failure?.stderr_log, null);
  assert.equal(emptyOutcome.status?.adapter_failure?.stderr_bytes, 0);
  await assert.rejects(
    fs.access(path.join(emptyRepo.root, ".spartan-bridge", "runs", "run-55555555-5555-4555-8555-555555555555", "adapter-stderr.log")),
  );

  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(emptyRepo.root, { recursive: true, force: true });
});

test("unparsable output retains a redacted payload log and a successful parse does not", async () => {
  const home = os.homedir();
  const homeFile = path.join(home, ".cursor", "config.json");
  const secretCandidate = `unparsable review text sk-live123secretvalue ${homeFile} Bearer tok_secret_value`;
  const secretAdapter = stubCursorAdapter({
    exitCode: 0,
    stdout: Buffer.from(JSON.stringify({ result: secretCandidate })),
    stderr: Buffer.alloc(0),
    timedOut: false,
    stdoutOverflow: false,
  });
  const secretRepo = await makeRepo();
  const secretRunId = "run-66666666-6666-4666-8666-666666666666";
  const secretOutcome = await runReview(
    { repo: secretRepo.root, task: secretRepo.taskRel },
    {
      ...testDeps({ registryYaml: cursorRegistry(), clock: testClock(secretRunId) }),
      catalog: cursorCatalog(() => secretAdapter),
    },
  );
  assert.equal(secretOutcome.status?.reason_code, "adapter_error");
  assert.equal(secretOutcome.status?.adapter_failure?.cause, "output_unparsable");
  assert.equal(secretOutcome.status?.adapter_failure?.payload_log, "adapter-payload.log");
  const secretRunDir = path.join(secretRepo.root, ".spartan-bridge", "runs", secretRunId);
  const secretLogPath = path.join(secretRunDir, "adapter-payload.log");
  const secretStat = await fs.stat(secretLogPath);
  assert.equal(secretStat.mode & 0o777, 0o600);
  const secretBytes = await fs.readFile(secretLogPath);
  const secretText = secretBytes.toString("utf8");
  assert.equal(secretText.includes("unparsable review text"), true);
  assert.equal(secretText.includes("sk-live123secretvalue"), false);
  assert.equal(secretText.includes("tok_secret_value"), false);
  assert.equal(secretText.includes(home), false);
  assert.equal(secretText.startsWith(`${RETAINED_PAYLOAD_TRUNCATION_MARKER}\n`), false);
  const secretStatus = await fs.readFile(path.join(secretRunDir, "status.json"), "utf8");
  assert.equal(secretStatus.includes(secretCandidate), false);
  assert.equal(secretStatus.includes("sk-live123secretvalue"), false);
  const secretEvents = await fs.readFile(path.join(secretRunDir, "events.jsonl"), "utf8");
  assert.equal(secretEvents.includes(secretCandidate), false);

  const overBody = `BANNER sk-live123secretvalue ${"x".repeat(RETAINED_PAYLOAD_CAP_BYTES)}TAIL`;
  const overAdapter = stubCursorAdapter({
    exitCode: 0,
    stdout: Buffer.from(JSON.stringify({ result: overBody })),
    stderr: Buffer.alloc(0),
    timedOut: false,
    stdoutOverflow: false,
  });
  const overRepo = await makeRepo();
  const overRunId = "run-77777777-7777-4777-8777-777777777777";
  const overOutcome = await runReview(
    { repo: overRepo.root, task: overRepo.taskRel },
    {
      ...testDeps({ registryYaml: cursorRegistry(), clock: testClock(overRunId) }),
      catalog: cursorCatalog(() => overAdapter),
    },
  );
  assert.equal(overOutcome.status?.adapter_failure?.payload_log, "adapter-payload.log");
  const overBytes = await fs.readFile(
    path.join(overRepo.root, ".spartan-bridge", "runs", overRunId, "adapter-payload.log"),
  );
  const marker = Buffer.from(`${RETAINED_PAYLOAD_TRUNCATION_MARKER}\n`, "utf8");
  assert.equal(overBytes.subarray(0, marker.length).equals(marker), true);
  const expectedTail = Buffer.from(redactAdapterStderrText(overBody), "utf8").subarray(
    -RETAINED_PAYLOAD_CAP_BYTES,
  );
  assert.equal(overBytes.subarray(marker.length).equals(expectedTail), true);
  assert.equal(overBytes.length, marker.length + RETAINED_PAYLOAD_CAP_BYTES);
  assert.equal(overBytes.includes(Buffer.from("sk-live123secretvalue")), false);

  const capBody = "y".repeat(RETAINED_PAYLOAD_CAP_BYTES);
  const capAdapter = stubCursorAdapter({
    exitCode: 0,
    stdout: Buffer.from(JSON.stringify({ result: capBody })),
    stderr: Buffer.alloc(0),
    timedOut: false,
    stdoutOverflow: false,
  });
  const capRepo = await makeRepo();
  const capRunId = "run-88888888-8888-4888-8888-888888888888";
  await runReview(
    { repo: capRepo.root, task: capRepo.taskRel },
    {
      ...testDeps({ registryYaml: cursorRegistry(), clock: testClock(capRunId) }),
      catalog: cursorCatalog(() => capAdapter),
    },
  );
  const capBytes = await fs.readFile(
    path.join(capRepo.root, ".spartan-bridge", "runs", capRunId, "adapter-payload.log"),
  );
  assert.equal(capBytes.includes(Buffer.from(RETAINED_PAYLOAD_TRUNCATION_MARKER)), false);
  assert.equal(capBytes.equals(Buffer.from(capBody, "utf8")), true);

  const passAdapter = stubCursorAdapter({
    exitCode: 0,
    stdout: PASS_STDOUT,
    stderr: Buffer.alloc(0),
    timedOut: false,
    stdoutOverflow: false,
  });
  const passRepo = await makeRepo();
  const passRunId = "run-99999999-9999-4999-8999-999999999999";
  const passOutcome = await runReview(
    { repo: passRepo.root, task: passRepo.taskRel },
    {
      ...testDeps({ registryYaml: cursorRegistry(), clock: testClock(passRunId) }),
      catalog: cursorCatalog(() => passAdapter),
    },
  );
  assert.equal(passOutcome.status?.reason_code, "review_passed");
  const passRunDir = path.join(passRepo.root, ".spartan-bridge", "runs", passRunId);
  const passNames = await fs.readdir(passRunDir);
  assert.equal(passNames.includes("adapter-payload.log"), false);
  assert.equal(passOutcome.status?.adapter_failure, null);

  await fs.rm(secretRepo.root, { recursive: true, force: true });
  await fs.rm(overRepo.root, { recursive: true, force: true });
  await fs.rm(capRepo.root, { recursive: true, force: true });
  await fs.rm(passRepo.root, { recursive: true, force: true });
});

const STREAM_HELP = "--print --output-format text | json | stream-json --mode --sandbox --workspace --trust\n";
const REVIEW_PAYLOAD = {
  schema_version: 2,
  review_kind: "plan",
  verdict: "pass",
  summary: "ok",
  findings: [],
};

function streamLines(records: unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function streamingRunner(help: string, chunks: readonly string[]): ProcessRunner {
  return {
    start(request) {
      if (request.args[0] === "--help") {
        return {
          wait: async () => ({
            exitCode: 0,
            stdout: Buffer.from(help),
            stderr: Buffer.alloc(0),
            timedOut: false,
            stdoutOverflow: false,
          }),
          cancel: async () => undefined,
        };
      }
      return {
        wait: async () => {
          for (const chunk of chunks) {
            request.onStdoutChunk?.(Buffer.from(chunk));
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

test("extractReviewPayload returns the same payload for json and stream-json envelopes", () => {
  const jsonDoc = JSON.stringify({ result: JSON.stringify(REVIEW_PAYLOAD) });
  const streamed = streamLines([
    { type: "system", subtype: "init" },
    { type: "thinking", subtype: "delta", text: "ignored" },
    { type: "result", subtype: "success", result: JSON.stringify(REVIEW_PAYLOAD) },
  ]);
  assert.deepEqual(extractReviewPayload(jsonDoc), REVIEW_PAYLOAD);
  assert.deepEqual(extractReviewPayload(streamed), REVIEW_PAYLOAD);
  assert.deepEqual(extractReviewPayload(streamed), extractReviewPayload(jsonDoc));
  assert.deepEqual(
    extractReviewPayload(streamLines([{ type: "result", result: REVIEW_PAYLOAD }])),
    REVIEW_PAYLOAD,
  );
});

test("probe without stream-json keeps json argv; probe with it selects stream-json", async () => {
  const jsonArgs: string[][] = [];
  const jsonRetain: boolean[] = [];
  const jsonAdapter = new CursorAdapter({
    runner: {
      start(request) {
        jsonArgs.push([...request.args]);
        if (request.args[0] !== "--help") {
          jsonRetain.push(request.retainStdout === true);
        }
        if (request.args[0] === "--help") {
          return probeOk();
        }
        return {
          wait: async () => ({
            exitCode: 0,
            stdout: PASS_STDOUT,
            stderr: Buffer.alloc(0),
            timedOut: false,
            stdoutOverflow: false,
          }),
          cancel: async () => undefined,
        };
      },
    },
  });
  const jsonRepo = await makeRepo();
  const jsonOutcome = await runReview(
    { repo: jsonRepo.root, task: jsonRepo.taskRel },
    {
      ...testDeps({ registryYaml: cursorRegistry(), clock: testClock(RUN_ID) }),
      catalog: cursorCatalog(() => jsonAdapter),
    },
  );
  assert.equal(jsonOutcome.status?.reason_code, "review_passed");
  const jsonReview = jsonArgs.find((args) => args[0] === "-p");
  assert.deepEqual(jsonReview?.slice(0, CURSOR_REVIEW_ARGV_PREFIX.length), [...CURSOR_REVIEW_ARGV_PREFIX]);
  assert.equal(jsonReview?.includes("stream-json"), false);
  assert.deepEqual(jsonRetain, [true]);
  await fs.rm(jsonRepo.root, { recursive: true, force: true });

  const recorded: string[][] = [];
  const streamRetain: boolean[] = [];
  const adapter = new CursorAdapter({
    runner: {
      start(request) {
        recorded.push([...request.args]);
        if (request.args[0] !== "--help") {
          streamRetain.push(request.retainStdout === true);
        }
        return streamingRunner(STREAM_HELP, [
          streamLines([{ type: "result", subtype: "success", result: JSON.stringify(REVIEW_PAYLOAD) }]),
        ]).start(request);
      },
    },
  });
  const streamRepo = await makeRepo();
  const streamOutcome = await runReview(
    { repo: streamRepo.root, task: streamRepo.taskRel },
    {
      ...testDeps({ registryYaml: cursorRegistry(), clock: testClock(RUN_ID) }),
      catalog: cursorCatalog(() => adapter),
    },
  );
  assert.equal(streamOutcome.status?.reason_code, "review_passed", streamOutcome.status?.reason_code ?? "");
  const streamReview = recorded.find((args) => args[0] === "-p");
  assert.deepEqual(streamReview?.slice(0, CURSOR_REVIEW_STREAM_ARGV_PREFIX.length), [
    ...CURSOR_REVIEW_STREAM_ARGV_PREFIX,
  ]);
  assert.equal(CURSOR_REVIEW_STREAM_ARGV_PREFIX.includes("stream-json"), true);
  assert.deepEqual(streamRetain, [true]);
  await fs.rm(streamRepo.root, { recursive: true, force: true });
});

test("stream parser retains payload and counters, not thinking volume, and ignores child text", () => {
  const updates: { class: string; records: number; tools: number }[] = [];
  const parser = new ReviewStreamParser(4096, (info) => updates.push(info));
  const thinking = JSON.stringify({
    type: "thinking",
    subtype: "delta",
    text: "sk-live-secret /Users/someone/.cursor \u001b[0m",
  });
  for (let i = 0; i < 40; i += 1) {
    parser.feed(Buffer.from(`${thinking}\n`));
  }
  parser.feed(
    Buffer.from(
      streamLines([
        { type: "mystery_kind", payload: "should-not-leak" },
        { type: "tool_call", subtype: "started", name: "ReadFile" },
        { type: "result", subtype: "success", result: JSON.stringify(REVIEW_PAYLOAD) },
      ]),
    ),
  );
  parser.end();
  assert.equal(parser.overflow, false);
  assert.equal(parser.observedBytes > parser.retainedBytes(), true);
  assert.equal(parser.retainedBytes() < 1024, true);
  assert.equal(parser.records, 43);
  assert.equal(parser.tools, 1);
  assert.equal(parser.resultText, JSON.stringify(REVIEW_PAYLOAD));
  assert.deepEqual(parser.snapshot(), { class: "result", records: 43, tools: 1 });
  assert.equal(updates.some((item) => item.class === "working"), true);
  assert.equal(updates.some((item) => item.class === "tool"), true);
  assert.equal(updates.at(-1)?.class, "result");
  for (const info of updates) {
    assert.equal((REVIEW_PROGRESS_CLASSES as readonly string[]).includes(info.class), true);
    assert.equal(formatReviewStreamLine(info).includes("sk-live-secret"), false);
    assert.equal(formatReviewStreamLine(info).includes("mystery_kind"), false);
    assert.equal(formatReviewStreamLine(info).includes("ReadFile"), false);
    assert.equal(formatReviewStreamLine(info).includes("\u001b"), false);
  }
  const tight = new ReviewStreamParser(32);
  tight.feed(Buffer.from(`${"x".repeat(64)}\n`));
  tight.end();
  assert.equal(tight.overflow, true);
});

async function loadRunStatus(root: string) {
  const { readStatus } = await import("../src/runtime/store.ts");
  return { status: await readStatus(path.join(root, ".spartan-bridge", "runs", RUN_ID)) };
}
