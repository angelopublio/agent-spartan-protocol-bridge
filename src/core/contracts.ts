export const SCHEMA_VERSION = 2 as const;
export const REGISTRY_SCHEMA_VERSION = 1 as const;
export const REVIEW_KINDS = ["plan", "implementation"] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];
export const PERMISSION_MODE = "read-only" as const;
export const WORKSPACE_WRITE_PERMISSION_MODE = "workspace-write" as const;
export const FAKE_LAUNCHER_ID = "fake-reviewer-v1" as const;
export const CURSOR_LAUNCHER_ID = "cursor-plan-reviewer-v1" as const;
export const CODEX_LAUNCHER_ID = "codex-plan-reviewer-v1" as const;
export const GROK_LAUNCHER_ID = "grok-plan-reviewer-v1" as const;
export const CLAUDE_LAUNCHER_ID = "claude-plan-reviewer-v1" as const;
export const PROTOCOL_VERSION = "0.7.0" as const;
export const BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS = 2_700_000 as const;
// The reviewer verdict contract's two length caps. They live here because
// `reviewOutputSchema` hands them to the client CLI and `parseReviewResult`
// re-checks them on the way back: two hardcoded copies in different layers can
// drift, and a client-side cap looser than the Bridge-side one turns a valid
// review into `result_schema_invalid` after the work is already paid for.
// `summary` is capped well above `message` because it is the field a reviewer
// uses for narrative and the one no artifact renders (`renderRegion` reads it
// only for the redaction gate), while every `message` is written into the task
// artifact and has never exceeded 1379 characters in practice. Two live
// implementation reviews were discarded whole at 2028 and 2186 characters of
// summary before this headroom existed; the adapter prompts additionally budget
// both fields well inside these caps.
export const REVIEW_SUMMARY_MAX_CHARS = 4000 as const;
export const REVIEW_FINDING_MESSAGE_MAX_CHARS = 2000 as const;
export const REVIEW_MAX_FINDINGS = 100 as const;

export function isReviewKind(value: unknown): value is ReviewKind {
  return value === "plan" || value === "implementation";
}

export const HOST_DISPLAY_TO_CANONICAL = {
  Codex: "codex",
  "Claude Code": "claude",
  Cursor: "cursor",
  Grok: "grok",
} as const;

export type HostDisplayName = keyof typeof HOST_DISPLAY_TO_CANONICAL;
export type CanonicalHost = (typeof HOST_DISPLAY_TO_CANONICAL)[HostDisplayName];

export const CANONICAL_HOSTS = ["codex", "claude", "cursor", "grok"] as const;

export const PRODUCER_ROLES = ["implementer"] as const;
export type ProducerRole = (typeof PRODUCER_ROLES)[number];

export type ProducerIdentity = {
  role: ProducerRole;
  host: CanonicalHost;
};

export type RunState =
  | "requested"
  | "policy_resolved"
  | "reviewing"
  | "changes_requested"
  | "awaiting_implementer"
  | "review_passed"
  | "human_required"
  | "blocked"
  | "failed";

export type EventType =
  | "run_requested"
  | "policy_resolved"
  | "review_started"
  | "review_result_accepted"
  | "task_artifact_written"
  | "run_terminal";

export type BridgeVerdict =
  | "pass"
  | "changes_requested"
  | "human_required"
  | "blocked";

export const MODEL_IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const EFFORT_LEVELS = ["low", "medium", "high", "max", "none"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
export type ModelObserved = "observed" | "declared_unobserved";

export function isModelIdentifier(value: string): boolean {
  return MODEL_IDENTIFIER_RE.test(value);
}

export function isEffortLevel(value: string): value is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value);
}

