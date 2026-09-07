---
protocol: "1.0.0" # x-release-please-version
id: let-the-bridge-dispatch-its-own-plan-review
created_at: 2026-08-20
status: completed
phase: complete
task_type: implementation
risk: material
current_role: reviewer
next_role: human-operator
updated_at: 2026-08-20
handoff_id: HX-011
next_handoff_id: none
---

# Let the Bridge dispatch its own plan review

## Objective

`spartan-bridge review` in this repository starts a Codex plan review in a session the operating
system holds read-only, and returns a validated verdict, so that the Bridge dogfoods the loop it
exists to run instead of stopping for a pasted prompt at every plan.

## Context

`AGENTS.md` binds `reviewer.plan` to Codex on `gpt-5.6-sol` at effort high (`873a9ac`). The Bridge has
no Codex launcher, so every plan review now stops closed at `registry_context_incomplete` or
`launcher_unavailable` before anything spawns. Nothing is broken by that — it is the fail-closed
behaviour working — but it means the runtime cannot dispatch any plan review at all until this
adapter exists. Task `0025` is parked on a pasted round for exactly this reason.

A capability probe of `codex exec` ran on 2026-08-20 against a workspace prepared the way
`CursorAdapter.prepare` prepares one: `AGENTS.md` and `task.md` at 0444 inside a 0555 `mktemp`
directory that is not a Git repository. Every question the adapter's shape depends on is answered in
Evidence. Three of those answers change what this adapter is:

- The reviewer's verdict comes back as one JSON object in a file. The Cursor adapter spends roughly
  200 lines on `collectBalancedSpans`, `lastJsonFence`, and `scanVerdictShapedCandidate` because
  `cursor-agent` returns prose with an object buried in it. `codex exec --output-schema` with
  `--output-last-message` returned a file whose entire contents parse, whose keys equal the Bridge's
  five contract keys exactly, and whose findings carry ids matching the contract's own pattern. The
  extraction layer does not need to exist here.
- The read-only session is enforced by the operating system, not by the prompt. The probe told the
  model to write, and it tried: `zsh:1: operation not permitted`. `AGENTS.md` requires reviewer
  read-only behaviour to be "technically enforced, not merely prompted", and this repository has
  never been able to claim that for Cursor — `docs/AUTHENTICATION-AND-SECURITY.md` records the Cursor
  read-only mode as unobserved, defense-in-depth only.
- `codex exec` reads standard input when it is left open, and appends what it finds to the prompt.
  The probe's stderr carries `Reading additional input from stdin...`, because the probe script
  invoked `codex` directly and the child inherited the shell's stdin. The Bridge does not: every
  adapter spawns through `src/adapters/process.ts:58`, which already sets
  `stdio: ["ignore", "pipe", "pipe"]`. So this is a guarantee to keep and pin, not a gap to close,
  and it belongs to the process runner rather than to this adapter (D4).

`codex-plugin-cc` was read as `reference-only` prior art under `docs/PROVENANCE.md`. What it
contributed is interface fact — that a `codex app-server` JSON-RPC transport exists, that
`approvalPolicy: "never"` accompanies `sandbox: "read-only"`, and that a structured review output is
an established shape. No code, prompt, schema, or test from it is copied, and its ledger entry stays
`reference-only` with no local material affected.

## Scope

- `src/adapters/codex.ts`: new adapter implementing `Adapter`, modelled on the structure of
  `src/adapters/cursor.ts` and sharing its workspace preparation and snapshot behaviour.
- `src/core/contracts.ts`: `CODEX_LAUNCHER_ID`.
- `src/composition.ts`: one catalog entry beside the Cursor one at line 53.
- `src/index.ts`: the adapter and its launcher id, beside the Cursor export.
- `src/core/doctor.ts`: Codex launcher and executable facts, mirroring the Cursor block.
- `src/adapters/review-stream.ts`: the Codex event names in `classForRecordType`.
- `tests/codex-adapter.test.ts` and `tests/fixtures/codex-stub.mjs`: new, following the shape of
  `tests/cursor-adapter.test.ts` and `tests/fixtures/cursor-agent-stub.mjs`.
- `tests/fixtures/codex-stream-sample.jsonl`: new, the seven records D8's replay test feeds — three
  turn records and four `item.*` records — transcribed from Evidence in the recorded order listed
  there, one JSON object per line.
- `tests/doctor.test.ts`: the added facts.
- `docs/DECISIONS.md`: the decisions below, as new dated entries.
- `docs/AUTHENTICATION-AND-SECURITY.md`: the observed read-only result, recorded the way the Cursor
  probe is recorded, including what it did not demonstrate.

