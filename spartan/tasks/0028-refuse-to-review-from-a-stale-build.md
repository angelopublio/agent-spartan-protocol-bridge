---
protocol: "1.0.0" # x-release-please-version
id: refuse-to-review-from-a-stale-build
created_at: 2026-08-19
status: completed
phase: complete
task_type: implementation
risk: material
current_role: reviewer
next_role: none
updated_at: 2026-08-20
handoff_id: HX-006
next_handoff_id: none
---

# Refuse to review from a stale build

## Objective

A `review` started from this checkout with `dist/` older than `src/` stops before it spawns anything,
tells the human to build, and creates no run. Commands that only read stay as they are.

## Context

**The guard exists and does not guard.** `src/cli/main.ts:321-327` computes the stale-build message
before the arguments are parsed and writes it to stderr for every command, then execution continues
regardless. Task `0016` chose warning over refusing.

**What task `0016` actually argued.** Its D3 reads: "The signal warns and continues. Refusing would
make the tool unusable exactly while someone is iterating on it, and the harm is silence rather than
execution." The reason was developer ergonomics during iteration, not the maturity of the build. Its
D2 added a second reason for the placement: "The acceptance criterion is about the CLI, not about one
subcommand: running from a stale build must signal. Only the entry point sees every invocation."

**What changed is the second half of that sentence.** Task `0021` put the extraction fix that recovers
a verdict when a reviewer writes prose after its JSON, and the retention that makes a failed extraction
diagnosable, into the build. Running `review` stale now runs without both — so the harm on that one
command is no longer silence, it is a review that executes, fails the way task `0021` closed, and
leaves nothing to diagnose it with. `0016` D3's premise holds for every command that reads and fails
for the two that act.

**It happened on 2026-08-19.** A `review` of task `0022` was started from the terminal, printed
`dist/ is older than src/; run npm run build`, and kept going against a build predating task `0021`.
The run was interrupted by hand.

**The two entry points disagree.** `skills/spbridge/SKILL.md` step 3 already refuses in this same
situation and tells the human to build and invoke again. The terminal path only warns. The same check
has two severities, and the stricter one protects the person who has the skill while the person typing
the command directly gets none — which is backwards.

**The blast radius is small and worth stating.** The check runs only when the CLI is executing from a
package root that also contains `src/`, which is this repository's own checkout. An adopter running an
installed `spartan-bridge` has no `src/` to compare against and is unaffected by anything in this task.

## Scope

- `src/cli/main.ts`: the stale-build branch, its placement relative to argument parsing, and the exit
  path it takes for the commands that refuse.
- `tests/cli.test.ts`: the refusal, the unchanged commands, the absent-`src/` case, and the two
  existing tests that stage a stale package only in order to reach the `review` path.
- `skills/spbridge/SKILL.md`: step 3, so it states that the runtime enforces this rather than
  duplicating the check as a skill rule.
- `docs/DECISIONS.md`: one entry recording the change from warning to refusal and why the earlier
  choice no longer holds for the two commands that act.

## Out of Scope

- The staleness comparison itself. `packageRootFromRunningModule`, `newestFileMtime`, `isBuildStale`,
  and `staleBuildMessage` keep their current semantics and their current results; only what the CLI
  does with the answer changes.
- The message text. `STALE_BUILD_MESSAGE` is task `0016`'s one string and no second wording is added.
- Any escape flag or environment override. See D3.
- The MCP server's own behaviour beyond refusing to start, and any change to how a program caller sees
  an error.
- Anything about how `dist/` is produced or when it is rebuilt.

## Constraints

- A run directory is never created for a refused invocation, so the run history stays a record of runs
  that actually ran.
- The refusal is distinguishable from a review outcome: it exits before any run exists, so there is no
  status document, no reason code, and nothing on stdout.
- Every invocation still signals a stale build, on every one of the seven commands `parseArgv` returns.
  That is task `0016` D2's requirement and this task does not relax it; only the action after the
  signal differs by command.
- Behaviour is unchanged for every invocation whose build is current, byte-for-byte on both streams.
- An installed package without `src/` behaves exactly as today.

## Decisions

### D1 - Refuse where the build is load-bearing; warn where it is not

The check is consulted for all seven kinds `parseArgv` returns, and the action divides them:

- **Refuse:** `review` and `mcp-stdio`. Both spawn a reviewer and write the task artifact with
  whatever build is installed, so a stale binary produces a stale action.
