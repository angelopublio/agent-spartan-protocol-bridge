---
protocol: "1.1.0" # x-release-please-version
id: an-auto-chain-leaves-a-stale-dist-that-blocks-the-next-review
created_at: 2026-09-03
status: completed
phase: done
task_type: implementation
risk: material
current_role: human-operator
next_role: none
updated_at: 2026-09-04
handoff_id: HX-007
next_handoff_id: none
---

# An auto-chain that edits `src/` leaves a stale `dist/` that refuses the next review

## Objective

A chain that edited `src/` in this repository ends by telling the operator, in
the output they are already reading, that the runtime must be rebuilt before
the next round. The stale-build refusal itself is unchanged: the operator
learns at the end of the chain what they currently discover as an unexplained
`exit 1` when they start the next one.

## Context

Observed on 2026-09-03 across the `0064`, `0067` and `0069` chains. The mapped
implementer's job here is to edit `src/`; it cannot rebuild, because `dist/` is
outside the automatic write scope and the producer write-scope guard locks the
tree; so every such chain ends with `dist/` older than `src/`, and the
stale-build refusal then exits 1 on the next `review`. On `0069` that blocked
the cycle-2 dispatch three separate times, each cleared only by a human
`npm run build`.

**Where the earlier reading of this defect was wrong.** Three premises this
artifact carried have been checked and none survived intact:

- The refusal is D-031 (task `0028`), not task `0060`. It lives in `main()`
  (`src/cli/main.ts:419-427`), runs after `parseArgv`, signals on every CLI
  kind, and exits 1 only for `review` and `mcp-stdio`. Task `0060` contributed
  D-062, which turns a detached child's exit on that refusal into a terminal
  `wait` document with `reason_code: "stale_build"`.
- **The chain is never interrupted.** The successor implementation review is
  dispatched in-process by `dispatchImplementationReview`, which calls
  `runReview` directly (`src/core/transition.ts:1192-1212`). D-062 already
  states this. A stale `dist/` cannot stop a running chain; it meets only the
  *next* invocation of the CLI.
- **A human is present when it bites.** That next invocation is a human-started
  round — the operator's next `/spbridge`, or an `--after-run` continuation
  they type. The build the refusal asks for is a one-line command, run by
  someone who is at the keyboard deciding to start a round.

So the objective this task can honestly serve is not "the chain repairs
itself". It is "the operator is told, at a defined point, what the chain left
behind". That is the whole change.

**Why the previous design was dropped.** Six plan-review cycles (commit
`b7249c2`) elaborated an exemption: a two-digest baseline persisted on the
transition record, a new shared traversal module, and a five-condition
predicate that let one `review` invocation proceed on a stale runtime. Every
finding against it was correct and every answer grew it — seven decisions,
thirty-one acceptance criteria, no approval. An out-of-band Codex second
opinion (read-only, `gpt-5.6-sol`, 2026-09-04) named the trade plainly: that
machinery buys the ability to skip a build a human is already positioned to
run, and it adds persisted state that D-031 must then be trusted to interpret.
The same opinion confirmed the remaining finding,
`SOURCE_BYPASS_CONTRADICTION`, was an overclaim rather than a safety defect —
a preserved or backdated mtime already bypasses D-031 today, and no exemption
can weaken a refusal that never fires.

## Scope

- `src/cli/main.ts` — the `wait` terminal branch (`:471-477`), where the
  chain's terminal document is printed. One line is added after it under the
  condition D3 pins. Nothing else in `main()` changes; the D-031 block at
  `:419-427` is untouched.
