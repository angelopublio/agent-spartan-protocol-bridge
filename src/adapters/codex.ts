import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS,
  CODEX_LAUNCHER_ID,
  PERMISSION_MODE,
  SCHEMA_VERSION,
  WORKSPACE_WRITE_PERMISSION_MODE,
  isEffortLevel,
  isModelIdentifier,
  type AdapterCapabilities,
  type AdapterFailureCause,
  type AdapterFailurePhase,
  type AdapterFailureRecord,
  type AdapterProducerInput,
  type AdapterReviewInput,
  type EffortLevel,
  type ProducerCapabilities,
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
import { producerChildEnvironment } from "./adapter.ts";
import {
  applyProducerIsolation,
  ProducerWriteScopeError,
  type ProducerIsolationGuard,
} from "./producer-write-scope.ts";
import {
  AdapterFailureError,
  AdapterIsolationError,
  AdapterTimeoutError,
  ReviewerWriteDetectedError,
  type Adapter,
  type ProducerAdapter,
} from "./adapter.ts";
import {
  SANDBOX_EXEC_EXECUTABLE,
  createNodeProcessRunner,
  type ProcessHandle,
  type ProcessRunner,
} from "./process.ts";
import { reviewOutputSchema } from "./review-schema.ts";
import { classifyProviderFailure } from "./provider-failure.ts";
import { ReviewStreamParser, type ReviewStreamProgress } from "./review-stream.ts";

export { CODEX_LAUNCHER_ID };

export const CODEX_EXECUTABLE = "codex";
export const CODEX_PROBE_ARGV = ["exec", "--help"] as const;
export const CODEX_REVIEW_ARGV_HEAD = [
  "exec",
  "--skip-git-repo-check",
  "--ephemeral",
  "--sandbox",
  "read-only",
  "--cd",
] as const;
export const CODEX_REVIEW_ARGV_AFTER_WORKSPACE = ["--json", "--color", "never"] as const;
export const CODEX_PRODUCER_ARGV_HEAD = [
  "exec",
  "--skip-git-repo-check",
  "--ephemeral",
  "--sandbox",
  "danger-full-access",
  "--cd",
] as const;
export const CODEX_PRODUCER_ARGV_AFTER_WORKSPACE = ["--json", "--color", "never"] as const;
export const CODEX_CONSTANT_ARGV_TABLES: readonly (readonly string[])[] = [
  CODEX_PROBE_ARGV,
  CODEX_REVIEW_ARGV_HEAD,
  CODEX_REVIEW_ARGV_AFTER_WORKSPACE,
  CODEX_PRODUCER_ARGV_HEAD,
  CODEX_PRODUCER_ARGV_AFTER_WORKSPACE,
];
export const CODEX_FORBIDDEN_ARGV_TOKENS = [
  "app-server",
  "login",
  "logout",
  "--full-auto",
  "--dangerously-bypass-approvals-and-sandbox",
] as const;
// CODEX_HOME is the official client's config-dir override (holds the
// isolated-profile OAuth `auth.json`). The Bridge never sets it; when the parent
// process already exports it, pass it through so the child can reuse an
// already-authenticated official-client home without the Bridge reading or
// copying any credential. Mirrors GROK_HOME in the Grok adapter and
// CLAUDE_CONFIG_DIR in the Claude adapter. Without this, a Bridge-spawned
// `codex exec` ignores the caller's relocated home and falls back to
// `$HOME/.codex/auth.json`, which may be an unrelated or revoked login.
// AGENT_PROFILES_REAL_HOME: forwarded (never originated) so a machine-local
// isolated-profile wrapper's nested-invocation guard can restore the real HOME
// for `codex` when a `cursor-agent` session relocated it. Same rationale as the
// Claude adapter; `codex` reads auth from `$CODEX_HOME` when set, so this is
// belt-and-suspenders for symmetry with the wrapper's claude/codex guards.
export const CODEX_ENV_ALLOWLIST = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM", "CODEX_HOME", "AGENT_PROFILES_REAL_HOME"] as const;
export const CODEX_PROBE_TIMEOUT_MS = 15_000;
export const CODEX_PROBE_STDOUT_CAP = 1024 * 1024;
export const CODEX_REVIEW_TIMEOUT_MS = 900_000;
export const CODEX_PRODUCER_TIMEOUT_MS = BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS;
export const CODEX_REVIEW_STDOUT_CAP = 4 * 1024 * 1024;
export const CODEX_WORKSPACE_DIR_MODE = 0o555;
export const CODEX_WORKSPACE_FILE_MODE = 0o444;
export const CODEX_HELP_TOKENS = [
  "--sandbox",
  "--cd",
  "--config",
  "--skip-git-repo-check",
  "--ephemeral",
  "--output-schema",
  "--output-last-message",
  "--json",
  "--color",
] as const;
export const CODEX_SCHEMA_FILE = "schema.json";
export const CODEX_LAST_MESSAGE_FILE = "last-message.json";
export const CODEX_SANDBOX_EXEC_PROBE_PROFILE = "(version 1)\n(allow default)\n";
export const CODEX_SANDBOX_EXEC_PROBE_ARGV = [
  "-p",
  CODEX_SANDBOX_EXEC_PROBE_PROFILE,
  "/usr/bin/true",
] as const;

