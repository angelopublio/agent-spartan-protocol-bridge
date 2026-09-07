---
protocol: "1.0.0" # x-release-please-version
id: close-the-gap-between-a-chain-guard-and-its-decision
created_at: 2026-08-19
status: completed
phase: complete
task_type: implementation
risk: material
current_role: human-operator
next_role: none
updated_at: 2026-08-22
handoff_id: HX-005
next_handoff_id: none
---

# Close the gap between a chain guard and its decision

## Objective

Make the two runtime-run containment checks state the runs-directory rule that authorized them, and
correct the chain decision's account of what its task-hash comparison proves without adding semantic
inspection of producer edits.

## Context

Task `0020` D2 requires an `--after-run` reference to resolve inside
`.spartan-bridge/runs/`, but before this task both call sites accepted a run directory that was inside
the runs directory **or** merely inside the repository:

```ts
if (!isInside(runsDir, runDir) && !isInside(input.repoRoot, runDir)) {
```

`src/core/review.ts:874-877` applied that expression to chain resolution.
`src/cli/main.ts:391-395` independently applied the same expression to both `status` and `events`.
`docs/DECISIONS.md` D-020 says only that the referenced status is "in-tree", so the published
decision matches the looser expression while task `0020` D2 states the narrower rule.

The disjunction was unreachable through all three commands. Each call site first applied
the anchored UUID-shaped `isRuntimeRunId` check, then `runDirFor` joins that separator-free identifier
under `.spartan-bridge/runs/`. The traversal fixture in `tests/review-chain.test.ts` is refused by the
shape check before containment. Tightening the predicate therefore changes the rule that the source
states and tests directly, while leaving every current public outcome unchanged.

Task `0024` is no longer a dependency or blocker. Commit
`97eb9aa8bf5a514b6278119f86840bfaac2fe77c` completed it on 2026-08-22. An accepted review now writes
its verdict and transition, moves the consumed identifier to `handoff_id`, clears
`next_handoff_id`, and retracts the envelope to a fixed notice in one atomic composition. After a
`changes_requested` plan review, the parent task image therefore records `next_role: planner` and no
outstanding proposal.

That result settles the former D4 ambiguity. In the current authorized chain,
`src/core/review.ts:905-907` compares the next run's task bytes with the parent's
`task_hash_after_write`. Inequality proves exactly that the artifact bytes changed after the parent
review write. It does not identify the writer, classify the edits, prove that a producer session ran,
or prove that the findings were addressed. When no parent task write occurred, the existing fallback
compares with the parent's pre-review task hash and proves only byte inequality from that earlier
image.

The producer represents readiness for another review by restoring `next_role: reviewer` and, under
the repository's artifact-authoring rule, issuing a coherent regenerated handoff whose advisory,
prompt role, and identifier agree. That state is the producer's assertion, not semantic evidence
derived by the Bridge. The Bridge must continue to admit or refuse from the existing structural
state and hash comparison without reading the producer's prose to judge what changed.

## Scope

- `src/runtime/store.ts`: export one narrowly named runtime-run containment predicate beside
  `runDirFor`.
- `src/core/review.ts`: call the shared predicate in chain resolution; leave the task-hash comparison
  and every other chain condition unchanged.
- `src/cli/main.ts`: call the same predicate for `status` and `events`.
- `tests/review-chain.test.ts`: exercise the predicate directly and keep the existing public-path
  fixtures unchanged.
- `docs/DECISIONS.md`: add one dated amendment to D-020 covering both the runs-directory correction
  and the precise meaning of the hash and producer assertion.
- `spartan/tasks/0020-keep-the-plan-loop-running-without-a-paste.md`: no edit; it remains completed
  historical truth, and this task records the correction to its D3 wording.

## Out of Scope

- Any semantic inspection, diff classification, authorship inference, or finding-resolution check
  over producer edits.
- Any change to the task-hash expression, `task_unchanged`, the other chain conditions, the closed
  refusal causes, reason codes, `review_chain` record, cycle rules, or policy grants.
