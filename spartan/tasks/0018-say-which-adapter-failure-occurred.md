---
protocol: "1.0.0" # x-release-please-version
id: say-which-adapter-failure-occurred
created_at: 2026-08-18
status: completed
phase: complete
task_type: implementation
risk: material
current_role: human-operator
next_role: none
updated_at: 2026-08-18
handoff_id: HX-008
next_handoff_id: none
---

# Say which failure a review run hit

## Objective

A run that failed without a verdict records which failure it was, so that a client outage, a
launcher that never started, and a client that ran and returned nothing usable are told apart from
the persisted record alone, without reproducing the run.

## Context

`adapter_error` is the terminal for six distinct `terminate` sites across five lifecycle hooks. It
is not a code with one meaning and poor wording; it is the value the runtime falls back to whenever
the failure is not one of the four it names specifically.

| Site | Reached when | What the human should do |
| --- | --- | --- |
| `review.ts:297` | `preflight` threw a typed error the hook does not expect | unclear |
| `review.ts:558` | `prepare` threw anything other than isolation | unclear |
| `review.ts:565` | `start` or `collect` threw anything other than a timeout | see below |
| `review.ts:578` | `verify` threw anything other than write-detected | unclear |
| `review.ts:408` | the post-review repository snapshot failed | nothing; the child was fine |
| `review.ts:446` | persisting the review result failed | nothing; the child was fine |

The third row is the one that fires in practice, and `src/adapters/cursor.ts` feeds it from six
conditions: an invalid model argument and an unprepared adapter, neither of which spawns a child; a
rejected spawn; a stdout cap overflow; a non-zero exit; and an unparsable payload. Four of them
throw a bare `Error("adapter_error")` and the other two throw a bare `Error` naming an internal
sequencing fault, and all six land on the same terminal. A Cursor API outage and a `cursor-agent`
that fails to launch are among them, and nothing persisted separates the two.

Two corrections to the premise, both from reading the code rather than assuming it:

**The child's stderr is captured, then dropped.** `src/adapters/process.ts` already accumulates up
to 64 KiB of child stderr into `SpawnOutcome.stderr`. `collect()` reads `outcome.stdout` and never
touches it, so the bytes exist in memory at the moment of failure and are released with the handle.
This task finds a use for bytes already in hand; it adds no capture.

**A missing launcher usually reports `capability_denied`, not `adapter_error`.** `preflight()` runs
`cursor-agent --help` before any review spawn, and every way that probe can fail — spawn rejected,
non-zero exit, timeout, overflow, missing help tokens — collapses into `cursor_preflight_failed`
and terminates `capability_denied`. So the launcher-never-started case is real but sits one hook
earlier than the framing suggests, under a code that is just as silent about which of five things
went wrong. A plan that only widened `adapter_error` would leave the most common broken-launcher
path exactly as opaque as it found it. It is in scope here.

Recorded occurrences:

- `run-83f774f5` (2026-08-18, task `0014`): `review_started` at 19:57:52, `run_terminal` /
  `adapter_error` at 20:00:32. 160 seconds inside `collect`, `execution_id` present, nothing else.
  The identical command passed as `run-f8908217` once the outage cleared. The record cannot show
  that it was an outage; that was established by re-running it.
- `run-ab1cf4ec`, noted in task `0017`'s closing note as the same collapse.

Task `0017` faced the same shape of problem for `reviewer_write_detected` and answered it by
keeping the guard's behaviour identical and adding a nullable record field to `StatusDocument`
naming what was seen. That precedent is followed here deliberately, and D1 and D2 say where the
two cases differ.

## Scope

- `src/core/contracts.ts`: `AdapterFailureRecord` and its two closed vocabularies; one nullable
  `StatusDocument` field.
- `src/core/serialize.ts`: serialize the new field, deep-copied.
- `src/adapters/adapter.ts`: a typed error carrying the record; `AdapterTimeoutError` carries one too.
- `src/adapters/cursor.ts`: build the record at each failing site from the values already in hand.
- `src/core/review.ts`: thread the record onto the terminal status; build it for the two
  Bridge-owned phases; and apply D8's fallback for any hook throw that does not carry a record.
