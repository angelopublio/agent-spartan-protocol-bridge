---
protocol: "0.6.1" # x-release-please-version
id: adopt-renamed-verdict-vocabulary
created_at: 2026-08-17
status: completed
phase: complete
task_type: implementation
risk: material
current_role: reviewer
next_role: none
updated_at: 2026-08-17
handoff_id: HX-002
next_handoff_id: none
---

# Adopt the renamed protocol verdict vocabulary and stop pinning the birth-stamp

## Objective

The Bridge writes the corrected protocol verdict spellings, and a task artifact is
admitted on its shape rather than on an exact match of its protocol birth-stamp, so that
tasks created under any protocol version stay reviewable.

## Context

The portable protocol renamed two review verdicts on a resulting-state axis: `APPROVE`
became `APPROVED` and `CHANGES_REQUESTED` replaced `CHANGES`. `PENDING` and `BLOCKED`
were already correct. That change ships as protocol `1.0.0`; its release pull request is
open and unmerged at the time of writing.

The non-obvious operational fact, which sets the urgency: the Spartan skill on this
machine is **not installed, it is symlinked into the protocol repository's working
checkout** (`~/.claude/skills/spartan` and
`~/.agent-profiles/personal/claude/skills/spartan` both point at
`agent-spartan-protocol/agent-skill/skills/spartan`). The task template is a
release-please extra-file, so the moment that release merges and the protocol repository
is pulled, the template stamps `protocol: "1.0.0"` on every task created anywhere on this
machine. The trigger is `git pull`, not an install step, and the protocol repository's own
instructions tell agents to pull before starting work. Until this task lands, that pull
makes every newly created task fail `spartan-bridge review` with `task_invalid`.

The renamed verdicts are already live in every host on this machine for the same reason:
the symlinked `SKILL.md` already instructs the new spellings, which is why recent review
rounds recorded `APPROVED` while this repository still writes `APPROVE`.

## Scope

- `src/core/contracts.ts`: the `PROTOCOL_VERSION` constant.
- `src/policy/task-frontmatter.ts`: the birth-stamp admission check.
- `src/core/task-write.ts`: the verdict line in `renderRegion`.
- `tests/task-write.test.ts`, `tests/review.test.ts`, `tests/helpers.ts`: assertions and
  the fixture stamp.
- `docs/DECISIONS.md`: the birth-stamp decision.

## Out of Scope

- `src/mcp/protocol.ts`. `MCP_PROTOCOL_VERSION` is a different protocol with an unrelated
  dated value; a repository-wide replacement would corrupt it.
- Any change to the portable protocol package or to a task artifact's recorded history.
- A dual-spelling read path. This project never reads a verdict out of an artifact; it
  only writes one.
- `renderBridgeRunLine` and `TaskWriteMeta`, which task `0009` owns.

## Constraints

- The written region stays confined to the owned `<!-- spartan-bridge:review:* -->`
  markers and within `REGION_BYTE_CAP`.
- Admission must still fail closed on a malformed artifact.
- No behaviour may be selected from the birth-stamp value (see D1).

## Acceptance Criteria

- [x] A task artifact stamped `0.6.1` and one stamped `1.0.0` are both admitted, and a
      malformed or absent stamp is still rejected as `task_invalid`.
- [x] `renderRegion` writes `Verdict: APPROVED` and `Verdict: CHANGES_REQUESTED`.
- [x] Every verdict assertion is anchored so that a partially applied rename fails (D2).
- [x] No code path branches on the birth-stamp value.
- [x] `MCP_PROTOCOL_VERSION` is unchanged.
- [x] `npm run typecheck` and `npm test` both exit 0.

## Decisions

### D1 - Admit on shape; stop pinning the birth-stamp to one value

`src/policy/task-frontmatter.ts:127` rejects any artifact whose `protocol` value is not
exactly equal to `PROTOCOL_VERSION`. Moving that constant to `1.0.0` would trade one
breakage for another: the nine task artifacts already in `spartan/tasks/` are stamped
`0.6.1` and would all stop being reviewable. A single-value pin cannot satisfy "run on the
tasks that exist and on the tasks that will exist".

The deciding argument is not convenience, it is the protocol's own text. `protocol.md`
states that the `protocol` value "is a passive Semantic Version birth-stamp… It has no
runtime behavior and MUST NOT trigger version negotiation, network checks, migration, or
rewrites of existing tasks." An equality gate that refuses a run **is** runtime behaviour
driven by that stamp, so the current implementation already conflicts with the contract it
consumes. The same clause also closes off the tempting alternative of a compatibility
matrix that would pick a verdict spelling from the stamp: that is version negotiation.