export type ReasonCode =
  | "path_invalid"
  | "task_unreadable"
  | "task_invalid"
  | "agents_unreadable"
  | "agents_policy_invalid"
  | "automatic_review_not_authorized"
  | "reviewer_binding_missing"
  | "host_invalid"
  | "registry_unavailable"
  | "registry_schema_invalid"
  | "registry_sensitive_field"
  | "registry_context_incomplete"
  | "client_context_unavailable"
  | "launcher_unavailable"
  | "capability_denied"
  | "reviewer_output_unconstrained"
  | "integrity_mismatch"
  | "model_mismatch"
  | "adapter_error"
  | "result_schema_invalid"
  | "reviewer_isolation_unavailable"
  | "producer_snapshot_cap_exceeded"
  | "adapter_timeout"
  | "reviewer_write_detected"
  | "task_artifact_write_rejected"
  | "transition_review_kind_refused"
  | "transition_next_role_not_reviewer"
  | "review_passed"
  | "review_changes_requested"
  | "review_human_required"
  | "review_blocked"
  | "chain_refused"
  | "cycle_limit_reached"
  | "automatic_implementation_not_authorized"
  | "plan_targets_unwritable_path"
  | "config_invalid"
  | "approved_artifact_stale"
  | "writer_lock_unavailable"
  | "producer_failure"
  | "producer_timeout"
  | "write_scope_violation"
  | "runtime_state_violation"
  | "producer_declaration_invalid"
  | "cancelled"
  | "interrupted"
  | "stale_build";

export type TaskWriteState = "not_authorized" | "skipped_human_gate" | "written" | "rejected";

// Closed, non-secret failure-class vocabulary for a refused `task_artifact_write`
// (task 0046, D3). Every `WRITE_REJECTED` return site in `src/core/task-write.ts`
// maps to exactly one of these; sites in one class share its value. The value
// never carries artifact bytes, a path, a line, a handoff id, or reviewer prose.
// `composition_failed` is the only class the verdict-independent pre-dispatch
// shape check (D2) can return; the post-write path can return any class.
export const TASK_WRITE_REJECTION_CAUSES = [
  "artifact_unreadable",
  "artifact_hash_stale",
  "frontmatter_unparseable",
  "verdict_not_persistable",
  "review_region_unrenderable",
  "timestamp_invalid",
  "composition_failed",
  "atomic_write_failed",
  "post_write_unreadable",
  "post_write_reparse_failed",
  "authorized_bytes_changed",
] as const;
export type TaskWriteRejectionCause = (typeof TASK_WRITE_REJECTION_CAUSES)[number];

export function isTaskWriteRejectionCause(value: unknown): value is TaskWriteRejectionCause {
  return (TASK_WRITE_REJECTION_CAUSES as readonly string[]).includes(value as string);
}

export const REVIEW_CHAIN_REFUSED = [
  "not_authorized",
  "run_unreadable",
  "task_mismatch",
  "verdict_not_chainable",
  "agents_changed",
  "task_unchanged",
] as const;
export type ReviewChainRefused = (typeof REVIEW_CHAIN_REFUSED)[number];

export type ReviewChainRecord = {
  after_run_id: string | null;
  cycle: number | null;
  max_cycles: 1 | 2 | 3;
  refused: ReviewChainRefused | null;
};

export const REVIEWER_WRITE_COMPARISONS = ["reviewer_workspace", "repository_worktree"] as const;
export type ReviewerWriteComparison = (typeof REVIEWER_WRITE_COMPARISONS)[number];

export const SNAPSHOT_DIFF_CHANGES = ["appeared", "vanished", "changed"] as const;
export type SnapshotDiffChange = (typeof SNAPSHOT_DIFF_CHANGES)[number];

export const SNAPSHOT_DIFF_FIELDS = ["kind", "mode", "size", "hash", "mtimeNs", "linkTarget"] as const;
export type SnapshotDiffField = (typeof SNAPSHOT_DIFF_FIELDS)[number];

export type SnapshotDiffEntry = {
  path: string;
  change: SnapshotDiffChange;
  fields: SnapshotDiffField[];
};

export const WORKSPACE_MANIFEST_KINDS = ["product", "patch", "change-list"] as const;
export type WorkspaceManifestKind = (typeof WORKSPACE_MANIFEST_KINDS)[number];

export type WorkspaceManifestFileEntry = {
  path: string;
  kind: WorkspaceManifestKind;
  size: number;
  sha256: string;
  gitMode?: string;
};

export type WorkspaceManifest = {
  baseCommit: string;
  patchByteLength: number;
  entries: readonly WorkspaceManifestFileEntry[];
};

export type ReviewerWriteRecord = {
  comparison: ReviewerWriteComparison;
  entries: readonly SnapshotDiffEntry[];
};

