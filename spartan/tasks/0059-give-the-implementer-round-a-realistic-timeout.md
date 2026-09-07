---
protocol: "1.1.0" # x-release-please-version
id: give-the-implementer-round-a-realistic-timeout
created_at: 2026-09-01
status: completed
phase: done
task_type: implementation
risk: material
current_role: human-operator
next_role: none
updated_at: 2026-09-01
handoff_id: HX-004
next_handoff_id: none
---

# Give the auto-chain implementer round a realistic timeout

## Objective

A mapped implementer round that legitimately runs 20–40 minutes (a multi-file
change on a slower model) finishes and declares done instead of being
SIGTERM'd as `producer_timeout` after writing every file. The producer wait
timeout is separate from the review timeout, longer, and — where
`spartan-bridge/config.yaml` opts in — overridable per repository without
weakening the Bridge default floor.

## Context

Bridge task `0057` (2026-09-01): the plan review passed (`run-ca01250d`), the
auto-chain dispatched the Cursor implementer, and it wrote the complete
implementation — 22 files, ~934 lines — then the transition stopped:

- `transition-c82bd22d`, `state: stopped`, `reason_code: producer_timeout`
- `producer_diagnostic: { stage: "wait", timed_out: true, exit_code: 143 }`

Four of its own new tests were still red (the round never reached its check
loop) and a human-operator finished them. The implementation was sound; only
the clock ran out.

Root cause: `src/adapters/cursor.ts:695` spawns the **producer** round with
`timeoutMs: CURSOR_REVIEW_TIMEOUT_MS` — the same `900_000` (15 min) constant a
plan/implementation **review** uses (`:500`). A review is a bounded read; an
implementer round on `composer-2.5` writing 20+ files across a scope this size
is not, and 15 minutes is short. `src/adapters/grok.ts:552` reuses
`GROK_REVIEW_TIMEOUT_MS` the same way. Codex and Claude adapters have no
`startProducer` path today; only Cursor and Grok are in scope.

`spartan-bridge/config.yaml` docs list `timeouts` as a planned key
(`docs/ROUTING-AND-WORKFLOWS.md`). Task `0048` reconciled the docs against the
parser but did not implement timeouts. This slice implements exactly one
optional subkey under the already-parsed `transitions.review_plan_pass` entry —
not a new top-level `timeouts:` block (that would break the closed two-key top
level from D-049). No edit to the committed `spartan-bridge/config.yaml` is
required: the parser change is code-only; docs describe the optional subkey
without changing the repository's default config file.

## Scope

- `src/core/contracts.ts`
  - Export `BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS = 2_700_000` (45 minutes) as
    the Bridge safety floor every resolver and adapter constant must meet.
  - Extend `AdapterProducerInput` with optional `producer_timeout_ms` (positive
    integer only; validated at the transition boundary before spawn).
  - Extend `ProducerDiagnostic` with `waited_ms: number | null` — non-null only
    on a `producer_timeout` stop. Extend `buildProducerDiagnostic` accordingly
    (`schema_version` stays `2`; see D2).
- `src/core/serialize.ts`
  - Extend `serializeProducerDiagnostic` to whitelist `waited_ms` as the seventh
    key; normalize out-of-domain values to `null` (same pattern as the existing
    six keys).
- `src/adapters/cursor.ts` / `src/adapters/grok.ts`
  - Add `CURSOR_PRODUCER_TIMEOUT_MS` / `GROK_PRODUCER_TIMEOUT_MS` equal to
    `BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS`. `startProducer` passes
    `input.producer_timeout_ms ?? *_PRODUCER_TIMEOUT_MS` as `timeoutMs`; review
    spawns keep `*_REVIEW_TIMEOUT_MS` (`900_000`).
- `src/core/transition.ts`
  - Resolve the producer timeout once per producer round from config (D3) and
    pass it on `startProducer`. On `producer_timeout`, call
    `buildProducerDiagnostic` with `waitedMs` set to that resolved value.
- `src/policy/bridge-config.ts`
  - Parse optional `transitions.review_plan_pass.implementer_timeout_ms` as a
    positive integer. Extend the valid `BridgeConfig` shape; entry may have two
    or three keys (`successor`, `dispatch`, and optionally
    `implementer_timeout_ms`); any other key under the entry or top level stays
    `config_invalid`.
  - Export `resolveProducerTimeoutMs(config, defaultMs)` implementing the
    raise-only rule (D3).