- `src/policy/redact.ts` (new): the redaction pass, reusing `isSensitiveRegistryKey`.
- `src/runtime/store.ts`: write `adapter-stderr.log` into the run directory.
- `docs/DECISIONS.md`: one entry. `docs/AUTHENTICATION-AND-SECURITY.md`: one paragraph under
  "Logging and redaction".
- Tests covering the record on every failing hook, the cause vocabulary, the log file, and the
  redaction pass.

## Out of Scope

- Any new, removed, or remapped `ReasonCode`. See D1 and D2.
- `EventDocument` and `serializeEvent`. See D6.
- Retry, backoff, or any automatic reaction to a classified failure. The runtime records; the human
  decides.
- Preserving the reviewer workspace on a failing path. Task `0017` D3 left this open deliberately
  and it stays open.
- The Cursor argv, env allowlist, timeouts, stdout cap, and prompt.
- `spartan-bridge status` and `events` output shape beyond the new status key, and the `/spbridge`
  skill's reporting rules. Teaching the skill to read the new field is a separate, later round.

## Constraints

- Additive only. No existing `status.json` key is removed, renamed, or reordered ahead of the new
  one, and `SCHEMA_VERSION` stays `2`, matching how task `0017` added `reviewer_write`.
- No credential, token, account identifier, launcher command, absolute path, or home-directory
  prefix may appear in `status.json` or on stdout. The authentication boundary in `AGENTS.md` and
  `docs/AUTHENTICATION-AND-SECURITY.md` applies unchanged to every new artifact.
- No change to how the child is spawned: same argv tables, same env allowlist, same direct spawn
  with argument arrays and no shell interpolation.
- The stderr log stays inside `.spartan-bridge/runs/<run-id>/`, which is gitignored, and is written
  with the same restrictive permissions and atomic temp-then-rename the run directory already uses.
- No new runtime dependency.

## Acceptance Criteria

- [x] `StatusDocument` carries `adapter_failure: AdapterFailureRecord | null`, and `serializeStatus`
      emits it deep-copied, in the same manner as `serializeReviewerWrite`. `SCHEMA_VERSION` is
      still `2` and no other key moved.
- [x] The record is non-null exactly for terminals reached from a lifecycle hook throwing
      (`preflight`, `prepare`, `start`, `collect`, `verify`) and from the two Bridge-owned
      post-review phases, and null for every other terminal — including `capability_denied` raised
      by the `capabilitiesAllowed` check, which never entered a hook. A test asserts both directions
      over the persisted `status.json`.
- [x] `phase` is one of `preflight`, `prepare`, `start`, `collect`, `verify`,
      `post_review_snapshot`, `persist_result`, and names the hook the failure came from. Every
      case in `tests/lifecycle.test.ts` is extended to assert its phase, and the six existing
      `adapter_error` sites are covered by at least one case each.
- [x] `cause` is one of `not_spawned`, `spawn_failed`, `timed_out`, `exit_nonzero`,
      `output_overflow`, `output_unparsable`, `interface_unrecognized`, `unexpected_error`,
      `runtime_error`, and **each of the nine is asserted at least once on a persisted
      `status.json`**, not merely declared in the union. The nine are reachable as: `not_spawned`
      from an invalid model argument and from an unprepared adapter; `spawn_failed`, `timed_out`,
      `exit_nonzero`, `output_overflow`, `output_unparsable` from a stub runner in the
      Cursor-adapter tests; `interface_unrecognized` from a probe that exits 0 without the expected
      help tokens; `unexpected_error` from the out-of-place lifecycle fixtures under D8;
      `runtime_error` from the two Bridge-owned phases at `review.ts:408` and `:446`. A cause with
      no test is a value an implementer may never emit.
- [x] `exit_code` is the child's exit status when a child ran and exited, and `null` when no child
      was created or the child did not exit normally.
- [x] The record is built in the failing path from the values that caused the failure, before any
      cleanup: `collect()` constructs it from the `SpawnOutcome` it already holds, and `preflight()`
      from its own. The diff shows no second inspection of the child, the handle, or the workspace
      after the throw. A record recomputed later would find the handle released and the workspace
      removed, and would report nothing — this is task `0017` D4 one layer down.
