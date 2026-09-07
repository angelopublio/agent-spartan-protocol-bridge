---
protocol: "1.1.0" # x-release-please-version
id: refuse-an-unwritable-artifact-before-paying-for-the-review
created_at: 2026-08-29
status: completed
phase: done
task_type: implementation
risk: material
current_role: human-operator
next_role: none
updated_at: 2026-08-30
handoff_id: HX-007
next_handoff_id: none
---

# Refuse an unwritable artifact before paying for the review, and say which shape check failed

## Objective

When a `/spbridge` chain cannot end in a persisted verdict — the task artifact
is not in a shape `task_artifact_write` can persist into, or `reviewer.<kind>`
is bound to a host whose CLI cannot force structured output — the failure names
the specific cause. On the `/spbridge` chain the malformed-artifact case is
raised before the producer round runs (D2), and the ineligible-binding case is
caught by the skill's pre-producer `doctor` check with an `AGENTS.md` rebind
message (D6.1). On a direct `spartan-bridge review` invocation the shape causes
still reach `status.json` / `events.jsonl` and the pre-dispatch `reason_code`
detail as a named closed value (D3), and an ineligible binding additionally
gets one stderr fix line (D6.2). A run never does producer work, spawns a
reviewer, and then discards a valid verdict because `## Review` /
`## Next Handoff` was malformed or the reviewer binding was ineligible.

## Context

**It happened on 2026-08-29, on the consumer board task `0022`.** The
implementation review dispatched, authenticated, ran for 1m33s, and the
reviewer returned `changes_requested` with four findings. The runtime accepted
that result (`review_result_accepted`) and stored it under
`.spartan-bridge/runs/run-7b0b417c-.../reviews/`, then refused to persist it
into the artifact: `reason_code: task_artifact_write_rejected`,
`task_write_state: rejected`, terminal state `human_required`. The operator
recovered the verdict by hand.

**The cause was knowable before the reviewer started.** The artifact's
`## Next Handoff` section carried a manual handoff whose advisory block
("Recommended execution ...") was bare text, with only the prompt inside a
` ```text ` fence. `parseOutstandingHandoffSection` in `src/core/task-write.ts`
requires **both** the advisory and the prompt to be fenced with ` ```text `
(`body[2] === FENCE_OPEN_TEXT`). With the advisory unfenced the consumed
handoff `HX-007` could not be retracted, so `preservedAuthorizedBytes` saw a
delta outside the four it admits and rejected the whole write. The run had
already read and hashed that artifact during policy resolution; the section
shapes were inspectable then.

**Task `0029` fixed one precondition, not this class.** `0029` moved the
`transition_next_role_not_reviewer` check before adapter construction. It
explicitly scoped out "recovering a verdict that a refused write already
discarded" and did not generalise to the other post-write checks:
`parseOutstandingHandoffSection` (handoff retraction), the `## Review`
template-placeholder recognition (`applyTemplatePlaceholderCleanup` /
`TEMPLATE_PENDING_INTERIOR`), the allowlisted-frontmatter-delta check, and the
region splice. Any of those can still fail after a real reviewer has run.

**Task `0044` recorded a sibling instance.** Its plan review was rejected
because `## Review` held the full Spartan `task-template.md` placeholder prose
while the Bridge only clears the shorter `- None recorded.` form; the operator
shortened the section by hand and re-dispatched. That artifact-shape divergence
was left as "a separate concern". This task is that concern.

**The diagnostic is a single opaque constant.** `src/core/task-write.ts`
returns `WRITE_REJECTED = { ok: false, reason: "task_artifact_write_rejected" }`
from about ten distinct failure points with no discriminator. Diagnosing the
board incident required reading the source. The repository already has the
"say which failure occurred" pattern in tasks `0018` (adapter failure) and
`0040` (producer diagnostic); task-artifact writes have no equivalent.

**The reviewer-eligibility case is the same family.** Task `0047` added
`AdapterCapabilities.structured_output` and a `review.ts` refusal
(`reviewer_output_unconstrained`) for a `reviewer.*` binding whose CLI cannot
schema-constrain its output (today Cursor). But that refusal fires *after*
`/spbridge` has run its producer round, and it reaches the human only as a
`reason_code` in the terminal JSON. The `/spbridge` skill's own hard boundary
tells it not to inspect `AGENTS.md` — yet it already runs `spartan-bridge
doctor` at other points. A `doctor` line already reports
`binding reviewer.plan: adapter unavailable; reason=reviewer_output_unconstrained`.
The missing piece is the skill consulting that line before the producer round,
and the CLI printing a human fix line rather than only JSON.

