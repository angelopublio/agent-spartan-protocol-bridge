---
protocol: "1.1.0" # x-release-please-version
id: the-plan-target-scan-is-advisory-after-a-passed-review
created_at: 2026-09-03
status: completed
phase: complete
task_type: implementation
risk: high-impact
current_role: human-operator
next_role: none
updated_at: 2026-09-03
handoff_id: HX-004
next_handoff_id: none
---

# The plan-target scan is advisory after a passed review, not a hard stop

## Objective

After `reviewer.plan` returns `pass`, a task-0054 plan-target scan hit no longer
stops the auto-chain. `continueAfterPlanReview` records the offending tokens on
the transition (`unwritable_plan_targets`) as a warning on the existing
`authorization` event and still spawns the mapped implementer. The producer
write-scope guard — POSIX mode lock, Darwin `sandbox-exec` profile, post-child
snapshot — remains the write boundary for `AGENTS.md`,
`spartan-bridge/config.yaml`, and every other out-of-scope path. A plan that
only *mentions* those paths in prose can no longer false-stop a passed review.

## Context

The task-0054 pre-spawn scan (`planTargetsUnwritablePath` →
`plan_targets_unwritable_path` stop) has false-positived three times in live use:

| Incident | Token | Reality |
| --- | --- | --- |
| board `0030` (`transition-8abeb989`) | bare `` `DESIGN_SYSTEM.md` `` | resolves to in-scope `docs/DESIGN_SYSTEM.md` |
| bridge `0066` (`transition-282a1262`) | `` `AGENTS.md` ``, `` `spartan-bridge/config.yaml` `` in prose | acceptance-criteria examples, not write targets |
| bridge `0063` (`transition-7ce708b5`) | `` `advisory.split("\n")...` `` | a quoted JS predicate; `\n`→`/n` made it look like a path |

`0066` narrowed bare-name classification; the `0063` character-class guard
rejects code tokens. Neither closes the class: a heuristic prose scan cannot
tell "edit X" from "X is an example", and Bridge tasks inherently discuss
`AGENTS.md`, `spartan-bridge/config.yaml`, and the scanner's own code. `0066` and
`0063` both had to run their implementer round human-started to get past the
scan of their own approved plans.

A second opinion (Grok, 2026-09-03) confirmed the scan is an operational
preflight, not the write barrier. Three independent layers already make
`AGENTS.md` unwritable to a mapped implementer:

- **POSIX mode lock** — `applyProducerWriteScope` / `pathRemainsWritable`
  (`src/adapters/producer-write-scope.ts` line 305) forces the repo root `0555` and
  leaves a file writable only when `isPathAdmittedByScope` and not
  `producerPathDenied`. No directory prefix admits a root-level file, so
  `AGENTS.md` is `0444`.
- **Darwin `sandbox-exec`** — Cursor and Grok spawn with
  `sandboxProfile: guard.sandboxProfile` (`deny file-write*` under the real repo
  root except admitted subpaths). `tests/producer-write-scope.test.ts` proves a
  `writeFile`/`chmod` of `AGENTS.md` returns `EPERM` while `src/` succeeds.
- **Post-child snapshot** — `producerDiffViolatesScope`
  (`src/core/transition.ts` line 879) turns any unadmitted product diff into
  `write_scope_violation`.

Board/bridge `0050` is the existence proof this was ever needed at the runtime:
a passed plan review with a D1 that only edited `AGENTS.md` burned ~6.5 min, the
guard returned `EPERM`, implementation review returned `human_required`. The
write never landed. `0054` bought back that spent round with a preflight; it has
since cost far more rounds to false positives than it has ever saved.

## The gap the second opinion surfaced

`isUnwritablePlanTarget` (`src/core/plan-target-scan.ts` line 114) is **stricter than
the guard**: it always flags `AUTHORITY_WRITE_PATHS`
(`AGENTS.md`, `spartan-bridge/config.yaml`); the guard only uses
`isPathAdmittedByScope`.

- `AGENTS.md` at repo root: no well-formed prefix admits it, and an exact
  write-scope entry `AGENTS.md` is rejected by `writeScopeContradictsReviewScope`
  (`src/policy/agents-policy.ts` line 621). The guard blocks it today.
