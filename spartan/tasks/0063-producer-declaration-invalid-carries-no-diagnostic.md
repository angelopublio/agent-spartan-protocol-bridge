---
protocol: "1.1.0" # x-release-please-version
id: producer-declaration-invalid-carries-no-diagnostic
created_at: 2026-09-02
status: completed
phase: complete
task_type: implementation
risk: material
current_role: human-operator
next_role: none
updated_at: 2026-09-03
handoff_id: HX-004
next_handoff_id: none
---

# `producer_declaration_invalid` stops the auto-chain with no reason the implementer can act on

## Objective

When the mapped implementer round ends and its declaration fails
`validateProducerDeclaration`, or the task bytes are unchanged, the stopped
transition and the `wait` / blocking-`review` output name *which* rule failed
— a frontmatter field, a `## Next Handoff` sub-rule, or unchanged artifact
bytes — the same way a refused review write does since tasks `0057` and
`0061`. A `/spbridge` recovery round knows what to fix without diffing the
validator by hand.

## Context

On the `0056` `/spbridge` auto-chain (2026-09-02) the plan review passed, the
Cursor implementer ran ~13 minutes and wrote a full multi-file implementation,
then the transition stopped:

```
transition-420b9d81 state=stopped reason_code=producer_declaration_invalid
producer_diagnostic=null
```

The frontmatter flip was correct (`task_type: implementation`, `phase:
reviewing`, `current_role: implementer`, `next_role: reviewer`,
`next_handoff_id: HX-003`). The failure was the `## Next Handoff` block: the
advisory was written unfenced (`Recommended execution (human decides):` as bare
lines, then a single fenced prompt block), so `hasCoherentImplementationHandoff`
returned `false` at the `body[2] !== "` + "```text" + `"` check. Nothing in the
transition record, the `wait` document, or `spartan-bridge status` said so. The
operator recovered only by reading `src/core/producer-declaration.ts`.

Two structural problems, plus a count correction and a D-036 collision:

1. **`validateProducerDeclaration` has three `ok: false` returns**
   (frontmatter parse throw, the six-clause field `if`,
   `hasCoherentImplementationHandoff` false). The draft's "four return sites"
   mixed those with a fourth `producer_declaration_invalid` arm in
   `runGuardedRound`: `hashAfter === input.approvedHash` (currently
   `src/core/transition.ts` 798–799). That arm never calls the validator.
2. **`hasCoherentImplementationHandoff` is a near-verbatim copy of
   `parseOutstandingHandoffSection`** — same fence walk. Task `0061` turned
   the `task-write.ts` copy into `NextHandoffRejectSlug` /
   `describeNextHandoffRejection`; the producer-declaration copy still
   returns a boolean. The copies already differ: the declaration path also
   requires `- Role: reviewer`, `Open \`${taskPath}\``, and `Act as reviewer`,
   and it does not inspect remainder-after-fence.
3. **`producer_diagnostic` cannot carry the slug.** Task `0066` established
   it as the closed seven-key D-036 record (`stage`, `exit_code`, `timed_out`,
   `write_scope_code`, `adapter_phase`, `adapter_cause`, `waited_ms`) with no
   free-text key. `serializeProducerDiagnostic` copies only those keys. The
   draft D3 that stored a slug there is unavailable. Follow `0066`: an
   additive nullable field on the transition status/event.

## Scope

- `src/core/producer-declaration.ts`
  - `validateProducerDeclaration` returns
    `{ ok: false; reason: "producer_declaration_invalid"; detail: DeclarationInvalidDetail }`
    with D1's first-failure slug.
  - Delete `hasCoherentImplementationHandoff` and its local `locateNextHandoff`
    / fence helpers. Call the exported `task-write.ts` classifier (D2). After
    `{ located, advisory, prompt }`, apply the three implementation-only
    needles using the same predicates and the same fence-interior strings
    the current helper already uses (D1 rows 8–10 preserve; they do not
    tighten).
