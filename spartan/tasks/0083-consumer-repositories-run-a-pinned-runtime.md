---
protocol: "1.1.0" # x-release-please-version
id: consumer-repositories-run-a-pinned-runtime
created_at: 2026-09-12
status: active
phase: planning
task_type: planning
risk: material
current_role: planner
next_role: planner
updated_at: 2026-09-12
handoff_id: none
next_handoff_id: HX-001
---

# Consumer repositories run a pinned runtime, and every run names its build

## Objective

A repository that only *uses* the Bridge runs a pinned build that no in-flight
development can change, while this checkout stays free to edit `src/` without
blocking or silently altering anyone else's round. Every run record names the
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

- `package.json` `files` is
  `["dist/**","agent-skill/**",".agents/plugins/marketplace.json","docs/**","README.md","LICENSE","SECURITY.md","CONTRIBUTING.md","package.json"]`.
  It does not include `src`, so an installed copy carries no `src/` tree.
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
  - Whatever the promotion procedure requires of the manifest, and a guarantee
    that `files` can never readmit `src`.
- `src/` and `tests/`
  - A way to report the running build, and to record it on run and transition
    documents, as D2 and D3 decide.
- `docs/`
  - The two-runtime setup: what a consumer repository installs, how a build is
    promoted from this checkout to that install, and how to run this checkout's
    own build deliberately.
- `README.md`
  - Install instructions that no longer produce the single-runtime coupling.
- Tests for each of the above.

## Out of Scope

- Weakening, gating, or making per-repository the stale-build guard itself. It
  is correct; the separation removes the reason it fires across repositories.
- Publishing the package to a public registry, or any release, tag, or version
  bump not required by the promotion procedure.
- `AGENTS.md` and `spartan-bridge/config.yaml`, so this plan declares no human
  implementer for its repository work. The machine-local install step is a
  human action by nature and is documented, not automated.
- Retrofitting a build identifier onto run records already written.
- The `0082` tilde-rule hygiene failure, which is pre-existing and has its own
  task.

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
- `npm run typecheck` / `npm run build` clean; `npm test` no new failure against
  the `main` baseline, which currently carries the one pre-existing
  `repo-hygiene` tilde failure tracked by `0082`.

## Decisions

- **D1 (open) — the shape of the pinned install.** A tarball from `npm pack`
  installed globally with `npm -g install <tarball>` is a real copy and breaks
  the link; a second clone pinned to a commit and linked from there is also a
  copy but keeps a git identity. Decide which, decide where it lives, and decide
  what the operator runs to replace the current `npm link`.
- **D2 (open) — how this checkout runs its own build.** `SKILL.md` step 4
  prefers the `spartan-bridge` executable on `PATH` and falls back to
  `node dist/cli/main.js` only when that executable is missing. Once `PATH`
  holds the pinned copy, this repository's own `/spbridge` rounds would use the
  pinned build rather than the one just compiled here. Decide whether that is
  the wanted behavior — promotion becomes an explicit act, and this repository
  dogfoods the same build everyone else runs — or whether the development
  checkout needs a documented way to invoke its own `dist/`, and if so what
  `SKILL.md` has to say about it.
- **D3 (open) — how a run names its build.** Decide the identifier (package
  version alone is too coarse while the version stays `0.1.0`; a commit hash is
  precise but must be captured at build time), where it is produced, whether it
  reaches `StatusDocument` and `TransitionStatusDocument` as an additive field,
  whether `doctor` reports it, and whether a `--version` command is added. The
  operator's loop needs a consumer-repository observation to name a build, so at
  minimum one persisted document must carry it.
- **D4 (open) — keeping the coupling from returning.** Decide what makes the
  separation durable: a test asserting `files` excludes `src`, a test asserting
  a packed tarball contains no `src/` entry, a documented check, or some
  combination. A future edit to `files` must not be able to silently restore the
  single-runtime state.

## Acceptance Criteria

Derive these from the decisions once D1-D4 are pinned; do not write them before
the decisions settle.

