import fs from "node:fs/promises";
import path from "node:path";
import {
  isCalendarDate,
  isCanonicalHandoffId,
  parseTaskFrontmatter,
  parseTaskFrontmatterDocument,
} from "../policy/task-frontmatter.ts";
import type {
  BridgeVerdict,
  ModelObserved,
  ReviewFinding,
  ReviewKind,
  ReviewResult,
  RuntimeBuild,
  TaskWriteRejectionCause,
} from "./contracts.ts";
import { isReviewKind, VERDICT_TO_TERMINAL } from "./contracts.ts";
import { sha256Bytes } from "./serialize.ts";
import { formatRuntimeBuild } from "../runtime/build-info.ts";

export const REVIEW_BEGIN = "<!-- spartan-bridge:review:begin -->";
export const REVIEW_END = "<!-- spartan-bridge:review:end -->";
export const REVIEW_PLAN_BEGIN = "<!-- spartan-bridge:review:plan:begin -->";
export const REVIEW_PLAN_END = "<!-- spartan-bridge:review:plan:end -->";
export const REVIEW_IMPLEMENTATION_BEGIN = "<!-- spartan-bridge:review:implementation:begin -->";
export const REVIEW_IMPLEMENTATION_END = "<!-- spartan-bridge:review:implementation:end -->";
export const REGION_BYTE_CAP = 16 * 1024;

export type TaskWriteMeta = {
  run_id: string;
  execution_id: string;
  review_kind: string;
  verdict: BridgeVerdict;
  reason_code: string;
  host: string;
  launcher_id: string;
  model: string;
  effort: string;
  model_observed: ModelObserved;
  policy_digest: string;
  emitting_build: RuntimeBuild | null;
  task_hash: string;
  agents_hash: string;
  timestamp: string;
};

export type TaskWriteRejection =
  | { ok: false; reason: "task_artifact_write_rejected"; cause: TaskWriteRejectionCause }
  | { ok: false; reason: "transition_review_kind_refused" | "transition_next_role_not_reviewer" };

export type TaskWriteResult = { ok: true; hashAfter: string } | TaskWriteRejection;

export type ArtifactWriteShapeResult =
  | { ok: true }
  | { ok: false; cause: "composition_failed"; detail: CompositionFailedDetail };

export const COMPOSITION_FAILED_DETAILS = [
  "frontmatter_identifiers_unreadable",
  "review_section_unrecognized",
  "review_placeholder_not_canonical",
  "next_handoff_not_retractable",
  "next_action_not_replaceable",
] as const;

export type CompositionFailedDetail = (typeof COMPOSITION_FAILED_DETAILS)[number];

export const COMPOSITION_FAILED_HINTS: Record<CompositionFailedDetail, string> = {
  frontmatter_identifiers_unreadable:
    "frontmatter handoff_id or next_handoff_id is missing, duplicated, or not a canonical HX-NNN / none value",
  review_section_unrecognized:
    "## Review must appear exactly once; review markers must be balanced, inside the section, and plan before implementation",
  review_placeholder_not_canonical:
    "the ## Review body must be exactly the pending template (Verdict: PENDING, Findings:, - None recorded.) with no extra prose",
  next_handoff_not_retractable:
    "an outstanding next_handoff_id requires a fenced ## Next Handoff advisory and prompt whose Handoff identifiers match",
  next_action_not_replaceable:
    "## Next Action must appear exactly once and accept the fixed completion-notice template",
};

export const TASK_WRITE_FRONTMATTER_KEYS = ["next_role", "updated_at", "handoff_id", "next_handoff_id"] as const;

export const TERMINAL_CLOSE_FRONTMATTER_KEYS = ["status", "phase", "current_role"] as const;

export const TERMINAL_CLOSE_PROBE_RUN_ID = "run-00000000-0000-4000-8000-000000000000";

export const RETRACTED_NEXT_HANDOFF_SECTION = `## Next Handoff

No outstanding handoff. The proposed review was consumed.
`;

export const TEMPLATE_PENDING_PLACEHOLDER = "Verdict: PENDING\n\nFindings:\n\n- None recorded.\n\n";

export const PLAN_REVIEW_NEXT_ROLE = {
  pass: "implementer",
  changes_requested: "planner",
} as const;

export const IMPLEMENTATION_REVIEW_NEXT_ROLE = {
  pass: "human-operator",
  changes_requested: "implementer",
} as const;

const TASK_WRITE_FRONTMATTER_KEY_SET = new Set<string>(TASK_WRITE_FRONTMATTER_KEYS);
const TERMINAL_CLOSE_FRONTMATTER_KEY_SET = new Set<string>(TERMINAL_CLOSE_FRONTMATTER_KEYS);
const FRONTMATTER_KEY_LINE = /^([A-Za-z0-9_]+)[ \t]*:/;
function writeRejected(cause: TaskWriteRejectionCause): TaskWriteRejection {
  return { ok: false, reason: "task_artifact_write_rejected", cause };
}

// One probe region per kind so the verdict-independent shape predicates (D2)
// exercise the exact `spliceRegion` -> `applyTemplatePlaceholderCleanup` ->
// `retractNextHandoffSection` sequence `composeTaskArtifactWrite` runs, without
// a verdict. The interior text is inert: it is never the `Verdict: PENDING`
// template token and never a forbidden marker.
function probeRegion(kind: ReviewKind): string {
  const begin = kind === "plan" ? REVIEW_PLAN_BEGIN : REVIEW_IMPLEMENTATION_BEGIN;
  const end = kind === "plan" ? REVIEW_PLAN_END : REVIEW_IMPLEMENTATION_END;
  return `${begin}\nVerdict: SHAPE_PROBE\n${end}\n`;
}

// D2: the single verdict-independent shape gate. Both `src/core/review.ts`
// (pre-dispatch, before the adapter is constructed) and
// `composeTaskArtifactWrite` (post-write) call this, so a shape the pre-check
// admits is a shape the writer's composition also admits, and neither can
// drift. It can only ever report `composition_failed` — the sole failure class
// knowable without attempting the write.
export function checkArtifactWriteShape(text: string, reviewKind: ReviewKind): ArtifactWriteShapeResult {
  const identifiers = readIdentifierPair(text);
  if (identifiers === null) {
    return { ok: false, cause: "composition_failed", detail: "frontmatter_identifiers_unreadable" };
  }
  const spliced = spliceRegion(text, probeRegion(reviewKind));
  if (spliced === null) {
    return { ok: false, cause: "composition_failed", detail: "review_section_unrecognized" };
  }
  const cleaned = applyTemplatePlaceholderCleanup(spliced);
  if (cleaned === null) {
    return { ok: false, cause: "composition_failed", detail: "review_placeholder_not_canonical" };
  }
  if (identifiers.next_handoff_id !== "none" && retractNextHandoffSection(cleaned, identifiers.next_handoff_id) === null) {
    return { ok: false, cause: "composition_failed", detail: "next_handoff_not_retractable" };
  }
  return { ok: true };
}

