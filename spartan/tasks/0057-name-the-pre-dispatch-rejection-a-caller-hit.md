---
protocol: "1.1.0" # x-release-please-version
id: name-the-pre-dispatch-rejection-a-caller-hit
created_at: 2026-09-01
status: completed
phase: done
task_type: implementation
risk: material
current_role: human-operator
next_role: none
updated_at: 2026-09-01
handoff_id: HX-005
next_handoff_id: none
---

# Name the failure a caller hit, before or at dispatch

## Objective

When `spartan-bridge review` (or `doctor`) refuses or fails a round, the CLI
output names *what is wrong* and *what to do*, so the caller fixes it from that
output alone — never by reading `dist/` or digging in a run's `adapter-stderr.log`.
Two failure surfaces, one theme:

1. **Verdict-independent artifact gates** (`parseTaskFrontmatter` → `task_invalid`,
   `checkArtifactWriteShape` → `composition_failed`): keep failing fast, only
   the diagnostic gets specific — *which* check, *what shape was expected*.
2. **Launcher execution failures** (`adapter_failure` in `preflight` / `collect`,
   `capability_denied` / `interface_unavailable`): the captured process output is
   surfaced inline, and known signatures (e.g. an isolated-profile wrapper crashing
   under a relocated `HOME`) map to a curated fix hint. `doctor` also checks a
   resolved wrapper launcher proactively.

## Context

The gates work. They are not the problem.

- `src/core/review.ts:278` catches a `parseTaskFrontmatter` throw and terminates
  `failed` / `task_invalid` before any policy or adapter work.
- `src/core/review.ts:406` runs `checkArtifactWriteShape` **before the adapter
  is constructed** (task `0046` D1/D2). A certain-to-fail composition is refused
  with `human_required` / `task_artifact_write_rejected`, no `execution_id`, no
  review cycle spent.

What is missing is *which* check failed:

- `checkArtifactWriteShape` (`src/core/task-write.ts:95`) has four distinct
  failure points — `readIdentifierPair` null, `spliceRegion` null,
  `applyTemplatePlaceholderCleanup` null, `retractNextHandoffSection` null — all
  collapsed to the single class `composition_failed` (the type is literally
  `{ ok: false; cause: "composition_failed" }`).
- `parseTaskFrontmatter` (`src/policy/task-frontmatter.ts`) throws bare
  `new Error("task_invalid")` in 20 places on the pre-dispatch path (19 in
  `parseTaskFrontmatterDocument`, one in `isReviewAdmittedFrontmatter` via
  `parseTaskFrontmatter`; `resolveReviewKind` has a 21st throw that the `:278`
  catch does not reach).

Observed cost (board task `0027`, 2026-08-31, `/spbridge`):

1. First `review` returned `task_invalid`. Cause was `phase: reviewing` set on a
   `task_type: planning` artifact. The caller had to open
   `dist/policy/task-frontmatter.js` to find it, then reverted `phase` and
   re-dispatched.
2. Next `review` returned `task_artifact_write_rejected` / `composition_failed`.
   Cause was the `## Review` section carrying two sentences of prose after
   `- None recorded.` instead of the byte-exact
   `TEMPLATE_PENDING_PLACEHOLDER`. The caller guessed, trimmed the prose, and
   re-dispatched.

Both fixes were one line. Both cost a round-trip and a `dist/` read because the
reason code was a category, not a diagnosis. No review cycle was burned — the
gates did their job — but the loop is noisier than it needs to be.

Second incident (protocol task `0031`, 2026-09-01, `run-dd3da641`): the
implementation review came back `blocked` / `capability_denied`,
`adapter_failure.phase: preflight, cause: exit_nonzero, exit_code: 1`, and
`doctor` reported `binding reviewer.implementation: adapter unavailable;
reason=interface_unavailable`. The actual cause was one line in the run's
`adapter-stderr.log` — `wrap-official-client: line N: <relocated-home>/.agent-profiles/resolve-profile: No such file or directory`
— i.e. the machine-local isolated-profile wrapper anchored `resolve-profile`
to `$HOME`, which a `cursor-agent` session (relocated `HOME`) breaks when the
Bridge spawns the Claude reviewer wrapper as a child. (That wrapper bug is fixed
in companion commits `eb9e96c` and `5730147`; the diagnostic gap is what this
task closes.)

