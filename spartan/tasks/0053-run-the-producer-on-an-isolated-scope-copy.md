---
protocol: "1.1.0" # x-release-please-version
id: run-the-producer-on-an-isolated-scope-copy
created_at: 2026-08-30
status: completed
phase: complete
task_type: implementation
risk: high-impact
current_role: human-operator
next_role: none
updated_at: 2026-09-05
handoff_id: HX-013
next_handoff_id: none
---

# Run the automatic producer on an isolated copy of the admitted scope

## Objective

The automatic implementer does not run against the live repository worktree. It
runs against a Bridge-owned copy rooted outside the repository, spawns there
under a sandbox profile that is **allow-list shaped**, and its in-scope changes
are validated and merged back into the live tree under the writer lock the
transition already holds.

The claim this task makes is deliberately exact, because an earlier draft
overstated it:

1. **No producer write reaches under the repository root by name or by
   symlink.** The profile denies `file-write*` globally and re-allows it only
   for named roots; `R` is then denied outright. Darwin matches a write filter
   against the **post-resolution** path, so this holds through any symbolic
   alias — a leftover `build/out -> /tmp/x`, a link nested in a
   `SKIPPED_DIR_NAMES` tree — without any pre-spawn scope hygiene. Creating a
   hard link that crosses `R` in either direction is denied too.
2. **No symbolic alias grants the producer write reach it did not already
   have.** A write through any symlink is allowed only if its resolved target
   lies in a root the producer could have named directly.
3. **A leftover alias or scratch file at a non-admitted live path no longer
   fails the round**, because the scope-shaped pre-checks that refuse such a
   round today are gone rather than kept.
4. **What is not claimed, in three parts.**

   *Reads.* The profile keeps `(allow default)`, so the producer can still read
   the live tree. This task neither prevents discovery of `R` nor tries to.

   *`HOME` and `TMPDIR`.* The producer keeps direct write access to those two
   roots, as today, because the Bridge does not encode client profile paths.
   **D-051's residual is closed as an escalation path and retained as a residual
   for those two roots** — a symlink whose target resolves under `HOME` or
   `TMPDIR` is still followable, and confers nothing the producer lacked.

   *Pre-existing hard links.* A hard link is a second name for one inode, with
   no target for a path filter to resolve, so no sandbox profile can tell
   `HOME/alias` from `R/src/x` when both name the same inode. A cross-root hard
   link that **already existed** before the round is therefore writable, and
   claim (1) excludes it. It is not prevented; it is **detected** — and the
   detection surface is stated exactly here rather than as "the whole tree",
   because `productBefore` / `productAfter` are taken under `policy: "producer"`
   (`src/core/transition.ts:708`, `:752`) and that policy is not uniform:

   - A live path outside every `SKIPPED_DIR_NAMES` subtree, in a regular file of
     at most `SNAPSHOT_HASH_FILE_CAP` (1 MiB), is compared by SHA-256 of its
     content (`src/core/snapshot.ts:136`).
   - The same path in a larger file is compared by `size` and `mtimeNs` only.
   - A live path **inside** a skipped subtree — `.git/`, `node_modules/`,
     `.spartan-bridge/`, `.claude/`, `.cursor/`, `.venv/`, `venv/` — is not
     dropped from the comparison. The `producer` policy folds the whole subtree
     into one entry at its root whose `hash` is a recursive **metadata** digest
     over kind, path, mode, size, `mtimeNs`, and link target
     (`snapshot.ts:100-103`, `:159`, `:183`, `:218`, `:225`). A difference in
     that digest surfaces as a `changed` entry at the subtree root, which
     `producerPathDenied` refuses outright (`transition.ts:869-893`).

   Detection is bounded twice, and both bounds are stated rather than implied.

   *In space.* A mutation through such a link is detected wherever it lands, a
   skipped subtree included, because every write moves the inode's `mtimeNs` and
   every tier above reads `mtimeNs` or content — **except** a mutation that both
   preserves the file's `size` and restores its `mtimeNs` through the writable
   name. Inside a skipped subtree, and for any file above 1 MiB, no content hash
   is taken, so size and timestamp are the whole comparison.

   *In time.* `productBefore` and `productAfter` are two snapshots, so they
   detect only a write that lands **between** them. D5 states plainly that the
   plan buys no containment: a descendant can `setsid` out of the producer's
   process group and outlive `waitProducer`, and the group signal on cleanup is
   best-effort hygiene no step depends on. Such a survivor still holds the
   sandbox profile — a Darwin sandbox is attached at exec, inherited by every
   descendant, and cannot be relaxed from inside — so the **only** name it can
   use to reach an inode under `R` is still a hard link that already existed
   when the round began. But it can write through that link after
   `productAfter`, and that write is neither prevented nor detected, whatever it
   does to size or timestamp.

   So the honest claim is: a pre-existing cross-root hard link is not prevented,
   and is detected only when the write lands inside the snapshot window and
   changes `size` or `mtimeNs` at a tier that reads them. Outside that, the
   mutation stands. Both residuals are named here rather than closed, and no
   acceptance criterion asserts either away — one criterion pins each, so a
   later change that silently narrows the window breaks a test. D2 states why
   prevention is not available and why a pre-spawn scan is rejected.

The visibility invariant is likewise scoped to non-admitted paths. An untracked
file under an admitted directory such as `src/` is inside the automatic write
scope by definition; it is copied, the producer sees it, and it always could.

## Context

D-051 (task `0049`) shipped the `.venv` unblock by keeping the producer
write-scope symlink walk tree-wide and adding `.venv` / `venv` to
`SKIPPED_DIR_NAMES` (`src/core/snapshot.ts:20`). Two residuals remain, both
because the producer runs on the **live** tree under a deny-under-`R` profile:

1. `producerWriteScopeSandboxProfile` (`src/adapters/producer-write-scope.ts:57`)
   emits `(allow default)` and then a `deny file-write*` whose every branch is
   gated on `(subpath rootLiteral)` (`:80-92`). Darwin matches the
   post-resolution path, so `build/out -> /tmp/x` resolves outside `R`, matches
   no deny branch, and falls through to `(allow default)`. The comment at
   `:143-150` states this. Verified in this checkout.
2. A pre-spawn check cannot fix (1): the offending link exists at lock time and
   rejecting it re-blocks Python (`.venv/bin/python*` is exactly such a link).

Two further facts of this checkout were verified before this revision and
correct an earlier draft of D2:

- The builder does **not** degrade to allow-all on an empty admitted list.
  `producer-write-scope.ts:73` returns `(version 1)\n(allow default)\n(deny
  file-write*)\n` — an unqualified global deny, asserted verbatim by
  `tests/producer-write-scope.test.ts:40`. Reusing that builder with an empty
  scope would therefore deny the producer writing even its own isolated copy.
  The isolated round needs a different builder, not a different argument.
- `lockTree` (`producer-write-scope.ts:270`) itself throws
  `ProducerWriteScopeError("symlink")` on any symlink not nested in a skipped
  tree (`:281-286`). A "deny-all mode lock" that reused `lockTree` would
  reproduce exactly the `build/out -> /tmp/x` failure this task removes.

The reviewer already runs isolated, and the isolation lives in the **runtime**,
not in an adapter: `prepareReviewWorkspace` in `src/core/workspace.ts:180` builds
the workspace, and all four review adapters (`src/adapters/claude.ts:217`,
`codex.ts:301`, `cursor.ts:382`, `grok.ts:273`) only inject it as a seam and
declare `isolated_workspace: true`. The producer needs the writable equivalent:
copy in, spawn, validate, merge admitted changes back.

Three further facts shape the plan and were verified before it was written:

- `startProducer` has three real implementations plus the test double:
  `src/adapters/cursor.ts:686`, `src/adapters/grok.ts:544`,
  `src/adapters/codex.ts:609`, `src/adapters/fake.ts:165`. Each spawns with
  `cwd: input.repo_root` and passes `input.repo_root` in its own
  workspace-root argv slot — `--workspace` (`cursor.ts:75`), `--cd`
  (`codex.ts:68`), `--cwd` (`grok.ts:76`). The three bodies are the same shape.
- `createExclusiveRunDir` (`src/runtime/paths.ts:49`) refuses any run dir that
  is not inside `repoRoot`, so a copy under `.spartan-bridge/runs/<id>/` would
  be **inside** the repository and the child could still name the live tree by
  relative traversal. The producer copy must live outside the repository root.
- The automatic write scope (`AGENTS.md:66`) is `src/`, `tests/`, `docs/`,
  `skills/`, `agent-skill/skills/spbridge/SKILL.md`, `spartan/`, `README.md`,
  `package.json`, `package-lock.json`, `tsconfig.json`. It excludes
  `node_modules/`, so a copy of the admitted scope alone cannot run
  `npm run typecheck`, `npm run build`, or `npm test` — the checks the
  producer's declaration asserts. The copy needs a read-only support set that
  is not merge-back admitted.