What legitimately guards admission is the shape check that already runs beside it, and it
is thorough: exactly the twelve required keys and no others, `id` matching the filename,
both dates real calendar dates, `status` `active`, `phase` and `task_type` `planning`, the
risk and role vocabularies, and the canonical handoff-identifier format. An artifact that
passes all of that is structurally what this runtime expects, whatever its birth-stamp
says.

So: validate that `protocol` is a well-formed Semantic Version string and stop there. No
equality, no accepted set, no range. A set or a range would have to be widened by hand on
every protocol release, which is the same maintenance trap one release later, and neither
is justified once behaviour cannot be selected from the value anyway.

`PROTOCOL_VERSION` stays exported for the template stamp and for documentation, but no
longer gates admission.

### D2 - Rename the two literals, and anchor the assertions

`src/core/task-write.ts:93` chooses the verdict line with a two-branch expression. Keep it
explicit: do not replace it with an uppercase transform of the runtime verdict, because
`changes_requested` would map correctly while `pass` would produce `PASS`, which is not a
protocol verdict.

The existing assertions are unanchored substring matches — `/Verdict: APPROVE/` and
`/Verdict: CHANGES/`. Both still match the new spellings as prefixes, so a rename applied
to the test file but not to the source, or the reverse, can pass. Anchor every verdict
assertion to a whole line, for example `/^Verdict: APPROVED$/m`, so the suite actually
detects a partial rename.

`tests/review.test.ts:441` is named for the old spelling. Its purpose — proving the
protocol vocabulary does not leak into runtime verdicts — is unchanged; it keeps that
purpose and updates its token.

### D3 - Ordering against task 0009

Task `0009` decision D7 records that this work should land first: it is the smaller
change, it touches no policy parser and no security boundary, and it alters the same
rendered region that `0009` extends. Landing it first means `0009` rebases once and writes
its new region assertions against final verdict text, instead of this rename having to
update assertions `0009` had just introduced.

The two touch different functions in the same file — `renderRegion`'s verdict line here,
`renderBridgeRunLine` and `TaskWriteMeta` there — so conflict risk is low either way.

### D4 - The release stays the human's gate

Nothing here merges, tags, or pulls anything. Once this lands, merging the protocol
release and pulling that repository become safe, because a `1.0.0` stamp is admitted like
any other well-formed version.

## Work Completed

- Planner (Claude Code, Claude Opus 5, Anthropic): recorded D1–D4. No product file
  changed in that round.
- Implementer (HX-001, Cursor, Grok 4.6, no user-selectable effort): accepted matching envelope HX-001. Implemented D1 and D2 in the named
  scope. `PROTOCOL_VERSION` stays exported at `"0.6.1"` and is no longer imported by
  admission. `MCP_PROTOCOL_VERSION`, `renderBridgeRunLine`, and `TaskWriteMeta` were not
  modified.
- Reviewer (HX-002, Claude Code, Claude Opus 5, Anthropic — a different vendor from the
  implementer round): accepted matching envelope HX-002. Reviewed the working-tree diff
  against Scope, Out of Scope, Constraints, and every acceptance criterion, and re-ran the
  repository checks. Verdict `APPROVED` with three informational findings. Changed no
  product file; this artifact is the only file this round touched.

## Evidence

- Admission: `src/policy/task-frontmatter.ts` validates `protocol` with `isSemanticVersion`
  only. Source no longer mentions `PROTOCOL_VERSION`.
- Verdict write: `src/core/task-write.ts` `renderRegion` uses the two-branch line
  `Verdict: APPROVED` / `Verdict: CHANGES_REQUESTED`.
- Tests: `tests/frontmatter.test.ts` admits `0.6.1`, `1.0.0`, and `2.3.4` and rejects
  malformed or absent stamps as `task_invalid`; `tests/review.test.ts` admits `0.6.1` and
  `1.0.0` through `runReview`; verdict assertions are `/^Verdict: APPROVED$/m` and
  `/^Verdict: CHANGES_REQUESTED$/m`.
- `docs/DECISIONS.md`: D-015 records the birth-stamp decision.
- `src/mcp/protocol.ts`: `MCP_PROTOCOL_VERSION` remains `"2025-06-18"`.
- `npm run typecheck`: exit 0.
- `npm test`: exit 0; 80 pass, 0 fail.

Reviewer verification (independent re-run):

