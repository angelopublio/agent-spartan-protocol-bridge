---
protocol: "1.0.0" # x-release-please-version
id: assemble-a-review-workspace-that-hides-nothing-and-leaks-nothing
created_at: 2026-08-20
status: completed
phase: complete
task_type: implementation
risk: high-impact
current_role: reviewer
next_role: none
updated_at: 2026-08-21
handoff_id: HX-016
next_handoff_id: none
---

# Assemble a review workspace that hides nothing and leaks nothing

## Objective

One module prepares the workspace an implementation reviewer is given: every repository file entry
admitted by the explicit implementation-review scope at that moment, and no repository file outside
it. It answers to direct tests, and task `0033` is its only caller.

## Context

This task is the assembly half of task `0033`, split out on 2026-08-20 after that plan took three
Bridge review cycles and stopped at the authorized limit with five open errors, every one of them on
the same decision. The other half — widening `REVIEW_KIND` to a value, the admission test at
`src/policy/task-frontmatter.ts:144`, kind-scoped review regions, the `AGENTS.md` grant, and the
transition map — stays in `0033` and waits on this module to be built.

The split is not a size judgement. It is what the cycle shape said: six findings, then six, then
five, and the last five are five distinct hostile cases in selecting and copying bytes. That surface
generates new cases under review rather than closing them, and each is a different review from a
transition map.

**What the reviewer is given is already decided and does not reopen here.** Task `0033` D1 settled a
copy over the two alternatives, and the argument survives: handing over the live repository fails on
reads rather than writes, because `--sandbox read-only` stops writing and nothing stops reading, and
the live repository contains `.git` metadata and other paths outside the declared scope;
the diff alone fails because a reviewer that cannot open an unchanged neighbouring file cannot judge
whether a change is right. A read-allowlist sandbox would retire every finding below and keep every
out-of-scope path unreadable, but the observed Codex interface is `--sandbox read-only` on a workspace path, which
blocks writes and does not restrict reads. Until a probed client flag actually allowlists reads, that
option is a sentence rather than a decision, and its existence is not a reason to keep assembly
unsolved.

**The five open errors this task exists to answer**, as the third cycle recorded them:

- `SNAPSHOT_EXCLUSION_MISMATCH` (error): D1 leaves snapshotTree unchanged even though it skips directories named node_modules and .spartan-bridge, while the inclusion predicate does not necessarily exclude them. An adopter may track a non-ignored path under either directory; it would be copied but omitted from the manifest and reviewer_workspace comparison, allowing undetected reviewer writes. Align the inclusion and snapshot predicates or define a workspace-specific snapshot policy, with coverage for tracked paths under both names.
- `FILTER_PROCESS_HELPER` (error): The hostile Git-configuration refusal covers filter.*.clean and filter.*.smudge but omits filter.*.process. Git can use a configured process filter for worktree conversion while producing a diff, allowing repository configuration to launch a command. Add filter.*.process to the refusal and acceptance coverage.
- `SYMLINK_ANCESTOR_ESCAPE` (error): Checking only whether each extant member is itself a regular file does not prevent an ancestor directory from being replaced by a symlink. A tracked path such as dir/file can then resolve outside the repository and copy external bytes; validation followed by opening also permits a replacement race. D1 must define a no-follow, race-resistant copy procedure covering every path component and derive tests for ancestor symlinks and replacement during preparation.
- `IGNORE_SOURCE_ESCAPE` (error): git check-ignore uses more than in-tree .gitignore files: repository-local .git/info/exclude and core.excludesFile or user-level excludes can also affect its result. This contradicts D1's claim that repository ignore files define the boundary, makes the included set depend on machine-local state, can hide tracked product content, and may read an externally named file. Explicitly constrain or validate every ignore source and test hostile .git/info/exclude and core.excludesFile cases.
- `UNSUPPORTED_PATHSPEC_INTERFACE` (error): D1 relies on --pathspec-from-file and --pathspec-file-nul for git diff and git diff --name-status, but those commands do not provide that pathspec-file interface. The proposed bounded restriction therefore cannot be implemented as written. Select a supported, ARG_MAX-safe mechanism for both outputs and add an acceptance case whose included set is large enough to exercise it.

**One of the five is not a copy problem, and treating it as one makes the review worse.**
`SNAPSHOT_EXCLUSION_MISMATCH` reports that `snapshotTree` always skips `node_modules` and
`.spartan-bridge` while the inclusion predicate need not. The tempting fix is to add those names to
the copy's deny list so the two predicates agree. That would make an adopter's tracked file under
either name invisible to the reviewer — hiding product to satisfy a detector. The direction is the
other one: a workspace-specific snapshot policy that hashes the prepared tree without the
repository's skip list, keeping the caps. `src/core/snapshot.ts` is therefore in this task's scope,
where `0033` had put it out of scope.

**A construction worth naming, so the plan is not "add flags to porcelain".** Materialize tracked
bytes from git plumbing — `ls-files`, `cat-file --batch`, no filters — and copy dirty or untracked
included files with descriptor-relative, no-follow opens rooted at the repository. Git then stops
being the thing that walks a human worktree or decides what is ignored, which answers
`IGNORE_SOURCE_ESCAPE` and `FILTER_PROCESS_HELPER` at the mechanism rather than by extending a
refusal list, and shrinks `SYMLINK_ANCESTOR_ESCAPE` to the dirty overlay. The planning round decides
whether to take it.

## Scope

- `src/core/workspace.ts`: new. The inclusion predicate and its two projections, the copy procedure,
  the git invocation policy, the patch and change-list production, and the manifest.
- `src/core/snapshot.ts`: a workspace snapshot policy that does not inherit the repository skip list.
- `src/runtime/store.ts`: `workspace-manifest.json` as a retained artifact.
- `src/core/contracts.ts`: only the types this module returns.
- Tests: direct tests of the module, including a hostile case for each of the five findings.
- `docs/DECISIONS.md`, `docs/AUTHENTICATION-AND-SECURITY.md`.

## Out of Scope

- Everything task `0033` keeps: the review kind, the frontmatter admission test, review regions, the
  grant sentence, the transition map, `PROTOCOL_VERSION`.
- **`src/adapters/codex.ts` and `src/adapters/cursor.ts`.** Neither is touched here. If both tasks
  edit an adapter, commit sequencing cannot separate them afterwards. This task ships a library with
  direct tests; `0033` is the only caller and does the wiring.
