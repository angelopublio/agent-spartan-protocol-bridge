---
protocol: "1.0.0" # x-release-please-version
id: make-a-new-repository-adoptable
created_at: 2026-08-18
status: completed
phase: complete
task_type: implementation
risk: material
current_role: reviewer
next_role: none
updated_at: 2026-08-18
handoff_id: HX-005
next_handoff_id: none
---

# Make a new repository adoptable without tacit knowledge

## Objective

Someone configuring a repository for the Bridge for the first time can follow the documentation
and succeed, and when they get it wrong the runtime tells them what is missing rather than
returning a code they must decode.

## Context

Configuring a repository today requires knowing several things that are written nowhere
together: the `## Agent hosts` table needs exactly five columns with exact headers, a
`reviewer.plan` row must exist, the `## Spartan Bridge automation authority` section needs
sentences matched byte for byte, `.spartan-bridge/` must be ignored, and the model identifier
must be one the client accepts.

Worse than undocumented, part of it is now actively wrong. `README.md` carries five binding-table
examples, at lines 70, 86, 95, 130 and 154, and every one shows three columns. Task `0009` made
five columns mandatory with no legacy fallback, deliberately. Anyone who follows the README today
gets `agents_policy_invalid`, and the document that would explain the failure is the document
that caused it.

The owner reached this by asking how a future repository would be configured correctly, which is
the right question: the knowledge currently lives in one person's memory of a long working
session.

## Scope

- `README.md`: the five binding-table examples and the surrounding adoption instructions.
- `AGENTS.md`: the sentence enumerating what `doctor` may check. See D2 — this is an amendment,
  not an interpretation.
- `src/policy/agents-policy.ts`: structured failure detail on the existing return. See D5.
- `src/core/doctor.ts`: the policy-readiness field and its rendering.
- `src/cli/main.ts`: the `doctor` exit code.
- `docs/AUTHENTICATION-AND-SECURITY.md`: the `doctor` behaviour section.
- Tests for the new field, for an unconfigured repository, and for each named malformation.

## Out of Scope

- Any change to what the policy parser accepts. This task reports on the existing rules; it does
  not relax or extend them.
- Making the `/spbridge` skill verify anything. Task `0011` recorded `SECOND_RESOLVER`: the skill
  must not parse policy, and a readiness check there would be a second resolver that can disagree
  with the first.
- Writing or repairing any repository's `AGENTS.md` automatically.
- Adding a scaffolding or `init` command.

## Constraints

- `doctor` stays read-only and spawns nothing.
- `doctor` must not implement any parsing of its own. It calls the existing
  `parseAgentsPolicy` and reports what that returns. This is new resolution for `doctor`,
  which is why D2 amends the enumeration rather than claiming the check was already allowed.
- No model identifier may be checked against an account's entitlements. The Bridge may report
  that a declared model fails the charset; it may never ask which models are available.
- The report adds one line and does not reorder or reword the existing ones.

## Acceptance Criteria

- [x] Every binding-table example in `README.md` uses the five required columns with the exact
      headers and shows a `reviewer.plan` row.
- [x] The adoption instructions state everything a repository needs in one place, including the
      ignore rule for the runtime directory.
- [x] `AGENTS.md` enumerates policy readiness among the facts `doctor` may check.
- [x] `doctor` reports one additional line stating whether the repository is configured for the
      Bridge and, when it is, whether its policy resolves.
- [x] A repository with no `## Agent hosts` section reports as not configured and exits 0.
- [x] A repository configured but invalid names the first failing check and what it should look
      like, and exits 1.
- [x] Each malformation listed in D4 is named distinctly and covered by a test.
- [x] `doctor` calls `parseAgentsPolicy` and contains no policy parsing of its own.
- [x] Nothing in the report discloses anything the authentication boundary forbids.
- [x] `npm run typecheck` and `npm test` exit 0.

## Decisions

Revised after the Bridge plan review recorded `D3-UNDECIDED`, `DOCTOR-POLICY-LIMIT`,
`REPORT-UNDER-SPEC`, and `DOCTOR-RESOLVE-SCOPE`. All four are accepted.

