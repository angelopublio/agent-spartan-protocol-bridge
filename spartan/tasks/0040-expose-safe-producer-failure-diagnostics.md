---
protocol: "1.0.0" # x-release-please-version
id: expose-safe-producer-failure-diagnostics
created_at: 2026-08-23
status: completed
phase: complete
task_type: implementation
risk: high-impact
current_role: reviewer
next_role: none
updated_at: 2026-08-23
handoff_id: HX-006
next_handoff_id: none
---

# Expose safe producer-failure diagnostics

## Objective

Make an automatic producer stop diagnosable from its transition status and terminal event without
changing the existing terminal reason policy or persisting any producer-controlled text. A caller
must be able to distinguish write-scope-lock, spawn, wait, timeout, and nonzero/null-exit failures
from closed scalar data while old transition documents remain readable.

## Context

Completed task `0039` shipped the foreground automatic Cursor implementer path. Three explicit
task-0031 transitions then acquired and released the writer lock, emitted `producer_started`, stopped
after roughly 4-5 seconds as `producer_failure`, made no product edit, and started no implementation
review:

- `transition-a98875b9-cfd6-42da-b8ad-93876d33969f`
- `transition-3428d961-5a24-43e1-917c-5dccdaf08a52`
- `transition-b5332950-6b80-4fbe-aa13-daa67718d7ef`

Their persisted documents contain only the umbrella reason. In `src/core/transition.ts`, the same
reason currently covers a thrown `lockProducerWriteScope`, a thrown `startProducer`, a thrown
`waitProducer`, and a returned nonzero or null child exit. The existing returned-timeout arm has the
separate compatible reason `producer_timeout` but likewise carries no structured detail.

This task runs in the separate worktree
`.spartan-bridge/worktrees/0040-producer-failure-diagnostics` on branch
`task/0040-producer-failure-diagnostics`, created from `main` commit
`3b5f307bd4e5fa8f55bf41c049ac26c61c346cc2`. The primary worktree has an unrelated modification to
task `0031`; task 0040 must never modify, move, commit, stash, or otherwise operate on that worktree
or artifact.

## Scope

- `src/core/contracts.ts`, `src/core/transition.ts`, and `src/core/serialize.ts`: define, populate,
  and safely serialize the additive transition producer diagnostic.
- `src/adapters/producer-write-scope.ts` only as needed to expose the existing closed write-scope
  failure vocabulary to the core without duplicating an open string contract.
- `tests/transition.test.ts`, `tests/serialize.test.ts`, and the smallest relevant transition-store or
  CLI compatibility test: cover every producer failure arm, persistence, serialization, old records,
  success, and guard cleanup.
- `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`, and
  `docs/AUTHENTICATION-AND-SECURITY.md`: record the additive schema and its strict data boundary.
- This task artifact.

## Out of Scope

- Diagnosing or fixing the underlying Cursor client failure itself.
- Retrying, reopening, editing, stashing, committing, or otherwise operating on task `0031` or its
  current worktree during task 0040.
- Invoking Spartan Bridge, `/spbridge`, an automatic implementer, or any of the three failed
  transitions.
- New reason codes, retries, telemetry export, stderr/stdout logs, prompt capture, or changes to
  adapter process arguments, timeouts, authentication, models, bindings, policy, write scope, or
  lock semantics.
- Schema-version negotiation or rewriting historical transition files.

## Constraints

- All task-0040 producer, review, correction, and implementation rounds are human-started manual
  Spartan rounds. Each reviewer is fresh and technically read-only.
- The four currently collapsed arms retain `reason_code: producer_failure`; no stage-specific reason
  code is added. The already distinct returned-timeout arm retains `producer_timeout` for backward
  compatibility.
- No diagnostic field may contain producer stdout or stderr, prompts, payloads, paths, credentials,
  authentication state, client prose, model/account information, environment, error messages, or
  class names derived from an unknown throw.
- The runtime must finish all guarded capture and validation work and restore repository modes before
  writing a terminal transition status or event. Existing exactly-once release and final cleanup/lock
  release behavior must remain unchanged.
- The task may be committed and pushed only after an explicit final implementation `APPROVED`
  verdict and all repository checks pass. Commit and push are the only authorized external actions;
  merge/integration and the task-0031 retry remain human-started follow-up work.

## Decisions