## Scope

- `src/core/task-write.ts`: replace the single `WRITE_REJECTED` constant with
  `writeRejected(cause)` where `cause` is one of the eleven closed failure-class
  values enumerated in D3; each current `return` site maps to exactly one class
  (sites in a class share the value). Surface the cause on `status.json` /
  `events.jsonl` beside `task_write_state: rejected`, as a non-sensitive closed
  value only — never artifact bytes, a path, or prose.
- `src/core/review.ts`: before `deps.catalog.resolve` constructs the adapter,
  and after the `0029` `next_role` check, run a verdict-independent
  pre-write shape check that applies the same predicates the post-write path
  will (`parseOutstandingHandoffSection` for the outstanding
  `next_handoff_id`; the `## Review` section is in a recognised
  placeholder-or-region shape for the dispatched kind). On failure, terminate
  before spawning the reviewer with the matching named cause and
  `task_write_state` unset (no write was attempted, no cycle billed).
- Share one function between the pre-check and the post-write check so they
  cannot drift, mirroring how `0029` exposed the verdict-independent half of
  `decidePlanReviewTransition`.
- `agent-skill/skills/spbridge/SKILL.md` (D5): state that a `## Next Handoff`
  the Bridge will consume has the advisory and the prompt each in their own
  ` ```text ` fence, and that `## Review` is either the exact `Verdict: PENDING`
  / `Findings:` / `- None recorded.` placeholder or an existing marked region —
  no other prose. This is the only skill file in this repository; the portable
  Spartan skill and its `task-template.md` live under the agent-profiles skills
  home, not here (task `0035` removed `skills/spbridge/` and
  `tests/spbridge-package.test.ts` asserts it stays gone), so stating the same
  rules in that portable template is a manual follow-up outside this repo, not
  an in-scope edit.
- Retain the accepted-but-unwritten reviewer verdict recoverably when a
  post-write rejection still occurs despite the pre-check (defence in depth):
  a `review-verdict.json` in the run directory, pointer on the failure record,
  the way `adapter-payload.log` is retained for `output_unparsable`.
- `agent-skill/skills/spbridge/SKILL.md` (D6): a pre-producer-round `spartan-bridge doctor`
  check of the reviewer binding for the dispatched kind; stop before any
  producer work with an `AGENTS.md` rebind message on
  `reviewer_output_unconstrained`.
- `src/cli/*` (D6): one stderr line on a `reviewer_output_unconstrained`
  terminal status, naming the review kind and the `AGENTS.md` fix.
- `tests/*` (D7): a test asserting every registered adapter's
  `structured_output` matches whether its `*_HELP_TOKENS` carry a schema flag
  (`--json-schema` / `--output-schema`); the fake stub is exempt.
- `docs/DECISIONS.md`: one dated entry covering the named-cause enum, the
  pre-dispatch shape gate, the D6 early reviewer-binding check, and the D7
  capability/help-token invariant.
- `tests/review.test.ts`, `tests/task-write.test.ts`, `tests/cli.test.ts`,
  `tests/adapter.test.ts` (or the per-adapter suites), `tests/spbridge-*` and
  `tests/spartan-*` skill tests: the early refusal per cause, the shared-rule
  invariant, the unfenced-advisory case from the board incident, the `0044`
  placeholder case, the retained-verdict file, the D6 skill stop, the D6 CLI
  stderr line, and the D7 `structured_output` / help-token invariant.
- This task artifact.

## Out of Scope

- Relaxing `parseOutstandingHandoffSection`, the four-delta check, or the
  template-placeholder recogniser to accept more shapes. This task makes the
  Bridge fail early and legibly against the current contract, not looser.
- Auto-repairing a malformed artifact. The producer round owns the fix; the
  Bridge only refuses and says why.
- The `0029` `next_role` precondition and D-017's transition mapping.
- Adapter authentication and the Cursor credential-store selector (task `0045`);
  `output_unparsable` and the `structured_output` runtime refusal itself (task
  `0047`). D6 only surfaces `0047`'s already-shipped refusal earlier.
- Board repository content and its task `0022`.
- A standalone `spartan-bridge lint` subcommand. If the shared pre-check is
  cheap to expose that way it may be noted for a later task, but this task
  ships the in-run refusal, not a new command.
- Changing `reason_code` names already emitted for other stops.

## Constraints

- English artifact, decisions, docs, and skill text.
- The named cause is a closed non-secret enum value. It never carries artifact
  bytes, a line number, a path, a handoff id, or model/reviewer prose.
