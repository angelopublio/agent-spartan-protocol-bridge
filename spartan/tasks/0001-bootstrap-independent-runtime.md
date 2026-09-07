---
protocol: "0.6.1"
id: bootstrap-independent-runtime
created_at: 2026-08-16
status: completed
phase: complete
task_type: implementation
risk: high-impact
current_role: reviewer
next_role: human-operator
updated_at: 2026-08-16
handoff_id: HX-012
next_handoff_id: none
---

# Bootstrap the independent Bridge runtime

> Editorial note (2026-09-07): unused platform names and historical integration-document names were generalized for publication. The historical optional-integrations document refers to the former combined cockpit and Board documentation; its Board material is now in `docs/BOARD.md`. Any example path in this cleanup is a normalized placeholder. Original round outcomes, commands, and technical findings are retained; historical line references are not current navigation targets.

## Objective

Implement **Phase 1A: fake plan-review CLI core**, an independently runnable subset of the broader implementation plan. It resolves exactly one authorized `reviewer.plan` request, executes a deterministic data-only fake reviewer, persists safe local run state, and stops at either requested planner changes or the human implementation gate. It does not implement MCP, a real provider adapter, an automatic loop, or implementation execution.

## Context

The repository is currently design-only. The Bridge is a runtime; `/spbridge` is an optional thin invocation wrapper. The CLI is a first-class interface, and the MCP `stdio` surface is an adapter over the same core.

The intended bootstrap routing is:

| Binding | Host | Client context |
| --- | --- | --- |
| `planner` | Codex | `personal` |
| `reviewer.plan` | Cursor | `personal` |
| `implementer` | Cursor | `personal` |
| `reviewer.implementation` | Cursor | `personal` |

`personal` is an opaque user-defined client-context alias, not a built-in account type. `company`, `hobby`, and arbitrary exact lower-case ASCII aliases matching `[a-z0-9][a-z0-9._-]{0,63}` must behave identically. Matching performs no case folding or Unicode normalization; `default` is reserved for the externally selected fallback. The repository selects only an alias; an uncommitted user-local registry selects a pre-registered official-client launcher. Tokens, cookies, auth files, API keys, account identifiers, and login flows never enter the Bridge.

This task bootstraps the product that will later automate cross-host calls. Its own Codex-to-Cursor transfer remains human-started. Cursor review and Cursor implementation must use separate fresh execution contexts. This arrangement provides context separation but not cross-host independence for implementation review.

Root `AGENTS.md` now binds all four roles to the `personal` client context and narrowly authorizes automatic reviewer rounds with at most 3 cycles. It keeps producer transitions human-gated. Root `CLAUDE.md` points Claude Code to that authoritative policy and records that Claude Code currently has no mapped role.

## Scope

