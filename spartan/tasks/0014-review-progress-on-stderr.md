---
protocol: "1.0.0" # x-release-please-version
id: review-progress-on-stderr
created_at: 2026-08-18
status: completed
phase: complete
task_type: implementation
risk: routine
current_role: reviewer
next_role: none
updated_at: 2026-08-18
handoff_id: HX-004
next_handoff_id: none
---

# Show progress while a review runs, without touching the stdout contract

## Objective

A human running `spartan-bridge review` in a terminal can tell the run is alive and what it is
doing, while anything parsing stdout sees exactly the bytes it sees today.

## Context

`review` prints nothing for roughly two minutes and then emits one JSON document. A person
reasonably concludes it has hung, and the natural reaction — interrupting it — throws away a
paid reviewer session.

The event log shows the shape of the problem, and it is not what it first appears. From a real
passing run:

```
08:43:56.171  run_requested
08:43:56.179  policy_resolved
08:43:56.800  review_started
08:45:49.207  review_result_accepted
```

Every existing event fires inside the first 0.6 seconds. The silence is a single 112-second gap
between `review_started` and the result. So surfacing the events that already exist would print
three lines immediately and then leave the same two-minute silence untouched.

One thing has changed since this plan was written, and it changes what "the stderr behaviour"
means. Task `0016` shipped a stale-build warning on the same stream, recorded here as finding
`STDERR-NOW-SHARED` from that task's implementation review. The warning is written inside
`main()` at `src/cli/main.ts:111-117`, before `parseArgv`, so it precedes every byte this task
emits, on every invocation, `review` included. stderr is no longer a stream this task can treat
as its own: it has two writers, one of which this task does not own and must not edit. D3 settles
the order between them and what each is allowed to assume about the other.

## Scope

- `src/cli/main.ts`: the human-facing output of `review`, and the ticker, exported and taking its
  stream, clock, and timer as arguments.
- `src/core/review.ts`: one optional progress argument on `runReview`, called at one call site.
- `README.md`: one line describing what the terminal shows.
- Tests covering the stdout contract, the stderr behaviour, and the order of the two writers.

## Out of Scope

- New event types in `events.jsonl`, and any change to `StatusDocument`.
- Any change to what the runtime decides, spawns, or writes.
- Progress for `status`, `events`, `doctor`, and `mcp-stdio`, which return immediately or speak to
  a program rather than a person.
- The text, trigger, and position of task `0016`'s stale-build warning. See D3.
- The other two informational findings from `0016` — `DEFAULT-MODULE-UNPINNED` and
  `SCAN-BEFORE-PARSE`. Neither touches this output surface.

## Constraints

- The bytes on stdout must not change. `/spbridge` and any script parse that document, and this
  task must not become a reason to update them.
- The authentication boundary applies to this new output surface exactly as elsewhere: no
  token, credential path, account identifier, or launcher command may be printed.
- Nothing this task writes may overwrite, erase, or reposition bytes another writer has already
  put on stderr. The stream is append-only for every writer on it.
- No change to timeouts or to how the adapter is spawned.

## Acceptance Criteria

- [x] `review` writes exactly one JSON document to stdout on every terminal state, byte-identical
      to what it writes today, verified by comparing captured stdout before and after the change.
- [x] When stderr is a TTY, a line is emitted every 10 seconds while the adapter runs, each
      naming the elapsed whole seconds.
- [x] When stderr is not a TTY, no elapsed line is emitted at all, and every other stderr line of
      the run — this task's two lines and task `0016`'s warning alike — is unchanged.
- [x] Before the adapter starts, stderr carries one line naming the run id, the resolved host,
      the resolved model, and the client-context alias.
- [x] On a terminal state, stderr carries one line naming the state, and the reason code whenever
      `verdict` is null.
- [x] stderr contains no launcher command, no filesystem path outside the repository, and no
      value the authentication boundary forbids, asserted by a test over captured stderr.
- [x] On a `review` run started from a stale build, captured stderr reads in this order: task
      `0016`'s warning, this task's resolved line, the elapsed lines, this task's terminal line.
      The test stages the package root and passes it through `main`'s third parameter, so build
      freshness is set by the test rather than inherited from the checkout.
