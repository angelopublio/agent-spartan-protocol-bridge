---
protocol: "1.1.0" # x-release-please-version
id: the-tilde-rule-admits-one-fixture-token
created_at: 2026-09-12
status: active
phase: planning
task_type: planning
risk: minor
current_role: planner
next_role: planner
updated_at: 2026-09-12
handoff_id: none
next_handoff_id: HX-001
---

# The private-identity tilde rule admits one fixture token and fails the next

## Objective

`npm test` is green on a tree that names no private identity. The tilde
assertion in the private-identity check recognizes the class of tokens a
negative fixture uses, so a test that proves the config parser refuses a tilde
scope entry does not itself count as a disclosure.

## Context

`npm test` on this checkout reports 588 of 589 at commit `a2ac382`. The single
failure is `tests/repo-hygiene.test.ts:176`, "a tilde path names a dotfile",
reporting one offender as `tracked entry 161 of 202`.

The offending token is `~/build/` at `tests/bridge-config.test.ts:213`. It sits
in a list of malformed scope entries the config parser must **refuse** —
alongside `/build/`, `!build/`, `build/./out/` and `build/../out/` — and was
added by commit `20c4ce4` (task `0080`). It names no user, no organization and
no machine: the tilde is the anonymization, not the leak.

`tildePathOffends` (`tests/repo-hygiene.test.ts:121-135`) admits exactly one
exception, `TILDE_FIXTURE` (`:47`), compared as a whole-token string equality
against the literal `"~/src/"`. That constant's own comment calls it "the
single tilde exception … the negative fixture asserting that a tilde scope
entry is refused" — so the intent is already to admit fixtures of that kind.
The implementation admits one instance of the kind instead.

**The asymmetry that names the defect.** The sibling matcher solves the same
problem as a class. `homePathOffends` (`:108-119`) does not pin one admissible
path; it reads the first non-empty segment and admits it when
`PLACEHOLDER_HOME_USERS` (`:41`) has it — seven names, extensible without
touching the matcher. The tilde rule is the only one of the four whose
exception is a single literal, and it is the only one that a second legitimate
fixture breaks.

**Why this is worth a task rather than an edit.** The cheap fix — adding
`"~/build/"` beside `"~/src/"` — reproduces the defect at the next fixture and
teaches the next author that the private-identity check is something to
append to rather than something that classifies. The cost of leaving it is
that the suite's baseline carries a standing red line that says "private
identity" and means "a synthetic fixture", so every future round's human gate
has to re-establish that the failure is not about the change under review.
Task `0078` exists because that class of false reading already cost a round.

**What this task must not assume.** The rule's stated norm — "a `~` path in
this repository names a dotfile; a personal working directory does not" — is
weaker than the other three matchers. `~/src/` discloses no identity by any
reading; what it discloses is the author's directory habit. Whether that norm
earns a matcher at all, at this false-positive rate, is a question the planner
round should answer rather than inherit.

## Scope

To be pinned by the planner round. The surface is small:

- `tests/repo-hygiene.test.ts` — `TILDE_FIXTURE` (`:47`) and
  `tildePathOffends` (`:121-135`), and the preamble comment (`:5-38`) if the
  decision changes what the rule claims to cover.
- `docs/DECISIONS.md` — one dated entry, only if the decision changes what the
  check means rather than how it spells an existing exception.
- `tests/bridge-config.test.ts:213` — read, not edited: it is the fixture the
  rule must admit, and the task does not adapt the fixture to the rule.

## Out of Scope

- The other three matchers (`homePathOffends`, `addressOffends`,
  `aliasOffends`) and their placeholder, address and alias sets.
- When the check runs and what it reads — the index-versus-worktree gap, the
  missing-`.git` behavior of `git()` at `:51`. That is task `0081`, whose Out
  of Scope excludes this task's subject in the same words reversed.
- The `FORCE_COLOR` / `NO_COLOR` stderr failures. That is task `0078`.
- Detecting a person, an organization, a product or an alias written as prose.
  The file's own preamble records why that is out of reach.
- Changing `tests/bridge-config.test.ts` to avoid the token. The check adapts
  to the fixtures, not the reverse.

## Decisions

To be decided by the planner round:

- **D1 — what class the rule admits.** Candidates: a set of admissible fixture
  tokens, like `PLACEHOLDER_HOME_USERS` but of whole tokens; a shape rule over
  the token itself (both known fixtures are `~/<one-segment>/`, a bare scope
  entry rather than a path into a working directory); a first-segment
  placeholder set mirroring the home rule; or retiring the tilde matcher on
  the ground that a tilde token names no identity. Each admits something that
  a future disclosure could hide behind — say what, for each.
- **D2 — what must keep failing.** Name the token the rule exists to catch,
  and confirm the candidate in D1 still catches it. A tilde path that documents
  a personal working directory is the case; `~/Documents/DEV/<repo>` is its
  shape.
- **D3 — whether the preamble's stated limits change.** The comment at `:5-38`
  enumerates what each matcher does and does not cover. If D1 narrows the
  tilde rule, that enumeration is part of the deliverable, not an afterthought.

## Acceptance Criteria

To be derived from the decisions once pinned, not before. At minimum
`npm test` reports no failure on a clean checkout, and the `~/build/` and
`~/src/` fixtures both survive in `tests/bridge-config.test.ts` unedited.

## Work Completed

- 2026-09-12 (human-operator, Claude Code, claude-opus-5): queued while closing
  task `0074`, whose full-suite run surfaced the failure. The offending token,
  its introducing commit, both matchers and the exception constant were read in
  this checkout before this file was written, and `0081` and `0078` were each
  checked for whether they absorb the defect. Neither does: `0081` excludes the
  matchers by name, `0078` is a different mechanism in different files.

## Evidence

- `npm test` on this checkout at `a2ac382`: 589 tests, 588 pass, 1 fail. The
  failure is `tests/repo-hygiene.test.ts:176`, assertion message "a `~` path in
  this repository names a dotfile; a personal working directory does not",
  `actual: ['tracked entry 161 of 202']`, `expected: []`.
- `tests/bridge-config.test.ts:213` — the token `~/build/` inside a list of
  malformed scope entries asserted to be refused, between `- /build/` and
  `- !build/`.
- `git log -S'~/build/' -- tests/bridge-config.test.ts` names `20c4ce4`, task
  `0080`, as the introducing commit.
- `tests/repo-hygiene.test.ts:47` — `const TILDE_FIXTURE = "~/src/";` with the
  comment "The single tilde exception is the negative fixture asserting that a
  tilde scope entry is refused. Compared against the whole captured token."
- `tests/repo-hygiene.test.ts:121-135` — `tildePathOffends`, whose only
  exception is `found === TILDE_FIXTURE`, followed by the dotfile-not-traversal
  branch.
- `tests/repo-hygiene.test.ts:108-119` — `homePathOffends`, the sibling matcher
  that admits a class through `PLACEHOLDER_HOME_USERS` (`:41`, seven names)
  rather than a single literal.
- `tests/repo-hygiene.test.ts:96-106` — `scan`, which reports
  `locate(entry)` positions only, never a path or the matched value.
- Task `0081` `## Out of Scope`: "The four matchers and their placeholder,
  address and alias sets. This task is about when the check runs and what it
  reads, not about what it matches." Task `0078` `## Scope`: the three spawn
  helpers in `tests/cli.test.ts` and the one in `tests/mcp.test.ts`.
- Task `0074` `## Next Handoff` carries the non-binding suggestion this task
  discharges.

## Review

Verdict: PENDING

Findings:

- None recorded.

## Blockers

None.

## Next Action

A planner round: pin D1 through D3 against the two known fixture tokens and the
personal-working-directory case D2 names, verify every path and line reference
in this checkout, derive the acceptance criteria from the pinned decisions
last, then let the Bridge dispatch the plan review.

## Next Handoff

```text
Recommended execution (human decides):
- Host: the host this repository binds to `planner`
- Role: planner
- Handoff: HX-001
- Permission: writable
- Invocation: `/spbridge`
```

```text
Open `spartan/tasks/0082-the-tilde-rule-admits-one-fixture-token.md` (handoff HX-001).

Act as planner. Pin D1 by weighing the four candidates, and for each say what it would let a real disclosure hide behind — a rule over token shape has no free option. Pin D2 as the case that must keep failing, and confirm the D1 candidate still catches it. Pin D3.

Verify every path, symbol and line reference exists in this checkout, including the two fixture tokens and the introducing commit. Derive the acceptance criteria from the pinned decisions, last. Keep `## Review` as the `Verdict: PENDING` placeholder and `phase: planning`.

Then let the Bridge dispatch the plan review.
```
