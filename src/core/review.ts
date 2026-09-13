import fs from "node:fs/promises";
import path from "node:path";
import { capabilitiesAllowed, type LauncherCatalog } from "../adapters/adapter.ts";
import {
  AdapterFailureError,
  AdapterIsolationError,
  AdapterTimeoutError,
  ReviewerWriteDetectedError,
} from "../adapters/adapter.ts";
import {
  parseAgentsPolicy,
  implementationReviewAdmission,
  implementationProducerIdentity,
  type AgentsPolicyParse,
} from "../policy/agents-policy.ts";
import {
  loadRegistry,
  RegistryContextIncompleteError,
  RegistrySchemaInvalidError,
  RegistrySensitiveFieldError,
  RegistryUnavailableError,
  resolveLauncherId,
  type RegistrySource,
} from "../policy/registry.ts";
import { parseTaskFrontmatter, resolveReviewKind, TaskFrontmatterInvalidError } from "../policy/task-frontmatter.ts";
import {
  createExclusiveRunDir,
  resolveContainedTaskPath,
  resolveReadableDirectory,
  resolveRuntimeLayout,
  TaskPathInvalidError,
  UnsafeRuntimePathError,
} from "../runtime/paths.ts";
import { appendEvent, isRuntimeRunDirContained, isRuntimeRunId, runDirFor, writeAdapterPayloadAtomic, writeAdapterStderrAtomic, writeReviewAtomic, writeReviewVerdictAtomic, writeStatusAtomic } from "../runtime/store.ts";
import {
  emptyHashes,
  PRE_REVIEW_BLOCKED,
  SCHEMA_VERSION,
  terminalForVerdict,
  type AdapterFailurePhase,
  type AdapterFailureRecord,
  type AdapterReviewInput,
  type ArtifactHashes,
  type BridgeVerdict,
  type CanonicalHost,
  type EffortLevel,
  type EventDocument,
  type EventType,
  type ModelObserved,
  type ProducerIdentity,
  type ProducerSnapshotSite,
  type ReasonCode,
  type ResolvedPolicy,
  type ReviewChainRecord,
  type ReviewChainRefused,
  type ReviewKind,
  type ReviewerWriteRecord,
  type RuntimeBuild,
  type RunState,
  type StatusDocument,
  type TaskWriteRejectionCause,
  type TaskWriteState,
} from "./contracts.ts";
import { rfc3339Utc } from "./contracts.ts";
import { policyDigest, sha256Bytes } from "./serialize.ts";
import { redactAdapterStderr, redactAdapterStderrText, RETAINED_PAYLOAD_CAP_BYTES, RETAINED_PAYLOAD_TRUNCATION_MARKER } from "../policy/redact.ts";
import { posixRel, snapshotDiff, snapshotTree, SnapshotCapError, type TreeSnapshot } from "./snapshot.ts";
import { validateReviewResult } from "./result.ts";
import { checkArtifactWriteShape, COMPOSITION_FAILED_HINTS, describeNextHandoffRejection, planReviewTransitionPrecondition, writeTaskReviewRegion } from "./task-write.ts";
import type { ReviewStreamProgress } from "../adapters/review-stream.ts";

export type Clock = {
  now(): Date;
  createRunId(): string;
  createExecutionId(): string;
  createTransitionId(): string;
};

export type AppDeps = {
  registry: RegistrySource;
  catalog: LauncherCatalog;
  clock: Clock;
  runtimeBuild?: RuntimeBuild | null;
  snapshotCaps?: { entries?: number; hashBytes?: number };
  // Per-site cap overrides make every producer snapshot stop reproducible
  // without changing the production defaults. Repository snapshots retain
  // `snapshotCaps` as their shared fallback.
  producerSnapshotCaps?: Partial<Record<ProducerSnapshotSite, { entries?: number; hashBytes?: number }>>;
  // Deterministic seam for the documented post-productAfter hard-link window.
  afterProducerSnapshots?: () => void | Promise<void>;
  // Deterministic seam for transition-level merge rollback regressions.
  applyProducerMergeDeps?: import("./workspace.ts").ApplyProducerMergeDeps;
};

export type ReviewCommandInput = {
  repo: string;
  task: string;
  after_run?: string;
  transition_id?: string;
  signal?: AbortSignal;
  // Set by `review --detach`: the parent already reserved this id and wrote a
  // `.spartan-bridge/invocations/<id>.json` record, so `wait` can find the chain
  // before this child creates the run directory (task 0055). When omitted, a
  // fresh id is generated as before.
  run_id?: string;
};

export type ReviewOutcome = {
  createdRun: boolean;
  exitCode: 0 | 1;
  status: StatusDocument | null;
  error: string | null;
};

export type ReviewStartedProgress = {
  run_id: string;
  host: CanonicalHost;
  model: string;
  effort: EffortLevel;
  client_context: string;
  runtime_build: RuntimeBuild | null;
  created_at: string;
};

export type ReviewProgress = {
  started(info: ReviewStartedProgress): void;
  stream?(info: ReviewStreamProgress): void;
};

type MutableRun = {
  runDir: string;
  sequence: number;
  status: StatusDocument;
  sealed: boolean;
};

type EmitFields = Partial<
  Pick<
    StatusDocument,
    | "host"
    | "client_context"
    | "model"
    | "effort"
    | "model_observed"
    | "policy_digest"
    | "artifact_hashes"
    | "execution_id"
    | "verdict"
    | "reason_code"
    | "task_write_state"
    | "task_write_rejection_cause"
    | "review_verdict_log"
    | "task_hash_after_write"
    | "reviewer_write"
    | "adapter_failure"
    | "pre_dispatch_diagnostic"
    | "producer_identity"
    | "review_chain"
    | "transition_id"
  >
