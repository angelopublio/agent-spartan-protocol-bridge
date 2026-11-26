---
protocol: "1.1.1" # x-release-please-version
id: the-producer-sandbox-denies-every-git-command
created_at: 2026-09-14
status: active
phase: planning
task_type: planning
risk: high-impact
current_role: planner
next_role: planner
updated_at: 2026-09-14
handoff_id: none
next_handoff_id: HX-001
---

# The producer sandbox denies every git command

## Objective

An automatic producer can run a repository's git-dependent checks inside its isolated workspace:
`git init`, `add`, `status`, `diff`, `ls-files`, `cat-file`, a commit into a throwaway repository,
and the like. The owner's rule still holds: `push`, `fetch`, `pull` and `clone` are refused, and no
git operation writes to another repository.

## Context

Git opens `/dev/null` for reading and writing when it starts. The Darwin producer profile built by
`producerIsolatedSandboxProfile` in `src/adapters/producer-write-scope.ts` denies every write it
does not re-allow, and `/dev/null` is not re-allowed. So every git invocation in a producer dies
before doing anything (E-1). `D-037` had kept `/dev/null` writable; the allow-list-shaped profile of
`D-072` denies it again.

The cost showed on task `0081`. Its producer's `npm test` reported 26 git-dependent failures, its
implementation review ended `human_required`, and the checks had to be run by hand (E-4). Consumer
repositories run the same runtime (`D-078`), so any repository whose checks call git meets the same
stop.

Admitting `/dev/null` alone makes every git command work (E-1). That alone is unsafe today, because
it removes the only thing currently stopping a remote operation. The real boundaries are two
companion tasks, and this task lands only after both:

- task `0088` confines writes, so no git operation can write another repository or a file that
  runs later outside the sandbox;
- task `0089` confines the network, so no push, fetch or clone reaches a remote over any transport,
  whichever tool attempts it.

What remains for this task is local. A clone or fetch from a local path, or through the `ext::`
and `fd::` helpers, reads another repository without the network. Reads are unconfined by design,
so a producer could copy the same files with `cp`. Refusing local transports is therefore
consistency with the owner's rule and defense in depth, not a boundary. The plan must say so rather
than claim more.

## Scope

- `src/adapters/producer-write-scope.ts` — admitting `/dev/null`, and any clause that refuses local
  transports.
- `tests/producer-write-scope.test.ts` — expected clauses and regression cases.
- `src/adapters/codex.ts`, `src/adapters/cursor.ts`, `src/adapters/grok.ts` — only if a decision sets
  git hardening in the producer child's environment.
- `docs/AUTHENTICATION-AND-SECURITY.md` — the Darwin producer profile paragraph.
- `docs/DECISIONS.md` — one dated entry.
- This task file.

## Out of Scope

- Write confinement under `HOME` (task `0088`).
- Network confinement (task `0089`).
- Read confinement.
- Reviewer adapters and non-Darwin hosts.
- Changing `tests/repo-hygiene.test.ts`, which is the regression case, not a target.

## Constraints

- Owner rule, 2026-09-14: local git is admitted; `push`, `fetch`, `pull` and `clone` are not; and a
  producer started for one repository never writes to, or runs git against, another repository.
- Implementation starts only after tasks `0088` and `0089` are completed. Planning may proceed
  before then.
- Enforcement claims are honest. A layer that a producer's own children can undo, such as an
  environment variable or a git configuration value, is described as defense in depth, never as
  the boundary.
- The existing denies stay.
- No probe contacts a real remote. A remote in a probe is a local bare repository.
- Every probe quotes the profile text and the command it ran.

## Decisions

To be settled by the planner round.

- **D1 — How `/dev/null` is admitted.** A literal allow for `/dev/null` alone, or a wider device
  set, with evidence of what git and the repository's own checks open.
- **D2 — How local transports are refused.** Clone or fetch from a local path, and the `ext::` and
  `fd::` helpers. Candidates:
  - (a) `(deny process-exec …)` on `git-upload-pack`, `git-receive-pack`, `git-upload-archive` and
    the `git-remote-*` helpers under `git --exec-path`. Two points must be answered: `D-051` records
    post-resolution path matching, so a helper that is a link to the `git` binary may not be
    separable; and the exec path must be resolved before spawn;
  - (b) git configuration in the child environment, such as `protocol.allow=never`, which is
    defense in depth only;
  - (c) no refusal, with the reason recorded and the owner's approval.
