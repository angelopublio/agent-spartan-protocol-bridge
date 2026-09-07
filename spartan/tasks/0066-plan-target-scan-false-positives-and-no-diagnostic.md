---
protocol: "1.1.0" # x-release-please-version
id: plan-target-scan-false-positives-and-no-diagnostic
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

# The plan-target scan false-positives on a bare filename and names no token

## Objective

The task `0054` pre-spawn scan (`planTargetsUnwritablePath`) stops the auto-chain
only when the approved plan genuinely names a write target outside the automatic
implementation write scope — not when it uses a bare filename in prose that a
human reads as an in-scope path. When it does stop, the transition record and
the terminal `wait` document name the offending token(s) so the operator does
not have to diff `plan-target-scan.ts` by hand.

## Context

The first real-world firing (board `0030`, 2026-09-02, `transition-8abeb989`)
was a false positive. The approved plan's Scope had:

```
- `docs/UI_PATTERNS.md` (and `DESIGN_SYSTEM.md` only if it still names the
  craft trio) — type is optional Feature / Bug / Chore; mockup is not a type.
```

`planTargetsUnwritablePath` picked the backtick token `DESIGN_SYSTEM.md`,
`looksLikeRepoPath` returned true (ends `.md` via `PATH_EXTENSIONS`), and
`isPathAdmittedByScope("DESIGN_SYSTEM.md", ["spboard/","agent-skill/","tests/","app.py","docs/","spartan/"])`
returned false (a bare filename matches no scope prefix). The chain stopped
`plan_targets_unwritable_path` with `producer_diagnostic: null`. The file the
plan meant is `docs/DESIGN_SYSTEM.md`, which **is** in the write scope; a human
reads the shorthand instantly (it sits in the same bullet as the correctly
prefixed `docs/UI_PATTERNS.md`). The plan review had already passed
(`run-9e89c009`, claude-sonnet-5, APPROVED).

Two defects:

1. **Bare-filename false positive.** `looksLikeRepoPath` accepts any token
   ending in a known extension even with no directory component
   (`src/core/plan-target-scan.ts` `PATH_EXTENSIONS`). `isPathAdmittedByScope`
   can only match against scope *prefixes* or exact file entries, so a bare
   `NAME.md` is always "unwritable" unless the scope literally lists `NAME.md`.
   Every plan that writes a bare filename in prose after a correctly prefixed
   one trips this.
2. **No named tokens on the stop.** `createStoppedTransition` in
   `src/core/transition.ts` takes only a `ReasonCode` and always leaves
   `producer_diagnostic: null`. `planTargetsUnwritablePath` returns a boolean,
   so the offending token is not available to the caller. Reusing
   `producer_diagnostic` for those tokens is not available: that field is the
   D-036 closed seven-key record (`stage`, `exit_code`, `timed_out`,
   `write_scope_code`, `adapter_phase`, `adapter_cause`, `waited_ms`), has no
   free-text key, is never a path
   (`docs/AUTHENTICATION-AND-SECURITY.md`), and stays `null` on every
   non-producer-execution stop. `serializeProducerDiagnostic` copies only those
   seven keys.

Grok's `0054` review already warned the prose scan could misfire; this is that
class, on bare-filename classification rather than the human-started-round case.

## Scope

- `src/core/plan-target-scan.ts`
  - `planTargetsUnwritablePath` returns `string[]` (D1).
  - `looksLikeRepoPath`: a token with no `/` is a repo path only when it is in
    `KNOWN_TOP_LEVEL_NAMES`. Delete the bare-name `PATH_EXTENSIONS` branch and
    the unused constant (D2). `KNOWN_TOP_LEVEL_NAMES` already contains
    `AGENTS.md` (lines 7–15); this task does not add a name to that set.
  - `isUnwritablePlanTarget` stays: `AUTHORITY_WRITE_PATHS` membership first,
    then `!isPathAdmittedByScope`. Signature stays
    `(markdown, writeScope)` — no `repoRoot`, no `fs`.
- `src/core/transition.ts`
  - `continueAfterPlanReview` takes the returned token list; a non-empty list
    calls `createStoppedTransition` with those tokens.
  - `createStoppedTransition` / `emptyTransition` / `stopTransition` /
    `emitTransition` persist them on `unwritable_plan_targets` (D3).
    `producer_diagnostic` stays `null` on this stop.
- `src/core/contracts.ts`
  - Additive `unwritable_plan_targets: string[] | null` on
    `TransitionStatusDocument` and `TransitionEventDocument`.
    `SCHEMA_VERSION` stays `2`.
- `src/core/serialize.ts`
  - `serializeTransitionStatus` / `serializeTransitionEvent` copy the field
    (empty or missing normalizes to `null` on parse, same as
    `producer_diagnostic`).