- Add the minimal Node.js 20+ TypeScript ESM package, build, typecheck, and test configuration.
- Expose the one-shot entrypoint `spartan-bridge review --repo <path> --task <repo-relative-contained-path>`. It creates `run-<UUIDv4>`, resolves only `reviewer.plan`, executes one fake attempt, persists the run, prints the terminal status as JSON, and exits. It accepts no `--run` or `--kind`; unknown options are usage errors.
- Expose `spartan-bridge status --repo <path> --run <run-id>`, `spartan-bridge events --repo <path> --run <run-id>`, `spartan-bridge doctor --repo <path>`, and `spartan-bridge --help`. `status` and `events` never create a run; `doctor` and `--help` accept no run ID.
- Return exit code `0` when a schema-valid reviewer verdict reaches any reviewer terminal state, `1` for an operational, policy, integrity, capability, or result-validation failure, and `2` for CLI usage errors that create no run.
- Parse the complete command grammar before touching the filesystem. Missing option values, duplicate options, unknown options, unknown commands, and forbidden `--run` or `--kind` on `review` are exit `2` with no run. A syntactically valid `review` resolves an existing readable directory for `--repo` before creating state; an invalid or unreadable repo root is exit `1` with no run. Once that root is resolved, create the run directory, atomically write `status.json` in `requested`, and append `run_requested` before reading the task, `AGENTS.md`, or registry; every later failure has a run and exits `1`.
- Implement the closed Phase-1A request, review-result, event, status, resolved-policy, and adapter-capability contracts pinned in Decisions. Unknown keys fail validation at every contract boundary.
- Parse one explicit Spartan task plus the constrained root `AGENTS.md` host table, `Client context` column, automatic-review grant, and maximum review-cycle ceiling. This slice executes only one attempt even when the ceiling is higher.
- Recognize only the exact root-policy grammar in Decisions; do not use natural-language inference, another Markdown table, a generic `reviewer` row, or a protocol fallback.
- Resolve only `reviewer.plan` for the current repository policy. Normalize exact host display names `Codex`, `Claude Code`, and `Cursor` to canonical IDs `codex`, `claude`, and `cursor`; reject every other spelling instead of guessing.
- Load the production client-context registry from `$XDG_CONFIG_HOME/spartan-bridge/client-contexts.yaml`, falling back to `$HOME/.config/spartan-bridge/client-contexts.yaml` only when `XDG_CONFIG_HOME` is absent.
- Accept a closed registry schema containing only `schema_version`, `client_contexts`, host keys, and a single `launcher` identifier per host. Reject unknown fields and credential-shaped field names.
- Resolve `client_context + canonical_host` to an opaque launcher identifier, then resolve that identifier through an application-owned `LauncherCatalog`; repository content, task text, and agent output never supply executable paths, arguments, or environment values.
- Register only the built-in `fake-reviewer-v1` launcher in Phase 1A. It is an in-process fake with no executable, argv, official-client process, or authentication behavior. Application composition injects its `FakeResultSource`; it never derives a verdict from repository or task text.
- Run the fake through the same `preflight -> start -> collect -> cancel` adapter interface and read-only capability gate intended for future adapters.
- Give each fake attempt a new `execution_id`, a new adapter instance, and only immutable artifact content plus hashes; do not reuse prompt, result, or mutable adapter state across attempts.
- Validate the fake result against the closed data-only result contract and map its Bridge verdict through the complete transition table in Decisions. Reject unknown keys and any patch, command, path, environment, or task-write payload.
- Limit the state machine to `requested -> policy_resolved -> reviewing -> changes_requested | awaiting_implementer | human_required | blocked | failed`. Every reviewer verdict and pre-review failure maps to one pinned terminal state and reason code; there is no retry edge.
- Treat the Spartan task as read-only. Persist only append-only `events.jsonl` and an atomic `status.json` projection under `.spartan-bridge/runs/<run-id>/`. `policy.json` is deferred. Persist the pinned policy digest, task and `AGENTS.md` hashes, and `execution_id` in status and applicable events.
- Emit the closed event sequence and nullability rules in Decisions for every Phase-1A terminal path.
- Validate a closed Phase-1A Spartan task frontmatter grammar after `run_requested`; task role fields are validation-only and never participate in policy resolution or routing.
- Exercise integration tests in an isolated temporary fixture worktree with an injected in-memory registry and launcher catalog; tests must never route through this repository's live task or user registry.
- Enforce task-path and runtime-path containment for the fixture worktree, including traversal and symlink-escape rejection.
- Keep the application core independent of CLI, MCP, Board, skills, and provider-specific modules.

## Out of Scope

- Real Codex, Claude Code, or Cursor adapters.
- Any real launcher executable, argv execution, official-client subprocess, or authentication preflight.
- Provider login, logout, account discovery, billing detection, or credential handling.
- MCP code, transport, registration, or placeholders.
- `spartan-bridge start`, `stop`, or `resume` commands.
- The broader documented `review --run <run-id>` or `review --kind <kind>` syntax; Phase 1A uses the one-shot task entrypoint only.
- `spartan-bridge/config.yaml`, scoped reviewer fallback, generic two-host or three-host profile support, and protocol-default provider fallback.
- Automatic retry or producer/reviewer loops; Phase 1A performs one fake plan-review attempt per invocation.
- Implementation execution, required-check dispatch, `reviewer.implementation`, and automatic planning-to-implementation dispatch.
- Applying `task_artifact_write`, generating or changing Spartan handoff envelopes, or modifying any Spartan task.
- A standalone `policy.json`, replayable policy snapshot, or another runtime-state file beyond `events.jsonl` and `status.json`.
- Real launcher-catalog configuration, user-defined executable paths, launcher arguments, environment overrides, or provider-specific operational options.
- Worktree writer locks, leases, concurrency coordination, and orphan reconciliation.
- A daemon, background execution, crash recovery, scheduling, or Board control.
- Desktop-tool-specific behavior or worktree management.
- Merge, push, release, publication, or package-registry distribution.
- Copying implementation code from `agent-spartans-workbench` or another repository.

