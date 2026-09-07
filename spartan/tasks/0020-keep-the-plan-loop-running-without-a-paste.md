---
protocol: "1.0.0" # x-release-please-version
id: keep-the-plan-loop-running-without-a-paste
created_at: 2026-08-18
status: completed
phase: complete
task_type: implementation
risk: high-impact
current_role: reviewer
next_role: none
updated_at: 2026-08-19
handoff_id: HX-011
next_handoff_id: none
---

# Keep the plan loop running without a paste

## Objective

One human start carries a plan through review, revision, and re-review up to the authorized limit,
with no invocation pasted between cycles. The Bridge counts the cycles and refuses a chain it cannot
vouch for.

## Context

**The seam is one sentence in a skill, not a missing feature.** `skills/spbridge/SKILL.md` already
runs a producer round and then invokes `spartan-bridge review` once, so the planner-to-review
direction costs no paste today. Its step 6 then says "Do not start `/spartan` again", and step 7
prints a `/spbridge` invocation for the human to paste after revising. So the loop already works and
costs exactly one paste per cycle, at the return leg. That paste is what this task removes.

**The cycle limit is declared and never enforced.** `max_review_cycles` is parsed from `AGENTS.md`,
reaches `ResolvedPolicy`, and is serialized into the policy digest — and nothing ever compares it.
`tests/review.test.ts:477` pins that absence on purpose, in a test named "no review-cycle,
implementer-start, or implementation-review path is shipped". Each `spartan-bridge review` creates
an unrelated run; nothing links cycle 2 to cycle 1. Enforcing the limit is therefore not a side
effect of this task, it is the load-bearing half: an automatic loop without a counted bound is the
thing the authority sentence was written to prevent.

**The design is already the repository's own.** `docs/ROUTING-AND-WORKFLOWS.md` describes the plan
loop as "The producer conversation may remain open so the Bridge can return findings directly, but
the Bridge controls the attempt count." D-007 automates producer/reviewer loops and stops only
before planning-to-implementation. So the producer round that answers findings is the session that
is already open, and the Bridge's job is the count, not the spawn.

**What that rules out, and why it matters for cost.** The planner binding is Claude Code, and there
is no Claude adapter — `src/adapters/` holds `fake` and `cursor` only. A Bridge-started producer
would need a new write-capable adapter, host lifecycle, and worktree locks, which is exactly what
D-007 defers and what Phase 5 owns. Reading "the next producer round" as a Bridge-spawned process
turns a bounded slice into the largest capability jump in the project. It is read here as the open
session, and `AGENTS.md`'s "must stop before changing the producer role or producer host" then holds
trivially: neither changes.

**One precondition is already enforced and should not be re-invented.** D-017 refuses a
task-artifact write when the artifact's `next_role` is not `reviewer`. A second cycle therefore
cannot record findings unless the producer round set `next_role` back to `reviewer` — that is,
unless a producer round actually ran. The chain check in D3 adds the complementary fact (the
artifact changed) rather than restating this one.

**Owner priority.** The owner named this the step after task `0019` and put it ahead of the Board
verdict-vocabulary bug deliberately: removing themselves from the loop compounds across every later
round, including the rounds that fix that bug.

## Scope

- `AGENTS.md`: the automation-authority amendment settled in D4 — one new parsed grant sentence and
  the human-readable bullets around it.
- `src/policy/agents-policy.ts`: parse the optional grant into `producer_chain_authorized`, and add
  `producer_chain_grant` to the `AgentsPolicyCheck` union and to the completeness list its test
  enumerates.
- `src/core/contracts.ts`: `ResolvedPolicy.producer_chain_authorized`, a `review_chain`
  record on `StatusDocument`, its closed refusal vocabulary, and two reason codes.
- `src/core/review.ts`: accept the chain reference, validate it, compute the cycle, enforce the
  limit, and stop before starting a reviewer when either check fails.
- `src/core/serialize.ts`: `canonicalPolicyJson` and `serializeStatus`. Both enumerate their keys, so
  a field added to a type does not reach the digest or the status document by itself.
- `src/cli/parse.ts` and `src/cli/main.ts`: the `--after-run` option, the `ParsedCli` review variant,
  the option-count rule that currently rejects any third option, passing the value into `runReview`,
  and the help text.
- `skills/spbridge/SKILL.md`: the whole file, not only steps 5-7. Its frontmatter description, its
  "invoke once" lines, its hard-boundary rule against a second `/spartan` round, and step 4's flag and
  invocation rules all forbid the loop today.
- `docs/DECISIONS.md`: one entry. `docs/ROUTING-AND-WORKFLOWS.md`: the automation-authority example
  and the plan-loop section.
- Tests in the manner of the existing suite: policy parsing, chain acceptance and each refusal cause,
  the limit stop, exit codes, digest coverage, and the adoptability fixture. The suite's known pins to
  update are the two in `tests/serialize.test.ts`, the live status key order in
  `tests/task-write.test.ts`, the `AgentsPolicyCheck` completeness list in `tests/agents.test.ts`, the
  `HELP_TEXT` equality in `tests/cli.test.ts`, and the `max_review_cycles` assertion in
  `tests/review.test.ts`.

## Out of Scope

- Any Bridge-started producer process, and any Claude Code adapter. D1.
- The implementation loop, `reviewer.implementation`, and the planning-to-implementation transition.
  The three remaining assertions of `tests/review.test.ts:477` stay exactly as they are.
- `--run` on `review`. It stays forbidden, reserved for the Phase 3 resume-by-run-id work.
- The MCP path. `review` over MCP keeps its current input shape and single-run behaviour, as in
  task `0019`.
- Daemon, scheduling, retry, backoff, and worktree locks.
- Where multi-cycle review history is kept. The Bridge still rewrites one owned region, so cycle 1's
  findings are still replaced by cycle 2's. That is a real consequence of this task and it is a
  separate decision the owner has not settled; it is named in Blockers, not fixed here.
- The Board's verdict-vocabulary defect.

## Constraints

- A repository whose `AGENTS.md` does not carry the new sentence must behave exactly as it does
  today, including the adoptability fixtures from task `0015`. The grant is never required.
- No new authority for the Bridge to write anything it cannot write today. The chain changes who may
  *start* a review run, not what a run may touch.
- Every chained review still runs a fresh, read-only reviewer session with the existing isolation and
  write detection unchanged.
- The chain is explicit. No scan of `.spartan-bridge/runs/`, no per-task chain file, no "latest run"
  inference — `AGENTS.md` forbids acting on a vague latest handoff.