- `spartan-bridge/config.yaml`: a consumer scope that lists `spartan-bridge/`
  (as a directory, in both write and review scope) makes
  `isPathAdmittedByScope("spartan-bridge/config.yaml", ["spartan-bridge/"])`
  true — a writable dir and a sandbox `(subpath …/spartan-bridge)` that includes
  `config.yaml`. Today only the scan still stops that token.
- Same-class parser hole: a scope entry `AGENTS.md/` is not the exact string
  `AGENTS.md`, so `writeScopeContradictsReviewScope` does not fire, and
  `isPathAdmittedByScope("AGENTS.md", ["AGENTS.md/"])` is true.

Making the scan advisory without closing this gap would leave those two files
writable under a permissive-but-plausible consumer scope. The prerequisite below
aligns the guard to the scan.

## Scope

### Prerequisite — align the write-scope guard and snapshot to `AUTHORITY_WRITE_PATHS`

- `src/policy/agents-policy.ts`: export `isAuthorityWritePath(posix)` beside
  `AUTHORITY_WRITE_PATHS` (D1).
- `src/adapters/producer-write-scope.ts` `pathRemainsWritable`: return `false`
  when `isAuthorityWritePath(posix)` is true, before `isPathAdmittedByScope`.
  `producerWriteScopeSandboxProfile` in the same module adds a `(literal …)`
  branch to the **outer** `require-any` — the `deny file-write*` filter itself,
  sibling to the two existing `require-all` branches — so a parent `(subpath)`
  cannot `chmod`+write it. Not to the `admitted` array: that array is the
  exception inside `require-not`, so a literal there would *admit* the file.
- `src/core/transition.ts` `producerDiffViolatesScope`: the same predicate, not
  raw `isPathAdmittedByScope` alone.
- `src/policy/agents-policy.ts` `writeScopeContradictsReviewScope`: a write scope
  that would admit any `AUTHORITY_WRITE_PATHS` member via `isPathAdmittedByScope`
  is a policy contradiction (fail closed at parse, not at spawn).
- Tests: `tests/producer-write-scope.test.ts` — a `spartan-bridge/` write scope
  still locks `config.yaml`; `tests/agents.test.ts` — `["spartan-bridge/"]` /
  `["AGENTS.md/"]` are rejected.

### Main — demote the stop to a warning after a pass

- `src/core/plan-target-scan.ts`: unchanged (still returns the token list). The
  `0063` character-class guard and `0066` bare-name rule stay.
- `src/core/transition.ts` `continueAfterPlanReview`: when
  `planTargetsUnwritablePath` returns a non-empty list after `verdict === "pass"`,
  do **not** `createStoppedTransition("plan_targets_unwritable_path")`. Set
  `unwritable_plan_targets` on the transition status before the existing
  `authorization` emit, then continue to `runProducerRound` (D2). Later
  `stopTransition` / `persistInterruptedTransition` keep that field. If the
  implementer then writes one of those paths, `write_scope_violation` stops it
  with a precise reason.
- `src/core/contracts.ts`: `TransitionEventType` is unchanged (no
  `plan_targets_flagged`); `plan_targets_unwritable_path` stays on `ReasonCode`
  and is not emitted on the pass path (D3); `SCHEMA_VERSION` stays `2`.
- `src/cli/main.ts` `formatTransitionTerminalLine`: a non-null
  `unwritable_plan_targets` prints ` targets=` regardless of `reason_code` (D4).
- `src/cli/detach.ts`: a terminal transition document already serializes the
  field; keep that. Do not add the field to the four-key `{state:"running"}`
  wait poll.
- `agent-skill/skills/spbridge/SKILL.md` step 5: quote a non-null
  `unwritable_plan_targets` as an advisory, not a stop (D4).
- `docs/DECISIONS.md` — amend D-053: after `reviewer.plan: pass` the scan is
  advisory; the producer write-scope guard (mode lock + Darwin profile +
  post-child snapshot) is the write boundary. The `AGENTS.md` authoring rule
  stays planner discipline.
- `docs/ROUTING-AND-WORKFLOWS.md` / `docs/AUTHENTICATION-AND-SECURITY.md` — the
  pre-spawn scan sentence and the write-boundary sentence match.