## Work Completed

- 2026-09-12 (human-operator, Claude Code, claude-opus-5): queued after the
  single-runtime coupling blocked a `/spbridge` round in another repository
  twice on the same day, and after a rebuild made that repository execute an
  intermediate build of task `0068`. Verified the `npm link` chain, the `files`
  manifest, the `isBuildStale` fail-open on a missing `src`, and the absence of
  any version command or build field. No product file changed.

## Evidence

- `ls -l "$(which spartan-bridge)"` and `readlink -f` on it: the executable
  resolves through `<node prefix>/lib/node_modules/spartan-bridge` to
  `<this checkout>/dist/cli/main.js`. One runtime, shared by every repository
  on the machine.
- `node -e 'console.log(require("./package.json").files)'` —
  `dist/**`, `agent-skill/**`, `.agents/plugins/marketplace.json`, `docs/**`,
  `README.md`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `package.json`.
  No `src`.
- `src/cli/main.ts:408-416` — `isBuildStale` returns `false` when
  `newestSourceMtime === undefined`; `src/cli/main.ts:418-433` —
  `staleBuildMessage` reads `path.join(packageRoot, "src")` and leaves the
  value `undefined` when that directory is absent.
- `tests/cli.test.ts:676`, `tests/cli.test.ts:1229` — both already assert
  `isBuildStale(undefined, T1.getTime()) === false`.
- `spartan-bridge --version` — `error: missing command`. The `--help` usage
  block lists `review`, `wait`, `resume`, `status`, `events`,
  `transition-status`, `transition-events`, `doctor`, `policy`, `mcp-stdio`,
  and no version command.
- Terminal documents read this session carry `schema_version` and
  `policy_digest` and no runtime build field, so a run cannot be attributed to
  a build after the fact.
- **The coupling fired twice on 2026-09-12.** Task `0068`'s auto-chain edited
  `src/`, after which `wait` in this repository printed
  `dist/ is older than src/; run npm run build` on every poll, and a
  `/spbridge` round in an unrelated repository reported the same refusal and
  was told to build *this* checkout to unblock itself. That second repository's
  round had no stake in this task.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: PENDING
<!-- spartan-bridge:review:plan:end -->

## Blockers

None for planning. The implementation's machine-local install step is a human
action: the operator replaces the current `npm link` with the pinned install
D1 selects. Until that step runs, the coupling this task describes remains in
effect.

## Next Action

A planner round through `/spbridge`: pin D1's install shape, D2's development
invocation and any `SKILL.md` consequence, D3's build identifier and where it
is persisted, and D4's durability check; verify every named path; then let the
Bridge dispatch the plan review.

## Next Handoff

```text
Recommended execution (human decides):
- Host: Claude Code (AGENTS.md binds planner to Claude Code; fresh session)
- Model and effort: claude-opus-5 at effort high
- Role: planner
- Handoff: HX-001
- Permission: writable
- Invocation: /spbridge, passing the prompt block below as the argument
```

```text
Open `spartan/tasks/0083-consumer-repositories-run-a-pinned-runtime.md` (handoff HX-001).

Act as planner. Refine this plan against `package.json` (`files`, `bin`), `src/cli/main.ts` (`isBuildStale`, `staleBuildMessage`, the `--help` command table), `src/core/contracts.ts` (`StatusDocument`, `TransitionStatusDocument`, `SCHEMA_VERSION`), `src/core/doctor.ts`, `README.md`, `docs/`, and `agent-skill/skills/spbridge/SKILL.md` step 4: pin D1's pinned-install shape, D2's development invocation and any `SKILL.md` consequence, D3's build identifier and the documents that carry it, and D4's durability check. Verify every named path exists in this checkout. Follow the established additive-field precedent if a document field is added, and keep the stale-build guard itself unchanged. Keep `## Review` as the `Verdict: PENDING` placeholder and `phase: planning`.

Then let the Bridge dispatch the plan review.
```
