---
protocol: "1.1.0" # x-release-please-version
id: a-write-scope-violation-names-no-path
created_at: 2026-09-03
status: completed
phase: complete
task_type: implementation
risk: material
current_role: human-operator
next_role: human-operator
updated_at: 2026-09-12
handoff_id: HX-005
next_handoff_id: none
---

# A `write_scope_violation` stop names no path

## Objective

When the producer guard stops a producer round because the child mutated a path
outside the admitted write scope, the terminal transition record names *which*
path — the same way a refused review write names its rule since tasks `0057` /
`0061`, and a `producer_declaration_invalid` stop names its rule since task
`0063`. An operator reading `wait` output or `status.json` knows what the
producer touched without re-running anything.

## Context

Task `0067` demoted the pre-spawn plan-target scan to an advisory: after a
passed plan review, a plan that merely mentions `AGENTS.md` in prose no longer
stops the auto-chain. The producer guard is now the sole boundary for those
paths, and a genuine out-of-scope write terminates as `write_scope_violation`.

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

### Three premises this task was queued on are stale

This round read the current checkout before pinning anything. D-072 (task
`0053`, shipped after this task was queued) moved the automatic producer onto an
isolated scope copy and replaced the in-place diff guard with a capture / merge
transaction. Three statements in the queued plan no longer describe the tree:

- **`producerDiffViolatesScope` does not exist.** `grep -rn "ViolatesScope" src
  tests` returns nothing. The out-of-scope guard is now the classification arm
  inside `captureProducerMerge` (`src/core/workspace.ts:1549`):
  `if (classification !== "admitted" || isAuthorityWritePath(entry.path) ||
  producerPathDenied(entry.path)) { throw new ProducerMergeError(); }`.
  D2 cannot be decided as "change one function's return type"; the guard has
  roughly forty bare `throw new ProducerMergeError()` sites, and only one of
  them is the case an operator needs named.
- **The stop line numbers moved.** `write_scope_violation` is now at
  `src/core/transition.ts:843` (a `productDiff` over the *live* repository,
  which under D-072 should be empty because the producer ran elsewhere) and at
  the two `ProducerMergeError` catch arms, `:864` and `:877`.
  `runtime_state_violation` is now at `:839`. All four pass `diagnostic: null`.
- **`ProducerDiagnostic` is a nine-key record, not seven.** D-074 (task `0077`)
  added `snapshot_site` and `snapshot_cap` to the closed set. D-036 still seals
  it, and this path is still none of its keys; only the count in the queued
  prose was wrong.

Current shape, as verified in this checkout:

- `captureProducerMerge` (`src/core/workspace.ts:1525`) walks
  `workspaceDiff(baseline, after)` over the isolated copy and throws a bare
  `ProducerMergeError` on the first refused entry. `entry.path` is in hand at
  the throw and is discarded.
- `ProducerMergeError` (`src/core/workspace.ts:1107`) already carries one path
  list, `unrestored: readonly string[]`, populated only by the rollback failure
  at `src/core/workspace.ts:1792`. It is the in-repository precedent for a path
  list riding on this error, and it is *not* the list this task needs.
- `ProducerDiagnostic` (`src/core/contracts.ts`) carries
  `write_scope_code: ProducerWriteScopeFailure | null`, a closed enum. It has
  no field for a path and, by D-036, must not gain a free-text one.
- `unwritable_plan_targets` (`src/core/contracts.ts:546`, `:563`) demonstrates
  the accepted shape for a Bridge-owned path list on a transition:
  `string[] | null`, normalized posix tokens, whitelisted through
  `serializeUnwritablePlanTargets` (`src/core/serialize.ts:260`), and explicitly
  *not* `producer_diagnostic`.
- `snapshotDiff` (`src/core/snapshot.ts:351`) emits entries over
  `[...keys].sort()`, so every diff this task reads is already in deterministic
  lexicographic posix order.

The same argument that justified `declaration_invalid_detail` in `0063` (D-064)
applies here: the operator should not have to diff the guard to learn what it
caught.

## Scope

- `src/core/workspace.ts`
  - A classification pre-pass in `captureProducerMerge` that collects every
    refused entry before any byte is read, and throws once with that list.
  - `ProducerMergeError` gains a second, separate path list.
  - Two new caps beside `PRODUCER_MERGE_ENTRY_CAP` / `PRODUCER_MERGE_BYTE_CAP`
    (`src/core/workspace.ts:46-47`).
- `src/core/transition.ts`
  - `GuardedRoundOutcome` carries the list; the four stops at `:839`, `:843`,
    `:864` and `:877` populate it; `finishProducerRound`, `stopTransition`,
    `emptyTransition` and `emitTransition` thread it to `status.json` and the
    `terminal_stop` event.
- `src/core/contracts.ts`
  - One additive required nullable field on `TransitionStatusDocument` and
    `TransitionEventDocument`. `SCHEMA_VERSION` stays `2`, per the `0063` /
    `0066` / `0074` additive-field precedent.
