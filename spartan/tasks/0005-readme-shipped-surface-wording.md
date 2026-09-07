---
protocol: "0.6.1" # x-release-please-version
id: readme-shipped-surface-wording
created_at: 2026-08-17
status: completed
phase: complete
task_type: implementation
risk: material
current_role: reviewer
next_role: planner
updated_at: 2026-08-17
handoff_id: HX-003
next_handoff_id: none
---

# Correct stale "planned" wording for shipped README surfaces

## Objective

A documentation-only edit to `README.md` that removes two false "planned" claims about
surfaces the repository already ships, while leaving the authentication boundary text and
the recorded hostile-probe limitation byte-for-byte unchanged. The plan is closed, the
edits are applied, and implementation review is APPROVE.

## Context

`OBS-README-PLANNED` was raised in task 0003 and is corrected here; that task was not
opened or modified in this round, and neither was task 0004.

The Phase 2A status banner (`README.md:3`) and the `Shipped commands:` block
(`README.md:41-49`, post-edit) both describe the CLI, the MCP `stdio` adapter, and
`doctor` as shipped. Two sentences elsewhere in the same file still described them as
planned. Nothing in the code needed to change; only the prose was stale.

The `/spbridge` skill and the future daemon are genuinely not implemented, so the fix
could not simply relabel the whole surface table as shipped.

## Scope

- `README.md:28` — the lead-in sentence above the public-surfaces table.
- `README.md:28-35` — one added sentence after that table stating which rows ship today.
- `README.md:203` pre-edit / `README.md:205` post-edit — the tense of the
  `spartan-bridge doctor` sentence only.

## Out of Scope

- Any change under `src/`, `tests/`, or `docs/`.
- `AGENTS.md`, `CLAUDE.md`, and every file outside `README.md`.
- `spartan/tasks/0003-cursor-plan-review-dogfood.md` and
  `spartan/tasks/0004-phase-2a-dogfood-docs.md`.
- Widening the `doctor` sentence to the fuller behavior documented in
  `docs/AUTHENTICATION-AND-SECURITY.md:332` (see `OBS-DOCTOR-SCOPE-NARROW` in Decisions).
- The `Required?` column of the surfaces table, which states requirement, not ship state.

## Constraints

- Documentation-only. No behavior, schema, or check may change.
- English only.
- The two sentences sit inside or beside security-normative prose. Every `must never`
  and every recorded unobserved-behavior caveat is load-bearing and stays verbatim.

## Acceptance Criteria

- [x] Each stale sentence is named by line, quoted, and paired with one exact replacement.
- [x] The must-not-change list is explicit, and covers the `README.md:203`
      authentication boundary sentences and the `README.md:3` hostile-probe limitation.
- [x] The plan states why the surfaces table cannot be relabelled shipped wholesale.
- [x] A reviewer records an explicit verdict on this plan.
- [x] A reviewer records an explicit verdict on the applied `README.md` change.

## Decisions

- **Two edits at line 28, not one.** Changing only the lead-in would leave the `/spbridge`
  and daemon rows reading as existing surfaces. One added sentence after the table
  separates the two shipped rows from the two unshipped ones, so the table itself needs
  no edit.
- **`README.md:203` changes tense and nothing else.** `is planned to check` becomes
  `checks`. The verb is the entire defect; every other word in that sentence, and both
  neighbouring sentences, stay as written.
- **`OBS-DOCTOR-SCOPE-NARROW` recorded, not fixed.** `README.md` (post-edit line 205) says
  `doctor` checks "executable and supported-interface availability", which is narrower
  than the shipped behavior documented at `docs/AUTHENTICATION-AND-SECURITY.md:332`
  (repository readability, registry readability and schema, launcher identifier
  resolution, fake capability flags, Cursor interface availability). `AGENTS.md:76` uses
  the same narrow phrasing, so aligning the three is a policy question, not a tense
  correction. Left for a separate task.
- **`OBS-NO-GIT-BASELINE` recorded, not fixed.** Every path in this repository is
  untracked and `main` has no commits, so `git diff README.md` returns empty and cannot
  evidence edit scope. Review used structural verification (see Evidence). Creating the
  first commit is a human-only gate under `AGENTS.md:82` and remains out of scope here.
- **Risk `material`, not `routine`.** The text is documentation and fully reversible, but
  it sits in the authentication boundary paragraph, where a careless edit would weaken a
  security statement. Higher of the two levels chosen per the routing guide.

