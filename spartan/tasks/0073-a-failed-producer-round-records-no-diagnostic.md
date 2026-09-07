---
protocol: "1.1.0" # x-release-please-version
id: a-failed-producer-round-records-no-diagnostic
created_at: 2026-09-05
status: active
phase: planning
task_type: planning
risk: material
current_role: planner
next_role: planner
updated_at: 2026-09-05
handoff_id: HX-004
next_handoff_id: none
---

# A failed producer round records no diagnostic, and `wait` repeats the stale-build warning on every poll

## Objective

Two operator-facing defects on the detached auto-chain path, both observed in
one session on 2026-09-05:

1. When a mapped producer round ends `producer_failure` / `exit_nonzero` or
   `producer_timeout`, the terminal record classifies the failure as far as a
   closed record can. Today it records that the round died and nothing about
   what killed it — a provider rate limit and a failed test are byte-identical
   in the artifacts the round leaves behind.
2. A `wait` poll loop does not repeat the D-031 stale-build warning once per
   poll on a stream an operator or a script is reading for documents.

They are one task because they are the same failure mode seen from two sides:
the detached chain is followed through `wait`, and both defects degrade exactly
that following — one by withholding the reason a round died, the other by
filling the channel with a line that carries no new information.

**Scope of the first objective, stated honestly.** Two plan-review cycles
established that no design in this repository may persist a producer client's
raw output (D3a). What this task therefore delivers is classification, not
transcript: the failure classes the client itself declares in machine-readable
form become visible, and the remainder stays unexplained. D3 names exactly
which failures this closes and which it does not.

## Context

Observed on task `0053`. The first automatic implementer round
(`transition-b755de18-b0c2-423d-a723-5906999b8333`, Codex,
`run-a9227097-d458-42c8-8576-773e162e16dd`) ran for about 40 minutes and
stopped with:

```json
"reason_code": "producer_failure",
"producer_diagnostic": {"stage":"exit_nonzero","exit_code":1,"timed_out":false,
  "write_scope_code":null,"adapter_phase":null,"adapter_cause":null,"waited_ms":null}
```

`adapter_failure`, `payload_log`, and `output_excerpt` were all `null`. The
transition directory held exactly two files, `events.jsonl` and `status.json`,
and the event log held four lines — `authorization`, `lock_acquired`,
`producer_started`, `terminal_stop`. Nothing recorded why the producer stopped,
and nothing distinguished a client that gave up from a provider that refused.

The operator recovered only by running the repository's own checks by hand
against the 26-file partial implementation the round had left in the worktree,
finding one failing test, and reading its assertion. That worked, and it worked
by accident: the round happened to leave a reproducible tree.

**The classification the reviewer side already makes, the producer side does
not.** Task `0064` shipped `src/adapters/provider-failure.ts`:
`classifyProviderFailure(stdout)` keeps the last object whose `type` is exactly
`"result"` and reads only three structured fields — `is_error` (boolean),
`api_error_status` (integer, `100..599`), and `terminal_reason` (compared only
to the literal `"api_error"`) — returning a Bridge-owned enum plus an integer.
All four adapters call it on the **review** path (`codex.ts:478`,
`cursor.ts:565`, `grok.ts:434`, `claude.ts:392`). None calls it on the producer
path, although every producer spawn already requests the same machine-readable
output: Codex `--json` (`CODEX_PRODUCER_ARGV_AFTER_WORKSPACE`,
`codex.ts:76`), Cursor `--output-format json`
(`CURSOR_PRODUCER_ARGV_PREFIX`, `cursor.ts:75-83`), and Grok
`--output-format json` (`GROK_PRODUCER_ARGV_SUFFIX`, `grok.ts:85-91`). So a
producer round that dies on a `429` records exactly what a producer round that
dies on a failing test records: `exit_code: 1`.

**The bytes exist and are discarded at the adapter boundary.**
`NodeProcessHandle` accumulates `stdout` and `stderr` for every spawn it owns
(`src/adapters/process.ts:70-71`, filled by the `data` handlers at `:92-109`
and `:110-114`), and `SpawnOutcome` (`:31-38`) carries them out of the `close`
handler at `:119-129`. Every real producer spawn sets `retainStdout: true`
(`codex.ts:645`, `cursor.ts:717`, `grok.ts:581`). But `waitProducer()` narrows
the result to `{ exitCode, timedOut }` in all four bodies
(`codex.ts:656-667`, `cursor.ts:729-743`, `grok.ts:592-606`,
`fake.ts:172-186`) behind the interface declaration at
`src/adapters/adapter.ts:44`, so nothing is classified before the bytes are
dropped. The fix is to classify inside the adapter, where the review path
already classifies, and to keep the bytes there.

