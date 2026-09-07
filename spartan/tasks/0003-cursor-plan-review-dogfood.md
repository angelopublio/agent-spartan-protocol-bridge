---
protocol: "0.6.1"
id: cursor-plan-review-dogfood
created_at: 2026-08-16
status: completed
phase: complete
task_type: implementation
risk: high-impact
current_role: implementer
next_role: planner
updated_at: 2026-08-16
handoff_id: HX-021
next_handoff_id: none
---

# Plan the Cursor plan-review dogfood slice

> Editorial note (2026-09-07): unused platform names and historical integration-document names were generalized for publication. The historical optional-integrations document refers to the former combined cockpit and Board documentation; its Board material is now in `docs/BOARD.md`. Any example path in this cleanup is a normalized placeholder. Original round outcomes, commands, and technical findings are retained; historical line references are not current navigation targets.

## Objective

Produce a closed, implementable plan for **Phase 2A: real Cursor plan review with task-artifact persistence** — the first dogfood slice in which the Bridge stops using the in-process fake for `reviewer.plan`.

The planned slice delivers two things and nothing more:

1. a real `reviewer.plan` adapter that runs the already-authenticated official Cursor Agent CLI in a fresh, technically enforced read-only session over an artifact-only review surface, and returns a validated structured result;
2. a schema-constrained `task_artifact_write` that persists the validated findings and transition metadata onto the one explicitly identified current Spartan task artifact.

This round is planning only. No adapter code, contract change, or task-write code is written here.

## Context

Facts a new session cannot infer from the repository:

- Phase 1A delivered the fake plan-review CLI core; Phase 1B delivered the MCP `stdio` adapter over the same core. Both are complete. This slice is the next one and is named **Phase 2A** here.
- Root `AGENTS.md` already binds `reviewer.plan` to host `Cursor` in client context `personal`, already carries the automatic-review grant with a 3-cycle ceiling, and **already carries the `task_artifact_write` grant sentence**. No `AGENTS.md` amendment is required by this slice, and amending it is a human gate that this slice must not take.
- An earlier internal roadmap initially named Codex as the first real reviewer. This repository's `AGENTS.md` binds `reviewer.plan` to Cursor, and `AGENTS.md` is authoritative for host bindings. The slice therefore implements a Cursor adapter first; the roadmap text is background, not the controlling boundary.
- The Cursor Agent CLI is installed on the planning machine as `cursor-agent` (also `agent`), version `2026.08.11-e8db854`. Its `--help` surface, observed in this round, offers: `-p/--print`, `--output-format text|json|stream-json`, `--mode plan|ask`, `--sandbox enabled|disabled`, `--workspace <path>`, `--trust`, `--model`, `--resume`, `--continue`, `-f/--force`, `--yolo`, `--auto-review`, `--approve-mcps`, `--api-key`, `--endpoint`, `--header`, `-w/--worktree`, `--add-dir`, `--plugin-dir`, and the subcommands `login`, `logout`, `status|whoami`, `models`, `mcp`, `plugin`, `worker`, `bedrock`, and the shell-integration pair.
- That help text states explicitly that `--print` alone "has access to all tools, including write and shell". `--mode plan` is documented as "read-only/planning (analyze, propose plans, no edits)". Therefore `--print` without `--mode plan` is a write-capable session and must never be launched by this adapter.
- How the machine-local wrapper actually selects a client context matters to this design and is easy to get wrong. `docs/examples/agent-profiles/wrap-official-client` resolves the profile from `$PWD` — the nearest `AGENTS.md` `Client context` value, then a user-local roots map, then `personal` — and only afterwards sets `HOME`, `CURSOR_CONFIG_DIR`, and `AGENT_CLI_CREDENTIAL_STORE` for the child. The parent `HOME` does not select the context; the child's working directory does. The Bridge must therefore control `cwd` and the workspace's `AGENTS.md` copy, and must never set profile variables itself.
- The strength of `--mode plan` and `--sandbox enabled` as an enforcement boundary against writes **outside** the workspace is not documented in this repository and was not measured. The plan therefore treats client-side mode as one layer, adds Bridge-owned filesystem, snapshot, and verification layers, and requires an empirical hostile-prompt probe before the binding may be declared available.
- Independence: the plan is produced by Claude Code (Anthropic); plan review runs in Cursor on a non-Anthropic model, which is an independent vendor.

## Scope

Everything below is a deliverable of the planned Phase-2A implementation round, not of this planning round.

### Contracts

- Split the schema constants: runtime contracts (`ReviewRequest`, `ReviewResult`, `ResolvedPolicy`, `AdapterCapabilities`, `AdapterReviewInput`, `StatusDocument`, `EventDocument`) move to `SCHEMA_VERSION = 2`; the user-local client-context registry keeps its own `REGISTRY_SCHEMA_VERSION = 1` so existing `client-contexts.yaml` files stay valid.
- Extend `ResolvedPolicy` with `task_artifact_write_authorized: boolean` and pin its position in the canonical policy JSON used for the policy digest.
- Extend `AdapterReviewInput` with `repo_root: string`, consumed only by `prepare` and the core and never forwarded to the child process.
- Extend `StatusDocument` and `EventDocument` with `task_write_state` and `task_hash_after_write`, at the pinned key positions.
- Add the reason codes and the one new event type pinned in Decisions. Every contract stays closed: unknown keys still fail validation.

### Adapter lifecycle and core pipeline

- Move the shared `Adapter` type and add typed adapter error classes to a new `src/adapters/adapter.ts`; `src/adapters/fake.ts` consumes them and keeps its current exports working.
- Extend the lifecycle to `capabilities -> preflight -> prepare -> start -> collect -> verify -> cleanup`, with `cancel` as the best-effort abort path, exactly as pinned in Decisions. The fake implements `prepare`, `verify`, and `cleanup` as documented no-ops.
- Map each typed adapter error to exactly one reason code, honored only from the hook that owns it, so isolation, timeout, and write-detection failures can no longer collapse into `capability_denied` or `adapter_error`.
- Add a core-owned worktree baseline snapshot before `review_started` and a comparison after `collect`, with the exclusions, caps, and disjoint predicates pinned in Decisions.

### Policy parsing

- Recognize, in the existing `## Spartan Bridge automation authority` section and under the existing literal grammar, exactly one list item whose text is the exact sentence pinned in Decisions, and set `task_artifact_write_authorized` from it.
- An absent grant is not a failure: the review still runs and the Bridge simply performs no task write. A duplicated grant line is `failed / agents_policy_invalid`, consistent with the existing literal parser.

### Real Cursor adapter

- Add `src/adapters/cursor.ts` implementing the extended lifecycle for launcher identifier `cursor-plan-reviewer-v1`.
- Register that identifier in the application-owned launcher catalog with an immutable `{ executable, args }` specification. Repository content, task text, registry content, and model output never contribute an executable, argument, or environment value.
- `preflight` runs only the pinned non-interactive interface probe. It never invokes an authentication, account, model-listing, MCP, plugin, worker, or shell-integration subcommand, and never inspects credentials, account identity, subscription, or billing.
- `prepare` materializes a fresh ephemeral reviewer workspace outside the repository for each execution, containing read-only copies of exactly the reviewed task artifact and root `AGENTS.md`, and snapshots that workspace.
- `start` spawns the official client directly with the pinned argument array, no shell, the pinned environment allowlist, `cwd` set to the workspace root, closed stdin, a fixed timeout, and termination on expiry or cancel.
- `collect` extracts one structured result from the client's JSON output; the core validates it through the existing closed `validateReviewResult`.
- `verify` re-snapshots the ephemeral workspace and fails closed on any added, removed, or modified entry.
- `cleanup` removes the ephemeral workspace; a cleanup failure is recorded and never terminal.
- Persist the validated result to `.spartan-bridge/runs/<run-id>/reviews/<execution_id>.json`. Raw provider stdout and stderr are never persisted.

