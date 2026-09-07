import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CLAUDE_ENV_ALLOWLIST,
  CLAUDE_EXECUTABLE,
  CLAUDE_FORBIDDEN_ARGV_TOKENS,
  CLAUDE_HELP_TOKENS,
  CLAUDE_IMPLEMENTATION_REVIEW_PROMPT,
  CLAUDE_LAUNCHER_ID,
  CLAUDE_PROBE_ARGV,
  CLAUDE_REVIEW_ARGV_HEAD,
  CLAUDE_REVIEW_PROMPT,
  ClaudeAdapter,
  childEnvironment,
  claudeCapabilities,
  composeClaudeReviewArgv,
} from "../src/adapters/claude.ts";
import { createLauncherCatalog } from "../src/adapters/fake.ts";
import { AdapterFailureError, capabilitiesAllowed } from "../src/adapters/adapter.ts";
import { createNodeProcessRunner, type SpawnRequest } from "../src/adapters/process.ts";
import { reviewOutputSchema } from "../src/adapters/review-schema.ts";
import { makeRepo } from "./helpers.ts";

function claudeCatalog(create: () => ClaudeAdapter) {
  return createLauncherCatalog(create, new Map([[CLAUDE_LAUNCHER_ID, create]]));
}

test("0064 D1: a non-zero review exit retains the child's stdout for the failure excerpt", async () => {
  const { root, taskRel } = await makeRepo();
  const seen: SpawnRequest[] = [];
  const adapter = new ClaudeAdapter({
    runner: {
      start(request) {
        seen.push(request);
        // Faithful to createNodeProcessRunner: stdout is kept only when asked.
        const retained = request.retainStdout === true;
        return {
          wait: async () => ({
            exitCode: 1,
            signal: null,
            stdout: retained ? Buffer.from("You've hit your usage limit\n") : Buffer.alloc(0),
            stderr: Buffer.alloc(0),
            timedOut: false,
            stdoutOverflow: false,
          }),
          cancel: async () => undefined,
        };
      },
    },
    env: { PATH: "/usr/bin", HOME: "/tmp", TMPDIR: os.tmpdir() },
  });
  adapter.preflight = async () => undefined;
  const input = {
    execution_id: "exec-claude-0064",
    review_kind: "plan" as const,
    permission_mode: "read-only" as const,
    repo_root: root,
    run_dir: path.join(root, ".spartan-bridge", "runs", "run-claude-0064"),
    task_path: taskRel,
    task_content: "",
    task_hash: "sha256:task",
    agents_content: "",
    agents_hash: "sha256:agents",
    policy_digest: "sha256:policy",
    model: "claude-opus-5",
    effort: "medium" as const,
    implementation_review_scope: [],
  };
  await adapter.prepare(input);
  await adapter.start(input);
  const err = await adapter.collect().then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(err instanceof AdapterFailureError, "collect should throw AdapterFailureError");
  assert.equal(err.adapterFailure.cause, "output_unparsable");
  assert.equal(err.adapterFailure.signal, null);
  assert.equal(err.adapterFailure.http_status, null);
  assert.match(err.output.toString("utf8"), /hit your usage limit/);
  const reviewSpawn = seen.find((r) => r.args.includes(CLAUDE_REVIEW_PROMPT));
  assert.equal(reviewSpawn?.retainStdout, true);
});

function claudeCollectStub(outcome: {
  exitCode: number | null;
  signal?: string | null;
  stdout: Buffer;
}): ClaudeAdapter {
  const adapter = new ClaudeAdapter({
    runner: {
      start() {
        return {
          wait: async () => ({
            exitCode: outcome.exitCode,
            signal: outcome.signal ?? null,
            stdout: outcome.stdout,
            stderr: Buffer.alloc(0),
            timedOut: false,
            stdoutOverflow: false,
          }),
          cancel: async () => undefined,
        };
      },
    },
    env: { PATH: "/usr/bin", HOME: "/tmp", TMPDIR: os.tmpdir() },
  });
  adapter.preflight = async () => undefined;
  return adapter;
}

async function collectClaudeFailure(
  outcome: { exitCode: number | null; signal?: string | null; stdout: Buffer },
): Promise<AdapterFailureError> {
  const { root, taskRel } = await makeRepo();
  const adapter = claudeCollectStub(outcome);
  const input = {
    execution_id: "exec-claude-0064-collect",
    review_kind: "plan" as const,
    permission_mode: "read-only" as const,
    repo_root: root,
    run_dir: path.join(root, ".spartan-bridge", "runs", "run-claude-0064-collect"),
    task_path: taskRel,
    task_content: "",
    task_hash: "sha256:task",
    agents_content: "",
    agents_hash: "sha256:agents",
    policy_digest: "sha256:policy",
    model: "claude-opus-5",
    effort: "medium" as const,
    implementation_review_scope: [],
  };
  await adapter.prepare(input);
  await adapter.start(input);
  const err = await adapter.collect().then(
    () => null,
    (e: unknown) => e,
  );
  await adapter.cleanup();
  await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  assert.ok(err instanceof AdapterFailureError, "collect should throw AdapterFailureError");
  return err;
}

