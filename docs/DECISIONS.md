# Design Decisions

This document records the decisions made before implementation. A later change should add a dated amendment rather than silently rewriting the original rationale.

## D-001: Use `spbridge` as the short skill name

**Decision:** Use `spbridge` for the short skill identifier and `/spbridge` as the expected Claude Code invocation. Use `spartan-bridge` for the executable and MCP server, and `agent-spartan-protocol-bridge` for the public repository.

**Rationale:** `spbridge` is short, pronounceable, and clearly expands to Spartan Protocol Bridge. `sptbridge` does not match the word initials, and `spartanbridge` is less readable.

**Consequence:** A descriptive `/spartan-bridge` alias may be added later, but documentation and examples use `/spbridge`.

## D-002: Keep three canonical roles

**Decision:** Keep `planner`, `reviewer`, and `implementer`. Parameterize review with `review_kind: plan | implementation`.

**Rationale:** Hosts and roles are separate. The same Codex host may review a plan in one profile and implement in another. Adding `planner-reviewer` and `implementer-reviewer` would duplicate the review contract and couple it to workflow positions.

**Consequence:** Host bindings use `reviewer.plan` and `reviewer.implementation`; generic `reviewer` remains a backward-compatible fallback.

## D-003: `AGENTS.md` controls repository routing and automation authority

**Decision:** The consumer repository's root `AGENTS.md` defines host bindings and explicitly grants automatic actions.

**Rationale:** Different repositories need different host mappings, checks, and human gates. Bridge-global provider configuration would silently override repository intent.

**Consequence:** The old sentence `The human starts every round.` denies automatic review. Repositories must replace or qualify it with a narrow grant allowing a human-started Bridge run to start fresh read-only reviewers within a cycle limit.

## D-004: Bridge config may narrow but not broaden authority

**Decision:** Optional `spartan-bridge/config.yaml` stores limits, timeouts, gates, and runtime paths. It does not store secrets and cannot grant an action denied or omitted by `AGENTS.md`.

**Rationale:** Operational controls belong in machine-readable configuration, while repository authority remains visible to every host.

**Consequence:** The most restrictive applicable rule wins. Conflicts fail closed.

**Status (2026-08-30, task 0048):** Only the `transitions.review_plan_pass` opt-in (`successor`, `dispatch`) is parsed. `limits`, `timeouts`, `gates`, and runtime paths remain the original aspiration and are not yet parsed; cycle limits come from `AGENTS.md` (`max_review_cycles`, `max_implementation_review_cycles`). See D-049.

**Amendment (2026-09-01, task 0059):** `transitions.review_plan_pass` may also carry optional `implementer_timeout_ms` (positive integer). It raises only: resolved timeout is `Math.max(BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS, configured)`; values below the Bridge floor are silently clamped, not rejected. Absent key keeps the Bridge default producer timeout. No top-level `timeouts:` block is parsed.

**Amendment (2026-09-04, task 0065):** Optional top-level `producer.model_binding` (`advisory` | `warn` | `strict`). Default `advisory` when the section is absent, the file is absent, or the field is unset. The section, when present, is exactly `{ model_binding: <enum> }`. This toggle governs only human-started `/spbridge` producer rounds; auto-chain producers stay argv-driven. Schema version stays `1`. See D-068.

## D-005: Exclude authentication from the Bridge boundary

**Decision:** The Bridge never authenticates a user or provider and never accepts, receives, reads, copies, selects, stores, logs, proxies, or persists provider credential material. Users authenticate directly in official local clients before starting a run.

**Rationale:** The primary requirement is to use access already provided by official clients without turning the Bridge into a credential broker or provider API client. Credential custody, account selection, and billing information remain entirely with the official client.

**Consequence:** There are no Bridge login commands or account profiles. A real adapter only starts a supported official client. If that client reports that external authentication is required, the run stops. `CURSOR_API_KEY` remains outside the Bridge process and is never a Bridge adapter input.

## D-006: Start with an independent foreground runtime

**Decision:** The MVP is a standalone local runtime with a first-class CLI and an optional MCP `stdio` adapter over the same application core.

**Rationale:** A synchronous reviewer does not need a daemon or a second desktop UI, but it must also not depend on a particular host, skill, or cockpit.

**Consequence:** A user or local automation can invoke the CLI directly. Compatible hosts can call the MCP adapter. A daemon is deferred until unattended dispatch, recovery, and Board control require it.

**Amendment (2026-08-31, task 0055):** the caller's shell is not the chain supervisor. An auto-chaining `review` runs 8-15 minutes, longer than a driving host's command timeout, so `review --detach` reparents the chain (`spawn(detached: true)` + `unref()`, a new session) and `spartan-bridge wait` follows it in bounded slices. Closing the initiating host may leave a detached chain running — that is `setsid`, still not a daemon. Crash recovery is `spartan-bridge resume` (D-054), not a supervised worker. A reparented `review` child does not survive its own crash, reconcile orphans at boot, schedule, or give the Board a control plane; those remain the deferred daemon.

## D-007: Keep the producer transition human-gated initially

**Decision:** Automate producer/reviewer loops, then stop before switching from planning to implementation.

**Rationale:** Reviewer calls are read-only and narrowly bounded. Starting another producer introduces write authority, host lifecycle, and lock-management risks.

**Consequence:** A passing plan enters `awaiting_implementer`. Without both the
repository grant and operational opt-in, the human opens the mapped producer
with the same worktree and run ID.

## D-035: Foreground automatic plan-pass implementation is a bounded successor chain (2026-08-22)

**Decision:** Task `0039` amends D-007 and D-033 for this repository. After a
human-started planner phase and a persisted `reviewer.plan: pass`, the Bridge
may start the mapped `implementer` and then `reviewer.implementation` when
`AGENTS.md` carries the exact automatic-implementation grant set and
`spartan-bridge/config.yaml` opts in `review_plan_pass -> implementer` with
`dispatch: automatic`. The producer interface is disjoint from review
capabilities even on the same launcher id. Implementation review uses an
independent three-cycle budget. The chain is a blocking foreground `review`
invocation with an exclusive writer lock and a separate transition record. It
does not start a daemon, steal a lock, commit, or rewrite the passing
plan-review record. D-007's human gate remains the fallback when config is
absent/manual or producer capability is unavailable. D-033's
human-started `/spbridge` implementer path remains valid.

**Rationale:** The remaining paste after plan pass was the producer-host
transfer. The safety contract already named two independent inputs, an
unchanged approved-plan hash, a lock, and an adapter that enforces
workspace-write. A daemon is still required only for survival, crash recovery,
scheduling, or unattended later phases.

**Consequence:** `review` may return an implementation-review status or a
transition stop document. `/spbridge` waits on that one invocation and
continues `--after-run` only for plan `changes_requested`. MCP `review`
remains a single plan-review tool.

**Amendment (2026-09-07):** D-006's 2026-08-31 amendment and D-054 supersede the daemon requirement in the rationale above. `review --detach` allows an authorized chain to continue after the initiating host closes, `wait` observes it, and `resume` explicitly recovers interrupted state without automatically restarting a crashed agent. Detachment does not guarantee survival of a crash, shutdown, or reboot. Persistent supervision across crashes or reboots, multi-project scheduling, persistent workers, and a Board control API remain future daemon concerns.

## D-036: Producer execution stops carry a closed diagnostic classification, not captured output (2026-08-23)

**Decision:** `TransitionStatusDocument` and `TransitionEventDocument` gain
one additive, nullable `producer_diagnostic` field, originally with six closed
scalar keys: `stage` (`write_scope_lock | spawn | wait | exit_nonzero`),
`exit_code` (integer or null), `timed_out` (boolean), `write_scope_code` (the
existing four `ProducerWriteScopeError` codes or null), `adapter_phase` (an
`ADAPTER_FAILURE_PHASES` value or null), and `adapter_cause` (an
`ADAPTER_FAILURE_CAUSES` value or null). A shared closed constructor,
`buildProducerDiagnostic`, populates it at the exact catch/result boundary
inside `runGuardedRound`, while the write-scope guard is still active, for
the four collapsed `producer_failure` arms (write-scope-lock throw, spawn
throw, wait throw, returned nonzero/null exit) and the existing
`producer_timeout` arm; every other stop, every non-terminal event, and
every successful run keeps it `null`. The diagnostic is only inert returned
data at that point: `finishProducerRound` still releases the write-scope
guard in its own `finally` exactly once, and only after that release
completes does it persist the diagnostic into terminal `status.json` and the
matching `terminal_stop` event, so guard release strictly precedes
diagnostic persistence.
`ProducerWriteScopeFailure`'s value list moves to the shared contracts
layer and is re-exported from `producer-write-scope.ts` unchanged; the four
collapsed reason codes and `producer_timeout` stay exactly as they were.
`schema_version` stays `2`.

**Rationale:** The three `0031` transitions that motivated this task recorded
only the umbrella `producer_failure` reason with no way to tell a
write-scope-lock throw from a spawn failure, a wait failure, or a bad exit.
A closed record that reuses the already-vetted `ProducerWriteScopeError`
codes and `AdapterFailureError`/`AdapterTimeoutError` phase/cause vocabulary
answers that without opening a new free-text channel: it is a Bridge-owned
classification derived only from typed exception fields the runtime already
trusts, never from `error.message`, `error.name`, stdout, stderr, a payload,
or a class name from an unrecognized throw. It is not telemetry, not the
underlying provider error, not an authentication diagnosis, and not proof of
the client-side root cause; it only names which of a fixed set of
orchestration stages the stop happened in.

**Consequence:** Old transition records with no `producer_diagnostic` key
still parse with the field normalized to `null` via `parseTransitionStatusJson`,
and the existing `transition-status`/`transition-events` CLI commands keep
returning stored bytes unchanged (they already read raw bytes rather than
re-serializing). The serializer originally whitelisted those six keys and
rejects or nulls any value outside the closed enums, the integer-or-null
exit domain, or the boolean timeout domain, so an injected extra property or
out-of-domain value can never reach persisted JSON.

**Amendment (2026-09-10):** D-074 extends this record to nine keys. The
additive `waited_ms`, `snapshot_site`, and `snapshot_cap` fields remain closed
and nullable; older records normalize absent snapshot fields to `null`.

## D-037: The Darwin producer sandbox confines the repository, not the machine (2026-08-23)

**Decision:** Task `0041` amends the Darwin `sandbox-exec` profile shipped by
task `0039`. `write_scope` remains a repository admission list. The profile
denies `file-write*` only for paths under the canonical repository root that
are not an admitted filter, denies `file-link` under that root so a
creation-time hard link cannot join an outside inode to an admitted path,
and denies symlink vnode creation only under that root. Official-client operational writes that are not under the root stay on
`(allow default)`. Empty admitted scope still denies every `file-write*`. The
profile still interpolates only `sandboxPathLiteral` results for the
canonical root and admitted paths. POSIX chmod-guard semantics, producer
argv, `childEnvironment`, snapshots, reason codes, and
`producer_diagnostic` stay unchanged.

**Rationale:** Task `0039`'s `SANDBOX_ALLOW_DEFAULT` correction replaced an
`(allow default)` profile with a whole-machine positive-scope deny. That
denied `/dev/null`, `$TMPDIR`, and the inherited `$HOME`, so the official
`cursor-agent` launcher exited 1 before the automatic implementer could
start. Those writes are not repository mutations. The POSIX mode lock and
the repository-scoped `sandbox-exec` deny already cover same-UID writes and
`chmod` of unadmitted repository paths. Official-client profile isolation
remains outside the Bridge.

**Consequence:** A later `/spbridge` plan-pass can start the mapped Cursor
implementer. A path that is not under the canonical root, including a
boundary-prefix sibling of that root, is machine-local. Documentation no
longer claims that every machine-local `file-write*` is denied.

## D-008: Keep desktop cockpits optional from the first release

**Decision:** Treat desktop cockpits and worktree managers as optional interfaces, never as a Bridge runtime dependency.

**Rationale:** The Bridge owns cross-host orchestration independently of the desktop UI used to open a worktree or host conversation.

**Consequence:** The user can run the Bridge directly from its CLI or through a compatible host using MCP. An optional desktop cockpit does not own the runtime lifecycle. The Cursor producer transition is automatic only under D-035's exact grant and operational opt-in; absent either, or when the producer adapter is unavailable, it remains the human-started fallback.

## D-009: Keep the Board as a thin UI

**Decision:** The Board reads Bridge status and Spartan tasks; the Board process does not spawn agent subprocesses.

**Rationale:** Process supervision, permission isolation, locks, recovery, and event state belong in the Bridge runtime. Credential exclusion belongs at its boundary; credentials remain owned by official clients.

**Consequence:** The first integration is read-only status from `events.jsonl` and `status.json`. A later Board control plane delegates to a Bridge daemon through a local authenticated interface.

## D-010: Begin public development cleanly

**Decision:** Do not copy the historical Workbench implementation into this repository yet.

**Rationale:** At the time of that evaluation, the Workbench and its predecessor lacked an explicit license, and the Workbench recorded byte-for-byte migration of some primitives. A new MIT license here cannot retroactively grant rights to that source chain.

**Consequence:** Original Bridge work is MIT. Historical code may be migrated with Git history only after ownership, origin, and licensing are audited and recorded.

## D-011: Mention prior art openly and precisely

**Decision:** Keep factual links to evaluated projects and an independence disclaimer.

**Rationale:** Referencing an integration or architectural influence is not the same as copying protected material. Hiding references reduces transparency without solving licensing obligations.

**Consequence:** Every source is classified in `PROVENANCE.md`. Copied or adapted material triggers its actual MIT, Apache-2.0, or other obligations; reference-only entries do not.

**Amendment (2026-09-07):** The current policy requires classification of incorporated material, declared dependencies, and implemented integrations in `PROVENANCE.md`. A catalog of every evaluated tool is not required. References may be included where useful and must be factual. Any incorporation requires documented origin, permission for the intended use, and compliance with the applicable license and notice obligations. This supersedes the blanket source-catalog requirement above.

## D-012: Keep `spbridge` as an optional thin skill

**Decision:** The `/spbridge` skill is a host-specific invocation wrapper, not the Bridge product or runtime.

**Rationale:** Skills are useful for teaching a host how and when to call a tool, while policy resolution, state, process control, permissions, and audit history require a deterministic application boundary.

**Consequence:** The runtime works without the skill. The skill forwards explicit user intent and identifiers to the installed CLI or MCP adapter; it does not parse authoritative policy, duplicate role contracts, select an account, or own a loop.

## D-013: Route opaque client contexts, not credentials

**Decision:** A host binding may include an arbitrary user-defined `client_context` alias such as `personal`, `company`, `hobby`, or `client-a`.

**Rationale:** Users may keep different already-authenticated official-client contexts for different repositories. The repository needs a stable routing label without learning an account identity or authentication mechanism.

