---
protocol: "1.0.0" # x-release-please-version
id: say-what-the-run-is-doing-while-it-waits
created_at: 2026-08-18
status: completed
phase: complete
task_type: implementation
risk: material
current_role: reviewer
next_role: none
updated_at: 2026-08-18
handoff_id: HX-004
next_handoff_id: none
---

# Say what the run is doing while it waits

## Objective

A human waiting on `spartan-bridge review` sees the run advancing on evidence coming from the
reviewer itself, not a clock counting up. The bytes on the Bridge's own stdout stay exactly what
they are today.

## Context

Task `0014` shipped a ten-second elapsed ticker on stderr, which fixed "is it alive" and left "what
is it doing" open. The remaining complaint is the owner's, stated directly: `elapsed 10s … elapsed
100s` says nothing, and the wait is the main reason the Bridge feels unpleasant enough to be used
less than it should be.

**The silence is one span, and that is what rules out the cheap fix.** Measured on three real runs
in `.spartan-bridge/runs/`:

| Run | `run_requested` → `review_started` | `review_started` → result |
| --- | --- | --- |
| `run-21c298d5` | 0.8s | 77.3s |
| `run-3532e742` | 0.8s | 108.1s |
| `run-0a60d538` | 0.5s | 137.9s |

Every existing event fires inside the first second; the entire wait is one gap. That gap sits
inside a single lifecycle hook — `collect()` awaiting `handle.wait()` — so reporting the hook the
runtime is in, which task `0018` just gave a seven-value vocabulary for, converts `elapsed 108s`
into `collect 108s` and changes nothing about the silence. This is the same trap `0014` D2 already
documented one layer up, and it is recorded here so the plan review does not have to rediscover it.
The runtime has no observation of its own to report inside that span. Only the child does.

**The child can be asked to narrate, and the installed client already supports it.** Probing the
installed `cursor-agent` with the same `--help` call `preflight()` makes:

```
--output-format <format>   text | json | stream-json (default: "text")
--stream-partial-output    Stream partial output as individual text deltas
                           (only works with --print and stream-json format)
