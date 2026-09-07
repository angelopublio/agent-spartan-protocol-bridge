---
protocol: "1.0.0" # x-release-please-version
id: stop-before-paying-for-a-review-the-write-will-refuse
created_at: 2026-08-19
status: completed
phase: complete
task_type: implementation
risk: material
current_role: reviewer
next_role: none
updated_at: 2026-08-20
handoff_id: HX-004
next_handoff_id: none
---

# Stop before paying for a review the write will refuse

## Objective

A review run whose transition write is already certain to be refused stops before it starts a
reviewer, instead of spawning one, waiting for it, and discarding a valid verdict at the last step.

## Context

**It happened on 2026-08-19, on task `0022`.** Cycle 1 returned `changes_requested`, and the Bridge
wrote frontmatter `next_role: planner` as D-017 requires. The producer round answered the findings and
regenerated the handoff envelope for the next review, but did not return `next_role` to `reviewer`.
Cycle 2 then ran: the reviewer read the revised plan, judged it, and returned `pass` with no findings.
The runtime validated that result and stored it at
`.spartan-bridge/runs/run-7c2bbff2-…/reviews/exec-2ebb7ff7-….json`, then refused to persist it into the
artifact with `transition_next_role_not_reviewer`, `task_write_state: rejected`, terminal state
`human_required`. Two minutes of reviewer time produced an approval that the artifact never received.

**The precondition was knowable before any of that.** `decidePlanReviewTransition` fails on
`transition_next_role_not_reviewer` using the artifact's `next_role`, which the run already reads and
hashes during policy resolution — long before the adapter is constructed. Only the verdict-dependent
half of that decision needs the review to have happened; the `next_role` half does not.

**The precondition is not knowable from `next_role` alone.** The transition is decided only when two
further things hold, both of which the run already knows before the adapter exists or does not know
at all: `AGENTS.md` must carry the `task_artifact_write` grant, and the reviewer's verdict must be
`pass` or `changes_requested`. Without the grant the write is never attempted and today's run reports
`review_passed` with `task_write_state: not_authorized` whatever `next_role` says. D6 settles the
first; the second is what this change deliberately pre-empts, and D6 lists what that costs.

**The omission is not a new rule waiting to be invented.** The protocol already requires the
frontmatter `next_role`, the advisory role, and the prompt's `Act as <role>` to agree, so a producer
round that issues a reviewer handoff is already obliged to set `next_role: reviewer` in the same edit.
What is missing is anything that notices when it does not, and the loop shipped by task `0020` made
that omission cost a full review rather than a moment of confusion.

**Why this is not solved by task `0024`.** That task makes the Bridge retract a consumed envelope. It
does not make a producer round set `next_role`, and it does not move any check earlier. The two are
independent.

## Scope

- `src/core/review.ts`: retain the `next_role` that policy resolution already parses and discards, and
  refuse on it there — after the chain stop (D5) and before `deps.catalog.resolve` constructs the
  adapter — under the `task_artifact_write` grant only (D6).
- `src/core/task-write.ts`: expose the verdict-independent half of `decidePlanReviewTransition` as one
  function that `decidePlanReviewTransition` itself calls, so the check and the write cannot drift.
- `skills/spbridge/SKILL.md`: the producer round's obligation to return `next_role` to `reviewer`
  before the loop's next review.
- `tests/review.test.ts`, `tests/task-write.test.ts`, `tests/spbridge-skill.test.ts`: coverage for the
  early refusal, the chain ordering, the ungated repository, and the shared rule — including the one
  existing assertion this change invalidates (`tests/task-write.test.ts:407`).

## Out of Scope

- The transition mapping itself, the `task_artifact_write` grant, and the review-kind rule of D-017.
- Any change to what happens after a review returns; a verdict that arrives with the precondition
  satisfied is written exactly as today.
- `docs/DECISIONS.md`. This task settles no new decision of record: D-017's consequence sentence stays
  literally true because D7 keeps `task_write_state: rejected`, and D-020's chain vocabulary is
  untouched because D5 leaves the chain deciding first.
- Recovering a verdict that a refused write already discarded. That was done by hand on task `0022`
  and is not a runtime capability this task proposes.
- Whether `next_role: reviewer` is the right precondition at all. D-017 settled that and this task
  does not reopen it.

## Constraints

- The check must not consult the reviewer's answer, because it runs before there is one.
- No new reason code and no new terminal state: the early refusal reports the reason code and terminal
  state the late refusal reports today.
