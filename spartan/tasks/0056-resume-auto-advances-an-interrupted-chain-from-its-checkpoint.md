---
protocol: "1.1.0" # x-release-please-version
id: resume-auto-advances-an-interrupted-chain-from-its-checkpoint
created_at: 2026-08-31
status: completed
phase: complete
task_type: implementation
risk: high-impact
current_role: human-operator
next_role: none
updated_at: 2026-09-02
handoff_id: HX-004
next_handoff_id: none
---

# `spartan-bridge resume` auto-advances an interrupted chain from its last checkpoint

## Objective

When a detached auto-chain is interrupted after the mapped implementer already
finished its round (`producer_finished`), `spartan-bridge resume` carries the
transition forward through implementation review to a terminal record — without
a producer round and without re-running work the Bridge already recorded —
instead of stopping it as `interrupted` for the operator to hand-finish.

## Context

Task `0055` shipped B + D: `review --detach` + `spartan-bridge wait` reparent
the auto-chain off the caller's shell, and `spartan-bridge resume` releases a
dead-pid `writer.lock` and marks an interrupted non-terminal successor
transition `stopped` / `interrupted`. Locked D4 of `0055` originally required
`resume` to also **auto-advance** from a recorded checkpoint; that half was
narrowed out under an owner override (see `0055` Work Completed, 2026-08-31)
because implementing it correctly is not a splice into the existing dispatch
loop and should not ride an implementation-review correction cycle.

The narrowed `resume` is correct for the two motivating incidents (`0026`,
`0046`): both died in `producer_running`, before any declaration, and D4's
refuse arm — stop, release, hand to a human — is the right outcome there. What
this task adds is recovery for the rarer leftover: the node process died
*after* the implementer emitted `producer_finished` (or after
`implementation_review_result`), before the transition reached a terminal
record. Today `resume` stops that chain; it could finish it.

### The design constraint the second opinion surfaced

`continueAfterPlanReview` (`src/core/transition.ts`) is not a checkpoint
machine: it always runs `runProducerRound` then `runReview`, and it emits
`implementation_review_dispatched` and `implementation_review_result`
back-to-back *after* `runReview` returns — so a crash inside `runReview` still
leaves the transition looking like `producer_finished`, and `runReview` may
already have created the review run and persisted its region before returning.
Re-entering the loop from `resume` therefore risks double-dispatching a review
that already finished, and violates "no producer round" on the
`changes_requested` correction arm (which emits `correction_dispatched` and
runs another producer).

The recommended shape is an extracted
`advanceFromCheckpoint(transition, deps)` that both `continueAfterPlanReview`
and `resume` call, keyed on the **last transition event type** (transition
`state` is too coarse — `reviewing` covers dispatched, result, and
`correction_dispatched`).

### Liveness / ownership

`0055`'s `resume` releases the lock and walks away. Auto-dispatch makes `resume`
a second orchestrator of the transition, so it must:

- gate on the detached invocation pid being dead (necessary, not sufficient —
  `pid <= 1` and `pid === 0` are already treated as dead);
- re-acquire the writer lock *as the resume process* before dispatching, and
  refuse if the invocation pid is alive or a non-terminal linked
  implementation-review run is still live;
- refuse if an orphaned producer child could still be writing the worktree
  (a `producer_started` last event, or a worktree that is dirty in a way the
  Bridge did not record) — a live writer under a read-only reviewer with the
  lock already dropped is the failure to avoid.

## Scope

- `src/core/transition.ts`: extract `advanceFromCheckpoint(transition, deps)`
  from the `continueAfterPlanReview` successor loop; `continueAfterPlanReview`
  calls it for the normal path.
- `src/cli/detach.ts`: `resumeInterrupted` calls `advanceFromCheckpoint` for a
  dead-pid invocation whose last transition event is a resumable checkpoint,
  after re-acquiring the writer lock; keeps today's `interrupted` stop for
  `producer_started` / `correction_dispatched` / a live producer.
- `src/runtime/lock.ts`: only if stale dead-pid release plus
  `acquireWriterLock(repoRoot, transition.transition_id, …)` on the existing
  transition is insufficient (the `pid` field `0055` added is expected to
  suffice).
