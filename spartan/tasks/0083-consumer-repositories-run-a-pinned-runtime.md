---
protocol: "1.1.0" # x-release-please-version
id: consumer-repositories-run-a-pinned-runtime
created_at: 2026-09-12
status: active
phase: implementing
task_type: implementation
risk: material
current_role: human-operator
next_role: implementer
updated_at: 2026-09-13
handoff_id: HX-008
next_handoff_id: HX-009
---

# Consumer repositories run a pinned runtime, and every run names its build

## Objective

Every repository on the operator's machine runs a pinned Bridge build that no
in-flight development can change, while this checkout stays free to edit `src/`
without blocking or silently altering anyone else's round. A round that must
exercise the development build is selected through the operator's own
environment, on `PATH`, and no repository can displace a runtime that `PATH`
resolves. Every run record names the
runtime build that produced it, so an observation made in a consumer repository
can be tied to a specific Bridge version when it becomes a task here.

## Context

There is exactly one runtime on the operator's machine, and it is this
development checkout. `spartan-bridge` on `PATH` is an `npm link` chain:

```text
spartan-bridge -> <node prefix>/lib/node_modules/spartan-bridge -> <this checkout>/dist/cli/main.js
```

Two consequences, both observed on 2026-09-12 while task `0068` was in flight:

- **Every other repository is blocked.** The moment a task here edits `src/`,
  `staleBuildMessage` refuses `review` and `mcp-stdio` in *every* repository,
  because the guard resolves `src/` and `dist/` relative to the package root it
  is executing from, and that root is this checkout. A `/spbridge` round in an
  unrelated repository stops on a build state it has no part in and cannot fix
  from where it is.
- **Rebuilding is worse than the block.** Once the operator rebuilds to unblock,
  consumer repositories begin executing a `dist/` compiled from a half-finished
  implementer round. On 2026-09-12 a chain in another repository ran against
  exactly such an intermediate build.

The stale-build guard is not the defect. It exists so that the runtime being
audited matches the source that was read, and it should keep doing that here.
The defect is that one checkout is simultaneously the development tree and the
installed product.

The operator's stated working mode makes the separation load-bearing rather
than cosmetic: improve the Bridge in one window while another window exercises
it in production, and open tasks here from what that production use reveals.
That loop needs the production side to be a fixed, nameable build.

Three facts verified in this checkout before this task was written, which
together mean the separation is mostly packaging and reporting rather than new
guard logic:

- `package.json` `files` does not include `src`, so an installed copy carries no
  `src/` tree. `bin` is `{"spartan-bridge": "./dist/cli/main.js"}`, which the
  tarball does ship.
- `isBuildStale` (`src/cli/main.ts:408-416`) returns `false` when
  `newestSourceMtime` is `undefined`, and `staleBuildMessage`
  (`src/cli/main.ts:418-433`) produces that `undefined` when the package root
  has no `src` directory. So an installed, `src`-less copy never reports a stale
  build. `tests/cli.test.ts:676` and `tests/cli.test.ts:1229` already pin
  `isBuildStale(undefined, ...) === false`.
- There is no way to ask which build is running. `spartan-bridge --version`
  prints `error: missing command`, the `--help` command list has no version
  entry, and no run or transition document carries a runtime build field —
  `StatusDocument` and `TransitionStatusDocument` record `schema_version` and
  `policy_digest`, which describe the document and the policy, not the binary.

## Scope

- `package.json`
  - No manifest edit is required by D1: `npm pack` already excludes `src`. The
    `scripts.postbuild` entry gains the build stamp step (D3).
- `src/build/stamp.ts` (new)
  - The build-time stamp writer, compiled by `tsc` and run from `dist/`.
- `src/runtime/build-info.ts` (new)
  - `readRuntimeBuild(packageRoot)`, the runtime-side reader.
- `src/core/contracts.ts`
  - The `RuntimeBuild` record; the additive `runtime_build` field on
    `StatusDocument` (`:570-601`) and `TransitionStatusDocument` (`:532-552`);
    the additive `emitting_build` field on `EventDocument` (`:605-621`) and
    `TransitionEventDocument` (`:555-568`); and the comment at each field
    stating which of the two builds it names.
- `src/core/serialize.ts`
  - `serializeStatus` (`:55`), `serializeEvent` (`:90`),
    `serializeTransitionStatus` (`:204`), and `serializeTransitionEvent`
    (`:229`), sharing one normalizing serializer for the new record.
    `canonicalPolicyJson` (`:30`) is unchanged.
- `src/core/review.ts`
  - `AppDeps` (`:78-91`) gains the optional `runtimeBuild` seam; the initial
    `StatusDocument` construction at `:226` sets `runtime_build`; the `emit`
    helper's event construction (`:1017-1034`) sets `emitting_build` from
    `deps.runtimeBuild`, not from the run status.
- `src/core/transition.ts`
  - The initial `TransitionStatusDocument` at `:457`, `emptyTransition` at
    `:1167`, and `emitTransition`'s event construction (`:1236-1248`), which
    takes `emitting_build` from `deps.runtimeBuild` the same way.
- `src/composition.ts`
  - `createProductionDeps` (`:52`) accepts the resolved build.
- `src/cli/main.ts`
  - `main` (`:433`) resolves the build once beside the existing `packageRoot`
    and passes it to both `createProductionDeps` call sites (`:475`, `:481`).
    The `staleBuildMessage` block itself is unchanged.
  - `formatReviewStartedLine` (`:123-126`) gains the build rendering.
- `src/core/task-write.ts`
  - The `Bridge run:` composer (`:586`) gains the build rendering. The line's
    existing fields keep their spelling and order.
- `src/cli/detach.ts` (D3)
  - The detached chain composes its own `terminal_stop` event for an interrupted
    run, outside `emit` and `emitTransition`, so it sets `emitting_build` from
    `deps.runtimeBuild` the same way they do. Without it the one event written
    on the interrupted path would be the only event with no emitter.
- `src/runtime/store.ts` (D3)
  - Event reads stop casting a parsed line to `EventDocument` and route through
    `parseEventJson`, so the normalize-to-`null` rule reaches a persisted event
    with a missing or malformed build record. This is what makes that criterion
    true on the read path rather than only in the serializer.
- `src/cli/parse.ts`
  - The `--version` / `-v` special case beside the existing `--help` / `-h`
    case (`:33-35`), and `HELP_TEXT` (`:274-300`).
- `src/core/doctor.ts`
  - `DoctorReport` (`:86-117`) and `formatDoctorReport` (`:621-638`).
- `docs/RUNTIME-PROMOTION.md` (new)
  - The two-runtime setup: what a consumer repository installs, how a build is
    promoted from this checkout to that install, and how to run this checkout's
    own build deliberately.
- `docs/DECISIONS.md`
  - One dated entry, `D-078`. `D-077` is the current highest.
- `README.md`
  - The install section (`:62-79`), the update section (`:126-137`), the
    dogfooding paragraph (`:409-427`), and the Documentation list (`:437-447`).
- Tests: `tests/spbridge-package.test.ts` (D4), `tests/cli.test.ts`,
  `tests/doctor.test.ts`, `tests/serialize.test.ts`, `tests/parse.test.ts`,
  `tests/review.test.ts`, `tests/transition.test.ts`,
  `tests/task-write.test.ts`. Two further test files carry the same change
  rather than new coverage: `tests/helpers.ts` (D3), whose shared `testDeps`
  seam gains an optional `runtimeBuild` so existing fixtures keep compiling, and
  `tests/adapter-failure.test.ts` (D3), whose serialized-document key-order pin
  gains `emitting_build`.

## Out of Scope

- Weakening, gating, or making per-repository the stale-build guard itself. It
  is correct; the separation removes the reason it fires across repositories.
- Publishing the package to a public registry, or any release, tag, or version
  bump not required by the promotion procedure.
- `AGENTS.md` and `spartan-bridge/config.yaml`, so this plan declares no human
  implementer for its repository work. The machine-local install step is a
  human action by nature and is documented, not automated.
- `.gitignore`. It is outside the automatic write scope, and D1 avoids needing
  a `*.tgz` entry by packing outside the repository.
- Retrofitting a build identifier onto run records already written.
- Editing `agent-skill/skills/spbridge/SKILL.md`. Its runtime selection stays as
  it is; D2 rejects every workspace-content predicate that would change it.
- The `0082` tilde-rule hygiene failure, which is pre-existing and has its own
  task.
