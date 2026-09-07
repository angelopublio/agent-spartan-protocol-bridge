---
protocol: "1.0.0" # x-release-please-version
id: automate-an-approved-plan-through-implementation-review
created_at: 2026-08-22
status: completed
phase: complete
task_type: implementation
risk: high-impact
current_role: reviewer
next_role: none
updated_at: 2026-08-22
handoff_id: HX-019
next_handoff_id: none
---

# Automate an approved plan through implementation review

## Objective

Let one human-started `/spbridge` planner session continue, after a passing plan review, through the
mapped Cursor implementer and the mapped read-only implementation reviewer without asking the human
to open the producer host. Preserve the same task artifact, review-cycle ceiling, human-only gates,
and fail-closed boundaries already used by manual producer transitions.

## Context

Task `0038` corrected the post-review recommendation and deliberately kept the producer transition
human-started. It was completed, committed as `fd44dd2`, and pushed before this task was created. The
remaining limitation is now explicit in all three current sources of truth:

- root `AGENTS.md` says the Bridge must stop before changing producer role or host and may not start
  an implementer;
- `agent-skill/skills/spbridge/SKILL.md` stops after a passing plan and recommends that the human open
  the implementer in a fresh session;
- `src/core/review.ts` runs one reviewer attempt and has no producer adapter, operational-transition
  config, or exclusive writer lock.

The repository roadmap already names the intended safety contract. `docs/ROUTING-AND-WORKFLOWS.md`
requires an explicit repository grant plus operational opt-in, an unchanged approved-plan hash, an
exclusive worktree lock, and an adapter that enforces the producer permission mode. Phase 5 of
[historical document omitted] groups that transition with a future daemon, but
`docs/ARCHITECTURE.md` says a daemon is required only when work must survive the initiating host,
recover after a crash, schedule work, or dispatch later phases unattended. This task implements the
authorized foreground chain only; it does not claim those daemon properties.

## Scope

- Root `AGENTS.md`: make the complete closed set of edits in D1 to authorize the bounded foreground
  producer transition, distinguish human-started and automatic correction cycles, and add the
  automatic implementation write scope used for enforcement.
- `spartan-bridge/config.yaml` and a new policy parser: make automatic plan-pass dispatch an explicit
  repository operational opt-in that can narrow but never create authority.
- Core contracts, orchestration, state persistence, and path/lock helpers needed to represent and
  execute the foreground producer transition and its implementation-review cycles.
- A Cursor producer capability behind the already selected Cursor launcher, separate from its
  read-only reviewer behavior, with direct argument-array spawning and a fresh implementation
  execution for each producer round.
- `spartan-bridge review`: retain review as the public entrypoint while allowing the runtime, after a
  passing plan review, to execute the separately recorded authorized successor phases before it
  returns its final status document.
- `doctor`: report binding-relative implementer capability in addition to the two reviewer binding
  results introduced by task `0038`.
- Expand the implementation-review scope to cover `README.md`, `package-lock.json`, and
  `spartan-bridge/config.yaml`, so every product or policy file this task changes and every path an
  automatic producer may change is visible to `reviewer.implementation`.
- The `/spbridge` skill, README, architecture, routing, security, decisions, [historical document omitted], and
  host-preauthorization documentation needed to describe the shipped foreground behavior.
- Deterministic fake-adapter tests first, then real Cursor argv/capability tests and end-to-end CLI
  tests over the automatic path and every stop condition.

## Out of Scope

- A daemon, socket, scheduler, Board control plane, crash recovery, automatic stale-lock reclamation,
  background continuation after the initiating `/spbridge` host closes, or multiple repositories.
- Automatic commit, push, pull request, merge, release, deployment, destructive Git/filesystem
  actions, credential/account changes, or scope expansion.
- Choosing a provider, launcher command, account, or client context from task prose or model output.
- Semantic inspection of the producer's edits, re-running the producer's claimed checks in order to
  decide whether implementation review may start, or treating changed bytes as proof of correctness.
- Changing the portable manual Spartan workflow when the Bridge, the opt-in, or a required adapter is
  absent.
- Solving the failed-review-chain recovery wording owned by task `0031`.

## Constraints

- The human starts the planner producer phase. Automatic authority begins only after that phase's
  mapped plan reviewer has returned `pass` and the Bridge has persisted the review write.
- The producer and each reviewer use fresh, separate official-client execution contexts. Reviewers
  remain technically read-only; the implementer is the only worktree writer.
- Repository policy grants a maximum action; operational config may select or narrow it, never
  broaden it. Missing, malformed, or contradictory inputs stop before producer spawn.
- The runtime selects bindings, models, effort, launchers, permissions, hashes, locks, transitions,
  and events. The skill neither reconstructs those decisions nor starts the Cursor process.
- Existing manual `review` behavior and its exact post-pass status tuple remain compatible when
  config is absent/manual or producer capability is unavailable. A present malformed config or an
  explicit automatic request without authority is a policy conflict and takes D1's separate
  post-review/pre-producer hard stop.
- The automatic chain stops before any human-only gate and leaves the task and worktree inspectable;
  it never commits or pushes.

## Decisions

### D1 - Automatic dispatch requires two independent affirmative inputs

Root `AGENTS.md` will grant exactly this transition: after a human-started planner phase and a
persisted `reviewer.plan: pass`, the Bridge may start the mapped `implementer`, may start the mapped
`reviewer.implementation` after the implementer's declaration described by D4, and may return
implementation findings to a fresh mapped implementer execution within D2's independent
implementation-review ceiling. The grant also requires D4's approved-plan hash and D5's exclusive
writer lock and repeats the existing human-only stop list.

The automation section changes as one closed set rather than by replacing one isolated sentence:

1. The human-starts-first-producer sentence is qualified, not retained verbatim: the human starts the
   planner producer phase and later plan-correction rounds stay in that same planner session, while
   each authorized automatic implementation or correction producer uses a fresh mapped execution in
   the same foreground Bridge run.
2. The single three-review-cycle sentence is replaced by two independent ceilings: at most three
   plan-review cycles in the human-started planner loop and, after plan pass, at most three
   implementation-review cycles in the automatic implementation loop. The automatic reviewer grant,
   task-artifact-write grant and prohibition, implementation-review grant and scope semantics, stop
   conditions, and authorization-versus-capability rule otherwise remain in force.
3. The sentence returning findings to "the current producer" is qualified: a human-started planner
   continues in its current session, while an automatic implementation correction uses a fresh
   mapped implementer execution in the same foreground transition.
4. The sentence allowing a producer that received findings to start its next review remains for the
   human-started skill loop; an adjacent sentence grants the Bridge the same next-review action after
   an automatic correction declaration.
5. The unconditional stop before changing producer role/host is replaced by a stop with only two
   named exceptions: the mapped plan-pass implementer transition and its mapped implementation
   correction executions. Every other producer role/host change still stops.
6. The unconditional automatic-implementer prohibition is replaced by the bounded affirmative grant
   above. No other role, host, or action becomes automatic.
7. A new positive automatic implementation write scope is added. The implementation-review scope is
   expanded separately so every automatic write and every product/policy edit in this task is visible
   to the implementation reviewer.

The committed `spartan-bridge/config.yaml` independently opts this repository into
`review_plan_pass -> implementer` with `dispatch: automatic`. A strict schema-1 parser accepts only
the documented transition keys and non-secret scalar values needed by this slice. The cases are
closed and evaluated only after a persisted passing plan review: an absent config or a valid
`dispatch: manual` returns that existing plan-review status unchanged — `state:
awaiting_implementer`, `verdict: pass`, `reason_code: review_passed` — after the task write advances
`next_role: implementer`; an unreadable file, schema/version/type error, unexpected key/value, YAML
alias/tag/merge behavior, or sensitive field is `config_invalid` and stops after that plan pass but
before any producer spawn; a valid `dispatch: automatic` without the exact repository grant is
`automatic_implementation_not_authorized` at the same post-review/pre-producer gate. Those hard
cases preserve the immutable passing plan-review record and return a separate transition stop
document. Config never supplies a host, model, launcher, command, environment variable, permission
grant, or credential.

The effective decision is the intersection: the exact repository grant, the exact automatic config,
the mapped implementer binding, and an adapter whose declared producer capability admits that role
and permission mode must all agree. An absent/manual config or unavailable implementer binding/
capability selects the existing manual post-pass transition without creating a producer-transition
record; malformed config or automatic config without authority is the hard policy stop defined
above. `doctor` reports the binding-relative capability result without claiming authentication or a
successful future run.

### D2 - The existing foreground `review` entrypoint owns the authorized successor chain

The first invocation remains the command the installed skill already uses:

```text
spartan-bridge review --repo <root> --task <task>
```

No `--after-run` is added to the first review of a producer phase. Plan findings still return to the
current planner session; after the planner revises the artifact, the skill invokes `review` with the
exact plan-review parent run id, as today. When a plan review passes, the CLI does not return an
implementer recommendation if D1 authorizes automatic dispatch. It runs a foreground successor
orchestrator that starts the implementer, validates D4's completion declaration, and starts a fresh,
unchained implementation review. If that review requests changes below the cycle ceiling, the
orchestrator starts a fresh implementer correction execution with those persisted findings and then
invokes the next implementation review using the exact changes-requested review run id as its
`--after-run` parent.

The two reviewer phases have independent budgets. Plan review starts at cycle 1 and may consume at
most three plan-review attempts. A passing plan closes that budget; the first implementation review
is a fresh unchained review at implementation cycle 1 with its own maximum of three. Plan-review
cycles never reduce the implementation-review budget. Only an implementation
`changes_requested` below cycle 3 starts a correction producer and a child implementation review;
`changes_requested` at cycle 3 stops at `cycle_limit_reached` without a fourth producer or review.

The CLI blocks until that foreground chain reaches implementation `pass` or a stop. It prints one
final JSON status document: the terminal review status when a reviewer ran, or the producer-transition
status when the chain stopped before the next reviewer. Progress on stderr distinguishes plan review,
implementer, and implementation review without exposing child prose, tool names, paths, credentials,
or raw output. Closing or killing the initiating process cancels its active child and does not promise
recovery; D5 leaves an ambiguous lock for human inspection.

### D3 - Producer execution is a separate writable capability of the mapped Cursor launcher

