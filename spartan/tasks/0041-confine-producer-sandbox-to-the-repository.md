---
protocol: "1.0.0" # x-release-please-version
id: confine-producer-sandbox-to-the-repository
created_at: 2026-08-23
status: completed
phase: complete
task_type: implementation
risk: high-impact
current_role: implementer
next_role: none
updated_at: 2026-08-23
handoff_id: HX-001
next_handoff_id: none
---

# Confine the producer sandbox to the repository

## Objective

The Darwin Cursor producer can start the already-authenticated official client
while the Bridge-owned `sandbox-exec` profile still denies every repository
write outside the automatic write scope. A later `/spbridge` plan-pass on task
`0031` can reach a running implementer instead of stopping in a few seconds as
`producer_failure` / `exit_nonzero`.

## Context

Task `0039` shipped the foreground automatic Cursor implementer and then, under
finding `SANDBOX_ALLOW_DEFAULT`, replaced an `(allow default)` profile with a
fail-closed positive-scope profile that denies every `file-write*` operation
except admitted repository paths. That profile treats `/dev/null`, `$TMPDIR`,
the inherited `$HOME`, and `$HOME/.cursor` the same as an out-of-scope
repository write. Task `0040` classified later stops as
`producer_diagnostic.stage: exit_nonzero` and explicitly left the client
failure itself out of scope.

Four live task-`0031` successors then acquired the writer lock, emitted
`producer_started`, and stopped in about four seconds with no product edit and
no implementation review:

- `transition-a98875b9-cfd6-42da-b8ad-93876d33969f`
- `transition-3428d961-5a24-43e1-917c-5dccdaf08a52`
- `transition-b5332950-6b80-4fbe-aa13-daa67718d7ef`
- `transition-aaccb358-200c-4d4c-9cbc-b390a91a8d20` (`stage: exit_nonzero`,
  `exit_code: 1`, `timed_out: false`, adapter fields null)

The mapped `reviewer.plan` Cursor child is not wrapped in that profile and
completes. The producer child is. An independent host reproduced the producer
argv under the current `producerWriteScopeSandboxProfile` and observed exit 1
in 854 ms because the `cursor-agent` launcher cannot redirect to `/dev/null`.
The same profile returns `EPERM` for writes to `$HOME`, `$TMPDIR`, and
`$HOME/.cursor`, and allows an in-scope `src/` write.

The official-client launcher writes compile cache under `$HOME/Library/Caches`
and session state under the inherited `$HOME`. Isolation of that home remains a
machine-local wrapper concern; the Bridge still must not inspect, name, or
persist those paths.

The primary worktree currently carries an unrelated modification to task
`0031`. This task must not edit that artifact. Implementation belongs in a
separate worktree, as task `0040` did, because the automatic implementer is the
defect under repair and cannot implement its own fix.

## Scope

- `src/adapters/producer-write-scope.ts`: rebuild
  `producerWriteScopeSandboxProfile` so confinement is the repository write
  scope, not a whole-machine write jail.
- `tests/producer-write-scope.test.ts` and the producer-profile assertions in
  `tests/cursor-adapter.test.ts`: re-derive coverage for the new deny region
  and for operational writes outside the repository.
- `docs/ARCHITECTURE.md`, `docs/AUTHENTICATION-AND-SECURITY.md`, and
  `docs/DECISIONS.md`: record the corrected sandbox boundary.
- This task artifact.

## Out of Scope

- Editing, retrying, or implementing task `0031`, or starting `/spbridge` on
  that artifact from this task.
- Capturing or persisting producer stdout, stderr, prompts, payloads, paths,
  credentials, or client prose. Task `0040`'s closed diagnostic stays the
  failure record.
- New reason codes, retries, a transition-resume entrypoint, argv changes,
  environment-allowlist changes, Cursor `--sandbox` / `--mode` flags, POSIX
  chmod-guard semantics, snapshot policy, write-scope admission, or
  authentication flows.
- Encoding `$HOME`, `$TMPDIR`, `cursor-home`, or any client-profile path in
  repository files, profile literals, tests, or docs examples.
- Changing reviewer spawn, which already runs without this `sandbox-exec`
  profile.

## Constraints

