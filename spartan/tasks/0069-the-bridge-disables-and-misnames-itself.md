---
protocol: "1.1.0" # x-release-please-version
id: the-bridge-disables-and-misnames-itself
created_at: 2026-09-03
status: completed
phase: complete
task_type: implementation
risk: material
current_role: human-operator
next_role: none
updated_at: 2026-09-03
handoff_id: HX-005
next_handoff_id: none
---

# The Bridge disables its own CLI during a chain, and misnames the state at the end of one

## Objective

Two defects observed in the same auto-chain, both of the same family — the
Bridge misrepresenting or disabling itself while running its own chain:

1. `spartan-bridge` stays runnable for the whole of a producer round. Today the
   write-scope guard strips the executable bit from the very file the installed
   command resolves to, so `wait`, `status`, and `resume` die with exit 126
   exactly while a chain is in flight.
2. A terminal run document names a state that is true of the round that
   follows. Today a passed **implementation** review reports
   `state: awaiting_implementer`, when nothing is awaiting an implementer and
   the next step is the human gate.

## Context

Both surfaced on 2026-09-03 during the `0064` auto-chain — the first full
chain in this repository after `0067` made the plan-target scan advisory.

**Defect 1 — the CLI disables itself.** Mid-round the driving session hit:

```text
$ spartan-bridge wait --repo … --run run-1ca9bfd2-… --timeout-ms 25000
(eval):1: permission denied: spartan-bridge          # exit 126
$ ls -l …/dist/cli/main.js
-r--r--r--@ 1 example-user  staff  22203 Sep  3 17:02 …/dist/cli/main.js
```

The chain of causation is entirely inside this repository:

- The global command is an npm link:
  `~/.nvm/versions/node/<v>/bin/spartan-bridge` →
  `~/.nvm/versions/node/<v>/lib/node_modules/spartan-bridge` → this checkout's
  `dist/cli/main.js`. `npm run build` ends with `chmod +x dist/cli/main.js`.
- The producer write-scope guard locks every non-admitted path in the tree:
  `PRODUCER_WRITE_SCOPE_FILE_MODE = 0o444`,
  `PRODUCER_WRITE_SCOPE_DIR_MODE = 0o555`
  (`src/adapters/producer-write-scope.ts:14-15`).
- `dist` is not in `SKIPPED_DIR_NAMES` (`src/core/snapshot.ts:20-28`, which
  holds `.git`, `node_modules`, `.spartan-bridge`, `.claude`, `.cursor`,
  `.venv`, `venv`), and it is not in the automatic write scope. So
  `dist/cli/main.js` goes to `0444` and loses `+x` for the duration.
- The guard restores the recorded mode afterwards; the file was back at `0755`
  when the round ended. The window is the producer round, not permanent.

The blast radius is the Bridge's own operating loop: `SKILL.md` step 4 is a
`--detach` + `wait` loop, and `wait` is exactly what cannot run while the
producer holds the lock. On 2026-09-03 the session improvised with
`node …/lib/node_modules/spartan-bridge/dist/cli/main.js wait …`, which works
because `node` does not need the executable bit — but no operator should have
to discover that, and `SKILL.md` does not teach it.

Note the interaction with the stale-build refusal: those same `node …` calls
printed `dist/ is older than src/; run npm run build` on stderr, because the
mapped implementer was editing `src/` at that moment. That warning is correct
and benign; it is not this defect and must not be conflated with it.

**Defect 2 — the terminal state names the wrong thing.**
`VERDICT_TO_TERMINAL` (`src/core/contracts.ts:586-599`) is keyed on the verdict
alone:

```ts
pass: { state: "awaiting_implementer", reason_code: "review_passed" },
```

`review_kind` is not consulted. For a plan review that is right: a pass is
followed by an implementer round, whether the chain spawns it or a human does.
For an implementation review it is wrong: the pass ends the chain and hands to
the human gate. `RunState` (`src/core/contracts.ts:38-47`) has no member
meaning "approved, nothing pending" — the eight are `requested`,
`policy_resolved`, `reviewing`, `changes_requested`, `awaiting_implementer`,
`human_required`, `blocked`, `failed`.