This is the shape task `0039` deferred ("D-007's human gate remains the
fallback"), now revisited for the isolation property rather than the transition
authority.

## Scope

- `src/core/workspace.ts`: a producer workspace built next to the reviewer one,
  reusing `workspaceSafeOpenFlags` (`:135`, `O_NOFOLLOW_ANY` on Darwin) and
  `validateRepositoryPath` (`:142`).
  - `prepareProducerWorkspace({ repoRoot, writeScope, supportScope })` — creates
    a `0o700` root via `fs.mkdtemp(path.join(os.tmpdir(), "spartan-bridge-producer-"))`
    and **realpaths it** (Darwin's `os.tmpdir()` returns an unresolved
    `/var/folders/...` path; the profile must name the resolved one, exactly as
    `applyProducerWriteScope` realpaths `repoRoot` today). Copies the admitted
    write scope writable and the support set read-only; returns
    `{ workspaceRoot, baseline }`, `baseline` being
    `snapshotTree(workspaceRoot, { policy: "workspace" })`.
  - `captureProducerMerge({ workspaceRoot, baseline, after, writeScope })` —
    classifies, validates, and **captures** every surviving entry into memory;
    returns a captured change list or a refusal (D5).
  - `resolveMergeDestinations({ repoRoot, captured })` — the `O_NOFOLLOW_ANY`
    destination walk plus the planned-topology check; returns per-entry
    destination facts and the pre-merge undo state, or a refusal.
  - `applyProducerMerge({ repoRoot, captured, destinations })` — writes only
    captured bytes, with the undo journal, and nothing else.
  - `cleanupProducerWorkspace(workspaceRoot)` — best-effort removal on every
    terminal path.
- `src/adapters/producer-write-scope.ts`: `producerIsolatedSandboxProfile(realWorkspaceRoot, realRoot, env)`
  and `applyProducerIsolation(repoRoot, workspaceRoot, env)`, returning a guard
  whose only member is the profile — no mode restores. The live-tree mode lock
  is **removed** for the producer path (D2), and with it
  `applyProducerWriteScope`, `restoreProducerWriteScope`, `lockTree`,
  `producerWriteScopeSandboxProfile`, and the four scope-shaped pre-checks
  (`:119-122`). `ProducerWriteScopeError` and its codes stay.
- `src/adapters/process.ts`: the producer spawn (`:71`) gains `detached: true`
  and the handle exposes the group id, so cleanup can signal a runaway
  descendant. This is hygiene, not a control (D5). Review spawns unchanged.
- `src/core/contracts.ts`: `AdapterProducerInput` (`:432`) gains
  `workspace_root: string`; `ProducerCapabilities` gains
  `isolated_producer_workspace: boolean`, mirroring
  `AdapterCapabilities.isolated_workspace` (`:420`, D-052). The `ProducerAdapter`
  method `lockProducerWriteScope(repoRoot, writeScope)` becomes
  `lockProducerIsolation(repoRoot, workspaceRoot)`.
- `src/adapters/cursor.ts`, `grok.ts`, `codex.ts`, `fake.ts`: pass
  `input.workspace_root` in the workspace-root argv slot and as `cwd`; keep
  `repo_root` only for the profile; declare `isolated_producer_workspace: true`.
- `src/core/transition.ts`: `runGuardedRound` (`:673`) gains prepare, spawn on
  the copy, live-tree no-change assertion, capture, destination resolution,
  guard release, merge apply, then the declaration read — in that order (D5).
  The `D3_RUNTIME_WRITE_BEFORE_GUARD_RELEASE` comment (`:666`) is amended for
  the merge write, and the "lock before snapshot" rationale at `:681-691` is
  amended too: it exists because the mode lock polluted the snapshots, and
  there is no longer a mode lock.
- Tests: `tests/producer-write-scope.test.ts` is rewritten against the isolated
  profile, keeping its real-`sandbox-exec` harness; `tests/cursor-adapter.test.ts`,
  `tests/grok-adapter.test.ts`, and `tests/transition.test.ts` follow the
  interface rename; new tests for prepare, classification, capture, merge, and
  rollback.
- `docs/AUTHENTICATION-AND-SECURITY.md`: the producer isolation model, D-051
  moved from "documented residual" to "closed as an escalation path, retained
  for `HOME`/`TMPDIR`", and the stale sentence "The Cursor producer also applies
  a POSIX write guard" (`:635`) replaced.
- `docs/ARCHITECTURE.md`: the producer round now has a prepare / spawn /
  capture / merge shape.
- `docs/DECISIONS.md`: one dated entry, D-072.

## Out of Scope

- The plan-pass -> implementer transition authority (D-035) — unchanged.
- Confining the producer's **reads**. The profile keeps `(allow default)`.
- Denying the official client its machine-local session state under `HOME` and
  its scratch under `TMPDIR`. Those roots stay writable so the client can
  start, and the Bridge names them from the child environment it already
  composes, never as a hardcoded client profile path.
- The implementation reviewer isolation — already shipped, only referenced.
- Verifying the producer's declared checks. The Bridge still takes the
  declaration as an assertion; this task only makes the checks runnable inside
  the copy.
- `AGENTS.md` and `spartan-bridge/config.yaml`. Nothing here edits them, so the
  ninth authoring rule (`AGENTS.md:145`) does not apply and the implementer
  stays the mapped agent.
- Any change to the write-scope lines themselves, or a fourth producer adapter.

## Constraints

- English artifact.
- Darwin only, as the rest of the isolation already is. `confinedSpawnTarget`
  (`src/adapters/process.ts:19`) **silently drops the profile off Darwin**, so
  an isolated producer round must refuse rather than spawn unconfined.
- The merge-back is the new trust boundary and is **fail-closed**: source and
  destination validation both run over the whole candidate change list before a
  single byte is written to the live tree, and any entry that cannot be
  explained refuses the entire merge with the live tree byte-identical to its
  pre-spawn state and the round stopped at `write_scope_violation`. An
  apply-time failure only the filesystem can raise is rolled back from a
  recorded undo journal to that same state; a rollback that itself fails is a
  named terminal state (`runtime_state_violation`), not a silent partial merge.
  The plan claims no atomicity the filesystem does not provide.
- No change to `max_*_review_cycles`, the writer lock, or the approved-plan
  hash gate. No new `ReasonCode` value (`src/core/contracts.ts:92`).
- The **copy** is bounded by the snapshot caps (`SNAPSHOT_ENTRY_CAP` 20 000,
  `SNAPSHOT_HASH_BYTE_CAP` 256 MiB, `src/core/snapshot.ts:7-9`). The **merge
  capture** is held in memory and gets its own tighter caps.
- The producer child never receives a path under the repository root as its
  workspace argument or `cwd`.

## Decisions

- **D1 — whole-subtree copy; merge by snapshot diff of the copy against its own
  pre-spawn baseline.** A directory scope line is copied as a whole subtree; an
  exact-file scope line is copied as one file, into an **ancestor chain mirrored
  from the live tree**. The automatic scope has one nested exact-file line,
  `agent-skill/skills/spbridge/SKILL.md` (`AGENTS.md:72`), whose ancestors
  `agent-skill`, `agent-skill/skills`, and `agent-skill/skills/spbridge` are
  themselves **not admitted** — `isPathAdmittedByScope`
  (`src/policy/agents-policy.ts:734`) matches an exact line only by full
  equality. Prepare therefore creates each existing live ancestor as a directory
  in the copy with the live directory's mode, so the chain is present in the
  pre-spawn `baseline` and never appears in the diff as a `created` entry. Only
  the named file is copied; the parent's live siblings — `agents/` next to
  `SKILL.md` in this checkout — are not.

  *Named limitation.* If a live ancestor component is absent, the member is
  recorded absent and the chain is **not** created in the copy. A producer that
  then `mkdir`s it emits `created` directory entries at unadmitted paths, which
  the merge refuses. The automatic scope grants that one file, not the right to
  create directories outside the scope lines, and an automatic round cannot
  bring the file into existence under a missing parent. This does not arise in
  this checkout, where the chain exists. Deriving membership file by file
  at copy time would duplicate `isPathAdmittedByScope`
  (`src/policy/agents-policy.ts:734`) in a second place and drift from it. Each
  member is copied **descriptor-backed, never by path**. `fs.copyFile` and
  `COPYFILE_FICLONE` are rejected for exactly this reason: they take paths, so
  opening a validated source and then cloning it by name re-resolves the name
  and could follow a symlink that replaced it in between. Instead the source is
  opened once with `workspaceSafeOpenFlags` (`O_NOFOLLOW_ANY`); if that open
  fails because the entry is a symlink, the member is recorded absent and never
  retried. `fstat` on that descriptor must report a **regular file**; the bytes
  are then streamed **from that descriptor** into a destination opened
  `O_CREAT | O_EXCL | O_WRONLY` in the copy. The source's link count is
  deliberately **not** constrained: the copy reads bytes through a descriptor,
  so a source inode carrying a second name elsewhere yields a correct,
  independent copy, and requiring `nlink == 1` would refuse this very checkout —
  `node_modules/esbuild/bin/esbuild` and
  `node_modules/@esbuild/darwin-arm64/bin/esbuild` are two names for one inode.
  Link count is constrained where it matters instead: on the copy's own files at
  capture, and on live destinations at merge time (D5). The descriptor
  is pinned to the inode it validated, so a live-tree rename or symlink
  substitution after the open changes nothing about what is copied. A symlink
  or non-regular member **inside the admitted write scope** is copied as nothing
  and recorded as absent, never followed. Support-set symlinks are D4's
  business. `.git` is excluded, as `validateRepositoryPath` already enforces.

  Omitting a live symlink from the copy leaves the copy without that path, so a
  producer that writes a regular file there produces a `created` diff entry
  whose live destination is still the old symlink. D5 owns that case; it is a
  merge refusal, not a follow.

  The merge is a **two-snapshot diff, not a three-way**: the baseline is the
  copy the Bridge itself just wrote, so no third version exists to merge
  against. `snapshotTree(workspaceRoot, { policy: "workspace" })` before the
  spawn and again after the child exits; `workspaceDiff(before, after)`
  (`src/core/snapshot.ts:312`) is the candidate change list. `policy: "workspace"`
  is deliberate: it skips no directory name and SHA-256s every regular file, so
  a tail-only mutation inside the copy is visible.

  Rejected: reusing `prepareReviewWorkspace` itself. It is git-plumbing based,
  writes `diff.patch` / `changes.txt` / a manifest into the workspace, freezes
  the result read-only, and roots the workspace under `runDir`, which is pinned
  inside the repository. The producer needs a writable root outside the
  repository with no injected files. The two share helpers, not a body.

- **D2 — the enforcing barrier is an allow-list sandbox profile keyed on the
  copy; the live-tree mode lock is removed, not repurposed.** An earlier draft
  kept a deny-under-`R` profile and demoted the mode lock to a "deny-all tamper
  barrier". Both halves were wrong against this checkout (see Context), and a
  deny-under-`R` shape cannot close the alias class at all, because Darwin
  matches the resolved path.

  `producerIsolatedSandboxProfile` emits clauses in this order, and SBPL
  resolves by last match:

  ```scheme
  (version 1)
  (allow default)
  (deny file-write*)
  (allow file-write* (subpath "<realpath HOME>"))     ; omitted when unset
  (allow file-write* (subpath "<realpath TMPDIR>"))   ; omitted when unset
  (allow file-write* (subpath "<realpath W>"))
  (deny file-write* (require-all (subpath "<realpath W>") (vnode-type SYMLINK)))
  (deny file-write* (subpath "<realpath R>"))
  (deny file-link (subpath "<realpath R>"))
  ```

  Every literal goes through the existing `sandboxPathLiteral`, which throws
  `confine_unavailable` on a quote, backslash, newline, or NUL. `HOME` and
  `TMPDIR` are read from the child environment `childEnvironment` already
  composes, never hardcoded; a value that is unset or whose realpath fails
  contributes no clause rather than failing the round. `R` is denied **last** so
  it wins even when `R` lies under `HOME`, which it usually does.

  What this buys, and only this: every write is matched post-resolution, so a
  write is permitted only when its **resolved target** lies under `HOME`,
  `TMPDIR`, or `W`, and never under `R`. An alias is therefore not a
  privilege — following `build/out -> /tmp/x` is denied because `/tmp` is none
  of the three (Darwin's `TMPDIR` is `/var/folders/...`, not `/tmp`), and
  following an alias to `HOME/x` is allowed only because the producer could
  write `HOME/x` by name anyway. That is the whole security claim, and it is
  the narrowing the Objective records.

  The symlink-creation deny under `W` keeps the producer from manufacturing a
  link the merge would have to reason about; D5 still refuses a `symlink` kind
  independently, since the profile is not the merge's only guarantee.

  **What a path-matching profile cannot express: pre-existing hard links.** A
  symlink has a target the kernel resolves, which is why post-resolution
  matching closes the symbolic alias class outright. A hard link has no target:
  one inode simply carries several independent names, and every filter in this
  profile matches a *name*. So the Objective's claim is split in two.

  *Creation is denied.* `link(2)` requires both the existing name and the new
  name to satisfy the write filter, and `(deny file-link (subpath R))` denies
  `R` as either. A producer cannot manufacture a name under `HOME`, `TMPDIR`,
  or `W` for an inode under `R`, nor a name under `R` for anything else. This is
  enforced and testable under the real sandbox.

  *A pre-existing cross-root link is not preventable.* If `HOME/alias` already
  names the same inode as `R/src/x` when the round starts, a write to
  `HOME/alias` is allowed — correctly, since `HOME` is an allowed root — and it
  mutates the repository inode. No SBPL clause distinguishes the two names. The
  copy's and the capture's link-count checks do not help: they run on the copy,
  and by the time they run the live mutation has already happened.

  *A pre-spawn scan is rejected, on evidence.* The obvious alternative — refuse
  the round when any regular file under `R` has `nlink > 1`, which is what
  `rejectWritableHardLinks` does today for admitted paths — would refuse **every
  round in this repository**: `find . -xdev -type f -links +1` returns
  `node_modules/esbuild/bin/esbuild` and
  `node_modules/@esbuild/darwin-arm64/bin/esbuild`, npm's hard-linked binary, in
  this checkout right now. That is the same failure mode as the symlink
  pre-check this task removes, for the same reason: legitimate tooling creates
  the shape the check refuses. Narrowing the scan to admitted paths would not
  close the case either, since the inodes worth protecting — `AGENTS.md`,
  `spartan-bridge/config.yaml`, `.git` — are precisely the non-admitted ones.

  *What is left is detection, and it already runs — with a stated limit.*
  `runGuardedRound` snapshots the live repository under `policy: "producer"`
  before the spawn (`transition.ts:708`) and again after (`:752`), diffs them
  (`:789`), and refuses the round on any entry `producerDiffViolatesScope`
  rejects (`:790`, `:869`). A write through a pre-existing cross-root hard link
  changes a live path and is caught there.

  This task does **not** widen that snapshot, and the Objective states the three
  tiers it actually compares. Two of them are worth restating where the decision
  is made, because the earlier wording ("whole-tree ... any live-tree change")
  overstated both:

  - A skipped subtree is folded, not dropped. `recordSkippedProducerEntry`
    (`snapshot.ts:159`) writes one entry at the subtree root whose `hash` is
    `metadataTreeDigest` (`:183`, `:218`) — a recursive digest of kind, path,
    mode, size, `mtimeNs`, and link target for every descendant. A mutation
    inside `node_modules/` or `.venv/` moves a descendant's `mtimeNs`, changes
    that digest, and surfaces as `changed` at the subtree root; every path
    component of that entry is in `SKIPPED_DIR_NAMES`, so `producerPathDenied`
    (`snapshot.ts:206`) makes it an unconditional refusal. Detection therefore
    reaches the skipped subtrees, which is what the criteria must exercise
    rather than leave to an unspecified "non-admitted file".
  - Detection is metadata-shaped there, and for any file above
    `SNAPSHOT_HASH_FILE_CAP`. A mutation that preserves `size` and restores
    `mtimeNs` through the writable name is not detected in either place. Closing
    that would mean content-hashing `node_modules/` on both sides of every
    round, which is exactly the cost `SKIPPED_DIR_NAMES` exists to avoid
    (D-051); this task keeps the cost and records the residual instead.

  - Detection is a **window**, not a guarantee. `productBefore` and
    `productAfter` bracket the spawn; a write that lands after `productAfter` is
    outside them. D5 rejects every mechanism that would close that window — a
    descendant can `setsid` out of the group and a same-UID survivor can undo a
    freeze — so the plan does not pretend the producer is quiescent when
    `waitProducer` returns. What does hold is that the profile is inherited and
    irrevocable: a survivor is still confined, so the only reach it has into `R`
    is a hard link that pre-dated the round. The residual is therefore exactly
    that class, delayed — not a wider one.

  Where detection does fire, the round stops with the mutation recorded and no
  merge applied; the mutation is not undone, and the plan claims no undo it
  cannot perform. The residual is still narrower than today's, where the same
  link is equally writable, the deny-under-`R` profile leaves symbolic aliases
  open as well, and a survivor can reach `R` by name with no hard link at all.

  The mode lock goes away because it covers nothing the profile does not: a
  chmod is itself `file-write*` and denied under `R`, so the sandboxed child
  cannot lock or unlock anything there; `lockTree` throws on the very links this
  task must tolerate; and it costs a full-tree chmod and restore per round. The
  case it did cover — a producer spawned unconfined — is covered instead by
  refusing the round when the profile cannot be applied. Removing it also
  retires the four scope-shaped pre-checks and `producerWriteScopeSandboxProfile`
  rather than leaving unreachable security code that a later reader would
  mistake for a live protection. The blast radius is mechanical and named in
  Scope: three adapters, `transition.ts`, and four test files.

- **D3 — copy, capture, and merge live in the runtime; the adapters supply only
  the spawn.** `prepareProducerWorkspace` / `captureProducerMerge` /
  `resolveMergeDestinations` / `applyProducerMerge` go in `src/core/workspace.ts`
  and are called from `runGuardedRound`. This follows the precedent the reviewer
  isolation set — `prepareReviewWorkspace` is runtime code four adapters inject
  as a seam — and avoids three drifting copies of the trust boundary.

  The adapter change is mechanical and identical in all three: substitute
  `input.workspace_root` for `input.repo_root` in the workspace-root argv slot
  and in `cwd`, keep `repo_root` only to build the profile, and declare
  `isolated_producer_workspace: true`. The runtime refuses to start a producer
  whose capabilities do not declare it, so an adapter that cannot be pointed at
  a workspace root stops rather than silently running on the live tree.

- **D4 — the copy's content set is larger than its merge-back set, and every
  path falls in exactly one of three classes.** Copy in: (a) the admitted write
  scope, writable, merged back; (b) a support set, today exactly
  `node_modules/`, never merged back; (c) nothing else.

  Classification never sees a structural directory entry: D5's pre-classification
  filter removes those from the change list first, so the three classes below
  still have exactly three outcomes and no fourth class exists.

  *Classification is by ordered, exact prefix match, no globs.* A copy path is
  **scratch** when it equals or is under one of two constant prefixes — `dist/`
  and `node_modules/.cache/` — matched with the same prefix semantics
  `isPathAdmittedByScope` uses (`src/policy/agents-policy.ts:734`), never by
  pattern. Scratch is tested **first**, so `node_modules/.cache/x` is scratch
  and every other `node_modules/` path is support. Otherwise the path is
  admitted when `isPathAdmittedByScope` accepts it, and refused when neither.
  No fourth class and no wildcard exist. An earlier draft listed
  `*.tsbuildinfo`; it is removed — `tsconfig.json` sets no `incremental` and no
  `tsBuildInfoFile`, so `tsc` writes none.

  *Support-set modes follow the same order.* The support set is materialised
  read-only (`0o555` / `0o444`) **except** the scratch prefix inside it:
  `node_modules/.cache/` is created writable so a tool that caches there does
  not fail. Everything else under `node_modules/` is read-only at the OS level
  and, if a write somehow lands there, refuses the merge. `dist/` is not copied
  at all; the producer creates it and it is discarded.

  Scratch exists because the producer may run `npm run build`, whose output
  lands at `dist/` (`tsconfig.json:7`), a path neither admitted (`AGENTS.md:66`)
  nor present in the copy; without the scratch class every round that builds
  would refuse. Discarding is safe where refusing is not: a scratch path is
  never copied to the live tree and the whole copy is removed.

  Without (b) the producer cannot run `npm run typecheck`, `npm run build`, or
  `npm test` inside the copy, and its declaration would assert checks it had no
  way to run. Rejected alternatives: symlinking `node_modules` into the copy
  (reintroduces exactly the alias class this task removes); having the Bridge
  run the checks after the merge (changes the declaration contract `AGENTS.md`
  and D-064 define).

  **Support-set symlinks are reconstructed, not omitted.** `npm run typecheck`
  and `npm run build` resolve `tsc` through `node_modules/.bin`, so a support
  set with no links makes them unrunnable. This checkout has six links under
  `node_modules`, all relative: `.bin/tsc -> ../typescript/bin/tsc`,
  `.bin/tsserver`, `.bin/tsx -> ../tsx/dist/cli.mjs`, `.bin/esbuild`,
  `.bin/yaml`, and `.bin/spartan-bridge -> ../../dist/cli/main.js`.

  The boundary is the **support set root**, `node_modules/` — not the copy
  root. A support-set symlink is recreated only when its target is relative
  **and** the target, resolved lexically against the link's own directory,
  stays under `node_modules/`; anything else — an absolute target, or a
  relative target that leaves `node_modules/` — is omitted, leaving the path
  absent. The copy root is the wrong boundary: `.bin/spartan-bridge ->
  ../../dist/cli/main.js` resolves to `<copyRoot>/dist/cli/main.js`, which is
  inside the copy root and would therefore be recreated by a copy-root rule —
  as a link into `dist/`, a scratch prefix D4 does not copy, so it would dangle
  at prepare time and point into a tree the producer builds and the merge
  discards. Under the `node_modules/` rule the first five links are recreated
  and `.bin/spartan-bridge` is omitted; it is used by no `package.json` script
  (`:17-20`). Recreation writes the link with the
  live-tree link's `readlink` **text**; it never resolves or follows that
  target. Support-set links are in the pre-spawn baseline, so an unchanged link
  is not a diff entry, and a producer that replaces one produces a diff entry
  under an unadmitted path, which refuses.

  The producer child receives one Bridge-owned, non-secret environment marker,
  `SPARTAN_BRIDGE_PRODUCER_ISOLATED=1`, after each adapter has built its normal
  allow-listed environment. Repository tests use that marker only to identify
  the intentionally reduced producer copy: checks whose subject is an omitted
  authority or package-wrapper file are explicitly skipped there, but a missing
  subject still fails in an ordinary checkout. The real prepared-copy integration
  test is also skipped under the marker so its inner `npm test` cannot recurse.
  A sandbox enforcement test may skip only when the marker is present or a
  separate known-good `sandbox-exec` probe proves that the enclosing sandbox
  cannot apply any nested profile; rejection of the generated profile alone is
  a failure.

- **D5 — the merge reads the workspace exactly once, into memory, and every
  later step works from that capture; destinations are resolved with
  `O_NOFOLLOW_ANY` and never from a held directory descriptor.**

  *Why there is no sealing step.* An earlier draft killed the producer process
  group and froze the copy read-only before reading it. That does not hold: a
  descendant can `setsid` out of the group before the direct child exits, and
  POSIX ownership lets a same-UID survivor chmod a frozen tree back. So the plan
  stops depending on the workspace being quiescent. `detached: true` and a
  best-effort group signal on cleanup remain as **hygiene** — no step of the
  merge depends on them, and no criterion asserts containment.

  *Structural directory entries are dropped before classification, not refused.*
  `snapshotTree` records a directory's `size` (`src/core/snapshot.ts:119-125`),
  and on APFS a directory's `st_size` moves when a child is created or removed —
  measured in this checkout, a directory went 96 -> 128 bytes on one added file
  and back to 96 on its removal. So **every** file creation or deletion inside
  the copy also emits a `changed` entry for its parent directory, and for each
  parent above it that gained or lost an entry. Two consequences the earlier
  draft left undefined:

  - Under an admitted directory line the parent entry is admitted (`src` matches
    the `src/` prefix rule by equality), reaches D5 as an existing-path
    `directory` entry, and had no apply classification at all.
  - Under the nested exact-file line the parent entry is **not** admitted (D1),
    so D4 would refuse it — which would make creating or deleting
    `agent-skill/skills/spbridge/SKILL.md`, an explicitly authorized change,
    refuse the whole merge.

  The rule is therefore a filter that runs **before** D4 classifies anything. An
  entry is dropped from the change list when all three hold: its `change` is
  `changed`; both `baseline` and `copyAfter` record it as `kind: "directory"`
  with the same `mode`; and its differing fields are a subset of `{size,
  mtimeNs}` (`src/core/contracts.ts:189`). A dropped entry contributes no
  captured source, no destination resolution, and no undo journal entry — the
  live tree is not touched at that path.

  Dropping is safe rather than lenient, and the reason is exact: a directory's
  `size` or `mtimeNs` is not content, and every actual change beneath it carries
  **its own** diff entry that classification still sees. A producer creating
  `agent-skill/skills/spbridge/NEW.md` still emits a `created` file entry at an
  unadmitted path, and the merge still refuses on that entry. Refusing the
  structural entry as well buys nothing and breaks the authorized case. Anything
  outside the subset — a directory whose `mode` or `kind` changed, a `created`
  or `vanished` directory — is **not** structural, is not dropped, and goes to
  classification and to the rules below.

  *Capture.* After `waitProducer` returns, `copyAfter` is taken, the structural
  filter above is applied, and the surviving `workspaceDiff(baseline,
  copyAfter)` entries are classified by D4: a scratch entry is discarded, a
  refused class refuses the whole merge. Each surviving entry is
  then opened **once** with `workspaceSafeOpenFlags` and fully captured from
  that descriptor: for a `file`, its bytes into a buffer plus mode, kind, and
  link count from `fstat` on the same descriptor; for a `directory`, kind and
  mode. A `vanished` entry has nothing left to open, so it captures no source —
  but it **carries the kind the pre-spawn baseline recorded for that path**,
  `file` or `directory`, and a baseline kind that is neither refuses the merge.
  That baseline kind is what lets destination validation tell a deleted file
  from a deleted directory; without it the resolver has no basis to choose a
  rule, which an earlier draft left undefined. The SHA-256 recorded is computed
  over the captured buffer, not over a second read. **Everything written to the
  live tree afterwards comes from that buffer.** The workspace is never read
  again, so a surviving descendant can rewrite `W` freely and change nothing
  about what merges — which is the property the seal was trying and failing to
  buy.

  *Capture caps.* Because the capture is resident, it gets its own bounds:
  `PRODUCER_MERGE_ENTRY_CAP` (2 000 entries) and `PRODUCER_MERGE_BYTE_CAP`
  (64 MiB, counting captured source bytes and captured undo bytes together). A
  change list exceeding either refuses before any write. The byte bound is also
  a peak-allocation bound: capture checks the `copyAfter` size before opening and
  then checks the descriptor's `fstat` size before `Buffer.alloc`; destination
  resolution likewise checks the opened live file's `fstat` size against the
  remaining combined budget before reading undo bytes. These are tighter than
  the snapshot caps on purpose; a plan or implementation round's diff is orders
  of magnitude smaller, and an overrun is a signal, not a workload.

  *Source validation.* Each surviving entry must satisfy all of: not
  `isAuthorityWritePath(path)` (`src/policy/agents-policy.ts:120`); not
  `producerPathDenied(path)` (`src/core/snapshot.ts:206`); `path` round-trips
  `validateRepositoryPath`; the captured kind is `file` or `directory`, or the
  change is `vanished` — a `symlink` or `other` kind refuses, as
  `producerDiffViolatesScope` (`src/core/transition.ts:869`) already does for
  the live tree; for a `file`, link count 1; and the caps hold. One failing
  entry refuses the whole merge.

  *Destination resolution uses `O_NOFOLLOW_ANY`, not held descriptors.* Darwin's
  `O_NOFOLLOW_ANY` (`src/core/workspace.ts:31`, already used by
  `workspaceSafeOpenFlags`) fails the open if **any** component of the path is a
  symlink, so the kernel performs the whole no-follow check atomically and the
  runtime needs no component-by-component descriptor walk. Every destination
  open, both in validation and in apply, is an absolute-path open with that
  flag. This is what makes the two descriptor findings moot: there are no
  long-lived directory descriptors to be missing at validation time or stale
  after a deletion.

  For each entry the runtime opens the live destination with `O_NOFOLLOW_ANY`
  and refuses if: the open fails because a component is a symlink; the final
  component exists with a kind the entry does not expect — anything but a
  regular file with link count 1 for a `file` entry, anything but a directory
  for a `directory` entry; the final component exists as a symlink, which is
  exactly the case D1 creates by omitting a live symlink from the copy; or a
  `vanished` entry's destination does not match its baseline kind — a `vanished
  file` requires a live regular file with link count 1 and refuses a symlink, a
  directory, or any other kind, while a `vanished directory` requires a live
  directory and refuses everything else, including a symlink to a directory,
  which `O_NOFOLLOW_ANY` rejects at the open. It also
  captures that destination's pre-merge state — absent, or a directory and its
  mode, or a regular file's bytes and mode read through that same descriptor —
  into the undo journal, under the same caps.

  *Planned topology, for destinations that do not exist yet.* A destination
  whose parent is absent is admissible only when every missing component is
  itself a `created` `directory` entry in this same validated change list.
  Validation builds that set explicitly: the missing components are enumerated,
  each must match a validated directory entry, each must pass
  `validateRepositoryPath` and the authority and denied-path checks, and no two
  entries may claim the same path. A missing component that is not in the set
  refuses the merge. Nothing is deferred to apply-order luck.

  At apply, a planned directory is created with `fs.mkdir` on the absolute path
  and its result **verified immediately** by opening it with
  `O_NOFOLLOW_ANY | O_DIRECTORY` and `fstat`; a failed open, an `EEXIST` from
  the `mkdir` (something already occupies the name), or a kind mismatch refuses
  and rolls back. Mode is the captured mode masked to `0o777`; setuid, setgid,
  and sticky are never carried. This verify-after-create is what stands in for a
  `mkdirat` this runtime does not have: an interposed symlink at any component
  makes the verify open fail.

  *Mode is carried only onto paths this merge creates; any other mode delta
  refuses.* A `created` file or directory is given the captured mode masked to
  `0o777`, with setuid, setgid, and sticky never carried. On a path that already
  exists in the copy's `baseline` the mode is **never** merged. Replacement and
  rollback preserve the destination's captured `mode & 0o7777`, including its
  pre-existing special bits; only producer-created paths use the narrower
  `0o777` mask. The mode-delta rule is stated on the delta rather than on the
  entry, because the earlier "mode-only" wording was trivially escapable: a
  producer that changed a file's bytes *and* its mode produced an entry that was
  no longer mode-only and had no defined outcome.

  The rule is now uniform. **A `changed` entry that survives the structural
  filter and whose differing fields include `mode` refuses the whole merge,
  whatever else also differs.** One condition, `mode` in the differing-field
  set, covers a mode-only file change, a mode-only directory change, and a
  combined content-and-mode change alike; a replacement that does not touch the
  mode merges normally and preserves the destination's own pre-merge mode. A
  `vanished` entry has no mode to compare and is unaffected. A structural
  directory entry can never reach this rule, since the filter admits only a
  `{size, mtimeNs}` subset with an unchanged `mode`.

  Refusing is the fail-closed reading and costs nothing a producer round needs:
  no admitted round has a reason to re-permission a live path, and a round that
  tries — alone or alongside a content edit — is worth stopping.

  *Apply order.* Directory creations ascending by depth; then file creations and
  replacements; then file deletions; then directory deletions descending by
  depth. A creation is `O_CREAT | O_EXCL` plus `O_NOFOLLOW_ANY` on the absolute
  path. A directory deletion refuses if the live directory is not empty once
  this merge's file deletions have been applied, because a non-empty live
  directory holds content the copy never saw.

  *Replacement writes a journal-owned temporary and renames it.* A replacement
  does not truncate the destination in place, because a process death mid-write
  would leave a half-written live file no in-memory journal can repair. It
  instead creates a sibling in the destination's already-validated parent at
  `.spartan-bridge-merge-<run_id>-<entry index>.tmp`, with
  `O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW_ANY`. `O_EXCL` plus the run id makes
  the name collision-safe; an `EEXIST` refuses the merge rather than reusing the
  name, and destination validation refuses up front if any
  `.spartan-bridge-merge-` name already exists in a destination parent.

  The temporary is **journaled the instant its create succeeds and before a
  single byte is written**, as an owned entry whose undo action is `unlink`.
  Captured bytes are written to it, its mode is set with `fchmod` to the
  destination's pre-merge mode from the undo capture, and only then is it
  `rename`d into place; the rename replaces the temporary's journal entry with
  the destination's own restore entry, so exactly one of the two is live in the
  journal at any moment. A failure anywhere in that sequence — create, write,
  `fchmod`, or `rename` — leaves the temporary's entry in the journal, and
  rollback unlinks every journaled temporary before restoring destinations, so
  no replacement can leave a new live-tree path behind. A temporary the rollback
  itself cannot unlink is named in the `runtime_state_violation`, like any other
  unrestored entry.

  Residual, named rather than papered over: a hard process kill between the
  create and the rename leaves one such temporary in an admitted directory with
  the destination untouched. The journal is in memory and cannot survive that.
  The name is recognisable, it is confined to an admitted path, and the next
  round's pre-spawn live-tree snapshot surfaces it as a change the producer did
  not make.

  *Rollback.* The undo journal holds paths and recorded pre-merge state, never
  descriptors, so nothing can go stale across a deletion. It is replayed in
  exactly the reverse of the apply order — `rmdir` undoing a created directory,
  `mkdir` with the recorded mode undoing a deleted one, captured bytes undoing a
  replacement — with every open re-acquired under `O_NOFOLLOW_ANY`. Nested
  deleted topology therefore restores correctly: recreating `a` and then `a/b`
  are two independent path opens, and neither reuses an identity from before the
  deletion. On any apply-time error the replay runs and the round stops with
  `write_scope_violation`. If the rollback itself fails the round stops with
  `runtime_state_violation` and names the entries it could not restore.

  *The residual this does not close.* A same-UID process unrelated to the Bridge
  can still mutate the live tree between guard release and apply, and can lose a
  race against `O_NOFOLLOW_ANY` only by winning it before the open. The writer
  lock (`src/core/transition.ts:461`) covers Bridge-internal concurrency; the
  same-UID residual is the one D-006 and `reviewer_write_detected` already
  accept, and this task neither widens nor closes it.

  *The producer's own survivors are a second, narrower case of the same thing,
  and this decision is why.* Because no step of the merge depends on the
  workspace being quiescent, a descendant that outlives `waitProducer` cannot
  change what merges — the capture is already resident. It can still write
  wherever the inherited profile allows: `W`, which is discarded; `HOME` and
  `TMPDIR`, which the Objective already excludes from the claim; and, through a
  hard link that pre-dated the round, an inode under `R`. Only the last reaches
  the repository, and after `productAfter` it is invisible to the snapshot pair.
  The Objective states that bound. Closing it would need exactly the containment
  this decision opens by demonstrating it cannot be had, so the plan records the
  residual instead of asserting a seal it already disproved.

  *Order inside `runGuardedRound`.* Build the profile -> `productBefore` /
  `runtimeBefore` -> prepare the copy and take `baseline` -> spawn on the copy
  and wait -> `copyAfter` -> `productAfter` / `runtimeAfter` -> the live-tree
  diff must be empty, since an isolated producer is not supposed to touch it at
  all -> classify, validate, and capture the copy diff -> resolve destinations
  and capture undo state -> release the guard -> apply -> read the task artifact
  and the producer declaration. The declaration read moves after the merge
  because the producer writes the task file into the copy (`spartan/` is
  admitted), and it reaches the live tree only through the merge.

## Acceptance Criteria

- [x] (D1) A producer round prepares a copy rooted outside `repoRoot` at a
      realpath'd `0o700` temporary directory containing exactly the admitted
      write scope plus the support set; a live symlink inside the admitted scope
      is absent from the copy and was never followed; a test covers both.
- [x] (D1) The copy is descriptor-backed: no code path passes a source path to
      `fs.copyFile` or `COPYFILE_FICLONE`. A test replaces an admitted source
      file with a symlink to an out-of-repo target between the directory read
      and the copy, and asserts the copy holds either the original inode's bytes
      or nothing — never the link target's bytes — and that a source open
      failing on a symlink records the member absent rather than retrying.
- [x] (D1) A source with link count above 1 is copied normally, not refused; a
      test copies a two-name inode and asserts the copy is an independent
      regular file with link count 1.
- [x] (D1) The candidate change list is `workspaceDiff` of the copy against its
      own pre-spawn baseline under `policy: "workspace"`; a test asserts a
      tail-only byte mutation inside the copy appears as a change.
- [x] (D2) `producerIsolatedSandboxProfile` emits, in order, `(allow default)`,
      one unqualified global `(deny file-write*)`, the `HOME` / `TMPDIR` / `W`
      allows, the `W` symlink-creation deny, and a final `(deny file-write*
      (subpath R))`; a unit test asserts that order, that no clause is
      `(require-not ...)`-shaped, that an unset `HOME` or `TMPDIR` omits its
      clause rather than failing, and that a quote or backslash in any root
      raises `confine_unavailable`.
- [x] (D2) Under the real `sandbox-exec` and this profile, a child denied by
      construction: a write to `R/src/x` fails, a write to `/tmp/x` fails, and a
      write through a pre-existing live `R/build/out -> /tmp/x` fails — while a
      write under `W` succeeds. The same test asserts the alias write **succeeds**
      under the pre-task write-scope profile, so the regression it closes is
      recorded rather than asserted in prose.
- [x] (D2) A round with a live `build/out -> /tmp/x`, a `node_modules/x -> /tmp`,
      and an untracked `build/leftover.txt` present reaches `producer_finished`;
      none of the three is present in the copy; an untracked file under `src/` is
      present in the copy. One test covers all four assertions, so the
      invariant's boundary is recorded rather than implied.
- [x] (D2) Under the real `sandbox-exec` and this profile, hard-link creation
      crossing `R` is denied in both directions: a `link` from a path under `R`
      to a new name under `HOME`, and a `link` from a path under `TMPDIR` to a
      new name under `R`, both fail, while a `link` between two paths under `W`
      succeeds; a test covers all three.
- [x] (D2) A pre-existing hard link from a writable root into `R` is **not**
      prevented and **is** detected outside every skipped subtree: a test
      creates a `TMPDIR` name for the same inode as a live non-admitted file at
      a path with no `SKIPPED_DIR_NAMES` component and under 1 MiB, has the
      producer write through it, and asserts the round refuses on the
      `productBefore`/`productAfter` comparison with no merge applied and the
      live mutation left in place — matching the recorded residual rather than
      an undo the plan does not claim.
- [x] (D2) The same detection reaches **inside** a skipped subtree: a test
      creates a `TMPDIR` name for the same inode as a live file under
      `node_modules/`, has the producer write through it, and asserts the
      `policy: "producer"` diff carries a single `changed` entry at the
      `node_modules` root with a differing `hash`, that `producerPathDenied`
      makes it a refusal, and that no merge is applied. A second case repeats it
      under `.venv/`. The test names the subtree explicitly, so it cannot pass
      on a non-skipped path.
- [x] (D2) The metadata-shaped limit of that detection is recorded, not
      asserted away: a test writes through a pre-existing hard link into a live
      `node_modules/` file while preserving its `size` and restoring its
      `mtimeNs`, and asserts the round is **not** refused — pinning the residual
      the Objective names so a later widening of `policy: "producer"` breaks a
      test instead of passing silently. The same test carries a comment naming
      the residual and D-072.
- [x] (D2) The **time** bound of that detection is pinned the same way: a test
      injects a live-tree mutation through a pre-existing cross-root hard link
      after `productAfter` is taken and before the merge applies — through a
      deps seam, not a real racing descendant, so the assertion is deterministic
      — and asserts the round is **not** refused and the merge still applies.
      The test carries a comment naming the delayed-write residual and D-072, so
      a later change that narrows the window breaks it rather than passing.
- [x] (D2) The inherited profile is what bounds that residual, and is asserted:
      under the real `sandbox-exec` and this profile, a grandchild the sandboxed
      child spawns after `setsid` still fails to write `R/src/x` and still
      succeeds under `W`; a test covers both, so the claim that a survivor
      reaches `R` only through a pre-existing hard link rests on a check rather
      than on prose.
- [x] (D2) An isolated producer round refuses before spawn, with
      `confine_unavailable`, when the platform is not Darwin or
      `/usr/bin/sandbox-exec` is absent; a test asserts no child is spawned.
- [x] (D2) No production path references `applyProducerWriteScope`,
      `producerWriteScopeSandboxProfile`, `lockTree`, or the four scope-shaped
      pre-checks after this task; `npm run typecheck` passing on a tree with
      those symbols deleted is the check.
- [x] (D3) The three real adapters spawn with `input.workspace_root` as `cwd`
      and in their workspace-root argv slot, and use `repo_root` only to build
      the profile; a test covers `cwd` and argv per adapter.
- [x] (D3) A producer adapter whose capabilities do not declare
      `isolated_producer_workspace` is refused before spawn; a test covers it.
- [x] (D4) Classification is exact and ordered: a test enumerates `dist/x`,
      `node_modules/.cache/x`, `node_modules/typescript/x`, `src/x`, and
      `build/x` and asserts scratch, scratch, support, admitted, refused — in
      that order of precedence — and asserts the scratch list holds exactly the
      two constant prefixes with no pattern matching.
- [x] (D4) `npm run typecheck`, `npm run build`, and `npm test` each run to
      completion inside the prepared copy, resolving `tsc` and `tsx` through
      reconstructed `node_modules/.bin` links; a test asserts the five
      links whose targets stay under `node_modules/` exist in the copy and that
      `.bin/spartan-bridge`, whose relative target leaves `node_modules/`, does
      not. The same test asserts the boundary is `node_modules/` and not the
      copy root, by showing a copy-root rule would have recreated
      `.bin/spartan-bridge` as a link into the uncopied `dist/`. The three real
      adapters set `SPARTAN_BRIDGE_PRODUCER_ISOLATED=1`; authority and package
      tests skip only on that marker, while an unexpected missing file in a live
      checkout fails, and generated-profile enforcement skips only on that
      marker or a failed known-good nested-sandbox probe.
- [x] (D4) A `dist/` tree built inside the copy is discarded and reaches no live
      path; `node_modules/.cache/` is writable in the copy and its contents are
      discarded; a write anywhere else under `node_modules/` refuses the merge;
      tests cover all three.
- [x] (D5) The merge writes only captured bytes: a test mutates a validated copy
      file after capture and asserts the live tree receives the captured bytes
      and never the substituted ones, with the workspace not re-read.
- [x] (D5) A change list exceeding `PRODUCER_MERGE_ENTRY_CAP` or
      `PRODUCER_MERGE_BYTE_CAP` — counting captured source and undo bytes
      together — refuses before any live-tree write **and before allocating or
      reading the over-budget file**; read seams prove neither source capture nor
      undo capture begins after the descriptor size exceeds the remaining
      budget. Tests cover both caps and both read sides.
- [x] (D5) Source validation is fail-closed: an unclassified path, a `symlink`
      or `other` kind, a hard-linked file, a `.git`-shaped path, an authority
      path, and a denied path each refuse the entire merge with
      `write_scope_violation`, leave the live tree byte-identical to its
      pre-spawn snapshot, and apply no other entry from the same round; a test
      covers each with the snapshot compared before and after.
- [x] (D5) Every live-tree destination open, in validation, apply, and rollback,
      uses `O_NOFOLLOW_ANY`; a destination that is a pre-existing live symlink,
      one with a symlink at an intermediate component, one that is a regular
      file with link count above 1, a `vanished file` whose destination is a
      symlink, a `vanished file` whose destination is a directory, and a
      `vanished directory` whose destination is a regular file each refuse the
      whole merge and write nothing; a test proves the symlink case cannot
      redirect merge output outside `repoRoot`, and a test asserts a `vanished`
      entry carries its baseline kind and that a baseline kind of neither `file`
      nor `directory` refuses.
- [x] (D5) Planned topology is validated before any write: a destination whose
      missing components are all `created` directory entries in the same list is
      admitted; one with a missing component absent from the list refuses; a
      duplicate claim on the same planned path refuses; a planned `mkdir` that
      returns `EEXIST` at apply refuses and rolls back; tests cover all four.
- [x] (D5) Mode is carried only onto created paths, and every existing-path mode
      delta refuses: a `created` file and a `created` directory take the captured
      mode masked to `0o777` with setuid, setgid, and sticky dropped; a
      replacement that does not change the mode leaves the destination's
      pre-merge `mode & 0o7777`, including existing special bits, unchanged;
      rollback restores that full captured mode for replaced files and deleted
      directories; and four entries each refuse the whole merge —
      a mode-only file change, a mode-only directory change, a file changed in
      **both** content and mode, and a directory changed in both `size` and
      `mode`. Tests cover all seven, and the combined content-and-mode case is
      named so the rule cannot regress to "mode-only".
- [x] (D5) Structural directory entries are dropped, not refused, and only in
      the stated subset: a test creates one file under `src/` and asserts the
      `workspaceDiff` carries a `changed` entry for `src` whose differing fields
      are within `{size, mtimeNs}`, that the entry is removed before D4
      classification, and that it produces no captured source, no destination
      resolution, and no undo entry. A second case deletes a file and asserts the
      same. A third case asserts the filter is bounded: a directory entry whose
      `mode` also differs, one whose `kind` differs, and a `created` and a
      `vanished` directory entry each survive the filter and reach the rules that
      refuse or merge them.
- [x] (D5, D1) The nested exact-file scope line round-trips in both directions:
      a test has the producer **delete** `agent-skill/skills/spbridge/SKILL.md`
      inside the copy and asserts the merge applies the live deletion while the
      unadmitted `changed` entries for `agent-skill/skills/spbridge`,
      `agent-skill/skills`, and `agent-skill` are dropped by the filter rather
      than refused by D4; a second test has the producer **create** that file
      after the same deletion in one round and asserts the same. A third asserts
      the ancestor chain is present in the copy's pre-spawn `baseline` with the
      live directory modes, so it never appears as a `created` entry, and that
      the parent's live sibling `agents/` is not copied. A fourth asserts a
      `created` file at `agent-skill/skills/spbridge/NEW.md` still refuses the
      whole merge, so dropping the structural entries removes no protection.
- [x] (D5) A replacement's temporary is journal-owned: a test injects a failure
      after the temporary is created and before the `rename` and asserts the
      live tree is byte-identical to its pre-merge state with **no**
      `.spartan-bridge-merge-` path left behind; a second test asserts a
      pre-existing `.spartan-bridge-merge-` name in a destination parent refuses
      the merge during destination validation.
- [x] (D5) Directory topology merges: a new admitted directory containing new
      files is created parent-first with its mode masked to `0o777`; a directory
      whose copy counterpart vanished and whose live counterpart is empty after
      this merge's file deletions is removed; a directory deletion whose live
      counterpart is not empty refuses; tests cover all three.
- [x] (D5) Rollback restores nested deleted topology: a merge that deletes
      `a/b` and then `a` and then fails mid-apply restores both directories with
      their recorded modes, stops at `write_scope_violation`, and reuses no
      identity captured before the deletion; an injected rollback failure stops
      at `runtime_state_violation` and names the unrestored entries; tests cover
      both.
- [x] (D5) A non-empty live-tree diff between `productBefore` and `productAfter`
      refuses the round; a test covers it.
- [x] (D5) `detached: true` is asserted on the producer spawn and cleanup
      signals the group, and no merge assertion in the suite depends on either;
      a test covers the spawn option only.
- [x] `docs/AUTHENTICATION-AND-SECURITY.md` records D-051 as closed for
      escalation and retained for `HOME`/`TMPDIR`, states that reads are not
      confined, records the pre-existing cross-root hard-link residual with
      **both** its bounds — metadata-shaped inside skipped subtrees and above
      1 MiB, and detected only inside the `productBefore`/`productAfter` window,
      with a surviving descendant able to write outside it — and replaces the
      "Cursor producer" sentence.
- [x] `docs/DECISIONS.md` carries one dated D-072 entry.
- [x] `npm run typecheck` and `npm run build` clean; `npm test` no new failure
      against the 541-test baseline.

## Work Completed

- 2026-09-05: implementation-review cycle 1 of the second chain returned
  APPROVED with no findings (`run-f7155054-a917-4935-abcb-3158ab452721`,
  `exec-619de6ac-af28-4bc4-8cbc-04593e90b28d`, host `claude`,
  `claude-opus-5`, effort `high`). An earlier dispatch of the same review
  (`run-9532f201-0f62-461e-8a98-b30bb810e6a7`) failed in `collect` with
  `adapter_error` / `provider_limit` (HTTP 429, provider session limit); it
  recorded no transition, wrote no artifact, and consumed no review cycle, so
  the round was redispatched unchanged once the provider window reopened. The
  human-operator round then closed the task: every acceptance criterion is
  marked satisfied on the strength of that verdict, adopted rather than
  independently re-derived, and the working tree was committed as one task
  boundary. Closing checks on the merged tree: `npm run typecheck` clean,
  `npm run build` clean, `npm test` 544 tests, 544 passed, 0 failed.
- 2026-09-05: implementation-review cycle 3 returned
  `ROLLBACK_TEMP_UNJOURNALED` and `INCOPY_EXEC_MAXBUFFER`; both were confirmed
  and corrected. A failed rollback-file restore now removes its owned
  `.rollback-<pid>` temporary, and a cleanup failure adds that temporary's path
  to the `runtime_state_violation` unrestored list. The regression test
  deterministically strips the rollback temporary's special mode after chmod,
  then proves the original path is reported and no rollback temporary remains.
  The real-copy check harness now gives each captured stream an explicit 16 MiB
  budget and gives the full suite 600 seconds while retaining the 240-second
  limits for typecheck and build. This correction ran in Codex; the exact
  session model identifier was not exposed.
- 2026-09-05: implementation-review cycle 2 returned CHANGES_REQUESTED with
  `PRODUCER_ENV_MARKER_UNDOCUMENTED`, `SETGID_LOST_ON_REPLACEMENT`, and
  `IN_COPY_SCOPE_HARDCODED`. All three were confirmed and corrected. The
  security guide now distinguishes each host's forwarded allowlist from the
  sole Bridge-originated producer key, and the Codex producer-spawn test pins
  the complete environment key set. File and directory mode restoration now
  reads the resulting mode back after `chmod` and refuses a mismatch; a
  deterministic seam simulates silent special-bit loss and proves that no
  replacement or merge temporary lands. The real-copy integration test now
  obtains its write scope by parsing this checkout's `AGENTS.md`, through the
  same policy parser that supplies `runGuardedRound`. This correction ran in
  Codex; the exact session model identifier was not exposed.
- 2026-09-05: implementation-review cycle 1 returned CHANGES_REQUESTED with
  `SANDBOX_TEST_VACUOUS_SKIP`, `AUTHORITY_TEST_VACUOUS_SKIP`,
  `IN_COPY_CHECKS_UNVERIFIED`, `MERGE_BYTE_CAP_AFTER_READ`, and
  `MERGE_DROPS_SPECIAL_MODE_BITS`. All five were confirmed and corrected. The
  three real producer adapters now inject a non-secret isolated-copy marker;
  tests for intentionally omitted authority/package files skip only on that
  marker, while sandbox enforcement uses the marker or a separate known-good
  nested-profile probe and reports an explicit skip. A live-checkout integration
  test prepares the real admitted scope, asserts all five contained `.bin` links
  plus the omitted escaping link, and runs typecheck, build, and the full suite
  inside that copy. Source and undo capture reject descriptor sizes over the
  remaining byte budget before read/allocation, and replacement/rollback retain
  existing `0o7777` modes while created paths remain masked to `0o777`.
- 2026-09-05: the first automatic implementer round left the 26-file partial
  implementation in the worktree and ended `producer_failure` / `exit_nonzero`
  (exit code 1) after about 40 minutes with no stdout persisted. The existing
  implementation was retained. Its single remaining defect was in the real
  sandbox test harness: only the first line of the grandchild's stderr was
  prefixed, so the bare `w:OK` proved the inherited sandbox allowed the
  grandchild to write under the isolated workspace but could never satisfy the
  assertion for `grandchild:w:OK`. This recovery round changed that one line to
  prefix every non-empty stderr line, then confirmed typecheck, build, and all
  543 tests pass. The recovery ran in Codex; the exact session model identifier
  was not exposed.
- 2026-09-05: plan-review cycle 2 of the third chain returned CHANGES_REQUESTED
  with `LATE_HARDLINK_MUTATION`. Confirmed, and it is the sharper form of the
  previous cycle's finding: the plan had bounded hard-link detection in *space*
  (which tiers read content) but not in *time*. `productBefore` / `productAfter`
  are two snapshots, while D5 deliberately buys no containment — a descendant can
  `setsid` out of the group, outlive `waitProducer`, and write through a
  pre-existing cross-root hard link after `productAfter`, undetected regardless
  of size or timestamp. No enforcing mechanism was added, because the mechanism
  that would be needed is the seal D5 already disproves. The claim was narrowed
  instead: the Objective now states both bounds, D2 records that detection is a
  window rather than a guarantee, and D5 explains that a survivor cannot change
  what merges and reaches `R` only through a link that pre-dated the round —
  because a Darwin sandbox is attached at exec, inherited, and irrevocable. Three
  criteria follow: one pinning the delayed write as *not* refused through a deps
  seam rather than a real race, one asserting the inherited profile stops a
  post-`setsid` grandchild from writing `R`, and the security doc recording both
  bounds.
- 2026-09-05: plan-review cycle 1 of the third chain returned CHANGES_REQUESTED
  with `EXACT_FILE_ANCESTORS` and `EXISTING_METADATA`. Both confirmed, and the
  first is broader than the finding stated. `snapshotTree` records a directory's
  `size` (`snapshot.ts:119-125`), and APFS moves a directory's `st_size` on a
  child create or delete — measured here, 96 -> 128 -> 96 bytes. So *every*
  file creation or deletion in the copy emits a `changed` parent-directory
  entry, admitted (`src`) or not (`agent-skill/skills/spbridge`, whose exact-file
  line matches only by full equality). D5 gained a pre-classification filter that
  **drops** a `changed` directory entry whose kind and mode are unchanged and
  whose differing fields are within `{size, mtimeNs}`, on the argument that a
  directory's size is not content and every real change beneath it carries its
  own entry — so refusing breaks the authorized case and protects nothing. D4
  records that classification never sees such an entry, keeping its three
  classes. D1 gained the mirrored ancestor chain for an exact-file line, plus the
  named limitation that a missing live ancestor is not created. For
  `EXISTING_METADATA`, the mode rule was restated on the **delta** rather than on
  the entry: any surviving `changed` entry whose differing fields include `mode`
  refuses, whatever else also differs, which closes the content-plus-mode escape
  the "mode-only" wording left open.
- 2026-09-05: plan-review cycle 3 of the second chain returned
  CHANGES_REQUESTED with `SKIPPED_HARD_LINK_MUTATION`. The premise was checked
  against this checkout and is half right, which changed both the claim and the
  criteria. `policy: "producer"` does **not** skip a `SKIPPED_DIR_NAMES` subtree
  the way `policy: "repository"` does (`snapshot.ts:95-103`): it folds the
  subtree into one root entry whose `hash` is a recursive metadata digest
  (`:159`, `:183`, `:218`), and any change there surfaces as a `changed` entry
  that `producerPathDenied` refuses. So a hard-link mutation into `node_modules/`
  or `.venv/` **is** detected, and the finding's stated hole does not exist as
  described. What the old wording did overstate is the shape of the comparison:
  it is metadata-only inside a skipped subtree and for any file above
  `SNAPSHOT_HASH_FILE_CAP` (`:136`), so a size-preserving, `mtimeNs`-restoring
  write is undetected. The Objective and D2 now state the three tiers and name
  that residual; the vague "a live non-admitted file" criterion was split into
  one outside the skipped subtrees, one explicitly inside `node_modules/` and
  `.venv/`, and one that pins the metadata-only residual so a later widening
  breaks a test.
- 2026-08-30: D-051 shipped the `.venv` unblock and documented the
  nested-skipped and live-tree residuals. This task closes them by isolation.
- 2026-09-05: plan-review cycle 2 of the second chain returned
  CHANGES_REQUESTED with `HARD_LINK_ESCAPE` and `VANISHED_DIRECTORY_CONFLICT`.
  Both confirmed. A hard link has no target for a path filter to resolve, so
  D2's claim was split: creation crossing `R` is denied by a restored
  `(deny file-link (subpath R))`, while a pre-existing cross-root link is
  detected by the whole-tree pre/post comparison rather than prevented, and the
  Objective now excludes it by name. A pre-spawn `nlink > 1` scan was rejected
  on evidence — `find . -xdev -type f -links +1` returns npm's two hard-linked
  esbuild binaries in this checkout, so such a scan would refuse every round
  here. The same finding retired D1's source `nlink == 1` requirement, which
  would have refused those same two files. `vanished` entries now carry the kind
  the pre-spawn baseline recorded, with separate file and directory destination
  rules, resolving the contradiction between the old blanket non-regular refusal
  and the directory-deletion design.
- 2026-09-05: plan-review cycle 1 of the second chain returned
  CHANGES_REQUESTED with `COPY_API_CONTRADICTION`, `SUPPORT_LINK_BOUNDARY`,
  `DIRECTORY_MODE_GAP`, and `TEMP_ROLLBACK_GAP`. All four confirmed; D2's
  allow-list profile was not challenged. D1 dropped `COPYFILE_FICLONE` for a
  descriptor-backed byte copy, since Node's clone API takes paths and would
  re-resolve a validated source. D4's support-link boundary moved from the copy
  root to `node_modules/`, which is what makes `.bin/spartan-bridge` omitted
  rather than recreated as a link dangling into the uncopied `dist/`. D5 gained
  an explicit mode rule — carried only onto created paths, a mode-only change
  refuses — and a full specification of the replacement temporary:
  collision-safe name, journaled before the first byte, unlinked by rollback,
  with the hard-kill residual named.
- 2026-09-05: plan-review cycle 3 of the first chain returned CHANGES_REQUESTED with
  `LIVE_ALIAS_REACHABLE`, `DESCENDANT_CONTAINMENT`, `CREATE_DESCRIPTOR_GAP`, and
  `ROLLBACK_DESCRIPTOR_GAP`, and the chain hit its cycle limit. All four
  confirmed, and two further facts verified directly:
  `producer-write-scope.ts:73` returns a global `(deny file-write*)` on an empty
  admitted list (asserted at `tests/producer-write-scope.test.ts:40`), not
  allow-all, so the previous D2 would have left the producer unable to write its
  own copy; and `lockTree` (`:281-286`) throws on the very symlinks the
  objective must tolerate. D2 was rewritten from a deny-under-`R` mode lock to
  an allow-list profile keyed on the copy, which closes the alias class
  structurally; the Objective was narrowed explicitly and the `HOME`/`TMPDIR`
  residual recorded. D5 dropped the seal entirely in favour of an in-memory
  capture, and replaced descriptor-relative resolution with `O_NOFOLLOW_ANY`
  absolute opens, which resolves both descriptor findings. Criteria re-derived
  from the revised decisions.
- 2026-09-05: plan-review cycle 2 returned `DIRECTORY_MERGE_GAP`,
  `SOURCE_TOCTOU`, `SCRATCH_POLICY_CONFLICT`, and `SCRATCH_VISIBILITY`. D5
  gained directory create/delete with ordering and undo; D4 gained ordered
  exact-prefix classification and the writable `node_modules/.cache/` exception;
  the `*.tsbuildinfo` glob was removed after confirming `tsconfig.json` sets no
  `incremental`.
- 2026-09-05: plan-review cycle 1 returned `MERGE_DEST_ALIAS`,
  `SUPPORT_SYMLINKS`, and `PARTIAL_APPLY`. `node_modules` holds six relative
  links, five inside the tree and `.bin/spartan-bridge -> ../../dist/cli/main.js`
  escaping it. Destination resolution became part of validation, the support set
  reconstructs inside-root links, and the merge gained an undo journal.
- 2026-09-05: planner round re-verified every path, symbol, and line reference
  against this checkout after 0055, 0070, and 0072.

## Evidence

- `git diff --check` — passed after the implementation-review cycle-3
  corrections on 2026-09-05.
- `node --import tsx --test tests/producer-write-scope.test.ts` — 20 tests,
  19 passed, 1 explicitly skipped because the enclosing sandbox could not
  apply a known-good nested profile; the rollback-temporary regression and the
  real-copy check harness passed.
- `npm run typecheck` — passed (`tsc --noEmit`, exit 0) after the
  implementation-review cycle-3 corrections on 2026-09-05.
- `npm run build` — passed (`tsc` plus executable-bit postbuild, exit 0) after
  the implementation-review cycle-3 corrections on 2026-09-05.
- `npm test` — 544 tests, 541 passed, 3 skipped, 0 failed, cancelled, or todo;
  exit 0 after the implementation-review cycle-3 corrections on 2026-09-05.
- `npm run typecheck` — passed (`tsc --noEmit`, exit 0) after the
  implementation-review cycle-2 corrections on 2026-09-05.
- `npm run build` — passed (`tsc` plus executable-bit postbuild, exit 0) after
  the implementation-review cycle-2 corrections on 2026-09-05.
- `npm test` — full repository suite passed (exit 0) after the
  implementation-review cycle-2 corrections on 2026-09-05. The real sandbox
  enforcement case passed in the full run.
- `node --import tsx --test tests/producer-write-scope.test.ts
  tests/codex-adapter.test.ts` — 47 passed, 0 failed, and the real nested
  sandbox case was explicitly skipped because the enclosing sandbox could not
  apply a known-good profile.
- `tests/producer-write-scope.test.ts` — parses `AGENTS.md` with
  `parseAgentsPolicy` for the real-copy scope; the post-chmod seam removes the
  sticky bit from a replacement temporary and proves the merge refuses while
  preserving the original bytes, mode, and absence of merge temporaries.
- `tests/codex-adapter.test.ts` — the producer spawn environment is exactly the
  present Codex allowlist keys plus `SPARTAN_BRIDGE_PRODUCER_ISOLATED`.
- `npm run typecheck` — passed (`tsc --noEmit`, exit 0) after the implementation
  review corrections on 2026-09-05.
- `npm run build` — passed (`tsc` plus executable-bit postbuild, exit 0) after
  the implementation review corrections on 2026-09-05.
- `npm test` — passed all 544 tests with 0 failures, cancellations, skips, or
  todos on 2026-09-05. When a producer copy or enclosing sandbox cannot apply a
  nested Darwin profile, the affected cases now report an explicit skip gated by
  the producer marker or a failed known-good probe rather than passing through an
  unqualified early return.
- `tests/producer-write-scope.test.ts` — prepares this checkout into an isolated
  copy, verifies `esbuild`, `tsc`, `tsserver`, `tsx`, and `yaml` links, verifies
  the escaping `spartan-bridge` link is absent, and runs `npm run typecheck`,
  `npm run build`, and `npm test` there to completion. Read seams remain untouched
  for over-budget source and undo files; special modes survive replacement and
  rollback.
- `tests/producer-write-scope.test.ts` — the grandchild stderr forwarding now
  prefixes every non-empty line; the real `sandbox-exec` case observes both
  `grandchild:r:EPERM` and `grandchild:w:OK`.
- `npm run typecheck` — passed (`tsc --noEmit`, exit 0) on 2026-09-05.
- `npm run build` — passed (`tsc` plus the executable-bit postbuild, exit 0) on
  2026-09-05.
- `npm test` — passed 543 tests with 0 failures, cancellations, skips, or todos
  on 2026-09-05.
- `src/adapters/producer-write-scope.ts:57` `producerWriteScopeSandboxProfile`
  — `(allow default)` plus deny branches gated on `(subpath rootLiteral)`;
  `:73` the empty-scope global `(deny file-write*)`; `:111`
  `applyProducerWriteScope` and its four pre-checks at `:119-122`; `:143-150`
  the comment stating the post-resolution fall-through; `:270` `lockTree` and
  `:281-286` its symlink throw.
- `tests/producer-write-scope.test.ts:40` — asserts the empty-scope profile is
  exactly `"(version 1)\n(allow default)\n(deny file-write*)\n"`.
- `src/adapters/process.ts:19` `confinedSpawnTarget` — drops the profile off
  Darwin; `:71` the producer `spawn`, today not `detached`.
- `src/core/workspace.ts:31` `DARWIN_O_NOFOLLOW_ANY`, `:135`
  `workspaceSafeOpenFlags`, `:142` `validateRepositoryPath`, `:180`
  `prepareReviewWorkspace`, `:1155-1164` the existing realpath-then-open shape.
- `src/runtime/paths.ts:49` `createExclusiveRunDir` — refuses a run dir outside
  `repoRoot`; why the producer copy cannot live under `runDir`.
- `src/core/transition.ts:461` writer-lock acquisition, `:666` the
  `D3_RUNTIME_WRITE_BEFORE_GUARD_RELEASE` comment, `:673` `runGuardedRound`,
  `:681-691` the lock-before-snapshot rationale, `:692` the
  `lockProducerWriteScope` call, `:869` `producerDiffViolatesScope`.
- `src/adapters/cursor.ts:686`, `src/adapters/grok.ts:544`,
  `src/adapters/codex.ts:609`, `src/adapters/fake.ts:165` — the four
  `startProducer` bodies; `cursor.ts:75`, `codex.ts:68`, `grok.ts:76` — the
  three workspace-root argv slots; `codex.ts:639-647` the `cwd` and
  `sandboxProfile` spawn arguments.
- `src/core/snapshot.ts:7-9` `SNAPSHOT_ENTRY_CAP` / `SNAPSHOT_HASH_BYTE_CAP` /
  `SNAPSHOT_HASH_FILE_CAP` (1 MiB), `:20` `SKIPPED_DIR_NAMES` (seven names),
  `:206` `producerPathDenied`, `:312` `workspaceDiff`.
- `src/core/snapshot.ts:95-103` — the two policy branches: `repository` skips a
  `SKIPPED_DIR_NAMES` entry outright, `producer` calls
  `recordSkippedProducerEntry` instead; `:136` `hashFully` — content is hashed
  under `workspace` unconditionally and under `producer` only up to
  `SNAPSHOT_HASH_FILE_CAP`, otherwise `mtimeNs` stands in; `:159`
  `recordSkippedProducerEntry`; `:183` the skipped-directory `hash`; `:218`
  `metadataTreeDigest`; `:225-248` `collectMetadataRecords`, whose record is
  kind, path, mode, size, `mtimeNs`, and link target — no content.
- `src/core/contracts.ts:189` `SNAPSHOT_DIFF_FIELDS` — `kind`, `mode`, `size`,
  `hash`, `mtimeNs`, `linkTarget`; the fields `snapshotDiff` compares.
- `src/core/snapshot.ts:119-125` — a directory entry records `rel`, `kind`,
  `mode`, and `size`, and under `policy: "workspace"` no `mtimeNs`; the reason a
  child create or delete surfaces as a parent `changed` entry.
- Measured on this machine (APFS, `/System/Volumes/Data`): `stat -f %z` on a
  directory returned 96, then 128 after one added file, then 96 after removing
  it — directory `size` is child-count-sensitive, so the structural filter is
  required, not defensive.
- `src/policy/agents-policy.ts:734` `isPathAdmittedByScope` — a scope line
  without a trailing `/` matches only by full equality, so
  `agent-skill/skills/spbridge` is not admitted by the
  `agent-skill/skills/spbridge/SKILL.md` line; `AGENTS.md:72` that line.
- `agent-skill/skills/spbridge/` in this checkout holds `SKILL.md` and a sibling
  `agents/` directory; the ancestor chain exists, so D1's missing-ancestor
  limitation does not arise here.
- `src/core/transition.ts:708`, `:752` — `productBefore` / `productAfter`, both
  `policy: "producer"`; `:789-790` the diff and the
  `producerDiffViolatesScope` refusal.
- `src/core/contracts.ts:92` `ReasonCode`, `:420`
  `AdapterCapabilities.isolated_workspace`, `:432` `AdapterProducerInput`.
- `src/policy/agents-policy.ts:120` `isAuthorityWritePath`, `:734`
  `isPathAdmittedByScope`.
- `AGENTS.md:66` the automatic write scope, `:145` the ninth authoring rule.
- `docs/AUTHENTICATION-AND-SECURITY.md:635` — the residual paragraph and the
  "Cursor producer" sentence.
- `docs/DECISIONS.md:1294` D-071 — the current last decision number.
- Symbol references outside `producer-write-scope.ts`, counted for the removal
  blast radius: `codex.ts` 8, `cursor.ts` 8, `grok.ts` 9, `contracts.ts` 1,
  `transition.ts` 3, `tests/producer-write-scope.test.ts` 35,
  `tests/cursor-adapter.test.ts` 3, `tests/grok-adapter.test.ts` 1,
  `tests/transition.test.ts` 5.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-a9227097-d458-42c8-8576-773e162e16dd execution_id=exec-c82f7d40-4256-4f74-8895-46589067f6e4 review_kind=plan verdict=pass reason_code=review_passed host=codex launcher=codex-plan-reviewer-v1 model=gpt-5.6-sol effort=high model_observed=declared_unobserved policy_digest=sha256:c032b4cea31dd45976e0e4d6a6b689590f1f0a1a368378fd8a82e546eb9525a3 task_hash=sha256:f6a808fb39e5b9c2556c6c7ae070247a2a828049484d53afcbb494fb16113504 agents_hash=sha256:ccf9e4492d47f2f21094b8ba345a4de0bca024275d307956d1ffcf712131a220 timestamp=2026-09-05T12:11:12.354Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-f7155054-a917-4935-abcb-3158ab452721 execution_id=exec-619de6ac-af28-4bc4-8cbc-04593e90b28d review_kind=implementation verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-opus-5 effort=high model_observed=declared_unobserved policy_digest=sha256:e363264f72a848d870898b8d1d1abe453a4f1e519f622f4415d9531d867023f6 task_hash=sha256:7e68dc236b9140609a57780fbd702720d3a40966b1af10878eaa768f1a0d00d1 agents_hash=sha256:ccf9e4492d47f2f21094b8ba345a4de0bca024275d307956d1ffcf712131a220 timestamp=2026-09-05T22:31:50.103Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None. It changes the producer round for every adapter, so it is best sequenced
before further producer-adapter work.

## Next Action

None. The implementation review returned APPROVED with no findings and the
work is committed. Follow-up work identified by this task's chain is already
queued as separate artifacts: `0073` (a failed producer round records no
diagnostic) and `0074` (the plan target scan admits illustrative tokens).

## Next Handoff

No outstanding handoff. The proposed review was consumed.
