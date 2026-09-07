---
protocol: "1.1.0" # x-release-please-version
id: the-wait-loop-shows-no-chain-progress
created_at: 2026-09-02
status: completed
phase: complete
task_type: implementation
risk: material
current_role: human-operator
next_role: none
updated_at: 2026-09-02
handoff_id: HX-003
next_handoff_id: none
---

# The detached `wait` loop shows no chain progress, so operators abort a healthy run

## Objective

While a detached auto-chain is still advancing, `spartan-bridge wait` reports
*which phase* the chain is in — plan review, `producer_running`,
`producer_finished`, implementation review — and how long it has been in that
phase, not a bare `{ "state": "running" }`. An operator can tell a chain that is
working from one that is wedged without reading `.spartan-bridge/` by hand.

## Context

Three `/spbridge` sessions (`0027`, `0029`, `0054`) each stopped polling a
detached chain that was still healthy:

- On `0054` the driving session polled `wait` for ~10 minutes, saw only
  `{ "state": "running" }` on stdout and the `wait` command's own
  `dist/ is older than src/` line on stderr (that line is D-062 noise — `wait`
  warns and continues while the child pid is alive), decided the chain was
  wedged, and handed the operator a kill/rebuild/resume recovery. The Cursor
  implementer was in fact still inside its 45-minute producer window (D-058);
  the chain reached `completed` with both reviews `APPROVED` about two minutes
  after the session gave up.
- `0027` / `0029` on the board repo stopped at `awaiting_implementer` for the
  same reason — no visible signal that the successor transition was moving.

`waitForRun` already reads the invocation pid, the plan run status, and the
successor transition on every poll. The transition status document carries
`state` (`producer_running` / `producer_finished` / `reviewing` / `completed` /
`stopped`), `updated_at`, and `linked_review_run_ids`. None of that reaches the
`{ state: "running" }` line at `src/cli/main.ts:473`.

## Scope

- `src/cli/detach.ts` (`waitForRun` / `WaitOutcome`)
  - Every `{ done: false }` branch carries `phase` and `phase_since` per D1/D2.
  - A small helper resolves `(phase, phase_since)` once per poll from the same
    records `waitForRun` already loads (no extra I/O).
- `src/cli/main.ts` (the `wait` loop, ~460-477)
  - The non-terminal branch prints
    `{ "state": "running", "run_id": ..., "phase": ..., "phase_since": ... }`
    instead of the bare object. Still one line, still exits 0 within the
    timeout, still a loop the SKILL drives.
- `agent-skill/skills/spbridge/SKILL.md` (step 4)
  - One sentence: a `running` document whose `phase` keeps changing (or whose
    `phase_since` is recent) is a chain making progress — keep looping; do not
    treat a long total elapsed time as a stall on its own.
- `docs/ROUTING-AND-WORKFLOWS.md` (the D-054 detach section)
  - Note the `phase` and `phase_since` fields on the `running` document.
- Tests: `tests/detach.test.ts` (`waitForRun` returns phase on a non-terminal
  poll for each D1 branch), `tests/cli.test.ts` (the `wait` loop prints `phase`
  and `phase_since` on the `running` line).

## Out of Scope

- Changing when the chain is *terminal* (D-059 close-out, D-062 `stale_build`,
  the post-`0058` dead-pid + linked-run rules) — only the non-terminal line.
- A progress stream / percentage / ETA. One phase label per poll.
- Killing or auto-recovering a wedged chain. `resume` already covers that; this
  task only makes "wedged vs working" visible.
- Reducing the D-058 producer timeout.

## Constraints

- English artifact.
- `wait` stays a liveness follower — it reads records, never writes, never
  refuses on its own `src/`-vs-`dist/` check.
- The `running` document stays a single line and a superset of today's shape
  (`state` and `run_id` unchanged) so an existing SKILL loop still parses it.
- `schema_version` unchanged; `npm run typecheck` / `npm run build` clean;
  `npm test` no new failure.

## Decisions

- **D1 — `phase` source and precedence** (pinned against `waitForRun` branches
  in `src/cli/detach.ts`):
  1. When `runStatus.state === "awaiting_implementer"` and
     `findSuccessorTransition` returns a transition whose `state` is not
     `completed` or `stopped`: `phase` = `transition.state` (a
     `TransitionState` such as `producer_running`, `producer_finished`, or
     `reviewing`). This is the successor-chaining path at lines 218-227; it
     supersedes the sealed plan-run label so operators see movement past
     `awaiting_implementer`.
  2. When `runStatus !== null` and branch 1 does not apply: `phase` =
     `runStatus.state` (a `RunState` — `requested`, `policy_resolved`,
     `reviewing`, or `awaiting_implementer` on the gap before a transition
     record exists at lines 220-222).
  3. When `runStatus === null` and the invocation pid is alive (admission,
     lines 193-197): `phase` = `"requested"` as a synthetic admission label —
     the run directory does not exist yet, so there is no `StatusDocument.state`
     to read.
- **D2 — include `phase_since`**: every non-terminal `{ done: false }` also
  carries `phase_since`, an ISO-8601 timestamp from the same record that
  supplied `phase`: `transition.updated_at` in branch 1, `runStatus.updated_at`
  in branch 2, `invocation.created_at` in branch 3. Operators can read "in
  `producer_running` since 11:31" without inferring from total poll elapsed
  time.
- **D3 — SKILL wording**: step 4 states that a `running` document whose `phase`
  changes between polls (or whose `phase_since` is recent) signals a healthy
  chain — keep looping; total wall-clock elapsed time alone is not a stall.
