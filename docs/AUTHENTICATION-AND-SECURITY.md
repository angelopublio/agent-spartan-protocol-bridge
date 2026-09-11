# Authentication and Security

## Absolute authentication boundary

The Bridge does not authenticate a provider or a user. It is not a credential broker, login manager, provider-account inspector, or billing detector. It may route an opaque user-defined `client_context` alias, but it never discovers or identifies the account behind that alias.

A human authenticates directly in each official local client before a Bridge run. The Bridge starts that client and lets the client use its own private credential store. The Bridge may declare which model a binding should use; it must not enumerate, inspect, or query which models an account is entitled to. The following data must never be accepted, received, read, copied, selected, stored, logged, proxied, or persisted by the Bridge:

- API keys or bearer tokens;
- cookies or browser session values;
- provider authentication files or their contents;
- Keychain or other operating-system credential records;
- account passwords, recovery data, or multifactor codes;
- account identifiers obtained from provider credential stores;
- credential variables such as `CURSOR_API_KEY`;
- login URLs, callbacks, or browser sessions controlled by the Bridge.

There are no `spartan-bridge login`, `logout`, `account`, or credential-import commands. If an official client reports that external authentication is required, the Bridge records a non-sensitive `provider_auth_required` state, stops, and asks the human to authenticate outside the Bridge.

## Provider ownership

| Provider surface | Authentication owner | Bridge behavior |
| --- | --- | --- |
| Claude Code local client | Claude Code | Start the installed official client; never inspect or manage its sign-in |
| Codex local client | Codex | Start the installed official client; never inspect or manage its ChatGPT sign-in |
| Official Cursor local client or interface | Cursor | Use only after a supported local adapter and permission mode are validated |