Tasks `0063`, `0064`, and `0067` all ended with a passed implementation review
reporting `awaiting_implementer`. Nothing downstream is broken, because
`SKILL.md` reports `verdict` and `reason_code` by name and never branches on
`state` alone. The cost is that an operator reading a run document is told a
round is pending that is not.

## Scope

- `src/adapters/producer-write-scope.ts` (D1)
  - The unadmitted-file lock mode, `lockTree`, `applyMode`, and
    `restoreProducerWriteScope`. `SKIPPED_DIR_NAMES` and the producer snapshot
    policy stay as they are.
- `src/core/contracts.ts` (D2)
  - Add one `RunState` member. Consult `review_kind` when mapping a `pass`
    verdict. `SCHEMA_VERSION` stays `2`.
- `src/core/review.ts` (D2)
  - The `VERDICT_TO_TERMINAL[result.verdict]` call site that writes run state.
- `src/core/serialize.ts` (D2)
  - Keep already-persisted run documents readable; do not remap historical
    `awaiting_implementer`.
- `src/cli/detach.ts` (D2)
  - Treat the new member as a terminal run state. Plan-pass
    `awaiting_implementer` remains the chaining signal.
- `agent-skill/skills/spbridge/SKILL.md` (D3)
  - Step 4 keeps the existing missing-PATH fallback and gains no 126
    workaround.
- `src/cli/main.ts`, `tests/cli.test.ts` (D2/D3, verify-only)
  - `formatReviewTerminalLine` already prints `review ${status.state}`;
    expected diff is empty unless typecheck names these files.
- `docs/DECISIONS.md`, `docs/AUTHENTICATION-AND-SECURITY.md`
  - D1's lock-mode formula and the write bits it still denies; D2's new
    `RunState` member and the `pass` mapping.
- Tests: `tests/producer-write-scope.test.ts`, `tests/transition.test.ts`,
  `tests/serialize.test.ts`, `tests/cli.test.ts`, `tests/detach.test.ts`,
  `tests/spbridge-skill.test.ts`.

## Out of Scope

- The stale-build refusal (`dist/ is older than src/`). Correct as it stands.
- Changing how the CLI is installed, or asking the operator to install it
  outside the checkout. The Bridge must work with the documented install
  (`agent-skill/scripts/manage-install.sh`, npm link into this checkout).
- Relaxing the guard for any path other than what D1 pins. `AGENTS.md` and
  `spartan-bridge/config.yaml` stay unwritable per `0067` D1.
- Renaming `awaiting_implementer` itself, or removing any existing `RunState`
  member. Historical documents keep their vocabulary.
- The `write_scope_violation` path-naming defect — that is task `0068`.

## Constraints

- English artifact.
- D1 must not create a write path. The executable bit is not a write
  permission: `0555` on a file still denies write, and the Darwin
  `deny file-write*` filter is unchanged by a mode bit. Any solution that
  admits `dist/` to the write scope is rejected.
- The guard's restore step must still return every path to its recorded mode;
  D1 must not leave a file permanently `0555` that was `0444` before.
- `SCHEMA_VERSION` stays `2`. An added `RunState` member is additive; a run
  document written before this task still parses, and an unknown state
  does not throw.
- `npm run typecheck` / `npm run build` clean; `npm test` no new failure.

## Decisions

