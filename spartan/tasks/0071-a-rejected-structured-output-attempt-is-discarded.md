---
protocol: "1.1.0" # x-release-please-version
id: a-rejected-structured-output-attempt-is-discarded
created_at: 2026-09-03
status: active
phase: planning
task_type: planning
risk: material
current_role: planner
next_role: planner
updated_at: 2026-09-04
handoff_id: none
next_handoff_id: HX-001
---

# A rejected structured-output attempt is discarded, so a schema failure cannot be diagnosed

## Objective

When a reviewer child exhausts its structured-output retries, the run records
enough to name *which* `reviewOutputSchema` constraint it kept violating. Today
the attempt is extractable, in memory, and thrown away, so the operator learns
only that the child gave up.

## Context

Task `0064` made an adapter `collect` failure name its own class: the excerpt
now keeps the tail of stdout, and a provider-side failure is classified from
the child's structured fields. That worked on its first live outing — the
`0069` cycle-2 failures reported

```text
"subtype":"error_max_structured_output_retries",
"errors":["Failed to provide valid structured output after 5 attempts"]
```

which named the failure mode. It does not name the cause. `reviewOutputSchema`
(`src/adapters/review-schema.ts`) constrains, among others, `summary` and each
finding `message` to `maxLength: 2000`, each finding `id` to
`^[A-Z][A-Z0-9_-]{0,31}$`, and `findings` to `maxItems: 100`. Which of those
the reviewer kept violating is not recoverable from anything the run persists.

Three dispatches on `0069` failed identically, and the task had to be completed
by owner override rather than by a verdict.

**2026-09-04 changes this premise, and the planner must re-derive D1 from it.**
The `0072` implementation review failed the same way — and this time the
`0064` excerpt *did* name the cause. `run-e91670d5-a6a5-43e2-8145-afb7dd363875`
recorded, inside its 512-byte `output_excerpt`:

```text
"subtype":"error_max_structured_output_retries",
"errors":["Failed to provide valid structured output after 5 attempts — last StructuredOutput error: Output does not match required schema: /summary: must NOT have more than 2000 characters (got 2028)"]
```

The constraint, the field, and the observed value are all there, with no
payload retention at all. So the Objective above is already met **whenever the
client puts its last schema error in that `errors` array**, and the open
question narrows to: when is it *not* there? On `0069` the same array carried
only the sentence without a `— last StructuredOutput error:` clause. The
planner must establish whether that difference is a client-version change, a
per-failure difference, or excerpt truncation, before pinning a slice: if the
excerpt reliably carries the constraint, D1's retained slice may be
unnecessary and this task shrinks to the redaction and documentation halves.

That run also produced the first measurement of *which* constraint bites, which
the Out of Scope note below was waiting for:

- `summary` overran by 28 characters (2028 against 2000) on a real
  implementation review of a seven-file diff, five attempts, 382 s of work
  discarded.
- No reviewer has ever come close on `findings[].message`, which carries the
  same 2000 cap: across 59 findings persisted in `spartan/tasks/`, the maximum
  is 1379 characters, the median 336, and none exceeds 2000.
- No reviewer prompt states the limit. `src/adapters/claude.ts` contains no
  occurrence of `2000`, `characters`, `concise`, or `brief`.
- `summary` is never rendered into a task artifact: `renderRegion`
  (`src/core/task-write.ts:468-500`) reads it only for the `containsForbidden`
  gate, and the persisted text lives solely in `review-verdict.json` and
  `reviews/<execution_id>.json` (`src/runtime/store.ts:23`, `:98`).

So the field that fails the schema is the one no human reads, and it fails
because nothing budgets it — not because 2000 is the wrong number for the field
that *is* rendered. That is a finding for whoever decides the limits; it is
recorded here, not acted on here.

**The attempt is not lost inside the child.** An out-of-band review of the code
(Cursor/Grok, read-only, 2026-09-03) established the mechanism:

- The child runs with `--verbose --output-format stream-json`, so its
  intermediate `assistant` records — the attempted verdict objects — are on
  stdout. A real reviewer stream measured 92 840 bytes with 23 `assistant`
  records alongside the single `result`.
- `src/adapters/claude.ts` sets `retainStdout: true`, so the Bridge holds that
  whole stream in memory, capped at `CLAUDE_REVIEW_STDOUT_CAP` (4 MiB), at the
  moment of failure.
- The `collect` branch throws `output_unparsable` **only** when
  `extractReviewPayload(candidate) === undefined`. A rejected attempt is still
  a well-formed object carrying `schema_version` / `review_kind` / `verdict`,
  so extraction *succeeds*, the throw falls through to a bare `exit_nonzero`
  with `payload: null`, and `persistAdapterFailure` writes no
  `adapter-payload.log`. The Bridge had the answer in hand and discarded it for
  want of a branch.

The same review established what must **not** be done, and it is the reason
this is a task rather than a patch:

- **`redactAdapterStderrText` does not cover JSON.** Its key/value rule is
  `([A-Za-z][\w-]*)(\s*[=:]\s*)(\S+)` against `SENSITIVE_TOKENS`, written for
  launcher stderr in `key: value` prose. In NDJSON, `"session_id":"…"` and
  `"apiKeySource":"…"` do not match — `apikeysource` is not in
  `SENSITIVE_JOINED`, which holds only `apikey` and `authfile`. Persisting a
  raw stream would write session metadata the security document says is
  discarded.
- **A 16 KiB tail is the wrong slice.** Tool results from `Read` / `Grep` come
  *before* the attempts and run to hundreds of KiB (D-019 measured 224 KiB
  across 1377 records). The tail would capture the generic `result` plus the
  end of the last attempt — losing the `id` or `message` that actually
  violated. Conversely, on a short stream the tail would *include* the
  `system/init` record with `apiKeySource`.

The slice that answers the question with the least persisted volume is the last
`assistant` record whose content is text, plus the `result` record. The other
four attempts are redundant, and the remaining `assistant` records carry
`tool_use` with paths.

## Scope

- `src/adapters/claude.ts` (and the equivalent branch in `codex.ts`,
  `cursor.ts`, `grok.ts`) — the `collect` non-zero branch that currently throws
  `exit_nonzero` with `payload: null` when extraction succeeded.
- `src/core/review.ts` — `persistAdapterFailure`, `composeRetainedPayload`,
  and whatever selects what reaches `writeAdapterPayloadAtomic`.
- `src/policy/redact.ts` / `src/policy/sensitive-fields.ts` — the JSON-key gap,
  if D3 closes it here.
- `docs/AUTHENTICATION-AND-SECURITY.md` — two standing sentences become false;
  see Evidence.
- `docs/DECISIONS.md` — D-040's trigger for `adapter-payload.log`.
- Tests: `tests/adapter-failure.test.ts`, `tests/claude-adapter.test.ts`,
  `tests/serialize.test.ts`.

## Out of Scope

- Changing `reviewOutputSchema`'s limits, and adding a length budget to the
  reviewer prompts. The 2026-09-04 measurement in Context is the instrumentation
  this note was waiting for, but acting on it is a separate change to four
  adapter prompts and/or the schema, with its own review. Record the finding;
  do not fold it in here.
- Retrying, re-prompting, or failing over the reviewer.
- Persisting the whole stream, or every `assistant` record.
- The stale-`dist` chain defect — task `0070`.

## Constraints

- English artifact.
- Whatever is persisted goes through the existing pipeline —
  `composeRetainedPayload` (redaction, then a `RETAINED_PAYLOAD_CAP_BYTES`
  tail with the truncation marker) and `writeAdapterPayloadAtomic` (mode
  `0600`, temp-then-rename) — and its pointer stays `payload_log` in
  `status.json`. No new bytes reach the TTY, `status.json`, or `events.jsonl`.
- Redaction must cover quoted JSON keys before any stream-shaped content is
  written, or the selected slice must provably contain none of them.
- `SCHEMA_VERSION` stays `2`.
- `npm run typecheck` / `npm run build` clean; `npm test` no new failure.

## Decisions

- **D1 (open) — the slice.** Pin exactly what is retained: the last
  text-content `assistant` record plus the `result` record is the candidate the
  second opinion recommends. State how it is located, and what happens when no
  `assistant` text record exists.
- **D2 (open) — the branch.** How the `collect` non-zero path carries that
  slice when extraction succeeded but the exit was non-zero. Whether the cause
  stays `exit_nonzero` or gains a distinct member; whether the other three
  adapters are changed in this task or only Claude.
- **D3 (open) — the redaction gap.** Whether `redactAdapterStderrText` learns
  quoted-JSON keys (`"session_id":"…"`, `"apiKeySource":"…"`), or the pinned
  slice is shown to exclude them structurally. If the former, decide whether it
  applies to every existing caller — this changes what already-working
  redaction does.
- **D4 (open) — the two security-document sentences.** Reword both exactly; see
  Evidence for their current text.

## Acceptance Criteria

Derive these from the decisions once D1–D4 are pinned; do not write them before
the decisions settle.

## Work Completed

- 2026-09-03 (human-operator, Claude Code, claude-opus-5): queued after the
  `0069` cycle-2 failures. Verified against `main` the `collect` branch
  condition, `retainStdout`, the 4 MiB cap, the payload-write condition, the
  `SENSITIVE_TOKENS` / `SENSITIVE_JOINED` contents, and the record-type census
  of a real reviewer stream. Mechanism, redaction gap and slice recommendation
  come from an out-of-band Cursor/Grok review (read-only,
  `cursor-grok-4.6-high-fast`) commissioned for the retention question.
- 2026-09-04 (human-operator, Claude Code, claude-opus-5, effort high): recorded
  the `0072` implementation-review failure against this task without opening a
  planner round — `next_handoff_id` stays `HX-001` and the envelope is
  untouched. The run named its own violated constraint in `output_excerpt`,
  which narrows D1; the summary/message length census and the prompt-budget gap
  are new Evidence. No decision was pinned.

## Evidence