>;

export function buildResolvedPolicy(
  reviewKind: ReviewKind,
  selected: {
    host: CanonicalHost;
    client_context: string;
    model: string;
    effort: EffortLevel;
  },
  launcherId: string,
  agentsPolicy: Extract<AgentsPolicyParse, { ok: true }>,
): ResolvedPolicy {
  return {
    schema_version: SCHEMA_VERSION,
    review_kind: reviewKind,
    host: selected.host,
    client_context: selected.client_context,
    model: selected.model,
    effort: selected.effort,
    launcher_id: launcherId,
    automatic_review_authorized: true,
    task_artifact_write_authorized: agentsPolicy.task_artifact_write_authorized,
    producer_chain_authorized: agentsPolicy.producer_chain_authorized,
    max_review_cycles:
      reviewKind === "implementation"
        ? (agentsPolicy.max_implementation_review_cycles ?? agentsPolicy.max_review_cycles)
        : agentsPolicy.max_review_cycles,
    permission_mode: "read-only",
  };
}

export async function runReview(
  input: ReviewCommandInput,
  deps: AppDeps,
  progress?: ReviewProgress,
): Promise<ReviewOutcome> {
  let repoRoot: string;
  try {
    repoRoot = await resolveReadableDirectory(input.repo);
  } catch {
    return noRun("repository root is not an existing readable directory");
  }

  let runsDir: string;
  try {
    ({ runsDir } = await resolveRuntimeLayout(repoRoot));
  } catch (error) {
    if (error instanceof UnsafeRuntimePathError) {
      return noRun("runtime path is not contained in the repository");
    }
    return noRun("runtime path is not contained in the repository");
  }

  const runId = input.run_id ?? deps.clock.createRunId();
  let runDir: string;
  try {
    runDir = await createExclusiveRunDir(runsDir, repoRoot, runId);
  } catch {
    return noRun("runtime path is not contained in the repository");
  }

  const createdAt = rfc3339Utc(deps.clock.now());
  const run: MutableRun = {
    runDir,
    sequence: 0,
    sealed: false,
    status: {
      schema_version: SCHEMA_VERSION,
      run_id: runId,
      state: "requested",
      review_kind: "plan",
      task_path: input.task,
      host: null,
      client_context: null,
      model: null,
      effort: null,
      model_observed: null,
      policy_digest: null,
      runtime_build: deps.runtimeBuild ?? null,
      artifact_hashes: emptyHashes(),
      execution_id: null,
      verdict: null,
      reason_code: null,
      task_write_state: null,
      task_write_rejection_cause: null,
      review_verdict_log: null,
      task_hash_after_write: null,
      reviewer_write: null,
      adapter_failure: null,
      pre_dispatch_diagnostic: null,
      producer_identity: null,
      review_chain: null,
      transition_id: input.transition_id ?? null,
      created_at: createdAt,
      updated_at: createdAt,
    },
  };

  const hashes: ArtifactHashes = emptyHashes();
  let digest: string | null = null;
  let executionId: string | null = null;
  let taskAbs: string;
  let taskBytes: Uint8Array;
  let agentsAbs: string;
  let agentsBytes: Uint8Array;

  try {
    taskAbs = await resolveContainedTaskPath(repoRoot, input.task);
  } catch (error) {
    await emit(run, deps, "run_requested", "requested");
    if (error instanceof TaskPathInvalidError) {
      return terminate(run, deps, "failed", "path_invalid", hashes, null, null, null);
    }
    return terminate(run, deps, "failed", "path_invalid", hashes, null, null, null);
  }

  try {
    taskBytes = new Uint8Array(await fs.readFile(taskAbs));
  } catch {
    await emit(run, deps, "run_requested", "requested");
    return terminate(run, deps, "failed", "task_unreadable", hashes, null, null, null);
  }
  hashes.task = sha256Bytes(taskBytes);
  let currentNextRole: string;
  let reviewKind: ReviewKind;
  try {
    const frontmatter = parseTaskFrontmatter(taskBytes, path.basename(taskAbs));
    currentNextRole = frontmatter.next_role;
    reviewKind = resolveReviewKind(frontmatter);
  } catch (error) {
    await emit(run, deps, "run_requested", "requested");
    const diagnostic = error instanceof TaskFrontmatterInvalidError ? error.detail : null;
    return terminate(run, deps, "failed", "task_invalid", hashes, null, null, null, null, null, null, null, null, null, diagnostic);
  }
  run.status = { ...run.status, review_kind: reviewKind };
  await emit(run, deps, "run_requested", "requested");

  agentsAbs = path.join(repoRoot, "AGENTS.md");
  try {
    agentsBytes = new Uint8Array(await fs.readFile(agentsAbs));
  } catch {
    return terminate(run, deps, "failed", "agents_unreadable", hashes, null, null, null);
  }
  hashes.agents = sha256Bytes(agentsBytes);
  let agentsText: string;
  try {
    agentsText = new TextDecoder("utf-8", { fatal: true }).decode(agentsBytes);
  } catch {
    return terminate(run, deps, "failed", "agents_policy_invalid", hashes, null, null, null);
  }
  const agentsPolicy = parseAgentsPolicy(agentsText);
  if (!agentsPolicy.ok) {
    const state = agentsPolicy.reason === "agents_policy_invalid" ? "failed" : "blocked";
    return terminate(run, deps, state, agentsPolicy.reason, hashes, null, null, null);
  }

  let selectedHost = agentsPolicy.host;
  let selectedContext = agentsPolicy.client_context;
  let selectedModel = agentsPolicy.model;
  let selectedEffort = agentsPolicy.effort;
  let implementationScope: readonly string[] = [];
  let producerIdentity: ProducerIdentity | null = null;
  if (reviewKind === "implementation") {
    const admission = implementationReviewAdmission(agentsPolicy);
    if (!admission.ok) {
      return terminate(run, deps, "blocked", admission.reason, hashes, null, null, null);
    }
    selectedHost = admission.binding.host;
    selectedContext = admission.binding.client_context;
    selectedModel = admission.binding.model;
    selectedEffort = admission.binding.effort;
    implementationScope = admission.scope;
    const producer = implementationProducerIdentity(agentsPolicy);
    if (!producer.ok) {
      return terminate(run, deps, "blocked", producer.reason, hashes, null, null, null);
    }
    producerIdentity = producer.identity;
  }

  let registry;
  try {
    registry = await loadRegistry(deps.registry);
  } catch (error) {
    if (error instanceof RegistrySensitiveFieldError) {
      return terminate(run, deps, "failed", "registry_sensitive_field", hashes, null, null, null);
    }
    if (error instanceof RegistrySchemaInvalidError) {
      return terminate(run, deps, "failed", "registry_schema_invalid", hashes, null, null, null);
    }
    if (error instanceof RegistryContextIncompleteError) {
      return terminate(run, deps, "failed", "registry_context_incomplete", hashes, null, null, null);
    }
    if (error instanceof RegistryUnavailableError) {
      return terminate(run, deps, "blocked", "registry_unavailable", hashes, null, null, null);
    }
    return terminate(run, deps, "blocked", "registry_unavailable", hashes, null, null, null);
  }

  let launcherId: string;
  try {
    launcherId = resolveLauncherId(registry, selectedContext, selectedHost);
  } catch (error) {
    if (error instanceof RegistryContextIncompleteError) {
      return terminate(run, deps, "failed", "registry_context_incomplete", hashes, null, null, null);
    }
    return terminate(run, deps, "blocked", "client_context_unavailable", hashes, null, null, null);
  }

  const resolvedPolicy = buildResolvedPolicy(
    reviewKind,
    {
      host: selectedHost,
      client_context: selectedContext,
      model: selectedModel,
      effort: selectedEffort,
    },
    launcherId,
    agentsPolicy,
  );
  digest = policyDigest(resolvedPolicy);
  const chain = await resolveReviewChain({
    afterRun: input.after_run,
    authorized:
      resolvedPolicy.producer_chain_authorized ||
      (reviewKind === "implementation" && agentsPolicy.automatic_correction_review_authorized),
    maxCycles: resolvedPolicy.max_review_cycles,
    repoRoot,
    taskPath: input.task,
    hashes,
    reviewKind,
    host: selectedHost,
    producerIdentity,
  });
  await emit(run, deps, "policy_resolved", "policy_resolved", {
    policy_digest: digest,
    artifact_hashes: { ...hashes },
    host: resolvedPolicy.host,
    client_context: resolvedPolicy.client_context,
    model: resolvedPolicy.model,
    effort: resolvedPolicy.effort,
    producer_identity: producerIdentity,
    review_chain: chain.record,
  });
  if (chain.stop !== undefined) {
    return terminate(run, deps, chain.stop.state, chain.stop.reason, hashes, digest, null, null);
  }

  if (resolvedPolicy.task_artifact_write_authorized) {
    const precondition = planReviewTransitionPrecondition({
      reviewKind: resolvedPolicy.review_kind,
      currentNextRole,
    });
    if (!precondition.ok) {
      return terminate(run, deps, "human_required", precondition.reason, hashes, digest, null, null, "rejected");
    }
    // D1/D2 (task 0046): apply the verdict-independent write-shape predicates
    // before the adapter is constructed. A certain-to-fail composition
    // (`## Next Handoff` not retractable for the outstanding id, or `## Review`
    // in an unrecognised placeholder/region shape) is refused here — no
    // reviewer execution, no cycle, and no `task_write_state` written.
    const taskText = new TextDecoder("utf-8").decode(taskBytes);
    const shape = checkArtifactWriteShape(taskText, reviewKind);
    if (!shape.ok) {
      let hint: string = COMPOSITION_FAILED_HINTS[shape.detail];
      if (shape.detail === "next_handoff_not_retractable") {
        const slug = describeNextHandoffRejection(taskText, reviewKind);
        if (slug !== null) {
          hint = `${hint} [${slug}]${slug === "trailing_content" ? ": remove the blank line(s) after the closing fence" : ""}`;
        }
      }
      return terminate(
        run,
        deps,
        "human_required",
        "task_artifact_write_rejected",
        hashes,
        digest,
        null,
        null,
        null,
        null,
        null,
        null,
        shape.cause,
        null,
        hint,
      );
    }
  }

  let adapter;
  try {
    adapter = deps.catalog.resolve(launcherId);
  } catch {
    return terminate(run, deps, "blocked", "launcher_unavailable", hashes, digest, null, null);
  }
  const capabilities = adapter.capabilities();
  if (!capabilitiesAllowed(capabilities) || capabilities.launcher_id !== launcherId) {
    return terminate(run, deps, "blocked", "capability_denied", hashes, digest, null, null);
  }
  if (!capabilities.review_kinds.includes(reviewKind)) {
    return terminate(run, deps, "blocked", "capability_denied", hashes, digest, null, null);
  }
  // A reviewer whose CLI cannot force the final message to the verdict schema
  // (today only Cursor, D-043) is refused here — before preflight, before any
  // child spawn, before a cycle is spent.
  if (!capabilities.structured_output) {
    return terminate(run, deps, "blocked", "reviewer_output_unconstrained", hashes, digest, null, null);
  }
  try {
    await adapter.preflight();
  } catch (error) {
    const adapterFailure = await persistAdapterFailure(run.runDir, error, "preflight");
    if (
      error instanceof AdapterIsolationError ||
      error instanceof AdapterTimeoutError ||
      error instanceof ReviewerWriteDetectedError
    ) {
      return terminate(run, deps, "failed", "adapter_error", hashes, digest, null, null, null, null, null, adapterFailure);
    }
    return terminate(run, deps, "blocked", "capability_denied", hashes, digest, null, null, null, null, null, adapterFailure);
  }

  // The repository-worktree diff below is defence in depth against a reviewer
  // that escaped its workspace and wrote the real repo. Every real reviewer
  // adapter runs isolated (`cwd` a prepared directory, not `repo_root`) and its
  // own `verify()` compares that workspace (`reviewer_workspace`), so for an
  // isolated adapter this diff can only ever attribute a concurrent external
  // write — a launcher log, a sibling session's commit — to the reviewer
  // (task 0051 / D-052). Skip it, and the baseline it needs, in that case.
  let baseline: TreeSnapshot | null = null;
  if (!capabilities.isolated_workspace) {
    try {
      baseline = await snapshotTree(repoRoot, deps.snapshotCaps);
    } catch {
      return terminate(run, deps, "failed", "reviewer_isolation_unavailable", hashes, digest, null, null);
    }
  }

  executionId = deps.clock.createExecutionId();
  const adapterInput: AdapterReviewInput = {
    execution_id: executionId,
    review_kind: reviewKind,
    permission_mode: "read-only",
    repo_root: repoRoot,
    run_dir: run.runDir,
    task_path: input.task,
    task_content: new TextDecoder("utf-8").decode(taskBytes),
    task_hash: hashes.task ?? "",
    agents_content: agentsText,
    agents_hash: hashes.agents ?? "",
    policy_digest: digest,
    model: resolvedPolicy.model,
    effort: resolvedPolicy.effort,
    implementation_review_scope: implementationScope,
  };

  let prepareInvoked = false;
  let startInvoked = false;
  let failed = false;
  let rawResult: unknown;

  try {
    prepareInvoked = true;
    try {
      await adapter.prepare(adapterInput);
    } catch (error) {
      failed = true;
      const mapped = mapPrepareError(error);
      const adapterFailure = await persistAdapterFailure(run.runDir, error, "prepare");
      return terminate(run, deps, mapped.state, mapped.reason, hashes, digest, null, null, null, null, null, adapterFailure);
    }

    await emit(run, deps, "review_started", "reviewing", {
      policy_digest: digest,
      artifact_hashes: { ...hashes },
      execution_id: executionId,
    });
    progress?.started({
      run_id: run.status.run_id,
      host: resolvedPolicy.host,
      model: resolvedPolicy.model,
      effort: resolvedPolicy.effort,
      client_context: resolvedPolicy.client_context,
      runtime_build: deps.runtimeBuild ?? null,
      created_at: run.status.created_at,
    });
    if (progress?.stream !== undefined) {
      adapter.observeStream?.(progress.stream);
    }

    startInvoked = true;
    const abort = (): void => {
      void adapter.cancel();
    };
    if (input.signal?.aborted) {
      abort();
    }
    input.signal?.addEventListener("abort", abort, { once: true });
    let startCollectHook: AdapterFailurePhase = "start";
    try {
      await adapter.start(adapterInput);
      startCollectHook = "collect";
      rawResult = await adapter.collect();
    } catch (error) {
      failed = true;
      const mapped = mapStartCollectError(error);
      const adapterFailure = await persistAdapterFailure(run.runDir, error, startCollectHook);
      return terminate(run, deps, mapped.state, mapped.reason, hashes, digest, executionId, null, null, null, null, adapterFailure);
    } finally {
      input.signal?.removeEventListener("abort", abort);
    }

    try {
      await adapter.verify();
    } catch (error) {
      failed = true;
      const mapped = mapVerifyError(error);
      const adapterFailure = await persistAdapterFailure(run.runDir, error, "verify");
      return terminate(
        run,
        deps,
        mapped.state,
        mapped.reason,
        hashes,
        digest,
        executionId,
        null,
        null,
        null,
        mapped.reviewer_write,
        adapterFailure,
      );
    }

    if (!capabilities.isolated_workspace && baseline) {
      try {
        const after = await snapshotTree(repoRoot, deps.snapshotCaps);
        const excluded = new Set<string>([posixRel(repoRoot, taskAbs), posixRel(repoRoot, agentsAbs)]);
        const entries = snapshotDiff(baseline, after, excluded);
        if (entries.length > 0) {
          failed = true;
          return terminate(
            run,
            deps,
            "blocked",
            "reviewer_write_detected",
            hashes,
            digest,
            executionId,
            null,
            null,
            null,
            { comparison: "repository_worktree", entries },
          );
        }
      } catch (error) {
        failed = true;
        if (error instanceof SnapshotCapError) {
          return terminate(run, deps, "failed", "reviewer_isolation_unavailable", hashes, digest, executionId, null);
        }
        return terminate(run, deps, "failed", "adapter_error", hashes, digest, executionId, null, null, null, null, runtimeFailure("post_review_snapshot"));
      }
    }

    try {
      const taskNow = new Uint8Array(await fs.readFile(taskAbs));
      const agentsNow = new Uint8Array(await fs.readFile(agentsAbs));
      if (sha256Bytes(taskNow) !== hashes.task || sha256Bytes(agentsNow) !== hashes.agents) {
        failed = true;
        return terminate(run, deps, "failed", "integrity_mismatch", hashes, digest, executionId, null);
      }
      if (policyDigest(resolvedPolicy) !== digest) {
        failed = true;
        return terminate(run, deps, "failed", "integrity_mismatch", hashes, digest, executionId, null);
      }
    } catch {
      failed = true;
      return terminate(run, deps, "failed", "integrity_mismatch", hashes, digest, executionId, null);
    }

    const compared = compareObservedModel(resolvedPolicy.model, adapter.observedModel());
    if (compared === "mismatch") {
      failed = true;
      return terminate(run, deps, "failed", "model_mismatch", hashes, digest, executionId, null);
    }
    run.status = { ...run.status, model_observed: compared };

    let result;
    try {
      result = validateReviewResult(rawResult, reviewKind);
    } catch {
      failed = true;
      return terminate(run, deps, "failed", "result_schema_invalid", hashes, digest, executionId, null);
    }

    try {
      await writeReviewAtomic(run.runDir, executionId, result);
    } catch {
      failed = true;
      return terminate(run, deps, "failed", "adapter_error", hashes, digest, executionId, null, null, null, null, runtimeFailure("persist_result"));
    }

    const mapped = terminalForVerdict(result.verdict, reviewKind);
    await emit(run, deps, "review_result_accepted", mapped.state, {
      policy_digest: digest,
      artifact_hashes: { ...hashes },
      execution_id: executionId,
      verdict: result.verdict,
      reason_code: mapped.reason_code,
      task_write_state: null,
      task_hash_after_write: null,
    });

    let taskWriteState: TaskWriteState = "not_authorized";
    let hashAfter: string | null = null;
    if (result.verdict === "human_required" || result.verdict === "blocked") {
      taskWriteState = "skipped_human_gate";
    } else if (resolvedPolicy.task_artifact_write_authorized) {
      const written = await writeTaskReviewRegion({
        taskAbs,
        expectedHash: hashes.task ?? "",
        result,
        meta: {
          run_id: run.status.run_id,
          execution_id: executionId,
          review_kind: reviewKind,
          verdict: result.verdict,
          reason_code: mapped.reason_code,
          host: resolvedPolicy.host,
          launcher_id: resolvedPolicy.launcher_id,
          model: resolvedPolicy.model,
          effort: resolvedPolicy.effort,
          model_observed: compared,
          policy_digest: digest,
          emitting_build: deps.runtimeBuild ?? null,
          task_hash: hashes.task ?? "",
          agents_hash: hashes.agents ?? "",
          timestamp: rfc3339Utc(deps.clock.now()),
        },
      });
      if (!written.ok) {
        failed = true;
        const cause = "cause" in written ? written.cause : null;
        // D4: a post-write rejection got past the D1/D2 pre-dispatch gate, so a
        // real reviewer already ran. Retain the accepted verdict for recovery.
        let reviewVerdictLog: string | null = null;
        try {
          ({ review_verdict_log: reviewVerdictLog } = await writeReviewVerdictAtomic(run.runDir, result));
        } catch {
          reviewVerdictLog = null;
        }
        return terminate(
          run,
          deps,
          "human_required",
          written.reason,
          hashes,
          digest,
          executionId,
          result.verdict,
          "rejected",
          null,
          null,
          null,
          cause,
          reviewVerdictLog,
        );
      }
      taskWriteState = "written";
      hashAfter = written.hashAfter;
      await emit(run, deps, "task_artifact_written", mapped.state, {
        policy_digest: digest,
        artifact_hashes: { ...hashes },
        execution_id: executionId,
        verdict: result.verdict,
        reason_code: mapped.reason_code,
        task_write_state: "written",
        task_hash_after_write: hashAfter,
      });
    }

    return terminate(
      run,
      deps,
      mapped.state,
      mapped.reason_code,
      hashes,
      digest,
      executionId,
      result.verdict,
      taskWriteState,
      hashAfter,
    );
  } finally {
    if (prepareInvoked) {
      if (startInvoked && failed) {
        try {
          await adapter.cancel();
        } catch {
          // cancel is best-effort
        }
      }
      try {
        await adapter.cleanup();
      } catch {
        // cleanup is best-effort
      }
    }
  }
}