## Constraints

- Use `README.md`, `docs/ARCHITECTURE.md`, `docs/AUTHENTICATION-AND-SECURITY.md`, [historical document omitted], and `docs/DECISIONS.md` as background constraints, but this task's named Phase-1A Scope, Out of Scope, and Decisions are the controlling implementation boundary. Broader roadmap items do not enter this task implicitly.
- All repository documentation and persisted Spartan artifacts are English.
- Use original implementation developed for this project under this repository's MIT license.
- Use direct process argument arrays; never shell interpolation.
- No provider secret may be accepted through configuration, arguments, requests, environment injection, fixtures, state, or logs.
- A repository can select only a registered client-context alias, never a launcher command or credential location.
- A real reviewer binding remains unavailable until a future adapter can technically enforce provider-process isolation. Phase 1A proves only the capability gate and data-flow boundary with a trusted in-process fake; it must not claim OS-level sandbox enforcement.
- The automated fake never receives a writable worktree service and the Bridge does not implement `task_artifact_write` in this slice.
- Runtime state belongs only under the target worktree's ignored `.spartan-bridge/` directory.
- Do not introduce a desktop UI or require Cursor, the Board, or `/spbridge` to run core tests.

## Acceptance Criteria

- [x] A clean checkout can install dependencies and run documented build, typecheck, lint if configured, and test commands.
- [x] `spartan-bridge --help` exposes only `review`, `status`, `events`, and `doctor` without requiring MCP or a skill, and rejects unknown options with exit code `2` before creating a run.
- [x] `review --repo <path> --task <repo-relative-contained-path>` creates one `run-<UUIDv4>`, resolves `reviewer.plan`, executes one fake attempt, persists terminal state, prints terminal `status.json` content as JSON, and accepts neither `--run` nor `--kind`.
- [x] `status` and `events` require `--repo` and `--run` and never create a run; `doctor` requires `--repo` and accepts no run ID.
- [x] Schema-valid verdicts exit `0`; usage errors exit `2`; all other Phase-1A failures exit `1` after persisting a run when one was already created.
- [x] A temporary fixture repository with explicit plan-review authorization can run exactly one fake plan review and obtain each valid `pass`, `changes_requested`, `human_required`, and `blocked` result through injected test result sources.
- [x] The same core operation is callable from code without importing the CLI adapter.
- [x] `personal`, `company`, `hobby`, and one arbitrary valid client-context alias resolve through the same generic code path.
- [x] Client-context matching is exact lower-case ASCII, has no case folding or Unicode normalization, and rejects over-length or malformed aliases.
- [x] The production registry path follows the XDG path and documented home-directory fallback; tests inject an in-memory registry and never read the real user registry.
- [x] The registry parser accepts only `schema_version`, `client_contexts`, canonical host keys, and `launcher`; it rejects unknown keys, missing launchers, and host-incomplete contexts.
- [x] Field names that normalize to or contain `api_key`, `token`, `secret`, `password`, `cookie`, `credential`, `auth`, `auth_file`, `session`, `keychain`, `account`, `email`, `env`, or `environment` are rejected, with representative fixtures for camelCase, snake_case, and hyphenated forms.
- [x] Exact display names map `Codex -> codex`, `Claude Code -> claude`, and `Cursor -> cursor`; case variants, abbreviations, and unknown hosts fail closed.
- [x] Missing context resolves to reserved `default`; unknown contexts and unknown launcher identifiers fail closed with safe errors.
- [x] The application-owned launcher catalog maps `fake-reviewer-v1` to an in-process fake and produces no spawn call. The future real-launcher seam is an immutable `{ executable, args }` specification consumed as `spawn(executable, args, { shell: false, env: sanitizedEnvironment })`, but no real specification is accepted or executed in Phase 1A.
- [x] The fake uses the common adapter lifecycle and is rejected before execution unless it advertises `review_kind: plan`, `permission_mode: read-only`, and no workspace-write capability.
- [x] Production Phase-1A composition binds `fake-reviewer-v1` to a constant data-only `human_required` result stating that no real reviewer adapter exists; tests inject separate constant `pass` and `changes_requested` result sources without reading repository or task text.
- [x] A malicious-result test uses a separate injected adapter that returns an unknown or forbidden field; it is not a mode of the valid built-in fake.
- [x] Two sequential fake attempts receive different `execution_id` values and adapter instances, and the second receives no mutable state from the first.
- [x] The adapter receives immutable artifact content and hashes, not a writable filesystem handle. Closed result validation rejects a malicious test double that returns patch, command, path, environment, or task-write fields.
- [x] Integration tests snapshot all fixture product files and the fixture Spartan task before and after accepted and rejected fake results; hashes remain unchanged. This verifies the Phase-1A data path, not OS sandboxing against arbitrary adapter code.
- [x] Task path traversal, task symlink escapes, runtime-path traversal, and runtime symlink escapes are rejected inside the temporary fixture worktree.
- [x] Run events are append-only, status projection writes are atomic, and artifact or policy hash mismatches are rejected.
- [x] CLI tests prove that syntax failures and invalid repo roots create no run; task, `AGENTS.md`, registry, policy, capability, integrity, adapter, and result failures after a valid repo root emit the pinned `run_requested` and `run_terminal` records and persist the pinned terminal status.
- [x] The closed review-result schema accepts exactly `schema_version`, `review_kind`, `verdict`, `summary`, and `findings`; nested findings accept exactly `id`, `severity`, and `message`. Unknown top-level or nested keys fail before state transition.
- [x] Bridge verdicts are exactly `pass`, `changes_requested`, `human_required`, and `blocked`. Spartan task verdicts such as `APPROVE` and `CHANGES` are rejected runtime values.
- [x] The state machine implements every transition and reason-code mapping pinned in Decisions and treats `changes_requested`, `awaiting_implementer`, `human_required`, `blocked`, and `failed` as terminal for one invocation.
- [x] SHA-256 digests use the pinned byte/canonicalization rules and the `sha256:<64 lowercase hex>` representation. A changed task, `AGENTS.md`, or resolved policy before result acceptance produces `failed / integrity_mismatch`.
- [x] `status.json` contains exactly the pinned fields, including `run_id`, state, policy digest, artifact hashes, and nullable `execution_id`, verdict, and reason code; no `policy.json` is written.
- [x] `events.jsonl` accepts only `run_requested`, `policy_resolved`, `review_started`, `review_result_accepted`, and `run_terminal`, with strictly increasing sequence numbers and the pinned closed event fields.
- [x] Tests cover the exact per-path event sequences, status nullability, terminal state, and reason code for every mapping in Decisions; no event type is emitted speculatively or after `run_terminal`.
- [x] Fixture tests cover the complete post-`run_requested` validation order and matrix in Decisions, including every non-null and null field for each terminal reason code and the distinct no-run unsafe-runtime-root path.
- [x] Task fixtures accept only the closed Phase-1A frontmatter grammar; they reject missing, duplicate, malformed, type-coerced, incompatible, or extra frontmatter fields, while proving that valid `current_role` and `next_role` values do not affect fixed `reviewer.plan` routing.
- [x] All contract schemas use the pinned `schema_version: 1` number and JSON primitive types in Decisions. Tests reject string versions, floating-point or string ceilings and sequences, invalid nullability, and duplicate or unknown keys.
- [x] `AGENTS.md` fixtures prove that only the pinned `## Agent hosts` table and exact automation literals authorize `reviewer.plan`; extra sections are ignored, duplicate or malformed headers or rows fail closed, a generic `reviewer` row is never a fallback, and the explicit manual-every-round conflict suppresses automatic authorization.
- [x] Registry fixtures prove the exact structural schema and field-name normalizer: accepted schema keys remain accepted, sensitive camelCase, snake_case, and hyphenated variants fail with `registry_sensitive_field`, and unrelated substrings such as `author` or `envelope` do not falsely match `auth` or `env`.
- [x] `doctor` reports only registry readability, host/context/launcher resolution, and built-in fake-interface availability; it never claims authentication, account identity, subscription, billing, or real-provider readiness.
- [x] Tests prove no secret-shaped values are persisted or printed in representative failure paths.
- [x] No task file is modified and no production dependency on MCP, the Board, Cursor, a host skill, a provider module, or historical Workbench code exists.
- [x] The task records the exact commands and outcomes used to verify the implementation.
- [x] A fresh reviewer records `APPROVE` before the task can complete.

