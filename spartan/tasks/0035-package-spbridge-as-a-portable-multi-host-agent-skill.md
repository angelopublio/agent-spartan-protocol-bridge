---
protocol: "1.0.0" # x-release-please-version
id: package-spbridge-as-a-portable-multi-host-agent-skill
created_at: 2026-08-21
status: completed
phase: complete
task_type: implementation
risk: material
current_role: reviewer
next_role: none
updated_at: 2026-08-21
handoff_id: HX-001
next_handoff_id: none
---

# Package spbridge as a portable multi-host agent skill

> Editorial note (2026-09-07): unused platform names and historical integration-document names were generalized for publication. The historical optional-integrations document refers to the former combined cockpit and Board documentation; its Board material is now in `docs/BOARD.md`. Any example path in this cleanup is a normalized placeholder. Original round outcomes, commands, and technical findings are retained; historical line references are not current navigation targets.

## Objective

`spbridge` has one canonical, portable package at `agent-skill/skills/spbridge/` that can be
installed for any supported agent host, while the `spartan-bridge` runtime remains an independent
host-neutral installation. A Codex plugin is one optional distribution wrapper around that package,
not the identity or architecture of the package itself.

## Context

The repository currently ships the skill at `skills/spbridge/`, and README installation examples
link that repository-internal path directly into host skill homes. The owner explicitly settled a
different public shape: move the complete skill structure to `agent-skill/skills/spbridge/`, make
`agent-skill/` the portable multi-host package, and keep each host plugin or installer as an optional
adapter around it.

This work was requested before task `0033` but was not persisted at the time. This artifact exists
so the decision and its migration work no longer depend on conversation history.

Task `0036` corrects the urgent Codex-parent-sandbox invocation failure at the current skill path.
Implement `0036` first; this task then moves the corrected package and must preserve that behavior.

## Scope

- Move the complete `skills/spbridge/` tree to `agent-skill/skills/spbridge/`, including
  `SKILL.md`, `agents/openai.yaml`, and any future resources owned by the skill.
- Define `agent-skill/` as the canonical portable multi-host package boundary.
- Update repository tests, documentation, examples, and maintained path references to the new
  canonical location.
- Provide installation instructions that separately cover the runtime, direct skill installation,
  and optional host-plugin installation.
- Provide a bounded installer that migrates existing named symlinks directly to the new canonical
  path so the retired repository directory can be removed completely.
- Describe how future Claude, Cursor, Codex, and later host adapters wrap or expose the same portable
  package without moving runtime authority into a skill.

## Out of Scope

- Moving policy resolution, state transitions, permissions, locks, events, or adapter dispatch out
  of the Bridge runtime.
- Making an external desktop UI or the Agent Spartan Protocol Board a runtime dependency.
- Publishing to a package registry, plugin marketplace, or public Git host in this task; publication
  remains a separate human-authorized release action.
- Changing the Agent Spartan Protocol's own installation paths.
- Reimplementing the Codex-parent-sandbox fix owned by task `0036`; this task only preserves it while
  moving the package.

## Constraints

- The portable package must not be named or structured as a Codex-only plugin.
- The `spartan-bridge` CLI remains the required host-neutral interface. Skills, MCP, and plugins are
  optional adapters.
- A checkout-relative symlink may be documented for contributors, but public installation guidance
  must also work for a user installing on another notebook.
- Installation must not copy credentials, auth files, tokens, cookies, account identifiers, or
  private official-client state.
- Existing users receive an explicit migration command or installer path; the old location must not
  remain as an undocumented second source of truth.

## Decisions

### D1 - The canonical package root is `agent-skill/`

The full skill moves to `agent-skill/skills/spbridge/`. `agent-skill/` names a portable agent-skill
distribution boundary, not a Codex plugin and not the Bridge runtime. There is one maintained
`SKILL.md`; host wrappers must consume it rather than fork it.

### D2 - Runtime and host integration install independently

The runtime installation makes `spartan-bridge` and, when selected, `spartan-bridge mcp-stdio`
available. The skill installation makes `spbridge` discoverable by a host. Installing one does not
pretend to install the other, and the README includes a verification command for each layer.

### D3 - Plugins are host-specific distribution wrappers

A Codex plugin may package or point at `agent-skill/skills/spbridge/`; equivalent Claude, Cursor, or
future host packaging may do the same. Plugin manifests, marketplace metadata, and host invocation
syntax belong to those wrappers. They do not become runtime dependencies or alternate copies of the
skill instructions.

### D4 - The move includes an explicit installed-link migration

The old repository directory is removed; there is no compatibility shim. The installer detects an
existing explicitly named `spbridge` symlink, replaces that link only, and verifies that the host
resolves the new package. It refuses real files/directories and leaves every unrelated skill entry
unchanged.

