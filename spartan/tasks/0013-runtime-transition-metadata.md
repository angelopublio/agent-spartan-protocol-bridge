---
protocol: "1.0.0" # x-release-please-version
id: runtime-transition-metadata
created_at: 2026-08-18
status: completed
phase: complete
task_type: implementation
risk: material
current_role: reviewer
next_role: none
updated_at: 2026-08-18
handoff_id: HX-004
next_handoff_id: none
---

# Let the runtime write the transition metadata it is already authorized to write

## Objective

After a dispatched review, the frontmatter fields naming who acts next and when the file changed
agree with the recorded verdict, without a human editing them.

The scope is narrower than "the human stops editing the file", and D2 states what it deliberately
leaves behind: the handoff envelope and its identifiers still describe the round that ended, and
`status` and `phase` remain judgements a review does not settle. This task removes one of the
fields a human corrects today and keeps `updated_at` current; it does not remove the correction.

## Context

`AGENTS.md` grants the Bridge `task_artifact_write` "only for persisting validated reviewer
findings **and transition metadata** to the explicitly identified current Spartan task
artifact". The findings half is implemented. The transition half has never been used.

The consequence is visible today. A completed Bridge review leaves a fresh verdict inside the
owned region beside a `next_role` and a `Next Handoff` envelope that still describe the round
that just finished. Anything reading the frontmatter — the Board renders `next_role` as a
"Next:" chip — shows a step that has already happened.

Task `0011`'s plan review raised this as `ENVELOPE_WRITE` and established where the fix does
not belong: not in the `/spbridge` skill, and not in a second `/spartan` round in the same
session. It belongs here, in the runtime, under authority that already exists.

## Scope

- `src/core/task-write.ts`: what the runtime may write outside the owned review region.
- `src/core/review.ts`: when a transition write happens and on which terminal states.
- `src/core/contracts.ts` if a new reason code is needed for a refused transition write.
- `docs/AUTHENTICATION-AND-SECURITY.md` and `docs/DECISIONS.md`.
- Tests covering every field written, every field refused, and the untouched-bytes guarantee.

## Out of Scope

- Authoring the `Next Handoff` envelope prose. See `D2`.
- The review-cycle loop, producer start, and any new adapter.
- Widening `task_artifact_write` beyond what `AGENTS.md` already grants. If the plan concludes
  more is needed, it stops and says so rather than assuming it.

## Constraints

- The existing guarantee must survive: every byte the runtime is not authorized to change stays
  identical, verified after the write as it is today.
- `AGENTS.md` forbids a `task_artifact_write` from modifying product files, `AGENTS.md` itself,
  host bindings, automation authority, commands, credentials, or another task. A frontmatter
  write must not become a hole in that list.
- The write stays atomic and reversible on failure, as the region write already is.
- Ambiguity fails closed: if the runtime cannot determine a transition deterministically, it
  writes nothing and says why.

## Acceptance Criteria

- [x] After a run whose verdict is `pass` or `changes_requested`, the runtime has written exactly
      two frontmatter fields: `next_role` and `updated_at`.
- [x] `current_role` is byte-identical before and after every write. A test names it specifically,
      because it was in this allowlist and was removed for a reason `AGENTS.md` states.
- [x] `status`, `phase`, `task_type`, `risk`, `id`, `created_at`, `protocol`, `handoff_id` and
      `next_handoff_id` are byte-identical before and after the write, asserted field by field.
- [x] `next_role` is `implementer` after `pass` and `planner` after `changes_requested`; no other
      mapping exists in the code.
- [x] The transition write is applied only when the completed round is the `reviewer.plan`
      binding. Any other review kind is refused with a named reason and nothing is written, and a
      test drives that refusal rather than asserting it cannot happen.
- [x] A run terminating on any other reason code leaves all twelve frontmatter fields unchanged.
- [x] The `## Next Handoff` section is byte-identical before and after every run.
- [x] A frontmatter whose current `next_role` is not `reviewer` is refused with a named reason
      and nothing is written, since the runtime cannot know what round it is completing.