export function renderCompletionNotice(runId: string): string | null {
  const notice = [
    `Auto-chain complete: implementation review passed (Bridge run run_id=${runId}).`,
    "Review the worktree diff in the authorized implementation write scope, commit",
    "when satisfied, then set this task to status: completed.",
  ].join("\n");
  if (containsForbidden(notice)) {
    return null;
  }
  return notice;
}

export function isTerminalCloseOutApplied(taskBytes: Uint8Array, taskBasename: string, runId: string): boolean {
  let phase: string;
  try {
    phase = parseTaskFrontmatterDocument(taskBytes, taskBasename).phase;
  } catch {
    return false;
  }
  if (phase !== "complete") {
    return false;
  }
  const notice = renderCompletionNotice(runId);
  if (notice === null) {
    return false;
  }
  return Buffer.from(taskBytes).toString("utf8").includes(notice);
}

export function checkTerminalCloseShape(text: string): ArtifactWriteShapeResult {
  const identifiers = readIdentifierPair(text);
  if (identifiers === null) {
    return { ok: false, cause: "composition_failed", detail: "frontmatter_identifiers_unreadable" };
  }
  const probeNotice = renderCompletionNotice(TERMINAL_CLOSE_PROBE_RUN_ID);
  if (probeNotice === null) {
    return { ok: false, cause: "composition_failed", detail: "next_action_not_replaceable" };
  }
  const withNotice = replaceNextActionSection(text, probeNotice);
  if (withNotice === null) {
    return { ok: false, cause: "composition_failed", detail: "next_action_not_replaceable" };
  }
  if (identifiers.next_handoff_id !== "none" && retractNextHandoffSection(withNotice, identifiers.next_handoff_id) === null) {
    return { ok: false, cause: "composition_failed", detail: "next_handoff_not_retractable" };
  }
  return { ok: true };
}

export function composeTerminalCloseOut(text: string, runId: string, updatedAt: string): string | null {
  if (!checkTerminalCloseShape(text).ok) {
    return null;
  }
  const notice = renderCompletionNotice(runId);
  if (notice === null) {
    return null;
  }
  const withNotice = replaceNextActionSection(text, notice);
  if (withNotice === null) {
    return null;
  }
  const identifiers = readIdentifierPair(text);
  if (identifiers === null) {
    return null;
  }
  let body = withNotice;
  if (identifiers.next_handoff_id !== "none") {
    const retracted = retractNextHandoffSection(body, identifiers.next_handoff_id);
    if (retracted === null) {
      return null;
    }
    body = retracted;
  }
  return replaceTerminalCloseFrontmatter(body, {
    status: "active",
    phase: "complete",
    current_role: "human-operator",
    updated_at: updatedAt,
    ...(identifiers.next_handoff_id === "none"
      ? {}
      : { identifiers: { handoff_id: identifiers.next_handoff_id, next_handoff_id: "none" } }),
  });
}

export async function writeTerminalCloseOut(options: {
  taskAbs: string;
  expectedHash: string;
  runId: string;
  updatedAt: string;
}): Promise<TaskWriteResult> {
  let original: Uint8Array;
  try {
    original = new Uint8Array(await fs.readFile(options.taskAbs));
  } catch {
    return writeRejected("artifact_unreadable");
  }
  if (sha256Bytes(original) !== options.expectedHash) {
    return writeRejected("artifact_hash_stale");
  }
  const text = Buffer.from(original).toString("utf8");
  const composed = composeTerminalCloseOut(text, options.runId, options.updatedAt);
  if (composed === null) {
    return writeRejected("composition_failed");
  }
  return commitTaskArtifactWrite({
    taskAbs: options.taskAbs,
    original,
    composed,
    writeKind: "terminal_close",
  });
}

export type TransitionPrecondition =
  | { ok: true }
  | { ok: false; reason: "transition_review_kind_refused" | "transition_next_role_not_reviewer" };

export type ReviewNextRole =
  | (typeof PLAN_REVIEW_NEXT_ROLE)[keyof typeof PLAN_REVIEW_NEXT_ROLE]
  | (typeof IMPLEMENTATION_REVIEW_NEXT_ROLE)[keyof typeof IMPLEMENTATION_REVIEW_NEXT_ROLE];

export type TransitionWriteDecision =
  | { ok: true; next_role: ReviewNextRole }
  | { ok: false; reason: "transition_review_kind_refused" | "transition_next_role_not_reviewer" };

