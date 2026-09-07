import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { openSync } from "node:fs";
import path from "node:path";
import { resolveReadableDirectory, resolveRuntimeLayout } from "../runtime/paths.ts";
import {
  isRuntimeRunId,
} from "../runtime/store.ts";
import {
  appendTransitionEvent,
  readTransitionEvents,
  readTransitionStatus,
  writeTransitionStatusAtomic,
} from "../runtime/transition-store.ts";
import { serializeStatus, serializeTransitionStatus } from "../core/serialize.ts";
import { SCHEMA_VERSION } from "../core/contracts.ts";
import { WRITER_LOCK_NAME, acquireWriterLock, releaseWriterLock } from "../runtime/lock.ts";
import type { AppDeps } from "../core/review.ts";
import {
  RESUMABLE_CHECKPOINTS,
  advanceFromCheckpoint,
  linkedReviewRunStillLive,
  readRunStatusIfPresent,
  resolveAdvanceChainFromEvents,
} from "../core/transition.ts";
import type { StatusDocument, TransitionEventDocument, TransitionStatusDocument } from "../core/contracts.ts";

export const INVOCATIONS_DIR_NAME = "invocations";
export const DETACH_LOG_NAME = "detach.log";

export type InvocationRecord = {
  run_id: string;
  pid: number;
  detached: true;
  after_run: string | null;
  created_at: string;
};

function invocationsDir(repoRoot: string): string {
  return path.join(repoRoot, ".spartan-bridge", INVOCATIONS_DIR_NAME);
}

function invocationPath(repoRoot: string, runId: string): string {
  return path.join(invocationsDir(repoRoot), `${runId}.json`);
}

async function writeInvocation(repoRoot: string, record: InvocationRecord): Promise<void> {
  const dir = invocationsDir(repoRoot);
  await fs.mkdir(dir, { recursive: true });
  const target = invocationPath(repoRoot, record.run_id);
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temp, target);
}

export async function readInvocation(repoRoot: string, runId: string): Promise<InvocationRecord | null> {
  try {
    const text = await fs.readFile(invocationPath(repoRoot, runId), "utf8");
    const parsed = JSON.parse(text) as Partial<InvocationRecord>;
    if (typeof parsed.run_id !== "string" || typeof parsed.pid !== "number") {
      return null;
    }
    return {
      run_id: parsed.run_id,
      pid: parsed.pid,
      detached: true,
      after_run: typeof parsed.after_run === "string" ? parsed.after_run : null,
      created_at: typeof parsed.created_at === "string" ? parsed.created_at : "",
    };
  } catch {
    return null;
  }
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is owned by another user — still alive.
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "EPERM");
  }
}

async function findSuccessorTransition(
  repoRoot: string,
  parentRunId: string,
): Promise<TransitionStatusDocument | null> {
  const { transitionsDir } = await resolveRuntimeLayout(repoRoot);
  let entries: string[];
  try {
    entries = await fs.readdir(transitionsDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    try {
      const doc = await readTransitionStatus(path.join(transitionsDir, entry));
      if (doc.parent_run_id === parentRunId) {
        return doc;
      }
    } catch {
      // skip unreadable entries
    }
  }
  return null;
}

const TERMINAL_RUN_STATES = new Set(["changes_requested", "human_required", "blocked", "failed", "review_passed"]);
const TERMINAL_TRANSITION_STATES = new Set(["completed", "stopped"]);

async function loadTransitionEvents(transDir: string): Promise<TransitionEventDocument[]> {
  try {
    const text = await readTransitionEvents(transDir);
    return text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as TransitionEventDocument);
  } catch {
    return [];
  }
}

async function countTransitionEvents(transDir: string): Promise<number> {
  try {
    return (await readTransitionEvents(transDir)).split("\n").filter((line) => line.trim() !== "").length;
  } catch {
    return 0;
  }
}

export type WaitOutcome =
  | { done: false; phase: string; phase_since: string }
  | { done: true; document: string; exitCode: 0 | 1 };