- [x] The `ReasonCode` union is unchanged, and no `terminate` call's `reason` argument is edited.
      Every existing reason and state expectation in `tests/lifecycle.test.ts`,
      `tests/cursor-adapter.test.ts`, and `tests/review.test.ts` passes without modification to the
      expected value.
- [x] `EventDocument`, `serializeEvent`, and the bytes of `events.jsonl` are unchanged for a run
      that does not fail, and gain no field for one that does.
- [x] When a child produced stderr on a failing path, it is written to
      `<run-dir>/adapter-stderr.log` with mode `0600` via temp-then-rename, holding the tail of at
      most 16 KiB after redaction. When there are no bytes to write, no file is created.
- [x] `stderr_log` is a run-directory-relative filename or `null`, and `stderr_bytes` is the byte
      length of the written file, `0` exactly when `stderr_log` is `null`.
- [x] `status.json` contains no stderr text. A test runs a stub child that writes a
      credential-shaped line to stderr and asserts the serialized status document contains neither
      that line nor any absolute path or home-directory prefix.
- [x] The redaction pass removes, from a fixture containing all of them: a `Bearer` value, an
      `Authorization:` header value, a combined `Authorization: Bearer <token>` header, an
      `sk-`-prefixed token, a JWT-shaped three-part run, the value of any `key=value` or
      `key: value` whose key is sensitive under `isSensitiveRegistryKey`, and any absolute path
      under the process home directory. The surrounding provider message survives in the written
      file, asserted positively so a pass that redacts everything fails.
- [x] The two cases the Objective names are separable from `status.json` alone, and the test is
      the pair itself rather than a neighbouring pair. The never-started case is a **`preflight`
      probe failure**, which D7 places on `capability_denied`: its record carries
      `phase: "preflight"` and one of `spawn_failed`, `timed_out`, `exit_nonzero`,
      `output_overflow`, `interface_unrecognized` — never `unexpected_error`, which would make the
      five collapsed probe failures as coarse as the terminal they already share. The outage case
      is `phase: "collect"`, `cause: "exit_nonzero"`, with a non-null `exit_code`. A test persists
      both and asserts they differ in `phase`, and that the distinction is made without reading
      `adapter-stderr.log`.
- [x] A record for a `collect` non-zero exit and a record for a `start` rejected spawn differ in
      `cause`, so the two failures inside the review path are also separable. This is a second
      pair, not a substitute for the one above.
- [x] `docs/DECISIONS.md` gains one entry recording this decision, and
      `docs/AUTHENTICATION-AND-SECURITY.md` gains one paragraph under "Logging and redaction"
      naming the new artifact, its permissions, its cap, and that redaction is defence in depth.
- [x] `npm run typecheck` and `npm test` exit 0.

## Decisions

### D1 - No new reason code

This is the decision the round was asked to make explicitly, and the answer is no.

The obvious move is to split `adapter_error` into `adapter_spawn_failed`, `adapter_exit_nonzero`,
and so on. Three things argue against it.

**The codes would not make the distinction that matters.** The 2026-08-18 outage and a malformed
prompt both leave the child exiting non-zero. They would share `adapter_exit_nonzero` and the human
would be back where they started, needing the exit status and the client's own message. Whatever
separates them is a record, not a label — so the record is needed either way, and once it exists
the codes add a second, coarser copy of what it already says.

**The existing mapping is deliberate and would have to be broken.** `tests/lifecycle.test.ts` pins
nine cases whose whole point is that an error type thrown from a hook that does not expect it
becomes `adapter_error`: a timeout from `prepare`, an isolation error from `start`, a write-detected
from `collect`. The design is that each reason code names one expected outcome of one hook, and
`adapter_error` is the honest statement that something arrived out of place. That is a defensible
contract. Its defect is not the fallback; it is that the fallback records nothing about where it
came from.

