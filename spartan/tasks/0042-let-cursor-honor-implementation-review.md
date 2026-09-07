---
protocol: "1.0.0" # x-release-please-version
id: let-cursor-honor-implementation-review
created_at: 2026-08-23
status: completed
phase: complete
task_type: implementation
risk: high-impact
current_role: implementer
next_role: none
updated_at: 2026-08-23
handoff_id: HX-002
next_handoff_id: none
---

# Let Cursor honor implementation review

## Objective

When `AGENTS.md` binds `reviewer.implementation` to Cursor, `spartan-bridge doctor`
reports that adapter available and a foreground `/spbridge` chain may continue
from a finished implementer declaration through `reviewer.implementation`
instead of stopping as `capability_denied`. Plan review, producer confinement,
and the existing workspace library stay unchanged.

## Context

The owner remounted every Agent hosts row onto Cursor so role rotation can
follow token windows. `reviewer.implementation` is already Cursor /
`gpt-5.6-terra`. The Cursor adapter still declared `review_kinds: ["plan"]`.
The core refuses a mapped implementation review before preflight. Codex already
declares both kinds and calls `prepareReviewWorkspace`. Cursor plan review still
copies only `task.md` and `AGENTS.md`. Adding `"implementation"` to the
capability list without that workspace would let doctor lie and run a blind
review.

This task does not add a Codex producer or a Claude adapter. Those hosts still
cannot fill a role their adapter does not implement. The rule is: a binding in
`AGENTS.md` is honored when that host's adapter implements the role.

The primary worktree may still carry an unrelated dirty task `0031` artifact.
This task must not edit it.

## Scope

- `src/adapters/cursor.ts`: declare both review kinds; prepare the
  implementation workspace through the existing library; select the
  implementation prompt; snapshot with workspace policy.
- `tests/cursor-adapter.test.ts` and `tests/implementation-review.test.ts`:
  capability pin, implementation prepare/start, unchanged plan-review spawn.
- `docs/DECISIONS.md`, `docs/AUTHENTICATION-AND-SECURITY.md`: dated amendment
  and adapter-wiring sentence.
- This task artifact.

## Out of Scope

- Task `0031` and a live `/spbridge` retry of that artifact from this task.
- A Codex producer adapter, a Claude adapter, new reason codes, argv flag
  changes, write-scope, or authentication.
- Encoding client-profile paths or credentials.

## Constraints

- Reviewers stay read-only (`--mode plan --sandbox enabled`).
- Implementation workspace membership stays the decoded review scope via
  `prepareReviewWorkspace`. Do not invent a second copy.
- The implementation prompt names only workspace-relative files
  (`AGENTS.md`, `task.md`, `diff.patch`, `changes.txt`, `worktree/`).
- Human-authorized same-session implementation: the automatic
  `reviewer.implementation` successor is the defect under repair.

## Decisions

### D1 - Cursor declares both review kinds, in Codex order

`cursorCapabilities().review_kinds` becomes `["plan", "implementation"]`.
Doctor and `runReview` then admit a Cursor `reviewer.implementation` binding.
Plan-only capability is no longer a hard Cursor limit.

### D2 - Implementation prepare reuses the existing workspace library

When `review_kind === "implementation"`, `CursorAdapter.prepare` calls the
same `prepareReviewWorkspace` Codex already calls, writes `AGENTS.md` and
`task.md` into that workspace, records those envelope files in the retained
`workspace-manifest.json`, and snapshots with `policy: "workspace"`.
Plan prepare stays the ephemeral two-file copy. `ReviewerIsolationUnavailableError`
still becomes `AdapterIsolationError`. Codex uses the same envelope rewrite.

### D3 - Implementation start keeps Cursor read-only flags and swaps only the prompt

Argv prefix, `--sandbox enabled`, `--mode plan`, model composition, env
allowlist, and cwd-on-workspace stay. The prompt becomes
`CURSOR_IMPLEMENTATION_REVIEW_PROMPT`, parallel to the Codex implementation
prompt: review `AGENTS.md`, `task.md`, `diff.patch`, `changes.txt`, and
`worktree/`; return the same JSON contract with `review_kind: implementation`.

### D4 - Docs record the amendment; other hosts stay capability-gated

`docs/DECISIONS.md` amends D-033: Cursor now declares both kinds. Auth docs
say Cursor, like Codex, prepares the implementation workspace from the
resolved scope. A host without an adapter for a bound role still fails
closed. This task does not add Claude review or Codex produce.

## Work Completed

- Human-authorized same-session planning and implementation (Cursor, Grok 4.6), 2026-08-23: wrote D1-D4, then changed
  `cursorCapabilities().review_kinds` to `["plan", "implementation"]`. Cursor
  implementation prepare now calls the existing `prepareReviewWorkspace`
  library, writes `AGENTS.md` and `task.md` into that workspace, and snapshots
  with `policy: "workspace"`. Plan prepare remains the two-file ephemeral copy.
  Start keeps `--mode plan --sandbox enabled` and selects
  `CURSOR_IMPLEMENTATION_REVIEW_PROMPT` from `composeCursorReviewPrompt`.
  Amended `docs/DECISIONS.md` (D-038) and
  `docs/AUTHENTICATION-AND-SECURITY.md`. Re-derived the Cursor capability pin
  and added the implementation prepare/start test. Did not edit task `0031`.
  Rebuilt `dist/` so the linked CLI serves this change. After the first
  live review spawn, corrected the remounted `reviewer.implementation`
  model from `gpt-5.6-terra` to the Cursor identifier `gpt-5.6-terra-high`
  so `composeCursorModelArg` does not emit `gpt-5.6-terra[effort=high]`.
  Corrected finding `WORKSPACE_MANIFEST_INCOMPLETE`: after writing the
  envelope files, both Cursor and Codex now call
  `recordImplementationReviewEnvelope` so the retained
  `workspace-manifest.json` names `AGENTS.md` and `task.md`. Re-derived D2
  and D-038 from that complete write. Did not edit task `0031`.