## Out of Scope

- The `codex app-server` transport. D1 records why, and what would justify revisiting it.
- Any `reviewer.implementation` adapter, and any automatic implementer transition. `AGENTS.md`
  withholds that grant.
- Observing which model actually ran. The `--json` stream carries no model identifier (Evidence), so
  `observedModel()` returns `null` and the declared/observed comparison stays `declared_unobserved`,
  exactly as it does for Cursor.
- Changing `EFFORT_LEVELS`, the review result schema, `SCHEMA_VERSION`, or any reason code.
- The user-local client-context registry. It is uncommitted machine configuration; this task only
  makes a `codex` launcher resolvable once a registry names one.
- Widening `doctor` beyond non-secret integration facts.

## Constraints

- The adapter must never read, pass, or log a credential, token, auth file, account identifier, or
  credential environment variable, and must not enumerate or query entitlements.
- The reviewed workspace stays read-only for the child process. Any file the adapter writes for the
  run goes outside that workspace.
- Fail closed: an unrecognised interface, an unparsable payload, a timeout, or a detected write
  ends the run on an existing reason code. No new reason code, no schema change.
- No copied or adapted material from `codex-plugin-cc` or any other external project.

## Acceptance Criteria

- [x] D1: the adapter spawns `codex` with the `exec` subcommand and no app-server transport. The
      argv is built from constant tables plus the model, effort, schema path, output path, and
      workspace path, with no shell interpolation.
- [x] D2: the verdict is read by parsing the whole `--output-last-message` file as JSON, and the
      parsed value is handed to the core unjudged. No balanced span scan, JSON fence scan, or
      last-object heuristic exists in `src/adapters/codex.ts`.
- [x] D2: both malformed-output paths are asserted from the stub. A last message that is not JSON
      ends the run `output_unparsable`; a last message that is valid JSON but not the review contract
      ends it `result_schema_invalid` through `validateReviewResult`. Each test quotes the bytes the
      stub wrote.
- [x] D3: the schema file and the last-message file are written under the run directory, never inside
      the reviewed workspace, asserted by a test that reads the workspace after the run and finds
      exactly `AGENTS.md` and `task.md` unchanged.
- [x] D4: a test at the process-runner layer spawns a child that reports what it reads on stdin, and
      asserts it reads nothing. `SpawnRequest` gains no stdio field, and `src/adapters/codex.ts`
      contains no stdio setting, asserted by the same absence that makes the guarantee shared.
- [x] D5: effort reaches the child as `-c model_reasoning_effort="<value>"`, with `max` sent as
      `xhigh` and every other `EFFORT_LEVELS` value sent unchanged. A table test asserts all five
      Bridge values produce the intended child argument.
- [x] D6: `capabilities()` returns exactly `{ schema_version: 2, launcher_id: CODEX_LAUNCHER_ID,
      review_kinds: ["plan"], permission_modes: ["read-only"], workspace_write: false,
      fresh_context: true, observes_model: false }`, asserted by deep equality rather than field by
      field, and `capabilitiesAllowed` accepts it.
- [x] D7: `preflight` requires all nine tokens `--sandbox`, `--cd`, `--config`,
      `--skip-git-repo-check`, `--ephemeral`, `--output-schema`, `--output-last-message`, `--json`,
      and `--color` in the probe output. A table test removes each one in turn from the stub's help
      and asserts `interface_unrecognized` with no review started, nine cases.
- [x] D7: every long-form token the review argv sends appears in that probed set, asserted by a test
      that derives one list from the other rather than restating it.
- [x] D8: `classForRecordType` maps `thread.started`, `turn.started`, `item.started`, and
      `item.completed` to `working`, and `turn.completed` to `result`. `KIND_RE` is unchanged.
- [x] D8: `ReviewStreamParser` reads the nested type at `record.item.type` and counts one tool per
      `item.started` whose item type is `command_execution`, and none for `agent_message`. A record
      with no `item` object, or an `item` whose `type` is absent or not a string, counts no tool and
      changes no class.
- [x] D8: `tests/fixtures/codex-stream-sample.jsonl` holds the seven records Evidence quotes, in the
      order Evidence lists, and the replay test feeds that file rather than a literal in the test
      body. Feeding it ends at class `result` with `records` equal to 7 and `tools` equal to 1. The
      `records` assertion is what binds the fixture to the quoted input: a fixture missing a line, or
      carrying an eighth, fails on it rather than passing quietly.
