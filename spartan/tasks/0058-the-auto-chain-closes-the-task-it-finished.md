---
protocol: "1.1.0" # x-release-please-version
id: the-auto-chain-closes-the-task-it-finished
created_at: 2026-09-01
status: completed
phase: complete
task_type: implementation
risk: high-impact
current_role: human-operator
next_role: none
updated_at: 2026-09-02
handoff_id: HX-006
next_handoff_id: none
---

# The auto-chain closes the task it finished

## Objective

When the foreground/detached auto-chain runs an approved plan through the
mapped implementer and a **passing** implementation review, the task artifact
ends in a state that says, unambiguously, "done — commit the diff": `## Next
Action` is a completion notice, not stale re-review prose, and the frontmatter
no longer implies work is pending. The driving `/spbridge` session follows the
transition to its terminal state and reports the final verdict, not the
intermediate `awaiting_implementer`.

## Context

Observed identically on board tasks `0027` (2026-08-31) and `0029`
(2026-09-01), both auto-chained end to end:

- The chain ran fully: plan review pass → Cursor implementer → implementation
  review (with a correction cycle) → `terminal_stop` / `completed`. The Bridge
  wrote both `## Review` regions (`Verdict: APPROVED`) and set
  `next_role: human-operator` (`IMPLEMENTATION_REVIEW_NEXT_ROLE.pass`).
- But `TASK_WRITE_FRONTMATTER_KEYS` is `["next_role", "updated_at",
  "handoff_id", "next_handoff_id"]` only — the write never touches `status`,
  `phase`, or `current_role`, and never touches `## Next Action`. So `0029`
  now reads `status: active` / `phase: reviewing` / `current_role: implementer`
  with `## Next Action` still saying "Re-review the implementation against all
  acceptance criteria…" — the pre-review text from the last producer round.
- The mapped implementer's changes (8 files on `0029`) sit uncommitted in the
  worktree with nothing in the artifact pointing at them.
- The `/spbridge` session that started the chain used `review --detach` +
  `wait`, saw `awaiting_implementer` with a non-null `transition_id` in an
  early `wait` result, and stopped — per SKILL.md step 5/7 (treating a
  non-terminal status with `transition_id` as a stop instead of looping `wait`
  until a terminal document). It never reported that the transition later
  reached `completed` with a passing implementation review. Board `0029` chain:
  `15:03:22` → `15:13:17`; the session had already reported and stopped.

Net: a human has to notice the transition finished, scroll to the
implementation `## Review` region, read the diff, commit it, and hand-edit the
frontmatter to `completed`. Every auto-chained task needs the same manual
close. That is the gap this task removes.

Related but distinct: `0056` recovers an **interrupted** chain from a
checkpoint; this task finalises a **completed** chain that was never closed.

## Scope

- `src/core/transition.ts` / `src/core/task-write.ts`
  - On `terminal_stop` with `state: "completed"` (passing implementation review
    that ends the chain), after the implementation `## Review` region write
    succeeds, one further authorized `task_artifact_write` (same grant) closes
    the artifact:
    - rewrites `## Next Action` to the fixed completion-notice template (names
      the passing implementation-review `run_id`, instructs review + commit +
      mark `status: completed`); retracts `## Next Handoff` to the no-envelope
      state (same deterministic probe treatment as handoff retraction today);
      and sets `phase: complete`, `current_role: human-operator`, and `status:
      active` (D2 — commit remains a required human next action).
  - Add `TERMINAL_CLOSE_FRONTMATTER_KEYS` (`status`, `phase`, `current_role`)
    used **only** by `writeTerminalCloseOut` when `continueAfterPlanReview`
    emits `terminal_stop` / `completed` — do **not** widen
    `TASK_WRITE_FRONTMATTER_KEYS` for ordinary plan- or implementation-review
    writes. Extend `preservedAuthorizedBytes` with a terminal-close branch that
    admits only those three keys plus the completion-notice `## Next Action`
    rewrite and `## Next Handoff` retraction. Add `checkTerminalCloseShape` for
    the `completed` close-out path only (leave `checkArtifactWriteShape` unchanged
    for ordinary review dispatch). New `composition_failed` detail when `## Next
    Action` is not replaceable. `tests/task-write.test.ts` asserts a normal review
    write still cannot touch `status` / `phase` / `current_role`.
