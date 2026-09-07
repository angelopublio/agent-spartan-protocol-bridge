---
protocol: "0.6.1"
id: mcp-stdio-adapter
created_at: 2026-08-16
status: completed
phase: complete
task_type: review
risk: high-impact
current_role: reviewer
next_role: planner
updated_at: 2026-08-16
handoff_id: HX-007
next_handoff_id: none
---

# Add the MCP stdio adapter over the Phase-1A core

> Editorial note (2026-09-07): unused platform names and historical integration-document names were generalized for publication. The historical optional-integrations document refers to the former combined cockpit and Board documentation; its Board material is now in `docs/BOARD.md`. Any example path in this cleanup is a normalized placeholder. Original round outcomes, commands, and technical findings are retained; historical line references are not current navigation targets.

## Objective

Implement **Phase 1B: MCP stdio adapter**, a second host-neutral interface over the unchanged Phase-1A fake plan-review core. A compatible agent host registered with `spartan-bridge mcp-stdio` can call one `review` tool and receive the same terminal `status.json` content the CLI prints. It adds no real provider adapter, no automatic loop, no second core pipeline, and no network listener.

## Context

Task `0001-bootstrap-independent-runtime` delivered Phase 1A and is `completed`: `spartan-bridge review | status | events | doctor`, the in-process `fake-reviewer-v1`, closed contracts, the ordered validation pipeline, and 35 tests. This task is the documented next slice ([historical document omitted] "First vertical slice" step 5, `docs/ARCHITECTURE.md` "MCP adapter", `docs/DECISIONS.md` D-006).

The core operation already exists and is adapter-independent: `runReview(input, deps)` exported from `src/index.ts`, with `createProductionDeps(env)` from `src/composition.ts`. Phase 1B is an adapter that calls it. It must not fork, wrap, or re-order the Phase-1A pipeline, and it must not relax any Phase-1A contract.

The material change this slice introduces is the caller. The CLI is invoked by a human who types the arguments; the MCP adapter is invoked by a model in a host conversation. Tool arguments are therefore agent-controlled text, which is why the repository root is bound once at process start and is not a tool parameter (see Decisions).

The first planning round ran on Claude Code under an explicit in-round assignment because `AGENTS.md` then mapped no role to that host. The owner later remapped `planner` to Claude Code; `reviewer.plan` remains Cursor in client context `personal`.

The owner authorized reusing code from the local `agent-spartans-worktrees` and `agent-spartans-workbench` repositories to save time. Both were searched; neither contains MCP, JSON-RPC, or stdio-transport material, so there is nothing to reuse for this slice and the `docs/PROVENANCE.md` Workbench gate stays untouched (see Evidence).

The first plan-review round returned `CHANGES` with four findings. Planning round 2 closed those four. Re-review confirmed they remain closed and recorded `CHANGES` on one new finding: the `isError` mapping contradicted itself for RunState `blocked`. Planning round 3 closed that finding by pinning `isError` to `outcome.exitCode` and splitting reviewer-terminal `blocked` from pre-review `blocked`. Plan re-review of that finding recorded `APPROVE`.

The owner’s goal after this task is to start dogfooding this repository with Claude Code as planner and Cursor as `reviewer.plan`, so Bridge construction can continue without handoff paste. That work is a separate task after Phase 1B completes; it does not enlarge this MCP slice. Host bindings stay in root `AGENTS.md`. Continuation after `CHANGES` is a new human-started Claude conversation that reads the task file, not a return into the original Claude thread.

## Scope

