---
protocol: "1.1.0" # x-release-please-version
id: the-identity-check-reports-only-after-the-identity-is-committed
created_at: 2026-09-11
status: completed
phase: complete
task_type: implementation
risk: material
current_role: human-operator
next_role: human-operator
updated_at: 2026-09-14
handoff_id: HX-009
next_handoff_id: none
---

# The identity check reports only after the identity is committed

## Objective

The repository's private-identity check reads tracked blobs from the git index and never the
working filesystem. A violation introduced by a change is therefore invisible while that change is
uncommitted, and the check reports it only on the run after the commit — after the identity has
entered the published history it exists to protect.

## Context

Observed on 2026-09-11, on this repository, by the defect landing in it.

`trackedEntries` in `tests/repo-hygiene.test.ts` reads every entry through `git ls-files -s -z` and
every blob through `git cat-file --batch`. Its own comment states why: *"The working filesystem is
never consulted, so a symlink is read as the blob holding its target rather than followed out of the
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

There is a third face. `git()` in the same file asserts the subprocess exited zero, so where there
is no `.git` at all the four scanning assertions fail outright rather than declining to run. An
isolated producer copy is exactly that environment, and its `npm test` therefore reports failures
that say nothing about the change under review.

## Scope

- `tests/repo-hygiene.test.ts` — what the four scanning assertions read, how a finding is labelled,
  how the file behaves where no repository metadata exists, and one new test that exercises the
  reading path against a throwaway repository.
- `docs/DECISIONS.md` — one dated entry, taking the next unused D-number.
- This task file.

Every path above exists in the current checkout. `package.json` and `AGENTS.md` were candidates in
the investigation's scope and are dropped by D3 and D5.

## Out of Scope

- The four matchers and their placeholder, address and alias sets. This task is about when the check
  runs and what it reads, not about what it matches.
- The fixture that exposed the gap. It was corrected directly on 2026-09-11.
- Detecting a person, an organisation, a product or an alias written as prose. The file's own
  preamble records why that is out of reach, and this task does not reopen it.
- The other failures an isolated producer copy produces for unrelated reasons. This task claims only
  the four scanning assertions in this file.
- A commit-time hook, a separate package script, or any machine-local git configuration (D3).
- `AGENTS.md` (D5).
- Scanning untracked files, and submodule entries, whose handling by the index listing is unchanged.

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

### D1 — The check reads two listings of tracked paths: the index, and the working copy as git would stage it

- **Index listing — unchanged.** Built exactly as today: `git ls-files -s -z` for the entries and
  `git cat-file --batch` for the bytes, in the environment the test process inherits. Every blob
  today's check reads is still read (E-2, E-5: this is the only listing that sees a staged violation
  whose working copy was later corrected, and the only one that still holds a tracked path deleted
  from the working tree).
- **Working-copy listing — new.** Built in a fresh directory created under `os.tmpdir()`, never
  under the repository:
  1. a temporary index file is populated from the same `git ls-files -s -z` output through
     `git update-index -z --index-info`;
  2. `git add -u` runs against it with `GIT_INDEX_FILE` set to that file, `GIT_OBJECT_DIRECTORY` set
     to a fresh `objects` directory inside the temporary directory (created before the call, E-5),
     and `GIT_ALTERNATE_OBJECT_DIRECTORIES` set to the absolute path of the repository's object
     directory, resolved from `git rev-parse --git-path objects` against the repository root;
  3. `git ls-files -s -z` and `git cat-file --batch` read the result under those same three
     variables.

  The temporary directory is removed in a `finally`. Those three variables are the only change to
  the environment the listings inherit.
- **The symlink property, answered explicitly.** The test file opens no working-tree file itself.
  Git's own staging code decides what the working copy of a tracked path is, and E-5 shows its
  behaviour: a tracked path whose working copy is a symlink is recorded as a mode `120000` entry
  whose blob is the link's target string, so the target's content is never read; a tracked path
  beneath a directory that has been replaced by a symlink leaves the working-copy listing
  altogether, so nothing beyond the link is read. A symlink target that is itself a home path is
  still scanned as text and still reported, exactly as a committed symlink blob is today.