export const ADAPTER_FAILURE_PHASES = [
  "preflight",
  "prepare",
  "start",
  "collect",
  "verify",
  "post_review_snapshot",
  "persist_result",
] as const;
export type AdapterFailurePhase = (typeof ADAPTER_FAILURE_PHASES)[number];

export const ADAPTER_FAILURE_CAUSES = [
  "not_spawned",
  "spawn_failed",
  "timed_out",
  "exit_nonzero",
  "output_overflow",
  "output_unparsable",
  "interface_unrecognized",
  "unexpected_error",
  "runtime_error",
  "provider_unavailable",
  "provider_limit",
] as const;
export type AdapterFailureCause = (typeof ADAPTER_FAILURE_CAUSES)[number];

export function isAdapterFailurePhase(value: unknown): value is AdapterFailurePhase {
  return (ADAPTER_FAILURE_PHASES as readonly string[]).includes(value as string);
}

export function isAdapterFailureCause(value: unknown): value is AdapterFailureCause {
  return (ADAPTER_FAILURE_CAUSES as readonly string[]).includes(value as string);
}

export type AdapterFailureRecord = {
  phase: AdapterFailurePhase;
  cause: AdapterFailureCause;
  exit_code: number | null;
  signal: string | null;
  http_status: number | null;
  stderr_bytes: number;
  stderr_log: string | null;
  payload_log: string | null;
  output_excerpt_bytes: number;
  output_excerpt: string | null;
};

// Owns the closed four-code write-scope-failure vocabulary so
// `producer-write-scope.ts` and the transition diagnostic share one
// definition instead of two drifting copies. `producer-write-scope.ts`
// imports and re-exports this pair; `ProducerWriteScopeError` and its public
// behavior stay in that file unchanged.
export const PRODUCER_WRITE_SCOPE_FAILURES = [
  "symlink",
  "exact_file_missing",
  "confine_unavailable",
  "hardlink",
] as const;
export type ProducerWriteScopeFailure = (typeof PRODUCER_WRITE_SCOPE_FAILURES)[number];

export function isProducerWriteScopeFailure(value: unknown): value is ProducerWriteScopeFailure {
  return (PRODUCER_WRITE_SCOPE_FAILURES as readonly string[]).includes(value as string);
}

export function isFiniteIntegerExitCode(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}

export const PRODUCER_DIAGNOSTIC_STAGES = ["write_scope_lock", "capture", "spawn", "wait", "exit_nonzero"] as const;
export type ProducerDiagnosticStage = (typeof PRODUCER_DIAGNOSTIC_STAGES)[number];

export function isProducerDiagnosticStage(value: unknown): value is ProducerDiagnosticStage {
  return (PRODUCER_DIAGNOSTIC_STAGES as readonly string[]).includes(value as string);
}

export const PRODUCER_SNAPSHOT_SITES = [
  "workspace_baseline",
  "repo_before",
  "runtime_before",
  "workspace_after",
  "repo_after",
  "runtime_after",
] as const;
export type ProducerSnapshotSite = (typeof PRODUCER_SNAPSHOT_SITES)[number];

export function isProducerSnapshotSite(value: unknown): value is ProducerSnapshotSite {
  return (PRODUCER_SNAPSHOT_SITES as readonly string[]).includes(value as string);
}

export const PRODUCER_SNAPSHOT_CAPS = ["entries", "hash_bytes"] as const;
export type ProducerSnapshotCap = (typeof PRODUCER_SNAPSHOT_CAPS)[number];

export function isProducerSnapshotCap(value: unknown): value is ProducerSnapshotCap {
  return (PRODUCER_SNAPSHOT_CAPS as readonly string[]).includes(value as string);
}

// The one nullable closed record that explains a producer execution stop
// (task 0040, D1). Every key is a closed scalar; there is no free-text
// field, so a caller can never smuggle stdout, stderr, a payload, a prompt,
// or an unrecognized throw's message/class name into it.
export type ProducerDiagnostic = {
  stage: ProducerDiagnosticStage;
  exit_code: number | null;
  timed_out: boolean;
  write_scope_code: ProducerWriteScopeFailure | null;
  adapter_phase: AdapterFailurePhase | null;
  adapter_cause: AdapterFailureCause | null;
  waited_ms: number | null;
  snapshot_site: ProducerSnapshotSite | null;
  snapshot_cap: ProducerSnapshotCap | null;
};