### D5 - Public documentation starts from a clean notebook

README instructions distinguish contributor linking from public installation and state prerequisites,
runtime installation, skill/plugin installation, host discovery paths, verification, upgrade, and
uninstall. Examples use placeholders or installer commands rather than this owner's absolute paths.

## Acceptance Criteria

- [x] D1: `agent-skill/skills/spbridge/SKILL.md` and its metadata are the only maintained `spbridge`
      skill source; the retired repository directory is absent and there is no compatibility shim.
- [x] D1: every repository test and maintained reference resolves the canonical new path, and a
      repository-wide search reports no stale path presented as current installation guidance.
- [x] D2: README provides separate, executable runtime and skill installation/verification flows,
      and makes clear that the CLI works without the skill and the skill cannot replace the runtime.
- [x] D3: any Codex plugin files are confined to an optional host wrapper and reuse the portable
      skill package; no core runtime import depends on plugin files.
- [x] D3: documentation states how Claude, Cursor, Codex, and future adapters can expose the same
      package while retaining host-specific invocation syntax and permission handling.
- [x] D4: an existing symlink that points to the old repository path has a bounded migration and ends
      pointing to `agent-skill/skills/spbridge`; unrelated skill links are unchanged.
- [x] D5: a new-user walkthrough begins from a clean clone or published artifact on another notebook,
      contains no owner-specific absolute path, and covers install, verify, update, and uninstall.
- [x] D5: README clearly distinguishes runtime installation from direct skill installation and from
      optional plugin installation.
- [x] The corrected sandbox-aware invocation behavior accepted in task `0036` survives the move and
      its tests resolve the new path.
- [x] `git diff --check`, `npm run typecheck`, `npm run build`, and `npm test` exit 0.

## Work Completed

- Recorded the owner's previously unpersisted package decision and its required migration surface.
- Separated this durable packaging task from the active, dirty task `0033` by authoring it in a
  dedicated worktree.
- Moved the complete skill to `agent-skill/skills/spbridge/` and removed the old directory without a
  compatibility shim, as the owner explicitly requested.
- Added a portable package README, bounded direct-link installer, optional Codex plugin manifest,
  and repository marketplace entry. Updated maintained documentation and tests to the canonical path.
- Migrated the machine's existing `~/.agents/skills/spbridge` and `~/.claude/skills/spbridge`
  symlinks to the canonical worktree package; both resolved `SKILL.md` after migration.

## Evidence

- Repository inspection, 2026-08-21: the current package contains
  `skills/spbridge/SKILL.md` and `skills/spbridge/agents/openai.yaml`; README and
  `tests/spbridge-skill.test.ts` use the old path.
- `package.json`, 2026-08-21: the runtime package is currently private and exposes
  `spartan-bridge` from `dist/cli/main.js`, confirming runtime publication and skill/plugin
  distribution are separate release concerns.
- `agent-skill/.codex-plugin/plugin.json`: its `skills` field is `./skills/`, so the Codex wrapper
  consumes the canonical package in place. No runtime source imports `.codex-plugin` or `.agents`.
- `agent-skill/scripts/manage-install.sh`: the executable installer accepts only the named host
  groups, refuses non-symlink destinations, migrates only `spbridge`, verifies `SKILL.md`, and
  uninstalls only a link pointing to its own canonical source.
- `tests/spbridge-package.test.ts`: a temporary clean home migrated an old `spbridge` link, installed
  both discovery paths, preserved an unrelated link, and removed only its own links on uninstall.
- `sh -n`, the skill validator, and the Codex plugin validator all exited 0.
- `git diff --check`, `npm run typecheck`, `npm run build`, and `npm test` all exited 0; 204 tests
  passed and 0 failed.
- Main integration verification caught and corrected the README's initial `spartan-bridge help`
  example to the shipped `spartan-bridge --help` form. The local Codex marketplace then installed
  `spbridge@spartan-bridge` version `0.1.0` as enabled, and its discovered `SKILL.md` contained the
  task 0036 parent-sandbox instruction. This marketplace registration is machine-local and did not
  publish or upload the repository.

## Review

Verdict: APPROVED

Findings:

- None. Owner-authorized implementation audit: the package has one instruction source, the old
  repository directory is absent, runtime and skill installs are independent, the Codex manifest
  reuses the portable tree, and the installer regression proves bounded migration. This audit is
  not presented as a separate independent reviewer context.

## Blockers

None. Task `0036` was implemented and committed first; its sandbox-aware behavior and tests moved
with the canonical skill.

## Next Action

None. Integration will retarget the two machine-local links from this worktree to the canonical
`main` checkout and install the optional Codex wrapper from that checkout.

## Next Handoff

No outstanding handoff. This task is closed.
