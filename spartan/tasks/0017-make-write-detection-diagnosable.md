---
protocol: "1.0.0" # x-release-please-version
id: make-write-detection-diagnosable
created_at: 2026-08-18
status: completed
phase: complete
task_type: implementation
risk: material
current_role: reviewer
next_role: none
updated_at: 2026-08-18
handoff_id: HX-004
next_handoff_id: none
---

# Make an isolation block say what it saw

## Objective

When the reviewer-write guard blocks a run, the record names which workspace entries differed and
how, so the next occurrence can be diagnosed instead of guessed at.

## Context

`reviewer_write_detected` has now blocked four runs, not the two this plan first recorded. Each
blocked run is listed with the retry that followed it against a byte-identical task artifact:

| Run | Repository | Task | Task hash | Duration | Outcome |
| --- | --- | --- | --- | --- | --- |
| `run-1346c03b` | this repository | `0011` | `f165eaa2` | 137.8s | blocked |
| `run-3469f5ae` | this repository | `0011` | `f165eaa2` | 113.0s | passed |
| `run-8bc2b261` | this repository | `0016` | `67e5ccf7` | 51.8s | blocked |
| `run-7decc29d` | this repository | `0016` | `67e5ccf7` | 70.7s | changes requested |
| `run-15e9e502` | the Board | `0021` | `f9549440` | 93.2s | blocked |
| `run-7e2536ea` | the Board | `0021` | `f9549440` | 122.7s | blocked |

The pairing is the finding. In this repository the same input produced a block and then a
completed review, twice. In the Board the same input blocked twice in a row. One input, both
outcomes, in both directions: no property of the artifact under review can explain that, so the
trigger is not in the task content, the task, or the repository.

Two consequences follow. Re-running is not a workaround — the Board pair spent two paid sessions
and produced no verdict — and any explanation reaching for something specific to a plan, a task,
or a tree is already excluded by the table.

The rate is not marginal. Across both repositories 19 runs have reached `review_started` and 4
ended `reviewer_write_detected`: roughly one review in five, each costing a full reviewer session.

Every attempt to reproduce it has failed. A faithful reconstruction — same temp-directory
workspace, same `0444` and `0555` modes, same flags, same declared model, same review prompt,
compared with the runtime's own `snapshotTree` and `workspaceDiffers` — reported no differing
entry. Creating and deleting a transient file inside the workspace did not change the root
entry either.

There is a second ambiguity, and it is worse than the missing entry detail. `reviewer_write_detected`
has two independent emitters. `CursorPlanReviewer.verify()` compares the temp workspace, and
`src/core/review.ts:346` separately compares a snapshot of the whole repository worktree taken
before and after the review, excluding only the live task path and `AGENTS.md`. Both terminate the
run identically: `blocked`, `reviewer_write_detected`, `verdict: null`. Nothing in the run record
says which of the two fired.

That matters because the two have unrelated causes. The workspace comparison watches two files in
a `0555` temp directory. The worktree comparison watches the entire repository, and
`SKIPPED_DIR_NAMES` holds only `.git`, `node_modules` and `.spartan-bridge` — so `dist/`,
`.DS_Store`, `.venv/`, `__pycache__/` and `.pytest_cache/` are all walked despite being
gitignored. A rebuild, an editor save, or a Python cache write anywhere in the tree during the
review window would fire the guard, and every reconstruction of the temp workspace was blind to
it by construction.

The reason the investigation cannot progress is the shape of the guard, not the rarity of the
event. `verify()` compares two snapshots and throws a bare `ReviewerWriteDetectedError`. Nothing
records which entry differed, what changed about it, or whether an entry appeared or vanished.
The adapter then removes the workspace, including on the failing path, so there is nothing left
to inspect afterwards. Four occurrences have produced no evidence at all.

That is the defect worth fixing first. A security guard that blocks without saying what it saw
cannot be distinguished from a guard that is wrong, and the honest response to an
unfalsifiable block is eventually to stop believing it.

## Scope

- `src/adapters/adapter.ts`: what `ReviewerWriteDetectedError` carries.
- `src/adapters/cursor.ts`: `verify()`, and whether the workspace is removed on this path.
- `src/core/snapshot.ts`: a comparison that returns the differing entries rather than a boolean.
- `src/core/review.ts`: the second comparison at line 346, which emits the same reason code from
  a different snapshot, and the run record where the detail is persisted.
- Tests over each difference kind.

## Out of Scope