- **D1 — lock unadmitted files to `0444 | (recorded & 0111)`; reject (b)
  and (c).** `lockTree` today applies `PRODUCER_WRITE_SCOPE_FILE_MODE`
  (`0o444`) to every unadmitted regular file, FIFO, socket, or device. An
  unadmitted file whose recorded mode (`stat.mode & 0o7777`) has any of the
  execute bits `0o111` therefore loses `+x` for the producer window. Replace
  that constant with a lock mode of `0o444 | (recorded & 0o111)`:

  - recorded `0755` locks to `0555`;
  - recorded `0744` locks to `0544`;
  - recorded `0644` locks to `0444`;
  - recorded `0711` locks to `0511`.

  The formula preserves only execute bits that were already set. It does not
  grant group or other execute that the recorded mode lacked, and it does not
  preserve setuid, setgid, or sticky on the locked mode (today's `0o444`
  already drops those; restore still returns the full recorded `0o7777`).
  Directories stay on `PRODUCER_WRITE_SCOPE_DIR_MODE` (`0o555`). Writable
  admitted files stay on `writableFileMode`. `restoreProducerWriteScope` is
  unchanged: it `chmod`s every `guard.restores` entry back to the mode
  recorded before the lock, in reverse order.

  What the guard still denies for every unadmitted path, including every
  file that keeps `+x`:

  - POSIX: no write bit, so `open(O_WRONLY)`, `write`, and `truncate` fail
    the same way they do on `0444`;
  - Darwin `producerWriteScopeSandboxProfile`: `deny file-write*` is
    unchanged — create, data, mode (`chmod`), unlink, rename, flags, and
    xattr under the repository root outside admitted paths;
  - post-child producer snapshot: `dist` is not added to
    `SKIPPED_DIR_NAMES`, so a mutation of `dist/cli/main.js` remains a
    `write_scope_violation`;
  - admission: `dist/` is not added to the automatic write scope;
    `AGENTS.md` and `spartan-bridge/config.yaml` stay unwritable.

  The executable bit is not a write permission. A file that was already
  executable stays executable; a file that was not does not become
  executable. The security paragraph in
  `docs/AUTHENTICATION-AND-SECURITY.md` states this formula and the three
  denials above.

  **(b) is rejected.** `lockTree` does not skip `SKIPPED_DIR_NAMES`. Adding
  `dist` would still `chmod` `dist/cli/main.js` to `0444`, so the observed
  exit 126 would remain. Skipping the walk as well would drop `dist` from
  per-file snapshot hashes (producer policy records a skipped tree as one
  metadata digest) and would make `producerPathDenied` true for every path
  component named `dist`. Leaving the file at recorded `0755` would keep
  owner-write — a POSIX write path this task forbids. The snapshot and
  violation-detection loss is not acceptable.

  **(c) is rejected.** Exempting the running CLI realpath from `chmod`
  leaves recorded `0755` (owner-write) on that inode. The Darwin profile
  would still deny `file-write*`, but Cursor's producer preflight states
  that the POSIX lock alone is not fail-closed without `sandbox-exec`, and
  this task must not drop a write-denial layer for that path. Locking only
  that realpath to `0555` would deny write, but it special-cases
  `process.argv[1]` / npm-link resolution and leaves every other
  unadmitted `+x` file disabled. (a) is the same write denial without that
  coupling.

- **D2 — add `RunState` member `review_passed`; consult `review_kind` only
  for `pass`; leave historical `awaiting_implementer` as written.**
  `VERDICT_TO_TERMINAL` stays a `Record<BridgeVerdict, …>`. Its `pass`
  entry remains `{ state: "awaiting_implementer", reason_code:
  "review_passed" }` — that is the plan-review mapping and the value
  `src/core/task-write.ts` already reads for `reason_code` only. Do not
  explode the table into eight `(verdict, review_kind)` keys.

  Add `terminalForVerdict(verdict, reviewKind)` next to the table. For
  `pass` + `implementation` it returns `{ state: "review_passed",
  reason_code: "review_passed" }`. For `pass` + `plan` and for every other
  verdict it returns `VERDICT_TO_TERMINAL[verdict]`.
  `src/core/review.ts` (the site that writes run `state`) calls the
  function. `src/core/task-write.ts` may keep indexing the table: it
  copies only `reason_code`, and `pass`'s reason code does not vary by
  kind.

  `RunState` gains `review_passed`. No existing member is renamed or
  removed.   `SCHEMA_VERSION` stays `2`. `parseStatusJson` stays a
  `JSON.parse` cast: a document written before this task with
  `awaiting_implementer` on an implementation-review pass is left as
  written, and an unknown state string does not throw (it is not
  remapped or rejected). Do not add a read-time remap from historical
  `awaiting_implementer` to `review_passed`. A `RunState` union
  widening may force edits in files this Scope does not list; those
  edits are in this task when `npm run typecheck` names them.

  `src/cli/detach.ts` `TERMINAL_RUN_STATES` gains `review_passed`. That
  state's wait exit code is `0` (it is not in the existing failure list).
  Plan-pass `awaiting_implementer` remains the chaining signal: D-007,
  D-035, and the `waitForRun` comments that name it stay true.
  `formatReviewTerminalLine` already prints `review ${status.state}` when
  `verdict` is non-null, so a passed implementation review surfaces
  `review review_passed` with no new token.