The adapter contract gains a producer interface distinct from `Adapter`'s review methods. The
existing registry still maps `(personal, cursor)` to its current launcher id; no user-local registry
migration or host-name inference is required. That launcher may advertise both its existing
read-only plan-review capability and a new `implementer` capability. Review capability validation
continues to require `workspace_write: false`; producer validation requires exactly the mapped
`implementer` role, a fresh context, and the runtime's workspace-write permission mode. A review
call can never reach producer methods solely because both capabilities share a launcher id.

The Cursor producer is spawned directly with an argument array, `--sandbox enabled`, `--trust`, the
explicit canonical repository workspace, and the model/effort from the `implementer` binding. It
receives a Bridge-owned prompt naming only the explicit task path, the approved plan-review run id,
its implementer role, the required checks-and-evidence obligation, D4's completion declaration, and
the human-only gates. The environment is the existing non-secret Cursor allowlist. Task content,
provider output, launcher commands, credentials, account data, and agent-suggested flags never become
process configuration. Producer stdout/stderr is bounded, redacted when retained, and never treated
as structured authority.

The positive automatic implementation write scope is closed and separate from policy/configuration
authority: `src/`, `tests/`, `docs/`, `skills/`, `agent-skill/skills/spbridge/SKILL.md`, `spartan/`,
`README.md`, `package.json`, `package-lock.json`, and `tsconfig.json`. `AGENTS.md` and
`spartan-bridge/config.yaml` are visible to implementation review but are not automatic write paths;
changing authority or automatic opt-in remains a human-started implementation task. The expanded
implementation-review scope is exactly the automatic write scope plus those two human-started paths,
so no automatic product edit and no product/policy edit in this task is hidden from review.

The adapter's enforced writable sandbox admits only that automatic scope and denies `.git/`,
`.spartan-bridge/`, `node_modules/`, machine-local paths, and every other repository path. Runtime
validation does not rely on that declaration alone. After acquiring D5's lock and persisting the
`producer_started` event, the Bridge captures (a) the existing repository snapshot over product
paths and (b) a separate ownership manifest for its contained `.spartan-bridge/` paths. The runtime
then performs no repository or runtime-state write until the child exits and both post-child captures
complete. Any product diff outside the automatic scope or any runtime ownership-manifest change is a
producer write violation; no runtime path is subtracted as an "expected" mutation. Only after those
checks does the Bridge persist `producer_finished`. `.git` content is never read or hashed by the
Bridge. This resolves runtime/product attribution without semantically inspecting edits.

### D4 - Hashes prove byte transitions; the producer declaration asserts readiness

The approved-plan hash is exactly the plan review run's `task_hash_after_write`, produced after the
Bridge persisted `pass`, advanced `next_role` to `implementer`, and retracted the consumed review
handoff. Before the producer starts, the runtime rereads the explicit task and `AGENTS.md`; the task
must still equal that approved hash and policy must still equal the pinned policy digest. This proves
only that the producer received the exact approved artifact bytes.

