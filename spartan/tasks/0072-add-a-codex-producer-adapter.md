---
protocol: "1.1.0" # x-release-please-version
id: add-a-codex-producer-adapter
created_at: 2026-09-04
status: completed
phase: complete
task_type: implementation
risk: high-impact
current_role: human-operator
next_role: none
updated_at: 2026-09-05
handoff_id: HX-005
next_handoff_id: none
---

# Add a Codex producer adapter so an `implementer` binding on Codex can auto-chain

## Objective

An `AGENTS.md` `implementer` binding that names Codex resolves to a working
producer adapter: `spartan-bridge doctor` reports it available, and a persisted
`reviewer.plan: pass` starts a mapped `codex exec` implementer round in the
authorized write scope, whose declaration the Bridge validates and whose
implementation review it then dispatches — the same chain Cursor and Grok
already complete.

## Context

`src/adapters/codex.ts` implements only the reviewer half of the adapter
contract. `ProducerAdapter` (`src/adapters/adapter.ts:29-49`) is implemented in
`src/adapters/cursor.ts`, `src/adapters/grok.ts`, and `src/adapters/fake.ts`
only. `isProducerAdapter` (`src/adapters/adapter.ts:51-63`) is a structural
check over eight methods, and both call sites fail closed without them:

- `src/core/doctor.ts:526-543` reports the `implementer` binding
  `capability_denied`.
- `src/core/transition.ts:396` refuses the plan-pass successor for the same
  reason, so the auto-chain stops for the human.

On 2026-09-04 the operator remounted the binding table onto Codex after the
Grok account balance was exhausted mid-chain. `doctor` on that table returns:

```text
binding reviewer.plan: adapter available; launcher=codex-plan-reviewer-v1
binding reviewer.implementation: adapter available; launcher=claude-plan-reviewer-v1
binding implementer: adapter unavailable; reason=capability_denied
```

The launcher already resolves and the reviewer half already runs; only the
producer methods are missing. The catalog resolves one adapter object per
launcher id, so the eight methods land on the existing `CodexAdapter` class
rather than in a new file.

**The argv was the substance of this task, and D1 has now settled it by
measurement.** The Grok adapter records, in a comment above
`GROK_PRODUCER_ARGV_SUFFIX` (`src/adapters/grok.ts:79-85`), that a producer
already runs under the Bridge's own Darwin `sandbox-exec` profile from
`applyProducerWriteScope`, and that the client's own seatbelt profiles then
"fail to initialize inside that outer profile (`Operation not permitted`) and
the child exits 1 before any turn". Grok's answer was `--sandbox none`. Codex's
sandbox values are `read-only | workspace-write | danger-full-access`
(`codex exec --help`, codex-cli 0.153.3), and the reviewer half pins
`--sandbox read-only` in `CODEX_REVIEW_ARGV_HEAD` (`src/adapters/codex.ts:43-50`).
The measurement recorded under D1 shows Codex fails the same way as Grok under
`workspace-write` but in a **quieter** shape — the turn runs to completion and
the process exits 0 while every repository write is refused — and that
`danger-full-access` produces the writable non-interactive round, with the
Bridge's own outer profile still denying every out-of-scope path under the
repository root.

## Scope

- `src/adapters/codex.ts` — the eight `ProducerAdapter` methods on the existing
  class, mirroring `src/adapters/grok.ts:493-618`: `producerCapabilities`,
  `producerPreflight`, `lockProducerWriteScope`, `startProducer`,
  `waitProducer`, `releaseProducerWriteScope`, `cancelProducer`,
  `cleanupProducer`. New producer argv tables added to
  `CODEX_CONSTANT_ARGV_TABLES`, a `codexProducerCapabilities()` mirroring
  `grokProducerCapabilities` (`src/adapters/grok.ts:204-213`), a producer
  timeout constant, a `sandbox-exec` probe pair, and a
  `composeCodexProducerPrompt` mirroring `composeGrokProducerPrompt`
  (`src/adapters/grok.ts:168-182`) — the prompt the Bridge validates as the
  producer declaration.
- `docs/ROUTING-AND-WORKFLOWS.md` — the per-host `Model` / `Effort` table at
  lines 73-78 carries a "Reviewer-eligible" column but no producer column; say
  which hosts can hold `implementer`.
- `docs/DECISIONS.md` — one dated `D-070` entry for the sandbox-composition
  measurement (D1), the Codex counterpart of D-042's `--sandbox none` finding.
- `docs/AUTHENTICATION-AND-SECURITY.md` — a "What the Bridge forwards to Codex"
  subsection beside the existing Grok (line 181) and Claude Code (line 187)
  ones, which line 122 already cross-references for Codex without such a
  section existing. It records the Codex producer sandbox value and the
  `sandbox-exec` producer preflight.
- Tests: `tests/codex-adapter.test.ts` (producer argv composition, forbidden-token
  audit, producer preflight, the write-scope guard lock/release order,
  the timeout override) and `tests/doctor.test.ts` (the `implementer` binding
  line for a Codex binding).

## Out of Scope

- A Claude Code producer adapter. Same shape, separate task; `planner` rounds
  are human-started, so a Claude Code `planner` binding needs no adapter.
- The stale-`dist` chain defect — task `0070`, shipped. See Blockers.
- Producer isolation onto a Bridge-owned copy — task `0053`. See Blockers.
- Changing `applyProducerWriteScope`, `producerWriteScopeSandboxProfile`, the
  writer lock, the declaration validator, or the transition state machine. This
  adapter satisfies the existing contract; it does not renegotiate it.
- Observing which model the Codex child actually ran. `observedModel()`
  (`src/adapters/codex.ts:463-465`) stays as the reviewer half already has it.
- Removing `--dangerously-bypass-approvals-and-sandbox` or `--full-auto` from
  `CODEX_FORBIDDEN_ARGV_TOKENS`. D1 needed neither.
