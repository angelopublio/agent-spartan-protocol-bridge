---
protocol: "1.1.0" # x-release-please-version
id: scope-the-producer-symlink-rejection-to-writable-paths
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

# Unblock a Python virtualenv from the producer write-scope symlink walk

(Filename kept for continuity; the title's original "scope to writable paths"
approach was tried and reverted — see Work Completed / D-051.)

## Objective

The automatic plan-pass -> implementer chain runs to completion in a Python
consumer repository whose `.venv/bin/python*` symlinks previously failed the
producer write-scope lock. The symlink walk stays tree-wide (every
producer-visible symlink fails closed) — only `.venv` / `venv` join the
skipped-directory-name set, alongside `.git` / `node_modules` / `.spartan-bridge`
/ `.claude` / `.cursor`. A leftover link in `build/`, `dist/`, or any
non-skipped directory still fails closed.

## Context

Found 2026-08-30 running the auto-chain on board task `0023`
(`agent-spartan-protocol-board`). The plan review passed (cycle 2, `APPROVED`,
`run-701f3900-f022-411a-82ba-7d9ddae5c756`); the Bridge then tried to
auto-start the mapped Cursor implementer, which stopped **before touching any
file**: `document: transition`,
`transition-61ba4ca2-dca6-4fdb-92d2-0e41c3acff8c`, `state: stopped`,
`reason_code: producer_failure`,
`producer_diagnostic: { stage: "write_scope_lock", write_scope_code: "symlink" }`.
No cycle was billed; only the Bridge's own review-region persistence write
happened.

Root cause, in `src/adapters/producer-write-scope.ts`:

- `applyProducerWriteScope` (line ~113) calls `rejectProducerVisibleSymlinks(realRoot, "")`,
  which walks the **entire repository tree** from the real root and throws
  `ProducerWriteScopeError("symlink")` (line ~151) on the first symlink whose
  path is not nested in `SKIPPED_DIR_NAMES`.
- `lockTree` (line ~252) also recurses the entire tree and throws the same
  error on any non-skipped symlink (line ~267). It runs after the reject pass,
  so it is a second site with the identical over-broad check.
- `SKIPPED_DIR_NAMES` (`src/core/snapshot.ts:14`) is
  `{.git, node_modules, .spartan-bridge, .claude, .cursor}` — no `.venv`.

The board repo has a standard virtualenv: `.venv/bin/python`,
`.venv/bin/python3`, `.venv/bin/python3.9` are symlinks to the system
interpreter. `.venv` is gitignored (`.gitignore:3-4`) and is in no write or
review scope. The guard walks into it anyway and fails closed.

This blocks the auto-chain on **every** Python consumer repository with a
root virtualenv, and any other repo with symlinks in a gitignored tooling
directory (`.tox`, `.nox`, `.direnv`, `node`-adjacent caches, ...). The Bridge
repo itself is unaffected (Node, `node_modules` already skipped, no `.venv`).

**The threat model the symlink rejection actually serves.** A symlink is a
concern only when the producer could use it to write outside the sandbox: a
symlink on a path the write scope makes writable (the producer follows it and
writes the target), or a symlink that is an ancestor of an admitted exact-file
entry (redirects the whole admitted subtree). A symlink in a location no scope
makes writable — `.venv/bin/python` — cannot be followed for a write: the
Darwin `sandbox-exec` profile
(`producerWriteScopeSandboxProfile`) denies `file-write*` everywhere under the
root except the positively-admitted subpaths, and the mode lock sets it
read-only. Rejecting it is defence with no threat behind it.

**The guard already has the right predicate, and already uses it next door.**
`rejectWritableHardLinks` (line ~169) rejects a multi-link file only when
`stat.isFile() && stat.nlink > 1 && pathRemainsWritable(rel, writeScope)` —
it scopes itself to writable paths. `lockTree`'s own file branch also special-
cases `!writable && stat.nlink > 1` to leave the inode untouched. The symlink
check is the one place in the file that rejects tree-wide instead of
scope-wide.

**Ancestor symlinks are covered separately.** `requireExistingExactFileLeaf`
(line ~204) walks every path component of each admitted exact-file entry and
throws `symlink` (line ~220) on a symlink ancestor; `ensureAdmittedDirectory
parents` handles admitted directory parents. So the tree-wide walk in
`rejectProducerVisibleSymlinks` is not what protects admitted-path ancestors —
that protection stays regardless of this change.

## Scope

- `src/adapters/producer-write-scope.ts`: change the symlink handling in
  `rejectProducerVisibleSymlinks` and in `lockTree` so a symlink is rejected
  only when its own path `pathRemainsWritable(rel, writeScope)`; a symlink on a
  non-writable path is skipped (`lockTree` leaves its mode untouched, like the
  non-writable hard-link branch).
- Leave `requireExistingExactFileLeaf`'s ancestor-symlink rejection (line ~220)
  exactly as is.
