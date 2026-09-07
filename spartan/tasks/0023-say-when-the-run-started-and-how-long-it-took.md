---
protocol: "1.0.0" # x-release-please-version
id: say-when-the-run-started-and-how-long-it-took
created_at: 2026-08-19
status: completed
phase: complete
task_type: implementation
risk: routine
current_role: reviewer
next_role: human-operator
updated_at: 2026-08-20
handoff_id: HX-006
next_handoff_id: none
---

# Say when the run started and how long it took

> Editorial note (2026-09-07): unused platform names and historical integration-document names were generalized for publication. The historical optional-integrations document refers to the former combined cockpit and Board documentation; its Board material is now in `docs/BOARD.md`. Any example path in this cleanup is a normalized placeholder. Original round outcomes, commands, and technical findings are retained; historical line references are not current navigation targets.

## Objective

Someone with three terminals open can tell, from each one's own output, when its review started, when
it ended, and how long it took — including when a terminal has been sitting there since yesterday.
The clock on screen measures the silence since the last thing the reviewer said, not the run's total
age.

## Context

**The information exists and is thrown away on the way to the screen.** Every run's `status.json`
already carries `created_at` and `updated_at` in RFC3339 UTC, so start, end, and duration are all
derivable today. Nothing renders them: the terminal shows a run id, a host, a model, a repeating
`elapsed Ns`, and a terminal state.

**This is the owner's stated problem, in their words.** They run several reviews at once and cannot
tell which terminal is still going or which finished when, sometimes across a day boundary. Task
`0014` fixed "is it alive" with the elapsed ticker and task `0019` fixed "what is it doing" with
stream classes and counts; neither answers "when did this start" or "how long did it take".

**The elapsed line is measuring the wrong thing.** On one observed run the stream stopped at 331
records after about 70 seconds and the run ended at 170 seconds, so ten identical-looking `elapsed`
lines carried no information about the 100 seconds of actual silence. On another, records arrived
continuously for the whole run and the same ticker looked identical. The number only means something
when it is measured against the last thing the child said.

**The format is settled by the owner**, chosen from three candidates on 2026-08-19: full date on the
first line, hour aligned in a column on the lines below, and the total duration on the terminal line.

```text
19/08 06:15:49 review run-a421fd20… host=cursor model=… client-context=personal
      06:15:52 working records=1 tools=0
      06:18:39 working records=331 tools=2
      06:18:39 quiet 100s
      06:18:48 review changes_requested took 2m59s
```

Stream lines keep task `0019`'s child description and gain only the aligned local-time prefix. Silence is a distinct ticker line (`quiet <n>s`), TTY-gated, one whole line per tick, never patched onto a stream line. When the child has emitted no record, that same ticker line is measured from the run start.

## Scope

- `src/cli/main.ts`: the run header line, the terminal line, the elapsed ticker, and the stream line
  formatter that shares that stream.
- The time source already injected as `Clock`, so the rendering stays testable.
- Tests over captured stderr bytes with a fake clock and a pinned `TZ`, in the manner tasks `0014` and
  `0019` established.
- `README.md`: the one sentence that describes the `review` terminal surface.

## Out of Scope

- `status.json`, `events.jsonl`, and the Bridge's stdout. `created_at` and `updated_at` stay RFC3339
  UTC and nothing is added to any document; this task renders what already exists.
- A `spartan-bridge runs` command listing every run with its start, end, and duration. The owner wants
  it and it is a separate task: it is a new CLI surface, it has to scan the runs directory, and it has
  to decide how to show a run still in progress.
- The MCP path, which stays silent by the structural argument of task `0019`.
- Any change to what the stream lines say about the child. Task `0019` D4 stands: Bridge-owned class
  names and Bridge-maintained counts only.
- `docs/DECISIONS.md` D-019. That entry is a dated record of task `0019` and is superseded by a new
  D-023 entry in a separate documentation round, not edited here. Task `0026` documents the
  plan-review loop and explicitly excludes this task's timestamp work.

## Constraints

- The Bridge's stdout stays byte-identical for every run that succeeds today and every run that fails
  today.
- Every line is whole and ends in `\n`; no carriage return, cursor movement, or in-place rewriting —
  task `0014` D3, which owns the shared stream.
- No absolute path, home-directory prefix, credential, or provider-derived text reaches the terminal.
- No new runtime dependency.