After the producer exits zero, the task hash must differ from the approved hash. That comparison
proves only that artifact bytes changed after the parent review write. It does not prove which product
files changed, that the plan was implemented, or that checks passed. Readiness for implementation
review is instead the producer's assertion: the regenerated artifact parses as `task_type:
implementation`, `phase: reviewing`, `current_role: implementer`, and `next_role: reviewer`, and its
`next_handoff_id`, advisory `Handoff`, prompt `(handoff HX-NNN)`, prompt role, and explicit task path
form one coherent implementation-review handoff. The runtime validates that structural envelope and
the D3 path diff, but performs no semantic inspection of the edits and does not re-run claimed checks
to admit the reviewer.

For a correction round, the implementation review run's persisted `task_hash_after_write` is the
parent boundary. The next producer must change those bytes and regenerate the same coherent
reviewer handoff before the runtime invokes `reviewer.implementation` with that exact parent run id.

### D5 - One foreground chain owns one fail-closed writer lock

Immediately before the first automatic implementer spawn, the runtime atomically acquires one
repository-contained lock under `.spartan-bridge/locks/` using the canonical repository identity and
a freshly generated transition id. It records only non-secret ownership metadata, holds the lock
across implementer and read-only implementation-review cycles, and releases it on every controlled
terminal path after active children have stopped. A second chain cannot start a writer while the lock
exists.

The runtime validates every lock path with the same containment discipline as run storage. A missing
lock directory may be created with private permissions; a symlink, file substitution, containment
failure, ownership mismatch, or already-held lock stops before producer spawn. An unclean process
exit may leave an ambiguous lock. Because crash recovery is out of scope, the next run reports the
transition id and requires human inspection instead of deleting or stealing that lock automatically.

### D6 - Producer transitions are first-class operational records without rewriting review history

Each automatic plan-pass transition receives a `transition-<uuid>` id and an immutable relationship
to the passing plan-review run, explicit task path, approved task hash, policy digest, implementer
identity, and writer-lock identity. A contained `.spartan-bridge/transitions/<id>/` record stores an
atomic `status.json` and append-only `events.jsonl` for authorization, lock acquisition, producer
start/finish, path validation, implementation-review dispatch/result, correction dispatches, and the
terminal stop. It stores no prompt, raw child output, task bytes, patch, credentials, account data, or
environment.

Review runs remain immutable review records under `.spartan-bridge/runs/`. The plan run and every
implementation-review run carry the additive transition id needed to traverse the relationship; a
new `transition-status`/`transition-events` CLI read surface resolves only canonical contained
transition ids. Existing `status`/`events` output for review run ids and existing reason meanings stay
compatible. New closed reason codes distinguish automatic config without authorization, invalid
config, approved artifact stale, writer lock unavailable, producer failure/timeout, write-scope or
runtime-state violation, producer declaration invalid, and cancellation. An absent/manual config or
unavailable implementer capability creates no transition and retains the existing manual
`review_passed` status rather than inventing a terminal failure.

An implementation `pass` terminates the transition `completed` and returns the reviewer status with
`next_role: human-operator`; any human/blocked verdict, cycle limit, stale input, policy drift,
adapter failure, invalid declaration, lock ambiguity, or unauthorized action terminates without
starting another role. The runtime never rewrites an already terminal review record to describe a
later phase.

### D7 - The skill reports the runtime's decision and never duplicates producer orchestration

The installed `/spbridge` skill keeps running the planner producer round in its current host and
invoking the CLI. It continues plan-review findings with `--after-run` exactly as today. When the CLI
reports an authorized automatic transition, the skill waits for and reports the CLI's final result;
it does not run `doctor`, recommend a fresh implementer session, spawn Cursor, maintain its own
producer counter, or synthesize transition policy.

When automatic dispatch is not selected because config is absent/manual or implementer capability
is unavailable, the runtime retains the passing plan review's existing manual result and the D1
matrix from task `0038` remains the fallback. A malformed/conflicting policy input produces D1's hard
stop and no recommendation. Once a producer has started, any failure is reported with its transition
id and no generic manual restart is recommended; the human must inspect the recorded stop. The
canonical skill is reinstalled for shared Codex and Cursor discovery, and live sessions that already
loaded old text must be replaced.

## Acceptance Criteria

- [x] D1: automatic plan-pass dispatch occurs only when the exact `AGENTS.md` grant, strict
      `spartan-bridge/config.yaml` automatic transition, mapped implementer binding, and producer
      capability all agree; absent/manual config or unavailable binding/capability preserves the
      existing manual post-pass result, while malformed config or automatic config without authority
      hard-stops only after the persisted plan pass and before any producer child, and config can
      never supply authority, provider selection, commands, environment, or secrets.
- [x] D1: the manual result is one exact compatible document — `state: awaiting_implementer`,
      `verdict: pass`, and `reason_code: review_passed` — while each hard config/policy case returns a
      separate post-review transition stop without mutating the passing plan-review record.
- [x] D1: tests and documentation pin the complete seven-part `AGENTS.md` edit set: all unchanged
      grants/prohibitions remain, human and automatic correction producers are distinguished, only
      the two named producer-role/host exceptions are added, plan and implementation ceilings are
      separate, and the automatic write scope and expanded implementation-review scope cannot
      contradict one another.
- [x] D1: `doctor` reports binding-relative implementer availability from the parsed binding,
      registry-selected launcher, producer capability, permission mode, and non-secret preflight;
      it does not infer from the host name or claim authentication, checks, or end-to-end readiness.
- [x] D2: one human-started `/spbridge` planner phase can execute up to three plan-review cycles,
      automatically enter implementation after `pass`, then start an independent fresh budget of up
      to three implementation-review cycles; plan cycles never consume implementation cycles, each
      correction uses only its exact same-kind `changes_requested` parent, and cycle-3 findings start
      neither a fourth producer nor a fourth review.
- [x] D2: the foreground CLI cancels an active child when interrupted, returns one unambiguous final
      JSON document, emits only Bridge-owned bounded progress on stderr, and makes no daemon,
      background survival, crash recovery, scheduling, or automatic stale-lock-recovery claim.
- [x] D3: review and producer capabilities are disjointly validated even when one launcher advertises
      both; the Cursor producer receives the canonical repo, mapped model/effort, sandboxed direct
      argv, non-secret allowlisted environment, and Bridge-owned task-scoped prompt in a fresh
      execution, while agent/task/provider text cannot add flags or commands.
- [x] D3: automatic producer progression requires exit zero and a product diff wholly contained by
      the exact positive automatic write scope; the expanded implementation-review scope contains
      that entire set plus human-started `AGENTS.md` and config edits, while automatic writes to those
      authority files remain forbidden.
- [x] D3: the runtime writes lock/start state before the pre-child captures, performs no repository
      or runtime-state write during the child window, captures again before `producer_finished`, and
      rejects every out-of-scope product diff or runtime ownership-manifest change without subtracting
      its own paths; the sandbox denies `.git`, runtime, dependency, machine-local, boundary-prefix,
      symlink, Unicode/case, file-kind, and add/delete/rename escapes without reading `.git` content.
- [x] D4: the pre-producer comparison pins the exact plan run's `task_hash_after_write` and pinned
      policy digest; the post-producer hash comparison is documented and tested as proof only that
      artifact bytes changed after that write, never as proof of implementation or checks.
- [x] D4: implementation review begins only from the producer assertion comprising the admitted
      implementation frontmatter plus one structurally coherent regenerated reviewer handoff; this
      check validates identifiers, role, and explicit path but does not semantically inspect edits or
      re-run the producer's claimed checks.
- [x] D5: one canonical repository has at most one automatic writer; lock acquisition is atomic and
      contained, controlled exits release only the caller's lock after stopping children, a competing
      or ambiguous/stale lock fails closed with its transition id, and no automatic lock theft or
      deletion exists.
- [x] D6: transition status/events persist authorization, hashes, identities, lock and phase outcomes,
      and linked review run ids with restrictive atomic storage while excluding prompts, raw child
      output, task/product bytes, patches, credentials, account data, and environment; contained
      read-only CLI commands retrieve only canonical transition ids.
- [x] D6: existing review run records remain immutable and compatible; every new failure maps to one
      closed state/reason, implementation `pass` completes at `human-operator`, and every stop listed
      by D6 prevents any later role dispatch.
- [x] D7: the skill delegates automatic producer selection and execution entirely to the runtime,
      preserves same-producer `--after-run` behavior and the task-0038 manual fallback, prints no
      implementer recommendation after a producer has started, and the refreshed installed skill is
      discoverable in fresh Codex and Cursor sessions.
- [x] D1-D7: README, architecture, routing, security, decisions, implementation plan, CLI help, and
      host-preauthorization guidance describe the same foreground authority, opt-in, hash/assertion,
      lock, adapter, status, cycle, fallback, and human-gate contract without claiming a daemon.
- [x] Repository check: `git diff --check`, `npm run typecheck`, `npm run build`, and `npm test` exit
      0, including deterministic fake producer/orchestrator cases and real Cursor argv/capability
      contract tests; no live provider call is required by the automated suite.

## Outcome

Completed. A human-started plan review can now continue in the same foreground Bridge run through
the explicitly authorized mapped Cursor implementer, automatic implementation-review cycles, and a
terminal implementation verdict. The runtime enforces the repository grant plus config opt-in,
approved-plan hash, exclusive writer lock, positive producer write scope, coherent producer
declaration, full guarded product/runtime comparisons, and fresh read-only reviewers. The final
manual correction review approved the real Cursor/POSIX guard lifecycle in cycle 2 of at most 3;
the remaining review cycle was not needed. All acceptance criteria are satisfied, all repository
checks pass, the installed host skill resolves to the refreshed portable package, and `doctor`
reports the planner reviewer, implementation reviewer, and implementer adapters available when run
in the real host environment.

## Work Completed

- The human authorized a fresh correction/review boundary after considering the read-only Sonnet second opinion: up to three new manual implementation-review cycles, no `--after-run`, Claude Sonnet 5 Thinking High via Cursor as implementer, and Codex Terra High as reviewer. This boundary is limited to the real pre-existing multi-link alias escape and the stale automation-flow statements in `docs/ROUTING-AND-WORKFLOWS.md`; it does not reopen D1-D7 or the already validated corrections.
- Manual implementation-review cycle 3 of 3 consumed `HX-009` in a fresh read-only Codex session and returned `CHANGES_REQUESTED`. The review sequence is exhausted. No further correction round, Bridge run, commit, push, skill installation, or follow-up task was started.
- Preserved the uncommitted task-0039 worktree, D1-D7, and every earlier correction (`SCOPE_GUARD_SYMLINK` / `SCOPE_GUARD_FILE_PARENT` from the formal Bridge cycle, and `SCOPE_GUARD_NEW_SYMLINK` / `APPROVED_POLICY_DIGEST_UNPINNED` / `TRANSITION_READ_SYMLINK_ESCAPE` from manual cycle 1). The pasted implementer prompt carried no handoff identifier; this round adopted artifact handoff `HX-008`, the manual reviewer round that followed cycle 1's fixes.
- Addressed the three manual-review-cycle-2 findings as one closed set, failing closed rather than narrowing detection:
  - `SANDBOX_ALLOW_DEFAULT`: replaced the Darwin `(allow default)` sandbox profile (which only added a narrow symlink-vnode denial on top of an otherwise-open default) with a fail-closed, positive-scope profile in `producerWriteScopeSandboxProfile`. The new profile denies every `file-write*` operation — creation, data, chmod/mode, unlink, rename, flags, and xattr alike — outside the exact admitted write-scope subpaths and files, resolved against the canonical (`fs.realpath`) repository root, so a same-UID `chmod`/mutation of the root, `.git`, `node_modules`, `.spartan-bridge`, `AGENTS.md`, `spartan-bridge/config.yaml`, a boundary-prefix sibling, or any machine-local path is denied identically to an out-of-scope write, while ordinary writes inside admitted directory scopes and the admitted exact file still succeed; a single `vnode-type SYMLINK` branch keeps denying symlink creation everywhere. `CursorAdapter.producerPreflight()` now also calls `verifySandboxExecInterface()`, which fails closed off Darwin and spawns a minimal `sandbox-exec` probe profile so a repository without a working `sandbox-exec` stops before any producer dispatch instead of spawning unconfined. New adversarial tests in `tests/producer-write-scope.test.ts` prove a direct outside write, a `chmod` of `AGENTS.md`, a `chmod` of the repository root, and a write under `node_modules` are all `EPERM` and leave bytes/modes unchanged, while an in-scope write still succeeds; a separate test proves ordinary admitted writes succeed across both a directory scope and an exact-file scope under the real sandbox. New `tests/cursor-adapter.test.ts` cases prove `producerPreflight()` probes both `cursor-agent` and `sandbox-exec` before any dispatch, fails closed when `sandbox-exec` is unavailable even though the `cursor-agent` probe passed, and fails closed off Darwin without spawning `sandbox-exec` at all. The post-child snapshot and the existing POSIX write guard are unchanged.
  - `TRANSITION_READ_PARENT_RACE`: `readContainedTransitionFile` in `src/runtime/transition-store.ts` no longer does a separate `lstat`-then-`open` sequence that left a window for a parent-directory replacement between the two syscalls. It now reuses `workspaceSafeOpenFlags()` from `src/core/workspace.ts` — the same Darwin `O_NOFOLLOW_ANY` whole-path no-follow mechanism the reviewer-workspace reader already relies on — for the single atomic `open`, requires the opened descriptor to stat as a regular file, and fails closed with `TransitionReadError("missing")` off Darwin (no per-component fallback) rather than duplicating a second, weaker constant. A new `tests/transition-store.test.ts` adds a `TransitionReadSeam` test-only hook that swaps the transition-id directory (and separately the whole `transitions/` root) for a symlink to an outside directory holding a planted secret, injected immediately before the atomic `open`; both reads fail closed as `missing` and the outside secret bytes are proven unread and unchanged. Existing containment/`not_contained` checks are preserved as defense in depth.
  - Documentation refresh: `README.md`'s status banner no longer claims review-cycle loops are unimplemented; it now names the D1-D7 foreground automatic implementer/implementation-review chain and its grant/opt-in gate, and narrows the adapter gap to Claude (Codex already has a real reviewer adapter). `docs/ROUTING-AND-WORKFLOWS.md`'s "Current manual producer transition" section is renamed "Manual producer transition (fallback)" and now frames the human-opened path as what happens when the automatic transition's two conditions are not both met, instead of asserting the human "still opens the producer phase in the first release." `docs/AUTHENTICATION-AND-SECURITY.md` and `docs/ARCHITECTURE.md` update their sandbox-exec descriptions to match the new fail-closed positive-scope profile (including that same-UID `chmod` is now denied, not a residual gap) and note the new preflight verification. `docs/DECISIONS.md`'s D-008 consequence, which flatly said Cursor remains a manual producer transition, is qualified to point at D-035's exact grant/opt-in condition instead of contradicting it.
- The formal three-cycle Bridge implementation-review chain remains exhausted. This round did not invoke Spartan Bridge, did not commit or push, and does not claim approval or completion.
- Host and model actually used for the prior corrections: Cursor, cursor-grok-4.6-high-fast, no user-selectable effort.
- Consumed `HX-010` (the fresh human-authorized correction boundary) in this round, adopting it into `handoff_id`. Addressed the two `HX-010` findings as one closed set, without reopening D1-D7 or any earlier correction:
  - `PRODUCER_SCOPE_HARDLINK_ESCAPE`: read the real Darwin second-opinion evidence first (recorded below) confirming that a creation-time `link(outside, admitted)` is already `EPERM` under the unchanged sandbox profile, because `link(2)` requires both endpoints to satisfy the same `deny file-write*` filter; only a *pre-existing* hard link under an admitted path was unguarded. Added `rejectWritableHardLinks` to `src/adapters/producer-write-scope.ts`, a new pre-pass in `applyProducerWriteScope` that runs after symlink rejection and exact-file-leaf existence checks but strictly before `ensureAdmittedDirectoryParents`/`lockTree` (i.e. before any chmod) and before the Cursor adapter ever reaches `startProducer`'s spawn call. It walks the full producer-visible tree (the same traversal shape as the existing symlink guard and mode-lock pass) and, for every regular file whose own relative path is "writable" per the existing `pathRemainsWritable` predicate (an admitted directory subpath or the admitted exact-file leaf, and never a denied tree such as `.git`, `node_modules`, or `.spartan-bridge`), rejects it with a new closed `ProducerWriteScopeError` code `"hardlink"` when `lstat` reports `nlink > 1`. Nothing has been chmod'd when this throws, so the existing `restoreProducerWriteScope` fail-closed cleanup in `applyProducerWriteScope`'s catch block runs as a no-op restore rather than needing new restoration logic. The Darwin sandbox profile (`producerWriteScopeSandboxProfile`) is unchanged, with a new comment explaining why the creation-time vector needs no profile rule and pointing at this pre-existing-alias guard. New regressions in `tests/producer-write-scope.test.ts` prove: a pre-existing hard link under an admitted directory scope (`src/`) is refused before any mutation, with the outside file's bytes and mode unchanged; a pre-existing hard link occupying the admitted exact-file leaf (`agent-skill/skills/spbridge/SKILL.md`) is refused the same way; a multi-link file inside a denied tree (`node_modules`) does not false-positive and ordinary admitted writes still succeed alongside it; and, under the real `sandbox-exec` profile, a confined child's `fs.linkSync` from an outside source into an admitted directory is already `EPERM` while an ordinary in-scope write still succeeds (the creation-time proof). A new regression in `tests/cursor-adapter.test.ts`, `"Cursor producer does not spawn when the write-scope guard fails closed on a pre-existing hard link"`, drives the same pre-existing alias through the actual `CursorAdapter.startProducer` path used by the transition orchestrator and proves zero spawn calls are recorded and the outside inode's bytes/mode stay unchanged, so the real producer/transition path cannot reach the alias. Every pre-existing regression (symlink escape, exact-file-parent widening, in-scope new-symlink, direct-outside/chmod denial, ordinary-write success, stale policy digest, transition symlink races) still passes unchanged.
  - `DOC_STALE_AUTOMATION_FLOW`: updated `docs/ROUTING-AND-WORKFLOWS.md` as one set. The state diagram's `ImplementationGate` now branches on `automatic (grant + opt-in + capability)` into `Implementing` versus `fallback (ungranted / manual / unavailable)` into a new `ManualImplementationGate` state that itself transitions to `Implementing` on `human starts producer`, instead of asserting the unconditional `human starts producer` edge. The plan-loop text's `pass -> awaiting human implementation gate` line is replaced with `pass -> automatic implementer (AGENTS.md grant + config opt-in + producer capability)` or the manual fallback, cross-referenced to the existing "Manual producer transition (fallback)" section. The "Required `AGENTS.md` structure" minimal three-host policy example now uses the same two named producer-role/host exceptions as the current root `AGENTS.md` ("except for the mapped plan-pass implementer transition and its mapped implementation correction executions"), distinguishes the human-started planner phase from a fresh mapped automatic-correction execution, separates the plan-review and implementation-review cycle ceilings into their own bullets, and qualifies the automatic-implementation-authorization bullet with the config opt-in and producer-capability conditions plus a link to the fallback section, mirroring root `AGENTS.md`'s "Spartan Bridge automation authority" bullets without duplicating every sentence of that longer section. No other section, decision, or prior correction in the document changed.
- This round did not invoke Spartan Bridge, did not use `--after-run`, did not commit or push, and does not claim approval or completion.
- Fresh correction-boundary manual review cycle 1 of at most 3 consumed `HX-011` in read-only Codex
  session `01a02b20-0d1b-7841-baa0-edbd847fabc2` and returned `CHANGES_REQUESTED` with one bounded
  finding: `OUT_OF_SCOPE_HARDLINK_MODE_MUTATION`. The admitted-path rejection is correct, but
  `lockTree` still chmods an out-of-scope multi-link regular file and can therefore change the mode
  of its external inode alias before producer spawn. The correction must preserve non-rejection for
  denied trees while skipping chmod on such aliased non-writable regular files, with a regression
  proving no producer spawn and unchanged outside bytes and mode. No other finding was reported.
- Fresh correction-boundary manual review cycle 2 of at most 3 consumed `HX-013` in read-only Codex
  session `01a02b2c-68d1-7e52-9b51-cb3e86b1cc01` and returned `CHANGES_REQUESTED`. It explicitly
  accepted the bounded hard-link correction: denied-tree multi-link files are neither rejected nor
  chmod'd, admitted aliases still reject before spawn, and the two regressions cover bytes, mode,
  and sandbox behavior. It found one pre-existing D3 issue outside the human-authorized correction
  boundary: `waitProducer()` restores the POSIX mode guard before `finishProducerRound()` takes its
  post-child product and runtime snapshots, violating D3's no-write window and potentially masking
  producer mode mutations. No correction was started because the current authorization is limited
  to the pre-existing hard-link escape and stale routing declarations.
- The human explicitly widened this correction boundary to include
  `D3_GUARD_RESTORE_BEFORE_POST_CAPTURE` and authorized using the third and final manual review.
  Claude Sonnet 5 Thinking High via Cursor remains the implementer and Codex Terra High remains the
  reviewer. This authorization does not reopen any other finding or permit `--after-run`.
- Fresh correction-boundary manual review cycle 3 of 3 consumed `HX-015` in read-only Codex session
  `01a02b72-652f-7791-976f-187882b2fdf0` and returned `CHANGES_REQUESTED`. The reviewer accepted
  the adapter split, mode-mutation observability, and the previously accepted hard-link correction,
  but found `D3_RUNTIME_WRITE_BEFORE_GUARD_RELEASE`: success and stop paths persist transition
  status/events under `.spartan-bridge` while the real Cursor guard still makes that tree
  non-writable. The authorized three-review sequence is exhausted, so no further correction,
  installation, commit, push, next-task selection, or dogfooding was started.
- The human authorized a new bounded correction/review sequence for only
  `D3_RUNTIME_WRITE_BEFORE_GUARD_RELEASE`, using Claude Sonnet 5 Thinking High via Cursor as
  implementer and up to three fresh Codex Terra High reviews. If approved, the task may be finalized,
  the skill reinstalled, and the completed task committed and pushed before next-task dogfooding.
- New-boundary manual review cycle 1 of at most 3 consumed `HX-017` in read-only Codex session
  `01a02b9a-7b51-71a3-8386-b0327c174193` and returned `CHANGES_REQUESTED` with
  `CURSOR_GUARD_RUNTIME_SNAPSHOT_CONFLICT`. It accepted the persistence-order refactor, the chflags
  success/stop regressions, and all hard-link protections, but proved that the production Cursor
  guard's Bridge-controlled chmods of `.spartan-bridge` necessarily differ between the pre-guard and
  guarded runtime snapshots and therefore falsely yield `runtime_state_violation` for a valid
  producer. The correction must distinguish only the exact guard-owned mode changes without
  subtracting arbitrary runtime paths and must use the real Cursor/POSIX guard in end-to-end success
  and terminal-stop regressions.
- Consumed `HX-012` in this round, adopting it into `handoff_id`, and corrected only
  `OUT_OF_SCOPE_HARDLINK_MODE_MUTATION` as one bounded change, without touching D1-D7, the Darwin
  sandbox profile, the already refreshed routing documentation, or any other file:
  - In `lockTree` (`src/adapters/producer-write-scope.ts`), the regular-file branch that previously
    called `applyMode` unconditionally now first checks `!writable && stat.isFile() && stat.nlink >
    1` and, when true, `continue`s to the next directory entry instead of chmod'ing. This is the
    exact and only functional change: the required non-rejection for a denied-tree multi-link
    regular file is unchanged (still no `ProducerWriteScopeError`), but the file's own directory
    entry inside the producer-visible tree is now left at whatever mode it already had, so a
    same-inode alias sitting outside the repository (e.g. under `.git`, `node_modules`, or
    `.spartan-bridge`) is never chmod'd through the admitted alias's own entry. A writable regular
    file (admitted directory subpath or exact-file leaf) is unaffected by the new branch and is
    still locked exactly as before; only a non-writable regular file with `nlink > 1` takes the new
    early `continue`. `rejectWritableHardLinks`'s pre-pass, the exact-file-leaf and symlink guards,
    the sandbox profile, and every directory's own mode-lock are unchanged.
  - Added one bounded regression at the guard level in `tests/producer-write-scope.test.ts`,
    `"a pre-existing hard link inside a denied tree is not rejected, is never chmod'd, and the
    sandbox still denies writing through it"`: a hard link from an outside file (mode `0o640`) into
    `node_modules/pkg/alias.js` is left in place before calling `applyProducerWriteScope(root,
    ["src/"])` directly. The test asserts the call resolves (no rejection solely for the denied-tree
    alias) and that both the outside file's and the alias's mode are unchanged immediately after the
    guard runs and before any restore, which is the only point at which the pre-fix `chmod` would
    have already executed (a subsequent `restoreProducerWriteScope` would otherwise mask the bug by
    restoring a mode it had itself changed). It then drives a real `sandbox-exec`-confined child
    through the alias path via the existing `runAttack` helper and asserts the write and a same-UID
    `chmod` through the alias both fail `EPERM` (defense in depth from the unchanged positive-scope
    profile, since `node_modules` is never an admitted path) while an ordinary in-scope write under
    `src/` still succeeds; after `restoreProducerWriteScope`, the outside file's mode and bytes are
    asserted unchanged again.
  - Added the same bounded regression through the real producer/adapter path in
    `tests/cursor-adapter.test.ts`, `"Cursor producer spawns normally on a denied-tree hard-link
    alias, never chmods it, and the sandbox still denies writing through it"`: the same outside
    file/`node_modules` alias setup is driven through the actual `CursorAdapter.startProducer` used
    by the transition orchestrator, with a runner that substitutes only the `cursor-agent` spawn
    with a real Node child running the same write/chmod/in-scope attack script under the adapter's
    own `sandboxProfile`. The test asserts exactly one spawn occurred (no rejection solely for the
    denied-tree alias) and that the outside file's and the alias's mode are unchanged immediately
    after `startProducer` returns and before `waitProducer`'s restore runs, then, after
    `waitProducer`, that the attack child's `alias-write` and `alias-chmod` attempts both observed
    `EPERM` (no producer write reached the outside bytes through that path) while the in-scope write
    succeeded, and that the outside file's mode and bytes remain unchanged at the end. The
    pre-existing admitted-path regressions in both files (`"a pre-existing hard link under an
    admitted directory scope is refused before mutation"`, `"a pre-existing hard link at the
    admitted exact-file leaf is refused before mutation"`, and `"Cursor producer does not spawn when
    the write-scope guard fails closed on a pre-existing hard link"`) and the existing
    `"a multi-link file inside a denied tree does not false-positive"` case are unchanged and still
    pass, together with every earlier cycle's regression.
  - This round did not invoke Spartan Bridge, did not use `--after-run`, did not commit or push, and
    does not claim approval or completion.