- [x] Task `0016`'s warning is emitted at most once per invocation, and its message text, its
      trigger, and its position ahead of `parseArgv` are unchanged. The diff for this task shows
      no edit to `packageRootFromRunningModule`, `newestFileMtime`, `isBuildStale`, or
      `staleBuildMessage`.
- [x] Every byte this task writes to stderr belongs to a line terminated by `\n`. Captured stderr
      contains no `\r`, no `ESC`, and no ANSI control sequence, asserted over the captured bytes
      rather than by reading the format strings.
- [x] A review driven through the MCP stdio session with the same `AppDeps` writes no progress
      output at all. A test drives that path rather than inferring silence from the types.
- [x] The ticker is stopped on every path out of `runReview`, including a thrown error and a
      `prepare` failure that never starts the adapter, and a pending timer never keeps the process
      alive.
- [x] `npm run typecheck` and `npm test` exit 0.

## Decisions

### D1 - stdout is a contract; stderr is for people

Progress goes to stderr and results stay on stdout. This is the ordinary Unix split and it is
what lets the change be additive: a caller that reads stdout is unaffected, and a human in a
terminal sees both interleaved because both are attached to the same screen.

The alternative — a `--verbose` flag defaulting to silent — was rejected. The current silence is
the defect, so leaving it as the default only hides the fix behind a flag the person who needs
it does not know to pass.

### D2 - A ten-second ticker, silent when stderr is not a terminal

The gap is one 112-second span with no observable moment inside it. Reporting `policy_resolved`
and `review_started` is worth doing, because it lets a human confirm the resolved model and host
before committing two minutes to them, but it does not address the silence.

So the runtime reports elapsed time while the adapter runs. Both open questions are closed here
rather than left to the implementer:

**Ten seconds.** The observed review took 112 seconds, so ten produces about eleven lines — often
enough that the longest wait between signs of life is shorter than the point where a person
reaches for the interrupt, sparse enough that the output stays readable in a scrollback. One
second would be noise; a minute would leave two silences nearly as long as the one being fixed.

**Silent off a TTY.** When stderr is not a terminal there is no one watching in real time, and
every line becomes permanent noise in a CI log or a pipe. The ticker is suppressed entirely
rather than made sparse: a reduced cadence would still write lines nobody reads, and the
before-and-after lines already record everything a log needs.

Note for the reviewer, so it is not mistaken for something it is not: this timer reports elapsed
time on one already-running foreground process. It schedules no work, starts no process, and
survives nothing — it is not the scheduler or watcher the portable protocol forbids, and the
Bridge is a runtime in any case.

### D3 - Two writers on one stream: this task owns the order, not the other line

`STDERR-NOW-SHARED` is informational, and its substance is a decision this plan had no reason to
make when it was written: task `0016`'s stale-build warning now shares the stream, and an
implementer left to place the ticker relative to it will place it badly. Four points, each of
which an implementation can be checked against.

**The `0016` line is not moved, reworded, gated, or re-emitted.** It is `0016`'s message, under
`0016`'s trigger, at `0016`'s call site. Re-siting another task's output while adding to the same
stream is how one task's diff quietly becomes two, and the person reading the blame later has no
way to see which task decided the text.

**The order is fixed, and it is the useful one.** On a `review` run: the staleness warning, then
the resolved line, then the elapsed lines, then the terminal line. The head of the run says
whether to distrust the binary at all and what is about to be spent; the tail says how it ended.
Both questions are answered where the reader is already looking.

**Nothing this task writes may overwrite what is already there.** Every line is whole and ends in
`\n`: no carriage return, no cursor movement, no erase sequence, no spinner rewriting itself in
place, and no output that assumes the cursor is where this writer last left it. This is the real
content of the finding. The hazard is not that eleven lines are many, it is that a shared stream
stops being append-only the instant one writer assumes it owns the cursor — and a tidy single-line
in-place ticker is exactly what a person reaches for on a TTY. It is rejected for that reason,
and the criterion asserts over captured bytes so a rejected implementation cannot pass by looking
correct.