- Tests: `tests/transition.test.ts` — a plan whose Decisions backtick
  `` `AGENTS.md` `` in prose after a passed review **spawns the implementer**
  (no `plan_targets_unwritable_path` stop) and the transition carries the
  tokens; a plan whose implementer then actually writes `AGENTS.md` still stops
  `write_scope_violation`. Keep a `0054`-style test that the tokens are recorded.
  `tests/cli.test.ts` / `tests/detach.test.ts` — the advisory surfaces without
  that reason code. `tests/spbridge-skill.test.ts` — the step-5 advisory wording.

## Out of Scope

- A write-verb heuristic ("edit X" vs "see X") — still English; `0066` rejected
  NLP.
- A mandatory fenced `## Write Targets` block as the auto-chain gate — an
  omission class; keep prose free. May be authoring hygiene later.
- Removing the scan or the token list entirely — the tokens stay useful in
  `wait` / stderr.
- Human-started `/spbridge` / `/spartan` producer rounds — they never ran this
  scan (D-053) and are unchanged.
- Changing `PLAN_REVIEW_NEXT_ROLE.pass` or how the Bridge keys the successor on
  `verdict === "pass"`.
- A new `TransitionEventType` (`plan_targets_flagged` is rejected in D2).
- Extending `StatusDocument` or the four-key `wait` running poll with
  `unwritable_plan_targets`.
- Editing `AGENTS.md` or `spartan-bridge/config.yaml` — this plan mentions them
  as guard targets; it does not edit them. Frontmatter after a plan-review pass
  stays `next_role: implementer`, not `human-operator`.

## Constraints

- English artifact.
- After this task, `AGENTS.md` and `spartan-bridge/config.yaml` must be
  unwritable to a mapped implementer under **every** write scope the parser
  accepts *and* under a synthetic prefix scope the parser would reject —
  proven by `tests/producer-write-scope.test.ts` and `tests/agents.test.ts`,
  not by the scan.
- A genuine out-of-scope write still terminates as `write_scope_violation` with
  the offending path.
- `continueAfterPlanReview` does not pass `plan_targets_unwritable_path` to
  `createStoppedTransition` on the `verdict === "pass"` path. The `ReasonCode`
  member stays in the union (D3).
- `SCHEMA_VERSION` stays `2`; `TransitionEventType` stays the current nine
  members; `npm run typecheck` / `npm run build` clean; `npm test` no new
  failure; the `0054` / `0066` regression tests keep their intent (tokens
  recorded; a real out-of-scope directory target still visible).
- Until this task's implementation lands, a `/spbridge` plan-review pass of
  *this* artifact still hits today's `plan_targets_unwritable_path` stop
  because `## Scope` and `## Decisions` backtick `AGENTS.md` and
  `spartan-bridge/config.yaml`. That stop is expected; the mapped implementer
  round is human-started, as with `0066` and `0063`.

## Decisions

