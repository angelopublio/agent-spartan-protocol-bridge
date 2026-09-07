---
protocol: "1.1.0" # x-release-please-version
id: a-reviewer-adapter-collect-failure-captures-nothing
created_at: 2026-09-02
status: completed
phase: complete
task_type: implementation
risk: material
current_role: human-operator
next_role: none
updated_at: 2026-09-03
handoff_id: HX-004
next_handoff_id: none
---

# A reviewer adapter that exits non-zero in `collect` captures nothing to diagnose it

## Objective

When a reviewer adapter subprocess exits non-zero during `collect` (or another
post-`start` phase) with no stderr, the Bridge still records enough to tell an
infrastructure flake from a real adapter fault: the child's exit signal, a tail
of its stdout, and whether any partial payload was received. An operator (or a
follow-up review) does not have to guess whether to just re-run.

## Context

**Most likely root cause (2026-09-02): the reviewer subprocess hit the
account's usage / session limit.** The `reviewer.implementation` adapter runs
`claude -p` on the operator's own account quota — the same pool as the driving
session. When that limit is reached, `claude -p` exits non-zero with the limit
message on stdout (plain text, not the structured JSON the adapter parses), so
the adapter records `exit_nonzero` with an empty capture. The operator's session
hit `You've hit your session limit` at ~15:0x SP the same afternoon as the 0056
round-6 failure. A usage-limit exit and a genuine adapter fault must not look
identical.

Reviews that have failed this way with a completely empty failure record:

- `0055` implementation review (2026-08-31): `adapter_timeout` then
  `adapter_error` / `exit_nonzero`, null verdict, ~4-5 min in `collect`, no
  stderr. Treated as an infra flake; owner signed off.
- `0056` implementation review (2026-09-02, `run-c3ca5d26`): `adapter_error`,
  `adapter_failure = { phase: "collect", cause: "exit_nonzero", exit_code: 1,
  stderr_bytes: 0, stderr_log: null, payload_log: null, output_excerpt_bytes: 0,
  output_excerpt: null }`. The reviewer adapter (Claude) exited 1 with zero
  captured output. Nothing said whether the model errored, the CLI crashed, a
  network call failed, or the process was OOM-killed.

- `0067` implementation review cycle 2 (2026-09-03), **three consecutive
  failures** — `run-3e3b8978`, `run-99cd4da7`, and a hand-run reproduction:
  `adapter_failure = { phase: "collect", cause: "exit_nonzero", exit_code: 1,
  stderr_bytes: 0, stderr_log: null, payload_log: null,
  output_excerpt_bytes: 512, output_excerpt: "{\"type\":\"system\",\"subtype\":\"init\",\"cwd\":\"…" }`.
  Unlike `0055` / `0056` the excerpt was **non-empty** — D1's `retainStdout`
  had shipped by then (`src/adapters/claude.ts`, "0064 D1") — and it was still
  useless, because it held the child's opening `system/init` record and nothing
  else. Running the identical argv by hand against the same reviewer workspace
  produced 7655 bytes of stdout ending in:

  ```text
  "is_error":true,"num_turns":1,"subtype":"success","api_error_status":529,
  "result":"API Error: 529 Overloaded. This is a server-side issue, usually
  temporary — try again in a moment. If it persists, check
  https://status.claude.com.","type":"result","duration_ms":190780
  ```

  `api_error` is absent from the first 512 bytes and present in the last 512.
  Cause: `buildAdapterOutputExcerpt` (`src/core/review.ts:789`) keeps
  `bytes.subarray(0, OUTPUT_EXCERPT_CAP_BYTES)` — the **head**, with
  `OUTPUT_EXCERPT_CAP_BYTES = 512`. With `--output-format stream-json` the
  diagnosis is always the final `result` record, so a head excerpt is
  structurally the wrong half. Three failures cost a manual reproduction to
  learn a word the child had already printed. `stderr_bytes: 0` is not a
  Bridge defect here: the CLI reports API errors on stdout, never stderr.