/**
 * Resolve the chain phase label for a non-terminal poll (D1/D2). Uses only
 * records the caller already loaded — no extra I/O.
 */
export function resolveWaitPhase(
  runStatus: StatusDocument | null,
  transition: TransitionStatusDocument | null,
  invocation: InvocationRecord | null,
): { phase: string; phase_since: string } {
  if (runStatus === null) {
    return { phase: "requested", phase_since: invocation?.created_at ?? "" };
  }
  if (
    runStatus.state === "awaiting_implementer" &&
    transition !== null &&
    !TERMINAL_TRANSITION_STATES.has(transition.state)
  ) {
    return { phase: transition.state, phase_since: transition.updated_at };
  }
  return { phase: runStatus.state, phase_since: runStatus.updated_at };
}

function waitNotDone(
  runStatus: StatusDocument | null,
  transition: TransitionStatusDocument | null,
  invocation: InvocationRecord | null,
): WaitOutcome {
  const { phase, phase_since } = resolveWaitPhase(runStatus, transition, invocation);
  return { done: false, phase, phase_since };
}

export const STALE_BUILD_REFUSE_MARKER = "dist/ is older than src/";

/**
 * Read the tail of a dead detached child's combined-output log. Used only to
 * name *why* a child exited before it created a run — today, the task 0028
 * stale-build refuse, which exits 1 with no run directory (0060 D1).
 */
async function detachLogTail(repoRoot: string, runId: string, bytes = 4096): Promise<string> {
  try {
    const buf = await fs.readFile(path.join(invocationsDir(repoRoot), `${runId}.${DETACH_LOG_NAME}`));
    return buf.subarray(Math.max(0, buf.length - bytes)).toString("utf8");
  } catch {
    return "";
  }
}

function staleBuildTerminalDocument(runId: string): string {
  return `${JSON.stringify({
    schema_version: SCHEMA_VERSION,
    document: "wait",
    run_id: runId,
    state: "stopped",
    reason_code: "stale_build",
    diagnostic: "the detached chain refused to start — dist/ is older than src/; run npm run build, then re-invoke /spbridge (not --after-run)",
  })}\n`;
}

/**
 * Follow the chain a blocking `review` used to embody: the plan run, then its
 * `parent_run_id` successor transition, then the transition terminal document.
 * The plan-run `status.json` is sealed at `awaiting_implementer` by D-035, so it
 * is never the liveness signal for the successor — the invocation pid is.
 */
