---
protocol: "1.1.1" # x-release-please-version
id: a-producer-has-unrestricted-network-access
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

# A producer's process tree has unrestricted network access

## Objective

Every network connection from a producer started by the Bridge, and from anything that producer
runs, reaches only the destinations its official client needs. Pushing, fetching, cloning or
uploading anywhere else fails, whichever tool attempts it: git, `curl`, `gh`, `npm publish`, a
library that speaks HTTP directly. The Bridge never sees request content or credentials. Every
official producer client that is authenticated on the machine still completes a minimal round.

## Context

The Darwin producer profile built by `producerIsolatedSandboxProfile` in
`src/adapters/producer-write-scope.ts` starts with `(allow default)` and carries no network clause
(E-1). Every producer child and its descendants can therefore open any connection. That is why a
producer is not blocked from `git push` by the sandbox. It is blocked only because git currently
dies on `/dev/null` (task `0087`, E-1), and task `0087` removes that accident.

The threat model is that the producer executes repository code and reads content it cannot trust,
so hostile code may run inside it. Denying git's transport programs by path would not stop that
code: `curl`, `gh`, another git installation, or a library that speaks HTTP directly all bypass
such a list. The boundary has to be the network itself.

The client still needs its provider. A pattern used by existing open-source sandboxes for coding
agents fits that:

- the profile denies outbound connections except to one loopback port;
- a proxy on that port, run by the Bridge, tunnels `CONNECT` requests only to allowed hostnames;
- the client is pointed at the proxy through the standard proxy environment variables.

Reusing any existing code for this falls under `docs/OPEN-SOURCE-POLICY.md` and
`docs/PROVENANCE.md`.

Three current statements constrain the design:

- `docs/AUTHENTICATION-AND-SECURITY.md` states that "the first Bridge release exposes no network
  listener" (E-2). A loopback proxy is a listener, so that statement changes on the record.
- `README.md` states that the Bridge does not "proxy ... provider tokens" (E-2). A `CONNECT` tunnel
  without TLS interception carries encrypted bytes it cannot read, which keeps that statement true.
  Anything that inspects content would break it.
- The producer environments are closed allowlists (E-3), so proxy variables are an explicit
  addition that the security document must list.

The owner dogfoods the Bridge and fixes compatibility gaps as they surface. Hostnames a client needs
beyond the first proven set are expected to turn up in use, so a refused hostname must be recorded
where the owner can see it.

Companions: task `0088` narrows writes, and task `0087` admits local git once this task and `0088`
land. This task does not depend on either.

## Scope

- `src/adapters/producer-write-scope.ts` — the profile's network clauses.
- A new proxy module under `src/adapters/` or `src/core/`, as the plan names it.
- `tests/producer-write-scope.test.ts` and a new test file for the proxy.
- `src/adapters/codex.ts`, `src/adapters/cursor.ts`, `src/adapters/grok.ts` — the producer
  environment allowlists, the proxy variables passed at spawn, and each client's allowed hostnames
  if they live in adapter code.
- `src/core/contracts.ts` — only if a decision adds or changes a producer diagnostic code.
- `docs/AUTHENTICATION-AND-SECURITY.md` — the "Network and command policy" section and the producer
  environment paragraphs.
- `docs/DECISIONS.md` — one dated entry.
- `README.md` — only if the plan changes what it says about proxying.
- `docs/PROVENANCE.md` — only if third-party code is incorporated.
- This task file.

## Out of Scope

- Writes under `HOME` (task `0088`).
- `/dev/null` and local git (task `0087`).
- The network access of reviewer adapters.
- Non-Darwin hosts.
- Inspecting, logging or altering request content or headers beyond the `CONNECT` target host and
  port.
- TLS interception of any kind.
- Monitoring client updates for new hostnames. Dogfooding surfaces them.

## Constraints

- Enforcement is technical. A tool that ignores the proxy variables must fail to connect, never
  bypass. The variables only route well-behaved clients; the sandbox is the boundary.
- The proxy binds to loopback only, lives no longer than its run, and records only the `CONNECT`
  target host and port of a refused request.
- The Bridge never reads, stores or forwards credentials, and never sees plaintext traffic.
- No probe contacts a real remote other than the provider, and only through a client's own minimal
  round. A refused destination is a local test server on an address the allowlist does not name.
- Every probe quotes the profile text and the command it ran.

## Decisions

To be settled by the planner round.

- **D1 — The enforcement mechanism.** Show that the profile can deny all outbound connections except
  the proxy's loopback port. Also answer the traffic that is not an ordinary outbound connection:
  - DNS, including whether hostname lookups through the system resolver remain an exfiltration
    channel, and whether that residual is accepted or closed;
  - Unix-domain sockets, including an inherited SSH agent socket.