- **Repository metadata stays unwritten.** A run of this file writes no file under the
  repository's git directory — no object, index, ref, log, configuration or any other file. New
  blobs land only in the temporary object directory and the temporary index is the only index
  written (E-5: the path and content hash of every file under `.git` were identical before and
  after). The claim is about this file's run, not about other test files in the suite.

  **Amended 2026-09-13 after E-17.** A run leaves the set and bytes of files under the
  repository's Git directories, and the worktree status, unchanged. It does not promise unchanged
  filesystem timestamps: Git may refresh the timestamp of an existing loose object when it
  re-derives bytes already present through the alternate object directory. That bounded refresh is
  acceptable because it changes neither repository content nor the index, refs, configuration, or
  worktree; the scan mechanism and symlink property therefore remain unchanged. This amendment
  replaces the stronger "writes no file" wording above.
- **No double reporting.** A working-copy entry whose path and blob identifier both equal an index
  entry's is the same bytes under the same name and is not scanned again.

What stays the same: the four matchers, the four sets, the retained case arrays and their judgement
tests, the four scanning test names, the position-and-count finding shape, and the index listing's
inputs. What changes, completely: the second listing; the finding label (D2); the four scanning
assertion messages (D2); the `AGENTS.md` table lookup inside the alias assertion, which inspects the
`AGENTS.md` entry of each listing, deduplicated as above; the no-metadata skip (D4); the new
throwaway-repository test; and the file's preamble and helper comments, which describe the two
listings, the symlink answer and the skip.

### D2 — Staging is no longer a precondition for seeing a change to a tracked path, and where it still matters the failure says so

- A finding is labelled `index entry N of M` or `working-copy entry N of M`, where `N` is the
  position in that listing and `M` its length. Both are positions and counts; neither names a blob
  identifier, a path, a filename, or the matched value.
- Staging remains relevant in exactly two cases, and each of the four scanning assertions' messages
  ends with one shared sentence stating both: *an index entry clears only once the corrected file is
  staged, and a new file is scanned only once it is tracked.*
  - A violation fixed in the working copy but not staged is still in the index, which is what a
    plain `git commit` would write; it keeps reporting as an index entry until staged, and the label
    tells the reader that is the reason.
  - A new file is untracked until `git add` or `git add -N`; the Constraints keep untracked content
    outside the check.
- The failure in E-2 — a tracked file edited and not staged — is now a `working-copy entry` finding
  on the task's own suite run, before any commit.

### D3 — The check does not move earlier than the suite

No commit hook, no `core.hooksPath`, no separate package script. The measurement that missed E-2 was
a suite run recorded before the commit; D1 makes that same run see the change. A hook is per-clone
configuration the repository can neither install nor observe, so its coverage could not be claimed.
Residual, stated: a commit made without running the suite after the last edit is as unchecked as
it is today. `package.json` is therefore not in scope.

### D4 — Where the checkout has no repository metadata of its own, the four scanning assertions skip with a stated reason

- Absence is identified positively, from the filesystem entry and never from a git exit code. At
  load, the file takes `lstat` of `.git` at the repository root — the entry itself, not followed.
  Only an `ENOENT` result is absence. Then the four scanning assertions are declared skipped with
  one fixed reason: *no repository metadata at this checkout's root; the identity scan did not
  run.* The reason names no path. Any entry counts as present, whether a file, a directory or a
  symlink, because a linked worktree's root holds `.git` as a file.
- Every other outcome fails, and none skips:
  - an `lstat` error other than `ENOENT`;
  - `.git` present but `git rev-parse --show-toplevel` exiting non-zero or failing to spawn. That
    covers permissions, unsafe ownership, corrupt metadata, configuration or environment errors,
    and git not installed;
  - `.git` present, but the real path the probe prints differs from the real path of the repository
    root. E-9 shows that a `.git` directory which is not a repository, inside an enclosing
    repository, resolves to the enclosing repository with exit 0. Today's check would silently scan
    that other repository; this one reports the mismatch with a fixed message naming no path;
  - any later git failure in either listing, as today.
