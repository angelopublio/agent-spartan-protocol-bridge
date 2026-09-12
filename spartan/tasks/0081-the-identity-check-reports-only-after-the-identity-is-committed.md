---
protocol: "1.1.0" # x-release-please-version
id: the-identity-check-reports-only-after-the-identity-is-committed
created_at: 2026-09-11
status: active
phase: planning
task_type: planning
risk: material
current_role: planner
next_role: planner
updated_at: 2026-09-11
handoff_id: HX-001
next_handoff_id: HX-002
---

# The identity check reports only after the identity is committed

## Objective

The repository's private-identity check reads tracked blobs from the git index and never the
working filesystem. A violation introduced by a change is therefore invisible while that change is
uncommitted, and the check reports it only on the run after the commit — after the identity has
entered the published history it exists to protect.

## Context

Observed on 2026-09-11, on this repository, by the defect landing in it.

`tests/repo-hygiene.test.ts:62` reads every entry through `git ls-files -s -z` and every blob
through `git cat-file --batch`. Its own comment states why: *"The working filesystem is never
consulted, so a symlink is read as the blob holding its target rather than followed out of the
repository."* That is a deliberate, load-bearing property, not an oversight, and any change must
keep it.

The consequence is the gap. A task's own suite run, taken on a worktree whose changes are not yet
staged, scans the previous blobs and reports green. Commit `5df3f16` introduced a spawn fixture
whose home-path segment was not in the placeholder set; the task that shipped it recorded 569 of
569 passing, and that measurement was structurally incapable of seeing the violation it was
carrying. The check fired on the next run, with the value already committed.

The same property makes a correction hard to verify. An unstaged fix leaves the check reading the
old blob, so `npm test` keeps failing until `git add` runs first. Nothing states that, and the
natural reading of a red test is that the fix did not work.

There is a third face. `git()` at `tests/repo-hygiene.test.ts:51` asserts the subprocess exited
zero, so where there is no `.git` at all the four assertions fail outright rather than declining to
run. An isolated producer copy is exactly that environment, and its `npm test` therefore reports
failures that say nothing about the change under review.

## Scope

- `tests/repo-hygiene.test.ts` — what the four assertions read, and how the helper behaves where no
  repository metadata exists.
- `package.json` — only if a decision introduces a separate entry point.
- The AGENTS.md sentence describing what the check covers, if a decision changes what it reads. That
  path is outside every automatic write scope, which the Constraints address.
- `docs/DECISIONS.md` — one dated entry.

## Out of Scope

- The four matchers and their placeholder, address and alias sets. This task is about when the check
  runs and what it reads, not about what it matches.
- The fixture that exposed the gap. It was corrected directly on 2026-09-11.
- Detecting a person, an organisation, a product or an alias written as prose. The file's own
  preamble records why that is out of reach, and this task does not reopen it.
- The other failures an isolated producer copy produces for unrelated reasons. This task claims only
  the four assertions in this file.

## Constraints

- The symlink property must survive. Reading the blob rather than the filesystem is what keeps a
  tracked symlink from being followed out of the repository, and a naive switch to reading files
  would give that up silently.
- The check must keep judging what is **tracked**. An untracked scratch file in a contributor's
  working directory is not a disclosure, so widening to everything the filesystem holds changes what
  the check means rather than fixing when it runs.
- A finding must keep naming a position and a count, never a blob identifier, a tracked path, a
  filename, or the matched value. Whatever a new reading path reports is bound by the same rule.
- Whatever the check reads must be reproducible by a person and by an unattended run, and must not
  make the result depend on staging state in a way a reader has to know without being told.
- This repository can verify the whole of this task locally. There is no external observation to
  carry back.

## Decisions

To be settled by the planner round.

- **What the check reads.** Candidates: the index alone as today; the index plus the working copy of
  paths that are already tracked; or two modes with distinct reporting. Each has to answer the
  symlink property explicitly rather than inherit it.
- **Whether staging stays a precondition.** If it does, it must be stated where a reader meets the
  failure. If it does not, the mechanism that replaces it must not reintroduce the filesystem read
  the current design refuses.
- **Whether the check moves earlier than the suite.** A commit-time gate would report before the
  history is written, which is the outcome the Objective names, but it is machine-local setup rather
  than repository content and this repository does not install hooks today.
- **How the check behaves where no repository metadata exists.** Failing four assertions in an
  isolated producer copy is noise attributed to the change under review; declining to run is
  quieter but claims coverage that was not exercised. The planner must choose and say which.

## Acceptance Criteria

To be derived from the decisions, last.

## Work Completed

Not started.

## Evidence

- **E-1 — the reading path is the index.** `trackedEntries` at `tests/repo-hygiene.test.ts:62`
  builds its entries from `git ls-files -s -z` and their bytes from `git cat-file --batch`. The
  helper's documentation comment states the working filesystem is never consulted and names the
  symlink reason.
- **E-2 — a shipped violation the task's own measurement could not see.** Commit `5df3f16` added a
  fixture at two sites whose home-path segment was absent from the placeholder set. The suite run
  recorded for that task was 569 of 569 with nothing skipped, taken while the change was unstaged,
  so the assertions scanned the previous blobs. The next run, after the commit, reported one
  failure naming a tracked position.
- **E-3 — an unstaged correction does not clear the failure.** Editing the fixture in the worktree
  and re-running `npm test` reproduced the same single failure at the same position. Running
  `git add` on that one file and re-running returned 569 of 569 with no other change. Staging, not
  editing, is what the check observes.
- **E-4 — the helper fails closed where there is no repository metadata.** `git()` at
  `tests/repo-hygiene.test.ts:51` asserts `result.status` equals zero with the message
  `git <subcommand> must succeed`. An isolated producer copy carries no `.git`, and the
  implementation review of task `0079` recorded that copy's suite as 527 passing, 29 failing and 12
  skipped, naming the absent `.git` among the causes.

## Review

Verdict: PENDING

Findings:

- None recorded.

## Blockers

None. Everything this task claims is observable in this repository.

## Next Action

Plan when the identity check runs and what it reads, and let the Bridge dispatch the mapped
`reviewer.plan` against the result.

## Next Handoff

```text
Recommended execution (human decides):
- Host: the host this repository binds to `planner`
- Role: planner
- Handoff: HX-002
- Invocation: `/spbridge`
```

```text
Open `spartan/tasks/0081-the-identity-check-reports-only-after-the-identity-is-committed.md` (handoff HX-002).

Act as planner. Settle what the identity check reads, whether staging stays a precondition for
observing a correction, whether the check moves earlier than the suite, and how it behaves where no
repository metadata exists. Establish on evidence that the chosen reading keeps a tracked symlink
from being followed out of the repository, and that a finding still names only a position and a
count. Note that a plan whose scope edits the repository instruction file declares a human
implementer. Derive the acceptance criteria from those decisions, last.

Then let the Bridge dispatch the mapped `reviewer.plan` against this artifact and work the returned
findings in this same session, re-deriving every criterion whose decision a finding changes.

Return only the next handoff, or a completion notice if no work remains.
```