- Consumed `HX-014` in this round, adopting it into `handoff_id`, and corrected only
  `D3_GUARD_RESTORE_BEFORE_POST_CAPTURE` as one bounded change, without touching D1-D7, the accepted
  hard-link corrections, the Darwin sandbox profile, or the refreshed routing documentation:
  - Added a new `releaseProducerWriteScope(): Promise<void>` method to the `ProducerAdapter` contract
    (`src/adapters/adapter.ts`, both the type and the `isProducerAdapter` capability guard). This is
    now the single runtime-controlled restoration point: it is documented as callable only after the
    caller has finished both post-child captures and their validation, on every success, stop, error,
    timeout, and cancellation path.
  - `CursorAdapter.waitProducer()` (`src/adapters/cursor.ts`) no longer restores the write-scope guard
    in its own `finally`. It now only awaits the child handle and reports `{ exitCode, timedOut }`,
    leaving every locked mode exactly as the child left it. `CursorAdapter.releaseProducerWriteScope()`
    is new and does exactly what the old `finally` did (`restoreProducerWriteScope(this.producerWriteGuard)`
    then clear the field), so it is idempotent and safe to call defensively more than once.
    `startProducer`'s own two failure paths (guard application failure, spawn failure) are unchanged:
    both already restore-and-clear synchronously before throwing, so no locked state can leak past a
    failed `startProducer` call. `FakeAdapter` (`src/adapters/fake.ts`) gained a matching no-op
    `releaseProducerWriteScope` since it has no real guard, preserving the interface and call ordering
    for orchestration tests.
  - `finishProducerRound` (`src/core/transition.ts`) now wraps everything from immediately after the
    abort-listener registration through its `return null` in one `try/finally`, whose `finally` calls
    `adapter.releaseProducerWriteScope()` exactly once per round. This guarantees the guard is released
    only after both post-child snapshots (`productAfter`/`runtimeAfter`) are captured and every
    subsequent check has run (`waitResult.timedOut`, `waitResult.exitCode`, the runtime-ownership diff,
    the product write-scope diff, task-byte readability, the hash-after comparison, and the producer
    declaration), on every one of that function's return paths: success, `producer_failure` (both the
    inner `startProducer`/`waitProducer` catch and the post-capture `exitCode !== 0` case),
    `producer_timeout`, `cancelled`, `runtime_state_violation`, `write_scope_violation`,
    `task_unreadable`, `producer_declaration_invalid` (both cases), and the `mapProducerCaptureError`
    catch around the post-child snapshot itself. The pre-existing per-round `cleanupProducer()` call
    that previously ran only on the success path immediately before `return null` was removed as
    redundant now that release is centralized in the `finally`; `cleanupProducer()` still runs once for
    the whole chain in `continueAfterPlanReview`'s own outer `finally` exactly as before, and still
    calls the same restore internally, which is now an ordinary no-op there since the guard has already
    been cleared by the per-round release.
  - Updated the pre-existing regression in `tests/cursor-adapter.test.ts` (renamed from "...restores
    after wait" to "...defers restoration until explicitly released") to assert the guard is still
    locked (`AGENTS.md` at `0o444`, the repository root at `0o555`) immediately after `waitProducer()`
    returns, and that only an explicit `releaseProducerWriteScope()` call restores `AGENTS.md`'s
    original mode.
  - Added a new regression, `"a producer mode mutation inside the admitted scope survives waitProducer
    and is only reverted by the runtime-controlled release"`, in `tests/cursor-adapter.test.ts`: creates
    `src/ok.ts` at mode `0o444` (deliberately missing the owner-write bit, so the guard's lock pass
    actually changes its mode to `0o644` and records a real restore point), spawns a real Node child in
    place of `cursor-agent` — confined by the adapter's own real Darwin sandbox profile exactly as the
    genuine producer path is — that `chmod`s the file to `0o777`, and asserts the mode is still `0o777`
    immediately after `waitProducer()` returns (the exact point at which the pre-fix code would already
    have reverted it to `0o444` and masked the mutation) and only becomes `0o444` after
    `releaseProducerWriteScope()` is called. This is the direct proof that a producer mode mutation is
    visible to post-child validation rather than masked by restoration.
  - Added a new regression in `tests/transition.test.ts`, `"releaseProducerWriteScope is invoked once
    per producer round after wait and before cleanup"`: drives the real successor chain (plan pass then
    one producer round then implementation-review pass) through `mutatingProducer`, wraps
    `startProducer`/`waitProducer`/`releaseProducerWriteScope`/`cleanupProducer` to record call order,
    and asserts the exact sequence `startProducer > waitProducer > releaseProducerWriteScope >
    cleanupProducer`, pinning that the runtime — not the adapter's own wait step — controls guard
    release timing.
  - Every earlier cycle's regression (producer-visible symlink rejection, exact-file-parent widening,
    in-scope new-symlink, direct-outside/chmod denial, ordinary-write success, the admitted-path and
    denied-tree hard-link cases and their no-spawn/no-chmod regressions, stale policy digest, transition
    symlink races, and every `transition.test.ts` write-scope/runtime-violation/cycle-limit case) still
    passes unchanged.
  - This round did not invoke Spartan Bridge, did not use `--after-run`, did not commit or push, and
    does not claim approval or completion.