## Decisions

- This task is the named **Phase 1A: fake plan-review CLI core** subset. Its boundary overrides broader roadmap language for this implementation round.
- Phase 1A executes one `reviewer.plan` attempt and stops. It does not implement review cycles or an implementation-review path.
- The CLI review operation is one-shot: `review --repo <path> --task <repo-relative-contained-path>` creates its own run. Existing-run review, `--kind`, and `start` are deferred.
- `client_context` aliases remain exact lower-case ASCII values. Production registry lookup uses the XDG config path with a home-directory fallback; tests use an injected in-memory source.
- The registry schema is closed and contains no operational-options bag. Repository policy selects an alias only; the user-local registry selects a launcher identifier only.
- Host display names use an explicit allowlist and canonical map rather than generic lowercasing.
- `LauncherCatalog` is application-owned. It converts a known launcher identifier to a typed launcher kind and, only for future real launchers, immutable executable and argument arrays. Agent-controlled text never reaches that catalog.
- `fake-reviewer-v1` is the only Phase-1A launcher. It is trusted, deterministic, in-process, and never spawns an official client. Its purpose is contract testing, not proof of OS sandboxing.
- `FakeResultSource` is an injected application dependency. Production Phase 1A binds a constant `human_required` result; tests bind explicit constant valid results. A malicious result comes from a separate injected test adapter. No result source reads or interprets product or task text.
- Fresh fake context means a new adapter instance and unique `execution_id` with no mutable state reuse. Read-only means immutable data input, a closed result schema, no writer service, and unchanged fixture hashes.
- `task_artifact_write` and handoff generation are deferred. The live task and fixture tasks remain unchanged by runtime execution in this slice.
- Credential-shaped fields are rejected even though the closed schema already rejects unknown fields, providing defense in depth and explicit safe errors.
- Every Phase-1A contract has `schema_version` as the JSON number `1`, never a string. `ReviewRequest` contains exactly `schema_version`, `repo_root`, `task_path`, and `review_kind`; its values are an absolute `repo_root` string, repository-relative `task_path` string, and `review_kind` string exactly `plan`.
- `ReviewResult` contains exactly `schema_version`, `review_kind`, `verdict`, `summary`, and `findings`. `review_kind` and `verdict` are strings; `verdict` is `pass | changes_requested | human_required | blocked`; `summary` is a 1-2000-character string; `findings` is an array of 0-100 objects. Each finding contains exactly `id`, `severity`, and `message`, all strings; `id` matches `[A-Z][A-Z0-9_-]{0,31}`, `severity` is `info | warning | error`, and `message` is 1-2000 characters. `pass` requires zero findings; `changes_requested` requires at least one `warning` or `error` finding.
- `ResolvedPolicy` contains exactly `schema_version`, `review_kind`, canonical `host`, `client_context`, `launcher_id`, `automatic_review_authorized`, `max_review_cycles`, and constant `permission_mode: read-only`. All except `schema_version`, `automatic_review_authorized`, and `max_review_cycles` are strings; `automatic_review_authorized` is boolean `true`; and `max_review_cycles` is an integer JSON number from 1 through 3.
- `AdapterCapabilities` contains exactly `schema_version`, `launcher_id`, `review_kinds`, `permission_modes`, `workspace_write`, and `fresh_context`. `launcher_id` is a string; `review_kinds` and `permission_modes` are non-empty arrays of strings without duplicates; `workspace_write` and `fresh_context` are booleans. Phase 1A requires `plan`, `read-only`, `workspace_write: false`, and `fresh_context: true`.
- The registry is exactly `{ "schema_version": 1, "client_contexts": <object> }`. `client_contexts` maps each valid alias to an object containing exactly the three canonical host keys `codex`, `claude`, and `cursor`; each host value is exactly `{ "launcher": <non-empty string> }`. No host key, alias, or launcher value is coerced. A missing host is `failed / registry_context_incomplete`; malformed structure, types, versions, unknown fields, or duplicate YAML keys are `failed / registry_schema_invalid`.
- Before schema validation, each structural registry mapping key, but never a user-defined client-context alias, is classified. Its ASCII-only spelling is split at camel-case boundaries and `_`/`-`, then lower-cased into tokens; the joined token sequence is also available. Reject with `failed / registry_sensitive_field` when any token exactly equals `token`, `secret`, `password`, `cookie`, `credential`, `auth`, `session`, `keychain`, `account`, `email`, `env`, `environment`, or `authorization`, or when the joined sequence exactly equals `apikey` or `authfile`. Thus `apiKey`, `api_key`, `api-key`, and `authFile` are rejected; `author`, `authority`, and `envelope` are ordinary unknown fields, not sensitive matches, and then fail `registry_schema_invalid`.
- `AGENTS.md` policy recognition is literal and root-only. In the `## Agent hosts` section (from that exact level-2 heading through the next level-1 or level-2 heading), it reads the first Markdown table after zero or more blank lines. Its header cells, after trimming outer whitespace, are exactly `Binding`, `Host`, and `Client context` in that order. It requires exactly one `reviewer.plan` row, rejects duplicate bindings or malformed rows, ignores all other sections and tables, and never falls back to a `reviewer` row. Its host cell must be an allowed exact display name; its client-context cell is either a valid alias or empty, in which case it resolves to `default`.
- Automatic review requires, in the `## Spartan Bridge automation authority` section using the same heading boundary, exactly one list-item whose text after the marker and one following space is `A human-started Spartan Bridge run may start the mapped reviewer automatically.` and exactly one list-item whose text matches `The Bridge may return findings to the current producer and repeat up to <N> review cycles.`, where `<N>` is the base-10 integer `1`, `2`, or `3`. The value supplies `max_review_cycles`; Phase 1A still executes one attempt. The standalone sentence `The human starts every round.` anywhere in the file is an explicit conflict that makes authorization false. Missing grant or conflict is `blocked / automatic_review_not_authorized`; missing table or row is `blocked / reviewer_binding_missing`; unreadable `AGENTS.md` is `failed / agents_unreadable`; malformed required policy grammar is `failed / agents_policy_invalid`.
- The task frontmatter is a closed Phase-1A grammar. The first bytes are `---\n`; the first later line exactly `---` ends a UTF-8 YAML mapping with no duplicate keys, aliases, merge keys, tags, anchors, or type coercion. It contains exactly `protocol`, `id`, `created_at`, `status`, `phase`, `task_type`, `risk`, `current_role`, `next_role`, `updated_at`, `handoff_id`, and `next_handoff_id`; all values are strings. `protocol` is exactly `0.6.1`; `id` matches `[a-z0-9]+(?:-[a-z0-9]+)*` and equals the filename portion after its four-digit prefix; `created_at` and `updated_at` are valid `YYYY-MM-DD` calendar dates; `status` is `active`; `phase` and `task_type` are both `planning`; `risk` is `routine | material | high-impact`; `current_role` and `next_role` are each one of `human-operator | investigator | planner | implementer | reviewer | independent-reviewer | verifier`; and each handoff field is `none` or a canonical `HX-` identifier (`HX-001` through `HX-999`, then unpadded `HX-1000` and above). The body is opaque. Valid role values, handoff values, and task prose are hashed but never read to choose a binding: this CLI always resolves only `reviewer.plan`.
- Phase 1A validates no relationship between the two handoff fields and does not parse a `Next Handoff` body: their individual scalar validity only identifies a current Spartan-shaped task, while task-artifact continuity remains the portable protocol's concern.
- Run IDs are `run-` plus `crypto.randomUUID()` UUIDv4; execution IDs are `exec-` plus a separately generated UUIDv4. Timestamps are RFC 3339 UTC strings.
- Task and `AGENTS.md` artifact hashes are SHA-256 over their exact file bytes. The policy digest is SHA-256 over UTF-8 JSON containing the `ResolvedPolicy` keys in the exact order listed above, with no whitespace and arrays kept in declared order. All digest strings use `sha256:<64 lowercase hex>`.
- `status.json` contains exactly `schema_version`, `run_id`, `state`, `review_kind`, `task_path`, `policy_digest`, `artifact_hashes`, `execution_id`, `verdict`, `reason_code`, `created_at`, and `updated_at`. `schema_version` is number `1`; `run_id`, `state`, `review_kind`, and `task_path` are strings; `policy_digest`, `execution_id`, `verdict`, and `reason_code` are string-or-null; `artifact_hashes` is exactly `{ "task": string-or-null, "agents": string-or-null }`; and timestamps are strings. `policy_digest` is non-null from `policy_resolved`; the task hash is non-null after the task is read, the agents hash after `AGENTS.md` is read, `execution_id` from `review_started`, and verdict/reason code only as pinned below.
- Each event contains exactly `schema_version`, `sequence`, `timestamp`, `run_id`, `type`, `state`, `policy_digest`, `artifact_hashes`, `execution_id`, `verdict`, and `reason_code`. `schema_version` is number `1`; `sequence` is an integer JSON number starting at 1; `timestamp`, `run_id`, `type`, and `state` are strings; the remaining fields use the same types and nullability as status. Allowed types are `run_requested`, `policy_resolved`, `review_started`, `review_result_accepted`, and `run_terminal`. Status is written before its corresponding event; after `run_terminal`, no status or event mutation is permitted.
- Run creation and post-creation validation are ordered and closed. First parse CLI syntax; then resolve `--repo` as an existing readable directory; then resolve the `.spartan-bridge` parent and requested run directory with containment and no symlink traversal. A failure in either runtime path is exit `1` with no run, no status, and no event. Only then create the run, persist `requested` status, and append sequence 1 `run_requested` with every nullable operational field null. The remaining pipeline is: (1) normalize and contain task path, read task bytes, validate frontmatter, and set task hash; (2) read `AGENTS.md`, set agents hash, parse host/policy literals, and resolve host/context authorization; (3) read and validate registry, resolve the exact context and its launcher ID; (4) construct, digest, and persist `ResolvedPolicy`, then append `policy_resolved`; (5) resolve launcher catalog and capability preflight; (6) allocate execution ID, append `review_started`, and collect one result; (7) re-read and compare task, `AGENTS.md`, and resolved-policy digests; (8) validate/map the result, append `review_result_accepted`, and append `run_terminal`. No later stage runs after a prior failure.
- The final `status.json` equals the `run_terminal` payload except for its later `updated_at`; its reason code is always non-null at a terminal state. In the following matrix, `R`, `P`, `S`, `A`, and `X` mean `run_requested`, `policy_resolved`, `review_started`, `review_result_accepted`, and `run_terminal`; `D`, `T`, `G`, `E`, and `V` mean final non-null `policy_digest`, `artifact_hashes.task`, `artifact_hashes.agents`, `execution_id`, and `verdict`; `-` means null.

  | Reason code | Terminal state | Events | D | T | G | E | V |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | `path_invalid` (task path) | `failed` | R, X | - | - | - | - | - |
  | `task_unreadable` | `failed` | R, X | - | - | - | - | - |
  | `task_invalid` | `failed` | R, X | - | T | - | - | - |
  | `agents_unreadable` | `failed` | R, X | - | T | - | - | - |
  | `agents_policy_invalid` | `failed` | R, X | - | T | G | - | - |
  | `automatic_review_not_authorized` | `blocked` | R, X | - | T | G | - | - |
  | `reviewer_binding_missing` | `blocked` | R, X | - | T | G | - | - |
  | `host_invalid` | `blocked` | R, X | - | T | G | - | - |
  | `registry_unavailable` | `blocked` | R, X | - | T | G | - | - |
  | `registry_schema_invalid` | `failed` | R, X | - | T | G | - | - |
  | `registry_sensitive_field` | `failed` | R, X | - | T | G | - | - |
  | `registry_context_incomplete` | `failed` | R, X | - | T | G | - | - |
  | `client_context_unavailable` | `blocked` | R, X | - | T | G | - | - |
  | `launcher_unavailable` | `blocked` | R, P, X | D | T | G | - | - |
  | `capability_denied` | `blocked` | R, P, X | D | T | G | - | - |
  | `integrity_mismatch` | `failed` | R, P, S, X | D | T | G | E | - |
  | `adapter_error` | `failed` | R, P, S, X | D | T | G | E | - |
  | `result_schema_invalid` | `failed` | R, P, S, X | D | T | G | E | - |
  | `review_passed` | `awaiting_implementer` | R, P, S, A, X | D | T | G | E | V |
  | `review_changes_requested` | `changes_requested` | R, P, S, A, X | D | T | G | E | V |
  | `review_human_required` | `human_required` | R, P, S, A, X | D | T | G | E | V |
  | `review_blocked` | `blocked` | R, P, S, A, X | D | T | G | E | V |
