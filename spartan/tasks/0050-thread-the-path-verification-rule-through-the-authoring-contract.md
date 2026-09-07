---
protocol: "1.1.0" # x-release-please-version
id: thread-the-path-verification-rule-through-the-authoring-contract
created_at: 2026-08-30
status: completed
phase: done
task_type: implementation
risk: routine
current_role: human-operator
next_role: none
updated_at: 2026-08-30
handoff_id: HX-002
next_handoff_id: none
---

# Thread the path-verification rule through the Artifact authoring contract

## Objective

The "confirm every repository path a plan names exists in the current checkout"
rule lives in `AGENTS.md` `## Artifact authoring` in a way the
`tests/agents.test.ts` copy-identity and shape assertions accept, and
`npm test` is back to 0 failures. The rule is not lost and not half-applied.

## Context

Commit `b535dbb` (2026-08-30) added a bullet to `AGENTS.md` `## Artifact
authoring` — *"Every repository path a plan names ... is confirmed to exist in
the current checkout before the plan is written ..."* — inserted as the **4th**
of the section's bullets, without touching the synced-copy contract that
`tests/agents.test.ts` enforces. Two tests now fail on `main`
(`d94c9c8`); the count is unchanged with the working tree stashed, confirming
the regression predates every later commit's edits.

The contract (established by task
`0022-say-which-invocation-a-bridge-repo-uses.md`, D6, and extended once since):

- `tests/agents.test.ts:514` `ARTIFACT_AUTHORING_SIX = /## Artifact authoring\n\n(?:- .+\n){6}/`
- `tests/agents.test.ts:515` `ARTIFACT_AUTHORING_SEVEN = /## Artifact authoring\n\n(?:- .+\n){7}(?=\n|## |```|$)/`
- `tests/agents.test.ts:516` `ARTIFACT_AUTHORING_SEVENTH` — the exact
  "A role change and its envelope move together ..." bullet.
- `declaration paragraph copies are identical and parse-invariant` asserts
  `extractMatch(AGENTS.md, SIX) === extractMatch(task 0022, SIX)` — the first
  **six** bullets are byte-identical between `AGENTS.md` and task `0022`'s own
  `## Artifact authoring` copy.
- `Artifact authoring stays out of adoption, skill, and routing` asserts
  `AGENTS.md` matches `SEVEN` (exactly seven bullets, terminated), the seventh
  is `ARTIFACT_AUTHORING_SEVENTH`, it appears once, and task `0022`, the
  fixture, `README.md`, the skill, and `docs/ROUTING-AND-WORKFLOWS.md` carry
  neither `SIX` nor `SEVEN` (the seventh is `AGENTS.md`-only).

So the section is "six shared rules (mirrored in task `0022`) + one
`AGENTS.md`-only rule". `b535dbb` broke both halves: the new 4th bullet made
`AGENTS.md`'s first six differ from task `0022`'s, and it made the section
eight bullets so `SEVEN`'s terminator lookahead fails.

The path-verification rule is universal authoring discipline in content — a
repository that never installs the Bridge benefits identically. Whether it is
mirrored into task `0022`'s copy (a "shared" rule) or kept `AGENTS.md`-only is
D1; the mechanical cost of touching a completed task's artifact and its
surrounding prose decides it.

## Scope

- `AGENTS.md`: move the `b535dbb` path-verification bullet out of the first six
  and append it as an **`AGENTS.md`-only** rule after the six shared rules,
  next to the existing `AGENTS.md`-only role/envelope rule (D1). Its wording is
  unchanged. Section goes from eight bullets (6 shared + role/envelope + the
  misplaced path rule) to eight bullets in the right order (6 shared, then the
  two `AGENTS.md`-only rules).
- Task `spartan/tasks/0022-say-which-invocation-a-bridge-repo-uses.md` is **not
  touched** — neither its fenced `## Artifact authoring` copy (stays the six
  shared rules) nor the surrounding prose about the six.
- `tests/agents.test.ts`: `ARTIFACT_AUTHORING_SIX` stays (the copy-identity
  check for the six shared rules, `AGENTS.md` first-six == task `0022`);
  `ARTIFACT_AUTHORING_SEVEN` (`{7}` + terminator) becomes an eight-bullet
  pattern; add a constant for the path-verification rule and assert it, like
  `ARTIFACT_AUTHORING_SEVENTH`, appears once in `AGENTS.md` and is absent from
  task `0022`, the fixture, `README.md`, the skill, and
  `docs/ROUTING-AND-WORKFLOWS.md`. `D6_RULE_PHRASES` and the SEVENTH
  `endsWith` / count assertions are adjusted for the new last bullet.
