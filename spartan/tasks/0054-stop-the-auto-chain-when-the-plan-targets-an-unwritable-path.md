---
protocol: "1.1.0" # x-release-please-version
id: stop-the-auto-chain-when-the-plan-targets-an-unwritable-path
created_at: 2026-08-31
status: completed
phase: complete
task_type: implementation
risk: material
current_role: human-operator
next_role: none
updated_at: 2026-09-02
handoff_id: HX-002
next_handoff_id: none
---

# Stop the plan-pass auto-chain when the approved plan targets a path outside the write scope

## Objective

`continueAfterPlanReview` does not spawn the mapped implementer when the
approved plan's decisions or scope name a repository path that no automatic
write scope admits — `AGENTS.md`, `spartan-bridge/config.yaml`, or a path a
repository's scope declaration omits. It stops the transition with a named
reason and a transition record instead, so the operator learns this before a
producer round is spent.

## Context

This is the deferred D2 of task `0052` (D-053). Task `0052` shipped D1 — an
`AGENTS.md` `## Artifact authoring` rule that a plan editing `AGENTS.md` or
`spartan-bridge/config.yaml` declares `next_role: human-operator` — and
deferred the runtime enforcement.

The recurrences the rule alone does not stop:

- A **consumer** repository's `AGENTS.md` carries none of the bridge repo's
  authoring rules. Board task `0023`'s implementation round (it edits the board
  `AGENTS.md` D5 scopes) was performed correctly only because the operator
  followed the plan's D7 by hand; nothing in the runtime would have stopped an
  auto-chain there. Board `AGENTS.md` has `dispatch: automatic`.
- Board task `0050`'s plan review passed with a D1 that only edits `AGENTS.md`;
  the auto-chain spent a ~6.5-minute Cursor implementer round and an
  implementation-review cycle (`run-871b9a98`, `PLAN_TARGET_OUTSIDE_WRITE_SCOPE`)
  discovering the mapped implementer could not do it.

`src/core/transition.ts` `continueAfterPlanReview` already gates on the config
opt-in, the `AGENTS.md` grant, the approved-plan hash, and the writer lock
before spawning. It does not inspect what the approved plan proposes to change.
The producer write-scope guard (`applyProducerWriteScope`) and the Darwin
profile already make `AGENTS.md` and `spartan-bridge/config.yaml` unwritable,
and the repo root `0555` makes a root `git mv` impossible — so the round is
always spent, never productive, for such a plan.

## Scope

- `src/core/transition.ts`: in `continueAfterPlanReview`, before
  `deps.catalog.resolve` / the producer spawn, scan the approved task
  artifact's `## Scope` and `## Decisions` sections for backticked
  repo-relative path tokens; if any resolves outside the automatic
  implementation write scope (`isPathAdmittedByScope` false, or it is
  `AGENTS.md` / `spartan-bridge/config.yaml`), stop the transition with a
  transition record and a reason code. Reuse
  `automatic_implementation_not_authorized`, or add a narrower
  `plan_targets_unwritable_path` (D1 decides).
- The scan is a bounded backtick-token extraction over two named sections, not
  general prose parsing: a token matching `` `<path>` `` where `<path>` looks
  like a repo path (contains `/` or ends `.md`/`.py`/`.ts`/`.yaml`/... or is a
  known top-level name). A false negative is no worse than today; a false
  positive stops a chain the operator restarts as a human implementer round.
- `docs/DECISIONS.md`: one dated entry, amending D-053.
- `docs/ROUTING-AND-WORKFLOWS.md`: note the pre-spawn stop in the
  "Foreground automatic implementation transition" section.
- Tests: `tests/transition.test.ts` — an approved plan whose `## Decisions`
  names `` `AGENTS.md` `` stops before spawn with the reason and a transition
  record; a plan naming only in-scope paths still spawns; the scan does not
  trip on a path inside a fenced code block that is illustrative, or does
  (D1 decides the fenced-block policy).

## Out of Scope

- The producer write-scope guard, the Darwin profile, and the `AGENTS.md` /
  `config.yaml` write prohibition — all correct, unchanged.
- Task `0052`'s D1 authoring rule — shipped, unchanged.
- Making `AGENTS.md` writable by any automatic round.
- A general plan-content linter; this scan is scoped to the auto-chain
  pre-spawn decision only.
- The board repo (it only consumes the runtime).

## Constraints

- English artifact.
- The scan is read-only, bounded to two named sections of one artifact, and
  never blocks a human-started `/spbridge` or `/spartan` round — only the
  automatic mapped-implementer spawn.
- No change to `max_*_review_cycles`, the writer lock, the approved-plan hash
  gate, or the config opt-in.

## Acceptance Criteria

- [x] (D1) `continueAfterPlanReview` stops before the producer spawn when the
      approved artifact's `## Scope` or `## Decisions` names a backticked path
      outside the automatic write scope (incl. `AGENTS.md` /
      `spartan-bridge/config.yaml`), with a transition record and a named
      reason.