- **D1 — `isAuthorityWritePath` and the three sites.** Export from
  `src/policy/agents-policy.ts`, beside `AUTHORITY_WRITE_PATHS`:

  ```ts
  export function isAuthorityWritePath(posix: string): boolean {
    for (const authority of AUTHORITY_WRITE_PATHS) {
      if (posix === authority || posix.startsWith(`${authority}/`)) {
        return true;
      }
    }
    return false;
  }
  ```

  Exact posix match, no case-fold. A descendant of an authority path
  (`AGENTS.md/foo`, `spartan-bridge/config.yaml/foo`) is also an authority
  path. `spartan-bridge` itself is not.

  Three application sites, plus the sandbox builder in site 1's module:

  1. `pathRemainsWritable` (`src/adapters/producer-write-scope.ts`): if
     `isAuthorityWritePath(posix)` return `false`, then the existing `.` /
     `producerPathDenied` / `isPathAdmittedByScope` checks. In the same
     module, `producerWriteScopeSandboxProfile` adds each authority path as a
     `(literal …)` branch of the **outer** `require-any` — the filter of
     `deny file-write*`, sibling to the two existing `require-all` branches —
     so a parent `(subpath …/spartan-bridge)` cannot `chmod` or write
     `config.yaml`. Other files under that directory stay admitted.

     There are two `require-any` in that profile and only the outer one
     denies. The `admitted` array sits inside
     `(require-not (require-any <admitted>))`: it is the *exception* to the
     deny, and the builder already emits `(literal …)` there for an
     exact-file scope entry. Pushing an authority path onto `admitted` is
     therefore the opposite of the intent — redundant at best, and an
     admission of the file when its parent is not otherwise admitted. The
     resulting shape:

     ```text
     (deny file-write*
       (require-any
         (require-all (subpath root) (require-not (require-any <admitted>)))
         (require-all (subpath root) (vnode-type SYMLINK))
         (literal "<root>/AGENTS.md")
         (literal "<root>/spartan-bridge/config.yaml")))
     ```

     A second `(deny file-write* (literal …))` form, sibling to the current
     block, denies equally; either is acceptable. The `(literal …)` does not
     replace `pathRemainsWritable` or the snapshot check — it covers only the
     case where an admitted `(subpath)` parent would otherwise reach the
     file.
  2. `producerDiffViolatesScope` (`src/core/transition.ts`): violate when
     `isAuthorityWritePath(entry.path)` **or** `!isPathAdmittedByScope` **or**
     `producerPathDenied`.
  3. `writeScopeContradictsReviewScope` (`src/policy/agents-policy.ts`):
     contradict when
     `AUTHORITY_WRITE_PATHS.some((p) => isPathAdmittedByScope(p, writeScope))`.
     That one check covers exact `AGENTS.md`, exact
     `spartan-bridge/config.yaml`, parent prefix `spartan-bridge/`, and
     trailing-slash `AGENTS.md/`. It replaces the current
     `writeScope.some((entry) => AUTHORITY_WRITE_PATHS.includes(entry))`.

  `src/core/plan-target-scan.ts` stays unchanged and keeps its own
  `AUTHORITY_WRITE_PATHS.includes` branch.

- **D2 — reuse `authorization`; do not add `plan_targets_flagged`.** After
  `verdict === "pass"`, a non-empty `planTargetsUnwritablePath` list does not
  stop. `continueAfterPlanReview` writes that list onto
  `transition.status.unwritable_plan_targets` before the existing
  `emitTransition(..., "authorization", "authorized")`. The field already
  rides on every `TransitionEventDocument`, so the authorization event *is*
  the warning. `TransitionEventType` is unchanged. `RESUMABLE_CHECKPOINTS`
  is unchanged. `SCHEMA_VERSION` stays `2`.

  `stopTransition` and `persistInterruptedTransition` keep the status's
  existing `unwritable_plan_targets` when they do not receive a replacement
  list (`null` no longer wipes a previously recorded advisory). Then
  `runProducerRound` as today. A later real write of an authority path still
  stops as `write_scope_violation`.

- **D3 — keep `plan_targets_unwritable_path` on `ReasonCode`; never emit it
  on the auto-chain pass path.** Leave the union member so historical
  transition records (board `0030`, bridge `0066`, `0063`) stay in
  vocabulary and `SCHEMA_VERSION` stays `2` without shrinking the closed
  set. No remaining `continueAfterPlanReview` call passes that string to
  `createStoppedTransition`. Do not add a new producer of the code (human-
  started producer rounds remain out of scope). Rewrite the `0054` stop
  test to the advisory-spawn path.

- **D4 — advisory wording, not a stop.** `formatTransitionTerminalLine`
  (`src/cli/main.ts`) appends ` targets=<csv>` whenever
  `unwritable_plan_targets` is non-null, with no `reason_code ===
  plan_targets_unwritable_path` gate. Detached `wait` keeps the four-key
  `{state, run_id, phase, phase_since}` running poll; a terminal
  *transition* document already serializes the field. Do not add the field
  to `StatusDocument`.

  `agent-skill/skills/spbridge/SKILL.md` step 5, in the `"document":
  "transition"` bullet, after the `declaration_invalid_detail` sentence,
  add exactly:

  `Quote \`unwritable_plan_targets\` when that field is a non-null array.
  Those tokens are an advisory that the approved plan mentioned paths
  outside the automatic write scope; they are not a stop and do not
  replace \`state\` or \`reason_code\`.`

  Step 6 / step 7 stop rules are unchanged: the field is not a
  `reason_code` and does not by itself print an implementer recommendation.

