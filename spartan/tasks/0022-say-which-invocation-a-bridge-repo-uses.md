---
protocol: "1.0.0" # x-release-please-version
id: say-which-invocation-a-bridge-repo-uses
created_at: 2026-08-19
status: completed
phase: complete
task_type: implementation
risk: material
current_role: reviewer
next_role: human-operator
updated_at: 2026-08-19
handoff_id: HX-009
next_handoff_id: none
---

# Say which invocation a Bridge repository uses

## Objective

A repository that runs the Bridge says so in its own `AGENTS.md`, and any host authoring a handoff
there can tell from that declaration whether the next producer round is entered through `/spbridge`
or through the host's own token — including the case where the mapped reviewer has no adapter and the
Bridge cannot help at all.

The same round settles a second set of authoring rules that belongs in the same file for the same
reason: the conventions an agent follows when it authors an artifact in this repository, of which
deriving a plan's acceptance criteria from its decisions is the first. The two ride together because
both are conventions an agent must follow when it authors an artifact here, and because the round has
to open `AGENTS.md` either way. They are otherwise independent, and D6 keeps the second set out of
everything the Bridge ships to an adopting repository.

## Context

**The behaviour exists; the rule that reaches it does not.** `/spbridge` already runs a producer round
through `/spartan` in the same session and then invokes `spartan-bridge review` itself, shipped by
tasks `0011` and `0012`. What is missing is anything that tells the handoff author to send the human
there. On 2026-08-19 the owner pasted `spartan-bridge review` into a terminal six times in one session
before asking why the skill was not being used; the handoffs had all been addressed to the reviewer,
which has no producer round to run and therefore always falls back to the terminal.

**The rule cannot live where it currently lives.** This repository's `AGENTS.md` has a repository-specific
"Handoff authoring" section that says the advisory names the `spartan-bridge review` command — the
opposite of what is wanted, and the direct cause of the reviewer-addressed handoffs. Nothing in the
adoption surface carries any such guidance to another repository: the `README` states that adoption is
"exactly the pieces the runtime parses, plus one ignore rule", and deliberately supplies no wider
template. A machine-local file such as a personal `agent-scripts/AGENTS.md` cannot carry it either,
because another user's machine has no such file.

**The condition is genuinely three-part, and the owner's own repositories prove it.** They run
repositories with `reviewer.plan` mapped to Cursor and others, at work, mapped to Codex. Only Cursor
has an adapter, so in the Codex repositories `/spbridge` would drive the run into
`launcher_unavailable`. A declaration that says only "this repository uses the Bridge" is therefore
not enough to decide the invocation.

**The portable protocol needs no change.** Its `README` already describes the Bridge as an optional
runtime, states that nothing in the protocol depends on it, and delegates the configuration reference
to the Bridge project; its skill and normative references contain no mention of the Bridge at all.
A `/spartan` round reads the target repository's instructions before acting, so a line in that
repository's `AGENTS.md` is sufficient to steer handoff authoring without teaching the protocol
anything about the Bridge.

## Scope

- `AGENTS.md`: a new `## Artifact authoring` section carrying the rules settled in D6.
- `skills/spbridge/SKILL.md`: state the three-part condition from the Bridge's side, so the rule ships
  with the product rather than living in one machine's memory.
- `README.md`, the adoption section: the exact paragraph an adopting repository pastes into its own
  `AGENTS.md`, directly under its `## Agent hosts` table.
- `AGENTS.md` of this repository: adopt that paragraph and reconcile the existing "Handoff authoring"
  section with it.
- `docs/ROUTING-AND-WORKFLOWS.md`: the declaration's place in the required `AGENTS.md` structure. The
  artifact-authoring rules do not appear here, because they are not part of that structure.

## Out of Scope

- The `agent-spartan-protocol` repository. Its `README` mention is correct as it stands and its
  normative text is Bridge-free; changing it would move a dependency in the wrong direction.
- Making the declaration a parsed grant in `src/policy/agents-policy.ts`. See D2.
- Putting the artifact-authoring rules into the adoption text, the skill, or anything the Bridge
  parses. They are this repository's own convention and travel with nothing.
- Any adapter work. This task does not make `/spbridge` usable where no adapter exists; it makes the
  handoff say so.