- Reopening what the reviewer is given. See Context.
- Submodules. A gitlink in the included set fails closed rather than being walked.
- The plan-review workspace, which stays exactly two files.

## Constraints

- The decoded `### Implementation review scope` entries from task `0033` are the sole file-admission
  allowlist. Tracking, staging, `.gitignore`, `.git/info/exclude`, and `core.excludesFile` must not
  narrow or widen what a reviewer sees.
- No repository configuration may cause a command to run. That includes helper keys no flag reaches.
- No repository file outside scope reaches the workspace, and no extant regular file inside scope is
  hidden from it. An unsafe in-scope entry refuses the whole preparation rather than being omitted.
- Fail closed: an unreadable repository, a non-regular member, a gitlink, an oversized patch, or a
  configuration the module refuses ends the run `reviewer_isolation_unavailable`.
- The module writes only its own workspace and the run directory. It never writes `.git`.

## Acceptance Criteria

- [x] **D1 — explicit scope allowlist and complete projections:** the module receives the decoded
      scope entries and a fixture proves that membership is the union of in-scope file entries from
      `HEAD`, the stage-zero index, and `git ls-files --others -z` with no exclude option. All seven
      D1 `(H, I, W)` rows from task `0033` have the specified baseline, current-diff, visible-tree,
      change-list, and manifest disposition. In-scope ignored/untracked `.env.local`, a tracked path
      below ignored `node_modules`, and a tracked path below `.spartan-bridge` are included; the same
      states outside scope are absent. Changing `.gitignore`, `.git/info/exclude`, or
      `core.excludesFile` changes no output. `.git` metadata is the only fixed subtraction, and
      credential-looking names receive no special treatment.
      A fixture with a populated untracked-cache extension plus `core.untrackedCache` and builtin
      fsmonitor enabled still enumerates every extant in-scope untracked/ignored member because the
      source child disables all three accelerators.
- [x] **D1 — closed path grammar and complete refusal:** byte fixtures for an absolute path,
      empty/`.`/`..` components, invalid or non-canonical UTF-8, a normalization collision, a
      backslash, and Darwin-equivalent `.GIT` components refuse before a source open or destination
      join. Any in-scope unmerged path with stages 1–3 and no stage zero, skip-worktree entry, or
      sparse-index entry refuses rather than being omitted or masquerading as an index removal.
      Any non-regular entry in `HEAD`, the index, or the current in-scope worktree refuses the whole
      preparation, including a deleted symlink, a deleted gitlink, and a symlink replaced by a
      regular worktree file. Product files named `diff.patch`, `changes.txt`, or descendants of
      those names remain valid because they live under `worktree/`, not at the generated-output root.
- [x] **D2 — non-converting source plumbing:** fixtures configure `filter.*.clean`,
      `filter.*.smudge`, `filter.*.process`, diff commands/textconv, fsmonitor, and a promisor remote;
      workspace bytes stay the raw committed/current bytes, no sentinel helper runs, and a missing
      object fails `reviewer_isolation_unavailable` without a lazy fetch. A hostile parent
      environment supplying `GIT_DIR`, `GIT_WORK_TREE`, `GIT_OBJECT_DIRECTORY`,
      `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_CONFIG_PARAMETERS`, and `GIT_CONFIG_COUNT` cannot
      redirect objects or inject configuration because none reaches either child profile. Any
      filesystem entry at the source common object store's `info/alternates` or
      `info/http-alternates` refuses without its content being read. Hostile repository/worktree
      `core.worktree` and `extensions.worktreeConfig` values cannot redirect an enumeration because
      every source child explicitly pins the canonical Git directory and Bridge worktree root; the
      fixture proves no outside name or byte enters rather than relying on an overridden config query.
- [x] **D3 — one safe worktree read:** every extant in-scope member, whether tracked, staged,
      ignored, or untracked, is opened once with the platform's whole-path no-follow primitive.
      Ordinary files copy successfully, while an initial ancestor symlink, an ancestor replaced with
      a symlink at the open seam, a final symlink, a changing open file, and an unavailable no-follow
      capability each fail `reviewer_isolation_unavailable` before outside bytes reach an output;
      hostile path components rejected by D1 cannot escape either canonical root. The safe open
      includes `O_NONBLOCK`; FIFO/device descriptors and a regular-file-to-FIFO swap refuse after
      `fstat` and before any content read, so a hostile member cannot hang preparation.
- [x] **D4 — synthetic whole-tree diff and relation-derived change list:** the baseline tree hashes
      admitted regular **H** bytes, while the current diff tree hashes only extant admitted members
      for which **I** is present; `diff.patch` compares exactly those two trees. `changes.txt` is
      rendered independently from the complete `(H,I,W)` relation. Together they exactly describe
      all seven D1 rows, including deletion, mode, binary, rename-as-two,
      and hostile-filename cases; ignored/untracked members appear in `worktree/` and `changes.txt`
      but not `diff.patch`, exactly as task `0033` requires. A fixture
      above normal `ARG_MAX` path-count pressure succeeds without per-path argv, and patch overflow
      refuses rather than truncates. The isolated object database is a sibling of, never a member
      of, the reviewer-visible root and is removed before its baseline snapshot; no Git object,
      index, or `.git` control path is visible to the reviewer or charged to snapshot caps. Product
      `worktree/diff.patch` and `worktree/changes.txt` coexist with the generated root files without
      collision, and a parent `GIT_OBJECT_DIRECTORY` receives no isolated-ODB write. Global and
      in-tree `.gitattributes` rules such as `-diff` do not suppress or reshape the patch: isolated
      diff children pin `core.attributesFile` to an empty file and `attr.tree` to an empty tree.
- [x] **D5 — workspace-specific snapshot:** every reviewer-visible regular file — product files,
      `diff.patch`, and `changes.txt` — has a SHA-256 manifest entry and participates in both
      reviewer-workspace snapshots. Tracked paths below `node_modules` and `.spartan-bridge` are in
      that exact set, mutations below either name or to either generated file are detected, and
      entry/total-byte cap overflow fails closed. A reviewer-visible file larger than 1 MiB is
      fully hashed, and a tail-only mutation is detected.