- Any change to `isRuntimeRunId`, `runDirFor`, the `--after-run` grammar, or run storage layout.
- Widening the new predicate into a general path-safety helper, resolving symlinks, or moving the
  existing general `isInside` helper.
- The failed-cycle continuation question tracked by task `0031` and the related documentation work
  tracked by task `0026` D4.

## Constraints

- Fail closed: an ambiguous or unreadable chain reference stays `chain_refused` with cause
  `run_unreadable`.
- Preserve every observable result of `review`, `status`, and `events` for every currently accepted
  command input.
- Add no reason code, refusal cause, schema field, policy field, or protocol version.
- Keep application-core behavior independent of CLI concerns and use the existing lexical
  containment semantics.

## Decisions

### D1 - Chain resolution states the runs-directory rule

`resolveReviewChain` accepts the derived `runDir` only when it is lexically contained by
`path.join(repoRoot, ".spartan-bridge", "runs")`. The repository-root alternative is removed.
Failure remains `chain_refused` with cause `run_unreadable` before `status.json` is opened.

The complete invariant is positive: `isRuntimeRunId` still validates the reference first;
`runDirFor` still derives the candidate; the shared D3 predicate alone answers containment; all
subsequent parent-document, task, verdict, reviewer, producer-identity, policy-hash, task-hash, and
cycle checks stay unchanged. Because the shape check plus `runDirFor` already place every admitted
candidate under the runs directory, all current public outcomes stay the same.

### D2 - CLI status and events use the identical rule

The shared `status` / `events` branch validates the run-id shape, derives the run directory with
`runDirFor`, and asks the same containment question as chain resolution. It therefore calls the same
D3 predicate and removes its repository-root alternative. Its existing messages remain unchanged:
an invalid run id reports `error: run does not exist`, an impossible containment failure reports
`error: run path is not contained`, and later access or read failures report
`error: run does not exist`.

There is no CLI-specific containment rule to preserve. Both consumers operate on the same runtime
run layout, so spelling the expression twice would recreate the disagreement this task closes.

### D3 - One narrow predicate owns the testable rule

`src/runtime/store.ts` exports `isRuntimeRunDirContained(repoRoot, candidate)`. It delegates to the
existing `isInside` with the root `path.join(repoRoot, ".spartan-bridge", "runs")`. This keeps the
predicate beside `runDirFor`, whose output it classifies, and preserves the repository's current
lexical containment semantics.

Both `src/core/review.ts` and `src/cli/main.ts` import and call that predicate, removing their direct
`isInside` imports for this rule. `tests/review-chain.test.ts` imports the predicate directly and
quotes the two candidates it passes: one beneath `.spartan-bridge/runs/`, which is accepted, and one
beneath the repository but outside `.spartan-bridge/runs/`, which is rejected. Direct testing is
necessary because no command input passing `isRuntimeRunId` can reach the rejecting branch today.

### D4 - Keep the hash guard and correct its claim

Condition 5 remains exactly the comparison at `src/core/review.ts:905-907`:
`parent.task_hash_after_write ?? parent.task_hash` must differ from the current task hash. With the
task `0024` write present, it proves that the task artifact's bytes changed after the parent review
write. On the fallback path it proves only that the bytes differ from the parent's pre-review image.
Neither path proves who wrote them, why they changed, whether a producer round ran, or whether the
review findings were addressed.

Task `0020` D3's phrase "the producer round actually changed the artifact" is therefore corrected by
this decision, without rewriting the completed artifact. The complementary state has a different
status: `next_role: reviewer` plus a coherent regenerated handoff is the producer's assertion that
the artifact is ready for another review. Task `0024` makes that assertion explicit because the
parent review consumed the old proposal and left `next_role: planner`; a later reviewer proposal must
be newly authored as a unit.

The Bridge does not turn that assertion into proof. It adds no content read, diff interpretation,
authorship check, or finding-to-edit comparison. Existing review admission, handoff write validation,
and `task_unchanged` behavior remain the structural enforcement boundary.

### D5 - Amend the published chain decision once

D-020 keeps its original dated decision and gains a 2026-08-22 task `0025` amendment. The amendment
states both corrections together:

1. "in-tree" is narrowed to lexical containment inside `.spartan-bridge/runs/`; and
2. task-hash inequality proves only artifact-byte change from the parent's post-write image (or its
   pre-write fallback), while `next_role: reviewer` plus a coherent regenerated handoff is the
   producer's assertion of readiness and is not semantic proof.

The amendment also states that the Bridge does not inspect the meaning or authorship of producer
edits. One amendment is preferable to leaving the containment and hash descriptions split across
different corrections to the same decision.

## Acceptance Criteria

- [x] D1: `src/core/review.ts` derives the candidate with `runDirFor`, calls
      `isRuntimeRunDirContained`, and contains no repository-root containment alternative; rejection
      still occurs before the status read as `chain_refused` / `run_unreadable`, and every other
      chain condition is unchanged.
- [x] D1: the existing chain tests pass without changing their fixtures or expected outcomes,
      including the traversal reference that still refuses at `isRuntimeRunId` before containment.
- [x] D2: the common `status` / `events` path calls the same predicate, contains no second spelling of
      the rule or repository-root alternative, and preserves its three existing error outcomes.
- [x] D3: `src/runtime/store.ts` exports exactly one narrow
      `isRuntimeRunDirContained(repoRoot, candidate)` predicate implemented with the existing
      `isInside` semantics and the `.spartan-bridge/runs/` root; both consumers import it.
- [x] D3: a direct unit test quotes and passes one candidate inside `.spartan-bridge/runs/` and one
      candidate inside the repository but outside that directory, asserting `true` and `false`
      respectively.
- [x] D4: the task-hash expression and `task_unchanged` outcome are unchanged; this task and the D5
      amendment state that the comparison proves byte inequality only, identify the producer state
      as an assertion, and claim no semantic or authorship proof.
- [x] D4: no implementation code reads or classifies producer-authored task content to determine
      whether findings were addressed, and the existing tests for `task_unchanged`, a healthy cycle
      with `next_role: planner`, and task-write handoff validation pass unchanged.
- [x] D5: `docs/DECISIONS.md` carries one dated task `0025` amendment below D-020 that states the
      runs-directory rule, the exact post-write/pre-write hash distinction, the producer assertion,
      and the prohibition on semantic inspection while preserving the original text.
- [x] Repository checks: `git diff --check`, `npm run typecheck`, `npm run build`, and `npm test` exit
      0.

## Work Completed

- Planner (Claude Code, `claude-opus-5`, effort high, Anthropic), 2026-08-19 through 2026-08-20:
  created and refined the initial plan around the duplicated containment disjunction and the then-open
  dependency on task `0024`. No product file was edited.
- Planner (Claude Code, `claude-opus-5`, effort high, Anthropic), 2026-08-20: recorded a Codex
  capability probe. The probe was not an authorized review run, produced no protocol verdict, and is
  not a chain parent.
- Planner (Codex, `gpt-5.6-sol`, effort high, OpenAI), 2026-08-22: replanned against task `0024` as
  completed at commit `97eb9aa8bf5a514b6278119f86840bfaac2fe77c`; settled D4 without a code change,
  revalidated D3 against all three current implementations, refreshed D1-D5 and re-derived every
  criterion from them. The outstanding `HX-003` proposal was never consumed, so `handoff_id` remains
  `HX-002`; because the prompt text changed, the protocol requires the replacement proposal to advance
  to `HX-004`. No product file was edited.
- Implementer (Cursor, `cursor-grok-4.6-high-fast`, effort none), 2026-08-22: the
  pasted prompt carried no identifier and `next_handoff_id` was already `none`, so this round continued
  from the recorded plan `APPROVED` verdict without consuming a proposal. Implemented D1-D5: exported
  `isRuntimeRunDirContained` beside `runDirFor`, switched chain resolution and the shared
  `status` / `events` path onto that predicate, added the direct unit test in
  `tests/review-chain.test.ts`, and appended one dated amendment under D-020. Left the task-hash
  expression, `task_unchanged` path, and public-path fixtures unchanged. Did not commit or push.
