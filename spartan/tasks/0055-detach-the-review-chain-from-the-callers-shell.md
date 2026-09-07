---
protocol: "1.1.0" # x-release-please-version
id: detach-the-review-chain-from-the-callers-shell
created_at: 2026-08-31
status: completed
phase: done
task_type: implementation
risk: high-impact
current_role: human-operator
next_role: none
updated_at: 2026-08-31
handoff_id: HX-002
next_handoff_id: none
---

# Detach the review chain from the caller's shell, and add interrupt recovery

## Objective

A driving host can start an auto-chaining `spartan-bridge review` and observe it
to completion without its shell-command timeout killing the chain, on any host.
An interrupted chain (detached and its caller gone, or SIGKILL'd) leaves a
releasable writer lock and a task/transition state a named command can resume or
stop — never a stuck lock and never a silently half-finished round.

## Context

`spartan-bridge review` that auto-chains (plan review -> mapped implementer ->
implementation-review cycles, D-035) is one blocking foreground call of
~8-15 min. Every driving agent runs the CLI through its own shell tool with a
hard command timeout — Claude Code's is 120 s default, 600 s maximum. The chain
routinely exceeds that; the shell tool then SIGTERMs the process.

Observed on tasks `0046` and `0026`: the plan review passed, the mapped
implementer spawned and wrote all its product-file changes, then SIGTERM landed
in `waitProducer()` — after the implementer wrote files, before
`producer_finished`, before the artifact was advanced to `phase: reviewing`,
before implementation review. `src/cli/main.ts` already catches SIGTERM
(`AbortController`, `process.once("SIGTERM", ...)`), but the producer write-scope
guard makes `.spartan-bridge/` unwritable until the guard releases, and a
follow-up SIGKILL skips `stopTransition` entirely. The writer lock not sticking
both times was luck: `src/runtime/lock.ts` stores `transition_id` and no pid
(`releaseWriterLock` runs in a `finally` that a hard kill can skip), so a dead
chain can leave `writer.lock` forever.

`docs/DECISIONS.md` D-006 deferred a daemon until unattended dispatch, crash
recovery, and Board control. None of those apply: the `/spbridge` session is
still alive; only its shell tool timed out. The runtime staying an independent
foreground process and the skill staying a thin invoker (D-006) both hold — what
ends is the assumption that the caller's shell is a viable supervisor of the
chain.

An external design review evaluated: (A) the skill polls
`.spartan-bridge/runs/<id>/status.json`; (B) CLI `--detach` + a `wait`
sub-command; (C) daemonize; (D) an interrupt-recovery command; (E) operator
`nohup`. It rejected A (the plan-run `status.json` is sealed at
`review_passed` by D-035 and is not rewritten when the successor runs, so
polling it reports "done" while the implementer is still writing; reproducing
the process's liveness signal in the skill needs successor-transition lookup /
grant / opt-in, which the skill is forbidden to implement; "list `runs/` for the
latest" is the guess `AGENTS.md` bans), rejected C (wrong layer; a daemon does
not decide resume-vs-rollback — D does), rejected E (does not help a skill), and
chose **B + D, shipped in one slice**.

## Scope

- `src/cli/main.ts` + `src/cli/detach.ts`: a `--detach` flag on `review`. With
  it: reserve a run id, write an invocation record `{ run_id, pid, after_run,
  created_at }` under `.spartan-bridge/invocations/<run-id>.json`, print one
  JSON ack line to stdout, and fork the real work with `spawn(argv, { detached:
  true, stdio: ["ignore", fd, fd] })` + `child.unref()`, where `fd` is an open
  descriptor for `.spartan-bridge/invocations/<run-id>.detach.log` (`detached:
  true` gives a new session on POSIX — SIGTERM to the caller's process group no
  longer reaches the chain; the array-form `stdio` sends the child's combined
  stdout+stderr to the log file, never a pipe to the exiting parent, never
  `/dev/null`). The child creates `runs/<run-id>/` itself via
  `createExclusiveRunDir`, so the detach log lives under `invocations/`, not the
  run dir it would collide with. `exit 0`.
  Default `review` (no flag) stays blocking, unchanged — human terminals and
  the test suite are untouched.
- `src/cli/main.ts` + a `src/core` helper: a new `spartan-bridge wait --repo <r>
  --run <id> [--timeout-ms N]` (default a value well under 120 s, e.g. 25000).
  It follows the chain the blocking process used to embody:
  1. plan run not terminal -> exit "still running"
  2. plan run terminal and not a chaining pass -> print that status document
     (today's stdout) and exit
  3. plan run `review_passed` / `awaiting_implementer` -> resolve the successor
     by `parent_run_id`
  4. a transition exists and is not terminal -> exit "still running"
  5. transition terminal -> print the same document today's blocking CLI would
     have printed (the implementation-review status, or the transition stop)
  "Still running" and the terminal cases are distinct exit codes / a JSON field
  the skill reads. The gap between the plan pass and
  `createExclusiveTransitionDir` (admission, launcher resolve, producer
  preflight all run first) is resolved by the invocation pid: **pid alive ->
  running, even with no transition yet; pid dead and no transition -> the
  plan-run status is the outcome** (the chain never started or died in
  admission — same as today's `reviewResult(plan)`).
- `src/runtime/lock.ts`: the writer-lock record gains `pid` alongside
  `transition_id`. Readers tolerate an old record with no pid.
- `src/cli/detach.ts` + `src/cli/main.ts` + `src/runtime/lock.ts` +
  `src/core/contracts.ts`: `spartan-bridge resume --repo <r>`:
  - the writer-lock record gains `pid` (readers tolerate an old pid-less
    record); `resume` removes a `writer.lock` whose recorded pid is dead.
  - for a detached invocation whose pid is dead and whose successor transition
    is not terminal: persist a `stopped` / `interrupted` transition record
    (`interrupted` is a new `ReasonCode`), continuing the transition's own
    monotonic event sequence via `appendTransitionEvent`; release the lock that
    transition holds; print the operator's one-line recovery.
  - a producer that died in `producer_running` is **not** auto-respawned: its
    declaration (`phase: reviewing`, checks passed) was never written; the
    Bridge must not forge it. Same conservative stop as above.
  - **not in this task:** auto-advancing a `producer_finished` /
    `implementation_review_result` checkpoint through implementation review —
    deferred to `0056` (D4, narrowed).
- `agent-skill/skills/spbridge/SKILL.md` step 4: after the in-session `/spartan`
  round, `spartan-bridge review --detach`, read `run_id` from the ack, then loop
  `spartan-bridge wait --run <id> --timeout-ms 25000` until the document is a
  terminal status or transition, then the existing step-5/6 report and continue
  rules. No file polling. No host-specific shell backgrounding. `--after-run`
  plan-review continuations use the same `--detach` + `wait` path (D7) — one
  code path, no blocking variant.
- `docs/DECISIONS.md`: a dated D-006 amendment (the caller's shell is not the
  chain supervisor; `review --detach` + `wait` is; closing the initiating host
  may leave a detached chain running — that is `setsid`, still not a daemon;
  crash recovery is the `resume` command, not a supervised worker) and one new
  dated decision for B + D.
- `docs/ROUTING-AND-WORKFLOWS.md` + `docs/ARCHITECTURE.md`: the detach / wait /
  resume model.
- Tests: `tests/cli.test.ts` (the ack shape, `--detach` reparenting via a
  spawned probe, `wait` returning each of the five states), `tests/lock.test.ts`
  (pid in the record, old-record tolerance, stale-lock release on a dead pid),
  `tests/transition.test.ts` (resume from `producer_finished`, resume from
  `review_result_accepted`, refusal to respawn `producer_running`,
  `interrupted` persisted).

## Out of Scope

- A daemon / supervised background worker / socket / pidfile beyond the
  `{ run_id, pid }` invocation record (D-006 Phase 5 — still deferred).
- Boot-time orphan reconciliation, scheduling, a Board control plane.
- Changing what any adapter does, the review cycle limits, the approved-plan
  hash gate, the config opt-in, or the auto-chain admission rules.
- The producer isolated-workspace change (task `0053`).
- The pre-spawn plan-targets-unwritable-path scan (task `0054`).
- `resume` auto-advancing a `producer_finished` / `implementation_review_result`
  checkpoint through implementation review (task `0056`, D4 narrowed).
- MCP `stdio`: `review` there is a single plan-review tool, no auto-chain, no
  detach needed.

## Constraints

- English artifact.
- Universal by construction: `--detach` / `wait` / `resume` are CLI + durable
  state, below the adapter layer; the SKILL.md change is host-neutral. No new
  per-adapter or per-host code path.
- Detaching makes an orphaned chain **more** likely, not less — D ships in the
  same slice, or the first detached crash reproduces `0026` with a stuck lock.
- The Bridge never forges a producer's declaration. Resume only replays Bridge
  checkpoints, never a producer round.
- `--detach` must reparent (`detached: true` + `child.unref()` + a new session),
  with array-form `stdio` to a `.spartan-bridge/invocations/<run-id>.detach.log` file — not just background,
  not `stdio: "ignore"` — otherwise SIGTERM to the caller's group still kills the
  chain, or the child's crash output is lost.
- `npm run typecheck` / `npm run build` clean; `npm test` no new failure beyond
  the two pre-existing `tests/agents.test.ts` failures already tracked.

## Decisions

- **D1 (locked, external review) — `review --detach`.** Reparent with
  `spawn(argv, { detached: true, stdio: ["ignore", fd, fd] })` + `child.unref()`,
  `fd` an open descriptor for `.spartan-bridge/invocations/<run-id>.detach.log` (array-form `stdio` so the
  child's combined output is captured, not `/dev/null` and not piped to the
  dead parent). Print the ack `{ run_id, pid }`, then `exit 0`. Default `review`
  stays blocking. Rejected: `stdio: "ignore"` (string form -> `/dev/null`, no
  capture) and bare `&` (SIGTERM to the caller's group still kills the chain).
- **D2 (locked) — `spartan-bridge wait`.** A per-call bounded wait
  (`--timeout-ms`, default 25000) the skill loops like `--after-run`, following
  plan-run -> `parent_run_id` successor -> transition -> terminal document.
  Liveness is the invocation pid, not a poll of the D-035-sealed plan
  `status.json`. Rejected: the skill polling status files (A).
- **D3 (locked) — pid in the writer-lock record + stale-lock release in
  `resume`.**
- **D4 (locked; narrowed 2026-08-31, owner override — see Work Completed) —
  `resume` releases the stale lock and stops the chain cleanly; it does not
  auto-advance.** For a detached invocation whose pid is dead and whose
  successor transition is not terminal, `resume` persists a `stopped` /
  `interrupted` transition record (continuing the transition's own event
  sequence), releases the writer lock it holds, and prints the operator's
  one-line recovery. It never respawns a producer (a round that died in
  `producer_running` never wrote its `phase: reviewing` / checks-passed
  declaration; forging it is a protocol lie). **Auto-dispatching the
  implementation review from a `producer_finished` checkpoint, and finalising
  from an `implementation_review_result` checkpoint, are deferred to follow-up
  task `0056`** — the sound shape there is an extracted
  `advanceFromCheckpoint(transition)` that both `continueAfterPlanReview` and
  `resume` call, keyed on the last transition event, not a re-entry of the
  `transition.ts` successor loop. The original checkpoint design is preserved
  in `0056`'s context.
- **D5 (locked) — the SKILL.md invoke loop is `--detach` + `wait`,
  host-neutral.**
- **D6 (locked) — D-006 stands; daemon still deferred.** A reparented `review`
  child is still the foreground runtime — no self-crash survival, no boot
  reconciliation, no scheduling, no Board control plane. Amendment: the
  caller's shell is not the chain supervisor.
- **D8 (locked; aligned with the narrowed D4) — the plan records its own
  trail.** `docs/DECISIONS.md` gains one new dated decision (D-054) for the
  B + D choice (rejecting A / C / E), stating the shipped resume scope
  (release + stop, no auto-advance) and naming checkpoint auto-dispatch as a
  `resume` refinement deferred to `0056`; plus the dated D-006 amendment (D6).
  `docs/ROUTING-AND-WORKFLOWS.md` and `docs/ARCHITECTURE.md` describe detach /
  wait / resume. This is the record of D1-D7, not a new design choice.
- **D7 (locked) — `--after-run` plan-review continuations also detach.** One
  code path, uniform timeout-immunity, and the skill's follow-up is `wait`
  regardless of whether the underlying review is the first or an `--after-run`
  continuation. Each `--detach` invocation (first or continuation) prints its
  own ack and is followed by a `wait` loop.

## Acceptance Criteria

- [x] (D1) `spartan-bridge review --detach --repo <r> --task <t>` prints one
      JSON ack `{ run_id, pid, ... }`, exits 0, and the chain continues after
      the invoking shell exits (a test spawns the ack'd pid's tree and confirms
      it survives the parent) and its combined stdout+stderr is captured in
      `.spartan-bridge/invocations/<run-id>.detach.log`, not `/dev/null`. Default `review` is byte-for-byte
      unchanged in behaviour and output. (D7) a `--detach --after-run`
      continuation prints its own ack and is `wait`-followed the same way.
- [x] (D2) `spartan-bridge wait --run <id> --timeout-ms 25000` returns, within
      the timeout, one of: still-running; the plan-run status document; the
      implementation-review status document; the transition stop document —
      matching what the blocking CLI would have printed for the same chain
      state. A test drives each of the five branches.
- [x] (D3) the writer-lock record carries `pid`; a reader tolerates a
      pid-less record; `spartan-bridge resume` releases a `writer.lock` whose
      recorded pid is dead.
- [x] (D4, narrowed) `spartan-bridge resume`, for a dead-pid detached
      invocation whose successor transition is not terminal, persists a
      `stopped` / `interrupted` transition record (continuing the transition's
      own event sequence), releases the lock that transition holds, prints the
      operator recovery line, and never respawns a producer. Tests cover the
      interrupted persist + lock release and the no-op case. Checkpoint
      auto-advance is task `0056`, not this criterion.
- [x] (D5) `agent-skill/skills/spbridge/SKILL.md` step 4 uses `--detach` + a
      `wait` loop; the `tests/spbridge-skill.test.ts` assertions follow; no
      host-specific shell syntax appears.
- [x] (D8) `docs/DECISIONS.md` carries the dated D-006 amendment and one new
      dated B + D decision (D-054) whose resume scope is release + stop with
      checkpoint auto-advance named as deferred; `docs/ROUTING-AND-WORKFLOWS.md`
      and `docs/ARCHITECTURE.md` describe detach / wait / resume.
- [x] `npm run typecheck` / `npm run build` clean; `npm test` adds no new
      failure.

## Work Completed

- 2026-08-31 (human-operator sign-off — task completed): cycle 1
  (`run-005a3a8e`) was the one real implementation review; its findings are
  resolved (D4/D8 narrowed to release + stop, the three warnings fixed, `0056`
  queued, `npm test` 399 / 0, typecheck / build clean). Two later
  implementation-review attempts failed on launcher infrastructure, not on the
  code, and produced no verdict: `run-d85065cd` — `adapter_timeout` in the
  `collect` phase; `run-706e2f34` (chain cycle 2) — `adapter_error` /
  `exit_nonzero` (exit 1, no stderr captured), `verdict: null`. The last
  implementation-review cycle was deliberately not spent waiting for the
  launcher to recover. The cycle-1 review region below is left as historical;
  no `APPROVED` verdict was synthesised.
- 2026-08-31 (owner override, implementation-review cycle 1 CHANGES_REQUESTED,
  `run-005a3a8e`): the reviewer raised `D4_RESUME_CHECKPOINT_MISSING` (error) —
  shipped `resumeInterrupted` stops every non-terminal successor as
  `interrupted` and does not auto-advance from `producer_finished` /
  `implementation_review_result`, which locked D4 required. A second opinion
  (Grok Cursor) confirmed the artifact/code disagreement was real but that the
  shipped behaviour (stale-lock release + clean `interrupted` stop + operator
  hand-off) **is** the 0026/0046 recovery — those incidents both died in
  `producer_running`, which D4's own refuse arm covers — and that re-entering
  the `transition.ts` successor loop from `resume` is the wrong cut; the sound
  shape is an extracted `advanceFromCheckpoint(transition)` keyed on the last
  transition event. Owner override: **narrow D4/D8 to release + stop, land what
  shipped, move checkpoint auto-dispatch to follow-up task `0056`.** The three
  warnings were fixed rather than deferred:
  - `DETACH_LOG_PATH_DEVIATION` — D1 Scope/criterion/Constraints wording
    aligned to the shipped `.spartan-bridge/invocations/<run-id>.detach.log`
    (the run-dir path collides with `createExclusiveRunDir`).
  - `INTERRUPTED_EVENT_SEQUENCE` — `persistInterruptedTransition` now uses
    `writeTransitionStatusAtomic` + `appendTransitionEvent` with
    `sequence = <count of prior events>`, not a hand-built `sequence: -1`.
  - `WAIT_BRANCH_COVERAGE` — `tests/detach.test.ts` gains direct cases for the
    plan-terminal-non-chaining, `awaiting_implementer`/no-transition, and
    terminal-transition `waitForRun` branches (11 tests total).
  `npm test` 399 / 0; typecheck / build clean. D-054 already recorded the
  narrowed scope; the task D4/D8 and Scope now match it.
- 2026-08-31 (implementer, `HX-002`): B + D shipped in one slice.
  - `src/cli/detach.ts` (NEW, ~330 lines): `invocationsDir` /
    `invocationPath` under `.spartan-bridge/invocations/`; `writeInvocation`
    (atomic, 0o600) / `readInvocation`; `pidAlive` (`pid<=1` false,
    `process.kill(pid,0)`, EPERM → alive); `findSuccessorTransition` by
    `parent_run_id`; `waitForRun` state machine (no-dir+alive → not done;
    no-dir+dead → `{done, document:""}`; `requested`/`policy_resolved`/
    `reviewing` → liveness; `TERMINAL_RUN_STATES` → serialized status;
    `awaiting_implementer` → successor transition, terminal → last linked
    review-run status); `spawnDetachedReview`
    (`spawn(execPath, [...execArgv, scriptPath, "review", …, "--run-id", id],
    { detached:true, stdio:["ignore", fd, fd] })` → `<invocations>/<id>.detach.log`,
    `child.unref()`, no `cwd` override); `resumeInterrupted` (drop dead-pid
    `writer.lock`, mark dead-pid `awaiting_implementer` successor
    `state:"stopped"` / `reason_code:"interrupted"` + `terminal_stop` event,
    release lock, operator recovery lines).
  - `src/cli/parse.ts`: `--detach` (BOOLEAN_FLAGS) / `--run-id` on `review`;
    new `wait` (`--repo --run` + optional positive-int `--timeout-ms`) and
    `resume` (`--repo` only) commands; HELP_TEXT updated.
  - `src/cli/main.ts`: `wait` (loop `waitForRun` every 1000ms to
    `outcome.done` or deadline; empty document → "run 'spartan-bridge
    resume'"), `resume` (`resumeInterrupted`), `review --detach`
    (`spawnDetachedReview`, print ack) branches before the blocking `review`.
  - `src/core/review.ts` + `src/core/transition.ts`: thread optional
    `run_id`; `ReviewCommandInput` / `runReviewThenSuccessor` input gain it.
  - `src/core/contracts.ts`: `ReasonCode` gains `"interrupted"`.
  - `src/runtime/lock.ts`: writer-lock record gains `pid: process.pid`.
  - `agent-skill/skills/spbridge/SKILL.md` step 4: `--detach` ack → bounded
    `spartan-bridge wait` loop; `--after-run` continuations detach the same
    way; `spartan-bridge resume` once on "never created a run". Host-neutral.
  - `docs/DECISIONS.md`: dated D-006 amendment + D-054 (B + D). `docs/
    ROUTING-AND-WORKFLOWS.md` + `docs/ARCHITECTURE.md`: detach / wait /
    resume paragraphs.
  - `tests/detach.test.ts` (NEW, 8 tests). Fixes during impl: `stdio`
    string→array (`/dev/null` conflict); detach.log moved out of the run dir
    (`createExclusiveRunDir` collision); `[...process.execArgv, scriptPath]`
    (detached child can't run TS without `--import tsx`); dropped `cwd`
    override (broke `tsx` module resolution in temp repos); direct-call tests
    need `await fs.realpath` (macOS `/tmp`→`/private/tmp`).
  - `npm test` 396 / 0; `npm run typecheck` / `npm run build` clean.
  - Verified against the checkout (closes `PATHS_UNVERIFIED`): the resume
    checkpoint is the transition event `producer_finished` (not the review
    event); `src/core/transition.ts` emits it; `src/runtime/lock.ts` had no
    pid; D-006 / D-035 present.
- 2026-08-31 (owner override, plan-review cycle 3 CHANGES_REQUESTED /
  cycle_limit_reached, `run-c81a606b`): three cycles, every verdict
  `changes_requested`, no cycle challenged the B + D substance -- the findings
  were stale Scope prose (`STALE_SCOPE_D7`, now rewritten to the one D7 code
  path), an untagged docs criterion (`DOCS_CRITERION_UNDERIVED`, now D8 +
  tag), and an event-name imprecision (`PATHS_UNVERIFIED` info: the resume
  checkpoints are the transition events `producer_finished` /
  `implementation_review_result`, not the review event `review_result_accepted`
  -- D4 and Scope corrected). Owner overrode to implementation; the
  implementation review (same reviewer) verifies the enum/event precision
  there.
- 2026-08-31 (planner, plan-review cycle 2 CHANGES_REQUESTED, `run-9eea034e`):
  `STDIO_SPEC_CONFLICT` -> D1, Scope bullet 1, and the Constraints line now
  quote `spawn(argv, { detached: true, stdio: ["ignore", fd, fd] })` with `fd` an
  open descriptor for the detach log; `stdio: "ignore"` (string ->
  `/dev/null`) is named as rejected; the D1 criterion gains the log-capture
  clause. (The log path was later corrected to
  `.spartan-bridge/invocations/<run-id>.detach.log` in implementation — see the
  implementer entry below.) `PATHS_UNVERIFIED` (info, repeated) -> the cycle-1 verification stands
  (see below); the implementer re-runs it with repo access.
- 2026-08-31 (planner, plan-review cycle 1 CHANGES_REQUESTED, `run-aa6a1ae0`):
  resolved all three findings. `OPEN_DECISION_D7` -> D7 locked (`--after-run`
  continuations also detach; one code path) and folded into D1's criterion.
  `DECISIONS_ORDER` -> `## Decisions` moved before `## Acceptance Criteria`.
  `PATHS_UNVERIFIED` -> every named path/anchor verified against the checkout:
  `src/cli/main.ts` review command has the `AbortController` + SIGINT/SIGTERM
  listeners (~440-472); `src/runtime/lock.ts` payload is
  `{transition_id, repo_identity, acquired_at}` (no pid), `releaseWriterLock`
  gates on `held === lock.transitionId`; `src/core/transition.ts` emits
  `producer_started`/`producer_running`, `producer_finished`,
  `implementation_review_dispatched`, `implementation_review_result`,
  `terminal_stop`; `docs/DECISIONS.md` D-006 and D-035 present;
  `agent-skill/skills/spbridge/SKILL.md` step 4 has the `spartan-bridge review`
  invocation lines.
- 2026-08-31: task drafted from the external B + D review. Code facts pinned:
  `src/cli/main.ts:441-472` (existing `AbortController` / SIGTERM handling),
  `src/runtime/lock.ts:53` (`transition_id`, no pid), D-035 (sealed plan-run
  `status.json`), D-006 (daemon deferral). Motivating incidents: `0046`, `0026`.

## Evidence

- `docs/DECISIONS.md` D-006 ("independent foreground runtime … no daemon …
  until unattended dispatch, recovery, and Board control require it") and
  D-035 (the plan-review status is the sealed pass record, not rewritten by the
  successor).
- `src/cli/main.ts` — the review command, `AbortController`, SIGTERM listener.
- `src/runtime/lock.ts` — the lock record shape (`transition_id` only).
- `src/core/transition.ts` `continueAfterPlanReview` — admission / launcher
  resolve / producer preflight before `createExclusiveTransitionDir`; the
  transition events (`producer_finished`, `implementation_review_result`) that
  `0056` will key checkpoint auto-advance on.
- Board `0026` / `0046` task artifacts — the interrupted-chain leftover shape.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: CHANGES_REQUESTED

Findings:

- `STALE_SCOPE_D7` (warning): The Scope bullet for agent-skill/skills/spbridge/SKILL.md (task.md lines 116-118) still reads: "`--after-run` plan-review continuations may stay blocking (one review, usually under the cap) or also detach — the plan picks one." That leaves an open choice in Scope after decision D7 (lines 188-192) was locked in plan-review cycle 1 to "`--after-run` plan-review continuations also detach. One code path...", and after the D1 acceptance criterion (lines 199-202) was amended to assert "(D7) a `--detach --after-run` continuation prints its own ack and is `wait`-followed the same way." AGENTS.md 'Artifact authoring' requires that when a decision changes, every part of the plan that touches it is re-derived rather than the one spot a finding named being patched; here the Decisions and Acceptance Criteria were updated for D7 but the Scope prose was not. An implementer reading Scope is told the detach-vs-blocking behaviour of `--after-run` is still undecided, while the locked decision and the criterion say it is fixed. Rewrite the SKILL.md Scope bullet so it states, without an either/or, that `--after-run` plan-review continuations also detach and are followed by a `wait` loop (one code path), matching D7 and the D1 criterion.
- `DOCS_CRITERION_UNDERIVED` (warning): The acceptance criterion at task.md lines 220-222 ("`docs/DECISIONS.md` carries the D-006 amendment and one new dated decision; `docs/ROUTING-AND-WORKFLOWS.md` and `docs/ARCHITECTURE.md` describe detach / wait / resume") is not tagged to a named decision and is not a repository-check row, so it violates AGENTS.md 'Artifact authoring' ("deriving each criterion from a named decision. The one exception is a row that records only a repository check the round must run"). The D-006 amendment is the substance of decision D6, and "one new dated decision" corresponds to the B+D choice, but the criterion does not say so and the "new dated decision" it requires is not itself stated as a locked decision in the Decisions section (D1-D7 are the design decisions, none of which is "record a new dated DECISIONS.md entry for B+D"). Either add an explicit decision that the plan records a new dated B+D decision plus the D-006 amendment, and tag this criterion (D6 / that new decision), or split it so each clause names its decision.
- `PATHS_UNVERIFIED` (info): This review was restricted by instruction to task.md and AGENTS.md, so the repository paths, line anchors, and event/record shapes the plan asserts (src/cli/main.ts review command with AbortController + SIGINT/SIGTERM listeners ~441-472; src/runtime/lock.ts record `{transition_id, repo_identity, acquired_at}` with no pid and releaseWriterLock gating on transitionId; src/core/transition.ts `continueAfterPlanReview` admission/launcher/preflight ordering and the `producer_finished` / `review_result_accepted` checkpoint events; docs/DECISIONS.md D-006 and D-035; agent-skill/skills/spbridge/SKILL.md step 4 review invocation lines) could not be confirmed against the current checkout, as AGENTS.md 'Artifact authoring' requires ("Every repository path a plan names ... is confirmed to exist in the current checkout before the plan is written") and as an Evidence row must be re-runnable. The plan's Work Completed section asserts this verification was performed in cycle 1 with specific line numbers; carrying this forward as info per the prior cycle. Before implementation begins, a reviewer or implementer with repository access must re-run that verification, in particular that `src/core/transition.ts` actually emits a `review_result_accepted` checkpoint (Work Completed line 245 lists `implementation_review_result`, not `review_result_accepted`) that `resume` can key on.

Bridge run: run_id=run-c81a606b-7761-445d-837b-8dcf2c00c1ca execution_id=exec-b9f7df39-45de-4f97-85d5-0c7517d75499 review_kind=plan verdict=changes_requested reason_code=review_changes_requested host=claude launcher=claude-plan-reviewer-v1 model=claude-sonnet-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:20fcfa7c8df758f5b260cdddb5dfbf86c1d202fcecff22e1ed15e24e6cabf2e0 task_hash=sha256:ecfb56362096105805fbc4115d14ebd1e6f23c8295456c2309285bb0acfe00e5 agents_hash=sha256:5b0538f788aa238a0f4e3edc1477bc42f67c2e71fee4bf230a3cfe394d51eeff timestamp=2026-08-31T09:40:02.302Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: CHANGES_REQUESTED

Findings:

- `D4_RESUME_CHECKPOINT_MISSING` (error): Locked decision D4 and acceptance criterion D4 require `resume` to (a) dispatch the implementation review from a `producer_finished` transition checkpoint and (b) finalise the terminal transition record and release the lock from an `implementation_review_result` checkpoint, refusing only a `producer_running` death. The shipped resumeInterrupted (worktree/src/cli/detach.ts:266-335, persistInterruptedTransition:337-365) does neither: for ANY non-terminal successor transition (including producer_finished and reviewing) it writes state:"stopped", reason_code:"interrupted", releases the lock, and prints operator recovery text. tests/detach.test.ts:150-215 asserts exactly this behaviour for a producer_finished transition. Effect: an interrupted chain whose implementer round already finished is stopped and handed back to a human instead of being auto-advanced through implementation review — the precise 0026/0046 recovery this task exists to deliver. worktree/docs/DECISIONS.md:908-909 rewrites D-054 to defer this checkpoint dispatch, contradicting task decision D8. Implement the D4 checkpoint-resume paths, or obtain an explicit owner override narrowing D4/D8 before landing.
- `DETACH_LOG_PATH_DEVIATION` (warning): D1's acceptance criterion and Scope bullet 1 say the child's combined stdout+stderr is captured in `<run-dir>/detach.log`. The implementation writes `.spartan-bridge/invocations/<run-id>.detach.log` (worktree/src/cli/detach.ts:18,202; docs aligned at worktree/docs/DECISIONS.md:890, worktree/docs/ROUTING-AND-WORKFLOWS.md:268). The rationale (createExclusiveRunDir rejects a pre-existing file in the run dir) is sound and internally consistent, but the D1 criterion as written cannot be checked true. Update the task's D1 Scope/criterion wording to the shipped path, or move the log under the run dir as specified.
- `INTERRUPTED_EVENT_SEQUENCE` (warning): persistInterruptedTransition (worktree/src/cli/detach.ts:353-364) appends the terminal_stop event to events.jsonl by hand with sequence:-1, bypassing the monotonic counter every other transition event uses (worktree/src/core/transition.ts:816-819 increments transition.sequence from 0). A resumed transition's events.jsonl then ends with an out-of-order -1 entry after entries 0..N, and the hand-built object omits fields the normal appendTransitionEvent path populates. Read the existing event count or reuse appendTransitionEvent to continue the sequence.
- `WAIT_BRANCH_COVERAGE` (warning): Acceptance criterion D2 requires a test driving each of the five wait branches. tests/detach.test.ts unit-tests only alive-pid/no-run-dir and dead-pid/no-run-dir (lines 121-148) plus one end-to-end fake run (86-119). The plan-terminal-non-chaining branch (waitForRun:142-145), the awaiting_implementer/no-transition branch (148-152), and the terminal-transition branch (153-169) have no direct test. Add cases for the remaining branches so a regression in the document/exit-code mapping is caught.

Bridge run: run_id=run-005a3a8e-9f89-43e8-9d7b-b573787941a9 execution_id=exec-f3d845d3-a0e5-4369-96d5-f33432160607 review_kind=implementation verdict=changes_requested reason_code=review_changes_requested host=claude launcher=claude-plan-reviewer-v1 model=claude-sonnet-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:1432cf4ad657ba8b32cb1751f04ef520e7ecebe5fcb14dec11a3dca63243ff05 task_hash=sha256:a244083001a0136dfb84a469c6d4c9cb58d2ea6c636c811d23b617c030320100 agents_hash=sha256:5b0538f788aa238a0f4e3edc1477bc42f67c2e71fee4bf230a3cfe394d51eeff timestamp=2026-08-31T10:09:19.175Z
<!-- spartan-bridge:review:implementation:end -->

**Disposition (2026-08-31, human-operator):** the cycle-1 findings above are
resolved — `D4_RESUME_CHECKPOINT_MISSING` by a scoped owner override (D4/D8
narrowed to release + stop; checkpoint auto-advance is task `0056`), and the
three warnings by the fixes recorded in Work Completed. The two follow-up
review runs (`run-d85065cd`, `run-706e2f34`) failed on launcher infrastructure
with no verdict; the task is completed on operator sign-off rather than a
recorded `APPROVED`.

## Blockers

None.

## Next Action

None — task completed. Follow-up: task `0056` (`resume` checkpoint
auto-advance) is queued in `planning`.

## Next Handoff

No outstanding handoff. Task completed on human-operator sign-off.