- `docs/DECISIONS.md` / `docs/ROUTING-AND-WORKFLOWS.md`
  - Record that producer and review timeouts differ; document the optional
    `implementer_timeout_ms` subkey, the raise-only floor, and below-floor
    clamp behavior (D4).
- Tests: `tests/cursor-adapter.test.ts` / `tests/grok-adapter.test.ts` (producer
  spawn `timeoutMs` uses the producer constant or an injected override),
  `tests/transition.test.ts` (`producer_timeout` diagnostic carries
  `waited_ms`; scaled fake-runner completes under the longer timeout),
  `tests/bridge-config.test.ts` (optional subkey, raise-only resolution,
  below-floor clamp, invalid values rejected),
  `tests/serialize.test.ts` (seventh-key whitelist for `waited_ms`).

## Out of Scope

- Detaching or backgrounding the producer child further (task `0055` already
  reparents the whole chain off the caller's shell; this is the chain's own
  internal wait).
- Resuming a `producer_timeout` transition (task `0056` — a `producer_running`
  death is explicitly not auto-respawned there; a `producer_timeout` is the
  same class).
- The full `timeouts` / `limits` / `gates` config surface — at most this one
  subkey under `review_plan_pass`.
- Making reviews longer. A review that needs 15+ minutes is a different problem.
- Codex / Claude producer adapters (no `startProducer` today).
- Editing the committed `spartan-bridge/config.yaml` (parser-only subkey; docs
  describe usage without changing the repository default file).
- The `0057` diagnostics work and the wrapper fixes.

## Constraints

- English artifact.
- A config override may only raise the producer timeout, never weaken the Bridge
  safety bound (`BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS`).
- The review timeout constant (`900_000`) is unchanged.
- `npm run typecheck` / `npm run build` clean; `npm test` no new failure.

## Decisions

- **D1 — distinct producer timeout constants pinned at 45 minutes.**
  `BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS`, `CURSOR_PRODUCER_TIMEOUT_MS`, and
  `GROK_PRODUCER_TIMEOUT_MS` are all `2_700_000` (45 min), strictly greater than
  the unchanged `*_REVIEW_TIMEOUT_MS` of `900_000` (15 min). Rationale: task
  `0057`'s implementer wrote 22 files and was SIGTERM'd at 15 min with work
  still running; 45 min covers the documented 20–40 min implementer band with
  margin without approaching an unbounded wait.
- **D2 — `producer_timeout` diagnostic carries `waited_ms`; transition
  `schema_version` stays `2`.** Add `waited_ms: number | null` to the closed
  `ProducerDiagnostic` record. Only the `producer_timeout` arm in
  `runGuardedRound` sets it to the resolved spawn timeout; every other arm leaves
  it `null`. `buildProducerDiagnostic` validates a positive integer when
  supplied; `serializeProducerDiagnostic` in `src/core/serialize.ts` whitelists
  the seventh key. **Compatibility:** this is an additive, nullable field on an
  already-nullable diagnostic object (`producer_diagnostic` is `null` on every
  non-timeout stop). No consumer asserts an exact key count on
  `ProducerDiagnostic`; `parseTransitionStatusJson` normalizes missing keys to
  `null` (same pattern as D-036). A schema bump is unnecessary.
- **D3 — config subkey lands in this slice under `review_plan_pass`, not a
  top-level `timeouts:` block.** Parse optional
  `transitions.review_plan_pass.implementer_timeout_ms` as a positive integer.
  Resolve in `transition.ts` via `resolveProducerTimeoutMs(config,
  BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS)` and thread through
  `AdapterProducerInput.producer_timeout_ms`. **Raise-only / safety floor:**
  `resolved = Math.max(BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS, configured)` when
  configured is present — a repository cannot shorten the wait below the Bridge
  default. A syntactically valid value below the floor (e.g. `600_000`) is
  **silently clamped** to `2_700_000`, not rejected as `config_invalid`: the
  subkey semantics are "raise the ceiling," not "set an exact timeout," and
  honoring a sub-floor value would violate the safety bound. Operators who need
  the default simply omit the key. Non-integer, zero, negative, or extra keys →
  `config_invalid`. Absent key → default constant only. A scaled fake-runner
  integration test (short timeout and short delay) proves a producer round
  completes when work duration is below the resolved timeout (D1).