- Two classes of run are unchanged in every observable — events, status document, stdout, exit code:
  any run whose artifact carries `next_role: reviewer`, and any run in a repository without the
  `task_artifact_write` grant. Every run resolves `review_kind` to the constant `plan`, so the kind
  guard the early seam also carries cannot refuse one. The complete list of runs whose outcome does
  change is in D6; nothing outside that list changes.
- The rule has one implementation. The early check and the write-time check must derive from the same
  function, not from two copies of the same condition.

## Acceptance Criteria

- [x] D6: in a repository whose `AGENTS.md` carries the `task_artifact_write` grant, a `review` run on
      an artifact whose `next_role` is `planner` terminates without the adapter being constructed,
      asserted from a catalog stub that records every `resolve` call and is asserted to have recorded
      none.
- [x] D3: that run terminates state `human_required` with `reason_code:
      transition_next_role_not_reviewer` and exit code 1 — the pair a late refusal produces today.
- [x] D7: that run's status document carries `task_write_state: "rejected"` with `verdict: null`,
      `execution_id: null`, and `model_observed: null`, and the task file is byte-identical to what it
      was before the run.
- [x] D5: that run's events are `policy_resolved` then `run_terminal` with no `review_started`, and its
      `policy_resolved` event carries the fully resolved `review_chain` record.
- [x] D5: a chained run whose parent fails a chain condition — `task_unchanged`, on an artifact whose
      `next_role` is `planner` — terminates `blocked` / `chain_refused` with `review_chain.refused:
      "task_unchanged"`, not `transition_next_role_not_reviewer`.
- [x] D5: a chained run whose chain conditions all pass and whose artifact carries `next_role: planner`
      terminates `human_required` / `transition_next_role_not_reviewer` with `review_chain.cycle: 2` —
      the `0022` case, refused before the reviewer runs.
- [x] D6: in a repository without the `task_artifact_write` grant, a run on an artifact whose
      `next_role` is not `reviewer` still reaches the adapter and terminates `review_passed` with
      `task_write_state: "not_authorized"` and exit code 0, asserted by `tests/review.test.ts:69` and
      `tests/task-write.test.ts:80` passing unchanged.
- [x] D1: a run whose artifact carries `next_role: reviewer` behaves exactly as the current build —
      its `review_kind` is `plan`, so the precondition accepts both guards and the seam is
      transparent — asserted by the existing `tests/review.test.ts` and `tests/task-write.test.ts`
      expectations for the written happy path passing unchanged.
- [x] D1: no run refuses on the review kind: a test asserts the status document's `review_kind` is
      `"plan"` and that the exported precondition accepts that kind with `next_role: reviewer`,
      alongside `tests/review.test.ts:478` — "no implementer-start or implementation-review path is
      shipped" — passing unchanged.
- [x] D2: `decidePlanReviewTransition` and the early seam consult one exported precondition function,
      asserted by a test that drives that function and `decidePlanReviewTransition` over the same table
      of review kinds crossed with `next_role` values, for each of the two admissible verdicts, and
      requires every refusal reason to agree, `transition_review_kind_refused` included.
- [x] D2: the seam reports the reason the precondition returned rather than naming the outcome itself,
      asserted in the idiom of `tests/doctor.test.ts:178`: the source of `src/core/review.ts` matches
      the exported precondition's name and contains neither the role literal `"reviewer"` nor
      `transition_next_role_not_reviewer`, both of which are absent from that file today.
- [x] D2: the seam's refusals track the precondition's rather than merely agreeing with it today: under
      the grant, a test drives `runReview` once for each of the seven `next_role` values
      `src/policy/task-frontmatter.ts:38` admits and derives every expectation by calling the exported
      precondition inside the test rather than from a written-out list, requiring the adapter to be
      constructed exactly when the precondition accepts.
- [x] D1: the verdict-dependent half is unmoved — `decidePlanReviewTransition` still returns
      `implementer` after `pass` and `planner` after `changes_requested`, and still refuses a verdict
      that is neither.
- [x] D4: `skills/spbridge/SKILL.md` states, inside the `/spartan` producer step, that a producer round
      returning into the loop sets `next_role: reviewer` in the same edit that regenerates the
      envelope, and names `transition_next_role_not_reviewer` as what the next review does otherwise;
      the sentence obliges the producer round, not the skill, so the skill's own boundary against
      inspecting task frontmatter is unedited and every `assert.doesNotMatch` in
      `tests/spbridge-skill.test.ts` still holds.
- [x] `npm run typecheck` and `npm test` exit 0.

## Decisions

### D1 - Move the knowable half of the check earlier; leave the rest where it is

