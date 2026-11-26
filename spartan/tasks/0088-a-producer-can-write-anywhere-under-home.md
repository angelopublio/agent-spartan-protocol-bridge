---
protocol: "1.1.1" # x-release-please-version
id: a-producer-can-write-anywhere-under-home
created_at: 2026-09-14
status: active
phase: planning
task_type: planning
risk: high-impact
current_role: planner
next_role: planner
updated_at: 2026-09-14
handoff_id: none
next_handoff_id: HX-001
---

# A producer can write anywhere under `HOME`, including other repositories

## Objective

A producer started by the Bridge writes only to three places: its isolated workspace, `TMPDIR`, and
the machine-local state each official producer client needs in order to run. Nothing else under
`HOME` is writable, including:

- another repository;
- a shell or git configuration file;
- a launch agent.

Every official producer client that is authenticated on the machine still completes a minimal
round. A write the profile refuses stops the round with a diagnostic that names the refused path.

## Context

Every automatic producer adapter (Codex, Cursor, Grok) wraps its child in the Darwin profile built
by `producerIsolatedSandboxProfile` in `src/adapters/producer-write-scope.ts`. Consumer repositories
run the same runtime (`D-078`), so this is production behavior on every Darwin host.

The profile first denies every write, then re-allows writes under the child environment's `HOME`
and `TMPDIR` and under the workspace, and denies the live repository root last (E-1). `HOME` comes
from the parent environment, which for a session started from the owner's terminal is the owner's
real home directory.

That makes every repository under `HOME` other than the live one writable, together with every
file that later runs code outside the sandbox. The producer executes repository code and reads
content it cannot trust, so the profile must assume hostile code runs inside it. The escape is
deferred execution: a hostile write lands now and runs later, outside the sandbox, when the owner
next uses the machine. Examples:

- `~/.gitconfig` gains a `core.hooksPath` or a credential helper;
- another repository's `.git/hooks/*` gains a hook;
- a shell startup file such as `~/.zshrc` gains a command;
- `$HOME/Library/LaunchAgents` gains a job.

Owner rule, 2026-09-14: a producer started for one repository never writes to, or runs git against,
any other repository.

History explains why `HOME` is open. Task `0039` shipped a whole-machine deny, and it denied
`/dev/null`, `TMPDIR` and the inherited `HOME`, so `cursor-agent` exited 1 before the implementer
could start (`D-037`, E-4). Narrowing `HOME` again therefore has to be driven by evidence of what
each client writes.

The owner dogfoods the Bridge and fixes compatibility gaps as they surface in use. This task
therefore proves the clients that are authenticated when it runs. Any other client must fail closed
with a diagnostic, so a later gap costs a small follow-up rather than an investigation.

Tasks `0089` (network) and `0087` (local git) are companions. This task does not depend on either,
and `0087` waits for it.

## Scope

- `src/adapters/producer-write-scope.ts` — the profile's writable roots, and any preflight that
  resolves them.
- `tests/producer-write-scope.test.ts` — expected clauses and the new regression cases.
- `src/adapters/codex.ts`, `src/adapters/cursor.ts`, `src/adapters/grok.ts` — only where a client's
  state root is resolved or passed.
- `src/core/contracts.ts` — only if a decision adds or changes a producer diagnostic code.
- `docs/AUTHENTICATION-AND-SECURITY.md` — the paragraph describing the Darwin producer profile.
- `docs/DECISIONS.md` — one dated entry.
- This task file.

## Out of Scope

- Network access (task `0089`).
- `/dev/null` and git inside the producer (task `0087`).
- Read confinement.
- Reviewer adapters, which do not use this profile.
- Non-Darwin hosts, which stop with `confine_unavailable`.
- Claude Code as a producer; it has no producer adapter.
- Monitoring client updates for new write locations. Dogfooding surfaces them.

## Constraints

- Enforcement is technical, in the profile. A convention, prompt or environment variable is never
  the boundary.
- SBPL uses last-match precedence, and `D-051` records that the Darwin profile matches the
  post-resolution path. Every allow and deny must hold under both rules.
- The existing denies stay: the live repository root, hard links across it, and symlink creation in
  the workspace.
- The Bridge never reads, lists or copies credentials or the contents of a client's state. Discovering
  a client's writable roots may observe path names that the profile refuses, never file contents.
- Repository content never names a client profile path (`AGENTS.md`). Writable client roots come from
  the forwarded environment (for example `CODEX_HOME`, `GROK_HOME`) or a client's documented default
  resolved at runtime, never a user-specific path committed to the repository.
- A regression probe sets the child's `HOME` to a temporary directory. No probe writes to, or relies
  on the refusal of a write to, the real `~/.gitconfig`, shell startup files, launch agents or real
  repositories.

## Decisions

To be settled by the planner round.

- **D1 — Which writable roots replace `HOME`.** Settle this per client: the environment variable
  when set, otherwise the client's own default, plus any cache or log location the client needs.
  Each root rests on evidence from that client.
- **D2 — How the roots are expressed.** An allow list of specific subpaths, or `HOME` allowed with
  sensitive classes denied. A deny list names only what its author thought of, so choosing it
  requires stating what it leaves open.