- **D4 — docs record the new timeout split and config subkey.** Amend
  `docs/DECISIONS.md` and `docs/ROUTING-AND-WORKFLOWS.md` to state that producer
  and review timeouts differ, name the optional `implementer_timeout_ms`
  subkey, and document raise-only clamp behavior. No committed
  `spartan-bridge/config.yaml` edit.

## Acceptance Criteria

- [x] (D1) `startProducer` in `cursor.ts` and `grok.ts` spawns with
      `timeoutMs` equal to `*_PRODUCER_TIMEOUT_MS` (`2_700_000`) or an injected
      `producer_timeout_ms` strictly greater than `*_REVIEW_TIMEOUT_MS`; a test
      in each adapter file asserts the spawned `timeoutMs`.
- [x] (D1) A scaled fake-runner test (short timeout and short delay standing in
      for the 20-minute case) shows the producer round completes instead of
      stopping `producer_timeout` when work duration is below the resolved
      producer timeout.
- [x] (D2) A `producer_timeout` stop's `producer_diagnostic` includes
      `waited_ms` set to the resolved spawn timeout; `tests/transition.test.ts`
      updates the existing D2 diagnostic table and asserts `waited_ms`.
      `tests/serialize.test.ts` asserts the seventh-key whitelist.
- [x] (D3) `parseBridgeConfigYaml` accepts an optional
      `implementer_timeout_ms` on `review_plan_pass`, rejects invalid values,
      and `resolveProducerTimeoutMs` never returns less than
      `BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS` (including below-floor clamp);
      `tests/bridge-config.test.ts` covers accept, raise-only, clamp, and
      reject cases.
- [x] (D4) `docs/DECISIONS.md` and `docs/ROUTING-AND-WORKFLOWS.md` note the
      separate producer timeout, the optional `implementer_timeout_ms` subkey,
      and below-floor clamp behavior.
- [x] `npm run typecheck` / `npm run build` clean; `npm test` adds no new
      failure.

## Work Completed

- 2026-09-01: task created after bridge `0057`'s auto-chain implementer round
  wrote the full implementation (22 files) and was then SIGTERM'd
  `producer_timeout` at the 15-minute `CURSOR_REVIEW_TIMEOUT_MS` reused for the
  producer spawn (`src/adapters/cursor.ts:695`). A human-operator finished the
  four red tests.
- 2026-09-01 (planner, HX-001): refined plan against `cursor.ts`, `grok.ts`,
  `transition.ts`, and `bridge-config.ts`; pinned D1 at 45 min; closed D3 in
  slice with raise-only `implementer_timeout_ms`; confirmed every Scope path
  exists.
- 2026-09-01 (planner, HX-002): revised against plan-review findings
  (`run-3de56623`): added `serialize.ts` scope, D2 compatibility rationale, D4
  for docs, tagged criteria to decisions, documented below-floor clamp, confirmed
  no `config.yaml` file edit.
