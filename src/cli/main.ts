#!/usr/bin/env node
import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HELP_TEXT, parseArgv } from "./parse.ts";
import { createProductionDeps } from "../composition.ts";
import { doctor, doctorExitCode, formatDoctorReport } from "../core/doctor.ts";
import { queryProducerPolicy, serializePolicyQuery } from "../core/policy-query.ts";
import { type AppDeps, type ReviewProgress, type ReviewStartedProgress } from "../core/review.ts";
import { runReviewThenSuccessor, type SuccessorProgress } from "../core/transition.ts";
import type { StatusDocument, TransitionStatusDocument } from "../core/contracts.ts";
import { serializeStatus, serializeTransitionStatus } from "../core/serialize.ts";
import { serveMcpStdio } from "../mcp/server.ts";
import { resolveReadableDirectory } from "../runtime/paths.ts";
import { isRuntimeRunDirContained, isRuntimeRunId, readEvents, readStatusBytes, runDirFor } from "../runtime/store.ts";
import {
  isRuntimeTransitionId,
  readContainedTransitionEvents,
  readContainedTransitionStatusBytes,
  TransitionReadError,
} from "../runtime/transition-store.ts";
import { formatReviewStreamLine, type ReviewStreamProgress } from "../adapters/review-stream.ts";
import { resumeInterrupted, spawnDetachedReview, waitForRun } from "./detach.ts";
import { formatTaskChainStatusReport, reportTaskChainStatus } from "./task-status.ts";

export const STALE_BUILD_MESSAGE = "dist/ is older than src/; run npm run build";

// Printed once, on stderr, after `wait` prints a terminal document for a
// chain that left this checkout's runtime stale (task 0070 D3). The D-031
// warning at the top of `main` fires on every invocation, including the ones
// mid-chain, so it reads as noise by the time it matters; this line names the
// action at the one moment the operator is deciding what to do next. It gates
// nothing: the refusal itself is unchanged, and an operator who ignores this
// still meets `stale_build` on the next `review` (D-062).
export const STALE_BUILD_NEXT_ROUND_MESSAGE =
  "this chain left dist/ older than src/; run npm run build before the next /spbridge round, not as an --after-run continuation";

const ELAPSED_TICK_MS = 10_000;
const TIME_COLUMN_INDENT = "      ";

export type ProgressStream = {
  write(chunk: string): unknown;
  readonly isTTY?: boolean;
};

export type ProgressClock = {
  now(): number;
};

export type ProgressTimerHandle = {
  unref(): unknown;
};

export type ProgressTimer = {
  setInterval(callback: () => void, delay: number): ProgressTimerHandle;
  clearInterval(handle: ProgressTimerHandle): void;
};

export type CliIo = {
  stdout?: { write(chunk: string | Uint8Array): unknown };
  stderr?: ProgressStream;
  clock?: ProgressClock;
  timer?: ProgressTimer;
  deps?: AppDeps;
};

export type LocalDayTracker = {
  lastDayKey: string | undefined;
};

export type QuietTickerOptions = {
  lastActivityAt?: () => number;
  tracker?: LocalDayTracker;
  onTick?: (now: number) => void;
};