- Human operator authorized Codex (`gpt-5.6-sol`, effort high, OpenAI), 2026-08-22, to finalize task
  `0025` and commit its complete boundary. Confirmed that every criterion is satisfied, both required
  reviews are `APPROVED`, the implementation review recorded no finding, and no blocker or remaining
  task action exists.

## Evidence

- Implementer checks, 2026-08-22: `git diff --check` exited 0; `npm run typecheck` exited 0;
  `npm run build` exited 0; `npm test` exited 0 with 274 passed and 0 failed.
- `src/runtime/store.ts:138-140`: `isRuntimeRunDirContained` calls `isInside` with
  `path.join(repoRoot, ".spartan-bridge", "runs")`.
- `src/core/review.ts:870-905`: `isRuntimeRunId` precedes `runDirFor`; line 874 calls
  `isRuntimeRunDirContained`; containment failure still returns `run_unreadable` before the status
  read; `parent.task_hash_after_write ?? parent.task_hash` is unchanged.
- `src/cli/main.ts:387-394`: the shared `status` / `events` path keeps the shape check and
  `runDirFor`, then calls the same predicate and the three existing error strings.
- `tests/review-chain.test.ts:29-36`: quotes
  `path.join(repoRoot, ".spartan-bridge", "runs", PARENT_ID)` as accepted and
  `path.join(repoRoot, "docs", PARENT_ID)` as rejected. Existing `task_unchanged`, healthy-cycle, and
  traversal fixtures were not edited.
- `docs/DECISIONS.md` D-020: original Decision/Rationale/Consequence text preserved; one 2026-08-22
  task `0025` amendment follows.
- `src/runtime/paths.ts:99-102`: `isInside` still implements the lexical containment relation with
  `path.relative`.
- Planner baseline checks, 2026-08-22: `npm run typecheck` exited 0; `npm test` exited 0 with 273
  passed and 0 failed.
- Bridge implementation review `run-8bc45fcd-1e37-4fa0-a194-57210fa558d4`, 2026-08-22:
  `review_kind=implementation`, `verdict=pass`, `reason_code=review_passed`,
  `task_write_state=written`, and no findings or reviewer write detected.
- Finalization check, 2026-08-22: `git diff --check` exited 0 before staging.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-23b89f67-3a9c-41df-a582-b6dd06ef76d1 execution_id=exec-eb61b6f8-5ab9-4131-94d2-a49d7bcc5bc0 review_kind=plan verdict=pass reason_code=review_passed host=cursor launcher=cursor-plan-reviewer-v1 model=cursor-grok-4.6-high-fast effort=high model_observed=declared_unobserved policy_digest=sha256:8c6d3a4883d80ad20ae76298efa931aa0b90536f6e3ec15c401631a0d90e5288 task_hash=sha256:636c9f85c391aca93e2592800e89ef3db694a12a7d53cd64cfcbc36369894f3f agents_hash=sha256:ca1bb93a4a6aa25b46e7a11e4bdc04a2f0ae81d05a4fb4a4e61659a17282f9b1 timestamp=2026-08-22T03:27:23.958Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-8bc45fcd-1e37-4fa0-a194-57210fa558d4 execution_id=exec-803b5d36-3a3a-46fd-8901-9b6febbec519 review_kind=implementation verdict=pass reason_code=review_passed host=codex launcher=codex-plan-reviewer-v1 model=gpt-5.6-terra effort=high model_observed=declared_unobserved policy_digest=sha256:a87802e6639f0b051a993cd2cad0d8b035a8b5ef64288ea1ab2f2f83500480b9 task_hash=sha256:cd2073175cc05ccb42653f2298e896e0d12c06a8d7681e6d6f761adb5f5d6c75 agents_hash=sha256:ca1bb93a4a6aa25b46e7a11e4bdc04a2f0ae81d05a4fb4a4e61659a17282f9b1 timestamp=2026-08-22T03:45:43.296Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None.

## Next Action

None. Task `0025` is complete: D1-D5 are implemented, all checks passed, and plan plus implementation
review are approved.

## Next Handoff

No outstanding handoff. Task completed.