- [x] The post-write check compares source text, not parsed values. A test mutates only a comment,
      only the quoting, or only intra-line whitespace on a non-allowlisted key and asserts the
      write is rejected and the original restored. A check implemented as parsed-value equality
      passes the other criteria and fails this one.
- [x] The frontmatter key order is unchanged, and no key is added or removed.
- [x] The owned region and the two frontmatter fields are written by a single replace evaluated by
      a single check with a single restore path. A test asserts that a failure leaves neither the
      verdict nor `next_role` changed, rather than one without the other.
- [x] `npm run typecheck` and `npm test` exit 0, and a real review run leaves a task whose
      `next_role` and recorded verdict agree.

## Decisions

### D1 - Two fields, and `current_role` is not one of them

`updated_at` is mechanical. `next_role` follows from the verdict by a mapping with two entries and
no third: `pass` hands the task to the implementer, `changes_requested` returns it to the planner.
Those two are written; nothing else is.

`current_role` was in this list and has been removed. `AGENTS.md` says the Bridge "must stop
before changing the producer role", and `current_role` names the producer. The distinction this
decision relies on only survives if the runtime writes the field that says who acts next and not
the field that says who acted: `next_role` starts nothing, while `current_role: implementer` would
be the runtime recording a producer change it is forbidden to make. Two fields, and the forbidden
one is not among them.

The mapping is also specific to a plan review, and the trigger must say so. An implementation
review reaches the same `next_role: reviewer` state, and there `pass` means the task is finished
rather than handed to an implementer. The runtime therefore applies this mapping only when the
completed round is the `reviewer.plan` binding, and refuses the transition write with a named
reason for any other review kind. Today the runtime dispatches nothing else, so the refusal is
latent — which is the point: it must already be there when the `reviewer.implementation` adapter
lands, not added after the first wrong write.

`status` and `phase` are deliberately excluded, and the reason is the same for both. Writing
`status: completed` is closing a task, which is a judgement about whether the work is finished —
not a fact about the review that just ran. A reviewer can approve a plan while the task still has
implementation ahead of it, which is exactly what happens in this repository. `phase` follows the
same logic: a passing plan review does not by itself establish that the next phase has begun.

`AGENTS.md` also constrains this directly, and the constraint is easy to read as narrower than it
is: the Bridge "must stop before changing the producer role or producer host." Writing
`next_role` names who acts next; it does not change the producer of the round that ran, and it
starts nothing. The plan should confirm that reading survives review, because the sentence is
close enough to the change that a reviewer must be given the distinction rather than left to
infer it.

### D2 - The envelope is prose, and the runtime writes none of it

The `## Next Handoff` block carries a recommended host, a model, an effort level and a reason
phrase. Those are judgements about how the next round should run, not facts about the run that
finished. A runtime authoring them would be inventing round semantics, which is the boundary task
`0011` was corrected for crossing.

So the runtime leaves that section byte-identical, including when it is stale. It also leaves
`next_handoff_id` alone: the identifier names a prompt, and the runtime writes no prompt.

The consequence is accepted rather than hidden: after a run, `next_role` is current while the
envelope below it still describes the round that just ended. That is better than the situation
today, where both are stale, and better than a runtime inventing an envelope. Whoever writes the
next round replaces it.

### D3 - The guarantee is scoped by an allowlist, and the source text is the check

Today `preservedOutsideRegion` compares everything outside the owned region and restores the file
on any difference. That is an exact-match guarantee, and it is the strongest property this write
path has.

Permitting two frontmatter fields weakens it, and the weakening must be bounded by construction
rather than by intention.

The check is on source text, never on parsed values. Parsed keys are not bytes, and this
repository proves it: `protocol: "1.0.0" # x-release-please-version` carries a trailing comment
that a YAML round-trip drops, and a comparison of twelve parsed key-value pairs would report the
document unchanged while the release tooling's marker had been deleted. Quoting style and
intra-line whitespace fail the same way.

