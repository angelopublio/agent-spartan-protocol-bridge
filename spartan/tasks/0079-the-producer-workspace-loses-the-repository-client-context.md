---
protocol: "1.1.0" # x-release-please-version
id: the-producer-workspace-loses-the-repository-client-context
created_at: 2026-09-11
status: active
phase: planning
task_type: planning
risk: high-impact
current_role: planner
next_role: planner
updated_at: 2026-09-11
handoff_id: HX-001
next_handoff_id: HX-002
---

# The producer workspace loses the repository's client context

## Objective

The Bridge runs the producer in a temporary directory outside every repository. A host launcher
that selects per-account configuration from the working directory therefore resolves the wrong
account, and the producer dies before writing anything. The reviewer adapters were already fixed
for this class; the Cursor producer was not.

## Context

Observed on 2026-09-11 in a managed repository whose client context differs from the machine
default. The plan review passed and the auto-chain started the implementer, which exited 1 after
4.4 seconds having written no product file. The same client, same model and same machine succeed
when invoked with the repository as the working directory.

The mechanism is four facts that only bite together:

- `src/core/workspace.ts:1135` — the producer workspace is `fs.mkdtemp` under `os.tmpdir()`, a
  location that belongs to no repository.
- `src/adapters/producer-write-scope.ts` — `applyProducerIsolation` *refuses* a workspace inside
  the repository with `confine_unavailable`, so the producer can never run with the repository as
  its working directory. The placement is deliberate, not incidental.
- `src/adapters/cursor.ts:707-714` — the spawn sets `cwd: input.workspace_root` and passes that
  same path as `--workspace`.
- `CURSOR_ENV_ALLOWLIST` forwards `PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL`, `TERM` and
  `AGENT_CLI_CREDENTIAL_STORE`. The Codex allowlist additionally forwards `CODEX_HOME` and
  `AGENT_PROFILES_REAL_HOME`; the Claude allowlist additionally forwards `CLAUDE_CONFIG_DIR`,
  `USER` and `AGENT_PROFILES_REAL_HOME`. Cursor forwards neither of the two that let a launcher
  skip its own working-directory resolution.

Forwarding `HOME` is not sufficient on its own, because a launcher of this class overwrites `HOME`
after it resolves. That is the same shape D-055 settled for the Codex reviewer when reviews moved
to a workspace working directory, and the same shape the Claude allowlist already accommodates.
This task is that decision reaching the one adapter it never reached.

**Why it stayed hidden.** In a repository whose client context *is* the machine default, the wrong
resolution and the right one coincide, so the auto-chain works. The defect only appears in a
repository belonging to a different context — which is exactly where adopting the Bridge matters.

## Scope

- `src/adapters/cursor.ts` — `CURSOR_ENV_ALLOWLIST`, and the producer spawn's `cwd`/`--workspace`
  pair at `:707-714`.
- `src/core/workspace.ts:1135` and the producer copy's contents — whether the copy carries the
  authority file that makes a working-directory resolver land correctly, and whether the placement
  itself should change.
- `src/core/workspace.ts:70-73` — `ImplementationReviewEnvelopeFile`, the existing mechanism that
  already carries `AGENTS.md` into a workspace for the reviewer.
- `src/adapters/producer-write-scope.ts` — only if the decision changes placement.
- `src/core/doctor.ts` — whether this is detectable before a round rather than after a failed one.
- `docs/DECISIONS.md` — one dated entry, and its relationship to D-055.
- Tests covering the producer spawn environment and the producer copy's contents.

## Out of Scope

- The producer diagnostic gap. The client wrote the reason to its stdout, the runner retained it
  (`retainStdout: true`) and `waitProducer` returned only `{ exitCode, timedOut }`. That is task
  `0073`, and it is what turned this diagnosis into six experiments.
- Reading, copying, storing or forwarding any credential or authentication file. The fix forwards
  configuration selectors only, exactly as the Codex and Claude allowlists already do.
- The plan-target scan's advisory tokens observed in the same runs. That is task `0074`.
- Changing which model or effort a binding declares. The failing account was the wrong account, not
  an exhausted one.

## Constraints

- A workspace inside the repository is refused for a structural reason, not a stylistic one: the
  sandbox profile allows writes under the workspace and then denies writes under the repository
  root, and the last matching rule wins. Any placement change must keep that deny effective.
- `.spartan-bridge/` is not a candidate location. A producer write there is a
  `runtime_state_violation` by design, and the directory is in `SKIPPED_DIR_NAMES`, so snapshots
  would not see the copy at all.
- Carrying an authority file into a producer copy the sandbox permits writing is a new surface. The
  merge must refuse a producer edit of that file, asserted by a test rather than assumed.
