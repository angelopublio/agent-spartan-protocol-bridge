---
protocol: "1.1.0" # x-release-please-version
id: a-stale-dist-must-not-hang-the-detached-chain
created_at: 2026-09-02
status: completed
phase: complete
task_type: planning
risk: material
current_role: human-operator
next_role: none
updated_at: 2026-09-02
handoff_id: none
next_handoff_id: none
---

# A stale `dist/` must not hang the detached chain

## Objective

When a detached `review` chain hits `dist/ is older than src/` mid-run, the
`wait` loop reports a terminal error and the transition stops with a named
reason — it does not report `{ "state": "running" }` forever while nothing
progresses. Dogfooding the Bridge on its own repo (rebuild `src/` → `dist/`
goes stale, or the global `spartan-bridge` bin loses its executable bit after a
`tsc` rebuild) stays legible instead of looking like a hang.

## Context

Observed on bridge tasks `0031`, `0057`, and `0059` (all `/spbridge` runs on
this repo):

- The refuse for a stale build already exists: `review` and `mcp-stdio` write
  `dist/ is older than src/; run npm run build` to stderr, exit 1, and create
  no run (task `0028`). That is correct for the **first** invocation.
- But a **detached** continuation (`--after-run --detach`, or the auto-chain's
  own foreground successor spawning a fresh `review` for an implementation
  review) can hit the same stale-`dist` refuse *after* the chain started. The
  `0059` session's `wait` loop then printed
  `dist/ is older than src/; run npm run build` interleaved with
  `{ "state": "running" }` for minutes — `wait` never returned a terminal
  document, and the operator could not tell the chain had stalled.
- Separately, `spartan-bridge` on `PATH` (an npm-linked symlink to
  `dist/cli/main.js`) intermittently returned `permission denied` /
  `spartan-bridge not found` mid-session on `0057` and `0059` — a `tsc` rebuild
  that recreates `dist/cli/main.js` drops the executable bit the link relied
  on. The SKILL's `node dist/cli/main.js` fallback covered it, but only after
  the operator noticed.

Neither is a Bridge protocol defect. Both are dogfooding ergonomics: the Bridge
is unusually likely to be run from a checkout whose `dist/` is a moving target.

## Scope

- `src/core/detach.ts` (`waitForRun`) / `src/cli/main.ts` (`wait`)
  - When the detached child's pid is dead **and** no run advanced (or the child
    is alive but its `detach.log` tail shows the stale-`dist` refuse), `wait`
    returns a terminal document with a clear message
    (`error: the detached chain refused to start — dist/ is older than src/; run npm run build`),
    not an endless `{ "state": "running" }`. A bounded number of consecutive
    `running` results with no state change and a dead pid is itself terminal.
- `src/core/transition.ts`
  - If a foreground successor `review` (implementation review dispatch) exits
    on the stale-`dist` refuse, the transition stops with a named
    `reason_code` (`stale_build` or reuse `adapter_error` with a diagnostic)
    rather than leaving the run at `awaiting_implementer` / `reviewing`.
- `agent-skill/skills/spbridge/SKILL.md`
  - Step 4: if `wait` reports the stale-`dist` terminal, the operator runs
    `npm run build` and re-invokes `/spbridge`; the detached chain is not
    resumed with `--after-run` (a rebuild is not a review cycle).
- `docs/DOGFOODING.md` (or `docs/INSTALL-DEV.md`)
  - One paragraph: run `/spbridge` on this repo from a **built** `dist/`; a
    `git pull` or a `src/` edit invalidates it. If the global `spartan-bridge`
    command breaks after a build, `npm link` again or invoke
    `node dist/cli/main.js` (the SKILL already falls back to this).
- Tests: `tests/detach.test.ts` (`waitForRun` returns a terminal document for a
  dead pid + no-progress + a stale-`dist` `detach.log` tail),
  `tests/transition.test.ts` (a successor `review` that exits stale-`dist`
  stops the transition with a named reason).