### D1 - The stale examples are the urgent half

Unchanged. Documentation that is merely incomplete lets a careful reader succeed; documentation
that is wrong sends them into a failure whose cause is invisible. Five examples currently teach a
table shape the parser rejects, so this is a correction and is worth doing even if the rest is
deferred.

### D2 - This widens what `doctor` may check, and the amendment is in scope

The earlier version claimed policy readiness "fits inside the existing limit". That was wrong.
`AGENTS.md` does not describe a category, it enumerates a closed list: repository readability,
registry readability and schema validity, launcher identifier resolution, fake-interface
capability flags, and Cursor launcher executable and interface availability. Root policy validity
is not on it, and `doctor` does not read `AGENTS.md` at all today.

So this task amends that sentence to include policy readiness, deliberately and in scope, rather
than reasoning its way around it. Task `0006` narrowed `doctor` on purpose; widening it back is a
policy decision that belongs in the file, not in an interpretation.

The boundary the amendment must preserve, stated in the same sentence: readiness covers
repository content only. What a section says, what shape a table has, whether a required sentence
is present, whether a declared value satisfies a charset. It never covers account state,
entitlements, or whether a client is signed in.

`doctor` calls the existing `parseAgentsPolicy` and reports its result. It implements no parsing,
so there is no second resolver.

### D3 - The adoption example shows only what the parser requires

Decided, rather than left open.

The example contains the `## Agent hosts` table with its five columns and a `reviewer.plan` row,
the `## Spartan Bridge automation authority` section with the sentences matched byte for byte,
and the ignore rule for the runtime directory. Nothing else.

The reason is authority. The Bridge's claim on a consumer repository stops exactly at what it
parses. Role permissions, commit sequencing, and an authentication boundary are worth having, and
this repository has them — but shipping them inside a Bridge adoption example makes the runtime
appear to prescribe repository instructions it has no authority over, and those sections
legitimately differ per project. The instructions may point out that a repository usually wants
more; they may not supply it as a template.

### D4 - The report contract

The earlier version said "name the first missing piece", which is a preference, not something an
implementer can build to. Concretely:

`DoctorReport` gains one field: whether the repository is configured for the Bridge at all,
whether its policy resolves, and when it does not, the reason code and one human sentence naming
what should be there.

Rendering is one line, placed immediately after the repository line, leaving every existing line
untouched.

Order: the check runs after repository readability, because it needs the repository, and is
independent of the registry and launcher checks, which continue to run either way. A repository
that is not configured for the Bridge still gets its registry and launcher facts.

Not configured means the root `AGENTS.md` has no `## Agent hosts` section. That is reported
plainly and exits 0: a repository that never adopted the Bridge is not broken.

Configured but invalid exits 1, because at that point the human intended to configure it and did
not succeed, which is the case `doctor` exists to catch before a two-minute run fails.

The malformations to name distinctly, each being a separate wrong thing a human does: no
`## Agent hosts` section; a table whose column count or headers are wrong; a missing
`reviewer.plan` row; an unknown host name; a client-context alias failing its pattern; a model
identifier failing its charset; an effort value outside the vocabulary; a missing
`## Spartan Bridge automation authority` section; a missing or duplicated grant sentence; a
missing or malformed cycle sentence; and the standalone conflict sentence that denies automatic
review while a grant is present.

That last one deserves its own message rather than a generic invalid: a repository carrying both
a grant and the conflict sentence looks configured and is not, and the reason is a single line of
prose that is easy to miss.

### D5 - The parser must say which check failed, additively

The revised plan asked `doctor` to separate "not configured" from "configured but invalid" and to
name eleven malformations distinctly, while forbidding it from parsing anything itself and
leaving the parser out of scope. Those three requirements cannot hold together, because the
parser cannot currently make the distinction the exit code depends on.

