---
protocol: "1.1.0" # x-release-please-version
id: a-plan-that-edits-agents-md-cannot-auto-chain
created_at: 2026-08-30
status: completed
phase: done
task_type: implementation
risk: material
current_role: human-operator
next_role: none
updated_at: 2026-08-30
handoff_id: HX-001
next_handoff_id: none
---

# A plan whose decisions edit AGENTS.md or config.yaml cannot auto-chain to an implementer

## Objective

When an approved plan's decisions target a path no automatic write scope makes
writable — `AGENTS.md` and `spartan-bridge/config.yaml` always, plus anything a
repository's scope declaration omits — the plan-pass → implementer auto-chain
does not spawn a producer that structurally cannot finish. The operator learns
this before, not after, a wasted implementer round.

## Context

Task `0050` (2026-08-30) locked D1 = "move a bullet in `AGENTS.md`". The
plan review passed. The bridge repo's `spartan-bridge/config.yaml` has
`dispatch: automatic`, so the Bridge auto-chained the mapped Cursor implementer,
which ran ~6.5 minutes and then failed every attempt to write `AGENTS.md`
(`Operation not permitted` — the producer write-scope guard makes it read-only,
and D-039 / the automation-authority section forbid a `task_artifact_write`
from touching `AGENTS.md`). The implementation review caught it —
`PLAN_TARGET_OUTSIDE_WRITE_SCOPE`, `human_required` — and a human applied the
edit. A 6.5-minute round and an implementation-review cycle were spent
discovering something known the moment D1 was locked.

Board task `0023` has the same shape (its D5 edits `AGENTS.md`) and handled it
correctly: its D7 declares a **human-started implementer**, not the auto-chain.
The difference was that `0023`'s planner reasoned it out and `0050`'s did not,
and nothing in the runtime or the authoring rules made the distinction
mandatory.

`AGENTS.md` `## Artifact authoring` already carries repo-agnostic planning
discipline (task `0050` added the path-verification rule there). It has no rule
about which producer a plan's own edit targets imply.

`src/core/transition.ts` `continueAfterPlanReview` already gates the auto-chain
on several conditions (config opt-in, `AGENTS.md` grant, approved-plan hash,
writer lock) before it spawns the implementer. It does not inspect what the
approved plan proposes to change.

## Scope

- `AGENTS.md` `## Artifact authoring`: one `AGENTS.md`-only rule (D1) — a plan
  whose decisions or scope edit `AGENTS.md` or `spartan-bridge/config.yaml`
  declares a human implementer (frontmatter `next_role: human-operator` on the
  plan-review pass, not the auto-chain), because those paths are outside every
  automatic write scope. Threaded through the `tests/agents.test.ts` contract
  the same way task `0050` threaded its rule (count bump, new constant,
  `AGENTS.md`-only assertions). Task `0022` untouched.
- Optionally (D2) a runtime signal in `src/core/transition.ts`
  `continueAfterPlanReview`: before spawning the implementer, scan the approved
  task artifact's `## Scope` and `## Decisions` sections for backticked repo
  paths; if any resolves outside the automatic write scope, stop the transition
  with a named reason (`plan_targets_unwritable_path`, or reuse
  `automatic_implementation_not_authorized`) and a transition record, instead of
  spawning. D2 decides whether this is in scope now or a follow-up — the prose
  scan is a bounded backtick-token extraction, not general parsing, but it is
  still new runtime behaviour on a security-adjacent path.
- `docs/DECISIONS.md`: one dated entry.
- Tests: `tests/agents.test.ts` for the rule; if D2 lands,
  `tests/transition.test.ts` for the pre-spawn stop.

## Out of Scope

- Changing the producer write-scope guard or the `AGENTS.md` /
  `config.yaml` write prohibition — both are correct and stay.
- Making `AGENTS.md` writable by any automatic round.
- Task `0050` (closed) and task `0023` (its D7 already handles this).
- Retroactively re-running any task.

## Constraints

- English artifact.
- The `AGENTS.md`-only rule stays out of `README.md`, the skill, and
  `docs/ROUTING-AND-WORKFLOWS.md`, and out of task `0022`'s copy — same
  contract as the existing `AGENTS.md`-only rules.