- `doctor` gaining a new check. It already reports launcher resolution and Cursor interface
  availability, which is what the second condition needs.

## Constraints

- The declaration must not disturb the host-binding table. The parser reads the first table in the
  `## Agent hosts` section and stops at the first blank line, so prose below it is inert — that is
  relied on deliberately, not accidentally.
- A repository without the Bridge is unaffected and needs no such paragraph.
- The paragraph must be true on a machine where the Bridge is not installed, because the same
  repository is read by hosts that do not have it.
- Repository content may still name only the alias and the bindings; nothing here introduces a
  launcher command, path, or credential.

## Acceptance Criteria

Each criterion names the decision it is derived from, so a later round can re-derive it when that
decision moves. The last row records a repository check and names no decision, under the exception
D6's first rule states.

- [x] D3: `README.md` carries the paragraph settled in D3, byte-for-byte, in the adoption section,
      presented as the one project instruction the Bridge supplies and with the reason it is supplied,
      and the section's standing position — that adoption is only what the runtime parses — is narrowed
      to exactly this exception rather than dropped.
- [x] D1, D3: `AGENTS.md` of this repository carries that same paragraph, byte-for-byte, in the
      `## Agent hosts` section below the binding table, after the alias and fresh-context paragraphs
      already there.
- [x] D3: the two copies are identical, asserted by comparing them rather than by reading both. The
      complete list of files carrying the paragraph's text after this task is `README.md`, this
      repository's `AGENTS.md`, the parse fixture the D1 criterion needs, and D3 of this artifact, which
      remains the place it is authored.
- [x] D2: the "Handoff authoring" section of this repository's `AGENTS.md` agrees with the declaration
      instead of competing with it — it no longer sends a plan-review advisory to the
      `spartan-bridge review` command, it points at `doctor` for the adapter condition rather than
      inviting a host to infer adapter support from a host name, and it does not restate the
      paragraph's text.
- [x] D1: adding the paragraph changes no parse result: the host-binding table still resolves, and
      `parseAgentsPolicy` returns the same values it returns today, asserted over this repository's own
      `AGENTS.md` and over a fixture carrying the paragraph.
- [x] D2, D4: `skills/spbridge/SKILL.md` states, from the Bridge's side, the three conditions under
      which a round is entered through it — the repository declares the Bridge, the mapped
      `reviewer.plan` host has a working adapter, and the runtime is installed on the machine running
      the round — and states that the Bridge dispatches plan review only, so an implementer round is
      not entered through it.
- [x] D4: the `review_passed` branch of step 7 prints the role the artifact's written `next_role`
      carries, the host `AGENTS.md` binds to that role, and that host's own invocation token, in place
      of the role-less "continue" line. The first two are read from the repository; the third comes
      from the host-to-token mapping the skill states in its own text, because the binding table has no
      invocation column and this task adds none. The branch still writes nothing to the artifact.
- [x] D4: the skill's hard boundary is amended, not left as it stands: the bullet that today forbids
      inspecting task frontmatter or the binding table now forbids reading them to decide whether to
      invoke and permits reading them to name the round that follows a recorded verdict.
- [x] D3, D6: `docs/ROUTING-AND-WORKFLOWS.md` shows where the declaration sits in the required
      `AGENTS.md` structure without authoring a third copy of its text, and carries neither the
      `## Artifact authoring` section nor any of its rules.
- [x] D6: `AGENTS.md` carries a `## Artifact authoring` section holding the six rules of D6
      byte-for-byte, and neither the adoption text nor `skills/spbridge/SKILL.md` repeats them.
- [x] D1, D6: adding that section changes no parse result, asserted the same way as the declaration
      paragraph.
- [x] `npm run typecheck` and `npm test` exit 0.

## Decisions

### D1 - The declaration is prose under the binding table, and that is the right shape

It sits in the `## Agent hosts` section below the binding table, where a reader already learns which
host reviews. Where that section holds nothing but the table — the shape the adoption text shows — the
paragraph lands immediately under it; in this repository it lands after the alias and fresh-context
paragraphs already there, because those two explain the table itself and must not be pushed away from
it. Settling the placement here rather than in a criterion keeps the two readings from being asserted
at once.
It is not parsed, and does not need to be: its consumer is the agent authoring the handoff, not the
runtime. This is the opposite of task `0020` D4, where the grant had to be a parsed sentence because
the runtime acts on it — the distinction is which reader must obey, and it is worth stating so the two
cases are not confused later.

