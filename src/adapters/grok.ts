import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS,
  GROK_LAUNCHER_ID,
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
import { snapshotTree, workspaceDiff, type SnapshotPolicy, type TreeSnapshot } from "../core/snapshot.ts";
import {
  prepareReviewWorkspace,
  recordImplementationReviewEnvelope,
  ReviewerIsolationUnavailableError,
  type PrepareWorkspaceInput,
  type PreparedWorkspace,
} from "../core/workspace.ts";
import { producerChildEnvironment } from "./adapter.ts";
import {
  applyProducerIsolation,
  ProducerWriteScopeError,
  type ProducerIsolationGuard,
} from "./producer-write-scope.ts";
import { isSensitiveRegistryKey } from "../policy/sensitive-fields.ts";
import { reviewOutputSchema } from "./review-schema.ts";
import {
  AdapterFailureError,
  AdapterIsolationError,
  AdapterTimeoutError,
  ReviewerWriteDetectedError,
  type Adapter,
  type ProducerAdapter,
} from "./adapter.ts";
import { extractReviewPayload } from "./cursor.ts";
import { classifyProviderFailure } from "./provider-failure.ts";
import {
  SANDBOX_EXEC_EXECUTABLE,
  createNodeProcessRunner,
  type ProcessHandle,
  type ProcessRunner,
} from "./process.ts";

export { GROK_LAUNCHER_ID };

export const GROK_EXECUTABLE = "grok";
export const GROK_PROBE_ARGV = ["--help"] as const;
export const GROK_REVIEW_TOOLS = "read_file,grep,list_dir";
export const GROK_REVIEW_DISALLOWED_TOOLS = "Agent";
// Grok's `-p/--single` takes the prompt as its value (unlike Cursor's boolean `-p`).
export const GROK_REVIEW_ARGV_AFTER_PROMPT = [
  "--cwd",
] as const;
export const GROK_REVIEW_ARGV_SUFFIX = [
  "--sandbox",
  "strict",
  "--tools",
  GROK_REVIEW_TOOLS,
  "--disallowed-tools",
  GROK_REVIEW_DISALLOWED_TOOLS,
  "--output-format",
  "json",
  "--no-subagents",
] as const;
export const GROK_PRODUCER_ARGV_AFTER_PROMPT = [
  "--cwd",
] as const;
// Producer already runs under Bridge Darwin `sandbox-exec` from
// the runtime's producer isolation profile. Grok's own `workspace` / `strict` seatbelt
// profiles fail to initialize inside that outer profile ("Operation not
// permitted") and the child exits 1 before any turn. `--sandbox none`
// keeps the flag present for help/preflight while deferring repository
// write confinement to the Bridge guard (D-042).
export const GROK_PRODUCER_ARGV_SUFFIX = [
  "--sandbox",
  "none",
  "--always-approve",
  "--output-format",
  "json",
  "--no-subagents",
] as const;
export const GROK_CONSTANT_ARGV_TABLES: readonly (readonly string[])[] = [
  GROK_PROBE_ARGV,
  GROK_REVIEW_ARGV_AFTER_PROMPT,
  GROK_REVIEW_ARGV_SUFFIX,
  GROK_PRODUCER_ARGV_AFTER_PROMPT,
  GROK_PRODUCER_ARGV_SUFFIX,
];
export const GROK_MODEL_FLAG = "-m";
export const GROK_EFFORT_FLAG = "--reasoning-effort";
export const GROK_FORBIDDEN_ARGV_TOKENS = [
  "agent",
  "--yolo",
  "--permission-mode",
  "bypassPermissions",
  "login",
  "logout",
  "--resume",
  "--continue",
  "-c",
  "--reauth",
  "--api-key",
] as const;
// GROK_HOME is the official client's config-dir override (may contain auth.json).
// The Bridge never sets it; when the parent process already has it, pass it through
// so the child can use an already-authenticated official-client home without the
// Bridge reading or copying credentials.
export const GROK_ENV_ALLOWLIST = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM", "GROK_HOME"] as const;
export const GROK_SANDBOX_EXEC_PROBE_PROFILE = "(version 1)\n(allow default)\n";
export const GROK_SANDBOX_EXEC_PROBE_ARGV = ["-p", GROK_SANDBOX_EXEC_PROBE_PROFILE, "/usr/bin/true"] as const;
export const GROK_PROBE_TIMEOUT_MS = 15_000;
export const GROK_PROBE_STDOUT_CAP = 1024 * 1024;
export const GROK_REVIEW_TIMEOUT_MS = 900_000;
export const GROK_PRODUCER_TIMEOUT_MS = BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS;
export const GROK_REVIEW_STDOUT_CAP = 4 * 1024 * 1024;
export const GROK_WORKSPACE_DIR_MODE = 0o555;
export const GROK_WORKSPACE_FILE_MODE = 0o444;
export const GROK_HELP_TOKENS = [
  "-p",
  "--single",
  "--cwd",
  "--sandbox",
  "--output-format",
  "--json-schema",
  "-m",
  "--model",
  "--tools",
  "--disallowed-tools",
  "--always-approve",
  "--no-subagents",
] as const;