This is diagnostics only. No gate moves, no new gate, no verdict path changes,
no change to what any adapter attempts. `reason_code` stays a stable enum; the
detail rides beside it.

## Scope

- `src/core/task-write.ts`
  - Add a closed `CompositionFailedDetail` union and a `COMPOSITION_FAILED_HINTS`
    map beside it:
    - `"frontmatter_identifiers_unreadable"` — `readIdentifierPair` returned null
      (missing/duplicate/non-canonical `handoff_id` or `next_handoff_id`).
    - `"review_section_unrecognized"` — `spliceRegion` returned null (`## Review`
      heading count, unbalanced/outside markers, duplicate kind, or
      implementation-before-plan).
    - `"review_placeholder_not_canonical"` — `applyTemplatePlaceholderCleanup`
      returned null (extra prose in the `## Review` body, or a stray
      `Verdict: PENDING` token after cleanup).
    - `"next_handoff_not_retractable"` — outstanding `next_handoff_id` is not
      `none` and `retractNextHandoffSection` returned null (unfenced advisory,
      identifier mismatch, or malformed `## Next Handoff` fences).
  - `ArtifactWriteShapeResult`'s failure arm becomes
    `{ ok: false; cause: "composition_failed"; detail: CompositionFailedDetail }`.
    `cause` stays `"composition_failed"` for every arm.
  - `checkArtifactWriteShape` returns the matching `detail` at each of its four
    early returns. `pre_dispatch_diagnostic` for a composition refusal is the
    corresponding `COMPOSITION_FAILED_HINTS[detail]` string (not assembled by
    callers).
- `src/policy/task-frontmatter.ts`
  - Replace the 20 bare `new Error("task_invalid")` throws on the
    `parseTaskFrontmatter` path with `TaskFrontmatterInvalidError` carrying a
    `detail` string. Structural failures use closed tokens; admission failures
    use a rule sentence with the offending values, e.g.
    `phase 'reviewing' requires task_type 'implementation', current_role 'implementer', and next_role 'reviewer' (got task_type 'planning')`.
    Closed structural tokens (one throw site each unless noted):
    `frontmatter_delimiter_missing`, `frontmatter_utf8_invalid`,
    `frontmatter_unclosed`, `frontmatter_yaml_invalid`,
    `frontmatter_pair_invalid`, `frontmatter_key_node_invalid`,
    `frontmatter_scalar_required`, `frontmatter_duplicate_key`,
    `frontmatter_key_count_wrong`, `frontmatter_missing_required_key` (include
    the key name in the detail string), `protocol_invalid`, `id_invalid`,
    `filename_id_mismatch`, `calendar_date_invalid`, `status_not_active`,
    `risk_invalid`, `role_invalid`, `handoff_id_invalid`,
    `review_admission_denied` (include the offending `phase` / `task_type` /
    role tuple in the detail string). The thrown class still maps to
    `reason_code: "task_invalid"` at `src/core/review.ts:278`.
- `src/core/contracts.ts`
  - `pre_dispatch_diagnostic: string | null` on `StatusDocument` (and the
    matching event), populated only on a pre-dispatch `task_invalid` /
    `task_artifact_write_rejected` terminal, null otherwise. Mirrors the
    nullable-string diagnostic shape of `producer_diagnostic`'s human-facing
    line, not its closed record.
  - Extend `AdapterFailureRecord` with:
    - `output_excerpt_bytes: number` — byte length of the redacted excerpt (0
      when no output was captured).
    - `output_excerpt: string | null` — first 512 bytes of redacted launcher
      process output (see below), null when `output_excerpt_bytes === 0`.
    `stderr_log`, `stderr_bytes`, and `payload_log` keep today's semantics:
    the log file and byte count remain **stderr only**.