- State transitions are closed: successful validation and resolution moves `requested -> policy_resolved`; successful capability preflight moves `policy_resolved -> reviewing`; `pass -> awaiting_implementer / review_passed`; `changes_requested -> changes_requested / review_changes_requested`; `human_required -> human_required / review_human_required`; and reviewer `blocked -> blocked / review_blocked`.
- Pre-review failures are closed: missing automatic-review grant maps to `blocked / automatic_review_not_authorized`; missing `reviewer.plan` maps to `blocked / reviewer_binding_missing`; invalid host maps to `blocked / host_invalid`; missing or unknown context maps to `blocked / client_context_unavailable`; unknown launcher maps to `blocked / launcher_unavailable`; and capability-gate failure maps to `blocked / capability_denied`.
- Integrity and execution failures are closed: a runtime-parent or run-directory containment or symlink failure is exit `1` before run creation; task-path traversal or symlink escape maps to `failed / path_invalid` after `run_requested`; missing or unreadable task maps to `failed / task_unreadable`; malformed task frontmatter maps to `failed / task_invalid` under the closed grammar above; missing or unreadable registry maps to `blocked / registry_unavailable`; registry schema, duplicate-key, or sensitive-key rejection maps as specified above; invalid or malicious result maps to `failed / result_schema_invalid`; task, `AGENTS.md`, or policy digest change before result acceptance maps to `failed / integrity_mismatch`; and adapter lifecycle exceptions map to `failed / adapter_error`. No terminal state has an outgoing retry or producer-loop edge.
- `policy.json` is deferred. `status.json` and applicable events carry the pinned digest values; `status.json` is the atomic current projection and `events.jsonl` remains append-only.
- The broader MCP, provider-adapter, configuration, lock, loop, and Board milestones remain future tasks.