- Stdout stays one status JSON document per run. No progress, no chain narration on stdout.
- `SCHEMA_VERSION` stays `2` and `EventDocument` is unchanged, as in D-018.
- No shell interpolation, no new runtime dependency.
- The planner does not edit `AGENTS.md` in this round; `AGENTS.md` grants the planner planning
  artifacts only. D4 settles the text; the implementer applies it.

## Acceptance Criteria

- [x] An unchained run (`review --repo R --task T`) keeps the current build's outcome where this task
      changes nothing: same `state`, `verdict`, `reason_code`, `task_write_state`, and
      `artifact_hashes`, which are hashes of the inputs the run read. Against a pinned status document
      built with a fixed clock and fixed identifiers, its differences from the current build are
      exactly the three this task requires, and no others: `review_chain` added per D7's first row,
      `policy_digest` changed per D8, and — on a run that writes — `task_hash_after_write` changed,
      because the digest D8 alters is part of the bytes the Bridge puts in the review region.
- [x] With the grant absent from `AGENTS.md`, a run passing `--after-run` terminates
      `blocked` / `chain_refused` with cause `not_authorized`, and no reviewer process is
      started, asserted from an adapter that records whether it was invoked.
- [x] With the grant present and a valid reference, the run starts the reviewer normally and records
      `review_chain.cycle = 2` with `after_run_id` equal to the referenced run.
- [x] Each refusal cause — `run_unreadable`, `task_mismatch`, `verdict_not_chainable`,
      `agents_changed`, `task_unchanged` — has a test that terminates `blocked` /
      `chain_refused` with that cause and starts no reviewer.
- [x] A chained run that terminates without a verdict keeps the `review_chain` record it was accepted
      with, and a later run referencing it is refused with cause `verdict_not_chainable`, asserted
      from a stub adapter that fails after acceptance.
- [x] A request that would be cycle `max_review_cycles + 1` terminates
      `human_required` / `cycle_limit_reached` and starts no reviewer.
- [x] The limit comes from `AGENTS.md`: with `up to 1 review cycles`, the first chained request is
      refused at the limit; with `up to 3`, cycles 2 and 3 are accepted and cycle 4 is not.
- [x] Two `AGENTS.md` files differing only by the grant sentence produce different policy digests,
      and the pinned serialization in `tests/serialize.test.ts` is updated to the new document.
- [x] Two occurrences of the grant sentence fail parsing as `agents_policy_invalid`; zero occurrences
      parse `ok` with `producer_chain_authorized: false`.
- [x] The task `0015` adoptability fixtures parse unchanged and still run unchained, and the fixture
      files themselves are not edited. No test pins a policy digest for them; the only pinned digest in
      the suite is in `tests/serialize.test.ts`.
- [x] `--after-run` is rejected on every command except `review`, `--run` is still rejected on
      `review`, and the MCP `review` tool input schema is unchanged.
- [x] `tests/review.test.ts:478` keeps its three remaining assertions; only the `max_review_cycles`
      one is removed, and the test's name is corrected to say what is still not shipped.
- [x] `skills/spbridge/SKILL.md` carries no surviving sentence that forbids the loop — its frontmatter
      description, its "invoke once" lines, its hard-boundary rule against a second `/spartan` round,
      and step 4's "Do not add other flags" and "Invoke exactly once" included — and it names
      `--after-run`, names the outcomes on which the session stops, and contains no cycle number. This
      is an assertion over text and is recorded as one: it proves the instructions, not the behaviour.
- [x] The `review_chain` shape is pinned per row of D7's table, including `cycle: null` on every
      refusal and on the limit stop, and `review_chain: null` for a run that terminated before policy
      resolution.
- [x] The skill states D9's three continuation conditions, including that a `null` `review_chain`
      stops rather than being read through, and that a `changes_requested` at `cycle == max_cycles` is
      a stop and not a continuation.
- [x] The behaviour behind those instructions is evidenced by the live chain below rather than by the
      text assertion: the recorded run shows one continuation that carried `--after-run` and one stop
      that did not continue.
- [x] `chain_refused` and `cycle_limit_reached` exit 1 from the CLI and reach an MCP caller as an
      error, the way other pre-review stops do, asserted over the exit code rather than inferred from
      the reason-code name.
- [x] `canonicalPolicyJson` carries `producer_chain_authorized` and `serializeStatus` carries
      `review_chain`, so the digest actually changes and the skill can actually read the record.
- [x] An `--after-run` value that is not shaped like a run id the runtime creates, or that resolves
      outside the runs directory, is `chain_refused` with cause `run_unreadable` before any file is
      opened, asserted with a traversal value.
- [x] A referenced status document that parses as JSON but lacks the fields D3 reads is the same
      refusal, not a crash. A document written by the current build — which carries no `review_chain`
      at all — is one such document, and has its own test.
- [x] The inner `/spartan` round invokes no CLI and prints no invocation for the human; only a
      stopping outer loop prints one.
- [x] One real two-cycle chain is exercised against this repository through the installed client, and
      Evidence records both run ids, both verdicts, and the recorded `cycle` values.
- [x] `docs/DECISIONS.md` carries one new entry and `docs/ROUTING-AND-WORKFLOWS.md` matches the
      shipped grant sentence and plan-loop behaviour.
- [x] `npm run typecheck` and `npm test` exit 0.

## Decisions

### D1 - The next producer round is the session that is already open

The Bridge does not start a producer. The producer round that answers findings is the same
human-started `/spbridge` session that started the run, revising in place. This is what
`ROUTING-AND-WORKFLOWS.md` already describes for the plan loop, and it keeps `AGENTS.md`'s "must stop
before changing the producer role or producer host" trivially true, because neither changes.

The alternative — the Bridge spawning the mapped planner — needs a Claude Code adapter that does not
exist, plus write authority, host lifecycle, and locks. D-007 defers exactly that, and Phase 5 owns
it. Reading the chain that way would replace a bounded slice with the project's largest capability
jump, so it is rejected for this task rather than merely deferred inside it.

The new authority is therefore narrow and precisely statable: **a review run may be started by a
producer round that a previous run returned findings to.** Nothing about what a run may read or write
changes.

### D2 - The chain is an explicit run reference, never an inference

