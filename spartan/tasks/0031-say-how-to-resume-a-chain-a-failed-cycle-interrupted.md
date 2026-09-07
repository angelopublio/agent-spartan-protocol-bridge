---
protocol: "1.0.0" # x-release-please-version
id: say-how-to-resume-a-chain-a-failed-cycle-interrupted
created_at: 2026-08-20
status: completed
phase: complete
task_type: implementation
risk: routine
current_role: implementer
next_role: none
updated_at: 2026-08-23
handoff_id: HX-021
next_handoff_id: none
---

# Say how to resume a chain a failed cycle interrupted

## Objective

When an accepted plan-review continuation terminates in `state: failed` without a verdict, the
terminal immediately names the findings run that the next `--after-run` must reference and says that
the interrupted attempt did not consume the chain's cycle limit. A `human_required` or `blocked` stop
continues to be answered only by its existing named gate and receives no recovery line. The operator
does not have to derive the failed-attempt chain facts from `resolveReviewChain`, guess the failed
run, or silently reset the budget with an unchained run.

## Context

The observed case remains the plan-review chain on task `0029`. Cycle 1 returned
`changes_requested`; after the planner revised the artifact, cycle 2
(`run-7f0ce6c2-7348-4217-a4a8-732896658285`) ended `adapter_error` /
`output_unparsable` with no verdict. Its `review_chain.after_run_id` was
`run-1badf7fe-ecac-497f-a928-9084894c2512`, the cycle-1 findings run. The failed run itself is not
chainable: current `resolveReviewChain` accepts only a parent whose verdict is
`changes_requested`, and derives the child cycle as `parent.cycle + 1`. Retrying from the recorded
parent therefore attempts cycle 2 again; the failed attempt did not advance the limit.

The product changed after this task was created. Commit `d02d0d5` made the public `review` command a
foreground successor entrypoint: after a plan pass it may run the mapped implementer and
implementation-review correction loop before returning. An implementation-review failure can carry
an `after_run_id`, but it is linked to a terminal producer-transition record, `/spbridge` expressly
does not continue implementation findings, and no transition-resume entrypoint ships. This task must
not imply that a plan-chain recovery command resumes that stopped transition. Commit `3b5f307`
changed only the Cursor reviewer/implementer model bindings and their tests; it did not change review
chain arithmetic or output contracts. Commit `406dc89` then added a closed, nullable
`producer_diagnostic` to new producer-transition status and terminal-event records. Historical
transition bytes remain unchanged, and the new field classifies a producer stop without adding a
transition-resume entrypoint or changing plan-review chain admission, arithmetic, or status output.

The recovery information is still present but not explained. `serializeStatus` emits
`review_chain.after_run_id`, `cycle`, `max_cycles`, and `refused`; the CLI's terminal line reports only
the terminal state and reason; and `/spbridge` reports a null-verdict reason and stops without a next
start. Task `0026` plans the README description but remains active, so that documentation is neither
shipped recovery output nor a substitute for saying the answer at failure time.

## Scope

- `src/cli/main.ts`: render one Bridge-owned recovery line on stderr immediately after the existing
  review terminal line when D1's complete eligibility predicate holds.
- `tests/cli.test.ts`: exact positive and negative coverage for the new line and unchanged stdout and
  terminal output.
- `tests/review-chain.test.ts`: construct the authoritative status cases and exercise the
  same-parent retry-admission behavior that justifies the recovery statement.

## Out of Scope

- `src/core/review.ts`, review-chain acceptance conditions, cycle arithmetic, reason codes, terminal
  states, and the `review_chain` record. They remain the authority this reporting change renders.
- Automatic retry, automatic resume, a transition-resume command, or recovery of the foreground
  implementation/implementation-review successor loop delivered by task `0039`.
- `agent-skill/skills/spbridge/SKILL.md`; the optional adapter continues to report the runtime's
  document and must not acquire a second copy of review-chain semantics.
- `src/mcp/`; MCP continues to return the machine-readable status document and gains no separate
  recovery presentation. Adapter presentation beyond direct CLI stderr remains unclaimed.
- `README.md`, still owned by active task `0026`, and `docs/DECISIONS.md`.
- A new reason code, refusal cause, status field, event field, command, or schema version.

## Constraints

- Existing review terminal lines stay byte-identical. The recovery statement is a separate whole
  stderr line, not a change to the timestamp/state/duration grammar settled by task `0023`.
- Stdout stays exactly one JSON status or transition document and is byte-identical for every existing
  case.
- The line uses only Bridge-owned literals and values already present in the returned status document.
  It prints no repository path, launcher command, credential, client output, or machine-specific
  detail.
- A null verdict remains a stop. Rendering a recovery instruction does not spawn, retry, or continue
  anything.

## Decisions

### D1 - Render only a failed attempt in an accepted plan-review chain

The recovery line is eligible only when all of these status facts hold together:

1. `review_kind` is `plan`;
2. `verdict` is `null`;
3. `review_chain` is non-null and both `review_chain.after_run_id` and `review_chain.cycle` are
   non-null, and `review_chain.refused` is `null`; and
4. `state` is `failed`.

This predicate distinguishes a failed continuation that passed chain admission and then terminated
without findings from statuses that lack an admitted parent/cycle record, statuses whose chain was
refused, verdict-bearing runs on their normal route, non-failed `human_required` or `blocked` stops,
implementation-review statuses, and producer-transition documents. Each excluded shape retains its
existing terminal or gate behavior. The line reads both the parent run id and retry cycle directly
from the returned `review_chain` record. It neither scans `.spartan-bridge/runs/` nor recomputes an
ancestor.

No `reason_code` allowlist is added. For every status that satisfies clauses 1-4, regardless of its
failure reason, the existing
terminal line immediately above the recovery line continues to name the exact failure reason, while
the new line states only two reason-independent chain facts: which accepted findings run remains the
parent and which numeric cycle another admitted attempt would occupy. It does not call the failure
transient or promise that an identical attempt will succeed; an operator must first remediate any
non-transient cause named by the terminal line, and normal admission checks still run again. The
eligibility predicate adds only clause 4's failed-state requirement beyond the review-kind,
null-verdict, and accepted-chain facts in clauses 1-3. The product presentation change is the D2
stderr line; reason codes, state mapping, and chain arithmetic stay unchanged.

