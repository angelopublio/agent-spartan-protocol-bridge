import fs from "node:fs/promises";
import path from "node:path";
import {
  AdapterFailureError,
  AdapterTimeoutError,
  isProducerAdapter,
  producerCapabilitiesAllowed,
  type ProducerAdapter,
} from "../adapters/adapter.ts";
import { ProducerWriteScopeError } from "../adapters/producer-write-scope.ts";
import { parseAgentsPolicy, automaticImplementationAdmission, type AgentsPolicyParse } from "../policy/agents-policy.ts";
import { loadBridgeConfig, resolveProducerTimeoutMs } from "../policy/bridge-config.ts";
import {
  loadRegistry,
  resolveLauncherId,
  type ClientContextRegistry,
} from "../policy/registry.ts";
import {
  resolveContainedTaskPath,
  resolveRuntimeLayout,
} from "../runtime/paths.ts";
import { acquireWriterLock, releaseWriterLock, WriterLockUnavailableError, type WriterLock } from "../runtime/lock.ts";
import { isRuntimeRunDirContained, isRuntimeRunId, readStatus, runDirFor } from "../runtime/store.ts";
import {
  appendTransitionEvent,
  createExclusiveTransitionDir,
  readTransitionEvents,
  writeTransitionStatusAtomic,
} from "../runtime/transition-store.ts";
import {
  buildProducerDiagnostic,
  BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS,
  isFiniteIntegerExitCode,
  SCHEMA_VERSION,
  type CanonicalHost,
  type ProducerDiagnostic,
  type ReasonCode,
  type StatusDocument,
  type TransitionEventDocument,
  type TransitionEventType,
  type TransitionState,
  type TransitionStatusDocument,
} from "./contracts.ts";
import { rfc3339Utc } from "./contracts.ts";
import { planTargetsUnwritablePath } from "./plan-target-scan.ts";
import { validateProducerDeclaration, basenameTaskPath } from "./producer-declaration.ts";
import { runReview, buildResolvedPolicy, type AppDeps, type ReviewOutcome, type ReviewProgress } from "./review.ts";
import { policyDigest, sha256Bytes } from "./serialize.ts";
import { isTerminalCloseOutApplied, writeTerminalCloseOut } from "./task-write.ts";
import { snapshotDiff, snapshotTree, SnapshotCapError, type TreeSnapshot } from "./snapshot.ts";
import {
  applyProducerMerge,
  captureProducerMerge,
  cleanupProducerWorkspace,
  prepareProducerWorkspace,
  ProducerMergeError,
  PRODUCER_SUPPORT_SCOPE,
  resolveMergeDestinations,
} from "./workspace.ts";

export type SuccessorProgress = ReviewProgress & {
  producerStarted?(info: {
    transition_id: string;
    host: CanonicalHost;
    model: string;
    effort: string;
    created_at: string;
  }): void;
  implementationReviewStarted?: ReviewProgress["started"];
};

export type SuccessorOutcome = {
  createdRun: boolean;
  exitCode: 0 | 1;
  kind: "review" | "transition";
  status: StatusDocument | null;
  transition: TransitionStatusDocument | null;
  error: string | null;
};

type MutableTransition = {
  transitionDir: string;
  sequence: number;
  status: TransitionStatusDocument;
};

export type AdvanceFromCheckpointInput = {
  repoRoot: string;
  repoArg: string;
  taskPath: string;
  transition: MutableTransition;
  deps: AppDeps;
  progress?: SuccessorProgress;
  signal?: AbortSignal;
  allowCorrection?: boolean;
  maxCycles?: number;
  cycle?: number;
  parentRunId: string;
  planRunId: string;
  finaliseOnly?: boolean;
};

export type AdvanceFromCheckpointResult =
  | SuccessorOutcome
  | { kind: "correction"; parentRunId: string; nextCycle: number }
  | { kind: "refuse"; reason: "linked_review_live" | "review_not_terminal" }
  | { kind: "needs_dispatch" };

export const RESUMABLE_CHECKPOINTS = new Set<TransitionEventType>([
  "path_validated",
  "producer_finished",
  "implementation_review_dispatched",
  "implementation_review_result",
]);

const NON_TERMINAL_RUN_STATES = new Set(["requested", "policy_resolved", "reviewing"]);

export function isReviewRunNonTerminal(status: StatusDocument | null): boolean {
  if (status === null) {
    return true;
  }
  return NON_TERMINAL_RUN_STATES.has(status.state);
}

export async function readRunStatusIfPresent(repoRoot: string, runId: string): Promise<StatusDocument | null> {
  const runDir = runDirFor(repoRoot, runId);
  if (!isRuntimeRunDirContained(repoRoot, runDir)) {
    return null;
  }
  try {
    return await readStatus(runDir);
  } catch {
    return null;
  }
}

export async function linkedReviewRunStillLive(
  repoRoot: string,
  transition: TransitionStatusDocument,
): Promise<boolean> {
  const candidates = new Set<string>();
  if (typeof transition.current_review_run_id === "string" && isRuntimeRunId(transition.current_review_run_id)) {
    candidates.add(transition.current_review_run_id);
  }
  for (const runId of transition.linked_review_run_ids) {
    if (isRuntimeRunId(runId)) {
      candidates.add(runId);
    }
  }
  for (const runId of candidates) {
    const status = await readRunStatusIfPresent(repoRoot, runId);
    if (isReviewRunNonTerminal(status)) {
      return true;
    }
  }
  return false;
}

async function loadTransitionEvents(transitionDir: string): Promise<TransitionEventDocument[]> {
  try {
    const text = await readTransitionEvents(transitionDir);
    return text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as TransitionEventDocument);
  } catch {
    return [];
  }
}

async function findTerminalLinkedReviewStatus(
  repoRoot: string,
  transition: TransitionStatusDocument,
): Promise<StatusDocument | null> {
  const candidates: string[] = [];
  for (const runId of transition.linked_review_run_ids) {
    if (isRuntimeRunId(runId)) {
      candidates.push(runId);
    }
  }
  if (typeof transition.current_review_run_id === "string" && isRuntimeRunId(transition.current_review_run_id)) {
    if (!candidates.includes(transition.current_review_run_id)) {
      candidates.push(transition.current_review_run_id);
    }
  }
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const status = await readRunStatusIfPresent(repoRoot, candidates[index]!);
    if (status !== null && !isReviewRunNonTerminal(status)) {
      return status;
    }
  }
  return null;
}