- `tests/producer-declaration.test.ts` and `tests/producer-write-scope.test.ts`.
  Verified: neither imports or enumerates an adapter module, so neither changes.
- Changing `CODEX_HELP_TOKENS` or the nine-token preflight assertion. D2's argv
  needs no token the reviewer half does not already probe.

## Constraints

- English artifact.
- Direct process spawning with argument arrays, no shell interpolation.
- No credential, token, or account value enters argv, env, or logs. The env
  allowlist stays `CODEX_ENV_ALLOWLIST` (`src/adapters/codex.ts:77`) as it is;
  `CODEX_HOME` is forwarded, never originated (D-055).
- Every producer argv token passes the existing forbidden-token audit
  (`tests/codex-adapter.test.ts:138-157`).
- The producer round remains confined by the Bridge's own repository
  write-scope guard, whatever the client's sandbox flag says — that guard, not
  the flag, is the boundary. That boundary is repository-local by design:
  `producerWriteScopeSandboxProfile` denies `file-write*` only under the
  canonical repository root and leaves everything above it on `(allow default)`
  so the official client can start (`src/adapters/producer-write-scope.ts:31-45`).
  No artifact text, prompt text, or documentation sentence added by this task may
  state or imply a machine-wide write boundary. D1's escape measurement is the
  evidence for both halves of that claim under `danger-full-access`.
- `tests/host-review-permissions-docs.test.ts:36` asserts
  `docs/AUTHENTICATION-AND-SECURITY.md` matches neither `dangerously-bypass`
  nor `bypassPermissions`. The new Codex subsection in that file must therefore
  name `danger-full-access` without naming the bypass flag; the contrast
  between the two belongs in `docs/DECISIONS.md`, which no test constrains.
- `tests/host-review-permissions-docs.test.ts:39-59` asserts the routing
  guide's argv table against the adapter constants. The new `implementer`
  column must leave every asserted string intact.
- `SCHEMA_VERSION` stays `2`; `ProducerCapabilities` gains no field.
- `npm run typecheck` clean and `npm test` no new failure against the 529-pass
  baseline recorded in Evidence — both inside the automatic write scope.
  `npm run build` writes `dist/`, which is outside that scope, so it belongs to
  the human bootstrap step rather than to the implementation round; see
  acceptance criteria 16 and 17 and the first Blockers note.

## Decisions

- **D1 (settled by measurement) — the producer sandbox value is
  `--sandbox danger-full-access`, with no approval-policy config.**

  Three probes, all on Darwin 25.3.0 with codex-cli 0.153.3, each spawning
  `codex exec` through `createNodeProcessRunner` with
  `sandboxProfile: guard.sandboxProfile` from a real `applyProducerWriteScope`
  over a scratch repository whose admitted scope was `["src/", "spartan/tasks/"]`
  — the same composition `GrokAdapter.startProducer` uses
  (`src/adapters/grok.ts:562-579`):

  1. **`--sandbox workspace-write`: no write, and no failure signal.** The turn
     completed, the `file_change` item for the *admitted* path `src/probe.txt`
     ended `"status":"failed"`, the model reported *"the workspace sandbox
     rejected write operations with `Operation not permitted`"*, stderr carried
     `ERROR codex_core::tools::router: error=Exit code: 1` and
     `Failed to write file .../src/probe.txt`, and **`codex exec` exited 0**
     with the file absent. A control run proved the outer profile is not the
     cause: `sandbox-exec -p <same profile> /bin/sh -c 'echo ok > src/probe.txt'`
     wrote successfully, and the same shell against `AGENTS.md` returned
     `Operation not permitted`. The denial is Codex's own inner seatbelt failing
     to compose inside the Bridge's outer profile — the same class as D-042, but
     Grok exits 1 in about two seconds whereas Codex spends a whole turn and
     exits 0.
  2. **`--sandbox danger-full-access`: writable.** Identical argv otherwise. The
     `file_change` item ended `"status":"completed"`, `codex exec` exited 0, and
     `src/probe.txt` held `"ok\n"`. No approval prompt, no `--config
     approval_policy=`, and no `--approve-for-me`; `codex exec` is
     non-interactive and `codex exec --help` exposes no `--ask-for-approval`.
  3. **The outer profile still holds under `danger-full-access`.** A third probe
     asked the child to shell out to two writes. The out-of-scope repository
     write returned
     `zsh:1: operation not permitted: AGENTS.md` with exit code 1 and left
     `AGENTS.md` byte-identical; the machine-local write outside the repository
     root (`touch /tmp/spartan-d1-escape-probe.txt`) succeeded, which is what
     `(allow default)` intends and matches Grok's `--sandbox none` posture.

  **Pinned:** `--sandbox danger-full-access`. It is not in
  `CODEX_FORBIDDEN_ARGV_TOKENS` (`src/adapters/codex.ts:57-63`), which names
  `--full-auto` and `--dangerously-bypass-approvals-and-sandbox` and neither of
  which this decision touches; the audit is exact array membership, not a
  substring match, so `danger-full-access` passes it unchanged. Repository write
  confinement stays the three existing layers — the POSIX mode lock, the
  Bridge-owned `sandbox-exec` profile, and the post-child snapshot — exactly as
  `docs/AUTHENTICATION-AND-SECURITY.md:629` already claims and probe 3 now
  demonstrates for Codex.

  **Consequence the implementer must not lose:** had `workspace-write` been
  chosen, its failure would have been silent at the process boundary. Exit 0
  with an unchanged artifact reaches
  `src/core/transition.ts:801-809` and stops as `producer_declaration_invalid`
  with `declaration_invalid_detail: "artifact_unchanged"` — never
  `exit_nonzero`. That is why D1 is a measurement rather than a flag-name
  argument, and why the D-070 entry records the exit code alongside the denial.

  **Residual, stated not closed:** `--ephemeral` does not imply
  `--ignore-user-config`, so `$CODEX_HOME/config.toml` is still layered under
  the producer the same way it already is under the reviewer. An operator
  config that changed sandbox or approval behaviour would affect both halves
  identically. This task neither reads nor overrides that file.

