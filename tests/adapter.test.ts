import assert from "node:assert/strict";
import test from "node:test";
import {
  CLAUDE_HELP_TOKENS,
  CLAUDE_IMPLEMENTATION_REVIEW_PROMPT,
  CLAUDE_REVIEW_PROMPT,
  claudeCapabilities,
} from "../src/adapters/claude.ts";
import {
  CODEX_HELP_TOKENS,
  CODEX_IMPLEMENTATION_REVIEW_PROMPT,
  CODEX_REVIEW_PROMPT,
  codexCapabilities,
} from "../src/adapters/codex.ts";
import {
  CURSOR_HELP_TOKENS,
  CURSOR_IMPLEMENTATION_REVIEW_PROMPT,
  CURSOR_REVIEW_PROMPT,
  cursorCapabilities,
} from "../src/adapters/cursor.ts";
import {
  GROK_HELP_TOKENS,
  GROK_IMPLEMENTATION_REVIEW_PROMPT,
  GROK_REVIEW_PROMPT,
  grokCapabilities,
} from "../src/adapters/grok.ts";
import { reviewOutputSchema } from "../src/adapters/review-schema.ts";
import { validateReviewResult } from "../src/core/result.ts";
import {
  REVIEW_FINDING_MESSAGE_MAX_CHARS,
  REVIEW_MAX_FINDINGS,
  REVIEW_SUMMARY_MAX_CHARS,
} from "../src/core/contracts.ts";
import type { AdapterCapabilities } from "../src/core/contracts.ts";

// D7 (task 0046): a lie where `structured_output: true` sits beside a CLI with
// no schema flag would only surface later as `output_unparsable` failures.
const SCHEMA_FLAGS = ["--json-schema", "--output-schema"];

function helpTokensCarryASchemaFlag(tokens: readonly string[]): boolean {
  return tokens.some((token) => SCHEMA_FLAGS.includes(token));
}

const REGISTERED_NON_FAKE_ADAPTERS: { name: string; caps: AdapterCapabilities; tokens: readonly string[] }[] = [
  { name: "cursor", caps: cursorCapabilities(), tokens: CURSOR_HELP_TOKENS },
  { name: "codex", caps: codexCapabilities(), tokens: CODEX_HELP_TOKENS },
  { name: "grok", caps: grokCapabilities(), tokens: GROK_HELP_TOKENS },
  { name: "claude", caps: claudeCapabilities(), tokens: CLAUDE_HELP_TOKENS },
];

test("every registered non-fake adapter's structured_output matches its help-token schema-flag surface", () => {
  for (const adapter of REGISTERED_NON_FAKE_ADAPTERS) {
    assert.equal(
      adapter.caps.structured_output,
      helpTokensCarryASchemaFlag(adapter.tokens),
      `${adapter.name}: structured_output must be true iff *_HELP_TOKENS carries --json-schema / --output-schema`,
    );
  }
});

test("Cursor declares false with no flag; Codex, Grok, and Claude declare true with a flag", () => {
  assert.equal(cursorCapabilities().structured_output, false);
  assert.equal(helpTokensCarryASchemaFlag(CURSOR_HELP_TOKENS), false);
  for (const [caps, tokens] of [
    [codexCapabilities(), CODEX_HELP_TOKENS],
    [grokCapabilities(), GROK_HELP_TOKENS],
    [claudeCapabilities(), CLAUDE_HELP_TOKENS],
  ] as const) {
    assert.equal(caps.structured_output, true);
    assert.equal(helpTokensCarryASchemaFlag(tokens), true);
  }
});

test("a mis-declaring adapter fails the same invariant", () => {
  // structured_output: true with no schema flag — the exact lie D7 guards.
  assert.equal(helpTokensCarryASchemaFlag(["--print", "--output-format"]) === true, false);
  // structured_output: false while a schema flag is present is equally a mismatch.
  assert.notEqual(false, helpTokensCarryASchemaFlag(["--json-schema"]));
});

// Two live implementation reviews (run-e91670d5, run-4299c737) were discarded
// whole because the reviewer wrote a 2028- then a 2186-character summary against
// a 2000 cap no prompt mentioned. The budget is the fix; the headroom below is
// the safety net, because a prose instruction is weaker than a schema.
const EVERY_REVIEWER_PROMPT = [
  CLAUDE_REVIEW_PROMPT,
  CLAUDE_IMPLEMENTATION_REVIEW_PROMPT,
  CODEX_REVIEW_PROMPT,
  CODEX_IMPLEMENTATION_REVIEW_PROMPT,
  GROK_REVIEW_PROMPT,
  GROK_IMPLEMENTATION_REVIEW_PROMPT,
  CURSOR_REVIEW_PROMPT,
  CURSOR_IMPLEMENTATION_REVIEW_PROMPT,
];