**The warning is not restated at the end**, and the reason is not taste. Restating it means one of
two things. Either the source tree is scanned again after the review, which measures a different
fact — two minutes of editing may have passed, so the second answer can differ from the one the
run actually started under — or the first answer is cached and printed later as though it had just
been taken, which misstates when it was measured. The line is worth having before the run, when
the remedy costs a rebuild and a restart; after 112 paid seconds it is a footnote either way. One
truthful emission, at the moment of measurement.

**Consequence for the tests, stated because it is easy to get wrong.** This task's stderr
assertions must set build freshness rather than inherit it. `main` already takes `moduleFile` as
its third parameter and `0016`'s tests pass a staged package root through it; these tests do the
same, so the warning is present or absent by construction. A test that captures stderr from the
developer's own checkout is asserting over a line this task does not produce, and passes or fails
according to when someone last ran `npm run build`.

### D4 - One optional argument at one call site, and the CLI owns the ticker

The plan previously said "whatever seam is needed". Naming it closes a hazard of the same shape as
D3, one stream over: `src/mcp/session.ts:140` calls `runReview` with the same `AppDeps` the CLI
builds from `createProductionDeps`. A progress sink added to `AppDeps` would therefore write
progress to the stdio adapter's stderr as well, for a caller that is a program and never asked —
the third writer the out-of-scope list already refuses.

So the sink is not a dependency. `runReview` takes an optional argument beside `deps`, and only
the `review` branch of `src/cli/main.ts` passes one. MCP silence is then structural rather than
something a later change can forget, which is why the criterion still drives the MCP path rather
than trusting the type.

The core calls it exactly once, at the point that already emits `review_started`
(`src/core/review.ts:322`), immediately before `adapter.start`. That one notification carries the
run id, host, model, effort, and client-context alias — which is exactly the pre-adapter line D2
asks for — and it is also the moment the ticker starts. One call site, one payload, no second
mechanism to keep in step.

The payload names those fields and nothing else. It carries no adapter input, no launcher record,
and no policy object, so the boundary criterion becomes a property of the type rather than a habit
of the formatter: there is no field on it through which a launcher command could arrive.

The terminal line needs no notification of its own. `runReview` returns the `StatusDocument`,
which already holds `state`, `verdict`, and `reason_code`; the CLI writes the line from the
returned value and stops the ticker in the same `finally` that covers every exit from the call,
thrown errors included. One start, one stop, and no path where a stop can be missed. The elapsed
lines therefore span from just before `adapter.start` to the moment the run returns, which
includes `verify` and the snapshot diff — sub-second work in the measured run, and not worth a
second signal to exclude.

The ticker is exported from `src/cli/main.ts` and takes its stream, its clock, and its timer
functions as arguments, the way `0016`'s `newestFileMtime` and `isBuildStale` take theirs, so the
cadence and the TTY gate are tested against fakes instead of against a real two-minute wait. The
interval is unref'd, so a process that has otherwise finished never stays alive for a pending
timer.

## Work Completed

- Planner HX-001 (Claude Code, Claude Opus 5, high effort, Anthropic): measured the 112 s gap,
  recorded D1–D4 after `STDERR-NOW-SHARED` from task `0016`. Plan-only; no product file changed.

- Plan review HX-002 (Cursor, cursor-grok-4.6-high-fast, effort none, run `run-f8908217`):
  APPROVED with no findings.

- Implementer HX-003 (Cursor, cursor-grok-4.6-high-fast, effort none):
  accepted matching envelope HX-003. Implemented D1–D4 in the named scope:
  - `runReview` takes an optional `progress` argument beside `deps`, called once after
    `review_started` with run id, host, model, effort, and client-context alias.
  - Only the CLI `review` branch passes it, via `runWithElapsedTicker`; MCP `session.ts` still
    calls `runReview(input, deps)` and stays silent.
  - Exported `startElapsedTicker(stream, clock, timer)`: 10 s elapsed lines on TTY, no interval
    off TTY, unref'd, stopped in one `finally`.
  - Terminal line from the returned `StatusDocument`; reason code only when `verdict` is null.
  - stderr tests stage a package root through `main`'s third parameter. `0016`'s four helpers are
    untouched; `main` writes the existing warning to the same stderr handle used by this task,
    still before `parseArgv`.
  - One README line describes the terminal output.
  All acceptance criteria checked. `npm run typecheck` exited 0. `npm test` exited 0 (124 passed).