export const GROK_REVIEW_PROMPT = `You are a read-only plan reviewer.

Review only the workspace files task.md and AGENTS.md. No other file is available for this review. Do not edit files. Do not inspect any other path.

Return a single JSON object as the last output. Use exactly these keys and no others: schema_version, review_kind, verdict, summary, findings. verdict must be exactly one of pass, changes_requested, human_required, blocked. finding id must match [A-Z][A-Z0-9_-]{0,31}. pass requires findings: []. changes_requested requires at least one finding whose severity is warning or error.

Length budget. Keep summary under 1200 characters and each finding message under 1200 characters. summary is a short orientation, not the review — put the substance in findings, which is what the task artifact records. An object that exceeds the schema's limits is rejected and the entire review is discarded, however good it was.

Severity rule. Reserve error or warning severity for a decision that is wrong, self-contradictory, or unimplementable as written, or for an ambiguity an implementer would plausibly resolve the wrong way. A wording, ordering, or evidence-precision improvement that does not change what gets built is severity info and never on its own justifies changes_requested. When the plan is implementable as written, return pass even if it could be tightened.

{"schema_version":2,"review_kind":"plan","verdict":"pass"|"changes_requested"|"human_required"|"blocked","summary":string,"findings":[{"id":string,"severity":"info"|"warning"|"error","message":string}]}
`;

export const GROK_IMPLEMENTATION_REVIEW_PROMPT = `You are a read-only implementation reviewer.

Review the workspace files AGENTS.md, task.md, diff.patch, changes.txt, and anything under worktree/. No other path is available for this review. Do not edit files. Do not inspect any other path.

Return a single JSON object as the last output. Use exactly these keys and no others: schema_version, review_kind, verdict, summary, findings. verdict must be exactly one of pass, changes_requested, human_required, blocked. finding id must match [A-Z][A-Z0-9_-]{0,31}. pass requires findings: []. changes_requested requires at least one finding whose severity is warning or error.

Length budget. Keep summary under 1200 characters and each finding message under 1200 characters. summary is a short orientation, not the review — put the substance in findings, which is what the task artifact records. An object that exceeds the schema's limits is rejected and the entire review is discarded, however good it was.

{"schema_version":2,"review_kind":"implementation","verdict":"pass"|"changes_requested"|"human_required"|"blocked","summary":string,"findings":[{"id":string,"severity":"info"|"warning"|"error","message":string}]}
`;

export function composeGrokReviewPrompt(reviewKind: ReviewKind): string {
  return reviewKind === "implementation" ? GROK_IMPLEMENTATION_REVIEW_PROMPT : GROK_REVIEW_PROMPT;
}