function lastProducerFinishedIndex(events: TransitionEventDocument[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]!.type === "producer_finished") {
      return index;
    }
  }
  return -1;
}

function producerCheckpointIndex(events: TransitionEventDocument[]): number {
  if (events.length === 0) {
    return -1;
  }
  const lastIndex = events.length - 1;
  const lastType = events[lastIndex]!.type;
  if (lastType === "path_validated" || lastType === "producer_finished") {
    return lastIndex;
  }
  return lastProducerFinishedIndex(events);
}

function mayFinaliseTerminalLinkedRunAtProducerCheckpoint(
  events: TransitionEventDocument[],
  runId: string,
): boolean {
  const checkpointIndex = producerCheckpointIndex(events);
  if (checkpointIndex < 0) {
    return false;
  }
  return !events.slice(0, checkpointIndex).some(
    (event) =>
      (event.type === "implementation_review_dispatched" || event.type === "implementation_review_result") &&
      event.review_run_id === runId,
  );
}

async function findUnlinkedReviewRunByTransitionId(
  repoRoot: string,
  transitionId: string,
  linkedRunIds: readonly string[],
): Promise<StatusDocument | null> {
  let runsDir: string;
  try {
    ({ runsDir } = await resolveRuntimeLayout(repoRoot));
  } catch {
    return null;
  }
  let entries: string[];
  try {
    entries = await fs.readdir(runsDir);
  } catch {
    return null;
  }
  const linked = new Set(linkedRunIds);
  let best: StatusDocument | null = null;
  for (const entry of entries) {
    if (!isRuntimeRunId(entry) || linked.has(entry)) {
      continue;
    }
    const status = await readRunStatusIfPresent(repoRoot, entry);
    if (
      status === null ||
      status.transition_id !== transitionId ||
      status.review_kind !== "implementation"
    ) {
      continue;
    }
    if (best === null || status.updated_at > best.updated_at) {
      best = status;
    }
  }
  return best;
}

export type AdvanceChainParams = {
  parentRunId: string;
  planRunId: string;
  cycle?: number;
  maxCycles?: number;
};

export async function resolveAdvanceChainFromEvents(
  repoRoot: string,
  transition: TransitionStatusDocument,
  events: TransitionEventDocument[],
): Promise<AdvanceChainParams> {
  const planRunId = transition.parent_run_id;
  let parentRunId = planRunId;
  let cycle = 1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (
      event.type === "correction_dispatched" &&
      event.review_run_id !== null &&
      isRuntimeRunId(event.review_run_id)
    ) {
      parentRunId = event.review_run_id;
      const reviewStatus = await readRunStatusIfPresent(repoRoot, parentRunId);
      cycle = (reviewStatus?.review_chain?.cycle ?? 1) + 1;
      break;
    }
  }
  let maxCycles: number | undefined;
  try {
    const agentsText = await fs.readFile(path.join(repoRoot, "AGENTS.md"), "utf8");
    const agentsPolicy = parseAgentsPolicy(agentsText);
    if (agentsPolicy.ok) {
      const admission = automaticImplementationAdmission(agentsPolicy);
      if (admission.ok) {
        maxCycles = admission.max_cycles;
      }
    }
  } catch {
    // leave maxCycles undefined when policy is unreadable
  }
  return {
    parentRunId,
    planRunId,
    ...(cycle !== undefined ? { cycle } : {}),
    ...(maxCycles !== undefined ? { maxCycles } : {}),
  };
}

