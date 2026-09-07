---
protocol: "1.1.0" # x-release-please-version
id: stop-attributing-the-launchers-worktree-writes-to-the-reviewer
created_at: 2026-08-30
status: completed
phase: done
task_type: implementation
risk: material
current_role: human-operator
next_role: none
updated_at: 2026-08-30
handoff_id: HX-001
next_handoff_id: none
---

# Stop attributing the launcher's worktree writes to the reviewer

## Objective

A `spartan-bridge review` run is not blocked `reviewer_write_detected` because
the process that launched it wrote a file under the repository — a log, a
redirect target, an editor swapfile. The reviewer-write guard watches the tree
the reviewer can actually reach. A reviewer that escapes its workspace is still
caught.

## Context

Hit twice on 2026-08-30 — task `0049` first plan-review attempt and task `0050`
first plan-review attempt. In both, the `/spbridge` driving session ran
`spartan-bridge review --repo <repo> --task <t> 2>err.log` with `err.log`
resolving to the repository root (the session's cwd). Both runs terminated
`state: blocked`, `reason_code: reviewer_write_detected`,
`reviewer_write: { comparison: "repository_worktree", entries: [err.log
(changed)] }`, no verdict.

**The reviewer never touched `err.log`, and for a plan review it could not
have.** `src/adapters/claude.ts` runs the reviewer CLI with `cwd: os.tmpdir()`
(line ~215) against a prepared workspace directory that holds only copies of
`AGENTS.md` and `task.md`, chmod'd read-only (lines ~262-271). The reviewer has
no handle to the repository root at all. The Cursor plan reviewer likewise runs
in a throwaway fixture worktree.

**There are already two write checks, and the redundant one causes the false
positive.**

1. Adapter-level, correct: `ClaudeAdapter.verify()` (`src/adapters/claude.ts`
   line ~381) snapshots `this.workspaceRoot` — the tree the reviewer actually
   ran in — before and after, and throws
   `ReviewerWriteDetectedError("reviewer_workspace", entries)` on any diff. The
   adapter records whether it prepared an isolated copy: `snapshotPolicy` is
   `"workspace"` for an isolated prepare (line ~277) and `"repository"` only
   for the in-place fallback where `workspaceRoot === repoRoot` (line ~284).
2. Runtime-level, redundant for isolated adapters: `src/core/review.ts` takes
   `baseline = snapshotTree(repoRoot)` (line ~456) before the reviewer runs and
   `after = snapshotTree(repoRoot)` (line ~557) after, excludes only the task
   artifact and `AGENTS.md` paths (line ~558), and blocks on any other diff
   entry with `comparison: "repository_worktree"` (lines ~559-575).

For an isolated adapter, check 2 watches a tree the reviewer never reaches. It
cannot detect a reviewer write — the reviewer is in `os.tmpdir()` with two
files — so every entry it ever produces is the launching process or some other
concurrent writer. It has now caught the launcher twice and its actual target
zero times.

**Why the whole-tree diff exists at all:** defence in depth for a reviewer that
runs in place (adapter fallback, `workspaceRoot === repoRoot`) or one that
somehow escapes its workspace. That value is real only for the in-place path.

## Scope

- `src/core/review.ts`: skip the `repository_worktree` `baseline`/`after`
  `snapshotTree(repoRoot)` diff when the resolved adapter reports it ran on an
  isolated workspace copy. Keep it unchanged for the in-place path.
- The isolation signal: a capability or prepared-state field the adapter
  already has in substance (`snapshotPolicy`). D1 picks the exact surface —
  an `AdapterCapabilities` boolean, or a value the adapter returns from
  `prepare`/a getter. It must be observable to `review.ts` before line ~456.
- `agent-skill/skills/spbridge/SKILL.md`: one sentence in the invoke section —
  do not redirect the CLI's stdout or stderr to a path under `--repo`; let them
  reach the terminal or a path outside the repository. Belt-and-suspenders,
  applied regardless of D1.
- `docs/DECISIONS.md`: one dated entry (D-047 family).
- Tests: `tests/review.test.ts` — an isolated-adapter review with a file
  created under `repoRoot` mid-run reaches a verdict (not blocked); an
  in-place-adapter review with the same still blocks `reviewer_write_detected`.
  `tests/claude-adapter.test.ts` / existing adapter tests — the
  `reviewer_workspace` `verify()` check still fires on a workspace write.

## Out of Scope

- The adapter-level `reviewer_workspace` check (`verify()`), which stays exactly
  as is — it is the correct guard for isolated adapters.
- The in-place fallback path's whole-tree diff — unchanged.
- `reviewer_isolation_unavailable` (a snapshot that throws) — separate failure,
  not touched.
- Making the launcher's cwd not the repository, or sandboxing the launcher —
  larger and not required once check 2 is scoped.
- The `err.log` filename specifically — no name allowlist (Alternative A).

## Constraints

- English artifact.
- Security boundary: after this change, a reviewer that writes anywhere its
  workspace can reach is still caught by the adapter `verify()` check; a reviewer
  running in place is still caught by the runtime check. Only the
  isolated-adapter + real-repo-tree combination — which the reviewer cannot
  write to — stops being compared.
- No new `reviewer_write` comparison value; `repository_worktree` and
  `reviewer_workspace` are unchanged.

## Acceptance Criteria

- [ ] (D1) `src/core/review.ts` does not run the `snapshotTree(repoRoot)`
      `baseline`/`after` diff when the adapter ran isolated; it still runs it
      for the in-place path. The isolation signal is read from adapter state,
      not inferred from the host name.
- [ ] An isolated-adapter plan review with an unrelated file created under
      `repoRoot` while the reviewer runs returns a verdict; a test covers it.
- [ ] An in-place-adapter review with a mid-run `repoRoot` write still
      terminates `blocked` / `reviewer_write_detected`
      (`comparison: "repository_worktree"`); a test covers it.
- [ ] The adapter `verify()` `reviewer_workspace` check still throws on a write
      inside the prepared workspace; an existing or new test pins it.
- [ ] `agent-skill/skills/spbridge/SKILL.md` invoke section tells the caller not
      to redirect CLI output under `--repo`.
- [ ] `docs/DECISIONS.md` carries one dated entry.
- [ ] `npm run typecheck` and `npm run build` clean; `npm test` adds no new
      failure beyond the two pre-existing `tests/agents.test.ts` failures
      tracked in task `0050`.

## Decisions

- **D1 (pending planner) — how `review.ts` learns the adapter ran isolated.**
  Lean: add `reviewer_isolation: "workspace_copy" | "in_place"` (or a boolean
  `isolated_workspace`) to `AdapterCapabilities`, set `"workspace_copy"` for
  Claude and Cursor, and gate the `repository_worktree` diff on it. The adapter
  already computes the equivalent as `snapshotPolicy` during `prepare`; the
  capability just surfaces the invariant before the run. Alternative: a getter
  the adapter exposes post-`prepare`. Reviewer confirms the capability value
  matches what each adapter's `prepare` actually does.
- **Alternative A — closed non-product path allowlist** (`*.log` at repo root,
  a documented scratch dir): keeps the redundant check, narrows its false
  positives. Rejected as the primary: it leaves a check that structurally
  cannot see its target and papers over that with a name list.
- **Alternative B — SKILL.md doc change only.** Rejected as the primary: the
  prompt already carried that instruction for the `0050` retry and the class of
  mistake recurred within the same day; a caller-discipline rule that a
  security stop depends on is not enough.

## Work Completed

- 2026-08-30: traced both incidents (`run-...` for `0049` and
  `run-b2c22223-d38b-4f88-bdcc-4022a2996f6d` for `0050`). Confirmed
  `src/adapters/claude.ts` runs `cwd: os.tmpdir()` with a two-file prepared
  workspace and its own `verify()` / `reviewer_workspace` snapshot check, and
  that `src/core/review.ts` additionally diffs the whole `repoRoot` tree.

## Evidence

- `src/adapters/claude.ts:~215` `cwd: os.tmpdir()`; `:~262-271` prepared
  workspace = `AGENTS.md` + `task.md` copies, read-only; `:~277` / `:~284`
  `snapshotPolicy` `"workspace"` vs `"repository"`; `:~381-388` `verify()`
  throws `ReviewerWriteDetectedError("reviewer_workspace", ...)`.
- `src/core/review.ts:~456` `baseline = snapshotTree(repoRoot)`; `:~557`
  `after = snapshotTree(repoRoot)`; `:~558` excludes only task + `AGENTS.md`;
  `:~559-575` blocks `reviewer_write_detected`
  (`comparison: "repository_worktree"`).
- `src/core/contracts.ts:163` `REVIEWER_WRITE_COMPARISONS = ["reviewer_workspace",
  "repository_worktree"]`.
- Incident `0050`: `.spartan-bridge/runs/run-b2c22223-.../status.json` —
  `state: blocked`, `reason_code: reviewer_write_detected`,
  `reviewer_write.entries` = `err.log`.

## Review

Verdict: PENDING

Findings:

- None recorded.

## Work Completed

- 2026-08-30 (implementer, Claude Code / claude-sonnet-5; owner asked for
  implement-then-diff-review, not the `/spbridge` loop). **D1 as planned.**
  `AdapterCapabilities` gains `isolated_workspace: boolean`; `claude`, `cursor`,
  `codex`, `grok` all report `true` (confirmed: each `prepare()` sets
  `this.workspaceRoot` to a `mkdtemp` dir or a scope copy, never `repo_root`,
  and each `verify()` snapshots that workspace). `src/core/review.ts` takes the
  `baseline` and `after` `snapshotTree(repo_root)` diff — and returns
  `reviewer_write_detected` / `reviewer_isolation_unavailable` from it — only
  when `!capabilities.isolated_workspace`.
  - `docs/DECISIONS.md`: **D-052**.
  - `agent-skill/skills/spbridge/SKILL.md` step 4: do not redirect CLI output
    under `--repo` or write the repo during a review.
  - `docs/AUTHENTICATION-AND-SECURITY.md` and `docs/ARCHITECTURE.md`: the
    repository-worktree diff is now in-place-only.
  - Tests: `tests/helpers.ts` `withInPlaceWorkspace`; `tests/write-detect.test.ts`
    +1 (an isolated adapter's review is not blocked by a concurrent `err.log` /
    sibling task file); the repo-worktree-diff tests in `write-detect.test.ts`
    and `adapter-failure.test.ts` now wrap the fake `isolated_workspace: false`;
    `claude`/`codex` adapter capability fixtures updated.
  - Checks: `npm run typecheck` clean; `npm run build` clean; `npm test`
    **388 pass / 0 fail** (was 387; +1 new).

## Blockers

None.

## Next Action

None. Task completed 2026-08-30. The isolated-adapter false `reviewer_write_detected`
(hit 3× on 2026-08-30) is removed; the adapter-side `verify()` /
`reviewer_workspace` check is the operative guard and loses no coverage. The
producer round's equivalent isolation is task `0053`.

## Next Handoff

No outstanding handoff. The task is complete.