## Evidence

- `src/adapters/cursor.ts`: `cursorCapabilities().review_kinds` is
  `["plan", "implementation"]`. `prepare()` branches on
  `input.review_kind === "implementation"` and calls
  `this.prepareWorkspace({ repoRoot, runDir, scope:
  input.implementation_review_scope })`. `start()` passes
  `composeCursorReviewPrompt(input.review_kind)` after the unchanged
  `CURSOR_REVIEW_ARGV_PREFIX` / stream prefix.
- `tests/cursor-adapter.test.ts`
  `"cursor-plan-reviewer-v1 is catalog-owned and passes the capability gate"`
  asserts `review_kinds` is `["plan", "implementation"]`.
- `tests/cursor-adapter.test.ts`
  `"Cursor implementation review prepares the workspace library copy and uses the implementation prompt"`
  asserts the injected `prepareWorkspace` received `["src/", "tests/"]`, spawn
  argv starts with `CURSOR_REVIEW_ARGV_PREFIX`, the last argv token is
  `CURSOR_IMPLEMENTATION_REVIEW_PROMPT`, that prompt does not contain the
  repository realpath, and the retained `workspace-manifest.json` names
  `AGENTS.md` and `task.md`.
- `tests/workspace.test.ts`
  `"recordImplementationReviewEnvelope appends AGENTS.md and task.md to the retained manifest"`
  asserts those two paths are written in sorted order and a duplicate path
  throws `ReviewerIsolationUnavailableError`.
- `tests/implementation-review.test.ts`
  `"D3 production declarations are exact and ordered"` now pins
  `cursorCapabilities().review_kinds` to `["plan", "implementation"]`.
- `docs/DECISIONS.md` D-038 amends D-033. Auth docs now say Codex and Cursor
  prepare the implementation workspace from the resolved scope.
- Repository checks, 2026-08-23: `npm run typecheck` exited 0; `npm test`
  exited 0 with 346 passed and 0 failed; `npm run build` exited 0;
  `git diff --check` on this task's product files exited 0.
- `spartan-bridge doctor --repo` of this repository, after the rebuild, with
  the machine-local config home visible (isolated Cursor `HOME` otherwise
  hides the user-local registry):
  `binding reviewer.plan: adapter available; launcher=cursor-plan-reviewer-v1`
  `binding reviewer.implementation: adapter available; launcher=cursor-plan-reviewer-v1`
  `binding implementer: adapter available; launcher=cursor-plan-reviewer-v1`
- `git status --short` still lists the pre-existing dirty task `0031`
  artifact. `git diff --stat` for that path is unchanged by this task.

## Review

<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-4984df64-4c96-4eb7-b202-f2fed47e2a35 execution_id=exec-8175e8de-cd2e-44d7-a0c0-492c468cbb78 review_kind=implementation verdict=pass reason_code=review_passed host=cursor launcher=cursor-plan-reviewer-v1 model=gpt-5.6-terra-high effort=high model_observed=declared_unobserved policy_digest=sha256:353a73cb46711e2d46a71ccc32d7d2ef103a4984e848f53d35d9c668de0389f1 task_hash=sha256:b4d93f6feec292669eceddd7d95178baa6deb7cc807c37e169609013f560670c agents_hash=sha256:f97af688a4e0414b32c9d0af094106d0af3e78f3431fcd683f84a47589c152a5 timestamp=2026-08-23T12:04:49.742Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None. The owner authorized same-session implementation because the automatic
implementation-review successor is the defect under repair. After this
declaration the foreground Bridge may start `reviewer.implementation`.

## Next Action

None. Task completed: Cursor honors `reviewer.implementation`, the envelope
files are recorded in the retained manifest, implementation review passed, and
acceptance criteria are satisfied.

## Acceptance Criteria

- [x] D1: `cursorCapabilities().review_kinds` is `["plan", "implementation"]`.
- [x] D2: Cursor implementation prepare calls `prepareReviewWorkspace` with
      the resolved scope, writes `AGENTS.md` and `task.md`, records those
      files in the retained manifest, and snapshots with workspace policy.
      Plan prepare still exposes only `AGENTS.md` and `task.md`.
- [x] D3: implementation spawn keeps the existing review argv prefix and
      uses `CURSOR_IMPLEMENTATION_REVIEW_PROMPT`. The prompt contains no
      repository path.
- [x] D4: D-033 is amended; auth docs name Cursor as an implementation
      workspace caller. No new host adapter is claimed.
- [x] `npm run typecheck` and `npm test` exit 0.
- [x] Task `0031` is not modified.

## Next Handoff

No outstanding handoff. Task completed.