Measured against the source: `parseAgentsPolicy` has eighteen failure returns collapsed into four
reason codes. Two of them matter here and are the same code. A root file with no `## Agent hosts`
section returns `reviewer_binding_missing` at line 77; a file that has the section but no
`reviewer.plan` row returns `reviewer_binding_missing` at line 127. Those are exactly the
not-configured and configured-but-broken cases, and nothing downstream can tell them apart. Nine
further returns collapse into `agents_policy_invalid`, which is every table and value
malformation D4 names.

So the parser is added to scope, and gains a structured detail on its failure return naming which
check failed. The change is strictly additive, and the plan commits to that in a form a reviewer
can verify:

- every input that resolves today still resolves, unchanged;
- every input that fails today still fails, with the same `reason` value it returns now;
- only the failure return carries more information, in a new field callers may ignore.

That keeps `Out of Scope`'s rule intact — nothing changes about what the parser accepts — while
giving `doctor` a fact to report instead of a code to guess behind. `doctor` still implements no
parsing: it calls the resolver and renders what comes back.

## Work Completed

- Planner (Claude Code, Claude Opus 5, high effort, Anthropic): located the five stale examples,
  confirmed the parser requirement they contradict, and recorded D1-D3. No product file changed.

- Planner (HX-001, Claude Code, Claude Opus 5, high effort, Anthropic): accepted matching
  envelope HX-001. Accepted all four findings. Decided D3, corrected D2 into an explicit
  amendment with the enumeration added to Scope, specified the report contract as D4, and
  reworded the resolver constraint. Confirmed against the source that `doctor` does not read
  `AGENTS.md` today and that its exit code is currently `repo_readable ? 0 : 1`. No product file
  changed.

- Planner (HX-002, Claude Code, Claude Opus 5, high effort, Anthropic): accepted matching
  envelope HX-002. Accepted `PARSER-OUTPUT-CONTRACT`, measured the parser's failure returns
  against the source, and added D5 plus `src/policy/agents-policy.ts` to scope. No product file
  changed.

- Plan review (HX-003, Cursor, cursor-grok-4.6-high-fast, effort none), dispatched by the runtime: `APPROVED`, no findings. Run `run-d3fd3d9d`,
  terminal `awaiting_implementer`, `task_write_state: written`. Three review cycles in total:
  four findings, then one, then none.

- Implementer (HX-004, Cursor, cursor-grok-4.6-high-fast, effort none): accepted matching envelope HX-004. Implemented D1-D5 in the named scope.
  The five README binding tables now use the required headers and a `reviewer.plan` row; the
  adoption example is only what the parser requires plus the `.spartan-bridge/` ignore rule.
  `AGENTS.md` enumerates policy readiness. `parseAgentsPolicy` failure returns gained an additive
  `detail` field (`check` and `message`); success returns and `reason` values are unchanged.
  `doctor` calls that parser, emits one policy line after the repository line, exits 0 when not
  configured, and exits 1 when configured but invalid.

## Evidence

- `README.md` binding tables at the client-context example, two-host profile, three-host
  profile, adoption example, and two-host variant each have headers `Binding`, `Host`,
  `Client context`, `Model`, `Effort` and a `reviewer.plan` row. The adoption fence parses:
  `parseAgentsPolicy` on that block returns `ok: true`.
- `AGENTS.md` doctor enumeration now includes policy readiness, limited to repository content.
- Failure returns from `parseAgentsPolicy` carry `detail.check` and `detail.message`; success
  returns have no `detail` field. Existing `reason` assertions still hold.
- `formatDoctorReport` emits `policy:` immediately after `repo:`. `doctorExitCode` is 0 when
  `configured` is false and 1 when `configured && !resolves`.
- `npm run typecheck` exit 0. `npm test` 104 passed, 0 failed.

## Review