- **D2 (settled) — two new producer argv tables; the producer does not reuse
  `CODEX_REVIEW_ARGV_HEAD`.**

  ```text
  CODEX_PRODUCER_ARGV_HEAD = ["exec", "--skip-git-repo-check", "--ephemeral",
                              "--sandbox", "danger-full-access", "--cd"]
  CODEX_PRODUCER_ARGV_AFTER_WORKSPACE = ["--json", "--color", "never"]
  ```

  `CODEX_REVIEW_ARGV_HEAD` pins `--sandbox read-only` and cannot be shared.
  `composeCodexProducerArgv({ repoRoot, model, effort, taskPath,
  approvedPlanRunId, writeScope })` returns

  ```text
  [...CODEX_PRODUCER_ARGV_HEAD, repoRoot,
   "--config", composeCodexEffortConfig(effort),
   "--config", composeCodexModelConfig(model),
   ...CODEX_PRODUCER_ARGV_AFTER_WORKSPACE,
   composeCodexProducerPrompt(taskPath, approvedPlanRunId, writeScope)]
  ```

  mirroring `composeCodexReviewArgv` (`src/adapters/codex.ts:155-178`) with the
  prompt last as the `[PROMPT]` positional.

  - **Model and Effort compose exactly as the reviewer's do**, reusing
    `composeCodexEffortConfig` and `composeCodexModelConfig`
    (`src/adapters/codex.ts:140-153`) unchanged: `--config model="<id>"` and
    `--config model_reasoning_effort="<level>"`, with `max` sent as `xhigh`
    (D-025). No effort level is branched away: `none` is sent as
    `model_reasoning_effort="none"`, matching the reviewer and the existing
    assertion at `tests/codex-adapter.test.ts:170-190`.
  - **Kept:** `--ephemeral` (no persisted session; matches `fresh_context: true`),
    `--skip-git-repo-check` (harmless today, and required once `0053` spawns
    against a Bridge-owned copy that is not a Git repository), `--cd <repoRoot>`,
    `--json`, `--color never`.
  - **Omitted:** `--output-schema` and `--output-last-message`. Producer stdout
    is not structured authority — the declaration in the task artifact is — so
    the producer writes neither file and `waitProducer` reads only the exit
    code, mirroring `src/adapters/grok.ts:587-601`. `--add-dir` is omitted: the
    admitted scope is expressed by the Bridge profile, not by a client flag.
  - **Both tables are appended to `CODEX_CONSTANT_ARGV_TABLES`
    (`src/adapters/codex.ts:52-56`) after the existing three**, so the
    forbidden-token audit covers them while `tokens[0] === "exec"`
    (`tests/codex-adapter.test.ts:144`) still reads from `CODEX_PROBE_ARGV`.
    The `sandbox-exec` probe argv from D3 stays out of that list, matching
    `GROK_CONSTANT_ARGV_TABLES` (`src/adapters/grok.ts:93-99`), which excludes
    `GROK_SANDBOX_EXEC_PROBE_ARGV`.
  - **`CODEX_HELP_TOKENS` is unchanged.** Every long-form token the producer
    argv emits — `--skip-git-repo-check`, `--ephemeral`, `--sandbox`, `--cd`,
    `--config`, `--json`, `--color` — is already a member of the nine-token set
    at `src/adapters/codex.ts:84-94`. The producer's set is a strict subset, so
    the review-argv equality assertion at `tests/codex-adapter.test.ts:159-168`
    and the nine-token preflight test at `tests/codex-adapter.test.ts:527` both
    stand unmodified, and the producer gets a subset assertion rather than an
    equality one.

- **D3 (settled) — producer preflight mirrors Grok's; a non-Darwin host gets
  `interface_unrecognized` at the adapter and `interface_unavailable` at
  `doctor`.**

  `producerPreflight()` runs `await this.preflight()` (the existing
  `codex exec --help` nine-token probe, `src/adapters/codex.ts:221-256`) and then
  a private `verifySandboxExecInterface()` copied in shape from
  `src/adapters/grok.ts:502-531`. The guard depends on `sandbox-exec` actually
  confining the child; without it the chmod-based POSIX layer alone is not
  fail-closed, which is why the probe is a producer-only step.

  New constants, per-adapter as Grok (`grok.ts:120-121`) and Cursor
  (`cursor.ts:144-145`) each already have their own:

  ```text
  CODEX_SANDBOX_EXEC_PROBE_PROFILE = "(version 1)\n(allow default)\n"
  CODEX_SANDBOX_EXEC_PROBE_ARGV = ["-p", CODEX_SANDBOX_EXEC_PROBE_PROFILE, "/usr/bin/true"]
  ```

  Off Darwin, `verifySandboxExecInterface` throws **before spawning anything**,
  with `fail("preflight", "interface_unrecognized", null, Buffer.alloc(0),
  "codex_preflight_failed")` — the same cause, phase and message shape Grok uses
  at `src/adapters/grok.ts:503-505`, with the Codex message token.
  `src/core/doctor.ts:538-542` catches any throw from `producerPreflight` and
  reports `unavailable(binding, "interface_unavailable")`, so the operator-facing
  line on a non-Darwin host is
  `binding implementer: adapter unavailable; reason=interface_unavailable`.
  Both names matter and neither replaces the other: `interface_unrecognized` is
  the `AdapterFailureCause`, `interface_unavailable` is the
  `BindingUnavailableReason` (`src/core/doctor.ts:47`).

  `producerCapabilities()` returns a new `codexProducerCapabilities()` mirroring
  `src/adapters/grok.ts:204-213`: `schema_version: SCHEMA_VERSION`,
  `launcher_id: CODEX_LAUNCHER_ID`, `roles: ["implementer"]`,
  `permission_modes: [WORKSPACE_WRITE_PERMISSION_MODE]`, `workspace_write: true`,
  `fresh_context: true` — the exact object `producerCapabilitiesAllowed`
  (`src/adapters/adapter.ts:141-154`) admits. The class declaration becomes
  `implements Adapter, ProducerAdapter` and gains the two private fields
  `producerHandle` and `producerWriteGuard`, as at `src/adapters/grok.ts:263-264`.
  `cleanupProducer()` is separate from the existing reviewer `cleanup()`; neither
  calls the other.