`AdapterFailureRecord` already has `phase` and `cause` (`src/core/contracts.ts`
`ADAPTER_FAILURE_PHASES` / `ADAPTER_FAILURE_CAUSES`) and the record carries
`stderr_bytes` / `stderr_log` / `payload_log` / `output_excerpt` fields — all
null/zero here. The adapters spawn the client CLI and read stdout as the review
payload; on a non-zero exit with empty stderr there is no fallback capture of
what *did* arrive on stdout, nor of the termination signal.

## Scope

- `src/core/review.ts` — `buildAdapterOutputExcerpt` takes the redacted tail,
  not the head. `persistAdapterFailure` and `runtimeFailure` copy the new
  nullable `signal` and `http_status` fields. `OUTPUT_EXCERPT_CAP_BYTES` stays
  512. `composeRetainedPayload` / `RETAINED_PAYLOAD_CAP_BYTES` stay the 16 KiB
  payload-log path.
- `src/adapters/process.ts` — `SpawnOutcome` gains `signal: string | null`;
  the `close` handler keeps Node's second argument. The stdout drain and
  `retainStdout` default (retain; `request.retainStdout === false` opts out)
  stay. `process.ts` does not parse JSON or choose a `cause`.
- `src/adapters/claude.ts` / `codex.ts` / `cursor.ts` / `grok.ts` — review
  `start()` sets `retainStdout: true` (Cursor today keys it on
  `!streamJsonSupported`). Each `collect()` calls the shared D1a helper before
  throwing `exit_nonzero`, then applies D3. `fail` / `failureRecord` thread
  `signal` and `http_status`.
- `src/adapters/provider-failure.ts` — new shared classifier. Reads the last
  `type === "result"` object from retained stdout. Does not persist provider
  prose.
- `src/core/contracts.ts` — `ADAPTER_FAILURE_CAUSES` gains
  `provider_unavailable` and `provider_limit`. `AdapterFailureRecord` gains
  `signal: string | null` and `http_status: number | null`. `SCHEMA_VERSION`
  stays `2`.
- `src/core/serialize.ts` — `serializeAdapterFailure` whitelists the two new
  keys and normalizes out-of-shape values.
- `agent-skill/skills/spbridge/SKILL.md` — step 5/7 wording in D4.
- `docs/DECISIONS.md` — D-065.
- `docs/AUTHENTICATION-AND-SECURITY.md` — `adapter_failure` may carry the two
  new closed causes and an integer `http_status`; `producer_diagnostic` stays
  the closed six-key record.
- Tests: `tests/adapter-failure.test.ts`, `tests/serialize.test.ts`,
  `tests/claude-adapter.test.ts`, `tests/codex-adapter.test.ts`,
  `tests/cursor-adapter.test.ts`, `tests/spbridge-skill.test.ts`, and every
  `AdapterFailureRecord` literal / helper that the new required keys touch
  (`tests/transition.test.ts`, `tests/doctor.test.ts`, `tests/cli.test.ts`,
  `tests/lifecycle.test.ts`).

This plan does not edit `AGENTS.md` or `spartan-bridge/config.yaml`. After a
plan-review pass, frontmatter `next_role` is `implementer`.

## Out of Scope

- Retrying or failing over the adapter automatically. This task only makes the
  failure legible; the operator re-runs.
- Changing the review timeouts (`0059`) or the stale-build handling (`0060`).
- The reviewer model or host choice.
- Fixing whatever upstream flake causes the Claude reviewer to exit 1 — that is
  not in this repository.
- Matching English phrases in `result` or other provider prose.
- Accepting a review verdict when `exitCode !== 0`.
- Adding `http_status` to `producer_diagnostic`.
- A closed Bridge enum of OS signal names.
- Changing `OUTPUT_EXCERPT_CAP_BYTES`, `RETAINED_PAYLOAD_CAP_BYTES`, or the
  payload-log truncation marker.
- Extending `ReviewStreamParser` to keep `is_error` / `api_error_status`
  (classification reads retained stdout).

## Constraints

- English artifact.
- `output_excerpt` stays bounded and is not secret-bearing beyond what the
  adapter already treats stdout as (review payload) — apply the same redaction
  the payload log uses (`redactAdapterStderrText`).
- `reason_code` vocabulary unchanged. `cause` stays within
  `ADAPTER_FAILURE_CAUSES` after the two D1a additions.