## Acceptance Criteria

- [x] The Bridge's stdout for a passing run and for each failing run is byte-identical to the current
      build, asserted over captured bytes.
- [x] The header line carries the local date and time of the run's start as zero-padded
      `DD/MM HH:mm:ss` from a locale-independent formatter; the terminal line carries the local end
      time in the same `HH:mm:ss` column and the total duration formatted as `2m59s`, truncated toward
      zero to whole seconds. When stderr is not a TTY, the terminal line is also the line that
      reprints `DD/MM` if the local day changed.
- [x] Both of those lines are written whether or not stderr is a TTY, matching the current build,
      which gates only the ticker and the stream lines.
- [x] Progress lines carry the local time in a column aligned under the header's time, and no date.
- [x] A run whose start and end fall on different local dates reprints the date on the first line
      after the change, asserted with a fake clock crossing midnight.
- [x] A distinct TTY-gated ticker line reports the silence since the last stream record rather than
      the run's age: a stub child that emits records and then goes quiet produces a `quiet <n>s` line
      that is not a stream line, and a child that never emits a record produces that same ticker
      line measured from the run's start.
- [x] Start, end, and duration on screen are derived from the status document's `created_at` and
      `updated_at`. The comparison asserts the formatted local strings against those two RFC3339
      values under the pinned `TZ`, after truncating duration toward zero to whole seconds, so a
      2m59.2s span renders `2m59s` and still matches.
- [x] Every rendered line is whole, ends in `\n`, and contains no ESC, `\r`, or cursor-control byte,
      asserted over captured bytes.
- [x] Tests pin `TZ` so the rendering is deterministic on another machine.
- [x] With stderr a TTY, a stub child whose records stay in one class across ticker ticks writes
      progress lines whose `records=` count advances on those ticks. Four `thinking` records then a
      `result`, with a tick after the second, third, and fourth thinking records, produce distinct
      `working records=1` through `working records=4` lines. The same stub without the ticker
      refresh produced only `working records=1`.
- [x] `npm run typecheck` and `npm test` exit 0.

## Decisions

### D1 - Local time on screen, UTC in the document

The person reading a terminal wants their own wall clock; the document is a record and stays RFC3339
UTC. Nothing is added to `status.json`, so this task changes no schema and no consumer. The cost is a
test that depends on the environment's timezone, which is why the criteria pin `TZ` rather than
hoping the suite runs somewhere convenient.

### D2 - Date once, then a column

The full date appears on the first line and the hour on the lines below, aligned under it, with the
date reprinted only when the local day changes mid-run. That answers the owner's actual case — a
terminal left open overnight — without repeating twenty-two characters on every line. The alternative
of stamping the date on every line was offered and not chosen.

The prefix is a fixed, zero-padded `DD/MM ` produced by a locale-independent formatter, not by the
host locale's date order, so the indent stays five characters on another machine. Tests already pin
`TZ`; they do not pin locale, which is why the formatter must not consult one. When stderr is not a
TTY, there are no ticker or stream lines, so the terminal line is the line that reprints `DD/MM` if
the local day changed.

### D3 - The clock measures silence, not age

`elapsed Ns` is replaced by a distinct ticker line whose grammar is the aligned time column plus
`quiet <n>s`. It is TTY-gated, one whole line per tick, and is never appended to a stream line.
Stream lines may gain only the same aligned local-time prefix; what they say about the child stays
task `0019` D4. When a child has emitted nothing at all, the ticker is measured from the run start,
so the silence criterion does not depend on a working line existing. The ten-second cadence and the
TTY gate from task `0014` D2 are unchanged.

### D4 - Derive from the status document, not from a second stopwatch

Start, end, and duration come from the same `created_at` and `updated_at` values the run records,
rather than from a timer the CLI keeps alongside them. Duration on screen is that span truncated
toward zero to whole seconds (`2m59.2s` renders `2m59s`). The agreement test compares those
formatted local strings with the two RFC3339 fields under the pinned `TZ`, not a second wall-clock
reading.

### D5 - Same-class counts ride the ticker; quiet is the idle tick

When the child is still producing records of the same class, the ten-second tick writes a fresh
stream line with the current counts. When that line would be identical to the last one written, the
tick writes `quiet <n>s` instead. Class changes still write immediately. The two line kinds stay
distinct whole lines; neither is appended to the other. The comparison is the stream body, not the
time prefix, so an unchanged count does not reprint under a new clock and starve the quiet line.

