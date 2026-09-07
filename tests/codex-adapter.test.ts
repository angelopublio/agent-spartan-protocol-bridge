import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CODEX_CONSTANT_ARGV_TABLES,
  CODEX_ENV_ALLOWLIST,
  CODEX_EXECUTABLE,
  CODEX_FORBIDDEN_ARGV_TOKENS,
  CODEX_HELP_TOKENS,
  CODEX_LAUNCHER_ID,
  CODEX_LAST_MESSAGE_FILE,
  CODEX_OUTPUT_SCHEMA,
  CODEX_PROBE_ARGV,
  CODEX_PRODUCER_ARGV_AFTER_WORKSPACE,
  CODEX_PRODUCER_ARGV_HEAD,
  CODEX_PRODUCER_TIMEOUT_MS,
  CODEX_IMPLEMENTATION_REVIEW_PROMPT,
  CODEX_REVIEW_TIMEOUT_MS,
  CODEX_REVIEW_PROMPT,
  CODEX_SCHEMA_FILE,
  CODEX_WORKSPACE_FILE_MODE,
  CodexAdapter,
  childEnvironment,
  codexCapabilities,
  codexProducerCapabilities,
  composeCodexEffortConfig,
  composeCodexProducerArgv,
  composeCodexProducerPrompt,
  composeCodexReviewArgv,
  longFormArgvTokens,
} from "../src/adapters/codex.ts";
import { createLauncherCatalog } from "../src/adapters/fake.ts";
import {
  PRODUCER_ISOLATED_WORKSPACE_ENV,
  capabilitiesAllowed,
  isProducerAdapter,
  producerCapabilitiesAllowed,
} from "../src/adapters/adapter.ts";
import { createNodeProcessRunner, type ProcessRunner, type SpawnRequest } from "../src/adapters/process.ts";
import {
  ReviewStreamParser,
  classForRecordType,
} from "../src/adapters/review-stream.ts";
import { sha256Bytes } from "../src/core/serialize.ts";
import { runReview } from "../src/core/review.ts";
import { BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS, EFFORT_LEVELS } from "../src/core/contracts.ts";
import { isInside } from "../src/runtime/paths.ts";
import { VALID_REGISTRY, makeRepo, testClock, testDeps, validAgentsMd } from "./helpers.ts";

const RUN_ID = "run-33333333-3333-4333-8333-333333333333";
const stubSource = fileURLToPath(new URL("./fixtures/codex-stub.mjs", import.meta.url));
const streamSample = fileURLToPath(new URL("./fixtures/codex-stream-sample.jsonl", import.meta.url));
const STUB_PAYLOAD_NAME = "spartan-bridge-codex-stub-last-message";

function codexCatalog(create: () => CodexAdapter) {
  return createLauncherCatalog(() => {
    throw new Error("fake unused");
  }, new Map([[CODEX_LAUNCHER_ID, create]]));
}

function codexRegistry(): string {
  return VALID_REGISTRY.replaceAll("fake-reviewer-v1", CODEX_LAUNCHER_ID);
}

function codexAgents(): string {
  return validAgentsMd({ host: "Codex", model: "gpt-5.6-sol", effort: "high" });
}

function helpStdout(tokens: readonly string[] = CODEX_HELP_TOKENS): string {
  return `${tokens.join(" ")}\n`;
}

async function installStub(bin: string): Promise<string> {
  const stubPath = path.join(bin, CODEX_EXECUTABLE);
  await fs.copyFile(stubSource, stubPath);
  await fs.chmod(stubPath, 0o755);
  return stubPath;
}