test("D1a: Claude collect remaps 529 to provider_unavailable and 429 to provider_limit", async () => {
  const overloaded = Buffer.from(
    [
      '{"type":"system","subtype":"init","cwd":"/tmp"}',
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: true,
        api_error_status: 529,
        terminal_reason: "api_error",
        result: "API Error: 529 Overloaded.",
      }),
    ].join("\n"),
  );
  const unavailable = await collectClaudeFailure({ exitCode: 1, stdout: overloaded });
  assert.equal(unavailable.adapterFailure.cause, "provider_unavailable");
  assert.equal(unavailable.adapterFailure.http_status, 529);
  assert.equal(unavailable.payload, null);
  assert.match(unavailable.output.toString("utf8"), /api_error_status/);
  assert.equal(unavailable.adapterFailure.cause.includes("Overloaded"), false);

  const limited = await collectClaudeFailure({
    exitCode: 1,
    stdout: Buffer.from(JSON.stringify({ type: "result", is_error: true, api_error_status: 429 })),
  });
  assert.equal(limited.adapterFailure.cause, "provider_limit");
  assert.equal(limited.adapterFailure.http_status, 429);
});

test("D2/D3: Claude collect threads SIGKILL, output_unparsable, and unremapped http_status", async () => {
  const killed = await collectClaudeFailure({
    exitCode: null,
    signal: "SIGKILL",
    stdout: Buffer.alloc(0),
  });
  assert.equal(killed.adapterFailure.cause, "exit_nonzero");
  assert.equal(killed.adapterFailure.signal, "SIGKILL");
  assert.equal(killed.adapterFailure.http_status, null);

  const garbage = await collectClaudeFailure({
    exitCode: 1,
    stdout: Buffer.from("partial non-json stdout\n"),
  });
  assert.equal(garbage.adapterFailure.cause, "output_unparsable");
  assert.equal(garbage.payload, "partial non-json stdout\n");

  const unauthorized = await collectClaudeFailure({
    exitCode: 1,
    stdout: Buffer.from(
      JSON.stringify({
        type: "result",
        is_error: true,
        api_error_status: 401,
        result: "not a review payload",
      }),
    ),
  });
  assert.equal(unauthorized.adapterFailure.cause, "output_unparsable");
  assert.equal(unauthorized.adapterFailure.http_status, 401);

  const verdict = {
    schema_version: 2,
    review_kind: "plan",
    verdict: "pass",
    summary: "ok",
    findings: [],
  };
  const parsable = await collectClaudeFailure({
    exitCode: 1,
    stdout: Buffer.from(
      JSON.stringify({
        type: "result",
        is_error: true,
        api_error_status: 401,
        result: JSON.stringify(verdict),
      }),
    ),
  });
  assert.equal(parsable.adapterFailure.cause, "exit_nonzero");
  assert.equal(parsable.adapterFailure.http_status, 401);
  assert.equal(parsable.payload, null);
});

test("the plan-review prompt carries the severity rule and the implementation prompt does not", () => {
  assert.match(CLAUDE_REVIEW_PROMPT, /Severity rule\./);
  assert.match(CLAUDE_REVIEW_PROMPT, /never on its own justifies changes_requested/);
  assert.match(CLAUDE_REVIEW_PROMPT, /return pass even if it could be tightened/);
  assert.doesNotMatch(CLAUDE_IMPLEMENTATION_REVIEW_PROMPT, /Severity rule\./);
});

test("claude-plan-reviewer-v1 capabilities are schema-constrained and pass the gate", () => {
  const caps = claudeCapabilities();
  assert.deepEqual(caps, {
    schema_version: 2,
    launcher_id: CLAUDE_LAUNCHER_ID,
    review_kinds: ["plan", "implementation"],
    permission_modes: ["read-only"],
    workspace_write: false,
    fresh_context: true,
    observes_model: false,
    structured_output: true,
    isolated_workspace: true,
  });
  assert.equal(capabilitiesAllowed(caps), true);
  const adapter = new ClaudeAdapter({ runner: createNodeProcessRunner() });
  const catalog = claudeCatalog(() => adapter);
  assert.equal(catalog.resolve(CLAUDE_LAUNCHER_ID), adapter);
  assert.equal(adapter.observedModel(), null);
});