- **D4 (settled) — `composeCodexProducerPrompt` is `composeGrokProducerPrompt`
  with one sentence rewritten, and one word in the do-not list.**

  Same signature `(taskPath, approvedPlanRunId, writeScope)` and same
  backtick-quoted scope list as `src/adapters/grok.ts:168-182`. Everything
  keeps Grok's wording: the opening authorization sentence, the explicit task
  path and approved plan run id, the four declaration values (`task_type`
  implementation, `phase` reviewing, `current_role` implementer, `next_role`
  reviewer) plus "regenerate one coherent implementation-review handoff", the
  external-action prohibition, "Do not invoke Spartan Bridge", and the closing
  "Producer stdout is not structured authority. Exit 0 when the declaration
  above is written."

  Two changes, both forced by D1:

  1. Grok's "The adapter-enforced writable sandbox admits only this closed
     automatic write scope" is **false for Codex**, whose own sandbox is off
     under `danger-full-access`. It becomes: "The enclosing Bridge sandbox
     admits only this closed automatic write scope within this repository",
     with the same scope list.
  2. One sentence is added after the denied-path list: **a write to a repository
     path outside that scope** fails with `Operation not permitted`; treat that
     as the boundary working as intended, do not attempt to work around it, and
     do not `chmod` a path to make it writable. D1's probe 3 showed the model
     reports such a denial verbatim and stops, which is the wanted behaviour;
     naming it makes that the expected outcome rather than a surprise the round
     spends a turn on.

     The qualifier "repository path" is load-bearing and must survive into the
     shipped prompt text. The Bridge profile is a repository write-scope guard,
     not a whole-machine jail: probe 3 also showed a write **outside the
     repository root** (`/tmp`) succeeding under `(allow default)`, which is
     deliberate — the official client needs `$HOME` and `$TMPDIR` to start
     (`src/adapters/producer-write-scope.ts:31-45`). An unqualified "any write
     outside the scope is denied" would state a machine-wide guarantee the
     Bridge does not make and the measurement disproves. The prohibition on
     writing outside the repository stays where Grok already puts it — the
     instruction not to expand scope — which is an instruction to the round,
     not a claim about what the sandbox enforces.

  Grok's "Do not invoke Spartan Bridge" stays as written and is not narrowed:
  the Codex client is the one host whose `~/.codex/rules/default.rules` this
  repository pre-authorizes for `spartan-bridge review`
  (`docs/AUTHENTICATION-AND-SECURITY.md:513-521`), so the prohibition matters
  more here than it does for Grok, not less.

- **D5 (settled) — `CODEX_PRODUCER_TIMEOUT_MS = BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS`,
  overridable by `input.producer_timeout_ms`.**

  Codex reuses the shared default exactly as Grok
  (`src/adapters/grok.ts:125`) and Cursor (`src/adapters/cursor.ts:149`) do:
  `BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS` is `2_700_000`
  (`src/core/contracts.ts:13`). `startProducer` passes
  `timeoutMs: input.producer_timeout_ms ?? CODEX_PRODUCER_TIMEOUT_MS`, matching
  `src/adapters/grok.ts:575`, and `stdoutCapBytes: CODEX_REVIEW_STDOUT_CAP`
  with `retainStdout: true`, matching `src/adapters/grok.ts:576-577`. No stream
  parser is attached: `observeStream` is a reviewer-only concern.

  `implementer_timeout_ms` reaches that parameter through the existing path,
  unchanged by this task:

  ```text
  spartan-bridge/config.yaml implementer_timeout_ms
    -> resolveProducerTimeoutMs(config, BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS)   src/policy/bridge-config.ts:28-33
    -> const producerTimeoutMs = ...                                          src/core/transition.ts:354
    -> producer_timeout_ms: input.producerTimeoutMs                           src/core/transition.ts:738
    -> AdapterProducerInput.producer_timeout_ms                               src/core/contracts.ts:427
  ```

  `resolveProducerTimeoutMs` returns `Math.max(defaultMs, implementer_timeout_ms)`,
  so operational config can only raise the ceiling, never lower it below the
  shared default. The adapter adds no clamp of its own.

## Acceptance Criteria

Derived from D1-D5 above.

1. **(D1, D2)** `CODEX_PRODUCER_ARGV_HEAD` contains `--sandbox` immediately
   followed by `danger-full-access`, and contains neither `read-only` nor
   `workspace-write`. A spawn-level stub test in `tests/codex-adapter.test.ts`,
   modelled on `tests/grok-adapter.test.ts:275-344`, asserts the whole producer
   argv, `executable === CODEX_EXECUTABLE`, `cwd === input.repo_root`,
   a non-empty `sandboxProfile` string, `env.CODEX_HOME` forwarded, and a
   credential-shaped parent variable absent.