- Add `src/mcp/` with the stdio transport, the JSON-RPC layer, the MCP method handlers, and the `review` tool definition. Nothing under `src/core/`, `src/policy/`, `src/runtime/`, or `src/adapters/` changes behavior.
- Add the `mcp-stdio` command to `src/cli/parse.ts` and `src/cli/main.ts`: `spartan-bridge mcp-stdio [--repo <path>]`, plus one `HELP_TEXT` line. Existing commands, options, and exit codes are unchanged.
- Bind the repository root once at process start: `--repo` when supplied, otherwise `process.cwd()`, resolved through the existing `resolveReadableDirectory`. Construct production dependencies once via `createProductionDeps(env)`.
- Fail closed at startup: an unresolvable root writes one sanitized line to stderr and exits `1` without serving a single message.
- Implement the newline-delimited UTF-8 JSON stdio transport: one message per line, `\r` tolerated at end of line, blank and whitespace-only lines ignored, and a 1 MiB per-line ceiling.
- Keep stdout exclusively for serialized JSON-RPC messages. All diagnostics go to stderr; `console.log`, banners, and progress output are forbidden anywhere reachable from `mcp-stdio`.
- Implement the closed JSON-RPC 2.0 request/notification/error rules pinned in Decisions, including the closed error-code set and error objects carrying exactly `code` and `message`.
- Implement exactly the closed method set of MCP revision `2025-06-18`: `initialize`, `notifications/initialized`, `ping`, `tools/list`, and `tools/call`; every other method is `-32601`.
- Expose exactly one tool named `review`, whose input schema is exactly `{ task: string }` with JSON Schema root `"type": "object"` and `additionalProperties: false`, re-validated by the handler rather than trusted from the client.
- Call the existing exported `runReview` for every `tools/call`, and map its `ReviewOutcome` to the MCP tool result pinned in Decisions.
- Process messages strictly sequentially in arrival order; introduce no lock, lease, queue file, worker pool, or concurrency coordination.
- Exit `0` on stdin end-of-file after the in-flight request completes, and on `SIGINT` or `SIGTERM`.
- Add `tests/mcp.test.ts` covering the transport, the JSON-RPC layer, the method set, the tool contract, the outcome mapping, and stdout hygiene, plus at least one end-to-end test that spawns the real entrypoint and drives it over piped stdio.
- Update the repository's own documentation so it stays true, in exactly four files and only where they describe what this slice ships: the `README.md` status line and closing status paragraph; the `docs/ARCHITECTURE.md` MCP-adapter section; the [historical document omitted] vertical-slice step for the MCP adapter; and the single stale sentence in the historical optional-integrations document (line 28) ("These commands are planned interfaces; the repository is currently design-only"), which Phase 1A already falsified. The registration snippet in the historical optional-integrations document (`args: ["mcp-stdio"]`) must keep working unchanged.

## Out of Scope

- Real Codex, Claude Code, or Cursor adapters; any launcher executable, argv execution, or official-client subprocess. Production still binds `fake-reviewer-v1` and its constant `human_required` result.
- Any authentication, login, account, subscription, or billing behavior or inspection.
- MCP revisions after `2025-06-18`. Revision `2026-07-28`, current as of 2026-08-16, removes `initialize`, `notifications/initialized`, and `ping`; adopting it or `2025-11-25`, or negotiating between revisions, is a separate task.
- MCP tools, methods, or surfaces beyond the five pinned methods and the single `review` tool: no `status`, `events`, `doctor`, `start`, `stop`, or `resume` tool; no resources, prompts, sampling, roots, elicitation, completions, logging notifications, or progress notifications.
- The Phase-2 tool signature `review(run_id, review_kind, artifact_path, artifact_hash)`; Phase 1B takes only `task` and keeps `review_kind` fixed at `plan` in the core.
- Any transport other than stdio: no HTTP, SSE, streamable HTTP, WebSocket, socket, or port. The process opens no network listener.
- Adding the official MCP TypeScript SDK or any other runtime dependency (see Decisions).
- JSON-RPC batching, request cancellation, timeouts, progress reporting, `tools/list` pagination, and concurrent in-flight reviews.
- Automatic retry, review cycles, producer loops, implementation execution, `reviewer.implementation`, and `task_artifact_write`.
- Changes to the Phase-1A pipeline order, contracts, state machine, reason codes, event schema, `status.json` schema, digests, or exit codes.
- Documentation edits beyond the four files named in Scope. `docs/DECISIONS.md`, `docs/AUTHENTICATION-AND-SECURITY.md`, `docs/OPEN-SOURCE-POLICY.md`, `docs/PROVENANCE.md`, `docs/ROUTING-AND-WORKFLOWS.md`, and `AGENTS.md` are unchanged.
- The `/spbridge` skill, desktop-tool-specific behavior, Board integration, a daemon, background execution, and crash recovery.
- Copying implementation from `agent-spartans-workbench`, `agent-spartans-worktrees`, or any other repository.
- Commit, push, pull request, merge, release, or package-registry publication.

## Constraints