The plan uses the following negative fixtures, classified by provenance. Runtime-emitted formatter
fixtures are: chained `changes_requested` statuses; chained `pass` statuses when automatic
implementation is absent or manual; non-failed `human_required` and `blocked` stops; pre-policy
`review_chain: null`; an unchained `{ after_run_id: null, cycle: 1, refused: null }`; a refused
`{ after_run_id: <parent>, cycle: null, refused: <cause> }` with `state: blocked` and `verdict: null`;
a failed implementation-review status; and a producer-transition document. Defensive formatter
fixtures are: failed statuses carrying accepted verdicts; a failed status with a parent but null cycle
and null refusal; and a failed status with a numeric cycle and non-null refusal. Accepted verdicts do
not map to `state: failed`, an admitted continuation has a numeric derived cycle, and a refused run has
a null cycle and blocked state. Composite clause 3 intentionally treats chain-record existence,
parent, cycle, and refusal as structurally related arms; its runtime and defensive cases cover those
arms without claiming independent predicates. This classification describes every negative fixture
specified below, not every terminal status the runtime can emit.

For the observed record, the line names
`run-1badf7fe-ecac-497f-a928-9084894c2512` and cycle 2. That statement is justified by current
`resolveReviewChain`: the named run has `changes_requested`, and a new child derives its cycle from
that parent's `cycle + 1`. Current admission also permits another child from that same parent after an
accepted child terminates without a verdict; the implementation must bind the recovery wording to a
review-chain test that exercises this complete retry, not only to a formatter fixture. The wording
calls the failed execution an "interrupted attempt", rather than calling all retries free, because the
operator must still deliberately start the retry and all normal admission checks run again.

### D2 - The host-neutral CLI stderr owns the statement

`src/cli/main.ts` is the one reporting surface. After writing the existing review terminal line, it
writes this separate line when D1 holds:

```text
resume plan review: --after-run <after_run_id> retries cycle <cycle>; interrupted attempt did not consume the limit
```

The literal `--after-run` is not prose invented by the formatter: it is the optional review flag
declared and parsed by `src/cli/parse.ts`. The recovery line is TTY-independent. Once D1 holds, the CLI
writes the same uncolored, unprefixed bytes after the terminal line whether or not `stderr.isTTY` is
true; TTY affects progress/ticker output, not whether the recovery instruction exists.

This is a guaranteed terminal surface for direct CLI operators at the moment the accepted attempt
stops. A `/spbridge` host invokes this same CLI and may expose its stderr through the host's command
UI, but this plan does not claim that every host relays those bytes in its final response; the skill's
portable contract remains the stdout status document. An MCP caller likewise receives the status
document and no separately promised recovery presentation. The CLI is chosen because it is the
host-neutral product interface and owns the existing terminal report, not because wrapper stderr
presentation is guaranteed. It preserves the machine-readable stdout document and task `0023`'s
existing terminal-line grammar. The optional skill is rejected because it would help only
skill-entered runs and would make a thin adapter restate runtime chain semantics. A
`verdict_not_chainable` refusal is rejected because it is visible only after the operator has already
supplied the wrong run; changing that refusal would also leave the original failure silent. No schema
field is added because the status already contains the authoritative id and cycle.

### D3 - Reporting changes; review behavior does not

The formatter is downstream of the completed runtime outcome. It does not call `runReview`, construct
review input, alter exit codes, or mutate persisted state. No reason code, state, verdict,
`review_chain` value, event, task write, or serialized stdout byte changes. The CLI still returns after
the null-verdict run, and `/spbridge` still treats that document as a stop.

### D4 - The new foreground implementation loop stays outside this recovery promise

Commit `d02d0d5` created a second kind of counted chain with different ownership. Implementation
findings and corrections remain inside one foreground producer transition; a terminal transition has
no shipped resume operation. Consequently D1 requires `review_kind: plan`. An implementation-review
status and a transition document produce no plan recovery line even if a nested review record has a
non-null `after_run_id`. Designing recovery for that stopped transition requires a separate decision
about locks, producer identity, approved hashes, and transition state, none of which this reporting
task changes. Task `0040`'s additive `producer_diagnostic` does not change that ownership boundary: a
producer-transition document still has neither a review-status `review_kind` nor a verdict, and a
non-null diagnostic must remain visible only through the existing transition terminal/status output,
without triggering D2's plan-review recovery line.

## Work Completed

- Implementer (Grok, grok-4.5, high), 2026-08-23: added `isPlanReviewRecoveryEligible` and
  `formatPlanReviewRecoveryLine` in `src/cli/main.ts`, wrote the recovery line immediately after
  the existing review terminal line, added CliIo `deps` injection for tests, and covered D1/D2
  formatter cases (including cycle-3, the full negative matrix, reason-independent terminal lines, and transition non-eligibility) plus the same-parent retry admission and CLI TTY/non-TTY stderr integration for cycles 2 and 3. Also pinned D4 transition stdout via serializeTransitionStatus and the main-equivalent transition write sequence without a recovery line.


- Fresh unchained planner revalidation after task `0040` integration (Codex, `gpt-5.6-sol`, effort
  high, OpenAI), 2026-08-23 UTC: inspected commit `406dc89` and the current transition contracts,
  serializer, guarded producer path, and coverage. Confirmed that the additive closed
  `producer_diagnostic` explains future producer stops but adds no transition-resume entrypoint and
  changes none of D1-D3's plan-review status facts. Re-derived D4 and its transition criterion so a
  non-null diagnostic is explicitly preserved without becoming eligible for the plan recovery line.
  Revalidated the remaining decisions and criteria unchanged, advanced the consumed `HX-017` high
  water mark to fresh proposal `HX-018`, and issued one Bridge-dispatched plan-review envelope. No
  product file was edited.
- Planner recovery after repeated automatic producer failure (Codex, `gpt-5.6-sol`, effort high,
  OpenAI), 2026-08-23 UTC: inspected plan-pass run
  `run-45b95a45-b19b-4ef5-8d85-c5001daff1bb`, its stopped successor
  `transition-3428d961-5a24-43e1-917c-5dccdaf08a52`, and the earlier stopped successor
  `transition-a98875b9-cfd6-42da-b8ad-93876d33969f`. Both producers acquired and released the writer
  lock, stopped `producer_failure` before any implementation review, and left no product edit. The
  retained transition records and then-current runtime collapsed producer start/wait exceptions and
  a nonzero child exit to the same reason without a persisted subtype or child stderr, so those
  historical failures had no more specific repository/runtime diagnosis. The externally permitted doctor
  preflight nevertheless reports every mapped binding available, and all repository checks pass.
  Preserved approved decisions D1-D4 unchanged and issued one fresh Bridge-dispatched plan-review
  envelope under the new human authorization. No product file was edited.