- The `spbridge-summary` projector's field allowlist, which does not carry the
  build either. That skill is installed from a different repository, so no round
  of this task can edit it whatever this plan says; it is tracked separately.
  The consequence is stated rather than hidden: a redacted summary pasted into a
  session in another repository still cannot name the build until that skill
  changes.

## Constraints

- English artifact.
- No credential, account identifier, absolute home path under a real user, or
  client-context alias other than `personal` / `default` enters the repository.
  The documented procedure names a placeholder home path.
- The Bridge must not acquire a version string from a provider, a credential
  store, or any authentication state. A build identifier is repository-owned
  data.
- `SCHEMA_VERSION` handling follows the established additive-field precedent if
  D3 adds a document field.
- The build stamp must be written under `dist/`, never under `src/`. A file
  written under `src/` after `tsc` emits would make `newestFileMtime("src")`
  exceed the `dist/cli/main.js` mtime and leave the checkout permanently stale.
- A root `scripts/` directory is outside the automatic implementation write
  scope, so build tooling this task adds lives under `src/`.
- No content the reviewed repository controls may displace a runtime that
  `PATH` resolves. `AGENTS.md` reserves policy, permissions, locks, and events
  to the runtime; a workspace that could displace a resolvable runtime would
  choose the enforcer before enforcement begins. The skill's pre-existing
  last-resort fallback, which runs a workspace-local `dist/cli/main.js` only
  when `PATH` resolves nothing, is bounded by D2 rather than covered by this
  constraint: it displaces no runtime, because there is none to displace.
- `agent-skill/skills/spbridge/SKILL.md` and `tests/spbridge-skill.test.ts` are
  not edited by this task, so the two literals that file pins at `:168` and
  `:169` keep matching unchanged.
- `npm run typecheck` / `npm run build` clean; `npm test` no new failure against
  the `main` baseline, which currently carries the one pre-existing
  `repo-hygiene` tilde failure tracked by `0082`.

## Decisions

- **D1 — the pinned install is a packed tarball installed globally.**

  The promotion procedure runs from this checkout, with the tarball written
  outside the repository. Every command below is run by the operator, one per
  block, in the order given. Seven steps: six commands and one decision.

  Steps 1, 2 and 3 are prerequisites of everything that follows. Step 4 is the
  human decision, not a command. Steps 5, 6 and 7 perform and confirm the
  promotion.

  Working directory is this checkout's root for steps 1, 2, 3 and 5 — the four
  that read the repository. Step 6 may run from any directory, and step 7 runs
  wherever the operator wants to ask which build `PATH` resolves.

  Step 1 installs dependencies from the lockfile:

  ```text
  ######## RUN ON TERMINAL ################
  npm ci
  ######## END OF RUN ON TERMINAL ########
  ```

  Step 2 builds, which also writes the build stamp through `postbuild`:

  ```text
  ######## RUN ON TERMINAL ################
  npm run build
  ######## END OF RUN ON TERMINAL ########
  ```

  Step 3 runs the tests. It is deliberately not chained to anything:

  ```text
  ######## RUN ON TERMINAL ################
  npm test
  ######## END OF RUN ON TERMINAL ########
  ```

  **Step 4 is the promotion gate, and it is a human decision.** Continue only
  when that run shows no failure other than the accepted baseline, which the
  documentation names. Any other failure stops the promotion.

  **Why the gate is a decision and not `&&`.** `npm test` exits non-zero today:
  `main` carries one accepted failure, the `repo-hygiene` tilde case tracked by
  task `0082`. Chaining the packing to the tests would block every promotion
  until that task lands, and forcing it past with `|| true` would hide a real
  regression behind the accepted one. Neither is a gate. What the operator has
  to decide — "is this the failure we already know about, or a new one?" — is a
  judgement, so the procedure asks for it in words and names the accepted
  baseline so the judgement has something to compare against. That baseline is a
  dated fact about `main`, not a constant: when `0082` lands it becomes zero
  failures, and the documentation says so rather than leaving "one failure is
  fine" standing forever.

  Step 5 packs, writing the tarball to a directory outside the repository:

  ```text
  ######## RUN ON TERMINAL ################
  npm pack --pack-destination <a directory outside the repository>
  ######## END OF RUN ON TERMINAL ########
  ```

  Step 6 installs that tarball globally:

  ```text
  ######## RUN ON TERMINAL ################
  npm -g install <the tarball written by step 5>
  ######## END OF RUN ON TERMINAL ########
  ```

  Step 7 confirms the promotion landed:

  ```text
  ######## RUN ON TERMINAL ################
  spartan-bridge --version
  ######## END OF RUN ON TERMINAL ########
  ```

  **Why step 7 is not decoration.** The tarball's file name carries a version
  that does not change between promotions. `--version` prints `commit` and
  `built_at` as well, so it is what distinguishes the build just packed from the
  one already installed. A `built_at` older than step 2's build means the
  promotion did not land, whatever the install reported.

  **Presentation.** This procedure and `docs/RUNTIME-PROMOTION.md` both follow
  the repository convention without exception: the prerequisite and the order
  explained before each command, and exactly one command between the
  `RUN ON TERMINAL` markers, prerequisites included. An earlier draft of this
  decision argued the documentation could carry the substance without the
  markers, on the ground that they delimit a handover inside a session. That
  argument is withdrawn: the convention states that every command the human runs
  appears alone in its own marked block, the same draft asserted markers it did
  not use, and a decision whose text contradicts its own example is worse than
  either choice it was deciding between.

  It installs into the same global slot the current `npm link` occupies,
  `<node prefix>/lib/node_modules/spartan-bridge`, replacing the symlink with a
  real directory. `npm -g uninstall spartan-bridge` followed by `npm link` from
  this checkout reverses it.

  **Why the tarball and not a second pinned clone.** A clone linked from a
  pinned commit keeps a git identity, but it also keeps a `src/` tree in the
  global package root. The guard would stay armed there, and any operation that
  restamps a file under that `src/` — a `git checkout`, a `stash`, an editor
  save — re-blocks every repository on the machine. The tarball has no `src/`
  by construction, which is exactly the fail-open `isBuildStale` already pins.
  The git identity a clone would have provided is recovered by D3 instead, and
  recovered in a better place: inside the run record rather than only on disk.

  **Why `--pack-destination`.** `npm pack` writes into the current directory by
  default. `.gitignore` has no `*.tgz` entry and is outside the automatic write
  scope, so a default pack would leave an untracked file in the worktree — a
  file a concurrent review can attribute as a write. Packing outside the
  repository removes the question instead of adding an ignore rule.

  `private: true` blocks `npm publish`, not `npm pack` or a global install from
  a tarball; the packaging path this decision takes is unaffected by it.

  **Who executes what.** The implementer delivers the documented procedure and
  the tests that prove its packaging premise. It does not run `npm -g install`:
  that writes outside the repository, outside every automatic write scope, and
  is the human gate Blockers already records. Acceptance for this task
  therefore tests only what is testable inside the repository — that a packed
  tarball carries no `src/`, and that packing writes nothing into the worktree
  — and leaves the global install to the operator.