`decidePlanReviewTransition` decides on two inputs: the review kind and the artifact's `next_role`,
neither of which depends on the verdict, and the verdict itself, which does. The first two are
available during policy resolution. Both move: the early seam calls D2's shared function with the
run's resolved `review_kind` and the artifact's `next_role`, and a run that fails either stops before
the adapter exists. The verdict-dependent half stays exactly where it is: the write path still maps
`pass` to `implementer` and `changes_requested` to `planner`, and still refuses a verdict that is
neither.

Only one of the two guards can refuse a run. `StatusDocument.review_kind` is typed `typeof
REVIEW_KIND` and `REVIEW_KIND` is `"plan" as const`, so `transition_review_kind_refused` is
unreachable from the early seam exactly as it is unreachable from the write path today. The guard
moves anyway, because D2's function is one function and the early seam calls it whole rather than
reaching past the half it does not need. The day a second review kind is introduced, this seam refuses
it before the adapter instead of after the reviewer — a change that task must account for, not this
one.

The seam is given the run's resolved `review_kind` rather than the `REVIEW_KIND` constant, so the day
the type widens the seam reads what the run actually resolved instead of what the build assumed. While
the kind is unrepresentable the two are the same value and no test can tell them apart, so this is
recorded here as an implementation decision and is not pinned by a criterion: a criterion no failing
case can violate is not a criterion.

This is a scheduling change: the same condition, read from the same input, refuses the same run two
minutes earlier and without spending a reviewer session. It is not free of consequence, because a run
that today reaches the reviewer can return a verdict the transition never sees. D6 names which runs
those are.

### D2 - One implementation, consulted twice

The verdict-independent half becomes one exported function taking the review kind and the current
`next_role` and returning either acceptance or the refusal reason. `decidePlanReviewTransition` calls
it and adds the verdict mapping; the early check calls it and nothing else. Two copies of the rule
would drift, and the copy that drifts is the one that only fires in the failure case nobody exercises
by hand.

That claim is structural, and two checks are needed because neither settles it alone. A behavioural
test over the seam cannot see a copy: an inlined `next_role !== "reviewer"` agrees with the function on
every input a run can carry today, so it passes. A source-text assertion sees the copy but not what the
seam does with the answer. So both are pinned: the seam's source references the function and holds
neither the role literal nor the reason-code literal, and a seam-level test derives its expectation by
calling the function rather than from a written-out list.

The absence of the reason-code literal is a consequence of a decision this makes explicit: **the seam
reports the reason the precondition returned and does not name the outcome itself.** One condition
keeps one name, produced in one place; a seam that re-names what it consulted can return the
precondition's answer and report a different code, and that divergence is invisible to a test that
checks only the code. `src/core/doctor.ts` is the precedent both ways — the file the source-text idiom
comes from writes the literal `agent_hosts_section_missing` to choose a branch, and reports
`parsed.reason` unchanged. Naming a check to branch on it is not copying a rule; re-naming an outcome
someone else decided is.

Pass-through is also what closes the gap the other two rows leave. A seam that called the precondition
and discarded the result — `precondition(…); if (nextRole === "reviewer") …` — would satisfy a bare
"references the function" assertion and would agree with it on every input today. It cannot satisfy
this one: having thrown the answer away, it has nothing to report but a literal it may not write.

Two limits are left standing rather than claimed away. A copy that compares against an imported
constant instead of the role literal is not caught by the text assertion. A seam that inlines only the
accepting branch and calls the precondition solely to obtain the refusal reason satisfies every row
here. Both diverge from the precondition the first time the rule admits a second role, and the
seam-level test fails then — which is what these rows are for. They are a drift oracle, not a proof
that today's build contains no copy.

### D3 - The same reason code and the same terminal state

`transition_next_role_not_reviewer` already names this outcome and `human_required` is already its
terminal state. Adding a code for "refused earlier" would teach every consumer a second name for one
condition, which is what D-018 refused for adapter failures. What changes is when the run stops, not
what it is called.

### D4 - State the producer's obligation where the loop can act on it

The three-place agreement already requires a round issuing a reviewer handoff to set
`next_role: reviewer`. The skill states it explicitly anyway, because the automatic loop is where the
omission is expensive and because a producer round that regenerates only the envelope looks complete
until the next review is refused. This is a restatement placed where it is needed, not a new rule.

It is placed in the `/spartan` producer step and worded as that round's obligation. The skill's hard
boundary forbids the skill itself from inspecting task frontmatter to decide whether to invoke, and
this sentence must not smuggle that inspection back in: the producer round sets the field, and the
runtime, not the skill, is what refuses when it was not set.

### D5 - The chain decides first; the precondition check runs immediately after its stop