**Consequence:** `AGENTS.md` may select only an exact lower-case ASCII alias matching `[a-z0-9][a-z0-9._-]{0,63}`; no case folding or Unicode normalization occurs. `default` is reserved for the externally selected fallback. A user-local, uncommitted registry maps `client_context + host` to a pre-registered non-secret launcher identifier. The Bridge never receives tokens, auth-file paths, account emails, or credential environment variables. An omitted alias means `default`; an unknown or incomplete alias fails closed.

## D-014: Keep automated reviewers read-only and persist through the runtime

**Decision:** An automated reviewer process never writes the worktree or task artifact. It returns a structured result; the Bridge may apply a schema-constrained update only to the explicitly identified current Spartan task when pinned `AGENTS.md` policy grants `task_artifact_write`.

**Rationale:** Review isolation must be technically enforced, while the portable task artifact must still contain the continuation state. Giving the reviewer general write access would collapse that boundary.

**Consequence:** The Bridge's task write cannot modify product files, repository authority, provider routing, commands, or credentials. In a manual Spartan round outside the runtime, the human may authorize the reviewer host to update only the current task artifact.

## D-015: Admit a task artifact on shape; do not pin the protocol birth-stamp

**Decision:** Validate that `protocol` is a well-formed Semantic Version string. Do not compare it to `PROTOCOL_VERSION`, an accepted set, or a range. `PROTOCOL_VERSION` remains exported for the template stamp and documentation only.

**Rationale:** The portable protocol defines `protocol` as a passive birth-stamp with no runtime behavior. An equality gate is runtime behavior driven by that stamp, and selecting verdict spelling from the stamp would be version negotiation. Existing tasks stamped `0.6.1` and future tasks stamped `1.0.0` must both remain reviewable.

**Consequence:** A malformed or absent stamp still fails closed as `task_invalid`. No code path branches on the birth-stamp value.

## D-016: Declare a model preference in `AGENTS.md`; never enumerate account entitlements

**Decision:** The host-binding table is exactly `Binding | Host | Client context | Model | Effort`. `parseAgentsPolicy` accepts that five-column width only. The declared model identifier must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, and effort must be exactly `low | medium | high | max | none`. The Cursor denylist drops `--model` and adds `about`. A review spawn always passes the declared model; it never omits the flag, retries without it, or substitutes a client default. The adapter reports `observedModel()` from client output only; Cursor returns `null` and records `model_observed=declared_unobserved`. A non-null mismatch is terminal `model_mismatch` and writes no task region. `status.json` carries declared `host`, `client_context`, `model`, and `effort` from `policy_resolved` onward, including `adapter_error`; `model_observed` stays null until compare.

**Rationale:** Independence is a property of model vendors, not host names. The committed table is auditable from the repository. A model identifier names a product, not an account. `--model` states a preference; `--list-models`, `models`, and `about` inspect account entitlements. Reading argv or the review result back as "observed" would record the declaration as observation.

**Consequence:** A three- or four-column table is `agents_policy_invalid`. An unavailable declared model fails as `adapter_error` with the declared values still on the status record. Cursor cannot currently observe the model it ran; that gap is recorded rather than inferred.

## D-017: Transition metadata is two frontmatter fields written with the findings region

**Decision:** After a `reviewer.plan` round that terminates `pass` or `changes_requested`, the Bridge writes exactly two task-artifact frontmatter fields with the owned review region: `next_role` and `updated_at`. `next_role` is `implementer` after `pass` and `planner` after `changes_requested`. There is no third mapping. `current_role` is not written, because `AGENTS.md` forbids the Bridge changing the producer role. Any other review kind, or a current `next_role` that is not `reviewer`, is refused with a named reason and nothing is written. The `## Next Handoff` envelope is left byte-identical.

**Rationale:** `AGENTS.md` already grants `task_artifact_write` for validated findings and transition metadata. Writing `next_role` names who acts next; it does not start a producer or change who produced the round that ran. Writing `current_role` would record a producer change the Bridge must not make. The mapping is plan-review-specific: an implementation-review `pass` means the task is finished, not handed to an implementer, so the write must refuse other review kinds before that adapter exists.

**Consequence:** The post-write check compares source text, never parsed values. Frontmatter key order is unchanged, no key is added or removed, every non-allowlisted key line is byte-identical including comments and whitespace, and the document below the frontmatter is unchanged outside the owned region. The findings region and the two fields are one replace, one check, and one restore path. `status` and `phase` remain unwritten judgements. Reason codes `transition_review_kind_refused` and `transition_next_role_not_reviewer` terminate `human_required` with `task_write_state: rejected`.

### Amendment (2026-08-22, task 0024)

Task `0024` supersedes this decision's plan-only and byte-identical-envelope limits. The matched `task_artifact_write` grant still authorizes only validated reviewer findings and transition metadata. Accepting the consumed identifier, clearing its proposal, and replacing the task-template `Verdict: PENDING` placeholder with the real verdict are mechanical consequences of an accepted `pass` or `changes_requested` write; they do not select or start the next producer. D-033's two review kinds and four transition mappings remain unchanged. The complete four-delta source-text write is recorded in D-034.

## D-018: Adapter failures keep their reason code and gain a status record

**Decision:** Do not add, remove, or remap any `ReasonCode`. `adapter_error` stays the fallback terminal, and `capability_denied` stays the preflight-probe terminal. `StatusDocument` gains a nullable `adapter_failure` record with closed `phase` and `cause` vocabularies, `exit_code`, and a run-directory-relative stderr log pointer. Provider stderr is written to `.spartan-bridge/runs/<run-id>/adapter-stderr.log` (mode `0600`, atomic temp-then-rename, 16 KiB tail after redaction) and never into `status.json` or `events.jsonl`. Redaction reuses `isSensitiveRegistryKey` and also removes Bearer values, `Authorization:` header values, `sk-` tokens, JWT-shaped three-part runs, and home-directory prefixes; it is defence in depth. Every lifecycle-hook throw produces a record, with `cause: "unexpected_error"` when the throw carries none. The two Bridge-owned post-review failures record `runtime_error`. A `capabilitiesAllowed` denial never entered a hook and keeps `adapter_failure: null`.

**Rationale:** The six collapsed `adapter_error` sites and the preflight `capability_denied` path already name the outcome the runtime chose. Splitting reason codes would duplicate a coarser copy of the record, break pinned hook-mapping tests, and teach every consumer a new contract. The 2026-08-18 outage and a broken launcher differ in `phase` and `cause`, not in the terminal code. Task `0017` kept `reviewer_write_detected` and added `reviewer_write` for the same reason.

**Consequence:** `SCHEMA_VERSION` stays `2`. `EventDocument` is unchanged. `spartan-bridge status` and `/spbridge` still report the reason code; the human who needs the client's words opens the log. No retry or backoff is implied by a classified failure.

## D-040: Failed extraction retains a redacted payload log (2026-08-23)

**Decision:** Task `0027` extends D-018. On `output_unparsable`, when the adapter failure carries a non-empty stdout candidate, core redacts that candidate, truncates it to `RETAINED_PAYLOAD_CAP_BYTES` (16 KiB) with marker `[truncated: earlier bytes dropped]`, and writes `.spartan-bridge/runs/<run-id>/adapter-payload.log` at mode `0600`. `AdapterFailureRecord.payload_log` stores only the relative filename. Payload text never enters `status.json`, `events.jsonl`, stdout, or stderr. D-018's stderr retention path is unchanged.

**Rationale:** D-018 documented stderr retention. By omission, readers treated `adapter-stderr.log` as the only provider-byte file a failed run might keep. The live `output_unparsable` case with empty stderr showed the retained payload is the recoverable copy of the reviewer's answer.

**Consequence:** Security and architecture docs name both stderr and payload retention. Adapters that parse stdout reuse shared extraction helpers and the core retention path rather than inventing a blank extractor.

## D-019: Live review progress is Bridge-owned counts and class names, not child text

**Superseded by D-041 (2026-08-23).** The text below is the dated record of task `0019`; it is not the current terminal surface.

**Decision:** When the installed Cursor client advertises `stream-json`, a review spawn uses `--output-format stream-json` and consumes stdout incrementally. Progress on a TTY is composed only of a closed Bridge-owned class list (`working`, `tool`, `result`, `quiet`) plus Bridge-maintained `records` and `tools` counts. The ten-second elapsed line remains as the floor. The Bridge's own stdout status JSON is unchanged. A client whose `--help` output lacks `stream-json` keeps `--output-format json`. `extractReviewPayload` accepts both envelopes. The 4 MiB cap applies to retained bytes (payload plus counters and the incomplete line), not to total bytes observed on the pipe.

**Rationale:** The silent span of a review sits inside one `collect()` wait. Lifecycle phase labels cannot narrate it. A live measurement of one real `stream-json` review showed records arriving throughout the wait (first at 3.4s, last at 133.5s, 1377 records, 224 KiB observed), so the documented transport actually moves during the gap. Child text is untrusted on a TTY: it can carry credentials, paths, and cursor-control bytes. Relaying it, even after redaction, would put provider bytes on a device that acts on them.

**Consequence:** `--stream-partial-output` is not used. No provider-derived substring reaches stderr. MCP callers still pass no `ReviewProgress` sink, so they stay silent. Overflow still terminates as `adapter_error` / `output_overflow` when retained bytes exceed 4 MiB.

## D-041: Review terminal quiet ticker measures silence (2026-08-23)

**Decision:** Task `0030` records the shipped `review` terminal surface after task `0023`. On a TTY: local start time on the header; an aligned local-time column for progress; stream classes `working` / `tool` / `result` / `quiet` with Bridge-owned counts; a ten-second ticker that writes `quiet <n>s` measuring silence since the last activity (same-class counts may refresh on the tick); local end time, terminal state, and duration on the terminal line. The word `quiet` deliberately names both a stream class and the ticker line. One formatter, `formatQuietTickerLine`, owns the ticker bytes. Non-TTY runs omit progress and quiet lines. D-019 is superseded for the terminal-surface claim; its stream-json and no-child-text rules remain in force where not contradicted.

**Rationale:** D-019 still described the pre-`0023` elapsed floor. Keeping two quiet-line writers invited silent drift.

**Consequence:** Decision readers follow D-041 for the terminal surface. Tests exercise `formatQuietTickerLine` / `startElapsedTicker` without a second hand-rolled quiet string.

## D-020: A producer session may continue a plan-review chain by explicit run reference

**Decision:** A review run may be started by a producer round that a previous run returned findings to. The Bridge does not start a producer. `review` gains optional `--after-run <run-id>`. The chain is accepted only when `AGENTS.md` carries the optional producer-chain grant, the referenced status is readable and in-tree, `task_path` matches, `verdict` is `changes_requested`, `artifact_hashes.agents` matches, the current task hash differs from the parent's post-write (or pre-write) task hash, and the parent carries a numeric `review_chain.cycle`. Cycle 1 is the unchained run; a request that would exceed `max_review_cycles` terminates `human_required` / `cycle_limit_reached`. Other chain failures terminate `blocked` / `chain_refused` with a closed `review_chain.refused` cause. `StatusDocument.review_chain` is present from `policy_resolved` onward. MCP `review` stays single-run. `/spbridge` continues only when `reason_code` is `review_changes_requested`, `review_chain.cycle` is not null, and that cycle is less than `max_cycles`.

**Rationale:** The remaining paste was the return leg after findings. Spawning the planner would need a write-capable Claude adapter, host lifecycle, and locks, which D-007 defers. The cycle limit was declared and never compared; an automatic loop without a counted bound is what the authority sentence was written to prevent. The grant copies the optional `task_artifact_write` pattern so repositories without the sentence keep today's unchained behaviour. Reason codes omit the `review_` prefix so `terminate` exits 1, the way other pre-review stops do.

**Consequence:** Two `AGENTS.md` files that differ only by the grant sentence produce different policy digests, including repositories that never adopt the grant, because `producer_chain_authorized` is always serialized. The limit binds an `--after-run` chain, not a caller that repeats unchained `review`. A human may always start a fresh unchained run on the same task.

Amendment, 2026-08-22 (task 0025): "in-tree" is lexical containment inside `.spartan-bridge/runs/`. `review` chain resolution, `status`, and `events` ask that question through one `isRuntimeRunDirContained` predicate and no longer accept a candidate merely because it sits somewhere under the repository root. Task-hash inequality proves only that the current artifact bytes differ from the parent's `task_hash_after_write`, or from `task_hash` when no parent write occurred. It does not prove who wrote the bytes, why they changed, whether a producer session ran, or whether findings were addressed. `next_role: reviewer` plus a coherent regenerated handoff is the producer's assertion of readiness, not semantic proof. The Bridge does not inspect the meaning or authorship of producer edits.

## D-021: Use `codex exec` for the Codex plan-review adapter (2026-08-20)

**Decision:** The Codex plan-review adapter spawns the `codex` executable with the `exec` subcommand. It does not use `codex app-server` or any JSON-RPC transport. Argv is built from constant tables plus the model, effort, schema path, last-message path, and workspace path, with no shell interpolation.

**Rationale:** The Bridge tests every adapter against a stub executable on a temporary PATH. `exec` is argv-in, bytes-out. A faithful app-server fake would have to hold thread ids, turn ids, capability negotiation, and request/response correlation; that cost buys progress the `exec` `--json` stream already provides and a structured result `--output-schema` already returns.

**Consequence:** The app-server becomes worth revisiting when the Bridge needs a mid-run interrupt that is not process termination, or resuming a review thread across runs. Neither is in the current plan.

## D-022: The Codex verdict is the whole `--output-last-message` file, parsed once (2026-08-20)

**Decision:** `collect()` reads the `--output-last-message` file and parses it as one JSON value. That value is returned to the core unjudged. The adapter contains no balanced-span scan, JSON-fence scan, or last-object heuristic. A file that is not JSON ends the run `output_unparsable`. A file that parses but is not the review contract is rejected by `validateReviewResult` as `result_schema_invalid`. There is no prose fallback.

**Rationale:** A schema-constrained `codex exec` run returned a file whose entire contents were one JSON object with exactly the Bridge contract keys. The `--json` stream is not the payload: the same run emitted two `agent_message` records whose text was a complete contract-shaped verdict (`pass` then `changes_requested`). A stream scan would have to choose between them. The last-message file held the later one.

**Consequence:** If the model does not honour the schema, the run fails on a recorded reason code. It never falls back to guessing.

## D-023: Codex adapter I/O stays under the Bridge run directory (2026-08-20)

**Decision:** `AdapterReviewInput` carries `run_dir`. The Codex adapter writes `schema.json` and `last-message.json` under that identified `.spartan-bridge/runs/<run-id>` directory. They are never created inside the reviewed workspace and never in an adapter-owned `os.tmpdir()` directory. The workspace remains a `0555` directory holding `0444` copies of `AGENTS.md` and `task.md`. `--cd` remains the reviewed workspace. Adapter `cleanup()` removes the ephemeral workspace and does not delete the run directory.