### D1 - One nullable closed record explains producer execution stops

Add `producer_diagnostic` to both `TransitionStatusDocument` and
`TransitionEventDocument` as `ProducerDiagnostic | null`. `ProducerDiagnostic` has exactly these
fixed keys:

```text
stage: write_scope_lock | spawn | wait | exit_nonzero
exit_code: integer | null
timed_out: boolean
write_scope_code: symlink | exact_file_missing | confine_unavailable | hardlink | null
adapter_phase: preflight | prepare | start | collect | verify | post_review_snapshot | persist_result | null
adapter_cause: not_spawned | spawn_failed | timed_out | exit_nonzero | output_overflow |
               output_unparsable | interface_unrecognized | unexpected_error | runtime_error | null
```

The adapter phase/cause values reuse `ADAPTER_FAILURE_PHASES` and `ADAPTER_FAILURE_CAUSES`. Move the
existing `ProducerWriteScopeFailure` value list/type to the shared closed contracts layer (and import
and re-export it from `producer-write-scope.ts`) rather than creating a second drifting vocabulary.
This is a type-ownership refactor only; existing imports, `ProducerWriteScopeError`, and its four
codes keep their existing public behavior.

New transitions initialize the field to `null`. Non-terminal events carry `null`. A successful
producer round, a completed implementation review, and every non-producer stop also retain `null`.
Only a producer execution stop described in D2 carries a non-null record, and the final
`terminal_stop` event must carry the same record as terminal `status.json`.

### D2 - Each failure arm maps deterministically without inspecting prose

Change the guarded round's stop result from only a reason to a reason plus nullable diagnostic, and
populate it at the exact catch/result boundary:

| Arm | Reason | Diagnostic |
| --- | --- | --- |
| `lockProducerWriteScope` throws | `producer_failure` | `stage: write_scope_lock`; exact `ProducerWriteScopeError.code` when the throw is that class, otherwise null; other fields null/false |
| `startProducer` throws | `producer_failure` | `stage: spawn`; phase/cause/exit only from a recognized `AdapterFailureError` or `AdapterTimeoutError` record; unknown throws contribute no text |
| `waitProducer` throws | `producer_failure` | `stage: wait`; phase/cause/exit only from the same recognized closed adapter record; unknown throws contribute no text |
| wait returns `timedOut: true` | existing `producer_timeout` | `stage: wait`, sanitized integer-or-null exit, `timed_out: true`, other fields null |
| wait returns nonzero exit | `producer_failure` | `stage: exit_nonzero`, exact integer exit, `timed_out: false`, other fields null |
| wait returns null exit without timeout | `producer_failure` | `stage: exit_nonzero`, `exit_code: null`, `timed_out: false`, other fields null |

A shared constructor validates membership in the closed arrays and accepts only a finite integer exit
code or null. It never falls back to `error.message`, `error.name`, stringification, stdout, stderr,
payload, or adapter log fields. The existing post-spawn snapshots still run before returned timeout
or exit status is classified, so the diagnostic does not weaken mutation detection.

### D3 - Diagnostic persistence happens only after guard restoration

`runGuardedRound` remains persistence-free and returns the diagnostic as inert scalar data.
`finishProducerRound` retains its single `releaseProducerWriteScope()` call in the existing
`finally`, then passes a stop diagnostic to `stopTransition` only after that `finally` has completed.
`stopTransition` sets the status reason and diagnostic together before emitting `terminal_stop`;
`emitTransition` copies the status diagnostic into that event. No status/event write moves into the
guarded interval, and cleanup plus writer-lock release remain in the outer existing `finally`.

### D4 - Serialization is additive, closed, and compatible with old bytes

Keep `schema_version: 2`. The new field is optional to historical input and nullable in the normalized
in-memory contract. New serializers always emit `producer_diagnostic`, using a dedicated serializer
that reconstructs only D1's six keys. It must reject or null any value outside the closed enums,
integer/null exit domain, and boolean timeout domain; extra properties are never copied.

`parseTransitionStatusJson` normalizes a missing historical field to `null`. Existing
`transition-status` and `transition-events` CLI reads continue returning admitted stored bytes
unchanged, so pre-fix documents without the key still read successfully and are not rewritten. No
historical event parser or migration is introduced.

### D5 - Tests prove every arm, safe output, success, and cleanup