- [x] **D5 — repository snapshot compatibility:** default repository snapshots still skip
      `.git`, `node_modules`, and `.spartan-bridge`, retain the existing 1 MiB per-file prefix-hash
      shortcut, detect a mutation inside that hashed prefix, and do not report a tail-only mutation
      beyond it. The workspace policy is separately asserted to hash the same large file in full and
      detect the same tail-only mutation.
- [x] **D6 — bounded library integration:** direct module/store tests prove atomic manifest
      retention, `0444` files and `0555` directories after preparation, cleanup of the temporary
      reviewer-visible workspace and its separate object-database staging directory, stable public
      return types, and no change to either adapter or to task `0033`'s transition surface; the two
      maintained documents state the same boundary and named costs as D1-D5.
      Tests also prove the source repository's object store is unchanged on success and failure and
      that the public preparation input carries the resolved scope without importing policy parsing.
- [x] **Repository checks (check-only row):** `npm run typecheck` and `npm test` exit 0.

## Decisions

### D1 - The resolved implementation-review scope is the explicit file allowlist

Task `0033` owns policy parsing and passes this library the decoded scope entries. This module treats
them as data, revalidates the closed repository-relative path grammar defensively, and never imports
`AGENTS.md` parsing. An exact entry admits that file; a trailing-slash entry admits file descendants
of that directory; no near-neighbour prefix matches. `.git` metadata is excluded before scope
matching. Tracking, staging, and ignore state have no authority to alter membership, and no
credential-looking filename or directory is denied. An admitted `.env`, `.npmrc`, `.ssh/config`, or
other repository file is copied without inspection exactly as task `0033` and `AGENTS.md` require.

Three NUL-delimited Git plumbing views enumerate file entries without reading ignore sources:
`git ls-tree -r -z --full-tree HEAD` supplies **H**, `git ls-files --stage --sparse -t -z` supplies
**I**, and `git ls-files --others -z` with no exclude option supplies worktree files absent from the
index. Index members still present on disk supply the rest of **W**. The union, filtered by the
resolved scope, is the logical file-member set. The current visible projection is every extant
regular member, including ignored and untracked files. The current synthetic-diff projection is an
extant regular member only when **I** is present; this deliberately omits `(✗,✗,✓)` untracked files
and `(✓,✗,✓)` index removals from the current tree, reproducing task `0033`'s measured `git diff HEAD`
semantics. `changes.txt` is rendered from the full `(H,I,W)` relation rather than inferred from the
two synthetic trees.

Every `-z` path is parsed as bytes, then must decode as strict UTF-8 in NFC form and split into a
non-empty component sequence. Absolute paths, empty/`.`/`..` components, NUL, backslash, invalid
UTF-8, non-NFC spelling, and filesystem-equivalent collisions refuse the whole preparation before a
source open or destination join. A Unicode-default-casefold security key is computed for each
component only to prevent platform aliases of `.git` and collisions between two admitted paths; it
does not classify credentials or other content. The named portability cost is refusal of a repository
whose in-scope path cannot be represented safely and uniquely on the destination filesystem.

The HEAD and index views retain every mode before projection. Any in-scope symlink, gitlink, tree-like
sparse entry, unmerged stage, skip-worktree entry, or other non-regular mode in either view refuses
the whole preparation, even when that entry is absent from the current index or worktree. Therefore a
deleted symlink, a deleted gitlink, and a symlink replaced by a regular file cannot disappear between
projections. Any non-regular entry returned by the worktree-only view also refuses through D3. A
missing regular stage-zero worktree member with no skip-worktree flag is a real deletion.

Git ignore machinery is never a membership input: the module does not call `check-ignore`, passes no
exclude option to `ls-files --others`, and does not read `.gitignore`, `.git/info/exclude`, or
`core.excludesFile`. The generated root files `diff.patch` and `changes.txt` occupy a different
namespace from product paths beneath `worktree/`, so identically named product files are admitted
normally and cannot overwrite them.

### D2 - Adopt two closed non-converting Git child profiles

The plan adopts the construction from Context. `git ls-tree -r -z --full-tree HEAD` supplies the
baseline modes/OIDs, D1's stage view supplies index modes/OIDs, and its worktree-only view supplies
untracked and ignored names without excludes. One long-lived `git cat-file --batch` receives
baseline OIDs and returns raw blob bytes. It is never passed `--filters`, `--textconv`,
`--follow-symlinks`, or a `rev:path` expression. All current worktree bytes enter only through D3.
Missing Git, `HEAD`, an object, or a readable stage-zero index ends preparation as
`reviewer_isolation_unavailable`.

Every Git child receives a newly constructed base environment containing exactly copied `PATH`,
`HOME`, `TMPDIR`, `LANG`, `LC_ALL`, and `TERM` values that are present, plus fixed
`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`,
`GIT_ATTR_NOSYSTEM=1`, `GIT_OPTIONAL_LOCKS=0`, `GIT_NO_REPLACE_OBJECTS=1`, and
`GIT_NO_LAZY_FETCH=1`. No other parent key is copied: in particular `GIT_DIR`, `GIT_WORK_TREE`,
`GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_CONFIG_PARAMETERS`, the
`GIT_CONFIG_COUNT` family, `GIT_EXEC_PATH`, and `XDG_CONFIG_HOME` are absent.

Source-read children run with the canonical repository root as `cwd` and no object-routing argv;
the bootstrap resolves the per-worktree and common Git directories from the Bridge-supplied canonical
root while explicitly pinning `--work-tree=<canonical root>` and
`-c core.worktree=<canonical root>`. Every subsequent source child carries the explicit Git directory
and worktree argv plus the same `core.worktree` override. Repository/worktree `core.worktree` and
`extensions.worktreeConfig` values are therefore inert; the hostile fixture proves the source views
still enumerate only beneath the Bridge root and no outside name or byte enters. Both `ls-files` children also
get `-c feature.manyFiles=false`, `-c core.untrackedCache=false`, and
`-c core.fsmonitor=false`, so neither an existing untracked-cache index extension nor builtin
fsmonitor may omit a current member. Before the first object read, the module refuses if either
`objects/info/alternates` or `objects/info/http-alternates` exists as any filesystem entry. It checks
existence only and never reads either content. Thus neither a parent variable nor source object-store
metadata may redirect `cat-file` outside the repository's common object database.

