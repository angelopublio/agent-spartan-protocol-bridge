import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS,
  CURSOR_LAUNCHER_ID,
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
import {
  AdapterFailureError,
  AdapterIsolationError,
  AdapterTimeoutError,
  ReviewerWriteDetectedError,
  type Adapter,
  type ProducerAdapter,
} from "./adapter.ts";
import { SANDBOX_EXEC_EXECUTABLE, createNodeProcessRunner, type ProcessHandle, type ProcessRunner } from "./process.ts";
import { classifyProviderFailure } from "./provider-failure.ts";
import { ReviewStreamParser, type ReviewStreamProgress } from "./review-stream.ts";

export { CURSOR_LAUNCHER_ID };

export const CURSOR_EXECUTABLE = "cursor-agent";
export const CURSOR_PROBE_ARGV = ["--help"] as const;
export const CURSOR_REVIEW_ARGV_PREFIX = [
  "-p",
  "--output-format",
  "json",
  "--mode",
  "plan",
  "--sandbox",
  "enabled",
  "--trust",
  "--workspace",
] as const;
export const CURSOR_REVIEW_STREAM_ARGV_PREFIX = [
  "-p",
  "--output-format",
  "stream-json",
  "--mode",
  "plan",
  "--sandbox",
  "enabled",
  "--trust",
  "--workspace",
] as const;
export const CURSOR_PRODUCER_ARGV_PREFIX = [
  "-p",
  "--output-format",
  "json",
  "--sandbox",
  "enabled",
  "--trust",
  "--workspace",
] as const;
export const CURSOR_CONSTANT_ARGV_TABLES: readonly (readonly string[])[] = [
  CURSOR_PROBE_ARGV,
  CURSOR_REVIEW_ARGV_PREFIX,
  CURSOR_REVIEW_STREAM_ARGV_PREFIX,
  CURSOR_PRODUCER_ARGV_PREFIX,
];
export const CURSOR_MODEL_FLAG = "--model";
export const CURSOR_FORBIDDEN_ARGV_TOKENS = [
  "--force",
  "-f",
  "--yolo",
  "--auto-review",
  "--approve-mcps",
  "--api-key",
  "--endpoint",
  "--header",
  "-H",
  "--list-models",
  "--resume",
  "--continue",
  "-w",
  "--worktree",
  "--worktree-base",
  "--add-dir",
  "--plugin-dir",
  "login",
  "logout",
  "status",
  "whoami",
  "about",
  "models",
  "mcp",
  "plugin",
  "worker",
  "bedrock",
  "install-shell-integration",
  "uninstall-shell-integration",
  "disabled",
] as const;
// AGENT_CLI_CREDENTIAL_STORE selects file vs keychain for the official client.
// The Bridge never sets it; when the parent process already has it, pass it through
// so the child can use an already-authenticated file credential store without the
// Bridge reading or copying credentials. The name trips isSensitiveRegistryKey
// (via the "credential" token), so childEnvironment consults a one-element
// exception set; the value is additionally guarded to the closed selector enum
// so an injected or unexpected value is dropped, not forwarded.
export const CURSOR_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TERM",
  "AGENT_CLI_CREDENTIAL_STORE",
] as const;
export const CURSOR_ENV_SENSITIVE_NAME_EXCEPTIONS = new Set(["AGENT_CLI_CREDENTIAL_STORE"]);
export const AGENT_CLI_CREDENTIAL_STORE_VALUES = new Set(["file", "keychain"]);
// A minimal, non-restrictive profile: this probe only proves that sandbox-exec
// itself can compile a profile and confine a trivial child, not that any
// particular write-scope profile is well-formed.
export const SANDBOX_EXEC_PROBE_PROFILE = "(version 1)\n(allow default)\n";
export const SANDBOX_EXEC_PROBE_ARGV = ["-p", SANDBOX_EXEC_PROBE_PROFILE, "/usr/bin/true"] as const;
export const CURSOR_PROBE_TIMEOUT_MS = 15_000;
export const CURSOR_PROBE_STDOUT_CAP = 1024 * 1024;
export const CURSOR_REVIEW_TIMEOUT_MS = 900_000;
export const CURSOR_PRODUCER_TIMEOUT_MS = BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS;
export const CURSOR_REVIEW_STDOUT_CAP = 4 * 1024 * 1024;
export const CURSOR_CANDIDATE_SCAN_CAP = 64;
export const CURSOR_WORKSPACE_DIR_MODE = 0o555;
export const CURSOR_WORKSPACE_FILE_MODE = 0o444;
export const CURSOR_HELP_TOKENS = ["--print", "--output-format", "--mode", "--sandbox", "--workspace", "--trust"];