- **D2 — the skill's runtime selection is unchanged; a development runtime is
  selected outside every repository, on `PATH`.**

  This task does not edit `agent-skill/skills/spbridge/SKILL.md`. Step 4 keeps
  preferring the `spartan-bridge` executable on `PATH` and keeps its existing
  missing-from-`PATH` fallback, word for word.

  **What that guarantees, and the one exception it does not cover.** While
  `PATH` resolves `spartan-bridge`, no repository — this one included — can
  displace it. That is the whole of the guarantee, and an earlier draft of this
  decision overstated it as "no repository can nominate the binary", which the
  fallback contradicts.

  The exception is pre-existing and bounded: when `PATH` resolves nothing, step
  4 runs the workspace's own `dist/cli/main.js`. This task neither introduces
  nor widens it. It is a different case from the workspace predicate the
  `UNTRUSTED_RUNTIME` finding rejected, and the difference is the whole reason
  one is acceptable and the other was not: the rejected predicate would have run
  workspace content *instead of* a resolvable pinned runtime, bypassing an
  enforcer that was present; the fallback runs only when no pinned runtime
  exists to bypass. Its failure mode is a workspace without a Bridge installed,
  where the alternative is not a safer runtime but no runtime at all.

  After D1 the exception is also rarer than it is today: promotion puts a real
  install in the global slot, so `PATH` resolves on any machine where the
  operator has promoted once.

  **How a Bridge round exercises the development build.** The operator selects
  it where the operator already has authority: the environment of one shell.
  `docs/RUNTIME-PROMOTION.md` documents a development shell that prepends to
  `PATH` a directory the operator owns, outside every repository, holding a
  `spartan-bridge` shim that execs `node <checkout>/dist/cli/main.js`. Inside
  that shell a round runs the development build and the stale-build guard
  measures the checkout under review, which is the case the guard is for. Every
  other shell — and therefore every other repository, and this one by default —
  resolves `spartan-bridge` to the pinned install. Closing the shell reverses
  it, and no repository file records it.

  **What this changes, completely.** One thing changes: which build the global
  slot holds, because D1 replaces the `npm link` symlink with a pinned tarball
  install. What stays the same: the skill's selection rule, its fallback
  sentence, `tests/spbridge-skill.test.ts`, the stale-build guard, and the fact
  that a round's runtime is chosen before any repository content is read.

  **The residual, and why D3 is in the same task.** The operator can forget to
  open the development shell, and then a round in this checkout exercises the
  pinned build. Nothing errors: the pinned install carries no `src/`, so the
  guard correctly fails open. That is the reason the build identifier is not a
  separate task — `spartan-bridge --version`, the `doctor` `runtime:` line, and
  the `runtime_build` on every run record are what make the mistake visible
  after the fact.

  **Rejected: a workspace-declared predicate.** Cycles 2 and 3 developed the
  rule that a workspace whose `package.json` `name` is `spartan-bridge` and
  which ships a `dist/cli/main.js` runs that file. The `UNTRUSTED_RUNTIME`
  finding is accepted and this decision does not reopen it: the predicate reads
  content the reviewed repository controls, so repository content would select
  the control plane before the runtime enforces policy, permissions, locks, or
  reviewer read-only behavior — all of which `AGENTS.md` reserves to the
  runtime. That a matching workspace already runs its own declared checks
  bounds the blast radius but is not an equivalent guarantee, and an ambiguity
  in what a round is allowed to execute must fail closed.

  **Rejected: an environment variable naming a runtime path.** It is anchored
  outside repository content and would satisfy the trust requirement, but it
  gives every host a second runtime-selection path to implement and get wrong,
  and it makes a portable skill read machine-local state. The same operator
  choice expressed on `PATH` needs no skill change at all.

- **D3 — the build identifier is a repository-owned record stamped at build
  time; a run document names the build that created the run, an event names the
  build that wrote the line.**

  **Produced.** `scripts.postbuild` runs `node dist/build/stamp.js` before the
  existing `chmod`, writing `dist/build-info.json`. The writer is
  `src/build/stamp.ts`, compiled by `tsc` like the rest of `src/`; it lives
  under `src/` because a root `scripts/` is outside the write scope. It reads
  `git rev-parse HEAD` and `git status --porcelain`, and records `null` rather
  than failing when git is unavailable or the tree is not a checkout. It writes
  only under `dist/`, so the stamp cannot make the checkout stale, and `dist/`
  is already git-ignored while `files` ships `dist/**`.

  **The stamp reads git without writing it.** Both invocations carry
  `GIT_OPTIONAL_LOCKS=0` in their environment. `git status --porcelain`
  otherwise refreshes the stat cache in `.git/index` and may take
  `.git/index.lock`, which is a write. That matters beyond tidiness: a producer
  round's write scope excludes `.git`, and the plan requires the implementer to
  run `npm run build` (C33), so without this the build the implementer must run
  would itself write a path its scope refuses. The variable is the documented
  way to ask git for a read that takes no lock, it is set per invocation rather
  than exported, and it does not change either value recorded.

  **Why the implementer may run the build, and why `dist/` appears in the
  plan-target advisory.** Writing `dist/` is authorized, and not because no
  round writes it by hand — that would be an argument about intent, and the
  guard measures writes. `dist/` is classified as **producer scratch**:
  `PRODUCER_DEFAULT_BUILD_SCRATCH_PREFIXES` is `["dist/"]`
  (`src/core/workspace.ts:45`), and the post-producer snapshot passes
  `omitPrefixes: prepared.scratchPrefixes` (`src/core/transition.ts:791`), so
  writes under those prefixes are omitted from the comparison entirely. They are
  neither classified as product nor refused. `spartan-bridge/config.yaml`
  declares no `scratch_prefixes`, so the default applies here, and D-076 is the
  decision that made scratch follow the repository's declared build output.

  The automatic implementation write scope in `AGENTS.md` governs what a
  producer round may **contribute** — the product writes merged back — not every
  byte a build tool touches inside the workspace. A plan that required the
  implementer to run `npm run build` while `dist/` were product would indeed be
  unsatisfiable; that is not the classification in force.

  The pre-spawn plan-target scan is a separate mechanism: it reads mentions
  rather than classifications, so it lists `dist/`, `dist/cli/main.js`, and
  `dist/build-info.json` as unwritable plan targets. That advisory is expected
  here, is not a stop, and is not a defect in the plan.

  **Shape.** A closed record, following the nested-record precedent of
  `adapter_failure` and `producer_identity`:

  ```text
  RuntimeBuild = {
    version: string;        // package.json version at build time
    commit: string | null;  // 40-hex, null off a git checkout
    dirty: boolean | null;  // null when commit is null
    built_at: string;       // RFC 3339 UTC
  }
  ```

  `dirty` and `built_at` both earn their place: the failure this task exists to
  prevent is a consumer repository running a build compiled mid-round, and a
  dirty build must be visibly dirty. `built_at` is what distinguishes two dirty
  builds at the same commit. The accepted cost is that the tarball is no longer
  byte-reproducible; the non-determinism is confined to one file and the
  package is not published.

  **Read.** `readRuntimeBuild(packageRoot)` in `src/runtime/build-info.ts`
  returns `null` for a missing, unreadable, or malformed file. `main` already
  resolves `packageRoot` and already awaits, so it resolves the build once
  there and passes it to `createProductionDeps(env, runtimeBuild)`. `AppDeps`
  gains `runtimeBuild?: RuntimeBuild | null`, an optional seam like
  `snapshotCaps`, so no existing test fixture changes. Under `tsx` the running
  module has no `dist` ancestor, `packageRootFromRunningModule` returns
  `undefined`, and the field is `null` — the same fail-open the guard takes.

  **Two questions, two fields, no shared name.** "Which build produced this
  run" and "which build wrote this line" are different questions, and a single
  field answering both is how a later invocation ends up misattributed. So:

  - `runtime_build` on `StatusDocument` and `TransitionStatusDocument` is the
    **run origin** — the build resolved by the invocation that created the run.
    It is set at the three construction sites named in Scope and is never
    re-stamped.
  - `emitting_build` on `EventDocument` and `TransitionEventDocument` is the
    **emitter** — the build resolved by the invocation that appended that line.
    `emit` and `emitTransition` take it from `deps.runtimeBuild` at emit time
    rather than copying it from the status, so an event never claims a build
    that did not write it.

  An earlier draft of this decision asserted that the running build cannot
  change within a run. That is false and is withdrawn: `resume`, a `wait`-driven
  continuation, and a later status operation are separate process invocations,
  and a rebuild between them changes the binary. The two fields make that case
  representable instead of impossible — the appended events name the build that
  appended them, and the status keeps naming the origin.

  **What each record answers.** In the ordinary single-invocation run the two
  values are identical throughout, and a reader who greps one terminal line gets
  a correct attribution. In a continued run they differ, truthfully. Run origin
  stays recoverable from the event log alone, which is what `AGENTS.md:42`
  requires of operational runtime truth: the `run_requested` event — and the
  `authorization` event of a transition — is by construction emitted by the
  creating invocation, so its `emitting_build` is the origin.

  **Never re-stamped.** `emit` (`src/core/review.ts:976-1015`) rebuilds the
  status by spreading the prior one and then naming each field it may replace;
  `runtime_build` is not in that list, and neither is it in `emitTransition`. A
  later operation on an existing run therefore cannot overwrite the origin with
  its own build. A criterion pins that rather than leaving it to the spread.

  `SCHEMA_VERSION` stays `2`, and a missing or malformed persisted value
  normalizes to `null` in `serialize.ts`, per the D-069 and D-077 wording that
  an additive document change keeps schema version 2.

  **Excluded from the policy digest.** `runtime_build` does not enter
  `ResolvedPolicy` or `canonicalPolicyJson`. If it did, every rebuild would
  change `policy_digest`, which identifies the resolved policy and not the
  binary.

  **Reported, in four places, by one renderer.** A build nobody reads attributes
  nothing, so `formatRuntimeBuild` renders it once and four surfaces use it:

  - `spartan-bridge --version` / `-v` prints that one line and exits 0.
    `parse.ts` gets the case beside the existing `--help` case, and `HELP_TEXT`
    gains the usage and command lines.
  - `doctor` prints it on one `runtime:` line.
  - **The review's terminal opening line** (`formatReviewStartedLine`,
    `src/cli/main.ts:123-126`) carries it beside the existing `host`, `model`,
    `effort`, and `client-context`.
  - **The persisted `Bridge run:` line** (`src/core/task-write.ts:586`) carries
    it beside `policy_digest` and the artifact hashes.

  The first two answer a question the operator thought to ask. The last two
  answer it without being asked, and they are not interchangeable: the terminal
  line reaches the operator while the round is on screen, and dies with the
  scrollback; the `Bridge run:` line reaches whoever opens the artifact weeks
  later, and survives. `doctor` requires `--repo`, so `--version` stays the only
  way to ask which build is on `PATH` with no repository in hand — which is
  precisely the question a consumer-repository observation raises.

  One renderer rather than four spellings: a build that reads differently in
  the terminal and in the artifact is a build a reader has to reconcile before
  trusting either.

  **Which of the two builds each surface renders.** The origin/emitter split is
  a property of the records, so the two new surfaces must say which one they
  show rather than leave an implementer to choose:

  - `--version` and `doctor` render the build of the invocation answering the
    question. Neither is about a run, so neither has an origin to show.
  - The review's terminal opening line renders the build of the invocation
    printing it, which is the invocation that dispatches the review.
  - The persisted `Bridge run:` line renders the build of the invocation that
    **writes** it — the same value that invocation stamps as `emitting_build` on
    the `task_artifact_written` event.

  The `Bridge run:` line is the one that can disagree with the run's
  `runtime_build`, and the emitter is the right choice there: every other field
  on that line — `execution_id`, `verdict`, `reason_code`, `timestamp` —
  describes the review that produced the verdict, not the creation of the run.
  A run created by one invocation and completed by another had its verdict
  produced by the second; rendering the origin would attribute the verdict to a
  binary that did not produce it. The disagreement is not lost when it happens:
  the run's status keeps the origin, and the event log keeps every emitter, so a
  reader who needs both has both.