- Consumed `HX-016` in this round, adopting it into `handoff_id`, and corrected only
  `D3_RUNTIME_WRITE_BEFORE_GUARD_RELEASE` as one bounded change, without touching D1-D7, the accepted
  hard-link corrections, the Darwin sandbox profile, or the refreshed routing documentation:
  - Restructured `finishProducerRound` (`src/core/transition.ts`) around a new private helper,
    `runGuardedRound`, that performs every post-child capture and every scope/runtime/hash/declaration
    check that must run while the guard may still be active, but never itself writes a transition
    record: it only returns a plain `GuardedRoundOutcome` (`{ kind: "success" }` or
    `{ kind: "stop"; reason: ReasonCode }`) for the caller to persist afterward. This is the exact and
    only functional change: `finishProducerRound` now wraps the call to `runGuardedRound` in a
    `try/finally`, and the `finally` calls `input.adapter.releaseProducerWriteScope()` exactly once —
    on the success path, every stop path returned by `runGuardedRound`, and any error thrown out of it
    — strictly before any subsequent `emitTransition`/`stopTransition` call. Only after that release
    does `finishProducerRound` call `stopTransition` for a `"stop"` outcome, or the two `emitTransition`
    calls (`path_validated` then `producer_finished`) for a `"success"` outcome. The pre-existing
    pre-child capture failure path (`mapProducerCaptureError` around `snapshotTree`/
    `snapshotRuntimeOwnership` before the guard could ever be applied) and the pre-guard
    `signal?.aborted` check are unchanged, since no guard is active yet on those paths. Every check
    `runGuardedRound` performs — `startProducer`/`waitProducer` failure, the post-child snapshot
    capture, `signal?.aborted`, `waitResult.timedOut`, `waitResult.exitCode !== 0`, the runtime-ownership
    diff, the product write-scope diff, the task-byte read, the hash-after comparison, and the producer
    declaration validation — is the same logic `finishProducerRound` previously ran inline, moved
    verbatim into the helper and converted from direct `stopTransition`/`return` calls into returning a
    `GuardedRoundOutcome` instead. No adapter, sandbox profile, hard-link guard, or routing/documentation
    file changed.
  - Added two new integration regressions in `tests/transition.test.ts` that drive the real successor
    orchestration (`runReviewThenSuccessor`) through a new `ChflagsBridgeLockAdapter` (a thin `FakeAdapter`
    subclass). Its `startProducer` recursively applies the real macOS `chflags uchg` immutable flag to
    the repository's `.spartan-bridge` directory before delegating to `FakeAdapter.startProducer`, and its
    `releaseProducerWriteScope` clears that flag (`chflags -R nouchg`) before delegating to the inherited
    no-op. This is a real, OS-enforced, additional-privilege lock exercised through the exact
    `startProducer`/`releaseProducerWriteScope` seam `finishProducerRound` uses, so a transition write
    attempted while it is active fails with a genuine `EPERM`/`EACCES`, exactly as it would under the real
    Cursor write-scope guard's own POSIX-mode lock. `chflags` was chosen over driving the real
    `CursorAdapter`/`applyProducerWriteScope` guard directly because that guard's `chmod` of
    `.spartan-bridge` changes the `mode` field `snapshotRuntimeOwnership` captures, which independently
    trips `runtime_state_violation` on the very first post-child snapshot comparison regardless of this
    fix — a separate, pre-existing latent interaction between the real guard and the runtime-ownership
    snapshot, outside this bounded correction's authorized scope. `chflags` changes no field
    `snapshotTree`/`snapshotRuntimeOwnership` record, so it isolates the write-ordering regression from
    that unrelated issue while still exercising a real, OS-level non-writable `.spartan-bridge` during the
    guarded window:
    - `"a real chflags-locked .spartan-bridge is released before the runtime persists a successful
      producer_finished record"`: the producer mutate hook calls `declareImplementationReady`, producing
      a coherent implementation-ready task. Asserts the chain reaches `outcome.kind === "review"` with
      `outcome.status?.reason_code === "review_passed"` and `outcome.transition?.state === "completed"`,
      and that the transition's `events.jsonl` contains both `path_validated` and `producer_finished`.
      Manually re-broke the fix (moved `releaseProducerWriteScope()` to after `stopTransition`/
      `emitTransition` on both paths) and re-ran this test to confirm it fails with a real
      `EPERM: operation not permitted, open '.../.status.json.<pid>.tmp'` thrown from
      `writeTransitionStatusAtomic`, then restored the fix and confirmed it passes again.
    - `"a real chflags-locked .spartan-bridge is released before the runtime persists a terminal stop
      record"`: the producer mutate hook writes an out-of-scope `secret.txt` at the repository root
      (leaving `.spartan-bridge` chflags-locked and the task bytes unchanged), which the post-capture
      product diff detects as `write_scope_violation` while `.spartan-bridge` is still locked. Asserts
      `outcome.transition?.reason_code === "write_scope_violation"` and that the transition's
      `events.jsonl` ends with a `terminal_stop` event in state `stopped`. This test failed with the same
      real `EPERM` when the fix was manually reverted, confirming it exercises the terminal-stop
      persistence ordering as well as the success path.
  - Removed the now-unused `createLauncherCatalog`/`CURSOR_EXECUTABLE`/`CursorAdapter`/
    `CURSOR_LAUNCHER_ID`/`SANDBOX_EXEC_EXECUTABLE`/`ProcessRunner` imports from `tests/transition.test.ts`
    that an earlier, discarded draft of these regressions (driving the real `CursorAdapter` guard
    directly) had added; the final regressions use only the existing `FakeAdapter`/`testDeps` pattern
    already used throughout this file, plus `node:child_process`/`node:util` for `chflags`.
  - Every earlier cycle's regression (producer-visible symlink rejection, exact-file-parent widening,
    in-scope new-symlink, direct-outside/chmod denial, ordinary-write success, the admitted-path and
    denied-tree hard-link cases and their no-spawn/no-chmod regressions, stale policy digest, transition
    symlink races, mode-mutation observability, the guard-release-ordering regression from `HX-014`, and
    every other `transition.test.ts` write-scope/runtime-violation/cycle-limit case) still passes
    unchanged.
  - This round did not invoke Spartan Bridge, did not use `--after-run`, did not commit or push, and
    does not claim approval or completion.