export const CURSOR_REVIEW_PROMPT = `You are a read-only plan reviewer.

Review only the workspace files task.md and AGENTS.md. No other file is available for this review. Do not edit files. Do not inspect any other path.

Return a single JSON object as the last output. Use exactly these keys and no others: schema_version, review_kind, verdict, summary, findings. verdict must be exactly one of pass, changes_requested, human_required, blocked. finding id must match [A-Z][A-Z0-9_-]{0,31}. pass requires findings: []. changes_requested requires at least one finding whose severity is warning or error.

Length budget. Keep summary under 1200 characters and each finding message under 1200 characters. summary is a short orientation, not the review — put the substance in findings, which is what the task artifact records. An object that exceeds the schema's limits is rejected and the entire review is discarded, however good it was.

{"schema_version":2,"review_kind":"plan","verdict":"pass"|"changes_requested"|"human_required"|"blocked","summary":string,"findings":[{"id":string,"severity":"info"|"warning"|"error","message":string}]}
`;

export const CURSOR_IMPLEMENTATION_REVIEW_PROMPT = `You are a read-only implementation reviewer.

Review the workspace files AGENTS.md, task.md, diff.patch, changes.txt, and anything under worktree/. No other path is available for this review. Do not edit files. Do not inspect any other path.

Return a single JSON object as the last output. Use exactly these keys and no others: schema_version, review_kind, verdict, summary, findings. verdict must be exactly one of pass, changes_requested, human_required, blocked. finding id must match [A-Z][A-Z0-9_-]{0,31}. pass requires findings: []. changes_requested requires at least one finding whose severity is warning or error.

Length budget. Keep summary under 1200 characters and each finding message under 1200 characters. summary is a short orientation, not the review — put the substance in findings, which is what the task artifact records. An object that exceeds the schema's limits is rejected and the entire review is discarded, however good it was.

{"schema_version":2,"review_kind":"implementation","verdict":"pass"|"changes_requested"|"human_required"|"blocked","summary":string,"findings":[{"id":string,"severity":"info"|"warning"|"error","message":string}]}
`;

export function composeCursorReviewPrompt(reviewKind: ReviewKind): string {
  return reviewKind === "implementation" ? CURSOR_IMPLEMENTATION_REVIEW_PROMPT : CURSOR_REVIEW_PROMPT;
}

export function composeCursorProducerPrompt(
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

export type CursorAdapterOptions = {
  runner?: ProcessRunner;
  env?: NodeJS.ProcessEnv;
  prepareWorkspace?: (input: PrepareWorkspaceInput) => Promise<PreparedWorkspace>;
};

export function cursorCapabilities(): AdapterCapabilities {
  return {
    schema_version: SCHEMA_VERSION,
    launcher_id: CURSOR_LAUNCHER_ID,
    review_kinds: ["plan", "implementation"],
    permission_modes: [PERMISSION_MODE],
    workspace_write: false,
    fresh_context: true,
    observes_model: false,
    // Cursor Agent CLI has no schema-constrained final-message flag (D-043):
    // `--output-format json` shapes the transport envelope only. `review.ts`
    // refuses a reviewer dispatch to this adapter. Revisit if `cursor-agent`
    // grows a `--json-schema` / `--output-schema` flag.
    structured_output: false,
    isolated_workspace: true,
  };
}

export function cursorProducerCapabilities(): ProducerCapabilities {
  return {
    schema_version: SCHEMA_VERSION,
    launcher_id: CURSOR_LAUNCHER_ID,
    roles: ["implementer"],
    permission_modes: [WORKSPACE_WRITE_PERMISSION_MODE],
    workspace_write: true,
    fresh_context: true,
    isolated_producer_workspace: true,
  };
}

export function composeCursorModelArg(model: string, effort: EffortLevel): string {
  if (!isModelIdentifier(model) || !isEffortLevel(effort)) {
    throw new Error("adapter_error");
  }

  const encodedEffort = model.match(/-(low|medium|high|max)(?:-fast)?$/)?.[1] as EffortLevel | undefined;
  if (encodedEffort !== undefined) {
    if (effort !== "none" && encodedEffort !== effort) {
      throw new Error("adapter_error");
    }
    return model;
  }

  return effort === "none" ? model : `${model}[effort=${effort}]`;
}

export function childEnvironment(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of CURSOR_ENV_ALLOWLIST) {
    if (isSensitiveRegistryKey(key) && !CURSOR_ENV_SENSITIVE_NAME_EXCEPTIONS.has(key)) {
      continue;
    }
    const value = parent[key];
    if (value === undefined) {
      continue;
    }
    if (key === "AGENT_CLI_CREDENTIAL_STORE" && !AGENT_CLI_CREDENTIAL_STORE_VALUES.has(value)) {
      continue;
    }
    env[key] = value;
  }
  return env;
}