- `src/adapters/adapter.ts` + `src/adapters/*.ts`
  - Extend `AdapterFailureError` with an `output: Buffer` field (defaults to
    `stderr`). On a non-zero exit, adapters set `stderr` to the process stderr
    only and `output` to `Buffer.concat([stdout, stderr])` for excerpt
    population; the stderr log file is still written from `stderr` alone.
  - Phase rules for which buffer feeds `output_excerpt` (enforced in
    `persistAdapterFailure`, not left to callers):
    - `preflight`, `start`, `spawn_failed`, and other pre-review phases:
      redacted `output` (stdout + stderr).
    - `collect` with non-empty stderr: redacted stderr only.
    - `collect` with empty stderr and non-zero exit: redacted stdout only
      (the `0031` / `run-8f32bff5` launcher-error-on-stdout case). When stdout
      already contains retained review payload bytes (adapter sets
      `payload` non-null on the error), `output_excerpt` stays null.
- `src/core/review.ts`
  - `:278` and `:406` thread the caught `detail` / hint into
    `pre_dispatch_diagnostic` on the `terminate(...)` call. No control-flow
    change.
  - `persistAdapterFailure`: write `stderr_log` / `stderr_bytes` from the
    carried `stderr` buffer only (unchanged). Populate `output_excerpt` /
    `output_excerpt_bytes` from the phase-appropriate buffer per the rules
    above, via `redactAdapterStderrText`, capped at 512 bytes.
- `src/core/serialize.ts` + `src/cli/main.ts` stderr line
  - Serialize `pre_dispatch_diagnostic` and the new `adapter_failure` excerpt
    fields; on a terminal `review` print one stderr line quoting
    `pre_dispatch_diagnostic` when present, and one quoting `output_excerpt`
    when present.
- **Launcher-failure diagnostics (this slice, not a follow-up):**
  - `src/core/doctor.ts`: add a plain `ADAPTER_FAILURE_SIGNATURE_HINTS` table
    `{ pattern: RegExp; hint: string }[]` (lives in this file; extract only if
    it grows past ~40 lines). When `assessBinding` catches `interface_unavailable`
    after `preflight`, print the binding's captured `output_excerpt` and, when a
    pattern matches, the hint on following stderr lines. First entry:
    `/wrap-official-client.*resolve-profile.*No such file or directory/` →
    "the isolated-profile launcher wrapper anchors `resolve-profile` to `$HOME`,
    which a relocated-HOME session breaks; anchor it to the wrapper's own
    directory — see `docs/AUTHENTICATION-AND-SECURITY.md` and
    `docs/examples/agent-profiles/wrap-official-client`."
  - `src/core/doctor.ts` proactive check (same slice): after resolving a binding's
    launcher executable, if it is a shell script whose text references
    `resolve-profile` or `wrap-official-client`, resolve the `resolve-profile`
    path the script would use from the current environment and emit a warning when
    that path does not exist — a launcher-filesystem probe only, not an
    authentication or sign-in check (`AGENTS.md` doctor boundary). Also warn when
    `process.env.HOME` matches `*/cursor-home` and the binding host is Claude
    Code: the launcher environment may not match what the wrapper expects (a
    relocated `HOME` breaks wrapper path resolution and can make the CLI exit
    before review output is produced). Do not assert whether the operator is
    signed in.
- `docs/AUTHENTICATION-AND-SECURITY.md`: a "Verify isolation" step — from each
  isolated host (including a `cursor-agent` session), run `spartan-bridge
  doctor --repo <a Bridge consumer>` and confirm every reviewer binding
  resolves `adapter available`.
- `docs/ROUTING-AND-WORKFLOWS.md` / `docs/DECISIONS.md`
  - Note that `task_invalid` and `composition_failed` now carry a
    `pre_dispatch_diagnostic`, and that `adapter_failure` carries an
    `output_excerpt` with a `doctor` signature hint; the reason codes are
    unchanged.