- Skipping reads the checkout's root, not the environment. An inherited git variable does not
  turn an absent `.git` into a scan.
- The four retained-case judgement tests and the throwaway-repository test (D1) do not depend on the
  checkout's metadata and still run in such a copy.
- Chosen over failing, knowing the cost: a skip claims nothing passed — the runner counts it under
  `skipped`, not `pass` — while four failures in an isolated producer copy (E-4, E-7) are attributed
  to the change under review. The scan runs in the checkout a human commits from.

### D5 — `AGENTS.md` remains accurate and is not edited

The Artifact authoring rule says the check covers four shapes "in tracked pathnames and tracked
blobs". Both D1 listings are tracked pathnames and blobs of tracked paths; the sentence never
said which version of a tracked path is read, and stays true. The working-copy listing is derived
from index-tracked paths with `git add -u`, so a new file is outside both listings until it becomes
tracked. No replacement sentence or matching `tests/agents.test.ts` pin is needed; this task edits
neither file.

### D6 — One dated decision record

`docs/DECISIONS.md` gains one entry, numbered with the next unused D-number, stating D1's two
listings and their symlink answer, D2's staging rule, D3's rejection of a hook, and D4's skip.

## Acceptance Criteria

| # | Decision | Criterion | Verification |
| --- | --- | --- | --- |
| AC-1 | D1 | The index listing is built from `git ls-files -s -z` and `git cat-file --batch` in the inherited environment, as today. | Diff inspection of `tests/repo-hygiene.test.ts`. |
| AC-2 | D1 | The working-copy listing is built through `update-index -z --index-info`, then `add -u`, then `ls-files -s -z` and `cat-file --batch`, under exactly `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY` and `GIT_ALTERNATE_OBJECT_DIRECTORIES` pointing as D1 states; the temporary directory is created under `os.tmpdir()` and removed in a `finally`; the file opens and reads no tracked path through `node:fs`. Its filesystem calls are limited to creating and removing the temporary directory, resolving real paths, the D4 `lstat` of the root's `.git`, and the AC-3 test's construction of its throwaway repository. | Diff inspection; `rg -n "readFile|openSync|createReadStream|readlink" tests/repo-hygiene.test.ts` returns no match. |
| AC-3 | D1, D2 | A new test builds a throwaway repository under `os.tmpdir()` (no commit needed) with a runtime-constructed marker and a directory outside it, and asserts through the file's own listing code: an unstaged edit containing the marker is found as a working-copy entry and not as an index entry; a staged marker whose working copy was then cleaned is found as an index entry only; an unchanged tracked file containing the marker is reported once, as an index entry; a tracked file replaced by a symlink to an outside file holding the marker yields a mode `120000` working-copy entry whose scanned text is the target string and does not contain the marker; a tracked path under a directory replaced by a symlink to the outside directory is absent from the working-copy listing and the marker appears in no scanned text. | `npm test`; the new test passes. |
| AC-4 | D1 | A run of `tests/repo-hygiene.test.ts` leaves the set and bytes of files under the repository's Git directories, and the worktree status, unchanged; Git may refresh the timestamp of an existing loose object as stated by D1. | In this checkout, in this order: `git --no-optional-locks status --porcelain --untracked-files=all`. Then the sorted list of every file path under `git rev-parse --git-common-dir`, and under `git rev-parse --git-dir` when that differs, each with its content hash. Then `node --import tsx --test tests/repo-hygiene.test.ts`, then the same path-and-hash list, then the same status. Both lists are identical and both statuses are identical. |
| AC-5 | D1 | The four matcher functions, the four sets, the four retained case arrays and the four scanning test names are byte-identical to `9ef603d`. | `git diff 9ef603d -- tests/repo-hygiene.test.ts` shows no change inside them. |
| AC-6 | D2 | A finding reads `index entry N of M` or `working-copy entry N of M` and carries no blob identifier, path, filename or matched value; each of the four scanning assertion messages ends with D2's shared sentence; the alias assertion inspects the `AGENTS.md` entry of each listing, deduplicated. | Diff inspection; AC-3's labels. |
| AC-7 | D3 | No hook, hook path, package script or git configuration is added. | `git diff --stat` names only `tests/repo-hygiene.test.ts`, `docs/DECISIONS.md` and this task file. |
| AC-8 | D4 | A copy of `tests/repo-hygiene.test.ts` sits at `<copy-root>/tests/`, and `<copy-root>` holds no `.git` entry. Run as `node --import tsx --test <copy>` from this checkout's root, in a fresh directory outside any repository: the four scanning assertions are reported skipped with D4's reason, and the four judgement tests and the AC-3 test pass, with zero failures. The same run with `<copy-root>` nested inside a freshly initialised repository gives the same result. | The two runs, with their summary counts recorded. |
| AC-9 | D4 | A present `.git` never skips. (a) `<copy-root>` holds an empty `.git` directory, in a fresh directory outside any repository: the four scanning assertions fail and none is skipped. (b) The same `<copy-root>` nested inside a freshly initialised repository: the four fail with the root-mismatch message, and none reports a finding from the enclosing repository. (c) An `lstat` error other than `ENOENT`, and a spawn error from the probe, fail rather than skip. | The (a) and (b) runs, with their summary counts recorded; diff inspection of the `lstat` and `result.error` branches for (c). |
| AC-10 | D6 | `docs/DECISIONS.md` has one new dated entry covering D1–D4. | Diff inspection. |
| AC-11 | — | `npm test` in this checkout: zero failures, zero skipped, and a pass count equal to the E-6 baseline plus the tests the change adds. | `npm test` summary. |