**Every code is a contract other things must learn.** `ReasonCode` is read by the MCP outcome
mapping, by `skills/spbridge/SKILL.md`, which is instructed to report the code by name and not
invent one, and by anything parsing `status.json`. Task `0017` faced this and chose to keep
`reviewer_write_detected` and add `reviewer_write`; the same trade applies here with the same
answer.

What would change this answer, stated so a later round can test it rather than re-argue it: a
consumer that must branch on the failure class without reading `status.json` — an `events.jsonl`
reader, since D6 keeps the record off events. None exists today.

### D2 - No terminal is remapped, and no behaviour changes

Every run that fails today fails the same way after this change, in the same state, with the same
reason code, having written the same task-artifact regions. Only the record gains detail.

Two remappings are visibly tempting and both are refused. A timeout from `preflight` reaching
`adapter_error` while `adapter_timeout` exists looks like a bug; under D1's reading it is the
deliberate out-of-place fallback, and `phase: "preflight"`, `cause: "timed_out"` says so without
touching a pinned expectation. The two Bridge-owned failures at `review.ts:408` and `:446` blame
the adapter for work the adapter did not do; `phase: "post_review_snapshot"` and
`phase: "persist_result"` with `cause: "runtime_error"` correct the record without moving the code.

Holding this line is what keeps the change reviewable: the diff either adds a field and its
plumbing, or it does something else.

### D3 - One nullable `StatusDocument` field, carrying no free text

`adapter_failure` mirrors `reviewer_write`: nullable, additive, absent from `EventDocument`,
deep-copied on serialize, no `SCHEMA_VERSION` bump.

```ts
export type AdapterFailureRecord = {
  phase: AdapterFailurePhase;      // closed vocabulary, 7 values
  cause: AdapterFailureCause;      // closed vocabulary, 9 values
  exit_code: number | null;
  stderr_bytes: number;
  stderr_log: string | null;       // run-dir-relative filename
};
```

A `stdout_overflow: boolean` was on this type and has been removed. `cause: "output_overflow"`
already carries that fact, and a second copy of it is a field with no rule for when it is true,
which an implementation can leave `false` forever while satisfying every other criterion. One fact,
one field.

Five fields, every one a closed vocabulary, a number, or a fixed filename. There is no field on
this type through which provider text, a launcher command, a credential, or an absolute path could
arrive. The authentication-boundary criterion is therefore a property of the type rather
than a habit of whoever writes the formatter — the argument task `0014` D4 made for its progress
payload, and the reason that payload survived review.

`phase` and `cause` are separate on purpose. `phase` says which of the runtime's own steps was
running, and is the axis the six collapsed sites differ on. `cause` says what was observed there,
and is the axis an outage differs from a bad install on. Either alone leaves a pair
indistinguishable.

### D4 - Provider text goes to a file in the run directory, never into `status.json`

The client's own stderr is the artifact that names an outage, and it is also the one input here the
Bridge does not control the content of. Those two facts pull in opposite directions and the split
is between them: the runtime's classification goes in the status document, the client's words go in
`.spartan-bridge/runs/<run-id>/adapter-stderr.log`.

`status.json` is written to stdout by both `review` and `status`, and task `0014` spent a whole
round keeping those bytes a contract. Putting an unbounded, provider-controlled string into that
document would push untrusted text into every terminal, pipe, and MCP `tools/call` result that
reads it, at exactly the place the boundary is most expensive to get wrong. The log file is
`0600`, inside a gitignored directory, written atomically the way `status.json` and the review
result already are, and reachable by a human who has decided to look.

The cost is that `spartan-bridge status` will not show the client's message and `/spbridge` cannot
report it. That is accepted: the status document answers *which failure*, which is this task's
objective, and the log answers *what the client said*, which is the next question and one worth
walking to.

The cap is 16 KiB of the **tail** — a failing client prints its error last, and a head cap would
reliably capture the startup banner and discard the reason. The 64 KiB ceiling in `process.ts` is
unchanged; this is a second, tighter cap at the point of persistence.

### D5 - Redact with the vocabulary the repository already owns