- Persisted provider-side classification is a Bridge-owned enum plus an HTTP
  status integer, never provider prose, per the `producer_diagnostic` rule in
  `docs/AUTHENTICATION-AND-SECURITY.md`.
- `SCHEMA_VERSION` stays `2`.
- `npm run typecheck` / `npm run build` clean; `npm test` no new failure.

## Decisions

- **D1 — `buildAdapterOutputExcerpt` keeps the redacted tail, not the head.
  No head slice. No elision marker in the excerpt.**
  `OUTPUT_EXCERPT_CAP_BYTES` stays `512`. After `redactAdapterStderrText`, if
  the redacted UTF-8 buffer is longer than the cap, take
  `bytes.subarray(bytes.length - OUTPUT_EXCERPT_CAP_BYTES)` — the same byte-tail
  rule `composeRetainedPayload` and `redactAdapterStderr` already use. If the
  buffer is at most 512 bytes, keep all of it. Do not prefix
  `[truncated: earlier bytes dropped]`; that marker belongs to the 16 KiB
  payload log (`RETAINED_PAYLOAD_CAP_BYTES`), not to the 512-byte
  `status.json` snippet. Do not keep a head slice: 512 bytes is already tight,
  and the stream-json diagnosis is always the final `result` record (2026-09-03
  capture: `api_error` absent from the first 512, present in the last 512).
  Collect-phase source selection is unchanged: prefer stderr when it is
  non-empty, otherwise stdout; when `payload !== null` on `collect`, the excerpt
  stays null because `adapter-payload.log` is the copy. `output_excerpt_bytes`
  remains the byte length of the excerpt text, not the original stream.

  Cursor review `start()` today sets `retainStdout: !this.streamJsonSupported`
  (`src/adapters/cursor.ts:507`). When stream-json is on, Cursor drops the
  bytes the excerpt and D1a need. All four review adapters set
  `retainStdout: true` on the review spawn. `process.ts` still defaults to
  retain (`request.retainStdout === false` opts out). The producer spawn in
  `cursor.ts` already retains and is unchanged.

- **D1a — two new closed causes, keyed only on the last `type === "result"`
  object's structured fields. Persist a Bridge-owned enum plus an HTTP status
  integer, never provider prose.**
  Add `provider_unavailable` and `provider_limit` to `ADAPTER_FAILURE_CAUSES`.
  Add `http_status: number | null` to `AdapterFailureRecord`. Put the scanner
  in new `src/adapters/provider-failure.ts` so every `collect()` shares one
  function and `process.ts` stays a drain. The helper parses retained stdout
  as NDJSON and as a single JSON object, keeps the last object whose `type`
  is exactly `"result"`, and reads only:

  - `is_error` — boolean; classification requires `true`
  - `api_error_status` — finite integer in `100..599`, else ignored
  - `terminal_reason` — compared only to the closed literal `"api_error"`

  Classification must use the **full** last result object from retained
  stdout, not the 512-byte excerpt. The 2026-09-03 last-512 window showed
  `is_error` and `api_error_status` but not `terminal_reason`; that field
  may sit earlier in the same record.

  Closed mapping, in this order:

  1. `is_error === true` and `api_error_status === 429` →
     `cause: "provider_limit"`, `http_status: 429`
  2. `is_error === true` and `api_error_status` in `500..599` →
     `cause: "provider_unavailable"`, `http_status: that integer`
  3. `is_error === true` and `terminal_reason === "api_error"` and no
     classifiable status → `cause: "provider_unavailable"`,
     `http_status: null`
  4. otherwise no remap (`cause` stays whatever D3 / `exit_nonzero` decide)

  `http_status` is set whenever `api_error_status` on that last result
  object is a finite integer in `100..599`, even if cause is not remapped
  (a 401 stays `exit_nonzero` with `http_status: 401`). Never persist the
  `result` string, `terminal_reason` as a field, a URL, or any other
  provider prose. Never match English. A plain-text usage-limit line
  (the 0056 theory) is not D1a; D1's tail and D3's `output_unparsable`
  make it legible.

  Each adapter's `collect()` calls the helper on `outcome.stdout` after
  timeout / overflow and before the bare `exit_nonzero` throw. A hit
  throws that cause and still passes stdout into `fail()` so the excerpt
  path runs. A non-zero exit never returns a parsed verdict.
  `producer_diagnostic.adapter_cause` may carry the new enum values
  through the existing `isAdapterFailureCause` gate. Do not add
  `http_status` to `producer_diagnostic`. `SCHEMA_VERSION` stays `2`.