- Tests: `tests/task-write.test.ts` (each `CompositionFailedDetail`),
  `tests/frontmatter.test.ts` (representative `TaskFrontmatterInvalidError`
  details), `tests/doctor.test.ts` (signature hint + proactive wrapper check),
  `tests/adapter-failure.test.ts` and/or `tests/cursor-adapter.test.ts` (stub
  launcher `exit_nonzero` with known stdout/stderr → `output_excerpt`), a `review`
  end-to-end asserting `pre_dispatch_diagnostic` is set and quoted for one
  `task_invalid` and one `composition_failed` refusal.

**D6 (done, companion commits `eb9e96c`, `5730147`) — record only; do not
re-implement.** The shipped `docs/examples/agent-profiles/wrap-official-client`
anchors `resolve-profile` to the wrapper directory, guards nested `claude` /
`codex` invocations, restores `HOME` from `AGENT_PROFILES_REAL_HOME`, and the
Claude/Codex adapters forward that marker. Acceptance criteria below verify the
example script only.

## Out of Scope

- Moving, adding, or relaxing any gate. A non-canonical artifact is still
  refused before dispatch; this task only explains the refusal.
- Auto-repairing the artifact, or having the Bridge normalise the `## Review`
  section itself.
- New `reason_code` values. `task_invalid` and `composition_failed` stay.
- The `/spartan` and `/spbridge` skill side (a companion skill edit keeps the
  artifact canonical coming out of the producer round — separate, and owned by
  the protocol skill, not the Bridge).
- The recurring `claude-plan-reviewer-v1` `collect`-phase `adapter_error`
  (separate reliability issue).
- Re-implementing D6 wrapper or adapter allowlist changes (already shipped).

## Constraints

- English artifact.
- The wire `reason_code` enum is unchanged; `pre_dispatch_diagnostic` and
  `adapter_failure.output_excerpt` are additive and nullable, so an old reader
  ignores them.
- No diagnostic string contains a repository path outside the task artifact, a
  credential, or bytes of the reviewed content — it names the rule, not the
  data. **Exception:** a curated `ADAPTER_FAILURE_SIGNATURE_HINTS` entry may
  name Bridge-shipped documentation paths under `docs/` (the hint table is
  Bridge-owned, not artifact-derived).
- `npm run typecheck` / `npm run build` clean; `npm test` no new failure.

## Decisions

- **D1 — one `CompositionFailedDetail` per early return, `cause` unchanged.**
  The four literals above are the complete closed set; `checkArtifactWriteShape`
  keeps returning `composition_failed`; `detail` and `COMPOSITION_FAILED_HINTS`
  ride alongside for humans and tests.
- **D2 — `TaskFrontmatterInvalidError` with a `detail` string** replaces the 20
  bare throws on the `parseTaskFrontmatter` path; still maps to `task_invalid`.
  Structural tokens are closed; admission failures embed the offending values in
  the detail sentence.
- **D3 — `pre_dispatch_diagnostic: string | null` on the status document**,
  populated only on the pre-dispatch refusal terminals (`task_invalid`,
  `task_artifact_write_rejected` / `composition_failed`).
- **D4 — surface launcher process output + a curated hint in this slice.**
  `adapter_failure` gains `output_excerpt` / `output_excerpt_bytes` (not
  `stderr_excerpt` — stdout must be included where safe); `stderr_log` /
  `stderr_bytes` stay stderr-only; adapters pass stdout and stderr separately
  on `AdapterFailureError`; `persistAdapterFailure` applies the phase rules
  above so `collect` does not quote retained review payload into
  `output_excerpt`. The CLI and `doctor` print the excerpt, and `doctor` maps
  known signatures via `ADAPTER_FAILURE_SIGNATURE_HINTS`.