- Implementation review HX-004 (Claude Code, Claude Opus 5, high effort, Anthropic): accepted the
  matching envelope HX-004, read product files only, and wrote this artifact alone. Verdict
  `APPROVED`; four informational findings recorded under Review.

## Evidence

- `npm run typecheck` exited 0. `npm test` exited 0 (124 passed).
- Captured CLI stdout round-trips through `serializeStatus`; MCP stderr on a driven `tools/call`
  of `review` is empty.
- Ticker cadence and TTY gate are asserted against fake stream/clock/timer, including throw and
  `prepare` failure teardown. Stale-build order is asserted through `main(..., stagedBuildFile)`.
- Diff does not edit `packageRootFromRunningModule`, `newestFileMtime`, `isBuildStale`, or
  `staleBuildMessage`.
- Run `run-3469f5ae` and `run-83f774f5` measured the silent adapter gap this ticker covers.
- Payload fields are run id, host, model, effort, and client-context alias; launcher command and
  credential-shaped values are absent from the type and from captured stderr.

- Review round re-ran both checks in the current worktree: `npm run typecheck` exited 0;
  `npm test` exited 0 with 124 passed, 0 failed.
- `git diff -U0 -- src/cli/main.ts` matches none of `packageRootFromRunningModule`,
  `newestFileMtime`, `isBuildStale`, or `staleBuildMessage` on a changed line.
- `grep` over `src/cli/main.ts` and `src/core/review.ts` finds no `\r`, `\x1b`, `\u001b`, or
  `\033` literal.
- `src/mcp/session.ts:140` still calls `runReview(input, deps)` with two arguments; `ReviewProgress`
  is a third positional parameter and not a field of `AppDeps`.
- Round diff is `README.md`, `src/cli/main.ts`, `src/core/review.ts`, three test files, and this
  artifact. The work is uncommitted; committing is the human-only gate.

## Review

<!-- spartan-bridge:review:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-f8908217-ae1b-4507-9bb2-233b1069b052 execution_id=exec-a5bbc268-9e8b-443f-bcdf-b9c49259fbbd review_kind=plan verdict=pass reason_code=review_passed host=cursor launcher=cursor-plan-reviewer-v1 model=cursor-grok-4.6-high-fast effort=none model_observed=declared_unobserved policy_digest=sha256:5ce5ce183767d86bbd03d6217f03b8849dd70c4a7609b5b84f750ecbb1d0100f task_hash=sha256:858f751fb6bcdb69cb5557838c36af0f6d43e9de40350cb1d4df8d60a6afa1eb agents_hash=sha256:30644e4ddfe923cc72bc6a40fd5d26c1af74682d01e4329f4c5d93016be00e7f timestamp=2026-08-18T20:22:24.750Z
<!-- spartan-bridge:review:end -->

### Implementation review (HX-004, Claude Code, Claude Opus 5, high effort, Anthropic)

Verdict: APPROVED. Accepted the matching envelope HX-004; product files were read only, and only
this artifact was written. The Bridge-owned region above records the earlier `plan` review and is
untouched.

Four claims carried the risk, and each was checked against the diff rather than against the
implementer's summary.

- **stdout is unchanged by construction, not only by assertion.** The `review` branch still writes
  `serializeStatus(outcome.status!)` and nothing else to stdout; the only edit on that line swaps
  `process.stdout` for the `stdout` binding that `main` resolves as `io.stdout ?? process.stdout`.
  Both new stderr writes sit on a different handle. So the byte-identity criterion holds from the
  expression itself, which is stronger evidence than the tests offer — see `STDOUT-BEFORE-AFTER`.

- **MCP silence is structural, as D4 required.** `ReviewProgress` is a third positional parameter
  of `runReview`, not a field of `AppDeps`, and `src/mcp/session.ts:140` still passes two
  arguments. A later addition to `AppDeps` therefore cannot reintroduce progress on the stdio
  path without editing that call site. The driven `tools/call` test asserts the harness stderr is
  empty rather than inferring it from the type.