const FRONTMATTER_START = "---";
const HEADING_REVIEW = /^## Review$/;
const HEADING_NEXT_ACTION = /^## Next Action$/;
const HEADING_NEXT_HANDOFF = /^## Next Handoff$/;
const SECTION_END = /^#{1,2} /;
const FENCE_OPEN = /^(`{3,}|~{3,})/;
const FENCE_OPEN_TEXT = "```text";
const FENCE_CLOSE = "```";
const FORBIDDEN_TOKEN = /<!--|-->|spartan-bridge:/;
const CONTROL_OR_SEPARATOR = /[\p{Cc}\p{Zl}\p{Zp}]+/gu;
const CANONICAL_ID_TOKEN = /HX-[0-9]+/g;
const TEMPLATE_PENDING_TOKEN = "Verdict: PENDING";
const TEMPLATE_PENDING_INTERIOR = [
  "Verdict: PENDING",
  "",
  "Findings:",
  "",
  "- None recorded.",
  "",
] as const;

export async function writeTaskReviewRegion(options: {
  taskAbs: string;
  expectedHash: string;
  result: ReviewResult;
  meta: TaskWriteMeta;
}): Promise<TaskWriteResult> {
  let original: Uint8Array;
  try {
    original = new Uint8Array(await fs.readFile(options.taskAbs));
  } catch {
    return writeRejected("artifact_unreadable");
  }
  if (sha256Bytes(original) !== options.expectedHash) {
    return writeRejected("artifact_hash_stale");
  }
  const text = Buffer.from(original).toString("utf8");
  const mapped = VERDICT_TO_TERMINAL[options.result.verdict];
  const region = renderRegion(options.result, { ...options.meta, reason_code: mapped.reason_code });
  if (region === null) {
    return writeRejected("review_region_unrenderable");
  }
  let currentNextRole: string;
  try {
    currentNextRole = parseTaskFrontmatter(original, path.basename(options.taskAbs)).next_role;
  } catch {
    return writeRejected("frontmatter_unparseable");
  }
  if (options.result.verdict !== "pass" && options.result.verdict !== "changes_requested") {
    return writeRejected("verdict_not_persistable");
  }
  const transition = decideReviewTransition({
    reviewKind: options.meta.review_kind,
    currentNextRole,
    verdict: options.result.verdict,
  });
  if (!transition.ok) {
    return { ok: false, reason: transition.reason };
  }
  const updatedAt = calendarDateUtc(options.meta.timestamp);
  if (updatedAt === null) {
    return writeRejected("timestamp_invalid");
  }
  const composed = composeTaskArtifactWrite(text, region, {
    next_role: transition.next_role,
    updated_at: updatedAt,
  });
  if (composed === null) {
    return writeRejected("composition_failed");
  }
  return commitTaskArtifactWrite({
    taskAbs: options.taskAbs,
    original,
    composed,
  });
}

export function planReviewTransitionPrecondition(input: {
  reviewKind: string;
  currentNextRole: string;
}): TransitionPrecondition {
  if (!isReviewKind(input.reviewKind)) {
    return { ok: false, reason: "transition_review_kind_refused" };
  }
  if (input.currentNextRole !== "reviewer") {
    return { ok: false, reason: "transition_next_role_not_reviewer" };
  }
  return { ok: true };
}

export function decidePlanReviewTransition(input: {
  reviewKind: string;
  currentNextRole: string;
  verdict: keyof typeof PLAN_REVIEW_NEXT_ROLE;
}): TransitionWriteDecision {
  const precondition = planReviewTransitionPrecondition(input);
  if (!precondition.ok) {
    return precondition;
  }
  if (input.reviewKind !== "plan") {
    return { ok: false, reason: "transition_review_kind_refused" };
  }
  return { ok: true, next_role: PLAN_REVIEW_NEXT_ROLE[input.verdict] };
}

export function decideReviewTransition(input: {
  reviewKind: string;
  currentNextRole: string;
  verdict: keyof typeof PLAN_REVIEW_NEXT_ROLE;
}): TransitionWriteDecision {
  const precondition = planReviewTransitionPrecondition(input);
  if (!precondition.ok) {
    return precondition;
  }
  if (input.reviewKind === "implementation") {
    return { ok: true, next_role: IMPLEMENTATION_REVIEW_NEXT_ROLE[input.verdict] };
  }
  return { ok: true, next_role: PLAN_REVIEW_NEXT_ROLE[input.verdict] };
}

export function composeTaskArtifactWrite(
  text: string,
  region: string,
  fields: { next_role: string; updated_at: string },
): string | null {
  const kind = kindFromRegion(region);
  // D2: run the shared verdict-independent gate first, so `composeTaskArtifactWrite`
  // rejects exactly the shapes the pre-dispatch check (D1) rejects and no others.
  if (kind === null || !checkArtifactWriteShape(text, kind).ok) {
    return null;
  }
  const spliced = spliceRegion(text, region);
  if (spliced === null) {
    return null;
  }
  const identifiers = readIdentifierPair(text);
  if (identifiers === null) {
    return null;
  }
  const cleaned = applyTemplatePlaceholderCleanup(spliced);
  if (cleaned === null) {
    return null;
  }
  let body = cleaned;
  if (identifiers.next_handoff_id === "none") {
    return replaceTransitionFrontmatter(body, {
      next_role: fields.next_role,
      updated_at: fields.updated_at,
    });
  }
  const retracted = retractNextHandoffSection(body, identifiers.next_handoff_id);
  if (retracted === null) {
    return null;
  }
  return replaceTransitionFrontmatter(retracted, {
    next_role: fields.next_role,
    updated_at: fields.updated_at,
    identifiers: { handoff_id: identifiers.next_handoff_id, next_handoff_id: "none" },
  });
}

export async function commitTaskArtifactWrite(options: {
  taskAbs: string;
  original: Uint8Array;
  composed: string;
  writeKind?: "review" | "terminal_close";
}): Promise<TaskWriteResult> {
  const mode = (await fs.stat(options.taskAbs)).mode & 0o777;
  const dir = path.dirname(options.taskAbs);
  const temp = path.join(dir, `.spartan-bridge-task.${process.pid}.tmp`);
  try {
    await fs.writeFile(temp, options.composed, { encoding: "utf8", mode });
    await fs.rename(temp, options.taskAbs);
  } catch {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    return writeRejected("atomic_write_failed");
  }
  let written: Uint8Array;
  try {
    written = new Uint8Array(await fs.readFile(options.taskAbs));
  } catch {
    await fs.writeFile(options.taskAbs, options.original);
    return writeRejected("post_write_unreadable");
  }
  const originalText = Buffer.from(options.original).toString("utf8");
  const writtenText = Buffer.from(written).toString("utf8");
  try {
    parseTaskFrontmatterDocument(written, path.basename(options.taskAbs));
  } catch {
    await fs.writeFile(options.taskAbs, options.original);
    return writeRejected("post_write_reparse_failed");
  }
  if (
    !preservedAuthorizedBytes(originalText, writtenText, options.writeKind ?? "review")
  ) {
    await fs.writeFile(options.taskAbs, options.original);
    return writeRejected("authorized_bytes_changed");
  }
  return { ok: true, hashAfter: sha256Bytes(written) };
}

export function renderRegion(result: ReviewResult, meta: TaskWriteMeta): string | null {
  if (result.verdict !== "pass" && result.verdict !== "changes_requested") {
    return null;
  }
  if (containsForbidden(result.summary)) {
    return null;
  }
  const verdictLine = result.verdict === "pass" ? "Verdict: APPROVED" : "Verdict: CHANGES_REQUESTED";
  const findingLines: string[] = [];
  if (result.findings.length === 0) {
    findingLines.push("- None recorded.");
  } else {
    for (const finding of result.findings) {
      const message = sanitizeText(finding.message);
      if (containsForbidden(finding.message) || containsForbidden(message)) {
        return null;
      }
      findingLines.push(renderFinding(finding.id, finding.severity, message));
    }
  }
  const kind = isReviewKind(result.review_kind) ? result.review_kind : null;
  if (kind === null) {
    return null;
  }
  const lines = [
    beginMarker(kind),
    verdictLine,
    "",
    "Findings:",
    "",
    ...findingLines,
    "",
    renderBridgeRunLine(meta),
    endMarker(kind),
  ];
  const rendered = `${lines.join("\n")}\n`;
  if (Buffer.byteLength(rendered, "utf8") > REGION_BYTE_CAP) {
    return null;
  }
  return rendered;
}

export function spliceRegion(text: string, region: string): string | null {
  const kind = kindFromRegion(region);
  if (kind === null) {
    return null;
  }
  const lines = text.split("\n");
  const scan = scanDocument(lines);
  if (!scan.ok || !scanAcceptsWrite(scan)) {
    return null;
  }
  const regionLines = region.replace(/\n$/, "").split("\n");
  const existing = scan.regions.filter((item) => item.kind === kind);
  if (existing.length > 1) {
    return null;
  }
  if (existing.length === 1) {
    const target = existing[0];
    if (!target) {
      return null;
    }
    const next = [...lines];
    next.splice(target.beginIndex, target.endIndex - target.beginIndex + 1, ...regionLines);
    return next.join("\n");
  }
  const next = [...lines];
  if (scan.regions.length === 0) {
    const prefix: string[] = [];
    let insertAt = scan.review.headingIndex + 1;
    if (lines[insertAt] === "") {
      insertAt += 1;
    } else {
      prefix.push("");
    }
    const suffix: string[] = [];
    const bodyFirst = lines[insertAt];
    if (bodyFirst !== undefined && bodyFirst !== "") {
      suffix.push("");
    }
    next.splice(insertAt, 0, ...prefix, ...regionLines, ...suffix);
    return next.join("\n");
  }
  const last = scan.regions[scan.regions.length - 1];
  if (!last) {
    return null;
  }
  if (kind === "plan") {
    return null;
  }
  next.splice(last.endIndex + 1, 0, ...regionLines);
  return next.join("\n");
}

function beginMarker(kind: ReviewKind): string {
  return kind === "plan" ? REVIEW_PLAN_BEGIN : REVIEW_IMPLEMENTATION_BEGIN;
}

function endMarker(kind: ReviewKind): string {
  return kind === "plan" ? REVIEW_PLAN_END : REVIEW_IMPLEMENTATION_END;
}

function kindFromRegion(region: string): ReviewKind | null {
  const first = region.split("\n")[0] ?? "";
  if (first === REVIEW_PLAN_BEGIN || first === REVIEW_BEGIN) {
    return "plan";
  }
  if (first === REVIEW_IMPLEMENTATION_BEGIN) {
    return "implementation";
  }
  return null;
}

function renderFinding(id: string, severity: ReviewFinding["severity"], message: string): string {
  return `- \`${id}\` (${severity}): ${message}`;
}

function renderBridgeRunLine(meta: TaskWriteMeta): string {
  return `Bridge run: run_id=${meta.run_id} execution_id=${meta.execution_id} review_kind=${meta.review_kind} verdict=${meta.verdict} reason_code=${meta.reason_code} host=${meta.host} launcher=${meta.launcher_id} model=${meta.model} effort=${meta.effort} model_observed=${meta.model_observed} policy_digest=${meta.policy_digest} ${formatRuntimeBuild(meta.emitting_build)} task_hash=${meta.task_hash} agents_hash=${meta.agents_hash} timestamp=${meta.timestamp}`;
}

function sanitizeText(value: string): string {
  return value.replace(CONTROL_OR_SEPARATOR, " ");
}

function containsForbidden(value: string): boolean {
  return FORBIDDEN_TOKEN.test(value);
}

type LocatedRegion = {
  kind: ReviewKind;
  legacy: boolean;
  beginIndex: number;
  endIndex: number;
};

type ScanOk = {
  ok: true;
  review: { headingIndex: number; bodyStart: number; end: number };
  regions: LocatedRegion[];
  unbalanced: boolean;
  outsideSection: boolean;
  duplicateKind: boolean;
  implementationBeforePlan: boolean;
};

type ScanFail = { ok: false };

function scanAcceptsWrite(scan: ScanOk): boolean {
  return !scan.unbalanced && !scan.outsideSection && !scan.duplicateKind && !scan.implementationBeforePlan;
}

function classifyMarker(line: string): { kind: ReviewKind; side: "begin" | "end"; legacy: boolean } | null {
  if (line === REVIEW_PLAN_BEGIN) {
    return { kind: "plan", side: "begin", legacy: false };
  }
  if (line === REVIEW_PLAN_END) {
    return { kind: "plan", side: "end", legacy: false };
  }
  if (line === REVIEW_IMPLEMENTATION_BEGIN) {
    return { kind: "implementation", side: "begin", legacy: false };
  }
  if (line === REVIEW_IMPLEMENTATION_END) {
    return { kind: "implementation", side: "end", legacy: false };
  }
  if (line === REVIEW_BEGIN) {
    return { kind: "plan", side: "begin", legacy: true };
  }
  if (line === REVIEW_END) {
    return { kind: "plan", side: "end", legacy: true };
  }
  return null;
}

function scanDocument(lines: string[]): ScanOk | ScanFail {
  const afterFrontmatter = skipFrontmatter(lines);
  let fence: { char: string; len: number } | null = null;
  const headings: number[] = [];
  const markers: { index: number; kind: ReviewKind; side: "begin" | "end"; legacy: boolean }[] = [];
  for (let i = afterFrontmatter; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (fence) {
      if (isFenceClose(line, fence)) {
        fence = null;
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      const marker = open[1] ?? "";
      fence = { char: marker[0] ?? "`", len: marker.length };
      continue;
    }
    if (HEADING_REVIEW.test(line)) {
      headings.push(i);
    }
    const classified = classifyMarker(line);
    if (classified) {
      markers.push({ index: i, ...classified });
    }
  }
  if (headings.length !== 1) {
    return { ok: false };
  }
  const headingIndex = headings[0] ?? 0;
  let end = lines.length;
  fence = null;
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (fence) {
      if (isFenceClose(line, fence)) {
        fence = null;
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      const marker = open[1] ?? "";
      fence = { char: marker[0] ?? "`", len: marker.length };
      continue;
    }
    if (SECTION_END.test(line) && i !== headingIndex) {
      end = i;
      break;
    }
  }
  const inSection = (index: number): boolean => index > headingIndex && index < end;
  let outsideSection = false;
  const sectionMarkers = [];
  for (const marker of markers) {
    if (!inSection(marker.index)) {
      outsideSection = true;
    } else {
      sectionMarkers.push(marker);
    }
  }
  const opens: { kind: ReviewKind; legacy: boolean; index: number }[] = [];
  const regions: LocatedRegion[] = [];
  let unbalanced = false;
  for (const marker of sectionMarkers) {
    if (marker.side === "begin") {
      opens.push({ kind: marker.kind, legacy: marker.legacy, index: marker.index });
      continue;
    }
    const open = opens.pop();
    if (!open || open.kind !== marker.kind || open.legacy !== marker.legacy || marker.index <= open.index) {
      unbalanced = true;
      continue;
    }
    regions.push({
      kind: marker.kind,
      legacy: open.legacy,
      beginIndex: open.index,
      endIndex: marker.index,
    });
  }
  if (opens.length > 0) {
    unbalanced = true;
  }
  regions.sort((left, right) => left.beginIndex - right.beginIndex);
  const kinds = regions.map((region) => region.kind);
  const duplicateKind = new Set(kinds).size !== kinds.length;
  const plan = regions.find((region) => region.kind === "plan");
  const implementation = regions.find((region) => region.kind === "implementation");
  const implementationBeforePlan =
    plan !== undefined && implementation !== undefined && implementation.beginIndex < plan.beginIndex;
  return {
    ok: true,
    review: { headingIndex, bodyStart: headingIndex + 1, end },
    regions,
    unbalanced,
    outsideSection,
    duplicateKind,
    implementationBeforePlan,
  };
}

function skipFrontmatter(lines: string[]): number {
  if ((lines[0] ?? "") !== FRONTMATTER_START) {
    return 0;
  }
  for (let i = 1; i < lines.length; i += 1) {
    if ((lines[i] ?? "") === FRONTMATTER_START) {
      return i + 1;
    }
  }
  return 0;
}

function isFenceClose(line: string, fence: { char: string; len: number }): boolean {
  const match = FENCE_OPEN.exec(line);
  if (!match) {
    return false;
  }
  const marker = match[1] ?? "";
  return marker[0] === fence.char && marker.length >= fence.len;
}

export function preservedAuthorizedBytes(
  before: string,
  after: string,
  writeKind: "review" | "terminal_close" = "review",
): boolean {
  if (writeKind === "terminal_close") {
    return preservedTerminalCloseBytes(before, after);
  }
  if (!preservedFrontmatterSource(before, after) || !preservedIdentifierPair(before, after)) {
    return false;
  }
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const beforeScan = scanDocument(beforeLines);
  const afterScan = scanDocument(afterLines);
  if (!beforeScan.ok || !afterScan.ok) {
    return false;
  }
  if (!scanAcceptsWrite(beforeScan) || !scanAcceptsWrite(afterScan)) {
    return false;
  }
  if (afterScan.regions.length < 1) {
    return false;
  }
  const beforeBodyStart = skipFrontmatter(beforeLines);
  const afterBodyStart = skipFrontmatter(afterLines);
  if (
    beforeLines.slice(beforeBodyStart, beforeScan.review.headingIndex).join("\n") !==
    afterLines.slice(afterBodyStart, afterScan.review.headingIndex).join("\n")
  ) {
    return false;
  }
  if (beforeLines[beforeScan.review.headingIndex] !== afterLines[afterScan.review.headingIndex]) {
    return false;
  }
  if (!preservedHandoffAndSuffix(before, after, beforeScan.review.end, afterScan.review.end)) {
    return false;
  }
  const beforeByKind = regionMap(beforeLines, beforeScan);
  const afterByKind = regionMap(afterLines, afterScan);
  const changed: ReviewKind[] = [];
  for (const kind of ["plan", "implementation"] as const) {
    const beforeRegion = beforeByKind.get(kind);
    const afterRegion = afterByKind.get(kind);
    if (beforeRegion === undefined && afterRegion === undefined) {
      continue;
    }
    if (beforeRegion !== undefined && afterRegion === undefined) {
      return false;
    }
    if (beforeRegion === afterRegion) {
      continue;
    }
    changed.push(kind);
  }
  if (changed.length !== 1) {
    return false;
  }
  const beforeSegments = humanSegments(beforeLines, beforeScan);
  const afterSegments = humanSegments(afterLines, afterScan);
  if (afterScan.regions.length === beforeScan.regions.length) {
    return sameSegmentsAllowingD4(beforeSegments, afterSegments);
  }
  if (afterScan.regions.length !== beforeScan.regions.length + 1) {
    return false;
  }
  const insertedKind = changed[0];
  const insertAt = afterScan.regions.findIndex((region) => region.kind === insertedKind);
  if (insertAt < 0 || beforeByKind.has(insertedKind ?? "plan")) {
    return false;
  }
  const padded = [...beforeSegments];
  padded.splice(insertAt, 0, "");
  return sameSegmentsAllowingD4(padded, afterSegments);
}

function regionMap(lines: string[], scan: ScanOk): Map<ReviewKind, string> {
  const map = new Map<ReviewKind, string>();
  for (const region of scan.regions) {
    map.set(region.kind, lines.slice(region.beginIndex, region.endIndex + 1).join("\n"));
  }
  return map;
}

function humanSegments(lines: string[], scan: ScanOk): string[] {
  const regions = [...scan.regions].sort((left, right) => left.beginIndex - right.beginIndex);
  const segments: string[] = [];
  let start = scan.review.headingIndex + 1;
  for (const region of regions) {
    segments.push(normalizeSegment(lines.slice(start, region.beginIndex).join("\n")));
    start = region.endIndex + 1;
  }
  segments.push(normalizeSegment(lines.slice(start, scan.review.end).join("\n")));
  return segments;
}

function normalizeSegment(text: string): string {
  return text.startsWith("\n") ? text.slice(1) : text;
}

function sameSegmentsAllowingD4(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length - 1; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  const beforeLast = left[left.length - 1] ?? "";
  const afterLast = right[right.length - 1] ?? "";
  return beforeLast === afterLast || isD4CleanedSegment(beforeLast, afterLast);
}

function isD4CleanedSegment(before: string, after: string): boolean {
  return before === `${TEMPLATE_PENDING_PLACEHOLDER.slice(0, -1)}` && after === "";
}

function preservedTerminalCloseBytes(before: string, after: string): boolean {
  if (!preservedFrontmatterSource(before, after, "terminal_close") || !preservedIdentifierPair(before, after)) {
    return false;
  }
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const beforeScan = scanDocument(beforeLines);
  const afterScan = scanDocument(afterLines);
  if (!beforeScan.ok || !afterScan.ok || !scanAcceptsWrite(beforeScan) || !scanAcceptsWrite(afterScan)) {
    return false;
  }
  const beforeBodyStart = skipFrontmatter(beforeLines);
  const afterBodyStart = skipFrontmatter(afterLines);
  if (
    beforeLines.slice(beforeBodyStart, beforeScan.review.headingIndex).join("\n") !==
    afterLines.slice(afterBodyStart, afterScan.review.headingIndex).join("\n")
  ) {
    return false;
  }
  if (beforeLines[beforeScan.review.headingIndex] !== afterLines[afterScan.review.headingIndex]) {
    return false;
  }
  const beforeByKind = regionMap(beforeLines, beforeScan);
  const afterByKind = regionMap(afterLines, afterScan);
  for (const kind of ["plan", "implementation"] as const) {
    if ((beforeByKind.get(kind) ?? "") !== (afterByKind.get(kind) ?? "")) {
      return false;
    }
  }
  const beforeSegments = humanSegments(beforeLines, beforeScan);
  const afterSegments = humanSegments(afterLines, afterScan);
  if (beforeSegments.length !== afterSegments.length) {
    return false;
  }
  for (let i = 0; i < beforeSegments.length - 1; i += 1) {
    if (beforeSegments[i] !== afterSegments[i]) {
      return false;
    }
  }
  const beforeAction = locateNextAction(beforeLines);
  const afterAction = locateNextAction(afterLines);
  if (beforeAction === null || afterAction === null) {
    return false;
  }
  const runId = extractRunIdFromCompletionNotice(after, afterAction);
  if (runId === null) {
    return false;
  }
  const notice = renderCompletionNotice(runId);
  if (notice === null) {
    return false;
  }
  const expectedAction = `## Next Action\n\n${notice}\n`;
  const afterActionSection = sectionSlice(after, afterAction.headingIndex, afterAction.end);
  if (afterActionSection !== expectedAction) {
    return false;
  }
  const beforeActionSection = sectionSlice(before, beforeAction.headingIndex, beforeAction.end);
  if (beforeActionSection === expectedAction) {
    return false;
  }
  const beforeLocated = locateNextHandoff(before.split("\n"));
  const afterLocated = locateNextHandoff(after.split("\n"));
  if (beforeLocated === null || afterLocated === null) {
    return beforeLocated === afterLocated;
  }
  const beforeHandoff = sectionSlice(before, beforeLocated.headingIndex, beforeLocated.end);
  const afterHandoff = sectionSlice(after, afterLocated.headingIndex, afterLocated.end);
  const identifiers = readIdentifierPair(before);
  if (identifiers === null) {
    return false;
  }
  const outstanding = identifiers.next_handoff_id !== "none";
  if (outstanding) {
    if (parseOutstandingHandoffSection(before, identifiers.next_handoff_id) === null) {
      return false;
    }
    if (afterHandoff !== RETRACTED_NEXT_HANDOFF_SECTION) {
      return false;
    }
  } else if (beforeHandoff !== afterHandoff) {
    return false;
  }
  const beforePrefix = sectionSlice(before, beforeScan.review.end, beforeAction.headingIndex);
  const afterPrefix = sectionSlice(after, afterScan.review.end, afterAction.headingIndex);
  if (beforePrefix !== afterPrefix) {
    return false;
  }
  const beforeSuffix = sectionSlice(before, beforeLocated.end, lineCount(before));
  const afterSuffix = sectionSlice(after, afterLocated.end, lineCount(after));
  return beforeSuffix === afterSuffix;
}

function extractRunIdFromCompletionNotice(text: string, located: { headingIndex: number; end: number }): string | null {
  const body = sectionSlice(text, located.headingIndex, located.end);
  const match = /run_id=([^\s).]+)/.exec(body);
  return match?.[1] ?? null;
}

function replaceTerminalCloseFrontmatter(
  text: string,
  fields: {
    status: string;
    phase: string;
    current_role: string;
    updated_at: string;
    identifiers?: { handoff_id: string; next_handoff_id: string };
  },
): string | null {
  const lines = text.split("\n");
  if ((lines[0] ?? "") !== FRONTMATTER_START) {
    return null;
  }
  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if ((lines[i] ?? "") === FRONTMATTER_START) {
      close = i;
      break;
    }
  }
  if (close < 0) {
    return null;
  }
  const next = [...lines];
  const at: Record<
    "status" | "phase" | "current_role" | "updated_at" | "handoff_id" | "next_handoff_id",
    number
  > = {
    status: -1,
    phase: -1,
    current_role: -1,
    updated_at: -1,
    handoff_id: -1,
    next_handoff_id: -1,
  };
  for (let i = 1; i < close; i += 1) {
    const key = FRONTMATTER_KEY_LINE.exec(next[i] ?? "")?.[1];
    if (
      key === "status" ||
      key === "phase" ||
      key === "current_role" ||
      key === "updated_at" ||
      key === "handoff_id" ||
      key === "next_handoff_id"
    ) {
      if (at[key] !== -1) {
        return null;
      }
      at[key] = i;
    }
  }
  if (at.status < 0 || at.phase < 0 || at.current_role < 0 || at.updated_at < 0) {
    return null;
  }
  next[at.status] = `status: ${fields.status}`;
  next[at.phase] = `phase: ${fields.phase}`;
  next[at.current_role] = `current_role: ${fields.current_role}`;
  next[at.updated_at] = `updated_at: ${fields.updated_at}`;
  if (fields.identifiers !== undefined) {
    if (at.handoff_id < 0 || at.next_handoff_id < 0) {
      return null;
    }
    next[at.handoff_id] = `handoff_id: ${fields.identifiers.handoff_id}`;
    next[at.next_handoff_id] = `next_handoff_id: ${fields.identifiers.next_handoff_id}`;
  }
  return next.join("\n");
}