`docs/AUTHENTICATION-AND-SECURITY.md` requires redaction of common credential formats and of
home-directory prefixes, and states that redaction is defence in depth rather than permission to
ingest credentials. Both halves are honoured: the log exists because provider output is the
evidence, and it is scrubbed because provider output is not trusted to be clean.

The pass removes a `Bearer` value, an `Authorization:` header value, an `sk-`-prefixed token, a
JWT-shaped run, any absolute path under the process home directory, and the value of any
`key=value` or `key: value` pair whose key is sensitive under `isSensitiveRegistryKey`.

That last clause is the point of the decision. `src/policy/sensitive-fields.ts` already defines what
this repository considers a sensitive key, with its own tokenizer and tests, and it is already used
to filter the child environment. Reusing it means there is one such vocabulary to correct rather
than two that can drift, and it keeps this from becoming the custom secret scanner the boundary
warns about. The literal shapes above are a short, named, checkable supplement to it, not a general
detector.

The acceptance criterion asserts positively that the surrounding message survives, because a
redaction pass that empties the file satisfies every negative assertion and delivers nothing.

### D6 - The record stays off `events.jsonl`

`EventDocument` carries the run's decisions in sequence; it already carries `reason_code`, and
`status.json` sits beside it in the same directory holding the detail. Task `0017` put
`reviewer_write` on the status document only, for the same reason, and a reader who has one file
has both.

This is also what makes D1's exit condition meaningful: if a consumer ever needs the failure class
from the event stream alone, that is the moment a reason-code split earns its cost, and the two
decisions stay coherent.

### D7 - `preflight` is included, because that is where a broken launcher actually lands

The Context correction has a consequence for scope, so it is settled here rather than left to the
implementer. A missing or broken `cursor-agent` terminates `capability_denied` from `preflight`,
not `adapter_error` from `collect`. Excluding it would keep the field's invariant one line shorter
and leave the named case — a launcher that never started — exactly as undiagnosable as before.

So `preflight` throws the same typed error, carrying the same record, and the `capability_denied`
terminal raised from the `preflight` catch gets one. `cause: "interface_unrecognized"` covers the
one preflight failure with no analogue later: the probe ran and exited cleanly but its help output
did not contain the expected flags, which means the installed client is not the interface this
adapter was written against.

The `capability_denied` returned by the `capabilitiesAllowed` check is *not* included. No hook ran,
so there is no phase to name, and inventing one would make the field's invariant untestable.

### D8 - Every hook throw produces a record, including the out-of-place ones

The criterion says the record is non-null for every terminal reached from a hook throwing, and the
lifecycle fixtures throw types the hook does not expect on purpose — an `AdapterTimeoutError` from
`prepare`, an `AdapterIsolationError` from `start`, a `ReviewerWriteDetectedError` from `collect`.
Those throws come from a fake adapter and carry no record. Without a stated rule, nothing
constructs one and the criterion is unsatisfiable rather than merely unchecked.

So `src/core/review.ts` applies a fallback wherever it catches a hook throw that does not carry a
record: `phase` is the hook that threw, `cause` is `unexpected_error`, `exit_code` is `null`,
`stderr_bytes` is `0`, and `stderr_log` is `null`. The adapter supplies a record when it has
observed something; the core guarantees one exists either way.

This keeps D1 honest. `adapter_error` stays the fallback terminal, and `cause: "unexpected_error"`
is its record — an out-of-place error type is now labelled as such and located at a hook, rather
than being indistinguishable from a client that exited non-zero. The fallback is deliberately the
least informative record the type can express, so an implementer who reaches for it where a real
observation was available is visible in the diff.

`unexpected_error` is therefore reserved: it is not permitted for a `preflight` probe failure,
which D7 and its criterion require to carry one of the five observed causes.

## Work Completed

- Planner HX-001 through plan re-review HX-002 recorded D1-D8 and closed the plan (`APPROVED`,
  run `run-3532e742`). Human-operator HX-003 committed task `0014` alone as `f7dc1ef`.