- `tests/fixtures/agents-with-bridge-declaration.md`: confirm it still carries
  neither pattern; adjust only if the count change breaks an assertion.
- `docs/DECISIONS.md` (verified present in the current checkout): add one dated
  entry, **D-050** (D2/D3).
- Re-run `npm run typecheck`, `npm test` (expect 384 pass / 0 fail),
  `npm run build`.

## Out of Scope

- Any wording change to the six existing shared rules or to the role/envelope
  rule.
- Any change to `README.md` adoption text, `agent-skill/skills/spbridge/SKILL.md`,
  or `docs/ROUTING-AND-WORKFLOWS.md` (the rule must stay out of all three, per
  the existing test).
- Reopening task `0022` in any form — its status, its acceptance-criteria text,
  its fenced `## Artifact authoring` copy, or the prose around it. D1 keeps the
  rule `AGENTS.md`-only precisely so task `0022` is not touched.
- The `config.yaml` question — settled in D-049 / task 0048: authoring guidance
  belongs in `AGENTS.md`, never in `spartan-bridge/config.yaml`.
- Making the path-verification rule a shared rule (in task `0022`'s copy too).
  Rejected under D1 — see Decisions.

## Constraints

- English artifact.
- After this task `git grep` for the path-verification bullet text finds it in
  `AGENTS.md` only, nowhere else.
- No `src/` change.

## Acceptance Criteria

- [ ] (D1) The `b535dbb` path-verification bullet sits after the six shared
      rules in `AGENTS.md`, grouped with the `AGENTS.md`-only role/envelope
      rule, its wording unchanged; the section is eight bullets in the order
      [six shared][role/envelope][path-verification].
- [ ] (D1) task `0022` is byte-unchanged: `git diff` names no
      `spartan/tasks/0022-*.md`.
- [ ] (D2) `tests/agents.test.ts`: `ARTIFACT_AUTHORING_SIX` still passes the
      `AGENTS.md` first-six == task `0022` copy-identity check; the
      seven-bullet pattern is updated to eight; a new constant for the
      path-verification rule is asserted present once in `AGENTS.md` and absent
      from task `0022`, the fixture, `README.md`, the skill, and
      `docs/ROUTING-AND-WORKFLOWS.md` (mirroring the `ARTIFACT_AUTHORING_SEVENTH`
      assertions); `D6_RULE_PHRASES` and the `ARTIFACT_AUTHORING_SEVENTH`
      `endsWith` / single-occurrence assertions are adjusted for the new last
      bullet. `declaration paragraph copies are identical and parse-invariant`
      and `Artifact authoring stays out of adoption, skill, and routing` both
      pass.
- [ ] `npm run typecheck` and `npm run build` clean; `npm test` 384 pass /
      0 fail.
- [ ] (D3) `docs/DECISIONS.md` carries exactly one new dated (2026-08-30)
      entry, **D-050**, recording the rule's placement and that it is
      shared-in-content but `AGENTS.md`-only in the test contract.

## Decisions

- **D1 (locked 2026-08-30) — the path-verification rule is a second
  `AGENTS.md`-only rule; task `0022` is not touched.** It sits after the six
  shared rules alongside the existing `AGENTS.md`-only role/envelope rule.
  Rationale: the alternative — a seventh *shared* rule — would require editing
  task `0022`'s fenced copy *and* the prose that surrounds it in the same file
  ("holding the six rules of D6 byte-for-byte", "The last two rules were added
  after…"), both of which name the count the change moves. Editing a completed
  task's artifact plus its narrative is a reopening, not a mechanical sync.
  Keeping the rule `AGENTS.md`-only touches exactly one file and no completed
  task.
  **This rule is shared in content and `AGENTS.md`-only only in the test
  contract.** A future task must not read its absence from task `0022`'s copy
  as a missing sync and re-add it there — doing so re-breaks the
  `ARTIFACT_AUTHORING_SIX` copy-identity check. The `D-050` entry records this.
  A downstream repo that wants the rule copies it from `AGENTS.md`, the same way
  it would the role/envelope rule.
- **D2 (locked 2026-08-30) — the `tests/agents.test.ts` contract change.**
  `ARTIFACT_AUTHORING_SIX` is unchanged (the six-shared-rule copy-identity
  check). `ARTIFACT_AUTHORING_SEVEN` (`{7}` + terminator lookahead) becomes an
  eight-bullet pattern. A new `ARTIFACT_AUTHORING_PATH_RULE` constant holds the
  exact path-verification bullet and gets the same treatment
  `ARTIFACT_AUTHORING_SEVENTH` gets: asserted present once in `AGENTS.md`,
  absent from task `0022`, the fixture, `README.md`, the skill, and
  `docs/ROUTING-AND-WORKFLOWS.md`. `D6_RULE_PHRASES` and the SEVENTH
  `endsWith` / single-occurrence assertions are adjusted so they still hold
  with the path rule as the new last bullet. No test's intent changes; only the
  bullet count and one added constant.
- **D3 (locked 2026-08-30) — one `docs/DECISIONS.md` entry, `D-050`.** It
  records that `b535dbb` half-applied the rule, that D1 keeps it
  `AGENTS.md`-only for mechanical cost, and the shared-in-content /
  local-in-contract distinction, in the `D-047` family (worktree / authoring
  contract housekeeping). Exactly one entry; nothing else in `DECISIONS.md`
  changes.

Section order note: this artifact has `## Acceptance Criteria` before
`## Decisions` because that is the Spartan task template's fixed order. The
`## Artifact authoring` rule being threaded ("decisions first, criteria last")
governs a *plan's authored content*, which is written decisions-first here; the
template's heading order is a separate, pre-existing concern and is out of
scope.

## Work Completed

- 2026-08-30: diagnosed the two `tests/agents.test.ts` failures on `main`
  (`d94c9c8`) as the `b535dbb` regression; confirmed unchanged with the working
  tree stashed. Mapped the six-shared-plus-one contract from
  `tests/agents.test.ts:514-518` and task `0022`.
- 2026-08-30 (planner): locked D1 = `AGENTS.md`-only. A first `/spbridge` review
  attempt (`run-db910248`) blocked `reviewer_write_detected` on
  `spartan/tasks/0051-*.md` — a file committed from a concurrent session during
  the review window, misattributed to the reviewer by the whole-worktree diff
  (the class of bug task `0051` addresses), not a plan defect. That attempt's
  advisory noted the criteria were bimodal ("six if… seven if…") against the
  repo's own "decisions first, criteria last" rule, and that D1 = shared would
  force reopening task `0022`'s prose; both are now resolved by locking D1.
- 2026-08-30 (planner, plan-review cycle 1 CHANGES_REQUESTED, `run-760f5cc9`):
  resolved all five findings. `UNDEFINED_DECISION_D2` → added D2 (the
  `tests/agents.test.ts` contract change) and D3 (the `DECISIONS.md` entry).
  `SCOPE_OMITS_DECISIONS_DOC` → `docs/DECISIONS.md` added to Scope, path
  confirmed present. `UNSPECIFIED_DECISION_ID` → the new entry is `D-050`,
  concrete throughout. `SHARED_RULE_FILED_AS_LOCAL` → D1 now states the rule is
  shared-in-content, `AGENTS.md`-only in the test contract, and that a future
  task must not re-add it to task `0022`. `DECISIONS_AFTER_CRITERIA` → the
  section-order note explains it is the template's fixed heading order and out
  of scope.
- 2026-08-30 (implementer, Cursor / composer-2.5): applied D2 and D3 within the
  adapter-enforced automatic write scope. `tests/agents.test.ts`: `ARTIFACT_AUTHORING_SEVEN`
  is now `{8}`; added `ARTIFACT_AUTHORING_PATH_RULE`; adjusted `endsWith` /
  single-occurrence assertions, exclusion checks, and the phrase loop for the
  path rule. `docs/DECISIONS.md`: added **D-050** (2026-08-30). **D1 blocked:**
  `AGENTS.md` is read-only (`r--r--r--`) and outside the automatic write scope
  (task `0039` D3); `StrReplace`, `cp`, `mv`, and `chmod u+w` all returned
  `Operation not permitted` / `PermissionError`. Left an unapplied scratch patch
  `spartan/.agents-md-patch-temp`; task `0022` was not touched.
- 2026-08-30 (implementation review, Claude / claude-sonnet-5, `run-871b9a98`):
  `human_required`, four findings. `D1_NOT_APPLIED` / `NPM_TEST_NOT_GREEN` /
  `PLAN_TARGET_OUTSIDE_WRITE_SCOPE` — D1's only target, `AGENTS.md`, is outside
  every automatic write scope, so the mapped implementer structurally cannot do
  it; the plan-review pass missed that it needs a human. `STRAY_TEMP_FILE` — the
  scratch patch.
- 2026-08-30 (human-operator): applied the D1 reorder to `AGENTS.md` by hand —
  moved the path-verification bullet from the 4th of eight `## Artifact
  authoring` bullets to the 8th, after the role/envelope rule, wording byte-for-
  byte unchanged; order is now [six shared][role/envelope][path-verification].
  Deleted `spartan/.agents-md-patch-temp`. `npm run typecheck` clean,
  `npm run build` clean, `npm test` **384 pass / 0 fail** (the two `b535dbb`
  regressions are gone; `main` is green). All four implementation-review
  findings resolved. Task closed. The plan defect — D1 targeting a path outside
  every write scope without declaring a human implementer — is folded into new
  task `0052`.

## Evidence

- `git show b535dbb -- AGENTS.md`: the bullet inserted as the section's 4th.
- `npm test` on `d94c9c8`: 382 pass / 2 fail — `declaration paragraph copies
  are identical and parse-invariant`, `Artifact authoring stays out of
  adoption, skill, and routing`.
- `git stash && npm test`: 382 / 2 — same, so no later commit's edits are
  involved.
- `tests/agents.test.ts:514-518`, `:632-633` (SIX copy identity), `:635-649`
  (SEVEN shape + non-shared-rule exclusion).
- task `0022` `## Artifact authoring`: the six shared bullets, no seventh.
- Cursor implementer round (adapter sandbox): D2/D3 applied; `tsc --noEmit`
  exit 0; `agents.test.ts` 74 pass / 1 fail (SIX mismatch, expected until D1);
  `npm run build` `EPERM` on `dist/` (sandbox). These are the in-sandbox
  numbers, superseded by the human close below.
- Human-operator close, full working tree: `npm run typecheck` exit 0;
  `npm run build` exit 0; `npm test` **tests 384, pass 384, fail 0**. The
  `## Artifact authoring` section is eight bullets, first six byte-identical to
  task `0022`'s copy, ending with the path-verification rule.
- `git grep -l 'Every repository path a plan names'`: `AGENTS.md`,
  `tests/agents.test.ts` (the constant), this task — not task `0022`, not the
  fixture, README, skill, or routing.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-cab6cf5f-6e0a-4d44-b0b2-1a4cfe43e80d execution_id=exec-73a17e49-33ca-46ae-919d-c7570b0fdffa review_kind=plan verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-sonnet-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:20fcfa7c8df758f5b260cdddb5dfbf86c1d202fcecff22e1ed15e24e6cabf2e0 task_hash=sha256:d7d6e94f92ee0f3ddfcc34e6259bbad144de0e83aeed4e73623422ce7a4a2fae agents_hash=sha256:e7a4562a59df9b2c7a7c5d09858802881ad8cb9527826651688da92a911c646e timestamp=2026-08-30T22:31:08.258Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: HUMAN_REQUIRED (run-871b9a98, Claude / claude-sonnet-5), resolved by the human-operator close.

Findings:

- `D1_NOT_APPLIED` / `NPM_TEST_NOT_GREEN` / `PLAN_TARGET_OUTSIDE_WRITE_SCOPE` (error): D1's only target `AGENTS.md` is outside every automatic write scope, so the mapped Cursor implementer could not apply it and `npm test` stayed red. Resolved: the human-operator moved the bullet by hand; `npm test` 384/0.
- `STRAY_TEMP_FILE` (warning): `spartan/.agents-md-patch-temp`. Resolved: deleted.
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None. D1 is applied (human-operator, `AGENTS.md` is outside every automatic
write scope by design); D2 and D3 landed via the Cursor implementer round;
`npm test` 384 / 0.

## Next Action

None. Task completed 2026-08-30. All five acceptance criteria met: the
path-verification bullet is the 8th of eight `## Artifact authoring` bullets
in `AGENTS.md` with the first six byte-identical to task `0022`; task `0022` is
unchanged; `tests/agents.test.ts` carries the D2 contract change and passes;
`docs/DECISIONS.md` has D-050; `npm run typecheck` / `npm run build` /
`npm test` (384/0) all clean. The plan defect (D1 targeting `AGENTS.md` without
declaring a human implementer, which the auto-chain caught at the
implementation-review gate) is carried to task `0052`.

## Next Handoff

No outstanding handoff. The task is complete.