D4's isolated-ODB children use the same scrubbed base environment, a non-source `cwd` in Bridge-owned
staging, an empty Bridge-owned `HOME`, and an explicit constant-position
`--git-dir=<canonical sibling ODB>` argv before the subcommand. Initialization names that same
destination and an empty Bridge-owned template. Diff children additionally pin
`core.attributesFile` to an empty Bridge-owned file and `attr.tree` to the already-created empty tree
OID; the fresh ODB has no `info/attributes`. No
`GIT_DIR`, `GIT_WORK_TREE`, `GIT_OBJECT_DIRECTORY`, or alternate reaches the child environment, so
the argv-selected sibling is the only object store these children can read or write.

These plumbing operations neither convert worktree content nor invoke diff, clean, smudge, process,
textconv, external-diff, hook, or fsmonitor commands. There is no open-ended hostile-key refusal
list: a repository may configure `filter.*.process`, but this module never selects an operation that
can call it. Raw worktree bytes may consequently differ from the canonical blob that a clean/smudge
or line-ending conversion would produce; showing the actual bytes is the intentional,
deterministic cost. A repository whose required object is reachable only through a parent-injected
object directory or any alternates metadata also refuses; machine-local object routing is not
allowed to change the reviewed bytes.

### D3 - Each current worktree member gets one kernel-enforced safe read

The source root is canonicalized once. Only a path that passed D1's closed byte grammar is joined to
that root or to the fresh Bridge-owned destination root; the implementation asserts the resulting
destination remains beneath that root before creating any component. Each validated current path is
opened once by a private safe reader whose kernel primitive rejects a symlink in any path component
during that same open and whose flags include `O_NONBLOCK`. The Darwin implementation uses
`O_NOFOLLOW_ANY | O_NONBLOCK` against the canonical
absolute root; D1 has already made absolute and `..` escapes unrepresentable. Another platform must
supply an equivalently proved `openat2`/descriptor-relative no-symlink capability or preparation
refuses. There is no `lstat`-then-ordinary-`open` fallback. The opened descriptor is `fstat`ed as a
regular file before any content read and again after the bounded read, and identity/size/timestamps
must remain stable. A FIFO, socket, device, or swap to one is closed immediately after the first
`fstat`; non-blocking open prevents the FIFO case from hanging. Bytes are written from that
descriptor rather than by reopening the source path.

Every extant member in D1's scope union uses that reader, regardless of tracking, staging, or ignore
state. An ancestor or final symlink, a swap to one at the test seam, a changing file, an unmerged
index, a gitlink, another non-regular member in any of the HEAD/index/worktree views, or an
unavailable safe-open capability refuses `reviewer_isolation_unavailable`. Thus regular files are
copied by a race-resistant mechanism; unsafe members and unsupported platforms are closed by
refusal. The platform refusal is a named portability cost, not permission to weaken the open.

### D4 - Diff two streamed synthetic trees, not a pathspec

Preparation creates two sibling temporary roots beneath the Bridge-owned run staging directory: the
reviewer-visible root and an isolated bare object database that is never below or linked into that
root. D2's isolated-ODB child profile initializes the database with empty system/global configuration
and an empty template, then pins every `hash-object`, `mktree`, and `diff-tree` child to it with the
explicit `--git-dir` argv while all inherited object-routing variables remain absent. Baseline and
current-diff bytes are streamed to `git hash-object -w --stdin --no-filters`: the baseline tree
contains admitted regular **H** entries, and the current tree contains exactly admitted regular
entries for which both **I** and **W** are present, using **W** bytes. Directory entries
are streamed bottom-up to `git mktree -z`. `git diff-tree -r -p --binary --no-renames --no-ext-diff
--no-textconv` produces reviewer-visible `diff.patch`. No second Git diff produces the change list:
the module renders reviewer-visible `changes.txt` deterministically
from D1's complete `(H,I,W)` relation, adding the untracked/ignored and index-removal states that the
two synthetic trees intentionally cannot express. The only diff argv paths are the two tree OIDs. Source-repository
configuration and object storage never enter or receive writes from this isolated database. D2's
empty `core.attributesFile` and empty-tree `attr.tree` make every diff attribute unspecified, so
neither machine-global attributes nor admitted `.gitattributes` content can suppress or reshape the
synthetic patch; `.gitattributes` itself remains ordinary reviewed product content.

This is supported by the installed Git and is independent of the included-set size, so
`--pathspec-from-file` disappears rather than being emulated with argv chunks. Renames remain a
deletion plus addition. Patch output has the inherited 1 MiB hard cap; overflow refuses rather than
truncates. After both outputs close successfully, the object database is deleted and its absence is
verified before D5 takes the baseline snapshot; a cleanup attempt also owns it on every failure path.
Generated files occupy the visible root while every product path occupies `worktree/`; that namespace
separation lets product files named `diff.patch` or `changes.txt`, and descendants under directories
with those names, coexist without overwrite or ambiguous manifest kinds.

### D5 - The workspace snapshot has no repository skip list

`snapshotTree` gains an explicit policy. Repository before/after snapshots keep their existing
`.git`, `node_modules`, and `.spartan-bridge` directory skips and existing behavior. Reviewer-
workspace snapshots pass the workspace policy: skip no directory names and SHA-256 every regular
file. They retain the 20,000-entry and 256 MiB total-hash caps; the repository-only 1 MiB per-file
hash shortcut does not apply to the prepared workspace. A cap failure remains `SnapshotCapError`
and maps to `reviewer_isolation_unavailable`. Full hashing includes every byte of a file larger than
1 MiB, so a tail-only mutation changes the reviewer-workspace comparison.

The baseline is taken only after the object database is gone and the visible root contains exactly
the admitted product tree, `diff.patch`, and `changes.txt`. The retained manifest serializes that
already-computed snapshot set: base commit, patch byte length, and every visible entry's relative
path, kind (`product`, `patch`, or `change-list`), Git mode when applicable, size, and SHA-256.
Therefore the reviewer-visible tree, manifest entries, and pre/post reviewer comparison have exactly
the same regular-file domain, including product paths below `node_modules` and `.spartan-bridge`;
the object database belongs to none of the three.

### D6 - Ship a bounded library and retained proof, not adapter wiring