- **Warn and continue:** `status`, `events`, `doctor`, `help`, and the `usage` error. They read
  persisted bytes, report readiness, print help, or reject an argument line. A stale binary gives at
  worst a stale answer. That also keeps `doctor` usable when something is wrong, which is exactly when
  it is run.

This answers task `0016` D3 on its own terms rather than around it. Its reason was that refusing would
make the tool unusable while someone is iterating on it; five of the seven commands stay exactly as
usable as they are today, and the two that stop are the two whose entire output would have been
produced by the stale code. It leaves `0016` D2 intact: every invocation still signals.

The split means the check is consulted after the command is known rather than before it, so the branch
moves from before `parseArgv` (`src/cli/main.ts:321-327`) to immediately after it and before the
`help` branch. That is one move of the existing branch, not a new mechanism, and it keeps the message
reaching every kind.

Two existing tests stage a stale package only in order to assert the `review` stderr ordering
(`tests/cli.test.ts:616` and `:709`). Under this decision that ordering is unreachable, because a
stale `review` no longer reaches `runReview`. They stage a current build and keep every remaining
assertion; staleness was incidental to what they pin.

### D2 - Refuse before a run exists

The refusal happens before `runReview` is called, so no run directory, status document, or event is
created. A refused invocation is not a failed run and must not look like one in the run history — the
opposite choice would put entries in `.spartan-bridge/runs/` for work that never started, and every
later reader would have to learn to skip them.

### D3 - No escape flag

A stale build has exactly one honest remedy and it takes seconds. An override flag would exist to be
used in a hurry, which is precisely when the guard matters, and it would have to be documented,
tested, and then reasoned about by everyone who later reads a run that used it. `npm run build` is the
escape. `parseArgv` gains no option, and the refusal reads no value from `env`.

### D4 - The skill defers to the runtime rather than duplicating it

`skills/spbridge/SKILL.md` step 3 currently performs its own comparison. Once the runtime refuses, the
skill states that fact and stops checking, so the rule has one implementation. A skill that keeps its
own copy will drift from the runtime's, and the copy is the one nobody tests.

### D5 - A refusal writes only the existing message, on stderr, and exits 1

Exit 1 is the code `review` already returns when it created no run (`src/cli/main.ts:369-371`), so a
refusal introduces no new exit vocabulary and stays distinct from `0` (success) and from the `2` a
usage error returns (`src/cli/main.ts:333-335`).

Nothing goes to stdout. On `review` that keeps task `0014`'s contract that stdout carries documents
only, and there is no status document to write because D2 stops before one exists. On `mcp-stdio` the
reason is stronger: stdout is the JSON-RPC channel, so any byte written there is a malformed frame to
a client that may already be reading it.

The refusal prints `STALE_BUILD_MESSAGE` and nothing else. A refusal-specific wording would be a
second string for one condition, and the human's next action is the same either way.

### D6 - Record the reversal in `docs/DECISIONS.md`, quoting what it supersedes

`docs/DECISIONS.md` carries no stale-build entry at all today: task `0016`'s D3 lives only in that
task's artifact, so a reader of the log cannot see that refusing was considered once and declined. The
new entry records the split D1 draws and quotes `0016` D3's stated reason rather than paraphrasing it,
because a reversal is only judgeable against what was actually argued — and this reversal is partial,
which a paraphrase would hide.

## Acceptance Criteria

- [x] (D1, D2, D5) With `dist/` older than `src/`, `review` writes exactly
      `dist/ is older than src/; run npm run build\n` to stderr, exits 1, spawns no child, and creates
      no directory under `.spartan-bridge/runs/`, asserted by listing that directory before and after.
- [x] (D5) Nothing is written to stdout on that refused `review` path, asserted over captured bytes.
- [x] (D1, D5) `mcp-stdio` under the same condition writes the same single line to stderr, exits 1,
      writes nothing to stdout, and does not begin serving, asserted without a client.
- [x] (D1) `status`, `events`, and `doctor` still run with a stale build, still print what they print
      today, and still write the warning line to stderr.
- [x] (D1) `--help` with a stale build still exits 0 with `HELP_TEXT` on stdout and the warning line on
      stderr, and an unparseable argument line still exits 2 with its `error:` line and the warning
      line on stderr.