- **D2 — The proxy.** Where it runs, its bind address and port selection, its lifetime, `CONNECT`
  only, and how a refused hostname reaches the run record. Also the exact amendment to the "no
  network listener" statement.
- **D3 — Each client's allowed hostnames.** Where the list lives (adapter code or validated
  machine-local configuration, never an agent response), how it was discovered (for example an
  observation run through the proxy), and how the owner adds a hostname found in dogfooding.
- **D4 — A client that ignores the proxy variables.** How that is detected, and what the binding
  reports: an unavailable binding rather than an unconfined one.
- **D5 — Reading credential stores.** Hostile code can read `~/.ssh`, `~/.config/gh` or
  `~/.git-credentials` and send what it read as model context to the provider. Decide whether this
  task denies those reads, with evidence that each client still starts, or records the residual as
  a separate task with the owner's approval.
- **D6 — A repository check that needs the network**, such as installing packages. Default deny,
  and whether a repository-declared opt-in exists. An opt-in in `spartan-bridge/config.yaml` puts
  that file in scope and requires a human implementer.
- **D7 — Third-party code.** Write the proxy and clauses here, or incorporate an existing
  implementation with provenance recorded under `docs/OPEN-SOURCE-POLICY.md`.
- **D8 — The records.** What the security document, the decision entry and, if needed,
  `README.md` say.

## Acceptance Criteria

To be derived from the decisions, last. The set must include:

- a direct connection from the producer tree to a local test server not on the allowlist is refused;
- a `CONNECT` to a hostname not on the allowlist is refused, and the hostname is recorded;
- `git push`, `git fetch` and `git clone` over HTTPS and SSH to a local test server are refused;
- a tool that ignores the proxy variables cannot connect;
- each official producer client authenticated when the task runs completes a minimal round, with
  the exercised and unexercised clients named in Evidence.

## Work Completed

- 2026-09-14 — task created by Claude Code (`claude-opus-5`, effort high, Anthropic) at the owner's
  request, as the second of three tasks splitting the producer-sandbox work. The round quoted the
  profile's lack of a network clause (E-1), the statements the design must amend or keep (E-2), the
  closed producer environments (E-3), and git's transport programs (E-4).

## Evidence

- **E-1 — no network clause.** `producerIsolatedSandboxProfile` in
  `src/adapters/producer-write-scope.ts` emits `(version 1)`, `(allow default)` and write clauses
  only. It contains no `network` operation.
- **E-2 — statements the design touches.**
  - `docs/AUTHENTICATION-AND-SECURITY.md`, section "Network and command policy": "The first Bridge
    release exposes no network listener. The CLI and MCP `stdio` adapter keep the trust boundary
    local to the launching process."
  - `README.md`: the Bridge "does not accept, receive, read, copy, select, store, log, proxy, or
    persist provider tokens, cookies, authentication files, API keys, Keychain data, browser
    sessions, or provider account identifiers".
- **E-3 — closed producer environments.**
  - `CODEX_ENV_ALLOWLIST`: `PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL`, `TERM`, `CODEX_HOME`,
    `AGENT_PROFILES_REAL_HOME`;
  - `CURSOR_ENV_ALLOWLIST`: the same six plus `AGENT_CLI_CREDENTIAL_STORE` and
    `AGENT_PROFILES_REAL_HOME`;
  - `GROK_ENV_ALLOWLIST`: the same six plus `GROK_HOME`.

  None carries a proxy variable.
- **E-4 — git's transport programs on this machine.** On 2026-09-14 `git --exec-path` printed
  `/Library/Developer/CommandLineTools/usr/libexec/git-core`. It holds `git-remote-http`,
  `git-remote-https`, `git-remote-ftp`, `git-remote-ftps`, `git-remote-ext`, `git-remote-fd`,
  `git-upload-pack`, `git-receive-pack` and `git-upload-archive`. `command -v ssh` printed
  `/usr/bin/ssh`. These are what the git regression cases exercise; they are not the boundary.

## Review

Verdict: PENDING

Findings:

- None recorded.

## Blockers

None.

## Next Action

A planning round settles D1–D8 with local probes that contact no real remote. It derives the
acceptance criteria from them, including the cases listed there, and lets the Bridge dispatch the
plan review.

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
Open `spartan/tasks/0089-a-producer-has-unrestricted-network-access.md` (handoff HX-001).

Act as planner. Settle D1-D8 with local probes that contact no real remote, and derive the acceptance criteria from them last; the round succeeds when the planned profile is shown to refuse every non-allowlisted connection, including from a tool that ignores the proxy variables, and every criterion names the decision it follows from.
Run the relevant repository checks and update the same task file.

Return only the next handoff, or a completion notice if no work remains.
```