- This task's Scope, Out of Scope, and Decisions are the controlling boundary. Broader roadmap language in `README.md` and `docs/` is background only.
- All repository content, diagnostics, and user-facing messages are English.
- Node.js 20+, TypeScript ESM, `strict` with the existing `tsconfig.json` flags; no new compiler-option relaxation.
- Original implementation developed for this project under this repository's MIT license.
- No provider secret may enter an argument, request, tool input, configuration, state file, log line, or error message. Error text returned over MCP is sanitized and never includes a stack trace, an absolute host path outside the bound root, or an internal exception message.
- Agent-controlled text never selects a filesystem root, a launcher, an executable, an argument, or an environment value.
- The application core stays independent of the MCP adapter, and the MCP adapter never imports the CLI adapter; both may import `src/composition.ts`.
- Runtime state stays under the bound root's ignored `.spartan-bridge/` directory.
- Tests run against temporary fixture worktrees with an injected in-memory registry; they never read the real user registry or this repository's live task.
- No new runtime or development dependency without first updating `docs/PROVENANCE.md` under `docs/OPEN-SOURCE-POLICY.md`.

## Acceptance Criteria

- [x] `npm run typecheck`, `npm run build`, and `npm test` pass from a clean checkout, and `package.json` dependencies are unchanged.
- [x] `spartan-bridge --help` lists `mcp-stdio` alongside `review`, `status`, `events`, and `doctor`.
- [x] `mcp-stdio` accepts only an optional `--repo`; `--task`, `--run`, `--kind`, any unknown option, a duplicate option, and a missing option value each exit `2` before any root resolution or message handling.
- [x] With no `--repo`, the bound root is `process.cwd()`; with `--repo`, it is the resolved path. An unresolvable or unreadable root exits `1` with one sanitized stderr line and produces no stdout byte.
- [x] The bound root is immutable for the process lifetime, and no message can change it.
- [x] Every stdout byte the server emits is a serialized JSON-RPC message followed by exactly one `\n`, with no embedded newline. A test asserts that each stdout line parses as JSON with `jsonrpc: "2.0"`.
- [x] Malformed JSON returns `-32700` with `id: null`; a batch array or a message missing `jsonrpc: "2.0"` returns `-32600`; an unknown method returns `-32601`; invalid `tools/call` arguments return `-32602`.
- [x] Every error object contains exactly `code` and `message` and carries no `data` member, no stack trace, and no internal exception text.
- [x] A notification (no `id`) never produces a response; `notifications/initialized` is accepted silently.
- [x] `initialize` returns `protocolVersion`, `capabilities` containing exactly `{ "tools": {} }`, and `serverInfo` with `name: "spartan-bridge"` and the pinned version string; a test asserts that version equals `package.json`'s `version`.
- [x] `MCP_PROTOCOL_VERSION` is declared once and equals `2025-06-18`. `initialize` echoes the client's `protocolVersion` when it exactly equals that constant, and otherwise returns the constant. Tests reference the constant, never a duplicated literal.
- [x] `initialize` requires a string `protocolVersion`; a missing or non-string `protocolVersion` returns `-32602`. `capabilities`, `clientInfo`, and any other `initialize` `params` member are accepted and ignored, and no extra key is rejected. A test drives a realistic client handshake carrying all three members and asserts success.
- [x] `ping` succeeds with `params` omitted, empty, or carrying extra members. `tools/list` succeeds with `params` omitted, empty, or carrying a `cursor`, and its result contains no `nextCursor`.
- [x] Closed-key rejection applies only to `tools/call` `arguments`; a test asserts that an unknown key in `initialize`, `ping`, or `tools/list` `params` does not produce an error.
- [x] A second `initialize` returns `-32600`. Before a successful `initialize`, `tools/list` and `tools/call` return `-32600` while `ping` succeeds.
- [x] `tools/list` returns exactly one tool named `review`, whose `inputSchema` has JSON Schema root `"type": "object"`, the single property `task` of type `string`, `required: ["task"]`, and `additionalProperties: false`.
- [x] `tools/call` rejects any name other than `review` with `-32601`, and rejects missing `arguments`, a non-object `arguments`, a missing or non-string `task`, an empty `task`, or any extra argument key with `-32602`.
- [x] Whenever `runReview` returns an outcome, `isError` is computed only as `outcome.exitCode === 1`. A test asserts that `src/mcp/` derives it from no other field, in particular not from `status.state` or `status.reason_code`.
- [x] A `createdRun: true` outcome with `exitCode` 0 returns `isError: false` and one `content` entry of type `text` byte-identical to the CLI's stdout for the same run. This covers every reviewer verdict, including verdict `blocked` (`review_blocked`, RunState `blocked`); a test asserts that RunState `blocked` case explicitly.
- [x] A `createdRun: true` outcome with `exitCode` 1 returns `isError: true` with that same terminal `status.json` text, byte-identical to CLI stdout. This covers every `failed` state and a `blocked` state whose reason is in `PRE_REVIEW_BLOCKED`; a test covers at least one `failed` reason and one pre-review `blocked` reason such as `registry_unavailable`, and asserts that the two RunState-`blocked` cases land on opposite `isError` values.
- [x] A `createdRun: false` outcome returns `isError: true` with a sanitized message and no status text.
- [x] An unexpected exception raised inside the core produces no outcome, so it is the one path outside the `exitCode` rule: it returns `isError: true` with a fixed sanitized message, never a JSON-RPC error and never a stack trace.
- [x] Every `tools/call` of `review` creates exactly one run under the bound root's `.spartan-bridge/runs/`, except when `runReview` returns `createdRun: false`, in which case no run directory is created and the sanitized `isError: true` mapping above applies. For every run-creating call the persisted `status.json` and `events.jsonl` match the Phase-1A matrix for the same inputs; a test compares an MCP-created run against a CLI-created run over identical fixtures.
- [x] A test drives one `createdRun: false` path that is reachable after a successful startup bind (for example a runtime layout that cannot be resolved at call time) and asserts `isError: true`, a sanitized message, no status text, and no new run directory.
- [x] Two `tools/call` requests sent back to back are handled sequentially, produce two distinct run IDs and two distinct `execution_id` values, and produce two responses whose `id` values match the requests in order.
- [x] The transport ignores blank and whitespace-only lines, tolerates a trailing `\r`, and answers a line above the 1 MiB ceiling with `-32700` before resuming at the next newline.
- [x] Closing stdin exits `0` after the in-flight request completes; `SIGINT` and `SIGTERM` exit without writing a partial message.
- [x] The MCP adapter calls the exported `runReview`; a test asserts that `src/mcp/` contains no second review pipeline and imports nothing from `src/cli/`, and that `src/core/` imports nothing from `src/mcp/`.
- [x] No new runtime or development dependency is added, and `docs/PROVENANCE.md` needs no new row.
- [x] Representative failure paths persist and print no secret-shaped value, and the fixture task and fixture product files are unchanged by every MCP-driven run.
- [x] `README.md:3` and the closing status paragraph state that the MCP `stdio` adapter is implemented while real provider adapters and loops are not.
- [x] The `docs/ARCHITECTURE.md` MCP-adapter section describes the shipped Phase-1B surface — one `review` tool taking `{ task: string }` over stdio NDJSON at MCP revision `2025-06-18` — no longer presents `review(run_id, review_kind, artifact_path, artifact_hash)` as the first operation, and still records that `start`, `status`, `stop`, `resume`, and `events` MCP operations are unimplemented.
- [x] [historical document omitted] marks only "expose the same operation through the MCP adapter" (First vertical slice, step 5) as delivered. Phase 2 stays open: the Codex adapter, the real review call, and the later tool signature are not marked complete.
- [x] The historical optional-integrations document changes only the stale "planned interfaces / design-only" sentence; its registration snippet (`args: ["mcp-stdio"]`) is byte-unchanged and still works as written.
- [x] No file outside `src/mcp/`, `src/cli/parse.ts`, `src/cli/main.ts`, `src/index.ts`, `tests/`, and the four documentation files named in Scope is modified; `git status` in the implementation round confirms it.
- [x] The task records the exact commands and outcomes used to verify the implementation, including the `2025-06-18` specification URL used to confirm the stdio framing and method set. That verification records evidence only; it must not change the pinned version, the method set, the initialization gate, or the error mapping.
- [x] A fresh reviewer records `APPROVE` before the task can complete.