- Implementer HX-004 (Cursor, cursor-grok-4.6-high-fast, effort none):
  accepted HX-004. Added `AdapterFailureRecord` and the two closed vocabularies on
  `StatusDocument`; `serializeStatus` emits `adapter_failure` deep-copied after `reviewer_write`;
  `SCHEMA_VERSION` stays `2`. Introduced `AdapterFailureError`; `AdapterTimeoutError` optionally
  carries a record. Cursor failing sites now throw that typed error (or `AdapterTimeoutError` on
  collect timeout) built from the `SpawnOutcome` already in hand. `review.ts` persists the record
  on every hook throw (D8 fallback `unexpected_error` when none is carried) and on the two
  Bridge-owned phases (`runtime_error`). `src/policy/redact.ts` redacts stderr; `store.ts` writes
  `adapter-stderr.log` at mode `0600` via temp-then-rename, or creates no file when there are no
  bytes. Docs: `docs/DECISIONS.md` D-018 and one paragraph under Logging and redaction. No
  `ReasonCode` added, removed, or remapped; no `terminate` `reason` argument edited.

- Reviewer HX-005 (Claude Code, claude-opus-5, effort high, Anthropic): accepted HX-005. Read-only
  review of the whole diff plus the four new/changed test files against Scope and every acceptance
  criterion; re-ran `npm run typecheck` and `npm test`; probed `redactAdapterStderrText` directly
  with realistic header shapes. Verdict `CHANGES_REQUESTED` on one confirmed redaction defect. No
  product file was edited.

- Implementer HX-006 (Cursor, cursor-grok-4.6-high-fast, effort none):
  accepted HX-006. F1: `Authorization` redaction now consumes an optional `Bearer` scheme before
  the value, so `Authorization: Bearer <token>` is fully replaced; the combined header plus the
  compact and lowercase variants are in `tests/redact.test.ts`. F2: `persistAdapterFailure` catches
  a failed stderr write and falls back to `stderr_log: null`, `stderr_bytes: 0`, so the terminal
  still seals. F3: `preflight()` wraps `runner.start` the same way `start()` does, so a synchronous
  throw is `spawn_failed`, not D8 `unexpected_error`. F4 and F5 left as observations. Redaction
  criterion re-ticked.

- Reviewer HX-007 (Claude Code, claude-opus-5, effort high, Anthropic): accepted HX-007. Read-only
  re-review of F1-F3 against the criteria they touch, plus the invariants the round must not move.
  All three fixes confirmed on evidence reproduced independently. Verdict `APPROVED`. One new
  non-blocking observation (F6) recorded. No product file was edited; only this artifact.


## Evidence

- `npm run typecheck` exited 0. `npm test` exited 0 (135 passed, 0 failed).
- `ReasonCode` in `src/core/contracts.ts` is the same 29-member union. The six `adapter_error`
  `terminate` sites still pass `"adapter_error"` as `reason`; preflight probe failures still
  terminate `capability_denied`.
- Lifecycle cases now assert `adapter_failure.phase` and D8 `unexpected_error` on persisted
  `status.json`. Cursor-adapter tests persist all nine causes: `not_spawned` (unprepared and
  invalid model), `spawn_failed` (rejected start), `timed_out`, `exit_nonzero`, `output_overflow`,
  `output_unparsable` from the stub runner, `interface_unrecognized` from a clean probe without
  help tokens; lifecycle covers `unexpected_error`; Bridge-owned phases cover `runtime_error`.
- Named pair: persisted `preflight` / `spawn_failed` / `capability_denied` versus `collect` /
  `exit_nonzero` / `adapter_error` differ in `phase` without reading the log. Second pair: `start`
  / `spawn_failed` versus `collect` / `exit_nonzero` differ in `cause`.
- Nullability: hook throw and the two Bridge-owned phases are non-null; `capabilitiesAllowed`
  `capability_denied`, `path_invalid`, and `review_passed` are null. Event keys are unchanged and
  omit `adapter_failure`.
- Stderr log: stub child with a credential-shaped line writes `adapter-stderr.log` mode `0600`;
  surrounding "provider outage: rate limit exceeded." survives; `status.json` contains neither the
  secret line nor a home-directory prefix. Empty stderr creates no file (`stderr_log` null,
  `stderr_bytes` 0).