- **D3 — teach no 126 fallback; keep the missing-PATH `node` sentence.**
  After D1, `spartan-bridge wait` stays runnable for the producer window
  because `dist/cli/main.js` keeps `+x`. Step 4 does not document "if wait
  dies with 126, invoke `node …/dist/cli/main.js`". The existing sentence
  that prefers the `spartan-bridge` executable on `PATH` and falls back to
  `node dist/cli/main.js` when that executable is *missing* stays: that is
  a missing-binary path, not a missing-execute-bit path, and
  `tests/spbridge-skill.test.ts` already matches it. Steps 5–7 keep
  branching on `verdict` and `reason_code`; they do not gain a `state ===
  review_passed` rule.

- **D4 — one implementation round, D1 first.** Both defects are the same
  family and both fit one mapped implementer. Land them together. Apply D1
  before D2/D3 in that round so a chain started mid-round already keeps
  `wait` runnable. Do not split into two tasks.

## Acceptance Criteria

- [x] (D1) `lockTree` locks an unadmitted regular file to
      `0o444 | (recorded & 0o111)`. A fixture recorded `0755` is `0555`
      during the guard; a fixture recorded `0644` is `0444`; a fixture
      recorded `0744` is `0544`. `restoreProducerWriteScope` returns each
      to its recorded mode. `PRODUCER_WRITE_SCOPE_FILE_MODE` may remain
      exported as `0o444` for the no-execute case.
- [x] (D1) `tests/producer-write-scope.test.ts`: under the Darwin sandbox,
      `writeFile` and `chmod` of an unadmitted file locked to `0555`
      return `EPERM`. `SKIPPED_DIR_NAMES` does not contain `dist`. A
      producer snapshot of a tree that holds `dist/cli/main.js` still
      records that path.
- [x] (D1) `docs/AUTHENTICATION-AND-SECURITY.md` states the lock-mode
      formula and that POSIX write, Darwin `file-write*`, and the producer
      snapshot still deny mutation of every unadmitted path, including an
      executable `dist/cli/main.js`. `docs/DECISIONS.md` records D1.
- [x] (D2) `RunState` includes `review_passed`. `SCHEMA_VERSION` is `2`.
      `terminalForVerdict("pass", "implementation")` is
      `{ state: "review_passed", reason_code: "review_passed" }`.
      `terminalForVerdict("pass", "plan")` is
      `{ state: "awaiting_implementer", reason_code: "review_passed" }`.
      `VERDICT_TO_TERMINAL.pass` remains the plan-review mapping.
- [x] (D2) `src/core/review.ts` writes run state from `terminalForVerdict`.
      A passed implementation review's `status.json` has
      `state: "review_passed"` and `reason_code: "review_passed"`. A
      passed plan review still has `state: "awaiting_implementer"`.
      `tests/transition.test.ts` covers both.
- [x] (D2) `parseStatusJson` of a fixture whose `state` is
      `awaiting_implementer` and whose `review_kind` is `implementation`
      returns those fields unchanged. An unknown `state` string does not
      throw. `tests/serialize.test.ts` covers the historical document.
- [x] (D2) `TERMINAL_RUN_STATES` in `src/cli/detach.ts` contains
      `review_passed`. `waitForRun` on that state emits the run status
      with exit `0` and does not look for a successor transition.
      `awaiting_implementer` still follows the successor. `tests/detach.test.ts`
      covers both.
- [x] (D3) `agent-skill/skills/spbridge/SKILL.md` step 4 still contains
      the missing-PATH `node dist/cli/main.js` fallback and does not
      mention exit 126 or a permission-denied `wait` workaround.
      `tests/spbridge-skill.test.ts` still matches that fallback
      sentence. `formatReviewTerminalLine` is unchanged.
- [x] (D4) One implementation round applies D1, then D2 and D3, against
      this artifact. No second task is opened for D2.
- [x] `npm run typecheck` / `npm run build` clean, including any
      `RunState` exhaustiveness error in a file this Scope does not
      list; `npm test` adds no new failure.

## Work Completed

- 2026-09-03 (human-operator, Claude Code, claude-opus-5): queued from two
  observations during the `0064` auto-chain. Verified against `main` at
  `34b917c` that `dist` is absent from `SKIPPED_DIR_NAMES`, that
  `PRODUCER_WRITE_SCOPE_FILE_MODE` is `0o444`, that the global
  `spartan-bridge` resolves to this checkout's `dist/cli/main.js`, that the
  file was `0755` after the round, and that `VERDICT_TO_TERMINAL` is keyed on
  the verdict alone.