- Planner correction after final-chain plan-review cycle 1 (Codex, `gpt-5.6-sol`, effort high,
  OpenAI), 2026-08-23 UTC: accepted all findings from
  `run-8c219b61-b130-4241-8f80-ad6f14ecf63e`. Added reason-independent positive coverage using two
  sourced failure reasons, explicitly admitted the same-parent runtime test in Scope, and based the
  eligibility-predicate invariant on clauses 1-3 while keeping the D2 presentation change separate.
  No product file was edited.
- Final planner correction after focused chain exhaustion (Codex, `gpt-5.6-sol`, effort high,
  OpenAI), 2026-08-23 UTC: accepted both findings from
  `run-d5d06e1b-7177-43d5-869f-7f830e8da442` under the final human authorization. Folded refusal
  eligibility into composite D1 clause 3, replaced numeric/exhaustive runtime-status claims with a
  provenance classification limited to the fixtures this plan actually specifies, sourced the real
  refused-chain record and terminal mapping, and re-derived every affected criterion. No product file
  was edited.
- Planner correction after focused plan-review cycle 2 (Codex, `gpt-5.6-sol`, effort high, OpenAI),
  2026-08-23 UTC: accepted both findings from
  `run-e568bb0e-091b-49ea-a8d7-a08716eca7d9`. Sourced the full accepted-verdict mapping and the CLI
  path that renders a manual/absent-config pass status versus an automatic transition; cited the
  complete review-chain admission function as the proof that same-parent retry has no sibling check.
  No product file was edited.
- Planner correction after focused plan-review cycle 1 (Codex, `gpt-5.6-sol`, effort high, OpenAI),
  2026-08-23 UTC: accepted both findings from
  `run-d95eb1da-5246-4ac1-8665-f344db6ec45f`. Added reachable accepted-verdict chain statuses to
  D1's complete negative classification and coverage, while keeping the defensive fixtures for branch
  isolation; made the runtime chain test compare cycles through `review_chain` only. No product file
  was edited.
- Planner correction after exhausted recovery chain (Codex, `gpt-5.6-sol`, effort high, OpenAI),
  2026-08-23 UTC: accepted both findings from
  `run-3f185780-4b04-4f4c-a385-773b70062ed9` under a new human-authorized planner boundary. Folded
  chain-record existence and required child fields into composite D1 clause 3, re-derived every
  affected criterion and clause reference, and sourced the exact plan-review status paths for
  `transition_next_role_not_reviewer` and `reviewer_write_detected`. No product file was edited.
- Planner correction after recovery-chain plan-review cycle 2 (Codex, `gpt-5.6-sol`, effort high,
  OpenAI), 2026-08-23 UTC: accepted both findings from
  `run-4bbee93c-02c9-4b9b-9b3f-7252fc574542`. Re-derived the complete negative-fixture set into
  runtime-emitted and defensive shapes, split the two clause-4 halves accordingly, and sourced the
  Bridge-owned `review_kind` assignment and serialization path. No product file was edited.
- Planner correction after recovery-chain plan-review cycle 1 (Codex, `gpt-5.6-sol`, effort high,
  OpenAI), 2026-08-23 UTC: accepted all findings from
  `run-16b23918-cefc-49ff-91a6-75463283b3f6`. Narrowed the Objective to failed terminations, declared
  the clause-2 and then-separate refusal isolation fixtures defensive and unreachable by runtime
  construction, and
  assigned stderr ordering explicitly to `tests/cli.test.ts`. No product file was edited.
- Planner recovery after stopped automatic transition (Codex, `gpt-5.6-sol`, effort high, OpenAI),
  2026-08-23 UTC: accepted the human-authorized fresh retry after plan-pass run
  `run-3f1e615b-d786-4939-bd69-25f9a623b51e` entered automatic transition
  `transition-a98875b9-cfd6-42da-b8ad-93876d33969f` and its Cursor producer stopped
  `producer_failure` before any implementation review or product edit. Recorded the terminal
  transition, distinguished the earlier sandbox-limited doctor result from the successful externally
  permitted preflight, and regenerated a fresh Bridge-dispatched plan-review handoff. The same
  foreground process may retry the complete automatic successor chain after pass. Commit and push
  remain authorized only after final implementation approval and all required checks pass; manual
  Cursor and duplicate orchestration remain unauthorized. No product file was edited in this planner
  round.
- Planner correction after fresh Bridge plan-review cycle 1 (Codex, `gpt-5.6-sol`, effort high,
  OpenAI), 2026-08-23 UTC: accepted all findings from
  `run-6af715d0-867c-48e1-9a59-83568592c222`. Added the failed-state predicate (now D1 clause 4), explicitly kept
  `reason_code` unrestricted because the recovery line reports chain facts rather than cause
  remediation, re-derived every D1 fixture to hold the new clause eligible except its own negatives,
  named every retained status file, and placed MCP presentation outside D2's promise. No product file
  was edited.
- Fresh planner authorization round (Codex, `gpt-5.6-sol`, effort high, OpenAI), 2026-08-23 UTC:
  consumed the outstanding `HX-006` envelope; recorded the prior review runs as separate chains;
  closed the governance, handoff-scope, and date-basis findings from
  `run-1544f171-f9b6-4faf-918b-71ada10dd51c`; and regenerated one Bridge-dispatched plan-review
  handoff. The human authorized up to three fresh plan-review cycles and subsequently authorized the
  same foreground Bridge process to enter its mapped automatic implementer and implementation-review
  chain after a plan pass. Commit and push are authorized only as the final action after the entire
  task succeeds; skill reinstallation and parallel manual orchestration remain unauthorized. No
  product file was edited in this planner round.
- Planner correction for `D4_CLAUSE1_RECORD_UNSPECIFIED` (Codex, `gpt-5.6-sol`, effort high,
  OpenAI), 2026-08-23 UTC: accepted the finding from
  `run-c61d64ce-645f-4905-9fa1-086356076289`. Re-derived D4's acceptance criterion as a complete
  implementation-review status that isolates D1 clause 1 and a separate producer-transition
  document case. No product file was edited.
- Planner correction after Bridge plan-review cycle 3 (Codex, `gpt-5.6-sol`, effort high, OpenAI),
  2026-08-23 UTC: accepted the finding from
  `run-ad302553-1655-48eb-96ae-9fcb421ff401`. Re-derived D1's clause-2 negative criterion as two
  fully specified, otherwise-eligible plan-chain records so only the non-null verdict makes each case
  ineligible. No product file was edited.
- Planner correction after Bridge plan-review cycle 2 (Codex, `gpt-5.6-sol`, effort high, OpenAI),
  2026-08-23 UTC: accepted all findings from
  `run-dea312a8-7de6-4ca7-b912-c21c805afbae`. Bound the displayed `--after-run` literal to the actual
  review parser and help text, made TTY-independent rendering an explicit D2 decision, and fully
  specified both clause-4 negative records so each half is isolated. No product file was edited.
