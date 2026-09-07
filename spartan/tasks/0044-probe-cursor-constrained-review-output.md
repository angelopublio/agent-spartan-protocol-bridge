---
protocol: "1.1.0" # x-release-please-version
id: probe-cursor-constrained-review-output
created_at: 2026-08-29
status: completed
phase: complete
task_type: implementation
risk: material
current_role: implementer
next_role: none
updated_at: 2026-08-29
handoff_id: HX-003
next_handoff_id: none
---

# Probe Cursor constrained review output

## Objective

Decide, from a reproducible Cursor Agent CLI probe, whether `cursor-plan-reviewer-v1`
can gain a Codex-style schema-constrained final message. If a real equivalent exists,
plan how the Cursor adapter adopts it. If it does not, record that absence as a Bridge
decision and leave fail-closed `output_unparsable` unchanged — no prose-to-verdict
fallback.

## Context

A consumer board plan review failed twice in one afternoon with
`adapter_error` / `collect` / `output_unparsable`, exit code 0, empty stderr, and a
retained `adapter-payload.log` that held only assistant prose naming a verdict
(`human_required`, then `changes_requested`) and **no JSON object**. Models involved:
`cursor-grok-4.5-medium-fast` and `cursor-grok-4.6-high-fast`. Runs (board worktree):
`run-1a094ba1-f96f-4c02-9d15-3f9bf37b002a`, `run-e2a212f0-2794-4ee1-a167-6d8b86246d82`.

Codex already forces the contract with `--output-schema` + `--output-last-message`
(D-021, D-022). Cursor today uses `--output-format json|stream-json`, which shapes the
**transport envelope**, not the assistant's last message content. Task `0021` hardened
extraction when JSON is present with trailing prose; it explicitly refused a prose
fallback and refused "ask the model harder" as the fix.

The owner cannot use Codex for review (quota exhausted). The question is whether Cursor
CLI has gained, or already exposes, a constrained-output mechanism the Bridge is not
using.

## Scope

- Reproduce the help/interface probe against the installed `cursor-agent` (same
  executable the adapter resolves).
- Decide what counts as schema-equivalent for Bridge purposes.
- **Active (D5 → D4):** land the dated negative-finding decision in
  `docs/DECISIONS.md`, plus the operator note in `docs/ARCHITECTURE.md` (and AUTH only
  if it already describes Cursor review I/O).
- **Contingent (D3 only):** Cursor adapter schema wiring **only if** the implementer
  re-probe finds a D2-equivalent mechanism.
- This task artifact.

## Out of Scope

- Parsing prose or invented verdicts from `adapter-payload.log`.
- Retry/backoff on `output_unparsable`.
- Changing ReasonCodes or weakening fail-closed collect behavior.
- Codex, Claude, or Grok adapter changes.
- `--list-models`, `models`, `about`, login/logout, or any entitlements/account probe
  (Authentication and security boundary).
- Re-running the board consumer review from this repository.
- Prompt-only mitigations presented as a fix (task `0021` Out of Scope stands).
- Changing the Spartan portable `task-template.md` Review placeholder (Bridge↔template
  sync is a separate concern).

## Constraints

- English artifact and docs.
- Probe uses non-secret interface facts only (`--help` / already-allowed doctor tokens).
- No credential, profile path, or API key in argv, config, fixtures, or logs.
- A negative finding must not invent `--output-schema` on Cursor.
- Presence wiring must keep reviewer read-only (`--mode plan`, `--sandbox enabled`) and
  keep schema I/O under the Bridge run directory the way Codex does (D-023 spirit).
- Active-branch doc paths must lie inside automatic implementation write scope (`docs/`
  is admitted; do not require writes to `AGENTS.md` or other non-admitted paths).

## Decisions

### D1 - Probe is `cursor-agent --help` for schema-equivalent tokens

The investigation evidence is the help text of the executable the adapter already
spawns (`CURSOR_EXECUTABLE` = `cursor-agent`), not product marketing and not
`--list-models` / `models` / `about`. The planner round records the installed version
string when help or the versions directory exposes it. Doctor's existing Cursor
interface check stays the capability gate; this task does not broaden doctor into
entitlements.

### D2 - Equivalence means constraining the assistant's final message

