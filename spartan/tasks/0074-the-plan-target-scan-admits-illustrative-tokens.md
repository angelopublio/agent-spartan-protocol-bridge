---
protocol: "1.1.0" # x-release-please-version
id: the-plan-target-scan-admits-illustrative-tokens
created_at: 2026-09-05
status: active
phase: planning
task_type: planning
risk: minor
current_role: planner
next_role: planner
updated_at: 2026-09-05
handoff_id: none
next_handoff_id: HX-001
---

# The plan-target scan reports illustrative tokens as unwritable plan targets

## Objective

`unwritable_plan_targets` names paths the approved plan proposes to write, not
every slash-bearing string its Decisions use to explain something. A plan that
illustrates a sandbox rule with `HOME/x` or `R/src/x`, or names a filesystem
shape as `a/b`, does not produce an advisory naming those tokens.

## Context

Observed on task `0053`'s auto-chain on 2026-09-05
(`transition-b755de18-b0c2-423d-a723-5906999b8333`). The terminal transition
document carried twenty-two `unwritable_plan_targets`, of which these are not
repository paths at all:

- `HOME/x`, `HOME/alias`, `R/src/x` — the plan's D2 uses `HOME`, `TMPDIR`, `R`
  and `W` as symbolic roots defined in its own prose, exactly so the SBPL
  clauses can be discussed without naming a machine-local path.
- `a/b` — a two-level directory shape used to explain nested rollback.
- `agent-skill/skills/spbridge/NEW.md` — a file the plan says the merge must
  **refuse**, cited to show the protection still fires.
- `.bin/tsserver`, `.bin/esbuild`, `.bin/yaml`, `.bin/spartan-bridge` — link
  names quoted relative to `node_modules/`, not repo-relative paths.

The rest of the list (`node_modules/`, `.venv/`, `dist/`, `AGENTS.md`,
`spartan-bridge/config.yaml`) is correct: the plan does discuss those, and they
are genuinely outside the automatic write scope.

**Why the existing fix does not cover this.** Task `0066` closed the
false-positive case for a **bare filename** in prose, by requiring a token
without a `/` to be in `KNOWN_TOP_LEVEL_NAMES`
(`src/core/plan-target-scan.ts:5-13`, `:105-110`). It left the other branch
untouched: `looksLikeRepoPath` returns `true` for *any* token containing a
slash. Every false positive above contains one, so `0066`'s fix cannot reach
them. `REPO_PATH_CHARS` (`:93`) filters quotes, spaces and parentheses, which
is why a code expression is excluded — but `HOME/x` is made only of legal path
characters.

**Severity, stated plainly.** Task `0067` made the scan advisory after a passed
review rather than a hard stop, so these tokens do not block a chain. The cost
is that the advisory is not trustworthy: an operator who reads twenty-two
entries, most of them nonsense, learns to skip the list, and the five real
entries in it lose their audience. That is the defect — a signal diluted to the
point of being ignored, not a blocked round.

**The tension the planner round must weigh.** Every candidate discrimination is
heuristic, and a plan is prose. Requiring a token to name an existing path
would silence a plan that proposes creating a file. Requiring a leading known
top-level directory would silence a consumer repository whose layout this
repository does not know. Deciding what the scan may not do is as much of the
deliverable as deciding what it does.

## Scope

To be pinned by the planner round. The surface is small:

- `src/core/plan-target-scan.ts` — `looksLikeRepoPath` (`:105-110`) and
  whatever the decision adds beside `KNOWN_TOP_LEVEL_NAMES` and
  `REPO_PATH_CHARS`.
- `docs/DECISIONS.md` — one dated entry, amending the `0066` decision rather
  than replacing it.
- Tests: `tests/plan-target-scan.test.ts` if it exists, otherwise wherever
  `planTargetsUnwritablePath` is currently asserted.

## Out of Scope

- Making the scan a hard stop again. Task `0067` decided that deliberately.
- `continueAfterPlanReview`, the transition record's shape, or the
  `unwritable_plan_targets` field itself.