## Acceptance Criteria

- [x] (D1) `isAuthorityWritePath` is exported from
      `src/policy/agents-policy.ts` with the predicate above.
      `pathRemainsWritable`, `producerDiffViolatesScope`, and
      `writeScopeContradictsReviewScope` each call it or
      `AUTHORITY_WRITE_PATHS.some((p) => isPathAdmittedByScope(p, writeScope))`
      as D1 names. `producerWriteScopeSandboxProfile` emits a `(literal …)`
      deny for each authority path as a branch of the outer `require-any`, and
      no authority path appears in the `admitted` array.
- [x] (D1) `tests/producer-write-scope.test.ts`: a write scope of
      `["spartan-bridge/"]` locks existing `spartan-bridge/config.yaml` to
      `0444`, and under the Darwin sandbox `writeFile`/`chmod` of that file
      return `EPERM` while another file under `spartan-bridge/` succeeds.
- [x] (D1) `tests/agents.test.ts`: write scopes `["spartan-bridge/"]` and
      `["AGENTS.md/"]` (and the already-covered exact authority entries)
      fail parse as `write_review_scope_contradiction`.
- [x] (D2) `tests/transition.test.ts`: a plan whose Decisions prose-backticks
      `` `AGENTS.md` `` after a passed review spawns the mapped implementer,
      the transition records `unwritable_plan_targets: ["AGENTS.md"]`, the
      `authorization` event carries that list, `TransitionEventType` has no
      `plan_targets_flagged` member, and there is no
      `plan_targets_unwritable_path` stop.
- [x] (D2) `tests/transition.test.ts`: an implementer that actually writes
      `AGENTS.md` in that same run still terminates `write_scope_violation`.
      The offending path is named on that stop only when the advisory
      `unwritable_plan_targets` list happens to contain it; this task does
      not put the path on the `write_scope_violation` record.
      `stopTransition` / `persistInterruptedTransition` leave a previously
      recorded `unwritable_plan_targets` list in place.
- [x] (D3) grep of `src/core/transition.ts` shows no
      `plan_targets_unwritable_path` argument on the
      `continueAfterPlanReview` pass path; `ReasonCode` in
      `src/core/contracts.ts` still includes the member.
- [x] (D4) `formatTransitionTerminalLine` prints ` targets=` for a
      non-null `unwritable_plan_targets` even when `reason_code` is not
      `plan_targets_unwritable_path`; `tests/cli.test.ts` covers it.
      `tests/detach.test.ts` covers a terminal transition document that
      still includes the field when `reason_code` is some other stop.
- [x] (D4) `agent-skill/skills/spbridge/SKILL.md` step 5 contains the D4
      sentences; `tests/spbridge-skill.test.ts` matches them.
- [x] `docs/DECISIONS.md` D-053 amended; `docs/ROUTING-AND-WORKFLOWS.md`
      replaces the "stops with `plan_targets_unwritable_path`" sentence
      with the advisory-after-pass wording; `docs/AUTHENTICATION-AND-SECURITY.md`
      states the three-layer producer write-scope guard is the write
      boundary and the plan-target scan is not.
- [x] `SCHEMA_VERSION` stays `2`; `npm run typecheck` / `npm run build`
      clean; `npm test` adds no new failure.

## Work Completed