## Work Completed

- 2026-09-11 — investigation recorded E-1 to E-4 and the four open decisions.
- 2026-09-13 — planner round (Claude Code, `claude-opus-5`, effort high, Anthropic, entered through
  `/spbridge`). The pasted prompt carried no handoff identifier; the round proceeded under the
  artifact's `HX-002`. Settled D1–D6 on E-5 to E-8 and derived AC-1 to AC-11 from them last. The
  untracked `spartan/tasks/0085-a-live-repository-write-is-blamed-on-the-producer.md` belongs to a
  different queued task and shares no file with this one.
- 2026-09-13 — plan review cycle 1 (Bridge run `run-e03c0ec3-a2ce-4d35-abb3-a65492f7dad4`, Codex
  `gpt-5.6-sol`, high) returned CHANGES_REQUESTED with two findings. Both are revised in the same
  planner session:
  - `PROBE_FAILURE_SKIP` — D4 now skips only on an `lstat` `ENOENT` of the root's `.git`. Every
    other outcome fails, including a present `.git` that resolves to another toplevel (E-9).
    AC-2, AC-8 and AC-9 were re-derived.
  - `METADATA_VERIFICATION` — D1's metadata claim is scoped to this file's run. AC-4 was
    re-derived to compare every file path and content hash under the git directories, plus status.
- 2026-09-13 — implementer round (Codex `gpt-5.6-sol`, high, authorized Bridge foreground
  transition after approved plan-review run `run-30be3579-52cc-4c0f-aa0b-f89416d8b3cf`). Implemented
  the index and temporary working-copy listings, path-and-blob deduplication, listing-specific
  findings and staging guidance, metadata-presence probe and four-scan skip, the throwaway
  repository coverage, and D-080. Only `tests/repo-hygiene.test.ts`, `docs/DECISIONS.md`, and this
  task artifact were edited.