- [x] (D1) The two tests that stage a stale package to assert the `review` stderr ordering
      (`tests/cli.test.ts:616`, `:709`) stage a current build, and their stderr assertions keep every
      line except the warning.
- [x] (D3) `parseArgv`'s accepted option set is unchanged, and the refusal branch reads nothing from
      `env`, so no flag and no environment variable bypasses it.
- [x] (D1, D5) With a current build, all seven kinds — `help`, `usage`, `review`, `status`, `events`,
      `doctor`, `mcp-stdio` — write stdout and stderr byte-identical to the current build's output,
      with no warning line on any of them.
- [x] (D1) With no `src/` beside the running module, no message is written and every command behaves
      exactly as today, asserted from a fixture package root; `newestFileMtime`, `isBuildStale`, and
      `staleBuildMessage` still return the values `tests/cli.test.ts:345-348` pins for that case.
- [x] (D4) `skills/spbridge/SKILL.md` step 3 states that the runtime refuses, and instructs the session
      to perform no comparison of `src/` against `dist/`.
- [x] (D6) `docs/DECISIONS.md` gains one entry recording D1's split and quoting task `0016` D3's stated
      reason for warning.
- [x] `npm run typecheck` and `npm test` exit 0.

## Work Completed

- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-19: created this task after a
  `review` started against a build predating task `0021`. No product file was edited.
- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20, handoff `HX-002`: ran the
  `## Artifact authoring` pass, reading the criteria against the decisions as a set. Five corrections,
  each a decision change with its criteria re-derived rather than a criterion patched in place. D1 was
  under-specified: it named five of the seven kinds `parseArgv` returns, leaving `help` and `usage`
  undecided while the move it prescribes changes exactly where they are reached; it now names all
  seven and states that every invocation still signals, which keeps task `0016` D2 rather than
  silently dropping it. Exit 1 and the stdout silence were pinned by criteria that no decision
  supported, so D5 now decides them and gives `mcp-stdio` its own reason. D3 had no criterion at all;
  it has one. The absent-`src/` criterion asserted "no check runs", which `staleBuildMessage` does not
  do and Out of Scope forbids changing, so it now asserts the observable outcome. The
  `docs/DECISIONS.md` row rested on Scope alone; D6 supplies its reason. Context was corrected: it
  attributed to task `0016` a reason that task did not give — its D3 argued iteration ergonomics, not
  the completeness of the build — and the reversal is partial, which the paraphrase concealed. Scope
  gained `tests/cli.test.ts` and Out of Scope gained the message text. No product file was edited.
  `next_role` set to `reviewer` in this same edit; `## Next Handoff` carries no envelope, because the
  review is dispatched by this session rather than pasted by the human.
- Implementer (Cursor, cursor-grok-4.6-high-fast, effort none), 2026-08-20,
  handoff `HX-003`: implemented D1–D6. Moved the stale-build branch to immediately after `parseArgv`
  and refused `review` and `mcp-stdio` with `STALE_BUILD_MESSAGE` on stderr, empty stdout, and exit 1
  before `runReview` or `serveMcpStdio`. Readers still warn and continue. No parse option and no env
  read on the refusal branch. Skill step 3 now defers to the runtime. `docs/DECISIONS.md` gained
  D-031 quoting task `0016` D3. The two review-stderr tests now stage a current build.
- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20: re-addressed the HX-004
  envelope only. The round wrote it to Claude Code as `reviewer.implementation`, which `AGENTS.md`
  binds to Codex on `gpt-5.6-terra`; this is the second implementation round to substitute the
  planner's own host for the bound reviewer. Verified the change first: five added lines in
  `src/cli/main.ts`, `npm run typecheck` exit 0, `npm test` 201 passed. Added to the review prompt the
  three things the diff raises and the artifact does not: the stderr-ordering assertions dropped from
  the two rewritten tests, the 73 lines of pre-change anchors removed from `## Evidence` rather than
  added to, and the skill's own staleness check now deferred to the runtime. No criterion, decision,
  or product file was touched.
- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20, handoff `HX-005`: restored
  `## Evidence`. The anchors are recovered verbatim from `875e843^`, the tree the plan argued from,
  and sit under a heading that says which tree their line numbers belong to; the implementation
  evidence is kept below under its own heading. Nothing was rewritten from memory. This round was
  taken by the planner rather than the implementer the envelope named: the finding asks for no
  product-file change, and the text being restored is the planning round's own, recoverable from git
  rather than reconstructed. No criterion, decision, or product file was touched.