2. **(D2)** The forbidden-token audit at `tests/codex-adapter.test.ts:138-157`
   passes with both producer tables in `CODEX_CONSTANT_ARGV_TABLES`, and
   `tokens[0] === "exec"` still holds. `CODEX_FORBIDDEN_ARGV_TOKENS` is
   unchanged, `--full-auto` and `--dangerously-bypass-approvals-and-sandbox`
   appear in no producer table, and the producer argv is separately asserted to
   include neither.
3. **(D2)** Every long-form token in the composed producer argv is a member of
   `CODEX_HELP_TOKENS`. `CODEX_HELP_TOKENS` still has nine entries, and both
   `tests/codex-adapter.test.ts:159-168` and `:527-565` pass unmodified.
4. **(D2)** For every member of `EFFORT_LEVELS`, the producer argv carries the
   same `--config model_reasoning_effort="<level>"` pair the review argv
   carries, with `max` sent as `xhigh`, plus `--config model="<id>"`.
5. **(D3)** `isProducerAdapter(new CodexAdapter())` is `true`, and
   `producerCapabilitiesAllowed(codexProducerCapabilities())` is `true` with
   `launcher_id === CODEX_LAUNCHER_ID`.
6. **(D3)** `producerPreflight()` on a non-Darwin `process.platform` rejects
   without spawning `sandbox-exec`, mirroring
   `tests/grok-adapter.test.ts:477-496`; on Darwin it spawns `codex exec --help`
   then `/usr/bin/sandbox-exec`, in that order, mirroring
   `tests/grok-adapter.test.ts:498-512`.
7. **(D3)** `tests/doctor.test.ts` covers a Codex `implementer` binding: an
   available adapter reports
   `binding implementer: adapter available; launcher=codex-plan-reviewer-v1`,
   and a `producerPreflight` that throws reports
   `binding implementer: adapter unavailable; reason=interface_unavailable`.
8. **(D3)** `spartan-bridge doctor --repo .` on this repository's current
   `AGENTS.md` prints
   `binding implementer: adapter available; launcher=codex-plan-reviewer-v1`,
   replacing the `reason=capability_denied` line quoted in Context. Recorded in
   Evidence with the command and its output.
9. **(guard order)** The write-scope guard stays locked from
   `lockProducerWriteScope` through `waitProducer` and is released only by
   `releaseProducerWriteScope` or `cleanupProducer`, mirroring
   `tests/grok-adapter.test.ts:421-460`. `lockProducerWriteScope` is idempotent,
   and a `startProducer` spawn failure restores the guard before throwing, as
   at `src/adapters/grok.ts:580-584`.
10. **(D4)** `composeCodexProducerPrompt(taskPath, runId, scope)` contains the
    task path, the approved plan run id, each write-scope entry backtick-quoted,
    all four declaration frontmatter values, the `Operation not permitted`
    sentence from D4 change 2, "Do not invoke Spartan Bridge", and the
    "Producer stdout is not structured authority" line; and it does **not**
    contain the phrase "adapter-enforced writable sandbox".
11. **(D4)** The `Operation not permitted` sentence in that prompt is scoped to
    repository paths: a test asserts the sentence names a repository path (or
    equivalent in-repository qualifier) and that the prompt contains no
    unqualified claim that every write outside the admitted scope is denied.
    The prompt must not assert a machine-wide write boundary, because
    `producerWriteScopeSandboxProfile` denies only under the canonical
    repository root and D1 probe 3 recorded a successful `/tmp` write.
12. **(D5)** `CODEX_PRODUCER_TIMEOUT_MS === BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS`
    and is greater than `CODEX_REVIEW_TIMEOUT_MS`; an injected
    `producer_timeout_ms` reaches `SpawnRequest.timeoutMs` unchanged, mirroring
    `tests/grok-adapter.test.ts:346-382`.
13. **(docs)** `docs/ROUTING-AND-WORKFLOWS.md` states which hosts can hold an
    `implementer` binding, and `tests/host-review-permissions-docs.test.ts:39-59`
    still passes with every asserted string intact.
14. **(docs)** `docs/AUTHENTICATION-AND-SECURITY.md` gains a "What the Bridge
    forwards to Codex" subsection naming the closed `CODEX_ENV_ALLOWLIST`, the
    producer `--sandbox danger-full-access` value with the outer profile as the
    repository write boundary, and the `sandbox-exec` producer preflight. That
    boundary is stated as repository-local, consistent with
    `docs/AUTHENTICATION-AND-SECURITY.md:629`, which already records that direct
    writes to `$HOME` / `$TMPDIR` remain allowed. The file still matches
    neither `dangerously-bypass` nor `bypassPermissions`, so
    `tests/host-review-permissions-docs.test.ts:16-37` passes.
15. **(docs)** `docs/DECISIONS.md` gains a `D-070` entry dated 2026-09-04 in the
    `## D-0NN — <title> (task 0072)` form used by D-067 through D-069, recording
    all three D1 probes, the exit-0 shape of the `workspace-write` failure, and
    the `artifact_unchanged` consequence.
16. **(checks, inside the automatic write scope — the implementation round)**
    `npm run typecheck` and `npm test` exit 0, with no failure and no fewer than
    the 529 passes recorded in Evidence. Both are satisfiable without writing
    outside the scope: `tsconfig.json` sets no `incremental` or
    `tsBuildInfoFile`, so `tsc --noEmit` emits nothing, and `npm test` runs
    `node --import tsx --test tests/*.test.ts`, which loads `src/` directly.
    The suite needs a `dist/cli/main.js` to **exist** — asserted at
    `tests/producer-write-scope.test.ts:540-547` — but never a current one, so
    the checkout's existing `dist/` satisfies it.