- Tests: `tests/transition.test.ts` and `tests/detach.test.ts` — unit
  `advanceFromCheckpoint` from each checkpoint including the double-dispatch
  window (`producer_finished` with a terminal linked review run → no spawn);
  `resume` end-to-end from `producer_finished` and from
  `implementation_review_result`; `resume` refusing a live invocation and a
  `producer_started` death.
- `docs/DECISIONS.md`: fold the auto-advance into D-054 (it names this as a
  deferred refinement) or a short successor decision; `docs/ROUTING-AND-WORKFLOWS.md`
  detach/wait/resume section gains the checkpoint behaviour.

## Out of Scope

- Anything `0055` already shipped (detach, wait, the stale-lock release, the
  `interrupted` stop for `producer_running`).
- A daemon / supervised worker / boot reconciliation (D-006 Phase 5).
- Respawning a producer that died mid-round.
- The producer isolated-workspace change (`0053`), the pre-spawn scope scan
  (`0054`).

## Constraints

- English artifact.
- No producer round in `resume`: it replays Bridge checkpoints only, and it
  never spawns `runReview`.
- `advanceFromCheckpoint` must be idempotent enough that a second `resume` (or a
  `resume` racing a still-draining `wait`) cannot double-dispatch a review or
  double-finalise a transition.
- `resume` that finalises must own the writer lock for the duration and release
  it on the terminal record, exactly as `continueAfterPlanReview` does.
- `npm run typecheck` / `npm run build` clean; `npm test` no new failure.

## Decisions

- **D1 (locked) — extract `advanceFromCheckpoint`, do not re-enter the
  successor loop.** Confirmed against the current `continueAfterPlanReview`
  shape (`src/core/transition.ts` lines 241–370). The while-loop owns cycle
  counting, `runProducerRound`, and `correction_dispatched`; the extracted
  function owns everything from the post-producer review input through the
  verdict mapping that today follows `runReview` (dispatch, the paired
  `implementation_review_dispatched` / `implementation_review_result` emits,
  `writeTerminalCloseOut` on pass, and `terminal_stop`).   `continueAfterPlanReview`
  calls it when `runProducerRound` returns `null`. `resumeInterrupted` calls it
  for resumable checkpoints after lock re-acquire with `finaliseOnly: true`
  (D4). Neither caller duplicates
  that block.
- **D2 (locked) — the checkpoint key is the last `TransitionEventType` in
  `events.jsonl`, not the transition `state`.** Confirmed. The closed event
  vocabulary is `authorization`, `lock_acquired`, `producer_started`,
  `path_validated`, `producer_finished`, `implementation_review_dispatched`,
  `implementation_review_result`, `correction_dispatched`, `terminal_stop`
  (`src/core/contracts.ts`). **Finalise-vs-dispatch at each checkpoint** (read
  the linked run by `review_run_id` on the last event, or by
  `current_review_run_id` / `linked_review_run_ids` when the last event names
  no run):

  | Last event | Action |
  | --- | --- |
  | `path_validated` or `producer_finished` | If a linked implementation-review run is **terminal** → **finalise** from its status (emit any missing `implementation_review_dispatched` / `implementation_review_result`, then the existing verdict mapping); **do not** `runReview`. If a linked run is **non-terminal** (`requested`, `policy_resolved`, `reviewing`) → **refuse** with no transition mutation (`linkedReviewRunStillLive` in `src/cli/detach.ts`). Otherwise → **dispatch** `runReview` once, emit both review events, verdict mapping. |
  | `implementation_review_dispatched` with no later `implementation_review_result` | **Finalise only:** `runReview` already returned; load the run from the event's `review_run_id`; if terminal, emit the missing `implementation_review_result`, then verdict mapping; **do not** re-dispatch. |
  | `implementation_review_result` | **Finalise only:** load the run from the event's `review_run_id`; pass → `terminal_stop` / `completed` (+ close-out when `task_hash_after_write` is set); `changes_requested` → `terminal_stop` / `stopped` with `cycle_limit_reached` or the review's `reason_code`; other verdicts → `terminal_stop` / `stopped` with the review reason. **No** `correction_dispatched`, **no** producer. |
  | `producer_started` | **Stop** `interrupted` (unchanged `0055`; state was `producer_running`). |
  | `correction_dispatched` | **Stop** `interrupted` (unchanged `0055`; correction producer must not respawn from `resume`). |
  | `authorization`, `lock_acquired` | **Stop** `interrupted` (producer never started). |
  | `terminal_stop` | Skip (transition already terminal). |