- 2026-09-13 — implementer correction round (Codex `gpt-5.6-sol`, high, authorized Bridge
  foreground transition after implementation-review run
  `run-dadd56a7-d035-49c1-bc13-afe8b832a8bb`). Removed `GIT_DIR`, `GIT_WORK_TREE`,
  `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, and
  `GIT_COMMON_DIR` from the throwaway fixture's base environment. The fixture now poisons all six
  inputs before sanitizing them and passes that sanitized environment to `git init`, both staging
  calls, and `trackedListings`; the real-checkout scan still inherits its environment unchanged.
  Refined D-080 and the helper comment to claim unchanged repository-metadata content, matching
  AC-4's path-and-content-hash measurement.
- 2026-09-13 — implementation review cycle 2 (Bridge run
  `run-5bbce424-59f8-4036-87e5-11adecff89bb`, Claude Code `claude-opus-5`, high, Anthropic) returned
  `human_required` with `reason_code` `review_human_required`. The Bridge skipped the artifact write
  at the human gate, so its result is adopted here rather than authored:
  - its summary judged the correction to match D1–D6 on inspection;
  - `REPO_BACKED_ACS_UNVERIFIED` (warning): AC-3, AC-4, AC-8, AC-9(a)/(b) and AC-11 lacked passing
    evidence;
  - `FIXTURE_HOST_GIT_CONFIG` (info): the fixture still reads global and system git configuration.
    It fails closed and needs no change;
  - `STALE_DECLARATION_EVIDENCE` (info): E-13 names `HX-005` while the envelope had advanced.
- 2026-09-13 — verification round (Claude Code, `claude-opus-5`, effort high, Anthropic), directed
  by the owner in the live checkout and changing no product file. It ran AC-3, AC-4, AC-8, AC-9 and
  AC-11, recorded as E-16 to E-19, which closes `REPO_BACKED_ACS_UNVERIFIED`. It also annotated
  E-13 for `STALE_DECLARATION_EVIDENCE`. `FIXTURE_HOST_GIT_CONFIG` was not acted on.
- 2026-09-13 — owner decisions:
  - D4's skip, D3's rejection of a hook, and D1's two listings with an index finding held until
    staged are accepted as planned.
  - Before the task closes, the owner requires a Codex review of two questions: whether D5's
    unedited `AGENTS.md` sentence stays accurate, and what D1, D-080 and the helper comment should
    say about repository metadata given E-17.
  - The owner then routed both questions to a human-started Codex implementer round entered through
    `$spbridge`, so the Bridge dispatches the implementation review that follows. The read-only
    review envelope `HX-007` was withdrawn unused.
- 2026-09-13 — implementer round (Codex; the session exposed only the `GPT-5` family label, so the
  exact `gpt-5.6-sol` binding identifier could not be confirmed; high effort). Accepted E-17's
  timestamp refresh because it leaves repository content, the index, refs, configuration, and
  worktree unchanged; amended D1, D-080, the helper comment, and AC-4 to state the measured boundary
  exactly without changing the scan mechanism. Confirmed D5 remains accurate because both listings
  scan pathnames and blobs for index-tracked paths, while `git add -u` leaves a new file outside the
  check until it is tracked. `AGENTS.md` and `tests/agents.test.ts` therefore require no human edit.

- 2026-09-14 — closed by the human operator (recorded by Claude Code, `claude-opus-5`, effort high,
  Anthropic) after implementation review run `run-b67ef6fb-8a47-4e10-b19f-967a175617b2` returned
  `review_passed`:
  - The owner accepted `FIXTURE_HOST_GIT_CONFIG` for this task. The throwaway-repository test still
    reads global and system git configuration. A configuration that interferes would fail that
    test alone, with assertions that do not name git configuration as the cause.
  - Isolating the fixture from that configuration is queued as a separate follow-up task.
  - The owner authorized the closing commit and its push.

## Evidence

- **E-1 — the reading path is the index.** `trackedEntries` in `tests/repo-hygiene.test.ts`
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
- **E-4 — the helper fails closed where there is no repository metadata.** `git()` in
  `tests/repo-hygiene.test.ts` asserts `result.status` equals zero with the message
  `git <subcommand> must succeed`. An isolated producer copy carries no `.git`, and the
  implementation review of task `0079` recorded that copy's suite as 527 passing, 29 failing and 12
  skipped, naming the absent `.git` among the causes.
- **E-5 — git 2.50.1 stages the working copy without following a symlink or writing the repository.**
  A throwaway repository outside this checkout, `<base>/repo`, held `a.txt`, `c.txt`, `d.txt`,
  `e.txt` and `sub/b.txt`, each `clean`, committed. Then: `a.txt` rewritten to `UNSTAGED-MARKER`;
  `c.txt` replaced by `ln -s <base>/outside/secret.txt c.txt` (that file holds `OUTSIDE-MARKER`);
  `sub` replaced by `ln -s <base>/outside sub` with `<base>/outside/b.txt` holding `OUTSIDE-MARKER`;
  `d.txt` staged as `STAGED-MARKER` and then rewritten to `clean`; `e.txt` deleted. With every file
  under `.git` hashed, the probe ran:
  `git ls-files -s -z | GIT_INDEX_FILE=<scan>/index git update-index -z --index-info`, then
  `GIT_INDEX_FILE=<scan>/index GIT_OBJECT_DIRECTORY=<scan>/objects GIT_ALTERNATE_OBJECT_DIRECTORIES=<repo>/.git/objects git add -u`,
  then `ls-files -s` and `cat-file --batch` under the same variables. Outcomes: the index listing
  held all five entries and one marker (`STAGED-MARKER`); `add -u` exited 0; the working-copy
  listing held `100644 a.txt`, `120000 c.txt`, `100644 d.txt` — `sub/b.txt` and `e.txt` absent —
  and its blobs contained `UNSTAGED-MARKER` and the target path string `<base>/outside/secret.txt`,
  never `OUTSIDE-MARKER` and never `STAGED-MARKER`; the hash of every file under `.git` was
  identical afterwards; the private object directory held two new objects. A first run without
  creating `<scan>/objects` beforehand failed with `fatal: not a git repository` and exit 128, which
  is why D1 creates it first. In a directory with no metadata below a
  `GIT_CEILING_DIRECTORIES` bound, `git rev-parse --show-toplevel` printed
  `fatal: not a git repository (or any of the parent directories): .git` and exited 128.
- **E-6 — baseline.** `npm test` on `9ef603d`, 2026-09-13: tests 618, pass 618, fail 0, skipped 0.
- **E-7 — the isolated copies carry no `.git` and live under the OS temporary directory.**
  `src/core/snapshot.ts` lists `.git` among its excluded names; `src/core/workspace.ts` creates the
  producer workspace with `fs.mkdtemp(path.join(os.tmpdir(), "spartan-bridge-producer-"))`.
- **E-8 — `npm run typecheck` does not cover tests.** `tsconfig.json` includes only `src/**/*.ts`,
  so AC-11 names `npm test` and no typecheck.
- **E-9 — git's exit code cannot establish absence, and a present `.git` can resolve elsewhere.**
  Under `<base>`, bounded by `GIT_CEILING_DIRECTORIES=<base>`: `mkdir -p <base>/alone/.git`, then
  `git rev-parse --show-toplevel` in `<base>/alone`, printed `fatal: not a git repository (or any of
  the parent directories): .git` and exited 128. The same message and exit arise for a real checkout
  git cannot open, so D4 does not read absence from them. `git -C <base>/outer init` followed by
  `mkdir -p <base>/outer/inner/.git` and the same command in `<base>/outer/inner` printed
  `<base>/outer` and exited 0. After `rmdir <base>/outer/inner/.git` it printed `<base>/outer` and
  exited 0 again. This checkout's root `.git` is a directory, and `git rev-parse --git-dir
  --git-common-dir` prints `.git` twice.
- **E-10 — implementation shape.** `tests/repo-hygiene.test.ts` retains the four matcher functions,
  sets, case arrays, and scan names. The real index still comes from `ls-files -s -z` and
  `cat-file --batch` in the inherited environment. The second listing seeds a temporary index with
  `update-index -z --index-info`, runs `add -u`, and reads it with the same listing commands under
  only `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, and `GIT_ALTERNATE_OBJECT_DIRECTORIES`; cleanup is
  in `finally`. `rg -n "readFile|openSync|createReadStream|readlink"
  tests/repo-hygiene.test.ts` returned no match.