- **D3 — Git hardening in the producer child.** Whether the child environment sets values such as
  `GIT_CONFIG_NOSYSTEM`, an empty global configuration or `protocol.allow`, with each described
  honestly as defense in depth.
- **D4 — The records.** What the security document and the decision entry say.

## Acceptance Criteria

To be derived from the decisions, last. The set must include:

- E-1's input in both directions: git runs under the new profile;
- `tests/repo-hygiene.test.ts` passes inside a producer workspace, and a producer's `npm test` shows
  no git-dependent failure;
- `git push` to a local bare repository outside the workspace is refused. Under task `0088` that
  refusal is a write denial;
- `git clone` and `git fetch` from a local path are refused, or D2's recorded exception applies;
- the HTTPS and SSH cases proven by task `0089`, re-run under this task's profile, are still refused.

## Work Completed

- 2026-09-14 — task created by Claude Code (`claude-opus-5`, effort high, Anthropic) at the owner's
  request. The round probed git under a profile shaped like the producer's (E-1), quoted the profile
  (E-2) and located git's transport programs (E-3).
- 2026-09-14 — rewritten the same day, before any commit, as the third of three tasks. The owner
  accepted splitting the work so that write confinement (`0088`) and network confinement (`0089`) are
  the boundaries, and this task admits local git only after both land.

## Evidence

- **E-1 — git dies on `/dev/null` under the producer's profile shape, and runs once it is admitted.**
  On 2026-09-14 the round ran `/usr/bin/sandbox-exec -p "$P" git --version` and
  `/usr/bin/sandbox-exec -p "$P" git init -q <tmp>/a`, with this profile:

  ```text
  P = (version 1)(allow default)(deny file-write*)(allow file-write* (subpath "<tmp>"))
  ```

  Both printed `fatal: could not open '/dev/null' for reading and writing: Operation not
  permitted`, and `<tmp>/a` received no `.git`. It then appended
  `(allow file-write* (literal "/dev/null"))` to `P`: `git --version` printed
  `git version 2.50.1 (Apple Git-155)`, and `git init -q <tmp>/b` exited 0, creating `<tmp>/b/.git`.
- **E-2 — the producer profile.** `producerIsolatedSandboxProfile` emits, in order:
  1. `(version 1)`, `(allow default)`, `(deny file-write*)`;
  2. write allows for `HOME` and `TMPDIR` when present, and for the workspace;
  3. a deny of symlink creation under the workspace;
  4. a deny of writes and hard links under the live repository root.

  It has no network or process-exec clause. The Codex, Cursor and Grok adapters import it.
- **E-3 — git's transport programs on this machine.** `git --exec-path` printed
  `/Library/Developer/CommandLineTools/usr/libexec/git-core`. It holds `git-receive-pack`,
  `git-remote-ext`, `git-remote-fd`, `git-remote-ftp`, `git-remote-ftps`, `git-remote-http`,
  `git-remote-https`, `git-upload-archive` and `git-upload-pack`. Other installations place these
  elsewhere.
- **E-4 — the cost today.** Task `0081`, E-15: inside the producer sandbox, the throwaway-repository
  test failed at `git init` with exit 128, and `npm test` reported 619 tests, 576 passing, 26
  failing and 17 skipped, every failure git-dependent. Implementation review run
  `run-5bbce424-59f8-4036-87e5-11adecff89bb` ended `human_required` on the missing repository-backed
  evidence.

## Review

Verdict: PENDING

Findings:

- None recorded.

## Blockers

Implementation waits for tasks `0088` and `0089` to complete. Planning does not.

## Next Action

A planning round settles D1–D4 with local probes. It derives the acceptance criteria from them,
including the cases listed there, and lets the Bridge dispatch the plan review.

## Next Handoff

```text
Recommended execution (human decides):
- Host: Claude Code — the `planner` binding in AGENTS.md
- Model and effort: claude-opus-5, effort high
- Role: planner
- Handoff: HX-001
- Permission: writable
- Invocation: `/spbridge` in a fresh session, passing the prompt block below as the argument — `spartan-bridge doctor` reports the `reviewer.plan` adapter available, so the Bridge dispatches the review
```

```text
Open `spartan/tasks/0087-the-producer-sandbox-denies-every-git-command.md` (handoff HX-001).

Act as planner. Settle D1-D4 with local probes that contact no real remote, and derive the acceptance criteria from them last; the round succeeds when git runs under the planned profile, every local transport case is refused or carries a recorded exception, and every criterion names the decision it follows from.
Run the relevant repository checks and update the same task file.

Return only the next handoff, or a completion notice if no work remains.
```