### Planned edit 1 — `README.md:28`

Current:

```text
The planned public surfaces are:
```

Replacement:

```text
The public surfaces are:
```

### Planned edit 2 — new paragraph after the table (between current lines 35 and 37)

Insert, separated by blank lines, immediately after the table row ending
`| Future daemon | ... | Later |` and before `The skill does not implement the workflow.`:

```text
The `spartan-bridge` CLI and `spartan-bridge mcp-stdio` ship in Phase 2A. The `/spbridge` skill and the daemon are not implemented yet.
```

### Planned edit 3 — `README.md:203`

Current sentence, in place within its paragraph:

```text
`spartan-bridge doctor` is planned to check only executable and supported-interface availability.
```

Replacement:

```text
`spartan-bridge doctor` checks only executable and supported-interface availability.
```

### Must remain unchanged

- `README.md:203`, the rest of the paragraph verbatim, in this order and wording: `There
  are no Bridge login commands.` / `API keys, auth files, cookies, and Keychain data are
  never valid Bridge input or repository configuration.` / the replaced sentence / `It
  must never inspect authentication, accounts, credential stores, or billing.` / `If an
  invoked official client reports that external authentication is required, the run stops
  with a sanitized status.` The `must never` sentence must keep its position directly
  after the `doctor` sentence, so the prohibition still reads as scoping `doctor`.
- `README.md:197-201` — the `## Authentication` opening paragraph and its three bullets.
- `README.md:3` — the whole Phase 2A status banner, and above all this sentence:

  ```text
  The separate hostile-prompt probe never started a session, so client-side write prevention by `--mode plan` and `--sandbox enabled` is still unobserved.
  ```

  The recorded limitation is an honest negative result; it must not be softened,
  shortened, or dropped as part of a "shipped" wording pass. The snapshot residual-gap
  list and the closing sentence "Codex/Claude adapters and review-cycle loops are not
  implemented yet." stay as written for the same reason.
- `README.md:35` — the `Future daemon` row, including its `Later` value.
- `README.md:49` — the sentence stating that `start`, `stop`, and `review --run` are not
  implemented in this slice.
- `README.md:39-47` — the `Shipped commands:` block, `doctor` line included.
- `README.md:243` — the `Project status and next milestone` paragraph.
- `docs/AUTHENTICATION-AND-SECURITY.md:332` — already present-tense and already accurate.

### Acceptance criteria for the implementation round this plan enables

- [x] `grep -n "planned" README.md` returns no match on lines 28 or 203.
- [x] `git diff README.md` touches only the three edits above; no other line changes.
      Verified by equivalent structural evidence, not by `git diff`: `README.md` is
      untracked in a repository with no commits, so `git diff README.md` is empty and has
      no baseline (see `OBS-NO-GIT-BASELINE` in Decisions).
- [x] The `README.md:3` hostile-probe sentence and the `README.md:203` `must never`
      sentence are byte-identical to their pre-edit text.
- [x] `npm run typecheck` and `npm test` still pass.

## Work Completed

- Planner (Claude Code, Claude Opus 5, high effort): named the two stale sentences,
  wrote the three edits and the must-not-change list, and confirmed ship state. No
  product file was modified.
- Reviewer, plan (Cursor, Grok 4.6, Cursor Agent CLI `personal`
  context): compared the three edits to `OBS-README-PLANNED` in task 0003. Product files
  were not modified. Verdict: APPROVE.
- Implementer (Claude Code, Claude Opus 5, high effort): applied Planned edits 1-3 to
  `README.md` as three exact string replacements. Human-assigned `implementer` override
  of the default `planner` binding, recorded rather than inferred. Discovered
  `OBS-NO-GIT-BASELINE` and verified scope structurally.
- Reviewer, implementation (this round; Cursor, Grok 4.6, Cursor
  Agent CLI `personal` context): accepted handoff HX-003. Read-only on product files.
  Independently confirmed the three planned strings, the +2 structural shift, and
  byte-identity of the two security sentences. Verdict: APPROVE. Product files were not
  modified.

## Evidence