- Consumed `HX-018` in this round, adopting it into `handoff_id`, and corrected only
  `CURSOR_GUARD_RUNTIME_SNAPSHOT_CONFLICT` as one bounded change, without touching D1-D7, any accepted
  hard-link correction, the Darwin sandbox profile, or the refreshed routing documentation:
  - Root cause confirmed by reading `applyProducerWriteScope`/`lockTree` (`src/adapters/producer-write-scope.ts`)
    against the pre-existing call order in `finishProducerRound`/`runGuardedRound`
    (`src/core/transition.ts`): the pre-child `productBefore`/`runtimeBefore` snapshots were captured
    *before* `adapter.startProducer()` applied the real Cursor POSIX guard, so those baselines recorded
    the unguarded modes of `.spartan-bridge` and every product path. `startProducer()` then chmod's the
    repository into its locked state as part of applying the guard, and the post-child
    `productAfter`/`runtimeAfter` snapshots were necessarily captured while that guard was active. The
    diff therefore always contained the guard's own deterministic mode transitions on top of whatever
    the producer actually did, so `snapshotRuntimeOwnership`'s mode field turned every real Cursor
    producer round into a false `runtime_state_violation` regardless of producer behavior; the same
    mechanism could equally have produced a false product diff for any product path the guard touches.
    This is the single shared root cause the prior chflags regressions could not exercise, since
    `chflags` changes no field either snapshot function records.
  - The correction re-derives product and runtime capture as one set relative to the guard, not by
    excluding any path: a new `ProducerAdapter.lockProducerWriteScope(repoRoot, writeScope):
    Promise<void>` method (added to the interface and its `isProducerAdapter` guard in
    `src/adapters/adapter.ts`) lets the runtime apply the real write-scope guard *before* either
    pre-child snapshot is taken, so both `productBefore` and `runtimeBefore` already reflect the locked
    state. `CursorAdapter.lockProducerWriteScope()` (`src/adapters/cursor.ts`) calls the existing
    `applyProducerWriteScope()` and stores the resulting `ProducerWriteScopeGuard`; it is idempotent
    (a no-op if a guard is already held) so a caller that skips the explicit pre-lock still gets correct
    behavior. `CursorAdapter.startProducer()` now calls `this.lockProducerWriteScope()` itself when no
    guard is held yet, preserving direct callers that spawn without a separate lock step.
    `FakeAdapter.lockProducerWriteScope()` (`src/adapters/fake.ts`) is a no-op, matching its existing
    no-op guard behavior and keeping every deterministic fake-adapter test unchanged.
  - `runGuardedRound` (`src/core/transition.ts`) now calls `input.adapter.lockProducerWriteScope(...)`
    immediately after the `signal?.aborted` check and strictly before `snapshotTree`/
    `snapshotRuntimeOwnership` for `productBefore`/`runtimeBefore`. `startProducer`/`waitProducer` and
    every post-child capture, timeout/exit-code check, the runtime-ownership diff, the product
    write-scope diff, the task-byte read, the hash comparison, and the producer-declaration validation
    are otherwise unchanged: both snapshots are still full, unfiltered captures of every runtime and
    product path, so a producer mutation to `.spartan-bridge` or any product path the guard also
    touches remains just as observable as before — only the *baseline* moved to after the guard's own
    modes are already fixed, so the guard's own transitions cancel out of the before/after comparison on
    both sides instead of appearing as a one-sided change. `finishProducerRound`'s existing
    `try/finally` around `runGuardedRound` and its exactly-once `releaseProducerWriteScope()` call,
    persisting a success or stop record only after that release, are unchanged from the `HX-016`
    correction.
  - Added two new end-to-end regressions in `tests/transition.test.ts` that drive the real
    `CursorAdapter` and the real Darwin `sandbox-exec`/POSIX guard through `runReviewThenSuccessor`,
    using a custom `LauncherCatalog` that resolves the mapped implementer launcher to `CursorAdapter`
    while plan review and implementation review keep using `FakeAdapter`, and a custom `ProcessRunner`
    that stubs only the `cursor-agent --help` and `sandbox-exec` capability probes while replacing the
    actual `cursor-agent` producer spawn with a `node -e "<script>"` command run under the adapter's own
    real `sandboxProfile`:
    - `"a real Cursor POSIX write-scope guard does not falsely flag a valid producer success as a
      runtime or product violation"`: the substituted producer script writes only an in-scope file and
      regenerates a coherent implementation-ready task via the existing declaration helper. Asserts the
      chain reaches `outcome.kind === "review"` with `reason_code: review_passed` and
      `transition.state === "completed"`, and that no `runtime_state_violation` or
      `write_scope_violation` event appears anywhere in the transition's `events.jsonl`. Before the fix
      (baseline captured pre-guard, comparison captured post-guard), this exact test fails with
      `runtime_state_violation` from the guard's own `.spartan-bridge` mode changes; with the fix it
      passes.
    - `"a real Cursor POSIX write-scope guard persists a genuine producer stop after release without a
      false runtime or product violation"`: the substituted producer script makes the same valid
      in-scope write but deliberately leaves the task file's frontmatter/handoff incoherent (no
      `next_role: reviewer` regeneration), so the producer-declaration check must be the one that stops
      the round. Asserts `transition.reason_code === "producer_declaration_invalid"`, that the
      transition's `events.jsonl` ends with a `terminal_stop` in state `stopped`, and — critically — that
      no `runtime_state_violation` or `write_scope_violation` event precedes it, proving the fix does not
      mask a genuine stop behind a guard-mode false positive and does not swallow a real declaration
      error either.
  - `tests/helpers.ts`'s `validAgentsMd`/`autoAgentsWithCursorProducer` fixture now uses a narrower
    `automaticWriteScope` of existing directory paths (`src/`, `tests/`, `docs/`, `spartan/`) for the new
    CursorAdapter-backed tests, because the default scope's exact-file entries
    (`README.md`/`package.json`/etc.) are not created by `makeRepo()` and the real
    `applyProducerWriteScope()` — unlike `FakeAdapter`, which never calls it — fails closed with
    `exact_file_missing` on a genuinely absent exact-file leaf. This does not change any existing test's
    fixture value; it only supplies the new real-guard tests with a scope every path of which already
    exists in the fixture repository.
  - Every earlier cycle's regression (producer-visible symlink rejection, exact-file-parent widening,
    in-scope new-symlink, direct-outside/chmod denial, ordinary-write success, the admitted-path and
    denied-tree hard-link cases and their no-spawn/no-chmod regressions, stale policy digest, transition
    symlink races, mode-mutation observability, and both `HX-016` chflags persistence-ordering
    regressions) still passes unchanged; the chflags regressions remain in place as an independent,
    OS-level proof of the release-ordering guarantee they were written for, separate from this round's
    guard/snapshot-baseline correction.
  - This round did not invoke Spartan Bridge, did not use `--after-run`, did not commit or push, and
    does not claim approval or completion.

## Evidence

- Read-only Sonnet second opinion, 2026-08-22: `SECOND_OPINION_MIXED`. Real Darwin `sandbox-exec` probes refuted the prior reviewer's creation-time mechanism: `link(outside, admitted)` is already `EPERM` because both link endpoints must satisfy the existing `file-write*` filter. The second opinion reproduced the actual residual escape: a pre-existing hard link under an admitted path can mutate its out-of-repository inode alias. It confirmed the documentation finding and recommended a pre-mutation `stat.nlink > 1` refusal scoped only to writable admitted regular files, with directory-scope, exact-file, denied-tree, creation-vector, and end-to-end regressions.
- Manual implementation-review cycle 3 of 3, fresh Codex session `01a02a07-dc26-7410-acdd-2d91f00faba0`, 2026-08-22: `CHANGES_REQUESTED`. Read-only inspection found `PRODUCER_SCOPE_HARDLINK_ESCAPE` and `DOC_STALE_AUTOMATION_FLOW`; `git diff --check` and `npm run typecheck` passed. The reviewer could not independently run the fixture-writing suite because its read-only sandbox returned `EPERM` from `mkdtemp`; it did not treat that as a product-test failure.
- `git diff --check`, 2026-08-22 (prior round): exit 0.
- `npm run typecheck`, 2026-08-22 (prior round): exit 0 (`tsc --noEmit`).
- `npm run build`, 2026-08-22 (prior round): exit 0 (`tsc`).
- `npm test`, 2026-08-22 (prior round): exit 0; `ℹ tests 322` `ℹ pass 322` `ℹ fail 0`. New or finished cases that round: the sandbox denies a direct outside write and same-UID chmod of protected repository paths (`AGENTS.md`, repository root, `node_modules`) while an in-scope write still succeeds; ordinary admitted writes succeed across a directory scope and an exact-file scope under the real sandbox; producer preflight probes both `cursor-agent` and `sandbox-exec` before any dispatch; producer preflight fails closed when `sandbox-exec` is unavailable even though `cursor-agent` probes fine; producer preflight fails closed off Darwin without spawning `sandbox-exec`; a transition-directory replacement raced in immediately before the atomic open cannot leak outside bytes; a transitions-root replacement raced in immediately before the atomic open cannot leak outside bytes.
- `git diff --check`, 2026-08-22 (this round): exit 0.
- `npm run typecheck`, 2026-08-22 (this round): exit 0 (`tsc --noEmit`).
- `npm run build`, 2026-08-22 (this round): exit 0 (`tsc`).
- `npm test`, 2026-08-22 (this round): exit 0; `ℹ tests 327` `ℹ pass 327` `ℹ fail 0`. New cases this round, all in `producer-write-scope.test.ts` unless noted: "a pre-existing hard link under an admitted directory scope is refused before mutation"; "a pre-existing hard link at the admitted exact-file leaf is refused before mutation"; "a multi-link file inside a denied tree does not false-positive"; "the writable sandbox already denies creating a hard link from an outside source into admitted scope" (proves the creation-time vector under the real, unchanged sandbox profile); and, in `cursor-adapter.test.ts`, "Cursor producer does not spawn when the write-scope guard fails closed on a pre-existing hard link" (proves the actual `CursorAdapter.startProducer` path used by the transition orchestrator cannot reach a pre-existing alias). Every earlier cycle's regression (symlink escape, exact-file-parent widening, in-scope new-symlink, direct-outside/chmod denial, ordinary-write success, stale policy digest, transition-directory/status/events symlink races) still passes unchanged.
- Approved plan review remains `run-9aa88da2-de7b-479f-b838-59c09a3743ca`. Parent implementation review is `run-24b3b30c-5582-4e69-9de1-6be7944a2be3`. This round did not invoke Spartan Bridge, did not use `--after-run`, and did not commit or push.
- Fresh correction-boundary manual review cycle 1 of at most 3, Codex session
  `01a02b20-0d1b-7841-baa0-edbd847fabc2`, 2026-08-22: `CHANGES_REQUESTED` with
  `OUT_OF_SCOPE_HARDLINK_MODE_MUTATION`. `git diff --check` and `npm run typecheck` passed. The
  read-only sandbox prevented fixture-writing `npm test` cases with expected `mkdtemp` `EPERM`; the
  reviewer did not treat that as a product-test failure.