- **D2 — `signal` is `string | null` on `SpawnOutcome` and on
  `AdapterFailureRecord`.**
  Node's `close` is `(code, signal)`. `src/adapters/process.ts:111`
  currently keeps only `code`. Add `signal: string | null` to
  `SpawnOutcome` and copy the second argument (or `null`). Thread it
  through each adapter's `fail` / `failureRecord`. On
  `AdapterFailureRecord` the field is the OS name Node delivered
  (`"SIGKILL"`, `"SIGTERM"`) when the child was signalled, else `null`.
  It is not a Bridge-closed signal enum. `serializeAdapterFailure`
  copies a non-empty string and otherwise writes `null`.
  `SCHEMA_VERSION` stays `2`. When the OS delivers a signal, `exit_code`
  is typically `null` and `signal` is the name — both fields stay.

- **D3 — a non-zero collect exit with non-empty stdout that is not a
  D1a hit and does not extract as a review payload is
  `output_unparsable`, not `exit_nonzero`.**
  Today's `collect()` throws `exit_nonzero` before it tries to parse, so
  garbage-or-prose stdout never reaches the existing
  `output_unparsable` / `payload_log` path. After D1a misses, if
  `exitCode !== 0` and stdout is non-empty and the adapter's existing
  extractor (`extractReviewPayload` / last-message parse /
  `extractGrokReviewPayload`) returns undefined, throw
  `output_unparsable` and pass the stdout text as `payload` so
  `adapter-payload.log` is written (D-040). Empty stdout stays
  `exit_nonzero`. If the extractor would succeed but `exitCode !== 0`,
  stay `exit_nonzero` — do not accept a verdict from a failed child.
  The helper's `http_status` is threaded onto both the
  `output_unparsable` throw and the bare `exit_nonzero` throw, so a
  last result object with a finite `api_error_status` in `100..599`
  still records that integer when D1a does not remap the cause.
  D1a wins over D3. Classification stays in each adapter's `collect()`
  via the shared helper; `process.ts` does not choose a cause.
  `output_unparsable` already exists on `ADAPTER_FAILURE_CAUSES`; this
  decision extends when it is used, not the vocabulary.

- **D4 — SKILL step 5 names the closed adapter-failure scalars including
  `payload_log`; step 7 recommends `/spbridge` only when excerpt and
  payload_log are both empty and a signal is present.**
  Step 5 already reports `reason_code` / `verdict`. When `reason_code` is
  `adapter_error` or `adapter_timeout` and `adapter_failure` is non-null,
  also name `adapter_failure.cause`, `http_status` when it is a non-null
  integer, `signal` when it is a non-null string, whether
  `output_excerpt` is null, and whether `payload_log` is null. Do not
  quote `output_excerpt` text or payload-log contents. Do not remap the
  cause. Step 6 is unchanged (`adapter_error` already stops the
  plan-review loop). Step 7 additions, after the existing
  `review_passed` / `review_changes_requested` /
  `producer_declaration_invalid` rows, applied in this order so a
  non-null `payload_log` cannot fall into the flake or unknown rows
  (D3 writes the diagnosis there when collect `payload !== null` and
  D1 then keeps `output_excerpt` null):

  | Shape | Recommendation |
  | --- | --- |
  | `cause` is `provider_unavailable` or `provider_limit` | Print no start. Provider-side; the operator retries when the provider recovers. |
  | `payload_log` is non-null | Print no start. Read `status.json` / `adapter-payload.log` before any re-run. |
  | `output_excerpt` is non-null and cause is not a provider_* value | Print no start. Read `status.json` / `adapter-payload.log` before any re-run. |
  | `output_excerpt` is null and `payload_log` is null and `signal` is non-null | `/spbridge` once on the same task path, no `--after-run` (infra flake). |
  | `output_excerpt` is null and `payload_log` is null and `signal` is null | Print no start. Unknown; do not assume a flake. |

  Do not auto-retry.