Amendment, 2026-08-31 (D-055): spawn `cwd` for the review is the ephemeral workspace root (the `--cd` value), never `os.tmpdir()`, the repository, or the run directory. This matches the Grok, Claude, and Cursor adapters, and lets a machine-local `codex` wrapper resolve the client-context profile from `$PWD` (the workspace holds a byte-identical `AGENTS.md`). The earlier `os.tmpdir()` choice — meant to keep cwd non-writable under `--sandbox read-only` — made such a wrapper resolve the wrong isolated profile and load an unrelated `auth.json`. The workspace is `0555`, outside the git worktree; if the sandbox ever failed open, a write there is caught by `snapshotTree` detection, which `os.tmpdir()` would not have been. Preflight (`codex exec --help`) still runs from `os.tmpdir()`.

**Rationale:** Any change inside the workspace must be the reviewer writing, never the adapter's bookkeeping, or `snapshotTree` write detection stops meaning that. The approved D3 criterion requires those two files under the Bridge-owned run directory. `.spartan-bridge` is already skipped by the core worktree snapshot, so run-local adapter I/O does not look like a product-file write.

**Consequence:** A test that re-reads the workspace after the child exits must find exactly `AGENTS.md` and `task.md`, unchanged, and must also prove the schema and last-message paths resolve under `.spartan-bridge/runs/<run-id>`.

Amendment, 2026-08-20: the first implementation recorded an adapter-owned temp directory because the contract had no run path. That wording is replaced here; the temp-directory choice was an unapproved deviation from D3, not the settled behaviour.

## D-024: Codex stdin ignore stays with the process runner (2026-08-20)

**Decision:** `codex exec` reads stdin when it is open and appends it to the prompt. The child must never have a readable stdin. That guarantee stays in `NodeProcessHandle`, which already spawns every adapter with `stdio: ["ignore", "pipe", "pipe"]`. `SpawnRequest` gains no `stdio` field. The Codex adapter sets none.

**Rationale:** A reviewer round is the one place outside text must not reach the instructions. Making stdio per-caller would make the guarantee optional, which is the opposite of a security invariant.

**Consequence:** A process-runner test spawns a child that reports what it reads on stdin and asserts it reads nothing. The typed `SpawnRequest` surface plus a source-absence assertion prove the Codex adapter cannot override it.

## D-025: Bridge `max` effort is sent to Codex as `xhigh` (2026-08-20)

**Decision:** Effort reaches the child as `--config model_reasoning_effort="<value>"`. Bridge `max` is sent as `xhigh`. Every other `EFFORT_LEVELS` value (`low`, `medium`, `high`, `none`) is sent unchanged. The Bridge does not gain a `minimal` level to reach Codex `minimal`.

**Rationale:** Four values coincide. `max` has no Codex spelling, and `xhigh` is the value above `high`. Refusing `max` at policy time would make a valid `AGENTS.md` fail for a host-specific vocabulary reason, and the Bridge resolves policy before it knows which adapter will run.

**Consequence:** The mapping is recorded here rather than left for a reader to infer from an argv table.

## D-026: The Codex launcher id is `codex-plan-reviewer-v1` (2026-08-20)

**Decision:** Codex adapter capabilities are `{ schema_version: 2, launcher_id: "codex-plan-reviewer-v1", review_kinds: ["plan"], permission_modes: ["read-only"], workspace_write: false, fresh_context: true, observes_model: false }`. Plan review only, read-only only, fresh context.

**Rationale:** Nothing about the Codex path changes what this adapter is allowed to do. The `--json` stream carries no model identifier, so `observedModel()` returns `null` and the declared/observed comparison stays `declared_unobserved`.

**Consequence:** A registry entry names a capability rather than a binary. `capabilitiesAllowed` accepts the object.

## D-027: Codex `preflight` probes every long-form token the review argv sends (2026-08-20)

**Decision:** `preflight` runs `codex exec --help` and requires `--sandbox`, `--cd`, `--config`, `--skip-git-repo-check`, `--ephemeral`, `--output-schema`, `--output-last-message`, `--json`, and `--color` in the probe output. Missing any token is `interface_unrecognized` and starts no review. The review argv uses those same long-form tokens.

**Rationale:** The adapter probes what it sends and sends what was probed. `--color never` is kept because the observed argv carried it.

**Consequence:** A table test removes each of the nine tokens in turn. A second test derives the review argv's long-form tokens from that probed set rather than restating it.

## D-028: Codex stream classes are working or result; tools count `item.started` command executions (2026-08-20)

**Decision:** `classForRecordType` maps `thread.started`, `turn.started`, `item.started`, and `item.completed` to `working`, and `turn.completed` to `result`. None of them is `tool`. `KIND_RE` is unchanged. `ReviewStreamParser` reads `record.item.type` and counts one tool per `item.started` whose item type is `command_execution`, and none for `agent_message`. A record with no `item` object, or an `item` whose `type` is absent or not a string, counts no tool and does not set class to `tool`.

**Rationale:** The Codex stream carries the tool signal one level down. Counting on `item.started` matches the existing Cursor `tool_call` branch: tools begun, counted once. A review killed mid-command still reports the command it was running. An always-zero `tools=` line would read as a reviewer that ran no commands.

**Consequence:** The committed fixture `tests/fixtures/codex-stream-sample.jsonl` is the seven-record sample; replaying it must end at class `result` with `records` equal to 7 and `tools` equal to 1.

## D-029: `doctor` reports Codex launcher facts, not judgement (2026-08-20)

**Decision:** `doctor` reports whether `codex-plan-reviewer-v1` resolves in the catalog and whether the executable interface is available, mirroring the Cursor block. It does not run a review, inspect a session, or say anything about authentication, account, or entitlement.

**Rationale:** `AGENTS.md` forbids `doctor` from checking secret or account facts. Capability flags and executable presence are non-secret integration facts.

**Consequence:** The formatted report gains a `codex-plan-reviewer-v1` line next to the Cursor one. Production registers three launchers: `fake-reviewer-v1`, `cursor-plan-reviewer-v1`, and `codex-plan-reviewer-v1`.

## D-030: Record the Codex read-only probe with what it does not prove (2026-08-20)

**Decision:** `docs/AUTHENTICATION-AND-SECURITY.md` records the 2026-08-20 `codex exec` write refusal with its exact error text, CLI version, platform, and sandbox mode, and states what that observation does not demonstrate. No sentence claims an OS sandbox for any host other than the one observed.

**Rationale:** This repository's honesty convention for the Cursor probe is to state the observation and then its limits. The Codex observation is stronger — a denied write with the operating system's error text — but it is still one platform, one sandbox mode, one CLI version.

**Consequence:** Cursor's unobserved permission mode remains documented as unobserved. Codex's observed refusal is not generalised to Cursor, to another sandbox mode, or to another machine.

## D-031: Refuse a stale build on commands that act; warn on commands that read (2026-08-20)

**Decision:** After `parseArgv`, a stale `dist/` still signals on every CLI kind. `review` and `mcp-stdio` then exit 1 with `STALE_BUILD_MESSAGE` on stderr and no stdout, before a run exists. `status`, `events`, `doctor`, `help`, and `usage` warn and continue. There is no override flag or environment variable.

**Rationale:** Task `0016` D3 chose warning because "The signal warns and continues. Refusing would make the tool unusable exactly while someone is iterating on it, and the harm is silence rather than execution." That premise still holds for the five reader kinds. It no longer holds for `review` and `mcp-stdio`: a stale binary now executes a review without later extraction and retention fixes, so the harm is a wrong action rather than silence. The split keeps `0016` D2: every invocation still signals.

## D-032: Implementation-review workspace assembly is a bounded copy with a closed Git profile (2026-08-21)

**Decision:** Task `0034` ships `src/core/workspace.ts` as a library that prepares the implementation-reviewer workspace. The decoded implementation-review scope is the only file-admission allowlist. Three NUL-delimited plumbing views (`ls-tree -r -z --full-tree HEAD`, `ls-files --stage --sparse -t -z`, and `ls-files --others -z` with no exclude option) enumerate members. Git children receive a constructed environment (`PATH`/`HOME`/`TMPDIR`/`LANG`/`LC_ALL`/`TERM` plus fixed `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_ATTR_NOSYSTEM=1`, `GIT_OPTIONAL_LOCKS=0`, `GIT_NO_REPLACE_OBJECTS=1`, `GIT_NO_LAZY_FETCH=1`) and source children pin `--git-dir`, `--work-tree`, and `core.worktree` to the Bridge canonical root. Current worktree bytes are read once with Darwin `O_NOFOLLOW_ANY|O_NONBLOCK` (or an equivalent no-follow capability). `diff.patch` is produced by hashing two synthetic trees in a sibling isolated object database and running `diff-tree` on those tree OIDs; `changes.txt` is rendered from the complete `(H,I,W)` relation. Reviewer-workspace snapshots skip no directory names and SHA-256 every regular file. The module does not edit adapters or wire into review dispatch.

**Rationale:** `--sandbox read-only` stops writes and does not restrict reads, so the reviewer cannot be given the live repository. The diff alone withholds unchanged neighbours. Until a client flag allowlists reads, a copy whose membership is the declared scope — not tracking, staging, or ignore state — is the workspace that hides nothing in scope and leaks nothing outside it. Plumbing plus a no-follow open answers the five residual `0033` assembly findings at the mechanism: ignore sources never decide membership, filters are never invoked, ancestor symlinks cannot be followed, pathspecs are not required, and `node_modules` / `.spartan-bridge` product paths remain in the workspace snapshot domain.

**Consequence:** Named portability costs are refusal of a path that cannot be represented safely and uniquely on the destination filesystem, refusal on platforms without a proved whole-path no-follow open, and refusal when source object routing depends on parent-injected object directories or any `objects/info/alternates` / `objects/info/http-alternates` entry. Raw worktree bytes may differ from a clean/smudge conversion; showing the actual bytes is intentional. Task `0033` remains the sole caller and keeps adapter wiring, review-kind admission, and the transition map.

**Named costs recorded in** `docs/AUTHENTICATION-AND-SECURITY.md`.

## D-033: Implementation review is a second kind on the same run lifecycle (2026-08-21)

**Decision:** `REVIEW_KINDS` is `["plan", "implementation"]`. The kind is resolved from the admitted artifact state: `(planning, planning)` remains plan review; `(implementation, reviewing)` with `current_role: implementer` and `next_role: reviewer` is implementation review. Codex and the fake adapter declare both kinds in that order; Cursor remains `["plan"]`. A human-started `/spbridge` implementer round may dispatch `reviewer.implementation` under a separate grant sentence and an explicit implementation-review scope. `pass` writes `next_role: human-operator`; `changes_requested` writes `next_role: implementer`. The Bridge never starts an implementer round. Implementation chains resolve the mapped `implementer` binding, record it as `StatusDocument.producer_identity`, and refuse `not_authorized` when a chained continuation would change that producer host. Reviewer-host comparison is unchanged. `PROTOCOL_VERSION` is `"0.7.0"`. `SCHEMA_VERSION` stays `2`. `EventDocument` is unchanged.

**Rationale:** Plan review and implementation review share the run lifecycle, event log, chain, and one-writer constraint. The difference is the binding row, the workspace, and the prompt. Reusing the plan-review grant would have authorized the new transition in every adopting repository without consent. Comparing only the reviewer host would not enforce `AGENTS.md`'s stop before changing the producer host.

**Consequence:** An implementation workspace is the 0034 copy plus `AGENTS.md` and `task.md`. Kind-scoped review region markers replace the unscoped pair on the next plan write; an implementation write leaves a legacy plan region byte-identical and appends its own region. `producer_identity` is `null` on plan runs and `{ role: "implementer", host }` on implementation runs.

## D-038: Cursor honors implementation review when AGENTS.md binds it (2026-08-23)

**Decision:** Task `0042` amends D-033. `cursorCapabilities().review_kinds` is
`["plan", "implementation"]`, the same order Codex and the fake adapter already
declare. Cursor implementation prepare calls the existing
`prepareReviewWorkspace` library with the resolved implementation-review
scope, writes `AGENTS.md` and `task.md` into that workspace, records those
envelope files in the retained `workspace-manifest.json`, and snapshots
with `policy: "workspace"`. Cursor implementation start keeps
`--mode plan --sandbox enabled` and swaps only the prompt to
`CURSOR_IMPLEMENTATION_REVIEW_PROMPT`. Plan prepare remains the two-file
ephemeral copy. A host without an adapter for a bound role still fails
closed; this task does not add a Codex producer or a Claude adapter.

**Rationale:** The owner remounts Agent hosts onto whichever official client
still has token budget. `AGENTS.md` already bound `reviewer.implementation`
to Cursor. Declaring only `["plan"]` made `doctor` and `runReview` refuse
that mapped role as `capability_denied` before any review ran. Adding the
kind without the 0034 workspace would have let a Cursor implementation
reviewer see only the task artifact.

**Consequence:** `spartan-bridge doctor` reports the Cursor
`reviewer.implementation` adapter available when the launcher preflight
succeeds. A foreground `/spbridge` chain may continue from a finished
implementer declaration through Cursor implementation review.

## D-039: Grok is a first-class official-client host (2026-08-23)

**Decision:** Task `0043` adds display host `Grok` → canonical `grok` and
launcher `grok-plan-reviewer-v1`. `CANONICAL_HOSTS` is
`["codex", "claude", "cursor", "grok"]`. The adapter executable is `grok`
only; PATH name `agent` is forbidden because it collides with Cursor Agent
CLI. Review spawns use `--sandbox strict`, `--tools read_file,grep,list_dir`,
`--disallowed-tools Agent`, and `--output-format json`, with plan and
implementation prepare matching Cursor's workspace shapes including
`recordImplementationReviewEnvelope`. Collect unwraps Grok headless
`{text}` envelopes before verdict extraction. Producer spawns use
`--sandbox workspace`, `--always-approve`, and the existing Darwin
`applyProducerWriteScope` guard. Child env is the closed allowlist
`PATH`/`HOME`/`TMPDIR`/`LANG`/`LC_ALL`/`TERM`/`GROK_HOME`. The Bridge never
sets `GROK_HOME` or reads `auth.json`; when the parent already exports
`GROK_HOME`, it is forwarded so the official client can reuse its own store.

**Rationale:** With Cursor, Claude, and Codex unavailable on the owner's
machine, Bridge auto-chain cannot continue unless Grok is a registered host
with both review kinds and an implementer producer. Remounting `AGENTS.md`
before the adapter exists would fail closed at doctor and dispatch.

**Consequence:** A machine-local registry must declare `grok.launcher` on
every client-context alias. After doctor reports the Grok launcher
available, `AGENTS.md` may remount every binding onto Grok. When isolation
relocates `HOME`, make the login-account Bridge registry visible under that
home (symlink) and authenticate Grok under the same home the Bridge child
inherits; do not put those paths in repository files. See
`docs/AUTHENTICATION-AND-SECURITY.md#use-grok-as-an-official-client`.

## D-044: This repository binds every Bridge role to Cursor / composer-2.5 (2026-08-29)