A chained run can fail a chain condition and carry a wrong `next_role` at the same time. Today that
run reports `chain_refused` or `cycle_limit_reached`, because it stops before any review happens and
therefore before any write is attempted. Placing the new check ahead of `resolveReviewChain` would
change that run's reason code, which D3 forbids. So the check sits after the chain stop and before
`deps.catalog.resolve`.

The consequence is also what D-020 requires: `StatusDocument.review_chain` is present from
`policy_resolved` onward, so an early refusal carries the fully resolved chain record like any other
post-`policy_resolved` stop, and `/spbridge` reads the same field it always reads. On the `0022` shape
— chain healthy at cycle 2, `next_role` left at `planner` — the chain passes and this check refuses,
which is the case the task exists for.

### D6 - The check fires only under the `task_artifact_write` grant, and this is what it changes

Without that grant the transition is never decided: the run sets `task_write_state: not_authorized`
and reports `review_passed` however `next_role` reads. Refusing such a run would change a run that
succeeds today, so the early check is gated on `resolvedPolicy.task_artifact_write_authorized`.

Under the grant, `next_role` is the only guard that can refuse a run, because every run resolves
`review_kind` to `plan` (D1). With `next_role` not `reviewer`, the reviewer's answer decides today
what this check cannot know. The complete list of what changes:

- a reviewer that would have returned `pass` or `changes_requested`: same reason code, same terminal
  state, no reviewer session spent. This is the intended saving.
- a reviewer that would have returned `blocked` or `human_required`: today `review_blocked` or
  `review_human_required`, exit 0, `task_write_state: skipped_human_gate`. Now refused before it runs.
- a run that would have failed at `launcher_unavailable`, `capability_denied`, `adapter_error`, or
  result validation: today that reason code. Now refused before it runs.

The second and third are accepted rather than hidden. In all three the artifact was going to receive
nothing, and the fix is a one-line edit to `next_role` followed by a re-run that reports the real
outcome — at the cost of a reviewer session that the refused run did not spend. Nothing outside this
list changes, and no run changes on the review kind.

### D7 - The early refusal's status document says both true things

The run reports `task_write_state: "rejected"`, because D-017's consequence pins that field to
`rejected` for this reason code and that decision is out of scope here; the write was refused, and one
condition keeps one status shape. It reports `verdict`, `execution_id`, and `model_observed` as `null`,
because no review ran, so a reader can tell an early refusal from a late one without a second reason
code — which is what D3 asked for.

## Work Completed

- Planner (Claude Code, claude-opus-5, effort high, Anthropic): created this task from a failure
  observed while operating the loop on task `0022`. No product file was edited.
- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20, handoff `HX-002`, through
  `/spbridge`: read the criteria against the decisions as a set. Found that D1's closing claim
  undercounted — the check pre-empts runs that today report `review_blocked`, `review_human_required`,
  or an adapter failure — and that an ungated check would break `tests/review.test.ts:69`, which today
  passes a `verifier` `next_role` through to `review_passed`. Added D5, D6, and D7 to settle the chain
  ordering the criteria had deferred to the reviewer, the grant gate, and the status document; amended
  D1 and D4; re-derived all twelve criteria from named decisions. No product file was edited. Frontmatter
  `next_role` set to `reviewer` in this edit; `## Next Handoff` carries no envelope, because the review
  is dispatched by this session rather than pasted by the human.
- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20, Bridge cycle 1
  (`run-1badf7fe-…`, `changes_requested`, one finding `KIND_GUARD_UNSETTLED`): the finding was correct
  and is answered by settling that the early seam calls D2's function whole, kind guard included, and
  that the guard is unreachable because `review_kind` is typed `typeof REVIEW_KIND`. Amended D1 and D6
  and re-derived the D1, D2, and D6 criteria as a set rather than patching the row the finding named;
  added one criterion pinning that the seam is given the resolved kind rather than a literal. No
  product file was edited. `next_role` returned to `reviewer` in this same edit.
- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20, Bridge cycle 2
  (`run-7f0ce6c2-…`, `failed`, `adapter_error`): the reviewer returned no verdict and the run wrote
  nothing. Its retained payload held prose only, ending "The D1/D2 criteria still do not pin the early
  seam to that shared function." That text is not a verdict and is used here as a hint, not as a
  review: the claim was checked against the criteria independently and holds, because the D2 criterion
  required only that the exported function and `decidePlanReviewTransition` agree over a table, which a
  seam carrying its own inlined copy of the rule satisfies. Amended D1 and D2 and re-derived their
  criteria as a set: added the source-level single-source pin in the idiom of `tests/doctor.test.ts:178`
  and the seam-level test whose expectation is computed from the precondition, and moved the
  unfalsifiable "resolved kind rather than a literal" clause out of the criteria and into D1 as an
  implementation decision with its reason. No product file was edited. `next_role` is `reviewer`,
  unchanged, because cycle 2 wrote nothing.
- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20, acting on a second opinion
  the human requested from Cursor (`cursor-grok-4.6-high-fast`, personal) because the plan reviewer
  reads only `task.md` and `AGENTS.md` and therefore cannot open the test this round cited as its
  precedent. The opinion held that the source-text row copied the *format* of
  `tests/doctor.test.ts:178` and not its criterion: that test's negatives are parser internals a
  correct caller never needs, while `transition_next_role_not_reviewer` is the public identifier D3
  requires the seam to report — `src/core/doctor.ts:168` writes its own check name and its test does
  not forbid it. Verified and correct, and the same file settles it further than the opinion claimed:
  `doctor.ts` reports `parsed.reason` unchanged and writes a literal only to branch. So the row was not
  dropped; D2 now decides pass-through explicitly and the row pins that decision rather than guessing at
  internals. The opinion's second point — that a seam calling the precondition and discarding the result
  satisfies both rows — is answered by the same decision, since a seam that discarded the answer has
  nothing left to report. `!== "reviewer"` was replaced by the role literal `"reviewer"`, because
  forbidding an operator form is evaded by reordering the comparison. Two residual limits are now stated
  in D2 rather than claimed closed. No product file was edited.
- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20: after `run-2c34c65a-…`
  repeated the previous run's failure, dispatched the plan review as a manual round in the bound
  `reviewer.plan` host rather than retrying a third Bridge cycle, and recorded the returned `pass` in
  `## Review` with its provenance. Frontmatter `next_role` set to `implementer` and handoff `HX-003`
  issued to the implementer, because `AGENTS.md` grants the Bridge no authority to start
  implementation. No product file was edited.

- Implementer (Cursor, cursor-grok-4.6-high-fast, effort none), 2026-08-20,
  handoff `HX-003`: split the verdict-independent half of `decidePlanReviewTransition` into exported
  `planReviewTransitionPrecondition`; the write-time function calls it and maps the verdict. The early
  seam in `src/core/review.ts` sits after the chain stop and before `deps.catalog.resolve`, gated on
  `resolvedPolicy.task_artifact_write_authorized`, and reports `precondition.reason`. Early refusal
  uses D7's status shape. Added D4's producer-round sentence to the `/spartan` step in
  `skills/spbridge/SKILL.md` without editing the skill's frontmatter-inspection boundary. Wrote the
  named tests, including the catalog stub, the equivalence table, the source-text pin, and the
  seam-level derived-expectation test. `npm run typecheck` and `npm test` exit 0.
- Reviewer (Codex, gpt-5.6-terra, effort high, OpenAI), 2026-08-20, handoff `HX-004`: reviewed the
  implementation against every acceptance criterion. The early precondition is grant-gated, runs
  after the chain stop and before adapter resolution, and shares its rule with the write-time
  transition. No product files were modified in this review.

## Evidence

- Run `run-7c2bbff2-0dc3-481a-a6a4-b819f2e34a05` on task `0022`: `state: human_required`,
  `verdict: pass`, `reason_code: transition_next_role_not_reviewer`, `task_write_state: rejected`,
  `review_chain: { after_run_id: run-e27af0f6-…, cycle: 2, max_cycles: 3, refused: null }`, created
  16:27:14Z, updated 16:29:28Z — two minutes and fourteen seconds of reviewer time.
- The approved result was validated and retained at
  `.spartan-bridge/runs/run-7c2bbff2-…/reviews/exec-2ebb7ff7-….json`: `verdict: pass`, zero findings.
  It was recorded into the task artifact by the planner, with provenance, because the runtime would
  not.
- `src/core/task-write.ts:111-123`, the rule to be split: `if (input.reviewKind !== REVIEW_KIND) {
  return { ok: false, reason: "transition_review_kind_refused" }; } if (input.currentNextRole !==
  "reviewer") { return { ok: false, reason: "transition_next_role_not_reviewer" }; } return { ok: true,
  next_role: PLAN_REVIEW_NEXT_ROLE[input.verdict] };` — two verdict-independent guards, then the map.
- `src/core/review.ts:217-219`: `parseTaskFrontmatter(taskBytes, path.basename(taskAbs));` — the parse
  runs already and its result is discarded, so the early check retains what is computed today rather
  than reading the file a second time.