- Weakening the guard. It keeps blocking on any difference; this task changes what is recorded,
  never what is detected.
- Deciding whether the client writes. That is what the added evidence is meant to establish, and
  guessing it now would be the same mistake in the other direction.
- Retrying automatically. A retry would hide the very event being investigated.

## Constraints

- The run must still terminate `blocked` with `reason_code: reviewer_write_detected`, and no task
  artifact may be written.
- The recorded detail must not contain file contents. A path, an entry kind, and which fields
  differ are facts about structure; contents could carry anything the reviewer read.
- Paths are recorded relative to the root of the snapshot that was compared — the reviewer
  workspace for one emitter, the repository worktree for the other — and never as absolute paths.
  The two roots are different trees, so a path stored against the wrong one is not merely
  unhelpful: it names a file that does not exist there, and for the workspace it leaks a temp
  location.
- The authentication boundary applies unchanged: nothing about accounts, credentials, or
  launcher commands enters the record.

## Acceptance Criteria

- [x] `snapshotDiffers`' behaviour is available in a form that returns the differing entries, and
      the existing boolean callers are unchanged in behaviour.
- [x] The termination is driven by that list, not by a boolean computed alongside it. Both
      emitters block because the list is non-empty, and the list that caused the block is the one
      persisted, built from the two in-memory snapshots at the moment of comparison and before any
      cleanup. A run that terminates `reviewer_write_detected` with an empty or absent entry list
      fails this task.
- [x] A blocked run's record names which comparison fired, the reviewer workspace or the
      repository worktree. A record that omits this is ambiguous between two unrelated causes and
      does not satisfy this task.
- [x] A blocked run's record names, for each differing entry, its path relative to the compared
      root, whether it appeared, vanished, or changed, and which of `kind`, `mode`, `size`,
      `hash`, `mtimeNs` or `linkTarget` differ.
- [x] No file content appears in the record, asserted by a test.
- [x] The run still terminates `blocked` with `reviewer_write_detected` and writes no task
      artifact.
- [x] Each difference kind — appeared, vanished, changed field — is covered by a test.
- [x] Both emitters are covered by a test asserting that a blocked run's persisted record carries
      a comparison identity, and that the two identities are distinguishable from each other. A
      test that exercises only the adapter path leaves the worktree comparison able to terminate
      as a bare `blocked` / `reviewer_write_detected` / `verdict: null`, which is the ambiguity
      this task exists to remove.
- [x] The failing path preserves whatever is needed for the record before any cleanup runs.
- [x] `npm run typecheck` and `npm test` exit 0.

## Decisions

### D1 - Record the difference, decide nothing from it

This task does not conclude that the client writes, nor that the guard is wrong. Four occurrences
and no reproduction support neither conclusion, and asserting either would be the failure this
plan exists to avoid.

The paired runs narrow the search without settling it. A byte-identical input produced both
outcomes, so whatever differs between a blocked run and its retry is not in the artifact, the
task, or the repository: it is something that varies between two executions of the same review.
That is a statement about where to look, not about what is found there, and it is the strongest
claim the evidence currently supports.

What it does is convert an unfalsifiable event into a recorded one. The next occurrence then
carries its own evidence, and one such record will settle in a minute what four attempts at
reconstruction could not.

### D2 - The guard's behaviour does not change

The run still blocks, still reports `reviewer_write_detected`, and still writes no task artifact.
Only the record gains detail.

This matters because the pressure, once a guard fires four times without explanation, is to relax
it, and at one run in five that pressure is now real.
Relaxing an isolation check to reduce false positives before knowing whether they are false is
how a real write eventually passes unnoticed. The block stays; the silence goes.

### D3 - Cleanup must not outrun the evidence

The adapter removes the workspace on the failing path today, which is why no occurrence left
anything to inspect. The plan must state where the detail is captured relative to that removal:
the comparison already holds both snapshots in memory when it fails, so the record can be built
there, before any cleanup, without keeping the workspace alive.

Whether the workspace should also be preserved on failure is a separate question and is
deliberately not answered here. Keeping a read-only copy of two files is cheap, but it leaves
material on disk after a run the human may not revisit, and the in-memory detail should be enough
to identify the entry.

### D4 - The recorded list is the cause of the block, not a report about it

The block must be driven by the differing entries themselves: both emitters terminate because
that list is non-empty, and the list persisted is the same object the comparison produced, held
in memory from the two snapshots and written before any cleanup.