So the successor of `preservedOutsideRegion` asserts: the frontmatter key order is unchanged; the
source text of every line belonging to a non-allowlisted key is byte-identical, comments and
whitespace included; no key was added or removed; and the entire document below the frontmatter is
byte-identical, exactly as today. Only the two allowlisted keys' lines may differ. If the
frontmatter does not parse after the write, the original file is restored, as it is today.

### D4 - One write, one restore path

The findings region and the two frontmatter fields are replaced in a single write against a single
document, evaluated by a single check, with a single restore path. They are never two successive
writes.

The reason is that this task exists to remove an inconsistency between the verdict and the
frontmatter, and two writes reintroduce it in a narrower window: if the second fails after the
first succeeded, the artifact carries a validated verdict beside a stale `next_role`, which is
today's defect with a smaller probability attached. A single replace either produces a document
that differs only in the owned region and the two allowlisted key lines, or restores the original.

## Work Completed

- Planner (Claude Code, Claude Opus 5, high effort, Anthropic): recorded the objective, the
  authority that already exists, and D1-D3 as open questions. No product file changed.

- Planner (HX-001, Claude Code, Claude Opus 5, high effort, Anthropic): accepted matching envelope
  HX-001 and all four findings. `CURRENT_ROLE_VALUE` removed `current_role` from the allowlist.
  `REVIEW_KIND_MAP` gated the mapping on the `reviewer.plan` binding. `D3_SOURCE_BYTES` replaced a
  parsed-value comparison. `WRITE_ATOMICITY` became D4. No product file changed.

- Plan review HX-002 (Cursor, cursor-grok-4.6-high-fast, effort none, dispatched by the runtime)
  approved the revised plan with no findings, in run `run-21c298d5`.

- Implementer (HX-003, Cursor, cursor-grok-4.6-high-fast, effort none):
  accepted matching envelope HX-003. The pasted prompt carried identifier HX-003. Implemented D1-D4
  in `src/core/task-write.ts`, `src/core/review.ts`, and `src/core/contracts.ts`, with tests in
  `tests/task-write.test.ts` and decision/security documentation.

- Reviewer (HX-004, Claude Code, Claude Opus 5, high effort, Anthropic): accepted matching envelope
  HX-004. Verified the implementation against every acceptance criterion; product files were read
  only, and only this artifact was written.

## Evidence

- `PLAN_REVIEW_NEXT_ROLE` has exactly two keys: `pass` → `implementer`, `changes_requested` →
  `planner`. `TASK_WRITE_FRONTMATTER_KEYS` is `next_role` and `updated_at`; `current_role` is not
  among them.
- `decidePlanReviewTransition` returns `transition_review_kind_refused` when `review_kind` is not
  `plan`, including a direct `writeTaskReviewRegion` call with `implementation` that writes
  nothing. `transition_next_role_not_reviewer` is returned, and the file is unchanged, when
  `next_role` is not `reviewer`.
- `composeTaskArtifactWrite` splices the owned region and replaces the two allowlisted key lines
  in one in-memory document. `commitTaskArtifactWrite` performs one write, one source-text check
  (`preservedAuthorizedBytes`), one parse, and one restore. A commit whose composed document also
  mutates the `protocol` comment restores the original, leaving neither `Verdict: APPROVED` nor
  `next_role: implementer`.
- `preservedAuthorizedBytes` rejects a comment-only, quoting-only, and intra-line-whitespace-only
  mutation of a non-allowlisted key. `parseTaskFrontmatter` on those same mutations returns equal
  parsed values, so a parsed-value check would have accepted them.
- `human_required` and `blocked` terminals leave all twelve frontmatter source lines unchanged.
  `## Next Handoff` is byte-identical after pass and after `changes_requested`.
- `npm run typecheck` exited 0. `npm test` exited 0 (117 passed). A `runReview` pass writes
  `next_role: implementer` beside `Verdict: APPROVED`; `changes_requested` writes
  `next_role: planner` beside `Verdict: CHANGES_REQUESTED`. No live Cursor client dispatch was
  run in this round; the write path is the same function the Cursor adapter reaches after an
  accepted result.

## Review