## Work Completed

- Plan review `HX-010` recorded `APPROVE` on the ordered validation pipeline, reason/event/nullability matrix, and closed task-frontmatter grammar.
- Implementer accepted `HX-011` and added the Phase-1A Node.js 20 TypeScript ESM package: `spartan-bridge` CLI (`review`, `status`, `events`, `doctor`), application core callable without the CLI, in-process `fake-reviewer-v1`, closed contracts, and fixture tests for the pinned matrix. No Workbench code was copied. `yaml` 2.x (ISC) is the only runtime dependency.
- Implementation review accepted `HX-012` in this same owner-assigned Cursor session and recorded `APPROVE`. Runtime execution does not modify Spartan tasks or product files.

## Evidence

- `npm install`: added 7 packages, 0 vulnerabilities.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0; emits `dist/cli/main.js`.
- `npm test`: 35 passed, 0 failed.
- Markdown scan after implementation: no accented Portuguese matches; local doc links resolve.
- Production CLI against a temp fixture with `XDG_CONFIG_HOME` overlay: `review` exits 0 with `human_required` / `review_human_required`; `status` and `events` read the same run; `doctor` reports fake-interface availability and does not mention authentication or billing.
- Host/model actually used for plan review, implementation, and implementation review: Cursor, Grok 4.6, effort high. The owner assigned all three Cursor-bound roles to this session.