export async function continueAfterPlanReview(
  plan: StatusDocument,
  input: { repo: string; task: string; signal?: AbortSignal },
  deps: AppDeps,
  progress?: SuccessorProgress,
): Promise<SuccessorOutcome> {
  if (
    plan.review_kind !== "plan" ||
    plan.verdict !== "pass" ||
    plan.reason_code !== "review_passed" ||
    plan.state !== "awaiting_implementer"
  ) {
    return reviewResult(plan);
  }

  let repoRoot: string;
  try {
    const { resolveReadableDirectory } = await import("../runtime/paths.ts");
    repoRoot = await resolveReadableDirectory(input.repo);
  } catch {
    return reviewResult(plan);
  }

  const config = await loadBridgeConfig(repoRoot);
  if (config.kind === "absent" || (config.kind === "valid" && config.dispatch === "manual")) {
    return reviewResult(plan);
  }

  const agentsAbs = path.join(repoRoot, "AGENTS.md");
  let agentsText: string;
  try {
    agentsText = await fs.readFile(agentsAbs, "utf8");
  } catch {
    return createStoppedTransition(repoRoot, plan, input.task, deps, "agents_unreadable");
  }
  const agentsPolicy = parseAgentsPolicy(agentsText);
  if (!agentsPolicy.ok) {
    return createStoppedTransition(repoRoot, plan, input.task, deps, "config_invalid");
  }

  if (config.kind === "invalid") {
    return createStoppedTransition(repoRoot, plan, input.task, deps, "config_invalid");
  }

  const producerTimeoutMs = resolveProducerTimeoutMs(config, BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS);

  const admission = automaticImplementationAdmission(agentsPolicy);
  if (!admission.ok) {
    if (admission.reason === "reviewer_binding_missing") {
      return reviewResult(plan);
    }
    return createStoppedTransition(repoRoot, plan, input.task, deps, "automatic_implementation_not_authorized");
  }

  let registry;
  try {
    registry = await loadRegistry(deps.registry);
  } catch {
    return reviewResult(plan);
  }
  const approvedHash = plan.task_hash_after_write;
  const policyStale = approvedPlanPolicyMismatch(registry, agentsPolicy, plan);
  if (policyStale !== null || approvedHash === null) {
    return createStoppedTransition(repoRoot, plan, input.task, deps, "approved_artifact_stale");
  }
  const bytesStale = await assertApprovedBytes(repoRoot, input.task, approvedHash, plan);
  if (bytesStale !== null) {
    return createStoppedTransition(repoRoot, plan, input.task, deps, bytesStale);
  }
  let approvedTaskText: string;
  try {
    const taskAbs = await resolveContainedTaskPath(repoRoot, input.task);
    approvedTaskText = await fs.readFile(taskAbs, "utf8");
  } catch {
    return createStoppedTransition(repoRoot, plan, input.task, deps, "approved_artifact_stale");
  }
  const unwritablePlanTargets = planTargetsUnwritablePath(approvedTaskText, admission.write_scope);
  let launcherId: string;
  try {
    launcherId = resolveLauncherId(registry, admission.binding.client_context, admission.binding.host);
  } catch {
    return reviewResult(plan);
  }
  let adapter;
  try {
    adapter = deps.catalog.resolve(launcherId);
    if (!isProducerAdapter(adapter)) {
      return reviewResult(plan);
    }
    const producerCaps = adapter.producerCapabilities();
    if (!producerCapabilitiesAllowed(producerCaps) || producerCaps.launcher_id !== launcherId) {
      return reviewResult(plan);
    }
    await adapter.producerPreflight();
  } catch {
    return reviewResult(plan);
  }

  const transitionId = deps.clock.createTransitionId();
  let transitionsDir: string;
  try {
    ({ transitionsDir } = await resolveRuntimeLayout(repoRoot));
  } catch {
    return syntheticStop(plan, input.task, transitionId, "config_invalid");
  }
  let transitionDir: string;
  try {
    transitionDir = await createExclusiveTransitionDir(transitionsDir, repoRoot, transitionId);
  } catch {
    return syntheticStop(plan, input.task, transitionId, "config_invalid");
  }
  const createdAt = rfc3339Utc(deps.clock.now());
  const transition: MutableTransition = {
    transitionDir,
    sequence: 0,
    status: {
      schema_version: SCHEMA_VERSION,
      document: "transition",
      transition_id: transitionId,
      state: "authorized",
      parent_run_id: plan.run_id,
      task_path: input.task,
      approved_task_hash: plan.task_hash_after_write,
      policy_digest: plan.policy_digest,
      implementer_host: admission.binding.host,
      implementer_launcher_id: launcherId,
      lock_identity: null,
      reason_code: null,
      producer_diagnostic: null,
      unwritable_plan_targets: unwritablePlanTargets.length > 0 ? unwritablePlanTargets : null,
      declaration_invalid_detail: null,
      current_review_run_id: null,
      linked_review_run_ids: [],
      created_at: createdAt,
      updated_at: createdAt,
    },
  };

  await emitTransition(transition, deps, "authorization", "authorized");

  const laterPolicyStale = approvedPlanPolicyMismatch(registry, agentsPolicy, plan);
  if (laterPolicyStale !== null) {
    return stopTransition(transition, deps, "stopped", laterPolicyStale);
  }
  const laterBytesStale = await assertApprovedBytes(repoRoot, input.task, approvedHash, plan);
  if (laterBytesStale !== null) {
    return stopTransition(transition, deps, "stopped", laterBytesStale);
  }

  let lock: WriterLock;
  try {
    lock = await acquireWriterLock(repoRoot, transitionId, rfc3339Utc(deps.clock.now()));
  } catch (error) {
    if (error instanceof WriterLockUnavailableError && error.transitionId !== null) {
      transition.status = { ...transition.status, lock_identity: error.transitionId };
    }
    return stopTransition(transition, deps, "stopped", "writer_lock_unavailable");
  }
  transition.status = { ...transition.status, lock_identity: lock.identity, implementer_host: admission.binding.host, implementer_launcher_id: launcherId };
  await emitTransition(transition, deps, "lock_acquired", "locked");

  const maxCycles = admission.max_cycles;
  let parentRunId: string | undefined;
  let cycle = 1;
  try {
    while (cycle <= maxCycles) {
      if (input.signal?.aborted) {
        return stopTransition(transition, deps, "stopped", "cancelled");
      }
      let approvedHashForRound: string;
      if (parentRunId === undefined) {
        approvedHashForRound = approvedHash;
      } else {
        try {
          approvedHashForRound = await currentTaskHash(repoRoot, input.task);
        } catch {
          return stopTransition(transition, deps, "stopped", "task_unreadable");
        }
      }
      const producerInput: Parameters<typeof runProducerRound>[0] = {
        repoRoot,
        taskPath: input.task,
        plan,
        parentRunId: parentRunId ?? plan.run_id,
        approvedHash: approvedHashForRound,
        writeScope: admission.write_scope,
        binding: admission.binding,
        launcherId,
        adapter,
        transition,
        deps,
        producerTimeoutMs,
      };
      if (progress !== undefined) {
        producerInput.progress = progress;
      }
      if (input.signal !== undefined) {
        producerInput.signal = input.signal;
      }
      const producerStop = await runProducerRound(producerInput);
      if (producerStop !== null) {
        return producerStop;
      }
      let reviewKindProgress: SuccessorProgress | undefined;
      if (progress !== undefined) {
        reviewKindProgress = {
          started: progress.implementationReviewStarted ?? progress.started,
        };
        if (progress.stream !== undefined) {
          reviewKindProgress.stream = progress.stream;
        }
      }
      const advanceInput: AdvanceFromCheckpointInput = {
        repoRoot,
        repoArg: input.repo,
        taskPath: input.task,
        transition,
        deps,
        allowCorrection: true,
        maxCycles,
        cycle,
        parentRunId: parentRunId ?? plan.run_id,
        planRunId: plan.run_id,
      };
      if (reviewKindProgress !== undefined) {
        advanceInput.progress = reviewKindProgress;
      }
      if (input.signal !== undefined) {
        advanceInput.signal = input.signal;
      }
      const advanceResult = await advanceFromCheckpoint(advanceInput);
      if (advanceResult === null) {
        return stopTransition(transition, deps, "stopped", "adapter_error");
      }
      if (advanceResult.kind === "refuse" || advanceResult.kind === "needs_dispatch") {
        return stopTransition(transition, deps, "stopped", "adapter_error");
      }
      if (advanceResult.kind === "correction") {
        parentRunId = advanceResult.parentRunId;
        cycle = advanceResult.nextCycle;
        continue;
      }
      return advanceResult;
    }
    return stopTransition(transition, deps, "stopped", "cycle_limit_reached");
  } finally {
    try {
      await adapter.cleanupProducer();
    } catch {
      // best-effort
    }
    try {
      await releaseWriterLock(lock);
    } catch {
      // best-effort
    }
  }
}

