---
protocol: "1.1.0" # x-release-please-version
id: the-auto-chain-cannot-finish-on-an-application-sized-repository
created_at: 2026-09-10
status: active
phase: planning
task_type: planning
risk: material
current_role: planner
next_role: planner
updated_at: 2026-09-10
handoff_id: HX-001
next_handoff_id: HX-002
---

# The auto-chain cannot finish on an application-sized repository

## Objective

An approved plan reaches its implementation review in a repository whose installed dependency tree
is large. Today the chain runs the implementer to completion and then dies capturing its result,
because the capture walks a directory the Bridge itself placed in the workspace and then discards.

## Context

Observed on 2026-09-10 in a managed repository. The plan review passed with no findings. The
transition began 0.4 seconds later and stopped 3 minutes 43 seconds after that with
`reviewer_isolation_unavailable` and no producer diagnostic. The producer had already run; the
failure was in the capture that follows it.

The mechanism is four facts that only bite together:

- `src/core/workspace.ts:29` — `PRODUCER_SUPPORT_SCOPE` is `["node_modules/"]`. The Bridge copies
  the installed dependency tree into the producer workspace deliberately, so the producer can build
  and test.
- `src/core/transition.ts:735` — after the producer finishes, the capture snapshots that workspace
  with `snapshotTree(workspaceRoot, { policy: "workspace" })`.
- `src/core/snapshot.ts:95` — the skip list is gated on `state.policy === "repository"`. Under the
  `workspace` policy nothing is skipped, including the dependency tree the Bridge just placed there.
- `src/core/snapshot.ts:7` — `SNAPSHOT_ENTRY_CAP` is 20,000 entries, and that call site passes no
  override.

An installed dependency tree for an ordinary application routinely holds tens of thousands of
files, so the walk exceeds the cap. This repository's own tree holds 542 files, which is why the
defect has never appeared here.

The walk is also pure waste. `src/core/workspace.ts:1407-1411` classifies every captured entry and
discards everything that is not `admitted`; a support-scope path can never reach the merge. The
capture therefore spends minutes hashing files whose only possible outcome is to be thrown away,
and then fails on their count.

## Scope

- `src/core/transition.ts` — the post-producer capture call at `:735`, and the stop it returns at
  `:739`.
- `src/core/snapshot.ts` — how a walk is told to omit a path, and which caps apply to which policy.
- `src/core/workspace.ts` — `PRODUCER_SUPPORT_SCOPE` as the source of what the capture may omit.
- `src/core/contracts.ts` — only if the stop gains a diagnostic field it does not already have.
- Tests covering the capture path and the snapshot policies.

## Out of Scope

- Raising `SNAPSHOT_ENTRY_CAP`. That treats the count rather than the walk, and leaves the wasted
  minutes in place.
- The reviewer workspace prepared for an implementation review. It copies only the declared
  implementation review scope, which does not admit a dependency tree, and is not affected.
- The plan-target scan's sixteen advisory tokens observed in the same run. That is task `0074`.

## Constraints

- The capture must still detect a producer that wrote into a support-scope path when that would
  change the merge outcome. Establish whether it can, before omitting anything.
- Omission must be derived from the same support-scope value the workspace was built from, never a
  second hardcoded list that can drift from it.
- A stop on this path currently carries `diagnostic: null`, so it names neither which of the three
  snapshots in that block failed nor which of the two caps was exceeded. Diagnosing the observed
  failure required reading the source and reasoning from elapsed time; the next operator must not
  have to. Whatever the fix, the stop records the failing snapshot and the exceeded cap, in closed
  values, and this is part of the change rather than a follow-up: the fix already edits that exact
  stop site, and leaving it mute there while three queued tasks ask for the same thing elsewhere
  would be a deliberate inconsistency.

## Decisions

To be settled by the planner round. Two candidate directions, for the reviewer to accept or refuse.

The capture omits support-scope paths, because the merge already discards them, so omitting them
changes no outcome and removes both the cap pressure and the wasted walk. Raising the cap is refused
even though it would make the chain complete: the walk would still hash every file of a dependency
tree on every run and throw the result away, so the defect would become slow rather than fatal. The
observed failure spent three minutes and forty-three seconds mostly in that walk.

The stop records which snapshot failed and which cap it exceeded, as closed values carried on the
existing diagnostic record rather than as prose.

## Acceptance Criteria

To be derived from the decisions, last. Two are already implied by the constraints and will be
re-derived rather than copied: a capture stop names its failing snapshot and its exceeded cap in
closed values; and the evidence measures the elapsed time a capture takes before and after the
omission on a tree large enough to have failed, so the change is shown to remove the cost and not
only the failure.

## Work Completed

Not started.

## Evidence

- The four source anchors above, read at `main` on 2026-09-10.
- The failing transition's projected record: `state: stopped`,
  `reason_code: reviewer_isolation_unavailable`, `producer_diagnostic: null`,
  `linked_review_run_ids: []`, elapsed 3 minutes 43 seconds. A `producer_diagnostic` of `null`
  is what distinguishes the capture stop at `transition.ts:739` from the earlier
  write-scope-lock stop at `:682`, which always builds one.
- `find node_modules -type f | wc -l` in this repository: 542.

## Review

Verdict: PENDING

Findings:

- None recorded.

## Blockers

None.

## Next Action

Plan the capture change and let the Bridge dispatch the mapped `reviewer.plan` against it.

## Next Handoff

```text
Recommended execution (human decides):
- Host: the host this repository binds to `planner`
- Role: planner
- Handoff: HX-002
- Invocation: `/spbridge`
```

```text
Open `spartan/tasks/0077-the-auto-chain-cannot-finish-on-an-application-sized-repository.md` (handoff HX-002).

Act as planner. Settle whether the post-producer capture may omit support-scope paths, and on what
evidence that omission changes no merge outcome. Decide how a walk is told to omit them without a
second list that can drift from the scope the workspace was built from, and what the capture stop
must record so an operator can name the failing snapshot and the exceeded cap without re-running.
Derive the acceptance criteria from those decisions, last.

Then let the Bridge dispatch the mapped `reviewer.plan` against this artifact and work the returned
findings in this same session, re-deriving every criterion whose decision a finding changes.

Return only the next handoff, or a completion notice if no work remains.
```