Implementation review (this round; independent of the implementer's report):

- Handoff compare: pasted `HX-003` matches `next_handoff_id`.
- `git log`: no commits. `git diff README.md`: empty. `git status --porcelain`: every
  path untracked, including `README.md` (`OBS-NO-GIT-BASELINE` still true).
- Planned edit 1: `README.md:28` is exactly `The public surfaces are:`; old lead-in
  count 0.
- Planned edit 2: `README.md:37` is the quoted insert sentence, blank-separated after
  the `Future daemon` row (line 35) and before `The skill does not implement the
  workflow.` (line 39).
- Planned edit 3: `README.md:205` contains
  `` `spartan-bridge doctor` checks only executable and supported-interface availability. ``;
  old `is planned to check` count in `README.md` is 0.
- `grep -n "planned" README.md`: no matches anywhere in the file, so none on 28 or 205.
- Scope, structural: `README.md` is 264 lines, LF-only, 18912 bytes. Downstream anchors
  sit exactly +2 from the plan's pre-edit numbers and nothing else moved: `Shipped
  commands:` 41, not-implemented-in-this-slice sentence 51, doctor/`must never`
  paragraph 205, `## Project status and next milestone` heading 243 (paragraph 245).
  Unshifted anchors above the insertion: line 3 banner, line 28 lead-in, line 35
  `Future daemon` row.
- Byte-identity: hostile-probe sentence count 1, present on line 3, identical to the
  Must remain unchanged quote. Line-3 closing "Codex/Claude adapters and review-cycle
  loops are not implemented yet." count 1. `It must never inspect authentication,
  accounts, credential stores, or billing.` count 1, immediately after the `doctor`
  sentence in the same paragraph (space-separated). Authentication paragraph order is
  login / keys / doctor / must-never / sanitized-status. Opening auth paragraph and
  three bullets intact at 199-203. `docs/AUTHENTICATION-AND-SECURITY.md:332` still
  present-tense. `AGENTS.md:76` still has the narrow phrasing.
- `npm run typecheck`: exit 0, no output.
- `npm test`: exit 0, 77 tests, 77 pass, 0 fail.

## Review

### Plan review — Verdict: APPROVE

The three planned edits are exactly sufficient to clear `OBS-README-PLANNED`. They do
not alter the authentication-boundary sentences (except the doctor verb tense) or the
`README.md:3` hostile-probe limitation.

Findings: none blocking. Edit 1 without edit 2 would overclaim `/spbridge` and the
daemon as existing surfaces; the added sentence is required, not extra. Edit 3 changes
only `is planned to check` to `checks`; the surrounding `must never` sentence stays in
place as the doctor scope. None of the three edits touches line 3. The reviewer's
non-blocking note about the +2 line shift was applied and is closed: the implementer
matched by quoted text, not by pre-edit line number.

### Implementation review — Verdict: APPROVE

The three planned edits are present and are the only `README.md` changes that can be
shown without a git baseline. The line-3 hostile-probe sentence and the
authentication-boundary `must never` sentence are byte-identical to the quoted Must
remain unchanged text. Host: Cursor (Grok 4.6), a different
vendor from the Claude Code implementer round.

Findings: none blocking. `git diff` remains unusable (`OBS-NO-GIT-BASELINE`); scope was
verified by exact-string presence/absence plus the +2 anchor shift. `OBS-DOCTOR-SCOPE-NARROW`
is unchanged and remains a separate task, not a defect in this diff.

## Blockers

None.

## Next Action

None. The task is complete.

## Next Handoff

Non-binding suggestion for a possible new task; this artifact is complete and must not be reopened.

```text
Recommended execution (human decides):
- Host: Claude Code, the `AGENTS.md` binding for `planner`
- Model and effort: Opus 5, effort high, because aligning `doctor` scope touches `AGENTS.md` policy and the authentication-boundary docs (fallback: Sonnet, effort high)
- Role: planner
- Invocation: `/spartan`, passing the prompt block below as the argument
```

```text
Create a uniquely numbered artifact from `assets/task-template.md` in `spartan/tasks/`, suggested slug `doctor-scope-alignment`. Do not open or update `spartan/tasks/0005-readme-shipped-surface-wording.md`.

Act as planner. Plan the documentation-only alignment of `OBS-DOCTOR-SCOPE-NARROW`: `README.md` and `AGENTS.md` still say `doctor` checks only executable and supported-interface availability, which is narrower than the shipped behavior at `docs/AUTHENTICATION-AND-SECURITY.md:332`. Success: a closed plan that either aligns the three sources or records an explicit decision to keep the narrow wording, without weakening any authentication-boundary `must never` sentence.
Run the relevant repository checks and update the new task file.

Return only the next handoff, or a completion notice if no work remains.
```