- **The ticker cannot outlive the call, on all three exits.** `runWithElapsedTicker` assigns
  `ticker` inside the `started` callback and stops it in `finally`. Normal return and a thrown
  body both clear it; a `prepare` failure never fires `started`, so `ticker` stays `undefined` and
  `clearInterval` is never reached. The test asserts `cleared === false` for that third case,
  which is the correct assertion — a spurious clear would mask a ticker that never started. The
  handle is unref'd before it is returned.

- **The TTY gate sits on the interval, not on the write.** `startElapsedTicker` returns a no-op
  before touching `timer.setInterval`, so off a TTY no interval exists at all rather than one
  whose callback declines to write. The off-TTY tests supply a `setInterval` that throws or sets
  a flag, so an implementation that gated one level too late would fail them rather than pass by
  producing the same output.

D3's shared-stream rules hold. `main` resolves the stderr handle once, ahead of the stale-build
warning, so `0016`'s line and this task's lines travel the same handle — which is what makes the
four-line order assertable at all — while in production that handle is `process.stderr` and
`0016`'s bytes are unchanged. `git diff -U0` on `src/cli/main.ts` matches none of the four named
helpers on a changed line. No cursor control reaches the stream: the byte assertions reject `0x0d`
and `0x1b`, and a grep of both changed sources finds no escape literal to begin with. The
boundary criterion is a property of the payload type — `ReviewStartedProgress` names five fields,
`launcher_id` is deliberately not among them although it sits on the `ResolvedPolicy` the payload
is built from, and a test pins the key set exactly.

Scope held: the round's diff is `README.md`, `src/cli/main.ts`, `src/core/review.ts`, three test
files, and this artifact. No event type, no `StatusDocument` field, no timeout or spawn change.
`npm run typecheck` clean; `npm test` 124 pass, 0 fail, up from 107 at task `0016`.

Findings, all informational; none blocks approval and no product file was changed to record them:

- `ELAPSED-WALL-CLOCK` (info): the default clock is `Date.now()`, so a system clock adjustment
  during a two-minute review makes the elapsed number jump or run backwards. The line is display
  only and the fake-clock seam means a monotonic source could be substituted later without
  touching the ticker; not worth a change on its own.
- `TICKER-SINGLE-START` (info): `runWithElapsedTicker` overwrites `ticker` if `started` fires a
  second time, orphaning the first interval. `runReview` calls it exactly once, so this is
  unreachable today — but the invariant lives in the core while the leak would occur in the CLI,
  and nothing in the CLI states the dependency.
- `README-TTY-SCOPE` (info): the README line opens "On a terminal," and then lists all three
  stderr behaviours. It is true as written, but only the elapsed lines are TTY-gated; the resolved
  and terminal lines print off a TTY too, which is exactly the distinction two acceptance criteria
  turn on.
- `STDOUT-BEFORE-AFTER` (info): the criterion asks for captured stdout compared before and after
  the change; the tests assert a `serializeStatus` round-trip instead, which would also pass for a
  changed-but-still-canonical document. The unchanged write expression carries the real proof, so
  the gap is in the test's strength, not in the behaviour.

## Blockers

None. The 2026-08-18 `adapter_error` on run `run-83f774f5` was a Cursor API outage; the identical
command dispatched and passed as run `run-f8908217` once it cleared, with no change to the plan
and no deviation from the `reviewer.plan` binding.

Non-binding note, not work on this task: `adapter_error` is all the run says. Whether the adapter
failed to start, timed out, or reached an API that was down is not in the status document, the
event log, or the run directory, so an outage and a broken launcher are indistinguishable after
the fact. That is a candidate for its own task, and it is out of scope here — this plan adds no
event type and no `StatusDocument` field.

## Next Action

None. Every acceptance criterion is checked, `npm run typecheck` and `npm test` have recorded
outcomes, the plan review and the implementation review are both `APPROVED`, and no blocker
remains. Committing is the human-only gate.

## Next Handoff

No outstanding proposal. This task is closed.

Non-binding note for the human: the change is uncommitted, and `dist/` is now older than `src/`,
so the next `spartan-bridge` run from this checkout will print `0016`'s own stale-build warning
until it is rebuilt. The four informational findings above are candidates for a follow-up, as is
the `adapter_error` ambiguity already recorded under Blockers.
