---
protocol: "1.0.0" # x-release-please-version
id: add-a-grok-official-client-adapter
created_at: 2026-08-23
status: completed
phase: complete
task_type: implementation
risk: high-impact
current_role: implementer
next_role: none
updated_at: 2026-08-23
handoff_id: HX-003
next_handoff_id: none
---

# Add a Grok official-client adapter

## Objective

`spartan-bridge` can resolve Host `Grok` for `reviewer.plan`,
`reviewer.implementation`, and `implementer`, spawn the official `grok` CLI
without using the colliding `agent` name, and after a proven `doctor` result the
repository `AGENTS.md` remounts every binding onto Grok / `grok-4.5` / high so
later tasks (including `0031`) can dogfood Grok↔Grok auto-chain.

## Context

Cursor, Claude, and Codex are no longer usable on this machine. Task `0031` has
an approved plan and needs an implementer plus implementation review through the
Bridge. Without a Grok `CanonicalHost`, launcher, and adapter, remounting
`AGENTS.md` alone fails closed.

## Scope

- `src/core/contracts.ts`: display `Grok` → canonical `grok`; launcher id.
- Machine-local registry and `tests/helpers.ts` `VALID_REGISTRY`: every context
  gains a `grok.launcher` entry.
- `src/adapters/grok.ts`: plan + implementation review and implementer producer.
- `src/composition.ts`, `src/core/doctor.ts`, host admission in `src/core/review.ts`.
- Docs decision + auth note; tests; remount `AGENTS.md` only after doctor reports
  the Grok launcher available.
- This task artifact.

## Out of Scope

- Editing task `0031` during this task's product commit.
- Claude adapter, Codex producer, wrap-official-client Grok profile isolation
  unless dogfood proves auth requires it.
- Spawning PATH name `agent`.

## Constraints

- Child env allowlist only: `PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL`, `TERM`, and parent-exported `GROK_HOME`. The Bridge never sets `GROK_HOME`.
- Review: isolated workspace, `--sandbox strict`, read-tool allowlist, Bridge
  snapshot verify. Do not treat `--permission-mode plan` as technical read-only.
- Producer: `--sandbox workspace` plus existing `applyProducerWriteScope`.
- Fresh sessions only (no `--continue` / `--resume`).
- Human-authorized same-session planning and implementation in Grok.

## Decisions

### D1 - Grok is a first-class CanonicalHost

`HOST_DISPLAY_TO_CANONICAL` gains `Grok: "grok"`. `CANONICAL_HOSTS` becomes
`["codex", "claude", "cursor", "grok"]`. Launcher id is `grok-plan-reviewer-v1`.
Every registry context must declare a `grok.launcher` entry.

### D2 - Executable is `grok`, never `agent`

The adapter spawns executable `grok` only. The Grok installer alias `agent`
collides with Cursor Agent CLI and must not be a Bridge launcher name.

### D3 - Review uses strict sandbox + tool allowlist + workspace library

Plan prepare copies only `AGENTS.md` and `task.md`. Implementation prepare
reuses `prepareReviewWorkspace` and `recordImplementationReviewEnvelope`.
Start uses `--sandbox strict`, `--tools read_file,grep,list_dir`,
`--disallowed-tools Agent`, `--output-format json`, `--cwd` on the workspace,
and a kind-selected prompt. Collect unwraps Grok's `{text}` headless envelope
before verdict extraction. Verify snapshots the workspace.

### D4 - Producer uses workspace sandbox + Bridge write-scope

Implementer start uses `--sandbox workspace`, `--always-approve`,
`--output-format json`, and the existing Darwin write-scope guard
(`applyProducerWriteScope` / `sandboxProfile`). Producer preflight probes
`grok --help` tokens and `sandbox-exec` on Darwin.

### D5 - Remount after doctor, then dogfood elsewhere