function runtimeFailure(phase: "post_review_snapshot" | "persist_result"): AdapterFailureRecord {
  return {
    phase,
    cause: "runtime_error",
    exit_code: null,
    signal: null,
    http_status: null,
    stderr_bytes: 0,
    stderr_log: null,
    payload_log: null,
    output_excerpt_bytes: 0,
    output_excerpt: null,
  };
}

export const OUTPUT_EXCERPT_CAP_BYTES = 512;

export function buildAdapterOutputExcerpt(
  phase: AdapterFailurePhase,
  stderr: Buffer,
  output: Buffer,
  payload: string | null,
): { output_excerpt: string | null; output_excerpt_bytes: number } {
  if (phase === "collect" && payload !== null) {
    return { output_excerpt: null, output_excerpt_bytes: 0 };
  }
  const source = phase === "collect" ? (stderr.length > 0 ? stderr : output) : output;
  if (source.length === 0) {
    return { output_excerpt: null, output_excerpt_bytes: 0 };
  }
  const redacted = redactAdapterStderrText(source.toString("utf8"));
  const bytes = Buffer.from(redacted, "utf8");
  const capped =
    bytes.length > OUTPUT_EXCERPT_CAP_BYTES
      ? bytes.subarray(bytes.length - OUTPUT_EXCERPT_CAP_BYTES)
      : bytes;
  const text = capped.toString("utf8");
  if (text.length === 0) {
    return { output_excerpt: null, output_excerpt_bytes: 0 };
  }
  return { output_excerpt: text, output_excerpt_bytes: Buffer.byteLength(text, "utf8") };
}