export async function waitForRun(repoRoot: string, runId: string): Promise<WaitOutcome> {
  const invocation = await readInvocation(repoRoot, runId);
  const alive = invocation !== null && pidAlive(invocation.pid);
  const runStatus = await readRunStatusIfPresent(repoRoot, runId);
  let transition: TransitionStatusDocument | null = null;
  if (runStatus?.state === "awaiting_implementer") {
    transition = await findSuccessorTransition(repoRoot, runId);
  }

  if (runStatus === null) {
    // The child has not created the run directory yet. If its pid is alive it is
    // still in admission; if it is dead the chain never started.
    if (alive) {
      return waitNotDone(runStatus, transition, invocation);
    }
    // A dead child with no run: name the stale-build refuse (0060 D1) rather
    // than the generic "never created a run" so the operator rebuilds instead
    // of running `resume`.
    if ((await detachLogTail(repoRoot, runId)).includes(STALE_BUILD_REFUSE_MARKER)) {
      return { done: true, document: staleBuildTerminalDocument(runId), exitCode: 1 };
    }
    return { done: true, document: "", exitCode: 1 };
  }

  const runState = runStatus.state;
  if (runState === "requested" || runState === "policy_resolved" || runState === "reviewing") {
    return alive ? waitNotDone(runStatus, transition, invocation) : terminalFromDeadChild(runStatus);
  }

  if (TERMINAL_RUN_STATES.has(runState)) {
    // A plan review that stopped without chaining: today's stdout document.
    return { done: true, document: serializeStatus(runStatus), exitCode: runStatus.state === "human_required" || runStatus.state === "blocked" || runStatus.state === "failed" || runStatus.state === "changes_requested" ? 1 : 0 };
  }

  // runState === "awaiting_implementer": a chaining pass. Follow the successor.
  if (transition === null) {
    // Between the plan pass and createExclusiveTransitionDir. Pid decides.
    return alive ? waitNotDone(runStatus, transition, invocation) : { done: true, document: serializeStatus(runStatus), exitCode: 0 };
  }
  if (!TERMINAL_TRANSITION_STATES.has(transition.state)) {
    if (alive || (await linkedReviewRunStillLive(repoRoot, transition))) {
      return waitNotDone(runStatus, transition, invocation);
    }
    return { done: true, document: serializeTransitionStatus(transition), exitCode: 1 };
  }
  // Terminal transition: emit the same document the blocking CLI would have —
  // the linked implementation-review status if there is one, else the transition.
  const lastReviewRunId = transition.linked_review_run_ids.at(-1) ?? transition.current_review_run_id;
  if (typeof lastReviewRunId === "string" && isRuntimeRunId(lastReviewRunId)) {
    const reviewStatus = await readRunStatusIfPresent(repoRoot, lastReviewRunId);
    if (reviewStatus !== null) {
      return {
        done: true,
        document: serializeStatus(reviewStatus),
        exitCode: reviewStatus.reason_code === "review_passed" ? 0 : 1,
      };
    }
  }
  return { done: true, document: serializeTransitionStatus(transition), exitCode: transition.state === "completed" ? 0 : 1 };
}

function terminalFromDeadChild(runStatus: StatusDocument): WaitOutcome {
  // The child died mid-review with no terminal status. `resume` will persist an
  // `interrupted` record; here we report the last-known status so the skill
  // stops looping.
  return { done: true, document: serializeStatus(runStatus), exitCode: 1 };
}

export type DetachAck = { detached: true; run_id: string; pid: number };

/**
 * Reserve a run id, write the invocation record so `wait` can find the chain,
 * then reparent the real work: `spawn(detached: true, stdio: ["ignore", fd, fd])`
 * + `unref()` — a new session on POSIX, SIGTERM to the caller's process group no
 * longer reaches it — with the child's combined output in `<run-dir>/detach.log`.
 */