export function composeGrokProducerPrompt(
  taskPath: string,
  approvedPlanRunId: string,
  writeScope: readonly string[],
): string {
  const scopeList = writeScope.map((entry) => `\`${entry}\``).join(", ");
  return `You are the mapped implementer for an authorized Spartan Bridge foreground transition.

Open the explicit task \`${taskPath}\`. The approved plan-review run id is \`${approvedPlanRunId}\`. Act as implementer. Implement the approved decisions and satisfy their acceptance criteria against the current worktree. The adapter-enforced writable sandbox admits only this closed automatic write scope: ${scopeList}. Do not modify \`AGENTS.md\`, \`spartan-bridge/config.yaml\`, \`.git/\`, \`node_modules/\`, \`.spartan-bridge/\`, or any other path outside that scope. Run all relevant repository checks. Update the same task artifact with concise work completed and reproducible evidence, then set task_type implementation, phase reviewing, current_role implementer, next_role reviewer and regenerate one coherent implementation-review handoff.

Do not commit, push, merge, open a pull request, release, deploy, publish, perform destructive Git or filesystem operations, change credentials or accounts, or expand scope. Do not invoke Spartan Bridge.

Producer stdout is not structured authority. Exit 0 when the declaration above is written.
`;
}

export type GrokAdapterOptions = {
  runner?: ProcessRunner;
  env?: NodeJS.ProcessEnv;
  prepareWorkspace?: (input: PrepareWorkspaceInput) => Promise<PreparedWorkspace>;
};

export function grokCapabilities(): AdapterCapabilities {
  return {
    schema_version: SCHEMA_VERSION,
    launcher_id: GROK_LAUNCHER_ID,
    review_kinds: ["plan", "implementation"],
    permission_modes: [PERMISSION_MODE],
    workspace_write: false,
    fresh_context: true,
    observes_model: false,
    structured_output: true,
    isolated_workspace: true,
  };
}

export function grokProducerCapabilities(): ProducerCapabilities {
  return {
    schema_version: SCHEMA_VERSION,
    launcher_id: GROK_LAUNCHER_ID,
    roles: ["implementer"],
    permission_modes: [WORKSPACE_WRITE_PERMISSION_MODE],
    workspace_write: true,
    fresh_context: true,
    isolated_producer_workspace: true,
  };
}

export function composeGrokModelArgs(model: string, effort: EffortLevel): string[] {
  if (!isModelIdentifier(model) || !isEffortLevel(effort)) {
    throw new Error("adapter_error");
  }
  if (effort === "none") {
    return [GROK_MODEL_FLAG, model];
  }
  return [GROK_MODEL_FLAG, model, GROK_EFFORT_FLAG, effort];
}

export function childEnvironment(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of GROK_ENV_ALLOWLIST) {
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

export function unwrapGrokStdout(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (isPlainObject(parsed) && typeof parsed.text === "string") {
      return parsed.text;
    }
  } catch {
    // plain or mixed stdout falls through
  }
  return stdout;
}

export function extractGrokReviewPayload(stdout: string): unknown | undefined {
  return extractReviewPayload(unwrapGrokStdout(stdout));
}

export class GrokAdapter implements Adapter, ProducerAdapter {
  private readonly runner: ProcessRunner;
  private readonly env: NodeJS.ProcessEnv;
  private readonly prepareWorkspace: (input: PrepareWorkspaceInput) => Promise<PreparedWorkspace>;
  private workspaceRoot: string | undefined;
  private baseline: TreeSnapshot | undefined;
  private snapshotPolicy: SnapshotPolicy = "repository";
  private handle: ProcessHandle | undefined;
  private producerHandle: ProcessHandle | undefined;
  private producerWriteGuard: ProducerIsolationGuard | undefined;

  constructor(options: GrokAdapterOptions = {}) {
    this.runner = options.runner ?? createNodeProcessRunner();
    this.env = options.env ?? process.env;
    this.prepareWorkspace = options.prepareWorkspace ?? prepareReviewWorkspace;
  }

  capabilities(): AdapterCapabilities {
    return grokCapabilities();
  }