function replaceNextActionSection(text: string, noticeBody: string): string | null {
  const lines = text.split("\n");
  const located = locateNextAction(lines);
  if (located === null) {
    return null;
  }
  const start = lineStartOffset(text, located.headingIndex);
  const end = lineStartOffset(text, located.end);
  return `${text.slice(0, start)}## Next Action\n\n${noticeBody}\n${text.slice(end)}`;
}

function locateNextAction(lines: string[]): { headingIndex: number; end: number } | null {
  const afterFrontmatter = skipFrontmatter(lines);
  let fence: { char: string; len: number } | null = null;
  const headings: number[] = [];
  for (let i = afterFrontmatter; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (fence) {
      if (isFenceClose(line, fence)) {
        fence = null;
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      const marker = open[1] ?? "";
      fence = { char: marker[0] ?? "`", len: marker.length };
      continue;
    }
    if (HEADING_NEXT_ACTION.test(line)) {
      headings.push(i);
    }
  }
  if (headings.length !== 1) {
    return null;
  }
  const headingIndex = headings[0] ?? 0;
  let end = lines.length;
  fence = null;
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (fence) {
      if (isFenceClose(line, fence)) {
        fence = null;
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      const marker = open[1] ?? "";
      fence = { char: marker[0] ?? "`", len: marker.length };
      continue;
    }
    if (SECTION_END.test(line) && i !== headingIndex) {
      end = i;
      break;
    }
  }
  return { headingIndex, end };
}

function preservedHandoffAndSuffix(
  before: string,
  after: string,
  beforeReviewEnd: number,
  afterReviewEnd: number,
): boolean {
  const beforeLocated = locateNextHandoff(before.split("\n"));
  const afterLocated = locateNextHandoff(after.split("\n"));
  if (beforeLocated === null || afterLocated === null) {
    if (beforeLocated !== afterLocated) {
      return false;
    }
    return (
      before.split("\n").slice(beforeReviewEnd).join("\n") === after.split("\n").slice(afterReviewEnd).join("\n")
    );
  }
  const beforeHandoff = sectionSlice(before, beforeLocated.headingIndex, beforeLocated.end);
  const afterHandoff = sectionSlice(after, afterLocated.headingIndex, afterLocated.end);
  const identifiers = readIdentifierPair(before);
  if (identifiers === null) {
    return false;
  }
  const outstanding = identifiers.next_handoff_id !== "none";
  if (outstanding) {
    if (parseOutstandingHandoffSection(before, identifiers.next_handoff_id) === null) {
      return false;
    }
    if (afterHandoff !== RETRACTED_NEXT_HANDOFF_SECTION) {
      return false;
    }
  } else if (beforeHandoff !== afterHandoff) {
    return false;
  }
  const beforePrefix = sectionSlice(before, beforeReviewEnd, beforeLocated.headingIndex);
  const afterPrefix = sectionSlice(after, afterReviewEnd, afterLocated.headingIndex);
  const beforeSuffix = sectionSlice(before, beforeLocated.end, lineCount(before));
  const afterSuffix = sectionSlice(after, afterLocated.end, lineCount(after));
  return beforePrefix === afterPrefix && beforeSuffix === afterSuffix;
}

function lineCount(text: string): number {
  return text.split("\n").length;
}

function sectionSlice(text: string, startLine: number, endLine: number): string {
  const start = lineStartOffset(text, startLine);
  const end = lineStartOffset(text, endLine);
  return text.slice(start, end);
}

function lineStartOffset(text: string, lineIndex: number): number {
  if (lineIndex <= 0) {
    return 0;
  }
  let seen = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") {
      seen += 1;
      if (seen === lineIndex) {
        return i + 1;
      }
    }
  }
  return text.length;
}