## Work Completed

- 2026-09-02: task created after the `0056` implementation review
  (`run-c3ca5d26`) failed `adapter_error` / `collect` / `exit_nonzero` with
  `stderr_bytes: 0` and every excerpt/log field null — the second such
  content-free reviewer-adapter failure (`0055` was the first) with no way to
  tell a flake from a fault.
- 2026-09-02: root cause found by recovering `run-1cdbd8d1` (0056 round-6
  flake). `src/adapters/claude.ts` and `src/adapters/codex.ts` spawned the
  review child with `retainStdout: false` (stdout streamed to
  `ReviewStreamParser` for progress, raw bytes discarded); the `exit_nonzero`
  `fail(...)` call passed `outcome.stdout`, which was empty. Grok already used
  `retainStdout: true`. The `review.ts` pipeline that turns
  `AdapterFailureError.output` into `output_excerpt` was already correct
  (`tests/adapter-failure.test.ts:266`).
- 2026-09-02: **D1 shipped directly** (not `/spbridge` — the fix touches the
  review `collect` path the Bridge itself uses). `claude.ts` / `codex.ts` review
  spawn now `retainStdout: true`; a non-zero exit reaches `output_excerpt`
  (capped 512 B) and the full retained tail is available. Tests:
  `tests/claude-adapter.test.ts` and `tests/codex-adapter.test.ts` drive a
  `retainStdout`-faithful stub to a `exit_nonzero` and assert the child's stdout
  reaches the failure record. `npm run typecheck` / `npm run build` exit 0;
  `npm test` 465 pass, 0 fail. **D1a (a `provider_limit` classification) stays
  open** until a real usage-limit hit captures the actual phrase — with D1
  shipped, the next natural limit hit records it in
  `.spartan-bridge/runs/<id>/status.json` `adapter_failure.output_excerpt`
  automatically.
- 2026-09-03: planner HX-001 refined the plan against the current checkout.
  D1's remaining defect is the head slice in `buildAdapterOutputExcerpt`.
  D1a/D2/D3/D4 are pinned. Every named path and symbol in Scope exists except
  the new `src/adapters/provider-failure.ts`. This plan does not edit
  `AGENTS.md` or `spartan-bridge/config.yaml`. Host: Cursor; model:
  cursor-grok-4.6-high-fast at effort high.
- 2026-09-03: planner cycle 2 revised against
  `review_changes_requested` on
  `run-feb5f3af-666d-4788-a4b4-ba830a027211`. D3 now threads the helper's
  `http_status` onto `output_unparsable` and bare `exit_nonzero`. D4 now
  names `payload_log` in step 5 and keys step 7 so a non-null
  `payload_log` cannot fall into the flake or unknown rows. D1a adapter
  coverage requires `tests/claude-adapter.test.ts`. Criteria for
  `docs/DECISIONS.md` and `docs/AUTHENTICATION-AND-SECURITY.md` added.
  Every criterion that touches D3 or D4 was re-derived. Host: Cursor;
  model: cursor-grok-4.6-high-fast at effort high.
- 2026-09-03: implementer shipped D1 / D1a / D2 / D3 / D4 against approved
  plan-review `run-1ca9bfd2-a72e-49c3-857c-5f6b5f7d6491`. Tail excerpt,
  `provider_unavailable` / `provider_limit`, `http_status`, `signal`,
  collect `output_unparsable` reclassification, and SKILL scalars including
  `payload_log`. Host: Cursor; model: cursor-grok-4.6-high-fast at effort high.

## Evidence

- `src/core/review.ts:772` `OUTPUT_EXCERPT_CAP_BYTES = 512`;
  `src/core/review.ts:774` `buildAdapterOutputExcerpt`;
  `src/core/review.ts:789` `const capped = bytes.subarray(0, OUTPUT_EXCERPT_CAP_BYTES);`;
  `src/core/review.ts:797` `composeRetainedPayload` already takes the last
  `RETAINED_PAYLOAD_CAP_BYTES` and prefixes
  `RETAINED_PAYLOAD_TRUNCATION_MARKER`.