- **D5 — `doctor` proactively checks a wrapper launcher in this slice.** When a
  resolved launcher is a shell script referencing `resolve-profile` /
  `wrap-official-client`, `doctor` verifies the `resolve-profile` path resolves
  from the current environment and warns if not (launcher filesystem only; no
  sign-in probe). Also warn when `HOME` matches `*/cursor-home` with a Claude
  Code reviewer binding — a launcher-environment mismatch risk, not a login
  assertion. Not deferred — acceptance criteria cover it here.
- **D6 (done, companion commits `eb9e96c`, `5730147`) — the shipped wrapper
  example is fixed, and the Claude/Codex adapters forward
  `AGENT_PROFILES_REAL_HOME`.** This task records and verifies only; no
  further wrapper or allowlist edits.

## Acceptance Criteria

- [ ] (D1) A `review` refused for a non-canonical `## Review` section returns
      `reason_code: "task_artifact_write_rejected"` /
      `task_write_rejection_cause: "composition_failed"` **and** a
      `pre_dispatch_diagnostic` from `COMPOSITION_FAILED_HINTS.review_placeholder_not_canonical`;
      no adapter ran and no cycle was spent.
- [ ] (D2) A `review` refused for `phase: reviewing` on a `task_type: planning`
      artifact returns `reason_code: "task_invalid"` **and** a
      `pre_dispatch_diagnostic` naming the phase/task_type/role admission rule.
- [ ] (D1) Each of `checkArtifactWriteShape`'s four failure points yields a
      distinct `CompositionFailedDetail`; `tests/task-write.test.ts` covers all
      four.
- [ ] (D3) `pre_dispatch_diagnostic` is `null` on every non-pre-dispatch
      terminal and on a passing run; serialised in the status document and
      quoted once on stderr when present.
- [ ] (D4) A `review` that fails `adapter_failure` in `preflight` with
      `exit_nonzero` returns the terminal doc with non-null
      `adapter_failure.output_excerpt` (redacted) and matching
      `output_excerpt_bytes`, and the CLI prints the excerpt. A test drives a
      stub launcher that exits non-zero with known stdout and/or stderr.
- [ ] (D4) A `collect`-phase `exit_nonzero` with empty stderr and launcher
      error text on stdout (stub) returns non-null `output_excerpt` quoting
      that stdout and leaves `stderr_log` null; when the adapter carries a
      non-null `payload`, `output_excerpt` is null.
- [ ] (D4) `doctor` against a binding whose preflight fails prints the
      `output_excerpt` and, when it matches the wrapper-crash signature, the fix
      hint pointing at `AUTHENTICATION-AND-SECURITY.md`. `tests/doctor.test.ts`
      asserts the hint text.
- [ ] (D5) `doctor` warns when a resolved launcher is a wrapper script whose
      `resolve-profile` path does not exist from the current environment (no
      sign-in assertion); it is silent when the path resolves.
      `tests/doctor.test.ts` covers both.
- [ ] (D6) `docs/examples/agent-profiles/wrap-official-client`: `resolve-profile`
      and the profile root are derived from the wrapper's own directory (no
      `$HOME/.agent-profiles` literal in those two spots); a nested invocation
      with `CLAUDE_CONFIG_DIR` already set execs the real binary without
      re-resolving; `sh -n` clean. (Verify only — already implemented.)
- [ ] (D1–D4) The `reason_code` enum is byte-identical to before; a reader that
      ignores the new nullable fields sees no behaviour change.
- [ ] `npm run typecheck` / `npm run build` clean; `npm test` adds no new
      failure.

## Work Completed

- 2026-09-01: task created after board `0027` burned two `/spbridge`
  round-trips (each a one-line fix) diagnosing `task_invalid` and
  `composition_failed` from `dist/`. The 0046 pre-dispatch gates worked — no
  cycle was spent — but their reason codes are categories, not diagnoses.
- 2026-09-01: scope widened after protocol task `0031` `run-dd3da641` — a
  `blocked` / `capability_denied` implementation review whose real cause
  (`wrap-official-client` anchoring `resolve-profile` to a relocated `$HOME`)
  was only visible in the run's `adapter-stderr.log`. Companion commits fix
  `docs/examples/agent-profiles/wrap-official-client` (D6); the diagnostic
  gap — surfacing that output and hinting the fix — is D4/D5 of this plan.