- Planner correction after Bridge plan-review cycle 1 (Codex, `gpt-5.6-sol`, effort high, OpenAI),
  2026-08-23 UTC: accepted all findings from
  `run-20820785-6938-42d0-bbfb-e1771121c357`. Split D1's negative coverage by predicate clause, added
  the complete same-parent/same-cycle retry assertion, and bounded D2's guaranteed reach to direct CLI
  stderr while leaving wrapper presentation explicitly unclaimed. No product file was edited.
- Planner (Codex, `gpt-5.6-sol`, effort high, OpenAI), 2026-08-22 UTC: accepted matching handoff
  `HX-001`; replanned against current `main`, `d02d0d5`, and `3b5f307`; settled D2 on CLI stderr;
  narrowed the promise to plan-review chains after task `0039`; refreshed the source references; and
  re-derived the acceptance criteria from D1-D4. No product file was edited.
- Original planner (Claude Code, `claude-opus-5`, effort high, Anthropic), 2026-08-20 UTC: created the task
  after observing the failed cycle on task `0029`. No product file was edited.

## Evidence

- `git show --no-ext-diff --stat --oneline d02d0d5` names the foreground automatic
  implementer/implementation-review implementation across the runtime, CLI, skill, policy, and tests.
  `src/core/transition.ts:265-318` now owns implementation-review dispatch, correction, and terminal
  transition recording; `src/core/transition.ts:762-792` starts that successor only after a plan pass.
- `git show --no-ext-diff 3b5f307 -- AGENTS.md tests/agents.test.ts` changes
  `reviewer.plan` to `claude-opus-5-thinking-high` and `implementer` to
  `claude-sonnet-5-thinking-high`; no runtime or output file changes in that commit.
- Current `src/core/review.ts:904-975` is the complete chain-admission path. It validates only the
  named parent, authority, kind/host/producer identity, agents hash, changed task hash, and cycle
  ceiling before returning `cycle: parent.cycle + 1`; it contains no sibling-uniqueness, existing-child,
  or attempt-count check. This is the direct source that another child of the same findings parent is
  admitted at the same cycle after a failed child, subject to the listed checks.
- Current `src/core/review.ts:916-955` routes every named admission failure through `refuseChain`;
  `src/core/review.ts:978-991` returns
  `{ after_run_id: <reference>, cycle: null, max_cycles: <limit>, refused: <cause> }` and stops the
  review as `blocked` / `chain_refused`. Because result acceptance has not run, the status retains
  `verdict: null`. `tests/review-chain.test.ts:195-218` pins this real refusal record and terminal
  mapping. The sourced runtime shape is one arm of composite D1 clause 3; the numeric-cycle refusal
  fixture remains defensive only to exercise its refusal arm while D1 clause 4 stays eligible.
- Current `src/core/review.ts:370-425` persists the admitted `review_chain` before later precondition,
  capability, and isolation stops; `:450-585` maps post-admission failures to their existing state and
  reason without a verdict; and `src/core/contracts.ts:389-403` maps accepted `human_required` and
  `blocked` verdicts to non-failed terminal states. This is the product input for D1 clause 4: render
  only `state: failed`, retain the preceding exact reason, and do not duplicate reason-code policy.
- Current `src/core/task-write.ts:153-163` returns
  `transition_next_role_not_reviewer` from the plan-review task-write precondition;
  `src/core/review.ts:370-390` first persists the admitted chain record and then terminates that
  precondition failure as a `human_required` plan-review status with `verdict: null`.
  `src/core/review.ts:522-540` terminates a detected reviewer worktree write as `blocked` /
  `reviewer_write_detected`, again with the already persisted admitted chain and `verdict: null`.
  `tests/review-chain.test.ts:488-514` pins the first exact cycle-2 status shape, while
  `tests/write-detect.test.ts:83-99` pins the second reason/state mapping. The `transition_` prefix in
  the first reason names the task-write transition precondition inside plan review; it is not a
  producer-transition document.
- Current `src/core/review.ts:270` assigns the policy-resolved `reviewKind` into the Bridge-owned
  status, and `src/core/serialize.ts:45-66` serializes that exact `status.review_kind` alongside the
  state, verdict, reason, and chain record. `tests/implementation-review.test.ts:565` pins
  `review_kind: implementation` on a chained implementation status; `tests/review-chain.test.ts:95-129`
  pins both the runtime unchained chain record and the pre-policy null-chain status. These are the
  sources for D1 clause 1, D4, and the runtime-shaped fixture classification.
- Current `src/core/contracts.ts:389-403` maps `pass` to `state: awaiting_implementer` /
  `review_passed` and `changes_requested` to `state: changes_requested` /
  `review_changes_requested`. `tests/transition.test.ts:170-185` proves an absent or manual automatic
  configuration returns the plan-pass status with `transition: null`; `src/cli/main.ts:433-440` then
  writes the review terminal line for that null-transition outcome and writes a transition document
  only when an automatic successor exists. Retained
  `.spartan-bridge/runs/run-dea312a8-7de6-4ca7-b912-c21c805afbae/status.json` supplies the chained
  `changes_requested` status, and
  `.spartan-bridge/runs/run-3f1e615b-d786-4939-bd69-25f9a623b51e/status.json` supplies the chained pass
  status that entered an automatic transition.
- Current `src/cli/main.ts:129-136` formats the existing review terminal line;
  `src/cli/main.ts:433-440` writes either a transition document or the review terminal line plus the
  serialized status. Current `src/core/serialize.ts:116-125` copies the four `review_chain` fields
  without interpretation.
- Current `src/cli/parse.ts:36-63` accepts `after-run` only for `review`, reads exactly
  `options.get("after-run")`, and returns it as `after_run`; `src/cli/parse.ts:161-166` publishes the
  same `--after-run <run-id>` token in `HELP_TEXT`. This parser token, not D2's prose alone, is the
  source for the recovery line's flag spelling.
- Current `agent-skill/skills/spbridge/SKILL.md:172-196` continues only plan
  `review_changes_requested` statuses and stops on null verdicts; `:239-248` prints no new start for a
  transition, implementation pass, or other null-verdict reason. This is why the skill is a consumer,
  not the recovery authority.
- `spartan/tasks/0023-say-when-the-run-started-and-how-long-it-took.md` records the settled terminal
  timestamp/state/duration grammar and byte-identical stdout constraint. A separate recovery line
  preserves both.
- `spartan/tasks/0026-describe-the-loop-the-readme-still-hides.md` is still `status: active` and plans
  the documentation form of failed-cycle recovery; current `README.md` contains no such recovery
  statement.