### D2 - Three conditions, not one

A handoff is addressed to the producer and names `/spbridge` only when the repository declares the
Bridge, **and** the host mapped to `reviewer.plan` has a working adapter, **and** the runtime is
installed on the machine running the round. Otherwise the advisory names the host's own token, exactly
as today.

The second condition is what keeps the rule honest in the owner's work repositories, where
`reviewer.plan` is Codex and no Codex adapter exists; recommending `/spbridge` there would send the
round into `launcher_unavailable`. `doctor` already answers that condition without guessing, so the
rule points at it rather than inviting a host to infer adapter support from a host name.

### D3 - The Bridge ships the text; each repository pastes it

The paragraph is settled here, so that the implementing round applies it rather than composing it and
so a reviewer can judge the words themselves:

```markdown
This repository runs the Spartan Bridge. A producer round whose review the Bridge dispatches is
entered through `/spbridge`, and the handoff that precedes it is addressed to that producer rather
than to the reviewer. When the mapped `reviewer.plan` host has no working adapter, or the Bridge is
not installed here, the advisory names the host's own token instead.
```

The paragraph encodes D2 and D4 together, and its three sentences do not map one-to-one onto D2's
three conditions. Sentence one is D2's first condition, that the repository declares the Bridge.
Sentence two is D4's restriction, that the round is a producer round whose review the Bridge
dispatches; a reader meets it here because it is the question asked next, not because it is a
condition of D2. Sentence three carries D2's remaining two conditions as the negatives that make the
paragraph true where they fail: no working adapter for the mapped `reviewer.plan` host, or no runtime
installed here. That last sentence is what keeps the paragraph true in a repository whose
`reviewer.plan` is Codex, where `/spbridge` cannot run at all.

The adoption surface gains this one paragraph, and the `README`'s standing position — that adoption is
only what the runtime parses, and that project instructions are not supplied as a template — is
narrowed by exactly this exception, with the reason recorded: this paragraph is about the Bridge's own
invocation, so the Bridge is the only place that can state it correctly for every adopter. Everything
else about a repository's instructions stays the repository's business.

### D4 - `/spbridge` is for producer rounds whose review the Bridge dispatches

The runtime performs plan review only. An implementer round's review is `reviewer.implementation`,
which the Bridge does not run, so that round is entered with the host's own token even in a
Bridge-configured repository. Saying this in the skill prevents the obvious wrong generalisation that
every round in such a repository goes through `/spbridge`.

**What the skill prints when it stops is part of the same rule, and today it is thin.** Step 7's
`review_passed` branch prints `/spartan` — correct, because the next round is the implementer — but
the prompt it prints names no role and no host, only "Continue from the recorded verdict". The
implementer binding in this repository is Cursor, so a reader who follows the printed suggestion in a
fresh Claude Code session lands on the wrong host, and the round has to be redirected by hand. That
happened on task `0021` on 2026-08-19: the printed prompt was replaced with a hand-authored
implementer envelope naming Cursor.

The branch therefore prints three values, from two different sources, because the repository holds
only two of them. The role is the artifact's written `next_role`; the host is the one `AGENTS.md`
binds to that role. The binding table has no invocation column and this task adds none, so the third
value cannot be read from it: the invocation comes from the host-to-token mapping the skill states in
its own text — `/spartan` for Claude Code and for Cursor, `$spartan` for Codex — which is the mapping
the Spartan skill already fixes. The skill therefore reads two facts from the repository and applies
one rule it carries itself, and the plan says which is which rather than calling all three "what the
binding table says".

**This amends the skill's hard boundary; it does not preserve it.** That boundary today forbids
inspecting task frontmatter or the binding table at all. Printing a role and a host requires reading
both, so the bullet is rewritten to a purpose split: those files may not be read to decide whether to
invoke, and may be read to name the round that follows a recorded verdict. Naming the amendment is the
point — a decision that claimed the boundary was untouched would be false on its face.

The branch stays a printed suggestion and is still never written to the artifact.

This matters more after task `0024`. Once the Bridge retracts the envelope a verdict consumed, the
printed prompt is the only guidance a human has at that moment, and a role-less line is no longer a
cosmetic weakness.

