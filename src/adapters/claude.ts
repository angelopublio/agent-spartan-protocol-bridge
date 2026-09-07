import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CLAUDE_LAUNCHER_ID,
  PERMISSION_MODE,
  SCHEMA_VERSION,
  isEffortLevel,
  isModelIdentifier,
  type AdapterCapabilities,
  type AdapterFailureCause,
  type AdapterFailurePhase,
  type AdapterFailureRecord,
  type AdapterReviewInput,
  type EffortLevel,
  type ReviewKind,
} from "../core/contracts.ts";
import { snapshotTree, workspaceDiff, type TreeSnapshot } from "../core/snapshot.ts";
import {
  prepareReviewWorkspace,
  recordImplementationReviewEnvelope,
  ReviewerIsolationUnavailableError,
  type PrepareWorkspaceInput,
  type PreparedWorkspace,
} from "../core/workspace.ts";
import { isSensitiveRegistryKey } from "../policy/sensitive-fields.ts";
import {
  AdapterFailureError,
  AdapterIsolationError,
  AdapterTimeoutError,
  ReviewerWriteDetectedError,
  type Adapter,
} from "./adapter.ts";
import { reviewOutputSchema } from "./review-schema.ts";
import { extractReviewPayload } from "./cursor.ts";
import { createNodeProcessRunner, type ProcessHandle, type ProcessRunner } from "./process.ts";
import { classifyProviderFailure } from "./provider-failure.ts";
import { ReviewStreamParser, type ReviewStreamProgress } from "./review-stream.ts";

export { CLAUDE_LAUNCHER_ID };

export const CLAUDE_EXECUTABLE = "claude";
export const CLAUDE_PROBE_ARGV = ["--help"] as const;
// Read-only reviewer launch: `-p` headless, plan permission mode (no write/edit/exec),
// an explicit read-only tool allowlist, and `--json-schema` so the final message is
// CLI-constrained to the verdict object rather than trusted to the model.
// `stream-json` (verified to compose with `--json-schema`) gives the same live
// progress the Codex and Cursor adapters have; the verdict is read from the
// stream's terminal `result` record.
export const CLAUDE_REVIEW_ARGV_HEAD = [
  "-p",
  "--output-format",
  "stream-json",
  "--verbose",
  "--permission-mode",
  "plan",
  "--allowed-tools",
  "Read,Grep,Glob",
  "--disallowed-tools",
  "Write,Edit,NotebookEdit,Bash,WebFetch,WebSearch",
] as const;
export const CLAUDE_CONSTANT_ARGV_TABLES: readonly (readonly string[])[] = [
  CLAUDE_PROBE_ARGV,
  CLAUDE_REVIEW_ARGV_HEAD,
];
export const CLAUDE_FORBIDDEN_ARGV_TOKENS = [
  "login",
  "logout",
  "mcp",
  "--resume",
  "--continue",
  "-c",
  "--dangerously-skip-permissions",
  "--allow-dangerously-skip-permissions",
  "--plugin-dir",
  "--mcp-config",
] as const;
// CLAUDE_CONFIG_DIR is the official client's config-dir override (holds the
// isolated-profile OAuth credentials). The Bridge never sets it; when the
// parent process already exports it, pass it through so the child can reuse an
// already-authenticated official-client home without the Bridge reading or
// copying any credential. Mirrors GROK_HOME in the Grok adapter.
export const CLAUDE_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TERM",
  // CLAUDE_CONFIG_DIR: the isolated-profile config-dir override (parent-set only).
  "CLAUDE_CONFIG_DIR",
  // USER: the Claude Code CLI reads it to resolve the keychain credential
  // account on macOS; without it a Bridge-spawned child reports "Not logged in"
  // even with a valid signed-in profile. Not a secret, never Bridge-originated.
  "USER",
  // AGENT_PROFILES_REAL_HOME: a machine-local isolated-profile wrapper exports
  // this before relocating HOME for a `cursor-agent` session. `claude` still
  // reads login state (~/.claude.json, Keychain) from HOME, not
  // CLAUDE_CONFIG_DIR, so a Bridge review dispatched from that session exits
  // "Not logged in" unless the wrapper can restore the real HOME. Forward it so
  // the wrapper's nested-invocation guard sees it. Never Bridge-originated.
  "AGENT_PROFILES_REAL_HOME",
] as const;
export const CLAUDE_PROBE_TIMEOUT_MS = 15_000;
export const CLAUDE_PROBE_STDOUT_CAP = 1024 * 1024;
export const CLAUDE_REVIEW_TIMEOUT_MS = 900_000;
export const CLAUDE_REVIEW_STDOUT_CAP = 4 * 1024 * 1024;
export const CLAUDE_WORKSPACE_DIR_MODE = 0o555;
export const CLAUDE_WORKSPACE_FILE_MODE = 0o444;
export const CLAUDE_HELP_TOKENS = [
  "--print",
  "--output-format",
  "stream-json",
  "--verbose",
  "--json-schema",
  "--permission-mode",
  "--allowed-tools",
  "--disallowed-tools",
  "--model",
  "--effort",
] as const;
export const CLAUDE_REVIEW_PROMPT = `You are a read-only plan reviewer.

Review only the workspace files task.md and AGENTS.md. No other file is available for this review. Do not edit files. Do not inspect any other path.

Return a single JSON object as your final message. Use exactly these keys and no others: schema_version, review_kind, verdict, summary, findings. verdict must be exactly one of pass, changes_requested, human_required, blocked. finding id must match [A-Z][A-Z0-9_-]{0,31}. pass requires findings: []. changes_requested requires at least one finding whose severity is warning or error.

Length budget. Keep summary under 1200 characters and each finding message under 1200 characters. summary is a short orientation, not the review — put the substance in findings, which is what the task artifact records. An object that exceeds the schema's limits is rejected and the entire review is discarded, however good it was.

Severity rule. Reserve error or warning severity for a decision that is wrong, self-contradictory, or unimplementable as written, or for an ambiguity an implementer would plausibly resolve the wrong way. A wording, ordering, or evidence-precision improvement that does not change what gets built is severity info and never on its own justifies changes_requested. When the plan is implementable as written, return pass even if it could be tightened.
`;