// Unwrap Cursor `result`. Then scan every closed `{...}` span and every
// fenced JSON body from the end, taking the first parse that is
// verdict-shaped: a plain object carrying schema_version, review_kind, and
// verdict. Values are not inspected. At most CURSOR_CANDIDATE_SCAN_CAP parse
// attempts, counted from the end. If that scan finds none, today's
// precedence runs as a fallback and is otherwise unmodified:
// 1. If a ```json fence is present, parse only the last fence body (invalid
//    fence content returns undefined; no fall-through).
// 2. If the whole candidate parses as JSON, return that value without
//    re-slicing it to an inner span.
// 3. Otherwise parse the last top-level balanced `{...}` using string-aware
//    brace matching. Nested objects inside that value are not extraction
//    targets. Prefix prose is skipped. String tracking begins only after an
//    unmatched `{` is on the stack: a `"` opens JSON string state only while
//    the brace stack is non-empty. Trailing text after that span is ignored.
// No parseable object returns undefined.
export function extractReviewPayload(stdout: string): unknown | undefined {
  return extractReviewPayloadWithCandidate(stdout).value;
}

type ExtractedReview = {
  value: unknown | undefined;
  candidate: string;
};

function extractReviewPayloadWithCandidate(stdout: string): ExtractedReview {
  const candidate = unwrapReviewCandidate(stdout);
  return { value: extractFromCandidate(candidate), candidate };
}

function unwrapReviewCandidate(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (isPlainObject(parsed) && typeof parsed.result === "string") {
      return parsed.result;
    }
    if (isPlainObject(parsed) && parsed.type === "result" && isPlainObject(parsed.result)) {
      return JSON.stringify(parsed.result);
    }
  } catch {
    const streamed = resultTextFromNdjson(stdout);
    if (streamed !== undefined) {
      return streamed;
    }
  }
  return stdout;
}

function extractFromCandidate(candidate: string): unknown | undefined {
  const scanned = scanVerdictShapedCandidate(candidate);
  if (scanned !== undefined) {
    return scanned;
  }
  return extractByLegacyPrecedence(candidate);
}

