---
protocol: "1.1.0" # x-release-please-version
id: config-toggle-for-binding-vs-harness-model
created_at: 2026-09-02
status: completed
phase: done
task_type: implementation
risk: material
current_role: human-operator
next_role: none
updated_at: 2026-09-04
handoff_id: HX-004
next_handoff_id: none
---

# A `config.yaml` toggle: is the `AGENTS.md` binding authoritative over the harness model?

## Objective

A repository can declare, in its operational config, whether a human-started
producer round entered through `/spbridge` must match the model its `AGENTS.md`
binding names, or whether the interactive session's own model is allowed. When
the repository opts into enforcement and the two differ, `/spbridge` stops (or
warns) before doing the producer work instead of silently running the round on
the wrong model.

## Context

A human-started producer round through `/spbridge` (step 2 of the skill) runs
`/spartan` **in the current interactive session**. That session executes on
whatever model the harness UI has selected — not the `AGENTS.md` `planner` /
`implementer` binding. The binding is only enforced mechanically when the Bridge
itself spawns the mapped producer as a subprocess with `--model` (the auto-chain
successor after a persisted plan-review pass).

On 2026-09-02 an operator raised the `implementer` binding to
`cursor-grok-4.6-high-fast` / `high`, then ran a human-started `/spbridge`
implementer correction round from a Cursor session still set to `composer`. The
round ran on `composer`; nothing flagged the mismatch.

