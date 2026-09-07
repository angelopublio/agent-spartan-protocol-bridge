---
protocol: "1.0.0" # x-release-please-version
id: close-check-coverage-and-stale-dist
created_at: 2026-08-18
status: completed
phase: complete
task_type: implementation
risk: routine
current_role: reviewer
next_role: none
updated_at: 2026-08-18
handoff_id: HX-007
next_handoff_id: none
---

# Cover the untested policy checks and stop a stale build from imitating a missing feature

## Objective

Every failure check the policy parser can emit is pinned by a test, and a build older than its
source is reported rather than silently obeyed.

## Context

Two informational findings from task `0015`'s implementation review, neither blocking that task,
both cheap and both with a real failure mode.

`0015` introduced seventeen `AgentsPolicyCheck` values. Eleven have tests — the eleven its D4
named. Six have none: `agent_hosts_section_duplicate`, `binding_table_missing`, `binding_row`,
`binding_duplicate`, `automation_section_duplicate`, and `task_artifact_write_grant`. All six are
reachable, and each pairs a check with a reason code. A wrong pairing would not be caught.

The second finding is older and has now cost time twice in two days. `package.json` points `bin`
at `dist/`, nothing rebuilds it, and `dist/` is gitignored, so nothing signals when it diverges
from `src/`. The failure mode is what makes it worth fixing: during `0015`'s review the first
`doctor` run printed no policy line at all, which reads as the feature having never been built
rather than as the binary being old. Earlier the same staleness produced a wrong `task_invalid`
on a valid task. In both cases the tool was confidently wrong rather than unavailable.

Task `0011`'s D3 already put a build-freshness check inside the `/spbridge` skill, but only for
this checkout and only on that path. Anyone invoking the CLI directly gets no signal.

## Scope

- `tests/agents.test.ts`: coverage for the six unpinned checks.
- `src/cli/main.ts`: the staleness signal. See D2 — `doctor` was rejected, not deferred.
- `README.md`: one line if the remedy needs the human to know something.

## Out of Scope

- Changing what the parser accepts or any reason value it returns.
- Automatically rebuilding. A tool that silently rebuilds hides the same divergence it is meant
  to surface, and a build is not a read-only operation.
- The `/spbridge` freshness check, which already exists and is not in question.

## Constraints

- The staleness signal must not make `doctor` write anything or spawn anything.
- A missing `dist/` and a stale `dist/` are different situations and must not collapse into one
  message.
- Tests must pin the reason-and-check pair, not only that a failure occurred, since the pairing
  is the thing that can silently drift.

## Acceptance Criteria

- [x] Each of the six unpinned checks has a test asserting both its `check` value and its
      `reason` value.
- [x] An exhaustiveness test fails when an `AgentsPolicyCheck` value has no coverage.
- [x] The staleness rule is the newest modification time of any file reachable under `src/`,
      compared against the modification time of `dist/cli/main.js`. No directory's own timestamp
      participates in the comparison.
- [x] A CLI invocation whose newest source file is newer than the build writes the message named
      in D3 to stderr and continues.
- [x] A test stages a source tree whose only newer file is nested — newer than both the `src/`
      directory itself and the build — and asserts the message is written. That case is the one
      the incident this task exists to catch actually took.
- [x] No message is written when the build is newer than every file under `src/`, and none is
      written when the package root derived from the running module holds no `src/`.
- [x] The recursive scan and the comparison are exposed as functions taking their inputs as
      arguments, and are tested over a nested newer source, a newer build, equal timestamps, and
      an absent source directory.
- [x] stdout is unchanged for every command.
- [x] `doctor` is untouched, and `AGENTS.md` is not amended.
- [x] Nothing rebuilds automatically.
- [x] `npm run typecheck` and `npm test` exit 0.

## Decisions

Revised after the Bridge plan review recorded `D2_PLACEMENT_OPEN`, `D1_AC_MISMATCH`, and
`SIGNAL_TEXT_UNNAMED`. All three are accepted.