- Leave `producerWriteScopeSandboxProfile` as is — its positive-scope model
  already denies writes outside admitted subpaths.
- `docs/DECISIONS.md`: one dated entry, in the D-047 family.
- Tests in `tests/producer-write-scope.test.ts`: a repo with an out-of-scope
  symlinked dir (`.venv/bin/python` shape) locks and spawns; a symlink on a
  writable admitted path still throws `symlink`; a symlink ancestor of an
  admitted exact-file entry still throws.
- Consider a `tests/transition.test.ts` case asserting the auto-chain reaches
  the producer spawn when the repo has an out-of-scope symlink tree.

## Out of Scope

- Adding `.venv` / `venv` to `SKIPPED_DIR_NAMES` (Alternative A in Decisions —
  rejected as whack-a-mole unless the reviewer disagrees).
- A gitignore-aware skip (Alternative B — rejected: adds a git dependency to a
  fail-closed security path).
- `lockTree` recursing into `.git` / `node_modules` to chmod every entry
  read-only. It is a latent cost (a chmod storm on large Node trees) and
  arguably wrong for `.git`, but it is pre-existing, separate from this bug,
  and changing it touches the mode-lock guarantee. Note it for a follow-up
  task; do not fix it here.
- Any change to how `AGENTS.md` declares write / review scope.
- The board repo. It only consumes the runtime.

## Constraints

- English artifact.
- This is a security boundary. The change must not let a producer write outside
  the admitted write scope through any symlink, hard link, or `..` path. The
  plan review confirms the threat model before the decision is locked.
- The two edited sites (`rejectProducerVisibleSymlinks`, `lockTree`) must use
  the *same* predicate for "reject this symlink", so they cannot drift.
- `npm run typecheck`, `npm test`, `npm run build` clean. `npm test` adds no new failure beyond the two pre-existing `tests/agents.test.ts` failures tracked in task `0050` (`b535dbb` regression, unrelated to `producer-write-scope.ts`).

## Acceptance Criteria

- [ ] D1: both `rejectProducerVisibleSymlinks` and `lockTree` reject a symlink
      only when `pathRemainsWritable(rel, writeScope)` is true; both call the
      same predicate.
- [ ] D2: `requireExistingExactFileLeaf` still throws `symlink` on a symlink
      ancestor of an admitted exact-file entry (unchanged; a test pins it).
- [ ] A repo whose only symlinks are under an out-of-scope gitignored
      directory (`.venv/bin/python` shape) completes
      `applyProducerWriteScope` and reaches producer spawn; a test covers it.
- [ ] A symlink placed on a writable admitted path still fails the lock with
      `write_scope_code: symlink`; a test covers it.
- [ ] `docs/DECISIONS.md` carries one dated entry (D-047 family).
- [ ] `npm run typecheck` and `npm run build` are clean; `npm test` adds no new failure beyond the two pre-existing `tests/agents.test.ts` failures tracked in task `0050`.

## Decisions

- **D1 (proposed) — scope the symlink rejection to writable paths.** In
  `rejectProducerVisibleSymlinks` and `lockTree`, a symlink is rejected iff its
  path is admitted-writable by the scope, mirroring `rejectWritableHardLinks`.
  A non-writable-path symlink is skipped. Rationale: matches the threat model
  (only a followable-for-write symlink matters), makes the two symlink sites
  consistent with the hard-link site beside them, needs no directory-name list
  and no git dependency, and fixes every out-of-scope symlink tree at once.
- **Alternative A — `.venv` / `venv` in `SKIPPED_DIR_NAMES`.** Smallest diff,
  D-047-consistent, but a per-ecosystem name list (`.tox`, `.nox`, `.direnv`,
  `env`, `.venv311`, ...) that will need re-visiting. Viable fallback if the
  reviewer judges D1 too broad.
- **Alternative B — skip gitignored paths.** Rejected: a `git check-ignore`
  shell-out inside a fail-closed security path; "gitignored" is not a security
  property; would give the symlink walk a different skip set than the mode-lock
  and snapshot walks.