`AGENTS.md` remounts all four bindings to Grok / `grok-4.5` / high only after
`doctor` reports the Grok bindings available. Task `0031` is dogfooded in a
separate commit boundary after this task lands.

## Work Completed

- Human-authorized same-session planning and implementation (Grok), 2026-08-23:
  added CanonicalHost `grok`, launcher `grok-plan-reviewer-v1`, `GrokAdapter`
  with plan+implementation review and implementer producer, doctor probe,
  registry fixtures, machine-local registry `grok` entries, D-039, and remounted
  `AGENTS.md` onto Grok / `grok-4.5` / high after doctor reported the launcher
  available. Did not edit task `0031`. Rebuilt `dist/`.

## Evidence

- `src/core/contracts.ts`: `HOST_DISPLAY_TO_CANONICAL.Grok === "grok"`;
  `CANONICAL_HOSTS` includes `grok`; `GROK_LAUNCHER_ID` is `grok-plan-reviewer-v1`.
- `src/adapters/grok.ts`: executable `grok`; review argv uses `-p <prompt>`,
  `--sandbox strict`, `--tools read_file,grep,list_dir`; producer uses
  `--sandbox workspace` and `applyProducerWriteScope`.
- `tests/grok-adapter.test.ts`: capability gate, forbidden `agent` token,
  `{text}` unwrap, plan and implementation prepare/start, producer argv,
  write-scope lock/release, and Darwin/non-Darwin producer preflight.
- Repository checks, 2026-08-23: `npm run typecheck` exited 0; `npm test`
  exited 0 with 353 passed and 0 failed; `npm run build` exited 0.
- `spartan-bridge doctor` with the authenticated Grok profile home visible:
  `binding reviewer.plan: adapter available; launcher=grok-plan-reviewer-v1`
  `binding reviewer.implementation: adapter available; launcher=grok-plan-reviewer-v1`
  `binding implementer: adapter available; launcher=grok-plan-reviewer-v1`
- `git status --short` still lists the pre-existing dirty task `0031` artifact.


## Review

<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-a1b2ee0a-610e-4b5e-b05f-60d0458cd2eb execution_id=exec-02c3a8b5-1930-438e-bcdc-d3c994ac23a1 review_kind=implementation verdict=pass reason_code=review_passed host=grok launcher=grok-plan-reviewer-v1 model=grok-4.5 effort=high model_observed=declared_unobserved policy_digest=sha256:d690b4307d9d8413f4be8daf675a265e5318b5e18c29837967b091ebb339ae77 task_hash=sha256:09d88f8798a89d9254ebd85e2f7a5d4f3d9fab5dbc0918e8bcb6465e78a4d8af agents_hash=sha256:9af32d846dec4bf17b1a71accdfbb4e7d61376d408469dd318dfdbfc3c0070b8 timestamp=2026-08-23T13:25:00.364Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None. Owner authorized same-session implementation because no other official
client remains available.

## Next Action

None. Task completed: Grok is a first-class Bridge host, AGENTS.md is remounted, and implementation review passed.


## Acceptance Criteria

- [x] D1: `canonicalizeHost("Grok")` is `grok`; `GROK_LAUNCHER_ID` is
      `grok-plan-reviewer-v1`; registry fixtures and the machine-local registry
      include `grok` for every context.
- [x] D2: adapter executable constant is `grok`; tests forbid spawning `agent`.
- [x] D3: plan and implementation review prepare/start/collect/verify behave as
      decided; implementation manifest records `AGENTS.md` and `task.md`.
- [x] D4: producer capabilities and write-scope lock path match Cursor's guard
      contract; preflight requires Darwin `sandbox-exec` when producing.
- [x] D5: after doctor availability, `AGENTS.md` binds all four roles to Grok /
      `grok-4.5` / high; task `0031` is not modified in this task's commit.
- [x] `npm run typecheck` and `npm test` exit 0.

## Next Handoff

No outstanding handoff. Task completed.