- **D4 — two tests, one naming the intent and one proving it.**

  Both land in `tests/spbridge-package.test.ts`, which already spawns processes
  and already carries the skip its neighbours use — the file-local
  `IN_PRODUCER_WORKSPACE` constant, which that file derives from the imported
  `PRODUCER_ISOLATED_WORKSPACE_ENV` name. `IN_PRODUCER_WORKSPACE` is the
  identifier passed to `{ skip: ... }`, and it is the one this task names:

  1. a manifest assertion that no entry of `package.json` `files` admits `src`;
  2. a tarball assertion that `npm pack --dry-run --json` reports zero packed
     paths under `src/`.

  The first states the rule where a future edit to `files` would be made. The
  second is the actual guarantee, and it also catches a reshuffle the first
  cannot see — an added `.npmignore`, or a broadened glob that readmits `src`
  without naming it.

  The separation needs both halves to hold: `files` excludes `src`, *and*
  `staleBuildMessage` fails open on a missing `src`. The second half is already
  pinned at `tests/cli.test.ts:676` and `:1229`; those assertions are referenced
  by the new test's comment and not duplicated.

## Acceptance Criteria

- **C1 (D1).** `npm pack --pack-destination <dir outside the repository>` exits
  0 under `private: true` and produces `spartan-bridge-<version>.tgz`.
- **C2 (D1).** That pack command adds no entry to `git status --porcelain`
  relative to the state immediately before it, so promotion never dirties the
  worktree it is run from.
- **C3 (D1).** `docs/RUNTIME-PROMOTION.md` documents the global install and its
  reversal as a human step, with a placeholder home path. The implementer does
  not execute it, and Blockers records it as the standing human gate.
- **C4 (D1).** In `docs/RUNTIME-PROMOTION.md`, no command that promotes — the
  pack and the global install — is chained to the test command by `&&`, `;`, a
  pipeline, or any other construct that runs it as a consequence of the test
  command's exit status. A test asserts this over the document text.
- **C5 (D1).** That document states the promotion gate in words between the test
  step and the pack step: it names the accepted baseline failure, states that
  any other failure stops the promotion, and states that the accepted baseline
  becomes zero once the task tracking it lands. A test asserts the gate sentence
  is present and sits between those two steps.
- **C6 (D1).** Every command in that document the operator runs — `npm ci` and
  `npm run build` separately among them — stands alone between
  `RUN ON TERMINAL` markers, with its order and prerequisites explained before
  it, and the sequence's final step is `spartan-bridge --version` with the
  stated check that a `built_at` older than the build just packed means the
  promotion did not land. A test asserts that the document contains no marked
  block holding more than one command.
- **C7 (D1).** `README.md` links `docs/RUNTIME-PROMOTION.md` and no longer
  presents `npm link` as the way a repository installs the runtime.
- **C8 (D2).** `agent-skill/skills/spbridge/SKILL.md` is byte-identical to
  `main`, and `tests/spbridge-skill.test.ts` is unmodified and passes.
- **C9 (D2).** While `PATH` resolves `spartan-bridge`, nothing this task adds or
  changes lets repository content displace it: the diff introduces no read of a
  workspace `package.json` `name`, workspace `dist/cli/main.js`, or other
  repository-controlled value for that purpose, and no new path by which a
  workspace-local file is reached while `PATH` resolves.
- **C10 (D2).** The pre-existing last-resort fallback is preserved and
  unwidened: `SKILL.md` still reaches a workspace-local `dist/cli/main.js` only
  on the condition that `spartan-bridge` is missing from `PATH`, and that
  condition is byte-identical to `main`. The plan states this as a bounded
  exception rather than as an invariant it does not have.
- **C11 (D2).** `docs/RUNTIME-PROMOTION.md` documents the development shell — an
  operator-owned directory outside every repository, prepended to `PATH`,
  holding a `spartan-bridge` shim that execs `node <checkout>/dist/cli/main.js`
  — with a placeholder home path, and states that every other shell resolves
  `spartan-bridge` to the pinned install and that closing the shell reverses the
  selection.
- **C12 (D2).** `docs/RUNTIME-PROMOTION.md` states the residual: a round started
  outside the development shell exercises the pinned build and nothing errors,
  and `spartan-bridge --version`, the `doctor` `runtime:` line, and the run
  record's `runtime_build` are how that is detected.
- **C13 (D2).** `STALE_BUILD_MESSAGE`, the `isBuildStale` predicate, and the exit
  codes of the `staleBuildMessage` block are byte-identical to `main`.
- **C14 (D3).** After `npm run build`, `dist/build-info.json` exists and
  `staleBuildMessage(<this checkout>)` is `undefined` — the stamp never lands
  under `src/`.
- **C15 (D3).** `npm run build` succeeds with git unavailable or outside a
  checkout, recording `commit: null` and `dirty: null`.
- **C16 (D3).** Both git invocations in `src/build/stamp.ts` carry
  `GIT_OPTIONAL_LOCKS=0`, and running `npm run build` in a clean checkout
  changes no path under `.git` — compared by `.git/index` mtime and size
  immediately before and after the build.
- **C17 (D3).** `StatusDocument` and `TransitionStatusDocument` carry
  `runtime_build`, `EventDocument` and `TransitionEventDocument` carry
  `emitting_build`, and `src/core/contracts.ts` states at each field which build
  it names — the invocation that created the run, or the invocation that
  appended the line.
- **C18 (D3).** A run created and completed by one invocation records the same
  build record in its status `runtime_build` and in every event's
  `emitting_build`; the same holds for a transition and its event log.
- **C19 (D3).** When a later invocation resolving a different build appends
  events to an existing run, those events record that invocation's build in
  `emitting_build` and the run's status `runtime_build` is unchanged, so neither
  document attributes work to a build that did not do it.
- **C20 (D3).** The run-origin build is recoverable from
  `.spartan-bridge/runs/<run-id>/events.jsonl` alone, as the `emitting_build` of
  the `run_requested` event; the `authorization` event carries it for a
  transition.
- **C21 (D3).** `SCHEMA_VERSION` is still `2`, and a status, event, transition
  status, or transition event persisted with a missing or malformed build record
  reads back as `null`.