export async function spawnDetachedReview(args: {
  repoRoot: string;
  scriptPath: string;
  execPath: string;
  repoArg: string;
  taskArg: string;
  afterRun?: string;
  runId: string;
  now: () => number;
}): Promise<DetachAck> {
  // The child creates `runs/<runId>/` itself via `createExclusiveRunDir`, so the
  // parent only touches `invocations/` — the record `wait` finds the chain by,
  // and the log the child's combined output lands in.
  const dir = invocationsDir(args.repoRoot);
  await fs.mkdir(dir, { recursive: true });
  const logFd = openSync(path.join(dir, `${args.runId}.${DETACH_LOG_NAME}`), "a", 0o600);

  // Pass through the parent's node exec args so a `.ts` entry launched via
  // `node --import tsx` (tests) is launched the same way; production runs
  // `dist/cli/main.js` directly with an empty execArgv.
  const childArgs = [
    ...process.execArgv,
    args.scriptPath,
    "review",
    "--repo",
    args.repoArg,
    "--task",
    args.taskArg,
    "--run-id",
    args.runId,
  ];
  if (args.afterRun !== undefined) {
    childArgs.push("--after-run", args.afterRun);
  }

  let child: ChildProcess;
  try {
    // No `cwd` override: `review` locates the repository from `--repo` (an
    // absolute path), and inheriting the parent's cwd keeps node's module
    // resolution working when the parent was launched via a loader (`tsx`).
    child = spawn(args.execPath, childArgs, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
  } finally {
    // The child holds its own dup of the fd; the parent's copy is not needed.
    try {
      const { closeSync } = await import("node:fs");
      closeSync(logFd);
    } catch {
      // best-effort
    }
  }
  child.unref();

  const pid = child.pid ?? 0;
  await writeInvocation(args.repoRoot, {
    run_id: args.runId,
    pid,
    detached: true,
    after_run: args.afterRun ?? null,
    created_at: new Date(args.now()).toISOString(),
  });
  return { detached: true, run_id: args.runId, pid };
}

export type ResumeReport = {
  acted: boolean;
  lines: string[];
};

/**
 * Recover interrupted detached chains: release stale writer locks, finalise
 * resumable checkpoints that need no adapter spawn, leave a dispatch-needed
 * checkpoint unchanged with a `/spbridge` instruction, or persist `interrupted`
 * for rounds that cannot be replayed without a producer. Never long-running.
 */
export async function resumeInterrupted(
  repoRoot: string,
  now: () => number,
  deps: AppDeps,
): Promise<ResumeReport> {
  const lines: string[] = [];
  let acted = false;

  const dir = invocationsDir(repoRoot);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return { acted: false, lines: ["no detached invocations recorded"] };
  }

  const { transitionsDir, locksDir } = await resolveRuntimeLayout(repoRoot);
  const lockPath = path.join(locksDir, WRITER_LOCK_NAME);
  let heldTransitionId: string | null = null;
  try {
    const lockText = await fs.readFile(lockPath, "utf8");
    const parsed = JSON.parse(lockText) as { transition_id?: unknown; pid?: unknown };
    heldTransitionId = typeof parsed.transition_id === "string" ? parsed.transition_id : null;
    const lockPid = typeof parsed.pid === "number" ? parsed.pid : null;
    if (lockPid !== null && !pidAlive(lockPid)) {
      await fs.rm(lockPath, { force: true });
      acted = true;
      lines.push(`released stale writer.lock held by dead pid ${lockPid} (transition ${heldTransitionId ?? "unknown"})`);
    }
  } catch {
    // no lock or unreadable — nothing to release from the lock itself
  }

  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }
    const runId = file.slice(0, -".json".length);
    const invocation = await readInvocation(repoRoot, runId);
    if (invocation === null) {
      continue;
    }
    if (pidAlive(invocation.pid)) {
      lines.push(`refused: invocation ${runId} pid ${invocation.pid} is still alive`);
      continue;
    }
    const runStatus = await readRunStatusIfPresent(repoRoot, runId);
    if (runStatus === null || runStatus.state !== "awaiting_implementer") {
      continue;
    }
    const transition = await findSuccessorTransition(repoRoot, runId);
    if (transition === null || TERMINAL_TRANSITION_STATES.has(transition.state)) {
      continue;
    }

    const transDir = path.join(transitionsDir, transition.transition_id);
    const events = await loadTransitionEvents(transDir);
    const lastEvent = events.at(-1) ?? null;
    const checkpoint = lastEvent?.type ?? null;

    if (checkpoint === null || !RESUMABLE_CHECKPOINTS.has(checkpoint)) {
      await persistInterruptedTransition(transitionsDir, transition, now);
      if (heldTransitionId === transition.transition_id) {
        await fs.rm(lockPath, { force: true });
        lines.push(`released writer.lock held by interrupted transition ${transition.transition_id}`);
      }
      acted = true;
      lines.push(
        `transition ${transition.transition_id} (state ${transition.state}) marked interrupted; ` +
          (transition.state === "producer_finished" || transition.state === "reviewing"
            ? `the implementer's changes are on disk. Advance ${transition.task_path} to phase: reviewing / next_role: reviewer, commit, then run: spartan-bridge review --repo . --task ${transition.task_path}`
            : `the producer round did not declare done. Its worktree changes (if any) are the operator's to keep or discard; then run a human-started implementer round.`),
      );
      continue;
    }

    if (await linkedReviewRunStillLive(repoRoot, transition)) {
      lines.push(`refused: linked implementation-review run still live for transition ${transition.transition_id}`);
      continue;
    }

    let lock;
    try {
      lock = await acquireWriterLock(repoRoot, transition.transition_id, new Date(now()).toISOString());
    } catch {
      lines.push(`refused: writer lock unavailable for transition ${transition.transition_id}`);
      continue;
    }

    const sequence = await countTransitionEvents(transDir);
    const mutableTransition = {
      transitionDir: transDir,
      sequence,
      status: transition,
    };
    const chain = await resolveAdvanceChainFromEvents(repoRoot, transition, events);

    try {
      const outcome = await advanceFromCheckpoint({
        repoRoot,
        repoArg: repoRoot,
        taskPath: transition.task_path,
        transition: mutableTransition,
        deps,
        allowCorrection: false,
        finaliseOnly: true,
        parentRunId: chain.parentRunId,
        planRunId: chain.planRunId,
        ...(chain.cycle !== undefined ? { cycle: chain.cycle } : {}),
        ...(chain.maxCycles !== undefined ? { maxCycles: chain.maxCycles } : {}),
      });
      if (outcome === null) {
        lines.push(`refused: transition ${transition.transition_id} has no resumable checkpoint`);
        continue;
      }
      if (outcome.kind === "needs_dispatch") {
        lines.push(
          `run /spbridge on this task to dispatch the implementation review (${transition.task_path})`,
        );
        continue;
      }
      if (outcome.kind === "refuse") {
        lines.push(
          outcome.reason === "linked_review_live"
            ? `refused: linked implementation-review run still live for transition ${transition.transition_id}`
            : `refused: linked implementation-review run not terminal for transition ${transition.transition_id}`,
        );
        continue;
      }
      if (outcome.kind === "correction") {
        lines.push(`refused: correction checkpoint cannot be resumed for transition ${transition.transition_id}`);
        continue;
      }
      acted = true;
      const terminalState = outcome.transition?.state ?? "stopped";
      lines.push(`transition ${transition.transition_id} advanced to ${terminalState}`);
    } finally {
      try {
        await releaseWriterLock(lock);
      } catch {
        // best-effort
      }
    }
  }

  if (
    !acted &&
    !lines.some(
      (line) =>
        line.startsWith("refused:") ||
        line.startsWith("released ") ||
        line.includes("run /spbridge on this task to dispatch the implementation review"),
    )
  ) {
    lines.push("no interrupted detached chain found");
  }
  return { acted, lines };
}