- **E-11 — compile checks.** `node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module
  NodeNext --moduleResolution NodeNext --types node --strict --skipLibCheck
  tests/repo-hygiene.test.ts` exited 0. `npm run typecheck` exited 0.
- **E-12 — isolated-producer test evidence and limitation.** This authorized producer copy has no
  `.git` entry and its sandbox denies `/usr/bin/git` opening `/dev/null`. The focused
  `node --import tsx --test tests/repo-hygiene.test.ts` run reported the four scanning assertions
  skipped with D4's exact reason, all four retained-case tests passing, and the new throwaway test
  failing at `git init` with exit 128. The full `npm test` run reported 619 tests, 576 passing, 26
  failing, and 17 skipped; all 26 failures are Git-dependent cases stopped by the same sandbox
  denial, including the new test. The focused file's repository-backed cases and AC-4 therefore
  require rerun in the live checkout where Git and repository metadata are available.
- **E-13 — implementation declaration.** `validateProducerDeclaration` returned `{ "ok": true }`
  for this artifact with `task_type: implementation`, `phase: reviewing`, `current_role:
  implementer`, `next_role: reviewer`, `next_handoff_id: HX-005`, and the fenced reviewer handoff.
  That validation describes the first implementer round's envelope only. The correction round
  advanced the envelope to `HX-006` and recorded no new validation (annotated 2026-09-13).