`review` gains one option, `--after-run <run-id>`. The Bridge resolves it with the existing
`runDirFor` and `readStatus`, which is one bounded read of a named directory. It does not list
`.spartan-bridge/runs/`, does not keep a per-task chain file, and does not derive "the previous run"
from the task path — `AGENTS.md` forbids acting on a vague latest handoff, and a scan would be
exactly that.

`--run` stays forbidden on `review`. It is reserved for the Phase 3 resume-by-run-id work, and
spending the name here would either block that or force a later meaning change on a shipped flag. The
option parser keys on the whole name, so `--after-run` is its own key and does not trip that
reservation; what rejects a third option today is the `options.size` check, which is the rule that has
to change.

**The reference is validated, not merely joined**, after the source review of 2026-08-19. `runDirFor`
is a bare `path.join` with no traversal check; the containment that protects `status` lives in the
CLI, which validates the run-id shape and applies `isInside` before reading. A chained run reuses that
guard rather than trusting the option: the value must have the shape of a run id the runtime itself
creates, the resolved directory must be inside the runs directory, and a value failing either is
`chain_refused` with cause `run_unreadable` before any file is opened. `readStatus` is an untyped
`JSON.parse`, so the referenced document is checked for the fields D3 reads instead of being trusted;
a document without them is the same refusal rather than a crash.

### D3 - What the Bridge verifies before it accepts a chained run

All five conditions read data the Bridge already persists. A chained run is accepted only when:

1. `AGENTS.md` carries the grant of D4;
2. the referenced run's `status.json` is readable and its `task_path` equals this run's;
3. the referenced run's `verdict` is `changes_requested` — a `pass`, a failure, a `blocked`, or a
   `human_required` run does not continue a plan loop;
4. the referenced run's `artifact_hashes.agents` equals this run's, so the authority that governed
   cycle 1 is the authority governing cycle 2;
5. this run's task hash differs from the referenced run's `task_hash_after_write`, or from its
   `artifact_hashes.task` when nothing was written — the producer round actually changed the
   artifact;
6. the referenced document carries a numeric `review_chain.cycle`. D7 computes this run's cycle as
   the parent's plus one, and that number is what D5 and D9 rely on, so a parent without it is not
   chainable. This is not a hypothetical: **every status document the current build writes has no
   `review_chain` at all**, so the first chained run attempted against a pre-change parent must
   refuse rather than do arithmetic on `undefined`. The refusal is `chain_refused` with cause
   `run_unreadable`, the same as any other referenced document that parses but lacks what the chain
   reads.

**A run that produced no verdict ends the chain**, recorded after a real `adapter_error` on
2026-08-19. Condition 3 refuses a reference to any run whose verdict is not `changes_requested`, and
that includes a run that terminated before a verdict existed — the incident run exited `collect` with
`output_unparsable`, so `verdict` was `null`. One transient adapter failure therefore stops the
automatic loop and hands the task back to the human, who restarts with a fresh unchained run. That is
deliberate: the Bridge has no evidence about what the reviewer did in a failed run, and skipping over
a run it cannot account for would let a three-cycle chain contain fewer than three actual reviews.
Reaching past the failure to the last good run is the same thing wearing a different name, and
retrying inside the Bridge is the automatic retry the boundary forbids.

Condition 5 is the one worth arguing. It is the cheap, technically checkable half of "a producer
round happened"; the other half is already enforced, because D-017 refuses to write findings unless
the artifact's `next_role` is `reviewer`, which only a producer round restores. Together they make an
empty cycle — a session that re-invokes the runtime without revising anything — impossible to record,
rather than merely discouraged in a skill.

### D4 - One optional parsed grant sentence, and the prose that surrounds it

The amendment adds exactly one sentence to `## Spartan Bridge automation authority`, matched by
literal string equality on a list item the way `GRANT` and `TASK_ARTIFACT_WRITE_GRANT` already are:

```text
A producer round that received findings from a Spartan Bridge run may start the next review run automatically within the authorized cycle limit.
```

Zero occurrences parse `ok` with `producer_chain_authorized: false` and today's behaviour; two or
more fail as `agents_policy_invalid` with a new check value `producer_chain_grant`, matching how the
existing grants handle duplication. The sentence is **never required**, because task `0015` made
adoption by other repositories a property this parser must keep.

It must be a parsed grant rather than a prose bullet. `parseAgentsPolicy` silently ignores any list
item it does not match, so a prose-only bullet would be inert while reading like authority — and this
repository's own boundary requires reviewer and writer constraints to be technically enforced, not
merely prompted. The same standard applies to the authority that starts a run.

**It copies the write-grant pattern, not the review-grant pattern.** From the source review: `GRANT`
is required, because `grants.length !== 1` fails the parse, while `TASK_ARTIFACT_WRITE_GRANT` is
optional in exactly the shape this decision needs — zero means `false`, one means `true`, two fail as
`agents_policy_invalid`. Implementing the new sentence like `GRANT` would make an absent grant fail
the whole parse with `automatic_review_not_authorized`, and the second acceptance criterion would then
be unreachable: a `--after-run` run in a repository without the grant would die in policy resolution
instead of reaching `chain_refused` / `not_authorized`.

The unparsed bullets in the same section are amended alongside it, because they are what a human
reads:

- "The human starts each producer phase." becomes a statement that the human starts the first
  producer phase of a chain and that later cycles continue inside that same human-started session.
- The stop list gains the chain's own stops: an unauthorized chain, an unvouchable reference, and the
  cycle limit.

Nothing else in `AGENTS.md` moves. The host-binding table, the role-permission table, the
authentication boundary, and the human-only gates are untouched.

This round does not apply the edit. `AGENTS.md` gives the planner planning artifacts only, and the
file and the parser must change together or a run resolves policy against text no parser matches — so
the implementer applies both in one round.

### D5 - A cycle is one review run

`max_review_cycles: 3` means at most three review runs in one automatic chain: the human-started run
is cycle 1, and `--after-run` may reach cycle 2 and cycle 3. A request that would be cycle 4 stops
for the human.

The competing reading — three repeats *after* the first, so four runs — is rejected. For a sentence
that bounds an automatic loop, the smaller count is the safe one, and a ceiling whose value depends
on whether the first run counts is a ceiling nobody can state confidently in a review.

The limit binds the automatic chain only. A human may always start a fresh unchained run on the same
task; that is their gate, not a bypass of it.