## Decisions

- **Adapter, not a second core.** `src/mcp/` translates MCP messages to one call of the exported `runReview` and translates `ReviewOutcome` back. It owns no policy parsing, no state machine, no persistence, and no verdict mapping. Any behavior difference between the CLI and MCP surfaces for the same inputs is a defect.
- **No MCP SDK; project-local stdio JSON-RPC implementation.** This describes the dependency choice, not whether a human or an AI coding agent typed the code. [historical document omitted] names the official SDK as a candidate but requires narrow dependencies and recorded transitive licenses. The stdio transport plus the five pinned methods is a small closed surface, while the SDK's dependency graph carries HTTP-transport code into a product that `docs/AUTHENTICATION-AND-SECURITY.md` pins as exposing no network listener. Phase 1B therefore stays at zero new dependencies. Adopting the SDK later is a separate task that starts with a `docs/PROVENANCE.md` entry.
- **The protocol revision is pinned to `2025-06-18`.** `MCP_PROTOCOL_VERSION` is declared once as `2025-06-18` and referenced everywhere, including in tests. The session protocol implemented here is that revision's: stdio NDJSON framing, `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`. Later revisions are not adopted, because the revision and the method set are one decision, not two: `2026-07-28` removes `initialize`, `notifications/initialized`, and `ping`, so advertising it while keeping the initialization gate would refuse every 2026-era `tools/list` and `tools/call`, and honoring it would break the closed method set. Implementation-time verification confirms the framing and method set against the `2025-06-18` specification and records the URL in Evidence; it does not select the version. An `initialize` requesting any other version receives `2025-06-18` rather than an error, so the client decides whether to continue.
- **The repository root is bound at process start, not per tool call.** The CLI's `--repo` comes from a human; an MCP tool argument comes from a model. Binding the root at startup keeps agent-controlled text from selecting a filesystem root, mirroring the existing rule that agent-controlled text never reaches the launcher catalog. It also keeps the documented registration `{"command": "spartan-bridge", "args": ["mcp-stdio"]}` working, because compatible hosts launch project MCP servers with the project directory as the working directory, while `--repo` remains an explicit override for hosts that do not.
- **One tool, `review`, with input exactly `{ task: string }`.** This matches [historical document omitted] Phase 2's "MCP `stdio` server with one `review` tool" and the Phase-1A one-shot core, which fixes `review_kind` at `plan` and creates its own run. The Phase-2 signature carrying `run_id` and `artifact_hash` belongs to the slice that adds existing-run review.
- **The tool result carries the terminal `status.json` text.** Success and failure both return the same serialized status the CLI prints, so the host sees one auditable representation and the run stays inspectable by ID through `spartan-bridge status`. Byte-identity with CLI stdout is an asserted invariant, not a coincidence.
- **Execution failure is a tool error, not a transport error.** A run that reaches a terminal state is a valid protocol exchange, so its outcome is reported inside the tool result where the calling model can read it. JSON-RPC error codes stay reserved for malformed messages, unknown methods, and invalid parameters. The mapping is exactly `isError = outcome.exitCode === 1`, and there is no second rule keyed on `RunState`, `reason_code`, or verdict. `outcome.exitCode` is the single source of truth because Phase-1A `terminate()` already computes it as `reason.startsWith("review_") ? 0 : 1` (`src/core/review.ts:328-331`), so the adapter reads the core's own terminal judgement instead of re-deriving one.
- **RunState `blocked` is two different outcomes, and only `exitCode` separates them.** A reviewer-terminal `blocked` comes from verdict `blocked` mapped to `review_blocked` (`src/core/contracts.ts:167`): the reviewer ran and returned a delivered result, so it is RunState `blocked`, exit `0`, `isError: false`. A pre-review `blocked` comes from a reason in `PRE_REVIEW_BLOCKED` (`src/core/contracts.ts:170-178`: `automatic_review_not_authorized`, `reviewer_binding_missing`, `host_invalid`, `registry_unavailable`, `client_context_unavailable`, `launcher_unavailable`, `capability_denied`): the run never reached a reviewer, so it is RunState `blocked`, exit `1`, `isError: true`. Every `failed` state is exit `1` and therefore `isError: true`. Both sides carry the same terminal `status.json` text, because the CLI writes `serializeStatus` for every `createdRun: true` outcome before returning `outcome.exitCode` (`src/cli/main.ts:30-31`), so byte-identity with CLI stdout holds regardless of which side of the split a run lands on. A future reason code changes this mapping only through the core's `review_` prefix rule, never through a list maintained in `src/mcp/`.
- **`createdRun: false` is the one exception to one run per call.** `runReview` returns `createdRun: false` with a null status and no run directory when the repository root or the runtime layout cannot be resolved at call time (`src/core/review.ts:307`). That stays reachable after a successful startup bind, because the root or `.spartan-bridge/` can be removed or replaced mid-session. `noRun` already sets `exitCode` 1 (`src/core/review.ts:306-308`), so this case needs no separate `isError` rule; it falls out of the pinned mapping as `isError: true`, and only the suppressed status text and the sanitized message distinguish it. It requires no run directory. Every other `tools/call` of `review` creates exactly one run, so the invariant is stated with its exception rather than contradicted by it.
- **Closed method set with an initialization gate.** Only `initialize`, `notifications/initialized`, `ping`, `tools/list`, and `tools/call` are recognized. `tools/list` and `tools/call` are refused with `-32600` until `initialize` has succeeded, and a second `initialize` is refused, so an uninitialized or re-initialized session fails closed instead of silently working.
- **Handshake methods ignore unknown params; closed-key rejection applies only to `tools/call`.** Compatible clients send `initialize` with `protocolVersion`, `capabilities`, and `clientInfo`, send `ping` with omitted or empty `params`, and may send `tools/list` with a `cursor`. Extending the Phase-1A unknown-key rejection to those methods would fail closed against every real host, so `initialize`, `ping`, and `tools/list` accept and ignore unused and extra members. `initialize` validates exactly one member — a string `protocolVersion`, missing or non-string being `-32602` — and uses it only for the echo rule above. `tools/list` accepts `cursor` and never returns `nextCursor`, because one tool needs no pagination. Strict closed-key validation stays where agent-controlled data actually enters the core: `tools/call` `arguments`.
- **Closed error surface.** The recognized codes are exactly `-32700` parse error, `-32600` invalid request, `-32601` method not found, and `-32602` invalid params. Error objects carry exactly `code` and `message`. Omitting `data` is defense in depth against leaking paths or exception text into a host conversation.
- **Handler-side argument validation.** `additionalProperties: false` in the advertised schema is a hint to the client, not an enforcement point. The handler independently rejects a non-object `arguments`, a missing or non-string or empty `task`, and any extra key, the same way every other Phase-1A contract boundary rejects unknown keys.
- **Strictly sequential message handling.** Messages are handled in arrival order with at most one in flight. The fake reviewer returns immediately, so ordering costs nothing, and it keeps the slice free of the locks and concurrency coordination that [historical document omitted] defers to the daemon phase.
- **Stdout is the protocol channel.** A single stray byte on stdout corrupts the session, so every diagnostic goes to stderr and stdout hygiene is asserted by test rather than left to convention.
- **Transport framing.** Newline-delimited UTF-8 JSON, one message per line. `JSON.stringify` escapes newlines, so a serialized message never contains a literal newline. Reading tolerates `\r\n` and skips blank lines. The 1 MiB per-line ceiling bounds buffer growth from a malformed or hostile stream; exceeding it answers `-32700` and resumes at the next newline rather than terminating the process.
- **No reuse from the local historical repositories.** The owner granted permission to reuse `agent-spartans-worktrees` and `agent-spartans-workbench`, and both were searched. Neither contains any MCP, JSON-RPC, or stdio-transport implementation, so the fastest correct path is the original implementation described here. The `docs/PROVENANCE.md` Workbench gate is therefore not exercised and needs no change.
- **Documentation updates are in scope and bounded file by file.** `AGENTS.md` requires product files to stay implementation truth, so the implementation round edits exactly four documents and only where they describe what this slice ships. `README.md` moves from "MCP … not implemented yet" to the shipped adapter while keeping real adapters and loops as later milestones. The `docs/ARCHITECTURE.md` MCP-adapter section is rewritten rather than softened, because it currently presents `review(run_id, review_kind, artifact_path, artifact_hash)` as the first operation and this slice must not expose that signature; the rewritten section keeps recording that `start`, `status`, `stop`, `resume`, and `events` MCP operations are unimplemented. [historical document omitted] marks only vertical-slice step 5 as delivered and leaves Phase 2 open, since no real Codex adapter, real review call, or later tool signature ships here. The historical optional-integrations document gets one factual correction to its "planned interfaces / design-only" sentence, which Phase 1A already falsified, and its registration snippet stays byte-unchanged. `docs/DECISIONS.md` needs no edit: D-006 already records the CLI-plus-optional-MCP-adapter decision that this slice implements.
- **Owner-directed successor after this task completes.** The next uniquely numbered Spartan task is the first dogfood slice for this repository: a real Cursor `reviewer.plan` adapter plus Bridge persistence of validated findings onto the current Spartan task artifact, so a fresh Claude Code planner session can continue from the file. That overrides that omitted document’s Codex-first vertical-slice step 6 for this repo’s dogfood order only. Host remapping stays in `AGENTS.md`; `spartan-bridge/config.yaml` still does not select hosts. This decision does not add a Cursor adapter, `task_artifact_write`, or a producer loop to Phase 1B.