// The shared constructor every D2 arm uses to populate `producer_diagnostic`
// at its exact catch/result boundary. It validates membership in the closed
// stage/write-scope/adapter/snapshot enums and accepts only a finite integer
// exit code or null, throwing on anything else so an out-of-domain value can
// never originate from this constructor. It never reads `error.message`,
// `error.name`, stdout, stderr, a payload, or any other free-text source.
export function buildProducerDiagnostic(input: {
  stage: ProducerDiagnosticStage;
  exitCode?: number | null;
  timedOut?: boolean;
  writeScopeCode?: ProducerWriteScopeFailure | null;
  adapterPhase?: AdapterFailurePhase | null;
  adapterCause?: AdapterFailureCause | null;
  waitedMs?: number | null;
  snapshotSite?: ProducerSnapshotSite | null;
  snapshotCap?: ProducerSnapshotCap | null;
}): ProducerDiagnostic {
  if (!isProducerDiagnosticStage(input.stage)) {
    throw new TypeError("invalid producer diagnostic stage");
  }
  const exitCode = input.exitCode ?? null;
  if (exitCode !== null && !isFiniteIntegerExitCode(exitCode)) {
    throw new TypeError("invalid producer diagnostic exit code");
  }
  const writeScopeCode = input.writeScopeCode ?? null;
  if (writeScopeCode !== null && !isProducerWriteScopeFailure(writeScopeCode)) {
    throw new TypeError("invalid producer diagnostic write-scope code");
  }
  const adapterPhase = input.adapterPhase ?? null;
  if (adapterPhase !== null && !isAdapterFailurePhase(adapterPhase)) {
    throw new TypeError("invalid producer diagnostic adapter phase");
  }
  const adapterCause = input.adapterCause ?? null;
  if (adapterCause !== null && !isAdapterFailureCause(adapterCause)) {
    throw new TypeError("invalid producer diagnostic adapter cause");
  }
  const waitedMs = input.waitedMs ?? null;
  if (waitedMs !== null && (!Number.isInteger(waitedMs) || waitedMs <= 0)) {
    throw new TypeError("invalid producer diagnostic waited ms");
  }
  const snapshotSite = input.snapshotSite ?? null;
  if (snapshotSite !== null && !isProducerSnapshotSite(snapshotSite)) {
    throw new TypeError("invalid producer diagnostic snapshot site");
  }
  const snapshotCap = input.snapshotCap ?? null;
  if (snapshotCap !== null && !isProducerSnapshotCap(snapshotCap)) {
    throw new TypeError("invalid producer diagnostic snapshot cap");
  }
  return {
    stage: input.stage,
    exit_code: exitCode,
    timed_out: input.timedOut === true,
    write_scope_code: writeScopeCode,
    adapter_phase: adapterPhase,
    adapter_cause: adapterCause,
    waited_ms: waitedMs,
    snapshot_site: snapshotSite,
    snapshot_cap: snapshotCap,
  };
}

export type FindingSeverity = "info" | "warning" | "error";

export type ArtifactHashes = {
  task: string | null;
  agents: string | null;
};

export type ReviewRequest = {
  schema_version: typeof SCHEMA_VERSION;
  repo_root: string;
  task_path: string;
  review_kind: ReviewKind;
};

export type ReviewFinding = {
  id: string;
  severity: FindingSeverity;
  message: string;
};

export type ReviewResult = {
  schema_version: typeof SCHEMA_VERSION;
  review_kind: ReviewKind;
  verdict: BridgeVerdict;
  summary: string;
  findings: ReviewFinding[];
};

export type ResolvedPolicy = {
  schema_version: typeof SCHEMA_VERSION;
  review_kind: ReviewKind;
  host: CanonicalHost;
  client_context: string;
  model: string;
  effort: EffortLevel;
  launcher_id: string;
  automatic_review_authorized: true;
  task_artifact_write_authorized: boolean;
  producer_chain_authorized: boolean;
  max_review_cycles: 1 | 2 | 3;
  permission_mode: typeof PERMISSION_MODE;
};