- All rounds of this task are human-started manual Spartan rounds. A
  Bridge-dispatched plan pass would start the same broken automatic
  implementer; that successor is unauthorized here.
- Implementation must use a worktree other than the primary checkout while
  task `0031` remains dirty there.
- The profile may name only the already-computed canonical repository root and
  admitted write-scope paths. It must not interpolate environment values.
- `/dev/null`, the process `$TMPDIR`, and the inherited `$HOME` must remain
  writable without the Bridge reading those locations to classify them.
- Repository paths outside `write_scope`, including `.git`, `.spartan-bridge`,
  `node_modules`, `AGENTS.md`, and `spartan-bridge/config.yaml`, stay
  unwritable through both the POSIX guard and `sandbox-exec`.
- Symlink creation inside the repository stays denied, including under an
  admitted directory.
- Empty admitted scope stays fail-closed: deny every `file-write*`.
- Persisted repository content stays English. No credential or authentication
  file is read.

## Decisions

### D1 - The Darwin producer sandbox confines the repository, not the machine

`write_scope` is a repository admission list. The POSIX mode lock already
covers that tree. `sandbox-exec` is the Darwin second opinion against
same-UID writes and `chmod` of repository paths the POSIX guard left
non-writable.

It is not a whole-machine jail. Official-client startup needs `/dev/null`,
`$TMPDIR`, and the inherited `$HOME` (session state and compile cache). Those
writes sit outside the repository. Denying them is what turns every live
automatic implementer into `exit_nonzero` before the child can act.

A path that is not under the canonical repository root, including a
boundary-prefix sibling of that root, is machine-local. Official-client
profile isolation remains outside the Bridge. This decision does not grant
repository writes outside `write_scope`.

### D2 - The deny region is "under the repo and not admitted", plus repo symlinks

When at least one admitted path remains after the existing skip rules,
`producerWriteScopeSandboxProfile` emits this shape, using
`sandboxPathLiteral` for the canonical root and each admitted path:

```text
(version 1)
(allow default)
(deny file-write*
  (require-any
    (require-all
      (subpath <canonical-root>)
      (require-not (require-any <admitted-filters>)))
    (require-all
      (subpath <canonical-root>)
      (vnode-type SYMLINK))))
```

`<admitted-filters>` stay the current `(subpath ...)` directory entries and
`(literal ...)` exact-file entries. Empty admitted scope keeps the existing
fail-closed body `(allow default)` plus `(deny file-write*)`.

What stays denied: every `file-write*` under the canonical root that is not
an admitted filter, including root, `.git`, `node_modules`,
`.spartan-bridge`, `AGENTS.md`, `spartan-bridge/config.yaml`, and any other
unadmitted product path; symlink vnode creation anywhere under that root,
including inside an admitted directory.

What becomes writable: ordinary writes that are not under the canonical
root, including `/dev/null`, `$TMPDIR`, and the inherited `$HOME`; ordinary
writes that match an admitted filter.

The function still names no environment variable and still throws
`confine_unavailable` on an unsanitary path character.

### D3 - Every other producer control stays as shipped

`applyProducerWriteScope`, symlink/hardlink preflight, exact-file-leaf
rules, POSIX modes, restore-after-child, producer argv
(`CURSOR_PRODUCER_ARGV_PREFIX` plus `--sandbox enabled`),
`childEnvironment`, snapshot policy, reason codes, and
`producer_diagnostic` stay unchanged. Docs and tests that described
whole-machine write denial are amended to the D1/D2 boundary rather than
having those controls reopened.

### D4 - Coverage proves both sides of the new deny region

Keep the existing in-repo protection cases: out-of-scope write, protected
`chmod`, `node_modules` plant, admitted directory write, admitted exact-file
write, in-repo symlink creation, and creation-time hard link into admitted
scope.

Replace the current "direct outside write to a `mkdtemp` file is `EPERM`"
assertion. That file lives under `$TMPDIR` and is an operational write D1
now allows. The replacement positive cases are: a write to `os.tmpdir()`, a
write to a throwaway directory created under the current process `HOME`, and
a write to `/dev/null`, all succeeding under the real Darwin profile, while
the same child still cannot write `AGENTS.md` or create an in-repo symlink.