- 2026-09-01: second `0031` failure `run-8f32bff5` — with the wrapper's
  `resolve-profile` anchor fixed, preflight passed but the review died in
  `collect` (`exit_nonzero`, `stderr_bytes: 0`, ~1s). Grok reproduced it: a
  relocated `HOME` makes `claude -p` exit "Not logged in" on **stdout**. D6
  extended in companion commits — the wrapper guard restores `HOME`, the
  Claude/Codex adapters forward `AGENT_PROFILES_REAL_HOME`. D4 now also
  requires capturing stdout on a non-zero exit; D5 gains the `*/cursor-home`
  `HOME` warning.
- 2026-09-01: planner refinement (HX-001): pinned `CompositionFailedDetail`,
  `TaskFrontmatterInvalidError` tokens, `output_excerpt` / `output_excerpt_bytes`
  on `AdapterFailureRecord`, confirmed D4/D5 land in this slice (not deferred),
  verified every Scope path exists, recorded D6 as verify-only against
  `eb9e96c` / `5730147`.

- 2026-09-01: plan review cycle 2 (`run-c605d19e`) returned
  `CHANGES_REQUESTED` — split stderr log from `output_excerpt`, phase-bound
  collect capture, planner-addressed `/spbridge` handoff envelope.
- 2026-09-01: plan review cycle 3 (`run-ca01250d`) returned **`APPROVED`**.
  The auto-chain then dispatched the mapped implementer.
- 2026-09-01: **implementer round (Cursor / composer-2.5, auto-chain).** Wrote
  the full implementation — `CompositionFailedDetail` + `COMPOSITION_FAILED_HINTS`
  in `task-write.ts`; `TaskFrontmatterInvalidError` with a `detail` string
  across the 20 throw sites in `task-frontmatter.ts`; `pre_dispatch_diagnostic`
  on `StatusDocument` / the event in `contracts.ts` + `serialize.ts`, threaded
  at `review.ts:278`/`:406`; `AdapterFailureRecord.output_excerpt` /
  `output_excerpt_bytes` + `buildAdapterOutputExcerpt` (stderr log stays
  stderr-only, `collect` never quotes retained payload); each adapter's `fail()`
  passes `stdout`/`stderr` and `Buffer.concat` as the combined output;
  `doctor.ts` `ADAPTER_FAILURE_SIGNATURE_HINTS` + `wrapperLauncherWarnings`;
  `cli/main.ts` prints the excerpt / diagnostic; docs + `tests/` (409 total).
  The round was SIGTERM'd by `producer_timeout` (`transition-c82bd22d`,
  `stage: wait`, `exit_code: 143`) after writing every file but before
  declaring done — see bridge task `0059`.
- 2026-09-01: **human-operator finish.** `npm run build` (the run had also
  tripped `dist/ older than src/` from a mid-session `git pull`). Fixed the 4
  tests the interrupted implementer left red: `resolveExecutableOnPath` walks
  `env.PATH` in JS instead of `sh -c command -v` (the wrapper-lookup test
  restricts `PATH` and `sh` was then unfindable); the two event-key assertions
  gained `pre_dispatch_diagnostic`; the preflight-excerpt stub passes the
  combined `output` a real `fail()` builds. `npm run typecheck` / `npm run
  build` clean; `npm test` **409 / 0**. Advanced the artifact to `phase:
  reviewing` for the implementation review.
- 2026-09-01: **implementation review APPROVED** — Bridge-dispatched
  `reviewer.implementation` (`run-f5322853-f460-4d72-a603-19be3527c4a9`,
  `exec-a2086037`, Claude Code / claude-sonnet-5 / medium, vendor Anthropic;
  read-only, no findings), cycle 1/3. The runtime wrote the `## Review`
  implementation region and set `next_role: human-operator`. **Task completed**
  (human-operator): plan APPROVED (3 cycles), implementation APPROVED, all
  acceptance criteria met, `npm test` 409/0.