- `src/cli/detach.ts` (`waitForRun`) + `agent-skill/skills/spbridge/SKILL.md`
  - **In this slice (D3):** align SKILL.md step 5/6/7 with step 4 — loop
    `wait` until the document is terminal (`state: "running"` is the only
    mid-chain outcome); do not stop on a non-null `transition_id` alone.
    **Require** `waitForRun` hardening: when a successor transition is
    non-terminal, return `done: false` while either the invocation pid is alive
    **or** the linked implementation-review run (from
    `current_review_run_id` / `linked_review_run_ids`) is still non-terminal —
    covering the board `0029` case where the detached pid exits before the
    linked review finishes.
  - Add `tests/detach.test.ts` coverage for the live-transition branch (plan
    run at `awaiting_implementer`, successor transition not terminal, invocation
    pid alive → `done: false`).
- `src/cli/main.ts` / `src/cli/parse.ts` — read-only
    `spartan-bridge status --repo <r> --task <path>` (D4): after the fact,
    print the chain's terminal state, the implementation-review verdict, and
    `git diff --stat` over the automatic-implementation write scope.
- `docs/ROUTING-AND-WORKFLOWS.md` / `docs/DECISIONS.md` — the close-out step
  and what the Bridge does vs. what stays the human's (the commit).
- Tests: `tests/transition.test.ts` (completion-notice `## Next Action` +
  `## Next Handoff` retraction + frontmatter advance on a passing impl-review
  terminal), `tests/detach.test.ts` (`waitForRun` live-transition branch —
  pid-alive and linked-run), `tests/task-write.test.ts` (`checkTerminalCloseShape`
  admits the completion-notice + retraction probe; `checkArtifactWriteShape` for
  ordinary review dispatch is unchanged and a normal review write still cannot
  touch `status` / `phase` / `current_role`), a `review --detach` end-to-end
  that reaches `completed` and asserts the artifact close-out.

## Out of Scope

- The Bridge committing, pushing, tagging, or merging. The commit stays the
  human's (D-006 / every consumer `AGENTS.md`).
- Auto-advancing an **interrupted** chain (`0056`).
- Changing the implementation-review cycle ceiling, the **file-path** automatic
  implementation write scope (`AGENTS.md` paths), the approved-plan hash gate,
  or the two-key auto-chain opt-in. Terminal close adds a separate frontmatter-key
  allowlist gated on `terminal_stop` / `completed` only; it does not admit new
  product paths.
- Retroactively closing `0027` / `0029` (done by hand; this task prevents the
  next one).
- The `claude-plan-reviewer-v1` reliability work (`0057` and its siblings).
- Stale-`dist` hang recovery (`0060`) — orthogonal; build before review remains
  operator responsibility.

## Constraints

- English artifact.
- The commit remains a human action; the Bridge only makes the artifact say so.
- The wire `reason_code` enum is unchanged.
- Terminal close-out is authorized `task_artifact_write` transition metadata
  (`AGENTS.md`: validated reviewer findings plus transition metadata): the
  completion-notice `## Next Action` rewrite and the three lifecycle keys are
  deterministic transition metadata; no reviewer free text reaches the
  artifact (`containsForbidden` plus the fixed template).
- `## Next Action` rewrite is one deterministic template, checked the same way
  the `## Review` region and `## Next Handoff` retraction already are — no free
  text from the reviewer reaches it.
- `npm run typecheck` / `npm run build` clean; `npm test` no new failure.

## Decisions

- **D1 (locked) — the passing-impl-review terminal write finalises `## Next
  Action` and retracts `## Next Handoff`.** One fixed completion-notice
  template, composed from the implementation-review `run_id` only:

  ```text
  Auto-chain complete: implementation review passed (Bridge run run_id=<run_id>).
  Review the worktree diff in the authorized implementation write scope, commit
  when satisfied, then set this task to status: completed.
  ```

  No reviewer prose; `containsForbidden` applies. `checkTerminalCloseShape`
  (terminal close-out only — not `checkArtifactWriteShape` on every dispatch)
  probes completion-notice rewrite and handoff retraction using a fixed probe
  `run_id` such as `run-00000000-0000-4000-8000-000000000000`.
- **D2 (locked) — frontmatter on that terminal stays `status: active`.**
  Spartan portable protocol (installed Spartan skill
  `references/protocol.md`, Review and completion): a task MAY become
  `completed` only when there is **no required next action** (criteria
  satisfied, checks recorded, required review approved, no blocker, **no
  required next action**). The commit is still required (D-006 / every consumer
  `AGENTS.md`), so the terminal close sets `phase: complete`,
  `current_role: human-operator`, and leaves `status: active` via
  `TERMINAL_CLOSE_FRONTMATTER_KEYS` only on the `completed` close-out path.
  Rejected: widening `TASK_WRITE_FRONTMATTER_KEYS` for all writes (would let
  mid-chain review writes rewrite lifecycle frontmatter). Rejected:
  `status: completed` / `phase: done` at terminal close (would contradict
  protocol and falsely claim no next action). Protocol spelling is
  `phase: complete`, not `done`.