A Cursor flag or mode is "schema-equivalent" only when it forces the **assistant
answer** (the bytes `collect` treats as the review payload) to conform to a Bridge-
supplied JSON Schema or an equally strict structured-output contract for that final
message. Explicitly **not** equivalent on their own:

- `--output-format json`
- `--output-format stream-json`
- `--stream-partial-output`

Those control how the CLI prints events/envelopes. They do not constrain the model to
emit the review contract keys.

### D3 - If equivalent exists: adopt under the run directory, fail closed otherwise

If D2 finds a real mechanism, the Cursor adapter:

1. Writes the review schema under `.spartan-bridge/runs/<run-id>/` (not inside the
   reviewed workspace).
2. Passes the documented schema flag(s) **and keeps** the existing reviewer read-only
   launch flags `--mode plan` and `--sandbox enabled` (Constraints).
3. Lets `collect` read the constrained final message the same way Codex reads
   `--output-last-message`: parse once as JSON, then `validateReviewResult`.
4. Leaves missing or non-JSON output as `output_unparsable`. No balanced-span or prose
   fallback is added for that path.

Preflight/`--help` probe tokens gain whatever long-form flags the mechanism requires,
parallel to `CODEX_HELP_TOKENS`.

### D4 - Active branch: document the gap in named paths; change nothing else

Because D5 selected this branch, the implementation round does exactly this and nothing
more:

1. Appends one dated decision entry to **`docs/DECISIONS.md`** (next free `D-0NN` in that
   file's existing convention) stating that Cursor Agent CLI, as probed on the recorded
   version, has no schema-constrained final-message path; `--output-format` remains
   transport-only; Bridge keeps fail-closed `output_unparsable` when extraction finds no
   verdict-shaped JSON. That path is inside automatic implementation write scope (`docs/`).
2. Adds one short note in **`docs/ARCHITECTURE.md`**. Adds a matching sentence in
   **`docs/AUTHENTICATION-AND-SECURITY.md` only if** that file already describes Cursor
   review I/O; otherwise AUTH is untouched.
3. Leaves unchanged the closed set below (positive invariant — what stays the same):
   - Cursor review argv and `CURSOR_*` launch prefixes
   - extractor precedence and `output_unparsable` / collect fail-closed semantics
   - ReasonCode names and meanings
   - absence of prose-to-verdict fallback and of retry/backoff on `output_unparsable`
   - Codex, Claude, and Grok adapters
   - consumer board repositories and their runs
   - review prompt wording
   - Spartan portable `task-template.md`

Prompt wording changes remain out of scope on this branch.

### D5 - Planner probe result selects the active branch now

On 2026-08-29 this machine's `cursor-agent --help` (executable resolved via PATH name
`cursor-agent`, version dir `2026.08.11-e8db854`) lists `--output-format` values
`text | json | stream-json` and does **not** list `--output-schema`,
`--output-last-message`, response-format, or any other final-message schema flag.
Therefore **D4 is the active implementation branch**; D3 stays as the contingent design
if a future CLI release grows the help surface. The implementer re-runs the same help
probe before writing the decision so the recorded version is not stale relative to the
commit.

## Acceptance Criteria

- [x] D1: Evidence quotes the help invocation and names the executable path (or PATH
      name) used; no `--list-models` / `models` / `about` appears in the recorded probe.
- [x] D2: The decision text states that `json` / `stream-json` alone are not
      schema-equivalent, in the same words an implementer can pin in docs.