### D5 - The protocol repository is not touched

Its `README` already calls the Bridge optional, states that nothing depends on it, and points at the
Bridge project for configuration; its skill and references never mention it. Adding a Bridge-aware
rule to the protocol would create the coupling the protocol's own admission test forbids, and it is
unnecessary because a `/spartan` round reads the target repository's instructions first.

### D6 - The artifact-authoring rules are this repository's convention, and stay out of what the Bridge ships

Tasks `0020` and `0021` produced eleven review findings between them on 2026-08-19. Five were an
acceptance criterion contradicting a decision in the same plan, and three of those five were the same
row, patched field by field across consecutive review cycles before anyone re-derived it. At roughly
two and a half minutes per review run, that single pattern was the most expensive thing in the day.

The cause is mechanical rather than careless: criteria are written beside the decisions and then
edited pointwise when a decision moves, so each edit preserves whatever the old decision implied. The
reviewer catches it because a plan review reads the document as a set; the author does not, because
the author reads the diff. The rule therefore has to be about the order of authoring, not about
attention.

The section reads:

```markdown
## Artifact authoring

- Write a plan's decisions first and its acceptance criteria last, deriving each criterion from a named decision. The one exception is a row that records only a repository check the round must run; everything else names its decision.
- When a decision changes, re-derive every criterion that touches it instead of editing the one a finding named. A criterion is a consequence of a decision, so editing it in place preserves what the old decision implied.
- State an invariant positively: what stays the same, and the complete list of what changes. A closed claim such as "the only difference is X" is where an undercount hides.
- Before requesting review, read the criteria against the decisions as a set.
- An Evidence row reproduces the input that produced it, or names the file holding it, so a later reader can re-run it. Describing an input in place of quoting it is how an acceptance criterion gets written from a case that already passes.
- A task file created for later work leaves its author with a complete handoff envelope: `next_handoff_id`, the advisory `- Handoff:`, and the prompt's `(handoff HX-NNN)`, all agreeing. Queued is not a reason to omit it; a queued task is the one most likely to be opened cold.
```

The last two rules were added after the same day produced their own counter-examples: a probe table
row labelled "one literal `{`" whose recorded input actually held a closed brace pair, which would
have pinned a case that already passes; and three task files created with no envelope, which the owner
caught because closing the conversation would have left nothing naming the next host, model, or
invocation.

The section is prose and nothing parses it, for the reason D1 already gives: its reader is the agent authoring
the artifact, not the runtime. It is not part of the adoption text, is not repeated in the skill, and
does not enter `docs/ROUTING-AND-WORKFLOWS.md`, because it has nothing to do with the Bridge — a
repository that never installs the runtime benefits from it identically.

## Work Completed

- Planner (Claude Code, claude-opus-5, effort high, Anthropic): created this task from a design
  settled with the owner on 2026-08-19, including the placement under the binding table and the
  three-part condition. No product file was edited.
- Planner, second round (Claude Code, claude-opus-5, effort high, Anthropic): added D6 and its scope,
  criteria, and out-of-scope line, on the owner's instruction, after the day's review findings showed
  the criteria-versus-decisions pattern was recurring rather than incidental. A third round added the
  evidence-quoting and queued-envelope rules to the same section, on the owner's instruction that no
  project-relevant finding may live only in an assistant's memory. The same round extended D4 after the
  owner asked why a passed plan review printed a role-less `/spartan` suggestion: the branch is correct
  to name `/spartan`, and thin about which role and host it means. A fourth round settled the literal
  paragraph inside D3, which had been agreed in conversation and never written into the artifact — the
  same under-specification the reviewer of task `0021` named as `D2_RETENTION_CAP`. The plan review envelope
  advanced to HX-002 because the prompt now asks about both rules. No product file was edited.