**Decision:** The `## Agent hosts` table binds `planner`, `reviewer.plan`,
`implementer`, and `reviewer.implementation` to `Cursor` with model
`composer-2.5` and effort `none`. The prior all-`Grok` / `grok-4.5` / `high`
binding is retired for dogfood use because the owner's Grok credits are
exhausted and `grok-plan-reviewer-v1` cannot start a session.

**Rationale:** `personal.cursor` resolves to the real `cursor-plan-reviewer-v1`
launcher (doctor: adapter available); `personal.claude` resolves only to the
fake stub. Composer 2.5 exposes no user-selectable effort, so the table records
`none`. All four rows on one host is session isolation only, not cross-vendor
independence — acceptable for this repository's own dogfood chains.

**Consequence:** `tests/agents.test.ts` host/model/effort expectations move to
`cursor` / `composer-2.5` / `none`. The Grok adapter, its tests, D-037/D-042,
and `docs/AUTHENTICATION-AND-SECURITY.md#use-grok-as-an-official-client` are
unchanged; Grok remains a supported host, just not this repository's binding.

## D-045: Forward Cursor's credential-store selector when the parent already sets it (2026-08-30)

**Decision:** The Cursor adapter adds `AGENT_CLI_CREDENTIAL_STORE` to
`CURSOR_ENV_ALLOWLIST` and forwards `parent[key]` only when the parent already
exports it. The value domain is a closed non-secret store-kind selector (`file` |
`keychain`), not a credential. The Bridge never sets, defaults, reads, or
persists it. Because `isSensitiveRegistryKey("AGENT_CLI_CREDENTIAL_STORE")` is
true via the `"credential"` token, `childEnvironment()` consults a Cursor-local
one-element `CURSOR_ENV_SENSITIVE_NAME_EXCEPTIONS` set so this key survives the
sensitive-name filter while every other credential-shaped name is still dropped.
The forwarded value is additionally guarded to the closed selector enum
(`AGENT_CLI_CREDENTIAL_STORE_VALUES = {"file", "keychain"}`): a value outside
that set is dropped, not forwarded, so the "non-secret closed enum" claim is
enforced rather than asserted for a name that trips the credential filter (owner
preference over the plan's original opaque-passthrough form). This removes the
hard dependency on `~/.agent-profiles/bin/wrap-official-client` being first on
`PATH` when the parent already exports the selector and a profile `HOME`.

**Rationale:** Board consumer plan reviews failed with `Authentication required`
when `cursor-agent` spawned without `AGENT_CLI_CREDENTIAL_STORE=file` even
though a file-store login existed under the profile home. The wrapper sets the
selector; reproducing the exact adapter argv through the wrapper returned
`verdict: pass`. `GROK_HOME` already established forward-when-present for a
non-secret client config selector; this applies the same shape to Cursor's store
selector past the credential-shaped name filter.

**Consequence:** `src/adapters/cursor.ts` and `tests/cursor-adapter.test.ts`
gain the allowlist entry, the exception set, and coverage. `docs/AUTHENTICATION-
AND-SECURITY.md` reconciles Cursor's forwarded set with the Grok / `GROK_HOME`
precedent. `isSensitiveRegistryKey`, `SENSITIVE_TOKENS`, and `SENSITIVE_JOINED`
are unchanged; Grok and other adapters are untouched.

The repository owner explicitly ratified, on 2026-08-30, forwarding
`AGENT_CLI_CREDENTIAL_STORE` past the `isSensitiveRegistryKey` sensitive-name
filter: after reviewing what the change can and cannot compromise (precedent for
poking the filter; the value guard; the `GROK_HOME` precedent; the unchanged
authentication boundary), the owner approved it in the conservative
value-guarded form above, in preference to the plan's original opaque
passthrough. The plan-review chain (`run-24a2971a`) had already passed on the
opaque-passthrough form; the owner's ratification narrowed it further.

## D-047: The worktree integrity snapshot skips host-harness state dirs (2026-08-30)

**Decision:** `SKIPPED_DIR_NAMES` in `src/core/snapshot.ts` adds `.claude` and
`.cursor` alongside `.git`, `node_modules`, and `.spartan-bridge`. The
`repository` and `producer` snapshot policies do not descend into them.

**Rationale:** A `/spbridge` run driven from a Claude Code session invoked
`spartan-bridge review` as a child process; the session's own loop management
(`ScheduleWakeup`) wrote `.claude/scheduled_tasks.lock` into the repo worktree
while the implementation review's one-writer `verify()` snapshot was running,
producing a false `reviewer_write_detected` block on task `0045`'s chain. Those
directories are per-project host-harness state, never product, exactly the
category `.spartan-bridge` already occupies. A host driving `/spbridge` should
not need to run from a directory other than the repo root to avoid a false
integrity failure.

**Consequence:** `.gitignore` also broadens `.claude/settings.local.json` to
`.claude/` and adds `.cursor/`. The implementation-review workspace-copy path is
unaffected (it is scoped by the declared review scope, which never lists a
dot-harness dir). Reviewer writes to product paths, the live task, or
`AGENTS.md` are still detected exactly as before.

## D-042: Grok producer does not nest a second seatbelt under Bridge `sandbox-exec` (2026-08-29)

**Decision:** Task `0044`'s automatic implementer successor exposed that D-039's
producer argv `--sandbox workspace` cannot start when the child is already
confined by the Darwin `applyProducerWriteScope` / `sandbox-exec` profile:
Grok reports `sandbox initialization failed: Operation not permitted` and
refuses to start, exiting 1 in about two seconds (`producer_failure` /
`exit_nonzero`). The Grok producer suffix therefore uses `--sandbox none`
instead of `workspace`. Review spawns keep `--sandbox strict` (they are not
wrapped in the producer `sandbox-exec` profile). Repository write confinement
for the producer remains the existing Bridge POSIX mode lock plus the
Bridge-owned `sandbox-exec` profile from D-037; `--always-approve`,
`--output-format json`, `--no-subagents`, and the closed env allowlist are
unchanged.

**Rationale:** Two seatbelt profiles do not compose on this host. Nesting
Grok's `workspace` or `strict` profile inside the Bridge producer profile
fails closed before any implementer turn. Omitting Bridge confinement would
weaken D-037. Passing `--sandbox none` keeps the help/preflight `--sandbox`
token while deferring repository write denial to the Bridge guard that
already admits only the automatic write scope.

**Consequence:** `GROK_PRODUCER_ARGV_SUFFIX` carries `--sandbox none`. A
Grok automatic implementer can start under the existing Darwin producer
guard. D-039's review half is unchanged. Operators must not expect Grok's
own `workspace` profile to apply during Bridge-spawned producer rounds.

## D-043: Cursor Agent CLI has no schema-constrained final-message path (2026-08-29)

**Decision:** Task `0044` records that Cursor Agent CLI, as probed on version
`2026.08.11-e8db854` via `cursor-agent --help`, has no schema-constrained
final-message path equivalent to Codex `--output-schema` +
`--output-last-message` (D-021, D-022). Help lists `--output-format` values
`text | json | stream-json` and `--stream-partial-output`; it does not list
`--output-schema`, `--output-last-message`, response-format, or any other
flag that forces the assistant answer to conform to a Bridge-supplied JSON
Schema. `--output-format json` and `--output-format stream-json` alone are
not schema-equivalent: they shape the CLI transport envelope, not the
assistant's final message content that `collect` treats as the review
payload. The Bridge therefore keeps fail-closed `output_unparsable` when
extraction finds no verdict-shaped JSON. No prose-to-verdict fallback and no
retry/backoff on `output_unparsable` are added. Cursor review argv,
`CURSOR_*` launch prefixes, extractor precedence, ReasonCode names, Codex /
Claude / Grok adapters, review prompt wording, and the Spartan portable
`task-template.md` stay unchanged on this branch.

**Rationale:** Consumer board plan reviews terminated `adapter_error` /
`output_unparsable` with exit 0, empty stderr, and `adapter-payload.log`
holding only assistant prose that named a verdict without a JSON object.
Inventing a Cursor `--output-schema` flag the CLI does not expose, or
parsing prose into verdicts, would weaken the fail-closed collect contract
task `0021` and D-022 already refuse for Codex.

**Consequence:** Operators treat Cursor constrained-output absence as a
dated Bridge decision, not an undocumented gap. A future CLI release that
grows a D2-equivalent help surface may reopen the contingent adapter wiring
path; until then, `cursor-plan-reviewer-v1` continues to rely on extraction
when JSON is present and on `output_unparsable` when it is not.

## D-046: A real Claude Code reviewer, and no reviewer the CLI cannot schema-constrain (2026-08-30)

**Decision:** Task `0047` adds `src/adapters/claude.ts`
(`claude-plan-reviewer-v1`), a read-only reviewer that spawns
`claude -p --output-format stream-json --verbose --json-schema <inline>
--permission-mode plan` so the verdict object is CLI-forced and the review
streams the same live progress as the Codex and Cursor adapters, the same guarantee Codex gives via
`--output-schema` (D-021). `claude --help` on 2026-08-30 exposes
`--json-schema <schema>` (inline JSON, not a file path). `personal.claude`
in the machine-local registry moves off `fake-reviewer-v1` to the real
launcher.

`AdapterCapabilities` gains `structured_output: boolean`. `review.ts`
terminates `blocked` / `reviewer_output_unconstrained` before preflight when
the resolved reviewer adapter reports `false` — today only Cursor, per D-043.
Codex, Grok, Claude, and the fake stub report `true`. The check is a
capability, not a host-name test: a future `cursor-agent --json-schema` flips
one boolean.

The Grok adapter now passes its own `--json-schema` (inline; `grok --help`
example confirms the shape), which the CLI supported but the adapter was not
using — closing the same `output_unparsable` exposure D-043 documents for
Cursor.

`CLAUDE_ENV_ALLOWLIST` forwards `CLAUDE_CONFIG_DIR` and `USER` when the parent
already sets them (isolated-profile config dir; macOS keychain account name a
Bridge-spawned `claude -p` needs or it reports "Not logged in"). The Bridge
never originates either. Mirrors `GROK_HOME`.

**Rationale:** The `output_unparsable` failure mode (D-043) blocked real work —
the plan review of task `0045` failed it three times with Cursor / composer-2.5,
and `0044`'s motivating incidents were Cursor / grok-medium-fast and
grok-high-fast. Claude Code is a first-class routing host the owner already
pays for; a `--json-schema` adapter makes it a reliable reviewer with no new
credential. Refusing an unconstrained reviewer at dispatch stops a run from
paying for a review whose output cannot be trusted to parse.

**Consequence:** `AGENTS.md` states the reviewer-eligibility rule and this
repository binds `reviewer.plan` and `reviewer.implementation` to Claude Code /
`claude-sonnet-5`; `planner` and `implementer` stay Cursor / composer-2.5
(producers are not structured authority). `ClaudeAdapter` is reviewer-only
(`implements Adapter`, not `ProducerAdapter`). D-044's all-Cursor binding is
superseded for the two reviewer rows. `shared src/adapters/review-schema.ts`
holds the one verdict schema; `codexOutputSchema` delegates to it. A Claude
Code **producer** adapter is out of scope.

## D-034: An accepted review consumes its proposal with four source-text deltas (2026-08-22)

**Decision:** After a `plan` or `implementation` review that terminates `pass` or `changes_requested`, one in-memory composition writes at most four deltas, then one verification and one restore path commit them:

1. exactly one changed or inserted Bridge region of the dispatched review kind;
2. `next_role` and `updated_at` set to the existing D-033 mapping, plus either the exact identifier pair move (`next_handoff_id` value becomes `handoff_id`, `next_handoff_id` becomes `none`) when the source `next_handoff_id` is an outstanding canonical `HX-NNN`, or byte-identical identifier source lines when that before-value is `none`;
3. either the exact `## Next Handoff` retraction to the fixed consumed-notice section when an outstanding proposal exists, or byte-identical handoff-section text when it does not;
4. either the exact task-template `Verdict: PENDING` final-segment removal through the preserved next heading, or byte-identical human review text.

`TASK_WRITE_FRONTMATTER_KEYS` is `["next_role", "updated_at", "handoff_id", "next_handoff_id"]`. Conditional deltas are omitted, not approximated, when their before-shape is absent. Everything else stays byte-identical, including the other review kind's region and every other human-written segment. `human_required` and `blocked` write nothing. Ambiguous placeholder, review-region, or handoff-section shapes refuse with `task_artifact_write_rejected` and restore the original bytes. The grant literal is unchanged.

**Rationale:** D-017 left the envelope byte-identical while changing `next_role`, so an accepted review still proposed the reviewer it had consumed. The template `Verdict: PENDING` block surviving beside a Bridge-owned verdict gave `## Review` two answers. Retraction is a mechanical consequence of accepting the verdict, not a successor-envelope authoring step and not a widening of `task_artifact_write`.

**Consequence:** A later producer issues the next identifier after the consumed high-water mark and cannot reuse it. Direct human-started reviews of artifacts with `next_handoff_id: none` remain valid. D-033's transition mappings are unchanged.

## D-048: Refuse an unwritable artifact before the reviewer runs, and name the failure class (2026-08-30)

**Decision:** Task `0046` makes four additions, none of which loosen an existing
recogniser:

1. **Named causes.** `src/core/task-write.ts` replaces the single opaque
   `WRITE_REJECTED` constant with `writeRejected(cause)`, where `cause` is one
   value of the closed, non-secret `TaskWriteRejectionCause` enum
   (`artifact_unreadable`, `artifact_hash_stale`, `frontmatter_unparseable`,
   `verdict_not_persistable`, `review_region_unrenderable`, `timestamp_invalid`,
   `composition_failed`, `atomic_write_failed`, `post_write_unreadable`,
   `post_write_reparse_failed`, `authorized_bytes_changed`). Each current return
   site maps to exactly one class; sites in a class share the value. The cause
   reaches `status.json` and `events.jsonl` as `task_write_rejection_cause`
   beside `task_write_state: rejected`, and stands alone on a pre-dispatch
   `task_artifact_write_rejected` refusal (whose `task_write_state` stays null).
   It is a closed enum value only — never artifact bytes, a path, a line, a
   handoff id, or reviewer prose — following the `0040` producer-diagnostic
   discipline.

2. **Pre-dispatch shape gate.** `checkArtifactWriteShape(text, reviewKind)` in
   `task-write.ts` holds the verdict-independent predicates that gate D-034
   deltas 3 and 4 (the `## Next Handoff` is retractable for the outstanding id;
   the `## Review` section is a recognised placeholder-or-region shape).
   `src/core/review.ts` calls it under the `task_artifact_write` grant, after
   the `0029` `next_role` check and before `deps.catalog.resolve` constructs the
   adapter; `composeTaskArtifactWrite` calls the same function first, so the two
   paths cannot drift. A pre-dispatch failure terminates `human_required` /
   `task_artifact_write_rejected` with cause `composition_failed`, creates no
   `reviews/` entry, spends no cycle, and writes no `task_write_state`. This is
   the class the board `0022` (unfenced advisory) and `0044` (full template
   placeholder prose) incidents hit.

3. **Retained verdict (defence in depth).** When a post-write rejection still
   occurs after a real reviewer ran, `review.ts` writes the accepted verdict to
   `<run-dir>/review-verdict.json` (mode 0600, atomic, gitignored with the run
   directory) and records the pointer as `review_verdict_log` on the status
   document — the same shape `adapter-payload.log` has for `output_unparsable`.

4. **Early reviewer-eligibility surfacing.** `agent-skill/skills/spbridge/SKILL.md`
   runs `spartan-bridge doctor` before the producer round and, when the binding
   line for the dispatched review kind reports
   `reviewer_output_unconstrained`, stops before any producer work with an
   `AGENTS.md` rebind message (to Codex, Grok, or Claude Code). The CLI writes
   one stderr line naming the review kind and the same rebind when `review`
   terminates `blocked` / `reviewer_output_unconstrained`; no other terminal
   reason gains a message. Neither changes the runtime refusal `0047` ships.

5. **Capability/help-token invariant.** One test asserts, for every registered
   non-fake adapter, that `capabilities().structured_output === true` iff its
   `*_HELP_TOKENS` list carries a known schema flag (`--json-schema` /
   `--output-schema`). Cursor (`false`, no flag) and Codex / Grok / Claude
   (`true`, flag present) satisfy it today; a mis-declaring new adapter fails.

**Rationale:** The board `0022` incident paid for a full 1m33s implementation
review, accepted the verdict, then discarded it because the artifact's
`## Next Handoff` advisory was unfenced — a shape knowable when the run first
hashed the artifact. `0044` was the same failure on `## Review`. Diagnosing
`0022` required reading `task-write.ts` because the one opaque constant returned
from ten sites carried no discriminator. `0029` moved only the `next_role`
precondition early and explicitly scoped out the rest.

**Consequence:** `StatusDocument` and `EventDocument` gain
`task_write_rejection_cause`; `StatusDocument` also gains `review_verdict_log`.
A well-formed artifact produces exactly what it does today. The pre-check and
post-write path share one function pinned by a test. Relaxing any recogniser,
auto-repairing a malformed artifact, and a standalone `spartan-bridge lint`
subcommand are out of scope.

## D-049: `spartan-bridge/config.yaml` docs describe only the parsed shape (2026-08-30)

**Decision:** Task `0048`. `src/policy/bridge-config.ts` accepts exactly
`schema_version: 1` plus `transitions.review_plan_pass.{successor, dispatch}`;
its one consumer, `src/core/transition.ts` (`continueAfterPlanReview`), reads
only `config.dispatch`. The `limits`, `timeouts`, `gates`, and
`storage` / `run_directory` keys promised by D-004 and by four prose sites
(`README.md` Configuration principles, `docs/ROUTING-AND-WORKFLOWS.md` source
table, `docs/ARCHITECTURE.md` resolver list, D-004 itself) have no parser and no
consumer. Those four sites are edited to describe only the parsed opt-in and to
mark the rest planned. No `src/` change: nothing new is parsed.

**Amendment (2026-09-04, task 0065):** The parser also admits optional top-level
`producer.model_binding` (`advisory` | `warn` | `strict`) on schema version `1`.
`host:`, `timeouts:`, and every other sibling remain `config_invalid`. See D-068.

**Rationale:** The strict allowlist parser is a security property (it rejects
unknown keys, anchors, aliases, merge keys, and sensitive key names). Widening
it for a key with no caller adds attack surface for no benefit. Cycle limits
already come from `AGENTS.md`; no per-repo limit was requested. A doc that
promises a config shape the parser rejects with `config_invalid` is worse than
one that says "planned".

**Consequence:** Copying a documented `config.yaml` example now yields an
accepted config. Implementing any planned key is a future task that must add a
consumer and a test and preserve the strict-allowlist posture. The plan hit the
3-cycle plan-review limit on artifact-authoring findings (advisory host binding,
envelope role tension, unverifiable paths) with the documentation-only decision
never challenged; the owner overrode to implementation.

## D-050: Path-verification rule is `AGENTS.md`-only in the authoring contract (2026-08-30)

**Decision:** Task `0050`. Commit `b535dbb` added the path-verification bullet to
`AGENTS.md` `## Artifact authoring` as the section's fourth bullet, breaking the
six-shared-plus-one contract enforced by `tests/agents.test.ts`: the first six
bullets no longer matched task `0022`'s fenced copy, and the section grew to
eight bullets so the seven-bullet terminator pattern failed. The bullet is moved
after the six shared rules and the existing `AGENTS.md`-only role/envelope rule,
wording unchanged. It is **shared in content** — any repository benefits from
the discipline — but **local in the test contract**: it is not mirrored into task
`0022`'s copy, and a future task must not treat its absence there as a missing
sync.

**Rationale:** Making it a seventh *shared* rule would require reopening task
`0022`'s fenced copy and the prose that names the six-rule count. Keeping it
`AGENTS.md`-only touches one file and no completed task, the same mechanical
cost argument that placed the role/envelope rule.

**Consequence:** `ARTIFACT_AUTHORING_SIX` still asserts copy-identity for the
six shared rules; the eight-bullet pattern and `ARTIFACT_AUTHORING_PATH_RULE`
assert the path rule appears once in `AGENTS.md` and nowhere in task `0022`, the
fixture, `README.md`, the skill, or `docs/ROUTING-AND-WORKFLOWS.md`. Downstream
repos copy the rule from `AGENTS.md` like the role/envelope rule.

## D-051: `.venv` / `venv` join `SKIPPED_DIR_NAMES`; the symlink walk stays tree-wide (2026-08-30)

**Decision:** Task `0049`. The producer write-scope symlink check
(`rejectProducerVisibleSymlinks` and `lockTree` in
`src/adapters/producer-write-scope.ts`) keeps its **tree-wide** rule: every
producer-visible symlink fails closed before the lock, except one nested under a
`SKIPPED_DIR_NAMES` tree. `SKIPPED_DIR_NAMES` (`src/core/snapshot.ts`) gains
`.venv` and `venv`.

**Rationale:** the tree-wide throw blocked the plan-pass -> implementer
auto-chain on every Python consumer repo (board `0023`: `producer_failure` /
`write_scope_lock` / `write_scope_code=symlink` on `.venv/bin/python`). The
first attempt at this task (commit `b0545cb`, reverted) instead scoped the
rejection to `pathRemainsWritable` plus ancestor-of-scope plus skipped-root. A
security review (external, with a live Darwin `sandbox-exec` proof) found that
wrong: the Darwin profile matches the **post-resolution** path, so a leftover
link with an in-repo name (`build/out -> /tmp/x`, `-> $HOME`) becomes
follow-writable — the tree-wide throw was the only layer refusing to start on
such a link, and the hard-link analogy does not hold (a hard link is still a
path under the root; a symlink resolves off it). The correct distinction between
`build/out` and `.venv/bin/python*` is the **name**, not any structural
predicate: a normal venv link is an absolute path to a system interpreter, so
"reject absolute / lexically-escaping targets" also re-blocks Python. Gitignore
is not a security oracle and would put `git` on a fail-closed path. `.venv` /
`venv` are already "never product," rebuildable, and would blow the producer
snapshot caps like `node_modules`; the existing `SKIPPED_DIR_NAMES` set is where
they belong, not a second list. Alternatives `.tox` / `.nox` / `.direnv` are
added only when a real repo blocks, as a dated decision.

**Consequence:** `build/`, `dist/`, and every other non-skipped directory again
fail closed on a leftover symlink. A link **nested inside** a `SKIPPED_DIR_NAMES`
tree whose target resolves off the repository root is follow-writable — the same
residual already accepted for `node_modules`, now also for `.venv` / `venv`,
documented in `docs/AUTHENTICATION-AND-SECURITY.md`. Direct writes to `$HOME` /
`$TMPDIR` stay allowed so the official client can start. Closing the leftover-alias
class entirely requires running the producer on an isolated copy of the admitted
scope (the shape the implementation reviewer already uses) — task `0053`, a
follow-up, not a gate for this unblock. `requireExistingExactFileLeaf`'s
ancestor-symlink check on admitted exact-file entries is unchanged. Tests:
`tests/producer-write-scope.test.ts` pins the `.venv` links passing, a leftover
`build/` link failing closed, and the on-scope / ancestor / skipped-root cases
failing closed.

## D-052: The runtime repository-worktree diff runs only for a non-isolated adapter (2026-08-30)

**Decision:** Task `0051`. `src/core/review.ts` takes its `baseline` /
`after` `snapshotTree(repo_root)` diff (`comparison: "repository_worktree"`,
`reviewer_write_detected`) only when the resolved adapter's capabilities report
`isolated_workspace: false`. `AdapterCapabilities` gains that boolean;
`claude`, `cursor`, `codex`, and `grok` all report `true`.

**Rationale:** every reviewer adapter prepares a workspace that is not the
repository worktree (`mkdtemp` + two files for a plan review, a scope copy for
an implementation review) and runs the CLI with `cwd` there, and each adapter's
own `verify()` snapshots that workspace before/after
(`reviewer_write_detected` / `reviewer_workspace`). The runtime's separate
whole-`repo_root` diff can never see an isolated reviewer's writes — the
reviewer has no handle to `repo_root` — so it only ever attributes a concurrent
external change to the reviewer. It blocked three real runs on 2026-08-30 (task
`0049`/`0050` plan reviews): twice on an `err.log` the `/spbridge` driving
session redirected into the repo, once on a task file committed from a
concurrent session mid-review. The reviewer-side `verify()` check is the
operative guard; the repository-worktree diff is defence in depth for a
hypothetical in-place adapter and is retained for that case only.

**Consequence:** an isolated reviewer's run is not blocked by a launcher log,
an editor swapfile, or a sibling session's write under the repo root during the
~1-2 minute window. `agent-skill/skills/spbridge/SKILL.md` also tells the caller
not to redirect CLI output under `--repo` or write the repo during a review.
The complete leftover-alias / concurrent-write isolation for the **producer**
round is task `0053`. The `reviewer_isolation_unavailable` failure on a
snapshot-cap overflow now only fires adapter-side (the workspace snapshot) for
an isolated adapter.

## D-053: A plan that edits AGENTS.md or config.yaml declares a human implementer (2026-08-30)

**Decision:** Task `0052`. A ninth `AGENTS.md`-only rule in `## Artifact
authoring`: a plan whose decisions or scope edit `AGENTS.md` or
`spartan-bridge/config.yaml` sets frontmatter `next_role: human-operator` on the
plan-review pass rather than entering the plan-pass auto-chain. Threaded through
`tests/agents.test.ts` the same way the path-verification rule was (task `0050`):
`ARTIFACT_AUTHORING_SEVEN` requires nine bullets, a new constant asserts the
rule appears once in `AGENTS.md` and nowhere in task `0022`, the fixture,
`README.md`, the skill, or `docs/ROUTING-AND-WORKFLOWS.md`.

**Rationale:** `AGENTS.md` and `spartan-bridge/config.yaml` are outside every
automatic write scope by design (D-035, and the automation-authority section
forbids a `task_artifact_write` from touching `AGENTS.md`). Task `0050`'s plan
review passed with a D1 that only edits `AGENTS.md`; the auto-chain then spent a
~6.5-minute Cursor implementer round and an implementation-review cycle
(`run-871b9a98`, `PLAN_TARGET_OUTSIDE_WRITE_SCOPE`) discovering the mapped
implementer could not do it. Board task `0023` reasoned the same constraint out
by hand (its D7); this makes it a rule.

**Consequence (deferred half — D2, task `0054`):** before producer capability
selection or spawn, `continueAfterPlanReview` scans the approved artifact's
`## Scope` and `## Decisions` for prose-level backticked path tokens (not fenced
blocks). When any token names a path outside the automatic implementation write
scope — including `AGENTS.md` and `spartan-bridge/config.yaml` — the transition
stops with `plan_targets_unwritable_path` and a transition record instead of
spawning the mapped implementer. A human-started `/spbridge` or `/spartan`
producer round is unaffected. The `AGENTS.md` authoring rule (above) removes the
recurrence for planners who follow it; this guard is defence in depth.

**Amendment (2026-09-02, task 0066):** a bare name is a scan target only when it
is in `KNOWN_TOP_LEVEL_NAMES`. The extension-based bare-name branch is deleted,
so a prose shorthand such as `DESIGN_SYSTEM.md` no longer stops the chain. A
stop records the offending tokens on additive `unwritable_plan_targets`
(`string[] | null`) and leaves `producer_diagnostic` null. `SCHEMA_VERSION`
stays 2.

**Amendment (2026-09-03, task 0067):** after `reviewer.plan: pass` the scan is
advisory. `continueAfterPlanReview` records a non-empty token list on
`unwritable_plan_targets` and still spawns the mapped implementer; it does not
stop with `plan_targets_unwritable_path`. The producer write-scope guard —
POSIX mode lock, Darwin `sandbox-exec` profile with outer `require-any`
`(literal …)` denies for each `AUTHORITY_WRITE_PATHS` member, and the
post-child snapshot — is the write boundary for `AGENTS.md`,
`spartan-bridge/config.yaml`, and every other out-of-scope path. The
`AGENTS.md` authoring rule stays planner discipline. `plan_targets_unwritable_path`
remains on `ReasonCode` for historical records. `SCHEMA_VERSION` stays 2.

**Amendment (2026-09-12, task 0074):** a slash-bearing token is a scan target
only when its leading segment is present in the repository-root listing. The
caller supplies that listing, keeping the scanner pure; an unreadable listing
uses a report-everything sentinel so the advisory is not silently weakened.
`AGENTS.md` and `spartan-bridge/config.yaml` bypass the root gate and are always
classified. This deliberately accepts one false negative: a plan that proposes
a path under a new, not-yet-present top-level directory is omitted from the
advisory. The producer write-scope guard remains the write boundary, and
`SCHEMA_VERSION` stays 2.

## D-054: Detach the review chain from the caller's shell; recover with `resume` (2026-08-31)

**Decision:** Task `0055`, from an external B + D review that rejected A / C / E.

- **B — `review --detach` + `spartan-bridge wait`.** `review --detach` reserves
  a run id, writes `.spartan-bridge/invocations/<id>.json` (`{ run_id, pid }`),
  reparents the real work with `spawn(argv, { detached: true, stdio: ["ignore",
  fd, fd] })` (`fd` an open descriptor for `<invocations>/<id>.detach.log`) +
  `child.unref()`, prints one JSON ack and exits 0. Default `review` stays
  blocking. `spartan-bridge wait --run <id> [--timeout-ms N]` (default 25000)
  follows the chain the blocking process embodied: plan run -> its
  `parent_run_id` successor transition -> the transition terminal document. The
  plan-run `status.json` is sealed at `awaiting_implementer` by D-035, so
  **the invocation pid, not that file, is the liveness signal**: pid alive ->
  running even with no transition yet; pid dead and no transition -> the
  plan-run status is the outcome. The skill loops `wait` the way it loops
  `--after-run`, holding no chain counter.
- **D — `spartan-bridge resume`.** The writer-lock record gains a `pid`
  (readers tolerate an old pid-less record). `resume` releases a lock whose pid
  is dead. For a detached invocation whose pid is dead and whose successor
  transition is not terminal, `resume` keys on the last `events.jsonl` checkpoint:
  at a resumable checkpoint it re-acquires the writer lock and calls
  `advanceFromCheckpoint` in **finalise-only** mode — it finalises from an
  existing terminal linked review, refuses if a linked run is still live, and
  when a checkpoint would require dispatching a fresh `runReview` it leaves the
  transition unchanged and prints `run /spbridge on this task to dispatch the
  implementation review`. `resume` never spawns an adapter and is never
  long-running. At `producer_started`, `correction_dispatched`, `authorization`,
  or `lock_acquired` it persists `stopped` / `interrupted` as before. A live
  invocation pid or a non-terminal linked implementation-review run is refused
  with no transition mutation.

**Rationale:** the timeout kill hit tasks `0046` and `0026` — plan pass, mapped
implementer wrote its product files, SIGTERM before `producer_finished` / the
frontmatter advance / the implementation review. A (skill polls
`.spartan-bridge/runs/<id>/status.json`) fails because that file is sealed at
the pass and reproducing the process's liveness in the skill needs
successor-transition lookup the skill is forbidden to do. C (daemon) is the
wrong layer — the `/spbridge` session is alive, only its shell tool timed out
(D-006 amendment). E (`nohup`) does not help a skill.

**Consequence:** `spartan-bridge review --detach`, `spartan-bridge wait`, and
`spartan-bridge resume` are new CLI commands; `--run-id` is an internal
`review` flag the detach parent passes. `ReasonCode` gains `interrupted`.
`ReviewCommandInput` gains an optional `run_id`. `agent-skill/skills/spbridge/
SKILL.md` step 4 is the `--detach` + `wait` loop, host-neutral (no shell
backgrounding syntax). The change is entirely CLI + durable state, below every
adapter and host.

**Amendment (2026-09-02, task 0056):** `resume` is finalise-only. It does not
dispatch `runReview`; that spawn remains on the detached `review` chain the
operator restarts with `/spbridge`. A checkpoint that still needs a review run
is left as-is with an explicit instruction. This keeps `resume` the cheap,
un-killable recovery path this decision originally required.

## D-055: The Codex adapter forwards `CODEX_HOME` and reviews from the workspace cwd (2026-08-31)

**Decision:** Two changes to the Codex adapter, one slice:

1. `CODEX_ENV_ALLOWLIST` gains `CODEX_HOME`, forwarded to the `codex exec` child
   only when the parent process already exports it. The Bridge never sets or
   defaults it and never reads `auth.json`. `isSensitiveRegistryKey` does not
   flag `CODEX_HOME` (tokens `codex` / `home`), so no exception set is needed —
   unlike Cursor's `AGENT_CLI_CREDENTIAL_STORE`. No value guard: like `GROK_HOME`
   and `CLAUDE_CONFIG_DIR` the value is an arbitrary path, and `spawn` replaces
   the whole environment with no shell, so a hostile path cannot become argv.
2. The review spawn `cwd` becomes the ephemeral workspace root (the `--cd`
   value), replacing `os.tmpdir()` — see the D-023 amendment. This aligns Codex
   with the Grok / Claude / Cursor adapters and lets a machine-local `codex`
   wrapper resolve the client-context profile from `$PWD`.

Deferred, not gates: `codex exec --ignore-user-config` (would skip a possibly
hostile `$CODEX_HOME/config.toml` while keeping `auth.json`; Grok and Claude do
not ignore profile config either), and a spawn-level test asserting
`spawn.env.CODEX_HOME` like the Grok suite's `GROK_HOME` check.

**Rationale:** Codex was the only reviewer adapter that could not reach a
relocated official-client home. Grok forwards `GROK_HOME` (D-045), Claude
forwards `CLAUDE_CONFIG_DIR` (D-046), and `docs/examples/agent-profiles/
wrap-official-client` already sets `CODEX_HOME="$base/codex"` with the comment
"Relocating CODEX_HOME is a Bridge concern" — but the adapter allowlist stripped
it, so a Bridge-spawned `codex exec` fell back to `$HOME/.codex/auth.json`.
On a machine running isolated client profiles that file is stale or belongs to
a different account; the observed failure was `token_revoked` /
`refresh_token_invalidated` on every dispatch for a `client-a` client context whose
own profile (`~/.agent-profiles/client-a/codex/auth.json`) was freshly authenticated.

**Consequence:** a session that invokes the Bridge for a Codex-backed review
must export `CODEX_HOME` for the client context it is about to use, exactly as
it already must export `GROK_HOME` / `CLAUDE_CONFIG_DIR` for those hosts — the
client-context registry maps only `context + host -> launcher id`, never an
environment. `CODEX_HOME` unset keeps today's `$HOME/.codex` behaviour.

## D-057 — Pre-dispatch and launcher-failure diagnostics (task 0057)

**Decision:** Keep `task_invalid` and `composition_failed` as the wire
`reason_code` / `task_write_rejection_cause` values. Add nullable
`pre_dispatch_diagnostic` on the status document for pre-dispatch refusals, and
`adapter_failure.output_excerpt` / `output_excerpt_bytes` for launcher process
output (stderr log fields stay stderr-only). `doctor` prints excerpts and maps
known wrapper signatures to fix hints; it also warns when a resolved wrapper
launcher references a `resolve-profile` path that does not exist from the
current environment.

**Consequence:** Callers can fix a refused artifact or a failed preflight from
CLI output alone; old readers that ignore the new nullable fields see no
behaviour change.

## D-058 — Producer and review child timeouts differ (task 0059)

**Decision:** Cursor and Grok producer spawns use `BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS` (`2_700_000`, 45 minutes) or an optional per-repository raise via `implementer_timeout_ms` under `transitions.review_plan_pass`. Plan and implementation **review** spawns keep `900_000` (15 minutes). `producer_timeout` stops record `waited_ms` on `ProducerDiagnostic` (seventh closed key; `schema_version` stays `2`). `AdapterProducerInput.producer_timeout_ms` threads the resolved value from `transition.ts` through `startProducer`.

**Rationale:** Task `0057`'s auto-chain implementer wrote the full product diff then SIGTERM'd at the 15-minute review constant reused for the producer spawn. A bounded read-only review and a multi-file implementer round are not the same workload.

**Consequence:** Repositories that need longer implementer rounds opt in with `implementer_timeout_ms` above the floor; they cannot shorten below `2_700_000`. Diagnostics on `producer_timeout` name the spawn timeout the Bridge waited for.

## D-059 — Auto-chain terminal close-out leaves the artifact ready to commit (task 0058)

**Decision:** A passing implementation review that ends `continueAfterPlanReview` with `terminal_stop` / `completed` triggers `writeTerminalCloseOut`: one deterministic completion-notice rewrite of `## Next Action`, handoff retraction when needed, and `status: active` / `phase: complete` / `current_role: human-operator` via `TERMINAL_CLOSE_FRONTMATTER_KEYS` only. `checkTerminalCloseShape` gates that path; `checkArtifactWriteShape` for ordinary review dispatch is unchanged. `wait` / `/spbridge` follow a non-terminal successor transition until the invocation pid is dead **and** every linked implementation-review run is terminal. `spartan-bridge status --repo <root> --task <path>` reports the completed chain, implementation-review verdict, and scoped `git diff --stat`.

**Rationale:** Board tasks `0027` and `0029` finished the chain but left stale producer `## Next Action` text, lifecycle frontmatter at `phase: reviewing`, and a `/spbridge` session that stopped at `awaiting_implementer` instead of the passing implementation-review verdict.

**Consequence:** The human still commits; the artifact and detached `wait` loop now say so unambiguously. Mid-chain review writes cannot rewrite lifecycle frontmatter.

## D-060 — Plan-review severity policy and named `## Next Handoff` sub-rules (task 0061)

**Decision:** The plan-review prompt for every reviewer adapter (`CLAUDE_REVIEW_PROMPT`, `GROK_REVIEW_PROMPT`, `CODEX_REVIEW_PROMPT`) carries a severity rule: `error`/`warning` severity is for a decision that is wrong, self-contradictory, or unimplementable as written, or an ambiguity an implementer would plausibly resolve the wrong way; a wording/ordering/evidence-precision improvement that does not change what gets built is `info` and never on its own justifies `changes_requested`; an implementable-as-written plan returns `pass`. The implementation-review prompts are unchanged. Separately, `parseOutstandingHandoffSection` classifies its twelve rejection paths as a closed `NextHandoffRejectSlug` union; `describeNextHandoffRejection` surfaces the slug as a bracketed token appended to the `next_handoff_not_retractable` `pre_dispatch_diagnostic` (with an explicit "remove the blank line(s) after the closing fence" note for `trailing_content`). `CompositionFailedDetail` and `reason_code` are unchanged — the slug is diagnostic text only.

**Rationale:** The `claude-plan-reviewer-v1` chain exhausted all three cycles on four bridge/protocol tasks (`0055`, `0031`, `0058`; `0059` within one) on incremental wording without ever contesting substance, and producer rounds burned attempts guessing which `## Next Handoff` sub-rule the single `next_handoff_not_retractable` detail meant.

**Consequence:** A sound plan reaches `APPROVED` within the cycle limit; a wrong decision still blocks. A producer round is told which handoff sub-rule to fix. No wire-contract change.

## D-061 — The cursor-home doctor warning keys on armed HOME restore (task 0061)

**Decision:** `wrapperLauncherWarnings` emits the "HOME matches a cursor-home path" warning for the `claude` binding only when the wrapper's HOME restore is **not** armed — that is, `AGENT_PROFILES_REAL_HOME` is empty, is itself a `cursor-home` path, or (for `claude`) `CLAUDE_CONFIG_DIR` is unset (for `codex`, `CODEX_HOME`). Only environment variable names and paths are inspected; login-file contents are never read. The `resolve-profile`-missing warning is unchanged.

**Rationale:** The wrapper restores `HOME` for `claude`/`codex` only when the per-host config var is already set (`docs/examples/agent-profiles/wrap-official-client`). `AGENT_PROFILES_REAL_HOME` being present is not proof `HOME` is restored, so suppressing on the marker alone would hide a real misconfiguration; keying on path shape alone made the warning fire on every healthy Cursor-session `/spbridge` run.

**Consequence:** `doctor` is quiet on the designed isolated-profile configuration and still warns when the nested client would actually run under a relocated `HOME`.

## D-062 — A stale `dist/` names itself in the detached wait loop (task 0060)

**Decision:** `ReasonCode` gains `stale_build`. When a detached `review` child exits on the task 0028 stale-build refuse (`dist/ is older than src/`, exit 1, no run directory), `waitForRun` reads the tail of `<run-id>.detach.log`; if it carries that marker and the child pid is dead, `wait` prints a terminal `{ "document": "wait", "state": "stopped", "reason_code": "stale_build", "diagnostic": ... }` and exits 1 instead of the generic "never created a run" line. `SKILL.md` step 4 and the README "Dogfooding" section tell the operator to `npm run build` and re-invoke `/spbridge` fresh — never `--after-run`.

**Rationale:** Three `/spbridge` runs on this repo (`0031`, `0057`, `0059`) hit `dist/ is older than src/` mid-session — a `git pull` or `src/` edit after the chain started — and the `wait` loop gave no actionable terminal signal. The successor implementation review that D2 anticipated runs **in-process** (`transition.ts` calls `runReview` directly, not a CLI child), so a mid-chain stale `dist/` cannot stop it — the node process already holds its loaded modules; D2 was narrowed out. The task 0028 first-`review` refuse (message, exit 1, no run) is unchanged.

**Consequence:** The operator rebuilds and restarts instead of running `resume` or reading a hang. `wait` remains a liveness follower — it never refuses on its own `src/`-vs-`dist/` check, only names a refuse the detached child already recorded.

## D-063 — Trailing blank lines after the `## Next Handoff` fence are tolerated (2026-09-02)

**Decision:** `parseOutstandingHandoffSection` (`src/core/task-write.ts`) accepts any run of blank lines after the `## Next Handoff` closing fence — zero, one, or several — and rejects only non-blank content there (`trailing_content`). The retract operation replaces the whole section, so trailing whitespace there survives nothing; the earlier D-061 D3 choice to reject a lone extra newline with a diagnostic was a recurring producer papercut (bridge `0056` rounds 3–4). `describeNextHandoffRejection` still names `trailing_content` for real trailing prose.

**Rationale:** producer rounds regenerate `## Next Handoff` and routinely leave one blank line before EOF (editor / markdown habit). A byte-exact check there cost a full pre-dispatch round-trip each time without protecting any byte the review write preserves.

**Consequence:** an artifact whose only deviation is trailing whitespace after the handoff fence now dispatches. Task `0063` shares this classifier on the producer-declaration path, so non-blank prose after the prompt fence is `trailing_content` there too; blank lines still pass.

## D-064 — `producer_declaration_invalid` names the failed rule (task 0063)

**Decision:** `validateProducerDeclaration` returns
`{ ok: false; reason: "producer_declaration_invalid"; detail }` with a
first-failure slug. Persistable set `DECLARATION_INVALID_DETAILS`: the six
`frontmatter_*` slugs, the twelve `NEXT_HANDOFF_REJECT_SLUGS` names, the three
implementation-only needles (`advisory_role_line`, `prompt_open_path`,
`prompt_act_as_reviewer`), and `artifact_unchanged` for the unchanged-hash arm
that never calls the validator. The implementation path calls exported
`parseOutstandingHandoffSection` (success arm `{ located, advisory, prompt }`)
and then applies the three needles on those fence interiors; it does not import
a pairing parameter and `task-write.ts` does not import `producer-declaration.ts`.
Implementation-only slugs stay out of `NEXT_HANDOFF_REJECT_SLUGS`. The stop
records additive required `declaration_invalid_detail: string | null` on the
transition status and event documents — not `producer_diagnostic`, which stays
the closed seven-key D-036 record and stays `null` on this stop. A missing key
or an out-of-union value normalizes to `null` on parse. `SCHEMA_VERSION` stays
2. `formatTransitionTerminalLine` appends ` detail=<slug>` for this reason
code. `/spbridge` recovers in a fresh implementer session, never `--after-run`.

**Rationale:** the `0056` auto-chain stopped at `producer_declaration_invalid` /
`producer_diagnostic: null` after an unfenced `## Next Handoff` advisory. The
operator had to read the validator to learn which rule failed. `producer_diagnostic`
cannot carry a slug (D-036 / task `0066`). Sharing the `0061` classifier avoids
a second fence-walk; the one accepted tightening is `trailing_content` on the
declaration path.

**Consequence:** `wait` and blocking `review` surface the slug on the transition
document; a recovery round can act on it without diffing the validator.

## D-065 — Collect-phase adapter failure keeps the tail, the signal, and two provider causes (task 0064)

**Decision:** A reviewer child that exits non-zero during `collect` (or another
post-`start` phase) records enough to tell an infrastructure flake from a
provider fault. `buildAdapterOutputExcerpt` keeps the redacted tail of at most
`OUTPUT_EXCERPT_CAP_BYTES` (512) with no `[truncated: earlier bytes dropped]`
prefix; that marker stays on the 16 KiB payload log. All four review adapters
set `retainStdout: true` on the review spawn. `SpawnOutcome` and
`AdapterFailureRecord` gain `signal: string | null` (the OS name Node's `close`
delivered, not a Bridge-closed enum). `ADAPTER_FAILURE_CAUSES` gains
`provider_unavailable` and `provider_limit`. `AdapterFailureRecord` gains
`http_status: number | null`. `src/adapters/provider-failure.ts` reads the last
`type === "result"` object from retained stdout (NDJSON or a single JSON
object) and remaps only on structured fields: `is_error === true` with
`api_error_status === 429` is `provider_limit`; `is_error === true` with
`api_error_status` in `500..599` is `provider_unavailable`; `is_error === true`
with `terminal_reason === "api_error"` and no classifiable status is
`provider_unavailable` with `http_status: null`. A finite `api_error_status` in
`100..599` is still recorded as `http_status` when cause is not remapped. After
a D1a miss, a non-zero collect exit with non-empty stdout that does not extract
as a review payload is `output_unparsable` (and writes `adapter-payload.log`);
empty stdout stays `exit_nonzero`; a parsable verdict on a non-zero exit stays
`exit_nonzero` and is never accepted. `SCHEMA_VERSION` stays 2.
`serializeAdapterFailure` whitelists `signal` and `http_status` and drops extra
keys. `producer_diagnostic` does not gain `http_status`. `/spbridge` step 5
names `adapter_failure.cause`, `http_status`, `signal`, and whether
`output_excerpt` and `payload_log` are null, without quoting excerpt or
payload-log text. Step 7 recommends `/spbridge` only when both excerpt and
`payload_log` are null and `signal` is non-null; `provider_unavailable` /
`provider_limit` and any non-null log pointer print no start.

**Rationale:** Three 0067 collect failures kept the child's opening
`system/init` record in the 512-byte head excerpt while the diagnosis sat in
the final `result` record. A usage-limit or 529 overload on stdout with empty
stderr looked like a content-free `exit_nonzero`. The operator should not have
to re-run the child by hand to read a word the Bridge already captured.

**Consequence:** `status.json` and the terminal `wait` / `spartan-bridge status`
document carry the tail excerpt, the OS signal, a closed provider cause, and
an HTTP status integer. The operator retries a provider outage when the
provider recovers, reads the logs when a payload or excerpt exists, and treats
a signalled empty capture as the only infra-flake `/spbridge` re-run.

## D-066 — Lock unadmitted files to `0444 | (recorded & 0111)` (task 0069)

**Decision:** `lockTree` locks every unadmitted regular file, FIFO, socket, or
device to `0o444 | (recorded & 0o111)`. Directories stay `0555`. Writable
admitted files stay on `writableFileMode`. `restoreProducerWriteScope` still
`chmod`s every recorded mode, including setuid/setgid/sticky. `dist` is not
added to `SKIPPED_DIR_NAMES` and is not admitted to the automatic write scope.

**Rationale:** The global `spartan-bridge` command is an npm link to this
checkout's `dist/cli/main.js`. Locking that file to `0444` stripped `+x` for
the producer window, so `wait` / `status` / `resume` died with exit 126
exactly while a chain was in flight. Skipping `dist` or exempting the running
CLI realpath would drop snapshot coverage or leave owner-write on an
unadmitted inode. Preserving only already-set execute bits keeps the CLI
runnable without opening a POSIX write path.

**Consequence:** A recorded `0755` locks to `0555`, `0744` to `0544`, `0644`
to `0444`. POSIX write, Darwin `file-write*`, and the producer snapshot still
deny mutation of every unadmitted path, including an executable
`dist/cli/main.js`.

## D-067 — Implementation-review pass is `review_passed`, not `awaiting_implementer` (task 0069)

**Decision:** `RunState` gains `review_passed`. `terminalForVerdict(verdict,
reviewKind)` maps `pass` + `implementation` to `{ state: "review_passed",
reason_code: "review_passed" }`. Every other pair, including `pass` + `plan`,
returns `VERDICT_TO_TERMINAL[verdict]`. That table's `pass` entry remains
`{ state: "awaiting_implementer", reason_code: "review_passed" }`.
`SCHEMA_VERSION` stays `2`. `parseStatusJson` does not remap historical
`awaiting_implementer`. `wait` treats `review_passed` as a terminal run state
with exit `0` and does not follow a successor. Plan-pass
`awaiting_implementer` remains the chaining signal.

**Rationale:** `VERDICT_TO_TERMINAL` was keyed on the verdict alone, so a
passed implementation review reported `awaiting_implementer` when nothing was
awaiting an implementer. Renaming the existing member would rewrite historical
documents.

**Consequence:** A passed plan review still surfaces `awaiting_implementer`. A
passed implementation review surfaces `review_passed`. A document written
before this task keeps the state it stored.

## D-068 — Human-started `/spbridge` producer model binding is a config toggle (task 0065)

**Decision:** Optional `spartan-bridge/config.yaml` section:

```yaml
producer:
  model_binding: advisory   # advisory | warn | strict
```

Default when the section is absent, the file is absent, or the field is unset:
`advisory`. The section, when present, has exactly the one key `model_binding`.
`spartan-bridge policy --repo <root> --role <planner|implementer>` prints one
JSON object with `role`, `model_binding_mode`, `binding_model`, and
`binding_effort`. `/spbridge` step 2 reads that helper after the
`reviewer_output_unconstrained` doctor stop and before `/spartan`. `advisory`
skips compare. `warn` notices a case-insensitive `binding_model` mismatch and
proceeds. `strict` aborts the invocation on a knowable mismatch. `strict`
degrades to `warn` when the session identifier is not `MODEL_IDENTIFIER_RE`-shaped.
The toggle governs only human-started `/spbridge` producer rounds; auto-chain
producers stay argv-driven. `ProducerIdentity` remains `{ role, host }`. The
Bridge still records `model_observed: declared_unobserved` when the adapter
reports no observed model. Schema version stays `1`. `doctor` is unchanged.

**Rationale:** A human-started producer round runs in the interactive session's
harness model, which can silently differ from the `AGENTS.md` binding. Making
every human-started round Bridge-spawned would drop interactivity. Observing the
model after the fact is a separate gap.

**Consequence:** Repositories that want `warn` or `strict` add the `producer`
section themselves. This checkout does not opt in. The skill never switches the
harness model. Capturing the optional `planner` row uses the same
`resolveHostBinding` path as `implementer`: an unresolvable Host or Client
context on that row fails the entire `parseAgentsPolicy`, not only the planner
query.

**Amendment (2026-09-12, task 0080):** D-076 widens the optional `producer`
section to contain one or both of `model_binding` and `scratch_prefixes`; an
empty section or any other key remains invalid. D-068's model-binding behavior
is unchanged.

## D-069 — A finished chain names the rebuild; D-031 gains no exemption (task 0070)

**Decision:** `main()`'s `wait` branch, after printing a terminal document,
calls the existing `staleBuildMessage(packageRoot)` once more and writes
`STALE_BUILD_NEXT_ROUND_MESSAGE` to stderr when it reports staleness. Nothing
else changes: D-031 keeps its predicate, its message, its exit codes and its
per-kind split; there is no exemption, no override, no new persisted state, no
new field on `TransitionStatusDocument`, and no new tree traversal. The line is
stderr only, so the stdout document and the exit code are byte-identical to
before. It is printed only on a terminal document that reports a chain which
ran: never on a `{ "state": "running" }` document, never on D-062's
`stale_build` terminal document, and never in place of the "never created a
run" error — those two are already governed, and the line would contradict
them. The guard is the `outcome.document.length > 0` arm plus a
`"reason_code":"stale_build"` substring test. No command other than `wait`
gains output. `SKILL.md` step 4 and the README state the rule: run `npm run build`
before the next `/spbridge` round, never as an `--after-run` continuation.

**Rationale:** A mapped implementer in this repository edits `src/` as the
product and cannot rebuild `dist/`, which is outside every automatic write
scope, so every such chain ends stale and the next `review` exited 1 with no
account of who caused it — three times on `0069` alone. The first design
answered that with a two-digest baseline on the transition record and a
five-condition exemption; six plan-review cycles across two chains
(`b7249c2`) each found a real defect in it and each answer grew it. The
premise that dissolved it: the successor implementation review runs in-process
(`transition.ts:1192`), so a stale `dist/` never interrupts a running chain.
It meets only the next human-started invocation — at a moment when a human is
present and the remedy is one command. Persisting state that D-031 must then
trust is a poor trade for skipping that command, and running the build under
the Bridge's own authority would both take a repository-defined-command
privilege the Bridge takes nowhere else and install unreviewed code as the
runtime that reviews it.

The line also says nothing about whether the round succeeded: a chain killed
mid-round prints a terminal document that is neither of the two excluded
cases, and `SKILL.md` step 4 sends a non-terminal `state` to the resume rule
rather than calling the chain finished.

**Consequence:** Unattended continuation across a process boundary is not
delivered and is not attempted: one human command stands between a
source-editing chain and the next round in this repository. An operator who
ignores the line still meets the refusal on the next `review`, with D-062's
`stale_build` terminal document unchanged as the recovery. D-031's existing
blind spot — a source edit whose modification time does not advance never
makes the check fire at all — is untouched and unclaimed.

## D-070 — Codex producers disable the inner seatbelt under the Bridge write-scope profile (task 0072)

**Decision:** On 2026-09-04, three Darwin probes through a real
`applyProducerWriteScope` profile settled the Codex producer argv at `--sandbox
danger-full-access`, with no approval-policy configuration. The adapter keeps
the existing Bridge-owned repository write-scope guard: POSIX mode lock,
Darwin `sandbox-exec` profile, and post-child snapshot. Producer preflight
therefore runs the existing `codex exec --help` probe and a separate
`sandbox-exec` interface probe before spawn.

**Rationale:** Under the same outer profile, `--sandbox workspace-write`
refused an admitted `src/probe.txt` write with `Operation not permitted` but
still completed the turn and exited 0. A control shell under the outer profile
wrote that admitted path and refused `AGENTS.md`, proving the Codex inner
seatbelt caused the admitted-path failure. With `--sandbox
danger-full-access`, Codex wrote the admitted file and exited 0. A third probe
then confirmed that the outer profile still refused an out-of-scope repository
write to `AGENTS.md`, while an operational `/tmp` write outside the repository
root succeeded as the profile's `(allow default)` intends.

**Consequence:** A producer uses Codex without its inner seatbelt, but the
Bridge's repository-local guard remains the write boundary. Choosing
`workspace-write` would fail quietly at the process boundary: exit 0 with an
unchanged task artifact would reach declaration validation as
`producer_declaration_invalid` with `declaration_invalid_detail:
"artifact_unchanged"`, not as `exit_nonzero`. The adapter therefore pins the
measured writable mode and tests the outer profile on every producer preflight.

## D-071 — The verdict contract budgets its own summary, and both caps live in one place (task 0072 sidecar)

**Decision:** `REVIEW_SUMMARY_MAX_CHARS` (4000) and
`REVIEW_FINDING_MESSAGE_MAX_CHARS` (2000) move to `src/core/contracts.ts`, and
both `reviewOutputSchema` and `validateReviewResult` read them instead of
hardcoding `2000` twice. Every one of the eight reviewer prompts gains a
`Length budget.` paragraph telling the reviewer to keep `summary` and each
finding `message` under 1200 characters, and saying that exceeding the schema
discards the whole review.

**Rationale:** Two consecutive live implementation reviews of task `0072` were
destroyed by this — `run-e91670d5` at 2028 characters of summary and
`run-4299c737` at 2186, each after five structured-output retries and roughly
five minutes of real reviewing. Nothing told the reviewer a budget existed: no
prompt contained the strings `2000`, `characters`, `concise`, or `brief`. The
cap bit the one field no artifact renders — `renderRegion` reads `summary` only
for the redaction gate — while `findings[].message`, which *is* written into
the task file, has never exceeded 1379 characters across the 59 findings
persisted in `spartan/tasks/`. The prompt budget is the fix; the raised summary
cap is the safety net, because a prose instruction is weaker than a schema
constraint and we had just watched the model violate a hard schema five times
in a row. The two caps are shared constants because a client-side limit looser
than the Bridge-side one turns a valid review into `result_schema_invalid`
after the work is already paid for.

**Consequence:** `summary` may now reach 4000 characters where it previously
died at 2001; the extra bytes land only in `review-verdict.json` and
`reviews/<execution_id>.json`, never in a task artifact or on the TTY.
`findings[].message` is unchanged at 2000. This does not close task `0071`,
which is about recovering a rejected attempt's *content*; it removes the one
cause `0071`'s own instrumentation has so far identified.

**Amendment, 2026-09-05.** The claim above that the two layers "share one cap"
was false as first shipped, and an out-of-band Codex review
(`gpt-5.6-sol`, read-only) caught it. They shared a *number*, not a limit:
JSON Schema `maxLength` counts Unicode code points, while `validateReviewResult`
used JavaScript `.length`, which counts UTF-16 code units. A summary of 3000
non-BMP code points satisfied the 4000 handed to the client and then died here
at 6000 units — the exact paid-review loss this decision set out to remove.
Worse, a finding message of 1200 non-BMP code points obeyed this decision's own
prompt budget and was still rejected at 2200 units. `validateReviewResult` now
counts code points for both fields, and `tests/adapter.test.ts` pins the
boundary with non-BMP strings; an ASCII-only test cannot see this class, which
is why the original tests missed it. `REVIEW_MAX_FINDINGS` (100) joins the two
length constants, closing the third and last limit that was hardcoded twice. The
same review named one consequence this decision still had not stated, and it is
recorded here rather than acted on: `summary` is not rendered into an artifact,
but `renderRegion` scans it for the region marker tokens
(`src/core/task-write.ts:472`, `:593-595`). A larger cap therefore widens that
gate's surface — marker text beyond the old boundary can now turn an accepted
verdict into a task-write rejection. That preserves the verdict rather than
discarding it, so it is a smaller failure than the one this decision removed,
but it is a real effect of the raise and belongs in the record.

## D-072 — Automatic producers run on an isolated scope copy (task 0053)

**Decision:** On 2026-09-05, automatic producer rounds moved from the live
repository to a Bridge-owned writable workspace rooted outside it. The runtime
copies the admitted automatic write scope plus read-only `node_modules/`
support, and producers use that root as both `cwd` and their client workspace
argument. A Darwin allow-list sandbox globally denies writes, re-allows the
workspace and the child environment's existing `HOME` and `TMPDIR`, then
denies the canonical repository root last. Adapters only spawn; they must
declare `isolated_producer_workspace: true`.

After the producer exits, the runtime snapshots admitted product with full
hashes, classifies `dist/` and `node_modules/.cache/` as discarded scratch,
captures
admitted changes into memory, and resolves every live destination with
`O_NOFOLLOW_ANY`. Only after the whole candidate set and its undo state validate
does it release the profile and apply changes under the existing writer lock.
Replacement files use journal-owned sibling temporaries; apply failure rolls
back, and rollback failure stops at `runtime_state_violation`. The former
live-tree POSIX mode lock and its symlink, exact-leaf, hard-link, and parent
pre-checks are removed.

**Rationale:** A deny-under-repository profile is not an allow list: Darwin
matches post-resolution paths, so a repository symlink to an outside path fell
through `(allow default)`. Rejecting every such symlink blocked legitimate
virtualenv and dependency trees. Isolation makes a leftover live alias absent
from the producer workspace and makes merge-back, rather than producer path
resolution, the trust boundary. The support copy keeps `typecheck`, `build`, and
tests runnable without admitting dependencies to merge-back.

**Consequence:** Reads remain unconfined, and direct writes to `HOME` and
`TMPDIR` remain available for official-client operation. A pre-existing
cross-root hard link cannot be prevented by a path profile. The live producer
snapshot detects it only when the write lands between `productBefore` and
`productAfter`, and only when it changes content in a hashed tier or changes
the fields represented in a metadata tier. Skipped subtrees use a recursive
metadata digest; D-074 later added `ctimeNs` to that digest, while ordinary
files above 1 MiB still use size plus `mtimeNs`. A size-preserving write that
restores `mtimeNs` therefore remains outside the claimed detection only in the
latter tier. A surviving descendant's delayed write after `productAfter`
remains outside the detection window. Detached process-group signalling is
hygiene, not containment.

## D-074 — Producer snapshots collapse support, omit scratch, and keep one resolved scope (task 0077)

**Decision:** On 2026-09-10, producer-workspace snapshots began omitting scratch
paths and recording each support root as one recursive metadata-digest entry.
The merge classifier has three relevant dispositions: scratch is discarded,
support refuses the whole round when changed, and admitted product is captured.
Only scratch is therefore safe to omit. Support remains represented so a write
still produces `write_scope_violation`, but the snapshot no longer spends an
entry or a content read on every installed dependency.

The digest includes each descendant inode's `ctime` as well as kind, relative
path, mode, size, `mtime`, and symlink target. A producer can restore `mtime`
after a same-size content replacement, but it cannot set `ctime`; adding the
latter preserves detection without reopening every dependency file. The
tradeoff is explicit: the refusal still detects that the support tree changed,
but now names the support root and no longer proves which descendant or bytes
changed. Scratch prefixes, including `node_modules/.cache/` nested beneath a
support root, contribute no digest record.

**Rationale:** The dependency tree is copied so the producer can build and
test, yet the prior full-hash baseline and capture both walked it under the
20,000-entry cap. An application-sized installation could therefore finish the
producer and then stop before implementation review, or fail earlier while
preparing the baseline. Omitting support would remove the cap failure but also
silence the merge's live support-write refusal. Metadata collapse retains that
refusal at bounded snapshot cardinality.

**Consequence:** `prepareProducerWorkspace` resolves its support scope once,
uses it for the copy and baseline, and returns it for the capture and merge;
there is no second hardcoded support list to drift. Both workspace snapshots
apply the same collapse/omit rules, while callers that supply neither list keep
their old behavior. The shared producer-policy metadata digest also detects
`ctime`-only changes in skipped repository trees. Those live snapshots detect
any change in their window rather than attributing it to the producer, so
Bridge-owned guard metadata changes must complete before the baseline; the
isolation lock is therefore established before `repo_before` and
`runtime_before`. Snapshot-cap stops now carry closed `snapshot_site` and
`snapshot_cap` values, distinguishing all six walks and the `entries` versus
`hash_bytes` limits.

## D-075 — Producer workspaces carry repository client context (task 0079)

**Decision:** On 2026-09-11, producer preparation began copying the repository-root
`AGENTS.md` byte-for-byte to the root of the temporary producer workspace at mode
`0444`, after product and support copies and before the baseline snapshot. The
authority file is a regular baseline entry, not part of `PRODUCER_SUPPORT_SCOPE`;
producer placement, scratch classification, merge classification, adapter cwd /
`--workspace`, and the Darwin profile remain unchanged. Existing merge guards
refuse content, mode, or deletion changes to the carried authority file as
`write_scope_violation`, while the live repository authority file remains under
the profile's final repository deny clauses.

Cursor also forwards `AGENT_PROFILES_REAL_HOME` only when the parent already
exports it. That adjacent selector supports a nested official client launched
from a relocated-`HOME` Cursor session; the Bridge never reads, defaults, or
originates it, and this forwarding is not the producer-context fix. `doctor`
now examines the implementer binding's wrapper launcher. When that producer
launcher is wrapper-shaped and the parsed Agent hosts bindings declare multiple
distinct non-empty client-context cells, it emits one binding-named ambiguity
warning derived from the launcher text and the table, without resolving or
reporting an account. An omitted cell is not counted as the normalized
`default`; an explicitly written `default` is counted. The ambiguity diagnostic
is appended without suppressing the wrapper's other shape warnings.

**Rationale:** A producer must remain outside the repository so the final
repository write denies stay effective, but a working-directory profile resolver
walking upward from `os.tmpdir()` cannot see the repository declaration. Every
review workspace already carries that declaration. Moving the producer workspace
would weaken or defeat the deny without helping an out-of-repository placement,
and forwarding selectors alone cannot help when the parent does not hold them.

**Consequence:** A single-context repository gives every producer adapter the
same repository client-context input reviewers already receive, without copying
credentials or changing sandbox reach. A multi-context Agent hosts table remains
ambiguous and is reported before a round. D-055 remains the Codex-specific review
shortcut (`CODEX_HOME` forwarding plus review cwd); D-075 supplies the general,
host-neutral declaration that lets a cwd resolver land correctly in a temporary
producer workspace even when no selector is present.

## D-076 — Producer scratch follows repository build output (task 0080)

**Decision:** On 2026-09-11, `producer.scratch_prefixes` in
`spartan-bridge/config.yaml` became an optional non-empty list of relative,
trailing-slash build-output prefixes. A declaration replaces the `dist/` build
default, while `node_modules/.cache/` remains an always-applied support scratch
prefix. A declared prefix overlapping the automatic implementation write scope,
covering the copied `AGENTS.md`, or covering a producer support root refuses
before registry or adapter work as `config_invalid`; an overlapping inherited
default is dropped so the write scope wins. A clean declaration strictly below a
producer support root, such as `node_modules/.vite/`, is valid: the parser admits
the support-root segment only in that position and continues to reject an equal
root, unrelated skipped roots, and skipped descendants.

One resolved list is passed into producer preparation and returned with the
prepared workspace for the post-run snapshot and merge classifier. Producer-copy
snapshots retain full-file hashing. A cap at any producer-transition snapshot
site — live-tree `repo_before` and `repo_after`, runtime-ownership
`runtime_before` and `runtime_after`, or isolated-copy `workspace_baseline` and `workspace_after` — reports
`producer_snapshot_cap_exceeded`; reviewer isolation keeps its existing reason.
When a resolved support-scratch descendant already exists as a contained support
symlink or another non-directory, preparation leaves it unchanged rather than
trying to make it writable or aborting the round; this preserves the pre-D-076
behavior for repositories that inherit `node_modules/.cache/`.

**Relationship to D-074:** D-074 established that producer preparation resolves
support once and that both copy snapshots must share collapse and omission rules.
D-076 applies that same no-drift rule to scratch: configuration is resolved once,
then the baseline, post-run snapshot, support digest, and merge classification all
consume the prepared value. This changes which build paths may be discarded, not
the snapshot hashing guarantees or the producer's write authority.

**Consequence:** Repositories whose build output is outside `dist/` can exclude
that output from both full-hash copy snapshots without widening merge authority.
A contradictory declaration fails loudly, while a repository that admits its own
`dist/` no longer loses those product edits to an inherited default.

## D-077 — Producer violation stops name bounded refused paths (task 0068)

**Decision:** Transition status and event documents now carry the required,
nullable `producer_refused_paths` field. The Bridge populates it on exactly three
stop sources: a Bridge-runtime snapshot diff, a live-repository product snapshot
diff excluding the `.` root entry, and the isolated-workspace classification
pre-pass. The pre-pass collects every refused path before the capture loop reads
any file and carries them separately from `ProducerMergeError.unrestored`; the
rollback-failure `unrestored` list is not surfaced by this field.

Lists keep the first 20 paths in snapshot-diff order. Each path keeps at most the
last 256 UTF-8 bytes, advanced to a character boundary and prefixed with `.../`
when truncated, so a path is never omitted solely for length and a stored token
is at most 260 bytes. The marker is conventional rather than unforgeable: a real
path beginning with a literal `...` segment may look the same, but a truncated
token remains an identifying suffix of the actual path. To keep a captured token
byte-stable when the transition serializer applies the same bound, a token that
already begins `.../` and occupies at most 260 bytes is treated as conventionally
truncated. The marker ambiguity therefore also means a foreign persisted token in
that exact shape cannot be distinguished from a Bridge-truncated one.

Runtime-state tokens are relative to the `.spartan-bridge` ownership root rather
than the repository root. They include the `.` snapshot entry when that ownership
root itself changes; unlike the live-product arm, the approved runtime-diff arm
does not filter it, so it can occupy one of the 20 positions.

**Rationale:** `unwritable_plan_targets` reports what an approved plan mentioned;
it cannot identify an unplanned path that the producer actually changed. The new
field records Bridge-observed evidence at the guard that refused the round while
keeping `ProducerDiagnostic` closed and free of paths.

**Consequence:** Terminal output appends ` wrote=` for `write_scope_violation`
and `runtime_state_violation`. Each entry is JSON-stringified and then walked by
UTF-16 code unit; every unit outside printable ASCII is rendered as a lowercase
four-digit `\\u` escape. Supplementary characters therefore become two surrogate
escapes, and every quoted token remains one-line, printable ASCII, and
JSON-round-trippable. Missing or malformed persisted values normalize to `null`;
the additive document change keeps schema version 2.

## D-078 — Consumer repositories run a pinned, stamped runtime (task 0083)

**Decision:** On 2026-09-13, the supported consumer runtime became a globally
installed package tarball built from a chosen checkout, rather than an `npm link`
to the editable development tree. A development build is selected by promoting
it into the same global slot. Repository content and the portable skill's
runtime-selection rule remain unchanged: while `PATH` resolves the installed
runtime, repository content cannot displace it.

`postbuild` now writes `dist/build-info.json` with the package version, Git commit
and dirty state when Git is available, and the UTC build time. Status documents
carry `runtime_build`, which names the invocation that created the run or
transition. Event documents carry `emitting_build`, which names the invocation
that appended that line. Missing or malformed records normalize to `null`, and
the additive document fields keep schema version 2. The build record is not part
of resolved policy or its digest.

**Rationale:** Linking the global executable to this checkout made every consumer
repository depend on the checkout's source/build freshness and could expose an
in-progress development build after a rebuild. A packed install ships `dist/`
without `src/`, fixing that coupling while the stamp retains an auditable build
identity. Separate origin and emitter fields truthfully represent a run continued
by a later invocation after the runtime has changed.

**Consequence:** Editing this checkout no longer blocks or silently changes rounds
in other repositories after the operator promotes the packed runtime. Operators
can identify the selected executable with `spartan-bridge --version`, see the
same rendering in `doctor` and the review's terminal opening line, and retain it
on the persisted `Bridge run:` line. The opening line names the dispatching
invocation; the artifact line and its `task_artifact_written` event name the
writing invocation. Persisted status and event records separately attribute run
creation and later event appenders. When `PATH` resolves no runtime, the skill's
pre-existing workspace-local `dist/cli/main.js` fallback remains the bounded
exception; it displaces no installed runtime because none is resolvable.

## D-079 — A tilde exception names one placeholder segment (task 0082)

**Decision:** On 2026-09-13, the private-identity hygiene check replaced its
single pinned tilde token with a closed placeholder-segment vocabulary: `src`
and `build`. A non-dotfile tilde token is admitted only when one of those words
is the entire segment between the opening and trailing slash, optionally
followed by exactly the two source characters of a newline escape. The existing
dotfile rule is unchanged.

**Rationale:** Both config-parser fixtures express the same safe class even
though one carries escape residue in source. Classifying the segment separately
from that source spelling keeps the exception maintainable without widening it
to an arbitrary one-segment name or to paths nested below an admitted segment.

**Consequence:** Generic standalone fixture directories do not make the
repository scan fail, including when one is someone's real directory, because
that identifies a working habit rather than a person or project. Named working
directories, nested paths, unknown segments, and tokens that continue past the
one permitted escape residue remain findings.

## D-080 — The identity scan reads the index and tracked working-copy state (task 0081)

**Decision:** On 2026-09-13, the private-identity hygiene check began scanning
two Git listings: the repository index and a second index populated from it and
updated with `git add -u` in a temporary index and object directory. Git, not
the test file, reads tracked working-copy paths. A symlink is therefore scanned
as its target string, while a tracked path hidden below a directory symlink is
absent; neither link is followed for content. Equal path-and-blob pairs are
scanned only from the index listing.

A tracked edit no longer has to be staged before the suite can report it. An
index finding remains until its correction is staged, and a new file remains
outside the scan until it is tracked; every scan failure states both limits.
The check remains in the test suite rather than adding a commit hook. At a
checkout root with no `.git` entry, the four repository scans skip with an
explicit reason. A present but unusable or mismatched `.git` entry fails them.

**Rationale:** The prior index-only scan could report a newly introduced
identity only after it entered history, while directly reading working-tree
files would follow links and weaken the established security boundary. Git's
staging behavior exposes the tracked working state before commit without
changing what is considered tracked. A run leaves the set and bytes of files
under the repository's Git directories, and the worktree status, unchanged.
Git may refresh the timestamp of an existing loose object when it re-derives
bytes already present through the alternate object directory; that bounded
refresh is accepted because it changes neither repository content nor the
index, refs, configuration, or worktree. A suite run remains reproducible
without relying on clone-local hook configuration.
Throwaway repository coverage removes repository-selecting `GIT_*` variables
from its environment so a caller's Git context cannot redirect fixture operations
into the live repository.

**Consequence:** The same suite invocation sees unstaged edits to tracked
paths, preserves staged findings that a plain commit would write, and leaves
untracked files outside its claim. Isolated producer copies no longer report
four misleading failures solely because repository metadata was intentionally
omitted; their skipped count makes clear that no identity scan ran.