  async preflight(): Promise<void> {
    let handle;
    try {
      handle = this.runner.start({
        executable: GROK_EXECUTABLE,
        args: GROK_PROBE_ARGV,
        cwd: os.tmpdir(),
        env: childEnvironment(this.env),
        timeoutMs: GROK_PROBE_TIMEOUT_MS,
        stdoutCapBytes: GROK_PROBE_STDOUT_CAP,
      });
    } catch {
      throw fail("preflight", "spawn_failed", null, Buffer.alloc(0), "grok_preflight_failed");
    }
    let outcome;
    try {
      outcome = await handle.wait();
    } catch {
      throw fail("preflight", "spawn_failed", null, Buffer.alloc(0), "grok_preflight_failed");
    }
    const stdout = outcome.stdout.toString("utf8");
    if (outcome.timedOut) {
      throw fail("preflight", "timed_out", null, outcome.stderr, "grok_preflight_failed");
    }
    if (outcome.stdoutOverflow) {
      throw fail("preflight", "output_overflow", outcome.exitCode, outcome.stderr, "grok_preflight_failed");
    }
    if (outcome.exitCode !== 0) {
      throw fail("preflight", "exit_nonzero", outcome.exitCode, outcome.stderr, "grok_preflight_failed", null, outcome.stdout);
    }
    for (const token of GROK_HELP_TOKENS) {
      if (!stdout.includes(token)) {
        throw fail("preflight", "interface_unrecognized", outcome.exitCode, outcome.stderr, "grok_preflight_failed");
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
          mode: GROK_WORKSPACE_FILE_MODE,
        });
        await fs.writeFile(path.join(prepared.workspaceRoot, "task.md"), taskBytes, {
          mode: GROK_WORKSPACE_FILE_MODE,
        });
        await fs.chmod(path.join(prepared.workspaceRoot, "AGENTS.md"), GROK_WORKSPACE_FILE_MODE);
        await fs.chmod(path.join(prepared.workspaceRoot, "task.md"), GROK_WORKSPACE_FILE_MODE);
        await fs.chmod(prepared.workspaceRoot, GROK_WORKSPACE_DIR_MODE);
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
      await fs.writeFile(path.join(workspace, "AGENTS.md"), agentsBytes, { mode: GROK_WORKSPACE_FILE_MODE });
      await fs.writeFile(path.join(workspace, "task.md"), taskBytes, { mode: GROK_WORKSPACE_FILE_MODE });
      await fs.chmod(path.join(workspace, "AGENTS.md"), GROK_WORKSPACE_FILE_MODE);
      await fs.chmod(path.join(workspace, "task.md"), GROK_WORKSPACE_FILE_MODE);
      await fs.chmod(workspace, GROK_WORKSPACE_DIR_MODE);
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
    let modelArgs: string[];
    try {
      modelArgs = composeGrokModelArgs(input.model, input.effort);
    } catch {
      throw fail("start", "not_spawned", null);
    }
    const prompt = composeGrokReviewPrompt(input.review_kind);
    // `grok --json-schema` takes the schema inline as a JSON string, not a file path.
    const schemaArg = reviewOutputSchema(input.review_kind).trimEnd();
    try {
      this.handle = this.runner.start({
        executable: GROK_EXECUTABLE,
        args: [
          "-p",
          prompt,
          ...GROK_REVIEW_ARGV_AFTER_PROMPT,
          this.workspaceRoot,
          ...modelArgs,
          "--json-schema",
          schemaArg,
          ...GROK_REVIEW_ARGV_SUFFIX,
        ],
        cwd: this.workspaceRoot,
        env: childEnvironment(this.env),
        timeoutMs: GROK_REVIEW_TIMEOUT_MS,
        stdoutCapBytes: GROK_REVIEW_STDOUT_CAP,
        retainStdout: true,
      });
    } catch {
      throw fail("start", "spawn_failed", null);
    }
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
    const observation = { signal: outcome.signal ?? null };
    if (outcome.timedOut) {
      throw new AdapterTimeoutError(
        "adapter_timeout",
        failureRecord("collect", "timed_out", null, observation),
        outcome.stderr,
      );
    }
    if (outcome.stdoutOverflow) {
      throw fail("collect", "output_overflow", outcome.exitCode, outcome.stderr, "adapter_error", null, Buffer.alloc(0), observation);
    }
    const stdoutText = outcome.stdout.toString("utf8");
    if (outcome.exitCode !== 0) {
      const classified = classifyProviderFailure(outcome.stdout);
      const extras = { signal: observation.signal, httpStatus: classified.http_status };
      if (classified.cause !== null) {
        throw fail("collect", classified.cause, outcome.exitCode, outcome.stderr, "adapter_error", null, outcome.stdout, extras);
      }
      if (extractGrokReviewPayload(stdoutText) === undefined && outcome.stdout.length > 0) {
        throw fail(
          "collect",
          "output_unparsable",
          outcome.exitCode,
          outcome.stderr,
          "adapter_error",
          stdoutText,
          outcome.stdout,
          extras,
        );
      }
      throw fail("collect", "exit_nonzero", outcome.exitCode, outcome.stderr, "adapter_error", null, outcome.stdout, extras);
    }
    const value = extractGrokReviewPayload(stdoutText);
    if (value === undefined) {
      throw fail("collect", "output_unparsable", outcome.exitCode, outcome.stderr, "adapter_error", stdoutText);
    }
    return value;
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
    this.snapshotPolicy = "repository";
    this.handle = undefined;
    if (!workspace) {
      return;
    }
    try {
      await fs.chmod(workspace, 0o700);
    } catch {
      // best-effort
    }
    await fs.rm(workspace, { recursive: true, force: true });
  }

