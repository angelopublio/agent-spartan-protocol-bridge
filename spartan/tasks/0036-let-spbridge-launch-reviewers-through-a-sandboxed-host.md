---
protocol: "1.0.0" # x-release-please-version
id: let-spbridge-launch-reviewers-through-a-sandboxed-host
created_at: 2026-08-21
status: completed
phase: complete
task_type: implementation
risk: high-impact
current_role: reviewer
next_role: none
updated_at: 2026-08-21
handoff_id: HX-002
next_handoff_id: none
---

# Let spbridge launch reviewers through a sandboxed host

## Objective

When `spbridge` is invoked from Codex or another sandboxed producer host, the runtime obtains the
host-level approval required to start the selected official-client adapter before the review command
runs. A Cursor reviewer can write its isolated machine-local session state and reach its service
without weakening the reviewer's own read-only mode or requiring broad permanent host access.

## Context

Task `0033` reached review-ready handoff `HX-017`, then Bridge run
`run-0e2b6ee6-d4b4-4d98-9eb9-a809af62f876` failed in `collect` with
`adapter_error / exit_nonzero / exit_code: 1`. Its retained, redacted stderr was:

```text
Error: EPERM: operation not permitted, mkdir '[redacted]
```

Policy resolution, binding selection, launcher resolution, `cursor-agent --help`, and all repository
checks had succeeded. No new directory appeared in the isolated Cursor profile at the run timestamp.
The spawned Cursor process inherited the parent Codex sandbox, which allowed the repository and OS
temporary directory but not the Cursor profile home; the same sandbox also controls child network
access. `doctor` passed because its interface probe does not create a reviewer session or exercise
provider network access.

The current `skills/spbridge/SKILL.md` says to invoke `spartan-bridge review` once, but does not tell
Codex to request approval before doing so. Its no-retry rule then correctly stops after the failed
attempt, but too late to avoid spending a run on a host permission failure.

This task is urgent for the temporary operating map in repository `AGENTS.md`: Codex planner,
Cursor `reviewer.plan`, Cursor implementer, and Codex `reviewer.implementation`.

## Scope

- `skills/spbridge/SKILL.md`: host-sandbox permission negotiation before every CLI invocation,
  while preserving one invocation per cycle and every existing stop rule.
- `tests/spbridge-skill.test.ts`: behavioral contract for pre-invocation approval and the prohibition
  on an automatic retry after a denied or failed launch.
- `src/adapters/cursor.ts` and `tests/cursor-adapter.test.ts`: preserve Cursor model aliases that
  already encode their effort and reject a contradictory binding before adapter spawn.
- README installation and operation guidance for runtime execution from Codex, including profile
  writes, child network access, and the narrow approval flow.
- `docs/AUTHENTICATION-AND-SECURITY.md`: distinguish parent-host execution permission from reviewer
  permission mode and document what `doctor` does not prove.
- Adapter failure guidance only if needed to make this specific failure actionable without exposing
  a home path or credential-bearing client stderr.

## Out of Scope

- Disabling Cursor `--mode plan` or `--sandbox enabled`.
- Making the reviewer workspace writable, widening the files supplied to plan review, or weakening
  Bridge snapshot and write-detection checks.
- Setting Codex permanently to unrestricted full access as the default installation path.
- Reading authentication state, testing credentials, invoking login/logout, or adding credential
  paths to Bridge configuration or logs.
- Automatically retrying the failed run, continuing it with `--after-run`, or consuming a review
  cycle after an approval denial.
- Moving the skill package; task `0035` owns that later move and must preserve this behavior.

## Constraints

- The runtime remains host-neutral. A host integration requests or explains host permission; core
  policy must not contain Codex-specific approval APIs.
- Approval is obtained before `spartan-bridge review` starts, so a denied approval creates no Bridge
  run and spends no review cycle.
- The approved operation is the exact Bridge review command and its selected official-client child,
  not unrelated commands or a permanent machine-wide permission grant.
