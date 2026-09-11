---
protocol: "1.1.0" # x-release-please-version
id: the-test-suite-fails-only-when-a-human-runs-it
created_at: 2026-09-11
status: active
phase: planning
task_type: planning
risk: material
current_role: planner
next_role: planner
updated_at: 2026-09-11
handoff_id: HX-001
next_handoff_id: HX-002
---

# The test suite fails only when a human runs it

## Objective

`npm test` reports ten failures when a person runs it in a terminal and none when anything else
runs it — same commit, same code. The one reading a human trusts to accept work is the one that is
wrong, and it is wrong in the direction that invents defects rather than hiding them.

## Context

Observed on 2026-09-11 while closing task `0077` on its implementation-review human gate. The
gate existed precisely because neither the producer sandbox nor a read-only review could run the
suite, so a person had to. That person got 551 of 561 and a plausible story that the change under
review was at fault.

The mechanism is four facts that only bite together:

- Node's test runner sets `FORCE_COLOR=1` in each test-file subprocess when its own output is a
  terminal. Probed directly on Node v24.14.0: a one-test file printing `process.env.FORCE_COLOR`
  reports `"1"` under a pseudo-terminal and `undefined` off one.
- Four spawn helpers pass the parent environment straight through to the CLI child and add
  `NO_COLOR`: `tests/cli.test.ts:75`, `:338`, `:615`, and `tests/mcp.test.ts:202`, each shaped
  `env: { ...process.env, NO_COLOR: "1" }`.
- Node refuses to honor both and writes to the child's stderr:
  `Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.`, followed by the
  `--trace-warnings` line.
- Ten assertions compare that child's stderr bytes exactly, so the prefix fails them.

The ten are `tests/cli.test.ts` at `:404`, `:565`, `:689`, `:703`, `:1100`, `:1116`, `:1143`,
`:1157`, `:1234`, and `tests/mcp.test.ts` at `:807`. None of them exercises the code task `0077`
changed; they are stale-build, symlink-escape, and usage-error assertions.

`tests/detach.test.ts:63` writes the same `{ ...env, NO_COLOR: "1" }` shape and does not fail. That
is not obviously by design, and the planner should establish whether it is exposed and merely
unlucky to pass.

**Why this is worth a task rather than a note.** The cost is not the ten red lines; it is that the
suite lies to exactly the reader who has no other source of truth. On `0077` several minutes went
into proving the failures were environmental, and the alternative outcome — accepting the story
that the change was at fault, and sending a correct implementation back for another cycle — was
available the whole time. A gate that hands the human a false negative is worse than no gate.

## Scope

- `tests/cli.test.ts` — the three spawn helpers at `:75`, `:338`, `:615`, and the nine assertions
  that compare the child's stderr in full.
- `tests/mcp.test.ts` — the spawn helper at `:202` and the assertion at `:807`.
- `tests/detach.test.ts:63` — the same environment shape, to establish whether it is exposed.
- `tests/helpers.ts` — only if the fix belongs in one shared helper rather than at each call site.

## Out of Scope

- Changing what the CLI writes to stderr, or when. The product is correct here; the tests are.
- Relaxing the assertions to substring or prefix matching. That would trade the defect for a
  permanent loss of what they prove. See Constraints.
- D-031's stale-build predicate, message, and exit codes. Several of the ten assert them; none of
  them is what fails.
- The `waited_ms` normalization residual from `0077`. That is folded into task `0073`.
- CI configuration. CI has no terminal attached and already passes.

## Constraints

- The fix must not weaken what the assertions prove. They pin operator-visible stderr exactly,
  including ordering between the stale-build line and the error line; that is the property, and a
  looser matcher would stop defending it.
- The suite must produce identical results with and without a terminal attached. That equivalence
  is itself the thing being restored, so it has to be checkable rather than assumed.
- Whatever is decided must hold for a test that spawns the CLI and for one that spawns a nested
  `node --test`, since the runner is what injects the variable.

## Decisions

To be settled by the planner round. The candidate direction, for the reviewer to accept or refuse:
the spawn helpers stop inheriting the parent's color environment — deleting `FORCE_COLOR` in the
same place they set `NO_COLOR` — so the child's stderr is a function of the CLI alone. The planner
should settle whether any test legitimately needs the parent's value, and whether the deletion
belongs in one shared helper or at each of the four call sites.

## Acceptance Criteria

To be derived from the decisions, last.

## Work Completed

Not started.

## Evidence

- Same commit, two runs on 2026-09-11. `npm test` from a terminal: 561 tests, 551 pass, 10 fail,
  0 skip. `node --import tsx --test tests/*.test.ts` with stdout piped: 561 tests, 561 pass,
  0 fail.
- Narrowed to the two files: `node --import tsx --test tests/cli.test.ts tests/mcp.test.ts` piped
  is 60 tests, 60 pass, 0 fail; the same `tests/mcp.test.ts` under a pseudo-terminal reproduces
  both the warning and the failure.
- Runner attribution probed directly on Node v24.14.0 with a single-test file printing
  `process.env.FORCE_COLOR`: `"1"` under a pseudo-terminal, `undefined` off one.
- `git diff -U0` over the `NO_COLOR` lines of both files across task `0077` is empty, so the
  assertions and their environment shape predate that change.

## Review

Verdict: PENDING

Findings:

- None recorded.

## Blockers

None.

## Next Action

Plan the environment fix and let the Bridge dispatch the mapped `reviewer.plan` against it.

## Next Handoff

```text
Recommended execution (human decides):
- Host: the host this repository binds to `planner`
- Role: planner
- Handoff: HX-002
- Invocation: `/spbridge`
```

```text
Open `spartan/tasks/0078-the-test-suite-fails-only-when-a-human-runs-it.md` (handoff HX-002).

Act as planner. Settle how the CLI-spawning tests stop inheriting the runner's color environment
without weakening what their stderr assertions prove, whether the deletion belongs in one shared
helper or at each call site, and whether `tests/detach.test.ts` is exposed to the same shape.
Decide how the with-terminal and without-terminal equivalence is made checkable rather than
assumed. Derive the acceptance criteria from those decisions, last.

Then let the Bridge dispatch the mapped `reviewer.plan` against this artifact and work the returned
findings in this same session, re-deriving every criterion whose decision a finding changes.

Return only the next handoff, or a completion notice if no work remains.
```