### D1 - Pin the pair, and add the exhaustiveness test here

A test asserting only "this input fails" would pass with a wrong check value, which is the drift
this coverage exists to prevent. Each test asserts the `reason` and the `check` together.

The exhaustiveness test is added in this task, not left to judgement. The earlier wording offered
to decide or record why not, while the acceptance criteria already required that adding an
`AgentsPolicyCheck` without coverage fail a test. An implementer following the decision could
have skipped what the criterion demanded — which is precisely how the gap being closed here
appeared in the first place.

### D2 - The signal lives in `src/cli/main.ts`, and `doctor` is rejected

Not deferred. Three independent reasons, and the third is disqualifying.

The two incidents differ in path. The first was a `doctor` run that printed no policy line. The
second was a wrong `task_invalid` on a valid task during a `review` run, which never touches
`doctor`. A `doctor`-only warning catches one and misses the other.

The acceptance criterion is about the CLI, not about one subcommand: running from a stale build
must signal. Only the entry point sees every invocation.

And `doctor` is not permitted to check this. `AGENTS.md` enumerates a closed list of non-secret
integration facts it may check — repository readability, policy readiness, registry readability
and schema validity, launcher identifier resolution, fake-interface capability flags, Cursor
launcher executable and interface availability. Build freshness is not among them, and this task
does not amend that sentence.

That is the same mistake task `0015` caught one task ago: treating the enumeration as a category
with room in it. It is a closed list. Either an item is on it or the file is amended, and
amending it here would widen `doctor` for a fact that has nothing to do with a repository's
configuration. The entry point needs no amendment because it is not `doctor`.

Trade-off, stated rather than assumed: a warning on every invocation is noisier than one on a
command people run deliberately. It is accepted, because the failure being prevented is silent
and the warning is one line on stderr that a correct build never emits.

### D3 - One message, because the other one cannot happen

The signal warns and continues. Refusing would make the tool unusable exactly while someone is
iterating on it, and the harm is silence rather than execution.

There is one message, not two:

```
dist/ is older than src/; run npm run build
```

It goes to stderr, leaving stdout's documents byte-identical, consistent with task `0014`.

The earlier draft also named a missing-build message, and that was a mistake worth recording
rather than quietly dropping. The check lives in `src/cli/main.ts`, compiled to
`dist/cli/main.js`, and derives the package root from the module that is executing. Under that
rule `dist/cli/main.js` necessarily exists whenever the check can run — it is the running file —
and the npm `bin` target cannot start at all when it is absent, because Node fails to resolve the
module before any of this code runs. The message could never be printed. Node's own
module-not-found is the observable failure for that case, and it is clearer than anything this
task could add.

The pre-invocation missing case is real but belongs elsewhere: task `0011`'s D3 already has the
`/spbridge` skill check for a missing `dist/cli/main.js` before it invokes the CLI, which is the
one place the file's absence can be observed by something still running.

Path resolution, stated precisely because the earlier wording was wrong: `src/` and
`dist/cli/main.js` are both resolved from the package root derived from the running module — the
parent of the `dist/` directory containing it. Not `process.cwd()`, which would warn inside any
unrelated checkout that happens to contain a `src/` directory and stay silent whenever the CLI is
invoked from outside its own repository. Not the module's own directory, which would look for
`src/` inside `dist/cli/`. When that package root holds no `src/`, the copy ships no sources,
nothing is compared, and nothing is said.

**The comparison is a tree walk, not two `stat` calls, and that distinction is the whole feature.**
The rule is the newest modification time of any file reachable under `src/`, against the
modification time of `dist/cli/main.js`.

An earlier draft named a helper taking two paths, which reads two inodes: the `src/` directory
and the build file. That would not have caught the incident this task exists to catch. A
directory's modification time changes when an entry is added, removed, or renamed inside it, not
when the contents of a file already there change. The staleness in task `0015` came from editing
files nested under `src/policy/` and `src/core/`; the `src/` directory's own timestamp never
moved. A two-inode reading would have compared an old directory against a newer build and stayed
silent, which is precisely the silence being fixed.