- The pre-dispatch check is verdict-independent and runs only under the
  `task_artifact_write` grant, after the chain stop and the `0029` check,
  before the adapter is constructed.
- A refusal before the reviewer starts creates no reviewer execution, spends
  no cycle, and writes no `task_write_state`.
- The pre-check and the post-write check call one shared function; a test
  pins that they agree.
- No change to what a well-formed artifact produces today.

## Acceptance Criteria

- [ ] (D1, D2) A task whose outstanding `## Next Handoff` has an unfenced
      advisory is refused before the adapter is constructed, with a named cause
      (`handoff_section_unretractable` or equivalent); no run directory
      `reviews/` entry is created and no cycle is billed.
- [ ] (D1, D2) A task whose `## Review` section is neither the exact
      placeholder nor a valid marked region for the dispatched kind is refused
      the same way with its own named cause.
- [ ] (D1) A well-formed artifact dispatches and writes exactly as it does
      today; an existing passing end-to-end test is unchanged in outcome.
- [ ] (D3) Every `WRITE_REJECTED` return in `src/core/task-write.ts` carries
      the D3 closed-enum value naming its failure class (sites in one class
      share a value); the site->class table is recorded in Work Completed;
      `status.json` and `events.jsonl` show the value
      beside `task_write_state: rejected`; no artifact bytes, path, id, or
      prose appear in that record.
- [ ] (D2) The pre-dispatch check and the post-write check invoke one shared
      function; a test fails if they diverge.
- [ ] (D4) When a post-write rejection still occurs, the accepted reviewer
      verdict is written to `review-verdict.json` in the run directory and a
      pointer appears on the failure record; the file is gitignored with the
      run directory and redaction-passed.
- [ ] (D5) `agent-skill/skills/spbridge/SKILL.md` states the `## Next Handoff`
      double-fence rule and the `## Review` placeholder-or-region rule; a
      `tests/spbridge-*` test asserts a `## Next Handoff` block shaped as the
      SKILL.md describes satisfies `parseOutstandingHandoffSection` for a
      canonical id, and an unfenced-advisory block does not.
- [ ] (D6) `agent-skill/skills/spbridge/SKILL.md` runs `spartan-bridge doctor` before the
      producer round and, when the binding line for the dispatched review kind
      reports `reviewer_output_unconstrained`, stops before any producer work
      with a message naming the binding and the `AGENTS.md` rebind to Codex,
      Grok, or Claude Code; a skill test covers the stop.
- [ ] (D6) `spartan-bridge review` terminating `blocked` /
      `reviewer_output_unconstrained` writes one stderr line naming the review
      kind and the `AGENTS.md` rebind, alongside the unchanged status JSON on
      stdout; a `tests/cli.test.ts` case covers it. No other terminal reason
      gains a message.
- [ ] (D7) One test (`tests/adapter.test.ts` or the per-adapter suites)
      asserts, for every registered non-fake adapter, that
      `capabilities().structured_output === true` iff its `*_HELP_TOKENS` list
      contains a known schema flag (`--json-schema` / `--output-schema`);
      Cursor, Codex, Grok, and Claude all pass today and a mis-declaring new
      adapter fails; the fake stub is exempt.
- [ ] (D3, D2, D6, D7) `docs/DECISIONS.md` has one dated entry covering the
      named-cause enum, the pre-dispatch shape gate, the D6 early
      reviewer-binding check, and the D7 capability/help-token invariant.
- [ ] (repository check) `npm run typecheck`, `npm test`, and `npm run build`
      outcomes are recorded on the artifact.

## Decisions

### D1 - Fail early against the current contract, do not loosen it

The Bridge keeps `parseOutstandingHandoffSection`, the four-delta check, and
the template-placeholder recogniser exactly as strict as they are. The change
is to apply the retraction and placeholder predicates once more, before the
adapter is constructed, so a certain-to-fail write never spawns a reviewer.
Loosening any recogniser is out of scope: it would weaken the guarantee that a
Bridge write changes only the four admitted deltas.

The four admitted deltas a granted `task_artifact_write` may make (D-034,
`preservedAuthorizedBytes`) are:

1. exactly one changed or inserted Bridge region of the dispatched review kind;
2. the `next_role` and `updated_at` source lines set to the D-033 mapping,
   plus the exact `next_handoff_id` value becoming `handoff_id` and
   `next_handoff_id` becoming `none` when the source `next_handoff_id` is an
   outstanding canonical `HX-NNN` (byte-identical identifier lines otherwise);
3. either the exact `## Next Handoff` retraction to the fixed consumed-notice
   section, or byte-identical handoff-section text when no outstanding proposal
   exists;