- Official-client profile directories remain machine-local and are never stored in repository policy,
  task artifacts, runtime arguments, events, or user-facing logs.
- A host that cannot grant the necessary profile-write and network capability stops for the human
  before adapter dispatch.

## Decisions

### D1 - This is inherited parent sandboxing, not a Cursor authentication failure

The run evidence establishes an immediate `mkdir` denial after successful interface preflight. The
fix therefore addresses how the producer host launches the Bridge. It must not invoke authentication
commands, inspect a client account, or weaken the reviewer because `doctor` happened to pass.

### D2 - The host integration negotiates permission on every runtime spawn

Every review command is a separate host spawn: the initial invocation, each continuation carrying
`--after-run`, the `spartan-bridge` executable on `PATH`, and the `node dist/cli/main.js` fallback.
Before each one starts, `spbridge` uses the current host's command-level escalation mechanism for
that command's complete process tree — Bridge plus the selected official-client child — so both
machine-local client-state writes and provider network access are available. In Codex, that means
requesting escalated sandbox permission on the shell invocation itself. It is not an informal prompt,
a repository path allowlist, or a permanent permission setting. A denied escalation stops before the
process starts, creates no run, spends no cycle, and is not retried.

Other host packages provide their equivalent command-level mechanism. The host-neutral CLI does not
grow a `--codex-*` flag and does not know how approvals are represented or where a client stores its
machine-local state.

### D3 - Prefer one-command approval over permanent full access

Documentation recommends the narrowest available approval that permits the runtime process, its
selected official-client child, the isolated client profile, OS temporary workspace, and required
network connection. A persistent custom permission profile may be documented as an advanced local
option, but unrestricted full access is not the default remedy.

### D4 - The reviewer's own enforcement remains independent

Parent approval lets the Bridge and selected client start; it grants no Bridge policy transition and
does not change the adapter argv. Cursor remains `--mode plan --sandbox enabled`; the Bridge still
uses read-only review inputs, fresh execution context, repository integrity comparison, and task
artifact write gates. Documentation names the two layers separately so “approve the runtime” cannot
be misread as “let the reviewer edit.”

### D5 - `doctor` reports interface readiness honestly

`doctor` may continue to prove executable resolution and recognized CLI flags, but documentation and
output must not imply that this proves a nested reviewer session can create client state or use the
network under the current parent host. If a safe, credential-free launch-readiness check cannot prove
those facts without starting a review, the limitation is stated rather than simulated.

### D6 - A failed permission launch starts a new unchained attempt only after human action

The existing failed run remains terminal and is never used as `--after-run`. `spbridge` does not
retry in the same cycle. After the integration is corrected, a human starts a new invocation; the
next Bridge review is unchained unless a prior successful `changes_requested` run explicitly supplies
the chain reference.

### D7 - Cursor effort is represented exactly once

Some Cursor model aliases already encode their effort, such as
`cursor-grok-4.6-high-fast`. The adapter passes a matching effort-encoded alias unchanged instead of
appending Cursor's bracket override. If the binding's separate effort disagrees with the alias, the
adapter fails closed before spawning the client. Models without an encoded suffix keep the existing
`model[effort=value]` behavior, and `none` remains the bare model identifier.

## Acceptance Criteria

- [x] D1: regression evidence reproduces a parent sandbox that denies the Cursor profile `mkdir`
      without reading authentication state, and distinguishes the failure from launcher resolution,
      interface recognition, or reviewer result parsing.
- [x] D2: under Codex, `spbridge` requests command-level escalated sandbox permission before every
      Bridge review spawn: initial, `--after-run`, PATH executable, and Node fallback.
- [x] D2: the approved unit is the complete command process tree and covers both machine-local client
      state writes and provider network access; denial occurs before the process starts, creates no
      run, spends no cycle, and triggers no automatic retry.
- [x] D2: the runtime core and CLI schema contain no Codex-specific approval flag, path, or policy
      value; another host adapter can supply equivalent permission handling.
- [x] D3: README documents a narrow one-command approval as the default and labels any persistent
      custom permission profile as optional, machine-local configuration.