**Why the existing diagnostics do not cover this.** Task `0063` gave
`producer_declaration_invalid` a `declaration_invalid_detail`, and tasks `0057`
and `0061` did the same for refused review writes. `producer_failure` /
`exit_nonzero` was left out, and it is the arm that carries the least
information by construction: a non-zero exit says only that the client decided
to stop.

**The second defect.** `main()` writes the D-031 stale-build warning to stderr
for **every** CLI kind and returns 1 only for `review` and `mcp-stdio`
(`src/cli/main.ts:430-437`). Task `0070` pinned that block byte-identical
(its D2: "no override flag or environment variable") and added a separate
end-of-chain line on terminal `wait` documents (D-069, `main.ts:487-495`).
What neither task covered is repetition. Two facts make it unavoidable today:
a chain whose producer edits `src/` makes `dist/` stale by definition — that is
`0070`'s own premise — and **every `wait` poll is a separate CLI process**, so
`main()` re-runs `staleBuildMessage` from the top on each one. A
per-process suppression counter would therefore change nothing. On `0053` a
single follow loop emitted the warning dozens of times, interleaved with the
`{"state":"running"}` documents on the paired streams, and it broke a
`case`-based parse of the merged output. The warning is correct and its
predicate is right; only its repetition on a polling kind is the defect.

**The tension this task must resolve rather than paper over.** D-031 says the
warning signals on every CLI kind, and D-069 restated that "D-031 keeps its
predicate, its message, its exit codes and its per-kind split; there is no
exemption". Suppressing it on `wait` narrows a decision two tasks have now
affirmed. D4 below decides that question and records the amendment explicitly.

## Scope

- `src/adapters/adapter.ts:44` — the `ProducerAdapter.waitProducer()` return
  type. The structural-check arm at `:60` tests only `typeof … === "function"`
  and is unchanged.
- `src/adapters/codex.ts:656-667`, `src/adapters/cursor.ts:729-743`,
  `src/adapters/grok.ts:592-606`, `src/adapters/fake.ts:172-186` — the four
  `waitProducer` bodies, plus `FakeProducerHook.wait` at `fake.ts:69`.
- `src/adapters/provider-failure.ts` — `classifyProviderFailure`, called
  unchanged from a fourth site per real adapter. No edit to this file.
- `src/core/contracts.ts:299-307` — `ProducerDiagnostic` and
  `buildProducerDiagnostic` (`:317-357`).
- `src/core/serialize.ts:140-157` — `serializeProducerDiagnostic`, the
  re-validating whitelist every persisted diagnostic passes through.
- `src/core/transition.ts` — the two arms at `:745-756` and `:757-768` that
  consume `waitResult`.
- `src/cli/main.ts:430-437` — the D-031 warning block (D4).
- `docs/DECISIONS.md` — one dated entry, D-073.
- `docs/AUTHENTICATION-AND-SECURITY.md:736` — the `producer_diagnostic`
  paragraph.
- `README.md:409-420` — the dogfooding paragraph, for the `wait` exemption.
- Tests: `tests/transition.test.ts`, `tests/cli.test.ts`,
  `tests/serialize.test.ts`, `tests/adapter-failure.test.ts`, and the three
  adapter tests that pin `waitProducer`'s shape
  (`tests/codex-adapter.test.ts`, `tests/cursor-adapter.test.ts`,
  `tests/grok-adapter.test.ts`).

Verified as unaffected and deliberately not in scope:
`agent-skill/skills/spbridge/SKILL.md` (D4 answers defect 2 in the runtime and
SKILL.md never described the per-poll warning); `src/runtime/store.ts` and
`src/runtime/transition-store.ts` (no new persisted file); `src/policy/redact.ts`
(nothing new to redact); every producer argv table (the JSON output flags they
need are already there).

## Out of Scope

- Persisting a producer client's stdout or stderr, in any file, field, event,
  or excerpt, redacted or not. D3a is the decision; two plan-review cycles
  reached it.
- Persisting provider payloads. Task `0064` owns the reviewer adapter's
  `adapter-payload.log`, and this task adds no producer counterpart.
- Changing `classifyProviderFailure`, its three read fields, its closed
  mapping, or the reviewer-side call sites. This task adds callers only.
- Changing D-031's predicate, its message, or its exit codes. D4 narrows only
  the set of kinds that emit it; the three named properties are untouched.
- Any change to `reason_code` values, to `ADAPTER_FAILURE_CAUSES`, to
  `SCHEMA_VERSION`, or to the writer lock.
- Re-running or retrying a failed producer round automatically.
- Recording a classification on rounds where the producer exited 0 and the
  Bridge then refused the result. See D2.
- The producer isolation work of task `0053`.

## Constraints