**What the limit does not bind, after review finding `LIMIT_REQUIRES_AFTER_RUN`.** A caller that
simply repeats plain `review` never reaches the ceiling, because every such run is cycle 1 of a new
chain. So the limit bounds a chain, not a determined caller, and D9 no longer claims the runtime
alone ends the loop. Two things carry that weight instead: `--after-run` on every continuation is a
load-bearing contract of the adapter, evidenced by the live chain rather than by a test that cannot
observe a host; and every run records `after_run_id` and `cycle`, so a caller looping unchained is
visible in the run directory rather than indistinguishable from a human starting over.

Keying the limit to the task artifact instead of the chain — counting the review regions written for
one task since the last `pass` — was considered and rejected. It needs durable per-task state the
runtime deliberately does not keep, the region it would count is overwritten every run, and it would
make a human's legitimate fresh start indistinguishable from a caller's loop, which is exactly the
distinction the human gate depends on.

### D6 - Two reason codes without the `review_` prefix, and the discrimination lives in a record

- `cycle_limit_reached` terminates `human_required`. It is the expected end of a healthy
  chain, and the skill must recognise it as normal rather than as a fault.
- `chain_refused` terminates `blocked`, with the cause on the new `review_chain` record from a
  closed vocabulary: `not_authorized`, `run_unreadable`, `task_mismatch`, `verdict_not_chainable`,
  `agents_changed`, `task_unchanged`.

**The names avoid the `review_` prefix deliberately**, after the source review found what that prefix
means to the runtime: `terminate` treats any reason code beginning with `review_` as a successful run
and exits 0, which is how the four reviewer verdicts are separated from the pre-review blocks that
exit 1. A refused chain and a chain at its ceiling are pre-review stops that produced no review, so
they belong on the exit-1 side. Calling them `review_chain_refused` and `review_cycle_limit_reached`
would have made both exit 0 and, through `src/mcp/outcome.ts`, made a refused chain look like a
successful review to an MCP caller. The naming buys the right behaviour from the rule that already
exists instead of adding a special case to it, and the acceptance criteria pin the exit code rather
than trusting the prefix.

This follows D-018 — one code names the outcome, a record with a closed vocabulary carries the
discrimination — and departs from it only by adding a second code, because `/spbridge` branches on
`reason_code` and the difference between "the chain is over" and "the chain is wrong" decides whether
the session stops quietly or reports a fault. `PRE_REVIEW_BLOCKED` is left alone: its only consumer
today is `isPolicyBlockedReason`, which nothing imports, so membership would be decoration.

### D7 - `review_chain` is present from policy resolution on, and each field is pinned per outcome

Revised after review finding `REVIEW_CHAIN_NULLABILITY`, which is right that the first shape could
not hold: `not_authorized` and `run_unreadable` happen before any parent cycle can be read, so
`cycle` cannot be required on every chained document. The record is also needed on unchained runs,
because `max_cycles` is what lets the caller stop at the last cycle (D9).

`StatusDocument` gains `review_chain`, `null` on exactly the runs that terminated before the
`policy_resolved` event, because `max_cycles` comes from the policy and does not exist before it. The
rule is the cut point, not a list of reasons: the source review found that naming four reasons left
out `task_invalid`, `automatic_review_not_authorized`, `reviewer_binding_missing`, `host_invalid`,
every `registry_*` reason, and `client_context_unavailable`, all of which also exit before that event.
`policy_digest` is null on exactly the same runs, so the two fields agree by construction. Otherwise:

| Outcome | `after_run_id` | `cycle` | `max_cycles` | `refused` |
|---|---|---|---|---|
| unchained run | `null` | `1` | from policy | `null` |
| chained run accepted | the reference | parent + 1 | from policy | `null` |
| `not_authorized` | the reference | `null` | from policy | `not_authorized` |
| `run_unreadable` | the reference | `null` | from policy | `run_unreadable` |
| `task_mismatch`, `verdict_not_chainable`, `agents_changed`, `task_unchanged` | the reference | `null` | from policy | that cause |
| `cycle_limit_reached` | the reference | `null` | from policy | `null` |

`cycle` is the cycle this run occupies, so it is `null` whenever the run never became one. The limit
stop carries no `refused` cause because its reason code already names it and it is not a refusal of a
malformed request.

`EventDocument` is unchanged and `SCHEMA_VERSION` stays `2`, exactly as D-018 handled
`adapter_failure`. Nothing derivable is stored — no `cycles_remaining`, no copy of the referenced
run's verdict. The status document is a record of this run, not a projection of the chain.

### D8 - The grant enters the policy digest

`ResolvedPolicy` gains `producer_chain_authorized`, so the digest covers every authority that
governed the run, and two repositories differing only by the grant sentence produce different
digests. The pinned serialization string in `tests/serialize.test.ts` changes as a result. That is the
intended, visible consequence of adding an authority field, not an incidental break to work around.

The consequence reaches further than the pinned test, and the acceptance criteria say so rather than
leaving it to be discovered: **every run's `policy_digest` value changes when this ships**, including
runs in repositories that never adopt the grant, because the field is in the serialized policy whether
it is `true` or `false`. Nothing compares a digest across runs, so no behaviour depends on the old
value; what changes is the string printed in each run's status document and in the review region the
Bridge writes into the task artifact.

### D9 - The skill loops on what the document says, and stops one cycle earlier than it used to

`skills/spbridge/SKILL.md` step 6 stops forbidding a second producer round. The session reads the
status document and continues **only** when all three hold:

1. `reason_code` is `review_changes_requested`;
2. `review_chain.cycle` is not `null`;
3. `review_chain.cycle < review_chain.max_cycles`.

Then it runs one further `/spartan` round on the same explicit task path and invokes the CLI exactly
once more with `--after-run <run_id from the document just read>`. On anything else — the last cycle,
`cycle_limit_reached`, `review_passed`, a refusal, or a document it cannot read — it stops and
prints the human's next invocation as it does today.

Condition 3 is review finding `LAST_CYCLE_STILL_LOOPS`, and it is right: the earlier rule continued
on every `changes_requested`, so a `changes_requested` at the last allowed cycle would spend a full
producer round producing a revision whose review the runtime is then obliged to refuse. The skill now
stops at the last cycle and hands the human a fresh unchained invocation, which is the decision that
is theirs to make anyway.

**The inner round starts nothing**, after review finding `INNER_ROUND_OWNS_NO_REVIEW`. The `/spartan`
round run inside the loop revises the artifact and returns its handoff into the session; it does not
invoke the runtime and does not print an invocation for the human. Only the outer `/spbridge` loop
calls the CLI, and only when the loop stops does it print anything for the human to run. This matches
the portable skill's own hard boundary, which already forbids it from invoking another agent, and it
is what keeps one CLI invocation per cycle true.