- `src/core/serialize.ts`
  - A whitelisting serializer in the shape of `serializeUnwritablePlanTargets`,
    applied in `serializeTransitionStatus`, `serializeTransitionEvent` and
    `parseTransitionStatusJson`; a missing or malformed value normalizes to
    `null` on parse.
- `src/cli/main.ts`
  - `formatTransitionTerminalLine` (`src/cli/main.ts:202`) surfaces the field,
    plus one new exported helper that renders an entry as a printable-ASCII
    quoted literal.
- `src/cli/detach.ts`
  - The synthesized interrupted `terminal_stop` event
    (`src/cli/detach.ts:536-547`) carries the field, as it already carries
    `unwritable_plan_targets`.
- `agent-skill/skills/spbridge/SKILL.md`
  - Step 5: quote the field when non-null, as with `declaration_invalid_detail`
    and `unwritable_plan_targets`.
- `docs/DECISIONS.md`, `docs/AUTHENTICATION-AND-SECURITY.md`
  - Record the field and its classification: Bridge-owned normalized posix paths
    observed in the Bridge's own snapshot diffs, never provider output.
- Tests: `tests/workspace.test.ts`, `tests/producer-write-scope.test.ts`,
  `tests/transition.test.ts`, `tests/serialize.test.ts`, `tests/cli.test.ts`,
  `tests/detach.test.ts`, `tests/spbridge-skill.test.ts`.

## Out of Scope

- `ProducerMergeError.unrestored`. It is a rollback-failure list with a
  different meaning and a different audience; D3 keeps it untouched and does not
  surface it. Merging the two lists would make the new field mean two things.
- Any change to `ProducerDiagnostic`. D-036 seals it as a closed record and this
  path is not one of its keys.
- The roughly forty integrity, cap, race and `safeOpen*` throw sites in
  `src/core/workspace.ts` that are not the classification arm. They stay bare;
  D2 states that positively rather than leaving it implied.
- Relaxing, re-tightening, or otherwise revisiting the `0067` advisory scan.
- Naming the path on a *review* write refusal — that is `0057` / `0061`, shipped.
- `AGENTS.md` and `spartan-bridge/config.yaml`. Neither is edited, so this plan
  declares no human implementer and the plan-pass auto-chain may run.

## Constraints

- English artifact.
- The persisted value is Bridge-owned: every token comes from a `snapshotDiff`
  or `workspaceDiff` the Bridge computed over a tree it owns, already normalized
  posix, never from provider stdout, stderr, or a prompt.
- A path is not a secret, but the field is still bounded, in the spirit of
  `OUTPUT_EXCERPT_CAP_BYTES`.
- `SCHEMA_VERSION` stays `2`; a missing key or an out-of-shape value normalizes
  to `null` on parse, so an older document still reads.
- `npm run typecheck` / `npm run build` clean; `npm test` no new failure.

## Decisions

- **D1 (pinned) — `producer_refused_paths: string[] | null`, at most 20 entries,
  each entry bounded by tail-retaining truncation, never by omission.** The
  field is named `producer_refused_paths` on both transition documents. The name
  carries the contrast the task exists to create: `unwritable_plan_targets` is
  what the *plan* mentioned, `producer_refused_paths` is what the *producer*
  wrote. `refused` is the vocabulary `classifyProducerWorkspacePath`
  (`src/core/workspace.ts:1494`) already returns.

  A list, not a single first offender, because a producer that strays usually
  strays more than once and the operator needs the set; and because
  `unwritable_plan_targets` already establishes `string[] | null` on these two
  documents, so a list costs no new serializer shape.

  Two bounds, both new constants in `src/core/workspace.ts` beside
  `PRODUCER_MERGE_ENTRY_CAP`: `PRODUCER_REFUSED_PATH_CAP = 20` entries, and
  `PRODUCER_REFUSED_PATH_BYTES = 256` per entry.

  Over the entry cap, the first 20 in order are kept and the rest dropped with
  no truncation marker; the list is still non-empty, so a stop still names paths.

  Over the byte cap, the entry is **truncated to its tail, never omitted and
  never dropped**. This reverses the rule the first cycle pinned. Omitting an
  over-long entry re-creates the exact defect this task exists to remove: a
  producer that wrote one very deep path would stop with an empty list and
  therefore a `null` field, naming nothing. The tail is also the identifying
  half of a path — basename first, then the nearest parents — so keeping the
  tail keeps what an operator actually reads. The rule: keep the last
  `PRODUCER_REFUSED_PATH_BYTES` UTF-8 bytes, advance the cut forward to the next
  UTF-8 character boundary so no multi-byte sequence is split, and prefix the
  result with the three ASCII characters `...` and a `/`. `Buffer.byteLength`
  of the stored token is therefore at most `PRODUCER_REFUSED_PATH_BYTES + 4`.
  The byte measure is `Buffer.byteLength(token, "utf8")`: a UTF-8 byte count,
  not a UTF-16 unit count and not a code-point count, and the tests state the
  measure so the `0072`-sidecar class of miscount cannot recur silently.

  The `.../` marker is not unforgeable. A posix path whose first segment is
  literally `...` renders identically to a truncated one, so the marker
  distinguishes the two cases only by convention. That residual is accepted
  rather than engineered away: the tail of a truncated entry is still a real
  suffix of a real path, so the entry identifies the file either way, and the
  alternative — a sentinel that no path can contain — would have to be
  non-ASCII and would then collide with D4's terminal encoding. The criteria
  test the truncation behavior, not the marker's uniqueness.

  Ordering is the `snapshotDiff` / `workspaceDiff` key order, which is
  `[...keys].sort()` at `src/core/snapshot.ts:351` — deterministic lexicographic
  posix. No re-sort is introduced.

  Because no entry is ever dropped for length, every member of a refused list
  yields exactly one stored token. The single member that yields no token is
  the `.` root entry of the live-repository `productDiff`, which D2 excludes;
  D2 also names the stop guard that keeps that exclusion from emptying the
  list. So a Bridge-produced list on any of D3's three stops is non-empty,
  `null` on them is unreachable from Bridge code, and D3's invariant is a
  guarantee rather than a hope. The serializer's
  normalize-to-`null` arm still exists, but it answers a malformed *persisted*
  document — a hand-edited or foreign file — not anything the Bridge writes.