function composeRetainedPayload(text: string): Buffer {
  const redacted = redactAdapterStderrText(text);
  const bytes = Buffer.from(redacted, "utf8");
  if (bytes.length <= RETAINED_PAYLOAD_CAP_BYTES) {
    return bytes;
  }
  const marker = Buffer.from(`${RETAINED_PAYLOAD_TRUNCATION_MARKER}\n`, "utf8");
  const tail = bytes.subarray(bytes.length - RETAINED_PAYLOAD_CAP_BYTES);
  return Buffer.concat([marker, tail]);
}

async function persistAdapterFailure(
  runDir: string,
  error: unknown,
  phase: AdapterFailurePhase,
): Promise<AdapterFailureRecord> {
  const carried = carriedFailure(error);
  const observation = carried?.record ?? {
    phase,
    cause: "unexpected_error" as const,
    exit_code: null,
    signal: null,
    http_status: null,
    stderr_bytes: 0,
    stderr_log: null,
    payload_log: null,
    output_excerpt_bytes: 0,
    output_excerpt: null,
  };
  const payload = redactAdapterStderr(carried?.stderr ?? Buffer.alloc(0));
  let written: { stderr_log: string | null; stderr_bytes: number };
  try {
    written = await writeAdapterStderrAtomic(runDir, payload);
  } catch {
    written = { stderr_log: null, stderr_bytes: 0 };
  }
  let payloadWritten: { payload_log: string | null } = { payload_log: null };
  const candidate = carried?.payload;
  if (typeof candidate === "string" && candidate.length > 0) {
    try {
      payloadWritten = await writeAdapterPayloadAtomic(runDir, composeRetainedPayload(candidate));
    } catch {
      payloadWritten = { payload_log: null };
    }
  }
  const excerpt = buildAdapterOutputExcerpt(
    observation.phase,
    carried?.stderr ?? Buffer.alloc(0),
    carried?.output ?? Buffer.alloc(0),
    carried?.payload ?? null,
  );
  return {
    phase: observation.phase,
    cause: observation.cause,
    exit_code: observation.exit_code,
    signal:
      typeof observation.signal === "string" && observation.signal.length > 0 ? observation.signal : null,
    http_status:
      typeof observation.http_status === "number" &&
      Number.isInteger(observation.http_status) &&
      Number.isFinite(observation.http_status)
        ? observation.http_status
        : null,
    stderr_bytes: written.stderr_bytes,
    stderr_log: written.stderr_log,
    payload_log: payloadWritten.payload_log,
    output_excerpt_bytes: excerpt.output_excerpt_bytes,
    output_excerpt: excerpt.output_excerpt,
  };
}

