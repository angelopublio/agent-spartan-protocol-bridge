---
protocol: "1.1.0" # x-release-please-version
id: a-real-claude-reviewer-and-schema-forced-output
created_at: 2026-08-30
status: completed
phase: complete
task_type: implementation
risk: high-impact
current_role: reviewer
next_role: none
updated_at: 2026-08-30
handoff_id: HX-004
next_handoff_id: none
---

# A real Claude Code reviewer, and no reviewer the CLI does not schema-constrain

## Objective

`personal.claude` resolves to a real `claude-plan-reviewer-v1` launcher backed by
a new `src/adapters/claude.ts` that spawns `claude -p --output-format stream-json
--json-schema <inline>` so the review verdict is CLI-forced JSON and the review
streams live progress. Grok's existing adapter also passes its
`--json-schema` flag. The Bridge refuses to dispatch a review through any adapter
that cannot guarantee schema-constrained output — today only Cursor — with a
clear reason, revisitable when the Cursor CLI grows the flag.

## Context

Task `0044` (D-043) established that Cursor Agent CLI has no schema-constrained
final-message mechanism: `--output-format json|stream-json` shapes the transport
envelope, not the assistant's last message, so the Bridge fails closed
`output_unparsable` whenever the model narrates instead of emitting the verdict
object. That failure mode has now blocked real work: the plan review of task
`0045` failed `output_unparsable` three times in a row with Cursor / composer-2.5,
and `0044`'s own motivating incidents were Cursor / `cursor-grok-4.5-medium-fast`
and `cursor-grok-4.6-high-fast` doing the same thing.

Verified 2026-08-30 against the installed CLIs:

| CLI | schema flag | behavior |
| --- | --- | --- |
| `codex exec` | `--output-schema` + `--output-last-message` | forced (D-021, D-022) |
| `grok` | `--json-schema <SCHEMA>` | "the model is constrained to produce JSON matching this schema. Implies --output-format json" |
| `claude -p` | `--json-schema <schema>` | "JSON Schema for structured output (only works with --print)" |
| `cursor-agent` | none | transport only (D-043) |

Two gaps follow:

1. **No Claude adapter exists.** `src/adapters/` has `codex.ts`, `cursor.ts`,
   `grok.ts`, `fake.ts` and no `claude.ts`. The registry schema requires all four
   canonical hosts on every alias, so `personal.claude` is filled with
   `fake-reviewer-v1` — a stub that rubber-stamps. Claude Code is a first-class
   host in `references/routing.md`; the owner already pays for it. A real adapter
   using `--json-schema` makes it a Codex-tier reviewer with no new credential.
2. **The Grok adapter does not pass `--json-schema`.** `GROK_REVIEW_ARGV_SUFFIX`
   carries `--output-format json` only, so Grok's verdict is model-dependent —
   the same risk Cursor has, on a CLI that need not have it.

The owner's decision (2026-08-30): build the Claude adapter now; forbid a Cursor
`reviewer.*` binding until the CLI exposes a structured-output flag.

## Scope

- **New `src/adapters/claude.ts`** mirroring `src/adapters/codex.ts`: probe
  `claude --help` for the required tokens; spawn
  `claude -p --output-format stream-json --verbose --json-schema <inline> --permission-mode plan --model <model> <prompt>`
  with `cwd` = ephemeral review workspace (or the prepared implementation
  workspace); feed NDJSON to the shared `ReviewStreamParser` and read the
  verdict from its terminal `result` record; `verify()` snapshot; read-only;
  closed env allowlist (the six base keys plus `CLAUDE_CONFIG_DIR` / `USER`
  parent-set-only, D7); forbidden-argv token guard;
  `review_kinds: ["plan", "implementation"]`.
- **`src/core/contracts.ts`**: `CLAUDE_LAUNCHER_ID = "claude-plan-reviewer-v1"`;
  add `structured_output: boolean` to `AdapterCapabilities`.
- **Adapter catalog** (wherever `deps.catalog.resolve(launcherId)` maps id →
  adapter): register `claude-plan-reviewer-v1` → `ClaudeAdapter`.
- **`src/core/doctor.ts`**: a `claude_interface` probe and report line parallel
  to `codex_interface`; the `binding reviewer.*` line reports
  `reviewer output unconstrained` when the resolved adapter has
  `structured_output: false`.