- `src/cli/main.ts`
  - `formatTransitionTerminalLine` names the tokens on stderr when
    `reason_code` is `plan_targets_unwritable_path` and the field is non-null.
- `src/cli/detach.ts`
  - `persistInterruptedTransition`'s constructed `terminal_stop` event sets
    `unwritable_plan_targets: null`. No `waitForRun` special case: `wait`
    already emits `serializeTransitionStatus`.
- `docs/DECISIONS.md` — amend D-053: a bare name is a scan target only when it
  is in `KNOWN_TOP_LEVEL_NAMES`; a stop records `unwritable_plan_targets`.
- `docs/ROUTING-AND-WORKFLOWS.md` — the pre-spawn scan sentence matches D2/D3.
- `docs/AUTHENTICATION-AND-SECURITY.md` — one sentence: the field is a
  Bridge-owned list of normalized path tokens already present in the approved
  artifact; it is not `producer_diagnostic` and is not provider output.
- Tests:
  - Create `tests/plan-target-scan.test.ts` (0054 left the scan un-unit-tested;
    its three cases live in `tests/transition.test.ts`).
  - Adjust `tests/transition.test.ts` 0054 cases and assert
    `unwritable_plan_targets` on the stop.
  - `tests/serialize.test.ts` — emit, parse-missing-as-null, and the existing
    seven-key `producer_diagnostic` whitelist unchanged; `baseTransitionStatus`
    and its event literals gain the required key.
  - `tests/detach.test.ts` — constructed events compile with the new key;
    a stopped `plan_targets_unwritable_path` `wait` document includes the tokens.
  - Every other TypeScript construction site for `TransitionStatusDocument` /
    `TransitionEventDocument` (`src/core/transition.ts` `emptyTransition` and
    the authorized-transition literal, `src/cli/detach.ts`
    `persistInterruptedTransition`, `tests/transition.test.ts`,
    `tests/cli.test.ts`, `tests/task-status.test.ts`) sets
    `unwritable_plan_targets`. The bar is `npm run typecheck` clean, not a
    pre-enumerated fixture list.

## Out of Scope

- Relaxing the scan for a real out-of-scope *directory* target — that still
  stops.
- Walking the repository or adding `repoRoot` to resolve a bare name to
  `<prefix>/NAME`.
- Putting path tokens into `producer_diagnostic`, widening that closed record,
  or adding a free-text key to it.
- Changing `src/cli/task-status.ts`. `spartan-bridge status --task` reports
  only `state: completed` transitions and has no diagnostic field; a
  `plan_targets_unwritable_path` stop never appears there today. Operator
  surfaces for this stop are the terminal `wait` / blocking-`review` transition
  document and `spartan-bridge transition-status`.
- The `0063` declaration-diagnostic work, the `0064` adapter-capture work, the
  `0065` model-binding toggle.
- Re-running board `0030` — the plan was already corrected
  (`docs/DESIGN_SYSTEM.md`) and re-review is the operator's next step.
- Making the scan understand English intent ("see X" vs "edit X"). Path-shape
  classification is the bar; not NLP.

## Constraints

- English artifact.
- A genuinely out-of-scope write target (a directory path outside the scope, or
  `AGENTS.md` / `spartan-bridge/config.yaml`) must still stop the chain — this
  task narrows a false positive, it does not open a hole.
- `reason_code` vocabulary unchanged. `producer_diagnostic` stays the D-036
  closed record and stays `null` on this pre-spawn stop.
- `unwritable_plan_targets` is a Bridge-owned list of normalized posix tokens
  already written in the approved artifact (no artifact bytes, no line numbers,
  no provider output).
- `SCHEMA_VERSION` stays `2`.
- `npm run typecheck` / `npm run build` clean; `npm test` no new failure,
  including the `0054` regression tests (adjust their signatures, keep their
  intent).

## Decisions

- **D1 — `planTargetsUnwritablePath` returns `string[]`.** The unique
  normalized posix tokens that fail `isUnwritablePlanTarget`, in first-seen
  order. Empty array means no stop. Not a boolean and not a `{ tokens }`
  wrapper. `normalizeRepoPath` is applied before classification, so
  `./AGENTS.md` and `AGENTS.md` collapse to one entry. The one call site in
  `continueAfterPlanReview` becomes `const tokens = planTargetsUnwritablePath(...);
  if (tokens.length > 0)`.