async function persistInterruptedTransition(
  transitionsDir: string,
  transition: TransitionStatusDocument,
  now: () => number,
): Promise<void> {
  const dir = path.join(transitionsDir, transition.transition_id);
  const updated: TransitionStatusDocument = {
    ...transition,
    state: "stopped",
    reason_code: "interrupted",
    updated_at: new Date(now()).toISOString(),
  };
  await writeTransitionStatusAtomic(dir, updated);
  // Continue the transition's own monotonic sequence rather than hand-forcing a
  // value: count the events already appended by `emitTransition`.
  let priorEvents = 0;
  try {
    priorEvents = (await readTransitionEvents(dir)).split("\n").filter((line) => line.trim() !== "").length;
  } catch {
    priorEvents = 0;
  }
  await appendTransitionEvent(dir, {
    schema_version: SCHEMA_VERSION,
    sequence: priorEvents,
    timestamp: updated.updated_at,
    transition_id: transition.transition_id,
    type: "terminal_stop",
    state: "stopped",
    reason_code: "interrupted",
    producer_diagnostic: null,
    unwritable_plan_targets: transition.unwritable_plan_targets,
    declaration_invalid_detail: null,
    review_run_id: null,
  });
}

export async function resolveRepoRootOrThrow(repoInput: string): Promise<string> {
  return resolveReadableDirectory(repoInput);
}

export function isValidRunId(value: string): boolean {
  return isRuntimeRunId(value);
}