  observedModel(): string | null {
    return null;
  }

  producerCapabilities(): ProducerCapabilities {
    return grokProducerCapabilities();
  }

  async producerPreflight(): Promise<void> {
    await this.preflight();
    await this.verifySandboxExecInterface();
  }

  private async verifySandboxExecInterface(): Promise<void> {
    if (process.platform !== "darwin") {
      throw fail("preflight", "interface_unrecognized", null, Buffer.alloc(0), "grok_preflight_failed");
    }
    let handle;
    try {
      handle = this.runner.start({
        executable: SANDBOX_EXEC_EXECUTABLE,
        args: GROK_SANDBOX_EXEC_PROBE_ARGV,
        cwd: os.tmpdir(),
        env: childEnvironment(this.env),
        timeoutMs: GROK_PROBE_TIMEOUT_MS,
        stdoutCapBytes: GROK_PROBE_STDOUT_CAP,
      });
    } catch {
      throw fail("preflight", "spawn_failed", null, Buffer.alloc(0), "grok_preflight_failed");
    }
    let outcome;
    try {
      outcome = await handle.wait();
    } catch {
      throw fail("preflight", "spawn_failed", null, Buffer.alloc(0), "grok_preflight_failed");
    }
    if (outcome.timedOut) {
      throw fail("preflight", "timed_out", null, outcome.stderr, "grok_preflight_failed");
    }
    if (outcome.exitCode !== 0) {
      throw fail("preflight", "exit_nonzero", outcome.exitCode, outcome.stderr, "grok_preflight_failed", null, outcome.stdout);
    }
  }

  async lockProducerIsolation(repoRoot: string, workspaceRoot: string): Promise<void> {
    if (this.producerWriteGuard !== undefined) {
      return;
    }
    this.producerWriteGuard = await applyProducerIsolation(repoRoot, workspaceRoot, childEnvironment(this.env));
  }

  async startProducer(input: AdapterProducerInput): Promise<void> {
    let modelArgs: string[];
    try {
      modelArgs = composeGrokModelArgs(input.model, input.effort);
    } catch {
      throw fail("start", "not_spawned", null);
    }
    const prompt = composeGrokProducerPrompt(input.task_path, input.approved_plan_run_id, input.write_scope);
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
        executable: GROK_EXECUTABLE,
        args: [
          "-p",
          prompt,
          ...GROK_PRODUCER_ARGV_AFTER_PROMPT,
          input.workspace_root,
          ...modelArgs,
          ...GROK_PRODUCER_ARGV_SUFFIX,
        ],
        cwd: input.workspace_root,
        env: producerChildEnvironment(childEnvironment(this.env)),
        timeoutMs: input.producer_timeout_ms ?? GROK_PRODUCER_TIMEOUT_MS,
        stdoutCapBytes: GROK_REVIEW_STDOUT_CAP,
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
    if (outcome.timedOut) {
      return { exitCode: outcome.exitCode, timedOut: true };
    }
    return { exitCode: outcome.exitCode, timedOut: false };
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