17. **(checks, outside the automatic write scope — the human bootstrap step)**
    `npm run build` exits 0 and installs the new `dist/`. This is deliberately
    **not** an implementer criterion. `dist/` is gitignored (`.gitignore:8`),
    absent from `AGENTS.md:66-77`'s automatic implementation write scope, and
    absent from `SKIPPED_DIR_NAMES`, so it is locked to `0o555` by
    `applyProducerWriteScope` and denied by `producerWriteScopeSandboxProfile`
    for the duration of any Bridge-spawned producer round. Widening that scope
    is a human gate this task does not open. The human operator runs the build
    as the third step of the Blockers bootstrap sequence, and the criterion is
    satisfied by that round; a plan that assigned it to the producer would be
    unsatisfiable as written.

## Work Completed

- 2026-09-04 (human-operator, Claude Code, claude-opus-5, effort high): queued
  after the binding remount left `implementer` on Codex with no adapter.
  Verified against the working tree: the three files implementing
  `producerCapabilities`, the eight-method `isProducerAdapter` check and both
  its call sites, `CODEX_FORBIDDEN_ARGV_TOKENS`, `CODEX_REVIEW_ARGV_HEAD`,
  `CODEX_ENV_ALLOWLIST`, the `GROK_PRODUCER_ARGV_SUFFIX` comment, and
  `codex exec --help`.
- 2026-09-04 (planner, Claude Code, claude-opus-5, effort high): ran the D1
  measurement — three real `codex exec` rounds under a real
  `applyProducerWriteScope` guard plus two `sandbox-exec` control writes — and
  pinned D1 on the result. Pinned D2-D5 against the Grok and Cursor producer
  implementations and derived the acceptance criteria from them. Verified every
  path, symbol and line reference this artifact names, including the two test
  assertions that constrain the documentation edits
  (`tests/host-review-permissions-docs.test.ts:36` and `:39-59`) and the fact
  that `tests/producer-declaration.test.ts` and
  `tests/producer-write-scope.test.ts` enumerate no adapter, which removed both
  from Scope.
- 2026-09-04 (planner, Claude Code, claude-opus-5, effort high): revised
  against plan-review cycle 1 (`CHANGES_REQUESTED`, one warning
  `PROMPT_SCOPE_CONTRADICTION`, Codex / gpt-5.6-sol / high, run
  `run-18b285bb-01e4-43fc-afa2-7d8db9ab98e1`). The finding was correct: D4's
  new prompt sentence and criterion 10 asserted that a write outside the
  admitted scope fails, while D1 probe 3 recorded a successful `/tmp` write
  outside the repository root. Qualified the sentence to a repository path,
  added the reason the qualifier is load-bearing, added acceptance criterion 11
  to hold it, and aligned the Context sentence, the write-scope Constraint, and
  the documentation criterion on the same repository-local boundary. No other
  decision changed.
- 2026-09-04 (planner, Claude Code, claude-opus-5, effort high): revised
  against plan-review cycle 2 (`CHANGES_REQUESTED`, two errors, Codex /
  gpt-5.6-sol / high, run `run-0df05687-5395-4f52-9a25-ad1af255057f`). Both
  findings were correct and both were about execution, not design.
  `CODEX_BOOTSTRAP_CHAIN`: the plan claimed a pass would auto-start the mapped
  Codex implementer, which is exactly what `src/core/transition.ts:396` refuses
  until this task ships. Next Action and Blockers now state the full
  human-started bootstrap sequence and name `$spartan`, not `/spbridge`, for
  the implementation round. `BUILD_SCOPE_CONFLICT`: criterion 16 required
  `npm run build` from a round whose write scope excludes `dist/`. That
  criterion is split — 16 keeps `typecheck` and `test` for the implementation
  round with the evidence that neither writes outside the scope, and 17 assigns
  the build to the human bootstrap step. The Constraints line was rewritten to
  match. D1-D5 are unchanged.
- 2026-09-04 (implementer, Codex, gpt-5.6-sol, effort high, vendor OpenAI):
  added the eight `ProducerAdapter` methods to the existing Codex adapter,
  including the measured producer argv, repository-local Bridge prompt,
  producer-only `sandbox-exec` preflight, shared producer timeout, and
  write-scope guard lifecycle. Added Codex producer and doctor regressions,
  documented implementer eligibility and Codex forwarding, and recorded D-070.
  `dist/` remains untouched for the human bootstrap build before review.
- 2026-09-05 (human-operator, Claude Code, claude-opus-5, effort high): ran the
  bootstrap build and drove the implementation review to a verdict. `doctor`
  now reports `binding implementer: adapter available;
  launcher=codex-plan-reviewer-v1`, closing the Objective. Three review
  dispatches were spent before the verdict, none of them on the diff: two died
  `error_max_structured_output_retries` on a `summary` overrun (2028 then 2186
  characters against a 2000 cap no prompt mentioned) and one on a provider
  `429` session limit. The first two were closed by a separate commit that
  budgets `summary` in all eight reviewer prompts and shares both caps as
  constants (`e90c82e`, D-071); it landed ahead of this task deliberately, so
  this task's review diff stayed exactly its approved scope. The fourth
  dispatch passed on cycle 1 with no findings.

## Evidence

- `src/adapters/adapter.ts:29-63` — the eight-method `ProducerAdapter` type and
  the structural `isProducerAdapter` guard.
- `grep -rl producerCapabilities src/adapters/` — `cursor.ts`, `grok.ts`,
  `fake.ts`, and the `adapter.ts` declaration only. Not `codex.ts`.
- `src/core/doctor.ts:526-543` — the `implementer` branch returns
  `capability_denied` when `isProducerAdapter` is false, before any preflight,
  and `interface_unavailable` when `producerPreflight` throws.
- `src/core/transition.ts:396` — the same guard on the plan-pass successor.
- `spartan-bridge doctor --repo .` (2026-09-04, Codex-bound table) —
  `binding implementer: adapter unavailable; reason=capability_denied`, with
  both reviewer bindings available.