- `git diff --stat`: eight files, all inside Scope plus the additive
  `tests/frontmatter.test.ts`. `src/mcp/protocol.ts`, `src/core/contracts.ts`,
  `renderBridgeRunLine`, and `TaskWriteMeta` are untouched.
- `npm run typecheck`: exit 0. `npm test`: exit 0; 80 pass, 0 fail.
- Repository-wide grep for `APPROVE`/`CHANGES` under `src` and `tests`: the only verdict
  literals are the two in `renderRegion` and the four anchored assertions in
  `tests/task-write.test.ts`. No unanchored verdict assertion remains, and no doc outside
  `docs/DECISIONS.md` restates the region's verdict text.
- Repository-wide grep for `PROTOCOL_VERSION`: declared once in `src/core/contracts.ts`,
  referenced by no source file. `MCP_PROTOCOL_VERSION` remains `"2025-06-18"`.
- Anchoring behaves as D2 requires: `Verdict: APPROVE` does not match
  `/^Verdict: APPROVED$/m`, so a rename applied to only one side fails the suite.
- `validateReviewResult` rejects by allowlist (`src/core/result.ts:31`), so retokenising
  `tests/review.test.ts` from `APPROVE` to `APPROVED` preserves that test's purpose.

## Review

Verdict: APPROVED

Findings:

- `F1` (info): `PROTOCOL_VERSION` is now referenced by no source file and is not re-exported
  from `src/index.ts`, so it is dead in this repository. D1 kept it deliberately for the
  template stamp, but the template lives in the protocol package, not here. Not a defect
  against the plan; a later round may either re-export it or drop it.
- `F2` (info): `tests/frontmatter.test.ts:65` guards D1 by asserting the source text of
  `src/policy/task-frontmatter.ts` never contains `PROTOCOL_VERSION`. That misses a re-pin
  written as a literal (`fm.protocol === "0.6.1"`) and trips on a mere comment. The
  behavioural cases in the test above it (`0.6.1`, `1.0.0`, `2.3.4` admitted; malformed and
  absent rejected) are the real guard and are correct.
- `F3` (info): the absent-stamp case is rejected by the twelve-key count check before the
  semantic-version check is reached. The acceptance criterion is satisfied behaviourally;
  the assertion just does not exercise the new code path.
- Incidental fix confirmed sound: `tests/helpers.ts:122` previously discarded the
  `protocol` option through a no-op ternary. Making it effective changed no existing test,
  because the only callers passing it are the ones added in this round.

## Blockers

None.

## Next Action

None. The task is complete: admission validates the birth-stamp as a well-formed Semantic
Version and nothing branches on its value, `renderRegion` writes `APPROVED` and
`CHANGES_REQUESTED`, every verdict assertion is anchored, `MCP_PROTOCOL_VERSION` is
unchanged, `npm run typecheck` and `npm test` both exit 0, and the review verdict is
`APPROVED`. The three findings are informational and require no change.

## Next Handoff

No outstanding proposal. This task is closed.

Non-binding suggestion for a possible new round (the human decides whether to run it): the
approved change is still uncommitted, so it lives only in the working tree. D4 makes
merging the protocol release and pulling that repository safe only once this lands, and D3
wants it landed before task `0009` rebases. A short implementer round could commit it, if
the human authorizes that commit. It would be a new task, not a reopening of this one.

```text
Recommended execution (human decides):
- Host: Cursor, the `implementer` binding in `AGENTS.md`, in a fresh session separate from this review
- Model and effort: Composer 2.5, no user-selectable effort (fallback: Claude Sonnet, effort low)
- Role: implementer
- Invocation: `/spartan` in Cursor, passing the prompt block below as the argument
```

```text
Create a new uniquely numbered task in `spartan/tasks/` from `assets/task-template.md` for committing the approved verdict-rename and birth-stamp change of task 0010.

Act as implementer. With the human's explicit commit authorization for this round, commit the working-tree changes to `docs/DECISIONS.md`, `src/core/task-write.ts`, `src/policy/task-frontmatter.ts`, `tests/frontmatter.test.ts`, `tests/helpers.ts`, `tests/review.test.ts`, `tests/task-write.test.ts`, and `spartan/tasks/0010-adopt-renamed-verdict-vocabulary.md` on `main` as one commit. Success is `npm run typecheck` and `npm test` exiting 0 and a clean `git status`. Do not push, tag, amend, or open a pull request. Do not reopen or edit the 0010 artifact's content.
Run the relevant repository checks and update the new task file.

Return only the next handoff, or a completion notice if no work remains.
```
