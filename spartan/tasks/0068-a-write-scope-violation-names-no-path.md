---
protocol: "1.1.0" # x-release-please-version
id: a-write-scope-violation-names-no-path
created_at: 2026-09-03
status: active
phase: planning
task_type: planning
risk: material
current_role: planner
next_role: planner
updated_at: 2026-09-12
handoff_id: none
next_handoff_id: HX-001
---

# A `write_scope_violation` stop names no path

## Objective

When the producer write-scope guard stops a producer round because the child
mutated a path outside the admitted write scope, the terminal transition record
names *which* path — the same way a refused review write names its rule since
tasks `0057` / `0061`, and a `producer_declaration_invalid` stop names its rule
since task `0063`. An operator reading `wait` output or `status.json` knows what
the producer touched without re-running anything.

## Context

Task `0067` demoted the pre-spawn plan-target scan to an advisory: after a
passed plan review, a plan that merely mentions `AGENTS.md` in prose no longer
stops the auto-chain. The producer write-scope guard is now the sole boundary
for those paths, and a genuine out-of-scope write terminates as
`write_scope_violation`.

The `0067` implementation review recorded this as an `info` finding
(`VIOLATION_NAMES_NO_PATH`, `run-35668b16`), and the `0067` D2 acceptance
criterion was re-derived to state the limitation rather than claim a guarantee
the code does not make:

> The offending path is named on that stop only when the advisory
> `unwritable_plan_targets` list happens to contain it; this task does not put
> the path on the `write_scope_violation` record.

That accidental naming is exactly what `0067` made less reliable. Before `0067`
a plan that named an out-of-scope path stopped *before* the producer ran, so the
token list was the record. Now the producer runs, and the token list is an
advisory about what the *plan* mentioned — not about what the producer actually
wrote. A violation whose path was never mentioned in the plan is recorded with
nothing identifying it at all.

Current shape:

- `producerDiffViolatesScope` (`src/core/transition.ts`) walks the post-child
  snapshot diff and returns a bare `boolean`. The entry that tripped it is
  discarded at the `return true`.
- The stop site (`src/core/transition.ts:791`) is
  `return { kind: "stop", reason: "write_scope_violation", diagnostic: null };`
- `ProducerDiagnostic` (`src/core/contracts.ts`) is the closed seven-key record
  from D-036 and carries `write_scope_code: ProducerWriteScopeFailure | null`,
  a closed enum — it has no field for a path and, by D-036, must not gain a
  free-text one.
- `unwritable_plan_targets` already demonstrates the accepted shape for a
  Bridge-owned path list on a transition: `string[] | null`, normalized posix
  tokens, whitelisted through `serializeUnwritablePlanTargets`
  (`src/core/serialize.ts:244`), and explicitly *not* `producer_diagnostic`.

The same argument that justified `declaration_invalid_detail` in `0063` applies
here: the operator should not have to diff the guard to learn what it caught.

## Scope

- `src/core/transition.ts`
  - `producerDiffViolatesScope`: return the offending entries (or the first one)
    instead of a bare boolean, and thread them to the stop.
  - The `write_scope_violation` stop records them.
- `src/core/contracts.ts`
  - An additive nullable field on the transition status and event documents for
    the offending path(s). `SCHEMA_VERSION` stays `2`, per the `0063` / `0066`
    additive-field precedent.
- `src/core/serialize.ts`
  - A whitelisting serializer in the shape of `serializeUnwritablePlanTargets`;
    a missing or malformed value normalizes to `null` on parse.
- `src/cli/main.ts` / `src/cli/detach.ts`
  - The terminal line and the terminal transition document surface the field.
- `agent-skill/skills/spbridge/SKILL.md`
  - Step 5: quote the field when non-null, as with `declaration_invalid_detail`
    and `unwritable_plan_targets`.