- [x] D4: the Cursor argv still contains `--mode plan --sandbox enabled`, reviewer inputs and workspace
      permissions are unchanged, and existing write-detection tests pass unchanged.
- [x] D4: documentation explicitly distinguishes parent-host permission to launch from reviewer-role
      permission to read or write repository content.
- [x] D5: `doctor` output or its adjacent documentation says that an interface-only probe does not
      prove session-state writes or provider network access under the current parent sandbox.
- [x] D6: no automatic retry occurs after approval denial or `adapter_error`; the failed run is never
      supplied as `--after-run`, and the next human-started unchained attempt begins at cycle 1.
- [x] D7: `cursor-grok-4.6-high-fast` plus `high` is passed unchanged, a conflicting declared effort
      is refused before spawn, and aliases without an effort suffix retain the existing composition.
- [x] D2: the installed symlinked `spbridge` resolves the corrected instructions, and a fresh Codex
      session using the owner-selected Codex-planner/`reviewer.plan`-Cursor map can dispatch a real
      Cursor plan review without `EPERM` from the parent sandbox.
- [x] D2: the real verification records its explicit run ID, terminal state, reason code, verdict, and
      whether a task-artifact review region was written, without recording client credentials or
      unredacted paths.
- [x] `git diff --check`, `npm run typecheck`, `npm run build`, and `npm test` exit 0.

## Work Completed

- Diagnosed and persisted the failed 0033 run so the fix no longer depends on conversation history.
- Separated this task from the active, dirty task `0033` by authoring it in a dedicated worktree.
- Plan review HX-001 (Cursor, cursor-grok-4.6-high-fast, high): accepted the matching envelope, product files read-only, verdict `CHANGES_REQUESTED`. D4's reviewer enforcement and D6's no-retry rule hold; D2 is not implementable as written.
- Planner revision HX-002 (Codex, gpt-5.6-sol, high, OpenAI): accepted both findings. D2 now covers
  every review spawn and the complete process tree, including profile-state writes and network,
  while D4 and D6 remain unchanged. The owner explicitly authorized Codex to complete implementation,
  commits, and integration for tasks 0036 and 0035.
- Implementation (Codex, owner-authorized): added the host-spawn approval contract to the skill,
  regression coverage, and matching README/security guidance. A first elevated dogfood attempt
  cleared the original `EPERM` and exposed an independent Cursor model-composition defect. The
  adapter now preserves matching effort-encoded aliases and fails closed on a conflict.

## Evidence

- `.spartan-bridge/runs/run-0e2b6ee6-d4b4-4d98-9eb9-a809af62f876/status.json` in the primary
  checkout: `state: failed`, `reason_code: adapter_error`, phase `collect`, cause `exit_nonzero`, exit
  code 1, null verdict, cycle 1 of 3.
- The same run's redacted `adapter-stderr.log`: 57 bytes containing the `EPERM` `mkdir` message above.
- `spartan-bridge doctor --repo <repo>`, 2026-08-21: repository and registry ready; Codex, Cursor,
  and fake launchers resolved; Cursor and Codex interfaces available.
- Official Codex sandbox documentation, checked 2026-08-21: spawned commands inherit sandbox file
  and network boundaries; approval is the supported boundary-crossing mechanism.
- Updated `skills/spbridge/SKILL.md`: every initial, continuation, PATH, and Node-fallback spawn
  requests command-level approval before launch and stops without retry if the host denies it.
- `src/core/review.ts`: `createExclusiveRunDir` runs before adapter `preflight`/`start`; any started
  CLI process has already created a run and cycle.
- `src/adapters/cursor.ts`: `CURSOR_REVIEW_ARGV_PREFIX` and `CURSOR_REVIEW_STREAM_ARGV_PREFIX` still
  contain `--mode plan --sandbox enabled`; `CURSOR_FORBIDDEN_ARGV_TOKENS` includes `disabled`.
- `src/core/review.ts` `resolveReviewChain`: a parent whose `verdict` is not `changes_requested`
  (including the failed 0033 run) is `chain_refused` / `verdict_not_chainable`.
