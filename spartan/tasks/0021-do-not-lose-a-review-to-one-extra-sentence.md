---
protocol: "1.0.0" # x-release-please-version
id: do-not-lose-a-review-to-one-extra-sentence
created_at: 2026-08-19
status: completed
phase: complete
task_type: implementation
risk: material
current_role: implementer
next_role: human-operator
updated_at: 2026-08-19
handoff_id: HX-006
next_handoff_id: none
---

# Do not lose a review to one extra sentence

## Objective

A plan review whose reviewer writes one more sentence after its JSON verdict still yields that
verdict. When extraction genuinely fails, the run leaves enough retained evidence to name the cause
instead of failing blind.

## Context

**This is measured, not suspected.** Task `0020` took seven Bridge review runs; three failed
`adapter_error` / `collect` / `output_unparsable` with exit code 0 and zero stderr bytes, and the
last three attempts before the approval were all failures. Each failure cost about two and a half
minutes and produced nothing to look at: under `stream-json` the adapter retains only the payload and
its counters, per task `0019` D5, so `stderr_bytes: 0` and `stderr_log: null` was the whole record.

**The cause was found by capturing one raw stream by hand.** The child's `result.result` is the
concatenation of its assistant messages with no separator — first prose (`"I'll review only task.md
and AGENTS.md as specified, then return the JSON verdict."`), then the JSON object.
`extractReviewPayload` resolves that shape at its third step by taking the **last closed balanced**
`{...}` span rather than the last span that parses — and at its first step by taking the last fenced
JSON block with no fall-through when that fence body is not JSON. Probed against the real function with
the captured text:

| Input | Result |
| --- | --- |
| the captured text as it arrived | `verdict=changes_requested` |
| plus a closing sentence with no brace | `verdict=changes_requested` |
| plus a closing sentence with one unmatched `{` | `verdict=changes_requested` |
| plus a closing sentence containing a balanced `{ … }` pair | `undefined` — unparsable |
| plus a fenced block holding non-JSON braces | `undefined` — unparsable |

One brace **pair** after the verdict is enough; a lone unmatched `{` is harmless, because it stays on
the matcher's stack and never closes a span. Row 3 was wrong when this task was created — it claimed a
single literal `{` was fatal — and is corrected here by re-probing the real function, because the
distinction decides which of AC1's regression cases actually fail today. The reviewed artifact in `0020`
is full of shapes like `{ after_run_id, cycle, max_cycles, refused }`, which is a closed pair, so a
reviewer that ends with a sentence quoting the record it just asked about destroys its own verdict. That
is consistent with all three failures having started a tool call late, after the verdict was already
produced: a model that keeps working after the JSON also keeps writing after it.

**What this is not.** It is not a `stream-json` problem, not a cap problem, and not a client bug. The
same extractor has the same weakness on the single-document transport; `stream-json` only made it
visible by letting reviewers talk more.

## Scope

- `src/adapters/cursor.ts`: `extractReviewPayload`, the comment block that documents its precedence,
  the candidate-scan cap constant, and the `collect` failure path that raises `output_unparsable`.
- `src/adapters/adapter.ts`: `AdapterFailureError` carries the failed candidate text beside the stderr
  it already carries, so the retention decision stays in the core rather than in the adapter.
- `src/core/contracts.ts`: a pointer to the retained payload on the existing `AdapterFailureRecord`.
- `src/core/serialize.ts`: `serializeAdapterFailure` emits that pointer.
- `src/core/review.ts`: `persistAdapterFailure` writes the retained file beside the stderr log it
  already writes.
- `src/policy/redact.ts`: reused, not extended, unless a probe shows a gap; it gains only the retention
  cap and truncation-marker constants.
- `src/runtime/store.ts`: one atomic `0600` writer beside the existing adapter-stderr writer.
- Tests: the extractor's existing fixtures, the five probe cases above as regression cases, the scan
  bound, and the retention path.

## Out of Scope

- Retry, backoff, or any reaction to a failed extraction. The run still fails closed.
- Relaying any retained text to the terminal. Task `0019` D4 stands.
- The prompt sent to the reviewer. Asking the model to stop talking is a mitigation, not a fix, and it
  cannot be enforced.