- 2026-09-03: task created after the plan-target scan false-positived a third
  time (bridge `0063`, on the plan's own quoted JS predicate). A Grok second
  opinion traced the three-layer producer write-scope guard, confirmed
  `AGENTS.md` / `spartan-bridge/config.yaml` are unwritable independent of the
  scan (under a well-formed scope), named the `spartan-bridge/`-prefix gap, and
  recommended demoting the stop to an advisory after a passed review with that
  gap closed first.
- 2026-09-03 (planner, Cursor, cursor-grok-4.6-high-fast, effort high): pinned D1–D4 against the named sources. Verified
  every path this plan names exists in the current checkout. Adopted HX-001;
  issued HX-002 for `reviewer`.
- 2026-09-03 (implementer, Cursor, cursor-grok-4.6-high-fast, effort high): implemented D1 then D2/D3/D4 in one round.
  Authority-path literals sit on the outer `require-any` of `deny file-write*`,
  not in `admitted`. Plan-target hits after `reviewer.plan: pass` are recorded
  on `unwritable_plan_targets` and the mapped implementer still spawns.
  Adopted HX-002; issued HX-003 for `reviewer`.
- 2026-09-03 (implementer, Cursor, cursor-grok-4.6-high-fast, effort high): cycle-2 correction against the three
  recorded implementation-review findings. Restated the
  `producer_diagnostic` paragraph so a plan-target scan hit records
  `unwritable_plan_targets` as a Bridge-owned advisory on the transition
  record, independent of `reason_code`. Replaced the vacuous
  `/config\\.yaml/` regex with `/config\.yaml/`. Re-derived the D2
  criterion from D2 itself: the write still terminates
  `write_scope_violation`, and the offending path is named only when the
  advisory token list happens to contain it. Did not change
  `producerDiffViolatesScope` or the stop record. Issued HX-004 for
  `reviewer`.

## Evidence

- `npm run typecheck` — exit 0.
- `npm run build` — exit 0 (`tsc` + `chmod +x dist/cli/main.js`).
- `npm test` — 496 pass, 0 fail (`node --import tsx --test tests/*.test.ts`).
- Cycle-2 re-run of those three commands after the three finding fixes:
  typecheck exit 0; build exit 0; `npm test` 496 pass, 0 fail.
- `docs/AUTHENTICATION-AND-SECURITY.md` producer_diagnostic paragraph now
  records a plan-target scan hit as a Bridge-owned advisory on the
  transition record (authorization event and terminal document),
  independent of `reason_code`; classification remains Bridge-owned
  normalized posix tokens already present in the approved artifact, not
  `producer_diagnostic`, not provider output.
- `tests/producer-write-scope.test.ts` line 446 uses `/config\.yaml/`,
  matching line 36.
- Gap (VIOLATION_NAMES_NO_PATH): `producerDiffViolatesScope` remains a
  boolean; a `write_scope_violation` stop still carries `diagnostic: null`.
  The offending path is visible on that record only when a prior
  plan-target scan already listed it on `unwritable_plan_targets`.
  Carrying the path on the stop itself is a separate change.
- `tests/producer-write-scope.test.ts` — `["spartan-bridge/"]` locks
  `config.yaml` to `0444`; Darwin `writeFile`/`chmod` of that file return
  `EPERM` while `spartan-bridge/other.yaml` succeeds; authority `(literal …)`
  denies are siblings of the two `require-all` branches.
- `tests/agents.test.ts` — `["spartan-bridge/"]` and `["AGENTS.md/"]` fail
  parse as `write_review_scope_contradiction`.
- `tests/transition.test.ts` — prose-backtick `` `AGENTS.md` `` after a pass
  spawns the implementer with `unwritable_plan_targets: ["AGENTS.md"]` on the
  `authorization` event; a real write of `AGENTS.md` still stops
  `write_scope_violation` with that list left in place.
- `tests/cli.test.ts` / `tests/detach.test.ts` / `tests/spbridge-skill.test.ts`
  — ` targets=` prints without a `plan_targets_unwritable_path` gate; a
  terminal `write_scope_violation` document still serializes the field;
  `persistInterruptedTransition` keeps it; step 5 quotes the advisory.
- `src/core/transition.ts` has no `plan_targets_unwritable_path` string;
  `ReasonCode` in `src/core/contracts.ts` still includes the member;
  `SCHEMA_VERSION` stays `2`.

## Second Opinion

- 2026-09-03 (Cursor, cursor-grok-4.6-high-fast, out-of-band, read-only): asked
  because D1 edits the `sandbox-exec` profile and D2 relaxes a gate. Four
  questions — SBPL nesting, residual write paths after D1, whether D2 widens
  surface, and whether D2 may land before D1.

  One real finding, folded into D1 above: the `(literal …)` deny must be a
  branch of the **outer** `require-any`, not an entry in `admitted`. With a
  write scope of `["spartan-bridge/"]` the admitted `(subpath)` already matches
  `config.yaml`, so `require-not` is false, the first `require-all` never fires,
  and `(allow default)` lets the write through; a literal added to `admitted`
  would not cut that parent and would admit the file outright when the parent is
  absent. D1's original wording named "the `deny file-write*` `require-any`",
  which is the outer one and therefore correct, but two `require-any` exist in
  that profile and only one denies — the ambiguity is now pinned.

  Confirmed, not changed: after D1 there is no persistent write path to either
  authority file under any write scope the parser then accepts (rename needs the
  parent write bit and the root stays `0555`; `file-link` is denied tree-wide;
  a pre-existing writable hard link is rejected by `rejectWritableHardLinks`;
  the snapshot's new `isAuthorityWritePath` arm is the net under a same-UID
  `chmod` without the sandbox). Residuals D1 does not claim to close, unchanged:
  a skipped-tree symlink resolving outside the root (D-051), Linux without
  `sandbox-exec`, and human-started rounds outside the Bridge.

  On ordering: D2 before D1 is safe **in this checkout**, because the declared
  automatic write scope (`src/`, `tests/`, `docs/`, `skills/`,
  `agent-skill/skills/spbridge/SKILL.md`, `spartan/`, `README.md`,
  `package.json`, `package-lock.json`, `tsconfig.json`) admits neither authority
  path — `spartan/` is not a prefix of `spartan-bridge/`, since the test is
  `` `${prefix}/` ``. Turning that window into a real exposure would require
  editing `AGENTS.md` to put `spartan-bridge/` or `AGENTS.md/` in **both** the
  write and the review scope, which is a human gate a mapped implementer cannot
  reach. The scan is meanwhile *stricter* than the guard — it flags
  `AUTHORITY_WRITE_PATHS` unconditionally, while the guard only asks
  `isPathAdmittedByScope` — so it was the only stop covering that window.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-6a12c39a-10be-441c-999a-1057c3ed3b27 execution_id=exec-8ee619b9-d513-46a7-8afa-ba9f76682265 review_kind=plan verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-opus-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:5a74e728a1985947915bf18ad1f0bb996d8f60b76b5ef05870e614ae8c0b8a56 task_hash=sha256:f4e59f53a0ba0f93d1cfaab0d06532562995be59db8d7097df68be1ca2c2703e agents_hash=sha256:8c5ea585bde94cfad8dd44a4887699564541608b157d2046244f834226ece7fa timestamp=2026-09-03T09:40:56.386Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-8dae3882-027e-4de5-8205-8e7a706c753b execution_id=exec-ab67d6f7-b957-4156-b765-4850d07be97d review_kind=implementation verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-opus-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:1a2b7e24b78bc51432866607cd179270ba59bd8d0081a685699860fc477ec92e task_hash=sha256:5dbf750c60cf8b5d428315cf736b6d2854eba5cf85849fb697f3f26167ece0d0 agents_hash=sha256:8c5ea585bde94cfad8dd44a4887699564541608b157d2046244f834226ece7fa timestamp=2026-09-03T19:44:25.864Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None. Independent of `0063` / `0064` / `0065`; the `0063` and `0064` work does
not touch `plan-target-scan.ts` or the write-scope guard.

## Next Action

None. Implementation review APPROVED (`run-8dae3882`, claude-opus-5, cycle 2 of
3, no findings) after a cycle-1 `CHANGES_REQUESTED` whose three findings were
all fixed. `npm run typecheck` / `npm run build` exit 0; `npm test` 496 pass,
0 fail. Committed and pushed.

Cycle 2 took six dispatches. Five (`run-3e3b8978`, `run-99cd4da7`,
`run-834627d4`, `run-eb3db819`, and a hand-run reproduction) died as
`adapter_error` / `collect` / `exit_nonzero` with `stderr_bytes: 0`; the sixth
passed on a byte-identical artifact (`task_hash` `sha256:5dbf750c…` on both the
last failure and the pass). The outcome was therefore non-deterministic and
independent of the input. Only one of those failures was ever given a name — a
hand-run reproduction during a Claude/Cursor status incident returned
`api_error_status: 529` — and the rest stayed anonymous because
`buildAdapterOutputExcerpt` keeps the head of stdout. All five reused
`--after-run run-35668b16`, so none burned a review cycle. Evidence folded into
task `0064`.

## Next Handoff

No outstanding handoff. The task is complete.