Use deterministic fake adapters and current orchestration seams rather than a live provider:

- Table-test all four `ProducerWriteScopeError` codes plus an unknown lock throw.
- Test a recognized and unknown `startProducer` throw, a recognized and unknown `waitProducer`
  throw, returned timeout, returned nonzero exit, and returned null exit.
- For every enumerated collapsed arm, assert `producer_failure`, the exact diagnostic, no
  `producer_finished`, no implementation review, matching terminal status/event records, guard
  release before persistence, cleanup, and writer-lock release.
- Assert a returned timeout retains `producer_timeout` and records `stage: wait` with
  `timed_out: true`.
- Assert a full successful producer/reviewer chain has `producer_diagnostic: null` in returned and
  persisted status and all events.
- Inject extra secret/prose/path/stdout/stderr/prompt/payload/model/account properties at the
  serialization boundary and prove only the six whitelisted scalar keys appear.
- Parse a pre-fix status without the key as null, and preserve the existing CLI tests that return
  old transition status/event bytes exactly.
- Keep the existing real guard lifecycle regressions passing; add a focused ordering assertion only
  if the arm tests do not already prove release precedes terminal persistence.

### D6 - Documentation names the diagnostic as classification, not captured output

Add a dated decision after D-035 and concise architecture/security updates. They must state that the
record is a closed Bridge-owned classification, that reason codes and schema version remain stable,
that old transition bytes are accepted, and that no provider/client text or sensitive process state
is persisted. Do not document it as telemetry, a raw error, an authentication diagnosis, or proof of
the underlying Cursor cause.

### D7 - Manual review, implementation, integration, and retry remain separate gates

The approved plan received one fresh mapped Cursor review using `claude-opus-5-thinking-high` at
high effort, read-only and without Bridge invocation. The human now manually starts the mapped
Cursor implementer using `claude-sonnet-5-thinking-high` at high effort. A fresh mapped Codex
implementation reviewer uses `gpt-5.6-terra` at high effort. Findings return through manual Spartan
handoffs; no automatic path is used while that path is under diagnosis.

After the final implementation review is `APPROVED`, the writable producer updates this artifact
through completion, runs `git diff --check`, `npm run typecheck`, `npm run build`, and `npm test`,
then creates one task-boundary commit and pushes branch
`task/0040-producer-failure-diagnostics`. The completion response must identify the pushed commit and
give two exact, separately labeled human-started follow-ups: integration of that branch without
operating on task `0031`, and a retry prompt copied from task `0031`'s then-current handoff after
integration. The task-0031 artifact is read only for that final copy and is never edited by task 0040.

## Outcome

Completed. Automatic producer failures now carry a closed, additive `producer_diagnostic` in
transition status and terminal events without changing existing reason codes or persisting
producer-controlled text. Every requested failure, success, serialization, compatibility,
persistence, and cleanup case is covered. The corrected implementation and documentation received a
fresh final `APPROVED` re-review with no findings, and all repository checks pass.

## Work Completed

- Created this task and branch in the separate clean worktree requested by the human; the primary
  worktree and task `0031` were not modified, moved, committed, or stashed.
- Read the three explicitly named transition records directly. Each contains authorization,
  `lock_acquired`, `producer_started`, then terminal `producer_failure`, with no linked implementation
  review; elapsed times are approximately 3.6, 5.2, and 4.0 seconds.
- Traced the four collapsed arms, the separate returned-timeout arm, the transition serializers,
  old-byte CLI read path, Cursor adapter failure records, and the existing guard-release ordering.
- Current host/model: Codex, `gpt-5.6-sol`, high effort.
- Manual plan review `HX-001` ran in a fresh read-only Cursor session with
  `claude-opus-5-thinking-high` at high effort and returned `APPROVED` with no findings. Because that
  reviewer could not write the worktree, this planner round adopted `HX-001`, persisted its verdict,
  and prepared the manually started implementer handoff.