- **C22 (D3).** `canonicalPolicyJson` contains neither `runtime_build` nor
  `emitting_build`, and a test pins that `policyDigest` is unchanged across two
  different build records.
- **C23 (D3).** `spartan-bridge --version` exits 0 and prints one line;
  `doctor` prints the same rendering on one `runtime:` line; both state plainly
  that the build is unknown when `dist/build-info.json` is absent.
- **C24 (D3).** The review's terminal opening line carries the build rendering
  beside `host`, `model`, `effort`, and `client-context`, and the persisted
  `Bridge run:` line carries it beside `policy_digest`; the existing fields of
  both keep their spelling and order.
- **C25 (D3).** Each surface renders the build D3 assigns it: `--version` and
  `doctor` the answering invocation's, the terminal opening line the dispatching
  invocation's, and the `Bridge run:` line the writing invocation's.
- **C26 (D3).** For a run created under one build and written under a different
  one, the `Bridge run:` line renders the writing invocation's build, that run's
  status `runtime_build` still renders the creating invocation's, and the
  `task_artifact_written` event's `emitting_build` equals what the line renders.
  A single-build run is not sufficient evidence for this criterion, because the
  two values agree there by coincidence.
- **C27 (D3).** All four surfaces render the build through the single
  `formatRuntimeBuild`, and a test pins that the four strings agree for one
  build record and that all four say plainly that the build is unknown when
  `dist/build-info.json` is absent.
- **C28 (D3).** A run executed from source under `tsx` records `null` in its
  status `runtime_build` and in every event's `emitting_build`, and raises no
  error.
- **C29 (D4).** A test asserts no `package.json` `files` entry admits `src`.
- **C30 (D4).** A test asserts a packed tarball contains zero paths under
  `src/`, skipped with the same file-local `IN_PRODUCER_WORKSPACE` constant its
  neighbours use.
- **C31 (D4).** The `tests/cli.test.ts` fail-open assertions are still present
  and unmodified.
- **C32 (D1-D4).** `docs/DECISIONS.md` gains one dated `D-078` entry.
- **C33.** `npm run typecheck` and `npm run build` are clean, and `npm test`
  shows no new failure against the `main` baseline.

## Work Completed

- 2026-09-12 (human-operator, Claude Code, claude-opus-5): queued after the
  single-runtime coupling blocked a `/spbridge` round in another repository
  twice on the same day, and after a rebuild made that repository execute an
  intermediate build of task `0068`. Verified the `npm link` chain, the `files`
  manifest, the `isBuildStale` fail-open on a missing `src`, and the absence of
  any version command or build field. No product file changed.
- 2026-09-12 (planner, Claude Code, claude-opus-5): closed D1-D4, derived C1-C18
  from them, and confirmed every path named in Scope exists in this checkout.
  Established the packaging facts by running `npm pack --dry-run`, located the
  three document construction sites and the two `createProductionDeps` call
  sites, confirmed the writer lock and run store are repository-relative, and
  identified the two pinned `SKILL.md` literals a D2 rewording must preserve.
  No product file changed.

- 2026-09-13 (planner, Claude Code, claude-opus-5): plan-review cycle 1 returned
  `CHANGES_REQUESTED` (`run-d8475ba0-6914-44b0-b6a6-7b5a17f997f6`). Re-derived
  C1-C19 from D1-D4 after the `PROMOTION_AUTHORITY` error showed C1 and C2
  demanded a machine-local human action from the implementer round and an
  unconditionally clean worktree; named the skip guard one way in D4 and in its criterion (C14 then, C16 now);
  and replaced the cross-repository evidence row with the local mechanism
  proof. No product file changed.

- 2026-09-13 (planner, Claude Code, claude-opus-5): plan-review cycle 2 returned
  `CHANGES_REQUESTED` on one finding (`run-12317fc4-2ec9-4892-9d3b-aa4ad925e92f`);
  the three cycle-1 findings did not recur. `CHECKOUT_IDENTITY` was accepted:
  D2 had claimed no consumer workspace could match its predicate, which a fork
  or a second clone falsifies. Narrowed the guarantee to the set the predicate
  actually matches, pinned the absolute invocation, recorded the residual case
  and its bounds, and recorded why a stronger manifest or runtime check was
  rejected. No product file changed.

- 2026-09-13 (planner, Claude Code, claude-opus-5): plan-review cycle 3 returned
  `CHANGES_REQUESTED` on one finding (`run-2317429a-6001-4071-9d24-100d6aef8098`),
  which exhausted that chain; the earlier findings did not recur.
  `CHECKOUT_EXCEPTION` was accepted in both of its halves. D2 had kept the
  absolute claim that a consumer repository always runs the pinned build while
  conceding in the same decision that a non-Bridge workspace can match the
  predicate, and its "widens no existing exposure" sentence was false, because
  the workspace-local invocation is reached today only when `spartan-bridge` is
  missing from `PATH`. Rewrote D2 to state that every matching workspace
  bypasses `PATH`, named the widening and withdrew the claim, replaced
  operator workspace selection as an authorization argument with the bound it
  actually is, recorded why a per-round opt-in and an install-side allowlist
  were both rejected as authorization mechanisms, narrowed the Objective's
  invariant to a workspace that is not a runtime checkout, and re-derived
  C1-C21 from D1-D4. No product file changed.

- 2026-09-13 (planner, Claude Code, claude-opus-5): a new plan-review chain
  returned `CHANGES_REQUESTED` on its first cycle
  (`run-af65af16-305a-426e-9848-850c42f833ca`) with two errors, both accepted.
  `UNTRUSTED_RUNTIME` rejected the workspace-declared predicate outright rather
  than its wording: repository-controlled content would have chosen the binary
  that owns policy, permissions, locks, and events before any of it was
  enforced. Took the finding's second branch — the skill's `PATH` selection is
  left untouched and the development runtime is selected in the operator's own
  shell — so `agent-skill/skills/spbridge/SKILL.md` and
  `tests/spbridge-skill.test.ts` left Scope, and the forgotten-shell residual is
  now carried by D3's build identifier. `RUN_BUILD_PROVENANCE` showed that a
  build recorded only on the status documents leaves `events.jsonl`, which
  `AGENTS.md:42` names operational runtime truth, unable to attribute a run;
  extended D3 to all four persisted document types and pinned that a later
  operation cannot re-stamp an existing run. Re-derived C1-C23 from D1-D4. No
  product file changed.

- 2026-09-13 (planner, Claude Code, claude-opus-5): plan-review cycle 2 returned
  `CHANGES_REQUESTED` on two errors, both accepted
  (`run-5e3401a0-1450-4d42-bf9a-2cebbc38c147`). `EVENT_BUILD_ATTRIBUTION` showed
  that one `runtime_build` field was answering two different questions: a later
  invocation appending events under a rebuilt binary would have stamped them
  with the origin build, misattributing lines in the record `AGENTS.md:42` calls
  operational runtime truth. Split the field — `runtime_build` on the status
  documents is the run origin, `emitting_build` on the event documents is the
  invocation that wrote the line — and withdrew the claim that the running build
  cannot change within a run, which `resume` falsifies.
  `HANDOFF_ROLE_MISMATCH` was accepted on the artifact's present state rather
  than on its intent: an envelope addressed to `planner` beside
  `next_role: reviewer` tells a reader to run a round the frontmatter does not
  name. Took the second remedy `AGENTS.md` allows and this artifact's own
  history supports — the section carries no envelope while the Bridge dispatch
  is pending, and `## Next Action` names the round instead. Re-derived C1-C24
  from D1-D4. No product file changed.

- 2026-09-13 (planner, Claude Code, claude-opus-5): plan-review cycle 3 passed
  (`run-ac2a481b-050f-4347-b226-8791864a505d`, `Verdict: APPROVED`, no
  findings), and the auto-chain successor it started was stopped 23m19s later
  on `write_scope_violation` naming `.git`
  (`transition-af0ee4e9-5798-4144-ac49-6df8958a0072`). The stop found a real
  gap in the approved plan rather than an infrastructure fault: D3's stamp runs
  `git status --porcelain`, which refreshes `.git/index`, and C25 requires the
  implementer to run `npm run build`, so the approved plan asked its own
  implementer to write a path its scope refuses. Added the
  `GIT_OPTIONAL_LOCKS=0` requirement to D3 with C12, and recorded why this
  plan's `dist/` mentions appear in the plan-target advisory. Re-derived
  C1-C25. No product file changed.