- **D2 (pinned) — a classification pre-pass in `captureProducerMerge`, carried
  on `ProducerMergeError`.** The premise the queued plan offered no longer
  exists, so the capture point is chosen against the current guard.

  `captureProducerMerge` gains a pre-pass over the already-filtered `diff`,
  before the capture loop runs. The pre-pass evaluates only the three pure
  string predicates the capture loop's first arm evaluates —
  `classifyProducerWorkspacePath`, `isAuthorityWritePath`, `producerPathDenied` —
  skipping `scratch`, and collects every entry that arm would refuse. If the
  collected list is non-empty it throws once, carrying the bounded list. No
  `safeOpenStat`, `safeOpenRegular`, `fs` read or byte accounting happens on a
  round that has a refused path, so fail-fast is preserved and strengthened: the
  guard now refuses before opening anything at all, where today it opens and
  reads every admitted entry that sorts ahead of the first refused one.

  The pre-pass duplicates the predicate evaluation for admitted entries. That is
  accepted: the predicates are pure string tests over a bounded diff, and
  separating detection from capture is what makes the complete list available
  without restructuring the capture loop.

  `ProducerMergeError` gains `refusedPaths: readonly string[]`, defaulting `[]`,
  as a third constructor parameter after `reason` and `unrestored`. The existing
  two parameters and `unrestored`'s meaning are unchanged. Every existing throw
  site stays byte-identical and therefore keeps `refusedPaths: []`.

  `runGuardedRound`'s `GuardedRoundOutcome` stop arm
  (`src/core/transition.ts:634-641`) gains an optional `refusedPaths` alongside
  `declarationInvalidDetail`. The two `ProducerMergeError` catch arms
  (`:864`, `:877`) read `error.refusedPaths` when the caught value is a
  `ProducerMergeError`. The live-repository arm (`:843`) populates it from
  `productDiff` entries whose `path !== "."`, which is the same escaped-write
  evidence in the same provenance class.

  That exclusion cannot empty the list, because the stop's own guard is the
  same predicate: `src/core/transition.ts:842` reads
  `if (productDiff.some((entry) => entry.path !== "."))`. A `productDiff`
  whose only member is the `.` root entry does not reach the stop at all — the
  round proceeds to the merge — so whenever the arm runs at least one non-root
  entry exists and the filtered list has at least one member. No new guard is
  added; the plan now states the one already in the code, and a criterion pins
  the root-only case as not reaching the stop.

  `finishProducerRound` passes it into
  `stopTransition`, which writes it onto `transition.status` so `emitTransition`
  carries it onto the `terminal_stop` event unchanged, exactly as
  `unwritable_plan_targets` and `declaration_invalid_detail` already travel.