4. either the exact task-template `Verdict: PENDING` final-segment removal
   through the preserved next heading, or byte-identical human review text.

Every other frontmatter line, the other review kind's region, and every other
human-written segment stay byte-identical; parse or equality failure restores
the original. The pre-check (D2) applies the retraction and placeholder
predicates that gate deltas 3 and 4.

### D2 - One shared function, checked twice

The verdict-independent shape predicates live in one function that both
`src/core/review.ts` (pre-dispatch) and `src/core/task-write.ts` (post-write)
call. A test pins that a shape the pre-check passes is a shape the post-write
path also accepts for the same reason. This mirrors `0029`, which exposed the
verdict-independent half of `decidePlanReviewTransition` as a shared function.

### D3 - Named causes from a closed enum, non-sensitive

`WRITE_REJECTED` becomes `writeRejected(cause)` where `cause` is one value of
this closed set, each naming a failure *class*. Several `return` sites map to
one class and share its value (matching D2's shared-function design); the
implementer maps every current `WRITE_REJECTED` site to exactly one of these
and records the site->class table in Work Completed. As read on
`src/core/task-write.ts` at 2026-08-30 (11 return sites: lines ~107, 110, 113,
116, 122, 125, 137, 144, 244, 251, 259, 263), the classes are:

- `artifact_unreadable` - reading the on-disk task file failed (pre-write);
- `artifact_hash_stale` - the on-disk bytes no longer match the expected hash;
- `frontmatter_unparseable` - the pre-write frontmatter does not parse;
- `verdict_not_persistable` - the verdict is not `pass` / `changes_requested`;
- `review_region_unrenderable` - `renderRegion` returned `null` (a forbidden
  token in a finding, or the region byte cap);
- `timestamp_invalid` - the run timestamp did not yield a calendar date;
- `composition_failed` - the four-delta composition could not be built: the
  `## Next Handoff` is not retractable for the outstanding id, or the
  `## Review` placeholder / region is unrecognised, or the region splice failed
  (this is the class the board `0022` and `0044` incidents hit, and the one the
  D2 pre-check catches before dispatch);
- `atomic_write_failed` - the temp-write or rename failed;
- `post_write_unreadable` - re-reading the file after the write failed;
- `post_write_reparse_failed` - the written bytes do not parse as a task
  document;
- `authorized_bytes_changed` - the post-write source-text comparison found a
  delta outside the four admitted ones.

The value reaches `status.json` and the terminal event beside
`task_write_state: rejected`, and a pre-dispatch refusal's `reason_code`
detail. It is a closed enum value only - never artifact bytes, a path, a line,
a handoff id, or reviewer prose - following the `0040` producer diagnostic
discipline. The pre-check (D2) can only ever return `composition_failed`
(the sole class knowable without attempting the write); the post-write path
can return any class.

### D4 - Retain the accepted verdict when a write still fails (in scope)

In scope for this task, not deferred. A post-write rejection after a real review
is expected to be rare once D1/D2 move most causes earlier, but when it happens
the accepted reviewer result is written to `<run-dir>/review-verdict.json`, mode
`0600`, atomic, with a pointer on the failure record - the same shape as
`adapter-payload.log` for `output_unparsable`. The operator recovers the
judgement without paying for the review again.

### D5 - Skill text states the shapes producers must emit

`agent-skill/skills/spbridge/SKILL.md` — the only skill file in this repository
— states, in the words a producer round can pin: a `## Next Handoff` the Bridge
will consume puts the advisory and the prompt each in its own ` ```text `
fence; `## Review` is the exact `Verdict: PENDING` / `Findings:` /
`- None recorded.` placeholder or an existing marked region and nothing else.
`0029` added the adjacent `next_role` obligation to that same file. The
portable Spartan skill and `skills/spartan/assets/task-template.md` are not in
this repository (task `0035`), so restating these rules there is a manual
follow-up outside this task's write scope, not a repo edit.

### D6 - `/spbridge` and the CLI raise an ineligible reviewer binding early and legibly

Two additions, no new capability:

1. **`agent-skill/skills/spbridge/SKILL.md`**: before the producer round (step 2), the skill
   runs `spartan-bridge doctor --repo <workspace-root>` and reads only the
   binding line for the review kind it is about to dispatch
   (`reviewer.plan` for a plan artifact, `reviewer.implementation` for an
   implementation artifact). If that line reports
   `reviewer_output_unconstrained`, the skill stops before any producer work
   and prints: which binding, that its host's CLI has no structured-output
   flag, and that the fix is to rebind `reviewer.<kind>` in `AGENTS.md` to
   Codex, Grok, or Claude Code and re-run `/spbridge`. This narrows the skill's
   "do not inspect `AGENTS.md`" boundary by exactly one already-computed
   `doctor` fact, the same way it already reads a `doctor` binding line after a
   `review_passed`.
2. **`src/cli/*`**: when `review` terminates `blocked` /
   `reviewer_output_unconstrained`, the CLI writes one human line to stderr
   naming the review kind and the `AGENTS.md` rebind, in addition to the
   status JSON on stdout. No other terminal reason gains a message in this
   task.

Both are "stop early, say the fix" like D1-D5; neither changes the runtime
refusal `0047` already ships.

### D7 - A test pins that `structured_output: true` matches the help-token surface

`0047` makes every adapter declare `structured_output`, but nothing stops a
future adapter from declaring `true` while its CLI has no schema flag — the lie
would only surface later as `output_unparsable` failures. One test in
`tests/adapter.test.ts` (or the per-adapter suites) asserts, for every registered
adapter, that `capabilities().structured_output === true` **iff** the adapter's
`*_HELP_TOKENS` list contains a known schema flag (`--json-schema` or
`--output-schema`). Cursor (`false`, no flag) and Codex / Grok / Claude
(`true`, flag present) all satisfy it today; a new adapter that mis-declares
fails the test. The fake stub is exempt (it returns a valid object by
construction, not via a CLI). This is test-time defence, complementary to D6's
runtime and skill-time refusals.

## Work Completed

- Implementer (Cursor is the AGENTS.md binding; this round ran on Claude Code /
  claude-sonnet-5 by owner direction after the planner re-derivation),
  2026-08-30: built D1-D7 against the current tree.
  - **D3 named causes.** `src/core/task-write.ts`: `WRITE_REJECTED` is gone;
    `writeRejected(cause)` returns one of the eleven `TaskWriteRejectionCause`
    values (new closed enum in `contracts.ts`). `TaskWriteResult` splits the
    `task_artifact_write_rejected` arm (carries `cause`) from the two
    `transition_*` arms (unchanged). Site -> class table (current line numbers):

    | `writeTaskReviewRegion` / `commitTaskArtifactWrite` return site | cause |
    | --- | --- |
    | read on-disk task file failed | `artifact_unreadable` |
    | on-disk bytes != expected hash | `artifact_hash_stale` |
    | `renderRegion` returned null | `review_region_unrenderable` |
    | `parseTaskFrontmatter` threw | `frontmatter_unparseable` |
    | verdict not `pass` / `changes_requested` | `verdict_not_persistable` |
    | `calendarDateUtc` returned null | `timestamp_invalid` |
    | `composeTaskArtifactWrite` returned null | `composition_failed` |
    | temp write / rename threw | `atomic_write_failed` |
    | re-read after write failed | `post_write_unreadable` |
    | written bytes do not reparse | `post_write_reparse_failed` |
    | `preservedAuthorizedBytes` false | `authorized_bytes_changed` |

    The two `decideReviewTransition` failure returns keep
    `transition_review_kind_refused` / `transition_next_role_not_reviewer` (not
    write-rejections). `status.json` / `events.jsonl` gain
    `task_write_rejection_cause`; serializers validate it against the enum.
  - **D2 shared function.** `checkArtifactWriteShape(text, reviewKind)` in
    `task-write.ts` runs the verdict-independent probe-region sequence
    (`spliceRegion` -> `applyTemplatePlaceholderCleanup` ->
    `retractNextHandoffSection` for the outstanding id).
    `composeTaskArtifactWrite` calls it first, so the two paths cannot diverge;
    it can only ever return `composition_failed`.
  - **D1 pre-dispatch gate.** `src/core/review.ts` calls
    `checkArtifactWriteShape` under the `task_artifact_write` grant, after the
    `0029` `next_role` precondition and before `deps.catalog.resolve`. On
    failure it terminates `human_required` / `task_artifact_write_rejected`
    with the cause, `task_write_state` unset, no `reviews/` entry, no cycle.
  - **D4 retained verdict.** `writeReviewVerdictAtomic` in `runtime/store.ts`
    writes `<run-dir>/review-verdict.json` (mode 0600, atomic); `review.ts`
    calls it on a post-write rejection and records `review_verdict_log` on the
    status document. `.spartan-bridge/` is already gitignored.
  - **D5 skill shapes.** `agent-skill/skills/spbridge/SKILL.md` step 2 states
    the `## Next Handoff` double-fence rule and the `## Review`
    placeholder-or-region rule. The portable Spartan skill / task-template are
    not in this repo (task `0035`); restating the rules there is a manual
    follow-up recorded in D5.
  - **D6 early reviewer-binding surfacing.** SKILL.md step 2 runs
    `spartan-bridge doctor` before the producer round and stops on
    `reviewer_output_unconstrained` with an `AGENTS.md` rebind message; the
    hard-boundary bullet carves out that one `doctor` line.
    `src/cli/main.ts` writes one stderr line
    (`formatReviewerOutputUnconstrainedLine`) when `review` terminates
    `blocked` / `reviewer_output_unconstrained`; no other terminal reason
    gains a message.
  - **D7 invariant.** `tests/adapter.test.ts` asserts every registered
    non-fake adapter's `structured_output` matches whether its `*_HELP_TOKENS`
    carry `--json-schema` / `--output-schema`; the fake stub is exempt.
  - **D-048** added to `docs/DECISIONS.md`.
  - Tests: `tests/adapter.test.ts` (new), plus cases in `tests/task-write.test.ts`
    (D2 no-divergence, board `0022` unfenced-advisory pre-dispatch refusal,
    `0044` placeholder-prose, D3/D4 forbidden-token retained verdict),
    `tests/spbridge-skill.test.ts` (D5 text + shape gate, D6.1 stop), and
    `tests/cli.test.ts` (D6.2 stderr line + negative). Updated five existing
    key-order / behaviour tests for the two new status fields and the
    now-earlier `## Review`-shape refusal.
  - Checks: `npm run typecheck` clean; `npm run build` clean; `npm test`
    384 pass / 0 fail (was 372).
  - Frontmatter moved to `phase: reviewing`, `current_role: implementer`,
    `next_role: reviewer`; adopted HX-006, issued HX-007 for the
    implementation-review handoff.

- Planner correction (Claude Code / claude-sonnet-5, medium, Anthropic),
  2026-08-30: the implementer round stopped before any code because Scope, D5,
  and the D5 criterion still listed `skills/spartan/assets/task-template.md` and
  `skills/spbridge/SKILL.md` as in-scope files — neither exists in this
  repository (task `0035` removed `skills/spbridge/` and
  `tests/spbridge-package.test.ts` asserts it stays gone; the portable Spartan
  skill and its template live under the agent-profiles skills home). A prior
  cycle acknowledged this in prose but did not remove the paths. Fixed: every
  Scope bullet, D5, D6.1, and the D5 / D6 criteria now name
  `agent-skill/skills/spbridge/SKILL.md` — the only skill file in the repo and
  in the automatic write scope. D5's Spartan-template obligation is recorded as
  a manual follow-up outside this repo. Scope bullet 1 now points to D3's
  enumerated eleven classes instead of "for example". Artifact-only; no code.

- Owner override + planner (Claude Code / claude-sonnet-5, medium, Anthropic),
  2026-08-30: the plan-review chain reached `max_review_cycles` (3/3), all
  `changes_requested`, each verdict artifact-authoring precision on load-bearing
  "closed set" claims, never the D1-D7 substance (the cycle-3 reviewer summary
  calls the plan "mature and well-scoped"). The owner accepted the plan and
  moved to implementation after the cycle-3 findings were resolved in place:
  D1 now lists the four admitted deltas (D-034); D3 enumerates the eleven
  named failure classes and drops "distinct per site" for "each site carries
  its class value"; the D3 acceptance criterion and Scope match. No `src/` or
  test change; `npm test` 372 pass stands. Frontmatter moved to
  `task_type: implementation`, `next_role: implementer`, HX-006.

- Planner (Claude Code / claude-sonnet-5, medium, Anthropic), 2026-08-30:
  adopted the `claude-plan-reviewer-v1` verdict `CHANGES_REQUESTED`
  (run-4e5c84a0, cycle 2) and resolved all four findings.
  `OBJECTIVE_CLI_STDERR_UNBACKED`: rewrote the Objective's direct-CLI sentence
  to what D3 actually delivers (named closed value on `status.json` /
  `events.jsonl` and the pre-dispatch `reason_code` detail), with the stderr
  line kept as D6.2's `reviewer_output_unconstrained`-only addition; each
  clause now cites its decision. `CRITERIA_DONT_NAME_DECISIONS`: tagged every
  acceptance criterion with its originating decision (D1-D7), splitting the
  repository-check row out as its own `(repository check)` line.
  `AGENTSKILL_MIRROR_OUT_OF_SCOPE`: confirmed `agent-skill/` holds only
  `agent-skill/skills/spbridge/SKILL.md` (no task-template mirror); Scope and
  the D5 criterion now name that one in-scope mirror and state no
  template-mirror edit exists. `HANDOFF_ID_EQUALS_NEXT`: `handoff_id` and
  `next_handoff_id` no longer coincide (HX-004 adopted, HX-005 issued).
  Artifact-only edit; prior round's `typecheck` / `build` / `test` (372 pass)
  outcomes stand. Bridge continues the plan-review chain (cycle 3 of 3).

- Planner (Claude Code / claude-sonnet-5, medium, Anthropic), 2026-08-30:
  adopted the `claude-plan-reviewer-v1` verdict `CHANGES_REQUESTED`
  (run-e11cef36) and resolved both findings. `D7_NO_DERIVED_CRITERION`
  (warning): added a D7-derived acceptance criterion for the
  `structured_output` / help-token invariant test, aligned the
  `docs/DECISIONS.md` criterion to name the D7 invariant, and added
  `tests/adapter.test.ts` to the test-files Scope bullet.
  `OBJECTIVE_CLI_PATH_OVERCLAIM` (info): narrowed the Objective so the
  "before the producer round" claim is scoped to the `/spbridge` chain and
  the direct-CLI path is described as surfacing the same cause later but
  legibly via a stderr fix line. Artifact-only edit; no code touched, so the
  prior round's `typecheck` / `build` / `test` (372 pass) outcomes stand.
  Issued HX-004; Bridge continues the plan-review chain (cycle 2 of 3).

- Planner (Claude Code / claude-sonnet-5, medium, Anthropic), 2026-08-30:
  confirmed D1-D7 and the re-derived acceptance criteria against the current
  tree. `src/core/task-write.ts` still returns one opaque `WRITE_REJECTED`
  constant from ~12 sites (lines 107-263) and `parseOutstandingHandoffSection`
  still enforces the double `` ```text `` fence (body[2] and advisoryClose+2),
  so D1-D3/D5 hold. `src/core/review.ts:409-410` terminates `blocked` /
  `reviewer_output_unconstrained` only after adapter construction, so D6's
  early skill + CLI surfacing is still needed. All five real adapters declare
  `structured_output` with `codex`/`claude`/`grok` carrying a schema flag in
  `*_HELP_TOKENS` and `cursor` carrying none; `fake` returns `true` by
  construction (D7 exempt), so the D7 invariant is satisfiable today.
  Checks: `npm run typecheck` clean, `npm run build` clean, `npm test`
  372 pass / 0 fail. No plan change; adopted HX-002, issued HX-003 for the
  continuation envelope. Bridge dispatches the plan re-review through
  `claude-plan-reviewer-v1`.

- Planner (Claude Code / claude-sonnet-5, medium, Anthropic), 2026-08-30:
  folded the reviewer-eligibility case into this task at the owner's direction
  (D6 + Scope + criteria); resolved the prior review's three findings —
  shortened `## Review` to the exact placeholder
  (`REVIEW_PLACEHOLDER_NOT_EXACT`), made `## Next Action` state the frontmatter
  / envelope role split explicitly as the `AGENTS.md` Bridge convention
  (`NEXT_ROLE_ENVELOPE_MISMATCH`), and marked D4's retained-verdict file firmly
  in scope with the hedge removed (`D4_SCOPE_CONTRADICTION`). Adopted HX-001,
  issued HX-002 for the plan re-review through `claude-plan-reviewer-v1`.

- Planner (Claude Code / claude-sonnet-5, medium effort, Anthropic),
  2026-08-29: created this task from the board `0022` implementation-review
  write rejection. Traced the cause to `parseOutstandingHandoffSection`
  requiring a double-fenced `## Next Handoff` while the artifact had an
  unfenced advisory; confirmed `0029` fixed only the `next_role` precondition
  and `0044` recorded a sibling `## Review` placeholder instance left as "a
  separate concern"; confirmed `WRITE_REJECTED` is one opaque constant across
  ~10 sites. Wrote D1-D5. Classified planning / material.

## Evidence

- Board run `.spartan-bridge/runs/run-7b0b417c-a42a-4e74-8760-a0860595a391/
  status.json`: `verdict: changes_requested`, `reason_code:
  task_artifact_write_rejected`, `task_write_state: rejected`, `state:
  human_required`; `events.jsonl` shows `review_result_accepted` (seq 4) then
  `run_terminal` (seq 5).
- `src/core/task-write.ts`: `parseOutstandingHandoffSection` requires
  `body[1] === "" && body[2] === FENCE_OPEN_TEXT` and, after the advisory
  fence, `body[advisoryClose + 2] === FENCE_OPEN_TEXT` - both blocks fenced.
  `WRITE_REJECTED` is one constant returned from lines 107, 110, 116, 122,
  125, 137, 144, 244, 251, and more.
- `applyTemplatePlaceholderCleanup` matches only
  `TEMPLATE_PENDING_INTERIOR = ["Verdict: PENDING", "", "Findings:", "",
  "- None recorded."]`.
- Task `0029` (`completed`): early-refuses `transition_next_role_not_reviewer`
  before adapter construction; Out of Scope explicitly excludes "recovering a
  verdict that a refused write already discarded" and does not generalise to
  the other post-write checks.
- Task `0044` Work Completed: plan review rejected because `## Review` carried
  the full template placeholder prose; "Contract fix ... remains separate."
- The board `0022` `## Next Handoff` before the operator fix: advisory
  ("Recommended execution (human decides):" ...) as bare text directly under
  the heading, only the `Open ...` prompt inside a ` ```text ` fence.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: CHANGES_REQUESTED

Findings:

- `CLOSED_ENUM_NOT_ENUMERATED` (warning): The rejection-cause set is described as a "closed enum" but given only "for example" with six sample values (Scope bullet 1, D3), and Evidence lists the WRITE_REJECTED return sites as "lines 107, 110, 116, 122, 125, 137, 144, 244, 251, and more". AGENTS.md ('State an invariant positively... the complete list of what changes'; 'An Evidence row reproduces the input... so a later reader can re-run it') requires the full set. As written, an implementer cannot derive the complete enum, and acceptance criterion D3 ('Every WRITE_REJECTED return ... carries a distinct closed-enum cause') cannot be checked. Enumerate every current WRITE_REJECTED return site and the exact closed-enum value each maps to.
- `D3_DISTINCT_VS_SHARED_CAUSE` (warning): Acceptance criterion D3 states every WRITE_REJECTED return site carries a "distinct" cause, but Context and the D3 body group the ~12 sites into a handful of logical failure classes (handoff retraction, review placeholder/region recognition, allowlisted-frontmatter-delta, region splice, frontmatter reparse, authorized-bytes change), and D2 requires the pre-check and post-write path to agree on a cause for the same reason. Sites in one class should share a cause value, which "distinct per site" forbids. Reword so each site carries the closed-enum value naming its failure class (sites in the same class share a value), matching the shared-function design in D2.
- `FOUR_ADMITTED_DELTAS_UNLISTED` (info): The plan repeatedly relies on 'the four admitted deltas' a Bridge write may make (Context, D1) as the boundary the pre-check protects, but never lists the four. Since D2's shared shape function and the 'no change to what a well-formed artifact produces' constraint both hinge on that set, enumerate it once in Context or Constraints.

Bridge run: run_id=run-7be3e3cd-79be-4324-a323-d3725f1a7f24 execution_id=exec-fd976bee-2904-4fb2-a3d2-654a62e5a0fb review_kind=plan verdict=changes_requested reason_code=review_changes_requested host=claude launcher=claude-plan-reviewer-v1 model=claude-sonnet-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:20fcfa7c8df758f5b260cdddb5dfbf86c1d202fcecff22e1ed15e24e6cabf2e0 task_hash=sha256:4317bf1dd77b84051434d2686b083c876b746aa65d4b1b7460f9425b77882738 agents_hash=sha256:284421407f56483f3a539808d71c6196a279849f3f709e1752b653ec8a726999 timestamp=2026-08-30T15:58:45.263Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-6cd8f25f-f3c4-4dc1-91fe-d497d175ebbd execution_id=exec-754e6322-65b3-4d4e-b7c6-f5ebb7eda1ad review_kind=implementation verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-sonnet-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:1432cf4ad657ba8b32cb1751f04ef520e7ecebe5fcb14dec11a3dca63243ff05 task_hash=sha256:3999596620a315ebeef51cdc81f225c26c848235c4775187c7c9f57ae1eaa357 agents_hash=sha256:284421407f56483f3a539808d71c6196a279849f3f709e1752b653ec8a726999 timestamp=2026-08-30T17:30:05.629Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None.

## Next Action

None. Task completed 2026-08-30: plan owner-accepted after the 3-cycle limit
(substance approved), D1-D7 implemented, implementation review APPROVED on
cycle 1 with no findings (`run-6cd8f25f`). `npm run typecheck`, `npm run build`,
and `npm test` (384 pass / 0 fail) all clean. Shipped in commit `005eba3`;
the `AGENTS.md` path-verification rule that came out of the planner-correction
detour is `b535dbb`.

## Next Handoff

No outstanding handoff. The task is complete.