- Historical operational input from task `0029` is retained in
  `.spartan-bridge/runs/run-7f0ce6c2-7348-4217-a4a8-732896658285/status.json`: it records
  `state: failed`, `verdict: null`,
  `reason_code: adapter_error`, `adapter_failure.cause: output_unparsable`, and
  `review_chain: { after_run_id: run-1badf7fe-ecac-497f-a928-9084894c2512, cycle: 2,
  max_cycles: 3, refused: null }`;
  `.spartan-bridge/runs/run-1badf7fe-ecac-497f-a928-9084894c2512/status.json` records the named
  parent with `changes_requested`.
- The exact holding files
  `.spartan-bridge/runs/run-20820785-6938-42d0-bbfb-e1771121c357/status.json`,
  `.spartan-bridge/runs/run-dea312a8-7de6-4ca7-b912-c21c805afbae/status.json`,
  `.spartan-bridge/runs/run-ad302553-1655-48eb-96ae-9fcb421ff401/status.json`,
  `.spartan-bridge/runs/run-474acd13-f19a-427b-9113-d1f6b1562102/status.json`,
  `.spartan-bridge/runs/run-c61d64ce-645f-4905-9fa1-086356076289/status.json`, and
  `.spartan-bridge/runs/run-1544f171-f9b6-4faf-918b-71ada10dd51c/status.json` establish four distinct
  prior run groups, all dated 2026-08-23 UTC. The exhausted three-cycle chain is
  `run-20820785-6938-42d0-bbfb-e1771121c357` (cycle 1, no parent),
  `run-dea312a8-7de6-4ca7-b912-c21c805afbae` (cycle 2, parent `run-20820785...`), and
  `run-ad302553-1655-48eb-96ae-9fcb421ff401` (cycle 3, parent `run-dea312a8...`), each with
  `changes_requested`. Failed `run-474acd13-f19a-427b-9113-d1f6b1562102` is a separate unchained
  cycle-1 attempt with `verdict: null` / `result_schema_invalid`; it wrote no task state.
  `run-c61d64ce-645f-4905-9fa1-086356076289` began another unchained cycle at cycle 1 and returned
  `changes_requested`. No child of that run exists: the human-reported shell input placed
  `--after-run run-c61d64ce-645f-4905-9fa1-086356076289` on a second command line, so
  `run-1544f171-f9b6-4faf-918b-71ada10dd51c` instead began a separate unchained cycle 1 and stopped
  `human_required`; its status confirms `review_chain.after_run_id: null` and
  `task_write_state: skipped_human_gate`.
- Human authorization received in the current `/spbridge` session, recorded on the repository's UTC
  date basis: start a new planner round and up to three fresh plan-review cycles for task `0031`,
  limited to recording the earlier chains correctly, correcting `HX-006`, aligning the prompt with
  Next Action, and making dates consistent. A subsequent human instruction explicitly authorizes the
  same foreground Bridge process, after a plan-review pass, to start the mapped automatic implementer
  and implementation-review chain. Product edits are authorized only through that post-pass mapped
  chain. A final human instruction authorizes commit and push only if the complete task finishes
  successfully; skill reinstallation, another task, and duplicate/manual orchestration remain
  unauthorized.
- A sandbox-limited `spartan-bridge doctor --repo
  /path/to/agent-spartan-protocol-bridge`, 2026-08-23 UTC, exited 0 with
  `binding reviewer.plan: adapter available;
  launcher=cursor-plan-reviewer-v1`, `binding reviewer.implementation: adapter available;
  launcher=codex-plan-reviewer-v1`, and `binding implementer: adapter unavailable;
  reason=interface_unavailable`. Re-running that exact read-only command with the same externally
  permitted execution context used by the Bridge exited 0 and reported all three bindings available,
  including `binding implementer: adapter available; launcher=cursor-plan-reviewer-v1`. The external
  result is the applicable preflight for the new automatic attempt; the earlier result records the
  caller sandbox boundary rather than a persistent adapter outage.
- Planner checks, 2026-08-23 UTC: `git diff --check` exited 0; `git diff --name-only` named only this task
  artifact; `npm run typecheck` exited 0; `npm test` exited 0 with 335 passed and 0 failed.
- Bridge plan-review cycle 1, 2026-08-23 UTC: run
  `run-20820785-6938-42d0-bbfb-e1771121c357` returned `changes_requested` /
  `review_changes_requested` at cycle 1 of 3. The three persisted findings are addressed by the D1
  admission assertion, the clause-by-clause negative cases, and D2's narrowed reach claim.
- Bridge plan-review cycle 2, 2026-08-23 UTC: run
  `run-dea312a8-7de6-4ca7-b912-c21c805afbae` returned `changes_requested` /
  `review_changes_requested` at cycle 2 of 3. Its three findings are addressed by the parser-backed
  flag criterion, D2's TTY-independent decision, and fully specified clause-4 records.
- Bridge plan-review cycle 3, 2026-08-23 UTC: run
  `run-ad302553-1655-48eb-96ae-9fcb421ff401` returned `changes_requested` /
  `review_changes_requested` at cycle 3 of 3. Its finding is addressed by giving both non-null-verdict
  fixtures the same complete, otherwise-eligible chain record, isolating D1 clause 2.
- Planner correction checks, 2026-08-23 UTC: `git diff --check` exited 0; `git diff --name-only` named
  only this task artifact; `npm run typecheck` exited 0; `npm test` exited 0 with 335 passed and 0
  failed.
- Fresh Bridge plan-review cycle 1, 2026-08-23 UTC: status file
  `.spartan-bridge/runs/run-6af715d0-867c-48e1-9a59-83568592c222/status.json` records unchained
  cycle 1 of 3, `changes_requested`, `review_changes_requested`, and a successful task-artifact
  write. Its retained review file
  `.spartan-bridge/runs/run-6af715d0-867c-48e1-9a59-83568592c222/reviews/exec-32f6e02f-b8ae-4e1d-9220-b9f8cc2717a4.json`
  contains `D1_PREDICATE_IGNORES_STOP_CAUSE`, `EVIDENCE_RUN_RECORDS_UNSOURCED`, and
  `MCP_SURFACE_UNSTATED`; this correction addresses all three.