- **D3 (pinned) — `runtime_state_violation` is covered by the same field.** The
  stop at `src/core/transition.ts:839` has the identical defect, the identical
  provenance (`runtimeDiff`, a Bridge-owned snapshot of Bridge-owned runtime
  state) and needs no additional machinery, so it records its own diff entries in
  `producer_refused_paths` under the same bounds. Leaving it out would queue a
  second task for a strictly smaller version of this one.

  The rollback throw at `src/core/workspace.ts:1792`,
  `ProducerMergeError("runtime_state_violation", unrestored)`, is the one
  `runtime_state_violation` that does **not** gain a path: `unrestored` stays out
  of the new field per Out of Scope, and that stop records
  `producer_refused_paths: null`.

  Stated positively, and this is the invariant the criteria test: after this
  change, `producer_refused_paths` is non-null on exactly three stops — the
  `runtimeDiff` stop, the live-repository `productDiff` stop, and a stop whose
  `ProducerMergeError` came from the new classification pre-pass. It is `null`
  on every other stop, on every non-terminal event, and on every successful
  round. The invariant holds without qualification because D1 drops no entry
  for length: each of those three stops is reached only from a non-empty diff
  or a non-empty refused list, every member of which yields exactly one stored
  token, so the list the Bridge writes on them is never empty and never `null`.
  Nothing else about any of those stops changes: the same reason codes, the
  same `producer_diagnostic: null`, the same exit codes, the same
  `unwritable_plan_targets`.