## Out of Scope

- Removing or relaxing the task `0028` stale-build refuse. It stays; this task
  only stops it from *hanging* a detached chain.
- Making `tsc` preserve the executable bit, or changing how `spartan-bridge` is
  installed. Documentation only for the global-bin fragility.
- Auto-running `npm run build` from the Bridge. The operator runs it.
- The `0058` close-the-loop work (separate: a *successful* chain not closing).

## Constraints

- English artifact.
- The `0028` refuse message and exit code on a first `review` are unchanged.
- `wait` must still return promptly on its own `--timeout-ms`; the new terminal
  is reached only when the chain is provably not progressing.
- `npm run typecheck` / `npm run build` clean; `npm test` no new failure.

## Decisions

- **D1 (open) — `wait` has a "not progressing" terminal.** A dead detached pid
  plus N consecutive `running` results with no run/transition state change is a
  terminal `{ done: true }` with a diagnostic, not perpetual `running`.
- **D2 (open) — the stale-`dist` refuse in a successor `review` stops the
  transition** with a named reason instead of a silent non-advance.
- **D3 (open) — SKILL + docs tell the operator to rebuild and re-invoke**, not
  `--after-run`.

## Acceptance Criteria

- [ ] (D1) A `waitForRun` case: dead detached pid, no run directory or a run
      stuck `requested`, and a `detach.log` tail containing
      `dist/ is older than src/` → returns a terminal document naming the stale
      build; `wait` prints it and exits non-zero.
- [ ] (D2) A successor `review` that exits on the stale-`dist` refuse leaves
      the transition `stopped` with a named `reason_code` and a diagnostic; a
      `tests/transition.test.ts` case covers it.
- [ ] (D3) `agent-skill/skills/spbridge/SKILL.md` step 4 handles the
      stale-`dist` terminal (rebuild + re-invoke, not `--after-run`);
      `docs/DOGFOODING.md` (or `INSTALL-DEV.md`) carries the built-`dist` /
      global-bin note.
- [ ] The `0028` first-`review` refuse (message, exit 1, no run) is unchanged;
      an existing test still proves it.
- [ ] `npm run typecheck` / `npm run build` clean; `npm test` adds no new
      failure.

## Work Completed

- 2026-09-02: task created after three `/spbridge` runs on this repo
  (`0031`, `0057`, `0059`) each hit `dist/ is older than src/` mid-chain.
- 2026-09-02: implemented directly (dogfooding-loop friction task,
  owner-approved, no `/spbridge` round; Grok-reviewed design).
  D1 — `ReasonCode` += `stale_build`; `waitForRun` reads the dead child's
  `<run-id>.detach.log` tail and, on the stale-build marker, prints a terminal
  `{ document: "wait", state: "stopped", reason_code: "stale_build" }` (exit 1)
  instead of the generic "never created a run" line.
  D2 — **narrowed out**: the successor implementation review runs in-process
  (`transition.ts` → `runReview`, not a CLI child), so a mid-chain stale `dist/`
  cannot stop it. Recorded in D-062.
  D3 — `agent-skill/skills/spbridge/SKILL.md` step 4 handles the `stale_build`
  terminal (rebuild + re-invoke, not `--after-run`); README gains a
  "Dogfooding the Bridge on this checkout" section covering the built-`dist/`
  requirement and the lost-executable-bit recovery.
  D-062 recorded. Evidence: `npm run typecheck` / `npm run build` exit 0;
  `npm test` 434/434 (+1). Task 0028 first-`review` refuse unchanged.

## Review

Verdict: APPROVED (owner sign-off — implemented directly, no Bridge plan review)

Findings:

- None recorded.

## Blockers

None.

## Next Action

None. Implemented and shipped 2026-09-02; `npm test` 434/434. D-062 recorded.

## Next Handoff

No outstanding handoff. The task is complete.