- `src/policy/redact.ts:6-7` `RETAINED_PAYLOAD_CAP_BYTES = 16 * 1024`,
  `RETAINED_PAYLOAD_TRUNCATION_MARKER = "[truncated: earlier bytes dropped]"`.
- `src/adapters/process.ts:15` `retainStdout?: boolean`;
  `src/adapters/process.ts:86` `if (request.retainStdout === false)` opts out;
  `src/adapters/process.ts:111-119` `close` keeps `(code)` only — no `signal`
  on `SpawnOutcome` (`src/adapters/process.ts:30-36`).
- `src/adapters/claude.ts:342` and `src/adapters/codex.ts:355`
  `retainStdout: true` with a "0064 D1" comment.
  `src/adapters/grok.ts:398` `retainStdout: true`.
  `src/adapters/cursor.ts:507` `retainStdout: !this.streamJsonSupported`.
- `src/core/contracts.ts:1` `SCHEMA_VERSION = 2`;
  `src/core/contracts.ts:215-225` nine `ADAPTER_FAILURE_CAUSES` including
  `output_unparsable`;
  `src/core/contracts.ts:236-245` `AdapterFailureRecord` has no `signal` and
  no `http_status`.
- `src/core/serialize.ts:111-128` `serializeAdapterFailure` copies the eight
  current keys and would drop any new field until updated.
- `src/adapters/review-stream.ts:148-154` keeps `record.result` text only;
  it does not keep `is_error` / `terminal_reason` / `api_error_status`.
- `src/adapters/claude.ts:374-375` (and the same shape in cursor / codex /
  grok) throws `exit_nonzero` before any parse when `exitCode !== 0`.
- `docs/AUTHENTICATION-AND-SECURITY.md:722` `producer_diagnostic` is a closed
  six-key classification and is never provider stdout/stderr or an error
  message.
- `agent-skill/skills/spbridge/SKILL.md` step 5 reports `reason_code` /
  `verdict` and does not name `adapter_failure` fields; step 7 has no
  `adapter_error` row.
- `tests/adapter-failure.test.ts:344` asserts the current nine causes.
- 2026-09-03 outage capture (see the dedicated Evidence section): last 512
  bytes contain `api_error`; first 512 do not.
- Paths confirmed present in this checkout:
  `src/core/review.ts`, `src/core/contracts.ts`, `src/core/serialize.ts`,
  `src/adapters/process.ts`, `src/adapters/claude.ts`,
  `src/adapters/codex.ts`, `src/adapters/cursor.ts`,
  `src/adapters/grok.ts`, `src/adapters/review-stream.ts`,
  `src/adapters/adapter.ts`, `src/policy/redact.ts`,
  `docs/AUTHENTICATION-AND-SECURITY.md`, `docs/DECISIONS.md`,
  `agent-skill/skills/spbridge/SKILL.md`,
  `tests/adapter-failure.test.ts`, `tests/serialize.test.ts`,
  `tests/claude-adapter.test.ts`, `tests/codex-adapter.test.ts`,
  `tests/cursor-adapter.test.ts`, `tests/spbridge-skill.test.ts`.
  `src/adapters/provider-failure.ts` does not exist yet.
- 2026-09-03 implementer checks (this confined producer sandbox):
  `node node_modules/typescript/bin/tsc --noEmit` exit 0.
  `node node_modules/typescript/bin/tsc` EPERM writing `dist/` (outside
  the automatic write scope).
  `node --import tsx --test tests/adapter-failure.test.ts tests/serialize.test.ts tests/claude-adapter.test.ts tests/codex-adapter.test.ts tests/spbridge-skill.test.ts tests/process.test.ts`
  70 pass, 0 fail.
  `node --import tsx --test tests/*.test.ts` 506 tests, 494 pass, 12 fail:
  all 12 are nested `sandbox-exec` (`sandbox_apply: Operation not permitted`,
  exit 71), `manage-install.sh` EACCES (pre-existing mode 100644), or the
  doctor wrapper-path / POSIX-guard tests that depend on those. No new
  failure on the adapter-failure, serialize, Claude/Codex collect, skill,
  or process-signal paths.

## Evidence (2026-09-03 outage capture)

- Both `status.claude.com` and `status.cursor.com` reported incidents during
  this window, so the class was reproducible on demand rather than inferred.