- **D3 — How a refused write is surfaced.** E-3 shows that a denial from a `sandbox-exec` profile
  did not appear in `log show` by default. The plan names the mechanism that makes a refusal
  visible, such as a reporting modifier in the profile or a post-failure log read. It also names
  the diagnostic the run records and how that stays safe to paste (the path may contain a user
  directory).
- **D4 — Isolated-profile wrappers.** Adapters forward `AGENT_PROFILES_REAL_HOME` when the parent
  exports it (E-2). A launcher wrapper may therefore resolve client state under a different home.
  The plan states which root that implies and proves it with the owner's launcher.
- **D5 — The records.** What `docs/AUTHENTICATION-AND-SECURITY.md` and the decision entry say. The
  current text, "direct writes to `HOME` and `TMPDIR` remain available", becomes false.

## Acceptance Criteria

To be derived from the decisions, last. The set must include:

- with the child's `HOME` pointed at a temporary directory, a write to another repository's
  `.git/hooks`, to `.gitconfig`, to a shell startup file and to `Library/LaunchAgents` under that
  `HOME` is refused;
- a write under each chosen client root succeeds;
- each official producer client authenticated when the task runs completes a minimal round under
  the new profile, with the exercised and unexercised clients named in Evidence;
- a refused write stops the round with the D3 diagnostic.

## Work Completed

- 2026-09-14 — task created by Claude Code (`claude-opus-5`, effort high, Anthropic) at the owner's
  request, as the first of three tasks splitting the producer-sandbox work. The round quoted the
  profile (E-1) and the forwarded environments (E-2), probed denial reporting (E-3), and recorded
  the history that opened `HOME` (E-4).

## Evidence

- **E-1 — the producer profile.** `producerIsolatedSandboxProfile` in
  `src/adapters/producer-write-scope.ts` builds, in order:
  1. `(version 1)`, `(allow default)`, `(deny file-write*)`;
  2. `(allow file-write* (subpath HOME))` and `(allow file-write* (subpath TMPDIR))`, when the child
     environment carries them;
  3. `(allow file-write* (subpath <workspace>))`;
  4. a deny of symlink creation under the workspace;
  5. `(deny file-write* (subpath <live root>))` and `(deny file-link (subpath <live root>))`.

  `src/adapters/codex.ts`, `src/adapters/cursor.ts` and `src/adapters/grok.ts` import from
  `./producer-write-scope.ts`.
- **E-2 — what each producer child receives.**
  - `CODEX_ENV_ALLOWLIST`: `PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL`, `TERM`, `CODEX_HOME`,
    `AGENT_PROFILES_REAL_HOME`;
  - `CURSOR_ENV_ALLOWLIST`: `PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL`, `TERM`,
    `AGENT_CLI_CREDENTIAL_STORE`, `AGENT_PROFILES_REAL_HOME`;
  - `GROK_ENV_ALLOWLIST`: `PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL`, `TERM`, `GROK_HOME`.
- **E-3 — a refused write is not reported by default.** On 2026-09-14 the round ran:

  ```text
  /usr/bin/sandbox-exec -p '(version 1)(allow default)(deny file-write*)(allow file-write* (subpath "<tmp>"))' /bin/sh -c 'git --version; echo x > <home>/.sbx-probe-should-be-denied'
  ```

  It printed `fatal: could not open '/dev/null' for reading and writing: Operation not permitted`
  and `/bin/sh: <home>/.sbx-probe-should-be-denied: Operation not permitted`, and the probe file
  was absent afterwards. Two seconds later,
  `/usr/bin/log show --last 30s --style compact --predicate 'sender == "Sandbox"'` listed sandbox
  denials from other processes only. Neither of the probe's two denials appeared.
- **E-4 — why `HOME` was reopened.** `D-037` in `docs/DECISIONS.md` records that task `0039`'s
  whole-machine deny "denied `/dev/null`, `$TMPDIR`, and the inherited `$HOME`, so the official
  `cursor-agent` launcher exited 1 before the automatic implementer could start". `D-072`'s
  consequence states that "direct writes to `HOME` and `TMPDIR` remain available".

## Review

Verdict: PENDING

Findings:

- None recorded.

## Blockers

None.

## Next Action

A planning round settles D1–D5 with probes that use a temporary `HOME`. It derives the acceptance
criteria from them, including the cases listed there, and lets the Bridge dispatch the plan review.

## Next Handoff

```text
Recommended execution (human decides):
- Host: Claude Code — the `planner` binding in AGENTS.md
- Model and effort: claude-opus-5, effort high
- Role: planner
- Handoff: HX-001
- Permission: writable
- Invocation: `/spbridge` in a fresh session, passing the prompt block below as the argument — `spartan-bridge doctor` reports the `reviewer.plan` adapter available, so the Bridge dispatches the review
```

```text
Open `spartan/tasks/0088-a-producer-can-write-anywhere-under-home.md` (handoff HX-001).

Act as planner. Settle D1-D5 with probes that point the child's HOME at a temporary directory, and derive the acceptance criteria from them last; the round succeeds when every writable root rests on evidence from its client, every listed refusal case is covered, and every criterion names the decision it follows from.
Run the relevant repository checks and update the same task file.

Return only the next handoff, or a completion notice if no work remains.
```