- Planner, fifth round (Claude Code, claude-opus-5, effort high, Anthropic): read the acceptance
  criteria against D1-D6 as a set — the pass D6's fourth rule prescribes and which four rounds of
  additions had never had — and corrected what disagreed instead of restating it. Four disagreements.
  The criterion for this repository's `AGENTS.md` asked for the paragraph in two places at once, so D1
  now settles the placement and the criterion derives from it. Nothing required
  `skills/spbridge/SKILL.md` to carry the three conditions of D2 that Scope has asked for since the
  first round, or the `doctor` pointer that keeps the adapter condition from being guessed from a host
  name. The criterion for `docs/ROUTING-AND-WORKFLOWS.md` would have put a third copy of the D3
  paragraph into a repository where D3 makes two copies the whole point. And Objective, Scope, and Out
  of Scope still called D6 "the plan-authoring rule" after it grew to six rules covering evidence rows
  and queued handoff envelopes. Each criterion now names the decision it follows from. Checks:
  `npm run typecheck` and `npm test`. No product file was edited.
- Implementer (Cursor, cursor-grok-4.6-high-fast, effort none): accepted HX-006 and implemented the approved plan. Placed the D3 paragraph after the alias and fresh-context paragraphs in this repository's `AGENTS.md` and immediately under the adoption table in `README.md`; added the D6 `## Artifact authoring` section; rewrote `## Handoff authoring` to point at `doctor` and stop naming `spartan-bridge review`; stated D2/D4 in `skills/spbridge/SKILL.md`, including the amended read boundary and the `review_passed` print of role, bound host, and host-to-token mapping; noted declaration placement in `docs/ROUTING-AND-WORKFLOWS.md` without a third copy of the paragraph; added `tests/fixtures/agents-with-bridge-declaration.md` and parse-invariance / copy-identity tests. Checks: `npm run typecheck` exit 0; `npm test` exit 0, 165 tests, 0 fail.
- Reviewer (Claude Code, claude-opus-5, effort high, Anthropic): accepted HX-007 and reviewed the
  implementation read-only against the eleven acceptance criteria. Ten hold; the third does not, and
  two further defects are recorded as warnings that unmet no criterion. Producer and reviewer are
  independent: the implementation came from Cursor. Checks: `npm run typecheck`
  exit 0; `npm test` exit 0, 165 tests, 0 fail. No product file was edited.
- Implementer, second round (Cursor, cursor-grok-4.6-high-fast, effort none):
  accepted HX-008 and answered the three findings. The test extracts the D3 fence once; the routing
  note is below the copied fence; the Artifact authoring match is bounded at section end. Checks:
  `npm run typecheck` exit 0; `npm test` exit 0, 165 tests, 0 fail.
- Reviewer, second round (Claude Code, claude-opus-5, effort high, Anthropic): accepted HX-009 and
  re-reviewed the three findings read-only against the working tree. All three are answered and all
  eleven acceptance criteria now hold, so the task is closed as completed. The re-review checked the
  two regex-shaped fixes by running the test's own patterns against mutated copies in memory rather
  than by trusting a passing suite. Checks: `npm run typecheck` exit 0; `npm test` exit 0, 165 tests,
  0 fail. No product file was edited.

## Evidence

- `AGENTS.md`, "Handoff authoring" (before this round): instructed that the advisory names the
  `spartan-bridge review` command for a plan review in a Bridge-configured repository. After this
  round it points at the Agent hosts declaration and `spartan-bridge doctor`, and no longer names
  that command.
- `README.md` adoption section (before this round): "Adoption is exactly the pieces the runtime
  parses, plus one ignore rule". After this round that sentence is narrowed by the one project
  instruction under the host-binding table.
- `src/policy/agents-policy.ts`: `readFirstTable` stops at the first blank line or first non-pipe
  line, so prose under the binding table is not parsed and cannot disturb binding resolution.
- `~/.claude/skills/spbridge` is a symlink into this repository, linked 2026-08-18.
- Findings across tasks `0020` and `0021` on 2026-08-19: eleven in total, of which
  `UNCHAINED_CHAIN_SHAPE`, `UNCHAINED_DIGEST_PIN`, `UNCHAINED_AFTER_HASH`, `AC3_FAILURE_CLASS`, and
  the acceptance half of `D1_CANDIDATE_SCAN` were a criterion contradicting a decision. The first three
  are the same acceptance row in three consecutive cycles.
- The criterion this round split apart read: "`AGENTS.md` of this repository carries that same
  paragraph, byte-for-byte, directly under its `## Agent hosts` table and below the alias and
  fresh-context paragraphs already there". `AGENTS.md:24-33` holds the binding table on lines 24-29
  and two paragraphs on lines 31 and 33, so "directly under the table" and "below the alias and
  fresh-context paragraphs" name different positions and cannot both be met.