function frontmatterBlock(text: string): string {
  const lines = text.split("\n");
  if ((lines[0] ?? "") !== FRONTMATTER_START) {
    return "";
  }
  const end = skipFrontmatter(lines);
  if (end === 0) {
    return "";
  }
  return lines.slice(0, end).join("\n");
}

function preservedFrontmatterSource(
  before: string,
  after: string,
  writeKind: "review" | "terminal_close" = "review",
): boolean {
  const beforeLines = frontmatterBlock(before).split("\n");
  const afterLines = frontmatterBlock(after).split("\n");
  if (beforeLines.length !== afterLines.length || beforeLines.length < 2) {
    return false;
  }
  const beforeKeys: string[] = [];
  const afterKeys: string[] = [];
  for (let i = 0; i < beforeLines.length; i += 1) {
    const beforeLine = beforeLines[i] ?? "";
    const afterLine = afterLines[i] ?? "";
    const beforeKey = FRONTMATTER_KEY_LINE.exec(beforeLine)?.[1];
    const afterKey = FRONTMATTER_KEY_LINE.exec(afterLine)?.[1];
    if (beforeKey !== undefined) {
      beforeKeys.push(beforeKey);
    }
    if (afterKey !== undefined) {
      afterKeys.push(afterKey);
    }
    if (beforeKey !== undefined && TASK_WRITE_FRONTMATTER_KEY_SET.has(beforeKey)) {
      if (afterKey !== beforeKey) {
        return false;
      }
      continue;
    }
    if (
      writeKind === "terminal_close" &&
      beforeKey !== undefined &&
      TERMINAL_CLOSE_FRONTMATTER_KEY_SET.has(beforeKey)
    ) {
      if (afterKey !== beforeKey) {
        return false;
      }
      continue;
    }
    if (beforeLine !== afterLine) {
      return false;
    }
  }
  if (beforeKeys.length !== afterKeys.length) {
    return false;
  }
  for (let i = 0; i < beforeKeys.length; i += 1) {
    if (beforeKeys[i] !== afterKeys[i]) {
      return false;
    }
  }
  return true;
}