`src/core/workspace.ts` owns preparation and returns only typed workspace paths, the baseline
snapshot, and manifest data. `src/runtime/store.ts` writes `workspace-manifest.json` atomically in
the run directory; files become `0444` and directories `0555` only after every output and baseline
snapshot are complete. Cleanup separately removes the reviewer-visible root and the sibling object-
database staging root but retains the manifest; successful preparation has already removed the
database before returning. Direct deterministic tests cover the module and store. This task does not
edit either adapter or wire the module into review dispatch; task `0033`, its sole caller, keeps that
transition. `docs/DECISIONS.md` and `docs/AUTHENTICATION-AND-SECURITY.md` record D1-D5 and their
named costs. The tests snapshot the source common object directory before and after both successful
and failed preparation and prove the isolated profile never writes it, including when the parent
supplies a hostile `GIT_OBJECT_DIRECTORY`. Snapshot tests exercise both explicit policies: the
reviewer-workspace policy's full-domain/full-hash behavior and the unchanged repository policy's
three directory skips and 1 MiB prefix shortcut.

### Finding closure

| Finding | Closing decision | Closure |
| --- | --- | --- |
| `SNAPSHOT_EXCLUSION_MISMATCH` | D5 | Mechanism: the workspace policy skips no admitted directory and hashes every copied file. |
| `FILTER_PROCESS_HELPER` | D2 | Mechanism: no selected Git operation invokes filters or repository-configured commands. |
| `SYMLINK_ANCESTOR_ESCAPE` | D3 | Mechanism for regular reads; refusal for symlinks, races detected at the seam, and unsupported safe-open capability. |
| `IGNORE_SOURCE_ESCAPE` | D1 | Mechanism: decoded scope is the allowlist and the three enumerations use no ignore/exclude source, so ignored and untracked in-scope files remain visible. |
| `UNSUPPORTED_PATHSPEC_INTERFACE` | D4 | Mechanism: streamed synthetic whole-tree comparison has no per-path diff arguments. |
| `PATH_COMPONENT_ESCAPE` | D1, D3 | Refusal grammar makes source and destination escapes and filesystem-equivalent control names unrepresentable before either root is joined. |
| `WORKSPACE_ODB_VISIBLE` | D4-D6 | Mechanism: the sibling object database is absent before the visible root is snapshotted; the visible tree, manifest, and comparison use one exact file domain. |
| `SPARSE_HIDES_TRACKED` | D1 | Refusal: skip-worktree and sparse-index entries end preparation rather than appearing as deletions. |
| `GIT_OBJECT_ENV` | D2 | Mechanism: Git children receive a closed constructed environment, so parent object and configuration variables cannot reach them. |
| `ISOLATED_GIT_CHILD_ENV` | D2, D4, D6 | Mechanism: a separate scrubbed child profile pins the sibling ODB by argv and tests prove the source object store receives no writes. |
| `GENERATED_PATH_COLLISION` | D1, D4, D5 | Mechanism: product paths are rooted under `worktree/`, while generated files are siblings at the visible root, so equal product basenames do not collide. |
| `REPO_OBJECT_ALTERNATES` | D2 | Refusal: any alternates metadata entry in the source common object store rejects preparation without reading its content. |
| `WORKSPACE_HASH_SHORTCUT` | D5 | Mechanism: workspace policy fully hashes files above 1 MiB and a tail-only mutation must be detected. |
| `NONREGULAR_HEAD_OMISSION` | D1, D3, D4 | Refusal: every HEAD/index/worktree mode is retained through validation, and any in-scope non-regular entry refuses before projections can hide it. |
| `ENV_COMPONENT_DENY` | D1 | Superseded by the settled scope contract: `.env`-shaped components receive no filename-based denial; an admitted path is copied without inspection. |
| `REPO_SNAPSHOT_CRITERION` | D5, D6 | Mechanism: separate criteria pin the unchanged repository policy and the full-hash workspace policy. |
| `WORKTREE_CONFIG_REDIRECT` | D2 | Mechanism: every source child pins canonical Git/worktree paths, so hostile redirect declarations cannot change an enumeration or admit outside bytes. |
| `UNTRACKED_CACHE_HIDES` | D1, D2 | Mechanism: both `ls-files` views disable many-files defaults, untracked cache, and fsmonitor before enumerating names. |
| `NONREGULAR_BLOCKING_OPEN` | D3 | Mechanism and refusal: the no-follow open is non-blocking, and descriptor kind is rejected before the first byte read. |
| `ATTR_SOURCE_UNPINNED` | D2, D4 | Mechanism: isolated diff children use an empty global-attribute file and empty attribute tree. |
| `D4_PROJECTION_MISWIRE` | D1, D4 | Mechanism: the synthetic trees implement the H baseline and I∩W current projection, while `changes.txt` is derived from the full relation. |
| `WORKTREE_REFUSE_ORDER` | D2 | Superseded by a mechanism-only decision: explicit argv/config pins override redirects, and the fixture proves containment without an impossible post-override presence query. |
| `UNMERGED_STAGE_OMISSION` | D1 | Refusal: any in-scope non-zero index stage ends the whole preparation before the H/I/W relation is formed. |

## Work Completed

- Implementation reviewer completion (Codex, gpt-5.6-terra, effort high, OpenAI), 2026-08-21:
  accepted `HX-016` in a fresh read-only sandbox and returned `PASS`. It verified the leading-BOM
  decoder behavior, Git UTF-8 byte ordering, the affected fixtures, all previous closures, and the
  absence of adapter and task `0033` changes. Task `0034` is complete.
- Implementer (Cursor, cursor-grok-4.6-high-fast, effort none), 2026-08-21:
  accepted `HX-015` and corrected only the two remaining Codex implementation findings.
  Git path decoding now uses a strict UTF-8 decoder that preserves a leading U+FEFF,
  and synthetic-tree sibling names are ordered with `Buffer.compare` on UTF-8 bytes.
  Exact-scope BOM coverage and a U+E000/U+10000 sibling-tree fixture were added.
  Adapters and task `0033` were not edited. D1-D6 were not rewritten.
- Implementation reviewer continuation (Codex, gpt-5.6-terra, effort high, OpenAI), 2026-08-21:
  accepted `HX-014` in a fresh read-only sandbox and returned `CHANGES_REQUESTED` for two remaining
  UTF-8 edge cases: `UTF8_BOM_PATH_ALIAS` and `UTF8_TREE_ORDER_MISMATCH`. The prior three findings
  are closed, and no adapter or task `0033` change was present.