test("review argv is read-only headless and carries the inline JSON schema", () => {
  const args = composeClaudeReviewArgv({ model: "claude-sonnet-5", effort: "medium", reviewKind: "plan" });
  assert.deepEqual(args.slice(0, CLAUDE_REVIEW_ARGV_HEAD.length), [...CLAUDE_REVIEW_ARGV_HEAD]);
  assert.equal(args.includes("-p"), true);
  assert.equal(args.includes("--permission-mode"), true);
  assert.equal(args[args.indexOf("--permission-mode") + 1], "plan");
  const schemaIndex = args.indexOf("--json-schema");
  assert.ok(schemaIndex > 0);
  assert.equal(args[schemaIndex + 1], reviewOutputSchema("plan").trimEnd());
  assert.doesNotMatch(args[schemaIndex + 1] ?? "", /\n$/);
  assert.equal(args[args.indexOf("--model") + 1], "claude-sonnet-5");
  assert.equal(args[args.indexOf("--effort") + 1], "medium");
  assert.equal(args.at(-1)?.startsWith("You are a read-only plan reviewer."), true);
});

test("effort none omits the effort flag; implementation kind pins the schema const", () => {
  const args = composeClaudeReviewArgv({ model: "claude-sonnet-5", effort: "none", reviewKind: "implementation" });
  assert.equal(args.includes("--effort"), false);
  assert.equal(args[args.indexOf("--json-schema") + 1], reviewOutputSchema("implementation").trimEnd());
  assert.equal(args.at(-1)?.startsWith("You are a read-only implementation reviewer."), true);
});

test("an invalid model or effort throws adapter_error from the argv builder", () => {
  assert.throws(() => composeClaudeReviewArgv({ model: "bad model", effort: "medium" }));
  assert.throws(() => composeClaudeReviewArgv({ model: "claude-sonnet-5", effort: "ultra" as never }));
});

test("childEnvironment forwards the allowlist including CLAUDE_CONFIG_DIR and USER, drops the rest", () => {
  const env = childEnvironment({
    PATH: "/usr/bin",
    HOME: "/home/x",
    TMPDIR: "/tmp",
    LANG: "en_US.UTF-8",
    LC_ALL: "C",
    TERM: "xterm",
    CLAUDE_CONFIG_DIR: "/home/x/.agent-profiles/personal/claude",
    USER: "x",
    AGENT_PROFILES_REAL_HOME: "/Users/real",
    ANTHROPIC_API_KEY: "must-not-forward",
    SESSION_TOKEN: "must-not-forward",
    CLAUDE_CODE_MESSAGING_TOKEN: "must-not-forward",
  });
  assert.deepEqual(Object.keys(env).sort(), [...CLAUDE_ENV_ALLOWLIST].sort());
  assert.equal(env.CLAUDE_CONFIG_DIR, "/home/x/.agent-profiles/personal/claude");
  assert.equal(env.USER, "x");
  assert.equal(env.AGENT_PROFILES_REAL_HOME, "/Users/real");
  assert.equal("ANTHROPIC_API_KEY" in env, false);
  assert.equal("SESSION_TOKEN" in env, false);
  assert.equal("CLAUDE_CODE_MESSAGING_TOKEN" in env, false);
});

test("childEnvironment omits CLAUDE_CONFIG_DIR, USER and AGENT_PROFILES_REAL_HOME when the parent does not set them", () => {
  const env = childEnvironment({ PATH: "/usr/bin", HOME: "/home/x" });
  assert.equal("CLAUDE_CONFIG_DIR" in env, false);
  assert.equal("USER" in env, false);
  assert.equal("AGENT_PROFILES_REAL_HOME" in env, false);
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "PATH"]);
});

test("the probe is a help probe and no forbidden token is in the review head", () => {
  assert.deepEqual([...CLAUDE_PROBE_ARGV], ["--help"]);
  assert.equal(CLAUDE_EXECUTABLE, "claude");
  for (const token of CLAUDE_FORBIDDEN_ARGV_TOKENS) {
    assert.equal(CLAUDE_REVIEW_ARGV_HEAD.includes(token), false);
  }
  // the read-only launch never bypasses permissions
  assert.equal(CLAUDE_REVIEW_ARGV_HEAD.includes("--dangerously-skip-permissions" as never), false);
  assert.ok(CLAUDE_HELP_TOKENS.includes("--json-schema"));
  assert.ok(CLAUDE_HELP_TOKENS.includes("--permission-mode"));
});

test("preflight fails closed when the help surface omits a required token", async () => {
  const adapter = new ClaudeAdapter({
    runner: {
      start() {
        return {
          async wait() {
            return {
              stdout: Buffer.from("--print --output-format --model\n"),
              stderr: Buffer.alloc(0),
              exitCode: 0,
              timedOut: false,
              stdoutOverflow: false,
            };
          },
          async cancel() {},
        };
      },
    },
    env: { PATH: "/usr/bin", HOME: "/tmp" },
  });
  await assert.rejects(adapter.preflight());
});