- English artifact.
- `AGENTS.md:121` is a **provenance** prohibition: the Bridge never acquires
  tokens, cookies, authentication files, API keys, Keychain data, browser
  sessions, account identifiers, or credential environment variables from a
  credential store, an environment variable, a command-line argument, a
  configuration value, or an official client's private authentication state.
  A client's own output can carry text derived from that state, so no design
  here may persist it and none may rely on pattern redaction to make it safe.
  `docs/AUTHENTICATION-AND-SECURITY.md:734` states the repository's rule in
  its own words: "Redaction is not the control."
- D-040 D1's invariant on `ProducerDiagnostic` — "every key is a closed
  scalar; there is no free-text field" — holds after this task.
- The `AUTHENTICATION-AND-SECURITY.md:736` ordering invariant holds: the
  diagnostic is constructed inert inside the guarded round, and nothing is
  persisted until the isolation guard has been released.
- No new `ReasonCode` value.
- `npm run typecheck` / `npm run build` clean; `npm test` no new failure.

## Decisions

- **D1 — the producer path reuses `classifyProviderFailure` inside the
  adapter, and `waitProducer()` returns closed scalars only. No buffer crosses
  the adapter boundary, and no producer output is persisted anywhere.**

  Cycles 1 and 2 rejected, correctly, every representation that carries the
  client's own text: a free-text `output_excerpt` on the record, a
  `producer-output.log` file, and an event line. D3a records why. What
  survives is the representation `0064` D1a already established for the
  reviewer side and this repository already ships:

  - `waitProducer()` returns
    `{ exitCode: number | null; timedOut: boolean; provider_cause:
    ProviderFailureCause | null; http_status: number | null; result_is_error:
    boolean | null }`. Every added member is a closed scalar: a two-value
    enum, an integer in `100..599` or `null`, and a tri-state boolean. **No
    `Buffer`, no string, no payload.** The declaration at
    `src/adapters/adapter.ts:44` changes to that shape.
  - `codex.ts`, `cursor.ts`, and `grok.ts` call
    `classifyProviderFailure(outcome.stdout)` on the `SpawnOutcome` they
    already hold, exactly as their `collect()` paths do at `codex.ts:478`,
    `cursor.ts:565`, and `grok.ts:434`, and additionally read
    `is_error` through the same helper. The retained buffers stay local to
    that function and are discarded when it returns. `fake.ts` returns
    `null` / `null` / `null` unless its hook supplies values.
  - `ProducerDiagnostic` gains three closed keys — `provider_cause:
    "provider_limit" | "provider_unavailable" | null`, `http_status: number |
    null`, `result_is_error: boolean | null` — going from seven keys to ten
    and staying free-text-free. `buildProducerDiagnostic` validates each
    against its closed domain and throws a `TypeError` otherwise;
    `serializeProducerDiagnostic` whitelists them and normalizes an
    out-of-domain value to `null`, exactly as it does for the existing seven.
  - `provider_cause` is a **new** key rather than a reuse of `adapter_cause`.
    `adapter_cause` means "an adapter threw with this cause"
    (`producerAdapterThrowDiagnostic`, `transition.ts:866-884`), and the two
    arms this task touches are reached without any throw. Overloading it
    would make the record ambiguous about whether the adapter failed or the
    provider did.
  - `transition.ts` copies the three values from `waitResult` into
    `buildProducerDiagnostic` at the two D2 arms. Nothing else in
    `transition.ts` changes: no new file, no new writer, no change to
    `GuardedRoundOutcome`, `stopTransition`, or the guard-release ordering.

  This closes the operator's most common ambiguity — a provider `429` or `5xx`
  mid-chain is now distinguishable from a code failure, and on `0053`'s own
  session a `429` had already cost a review dispatch elsewhere — without
  persisting one byte the client wrote.

- **D2 — exactly two arms carry a classification: `exit_nonzero`, and the
  `wait`-stage `timed_out` arm. Not every arm, for a mechanical reason and
  then a scope reason.**

  | Stage / arm | Site | A `SpawnOutcome` exists? | Classified |
  | --- | --- | --- | --- |
  | `write_scope_lock` | `transition.ts:680-688` | No process was ever spawned | No |
  | `spawn` | `:703-704`, `:722-724` | `startProducer` threw; no handle is retained | No |
  | `wait`, throw path | `:727-729` | `waitProducer()` rejected | No |
  | `wait`, `timedOut` | `:745-756` | Yes | **Yes** |
  | `exit_nonzero` | `:757-768` | Yes | **Yes** |

  Tier one is mechanism, not policy: the first three rows are reached because
  `waitProducer()` was never called or threw, so there is no stdout to
  classify. The three new fields are structurally `null` there.

  Tier two is scope. Several later arms — `runtime_state_violation`
  (`:770-773`), `write_scope_violation` (`:774-777`), and
  `producer_declaration_invalid` (`:818-835`) — could carry a classification
  and deliberately do not. Those are rounds where the producer exited **0**
  and the Bridge refused the result; a provider-failure classification of a
  successful round is meaningless, and the explanation is already carried by
  `unwritable_plan_targets` and `declaration_invalid_detail` (`0063`).

  Tier three: `producer_timeout` is a different `reason_code` from
  `producer_failure` and is included deliberately. A client that stalls behind
  a provider `429` and a client that stalls on its own work are today
  indistinguishable, and that is the same defect.

  Note that `exit_nonzero` is reached on `waitResult.exitCode !== 0`, which
  includes `null` — a signal-killed child. That is the arm where the exit code
  alone says least.