- The MCP path and the Bridge's stdout contract.
- Changing what a valid review result must contain; `validateReviewResult` is untouched.

## Constraints

- No retained provider text on stdout, on stderr, in `status.json`, or in `events.jsonl`.
- Retention happens only on the failure path. A run that parses retains exactly what it retains today.
- The retained file is mode `0600`, written atomically, bounded, and redacted through the existing
  pass before it is written.
- `SCHEMA_VERSION` stays `2` and `EventDocument` is unchanged, as in D-018.
- No new runtime dependency.

## Acceptance Criteria

- [x] The five probe cases in Context are regression tests: the captured shape, a braceless trailing
      sentence, a trailing sentence with one unmatched `{`, a trailing sentence containing a balanced
      `{ … }` pair, and a trailing fence with non-JSON braces all yield the verdict. The last two are
      the cases that fail today; the first three already pass and are pinned so the change does not
      trade one for the other.
- [x] Every existing `extractReviewPayload` fixture keeps its current result, asserted by running the
      pinned cases unmodified.
- [x] A payload for which extraction returns `undefined` — the scan found no verdict-shaped candidate
      **and** the fallback produced nothing either — still terminates the run `adapter_error` with
      `output_unparsable`, not with a different code. This criterion covers only the `undefined` case.
- [x] A candidate that parses but is not verdict-shaped is returned by the fallback and handed to
      `validateReviewResult`, so a malformed-but-present result still fails as `result_schema_invalid`
      and never reaches the `output_unparsable` path above.
- [x] The candidate scan is bounded by `CURSOR_CANDIDATE_SCAN_CAP` parse attempts counted from the end:
      the existing 250,000-unmatched-brace fixture keeps its result and its sub-second bound, and a
      payload whose tail holds more than `CURSOR_CANDIDATE_SCAN_CAP` closed non-JSON spans after a valid
      verdict object fails closed within the same bound instead of scanning the whole payload.
- [x] On `output_unparsable`, the run directory holds a bounded, redacted, mode `0600`
      `adapter-payload.log` with the candidate text, and `adapter_failure.payload_log` names it by that
      run-directory-relative name.
- [x] A candidate containing a credential-shaped string and a home-directory path produces a retained
      file with neither, asserted over the file bytes.
- [x] A run that parses successfully writes no such file, asserted by listing the run directory.
- [x] A candidate larger than `RETAINED_PAYLOAD_CAP_BYTES` is truncated rather than refused: the file
      holds `RETAINED_PAYLOAD_TRUNCATION_MARKER` as its first line, then exactly the last
      `RETAINED_PAYLOAD_CAP_BYTES` bytes of the redacted text, asserted over the file bytes. A candidate
      at or under the cap produces a file with no marker line.
- [x] `npm run typecheck` and `npm test` exit 0.

## Decisions

### D1 - Scan every candidate object from the end and take the first verdict-shaped one

Extraction gains one step in front of today's precedence, and today's precedence is not otherwise
modified. After the existing unwrapping of the client envelope — a `result` string, a `type: "result"`
object, or the NDJSON result record — the candidate text is scanned once to build a **candidate set**:

- every balanced `{...}` span the existing string-aware matcher closes, including spans nested inside
  another span, recorded as index pairs during that single pass rather than sliced out of the text; and
- every fenced JSON block body, not only the last one.

Candidates are ordered by closing offset, descending, so the scan runs from the end of the text
backwards: a trailing prose span is tried before the verdict object, and the verdict object before its
own `findings` children. The first candidate that parses **and** is verdict-shaped is the result.
Verdict-shaped means a plain object carrying all three of `schema_version`, `review_kind`, and
`verdict`; their values are not inspected, because judging them is `validateReviewResult`'s job and this
step must not become a second validator.

The scan is bounded by `CURSOR_CANDIDATE_SCAN_CAP`, 64 parse attempts from the end. The bound is what
keeps the step from becoming quadratic on a deeply nested multi-megabyte payload, where every enclosing
span would otherwise be parsed in full; 64 is far above any real review object, whose spans are one
outer object plus one per finding, all reached in the first few attempts.