async function runProducerRound(input: {
  repoRoot: string;
  taskPath: string;
  plan: StatusDocument;
  parentRunId: string;
  approvedHash: string;
  writeScope: readonly string[];
  binding: { host: CanonicalHost; model: string; effort: string };
  launcherId: string;
  adapter: ProducerAdapter;
  transition: MutableTransition;
  deps: AppDeps;
  producerTimeoutMs: number;
  progress?: SuccessorProgress;
  signal?: AbortSignal;
}): Promise<SuccessorOutcome | null> {
  const executionId = input.deps.clock.createExecutionId();
  await emitTransition(input.transition, input.deps, "producer_started", "producer_running");
  const startedAt = rfc3339Utc(input.deps.clock.now());
  input.progress?.producerStarted?.({
    transition_id: input.transition.status.transition_id,
    host: input.binding.host,
    model: input.binding.model,
    effort: input.binding.effort,
    created_at: startedAt,
  });
  try {
    return await finishProducerRound(input, executionId);
  } catch (error) {
    return stopTransition(input.transition, input.deps, "stopped", mapProducerCaptureError(error));
  }
}

type GuardedRoundOutcome =
  | { kind: "success" }
  | {
      kind: "stop";
      reason: ReasonCode;
      diagnostic: ProducerDiagnostic | null;
      declarationInvalidDetail?: string | null;
    };

async function finishProducerRound(
  input: Parameters<typeof runProducerRound>[0],
  executionId: string,
): Promise<SuccessorOutcome | null> {
  const abort = (): void => {
    void input.adapter.cancelProducer();
  };
  input.signal?.addEventListener("abort", abort, { once: true });

  // D3_RUNTIME_WRITE_BEFORE_GUARD_RELEASE: the profile guard is released
  // before merge-back, and this function persists transition records only
  // after the guarded round has returned.
  let outcome: GuardedRoundOutcome;
  try {
    outcome = await runGuardedRound(input, executionId);
  } finally {
    input.signal?.removeEventListener("abort", abort);
  }

  if (outcome.kind === "stop") {
    return stopTransition(
      input.transition,
      input.deps,
      "stopped",
      outcome.reason,
      outcome.diagnostic,
      null,
      outcome.declarationInvalidDetail ?? null,
    );
  }
  await emitTransition(input.transition, input.deps, "path_validated", "producer_finished");
  await emitTransition(input.transition, input.deps, "producer_finished", "producer_finished");
  return null;
}