- **D3 — what this closes, and what it leaves open, named rather than
  implied.**

  Closed by D1: a producer round that failed because the provider rate-limited
  it (`provider_cause: "provider_limit"`, `http_status: 429`), because the
  provider was unavailable (`provider_unavailable`, `http_status` in
  `500..599`, or `terminal_reason === "api_error"` with no status), or that
  carried any other HTTP status the client reported (`http_status` set,
  `provider_cause` null — a `401` stays unclassified with its status
  recorded). Also closed: whether the client itself considered the run an
  error (`result_is_error: true`) or exited non-zero without saying so
  (`false`), or emitted no parseable result record at all (`null`) — which
  distinguishes a client that reported a failure from one that crashed before
  reporting.

  **Not closed, and deliberately so:** why a client that reported
  `is_error: true` with no provider status decided to stop — a failing test, a
  refusal, a self-assessed dead end. That reason exists only in the client's
  prose, and D3a forbids persisting prose. The operator's recovery for that
  class is unchanged and is the one that worked on `0053`: run the
  repository's own checks against the worktree the round left. This task does
  not claim to remove that step.

  There is therefore no cap, no truncation marker, and no redaction rule in
  this plan. Nothing untrusted is retained, so there is nothing to bound and
  nothing to redact. `PRODUCER_OUTPUT_CAP_BYTES` from the cycle-1 draft is
  withdrawn; `src/policy/redact.ts` is untouched.

- **D3a — the boundary, and why two cycles of redaction-based designs were
  wrong.**

  Cycle 1 proposed a redacted 16 KiB `producer-output.log`. Cycle 2 rejected
  it again after the plan argued provenance and containment. Both rejections
  are accepted in full, and the reasoning is recorded here so a later round
  does not re-propose the same design:

  - `AGENTS.md:121` names "account identifiers" and "tokens" among the class
    that must never enter runtime state or logs, and grounds the prohibition
    in provenance. A client's stdout can carry text **derived from** the
    client's private authentication state — an account line, a store path, an
    `apiKeySource` — and routing those bytes through the child's stdout does
    not change where they came from. The cycle-1 argument that stdout is "not
    one of the five provenances" read the list too literally.
  - A finite pattern list cannot make that safe. An unlabelled token, a
    cookie, or an account identifier in a shape no rule matches survives
    `redactAdapterStderrText`. Cycle 1's plan claimed a guarantee the code
    cannot deliver; cycle 2's plan retreated to "mitigation" and still
    persisted the bytes.
  - The repository already decided this in its own words.
    `docs/AUTHENTICATION-AND-SECURITY.md:734`, on keeping child output off the
    TTY: the streamed records "including any `apiKeySource`, tool names,
    paths, or model prose, are parsed for those counts and then discarded.
    They never reach the terminal, `status.json`, or `events.jsonl`.
    **Redaction is not the control.**" The control is parse-then-discard into
    Bridge-owned closed values. D1 applies exactly that control.
  - The existing `adapter-stderr.log` / `adapter-payload.log` do not license a
    producer counterpart. Cycle 1 cited them as precedent; cycle 2 answered
    that an existing mechanism does not establish compliance for a new one.
    They stay where they are, under `0064`'s ownership, and this task's Out of
    Scope keeps them there.

  The result is a design with no redaction step, no persisted client text, and
  no residual risk to accept: the closed values in `ProducerDiagnostic` are a
  two-value enum, a bounded integer, and a tri-state boolean, none of which
  can express a credential.