export const CLAUDE_IMPLEMENTATION_REVIEW_PROMPT = `You are a read-only implementation reviewer.

Review the workspace files AGENTS.md, task.md, diff.patch, changes.txt, and anything under worktree/. No other path is available for this review. Do not edit files. Do not inspect any other path.

Return a single JSON object as your final message. Use exactly these keys and no others: schema_version, review_kind, verdict, summary, findings. verdict must be exactly one of pass, changes_requested, human_required, blocked. finding id must match [A-Z][A-Z0-9_-]{0,31}. pass requires findings: []. changes_requested requires at least one finding whose severity is warning or error.

Length budget. Keep summary under 1200 characters and each finding message under 1200 characters. summary is a short orientation, not the review — put the substance in findings, which is what the task artifact records. An object that exceeds the schema's limits is rejected and the entire review is discarded, however good it was.
`;

export function composeClaudeReviewPrompt(reviewKind: ReviewKind): string {
  return reviewKind === "implementation" ? CLAUDE_IMPLEMENTATION_REVIEW_PROMPT : CLAUDE_REVIEW_PROMPT;
}

export type ClaudeAdapterOptions = {
  runner?: ProcessRunner;
  env?: NodeJS.ProcessEnv;
  prepareWorkspace?: (input: PrepareWorkspaceInput) => Promise<PreparedWorkspace>;
};

export function claudeCapabilities(): AdapterCapabilities {
  return {
    schema_version: SCHEMA_VERSION,
    launcher_id: CLAUDE_LAUNCHER_ID,
    review_kinds: ["plan", "implementation"],
    permission_modes: [PERMISSION_MODE],
    workspace_write: false,
    fresh_context: true,
    observes_model: false,
    structured_output: true,
    isolated_workspace: true,
  };
}