- Reviewer (Codex, gpt-5.6-terra, effort high, OpenAI), 2026-08-20, handoff `HX-006`: re-reviewed
  the implementation. The restored pre-change anchor block is byte-for-byte identical to the
  `## Evidence` block in `git show 875e843^:spartan/tasks/0028-refuse-to-review-from-a-stale-build.md`,
  apart from the new heading and explanation that identify that tree; `### After the change` retains
  the implementation evidence. A cold reader can therefore audit both the plan's original argument
  and its implementation from this artifact. The planner substitution was appropriate because it
  restored planning material from git without changing the product. No product, test, skill, or
  decision-log file changed after implementation commit `875e843`.

## Evidence

### Before the change, as the planning round recorded it

These are the anchors the plan argued from. They describe the tree at `875e843^` and are kept so a
cold reader can check the argument rather than take it. The line numbers are that tree's.

- `src/cli/main.ts:17`: `STALE_BUILD_MESSAGE = "dist/ is older than src/; run npm run build"`.
- `src/cli/main.ts:321-327`, computed and written with no branch on the outcome, with
  `const parsed = parseArgv(argv);` following on `:328`:

  ```ts
  const packageRoot = packageRootFromRunningModule(moduleFile);
  if (packageRoot !== undefined) {
    const warning = await staleBuildMessage(packageRoot);
    if (warning !== undefined) {
      stderr.write(`${warning}\n`);
    }
  }
  ```
- `src/cli/parse.ts:2-8`: the seven kinds are `help`, `usage`, `review`, `status`, `events`, `doctor`,
  and `mcp-stdio`. D1 names all seven.
- `src/cli/main.ts:369-371`, the existing exit 1 for a `review` that created no run:

  ```ts
  if (!outcome.createdRun) {
    stderr.write(`error: ${outcome.error ?? "review failed"}\n`);
    return 1;
  }
  ```
- `src/cli/main.ts:333-335`, the exit code a refusal must stay distinct from:

  ```ts
  if (parsed.kind === "usage") {
    stderr.write(`error: ${parsed.message}\n`);
    return 2;
  }
  ```
- `src/cli/main.ts:294-308`: `staleBuildMessage` calls `newestFileMtime(path.join(packageRoot, "src"))`
  unconditionally and `isBuildStale` returns `false` when either mtime is `undefined`. With no `src/`
  the comparison still runs and returns no message, which is why the criterion asserts the message and
  not the absence of a check.
- Task `0016` D3, the reasoning superseded, quoted rather than described: "The signal warns and
  continues. Refusing would make the tool unusable exactly while someone is iterating on it, and the
  harm is silence rather than execution."
- Task `0016` D2, the requirement kept: "The acceptance criterion is about the CLI, not about one
  subcommand: running from a stale build must signal. Only the entry point sees every invocation."
- `grep -n "stale\|dist/ is older" docs/DECISIONS.md` returns nothing; the log's last entry is `D-030`
  at `docs/DECISIONS.md:239`. Task `0016`'s choice was never recorded there, which is D6's reason.
- `tests/cli.test.ts:352-363`: `--help` against a staged stale package asserts exit 0, stdout
  `HELP_TEXT`, stderr `${STALE_BUILD_MESSAGE}\n`. That assertion survives D1 unchanged.
- `tests/cli.test.ts:616-657` and `:709-736`: both stage a stale package, then call `main(["review",
  …], …, staged.buildFile, …)` and assert exit 0 with a status document on stdout and stderr beginning
  `${STALE_BUILD_MESSAGE}`. These are the two assertions D1 invalidates.
- `tests/cli.test.ts:345-348`: the absent-`src/` case already pins `isBuildStale(undefined, …) ===
  false` and `staleBuildMessage(absentSrc.root) === undefined`.
- `skills/spbridge/SKILL.md` step 3 refuses in the same situation and tells the human to build and
  invoke again.
- 2026-08-19: `spartan-bridge review --repo . --task spartan/tasks/0022-…md` printed the message and
  proceeded; `find src -newer dist/cli/main.js -name '*.ts'` listed `contracts.ts`, `review.ts`,
  `serialize.ts`, `store.ts`, and `cursor.ts`, so the run was executing without task `0021`'s
  extraction fix and retention. The run was interrupted by hand.