The official [Codex authentication documentation](https://learn.chatgpt.com/docs/auth) explains authentication within Codex itself. Those login operations are intentionally not reproduced or wrapped by the Bridge.

## Subscription use and billing claims

The project is designed to invoke already-authenticated official clients so users can use the access those clients provide. The Bridge does not request a provider API key and does not implement a provider API transport.

The Bridge cannot certify that a particular execution is included in a subscription. Provider terms, client modes, and billing behavior belong to each official client and may change. Before enabling a real adapter, maintainers must document from current official provider sources which client command is supported and what the provider says about its billing behavior. The user confirms the intended account and plan directly in the official client.

An operational launch policy may be named `official_clients_only`. It means:

- only supported official local client commands may be launched;
- no provider credential may be supplied in a Bridge request, argument, repository file, MCP registration, or runtime configuration;
- no direct provider API transport is implemented by the Bridge;
- an indeterminate or unsupported client mode stops for a human.

It is not an authentication profile and does not select or certify an account or subscription.

## Multiple client contexts

The Bridge may resolve an arbitrary non-secret context alias declared by repository policy, such as `personal`, `company`, `hobby`, or `client-a`. Aliases are exact lower-case ASCII strings matching `[a-z0-9][a-z0-9._-]{0,63}`; resolution performs no case folding or Unicode normalization. `default` is reserved for the externally selected fallback context. The alias selects an externally prepared official-client launch context; it is not a provider account ID, credential profile, or built-in Bridge account type.

A repository may declare:

```markdown
| Binding | Host | Client context | Model | Effort |
| --- | --- | --- | --- | --- |
| planner | Codex | personal | gpt-5.6-terra | high |
| implementer | Cursor | hobby | Composer-2.5 | none |
```

A user-local, uncommitted registry then maps `client_context + host` to a non-secret launcher identifier. See [Configure the client-context registry](#configure-the-client-context-registry).

The Bridge validates the alias syntax, resolves only a pre-registered host entry, and directly spawns the registered launcher without shell interpolation. An absent context means the externally selected `default` context. An unknown alias, missing host mapping, or client-reported authentication requirement stops for the human.

If an official client cannot safely keep account contexts separate, use separate operating-system contexts or authenticate the intended account directly in that client before starting the run. The Bridge must not compensate by manipulating credential stores.

## Configure the client-context registry

Create one registry file on the machine that runs the Bridge. Do not put it in a repository, do not commit it, and do not confuse it with optional in-repo `spartan-bridge/config.yaml`.

| Condition | Path |
| --- | --- |
| `XDG_CONFIG_HOME` is set to a non-empty value | `$XDG_CONFIG_HOME/spartan-bridge/client-contexts.yaml` |
| otherwise | `$HOME/.config/spartan-bridge/client-contexts.yaml` |

Every clone on that Mac reads this same file. The repository `AGENTS.md` only names an alias such as `personal` or `company`; this file maps that alias plus a host to a launcher identifier.

### Closed schema

The file must be YAML with exactly two top-level keys:

- `schema_version`: the integer `1` (a quoted `"1"` is rejected)
- `client_contexts`: a map of aliases

Each alias must match `[a-z0-9][a-z0-9._-]{0,63}` with no case folding. `default` is reserved for the fallback used when `AGENTS.md` omits the column. Each alias object must contain exactly the four canonical host keys `codex`, `claude`, `cursor`, and `grok`. Each host value must be exactly `{ launcher: <non-empty string> }`. Unknown keys, duplicate YAML keys, missing hosts, and credential-shaped field names (`api_key`, `token`, `auth_file`, and similar) fail closed.

Production registers four launchers: the in-process `fake-reviewer-v1`, the official-client `cursor-plan-reviewer-v1`, the official-client `codex-plan-reviewer-v1`, and the official-client `grok-plan-reviewer-v1`. The registry still names only an identifier. Executable, argument array, and environment come from the application-owned catalog. A different identifier is accepted by the parser and then fails as `launcher_unavailable` until a later slice registers it.

```yaml
schema_version: 1
client_contexts:
  personal:
    codex:
      launcher: fake-reviewer-v1
    claude:
      launcher: fake-reviewer-v1
    cursor:
      launcher: fake-reviewer-v1
    grok:
      launcher: fake-reviewer-v1
  company:
    codex:
      launcher: fake-reviewer-v1
    claude:
      launcher: fake-reviewer-v1
    cursor:
      launcher: fake-reviewer-v1
    grok:
      launcher: fake-reviewer-v1
```

Replace `company` with any valid alias you use in `AGENTS.md` (`hobby`, `client-a`, and so on). Each alias is only a routing label. It is not an email address, provider account, or subscription.

When a later slice registers real launchers, keep this file limited to identifiers such as `codex-personal` or `claude-company`. Still include all four hosts on every alias. Do not put executable paths, argument arrays, or environment values in the YAML; those belong in the application-owned launcher catalog, not in this registry.

### What must never appear in this file

- tokens, cookies, API keys, or Keychain references;
- account emails, usernames, or provider account identifiers;
- auth-file paths or official-client config-directory paths;
- credential environment variables, including `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `CURSOR_CONFIG_DIR`, `GROK_HOME`, `ANTHROPIC_API_KEY`, `CODEX_API_KEY`, `CURSOR_API_KEY`, and `XAI_API_KEY`;
- shell commands, wrapper scripts, or `PATH` entries.

Official clients may isolate already-authenticated sessions with their own documented config-directory variables. Those variables belong in a launcher or cockpit you control on this Mac, never in this registry and never in repository files. The Bridge itself never sets one. A parent shell you control may export a documented per-host config-dir variable (`GROK_HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`) before starting `spartan-bridge`; the matching adapter forwards it to its own child on a closed per-host allowlist and nowhere else — see "What the Bridge forwards to Codex", "What the Bridge forwards to Grok", and "What the Bridge forwards to Claude Code". The client-context registry maps only `context + host -> launcher id`; it never carries an environment, so selecting the right isolated profile for a context is the invoking shell's job. User-local cockpit settings are not Bridge configuration and must not be copied into `AGENTS.md` or `client-contexts.yaml`.

Each launcher and official client is prepared and authenticated outside the Bridge. After editing the registry, `spartan-bridge doctor --repo <path>` reports whether the file is readable and whether named launchers resolve. It does not inspect which account is signed in.

## Use Grok as an official client

Grok Build is a first-class Bridge host. The display name in `AGENTS.md` is `Grok`; the canonical registry key is `grok`; the production launcher id is `grok-plan-reviewer-v1`. The adapter spawns the official executable `grok` only. Do not point the Bridge at the PATH name `agent`: the Grok installer may create that alias, and it collides with Cursor Agent CLI.

### Install and authenticate Grok

1. Install the official Grok CLI (`grok --version` must resolve).
2. If the installer also created `~/.local/bin/agent` as a Grok alias, remove that link so Cursor keeps `agent` / `cursor-agent`. Keep `grok` as the Bridge executable.
3. Sign in with the official client (`grok login` or the interactive TUI). Credentials stay in the official store (`$HOME/.grok/auth.json` or `$GROK_HOME/auth.json`). The Bridge never reads that file and never accepts `XAI_API_KEY` as Bridge configuration.
4. Add a `grok` entry to every alias in the machine-local registry, for example `launcher: grok-plan-reviewer-v1` under `personal.grok`.

### Bind Grok in a repository

```markdown
| Binding | Host | Client context | Model | Effort |
| --- | --- | --- | --- | --- |
| planner | Grok | personal | grok-4.5 | high |
| reviewer.plan | Grok | personal | grok-4.5 | high |
| implementer | Grok | personal | grok-4.5 | high |
| reviewer.implementation | Grok | personal | grok-4.5 | high |
```

Same-host author and reviewer bindings are allowed as session isolation only. The Bridge still requires a fresh `grok -p` child for each mapped review or producer round.

### Make the Bridge registry visible under an isolated profile HOME

When machine-local isolation relocates `HOME` for Cursor Agent CLI (and for any Grok session started under that relocated home), the official Grok login is stored under the profile home — typically `~/.agent-profiles/<alias>/cursor-home/.grok/auth.json`. The Bridge registry, however, normally lives under the Mac login account's `~/.config/spartan-bridge/client-contexts.yaml`.

If you run `spartan-bridge` from a shell whose `HOME` is the relocated profile home, the Bridge looks for `$HOME/.config/spartan-bridge/client-contexts.yaml` and will report `registry_unavailable` unless that file is visible there. Fix it once per profile by linking the login-account registry into the relocated home. Do not copy credentials. Do not put the absolute path in a repository.

```sh
# Login-account home (directory-service home), not the relocated profile HOME.
REAL_HOME=$(eval echo "~$(whoami)")

mkdir -p "$HOME/.config/spartan-bridge"
ln -sf "$REAL_HOME/.config/spartan-bridge/client-contexts.yaml" \
  "$HOME/.config/spartan-bridge/client-contexts.yaml"

spartan-bridge doctor --repo /path/to/repository
```

Expected doctor lines after a working Grok setup include:

- `registry: readable; schema valid`
- `grok-plan-reviewer-v1: executable resolved; interface available`
- `binding reviewer.plan: adapter available; launcher=grok-plan-reviewer-v1`
- the same available result for `reviewer.implementation` and `implementer` when `AGENTS.md` binds those rows to Grok

After that symlink exists, ordinary commands need no extra environment variables:

```sh
spartan-bridge doctor --repo .
spartan-bridge review --repo . --task spartan/tasks/<task>.md
```

### What the Bridge forwards to Codex

Review children receive only the closed `CODEX_ENV_ALLOWLIST`: `PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL`, `TERM`, plus `CODEX_HOME` and `AGENT_PROFILES_REAL_HOME` only when the parent already exports them. Producer children receive those same forwarded keys plus one Bridge-originated, non-secret marker: `SPARTAN_BRIDGE_PRODUCER_ISOLATED=1`. That marker is the only additional environment key and lets repository checks identify the intentionally reduced isolated producer copy; it is not forwarded from the parent and carries no client context, profile path, or credential. The Bridge never sets or reads the forwarded values. Review spawns pass `--sandbox read-only`. Producer spawns pass `--sandbox danger-full-access` because Codex's inner `workspace-write` seatbelt does not compose with the Bridge's outer Darwin profile (D-070). The outer profile globally denies writes, then permits the Bridge-owned isolated producer workspace and the child environment's existing `HOME` and `TMPDIR`, with a final deny for the canonical live repository root (D-072).

Producer preflight first verifies the existing `codex exec --help` interface and then runs `/usr/bin/sandbox-exec` with a minimal allow-default probe profile. A non-Darwin host or an unavailable interface makes the `implementer` binding unavailable before any producer child is spawned.

### What the Bridge forwards to Grok

Review children receive only the closed allowlist documented with the other hosts. For Grok that allowlist is `PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL`, `TERM`, and parent-exported `GROK_HOME` when already set. Producer children receive those same forwarded keys plus the sole Bridge-originated environment key, the non-secret `SPARTAN_BRIDGE_PRODUCER_ISOLATED=1` marker described above. The Bridge never sets `HOME` or `GROK_HOME` itself. Prefer authenticating under the same `HOME` the Bridge child will inherit, or export `GROK_HOME` in the parent shell that starts `spartan-bridge` if you intentionally keep Grok config outside `$HOME/.grok`.

Review spawns still pass Grok `--sandbox strict`. Producer spawns pass `--sandbox none` and rely on the Bridge's allow-list-shaped Darwin `sandbox-exec` profile around the isolated producer workspace (D-072): nesting Grok's own `workspace` or `strict` profile under that outer profile fails to initialize on this host.

### What the Bridge forwards to Claude Code

The reviewer child (`claude-plan-reviewer-v1`) receives the closed allowlist `PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL`, `TERM`, plus `CLAUDE_CONFIG_DIR`, `USER`, and `AGENT_PROFILES_REAL_HOME` **only when the parent process already exports them** (D7 of task `0047`, D-046; `AGENT_PROFILES_REAL_HOME` added by task `0057`). `CLAUDE_CONFIG_DIR` is the Claude Code CLI's config-directory override that holds the isolated-profile OAuth credentials (default `~/.claude`); `USER` is read to resolve the macOS keychain account, without which a Bridge-spawned `claude -p` reports "Not logged in" even under a signed-in profile. `AGENT_PROFILES_REAL_HOME` is a marker a machine-local wrapper exports before relocating `HOME` for a `cursor-agent` session: `claude` reads login state (`~/.claude.json`, Keychain) from `HOME` rather than `CLAUDE_CONFIG_DIR`, so a review dispatched from a relocated-`HOME` session exits "Not logged in" unless the wrapper's nested-invocation guard can see this marker and restore the real `HOME`. The Bridge forwards it; it never sets `HOME`. The Bridge never sets, defaults, reads, copies, or logs either — the same forward-when-present shape as `GROK_HOME` above. The credential-class prohibition earlier in this file bars these variables from the registry, repository files, and a Bridge process environment the launcher deliberately sets; it does not bar a parent shell you control from exporting a documented per-host config-dir variable that the adapter then forwards to its own child. The adapter spawns `claude -p --output-format stream-json --verbose --json-schema <inline> --permission-mode plan --allowed-tools Read,Grep,Glob --disallowed-tools Write,Edit,NotebookEdit,Bash,WebFetch,WebSearch`; the verdict is read from the stream's terminal `result` record and the schema forces it to the contract.

## Isolate official clients on one Mac

The Bridge still does not authenticate, inspect accounts, or set credential environment variables. On a single machine, the official Claude Code and Codex CLIs share default stores (`~/.claude` and `~/.codex`) unless each launch context uses its own config directory. Signing into a second account against the shared defaults can overwrite the session used by the other.

Isolation belongs **outside** the Bridge: the official clients keep separate config directories, and a machine-local wrapper or cockpit selects which directory to use. Those paths and environment variables stay on the machine. They must not appear in `AGENTS.md`, `client-contexts.yaml`, MCP registrations, or any committed file.

### Do not map a mixed parent folder

Personal and company clones may sit as siblings under the same parent directory. Mapping that parent (or another shared documents tree) to one alias is wrong: a neighboring clone would inherit the other session.

Map only directories that always belong to one alias, or declare the alias on the repository itself.

### Declare the alias in repository `AGENTS.md`

```markdown
| Binding | Host | Client context | Model | Effort |
| --- | --- | --- | --- | --- |
| planner | Claude Code | company | Opus | high |
| reviewer.plan | Codex | company | gpt-5.6-terra | high |
| implementer | Cursor | company | Composer-2.5 | none |
| reviewer.implementation | Codex | company | gpt-5.6-terra | high |
```

A repository that should use the `personal` launch context either names `personal` or omits the column.

### Machine-local resolution (wrappers, not the Bridge)

A user-local resolver may choose a profile in this order:

1. the unique `Client context` value in the nearest `AGENTS.md` Agent hosts table;
2. otherwise the longest matching prefix in a user-local roots map;
3. otherwise `personal`.

If one `AGENTS.md` table names more than one distinct alias, treat that as ambiguous and fall through to the roots map or `personal`.

Every resolved alias, including `personal`, uses `~/.agent-profiles/<alias>/` for Claude Code, Codex, and Cursor. The wrapper always points those clients at that alias’s directories. Keep the wrapper directory ahead of the real binaries on `PATH`. Never copy `auth.json` or other credential files between profile directories; sign in once inside each profile.

User-local cockpit settings must not be copied into `AGENTS.md` or `client-contexts.yaml`.

Put `$HOME/.agent-profiles/bin` first on `PATH` in the shell the IDE terminal actually starts (for zsh, both `~/.zprofile` and `~/.zshrc`):

```sh
export PATH="$HOME/.agent-profiles/bin:$PATH"
```

Example resolver and wrapper scripts live in [`docs/examples/agent-profiles/`](examples/agent-profiles/). Install them with [`install-agent-profiles`](examples/agent-profiles/install-agent-profiles); do not commit `~/.agent-profiles`.

### Cursor is a different client surface

Claude Code and Codex honor config-directory environment variables. Cursor does not switch accounts because the current folder changed. Two Cursor surfaces need two different isolations, both selected by the same wrapper:

| Surface | How the wrapper isolates it | What still shares an account |
| --- | --- | --- |
| Cursor Agent CLI (`cursor-agent` or `agent`) | A per-profile `HOME` so login is `$HOME/.cursor/auth.json` under `~/.agent-profiles/<alias>/cursor-home`, plus `AGENT_CLI_CREDENTIAL_STORE=file` | Using unwrapped `agent` / `cursor-agent`, or relying on `CURSOR_CONFIG_DIR` alone (the CLI ignores that variable for `auth.json` on macOS) |
| Cursor app (`cursor`) | `--user-data-dir` and `--extensions-dir` under `~/.agent-profiles/<alias>/cursor-app` | Opening `Cursor.app` from the Dock, Spotlight, or Finder |

Open a company repository in the Cursor app only by running `cursor .` from that repository’s terminal so the wrapper injects `--user-data-dir`. A window already opened from the Dock keeps the default account even if you later File > Open the company folder.

On macOS the Agent CLI stores login at `$HOME/.cursor/auth.json` and may also reuse one Keychain login. `CURSOR_CONFIG_DIR` only relocates CLI settings, not that auth file. The wrapper therefore gives `cursor-agent` / `agent` a per-profile `HOME` under `~/.agent-profiles/<alias>/cursor-home` and sets `AGENT_CLI_CREDENTIAL_STORE=file`. It never sets `CURSOR_API_KEY` and never copies `auth.json`. Sign in once per profile with `cursor-agent login` in that repository’s terminal, and once in each isolated Cursor app window.

### Set up on a new Mac

Do this on the machine, not in a repository. Never copy `auth.json`, Keychain items, or other credential files from another Mac or alias. Sign in again on the new machine.

1. Install the official Claude Code, Codex, and Cursor clients, and confirm they run without the wrapper (`claude --version`, `codex --version`).
2. From a clone of this repository, run [`docs/examples/agent-profiles/install-agent-profiles`](examples/agent-profiles/install-agent-profiles). It copies `resolve-profile` and `wrap-official-client` to `~/.agent-profiles` and points `claude`, `codex`, `cursor`, `cursor-agent`, and `agent` at that wrapper. It never copies `auth.json` or skill sources, and it does not modify Agent Spartan Protocol.
3. Create empty profile directories `~/.agent-profiles/personal` and `~/.agent-profiles/<alias>` (for example `company` or `client-a`) if the installer has not already created them. The wrapper creates `claude`, `codex`, `cursor`, `cursor-app`, and `cursor-home` under each alias on first use.
4. If `~/.agent-profiles/roots` is still the example file, add a tab-separated prefix only for trees that always belong to one alias (for example a company-only cockpit). Do not map a parent folder that contains both personal and company clones. Prefix matching is case-insensitive so symlink spelling does not drop a worktree onto `personal`.
5. Prepend `$HOME/.agent-profiles/bin` on `PATH` in `~/.zprofile` and `~/.zshrc` as shown above. Restart the IDE so integrated terminals reload `PATH`.
6. On one company clone, add a unique `Client context` column to `AGENTS.md`. Neighboring personal clones can omit the column. You do not need to stamp every company repository.
7. Keep any cockpit configuration user-local. User-local cockpit settings must not be copied into `AGENTS.md` or `client-contexts.yaml`.
8. Keep the portable Spartan skill installed the way Agent Spartan Protocol documents (`~/.claude/skills` and `~/.agents/skills`). Do not change that package to compensate for Bridge isolation. Then, from a repository for each alias, run `claude --version` and `codex --version` so the wrapper can mirror those skills into the isolated Codex home. Restart Claude Code and Codex. See [User skills under isolation](#user-skills-under-isolation).
9. Open two IDE windows and follow [Verify isolation](#verify-isolation). Sign in with `/login`, `codex login`, and `cursor-agent login` in **each** window so each alias gets its own session.
10. If that Mac will use Grok under the same relocated profile `HOME`, follow [Use Grok as an official client](#use-grok-as-an-official-client): install and sign in to Grok, register `grok-plan-reviewer-v1`, remove any Grok `agent` PATH collision, and symlink the login-account Bridge registry into each relocated profile home that will run `spartan-bridge`.

### User skills under isolation

Do not change Agent Spartan Protocol for Bridge profile isolation. The portable skill keeps its documented install (`~/.claude/skills` for Claude Code, `~/.agents/skills` for Codex and Cursor). Relocating `CODEX_HOME` is a machine-local Bridge wrapper concern; the wrapper must keep those existing skill homes visible.

When this wrapper relocates Codex or Cursor Agent CLI config, those clients stop seeing the protocol skill homes unless the wrapper mirrors them:

- Codex: `CODEX_HOME=~/.agent-profiles/<alias>/codex` loads only `$CODEX_HOME/skills`.
- `cursor-agent` / `agent`: `HOME=~/.agent-profiles/<alias>/cursor-home` loads `$HOME/.agents/skills` (and the other host skill dirs) under that isolated home.

Without mirroring, a protocol-standard Spartan install stays visible in Claude Code and in the Cursor app, and disappears from isolated Codex and from `agent`.

| Host | Protocol-documented global home | What the Bridge wrapper does |
| --- | --- | --- |
| Claude Code | `~/.claude/skills/<name>` | Symlinks the whole `skills` directory into `$CLAUDE_CONFIG_DIR/skills` |
| Codex | `~/.agents/skills/<name>` | Symlinks each skill that contains `SKILL.md` into `$CODEX_HOME/skills`. Also mirrors `~/.codex/skills/*` when that directory already exists. It cannot share the whole Codex skills directory, because `.system` skills stay per profile |
| Cursor | `~/.agents/skills/<name>` (also reads `~/.claude/skills` and `~/.codex/skills`) | The Cursor app keeps the real `HOME`, so it still sees those paths. `cursor-agent` / `agent` relocate `HOME` to the profile `cursor-home`, so the wrapper mirrors only the `skills` directories into that isolated home |

`agent-scripts/scripts/sync-skills` only links skills from that repository. It does not install Spartan and is not a Bridge installer.

After installing or refreshing the wrappers, create the per-profile mirrors from a repository for each alias:

```sh
"$HOME/.agent-profiles/resolve-profile"
claude --version
codex --version
cursor-agent --help >/dev/null
```

Isolated Codex should then show `spartan` under `$CODEX_HOME/skills`, linked from `~/.agents/skills/spartan`. Isolated `agent` / `cursor-agent` should show the same skill at `$HOME/.agents/skills/spartan` inside the profile `cursor-home`. Restart Claude Code, Codex, and any running Agent CLI session after the links appear. Adding a user skill later requires another wrapped invocation in each profile; `link_home_dot` only creates missing links.

A WebStorm or other IDE terminal opened on a Git worktree is the same machine-local wrapper path. The tab named Codex is an ordinary shell, not a skill host by itself. In that tab:

```sh
pwd
"$HOME/.agent-profiles/resolve-profile"
which codex
echo "$CODEX_HOME"
ls "$HOME/.agent-profiles/$( "$HOME/.agent-profiles/resolve-profile" )/codex/skills/spartan/SKILL.md"
```

`which codex` must be `$HOME/.agent-profiles/bin/codex`. Then start a **new** `codex` process and invoke `$spartan`. An existing Codex TUI started before the wrapper mirrored the skill will not see it until that process exits.

Do not copy skill files, do not copy `auth.json`, and do not add a third install path to the protocol package.

### Verify isolation

Use two IDE windows (WebStorm, or another editor with an integrated terminal). Do not mix the two repositories in one window. Each terminal’s working directory must be that repository’s root (`pwd`). After changing wrappers or `PATH`, open **new** terminals.

**1. Wrappers are first on PATH**

```sh
which claude
which codex
which cursor
which cursor-agent
which agent
```

Each must print `$HOME/.agent-profiles/bin/<name>`, not only `$HOME/.local/bin`. If `agent` still points at `~/.local/bin/agent`, the CLI will share one login across repositories.

**2. The resolver picks the alias from this folder**

```sh
"$HOME/.agent-profiles/resolve-profile"
```

Expect `personal` in a repository whose `AGENTS.md` names `personal` or omits the column. Expect the other alias (for example `company`) in a repository whose table names that alias.

**3. Claude Code and Codex use that alias’s directories**

```sh
sh -x "$HOME/.agent-profiles/bin/claude" --version 2>&1 | grep CLAUDE_CONFIG_DIR
sh -x "$HOME/.agent-profiles/bin/codex" --version 2>&1 | grep CODEX_HOME
```

Expect `$HOME/.agent-profiles/personal/claude` (and `.../codex`) in the personal window, and `$HOME/.agent-profiles/<alias>/claude` in the other.

**4. Cursor CLI uses a per-profile HOME (not the shared `~/.cursor/auth.json`)**

```sh
sh -x "$HOME/.agent-profiles/bin/cursor-agent" status --help 2>&1 | grep 'HOME='
```

Expect `$HOME/.agent-profiles/personal/cursor-home` in the personal window and `$HOME/.agent-profiles/<alias>/cursor-home` in the other. If both print the real user home, Cursor CLI will show the same account in both windows.

**5. Signed-in accounts differ**

Still in that project’s terminal:

```sh
codex login status
cursor-agent status
claude
```

Inside Claude Code, run `/status`. For the Cursor app, run `cursor .` from that same terminal and check the account in **that** window, not in a window opened from the Dock.

If a profile prints `Not logged in`, run `/login`, `codex login`, or `cursor-agent login` in **that** window. Never copy `auth.json`. If Cursor CLI is logged in with the wrong account, `cursor-agent logout` then `cursor-agent login` in that terminal only.

The two windows must show different accounts for Claude, Codex, and `cursor-agent`. If they match, the terminal is not using the wrapper, `pwd` is not the repository root, `HOME` was not relocated for Cursor CLI, the Cursor app was opened from the Dock, or both profiles were signed in with the same login.

**6. Protocol skills remain visible inside the isolated Claude, Codex, and Cursor CLI homes**

```sh
ls -l "$HOME/.claude/skills"
ls -l "$HOME/.agents/skills"
ls -l "$HOME/.agent-profiles/personal/claude/skills"
ls -l "$HOME/.agent-profiles/personal/codex/skills"
ls -l "$HOME/.agent-profiles/personal/cursor-home/.agents/skills"
ls -l "$HOME/.agent-profiles/<alias>/claude/skills"
ls -l "$HOME/.agent-profiles/<alias>/codex/skills"
ls -l "$HOME/.agent-profiles/<alias>/cursor-home/.agents/skills"
```

Claude: each profile `skills` path must be a symlink to `~/.claude/skills` (or contain the same skill names). If that link is missing, isolated Claude Code will not see `/spartan`.

Codex: each profile `$CODEX_HOME/skills` must list `spartan`, linked from the protocol home `~/.agents/skills/spartan` (or from `~/.codex/skills/spartan` when that path already exists). `.system` is local to the profile and is not a user skill.

Cursor Agent CLI: `~/.agent-profiles/<alias>/cursor-home/.agents/skills` must be a symlink to `~/.agents/skills`. If that link is missing, `agent` will not see `/spartan` even though `cursor-agent status` shows a logged-in account. Restart the Agent CLI session after the profile link appears.

**7. Bridge reviewer bindings resolve from each isolated host**

From each isolated host (including a `cursor-agent` session whose `HOME` is relocated), run:

```sh
spartan-bridge doctor --repo <a Bridge consumer repository>
```

Confirm every reviewer binding reports `adapter available`. When a binding is unavailable, `doctor` prints `output_excerpt` from the launcher preflight and, for known wrapper failures, a fix hint pointing back to this document and `docs/examples/agent-profiles/wrap-official-client`.

## No secrets in Bridge inputs or repository configuration

Provider secrets are prohibited in:

- `AGENTS.md`, in-repo `spartan-bridge/config.yaml`, and the user-local `client-contexts.yaml` registry;
- MCP project files and skill arguments;
- CLI arguments and tool requests;
- task artifacts, prompts, handoffs, and fixtures;
- runtime state, events, logs, and support bundles;
- process environment values intentionally supplied to the Bridge.

Project MCP files contain only an executable and non-secret arguments. The launching host must not inject provider credential variables into the Bridge process. Official client processes obtain credentials directly from stores owned by those clients, not through the Bridge.

## `doctor` behavior

`spartan-bridge doctor` checks only non-secret integration facts: repository readability, policy readiness, registry readability and schema, launcher identifier resolution, fake-interface capability flags, Cursor launcher executable/interface availability via `cursor-agent --help`, Codex launcher executable/interface availability via `codex exec --help`, Grok launcher availability via `grok --help`, and Claude Code launcher availability via `claude --help`. It also reports a `reviewer.*` binding as `reviewer output unconstrained` when the resolved adapter cannot force schema-constrained output (D-046). Policy readiness covers repository content only: what a section says, what shape a table has, whether a required sentence is present, and whether a declared value satisfies a charset. Example:

```text
repo: readable
policy: configured; resolves
registry: readable; schema valid
launcher fake-reviewer-v1: resolved
launcher cursor-plan-reviewer-v1: resolved
launcher codex-plan-reviewer-v1: resolved
launcher grok-plan-reviewer-v1: resolved
launcher claude-plan-reviewer-v1: resolved
fake-reviewer-v1: interface available; review_kind=plan:true; permission_mode=read-only:true; workspace_write:false
cursor-plan-reviewer-v1: executable resolved; interface available
codex-plan-reviewer-v1: executable resolved; interface available
grok-plan-reviewer-v1: executable resolved; interface available
claude-plan-reviewer-v1: executable resolved; interface available
```

The policy line sits immediately after the repository line. A repository whose root `AGENTS.md` has no `## Agent hosts` section is reported as `policy: not configured` and `doctor` exits 0. A repository that is configured but whose policy does not resolve names the first failing check and what should be there, and exits 1. Registry and launcher facts still run in both cases.

It does not determine whether a user is authenticated, identify the active account, inspect credential stores, open a login flow, certify billing, entitlements, or sign-in state, or claim that a reviewer is ready. Authentication failure is observed only as a sanitized execution result returned by the official client.

The interface probes also do not start a reviewer session. They do not prove
that a sandbox around the process which invoked the Bridge permits the selected
official client to create machine-local session state or reach its provider.
Those are launch-time capabilities of the parent host, not authentication facts
that `doctor` may inspect.

## Process environment

The Bridge runtime should start with a minimal, documented non-secret environment. MCP registrations, service definitions, tests, and example commands must not inject provider credential variables.

Provider subprocesses also receive a constructed non-secret environment plus only the operational values needed for execution. They access their own authentication through their official client mechanisms. The Bridge never reads a credential and then forwards it.

`CURSOR_API_KEY` and other harness API keys stay outside the Bridge. The Bridge does not receive or forward those keys to its child processes.

## Permission enforcement

Reviewer read-only behavior must be imposed by the launcher or sandbox, not merely requested in a prompt.

### Parent-host sandbox and reviewer permission

There are two independent permission layers. First, a producer host such as
Codex may sandbox the shell command that starts the Bridge. Spawned commands and
their children inherit that boundary, including filesystem and network limits.
When the selected official client needs machine-local state writes or provider
network access outside it, the host integration requests command-level approval
for the complete `spartan-bridge review` process tree before each spawn. This
includes the initial run, every `--after-run` continuation, and the local Node
fallback. Approval denial happens before the CLI starts, creates no run, spends
no cycle, and is never retried automatically.

Second, the reviewer adapter enforces the review role after launch. Parent-host
approval does not broaden Bridge authority or reviewer inputs and does not
weaken the Cursor flags `--mode plan --sandbox enabled`, read-only workspace
modes, fresh-context requirement, snapshots, integrity comparison, or task-write
gate. Repository content never names a client profile path or a host-specific
approval value; those remain machine-local host concerns.

### Pre-authorize Bridge review commands on producer hosts

Interactive command approval is the safe default. A user who wants a
human-started `/spbridge` or `$spbridge` chain to continue without another
approval prompt may instead allow the narrow `spartan-bridge review` command
family in each producer host's own machine-local configuration. Configure every
host that may be the producer: for example Codex when it is the planner and
Cursor when it is the implementer. Configure Claude Code too if it may fill a
producer binding.

This permission is launch capability, not workflow authority. It permits the
Bridge process tree to use the network and the selected official client to
write its own machine-local session state. The reviewer session remains
read-only, and the runtime still enforces repository policy, reviewer inputs,
task-write grants, fresh contexts, integrity checks, cycle limits, and all stop
conditions. Never commit these host allow rules to `AGENTS.md`, a repository
`spartan-bridge` configuration file, `.cursor/cli.json`, or project-level Claude
settings. A repository may authorize a workflow in `AGENTS.md`; it may not
grant itself host privileges.

These are user-level rules and therefore apply across repositories for that
host profile. Any session using the profile can launch the command without an
approval prompt, although the runtime still refuses a repository that lacks
valid Bridge policy and an explicit eligible task. Install a global rule only
when that cross-repository scope is intentional; otherwise keep interactive
approval.

Before adding a rule, install the runtime so the stable executable is on
`PATH` and inspect what will be trusted:

```sh
command -v spartan-bridge
spartan-bridge --help
```

The rule trusts whichever executable that `PATH` resolves. A source install
created with `npm link` changes as its checkout changes, so keep that checkout
under the same review and update discipline as an installed executable. The
rules below intentionally do not authorize the development fallback
`node dist/cli/main.js review`; use the installed executable for unattended
chains. A fallback spawn is a different command family and may prompt.

#### Codex

Add this rule to `~/.codex/rules/default.rules` for the normal user profile, or
to `$CODEX_HOME/rules/default.rules` when a machine-local wrapper selects an
isolated Codex profile:

```starlark
prefix_rule(pattern=["spartan-bridge", "review"], decision="allow")
```

Codex evaluates the command as argument tokens. The two-token prefix covers the
required `--repo`, `--task`, and optional `--after-run` arguments while leaving
other `spartan-bridge` subcommands outside this rule. Validate the effective
file before starting a new Codex session:

```sh
codex execpolicy check --pretty \
  --rules "${CODEX_HOME:-$HOME/.codex}/rules/default.rules" \
  spartan-bridge review --repo /path/to/repository \
  --task spartan/tasks/NNNN-task.md
```

The result must report `allow`. Codex loads rules from its active configuration
layers at startup, so restart the session after changing the file.

#### Cursor Agent CLI

Merge the following entry into the existing `permissions.allow` array in
`~/.cursor/cli-config.json`:

```json
{
  "permissions": {
    "allow": [
      "Shell(spartan-bridge:review *)"
    ]
  }
}
```

Do not replace unrelated settings or existing allow/deny entries. When the
Bridge profile wrapper gives Cursor Agent CLI an isolated `HOME`, edit the
corresponding profile file instead, for example
`~/.agent-profiles/personal/cursor-home/.cursor/cli-config.json`. Restart the
Cursor Agent CLI session after changing it.

#### Claude Code

Merge the following entry into the existing `permissions.allow` array in
`~/.claude/settings.json`, or in `$CLAUDE_CONFIG_DIR/settings.json` when an
isolated Claude Code profile is active:

```json
{
  "permissions": {
    "allow": [
      "Bash(spartan-bridge review *)"
    ]
  }
}
```

Do not replace unrelated settings or existing allow/deny entries. Claude Code
can reload permission changes for a subsequent tool call, but restarting the
session makes the active profile unambiguous.

Host syntax and configuration locations are defined by the official
[Codex rules](https://developers.openai.com/codex/rules/),
[Cursor Agent CLI permissions](https://cursor.com/docs/cli/reference/permissions), and
[Claude Code permissions](https://code.claude.com/docs/en/permissions) documentation.

#### How the review limit behaves

`max_review_cycles: 3` means at most three reviewer runs in one
human-started planner chain. After a plan-review pass, an independent
implementation-review ceiling of at most three reviewer runs applies to the
foreground implementer successor. Neither number is a target count:

1. `pass` stops the chain after the current review, including on cycle 1;
2. `changes_requested` persists the findings, returns control to the same
   producer session, and permits another review only after the producer revises
   the artifact and only while `cycle < max_cycles`;
3. `human_required`, `blocked`, a policy or adapter failure, an invalid chain,
   or any other terminal reason stops immediately; and
4. `changes_requested` on cycle 3 stops for the human, and a fourth chained
   review is refused as `cycle_limit_reached`.

The reviewer decides whether the work passes. The Bridge validates and routes
that verdict; it does not manufacture extra reviews after `pass` or decide by
itself that technical findings were resolved.

Phase 2A Cursor reviews are artifact-only: the child process sees workspace-relative `task.md` and `AGENTS.md` only. The repository realpath is not passed in argv, environment, or the prompt. The reviewer does not inspect product files.

What the recorded live dogfood run demonstrated:

1. `cursor-plan-reviewer-v1` started a real session against the already-authenticated official `cursor-agent` client in a throwaway fixture worktree and returned a structured result the Bridge accepted;
2. the run reached terminal state `awaiting_implementer` with reason code `review_passed`, and the schema-constrained task write reported `task_write_state: written`.

What that run did not demonstrate: write prevention by `--mode plan` or `--sandbox enabled`. The completed dogfood was not an adversarial write attempt, so it cannot distinguish a refused write from an unattempted one. The hostile-prompt probe below remains the only spawn that carried an adversarial prompt, and it never started a session.

What the recorded hostile-prompt probe demonstrated:

1. `cursor-agent --help` (the preflight and `doctor` probe) exits 0 and includes the tokens `--print`, `--output-format`, `--mode`, `--sandbox`, `--workspace`, and `--trust`;
2. a review spawn with the pinned argv (`-p --output-format json --mode plan --sandbox enabled --trust --workspace <ephemeral-root> <hostile-prompt>`) did not start a reviewer session: the client exited 1 in 531ms and reported that authentication was required;
3. after that spawn, hashes of workspace `AGENTS.md`, workspace `task.md`, the fixture live task, and the fixture product file were unchanged, and the workspace still contained only those two filenames. No writes were observed because no reviewer session started. The Bridge invoked neither `login` nor any credential variable.

What that probe did not demonstrate:

- write prevention by `--mode plan` or `--sandbox enabled`;
- any OS-level sandbox;
- that `--trust` grants no write in plan mode.

The Bridge still ships those client flags on every review spawn (never `--print` alone) and still applies Bridge-owned layers that the stub suite covers: an ephemeral workspace outside the repository (directory mode `0555`, file copies mode `0444`) and the adapter `verify` snapshot of that workspace, which treats any change there as `reviewer_write_detected` (`reviewer_workspace`). Because every reviewer adapter runs in that isolated workspace, the runtime skips its own repository-worktree diff — for an isolated adapter it could only ever attribute a concurrent external write (a launcher log, a sibling session's commit) to the reviewer (D-052); it runs only for a hypothetical in-place adapter that reports `isolated_workspace: false`. Live task / `AGENTS.md` mutation is still `integrity_mismatch`. Those layers are defense in depth. They are not a substitute for an observed client-side permission mode.

The hostile probe supplies absolute paths the production prompt never includes. That probe is boundary evidence, not evidence that product files are in the review surface.

The producer does not run in the live repository. The runtime creates a realpath'd `0700` temporary workspace outside the repository, copies the admitted automatic write scope into it through descriptor-backed no-follow reads, and adds a read-only `node_modules/` support tree so repository checks can run. Relative support symlinks are reconstructed only when their lexical target stays inside `node_modules/`. `dist/` and `node_modules/.cache/` are disposable scratch prefixes and never merge back. This closes D-051's leftover-symlink escalation path: a symbolic alias can grant no write reach beyond a root the producer can already name directly. D-051 remains relevant only to the deliberate direct-write allowance for the child environment's existing `HOME` and `TMPDIR`.

The Darwin profile keeps reads unrestricted with `(allow default)`, globally denies `file-write*`, permits writes only under the isolated workspace plus `HOME` and `TMPDIR`, denies symlink creation in the workspace, and denies both live-repository writes and cross-boundary hard-link creation last. Thus this is write isolation, not read confinement: a producer may still discover and read the live checkout. A non-Darwin host or unavailable `sandbox-exec` stops with `confine_unavailable` before spawn.

A pre-existing cross-root hard link is the named residual. A path filter cannot distinguish two names for one inode, so a writable `HOME` or `TMPDIR` name that already shares an inode with the live repository can still mutate it. The live `productBefore`/`productAfter` producer snapshots detect changes only within their time window; they do not attribute the actor, so Bridge-owned metadata changes must finish before `productBefore`. Detection is content-hash shaped for ordinary files of at most 1 MiB; larger ordinary files compare size and `mtimeNs`. A skipped subtree such as `.git`, `node_modules`, `.spartan-bridge`, `.claude`, `.cursor`, `.venv`, or `venv` is folded into a recursive metadata digest over kind, path, mode, size, `mtimeNs`, `ctimeNs`, and link target. The unforgeable `ctimeNs` change detects a same-size write in a skipped tree even when `mtimeNs` is restored; that evasion remains possible for ordinary files above 1 MiB. A sandboxed descendant can also leave the direct child's process group with `setsid` and write through such a pre-existing link after `productAfter`; that delayed write is outside the detection window. Group signalling is best-effort cleanup, not containment, while the inherited sandbox profile remains irrevocable for the descendant.

Merge-back is a separate fail-closed boundary. The runtime fully hashes admitted product files in the copy, omits disposable scratch paths, and collapses each support root to one recursive metadata digest. A changed support digest still refuses the round, but identifies only the support root and does not content-verify its descendants. The runtime then removes structural directory size/mtime deltas, captures admitted file bytes once into memory, and validates the complete candidate set before writing. Every live destination is opened with Darwin `O_NOFOLLOW_ANY`; symlinks, hard-linked destination files, unexpected kinds, authority paths, denied paths, missing unplanned ancestors, duplicate paths, and existing-path mode changes refuse the whole merge. Source plus undo capture is capped at 2,000 entries and 64 MiB. Apply uses parent-first directory creation, journal-owned sibling temporaries for replacements, file deletion, and child-first directory deletion. Apply failures roll back; rollback failure is `runtime_state_violation`. A passed plan review still terminates at `awaiting_implementer`, while a passed implementation review terminates at `review_passed`. The plan-target scan remains advisory rather than a security boundary (D-072, D-074).

### Implementation-review workspace assembly

The implementation reviewer is given a Bridge-owned copy, not the live repository and not a diff alone. Membership is the decoded implementation-review scope: an exact path or a trailing-slash directory prefix. Tracking, staging, `.gitignore`, `.git/info/exclude`, and `core.excludesFile` do not narrow or widen that set. `.git` metadata is the only fixed subtraction. An admitted path — including `.env`, `.npmrc`, or a tracked file under `node_modules` — is copied without inspection; that is the repository's own code-review exposure, not a Bridge classifier.

Source Git children use a constructed environment and pin the canonical Git directory and worktree, so parent `GIT_DIR` / `GIT_OBJECT_DIRECTORY` / `GIT_CONFIG_*` values and repository `core.worktree` cannot redirect objects or enumerate outside the Bridge root. They never select an operation that invokes clean, smudge, process, textconv, external-diff, or fsmonitor helpers. Any filesystem entry at the source common object store's `objects/info/alternates` or `objects/info/http-alternates` refuses preparation without that content being read.

Each extant in-scope member is opened once with Darwin `O_NOFOLLOW_ANY|O_NONBLOCK` (or an equivalent whole-path no-follow primitive). An ancestor or final symlink, a FIFO or device, a changing file, or an unavailable no-follow capability fails `reviewer_isolation_unavailable` before outside bytes reach an output. Named portability costs: refusal of a path that cannot be represented safely and uniquely on the destination filesystem, and refusal on platforms without that open.

`diff.patch` compares two synthetic trees in a sibling isolated object database that is deleted before the visible root is snapshotted. Isolated diff children pin `core.attributesFile` to an empty file and `attr.tree` to an empty tree. `changes.txt` is rendered from the complete `(H,I,W)` relation rather than inferred from those trees. After preparation, reviewer-visible files are `0444` and directories `0555`. The retained `workspace-manifest.json` names every visible regular file.

This assembly is a library. Adapter wiring and review-kind dispatch are owned by the review runtime: Codex and Cursor prepare the implementation workspace from the resolved scope, and `spartan-bridge review` resolves the kind from the artifact.

What the recorded Codex `codex exec` probe demonstrated, on darwin 25.3.0 with `codex-cli 0.148.0` and `--sandbox read-only` against a `0555` non-Git workspace holding `AGENTS.md` and `task.md` at `0444`:

1. the model attempted two writes and the operating system refused both;
2. the exact error text for those refusals was `zsh:1: operation not permitted: probe-write.txt` and `zsh:1: operation not permitted: AGENTS.md`;
3. after that run, the workspace still contained only those two filenames, byte-unchanged.

What that Codex observation does not demonstrate:

- write prevention on any host other than the Codex CLI that was probed;
- write prevention in any sandbox mode other than `read-only`;
- write prevention on another machine, OS, or CLI version;
- that Cursor, or any other adapter, has an OS-level sandbox.

The Codex adapter still ships `--sandbox read-only` on every review spawn and still applies the Bridge-owned workspace snapshot. The observed refusal is evidence for that one probed configuration. It is not a claim about another host.

Provider subprocesses receive a closed, host-specific environment allowlist copied from the parent when present. Codex forwards `PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL`, and `TERM`, plus `CODEX_HOME` when the parent already exports it — the isolated-profile config directory that holds the official client's `auth.json`; without it a Bridge-spawned `codex exec` falls back to `$HOME/.codex/auth.json`, which under machine-local profile isolation may be stale or another account's login (D-055). Cursor forwards those same base keys plus `AGENT_CLI_CREDENTIAL_STORE` when the parent already exports it, so an already-authenticated file credential store stays usable without the Bridge setting, inventing, or reading it. Grok forwards those same base keys plus `GROK_HOME` when the parent already exports it. Codex, Cursor, and Grok producer subprocesses additionally receive exactly one Bridge-originated key, the non-secret `SPARTAN_BRIDGE_PRODUCER_ISOLATED=1` marker; review subprocesses do not. Claude Code forwards those same base keys plus `CLAUDE_CONFIG_DIR`, `USER`, and `AGENT_PROFILES_REAL_HOME` when the parent already exports them — the isolated-profile config directory, the macOS keychain account name that a Bridge-spawned `claude -p` needs or it reports "Not logged in", and the real-`HOME` marker a machine-local wrapper uses to restore `HOME` for `claude` inside a relocated-`HOME` `cursor-agent` session (task `0057`). Codex forwards `AGENT_PROFILES_REAL_HOME` too, for symmetry with that wrapper guard. In every case the official client reuses its own credential store without the Bridge setting, inventing, or reading credential paths. The Bridge never sets `HOME`, `CODEX_HOME`, `GROK_HOME`, `CLAUDE_CONFIG_DIR`, `CURSOR_CONFIG_DIR`, `AGENT_CLI_CREDENTIAL_STORE`, `CURSOR_API_KEY`, `XAI_API_KEY`, `ANTHROPIC_API_KEY`, or any other profile or credential variable; `CODEX_HOME`, `GROK_HOME`, `AGENT_CLI_CREDENTIAL_STORE`, `CLAUDE_CONFIG_DIR`, `USER`, and `AGENT_PROFILES_REAL_HOME` are forwarded only when the parent already exports them, never originated by the Bridge. The isolated marker is the sole non-profile, non-credential exception and never comes from the parent. `cwd` for review is the ephemeral workspace root, which holds a byte-identical `AGENTS.md` copy so a machine-local wrapper can still resolve the client context from `$PWD`.

Required invariants:

- automated reviewer processes cannot modify product files or the Spartan task artifact;
- after validating reviewer output, the Bridge may update only the explicitly identified current task artifact when pinned policy grants `task_artifact_write`;
- a granted write may change the owned review region of the dispatched kind and, when the completed round is `reviewer.plan` or `reviewer.implementation` with a `pass` or `changes_requested` verdict and `next_role` is `reviewer`, the source lines of `next_role` and `updated_at`, plus `handoff_id` and `next_handoff_id` only as the exact consumed-identifier pair move when the source `next_handoff_id` is an outstanding canonical identifier; it must not change `current_role`, `status`, `phase`, `task_type`, or any other frontmatter source line;
- the post-write check compares source text, not parsed values, and admits only four deterministic deltas: the dispatched kind's region; those frontmatter source lines; either the exact consumed `## Next Handoff` notice or a byte-identical handoff section; and either the exact task-template `Verdict: PENDING` final-segment removal or byte-identical human review text. Frontmatter key order is unchanged, no key is added or removed, every non-allowlisted frontmatter line is byte-identical, the other review kind's region is byte-identical, and every other human-written segment is byte-identical; parse or equality failure restores the original;
- the owned region, the allowlisted frontmatter fields, the handoff retraction, and the template-placeholder cleanup are one replace, one check, and one restore path;
- task-artifact writes use a schema-constrained patch and cannot change repository authority, executable configuration, or product paths;
- only one writer may own a worktree lock;
- a reviewer cannot reuse the producer execution context;
- the implementer cannot approve its own artifact;
- Bridge runtime state is written atomically;
- event records are append-only;
- artifact hashes are checked before accepting a review result.

If a provider adapter cannot enforce the required permission mode, that binding is unavailable.

For a manual Spartan round that is not running through the Bridge, the human may separately authorize the reviewer to update the current task artifact. That manual exception does not change the automated adapter's read-only requirement.

## Repository instructions as untrusted input

`AGENTS.md` is authoritative repository policy, but it is still parsed input. The Bridge must use a constrained grammar for bindings and automation grants rather than executing arbitrary Markdown or shell fragments.

Agent output is also untrusted. A handoff may return an abstract next role, but it may not:

- choose an executable path;
- add environment variables;
- expand its own permissions;
- disable sandboxing;
- change cycle limits;
- authorize deployment, merge, deletion, or another destructive action.

The orchestrator validates every requested transition against its pinned policy.

## Path and worktree safety

- Resolve and canonicalize the worktree root before starting a run.
- Reject artifact paths that escape the worktree or approved protocol directories.
- Avoid unresolved globs and environment variables in destructive operations.
- Hold an exclusive writer lock for implementation.
- Detect worktree movement, deletion, or replacement.
- Write temporary files in a private directory and rename atomically.
- Never use a broad directory such as a home directory as a cleanup target.

## Logging and redaction

The event log records decisions, not raw private context. At minimum, it must redact:

- common credential formats and sensitive environment values;
- user-home prefixes when diagnostics are exported;
- full prompts when a structured summary is sufficient;
- provider output sections known to include private session metadata.

Local logs use restrictive permissions. Exported diagnostics require a second redaction pass and an explicit human action. The preferred design prevents credentials from entering the process; redaction is defense in depth, not permission to ingest them.

When a review child fails, the Bridge may write provider bytes into the run directory as protected files — not only stderr. Both files are gitignored with the run directory. Redaction removes common credential formats, sensitive `key=value` / `key: value` pairs under `isSensitiveRegistryKey`, and home-directory prefixes; it is defence in depth, not permission to ingest credentials.

- `.spartan-bridge/runs/<run-id>/adapter-stderr.log`: written when the child produced stderr. Mode `0600`, atomic temp-then-rename, at most 16 KiB of the redacted tail. `status.json` stores only the classification record and a relative `stderr_log` filename, never the stderr text.
- `.spartan-bridge/runs/<run-id>/adapter-payload.log`: written only after a failed extraction (`output_unparsable`) when the adapter carried a non-empty stdout candidate. Mode `0600`, atomic temp-then-rename. Core redacts the candidate first (`redactAdapterStderrText`), then keeps at most 16 KiB of the redacted tail, prefixing `[truncated: earlier bytes dropped]` when truncation applies. The pointer reaching a reader is `payload_log` on the adapter-failure record in `status.json`. Retained payload text never enters `status.json`, `events.jsonl`, stdout, or stderr. On that path — when no verdict was recorded and stderr may be empty — the payload file is the only copy of the adapter's stdout candidate the run keeps, so a later producer can recover the judgement without paying for the review twice.

`adapter_failure` may carry the closed causes `provider_unavailable` and `provider_limit` and an integer `http_status` (the last `type === "result"` object's `api_error_status` when that value is a finite integer in `100..599`). It may also carry `signal`, the OS name Node delivered when the child was signalled. Those fields are Bridge-owned scalars. They are never the provider `result` string, `terminal_reason`, a URL, or any other provider prose. `producer_diagnostic` stays the closed nine-key record and does not gain `http_status`.

Live review progress on a TTY is not child output. Each progress line is composed only of a Bridge-owned class name (`working`, `tool`, `result`, or `quiet`) and Bridge-maintained counts. The child's streamed records, including any `apiKeySource`, tool names, paths, or model prose, are parsed for those counts and then discarded. They never reach the terminal, `status.json`, or `events.jsonl`. Redaction is not the control that keeps them off the TTY.

A producer execution stop's `producer_diagnostic` field on transition `status.json`/`events.jsonl` is a closed nine-key classification (`stage`, `exit_code`, `timed_out`, `write_scope_code`, `adapter_phase`, `adapter_cause`, `waited_ms`, `snapshot_site`, `snapshot_cap`). It is built from closed Bridge values, including typed fields on `ProducerWriteScopeError`, `AdapterFailureError`, `AdapterTimeoutError`, and `SnapshotCapError`; a non-cap snapshot error still records its closed site with a null cap. It is never provider stdout/stderr, a prompt, a payload, a path, an error message, a model/account identifier, or a class name derived from an unrecognized throw; an unrecognized throw contributes no adapter detail at all. The serializer whitelists exactly those nine keys and rejects or normalizes to `null` any value outside the closed enums, integer domains, or boolean timeout domain, so an injected extra property can never reach persisted JSON. It is `null` on unrelated stops, every non-terminal event, and every success. The closed record is constructed while the write-scope guard is still active, at the catch/result boundary inside the guarded round, but that construction only yields inert returned data; the guard is released exactly once afterward, and only then is the record persisted into terminal `status.json` and its `terminal_stop` event, so guard release strictly precedes diagnostic persistence. A plan-target scan hit records `unwritable_plan_targets` as a Bridge-owned advisory on the transition record — the authorization event and the terminal document — independent of `reason_code`. Those tokens are normalized posix path tokens already present in the approved artifact; they are not `producer_diagnostic` and are not provider output. A `producer_declaration_invalid` stop records `declaration_invalid_detail`, a Bridge-owned closed slug naming which declaration rule failed; it is not `producer_diagnostic` and is not provider output.

## Network and command policy

The first Bridge release exposes no network listener. The CLI and MCP `stdio` adapter keep the trust boundary local to the launching process.

Provider commands and flags come from adapter code or validated, non-secret user-local configuration, never from an agent response. Shell interpolation is prohibited; arguments are passed as arrays to a direct process-spawn API.

## Human gates

Automatic review is narrow authority. The Bridge always stops before:

- changing producer role or host unless separately authorized;
- merge, push, release, deployment, or publication;
- destructive filesystem or Git operations;
- scope expansion;
- credential or account changes;
- unresolved high-risk findings;
- any `human_required` or `blocked` verdict.

## Security issues

Follow the repository's [Security Policy](../SECURITY.md) for private reporting. Never include real provider credentials, auth files, private repository content, or unredacted diagnostics in a report.