Stated the other way, an implementation that keeps a boolean deciding the block and computes a
list separately for the record satisfies every other criterion here and still delivers nothing. A
second computation runs after the fact, and the failing path removes the workspace, so it can
legitimately find no difference at all and persist an empty list beside a `reviewer_write_detected`
that has no explanation. That is the current defect with extra machinery in front of it.

## Work Completed

- Planner (Claude Code, Claude Opus 5, high effort, Anthropic): established that both occurrences
  left no evidence, that reconstruction does not reproduce, and that the guard discards the
  comparison it acted on. Recorded D1-D3. No product file changed.
- Planner (Claude Code, Claude Opus 5, high effort, Anthropic): recorded the second emitter of
  `reviewer_write_detected` and the gitignored-but-walked trees, from a second opinion obtained
  outside the protocol, and correlated the four block windows against file modification times in
  both repositories. Added the acceptance criterion naming which comparison fired. No product
  file changed.
- Planner (Claude Code, Claude Opus 5, high effort, Anthropic): after a fourth occurrence, read
  every `events.jsonl` and `status.json` under `.spartan-bridge/runs` in this repository and the
  Board, and corrected the Context and D1. Two occurrences had been missed, and the recorded claim
  that re-running succeeds was wrong. No product file changed.

- Planner (HX-001, Claude Code, Claude Opus 5, high effort, Anthropic): accepted matching envelope
  HX-001 and all three findings. `PATH_ROOT` corrected a constraint that still named the workspace
  root after the plan had grown a second emitter with a different root. `DIFF_DRIVES_BLOCK` and
  `EMITTER_TESTS` each closed a criterion an implementation could satisfy while leaving the next
  occurrence unfalsifiable; the first became D4. No product file changed.

- Plan review HX-002 (Cursor, cursor-grok-4.6-high-fast, effort none, dispatched by the runtime)
  approved the revised plan with no findings, in run `run-c89f2a14`. The run immediately before it,
  `run-ab1cf4ec`, failed `adapter_error` on the byte-identical artifact — task hash
  `96f04e2102a2` in both — and was re-run without any change to the plan.

- Implementer HX-003 (Cursor, cursor-grok-4.6-high-fast, effort none): accepted matching envelope
  HX-003 and implemented D1-D4. `snapshotDiff` returns the differing entries; `snapshotDiffers` and
  `workspaceDiffers` are boolean wrappers over that list. Both emitters block on `entries.length > 0`
  and persist that same list on `status.json` as `reviewer_write` before adapter cleanup. The record
  names `reviewer_workspace` or `repository_worktree`, relative paths, appeared/vanished/changed, and
  which of `kind`, `mode`, `size`, `hash`, `mtimeNs`, `linkTarget` differ. File contents are not
  copied into the record. `ReviewerWriteDetectedError` now requires a non-empty list; `verify()`
  without a prepared workspace maps to `adapter_error` because that path has no comparison.

- Reviewer (HX-004, Claude Code, Claude Opus 5, high effort, Anthropic): accepted matching envelope
  HX-004. Verified the implementation against every acceptance criterion; product files were read
  only, and only this artifact was written.

## Evidence

- Enumerating every `events.jsonl` under `.spartan-bridge/runs` in this repository and the Board,
  19 runs reached `review_started` and 4 terminated `blocked` / `reviewer_write_detected`:
  `run-1346c03b` (task `0011`), `run-8bc2b261` (task `0016`), `run-15e9e502` and `run-7e2536ea`
  (both task `0021`, the Board). The plan previously recorded two of these four.
- The `artifact_hashes.task` value in each blocked run's terminal event equals the value in the
  run that followed it on the same task: `f165eaa2` for `run-1346c03b` and the passing
  `run-3469f5ae`; `67e5ccf7` for `run-8bc2b261` and `run-7decc29d`, which returned
  `changes_requested`; `f9549440` for `run-15e9e502` and `run-7e2536ea`, both blocked. Identical
  input, opposite outcomes in this repository, and a repeated block in the Board.
- Each blocked run terminated with `verdict: null` and `model_observed: null`, and emitted no
  `task_artifact_written` event, so the block occurs before any result is accepted and leaves the
  artifact untouched.
- Blocked runs ran 51.8s, 93.2s, 122.7s and 137.8s before terminating, within the range of the
  runs that completed, so the reviewer session is spent in full before the guard fires.