- **E-14 — correction compile and inspection checks.**
  `node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module NodeNext
  --moduleResolution NodeNext --types node --strict --skipLibCheck
  tests/repo-hygiene.test.ts` exited 0; `npm run typecheck` exited 0; and
  `rg -n "readFile|openSync|createReadStream|readlink" tests/repo-hygiene.test.ts` returned no
  match. Inspection confirms the fixture gives every Git call its sanitized base environment,
  while `listings()` continues to call `trackedListings()` without an environment argument.
- **E-15 — correction test runs and sandbox limit.**
  `node --import tsx --test tests/repo-hygiene.test.ts` reported 9 tests: 4 passing retained-case
  tests, 4 repository scans skipped with D4's exact reason, and the throwaway test failing at
  `git init` with exit 128. `npm test` reported 619 tests, 576 passing, 26 failing, and 17 skipped.
  All 26 failures are Git-dependent and show the producer sandbox's
  `fatal: could not open '/dev/null' for reading and writing: Operation not permitted`; the counts
  are unchanged from E-12. AC-3, AC-4, AC-8, AC-9, and AC-11 therefore still require a Git-capable
  live checkout.
- **E-16 — AC-4 in the live checkout.** `git rev-parse --git-dir --git-common-dir` printed `.git`
  twice. In this order the round ran:
  1. `git --no-optional-locks status --porcelain --untracked-files=all`;
  2. `find .git -type f -print0 | sort -z | xargs -0 shasum`;
  3. `node --import tsx --test --test-reporter=tap tests/repo-hygiene.test.ts`, which exited 0 with
     tests 9, pass 9, fail 0, skipped 0;
  4. the same `find`, then the same `status`.

  The two path-and-content-hash lists were identical over 597 files, and the two statuses were
  identical.
- **E-17 — the same run refreshed object timestamps.** Around the E-16 run, `find .git -type f
  -exec stat -f '%m %N' {} +` also recorded each file's modification time. 207 files changed it, and
  every one was a loose object under `.git/objects`. Their content hashes were unchanged (E-16). A
  throwaway repository reproduced the cause:
  1. one committed file, its loose object set to `touch -t 202001010000`;
  2. `git ls-files -s -z | GIT_INDEX_FILE=<scan>/index git update-index -z --index-info`;
  3. `GIT_INDEX_FILE=<scan>/index GIT_OBJECT_DIRECTORY=<scan>/objects GIT_ALTERNATE_OBJECT_DIRECTORIES=<repo>/.git/objects git add -u`.

  The object's modification time moved from 2020-01-01 to the time of the run, and the private
  object directory held 0 new objects. Git refreshes the timestamp of an object it re-derives even
  when the object lives in an alternate. This contradicts D1's bullet that a run "writes no file
  under the repository's git directory". The implementation's own wording is narrower:
  - D-080 says the scan does not write "repository-metadata content";
  - the helper comment says "The repository's metadata content remains unchanged".