- Implementer (Cursor, cursor-grok-4.6-high-fast, effort none), 2026-08-21:
  accepted `HX-013` and corrected only the three Codex implementation findings.
  Security keys now use Unicode default case folding (CaseFolding.txt C+F) instead of
  locale lowercasing, with a `ß`/`ss` collision that `toLocaleLowerCase("en-US")` misses;
  `changes.txt` JSON-encodes every path so tab and newline names stay one record; and
  the D4 fixture's concatenated included-path bytes exceed `getconf ARG_MAX` while
  `diff-tree` argv remains two tree OIDs. Adapters and task `0033` were not edited.
  D1-D6 were not rewritten.
- Implementation reviewer continuation (Codex, gpt-5.6-terra, effort high, OpenAI), 2026-08-21:
  accepted `HX-012` in a fresh read-only sandbox. The three `HX-010` errors are corrected, but the
  complete D1-D6 pass returned `CHANGES_REQUESTED` for `UNICODE_CASEFOLD_COLLISION` and
  `CHANGE_LIST_CONTROL_CHARACTER_AMBIGUITY`, plus warning `D4_ARGMAX_ACCEPTANCE_UNCOVERED`.
  Product files and the task artifact remained read-only during the reviewer session.
- Implementer (Cursor, cursor-grok-4.6-high-fast, effort none), 2026-08-21:
  accepted `HX-011` and corrected only the three Codex implementation findings. The returned
  baseline is now snapshotted after the `0444`/`0555` freeze; cleanup chmods directories through
  Darwin `O_NOFOLLOW_ANY` descriptors so a planted symlink is not traversed; and tests inject
  ancestor replacement, a changing file, and a regular-file-to-FIFO swap at private safe-reader
  seams. Adapters and task `0033` were not edited. D1-D6 were not rewritten.
- Implementation reviewer (Codex, gpt-5.6-terra, effort high, OpenAI), 2026-08-21: accepted
  `HX-010` in a fresh read-only sandbox and returned `CHANGES_REQUESTED`. Three implementation
  errors remain: `WORKSPACE_BASELINE_MODE_MISMATCH`, because the baseline precedes the final mode
  freeze; `CLEANUP_SYMLINK_RACE_ESCAPE`, because cleanup performs a pathname-based recursive chmod;
  and `D3_RACE_ACCEPTANCE_UNCOVERED`, because the claimed open-seam fixtures install hostile paths
  before preparation instead of replacing them at deterministic safe-reader seams. Product files
  and the task artifact were read-only during the reviewer session.
