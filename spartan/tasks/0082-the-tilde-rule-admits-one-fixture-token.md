---
protocol: "1.1.0" # x-release-please-version
id: the-tilde-rule-admits-one-fixture-token
created_at: 2026-09-12
status: active
phase: planning
task_type: planning
risk: material
current_role: planner
next_role: reviewer
updated_at: 2026-09-13
handoff_id: HX-002
next_handoff_id: HX-003
---

# The private-identity tilde rule admits one fixture token and fails the next

## Objective

`npm test` is green on a tree that names no private identity. The tilde
assertion in the private-identity check admits a class of placeholder tokens
rather than one literal, so a test proving the config parser refuses a tilde
scope entry, and a task file citing that test, do not count as disclosures. A
tilde path into a named working directory keeps failing.

## Context

`tildePathOffends` (`tests/repo-hygiene.test.ts:121-135`) admits exactly one
exception, `TILDE_FIXTURE` (`:47`), compared by whole-token equality against
`"~/src/"`. Its comment calls it "the negative fixture asserting that a tilde
scope entry is refused", so the intent is a kind; the implementation admits one
instance of it. The sibling `homePathOffends` (`:108-119`) admits a class
through `PLACEHOLDER_HOME_USERS` (`:42`).

Task `0080` (commit `20c4ce4`) added a second fixture of the same kind at
`tests/bridge-config.test.ts:213`. The pattern (`:122`) captures up to a
whitespace, quote or backtick delimiter and does not capture the delimiter, and
that line is a template-literal element, so the captured token is `~/build/\n`
— the two source characters of the escape are part of it. The first fixture
lives at `tests/implementation-review.test.ts:428` and captures as `~/src/`.

The scan reads tracked blobs, and prose that cites a fixture is scanned like
code. At `e50dc95` the test reports three offenders, not the one this task was
queued on: the `0080` fixture, task `0074`'s non-binding suggestion (which cites
`~/src/` and `~/build/`), and this task file itself, whose first version wrote
the rule's failing shapes as literals.

The rule's norm is written in two public places that must stay identical:
`AGENTS.md:169` and its mirror constant `ARTIFACT_AUTHORING_PRIVATE_IDENTITY_RULE`
at `tests/agents.test.ts:630`. The human operator changed the clause "nor the
single pinned negative fixture" to "nor a single placeholder segment standing
alone" in both, and that change is committed together with this plan revision.
Until the implementation lands, the sentence describes the rule D1 pins rather
than the one the test still enforces.

## Scope

- `tests/repo-hygiene.test.ts` — the preamble (`:6-38`), `TILDE_FIXTURE`
  (`:47`, removed), a new placeholder-segment set beside
  `PLACEHOLDER_HOME_USERS` (`:42`), `tildePathOffends` (`:121-135`), and
  `TILDE_CASES` (`:233-240`).
- `docs/DECISIONS.md` — one dated entry under the next unused `D-` number.
- `spartan/tasks/0082-the-tilde-rule-admits-one-fixture-token.md` — this file.
- Read, not edited: `tests/bridge-config.test.ts:213`,
  `tests/implementation-review.test.ts:428`,
  `spartan/tasks/0074-the-plan-target-scan-admits-illustrative-tokens.md`, and
  the already-landed clause at `AGENTS.md:169` and `tests/agents.test.ts:630`.

## Out of Scope

- `homePathOffends`, `addressOffends`, `aliasOffends` and their sets.
- When the check runs and what it reads (index versus worktree, the missing-`.git`
  behavior of `git()` at `:51`). That is task `0081`.
- Detecting a person, an organization, a product or an alias written as prose.
- Editing any fixture or any completed task file to avoid a token. The check
  adapts to the fixtures, not the reverse.
- `AGENTS.md` and `spartan-bridge/config.yaml`. Neither is edited by the
  implementation — the `AGENTS.md` clause landed with this plan revision — so
  this plan declares no human implementer and the plan-pass auto-chain may run.

## Constraints

- A retained case that must be reported cannot appear as a literal in
  `tests/repo-hygiene.test.ts`, because the file scans itself; it writes one
  marker character as a Unicode escape (`SLASH`, `:221`), as the existing cases
  do. A passing case must itself pass the scan: a case carrying the escape
  residue is written so its source text captures exactly the admitted token
  (for example with `String.raw`), never as a doubled backslash.
- The implementation leaves the `AGENTS.md:169` sentence and its mirror at
  `tests/agents.test.ts:630` byte-identical to each other and unchanged.

## Decisions