A `review_chain` that is `null` is a stop, not a condition to read through: a run that failed before
policy resolution carries no record at all, so the session checks the record's presence before its
fields.

**The edit is the whole skill file, not steps 5-7.** The source review listed the other places that
forbid the loop today: the frontmatter description and the "invoke once and report what comes back"
line, the hard-boundary rule "Do not start a second `/spartan` round in this session after the
review", and step 4's "Invoke the installed runtime once", "Do not add other flags", and "Invoke
exactly once. Do not retry." Changing only steps 5-7 would leave a file forbidding on its first page
what it prescribes on its second, and "Do not add other flags" alone would forbid `--after-run`.

**What a test can and cannot prove here.** There is no skill interpreter and no skill test in the
suite, so an assertion over `SKILL.md` can only prove what its text says: that no forbidding sentence
survives, that `--after-run` is named, that the stop outcomes are named. It cannot prove that a host
passes the flag on every continuation. The load-bearing check is the live two-cycle run recorded in
Evidence, and the acceptance criteria now say which check carries which weight instead of letting a
text assertion stand in for behaviour. An assertion that every CLI example carries `--after-run` would
itself be wrong, because a chain's first invocation must not.

The skill still holds no state and keeps no counter of its own: the numbers it compares both come
from the document it just read, so no cycle count is written into the skill text. What it no longer
claims — per `LIMIT_REQUIRES_AFTER_RUN` and the revised D5 — is that the runtime bounds the loop by
itself. No retry, unchanged from today.

## Work Completed

- Implementation re-review, HX-011 (Claude Code, claude-opus-5, effort high, Anthropic): `APPROVED`.
  Read the two chain status documents and the runs directory directly rather than the task's account
  of them, confirmed the stop, re-ran the repository checks, and closed `LIVE_CHAIN_NOT_RUN`. Every
  acceptance criterion now holds, so the task is `completed`. No product file was edited.

- Implementation (Cursor, cursor-grok-4.6-high-fast, effort none): accepted
  envelope HX-010 and addressed `LIVE_CHAIN_NOT_RUN`. Rebuilt `dist/` so no `src/**/*.ts` file is
  newer than `dist/cli/main.js`. Exercised one real two-cycle chain through the installed
  `spartan-bridge` client on `spartan/tasks/0023-say-when-the-run-started-and-how-long-it-took.md`,
  whose `next_role` was `reviewer`. Cycle 1 requested changes; this session revised that plan against
  the findings and invoked the CLI again with `--after-run` taken from that cycle's status document.
  Cycle 2 passed; D9's continuation conditions then failed, so this session started no third
  reviewer. Both previously unticked acceptance criteria are ticked. `npm run typecheck` and
  `npm test` both exit 0 (160 passed).

- Implementation review, HX-009 (Claude Code, claude-opus-5, effort high, Anthropic): `CHANGES_REQUESTED`
  with one finding. Read the whole diff against D1-D9 and re-ran the repository checks. The runtime,
  policy, serializer, CLI, skill, and documentation halves match the approved plan and twenty-one of
  the twenty-three acceptance criteria hold. The two that do not are the pair D5 and D9 named
  load-bearing: no chained run has ever executed in this repository, and the Evidence bullet labelled
  "live two-cycle chain" describes an in-process fake-adapter test. Those two rows are unticked above
  and the Evidence bullet is relabelled to what it is. No product file was edited.