- 2026-09-13 (implementer, Codex, auto-chain): wrote the implementation for
  D1-D4 across the files Scope names, plus five the original Scope list did not
  anticipate: `src/cli/detach.ts`, `src/runtime/store.ts`, `tests/helpers.ts`,
  `tests/adapter-failure.test.ts`, and `tests/task-write.test.ts`. The
  implementation review recorded each as following from the approved design, and
  this amendment names all five in Scope against D3 rather than leaving them
  only in this entry.
- 2026-09-13 (human-operator, Claude Code, claude-opus-5): the mapped
  implementation review returned `human_required`
  (`run-ac5966ba-8732-4197-8767-1b1cbb26b045`, `task_write_state:
  skipped_human_gate`, so nothing was written into `## Review`). It could not
  verify the Git-backed criteria, because the producer copy has no `.git` and
  the reviewer cannot run them either. Ran them in this real checkout instead:
  `.git/index` unchanged across `npm run build`, `npm pack` leaving
  `git status --porcelain` byte-identical, the tarball carrying zero paths under
  `src/`, `--version` printing one line, `npm run typecheck` exit 0, and
  `npm test` at 610 tests / 609 pass / 1 fail, the one failure being the
  pre-existing `0082` tilde case. Recorded in Evidence. No product file changed.
- 2026-09-13 (planner, Claude Code, claude-opus-5): reopened planning at the
  owner's direction to close a gap the implementation made visible. D3 persisted
  the build and reported it through `--version` and `doctor`, both of which
  require the operator to think of asking; neither the review's terminal output
  nor the persisted `Bridge run:` line named it, so a round whose runtime is in
  question says nothing about its runtime unless separately interrogated.
  Extended D3 to four surfaces behind one renderer, added
  `src/core/task-write.ts` to Scope, and re-derived the criteria. Recorded the
  `spbridge-summary` allowlist as unreachable from this repository rather than
  leaving it implied. Re-derived C1-C27 from D1-D4. No product file changed.

- 2026-09-13 (planner, Claude Code, claude-opus-5): plan-review cycle 1 of the
  amended chain raised `SCOPE_INCOMPLETE` (warning); named the five files in
  Scope against D3 with the reason each one follows from the decision. A second
  dispatch was refused pre-dispatch on `transition_next_role_not_reviewer`
  because `next_role` had not been reset, and a third on `chain_refused` /
  `verdict_not_chainable` because it chained from that refusal rather than from
  the last chainable verdict; neither spawned a reviewer and neither consumed a
  review, though the first consumed a chain slot. Cycle 2 then raised
  `DIST_WRITE_SCOPE` (error), which this round answers rather than adopts: the
  finding assumes `dist/` is product under the automatic write scope, and it is
  producer scratch, omitted from the post-producer comparison. D3 now states the
  classification and the two code sites instead of resting on "no round writes
  them by hand", which the finding correctly identified as an argument about
  intent rather than about writes. No criterion changed, because none rested on
  the withdrawn argument. No product file changed.

- 2026-09-13 (planner, Claude Code, claude-opus-5): plan-review cycle 3 raised
  `BRIDGE_LINE_ATTRIBUTION` (warning) and exhausted the chain. Accepted: D3 had
  split run origin from event emitter and then added two rendering surfaces
  without assigning either one to them, and the criteria exercised only a
  single-build run, where the two values agree by coincidence. Assigned each
  surface its build, argued the `Bridge run:` line to the writing invocation
  because every other field on that line describes the review rather than the
  creation of the run, and added a mixed-build criterion that a single-build run
  cannot satisfy. Re-derived C1-C29 from D1-D4. No product file changed.

- 2026-09-13 (planner, Claude Code, claude-opus-5): a fresh chain's first cycle
  (`run-520cf962-8f92-4bac-8501-094f8c30aea4`) raised two findings, both
  accepted. `PROMOTION_GATE` (error): D1's procedure presented the tests and the
  promotion as one pasteable block, while `npm test` exits non-zero on the
  accepted `0082` baseline — so pasting it promoted a build whose test run had
  failed, and the block offered the operator no way to tell the known failure
  from a new one. Restated the procedure as six ordered steps with an explicit
  human gate between the tests and the packing, recorded why `&&` and `|| true`
  are both wrong there, and made the accepted baseline a dated fact that becomes
  zero when `0082` lands. `COMMAND_FORMAT` (warning): the substance is accepted
  — one command per block, prerequisites and order before it — and the artifact
  now carries the `RUN ON TERMINAL` markers. The documentation does not, and D1
  says why rather than leaving it silent: those markers delimit an agent-to-human
  handover inside a session, and a committed reference document has no session.
  Re-derived C1-C32 from D1-D4. No product file changed.

- 2026-09-13 (planner, Claude Code, claude-opus-5): plan-review cycle 2 returned
  `COMMAND_FORMAT` again (`run-69bd86dc-a5e8-439c-bfab-eaa6a8dfc3d3`), and it
  was right on the concrete points: D1 claimed the artifact used the marked
  blocks while presenting every command inline, and its step 1 fused `npm ci`
  and `npm run build` with `&&`, which is the fusing the convention forbids.
  Rewrote the procedure as seven marked blocks holding one command each, with
  the gate between the tests and the packing, and withdrew the argument that the
  documentation could carry the substance without the markers. The withdrawal is
  recorded in D1 rather than silently dropped: the argument failed less on its
  merits than on the draft asserting markers it did not use, and C6 now requires
  the markers in the document too. No product file changed.

- 2026-09-13 (planner, Claude Code, claude-opus-5): plan-review cycle 3 raised
  `RUNTIME_FALLBACK` (error) and exhausted the chain
  (`run-72ec97eb-c840-4f62-8942-9c3c9b84ca58`). Accepted, and the contradiction
  was self-inflicted: reversing D2 after `UNTRUSTED_RUNTIME` replaced one
  overstatement with another, claiming no repository can nominate the binary
  while preserving a fallback that lets exactly that happen when `PATH` resolves
  nothing. Narrowed the Objective, the Constraint, D2 and the derived criteria
  to the guarantee that actually holds — no repository can displace a runtime
  `PATH` resolves — and recorded the fallback as a pre-existing bounded
  exception, with the reason it differs from the predicate the earlier finding
  rejected: that predicate would have bypassed a present enforcer, while the
  fallback fires only when none exists. Re-derived C1-C33 from D1-D4. No product
  file changed.

- 2026-09-13 (planner, Claude Code, claude-opus-5): a third chain's first cycle
  raised `PROMOTION_STEP_ORDER` (warning)
  (`run-8d7542ae-4820-4f24-a962-81cd9ee7ab82`). Accepted: rewriting D1 into
  seven marked blocks left the introductory text on the old six-step numbering,
  so it called the tests and the gate both step 3, and named the working
  directory for "steps 1, 2 and 4" — omitting `npm test` and `npm pack`, the two
  other commands that need the repository root. Renumbered the introduction
  against the blocks it introduces and stated the working directory for each of
  the seven steps. No decision changed and no criterion rested on the wrong
  numbering. No product file changed.

- 2026-09-13 (implementer, Codex, auto-chain): after the plan passed on
  `run-42315288-59fa-40a0-93a2-958e41ef0013`, wrote the amended work — the two
  new rendering surfaces behind the shared renderer, the origin/emitter split
  reaching `detach.ts` and the event readers, and the promotion documentation
  with one command per marked block and the gate before packing.
- 2026-09-13 (human-operator, Claude Code, claude-opus-5): adopted the
  implementation review recorded above and closed its one blocking finding by
  running, in this checkout and after the amended round, the checks the
  producer's Git-less copy could not: `npm test` at 613 tests / 612 pass / 1
  fail, the failure being the `0082` tilde baseline; `npm run typecheck` exit 0;
  `npm run build` exit 0 including `postbuild`; `.git/index` unchanged at
  `1789247778 23022` across that build; `npm pack --pack-destination` to a
  directory outside the repository leaving `git status --porcelain`
  byte-identical; zero packed paths under `src/`; and `spartan-bridge --version`
  printing one line whose `built_at` is that of the build just packed. Recorded
  the outcome, issued HX-009 for the two actionable `info` findings, and
  committed the work.