- `agent-skill/skills/spbridge/SKILL.md` — step 4, one sentence (D4).
- `README.md` — the "Dogfooding" section, the same standing rule.
- `docs/DECISIONS.md` — one dated entry.
- Tests: `tests/cli.test.ts` (the new line's presence and absence),
  `tests/detach.test.ts` if the terminal-document path is asserted there,
  `tests/spbridge-skill.test.ts` (step 4's new sentence).

## Out of Scope

- Changing D-031's predicate, its exit codes, or the set of CLI kinds it
  refuses. No exemption, no override flag, no environment variable.
- Any new field on `TransitionStatusDocument`, or any new persisted state.
- A content digest of `src/` or `dist/`, and any new tree traversal.
- The Bridge running `npm run build`, or any other repository-defined command.
- Admitting `dist/` to the automatic write scope.
- D-031's existing blind spot for a source edit whose mtime does not advance.
  It is unchanged and this task does not claim to close it.
- `src/core/transition.ts`, `src/core/contracts.ts`,
  `src/adapters/producer-write-scope.ts`, `src/core/snapshot.ts`,
  `src/cli/task-status.ts` — none is touched.

## Constraints

- English artifact.
- No behaviour change to any existing exit code, stdout document, or
  `reason_code`.
- The new output goes to stderr, so no consumer parsing the `wait` document on
  stdout is affected.
- No new persisted state, in any file, under any directory.
- `SCHEMA_VERSION` stays `2`.
- `npm run typecheck` / `npm run build` clean; `npm test` no new failure.

## Decisions

- **D1 (pinned) — the Bridge runs no build.** Unchanged from the previous
  design, and for the same two reasons, either sufficient. Running
  `npm run build` means executing whatever the repository's `package.json`
  names: repository-controlled code, in the runtime's own process tree. Every
  child the Bridge spawns today is an official-client launcher resolved
  through the user-local registry with a fixed argv table and a
  forbidden-token audit, and this task is not where that changes. Separately,
  in this repository the build would install the `src/` the review is about to
  judge as the runtime that judges it — D-031 exists to stop a review running
  on code nobody built, and a mid-chain rebuild would do exactly that.

- **D2 (pinned) — no exemption, and no new state.** D-031's predicate, its
  message, its exit codes and its per-kind split stay byte-identical. Nothing
  is persisted, nothing is compared, nothing is trusted. The refusal keeps
  firing on every stale runtime, including the one a chain just created; what
  changes is only that the operator was told about it first. This is a
  deliberate reversal of the previous design, and its cost is stated in
  D5.

- **D3 (pinned) — where the notice goes, and when.** In `main()`'s `wait`
  branch, after the terminal document has been written to stdout
  (`src/cli/main.ts:471-477`) and only when `outcome.done` is true, call the
  existing `staleBuildMessage(packageRoot)` once more. When it reports
  staleness, write one line to **stderr** naming the action:
  `run npm run build before the next /spbridge round`. When it does not, write
  nothing. The stdout document is not modified, the exit code is not modified,
  and no other command gains a line. `wait` is the right place because it is
  the command the operator is watching when a chain ends, and because it is a
  reader kind — D-031 already only warns there, so the process is not refusing
  anything at that moment.

- **D4 (pinned) — the operator loop states the rule.**
  `agent-skill/skills/spbridge/SKILL.md` step 4 gains one sentence: after a
  chain reaches a terminal document, a stale-build line on stderr means run
  `npm run build` before the next `/spbridge`, and never as a
  `--after-run` continuation. `README.md`'s Dogfooding section carries the
  same rule for a human reading the repository rather than the skill. This
  reverses the previous design's D4, which claimed the operator loop would
  gain nothing; under D2 the operator loop is the whole mechanism.

- **D5 (pinned) — what this gives up, stated rather than hidden.** An
  operator who ignores the line still meets the refusal on their next
  `review`, and the recovery is unchanged: `npm run build`, then a fresh
  `/spbridge`, never `--after-run` (D-062). Unattended continuation across a
  process boundary is not delivered by this task and is not attempted by it.
  A chain in this repository still requires one human command between rounds
  whenever its producer edited `src/`. That is the trade D2 accepts: the
  defect this task closes is that the requirement was undiscoverable, not that
  it existed.

## Acceptance Criteria

| # | Criterion | From |
| --- | --- | --- |
| 1 | No source file changed by this task spawns a repository-defined command; the set of executables the Bridge spawns is unchanged. | D1 |
| 2 | `dist/` has no writer in the Bridge's own code that this task added. | D1 |
| 3 | The D-031 block at `src/cli/main.ts:419-427` is unchanged, and every existing stale-build test passes without edits. | D2 |
| 4 | `TransitionStatusDocument` gains no field, and this task writes nothing new to any file under `.spartan-bridge/`. | D2 |
| 5 | `wait` on a terminal document with a stale runtime writes exactly one added line to stderr, naming `npm run build`. | D3 |
| 6 | `wait` on a terminal document with a fresh runtime writes no added line. | D3 |
| 7 | `wait` that returns a `{ "state": "running" }` document writes no added line, however stale the runtime. | D3 |
| 8 | The stdout document `wait` prints and the exit code it returns are byte-identical to today in every one of those three cases. | D3 |
| 9 | No command other than `wait` gains output from this task. | D3 |
| 10 | `agent-skill/skills/spbridge/SKILL.md` step 4 states the rebuild rule and that the re-invocation carries no `--after-run`; `tests/spbridge-skill.test.ts` asserts it. | D4 |
| 11 | `README.md`'s Dogfooding section states the same rule. | D4 |
| 12 | The task artifact and `docs/DECISIONS.md` both state that unattended continuation across a process boundary is not delivered. | D5 |
| 13 | `npm run typecheck` exit 0, `npm run build` exit 0, `npm test` with no new failure. | Repository check |

## Work Completed

- 2026-09-03 (human-operator, Claude Code, claude-opus-5): queued from three
  chains observed the same day.
- 2026-09-04 (planner, Claude Code, claude-opus-5, effort high, vendor
  Anthropic), six plan-review cycles across two chains, committed as
  `b7249c2`: an exemption design with a two-digest baseline on the transition
  record. Findings `STALE_CAUSALITY`, `MTIME_MONOTONICITY`,
  `TRANSITION_SELECTION`, `DIST_CAUSALITY`, `DIGEST_COVERAGE`,
  `DIGEST_ENTRY_SEMANTICS`, `BUILD_CHECK_SCOPE`,
  `DIST_REBUILD_CONTRADICTION`, `SIZE_ONLY_CASE` and
  `SOURCE_BYPASS_CONTRADICTION` were each answered; the artifact reached 579
  lines, seven decisions and thirty-one criteria without an approval. The
  `## Review` region below still holds the last of those findings; it judged
  the design this round replaced.
- 2026-09-04 (planner, same round, after an out-of-band Codex second opinion —
  read-only, `gpt-5.6-sol`): the design was replaced rather than corrected.
  The second opinion established that the in-process successor means no chain
  is ever interrupted, so the exemption bought only the skipping of a build a
  present human can run, at the price of persisted state D-031 would have to
  trust. D1 survived unchanged. D2 became "no exemption, no new state". D3
  moved the whole mechanism into one stderr line at the end of `wait`. D4
  reversed: the operator loop is now where the change lives. D5 states what is
  given up. The acceptance criteria were re-derived from those five decisions;
  thirty-one became thirteen.
- 2026-09-04 (implementer, human-assigned, Claude Code, claude-opus-5, effort
  high, vendor Anthropic; the mapped `implementer` binding is Codex, whose
  adapter reports `capability_denied`, so the plan-pass successor did not
  start and this round was started by the human instead). `src/cli/main.ts`
  gained `STALE_BUILD_NEXT_ROUND_MESSAGE` and one call to the existing
  `staleBuildMessage` inside the `wait` branch's `outcome.done` arm, after
  the document is written to stdout. `SKILL.md` step 4 and the README
  Dogfooding section state the rule. `docs/DECISIONS.md` records D-069. Three
  `wait` tests in `tests/cli.test.ts` and one `SKILL.md` assertion in
  `tests/spbridge-skill.test.ts`. No change to the D-031 block, to
  `TransitionStatusDocument`, or to any file under `.spartan-bridge/`.
- 2026-09-04 (implementer correction against
  `run-28450d59-e877-44b8-ba98-12a106166ea5` `CHANGES_REQUESTED`, same
  execution). `SKILL_STALE_BUILD_OVERLAP`: the new paragraph's trigger also
  matched the two outputs already governed above it — D-062's `stale_build`
  document and the "never created a run" error — and contradicted both by
  calling the round a completed chain. Fixed on both sides rather than only in
  the skill: the runtime now prints the line only inside the
  `outcome.document.length > 0` arm and only when that document does not carry
  `"reason_code":"stale_build"`, which is what D3 already said ("after the
  terminal document has been written to stdout"); and SKILL.md names the two
  excluded cases. `README_LINE_WRAP`: the inserted sentence was re-wrapped to
  the file's ~80 columns.
- 2026-09-04 (implementer correction against
  `run-38a2060e-6bee-4618-af24-1c402dbd0fc5` `CHANGES_REQUESTED`, same
  execution). `SKILL_COMPLETED_OVERCLAIM`: the paragraph said the chain
  "completed", which two other terminal documents falsify — a dead child mid
  round (`terminalFromDeadChild`) and a non-terminal transition document both
  print a document that is neither `stale_build` nor empty while the chain did
  not finish. The line is still correct there (that chain did leave `dist/`
  stale), so the runtime is unchanged; the paragraph now says only that the
  chain ran and left the runtime stale, defers `state` and `reason_code` to
  step 5, and points a non-terminal state at the resume rule.
  `tests/spbridge-skill.test.ts` pins the new wording and asserts the old
  claim is gone.
- 2026-09-04 (implementer correction against
  `run-1b9f8d0f-b672-453c-8cf5-dc8ed515301b` `CHANGES_REQUESTED`, same
  execution). `DECISION_RECORD_OMITS_GUARD`: D-069 still stated the
  pre-correction predicate, so of the three normative surfaces it was the only
  one that did not name the two exclusions, and a later reader could have
  dropped the substring guard as unmotivated. The Decision paragraph now names
  both exclusions and the guard that implements them, and adds that the line
  says nothing about whether the round succeeded. No code or test change.
- 2026-09-04: implementation review `run-1ae1ae7a-89dd-4019-b147-0c6f4a706435`
  `APPROVED` with no findings, cycle 1, host claude / claude-opus-5 / high.
  Three earlier dispatches produced no verdict and are not review cycles: one
  `task_invalid` and one `task_artifact_write_rejected` /
  `prompt_fence_unclosed` from the implementer's own frontmatter and envelope
  mistakes, and one `adapter_error` / `provider_limit` (HTTP 429, the
  reviewer account's session limit). Task completed on human-operator
  sign-off.

## Evidence

- `src/cli/main.ts:419-427` — the D-031 refusal: after `parseArgv`,
  `staleBuildMessage(packageRoot)` to stderr on every kind, `return 1` only
  for `review` and `mcp-stdio`. Untouched by this task.
- `src/cli/main.ts:455-478` — the `wait` branch and its `outcome.done` print,
  where D3's line is added.
- `src/cli/main.ts:334-405` — `newestFileMtime`, `isBuildStale` and
  `staleBuildMessage`, the existing function D3 calls a second time. No new
  traversal is introduced.
- `src/core/transition.ts:1192-1212` — `dispatchImplementationReview` calls
  `runReview` in-process; no CLI child, so the refusal cannot fire mid-chain.
- `docs/DECISIONS.md:385-389` — D-031, "Refuse a stale build on commands that
  act; warn on commands that read", including "There is no override flag or
  environment variable", which D2 preserves.
- `docs/DECISIONS.md:1053-1057` — D-062, the `stale_build` terminal document
  and its instruction to rebuild and re-invoke fresh, never `--after-run`,
  which D5 names as the unchanged recovery.
- `src/cli/detach.ts:170-193` — `STALE_BUILD_REFUSE_MARKER` and that terminal
  document.
- `AGENTS.md` "Automatic implementation write scope": ten entries, no `dist`.
- `package.json`: `build` is `tsc`, `postbuild` is `chmod +x dist/cli/main.js`.
- Commit `b7249c2` — the six-cycle history this round replaced, kept readable.
- Working tree at the planner round: `npm run typecheck` exit 0, `npm test`
  524 pass / 0 fail.
- `src/cli/main.ts` — `STALE_BUILD_NEXT_ROUND_MESSAGE` is exported beside
  `STALE_BUILD_MESSAGE`; the `wait` branch calls
  `packageRoot !== undefined && (await staleBuildMessage(packageRoot)) !== undefined`
  inside `if (outcome.done)`, after the stdout write and before
  `return outcome.exitCode`. The D-031 block above it is unchanged.
- `git diff docs/DECISIONS.md src/core/ src/cli/task-status.ts` — no change to
  `TransitionStatusDocument`, `transition.ts`, `snapshot.ts`,
  `producer-write-scope.ts`, or `task-status.ts`; only `docs/DECISIONS.md`
  gained D-069.
- `tests/cli.test.ts` — three tests: a terminal document on a stale package
  carries both `STALE_BUILD_MESSAGE` and `STALE_BUILD_NEXT_ROUND_MESSAGE` on
  stderr with the stdout document intact; a current package carries neither;
  a `{"state":"running"}` document on a stale package carries the first and
  not the second, exit 0.
- `src/cli/main.ts` — the line is emitted inside the
  `outcome.document.length > 0` arm, guarded by
  `!outcome.document.includes('"reason_code":"stale_build"')`, so neither
  D-062's refusal document nor the empty-document error can carry it.
- `tests/cli.test.ts` — a fourth test: a dead child whose detach log holds the
  stale-build marker prints `reason_code: "stale_build"` on stdout and no
  rebuild line; a dead child that created nothing prints the resume error and
  no rebuild line.
- `tests/spbridge-skill.test.ts` — asserts step 4's three new sentences,
  including that the round is not a stop and that the next round carries no
  `--after-run`.
- `NODE_NO_WARNINGS=1 node --import tsx --test tests/cli.test.ts` — 40 pass,
  0 fail. Same for `tests/spbridge-skill.test.ts` — 13 pass, 0 fail.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-81a44ea7-88bc-4c67-a1db-1b0236eb1152 execution_id=exec-b7bedefe-0ad9-4fe1-9d15-79c105c6d4c9 review_kind=plan verdict=pass reason_code=review_passed host=codex launcher=codex-plan-reviewer-v1 model=gpt-5.6-sol effort=high model_observed=declared_unobserved policy_digest=sha256:c032b4cea31dd45976e0e4d6a6b689590f1f0a1a368378fd8a82e546eb9525a3 task_hash=sha256:52ed1a7f83a5c31e911a1c963f961e4a21060b064c3922777c1b5152c6ebe48c agents_hash=sha256:ccf9e4492d47f2f21094b8ba345a4de0bca024275d307956d1ffcf712131a220 timestamp=2026-09-04T16:54:23.895Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-1ae1ae7a-89dd-4019-b147-0c6f4a706435 execution_id=exec-6d6728c1-2ff8-4990-ab8e-a2d53e229af9 review_kind=implementation verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-opus-5 effort=high model_observed=declared_unobserved policy_digest=sha256:e363264f72a848d870898b8d1d1abe453a4f1e519f622f4415d9531d867023f6 task_hash=sha256:fceec8e4d39bd4cc836cc440a90ddc9a477039377abf245c28736bdd791ed215 agents_hash=sha256:ccf9e4492d47f2f21094b8ba345a4de0bca024275d307956d1ffcf712131a220 timestamp=2026-09-04T18:34:46.054Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None.

## Next Action

None — task completed. `wait` now names the rebuild a finished chain left
behind; D-031, the transition record and every automatic write scope are
unchanged, and one human command still stands between a source-editing chain
and the next round (D5).

## Next Handoff

No outstanding handoff. Task completed on human-operator sign-off.