- 2026-09-03 (planner, Cursor, cursor-grok-4.6-high-fast, effort high): pinned D1–D4 against the named sources. Adopted
  HX-001; issued HX-002 for `reviewer`.
- 2026-09-03 (planner, Cursor, cursor-grok-4.6-high-fast, effort high): cycle-2 correction against the recorded plan-review
  findings. Named `/spbridge` as the invocation the next review actually
  uses; reworded the unknown-`RunState` constraint to "does not throw";
  marked `src/cli/main.ts` / `tests/cli.test.ts` verify-only; admitted
  typecheck-named `RunState` sites into this task. Adopted HX-002; issued
  HX-003 for `reviewer`.
- 2026-09-03 (implementer, Cursor, cursor-grok-4.6-high-fast, effort high): D1 then D2/D3 in one round. Lock mode is
  `0o444 | (recorded & 0o111)`. `RunState` gained `review_passed`;
  `terminalForVerdict` maps implementation `pass` there. SKILL.md step 4
  unchanged. Opened after the cycle-2 planner had issued HX-003. Issued
  HX-004 for `reviewer`.
- 2026-09-03 (implementer, Cursor, cursor-grok-4.6-high-fast, effort high): correction against the recorded
  implementation-review findings. Named `/spbridge` as the invocation the
  next review actually uses. Replaced the false `next_handoff_id` was
  `none` clause with the HX-003 that was outstanding when the first
  implementer opened. Issued HX-005 for `reviewer`.

- 2026-09-03 (human-operator, Claude Code, claude-opus-5): **owner override.**
  The implementation review's cycle 2 was dispatched three times and died in
  all three without producing a verdict — `run-d31889d4-1ef1-4c57-b3f3-657a8c659e31`,
  `run-e26d62d0-5bd7-4f29-9e5e-534ee754a92b`, and
  `run-06a8aa5a-149a-4e93-9537-a7c84a3bd1e3`, each
  `adapter_error` / `phase: collect` / `cause: exit_nonzero` / `exit_code: 1`
  with `stderr_bytes: 0`, and each carrying the child's terminal record
  `"subtype":"error_max_structured_output_retries","errors":["Failed to
  provide valid structured output after 5 attempts"]`. That is the reviewer
  CLI failing to emit JSON valid against `reviewOutputSchema`, not a product
  finding. Those excerpts were legible only because task `0064` had just
  landed the stdout-tail capture; before it, all three would have recorded 512
  bytes of the child's opening `system/init` record.

  No verdict was synthesized. The cycle-1 implementation-review region below
  stays exactly as `run-fedb2ee4-9b36-463b-b58a-e550a64547fd` wrote it —
  `CHANGES_REQUESTED` with `HANDOFF_INVOCATION` (warning) and
  `WORK_COMPLETED_HANDOFF_ID` (info) — and both were corrected in the HX-005
  round above. Neither was about code.

  A further implementation-review cycle was not spent: three dispatches failed
  in the identical mode, and waiting on the host's structured-output behaviour
  is not a product correction. Precedent: task `0055`, completed as
  human-operator after its reviewer adapter failed twice back to back, with
  the cycle-1 region left historical and no synthesized `APPROVED`.

  The override rests on two independent human-directed reviews of the working
  tree against Scope / Decisions / Acceptance Criteria, neither of which found
  a product defect. First, this session's own read. Second, an out-of-band
  Cursor/Grok review (read-only, `cursor-grok-4.6-high-fast`) that verified:
  `0o111` intersects neither `0o222` nor `0o7000`, so the lock yields at most
  `0555` and opens no write path; `applyMode` records `mode & 0o7777` and
  `restoreProducerWriteScope` returns setuid/setgid/sticky; a file already
  `0444` is left untouched with no restore entry;
  `producerWriteScopeSandboxProfile` and `pathRemainsWritable` are unchanged
  from HEAD, so `AGENTS.md` and `spartan-bridge/config.yaml` stay denied per
  `0067` D1; `SCHEMA_VERSION` stays 2 with historical `awaiting_implementer`
  documents readable and unremapped; `awaiting_implementer` remains the sole
  successor trigger in `src/cli/detach.ts` while `review_passed` joins only
  `TERMINAL_RUN_STATES`; and no typed `switch` over `RunState` was left
  uncovered.

  That second review recorded one discrepancy, in this plan's prose rather
  than in the code: D1's example list says "recorded `0711` locks to `0511`",
  while the pinned formula `0o444 | (recorded & 0o111)` yields `0555`. The
  implementation follows the formula, which is the decision; the acceptance
  criteria only assert `0755`, `0744` and `0644`, all of which hold. The
  example is left as written so the record shows what was pinned.

  Checks at override time: `npm run typecheck` exit 0, `npm run build` exit 0,
  `npm test` 512 pass / 0 fail. Base `HEAD` was `6a02019` with the
  implementation in the uncommitted working tree.