export type AdapterCapabilities = {
  schema_version: typeof SCHEMA_VERSION;
  launcher_id: string;
  review_kinds: string[];
  permission_modes: string[];
  workspace_write: boolean;
  fresh_context: boolean;
  observes_model: boolean;
  // False when the launcher CLI cannot force the reviewer's final message to a
  // JSON schema (today: Cursor). `review.ts` refuses a dispatch to such an
  // adapter with `reviewer_output_unconstrained` before any child is spawned.
  structured_output: boolean;
  // True when the adapter runs the reviewer in a prepared workspace that is not
  // the repository worktree, and its own `verify()` compares that workspace
  // before/after (`reviewer_workspace`). Every real reviewer adapter does this.
  // `review.ts` then skips the redundant repository-worktree diff, which for an
  // isolated adapter can only ever attribute a concurrent external write (a
  // launcher log, a sibling session's commit) to the reviewer (task 0051).
  isolated_workspace: boolean;
};

export type ProducerCapabilities = {
  schema_version: typeof SCHEMA_VERSION;
  launcher_id: string;
  roles: ProducerRole[];
  permission_modes: string[];
  workspace_write: true;
  fresh_context: boolean;
  isolated_producer_workspace: boolean;
};

export type AdapterProducerInput = {
  execution_id: string;
  role: ProducerRole;
  permission_mode: typeof WORKSPACE_WRITE_PERMISSION_MODE;
  repo_root: string;
  workspace_root: string;
  task_path: string;
  approved_plan_run_id: string;
  model: string;
  effort: EffortLevel;
  write_scope: readonly string[];
  producer_timeout_ms?: number;
};

export type TransitionState =
  | "authorized"
  | "locked"
  | "producer_running"
  | "producer_finished"
  | "reviewing"
  | "completed"
  | "stopped";

export type TransitionEventType =
  | "authorization"
  | "lock_acquired"
  | "producer_started"
  | "producer_finished"
  | "path_validated"
  | "implementation_review_dispatched"
  | "implementation_review_result"
  | "correction_dispatched"
  | "terminal_stop";

export const DECLARATION_INVALID_DETAILS = [
  "frontmatter_unparseable",
  "frontmatter_task_type",
  "frontmatter_phase",
  "frontmatter_current_role",
  "frontmatter_next_role",
  "frontmatter_next_handoff_id",
  "identifier_not_canonical",
  "section_absent",
  "opening_shape",
  "advisory_fence_nested",
  "advisory_fence_unclosed",
  "prompt_block_missing",
  "prompt_fence_nested",
  "prompt_fence_unclosed",
  "trailing_content",
  "advisory_handoff_line",
  "prompt_handoff_mark",
  "stray_identifier",
  "advisory_role_line",
  "prompt_open_path",
  "prompt_act_as_reviewer",
  "artifact_unchanged",
] as const;
export type DeclarationInvalidDetail = (typeof DECLARATION_INVALID_DETAILS)[number];

export function isDeclarationInvalidDetail(value: unknown): value is DeclarationInvalidDetail {
  return (DECLARATION_INVALID_DETAILS as readonly string[]).includes(value as string);
}

export type TransitionStatusDocument = {
  schema_version: typeof SCHEMA_VERSION;
  document: "transition";
  transition_id: string;
  state: TransitionState;
  parent_run_id: string;
  task_path: string;
  approved_task_hash: string | null;
  policy_digest: string | null;
  implementer_host: CanonicalHost | null;
  implementer_launcher_id: string | null;
  lock_identity: string | null;
  reason_code: ReasonCode | null;
  producer_diagnostic: ProducerDiagnostic | null;
  unwritable_plan_targets: string[] | null;
  producer_refused_paths: string[] | null;
  declaration_invalid_detail: string | null;
  current_review_run_id: string | null;
  linked_review_run_ids: readonly string[];
  created_at: string;
  updated_at: string;
};

export type TransitionEventDocument = {
  schema_version: typeof SCHEMA_VERSION;
  sequence: number;
  timestamp: string;
  transition_id: string;
  type: TransitionEventType;
  state: TransitionState;
  reason_code: ReasonCode | null;
  producer_diagnostic: ProducerDiagnostic | null;
  unwritable_plan_targets: string[] | null;
  producer_refused_paths: string[] | null;
  declaration_invalid_detail: string | null;
  review_run_id: string | null;
};