- **D4 — parse-compatible superset**: the `running` JSON line keeps
  `"state": "running"` and `"run_id"` exactly as today (`main.ts:473`); it adds
  only `phase` (string) and `phase_since` (string). Existing loops that check
  `parsed.state === "running"` and continue (e.g. `tests/detach.test.ts:148`)
  remain valid without change.

## Acceptance Criteria

- [x] (D1) `waitForRun` non-terminal polls return `phase` per the three-branch
      precedence: a live non-terminal successor transition → `transition.state`;
      a plan run with no qualifying transition → `runStatus.state`; admission
      (no run dir, alive pid) → `"requested"`. `tests/detach.test.ts` covers
      each branch.
- [x] (D2) the same non-terminal polls return `phase_since` from the matching
      record (`transition.updated_at`, `runStatus.updated_at`, or
      `invocation.created_at`); `tests/detach.test.ts` asserts it.
- [x] (D1, D2) the `wait` loop's non-terminal line is
      `{ "state": "running", "run_id": ..., "phase": ..., "phase_since": ... }`;
      `tests/cli.test.ts` asserts both new fields.
- [x] (D3) `agent-skill/skills/spbridge/SKILL.md` step 4 tells the operator
      that a changing `phase` (or recent `phase_since`) is progress and total
      elapsed time alone is not a stall.
- [x] `docs/ROUTING-AND-WORKFLOWS.md` D-054 section notes `phase` and
      `phase_since` on the `running` document.
- [x] (D4) no change to terminal documents or `schema_version`; `npm run
      typecheck` / `npm run build` clean; `npm test` adds no new failure.

## Work Completed

- 2026-09-02: task created after the `0054` `/spbridge` auto-chain — the first
  fully successful auto-chain in the bridge repo — was misread as wedged by its
  driving session and abandoned ~2 minutes before it reached `completed`. Same
  premature-abort shape as board `0027` / `0029`.
- 2026-09-02: planner refined D1 (phase source/precedence pinned to
  `waitForRun` branches), closed D2 (`phase_since` adopted), confirmed D4
  (parse-compatible superset of `{ state, run_id }`), verified every named
  scope path exists in the checkout.
- 2026-09-02 (implementer, approved plan `run-6f082f17`): implemented D1–D4 —
  `resolveWaitPhase` / `waitNotDone` in `src/cli/detach.ts`; `wait` loop prints
  `phase` and `phase_since` on the running line in `src/cli/main.ts`; SKILL.md
  step 4 progress sentence; `docs/ROUTING-AND-WORKFLOWS.md` D-054 field note;
  five new/extended tests in `tests/detach.test.ts` (all three D1 branches plus
  `phase_since`) and `tests/cli.test.ts` (running-line shape).

## Evidence

- `npm run typecheck` (`node node_modules/typescript/bin/tsc --noEmit`) exit 0.
- `npm run build` (`tsc --outDir /tmp/spartan-bridge-build-0062`) exit 0 — local
  `dist/` is read-only in this environment; compile succeeds to a writable out
  dir.
- `node --import tsx --test tests/detach.test.ts tests/cli.test.ts` — 54/54
  pass (includes all new phase / `phase_since` cases and `wait prints phase and
  phase_since on the running line`).
- `node --import tsx --test tests/*.test.ts` — 440 tests, 429 pass; 11 failures
  in `producer-write-scope`, `doctor`, and `manage-install` suites (environment /
  sandbox flakes, unchanged by this slice).
- `spartan-bridge doctor --repo .` — `binding reviewer.implementation: adapter
  available; launcher=claude-plan-reviewer-v1`.
- Sample non-terminal line shape:
  `{"state":"running","run_id":"run-…","phase":"producer_running","phase_since":"2026-09-02T11:31:40.000Z"}`.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-6f082f17-3fdc-4b77-ac5b-9ee83d69ae6d execution_id=exec-5b521f64-ea18-48ba-8216-724f20b407ab review_kind=plan verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-sonnet-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:20fcfa7c8df758f5b260cdddb5dfbf86c1d202fcecff22e1ed15e24e6cabf2e0 task_hash=sha256:81dbf969cd76fb84239644f52377ca7cd4564c73b016dabaec27985da60a217a agents_hash=sha256:5b0538f788aa238a0f4e3edc1477bc42f67c2e71fee4bf230a3cfe394d51eeff timestamp=2026-09-02T12:02:02.115Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-d8bccaf4-d0da-4282-8c81-e3acae063dc5 execution_id=exec-db27f72e-3c54-487c-962b-7bac1597aae3 review_kind=implementation verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-sonnet-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:1432cf4ad657ba8b32cb1751f04ef520e7ecebe5fcb14dec11a3dca63243ff05 task_hash=sha256:e2def170c3b606049026153cd62c950f8c9dbd19eaa0111d96f0eeadb3a99c15 agents_hash=sha256:5b0538f788aa238a0f4e3edc1477bc42f67c2e71fee4bf230a3cfe394d51eeff timestamp=2026-09-02T12:10:19.785Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None. Touches `detach.ts` / `main.ts` / SKILL.md — sequence near `0060`.

## Next Action

None. Auto-chain complete (2nd fully successful in the bridge repo): plan review
APPROVED (`run-6f082f17`), Cursor implementer, implementation review APPROVED
with no findings (`run-d8bccaf4`), terminal close-out fired. Verified by the
human operator: `npm run typecheck` / `npm run build` exit 0; `npm test`
440/440. Committed and pushed. Follow-up landed separately: a `postbuild`
`chmod +x dist/cli/main.js` so the linked `spartan-bridge` bin stops losing its
executable bit on every `tsc` run (the `permission denied` seen here and in
`0031` / `0057` / `0059` / `0054`).
## Next Handoff

No outstanding handoff. The proposed review was consumed.