- Fresh Bridge plan-review cycle 2, 2026-08-23 UTC:
  `.spartan-bridge/runs/run-3f1e615b-d786-4939-bd69-25f9a623b51e/status.json` records parent
  `run-6af715d0-867c-48e1-9a59-83568592c222`, cycle 2 of 3, `pass` / `review_passed`, a successful
  task-artifact write, and approved task hash
  `sha256:be5397bef37e8e82517d6965fd48943cd7837f891d2a2f2da14ff028530882aa`.
  `.spartan-bridge/transitions/transition-a98875b9-cfd6-42da-b8ad-93876d33969f/status.json` records
  the automatic successor as `stopped` / `producer_failure`, with no current or linked implementation
  review run. Its `events.jsonl` records authorization, lock acquisition, producer start, and terminal
  stop; the released writer lock and `git diff --name-only` naming only this task artifact confirm that
  the stopped attempt left no product edit.
- Human retry authorization received in the current `/spbridge` session, 2026-08-23 UTC: record the
  stopped transition, create a fresh plan-review chain, and on pass let the same foreground Bridge
  process retry the complete automatic implementer and implementation-review chain. Product edits are
  authorized only through that mapped automatic chain; commit and push are authorized only after
  final approval; manual Cursor and duplicate Bridge orchestration are not authorized.
- Recovery planner checks, 2026-08-23 UTC: `git diff --check` exited 0; `git diff --name-only` named
  only this task artifact; `npm run typecheck` exited 0. The most recent unchanged-product full suite
  remains the recorded 335 passed and 0 failed result above.
- Recovery-chain plan-review cycle 1, 2026-08-23 UTC:
  `.spartan-bridge/runs/run-16b23918-cefc-49ff-91a6-75463283b3f6/status.json` records unchained
  cycle 1 of 3, `changes_requested`, `review_changes_requested`, and a successful task-artifact
  write. Its retained review file
  `.spartan-bridge/runs/run-16b23918-cefc-49ff-91a6-75463283b3f6/reviews/exec-cb4deaed-6278-4132-aa71-8d06b6e93f5d.json`
  contains `OBJECTIVE_TRIGGER_WIDER_THAN_D1`, `CLAUSE2_FIXTURE_UNREACHABLE`, and
  `CHAIN_TEST_ASSERTS_CLI_LINE`; this correction addresses all three.
- Recovery-chain plan-review cycle 2, 2026-08-23 UTC:
  `.spartan-bridge/runs/run-4bbee93c-02c9-4b9b-9b3f-7252fc574542/status.json` records parent
  `run-16b23918-cefc-49ff-91a6-75463283b3f6`, cycle 2 of 3, `changes_requested`,
  `review_changes_requested`, and a successful task-artifact write. Its retained review file
  `.spartan-bridge/runs/run-4bbee93c-02c9-4b9b-9b3f-7252fc574542/reviews/exec-070baaca-a4e4-447e-bd10-492737864700.json`
  contains `DEFENSIVE_FIXTURES_UNDERCOUNTED` and `REVIEW_KIND_FIELD_UNSOURCED`; this correction
  addresses both.
- Recovery-chain plan-review cycle 3, 2026-08-23 UTC:
  `.spartan-bridge/runs/run-3f185780-4b04-4f4c-a385-773b70062ed9/status.json` records parent
  `run-4bbee93c-02c9-4b9b-9b3f-7252fc574542`, cycle 3 of 3, `changes_requested`,
  `review_changes_requested`, and a successful task-artifact write. Its retained review file
  `.spartan-bridge/runs/run-3f185780-4b04-4f4c-a385-773b70062ed9/reviews/exec-344424a5-e114-48ec-9a71-7935366ce26c.json`
  contains `CLAUSE6_REASON_CODES_UNSOURCED` and `CLAUSE3_FIXTURE_NOT_ISOLATED`; this correction
  addresses both under the new explicit authorization for a fresh chain.
- Human authorization received after the exhausted recovery chain, 2026-08-23 UTC: start a new
  planner round and up to three fresh plan-review cycles limited to those two findings; on pass, let
  the same foreground Bridge process run the complete automatic successor chain. Product edits are
  authorized only through that chain; commit and push remain conditional on final approval; manual
  Cursor and duplicate orchestration remain unauthorized.
- Focused recovery planner checks, 2026-08-23 UTC: `git diff --check` exited 0;
  `git diff --name-only` named only this task artifact; `npm run typecheck` exited 0; and the externally
  permitted `spartan-bridge doctor` exited 0 with `reviewer.plan`, `implementer`, and
  `reviewer.implementation` all available.
- Focused plan-review cycle 1, 2026-08-23 UTC:
  `.spartan-bridge/runs/run-d95eb1da-5246-4ac1-8665-f344db6ec45f/status.json` records unchained cycle
  1 of 3, `changes_requested`, `review_changes_requested`, and a successful task-artifact write. Its
  retained review file
  `.spartan-bridge/runs/run-d95eb1da-5246-4ac1-8665-f344db6ec45f/reviews/exec-50d132af-00ca-4290-90a2-827c57506c13.json`
  confirms the two authorized focus findings are closed and adds
  `ACCEPTED_CHAIN_NEGATIVE_MISSING` and `CHAIN_TEST_CITES_CLI_OUTPUT`; this correction addresses both
  within the same D1 criterion set.
- Focused plan-review cycle 2, 2026-08-23 UTC:
  `.spartan-bridge/runs/run-e568bb0e-091b-49ea-a8d7-a08716eca7d9/status.json` records parent
  `run-d95eb1da-5246-4ac1-8665-f344db6ec45f`, cycle 2 of 3, `changes_requested`,
  `review_changes_requested`, and a successful task-artifact write. Its retained review file
  `.spartan-bridge/runs/run-e568bb0e-091b-49ea-a8d7-a08716eca7d9/reviews/exec-ab21b332-8a30-4e56-83e8-d457b7811df6.json`
  contains `ACCEPTED_CHAIN_STATES_UNSOURCED` and `SAME_PARENT_RETRY_UNSOURCED`; this correction
  addresses both.
- Focused plan-review cycle 3, 2026-08-23 UTC:
  `.spartan-bridge/runs/run-d5d06e1b-7177-43d5-869f-7f830e8da442/status.json` records parent
  `run-e568bb0e-091b-49ea-a8d7-a08716eca7d9`, cycle 3 of 3, `changes_requested`,
  `review_changes_requested`, and a successful task-artifact write. Its retained review file
  `.spartan-bridge/runs/run-d5d06e1b-7177-43d5-869f-7f830e8da442/reviews/exec-378462b5-68a9-41aa-8a52-c6d59ff7ed06.json`
  contains `REFUSAL_SHAPE_UNCLASSIFIED` and `D1_FOUR_CASES_UNDERCOUNT`; this final planner correction
  addresses both.
- Final human authorization received after the focused chain exhausted, 2026-08-23 UTC: run one last
  planner round and a fresh plan-review chain for those two findings; on pass, let the same foreground
  Bridge process run the complete automatic successor chain. Product edits are authorized only
  through that chain; commit and push remain conditional on final approval; manual Cursor and
  duplicate orchestration remain unauthorized.