- The fix must not require the operator to export variables by hand before each round. A correction
  that works only when invoked a particular way has not fixed the auto-chain.
- **This repository cannot verify the fix, and a criterion that assumes it can is unsatisfiable.**
  Its declared client context is the machine default, so the wrong resolution and the right one
  coincide here and the defect does not reproduce at all; separately, the account this repository
  resolves has no usable balance for a producer round. Verification therefore needs a repository
  whose declared client context differs from the machine default *and* whose resolved account can
  complete a producer round. Criteria must be written so that the repository-local suite proves the
  mechanism — which selectors reach the child, what the producer copy holds, where the workspace is
  placed — while the end-to-end proof is a recorded observation from such a repository, carried
  back sanitized: counts, reason codes and state names, never a path, an alias, or an account
  detail.

## Decisions

To be settled by the planner round. Three candidate directions, for the reviewer to accept or
refuse:

- **(a) Carry the authority file into the producer copy.** A working-directory resolver of this
  class prefers a declared context over any path heuristic, so the copy resolves correctly from
  anywhere. The envelope mechanism that does this for the reviewer already exists. Smallest change,
  and the only candidate needing no operator action — but it is the one that adds the new surface
  named in Constraints.
- **(b) Forward the remaining launcher selectors**, mirroring what Codex and Claude already do.
  Closest to D-055, but it only helps when the invoking environment already carries them, and the
  Bridge is not launched through the launcher.
- **(c) Place the workspace where the repository's context still resolves.** Addresses the root
  cause most directly and is the largest change; it must satisfy the sandbox constraint above.

## Acceptance Criteria

To be derived from the decisions, last.

## Work Completed

Not started.

## Evidence

- Same client, same model, same machine, seconds apart: invoked with the repository as the working
  directory it succeeded in 3.3 s; invoked from a temporary directory outside the repository it
  exited 1 reporting an account-scoped usage limit. The working directory was the only difference,
  which is why two different accounts were reached.
- The failing transition: `state: stopped`, `reason_code: producer_failure`, `producer_diagnostic`
  of `stage: exit_nonzero`, `exit_code: 1`, `timed_out: false`, 4.4 s elapsed, no product file
  written, writer lock released.
- The preceding transition on the same artifact failed differently: it stopped with
  `reviewer_isolation_unavailable` after 3 m 43 s and carried no `producer_diagnostic` at all. That
  was task `0077`, and the contrast confirms it shipped: the capture no longer exhausts, and a stop
  now carries a diagnostic.
- Nine Bridge runs on that artifact, every one `review_kind: plan`. The auto-chain has never
  reached an implementation review in that repository.
- `spartan-bridge doctor` reports `binding implementer: adapter available` throughout. The producer
  preflight probes `--help` and runs `/usr/bin/true` under a permissive profile, so that line
  proves the executable and `sandbox-exec` exist and nothing about which account will be reached.
- The outer `sandbox-exec` profile is not implicated: the same invocation exits identically with
  and without it, because the profile restricts file writes only and its first clause is
  `(allow default)`.

## Review

Verdict: PENDING

Findings:

- None recorded.

## Blockers

No implementation blocker. One verification dependency, recorded in Constraints: the end-to-end
proof cannot be produced in this repository and must come from one whose client context differs
from the machine default, with an account able to complete a producer round. Plan the criteria so
that everything except that final observation is provable here.

The manual path is unaffected meanwhile: a human-started implementer round inside the managed
repository resolves correctly, and the mapped implementation review is dispatched by an adapter
that already forwards its own selector.

## Next Action

Plan the context fix and let the Bridge dispatch the mapped `reviewer.plan` against it.

## Next Handoff

```text
Recommended execution (human decides):
- Host: the host this repository binds to `planner`
- Role: planner
- Handoff: HX-002
- Invocation: `/spbridge`
```

```text
Open `spartan/tasks/0079-the-producer-workspace-loses-the-repository-client-context.md` (handoff HX-002).

Act as planner. Settle which of the three candidate directions closes the defect: carrying the
authority file into the producer copy, forwarding the remaining launcher selectors, or changing
where the workspace is placed. Establish on evidence whether a producer edit of a carried authority
file is refused by the merge, and how the sandbox deny over the repository root stays effective
under any placement change. Decide whether `doctor` can report this before a round instead of after
a failed one. Derive the acceptance criteria from those decisions, last.

Then let the Bridge dispatch the mapped `reviewer.plan` against this artifact and work the returned
findings in this same session, re-deriving every criterion whose decision a finding changes.

Return only the next handoff, or a completion notice if no work remains.
```
