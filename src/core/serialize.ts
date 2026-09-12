import { createHash } from "node:crypto";
import {
  isAdapterFailureCause,
  isAdapterFailurePhase,
  isDeclarationInvalidDetail,
  isFiniteIntegerExitCode,
  isProducerDiagnosticStage,
  isProducerSnapshotCap,
  isProducerSnapshotSite,
  isProducerWriteScopeFailure,
  isTaskWriteRejectionCause,
  type AdapterFailureRecord,
  type ArtifactHashes,
  type EventDocument,
  type ProducerDiagnostic,
  type ProducerIdentity,
  type ResolvedPolicy,
  type ReviewChainRecord,
  type ReviewerWriteRecord,
  type StatusDocument,
  type TransitionEventDocument,
  type TransitionStatusDocument,
} from "./contracts.ts";
import { boundProducerRefusedPaths } from "./producer-refused-paths.ts";

export function sha256Bytes(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function canonicalPolicyJson(policy: ResolvedPolicy): string {
  return JSON.stringify({
    schema_version: policy.schema_version,
    review_kind: policy.review_kind,
    host: policy.host,
    client_context: policy.client_context,
    model: policy.model,
    effort: policy.effort,
    launcher_id: policy.launcher_id,
    automatic_review_authorized: policy.automatic_review_authorized,
    task_artifact_write_authorized: policy.task_artifact_write_authorized,
    producer_chain_authorized: policy.producer_chain_authorized,
    max_review_cycles: policy.max_review_cycles,
    permission_mode: policy.permission_mode,
  });
}

export function policyDigest(policy: ResolvedPolicy): string {
  return sha256Bytes(canonicalPolicyJson(policy));
}

export function serializeArtifactHashes(hashes: ArtifactHashes): ArtifactHashes {
  return { task: hashes.task, agents: hashes.agents };
}

export function serializeStatus(status: StatusDocument): string {
  return `${JSON.stringify({
    schema_version: status.schema_version,
    run_id: status.run_id,
    state: status.state,
    review_kind: status.review_kind,
    task_path: status.task_path,
    host: status.host,
    client_context: status.client_context,
    model: status.model,
    effort: status.effort,
    model_observed: status.model_observed,
    policy_digest: status.policy_digest,
    artifact_hashes: serializeArtifactHashes(status.artifact_hashes),
    execution_id: status.execution_id,
    verdict: status.verdict,
    reason_code: status.reason_code,
    task_write_state: status.task_write_state,
    task_hash_after_write: status.task_hash_after_write,
    task_write_rejection_cause: isTaskWriteRejectionCause(status.task_write_rejection_cause)
      ? status.task_write_rejection_cause
      : null,
    review_verdict_log: typeof status.review_verdict_log === "string" ? status.review_verdict_log : null,
    reviewer_write: serializeReviewerWrite(status.reviewer_write),
    adapter_failure: serializeAdapterFailure(status.adapter_failure),
    pre_dispatch_diagnostic:
      typeof status.pre_dispatch_diagnostic === "string" ? status.pre_dispatch_diagnostic : null,
    producer_identity: serializeProducerIdentity(status.producer_identity),
    review_chain: serializeReviewChain(status.review_chain),
    transition_id: status.transition_id,
    created_at: status.created_at,
    updated_at: status.updated_at,
  })}\n`;
}

export function serializeEvent(event: EventDocument): string {
  return `${JSON.stringify({
    schema_version: event.schema_version,
    sequence: event.sequence,
    timestamp: event.timestamp,
    run_id: event.run_id,
    type: event.type,
    state: event.state,
    review_kind: event.review_kind,
    policy_digest: event.policy_digest,
    artifact_hashes: serializeArtifactHashes(event.artifact_hashes),
    execution_id: event.execution_id,
    verdict: event.verdict,
    reason_code: event.reason_code,
    task_write_state: event.task_write_state,
    task_hash_after_write: event.task_hash_after_write,
    task_write_rejection_cause: isTaskWriteRejectionCause(event.task_write_rejection_cause)
      ? event.task_write_rejection_cause
      : null,
    pre_dispatch_diagnostic:
      typeof event.pre_dispatch_diagnostic === "string" ? event.pre_dispatch_diagnostic : null,
  })}\n`;
}

function serializeAdapterFailure(record: AdapterFailureRecord | null): AdapterFailureRecord | null {
  if (record === null) {
    return null;
  }
  return {
    phase: record.phase,
    cause: record.cause,
    exit_code: record.exit_code,
    signal: typeof record.signal === "string" && record.signal.length > 0 ? record.signal : null,
    http_status:
      typeof record.http_status === "number" && Number.isInteger(record.http_status) && Number.isFinite(record.http_status)
        ? record.http_status
        : null,
    stderr_bytes: record.stderr_bytes,
    stderr_log: record.stderr_log,
    payload_log: record.payload_log,
    output_excerpt_bytes:
      typeof record.output_excerpt_bytes === "number" && Number.isInteger(record.output_excerpt_bytes)
        ? record.output_excerpt_bytes
        : 0,
    output_excerpt: typeof record.output_excerpt === "string" ? record.output_excerpt : null,
  };
}

// Defense in depth for D4: even if an out-of-domain value somehow reached
// this boundary (bypassing the closed `buildProducerDiagnostic` constructor),
// only the exact whitelisted keys are ever copied, and any value outside
// its closed enum, the integer-or-null exit domain, or the boolean timeout
// domain is nulled or normalized rather than passed through.
function serializeProducerDiagnostic(record: ProducerDiagnostic | null): ProducerDiagnostic | null {
  if (record === null || !isProducerDiagnosticStage(record.stage)) {
    return null;
  }
  const waitedMs =
    typeof record.waited_ms === "number" && Number.isInteger(record.waited_ms) && record.waited_ms > 0
      ? record.waited_ms
      : null;
  return {
    stage: record.stage,
    exit_code: isFiniteIntegerExitCode(record.exit_code) ? record.exit_code : null,
    timed_out: record.timed_out === true,
    write_scope_code: isProducerWriteScopeFailure(record.write_scope_code) ? record.write_scope_code : null,
    adapter_phase: isAdapterFailurePhase(record.adapter_phase) ? record.adapter_phase : null,
    adapter_cause: isAdapterFailureCause(record.adapter_cause) ? record.adapter_cause : null,
    waited_ms: waitedMs,
    snapshot_site: isProducerSnapshotSite(record.snapshot_site) ? record.snapshot_site : null,
    snapshot_cap: isProducerSnapshotCap(record.snapshot_cap) ? record.snapshot_cap : null,
  };
}

function serializeProducerIdentity(identity: ProducerIdentity | null): ProducerIdentity | null {
  if (identity === null) {
    return null;
  }
  return {
    role: identity.role,
    host: identity.host,
  };
}

function serializeReviewChain(record: ReviewChainRecord | null): ReviewChainRecord | null {
  if (record === null) {
    return null;
  }
  return {
    after_run_id: record.after_run_id,
    cycle: record.cycle,
    max_cycles: record.max_cycles,
    refused: record.refused,
  };
}

function serializeReviewerWrite(record: ReviewerWriteRecord | null): ReviewerWriteRecord | null {
  if (record === null) {
    return null;
  }
  return {
    comparison: record.comparison,
    entries: record.entries.map((entry) => ({
      path: entry.path,
      change: entry.change,
      fields: [...entry.fields],
    })),
  };
}

export function parseStatusJson(text: string): StatusDocument {
  return JSON.parse(text) as StatusDocument;
}

export function serializeTransitionStatus(status: TransitionStatusDocument): string {
  return `${JSON.stringify({
    schema_version: status.schema_version,
    document: "transition",
    transition_id: status.transition_id,
    state: status.state,
    parent_run_id: status.parent_run_id,
    task_path: status.task_path,
    approved_task_hash: status.approved_task_hash,
    policy_digest: status.policy_digest,
    implementer_host: status.implementer_host,
    implementer_launcher_id: status.implementer_launcher_id,
    lock_identity: status.lock_identity,
    reason_code: status.reason_code,
    producer_diagnostic: serializeProducerDiagnostic(status.producer_diagnostic),
    unwritable_plan_targets: serializeUnwritablePlanTargets(status.unwritable_plan_targets),
    producer_refused_paths: serializeProducerRefusedPaths(status.producer_refused_paths),
    declaration_invalid_detail: serializeDeclarationInvalidDetail(status.declaration_invalid_detail),
    current_review_run_id: status.current_review_run_id,
    linked_review_run_ids: [...status.linked_review_run_ids],
    created_at: status.created_at,
    updated_at: status.updated_at,
  })}\n`;
}

export function serializeTransitionEvent(event: TransitionEventDocument): string {
  return `${JSON.stringify({
    schema_version: event.schema_version,
    sequence: event.sequence,
    timestamp: event.timestamp,
    transition_id: event.transition_id,
    type: event.type,
    state: event.state,
    reason_code: event.reason_code,
    producer_diagnostic: serializeProducerDiagnostic(event.producer_diagnostic),
    unwritable_plan_targets: serializeUnwritablePlanTargets(event.unwritable_plan_targets),
    producer_refused_paths: serializeProducerRefusedPaths(event.producer_refused_paths),
    declaration_invalid_detail: serializeDeclarationInvalidDetail(event.declaration_invalid_detail),
    review_run_id: event.review_run_id,
  })}\n`;
}

export function parseTransitionStatusJson(text: string): TransitionStatusDocument {
  const parsed = JSON.parse(text) as TransitionStatusDocument;
  const diagnostic = parsed.producer_diagnostic;
  return {
    ...parsed,
    producer_diagnostic: diagnostic === null || diagnostic === undefined
      ? null
      : {
          ...diagnostic,
          snapshot_site: diagnostic.snapshot_site ?? null,
          snapshot_cap: diagnostic.snapshot_cap ?? null,
        },
    unwritable_plan_targets: serializeUnwritablePlanTargets(parsed.unwritable_plan_targets),
    producer_refused_paths: serializeProducerRefusedPaths(parsed.producer_refused_paths),
    declaration_invalid_detail: serializeDeclarationInvalidDetail(parsed.declaration_invalid_detail),
  };
}

function serializeUnwritablePlanTargets(tokens: string[] | null | undefined): string[] | null {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return null;
  }
  const copied = tokens.filter((token): token is string => typeof token === "string");
  return copied.length === 0 ? null : copied;
}

export function serializeProducerRefusedPaths(tokens: unknown): string[] | null {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return null;
  }
  const copied = tokens.filter((token): token is string => typeof token === "string");
  return copied.length === 0 ? null : boundProducerRefusedPaths(copied);
}

function serializeDeclarationInvalidDetail(value: string | null | undefined): string | null {
  return isDeclarationInvalidDetail(value) ? value : null;
}