- Final planner checks, 2026-08-23 UTC: `git diff --check` exited 0; `git diff --name-only` named only
  this task artifact; `npm run typecheck` exited 0; and the externally permitted
  `spartan-bridge doctor` exited 0 with all three mapped bindings available.
- Final-chain plan-review cycle 1, 2026-08-23 UTC:
  `.spartan-bridge/runs/run-8c219b61-b130-4241-8f80-ad6f14ecf63e/status.json` records an unchained
  cycle 1 of 3, `changes_requested`, `review_changes_requested`, and a successful task-artifact
  write. Its retained review file
  `.spartan-bridge/runs/run-8c219b61-b130-4241-8f80-ad6f14ecf63e/reviews/exec-1cf0aeb8-4fbb-4258-b23f-7175496221d8.json`
  confirms `REFUSAL_SHAPE_UNCLASSIFIED` and `D1_FOUR_CASES_UNDERCOUNT` are closed and records
  `REASON_CODE_INDEP_UNPINNED`, `CHAIN_TEST_SCOPE_MISMATCH`, and
  `COMPLETE_CHANGE_UNBASELINED`; this correction addresses all three.
- Final-chain cycle-1 correction checks, 2026-08-23 UTC: `git diff --check` exited 0;
  `git diff --name-only` named only this task artifact; and `npm run typecheck` exited 0.
- Repeated-producer recovery evidence, 2026-08-23 UTC:
  `.spartan-bridge/runs/run-45b95a45-b19b-4ef5-8d85-c5001daff1bb/status.json` records cycle 2 of 3,
  `pass` / `review_passed`, `state: awaiting_implementer`, and successful task-artifact write.
  `.spartan-bridge/transitions/transition-3428d961-5a24-43e1-917c-5dccdaf08a52/status.json` records its
  automatic successor as `stopped` / `producer_failure`, with `current_review_run_id: null` and no
  linked review runs; its four events are authorization, lock acquisition, producer start, and
  terminal stop. The earlier
  `.spartan-bridge/transitions/transition-a98875b9-cfd6-42da-b8ad-93876d33969f/status.json` and
  `events.jsonl` record the same terminal shape and event sequence after plan-pass run
  `run-3f1e615b-d786-4939-bd69-25f9a623b51e`. `.spartan-bridge/locks/writer.lock` is absent and
  `git diff --name-only` names only this task artifact, establishing lock release and no product edit
  after either attempt.
- Commit `406dc89` preserves the collapsed `producer_failure` reason but now records a closed
  `producer_diagnostic` at the write-scope-lock, spawn, wait, and nonzero/null-exit boundaries in
  `src/core/transition.ts`; `src/core/serialize.ts` emits only its six allowlisted scalar fields.
  `parseTransitionStatusJson` normalizes a missing historical field to `null`, while the contained
  transition read commands return old stored bytes unchanged. The two earlier terminal records
  therefore still do not support a more specific root-cause claim, but a future producer terminal
  failure will persist its available safe classification without captured child output.
- New-chain preflight and planner checks, 2026-08-23 UTC: externally permitted
  `spartan-bridge doctor --repo /path/to/agent-spartan-protocol-bridge`
  exited 0 with `reviewer.plan`, `implementer`, and `reviewer.implementation` all `adapter available`;
  `git diff --check` exited 0; `git diff --name-only` named only this task artifact;
  `npm run typecheck` exited 0; and `npm test` exited 0 with 335 passed and 0 failed. This proves the
  mapped interfaces and current repository baseline are valid, but does not erase the two opaque
  producer failures or claim that a third producer execution must succeed.
- Human retry authorization received in this fresh unchained `/spbridge` planner session,
  2026-08-23 UTC: run one new planner round and one fresh plan-review chain; after pass and valid
  implementer preflight, let the same foreground Bridge process run the complete automatic
  implementer and implementation-review chain. Commit and push are authorized only after final
  implementation approval and all checks pass. Manual Cursor, duplicate Bridge orchestration,
  another task, and any start after another terminal producer failure remain unauthorized.
- Post-0040 revalidation checks, 2026-08-23 UTC: `spartan-bridge doctor --repo
  /path/to/agent-spartan-protocol-bridge` exited 0 with `reviewer.plan`,
  `implementer`, and `reviewer.implementation` all `adapter available`; `npm run typecheck` exited 0;
  the first `npm test` attempt ended in a Node 24 native callback assertion in the isolated
  `tests/workspace.test.ts` process after 322 of 323 reported tests passed, then the focused
  `tests/workspace.test.ts` run exited 0 and one complete `npm test` rerun exited 0 with 343 passed and
  0 failed. Final `git diff --check` exited 0 and `git diff --name-only` named only this task artifact.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-876e541c-7e21-4568-8d2a-8f1193b08e08 execution_id=exec-28f83ec5-1606-430b-949b-b6e32fa38db9 review_kind=plan verdict=pass reason_code=review_passed host=cursor launcher=cursor-plan-reviewer-v1 model=claude-opus-5-thinking-high effort=high model_observed=declared_unobserved policy_digest=sha256:a8967d0223248cdf2b22e43b163d2f2aa62b3a00d6109b6faa62176414176deb task_hash=sha256:65859bcd712a702bfd2a2522e685cc730c8e156053a406bab5c137e7b18ca1d7 agents_hash=sha256:993d2e8f8e3148e42f6c99e390452879b7bb0a9d36f79b43138fd2659cf308e0 timestamp=2026-08-23T10:55:21.060Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-890e3716-f1c7-46d2-9564-c7565164807b execution_id=exec-f7ccab3a-2df0-4739-81fe-e9b657157c19 review_kind=implementation verdict=pass reason_code=review_passed host=grok launcher=grok-plan-reviewer-v1 model=grok-4.5 effort=high model_observed=declared_unobserved policy_digest=sha256:d690b4307d9d8413f4be8daf675a265e5318b5e18c29837967b091ebb339ae77 task_hash=sha256:5e8426491202e534b980c87ddca8a46edb01abe51140c2f78dcefd5b200fd158 agents_hash=sha256:9af32d846dec4bf17b1a71accdfbb4e7d61376d408469dd318dfdbfc3c0070b8 timestamp=2026-08-23T14:11:10.819Z
<!-- spartan-bridge:review:implementation:end -->

PENDING

## Blockers

None.

## Next Action

None. Task completed: failed plan-chain attempts now print the recovery line naming the parent `--after-run` and retry cycle.


## Acceptance Criteria