export function codexOutputSchema(reviewKind: ReviewKind): string {
  return reviewOutputSchema(reviewKind);
}

export const CODEX_OUTPUT_SCHEMA = codexOutputSchema("plan");

export const CODEX_REVIEW_PROMPT = `You are a read-only plan reviewer.

Review only the workspace files task.md and AGENTS.md. No other file is available for this review. Do not edit files. Do not inspect any other path.

Return a single JSON object. Use exactly these keys and no others: schema_version, review_kind, verdict, summary, findings. verdict must be exactly one of pass, changes_requested, human_required, blocked. finding id must match [A-Z][A-Z0-9_-]{0,31}. pass requires findings: []. changes_requested requires at least one finding whose severity is warning or error.

Length budget. Keep summary under 1200 characters and each finding message under 1200 characters. summary is a short orientation, not the review — put the substance in findings, which is what the task artifact records. An object that exceeds the schema's limits is rejected and the entire review is discarded, however good it was.

Severity rule. Reserve error or warning severity for a decision that is wrong, self-contradictory, or unimplementable as written, or for an ambiguity an implementer would plausibly resolve the wrong way. A wording, ordering, or evidence-precision improvement that does not change what gets built is severity info and never on its own justifies changes_requested. When the plan is implementable as written, return pass even if it could be tightened.
`;

export const CODEX_IMPLEMENTATION_REVIEW_PROMPT = `You are a read-only implementation reviewer.

Review the workspace files AGENTS.md, task.md, diff.patch, changes.txt, and anything under worktree/. No other path is available for this review. Do not edit files. Do not inspect any other path.

Return a single JSON object. Use exactly these keys and no others: schema_version, review_kind, verdict, summary, findings. verdict must be exactly one of pass, changes_requested, human_required, blocked. finding id must match [A-Z][A-Z0-9_-]{0,31}. pass requires findings: []. changes_requested requires at least one finding whose severity is warning or error.

Length budget. Keep summary under 1200 characters and each finding message under 1200 characters. summary is a short orientation, not the review — put the substance in findings, which is what the task artifact records. An object that exceeds the schema's limits is rejected and the entire review is discarded, however good it was.
`;

export type CodexAdapterOptions = {
  runner?: ProcessRunner;
  env?: NodeJS.ProcessEnv;
  prepareWorkspace?: (input: PrepareWorkspaceInput) => Promise<PreparedWorkspace>;
};

export function codexCapabilities(): AdapterCapabilities {
  return {
    schema_version: SCHEMA_VERSION,
    launcher_id: CODEX_LAUNCHER_ID,
    review_kinds: ["plan", "implementation"],
    permission_modes: [PERMISSION_MODE],
    workspace_write: false,
    fresh_context: true,
    observes_model: false,
    structured_output: true,
    isolated_workspace: true,
  };
}