## Work Completed

- Planning rounds 1-3 produced the approved Phase-1B plan. Plan-review recorded `APPROVE` after closing findings 1-5. No product file was modified in planning.
- Implementation round (HX-006) shipped the MCP stdio adapter over the unchanged Phase-1A core:
  - Added `src/mcp/` (protocol, JSON-RPC, NDJSON transport, session, outcome mapping, server).
  - Added `spartan-bridge mcp-stdio [--repo <path>]` in `src/cli/parse.ts` and `src/cli/main.ts`.
  - Added `tests/mcp.test.ts` and extended CLI parse/help tests.
  - Updated `README.md` status lines, `docs/ARCHITECTURE.md` MCP-adapter section, [historical document omitted] vertical-slice step 5, and the stale sentence in the historical optional-integrations document.
- Host and model actually used for this implementation: Cursor, Grok 4.6, effort high.
- Implementation review round (HX-007) read `src/mcp/`, `src/cli/parse.ts`, `src/cli/main.ts`, `src/index.ts`, `tests/mcp.test.ts`, and the four documentation files against every acceptance criterion and decision, re-ran the repository checks, and independently drove the compiled `dist/` entrypoint over piped stdio. Verdict `APPROVE`. The reviewer wrote only this task artifact; no product file was modified.
- Host and model actually used for this review: Claude Code, Opus 5, effort high, vendor Anthropic. This deviates from the `HX-007` recommendation of Cursor with Grok 4.6 and from the `AGENTS.md` `reviewer.implementation` binding to Cursor. The owner explicitly assigned the reviewer role to Claude Code for this round, which `CLAUDE.md` permits. The deviation strengthens independence rather than weakening it: the implementation ran on Cursor with Grok 4.6, so an Anthropic-vendor review is cross-host and cross-vendor, where the recommended Cursor re-review would have been same-host context separation only.