## Evidence

- Task artifact path: `spartan/tasks/0057-name-the-pre-dispatch-rejection-a-caller-hit.md`
  (creation number `0057`; frontmatter `id` is the slug without the prefix).
- `src/core/review.ts:278` (`task_invalid` terminal) and `:406`
  (`checkArtifactWriteShape` pre-dispatch, task `0046` D1/D2).
- `src/core/task-write.ts:51` `ArtifactWriteShapeResult` — single
  `composition_failed` arm today; `:95` `checkArtifactWriteShape` — four early
  returns at lines 98–110.
- `src/policy/task-frontmatter.ts` — 20 `new Error("task_invalid")` throws on
  the `parseTaskFrontmatter` path (grep count); admission rule at
  `isReviewAdmittedFrontmatter`.
- `src/core/contracts.ts:233` `AdapterFailureRecord` — today
  `phase`/`cause`/`exit_code`/`stderr_bytes`/`stderr_log`/`payload_log` only;
  `producer_diagnostic` at `:274` is the closed record whose terminal stderr
  line this task mirrors with a nullable string.
- `src/core/doctor.ts` `assessBinding` — `interface_unavailable` after
  `preflight` today prints only `reason=`; no excerpt or signature table yet.
- `src/policy/redact.ts` `redactAdapterStderrText` — reuse for
  `output_excerpt` (home prefixes, Bearer, `sk-`, sensitive keys).
- Path check (2026-09-01): every Scope path exists in the checkout (`src/core/*`,
  `src/policy/task-frontmatter.ts`, `src/adapters/{claude,codex,cursor,grok}.ts`,
  `docs/*`, `tests/{task-write,frontmatter,doctor,adapter-failure}.test.ts`).
- `npm run typecheck` — exit 0; `npm test` — 401 pass, 0 fail (2026-09-01).
- Board `0027` run ids `run-ea9cd70c…` (`task_invalid`) and `run-6c967a74…`
  (`composition_failed`), 2026-08-31.
- Protocol `0031` `run-dd3da641` — `blocked` / `capability_denied`,
  `adapter_failure.phase: preflight`, `stderr_log: adapter-stderr.log`
  containing the `wrap-official-client` / `resolve-profile` crash line.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-ca01250d-3d13-4aa4-9930-8b08f8a5f9ea execution_id=exec-f8e79c80-b7de-411b-81af-f9dbe8e4e92c review_kind=plan verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-sonnet-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:20fcfa7c8df758f5b260cdddb5dfbf86c1d202fcecff22e1ed15e24e6cabf2e0 task_hash=sha256:966d4d4327a32cf5a32c909158fef2060f23c80e1e512b10202feddc40e1a3c8 agents_hash=sha256:5b0538f788aa238a0f4e3edc1477bc42f67c2e71fee4bf230a3cfe394d51eeff timestamp=2026-09-01T15:41:10.379Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-f5322853-f460-4d72-a603-19be3527c4a9 execution_id=exec-a2086037-9ce8-4473-8c02-f0c86acd011e review_kind=implementation verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-sonnet-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:1432cf4ad657ba8b32cb1751f04ef520e7ecebe5fcb14dec11a3dca63243ff05 task_hash=sha256:0569bd90c64fee0c9416bcb0f2247c161ca548d8030545811a60f5dd504c6c3e agents_hash=sha256:5b0538f788aa238a0f4e3edc1477bc42f67c2e71fee4bf230a3cfe394d51eeff timestamp=2026-09-01T20:47:09.399Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None. Independent of `0053` / `0054` / `0056`.

## Next Action

None — task completed. Plan review (3 cycles, `run-ca01250d`) and
implementation review (`run-f5322853`) both passed through the Bridge; `npm
test` 409/0. Follow-up: the `producer_timeout` that cut the auto-chain
implementer short is bridge task `0059`.

## Next Handoff

No outstanding handoff. Task completed on the Bridge implementation-review pass
and human-operator sign-off.