- 2026-09-01 (implementer, HX-004): split producer vs review timeouts at
  `2_700_000` / `900_000`; threaded `producer_timeout_ms` through
  `transition.ts` → adapters; added optional `implementer_timeout_ms` parser
  subkey with raise-only `resolveProducerTimeoutMs`; extended
  `ProducerDiagnostic.waited_ms`; docs D-058; tests in bridge-config,
  serialize, transition, cursor-adapter, grok-adapter. The auto-chain
  implementer round finished in ~14 min this time — under the current 15-min
  limit (a ~14-file change fit; `0057`'s 22-file change did not), which is why
  no `producer_timeout` fired here.
- 2026-09-02 (human-operator finish): the implementer round added
  `waited_ms` to `ProducerDiagnostic` but missed one expected-object assertion
  in `tests/cli.test.ts` (`plan review recovery line eligibility`). Added
  `waited_ms: null`. `npm run typecheck` / `npm run build` clean;
  `npm test` **416 / 0**.
- 2026-09-02: **implementation review APPROVED** — Bridge-dispatched
  `reviewer.implementation` (`run-6f7ddda2-a126-4bb5-abc0-c77ad6e5da47`,
  `exec-a339afea`, Claude Code / claude-sonnet-5 / medium, vendor Anthropic;
  read-only, no findings), cycle 1/3. The runtime wrote the `## Review`
  implementation region. **Task completed** (human-operator): plan APPROVED
  (2 cycles), implementation APPROVED, 416/0.

## Evidence

- `src/adapters/cursor.ts:146` `CURSOR_REVIEW_TIMEOUT_MS = 900_000`; `:500`
  (review spawn) and `:695` (producer spawn) both pass it as `timeoutMs`.
- `src/adapters/grok.ts:122` `GROK_REVIEW_TIMEOUT_MS = 900_000`; `:392`
  (review) and `:552` (producer) reuse it.
- `src/core/transition.ts:511-519` — the `producer_timeout` stop calls
  `buildProducerDiagnostic({ stage: "wait", timedOut: true })` with no
  `waited_ms` today.
- `src/core/contracts.ts:276-327` — `ProducerDiagnostic` has six keys today;
  `AdapterProducerInput` has no timeout field.
- `src/core/serialize.ts:134-145` — `serializeProducerDiagnostic` whitelists
  six keys today.
- `src/policy/bridge-config.ts:66-100` — parser accepts exactly
  `schema_version` + `transitions`, and `review_plan_pass` entries with exactly
  `successor` + `dispatch`.
- `docs/ROUTING-AND-WORKFLOWS.md` — `timeouts` listed as planned, not parsed.
- Bridge `0057` `transition-c82bd22d` — `state: stopped`,
  `reason_code: producer_timeout`, `exit_code: 143`.
- Plan review `run-3de56623` — `changes_requested`, cycle 1/3.
- Path check (2026-09-01): every Scope path exists in the checkout (`src/core/
  contracts.ts`, `src/core/serialize.ts`, `src/core/transition.ts`,
  `src/adapters/cursor.ts`, `src/adapters/grok.ts`,
  `src/policy/bridge-config.ts`, `docs/DECISIONS.md`,
  `docs/ROUTING-AND-WORKFLOWS.md`, `tests/cursor-adapter.test.ts`,
  `tests/grok-adapter.test.ts`, `tests/transition.test.ts`,
  `tests/bridge-config.test.ts`, `tests/serialize.test.ts`).
- `node node_modules/typescript/bin/tsc --noEmit` — exit 0 (2026-09-01).
- `node --import tsx --test tests/bridge-config.test.ts tests/serialize.test.ts
  tests/transition.test.ts tests/cursor-adapter.test.ts tests/grok-adapter.test.ts`
  — all targeted tests pass; new producer-timeout cases included (2026-09-01).
- `node --import tsx --test tests/*.test.ts` — 404 pass / 12 fail (2026-09-01);
  failures are Darwin sandbox / `manage-install.sh` / real-Cursor POSIX
  regressions on this host, not introduced by this slice (same classes as prior
  tasks' environmental reds).

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-1328f627-aa57-4534-b004-b0f65b4780a3 execution_id=exec-a42d5bf4-d327-4ce2-8663-c7d9635efd9c review_kind=plan verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-sonnet-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:20fcfa7c8df758f5b260cdddb5dfbf86c1d202fcecff22e1ed15e24e6cabf2e0 task_hash=sha256:64272a9c9f866bf9002dbef93db4164b279b34c627535c51f9ad5680be8998db agents_hash=sha256:5b0538f788aa238a0f4e3edc1477bc42f67c2e71fee4bf230a3cfe394d51eeff timestamp=2026-09-01T21:00:25.668Z
<!-- spartan-bridge:review:plan:end -->

<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-6f7ddda2-a126-4bb5-abc0-c77ad6e5da47 execution_id=exec-a339afea-00f0-49f6-975e-8ea95874c11d review_kind=implementation verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-sonnet-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:1432cf4ad657ba8b32cb1751f04ef520e7ecebe5fcb14dec11a3dca63243ff05 task_hash=sha256:676dbedfbc0e340a276b6e787f16c961f0a3ad19401b6924d7aa285998d5866b agents_hash=sha256:5b0538f788aa238a0f4e3edc1477bc42f67c2e71fee4bf230a3cfe394d51eeff timestamp=2026-09-01T21:14:50.218Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None. Related to `0055` / `0056` (chain lifecycle) but independent.

## Next Action

A technically read-only implementation reviewer, dispatched by the Bridge,
assesses the D1–D4 implementation against the approved plan (`run-1328f627`) and
returns one explicit verdict.

## Next Handoff

No outstanding handoff. Task completed on the Bridge implementation-review pass
and human-operator sign-off.