function carriedFailure(
  error: unknown,
): { record: AdapterFailureRecord; stderr: Buffer; output: Buffer; payload: string | null } | null {
  if (error instanceof AdapterFailureError) {
    return { record: error.adapterFailure, stderr: error.stderr, output: error.output, payload: error.payload };
  }
  if (error instanceof AdapterTimeoutError && error.adapterFailure !== null) {
    return { record: error.adapterFailure, stderr: error.stderr, output: error.stderr, payload: null };
  }
  return null;
}

function compareObservedModel(declared: string, observed: string | null): ModelObserved | "mismatch" {
  if (observed === null) {
    return "declared_unobserved";
  }
  if (observed.trim().toLowerCase() === declared.trim().toLowerCase()) {
    return "observed";
  }
  return "mismatch";
}

function mapPrepareError(error: unknown): { state: RunState; reason: ReasonCode } {
  if (error instanceof AdapterIsolationError) {
    return { state: "failed", reason: "reviewer_isolation_unavailable" };
  }
  return { state: "failed", reason: "adapter_error" };
}

function mapStartCollectError(error: unknown): { state: RunState; reason: ReasonCode } {
  if (error instanceof AdapterTimeoutError) {
    return { state: "failed", reason: "adapter_timeout" };
  }
  return { state: "failed", reason: "adapter_error" };
}