So the scan recurses, and the case is pinned by a test that stages a tree whose only newer file is
nested deeper than the top level — newer than both the `src/` directory and the build. Both the
scan and the comparison take their inputs as arguments, so the four cases are exercised against a
staged temporary tree rather than against this repository.

Automatic rebuilding stays rejected. A tool that rebuilds on noticing staleness hides the
divergence it is meant to surface, turns a read-only command into one that writes, and makes
build timing depend on when someone happened to run a review.

## Work Completed

- Planner rounds HX-001 through HX-004 (Claude Code, Claude Opus 5, high effort, Anthropic)
  settled D1-D3. Plan review HX-005 (Cursor, cursor-grok-4.6-high-fast, effort none) approved with no findings.

- Implementer (HX-006, Cursor, cursor-grok-4.6-high-fast, effort none): accepted matching envelope HX-006. Added reason-and-check fixtures for the
  six previously unpinned `AgentsPolicyCheck` values and an exhaustiveness record over the
  union. Added a recursive newest-file scan and stale comparison in `src/cli/main.ts`; the CLI
  writes D3's message to stderr and continues. `doctor` and `AGENTS.md` were not edited. README
  was not edited: the stderr line already names `npm run build`.

- Reviewer (HX-007, Claude Code, Claude Opus 5, high effort, Anthropic): accepted matching
  envelope HX-007. Verified the implementation against every acceptance criterion, exercised the
  real binary on the default module path, and wrote only this artifact. `dist/` was rebuilt to
  run that check; it is a gitignored build product, not a product file.

## Evidence

- The six new fixtures pin: `agent_hosts_section_duplicate` / `agents_policy_invalid`,
  `binding_table_missing` / `reviewer_binding_missing`, `binding_row` / `agents_policy_invalid`,
  `binding_duplicate` / `agents_policy_invalid`, `automation_section_duplicate` /
  `agents_policy_invalid`, `task_artifact_write_grant` / `agents_policy_invalid`.
- `ALL_AGENTS_POLICY_CHECKS` is `satisfies Record<AgentsPolicyCheck, true>`; the coverage test
  compares the seen check set to that record's keys.
- Nested-stale staging: `src/` directory at T0, `dist/cli/main.js` at T1, nested file at T2.
  `newestFileMtime` equals the nested file; `staleBuildMessage` returns D3's string. Newer
  build, equal timestamps, and absent `src/` return no message.
- CLI `--help` against a staged `dist/cli/main.js` with a nested newer source: exit 0, stdout
  is `HELP_TEXT`, stderr is `dist/ is older than src/; run npm run build\n`.
- `git diff --stat` for this round: `src/cli/main.ts`, `tests/agents.test.ts`,
  `tests/cli.test.ts`, and this artifact. `AGENTS.md` and `src/core/doctor.ts` unchanged.
- `npm run typecheck` exit 0. `npm test` 107 passed, 0 failed.
- Reviewer round, real binary rather than a staged package: after `npm run build`,
  `node dist/cli/main.js doctor --repo .` wrote nothing to stderr. After `touch src/index.ts`,
  the same command wrote `dist/ is older than src/; run npm run build` to stderr, kept the seven
  `doctor` lines on stdout unchanged, and exited 0. Streams were separated into files, because a
  first attempt using `2>&1 >/dev/null` in zsh was inconclusive: `MULTIOS` tees stdout into the
  pipe as well.

## Review