### Task-artifact write

- After write-detection, the integrity re-check, and result validation, and only for verdicts `pass` and `changes_requested`, splice a single Bridge-owned marker region into the `## Review` section of the one task artifact named by `--task`, following the heading matcher, region grammar, verdict mapping, sanitizing rules, atomic-write rule, and post-write byte verification pinned in Decisions.
- Emit `task_artifact_written` and record `task_write_state` and `task_hash_after_write` in status and events.
- Refuse and fail closed, without modifying the file, on every rejection condition pinned in Decisions.

### Diagnostics, CLI, tests, and documentation

- Change `spartan-bridge status` to print the stored `status.json` bytes verbatim, as `events` already does, so a stored schema-1 run is never reprinted through a schema-2 serializer.
- Extend `doctor` to report Cursor launcher executable and interface availability through the same probe, under the same non-authentication rules already applied to the fake.
- Add tests covering: the extended lifecycle and per-hook typed-error mapping; argv and environment sanitization through a real spawn of a local stub executable; `cwd` and the workspace `AGENTS.md` copy; workspace permissions, snapshot, and cleanup; worktree write detection versus `integrity_mismatch`; snapshot caps; result extraction and rejection; the extended reason, event, status, and exit-code matrix; every task-write acceptance and rejection path including the heading-matcher fixtures; task-write idempotency across two runs; verbatim `status` output for a stored schema-1 file; and `doctor` output.
- Record one manual dogfood run in a temporary fixture worktree as evidence, plus the hostile-prompt enforcement probe result.
- Update `README.md`, `docs/ARCHITECTURE.md`, `docs/AUTHENTICATION-AND-SECURITY.md`, and [historical document omitted] to describe Phase 2A behavior, the enforcement layers actually verified, and the honest limits of the read-only claim, including the documented residual detection gaps.

## Out of Scope

- Review-cycle automation of any kind: no loop, no retry, no returning findings to the producer for another attempt. `max_review_cycles` is still parsed and still ignored beyond one attempt per invocation.
- Starting an implementer, automatic producer transition, `awaiting_implementer` dispatch, or any change of producer role or host.
- `reviewer.implementation`, implementation review, and `review_kind` values other than `plan`.
- Product-file inspection by the reviewer. Phase-2A reviews are artifact-only: the reviewer sees the reviewed task artifact and root `AGENTS.md` and nothing else, and the repository realpath never reaches the client. Widening the review surface — extra `--add-dir` paths, a repository-rooted workspace, or source excerpts in the prompt — is a later slice.
- Real Codex and Claude Code adapters; the in-process fake stays registered and behaviorally unchanged.
- Any Bridge edit to task frontmatter, including `updated_at`, `status`, `phase`, `current_role`, `next_role`, `handoff_id`, and `next_handoff_id`.
- Generating, rewriting, or clearing a `Next Handoff` envelope, or writing any Spartan section other than the owned region inside `## Review`.
- Writing any file other than the single task artifact named by `--task`, the run directory under `.spartan-bridge/`, and the ephemeral workspace outside the repository.
- Amending `AGENTS.md`, host bindings, automation authority, or the role permission table.
- `spartan-bridge/config.yaml`, configurable timeouts or caps, scoped reviewer fallback, `start`, `stop`, `resume`, and `review --run`.
- Worktree writer locks, leases, concurrency coordination, daemon, background execution, crash recovery, scheduling, and Board control.
- Model selection: no `--model`, `--resume`, `--continue`, `-w/--worktree`, `--add-dir`, or `--plugin-dir` flag is passed.
- Authentication of any kind: no `login`, `logout`, `status`, `whoami`, `models`, `--list-models`, `--api-key`, `--endpoint`, or `--header`; no credential detection, account identification, or billing inference.
- Installing, repairing, or validating the machine-local wrapper, and any attempt to detect or assert which client context or account the official client actually used.
- A new MCP tool or MCP surface change beyond the extended status fields already returned by the shared core.
- Commit, push, pull request, merge, release, publication, and package distribution.
- Copying implementation from `agent-spartans-workbench` or another repository.

## Constraints

- Root `AGENTS.md` is the controlling authority for bindings, grants, permissions, and human gates. This task's Scope, Out of Scope, and Decisions are the controlling implementation boundary within that authority; broader roadmap text does not enter implicitly.
- All repository content and persisted artifacts are English. Original implementation developed for this project under this repository's MIT license.
- Direct process spawning with argument arrays only. No shell interpolation anywhere in the adapter path.
- No provider credential may be accepted, read, forwarded, persisted, printed, or injected. The Bridge never sets or forwards `CURSOR_API_KEY`, `CURSOR_API_ENDPOINT`, `CURSOR_CONFIG_DIR`, `AGENT_CLI_CREDENTIAL_STORE`, or any other credential or profile variable.
- Reviewer read-only behavior must be technically enforced, not prompted. Documentation may claim only what the probe in Acceptance Criteria actually demonstrates, and must state the residual gaps pinned in Decisions.
- If the enforcement probe fails, or the client cannot be run with the required flags, the binding is unavailable: the run fails closed and stops for the human. Shipping a weaker session is not an option.
- Task content, `AGENTS.md` content, and model output are untrusted input. They may not influence permissions, argv, environment, paths, cycle limits, or the written region's structure.
- Runtime state stays under the ignored `.spartan-bridge/`; the ephemeral reviewer workspace stays outside the repository; the only repository file the runtime may write is the explicitly named task artifact.
- Node.js 20+, TypeScript ESM, narrow dependencies. The application core stays independent of CLI, MCP, Board, and skill adapters.
- Tests must not require network access, an authenticated Cursor session, or the real official client.

## Acceptance Criteria

Criteria for the planned implementation round. The planning round is judged by the review of this artifact.