- Hand-run reproduction, identical argv from `composeClaudeReviewArgv({ model:
  "claude-opus-5", effort: "medium", reviewKind: "implementation" })`, cwd set
  to the failed run's `reviewer-workspace/worktree`: exit 1, **0 bytes of
  stderr**, 7655 bytes of stdout, 190780 ms wall time. The full stream was kept
  outside the repository (scratchpad only) and never redirected into the
  worktree.
- `api_error` in the first 512 bytes: **false**. In the last 512 bytes:
  **true**. The head holds `{"type":"system","subtype":"init",…}`.
- `src/core/review.ts:772` `OUTPUT_EXCERPT_CAP_BYTES = 512`;
  `src/core/review.ts:789` `const capped = bytes.subarray(0, OUTPUT_EXCERPT_CAP_BYTES);`.
- `src/adapters/claude.ts` already sets `retainStdout: true` with a comment
  naming "0064 D1", so the excerpt path exists and only the slice is wrong.
- The three Bridge runs that failed this way: `run-3e3b8978-55c8-4af1-8e44-37a13dc35040`,
  `run-99cd4da7-d14d-4169-bd8c-e26c6cb55e9b` (both `0067` cycle 2, both
  `--after-run run-35668b16-adcf-43d0-a3a4-51909e747524`, so neither burned a
  review cycle), plus the manual reproduction.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-1ca9bfd2-a72e-49c3-857c-5f6b5f7d6491 execution_id=exec-990e6c0c-2ee4-4008-bd10-177d77f3398e review_kind=plan verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-opus-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:5a74e728a1985947915bf18ad1f0bb996d8f60b76b5ef05870e614ae8c0b8a56 task_hash=sha256:85f7877e4a13ab63df8b3e25aa128776e5aad32b687ec438e510c450e5a3220e agents_hash=sha256:8c5ea585bde94cfad8dd44a4887699564541608b157d2046244f834226ece7fa timestamp=2026-09-03T20:20:05.950Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-6f764c3d-947d-42a2-87cc-464d2a3ef01a execution_id=exec-4bd48187-5d96-4ce9-a021-96b0accaff11 review_kind=implementation verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-opus-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:1a2b7e24b78bc51432866607cd179270ba59bd8d0081a685699860fc477ec92e task_hash=sha256:37bd09685837681f68bb022fd3fb217c86e4a1bb1d4ad40fef8e2a1ac2cbc9f9 agents_hash=sha256:8c5ea585bde94cfad8dd44a4887699564541608b157d2046244f834226ece7fa timestamp=2026-09-03T20:34:37.482Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None.

## Next Action

None. Plan review APPROVED at cycle 2 (`run-1ca9bfd2`) after a cycle-1
`CHANGES_REQUESTED`; the pass-path auto-chain then spawned the mapped Cursor
implementer on its own and the implementation review APPROVED at cycle 1
(`run-6f764c3d`, no findings). First full auto-chain in this repository since
task `0067` made the plan-target scan advisory. `npm run typecheck` /
`npm run build` exit 0; `npm test` 506 pass, 0 fail. Committed and pushed.

Validated end to end against the real stream captured during the 2026-09-03
outage: `classifyProviderFailure` on those 7655 bytes returns
`{ cause: "provider_unavailable", http_status: 529 }`, and
`buildAdapterOutputExcerpt` now yields an excerpt containing
`api_error_status`. The five anonymous `0067` cycle-2 failures would have named
themselves under this build.

Observed during the auto-chain, not caused by it and out of this task's scope:
`spartan-bridge` exited 126 (`permission denied`) while the producer round held
the write-scope lock, because the global command symlinks to
`dist/cli/main.js` and the guard locks the whole tree to `0444`, stripping the
executable bit for the duration. The mode was restored to `0755` afterwards.
Queued separately.
## Next Handoff

No outstanding handoff. The task is complete.
## Acceptance Criteria

- [x] (D1) `buildAdapterOutputExcerpt` on a collect-phase stdout longer than
      512 bytes after redaction returns the last `OUTPUT_EXCERPT_CAP_BYTES`
      and not the first. A fixture whose first 512 bytes are a `system/init`
      record and whose last 512 contain `api_error` produces an excerpt that
      contains `api_error` and does not contain `system`. Covered in
      `tests/adapter-failure.test.ts`.