export type StatusDocument = {
  schema_version: typeof SCHEMA_VERSION;
  run_id: string;
  state: RunState;
  review_kind: ReviewKind;
  task_path: string;
  host: CanonicalHost | null;
  client_context: string | null;
  model: string | null;
  effort: EffortLevel | null;
  model_observed: ModelObserved | null;
  policy_digest: string | null;
  artifact_hashes: ArtifactHashes;
  execution_id: string | null;
  verdict: BridgeVerdict | null;
  reason_code: ReasonCode | null;
  task_write_state: TaskWriteState | null;
  task_hash_after_write: string | null;
  // The D3 named failure class beside `task_write_state: rejected` (or beside a
  // pre-dispatch `task_artifact_write_rejected` refusal, whose `task_write_state`
  // stays null). A closed non-secret enum value, never artifact bytes/path/prose.
  task_write_rejection_cause: TaskWriteRejectionCause | null;
  // D4: name of the run-directory file holding the accepted-but-unwritten
  // reviewer verdict when a post-write rejection still occurred, or null.
  review_verdict_log: string | null;
  reviewer_write: ReviewerWriteRecord | null;
  adapter_failure: AdapterFailureRecord | null;
  pre_dispatch_diagnostic: string | null;
  producer_identity: ProducerIdentity | null;
  review_chain: ReviewChainRecord | null;
  transition_id: string | null;
  created_at: string;
  updated_at: string;
};

export type EventDocument = {
  schema_version: typeof SCHEMA_VERSION;
  sequence: number;
  timestamp: string;
  run_id: string;
  type: EventType;
  state: RunState;
  review_kind: ReviewKind;
  policy_digest: string | null;
  artifact_hashes: ArtifactHashes;
  execution_id: string | null;
  verdict: BridgeVerdict | null;
  reason_code: ReasonCode | null;
  task_write_state: TaskWriteState | null;
  task_hash_after_write: string | null;
  task_write_rejection_cause: TaskWriteRejectionCause | null;
  pre_dispatch_diagnostic: string | null;
};

export type AdapterReviewInput = {
  execution_id: string;
  review_kind: ReviewKind;
  permission_mode: typeof PERMISSION_MODE;
  repo_root: string;
  run_dir: string;
  task_path: string;
  task_content: string;
  task_hash: string;
  agents_content: string;
  agents_hash: string;
  policy_digest: string;
  model: string;
  effort: EffortLevel;
  implementation_review_scope: readonly string[];
};

export const VERDICT_TO_TERMINAL: Record<
  BridgeVerdict,
  { state: RunState; reason_code: ReasonCode }
> = {
  pass: { state: "awaiting_implementer", reason_code: "review_passed" },
  changes_requested: {
    state: "changes_requested",
    reason_code: "review_changes_requested",
  },
  human_required: {
    state: "human_required",
    reason_code: "review_human_required",
  },
  blocked: { state: "blocked", reason_code: "review_blocked" },
};

export function terminalForVerdict(
  verdict: BridgeVerdict,
  reviewKind: ReviewKind,
): { state: RunState; reason_code: ReasonCode } {
  if (verdict === "pass" && reviewKind === "implementation") {
    return { state: "review_passed", reason_code: "review_passed" };
  }
  return VERDICT_TO_TERMINAL[verdict];
}

export const PRE_REVIEW_BLOCKED = new Set<ReasonCode>([
  "automatic_review_not_authorized",
  "reviewer_binding_missing",
  "host_invalid",
  "registry_unavailable",
  "client_context_unavailable",
  "launcher_unavailable",
  "capability_denied",
  "reviewer_output_unconstrained",
]);

export function isSchemaVersion(value: unknown): value is typeof SCHEMA_VERSION {
  return value === SCHEMA_VERSION && Number.isInteger(value);
}

export function isRegistrySchemaVersion(value: unknown): value is typeof REGISTRY_SCHEMA_VERSION {
  return value === REGISTRY_SCHEMA_VERSION && Number.isInteger(value);
}

export function rfc3339Utc(date: Date): string {
  return date.toISOString();
}

export function emptyHashes(): ArtifactHashes {
  return { task: null, agents: null };
}