- **D3 (locked) — `wait` / SKILL.md follow the transition to terminal in this
  slice.** SKILL.md step 5/6/7 must not stop on `transition_id` alone; only
  step 4's `wait` loop decides mid-chain vs terminal. **Required:** `waitForRun`
  returns `done: false` while a non-terminal successor transition has a live
  invocation pid **or** a linked implementation-review run still non-terminal.
  `tests/detach.test.ts` covers both the pid-alive branch and the linked-run
  branch (board `0029` timing).
- **D4 (locked) — post-hoc `status --repo <r> --task <path>` recovery report**
  for a session that already stopped (new CLI surface; existing `status` keeps
  `--run` only).

## Acceptance Criteria

- [ ] (D1) After an auto-chain whose implementation review passes and ends the
      transition, the task artifact's `## Next Action` is the completion notice
      and `## Next Handoff` is retracted to the no-envelope state — not stale
      producer text. A test drives the full chain and asserts both sections.
- [ ] (D2) The frontmatter after that terminal reads `status: active`,
      `phase: complete`, `current_role: human-operator`, `next_role:
      human-operator`; `checkArtifactWriteShape` for ordinary `review` dispatch
      is unchanged and still admits typical pre-close artifacts.
- [ ] (D3) `spartan-bridge wait` on a plan run at `awaiting_implementer` with a
      non-terminal successor transition returns `{ "state": "running" }` while the
      invocation pid is alive **or** a linked implementation-review run is still
      non-terminal, then returns the implementation-review status / transition
      stop document when terminal. `SKILL.md` step 4/5 loops until that
      document. `tests/detach.test.ts` covers pid-alive and linked-run branches.
- [ ] (D4) `spartan-bridge status --repo <r> --task <path>` prints the chain's
      terminal state, the implementation-review verdict, and `git diff --stat`
      of the write scope, for a task whose chain already completed.
- [ ] (D2) A plan- or implementation-review `task_artifact_write` that is not
      the `completed` terminal close cannot change `status`, `phase`, or
      `current_role` (`tests/task-write.test.ts`).
- [ ] (D3) After a detached auto-chain completes, the driving `/spbridge`
      session reports the passing implementation-review verdict (not
      `awaiting_implementer` alone).
- [ ] `npm run typecheck` / `npm run build` clean; `npm test` adds no new
      failure.

## Work Completed

- 2026-09-01: task created after board `0029` reproduced board `0027` exactly —
  auto-chain completed, implementation review APPROVED, artifact left at
  `phase: reviewing` / stale `## Next Action`, implementer diff uncommitted,
  and the `/spbridge` session stopped at `awaiting_implementer` without
  reporting the terminal verdict. Both closed by hand.
- 2026-09-02 (planner, HX-001): refined against `transition.ts`, `task-write.ts`,
  `src/cli/detach.ts`, and `agent-skill/skills/spbridge/SKILL.md`; locked D1–D4;
  pinned D2 to `status: active` / `phase: complete`; fixed Scope path
  `src/core/detach.ts` → `src/cli/detach.ts`; confirmed every named Scope path
  exists; `npm run build` clean.
- 2026-09-02 (planner, HX-002): revised against plan-review findings
  (`run-54d5a07d`, cycle 1/3): gated lifecycle frontmatter on
  `TERMINAL_CLOSE_FRONTMATTER_KEYS` only; derived session-report criterion from
  D3; clarified file-path write scope unchanged; cited Spartan protocol source.
- 2026-09-02 (planner, HX-003): revised against plan-review findings
  (`run-cf3606af`, cycle 2/3): scoped D3 criterion to pid-alive branch;
  tied close-out write to `AGENTS.md` transition-metadata grant.
- 2026-09-02 (planner): revised against plan-review findings
  (`run-7d39abca`): terminal close retracts `## Next Handoff`; promoted
  `waitForRun` linked-run liveness to required in D3.
- 2026-09-02 (planner): revised against plan-review findings
  (`run-fbe2d88a`, cycle 2/3): `checkTerminalCloseShape` scoped to close-out
  only; evidenced transition linked-review fields.