- Fresh correction-boundary manual review cycle 2 of at most 3, Codex session
  `01a02b2c-68d1-7e52-9b51-cb3e86b1cc01`, 2026-08-22: `CHANGES_REQUESTED` with
  `D3_GUARD_RESTORE_BEFORE_POST_CAPTURE`. `npm run typecheck` and `git diff --check` passed. The
  read-only sandbox again prevented fixture-writing `npm test` cases with expected `mkdtemp`
  `EPERM`; the reviewer did not treat that as a product-test failure.
- `git diff --check`, 2026-08-22 (this round, `HX-012` correction): exit 0, no output.
- `npm run typecheck`, 2026-08-22 (this round): exit 0 (`tsc --noEmit`).
- `npm run build`, 2026-08-22 (this round): exit 0 (`tsc`).
- `npm test`, 2026-08-22 (this round): exit 0; `ℹ tests 329` `ℹ pass 329` `ℹ fail 0`. New cases this
  round: `tests/producer-write-scope.test.ts` `"a pre-existing hard link inside a denied tree is not
  rejected, is never chmod'd, and the sandbox still denies writing through it"`; and
  `tests/cursor-adapter.test.ts` `"Cursor producer spawns normally on a denied-tree hard-link alias,
  never chmods it, and the sandbox still denies writing through it"`. Every earlier cycle's
  regression (symlink escape, exact-file-parent widening, in-scope new-symlink,
  direct-outside/chmod denial, ordinary-write success, admitted-path hard-link refusal and its
  no-spawn regression, the pre-existing denied-tree non-false-positive case, stale policy digest,
  transition symlink races) still passes unchanged.
- Approved plan review remains `run-9aa88da2-de7b-479f-b838-59c09a3743ca`. Parent implementation
  review is `run-24b3b30c-5582-4e69-9de1-6be7944a2be3`. This round did not invoke Spartan Bridge, did
  not use `--after-run`, and did not commit or push.
- Fresh correction-boundary manual review cycle 2 of at most 3, Codex session
  `01a02b2c-68d1-7e52-9b51-cb3e86b1cc01`, 2026-08-22: `CHANGES_REQUESTED` with
  `D3_GUARD_RESTORE_BEFORE_POST_CAPTURE`, reproduced above. The human then explicitly widened the
  correction boundary to include this finding for a third and final manual review.
- `git diff --check`, 2026-08-22 (this round, `HX-014` correction): exit 0, no output.
- `npm run typecheck`, 2026-08-22 (this round): exit 0 (`tsc --noEmit`).
- `npm run build`, 2026-08-22 (this round): exit 0 (`tsc`).
- `npm test`, 2026-08-22 (this round): exit 0; `ℹ tests 331` `ℹ pass 331` `ℹ fail 0`. New cases this
  round: `tests/cursor-adapter.test.ts` `"Cursor producer write-scope guard locks authority paths and
  defers restoration until explicitly released"` (updated from `"...restores after wait"`) and
  `"a producer mode mutation inside the admitted scope survives waitProducer and is only reverted by
  the runtime-controlled release"`; `tests/transition.test.ts` `"releaseProducerWriteScope is invoked
  once per producer round after wait and before cleanup"`. Every earlier cycle's regression (symlink
  escape, exact-file-parent widening, in-scope new-symlink, direct-outside/chmod denial, ordinary-write
  success, admitted-path hard-link refusal and its no-spawn regression, the denied-tree non-false-
  positive and no-chmod cases, stale policy digest, transition symlink races, and every write-scope/
  runtime-violation/cycle-limit case in `transition.test.ts`) still passes unchanged.
- Fresh correction-boundary manual review cycle 3 of 3, Codex session
  `01a02b72-652f-7791-976f-187882b2fdf0`, 2026-08-22: `CHANGES_REQUESTED` with
  `D3_RUNTIME_WRITE_BEFORE_GUARD_RELEASE`. `git diff --check` and `npm run typecheck` passed. The
  read-only sandbox prevented fixture-writing tests with expected `mkdtemp` `EPERM`; the reviewer
  did not treat that as a product-test failure.
- Approved plan review remains `run-9aa88da2-de7b-479f-b838-59c09a3743ca`. Parent implementation
  review is `run-24b3b30c-5582-4e69-9de1-6be7944a2be3`. This round did not invoke Spartan Bridge, did
  not use `--after-run`, and did not commit or push.
- `git diff --check`, 2026-08-22 (this round, `HX-016` correction): exit 0, no output.
- `npm run typecheck`, 2026-08-22 (this round): exit 0 (`tsc --noEmit`).
- `npm run build`, 2026-08-22 (this round): exit 0 (`tsc`).
- `npm test`, 2026-08-22 (this round): exit 0; `ℹ tests 333` `ℹ pass 333` `ℹ fail 0`. New cases this
  round, both in `tests/transition.test.ts`: `"a real chflags-locked .spartan-bridge is released before
  the runtime persists a successful producer_finished record"` and `"a real chflags-locked
  .spartan-bridge is released before the runtime persists a terminal stop record"`. Both regressions
  were confirmed to fail with a real `EPERM` from `writeTransitionStatusAtomic` when the guard-release
  ordering fix was manually and temporarily reverted, then confirmed to pass again once the fix was
  restored (this manual revert/restore was not committed and is not part of the diff under review).
  Every earlier cycle's regression (symlink escape, exact-file-parent widening, in-scope new-symlink,
  direct-outside/chmod denial, ordinary-write success, admitted-path hard-link refusal and its no-spawn
  regression, the denied-tree non-false-positive and no-chmod cases, stale policy digest, transition
  symlink races, mode-mutation observability, and the `HX-014` guard-release-ordering regression) still
  passes unchanged.
- Approved plan review remains `run-9aa88da2-de7b-479f-b838-59c09a3743ca`. Parent implementation
  review is `run-24b3b30c-5582-4e69-9de1-6be7944a2be3`. This round did not invoke Spartan Bridge, did
  not use `--after-run`, and did not commit or push.
- New-boundary manual review cycle 1 of at most 3, fresh read-only Codex session
  `01a02b9a-7b51-71a3-8386-b0327c174193`, 2026-08-22: `CHANGES_REQUESTED` with
  `CURSOR_GUARD_RUNTIME_SNAPSHOT_CONFLICT`. The reviewer accepted the persistence-order refactor,
  both chflags persistence regressions, and the hard-link protections. It found that the real Cursor
  POSIX guard changes `.spartan-bridge` modes after the pre-guard runtime snapshot but before the
  guarded post-child snapshot, so the Bridge's own exact mode changes falsely produce
  `runtime_state_violation`. `git diff --check` and `npm run typecheck` passed. The read-only sandbox
  prevented fixture-writing tests with expected `mkdtemp` `EPERM`; the reviewer did not treat that
  as a product-test failure. The minimum correction is to distinguish only exact guard-owned mode
  transitions, without excluding arbitrary runtime paths or hiding producer mutations, and prove
  the production Cursor/POSIX guard path end to end for both success and terminal-stop persistence.
- Approved plan review remains `run-9aa88da2-de7b-479f-b838-59c09a3743ca`. Parent implementation
  review is `run-24b3b30c-5582-4e69-9de1-6be7944a2be3`. This round did not invoke Spartan Bridge, did
  not use `--after-run`, and did not commit or push.
- `git diff --check`, 2026-08-22 (this round, `HX-018` correction): exit 0, no output.
- `npm run typecheck`, 2026-08-22 (this round): exit 0 (`tsc --noEmit`).
- `npm run build`, 2026-08-22 (this round): exit 0 (`tsc`).
- `npm test`, 2026-08-22 (this round): exit 0; `ℹ tests 335` `ℹ pass 335` `ℹ fail 0`. New cases this
  round, both in `tests/transition.test.ts` and both driving the real `CursorAdapter` and real Darwin
  `sandbox-exec`/POSIX write-scope guard through `runReviewThenSuccessor`: `"a real Cursor POSIX
  write-scope guard does not falsely flag a valid producer success as a runtime or product
  violation"` and `"a real Cursor POSIX write-scope guard persists a genuine producer stop after
  release without a false runtime or product violation"`. Every earlier cycle's regression
  (producer-visible symlink rejection, exact-file-parent widening, in-scope new-symlink,
  direct-outside/chmod denial, ordinary-write success, the admitted-path and denied-tree hard-link
  cases and their no-spawn/no-chmod regressions, stale policy digest, transition symlink races,
  mode-mutation observability, and both `HX-016` chflags persistence-ordering regressions) still
  passes unchanged.
- Manually and temporarily reverted the fix in `src/core/transition.ts` (removed the
  `lockProducerWriteScope` call preceding the pre-child snapshots, restoring the pre-fix ordering in
  which the real Cursor guard is applied only inside `startProducer`, after `productBefore`/
  `runtimeBefore` are already captured) and re-ran only the two new end-to-end tests via
  `node --import tsx --test --test-name-pattern="real Cursor POSIX write-scope guard"
  tests/transition.test.ts`. Both failed as expected: the valid-success case asserted
  `outcome.kind === "review"` but observed `"transition"` with `reason_code: "runtime_state_violation"`;
  the terminal-stop case expected `reason_code: "producer_declaration_invalid"` but observed
  `"runtime_state_violation"`, confirming the guard's own pre-fix mode-change ordering masks the real
  stop reason as well as the success case. Restored the fix, confirmed `git diff` for
  `src/core/transition.ts` showed no residual change (it is an untracked new file, `git status
  --porcelain` reported only `?? src/core/transition.ts`), and re-ran both tests to confirm they pass
  again. This revert/restore cycle was not committed and is not part of the diff under review.