export function codexProducerCapabilities(): ProducerCapabilities {
  return {
    schema_version: SCHEMA_VERSION,
    launcher_id: CODEX_LAUNCHER_ID,
    roles: ["implementer"],
    permission_modes: [WORKSPACE_WRITE_PERMISSION_MODE],
    workspace_write: true,
    fresh_context: true,
    isolated_producer_workspace: true,
  };
}

export function composeCodexEffortConfig(effort: EffortLevel): string {
  if (!isEffortLevel(effort)) {
    throw new Error("adapter_error");
  }
  const mapped = effort === "max" ? "xhigh" : effort;
  return `model_reasoning_effort="${mapped}"`;
}

export function composeCodexModelConfig(model: string): string {
  if (!isModelIdentifier(model)) {
    throw new Error("adapter_error");
  }
  return `model="${model}"`;
}

export function composeCodexReviewArgv(input: {
  workspace: string;
  model: string;
  effort: EffortLevel;
  schemaPath: string;
  lastMessagePath: string;
  reviewKind?: ReviewKind;
}): string[] {
  const prompt = input.reviewKind === "implementation" ? CODEX_IMPLEMENTATION_REVIEW_PROMPT : CODEX_REVIEW_PROMPT;
  return [
    ...CODEX_REVIEW_ARGV_HEAD,
    input.workspace,
    "--config",
    composeCodexEffortConfig(input.effort),
    "--config",
    composeCodexModelConfig(input.model),
    ...CODEX_REVIEW_ARGV_AFTER_WORKSPACE,
    "--output-schema",
    input.schemaPath,
    "--output-last-message",
    input.lastMessagePath,
    prompt,
  ];
}

export function composeCodexProducerPrompt(
  taskPath: string,
  approvedPlanRunId: string,
  writeScope: readonly string[],
): string {
  const scopeList = writeScope.map((entry) => `\`${entry}\``).join(", ");
  return `You are the mapped implementer for an authorized Spartan Bridge foreground transition.

Open the explicit task \`${taskPath}\`. The approved plan-review run id is \`${approvedPlanRunId}\`. Act as implementer. Implement the approved decisions and satisfy their acceptance criteria against the current worktree. The enclosing Bridge sandbox admits only this closed automatic write scope within this repository: ${scopeList}. Do not modify \`AGENTS.md\`, \`spartan-bridge/config.yaml\`, \`.git/\`, \`node_modules/\`, \`.spartan-bridge/\`, or any other path outside that scope. A write to a repository path outside that scope fails with \`Operation not permitted\`; treat that as the boundary working as intended, do not attempt to work around it, and do not \`chmod\` a path to make it writable. Run all relevant repository checks. Update the same task artifact with concise work completed and reproducible evidence, then set task_type implementation, phase reviewing, current_role implementer, next_role reviewer and regenerate one coherent implementation-review handoff.

Do not commit, push, merge, open a pull request, release, deploy, publish, perform destructive Git or filesystem operations, change credentials or accounts, or expand scope. Do not invoke Spartan Bridge.

Producer stdout is not structured authority. Exit 0 when the declaration above is written.
`;
}

export function composeCodexProducerArgv(input: {
  repoRoot: string;
  model: string;
  effort: EffortLevel;
  taskPath: string;
  approvedPlanRunId: string;
  writeScope: readonly string[];
}): string[] {
  return [
    ...CODEX_PRODUCER_ARGV_HEAD,
    input.repoRoot,
    "--config",
    composeCodexEffortConfig(input.effort),
    "--config",
    composeCodexModelConfig(input.model),
    ...CODEX_PRODUCER_ARGV_AFTER_WORKSPACE,
    composeCodexProducerPrompt(input.taskPath, input.approvedPlanRunId, input.writeScope),
  ];
}

export function longFormArgvTokens(args: readonly string[]): string[] {
  return [...new Set(args.filter((token) => token.startsWith("--")))];
}