- [x] D5/D4: The implementer re-runs `cursor-agent --help`, records whether any new
      D2-equivalent token appeared, and if none (expected), appends the dated entry to
      `docs/DECISIONS.md` and the `docs/ARCHITECTURE.md` note from D4 (AUTH only under
      D4's conditional), with the D4 closed invariant held — no Cursor argv, extractor,
      collect-semantic, ReasonCode, prose-fallback, retry, board-repo, prompt, or Spartan
      template change.
- [ ] D3 (contingent only): If the re-probe finds a D2 mechanism, the Cursor adapter
      writes schema under the run directory, passes the new flags **while keeping**
      `--mode plan` and `--sandbox enabled`, parses the constrained final message once,
      and still terminates `output_unparsable` on non-JSON — with tests parallel to the
      Codex schema path. Otherwise this criterion is N/A and unchecked is correct.
- [x] D4 invariant (repository check): `npm run typecheck`, `npm test`, and
      `npm run build` if `src/` changed, record outcomes on the artifact; the active
      branch is expected not to change `src/` unless the re-probe flips to D3.

## Work Completed

- Planner (Cursor / Grok 4.5, high effort), 2026-08-29: created
  this task from the consumer `output_unparsable` failures; classified as planning /
  material; wrote D1–D5 with D4 active after a live help probe.
- Live help probe (same round): `cursor-agent --help` shows transport formats only;
  no schema-constrained final-message flag on version `2026.08.11-e8db854`.
- Planner (Grok / grok-4.6, high effort, xAI), 2026-08-29, `/spbridge` producer: re-ran the
  same help probe before dispatching plan review; version and help surface unchanged, so D4
  remains the active implementation branch. Confirmed `CURSOR_EXECUTABLE` is the PATH name
  `cursor-agent`, Codex still owns `--output-schema` / `--output-last-message` (D-021–D-023),
  and task `0021` still refuses prose fallback.
- Planner (Grok / grok-4.5, high effort, xAI), 2026-08-29, `/spbridge` producer: human
  started this session with the task path only (no HX-NNN). Re-probed again, confirmed D4
  still active on the same CLI version, left `next_role: reviewer` and envelope HX-001
  unchanged, then dispatched plan review through the installed Bridge.
- Human/operator unblock (2026-08-29): Bridge run `run-e0bcf5bf-46b5-4d63-a5ba-5f44d9b4b393`
  accepted `changes_requested` then refused the task write (`task_artifact_write_rejected`)
  because this artifact still carried the full Spartan `task-template.md` Review placeholder
  prose, while Bridge `TEMPLATE_PENDING_*` only clears the shorter `- None recorded.` form.
  Shortened `## Review` to that Bridge-known placeholder so a re-dispatch can persist
  findings. Contract fix (Bridge adopts the live Spartan template bytes) remains separate.
- Bridge plan review `run-22c66998-6a2e-4484-9524-030fad16b9a8`: `changes_requested` with
  `task_write_state: written` (`D4_DECISION_PATH`, `AC_OOS_UNLINKED`, `SCOPE_STALE_BRANCH`).
- Planner (Grok / grok-4.5, high effort, xAI), 2026-08-29, `/spbridge` correction: revised
  Scope (D4 active docs in scope; D3 contingent only), named `docs/DECISIONS.md` +
  `docs/ARCHITECTURE.md` (+ conditional AUTH) in D4, restated D4's closed invariant set,
  strengthened D3 to keep `--mode plan` / `--sandbox enabled`, and re-derived Acceptance
  Criteria from those decisions. Ready for plan re-review (HX-002).
- Bridge plan review `run-8733abab-edd5-4861-995b-3a8186d91888`: `pass` / `APPROVED`; no
  findings. Automatic implementer successor started.
- Implementer (Grok / grok-4.5, high effort, xAI), 2026-08-29, Bridge foreground successor:
  re-probed `cursor-agent --help` (still no D2-equivalent token on
  `2026.08.11-e8db854`); landed D4 as `D-043` in `docs/DECISIONS.md` and the transport-only
  note in `docs/ARCHITECTURE.md`; left AUTH untouched (it describes Cursor isolation/doctor,
  not Cursor review I/O); left Cursor argv/extractor/ReasonCodes/prompts/template unchanged;
  D3 remains N/A. Pre-existing worktree Grok producer sandbox edits (D-042 /
  `src/adapters/grok.ts`) were already present to let this Grok implementer start under the
  Bridge Darwin seatbelt; this round did not author or revise them.
- Bridge implementation review `run-421c16d3-e41a-4e79-bac2-8133558d0a75`:
  `pass` / `APPROVED`, no findings, `task_write_state: written`. Dispatched
  through `reviewer.implementation` temporarily rebound to
  `Cursor / composer-2.5` (registry `personal.claude` resolves to the fake
  stub; the binding was reverted to the committed `Grok` row after the run).
  Vendor-independent of the Grok implementer (Composer is Cursor's own model).
- Verifier (Claude Code / claude-sonnet-5, medium, Anthropic), 2026-08-29:
  confirmed both reviews `APPROVED`, all acceptance criteria met (D3 N/A),
  no blockers. Clean-shell checks: `npm run typecheck` exit 0, `npm test`
  360 pass / 0 fail, `npm run build` exit 0. Marked `completed`. D-042 and
  D-043 committed as separate changes; the pre-existing `src/adapters/grok.ts`
  D-042 edit set was committed under its own decision, not folded into D-043.

## Evidence

- Board failure shape (motivating, not a Bridge check): status documents for
  `run-1a094ba1-f96f-4c02-9d15-3f9bf37b002a` and
  `run-e2a212f0-2794-4ee1-a167-6d8b86246d82` with
  `reason_code=adapter_error`, `adapter_failure.cause=output_unparsable`,
  `payload_log=adapter-payload.log`; payloads were prose without a JSON object.
- Command: `/Users/example/.local/bin/cursor-agent --help`  
  Outcome: options include `--output-format <format>` with `text | json | stream-json`;
  no `--output-schema` / `--output-last-message` / structured final-message flag in the
  help text. Version directory present: `~/.local/share/cursor-agent/versions/2026.08.11-e8db854`.
- Re-probe (planner `/spbridge` producer, 2026-08-29): `cursor-agent --help` again lists
  `--output-format` as `text | json | stream-json` and `--stream-partial-output`; no
  schema-constrained final-message flag. PATH resolves
  `cursor-agent` → `~/.agent-profiles/bin/cursor-agent` →
  `~/.local/share/cursor-agent/versions/2026.08.11-e8db854/cursor-agent` (same version as the
  first probe). Adapter constant `CURSOR_EXECUTABLE` is the PATH name `cursor-agent`.
- Re-probe (planner `/spbridge` producer, Grok 4.5, 2026-08-29, this round):
  `cursor-agent --help` still lists `--output-format` as `text | json | stream-json` and
  `--stream-partial-output`; no `--output-schema`, `--output-last-message`, response-format,
  or other final-message schema flag. Version directory still only
  `~/.local/share/cursor-agent/versions/2026.08.11-e8db854`. PATH
  `cursor-agent` → `~/.agent-profiles/bin/cursor-agent` → `wrap-official-client` (wrapper to
  the same versioned binary). `CURSOR_HELP_TOKENS` remain transport/permission tokens only;
  `CODEX_HELP_TOKENS` still uniquely hold `--output-schema` / `--output-last-message`.
- Contrast: `src/adapters/codex.ts` `CODEX_HELP_TOKENS` includes `--output-schema` and
  `--output-last-message`; D-022 forbids prose fallback on that path.
- `spartan-bridge doctor --repo <this-repo>`: `binding reviewer.plan: adapter available;
  launcher=grok-plan-reviewer-v1` (review of this plan does not depend on Cursor schema).
- Implementer re-probe (Grok / grok-4.5, 2026-08-29, Bridge successor for
  `run-8733abab-edd5-4861-995b-3a8186d91888`):
  Command: `cursor-agent --help` (PATH name `cursor-agent` →
  `~/.agent-profiles/bin/cursor-agent` → `wrap-official-client` → versioned binary under
  `~/.local/share/cursor-agent/versions/2026.08.11-e8db854/`).
  Outcome: help still lists `--output-format` as `text | json | stream-json` and
  `--stream-partial-output`; `rg -i 'output-schema|output-last-message|response-format|structured|json.schema|schema'`
  against that help text matched no tokens. Probe did not invoke `--list-models`,
  `models`, or `about`. No new D2-equivalent mechanism → D4 active; D3 N/A.
- D4 landings: `docs/DECISIONS.md` entry `D-043` (states `json` / `stream-json` alone are
  not schema-equivalent; fail-closed `output_unparsable` retained);
  `docs/ARCHITECTURE.md` one-sentence transport-only / D-043 note after the shared
  extractor paragraph. AUTH left unchanged for D4 (no Cursor review I/O section to
  amend; pre-existing uncommitted AUTH delta is the separate D-042 Grok producer note).
- D4 invariant paths this round: no edits under `src/adapters/cursor.ts`, Codex/Claude
  adapters, ReasonCodes, extractor, prompts, or Spartan `task-template.md`. Pre-existing
  uncommitted `src/adapters/grok.ts` / `tests/grok-adapter.test.ts` / D-042 remain in the
  worktree from the producer-seatbelt enabler; not authored by this D4 edit set.
- Repository checks (inside Bridge Darwin producer seatbelt):
  - `node node_modules/typescript/bin/tsc --noEmit`: exit 0. (`npm run typecheck` exits
    126 here because the outer producer guard left `node_modules/typescript/bin/tsc` mode
    `0444` / non-executable; invoking through `node` is the same compiler.)
  - `npm run build`: N/A for D4 (this round did not change `src/`).
  - `node --import tsx --test tests/grok-adapter.test.ts`: 11 pass, 0 fail (includes the
    pre-existing `--sandbox none` producer assertion).
  - Broader subset excluding nested-`sandbox-exec` files
    (`producer-write-scope`, `cursor-adapter`, `transition`, `cli`, `spbridge-package`):
    251 pass, 1 fail — the single fail is `mcp-stdio` stderr matching `/^error: /` while a
    Node `NO_COLOR`/`FORCE_COLOR` warning precedes the error line (environmental; unrelated
    to D4 docs).
  - Full `npm test` under the outer producer profile additionally fails nested
    `sandbox-exec` cases with `sandbox_apply: Operation not permitted` (exit 71) and
    `manage-install.sh` `EACCES` (script mode flipped by the write-scope guard). Same
    nested-seatbelt class as D-042; not introduced by D-043 docs.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-8733abab-edd5-4861-995b-3a8186d91888 execution_id=exec-345d283d-02d2-47f2-b55d-508ee96d015b review_kind=plan verdict=pass reason_code=review_passed host=grok launcher=grok-plan-reviewer-v1 model=grok-4.5 effort=high model_observed=declared_unobserved policy_digest=sha256:bd8320f1e4119cb68aac27f31b7904f6290842a8b8e5b4b22ce0b8437cecc140 task_hash=sha256:0ea3483691c968e83023df65a6872b66de02e401c9268a0c5f16cc5bde513f24 agents_hash=sha256:34a05624b8de1c1eb73989b6478e3d4c3f21618320d3d4ce833ac808965d3ab9 timestamp=2026-08-29T17:48:56.291Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-421c16d3-e41a-4e79-bac2-8133558d0a75 execution_id=exec-d544525b-db89-4644-baab-ec0a76fc0e9b review_kind=implementation verdict=pass reason_code=review_passed host=cursor launcher=cursor-plan-reviewer-v1 model=composer-2.5 effort=none model_observed=declared_unobserved policy_digest=sha256:b1410ddc95290b042cac5103157999a2cbd8aaae1f670f51d734116f65fe726b task_hash=sha256:593fb6d6b1d8cb3c66e98b8ff4941bdffb38ac53f4bba3966e4a29b309a28bd0 agents_hash=sha256:5c244f93a1e62f4d261ea51db485ec5cdbd3c44cb9456536357363def39cd268 timestamp=2026-08-29T19:34:45.542Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None for the D4 documentation branch. Full `npm test` nested-sandbox cases cannot be
re-proven from inside the Bridge producer Darwin seatbelt; that limitation is
environmental for this successor round, not a D-043 product defect. Pre-existing
uncommitted D-042 / Grok producer edits share the worktree with this task's D4 docs and
should be separated at commit time by the human.

## Next Action

None. Task completed: both reviews `APPROVED`, checks green, changes committed.

## Next Handoff

No outstanding handoff. Task completed.

D-043 recorded that Cursor Agent CLI has no schema-constrained final-message
path on version `2026.08.11-e8db854`; the Bridge keeps fail-closed
`output_unparsable` with no prose fallback. The contingent D3 adapter wiring is
N/A until a future CLI release grows a D2-equivalent help surface — re-probe
`cursor-agent --help` when the version changes before assuming the gap persists.

Identifiable follow-up already queued: `spartan/tasks/0045-forward-cursors-credential-store-selector.md`
(forward `AGENT_CLI_CREDENTIAL_STORE` for Cursor children so a Bridge review no
longer depends on the `~/.agent-profiles/bin` wrapper being first on `PATH`).