<!-- spartan-bridge:review:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-c19387ae-9a17-4bb9-8511-a6ba104ded1d execution_id=exec-d2337c5a-52cc-442e-a0cf-94437f7cf7f0 review_kind=plan verdict=pass reason_code=review_passed host=cursor launcher=cursor-plan-reviewer-v1 model=cursor-grok-4.6-high-fast effort=none model_observed=declared_unobserved policy_digest=sha256:5ce5ce183767d86bbd03d6217f03b8849dd70c4a7609b5b84f750ecbb1d0100f task_hash=sha256:a1ac91656ff1c0cee4a99c04675345b554611ca65548a9c44fde79b92b17d705 agents_hash=sha256:30644e4ddfe923cc72bc6a40fd5d26c1af74682d01e4329f4c5d93016be00e7f timestamp=2026-08-18T13:27:46.234Z
<!-- spartan-bridge:review:end -->

### Implementation review (HX-007, Claude Code, Claude Opus 5, high effort, Anthropic)

Verdict: APPROVED. Accepted matching envelope HX-007; product files were read only, and only
this artifact was written.

Two claims carried the risk, and both were checked rather than taken on trust.

- **The exhaustiveness test would actually fail.** `ALL_AGENTS_POLICY_CHECKS` is
  `satisfies Record<AgentsPolicyCheck, true>`, so a new union member missing from the record is a
  typecheck error, and an extra key that is not in the union is one too. The runtime assertion
  then compares the checks the fixtures actually produced against that record's keys. Adding a
  union member therefore fails twice over: once at the type level for the record, once at the
  assertion for the missing fixture. That is a criterion a wrong implementation reproves, not one
  any implementation satisfies.
- **The staleness rule reads nested files, not the directory inode.** The discriminating test
  stages `src/` at T0, `dist/cli/main.js` at T1, and a nested file at T2, and asserts
  `srcDirStat.mtimeMs < buildStat.mtimeMs < nestedStat.mtimeMs` before asserting the message. An
  implementation that stat'd `src/` itself would see the directory as older than the build and
  report fresh, failing that assertion. This is the exact shape of the incident the task exists
  to catch.

The path no test covers is the default `moduleFile`, since every test injects it, so it was
exercised directly. A fresh build printed no warning; touching one source file produced the
warning on stderr with `doctor`'s stdout byte-identical and exit 0. `packageRootFromRunningModule`
resolved the real install layout correctly by walking up to the `dist` component.

Scope held. `git status` for the round is `src/cli/main.ts`, `tests/agents.test.ts`,
`tests/cli.test.ts` and the two task artifacts; `src/core/doctor.ts` and `AGENTS.md` are
untouched, and nothing in the change rebuilds anything. `npm run typecheck` clean; `npm test` 107
pass, 0 fail, up from 104.

Findings:

- `DEFAULT-MODULE-UNPINNED` (info): every test passes `moduleFile` explicitly, so the default
  `fileURLToPath(import.meta.url)` and the upward walk to a real `dist/` are covered by no test.
  This round verified them by hand and they work. Pinning them would need a real build inside a
  test, which is a poor trade; recording the gap is the cheaper half.
- `STDERR-NOW-SHARED` (info): stderr has become a channel with two writers. Task `0014` plans a
  ten-second progress ticker on the same stream, and whoever implements it has to decide where
  this one-line warning sits relative to the ticker, or it will be printed once at the top and
  then scrolled away by exactly the output meant to reassure the reader.
- `SCAN-BEFORE-PARSE` (info): the recursive `src/` walk runs before `parseArgv`, so it happens on
  `--help`, on an unparseable argument list, and on every `mcp` stdio start. The tree is small
  and the cost is not measurable today; it is unconditional I/O ahead of argument validation, and
  worth remembering if `src/` ever grows.

## Blockers

None.

## Next Action

None. Every acceptance criterion is checked, `npm run typecheck` and `npm test` have recorded
outcomes, the plan review and the implementation review are both `APPROVED`, and no blocker
remains. Committing is the human-only gate.

## Next Handoff

No outstanding proposal. This task is closed.

Non-binding note for the human: the working tree also carries the planning edit to
`spartan/tasks/0017-make-write-detection-diagnosable.md`, which belongs to a different task. The
paths are disjoint, so the two commits are still separable by pathspec. The three informational
findings above are candidates for a follow-up, not work on this one.