- New-boundary manual review cycle 2 of at most 3, fresh read-only Codex Terra High session
  `01a02bb3-85b3-7132-8fcc-7d0e011c95d2`, 2026-08-22: `MANUAL_REVIEW_APPROVED`, with no findings.
  The reviewer confirmed that the guard is acquired before both full pre-child snapshots, remains
  active through both post-child snapshots and every validation, and releases before transition
  persistence; it also accepted the real Cursor/POSIX success and declaration-invalid regressions
  and confirmed that the hard-link protections, sandbox profile, routing documentation, and D1-D7
  remain intact. `git diff --check` and `npm run typecheck` passed in the review session. Its
  read-only sandbox prevented `npm run build` from writing `dist/` and prevented `npm test` fixtures
  from using `mkdtemp`; those expected `EPERM` results were not treated as product failures.
- Final writable-host checks, 2026-08-22: `git diff --check` exit 0; `npm run typecheck` exit 0
  (`tsc --noEmit`); `npm run build` exit 0 (`tsc`); external-host `npm test` exit 0 with `ℹ tests
  335`, `ℹ pass 335`, and `ℹ fail 0`. An initial nested-sandbox test attempt produced nine exit-71
  `sandbox-exec: sandbox_apply: Operation not permitted` failures; repeating the same suite outside
  that outer sandbox exercised all Darwin cases successfully and is the authoritative test result.
- `./agent-skill/scripts/manage-install.sh install all`, 2026-08-22: exit 0; the canonical
  `/Users/example/.agents/skills/spbridge` and `/Users/example/.claude/skills/spbridge`
  installations were already present and resolve to the refreshed portable package.
- External-host `node dist/cli/main.js doctor --repo
  /path/to/agent-spartan-protocol-bridge`, 2026-08-22: exit 0; repository
  readable, policy configured/resolves, registry schema valid, all launchers resolved, and
  `reviewer.plan`, `reviewer.implementation`, and `implementer` each report `adapter available`.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-9aa88da2-de7b-479f-b838-59c09a3743ca execution_id=exec-8642fdc3-378e-433a-be50-b7d8bdde5d29 review_kind=plan verdict=pass reason_code=review_passed host=cursor launcher=cursor-plan-reviewer-v1 model=cursor-grok-4.6-high-fast effort=high model_observed=declared_unobserved policy_digest=sha256:8c6d3a4883d80ad20ae76298efa931aa0b90536f6e3ec15c401631a0d90e5288 task_hash=sha256:6041dc7c4d6bd4b8504bb111f918850acf43db36aac42b3f1919af8cc010fdb1 agents_hash=sha256:ca1bb93a4a6aa25b46e7a11e4bdc04a2f0ae81d05a4fb4a4e61659a17282f9b1 timestamp=2026-08-22T10:58:21.804Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: CHANGES_REQUESTED

Findings:

- `SCOPE_GUARD_SYMLINK` (error): `applyProducerWriteScope` silently skips every pre-existing symlink. A symlink placed under an admitted directory such as `src/` can target a writable path outside the repository; the producer can modify that target while the repository symlink remains unchanged, so neither the guard nor the post-child snapshot detects it. Fail closed on symlinks in the producer-visible tree (or otherwise ensure they cannot resolve outside the admitted canonical path) before spawning.
- `SCOPE_GUARD_FILE_PARENT` (error): For the exact-file scope `agent-skill/skills/spbridge/SKILL.md`, the guard marks all parent directories writable via `isStrictAncestorOfScope`. The producer can therefore create, delete, or rename arbitrary siblings in `agent-skill/skills/spbridge/`, although those paths are outside the positive scope. Snapshotting detects the violation only after the write and does not enforce the promised sandbox. Keep ancestors non-writable when the admitted leaf already exists, and fail closed or use a narrower mechanism when creating a missing single-file leaf is required.

Bridge run: run_id=run-24b3b30c-5582-4e69-9de1-6be7944a2be3 execution_id=exec-d198d7aa-0671-460d-ac09-52e2f1d14c33 review_kind=implementation verdict=changes_requested reason_code=review_changes_requested host=codex launcher=codex-plan-reviewer-v1 model=gpt-5.6-terra effort=high model_observed=declared_unobserved policy_digest=sha256:a87802e6639f0b051a993cd2cad0d8b035a8b5ef64288ea1ab2f2f83500480b9 task_hash=sha256:c87d5b45b031ad649642dfd14d304e4b0f54c9a6ed79c2735e1732360b1f8d68 agents_hash=sha256:01e3a595bc00218413a14f2aa56edd8b8ad9b8d568e891455e8f73a02bd02822 timestamp=2026-08-22T11:55:44.710Z
<!-- spartan-bridge:review:implementation:end -->

### Final manual implementation review

Verdict: CHANGES_REQUESTED

Cycle: 3 of 3 (manual review limit exhausted)

Findings:

- `PRODUCER_SCOPE_HARDLINK_ESCAPE` (error): the Darwin profile admits every `file-write*` operation through an admitted directory and denies only symlink vnode creation. A producer can create a hard link inside an admitted directory such as `src/` to a same-volume out-of-scope regular file, then mutate the shared inode's bytes or mode through the admitted alias. The POSIX guard and post-child repository snapshot do not prevent the outside mutation. The positive write-scope boundary must prevent hard-link creation/aliasing, with a regression proving an outside target's bytes and mode stay unchanged.
- `DOC_STALE_AUTOMATION_FLOW` (error): `docs/ROUTING-AND-WORKFLOWS.md` still maps plan `pass` unconditionally to `awaiting human implementation gate` and its required-policy example retains the unconditional producer-role/host stop. Both statements contradict the authorized foreground automatic transition described later in the same document and must be refreshed as a set.

This verdict is manual review evidence, not a Spartan Bridge review record. The formal Bridge chain and the separately authorized manual review sequence are both exhausted.

### Fresh correction-boundary manual implementation review

Verdict: CHANGES_REQUESTED

Cycle: 1 of at most 3

Findings:

- `OUT_OF_SCOPE_HARDLINK_MODE_MUTATION` (error): the guard correctly does not reject a multi-link
  file outside the admitted writable predicate, but `lockTree` then applies `chmod` to every
  non-writable regular file. A pre-existing alias under `node_modules/`, `.git/`,
  `.spartan-bridge/`, or another out-of-scope path can therefore change an external inode's mode
  through the Bridge before producer spawn. Preserve the required non-rejection for denied trees,
  but do not chmod an aliased non-writable regular file; add an external-alias regression asserting
  no spawn/rejection and unchanged outside bytes and mode.

This verdict is manual review evidence from fresh read-only Codex session
`01a02b20-0d1b-7841-baa0-edbd847fabc2`, not a Spartan Bridge review record.

Cycle 2 verdict: CHANGES_REQUESTED

Findings:

- `D3_GUARD_RESTORE_BEFORE_POST_CAPTURE` (error): `CursorAdapter.waitProducer()` restores every
  POSIX mode guard before `finishProducerRound()` takes its post-child product and runtime captures.
  This violates D3's explicit no-write window and can mask producer mode mutations. The minimum
  correction is to defer guard restoration until after both post-child snapshots and scope/runtime
  validation, preserve restoration on every terminal path, and add an ordering regression.

The reviewer explicitly accepted the bounded hard-link correction. This D3 finding lies outside the
human-authorized correction boundary and therefore requires a human scope decision before work can
continue. This verdict is manual review evidence from fresh read-only Codex session
`01a02b2c-68d1-7e52-9b51-cb3e86b1cc01`, not a Spartan Bridge review record.

Cycle 3 verdict: CHANGES_REQUESTED

Findings:

- `D3_RUNTIME_WRITE_BEFORE_GUARD_RELEASE` (error): `finishProducerRound()` keeps the real Cursor
  guard active through validation, but then calls `emitTransition()` or `stopTransition()` before
  the `finally` releases it. The guard makes `.spartan-bridge` non-writable, while those functions
  must create/rename `status.json` and append `events.jsonl` there. A real producer can therefore
  validate successfully and then fail to persist `path_validated` / `producer_finished`; terminal
  stop paths have the same ordering defect. The minimum correction is to complete captures and
  validation while guarded, release exactly once, and only then persist success or stop records,
  with a real/equivalent locking integration regression for success and terminal paths.

The reviewer accepted the adapter split, mode-mutation observability, and hard-link correction. This
is the third and final authorized manual review. The review limit is exhausted. This verdict is
manual review evidence from fresh read-only Codex session
`01a02b72-652f-7791-976f-187882b2fdf0`, not a Spartan Bridge review record.

### D3 runtime-write correction review

Verdict: CHANGES_REQUESTED

Cycle: 1 of at most 3

Findings:

- `CURSOR_GUARD_RUNTIME_SNAPSHOT_CONFLICT` (error): the real Cursor producer guard recursively
  changes modes under `.spartan-bridge` before the post-child runtime capture. Because
  `snapshotRuntimeOwnership()` records modes, comparing the pre-guard baseline with that guarded
  capture necessarily classifies the Bridge's own mode changes as `runtime_state_violation`, even
  for a producer that made no runtime mutation. The chflags regressions deliberately avoid changing
  the captured POSIX modes and therefore do not prove the production Cursor path. Distinguish the
  exact Bridge-controlled guard mode changes from producer mutations without subtracting arbitrary
  runtime paths, and add end-to-end CursorAdapter/POSIX-guard regressions proving that a valid
  success and a terminal stop both reach persistence after guard release without an artificial
  runtime-state violation.

The reviewer accepted the persistence-after-release refactor and all hard-link protections. This
verdict is manual review evidence from fresh read-only Codex session
`01a02b9a-7b51-71a3-8386-b0327c174193`, not a Spartan Bridge review record.

Cycle 2 verdict: APPROVED

Findings:

- None.

The reviewer confirmed the corrected guard/snapshot lifecycle, both real Cursor/POSIX regressions,
exactly-once release before persistence, complete unfiltered product/runtime comparison, and the
unchanged accepted hard-link, sandbox-profile, documentation, and D1-D7 behavior. This verdict is
manual review evidence from fresh read-only Codex Terra High session
`01a02bb3-85b3-7132-8fcc-7d0e011c95d2`, not a Spartan Bridge review record. The correction boundary
passed in cycle 2 of at most 3; cycle 3 was not used.

## Blockers

None.

## Next Action

None. Task 0039 is complete. After its authorized commit and push, pending Spartan tasks may be
ranked and the selected next task may dogfood the newly shipped foreground automatic transition in a
fresh unchained Bridge planner run.

## Next Handoff

No outstanding handoff. Task 0039 is closed.