- Implementation (Cursor, cursor-grok-4.6-high-fast, effort none): accepted envelope HX-008 and shipped D1-D9. `AGENTS.md` gained the optional producer-chain grant and the surrounding bullets. The parser, contracts, serializers, review chain checks (six D3 conditions plus D2's run-id shape and containment guard), `--after-run`, skill rewrite, D-020, and routing docs landed together. `npm run typecheck` and `npm test` both exit 0 (160 passed).

- Source review (Cursor with the repository open, outside the Bridge, requested by the owner): an
  advisory second opinion that the Bridge's artifact-only reviewer cannot give, because that reviewer
  receives only `task.md` and `AGENTS.md`. It found five things the plan had wrong against the code,
  all folded in above: the grant must copy the optional `TASK_ARTIFACT_WRITE_GRANT` pattern rather than
  the required `GRANT` one, or the second acceptance criterion is unreachable (D4); `runDirFor` has no
  traversal check, so the chain reference needs the same shape-and-containment guard `status` uses, and
  the referenced document needs validating rather than trusting (D2); D7's null rule had to become the
  `policy_resolved` cut point, because six further reason codes exit before it; the `review_` prefix
  makes `terminate` exit 0, so the two new codes were renamed to `chain_refused` and
  `cycle_limit_reached` (D6); and the skill forbids the loop in five places outside steps 5-7, while a
  "contract test" over a Markdown file cannot prove a host passes a flag (D9). It also confirmed the
  plan's claim that the only pinned policy digest is in `tests/serialize.test.ts`, listed the tests the
  two new fields break, and caught that `src/core/serialize.ts` was missing from Scope even though both
  serializers enumerate their keys. Nothing was edited by that session.

- Plan review, cycle 6 (Cursor via the Bridge, cursor-grok-4.6-high-fast, effort none): `APPROVED`, no findings, run `run-5a0702ac`, 2m10s, `task_write_state: written`.
  The plan is closed and the task moves to implementation. Accepted envelope HX-007.

- Plan review, cycle 5 (Cursor, cursor-grok-4.6-high-fast, effort none),
  obtained out of band: three consecutive Bridge runs failed `output_unparsable` without producing a
  verdict, so the owner ran the adapter's exact call by hand — same argv, same
  `CURSOR_REVIEW_PROMPT`, same two-file workspace — and kept the stdout the Bridge discards. That
  capture carries a real reviewer verdict of this plan: `changes_requested`, one warning,
  `PARENT_CYCLE_UNCHECKED`. It is recorded here as a planner-recorded review with its provenance
  stated, not as a Bridge run: no run id, no review region, and `task_write_state` never happened. The
  next Bridge review that completes overwrites the region as usual.

- Planner response, cycle 5 (Claude Code, claude-opus-5, effort high, Anthropic): `PARENT_CYCLE_UNCHECKED`
  accepted. D3 gains a sixth condition requiring a numeric `review_chain.cycle` on the referenced
  document, and states the case the finding is really about — every status document the current build
  writes has no `review_chain` at all, so the first chain attempted against a pre-change parent must
  refuse instead of computing `undefined + 1`. The acceptance row for a document missing the chain
  fields now names that case explicitly and gives it its own test.

- Plan review, cycle 4 (Cursor via the Bridge, cursor-grok-4.6-high-fast, effort none): `CHANGES_REQUESTED` with one finding, run `run-3357bb5f`, 2m39s,
  `task_write_state: written`. Accepted; not contested.

- Planner response, cycle 4 (Claude Code, claude-opus-5, effort high, Anthropic): `UNCHAINED_AFTER_HASH`
  was the third consecutive finding on the same acceptance row, so this round stopped patching it field
  by field and audited the whole list against D1-D9 instead. The row now states the invariant
  positively — same outcome where nothing changed, three named differences and no others — and drops
  `task_hash_after_write` from the stay-same list, because D8's digest is written into the review
  region and therefore into the artifact bytes the hash covers. The audit found one further row worth
  tightening: the task `0015` adoptability criterion said the fixtures stay "unmodified", which would
  forbid updating a digest their tests pin; it now separates the fixture files, which are not edited,
  from a pinned digest, which is updated to the D8 value. The other eighteen rows were checked against
  the decisions and left as they are.

- Plan review, cycle 3 (Cursor via the Bridge, cursor-grok-4.6-high-fast, effort none): `CHANGES_REQUESTED` with one finding, run `run-c7881650`, 3m24s,
  `task_write_state: written`. Accepted; not contested. A first cycle-3 attempt, run `run-2a708f27`,
  produced no verdict and is recorded in Evidence.

- Planner response, cycle 3 (Claude Code, claude-opus-5, effort high, Anthropic): `UNCHAINED_DIGEST_PIN`
  caught the half-fix from the previous cycle. The cycle-2 response corrected the `review_chain` half
  of the unchained acceptance row and left its "only difference" clause standing, which D8 contradicts
  because the grant enters `ResolvedPolicy` and so changes `policy_digest` on every run, grant or no
  grant. The row now enumerates what must stay identical and names both fields that are required to
  differ. D8 states the same consequence in prose, including that repositories which never adopt the
  grant also see their digest value change.

- Plan review, cycle 2 (Cursor via the Bridge, cursor-grok-4.6-high-fast, effort none): `CHANGES_REQUESTED` with one finding, run `run-b11c228d`, 2m13s,
  `task_write_state: written`. Accepted; not contested.

- Planner response, cycle 2 (Claude Code, claude-opus-5, effort high, Anthropic): `UNCHAINED_CHAIN_SHAPE`
  was a real contradiction introduced by the cycle-1 response, not a restatement. Revising D7 to make
  the record present from policy resolution on left the first acceptance criterion still demanding
  `review_chain: null` for an unchained run, which D9's second continuation condition would then fail
  on every first review, so the loop could never start. The criterion now pins D7's first row instead,
  and `review_chain: null` is left to mean only "terminated before policy resolution". The Scope line
  no longer calls the record nullable.

- Plan review, cycle 1 (Cursor via the Bridge, cursor-grok-4.6-high-fast, effort none): `CHANGES_REQUESTED` with four warnings, run `run-a421fd20`, 2m59s,
  `task_write_state: written`. All four accepted; none contested.

- Planner response, cycle 1 (Claude Code, claude-opus-5, effort high, Anthropic): revised the plan
  against each finding.
  - `LAST_CYCLE_STILL_LOOPS`: D9 gains the `cycle < max_cycles` condition, so a `changes_requested`
    at the last allowed cycle stops instead of spending a producer round on a review that would be
    refused.
  - `REVIEW_CHAIN_NULLABILITY`: D7 pins the record per outcome in a table. `cycle` is `null` whenever
    the run never occupied one, and the record is present from policy resolution on, because D9's
    stop condition needs `max_cycles` on unchained runs too.
  - `LIMIT_REQUIRES_AFTER_RUN`: D5 states plainly that the limit bounds a chain and not a determined
    caller, and D9 stops claiming otherwise. `--after-run` on every continuation becomes a pinned
    adapter contract. Keying the limit to the task artifact was considered and rejected in D5, with
    the reason recorded.
  - `INNER_ROUND_OWNS_NO_REVIEW`: D9 now states that the inner `/spartan` round invokes nothing and
    prints no competing invocation; only the outer loop calls the CLI.

- Planner HX-001 (Claude Code, claude-opus-5, effort high, Anthropic): created this task and settled
  D1-D9. Read the shipped chain surfaces rather than the roadmap alone: `skills/spbridge/SKILL.md`
  steps 5-7, `src/policy/agents-policy.ts`, `src/core/review.ts`, `src/core/contracts.ts`,
  `src/core/task-write.ts`, `src/cli/parse.ts`, and the tests that pin them. No product file was
  edited.

## Evidence

- Live two-cycle chain through the installed client, vehicle
  `spartan/tasks/0023-say-when-the-run-started-and-how-long-it-took.md` (its `next_role` was `reviewer`;
  this task was not eligible). Both run directories exist under `.spartan-bridge/runs/`.
  - Cycle 1, unchained: `run-cf518a96-e7ef-41f1-98cc-d4c708a3e395`, verdict `changes_requested`,
    `reason_code` `review_changes_requested`, `review_chain.cycle = 1`, `after_run_id = null`,
    `task_write_state: written`, 12:55:54 to 12:57:41 UTC.
  - Continuation: this session revised 0023 against those findings, then invoked
    `spartan-bridge review --repo <workspace-root> --task spartan/tasks/0023-say-when-the-run-started-and-how-long-it-took.md --after-run run-cf518a96-e7ef-41f1-98cc-d4c708a3e395`.
    The flag came from that status document; the human did not type it.
  - Cycle 2: `run-b2d15e1e-3c31-4b4a-a885-40de3fefb65c`, verdict `pass`, `reason_code` `review_passed`,
    `review_chain.cycle = 2`, `after_run_id = run-cf518a96-e7ef-41f1-98cc-d4c708a3e395`,
    `task_write_state: written`, 12:58:29 to 13:00:37 UTC.
  - Stop: `reason_code` was `review_passed`, so D9's three continuation conditions did not hold.
    This session started no third reviewer.
- `npm run build` then no `src/**/*.ts` file newer than `dist/cli/main.js`. `npm run typecheck`
  exit 0. `npm test` 160 passed, 0 failed.
- Re-review verification, HX-011: both chain documents read from `.spartan-bridge/runs/`; the values
  in the bullet above match them field for field, including the timestamps. Sorted by `created_at`,
  `run-b2d15e1e` is the newest run in the directory. `npm run typecheck` exit 0; `npm test` 160
  passed, 0 failed. No `src/**/*.ts` file is newer than `dist/cli/main.js`, and no product file has
  been modified since the HX-008 implementation round, so the chain ran the reviewed code.
- Two unchained attempts before the chain are not part of it: `run-4e3ffa64` terminated
  `blocked` / `registry_unavailable` with `review_chain: null` under this session's isolated `HOME`;
  `run-8f431f49` reached policy resolution (`cycle = 1`) but failed `adapter_error` / `exit_nonzero`
  before a verdict. The successful chain used the machine-local user `HOME`, matching prior
  human-started reviews in this repository.
- In-process two-cycle chain, `tests/review-chain.test.ts` (fake adapter; not the live check):
  unchained `run-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` verdict `changes_requested`, `cycle = 1`;
  continuation `run-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb` with `--after-run` of the first, `cycle = 2`;
  stop `run-cccccccc-cccc-4ccc-8ccc-cccccccccccc` would be cycle 3, `cycle_limit_reached`, adapter
  `startCount = 0`. This proves the runtime accepts, counts, and bounds a chain.
- Skill text assertion remains `tests/spbridge-skill.test.ts`: it proves the instructions name
  `--after-run` and the stop conditions; it does not prove a host passes the flag.

- Planner-round baseline, now superseded: the cycle limit was unenforced; the skill stopped after one review and printed a paste for the return leg; `dist/` was current. Plan-review runs below remain the provenance of the approved plan.

- Cycle-1 review run `run-a421fd20`: started 06:15:49 local, ended 06:18:48, 2m59s, verdict
  `changes_requested`, `task_write_state: written`. The run rewrote frontmatter `next_role` to
  `planner`; the planner round set it back to `reviewer`, which is the precondition D3 relies on.

- Source review (Cursor, repository open, no Bridge run): reported against file and line. The claims
  this round relied on were spot-checked against the tree — `terminate`'s `review_` prefix rule, the
  bare `path.join` in `runDirFor`, the required-versus-optional grant filters in `agents-policy.ts`,
  and the key enumeration in both serializers. `tests/review.test.ts` line reference corrected from 477
  to 478.

- Approving run `run-5a0702ac`: 09:01:41 to 09:03:51 local, 2m10s, `pass` / `review_passed`,
  `task_write_state: written`. 144 stream records with two quiet spans, and no late tool call — the
  shape the three failures did not have.

- Cycle-4 review run `run-3357bb5f`: 08:06:20 to 08:08:59 local, 2m39s, verdict `changes_requested`
  with one finding, `task_write_state: written`. 1224 stream records, no silent gap.

- Cycle-3 review run `run-c7881650`: 07:59:47 to 08:03:11 local, 3m24s, verdict `changes_requested`
  with one finding, `task_write_state: written`. 1705 stream records with no silent gap.

- Cause of the `output_unparsable` failures, found by capturing one run's raw stream: the child's
  `result.result` is the concatenation of its assistant messages — prose, then the JSON verdict, with
  no separator — and `extractReviewPayload` resolves that by taking the **last balanced** `{...}`
  rather than the last one that parses. Probed against the real function with the captured text: as
  captured it yields `verdict=changes_requested`; with a trailing sentence containing no brace it
  still does; with a single literal `{` appended after the JSON it returns `undefined`. This plan's
  own text is full of shapes like `{ after_run_id, cycle, max_cycles, refused }`, so a reviewer that
  writes one closing sentence quoting the record fails extraction. That is consistent with all three
  failures having started a tool call late, after the verdict was already produced. The fix belongs to
  the diagnostics task, not to this one: prefer the last balanced object that parses **and** carries
  the expected keys, and retain the unparsed text on failure so the next unknown class is not blind.
  The captured stream stays outside the repository.

- A third `output_unparsable` failure, `run-5476046e`, 08:29:47 to 08:32:43 local: three failures in
  seven runs on this task, and three consecutive at the end.

- A second `output_unparsable` failure, `run-eb932dd6`, 08:24:06 to 08:26:31 local, same shape as the
  first: `collect`, exit 0, `stderr_bytes: 0`, nothing retained, nothing written. Two failures in six
  runs on this task. Both failures, and neither of the four successes, show a third tool call starting
  after the long reasoning phase and immediately before the `result` record; one success made four tool
  calls, all early. With n=6 that is a hypothesis rather than a cause, and it is recorded here because
  it is the only variable separating the two groups and it points the diagnostics work at the right
  place. The rate matters to this plan: D3 ends a chain on a run without a verdict, so at one failure
  in three an automatic three-cycle chain breaks part-way about half the time. That is an argument for
  fixing the diagnosis before relying on the loop, not an argument against D3.

- The first cycle-3 attempt, `run-2a708f27`, did not produce a verdict: `adapter_error`, phase `collect`,
  cause `output_unparsable`, exit code 0, `stderr_bytes: 0`, run 07:49:57 to 07:52:35 local (2m37s).
  The child exited cleanly and its final text carried no balanced JSON object, so `extractReviewPayload`
  returned undefined on all three of its shapes. Nothing is retained under `stream-json`, so which
  shape the reviewer actually emitted is unknown; that gap belongs to a separate diagnostics task and
  is not this plan's to close. The run wrote nothing: the artifact hash it read still matches the file
  on disk, and the HX-003 proposal stands. The incident is what D3's no-verdict paragraph records.

- Cycle-2 review run `run-b11c228d`: started 07:43:41 local, ended 07:45:54, 2m13s, verdict
  `changes_requested` with one `error` finding, `task_write_state: written`. Same `agents_hash` and
  same `policy_digest` as cycle 1; the task hash differed, which is the pair of facts D3's conditions
  4 and 5 would check if this chain were automatic. `next_role` was again rewritten to `planner` and
  set back to `reviewer` by this round.

## Review

<!-- spartan-bridge:review:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-5a0702ac-fa8e-46e1-aabf-59234351f6a9 execution_id=exec-1b59dc9d-12b2-412f-a29f-5018a4ab2008 review_kind=plan verdict=pass reason_code=review_passed host=cursor launcher=cursor-plan-reviewer-v1 model=cursor-grok-4.6-high-fast effort=none model_observed=declared_unobserved policy_digest=sha256:5ce5ce183767d86bbd03d6217f03b8849dd70c4a7609b5b84f750ecbb1d0100f task_hash=sha256:ea1592532d2b37284507b78d2c3d0e5898f267e1d3f03d5d435295e3ad6ecb3a agents_hash=sha256:30644e4ddfe923cc72bc6a40fd5d26c1af74682d01e4329f4c5d93016be00e7f timestamp=2026-08-19T12:03:51.362Z
<!-- spartan-bridge:review:end -->

The region above holds the latest plan verdict, written by the Bridge run named inside it. Each
cycle's findings and the planner response to them are recorded in Work Completed; the next review run
overwrites this region with the following cycle's verdict.

### Implementation review - HX-009 (closed)

Verdict: CHANGES_REQUESTED. Claude Code, claude-opus-5, effort high, Anthropic. One finding,
`LIVE_CHAIN_NOT_RUN`: the two acceptance rows D5 and D9 called load-bearing were ticked from an
in-process fake-adapter test, no chained run had ever executed in this repository, and
`dist/cli/main.js` was older than every changed source file, so the installed CLI still ran
pre-change code. Everything else was spot-checked against the tree and held: chain resolution runs
before the adapter is constructed, so `startCount` is 0 on every refusal and on the limit stop; both
new reason codes exit 1 because neither carries the `review_` prefix; `review_chain` becomes non-null
at `policy_resolved`; `parentChainFields` rejects a missing, non-integer, or sub-1 `cycle` before any
arithmetic; and the six D3 conditions, D2's shape guard, D4's optional-grant pattern, D7's table, and
D8's digest field are each pinned by a test. Closed by the live chain recorded in Evidence.

### Implementation re-review - HX-011

Verdict: APPROVED

Claude Code, claude-opus-5, effort high, Anthropic; a different vendor from the Cursor implementation
round. Read-only on the reviewed work: no product file, test, skill, or document was edited this
round, and this artifact is the only file this round wrote.

`LIVE_CHAIN_NOT_RUN` is closed by the run artifacts themselves rather than by the task's account of
them. `run-b2d15e1e-3c31-4b4a-a885-40de3fefb65c/status.json` carries `review_chain` of
`{ after_run_id: run-cf518a96-e7ef-41f1-98cc-d4c708a3e395, cycle: 2, max_cycles: 3, refused: null }`
with verdict `pass`; the referenced `run-cf518a96` carries `{ after_run_id: null, cycle: 1,
max_cycles: 3, refused: null }` with verdict `changes_requested`. Those are the run ids, verdicts,
and cycle values Evidence records, with the same timestamps.

The chain is real work, not a re-run of the same bytes. Both runs share an `agents_hash` and differ
in task hash, so D3's `agents_changed` and `task_unchanged` conditions were each satisfied by an
actual revision; cycle 1's three findings on `0023` (`QUIET_LINE_GRAMMAR`, `DURATION_DOCUMENT_SYNC`,
`DATE_COLUMN_FORMAT`) are answered in that task's diff and closed by name in cycle 2's own reviewer
summary. `after_run_id` reaches a status document only through `--after-run`, and its value is the
preceding run's id, so the continuation carried the flag taken from that document. Sorted by
`created_at`, `run-b2d15e1e` is the newest run under `.spartan-bridge/runs/`: no third reviewer
followed the pass, which is what D9 requires of `review_passed`. The build the chain ran was the
reviewed one - no `src/**/*.ts` file is newer than `dist/cli/main.js`, and no product file has
changed since the HX-008 round that HX-009 read.