- [x] (D1) A plan naming only in-scope paths is unaffected; a human-started
      producer round is unaffected.
- [x] `docs/DECISIONS.md` amends D-053; `docs/ROUTING-AND-WORKFLOWS.md` notes it.
- [x] `tests/transition.test.ts` covers the stop, the pass-through, and the
      fenced-block policy D1 sets.
- [x] `npm run typecheck` / `npm run build` clean; `npm test` no new failure.

## Decisions

- **D1 — reason code and fenced-block policy.** Add `plan_targets_unwritable_path`
  to `ReasonCode` (clearer diagnostic than reusing
  `automatic_implementation_not_authorized`). Scan prose-level backtick tokens
  in `## Scope` and `## Decisions` only; skip tokens inside fenced code blocks
  (examples are not targets).

## Work Completed

- 2026-08-31: split out from task `0052` (D2 deferred, D-053). Board `0023`
  and `0050` are the two motivating incidents.
- 2026-09-02 (implementer, HX-002): added `src/core/plan-target-scan.ts`
  (`planTargetsUnwritablePath`) and wired it into `continueAfterPlanReview`
  before launcher resolution; new `ReasonCode` `plan_targets_unwritable_path`;
  amended D-053 in `docs/DECISIONS.md`; noted the pre-spawn stop in
  `docs/ROUTING-AND-WORKFLOWS.md`; three regression tests in
  `tests/transition.test.ts`.
- 2026-09-02: first fully successful auto-chain in the bridge repo — plan
  review APPROVED (`run-406102bb`), Cursor implementer, implementation review
  APPROVED with no findings (`run-85ba5208`), terminal close-out fired
  (`phase: complete`, completion notice, handoff retracted). The `/spbridge`
  session stopped polling early (~10 min) while the implementer was still
  within its 45-min producer window and misread the `wait`-command stderr
  (`dist/ is older than src/`) as a stall; the chain completed ~2 min later.
  Verified by the human operator: `npm run typecheck` / `npm run build` exit 0;
  `npm test` 437/437. Committed and pushed.

## Evidence

- `docs/DECISIONS.md` D-053 — deferred D2 consequence now shipped (task `0054`).
- `src/core/plan-target-scan.ts` — bounded scan over `## Scope` / `## Decisions`.
- `src/core/transition.ts` `continueAfterPlanReview` — calls
  `planTargetsUnwritablePath` after `assertApprovedBytes`, before
  `resolveLauncherId`.
- `src/core/contracts.ts` — `plan_targets_unwritable_path` on `ReasonCode`.
- Board incident: `.spartan-bridge/runs/run-871b9a98-.../status.json`
  (`PLAN_TARGET_OUTSIDE_WRITE_SCOPE`, `human_required`).
- Plan review: `run-406102bb-28c4-4015-8b9e-8095c3d6f880` (pass).
- `node node_modules/typescript/bin/tsc --noEmit` — exit 0 (2026-09-02).
- `node --import tsx --test tests/transition.test.ts` — 28 pass, 2 fail
  (pre-existing real-Cursor POSIX guard cases in this environment); three new
  plan-target tests pass.
- `node --import tsx --test tests/*.test.ts` — 427 pass, 10 fail (same
  pre-existing cursor-sandbox and installer cases; no new failure from this
  task).
- `npm run build` — not run: `dist/` is read-only in this checkout (EPERM).

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-406102bb-28c4-4015-8b9e-8095c3d6f880 execution_id=exec-2f201a13-b3c9-44d6-bf82-2229122988c0 review_kind=plan verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-sonnet-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:20fcfa7c8df758f5b260cdddb5dfbf86c1d202fcecff22e1ed15e24e6cabf2e0 task_hash=sha256:ee35e577860ee2208e60ab00e6545139371ccca6166a6b430438fce2dfc532d6 agents_hash=sha256:5b0538f788aa238a0f4e3edc1477bc42f67c2e71fee4bf230a3cfe394d51eeff timestamp=2026-09-02T11:31:39.681Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-85ba5208-d7b6-4d82-ac60-cc3b5abae770 execution_id=exec-1c4f6194-591a-4f5a-b207-2158fc71fc77 review_kind=implementation verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-sonnet-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:1432cf4ad657ba8b32cb1751f04ef520e7ecebe5fcb14dec11a3dca63243ff05 task_hash=sha256:bf030b555e0db2fa8ebed7001674087c0eb9411928af276c91b5829a8d61436b agents_hash=sha256:5b0538f788aa238a0f4e3edc1477bc42f67c2e71fee4bf230a3cfe394d51eeff timestamp=2026-09-02T11:40:44.408Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None.

## Next Action

Auto-chain complete: implementation review passed (Bridge run run_id=run-85ba5208-d7b6-4d82-ac60-cc3b5abae770).
Review the worktree diff in the authorized implementation write scope, commit
when satisfied, then set this task to status: completed.
## Next Handoff

No outstanding handoff. The proposed review was consumed.