function fakeReviewer(options: {
  help?: string;
  writeLastMessage?: string;
}): ProcessRunner {
  return {
    start(request) {
      if (request.args.includes("--help")) {
        return {
          wait: async () => ({
            exitCode: 0,
            stdout: Buffer.from(options.help ?? helpStdout()),
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
          if (lastPath !== undefined && options.writeLastMessage !== undefined) {
            await fs.writeFile(lastPath, options.writeLastMessage);
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

test("the codex plan-review prompt carries the severity rule and the implementation prompt does not", () => {
  assert.match(CODEX_REVIEW_PROMPT, /Severity rule\./);
  assert.match(CODEX_REVIEW_PROMPT, /never on its own justifies changes_requested/);
  assert.doesNotMatch(CODEX_IMPLEMENTATION_REVIEW_PROMPT, /Severity rule\./);
});

test("codex-plan-reviewer-v1 capabilities match the whole object and pass the capability gate", () => {
  const adapter = new CodexAdapter({ runner: createNodeProcessRunner() });
  const caps = codexCapabilities();
  assert.deepEqual(caps, {
    schema_version: 2,
    launcher_id: CODEX_LAUNCHER_ID,
    review_kinds: ["plan", "implementation"],
    permission_modes: ["read-only"],
    workspace_write: false,
    fresh_context: true,
    observes_model: false,
    structured_output: true,
    isolated_workspace: true,
  });
  assert.equal(capabilitiesAllowed(caps), true);
  const producer = codexProducerCapabilities();
  assert.equal(producer.launcher_id, CODEX_LAUNCHER_ID);
  assert.deepEqual(producer.roles, ["implementer"]);
  assert.equal(producerCapabilitiesAllowed(producer), true);
  assert.equal(isProducerAdapter(adapter), true);
  const catalog = codexCatalog(() => adapter);
  assert.equal(catalog.resolve(CODEX_LAUNCHER_ID), adapter);
  assert.throws(() => catalog.resolve("not-a-real-launcher"));
  assert.equal(adapter.observedModel(), null);
});

test("constant argv tables spawn exec, never app-server, and omit forbidden tokens", () => {
  const tokens = CODEX_CONSTANT_ARGV_TABLES.flat();
  for (const forbidden of CODEX_FORBIDDEN_ARGV_TOKENS) {
    assert.equal(tokens.includes(forbidden), false, forbidden);
  }
  assert.deepEqual([...CODEX_PROBE_ARGV], ["exec", "--help"]);
  assert.equal(tokens[0], "exec");
  assert.equal(tokens.includes("app-server"), false);
  const argv = composeCodexReviewArgv({
    workspace: "/tmp/ws",
    model: "gpt-5.6-sol",
    effort: "high",
    schemaPath: "/tmp/schema.json",
    lastMessagePath: "/tmp/last.json",
  });
  assert.equal(argv[0], "exec");
  assert.equal(argv.includes("app-server"), false);
  assert.equal(argv.includes(CODEX_REVIEW_PROMPT), true);
  assert.equal(argv.at(-1), CODEX_REVIEW_PROMPT);
});

test("every long-form review token is derived from the probed set", () => {
  const argv = composeCodexReviewArgv({
    workspace: "/tmp/ws",
    model: "gpt-5.6-sol",
    effort: "high",
    schemaPath: "/tmp/schema.json",
    lastMessagePath: "/tmp/last.json",
  });
  assert.deepEqual(longFormArgvTokens(argv).sort(), [...CODEX_HELP_TOKENS].sort());
});

test("Codex producer argv uses danger-full-access and only probed long-form tokens", () => {
  const input = {
    repoRoot: "/tmp/repo",
    model: "gpt-5.6-sol",
    effort: "high" as const,
    taskPath: "spartan/tasks/0072-add-a-codex-producer-adapter.md",
    approvedPlanRunId: "run-9aa88da2-de7b-479f-b838-59c09a3743ca",
    writeScope: ["src/", "tests/"],
  };
  const argv = composeCodexProducerArgv(input);
  assert.deepEqual([...CODEX_PRODUCER_ARGV_HEAD], [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "danger-full-access",
    "--cd",
  ]);
  assert.deepEqual([...CODEX_PRODUCER_ARGV_AFTER_WORKSPACE], ["--json", "--color", "never"]);
  assert.equal(CODEX_PRODUCER_ARGV_HEAD.includes("read-only" as never), false);
  assert.equal(CODEX_PRODUCER_ARGV_HEAD.includes("workspace-write" as never), false);
  assert.equal(argv.includes("--full-auto"), false);
  assert.equal(argv.includes("--dangerously-bypass-approvals-and-sandbox"), false);
  for (const token of longFormArgvTokens(argv)) {
    assert.equal(CODEX_HELP_TOKENS.includes(token as never), true, token);
  }
  assert.equal(argv.at(-1), composeCodexProducerPrompt(input.taskPath, input.approvedPlanRunId, input.writeScope));
});

test("Codex producer prompt declares a repository-local write boundary and implementation handoff", () => {
  const prompt = composeCodexProducerPrompt(
    "spartan/tasks/0072-add-a-codex-producer-adapter.md",
    "run-9aa88da2-de7b-479f-b838-59c09a3743ca",
    ["src/", "tests/"],
  );
  assert.match(prompt, /`spartan\/tasks\/0072-add-a-codex-producer-adapter\.md`/);
  assert.match(prompt, /`run-9aa88da2-de7b-479f-b838-59c09a3743ca`/);
  assert.match(prompt, /`src\/`/);
  assert.match(prompt, /`tests\/`/);
  assert.match(prompt, /task_type implementation/);
  assert.match(prompt, /phase reviewing/);
  assert.match(prompt, /current_role implementer/);
  assert.match(prompt, /next_role reviewer/);
  assert.match(prompt, /repository path outside that scope fails with `Operation not permitted`/);
  assert.match(prompt, /Do not invoke Spartan Bridge/);
  assert.match(prompt, /Producer stdout is not structured authority/);
  assert.doesNotMatch(prompt, /adapter-enforced writable sandbox/);
  assert.doesNotMatch(prompt, /any write outside (?:that|the) scope (?:is denied|fails)/i);
});

test("effort reaches the child as model_reasoning_effort with max mapped to xhigh", () => {
  const expected: Record<(typeof EFFORT_LEVELS)[number], string> = {
    low: 'model_reasoning_effort="low"',
    medium: 'model_reasoning_effort="medium"',
    high: 'model_reasoning_effort="high"',
    max: 'model_reasoning_effort="xhigh"',
    none: 'model_reasoning_effort="none"',
  };
  for (const effort of EFFORT_LEVELS) {
    assert.equal(composeCodexEffortConfig(effort), expected[effort], effort);
    const argv = composeCodexReviewArgv({
      workspace: "/tmp/ws",
      model: "gpt-5.6-sol",
      effort,
      schemaPath: "/tmp/schema.json",
      lastMessagePath: "/tmp/last.json",
    });
    const configIndex = argv.indexOf("--config");
    assert.equal(argv[configIndex + 1], expected[effort], effort);
    const producerArgv = composeCodexProducerArgv({
      repoRoot: "/tmp/repo",
      model: "gpt-5.6-sol",
      effort,
      taskPath: "spartan/tasks/task.md",
      approvedPlanRunId: "run-9aa88da2-de7b-479f-b838-59c09a3743ca",
      writeScope: ["src/"],
    });
    const producerConfigIndex = producerArgv.indexOf("--config");
    assert.equal(producerArgv[producerConfigIndex + 1], expected[effort], effort);
    assert.equal(producerArgv[producerConfigIndex + 3], 'model="gpt-5.6-sol"', effort);
  }
});

test("Codex producer spawn pins argv, cwd, environment, timeout, and Bridge write-scope profile", async () => {
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
    CODEX_HOME: "/tmp/codex-home",
    OPENAI_API_KEY: "must-not-forward",
  };
  const adapter = new CodexAdapter({ runner, env });
  const approvedPlanRunId = "run-9aa88da2-de7b-479f-b838-59c09a3743ca";
  const writeScope = ["src/", "tests/", "spartan/"];
  await adapter.startProducer({
    execution_id: "exec-codex-1",
    role: "implementer",
    permission_mode: "workspace-write",
    repo_root: root,
    workspace_root: path.dirname(root),
    task_path: taskRel,
    approved_plan_run_id: approvedPlanRunId,
    model: "gpt-5.6-sol",
    effort: "high",
    write_scope: writeScope,
  });
  const prompt = composeCodexProducerPrompt(taskRel, approvedPlanRunId, writeScope);
  assert.deepEqual(recorded[0]?.args, [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "danger-full-access",
    "--cd",
    path.dirname(root),
    "--config",
    'model_reasoning_effort="high"',
    "--config",
    'model="gpt-5.6-sol"',
    "--json",
    "--color",
    "never",
    prompt,
  ]);
  assert.equal(recorded[0]?.executable, CODEX_EXECUTABLE);
  assert.equal(recorded[0]?.cwd, path.dirname(root));
  assert.equal(recorded[0]?.env.CODEX_HOME, "/tmp/codex-home");
  assert.equal(recorded[0]?.env.OPENAI_API_KEY, undefined);
  assert.equal(recorded[0]?.env[PRODUCER_ISOLATED_WORKSPACE_ENV], "1");
  assert.deepEqual(Object.keys(recorded[0]?.env ?? {}).sort(), [
    "CODEX_HOME",
    "HOME",
    "PATH",
    PRODUCER_ISOLATED_WORKSPACE_ENV,
    "TMPDIR",
  ]);
  assert.equal(recorded[0]?.timeoutMs, CODEX_PRODUCER_TIMEOUT_MS);
  assert.equal(CODEX_PRODUCER_TIMEOUT_MS, BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS);
  assert.equal(CODEX_PRODUCER_TIMEOUT_MS > CODEX_REVIEW_TIMEOUT_MS, true);
  assert.equal(typeof recorded[0]?.sandboxProfile, "string");
  assert.ok((recorded[0]?.sandboxProfile ?? "").length > 0);
  assert.deepEqual(await adapter.waitProducer(), { exitCode: 0, timedOut: false });
  assert.equal(recorded[0]?.detached, true);
  await adapter.releaseProducerIsolation();
  await adapter.cleanupProducer();
  await fs.rm(root, { recursive: true, force: true });
});

test("Codex producer honors timeout override without changing live-tree modes", async () => {
  const { root, taskRel } = await makeRepo();
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  const agentsPath = path.join(root, "AGENTS.md");
  const originalMode = (await fs.stat(agentsPath)).mode & 0o777;
  let timeoutMs = 0;
  const adapter = new CodexAdapter({
    runner: {
      start(request) {
        timeoutMs = request.timeoutMs;
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
  await adapter.lockProducerIsolation(root, path.dirname(root));
  await adapter.lockProducerIsolation(root, path.dirname(root));
  assert.equal((await fs.stat(agentsPath)).mode & 0o777, originalMode);
  await adapter.startProducer({
    execution_id: "exec-codex-timeout",
    role: "implementer",
    permission_mode: "workspace-write",
    repo_root: root,
    workspace_root: path.dirname(root),
    task_path: taskRel,
    approved_plan_run_id: "run-9aa88da2-de7b-479f-b838-59c09a3743ca",
    model: "gpt-5.6-sol",
    effort: "none",
    write_scope: ["src/"],
    producer_timeout_ms: 3_600_000,
  });
  assert.equal(timeoutMs, 3_600_000);
  await adapter.waitProducer();
  assert.equal((await fs.stat(agentsPath)).mode & 0o777, originalMode);
  await adapter.releaseProducerIsolation();
  assert.equal((await fs.stat(agentsPath)).mode & 0o777, originalMode);
  await adapter.cleanupProducer();
  await fs.rm(root, { recursive: true, force: true });
});

test("Codex producer restores the write-scope guard when spawn fails", async () => {
  const { root, taskRel } = await makeRepo();
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  const agentsPath = path.join(root, "AGENTS.md");
  const originalMode = (await fs.stat(agentsPath)).mode & 0o777;
  const adapter = new CodexAdapter({ runner: { start() { throw new Error("spawn failed"); } } });
  await assert.rejects(() => adapter.startProducer({
    execution_id: "exec-codex-fail",
    role: "implementer",
    permission_mode: "workspace-write",
    repo_root: root,
    workspace_root: path.dirname(root),
    task_path: taskRel,
    approved_plan_run_id: "run-9aa88da2-de7b-479f-b838-59c09a3743ca",
    model: "gpt-5.6-sol",
    effort: "high",
    write_scope: ["src/"],
  }));
  assert.equal((await fs.stat(agentsPath)).mode & 0o777, originalMode);
  await adapter.cleanupProducer();
  await fs.rm(root, { recursive: true, force: true });
});

test("childEnvironment copies only the allowlist and drops credential-shaped names", () => {
  const env = childEnvironment({
    PATH: "/bin",
    HOME: "/home/user",
    TMPDIR: "/tmp",
    CODEX_API_KEY: "secret",
    OPENAI_API_KEY: "nope",
    TOKEN: "nope",
  });
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "PATH", "TMPDIR"]);
  assert.equal(env.CODEX_API_KEY, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
});

test("childEnvironment forwards CODEX_HOME and AGENT_PROFILES_REAL_HOME when the parent sets them", () => {
  const env = childEnvironment({
    PATH: "/bin",
    HOME: "/home/user",
    CODEX_HOME: "/home/user/.agent-profiles/client-a/codex",
    AGENT_PROFILES_REAL_HOME: "/Users/real",
  });
  assert.equal(env.CODEX_HOME, "/home/user/.agent-profiles/client-a/codex");
  assert.equal(env.AGENT_PROFILES_REAL_HOME, "/Users/real");
});

test("childEnvironment omits CODEX_HOME and AGENT_PROFILES_REAL_HOME when the parent does not set them", () => {
  const env = childEnvironment({ PATH: "/bin", HOME: "/home/user" });
  assert.equal("CODEX_HOME" in env, false);
  assert.equal("AGENT_PROFILES_REAL_HOME" in env, false);
});

test("spawn-level stub pins argv, cwd, environment, and a workspace of only AGENTS.md and task.md", async () => {
  const { root, taskRel } = await makeRepo({ agents: codexAgents() });
  const agentsBytes = new Uint8Array(await fs.readFile(path.join(root, "AGENTS.md")));
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-bin-"));
  await installStub(bin);
  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-codex-tmp-"));
  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    HOME: process.env.HOME,
    TMPDIR: tmpdir,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    TERM: process.env.TERM,
    CODEX_HOME: "/home/user/.agent-profiles/client-a/codex",
    CODEX_API_KEY: "must-not-forward",
    OPENAI_API_KEY: "must-not-forward",
  };
  type Recorded = SpawnRequest & {
    names: string[];
    agentsHash: string;
    dirMode: number;
    fileModes: { agents: number; task: number };
    schemaOutside: boolean;
    lastOutside: boolean;
  };
  const recorded: Recorded[] = [];
  const real = createNodeProcessRunner();
  const runner: ProcessRunner = {
    start(request) {
      const isReview = request.args[0] === "exec" && !request.args.includes("--help");
      const workspace = isReview ? request.args[request.args.indexOf("--cd") + 1] : "";
      const schemaPath = isReview ? request.args[request.args.indexOf("--output-schema") + 1] : "";
      const lastPath = isReview ? request.args[request.args.indexOf("--output-last-message") + 1] : "";
      const sync = {
        names: isReview ? readdirSync(workspace) : [],
        agentsHash: isReview
          ? sha256Bytes(new Uint8Array(readFileSync(path.join(workspace, "AGENTS.md"))))
          : "",
        dirMode: isReview ? statSync(workspace).mode : 0,
        fileModes: isReview
          ? {
              agents: statSync(path.join(workspace, "AGENTS.md")).mode & 0o777,
              task: statSync(path.join(workspace, "task.md")).mode & 0o777,
            }
          : { agents: 0, task: 0 },
        schemaOutside: isReview ? !String(schemaPath).startsWith(`${workspace}${path.sep}`) : false,
        lastOutside: isReview ? !String(lastPath).startsWith(`${workspace}${path.sep}`) : false,
      };
      recorded.push({ ...request, ...sync });
      return real.start(request);
    },
  };

  const makeAdapter = () => new CodexAdapter({ runner, env });
  const outcome = await runReview(
    { repo: root, task: taskRel },
    { ...testDeps({ registryYaml: codexRegistry(), clock: testClock(RUN_ID) }), catalog: codexCatalog(makeAdapter) },
  );
  assert.equal(outcome.status?.reason_code, "review_passed", outcome.status?.reason_code ?? "");
  const reviews = recorded.filter((item) => item.args[0] === "exec" && !item.args.includes("--help"));
  const probes = recorded.filter((item) => item.args.includes("--help"));
  assert.equal(probes.length >= 1, true);
  assert.equal(reviews.length, 1);
  const review = reviews[0]!;
  assert.deepEqual(review.args.slice(0, 6), ["exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only", "--cd"]);
  const workspace = review.args[6];
  assert.equal(typeof workspace, "string");
  assert.equal(isInside(root, workspace as string), false);
  assert.equal(review.args.includes("--config"), true);
  assert.equal(review.args.includes('model_reasoning_effort="high"'), true);
  assert.equal(review.args.includes('model="gpt-5.6-sol"'), true);
  assert.equal(review.args.includes("--output-schema"), true);
  assert.equal(review.args.includes("--output-last-message"), true);
  assert.equal(review.args.at(-1), CODEX_REVIEW_PROMPT);
  assert.equal(review.executable, CODEX_EXECUTABLE);
  // cwd is the ephemeral workspace root (the `--cd` value), matching Grok/Claude,
  // so a machine-local `codex` wrapper resolves the client context from $PWD.
  assert.equal(review.cwd, workspace);
  assert.equal(isInside(root, review.cwd), false);
  assert.equal(review.cwd.startsWith(`${os.tmpdir()}${path.sep}`), true);
  assert.equal(review.schemaOutside, true);
  assert.equal(review.lastOutside, true);
  const schemaPath = review.args[review.args.indexOf("--output-schema") + 1];
  const lastPath = review.args[review.args.indexOf("--output-last-message") + 1];
  const runDir = await fs.realpath(path.join(root, ".spartan-bridge", "runs", RUN_ID));
  assert.equal(await fs.realpath(schemaPath ?? ""), path.join(runDir, CODEX_SCHEMA_FILE));
  assert.equal(await fs.realpath(lastPath ?? ""), path.join(runDir, CODEX_LAST_MESSAGE_FILE));
  assert.equal(isInside(runDir, schemaPath ?? ""), true);
  assert.equal(isInside(runDir, lastPath ?? ""), true);
  assert.equal(path.basename(schemaPath ?? ""), CODEX_SCHEMA_FILE);
  assert.equal(path.basename(lastPath ?? ""), CODEX_LAST_MESSAGE_FILE);
  assert.equal(outcome.status?.model, "gpt-5.6-sol");
  assert.equal(outcome.status?.effort, "high");
  assert.equal(outcome.status?.model_observed, "declared_unobserved");
  assert.deepEqual(
    Object.keys(review.env).sort(),
    [...CODEX_ENV_ALLOWLIST].filter((key) => env[key] !== undefined).sort(),
  );
  assert.equal(review.env.CODEX_API_KEY, undefined);
  assert.equal(review.env.OPENAI_API_KEY, undefined);
  assert.equal(review.env.CODEX_HOME, "/home/user/.agent-profiles/client-a/codex");
  assert.deepEqual(review.names.sort(), ["AGENTS.md", "task.md"]);
  assert.equal(review.agentsHash, sha256Bytes(agentsBytes));
  assert.equal(review.dirMode & 0o777, 0o555);
  assert.equal(CODEX_WORKSPACE_FILE_MODE, 0o444);
  assert.equal(review.fileModes.agents, 0o444);
  assert.equal(review.fileModes.task, 0o444);
  await assert.rejects(fs.access(workspace as string));

  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(bin, { recursive: true, force: true });
  await fs.rm(tmpdir, { recursive: true, force: true });
});

test("schema and last-message files live under the run directory; workspace still holds only the two copies", async () => {
  const { root, taskRel } = await makeRepo({ agents: codexAgents() });
  const agentsBytes = await fs.readFile(path.join(root, "AGENTS.md"));
  const taskBytes = await fs.readFile(path.join(root, taskRel));
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-bin-"));
  await installStub(bin);
  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-codex-tmp-"));
  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    HOME: process.env.HOME,
    TMPDIR: tmpdir,
  };
  let afterNames: string[] = [];
  let afterAgents: Buffer = Buffer.alloc(0);
  let afterTask: Buffer = Buffer.alloc(0);
  let schemaPath = "";
  let lastPath = "";
  const real = createNodeProcessRunner();
  const runner: ProcessRunner = {
    start(request) {
      const handle = real.start(request);
      if (request.args[0] !== "exec" || request.args.includes("--help")) {
        return handle;
      }
      const workspace = request.args[request.args.indexOf("--cd") + 1]!;
      schemaPath = request.args[request.args.indexOf("--output-schema") + 1]!;
      lastPath = request.args[request.args.indexOf("--output-last-message") + 1]!;
      return {
        wait: async () => {
          const outcome = await handle.wait();
          afterNames = readdirSync(workspace).sort();
          afterAgents = readFileSync(path.join(workspace, "AGENTS.md"));
          afterTask = readFileSync(path.join(workspace, "task.md"));
          return outcome;
        },
        cancel: () => handle.cancel(),
      };
    },
  };
  const outcome = await runReview(
    { repo: root, task: taskRel },
    {
      ...testDeps({ registryYaml: codexRegistry(), clock: testClock(RUN_ID) }),
      catalog: codexCatalog(() => new CodexAdapter({ runner, env })),
    },
  );
  assert.equal(outcome.status?.reason_code, "review_passed");
  assert.deepEqual(afterNames, ["AGENTS.md", "task.md"]);
  assert.equal(Buffer.compare(afterAgents, agentsBytes), 0);
  assert.equal(Buffer.compare(afterTask, taskBytes), 0);
  const runDir = await fs.realpath(path.join(root, ".spartan-bridge", "runs", RUN_ID));
  assert.equal(await fs.realpath(schemaPath), path.join(runDir, CODEX_SCHEMA_FILE));
  assert.equal(await fs.realpath(lastPath), path.join(runDir, CODEX_LAST_MESSAGE_FILE));
  assert.equal(isInside(runDir, schemaPath), true);
  assert.equal(isInside(runDir, lastPath), true);
  assert.equal(await fs.readFile(schemaPath, "utf8"), CODEX_OUTPUT_SCHEMA);
  assert.equal(path.basename(lastPath), CODEX_LAST_MESSAGE_FILE);
  await fs.access(schemaPath);
  await fs.access(lastPath);
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(bin, { recursive: true, force: true });
  await fs.rm(tmpdir, { recursive: true, force: true });
});

test("a last message that is not JSON ends the run output_unparsable and quotes the stub bytes", async () => {
  const { root, taskRel } = await makeRepo({ agents: codexAgents() });
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-bin-"));
  await installStub(bin);
  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-codex-tmp-"));
  const bytes = "this is not json";
  await fs.writeFile(path.join(tmpdir, STUB_PAYLOAD_NAME), bytes);
  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    HOME: process.env.HOME,
    TMPDIR: tmpdir,
  };
  let written = "";
  const real = createNodeProcessRunner();
  const runner: ProcessRunner = {
    start(request) {
      const handle = real.start(request);
      if (request.args[0] !== "exec" || request.args.includes("--help")) {
        return handle;
      }
      const lastPath = request.args[request.args.indexOf("--output-last-message") + 1]!;
      return {
        wait: async () => {
          const outcome = await handle.wait();
          written = readFileSync(lastPath, "utf8");
          return outcome;
        },
        cancel: () => handle.cancel(),
      };
    },
  };
  const outcome = await runReview(
    { repo: root, task: taskRel },
    {
      ...testDeps({ registryYaml: codexRegistry(), clock: testClock(RUN_ID) }),
      catalog: codexCatalog(() => new CodexAdapter({ runner, env })),
    },
  );
  assert.equal(written, bytes);
  assert.equal(outcome.status?.reason_code, "adapter_error");
  assert.equal(outcome.status?.adapter_failure?.phase, "collect");
  assert.equal(outcome.status?.adapter_failure?.cause, "output_unparsable");
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(bin, { recursive: true, force: true });
  await fs.rm(tmpdir, { recursive: true, force: true });
});

test("a last message that is JSON but not the review contract ends result_schema_invalid and quotes the stub bytes", async () => {
  const { root, taskRel } = await makeRepo({ agents: codexAgents() });
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-bin-"));
  await installStub(bin);
  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-codex-tmp-"));
  const bytes = '{"schema_version":2,"review_kind":"plan"}';
  await fs.writeFile(path.join(tmpdir, STUB_PAYLOAD_NAME), bytes);
  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    HOME: process.env.HOME,
    TMPDIR: tmpdir,
  };
  let written = "";
  const real = createNodeProcessRunner();
  const runner: ProcessRunner = {
    start(request) {
      const handle = real.start(request);
      if (request.args[0] !== "exec" || request.args.includes("--help")) {
        return handle;
      }
      const lastPath = request.args[request.args.indexOf("--output-last-message") + 1]!;
      return {
        wait: async () => {
          const outcome = await handle.wait();
          written = readFileSync(lastPath, "utf8");
          return outcome;
        },
        cancel: () => handle.cancel(),
      };
    },
  };
  const outcome = await runReview(
    { repo: root, task: taskRel },
    {
      ...testDeps({ registryYaml: codexRegistry(), clock: testClock(RUN_ID) }),
      catalog: codexCatalog(() => new CodexAdapter({ runner, env })),
    },
  );
  assert.equal(written, bytes);
  assert.equal(outcome.status?.reason_code, "result_schema_invalid");
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(bin, { recursive: true, force: true });
  await fs.rm(tmpdir, { recursive: true, force: true });
});

test("codex.ts has no extraction heuristics and no stdio setting", async () => {
  const source = await fs.readFile(fileURLToPath(new URL("../src/adapters/codex.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(source, /collectBalancedSpans/);
  assert.doesNotMatch(source, /lastJsonFence/);
  assert.doesNotMatch(source, /scanVerdictShapedCandidate/);
  assert.doesNotMatch(source, /lastBalancedObject/);
  assert.doesNotMatch(source, /stdio/);
});

test("the process runner ignores stdin and SpawnRequest has no stdio field", async () => {
  const processSource = await fs.readFile(fileURLToPath(new URL("../src/adapters/process.ts", import.meta.url)), "utf8");
  const spawnRequest = processSource.slice(
    processSource.indexOf("export type SpawnRequest"),
    processSource.indexOf("export type SpawnOutcome"),
  );
  assert.doesNotMatch(spawnRequest, /stdio/);
  assert.match(processSource, /stdio: \["ignore", "pipe", "pipe"\]/);
  const runner = createNodeProcessRunner();
  const handle = runner.start({
    executable: process.execPath,
    args: [
      "-e",
      "let n=0; process.stdin.on('data',c=>{n+=c.length}); process.stdin.on('end',()=>{process.stdout.write(String(n));});",
    ],
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH },
    timeoutMs: 5_000,
    stdoutCapBytes: 64,
  });
  const outcome = await handle.wait();
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.stdout.toString("utf8"), "0");
});

function codexProbeOk() {
  return {
    wait: async () => ({
      exitCode: 0,
      stdout: Buffer.from(helpStdout()),
      stderr: Buffer.alloc(0),
      timedOut: false,
      stdoutOverflow: false,
    }),
    cancel: async () => undefined,
  };
}

test("Codex producer preflight fails closed off Darwin without spawning sandbox-exec", async () => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "linux" });
  try {
    const executed: string[] = [];
    const adapter = new CodexAdapter({
      runner: {
        start(request) {
          executed.push(request.executable);
          return codexProbeOk();
        },
      },
      env: { PATH: "/usr/bin", HOME: "/tmp", TMPDIR: os.tmpdir() },
    });
    await assert.rejects(() => adapter.producerPreflight());
    assert.deepEqual(executed, [CODEX_EXECUTABLE]);
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  }
});

test("Codex producer preflight probes codex then sandbox-exec on Darwin", async () => {
  assert.equal(process.platform, "darwin");
  const executed: string[] = [];
  const adapter = new CodexAdapter({
    runner: {
      start(request) {
        executed.push(request.executable);
        return codexProbeOk();
      },
    },
    env: { PATH: "/usr/bin", HOME: "/tmp", TMPDIR: os.tmpdir() },
  });
  await adapter.producerPreflight();
  assert.deepEqual(executed, [CODEX_EXECUTABLE, "/usr/bin/sandbox-exec"]);
});

test("preflight requires each of the nine tokens and starts no review when one is missing", async () => {
  for (const missing of CODEX_HELP_TOKENS) {
    let reviewStarted = false;
    const remaining = CODEX_HELP_TOKENS.filter((token) => token !== missing);
    const adapter = new CodexAdapter({
      runner: {
        start(request) {
          if (request.args.includes("--help")) {
            return {
              wait: async () => ({
                exitCode: 0,
                stdout: Buffer.from(helpStdout(remaining)),
                stderr: Buffer.alloc(0),
                timedOut: false,
                stdoutOverflow: false,
              }),
              cancel: async () => undefined,
            };
          }
          reviewStarted = true;
          throw new Error("review must not start");
        },
      },
    });
    const { root, taskRel } = await makeRepo({ agents: codexAgents() });
    const outcome = await runReview(
      { repo: root, task: taskRel },
      {
        ...testDeps({ registryYaml: codexRegistry(), clock: testClock(RUN_ID) }),
        catalog: codexCatalog(() => adapter),
      },
    );
    assert.equal(outcome.status?.reason_code, "capability_denied", missing);
    assert.equal(outcome.status?.adapter_failure?.phase, "preflight", missing);
    assert.equal(outcome.status?.adapter_failure?.cause, "interface_unrecognized", missing);
    assert.equal(reviewStarted, false, missing);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("classForRecordType maps Codex names to working and result, never tool", () => {
  assert.equal(classForRecordType("thread.started"), "working");
  assert.equal(classForRecordType("turn.started"), "working");
  assert.equal(classForRecordType("item.started"), "working");
  assert.equal(classForRecordType("item.completed"), "working");
  assert.equal(classForRecordType("turn.completed"), "result");
  assert.notEqual(classForRecordType("thread.started"), "tool");
  assert.notEqual(classForRecordType("item.started"), "tool");
  assert.notEqual(classForRecordType("turn.completed"), "tool");
});

test("KIND_RE is unchanged and still admits Codex item names", async () => {
  const source = await fs.readFile(
    fileURLToPath(new URL("../src/adapters/review-stream.ts", import.meta.url)),
    "utf8",
  );
  assert.match(source, /const KIND_RE = \/\^\[A-Za-z0-9\._-\]\{1,64\}\$\/;/);
});

test("ReviewStreamParser counts one tool per item.started command_execution and none for agent_message", () => {
  const parser = new ReviewStreamParser(4096);
  parser.feed(
    Buffer.from(
      `${JSON.stringify({ type: "item.started", item: { id: "item_1", type: "command_execution" } })}\n`,
    ),
  );
  parser.feed(
    Buffer.from(`${JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "command_execution" } })}\n`),
  );
  parser.feed(
    Buffer.from(`${JSON.stringify({ type: "item.started", item: { id: "item_0", type: "agent_message" } })}\n`),
  );
  parser.end();
  assert.equal(parser.tools, 1);
  assert.equal(parser.snapshot().class, "working");

  const missing = new ReviewStreamParser(4096);
  missing.feed(
    Buffer.from(`${JSON.stringify({ type: "item.started", item: { id: "item_1", type: "command_execution" } })}\n`),
  );
  const before = missing.snapshot();
  assert.equal(before.class, "working");
  assert.equal(before.tools, 1);
  missing.feed(Buffer.from(`${JSON.stringify({ type: "item.started" })}\n`));
  missing.feed(Buffer.from(`${JSON.stringify({ type: "item.started", item: { id: "x" } })}\n`));
  missing.feed(Buffer.from(`${JSON.stringify({ type: "item.started", item: { type: 1 } })}\n`));
  missing.end();
  assert.equal(missing.tools, 1);
  assert.equal(missing.snapshot().class, before.class);
  assert.notEqual(missing.snapshot().class, "tool");
});

test("replay of the committed Codex stream fixture ends at result with seven records and one tool", async () => {
  const text = await fs.readFile(streamSample, "utf8");
  const parser = new ReviewStreamParser(64 * 1024);
  parser.feed(Buffer.from(text));
  parser.end();
  assert.deepEqual(parser.snapshot(), { class: "result", records: 7, tools: 1 });
});

test("0064 D1: a non-zero codex review exit surfaces the child's stdout in output_excerpt", async () => {
  const { root, taskRel } = await makeRepo({ agents: codexAgents() });
  const seen: string[] = [];
  const runner = {
    start(request: { args: readonly string[]; retainStdout?: boolean }) {
      if (request.args.includes("--help")) {
        return {
          wait: async () => ({
            exitCode: 0,
            signal: null,
            stdout: Buffer.from(helpStdout()),
            stderr: Buffer.alloc(0),
            timedOut: false,
            stdoutOverflow: false,
          }),
          cancel: async () => undefined,
        };
      }
      seen.push(request.retainStdout === true ? "retain" : "drop");
      return {
        wait: async () => ({
          exitCode: 1,
          signal: null,
          stdout: request.retainStdout === true ? Buffer.from("You've hit your usage limit\n") : Buffer.alloc(0),
          stderr: Buffer.alloc(0),
          timedOut: false,
          stdoutOverflow: false,
        }),
        cancel: async () => undefined,
      };
    },
  };
  const adapter = new CodexAdapter({ runner: runner as never });
  const outcome = await runReview(
    { repo: root, task: taskRel },
    {
      ...testDeps({ registryYaml: codexRegistry(), clock: testClock(RUN_ID) }),
      catalog: codexCatalog(() => adapter),
    },
  );
  assert.equal(outcome.status?.reason_code, "adapter_error");
  assert.equal(outcome.status?.adapter_failure?.cause, "output_unparsable");
  assert.equal(outcome.status?.adapter_failure?.payload_log, "adapter-payload.log");
  assert.equal(outcome.status?.adapter_failure?.output_excerpt, null);
  assert.match(
    await fs.readFile(path.join(root, ".spartan-bridge", "runs", RUN_ID, "adapter-payload.log"), "utf8"),
    /hit your usage limit/,
  );
  assert.equal(seen.includes("retain"), true);
  await fs.rm(root, { recursive: true, force: true });
});

test("codex adapter collect returns the last-message object unjudged", async () => {
  const payload = {
    schema_version: 2,
    review_kind: "plan",
    verdict: "pass",
    summary: "ok",
    findings: [],
  };
  const { root, taskRel } = await makeRepo({ agents: codexAgents() });
  const adapter = new CodexAdapter({
    runner: fakeReviewer({ writeLastMessage: `${JSON.stringify(payload)}\n` }),
  });
  const outcome = await runReview(
    { repo: root, task: taskRel },
    {
      ...testDeps({ registryYaml: codexRegistry(), clock: testClock(RUN_ID) }),
      catalog: codexCatalog(() => adapter),
    },
  );
  assert.equal(outcome.status?.reason_code, "review_passed");
  await fs.rm(root, { recursive: true, force: true });
});