- **Alternative C — skip `SKIPPED_DIR_NAMES` directories during recursion
  (don't descend), plus add `.venv`/`venv`.** Also removes the `lockTree`
  chmod storm, but keeps the name-list property. Fold the "don't descend"
  half into a separate perf follow-up if the reviewer wants it.

## Work Completed

- 2026-08-30: diagnosed the board `0023` auto-chain `producer_failure`
  (`transition-61ba4ca2`). Confirmed the board's only symlinks are
  `.venv/bin/python{,3,3.9}` (`find . -type l`), `.venv` gitignored and in no
  scope, and that `SKIPPED_DIR_NAMES` lacks `.venv`. Traced the two tree-wide
  symlink-rejection sites and the scoped hard-link check they diverge from.
- 2026-08-30 (implementer, Claude Code / claude-sonnet-5; owner asked for
  implement-then-diff-review). **First attempt (commit `b0545cb`, reverted):**
  a `symlinkMustBeRejected(rel, writeScope)` predicate that scoped the symlink
  rejection to `pathRemainsWritable` + ancestor-of-scope + skipped-root. An
  external security review with a live Darwin `sandbox-exec` proof found it
  wrong: the Darwin profile matches the **post-resolution** path, so a leftover
  link with an in-repo name (`build/out -> /tmp/x`, `-> $HOME`) became
  follow-writable — the tree-wide throw was the only layer refusing to start on
  such a link. The hard-link analogy in the patch comment did not hold (a hard
  link stays a path under the root; a symlink resolves off it).
- 2026-08-30 (implementer, corrected — this is the shipped shape): **D1
  revised.** `rejectProducerVisibleSymlinks` and `lockTree` keep the **tree-wide
  throw** (every producer-visible symlink fails closed except one nested under a
  `SKIPPED_DIR_NAMES` tree). `src/core/snapshot.ts` `SKIPPED_DIR_NAMES` gains
  `.venv` and `venv` — the name is the real distinction between `build/out` (a
  regression to catch) and `.venv/bin/python*` (an absolute link to a system
  interpreter, the unblock); no structural predicate separates them, and
  "reject absolute targets" re-blocks Python. Alternative B (gitignore oracle)
  stays rejected.
  - `docs/DECISIONS.md`: **D-051** (rewritten to the shipped decision + the
    `b0545cb` error).
  - `docs/AUTHENTICATION-AND-SECURITY.md`: the skipped-name set updated, and the
    `.venv` / `venv` symlink residual documented next to the `node_modules` one.
  - Tests (`tests/producer-write-scope.test.ts`): a virtualenv's
    `.venv/bin/python*` links do not fail the lock; a leftover link in a
    non-admitted, non-skipped dir (`build/`) still fails closed; the on-scope /
    ancestor-of-scope / skipped-tree-root cases still fail closed.
  - Checks: `npm run typecheck` clean; `npm run build` clean; `npm test`
    **387 pass / 0 fail** (was 384; +3 new).
  - **Residual → task `0053`:** a link nested inside a `SKIPPED_DIR_NAMES` tree
    whose target resolves off the repository root is follow-writable (same as
    `node_modules` today). SBPL cannot deny a lookup-path symlink traversal;
    the real closure is an isolated producer workspace (the reviewer's shape).
    Not a gate for this unblock.

## Evidence

- `src/adapters/producer-write-scope.ts:113` — `rejectProducerVisibleSymlinks(realRoot, "")`.
- `src/adapters/producer-write-scope.ts:141-157` — tree walk, `throw ProducerWriteScopeError("symlink")`.
- `src/adapters/producer-write-scope.ts:262-267` — `lockTree` second identical throw.
- `src/adapters/producer-write-scope.ts:186` — `rejectWritableHardLinks` scopes to `pathRemainsWritable`.
- `src/adapters/producer-write-scope.ts:204-233` — `requireExistingExactFileLeaf` ancestor-symlink rejection (keep).
- `src/adapters/producer-write-scope.ts:293` — `pathRemainsWritable(posix, writeScope)`.
- `src/core/snapshot.ts:14-20` — `SKIPPED_DIR_NAMES`, no `.venv`.
- `src/core/transition.ts:451-462` — `stage: "write_scope_lock"` -> `producer_failure` with `writeScopeCode`.
- Board incident: `run-701f3900-f022-411a-82ba-7d9ddae5c756`,
  `transition-61ba4ca2-dca6-4fdb-92d2-0e41c3acff8c`,
  `write_scope_code: symlink`; board `find . -type l -not -path './.git/*'`
  -> only `./.venv/bin/python{,3,3.9}`.

## Review

Two external security reviews (Grok 4.6). The first rejected the `b0545cb`
scoped-predicate approach with a live Darwin `sandbox-exec` proof
(`build/out -> /tmp/x` follow-writable). The second reviewed the corrected shape
(tree-wide throw + `.venv` / `venv` in `SKIPPED_DIR_NAMES`) and returned "ship
the name-list unblock, revert the scoped predicate, do not hold for the
nested-skipped residual — that needs an isolated producer workspace, a separate
task; SBPL cannot express the lookup-path deny". Both are recorded in
`docs/DECISIONS.md` D-051 and the follow-up is task `0053`.

## Blockers

None.

## Next Action

None. Task completed 2026-08-30. Owner ratified the shipped shape after a third
Grok pass confirmed the committed code matches the recommendation and has no
bug; the two coverage gaps it named are closed (`venv/` and nested-`.venv`
tests; `docs/ARCHITECTURE.md` symlink sentence). `npm test` 387 / 0, build
clean. The nested-skipped follow-write residual is task `0053`.

## Next Handoff

No outstanding handoff. The task is complete.

Return only the next handoff, or a completion notice if no work remains.
```