- `dist/` is git-ignored (`.gitignore:8`), so a rebuild is local and enters no commit.
- Checks run this round, 2026-08-20: `npm run typecheck` exit 0; `npm test` 193 passed, 0 failed.
- Bridge run `run-2a15877b-42f4-43b0-987b-aa6d665a6fef`, 2026-08-20: the first plan review this
  repository dispatched without a pasted prompt. `awaiting_implementer` in 48s, host `codex`, launcher
  `codex-plan-reviewer-v1`, model `gpt-5.6-sol`, effort high, verdict `pass`, reason
  `review_passed`, `task_write_state: written`.
- Artifact defect observed in that write, 2026-08-20: the runtime's marked region landed directly
  under `## Review` and the task template's own `Verdict: PENDING` block survived below it, so the
  section carried two verdicts. `spliceRegion` at `src/core/task-write.ts:227` inserts after the
  heading and leaves the rest of the section, which is the one-writer boundary working as designed.
  It is not specific to this task: every artifact created from the template meets it on its first
  Bridge review. Removed here by the producer, and routed to task `0024`, which owns the sibling
  defect in `## Next Handoff`.
  Both ran against an unmodified `src/` and `tests/` — this round edited only this task artifact, so
  the two assertions D1 invalidates are still among the 193 that pass.
- `node dist/cli/main.js doctor --repo .`, 2026-08-20: `codex-plan-reviewer-v1: executable resolved;
  interface available`, so the mapped `reviewer.plan` adapter works and the Bridge dispatches this
  plan review. `find src -newer dist/cli/main.js -name '*.ts'` returned nothing.

### After the change

- `src/cli/main.ts:321-331`: after `parseArgv`, the existing stale message is still written for every
  kind; `review` and `mcp-stdio` then `return 1` before any run or MCP serve starts.
- `parse.ts` unchanged. `tests/parse.test.ts` still pins the accepted option set and now also rejects
  `--allow-stale` and `--force` on `review`.
- `skills/spbridge/SKILL.md` step 3: "Perform no comparison of `src/` against `dist/`." The runtime
  refuses; the session does not compare.
- `docs/DECISIONS.md` D-031 quotes task `0016` D3's stated reason and records D1's split.
- Checks this round, 2026-08-20: `npm run typecheck` exit 0; `npm test` 201 passed, 0 failed.
- Plan-review evidence and the 2026-08-19 incident remain in Context; the old pre-`parseArgv` branch
  is gone.
- Implementation review, 2026-08-20: `npm run typecheck` exit 0; `npm test` 201 passed, 0 failed;
  `node --import tsx src/cli/main.ts doctor --repo .` exit 0, reporting a readable repository,
  resolved policy, valid registry, and available Cursor and Codex launcher interfaces.

## Review

<!-- spartan-bridge:review:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-2a15877b-42f4-43b0-987b-aa6d665a6fef execution_id=exec-91a19343-606f-49a9-8044-a4700c0e7553 review_kind=plan verdict=pass reason_code=review_passed host=codex launcher=codex-plan-reviewer-v1 model=gpt-5.6-sol effort=high model_observed=declared_unobserved policy_digest=sha256:c032b4cea31dd45976e0e4d6a6b689590f1f0a1a368378fd8a82e546eb9525a3 task_hash=sha256:1ad3a3b08ae25e82574827bd5ba8a61a70d1ba841023733383282c27614f206c agents_hash=sha256:9691d3f5862617e4f0a318370e004ca6ae5400a5b7f943f7d35c3bc803bdf790 timestamp=2026-08-20T19:01:03.952Z
<!-- spartan-bridge:review:end -->

### Implementation review — Codex, gpt-5.6-terra, effort high (2026-08-20)

Verdict: APPROVED

Findings:

- None. The D1–D6 product change, its tests, and the skill deferral remain as approved in HX-004.
  The sole HX-004 finding is resolved: the pre-change anchors match `875e843^` verbatim and are
  explicitly labelled with the tree their line numbers describe, while the implementation evidence
  remains below them. The planner's restoration was the right substitution for the named implementer:
  it was a planning-artifact-only repair from an identified git tree, with no product change.

## Blockers

None.

## Next Action

None; the task is complete.

## Next Handoff

No follow-up work is identifiable.