- **D4 — `wait` is exempted from D-031's per-kind warning. This narrows D-031
  and contradicts D-069's "there is no exemption"; it is recorded as a dated
  amendment, D-073, not applied in silence.**

  The change is one condition in `main.ts:430-437`: when the stale-build
  warning fires and `parsed.kind === "wait"`, write nothing. The predicate
  (`staleBuildMessage`), the message text (`STALE_BUILD_MESSAGE`), and the
  exit codes are untouched, and every other kind — `review`, `mcp-stdio`,
  `status`, `events`, `doctor`, `resume`, `help`, `usage` — behaves exactly as
  before.

  Rejecting the other two candidates first:

  - *Suppress after the first emission per process* does nothing. Each `wait`
    poll is its own `spartan-bridge wait` process (SKILL.md step 4's loop), so
    `main()` already emits exactly once per process. The repetition is across
    processes, and no in-process counter can see it.
  - *Leave the runtime alone and fix the skill's parse guidance* asks every
    reader — the skill, an operator's shell, a future Board poller — to filter
    a line the runtime should not have sent, and leaves the underlying problem
    below intact.

  Why the exemption is honest rather than convenient, in the terms D-031 set.
  D-031 kept the warning on reader kinds because "the harm is silence rather
  than execution" for someone iterating on the tool. On `wait` that premise
  fails in both halves:

  1. **The remedy is unavailable and actively harmful mid-chain.** The only
     action the warning invites is `npm run build`, and running it while the
     chain being followed is mid-review writes the worktree during a review —
     the `reviewer_write_detected` failure this repository has already hit
     twice. The warning, obeyed, breaks the chain it is printed during.
  2. **It is not silence.** D-069 already supplies the correct signal at the
     correct moment: `STALE_BUILD_NEXT_ROUND_MESSAGE` on the terminal
     document (`main.ts:487-495`), naming the rebuild as the *next round's*
     precondition. And D-062's `stale_build` terminal document carries the
     refusal on stdout, where SKILL.md step 4 already reads it. Removing the
     per-poll line removes a duplicate, not the message.

  So the reconciliation with `0070` is not that D-069 was wrong. D-069
  declined an exemption while building the mechanism that makes one safe; with
  that terminal-document line shipped, the per-poll warning became the
  redundant half. The amendment says exactly that, and the amended clause is
  narrow: D-031's "signals on every CLI kind" becomes "signals on every CLI
  kind except `wait`", and D-069's "there is no exemption" is superseded for
  `wait` alone. `0070` D2's other pinned properties — no override flag, no
  environment variable, unchanged message, unchanged exit codes — are
  reaffirmed, not touched.

  D-073 records both halves of this task: the producer-output persistence
  (D1-D3) and this amendment.

## Acceptance Criteria

Derived from D1, D2, D3, D3a and D4, in that order.

From D1:

1. `ProducerAdapter.waitProducer()` in `src/adapters/adapter.ts:44` returns
   `{ exitCode: number | null; timedOut: boolean; provider_cause:
   ProviderFailureCause | null; http_status: number | null; result_is_error:
   boolean | null }`. No member is a `Buffer`, a string, or an object.
2. `codex.ts`, `cursor.ts`, and `grok.ts` populate the three new members from
   `classifyProviderFailure(outcome.stdout)` and the same last-`result`
   object's `is_error`, and hold the retained buffers only inside
   `waitProducer`. `fake.ts` returns `null` for all three unless its hook
   supplies values, and `FakeProducerHook.wait` widens to the same shape.
3. A test drives each real adapter's `waitProducer` over a stdout containing a
   `429` result record and asserts `provider_cause: "provider_limit"`,
   `http_status: 429`, `result_is_error: true`; over a `503` record and
   asserts `provider_unavailable` with `http_status: 503`; over a `401`
   record and asserts `provider_cause: null` with `http_status: 401`; and over
   a stdout with no parseable result record and asserts all three `null`.
4. `ProducerDiagnostic` in `src/core/contracts.ts` has exactly ten keys, the
   seven existing ones plus the three above. No key holds free text.
5. `buildProducerDiagnostic` throws a `TypeError` on a `provider_cause`
   outside `{"provider_limit", "provider_unavailable", null}`, on an
   `http_status` that is not `null` and not an integer in `100..599`, and on a
   `result_is_error` that is not `true`, `false`, or `null`. Absent input
   defaults each to `null`.
6. `serializeProducerDiagnostic` whitelists the three keys and normalizes any
   out-of-domain value to `null` on both write and read, so an injected value
   cannot reach persisted JSON or come back out of
   `parseTransitionStatusJson`. A test asserts this against a hand-built
   object carrying a rogue `provider_cause` string, an `http_status` of `700`,
   a non-boolean `result_is_error`, and an extra property.
7. `classifyProviderFailure`, `src/adapters/provider-failure.ts`,
   `src/policy/redact.ts`, `src/runtime/store.ts`, and
   `src/runtime/transition-store.ts` are unmodified. `git diff --stat` shows
   no change to those five files.
8. No producer stdout or stderr byte reaches `transition.ts`, a
   `ProducerDiagnostic`, `status.json`, `events.jsonl`, a transition or run
   event, the CLI's stdout, the CLI's stderr, a task artifact, or any file.
   A test drives a failing producer round whose stdout carries a `Bearer`
   token, an `sk-` key, an absolute home path, an account-identifier line, and
   an unlabelled high-entropy string, and asserts that **none of the five**
   appears in the transition directory's files, the terminal document, or
   either CLI stream, and that the transition directory contains exactly
   `status.json` and `events.jsonl`.

From D2:

9. A producer round ending `producer_failure` / `exit_nonzero` records the
   three classification fields on `producer_diagnostic`, and a round whose
   stdout carried a `429` result record records `provider_limit` / `429` /
   `true` on the terminal document.
10. A producer round ending `producer_timeout` at stage `wait` with
    `timed_out: true` does the same, keeping its existing `waited_ms`.
11. A stop at stage `write_scope_lock`, at stage `spawn`, or at stage `wait`
    through a `waitProducer()` throw records all three fields `null`.
12. A round whose producer exited 0 and was then refused by the Bridge —
    `write_scope_violation`, `runtime_state_violation`, or
    `producer_declaration_invalid` (including the `artifact_unchanged` arm) —
    records all three fields `null`. Its existing `unwritable_plan_targets` /
    `declaration_invalid_detail` behavior is unchanged.

From D3:

13. The `0053` failure shape is now distinguishable: two otherwise identical
    `exit_nonzero` rounds, one whose client reported `is_error: true` with
    `api_error_status: 429` and one whose client reported `is_error: true`
    with no status, produce different terminal documents. A test asserts both.
14. The plan claims no more than that. Neither the artifact, `README.md`, nor
    `docs/DECISIONS.md` states or implies that an operator can read a failing
    test, a refusal, or any other client-prose reason from the record; each
    states that the recovery for that class remains running the repository's
    own checks against the worktree.

From D3a:

15. No code path introduced by this task writes, returns, logs, or stores a
    producer client's stdout or stderr, in whole or in part, redacted or not.
    The retained buffers are read by `classifyProviderFailure` and go out of
    scope when `waitProducer` returns.
16. `docs/AUTHENTICATION-AND-SECURITY.md`'s `producer_diagnostic` paragraph
    (`:736`) describes the ten-key record — correcting the pre-existing
    "six-key" drift, which already omitted `waited_ms` — states that the three
    new keys are a Bridge-owned enum, a bounded integer, and a tri-state
    boolean, and states that the producer path classifies-then-discards on the
    same terms `:734` already states for the TTY.
17. D-073 records the rejected designs by name — a free-text
    `output_excerpt`, a redacted `producer-output.log`, and an event line
    carrying an excerpt — with the reason, so the design is not re-proposed.

From D4:

18. `spartan-bridge wait` writes no stale-build warning to stderr on a
    `{"state":"running"}` poll when `dist/` is older than `src/`. A test polls
    twice against a stale checkout and asserts stderr is empty both times.
19. On a terminal document, `wait` still writes
    `STALE_BUILD_NEXT_ROUND_MESSAGE` under D-069's existing conditions, and
    still writes nothing for a `"reason_code":"stale_build"` document or the
    "never created a run" error.
20. `review` and `mcp-stdio` still write `STALE_BUILD_MESSAGE` and exit 1 on a
    stale build; `status`, `events`, `doctor`, and `resume` still write it and
    continue. Their exit codes and stdout are unchanged.
21. `docs/DECISIONS.md` carries D-073, dated 2026-09-05, recording both halves
    of this task and stating in terms that D-031's per-kind signal now
    excludes `wait` and that D-069's "no exemption" is superseded for `wait`
    alone, with `0070` D2's other properties — no override flag, no
    environment variable, unchanged message, unchanged exit codes —
    reaffirmed.
22. `README.md`'s dogfooding paragraph states that a `wait` poll loop is
    silent on a stale build and that the rebuild is named once, on the
    terminal document.

Repository checks:

23. `npm run typecheck` and `npm run build` are clean.
24. `npm test` passes with no new failure against the 541-test baseline on
    `main`.

## Work Completed

- 2026-09-05 (human-operator, Claude Code, claude-opus-5): queued from the
  `0053` auto-chain observed the same day. Both defects were reproduced in
  that session; the discard at `waitProducer` and the per-poll warning were
  each read in the current source before this file was written.
- 2026-09-05 (planner, Claude Code, claude-opus-5): refined against this
  checkout. Every path, symbol, and line reference in Context, Scope, and
  Evidence was re-read and corrected — the four `waitProducer` bodies, the
  interface declaration in `adapter.ts` (not `contracts.ts`, as the queued
  Scope assumed), the `process.ts` handler ranges, the stop arm's true extent,
  and one wrong test citation. First draft of D1-D4. No source change.
- 2026-09-05 (planner, cycle 1 revision): the Codex plan reviewer
  (`run-086e767a-e448-4296-b755-6d0594500c57`) returned `CHANGES_REQUESTED`
  with three findings, all accepted. `POINTER_COUNT_INVARIANT` and
  `TEMP_FILE_FAILURE` were closed by joint field validation and
  temporary-file cleanup. `AUTH_OUTPUT_BOUNDARY` was answered with a
  provenance-and-containment argument that kept the redacted log.
- 2026-09-05 (planner, cycle 2 revision): the reviewer
  (`run-334b8193-559d-4110-9d7a-426540a64eeb`) held `AUTH_OUTPUT_BOUNDARY` and
  added `CONTAINMENT_TEST_CONTRADICTION`. Both accepted in full. The
  redaction-based design is withdrawn: no producer output is persisted at all.
  D1 is redesigned around `classifyProviderFailure`, the closed extraction
  `0064` D1a already shipped and all four adapters already call on the review
  path, moved inside the adapter so no buffer crosses the interface. D3 now
  names what this closes and what it leaves open; D3a records both rejected
  designs and cites `AUTHENTICATION-AND-SECURITY.md:734` — "Redaction is not
  the control" — as the repository's own statement of the reviewer's point.
  The Objective was narrowed to match what the closed record can deliver
  rather than left overclaiming. The two warnings from cycle 1 dissolved with
  the file they applied to; their substance survives as criteria 5-6.
  `CONTAINMENT_TEST_CONTRADICTION`'s self-contradicting criterion is replaced
  by criterion 8, which requires the unlabelled value to be absent from
  everything because nothing is persisted. Acceptance criteria re-derived from
  the amended decisions, not patched row by row. D4 is unchanged and was not
  challenged in either cycle. No source change.

## Evidence

- `.spartan-bridge/transitions/transition-b755de18-b0c2-423d-a723-5906999b8333/`
  — two files, `events.jsonl` and `status.json`; the event log holds four
  lines and no diagnostic.
- That transition's terminal document: `state: stopped`,
  `reason_code: producer_failure`,
  `producer_diagnostic.stage: exit_nonzero`, `exit_code: 1`,
  `timed_out: false`, every other diagnostic field `null`.
- `src/adapters/provider-failure.ts:52-70` — `classifyProviderFailure`: last
  `type === "result"` object, three read fields (`is_error`,
  `api_error_status` bounded to `100..599`, `terminal_reason` compared only to
  `"api_error"`), returning `{ cause, http_status }` and nothing else. Called
  today only from the review paths at `codex.ts:478`, `cursor.ts:565`,
  `grok.ts:434`, and `claude.ts:392`.
- `src/adapters/codex.ts:76` (`--json`), `src/adapters/cursor.ts:75-83`
  (`--output-format json`), `src/adapters/grok.ts:85-91`
  (`--output-format json`) — every producer spawn already requests the
  machine-readable output the scanner reads. No argv change is required.
- `src/adapters/process.ts:70-71` — the retained buffers, filled at `:92-109`
  and `:110-114` and resolved into `SpawnOutcome` (`:31-38`) at `:119-129`.
  `codex.ts:645`, `cursor.ts:717`, `grok.ts:581` — `retainStdout: true` on
  every real producer spawn.
- `src/adapters/codex.ts:656-667`, `cursor.ts:729-743`, `grok.ts:592-606`,
  `fake.ts:172-186` — the four `waitProducer` bodies, each returning only
  `{ exitCode, timedOut }`; `src/adapters/adapter.ts:44` declares that shape,
  and `fake.ts:69` mirrors it on `FakeProducerHook.wait`.
- `src/core/transition.ts:726` — the only consumer. The two arms that hold a
  returned outcome are `:745-756` (`timedOut`) and `:757-768`
  (`exitCode !== 0`); `:866-884` is `producerAdapterThrowDiagnostic`, which
  owns `adapter_phase` / `adapter_cause` and is why `provider_cause` is a
  separate key.
- `src/core/contracts.ts:295-307` — `ProducerDiagnostic`, seven fields, and
  the comment stating there is no free-text field so no caller can smuggle
  stdout, stderr, a payload, a prompt, or a throw's message into it (task
  `0040` D1).
