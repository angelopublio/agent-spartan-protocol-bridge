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
updated_at: 2026-09-12
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

**Two further false-positive classes, observed 2026-09-12.** A private consumer
repository running the Bridge produced advisories carrying tokens of two shapes
this list does not contain, both made only of legal path characters and both
carrying a slash, so `looksLikeRepoPath` admits them exactly as it admits
`HOME/x`:

- A scoped package specifier, `@scope/name`, quoted where a plan names a
  dependency it installs rather than a file it writes. The leading `@` is the
  discriminator the scan does not look at.
- A git ref, `origin/main` and `origin/<branch>`, quoted where a plan names a
  branch it merges or compares against.

The same repository also produced the case this task already describes from the
other side: a terminal transition whose three `unwritable_plan_targets` were
`AGENTS.md`, `spartan-bridge/config.yaml`, and one genuine repository
directory — the first two quoted in a sentence stating that the round does
**not** edit them. That is `0053`'s `NEW.md` entry again, in a repository where
the two authority paths are the ones a plan is most likely to mention in order
to disclaim.

These two shapes matter to D1 beyond adding rows to a fixture. A discrimination
built on "the token looks like a path" cannot separate them, because they are
well-formed paths; only their leading segment distinguishes them, and only
against knowledge the scan does not have. A discrimination built on the
surrounding sentence would catch all three classes at once.

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
- 2026-09-12 (planner, Claude Code, claude-opus-5): added two further
  false-positive classes to Context and their evidence, after a chain in a
  private consumer repository stopped on `write_scope_violation` and its
  advisory was read as the cause. Names no path, repository, organisation or
  product of that repository, per `AGENTS.md` "Repository content names no
  private identity". No decision pinned and no code changed; D1 through D3 are
  still open.

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
- `transition-1683c04d-250e-4f0d-a816-fe1a17e0d6d2`, 2026-09-12T11:05:09Z to
  T11:09:12Z — `state: stopped`, `reason_code: write_scope_violation`,
  `unwritable_plan_targets_count: 3`. Its plan review,
  `run-d39e5309-0ff6-458c-9638-0b3d0a87f316`, was `verdict: pass`,
  `reason_code: review_passed`, `task_write_state: written`, cycle 1 of 3, and
  left the chain `awaiting_implementer`. Read from a redacted
  `/spbridge-summary` document, per the rule that a run in another repository
  is cited by id, reason code, verdict and timings only.
- The `@scope/name` and `origin/<ref>` shapes were reported by the operator from
  advisories in that same repository. No transition id was captured for those
  two, so they are recorded here as shapes to cover, not as a citable document.
- The scan's own guard, re-read on this checkout 2026-09-12: `REPO_PATH_CHARS`
  admits `@`, so `@scope/name` reaches `looksLikeRepoPath`, which returns `true`
  on the slash before any other test runs.

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

Pin D1 by weighing the four candidates in the artifact, and for each say explicitly what it silences that should not be silenced — a heuristic over prose has no free option. Pin D2 as the case that must keep firing, which is the reason task `0054` built the scan. Pin D3. Use the twenty-two-token list quoted in Context as the regression fixture, extended with the two 2026-09-12 shapes (`@scope/name`, `origin/<ref>`) and the three-target authority-disclaimer case, and state which entries must survive. Weigh D1 knowing that the two new shapes are well-formed paths distinguished only by their leading segment, so a discrimination over token shape alone cannot separate them.

Verify every path, symbol and line reference exists in this checkout. Derive the acceptance criteria from the pinned decisions, last. Keep `## Review` as the `Verdict: PENDING` placeholder and `phase: planning`.

Then let the Bridge dispatch the plan review.
```