- `src/core/review.ts:286-309`, the seam and its order: `const chain = await resolveReviewChain({…});`
  then `await emit(run, deps, "policy_resolved", "policy_resolved", { …, review_chain: chain.record });`
  then `if (chain.stop !== undefined) { return terminate(…); }` then `adapter =
  deps.catalog.resolve(launcherId);`. The check goes between the chain stop and the resolve.
- `src/core/review.ts:499-503`, why the gate is needed: `let taskWriteState: TaskWriteState =
  "not_authorized"; if (result.verdict === "human_required" || result.verdict === "blocked") {
  taskWriteState = "skipped_human_gate"; } else if (resolvedPolicy.task_artifact_write_authorized) {` —
  the transition is decided only under the grant and only for `pass` or `changes_requested`.
- `src/core/review.ts:527-538`, the late refusal's arguments to `terminate`: `"human_required",
  written.reason, hashes, digest, executionId, result.verdict, "rejected", null` — an execution id and
  a verdict the early refusal cannot have, and the `rejected` that D7 keeps.
- `tests/review.test.ts:69-79`, the run an ungated check would break: `validTaskMd({ role:
  "implementer", nextRole: "verifier" })` against `validAgentsMd()` (no grant) asserting
  `assert.equal(outcome.status?.reason_code, "review_passed")`.
- `tests/task-write.test.ts:80-92` pins the same shape from the other side: no grant, `review_passed`,
  `task_write_state: "not_authorized"`, `exitCode: 0`.
- `tests/task-write.test.ts:398-411` is the one existing assertion this change invalidates: the run
  asserts `reason_code: "transition_next_role_not_reviewer"`, `state: "human_required"`,
  `task_write_state: "rejected"` — all kept — and `assert.equal(outcome.status?.verdict, "pass")`,
  which becomes `null` under D7 because no reviewer runs.
- `tests/task-write.test.ts:413-435` is unaffected: a second review against `next_role: implementer`
  still reports `transition_next_role_not_reviewer` and still leaves the first write intact.
- `docs/DECISIONS.md:139` (D-017): "Reason codes `transition_review_kind_refused` and
  `transition_next_role_not_reviewer` terminate `human_required` with `task_write_state: rejected`."
- `docs/DECISIONS.md` (D-020): "`StatusDocument.review_chain` is present from `policy_resolved`
  onward." — the ordering constraint D5 answers.
- `src/core/contracts.ts:90`: `TaskWriteState = "not_authorized" | "skipped_human_gate" | "written" |
  "rejected"` — no value means "not attempted", which is why D7 chooses between `rejected` and `null`
  rather than adding one.
- `src/core/contracts.ts:3` and `:173`: `export const REVIEW_KIND = "plan" as const;` and
  `review_kind: typeof REVIEW_KIND;` — a review kind other than `plan` is not merely absent from the
  shipped paths, it is unrepresentable in a status document, which is why D1 can call the kind guard
  unreachable rather than merely unused.
- `tests/review.test.ts:478-483`: `assert.doesNotMatch(review, /review_kind:\s*"implementation"/)` —
  the existing pin that no second review kind reaches this seam.
- `src/mcp/session.ts:140` and `src/cli/main.ts:366` both call `runReview`, so the check applies to
  the MCP surface and the CLI without a second implementation.
- Run `run-7f0ce6c2-7348-4217-a4a8-732896658285` on this task: `state: failed`, `verdict: null`,
  `reason_code: adapter_error`, `task_write_state: null`, `adapter_failure: { phase: "collect", cause:
  "output_unparsable", exit_code: 0, stderr_bytes: 0, stderr_log: null, payload_log:
  "adapter-payload.log" }`, `review_chain: { after_run_id: run-1badf7fe-…, cycle: 2, max_cycles: 3,
  refused: null }`. Its events are `run_requested`, `policy_resolved`, `review_started`, `run_terminal`
  — the reviewer ran and produced output that carried no verdict.
- The whole of that run's retained payload, 308 bytes at
  `.spartan-bridge/runs/run-7f0ce6c2-…/adapter-payload.log`, is this and nothing else: "I'll review
  only `task.md` and `AGENTS.md` as specified, without inspecting any other path.The decisions are
  internally consistent; the cycle-1 kind-guard contradiction is resolved by making a non-plan
  `review_kind` unrepresentable. The D1/D2 criteria still do not pin the early seam to that shared
  function." No verdict line, no findings block, no `Bridge run:` line — which is why the run failed
  `output_unparsable` rather than losing a verdict to trailing prose, the case task `0021` closed.
- `tests/doctor.test.ts:178-188`, the idiom the new D2 criterion follows: `test("doctor calls
  parseAgentsPolicy and contains no policy parsing of its own", …)` reads `src/core/doctor.ts` as text,
  `assert.match(source, /parseAgentsPolicy/)`, then eight `assert.doesNotMatch` rows naming the rules
  that must not have been copied.
- `tests/frontmatter.test.ts:65-67` is the second precedent for asserting over a source file:
  `assert.equal(source.includes("PROTOCOL_VERSION"), false)`.
- `src/core/doctor.ts:164-175`, the precedent that decides D2's pass-through: `if (parsed.detail.check
  === "agent_hosts_section_missing") { return { configured: false, resolves: false, reason:
  parsed.reason, message: parsed.detail.message }; }` — a literal written to choose a branch, and the
  reason reported exactly as the callee returned it. `grep -n "agent_hosts_section_missing"
  tests/doctor.test.ts` returns only fixture rows at `:91` and `:155`, never a `doesNotMatch`, so that
  test does not forbid the name the file reports on.
- `src/core/contracts.ts:81-82`: `"transition_review_kind_refused"` and
  `"transition_next_role_not_reviewer"` are members of the reason-code union, so a returned reason
  reaches `terminate` without the seam restating it.
- `grep -n '"reviewer"\|transition_next_role_not_reviewer\|transition_review_kind_refused'
  src/core/review.ts` returns nothing on the current build, so the two absence assertions the new D2
  criterion adds start out true and can only be broken by an inlined copy.
- `src/policy/task-frontmatter.ts:38-46`: `const ROLES = new Set(["human-operator", "investigator",
  "planner", "implementer", "reviewer", "independent-reviewer", "verifier"]);` — the seven values a
  `next_role` can hold, and the set the seam-level test crosses. `ROLES` is not exported today, so that
  test either enumerates the seven or the change exports the set; the criterion pins the coverage, not
  which.
- Run `run-2c34c65a-d206-46a9-9834-a93146e2d8f8` on this task, the second failure of the same shape:
  `state: failed`, `verdict: null`, `reason_code: adapter_error`, `adapter_failure: { phase: "collect",
  cause: "output_unparsable", exit_code: 0, stderr_bytes: 0, stderr_log: null }`, `review_chain: {
  after_run_id: run-1badf7fe-…, cycle: 2, max_cycles: 3 }`, took 2m45s against cycle 1's 2m59s, so it is
  not a deadline.
- The whole of that run's retained payload, 268 bytes, is this and nothing else: "I'll review only
  `task.md` and `AGENTS.md` as specified, then return the structured JSON verdict.The plan is internally
  consistent: D1 settles the kind-guard contradiction by unrepresentability, D5–D7 hold, and the D2 pins
  match the decisions. Final verdict follows." No verdict object follows it, and no truncation marker is
  present, so this is the complete final text and not a capped one.
- Both retained payloads open with the same sentence task `0021` captured by hand — "I'll review only
  task.md and AGENTS.md as specified" — concatenated to the next sentence with no separator, which is
  the shape that task recorded for `result.result`. The difference is that the object task `0021`
  recovered is absent here rather than misparsed, so this is not that failure returning.
- Checks run this round: `npm run typecheck` and `npm test`, both exit 0 against an unmodified `src/`
  and `tests/` — this round edited only this task artifact.
- Implementer checks, 2026-08-20: `npm run typecheck` exit 0; `npm test` 176 passed, 0 failed. The
  existing ungated path `tests/review.test.ts:69` and `tests/task-write.test.ts:80` still pass; the
  invalidated late-refusal verdict assertion now expects `null`. New coverage:
  `planReviewTransitionPrecondition` in `src/core/task-write.ts`; early seam at
  `src/core/review.ts` after the chain stop; catalog stub and source-text pin in `tests/review.test.ts`;
  equivalence table in `tests/task-write.test.ts`; D5 chain cases in `tests/review-chain.test.ts`; D4
  sentence match in `tests/spbridge-skill.test.ts`.
- Reviewer checks, 2026-08-20: `npm run typecheck` exit 0; `npm test` exit 0 (176 passed, 0 failed);
  `git diff --check` exit 0. Manual inspection confirmed the adapter resolution follows the gated
  precondition and the chain stop, and that `decidePlanReviewTransition` calls the exported
  precondition.

## Review

<!-- spartan-bridge:review:begin -->
Verdict: CHANGES_REQUESTED

Findings:

- `KIND_GUARD_UNSETTLED` (error): D1 says the verdict-independent half — review kind and next_role — is checked before the adapter exists, and D2 says the early check calls that shared function and nothing else. The shared function refuses transition_review_kind_refused when the kind is not a plan review. D6's closed complete list of what changes, and the Constraints paragraph, only list runs whose next_role is not reviewer; the D1 criterion then requires every run whose next_role is reviewer to behave as the current build. Those cannot all be true on the shared runReview path quoted in Evidence: an implementation review with the grant and next_role: reviewer would either stop early (a change D6 does not list, and a contradiction of the D1 criterion) or skip the kind guard (a contradiction of D1/D2). Settle one: either the early seam invokes the function and D6 plus the D1 criterion account for early transition_review_kind_refused, or the early seam refuses only transition_next_role_not_reviewer and D1/D2 stop claiming the kind guard moves with it. Re-derive the affected criteria as a set.

Bridge run: run_id=run-1badf7fe-ecac-497f-a928-9084894c2512 execution_id=exec-98d06b85-9e8f-45a8-8fbf-386fc2431c71 review_kind=plan verdict=changes_requested reason_code=review_changes_requested host=cursor launcher=cursor-plan-reviewer-v1 model=cursor-grok-4.6-high-fast effort=none model_observed=declared_unobserved policy_digest=sha256:f86f80dd14e95d3612c0ccd72cfd9fa9c88077b82418a39aad6cdf7ffc8bcea7 task_hash=sha256:dd159fb8932d641d723e88f488266e11e5b7162a57003c25359173e33702d610 agents_hash=sha256:6ac71f6a5dbc3a482d294762c53056983e11ee7b5be2bc35ffc7ff963e34f280 timestamp=2026-08-20T08:58:04.195Z
<!-- spartan-bridge:review:end -->

### Plan review, manual round - recorded by the planner, not by the Bridge

Verdict: APPROVED

Cursor, cursor-grok-4.6-high-fast, effort none — the `reviewer.plan` binding,
in a fresh read-only session, reading only this artifact and `AGENTS.md`. The round was manual because
the Bridge could not deliver one: two consecutive chained runs, `run-7f0ce6c2-…` and `run-2c34c65a-…`,
both terminated `adapter_error` / `output_unparsable` with `exit_code: 0` and empty stderr, each
retaining a final text that judged the plan and never emitted the verdict object. The second ends
"Final verdict follows." and stops there. The manual prompt inverted the order, asking for the object
before any prose, and the reviewer returned it first.

The reviewer returned `pass` with `findings: []` and this summary:

> The plan is consistent as a set: every named criterion is a consequence of a named decision, the
> typecheck/test row is the permitted check-only exception, and D6's closed change-list does not
> undercount. D2 may require the seam to report the precondition's reason without spelling that reason:
> both refusal reasons share one terminate shape, so pass-through is implementable without branching,
> and it is what makes the source-text pin force use of the return value rather than a hardcoded code
> that would agree today. The two residual copies are acceptable — they are the known hole in a
> source-text pin, they are stated rather than claimed closed, and the seam-level derived-expectation
> test is the drift oracle when the rule admits another role; that is the right scope for this
> instrument, not a reason to drop it. D1 is right to keep passing the resolved kind as an
> implementation choice: a criterion no failing case can violate is not a criterion.

It answered every question `## Next Action` put to it. D6's three bullets are the complete set of runs
that change, and a chain stop is not a missing fourth because D5 places the seam after it. D5's
ordering is the only one that keeps D3's promise for runs that already stop on the chain. D7's
`rejected` with a null verdict is the only status shape that keeps D-017 literally true without a
second reason code. D6's second and third costs are the right price, because the artifact was not going
to receive a transition either way.

This verdict is recorded here by the planner with its provenance stated, rather than written by the
runtime, because no run produced a result for the runtime to validate. It is not a Bridge cycle and no
`Bridge run:` line accompanies it. The region above still holds cycle 1's `CHANGES_REQUESTED` as the
Bridge wrote it, and any later Bridge review overwrites that region.

The failure that forced this round is not this task's to fix. Two reproductions and their retained
payloads are recorded in Evidence.

### Implementation review - Codex, gpt-5.6-terra, effort high, OpenAI

Verdict: APPROVED

Findings:

- None. The implementation satisfies the approved acceptance criteria. The reviewer confirmed the
  shared precondition, grant gate, chain-first ordering, no-adapter early refusal, unchanged
  ungated path, status shape, producer guidance, and relevant automated coverage.

## Blockers

None.

## Next Action

None. The implementation review is approved and all acceptance criteria are satisfied.

## Next Handoff

No outstanding handoff; task completed.