Checks re-run this round: `npm run typecheck` exit 0, `npm test` 160 passed, 0 failed. With every
acceptance criterion satisfied, this required review approved, and no blocker outstanding, the task
is `completed`.

**Observations, not blocking, and none of them this task's to fix.**

- Task `0023`, the chain's vehicle, is left inconsistent: the cycle-2 write moved its `next_role` to
  `implementer` while its `Next Handoff` still proposes HX-002 for the reviewer round that just ran
  and passed. The skill anticipates this - step 7's `review_passed` branch prints a `/spartan`
  invocation and tells the human not to paste the stale envelope - so it is the design working, but
  the artifact stays inconsistent until that round runs. `0023`'s own next round closes it.
- `README.md` still lists `review --repo <path> --task <...>` with no `--after-run`, and its "How a
  host reaches the Bridge" flow still ends at "The skill prints the next invocation", which is now
  true only when the loop stops. `README.md` was out of Scope and no criterion covers it; it is the
  documentation round suggested below. Task `0022` also edits `README.md`, but its adoption section,
  not these two blocks.
- `.spartan-bridge/` is git-ignored, so the chain's status documents are machine-local. That is the
  existing convention for every run this repository has recorded; the run ids and values in Evidence
  are what survives in the repository.
- `resolveReviewChain`'s containment check is still the disjunction noted in HX-009: unreachable
  today, looser than D2's wording, unchanged this round.