function mapVerifyError(
  error: unknown,
): { state: RunState; reason: ReasonCode; reviewer_write: ReviewerWriteRecord | null } {
  if (error instanceof ReviewerWriteDetectedError) {
    return {
      state: "blocked",
      reason: "reviewer_write_detected",
      reviewer_write: { comparison: error.comparison, entries: error.entries },
    };
  }
  return { state: "failed", reason: "adapter_error", reviewer_write: null };
}

function noRun(error: string): ReviewOutcome {
  return { createdRun: false, exitCode: 1, status: null, error };
}

async function terminate(
  run: MutableRun,
  deps: AppDeps,
  state: RunState,
  reason: ReasonCode,
  hashes: ArtifactHashes,
  policyDigestValue: string | null,
  executionId: string | null,
  verdict: BridgeVerdict | null,
  taskWriteState: TaskWriteState | null = null,
  taskHashAfterWrite: string | null = null,
  reviewerWrite: ReviewerWriteRecord | null = null,
  adapterFailure: AdapterFailureRecord | null = null,
  taskWriteRejectionCause: TaskWriteRejectionCause | null = null,
  reviewVerdictLog: string | null = null,
  preDispatchDiagnostic: string | null = null,
): Promise<ReviewOutcome> {
  await emit(run, deps, "run_terminal", state, {
    policy_digest: policyDigestValue,
    artifact_hashes: { ...hashes },
    execution_id: executionId,
    verdict,
    reason_code: reason,
    task_write_state: taskWriteState,
    task_write_rejection_cause: taskWriteRejectionCause,
    review_verdict_log: reviewVerdictLog,
    task_hash_after_write: taskHashAfterWrite,
    reviewer_write: reviewerWrite,
    adapter_failure: adapterFailure,
    pre_dispatch_diagnostic: preDispatchDiagnostic,
  });
  run.sealed = true;
  const successVerdict = reason.startsWith("review_");
  return {
    createdRun: true,
    exitCode: successVerdict ? 0 : 1,
    status: run.status,
    error: null,
  };
}