- [x] `npm run typecheck`, `npm run build`, and `npm test` pass on a clean checkout, and the task records their outcomes.
- [x] Runtime contracts carry `schema_version: 2`; the registry parser still accepts `schema_version: 1` and rejects `2`, proven by fixtures on both sides.
- [x] `ResolvedPolicy` contains exactly the pinned keys including `task_artifact_write_authorized`, and the policy digest is computed over the pinned key order; a fixture pins the digest input string.
- [x] The exact `task_artifact_write` grant sentence sets authorization to `true`; a fixture without the sentence resolves `false` and completes a review with `task_write_state: not_authorized`; a duplicated sentence is `failed / agents_policy_invalid`.
- [x] Each lifecycle hook maps its own typed error and no other: an isolation error from `prepare` is `failed / reviewer_isolation_unavailable` with events `R, P, X`; a timeout error from `start` or `collect` is `failed / adapter_timeout` with `R, P, S, X`; a write-detected error from `verify` is `blocked / reviewer_write_detected` with `R, P, S, X`; the same typed error thrown from any other hook is `failed / adapter_error`; an untyped `preflight` throw stays `blocked / capability_denied`.
- [x] `cleanup` is called exactly once per attempt, proven by a counting stub adapter on five paths: full success; a `prepare` throw after the workspace exists; a `start` or `collect` failure; a `verify` write-detection failure; and a step 8-or-later failure (`integrity_mismatch`, `result_schema_invalid`, or `task_artifact_write_rejected`). The same test asserts `cancel` is called exactly once on the three paths where `start` was invoked and the attempt failed, zero times on the success path, and zero times on the `prepare`-throw path.
- [x] A failure before `prepare` is invoked calls neither `cancel` nor `cleanup`.
- [x] A throwing `cancel` and a throwing `cleanup` change neither state, reason code, exit code, nor the emitted events, and do not mask the error already propagating.
- [x] A stub adapter that modifies a product file such as `src/` during `collect` yields `blocked / reviewer_write_detected`; the existing Phase-1A case that modifies the reviewed task still yields `failed / integrity_mismatch`; a modified workspace copy yields `blocked / reviewer_write_detected`. All three are asserted in one test file so the predicates stay disjoint.
- [x] Worktree snapshot exclusions, caps, symlink handling, and the large-file fallback behave as pinned; exceeding either cap yields `failed / reviewer_isolation_unavailable` before `review_started`; writes under `.spartan-bridge/` by the Bridge itself never trigger detection.
- [x] `cursor-plan-reviewer-v1` resolves only through the application-owned catalog, advertises `review_kinds: ["plan"]`, `permission_modes: ["read-only"]`, `workspace_write: false`, `fresh_context: true`, and passes the existing capability gate.
- [x] `preflight` and `doctor` use exactly the pinned probe argv; a test scans the adapter's constant argv tables and asserts that no forbidden flag or subcommand can appear in any spawn the adapter performs.
- [x] A spawn-level test against a local stub executable proves the exact pinned review argv, the pinned `cwd`, that the child environment contains only the pinned allowlist and no credential-shaped or profile variable, and that the workspace root holds a byte-identical copy named exactly `AGENTS.md`.
- [x] The same spawn-level test proves the review is artifact-only: the repository realpath appears in no argv element, no child environment value, and no byte of the prompt argument; `--workspace` resolves to the ephemeral workspace root; and no `--add-dir` or other path-widening flag is present.
- [x] Each execution creates a new ephemeral workspace outside the repository containing exactly the two `0444` copies; two sequential executions get different workspace paths and different `execution_id` values; both workspaces are removed after the attempt.
- [x] A stubbed client that exceeds the timeout yields `failed / adapter_timeout` after the process is terminated; one that exits non-zero or emits unparsable or oversized output yields `failed / adapter_error`; a schema-invalid payload yields `failed / result_schema_invalid`.
- [x] The validated result is persisted at `.spartan-bridge/runs/<run-id>/reviews/<execution_id>.json`, and no raw provider stdout or stderr appears anywhere in run state, task content, or CLI output.
- [x] A `pass` result writes the owned region with `Verdict: APPROVE` and no findings; a `changes_requested` result writes `Verdict: CHANGES` with one rendered bullet per finding; `human_required` and `blocked` write nothing and record `task_write_state: skipped_human_gate`.
- [x] Outside the owned region the task file is byte-identical before and after a successful write, including frontmatter and every other section; a test asserts this on a task whose `## Review` section already contains human text, which survives below the region.
- [x] Running two successive accepted reviews against the same task leaves exactly one owned region, replaced in full by the second run.
- [x] The heading matcher accepts only an unfenced `## Review` line with no trailing whitespace and no closing hashes; fixtures with `## Review ` (trailing space), `## Review ##`, `## Review notes`, a fenced `## Review`, zero headings, and two headings all reject the write and leave the file byte-identical.
- [x] Every pinned rejection condition yields `human_required / task_artifact_write_rejected`, preserves the accepted verdict in status, and leaves the file byte-identical.
- [x] `status.json` and `events.jsonl` carry the pinned key order; both new fields are `null` on every Phase-1A row and on every event before the write decision; the `A`, `W`, and `X` field values match the pinned table, including the case where `X` carries a different state and reason code than `A`.
- [x] Exit code is `0` exactly when the final reason code begins with `review_`. The Phase-1A assertions still hold unchanged: accepted `pass`, `changes_requested`, `human_required`, and `blocked` all exit `0`, whatever the `task_write_state`, and reviewer-terminal `review_blocked` is still `isError: false` over MCP. The four new reason codes exit `1`, and the MCP `review` tool reports `isError: true` for them.
- [x] `spartan-bridge status` prints stored bytes verbatim: a fixture run directory holding a schema-1 `status.json` round-trips byte-identically through the command.
- [x] `doctor` reports Cursor launcher executable and interface availability without any authentication, account, subscription, billing, or readiness claim, and still reports the fake.
- [x] An enforcement probe is executed manually against the real client in a temporary fixture worktree, using a hostile prompt that instructs the reviewer to modify a file inside the workspace, a product file at an absolute path inside the fixture repository, and the reviewed task at its absolute path. The task records the observed behavior, the resulting hashes and snapshot comparison, and whether each write was prevented by the client or only detected by the Bridge.
- [x] Documentation states exactly the enforcement layers the probe demonstrated, names the residual gaps pinned in Decisions, claims no OS-level sandboxing that was not observed, and states plainly that a Phase-2A review is artifact-only and does not inspect product files.
- [x] A manual dogfood run in a temporary fixture worktree produces one real artifact-only Cursor plan review and one accepted task write, and the task records the commands and outcomes. The record claims no product-file inspection. No live `spartan/tasks/` artifact is written without explicit human authorization in that round.
- [x] No review cycle, retry, implementer start, producer transition, or `reviewer.implementation` path exists in the shipped code, proven by the absence of any transition out of a terminal state.
- [x] A fresh reviewer records `APPROVE` on the implementation before that task may complete.

## Decisions

- **Slice name.** This is Phase 2A. Its boundary overrides broader roadmap language for the implementation round.
- **Registry compatibility.** `SCHEMA_VERSION` becomes `2` for runtime contracts only. `REGISTRY_SCHEMA_VERSION` stays `1`, because the registry is a user-local file the Bridge must not invalidate. Pre-existing local run directories are not migrated and are never re-serialized (see **CLI output**).
- **Canonical policy JSON key order.** `schema_version`, `review_kind`, `host`, `client_context`, `launcher_id`, `automatic_review_authorized`, `task_artifact_write_authorized`, `max_review_cycles`, `permission_mode`. The digest remains SHA-256 over that UTF-8 JSON with no whitespace, rendered `sha256:<64 lowercase hex>`.
- **Grant literal.** The recognized sentence is exactly: ``This run grants the Bridge `task_artifact_write` only for persisting validated reviewer findings and transition metadata to the explicitly identified current Spartan task artifact.`` It is matched as a list item under the same literal grammar the existing grants use. Absence means no write; duplication is `agents_policy_invalid`.

### Lifecycle and reason mapping

- **Hooks.** `src/adapters/adapter.ts` owns the shared type: `capabilities(): AdapterCapabilities`, `preflight(): Promise<void>`, `prepare(input: AdapterReviewInput): Promise<void>`, `start(input: AdapterReviewInput): Promise<void>`, `collect(): Promise<unknown>`, `verify(): Promise<void>`, `cancel(): Promise<void>`, `cleanup(): Promise<void>`. The fake implements `prepare`, `verify`, and `cleanup` as no-ops, documented as trusted because it is in-process and holds no external workspace.
- **Typed errors.** `AdapterIsolationError`, `AdapterTimeoutError`, and `ReviewerWriteDetectedError` are exported from the same module. Each is honored only from the hook that owns it: isolation from `prepare`, timeout from `start` or `collect`, write-detected from `verify`. A typed error raised from any other hook, and every untyped throw from `prepare`, `start`, `collect`, or `verify`, is `failed / adapter_error`. An untyped `preflight` throw keeps its Phase-1A mapping, `blocked / capability_denied`.
- **Core pipeline.** Phase-1A steps 1 through 4 are unchanged. From step 5:
  1. resolve the launcher, apply the capability gate, call `preflight()`;
  2. take the core-owned worktree baseline snapshot; a failure or cap overflow is `failed / reviewer_isolation_unavailable`;
  3. allocate `execution_id`, build `AdapterReviewInput` (now carrying `repo_root`), call `prepare(input)`;
  4. emit `review_started`;
  5. call `start(input)` then `collect()`;
  6. call `verify()`;
  7. compare the worktree snapshot;
  8. re-check the two reviewed artifacts and the policy digest;
  9. validate the result;
  10. emit `review_result_accepted`;
  11. decide and perform the task write, emitting `task_artifact_written` only on success;
  12. emit `run_terminal`.