- Manual implementer round `HX-002` (Cursor, `claude-sonnet-5-thinking-high`, high effort) accepted the
  matching `next_handoff_id` and implemented D1-D7 without invoking Spartan Bridge, touching task
  `0031`, committing, or pushing:
  - D1: moved `ProducerWriteScopeFailure`'s value list/type to `src/core/contracts.ts`
    (`PRODUCER_WRITE_SCOPE_FAILURES`) with a re-export from `src/adapters/producer-write-scope.ts`;
    `ProducerWriteScopeError` and its four codes are otherwise unchanged. Added the closed
    `ProducerDiagnostic` type (`stage`, `exit_code`, `timed_out`, `write_scope_code`, `adapter_phase`,
    `adapter_cause`) and the shared `buildProducerDiagnostic` constructor, which validates enum
    membership and a finite-integer-or-null exit code and throws otherwise. Added nullable
    `producer_diagnostic` to `TransitionStatusDocument` and `TransitionEventDocument`.
  - D2: in `src/core/transition.ts`'s `runGuardedRound`, split the previously combined
    `startProducer`/`waitProducer` try/catch into two, so each of the four collapsed
    `producer_failure` arms (write-scope-lock throw, spawn throw, wait throw, returned nonzero/null
    exit) and the existing `producer_timeout` arm populate the exact diagnostic named in the plan's D2
    table at its own catch/result boundary. A recognized `AdapterFailureError`/`AdapterTimeoutError`
    contributes its closed phase/cause/exit fields; every other throw (including a rethrown
    `ProducerWriteScopeError` from a hypothetical standalone `startProducer` guard fallback) contributes
    null adapter detail. Every other stop reason (`runtime_state_violation`, `write_scope_violation`,
    `task_unreadable`, `producer_declaration_invalid`, `cancelled`, capture errors) keeps a null
    diagnostic, matching D1.
  - D3: `runGuardedRound` still returns only an inert `{ reason, diagnostic }` pair from inside the
    guarded interval; `finishProducerRound`'s existing single `releaseProducerWriteScope()` call in its
    `finally` is unchanged, and `stopTransition` (called only after that `finally` completes) now sets
    `reason_code` and `producer_diagnostic` together before `emitTransition` writes `terminal_stop`;
    `emitTransition` copies the status diagnostic into every event's `producer_diagnostic`, so
    non-terminal events see it null until the terminal write flips it.
  - D4: `src/core/serialize.ts` gained `serializeProducerDiagnostic`, which nulls the whole record on an
    invalid `stage` and otherwise whitelists exactly the six keys, nulling/normalizing any field outside
    its own closed enum, integer-or-null exit domain, or boolean timeout domain. `serializeTransitionStatus`
    and `serializeTransitionEvent` both call it. `parseTransitionStatusJson` normalizes a missing key to
    `null` via `parsed.producer_diagnostic ?? null`. `schema_version` stays `2`; the CLI's
    `transition-status`/`transition-events` commands already return raw stored bytes rather than
    re-serializing, so old documents without the key continue reading unchanged (confirmed by the
    existing `tests/cli.test.ts` old-byte assertions, which still pass).
  - D5: added one table-driven test (`tests/transition.test.ts`) covering all four `ProducerWriteScopeError`
    codes plus an unknown lock throw, a recognized and unknown `startProducer` throw, a recognized and
    unknown `waitProducer` throw, returned timeout, returned nonzero exit, and returned null exit; each
    case asserts the exact diagnostic on both the returned transition and its persisted terminal event,
    no `producer_finished`/`implementation_review_dispatched` event, and a null diagnostic on every
    earlier event. Added a second test asserting a full successful producer/reviewer chain keeps
    `producer_diagnostic: null` throughout. Added `tests/serialize.test.ts` cases for the six-key
    whitelist, out-of-enum/out-of-domain injection (including secret/path/prose-shaped extra
    properties), and `parseTransitionStatusJson` old-byte normalization. The existing real-guard
    ordering regressions (`chflags`, real Cursor POSIX guard) were left unchanged and still pass,
    already proving guard release precedes terminal persistence for every path including a stop.
  - D6: added decision `D-036` in `docs/DECISIONS.md` immediately after `D-035`, and one paragraph each
    in `docs/ARCHITECTURE.md` and `docs/AUTHENTICATION-AND-SECURITY.md`, all stating the record is a
    closed Bridge-owned classification (not telemetry, a raw error, an authentication diagnosis, or
    proof of the underlying Cursor cause), that `producer_failure`/`producer_timeout`/`schema_version`
    stay stable, that old transition bytes are accepted, and the complete prohibited-data list.
  - D7: this round ran manually in Cursor (`claude-sonnet-5-thinking-high`, high effort, as recommended)
    without invoking Spartan Bridge or `/spbridge`, and made no change to task `0031` or the primary
    worktree.