- `npm run typecheck` exit 0; `npm test` exit 0, 165 tests, 0 fail (was 162). The new tests compare
  the D3 paragraph across `README.md`, this repository's `AGENTS.md`,
  `tests/fixtures/agents-with-bridge-declaration.md`, and D3 of this artifact, assert
  `parseAgentsPolicy` unchanged for the paragraph and the D6 section, and assert that adoption,
  `skills/spbridge/SKILL.md`, and `docs/ROUTING-AND-WORKFLOWS.md` do not carry the D6 rules.
- Review round, copy count: `grep -rln "This repository runs the Spartan Bridge" --exclude-dir=node_modules
  --exclude-dir=.git .` returns five files - `README.md`, `AGENTS.md`, `tests/agents.test.ts`,
  `tests/fixtures/agents-with-bridge-declaration.md`, and this artifact. The third criterion names four.
- Review round, the fifth copy: `tests/agents.test.ts:411` opens `const DECLARATION =` with the whole
  paragraph written as a literal regex, escaped only at `.` and `/`:
  `/This repository runs the Spartan Bridge\. A producer round whose review the Bridge dispatches is\n...`
- Review round, `docs/ROUTING-AND-WORKFLOWS.md:63`: the sentence "The Bridge invocation paragraph from
  the README adoption section sits here, immediately under the table. Do not copy a third source of that
  text into this document; paste from the README when adopting." sits between the binding table and
  `Bindings not listed here follow the Agent Spartan Protocol defaults.`, both inside the ```markdown
  fence opened under "The minimum assisted three-host policy is:" and closed after the automation
  bullets.
- Review round: `npm run typecheck` exit 0; `npm test` exit 0, 165 tests, 0 fail, re-run on the
  working tree under review.
- Implementer, second round (Cursor, cursor-grok-4.6-high-fast, effort none):
  accepted HX-008. `tests/agents.test.ts` extracts the paragraph from the D3 fence and asserts the
  other three files contain that string; the routing note sits below the copied fence in
  `docs/ROUTING-AND-WORKFLOWS.md`; `ARTIFACT_AUTHORING` requires the six-bullet run to end at a blank
  line, a following heading, a closing fence, or end of string. Checks: `npm run typecheck` exit 0;
  `npm test` exit 0, 165 tests, 0 fail.
- Copy count after the second implementer round: `grep -rln "This repository runs the Spartan Bridge"
  --exclude-dir=node_modules --exclude-dir=.git .` returns four files — `README.md`, `AGENTS.md`,
  `tests/fixtures/agents-with-bridge-declaration.md`, and this artifact. `tests/agents.test.ts` is
  absent.
- `agent-spartan-protocol/README.md:169-173` describes the Bridge as optional, states that nothing
  depends on it, and delegates configuration to the Bridge project. A search of that repository found
  the Bridge named only in `README.md`, `AGENTS.md`, and its own task artifacts — never in the skill
  or its references.
- Re-review, copy count: `grep -rln "This repository runs the Spartan Bridge" --exclude-dir=node_modules
  --exclude-dir=.git .` returns exactly the four files the third criterion names — `README.md`,
  `AGENTS.md`, `tests/fixtures/agents-with-bridge-declaration.md`, and this artifact.
- Re-review, `tests/agents.test.ts:411`: `const D3_DECLARATION_FENCE = /### D3[^\n]*\n[\s\S]*?```markdown\n([\s\S]*?)\n```/;`
  extracts the paragraph once from D3 of this artifact, and the test then asserts `includes` on
  `AGENTS.md`, `README.md`, and the fixture. Divergence in any copy now fails a comparison rather
  than an extraction.