## Evidence

- Specification confirmation (read-only; did not change the pin): stdio NDJSON framing at https://modelcontextprotocol.io/specification/2025-06-18/basic/transports ; lifecycle methods `initialize` and `notifications/initialized` at https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle ; `tools/list` and `tools/call` at https://modelcontextprotocol.io/specification/2025-06-18/server/tools . `ping` remains in this revision's lifecycle. The later `2026-07-28` revision was not adopted.
- `npm run typecheck` exit 0.
- `npm run build` exit 0.
- `npm test` 53 passed, 0 failed (was 35 before this slice).
- `package.json` dependencies and `docs/PROVENANCE.md` were not modified.
- This round's product files are `src/mcp/*`, `src/cli/parse.ts`, `src/cli/main.ts`, `src/index.ts`, `tests/mcp.test.ts`, `tests/parse.test.ts`, `tests/cli.test.ts`, `README.md`, `docs/ARCHITECTURE.md`, [historical document omitted], and the historical optional-integrations document. `src/core/`, `src/policy/`, `src/runtime/`, `src/adapters/`, and `AGENTS.md` were not modified. `dist/` is gitignored build output.
- The repository has no commits yet, so `git status` lists the whole tree as untracked; the file set above is the implementation delta relative to the approved plan. The same absence of a baseline means the reviewer verified the documentation criteria by reading current content, not by diffing.
- Review round checks: `npm run typecheck` exit 0; `npm run build` exit 0; `npm test` 53 passed, 0 failed. `git status --porcelain` unchanged from the implementation round; `.gitignore` covers `dist/` and `.spartan-bridge/`.
- Independent end-to-end check of the compiled artifact (not covered by the suite, which runs `tsx` over `src/`): piping `initialize`, `tools/list`, and `tools/call` into `node dist/cli/main.js mcp-stdio --repo <tmp>` returned the pinned `2025-06-18` handshake, `capabilities` exactly `{"tools":{}}`, `serverInfo` version `0.1.0` matching `package.json`, exactly one `review` tool with `additionalProperties: false`, one terminal `status.json` text with `isError: true` for a `failed` state, exactly one run directory, and exit 0 on stdin end-of-file.
- Independent protocol-surface probe against the same compiled artifact: `tools/list` before `initialize` returned `-32600`; `ping` before `initialize` succeeded with an extra `params` member; malformed JSON returned `-32700` with `id: null`; `jsonrpc: "1.0"` returned `-32600` with the request `id` preserved; `notifications/initialized` produced no response; `initialize` without `protocolVersion` returned `-32602`. Every error object carried exactly `code` and `message`.
- Reviewer observations that do not violate an acceptance criterion or a decision, recorded for a later round rather than as findings: `mcp-stdio --repo=` with an empty value binds `process.cwd()` instead of exiting 2, unlike `review --repo`, which rejects an empty value; the new sentence in the historical optional-integrations document states that `review` is implemented directly beneath a pre-existing snippet showing the Phase-2 `review --run --kind` signature that the current CLI rejects with exit 2; `SERVER_VERSION` is read synchronously when `src/mcp/protocol.ts` loads, which `src/cli/main.ts` imports transitively, so every CLI command now reads `package.json` at startup; and the `if (skipping)` branch inside `frameStdin`'s `takeLines` is unreachable, because `skipping` is always false on entry and the generator returns immediately after setting it.