- `tests/redact.test.ts` fixture contains Bearer, Authorization, `sk-`, JWT, sensitive key pairs,
  and a home path; the surrounding message is asserted present.

Reviewer HX-005:

- `npm run typecheck` exited 0. `npm test` exited 0 (135 passed, 0 failed) — the implementer's
  recorded outcomes reproduce.
- Re-read the whole diff. Confirmed independently: `ReasonCode` unchanged and no `terminate`
  `reason` argument edited; `adapter_failure` sits between `reviewer_write` and `created_at` with
  `SCHEMA_VERSION` still `2`; `EventDocument` and `serializeEvent` gain nothing, asserted per event
  in `tests/adapter-failure.test.ts`; the `capabilitiesAllowed` denial at `review.ts:293` passes no
  record and stays null; records are built inside the failing path from the `SpawnOutcome` already
  held, with no second inspection after the throw.
- Confirmed defect F1 by direct probe of `redactAdapterStderrText`: input
  `"Authorization: Bearer tok_live_SECRETVALUE"` returns
  `"Authorization: [redacted] tok_live_SECRETVALUE"`. The `Authorization` rule consumes the scheme
  word `Bearer` as its `\S+` value, so the later `Bearer` rule finds no match and the credential
  survives into `adapter-stderr.log`. Reproduced for `authorization: bearer …`,
  `Authorization:Bearer …`, and the header embedded mid-line.
-   `src/adapters/process.ts` confirms F3 is latent, not live: `NodeProcessHandle` never throws
  synchronously from `start`, so with the real runner a launcher `ENOENT` reaches `wait()` and is
  classified `preflight` / `spawn_failed` as D7 requires.

Implementer HX-006:

- `npm run typecheck` exited 0. `npm test` exited 0 (136 passed, 0 failed).
- Combined header: fixture line `Authorization: Bearer tok_live_SECRETVALUE` (plus
  `Authorization:Bearer …` and `authorization: bearer …`) is absent from the redacted output;
  `provider outage: rate limit exceeded.` remains. The Cursor stderr-log test also asserts
  `tok_live_SECRETVALUE` does not appear in `adapter-stderr.log`.
- F2: a collect throw with stderr against a colliding `adapter-stderr.log` directory still emits
  `run_terminal` / `adapter_error` with `stderr_log` null and `stderr_bytes` 0.
- F3: a `ProcessRunner` whose `start` throws synchronously persists `preflight` / `spawn_failed`
  on `capability_denied`, never `unexpected_error`.
- `ReasonCode` union, `terminate` `reason` arguments, status key order, and event keys are
  unchanged.

Reviewer HX-007:

- `npm run typecheck` exited 0. `npm test` exited 0 (136 passed, 0 failed) — HX-006's outcomes
  reproduce.
- F1 closed. Direct probe of `redactAdapterStderrText` over eleven header shapes:
  `Authorization: Bearer <tok>`, `Authorization:Bearer <tok>`, `authorization: bearer <tok>`,
  the all-caps and extra-whitespace form, the header embedded mid-line, and the bare
  `Bearer <tok>` and `Authorization: <tok>` forms all return `[redacted]` with no credential
  substring surviving. `Proxy-Authorization: Bearer <tok>` is covered by the same rule. The
  surrounding `provider outage: rate limit exceeded.` survives in `tests/redact.test.ts`, asserted
  positively.
- F2 closed. `persistAdapterFailure` wraps `writeAdapterStderrAtomic` in `try`/`catch` falling back
  to `stderr_log: null`, `stderr_bytes: 0`; `tests/adapter-failure.test.ts` forces the write to fail
  by pre-creating `adapter-stderr.log` as a directory and asserts the last event is `run_terminal`
  with `adapter_error`.
- F3 closed. `preflight()` wraps `runner.start` in `try`/`catch` yielding
  `fail("preflight", "spawn_failed", …)`; `tests/cursor-adapter.test.ts` drives a `ProcessRunner`
  whose `start` throws synchronously and asserts `preflight` / `spawn_failed` on
  `capability_denied`, with an explicit `notEqual` against `unexpected_error`.