- **D3 (locked) — `resume` re-acquires the writer lock as its own process
  before any finalise; refuses without mutating the transition when the chain is
  still live.** Confirmed and narrowed. Per invocation: skip when
  `pidAlive(invocation.pid)`; skip when the successor transition is already
  terminal. After releasing a stale dead-pid `writer.lock` (today's behaviour),
  call `acquireWriterLock(repoRoot, transition.transition_id, …)` so the lock
  record carries the resume process `pid`. **Refuse with no transition mutation**
  when the invocation pid is alive or `linkedReviewRunStillLive` returns true.
  **Finalise** (not refuse) when a terminal linked review run already exists at a
  resumable checkpoint — D2's finalise arm. Hold the lock through the terminal
  record and release it in a `finally`, matching `continueAfterPlanReview`.
  Named refuse outcomes are operator-facing report lines only; add a
  `ReasonCode` only if a persisted record is required.
- **D4 (locked) — `resume` is finalise-only; it never dispatches
  `runReview`.** `advanceFromCheckpoint` still owns dispatch for
  `continueAfterPlanReview`. `resumeInterrupted` passes `finaliseOnly: true`.
  Checkpoints that can finalise from an existing terminal linked review still
  do; a live linked run is still refused; a checkpoint that would spawn
  `runReview` leaves the transition unchanged and prints
  `run /spbridge on this task to dispatch the implementation review`. Resume
  remains the cheap, un-killable recovery path (0055 / D-054).

## Acceptance Criteria

- [x] (D1) `advanceFromCheckpoint(transition, deps)` exists in
      `src/core/transition.ts`, is called by `continueAfterPlanReview` after
      each successful `runProducerRound`, and by `resumeInterrupted` for
      resumable checkpoints with `finaliseOnly: true`; the post-`runReview`
      verdict block is not duplicated.
- [x] (D2) `advanceFromCheckpoint` keys on the last `TransitionEventType` and
      follows the checkpoint table in D2: `path_validated` /
      `producer_finished` finalises from a terminal linked run or dispatches
      `runReview` exactly once; `implementation_review_dispatched` and
      `implementation_review_result` finalise only; `producer_started`,
      `correction_dispatched`, `authorization`, and `lock_acquired` do not
      dispatch or respawn a producer.
- [x] (D4) `resume` from a `producer_finished` last event finalises without
      spawn when a terminal linked run exists; when none exists it leaves the
      transition unchanged and prints `run /spbridge on this task to dispatch
      the implementation review`; it never calls `runReview`. From an
      `implementation_review_result` last event it writes the terminal record
      and releases the lock with no producer round.
- [x] (D3) `resume` prints a named refuse outcome and leaves the transition
      unchanged when the invocation pid is alive or a linked review run is still
      non-terminal; when it advances, the writer lock is held by the resume
      process for the duration and released on the terminal record.
- [x] Tests in `tests/transition.test.ts` and `tests/detach.test.ts` cover
      every D2 checkpoint branch including the double-dispatch window.
- [x] `docs/DECISIONS.md` and `docs/ROUTING-AND-WORKFLOWS.md` record the
      checkpoint auto-advance behaviour.
- [x] `npm run typecheck` / `npm run build` clean; `npm test` adds no new
      failure.

## Work Completed

- 2026-08-31: task created from task `0055`'s narrowed D4 (owner override) and
  the second-opinion design note (extract `advanceFromCheckpoint`, key on the
  last transition event, `resume` re-acquires the lock). No code yet.
- 2026-09-02: planner refined D1–D3 against the current `continueAfterPlanReview`
  successor loop (`src/core/transition.ts` lines 241–370), pinned the closed
  `TransitionEventType` vocabulary and the finalise-vs-dispatch table, corrected
  D3 so a terminal linked review run triggers finalise rather than refuse,
  verified every scoped path exists in the checkout, and ran repository checks.
- 2026-09-02: implementer extracted `advanceFromCheckpoint` and shared verdict
  helpers in `src/core/transition.ts`; wired `continueAfterPlanReview` and
  `resumeInterrupted` (with lock re-acquire and refuse gates); narrowed
  `producer_finished` finalise to the crash-recovery window so correction cycles
  dispatch a fresh review; updated D-054 docs and added checkpoint tests.
- 2026-09-02: implementer fixed four correction/resume defects: checkpoint-scoped
  finalise after `correction_dispatched`, `resolveAdvanceChainFromEvents` for
  chained `after_run` on resume, unlinked `transition_id` run recovery before
  dispatch, and replay-safe terminal close-out via `isTerminalCloseOutApplied`;
  added regression tests and a fully fenced implementation-review handoff.
- 2026-09-02: implementer replaced the `correction_dispatched`-prefix proxy in
  `mayFinaliseTerminalLinkedRunAtProducerCheckpoint` with per-run review-event
  discrimination before the producer checkpoint index, fixing double-dispatch
  when status linked a terminal review run before `implementation_review_dispatched`
  was appended; added unlinked-non-terminal refuse, linked-terminal resume-window,
  and `resolveAdvanceChainFromEvents` unit tests.
- 2026-09-02: implementer (pasted prompt carried no identifier; proceeded under
  the artifact envelope) fixed four implementation-review findings:
  `exitCodeForReason` restores the `review_*` exit-code invariant; D2-row-2
  `implementation_review_dispatched` tests cover refuse / adapter_error /
  emit-missing-result; `resumeInterrupted` passes `finaliseOnly` and never
  spawns `runReview`; unused `loadLastTransitionEvent` and the local
  `RESUMABLE_CHECKPOINTS` duplicate are gone.
- 2026-09-02: human operator (no `/spbridge`) fixed the two round-5
  implementation-review findings: `applyImplementationReviewVerdict` wraps the
  close-out `fs.readFile` in try/catch → `stopTransition(task_unreadable)` so a
  deleted / mode-000 artifact terminates the transition instead of a throw
  escaping `continueAfterPlanReview` / `resumeInterrupted`
  (`CLOSEOUT_TASK_READ_UNGUARDED`); added `tests/detach.test.ts` end-to-end
  coverage for the non-terminal-linked-run pre-lock refuse
  (`D3_RESUME_REFUSE_UNTESTED`). Separately revised `0061` D3: any run of blank
  lines after the `## Next Handoff` closing fence is now tolerated by
  `parseOutstandingHandoffSection` (the section is fully replaced on retract) —
  a recurring producer papercut. `npm run typecheck` / `npm run build` exit 0;
  `npm test` 463 pass, 0 fail.
- 2026-09-02: human operator fixed the round-6 finding `DEAD_KIND_GUARD_IN_TESTS`
  — eight `tests/transition.test.ts` sites guarded terminal-state assertions with
  `!("kind" in outcome)`, which is never true (every `SuccessorOutcome` and
  `AdvanceFromCheckpointResult` member carries `kind`), so the assertions were
  dead. Replaced with the positive discriminant
  `outcome.kind === "review" || outcome.kind === "transition"`; all now-live
  assertions hold. `npm test` 463 pass, 0 fail.

## Evidence

- Task `0055` Work Completed (2026-08-31, owner override) and `docs/DECISIONS.md`
  D-054 (resume finalise-only amendment, 2026-09-02).
- `src/core/transition.ts` — `advanceFromCheckpoint`, `producerCheckpointIndex`,
  `resolveAdvanceChainFromEvents`, `findUnlinkedReviewRunByTransitionId`,
  replay-safe `applyImplementationReviewVerdict` close-out arm.
- `src/core/task-write.ts` — `isTerminalCloseOutApplied` (uses
  `parseTaskFrontmatterDocument` for `phase: complete`).
- `src/cli/detach.ts` — `resumeInterrupted` passes `finaliseOnly: true` and
  `resolveAdvanceChainFromEvents` `parentRunId` / `planRunId` / cycle into
  `advanceFromCheckpoint`; imports `RESUMABLE_CHECKPOINTS`; prints
  `run /spbridge on this task to dispatch the implementation review` when a
  checkpoint would require `runReview`.
- `tests/transition.test.ts` — D2-row-2 `implementation_review_dispatched`
  arms (`review_not_terminal`, invalid run id, missing status, emit-missing-result);
  `finaliseOnly` → `needs_dispatch`; `outcome.exitCode === 0` on
  implementation `human_required` / `blocked`.
- `tests/detach.test.ts` — resume from `producer_finished` without a terminal
  linked run instructs `/spbridge` and does not dispatch; linked-terminal and
  `implementation_review_result` finalise paths unchanged.
- `docs/DECISIONS.md` D-054 amendment and `docs/ROUTING-AND-WORKFLOWS.md` —
  resume is finalise-only and never long-running.
- `tests/transition.test.ts` — correction-after-`path_validated` and
  correction-after-`producer_finished` dispatch tests, unlinked-run finalise,
  close-out replay with non-null `task_hash_after_write`.
- `tests/detach.test.ts` — second resume after close-out completes without
  `task_artifact_write_rejected`.
- `src/core/transition.ts` — `mayFinaliseTerminalLinkedRunAtProducerCheckpoint`
  (per-run review events before checkpoint index; replaces
  `correction_dispatched`-prefix proxy).
- `tests/transition.test.ts` — unlinked-non-terminal refuse,
  linked-terminal-after-`correction_dispatched` finalise,
  `resolveAdvanceChainFromEvents` no-correction and post-correction cases.
- `tests/detach.test.ts` — resume finalises linked terminal run in the
  post-`correction_dispatched` status-linked / event-missing window without
  re-dispatch.
- `npm run typecheck` — exit 0.
- `npm run build` — exit 0.
- `npm test` — 460 pass, 0 fail.

## Blockers

None. Independent of `0053` / `0054`. Builds on `0055` (shipped).

## Next Action

None. Implementation review APPROVED with no findings (`run-e229f271`,
claude-opus-5, 2026-09-02) after six review cycles + two Grok second opinions.
`npm run typecheck` / `npm run build` exit 0; `npm test` 463 pass, 0 fail.
Committed and pushed. A `run-1cdbd8d1` / `run-cab2a3d3` reviewer `adapter_error`
along the way was a content-free usage-limit exit, not a finding (see `0064`).

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-ed25ee02-4c3b-4449-bed4-39b2f1cf69df execution_id=exec-4626dcea-a4fc-4164-aad3-aa7e0b3566e4 review_kind=plan verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-sonnet-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:20fcfa7c8df758f5b260cdddb5dfbf86c1d202fcecff22e1ed15e24e6cabf2e0 task_hash=sha256:25b5e4fe7aaf8b6f937e2c5fe0c3f414bd9c98b444f162955fbf85bfabfc8188 agents_hash=sha256:5b0538f788aa238a0f4e3edc1477bc42f67c2e71fee4bf230a3cfe394d51eeff timestamp=2026-09-02T12:23:11.523Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-e229f271-9948-443d-b0ba-177f9bfb2336 execution_id=exec-1d99d574-b73f-493f-ac5b-3c3048b15bf8 review_kind=implementation verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-opus-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:1a2b7e24b78bc51432866607cd179270ba59bd8d0081a685699860fc477ec92e task_hash=sha256:da9996ca6a17ab5d701c8fba83749aa83f7aa1741f636c2bf9b7b0dad6ee561b agents_hash=sha256:8c5ea585bde94cfad8dd44a4887699564541608b157d2046244f834226ece7fa timestamp=2026-09-02T19:28:39.506Z
<!-- spartan-bridge:review:implementation:end -->

## Next Handoff

No outstanding handoff. The proposed review was consumed.