- **D1 — the rule admits a lone placeholder segment.** A tilde token is admitted
  when it is exactly a tilde, a slash, one segment from a new set
  `PLACEHOLDER_TILDE_SEGMENTS = new Set(["src", "build"])`, and a slash —
  optionally followed by exactly the two characters of a source `\n` escape and
  nothing else. The dotfile branch is unchanged, and the check runs on the whole
  captured token, so any trailing character other than that one escape still
  offends. Extending the class is one word in the set, as with
  `PLACEHOLDER_HOME_USERS`. `TILDE_FIXTURE` is removed. What each candidate
  would let a real disclosure hide behind:
  - *A whole-token set.* Today it needs three entries — `~/src/`, `~/build/`
    and `~/build/` with the escape residue — three because there are two
    segments and one of them also appears with the residue. Delimiters are not
    captured, so a quoted or backticked citation reuses an existing entry. It
    hides nothing new, and today it admits exactly what the chosen rule admits.
    The two diverge only when the class grows: a new word needs one set entry
    under the chosen rule and up to two tokens under this one, because the
    residue is spelled per token instead of once. The difference is the shape
    of maintenance, not safety; the chosen rule is kept because it separates
    the classifying vocabulary from the source spelling, as the home rule does.
  - *A shape rule alone* (one segment between slashes). Hides a one-segment
    directory named after a client, a person or a product — a tilde, a slash,
    and an organization name. Rejected.
  - *A first-segment placeholder set, as the home rule does it.* Hides any path
    under an admitted segment: a tilde, then `src/` and a private repository's
    name, which is D2's case moved one level down. Rejected.
  - *Retiring the matcher.* Hides every working-directory path, including the
    one `AGENTS.md:169` calls the line most worth quoting — a path to a private
    repository a dogfooding round ran in. A tilde path is a real carrier for a
    repository name, so the matcher earns its place. Rejected.
  - *Chosen: shape and vocabulary together.* It hides only a generic directory
    word standing alone — which discloses where someone keeps code, not who
    they are or what they work on. D3 states that residual instead of
    implying coverage.
- **D2 — what must keep failing.** A tilde path into a named working directory:
  a tilde, then `Documents/DEV/` and a repository name. Under D1 it offends on
  two independent grounds — `Documents` is not in the set, and the token has
  more than one segment. So does a path under an admitted segment (a tilde,
  then `src/x`), a bare non-placeholder segment (a tilde, then
  `notaplaceholder/`), and a token continuing past the escape residue (a tilde,
  then `build/\nx`). Each becomes a retained offending case; the existing
  `Documents/x`, `src/,x`, `src/)x` and `.config/../x` cases stay.
- **D3 — the stated limits change.**
  - The preamble gains one paragraph: the tilde exception is a lone placeholder
    segment plus the one escape residue; why a first-segment rule was not
    enough; and that a generic directory word standing alone is admitted even
    when it is someone's real directory, because that names a habit, not an
    identity.
  - The public sentence already reads "nor a single placeholder segment
    standing alone" in `AGENTS.md:169` and `tests/agents.test.ts:630`; the
    implementation does not touch it.
  - `docs/DECISIONS.md` gets one entry, because the check's meaning changes from
    one pinned token to a class.
- **D4 — the auto-chain may implement.** The only edit outside the automatic
  write scope (`AGENTS.md:90-100`) was the `AGENTS.md` clause, which the human
  operator landed before implementation (owner decision, 2026-09-13), so no
  human implementer is declared. The approved plan still names `AGENTS.md` as
  read-only context; the post-pass scan records such tokens on
  `unwritable_plan_targets` as an advisory and does not stop the chain. For the
  record: `review` accepts only `--repo`, `--task`, `--after-run`, `--detach`
  and `--run-id` (`src/cli/parse.ts:74`, `:86`), none of which suppresses the
  successor, and `PLAN_REVIEW_NEXT_ROLE.pass` is `"implementer"`
  (`src/core/task-write.ts:94-97`).
- **D5 — this file carries no failing literal.** Its illustrative shapes are
  written as prose. Task `0074` is admitted unedited under D1.

## Acceptance Criteria

Derived from D1–D5.

1. (D1) `TILDE_FIXTURE` is gone. `PLACEHOLDER_TILDE_SEGMENTS` holds exactly
   `src` and `build`. `tildePathOffends` admits a non-dotfile token only in the
   D1 shape, and the dotfile branch is byte-identical.
2. (D1) `TILDE_CASES` keeps `~/.config/git/ignore` passing, and adds passing
   cases for `~/src/`, `~/build/`, and `~/build/` followed by the literal
   two-character escape.
3. (D2) `TILDE_CASES` keeps its four existing offending cases and adds the four
   named in D2, each written with `SLASH`. The tilde-path retained-cases test
   passes.
4. (D3) The preamble carries the paragraph D3 names, and
   `docs/DECISIONS.md` has one new dated entry naming task `0082`.