## Review

Plan verdict: APPROVE (plan re-review of finding 5 only). Findings 1-5 remain closed in Decisions.

Implementation verdict: APPROVE.

The MCP adapter translates messages to one call of the exported `runReview` and owns no policy, state machine, persistence, or verdict mapping; `src/core/` imports nothing from `src/mcp/` and `src/mcp/` imports nothing from `src/cli/`. `isError` is derived only from `outcome.exitCode === 1`, with the reviewer-terminal and pre-review `blocked` cases landing on opposite values, and the sole exception path — an exception raised inside the core — returns a fixed sanitized tool error rather than a JSON-RPC error. The protocol revision is pinned once, the method set and error surface are closed, closed-key rejection is confined to `tools/call` `arguments`, no dependency was added, and the four documentation files describe what this slice actually ships. All 30 preceding acceptance criteria are satisfied.

## Blockers

None.

## Next Action

None. Phase 1B acceptance criteria are satisfied, checks have recorded outcomes, the required implementation review is `APPROVE`, and no blocker remains.

## Follow-on after this task completes

Do not start this work in Phase 1B. When `0002` is `completed`, create a new uniquely numbered artifact from the Spartan task template; do not reopen this file.

Suggested slug: `cursor-plan-review-dogfood`.

Owner objective: start using `spartan-bridge` as dogfood on this repository — Claude Code as planner, Cursor as `reviewer.plan` — to accelerate Bridge construction.

