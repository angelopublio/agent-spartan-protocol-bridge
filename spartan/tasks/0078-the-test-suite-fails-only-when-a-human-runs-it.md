---
protocol: "1.1.0" # x-release-please-version
id: the-test-suite-fails-only-when-a-human-runs-it
created_at: 2026-09-11
status: completed
phase: complete
task_type: implementation
risk: material
current_role: human-operator
next_role: none
updated_at: 2026-09-13
handoff_id: HX-005
next_handoff_id: none
---

# The test suite fails only when a human runs it

## Objective

`npm test` reports ten failures whenever the environment above the test runner carries
`FORCE_COLOR`, and none otherwise — same commit, same code. A person running the suite in a terminal
always hits it, because the runner itself injects the variable there. The reading a human trusts
to accept work is the one that is wrong, and it is wrong in the direction that invents defects
rather than hiding them.

## Context

Observed on 2026-09-11 while closing task `0077` on its implementation-review human gate. The gate
existed because neither the producer sandbox nor a read-only review could run the suite, so a
person had to. That person got 551 of 561 and a plausible story that the change under review was
at fault.

The mechanism, re-established on 2026-09-13 against `245a3f2` (line numbers below are that
checkout's):

- Node's test runner sets `FORCE_COLOR=1` in each test-file process when its reporter colors: under
  a pseudo-terminal, or when the runner's own parent already carries `FORCE_COLOR`. A host shell
  that exports `FORCE_COLOR` reaches the same spawns with no terminal at all.
- Five spawn sites build the CLI child's environment from an inherited one and add `NO_COLOR`:
  `tests/cli.test.ts:79` (`runCli`), `:383` (the bin-symlink test's inline spawn), `:660`
  (`runCliWithModule`), `tests/mcp.test.ts:202` (`spawnProcess`), and `tests/detach.test.ts:63`
  (`runCli`). Each is a `spawn(process.execPath, …)` call, and each is its file's only use of
  `node:child_process`.
- A Node process holding both variables writes
  `(node:<pid>) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.` and
  the `--trace-warnings` line to its own stderr, but only once something queries color support.
  The CLI does, so its stderr gains a prefix.
- Ten tests assert on that stderr from its first byte — exact equality, or a `^`-anchored match —
  and fail: in `tests/cli.test.ts`, "production CLI fake returns human_required and persists
  events" (`:449`), "transition-status and transition-events reject directory and file symlink
  escapes" (`:610`), "CLI warns on stderr for a nested newer source and continues with stdout
  unchanged" (`:734`), "CLI writes no stale-build message when the build is newer or the package
  has no src/" (`:748`), "stale mcp-stdio writes the warning, exits 1, and does not serve"
  (`:1145`), "status, events, and doctor still run on a stale build and keep the warning on
  stderr" (`:1161`), "stale usage still exits 2 with the warning and the error line" (`:1188`),
  "a current build leaves all CLI kinds without a stale warning" (`:1202`), "a package with no
  src/ writes no stale message on any command" (`:1279`); in `tests/mcp.test.ts`, "mcp-stdio usage
  errors exit 2 and unreadable roots exit 1 with no stdout" (`:807`).

**Why this is worth a task rather than a note.** The cost is not the ten red lines; it is that the
suite lies to exactly the reader who has no other source of truth. On `0077` several minutes went
into proving the failures were environmental, and the alternative outcome — accepting the story
that the change was at fault, and sending a correct implementation back for another cycle — was
available the whole time. A gate that hands the human a false negative is worse than no gate.

## Scope

- `tests/helpers.ts` — two exported functions, `cliChildEnv` and `spawnCliChild` (D2).
- `tests/cli.test.ts` — the three spawn sites at `:79`, `:383`, `:660`, its `node:child_process`
  import once unused, and one regression test.
- `tests/mcp.test.ts` — the spawn site at `:202`, its `node:child_process` import once unused, and
  one regression test.
- `tests/detach.test.ts` — the spawn site at `:63` and its `node:child_process` import once unused.
- `tests/child-env.test.ts` — new: the helpers' unit tests and the source guard.

## Out of Scope

- Changing what the CLI writes to stderr, or when. The product is correct here; the tests are.
- Relaxing any assertion to substring or looser matching. See Constraints.
- D-031's stale-build predicate, message, and exit codes. Several of the ten assert them; none of
  them is what fails.
- Spawn sites that do not set `NO_COLOR` (the adapter and process-runner tests that launch
  `process.execPath` with an explicit environment). Node warns only when both variables are
  present, and nothing under `src/` sets `NO_COLOR`.
- The `waited_ms` normalization residual from `0077`. That is folded into task `0073`.
- The tilde-path hygiene failure ("a tilde path names a dotfile", `tests/repo-hygiene.test.ts:177`).
  It fails with no `FORCE_COLOR` in the environment and is owned by task `0082`.
- The nested-suite check at `tests/producer-write-scope.test.ts:345`. It runs `npm run test` inside
  a prepared producer copy with the test-file process's environment, which carries
  `NODE_TEST_CONTEXT=child-v8`; with that variable inherited the nested run exits 0 and prints no
  summary even when the same copy fails without it (see Evidence). That check cannot fail, which is
  a separate defect for its own task; this task neither relies on it nor repairs it.
- Type-checking test files. `tsconfig.json` includes only `src/**/*.ts`, so `npm run typecheck`
  does not cover `tests/`; widening it is not this task.
- CI configuration. CI has no terminal attached and already passes.

## Constraints

- The fix must not weaken what the assertions prove. They pin operator-visible stderr from its
  first byte, including ordering between the stale-build line and the error line; that is the
  property, and a looser matcher would stop defending it.
- The suite must produce identical results with and without `FORCE_COLOR` above the runner, with or
  without a terminal attached. That equivalence is itself the thing being restored, so it has to be
  checkable rather than assumed.
- Whatever is decided must hold at any runner depth — a test that spawns the CLI directly, and a
  CLI spawn inside a nested `node --test` — since a runner at any level can inject the variable.

## Decisions

- **D1 — The cause is an inherited `FORCE_COLOR` reaching a child that also gets `NO_COLOR`,
  whatever put it there.** A terminal is one source (the runner injects it), a host shell exporting
  it is another; both deliver the same variable to the same five spawn sites. The fix therefore
  keys on the variable, not on terminal detection.
- **D2 — One helper owns the child's color environment and performs the spawn.** `tests/helpers.ts`
  exports two functions:
  - `cliChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv` returns a new object holding every key
    of `env` except `FORCE_COLOR`, with `NO_COLOR` set to `"1"`, and leaves `env` unmutated. It
    removes `FORCE_COLOR`; it never sets it to `""`, `"0"`, or any other value, because absence is
    the only state probed silent.
  - `spawnCliChild(args: readonly string[], options: SpawnOptions = {}): ChildProcess` returns
    `spawn(process.execPath, args, { ...options, env: cliChildEnv(options.env ?? process.env) })`.
  Each of the five sites replaces its `spawn(process.execPath, …)` call with `spawnCliChild`,
  passing the same argument array, `cwd`, and `stdio`, and an environment literal without its
  `NO_COLOR` key — for example `spawnCliChild(["--import", "tsx", cli, ...args], { env: { ...env,
  TZ: PINNED_TZ }, stdio: ["ignore", "pipe", "pipe"] })`. Because the environment is finalized
  inside the call that spawns, no caller-supplied object — `tests/mcp.test.ts`'s `xdg.env`, itself a
  copy of `process.env`, or an explicit `FORCE_COLOR` — can reach the child after removal. What
  stays the same at each site: the executable, arguments, `cwd`, `stdio`, stream handling, and every
  environment key other than `FORCE_COLOR` and `NO_COLOR` with its value and merge order. The
  complete list of what changes: (1) `FORCE_COLOR` is absent from the five children's environments;
  (2) `NO_COLOR` is `"1"` in each, as before, but now applied after every merge, so a caller's
  `options.env` in `tests/mcp.test.ts` can no longer override it, and no caller passes it; (3) the
  `spawn` call moves into the helper, and each file's `node:child_process` import is removed when
  nothing else uses it.
- **D3 — No test needs the parent's `FORCE_COLOR`.** Nothing under `src/` reads `FORCE_COLOR` or
  `NO_COLOR`; the CLI's only terminal-sensitive output keys off `stream.isTTY`
  (`src/cli/main.ts:253`, `:296`), and all five spawns pipe the child's stdio. No test asserts
  colored output.
- **D4 — `tests/detach.test.ts:63` is exposed, and moves to the helper too.** It builds the identical
  environment, and the CLI child it starts emits the warning; it passes only because its two callers
  (`:134`, `:149`) assert the exit code and the parsed stdout and never read stderr. Moving it keeps
  the five sites uniform, so a stderr assertion added there later is not born exposed.
- **D5 — The equivalence is made checkable at three levels, none needing a terminal.**
  (a) Regression tests that inject the variable explicitly: in `tests/cli.test.ts`, a call to
  `runCli` with `{ ...process.env, FORCE_COLOR: "1" }` on an invocation whose stderr an existing
  test in that file already pins by exact equality, asserting the same exact stderr; in
  `tests/mcp.test.ts`, `spawnProcess(["mcp-stdio", "--task", "x"], { env: { FORCE_COLOR: "1" } })`
  asserting exit code 2, empty stdout, and stderr matching `/^error: /`. Both must fail with the
  `FORCE_COLOR` removal disabled inside `cliChildEnv` and pass with it.
  (b) A source guard in `tests/child-env.test.ts`: it reads every regular file under `tests/`,
  recursively and including `tests/fixtures/`, and asserts that the text `NO_COLOR` occurs in none
  of them except `tests/helpers.ts` and `tests/child-env.test.ts`. The condition is file-level, not
  line-level, so it does not depend on formatting, comments, or what else shares a line. Soundness
  follows from D2: Node warns only when a child holds both variables; test code can give a child
  `NO_COLOR` only by naming it, which the guard confines to the helper; and the helper removes
  `FORCE_COLOR` in the same function that sets `NO_COLOR`, inside the call that spawns, after every
  caller-supplied merge. A sixth spawn that sets `NO_COLOR` itself fails the suite; a sixth spawn
  that does not set it cannot produce the warning from test code. What the guard does not claim: a
  variable name assembled at run time, and a `NO_COLOR` inherited from the shell above the runner —
  the second is what run (c)'s third command covers.
  (c) A whole-suite trio recorded as evidence, each with stdout piped:
  `env -u FORCE_COLOR -u NO_COLOR node --import tsx --test tests/*.test.ts`,
  `FORCE_COLOR=1 node --import tsx --test tests/*.test.ts`, and
  `NO_COLOR=1 FORCE_COLOR=1 node --import tsx --test tests/*.test.ts`. They produce identical
  failure sets. By D1 the second exercises the same route a terminal does, and a sandboxed host can
  run all three.
- **D6 — Runner depth is covered by finalizing the environment at the leaf spawn.** Because
  `spawnCliChild` builds the CLI child's environment in the call that starts it, the removal holds no
  matter how many runners above that spawn injected or inherited `FORCE_COLOR`. No nested-suite
  witness is claimed: the only one in the tree cannot fail (Out of Scope).

## Acceptance Criteria

1. (D2) `tests/child-env.test.ts` shows that `cliChildEnv({ FORCE_COLOR: "1", NO_COLOR: "0", KEEP:
   "x" })` returns an object for which `Object.hasOwn(result, "FORCE_COLOR")` is false, `NO_COLOR` is
   `"1"`, and `KEEP` is `"x"`, and that the input object still holds `FORCE_COLOR: "1"` and
   `NO_COLOR: "0"`.
2. (D2, D6) `tests/child-env.test.ts` shows that a child started by `spawnCliChild(["-e",
   "process.stdout.write(JSON.stringify([process.env.FORCE_COLOR ?? null, process.env.NO_COLOR ??
   null]))"], { env: { ...process.env, FORCE_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] })`
   writes exactly `[null,"1"]` to stdout.
3. (D2, D4) Each of the five sites — `tests/cli.test.ts` `runCli`, the bin-symlink inline spawn,
   `runCliWithModule`, `tests/mcp.test.ts` `spawnProcess`, `tests/detach.test.ts` `runCli` — calls
   `spawnCliChild` with its previous arguments, `cwd`, and `stdio`, and an environment literal that
   differs from its previous one only by the removed `NO_COLOR` key. `grep -rn "child_process"`
   over those three files returns nothing, or only an import something other than the five sites
   still uses.
4. (D5a) The two regression tests exist as specified in D5(a). Evidence records each failing with
   the `FORCE_COLOR` removal disabled inside `cliChildEnv`, quoting the edited line, and passing with
   it restored.
5. (D5b) The source guard exists as specified in D5(b) and passes. Evidence records it failing when
   a scratch copy of one site's literal `NO_COLOR: "1"` is added back to its test file, quoting that
   line, and passing once the line is removed.
6. (D3, Constraints) No assertion in the ten tests named in Context changes, and `git diff --stat
   src/` is empty.
7. (D1, D5c, D6) Evidence records the three whole-suite runs from D5(c) with their test, pass, and
   fail counts and failing test names; the three failure sets are identical, and none contains any
   of the ten tests named in Context. While task `0082` is open, "a tilde path names a dotfile" is
   the only failure any run may show.
8. Repository check: `npm run typecheck` exits 0. This covers `src/` only (see Out of Scope); the
   test files are exercised by criterion 7's runs.

## Work Completed

- 2026-09-13, planner round (Claude Code, `claude-opus-5`), entered through `/spbridge`. The pasted
  prompt carried no handoff identifier; the round proceeded under the artifact's `HX-002`.
  Re-derived every location against `245a3f2` (the recorded ones had drifted), broadened the cause
  from "a terminal" to "an inherited `FORCE_COLOR`", established that `tests/detach.test.ts` is
  exposed, identified the fifth spawn site at `tests/cli.test.ts:383`, separated the unrelated
  hygiene failure (task `0082`), found that the nested-suite check cannot fail, and wrote D1–D6 and
  the criteria derived from them. No product or test file changed.
- 2026-09-13, same session, plan-review cycle 1 correction for `SOURCE_GUARD_UNSOUND`. D2 now puts
  `NO_COLOR` and the `FORCE_COLOR` removal in one spawning helper, so the environment is finalized at
  the spawn boundary; D5(b) became a file-level guard whose soundness follows from D2, with its
  limits stated; D5(c) gained the both-variables run. Criteria re-derived from D2, D5, and D6: 1–3,
  5, and 7 are new or rewritten, 8 now states what `typecheck` does not cover.
- 2026-09-13, implementer round (Codex, `gpt-5.6-sol`, Bridge auto-chain) entered from approved
  plan-review run `run-944f9f71-4fe3-43fc-ab0f-3868f6e24bd0`. Added `cliChildEnv` and `spawnCliChild`
  to `tests/helpers.ts`; moved all five CLI-child spawns in `tests/cli.test.ts`, `tests/mcp.test.ts`,
  and `tests/detach.test.ts` to that boundary; removed those files' `node:child_process` imports and
  caller-owned `NO_COLOR` keys; and added the two injected-`FORCE_COLOR` regressions plus
  `tests/child-env.test.ts`'s helper tests and recursive source guard. No `src/` file or pre-existing
  stderr assertion changed.
- 2026-09-13, implementation review closed at the human gate (human-operator, recorded by Claude
  Code, `claude-opus-5`). The review result is adopted below, not authored here. Its one finding was
  answered by the three D5(c) runs on a Git checkout, which meet criterion 7 (Evidence), and the
  owner authorized completion, commit, and push. The `HX-005` envelope the implementer issued was
  consumed by that Bridge-dispatched review and is cleared. Criteria 1–8 are satisfied.

## Evidence

Planning rows ran on 2026-09-13 at `245a3f2`, Node v24.14.0, npm 11.9.0, clean worktree apart from
this task file. The host shell exports `FORCE_COLOR=3` and no `NO_COLOR`, which is why the
"inherited" rows need no terminal.

- Full suite, stdout piped, inherited `FORCE_COLOR=3`: `node --import tsx --test tests/*.test.ts` →
  613 tests, 602 pass, 11 fail (the ten named in Context plus "a tilde path names a dotfile").
- Full suite under a pseudo-terminal, same shell: `script -q /dev/null npm test` → 613 tests, 602
  pass, 11 fail; `diff` of the two sorted failing-test-name lists is empty.
- Full suite, stdout piped, no `FORCE_COLOR`: `env -u FORCE_COLOR node --import tsx --test
  tests/*.test.ts` → 613 tests, 612 pass, 1 fail ("a tilde path names a dotfile").
- Full suite, stdout piped, both inherited: `NO_COLOR=1 FORCE_COLOR=1 node --import tsx --test
  tests/*.test.ts` → 613 tests, 602 pass, 11 fail, the same eleven names as the inherited
  `FORCE_COLOR=3` run; an inherited `NO_COLOR` exposes no further test.
- The three affected files, piped: `node --import tsx --test tests/cli.test.ts tests/mcp.test.ts
  tests/detach.test.ts` → 93 tests, 83 pass, 10 fail with `FORCE_COLOR=3` inherited; 93 pass, 0
  fail under `env -u FORCE_COLOR`. The detach tests pass in both.
- Hygiene failure independence: `env -u FORCE_COLOR node --import tsx --test
  tests/repo-hygiene.test.ts` → 8 tests, 7 pass, 1 fail, offending entries 105, 113, 168 (0-based
  over `git ls-files -s -z`: `spartan/tasks/0074-…`, `spartan/tasks/0082-…`,
  `tests/bridge-config.test.ts`).
- Runner injection: a one-test file `probe.test.mjs` running
  `console.log(process.env.FORCE_COLOR ?? null)` → `null` for `env -u FORCE_COLOR node --test
  probe.test.mjs` piped; `"1"` for `env -u FORCE_COLOR script -q /dev/null node --test
  probe.test.mjs`; `"1"` for piped with `FORCE_COLOR=3` inherited.
- Warning trigger, each with `FORCE_COLOR=1 NO_COLOR=1`: `node -e ''` → no warning;
  `node -e "require('node:util').styleText('red','x')"` → warning; `node --import tsx -e ''` →
  warning; `node --import tsx src/cli/main.ts --help` and `node dist/cli/main.js --help` → warning
  on stderr. `env -u FORCE_COLOR NO_COLOR=1 node --import tsx -e ''` → no warning.
- Color reads under `src/`: `grep -rnE "styleText|hasColors|isTTY|FORCE_COLOR|NO_COLOR|getColorDepth"
  src` → only `src/cli/main.ts:45`, `:253`, `:296`, all `isTTY`.
- Color variables under `tests/` before the change: `grep -rln "NO_COLOR\|FORCE_COLOR" tests` →
  `tests/mcp.test.ts`, `tests/detach.test.ts`, `tests/cli.test.ts`, holding exactly the five lines
  named in Context; `grep -n "child_process"` over those files → one
  `import { spawn } from "node:child_process";` at line 2 of each, used only by those sites.
- `tsconfig.json` → `"include": ["src/**/*.ts"]`.
- `FORCE_COLOR=1 SPARTAN_BRIDGE_PRODUCER_ISOLATED=1 node --import tsx --test tests/cli.test.ts` → 44
  tests, 35 pass, 9 fail.
- Nested-suite check: a scratch script calls `prepareProducerWorkspace` with the repository's
  automatic write scope, then `spawnSync("npm", ["run", "test"], { cwd: workspaceRoot, env: {
  ...process.env, FORCE_COLOR: "1", SPARTAN_BRIDGE_PRODUCER_ISOLATED: "1" } })` → exit 1, 613 tests,
  589 pass, 14 fail, 10 skipped. The same call with `NODE_TEST_CONTEXT: "child-v8"` added to `env`
  → exit 0, no summary lines. Inside the suite that test reports pass in both the inherited and the
  terminal runs.
- `npm run typecheck` → exit 0.
- `git log -S NO_COLOR -- tests` → only `b1153d5` (initial snapshot), so the environment shape
  predates task `0077`.
- Implementer positive checks (producer copy): `npm run typecheck` exited 0. `node --import tsx
  --test tests/child-env.test.ts` reported 3 tests / 3 pass / 0 fail. The two injected-variable
  regressions selected by `--test-name-pattern` reported 2 tests / 2 pass / 0 fail.
- Regression negative control for D5(a): with the helper's removal line temporarily changed from
  `const { FORCE_COLOR: _forceColor, ...childEnv } = env;` to
  `const { ...childEnv } = env;`, the same two-test command reported 2 tests / 0 pass / 2 fail. The
  CLI exact-equality failure began with Node's `NO_COLOR`/`FORCE_COLOR` warning, and the MCP stderr
  no longer matched `/^error: /`. Restoring the removal line returned the command to 2/2 passing.
- Source-guard negative control for D5(b): temporarily restoring the scratch line
  `env: { ...env, NO_COLOR: "1", TZ: PINNED_TZ },` at `runCli` made the selected source-guard test
  fail 0/1 and identify `cli.test.ts`. Removing that line returned
  `tests/child-env.test.ts` to 3/3 passing.
- Spawn/source checks: `rg -n "child_process" tests/cli.test.ts tests/mcp.test.ts
  tests/detach.test.ts` returned no matches; `rg -l "NO_COLOR" tests` returned only
  `tests/child-env.test.ts` and `tests/helpers.ts`; and `rg -n "spawnCliChild"` over the three
  migrated files returned the five planned call sites (three CLI, one MCP, one detach).
- Focused equivalence in the producer copy over `tests/cli.test.ts`, `tests/mcp.test.ts`,
  `tests/detach.test.ts`, and `tests/child-env.test.ts`: the clean, `FORCE_COLOR=1`, and
  `NO_COLOR=1 FORCE_COLOR=1` variants each reported 98 tests / 98 pass / 0 fail / 0 skipped.
- Whole-suite trio in the producer copy: each of the three D5(c) commands reported 618 tests / 576
  pass / 29 fail / 13 skipped, with identical failure-name sets containing none of the ten tests.
  The copy has no `.git` and its sandbox makes Git exit 128, so all 29 are Git-dependent tests in
  `tests/implementation-review.test.ts`, `tests/repo-hygiene.test.ts`, `tests/task-status.test.ts`,
  and `tests/workspace.test.ts`; this could not show criterion 7's baseline.
- Human gate, Git checkout carrying this task's changes, stdout piped:
  `env -u FORCE_COLOR -u NO_COLOR node --import tsx --test tests/*.test.ts`,
  `env -u NO_COLOR FORCE_COLOR=1 node --import tsx --test tests/*.test.ts`, and
  `NO_COLOR=1 FORCE_COLOR=1 node --import tsx --test tests/*.test.ts` → each 618 tests, 617 pass,
  1 fail, the failure in each being "a tilde path names a dotfile". Criterion 7 holds.
- Human gate, same checkout under a pseudo-terminal: `env -u FORCE_COLOR -u NO_COLOR script -q
  /dev/null npm test` → 618 tests, 617 pass, 1 fail ("a tilde path names a dotfile"); the output
  contains no `NO_COLOR' env is ignored` line.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-944f9f71-4fe3-43fc-ab0f-3868f6e24bd0 execution_id=exec-87e673e2-0455-468f-8a89-5d0342040d93 review_kind=plan verdict=pass reason_code=review_passed host=codex launcher=codex-plan-reviewer-v1 model=gpt-5.6-sol effort=high model_observed=declared_unobserved policy_digest=sha256:c032b4cea31dd45976e0e4d6a6b689590f1f0a1a368378fd8a82e546eb9525a3 spartan-bridge version=0.1.0 commit=e6539f92be0621c770b35752d35f673f5b89e663 dirty=false built_at=2026-09-13T09:21:32.781Z task_hash=sha256:dabdccb72613946b8f72ddf343a07802aee70cc71797ae0f35005fc661f46116 agents_hash=sha256:6bd68578db8fd268d33c5847ff43bbf478ca1ed9c7a17c1a34df7ed723f5b8da timestamp=2026-09-13T14:45:58.443Z
<!-- spartan-bridge:review:plan:end -->

Implementation review, adopted from Bridge run `run-5952d51c-ec33-42ef-8874-a585eb8e8bec`
(Claude Code, `claude-opus-5`, effort high; `transition-219b5c63-e7b2-482e-b9b3-5fb3ef960bba`):
runtime verdict `human_required`, `reason_code` `review_human_required`, artifact write
`skipped_human_gate`. The reviewer found the code matching D1–D6 and criteria 1–6 and 8, with one
warning, `AC7_BASELINE_UNVERIFIED`: the whole-suite runs happened in a copy without `.git`, so only a
Git-capable checkout could show criterion 7's baseline. Closed by the human-gate rows in Evidence and
the owner's authorization on 2026-09-13. No `APPROVED` verdict is synthesized for this review.

## Blockers

None.

## Next Action

None for this task. Residual outside it: the nested-suite check at
`tests/producer-write-scope.test.ts:345` cannot fail and needs its own task.

## Next Handoff

No outstanding handoff. Task completed.