- 2026-09-02 (owner override): plan review reached the 3-cycle limit
  (`run-54d30469`, `human_required`). No cycle contested the substance — D1-D4
  were locked from HX-001 and every cycle's findings were internal-consistency
  and evidence-precision refinements (the plan improved each round). The
  cycle-3 findings were one stale Tests-row wording (`CHECKSHAPE_TEST_ROW_STALE`,
  fixed here — the row now names `checkTerminalCloseShape`) and one info-level
  "consider quoting the field lines" nicety. Owner accepts D1-D4 and authorizes
  the implementation round. Fourth occurrence of the
  `claude-reviewer-nitpicks` plan-chain pattern — queued as bridge task `0061`.
  This planner round also burned several attempts on `## Next Handoff` shape
  (`composition_failed` / `next_handoff_not_retractable`); folded into `0061`.
- 2026-09-02 (implementer, HX-004): implemented D1-D4 — `writeTerminalCloseOut`
  + `TERMINAL_CLOSE_FRONTMATTER_KEYS` + `checkTerminalCloseShape`; `waitForRun`
  linked-run liveness; SKILL.md step 5/6/7 loop-until-terminal alignment;
  `spartan-bridge status --repo <r> --task <path>`; docs in
  `ROUTING-AND-WORKFLOWS.md` and `DECISIONS.md` (D-059). Evidence:
  `npm run typecheck` exit 0; `npm run build` exit 0; `npm test` 420/421 pass
  (one pre-existing `doctor.test.ts` wrapper-profile flake in this environment).
- 2026-09-02 (implementer, HX-005): revised against implementation-review
  findings (`run-d9c29b25`): added `tests/task-status.test.ts` behavioral
  coverage (completed transition, `task_not_found`, `git diff --stat`);
  close-out failure now stops the transition as `stopped` /
  `task_artifact_write_rejected`; added `tests/fixtures/detach-auto-chain-child.ts`
  and `tests/detach.test.ts` auto-chain close-out assertion. Evidence:
  `npm run typecheck` / `npm run build` exit 0; targeted tests pass.

## Evidence

- Board `0029` `spartan/tasks/0029-place-backlog-rail-right-of-columns.md`:
  `## Review` carries plan `APPROVED` (`run-5bf52d8a`) and implementation
  `APPROVED` (`run-32aa4cd3`); `## Next Action` still says "Re-review the
  implementation…"; frontmatter `status: active` / `phase: reviewing` /
  `next_role: human-operator`.
- `transition-761dc728-3b85-4630-a83f-2fb4366ad26c`: `state: completed`, full
  event trail (`producer_started` … `correction_dispatched` … `terminal_stop`
  `completed`), `15:03:22` → `15:13:17`.
- Board `0027` (`7d32a8d`): same shape, closed by hand on 2026-08-31.
- `src/core/task-write.ts` `TASK_WRITE_FRONTMATTER_KEYS` = `["next_role",
  "updated_at", "handoff_id", "next_handoff_id"]`;
  `IMPLEMENTATION_REVIEW_NEXT_ROLE = { pass: "human-operator", … }`;
  `checkArtifactWriteShape` (`:117`) — review splice + handoff retraction only
  today, no `## Next Action` probe.
- `src/core/transition.ts:296-304` — `implementation_review_result` then
  `terminal_stop` / `completed` on a passing impl review; no close-out write.
- `src/cli/detach.ts` `waitForRun` (`:132-176`) — `awaiting_implementer` →
  successor transition; liveness from invocation `pidAlive` today.
- `src/core/contracts.ts` `TransitionStatusDocument` — `current_review_run_id`,
  `linked_review_run_ids` on successor transitions (D3 linked-run liveness).
- `agent-skill/skills/spbridge/SKILL.md` step 5/7 — stop on non-null
  `transition_id` conflicts with step 4's loop-until-terminal rule.
- Spartan portable protocol (installed Spartan skill
  `references/protocol.md`, Review and completion) — confirmed readable at
  `~/.agent-profiles/personal/cursor-home/.claude/skills/spartan/references/protocol.md`
  (2026-09-02); task `completed` only when no required next action remains;
  controlled `phase` value `complete`.
- Plan review `run-54d5a07d` — `changes_requested`, cycle 1/3.
- Plan review `run-cf3606af` — `changes_requested`, cycle 2/3.
- Path check (2026-09-02): every Scope path exists (`src/core/transition.ts`,
  `src/core/task-write.ts`, `src/cli/detach.ts`, `src/cli/main.ts`,
  `src/cli/parse.ts`, `agent-skill/skills/spbridge/SKILL.md`,
  `docs/ROUTING-AND-WORKFLOWS.md`, `docs/DECISIONS.md`,
  `tests/transition.test.ts`, `tests/detach.test.ts`, `tests/task-write.test.ts`).