- 2026-09-13 (implementer, Codex, gpt-5.6-sol): implemented the approved
  pinned-runtime design. Added the build stamp and runtime reader/renderer,
  threaded run-origin and event-emitter build records through review and
  transition persistence, added `--version` and the `doctor` runtime line,
  documented tarball promotion and the operator-owned development shell, added
  D-078, and added packaging, normalization, CLI, doctor, review, and
  cross-invocation transition regressions. The portable skill, its test, the
  stale-build predicate/message/refusal block, and schema version remain
  unchanged. No machine-local install, commit, or Bridge invocation was run.

- 2026-09-13 (implementer, Codex, gpt-5.6-sol): completed the amended
  implementation against approved plan-review run
  `run-42315288-59fa-40a0-93a2-958e41ef0013`. Closed the two remaining gaps:
  the review terminal opening and persisted `Bridge run:` lines now use the
  shared runtime renderer and name the dispatching/writing invocation, and the
  promotion guide now presents seven separate steps with the explicit test
  baseline decision before packing. Added regressions for mixed origin/writer
  builds, all four rendering surfaces, marked command shape, gate placement,
  and the final package premise. No machine-local install, commit, or Bridge
  invocation was run.

## Evidence

- `ls -l "$(which spartan-bridge)"` and `readlink -f` on it: the executable
  resolves through `<node prefix>/lib/node_modules/spartan-bridge` to
  `<this checkout>/dist/cli/main.js`. One runtime, shared by every repository
  on the machine.