That next task plans and then implements the smallest slice that makes that loop real:

- A real Cursor adapter for `reviewer.plan` through an official local Cursor client or supported local interface, with a technically enforced read-only session. If that permission mode cannot be enforced, the Bridge stops for the human; it does not fall back to a writable reviewer.
- After a terminal plan-review result, the Bridge applies the already-granted `task_artifact_write` only to the explicit current Spartan task: verdict, findings, and transition metadata. Product files, `AGENTS.md`, and other tasks stay untouched.
- Continuation after `CHANGES` is a new human-started Claude Code conversation that opens the same task file. The Bridge does not need to return findings into the original Claude thread.
- One plan-review attempt on the existing Phase-1A core and Phase-1B MCP/`review` tool. No review-cycle automation, no implementer start, no `reviewer.implementation`.
- Host bindings remain the root `AGENTS.md` table. A Claude-only or Claude+Codex week is an `AGENTS.md` edit plus adapters for the named hosts, not a `config.yaml` remap.

Out of scope for that successor until a later task: producer/reviewer loops, implementation execution, a Codex reviewer adapter (unless a later `AGENTS.md` maps `reviewer.plan` to Codex), `/spbridge`, Board, and daemon.

## Next Handoff

Non-binding suggestion for a possible new task; this artifact is complete and must not be reopened.

```text
Recommended execution (human decides):
- Host: Claude Code, the `AGENTS.md` binding for `planner`
- Model and effort: Opus 5, effort high; fall back to Fable 5 if the real-adapter and read-only-enforcement design proves harder than expected
- Role: planner
- Invocation: `/spartan`, passing the prompt block below as the argument
```

```text
Create a uniquely numbered artifact from `assets/task-template.md` in `spartan/tasks/`, suggested slug `cursor-plan-review-dogfood`. Do not open or update `spartan/tasks/0002-mcp-stdio-adapter.md`.

Act as planner. Plan the first dogfood slice recorded in that completed task's follow-on section: a real Cursor `reviewer.plan` adapter with a technically enforced read-only session, plus Bridge persistence of validated findings and transition metadata onto the explicit current Spartan task artifact. Success: a closed implementable plan with explicit scope, out of scope, and acceptance criteria, and no review-cycle automation, implementer start, or `reviewer.implementation` in it.
Run the relevant repository checks and update the new task file.

Return only the next handoff, or a completion notice if no work remains.
```