## Evidence

- `spartan-bridge wait …` → `(eval):1: permission denied: spartan-bridge`,
  exit 126, during `run-1ca9bfd2-a72e-49c3-857c-5f6b5f7d6491`'s producer phase.
- `ls -l dist/cli/main.js` at that moment: `-r--r--r--@ … 22203 Sep 3 17:02`.
  After the round: `-rwxr-xr-x@ … 22203 Sep 3 17:02`.
- `src/adapters/producer-write-scope.ts:14-15` —
  `PRODUCER_WRITE_SCOPE_DIR_MODE = 0o555`,
  `PRODUCER_WRITE_SCOPE_FILE_MODE = 0o444`.
- `src/adapters/producer-write-scope.ts:303` / `:335-338` — unadmitted
  files take `lockedUnadmittedFileMode` = `0o444 | (recorded & 0o111)`;
  `lockTree` does not skip `SKIPPED_DIR_NAMES`.
- `src/adapters/producer-write-scope.ts:131-145` —
  `restoreProducerWriteScope` `chmod`s each `guard.restores` entry to the
  recorded mode.
- `src/core/snapshot.ts:20-28` — `SKIPPED_DIR_NAMES` is `.git`,
  `node_modules`, `.spartan-bridge`, `.claude`, `.cursor`, `.venv`, `venv`.
- `command -v spartan-bridge` → `~/.nvm/versions/node/v24.14.0/bin/spartan-bridge`;
  its realpath is this checkout's `dist/cli/main.js`.
- `ls -l src/adapters/producer-write-scope.ts src/core/snapshot.ts
  src/core/contracts.ts src/core/serialize.ts src/core/review.ts
  src/cli/main.ts src/cli/detach.ts agent-skill/skills/spbridge/SKILL.md
  docs/DECISIONS.md docs/AUTHENTICATION-AND-SECURITY.md
  tests/producer-write-scope.test.ts tests/transition.test.ts
  tests/serialize.test.ts tests/cli.test.ts tests/detach.test.ts
  tests/spbridge-skill.test.ts agent-skill/scripts/manage-install.sh` →
  each path exists in this checkout.
- `src/core/contracts.ts:1` — `SCHEMA_VERSION = 2`.
- `src/core/contracts.ts:590` —
  `pass: { state: "awaiting_implementer", reason_code: "review_passed" }`,
  with no `review_kind` in scope.
- `src/core/contracts.ts:38-48` — nine `RunState` members including
  `review_passed`.
- `src/core/review.ts:651` — `const mapped = terminalForVerdict(result.verdict, reviewKind)`.
- `src/core/task-write.ts:304` — the same table, used only for `reason_code`.
- `src/core/serialize.ts:195-197` — `parseStatusJson` is `JSON.parse` as
  `StatusDocument`; no `RunState` remap.
- `src/cli/detach.ts:112` — `TERMINAL_RUN_STATES` is `changes_requested`,
  `human_required`, `blocked`, `failed`, `review_passed`.
- `src/cli/detach.ts:208-237` — `awaiting_implementer` loads the successor
  transition; any other non-terminal state is not in that set.
- `src/cli/main.ts:137-138` — `formatReviewTerminalLine` prints
  `review ${status.state}` when `verdict` is non-null.
- `agent-skill/skills/spbridge/SKILL.md:219` — "Prefer the `spartan-bridge`
  executable on `PATH`. If it is missing and this checkout has
  `dist/cli/main.js`, invoke that file with `node` instead".