- **E-18 — AC-8 and AC-9 copy-root runs.** Each copy was
  `<copy-root>/tests/repo-hygiene.test.ts`, run from this checkout's root as
  `node --import tsx --test --test-reporter=tap <copy-root>/tests/repo-hygiene.test.ts`. The base
  directory sat under the job's temporary directory, and `git -C <base> rev-parse --show-toplevel`
  failed there, so it was outside any repository.
  - AC-8, no `.git` entry at `<base>/a`: tests 9, pass 5, fail 0, skipped 4. Each of the four scans
    read `# SKIP no repository metadata at this checkout's root; the identity scan did not run.`
  - AC-8, no `.git` entry, nested at `<base>/outer8/inner` after `git init -q <base>/outer8`: the
    same counts and reasons.
  - AC-9(a), an empty `.git` directory at `<base>/c`: tests 9, pass 5, fail 4, skipped 0. Each scan
    failed with `the repository-root probe must succeed`.
  - AC-9(b), an empty `.git` directory nested at `<base>/outer9/inner` after
    `git init -q <base>/outer9`: tests 9, pass 5, fail 4, skipped 0. Each scan failed with
    `the repository-root probe must resolve to this checkout's root`, and no finding came from the
    enclosing repository.
  - AC-9(c) remains the inspection recorded by the cycle-2 implementation review.
- **E-19 — AC-3 and AC-11.** `ok 9 - tracked listings include unstaged changes without following
  symlinks` passed in the E-16 run and in all four E-18 runs. `npm test` in the live checkout on
  2026-09-13 exited 0 with tests 619, pass 619, fail 0, cancelled 0, skipped 0, todo 0. That is the
  E-6 baseline of 618 plus the one added test.
- **E-20 — owner-question implementation checks.** On 2026-09-13, after the wording amendments,
  `npm test` exited 0 with tests 619, pass 619, fail 0, cancelled 0, skipped 0, todo 0.
  `node --import tsx --test tests/repo-hygiene.test.ts` exited 0 with tests 9, pass 9, fail 0,
  cancelled 0, skipped 0, todo 0. The focused throwaway-repository test retained its symlink
  assertions and passed.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-30be3579-52cc-4c0f-aa0b-f89416d8b3cf execution_id=exec-0bb022ad-f5d1-421c-9620-3da53918f0b4 review_kind=plan verdict=pass reason_code=review_passed host=codex launcher=codex-plan-reviewer-v1 model=gpt-5.6-sol effort=high model_observed=declared_unobserved policy_digest=sha256:c032b4cea31dd45976e0e4d6a6b689590f1f0a1a368378fd8a82e546eb9525a3 spartan-bridge version=0.1.0 commit=e6539f92be0621c770b35752d35f673f5b89e663 dirty=false built_at=2026-09-13T09:21:32.781Z task_hash=sha256:bfd0fb5b1320d23662ea8c84fc206a799203198ad645ed47661c395c7c65c860 agents_hash=sha256:80d5047ce326a1e3c87a0fee167512528a00f525568d8c78e8e58a2ef89f3991 timestamp=2026-09-13T20:30:41.932Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-b67ef6fb-8a47-4e10-b19f-967a175617b2 execution_id=exec-f7459085-caa2-4924-8bff-15d542851cca review_kind=implementation verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-opus-5 effort=high model_observed=declared_unobserved policy_digest=sha256:e363264f72a848d870898b8d1d1abe453a4f1e519f622f4415d9531d867023f6 spartan-bridge version=0.1.0 commit=e6539f92be0621c770b35752d35f673f5b89e663 dirty=false built_at=2026-09-13T09:21:32.781Z task_hash=sha256:1bda47d02a01667e0f9e19065351ec3c2443c270b00938e3eed57b1e55783805 agents_hash=sha256:80d5047ce326a1e3c87a0fee167512528a00f525568d8c78e8e58a2ef89f3991 timestamp=2026-09-13T21:47:34.695Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None. E-16 to E-20 verify the acceptance criteria and both owner questions are settled in D1 and
D5. The timestamp refresh is accepted within D1's amended boundary, and the private-identity rule
and its `tests/agents.test.ts` pin remain accurate without edits.

## Next Action

None. Closed by the human operator on 2026-09-14 after the implementation review passed. The work
lands in the commit that closes this task.

## Next Handoff

No outstanding handoff. The proposed review was consumed.