Today's behaviour becomes the fallback, reached only when that scan finds no verdict-shaped candidate:
the last fenced block parsed, else the whole candidate parsed, else the last closed balanced span
parsed, else `undefined`. So the old last-brace path runs only after the whole candidate set has been
scanned and rejected — never before it, and never because a trailing fence or a trailing brace pair
happened to sit closer to the end. A malformed-but-present object still arrives at
`validateReviewResult` and still fails as `result_schema_invalid`: this change alters which object is
chosen, never which failure class a chosen object produces.

One consequence is accepted rather than hidden. A payload whose tail holds more than 64 closed non-JSON
spans before the verdict object is reached still fails closed, exactly as today — that is a reviewer
writing 64 brace pairs after its own verdict, which is a worse shape than the one this task was opened
for, and the alternative is an unbounded scan.

### D2 - Retain on failure only, under a named cap and a named marker, and point at it from the record D-018 already added

When extraction fails, the candidate text — the same string the scan just rejected — is carried out of
the adapter on `AdapterFailureError`, beside the stderr that error already carries, so that
`persistAdapterFailure` owns the write exactly as it owns the stderr write today. It is redacted through
`redactAdapterStderrText`, truncated, and written atomically at mode `0600` into the run directory as
`adapter-payload.log`, beside the `adapter-stderr.log` that D-018 established. `AdapterFailureRecord`
gains `payload_log: string | null`, a run-directory-relative name that is null on every path retaining
nothing, and `serializeAdapterFailure` emits it. Nothing else changes: no new event, no new reason code,
no status field outside that record.

The cap is `RETAINED_PAYLOAD_CAP_BYTES`, 16 KiB, declared beside `ADAPTER_STDERR_CAP_BYTES` in the same
module. It equals the stderr bound deliberately — one number to hold in the head — and it is sized from
the capture: the verdict object was 1196 bytes, so 16 KiB carries the object plus far more of the prose
that displaced it than a diagnosis needs. It is nonetheless its own constant, so the two bounds can
diverge later without one edit moving both.

Truncation keeps the **tail**, as the stderr path does, because the verdict object belongs at the end of
the payload and the end is where the failure is. The marker is `RETAINED_PAYLOAD_TRUNCATION_MARKER`, the
single line `[truncated: earlier bytes dropped]`, prepended only when truncation occurred, so an
untruncated file carries no marker and a truncated file is at most that line plus the cap. Redaction
runs over the whole text before truncation, never after: cutting first can split a credential across the
boundary and leave a fragment that no pattern matches.

This is deliberately the narrow option. The wide one — keeping a rolling buffer of assistant messages
during every run so the dump can show where the JSON went — is rejected, and the capture is why: the
child's `result.result` already contains the concatenation of the assistant messages, so the payload
was never missing. Buying retention on every run to recover text that is already in the candidate
would spend exactly what task `0019` D5 refused to spend.

### D3 - The fix is the extractor; the retention is for the next unknown class

D1 addresses the failure this task can explain. D2 exists because the next failure will be one this
task cannot predict, and three runs failing with `stderr_bytes: 0` and nothing retained is what turned
a two-minute diagnosis into a hand-run capture. The two ship together because either alone leaves the
loop of task `0020` either still broken or still blind.

### D4 - Nothing reacts to the failure

No retry, no second attempt with a different transport, no prompt change. A run that cannot extract a
verdict still terminates `adapter_error` and still stops for the human. This task makes the failure
rarer and legible; it does not make the runtime clever about it.

## Work Completed

- Planner (Claude Code, claude-opus-5, effort high, Anthropic): created this task from a diagnosis
  performed during task `0020`. No product file was edited.
- Planner (Claude Code, claude-opus-5, effort high, Anthropic), second planning round: answered the three recorded
  findings by rewriting D1 around a bounded candidate-set scan whose fallback runs only after the scan,
  rewriting D2 with a named cap and a named truncation marker, and re-cutting AC1, AC3, AC4, and the
  retention criteria so the fallback path no longer contradicts them. Corrected the Context probe table
  and widened Scope to the three files the retention pointer actually crosses. No product file was
  edited.