- **D4 (pinned) — ` wrote=`, gated on the two violation reason codes, rendering
  each entry as a printable-ASCII quoted literal.**
  `formatTransitionTerminalLine` (`src/cli/main.ts:202`) appends ` wrote=` when
  `producer_refused_paths` is non-null and `reason_code` is
  `write_scope_violation` or `runtime_state_violation`. The token is the verb
  the operator is asking about, and sits opposite the existing ` targets=` (what
  the plan mentioned) without either one explaining itself.

  The entries are not joined raw. A refused path is read out of a tree the
  producer controlled, so its bytes are an adversary-influenced surface: a posix
  path may legally contain a comma, a newline, a tab, an escape byte, or a full
  terminal control sequence, and `parseTransitionStatusJson` accepts any string
  a persisted document carries. Joining those raw would let one path split the
  field, break the one-line contract `formatTransitionTerminalLine` holds with
  every other terminal line, or emit control sequences into the operator's
  terminal.

  The rendering rule, a new exported helper in `src/cli/main.ts` applied to each
  entry before the join: take `JSON.stringify(entry)`, which already yields a
  double-quoted literal with `"`, `\`, and every C0 control escaped; then walk
  that literal **by UTF-16 code unit, not by code point**, replacing every unit
  whose value is outside `0x20`-`0x7E` with `\u` plus its four lowercase hex
  digits. Iterating code units is what makes the rule total: a supplementary
  character such as an emoji is two surrogate units and becomes two `\uXXXX`
  escapes, which is exactly how JSON encodes it and exactly what `JSON.parse`
  reads back. Iterating code points instead would meet a value above `U+FFFF`
  that no single four-hex-digit escape can represent, and would emit an invalid,
  non-round-trippable literal. The pass covers `U+007F`, the C1 range, and every
  non-ASCII character. The result is a double-quoted, printable-ASCII,
  single-line literal per entry that `JSON.parse` returns to the original
  string. Those literals are joined with `,`: a comma
  inside a path is inside quotes and cannot be mistaken for the separator, and
  `wrote=` is unambiguously parseable back to the entry list. `.../` from D1's
  truncation appears inside the quotes like any other character.

  ` targets=` is deliberately left rendering raw and is not changed by this
  task. `unwritable_plan_targets` tokens are produced by the plan-target scan
  from the approved artifact's own prose, a surface the plan review already
  gated; refused paths are produced by the child. Encoding the one and not the
  other is the difference in provenance made visible, not an inconsistency, and
  widening the change to ` targets=` would edit a shipped D-067 behavior this
  task's Out of Scope excludes.

  The join is otherwise uncapped on the line, matching ` targets=`, because
  D1's 20-entry cap already bounds it and a second, different truncation rule
  on the same data is how two readers come to disagree about what was recorded.

  On "can the three appear together": they cannot. ` detail=` is gated on
  `reason_code === "producer_declaration_invalid"` and ` wrote=` on the two
  violation codes, and `reason_code` is a single value, so ` detail=` and
  ` wrote=` are mutually exclusive. The only pairing is ` targets=` with
  ` wrote=`, which is the pairing worth having — it is what distinguishes a
  producer that wrote a path the plan had already flagged from one that wrote a
  path nobody predicted. A pinned `tests/cli.test.ts` fixture fixes that
  two-token line verbatim.

## Acceptance Criteria

| # | Criterion | From |
| --- | --- | --- |
| AC-1 | `TransitionStatusDocument` and `TransitionEventDocument` each declare required `producer_refused_paths: string[] \| null`. `SCHEMA_VERSION` is still `2` and `ProducerDiagnostic` still has exactly its nine D-036/D-074 keys. | D1 |
| AC-2 | `serializeProducerRefusedPaths` whitelists the value in `serializeTransitionStatus`, `serializeTransitionEvent` and `parseTransitionStatusJson`: a non-array, an absent key, an `undefined`, or an array whose entries are all filtered out yields `null`; non-string entries are dropped. A test name records that this arm answers a malformed persisted document, not any Bridge-produced list. | D1 |
| AC-3 | A transition document written before this change — one whose JSON has no `producer_refused_paths` key — parses with the field `null` and every other field unchanged. | D1 |
| AC-4 | The entry cap is `PRODUCER_REFUSED_PATH_CAP = 20`: a 25-entry refused list persists the first 20 in `snapshotDiff` lexicographic order, drops the rest with no marker, and leaves the list non-empty. | D1 |
| AC-5 | The per-entry cap is `PRODUCER_REFUSED_PATH_BYTES = 256`, measured as `Buffer.byteLength(token, "utf8")`. An entry of exactly 256 UTF-8 bytes is stored verbatim. A longer entry is stored as `.../` followed by its last 256 bytes advanced forward to the next UTF-8 character boundary, so the stored token is at most 260 bytes, splits no multi-byte sequence, and ends with the original entry's own tail. | D1 |
| AC-6 | No refused entry is ever omitted or dropped for length: a test whose refused list holds a single entry far over the byte cap still persists a one-element, non-null `producer_refused_paths`. The multi-byte case uses a token whose UTF-8 length differs from both its UTF-16 length and its code-point count, so a wrong measure fails the test. | D1 |
| AC-7 | `captureProducerMerge` runs the classification pre-pass before the capture loop. On a workspace diff containing one refused entry and one admitted entry that sorts ahead of it, the `beforeFileRead` seam in `ProducerMergeReadDeps` is never invoked and the throw carries the refused entry. | D2 |
| AC-8 | `ProducerMergeError` carries `refusedPaths: readonly string[]` defaulting `[]`, as a third parameter after `reason` and `unrestored`; `unrestored` keeps its meaning and is never copied into `refusedPaths`; a test asserts a bare `new ProducerMergeError()` has `refusedPaths: []`. | D2 |
| AC-9 | A producer round whose isolated copy mutates a path outside the write scope stops `write_scope_violation` with that path in `producer_refused_paths` on both the terminal `status.json` and its `terminal_stop` event, with `producer_diagnostic` still `null`. | D2 |
| AC-10 | A producer round that mutates the live repository stops `write_scope_violation` with the `productDiff` entries whose `path !== "."` in the field; the `.` root entry never appears. | D2 |
| AC-11 | The `.` root entry cannot empty the list: a test whose live-repository `productDiff` holds only the `.` entry does not reach the `write_scope_violation` stop at all — the round proceeds to the merge — and `src/core/transition.ts:842` keeps the guard `productDiff.some((entry) => entry.path !== ".")` unchanged. | D2 |
| AC-12 | A producer round that mutates Bridge runtime state stops `runtime_state_violation` with the `runtimeDiff` entries in the same field. | D3 |
| AC-13 | The `applyProducerMerge` rollback throw `ProducerMergeError("runtime_state_violation", unrestored)` records `producer_refused_paths: null`; `unrestored` is not surfaced. | D3 |
| AC-14 | `producer_refused_paths` is non-null on exactly the three stops D3 names and `null` on every other stop, every non-terminal event and every successful round; the existing assertions on reason codes, exit codes, `producer_diagnostic` and `unwritable_plan_targets` for those stops are unchanged. | D3 |
| AC-15 | `formatTransitionTerminalLine` appends ` wrote=` only when `producer_refused_paths` is non-null and `reason_code` is `write_scope_violation` or `runtime_state_violation`; a non-null field under any other reason code renders no token. | D4 |
| AC-16 | The exported rendering helper emits, for every entry, a double-quoted literal containing only characters in `0x20`-`0x7E`: `JSON.stringify` first, then a walk over the result **by UTF-16 code unit** replacing every unit outside that range with `\u` and four lowercase hex digits. Tests cover an entry containing a comma, one containing `"` and `\`, one containing a newline and a tab, one containing `U+007F` and a C1 code point, one containing an ESC-bracket terminal control sequence, one containing a non-ASCII BMP character, and one containing a supplementary-plane character. | D4 |
| AC-17 | The supplementary-plane entry renders as exactly two `\uXXXX` escapes — the surrogate pair — and a code-point-iterating implementation fails the test. | D4 |
| AC-18 | Every rendered literal round-trips: for each AC-16 input, `JSON.parse` of the emitted literal returns the original entry string byte for byte. | D4 |
| AC-19 | The rendered line is exactly one line for every AC-16 input — the formatter's output contains exactly one newline, its last character — and every other character is in `0x20`-`0x7E`. | D4 |
| AC-20 | Entries are joined with `,` between the quoted literals, so a comma inside a path is inside quotes; a test with two entries, one of which contains a comma, splits the ` wrote=` value back into the original two entries. | D4 |
| AC-21 | A `tests/cli.test.ts` fixture pins the two-token line verbatim, in the shape `... implementer stopped reason=write_scope_violation targets=AGENTS.md wrote="spartan-bridge/config.yaml" took 2m59s`, and a second fixture asserts ` detail=` and ` wrote=` never co-occur. | D4 |
| AC-22 | ` targets=` renders exactly as it does on `main`: an unquoted, unescaped `,`-join of `unwritable_plan_targets`. An existing `tests/cli.test.ts` assertion on that token is unchanged. | D4 |
| AC-23 | `src/cli/detach.ts` carries `producer_refused_paths` from the transition onto the synthesized interrupted `terminal_stop` event, as it already carries `unwritable_plan_targets`, and `wait`'s terminal document emits the field. | D4 |
| AC-24 | `agent-skill/skills/spbridge/SKILL.md` step 5 instructs quoting `producer_refused_paths` when non-null and states the contrast with `unwritable_plan_targets` — what the producer wrote versus what the plan mentioned; `tests/spbridge-skill.test.ts` pins that wording. | D4 |
| AC-25 | `docs/DECISIONS.md` records D-077 with the field name, both caps, the tail-truncation rule and its `.../` marker with the stated ambiguity, the code-unit escaping rule, the three stops, and the `unrestored` exclusion; `docs/AUTHENTICATION-AND-SECURITY.md` classifies the field in the paragraph that already classifies `producer_diagnostic`, `unwritable_plan_targets` and `declaration_invalid_detail`, as Bridge-owned normalized posix tokens from the Bridge's own snapshot diffs, never provider output, and records that the CLI renders them through the printable-ASCII encoder. | D4 |
| AC-26 | A regression test reproduces the recorded 2026-09-12 shape: a producer that writes `spartan-bridge/config.yaml` in the isolated copy, under a plan whose advisory scan produced a non-empty `unwritable_plan_targets`, stops with both fields populated and independently valued — proving the field identifies the violation where the advisory list only overlapped it. | D1, D2 |
| AC-27 | `npm run typecheck` and `npm run build` are clean and `npm test` records no new failure against the `main` baseline. | repository check |