- Passed implementation reviews reporting `awaiting_implementer`:
  `run-f4586e7d` (`0063`), `run-8dae3882` (`0067`), `run-6f764c3d` (`0064`).
- `node node_modules/typescript/bin/tsc --noEmit` → exit 0 (`npm run typecheck`
  is `tsc --noEmit`; `node_modules/.bin/tsc` is permission-denied in this
  producer window, same class as defect 1).
- `node --import tsx --test --test-name-pattern 'lockTree locks|SKIPPED_DIR_NAMES does not contain dist' tests/producer-write-scope.test.ts`
  → 2 pass: recorded `0755`/`0644`/`0744` lock to `0555`/`0444`/`0544` and
  restore; `writeFile` on those locked files rejects; `SKIPPED_DIR_NAMES`
  has no `dist`; producer snapshot records `dist/cli/main.js`.
- Darwin `sandbox-exec` nested under this producer guard:
  `sandbox_apply: Operation not permitted` (exit 71) on the new 0555 EPERM
  case and on the pre-existing Darwin sandbox tests. The 0555 EPERM test is
  present in `tests/producer-write-scope.test.ts`.
- `node node_modules/typescript/bin/tsc` (emit) → TS5033 EPERM on every
  `dist/**` write. `dist/` stays unadmitted.
- `tests/transition.test.ts` `absent or manual config…` →
  `state: awaiting_implementer`. `authorized automatic path…` →
  `state: review_passed` / `reason_code: review_passed`.
  `terminalForVerdict("pass", "implementation")` and
  `VERDICT_TO_TERMINAL.pass` asserted there. `SCHEMA_VERSION` is `2`.
- `tests/serialize.test.ts` historical `awaiting_implementer` +
  `review_kind: implementation` unchanged; unknown `state` does not throw.
- `tests/detach.test.ts` `waitForRun: review_passed…` → exit 0, run status,
  no transition document while a successor exists.
- `tests/spbridge-skill.test.ts` still matches the PATH / `node dist/cli/main.js`
  fallback and does not match exit 126.
- Pre-existing mode-only dirty path outside this write scope:
  `agent-skill/scripts/manage-install.sh` `100755` → `100644`. Not edited.
- Correction-round checks: `node node_modules/typescript/bin/tsc --noEmit`
  → exit 0. Named D1–D3 tests 8/8 pass
  (`lockTree locks…`, `SKIPPED_DIR_NAMES does not contain dist…`,
  `absent or manual config…`, `authorized automatic path…`,
  historical `parseStatusJson`, unknown `state`, `waitForRun: review_passed…`,
  `spbridge skill obtains parent-host permission…` still matches PATH /
  `node dist/cli/main.js` and does not match exit 126).
- `node --import tsx --test tests/*.test.ts` → 499 pass, 13 fail: Darwin
  `sandbox-exec` nested under this producer guard (exit 71) on the
  pre-existing sandbox cases plus the new 0555 EPERM case; installer
  `EACCES` on the mode-only `manage-install.sh`; two real-Cursor POSIX
  guard tests stop at plan-pass because nested `sandbox-exec` cannot
  apply; doctor wrapper warning inherits this session's HOME. Same class
  as the first implementer window, not a new product failure.
- `node node_modules/typescript/bin/tsc` (emit) → TS5033 EPERM on every
  `dist/**` write. `dist/` stays unadmitted.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-734b484a-0a03-4ac7-89bc-dc205c77ec2d execution_id=exec-9e9e5725-8c31-4781-9be2-04f5f7ee9d8d review_kind=plan verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-opus-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:5a74e728a1985947915bf18ad1f0bb996d8f60b76b5ef05870e614ae8c0b8a56 task_hash=sha256:2383381dd47ef4d086249f9aa09ea1291ac3c481ecb87a2fb0ffe1918faa6580 agents_hash=sha256:8c5ea585bde94cfad8dd44a4887699564541608b157d2046244f834226ece7fa timestamp=2026-09-03T21:31:09.864Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: CHANGES_REQUESTED

Findings:

- `HANDOFF_INVOCATION` (warning): `spartan/tasks/0069-the-bridge-disables-and-misnames-itself.md` — the HX-004 `## Next Handoff

No outstanding handoff. The task is complete.