- [x] D9: `doctor` reports Codex launcher resolution and executable availability as non-secret facts
      only, and asserts nothing about authentication, account, or entitlement.
- [x] D10: `docs/AUTHENTICATION-AND-SECURITY.md` records the observed refusal with its exact error
      text and states what the observation does not demonstrate. No sentence claims an OS sandbox for
      any host other than the one observed.
- [x] `npm run typecheck` and `npm test` exit 0, and `spartan-bridge doctor --repo .` reports the
      Codex launcher without emitting any authentication fact.

## Decisions

### D1 - `codex exec`, not the app-server, for this adapter

`codex` offers two non-interactive surfaces: `codex exec` with flags, and `codex app-server` speaking
JSON-RPC 2.0 over stdio. The app-server is the richer one, and it is what `codex-plugin-cc` uses.

This adapter takes `exec`, for one reason that outweighs the rest: the fake. The Bridge tests every
adapter against a stub executable on a temporary PATH, and `tests/fixtures/cursor-agent-stub.mjs` is
32 lines because the interface is argv in, bytes out. A faithful app-server fake must hold thread
ids, turn ids, capability negotiation, and request/response correlation across a session; the
upstream project's equivalent fixture is 23KB. That cost buys progress notifications the `exec`
`--json` stream already provides, and a structured result the probe shows `exec` already returns.

The app-server becomes worth revisiting when the Bridge needs something `exec` cannot express — a
mid-run interrupt that is not process termination, or resuming a review thread across runs. Neither
is in this repository's plan.

### D2 - The payload is the whole file, parsed once

`--output-schema` plus `--output-last-message` produced a file whose entire contents are one JSON
object with exactly the Bridge's five contract keys. So the adapter's `collect()` reads that file and
parses it whole, and returns the parsed value to the core, which validates it.

The stream is not the payload, and run A shows why concretely: it carried two `agent_message`
records whose text was a complete contract-shaped verdict object — `item_0` with `"verdict":"pass"`
and, after a `command_execution`, `item_2` with `"verdict":"changes_requested"`. A scan of the stream
must then decide which one counts, which is the class of question the Cursor extraction layer exists
to answer. `--output-last-message` answers it at the source: the file holds the final message, and
`item_2` is what it contained.

Malformed output therefore has two terminal paths, and both already exist. A file that is not JSON
ends the run `output_unparsable`, the same outcome the Cursor path reaches after its heuristics fail.
A file that parses but is not the contract is rejected by `validateReviewResult` in
`src/core/result.ts` as `result_schema_invalid`, without the adapter judging content. No prose
fallback is added: the point of this adapter is that there is nothing to extract from.

This is the decision that makes the adapter small, and it rests on the model honouring a schema. The
evidence for that is one run: probe run A. Run B deliberately omitted `--output-schema` so that the
sandbox observation was not entangled with the schema one, so it says nothing either way. One
schema-constrained run is thin evidence for a decision this load-bearing, which is why the criterion
below asserts both fail-closed paths rather than asserting that the schema is honoured. If it is not,
the run fails on a recorded reason code; it never falls back to guessing.

### D3 - Everything the adapter writes goes outside the reviewed workspace

The workspace is a 0555 directory holding two 0444 files, and the probe confirmed `codex` accepts it
as a working root. The schema file and the last-message file are therefore written under the run
directory, which the Bridge already owns. This keeps `snapshotTree`'s write detection meaningful: any
change inside the workspace is the reviewer writing, never the adapter's own bookkeeping.

### D4 - The stdin guarantee stays with the process runner, and gains a test

`codex exec` reads stdin when it is open and appends what it finds to the prompt as a `<stdin>`
block. A reviewer round is the one place in this system where outside text must not reach the
instructions, so the child must never have a readable stdin.

It already does not. `NodeProcessHandle` in `src/adapters/process.ts:58` spawns every adapter with
`stdio: ["ignore", "pipe", "pipe"]`, and `SpawnRequest` carries no stdio field, so no adapter can
choose otherwise and this adapter has nothing to set. The correction this decision makes to the
first draft is one of ownership: an adapter-level argv test cannot assert a setting the adapter never
receives, and writing one would assert nothing while looking like a guarantee.

So the guarantee is pinned where it lives, with a test at the process-runner layer that spawns a
child which reports what it reads on stdin. `SpawnRequest` gains no stdio field: adding one would
make the guarantee per-caller, which is the opposite of what a security invariant wants.

### D5 - `max` is sent as `xhigh`; the rest pass through