function replaceTransitionFrontmatter(
  text: string,
  fields: {
    next_role: string;
    updated_at: string;
    identifiers?: { handoff_id: string; next_handoff_id: string };
  },
): string | null {
  const lines = text.split("\n");
  if ((lines[0] ?? "") !== FRONTMATTER_START) {
    return null;
  }
  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if ((lines[i] ?? "") === FRONTMATTER_START) {
      close = i;
      break;
    }
  }
  if (close < 0) {
    return null;
  }
  const next = [...lines];
  const at: Record<"next_role" | "updated_at" | "handoff_id" | "next_handoff_id", number> = {
    next_role: -1,
    updated_at: -1,
    handoff_id: -1,
    next_handoff_id: -1,
  };
  for (let i = 1; i < close; i += 1) {
    const key = FRONTMATTER_KEY_LINE.exec(next[i] ?? "")?.[1];
    if (key === "next_role" || key === "updated_at" || key === "handoff_id" || key === "next_handoff_id") {
      if (at[key] !== -1) {
        return null;
      }
      at[key] = i;
    }
  }
  if (at.next_role < 0 || at.updated_at < 0 || at.handoff_id < 0 || at.next_handoff_id < 0) {
    return null;
  }
  next[at.next_role] = `next_role: ${fields.next_role}`;
  next[at.updated_at] = `updated_at: ${fields.updated_at}`;
  if (fields.identifiers !== undefined) {
    next[at.handoff_id] = `handoff_id: ${fields.identifiers.handoff_id}`;
    next[at.next_handoff_id] = `next_handoff_id: ${fields.identifiers.next_handoff_id}`;
  }
  return next.join("\n");
}