`docs/ROUTING-AND-WORKFLOWS.md` section "What each host accepts as Model and
Effort" records why a string compare is narrower than it first looks: each host
turns the binding's Model and Effort columns into different argv (Claude
`--model` / `--effort`, Grok `-m` / `--reasoning-effort`, Codex
`-c model=` / `-c model_reasoning_effort=`, Cursor `--model` with effort
encoded in the name). `MODEL_IDENTIFIER_RE` in `src/core/contracts.ts`
(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`) validates shape and never the host; only
the Cursor adapter cross-checks an effort embedded in a model name. A display
name such as `Grok 4.6` is not that shape.

The Bridge also does not close the loop after the fact. `ProducerIdentity` in
`src/core/contracts.ts` is `{ role, host }` with no model field.
`compareObservedModel` in `src/core/review.ts` records even the reviewer's own
model as `model_observed: declared_unobserved` when `observedModel()` is null
(Cursor, Codex, and Grok all take that path today). An artifact's self-declared
model is therefore unverified. This task does not change that (D5).

Option "B" (make every human-started producer round Bridge-spawned and headless)
loses the interactivity a human-started round exists for and is a separate,
larger design change. This task is the lighter guardrail: a per-repository
policy that turns a silent wrong-model run into a caught one.

`parseBridgeConfigYaml` currently rejects any top-level key set other than
exactly `{schema_version, transitions}` (`keys.length !== 2`).
`resolveProducerTimeoutMs` is the additive-optional precedent (task `0059`):
an optional field on a `kind: "valid"` config, a resolver that defaults when
absent, `BRIDGE_CONFIG_SCHEMA_VERSION` stays `1`.

`parseAgentsPolicy` / `parseAgentHostsSection` in `src/policy/agents-policy.ts`
accept a `planner` table row (unique Binding values are allowed) but capture
only `reviewer.plan` (top-level `host` / `model` / `effort`),
`reviewer.implementation`, and `implementer`. A `policy --role planner`
helper cannot return `binding_model` until that parser keeps the planner row.

`spartan-bridge doctor` accepts only `--repo`, prints capability lines such as
`binding reviewer.plan: adapter available; launcher=…`, and does not report
planner or any binding's Model / Effort. The skill's step-2 contract reads
exactly that reviewer binding line for `reviewer_output_unconstrained`.

## Scope

- `src/policy/bridge-config.ts`
  - Admit an optional top-level `producer` section with exactly one key,
    `model_binding`, whose value is the enum in D1. Top-level keys become
    `{schema_version, transitions}` or `{schema_version, transitions, producer}`.
    Every other unknown key remains `config_invalid`. `BridgeConfig` gains
    optional `model_binding`. `resolveModelBindingMode(config)` mirrors
    `resolveProducerTimeoutMs` and returns `advisory` when the section is
    absent, the config is `absent`, or the field is unset.
  - `BRIDGE_CONFIG_SCHEMA_VERSION` stays `1`.
- `src/policy/agents-policy.ts`
  - Capture a `planner` row the same way `implementer` is captured
    (`ReviewerBinding | null` on the parse result). Do not make the planner
    row required; `reviewer.plan` remains the only required binding.
- A new read-only CLI command `spartan-bridge policy --repo <root> --role <planner|implementer>`
  (`src/cli/parse.ts`, `src/cli/main.ts`, new `src/core/policy-query.ts`).
  One JSON object on stdout. Non-mutating, no run created, no `--after-run`.
  `doctor` is unchanged: still only `--repo`, still no model lines.
- `agent-skill/skills/spbridge/SKILL.md` step 2, after the existing
  `reviewer_output_unconstrained` stop and before `/spartan`. Hard-boundary
  exception: the skill may also read this helper's JSON line before a verdict.
  Steps 6/7 are unchanged and do not re-run the check.
- `docs/ROUTING-AND-WORKFLOWS.md` — the source table, the "Optional operational
  config" parser paragraph, and a short description of the three modes. Note
  that the toggle governs only human-started `/spbridge` producer rounds, not
  the auto-chain (which is always binding-driven via argv).
- `docs/DECISIONS.md` — new D-068; amend D-004 and D-049 for the optional
  `producer` section.
- `README.md` shipped-commands list and `HELP_TEXT` in `src/cli/parse.ts`.
- Tests: `tests/bridge-config.test.ts`, `tests/parse.test.ts`,
  `tests/agents.test.ts`, `tests/spbridge-skill.test.ts`, and a new helper
  test file next to those (for example `tests/policy-query.test.ts`).

## Out of Scope

- Making the skill switch the harness model. It never does.
- Bridge-spawning human-started producer rounds (option "B").
- Observing / verifying the model a Bridge-spawned round actually used
  (dropping `declared_unobserved`, adding model to `ProducerIdentity`, or
  treating an artifact's self-declared model as verified) — D5; a separate
  task.
- The `reviewer.plan` / `reviewer.implementation` bindings: those are always
  Bridge-dispatched and already `--model`-driven; this toggle is producer-only.
- Host comparison. The check compares model identifiers, not canonical hosts.
- Adding host introspection plumbing (`grok models`, `--list-models`, `about`,
  entitlement queries). A session model that is not already an exposed
  `MODEL_IDENTIFIER_RE`-shaped identifier is unknowable (D3).
- Editing `AGENTS.md` or this repository's operational config file. Absent
  `producer` means `advisory`; this checkout does not opt in (D7).
- Renaming `ReviewerBinding`; the planner field reuses that type as
  `implementer` already does.
- Changing `doctor`'s argv, exit code, or binding-line format.

## Constraints

- English artifact.
- Default `advisory` — an existing operational config with no `producer`
  section behaves exactly as today.
- `BRIDGE_CONFIG_SCHEMA_VERSION` stays `1` (additive optional section,
  consistent with the `implementer_timeout_ms` precedent).
- The skill stays a thin adapter: it may read the helper's JSON and compare
  strings; it does not parse `AGENTS.md` or the operational config itself,
  and it never selects a host or model.
- This plan does not edit `AGENTS.md` or this repository's operational config
  file, so plan-review pass stays on the mapped implementer (D-053), not
  `human-operator`.
- `npm run typecheck` / `npm run build` clean; `npm test` no new failure.

## Decisions

- **D1 — config shape.** Top-level optional section:

  ```yaml
  producer:
    model_binding: advisory   # advisory | warn | strict
  ```

  Enum is exactly `advisory | warn | strict`. Default when the section is
  absent, the file is absent, or the field is unset: `advisory`. The section,
  when present, is a plain object with exactly the one key `model_binding`;
  an empty `producer: {}`, a sibling key, or a non-enum value is
  `config_invalid`. Top-level keys are `schema_version` and `transitions`,
  optionally plus `producer`; `host:`, `timeouts:`, and every other sibling
  remain `config_invalid`. `BridgeConfig` stores `model_binding?` the same
  way it stores `implementer_timeout_ms?`. `resolveModelBindingMode` returns
  the enum and defaults to `advisory` for `kind: "absent"` and for a valid
  config that omitted the section. Schema version stays `1`.

- **D2 — the skill learns `binding_model` and the mode from a new
  `spartan-bridge policy` command, not from `doctor`.**
  `doctor` stays a capability check (`--repo` only; binding lines name
  adapter availability). Extending it would change the step-2
  `reviewer_output_unconstrained` line the skill already greps, still would
  not report planner, and would mix policy values into a capability report.
  The new command is:

  ```text
  spartan-bridge policy --repo <root> --role <planner|implementer>
  ```

  Success (exit 0) prints one JSON object and nothing else:

  ```text
  {"role":"planner","model_binding_mode":"advisory","binding_model":"grok-4.6","binding_effort":"high"}
  ```

  `binding_model` / `binding_effort` are `null` when that role's row is
  missing or `parseAgentsPolicy` does not resolve; `model_binding_mode` is
  still filled from the operational config (absent file → `advisory`). Exit 1
  with no JSON on usage errors, unreadable repo, or `config_invalid`. To
  return a planner `binding_model`, `parseAgentHostsSection` must capture the
  `planner` row onto the parse result as `planner: ReviewerBinding | null`
  (not required, same as `implementer`). The skill takes `--role` from the
  paste's `Act as <role>` (step 1), not from frontmatter or `AGENTS.md`. If
  that role is not `planner` or `implementer`, skip the helper.

- **D3 — `strict` degrades to `warn` when the session model is unknowable.**
  The session model is knowable only when this host has already exposed an
  identifier matching `MODEL_IDENTIFIER_RE` without querying entitlements
  or listing models. A display name with a space (`Grok 4.6`), an empty
  value, or no exposed identifier is unknowable: print one line that the
  model could not be confirmed, then proceed, even if the mode is `strict`.
  A hard stop on unknowable would make `strict` unusable on every host that
  does not already surface an argv-shaped id, which is the common case
  today. When `binding_model` is `null` under `strict`, that is not
  unknowable-session: abort (there is no bound model to match). When the
  helper exits non-zero or its stdout is not that JSON object, abort the
  invocation (the review spawn would fail on `config_invalid` / unreadable
  repo anyway).

- **D4 — abort point is step 2, after the unconstrained-reviewer doctor
  stop and before `/spartan`.** Order: existing `doctor` check; then D2's
  helper when the paste role is `planner` or `implementer`; then
  advisory / warn / strict; then the existing shape requirements and
  `/spartan`. `advisory`: no compare. `warn` on mismatch: one-line notice
  naming `binding_model` and `binding_effort`, then proceed. `strict` on
  mismatch: stop the whole `/spbridge` invocation — no producer work, no
  review spawn. Tell the human to switch the harness model to
  `binding_model`. When the paste role is `implementer`, also name the
  Bridge-dispatched auto-chain successor as an alternative (it always
  passes `--model`). Do not name auto-chain as a planner recovery; the
  planner phase is always human-started. Do not re-run this check on a
  step-6 same-session continuation. The skill never switches the model.

- **D5 — this task leaves the post-round observation gap open.** It does
  not add `model` to `ProducerIdentity`, does not change
  `compareObservedModel` / `model_observed: declared_unobserved`, and does
  not treat an artifact's self-declared model as verified. The new check is
  a pre-round skill-side string compare of an already-exposed session
  identifier against `binding_model`. Auto-chain producers remain
  argv-driven and are not in this toggle. Closing the observation gap is a
  separate task.

- **D6 — comparison rule.** Compare the session identifier to
  `binding_model` with the same case-insensitive trim
  `compareObservedModel` already uses (`src/core/review.ts`). Do not
  compare `binding_effort` as a separate field (Cursor already encodes
  effort in the model name; every other host's Effort column is a
  different argv flag). Do not compare host. Do not invent a mapping from
  display names to argv ids. `binding_effort` is included in the helper
  JSON and in the human-facing warn / stop line so the operator can set
  both.

- **D7 — this checkout does not opt in.** The implementation does not
  modify `AGENTS.md` or this repository's operational config file. Repos
  that want `warn` or `strict` add the `producer` section themselves (a
  human edit of an authority file). Plan-review pass therefore stays on
  the mapped `implementer`, not `human-operator`.

## Acceptance Criteria

- [x] (D1) `parseBridgeConfigYaml` accepts `producer: { model_binding: advisory|warn|strict }`,
      defaults via `resolveModelBindingMode` to `advisory` when the section
      is absent / the file is absent, and still rejects an unknown top-level
      key, an empty `producer` map, a sibling under `producer`, and a
      non-enum value with `config_invalid`; `tests/bridge-config.test.ts`
      covers each. Schema version stays `1`.
- [x] (D2) `spartan-bridge policy --repo <root> --role <planner|implementer>`
      prints one JSON object with `role`, `model_binding_mode`,
      `binding_model`, and `binding_effort`; `doctor` still accepts only
      `--repo` and still does not print Model / Effort. A test covers the
      JSON, a missing role row (`binding_model: null` with mode still
      filled), and usage errors. `HELP_TEXT` and the README shipped-commands
      list name the command.
- [x] (D2) `parseAgentsPolicy` exposes `planner: ReviewerBinding | null`
      when a unique `planner` row is present, and still does not require
      that row; `tests/agents.test.ts` covers capture and absence.
- [x] (D3, D4, D6) `agent-skill/skills/spbridge/SKILL.md` step 2 runs the
      helper after the unconstrained-reviewer doctor stop and before
      `/spartan`; `advisory` skips compare; `warn` notices and proceeds;
      `strict` aborts the invocation on a case-insensitive
      `binding_model` mismatch with switch-harness guidance, plus
      auto-chain-successor guidance only for `implementer`; `strict`
      degrades to `warn` when the session identifier is not
      `MODEL_IDENTIFIER_RE`-shaped; helper failure aborts; step 6 does not
      re-check; `tests/spbridge-skill.test.ts` covers that wording.
- [x] (D5) `ProducerIdentity` remains `{ role, host }`; no implementation
      path in this task writes `model_observed` other than the existing
      declared/observed compare; the skill wording does not claim the
      Bridge verified the producer model.
- [x] (D7) The implementation does not modify `AGENTS.md` or this
      repository's operational config file.
- [x] (D1) `docs/ROUTING-AND-WORKFLOWS.md` and `docs/DECISIONS.md` document
      the key, the three modes, the `advisory` default, that the toggle is
      human-started `/spbridge` producer rounds only, and that the
      observation gap stays open. D-004 and D-049 are amended for the
      optional `producer` section.
- [x] `npm run typecheck` / `npm run build` clean; `npm test` adds no new
      failure.

## Work Completed

- 2026-09-02: task created after a human-started `/spbridge` implementer round
  ran on `composer` while the `AGENTS.md` `implementer` binding said
  `cursor-grok-4.6-high-fast`, with nothing flagging the mismatch.
- 2026-09-04: planner round adopted HX-001. Pinned D1–D7. Plan-review pass
  `run-0e92d20d-90f9-4b60-9099-7c8f5ec3f03a`.
- 2026-09-04: first implementer round. Optional `producer.model_binding` on
  schema 1; `resolveModelBindingMode` defaults to `advisory`.
  `parseAgentsPolicy` captures optional `planner`. New
  `spartan-bridge policy --repo <root> --role <planner|implementer>` prints
  one JSON object. Skill step 2 runs that helper after the unconstrained
  doctor stop and before `/spartan`; step 6 does not re-check. Documented
  D-068 and amended D-004 / D-049. Did not edit `AGENTS.md` or
  `spartan-bridge/config.yaml`.
- 2026-09-04: implementer correction against
  `run-3828db55-f1dc-449f-bad8-4d0becb5e9d6` `CHANGES_REQUESTED`.
  `SKILL_ONE_AGENTS_FACT`: step 2 now names both pre-verdict reads (`doctor`
  and `policy`). `WARN_NULL_BINDING_MODEL`: `warn` with null
  `binding_model` prints that no bound model was found and proceeds.
  `PLANNER_ROW_NEW_FAILURE_SURFACE`: `tests/agents.test.ts` covers an
  unresolvable planner host; README adoption and D-068 record that the row
  fails the entire parse. Host Grok, model grok-4.6, effort high, vendor
  xAI.
- 2026-09-04: human-operator change, outside this plan. The `Grok` account
  balance was exhausted mid-chain, so the human remounted the `AGENTS.md`
  binding table: `planner` Claude Code / `claude-opus-5` / high,
  `reviewer.plan` Codex / `gpt-5.6-sol` / high, `implementer` Codex /
  `gpt-5.6-sol` / high, `reviewer.implementation` Claude Code /
  `claude-opus-5` / high. `tests/agents.test.ts` pins this repository's own
  parsed policy, so its two repository-fact assertions were updated to the
  new rows, and this task's `## Next Handoff` advisory now reads effort
  `high`. That edit is the human's, not the mapped implementer's: `AGENTS.md`
  stays outside every automatic write scope (D-053), and the plan's D1-D7,
  its Scope, and its acceptance criteria are unchanged by it. No
  `spartan-bridge/config.yaml` change: this checkout still does not opt into
  `producer.model_binding`, so `advisory` remains the resolved mode (D7).
- 2026-09-04: implementation review cycle 1 of a fresh chain,
  `run-974ed3c2-92c2-4a3d-9cc2-ce53beb7cfc0`, `APPROVED` with no findings.
  A new chain rather than a continuation of
  `run-3828db55-f1dc-449f-bad8-4d0becb5e9d6`: the binding remount changed
  `AGENTS.md`, and `src/core/review.ts:1095` refuses a chained parent whose
  `agents_hash` differs (`agents_changed`). The intervening
  `run-a41f35e6-3ccc-479e-b371-eddc4d089ff1` recorded no verdict — its
  reviewer child exhausted its structured-output retries
  (`/summary: must NOT have more than 2000 characters (got 2051)`), an
  adapter failure, not findings; task `0071` is queued for that diagnostic.
  Task completed on human-operator sign-off.

## Evidence

- `src/policy/bridge-config.ts` — `BridgeConfig` stores optional
  `model_binding`; top-level keys are `{schema_version, transitions}` or
  `{schema_version, transitions, producer}`; `resolveModelBindingMode`
  returns `advisory` for `absent` and for a valid config that omitted the
  section. `BRIDGE_CONFIG_SCHEMA_VERSION` remains `1`.
- `src/core/policy-query.ts` — success JSON keys `role`,
  `model_binding_mode`, `binding_model`, `binding_effort`; missing row or
  unresolved `parseAgentsPolicy` leaves the model fields `null` with mode
  still filled; `config_invalid` and unreadable repo fail with no JSON.
- `src/cli/parse.ts` — `policy` requires `--repo` and
  `--role planner|implementer`; `doctor` still accepts only `--repo`.
- `agent-skill/skills/spbridge/SKILL.md` step 2 names both pre-verdict
  `AGENTS.md` facts (`doctor` and `policy`); `warn` with null
  `binding_model` proceeds after one line; step 6 does not re-check; wording
  does not claim the Bridge verified the producer model.
- `tests/agents.test.ts` — unresolvable planner host (`Windsurf`) fails
  `parseAgentsPolicy` with `host_invalid` / `host_unknown`.
- `README.md` Required `AGENTS.md` authorization — optional `planner` row is
  resolved like `implementer`. `docs/DECISIONS.md` D-068 consequence records
  the same fail-closed parse.
- `git status --short` (2026-09-04, after correction): no `AGENTS.md` or
  `spartan-bridge/config.yaml` in the diff.
- `npm run typecheck` — exit 0.
- `npx tsc --outDir /tmp/spartan-bridge-build-0065` — exit 0 (`npm run build`
  is EPERM on `dist/`, which is outside the automatic write scope).
- `node --import tsx --test tests/bridge-config.test.ts tests/parse.test.ts tests/agents.test.ts tests/policy-query.test.ts tests/spbridge-skill.test.ts tests/doctor.test.ts`
  — 62 pass, 0 fail.
- `NODE_NO_WARNINGS=1 npm test` — 513 pass, 11 fail, 524 tests. Every
  failure is `sandbox-exec: sandbox_apply: Operation not permitted` (or a
  Cursor POSIX write-scope guard that never reached implementation) inside
  this producer sandbox. None of the failing files are this task's tests.
- `npm run build` — exit 0, re-run outside the producer sandbox after the
  binding change; `dist/cli/main.js` is newer than `src/`, so
  `staleBuildMessage` no longer refuses `review` (`src/cli/main.ts:421-427`).
- `NODE_NO_WARNINGS=1 npm test` (2026-09-04, unsandboxed operator session) —
  524 tests, 524 pass, 0 fail. The 11 earlier failures were the producer
  sandbox, not this change.
- `spartan-bridge doctor --repo .` after the binding change — `policy:
  configured; resolves`; `binding reviewer.plan: adapter available;
  launcher=codex-plan-reviewer-v1`; `binding reviewer.implementation: adapter
  available; launcher=claude-plan-reviewer-v1`; `binding implementer: adapter
  unavailable; reason=capability_denied`, because no Codex producer adapter
  exists (`producerCapabilities` is implemented only in
  `src/adapters/cursor.ts`, `src/adapters/grok.ts`, and
  `src/adapters/fake.ts`). Implementer correction rounds for this task are
  therefore human-started, which is outside this plan's subject and does not
  change its decisions.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-0e92d20d-90f9-4b60-9099-7c8f5ec3f03a execution_id=exec-79b1b109-9189-445d-ab33-25f5d25835bc review_kind=plan verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-opus-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:5a74e728a1985947915bf18ad1f0bb996d8f60b76b5ef05870e614ae8c0b8a56 task_hash=sha256:b3f2231bdf1d6efd68f6fe64e4c23cd0bc8902ef37c42d8ef80da6958ef47692 agents_hash=sha256:6398b6b75b56e94e3e08b8f9ca755b326d8c0c8f32a08d5bce92568138c3b916 timestamp=2026-09-04T08:43:40.533Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-974ed3c2-92c2-4a3d-9cc2-ce53beb7cfc0 execution_id=exec-7223b8c4-6f39-482e-ba45-3239c11501f5 review_kind=implementation verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-opus-5 effort=high model_observed=declared_unobserved policy_digest=sha256:e363264f72a848d870898b8d1d1abe453a4f1e519f622f4415d9531d867023f6 task_hash=sha256:49f783011be1f79556dc07fdb90d8cbed323305907b4263cd89c78ab678adcbf agents_hash=sha256:ccf9e4492d47f2f21094b8ba345a4de0bca024275d307956d1ffcf712131a220 timestamp=2026-09-04T09:37:44.808Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None.

## Next Action

None — task completed. `spartan-bridge policy --repo <root> --role
<planner|implementer>` ships; this checkout stays on the default `advisory`
mode because it declares no `producer` section (D7).

## Next Handoff

No outstanding handoff. Task completed on human-operator sign-off.