- `tests/spbridge-skill.test.ts`: asserts the loop, `--after-run`, and stop conditions; it forbids
  restoring the retired phrase `Invoke exactly once. Do not retry`.
- First post-permission dogfood run `run-3bb05fa1-51fc-4075-86c5-81858c5138c3`: no `EPERM`; Cursor
  rejected `cursor-grok-4.6-high-fast[effort=high]`, proving the parent boundary was crossed and
  isolating the separate alias-composition defect. The terminal state was `failed` with
  `reason_code: adapter_error`; no retry or chain continuation was attempted.
- Final elevated dogfood run `run-5fb7bf8c-af41-4514-a5d0-37de8c2bc80a`, using an explicit fixture
  with the owner-selected Codex-planner/Cursor-`reviewer.plan` map: terminal state and verdict
  `changes_requested`, `reason_code: review_changes_requested`, cycle 1, and
  `task_write_state: written`. It exited 0 without `EPERM`; no credentials or client paths entered
  the task or status record.
- The existing `~/.agents/skills/spbridge` and `~/.claude/skills/spbridge` symlinks were retargeted
  to this validated worktree and both resolve the new `Before **every** runtime spawn` instruction.
- `git diff --check`, `npm run typecheck`, `npm run build`, and `npm test`: all exit 0; 202 tests
  passed and 0 failed.

## Review

Verdict: CHANGES_REQUESTED

Findings:

- `D2_SPAWN_SCOPE` (error): D2 asks for host approval only "before the first attempt" of "the exact
  Bridge review command." The skill already loops: each cycle is a new spawn, and a continuation's
  argv differs by `--after-run <run_id>`. Codex inherits the parent sandbox per spawn, so cycle 2
  can repeat the recorded `EPERM` even after cycle 1 was approved. The same hole exists for the
  documented `node dist/cli/main.js` fallback, which is a different command string. Pin that every
  `review` spawn in the session — first, `--after-run`, and the node fallback — requests the same
  parent approval before launch, and that a denied spawn is not retried and is never supplied as
  `--after-run`.
- `D2_APPROVAL_UNIT` (error): D2's criterion treats success as "the selected official-client child
  to initialize" (the profile `mkdir`). Context, Constraints, and D3 already require provider
  network as well. Because the CLI creates the run directory before the adapter starts, a
  file-only approval still spends a cycle and dies as `adapter_error`. Pin the approved operation
  as that command's process tree (Bridge plus selected official-client child), covering profile
  writes and network, obtained through the host's command-level escalation on the spawn itself —
  not an informal "ask first" reminder, and not a path allowlist that would name a machine-local
  profile directory in repository files. A denied escalation must occur before the process starts.
  Do not put a Codex approval flag, path, or policy value into the runtime core or CLI schema.

D4 holds: parent approval is specified as launch capability only; Cursor argv, review inputs,
workspace modes, write-detection, integrity comparison, and task-artifact write gates stay as they
are. D6 holds: the skill already stops on `adapter_error`, and a failed run is not chainable. Do
not reopen D4 or D6 except to keep them true after the D2 revision. Re-derive every criterion that
touches D2, including the unnamed live-verification and symlink rows, and name the `AGENTS.md` map
the dogfood uses (this worktree's `reviewer.plan` is Codex, not Cursor).

### Owner-authorized implementation audit

Verdict: APPROVED. Supersedes the `CHANGES_REQUESTED` plan review above.

The two Cursor findings are closed: approval is requested for every distinct spawn and covers the
complete process tree. The runtime and CLI remain host-neutral; the skill owns the Codex-specific
instruction. Cursor review enforcement is unchanged. The additional D7 defect found by live testing
is covered by unit tests and the successful real Cursor verdict. This audit records completion but
is not presented as a separate independent reviewer context.

## Blockers

None.

## Next Action

None. Task 0035 will move the corrected skill into the portable multi-host package and preserve a
non-divergent compatibility path during migration.