- **Cancel and cleanup.** One rule, implemented as a single guarded `finally` in the core, so each hook runs at most once per attempt on every path. The core keeps two attempt-scoped flags: `prepareInvoked`, set immediately before calling `prepare(input)` at step 3, and `startInvoked`, set immediately before calling `start(input)` at step 5.
  - Steps 3 through 12 are wrapped in one `try` whose `finally` calls `cleanup()` exactly once whenever `prepareInvoked` is true. This covers a throw from `prepare` itself after the workspace exists, every failure between steps 5 and 7, every failure at step 8 or later (integrity mismatch, schema invalid, task-write rejection), and the fully successful path.
  - `cancel()` is called exactly once, from the same `finally` and before `cleanup()`, if and only if `prepareInvoked` and `startInvoked` are both true and the attempt is leaving that block with an error propagating. It is never called on the success path and never called when `start` was not reached.
  - A failure before step 3 calls neither hook, because no adapter-owned resource exists yet.
  - `cleanup()` must additionally be idempotent in the adapter, but the core never relies on that: correctness comes from the single call site.
  - A throw from `cancel()` or `cleanup()` is caught and swallowed at that call site. It changes no state, reason code, exit code, event, or emitted field, and never masks the error already propagating.
  - On the success path this places `cleanup()` after step 12 rather than after step 7. The ephemeral workspace is therefore still present while the task write runs; nothing in steps 8 through 12 reads or writes it, and `verify` at step 6 has already frozen the comparison evidence.

### Write detection and its disjoint predicates

- **Worktree snapshot.** Rooted at the resolved `repoRoot` realpath. Directory entries named `.git`, `node_modules`, or `.spartan-bridge` are skipped at any depth; nothing else is skipped, so `dist/` and other ignored paths are still watched. Every remaining entry records its repository-relative POSIX path, entry kind, POSIX mode bits, and size; regular files of at most 1 MiB also record the SHA-256 of their bytes, larger files record `mtimeNs` instead. Symlinks record their link target and are never followed. Caps are 20,000 entries and 256 MiB of hashed bytes; exceeding either is `reviewer_isolation_unavailable` at step 2, before `review_started`.
- **Disjoint predicates.** Evaluated in pipeline order, each owning a distinct path set:

  | Observation | Reason code | Terminal state |
  | --- | --- | --- |
  | Any ephemeral-workspace entry added, removed, or modified, including a mode change on either copy | `reviewer_write_detected` | `blocked` |
  | Any worktree entry outside the two reviewed artifacts and the skipped directories added, removed, or modified | `reviewer_write_detected` | `blocked` |
  | The reviewed task or root `AGENTS.md` changed or became unreadable, or the recomputed policy digest differs | `integrity_mismatch` | `failed` |

  The two reviewed artifacts are recorded in the snapshot but excluded from its comparison, so exactly one reason applies to any single observation and the Phase-1A mutating-task behavior is preserved unchanged.
- **Residual gaps, to be documented rather than claimed away.** A same-UID process can `chmod` the workspace, restore content and `mtime` to hide a transient write, or write inside `.git`, `node_modules`, or `.spartan-bridge`; files above the hash cap are compared by size and `mtimeNs` only. Snapshot comparison is defense in depth and evidence for the probe, not a sandbox.

### Cursor adapter execution