- `src/core/task-write.ts`
  - Export `parseOutstandingHandoffSection`. Extend the success arm to
    `{ located, advisory, prompt }` so the declaration wrapper does not
    re-slice. `retractNextHandoffSection` keeps using `located` only.
  - `NEXT_HANDOFF_REJECT_SLUGS` / `describeNextHandoffRejection` stay the
    review-write diagnostic. Do not add implementation-only slugs to that
    union.
- `src/core/contracts.ts`
  - Additive required `declaration_invalid_detail: string | null` on
    `TransitionStatusDocument` and `TransitionEventDocument`.
  - Closed `DECLARATION_INVALID_DETAILS` array (D1's persistable set) and
    `isDeclarationInvalidDetail` guard. `SCHEMA_VERSION` stays `2`.
- `src/core/transition.ts`
  - `hashAfter === approvedHash` stop writes `declaration_invalid_detail:
    "artifact_unchanged"`.
  - Validator failure writes `declaration.detail`.
  - Both keep `producer_diagnostic: null`.
  - Thread the field through `GuardedRoundOutcome`, `emptyTransition`,
    `stopTransition`, `emitTransition`, and the authorized-transition
    literal (same optional-argument shape `0066` used for
    `unwritablePlanTargets`).
- `src/core/serialize.ts`
  - `serializeTransitionStatus` / `serializeTransitionEvent` copy the field;
    a missing key or a value outside `DECLARATION_INVALID_DETAILS`
    normalizes to `null` on parse.
- `src/cli/main.ts`
  - `formatTransitionTerminalLine` appends
    ` detail=<slug>` when `reason_code` is `producer_declaration_invalid`
    and the field is non-null.
- `src/cli/detach.ts`
  - `persistInterruptedTransition`'s constructed `terminal_stop` event sets
    `declaration_invalid_detail: null`. No `waitForRun` special case: `wait`
    already emits `serializeTransitionStatus`.
- `agent-skill/skills/spbridge/SKILL.md`
  - Step 5: a `"document": "transition"` report also quotes
    `declaration_invalid_detail` when that field is a non-null string.
  - Step 6 unchanged (not an in-session continue).
  - Step 7: `producer_declaration_invalid` is a recoverable producer-round
    failure — `/spbridge` in a fresh implementer session on the same task
    path; not a review finding and not `--after-run`. This is an exception
    to the generic transition-document row that prints no implementer
    recommendation.
- `docs/DECISIONS.md` — record the declaration-detail slug set, the shared
  classifier export, and the additive field (not `producer_diagnostic`).
- `docs/AUTHENTICATION-AND-SECURITY.md` — one sentence beside the
  `unwritable_plan_targets` sentence: the field is a Bridge-owned closed
  slug, not `producer_diagnostic` and not provider output.
- Tests:
  - Create `tests/producer-declaration.test.ts` (each D1 slug
    `validateProducerDeclaration` can return, plus the D2 agreement case).
  - `tests/transition.test.ts` — existing
    `producer_declaration_invalid` cases assert the field;
    add a producer that writes implementation frontmatter plus an unfenced
    advisory and assert `opening_shape`.
  - `tests/serialize.test.ts` — emit, parse-missing-as-null, out-of-union
    normalizes to null; `baseTransitionStatus` gains the required key.
  - `tests/detach.test.ts` — constructed events compile; a stopped
    `producer_declaration_invalid` `wait` document includes the slug.
  - `tests/cli.test.ts` — `formatTransitionTerminalLine` names the slug.
  - `tests/task-status.test.ts` — construction site only (the command still
    reports completed transitions only).
  - `tests/spbridge-skill.test.ts` — the step 7 recovery sentence.
  - Every other `TransitionStatusDocument` / `TransitionEventDocument`
    construction site sets `declaration_invalid_detail`. The bar is
    `npm run typecheck` clean, not a pre-enumerated fixture list.

## Out of Scope

- Putting the slug into `producer_diagnostic`, widening that closed record,
  or adding a free-text key to it.
- Changing `src/cli/task-status.ts` reporting. `spartan-bridge status --task`
  reports only `state: completed` transitions; a
  `producer_declaration_invalid` stop never appears there. Operator surfaces
  are the terminal `wait` / blocking-`review` transition document,
  `formatTransitionTerminalLine` stderr, and `spartan-bridge transition-status`.
  Construction sites in `tests/task-status.test.ts` still gain the new key.
- Auto-repairing the declaration. The producer round fixes it.
- The `0056` `advanceFromCheckpoint` work (separate task).
- Raising or changing `max_review_cycles`.
- Moving `NEXT_HANDOFF_REJECT_SLUGS` out of `task-write.ts`, or extracting a
  third `next-handoff` module. One fence-walk stays in `task-write.ts` and is
  exported.
- Changing review-write behaviour (`describeNextHandoffRejection`,
  `checkArtifactWriteShape`). The `parseOutstandingHandoffSection === null`
  comparisons at `task-write.ts` 958 and 1137 are pre-existing and stay
  untouched.
- Changing *when* a declaration is invalid, except the one D2 remainder
  tightening named below. D1 rows 8–10 preserve the current Role / Open /
  Act-as predicates and the current fence-interior search region; they
  are not a second tightening.

## Constraints

- English artifact.
- `reason_code` vocabulary unchanged. `producer_diagnostic` stays the D-036
  closed seven-key record and stays `null` on every
  `producer_declaration_invalid` stop.
- `declaration_invalid_detail` is a Bridge-owned closed slug (no artifact
  bytes, no path, no handoff id, no reviewer prose, no field list).
- After this task, `producer-declaration.ts` has no fence-walk of its own.
- `SCHEMA_VERSION` stays `2`.
- `npm run typecheck` / `npm run build` clean; `npm test` no new failure.

## Decisions

- **D1 — `validateProducerDeclaration` returns a first-failure `detail`
  slug; the hash-unchanged arm is a fourth persistable slug outside the
  validator.** `ProducerDeclaration` becomes
  `{ ok: true } | { ok: false; reason: "producer_declaration_invalid"; detail: DeclarationInvalidDetail }`.
  First failure in this order, matching the current `||` chain:

  | Order | Condition | Slug |
  | --- | --- | --- |
  | 1 | `parseTaskFrontmatter` throws | `frontmatter_unparseable` |
  | 2 | `task_type !== "implementation"` | `frontmatter_task_type` |
  | 3 | `phase !== "reviewing"` | `frontmatter_phase` |
  | 4 | `current_role !== "implementer"` | `frontmatter_current_role` |
  | 5 | `next_role !== "reviewer"` | `frontmatter_next_role` |
  | 6 | `next_handoff_id === "none"` or `!isCanonicalHandoffId` | `frontmatter_next_handoff_id` |
  | 7 | `parseOutstandingHandoffSection` rejects | that `NextHandoffRejectSlug` verbatim |
  | 8 | `advisory.split("\n").filter((line) => line === "- Role: reviewer").length !== 1` (preserve: exact line, exactly once, advisory fence interior only) | `advisory_role_line` |
  | 9 | `!prompt.includes("Open `" + taskPath + "`")` (preserve: substring, prompt fence interior only) | `prompt_open_path` |
  | 10 | `!prompt.includes("Act as reviewer")` (preserve: substring, prompt fence interior only) | `prompt_act_as_reviewer` |

  `runGuardedRound`'s `hashAfter === input.approvedHash` arm does not call
  the validator and persists `artifact_unchanged`. Existing tests that exit
  0 without rewriting the task (including "exit 0 without a coherent
  declaration") are this arm, not a validator miss.

  Persistable set `DECLARATION_INVALID_DETAILS` in `contracts.ts`: the six
  `frontmatter_*` slugs, the twelve `NEXT_HANDOFF_REJECT_SLUGS` names
  (`identifier_not_canonical`, `section_absent`, `opening_shape`,
  `advisory_fence_nested`, `advisory_fence_unclosed`, `prompt_block_missing`,
  `prompt_fence_nested`, `prompt_fence_unclosed`, `trailing_content`,
  `advisory_handoff_line`, `prompt_handoff_mark`, `stray_identifier`), the
  three extra needles, and `artifact_unchanged`. No `next_handoff_` prefix:
  a producer that already saw `[opening_shape]` on a review-write refusal
  sees the same token here. No field-list payload: one slug, first failure.
  `identifier_not_canonical` is in the persistable set because it is in
  the shared classifier; `validateProducerDeclaration` cannot reach it
  after step 6.

- **D2 — export `parseOutstandingHandoffSection` from `task-write.ts`; the
  implementation path calls it with canonical `next_handoff_id` and then
  applies three extra needles on the same fence interiors. No pairing
  parameter. No import cycle.** The classifier already takes
  `(text, expectedId)` and never reads `handoff_id`.
  `describeNextHandoffRejection` is the review-write wrapper (identifier
  pair, review-region splice); the declaration path does not call it.
  Success becomes `{ located, advisory, prompt }` whose `advisory` /
  `prompt` are the existing slices (`body.slice(3, advisoryClose)` and
  `body.slice(advisoryClose + 3, promptClose)`), identical to
  `hasCoherentImplementationHandoff` 81–82. Rows 8–10 therefore search
  the same region they search today: a needle that appears only outside
  those fences still fails, as it does now. Implementation-only slugs stay
  out of `NEXT_HANDOFF_REJECT_SLUGS`. Delete the duplicate fence-walk in
  `producer-declaration.ts`.

  Import graph after this task: `producer-declaration.ts` currently
  imports only `../policy/task-frontmatter.ts` and gains one new import
  from `./task-write.ts`. `task-write.ts` imports `../policy/task-frontmatter.ts`,
  `./contracts.ts`, and `./serialize.ts` — not `producer-declaration.ts`.
  `serialize.ts` imports `./contracts.ts` only, not `producer-declaration.ts`
  (the persist whitelist lives on `DECLARATION_INVALID_DETAILS` in
  `contracts.ts`). The new edge cannot cycle. The duplicated twelve slug
  names in `DECLARATION_INVALID_DETAILS` stay in sync solely via the
  subset test.

  Sharing includes `trailing_content`. D-063 already accepts any run of
  blank lines after the closing fence on both paths; the stale declaration
  copy never looked at remainder, so non-blank prose after the prompt fence
  newly fails the declaration. That is the one declaration-rule tightening
  this task accepts, because keeping a silent pass there would re-fork the
  classifier. A test asserts `NEXT_HANDOFF_REJECT_SLUGS` is a subset of
  `DECLARATION_INVALID_DETAILS`, and that the `0056` unfenced-advisory
  shape is `opening_shape` from both `describeNextHandoffRejection` (plan
  artifact) and `validateProducerDeclaration` (implementation artifact).

- **D3 — the stop records `declaration_invalid_detail`, not
  `producer_diagnostic`.** Required `string | null` key on
  `TransitionStatusDocument` and `TransitionEventDocument`, `null` at every
  construction site except a `producer_declaration_invalid` stop, which
  stores D1's slug. `producer_diagnostic` remains `null` on this stop.
  `GuardedRoundOutcome` / `stopTransition` gain an optional
  `declarationInvalidDetail` argument (default `null`) and thread it the
  way `0066` threaded `unwritablePlanTargets`. `wait` and blocking `review`
  already print `serializeTransitionStatus`, so they surface the field once
  serialize copies it. `formatTransitionTerminalLine` appends
  ` detail=<slug>` for that reason code. `persistInterruptedTransition`
  writes `declaration_invalid_detail: null`. Parse of an old record that
  lacks the key, or of a string outside `DECLARATION_INVALID_DETAILS`,
  normalizes to `null`. `SCHEMA_VERSION` stays `2`. The construction-site
  bar is `npm run typecheck` clean after the key is added everywhere the
  two document types are built, including the helpers and literals in
  `tests/serialize.test.ts`, `tests/transition.test.ts`,
  `tests/detach.test.ts`, `tests/cli.test.ts`, and
  `tests/task-status.test.ts`.

  SKILL step 5 quotes the field when present. Step 7 treats
  `producer_declaration_invalid` as a fresh `/spbridge` implementer
  recovery, never `--after-run`.

## Acceptance Criteria

- [x] (D1) `validateProducerDeclaration` failure is
      `{ ok: false; reason: "producer_declaration_invalid"; detail }` with
      a distinct slug from the D1 table; `tests/producer-declaration.test.ts`
      covers frontmatter parse, each of the five field slugs, each extra
      needle under the preserved current predicates (exact-once
      `- Role: reviewer` line in the advisory fence; `prompt.includes` of
      the `Open \`` + taskPath + `\`` needle; `prompt.includes("Act as reviewer")`),
      and each `NextHandoffRejectSlug` the declaration path can reach
      (`identifier_not_canonical` excluded). Multiple wrong fields yield
      only the first slug in D1 order. A Role / Open / Act-as token that
      sits only outside the advisory or prompt fence still fails, as
      today.
- [x] (D1) `hashAfter === approvedHash` persists
      `declaration_invalid_detail: "artifact_unchanged"`;
      `tests/transition.test.ts` cases that exit 0 without rewriting the
      task assert that slug.
- [x] (D2) `producer-declaration.ts` has no `locateNextHandoff`, no
      `FENCE_OPEN_TEXT` walk, and no `hasCoherentImplementationHandoff`; it
      calls exported `parseOutstandingHandoffSection`. A test asserts
      `NEXT_HANDOFF_REJECT_SLUGS` ⊆ `DECLARATION_INVALID_DETAILS`, and that
      the `0056` unfenced-advisory shape is `opening_shape` from both
      `describeNextHandoffRejection` and `validateProducerDeclaration`.
      `task-write.ts` still does not import `producer-declaration.ts`.
- [x] (D2) Non-blank prose after the prompt fence is `trailing_content` on
      the declaration path; one or more blank lines after the closing fence
      still pass, matching D-063.
- [x] (D3) A `producer_declaration_invalid` transition stop records the
      slug in `declaration_invalid_detail` and leaves `producer_diagnostic`
      `null`; the terminal `wait` document and blocking-`review` stdout
      include the field; `formatTransitionTerminalLine` names the slug on
      stderr; `tests/transition.test.ts`, `tests/serialize.test.ts`,
      `tests/detach.test.ts`, and `tests/cli.test.ts` cover persist,
      parse-missing-as-null, out-of-union-as-null, `wait`, and the stderr
      line. A producer that writes implementation frontmatter plus an
      unfenced advisory asserts `opening_shape`.
- [x] (D3) `declaration_invalid_detail` is a required `string | null` key;
      `npm run typecheck` is clean after every construction site for
      `TransitionStatusDocument` and `TransitionEventDocument` sets it.
      `serializeProducerDiagnostic` still copies only the seven closed keys;
      `SCHEMA_VERSION` stays `2`.
- [x] (D3) `agent-skill/skills/spbridge/SKILL.md` step 5 quotes
      `declaration_invalid_detail` when present; step 7 names the
      recoverable producer-declaration failure and the fresh `/spbridge`
      (not `--after-run`) path; `tests/spbridge-skill.test.ts` covers that
      sentence.
- [x] (D3) `docs/DECISIONS.md` and `docs/AUTHENTICATION-AND-SECURITY.md`
      match D1–D3: the field is a Bridge-owned closed slug, not
      `producer_diagnostic`.
- [x] `npm run typecheck` / `npm run build` clean; `npm test` adds no new
      failure.

## Work Completed

- 2026-09-02: task created after the `0056` `/spbridge` auto-chain stopped at
  `producer_declaration_invalid` / `producer_diagnostic: null` — the Cursor
  implementer wrote a full implementation but fenced the `## Next Handoff`
  advisory wrong, and no runtime output named the failing rule.
- 2026-09-02 (planner, Cursor, cursor-grok-4.6-high-fast, effort high): refined against the current validator, 0061
  classifier, 0066 D-036 collision, and the two
  `producer_declaration_invalid` arms in `runGuardedRound`. Pinned D1 as
  first-failure slugs plus `artifact_unchanged`, D2 as an export of
  `parseOutstandingHandoffSection` with no pairing parameter and three extra
  needles, D3 as additive `declaration_invalid_detail` (not
  `producer_diagnostic`). Verified every named path;
  `tests/producer-declaration.test.ts` is absent and is in Scope as a
  creation. Adopted HX-001; issued HX-002 for plan review.
- 2026-09-03 (planner, same session, same host/model/effort/vendor):
  revised against `NEEDLE_SCOPE_TIGHTENING`. D1 rows 8–10 now quote the
  current predicates (`length !== 1` exact Role line; `prompt.includes`
  Open and Act-as) and name them preserve; D2 names the identical
  fence-interior slices and the acyclic import graph. Out of Scope still
  admits only the D2 `trailing_content` tightening. Recorded the
  `reviewer.plan` doctor line and confirmed this file is the only
  `spartan/tasks/0063-*`. Adopted HX-002; issued HX-003.
- 2026-09-03 (implementer, Cursor, cursor-grok-4.6-high-fast, effort high): human-started implementer round after the
  plan-pass auto-chain did not spawn (scanner false-positive, already fixed
  on main). Local `main` was already at `origin/main` (`55df194`).
  Implemented D1–D3: first-failure declaration slugs, shared classifier
  export, additive `declaration_invalid_detail`. Parse uses
  `parseTaskFrontmatterDocument` so D1 rows 2–5 are live (the review-admission
  wrapper would collapse those combinations to `frontmatter_unparseable`).
  Structural parse throws remain `frontmatter_unparseable`. Pasted prompt
  carried no identifier; `next_handoff_id` was `none`; issued HX-004.

## Evidence

- `npm run typecheck` — exit 0.
- `npm run build` — exit 0 (`tsc` + `chmod +x dist/cli/main.js`).
- `npm test` — 491 pass, 0 fail (`node --import tsx --test tests/*.test.ts`).
- `tests/producer-declaration.test.ts` — 12 pass: each D1 field slug, extra
  needles, reachable `NextHandoffRejectSlug` values, subset agreement, and
  the `0056` unfenced-advisory `opening_shape` pair.
- `tests/transition.test.ts` — unchanged-hash stops assert
  `artifact_unchanged`; unfenced-advisory producer asserts `opening_shape`;
  both leave `producer_diagnostic` null.
- `spartan-bridge doctor --repo` (this session, before producer work):
  `binding reviewer.implementation: adapter available; launcher=claude-plan-reviewer-v1`.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-d642658d-b816-4f2b-9de3-e2965fcbd90c execution_id=exec-11237949-c257-4deb-873f-084bd809b4d7 review_kind=plan verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-opus-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:5a74e728a1985947915bf18ad1f0bb996d8f60b76b5ef05870e614ae8c0b8a56 task_hash=sha256:64112f09e7e3433003be714f31db800a172581506d615936dae27e04423fbd74 agents_hash=sha256:8c5ea585bde94cfad8dd44a4887699564541608b157d2046244f834226ece7fa timestamp=2026-09-03T01:48:17.377Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-f4586e7d-cfc9-4515-90c2-d5a267036c8e execution_id=exec-f0a768ea-dd20-4790-9bdb-cfe3dee689a0 review_kind=implementation verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-opus-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:1a2b7e24b78bc51432866607cd179270ba59bd8d0081a685699860fc477ec92e task_hash=sha256:e97174c7bef38947badb1a00add46018f9d5f48739f3c6e7ac967071ff32015c agents_hash=sha256:8c5ea585bde94cfad8dd44a4887699564541608b157d2046244f834226ece7fa timestamp=2026-09-03T09:13:30.295Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None. Depends on task `0061`'s classifier and task `0066`'s
`producer_diagnostic` / additive-field pattern; both are on `main`.

## Next Action

None. Implementation review APPROVED (`run-f4586e7d`, claude-opus-5, no findings).
`npm run typecheck` / `npm run build` exit 0; `npm test` 491 pass, 0 fail.
Committed and pushed. The implementer round ran human-started; the plan-pass
auto-chain did not spawn (scanner false positive, fixed on `main` by `dd235c2`).

## Next Handoff

No outstanding handoff. The task is complete.