- Re-review, bounded section match: `tests/agents.test.ts:412` is
  `const ARTIFACT_AUTHORING = /## Artifact authoring\n\n(?:- .+\n){6}(?=\n|## |```|$)/;`. Run in
  memory against `AGENTS.md` it matches; against the same text with `- A seventh rule nobody derived.`
  inserted after the queued-envelope bullet it does not match; against the same text with the
  queued-envelope bullet removed it does not match. No file was modified by the probe.
- Re-review, `docs/ROUTING-AND-WORKFLOWS.md:78`: the placement sentence now sits after the fence that
  closes on line 76, outside the block an adopter copies, and still says the paragraph sits
  "immediately under the table".
- Re-review checks: `npm run typecheck` exit 0; `npm test` exit 0, 165 tests, 0 fail, run on the
  working tree under review.

## Review

<!-- spartan-bridge:review:begin -->
Verdict: CHANGES_REQUESTED

Findings:

- `D4_INVOCATION_SOURCE` (error): D4 and its criterion require the review_passed branch to print the role, the bound host, and 'the invocation that host uses' as facts read from the repository, and D4 introduces that triple as 'what the binding table says'. The Agent hosts table in AGENTS.md has only Binding, Host, Client context, Model, and Effort. Nothing in this plan adds an invocation column or any other host-to-invocation map, so the skill cannot read that third value rather than invent it.
- `D4_READ_BOUNDARY` (warning): D4 does not sit honestly beside the skill's hard boundary. Printing the artifact's next_role and the host bound to it requires reading task frontmatter and the binding table, which the same decision and criterion say the skill's hard boundary still forbids. A purpose split (read to name the next round, not to decide whether to invoke) is implementable, but then the boundary is amended, not preserved, and the plan should say that instead of 'still forbids reading'.
- `D3_CONDITION_MAP` (warning): D3 claims its three sentences carry D2's three conditions in reader order. They do not. Sentence 2 is D4's producer-round / plan-review restriction, not D2's working-adapter condition; adapter and runtime both live only as negatives in sentence 3. The fenced paragraph can still encode D2+D4 together, but D3's mapping disagrees with D2 and with the skill criterion that correctly lists declare, adapter, and installed.
- `D3_SHIPPED_UNIQUE` (warning): The D3 criterion requires the paragraph text to appear in no other shipped file, while the D1 parse criterion requires a fixture carrying that same paragraph. 'Shipped file' is undefined, so this is the closed uniqueness claim D6 rule 3 warns against. Name the allowed copies (README, this AGENTS.md, and any parse fixture) instead of asserting absence everywhere else.
- `D6_CHECK_EXCEPTION` (warning): The six D6 rules are otherwise specific enough to author against, but rule 1 requires every criterion to be derived from a named decision, and this plan's last acceptance criterion is explicitly a check with no decision. The fenced section that AGENTS.md must take byte-for-byte has no such exception. Add the exception to D6, or derive the check row from a named standing rule, before pasting it.

Bridge run: run_id=run-e27af0f6-435b-4faa-b892-faf0908f8b85 execution_id=exec-43de55ae-c36a-4f79-9c8a-eda5173ca948 review_kind=plan verdict=changes_requested reason_code=review_changes_requested host=cursor launcher=cursor-plan-reviewer-v1 model=cursor-grok-4.6-high-fast effort=none model_observed=declared_unobserved policy_digest=sha256:f86f80dd14e95d3612c0ccd72cfd9fa9c88077b82418a39aad6cdf7ffc8bcea7 task_hash=sha256:b415d0cbbfbbe120cf03e75ef75733d3f4931acd16219c3d6ccb42bc4d791a26 agents_hash=sha256:abddea169a1211006bd0e78f1b7ced5d708797901d12968e6b493c2b5cc6cd34 timestamp=2026-08-19T16:25:26.063Z
<!-- spartan-bridge:review:end -->

### Plan review, cycle 2 - recorded by the planner, not by the Bridge

Verdict: APPROVED

Run `run-7c2bbff2-0dc3-481a-a6a4-b819f2e34a05`, execution `exec-2ebb7ff7-2f71-406e-8283-d99ca62b7469`,
Cursor via the Bridge, cursor-grok-4.6-high-fast, effort none. The reviewer
returned `pass` with no findings and the runtime validated that result, storing it at
`reviews/exec-2ebb7ff7-….json` inside that run directory. The runtime then refused to persist it here
with `transition_next_role_not_reviewer` and `task_write_state: rejected`, because the producer round
that answered cycle 1 regenerated the handoff envelope without returning frontmatter `next_role` to
`reviewer`.

The refusal was a bookkeeping guard firing on a bookkeeping omission rather than on the condition it
exists to detect: a producer round did run, and its revision is what the reviewer approved. The
verdict is recorded here by the planner with its provenance stated, rather than re-run, because a
second review would cost another run and could return different findings on a plan that already
passed. The region above still holds cycle 1's `CHANGES_REQUESTED` as the Bridge wrote it, and any
later Bridge review overwrites that region.

The failure itself is not this task's to fix; it is planned as task `0029`.

### Implementation review, cycle 1 - recorded by the reviewer, not by the Bridge

Verdict: CHANGES_REQUESTED

Claude Code, claude-opus-5, effort high, Anthropic, the `reviewer.implementation` binding. The Bridge
dispatches plan review only, so this round ran through `/spartan` and wrote no Bridge-owned region.
Read-only: no product file was changed.

Ten of the eleven acceptance criteria held. Three findings, all answered in cycle 2:

- `AC3_FIFTH_COPY` (error, unmet criterion: the third): `tests/agents.test.ts:411` wrote the whole
  declaration paragraph out again as a literal regex, so the criterion's closed list of four files was
  false and the equality assertions compared four extractions of that one literal.
- `ROUTING_NOTE_INSIDE_FENCE` (warning, unmet criterion: none): the placement note sat inside the
  fenced policy block an adopter copies, carrying an instruction about the routing document into the
  adopter's own `AGENTS.md`.
- `D6_SECTION_MATCH_UNBOUNDED` (warning, unmet criterion: none): the `## Artifact authoring`
  comparison stopped after six bullets, so a seventh rule added to `AGENTS.md` alone would leave both
  extractions equal and the comparison passing while the tenth criterion became false.