// The producer runs only in a disposable copy. This function captures that
// copy into memory, verifies the live tree stayed unchanged, releases the
// sandbox guard, and only then applies the validated merge transaction.
async function runGuardedRound(
  input: Parameters<typeof runProducerRound>[0],
  executionId: string,
): Promise<GuardedRoundOutcome> {
  if (input.signal?.aborted) {
    return { kind: "stop", reason: "cancelled", diagnostic: null };
  }

  let workspaceRoot: string | undefined;
  let isolationLocked = false;
  let isolationReleased = false;
  try {
    let prepared;
    try {
      prepared = await prepareProducerWorkspace({
        repoRoot: input.repoRoot,
        writeScope: input.writeScope,
        supportScope: PRODUCER_SUPPORT_SCOPE,
      });
      workspaceRoot = prepared.workspaceRoot;
      await input.adapter.lockProducerIsolation(input.repoRoot, workspaceRoot);
      isolationLocked = true;
    } catch (error) {
      return {
        kind: "stop",
        reason: error instanceof SnapshotCapError ? "reviewer_isolation_unavailable" : "producer_failure",
        diagnostic: buildProducerDiagnostic({
          stage: "write_scope_lock",
          writeScopeCode: error instanceof ProducerWriteScopeError ? error.code : null,
        }),
      };
    }

    let productBefore: TreeSnapshot;
    let runtimeBefore: TreeSnapshot;
    try {
      productBefore = await snapshotTree(input.repoRoot, { policy: "producer", ...input.deps.snapshotCaps });
      runtimeBefore = await snapshotRuntimeOwnership(input.repoRoot);
    } catch (error) {
      return { kind: "stop", reason: mapProducerCaptureError(error), diagnostic: null };
    }

    if (input.signal?.aborted) {
      return { kind: "stop", reason: "cancelled", diagnostic: null };
    }

    if (!isPositiveProducerTimeoutMs(input.producerTimeoutMs)) {
      return { kind: "stop", reason: "producer_failure", diagnostic: buildProducerDiagnostic({ stage: "spawn" }) };
    }

    let waitResult: { exitCode: number | null; timedOut: boolean };
    try {
      await input.adapter.startProducer({
      execution_id: executionId,
      role: "implementer",
      permission_mode: "workspace-write",
      repo_root: input.repoRoot,
      workspace_root: workspaceRoot,
      task_path: input.taskPath,
      approved_plan_run_id: input.parentRunId,
      model: input.binding.model,
      effort: input.binding.effort as import("./contracts.ts").EffortLevel,
      write_scope: input.writeScope,
      producer_timeout_ms: input.producerTimeoutMs,
      });
    } catch (error) {
      return { kind: "stop", reason: "producer_failure", diagnostic: producerAdapterThrowDiagnostic("spawn", error) };
    }
    try {
      waitResult = await input.adapter.waitProducer();
    } catch (error) {
      return { kind: "stop", reason: "producer_failure", diagnostic: producerAdapterThrowDiagnostic("wait", error) };
    }

    let copyAfter: TreeSnapshot;
    let productAfter: TreeSnapshot;
    let runtimeAfter: TreeSnapshot;
    try {
      copyAfter = await snapshotTree(workspaceRoot, { policy: "workspace" });
      productAfter = await snapshotTree(input.repoRoot, { policy: "producer", ...input.deps.snapshotCaps });
      runtimeAfter = await snapshotRuntimeOwnership(input.repoRoot);
    } catch (error) {
      return { kind: "stop", reason: mapProducerCaptureError(error), diagnostic: null };
    }

    if (input.signal?.aborted) {
      return { kind: "stop", reason: "cancelled", diagnostic: null };
    }
    if (waitResult.timedOut) {
    return {
      kind: "stop",
      reason: "producer_timeout",
      diagnostic: buildProducerDiagnostic({
        stage: "wait",
        exitCode: sanitizeExitCode(waitResult.exitCode),
        timedOut: true,
        waitedMs: input.producerTimeoutMs,
      }),
    };
    }
    if (waitResult.exitCode !== 0) {
    return {
      kind: "stop",
      reason: "producer_failure",
      diagnostic: buildProducerDiagnostic({
        stage: "exit_nonzero",
        exitCode: sanitizeExitCode(waitResult.exitCode),
        timedOut: false,
      }),
    };
    }

    const runtimeDiff = snapshotDiff(runtimeBefore, runtimeAfter, new Set());
    if (runtimeDiff.length > 0) {
      return { kind: "stop", reason: "runtime_state_violation", diagnostic: null };
    }
    const productDiff = snapshotDiff(productBefore, productAfter, new Set());
    if (productDiff.some((entry) => entry.path !== ".")) {
      return { kind: "stop", reason: "write_scope_violation", diagnostic: null };
    }

    // D-072 deliberately pins the snapshot window here. A sandboxed survivor
    // can only reach the repository through a pre-existing cross-root hard
    // link, and a write after productAfter is outside the detection window.
    await input.deps.afterProducerSnapshots?.();

    let captured;
    let destinations;
    try {
      captured = await captureProducerMerge({
        workspaceRoot,
        baseline: prepared.baseline,
        after: copyAfter,
        writeScope: input.writeScope,
        supportScope: PRODUCER_SUPPORT_SCOPE,
      });
      destinations = await resolveMergeDestinations({ repoRoot: input.repoRoot, captured });
    } catch (error) {
      return { kind: "stop", reason: error instanceof ProducerMergeError ? error.reason : "write_scope_violation", diagnostic: null };
    }

    try {
      await input.adapter.releaseProducerIsolation();
      isolationReleased = true;
      await applyProducerMerge({
        repoRoot: input.repoRoot,
        captured,
        destinations,
        runId: executionId,
      });
    } catch (error) {
      return { kind: "stop", reason: error instanceof ProducerMergeError ? error.reason : "write_scope_violation", diagnostic: null };
    }

    let taskBytes: Uint8Array;
    try {
      const taskAbs = await resolveContainedTaskPath(input.repoRoot, input.taskPath);
      taskBytes = new Uint8Array(await fs.readFile(taskAbs));
    } catch {
      return { kind: "stop", reason: "task_unreadable", diagnostic: null };
    }
    const hashAfter = sha256Bytes(taskBytes);
    if (hashAfter === input.approvedHash) {
    return {
      kind: "stop",
      reason: "producer_declaration_invalid",
      diagnostic: null,
      declarationInvalidDetail: "artifact_unchanged",
    };
    }
    const declaration = validateProducerDeclaration(taskBytes, basenameTaskPath(input.taskPath), input.taskPath);
    if (!declaration.ok) {
    return {
      kind: "stop",
      reason: "producer_declaration_invalid",
      diagnostic: null,
      declarationInvalidDetail: declaration.detail,
    };
    }
    return { kind: "success" };
  } finally {
    if (isolationLocked && !isolationReleased) {
      try {
        await input.adapter.releaseProducerIsolation();
      } catch {
        // best-effort; the profile carries no live-tree mode restoration
      }
    }
    await cleanupProducerWorkspace(workspaceRoot);
  }
}

function mapProducerCaptureError(error: unknown): ReasonCode {
  return error instanceof SnapshotCapError ? "reviewer_isolation_unavailable" : "adapter_error";
}

function sanitizeExitCode(value: number | null): number | null {
  return isFiniteIntegerExitCode(value) ? value : null;
}