- Invariants re-checked directly, not taken from the implementer's note: `ReasonCode` is the same
  29-member union with no diff hunk touching it; the six `adapter_error` `terminate` sites still
  pass `"adapter_error"`; `serializeStatus` inserts `adapter_failure` between `reviewer_write` and
  `created_at` with no other key moved and `SCHEMA_VERSION` still `2`; `serializeEvent` is
  untouched and `tests/adapter-failure.test.ts` pins `Object.keys(event)` against a fixed list and
  asserts `"adapter_failure" in event` is false.
- Docs present: `docs/DECISIONS.md` D-018 and one paragraph under Logging and redaction naming the
  artifact, mode `0600`, the 16 KiB cap, and defence in depth.


## Review

<!-- spartan-bridge:review:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-3532e742-28bb-418b-be61-f5175745fc5e execution_id=exec-5f797593-a635-4413-b485-2cab509bb2dc review_kind=plan verdict=pass reason_code=review_passed host=cursor launcher=cursor-plan-reviewer-v1 model=cursor-grok-4.6-high-fast effort=none model_observed=declared_unobserved policy_digest=sha256:5ce5ce183767d86bbd03d6217f03b8849dd70c4a7609b5b84f750ecbb1d0100f task_hash=sha256:ea3979aca0ddaa164e6ed6f5eff9a9420fc033e3c722dfe96575e470d57ef987 agents_hash=sha256:30644e4ddfe923cc72bc6a40fd5d26c1af74682d01e4329f4c5d93016be00e7f timestamp=2026-08-18T22:44:21.499Z
<!-- spartan-bridge:review:end -->

Verdict: APPROVED

Implementation re-review, HX-007, Claude Code / claude-opus-5 at high effort, read-only. Plan review
remains `APPROVED` above. F1, F2, and F3 from HX-005 are closed on evidence reproduced in this
session, and the three invariants the fixes could have disturbed — the `ReasonCode` union, the
`status.json` key order, and the `events.jsonl` bytes — are unmoved. Every acceptance criterion is
satisfied, including the redaction one, which was the blocker.

Findings:

- **F1 - closed.** The `Authorization` rule now consumes an optional `Bearer` scheme before its
  value, and the combined header plus the compact, lowercase, all-caps, extra-whitespace, and
  mid-line variants are pinned in `tests/redact.test.ts`. Probed directly; no credential substring
  survives any of them.
- **F2 - closed.** The stderr write is wrapped and falls back to `stderr_log: null`,
  `stderr_bytes: 0`, so the terminal is still reached. A test forces the write to fail and asserts
  the run seals with `run_terminal` / `adapter_error`.
- **F3 - closed.** `preflight()` guards `runner.start` the way `start()` does, and a synchronous
  throw persists `preflight` / `spawn_failed`, asserted against `unexpected_error` explicitly.
- **F4, F5 - carried forward as observations, unchanged.** `unexpected_error` is recorded for two
  guards working as designed, and the core discards the more authoritative hook label it holds in
  favour of the adapter's. Neither is a defect under the criteria as written; both are inputs to a
  later round that revisits the `cause` vocabulary.
- **F6 (new observation, no change requested, `src/policy/redact.ts:26`) — non-`Bearer` auth
  schemes keep their credential.** The fix is scheme-specific by design: `Authorization: Basic
  <base64>` and `Authorization: Token <tok>` redact the scheme word and leave the value, the same
  shape F1 had. This is not a regression and not a blocker — it is the narrower of the two fixes
  HX-005 offered, the criterion names only the `Bearer` form, and the log is `0600` inside a
  gitignored directory with redaction explicitly defence in depth under D5. Recorded because a
  later round that widens the rule to consume the rest of the header value would close the class
  rather than one member of it.

## Blockers

None.

## Next Action

None. The task is complete.

## Next Handoff

No outstanding proposal. This task is closed.

Non-binding note for the human: Out of Scope deferred teaching the `/spbridge` skill to read
`adapter_failure`. The field is now persisted but no reporting surface reads it, so a run that fails
still reads the same way to the skill's consumer as it did before. That is the identifiable
follow-up, and it is a new task rather than a continuation of this one.