- Implementer (Cursor, cursor-grok-4.6-high-fast, effort high), 2026-08-21: continued from the recorded Bridge plan pass with `next_role: implementer`. The pasted prompt carried no handoff identifier; this round accepted the artifact envelope `HX-009` and did not treat the stale reviewer text under Next Handoff as the prompt. Implemented D1-D6 in `src/core/workspace.ts`, added an explicit `snapshotTree` policy in `src/core/snapshot.ts`, retained `workspace-manifest.json` from `src/runtime/store.ts`, added the public manifest types in `src/core/contracts.ts`, and recorded D1-D5 in `docs/DECISIONS.md` and `docs/AUTHENTICATION-AND-SECURITY.md`. Adapters and task `0033` were not edited.
- Planner continuation (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-21: accepted `HX-008`
  after Bridge run `run-2a2b52a3-ab5b-4d05-ab17-63e607a72acd`, cycle 3 of 3. The sole residual
  finding was a criterion omission, not a decision change: D1 already refused every non-zero index
  stage, and its closed-refusal criterion now explicitly exercises an ordinary regular-file merge
  conflict with stages 1–3 and no stage zero. No product file was edited.
- Planner continuation (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-21: accepted `HX-007`
  after Bridge run `run-45a9a25f-ad12-4f63-9f4b-67475c3a9bf5`, cycle 2 of 3. Re-derived D2/D4 so
  the synthetic trees implement D1's H and I∩W projections, `changes.txt` is rendered from the full
  relation, and hostile worktree configuration is neutralized and tested as a pinned mechanism
  rather than queried after its value was overridden. No product file was edited.
- Planner continuation (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-21: accepted `HX-006`
  after Bridge run `run-3220bc22-ee01-4e4b-bf91-854f1e4ad04d`, cycle 1 of 3. Re-derived D1-D4
  for its four findings: source children now pin and validate the canonical worktree, enumeration
  disables untracked cache and fsmonitor, safe opens are non-blocking and validate kind before
  reading, and isolated diffs use empty attribute sources. No product file was edited.
- Planner (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-21: accepted `HX-005` after the
  previous review chain reached cycle 3. Reconciled D1-D6 with task `0033`'s now-approved explicit
  scope contract: scope, not tracking or ignore state, controls membership; non-regular entries in
  every source view refuse; credential-shaped components are not classified; product/generated
  name collisions are prevented by `worktree/` namespace separation; and repository snapshot
  compatibility has its own criterion. No product file was edited.
- Planner (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-21: accepted `HX-004` after Bridge
  cycle 2 and re-derived D1-D6 for its four findings: generated-name collisions now refuse (D1),
  source and isolated Git children have separate closed profiles and source alternates refuse (D2,
  D4, D6), and the workspace hash criterion exercises a >1 MiB tail mutation (D5). No product file
  was edited.
- Planner (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-21: accepted `HX-003` after Bridge
  cycle 1, revised every decision and criterion touched by its four validated findings, and closed
  them with a byte-level path grammar plus sparse refusal (D1/D3), a constructed Git environment
  (D2), and sibling object-database staging removed before one exact-domain snapshot and manifest
  (D4-D6). No product file was edited.
- Planner (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-21: continued under the
  artifact's outstanding `HX-002` envelope because the pasted producer prompt carried no handoff
  identifier; audited D1-D6 and their criteria as a set, found no internal inconsistency requiring a
  decision change, recorded the failed unvalidated Bridge run without adopting its retained payload
  as findings, and refreshed the reviewer envelope. No product file was edited.
- Planner (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-21: accepted handoff `HX-001`,
  replaced the inherited draft with D1-D6, adopted the plumbing construction with an explicit
  tracked-only allowlist, mapped all five findings to a mechanism/refusal, and regenerated every
  criterion from its named decision. No product file was edited.
- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20: created this task by
  splitting the assembly half out of task `0033`, after a second opinion taken from a Cursor session
  with the repository open, because the Bridge's own reviewer sees only the artifact and `AGENTS.md`
  and cannot judge whether one plan should become two. That opinion agreed on the split, and
  corrected two of the planner's supporting claims: that `0033` D2 through D8 had been approved by
  three cycles, when cycle 3 simply never reached them, and that `SNAPSHOT_EXCLUSION_MISMATCH` was a
  copy-hardening problem. Both corrections are recorded above. No product file was edited.

## Evidence

- Completion checks, 2026-08-21: `git diff --check` exited 0, `npm run typecheck` exited 0, and
  `npm test` exited 0 with 226 tests passed and 0 failed. A fresh Codex `gpt-5.6-terra` read-only
  review of `HX-016` returned `VERDICT: PASS`; its focused typecheck exited 0 and its diff check
  confirmed no adapter or task `0033` modification.
- HX-015 correction checks, 2026-08-21: `git diff --check` exited 0, `npm run typecheck`
  exited 0, and `npm test` exited 0 with 226 tests passed and 0 failed (2 new tests:
  exact-scope leading U+FEFF path that does not alias to the BOM-less neighbour, and
  U+E000/U+10000 siblings whose `mktree` stdin is Git UTF-8 byte order rather than
  JavaScript UTF-16 order). `git status --short` showed no adapter or `0033` edits.
- Fresh HX-014 implementation review, 2026-08-21: Codex `gpt-5.6-terra` returned
  `CHANGES_REQUESTED` with `UTF8_BOM_PATH_ALIAS` at `src/core/workspace.ts:32,130-137`, because the
  default `TextDecoder` strips a leading U+FEFF, and `UTF8_TREE_ORDER_MISMATCH` at
  `src/core/workspace.ts:855-866`, because JavaScript UTF-16 order can differ from Git's UTF-8 byte
  order. The read-only typecheck exited 0.
- HX-013 correction checks, 2026-08-21: `git diff --check` exited 0, `npm run typecheck`
  exited 0, and `npm test` exited 0 with 224 tests passed and 0 failed (3 new tests:
  Unicode default casefold `ß`/`ss` collision, tab and newline `changes.txt` round-trip,
  and an included set whose concatenated path bytes exceed ARG_MAX 1048576 without
  per-path diff argv; that last fixture took 63581ms). `git status --short` showed no
  adapter or `0033` edits.
- Fresh implementation re-review, 2026-08-21: Codex `gpt-5.6-terra` returned
  `CHANGES_REQUESTED` with errors `UNICODE_CASEFOLD_COLLISION` at `src/core/workspace.ts:308` and
  `CHANGE_LIST_CONTROL_CHARACTER_AMBIGUITY` at `src/core/workspace.ts:951`, plus warning
  `D4_ARGMAX_ACCEPTANCE_UNCOVERED` at `tests/workspace.test.ts:726`. The read-only typecheck exited
  0; the writable implementer session must add all three regression fixtures and rerun the suite.
- HX-011 correction checks, 2026-08-21: `git diff --check` exited 0, `npm run typecheck` exited 0,
  and `npm test` exited 0 with 221 tests passed and 0 failed (4 new tests: three D3 safe-reader
  seam fixtures and one D6 planted-symlink cleanup case; the D1 freeze assertion now requires the
  returned baseline to equal a post-freeze workspace snapshot with file mode `0444` and directory
  mode `0555`). `git status --short` showed no adapter or `0033` edits.
- Fresh implementation review, 2026-08-21: Codex `gpt-5.6-terra` returned
  `CHANGES_REQUESTED` with `WORKSPACE_BASELINE_MODE_MISMATCH` at `src/core/workspace.ts:233,242`,
  `CLEANUP_SYMLINK_RACE_ESCAPE` at `src/core/workspace.ts:1110-1134`, and
  `D3_RACE_ACCEPTANCE_UNCOVERED` at `tests/workspace.test.ts:549,582`. `npm run typecheck` exited 0
  in the read-only session. Its `npm test` attempt was not evidentiary because the enforced sandbox
  rejected temporary fixture creation with `EPERM`; the writable implementer session must rerun the
  full suite after correcting the findings.
- Implementation checks, 2026-08-21: `git diff --check` exited 0, `npm run typecheck` exited 0, and `npm test` exited 0 with 217 tests passed and 0 failed (13 new direct tests in `tests/workspace.test.ts` plus the previous 204).
- `src/core/workspace.ts` prepares the reviewer-visible tree under `worktree/`, writes sibling `diff.patch` and `changes.txt`, hashes two synthetic trees in a sibling isolated object database that is removed before the workspace snapshot, and freezes files to `0444` and directories to `0555`.
- `src/core/snapshot.ts` defaults to the repository policy (skip `.git`, `node_modules`, `.spartan-bridge`; 1 MiB hash shortcut) and accepts `policy: "workspace"` for full-domain full-hash snapshots.
- `.spartan-bridge/runs/run-2a2b52a3-ab5b-4d05-ab17-63e607a72acd/status.json`, 2026-08-21:
  cycle 3 of 3 returned `changes_requested` / `review_changes_requested` with one validated finding,
  `UNMERGED_STAGE_OMISSION`. D1's criterion now names that already-decided refusal. The next review
  is a fresh unchained run because the previous chain exhausted its limit.
- HX-008 reconciliation checks, 2026-08-21: `git diff --check` exited 0,
  `npm run typecheck` exited 0, and `npm test` exited 0 with 204 tests passed and 0 failed.
- `.spartan-bridge/runs/run-45a9a25f-ad12-4f63-9f4b-67475c3a9bf5/status.json`, 2026-08-21:
  cycle 2 of 3 returned `changes_requested` / `review_changes_requested` and atomically replaced the
  review region with two validated findings. The D2/D4 revision addresses both and keeps
  `next_role: reviewer` for the final cycle.
- Cycle-2 continuation checks, 2026-08-21: `git diff --check` exited 0,
  `npm run typecheck` exited 0, and `npm test` exited 0 with 204 tests passed and 0 failed.
- `.spartan-bridge/runs/run-3220bc22-ee01-4e4b-bf91-854f1e4ad04d/status.json`, 2026-08-21:
  fresh cycle 1 of 3 returned `changes_requested` / `review_changes_requested` and atomically wrote
  four validated findings. The D1-D4 revision above addresses them and keeps `next_role: reviewer`.
- Cycle-1 continuation checks, 2026-08-21: `git diff --check` exited 0,
  `npm run typecheck` exited 0, and `npm test` exited 0 with 204 tests passed and 0 failed.
- HX-005 reconciliation checks, 2026-08-21: `git diff --check` exited 0,
  `npm run typecheck` exited 0, and `npm test` exited 0 with 204 tests passed and 0 failed.
- `.spartan-bridge/runs/run-433ae877-5cf5-4df7-8a9f-c741d5e51f64/status.json`, 2026-08-21:
  cycle 2 of 3 returned `changes_requested` / `review_changes_requested` and atomically replaced the
  review region with four validated findings; the D1-D6 revision above addresses each one and keeps
  `next_role: reviewer` for the final authorized cycle.
- Cycle-2 producer checks, 2026-08-21: `git diff --check` exited 0, `npm run typecheck` exited 0,
  and `npm test` exited 0 with 204 tests passed and 0 failed.
- `.spartan-bridge/runs/run-fb2f1a13-9214-47de-b3c9-ef1ba3f36338/status.json`, 2026-08-21:
  cycle 1 of 3 returned `changes_requested` / `review_changes_requested` and atomically wrote four
  validated findings; the D1-D6 revision above addresses each one and keeps `next_role: reviewer`.
- `git ls-files --stage --sparse -t` on the current checkout produced the documented tag, mode, OID,
  stage, and path record shape; installed Git 2.50.1 help lists `--sparse`, `--stage`, `-t`, and `-z`.
- Cycle-1 producer checks, 2026-08-21: `git diff --check` exited 0, `npm run typecheck` exited 0,
  and `npm test` exited 0 with 204 tests passed and 0 failed.
- `.spartan-bridge/runs/run-a35e1270-daab-44d4-898c-a56f2270d821/status.json`, 2026-08-21:
  state `failed`, verdict `null`, reason `adapter_error`, adapter cause `output_unparsable`, and
  `task_write_state: null`; the run wrote no validated findings. Its retained `adapter-payload.log`
  is diagnostic payload only and no prose from it was imported into this artifact as review input.
- Producer-audit checks after refreshing the handoff, 2026-08-21: `git diff --check` exited 0,
  `npm run typecheck` exited 0, and `npm test` exited 0 with 204 tests passed and 0 failed.
- `git status --short` before the round produced no output; the worktree was clean.
- Installed Git 2.50.1 help exposes `git hash-object -w --stdin --no-filters`, `git mktree -z`, and
  whole-tree `git diff-tree`; no per-path argv is required by D4.
- A Node probe on Darwin opened a regular file beneath a canonical root with `O_NOFOLLOW_ANY` and
  received `ELOOP` for the same file through a symlinked ancestor. The first probe through the
  non-canonical `/var` alias also received `ELOOP`, which is why D3 canonicalizes the root first.
- D1 selects `git ls-files --others -z` without any exclude option so ignored and untracked names
  can be intersected with the decoded scope; ignore state itself never decides membership.
- `git diff --check` exited 0 after the planning edit.
- `npm run typecheck` exited 0 on 2026-08-21.
- `npm test` exited 0 on 2026-08-21: 204 tests passed, 0 failed.
- Task `0033` `## Review`, Bridge run `run-2d50c5de-b017-4f94-8c6f-5813be41b13a`, 2026-08-20: the
  five findings quoted in Context, verdict `changes_requested`, cycle 3 of a maximum of 3.
- Earlier cycles of the same chain: `run-66972327-bd96-475a-a543-3969ee253e9b` and
  `run-8a600fd4-80b1-42a7-9360-58ec8ad4de3f`, six findings each.
- `git --version` on this machine is `2.50.1 (Apple Git-155)`, and
  `git diff --pathspec-from-file=/dev/null` answers
  `error: unknown option `pathspec-from-file=/dev/null``. `git diff-index --help` contains no
  `pathspec-from-file`. Verified 2026-08-20.
- `src/core/snapshot.ts:9` skips `.git`, `node_modules`, and `.spartan-bridge`.
- `src/core/review.ts:344` and `:435` snapshot the repository worktree before and after every review
  and terminate on `reviewer_write_detected` with `comparison: "repository_worktree"`.
- Task `0032` probe run B: `zsh:1: operation not permitted: probe-write.txt` and
  `zsh:1: operation not permitted: AGENTS.md`, the observed read-only refusal that makes a copy
  defensible at all.
- `src/adapters/codex.ts:254-262` and `src/adapters/cursor.ts:309-321` prepare a two-file workspace
  with the same eight lines twice; this module is where that stops being duplicated.

## Review

<!-- spartan-bridge:review:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-2182cfbb-2b84-4708-9cde-99f5e8963631 execution_id=exec-955945e6-b947-4863-ad84-ef017f2dbd18 review_kind=plan verdict=pass reason_code=review_passed host=cursor launcher=cursor-plan-reviewer-v1 model=cursor-grok-4.6-high-fast effort=high model_observed=declared_unobserved policy_digest=sha256:8c6d3a4883d80ad20ae76298efa931aa0b90536f6e3ec15c401631a0d90e5288 task_hash=sha256:61258333a82c3e332a5718791ebaa1be531c5f4ce493f36aeb80372e1d2e5f2d agents_hash=sha256:b9f1f8227a3dde75b4b97c959d02d314ad4b590697340acb8b1c138d120998d3 timestamp=2026-08-21T15:47:03.306Z
<!-- spartan-bridge:review:end -->

### Implementation review

Verdict: APPROVED

Findings:

- None. Fresh Codex `gpt-5.6-terra` review of `HX-016` returned `PASS` after verifying the two final
  UTF-8 corrections and the earlier D1-D6 closures in a technically read-only session.

## Blockers

None. Task `0033` waits on this task's implementation, not the other way round.

## Next Action

None. Task `0034` is complete; task `0033` may now integrate this workspace library.

## Next Handoff

No outstanding handoff. This task is closed.