test("every reviewer prompt budgets summary and finding message inside the schema caps", () => {
  assert.equal(EVERY_REVIEWER_PROMPT.length, 8);
  for (const prompt of EVERY_REVIEWER_PROMPT) {
    assert.match(prompt, /Length budget\./);
    assert.match(prompt, /Keep summary under 1200 characters/);
    assert.match(prompt, /each finding message under 1200 characters/);
    assert.match(prompt, /the entire review is discarded/);
  }
  // The budget must stay strictly inside both enforced caps, or it is advice
  // that still loses a review.
  assert.equal(1200 < REVIEW_SUMMARY_MAX_CHARS, true);
  assert.equal(1200 < REVIEW_FINDING_MESSAGE_MAX_CHARS, true);
});

test("the schema handed to the client and the Bridge-side validator share one cap", () => {
  for (const kind of ["plan", "implementation"] as const) {
    const schema = JSON.parse(reviewOutputSchema(kind));
    assert.equal(schema.properties.summary.maxLength, REVIEW_SUMMARY_MAX_CHARS);
    assert.equal(schema.properties.findings.items.properties.message.maxLength, REVIEW_FINDING_MESSAGE_MAX_CHARS);
  }
  const atCap = {
    schema_version: 2,
    review_kind: "implementation",
    verdict: "pass",
    summary: "x".repeat(REVIEW_SUMMARY_MAX_CHARS),
    findings: [],
  };
  assert.equal(validateReviewResult(atCap, "implementation").summary.length, REVIEW_SUMMARY_MAX_CHARS);
  assert.throws(
    () => validateReviewResult({ ...atCap, summary: "x".repeat(REVIEW_SUMMARY_MAX_CHARS + 1) }, "implementation"),
    /result_schema_invalid/,
  );
  // The real failure: a summary the old cap rejected is now accepted.
  assert.equal(validateReviewResult({ ...atCap, summary: "x".repeat(2186) }, "implementation").summary.length, 2186);
  const schema = JSON.parse(reviewOutputSchema("implementation"));
  assert.equal(schema.properties.findings.maxItems, REVIEW_MAX_FINDINGS);
});

// The schema the client is handed counts Unicode code points (JSON Schema
// maxLength); JavaScript `.length` counts UTF-16 code units. Sharing the number
// without sharing the unit let a reviewer satisfy its own instructions and the
// schema and still be rejected here, which is the loss these caps exist to
// prevent. An ASCII-only test cannot see it: every assertion below passes with
// the old `.length` checks unless the string leaves the BMP.
const NON_BMP = "\u{1F600}"; // one code point, two UTF-16 code units

function summaryOf(text: string) {
  return { schema_version: 2, review_kind: "implementation" as const, verdict: "pass" as const, summary: text, findings: [] };
}

test("the validator counts summary and message in code points, as the schema does", () => {
  const atCap = NON_BMP.repeat(REVIEW_SUMMARY_MAX_CHARS);
  assert.equal([...atCap].length, REVIEW_SUMMARY_MAX_CHARS);
  assert.equal(atCap.length, REVIEW_SUMMARY_MAX_CHARS * 2, "premise: non-BMP doubles UTF-16 length");
  assert.equal(validateReviewResult(summaryOf(atCap), "implementation").summary, atCap);
  assert.throws(
    () => validateReviewResult(summaryOf(NON_BMP.repeat(REVIEW_SUMMARY_MAX_CHARS + 1)), "implementation"),
    /result_schema_invalid/,
  );

  // A reviewer that obeys the prompt's own 1200-character budget in non-BMP text
  // was rejected here at 2200 UTF-16 units before this fix.
  const budgeted = NON_BMP.repeat(1200);
  const withFinding = {
    schema_version: 2,
    review_kind: "implementation" as const,
    verdict: "changes_requested" as const,
    summary: "ok",
    findings: [{ id: "A", severity: "error" as const, message: budgeted }],
  };
  assert.equal(validateReviewResult(withFinding, "implementation").findings[0]?.message, budgeted);
  const atMessageCap = NON_BMP.repeat(REVIEW_FINDING_MESSAGE_MAX_CHARS);
  assert.equal(
    validateReviewResult({ ...withFinding, findings: [{ id: "A", severity: "error", message: atMessageCap }] }, "implementation")
      .findings[0]?.message,
    atMessageCap,
  );
  assert.throws(
    () => validateReviewResult(
      { ...withFinding, findings: [{ id: "A", severity: "error", message: NON_BMP.repeat(REVIEW_FINDING_MESSAGE_MAX_CHARS + 1) }] },
      "implementation",
    ),
    /result_schema_invalid/,
  );
});