<!-- spartan-bridge:review:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-d3fd3d9d-217b-473d-9328-c80c8d9df28d execution_id=exec-923c3a2e-face-4b4e-89e6-c1677c639003 review_kind=plan verdict=pass reason_code=review_passed host=cursor launcher=cursor-plan-reviewer-v1 model=cursor-grok-4.6-high-fast effort=none model_observed=declared_unobserved policy_digest=sha256:5ce5ce183767d86bbd03d6217f03b8849dd70c4a7609b5b84f750ecbb1d0100f task_hash=sha256:7e8b991575e94600e398490d1987b6e1bad8a69ffa0feafa580e3e24f83b3645 agents_hash=sha256:2486ba5b0b16bb15021f20a255bde0c34cb0ca795c94afc74e00e4ca8f91ad2d timestamp=2026-08-18T09:29:18.815Z
<!-- spartan-bridge:review:end -->

Verdict: PENDING

Findings:

- None recorded.

### Implementation review (HX-005, Claude Code, Claude Opus 5, high effort, Anthropic)

Verdict: APPROVED. Accepted matching envelope HX-005; product files were read only, and only
this artifact was written.

The claim carrying the most risk was D5's, that the parser change is strictly additive, so it
was verified rather than taken on trust.

- **Reasons are preserved.** All eighteen previous failure returns were rewritten through one
  `fail(reason, check, message)` helper, and every reason value survives: thirteen
  `agents_policy_invalid`, five `automatic_review_not_authorized`, three
  `reviewer_binding_missing`, one `host_invalid`. The two returns the whole task depends on
  still share their reason — `agent_hosts_section_missing` and `reviewer_plan_row_missing` both
  return `reviewer_binding_missing` — while now carrying distinct checks. That is exactly the
  shape D5 promised.
- **The four extra call sites are splits, not new failures.** Combined conditions became
  separate ones so each could name itself: the model and effort checks separated, and
  `grants.length > 1 || cycles.length > 1 || taskWrites.length > 1` became three. Same inputs,
  same outcomes, finer attribution.
- **Real behaviour is unchanged.** The three configured repositories still resolve, and the
  unconfigured one still fails with `reviewer_binding_missing` — now carrying
  `agent_hosts_section_missing`, which is the task's whole point demonstrated on a real file.
- **`doctor` implements no parsing.** It calls `parseAgentsPolicy` once and renders the result.
  No heading constant, no regular expression, no section splitting of its own.

The three exit-code cases behave as D4 specified: `policy: configured; resolves` at 0,
`policy: not configured` at 0, and `policy: configured; invalid (reviewer_binding_missing): The
host-binding table must include a reviewer.plan row.` at 1. That last message names what should
be there rather than leaving a code to decode, which is the defect this task existed to remove.

`README.md` now has five five-column examples and no three-column example. `AGENTS.md` adds
policy readiness to the enumeration, so the widening is recorded where the authority lives
rather than assumed. `npm run typecheck` clean; `npm test` 104 pass, 0 fail.

Findings:

- `CHECK-COVERAGE-PARTIAL` (info): eleven of the seventeen `AgentsPolicyCheck` values appear in
  tests — the eleven D4 named. Six have no test anywhere: `agent_hosts_section_duplicate`,
  `binding_table_missing`, `binding_row`, `binding_duplicate`, `automation_section_duplicate`,
  and `task_artifact_write_grant`. The acceptance criterion asked for D4's list and that is met,
  so this is not a shortfall against the plan. But a wrong reason-to-check pairing on those six
  would not be caught, and they are reachable inputs. Worth closing whenever this file is next
  opened.
- `STALE-DIST-AGAIN` (info, not a defect of this task): `dist/` was stale during this review and
  the first `doctor` run printed no policy line at all, which reads as the feature missing rather
  than the binary being old. This is the second time in two days. It is the known gap with no
  task, and this occurrence is evidence for opening one: the failure mode is silent and mimics
  absence.

## Blockers

None.

## Next Action

None. Every acceptance criterion is checked, `npm run typecheck` and `npm test` have recorded
outcomes, the plan review and the implementation review are both `APPROVED`, and no blocker
remains. Committing is the human-only gate.

## Next Handoff

No outstanding proposal. This task is closed.

Non-binding note for the human: `dist/` needs rebuilding before the next run, and the two
informational findings above are candidates for a small follow-up task rather than work on this
one.