- `src/adapters/cursor.ts` `verify()` calls `snapshotTree` on the workspace and throws
  `ReviewerWriteDetectedError` when `workspaceDiffers` returns true; the error carries only a
  message string.
- `src/core/snapshot.ts` `snapshotDiffers` returns a boolean and discards which key differed.
- `reviewer_write_detected` is returned from two places: `mapVerifyError` on
  `ReviewerWriteDetectedError` from the adapter's `verify()`, and directly at
  `src/core/review.ts:346` when `snapshotDiffers(baseline, after, excluded)` is true for the
  repository worktree. The events and status of the two are indistinguishable.
- `SKIPPED_DIR_NAMES` in `src/core/snapshot.ts` is `.git`, `node_modules`, `.spartan-bridge`.
  This repository's worktree therefore includes `dist/` in that walk; the Board's includes
  `.venv/` (1372 files), `__pycache__/`, `.pytest_cache/`, `instance/` and a `.DS_Store`.
- No file or directory in either repository carries a modification time inside any of the four
  block windows, converting the event timestamps from UTC to the machine's `-0300`. A directory's
  mtime is bumped when an entry is added or removed and survives the entry's deletion, so a
  transient file in the worktree would have left that trace.
- Neither worktree drifts at rest. Snapshotting both with `snapshotTree` and comparing with
  `snapshotDiffers` under `review.ts`'s own exclusions across a 130-second idle window — the
  longest observed block window — reported no differing entry in this repository (199 entries)
  and, in the Board (1609 entries), only the live task path, which the exclusion set removes.
  Both comparisons returned clean.
- The Board's caches are all older than the blocks: `__pycache__` at 2026-08-11 20:43,
  `.pytest_cache` no later than 2026-08-12, `instance/projects.json` at 2026-08-16 08:30.
- The Board's Flask application was running during at least one Board review round and was
  stopped during one, reported by the human. It has a write path into its own worktree:
  `save_projects` in `app.py` creates a `NamedTemporaryFile` inside `instance/` and renames it
  over `instance/projects.json`. `instance/` is not in `SKIPPED_DIR_NAMES`, so adding or removing
  a project in the Board UI during a review would fire the worktree guard, and the temporary file
  would be gone before anyone looked. That did not happen here: `instance/projects.json` is dated
  2026-08-16 08:30, two days before both blocks, so `save_projects` did not run during either.
- No `.pyc` was written for the Board's entry point during those runs either. `app.py` is executed
  as `__main__`, and CPython does not byte-compile the main script, so the reloader restarting it
  writes nothing. `__pycache__/app.cpython-311.pyc` is dated 2026-08-11 while `app.py` was last
  modified 2026-08-17: the cache is stale and stayed stale, which is what that mechanism predicts.
  Reads and `stat` calls move `atime`, which `entriesEqual` does not compare.
- The interrupt that stopped it did not reach the run. A `SIGINT` delivered to the review's
  foreground process group would have killed the Node process before it could write a terminal
  event, and both blocked runs recorded `run_terminal` normally.
- Together these place the worktree comparison as a latent false-positive surface rather than the
  explanation for these four blocks: a build or an editor save during a review would fire it, but
  nothing wrote either tree while any of the four ran. What varies between a blocked run and its
  retry is therefore still unlocated, and the reviewer workspace remains the place it can be.
- `snapshotTree` records the workspace root as `rel: "."` with `kind`, `mode` and `size` and no
  timestamp; a create-and-delete of a short-named file inside a staged workspace left that entry
  at `size: 128` and `workspaceDiffers` false, so that mechanism does not explain the blocks.
- A reconstruction using the runtime's own functions, with the real prompt and model against a
  `0555` workspace holding `0444` copies, exited 0 with `workspaceDiffers: false`.
- No workspace from either blocked run survives; the only `spartan-bridge-review-*` directories
  remaining were created by the reconstruction scripts.
- HX-003: `npm run typecheck` exit 0; `npm test` 110 passed, 0 failed. Product-file mutation
  persists `reviewer_write.comparison: repository_worktree` with a relative changed path; workspace
  copy mutation persists `reviewer_workspace` with `task.md`; the two identities differ. Distinctive
  payloads do not appear in `status.json`. `snapshotDiff` covers appeared, vanished, and each
  comparable field. An empty `ReviewerWriteDetectedError` list throws `TypeError`.

## Review

