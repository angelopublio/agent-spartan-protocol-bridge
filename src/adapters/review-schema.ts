import {
  REVIEW_FINDING_MESSAGE_MAX_CHARS,
  REVIEW_MAX_FINDINGS,
  REVIEW_SUMMARY_MAX_CHARS,
  SCHEMA_VERSION,
  type ReviewKind,
} from "../core/contracts.ts";

// The JSON Schema every schema-constrained reviewer CLI is handed so its final
// message is forced to the verdict contract rather than trusted to the model.
// Codex passes it via `--output-schema`, Grok and Claude Code via `--json-schema`.
export function reviewOutputSchema(reviewKind: ReviewKind): string {
  return `${JSON.stringify({
    type: "object",
    additionalProperties: false,
    required: ["schema_version", "review_kind", "verdict", "summary", "findings"],
    properties: {
      schema_version: { type: "integer", const: SCHEMA_VERSION },
      review_kind: { type: "string", const: reviewKind },
      verdict: {
        type: "string",
        enum: ["pass", "changes_requested", "human_required", "blocked"],
      },
      summary: { type: "string", minLength: 1, maxLength: REVIEW_SUMMARY_MAX_CHARS },
      findings: {
        type: "array",
        maxItems: REVIEW_MAX_FINDINGS,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "severity", "message"],
          properties: {
            id: { type: "string", pattern: "^[A-Z][A-Z0-9_-]{0,31}$" },
            severity: { type: "string", enum: ["info", "warning", "error"] },
            message: { type: "string", minLength: 1, maxLength: REVIEW_FINDING_MESSAGE_MAX_CHARS },
          },
        },
      },
    },
  })}\n`;
}
