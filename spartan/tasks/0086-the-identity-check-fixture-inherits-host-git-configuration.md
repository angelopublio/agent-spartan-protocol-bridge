---
protocol: "1.1.1" # x-release-please-version
id: the-identity-check-fixture-inherits-host-git-configuration
created_at: 2026-09-14
status: active
phase: planning
task_type: planning
risk: routine
current_role: planner
next_role: planner
updated_at: 2026-09-14
handoff_id: none
next_handoff_id: HX-001
---

# The identity-check fixture inherits the host's git configuration

## Objective

The throwaway-repository test in `tests/repo-hygiene.test.ts` gives the same result on every machine,
whatever the global, system or environment-injected git configuration says. When it fails, the
failure means the reading path it pins is broken, not that one contributor's configuration differs
from another's.

## Context

Task `0081` added the test `tracked listings include unstaged changes without following symlinks`.
It builds a repository under the OS temporary directory, runs `git init` and `git add` there, and
asserts what the index and working-copy listings hold. `fixtureGitEnvironment` removes the six
repository-selecting names in `FIXTURE_GIT_ENVIRONMENT_NAMES` from the environment it passes to
those calls. Every other variable is inherited, and git still reads the global and system
configuration files.

The implementation review of `0081` recorded this as `FIXTURE_HOST_GIT_CONFIG` (info). On 2026-09-14
the owner accepted it for `0081` and queued this task. The owner's own machine runs the suite green,
so this is a latent failure, not a current one. It surfaces after a configuration change or on a
machine configured differently.

The failure does not point at its cause (E-1). The assertion names the git subcommand that failed,
but nothing in it mentions configuration, so a reader's first suspicion is the code under test.

The real-checkout scan is a different case. Its working-copy listing inherits configuration on
purpose, because it mirrors what `git add` would stage on that machine, clean filters included, and
that is what a commit from that machine would write. Only the fixture has no reason to inherit.

## Scope

- `tests/repo-hygiene.test.ts` — the environment `fixtureGitEnvironment` builds for the throwaway
  repository, and, if a decision calls for it, the fixture's assertion messages.
- `docs/DECISIONS.md` — only if a decision changes what `D-080` states about the fixture.
- This task file.

## Out of Scope

- The environment and configuration the real-checkout scan inherits (task `0081`, D1).
- The four matchers, their sets, and the finding shape.
- Git-dependent failures inside an isolated producer sandbox, which cannot run `git` at all (task
  `0081`, E-12 and E-15).
- Other test files that initialize git repositories. A planner round that finds the same class
  there records it rather than widening this task.

## Constraints

- The fixture must not depend on `/dev/null`. The producer sandbox denies opening it, which is what
  stopped `git init` there during `0081`.
- The removal of the six repository-selecting variables stays. This task adds to the fixture's
  isolation and gives none of it up.
- The symlink and nested-symlink assertions keep their meaning.
- No machine-local configuration may be changed. The fix lives entirely in the test file.
- The whole task is verifiable in this repository with no external observation.

## Decisions

To be settled by the planner round.

- **How the fixture excludes host configuration.** Candidates:
  - `GIT_CONFIG_GLOBAL` pointing at an empty file inside the fixture's own temporary directory,
    together with `GIT_CONFIG_NOSYSTEM=1`;
  - `-c` overrides on each call;
  - both.

  Whichever is chosen must also answer configuration injected through the environment
  (`GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT` and the numbered key and value variables). It must
  also confirm, against git's documentation or a probe, that the XDG global file is covered as well
  as `~/.gitconfig`.
- **Whether the fixture's assertions name their case**, so a failure says which expectation
  diverged and, where git itself refused, that host configuration is a candidate cause.
- **Whether `D-080` needs a sentence.** It currently says the fixture removes repository-selecting
  variables and says nothing about configuration.

## Acceptance Criteria

To be derived from the decisions, last. E-1's input is the regression case every criterion set must
include.

## Work Completed

- 2026-09-14 — task created by Claude Code (`claude-opus-5`, effort high, Anthropic) at the owner's
  request when `0081` closed. The round reproduced the failure (E-1), checked a second suggested
  cause (E-2), and recorded the baseline (E-3).

## Evidence

- **E-1 — a global excludes file fails the fixture test.** From the checkout root on 2026-09-14,
  `<tmp>/ignore` held the single line `*.txt`, and `<tmp>/excludes.gitconfig` held:

  ```text
  [core]
  	excludesFile = <tmp>/ignore
  ```

  `GIT_CONFIG_GLOBAL=<tmp>/excludes.gitconfig node --import tsx --test --test-reporter=tap tests/repo-hygiene.test.ts`
  reported tests 9, pass 8, fail 1, skipped 0:
  - tests 1 to 8 passed, including the four real-checkout scans;
  - `not ok 9 - tracked listings include unstaged changes without following symlinks` failed with
    `git add must succeed` and `1 !== 0` (`expected: 0`, `actual: 1`, `operator: 'strictEqual'`),
    raised from the fixture's explicit `git add -- staged.txt`.
- **E-2 — `core.symlinks=false` does not fail it.** The same command with `GIT_CONFIG_GLOBAL`
  pointing at a file holding `[core]` / `symlinks = false` reported tests 9, pass 9, fail 0, skipped
  0. The review named this setting as a possible cause, but it is not a reproducing input on this
  machine and must not be written as a failing criterion.
- **E-3 — baseline.** At `20ace06`, `npm test` in the live checkout reports tests 619, pass 619,
  fail 0, skipped 0 (task `0081`, E-20). `fixtureGitEnvironment` and the fixture test live in
  `tests/repo-hygiene.test.ts`.

## Review

Verdict: PENDING

Findings:

- None recorded.

## Blockers

None.

## Next Action

A planning round settles the three decisions, derives the acceptance criteria from them with E-1 as
the regression case, and lets the Bridge dispatch the plan review.

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
Open `spartan/tasks/0086-the-identity-check-fixture-inherits-host-git-configuration.md` (handoff HX-001).

Act as planner. Settle the three decisions and derive the acceptance criteria from them, with E-1 as the regression case; the round succeeds when every criterion names the decision it follows from and no decision is left open.
Run the relevant repository checks and update the same task file.

Return only the next handoff, or a completion notice if no work remains.
```