function scanVerdictShapedCandidate(candidate: string): unknown | undefined {
  const spans = [...collectBalancedSpans(candidate), ...collectFenceBodies(candidate)];
  spans.sort((left, right) => right.end - left.end || right.start - left.start);
  let attempts = 0;
  for (const span of spans) {
    if (attempts >= CURSOR_CANDIDATE_SCAN_CAP) {
      break;
    }
    attempts += 1;
    const parsed = parseJsonOrUndefined(candidate.slice(span.start, span.end + 1));
    if (parsed !== undefined && isVerdictShaped(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function extractByLegacyPrecedence(candidate: string): unknown | undefined {
  const fenced = lastJsonFence(candidate);
  if (fenced !== null) {
    return parseJsonOrUndefined(fenced);
  }
  const whole = parseJsonOrUndefined(candidate);
  if (whole !== undefined) {
    return whole;
  }
  const lastObject = lastBalancedObject(candidate);
  if (lastObject === null) {
    return undefined;
  }
  return parseJsonOrUndefined(lastObject);
}

function isVerdictShaped(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    "schema_version" in value &&
    "review_kind" in value &&
    "verdict" in value
  );
}

export class CursorAdapter implements Adapter, ProducerAdapter {
  private readonly runner: ProcessRunner;
  private readonly env: NodeJS.ProcessEnv;
  private readonly prepareWorkspace: (input: PrepareWorkspaceInput) => Promise<PreparedWorkspace>;
  private workspaceRoot: string | undefined;
  private baseline: TreeSnapshot | undefined;
  private snapshotPolicy: SnapshotPolicy = "repository";
  private handle: ProcessHandle | undefined;
  private producerHandle: ProcessHandle | undefined;
  private producerWriteGuard: ProducerIsolationGuard | undefined;
  private streamJsonSupported = false;
  private streamSink: ((info: ReviewStreamProgress) => void) | undefined;
  private streamParser: ReviewStreamParser | undefined;

  constructor(options: CursorAdapterOptions = {}) {
    this.runner = options.runner ?? createNodeProcessRunner();
    this.env = options.env ?? process.env;
    this.prepareWorkspace = options.prepareWorkspace ?? prepareReviewWorkspace;
  }

  capabilities(): AdapterCapabilities {
    return cursorCapabilities();
  }

  async preflight(): Promise<void> {
    let handle;
    try {
      handle = this.runner.start({
        executable: CURSOR_EXECUTABLE,
        args: CURSOR_PROBE_ARGV,
        cwd: os.tmpdir(),
        env: childEnvironment(this.env),
        timeoutMs: CURSOR_PROBE_TIMEOUT_MS,
        stdoutCapBytes: CURSOR_PROBE_STDOUT_CAP,
      });
    } catch {
      throw fail("preflight", "spawn_failed", null, Buffer.alloc(0), "cursor_preflight_failed");
    }
    let outcome;
    try {
      outcome = await handle.wait();
    } catch {
      throw fail("preflight", "spawn_failed", null, Buffer.alloc(0), "cursor_preflight_failed");
    }
    const stdout = outcome.stdout.toString("utf8");
    if (outcome.timedOut) {
      throw fail("preflight", "timed_out", null, outcome.stderr, "cursor_preflight_failed");
    }
    if (outcome.stdoutOverflow) {
      throw fail("preflight", "output_overflow", outcome.exitCode, outcome.stderr, "cursor_preflight_failed");
    }
    if (outcome.exitCode !== 0) {
      throw fail("preflight", "exit_nonzero", outcome.exitCode, outcome.stderr, "cursor_preflight_failed", null, outcome.stdout);
    }
    for (const token of CURSOR_HELP_TOKENS) {
      if (!stdout.includes(token)) {
        throw fail("preflight", "interface_unrecognized", outcome.exitCode, outcome.stderr, "cursor_preflight_failed");
      }
    }
    this.streamJsonSupported = stdout.includes("stream-json");
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
          mode: CURSOR_WORKSPACE_FILE_MODE,
        });
        await fs.writeFile(path.join(prepared.workspaceRoot, "task.md"), taskBytes, {
          mode: CURSOR_WORKSPACE_FILE_MODE,
        });
        await fs.chmod(path.join(prepared.workspaceRoot, "AGENTS.md"), CURSOR_WORKSPACE_FILE_MODE);
        await fs.chmod(path.join(prepared.workspaceRoot, "task.md"), CURSOR_WORKSPACE_FILE_MODE);
        await fs.chmod(prepared.workspaceRoot, CURSOR_WORKSPACE_DIR_MODE);
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
      await fs.writeFile(path.join(workspace, "AGENTS.md"), agentsBytes, { mode: CURSOR_WORKSPACE_FILE_MODE });
      await fs.writeFile(path.join(workspace, "task.md"), taskBytes, { mode: CURSOR_WORKSPACE_FILE_MODE });
      await fs.chmod(path.join(workspace, "AGENTS.md"), CURSOR_WORKSPACE_FILE_MODE);
      await fs.chmod(path.join(workspace, "task.md"), CURSOR_WORKSPACE_FILE_MODE);
      await fs.chmod(workspace, CURSOR_WORKSPACE_DIR_MODE);
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
    let modelValue: string;
    try {
      modelValue = composeCursorModelArg(input.model, input.effort);
    } catch {
      throw fail("start", "not_spawned", null);
    }
    this.streamParser = new ReviewStreamParser(CURSOR_REVIEW_STDOUT_CAP, this.streamSink);
    const prefix = this.streamJsonSupported ? CURSOR_REVIEW_STREAM_ARGV_PREFIX : CURSOR_REVIEW_ARGV_PREFIX;
    try {
      this.handle = this.runner.start({
        executable: CURSOR_EXECUTABLE,
        args: [
          ...prefix,
          this.workspaceRoot,
          CURSOR_MODEL_FLAG,
          modelValue,
          composeCursorReviewPrompt(input.review_kind),
        ],
        cwd: this.workspaceRoot,
        env: childEnvironment(this.env),
        timeoutMs: CURSOR_REVIEW_TIMEOUT_MS,
        stdoutCapBytes: CURSOR_REVIEW_STDOUT_CAP,
        onStdoutChunk: (chunk) => {
          this.streamParser?.feed(chunk);
        },
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
    if (this.streamParser && this.streamParser.observedBytes === 0 && outcome.stdout.length > 0) {
      this.streamParser.feed(outcome.stdout);
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
    const stdoutText = outcome.stdout.toString("utf8");
    const streamSource =
      parser?.resultText !== undefined
        ? parser.resultText
        : parser !== undefined && parser.residual.length > 0
          ? parser.residual
          : undefined;
    let extracted = extractReviewPayloadWithCandidate(streamSource ?? stdoutText);
    if (extracted.value === undefined && streamSource !== undefined) {
      const fromStdout = extractReviewPayloadWithCandidate(stdoutText);
      if (fromStdout.value !== undefined) {
        extracted = fromStdout;
      }
    }
    if (outcome.exitCode !== 0) {
      const classified = classifyProviderFailure(outcome.stdout);
      const extras = { signal: observation.signal, httpStatus: classified.http_status };
      if (classified.cause !== null) {
        throw fail("collect", classified.cause, outcome.exitCode, outcome.stderr, "adapter_error", null, outcome.stdout, extras);
      }
      if (extracted.value === undefined && outcome.stdout.length > 0) {
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
    if (extracted.value === undefined) {
      throw fail("collect", "output_unparsable", outcome.exitCode, outcome.stderr, "adapter_error", extracted.candidate);
    }
    return extracted.value;
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
    this.streamParser = undefined;
    if (!workspace) {
      return;
    }
    try {
      await fs.chmod(workspace, 0o700);
    } catch {
      // best-effort: a 0555 workspace still needs to be removable
    }
    await fs.rm(workspace, { recursive: true, force: true });
  }

  observedModel(): string | null {
    return null;
  }

  producerCapabilities(): ProducerCapabilities {
    return cursorProducerCapabilities();
  }

  async producerPreflight(): Promise<void> {
    await this.preflight();
    await this.verifySandboxExecInterface();
  }

  // The isolated producer refuses to start unless `sandbox-exec` can enforce
  // its allow-list profile. Confirm the interface before any producer spawn,
  // separately from the unrelated cursor-agent preflight above.
  private async verifySandboxExecInterface(): Promise<void> {
    if (process.platform !== "darwin") {
      throw fail("preflight", "interface_unrecognized", null, Buffer.alloc(0), "cursor_preflight_failed");
    }
    let handle;
    try {
      handle = this.runner.start({
        executable: SANDBOX_EXEC_EXECUTABLE,
        args: SANDBOX_EXEC_PROBE_ARGV,
        cwd: os.tmpdir(),
        env: childEnvironment(this.env),
        timeoutMs: CURSOR_PROBE_TIMEOUT_MS,
        stdoutCapBytes: CURSOR_PROBE_STDOUT_CAP,
      });
    } catch {
      throw fail("preflight", "spawn_failed", null, Buffer.alloc(0), "cursor_preflight_failed");
    }
    let outcome;
    try {
      outcome = await handle.wait();
    } catch {
      throw fail("preflight", "spawn_failed", null, Buffer.alloc(0), "cursor_preflight_failed");
    }
    if (outcome.timedOut) {
      throw fail("preflight", "timed_out", null, outcome.stderr, "cursor_preflight_failed");
    }
    if (outcome.exitCode !== 0) {
      throw fail("preflight", "exit_nonzero", outcome.exitCode, outcome.stderr, "cursor_preflight_failed", null, outcome.stdout);
    }
  }

  // Runtime-controlled and idempotent. Preparation and merge-back are core
  // responsibilities; the adapter owns only the sandbox profile.
  async lockProducerIsolation(repoRoot: string, workspaceRoot: string): Promise<void> {
    if (this.producerWriteGuard !== undefined) {
      return;
    }
    this.producerWriteGuard = await applyProducerIsolation(repoRoot, workspaceRoot, childEnvironment(this.env));
  }

  async startProducer(input: AdapterProducerInput): Promise<void> {
    let modelValue: string;
    try {
      modelValue = composeCursorModelArg(input.model, input.effort);
    } catch {
      throw fail("start", "not_spawned", null);
    }
    const prompt = composeCursorProducerPrompt(input.task_path, input.approved_plan_run_id, input.write_scope);
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
        executable: CURSOR_EXECUTABLE,
        args: [
          ...CURSOR_PRODUCER_ARGV_PREFIX,
          input.workspace_root,
          CURSOR_MODEL_FLAG,
          modelValue,
          prompt,
        ],
        cwd: input.workspace_root,
        env: producerChildEnvironment(childEnvironment(this.env)),
        timeoutMs: input.producer_timeout_ms ?? CURSOR_PRODUCER_TIMEOUT_MS,
        stdoutCapBytes: CURSOR_REVIEW_STDOUT_CAP,
        retainStdout: true,
        sandboxProfile: guard.sandboxProfile,
        detached: true,
      });
    } catch {
      this.producerWriteGuard = undefined;
      throw fail("start", "spawn_failed", null);
    }
  }

  // Waiting does not release runtime-owned isolation. The caller completes
  // both post-child captures and then invokes the release seam exactly once.
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

  // The one runtime-controlled release point. The profile is inert data until
  // spawn and changes no live-tree mode; clearing it is idempotent.
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

function resultTextFromNdjson(stdout: string): string | undefined {
  let found: string | undefined;
  for (const line of stdout.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isPlainObject(parsed) || parsed.type !== "result") {
      continue;
    }
    if (typeof parsed.result === "string") {
      found = parsed.result;
    } else if (isPlainObject(parsed.result)) {
      found = JSON.stringify(parsed.result);
    }
  }
  return found;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonOrUndefined(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

type TextSpan = {
  start: number;
  end: number;
};

// Single left-to-right pass: unmatched `{` stay on the stack, each `}` closes
// the most recent open brace, and every closed span is recorded. A `"` opens
// JSON string state only while the brace stack is non-empty; text outside
// every object is prose.
function collectBalancedSpans(text: string): TextSpan[] {
  const starts: number[] = [];
  const spans: TextSpan[] = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      if (starts.length > 0) {
        inString = true;
      }
      continue;
    }
    if (char === "{") {
      starts.push(index);
      continue;
    }
    if (char === "}") {
      const start = starts.pop();
      if (start === undefined) {
        continue;
      }
      spans.push({ start, end: index });
    }
  }
  return spans;
}

function lastBalancedObject(text: string): string | null {
  const spans = collectBalancedSpans(text);
  const last = spans.at(-1);
  if (last === undefined) {
    return null;
  }
  return text.slice(last.start, last.end + 1);
}

function collectFenceBodies(text: string): TextSpan[] {
  const pattern = /```json[ \t]*\n([\s\S]*?)```/g;
  const spans: TextSpan[] = [];
  let match = pattern.exec(text);
  while (match) {
    const body = match[1] ?? "";
    if (body.length > 0) {
      const bodyStart = match.index + match[0].length - "```".length - body.length;
      spans.push({ start: bodyStart, end: bodyStart + body.length - 1 });
    }
    match = pattern.exec(text);
  }
  return spans;
}

function lastJsonFence(text: string): string | null {
  const pattern = /```json[ \t]*\n([\s\S]*?)```/g;
  let last: string | null = null;
  let match = pattern.exec(text);
  while (match) {
    last = match[1] ?? null;
    match = pattern.exec(text);
  }
  return last;
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