function preservedIdentifierPair(before: string, after: string): boolean {
  const beforePair = readIdentifierPair(before);
  const afterPair = readIdentifierPair(after);
  if (beforePair === null || afterPair === null) {
    return false;
  }
  if (beforePair.next_handoff_id === "none") {
    return (
      frontmatterKeyLine(before, "handoff_id") === frontmatterKeyLine(after, "handoff_id") &&
      frontmatterKeyLine(before, "next_handoff_id") === frontmatterKeyLine(after, "next_handoff_id")
    );
  }
  return (
    afterPair.handoff_id === beforePair.next_handoff_id &&
    afterPair.next_handoff_id === "none" &&
    frontmatterKeyLine(after, "handoff_id") === `handoff_id: ${beforePair.next_handoff_id}` &&
    frontmatterKeyLine(after, "next_handoff_id") === "next_handoff_id: none"
  );
}

function readIdentifierPair(text: string): { handoff_id: string; next_handoff_id: string } | null {
  const handoff = frontmatterSourceValue(text, "handoff_id");
  const next = frontmatterSourceValue(text, "next_handoff_id");
  if (handoff === null || next === null) {
    return null;
  }
  if (!isCanonicalHandoffId(handoff.value) || !isCanonicalHandoffId(next.value)) {
    return null;
  }
  return { handoff_id: handoff.value, next_handoff_id: next.value };
}

function frontmatterKeyLine(text: string, key: string): string | undefined {
  const located = frontmatterSourceValue(text, key);
  return located?.line;
}

function frontmatterSourceValue(text: string, key: string): { line: string; value: string } | null {
  const lines = text.split("\n");
  if ((lines[0] ?? "") !== FRONTMATTER_START) {
    return null;
  }
  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if ((lines[i] ?? "") === FRONTMATTER_START) {
      close = i;
      break;
    }
  }
  if (close < 0) {
    return null;
  }
  let found: { line: string; value: string } | null = null;
  for (let i = 1; i < close; i += 1) {
    const line = lines[i] ?? "";
    const match = FRONTMATTER_KEY_LINE.exec(line);
    if (match?.[1] !== key) {
      continue;
    }
    if (found !== null) {
      return null;
    }
    found = { line, value: line.slice(match[0].length).trim() };
  }
  return found;
}

function applyTemplatePlaceholderCleanup(text: string): string | null {
  const lines = text.split("\n");
  const scan = scanDocument(lines);
  if (!scan.ok || !scanAcceptsWrite(scan) || scan.regions.length < 1) {
    return null;
  }
  const last = scan.regions[scan.regions.length - 1];
  if (!last) {
    return null;
  }
  const headingEnd = scan.review.end;
  const interiorStart = last.endIndex + 1;
  const interior = lines.slice(interiorStart, headingEnd);
  const exact =
    headingEnd < lines.length &&
    interior.length === TEMPLATE_PENDING_INTERIOR.length + 1 &&
    interior[0] === "" &&
    TEMPLATE_PENDING_INTERIOR.every((line, index) => interior[index + 1] === line);
  let next = lines;
  if (exact) {
    next = [...lines];
    next.splice(interiorStart + 1, TEMPLATE_PENDING_INTERIOR.length);
  }
  const nextScan = scanDocument(next);
  if (!nextScan.ok || !scanAcceptsWrite(nextScan) || nextScan.regions.length < 1) {
    return null;
  }
  if (humanSegments(next, nextScan).some((segment) => segment.includes(TEMPLATE_PENDING_TOKEN))) {
    return null;
  }
  return next.join("\n");
}