const DEFAULT_PROGRESS_TIMER: ProgressTimer = {
  setInterval(callback, delay) {
    return setInterval(callback, delay);
  },
  clearInterval(handle) {
    clearInterval(handle as NodeJS.Timeout);
  },
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function localDateTime(ms: number): { date: string; time: string; dayKey: string } {
  const instant = new Date(ms);
  const dd = pad2(instant.getDate());
  const mm = pad2(instant.getMonth() + 1);
  const time = `${pad2(instant.getHours())}:${pad2(instant.getMinutes())}:${pad2(instant.getSeconds())}`;
  return { date: `${dd}/${mm}`, time, dayKey: `${instant.getFullYear()}-${mm}-${dd}` };
}

export function formatAlignedPrefix(ms: number, tracker: LocalDayTracker): string {
  const parts = localDateTime(ms);
  if (tracker.lastDayKey === parts.dayKey) {
    return `${TIME_COLUMN_INDENT}${parts.time} `;
  }
  tracker.lastDayKey = parts.dayKey;
  return `${parts.date} ${parts.time} `;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.trunc(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) {
    return `${hours}h${minutes}m${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m${seconds}s`;
  }
  return `${seconds}s`;
}

export function formatReviewStartedLine(info: ReviewStartedProgress): string {
  const parts = localDateTime(Date.parse(info.created_at));
  return `${parts.date} ${parts.time} review ${info.run_id} host=${info.host} model=${info.model} effort=${info.effort} client-context=${info.client_context}\n`;
}

export function formatProducerStartedLine(info: {
  transition_id: string;
  host: string;
  model: string;
  effort: string;
  created_at: string;
}): string {
  const parts = localDateTime(Date.parse(info.created_at));
  return `${parts.date} ${parts.time} implementer ${info.transition_id} host=${info.host} model=${info.model} effort=${info.effort}\n`;
}

export function formatImplementationReviewStartedLine(info: ReviewStartedProgress): string {
  const parts = localDateTime(Date.parse(info.created_at));
  return `${parts.date} ${parts.time} implementation review ${info.run_id} host=${info.host} model=${info.model} effort=${info.effort} client-context=${info.client_context}\n`;
}

export function formatReviewTerminalLine(status: StatusDocument, tracker: LocalDayTracker): string {
  const startMs = Date.parse(status.created_at);
  const endMs = Date.parse(status.updated_at);
  const prefix = formatAlignedPrefix(endMs, tracker);
  const duration = formatDuration(endMs - startMs);
  const body =
    status.verdict === null ? `review ${status.state} reason=${status.reason_code}` : `review ${status.state}`;
  return `${prefix}${body} took ${duration}\n`;
}

// D6.2 (task 0046): the only terminal reason that gains a human stderr line.
// A `reviewer.<kind>` binding whose CLI cannot schema-constrain its output
// (today Cursor, D-043/D-046) is refused at dispatch; the status JSON on
// stdout is unchanged, and this one line on stderr names the fix.
export function isReviewerOutputUnconstrained(status: StatusDocument): boolean {
  return status.state === "blocked" && status.reason_code === "reviewer_output_unconstrained";
}

export function formatReviewerOutputUnconstrainedLine(status: StatusDocument): string {
  return `reviewer.${status.review_kind} binding refused: its host CLI has no structured-output flag (--json-schema / --output-schema); rebind reviewer.${status.review_kind} in AGENTS.md to Codex, Grok, or Claude Code and re-run\n`;
}

export function formatPreDispatchDiagnosticLine(status: StatusDocument): string {
  return `pre_dispatch_diagnostic: ${status.pre_dispatch_diagnostic}\n`;
}

export function formatAdapterFailureExcerptLine(status: StatusDocument): string {
  const excerpt = status.adapter_failure?.output_excerpt;
  if (excerpt === null || excerpt === undefined || excerpt.length === 0) {
    throw new TypeError("adapter failure excerpt line requires a non-empty output_excerpt");
  }
  return `adapter_failure output_excerpt: ${excerpt}\n`;
}

export function isPlanReviewRecoveryEligible(status: StatusDocument): boolean {
  const chain = status.review_chain;
  return (
    status.review_kind === "plan" &&
    status.verdict === null &&
    status.state === "failed" &&
    chain !== null &&
    chain.after_run_id !== null &&
    chain.cycle !== null &&
    chain.refused === null
  );
}

export function formatPlanReviewRecoveryLine(status: StatusDocument): string {
  const chain = status.review_chain;
  if (
    chain === null ||
    chain.after_run_id === null ||
    chain.cycle === null
  ) {
    throw new TypeError("plan review recovery requires an accepted review_chain parent and cycle");
  }
  return `resume plan review: --after-run ${chain.after_run_id} retries cycle ${chain.cycle}; interrupted attempt did not consume the limit\n`;
}

export function formatTransitionTerminalLine(status: TransitionStatusDocument, tracker: LocalDayTracker): string {
  const startMs = Date.parse(status.created_at);
  const endMs = Date.parse(status.updated_at);
  const prefix = formatAlignedPrefix(endMs, tracker);
  const duration = formatDuration(endMs - startMs);
  const targets =
    status.unwritable_plan_targets != null ? ` targets=${status.unwritable_plan_targets.join(",")}` : "";
  const detail =
    status.reason_code === "producer_declaration_invalid" && status.declaration_invalid_detail !== null
      ? ` detail=${status.declaration_invalid_detail}`
      : "";
  const wrote =
    status.producer_refused_paths != null &&
    (status.reason_code === "write_scope_violation" || status.reason_code === "runtime_state_violation")
      ? ` wrote=${status.producer_refused_paths.map(renderPrintableAsciiQuotedLiteral).join(",")}`
      : "";
  return `${prefix}implementer ${status.state} reason=${status.reason_code}${targets}${detail}${wrote} took ${duration}\n`;
}

export function renderPrintableAsciiQuotedLiteral(entry: string): string {
  const json = JSON.stringify(entry);
  let rendered = "";
  for (let index = 0; index < json.length; index += 1) {
    const unit = json.charCodeAt(index);
    rendered += unit >= 0x20 && unit <= 0x7e
      ? json[index]
      : `\\u${unit.toString(16).padStart(4, "0")}`;
  }
  return rendered;
}

function seedTrackerFromCreatedAt(createdAt: string, tracker: LocalDayTracker): void {
  tracker.lastDayKey = localDateTime(Date.parse(createdAt)).dayKey;
}

export function formatQuietTickerLine(
  now: number,
  tracker: LocalDayTracker,
  lastActivityAtMs: number,
): string {
  const silenceSec = Math.floor((now - lastActivityAtMs) / 1000);
  return `${formatAlignedPrefix(now, tracker)}quiet ${silenceSec}s\n`;
}

export function startElapsedTicker(
  stream: ProgressStream,
  clock: ProgressClock,
  timer: ProgressTimer,
  options: QuietTickerOptions = {},
): { stop(): void } {
  if (stream.isTTY !== true) {
    return {
      stop() {
        return;
      },
    };
  }
  const startedAt = clock.now();
  const lastActivityAt = options.lastActivityAt ?? (() => startedAt);
  const tracker = options.tracker ?? { lastDayKey: undefined };
  const handle = timer.setInterval(() => {
    const now = clock.now();
    if (options.onTick !== undefined) {
      options.onTick(now);
      return;
    }
    stream.write(formatQuietTickerLine(now, tracker, lastActivityAt()));
  }, ELAPSED_TICK_MS);
  handle.unref();
  let stopped = false;
  return {
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      timer.clearInterval(handle);
    },
  };
}