## Work Completed

- Reviewer HX-006 (Claude Code, claude-opus-5, effort high, Anthropic): accepted matching envelope
  HX-006. Verdict `APPROVED`. Re-read the whole diff, ran the repository checks, re-ran the suite
  under two foreign timezones and a German locale, mutation-tested both halves of D5, and reproduced
  the HX-004 stub on the fixed tree. Both HX-004 findings are closed. No product file was edited.

- Implementer HX-005 (Cursor, cursor-grok-4.6-high-fast, effort none):
  accepted matching envelope HX-005. Addressed both HX-004 findings:
  - `STREAM_COUNT_FREEZE`: restored the ticker's same-class stream-line refresh beside `quiet`.
    Class changes still write immediately. A tick with a new count writes a stream line; a tick
    whose stream body is unchanged writes `quiet <n>s`. Added D5 and the same-class acceptance
    criterion. The new test failed on the unfixed tree (`working records=` was `['1']`) and passed
    after the change (`['1','2','3','4']`).
  - `README_ELAPSED_STALE`: widened Scope to the one `README.md` terminal-surface sentence and
    replaced "elapsed seconds" with start time, quiet seconds, end time, and duration. Left
    `docs/DECISIONS.md` D-019 untouched for a later D-023 documentation round.
  `npm run typecheck` exited 0. `npm test` exited 0 (170 passed).

- Reviewer HX-004 (Claude Code, claude-opus-5, effort high, Anthropic): accepted matching envelope
  HX-004. Read the whole diff, ran the repository checks, re-ran the suite under two foreign
  timezones, mutation-tested the six new formatting rules, and compared the working tree against
  `HEAD` on one stub run. Verdict `CHANGES_REQUESTED`; findings in Review. No product file was
  edited.

- Implementer HX-003 (Cursor, cursor-grok-4.6-high-fast, effort none):
  accepted matching envelope HX-003. Implemented D1–D4 in the named scope:
  - Header and terminal lines take `created_at` / `updated_at` from the status document. Duration
    truncates toward zero to whole seconds. The formatter is locale-independent zero-padded
    `DD/MM HH:mm:ss`; the hour column is six spaces of indent so it lines up under the header.
  - `ReviewStartedProgress` now carries `created_at` so the header is the same instant the run
    recorded, not a second CLI clock.
  - The TTY-gated ticker writes `quiet <n>s` measured from the last stream record, or from run
    start when the child has said nothing. Stream lines gain only the aligned time prefix.
  - The date reprints on the first line after the local day changes, including the terminal line
    when stderr is not a TTY.
  - Tests pin `TZ=America/Sao_Paulo`. All acceptance criteria checked.
  `npm run typecheck` exited 0. `npm test` exited 0 (169 passed).

- Planner response, cycle 1 (Cursor, cursor-grok-4.6-high-fast, effort none):
  accepted all three findings from `run-cf518a96`. `QUIET_LINE_GRAMMAR`: silence is a distinct
  ticker line; the example no longer hangs `quiet 100s` on a working line. `DURATION_DOCUMENT_SYNC`:
  duration truncates toward zero to whole seconds; the agreement test compares formatted local
  strings with `created_at` / `updated_at`. `DATE_COLUMN_FORMAT`: zero-padded locale-independent
  `DD/MM HH:mm:ss`, and the non-TTY date reprint lives on the terminal line. No product file was
  edited.

- Planner (Claude Code, claude-opus-5, effort high, Anthropic): created this task. The output format
  was chosen by the owner from three candidates on 2026-08-19. No product file was edited.

## Evidence

- HX-005, same-class criterion: `node --import tsx --test --test-name-pattern 'same-class stream counts advance on ticker ticks' tests/cli.test.ts` failed before the refresh (`actual: ['1']`) and passed after it. `npm run typecheck` exited 0. `npm test` exited 0 (170 passed, 0 failed).
- HX-005 README: `README.md:62` now names local start, quiet seconds, local end, terminal state, and duration, and no longer says `elapsed`.
- `npm run typecheck` exited 0. `npm test` exited 0 (169 passed, 0 failed) on the HX-003 tree before this round's extra test.
- Header/terminal agreement: `2026-08-19T09:15:49.000Z` / `09:18:48.200Z` under `TZ=America/Sao_Paulo`
  render `19/08 06:15:49` and `06:18:48 took 2m59s`. `formatDuration(179200)` and `formatDuration(179999)`
  are both `2m59s`.