- If D2 lands: the scan is read-only, bounded to two named sections, and a
  false negative (missing a path) is no worse than today; a false positive
  stops a chain the operator can restart as a human implementer round.

## Acceptance Criteria

- [ ] (D1) `AGENTS.md` `## Artifact authoring` carries the human-implementer
      rule as an `AGENTS.md`-only bullet; `tests/agents.test.ts` is updated
      (bullet count, new constant, present-once / absent-elsewhere assertions)
      and passes; task `0022` is byte-unchanged; `npm test` stays 384-equivalent
      / 0 fail.
- [ ] (D2) Either: `continueAfterPlanReview` stops before spawning when the
      approved plan targets an unwritable path, with a named reason and a
      transition record, covered by a `tests/transition.test.ts` case — or D2
      is explicitly deferred to a follow-up task with a one-line rationale.
- [ ] `docs/DECISIONS.md` carries one dated entry.
- [ ] `npm run typecheck` / `npm run build` clean.

## Decisions

- **D1 (pending planner) — the authoring rule.** Lean: adopt it. It is the
  cheap, host-neutral half and it is where `0023`'s D7 reasoning should have
  been mandatory.
- **D2 (pending planner) — the runtime pre-spawn stop.** Lean: **defer to a
  follow-up** unless the reviewer wants it now. The rule (D1) removes the
  recurrence for anyone following `AGENTS.md`; the runtime guard is defence in
  depth against a planner who ignores the rule, and it adds prose-scanning to
  `transition.ts`, which the Bridge has so far avoided. Worth its own task with
  its own review.

## Work Completed

- 2026-08-30: task `0050`'s auto-chain spent a ~6.5-minute Cursor implementer
  round and an implementation-review cycle (`run-871b9a98`,
  `PLAN_TARGET_OUTSIDE_WRITE_SCOPE`) on a D1 that targets `AGENTS.md`, a path no
  automatic write scope admits. Human applied the edit and closed `0050`.

## Evidence

- `spartan/tasks/0050-*.md` Work Completed / Review — the `human_required`
  implementation review and the human close.
- `src/adapters/producer-write-scope.ts` — `AGENTS.md` forced read-only in the
  producer sandbox.
- `AGENTS.md` automation-authority section — `task_artifact_write` "may not
  modify ... this `AGENTS.md`".
- `src/core/transition.ts` `continueAfterPlanReview` — the existing pre-spawn
  gates; no plan-content inspection.
- `spartan/tasks/0023-*.md` D7 (board repo) — the correct pattern: a plan that
  edits `AGENTS.md` declares a human implementer.

## Review

Verdict: PENDING

Findings:

- None recorded.

## Work Completed

- 2026-08-30 (implementer + human-operator, Claude Code / claude-sonnet-5; owner
  asked for implement-then-diff-review). **D1 done** — this task itself edits
  `AGENTS.md`, so per its own rule it is a human edit, not the auto-chain.
  Appended a ninth `AGENTS.md`-only bullet to `## Artifact authoring`: a plan
  whose decisions or scope edit `AGENTS.md` or `spartan-bridge/config.yaml`
  declares `next_role: human-operator` on the plan-review pass. Threaded through
  `tests/agents.test.ts` (`ARTIFACT_AUTHORING_SEVEN` -> nine bullets, new
  `ARTIFACT_AUTHORING_AGENTS_TARGET_RULE` constant, present-once /
  absent-elsewhere assertions, `D6_RULE_PHRASES` loop). Task `0022` byte-unchanged.
  **D2 deferred** to a follow-up (a `continueAfterPlanReview` pre-spawn scan) —
  the lean stood; recorded in D-053.
  - `docs/DECISIONS.md`: **D-053**.
  - Checks: `npm run typecheck` clean; `npm run build` clean; `npm test`
    **388 pass / 0 fail**.

## Blockers

None.

## Next Action

None. Task completed 2026-08-30. The `0050` plan defect — a plan editing
`AGENTS.md` running through the auto-chain — is now an `AGENTS.md` authoring
rule enforced by `tests/agents.test.ts`. The optional runtime guard (D2) is a
future follow-up.

## Next Handoff

No outstanding handoff. The task is complete.