- [x] (D1) The excerpt has no `[truncated: earlier bytes dropped]` prefix.
      `OUTPUT_EXCERPT_CAP_BYTES` remains 512. Collect with a non-null payload
      still yields a null excerpt.
- [x] (D1) Claude, Codex, Cursor, and Grok review `start()` pass
      `retainStdout: true`. Cursor no longer keys it on
      `streamJsonSupported`. `tests/claude-adapter.test.ts`,
      `tests/codex-adapter.test.ts`, and `tests/cursor-adapter.test.ts`
      assert the review-spawn flag.
- [x] (D1a) A stubbed stream-json child that exits 1 after writing a
      terminal `result` record with `is_error: true` and
      `api_error_status: 529` records `cause: "provider_unavailable"` and
      `http_status: 529`. A `429` records `cause: "provider_limit"` and
      `http_status: 429`. Covered in `tests/adapter-failure.test.ts` and
      required in `tests/claude-adapter.test.ts` (the adapter that produced
      the 0055 / 0056 / 0067 failures). Cursor adapter coverage is optional.
- [x] (D1a) The persisted record has no `result` string, no
      `terminal_reason` field, and no other provider prose.
      `serializeAdapterFailure` emits `http_status` as an integer or
      `null` and drops any extra key. `SCHEMA_VERSION` stays `2`.
- [x] (D1a) A plain-text non-JSON usage-limit line is not classified as
      `provider_limit`. `producer_diagnostic` still has exactly its current
      closed keys; `http_status` is not one of them.
      `docs/AUTHENTICATION-AND-SECURITY.md` states that `adapter_failure`
      may carry `provider_unavailable` / `provider_limit` and an integer
      `http_status`, and that `producer_diagnostic` stays the closed
      six-key record.
- [x] (D1, D1a, D2, D3, D4) `docs/DECISIONS.md` records D-065 for the tail
      excerpt, the two new causes, `http_status`, `signal`, the
      `output_unparsable` reclassification, and the SKILL scalars including
      `payload_log`.
- [x] (D2) `SpawnOutcome.signal` is the Node `close` signal or `null`. A
      stubbed child terminated by `SIGKILL` records
      `adapter_failure.signal === "SIGKILL"`. A clean exit 1 records
      `signal: null`. A test asserts both.
- [x] (D3) A stubbed child that exits 1 after writing partial non-JSON
      stdout and is not a D1a hit records `cause: "output_unparsable"` and
      a non-null `payload_log`. Empty stdout on exit 1 stays
      `exit_nonzero`. A parsable verdict on exit 1 is still
      `exit_nonzero`, not a returned verdict.
- [x] (D3) A last `result` object with `api_error_status` in `100..599`
      that D1a does not remap still records that integer as
      `http_status` on both the `output_unparsable` throw and the bare
      `exit_nonzero` throw.
- [x] (D4) `agent-skill/skills/spbridge/SKILL.md` step 5 names
      `adapter_failure.cause`, `http_status`, `signal`, whether
      `output_excerpt` is null, and whether `payload_log` is null, and
      does not quote excerpt or payload-log text. Step 7 applies the
      closed table in D4's order: `payload_log` non-null prints no start
      and tells the operator to read the logs; `/spbridge` is recommended
      only when `output_excerpt` and `payload_log` are both null and
      `signal` is non-null; `provider_unavailable` /
      `provider_limit` print no start. `tests/spbridge-skill.test.ts`
      covers the wording.
- [x] `adapter_failure` including `signal` and `http_status` reaches
      `status.json` and the terminal `wait` / `spartan-bridge status`
      output; `tests/serialize.test.ts` and `tests/adapter-failure.test.ts`
      assert the whitelist and the status document.
- [x] `ADAPTER_FAILURE_CAUSES` is the previous nine plus
      `provider_unavailable` and `provider_limit`. Every
      `AdapterFailureRecord` fixture the new required keys touch compiles.
- [x] `npm run typecheck` / `npm run build` clean; `npm test` adds no new
      failure.