- `docs/DECISIONS.md`, `docs/AUTHENTICATION-AND-SECURITY.md`
  - Record the field and its classification: Bridge-owned normalized posix paths
    observed in the Bridge's own snapshot diff, never provider output.
- Tests: `tests/transition.test.ts`, `tests/serialize.test.ts`,
  `tests/cli.test.ts`, `tests/detach.test.ts`, `tests/spbridge-skill.test.ts`.

## Out of Scope

- `runtime_state_violation` (`src/core/transition.ts:787`), which has the same
  shape. Decide in D3 whether to cover it here or leave it; do not silently
  widen.
- Any change to `ProducerDiagnostic`. D-036 seals it as a closed seven-key
  record and this path is not one of its keys.
- Relaxing, re-tightening, or otherwise revisiting the `0067` advisory scan.
- Naming the path on a *review* write refusal — that is `0057` / `0061`, shipped.

## Constraints

- English artifact.
- The persisted value is Bridge-owned: paths come from the Bridge's own
  `snapshotDiff` over the repository worktree, already normalized posix, never
  from provider stdout, stderr, or a prompt.
- A path is not a secret, but the field is still bounded: decide a cap on how
  many entries are persisted, in the spirit of `OUTPUT_EXCERPT_CAP_BYTES`.
- `SCHEMA_VERSION` stays `2`; a missing key or an out-of-shape value normalizes
  to `null` on parse, so an older document still reads.
- `npm run typecheck` / `npm run build` clean; `npm test` no new failure.

## Decisions

- **D1 (open) — the field's name, shape, and cap.** A single first-offender
  string, or a bounded list in the shape of `unwritable_plan_targets`? A list
  is more useful for a producer that wrote several paths and matches an existing
  precedent; a single value is smaller. Pin the name, the type, the cap, and the
  ordering rule (snapshot-diff order is deterministic).
- **D2 (open) — where the entries are captured.** `producerDiffViolatesScope`
  currently returns `boolean` and is called once. Changing its return type is
  the obvious move; confirm no other caller depends on the boolean, and keep the
  symlink / `other`-kind branch distinguishable from the out-of-scope branch, or
  decide that they collapse.
- **D3 (open) — `runtime_state_violation`.** The stop immediately above has the
  identical defect. Cover it in the same field, give it its own, or leave it and
  say so.
- **D4 (open) — surfacing.** `formatTransitionTerminalLine` already appends
  ` targets=` for `unwritable_plan_targets` and ` detail=` for
  `declaration_invalid_detail`. Pin the token for this field and confirm the
  three can appear together without the line becoming unreadable.

## Acceptance Criteria

Derive these from the decisions once D1–D4 are pinned; do not write them before
the decisions settle.

## Work Completed

- 2026-09-03 (human-operator, Claude Code, claude-opus-5): queued from the
  `0067` implementation-review finding `VIOLATION_NAMES_NO_PATH` (`run-35668b16`,
  info severity) after `0067` shipped in `dcf89d3`. Verified against `main`
  that `producerDiffViolatesScope` still returns a bare boolean, that the stop
  at `src/core/transition.ts:791` passes `diagnostic: null`, and that
  `ProducerDiagnostic` has no path-shaped key.
- 2026-09-12 (human-operator, Claude Code, claude-opus-5): recorded three
  same-day occurrences in Evidence and the dependency they create for task
  `0079`. Read from terminal transition records in this checkout and from a
  redacted cross-repository summary; no decision pinned and no code changed.

## Evidence

- `src/core/transition.ts:791` — `return { kind: "stop", reason:
  "write_scope_violation", diagnostic: null };`
- `src/core/transition.ts:787` — the identical shape for
  `runtime_state_violation`.
- `src/core/contracts.ts` — `ProducerDiagnostic` keys: `stage`, `exit_code`,
  `timed_out`, `write_scope_code`, `adapter_phase`, `adapter_cause`,
  `waited_ms`. No path field; D-036 forbids a free-text one.