export async function runWithElapsedTicker<T>(
  stream: ProgressStream,
  clock: ProgressClock,
  timer: ProgressTimer,
  body: (progress: ReviewProgress) => Promise<T>,
  tracker: LocalDayTracker = { lastDayKey: undefined },
): Promise<T> {
  let ticker: { stop(): void } | undefined;
  let lastActivityAt = clock.now();
  let latestStream: ReviewStreamProgress | undefined;
  let lastStreamLine = "";
  let lastWrittenClass: string | undefined;
  const tty = stream.isTTY === true;
  const writeStreamLine = (info: ReviewStreamProgress, force: boolean): boolean => {
    if (!tty) {
      return false;
    }
    const streamLine = formatReviewStreamLine(info);
    if (!force && streamLine === lastStreamLine) {
      return false;
    }
    lastStreamLine = streamLine;
    lastWrittenClass = info.class;
    stream.write(`${formatAlignedPrefix(clock.now(), tracker)}${streamLine}`);
    return true;
  };
  const writeQuietLine = (now: number): void => {
    stream.write(formatQuietTickerLine(now, tracker, lastActivityAt));
  };
  try {
    return await body({
      started(info) {
        lastActivityAt = clock.now();
        stream.write(formatReviewStartedLine(info));
        seedTrackerFromCreatedAt(info.created_at, tracker);
        ticker = startElapsedTicker(stream, clock, timer, {
          lastActivityAt: () => lastActivityAt,
          tracker,
          onTick(now) {
            if (latestStream !== undefined && writeStreamLine(latestStream, false)) {
              return;
            }
            writeQuietLine(now);
          },
        });
      },
      stream(info) {
        lastActivityAt = clock.now();
        latestStream = info;
        if (!tty) {
          return;
        }
        if (info.class === lastWrittenClass) {
          return;
        }
        writeStreamLine(info, true);
      },
    });
  } finally {
    ticker?.stop();
  }
}