- **D2 — a bare name is a scan target only when it is in
  `KNOWN_TOP_LEVEL_NAMES`.** Change `looksLikeRepoPath`: a token that contains
  `/` is still a repo path; a token that does not is a repo path only when
  `KNOWN_TOP_LEVEL_NAMES` has it. Delete the `PATH_EXTENSIONS` bare-name branch
  and the unused constant. Today's set already includes `AGENTS.md` (first
  entry, `src/core/plan-target-scan.ts` lines 7–15); this task does not add a
  name. After the branch deletion, bare `AGENTS.md` still reaches
  `isUnwritablePlanTarget` through that membership, not through `.md`.
  `isUnwritablePlanTarget` is unchanged (`AUTHORITY_WRITE_PATHS` first, then
  `!isPathAdmittedByScope`). The function stays `(markdown, writeScope) =>
  string[]` with no repository access, so there is no no-repo-access fallback.
  A later repo-walk that treats "file does not exist" as a stop would
  false-positive a new file the implementer is about to create; this task
  favours that false negative over blocking a passed plan.
  `AUTHORITY_WRITE_PATHS` membership still always stops, bare (`AGENTS.md`) or
  prefixed (`spartan-bridge/config.yaml`). A token with a directory component
  still stops when it is outside every write-scope prefix and is not itself an
  exact admitted file.
- **D3 — the stop records `unwritable_plan_targets`, not
  `producer_diagnostic`.** Required `string[] | null` key on
  `TransitionStatusDocument` and `TransitionEventDocument`, `null` at every
  construction site except a `plan_targets_unwritable_path` stop, which stores
  D1's token list. `producer_diagnostic` remains `null` on this stop.
  `createStoppedTransition` gains an optional `unwritablePlanTargets` argument
  (default `null`) and threads it through `emptyTransition` / `stopTransition`
  / `emitTransition`. `wait` and blocking `review` already print
  `serializeTransitionStatus`, so they surface the field once serialize copies
  it. `formatTransitionTerminalLine` names the tokens on stderr for that reason
  code. `persistInterruptedTransition` writes `unwritable_plan_targets: null`
  on its constructed event. Parse of an old record that lacks the key
  normalizes to `null`. `SCHEMA_VERSION` stays `2`. The construction-site bar
  is `npm run typecheck` clean after the key is added everywhere the two
  document types are built, including the helpers and literals in
  `tests/serialize.test.ts`, `tests/transition.test.ts`, `tests/detach.test.ts`,
  `tests/cli.test.ts`, and `tests/task-status.test.ts`.

## Acceptance Criteria

- [x] (D1, D2) A plan whose Scope names `DESIGN_SYSTEM.md` bare, with write
      scope including `docs/`, does not stop the chain.
      `tests/plan-target-scan.test.ts` asserts
      `planTargetsUnwritablePath` returns `[]` for that markdown; a
      `tests/transition.test.ts` case asserts the implementer still spawns.
- [x] (D2) After the `PATH_EXTENSIONS` branch is deleted, a Scope/Decisions
      body whose only path token is bare `AGENTS.md` still classifies: 
      `planTargetsUnwritablePath` returns `["AGENTS.md"]` in
      `tests/plan-target-scan.test.ts`, and the existing `0054`
      `tests/transition.test.ts` case still stops
      `plan_targets_unwritable_path` before producer spawn. A plan naming
      `spartan-bridge/config.yaml` still stops; a plan naming
      `config/secret.env` still stops. Bare `README.md` / `package.json`
      (known top-level names the automatic write scope admits as exact files)
      do not stop. `KNOWN_TOP_LEVEL_NAMES` is not edited.
- [x] (D1) `planTargetsUnwritablePath` returns the exact unique normalized
      token list in first-seen order; `tests/plan-target-scan.test.ts` asserts
      it for a multi-token plan that names both `AGENTS.md` and
      `config/secret.env`.
- [x] (D3) The `plan_targets_unwritable_path` transition stop records those
      tokens in `unwritable_plan_targets` and leaves `producer_diagnostic`
      `null`; the terminal `wait` document and blocking-`review` stdout include
      the field; `formatTransitionTerminalLine` names the tokens on stderr;
      `tests/transition.test.ts`, `tests/serialize.test.ts`, and
      `tests/detach.test.ts` cover persist, parse-missing-as-null, and `wait`.
- [x] (D3) `unwritable_plan_targets` is a required `string[] | null` key;
      `npm run typecheck` is clean after every construction site for
      `TransitionStatusDocument` and `TransitionEventDocument` sets it.
      `serializeProducerDiagnostic` still copies only the seven closed keys;
      `SCHEMA_VERSION` stays `2`; old transition JSON without
      `unwritable_plan_targets` parses with the field `null`.
- [x] (D2, D3) `docs/DECISIONS.md` D-053, `docs/ROUTING-AND-WORKFLOWS.md`, and
      `docs/AUTHENTICATION-AND-SECURITY.md` match D2 and D3.
- [x] `npm run typecheck` / `npm run build` clean; the `0054` regression tests
      in `tests/transition.test.ts` keep their intent (AGENTS.md stops; in-scope
      prefixed paths spawn; fenced `AGENTS.md` does not stop); `npm test` adds
      no new failure.