function isPositiveProducerTimeoutMs(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

// Only a recognized `AdapterFailureError`/`AdapterTimeoutError` record
// contributes its closed phase/cause/exit fields (D2); an unrecognized throw
// (including a rethrown `ProducerWriteScopeError` from a standalone
// `startProducer` guard fallback, which is not one of those two classes)
// contributes no adapter detail.
function producerAdapterThrowDiagnostic(stage: "spawn" | "wait", error: unknown): ProducerDiagnostic {
  if (error instanceof AdapterFailureError) {
    return buildProducerDiagnostic({
      stage,
      exitCode: error.adapterFailure.exit_code,
      adapterPhase: error.adapterFailure.phase,
      adapterCause: error.adapterFailure.cause,
    });
  }
  if (error instanceof AdapterTimeoutError && error.adapterFailure !== null) {
    return buildProducerDiagnostic({
      stage,
      exitCode: error.adapterFailure.exit_code,
      adapterPhase: error.adapterFailure.phase,
      adapterCause: error.adapterFailure.cause,
    });
  }
  return buildProducerDiagnostic({ stage });
}

async function snapshotRuntimeOwnership(repoRoot: string): Promise<TreeSnapshot> {
  const bridgeDir = path.join(repoRoot, ".spartan-bridge");
  try {
    await fs.lstat(bridgeDir);
  } catch {
    return { entries: new Map() };
  }
  return snapshotTree(bridgeDir, { policy: "workspace" });
}

type OkAgentsPolicy = Extract<AgentsPolicyParse, { ok: true }>;

function approvedPlanPolicyMismatch(
  registry: ClientContextRegistry,
  agentsPolicy: OkAgentsPolicy,
  plan: StatusDocument,
): ReasonCode | null {
  let planLauncherId: string;
  try {
    planLauncherId = resolveLauncherId(registry, agentsPolicy.client_context, agentsPolicy.host);
  } catch {
    return "approved_artifact_stale";
  }
  const currentDigest = policyDigest(
    buildResolvedPolicy(
      "plan",
      {
        host: agentsPolicy.host,
        client_context: agentsPolicy.client_context,
        model: agentsPolicy.model,
        effort: agentsPolicy.effort,
      },
      planLauncherId,
      agentsPolicy,
    ),
  );
  if (plan.policy_digest === null || currentDigest !== plan.policy_digest) {
    return "approved_artifact_stale";
  }
  return null;
}

async function assertApprovedBytes(
  repoRoot: string,
  taskPath: string,
  approvedHash: string,
  plan: StatusDocument,
): Promise<ReasonCode | null> {
  let taskAbs: string;
  try {
    taskAbs = await resolveContainedTaskPath(repoRoot, taskPath);
  } catch {
    return "approved_artifact_stale";
  }
  let taskBytes: Uint8Array;
  try {
    taskBytes = new Uint8Array(await fs.readFile(taskAbs));
  } catch {
    return "approved_artifact_stale";
  }
  if (sha256Bytes(taskBytes) !== approvedHash) {
    return "approved_artifact_stale";
  }
  const agentsAbs = path.join(repoRoot, "AGENTS.md");
  let agentsBytes: Uint8Array;
  try {
    agentsBytes = new Uint8Array(await fs.readFile(agentsAbs));
  } catch {
    return "approved_artifact_stale";
  }
  if (plan.artifact_hashes.agents !== null && sha256Bytes(agentsBytes) !== plan.artifact_hashes.agents) {
    return "approved_artifact_stale";
  }
  return null;
}

async function currentTaskHash(repoRoot: string, taskPath: string): Promise<string> {
  const taskAbs = await resolveContainedTaskPath(repoRoot, taskPath);
  const taskBytes = new Uint8Array(await fs.readFile(taskAbs));
  return sha256Bytes(taskBytes);
}

function reviewResult(plan: StatusDocument): SuccessorOutcome {
  return {
    createdRun: true,
    exitCode: 0,
    kind: "review",
    status: plan,
    transition: null,
    error: null,
  };
}

async function createStoppedTransition(
  repoRoot: string,
  plan: StatusDocument,
  taskPath: string,
  deps: AppDeps,
  reason: ReasonCode,
  unwritablePlanTargets: string[] | null = null,
): Promise<SuccessorOutcome> {
  const transitionId = deps.clock.createTransitionId();
  let transitionDir: string;
  try {
    const { transitionsDir } = await resolveRuntimeLayout(repoRoot);
    transitionDir = await createExclusiveTransitionDir(transitionsDir, repoRoot, transitionId);
  } catch {
    return syntheticStop(plan, taskPath, transitionId, reason, unwritablePlanTargets);
  }
  const createdAt = rfc3339Utc(deps.clock.now());
  const transition: MutableTransition = {
    transitionDir,
    sequence: 0,
    status: emptyTransition(transitionId, plan, taskPath, createdAt, unwritablePlanTargets),
  };
  return stopTransition(transition, deps, "stopped", reason, null, unwritablePlanTargets);
}

function syntheticStop(
  plan: StatusDocument,
  taskPath: string,
  transitionId: string,
  reason: ReasonCode,
  unwritablePlanTargets: string[] | null = null,
): SuccessorOutcome {
  const createdAt = plan.updated_at;
  return {
    createdRun: true,
    exitCode: 1,
    kind: "transition",
    status: null,
    transition: {
      ...emptyTransition(transitionId, plan, taskPath, createdAt, unwritablePlanTargets),
      state: "stopped",
      reason_code: reason,
    },
    error: null,
  };
}

function emptyTransition(
  transitionId: string,
  plan: StatusDocument,
  taskPath: string,
  createdAt: string,
  unwritablePlanTargets: string[] | null = null,
  declarationInvalidDetail: string | null = null,
): TransitionStatusDocument {
  return {
    schema_version: SCHEMA_VERSION,
    document: "transition",
    transition_id: transitionId,
    state: "authorized",
    parent_run_id: plan.run_id,
    task_path: taskPath,
    approved_task_hash: plan.task_hash_after_write,
    policy_digest: plan.policy_digest,
    implementer_host: null,
    implementer_launcher_id: null,
    lock_identity: null,
    reason_code: null,
    producer_diagnostic: null,
    unwritable_plan_targets: unwritablePlanTargets,
    declaration_invalid_detail: declarationInvalidDetail,
    current_review_run_id: null,
    linked_review_run_ids: [],
    created_at: createdAt,
    updated_at: createdAt,
  };
}

async function stopTransition(
  transition: MutableTransition,
  deps: AppDeps,
  state: TransitionState,
  reason: ReasonCode,
  diagnostic: ProducerDiagnostic | null = null,
  unwritablePlanTargets: string[] | null = null,
  declarationInvalidDetail: string | null = null,
): Promise<SuccessorOutcome> {
  transition.status = {
    ...transition.status,
    reason_code: reason,
    producer_diagnostic: diagnostic,
    unwritable_plan_targets: unwritablePlanTargets ?? transition.status.unwritable_plan_targets,
    declaration_invalid_detail: declarationInvalidDetail,
    state,
  };
  await emitTransition(transition, deps, "terminal_stop", state);
  return {
    createdRun: true,
    exitCode: 1,
    kind: "transition",
    status: null,
    transition: transition.status,
    error: null,
  };
}

async function emitTransition(
  transition: MutableTransition,
  deps: AppDeps,
  type: TransitionEventType,
  state: TransitionState,
  reviewRunId: string | null = null,
): Promise<void> {
  const timestamp = rfc3339Utc(deps.clock.now());
  transition.status = {
    ...transition.status,
    state,
    updated_at: timestamp,
    reason_code: type === "terminal_stop" ? transition.status.reason_code : transition.status.reason_code,
  };
  await writeTransitionStatusAtomic(transition.transitionDir, transition.status);
  transition.sequence += 1;
  await appendTransitionEvent(transition.transitionDir, {
    schema_version: SCHEMA_VERSION,
    sequence: transition.sequence,
    timestamp,
    transition_id: transition.status.transition_id,
    type,
    state,
    reason_code: transition.status.reason_code,
    producer_diagnostic: transition.status.producer_diagnostic,
    unwritable_plan_targets: transition.status.unwritable_plan_targets,
    declaration_invalid_detail: transition.status.declaration_invalid_detail,
    review_run_id: reviewRunId,
  });
}

export async function advanceFromCheckpoint(
  input: AdvanceFromCheckpointInput,
): Promise<AdvanceFromCheckpointResult | null> {
  const events = await loadTransitionEvents(input.transition.transitionDir);
  const lastEvent = events.at(-1) ?? null;

  if (lastEvent?.type === "terminal_stop") {
    return null;
  }
  if (lastEvent === null || !RESUMABLE_CHECKPOINTS.has(lastEvent.type)) {
    return null;
  }

  switch (lastEvent.type) {
    case "path_validated":
    case "producer_finished": {
      const unlinkedRun = await findUnlinkedReviewRunByTransitionId(
        input.repoRoot,
        input.transition.status.transition_id,
        input.transition.status.linked_review_run_ids,
      );
      if (unlinkedRun !== null) {
        if (isReviewRunNonTerminal(unlinkedRun)) {
          return { kind: "refuse", reason: "linked_review_live" };
        }
        return finaliseFromExistingReview(input, unlinkedRun, events);
      }
      const terminalStatus = await findTerminalLinkedReviewStatus(input.repoRoot, input.transition.status);
      if (
        terminalStatus !== null &&
        mayFinaliseTerminalLinkedRunAtProducerCheckpoint(events, terminalStatus.run_id)
      ) {
        return finaliseFromExistingReview(input, terminalStatus, events);
      }
      if (await linkedReviewRunStillLive(input.repoRoot, input.transition.status)) {
        return { kind: "refuse", reason: "linked_review_live" };
      }
      if (input.finaliseOnly === true) {
        return { kind: "needs_dispatch" };
      }
      return dispatchImplementationReview(input);
    }
    case "implementation_review_dispatched": {
      const runId = lastEvent.review_run_id;
      if (runId === null || !isRuntimeRunId(runId)) {
        return stopTransition(input.transition, input.deps, "stopped", "adapter_error");
      }
      const reviewStatus = await readRunStatusIfPresent(input.repoRoot, runId);
      if (reviewStatus === null) {
        return stopTransition(input.transition, input.deps, "stopped", "adapter_error");
      }
      if (isReviewRunNonTerminal(reviewStatus)) {
        return { kind: "refuse", reason: "review_not_terminal" };
      }
      return finaliseFromExistingReview(input, reviewStatus, events);
    }
    case "implementation_review_result": {
      const runId = lastEvent.review_run_id;
      if (runId === null || !isRuntimeRunId(runId)) {
        return stopTransition(input.transition, input.deps, "stopped", "adapter_error");
      }
      const reviewStatus = await readRunStatusIfPresent(input.repoRoot, runId);
      if (reviewStatus === null) {
        return stopTransition(input.transition, input.deps, "stopped", "adapter_error");
      }
      return applyImplementationReviewVerdict(input.transition, input.deps, input.repoRoot, input.taskPath, reviewStatus, {
        allowCorrection: false,
        ...(input.maxCycles !== undefined ? { maxCycles: input.maxCycles } : {}),
        ...(input.cycle !== undefined ? { cycle: input.cycle } : {}),
      });
    }
    default:
      return null;
  }
}

async function dispatchImplementationReview(
  input: AdvanceFromCheckpointInput,
): Promise<SuccessorOutcome | { kind: "correction"; parentRunId: string; nextCycle: number }> {
  const transitionId = input.transition.status.transition_id;
  const reviewInput =
    input.parentRunId === input.planRunId
      ? { repo: input.repoArg, task: input.taskPath, transition_id: transitionId }
      : { repo: input.repoArg, task: input.taskPath, after_run: input.parentRunId, transition_id: transitionId };
  const review = await runReview(
    input.signal === undefined ? reviewInput : { ...reviewInput, signal: input.signal },
    input.deps,
    input.progress,
  );
  if (!review.createdRun || review.status === null) {
    return stopTransition(input.transition, input.deps, "stopped", "adapter_error");
  }
  const linked = [...input.transition.status.linked_review_run_ids, review.status.run_id];
  input.transition.status = {
    ...input.transition.status,
    current_review_run_id: review.status.run_id,
    linked_review_run_ids: linked,
  };
  await emitTransition(input.transition, input.deps, "implementation_review_dispatched", "reviewing", review.status.run_id);
  await emitTransition(input.transition, input.deps, "implementation_review_result", "reviewing", review.status.run_id);
  return applyImplementationReviewVerdict(input.transition, input.deps, input.repoRoot, input.taskPath, review.status, {
    allowCorrection: input.allowCorrection ?? false,
    ...(input.maxCycles !== undefined ? { maxCycles: input.maxCycles } : {}),
    ...(input.cycle !== undefined ? { cycle: input.cycle } : {}),
  });
}

async function finaliseFromExistingReview(
  input: AdvanceFromCheckpointInput,
  reviewStatus: StatusDocument,
  events: TransitionEventDocument[],
): Promise<SuccessorOutcome | { kind: "correction"; parentRunId: string; nextCycle: number }> {
  const runId = reviewStatus.run_id;
  const hasDispatched = events.some(
    (event) => event.type === "implementation_review_dispatched" && event.review_run_id === runId,
  );
  const hasResult = events.some(
    (event) => event.type === "implementation_review_result" && event.review_run_id === runId,
  );
  if (!input.transition.status.linked_review_run_ids.includes(runId)) {
    input.transition.status = {
      ...input.transition.status,
      current_review_run_id: runId,
      linked_review_run_ids: [...input.transition.status.linked_review_run_ids, runId],
    };
  }
  if (!hasDispatched) {
    await emitTransition(input.transition, input.deps, "implementation_review_dispatched", "reviewing", runId);
  }
  if (!hasResult) {
    await emitTransition(input.transition, input.deps, "implementation_review_result", "reviewing", runId);
  }
  return applyImplementationReviewVerdict(input.transition, input.deps, input.repoRoot, input.taskPath, reviewStatus, {
    allowCorrection: input.allowCorrection ?? false,
    ...(input.maxCycles !== undefined ? { maxCycles: input.maxCycles } : {}),
    ...(input.cycle !== undefined ? { cycle: input.cycle } : {}),
  });
}

function exitCodeForReason(reason: string | null | undefined): 0 | 1 {
  return reason?.startsWith("review_") ? 0 : 1;
}

async function applyImplementationReviewVerdict(
  transition: MutableTransition,
  deps: AppDeps,
  repoRoot: string,
  taskPath: string,
  reviewStatus: StatusDocument,
  options: {
    allowCorrection: boolean;
    maxCycles?: number;
    cycle?: number;
  },
): Promise<SuccessorOutcome | { kind: "correction"; parentRunId: string; nextCycle: number }> {
  if (reviewStatus.verdict === "pass" && reviewStatus.reason_code === "review_passed") {
    if (reviewStatus.task_hash_after_write !== null) {
      let taskAbs: string;
      try {
        taskAbs = await resolveContainedTaskPath(repoRoot, taskPath);
      } catch {
        return stopTransition(transition, deps, "stopped", "task_unreadable");
      }
      let taskBytes: Uint8Array;
      try {
        taskBytes = new Uint8Array(await fs.readFile(taskAbs));
      } catch {
        // The artifact was deleted, renamed, or made unreadable between the
        // reviewer's write and this close-out. Terminate the transition rather
        // than let the throw escape and leave it stuck non-terminal.
        return stopTransition(transition, deps, "stopped", "task_unreadable");
      }
      const currentHash = sha256Bytes(taskBytes);
      if (currentHash === reviewStatus.task_hash_after_write) {
        const closeResult = await writeTerminalCloseOut({
          taskAbs,
          expectedHash: reviewStatus.task_hash_after_write,
          runId: reviewStatus.run_id,
          updatedAt: rfc3339Utc(deps.clock.now()).slice(0, 10),
        });
        if (!closeResult.ok) {
          transition.status = {
            ...transition.status,
            reason_code: "task_artifact_write_rejected",
          };
          await emitTransition(transition, deps, "terminal_stop", "stopped", reviewStatus.run_id);
          return {
            createdRun: true,
            exitCode: 1,
            kind: "transition",
            status: reviewStatus,
            transition: transition.status,
            error: null,
          };
        }
      } else if (
        !isTerminalCloseOutApplied(taskBytes, basenameTaskPath(taskPath), reviewStatus.run_id)
      ) {
        transition.status = {
          ...transition.status,
          reason_code: "task_artifact_write_rejected",
        };
        await emitTransition(transition, deps, "terminal_stop", "stopped", reviewStatus.run_id);
        return {
          createdRun: true,
          exitCode: 1,
          kind: "transition",
          status: reviewStatus,
          transition: transition.status,
          error: null,
        };
      }
    }
    await emitTransition(transition, deps, "terminal_stop", "completed", reviewStatus.run_id);
    return {
      createdRun: true,
      exitCode: 0,
      kind: "review",
      status: reviewStatus,
      transition: transition.status,
      error: null,
    };
  }
  if (reviewStatus.verdict === "changes_requested" && reviewStatus.reason_code === "review_changes_requested") {
    const reviewCycle = reviewStatus.review_chain?.cycle ?? options.cycle ?? 1;
    const maxCycles = options.maxCycles ?? 3;
    if (options.allowCorrection && options.maxCycles !== undefined && options.cycle !== undefined) {
      if (reviewCycle >= maxCycles) {
        return stopTransition(transition, deps, "stopped", "cycle_limit_reached");
      }
      await emitTransition(transition, deps, "correction_dispatched", "reviewing", reviewStatus.run_id);
      return { kind: "correction", parentRunId: reviewStatus.run_id, nextCycle: reviewCycle + 1 };
    }
    const reason: ReasonCode = reviewCycle >= maxCycles ? "cycle_limit_reached" : (reviewStatus.reason_code ?? "adapter_error");
    transition.status = {
      ...transition.status,
      reason_code: reason,
    };
    await emitTransition(transition, deps, "terminal_stop", "stopped", reviewStatus.run_id);
    return {
      createdRun: true,
      exitCode: exitCodeForReason(reason),
      kind: "review",
      status: reviewStatus,
      transition: transition.status,
      error: null,
    };
  }
  const reason = reviewStatus.reason_code ?? "adapter_error";
  transition.status = {
    ...transition.status,
    reason_code: reason,
  };
  await emitTransition(transition, deps, "terminal_stop", "stopped", reviewStatus.run_id);
  return {
    createdRun: true,
    exitCode: exitCodeForReason(reason),
    kind: "review",
    status: reviewStatus,
    transition: transition.status,
    error: null,
  };
}

export async function runReviewThenSuccessor(
  input: { repo: string; task: string; after_run?: string; signal?: AbortSignal; run_id?: string },
  deps: AppDeps,
  progress?: SuccessorProgress,
): Promise<SuccessorOutcome> {
  const review = await runReview(input, deps, progress);
  if (!review.createdRun || review.status === null) {
    return {
      createdRun: false,
      exitCode: 1,
      kind: "review",
      status: null,
      transition: null,
      error: review.error,
    };
  }
  if (
    review.status.review_kind === "plan" &&
    review.status.verdict === "pass" &&
    review.status.reason_code === "review_passed"
  ) {
    return continueAfterPlanReview(review.status, input, deps, progress);
  }
  return {
    createdRun: true,
    exitCode: review.exitCode,
    kind: "review",
    status: review.status,
    transition: null,
    error: null,
  };
}

export type { ReviewOutcome };