- Midnight: fake clock from `2026-08-17T02:59:50.000Z` reprints `17/08` on the first quiet tick and
  on the terminal line when start and end fall on different local dates.
- Quiet after records: a stub that emits, then ticks, writes `quiet 10s` at 20s of run age, so the
  number is silence since the last record. A child that never emits writes `quiet 10s` / `quiet 20s`
  from start. Neither line carries `records=`.
- Captured stdout still round-trips through `serializeStatus`. MCP stderr on `tools/call` of
  `review` stays empty. Every stderr line is whole, ends in `\n`, and contains no ESC or `\r`.

- Reviewer HX-004 checks: `npm run typecheck` exited 0. `npm test` exited 0 (169 passed, 0 failed).
- Reviewer HX-004, `TZ` portability: `TZ=UTC npm test` and `TZ=Asia/Tokyo npm test` both 169 passed,
  0 failed on a machine whose system zone is `America/Sao_Paulo`, so the in-process
  `process.env.TZ = "America/Sao_Paulo"` really governs the rendering rather than the host zone.
  `LC_ALL=de_DE.UTF-8 LANG=de_DE.UTF-8 npm test` also 169 passed, confirming the formatter consults
  no locale.
- Reviewer HX-004, mutation check on a scratch copy of the tree (product files in the repository
  untouched). Each mutation applied alone, suite re-run, then reverted: `DD/MM` never reprinted
  after the first line -> 1 fail (`date reprints on the first line after the local day changes`);
  `quiet` measured from run start instead of last record -> 1 fail; `Math.trunc` -> `Math.round` in
  `formatDuration` -> 1 fail; header time from `Date.now()` instead of `created_at` -> 5 fail;
  terminal time from `Date.now()` instead of `updated_at` -> 2 fail; `TIME_COLUMN_INDENT` five
  spaces instead of six -> 7 fail. Every settled rule is bound by at least one assertion.
- Reviewer HX-004, `STREAM_COUNT_FREEZE` reproduction (superseded by the HX-006 capture below). On
  the pre-fix tree the same stub wrote `working records=1 tools=0` once and then four `quiet 10s`
  lines, where `HEAD` (`0d12eb5`) wrote `working records=1` through `working records=4` interleaved
  with `elapsed` lines.
- Reviewer HX-004, stdout surface: `git diff --name-only HEAD -- src/` lists only `src/cli/main.ts`
  and `src/core/review.ts`. The `review.ts` change adds `created_at` to the in-memory
  `ReviewStartedProgress` payload only; `serialize.ts`, `contracts.ts`, and `store.ts` are
  untouched, and the status key-order test still passes.
- Reviewer HX-004, stale documentation: `README.md:62` still reads "then elapsed seconds every ten
  seconds while it waits". Closed by HX-005.

- Reviewer HX-006 checks: `npm run typecheck` exited 0. `npm test` exited 0 (170 passed, 0 failed).
  `TZ=UTC`, `TZ=Asia/Tokyo`, and `LC_ALL=de_DE.UTF-8 LANG=de_DE.UTF-8` each 170 passed, 0 failed on a
  machine whose system zone is `America/Sao_Paulo`, so the new test's literal `09:00:xx` strings come
  from the pinned in-process `TZ` and not from the host zone or locale.
- Reviewer HX-006, `STREAM_COUNT_FREEZE` closed. The HX-004 stub - `{"type":"thinking","subtype":"delta","text":"a"}`
  through `"d"`, then `{"type":"result","subtype":"success",...}`, with one fake-clock tick after the
  second, third, and fourth thinking record - now writes on the working tree:

  ```text
  16/08 09:00:00 review run-11111111-1111-4111-8111-111111111111 host=cursor model=Composer-2.5 effort=none client-context=personal
        09:00:00 working records=1 tools=0
        09:00:10 working records=2 tools=0
        09:00:20 working records=3 tools=0
        09:00:30 working records=4 tools=0
        09:00:30 result records=5 tools=0
  ```

  The counts advance on every tick, matching `HEAD`'s information content with the aligned prefix
  added and no `elapsed` line, and no `quiet` line appears while the count is still moving.
