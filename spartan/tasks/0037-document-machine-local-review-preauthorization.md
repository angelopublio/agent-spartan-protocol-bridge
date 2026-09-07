---
protocol: "1.0.0" # x-release-please-version
id: document-machine-local-review-preauthorization
created_at: 2026-08-21
status: completed
phase: complete
task_type: implementation
risk: low-impact
current_role: implementer
next_role: human-operator
updated_at: 2026-08-21
handoff_id: none
next_handoff_id: none
---

# Document machine-local review preauthorization

## Objective

Let a new Bridge user configure Codex, Cursor Agent CLI, and Claude Code so an explicitly
human-started producer/reviewer chain can run `spartan-bridge review` without stopping for a command
approval prompt, while preserving the reviewer read-only boundary and every runtime stop condition.

## Scope

- Link the concise installation guidance in `README.md` to detailed host setup.
- Document exact machine-local allow rules for Codex, Cursor Agent CLI, and Claude Code in
  `docs/AUTHENTICATION-AND-SECURITY.md`.
- Explain profile-isolated paths, executable trust, the Node fallback boundary, and the meaning of
  the three-cycle maximum.
- Add a documentation regression test.

## Decisions

### D1 - Host-native user configuration owns launch permission

The repository grants workflow authority through `AGENTS.md`, but it cannot grant itself shell or
sandbox capability. Each producer host therefore receives a narrow, machine-local rule for the
`spartan-bridge review` command family. The rule is kept out of repository `AGENTS.md`, Bridge
configuration, and project-level host settings.

### D2 - The stable installed executable is the trusted command boundary

The rule covers `spartan-bridge review` with its required arguments and optional `--after-run`.
Users verify the resolved executable before trusting it. The separate development fallback
`node dist/cli/main.js review` is not silently included and may still prompt.

### D3 - Launch capability does not weaken review enforcement

Preauthorization lets the Bridge process tree reach the provider and lets the official client write
machine-local session state. It does not change repository policy, reviewer inputs, read-only mode,
task-write grants, integrity checks, or stop conditions.

### D4 - Three cycles are a ceiling

A `pass` verdict stops after the current review. Only `changes_requested` can return findings to the
same producer session for a revision and another review, and only while the chain remains below the
configured maximum. Terminal failures and human gates stop immediately.

## Acceptance Criteria

- [x] D1: README links to exact machine-local setup for Codex, Cursor Agent CLI, and Claude Code and
      states that repository content cannot self-grant host permission.
- [x] D2: the guide names the normal and isolated-profile paths, verifies the resolved executable,
      covers `--after-run`, and distinguishes the Node fallback.
- [x] D3: the guide states that the reviewer remains read-only and all runtime policy and stop gates
      remain enforced.
- [x] D4: the guide states that `pass` stops on any cycle, `changes_requested` alone may continue,
      cycle 3 is terminal for automatic continuation, and a fourth review is refused.
- [x] Documentation regression tests pin all three rule syntaxes and the README link.
- [x] `git diff --check`, `npm run typecheck`, `npm run build`, and `npm test` exit 0.

## Work Completed

- Added a concise README route from runtime installation and sandbox operation to the detailed
  no-prompt setup.
- Added exact Codex, Cursor Agent CLI, and Claude Code user/profile rules without adding a
  repository self-grant.
- Documented resolved-executable trust, the unapproved Node fallback, profile-isolated paths,
  cross-repository scope, unchanged reviewer enforcement, and immediate stop on `pass`.
- Added documentation regression coverage while keeping active task `0033` isolated in the primary
  checkout.

## Evidence

- Official Codex rules documentation, checked 2026-08-21: user rules live under the active Codex
  configuration layer; an `allow` prefix rule executes matching commands without prompting.
- Official Cursor Agent CLI permissions documentation, checked 2026-08-21: user settings live in
  `~/.cursor/cli-config.json`, and `permissions.allow` accepts `Shell(command:arguments)` patterns.
- Official Claude Code permissions documentation, checked 2026-08-21: user settings live in
  `~/.claude/settings.json` or `$CLAUDE_CONFIG_DIR/settings.json`, and Bash prefix wildcards may be
  placed in `permissions.allow`.
- `tests/host-review-permissions-docs.test.ts` pins the README link, all three host rule syntaxes,
  machine-local ownership, and the maximum-cycle wording.
- `git diff --check`, `npm run typecheck`, `npm run build`, and `npm test`, 2026-08-21: all exited 0;
  206 tests passed and 0 failed.

## Review

Not independently reviewed.

## Blockers

None.

## Next Action

Request the owner's explicit commit and integration authorization. Then commit this task boundary,
fast-forward it into `main`, push if authorized, and archive the dedicated worktree.