- `src/core/serialize.ts:244` — `serializeUnwritablePlanTargets`, the precedent
  for a whitelisted Bridge-owned path list on a transition document.
- `spartan/tasks/0067-…md` `## Review` — the `VIOLATION_NAMES_NO_PATH` finding,
  and the re-derived D2 criterion that states the limitation.
- **Three occurrences on 2026-09-12, none naming a path.** Read from terminal
  transition records; the two in a private consumer repository are cited by
  id, reason code and timings only, per the rule that a run in another
  repository carries no path, alias or host across.

  | Repository | Transition | Producer time | `unwritable_plan_targets` |
  | --- | --- | --- | --- |
  | this one | `transition-7ff5aef6-0026-4e9d-bef3-11b6b5c008b2` | 12m56s | 5 tokens |
  | consumer | `transition-1683c04d-250e-4f0d-a816-fe1a17e0d6d2` | 4m02s | 3 tokens |
  | consumer | `transition-409202ce-69e7-4fbe-bee1-96a597cf6385` | 14m07s | 2 tokens |

  Roughly thirty-one minutes of producer execution in one day. Each record
  carries four events — `authorization`, `lock_acquired`, `producer_started`,
  `terminal_stop` — `producer_diagnostic: null`, and no field identifying what
  the child actually wrote. In this repository's own case the advisory listed
  `spartan-bridge/config.yaml`, `AGENTS.md`, `node_modules/.cache/`, `.next/`
  and `dist/`; that list is what the plan mentioned, not what the producer
  wrote, so it does not identify the violation even where it happens to
  overlap.
- **The cost compounds into another task.** All five auto-chain transitions in
  that consumer repository are `stopped` with `linked_review_run_ids: []`;
  none reached an implementation review. Task `0079`'s AC-16 needs exactly
  such an observation from a repository whose declared client context differs
  from the machine default, so it cannot be recorded until a chain there gets
  past the producer guard — and the operator cannot find out why it does not,
  because the stop names nothing. This task gates `0079`.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: PENDING
<!-- spartan-bridge:review:plan:end -->

## Blockers

None. `0067` is on `main` (`dcf89d3`), so the advisory scan no longer stops the
auto-chain and this task's own plan may mention `AGENTS.md` freely.

## Next Action

A planner round through `/spbridge`: pin D1's field name, shape and cap, decide
D2's capture point, decide D3's `runtime_state_violation` disposition, pin D4's
terminal-line token, verify every named path, then let the Bridge dispatch the
plan review.

## Next Handoff

```text
Recommended execution (human decides):
- Host: Claude Code (AGENTS.md binds planner to Claude Code; fresh session)
- Model and effort: claude-opus-5 at effort high
- Role: planner
- Handoff: HX-001
- Permission: writable
- Invocation: /spbridge, passing the prompt block below as the argument
```

```text
Open `spartan/tasks/0068-a-write-scope-violation-names-no-path.md` (handoff HX-001).

Act as planner. Refine this plan against `src/core/transition.ts` (`producerDiffViolatesScope` and the `write_scope_violation` / `runtime_state_violation` stops), `src/core/contracts.ts` (`ProducerDiagnostic`, `TransitionStatusDocument`, `TransitionEventDocument`, `SCHEMA_VERSION`), `src/core/serialize.ts` (`serializeUnwritablePlanTargets` as the precedent), `src/cli/main.ts` (`formatTransitionTerminalLine`), `src/cli/detach.ts`, and `agent-skill/skills/spbridge/SKILL.md` step 5: pin D1's field name, type and cap, decide D2's capture point in `producerDiffViolatesScope`, decide D3's `runtime_state_violation` disposition, pin D4's terminal-line token, and verify every named path exists. Follow the `0063` `declaration_invalid_detail` pattern for the additive field and keep `ProducerDiagnostic` sealed per D-036. Keep `## Review` as the `Verdict: PENDING` placeholder and `phase: planning`.

Then let the Bridge dispatch the plan review.
```