- Reviewer HX-006, mutation check on a scratch copy of the tree (product files in the repository
  untouched). Each mutation applied alone, suite re-run, then reverted. Dropping the same-class
  refresh from `onTick` -> the new test fails with `actual: ['1']` against
  `expected: ['1','2','3','4']`, so D5's first half is bound. Forcing a stream line on every tick
  (`writeStreamLine(latestStream, true)`) -> 1 fail (`quiet ticker after stream records measures
  silence since the last record`), so the quiet line cannot be starved. Folding the time prefix into
  the `lastStreamLine` comparison -> the same 1 fail, so D5's "the comparison is the stream body, not
  the time prefix" is bound too.
- Reviewer HX-006, stdout surface re-checked because `src/core/review.ts` is in the diff:
  `git diff --name-only HEAD -- src/` still lists only `src/cli/main.ts` and `src/core/review.ts`;
  `serialize.ts`, `contracts.ts`, and `store.ts` are unchanged; `stdout.write(serializeStatus(...))`
  is untouched; and `ReviewStartedProgress` is consumed only by `formatReviewStartedLine`, which
  writes stderr. The new `created_at` field cannot reach the status document.
- Reviewer HX-006, README settlement: `README.md:62` names local start, quiet seconds, local end,
  terminal state, and duration. `grep -rn elapsed README.md docs/ src/` leaves only
  `docs/DECISIONS.md:151` (D-019, deferred by Scope) and the historical optional-integrations document (line 126)
  (unrelated). `spartan-bridge doctor --repo .` reports `cursor-plan-reviewer-v1: executable
  resolved; interface available`.

## Review

<!-- spartan-bridge:review:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-b2d15e1e-3c31-4b4a-a885-40de3fefb65c execution_id=exec-93e80e43-ca02-4fa7-af56-f0dd2c19c975 review_kind=plan verdict=pass reason_code=review_passed host=cursor launcher=cursor-plan-reviewer-v1 model=cursor-grok-4.6-high-fast effort=none model_observed=declared_unobserved policy_digest=sha256:f86f80dd14e95d3612c0ccd72cfd9fa9c88077b82418a39aad6cdf7ffc8bcea7 task_hash=sha256:0c05e815241fd03d3a06b2fe44f71d711d41408cb6b617bca73bd3ae72ee1d9b agents_hash=sha256:abddea169a1211006bd0e78f1b7ced5d708797901d12968e6b493c2b5cc6cd34 timestamp=2026-08-19T13:00:37.365Z
<!-- spartan-bridge:review:end -->

The region above holds the latest plan verdict, written by the Bridge run named inside it. The
implementation review below is a manual round outside the Bridge, because the Bridge accepts only
`review_kind: plan` (`decidePlanReviewTransition` in `src/core/task-write.ts` returns
`transition_review_kind_refused` for anything else).

### Implementation review, cycle 1 - Claude Code, claude-opus-5, effort high, Anthropic

Verdict: CHANGES_REQUESTED (superseded by cycle 2; both findings closed)

- `STREAM_COUNT_FREEZE` (material). The ticker's stream-line refresh was deleted rather than kept
  beside the new `quiet` line, so between class changes the counts on screen stopped tracking the
  child. On the owner's own observed run - 331 records in about seventy seconds - the screen would
  have held `working records=1 tools=0` for that whole span. That exceeded what the task authorised:
  Scope, Context, and D3 all say stream lines gain only the aligned prefix, and it regressed task
  `0019`'s shipped criterion that progress lines change as the child advances. No test caught it
  because every streaming test drove a class change between records. Closed by HX-005: D5 and the
  tenth acceptance criterion were added and the refresh restored.
- `README_ELAPSED_STALE` (minor). `README.md:62` still described the surface as "then elapsed seconds
  every ten seconds while it waits", which no build after this change can emit. Closed by HX-005 by
  widening Scope to that sentence, one of the two resolutions cycle 1 named.

Cycle 1 also confirmed all nine acceptance criteria as written, and that each of the six settled
formatting rules is bound by a failing assertion under mutation.

### Implementation review, cycle 2 - Claude Code, claude-opus-5, effort high, Anthropic

Verdict: APPROVED

Findings:

- None recorded.

Both cycle-1 findings are closed.