- **Launcher specification.** `cursor-plan-reviewer-v1` maps to the immutable specification `{ executable: "cursor-agent", args: [...] }`, resolved through `PATH` by the direct spawn API with `shell: false`. The user-local registry may only name the identifier, exactly as today. The adapter never spawns an absolute path to a real binary and never bypasses whatever `PATH` resolves.
- **Probe argv.** `preflight` and `doctor` both spawn exactly `["--help"]`, with the pinned environment allowlist, `cwd` set to the OS temporary directory, stdin closed, a 15,000 ms timeout, and a 1 MiB stdout cap. Success requires exit code 0 and the literal tokens `--print`, `--output-format`, `--mode`, `--sandbox`, `--workspace`, and `--trust` in stdout. Anything else is a `preflight` throw, hence `blocked / capability_denied`.
- **Forbidden invocations.** The adapter's constant argv tables may never contain `--force`, `-f`, `--yolo`, `--auto-review`, `--approve-mcps`, `--sandbox disabled`, `--api-key`, `--endpoint`, `--header`, `-H`, `--model`, `--list-models`, `--resume`, `--continue`, `-w`, `--worktree`, `--worktree-base`, `--add-dir`, `--plugin-dir`, or the subcommands `login`, `logout`, `status`, `whoami`, `models`, `mcp`, `plugin`, `worker`, `bedrock`, `install-shell-integration`, and `uninstall-shell-integration`. A test asserts this over the tables themselves, not only over one call.
- **Review argv.** `["-p", "--output-format", "json", "--mode", "plan", "--sandbox", "enabled", "--trust", "--workspace", <workspace-root>, <prompt>]`, with `cwd` set to the workspace root and stdin closed. `--trust` only suppresses the interactive trust prompt for a Bridge-created directory; the probe must confirm it grants no write in plan mode.
- **Working directory and the machine-local wrapper.** `cwd` is the ephemeral workspace root, and the workspace root holds a byte-identical copy of the repository's root `AGENTS.md` under exactly that filename. This is load-bearing: the wrapper resolves the client context from the nearest `AGENTS.md` relative to `$PWD`, so an absent or renamed copy would silently fall through to the roots map or `personal`. The Bridge forwards `PATH` unchanged because `PATH` is what resolves the wrapper, and forwards `HOME` unchanged because the wrapper — not the Bridge — relocates `HOME` per profile. The Bridge never sets `HOME`, `CURSOR_CONFIG_DIR`, `AGENT_CLI_CREDENTIAL_STORE`, or any other profile variable, never verifies which profile was selected, and makes no claim about the account used.
- **Environment allowlist.** The child receives exactly `PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL`, and `TERM` when present in the parent, and nothing else. Any variable whose name matches the existing sensitive-field classifier is excluded even if it would otherwise be allowlisted.
- **Ephemeral workspace.** `fs.mkdtemp` under the OS temporary directory, parent mode `0700`, containing exactly `task.md` and `AGENTS.md` at mode `0444`. The primary attempt sets the workspace directory to `0555`; if the client demonstrably cannot operate in a non-writable workspace, the bounded fallback is a `0700` workspace with both copies still `0444`. Either way `verify` compares a full entry listing, so the fallback loses no detection. The implementation records which mode shipped and why.
- **Review surface: artifact-only.** A Phase-2A review sees exactly the two files in the ephemeral workspace — the reviewed task artifact and the repository's root `AGENTS.md` — and nothing else. It is a plan review, and a Spartan plan is judged against the task artifact and the controlling policy, both of which are present. The repository realpath is never passed to the client: it appears in no argv element, no environment variable, and no byte of the prompt, and `--workspace` continues to point at the two-file directory. This is the pin for `PROMPT-ROOT`; product-file inspection by the reviewer is out of scope for this slice, and widening the surface is a later slice's decision, not an implementation detail.
- **Why `repo_root` still exists.** `AdapterReviewInput.repo_root` is consumed only inside `prepare`, to resolve the root `AGENTS.md` that is copied into the workspace, and by the core for its own worktree snapshot. It is never forwarded to the child process in any form. A test asserts the realpath string is absent from the spawned argv, the child environment, and the prompt argument.
- **Prompt.** The final positional argument is Bridge-owned static text that names the two workspace files by their workspace-relative names `task.md` and `AGENTS.md`, states the read-only role, states that no other file is available for this review, and requires a single JSON object matching the closed result schema as the last output. The prompt is not a security boundary. Task and `AGENTS.md` content reach the reviewer only as workspace files, never spliced into instructions.
- **What the hostile probe and the worktree snapshot are still for.** The probe deliberately supplies absolute paths outside the workspace precisely because the production prompt never does: it measures whether the client honors the boundary when instructed to break it. The core-owned worktree snapshot is defense in depth against exactly that case. Neither implies that a production review reads product files, and documentation must not present them as evidence that it does.
- **Fresh session.** One process, one workspace, one `execution_id` per attempt, no session-resumption flag, and no adapter state reused between attempts.
- **Timeout and cancellation.** A fixed 900,000 ms limit, not configurable in this slice. On expiry or `cancel`, send `SIGTERM`, then `SIGKILL` after 5,000 ms. Expiry raises `AdapterTimeoutError`, hence `failed / adapter_timeout`.
- **Result extraction.** Stdout is capped at 4 MiB; beyond that the attempt is `adapter_error`. Parse stdout as JSON; if the parsed value is an object with a string `result` field, use that string, otherwise use the raw stdout text. From that string take the last fenced ```json block, or the whole string when it parses as JSON directly, and pass the parsed value to the existing `validateReviewResult`. Any other shape is `result_schema_invalid`.
- **Review record.** `.spartan-bridge/runs/<run-id>/reviews/<execution_id>.json` holds only the validated result object, written atomically at mode `0600`. Raw provider output is never persisted; failures record only an exit code and a reason code.

### Task-artifact write

- **Write trigger.** A task write is attempted only when all of: the grant is authorized, `verify` and both comparisons passed, the result validated, and the verdict is `pass` or `changes_requested`. `human_required` and `blocked` record `task_write_state: skipped_human_gate` and stop for the human.
- **Document scanning.** Scanning starts after the frontmatter terminator. A line matching `^(`{3,}|~{3,})` opens a fenced block, closed by the first later line of at least as many of the same character; lines inside a fence are never headings or markers. The `## Review` heading must match `^## Review$` exactly — no trailing whitespace, no closing hashes, no suffix such as `## Review notes`. The section ends at the next unfenced line matching `^#{1,2} ` or at end of file. Exactly one such heading must exist; zero or more than one is a rejection.
- **Owned region grammar.** Inside that section, the region is delimited by lines matching exactly `^<!-- spartan-bridge:review:begin -->$` and `^<!-- spartan-bridge:review:end -->$` on unfenced lines. When no region exists, it is inserted after the heading line and one blank line, with the pre-existing body preserved after one blank line below it. When exactly one well-formed region exists, its interior is replaced in full. Unbalanced markers, more than one region, or any marker line found outside that section is a rejection.
- **Region content.** In order: `Verdict: APPROVE` or `Verdict: CHANGES`; a blank line; `Findings:`; a blank line; either `- None recorded.` or one bullet per finding rendered as ``- `<id>` (<severity>): <message>``; a blank line; one `Bridge run:` line carrying `run_id`, `execution_id`, `review_kind`, Bridge verdict, reason code, canonical host, launcher identifier, policy digest, reviewed task hash, `AGENTS.md` hash, and an RFC 3339 UTC timestamp. That line is the transition metadata; no other section is touched.
- **Verdict mapping.** `pass -> APPROVE`, `changes_requested -> CHANGES`. `human_required` and `blocked` are never written, so no mapping exists for them; the Bridge verdict stays visible in `status.json` and in the persisted review record.
- **Sanitizing.** Every Unicode line separator and control character in a summary or finding message collapses to a single space. A summary or message containing `<!--`, `-->`, or `spartan-bridge:` is a rejection rather than an escaped write. The rendered region is capped at 16 KiB; beyond that it is a rejection.
- **Write mechanism.** Re-read the target, require its SHA-256 to equal the reviewed task hash, splice the new content in memory, write a temporary file in the same directory with the target's existing mode, and rename over the target. Then re-read and verify that the bytes outside the region are byte-identical to the original and that the frontmatter block is unchanged; on any mismatch, restore the original bytes and reject. The rename is the atomic step; a concurrent external writer between the hash check and the rename remains an accepted residual risk, documented rather than solved with locks.

### State, serialization, and exit codes

- **New reason codes.** `reviewer_isolation_unavailable` (`failed`), `adapter_timeout` (`failed`), `reviewer_write_detected` (`blocked`), `task_artifact_write_rejected` (`human_required`).
- **New event type.** `task_artifact_written`, emitted only after a verified successful write, between `review_result_accepted` and `run_terminal`.
- **New fields and key order.** `status.json`: `schema_version`, `run_id`, `state`, `review_kind`, `task_path`, `policy_digest`, `artifact_hashes`, `execution_id`, `verdict`, `reason_code`, `task_write_state`, `task_hash_after_write`, `created_at`, `updated_at`. Each event: `schema_version`, `sequence`, `timestamp`, `run_id`, `type`, `state`, `policy_digest`, `artifact_hashes`, `execution_id`, `verdict`, `reason_code`, `task_write_state`, `task_hash_after_write`. `task_write_state` is `not_authorized`, `skipped_human_gate`, `written`, `rejected`, or `null` before the write decision; `task_hash_after_write` is a `sha256:` string only after a successful write and `null` otherwise. `artifact_hashes.task` always keeps the reviewed hash. Both new fields are `null` on every Phase-1A row and on every event up to and including `review_result_accepted`.
- **Extended matrix.** The Phase-1A matrix stands with both new fields `null` throughout. `R`, `P`, `S`, `A`, `X` keep their Phase-1A meanings; `W` is `task_artifact_written`.

  | Case | Terminal state | Events | Final reason code | `task_write_state` | Exit |
  | --- | --- | --- | --- | --- | --- |
  | `reviewer_isolation_unavailable` | `failed` | R, P, X | `reviewer_isolation_unavailable` | `null` | 1 |
  | `adapter_timeout` | `failed` | R, P, S, X | `adapter_timeout` | `null` | 1 |
  | `reviewer_write_detected` | `blocked` | R, P, S, X | `reviewer_write_detected` | `null` | 1 |
  | Accepted `pass` or `changes_requested`, grant present, write accepted | `awaiting_implementer` / `changes_requested` | R, P, S, A, W, X | `review_passed` / `review_changes_requested` | `written` | 0 |
  | Accepted `pass` or `changes_requested`, no grant | unchanged | R, P, S, A, X | `review_passed` / `review_changes_requested` | `not_authorized` | 0 |
  | Accepted `human_required` or `blocked` | unchanged | R, P, S, A, X | `review_human_required` / `review_blocked` | `skipped_human_gate` | 0 |
  | Accepted verdict, write rejected | `human_required` | R, P, S, A, X | `task_artifact_write_rejected` | `rejected` | 1 |

- **Per-event field values.** `A` carries the mapped review state, the accepted verdict, the mapped `review_*` reason code, and both new fields `null`. `W` carries the same state, verdict, and reason code as `A`, plus `task_write_state: "written"` and the new task hash. `X` carries the final state and final reason code, which differ from `A` exactly in the write-rejected case, plus the final `task_write_state` and a non-null `task_hash_after_write` only when the state is `written`. The final `status.json` equals the `run_terminal` payload except for its later `updated_at`.
- **Exit codes and MCP.** The Phase-1A rule is unchanged and now pinned explicitly: exit `0` exactly when the final reason code begins with `review_`, otherwise exit `1`. The Exit column of the extended matrix is derived from that rule and never states an exception to it. The four accepted-verdict reason codes `review_passed`, `review_changes_requested`, `review_human_required`, and `review_blocked` therefore all exit `0`, whatever the `task_write_state`, preserving the Phase-1A assertions in `tests/review.test.ts` and the `isError: false` assertion for reviewer-terminal `review_blocked` in `tests/mcp.test.ts`. All four new reason codes (`reviewer_isolation_unavailable`, `adapter_timeout`, `reviewer_write_detected`, `task_artifact_write_rejected`) exit `1`, and because the MCP adapter derives `isError` from `exitCode === 1`, the `review` tool reports `isError: true` for each of them. `task_artifact_write_rejected` therefore exits `1` even though a verdict was accepted, because the final reason code is no longer a `review_*` code; the accepted verdict remains readable in the returned status.
- **CLI output.** `spartan-bridge status` prints the stored `status.json` bytes verbatim, exactly as `events` prints `events.jsonl`, so a stored schema-1 run is never reprinted through the schema-2 serializer. `readStatus` stays available for tests and programmatic use. The MCP `review` tool keeps returning the serialized status of the run it just created, which is always schema 2.
- **Terminality.** Every case above is terminal for one invocation. No retry edge, no cycle edge, and no producer-transition edge is added.

### Verification approach

- **Testing strategy.** The adapter takes an injected process-runner dependency so the default suite never needs the real client; one spawn-level test uses a local Node stub executable to pin argv, `cwd`, and environment. The real client is exercised only in the recorded manual probe and dogfood run. Tests always run in a temporary fixture worktree and never against this repository's live tasks or the user's real registry.
- **Dogfood boundary.** The manual dogfood run targets a fixture task in a temporary worktree. Writing a live `spartan/tasks/` artifact through the runtime requires explicit human authorization in the round that does it, even though `AGENTS.md` grants the capability.
- **Dogfood authorization (HX-010).** The human operator signed the official `cursor-agent` client in outside the Bridge, in their own terminal, and authorized the dogfood run. `DOGFOOD` is **not** waived: it must be met by a recorded execution. The authorization covers exactly one thing — running the real client against a throwaway fixture repository outside this worktree. It does not authorize a live `spartan/tasks/` write through the runtime, a relaxed flag, a widened review surface, or any authentication action by an agent host.

## Work Completed

Planning through HX-005 produced an `APPROVE`d Phase-2A plan. HX-006 shipped the adapter, schema-2 contracts, task-artifact write, snapshots, tests (77), and docs without broadening Out of Scope. Workspace directory mode shipped is `0555` (primary); the `0700` fallback was not taken. HX-007 implementation review recorded `CHANGES`.

HX-008 addressed the four named HX-007 findings without broadening Out of Scope, without authenticating a client, and without a live `spartan/tasks/` write through the runtime:

- `DOC-PROBE`: docs now state what the recorded probe demonstrated (`--help` tokens; review spawn exited 1 with authentication required; no writes because no session started) and what it did not (`--mode plan` / `--sandbox enabled` write prevention; OS-level sandbox). README names artifact-only reviews, residual gaps, and shipped commands only. [historical document omitted] records the probe limit.
- `TEST-ADAPTER-FAIL`: stub cases for non-zero `exitCode` and `stdoutOverflow: true` both yield `failed / adapter_error`.
- `TEST-WS-PROOF`: spawn-level test asserts both copies are mode `0444`. The disjoint-predicate workspace path now mutates the ephemeral `task.md` copy and lets `verify`/`workspaceDiffers` detect it; the live task bytes stay unchanged.
- `TEST-BYTE-OUTSIDE`: the pass-write test asserts byte-identity of the prefix through `## Review` and of the human Review body below the owned region.

`DOGFOOD` is unchanged and still unmet.

HX-009 re-reviewed those four fixes from fresh context, read-only on product files, and recorded `APPROVE`. Three non-blocking observations were raised (see Review); none reopens a HX-007 finding.

HX-010 was a human-operator round that cleared the authentication gate. The human authenticated the official `cursor-agent` client in their own terminal, outside every agent host and outside the Bridge, and then authorized the dogfood run in a temporary fixture worktree rather than waiving the criterion. Recorded state: the client is signed in. This round invoked no authentication, account, or model-listing subcommand, inspected no credential store, and recorded no credential, token, account identifier, or authentication path; the sign-in state is the human's own statement, not an inspection.

HX-011 executed the authorized dogfood against a throwaway fixture repository in the OS temporary directory, not against this repository's live `spartan/tasks/`. No pinned flag was relaxed and the review surface was not widened. The implementer session HOME was the isolated official-client profile, so the first `doctor` saw `registry: unreadable`. `doctor` and `review` were re-invoked with the login HOME and `XDG_CONFIG_HOME` unset so the user-local registry was visible. The registry file was not read. `cursor-agent --help` preflight succeeded (interface available). The review attempt completed in under one second with exit 0; the policy digest matched canonical JSON for `fake-reviewer-v1`, not `cursor-plan-reviewer-v1`. Terminal status: `human_required` / `review_human_required` / verdict `human_required` / `task_write_state: skipped_human_gate`. Events were R, P, S, A, X with no `task_artifact_written`. The fixture task had no owned region. The validated review record had the closed five keys and the production-fake canned shape (verdict `human_required`, one finding). No credential, token, account identifier, auth path, or raw provider output was persisted. The fixture worktree was then removed. `DOGFOOD` remains unmet because the real client was never spawned.

HX-012 was a human-operator round. The pasted prompt carried no identifier; the round accepted the artifact envelope HX-012. The human stated that the user-local registry `personal` Cursor `launcher` identifier is now `cursor-plan-reviewer-v1`. This host did not read the registry file. `spartan-bridge doctor` with the login HOME and `XDG_CONFIG_HOME` unset reported `registry: readable; schema valid` and Cursor interface available. `DOGFOOD` remained unmet until a fixture review's policy digest proved the launcher.

HX-013 accepted matching envelope HX-013 and executed the authorized dogfood. No pinned flag was relaxed and the review surface was not widened. A throwaway fixture repository was created in the OS temporary directory with a closed mini-plan, exact `## Review`, the automatic-review grant, and the `task_artifact_write` grant; it was not a live `spartan/tasks/` write. `doctor` and `review` used the login HOME with `XDG_CONFIG_HOME` unset. The registry file was not read. Policy digest matched independently computed canonical JSON for `cursor-plan-reviewer-v1` with `task_artifact_write_authorized: true` and did not match `fake-reviewer-v1`. The review took 57s (HX-011's fake path was under 1s), so the real client ran. Terminal status: `failed` / `result_schema_invalid` / verdict `null` / `task_write_state: null`. Events were R, P, S, X with no `review_result_accepted` and no `task_artifact_written`. No review record was persisted, which is correct: an invalid result is not written. The fixture task had no owned region and kept its human Review notes. The ephemeral reviewer workspace and the fixture worktree were removed. No credential, token, account identifier, auth path, or raw provider output was persisted. `DOGFOOD` remains unmet: the real launcher ran, but there was no accepted task write.

HX-014 through HX-020 each accepted their matching envelope and re-ran the authorized dogfood once under the same boundary and login-HOME invocation as HX-013. No pinned flag, prompt, schema, or review surface was relaxed. Each used a new throwaway fixture with the same closed mini-plan, exact `## Review`, automatic-review grant, and `task_artifact_write` grant; none was a live `spartan/tasks/` write. The registry file was not read. Policy digest matched independently computed canonical JSON for `cursor-plan-reviewer-v1` with `task_artifact_write_authorized: true` and did not match `fake-reviewer-v1`. Elapsed times were 32s, 58s, 33s, 31s, 28s, 51s, and 39s, so the real client ran each time. Every run terminated `failed` / `adapter_error` / verdict `null` / `task_write_state: null`. Events were R, P, S, X with no `review_result_accepted` and no `task_artifact_written`. No review record was persisted. Fixture tasks kept human Review notes and had no owned region. Ephemeral workspaces and fixture worktrees were removed. No credential, token, account identifier, auth path, or raw provider output was persisted. `DOGFOOD` remained unmet.

HX-021 accepted matching envelope HX-021 and re-ran the authorized dogfood once under the same boundary and login-HOME invocation as HX-013. No pinned flag, prompt, schema, or review surface was relaxed. A new throwaway fixture repository was created in the OS temporary directory with the same closed mini-plan, exact `## Review`, automatic-review grant, and `task_artifact_write` grant; it was not a live `spartan/tasks/` write. `doctor` and `review` used the login HOME with `XDG_CONFIG_HOME` unset. The registry file was not read. Policy digest matched independently computed canonical JSON for `cursor-plan-reviewer-v1` with `task_artifact_write_authorized: true` and did not match `fake-reviewer-v1`. The review took 39s, so the real client ran. Terminal status: `awaiting_implementer` / `review_passed` / verdict `pass` / `task_write_state: written`. Events were R, P, S, A, W, X. One validated review record with the closed five keys, verdict `pass`, and zero findings was persisted. The fixture task received exactly one owned region with `Verdict: APPROVE`, `- None recorded.`, and a `Bridge run:` line carrying `cursor-plan-reviewer-v1` and the matching policy digest; human Review notes survived below the region; fixture frontmatter was unchanged. The ephemeral reviewer workspace and the fixture worktree were removed. No credential, token, account identifier, auth path, or raw provider output was persisted. `DOGFOOD` is met.

Hosts and models actually used: HX-008 Cursor, Composer 2.5, no user-selectable effort, vendor Cursor. HX-009 Claude Code, Opus 5, effort high, vendor Anthropic, client context `personal`. The HX-009 advisory recommended Cursor with Grok 4.6; the human ran Claude Code instead, which preserves reviewer independence from the Cursor-vendor implementer. HX-010 Claude Code, Opus 5, effort high, vendor Anthropic, client context `personal`. HX-011 Cursor, Composer 2.5, no user-selectable effort, vendor Cursor, client context `personal`. HX-012 Cursor, Composer 2.5, no user-selectable effort, vendor Cursor, client context `personal`; the human assigned `human-operator` by completing HX-012 in this chat. HX-013 Cursor, Composer 2.5, no user-selectable effort, vendor Cursor, client context `personal`. HX-014 Cursor, Composer 2.5, no user-selectable effort, vendor Cursor, client context `personal`. HX-015 Cursor, Composer 2.5, no user-selectable effort, vendor Cursor, client context `personal`. HX-016 Cursor, Composer 2.5, no user-selectable effort, vendor Cursor, client context `personal`. HX-017 Cursor, Composer 2.5, no user-selectable effort, vendor Cursor, client context `personal`. HX-018 Cursor, Composer 2.5, no user-selectable effort, vendor Cursor, client context `personal`. HX-019 Cursor, Composer 2.5, no user-selectable effort, vendor Cursor, client context `personal`. HX-020 Cursor, Composer 2.5, no user-selectable effort, vendor Cursor, client context `personal`. HX-021 Cursor, Composer 2.5, no user-selectable effort, vendor Cursor, client context `personal`. `CLAUDE.md` binds Claude Code to `planner`; the human explicitly assigned `reviewer` for HX-009 and `human-operator` for HX-010, which that file permits.

## Evidence

- HX-008 checks: `npm run typecheck` exit 0; `npm run build` exit 0; `npm test` 77 passed, 0 failed.
- HX-009 checks, re-run on the working tree: `npm run typecheck` exit 0; `npm run build` exit 0; `npm test` 77 passed, 0 failed, 0 skipped.
- HX-009 read-only probe of the untested tail path: a scratchpad script outside the repository called `spliceRegion` on a fixture carrying `## Blockers` and `## Next Action` after `## Review`. The region landed inside `## Review`, the human body survived below it, and the trailing sections were byte-identical. The path is correct but unasserted by the suite.
- HX-010 checks, re-run on the working tree: `npm run typecheck` exit 0; `npm run build` exit 0; `npm test` 77 passed, 0 failed, 0 skipped.
- HX-011 checks: `npm run build` exit 0; `npm run typecheck` exit 0; `npm test` 77 passed, 0 failed, 0 skipped.
- HX-011 doctor (login HOME, `XDG_CONFIG_HOME` unset, fixture repo): exit 0; `repo: readable`; `registry: readable; schema valid`; `launcher fake-reviewer-v1: resolved`; `launcher cursor-plan-reviewer-v1: resolved`; fake interface available with `workspace_write:false`; `cursor-plan-reviewer-v1: executable resolved; interface available`. The same command under the isolated session HOME was `registry: unreadable; schema invalid` and was not used for the review.
- HX-011 review: `spartan-bridge review --repo <fixture> --task spartan/tasks/0001-dogfood-fixture.md`; exit 0; elapsed under 1s; stderr empty. Status: `schema_version: 2`, `state: human_required`, `reason_code: review_human_required`, `verdict: human_required`, `task_write_state: skipped_human_gate`, `task_hash_after_write: null`. Policy digest matched `fake-reviewer-v1` with `task_artifact_write_authorized: true` and did not match `cursor-plan-reviewer-v1`. Events: `run_requested`, `policy_resolved`, `review_started`, `review_result_accepted`, `run_terminal` (no `task_artifact_written`). One validated review record with closed keys only. Fixture task unchanged outside any owned region (none present). No live `spartan/tasks/` write through the runtime.
- Repository has no commits yet, so HX-009 reviewed working-tree state rather than a diff.
- HX-012 doctor (login HOME, `XDG_CONFIG_HOME` unset, this repository as `--repo`): exit 0; `repo: readable`; `registry: readable; schema valid`; both catalog launchers resolved; Cursor executable resolved and interface available. Registry file not read.
- HX-013 checks: `npm run typecheck` exit 0; `npm run build` exit 0; `npm test` 77 passed, 0 failed, 0 skipped. No product files were modified.
- HX-013 doctor (login HOME, `XDG_CONFIG_HOME` unset, fixture repo): exit 0; `repo: readable`; `registry: readable; schema valid`; `launcher fake-reviewer-v1: resolved`; `launcher cursor-plan-reviewer-v1: resolved`; fake interface available with `workspace_write:false`; `cursor-plan-reviewer-v1: executable resolved; interface available`. Registry file not read.
- HX-013 review: `spartan-bridge review --repo <fixture> --task spartan/tasks/0001-dogfood-fixture.md`; exit 1; elapsed 57s; stderr empty. Status: `schema_version: 2`, `state: failed`, `reason_code: result_schema_invalid`, `verdict: null`, `task_write_state: null`, `task_hash_after_write: null`. Policy digest `sha256:56929602a6892282ed604b0ec5ad92e0c2f9b07504a5e9252e35a19f423116b9` matched canonical JSON for `cursor-plan-reviewer-v1` with `task_artifact_write_authorized: true` and did not match `fake-reviewer-v1`. Events: `run_requested`, `policy_resolved`, `review_started`, `run_terminal` (no accepted result, no task write, no review record). Fixture task unchanged and without an owned region. Ephemeral workspace count after cleanup: 0. Fixture worktree removed. No live `spartan/tasks/` write through the runtime.
- HX-014 through HX-020 checks: each round `npm run typecheck` exit 0; `npm run build` exit 0; `npm test` 77 passed, 0 failed, 0 skipped. No product files were modified. Each doctor (login HOME, `XDG_CONFIG_HOME` unset, fixture repo) exit 0 with registry readable/schema valid, both catalog launchers resolved, and Cursor executable resolved/interface available. Each review: `spartan-bridge review --repo <fixture> --task spartan/tasks/0001-dogfood-fixture.md`; exit 1; elapsed 32s, 58s, 33s, 31s, 28s, 51s, 39s; stderr empty. Status each time: `schema_version: 2`, `state: failed`, `reason_code: adapter_error`, `verdict: null`, `task_write_state: null`, `task_hash_after_write: null`. Policy digest `sha256:56929602a6892282ed604b0ec5ad92e0c2f9b07504a5e9252e35a19f423116b9` matched canonical JSON for `cursor-plan-reviewer-v1` and did not match `fake-reviewer-v1`. Events: `run_requested`, `policy_resolved`, `review_started`, `run_terminal`. Run files: `status.json`, `events.jsonl` only. Fixture tasks unchanged and without an owned region. Ephemeral workspace count after cleanup: 0. Fixture worktrees removed. No live `spartan/tasks/` write through the runtime.
- HX-021 checks: `npm run typecheck` exit 0; `npm run build` exit 0; `npm test` 77 passed, 0 failed, 0 skipped. No product files were modified.
- HX-021 doctor (login HOME, `XDG_CONFIG_HOME` unset, fixture repo): exit 0; `repo: readable`; `registry: readable; schema valid`; `launcher fake-reviewer-v1: resolved`; `launcher cursor-plan-reviewer-v1: resolved`; fake interface available with `workspace_write:false`; `cursor-plan-reviewer-v1: executable resolved; interface available`. Registry file not read.
- HX-021 review: `spartan-bridge review --repo <fixture> --task spartan/tasks/0001-dogfood-fixture.md`; exit 0; elapsed 39s; stderr empty. Status: `schema_version: 2`, `state: awaiting_implementer`, `reason_code: review_passed`, `verdict: pass`, `task_write_state: written`, `task_hash_after_write` a `sha256:` digest. Policy digest `sha256:56929602a6892282ed604b0ec5ad92e0c2f9b07504a5e9252e35a19f423116b9` matched canonical JSON for `cursor-plan-reviewer-v1` with `task_artifact_write_authorized: true` and did not match `fake-reviewer-v1`. Events: `run_requested`, `policy_resolved`, `review_started`, `review_result_accepted`, `task_artifact_written`, `run_terminal`. Run files: `status.json`, `events.jsonl`, `reviews/`. One validated review record with closed keys only (`schema_version`, `review_kind`, `verdict`, `summary`, `findings`), verdict `pass`, zero findings. Fixture task owned region present with `Verdict: APPROVE` and `- None recorded.`; human Review notes survived below the region; fixture frontmatter unchanged. Ephemeral workspace count after cleanup: 0. Fixture worktree removed. No live `spartan/tasks/` write through the runtime. The record claims no product-file inspection.
- No agent host has authenticated any client. HX-006 probe evidence unchanged. No raw provider stdout or stderr was persisted.

## Review

Verdict: APPROVE (implementation re-review, HX-009). Plan review remains APPROVE (HX-005). The HX-007 verdict of CHANGES is superseded: all four named findings are met.

- `DOC-PROBE` met. `README.md`, `docs/ARCHITECTURE.md`, `docs/AUTHENTICATION-AND-SECURITY.md`, and [historical document omitted] each separate what the recorded probe demonstrated (`--help` tokens; the review spawn exited 1 reporting authentication required; unchanged hashes because no session started) from what it did not (write prevention by `--mode plan` or `--sandbox enabled`, `--trust` granting no write, any OS-level sandbox), name the pinned residual gaps, and state that a Phase-2A review is artifact-only.
- `TEST-ADAPTER-FAIL` met. `src/adapters/cursor.ts` `collect()` maps `stdoutOverflow` and a non-zero exit to `adapter_error`; both cases assert `failed / adapter_error` and exit 1.
- `TEST-WS-PROOF` met. The spawn-level test asserts workspace directory mode `0555` and both copies `0444`; the disjoint-predicate test mutates the ephemeral `task.md` copy, yields `blocked / reviewer_write_detected`, and asserts the live task bytes are unchanged, beside the product-file and live-task cases in the same file.
- `TEST-BYTE-OUTSIDE` met. The pass-write test asserts the prefix through `## Review` and the human Review body below the owned region are byte-identical, on a fixture whose `## Review` already holds human text.

Non-blocking observations, offered as optional hardening rather than required changes:

- `OBS-TAIL-FIXTURE` (info). No fixture places a section after `## Review`, so the tail branch of `preservedOutsideRegion` is never exercised, although the artifact this feature targets carries three sections after it. Verified correct this round by the read-only probe above; a fixture with a trailing section would close the gap.
- `OBS-FAIL-DISCRIM` (info). The non-zero-exit and overflow stubs both emit non-JSON stdout, so the assertions would still pass if the `stdoutOverflow || exitCode !== 0` guard were removed and the unparsable fallback took over. The guard is present and correct; valid-JSON stdout with a non-zero exit would isolate it.
- `OBS-README-PLANNED` (info). `README.md` calls the public surfaces and `doctor` "planned" while its status header states Phase 2A shipped. All named commands are shipped ones, so the acceptance criterion holds; only the wording is stale.

Confirmed closed, not reopened: `MATRIX-EXIT`, `MAP-CLEANUP`, `PROMPT-ROOT`; no review-cycle, implementer-start, or `reviewer.implementation` path; registry schema stays 1; no live `spartan/tasks/` write through the runtime. HX-009 modified no product file.

## Blockers

No blocker remains. `DOGFOOD` is met by the HX-021 fixture run.

## Next Action

None. Phase 2A acceptance criteria are satisfied, required review is `APPROVE`, and the recorded dogfood produced an accepted task write.

## Next Handoff

Non-binding suggestion for a possible new task; this artifact is complete and must not be reopened.

```text
Recommended execution (human decides):
- Host: Claude Code, the `AGENTS.md` binding for `planner`
- Model and effort: Opus 5, effort high (fallback: Cursor with Composer 2.5, no user-selectable effort, if the human explicitly assigns `planner` there)
- Role: planner
- Invocation: `/spartan`, passing the prompt block below as the argument
```

```text
Create a uniquely numbered artifact from `assets/task-template.md` in `spartan/tasks/`, suggested slug `phase-2a-dogfood-docs`. Do not open or update `spartan/tasks/0003-cursor-plan-review-dogfood.md`.

Act as planner. Plan a documentation-only update that records the successful Phase 2A real-client dogfood (launcher `cursor-plan-reviewer-v1`, terminal `awaiting_implementer` / `review_passed` / `task_write_state: written`) and removes the stale claim that a live dogfood review remains blocked on authentication, without weakening the recorded hostile-probe limit on `--mode plan` and `--sandbox enabled`. Success: a closed plan naming the files to change, the exact claims to replace, and what must remain honest.
Run the relevant repository checks and update the new task file.

Return only the next handoff, or a completion notice if no work remains.
```
