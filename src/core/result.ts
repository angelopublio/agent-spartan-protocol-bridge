import {
  isReviewKind,
  isSchemaVersion,
  REVIEW_FINDING_MESSAGE_MAX_CHARS,
  REVIEW_MAX_FINDINGS,
  REVIEW_SUMMARY_MAX_CHARS,
  SCHEMA_VERSION,
  type BridgeVerdict,
  type ReviewFinding,
  type ReviewKind,
  type ReviewResult,
} from "./contracts.ts";

const VERDICTS = new Set<BridgeVerdict>([
  "pass",
  "changes_requested",
  "human_required",
  "blocked",
]);
const SEVERITIES = new Set(["info", "warning", "error"]);
const FINDING_ID = /^[A-Z][A-Z0-9_-]{0,31}$/;
const RESULT_KEYS = ["schema_version", "review_kind", "verdict", "summary", "findings"];
const FINDING_KEYS = ["id", "severity", "message"];

export function validateReviewResult(value: unknown, reviewKind: ReviewKind): ReviewResult {
  if (!isPlainObject(value) || hasUnknownKeys(value, RESULT_KEYS)) {
    throw new Error("result_schema_invalid");
  }
  if (!isSchemaVersion(value.schema_version)) {
    throw new Error("result_schema_invalid");
  }
  if (!isReviewKind(value.review_kind) || value.review_kind !== reviewKind) {
    throw new Error("result_schema_invalid");
  }
  if (typeof value.verdict !== "string" || !VERDICTS.has(value.verdict as BridgeVerdict)) {
    throw new Error("result_schema_invalid");
  }
  if (
    typeof value.summary !== "string" ||
    value.summary.length < 1 ||
    codePointLength(value.summary) > REVIEW_SUMMARY_MAX_CHARS
  ) {
    throw new Error("result_schema_invalid");
  }
  if (!Array.isArray(value.findings) || value.findings.length > REVIEW_MAX_FINDINGS) {
    throw new Error("result_schema_invalid");
  }
  const findings: ReviewFinding[] = [];
  for (const item of value.findings) {
    findings.push(validateFinding(item));
  }
  const verdict = value.verdict as BridgeVerdict;
  if (verdict === "pass" && findings.length !== 0) {
    throw new Error("result_schema_invalid");
  }
  if (
    verdict === "changes_requested" &&
    !findings.some((finding) => finding.severity === "warning" || finding.severity === "error")
  ) {
    throw new Error("result_schema_invalid");
  }
  return {
    schema_version: SCHEMA_VERSION,
    review_kind: reviewKind,
    verdict,
    summary: value.summary,
    findings,
  };
}

function validateFinding(value: unknown): ReviewFinding {
  if (!isPlainObject(value) || hasUnknownKeys(value, FINDING_KEYS)) {
    throw new Error("result_schema_invalid");
  }
  if (typeof value.id !== "string" || !FINDING_ID.test(value.id)) {
    throw new Error("result_schema_invalid");
  }
  if (typeof value.severity !== "string" || !SEVERITIES.has(value.severity)) {
    throw new Error("result_schema_invalid");
  }
  if (
    typeof value.message !== "string" ||
    value.message.length < 1 ||
    codePointLength(value.message) > REVIEW_FINDING_MESSAGE_MAX_CHARS
  ) {
    throw new Error("result_schema_invalid");
  }
  return {
    id: value.id,
    severity: value.severity as ReviewFinding["severity"],
    message: value.message,
  };
}

// JSON Schema `maxLength` counts Unicode code points; JavaScript `.length`
// counts UTF-16 code units. Sharing a number between the two layers is not
// sharing a limit: a summary of 3000 non-BMP code points satisfies the 4000
// the client is handed and then dies here at 6000 units, which is the exact
// paid-review loss D-071 set out to remove. Count what the schema counts.
function codePointLength(value: string): number {
  let count = 0;
  for (const _ of value) {
    count += 1;
  }
  return count;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasUnknownKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const keys = Object.keys(value);
  if (keys.length !== allowed.length) {
    return true;
  }
  return allowed.some((key) => !keys.includes(key));
}