Do not put a real user home, `cursor-home`, or profile path into a test
literal. Use `os.tmpdir()` and a `mkdtemp` under the process `HOME` already
supplied to the test process.

`tests/cursor-adapter.test.ts` keeps checking that the spawned profile
contains `(deny file-write*` and `(vnode-type SYMLINK)`. It also checks that
the profile contains `(subpath <canonical-root>)` as the deny region, not
only as an admitted filter side effect.

### D5 - Documentation names the corrected boundary without listing client paths

`docs/ARCHITECTURE.md` and `docs/AUTHENTICATION-AND-SECURITY.md` replace the
claim that the profile denies every machine-local `file-write*` outside the
admitted filters. The corrected sentence states that `sandbox-exec` denies
repository writes outside `write_scope` and symlink creation under the
canonical root, and that official-client operational writes outside that
root remain allowed so the already-authenticated client can start.

`docs/DECISIONS.md` adds a dated amendment: task `0039`'s whole-machine
positive-scope deny over-confined the official client; task `0041` keeps the
repository second opinion and returns machine-local operational writes to
`(allow default)`.

No document names a profile path, `auth.json`, or credential variable as a
sandbox allow rule.

## Work Completed

- Independent investigation (Cursor, Grok 4.6, this
  session), 2026-08-23: compared the four stopped task-`0031` transitions
  with the succeeding plan-review runs, read the current producer profile and
  `cursor-agent` launcher, and reproduced the producer argv under that
  profile. Wrote the decisions above. No product file was edited.
- Human-authorized same-session implementation (Cursor, Grok 4.6), 2026-08-23: rebuilt `producerWriteScopeSandboxProfile` so
  `file-write*` denial is "under the canonical root and not admitted" plus
  repo-scoped symlink denial, and added `(deny file-link (subpath <root>))`
  so creation-time `link(outside, admitted)` stays `EPERM`. Re-derived the
  Darwin suite and cursor producer-profile assertions. Amended
  `docs/ARCHITECTURE.md`, `docs/AUTHENTICATION-AND-SECURITY.md`, and
  `docs/DECISIONS.md` (D-037). Did not edit task `0031`. The owner also
  remounted planner and `reviewer.implementation` onto Cursor in a separate
  commit.

## Evidence

- Latest live stop, `transition-aaccb358-200c-4d4c-9cbc-b390a91a8d20`
  `status.json`: `state: stopped`, `reason_code: producer_failure`,
  `producer_diagnostic: {stage: exit_nonzero, exit_code: 1, timed_out: false,
  write_scope_code: null, adapter_phase: null, adapter_cause: null}`.
  `events.jsonl`: `producer_started` at `2026-08-23T10:55:21.622Z`,
  `terminal_stop` at `2026-08-23T10:55:25.394Z`.
- Parent plan review `run-876e541c-7e21-4568-8d2a-8f1193b08e08`:
  `verdict: pass`, `reason_code: review_passed`,
  `state: awaiting_implementer`, host `cursor`, model
  `claude-opus-5-thinking-high`. Reviewer spawn does not set
  `sandboxProfile`.
- Current profile builder: `src/adapters/producer-write-scope.ts`
  `producerWriteScopeSandboxProfile` denies `file-write*` unless the path
  matches an admitted repository filter.
- Current test that encodes that deny:
  `tests/producer-write-scope.test.ts`
  `"the sandbox denies a direct outside write and same-UID chmod of protected repository paths"`
  asserts `outside-write:EPERM` for a file created with
  `fs.mkdtemp(path.join(os.tmpdir(), ...))`.
- Reproduction, 2026-08-23, same profile over this repository's automatic
  write scope, no credential file read:
  - node write `$HOME/spartan-0041-probe.txt` → `home:EPERM`
  - node write `$TMPDIR/spartan-0041-probe.txt` → `tmp:EPERM`
  - node write `$HOME/.cursor/spartan-0041-probe.txt` → `cursor-dir:EPERM`
  - node write `src/.spartan-0041-probe.ts` → `src:OK` (deleted after)
  - `cursor-agent --help` under the profile exits 0 and prints
    `/dev/null: Operation not permitted` from launcher lines 5 and 31
  - exact `CURSOR_PRODUCER_ARGV_PREFIX` plus `--workspace <repo>` plus
    `--model claude-sonnet-5-thinking-high` under the profile: exit 1 in
    854 ms, stderr matches `Operation not permitted`, stdout empty