## Work Completed

- 2026-09-03 (human-operator, Claude Code, claude-opus-5): queued from the
  `0067` implementation-review finding `VIOLATION_NAMES_NO_PATH` (`run-35668b16`,
  info severity) after `0067` shipped in `dcf89d3`.
- 2026-09-12 (human-operator, Claude Code, claude-opus-5): recorded three
  same-day occurrences in Evidence and the dependency they create for task
  `0079`. Read from terminal transition records in this checkout and from a
  redacted cross-repository summary; no decision pinned and no code changed.
- 2026-09-12 (planner, Claude Code, claude-opus-5): read the current checkout
  before pinning. Found `producerDiffViolatesScope` gone, the stop line numbers
  moved, and `ProducerDiagnostic` at nine keys; rewrote Context against the
  D-072 capture/merge guard. Pinned D1 (`producer_refused_paths`, `string[] |
  null`, 20 entries x 256 UTF-8 bytes, `snapshotDiff` order), D2 (a
  classification pre-pass in `captureProducerMerge`, carried on a new
  `ProducerMergeError.refusedPaths`), D3 (`runtime_state_violation` covered;
  `unrestored` excluded), D4 (` wrote=`, gated on the two violation codes).
  Derived AC-1..AC-19 from those decisions afterwards. Verified every path this
  plan names exists in this checkout. No product file changed.
- 2026-09-12 (planner, Claude Code, claude-opus-5): revised against plan-review
  cycle 1 (`run-278cf684-7807-422c-9feb-f38da1cb5219`, `changes_requested`).
  `NULL_PATH_CONTRADICTION` was right that D1's omit-an-over-long-entry rule
  re-created the defect the objective forbids, so D1 now truncates to the tail
  and drops nothing, and D3's invariant became provable rather than asserted.
  `TERMINAL_PATH_ENCODING` was right that a child-controlled path may carry a
  comma, a newline or a control sequence, so D4 gained a printable-ASCII quoted
  rendering and a stated reason for leaving ` targets=` alone. Re-derived the
  whole criteria table from the changed decisions as AC-1..AC-24 rather than
  editing the rows the findings named. No product file changed.
- 2026-09-12 (planner, Claude Code, claude-opus-5): revised against plan-review
  cycle 2 (`run-46d2d604-42f6-4c0e-9816-66c20092dd4e`, `changes_requested`).
  `ROOT_ONLY_DIFF` named a gap in the plan's prose rather than in the code: the
  stop it describes is itself guarded by `productDiff.some((entry) => entry.path
  !== ".")` at `src/core/transition.ts:842`, so a root-only diff never reaches
  it; D2 now states that guard, D1's completeness claim is corrected to name the
  `.` entry as the one member yielding no token, and AC-11 pins the case.
  `UNICODE_ESCAPE` was right that `\uXXXX` cannot encode a code point above
  `U+FFFF`, so D4's escaping walk is now specified over UTF-16 code units rather
  than code points, which emits a surrogate pair as two escapes and round-trips
  through `JSON.parse`; AC-16..AC-19 test it, including a supplementary-plane
  character. `HANDOFF_ROLE_MISMATCH` is resolved by the second branch of the
  `AGENTS.md` rule — the section carries no envelope at all — using the
  runtime's own `RETRACTED_NEXT_HANDOFF_SECTION` wording with
  `next_handoff_id: none`; `src/core/task-write.ts:138` only requires a
  retractable section when `next_handoff_id` is not `none`, so the review write
  is unaffected. Re-derived the whole criteria table as AC-1..AC-27. No product
  file changed.