// Every distinct way `## Next Handoff` can fail to parse as a retractable
// outstanding envelope. Surfaced as a bracketed token in the pre-dispatch
// diagnostic (0061 D2) so a producer round knows which sub-rule to fix rather
// than guessing. Kept a closed union so a test covers each.
export const NEXT_HANDOFF_REJECT_SLUGS = [
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
] as const;

export type NextHandoffRejectSlug = (typeof NEXT_HANDOFF_REJECT_SLUGS)[number];

export type OutstandingHandoffParse =
  | { located: { headingIndex: number; end: number }; advisory: string; prompt: string }
  | { reject: NextHandoffRejectSlug };

function retractNextHandoffSection(text: string, expectedId: string): string | null {
  const parsed = parseOutstandingHandoffSection(text, expectedId);
  if (!("located" in parsed)) {
    return null;
  }
  const start = lineStartOffset(text, parsed.located.headingIndex);
  const end = lineStartOffset(text, parsed.located.end);
  return `${text.slice(0, start)}${RETRACTED_NEXT_HANDOFF_SECTION}${text.slice(end)}`;
}

/**
 * Name which `## Next Handoff` sub-rule rejects the section, or null when it
 * parses fine. Runs the same pipeline `checkArtifactWriteShape` runs before the
 * retract step (0061 D2). The `trailing_content` slug covers the lone extra
 * blank line after the closing fence — the diagnostic tells the producer to
 * remove it rather than silently normalising bytes near a byte-exact write.
 */
export function describeNextHandoffRejection(text: string, reviewKind: ReviewKind): NextHandoffRejectSlug | null {
  const identifiers = readIdentifierPair(text);
  if (identifiers === null || identifiers.next_handoff_id === "none") {
    return null;
  }
  const spliced = spliceRegion(text, probeRegion(reviewKind));
  const cleaned = spliced === null ? text : (applyTemplatePlaceholderCleanup(spliced) ?? spliced);
  const parsed = parseOutstandingHandoffSection(cleaned, identifiers.next_handoff_id);
  return "reject" in parsed ? parsed.reject : null;
}

export function parseOutstandingHandoffSection(text: string, expectedId: string): OutstandingHandoffParse {
  if (expectedId === "none" || !isCanonicalHandoffId(expectedId)) {
    return { reject: "identifier_not_canonical" };
  }
  const lines = text.split("\n");
  const located = locateNextHandoff(lines);
  if (located === null) {
    return { reject: "section_absent" };
  }
  const body = lines.slice(located.headingIndex, located.end);
  if (body[0] !== "## Next Handoff" || body[1] !== "" || body[2] !== FENCE_OPEN_TEXT) {
    return { reject: "opening_shape" };
  }
  let advisoryClose = -1;
  for (let i = 3; i < body.length; i += 1) {
    const line = body[i] ?? "";
    if (line === FENCE_CLOSE) {
      advisoryClose = i;
      break;
    }
    if (FENCE_OPEN.test(line)) {
      return { reject: "advisory_fence_nested" };
    }
  }
  if (advisoryClose < 0) {
    return { reject: "advisory_fence_unclosed" };
  }
  if (body[advisoryClose + 1] !== "" || body[advisoryClose + 2] !== FENCE_OPEN_TEXT) {
    return { reject: "prompt_block_missing" };
  }
  let promptClose = -1;
  for (let i = advisoryClose + 3; i < body.length; i += 1) {
    const line = body[i] ?? "";
    if (line === FENCE_CLOSE) {
      promptClose = i;
      break;
    }
    if (FENCE_OPEN.test(line)) {
      return { reject: "prompt_fence_nested" };
    }
  }
  if (promptClose < 0) {
    return { reject: "prompt_fence_unclosed" };
  }
  const remainder = body.slice(promptClose + 1);
  // Any run of blank lines after the closing fence is fine — the whole section
  // is replaced on retract, so trailing whitespace there survives nothing. Only
  // non-blank content after the prompt fence is a real defect. (0061 D3 revised.)
  if (remainder.some((line) => line !== "")) {
    return { reject: "trailing_content" };
  }
  const advisory = body.slice(3, advisoryClose).join("\n");
  const prompt = body.slice(advisoryClose + 3, promptClose).join("\n");
  const handoffLine = `- Handoff: ${expectedId}`;
  const handoffMark = `(handoff ${expectedId})`;
  if (advisory.split("\n").filter((line) => line === handoffLine).length !== 1) {
    return { reject: "advisory_handoff_line" };
  }
  if (prompt.split(handoffMark).length - 1 !== 1) {
    return { reject: "prompt_handoff_mark" };
  }
  const ids = canonicalIdsIn(`${advisory}\n${prompt}`);
  if (ids.length !== 2 || ids.some((id) => id !== expectedId)) {
    return { reject: "stray_identifier" };
  }
  return { located, advisory, prompt };
}

function locateNextHandoff(lines: string[]): { headingIndex: number; end: number } | null {
  const afterFrontmatter = skipFrontmatter(lines);
  let fence: { char: string; len: number } | null = null;
  const headings: number[] = [];
  for (let i = afterFrontmatter; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (fence) {
      if (isFenceClose(line, fence)) {
        fence = null;
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      const marker = open[1] ?? "";
      fence = { char: marker[0] ?? "`", len: marker.length };
      continue;
    }
    if (HEADING_NEXT_HANDOFF.test(line)) {
      headings.push(i);
    }
  }
  if (headings.length !== 1) {
    return null;
  }
  const headingIndex = headings[0] ?? 0;
  let end = lines.length;
  fence = null;
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (fence) {
      if (isFenceClose(line, fence)) {
        fence = null;
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      const marker = open[1] ?? "";
      fence = { char: marker[0] ?? "`", len: marker.length };
      continue;
    }
    if (SECTION_END.test(line) && i !== headingIndex) {
      end = i;
      break;
    }
  }
  return { headingIndex, end };
}

function canonicalIdsIn(text: string): string[] {
  const matches = text.match(CANONICAL_ID_TOKEN) ?? [];
  return matches.filter((id) => isCanonicalHandoffId(id) && id !== "none");
}

function calendarDateUtc(timestamp: string): string | null {
  const date = timestamp.slice(0, 10);
  if (!isCalendarDate(date)) {
    return null;
  }
  return date;
}

export function headingRejects(text: string): boolean {
  const lines = text.split("\n");
  const afterFrontmatter = skipFrontmatter(lines);
  let fence: { char: string; len: number } | null = null;
  let count = 0;
  for (let i = afterFrontmatter; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (fence) {
      if (isFenceClose(line, fence)) {
        fence = null;
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      const marker = open[1] ?? "";
      fence = { char: marker[0] ?? "`", len: marker.length };
      continue;
    }
    if (HEADING_REVIEW.test(line)) {
      count += 1;
    }
  }
  return count !== 1;
}