## Review

Verdict: APPROVE

Findings:

- Plan review (`HX-010`): none remaining; F1/F2 closed.
- Implementation review (`HX-012`): no blocking defects. The CLI/core split, one-shot fake plan-review pipeline, matrix coverage, containment tests, and credential exclusion match the pinned Phase-1A boundary. The same-session implementation review is correlated; the owner overrode fresh-context separation.

## Blockers

None.

## Next Action

None. Phase 1A acceptance criteria are satisfied, checks have recorded outcomes, required reviews are `APPROVE`, and no blocker remains.

## Next Handoff

Non-binding suggestion for a possible new task; this artifact is complete and must not be reopened.

```text
Recommended execution (human decides):
- Host: Codex in client context `personal`, bound planner for the next documented runtime slice
- Model and effort: GPT-5.6 Sol, reasoning effort high
- Role: planner
- Invocation: `$spartan`, passing the prompt block below as the argument
```

```text
Create a uniquely numbered artifact from `assets/task-template.md` in `spartan/tasks/`. Do not open or update `spartan/tasks/0001-bootstrap-independent-runtime.md`.

Act as planner. Plan the next documented Bridge slice: an MCP stdio adapter over the existing Phase-1A fake plan-review core, without real provider adapters or automatic loops. Success: a closed implementable plan with explicit scope, out of scope, and acceptance criteria.
Run the relevant repository checks and update the new task file.

Return only the next handoff, or a completion notice if no work remains.
```