- `cursor-agent` launcher
  `~/.local/share/cursor-agent/versions/2026.08.11-e8db854/cursor-agent`
  redirects `command -v realpath` and a Node probe to `/dev/null`, then sets
  `NODE_COMPILE_CACHE` under `$HOME/Library/Caches`.
- Primary worktree at investigation time: `git status --short` named only
  `spartan/tasks/0031-say-how-to-resume-a-chain-a-failed-cycle-interrupted.md`.
- Post-fix confined probe, 2026-08-23, same automatic write scope, no
  credential file read:
  - node write `$HOME/spartan-0041-probe.txt` → `home:OK` (deleted after)
  - node write `$TMPDIR/spartan-0041-probe.txt` → `tmp:OK` (deleted after)
  - node write `/dev/null` → `dev-null:OK`
  - node write `AGENTS.md` → `agents:EPERM`
  - `cursor-agent --help` under the new profile exits 0 with no
    `/dev/null: Operation not permitted`
- Repository checks, 2026-08-23: `npm run typecheck` exited 0; `npm test`
  exited 0 with 344 passed and 0 failed; `git diff --check` exited 0.

## Review

Verdict: APPROVED

Findings:

- None recorded.

The owner authorized this host to implement the approved decisions in the
same session and skip an independent plan-review cycle because the automatic
implementer was the defect under repair.

## Blockers

None.

## Next Action

No work remains on this task. Validate the live `/spbridge` plan-pass
auto-chain on task `0031` after this change is committed and the local
`dist/` is rebuilt.

## Acceptance Criteria

- [x] D1: `docs/ARCHITECTURE.md` and
      `docs/AUTHENTICATION-AND-SECURITY.md` state that the Darwin producer
      `sandbox-exec` profile confines repository writes to `write_scope` and
      leaves official-client operational writes outside the canonical
      repository root allowed. They no longer claim that every machine-local
      `file-write*` is denied.
- [x] D1: `docs/DECISIONS.md` records a dated amendment that task `0039`'s
      whole-machine positive-scope deny over-confined the official client and
      that this task restores machine-local operational writes without
      widening repository write scope.
- [x] D2: a non-empty admitted scope profile denies `file-write*` only for
      the conjunction "under the canonical root and not an admitted filter"
      or the conjunction "under the canonical root and `vnode-type SYMLINK`".
      Empty admitted scope still emits `(deny file-write*)`.
- [x] D2: the profile interpolates only `sandboxPathLiteral` results for the
      canonical root and admitted paths. No test or source file adds a
      `$HOME`, `$TMPDIR`, or client-profile path to the profile.
- [x] D3: `applyProducerWriteScope`, producer argv, `childEnvironment`,
      snapshot policy, reason codes, and `producer_diagnostic` are unchanged
      except for the profile string D2 rebuilds.
- [x] D4: the real Darwin suite still proves an out-of-scope repository
      write, protected `chmod`, `node_modules` plant, and in-repo symlink
      creation are `EPERM`, and that admitted directory and exact-file
      writes succeed.
- [x] D4: the former `mkdtemp` "outside-write:EPERM" assertion is gone. New
      cases prove writes to `os.tmpdir()`, a `mkdtemp` under process `HOME`,
      and `/dev/null` succeed under the same profile that still denies
      `AGENTS.md`.
- [x] D4: `tests/cursor-adapter.test.ts` still requires `(deny file-write*`
      and `(vnode-type SYMLINK)` and also requires the canonical-root
      `(subpath ...)` deny region.
- [x] D5: no updated document lists a client-profile path, `auth.json`, or
      credential variable as a sandbox allow rule.
- [x] `npm run typecheck` and `npm test` exit 0.
- [x] The implementation commit names only this task's scope paths. The
      owner-requested host-binding remount is a separate commit. Task `0031`
      remains unstaged.

## Next Handoff

No outstanding handoff. The proposed review was consumed. Task 0041 is
complete. The identifiable follow-up is a human-started `/spbridge` planner
retry of task `0031` to validate the `reviewer.plan` to `implementer`
auto-chain after this sandbox fix.