### Implementation review, cycle 2 - recorded by the reviewer, not by the Bridge

Verdict: APPROVED

Claude Code, claude-opus-5, effort high, Anthropic, the `reviewer.implementation` binding, entered
through `/spartan` because the Bridge dispatches plan review only. Read-only: no product file was
changed. Producer and reviewer remain independent — both implementer rounds ran in Cursor.

All three findings are answered and all eleven acceptance criteria hold.

- The third criterion is true as written: the paragraph's text lives in `README.md`, this repository's
  `AGENTS.md`, the parse fixture, and D3 of this artifact, and nowhere else. `tests/agents.test.ts`
  extracts it once from the D3 fence and asserts the other three files contain that string, so a
  divergent copy fails a comparison instead of passing by construction.
- The routing note moved below the closing fence and still places the paragraph immediately under the
  table, so the copied block no longer carries an instruction addressed to this document's maintainer.
- The bullet-run match is bounded at a blank line, a following heading, a closing fence, or end of
  string. Probed in memory, a seventh bullet and a removed sixth bullet each break the match, so the
  count of six is asserted rather than assumed.

Nothing further was found. The two warnings from cycle 1 unmet no criterion and are closed by the
same fixes.

## Blockers

None.

## Next Action

None. This task is complete.

## Next Handoff

None. This task proposes no handoff.

The working tree still holds this task's diff, uncommitted. Commit is a human-only gate under
`AGENTS.md` and no round has been authorized to take it, so the diff is left for the human to commit
at the task boundary, together with this artifact.

Non-binding suggestion, which the human may decline: six of the seven active tasks — `0024` through
`0029` — still carry an advisory addressed to the reviewer that names
`spartan-bridge review --repo . --task ...`, which is exactly what the declaration this task adopted
tells a handoff author not to write. `0023` already names `/spbridge`.

```text
Recommended execution (human decides):
- Host: Claude Code, the `planner` binding in `AGENTS.md`; the follow-up rewrites handoff envelopes, not the worktree
- Model and effort: claude-opus-5, effort high
- Role: planner
- Invocation: `/spartan` in Claude Code, passing the prompt block below as the argument
```

```text
Create a new task in `spartan/tasks/` from `assets/task-template.md`, using the next unused four-digit number.

Act as planner. Plan bringing the outstanding handoff envelopes of the active tasks `0024` through `0029` in line with the Bridge declaration now in `AGENTS.md`: each advisory addresses the producer round that `/spbridge` enters rather than the reviewer, and no advisory names the `spartan-bridge review` command. Success is a plan that settles what each envelope's role, host, and invocation become, whether the identifier advances when only the advisory changes, and how the change is checked.
Run the relevant repository checks and update that new task file.

Return only the next handoff, or a completion notice if no work remains.
```