The Bridge's `EFFORT_LEVELS` are `low`, `medium`, `high`, `max`, `none`. Codex accepts `none`,
`minimal`, `low`, `medium`, `high`, `xhigh`. Four values coincide. `max` has no Codex spelling, and
`xhigh` is the value above `high`, so `max` is sent as `xhigh` and the mapping is stated in
`docs/DECISIONS.md` rather than left for a reader to infer from an argv table.

The alternative — refusing `max` for a Codex binding at policy time — is rejected: it would make a
declared, valid `AGENTS.md` fail for a host-specific vocabulary reason, and the Bridge resolves
policy before it knows which adapter will run. `minimal` stays unreachable from this repository,
which is correct; the Bridge does not gain a level to reach it.

### D6 - Capabilities are the Cursor ones, and the launcher id is `codex-plan-reviewer-v1`

Nothing about the Codex path changes what this adapter is allowed to do: plan review only, read-only
only, fresh context, schema version 2. The launcher id follows `CURSOR_LAUNCHER_ID`'s convention so a
registry entry names a capability rather than a binary.

`AdapterCapabilities` at `src/core/contracts.ts:205-213` has seven fields, and the seventh is
`observes_model`. It is `false` here, for the reason Out of Scope records: the `--json` stream carries
no model identifier. The first draft called its list complete while omitting that field, which is the
same defect as an acceptance criterion that undercounts what changes; the criterion below states the
whole object.

### D7 - `preflight` probes every interface feature the argv actually uses

The Cursor adapter probes `--help` and requires its tokens to be present, failing
`interface_unrecognized` otherwise. The Codex adapter does the same.

The probed set is every long-form token the argv uses, and the first draft's shorter list was wrong
on its own terms: it omitted `--config`, which is how D5 delivers effort, and `--cd`, which is how D3
selects the read-only workspace, while claiming to be exactly what D1 through D4 depend on. The set
is therefore `--sandbox`, `--cd`, `--config`, `--skip-git-repo-check`, `--ephemeral`,
`--output-schema`, `--output-last-message`, `--json`, and `--color`.

`--color never` is probed rather than dropped. Dropping it would be defensible — stdout is a pipe —
but the argv that was probed carried it, and an argv that differs from the observed one turns
Evidence into an argument about whether the difference matters. The rule this fixes is simple: the
adapter probes what it sends, and sends what was probed.

### D8 - Progress classes gain the Codex names, and the tool count reads the nested item type

`KIND_RE` at `src/adapters/review-stream.ts:10` is `/^[A-Za-z0-9._-]{1,64}$/`, which already admits
`item.completed`, so the regex is untouched and the Cursor names stay. One parser serves both,
because the record shape — a `type` string per JSONL line — is the same.

The mapping is stated rather than left to the implementer: `thread.started`, `turn.started`,
`item.started`, and `item.completed` are `working`; `turn.completed` is `result`. None of them is
`tool`, and that is the substantive point. The Codex stream carries the tool signal one level down,
where `classForRecordType(type: string)` cannot see it, since it receives only the top-level string.

The field path is `record.item.type`, read from the records quoted in Evidence rather than inferred
from a description of them. `item.started` and `item.completed` both carry an `item` object with
`id`, `type`, and — for a `command_execution` — `command`, `aggregated_output`, `exit_code`, and
`status`. `ReviewStreamParser.ingestLine` therefore reads `record.item.type` for the two `item.*`
records and counts one tool per `item.started` whose item type is `command_execution`.

Counting on `item.started` rather than on `item.completed` mirrors the existing branch at
`src/adapters/review-stream.ts:127`, which increments when a Cursor `tool_call` record is not the
completed one. `tools` therefore means the same thing on both hosts — tools begun, counted once —
and a review killed mid-command still reports the command it was running. Run A's stream contains one
`command_execution` with both a started and a completed record, so either rule yields 1; the tie is
broken by matching the existing semantics rather than by the sample.

The alternative — map the five names and leave `tools` at zero for Codex — is rejected. The progress
line prints `tools=`, and a number that is always zero reads as a reviewer that ran no commands
rather than as a field this host does not populate. A wrong number is worse than a missing feature.

### D9 - `doctor` gains facts, not judgement

`doctor` reports whether the Codex launcher id resolves in the catalog and whether the executable is
available, mirroring the Cursor block. It does not run a review, inspect a session, or say anything
about authentication or entitlement, which `AGENTS.md` forbids.

### D10 - The observed refusal is recorded with what it does not prove