- `npm run build` — exit 0 (2026-09-02).
- `npm run typecheck` / `npm run build` / `npm test` — exit 0 (2026-09-02
  implementer round); 420/421 tests pass; `tests/doctor.test.ts` wrapper-profile
  case fails in this environment only (unrelated to task 0058).
- `npm run typecheck` / `npm run build` — exit 0 (2026-09-02 implementer
  correction HX-005); `tests/task-status.test.ts` and detach auto-chain close-out
  test pass.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: CHANGES_REQUESTED

Findings:

- `CHECKSHAPE_TEST_ROW_STALE` (warning): The Scope "Tests" bullet lists `tests/task-write.test.ts` as covering "`checkArtifactWriteShape` admits pre-close artifacts that accept the completion-notice probe". This contradicts the revised Scope sub-bullet ("leave `checkArtifactWriteShape` unchanged for ordinary review dispatch") and D1 ("`checkTerminalCloseShape` (terminal close-out only — not `checkArtifactWriteShape` on every dispatch)"). Per AGENTS.md "Before requesting review, read the criteria against the decisions as a set" and "State an invariant positively... the complete list of what changes": after the narrowing, the completion-notice probe belongs to `checkTerminalCloseShape`, and the only `checkArtifactWriteShape` assertion should be the negative one already named in the sub-bullet (a normal review write still cannot touch `status` / `phase` / `current_role`). Left as written, an implementer could add the completion-notice probe to `checkArtifactWriteShape`, reintroducing the verdict-independent behavior the prior cycle (`CHECKSHAPE_CRITERION_UNDERCOUNT`) rejected. Reword the Tests row to name `checkTerminalCloseShape` for the completion-notice-probe coverage.
- `LINKED_RUN_EVIDENCE_THIN` (info): The new Evidence row for D3 linked-run liveness names `src/core/contracts.ts` `TransitionStatusDocument` and the fields `current_review_run_id` / `linked_review_run_ids` but does not reproduce the declaration. AGENTS.md permits naming the file holding an input, so this clears the prior `LINKED_RUN_FIELDS_UNEVIDENCED` bar; consider quoting the field lines (as done for `TASK_WRITE_FRONTMATTER_KEYS` and `waitForRun` line ranges elsewhere in Evidence) so the implementer can confirm the fields exist on the successor transition, not only on the review run, before relying on them in `waitForRun`.

Bridge run: run_id=run-54d30469-14af-4321-aa82-f5bcfdfc14aa execution_id=exec-5277304f-64be-4eea-b5aa-5327627246de review_kind=plan verdict=changes_requested reason_code=review_changes_requested host=claude launcher=claude-plan-reviewer-v1 model=claude-sonnet-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:20fcfa7c8df758f5b260cdddb5dfbf86c1d202fcecff22e1ed15e24e6cabf2e0 task_hash=sha256:c0c3af8d9aa277f82adf17f3402be9f179079c306ae601fa77f84a98ff9708fb agents_hash=sha256:5b0538f788aa238a0f4e3edc1477bc42f67c2e71fee4bf230a3cfe394d51eeff timestamp=2026-09-02T09:02:54.751Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-91e10be2-952c-4573-b3d6-92d6d23f994d execution_id=exec-6a75294f-ab01-40ad-9bfd-66dcdd26e3ed review_kind=implementation verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-sonnet-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:1432cf4ad657ba8b32cb1751f04ef520e7ecebe5fcb14dec11a3dca63243ff05 task_hash=sha256:b80ff77268a2947315c9f389cdf8e0ed0eededf06cd9de0f5a171f7be193638c agents_hash=sha256:5b0538f788aa238a0f4e3edc1477bc42f67c2e71fee4bf230a3cfe394d51eeff timestamp=2026-09-02T11:09:51.500Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None. Independent of `0053` / `0054` / `0056` / `0057`; touches the same
`transition.ts` / `detach.ts` / SKILL.md files as `0055` / `0056`, so sequence
after `0056` if both are open.

## Next Action

None. Implementation review `run-91e10be2` returned APPROVED (no findings) on
2026-09-02; D1-D4 landed, `npm run typecheck` / `npm run build` clean, 427/427
tests pass. Committed and pushed. Follow-ups already queued: `0060` (the
`stale_build` terminal 0058's D3 anticipated) and `0061` D4 (the `cursor-home`
doctor warning that fired on this round's `doctor` call).

## Next Handoff

No outstanding handoff. The task is complete.