- `src/adapters/grok.ts:79-85` — the comment recording that a client's own
  seatbelt profile fails to initialize inside the Bridge's outer
  `sandbox-exec` profile, and that Grok answers with `--sandbox none`.
- `src/adapters/codex.ts:43-50` — `CODEX_REVIEW_ARGV_HEAD` pins
  `--sandbox read-only` for the reviewer half.
- `src/adapters/codex.ts:57-63` — `CODEX_FORBIDDEN_ARGV_TOKENS` contains
  `--dangerously-bypass-approvals-and-sandbox` and `--full-auto`.
- `codex exec --help` (codex-cli 0.153.3, 2026-09-04) —
  `-s, --sandbox <SANDBOX_MODE>` accepts `read-only`, `workspace-write`,
  `danger-full-access`; there is no `--ask-for-approval`; `-C, --cd`,
  `--add-dir`, `--ephemeral`, `--skip-git-repo-check`, `--ignore-user-config`,
  `--json`, `--color`, `-o`, `--approve-for-me` exist. `--full-auto` is not an
  `exec` flag.
- **D1 probe 1** — `codex exec --skip-git-repo-check --ephemeral --sandbox
  workspace-write --cd <scratch-repo> --json --color never "<write
  src/probe.txt>"`, spawned through `createNodeProcessRunner` with the real
  `applyProducerWriteScope(["src/", "spartan/tasks/"])` profile. Exit 0, signal
  null, not timed out. Stdout carried
  `{"type":"item.completed","item":{"id":"item_1","type":"file_change",...,"status":"failed"}}`
  and the model text
  `Unable to create the file: the workspace sandbox rejected write operations with "Operation not permitted."`.
  Stderr carried
  `ERROR codex_core::tools::router: error=Exit code: 1` followed by
  `Failed to write file <scratch-repo>/src/probe.txt`. `src/probe.txt` absent
  (`ENOENT`).
- **D1 control** — under the same generated profile,
  `sandbox-exec -p <profile> /bin/sh -c 'echo ok > <repo>/src/control.txt'`
  wrote `ok`; the same command against `<repo>/AGENTS.md` returned
  `/bin/sh: <repo>/AGENTS.md: Operation not permitted`. The outer profile
  therefore permits the admitted path and denies the authority path, so probe
  1's denial is the Codex inner seatbelt, not the Bridge profile.
- **D1 probe 2** — identical argv with `--sandbox danger-full-access`. Exit 0,
  `file_change` item `"status":"completed"`, and `src/probe.txt` read back as
  `"ok\n"`. No approval prompt and no approval-policy flag.
- **D1 probe 3 (escape)** — same flags, prompt asking the child to shell out to
  two writes. `/bin/zsh -c "printf '%s\n' ESCAPED >> AGENTS.md"` completed with
  `"exit_code":1` and `aggregated_output` `zsh:1: operation not permitted: AGENTS.md`;
  `AGENTS.md` was byte-identical afterwards. `/bin/zsh -c 'touch
  /tmp/spartan-d1-escape-probe.txt'` completed with `"exit_code":0`, the
  intended `(allow default)` behaviour off the repository root.
- `src/core/transition.ts:801-809` — an exit-0 producer whose artifact hash is
  unchanged stops as `producer_declaration_invalid` with
  `declaration_invalid_detail: "artifact_unchanged"`.
- `src/adapters/grok.ts:168-182` — `composeGrokProducerPrompt`, the reference
  producer declaration text; `:204-213` — `grokProducerCapabilities`;
  `:493-618` — the eight producer methods; `:502-531` —
  `verifySandboxExecInterface`.
- `src/policy/bridge-config.ts:28-33`, `src/core/transition.ts:354` and `:738`,
  `src/core/contracts.ts:13` and `:427` — the `implementer_timeout_ms` path.
- `tests/host-review-permissions-docs.test.ts:36` —
  `assert.doesNotMatch(guide, /dangerously-bypass|bypassPermissions/)` over
  `docs/AUTHENTICATION-AND-SECURITY.md`; `:39-59` — the routing-guide argv
  table assertions.
- `grep -n "adapters" tests/producer-declaration.test.ts
  tests/producer-write-scope.test.ts` — only
  `producer-write-scope.ts` and `process.ts` imports; no adapter module is
  enumerated in either file.
- `npm run typecheck` (2026-09-04) — exit 0, no output.
- `npm test` (2026-09-04, `main` at `36297ae`) — `tests 529 / pass 529 / fail 0`.
- `AGENTS.md:66-77` — the automatic implementation write scope admits `src/`,
  `tests/` and `docs/`, so every path in this task's Scope is writable by a
  mapped implementer and the human-implementer rule at `AGENTS.md:145` does not
  apply.
- `npm run typecheck` (2026-09-04 implementation) — exit 0.
- `node --import tsx --test tests/codex-adapter.test.ts tests/doctor.test.ts
  tests/host-review-permissions-docs.test.ts` — 46 pass, 0 fail.
- `npm test` — 538 pass, 0 fail (nine more passes than the 529-pass baseline).
- `git diff --check` — exit 0.
- `node --import tsx src/cli/main.ts doctor --repo .` outside the current
  Codex harness sandbox — exit 0; `binding implementer: adapter available;
  launcher=codex-plan-reviewer-v1`. The first in-harness run correctly reported
  `interface_unavailable` because that outer harness refused nested
  `sandbox-exec`; the unsandboxed source run exercised the deployment shape.
- `npm run build` (2026-09-05, human-operator) — exit 0; criterion 17
  satisfied outside the automatic write scope, as planned.
- `spartan-bridge doctor --repo .` (2026-09-05, after the build) —
  `binding implementer: adapter available; launcher=codex-plan-reviewer-v1`.
  Criterion 8 satisfied; compare the `capability_denied` line in Context.