- [x] D1: a status with `review_kind: plan`, `state: failed`, `verdict: null`, and
      `review_chain: { after_run_id: <distinct parent>, cycle: 2, max_cycles: 3, refused: null }`
      produces a recovery line that copies that exact parent id and cycle 2. A second otherwise
      identical case at cycle 3 proves the output is read from the returned record rather than fixed
      to the observed example.
- [x] D1: two statuses with identical eligible values for D1 clauses 1-4 and the same parent and cycle
      differ only in their failure information: one uses `reason_code: adapter_error` with
      `adapter_failure.cause: output_unparsable`, sourced from retained
      `run-7f0ce6c2-7348-4217-a4a8-732896658285`, and the other uses
      `reason_code: result_schema_invalid`, sourced from retained
      `run-474acd13-f19a-427b-9113-d1f6b1562102`. Both produce the same byte-identical recovery line,
      while each immediately preceding terminal line reports its own exact `reason_code`; a
      reason-code allowlist therefore fails the test.
- [x] D1: `tests/review-chain.test.ts` starts an accepted plan continuation whose reviewer terminates
      after start with `state: failed`, `verdict: null`, and a named failure reason, then starts a fresh
      continuation from that failed status's recorded `review_chain.after_run_id`; the retry is
      admitted with `refused: null` and the same numeric cycle recorded in the failed status's
      `review_chain.cycle`.
- [x] D1: no recovery line is produced for runtime-emitted chained plan fixtures with respectively
      `state: changes_requested`, `verdict: changes_requested` and `state: awaiting_implementer`,
      `verdict: pass`, when both carry
      `review_chain: { after_run_id: <parent>, cycle: 2, max_cycles: 3, refused: null }`; the existing
      review terminal output remains byte-identical for the correction route and for the pass route
      under absent or manual automatic-implementation configuration. Automatic pass is separately
      covered by D4's transition-document case. These cases pin reachable behavior without claiming
      predicate isolation; the defensive clause-2 fixtures below isolate the verdict branch.
- [x] D1: no recovery line is produced for either of two runtime-shaped plan fixtures with respectively
      `state: human_required`, `reason_code: transition_next_role_not_reviewer` and `state: blocked`,
      `reason_code: reviewer_write_detected`, when both otherwise have `verdict: null` and
      `review_chain: { after_run_id: <parent>, cycle: 2, max_cycles: 3, refused: null }`; these exercise
      predicate clause 4 while clauses 1-3 remain eligible.
- [x] D1: no recovery line is produced for a runtime-emitted fixture matching the pre-policy failure
      shape `review_kind: plan`, `state: failed`, `verdict: null`, and `review_chain: null`, exercising
      the missing-record arm of composite predicate clause 3 while clauses 1, 2, and 4 remain eligible.
- [x] D1: no recovery line is produced for a runtime-emitted unchained fixture with
      `review_kind: plan`, `state: failed`, `verdict: null`, and
      `{ after_run_id: null, cycle: 1, max_cycles: 3, refused: null }`, exercising the missing-parent
      arm of composite predicate clause 3 while clauses 1, 2, and 4 remain eligible.
- [x] D1: no recovery line is produced for the runtime-emitted refused status with
      `review_kind: plan`, `state: blocked`, `verdict: null`, `reason_code: chain_refused`, and
      `review_chain: { after_run_id: <parent>, cycle: null, max_cycles: 3, refused: "verdict_not_chainable" }`.
      This case covers the real refused-record arm of composite clause 3 together with the non-failed
      state gate; it does not claim the two are independently reachable.
- [x] D1: no recovery line is produced for a defensive formatter fixture with `review_kind: plan`,
      `state: failed`, `verdict: null`, and
      `{ after_run_id: <parent>, cycle: null, max_cycles: 3, refused: null }`, exercising the
      missing-cycle arm of composite predicate clause 3 while clauses 1, 2, and 4 remain eligible
      without claiming the runtime emits this combination.
- [x] D1: no recovery line is produced for a defensive formatter fixture with `review_kind: plan`,
      `state: failed`, `verdict: null`, and
      `{ after_run_id: <parent>, cycle: 2, max_cycles: 3, refused: "verdict_not_chainable" }`,
      exercising the refusal arm of composite predicate clause 3 while clauses 1, 2, and 4 remain
      eligible without claiming the runtime emits a numeric cycle on refusal. Together the chain-null,
      missing-parent, real-refusal, missing-cycle, and defensive numeric-refusal cases cover the
      structurally related arms of clause 3 without claiming independent runtime reachability.
- [x] D1: no recovery line is produced for either of two defensive formatter fixtures with
      `review_kind: plan`, `state: failed`, a verdict of respectively `pass` and
      `changes_requested`, and in both cases
      `review_chain: { after_run_id: <parent>, cycle: 2, max_cycles: 3, refused: null }`, exercising
      predicate clause 2 while clauses 1, 3, and 4 remain eligible.
- [x] D2: `tests/cli.test.ts` asserts that on both TTY and non-TTY stderr the eligible failed status
      writes the byte-identical existing terminal line with its exact `reason_code`, immediately
      followed by the exact D2 recovery line as one whole newline-terminated line; the recovery line
      contains no absolute path, client output, launcher detail, or shell-composed command.
- [x] D2: one test passes the same distinct parent through
      `parseArgv(["review", "--repo", <repo>, "--task", <task>, "--after-run", <parent>])`, asserts a
      `review` result with `after_run: <parent>`, and asserts that the recovery line contains exactly
      `--after-run <parent>`; a parser mutation to another flag spelling therefore fails the test.
- [x] D2: captured stdout for the eligible failure is byte-identical to `serializeStatus(status)` and
      remains exactly one JSON document; status key order and the serialized `review_chain` shape do
      not change.
- [x] D3: existing tests continue to assert the same exit code, terminal state, reason code, verdict,
      task write, events, and `review_chain` values for accepted-chain adapter failure, and no test or
      implementation path observes a second review invocation.
- [x] D4: no plan recovery line is produced for a runtime-shaped implementation-review status with
      `review_kind: implementation`, `state: failed`, `verdict: null`, and
      `review_chain: { after_run_id: <parent>, cycle: 2, max_cycles: 3, refused: null }`, exercising
      D1 predicate clause 1 while clauses 2-4 remain eligible.
- [x] D4: no plan recovery line is produced for a runtime producer-transition document carrying a
      non-null task-0040 `producer_diagnostic`; its existing transition terminal line and serialized
      transition stdout retain that diagnostic unchanged. This is a separate case because the
      document has no review-status `review_kind` or `verdict` to make eligible.
- [x] `npm run typecheck` and `npm test` exit 0.

## Next Handoff

No outstanding handoff. Task completed.