export function packageRootFromRunningModule(moduleFile: string): string | undefined {
  const resolved = path.resolve(moduleFile);
  let dir = path.dirname(resolved);
  while (true) {
    if (path.basename(dir) === "dist") {
      return path.dirname(dir);
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

export async function newestFileMtime(root: string): Promise<number | undefined> {
  try {
    const rootStat = await fs.lstat(root);
    if (!rootStat.isDirectory()) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  let newest: number | undefined;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      break;
    }
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      try {
        const fileStat = await fs.lstat(abs);
        if (!fileStat.isFile()) {
          continue;
        }
        if (newest === undefined || fileStat.mtimeMs > newest) {
          newest = fileStat.mtimeMs;
        }
      } catch {
        continue;
      }
    }
  }
  return newest;
}

export function isBuildStale(
  newestSourceMtime: number | undefined,
  buildMtime: number | undefined,
): boolean {
  if (newestSourceMtime === undefined || buildMtime === undefined) {
    return false;
  }
  return newestSourceMtime > buildMtime;
}

export async function staleBuildMessage(packageRoot: string): Promise<string | undefined> {
  const newestSourceMtime = await newestFileMtime(path.join(packageRoot, "src"));
  let buildMtime: number | undefined;
  try {
    const buildStat = await fs.stat(path.join(packageRoot, "dist", "cli", "main.js"));
    if (buildStat.isFile()) {
      buildMtime = buildStat.mtimeMs;
    }
  } catch {
    buildMtime = undefined;
  }
  if (isBuildStale(newestSourceMtime, buildMtime)) {
    return STALE_BUILD_MESSAGE;
  }
  return undefined;
}

export async function main(
  argv: string[],
  env = process.env,
  moduleFile = fileURLToPath(import.meta.url),
  io: CliIo = {},
): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const clock = io.clock ?? { now: () => Date.now() };
  const timer = io.timer ?? DEFAULT_PROGRESS_TIMER;
  const parsed = parseArgv(argv);
  const packageRoot = packageRootFromRunningModule(moduleFile);
  if (packageRoot !== undefined) {
    const warning = await staleBuildMessage(packageRoot);
    if (warning !== undefined) {
      stderr.write(`${warning}\n`);
      if (parsed.kind === "review" || parsed.kind === "mcp-stdio") {
        return 1;
      }
    }
  }
  if (parsed.kind === "help") {
    stdout.write(HELP_TEXT);
    return 0;
  }
  if (parsed.kind === "usage") {
    stderr.write(`error: ${parsed.message}\n`);
    return argv[0] === "policy" ? 1 : 2;
  }
  if (parsed.kind === "mcp-stdio") {
    const repoInput = parsed.repo ?? process.cwd();
    let repoRoot: string;
    try {
      repoRoot = await resolveReadableDirectory(repoInput);
    } catch {
      stderr.write("error: repository root is not an existing readable directory\n");
      return 1;
    }
    return serveMcpStdio({
      repoRoot,
      deps: createProductionDeps(env),
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
    });
  }
  const deps = io.deps ?? createProductionDeps(env);
  if (parsed.kind === "wait") {
    let repoRoot: string;
    try {
      repoRoot = await resolveReadableDirectory(parsed.repo);
    } catch {
      stderr.write("error: repository root is not an existing readable directory\n");
      return 1;
    }
    if (!isRuntimeRunId(parsed.run)) {
      stderr.write("error: run does not exist\n");
      return 1;
    }
    const budgetMs = parsed.timeout_ms ?? 25000;
    const deadline = clock.now() + budgetMs;
    for (;;) {
      const outcome = await waitForRun(repoRoot, parsed.run);
      if (outcome.done) {
        if (outcome.document.length > 0) {
          stdout.write(outcome.document.endsWith("\n") ? outcome.document : `${outcome.document}\n`);
          // Only a document that reports a chain says anything about what a
          // chain left behind. The `stale_build` document (D-062) reports a
          // child that refused before creating a run, and the empty-document
          // arm below reports no chain at all; both are already governed, and
          // this line would contradict them.
          if (
            !outcome.document.includes(`"reason_code":"stale_build"`) &&
            packageRoot !== undefined &&
            (await staleBuildMessage(packageRoot)) !== undefined
          ) {
            stderr.write(`${STALE_BUILD_NEXT_ROUND_MESSAGE}\n`);
          }
        } else {
          stderr.write("error: the detached chain never created a run; run 'spartan-bridge resume'\n");
        }
        return outcome.exitCode;
      }
      if (clock.now() >= deadline) {
        stdout.write(
          `${JSON.stringify({
            state: "running",
            run_id: parsed.run,
            phase: outcome.phase,
            phase_since: outcome.phase_since,
          })}\n`,
        );
        return 0;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (parsed.kind === "resume") {
    let repoRoot: string;
    try {
      repoRoot = await resolveReadableDirectory(parsed.repo);
    } catch {
      stderr.write("error: repository root is not an existing readable directory\n");
      return 1;
    }
    const report = await resumeInterrupted(repoRoot, () => clock.now(), deps);
    for (const line of report.lines) {
      stdout.write(`${line}\n`);
    }
    return 0;
  }
  if (parsed.kind === "review" && parsed.detach === true) {
    let repoRoot: string;
    try {
      repoRoot = await resolveReadableDirectory(parsed.repo);
    } catch {
      stderr.write("error: repository root is not an existing readable directory\n");
      return 1;
    }
    const runId = parsed.run_id ?? deps.clock.createRunId();
    const ackArgs: Parameters<typeof spawnDetachedReview>[0] = {
      repoRoot,
      scriptPath: moduleFile,
      execPath: process.execPath,
      repoArg: parsed.repo,
      taskArg: parsed.task,
      runId,
      now: () => clock.now(),
    };
    if (parsed.after_run !== undefined) {
      ackArgs.afterRun = parsed.after_run;
    }
    const ack = await spawnDetachedReview(ackArgs);
    stdout.write(`${JSON.stringify(ack)}\n`);
    return 0;
  }
  if (parsed.kind === "review") {
    const afterRun = parsed.after_run;
    const reviewInput: Parameters<typeof runReviewThenSuccessor>[0] = { repo: parsed.repo, task: parsed.task };
    if (afterRun !== undefined) {
      reviewInput.after_run = afterRun;
    }
    if (parsed.run_id !== undefined) {
      reviewInput.run_id = parsed.run_id;
    }
    const tracker: LocalDayTracker = { lastDayKey: undefined };
    const controller = new AbortController();
    const onAbort = (): void => {
      controller.abort();
    };
    process.once("SIGINT", onAbort);
    process.once("SIGTERM", onAbort);
    let outcome;
    try {
      outcome = await runWithElapsedTicker(
        stderr,
        clock,
        timer,
        (progress) => {
          const successorProgress: SuccessorProgress = {
            started: progress.started,
            producerStarted(info) {
              stderr.write(formatProducerStartedLine(info));
            },
            implementationReviewStarted(info) {
              stderr.write(formatImplementationReviewStartedLine(info));
            },
          };
          if (progress.stream !== undefined) {
            successorProgress.stream = progress.stream;
          }
          return runReviewThenSuccessor({ ...reviewInput, signal: controller.signal }, deps, successorProgress);
        },
        tracker,
      );
    } finally {
      process.removeListener("SIGINT", onAbort);
      process.removeListener("SIGTERM", onAbort);
    }
    if (!outcome.createdRun) {
      stderr.write(`error: ${outcome.error ?? "review failed"}\n`);
      return 1;
    }
    if (outcome.kind === "transition" && outcome.transition !== null) {
      stderr.write(formatTransitionTerminalLine(outcome.transition, tracker));
      stdout.write(serializeTransitionStatus(outcome.transition));
      return outcome.exitCode;
    }
    const status = outcome.status!;
    stderr.write(formatReviewTerminalLine(status, tracker));
    if (isReviewerOutputUnconstrained(status)) {
      stderr.write(formatReviewerOutputUnconstrainedLine(status));
    }
    if (status.pre_dispatch_diagnostic !== null) {
      stderr.write(formatPreDispatchDiagnosticLine(status));
    }
    if (status.adapter_failure?.output_excerpt) {
      stderr.write(formatAdapterFailureExcerptLine(status));
    }
    if (isPlanReviewRecoveryEligible(status)) {
      stderr.write(formatPlanReviewRecoveryLine(status));
    }
    stdout.write(serializeStatus(status));
    return outcome.exitCode;
  }
  if (parsed.kind === "doctor") {
    const report = await doctor(parsed.repo, deps);
    stdout.write(formatDoctorReport(report));
    return doctorExitCode(report);
  }
  if (parsed.kind === "policy") {
    const result = await queryProducerPolicy(parsed.repo, parsed.role);
    if (!result.ok) {
      stderr.write(
        result.reason === "repo_unreadable"
          ? "error: repository root is not an existing readable directory\n"
          : "error: operational config is invalid\n",
      );
      return 1;
    }
    stdout.write(serializePolicyQuery(result.document));
    return 0;
  }
  if (parsed.kind === "transition-status" || parsed.kind === "transition-events") {
    try {
      const repoRoot = await resolveReadableDirectory(parsed.repo);
      if (!isRuntimeTransitionId(parsed.transition)) {
        stderr.write("error: transition does not exist\n");
        return 1;
      }
      if (parsed.kind === "transition-status") {
        const bytes = await readContainedTransitionStatusBytes(repoRoot, parsed.transition);
        stdout.write(bytes);
        return 0;
      }
      stdout.write(await readContainedTransitionEvents(repoRoot, parsed.transition));
      return 0;
    } catch (error) {
      if (error instanceof TransitionReadError && error.code === "not_contained") {
        stderr.write("error: transition path is not contained\n");
        return 1;
      }
      stderr.write("error: transition does not exist\n");
      return 1;
    }
  }
  try {
    const repoRoot = await resolveReadableDirectory(parsed.repo);
    if (parsed.kind === "status" && parsed.task !== undefined) {
      const report = await reportTaskChainStatus(repoRoot, parsed.task);
      stdout.write(formatTaskChainStatusReport(report));
      return report.error === null ? 0 : 1;
    }
    if (!isRuntimeRunId(parsed.run!)) {
      stderr.write("error: run does not exist\n");
      return 1;
    }
    const runDir = runDirFor(repoRoot, parsed.run!);
    if (!isRuntimeRunDirContained(repoRoot, runDir)) {
      stderr.write("error: run path is not contained\n");
      return 1;
    }
    await fs.access(runDir);
    if (parsed.kind === "status") {
      const bytes = await readStatusBytes(runDir);
      stdout.write(bytes);
      return 0;
    }
    stdout.write(await readEvents(runDir));
    return 0;
  } catch {
    stderr.write("error: run does not exist\n");
    return 1;
  }
}

export { parseArgv, HELP_TEXT };

function isInvokedAsCli(argv1: string | undefined, sourceFile: string): boolean {
  if (argv1 === undefined) {
    return false;
  }
  try {
    return realpathSync(argv1) === realpathSync(sourceFile);
  } catch {
    return false;
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = isInvokedAsCli(process.argv[1], thisFile);
if (invoked) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exit(code);
    },
    (error: unknown) => {
      process.stderr.write(`error: ${error instanceof Error ? error.message : "unhandled failure"}\n`);
      process.exit(1);
    },
  );
}