async function emit(run: MutableRun, deps: AppDeps, type: EventType, state: RunState, fields?: EmitFields): Promise<void> {
  if (run.sealed) {
    throw new Error("run_sealed");
  }
  const timestamp = rfc3339Utc(deps.clock.now());
  run.status = {
    ...run.status,
    state,
    updated_at: timestamp,
    host: fields?.host ?? run.status.host,
    client_context: fields?.client_context ?? run.status.client_context,
    model: fields?.model ?? run.status.model,
    effort: fields?.effort ?? run.status.effort,
    model_observed: fields?.model_observed ?? run.status.model_observed,
    policy_digest: fields?.policy_digest ?? run.status.policy_digest,
    artifact_hashes: fields?.artifact_hashes ?? run.status.artifact_hashes,
    execution_id: fields?.execution_id ?? run.status.execution_id,
    verdict: fields?.verdict !== undefined ? fields.verdict : run.status.verdict,
    reason_code: fields?.reason_code !== undefined ? fields.reason_code : run.status.reason_code,
    task_write_state:
      fields?.task_write_state !== undefined ? fields.task_write_state : run.status.task_write_state,
    task_write_rejection_cause:
      fields?.task_write_rejection_cause !== undefined
        ? fields.task_write_rejection_cause
        : run.status.task_write_rejection_cause,
    review_verdict_log:
      fields?.review_verdict_log !== undefined ? fields.review_verdict_log : run.status.review_verdict_log,
    task_hash_after_write:
      fields?.task_hash_after_write !== undefined ? fields.task_hash_after_write : run.status.task_hash_after_write,
    reviewer_write: fields?.reviewer_write !== undefined ? fields.reviewer_write : run.status.reviewer_write,
    adapter_failure: fields?.adapter_failure !== undefined ? fields.adapter_failure : run.status.adapter_failure,
    pre_dispatch_diagnostic:
      fields?.pre_dispatch_diagnostic !== undefined
        ? fields.pre_dispatch_diagnostic
        : run.status.pre_dispatch_diagnostic,
    producer_identity: fields?.producer_identity !== undefined ? fields.producer_identity : run.status.producer_identity,
    review_chain: fields?.review_chain !== undefined ? fields.review_chain : run.status.review_chain,
    transition_id: fields?.transition_id !== undefined ? fields.transition_id : run.status.transition_id,
  };
  await writeStatusAtomic(run.runDir, run.status);
  run.sequence += 1;
  const event: EventDocument = {
    schema_version: SCHEMA_VERSION,
    sequence: run.sequence,
    timestamp,
    run_id: run.status.run_id,
    type,
    state,
    review_kind: run.status.review_kind,
    emitting_build: deps.runtimeBuild ?? null,
    policy_digest: run.status.policy_digest,
    artifact_hashes: { ...run.status.artifact_hashes },
    execution_id: run.status.execution_id,
    verdict: run.status.verdict,
    reason_code: run.status.reason_code,
    task_write_state: run.status.task_write_state,
    task_hash_after_write: run.status.task_hash_after_write,
    task_write_rejection_cause: run.status.task_write_rejection_cause,
    pre_dispatch_diagnostic: run.status.pre_dispatch_diagnostic,
  };
  await appendEvent(run.runDir, event);
}

export function isPolicyBlockedReason(reason: ReasonCode): boolean {
  return PRE_REVIEW_BLOCKED.has(reason);
}

type ChainResolution = {
  record: ReviewChainRecord;
  stop?: { state: RunState; reason: ReasonCode };
};

type ResolveReviewChainInput = {
  afterRun: string | undefined;
  authorized: boolean;
  maxCycles: 1 | 2 | 3;
  repoRoot: string;
  taskPath: string;
  hashes: ArtifactHashes;
  reviewKind: ReviewKind;
  host: CanonicalHost;
  producerIdentity: ProducerIdentity | null;
};