- `npm pack --dry-run --json` — exit 0 under `private: true`;
  `spartan-bridge-0.1.0.tgz`, 164 entries, **0 paths under `src/`**; packed top
  level is `.agents`, `agent-skill`, `dist`, `docs`, `package.json`,
  `README.md`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`. `bin` is
  `./dist/cli/main.js`, which the tarball ships.
- `src/cli/main.ts:408-416` — `isBuildStale` returns `false` when
  `newestSourceMtime === undefined`; `src/cli/main.ts:418-433` —
  `staleBuildMessage` reads `path.join(packageRoot, "src")` and leaves the
  value `undefined` when that directory is absent.
- `tests/cli.test.ts:676`, `tests/cli.test.ts:1229` — both already assert
  `isBuildStale(undefined, T1.getTime()) === false`.
- `spartan-bridge --version` — `error: missing command`. `parseArgv`
  (`src/cli/parse.ts:36-38`) rejects any first argument starting with `-`
  except the single-argument `--help` / `-h` case, which is where the
  `--version` case belongs.
- Terminal documents read this session carry `schema_version` and
  `policy_digest` and no runtime build field, so a run cannot be attributed to
  a build after the fact.
- The three sites that construct the two status documents:
  `src/core/review.ts:226`, `src/core/transition.ts:457`, and `emptyTransition`
  at `src/core/transition.ts:1167`. Every later mutation spreads the prior
  status, so a field set at construction persists. `createProductionDeps` has
  exactly two call sites, `src/cli/main.ts:475` and `:481`, both inside `main`
  where `packageRoot` is already resolved and `await` is already in use.
- `src/core/serialize.ts:30-44` — `canonicalPolicyJson` enumerates its keys
  explicitly, so `policyDigest` is unaffected unless `runtime_build` is added
  to `ResolvedPolicy`, which D3 declines.
- `docs/DECISIONS.md` — highest existing entry is `D-077`; the additive-field
  wording to follow is `D-077`'s "the additive document change keeps schema
  version 2" and `D-069`'s normalize-to-`null` rule.
- `AGENTS.md:89-99` — the automatic implementation write scope admits `src/`,
  `tests/`, `docs/`, `README.md`, `package.json`, `package-lock.json`,
  `tsconfig.json`, `spartan/`, `skills/`, and
  `agent-skill/skills/spbridge/SKILL.md`. It does not admit a root `scripts/`
  or `.gitignore`, which is why the stamp writer lives under `src/` and why D1
  packs outside the repository.
- `agent-skill/skills/spbridge/SKILL.md:269-271` — the selection rule D2 leaves
  untouched, quoted as it stands and as it must remain: "Prefer the
  `spartan-bridge` executable on `PATH`. If it is missing and this checkout has
  `dist/cli/main.js`, invoke that file with `node` instead; it is the same CLI.
  If neither exists, stop and say the runtime is not installed." The
  workspace-local file is reached only when the executable is missing from
  `PATH`, so the rule as written never lets a repository displace a resolvable
  pinned runtime.
- `tests/spbridge-skill.test.ts:168-169` — the two assertions that keep passing
  because the file is not edited, quoted from it:

  ```text
  assert.match(skill, /`spartan-bridge` executable on `PATH`/);
  assert.match(skill, /`node dist\/cli\/main\.js` fallback/);
  ```
- `AGENTS.md:42` — "Treat `.spartan-bridge/runs/<run-id>/events.jsonl` as
  operational runtime truth after the runtime exists." This is the sentence that
  makes the event log, not `status.json`, the record a run must be attributable
  from.
- `src/core/contracts.ts:605-621` and `:555-568` — `EventDocument` and
  `TransitionEventDocument` as they stand; neither carries a runtime field, and
  both are additive in the same way the status documents are.
- `src/core/review.ts:976-1015` — `emit` rebuilds `run.status` by spreading the
  prior status and then naming each field it may replace; a field absent from
  that list cannot be re-stamped by a later operation, which is what keeps
  `runtime_build` the run origin. `:1017-1034` — the event document is built in
  the same helper, which already receives `deps`; `emitting_build` is read from
  `deps.runtimeBuild` there rather than from `run.status`, which is what makes
  it the emitter. `src/core/transition.ts:1220-1249` — `emitTransition` has the
  same two halves and the same two sources.
- `src/core/serialize.ts:55`, `:90`, `:204`, `:229` — the four entry points that
  normalize a persisted document, so one shared `RuntimeBuild` normalizer serves
  all of them.
- `transition-af0ee4e9-5798-4144-ac49-6df8958a0072`, 2026-09-13 — the auto-chain
  successor of the passing plan review, `state: stopped`,
  `reason_code: write_scope_violation`, `producer_refused_paths: [".git"]`,
  `producer_diagnostic: null`, `declaration_invalid_detail: null`, four events
  (`authorization`, `lock_acquired`, `producer_started`, `terminal_stop`),
  producer time 02:06:17Z to 02:29:36Z. Its `unwritable_plan_targets` are
  `["dist/", "dist/cli/main.js", "AGENTS.md", "dist/build-info.json"]`, which is
  what the plan mentioned and not what the producer wrote; the refused path is
  the one that stopped it. This is the first stop in this checkout to name a
  path, which is what task `0068` shipped `producer_refused_paths` to do.
- `git status --porcelain` refreshes the stat cache in `.git/index` and may take
  `.git/index.lock`; `GIT_OPTIONAL_LOCKS=0` is git's documented way to suppress
  both. `git rev-parse HEAD` reads only, and carries the variable for symmetry.
- `src/core/transition.ts:326-351` — `continueAfterPlanReview` starts the mapped
  implementer on any passing plan review unless `spartan-bridge/config.yaml` is
  absent or sets `dispatch: manual`; `src/core/task-write.ts:90-93` —
  `PLAN_REVIEW_NEXT_ROLE.pass` is `implementer`. A plan therefore cannot decline
  the auto-chain from its own frontmatter: declining it is a human edit to
  `spartan-bridge/config.yaml`, which this task holds out of scope.
- `src/core/workspace.ts:45` — `PRODUCER_DEFAULT_BUILD_SCRATCH_PREFIXES` is
  `["dist/"]`; `src/core/transition.ts:380` resolves the prefixes from optional
  configuration falling back to that default, and `:791` passes them as
  `omitPrefixes` to the post-producer snapshot. `spartan-bridge/config.yaml`
  contains no `scratch_prefixes` key, so the default is what applies to this
  task's implementer round.
- The producer round of 2026-09-13
  (`transition-af0ee4e9-5798-4144-ac49-6df8958a0072`) was stopped on `.git` and
  not on `dist/`, and the producer round that followed it wrote the
  implementation and reached `producer_finished` with no `dist/` refusal. Both
  are consistent with `dist/` being omitted from the comparison rather than
  admitted by it.
- `src/runtime/lock.ts:34,76` — the writer lock is
  `.spartan-bridge/locks/writer.lock`, repository-relative, so the two-runtime
  split introduces no cross-repository lock contention.
- Every path named in Scope was confirmed present in this checkout, except the
  three files this task creates, which are marked `(new)`.
- **The coupling's mechanism, verified locally.** `staleBuildMessage` resolves
  its `src/` and `dist/` from `packageRootFromRunningModule`
  (`src/cli/main.ts:346-358`), which walks up from the running module to the
  directory holding `dist` — this checkout, for every invocation that reaches
  the CLI through the `PATH` symlink, whatever repository `--repo` names.
  Measured this session: newest `src/` mtime `2026-09-12T21:00:29Z` against
  `dist/cli/main.js` at `2026-09-12T21:46:53Z`, so `isBuildStale` is `false`;
  one edit under `src/` inverts that pair for every repository on the machine
  at once. The refusal the operator met in an unrelated repository twice on
  2026-09-12 is recorded in Context as an operator observation; this row makes
  no run-level claim about that repository.
- `npm run typecheck && npm run build` — exit 0. `postbuild` wrote
  `dist/build-info.json`; in this Git-less producer copy it recorded
  `{"version":"0.1.0","commit":null,"dirty":null,"built_at":"<RFC 3339 UTC>"}`.
  A source invocation of `staleBuildMessage(process.cwd())` returned
  `undefined`, confirming the stamp did not make the checkout stale.
- `npm pack --dry-run --json` — exit 0; reported
  `spartan-bridge-0.1.0.tgz`, 164 files, and zero paths equal to or below
  `src/`. The focused package test passed with the producer skip disabled.
- `env -u SPARTAN_BRIDGE_PRODUCER_ISOLATED node --import tsx --test
  tests/spbridge-skill.test.ts` — 13 passed, 0 failed. The skill and its test
  retain their producer-copy baseline timestamps and were not edited.
- `node --import tsx --test --test-reporter=dot tests/parse.test.ts
  tests/serialize.test.ts tests/doctor.test.ts tests/cli.test.ts
  tests/review.test.ts tests/spbridge-package.test.ts
  tests/adapter-failure.test.ts tests/task-write.test.ts
  tests/transition.test.ts` — exit 0 after the final edits.
- `NODE_OPTIONS='--test-reporter=dot' npm test` — all non-Git-backed tests
  passed. Twenty-nine tests in `implementation-review.test.ts`,
  `repo-hygiene.test.ts`, `task-status.test.ts`, and `workspace.test.ts` could
  not start their Git fixtures: this admitted producer copy contains no `.git`,
  and every `git` / `git init` exits 128 because the enclosing sandbox refuses
  Apple Git's attempt to open `/dev/null`. The same restriction prevents the
  C2 `git status --porcelain` comparison and C12 `.git/index` measurement here;
  the implementation regression pins `GIT_OPTIONAL_LOCKS=0` on the shared
  helper used by both stamp Git calls. No failure reached product assertions.
- `npm run typecheck && npm run build` after the amended implementation — exit
  0. `postbuild` wrote `dist/build-info.json` with version `0.1.0`, `commit` and
  `dirty` null in this Git-less producer copy, and an RFC 3339 UTC `built_at`.
  A source call to `staleBuildMessage(process.cwd())` returned `undefined`, and
  `node dist/cli/main.js --version` printed the same stamp on one line.
- `node --import tsx --test tests/doctor.test.ts tests/cli.test.ts
  tests/task-write.test.ts tests/review.test.ts` — 119 tests, 119 passed, 0
  failed. This includes the shared four-surface renderer assertion and the
  mixed-build assertion that the status retains the origin while the persisted
  `Bridge run:` line and `task_artifact_written` event name the writer.
- With the producer skip disabled only for the three task-owned package checks,
  `tests/spbridge-package.test.ts` reported 3 tests, 3 passed, 0 failed:
  `package.json` admits no `src`, `npm pack --dry-run` reports zero `src` paths,
  and the promotion document has one command per marked block with the human
  gate between `npm test` and `npm pack`.
- The non-Git-backed partition — every `tests/*.test.ts` file except
  `implementation-review.test.ts`, `repo-hygiene.test.ts`,
  `task-status.test.ts`, and `workspace.test.ts` — reported 543 tests, 532
  passed, 0 failed, and 11 expected producer-copy skips.
- `NODE_OPTIONS='--test-reporter=tap' npm test` — 613 tests, 571 passed, 29
  failed, and 13 skipped. All 29 failures stop before product assertions at
  Git fixture setup or `git ls-files`: this admitted producer copy has no
  `.git`, and the enclosing sandbox refuses Apple Git's `/dev/null` open. This
  is the same environment limitation already recorded above, not a new product
  failure.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-42315288-59fa-40a0-93a2-958e41ef0013 execution_id=exec-b9be14a4-ec9c-4ca9-a5e0-6bf8b811d637 review_kind=plan verdict=pass reason_code=review_passed host=codex launcher=codex-plan-reviewer-v1 model=gpt-5.6-sol effort=high model_observed=declared_unobserved policy_digest=sha256:c032b4cea31dd45976e0e4d6a6b689590f1f0a1a368378fd8a82e546eb9525a3 task_hash=sha256:91f0cc4f40eca00a75a38c0706214826c00d866edd704b91ef87eaa5cd801d1b agents_hash=sha256:6bd68578db8fd268d33c5847ff43bbf478ca1ed9c7a17c1a34df7ed723f5b8da timestamp=2026-09-13T08:39:29.043Z
<!-- spartan-bridge:review:plan:end -->

### Implementation review, adopted 2026-09-13

The Bridge dispatched `reviewer.implementation` as
`run-49298cbf-9b50-4cd8-b84e-9485288cc8b2` (transition
`transition-1661baa7-b154-4cb4-89f0-6aff2b076cd5`, host `claude`, model
`claude-opus-5`, effort `high`). It returned the Bridge verdict
`human_required` with `reason_code: review_human_required` and
`task_write_state: skipped_human_gate`, so the runtime wrote nothing into this
section and this entry is adopted by a human-operator round rather than
authored by the reviewer.

The reviewer recorded no product defect. Its one blocking finding,
`GIT_BACKED_UNVERIFIED` (warning), was that the Git-backed checks could not run
in the producer's Git-less copy and had last been verified before the amended
implementation round. That gap is closed by the human-operator verification in
Evidence, run in this checkout after that round.

No `APPROVED` is recorded here. The reviewer did not return one, and
synthesizing it would put a verdict in the reviewer's mouth. What is recorded
is what happened: no product defect found by the review, and the checks it
could not run executed by a human and passing.

Five findings remain open, all `info`: `README_SHIM_EXEC_BIT`,
`BRIDGE_LINE_BARE_TOKENS`, `STAMP_ENTRY_GUARD`, `TYPE_IMPORT_STYLE`, and
`UNRELATED_TASK_FILE` — the last naming task `0084`, which was created in this
worktree while this task was in review and is committed separately.

## Blockers

No product implementation blocker. Two machine-local steps are human actions and stay outside
every automatic write scope. The operator replaces the current `npm link` with
the pinned install D1 selects, and creates the development shell D2 documents.
Until the first runs, the coupling this task describes remains in effect; until
the second does, a round in this checkout exercises the pinned build.

One operational note for review: a prior producer round stopped on `.git`.
D3's `GIT_OPTIONAL_LOCKS=0` removes the Git write introduced by the build stamp,
while this implementation ran in an isolated copy without `.git`; that is also
why the Git-backed full-suite cases could not start here. The isolated producer
copy is the structural fix queued as task `0053`; this task does not absorb it.

## Next Action

Address the two actionable `info` findings — `README_SHIM_EXEC_BIT` and
`BRIDGE_LINE_BARE_TOKENS` — in one implementer round. The machine-local
promotion remains the standing human gate recorded in Blockers.

## Next Handoff

```text
Recommended execution (human decides):
- Repository: Agent Spartan Protocol Bridge
- Host: Claude Code — the `implementer` binding in AGENTS.md
- Model and effort: claude-opus-5, effort high
- Role: implementer
- Handoff: HX-009
- Permission: writable
- Invocation: `/spbridge` in a fresh session, passing the prompt block below as the argument
```

```text
######## RUN AS PROMPT ##################
Open `spartan/tasks/0083-consumer-repositories-run-a-pinned-runtime.md`. (handoff HX-009)

Act as implementer. Correct the two recorded `info` findings: the README
sentence that attributes a lost executable bit to the development shim, which
runs `exec node <checkout>/dist/cli/main.js` and cannot produce that error, and
the bare tokens in the `Bridge run:` line rendering. The round succeeds when
both are corrected and no other behavior changes.
Run the relevant repository checks and update the same task file.

Return only the next handoff, or a completion notice if no work remains.
######## END OF RUN AS PROMPT ##########
```