<!-- spartan-bridge:review:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-21c298d5-1df7-4c79-ae10-87994c4baf36 execution_id=exec-cda13d4f-d961-4ebb-8a79-1d4c5c3f7225 review_kind=plan verdict=pass reason_code=review_passed host=cursor launcher=cursor-plan-reviewer-v1 model=cursor-grok-4.6-high-fast effort=none model_observed=declared_unobserved policy_digest=sha256:5ce5ce183767d86bbd03d6217f03b8849dd70c4a7609b5b84f750ecbb1d0100f task_hash=sha256:34b9d54f1648014f4c3a10fbe2debbe7d21db316bacd081a0f6021cc1bb2549f agents_hash=sha256:30644e4ddfe923cc72bc6a40fd5d26c1af74682d01e4329f4c5d93016be00e7f timestamp=2026-08-18T15:06:26.789Z
<!-- spartan-bridge:review:end -->

### Implementation review (HX-004, Claude Code, Claude Opus 5, high effort, Anthropic)

Verdict: APPROVED. Accepted matching envelope HX-004; product files were read only, and only this
artifact was written.

D3 was the criterion an implementation could pass by accident, so it was read first.
`preservedFrontmatterSource` compares the frontmatter line by line as source text: for a key
outside `TASK_WRITE_FRONTMATTER_KEYS`, which is exactly `["next_role", "updated_at"]`, the
comparison is `beforeLine !== afterLine`. A trailing `# x-release-please-version` is part of that
line, so the mutation that would have defeated a parsed-value check now fails the write. Key order
and key count are compared separately. A test drives comment, quoting and whitespace mutations and
asserts each is rejected.

The rest verified as specified.

- **`current_role` is not writable by construction**, not by intention: it is absent from the
  allowlist, so its line falls into the byte-identical branch, and a test names it.
- **One write, one check, one restore path.** `composeTaskArtifactWrite` splices the region and
  replaces the two fields into a single string; `commitTaskArtifactWrite` renames it once, re-reads
  once, and restores once on parse failure or on a failed check. A test asserts a failure leaves
  neither the verdict nor `next_role` changed.
- **The mapping has two entries and no third**, and `decidePlanReviewTransition` refuses any
  `reviewKind` other than the plan constant before it looks at anything else. Both refusals are
  driven by tests rather than asserted unreachable.
- **The refusals carry their own reason codes** — `transition_review_kind_refused` and
  `transition_next_role_not_reviewer` — instead of collapsing into
  `task_artifact_write_rejected`, so a refused transition says which rule refused it.

`npm run typecheck` clean; `npm test` 117 pass, 0 fail, up from 110. `docs/DECISIONS.md` records
D-017 and `docs/AUTHENTICATION-AND-SECURITY.md` states the widened invariant; both are in the
plan's named scope.

Findings:

- `REDISPATCH_LOSES_FINDINGS` (warning, faithful to the plan): the refusal path terminates
  `human_required` and writes nothing, and because D4 makes the write atomic, "nothing" now
  includes the findings region. After a `changes_requested`, `next_role` becomes `planner`; a
  re-dispatched review on that artifact is refused and its verdict is discarded. The revise-and-
  re-review loop therefore depends on the planner setting `next_role` back to `reviewer` before
  re-dispatching — which the planner does anyway when writing the next handoff, but a forgotten
  step now costs a paid reviewer session and records no verdict. This session ran that loop twice,
  on `0017` and on this task. The plan specified "nothing is written" and the implementation is
  faithful; what neither round examined is that D4 changed the reach of that phrase. Worth a
  follow-up deciding whether a refused transition should still persist the findings region.

## Blockers

None.

## Next Action

None. Every acceptance criterion is checked, `npm run typecheck` and `npm test` have recorded
outcomes, the plan review and the implementation review are both `APPROVED`, and no blocker
remains. Committing is the human-only gate.

## Next Handoff

No outstanding proposal. This task is closed.

Non-binding note for the human: `dist/` needs rebuilding before the next run. The finding above is
a candidate for a follow-up, together with the `adapter_error` ambiguity recorded in task `0017`.