export function childEnvironment(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of CODEX_ENV_ALLOWLIST) {
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

export class CodexAdapter implements Adapter, ProducerAdapter {
  private readonly runner: ProcessRunner;
  private readonly env: NodeJS.ProcessEnv;
  private readonly prepareWorkspace: (input: PrepareWorkspaceInput) => Promise<PreparedWorkspace>;
  private workspaceRoot: string | undefined;
  private schemaPath: string | undefined;
  private lastMessagePath: string | undefined;
  private baseline: TreeSnapshot | undefined;
  private snapshotPolicy: "repository" | "workspace" = "repository";
  private handle: ProcessHandle | undefined;
  private producerHandle: ProcessHandle | undefined;
  private producerWriteGuard: ProducerIsolationGuard | undefined;
  private streamSink: ((info: ReviewStreamProgress) => void) | undefined;
  private streamParser: ReviewStreamParser | undefined;

  constructor(options: CodexAdapterOptions = {}) {
    this.runner = options.runner ?? createNodeProcessRunner();
    this.env = options.env ?? process.env;
    this.prepareWorkspace = options.prepareWorkspace ?? prepareReviewWorkspace;
  }

  capabilities(): AdapterCapabilities {
    return codexCapabilities();
  }

  async preflight(): Promise<void> {
    let handle;
    try {
      handle = this.runner.start({
        executable: CODEX_EXECUTABLE,
        args: CODEX_PROBE_ARGV,
        cwd: os.tmpdir(),
        env: childEnvironment(this.env),
        timeoutMs: CODEX_PROBE_TIMEOUT_MS,
        stdoutCapBytes: CODEX_PROBE_STDOUT_CAP,
      });
    } catch {
      throw fail("preflight", "spawn_failed", null, Buffer.alloc(0), "codex_preflight_failed");
    }
    let outcome;
    try {
      outcome = await handle.wait();
    } catch {
      throw fail("preflight", "spawn_failed", null, Buffer.alloc(0), "codex_preflight_failed");
    }
    const stdout = outcome.stdout.toString("utf8");
    if (outcome.timedOut) {
      throw fail("preflight", "timed_out", null, outcome.stderr, "codex_preflight_failed");
    }
    if (outcome.stdoutOverflow) {
      throw fail("preflight", "output_overflow", outcome.exitCode, outcome.stderr, "codex_preflight_failed");
    }
    if (outcome.exitCode !== 0) {
      throw fail("preflight", "exit_nonzero", outcome.exitCode, outcome.stderr, "codex_preflight_failed", null, outcome.stdout);
    }
    for (const token of CODEX_HELP_TOKENS) {
      if (!stdout.includes(token)) {
        throw fail("preflight", "interface_unrecognized", outcome.exitCode, outcome.stderr, "codex_preflight_failed");
      }
    }
  }

  async prepare(input: AdapterReviewInput): Promise<void> {
    try {
      if (!path.isAbsolute(input.run_dir)) {
        throw new AdapterIsolationError();
      }
      const runDir = path.resolve(input.run_dir);
      this.schemaPath = path.join(runDir, CODEX_SCHEMA_FILE);
      this.lastMessagePath = path.join(runDir, CODEX_LAST_MESSAGE_FILE);
      if (path.dirname(this.schemaPath) !== runDir || path.dirname(this.lastMessagePath) !== runDir) {
        throw new AdapterIsolationError();
      }
      await fs.writeFile(this.schemaPath, codexOutputSchema(input.review_kind), { mode: 0o600 });
      const agentsAbs = path.join(input.repo_root, "AGENTS.md");
      const taskAbs = path.join(input.repo_root, input.task_path);
      const agentsBytes = await fs.readFile(agentsAbs);
      const taskBytes = await fs.readFile(taskAbs);
      if (input.review_kind === "implementation") {
        const prepared = await this.prepareWorkspace({
          repoRoot: input.repo_root,
          runDir,
          scope: input.implementation_review_scope,
        });
        await fs.chmod(prepared.workspaceRoot, 0o700);
        await fs.writeFile(path.join(prepared.workspaceRoot, "AGENTS.md"), agentsBytes, {
          mode: CODEX_WORKSPACE_FILE_MODE,
        });
        await fs.writeFile(path.join(prepared.workspaceRoot, "task.md"), taskBytes, {
          mode: CODEX_WORKSPACE_FILE_MODE,
        });
        await fs.chmod(path.join(prepared.workspaceRoot, "AGENTS.md"), CODEX_WORKSPACE_FILE_MODE);
        await fs.chmod(path.join(prepared.workspaceRoot, "task.md"), CODEX_WORKSPACE_FILE_MODE);
        await fs.chmod(prepared.workspaceRoot, CODEX_WORKSPACE_DIR_MODE);
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
      await fs.writeFile(path.join(workspace, "AGENTS.md"), agentsBytes, { mode: CODEX_WORKSPACE_FILE_MODE });
      await fs.writeFile(path.join(workspace, "task.md"), taskBytes, { mode: CODEX_WORKSPACE_FILE_MODE });
      await fs.chmod(path.join(workspace, "AGENTS.md"), CODEX_WORKSPACE_FILE_MODE);
      await fs.chmod(path.join(workspace, "task.md"), CODEX_WORKSPACE_FILE_MODE);
      await fs.chmod(workspace, CODEX_WORKSPACE_DIR_MODE);
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
    if (!this.workspaceRoot || !this.schemaPath || !this.lastMessagePath) {
      throw fail("start", "not_spawned", null, Buffer.alloc(0), "adapter_not_prepared");
    }
    let args: string[];
    try {
      args = composeCodexReviewArgv({
        workspace: this.workspaceRoot,
        model: input.model,
        effort: input.effort,
        schemaPath: this.schemaPath,
        lastMessagePath: this.lastMessagePath,
        reviewKind: input.review_kind,
      });
    } catch {
      throw fail("start", "not_spawned", null);
    }
    this.streamParser = new ReviewStreamParser(CODEX_REVIEW_STDOUT_CAP, this.streamSink);
    try {
      this.handle = this.runner.start({
        executable: CODEX_EXECUTABLE,
        args,
        // The ephemeral workspace root (also passed as `--cd`), never the repo.
        // It holds a byte-identical AGENTS.md copy, so a machine-local wrapper on
        // `codex` resolves the client context from `$PWD` — matching the Grok and
        // Claude adapters. A bare os.tmpdir() here made such a wrapper resolve the
        // wrong isolated profile and load an unrelated auth.json.
        cwd: this.workspaceRoot,
        env: childEnvironment(this.env),
        timeoutMs: CODEX_REVIEW_TIMEOUT_MS,
        stdoutCapBytes: CODEX_REVIEW_STDOUT_CAP,
        onStdoutChunk: (chunk) => {
          this.streamParser?.feed(chunk);
        },
        // Retain the (capped) raw stdout so a non-zero exit reaches
        // `output_excerpt` instead of an empty failure record (0064 D1).
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
    if (!this.handle || !this.lastMessagePath) {
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
    if (outcome.exitCode !== 0) {
      const classified = classifyProviderFailure(outcome.stdout);
      const extras = { signal: observation.signal, httpStatus: classified.http_status };
      if (classified.cause !== null) {
        throw fail("collect", classified.cause, outcome.exitCode, outcome.stderr, "adapter_error", null, outcome.stdout, extras);
      }
      let extracted: unknown | undefined;
      try {
        extracted = JSON.parse(await fs.readFile(this.lastMessagePath, "utf8")) as unknown;
      } catch {
        extracted = undefined;
      }
      if (extracted === undefined && outcome.stdout.length > 0) {
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
    let text: string;
    try {
      text = await fs.readFile(this.lastMessagePath, "utf8");
    } catch {
      throw fail("collect", "output_unparsable", outcome.exitCode, outcome.stderr);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw fail("collect", "output_unparsable", outcome.exitCode, outcome.stderr, "adapter_error", text);
    }
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
    this.schemaPath = undefined;
    this.lastMessagePath = undefined;
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

  producerCapabilities(): ProducerCapabilities {
    return codexProducerCapabilities();
  }

  async producerPreflight(): Promise<void> {
    await this.preflight();
    await this.verifySandboxExecInterface();
  }

  private async verifySandboxExecInterface(): Promise<void> {
    if (process.platform !== "darwin") {
      throw fail("preflight", "interface_unrecognized", null, Buffer.alloc(0), "codex_preflight_failed");
    }
    let handle;
    try {
      handle = this.runner.start({
        executable: SANDBOX_EXEC_EXECUTABLE,
        args: CODEX_SANDBOX_EXEC_PROBE_ARGV,
        cwd: os.tmpdir(),
        env: childEnvironment(this.env),
        timeoutMs: CODEX_PROBE_TIMEOUT_MS,
        stdoutCapBytes: CODEX_PROBE_STDOUT_CAP,
      });
    } catch {
      throw fail("preflight", "spawn_failed", null, Buffer.alloc(0), "codex_preflight_failed");
    }
    let outcome;
    try {
      outcome = await handle.wait();
    } catch {
      throw fail("preflight", "spawn_failed", null, Buffer.alloc(0), "codex_preflight_failed");
    }
    if (outcome.timedOut) {
      throw fail("preflight", "timed_out", null, outcome.stderr, "codex_preflight_failed");
    }
    if (outcome.exitCode !== 0) {
      throw fail(
        "preflight",
        "exit_nonzero",
        outcome.exitCode,
        outcome.stderr,
        "codex_preflight_failed",
        null,
        outcome.stdout,
      );
    }
  }

  async lockProducerIsolation(repoRoot: string, workspaceRoot: string): Promise<void> {
    if (this.producerWriteGuard !== undefined) {
      return;
    }
    this.producerWriteGuard = await applyProducerIsolation(repoRoot, workspaceRoot, childEnvironment(this.env));
  }

  async startProducer(input: AdapterProducerInput): Promise<void> {
    let args: string[];
    try {
      args = composeCodexProducerArgv({
        repoRoot: input.workspace_root,
        model: input.model,
        effort: input.effort,
        taskPath: input.task_path,
        approvedPlanRunId: input.approved_plan_run_id,
        writeScope: input.write_scope,
      });
    } catch {
      throw fail("start", "not_spawned", null);
    }
    if (this.producerWriteGuard === undefined) {
      try {
        await this.lockProducerIsolation(input.repo_root, input.workspace_root);
      } catch (error) {
        if (error instanceof ProducerWriteScopeError) {
          throw error;
        }
        throw fail("start", "spawn_failed", null);
      }
    }
    const guard = this.producerWriteGuard;
    if (guard === undefined) {
      throw fail("start", "spawn_failed", null);
    }
    try {
      this.producerHandle = this.runner.start({
        executable: CODEX_EXECUTABLE,
        args,
        cwd: input.workspace_root,
        env: producerChildEnvironment(childEnvironment(this.env)),
        timeoutMs: input.producer_timeout_ms ?? CODEX_PRODUCER_TIMEOUT_MS,
        stdoutCapBytes: CODEX_REVIEW_STDOUT_CAP,
        retainStdout: true,
        sandboxProfile: guard.sandboxProfile,
        detached: true,
      });
    } catch {
      this.producerWriteGuard = undefined;
      throw fail("start", "spawn_failed", null);
    }
  }

  async waitProducer(): Promise<{ exitCode: number | null; timedOut: boolean }> {
    if (!this.producerHandle) {
      throw fail("collect", "not_spawned", null, Buffer.alloc(0), "adapter_not_started");
    }
    let outcome;
    try {
      outcome = await this.producerHandle.wait();
    } catch {
      throw fail("collect", "spawn_failed", null);
    }
    return { exitCode: outcome.exitCode, timedOut: outcome.timedOut };
  }

  async releaseProducerIsolation(): Promise<void> {
    this.producerWriteGuard = undefined;
  }

  async cancelProducer(): Promise<void> {
    if (this.producerHandle) {
      await this.producerHandle.cancel();
    }
  }

  async cleanupProducer(): Promise<void> {
    this.producerHandle?.terminateGroup?.();
    this.producerWriteGuard = undefined;
    this.producerHandle = undefined;
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