- **`src/adapters/grok.ts`**: add `--json-schema` + the review schema (reuse the
  Codex schema JSON shape per review kind) to `GROK_REVIEW_ARGV_SUFFIX` /
  the review argv builder; add `--json-schema` to `GROK_HELP_TOKENS`; set
  `structured_output: true`.
- **`src/adapters/codex.ts`**: set `structured_output: true`.
- **`src/adapters/cursor.ts`**: set `structured_output: false`.
- **`src/adapters/fake.ts`**: set `structured_output: true` (the stub returns a
  valid object by construction).
- **`src/core/review.ts`**: after `adapter.capabilities()`, before spawning, if
  `!capabilities.structured_output` terminate with reason
  `reviewer_output_unconstrained` — no reviewer session, no cycle spent.
- **`AGENTS.md`** (this repo and, as a documented pattern, consumer repos): a
  sentence that a `reviewer.plan` / `reviewer.implementation` binding must name a
  host whose adapter guarantees schema-constrained output (Codex, Grok, Claude
  Code); Cursor is ineligible as a reviewer until its CLI exposes the flag.
- **Machine-local registry** `~/.config/spartan-bridge/client-contexts.yaml`:
  `personal.claude` → `claude-plan-reviewer-v1` (and `client-a.claude` may stay
  `fake-reviewer-v1` or move, owner's call). This file is not in the repo; the
  task records the required edit.
- **Tests**: new `tests/claude-adapter.test.ts` (argv, schema file, env
  allowlist, forbidden tokens, collect parse, read-only verify, capabilities);
  `tests/doctor.test.ts` (claude interface line, unconstrained-reviewer line);
  `tests/review.test.ts` (refusal on `structured_output: false`);
  `tests/grok-adapter.test.ts` (the `--json-schema` argv + help token);
  any `tests/*capabilities*` / catalog test.
- **`docs/DECISIONS.md`** `D-046`; **`docs/AUTHENTICATION-AND-SECURITY.md`** and
  **`docs/ARCHITECTURE.md`** for the new adapter and the reviewer-eligibility
  rule.
- This task artifact.

## Out of Scope

- Any prose-to-verdict fallback or retry/backoff on `output_unparsable` (task
  `0021`, D-022, and `0044` all refuse it; this task removes the cause instead).
- Changing the Cursor adapter's argv or making Cursor a reviewer by any other
  means. When `cursor-agent` grows a structured-output flag, a follow-up flips
  `cursor` `structured_output` and adds the flag — not this task.
- A Claude Code **producer** adapter (planner / implementer through the Bridge).
  This task is reviewer-only; `ClaudeAdapter` implements `Adapter`, not
  `ProducerAdapter`.
- Task `0045` (credential-store selector) and `0046` (unwritable-artifact
  pre-check) — independent, still queued.
- Registry entries for aliases other than `personal`.
- Model-choice policy: which Claude model a repo binds is `AGENTS.md`'s call;
  the adapter accepts any `isModelIdentifier` value.

## Constraints

- English artifact, code comments, decisions, and docs.
- `ClaudeAdapter` never sets or reads a credential variable; env is the closed
  allowlist only. No `--json-schema` value or prompt reaches `status.json`,
  `events.jsonl`, stdout, stderr, or a progress line beyond what the shared
  retention path already does for a failed extraction.
- Reviewer read-only is enforced by the launch (no write tool, no workspace
  write) and the `verify()` snapshot, not by the prompt alone.
- Codex writes its schema file under the run directory (`0o600`); Claude and Grok
  pass the schema inline (their CLIs take inline JSON, not a file path). Neither
  schema ever lands inside the reviewed workspace.
- `npm run typecheck`, `npm test`, and `npm run build` all clean before commit.
- No new runtime dependency.
- The `structured_output` gate is a capability check, not a host-name check, so
  a future Cursor flag lifts it by flipping one boolean.

## Acceptance Criteria

- [x] `spartan-bridge doctor --repo .` reports
      `claude-plan-reviewer-v1: executable resolved; interface available` and,
      with `personal.claude` registered, `binding reviewer.plan: adapter
      available; launcher=claude-plan-reviewer-v1` when `AGENTS.md` binds
      `reviewer.plan` to Claude Code.
- [x] A review dispatched to `claude-plan-reviewer-v1` spawns
      `claude -p --output-format stream-json --json-schema <inline> ...`, reads the
      verdict from the stream `result` record, and `validateReviewResult` accepts a well-formed verdict; a
      malformed result is `output_unparsable` with the payload retained.
- [x] `ClaudeAdapter.capabilities().structured_output === true`;
      `codex` and `grok` and `fake` likewise; `cursor` is `false`.
- [x] A review whose resolved reviewer adapter has `structured_output: false`
      terminates `reviewer_output_unconstrained` before any child spawn — no
      `reviews/` entry, no cycle billed, doctor shows the ineligibility.
- [x] `GROK_REVIEW` argv includes `--json-schema` with the per-review-kind
      schema; `GROK_HELP_TOKENS` includes `--json-schema`; the Grok adapter
      preflight fails `interface_unrecognized` if the token is absent from help.
- [x] `ClaudeAdapter` forwards the closed `CLAUDE_ENV_ALLOWLIST` — the six base
      keys plus `CLAUDE_CONFIG_DIR` and `USER` **only when the parent sets
      them** (D7) — and drops every credential-shaped name; a forbidden argv token (`login`, `logout`,
      `--dangerously-skip-permissions`, `mcp`, `--resume`, `--continue`) is
      rejected.
- [x] `ClaudeAdapter.verify()` treats any workspace mutation as
      `reviewer_write_detected`; the read-only launch passes no write-capable
      tool.
- [x] `AGENTS.md` states the reviewer-eligibility rule; `docs/DECISIONS.md` has
      `D-046`; `docs/ARCHITECTURE.md` and `docs/AUTHENTICATION-AND-SECURITY.md`
      describe the Claude adapter and the rule.
- [x] `npm run typecheck`, `npm test`, `npm run build` clean; new adapter tests
      and the refusal test are recorded on the artifact with counts.

## Decisions

### D1 — `claude -p --json-schema` is the mechanism, mirroring Codex

`claude --help` (2026-08-30) lists `--json-schema <schema>` "JSON Schema for
structured output (only works with --print)" and `--output-format json` "single
result". The adapter spawns
`claude -p --output-format json --json-schema <file> --model <model> <prompt>`,
`cwd` = ephemeral workspace, reads the single JSON result from stdout, extracts
the assistant's final message, and `JSON.parse`s it — the same collect contract
as Codex reading `--output-last-message`. Missing or non-JSON output stays
`output_unparsable`; no fallback.

### D2 — `structured_output` is an adapter capability, checked in `review.ts`

`AdapterCapabilities` gains `structured_output: boolean`. `review.ts` refuses a
dispatch when the resolved reviewer adapter reports `false`, terminating
`reviewer_output_unconstrained` before the adapter is started. Cursor is `false`;
Codex, Grok, Claude, and the fake stub are `true`. A future `cursor-agent` flag
flips one boolean and adds the argv — no host-name special-casing anywhere.

### D3 — Grok adopts its own `--json-schema`

The `grok` CLI already supports `--json-schema`; the adapter simply was not
passing it. The review argv builder adds `--json-schema <inline JSON>` (the
`grok --help` example confirms inline, not a file path) with the same schema
`src/adapters/review-schema.ts` holds, per review kind; `GROK_HELP_TOKENS` gains `--json-schema` so
preflight fails closed if a future CLI drops it. Producer argv is unchanged
(producers are not structured authority).

### D4 — Reviewer-only adapter

`ClaudeAdapter implements Adapter` and not `ProducerAdapter`. A Claude Code
producer (planner / implementer dispatched by the Bridge) is a separate,
larger concern: the planner round is human-run through `/spbridge` today and
does not need an adapter. This task does not add one.

### D5 — The eligibility rule is repository policy plus a runtime gate

`AGENTS.md` carries the sentence so a repo owner sees why a Cursor
`reviewer.*` binding is rejected; `review.ts` enforces it regardless of what a
repository writes, because "enforced, not merely prompted" is the project rule.
`doctor` surfaces it on the binding line. The rule names the mechanism
(schema-constrained CLI output), not the host, and is explicitly marked
revisitable.

### D6 — Workspace handling copies Codex; schema is inline for Claude and Grok

Workspace is the ephemeral `spartan-bridge-review-*` dir (plan) or
`prepareReviewWorkspace` output (implementation); dir mode `0555`, file mode
`0444`; `verify()` diffs a pre-spawn snapshot. No new isolation primitive.
`claude -p --json-schema` and `grok --json-schema` both take the schema **inline
as a JSON string** (verified against both `--help` outputs), so those two
adapters write no schema file; only Codex `--output-schema <file>` uses a
run-directory file. The one schema string lives in `src/adapters/review-schema.ts`.

### D7 — Claude forwards `CLAUDE_CONFIG_DIR` and `USER` when the parent already sets them

Discovered in implementation: a Bridge-spawned `claude -p` under the six base
keys alone reports `api_error` / "Not logged in". `CLAUDE_CONFIG_DIR` is the
Claude Code CLI's config-dir override that holds the isolated-profile OAuth
credentials (default `~/.claude`); `USER` is read to resolve the macOS keychain
account. `CLAUDE_ENV_ALLOWLIST` therefore also forwards those two, and only
when `parent[key] !== undefined` — the Bridge never assigns, defaults, reads,
or logs either. This is the exact forward-when-present shape already shipped
for `GROK_HOME` (D-039, `docs/AUTHENTICATION-AND-SECURITY.md`), which likewise
names a directory that can contain credentials. Owner-approved 2026-08-30 as a
deliberate boundary statement, not an implementation-time drift: the closed
enum of forwarded keys is now eight for Claude, and the criterion below is
re-derived from this decision. `CLAUDE_CONFIG_DIR` / `USER` never reach
`status.json`, `events.jsonl`, stdout, stderr, or a progress line.

### D8 — Claude review streams live progress via `stream-json` + `--json-schema`

Verified 2026-08-30: `claude -p --output-format stream-json --verbose
--json-schema <inline>` composes — the CLI emits NDJSON records and still forces
the terminal `result` record to the schema. The adapter therefore uses
`stream-json` (not the single `json` blob), feeds each chunk to the shared
`ReviewStreamParser`, and reads the verdict from `parser.resultText` — the same
path the Codex and Cursor adapters use. A Claude review now shows the same
`working` / `tool` / `result` / `quiet` progress on a TTY as the other hosts;
`observeStream` is live. `collect()` falls back to `parser.residual` and then
raw stdout, and a missing verdict-shaped record still terminates
`output_unparsable`.

## Work Completed

- Planner (Claude Code / claude-sonnet-5, medium effort, Anthropic), 2026-08-30:
  created this task after confirming from `claude --help` and `grok --help` that
  both CLIs expose `--json-schema` while `cursor-agent` does not; verified no
  `src/adapters/claude.ts` exists and `GROK_REVIEW_ARGV_SUFFIX` omits
  `--json-schema`; wrote D1–D6. Classified implementation / high-impact (new
  adapter, a new capability field touching every adapter, and a new review
  refusal path).
- Implementer (Claude Code / claude-sonnet-5, medium, Anthropic), 2026-08-30,
  direct (Bridge review loop was down, the failure this task fixes):
  - `src/adapters/claude.ts` + `src/adapters/review-schema.ts` (shared verdict
    schema; `codexOutputSchema` delegates). `claude -p --output-format json
    --json-schema <inline> --permission-mode plan --allowed-tools Read,Grep,Glob
    --disallowed-tools Write,Edit,NotebookEdit,Bash,WebFetch,WebSearch`. Schema
    is passed **inline as a JSON string**, not a file path — `claude --help` and
    `grok --help` both take inline (`--output-schema <file>` is Codex-only), so
    Scope's "schema file under the run directory" is amended to inline for
    Claude and Grok; no schema file is written.
  - `AdapterCapabilities.structured_output` on every adapter (cursor `false`,
    codex/grok/claude/fake `true`); `review.ts` terminates
    `blocked` / `reviewer_output_unconstrained` before preflight; `doctor`
    `assessBinding` returns that reason for a `structured_output:false` reviewer
    binding; a new `claude_interface` probe + report line.
  - Grok adapter now passes its own `--json-schema` (inline) + help token.
  - `CLAUDE_ENV_ALLOWLIST` also forwards `CLAUDE_CONFIG_DIR` and `USER` when the
    parent sets them — discovered end to end: without `CLAUDE_CONFIG_DIR` the
    child reads `~/.claude` (empty); without `USER` it reports "Not logged in"
    because the macOS keychain account is resolved from `$USER`. Same
    forward-when-present shape as `GROK_HOME`; the Bridge originates neither.
  - Composition catalog registers `claude-plan-reviewer-v1`; machine-local
    registry `personal.claude` → `claude-plan-reviewer-v1`.
  - `AGENTS.md`: reviewer-eligibility rule; `reviewer.plan` and
    `reviewer.implementation` rebound to Claude Code / claude-sonnet-5 / medium
    (D-044 superseded for those two rows; `planner` / `implementer` stay Cursor).
  - `docs/DECISIONS.md` `D-046`; `docs/ARCHITECTURE.md` + `docs/AUTHENTICATION-AND-SECURITY.md`
    updated for the adapter, the gate, and the env forwarding.
  - Tests: new `tests/claude-adapter.test.ts` (9 cases); `withStructuredOutput`
    test seam in `tests/helpers.ts` for the cursor-through-`runReview` mechanics
    tests; a dedicated cursor refusal test; `codex-adapter` / `doctor` /
    `grok-adapter` / `agents` fixture updates.
  - `npm run typecheck` clean; `npm test` **369 pass / 0 fail**; `npm run build`
    exit 0.
  - End-to-end proof: a real plan review of task `0046` through
    `claude-plan-reviewer-v1` (run `run-2d92fb2a-de96-4305-98a7-cc7f7742178d`)
    ran 1m13s and returned a schema-valid `changes_requested` verdict with three
    correct findings.
- Implementation review of this task through `claude-plan-reviewer-v1`
  (run `run-a2ff94f7-c10f-498e-ae8d-e9caa189ca2c`, 3m42s):
  `changes_requested` — `ENV_ALLOWLIST_SCOPE` (warning: the
  `CLAUDE_CONFIG_DIR` / `USER` widening was folded into Work Completed and D-046
  without a numbered task decision or a re-derived criterion) and
  `STREAM_PARSER_INERT` (info: no live progress line for a Claude review).
- Implementer correction (Claude Code / claude-sonnet-5, medium, Anthropic),
  2026-08-30: added D7 (owner-approved 2026-08-30) authorizing the
  `CLAUDE_CONFIG_DIR` / `USER` forward-when-present, parallel to `GROK_HOME`,
  and re-derived the env acceptance criterion from it; added D8 accepting the
  absent Claude progress line; corrected D3 and D6 to say the Grok and Claude
  schema is passed inline, not as a run-directory file. No `src/` change — the
  shipped adapter already matches D7. `npm test` still 369 pass.
- Implementation review cycle 2 (`claude-plan-reviewer-v1`,
  `run-628c3133-4d20-4acb-b07f-385f8030f027`, 4m4s): `changes_requested` —
  `CLAUDE_ENV_DOC_GAP` (no "forwards to Claude" section; line 119/122 contradict
  the shipped forwarding) and `DOCTOR_SCOPE_UNUPDATED` (AGENTS.md and the AUTH
  doctor list still name only Cursor/Codex/Grok).
- Implementer correction + `stream-json` (Claude Code / claude-sonnet-5, medium,
  Anthropic), 2026-08-30:
  - Owner chose to fold live-progress parity in (option B). Verified
    `claude -p --output-format stream-json --verbose --json-schema <inline>`
    composes; the adapter now uses `stream-json`, feeds the shared
    `ReviewStreamParser`, and reads the verdict from `parser.resultText`.
    `observeStream` is live and a Claude review shows the same TTY progress as
    Codex/Cursor. D8 rewritten to record this.
  - `docs/AUTHENTICATION-AND-SECURITY.md`: new "What the Bridge forwards to
    Claude Code" section (eight keys, `CLAUDE_CONFIG_DIR`/`USER` parent-set-only)
    mirroring the Grok section; amended the parent-shell clause so the
    credential-class prohibition no longer reads as barring a forward-when-present
    config-dir var; added Claude to the `doctor` behavior list + example block.
  - `AGENTS.md`: `doctor` sentence now names Cursor, Codex, Grok, and Claude Code.
  - `docs/DECISIONS.md` D-046 + `docs/ARCHITECTURE.md`: argv updated to
    `stream-json`.
  - `npm run typecheck` clean; `npm test` 369 pass; `npm run build` exit 0.
  - A clean end-to-end re-check of the stream path was deferred: an interim e2e
    run blocked `reviewer_write_detected` because the operator was editing
    `docs/*.md` in the worktree while the plan review's `verify()` snapshot ran —
    a concurrency artifact, not an adapter fault; `collect()` had already
    succeeded (the run reached `verify`, past the `output_unparsable` gate).
- Implementation review cycle 3 (`claude-plan-reviewer-v1`,
  `run-e344c0a7-6d8a-4d31-b102-4866b8ea250e`, 1m56s, clean worktree): `pass` /
  APPROVED, no findings. The `stream-json` collect path is proven end to end
  (the run passed `collect` and `verify`). Task marked `completed`.

## Evidence

- `claude --help` 2026-08-30: `--json-schema <schema>` "JSON Schema for
  structured output (only works with --print)"; `--output-format` choices
  `text | json | stream-json`; `-p, --print` for non-interactive output.
- `grok --help` 2026-08-30: `--json-schema <SCHEMA>` "When set, the model is
  constrained to produce JSON matching this schema. Implies --output-format
  json."
- `src/adapters/grok.ts`: `GROK_REVIEW_ARGV_SUFFIX` = `--sandbox strict --tools
  ... --output-format json --no-subagents` — no `--json-schema`. `GROK_HELP_TOKENS`
  has `--output-format`, not `--json-schema`.
- `src/adapters/`: `codex.ts`, `cursor.ts`, `grok.ts`, `fake.ts`; no `claude.ts`.
- `src/core/contracts.ts`: `FAKE_LAUNCHER_ID`, `CURSOR_LAUNCHER_ID`,
  `CODEX_LAUNCHER_ID`, `GROK_LAUNCHER_ID`; `AdapterCapabilities` =
  `{ schema_version, launcher_id, review_kinds, permission_modes,
  workspace_write, fresh_context, observes_model }` — no `structured_output`.
- `src/core/review.ts:399`: `const capabilities = adapter.capabilities();`
  then `403` checks `review_kinds.includes(reviewKind)` — the insertion point
  for the `structured_output` refusal.
- `~/.config/spartan-bridge/client-contexts.yaml`: `personal.claude` →
  `fake-reviewer-v1`; `personal.codex/cursor/grok` → their real launchers.
- Motivating: task `0045` plan review `run-b1e19729`, `run-0861e655`,
  `run-5d7a92df` — all `adapter_error` / `output_unparsable`, Cursor /
  composer-2.5, payloads were 1–2 lines of narration with no JSON object.

## Review

<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-e344c0a7-6d8a-4d31-b102-4866b8ea250e execution_id=exec-356526ea-c2d6-4acc-8b10-a6d0ef6e5e72 review_kind=implementation verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-sonnet-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:1432cf4ad657ba8b32cb1751f04ef520e7ecebe5fcb14dec11a3dca63243ff05 task_hash=sha256:af99b49e14e9bf82ca39f8f015ee167d5e96ada8132612575ae2561091c69389 agents_hash=sha256:284421407f56483f3a539808d71c6196a279849f3f709e1752b653ec8a726999 timestamp=2026-08-30T13:13:46.753Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None. The adapter this task builds is now the reviewer that can review it:
`reviewer.implementation` is bound to `claude-plan-reviewer-v1` and `doctor`
reports it available.

## Next Action

None. Task completed: the Claude adapter, the `structured_output` gate, the Grok
`--json-schema` wiring, the stream-json progress, and the docs are on `origin/main`
and the implementation review through `claude-plan-reviewer-v1` returned `pass`
with no findings.

## Next Handoff

No outstanding handoff. Task completed.

Follow-up identifiable from repository state: task `0045` (forward
`AGENT_CLI_CREDENTIAL_STORE` for Cursor children) and task `0046` (refuse an
unwritable artifact before paying for the review) are queued and independent.
The machine-local registry edit `personal.claude` → `claude-plan-reviewer-v1`
is done on this machine and, by design, is not in the repository.