- `npm run typecheck` (2026-09-05) — exit 0. `npm test` — 540 pass, 0 fail.
  The count is above the 529 baseline by this task's regressions plus D-071's.
- Plan review: `run-dfae1160-52f9-4148-9a7d-ac95a27e64df`, `pass`, cycle 3 of 3
  (two earlier cycles each found one real defect).
- Implementation review: `run-adb267a2-3274-4a6d-9491-0f62206e137a`, `pass`,
  cycle 1, no findings, Claude Code / claude-opus-5 / high.
- Discarded dispatches, kept as the record of what the verdict cost:
  `run-e91670d5-a6a5-43e2-8145-afb7dd363875` and
  `run-4299c737-8940-495c-b548-84a96bdb0d8a` (`adapter_error` /
  `error_max_structured_output_retries`, summary 2028 and 2186), and
  `run-2ef91c9d-96d1-4a1b-97f0-e7a3212602d2` (`adapter_error`, cause
  `provider_limit`, `http_status: 429`, session limit). The third reached
  `num_turns: 25` without a schema rejection, which is the evidence that
  `e90c82e` worked.

## Review
<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-dfae1160-52f9-4148-9a7d-ac95a27e64df execution_id=exec-cd947533-7590-488d-a2b6-abb21dc7638d review_kind=plan verdict=pass reason_code=review_passed host=codex launcher=codex-plan-reviewer-v1 model=gpt-5.6-sol effort=high model_observed=declared_unobserved policy_digest=sha256:c032b4cea31dd45976e0e4d6a6b689590f1f0a1a368378fd8a82e546eb9525a3 task_hash=sha256:71767de71485c92427510b4201ac0459ddbdf8790f12481178c1ff3958613ee2 agents_hash=sha256:ccf9e4492d47f2f21094b8ba345a4de0bca024275d307956d1ffcf712131a220 timestamp=2026-09-04T23:40:41.091Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-adb267a2-3274-4a6d-9491-0f62206e137a execution_id=exec-4b599e18-c0ac-4199-8244-32f401c3b056 review_kind=implementation verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-opus-5 effort=high model_observed=declared_unobserved policy_digest=sha256:e363264f72a848d870898b8d1d1abe453a4f1e519f622f4415d9531d867023f6 task_hash=sha256:214c3ef26d336a54424361c34c7647bc7932a8b213cb650e26f82b4367722116 agents_hash=sha256:ccf9e4492d47f2f21094b8ba345a4de0bca024275d307956d1ffcf712131a220 timestamp=2026-09-05T05:02:26.204Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None blocking. Three notes on sequence, the first of which governs the remaining
bootstrap and review.

- **This task cannot use the auto-chain it creates. Its implementation round was
  human-started in Codex, and `dist/` still needs the planned human bootstrap
  build before review.** On a plan-review pass the Bridge writes
  `next_role: implementer` (`PLAN_REVIEW_NEXT_ROLE.pass`,
  `src/core/task-write.ts:91-94`) and then attempts the mapped successor. That
  successor resolves `codex-plan-reviewer-v1`, fails `isProducerAdapter`
  (`src/core/transition.ts:396` — the very gap this task closes), and returns
  `reviewResult(plan)`: the run terminates `review_passed` with
  `transition_id: null` and no producer starts. `AGENTS.md:64` requires exactly
  that stop. `spartan-bridge doctor` will still print
  `binding implementer: adapter unavailable; reason=capability_denied` at that
  moment, so the human opens Codex with `$spartan` — not `/spbridge` — for the
  implementation round, and that round's own review is manual too. Only after
  the human runs `npm run build` does a subsequent `/spbridge` round have a
  `dist/` in which this adapter exists. The bootstrap sequence is therefore:
  plan-review pass -> human-started `$spartan` implementation in Codex ->
  human `npm run build` -> human-started review of the diff -> from the next
  task onward, Codex auto-chains. The implementation and source-level checks
  are now complete; the build and review remain. Nothing in this task may be
  written as though the chain were already available to this task.
- **Task `0070` shipped** on 2026-09-04 (`36297ae`). A chain that edits `src/`
  still leaves `dist/` stale and the next `review` still refuses — D-069 kept
  D-031 intact deliberately — but `wait` now names the rebuild at the end of
  the chain, so the requirement is announced rather than discovered. That is
  D-069's D5 and is a standing consequence for every future Codex auto-chain in
  this repository, not a defect of this adapter and not something this adapter
  changes.
- **This plan is written *before* task `0053`, not on top of it.**
  `startProducer` targets `input.repo_root`, exactly as
  `src/adapters/grok.ts:574` and `src/adapters/cursor.ts:714` do today, and
  `lockProducerWriteScope` applies `applyProducerWriteScope(repoRoot,
  writeScope)` against that same live worktree. `0053` moves the producer onto
  a Bridge-owned copy of the admitted scope and repoints
  `applyProducerWriteScope` at it; `startProducer` is the one method that
  changes. `0053` must already rewrite that method in the Cursor and Grok
  adapters, so a third adapter written to today's contract adds one more small
  edit inside `0053` rather than a rewrite of this task's work. D1-D5 are
  unaffected by the order: the sandbox composition, the argv, the preflight,
  the prompt and the timeout are identical whichever root the producer is
  given.

## Next Action

None. The task is complete: both reviews are `APPROVED`, every acceptance
criterion is satisfied with a recorded outcome, and no blocker remains.

## Next Handoff

No outstanding handoff. Task completed on the implementation-review pass.

Non-binding suggestion. Task `0053` is the natural successor: it moves the
producer onto a Bridge-owned copy of the admitted scope, and it now has three
adapters to repoint rather than two. Task `0071` also gained material from this
task's failures and should be re-read before it is planned — its own excerpt
evidence narrows D1, and D-071 already removed the one cause it had identified.