export function composeClaudeReviewArgv(input: {
  model: string;
  effort: EffortLevel;
  reviewKind?: ReviewKind;
}): string[] {
  if (!isModelIdentifier(input.model) || !isEffortLevel(input.effort)) {
    throw new Error("adapter_error");
  }
  const kind: ReviewKind = input.reviewKind === "implementation" ? "implementation" : "plan";
  const effortArgs = input.effort === "none" ? [] : ["--effort", input.effort];
  // `claude -p --json-schema` takes the schema inline as a JSON string, not a
  // file path (unlike Codex `--output-schema <file>`).
  return [
    ...CLAUDE_REVIEW_ARGV_HEAD,
    "--json-schema",
    reviewOutputSchema(kind).trimEnd(),
    "--model",
    input.model,
    ...effortArgs,
    composeClaudeReviewPrompt(kind),
  ];
}

export function childEnvironment(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of CLAUDE_ENV_ALLOWLIST) {
    if (isSensitiveRegistryKey(key)) {
      continue;
    }
    const value = parent[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

export class ClaudeAdapter implements Adapter {
  private readonly runner: ProcessRunner;
  private readonly env: NodeJS.ProcessEnv;
  private readonly prepareWorkspace: (input: PrepareWorkspaceInput) => Promise<PreparedWorkspace>;
  private workspaceRoot: string | undefined;
  private baseline: TreeSnapshot | undefined;
  private snapshotPolicy: "repository" | "workspace" = "repository";
  private handle: ProcessHandle | undefined;
  private streamSink: ((info: ReviewStreamProgress) => void) | undefined;
  private streamParser: ReviewStreamParser | undefined;

  constructor(options: ClaudeAdapterOptions = {}) {
    this.runner = options.runner ?? createNodeProcessRunner();
    this.env = options.env ?? process.env;
    this.prepareWorkspace = options.prepareWorkspace ?? prepareReviewWorkspace;
  }

  capabilities(): AdapterCapabilities {
    return claudeCapabilities();
  }

  async preflight(): Promise<void> {
    let handle;
    try {
      handle = this.runner.start({
        executable: CLAUDE_EXECUTABLE,
        args: CLAUDE_PROBE_ARGV,
        cwd: os.tmpdir(),
        env: childEnvironment(this.env),
        timeoutMs: CLAUDE_PROBE_TIMEOUT_MS,
        stdoutCapBytes: CLAUDE_PROBE_STDOUT_CAP,
      });
    } catch {
      throw fail("preflight", "spawn_failed", null, Buffer.alloc(0), "claude_preflight_failed");
    }
    let outcome;
    try {
      outcome = await handle.wait();
    } catch {
      throw fail("preflight", "spawn_failed", null, Buffer.alloc(0), "claude_preflight_failed");
    }
    const stdout = outcome.stdout.toString("utf8");
    if (outcome.timedOut) {
      throw fail("preflight", "timed_out", null, outcome.stderr, "claude_preflight_failed");
    }
    if (outcome.stdoutOverflow) {
      throw fail("preflight", "output_overflow", outcome.exitCode, outcome.stderr, "claude_preflight_failed");
    }
    if (outcome.exitCode !== 0) {
      throw fail("preflight", "exit_nonzero", outcome.exitCode, outcome.stderr, "claude_preflight_failed", null, outcome.stdout);
    }
    for (const token of CLAUDE_HELP_TOKENS) {
      if (!stdout.includes(token)) {
        throw fail("preflight", "interface_unrecognized", outcome.exitCode, outcome.stderr, "claude_preflight_failed");
      }
    }
  }

  async prepare(input: AdapterReviewInput): Promise<void> {
    try {
      const agentsAbs = path.join(input.repo_root, "AGENTS.md");
      const taskAbs = path.join(input.repo_root, input.task_path);
      const agentsBytes = await fs.readFile(agentsAbs);
      const taskBytes = await fs.readFile(taskAbs);
      if (input.review_kind === "implementation") {
        if (!path.isAbsolute(input.run_dir)) {
          throw new AdapterIsolationError();
        }
        const runDir = path.resolve(input.run_dir);
        const prepared = await this.prepareWorkspace({
          repoRoot: input.repo_root,
          runDir,
          scope: input.implementation_review_scope,
        });
        await fs.chmod(prepared.workspaceRoot, 0o700);
        await fs.writeFile(path.join(prepared.workspaceRoot, "AGENTS.md"), agentsBytes, {
          mode: CLAUDE_WORKSPACE_FILE_MODE,
        });
        await fs.writeFile(path.join(prepared.workspaceRoot, "task.md"), taskBytes, {
          mode: CLAUDE_WORKSPACE_FILE_MODE,
        });
        await fs.chmod(path.join(prepared.workspaceRoot, "AGENTS.md"), CLAUDE_WORKSPACE_FILE_MODE);
        await fs.chmod(path.join(prepared.workspaceRoot, "task.md"), CLAUDE_WORKSPACE_FILE_MODE);
        await fs.chmod(prepared.workspaceRoot, CLAUDE_WORKSPACE_DIR_MODE);
        await recordImplementationReviewEnvelope(runDir, prepared.manifest, [
          { path: "AGENTS.md", bytes: agentsBytes },
          { path: "task.md", bytes: taskBytes },
        ]);
        this.workspaceRoot = prepared.workspaceRoot;
        this.snapshotPolicy = "workspace";
        this.baseline = await snapshotTree(prepared.workspaceRoot, { policy: "workspace" });
        return;
      }
      const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-bridge-review-"));
      await fs.chmod(workspace, 0o700);
      this.workspaceRoot = workspace;
      this.snapshotPolicy = "repository";
      await fs.writeFile(path.join(workspace, "AGENTS.md"), agentsBytes, { mode: CLAUDE_WORKSPACE_FILE_MODE });
      await fs.writeFile(path.join(workspace, "task.md"), taskBytes, { mode: CLAUDE_WORKSPACE_FILE_MODE });
      await fs.chmod(path.join(workspace, "AGENTS.md"), CLAUDE_WORKSPACE_FILE_MODE);
      await fs.chmod(path.join(workspace, "task.md"), CLAUDE_WORKSPACE_FILE_MODE);
      await fs.chmod(workspace, CLAUDE_WORKSPACE_DIR_MODE);
      this.baseline = await snapshotTree(workspace);
    } catch (error) {
      if (error instanceof AdapterIsolationError) {
        throw error;
      }
      if (error instanceof ReviewerIsolationUnavailableError) {
        throw new AdapterIsolationError();
      }
      throw new AdapterIsolationError();
    }
  }

  async start(input: AdapterReviewInput): Promise<void> {
    if (!this.workspaceRoot) {
      throw fail("start", "not_spawned", null, Buffer.alloc(0), "adapter_not_prepared");
    }
    let args: string[];
    try {
      args = composeClaudeReviewArgv({
        model: input.model,
        effort: input.effort,
        reviewKind: input.review_kind,
      });
    } catch {
      throw fail("start", "not_spawned", null);
    }
    this.streamParser = new ReviewStreamParser(CLAUDE_REVIEW_STDOUT_CAP, this.streamSink);
    try {
      this.handle = this.runner.start({
        executable: CLAUDE_EXECUTABLE,
        args,
        cwd: this.workspaceRoot,
        env: childEnvironment(this.env),
        timeoutMs: CLAUDE_REVIEW_TIMEOUT_MS,
        stdoutCapBytes: CLAUDE_REVIEW_STDOUT_CAP,
        onStdoutChunk: (chunk) => {
          this.streamParser?.feed(chunk);
        },
        // Retain the (capped) raw stdout so a non-zero exit — a usage-limit
        // message, an auth error — reaches `output_excerpt` instead of an empty
        // failure record (0064 D1). Grok already does this; Claude and Codex
        // dropped it. On success the buffer is discarded in `cleanup`.
        retainStdout: true,
      });
    } catch {
      throw fail("start", "spawn_failed", null);
    }
  }

  observeStream(sink: (info: ReviewStreamProgress) => void): void {
    this.streamSink = sink;
  }

  async collect(): Promise<unknown> {
    if (!this.handle) {
      throw fail("collect", "not_spawned", null, Buffer.alloc(0), "adapter_not_started");
    }
    let outcome;
    try {
      outcome = await this.handle.wait();
    } catch {
      throw fail("collect", "spawn_failed", null);
    }
    this.streamParser?.end();
    const observation = { signal: outcome.signal ?? null };
    if (outcome.timedOut) {
      throw new AdapterTimeoutError(
        "adapter_timeout",
        failureRecord("collect", "timed_out", null, observation),
        outcome.stderr,
      );
    }
    if (outcome.stdoutOverflow || this.streamParser?.overflow === true) {
      throw fail("collect", "output_overflow", outcome.exitCode, outcome.stderr, "adapter_error", null, Buffer.alloc(0), observation);
    }
    const parser = this.streamParser;
    if (parser && parser.observedBytes === 0 && outcome.stdout.length > 0) {
      parser.feed(outcome.stdout);
      parser.end();
    }
    const candidate =
      parser?.resultText !== undefined
        ? parser.resultText
        : parser !== undefined && parser.residual.length > 0
          ? parser.residual
          : outcome.stdout.toString("utf8");
    if (outcome.exitCode !== 0) {
      const classified = classifyProviderFailure(outcome.stdout);
      const extras = { signal: observation.signal, httpStatus: classified.http_status };
      if (classified.cause !== null) {
        throw fail("collect", classified.cause, outcome.exitCode, outcome.stderr, "adapter_error", null, outcome.stdout, extras);
      }
      if (extractReviewPayload(candidate) === undefined && outcome.stdout.length > 0) {
        throw fail(
          "collect",
          "output_unparsable",
          outcome.exitCode,
          outcome.stderr,
          "adapter_error",
          outcome.stdout.toString("utf8"),
          outcome.stdout,
          extras,
        );
      }
      throw fail("collect", "exit_nonzero", outcome.exitCode, outcome.stderr, "adapter_error", null, outcome.stdout, extras);
    }
    const extracted = extractReviewPayload(candidate);
    if (extracted === undefined) {
      throw fail("collect", "output_unparsable", outcome.exitCode, outcome.stderr, "adapter_error", candidate);
    }
    return extracted;
  }

  async verify(): Promise<void> {
    if (!this.workspaceRoot || !this.baseline) {
      throw fail("verify", "not_spawned", null, Buffer.alloc(0), "adapter_not_prepared");
    }
    const current = await snapshotTree(this.workspaceRoot, { policy: this.snapshotPolicy });
    const entries = workspaceDiff(this.baseline, current);
    if (entries.length > 0) {
      throw new ReviewerWriteDetectedError("reviewer_workspace", entries);
    }
  }

  async cancel(): Promise<void> {
    if (this.handle) {
      await this.handle.cancel();
    }
  }

  async cleanup(): Promise<void> {
    const workspace = this.workspaceRoot;
    this.workspaceRoot = undefined;
    this.baseline = undefined;
    this.handle = undefined;
    this.streamParser = undefined;
    if (workspace) {
      try {
        await fs.chmod(workspace, 0o700);
      } catch {
        // best-effort: a 0555 workspace still needs to be removable
      }
      await fs.rm(workspace, { recursive: true, force: true });
    }
  }

  observedModel(): string | null {
    return null;
  }
}

type FailureExtras = {
  signal?: string | null;
  httpStatus?: number | null;
};

function fail(
  phase: AdapterFailurePhase,
  cause: AdapterFailureCause,
  exitCode: number | null,
  stderr: Buffer = Buffer.alloc(0),
  message = "adapter_error",
  payload: string | null = null,
  stdout: Buffer = Buffer.alloc(0),
  extras: FailureExtras = {},
): AdapterFailureError {
  return new AdapterFailureError(
    failureRecord(phase, cause, exitCode, extras),
    stderr,
    message,
    payload,
    Buffer.concat([stdout, stderr]),
  );
}

function failureRecord(
  phase: AdapterFailurePhase,
  cause: AdapterFailureCause,
  exitCode: number | null,
  extras: FailureExtras = {},
): AdapterFailureRecord {
  const signal = extras.signal;
  const httpStatus = extras.httpStatus;
  return {
    phase,
    cause,
    exit_code: exitCode,
    signal: typeof signal === "string" && signal.length > 0 ? signal : null,
    http_status:
      typeof httpStatus === "number" && Number.isInteger(httpStatus) && Number.isFinite(httpStatus)
        ? httpStatus
        : null,
    stderr_bytes: 0,
    stderr_log: null,
    payload_log: null,
    output_excerpt_bytes: 0,
    output_excerpt: null,
  };
}