## Blockers

None for this task. One consequence is recorded rather than solved: with the loop running
unattended, the Bridge still rewrites a single owned region, so cycle 1's findings are overwritten by
cycle 2's and a multi-cycle review cannot be read back afterwards. That is the owner's open question
about where review history lives, and it is deliberately not decided here.

## Next Action

None. The task is completed: the plan loop ships, the live two-cycle chain is recorded, and the
implementation review is approved.

## Next Handoff

None. This task proposes no handoff.

Non-binding suggestion, which the human may decline: `README.md` was out of Scope here and now
describes a single-cycle command surface that the shipped loop has outgrown.

```text
Recommended execution (human decides):
- Host: Claude Code, the `planner` binding in `AGENTS.md`, and the producer round the Bridge reviews
- Model and effort: claude-opus-5, effort high
- Role: planner
- Invocation: `/spbridge` in Claude Code, passing the prompt block below as the argument
```

```text
Create a new task in `spartan/tasks/` from `assets/task-template.md`, using the next unused four-digit number.

Act as planner. Plan the `README.md` update the shipped plan loop now requires: `--after-run` in the shipped-commands block, and a "How a host reaches the Bridge" flow that shows the continuation and the stop rather than ending at one printed invocation. Task `0022` separately edits the adoption section of the same file, so state how the two stay disjoint. Success is a plan whose scope, decisions, and acceptance criteria are settled enough to implement.
Run the relevant repository checks and update that new task file.

Return only the next handoff, or a completion notice if no work remains.
```