## Work Completed

- 2026-09-02: task created after board `0030`'s first auto-chain hit
  `plan_targets_unwritable_path` (`transition-8abeb989`, `producer_diagnostic:
  null`) on a bare `DESIGN_SYSTEM.md` shorthand that resolves to the in-scope
  `docs/DESIGN_SYSTEM.md`. The board plan was corrected to `docs/DESIGN_SYSTEM.md`
  to unblock; this task fixes the scan.
- 2026-09-02 (planner, Cursor, cursor-grok-4.6-high-fast, effort high): refined against the current scan, policy, transition,
  serialize, wait, and status surfaces. Pinned D1 as `string[]`, D2 as
  `KNOWN_TOP_LEVEL_NAMES`-only bare-name classification with no repo walk, D3
  as additive `unwritable_plan_targets` (not `producer_diagnostic`). Verified
  every named path; `tests/plan-target-scan.test.ts` is absent and is in Scope
  as a creation. Adopted HX-001; issued HX-002 for plan review.
- 2026-09-02 (planner, same session): revised against
  `KNOWN_TOP_LEVEL_AGENTS_MD`, `STOP_TRANSITION_THREADING`, and
  `CONTRACT_KEY_CONSTRUCTION_SITES`. Confirmed `KNOWN_TOP_LEVEL_NAMES` already
  lists `AGENTS.md` as its first entry; D2 now records that membership and does
  not add a name. Listed `stopTransition` in Scope. Stated the required-key
  typecheck bar and named the construction-site files. Issued HX-003.
- 2026-09-02 (implementer, Cursor, cursor-grok-4.6-high-fast, effort high): implemented D1/D2/D3. Human-started because
  the plan-pass auto-chain stopped on this scan's own backticks. Pasted
  prompt carried no identifier; `next_handoff_id` was `none`. Issued HX-004
  for implementation review.

## Evidence

- `npm run typecheck` — exit 0.
- `npm run build` — exit 0.
- `npm test` — 474 pass, 0 fail (2026-09-02).
- `tests/plan-target-scan.test.ts` — bare `DESIGN_SYSTEM.md` with `docs/` →
  `[]`; bare `AGENTS.md` → `["AGENTS.md"]`; `config/secret.env` and
  `spartan-bridge/config.yaml` flagged; `README.md` / `package.json` not
  flagged; `AGENTS.md` + `./AGENTS.md` + `config/secret.env` →
  `["AGENTS.md", "config/secret.env"]`.
- `tests/transition.test.ts` — AGENTS.md stop records
  `unwritable_plan_targets: ["AGENTS.md"]` and `producer_diagnostic: null`
  before spawn; bare `DESIGN_SYSTEM.md` still spawns; in-scope and fenced
  0054 cases keep their intent.
- `KNOWN_TOP_LEVEL_NAMES` unchanged (`AGENTS.md` first). `PATH_EXTENSIONS`
  deleted. `SCHEMA_VERSION` remains 2.
- Board `agent-spartan-protocol-board` `transition-8abeb989-1639-4dd1-944d-b076703d67a6`
  — the false-positive stop this change addresses.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-6fb18cc0-349b-41c7-8766-8417f1a4a7d8 execution_id=exec-9f998ea0-63c5-4b53-b205-9b7a050b6ce3 review_kind=plan verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-opus-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:5a74e728a1985947915bf18ad1f0bb996d8f60b76b5ef05870e614ae8c0b8a56 task_hash=sha256:cd18029f7734829146e57d349461bedf4cbbe100dd42c1e86860d078df3ab4e4 agents_hash=sha256:8c5ea585bde94cfad8dd44a4887699564541608b157d2046244f834226ece7fa timestamp=2026-09-02T23:23:48.056Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-4fdbfb53-e9bd-438a-8fae-65e2e768772a execution_id=exec-5660bcca-da10-4b05-af43-fc3bc9bec16a review_kind=implementation verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-opus-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:1a2b7e24b78bc51432866607cd179270ba59bd8d0081a685699860fc477ec92e task_hash=sha256:b570dd5585a26ed9e1ca58297f9029f1834bc788dbbc791b065e6542a5cbd69a agents_hash=sha256:8c5ea585bde94cfad8dd44a4887699564541608b157d2046244f834226ece7fa timestamp=2026-09-03T00:53:02.925Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None. Independent of `0063` / `0064` / `0065`.

## Next Action

None. Implementation review APPROVED (`run-4fdbfb53`, claude-opus-5, no findings). `npm run typecheck` / `npm run build` exit 0; `npm test` 474 pass, 0 fail. Committed and pushed. The plan-pass auto-chain stopped on this scan's own `AGENTS.md` backticks; the implementer round ran human-started.

## Next Handoff

No outstanding handoff. The task is complete.