async function resolveReviewChain(input: ResolveReviewChainInput): Promise<ChainResolution> {
  if (input.afterRun === undefined) {
    return {
      record: {
        after_run_id: null,
        cycle: 1,
        max_cycles: input.maxCycles,
        refused: null,
      },
    };
  }
  const reference = input.afterRun;
  if (!input.authorized) {
    return refuseChain(reference, input.maxCycles, "not_authorized");
  }
  if (!isRuntimeRunId(reference)) {
    return refuseChain(reference, input.maxCycles, "run_unreadable");
  }
  const runDir = runDirFor(input.repoRoot, reference);
  if (!isRuntimeRunDirContained(input.repoRoot, runDir)) {
    return refuseChain(reference, input.maxCycles, "run_unreadable");
  }
  let raw: unknown;
  try {
    const text = await fs.readFile(path.join(runDir, "status.json"), "utf8");
    raw = JSON.parse(text);
  } catch {
    return refuseChain(reference, input.maxCycles, "run_unreadable");
  }
  const parent = parentChainFields(raw);
  if (parent === null) {
    return refuseChain(reference, input.maxCycles, "run_unreadable");
  }
  if (parent.task_path !== input.taskPath) {
    return refuseChain(reference, input.maxCycles, "task_mismatch");
  }
  if (parent.verdict !== "changes_requested") {
    return refuseChain(reference, input.maxCycles, "verdict_not_chainable");
  }
  if (parent.review_kind !== input.reviewKind || parent.host !== input.host) {
    return refuseChain(reference, input.maxCycles, "not_authorized");
  }
  if (input.reviewKind === "implementation" && !sameProducerIdentity(parent.producer_identity, input.producerIdentity)) {
    return refuseChain(reference, input.maxCycles, "not_authorized");
  }
  if (parent.agents_hash !== input.hashes.agents) {
    return refuseChain(reference, input.maxCycles, "agents_changed");
  }
  const parentTaskHash = parent.task_hash_after_write ?? parent.task_hash;
  if (parentTaskHash === input.hashes.task) {
    return refuseChain(reference, input.maxCycles, "task_unchanged");
  }
  const cycle = parent.cycle + 1;
  if (cycle > input.maxCycles) {
    return {
      record: {
        after_run_id: reference,
        cycle: null,
        max_cycles: input.maxCycles,
        refused: null,
      },
      stop: { state: "human_required", reason: "cycle_limit_reached" },
    };
  }
  return {
    record: {
      after_run_id: reference,
      cycle,
      max_cycles: input.maxCycles,
      refused: null,
    },
  };
}

function refuseChain(
  afterRunId: string,
  maxCycles: 1 | 2 | 3,
  refused: ReviewChainRefused,
): ChainResolution {
  return {
    record: {
      after_run_id: afterRunId,
      cycle: null,
      max_cycles: maxCycles,
      refused,
    },
    stop: { state: "blocked", reason: "chain_refused" },
  };
}

type ParentChainFields = {
  task_path: string;
  verdict: unknown;
  agents_hash: string | null;
  task_hash: string | null;
  task_hash_after_write: string | null;
  cycle: number;
  review_kind: ReviewKind;
  host: CanonicalHost | null;
  producer_identity: ProducerIdentity | null;
};

function parentChainFields(raw: unknown): ParentChainFields | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  if (typeof raw.task_path !== "string") {
    return null;
  }
  if (raw.verdict !== null && typeof raw.verdict !== "string") {
    return null;
  }
  if (!isPlainObject(raw.artifact_hashes)) {
    return null;
  }
  const taskHash = raw.artifact_hashes.task;
  const agentsHash = raw.artifact_hashes.agents;
  if (taskHash !== null && typeof taskHash !== "string") {
    return null;
  }
  if (agentsHash !== null && typeof agentsHash !== "string") {
    return null;
  }
  const afterWrite = raw.task_hash_after_write;
  if (afterWrite !== null && afterWrite !== undefined && typeof afterWrite !== "string") {
    return null;
  }
  if (!isPlainObject(raw.review_chain)) {
    return null;
  }
  const cycle = raw.review_chain.cycle;
  if (typeof cycle !== "number" || !Number.isInteger(cycle) || cycle < 1) {
    return null;
  }
  if (raw.review_kind !== "plan" && raw.review_kind !== "implementation") {
    return null;
  }
  if (
    raw.host !== null &&
    raw.host !== "codex" &&
    raw.host !== "claude" &&
    raw.host !== "cursor" &&
    raw.host !== "grok"
  ) {
    return null;
  }
  const producerIdentity = parentProducerIdentity(raw.producer_identity);
  if (producerIdentity === undefined) {
    return null;
  }
  return {
    task_path: raw.task_path,
    verdict: raw.verdict,
    agents_hash: agentsHash,
    task_hash: taskHash,
    task_hash_after_write: typeof afterWrite === "string" ? afterWrite : null,
    cycle,
    review_kind: raw.review_kind,
    host: raw.host,
    producer_identity: producerIdentity,
  };
}

function parentProducerIdentity(raw: unknown): ProducerIdentity | null | undefined {
  if (raw === undefined || raw === null) {
    return null;
  }
  if (!isPlainObject(raw)) {
    return undefined;
  }
  if (raw.role !== "implementer") {
    return undefined;
  }
  if (raw.host !== "codex" && raw.host !== "claude" && raw.host !== "cursor" && raw.host !== "grok") {
    return undefined;
  }
  return { role: "implementer", host: raw.host };
}

function sameProducerIdentity(parent: ProducerIdentity | null, current: ProducerIdentity | null): boolean {
  if (parent === null || current === null) {
    return false;
  }
  return parent.role === current.role && parent.host === current.host;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