- 2026-09-12 (implementer, Codex, gpt-5.6-sol, effort high): implemented D1-D4.
  Added the required bounded transition field, the pre-read classification
  pass and separate `ProducerMergeError.refusedPaths`, all three stop sources,
  serializer compatibility, printable-ASCII terminal literals, detached-event
  forwarding, skill guidance, D-077, security classification, and focused
  regression coverage. No path outside the authorized automatic write scope
  was modified.
- 2026-09-12 (implementer, Codex, gpt-5.6-sol, effort high): corrected the
  implementation against `run-207a0f85-3d0e-4a95-b298-e45603c962fc`.
  Strengthened the classification-order fixture, made the root-only diff real,
  added direct live-tree, rollback-persistence, and independently valued
  advisory/refusal regressions, and moved refused-path bounding to a leaf module
  to remove the serializer/workspace import cycle. Recorded the accepted
  runtime-root and marker ambiguities in D-077 and corrected stale artifact
  criterion references. No review finding remains unaddressed in the worktree.
- 2026-09-13 (human-operator, Claude Code, claude-opus-5, Anthropic; close-out
  on the owner's instruction): confirmed the implementation landed in `0fc8ce7`
  with both reviews `APPROVED`, observed the full suite in the outer checkout
  (AC-27), found no open decision or residual, and set `status: completed`.

## Evidence

- `grep -rn "ViolatesScope" src tests` — no output. The symbol the queued plan
  named for D2 is not in this checkout.
- `src/core/workspace.ts:1549` —
  `if (classification !== "admitted" || isAuthorityWritePath(entry.path) ||
  producerPathDenied(entry.path)) { throw new ProducerMergeError(); }`
  The one throw of roughly forty that an operator needs named.
- `src/core/workspace.ts:1107-1118` — `ProducerMergeError` with
  `reason: Extract<ReasonCode, "write_scope_violation" |
  "runtime_state_violation">` and `unrestored: readonly string[] = []`.
- `src/core/workspace.ts:46-47` — `PRODUCER_MERGE_ENTRY_CAP = 2_000`,
  `PRODUCER_MERGE_BYTE_CAP = 64 * 1024 * 1024`, where the two new caps sit.
- `src/core/transition.ts:839` —
  `return { kind: "stop", reason: "runtime_state_violation", diagnostic: null };`
- `src/core/transition.ts:843` —
  `return { kind: "stop", reason: "write_scope_violation", diagnostic: null };`
- `src/core/transition.ts:864` and `:877` — `reason: error instanceof
  ProducerMergeError ? error.reason : "write_scope_violation", diagnostic: null`.
- `src/core/transition.ts:634-641` — `GuardedRoundOutcome`, whose stop arm
  already carries the optional `declarationInvalidDetail` this field follows.
- `src/core/snapshot.ts:351` — `for (const key of [...keys].sort())`, the
  deterministic ordering D1 inherits.
- `src/core/contracts.ts:546-547`, `:563-564` — `unwritable_plan_targets:
  string[] | null` and `declaration_invalid_detail: string | null` on the status
  and event documents; `src/core/contracts.ts:1` — `SCHEMA_VERSION = 2`.
- `src/core/serialize.ts:260-266` — `serializeUnwritablePlanTargets`, which
  filters non-strings and maps empty to `null` and applies no cap; the new
  serializer is that shape plus the two D1 bounds.
- `src/cli/main.ts:207-213` — the existing ` targets=` and ` detail=` tokens and
  the `producer_declaration_invalid` gate that makes ` detail=` and ` wrote=`
  mutually exclusive.
- `src/cli/detach.ts:545-546` — the interrupted `terminal_stop` event that
  already forwards `unwritable_plan_targets` and nulls
  `declaration_invalid_detail`.
- `agent-skill/skills/spbridge/SKILL.md:285-290` — step 5's existing quoting
  instruction; `tests/spbridge-skill.test.ts:143-144` — the regexes that pin it.
- `docs/AUTHENTICATION-AND-SECURITY.md:734` — the paragraph that classifies
  `producer_diagnostic`, `unwritable_plan_targets` and
  `declaration_invalid_detail`, and where AC-25 adds this field.
- `docs/DECISIONS.md` — highest recorded decision is D-076 (task `0080`), so
  this task records D-077.
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
  overlap. AC-26 reproduces exactly this shape.
- **The cost compounds into another task.** All five auto-chain transitions in
  that consumer repository are `stopped` with `linked_review_run_ids: []`;
  none reached an implementation review. Task `0079`'s AC-16 needs exactly
  such an observation from a repository whose declared client context differs
  from the machine default, so it cannot be recorded until a chain there gets
  past the producer guard — and the operator cannot find out why it does not,
  because the stop names nothing. This task gates `0079`.
- Implementation verification, 2026-09-12:
  - `npm run typecheck` — exit 0.
  - `npm run build` — exit 0, including `postbuild`.
  - `node --import tsx --test tests/serialize.test.ts tests/cli.test.ts
    tests/producer-write-scope.test.ts tests/transition.test.ts
    tests/detach.test.ts tests/spbridge-skill.test.ts` — 201 tests, 199 passed,
    0 failed, 2 skipped.
  - `npm test` — 595 tests, 554 passed, 29 failed, 12 skipped. Every failure is
    the enclosing Bridge sandbox refusing Git's attempt to open `/dev/null`
    (`git init` / `git ls-files`, `Operation not permitted`); the same sandbox
    also prevents `git status`. The focused suite above includes every changed
    behavior and is clean. No attempt was made to weaken or work around the
    sandbox.
- Implementation-correction verification, 2026-09-12:
  - `npm run typecheck` — exit 0.
  - `npm run build` — exit 0, including `postbuild`.
  - `node --import tsx --test tests/producer-declaration.test.ts
    tests/producer-write-scope.test.ts tests/transition.test.ts
    tests/serialize.test.ts tests/cli.test.ts tests/detach.test.ts
    tests/spbridge-skill.test.ts` — 216 tests, 214 passed,
    0 failed, 2 skipped. The skips are the pre-existing nested-sandbox checks.
  - `npm test` — 598 tests, 557 passed, 29 failed, 12 skipped. Compared with the
    pre-correction run above, all three added tests pass and the failure/skip
    counts are unchanged. The same 29 Git-backed tests fail because the
    enclosing Bridge sandbox refuses Git's attempt to open `/dev/null`; no new
    failure was introduced.
  - Regression evidence: the pre-pass test now places admitted `src/a.ts`
    before refused `z-secret.txt` / `zz-secret.txt` and observes zero reads; a
    root mode change produces a real `.`-only live diff that proceeds; a live
    `live-only.txt` write populates status and event without `.`; an injected
    rollback failure persists a null field; and the config-write regression
    persists advisory `["AGENTS.md"]` independently from refused
    `["spartan-bridge", "spartan-bridge/config.yaml"]` on status and event.
  - Direct `validateProducerDeclaration` against this task artifact returned
    `{ "ok": true }`, pinning the reviewing frontmatter and retractable HX-005
    implementation-review envelope.
- Close-out verification, 2026-09-13, in the outer checkout with Git available:
  `NO_COLOR=1 npm test` at a staged tree containing `0fc8ce7` gives 618 tests,
  618 pass, 0 fail, and `npm run typecheck` exits 0. The 29 in-sandbox failures
  above do not reproduce, which settles AC-27.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-e38345d6-1518-41ed-bfaa-9ea779744358 execution_id=exec-d0229b4f-b65e-47b3-9820-ef1f42dfafc1 review_kind=plan verdict=pass reason_code=review_passed host=codex launcher=codex-plan-reviewer-v1 model=gpt-5.6-sol effort=high model_observed=declared_unobserved policy_digest=sha256:c032b4cea31dd45976e0e4d6a6b689590f1f0a1a368378fd8a82e546eb9525a3 task_hash=sha256:b7d7ec92b956d2f6be6d98fe5e8608f7c97cd2fea40d3aa6a612a29bfc5df221 agents_hash=sha256:6bd68578db8fd268d33c5847ff43bbf478ca1ed9c7a17c1a34df7ed723f5b8da timestamp=2026-09-12T20:34:38.123Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-21c16cea-51ae-4acb-bc9f-0cb4bab98cd4 execution_id=exec-5a5c6f12-3a35-44b3-b305-c5684b5eba7c review_kind=implementation verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-opus-5 effort=high model_observed=declared_unobserved policy_digest=sha256:e363264f72a848d870898b8d1d1abe453a4f1e519f622f4415d9531d867023f6 task_hash=sha256:53a4dbb6941e43e8334f89a6ec41ddeb0419e46ed8acd3ab82423f538a4b8dd5 agents_hash=sha256:6bd68578db8fd268d33c5847ff43bbf478ca1ed9c7a17c1a34df7ed723f5b8da timestamp=2026-09-12T21:02:39.588Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None. The in-sandbox full-suite failures recorded above were the producer
sandbox denying Git; the outer checkout's full suite is clean (Evidence).

## Next Action

None. Closed by the human operator on 2026-09-13 after the implementation
review passed and the work landed in `0fc8ce7`.

## Next Handoff

No outstanding handoff. The proposed review was consumed.