- Implementer (Cursor, cursor-grok-4.6-high-fast, effort none): accepted HX-004. Implemented D1 as a
  bounded candidate-set scan in `extractReviewPayload` (`CURSOR_CANDIDATE_SCAN_CAP` = 64) with today's
  precedence as fallback only after every candidate is rejected. Implemented D2: `AdapterFailureError`
  carries the failed candidate; `persistAdapterFailure` redacts then truncates and writes
  `adapter-payload.log` at mode `0600`; `AdapterFailureRecord.payload_log` points at it. Added the
  five probe regressions, the scan-cap case, and the retention path tests.
- Reviewer (Claude Code, claude-opus-5, effort high, Anthropic): accepted HX-005 and reviewed the D1
  scan and the D2 retention path against all ten acceptance criteria. Read-only: no product file, test
  file, or configuration was edited in that round.
- Implementer (Cursor, cursor-grok-4.6-high-fast, effort none): accepted HX-006. Closed the task and
  committed the reviewed change with this artifact in one commit. No product file was edited in this
  round.

## Evidence

- Failure rate during task `0020`: three `output_unparsable` failures in seven review runs
  (`run-2a708f27`, `run-eb932dd6`, `run-5476046e`), all `collect`, exit code 0, `stderr_bytes: 0`,
  `stderr_log: null`, nothing written to the artifact. All three showed a third tool call starting
  after the reasoning phase and immediately before the `result` record; none of the four successful
  runs did, including one that made four tool calls early.
- Raw capture of one review, run by the owner with the adapter's exact argv, prompt, and two-file
  workspace: 1346 records, `result/success`, `is_error: false`, `result` a 1282-character string equal
  to the concatenation of two assistant messages — 86 characters of prose, then the 1196-character
  JSON object. The capture stays outside the repository.
- Probe of the real `extractReviewPayload` against that text and three variants: the table in Context.
- Re-probe on 2026-08-19 (`node --import tsx`, script outside the repository, importing
  `src/adapters/cursor.ts` directly) against the captured shape and four variants: captured →
  `changes_requested`; braceless trailing sentence → `changes_requested`; trailing sentence with one
  unmatched `{` → `changes_requested`; trailing sentence containing
  `{ after_run_id, cycle, max_cycles, refused }` → `undefined`; trailing non-JSON fence → `undefined`.
  This corrects the third row the task was created with: the fatal shape is a closed brace pair, not a
  lone `{`.
- Cycle-2 planning round: `npm run typecheck` exit 0; `npm test` 160 passed, 0 failed, 0 skipped. No
  product file was modified, so these record the baseline the implementation round starts from.
- Implementation round: `npm run typecheck` exit 0; `npm test` 162 passed, 0 failed, 0 skipped. The two
  added tests pin the five probe shapes plus the scan cap, and the retention path including redaction,
  truncation with `RETAINED_PAYLOAD_TRUNCATION_MARKER`, and the successful-parse absence of the file.
- Review round: `npm run typecheck` exit 0; `npm test` exit 0, 162 passed, 0 failed, 0 skipped, 5.8 s.
- Close-and-commit round: `npm run typecheck` exit 0; `npm test` exit 0, 162 passed, 0 failed, 0
  skipped, 4.1 s. Working tree held only this task's twelve files.
- AC-by-AC check of the diff. AC1: the five probe shapes are pinned in one new
  `tests/cursor-adapter.test.ts` case, each asserting the verdict object. AC2: `git diff` on that file is
  additive only - four hunks, all insertions, no existing fixture body touched, including the
  `nested object must not be the extract target` case that pins outer-before-child ordering. AC3 and AC4
  are covered end to end by the pre-existing fail-closed case: the `{schema_version, review_kind}`
  fixture parses, is not verdict-shaped, reaches the fallback and ends `result_schema_invalid`, while the
  brace-free fixture ends `adapter_error` / `output_unparsable`. AC6 to AC9 are covered by the new
  retention case over the file bytes: `payload_log == "adapter-payload.log"`, mode `0600`, secret and
  home path absent, `status.json` and `events.jsonl` free of the candidate, the truncated file exactly
  marker plus the last 16 KiB of the redacted text, an at-cap file with no marker, and `readdir` showing
  no such file on a passing run. AC10: both commands exit 0 above.