- Manual implementation review `HX-003` ran in a fresh read-only Codex session with
  `gpt-5.6-terra` at high effort and returned `CHANGES_REQUESTED`. The implementation behavior was
  preserved; the only finding is that D-036, architecture, and security documentation must say the
  diagnostic is constructed during the guarded round while terminal status/event persistence occurs
  only after guard restoration.
- Manual correction round `HX-004` (Cursor, `claude-sonnet-5-thinking-high`, high effort) accepted the
  matching `next_handoff_id` and corrected only the `DIAGNOSTIC_GUARD_ORDERING_DOCS` finding, touching
  no implementation file, task `0031`, or the primary worktree, and made no commit or push:
  - `docs/DECISIONS.md` D-036: replaced the "populates it ... strictly after the write-scope guard
    has already released" sentence with wording that the closed constructor populates the diagnostic
    at the catch/result boundary inside `runGuardedRound` **while the write-scope guard is still
    active**, and that only afterward does `finishProducerRound`'s existing single-`finally`
    `releaseProducerWriteScope()` call release the guard, with the diagnostic persisted into terminal
    `status.json` and its `terminal_stop` event only once that release has completed.
  - `docs/ARCHITECTURE.md`: added the same guard-then-persist ordering to the producer-diagnostic
    paragraph: construction happens "at the catch/result boundary inside the still-guarded round";
    that construction "only produces inert returned data"; guard release happens once "afterward";
    persistence into terminal `status.json`/`terminal_stop` happens "only then."
  - `docs/AUTHENTICATION-AND-SECURITY.md`: replaced the closing clause ("populated only after the
    write-scope guard has already released") with the same corrected sequence — construction while
    the guard is still active, release, then persistence — so all three documents now agree with each
    other and with the source: `buildProducerDiagnostic` is called at the diagnostic-construction
    sites inside `runGuardedRound` (`src/core/transition.ts:457,515,526,576,584,591`), which runs
    entirely before `finishProducerRound`'s `finally` at lines 402-415 calls
    `releaseProducerWriteScope()`; `stopTransition`/`emitTransition`, which persist the diagnostic,
    are called only afterward (line 418, and the success path at 420-421).
  - No `src/`, `tests/`, `spartan/tasks/0031-*`, or primary-worktree file was modified; `git status
    --short`/`git diff --stat` after the correction show only the three documentation files changed
    beyond the artifact itself.
- Before proposed re-review `HX-005` ran, the planner corrected its handoff-only contradiction: a
  technically read-only reviewer returns its verdict instead of writing this artifact and runs only
  repository-read-only checks while verifying the implementer's recorded build/test evidence. The
  changed prompt advances to `HX-006`; no product file changed.
- Fresh read-only Codex re-review `HX-006` (`gpt-5.6-terra`, high effort) returned `APPROVED` with no
  findings after verifying the corrected documentation ordering directly against the source, the
  task-0031/primary-worktree boundary, the read-only checks, and the recorded writable-round
  build/test evidence.

## Evidence

- `git status --short`, primary worktree before task creation: only
  `M spartan/tasks/0031-say-how-to-resume-a-chain-a-failed-cycle-interrupted.md`; no action was taken
  on it.
- `git rev-parse main` and `git rev-parse origin/main`: both
  `3b5f307bd4e5fa8f55bf41c049ac26c61c346cc2`.
- Direct reads of the three explicit `.spartan-bridge/transitions/<id>/{status.json,events.jsonl}`
  files: all match the operational evidence summarized in Context and contain no diagnostic field.
- Source inspection: `src/core/transition.ts` maps write-scope-lock, start, wait, and nonzero/null-exit
  failures as described in D2; `finishProducerRound` releases the guard before calling
  `stopTransition`; `src/core/serialize.ts` currently has no transition diagnostic serialization.
- `git diff --check`, 2026-08-23: exit 0.
- `npm run typecheck`, 2026-08-23: exit 0 (`tsc --noEmit`).
- `npm run build`, 2026-08-23: exit 0 (`tsc`).
- `npm test`, 2026-08-23: the first run inside the outer host sandbox reached 326 passes and nine
  expected macOS nested-`sandbox-exec` exit-71 failures; the authorized rerun outside that outer
  sandbox exited 0 with 335 tests, 335 passes, and 0 failures.
- Manual Cursor plan review `HX-001`, 2026-08-23: `APPROVED`, no findings; read-only checks
  `npm run typecheck` and `git diff --check` exited 0, and the reviewer independently verified D1-D7,
  all fourteen acceptance criteria, the failure-arm source mapping, serializer/read paths, guard
  ordering, scope completeness, and handoff agreement.
- Manual Cursor implementer round `HX-002`, 2026-08-23 (`claude-sonnet-5-thinking-high`, high effort):
  `git diff --check` exited 0 (no whitespace errors); `npm run typecheck` exited 0 (`tsc --noEmit`);
  `npm run build` exited 0 (`tsc`); `npm test` (`node --import tsx --test tests/*.test.ts`) run outside
  the outer host sandbox (`required_permissions: ["all"]`, matching the prior round's documented need
  for the real nested `sandbox-exec` regressions) exited 0 with 343 tests, 343 passes, 0 failures — the
  335 from the plan-review baseline plus 8 new: one table-driven arm test and one success-chain test in
  `tests/transition.test.ts`, and six cases in `tests/serialize.test.ts`.
- Diff scope check, 2026-08-23: `git status --short`/`git diff --stat` show only
  `docs/ARCHITECTURE.md`, `docs/AUTHENTICATION-AND-SECURITY.md`, `docs/DECISIONS.md`,
  `src/adapters/producer-write-scope.ts`, `src/core/contracts.ts`, `src/core/serialize.ts`,
  `src/core/transition.ts`, `tests/serialize.test.ts`, and `tests/transition.test.ts` modified, all
  within this task's declared Scope; no file under task `0031` or the primary worktree was touched, and
  no commit was made.
- Manual Codex implementation review `HX-003`, 2026-08-23 (`gpt-5.6-terra`, high effort):
  `CHANGES_REQUESTED` with one documentation-ordering finding; `git diff --check`,
  `npm run typecheck`, and `npm run build` exited 0, and the reviewer ran the full test command before
  returning the verdict.
- Manual Cursor correction round `HX-004`, 2026-08-23 (`claude-sonnet-5-thinking-high`, high effort):
  read `src/core/transition.ts` directly to confirm `buildProducerDiagnostic` is called only from
  inside `runGuardedRound` (before `finishProducerRound`'s `finally` releases the write-scope guard)
  and that `stopTransition`/`emitTransition` persist the diagnostic only after that `finally`
  completes; edited exactly the D-036 paragraph in `docs/DECISIONS.md`, the producer-diagnostic
  paragraph in `docs/ARCHITECTURE.md`, and the closing clause in
  `docs/AUTHENTICATION-AND-SECURITY.md` to state construct-while-guarded-then-release-then-persist.
  `git diff --check` exited 0; `npm run typecheck` exited 0 (`tsc --noEmit`); `npm run build` exited 0
  (`tsc`); `npm test` (`node --import tsx --test tests/*.test.ts`, `required_permissions: ["all"]`,
  matching the prior rounds' documented need for the real nested `sandbox-exec` regressions) exited 0
  with 343 tests, 343 passes, 0 failures — unchanged from the HX-002 baseline, since this round
  touched no test or product file. `git status --short`/`git diff --stat` after the edit show only
  `docs/ARCHITECTURE.md`, `docs/AUTHENTICATION-AND-SECURITY.md`, and `docs/DECISIONS.md` changed
  beyond the prior round's diff and this task artifact; no file under task `0031` or the primary
  worktree was touched, and no commit was made.
- Manual Codex re-review `HX-006`, 2026-08-23 (`gpt-5.6-terra`, high effort): `APPROVED`, no
  findings; `git diff --check` and `npm run typecheck` passed read-only, and the reviewer verified the
  recorded green writable-round build/test evidence.
- Final writable-round checks, 2026-08-23: `git diff --check`, `npm run typecheck`, and
  `npm run build` exited 0; authoritative outside-outer-sandbox `npm test` exited 0 with 343 tests,
  343 passes, and 0 failures.

## Review

### Manual plan review

Verdict: APPROVED

Findings:

- None recorded.

Reviewer: Cursor, `claude-opus-5-thinking-high`, high effort, fresh read-only session.

### Manual implementation review

Verdict: CHANGES_REQUESTED

Findings:

- `DIAGNOSTIC_GUARD_ORDERING_DOCS` (error): D-036, architecture, and security documentation say the
  producer diagnostic is populated after guard release. The code correctly constructs the closed
  diagnostic inside `runGuardedRound`; only terminal transition status/event persistence happens
  after `releaseProducerWriteScope()`. Correct the documentation without changing implementation.

Reviewer: Codex, `gpt-5.6-terra`, high effort, fresh read-only session.

### Final manual implementation re-review

Verdict: APPROVED

Findings:

- None recorded.

Reviewer: Codex, `gpt-5.6-terra`, high effort, fresh technically read-only session (`HX-006`).

## Blockers

None.

## Next Action

None. Task 0040 is complete; the authorized final actions are its single task-boundary commit and
branch push, followed by the human-started integration and task-0031 retry handoffs returned by this
round.

## Next Handoff

No outstanding handoff. Task 0040 is closed.

## Acceptance Criteria

- [x] D1: `TransitionStatusDocument` and `TransitionEventDocument` gain one nullable
      `producer_diagnostic` whose only keys and value domains are exactly the six closed scalars in
      D1; new non-terminal, successful, and non-producer records carry null.
- [x] D1-D2: every existing `ProducerWriteScopeError` code is preserved exactly in a
      `write_scope_lock` diagnostic, while an unknown lock throw records null detail and remains
      `producer_failure`.
- [x] D2: a recognized `startProducer` failure records `stage: spawn` and only its safe closed
      adapter phase/cause/integer-or-null exit; an unknown throw records null adapter detail; both
      retain `reason_code: producer_failure`.
- [x] D2: a recognized `waitProducer` failure records `stage: wait` and only its safe closed adapter
      phase/cause/integer-or-null exit; an unknown throw records null adapter detail; both retain
      `reason_code: producer_failure`.
- [x] D2: returned nonzero and null child exits record distinct `exit_code` values under
      `stage: exit_nonzero`, `timed_out: false`, and unchanged `producer_failure`; no new reason code
      is introduced.
- [x] D2: returned timeout preserves the existing `producer_timeout` reason and records
      `stage: wait`, the sanitized exit, and `timed_out: true` without provider-derived data.
- [x] D1-D3: a successful producer and implementation-review pass returns and persists a null
      diagnostic, while every producer execution stop persists the exact same non-null diagnostic in
      terminal `status.json` and its `terminal_stop` event and starts no implementation review.
- [x] D3: pre/post captures and validation still run while guarded; repository modes are restored
      exactly once before terminal status/event persistence; outer producer cleanup and writer-lock
      release still occur on success, throw, timeout, nonzero/null exit, and cancellation.
- [x] D4: new status/event JSON always emits either null or the exact six-key whitelisted record;
      injected stdout, stderr, prompts, payloads, paths, credentials, authentication state, client
      prose, error text, model/account data, extra properties, and invalid enum/scalar values cannot
      enter persisted output.
- [x] D4: a pre-fix transition status without `producer_diagnostic` normalizes to null when parsed;
      existing contained `transition-status` and `transition-events` reads still return old stored
      bytes successfully and do not rewrite them; `schema_version` remains 2.
- [x] D5: deterministic regression tests cover every row in D2, success/null behavior, terminal-event
      equality, no-review-on-stop, safe serialization, old-document compatibility, and unchanged
      release/cleanup/lock ordering without a live provider call.
- [x] D6: decisions, architecture, and security documentation agree on the closed additive record,
      stable reason/schema behavior, historical compatibility, complete prohibited-data list, and the
      corrected construct-while-guarded/persist-after-release ordering.
- [x] D7: plan review, implementation, and implementation review are all human-started through the
      mapped hosts; no task-0040 round invokes Spartan Bridge, retries a failed transition, or modifies
      the primary worktree/task `0031`.
- [x] D7: after final implementation `APPROVED`, `git diff --check`, `npm run typecheck`,
      `npm run build`, and `npm test` all exit 0; the completed task artifact and product changes are
      committed once and branch `task/0040-producer-failure-diagnostics` is pushed before the exact
      integration and then-current task-0031 retry handoffs are returned.