- `src/core/serialize.ts:140-157` — `serializeProducerDiagnostic`
  re-validates every field on every read and write and normalizes anything
  outside the closed domains to `null`.
- `AGENTS.md:121` — the provenance prohibition, naming account identifiers
  and tokens. `AGENTS.md:122` — the Bridge does not read repository content to
  classify it.
- `docs/AUTHENTICATION-AND-SECURITY.md:734` — "The child's streamed records,
  including any `apiKeySource`, tool names, paths, or model prose, are parsed
  for those counts and then discarded… Redaction is not the control that keeps
  them off the TTY." `:736` — the `producer_diagnostic` paragraph, which pins
  the construct-inert-then-persist-after-guard-release ordering and describes
  the record as six keys where it now has seven. `:729-730` — the two
  reviewer-side logs this task adds no counterpart to.
- `src/cli/main.ts:430-437` — the D-031 warning: written to stderr whenever
  `staleBuildMessage` reports staleness, `return 1` only for `review` and
  `mcp-stdio`; every other kind, `wait` included, continues after emitting it.
  `:465-513` — the `wait` branch, one process per poll, with D-069's
  `STALE_BUILD_NEXT_ROUND_MESSAGE` at `:487-495`.
- `docs/DECISIONS.md:385-389` (D-031) and `:1219-1234` (D-069, "D-031 keeps
  its predicate, its message, its exit codes and its per-kind split; there is
  no exemption"). D-072 is the last recorded decision, so this task's entry is
  D-073.
- Task `0063` — `producer_declaration_invalid` gained
  `declaration_invalid_detail`; `producer_failure` did not.
- Task `0064` D1a — "Persist a Bridge-owned enum plus an HTTP status integer,
  never provider prose", the closed mapping D1 reuses unchanged.
- Corrected from the queued draft: the queued Evidence cited
  `tests/producer-write-scope.test.ts:569` for `outcome.stderr.toString()`;
  that line is an unrelated `unrestored` assertion. The real reads are
  `tests/producer-write-scope.test.ts:76`, `:716`, `:742` and
  `tests/cursor-adapter.test.ts:68`. The queued Scope placed the
  `waitProducer` declaration in `src/core/contracts.ts`; it is in
  `src/adapters/adapter.ts:44`.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: CHANGES_REQUESTED

Findings:

- `RESULT_ERROR_EXTRACTION` (error): D1 requires the adapters to obtain result_is_error “through the same helper,” while Scope, Out of Scope, criterion 7, and Evidence require classifyProviderFailure to remain unchanged and state that it returns only { cause, http_status }. The helper therefore cannot expose the selected result object's is_error, and its internal selected object is inaccessible to callers. Specify and scope one implementation: extend the helper's closed return shape, or add a shared parser that returns all three closed values. Do not leave implementers to duplicate the last-result selection independently in each adapter.
- `STRING_ENUM_CONTRADICTION` (warning): D1 and criterion 1 say no waitProducer return member is a string, but provider_cause is explicitly a string-literal enum and criteria 3 and 9 require values such as "provider_limit". The intended invariant appears to be “no free-text or unbounded string,” but the stated acceptance criterion is impossible alongside the required contract. Reword the invariant consistently throughout D1 and criterion 1.

Bridge run: run_id=run-c1b90569-f2db-4d95-a0e6-a15f45b8b965 execution_id=exec-3f820a7e-f56c-4006-b837-6968382166e0 review_kind=plan verdict=changes_requested reason_code=review_changes_requested host=codex launcher=codex-plan-reviewer-v1 model=gpt-5.6-sol effort=high model_observed=declared_unobserved policy_digest=sha256:c032b4cea31dd45976e0e4d6a6b689590f1f0a1a368378fd8a82e546eb9525a3 task_hash=sha256:81f335690eb72da627ae86e5acf315e5f35f40729a7777714bcbde0d8bed7fc6 agents_hash=sha256:ccf9e4492d47f2f21094b8ba345a4de0bca024275d307956d1ffcf712131a220 timestamp=2026-09-05T23:05:31.970Z
<!-- spartan-bridge:review:plan:end -->

## Blockers

None. It is independent of task `0053`, though `0053` is what surfaced it.

## Next Action

A technically read-only reviewer, dispatched by the Bridge, assesses this plan
— D1 (classification inside the adapter, closed scalars across the interface,
three new closed keys on `ProducerDiagnostic`), D2 (the two arms that hold a
returned `SpawnOutcome`, and the exit-0 refusal arms deliberately left out),
D3 (what the closed record closes and what it openly does not), D3a (the
withdrawal of every design that persists client output, and the repository's
own "redaction is not the control" as its ground), and D4 (the `wait`
exemption and the D-073 amendment to D-031 and D-069) — for whether the
representation is genuinely closed at both the interface and the record,
whether the narrowed Objective is stated honestly rather than quietly, whether
D4's amendment is honestly scoped rather than a silent override, and whether
the re-derived acceptance criteria follow from those decisions, and returns
one explicit verdict.

## Next Handoff

No outstanding handoff. The proposed review was consumed.