- Independent probe of the real `extractReviewPayload` (`node --import tsx`, script in the session
  scratchpad outside the repository). Trailing non-JSON brace pairs after a valid verdict object:
  1, 60, 62, 63 -> `changes_requested`; 64 and 65 -> `undefined`. A 2 MB candidate holding one million
  closed `{}` spans resolves in 97 ms; a 500,000-deep nesting resolves in 45 ms. Both fail closed, as
  D1 accepts.
- Constraint check: `SCHEMA_VERSION` stays `2` and `EventDocument` is untouched (`git diff
  src/core/contracts.ts` is the single `payload_log` field); `package.json` is unmodified, so no runtime
  dependency was added; `AdapterFailureError` carries a payload only at the `output_unparsable` call
  site, so no other failure path retains anything; and no file under `src/cli` or `src/mcp` reads any
  `adapter_failure` field, so no retained text can reach the terminal.

## Review

<!-- spartan-bridge:review:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-301ffb94-efb9-4502-bc6f-675474a5e6a9 execution_id=exec-88ef8a2d-d7e6-4238-beb1-a5628d122d98 review_kind=plan verdict=pass reason_code=review_passed host=cursor launcher=cursor-plan-reviewer-v1 model=cursor-grok-4.6-high-fast effort=none model_observed=declared_unobserved policy_digest=sha256:f86f80dd14e95d3612c0ccd72cfd9fa9c88077b82418a39aad6cdf7ffc8bcea7 task_hash=sha256:f0d6620d9fe294210c7298cf4314302b618ebd1a340a9d930f2d91a4cc4ba696 agents_hash=sha256:abddea169a1211006bd0e78f1b7ced5d708797901d12968e6b493c2b5cc6cd34 timestamp=2026-08-19T14:13:55.636Z
<!-- spartan-bridge:review:end -->

Implementation review (manual round, Claude Code, claude-opus-5, effort high).

Verdict: APPROVED

Findings:

- None blocking.
- Informational, D1 prose boundary: D1 says a tail holding "more than 64 closed non-JSON spans" fails
  closed, but the cap is checked before each attempt, so exactly 64 trailing spans also fails and the
  real tolerance is 63. Measured above. No acceptance criterion is affected - AC5 asks only that more
  than `CURSOR_CANDIDATE_SCAN_CAP` spans fail closed, and the test uses 65 - so this is a one-off in the
  decision's wording, not in the code.
- Informational, span-collection memory: `collectBalancedSpans` now materialises every closed span
  instead of tracking only the last, so a payload at `CURSOR_REVIEW_STDOUT_CAP` made of `{}` pairs
  allocates roughly 240 MB before the 64-attempt cap applies. Measured at 119 MB for a 2 MB candidate,
  resolving in 97 ms. Bounded by the existing stdout cap and well inside the default heap, so it is
  recorded rather than raised.

## Blockers

None.

## Next Action

None. This task is complete.

## Next Handoff

None. This task proposes no handoff.

Non-binding suggestion, which the human may decline: `docs/AUTHENTICATION-AND-SECURITY.md` and
`docs/DECISIONS.md` D-018 still name only `adapter-stderr.log`, so the new `adapter-payload.log` and
`payload_log` pointer are undocumented durable behavior.

```text
Recommended execution (human decides):
- Host: Claude Code, the `planner` binding in `AGENTS.md`; the follow-up is documentation, not a worktree change
- Model and effort: claude-opus-5, effort high
- Role: planner
- Invocation: `/spartan` in Claude Code, passing the prompt block below as the argument
```

```text
Create a new task in `spartan/tasks/` from `assets/task-template.md`, using the next unused four-digit number.

Act as planner. Plan the documentation update this extractor-and-retention change now requires: record `adapter-payload.log` beside the existing `adapter-stderr.log` paragraph in `docs/AUTHENTICATION-AND-SECURITY.md`, and extend `docs/DECISIONS.md` D-018 so the `payload_log` pointer and the bounded candidate-set scan are stated as shipped behavior. Success is a plan whose scope, decisions, and acceptance criteria are settled enough to implement.
Run the relevant repository checks and update that new task file.

Return only the next handoff, or a completion notice if no work remains.
```