```

`CURSOR_REVIEW_ARGV_PREFIX` currently passes `--output-format json`, which is why the child says
nothing until it says everything. `stream-json` is a documented, structured, incremental interface
to the same run.

**The distinction that makes this affordable.** The child's stdout is not the Bridge's stdout. The
child's bytes are read inside `collect()` and parsed by `extractReviewPayload`; the Bridge's stdout
is the single status JSON that task `0014` D1 made a contract. Changing the child's output format
does not touch that contract, and a review that reads "argv change → stdout change" without this
distinction will reject the task for the wrong reason.

## Scope

- `src/adapters/cursor.ts`: the review argv table, the stdout reader, and `extractReviewPayload`'s
  contract for a streamed payload.
- `src/adapters/process.ts`: an incremental read seam, so stdout is observable before the child
  exits rather than only accumulated.
- `src/core/review.ts`: extend `ReviewProgress` beyond `started()` with the progress signal this
  task settles, called from the `collect` span.
- `src/cli/main.ts`: render the new signal in place of, or beside, the elapsed line.
- `CURSOR_REVIEW_STDOUT_CAP` and the 64 KiB stderr accumulation in `process.ts`, if D5's
  measurement says `stream-json` volume needs them re-sized.
- `docs/DECISIONS.md`: one entry. `docs/AUTHENTICATION-AND-SECURITY.md`: one paragraph if D4 lets
  any provider-derived value reach the terminal.
- Tests over captured stderr bytes with a fake clock and a stub runner, in the manner `0014`
  established.

## Out of Scope

- The Bridge's own stdout. Task `0014` D1 stands: the status JSON is byte-identical.
- `EventDocument`, `events.jsonl`, and `StatusDocument`. Progress is for a person watching in real
  time; it is not persisted runtime truth, and a run's record is unchanged by this task.
- The MCP path. Task `0014` D4 made its silence structural by keeping the sink an argument rather
  than a dependency; that stays, and no progress reaches a program caller.
- The stale-build warning from task `0016`. Task `0014` D3 fixed the order and forbade re-siting
  it; unchanged here.
- The ten-second cadence and the TTY gate from `0014` D2, except where D6 below adapts them to a
  signal that is no longer a timer.
- Retry, cancellation, or any reaction to what the stream reports. This task narrates; it does not
  intervene.
- The plan-review chaining the owner wants next. That is a separate task and needs an `AGENTS.md`
  amendment.

## Constraints

- The Bridge's stdout is byte-identical for every run that succeeds today and every run that fails
  today.
- No credential, token, account identifier, launcher command, absolute path, or home-directory
  prefix may reach the terminal. Provider-derived text is untrusted under task `0018` D5, and the
  redaction pass in `src/policy/redact.ts` already exists to be reused rather than reinvented.
- Every line written is whole and ends in `\n`. No carriage return, cursor movement, erase
  sequence, or spinner rewriting itself in place — task `0014` D3, which owns the shared stream.
- The argv table stays a constant table with no shell interpolation, and no token on
  `CURSOR_FORBIDDEN_ARGV_TOKENS` is introduced.
- A run whose child does not support `stream-json` degrades to today's transport by the mechanism
  in D3b, and never fails for having been offered the flag.
- Nothing the child emits reaches the terminal. Progress lines carry only Bridge-maintained counts
  and Bridge-owned class names, per D4.
- No new runtime dependency.

## Acceptance Criteria

- [x] The Bridge's stdout for a passing run and for each failing run is byte-identical to the
      current build, asserted over captured bytes rather than by inspection.
- [x] With stderr a TTY, a review run whose child emits streamed output writes progress lines that
      change as the child advances, and a test drives this from a stub runner rather than a real
      `cursor-agent`.
- [x] With stderr not a TTY, the run writes no progress line at all, matching `0014` D2.
- [x] Every progress line is whole, ends in `\n`, and contains no ESC, `\r`, or cursor-control
      byte, asserted over captured bytes.
- [x] A stub child that emits a credential-shaped string, an absolute home path, an ESC byte, and
      an unrecognised record kind in its streamed output produces terminal bytes containing none of
      them and no substring of the child's own text, and the run still completes normally. The
      assertion is that only allowlisted class names and Bridge-maintained counts appear, not that
      the named samples were filtered out.
- [x] `extractReviewPayload` returns the same value for the streamed transport as it does for the
      current single-document transport, over the fixtures that pin its behaviour today.
- [x] `extractReviewPayload` accepts both the streamed and the single-document shape regardless of
      what the probe detected, so a client that acknowledges the flag and ignores it still parses.
- [x] The MCP path emits no progress, asserted by driving `runReview` through the MCP session
      rather than by trusting the type.
- [x] A timeline of one real `stream-json` review is recorded in Evidence, giving each record's
      arrival time relative to `review_started`. The argv change ships only if records arrive
      spread across the wait; if they arrive in one burst at the end, the argv change is not made
      and the task reports that instead.
- [x] Stdout is consumed incrementally and the bytes retained are the payload plus counters, with
      the cap applied to retained bytes. Total observed volume is recorded. If
      `CURSOR_REVIEW_STDOUT_CAP` still changes, the new limit and the behaviour of a run that
      exceeds it are both stated.
- [x] With the probe reporting no `stream-json` support, the run keeps `--output-format json` and
      behaves exactly as the current build, asserted from a stub `--help` output.
- [x] `npm run typecheck` and `npm test` exit 0.

## Decisions

### D1 - Naming the lifecycle phase is not the answer, and is not the deliverable

Recorded so a reviewer does not propose it as the cheap alternative. The three measured runs put
100% of the wait inside one hook, so the seven-value `AdapterFailurePhase` vocabulary task `0018`
added would render `collect 108s` and leave the span as silent as it found it. A phase label is
worth at most one line at the boundary and is not what this task is for.

### D2 - The child's stdout is not the Bridge's stdout

Stated as a decision because it is the load-bearing distinction and it is easy to misread. Task
`0014` D1 made the Bridge's stdout a contract: one status JSON, nothing else. The child's stdout
is an internal transport read by `collect()` and parsed by `extractReviewPayload`. Changing the
child's `--output-format` changes the transport and not the contract. The first acceptance
criterion pins the contract over captured bytes so this is checkable rather than asserted.

### D3 - Ask the child to narrate, but prove it narrates before shipping the argv change

Two sources could carry movement inside the silent span. The child's stderr is already accumulated
live at `src/adapters/process.ts:81` and would need no argv change — but nothing documents what
`cursor-agent` writes there, and a progress feature built on undocumented incidental output breaks
on a client update with no signal. `--output-format stream-json` is a documented interface to the
same run, and the installed client offers it. So the transport is the source, and the stderr
accumulation keeps its current job: failure evidence for task `0018`, not progress.

**The go/no-go, added after review finding `D3_LIVE_STREAM`.** The evidence for this decision was
one `--help` listing, and that same listing attributes incremental streaming to
`--stream-partial-output`, which this plan defers. Plain `stream-json` may therefore be a verbose
envelope that still arrives in one burst at the end — which would buy volume and cap risk and leave
`elapsed 108s` exactly as silent as today. That is unresolvable from documentation.

So the first implementation step is a measurement, and it gates the rest: capture one real review
under `stream-json`, recording each record's arrival time relative to `review_started`. If records
arrive spread across the wait, the argv change ships. **If they do not, the argv change is not
made**, the finding is recorded, and `--stream-partial-output` becomes the next candidate with its
own decision and its own measurement. An implementer who ships the transport change without that
timeline has skipped the only thing that distinguishes this task from a volume increase.

### D3b - The fallback is a mechanism, not an intention

Added after review finding `D3_DEGRADE_PATH`. The constraint said a client without `stream-json`
must degrade rather than fail, and named no way to do it; always passing the flag can make such a
client fail harder than today's transport.

The mechanism reuses what exists. `preflight()` already runs `--help` and already inspects its
output against `CURSOR_HELP_TOKENS`; support for the `stream-json` value is read there, in the
probe the run already pays for. Absent, the review argv keeps `--output-format json` and the run
behaves exactly as today, progress included. And `extractReviewPayload` accepts **both** shapes
regardless of what the probe found, so a client that acknowledges the flag and then ignores it
still parses. Detection chooses the argv; the parser never depends on the detection being right.

### D4 - Only Bridge-owned vocabulary reaches the terminal; nothing of the child's is relayed

Task `0018` D4 settled that provider-controlled text does not go where the Bridge's own output
goes. The same reasoning applies with more force here, because a terminal interprets bytes:
relaying model output onto a TTY hands an untrusted string the ability to move the cursor, which
`0014` D3 forbids on a stream shared with another writer.

**The exception this decision used to carry is removed**, per review finding `D4_RELAY_EXCEPTION`.
The earlier wording allowed a provider-derived substring through if it passed
`redactAdapterStderrText` and was truncated — which is the tempting implementation the decision
itself said to reject, arriving through the back door. Redaction is a filter for a `0600` file
whose reader chose to open it; it is not a licence to put provider bytes on a device that acts on
them. It stays as defence in depth and is not the primary control.

So the rule is closed, and it is a property of the type rather than a habit of the formatter:

- A progress line is composed of **counts the Bridge itself maintains** and **a class from a
  Bridge-owned allowlist** — for example `working`, `tool`, `result`, `quiet`. The allowlist is
  fixed in the Bridge's source.
- A record whose kind is not on the allowlist maps to a listed class or is counted and otherwise
  ignored. Its own `type` string is never printed.
- Child prose, tool names, tool arguments, paths, identifiers, and payload contents never reach
  the terminal, redacted or not.
- Control-byte rejection is asserted anyway, so a defect in the mapping cannot become a terminal
  escape.

The child chooses what to say; the Bridge chooses, from a closed list it wrote, what that means.

### D5 - Parse incrementally and retain little; the cap is not the knob to turn

Overflowing `CURSOR_REVIEW_STDOUT_CAP` (4 MiB) raises `output_overflow` and would turn runs that
pass today into runs that fail. The earlier response — measure one review, then keep or raise the
cap — sizes the wrong knob, per review finding `D5_CAP_STRATEGY`: `stream-json` is a verbose
envelope over the same underlying run, so raising the cap buys headroom by retaining more untrusted
bytes in runtime state, which is the opposite of what this repository's boundary asks for.

The design is therefore to retain less rather than allow more. Stdout is consumed incrementally as
it arrives; what is kept is the payload `extractReviewPayload` needs plus the Bridge's own
counters; and the cap applies to **retained** bytes, not to everything that ever crossed the pipe.
Total volume is still measured and recorded, because it sizes the read path and confirms the
retention actually bounds it — but the measurement informs the design rather than justifying a
larger buffer.

One review is not a bound. If the cap must still rise after that, the plan states the new limit and
what happens to a run that exceeds it, rather than raising it until the observed case fits.

### D6 - The ticker survives, subordinate to the stream

The elapsed line is not deleted. A child that goes quiet for ninety seconds mid-stream leaves the
same silence this task exists to remove, and the clock is the only signal that still works then.
The stream drives the output when it is moving; the ten-second cadence from `0014` D2 remains the
floor beneath it. The exact composition is the implementer's, within the whole-line and TTY rules.

## Work Completed

- Planner HX-001 (Claude Code, claude-opus-5, effort high, Anthropic): created this task. Measured
  the silent span on three archived runs, probed the installed client's supported output formats,
  and settled D1-D6. No product file was edited.

- Plan review, cycle 1 (Cursor via the Bridge, cursor-grok-4.6-high-fast, effort none): `CHANGES_REQUESTED` with four findings, run `run-6af9f946`, 67 seconds. All
  four accepted; none contested.

- Planner response, cycle 1 (Claude Code, claude-opus-5, effort high, Anthropic): revised the plan
  against each finding.
  - `D3_LIVE_STREAM`: D3 now gates the argv change behind a measured arrival timeline, and states
    that the change is not made if records arrive in one burst. The finding is right that the only
    evidence was a `--help` listing which attributes incremental streaming to a flag this plan
    defers.
  - `D4_RELAY_EXCEPTION`: D4's escape hatch is removed. Progress lines are composed only of
    Bridge-maintained counts and a Bridge-owned class allowlist; no child substring reaches the
    terminal, redacted or not, and redaction returns to being defence in depth.
  - `D3_DEGRADE_PATH`: new D3b names the mechanism — read `stream-json` support in the `--help`
    probe `preflight()` already makes, keep the json argv when absent, and have the parser accept
    both shapes regardless of what detection concluded.
  - `D5_CAP_STRATEGY`: D5 now retains less rather than allowing more — incremental consumption,
    retention limited to the payload plus counters, cap applied to retained bytes. Volume is still
    measured, to size the read path rather than to justify a bigger buffer.

- Plan review, cycle 2 (Cursor via the Bridge, cursor-grok-4.6-high-fast, effort none): `APPROVED`, no findings, run `run-ea7a69b2`, 105 seconds. The plan is closed and
  the task moves to implementation.

- Implementer HX-003 (Cursor, cursor-grok-4.6-high-fast, effort none): D3
  go/no-go measured one real `stream-json` review. Records arrived throughout the wait, so the argv
  change shipped. Incremental parser, TTY progress lines (`working` / `tool` / `result` plus
  counts), json fallback when `--help` lacks `stream-json`, and D4/D5/D6 as planned. Cap stays
  4 MiB on retained bytes. `docs/DECISIONS.md` D-019 and one `AUTHENTICATION-AND-SECURITY.md`
  paragraph. `npm run typecheck` and `npm test` exit 0 (142 passed); `npm run build` rebuilt
  `dist/`.

- Implementation review HX-004 (Cursor, Grok 4.6, no user-selectable effort):
  accepted the matching envelope HX-004. Read product files only and wrote this artifact alone.
  Verdict `APPROVED`; no findings. Same model vendor as the implementing round; independence is
  advisory and the human chose this host.

## Evidence

- Event timings from `.spartan-bridge/runs/run-21c298d5`, `run-3532e742`, and `run-0a60d538`:
  every event within 0.8s of the start, then a single 77.3s / 108.1s / 137.9s gap to the result.
- `cursor-agent --help` on the installed client lists `--output-format text | json | stream-json`
  and `--stream-partial-output`. Non-authenticating probe, identical to the one `preflight()`
  already makes.
- Pre-change baseline (planning): review argv used `--output-format json`; `ReviewProgress` had
  only `started()`; child stderr was accumulated live to 64 KiB for failure evidence. Superseded
  by the HX-003 implementation.

- Plan review cycle 1: `spartan-bridge review --repo . --task spartan/tasks/0019-…md` returned
  `changes_requested` / `review_changes_requested` in 67s, run `run-6af9f946`,
  `task_write_state: written`. The run emitted the task `0016` stale-build warning first: the
  installed `dist/` is from 18/08 18:27 and predates task `0018` (`grep -c adapter_failure
  dist/core/serialize.js` returns 0). The verdict is unaffected, because the reviewer workspace
  receives only `task.md` and `AGENTS.md`; a rebuild is needed before the implementation round.

- Plan review cycle 2: same command returned `pass` / `review_passed` in 105s, run `run-ea7a69b2`,
  `task_write_state: written`. The stale-build warning is absent and the status document carries
  `adapter_failure: null`, confirming the rebuilt `dist/` now includes task `0018`.

- D3 go/no-go (HX-003): one real `cursor-agent -p --output-format stream-json` review of this
  task's `task.md` + `AGENTS.md` workspace, same argv table as the adapter except the format value,
  declared model `cursor-grok-4.6-high-fast`. t0 is spawn, the analogue of `review_started`.
  exit 0, close 134016ms, stderr 0 bytes, stdout observed 223982 bytes, 1372 chunks, 1377 records.
  First record +3350ms (`system/init`, `user`); last record +133495ms (`assistant`, then
  `result/success`). Span 130145ms. Not a final burst. Kind counts: `thinking/delta` 1366,
  `thinking/completed` 2, `assistant` 2, `tool_call/started` 2, `tool_call/completed` 2,
  `system/init` 1, `user` 1, `result/success` 1. Per 10s window from t0: 17, 76, 138, 125, 100,
  118, 115, 112, 152, 123, 85, 102, 112, 2 records. **Go: argv change ships.** Payloads were not
  retained; only `type`/`subtype`, sizes, and arrival offsets. `CURSOR_REVIEW_STDOUT_CAP` stays
  4 MiB and applies to retained bytes. A run that exceeds retained cap still fails
  `output_overflow`.

- `npm run typecheck` exit 0. `npm test` 142 passed, 0 failed. `npm run build` exit 0.

- Review round re-ran both checks in this worktree: `npm run typecheck` exit 0; `npm test` 142
  passed, 0 failed. `src/cli/main.ts` and `src/adapters/review-stream.ts` contain no `\r`, ESC, or
  cursor-control literal. `src/mcp/session.ts:140` still calls `runReview` with two arguments.
  `formatReviewStreamLine` interpolates only `class`, `records`, and `tools`. Cursor
  `observedModel()` remains `null`.

## Review

<!-- spartan-bridge:review:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-ea7a69b2-6b09-42e1-bad5-30b8660d403f execution_id=exec-2b5fb521-6bd5-4e23-b411-4d3a76cba9a4 review_kind=plan verdict=pass reason_code=review_passed host=cursor launcher=cursor-plan-reviewer-v1 model=cursor-grok-4.6-high-fast effort=none model_observed=declared_unobserved policy_digest=sha256:5ce5ce183767d86bbd03d6217f03b8849dd70c4a7609b5b84f750ecbb1d0100f task_hash=sha256:b8d4729dc4a789dddfeb115bb704a01e80c015c51df13db73ff8d9b3d5488004 agents_hash=sha256:30644e4ddfe923cc72bc6a40fd5d26c1af74682d01e4329f4c5d93016be00e7f timestamp=2026-08-18T23:57:10.445Z
<!-- spartan-bridge:review:end -->

The region above holds the cycle-2 plan verdict. It is not the implementation review and is left
in place as the plan-review record.

### Implementation review (HX-004, Cursor, Grok 4.6, no user-selectable effort)

Verdict: APPROVED. Accepted the matching envelope HX-004; product files were read only, and only
this artifact was written.

D1 through D6 hold on the diff, not on the implementer's summary.

- **D1.** Progress is stream class names and counts, not `AdapterFailurePhase`. `collect()` still
  awaits `handle.wait()` as one span; the new signal is `ReviewProgress.stream` fed from parsed
  child records.
- **D2 / stdout.** The `review` branch still writes only `serializeStatus(outcome.status!)` to
  stdout. Stream lines go to the stderr handle inside `runWithElapsedTicker`. Status JSON gains no
  progress field.
- **D3.** The recorded timeline (first record +3.4s, last +133.5s, 1377 records, 14 non-empty 10s
  windows summing to 1377) is internally consistent and is a spread, not a final burst. The argv
  change was allowed to ship. `--stream-partial-output` is absent from both argv tables.
- **D3b.** `preflight()` sets `streamJsonSupported` from `--help`. Absent `stream-json`,
  `CURSOR_REVIEW_ARGV_PREFIX` (`json`) is used and stdout is retained. `extractReviewPayload`
  unwraps both the json wrapper and NDJSON `type=result` regardless of that flag. A probe that
  advertised stream-json while the child still emitted a json document still parses: a typeless
  object goes to `residual` and through the same extractor.
- **D4.** `formatReviewStreamLine` cannot print child text. `classForRecordType` maps to a closed
  four-name list; unknown kinds are counted and otherwise ignored. The TTY test feeds a
  credential-shaped string, a home path, an ESC byte, and `weird_kind`; none appear on stderr, and
  the run still passes. `apiKeySource` on `system/init` is parsed only for `type` and discarded;
  `observedModel()` stays `null`.
- **D5.** With stream-json, `retainStdout: false`. The parser keeps `resultText`, `residual`, and
  the incomplete line; thinking records are not accumulated. Cap remains 4 MiB on
  `retainedBytes()`; overflow still terminates `output_overflow`. The parser unit test asserts
  observed volume exceeds retained bytes after 40 thinking lines.
- **D6.** The ten-second `elapsed Ns` ticker still starts only on a TTY after `started()`. Stream
  lines write immediately on class change; same-class count updates ride the ticker floor. Off a
  TTY, neither elapsed nor stream lines are written.

MCP silence is still structural: `session.ts:140` passes two arguments, so a streaming child
cannot reach that stderr. FakeAdapter tests that never emit stream records still show the 0014
elapsed-only order.

Findings:

- None recorded.

## Blockers

None.

## Next Action

None. Every acceptance criterion is checked, `npm run typecheck` and `npm test` have recorded
outcomes, the plan review and the implementation review are both `APPROVED`, and no blocker
remains. Committing is the human-only gate.

## Next Handoff

No outstanding proposal. This task is closed.

Non-binding suggestion:

```text
Recommended execution (human decides):
- Host: Claude Code, cockpit and planning for an `AGENTS.md` automation-authority amendment
- Model and effort: Claude Opus, high effort
- Invocation: `/spartan` in Claude Code, passing the prompt block below as the argument
```

```text
Create a uniquely numbered artifact from `assets/task-template.md` in `spartan/tasks/` for the plan-review chaining already named as the next Bridge step after task 0019.

Act as planner. Settle the `AGENTS.md` automation-authority amendment and the bounded first slice for chaining a human-started plan review into the next producer round. Success is a reviewable plan with decisions and acceptance criteria in that new task file.
Run the relevant repository checks and update that new task file.

Return only the next handoff, or a completion notice if no work remains.
```