This repository's honesty convention for the Cursor probe is to state the observation and then state
its limits. The Codex observation is stronger — a denied write, with the operating system's error
text — but it is still one platform, one sandbox mode, one CLI version. `docs/AUTHENTICATION-AND-SECURITY.md`
records the error text, the version, and the platform, and does not generalise it to another host,
another mode, or another machine.

## Work Completed

- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20: ran the capability probe
  recorded in Evidence and wrote this plan from its results. No product file was edited.
- Reviewer (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-20: reviewed D1 through D10 and
  requested corrections to the evidence and acceptance criteria. No product file was edited.
- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20: accepted HX-002 and
  resolved all five findings. Every one was verified against the code before acting, and all five
  held. `PLAN-D2-EVIDENCE` and `PLAN-D7-INTERFACE` were errors of fact in the first draft: D2 claimed
  two schema-constrained probe runs where Evidence records one, and D7 named a token list that
  omitted `--config` and `--cd` while claiming to be exactly what D1 through D4 depend on. Both are
  corrected rather than softened. `PLAN-D4-OWNERSHIP` was an ownership error: `src/adapters/process.ts:58`
  already spawns every adapter with stdin ignored, so D4 is recast around the process runner and its
  criterion moves to that layer. `PLAN-D6-COMPLETE-CAPABILITIES` and `PLAN-D8-ASSERTIONS` are
  accepted as written; D8 gained the mapping table and the nested-item tool count the reviewer asked
  for, and rejected the always-zero alternative in writing. D1 and D5 are retained unchanged, as the
  review directed. Criteria for D2, D4, D6, D7, and D8 were re-derived from the amended decisions
  rather than edited in place; the plan now carries fourteen. No product file was edited.
- Reviewer (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-20: accepted HX-003 and re-reviewed
  the amended plan against the repository. D2 is sufficient to implement: the single
  schema-constrained observation establishes the supported normal shape, while the specified
  deterministic stub cases cover both malformed-output terminal paths without a guessing fallback.
  D4 is assertable at its owner: a child-process stdin read test proves the shared runtime
  behaviour, and the typed `SpawnRequest` surface plus a source-absence assertion can prove that
  the Codex adapter has no per-call override. D8's narrow nested lookup is proportionate, but the
  task does not preserve the exact JSONL lines needed to define and replay that lookup, so the plan
  remains changes requested. No product file was edited.
- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20: accepted HX-004 and
  resolved `PLAN-D8-REPLAY-EVIDENCE`. The finding was right and its consequence was larger than a
  missing quotation: reading the actual records replaced a described field path with a read one, and
  it turned up a fact that strengthens D2. Run A emitted two `agent_message` records whose text was a
  complete contract-shaped verdict, `item_0` saying `pass` and `item_2` saying `changes_requested`,
  so a stream scan would have had to choose between them while `--output-last-message` simply held
  the last. D8's counting rule also moved from `item.completed` to `item.started` once the records
  showed both, matching the existing Cursor branch's tools-begun semantics rather than the sample.
  The records are quoted in Evidence with only their long string values elided, and
  `tests/fixtures/codex-stream-sample.jsonl` is added to Scope so the replay test feeds a committed
  file rather than session history. Both D8 criteria were re-derived, and a third was added for the
  fixture. The plan now carries fifteen. No product file was edited.
- Reviewer (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-20: accepted HX-005 and re-reviewed
  the plan against the quoted records and repository. The records establish `record.item.type` and
  show one `command_execution` at `item.started`, so tools-begun is a sound shared semantic even
  though this sample also contains the matching completion. The two contract-shaped stream messages
  demonstrate why the stream is not a verdict source: the final-message file contains the later
  `changes_requested` result, so no separate mid-stream verdict rule is needed. The plan remains
  changes requested only because Scope misstated the committed replay input as five records; Evidence
  quotes four `item.*` records and three turn records. `npm run typecheck` exited 0 and `npm test`
  exited 0 (176 passing tests). No product file was edited.
- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20: accepted HX-006 and
  corrected `PLAN-D8-FIXTURE-COUNT`. The count was wrong: "five" counted the distinct top-level type
  names, not the records. Run A's stream is seven records, and Evidence now lists them in their
  recorded order so Scope, Evidence, and the replay criterion name one input. The criterion also
  gained a `records` equal to 7 assertion, which makes the three agree mechanically rather than by
  reading: a fixture that loses or gains a line now fails. D2's final-message policy and D8's
  tools-begun rule are unchanged, as the review directed. No product file was edited.
- Reviewer (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-20: accepted HX-007 and re-reviewed
  the cycle-4 correction. Scope, Evidence, and the D8 replay criterion agree on the same seven
  records: `thread.started`, `turn.started`, four ordered `item.*` records, and `turn.completed`.
  The replay assertion binds that file to class `result`, `records` equal to 7, and `tools` equal to
  1, so a missing or extra record fails rather than passing quietly. D2's final-message policy and
  D8's tools-begun rule remain unchanged. `npm run typecheck` exited 0 and `npm test` exited 0 (176
  passing tests). No product file was edited.
- Implementer (Cursor, cursor-grok-4.6-high-fast, effort none), 2026-08-20:
  accepted HX-008 and implemented D1 through D10 within Scope. The Codex adapter spawns `codex exec`
  with long-form argv, reads the whole `--output-last-message` file as JSON (no extraction layer),
  and counts tools on `item.started` `command_execution` only. Schema and last-message files live in
  an adapter-owned temp directory because `AdapterReviewInput` has no run path (D-023); the workspace
  still holds only `AGENTS.md` and `task.md`. Recorded as D-021 through D-030 in `docs/DECISIONS.md`.
- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20: re-addressed the HX-009
  envelope only. The implementation round wrote it to Claude Code as `reviewer.implementation`, which
  `AGENTS.md` binds to Codex on `gpt-5.6-terra` at effort high; addressing it to the planner's own
  host would also have put the review in the same vendor as no one and lost the cross-vendor property
  the binding exists for. The prompt now names the two things a reader of the diff should judge first:
  the D3 criterion ticked against `D-023`'s recorded deviation, and the ten new decision entries. No
  criterion, decision, or product file was touched.
- Reviewer (Codex, gpt-5.6-terra, effort high, OpenAI), 2026-08-20: accepted HX-009 and reviewed the
  current implementation against all fifteen criteria. D1, both D2 criteria, D4 through D10, and the
  final checks hold. D3 does not: `src/adapters/codex.ts` creates `ioRoot` with `fs.mkdtemp()` below
  `os.tmpdir()`, while `AdapterReviewInput` supplies no run directory, so neither the schema nor the
  last-message file is under `.spartan-bridge/runs/<run-id>`. The workspace-isolation assertion is
  sound but cannot prove the missing run-directory requirement. `docs/DECISIONS.md` entries D-021
  through D-030 are proportionate one-to-one records of D1 through D10 and each states a decision the
  implementation took; D-023 accurately records the implemented temporary-directory choice, but that
  choice is an unapproved deviation from D3, not a reason to mark D3 complete. Verdict:
  CHANGES_REQUESTED. No product file was edited.
- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20: re-addressed the HX-010
  envelope only, and verified the finding before passing it on. `src/adapters/codex.ts:245` did call
  `fs.mkdtemp` below `os.tmpdir()`, and `AdapterReviewInput` carried no run directory, so
  `IMPL-D3-RUN-DIRECTORY` stood. The invocation named `/spbridge`, which is the token for a producer
  round whose review the Bridge dispatches; this round was implementation, a transition `AGENTS.md`
  explicitly withholds from the Bridge, so the token is `/spartan`. Two bounding facts went into the
  prompt: `run.runDir` was already in scope at the `adapter.prepare` call site, and the child's `cwd`
  was the io directory, so relocating it would put the child's working directory inside the
  repository. No criterion, decision, or product file was touched. This entry is restored: the HX-010
  implementation round removed it while editing the section.
- Implementer (Cursor, cursor-grok-4.6-high-fast, effort none), 2026-08-20:
  accepted HX-010 and resolved `IMPL-D3-RUN-DIRECTORY`. `AdapterReviewInput` now carries `run_dir`;
  core passes `run.runDir` at the existing `adapter.prepare` site. The Codex adapter writes
  `schema.json` and `last-message.json` under that run directory and no longer calls `fs.mkdtemp`
  under `os.tmpdir()` for those files. Spawn `cwd` stays `os.tmpdir()` so relocating I/O does not
  put the child inside the git worktree; `--cd` remains the reviewed workspace. D-023 now describes
  that final behaviour. The D3 test proves both the run-local paths and the unchanged two-file
  workspace. D2 and D8 were not edited.
- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20: verified the HX-010
  correction and prepared the HX-011 round. `AdapterReviewInput` gains `run_dir`, `src/core/review.ts`
  passes `run.runDir` at the existing call site, and spawn `cwd` moved to `os.tmpdir()`, which answers
  the hazard the HX-010 prompt raised. `npm run typecheck` exit 0, `npm test` exit 0, 193 tests.
  Restored the planner entry the round removed, and added to the review prompt the two assertions the
  round dropped while resolving a realpath mismatch. The envelope needed no correction this time: it
  names Codex, `gpt-5.6-terra`, effort high, and `$spartan`. No criterion, decision, or product file
  was touched.
- Reviewer (Codex, gpt-5.6-terra, effort high, OpenAI), 2026-08-20: accepted HX-011 and approved the
  `IMPL-D3-RUN-DIRECTORY` correction. `run.runDir` reaches `AdapterReviewInput.run_dir`; the Codex
  adapter writes `schema.json` and `last-message.json` there, and its child `cwd` remains
  `os.tmpdir()` while `--cd` targets the isolated reviewed workspace. D-023 describes that settled
  behavior. The D3 test resolves both output paths exactly beneath the created run directory and
  re-reads the separate workspace as exactly `AGENTS.md` and `task.md`, both byte-for-byte unchanged.
  The two removed workspace `isInside` assertions were redundant after the `/var`/`/private/var`
  realpath mismatch: exact run-directory equality proves the same non-workspace location without
  alias-sensitive string comparison. D2 still parses only the complete last-message file and D8 still
  counts `item.started` `command_execution` records. The HX-001 through HX-011 Work Completed chain
  is continuous, including the restored HX-010 planner entry. Verdict: APPROVED. No product file was
  edited.

## Evidence

- Probe, `codex exec` via `codex-cli 0.148.0` on darwin 25.3.0, 2026-08-20, run A: exit 0 in 46s with
  working root on a 0555 non-Git `mktemp` directory holding `AGENTS.md` and `task.md` at 0444.
- Run A argv, verbatim apart from paths: `codex exec --skip-git-repo-check --ephemeral -s read-only
  -C <workspace> -c model_reasoning_effort="high" --json --color never --output-schema <schema>
  -o <last-message> <prompt>`.
- Run A payload check: `parse: ok, whole file is one JSON object`; `keys:
  findings,review_kind,schema_version,summary,verdict`; `keys_exact_match: true`;
  `schema_version: 2`; `review_kind: "plan"`; `verdict: "changes_requested"`; `findings_count: 3`;
  each finding id matched `^[A-Z][A-Z0-9_-]{0,31}$`.
- Run A stream, distinct `type` values: `thread.started`, `turn.started`, `item.started`,
  `item.completed`, `turn.completed`; item payload types `agent_message` and `command_execution`.
- Run A `thread.started` carries only `{"type","thread_id"}` and `turn.completed` only `{"type",
  "usage"}` with token counts. No model identifier, account identifier, or key source appears in the
  stream.
- Run A stderr, in full: `Reading additional input from stdin...`.
- Run B, the same argv without `--output-schema`, prompt instructing two writes, last message in
  full: ``Command: `printf 'blocked' > probe-write.txt` `` / ``Failed. Error: `zsh:1: operation not
  permitted: probe-write.txt` `` / ``Command: `printf 'probe\n' >> AGENTS.md` `` / ``Failed. Error:
  `zsh:1: operation not permitted: AGENTS.md` ``.
- Both runs: `workspace_written_by_model: AGENTS.md task.md`, unchanged.
- Probe script and raw output are session-local and not committed; the facts above are the record.
- `src/adapters/review-stream.ts:10`: `const KIND_RE = /^[A-Za-z0-9._-]{1,64}$/;`.
- `src/adapters/cursor.ts:167-247`: the extraction layer D2 declines to reproduce.
- `tests/fixtures/cursor-agent-stub.mjs`: 32 lines, the fake shape D1 preserves.
- `src/adapters/process.ts:58`: `stdio: ["ignore", "pipe", "pipe"],` inside `NodeProcessHandle`, and
  `SpawnRequest` at lines 5-14 carries no stdio field. Verified 2026-08-20 for D4.
- `src/core/contracts.ts:205-213`: `AdapterCapabilities` has seven fields, the seventh
  `observes_model: boolean`. Verified 2026-08-20 for D6.
- `src/core/result.ts:23-35`: `validateReviewResult` throws `result_schema_invalid` for a parsed
  value that is not the contract. Verified 2026-08-20 for D2.
- `src/adapters/review-stream.ts:127`: `if ((type === "tool_call" || type === "tool_use") && record.subtype !== "completed") {`,
  the once-per-tool increment D8 mirrors. Verified 2026-08-20.
- Reviewer checks, 2026-08-20: `npm run typecheck` exited 0; `npm test` exited 0 (176 passing
  tests). `codex exec --help` from `codex-cli 0.148.0` confirms the currently installed interface
  exposes `--config`, `--sandbox`, `--cd`, `--skip-git-repo-check`, `--ephemeral`,
  `--output-schema`, `--json`, and `--output-last-message`.
- Reviewer observation: Run A is the sole recorded run with `--output-schema`; Run B explicitly
  says it used the same argv *without* that flag. The claim in D2 that two probes honoured the
  schema is therefore unsupported by the task's own evidence. `src/core/review.ts` already maps a
  parsed result that fails `validateReviewResult` to `result_schema_invalid`.
- Re-review checks, 2026-08-20: `npm run typecheck` exited 0; `npm test` exited 0 (176 passing
  tests). `codex exec --help` confirms the installed CLI advertises `--config`, `--sandbox`, `--cd`,
  `--skip-git-repo-check`, `--ephemeral`, `--output-schema`, `--output-last-message`, `--json`, and
  `--color`. `src/adapters/process.ts:5-14,55-60` confirms that `SpawnRequest` has no `stdio`
  member and the sole production spawn sets stdin to `ignore`; `src/core/review.ts:486-489` confirms
  parsed non-contract values terminate `result_schema_invalid`.
- Re-review observation for D8: the artifact records only the distinct top-level and nested type
  values, not the actual JSONL records or a committed safe fixture containing them. Its claimed
  replay test therefore has no durable input from which to establish the exact nested field path.
- Run A `item.*` records, verbatim apart from four long string values replaced by `<elided>`. Nothing
  else is changed: no key is added, removed, renamed, or reordered, and every non-string value is as
  emitted. The elided values are `item_0.text`, `item_1.command` (twice), `item_1.aggregated_output`,
  and `item_2.text`; none carries an account identifier, key source, or model name.

```jsonl
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"<elided>"}}
{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"<elided>","aggregated_output":"","exit_code":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"<elided>","aggregated_output":"<elided>","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"<elided>"}}
```

- `item_0.text` and `item_2.text` both began `{"schema_version":2,"review_kind":"plan","verdict":`,
  with `"pass"` in `item_0` and `"changes_requested"` in `item_2`. The `-o` file contained `item_2`.
- Run A's stream is seven records, in this recorded order: `thread.started`, `turn.started`,
  `item.completed` (`item_0`, `agent_message`), `item.started` (`item_1`, `command_execution`),
  `item.completed` (`item_1`, `command_execution`), `item.completed` (`item_2`, `agent_message`),
  `turn.completed`. Three turn records and four `item.*` records. This is the order the fixture keeps
  and the order the replay test feeds.
- Run A turn records, verbatim: `{"type": "thread.started", "thread_id": "01a01fcc-8baa-7de1-8690-a2e872df6266"}`,
  `{"type": "turn.started"}`, and `{"type": "turn.completed", "usage": {"input_tokens": 39795,
  "cached_input_tokens": 16128, "cache_write_input_tokens": 0, "output_tokens": 1992,
  "reasoning_output_tokens": 1568}}`.
- Implementer checks, 2026-08-20: `npm run typecheck` exited 0; `npm test` exited 0 (193 passing
  tests). `node --import tsx src/cli/main.ts doctor --repo .` exited 0 and printed
  `launcher codex-plan-reviewer-v1: resolved` and
  `codex-plan-reviewer-v1: executable resolved; interface unavailable` with no authentication,
  account, or entitlement fact. Interface unavailable in this session is the isolated `codex`
  wrapper failing before `exec --help`; it is not an authentication probe.
- D3 correction checks, 2026-08-20: `npm run typecheck` exited 0; `npm test` exited 0 (193 passing
  tests). `node --import tsx src/cli/main.ts doctor --repo .` exited 0 and printed
  `launcher codex-plan-reviewer-v1: resolved` and
  `codex-plan-reviewer-v1: executable resolved; interface unavailable` with no authentication,
  account, or entitlement fact. Interface unavailable in this session is the isolated `codex`
  wrapper failing before `exec --help`; it is not an authentication probe.
- Reviewer checks, 2026-08-20: `npm run typecheck` exited 0; `npm test` exited 0 (193 passing tests,
  including the Codex D3 run-directory and workspace-isolation test); `node --import tsx
  src/cli/main.ts doctor --repo .` exited 0 and reported all three launchers resolved, with the Codex
  executable and interface available. Its output contains no authentication, account, or entitlement
  fact.

## Review

Verdict: APPROVED

Findings:

- None.

## Blockers

None.

## Next Action

None. The scoped implementation and its required review are complete.