- `src/adapters/claude.ts` — the `collect` branch:
  `if (extractReviewPayload(candidate) === undefined && outcome.stdout.length > 0)`
  throws `output_unparsable` with the stdout as payload; otherwise the
  `exit_nonzero` throw carries `null`.
- `src/core/review.ts` — `persistAdapterFailure` writes
  `adapter-payload.log` only when `carried?.payload` is a non-empty string.
- `src/adapters/claude.ts` — `retainStdout: true`,
  `CLAUDE_REVIEW_STDOUT_CAP = 4 * 1024 * 1024`.
- Record-type census of a real reviewer stream (2026-09-03, 92 840 bytes):
  `{system: 22, rate_limit_event: 4, assistant: 23, user: 15, result: 1}`.
- `src/adapters/review-schema.ts` — `summary` and finding `message`
  `maxLength: 2000`; `id` `^[A-Z][A-Z0-9_-]{0,31}$`; `findings`
  `maxItems: 100`.
- `src/policy/sensitive-fields.ts` — `SENSITIVE_TOKENS` (13 entries) and
  `SENSITIVE_JOINED` (`apikey`, `authfile`).
- `src/policy/redact.ts` — `RETAINED_PAYLOAD_CAP_BYTES = 16 * 1024`,
  `RETAINED_PAYLOAD_TRUNCATION_MARKER`.
- The three `0069` cycle-2 runs: `run-d31889d4`, `run-e26d62d0`,
  `run-06a8aa5a`, each `exit_nonzero` with `payload_log: null`.
- `run-e91670d5-a6a5-43e2-8145-afb7dd363875` (2026-09-04, `0072`
  implementation review, Claude Code / claude-opus-5 / high): `state: failed`,
  `reason_code: adapter_error`, `adapter_failure.cause: exit_nonzero`,
  `exit_code: 1`, `signal: null`, `http_status: null`,
  `output_excerpt_bytes: 512`, `payload_log: null`, `verdict: null`,
  `task_write_state: null`. Its excerpt quotes the violated constraint in full;
  `duration_ms: 382516`.
- Length census of every finding persisted in `spartan/tasks/*.md`
  (2026-09-04): 59 findings, maximum 1379 characters (`0055`), median 336,
  none above the 2000 cap.
- `grep -c "2000\|characters\|brief\|concise" src/adapters/claude.ts` -> 0.
- `src/core/task-write.ts:468-500` — `renderRegion` uses `result.summary` only
  in `containsForbidden(result.summary)`; the rendered region carries the
  verdict line, the findings, and the `Bridge run` line, never the summary.
- `src/runtime/store.ts:23` and `:98` — the only two places the summary text is
  persisted.
- `docs/AUTHENTICATION-AND-SECURITY.md`, the two sentences D4 must reword:
  the child's streamed records are "parsed for those counts and then
  discarded"; and `adapter-payload.log` is "written only after a failed
  extraction (`output_unparsable`) when the adapter carried a non-empty stdout
  candidate".

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: PENDING
<!-- spartan-bridge:review:plan:end -->

## Blockers

None. Depends on `0064`, which is on `main`.

## Next Action

A planner round through `/spbridge`: pin D1's slice, D2's branch, D3's
redaction decision and D4's two rewordings, verify every named path, then let
the Bridge dispatch the plan review.

## Next Handoff

```text
Recommended execution (human decides):
- Host: Claude Code (AGENTS.md binds planner to Claude Code; fresh session)
- Model and effort: claude-opus-5 at effort high
- Role: planner
- Handoff: HX-001
- Permission: writable
- Invocation: /spbridge, passing the prompt block below as the argument
```

```text
Open `spartan/tasks/0071-a-rejected-structured-output-attempt-is-discarded.md` (handoff HX-001).

Act as planner. Read `## Context` first: the rejected attempt is extractable and in memory at failure time, and it is discarded because the `collect` branch throws `exit_nonzero` with `payload: null` whenever `extractReviewPayload` succeeded.

Refine this plan against `src/adapters/claude.ts` (the `collect` non-zero branch, `retainStdout`, `CLAUDE_REVIEW_STDOUT_CAP`), `src/adapters/codex.ts` / `cursor.ts` / `grok.ts` (the same branch), `src/core/review.ts` (`persistAdapterFailure`, `composeRetainedPayload`, `writeAdapterPayloadAtomic`), `src/policy/redact.ts` and `src/policy/sensitive-fields.ts`, `src/adapters/review-schema.ts`, and `docs/AUTHENTICATION-AND-SECURITY.md`.

Pin D1's slice — the last text-content `assistant` record plus the `result` record is the recommended candidate; state how it is located and what happens when no such record exists. Pin D2's branch and whether the other adapters change in this task. Decide D3: `redactAdapterStderrText` does not match quoted JSON keys, so either it learns them (and you must say what that does to every existing caller) or the pinned slice is shown to exclude session metadata structurally. Reword D4's two security-document sentences exactly. Do not change `reviewOutputSchema`'s limits — that decision waits on what this instrumentation reveals. Verify every named path and symbol exists. Keep `## Review` as the `Verdict: PENDING` placeholder and `phase: planning`.

Then let the Bridge dispatch the plan review.
```