5. (Constraints, Out of Scope, D5) The implementation's diff leaves
   `AGENTS.md`, `tests/agents.test.ts`, `tests/bridge-config.test.ts`,
   `tests/implementation-review.test.ts`, task `0074`, and the other three
   matchers and their sets unchanged.
6. With the change staged (the scan reads the index), `npm test` reports 0
   failures and `npm run typecheck` exits 0.

## Work Completed

- 2026-09-12 (human-operator, Claude Code, claude-opus-5): queued while closing
  task `0074`.
- 2026-09-13 (planner, Claude Code, claude-opus-5, Anthropic; handoff HX-001):
  re-verified every reference at `e50dc95`, found three offenders, traced the
  fixture's captured token to its escape residue, pinned D1–D5, derived the
  criteria last, and routed the plan review manually.
- 2026-09-13, adopted plan review for HX-002 (reviewer, Codex, GPT-5.6 Sol, high
  effort, OpenAI; read-only, returned to the human): **CHANGES_REQUESTED**.
  Adopted findings: (1) D1 misstated whole-token capture — quotes and backticks
  are not captured, the whole-token set needs three entries because of two
  segments and the escape residue, and the tradeoff had to be reconsidered;
  (2) D4's CLI evidence was incomplete — `src/cli/parse.ts` also parses
  `--detach`, `--run`, `--timeout-ms`, `--transition` and `--role`, and the
  defensible claim is what `review` accepts. The reviewer confirmed the other D1
  candidate claims by probe and noted an unrelated untracked task `0085` in the
  worktree. Recorded here rather than in `## Review`, which the Bridge requires
  to stay the placeholder.
- 2026-09-13 (planner, Claude Code, claude-opus-5, Anthropic; persist and
  correct, owner-authorized): corrected D1's whole-token comparison and kept the
  chosen rule on maintenance shape, rewrote D4 with the `review` option list,
  and — after the human operator landed the `AGENTS.md:169` clause — applied the
  identical clause to `tests/agents.test.ts:630` on the owner's instruction,
  removed `AGENTS.md` from the implementation scope and declared no human
  implementer.

## Evidence

- `NO_COLOR=1 npm test` at `e50dc95`: 618 tests, 617 pass, 1 fail — "a tilde
  path names a dotfile", `actual` listing tracked entries 105, 113 and 168 of
  210: task `0074`, this file, and `tests/bridge-config.test.ts`.
- Captured tokens with the `:122` pattern (Codex probe, reproduced here):
  `tests/bridge-config.test.ts:213` gives `~/build/` with the escape residue;
  `tests/implementation-review.test.ts:428` gives `~/src/`; task `0074` gives
  `~/src/` and `~/build/`.
- A local simulation of D1 over this file, task `0074` and both fixture files
  reports no tilde offender, and the home, address and alias matchers report
  none either.
- `git log -S` on `tests/bridge-config.test.ts` names `20c4ce4`, task `0080`.
- `src/cli/parse.ts:74` and `:86`: `review` accepts `--repo`, `--task`,
  `--after-run`, `--detach` and `--run-id`. `src/core/task-write.ts:94-97`:
  `PLAN_REVIEW_NEXT_ROLE.pass` is `"implementer"`.
- After the clause landed in both copies: `node --import tsx --test
  tests/agents.test.ts` gives 18 tests, 18 pass.
- `spartan-bridge doctor`: `reviewer.plan` is available through
  `codex-plan-reviewer-v1`. `spartan-bridge policy --role planner`: `strict`,
  `claude-opus-5`, and the session matched.

## Review

Verdict: PENDING

Findings:

- None recorded.

## Blockers

None.

## Next Action

The Bridge dispatches the plan review for D1–D5 and the criteria; on a pass the
auto-chain implements and reviews the implementation.

## Next Handoff

```text
Recommended execution (human decides):
- Host: Codex (repository binds reviewer.plan to Codex; cross-vendor from a Claude plan)
- Model and effort: GPT-5.6 Sol, reasoning effort high (fallback GPT-5.6 Terra at high)
- Role: reviewer
- Handoff: HX-003
- Permission: read-only
- Invocation: dispatched by `spartan-bridge review` through `/spbridge`
```

```text
Open `spartan/tasks/0082-the-tilde-rule-admits-one-fixture-token.md` (handoff HX-003).

Act as reviewer. Review the revised plan as a whole, including whether D1's corrected whole-token comparison still supports the chosen rule and whether D4 may let the auto-chain implement. Return exactly one APPROVED, CHANGES_REQUESTED, or BLOCKED verdict with findings, evidence, and the host, model, effort, and vendor you actually ran. Change no repository file. Run only checks that write nothing. A write failure from a check you could not run is not a product defect.
```