- Scanning any section other than `## Scope` and `## Decisions`.
- Requiring plan authors to change how they write. The scan adapts to the
  artifacts, not the reverse.
- Any new `ReasonCode`.

## Decisions

To be decided by the planner round:

- **D1 — the discrimination.** Candidates: require the first segment to be an
  existing entry in the repository root, or in the declared write scope's own
  first segments; require the token to resolve under a scope line or an
  authority path before reporting it; keep a small deny set of symbolic root
  names the artifacts use (`HOME`, `TMPDIR`, `R`, `W`); or report only tokens
  that the plan's `## Scope` section names, treating `## Decisions` as prose.
  Each silences something real — say which, for each.
- **D2 — what the scan must never do.** Name the case that must keep firing:
  a plan that genuinely proposes writing `AGENTS.md` or
  `spartan-bridge/config.yaml`, which is the reason the scan exists (`0054`).
- **D3 — whether a suppressed token is still recorded anywhere**, or silently
  dropped.

## Acceptance Criteria

To be derived from the decisions once pinned, not before. At minimum the
twenty-two-token list from `0053` is the regression fixture: the five genuine
entries survive and the illustrative ones do not.

## Work Completed

- 2026-09-05 (human-operator, Claude Code, claude-opus-5): queued from the
  `0053` auto-chain observed the same day. `plan-target-scan.ts` was read in
  this checkout before this file was written, and `0066`'s fix confirmed to
  cover only the no-slash branch.

## Evidence

- `transition-b755de18-b0c2-423d-a723-5906999b8333` — the terminal document's
  `unwritable_plan_targets`, twenty-two entries, quoted in Context.
- `src/core/plan-target-scan.ts:105-110` — `looksLikeRepoPath`:
  `if (posix.includes("/")) { return true; }`, then the
  `KNOWN_TOP_LEVEL_NAMES` check for the no-slash case.
- `src/core/plan-target-scan.ts:5-13` — `KNOWN_TOP_LEVEL_NAMES`, seven names,
  task `0066`'s fix.
- `src/core/plan-target-scan.ts:93` — `REPO_PATH_CHARS`, which excludes quotes,
  spaces and parentheses but admits every character in `HOME/x`.
- `src/core/plan-target-scan.ts:14-29` — `planTargetsUnwritablePath`, and
  `:31-38` the `## Scope` / `## Decisions` section restriction.
- Task `0054` — why the scan exists. Task `0066` — the bare-filename fix and
  the token naming. Task `0067` — advisory rather than hard stop.

## Review

Verdict: PENDING

Findings:

- None recorded.

## Blockers

None.

## Next Action

A planner round through `/spbridge`: pin D1 through D3 against the `0053`
token list as the fixture, verify every named path and line, derive the
acceptance criteria from the pinned decisions last, then let the Bridge
dispatch the plan review.

## Next Handoff

```text
Recommended execution (human decides):
- Host: Claude Code (AGENTS.md binds planner to Claude Code; fresh session)
- Model and effort: claude-opus-5 at effort high
- Role: planner
- Handoff: HX-001
- Permission: writable
- Invocation: /spbridge, passing the prompt block below as the argument
```

```text
Open `spartan/tasks/0074-the-plan-target-scan-admits-illustrative-tokens.md` (handoff HX-001).

Act as planner. Refine this plan against `src/core/plan-target-scan.ts` in full, `src/policy/agents-policy.ts` (`isPathAdmittedByScope`, `AUTHORITY_WRITE_PATHS`), the tests that currently pin `planTargetsUnwritablePath`, and tasks `0054`, `0066` and `0067` for what each already decided.

Pin D1 by weighing the four candidates in the artifact, and for each say explicitly what it silences that should not be silenced — a heuristic over prose has no free option. Pin D2 as the case that must keep firing, which is the reason task `0054` built the scan. Pin D3. Use the twenty-two-token list quoted in Context as the regression fixture and state which five entries must survive.

Verify every path, symbol and line reference exists in this checkout. Derive the acceptance criteria from the pinned decisions, last. Keep `## Review` as the `Verdict: PENDING` placeholder and `phase: planning`.

Then let the Bridge dispatch the plan review.
```