<!-- spartan-bridge:review:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-c89f2a14-ab5b-4204-acb0-e403fcf7a4db execution_id=exec-f1828c6b-6a7f-466c-a90f-9f0e0c6457fc review_kind=plan verdict=pass reason_code=review_passed host=cursor launcher=cursor-plan-reviewer-v1 model=cursor-grok-4.6-high-fast effort=none model_observed=declared_unobserved policy_digest=sha256:5ce5ce183767d86bbd03d6217f03b8849dd70c4a7609b5b84f750ecbb1d0100f task_hash=sha256:96f04e2102a27bfede62acec3215bf7f978912d7a1d36a6dc8a964a0e8327440 agents_hash=sha256:30644e4ddfe923cc72bc6a40fd5d26c1af74682d01e4329f4c5d93016be00e7f timestamp=2026-08-18T14:38:45.408Z
<!-- spartan-bridge:review:end -->

### Implementation review (HX-004, Claude Code, Claude Opus 5, high effort, Anthropic)

Verdict: APPROVED. Accepted matching envelope HX-004; product files were read only, and only this
artifact was written.

D4 was the criterion most likely to be satisfied on paper and missed in substance, so it was
checked first. It is not satisfied on paper: `ReviewerWriteDetectedError`'s constructor throws a
`TypeError` when handed an empty list, so the error that terminates the run cannot exist without
the evidence for it. The boolean has become a wrapper — `snapshotDiffers` is
`snapshotDiff(...).length > 0` — rather than a parallel computation, which is the distinction the
finding turned on. A test pins the constructor's refusal directly.

The rest verified as specified.

- **Both emitters are distinguishable, and a test says so.** `verify()` throws with
  `reviewer_workspace`, `review.ts` terminates with `repository_worktree`, and the test asserts the
  two comparison values differ rather than asserting each in isolation. That is the assertion that
  would fail if the second emitter went back to terminating bare.
- **No content reaches the record, checked against real payloads.** The tests write known strings
  into the compared files and assert the serialized record does not contain them, and separately
  lock the entry shape to exactly `["path", "change", "fields"]`, so a later field cannot smuggle
  content in without failing.
- **Paths cannot leak the temp workspace.** Each entry is asserted non-absolute and asserted not to
  contain the workspace root string.
- **The record is built before cleanup** because the entries travel inside the error, constructed at
  the moment of comparison from the two in-memory snapshots. Nothing re-walks a tree that
  `cleanup()` has already removed.
- **The guard did not move.** A blocked run still terminates `blocked` /
  `reviewer_write_detected`, and a test asserts `reviewer_write` stays `null` on runs that are not
  blocked.

`npm run typecheck` clean; `npm test` 110 pass, 0 fail, up from 107.

Findings:

- `EVENTS-OMIT-RECORD` (info): the record is persisted to `status.json` and printed on the review
  command's stdout, but `EventDocument` has no `reviewer_write` field, so `events.jsonl` does not
  carry it. `AGENTS.md` names `events.jsonl` as operational runtime truth. This is harmless in
  practice — a block is terminal, so `status.json` retains it in the same run directory — but a
  reader who follows `AGENTS.md` to the event log alone will not find the detail this task exists
  to produce.
- `FIELDS-MEANS-TWO-THINGS` (info): for a `changed` entry, `fields` lists what differs; for
  `appeared` and `vanished` it lists what is present, which for any entry always includes `kind`,
  `mode` and `size`. Both readings are defensible and neither is wrong, but the key carries two
  meanings depending on a sibling key's value, and nothing in the record says so.
- `UNPREPARED-BRANCH-RECLASSIFIED` (info, not a defect): `verify()`'s unreachable not-prepared
  branch moved from `reviewer_write_detected` to `adapter_error`. This is correct — that branch
  never involved a comparison and was a fifth way to emit the reason code without evidence — but it
  changes a reason code on a path the plan did not name. Recorded so the change is attributable.

## Blockers

None.

## Next Action

None. Every acceptance criterion is checked, `npm run typecheck` and `npm test` have recorded
outcomes, the plan review and the implementation review are both `APPROVED`, and no blocker
remains. Committing is the human-only gate.

## Next Handoff

No outstanding proposal. This task is closed.

Non-binding note for the human: `dist/` needs rebuilding before the next run. The next occurrence
of `reviewer_write_detected` will carry its own evidence in `status.json`. The three informational
findings above are candidates for a follow-up, together with the `adapter_error` ambiguity seen in
`run-ab1cf4ec`: it collapses four distinct causes into one reason code and discards the child's
`stderr`, which is the artifact that would separate them.