- `STREAM_COUNT_FREEZE` is fixed as D5 describes, and the fix is bound by an assertion that fails
  without it. The tick now writes exactly one line: a refreshed stream line when the stream body
  changed, `quiet <n>s` when it did not. Class changes still write immediately from `stream(info)`.
  The two kinds stay distinct whole lines - neither is appended to the other, `assertStderrBytes`
  holds for every new line, and the suite asserts that `/quiet \d+s records=/` and
  `/working records=.*quiet /` never match. Silence is still measured from the last record rather
  than from the tick that refreshed the count, because a same-class refresh does not touch
  `lastActivityAt`.
- `README_ELAPSED_STALE` is settled by widening Scope, and Out of Scope now records that
  `docs/DECISIONS.md` D-019 is superseded by a new entry in a separate documentation round rather
  than edited here.

The tenth acceptance criterion is derived from D5 and reproduces the stub that produced it, so it
satisfies the `AGENTS.md` rule that an Evidence row quote its input rather than describe it. The nine
criteria confirmed in cycle 1 were not re-litigated; criterion 1 was re-checked statically because
`src/core/review.ts` is in the diff.

Two observations, neither blocking and neither a finding against this task:

- `REVIEW_PROGRESS_CLASSES` already carries a stream class named `quiet` from task `0019`, so the
  word now names two things on this surface: `quiet records=0 tools=0` (a stream line) and
  `quiet 10s` (the ticker line). The stream class is unreachable today - `onProgress` fires only from
  `ingestLine`, after `records += 1`, so `snapshot()` never returns `quiet` to the sink - but the
  collision belongs in front of whoever writes the D-023 entry, because D-019's published text names
  that closed class list.
- `startElapsedTicker` keeps a second quiet-line implementation in the branch taken when `onTick` is
  absent. Production always passes `onTick`, so that branch is reached only from tests and the two
  copies could drift. Nothing is untested: the production no-record case is covered independently by
  "quiet ticker with no stream records is measured from the run start".

## Blockers

None.

## Next Action

None inside this task. The working tree holds this task's diff, uncommitted; commit is a human-only
gate under `AGENTS.md`.

## Next Handoff

None. This task proposes no handoff.

The working tree still holds this task's diff — `src/cli/main.ts`, `src/core/review.ts`, `README.md`,
`tests/cli.test.ts`, `tests/mcp.test.ts`, and `tests/review.test.ts` — uncommitted. Commit is a
human-only gate under `AGENTS.md` and no round has been authorized to take it, so the diff is left
for the human to commit at the task boundary, together with this artifact. `README.md` is the file to
watch: active tasks `0022` and `0026` both edit it, and `0026`'s Scope conditionally names the same
stderr paragraph this task rewrote — "the status-line paragraph describing what `review` writes to
stderr, if it also describes a single-cycle run". It does not: one `review` invocation is one run
even with `--after-run`, so the condition reads false. Committing this task before either of those
rounds starts keeps the three diffs separable.

Non-binding suggestion, which the human may decline: this task settled five decisions and changed the
shipped terminal surface, and `docs/DECISIONS.md` D-019 still reads "The ten-second elapsed line
remains as the floor", which no build after this change can produce. Scope deferred that entry to a
separate documentation round, and no active task owns it — `0026` excludes this task's timestamp work
by name, and `0024`, `0025`, `0027`, and `0028` each own a different entry.

```text
Recommended execution (human decides):
- Host: Claude Code, the `planner` binding in `AGENTS.md`; the round writes a plan, not the worktree
- Model and effort: claude-opus-5, effort high
- Role: planner
- Invocation: `/spbridge` in Claude Code, the producer round whose plan review the Bridge dispatches; `spartan-bridge doctor --repo .` reports `cursor-plan-reviewer-v1: executable resolved; interface available`
```

```text
Create a new task in `spartan/tasks/` from `assets/task-template.md`, using the next unused four-digit number.

Act as planner. Plan the `docs/DECISIONS.md` entry that records the `review` terminal surface as it now ships: local start on the header line, an aligned time column below it, a distinct `quiet <n>s` ticker measuring silence rather than run age, same-class counts refreshed on the tick, and local end plus duration on the terminal line. Success is a plan that settles what the new entry says, how it supersedes D-019's "the ten-second elapsed line remains as the floor" without rewriting that dated record, and whether the closed progress class list D-019 publishes still reads correctly now that `quiet` names both a stream class and the ticker line.
Run the relevant repository checks and update that new task file.

Return only the next handoff, or a completion notice if no work remains.
```
