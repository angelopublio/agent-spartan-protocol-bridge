---
protocol: "1.1.0" # x-release-please-version
id: the-producer-copy-discards-only-this-repositorys-build-output
created_at: 2026-09-11
status: completed
phase: complete
task_type: implementation
risk: high-impact
current_role: human-operator
next_role: human-operator
updated_at: 2026-09-12
handoff_id: HX-007
next_handoff_id: none
---

# The producer copy discards only this repository's build output

## Objective

The producer scratch prefixes are a module constant naming this repository's own build output. A
consumer repository whose declared build writes anywhere else has that output snapshotted and
classified as product, so its auto-chain cannot finish — and no repository-side setting changes
that.

## Context

Observed on 2026-09-11 in a managed repository running a JavaScript framework whose build cache is
a handful of very large files. The plan review passed, the auto-chain started the mapped implementer,
the producer ran to completion, and the round was then discarded before any merge.

Four facts compose it:

- `src/core/workspace.ts:40` — `PRODUCER_SCRATCH_PREFIXES` is `["dist/", "node_modules/.cache/"]`,
  a module constant. It is read at three sites: the baseline snapshot in
  `prepareProducerWorkspace`, the post-run snapshot in `src/core/transition.ts:762`, and the
  `scratch` disposition in `classifyProducerWorkspacePath`.
- `src/core/snapshot.ts:154` — `const hashFully = state.policy === "workspace" || stat.size <= SNAPSHOT_HASH_FILE_CAP;`.
  The 1 MiB per-file ceiling that protects the live-tree walk is bypassed for the `workspace`
  policy, which is exactly the policy of both producer-copy snapshots. Every file is read and
  hashed in full against a 256 MiB total, twice per round.
- `src/policy/bridge-config.ts:140` — the config parser is exact-shape strict:
  `producerKeys.length !== 1 || producerKeys[0] !== "model_binding"` rejects the document, and the
  top level rejects any key count other than 2 or 3. A repository that tries to declare a scratch
  prefix does not get an ignored key; it gets `config_invalid` and the Bridge stops.
- `src/core/transition.ts:892` — `mapProducerCaptureError` returns `reviewer_isolation_unavailable`
  for a `SnapshotCapError`. On a producer transition, where no reviewer participates, that reason
  code sends an operator to look at adapters and sandboxes rather than at a cap.

**Why it stayed hidden.** This repository's build writes to the first default prefix, so the
producer's own build output is discarded exactly as intended and the defect cannot reproduce here.
Every consumer repository with a different build directory meets it on its first auto-chain.

## Scope

Nothing here edits an authority path from a producer round. Every path below is admitted by this
repository's automatic implementation write scope, confirmed in E-8.

- `src/policy/bridge-config.ts` — the `producer` key check, and shape validation of a declared
  prefix list.
- `src/policy/agents-policy.ts` — export `isValidScopePath` so the prefix grammar has one
  definition rather than two.
- `src/core/workspace.ts` — split the scratch constant, add the resolved list to
  `prepareProducerWorkspace`'s input and to `PreparedProducerWorkspace`, and give
  `classifyProducerWorkspacePath` and `captureProducerMerge` the same parameter.
- `src/core/transition.ts` — resolve the effective list once, refuse an overlapping declaration,
  thread the resolved value onto the single producer input, and change the reason code a producer
  snapshot-cap stop reports.
- `src/core/contracts.ts` — one added `ReasonCode` member.
- `src/core/snapshot.ts` — read for the per-file hashing rule; unchanged, per D6.
- `docs/AUTHENTICATION-AND-SECURITY.md` — the producer-copy and snapshot paragraphs.
- `docs/ROUTING-AND-WORKFLOWS.md` — the config source row and optional producer configuration.
- `docs/ARCHITECTURE.md` — the producer-workspace summary.
- `docs/DECISIONS.md` — one dated entry and its relationship to D-074.
- `tests/bridge-config.test.ts`, `tests/producer-write-scope.test.ts`, and the transition tests
  covering the config parser, the two producer snapshots, the merge classifier, and the reason code.

## Out of Scope

- Raising `SNAPSHOT_ENTRY_CAP`. Task `0077` already refused that, and the measurement in Evidence
  shows raising a cap is the wrong lever: the observed output is roughly thirty-six times the whole
  byte budget and grows with the project.
- The reviewer workspace prepared for an implementation review. It copies only the declared
  implementation review scope, which admits no build output, and is not affected. Task `0077`
  recorded the same exclusion.
- `snapshotRuntimeOwnership` reaching a cap from accumulated run history. Task `0077` named that
  residual in its own Out of Scope and it is still unowned. This plan does not fold it in: D7 changes
  what that stop reports, which touches the same call site, but the cap itself and the run-history
  growth behind it stay untouched and unowned.
- This repository's own `spartan-bridge/config.yaml`. Its build writes to `dist/`, a default prefix,
  so the fix needs no declaration here. Declaring the dependence explicitly would be honest — it is
  the inherited default that hid this defect — but that file is outside every automatic write scope,
  so adding it would force a human implementer for a line the fix does not need. Deferred, stated
  rather than absorbed. D8 records the evaluation.
- Reporting the D3 overlap from `doctor`. The overlap is a policy-readiness fact `doctor` could
  report before a round is spent, and `src/core/doctor.ts` is deliberately not in Scope: this plan
  enforces the rule at the one point that must fail closed, and a pre-flight report is a separate,
  smaller change. Named so a reviewer sees it was weighed, not missed.
- The redaction gap that hid this diagnosis. The summary tool that carries a run out of its
  repository dropped two of the nine closed diagnostic keys; that lives outside this repository and
  was fixed directly on 2026-09-11.

## Constraints

- A declared scratch prefix makes a producer write under it **silently discarded** rather than
  refused. Today a write outside the write scope is a visible `write_scope_violation`. A repository
  that could declare a prefix overlapping its own automatic write scope could therefore make
  product changes vanish with no error. The relationship between a declared prefix and the write
  scope must be decided and enforced, not left implicit. D3 and D4 settle it.
- Both current configuration shapes must keep parsing unchanged. A repository that declares the new
  key against a runtime without support must fail closed and loudly, as it does today. E-7 records
  both shapes parsing and both new shapes refused before the change.
- The fix is only complete if the resolved value reaches all three use sites. Changing the two
  snapshots alone stops the cap failure and leaves the merge classifier refusing the same paths, so
  the round still dies — with a different reason code. D5 settles how.
- The fix must not require the operator to prepare the worktree before a round. The output does not
  exist before the round; the producer creates it.
- **This repository cannot reproduce the defect, and a criterion that assumes it can is
  unsatisfiable.** Its build writes to a default prefix. Criteria must be written so the local suite
  proves the mechanism — what a declared prefix does to each of the three sites, what the parser
  accepts and rejects, what the merge does with an overlapping declaration — while the end-to-end
  proof is a recorded observation from a repository whose build writes elsewhere, carried back
  sanitized: counts, reason codes, state names and event types, never a path, an alias, a product,
  an organisation, or an account detail.

## Decisions

**D1 — The declaration lives in `spartan-bridge/config.yaml`, as `producer.scratch_prefixes`.**
A scratch prefix is not an authority grant. It cannot widen what a producer may merge back; its only
effect is that a path is discarded. Authority — who may write which paths — is what `AGENTS.md`
carries and what `parseAgentsPolicy` fails closed on, while operational facts about the toolchain
already live under `producer:` in `config.yaml` (`model_binding`, and `implementer_timeout_ms`
beside it), and a build directory is such a fact. The second reason is mechanical: `AGENTS.md`'s
`###` scope sections are read by `parseScopeHeading`, which returns `null` — invalidating the entire
policy — when any list item in the section fails `decodeScopeEntry`. Adding a third strictly parsed
list to the file every managed repository must satisfy, to hold a value that grants nothing, buys
risk for no authority.

**D2 — The effective set is one always-applied support prefix plus a declarable build-output list.**
`node_modules/.cache/` is not a build-output declaration; it is a consequence of the support scope.
`snapshotTree` collapses each support root to one metadata-digest entry, and `metadataTreeDigest`
subtracts `omitPrefixes` from that digest (`src/core/snapshot.ts:213` and `:289`, E-9). A build that
writes the npm cache therefore changes the collapsed `node_modules` entry unless that prefix is
omitted, and a changed support entry refuses the whole round. If a declaration replaced the whole
list, a repository declaring `.next/` would silently lose that protection and fail in a way it could
not connect to what it wrote. So the constant splits: `PRODUCER_SUPPORT_SCRATCH_PREFIXES` holding
`node_modules/.cache/` is always in the effective set and is not declarable, and
`PRODUCER_DEFAULT_BUILD_SCRATCH_PREFIXES` holding `dist/` applies only when the repository declares
nothing. A declaration replaces the default build list and never the support prefix.

**D3 — A declared prefix conflicting with product or required copy input refuses; an inherited
default overlapping product is dropped.** A declared prefix is an assertion by the repository:
when it overlaps the automatic write scope, covers the copied `AGENTS.md`, or covers a
`PRODUCER_SUPPORT_SCOPE` root, it would hide a product or required-input change from both snapshots
and merge classification. Resolution therefore fails closed rather than picking a winner. An
inherited default asserts nothing, so the write scope wins and the default simply does not apply to
that repository — the path stays product and behaves exactly as it would with no scratch machinery
at all. This split is what makes the change non-breaking in the one direction that matters: a
repository that commits its `dist/` and admits it in the write scope stops silently discarding those
edits without editing its configuration. Write-scope overlap is symmetric containment: a declared
prefix `P` overlaps a directory entry `E` when either contains the other, and overlaps an exact-file
entry `E` when `E` lies under `P`. `isPathAdmittedByScope` decides the file case;
`isPrefixMember` applied in both directions decides the directory case and checks whether `P`
covers the authority file or a support root. A clean declaration strictly below a support root
remains valid — for example `node_modules/.vite/` — because it does not hide the root itself. The
parser therefore admits the otherwise skipped support-root segment only when it is the exact leading
root and a non-empty descendant follows; an equal root, an unrelated skipped root, or another
skipped segment in the descendant remains invalid. `producerPathDenied` itself is unchanged, so
product-file and merge-back denial do not gain this configuration-only exception.

**D4 — Shape and semantic refusals report `config_invalid`, before any producer run.**
No new reason code. `config_invalid` already means `spartan-bridge/config.yaml` is not acceptable,
and that file is exactly where a contradictory declaration is — the operator is sent to the right
place, only without the specific rule. Shape validation stays in `parseBridgeConfigYaml` and returns
`config_invalid`; semantic checks run in `continueAfterPlanReview` immediately after
`automaticImplementationAdmission` succeeds — the first point where the parsed config and resolved
write scope are both available — and before `loadRegistry`, so no registry, launcher, adapter, or
producer round is spent. A repository then sees one reason code for one file whichever rule it
broke.

**D5 — One resolution, carried by `PreparedProducerWorkspace`, reaches every scratch use site.**
This is D-074's rule applied to the list that stayed fixed. `continueAfterPlanReview` resolves the
effective set once and passes it on the single `producerInput` literal (`src/core/transition.ts:498`,
the only construction, E-10); `prepareProducerWorkspace` uses it to preserve or create writable
scratch below a read-only support root, supplies it to the baseline's `omitPrefixes`, and returns it
in `PreparedProducerWorkspace` beside `supportScope`; the post-run snapshot
(`src/core/transition.ts:762`) and `captureProducerMerge` (`src/core/transition.ts:834`) read
`prepared.scratchPrefixes` rather than the input or a module constant, and
`classifyProducerWorkspacePath` takes it as a fourth parameter defaulting to the built-in set. The
producer's writable scratch, baseline, post-run snapshot, collapsed support digest, and classifier
then cannot disagree, because after preparation there is no second place a value can come from.
Symmetry also matters for correctness, not only tidiness: a prefix omitted from one snapshot and
present in the other diffs as `vanished` or `created`. A copied support-scratch descendant that is
already a contained support symlink or another non-directory stays unchanged and read-only rather
than being replaced or aborting preparation. This is the pre-D-076 behavior for an inherited
`node_modules/.cache/`; it keeps scratch disposal from becoming authority to replace support input.

**D6 — The per-file hashing rule does not change.** `src/core/snapshot.ts:154` keeps
`state.policy === "workspace" ||`. The `workspace` snapshots are what the merge decides from, so a
change their diff does not see is a producer edit that is never copied back. Applying the 1 MiB
size-and-`mtimeNs` fallback there would convert a loud `hash_bytes` stop into a silent loss of the
producer's work — the same failure class D3's guard exists to prevent, reached from the other side of
the same round. It is also not needed: after D2 the copy holds the write scope, one collapsed support
root, `AGENTS.md`, and whatever the producer creates outside scratch; E-3 measured the observed write
scope at roughly four percent of the byte budget, and the declaration removes the term that was
thirty-six times it. What this refuses to buy is the case of a repository whose admitted write scope
alone exceeds 256 MiB, and there a loud stop is the correct answer rather than a weaker snapshot.

**D7 — A producer-transition snapshot-cap stop reports `producer_snapshot_cap_exceeded`.**
`reviewer_isolation_unavailable` keeps its meaning on the reviewer-isolation path, where
`ReviewerIsolationUnavailableError` is raised and a reviewer actually participates. The inline
`workspace_baseline` mapping in `runGuardedRound` and `mapProducerCaptureError` cover all six
producer-transition sites: live-tree `repo_before` and `repo_after`, runtime-ownership
`runtime_before` and `runtime_after`, and isolated-copy `workspace_baseline` and `workspace_after`.
This is the plan's one vocabulary
addition, and unlike D4's case the present code does not merely under-describe the failure — it names
a subsystem that did not participate, and E-1 is the record of an operator following it to adapters
and sandboxes for an exhausted cap. `producer_diagnostic` already carries `stage`, `snapshot_site`
and `snapshot_cap`, so the new code supplies the missing top-level signal and nothing more.

**D8 — The ninth artifact-authoring rule was evaluated and does not fire.** No decision or scope item
here edits `AGENTS.md` or `spartan-bridge/config.yaml`. D1 defines an optional key *for* that file;
the change is in `src/policy/bridge-config.ts` and in tests that parse configurations under temporary
roots. D3's guard is documented in `docs/AUTHENTICATION-AND-SECURITY.md` rather than `AGENTS.md`, for
the reason D1 gives. This repository keeps relying on the `dist/` default, and declaring that
dependence explicitly is deferred in Out of Scope rather than absorbed. The implementer is therefore
the mapped one and the ordinary plan-pass chain applies; E-8 confirms both paths are outside the
write scope, so this evaluation is checkable rather than asserted.

## Acceptance Criteria

Derived from D1-D8 after the decisions were settled, not before. Each row names the decisions it is
a consequence of; rows 15 and 16 record repository checks and the verification dependency.

1. A `spartan-bridge/config.yaml` carrying `producer.scratch_prefixes` as a non-empty sequence of
   relative, trailing-slash prefixes parses `valid` and returns those prefixes, both alone and beside
   `model_binding`. The test quotes both documents' exact bytes. *(D1)*
2. Both documents recorded in E-7 as `valid` today still parse `valid`, unchanged, and a repository
   declaring the new key against a runtime without it still returns
   `{ kind: "invalid", reason: "config_invalid" }`. *(D1, D4)*
3. Each shape failure returns `config_invalid`, one case per rule, each naming the document bytes it
   tests: an empty sequence, a non-sequence value, a non-string element, a prefix without a trailing
   `/`, a prefix that is absolute or begins `~` or `!`, a prefix carrying a `.` or `..` segment or a
   glob character, an equal support root, an unrelated `SKIPPED_DIR_NAMES` root, or a skipped segment
   below or outside the support root. *(D1, D3, D4)*
4. The prefix grammar has one definition: `isValidScopePath` is exported from
   `src/policy/agents-policy.ts` and is what `src/policy/bridge-config.ts` calls. A second copy of the
   grammar in either file fails this criterion. *(D1)*
5. `AGENTS.md` gains no parsed section: `parseAgentsPolicy` on this repository's unchanged
   `AGENTS.md` returns the `automatic_implementation_write_scope` quoted in E-8, byte for byte. *(D1)*
6. `node_modules/.cache/` is in the effective set of every producer round, declared or not. With
   `["build/"]` declared, that prefix is still absent from both `workspace` snapshots and still
   subtracted from the collapsed support digest, and a producer that writes only into the npm cache
   has its round merged rather than refused. *(D2)*
7. A declaration replaces the default build list and not the support prefix. In a fixture whose write
   scope does not admit `dist/` and whose config declares `["build/"]`, a producer write under
   `build/` is discarded and a producer write under `dist/` refuses the round with
   `write_scope_violation`. *(D2)*
8. A declared prefix conflicting with product or required copy input stops the chain with
   `config_invalid`: declared `src/` against write-scope `src/`; declared `src/generated/` against
   write-scope `src/`; declared `s/` against write-scope `s/deep/`; declared `cfg/` against exact-file
   entry `cfg/app.json`; declared `AGENTS.md/` covering the authority file; and declared
   `node_modules/` covering the support root. `node_modules/.vite/` parses successfully because it is
   strictly below that root, while `node_modules/.git/out/`, `other/node_modules/out/`, and
   `.venv/cache/` remain parser refusals. *(D3, D4)*
9. An inherited default that overlaps is dropped rather than refused. A fixture that declares nothing
   and whose write scope admits `dist/` runs the chain without `config_invalid`, and a producer edit
   under `dist/` is merged back as product rather than discarded. *(D3)*
10. Every D3 declaration refusal is raised before any adapter work: the stopped transition carries
    `config_invalid`, and the test asserts no registry load, no launcher resolution, and no producer
    spawn occurred. *(D4)*
11. One resolution reaches the complete mechanism with no second edit. With
    `node_modules/.vite/` declared, `prepareProducerWorkspace` returns the resolved prefixes in
    `PreparedProducerWorkspace`, makes that descendant writable below the read-only support root,
    omits its existing and generated contents from both copy snapshots and the collapsed support
    digest, classifies it as scratch, and discards it from capture. A complete fake-adapter chain
    reaches implementation-review pass and merges none of that output. A test that sets the list at
    each site separately does not satisfy this criterion; this is the executable form of the
    no-drift constraint, matching D-074's for the support scope. *(D5)*
12. Every existing caller that supplies no scratch list behaves exactly as before:
    `classifyProducerWorkspacePath("dist/x", ["src/"])` is still `scratch`,
    `classifyProducerWorkspacePath("node_modules/.cache/x", ["src/"])` is still `scratch`, and the
    35 tests recorded in E-11 pass unchanged. A contained `node_modules/.cache` support symlink is
    reconstructed, left read-only, omitted from the baseline, and does not abort producer
    preparation. *(D5)*
13. `src/core/snapshot.ts:154` is unchanged, shown positively rather than by its absence from the
    diff: a test asserts that a file larger than `SNAPSHOT_HASH_FILE_CAP` inside the producer copy
    carries a `hash` and no `mtimeNs` in a `workspace`-policy snapshot. *(D6)*
14. All six producer-transition snapshot-cap sites report `producer_snapshot_cap_exceeded`:
    `repo_before`, `repo_after`, `runtime_before`, `runtime_after`, `workspace_baseline`, and
    `workspace_after` each stop with that code and carry the matching `snapshot_site` and
    `snapshot_cap`. No producer path returns `reviewer_isolation_unavailable`, while the
    reviewer-isolation path still does, shown by the existing reviewer tests passing unchanged. *(D7)*
15. `npm run build` and `npm test` pass with no new failure; `git status` shows no modification to
    `AGENTS.md` or `spartan-bridge/config.yaml`; `docs/DECISIONS.md` carries one dated entry stating
    its relationship to D-074 plus a dated D-068 amendment naming the widened producer section;
    `README.md` includes `producer.scratch_prefixes` in its closed parsed-key summary and links to
    the grammar; and `docs/AUTHENTICATION-AND-SECURITY.md`,
    `docs/ROUTING-AND-WORKFLOWS.md`, and `docs/ARCHITECTURE.md` name the declaration grammar,
    resolved defaults, every D3 outcome, and all six producer-transition snapshot-cap sites at their
    respective levels of detail. *(D1, D7, D8, and the repository checks this round must run)*
16. The end-to-end proof is not claimed by this repository. The implementation round records that the
    local suite proves the mechanism, and that a chain completing on a repository whose build writes
    outside the defaults is a separate observation carried back sanitized — counts, reason codes,
    state names and event types only, never a path, an alias, a product, an organisation, or an
    account detail. A criterion asserting a locally reproduced end-to-end pass is unsatisfiable here.
    *(Constraints)*

## Work Completed

Implementation round, 2026-09-11, Codex, effort high, entered through `$spbridge`; the policy bound
`gpt-5.6-sol`, but this session exposed no exact model identifier, so the skill recorded the model
as unconfirmed and continued under its strict-to-warn rule. The pasted prompt carried no handoff id
and the artifact had no outstanding proposal.

Implemented D1-D8. The configuration parser now admits and validates
`producer.scratch_prefixes` through the exported automatic-scope grammar. The runtime resolves one
effective list after automatic admission, refuses declared overlap before registry or adapter work,
drops overlapping inherited defaults, and carries the prepared list through both producer-copy
snapshots and merge classification. Producer snapshot caps now have their own reason code; the
workspace full-hash rule is unchanged. Updated the security guide and added D-076 as the D-074
extension. Added parser, workspace, and full-chain regressions for criteria 1-14. No dependency or
external source material was added.

Implementation correction, 2026-09-12, Codex, effort high, entered through `$spbridge`; the pasted
prompt carried no handoff id and the artifact had no outstanding proposal. Adopted both recorded
implementation findings. Scratch resolution now refuses a declaration that covers the copied
authority file or a support root, with unit and pre-adapter transition coverage. Updated the routing
reference and architecture summary as well as the existing security and decision text so parser,
runtime, and operator documentation agree. Re-derived D3 and criteria 8, 10, and 15 from the wider
required-input guard. No dependency or external source material was added.

Second implementation correction, 2026-09-12, Codex, `gpt-5.6-sol`, effort high, entered through
`$spbridge`; the pasted prompt carried no handoff id and the artifact had no outstanding proposal.
Resolved both findings from `run-87ea8190-5ce9-43a3-be88-e5c7010de963`. The configuration-only
grammar exception now admits a clean scratch prefix strictly below the producer support root while
keeping the equal root, unrelated skipped roots, nested skipped segments, product paths, and
merge-back denied. Producer preparation makes each resolved support-root scratch descendant
writable, and the same prepared list drives both copy snapshots, the collapsed support digest, and
merge classification. Documentation now assigns `producer_snapshot_cap_exceeded` to all six
producer-transition snapshot sites. Re-derived D3, D5, D7 and criteria 3, 8, 11, 14, and 15 from
those corrections. No dependency or external source material was added.

Third implementation correction, 2026-09-12, Codex, effort high, entered through `$spbridge`; the
policy bound `gpt-5.6-sol`, but this session exposed no exact model identifier, so the skill recorded
the model as unconfirmed and continued under its strict-to-warn rule. The pasted prompt carried no
handoff id and the artifact had no outstanding proposal. Resolved all three findings from
`run-0409d41c-e3a1-40a6-8783-be2fa16728fa`: the README's closed parser summary now includes
`producer.scratch_prefixes` and links to its grammar; D-068 carries a dated amendment pointing to
D-076; and producer preparation preserves a contained support-scratch symlink or other
non-directory as unchanged read-only support instead of aborting. Added a regression for an
inherited contained `node_modules/.cache` symlink, documented the compatibility behavior, and
re-derived D5 plus criteria 12 and 15. No dependency or external source material was added.

Terminal close-out, 2026-09-12, human-operator. The completed implementation adds optional
`producer.scratch_prefixes` parsing and one resolved producer-scratch list, keeps
`node_modules/.cache/` as support scratch, lets declarations replace the `dist/` build default,
refuses declared conflicts before adapter work, drops conflicting inherited defaults, carries the
resolved list through producer preparation, both copy snapshots, the support digest, and merge
classification, and reports `producer_snapshot_cap_exceeded` at all six producer-transition
snapshot sites. Findings from `run-87ea8190-5ce9-43a3-be88-e5c7010de963` were resolved by admitting
a clean scratch descendant below the support root without weakening skipped-root or merge-back
denials, making that descendant writable throughout preparation, and documenting all six cap sites.
Findings from `run-0409d41c-e3a1-40a6-8783-be2fa16728fa` were resolved by adding
`producer.scratch_prefixes` and its grammar link to the README parser summary, adding the dated
D-068 amendment that points to D-076, and preserving a contained support-scratch symlink or other
non-directory as unchanged read-only support instead of aborting preparation.

Implementation files changed: `src/core/contracts.ts`, `src/core/transition.ts`,
`src/core/workspace.ts`, `src/policy/agents-policy.ts`, and `src/policy/bridge-config.ts`. Regression
coverage changed in `tests/bridge-config.test.ts`, `tests/producer-write-scope.test.ts`, and
`tests/transition.test.ts`. Operator and design documentation changed in `README.md`,
`docs/ARCHITECTURE.md`, `docs/AUTHENTICATION-AND-SECURITY.md`, `docs/DECISIONS.md`, and
`docs/ROUTING-AND-WORKFLOWS.md`; this close-out changed only
`spartan/tasks/0080-the-producer-copy-discards-only-this-repositorys-build-output.md`.

## Evidence

- **E-1 — the observed stop.** Auto-chain successor transition: `state: stopped`,
  `reason_code: reviewer_isolation_unavailable`, `producer_diagnostic` of `stage: capture`,
  `snapshot_site: workspace_after`, `snapshot_cap: hash_bytes`, `timed_out: false`, 9 minutes
  41 seconds between the transition's `created_at` and `updated_at`. Three plan-review runs preceded
  it on the same artifact: `review_human_required`, then `review_changes_requested`, then
  `review_passed` at cycle 2 of 3.
- **E-2 — the producer ran to completion.** The post-run snapshot is taken after `waitProducer()`
  returns, and `producer_finished` is emitted only after the capture, the merge and the declaration
  check all succeed (`src/core/transition.ts:650-651`). A stop at that site therefore means the
  producer round was spent and its work discarded. The worktree showed no implementer edits, which
  is the consequence of the missing merge and not evidence that the producer never ran.
- **E-3 — the sizes.** In the observed repository, the tree excluding every skipped directory held
  732 files and 360.5 MiB, of which a single file was 105.5 MiB and almost all of the total sat
  under the framework build directory. Its declared write scope was on the order of 10 MiB, so the
  baseline copy used roughly 4 percent of the 256 MiB budget and the producer's own build then
  created about thirty-six times the entire budget inside the copy. The file-count profile is why
  the entry cap never fired: that build cache is a few very large files, not many small ones.
- **E-4 — the pre-change reason code was a mapping, not a diagnosis.**
  `return error instanceof SnapshotCapError ? "reviewer_isolation_unavailable" : "adapter_error";`
  (`src/core/transition.ts:892`). The pair `stage: capture` with that reason code can mean nothing
  but an exhausted cap.
- **E-5 — configuration could not express the fix before D1.** Adding any key beside `model_binding` under
  the producer section, or any fourth top-level key, returns `{ kind: "invalid", reason: "config_invalid" }`
  (`src/policy/bridge-config.ts:140` and the top-level count check above it). `dispatch` accepts
  `"automatic"` and `"manual"`, so a repository can stop the plan-pass successor from starting, but
  that suppresses the chain rather than fixing it and does not affect an implementation-correction
  execution.
- **E-6 — the second wall.** With the cap satisfied, `classifyProducerWorkspacePath` returns
  `refused` for a path that is neither scratch, support, nor admitted, and `captureProducerMerge`
  throws `ProducerMergeError` with `write_scope_violation`. Build output that is not declared
  scratch fails the round either way.
- **E-7 — the four shapes, run against the current parser.** A script outside the repository called
  `parseBridgeConfigYaml` on four documents, each sharing the header
  `schema_version: 1` / `transitions:` / `  review_plan_pass:` / `    successor: implementer` /
  `    dispatch: automatic` and differing only in its producer section: **A** no `producer:` section;
  **B** `producer:` / `  model_binding: strict`; **C** `producer:` / `  scratch_prefixes:` /
  `    - .next/`; **D** `producer:` / `  model_binding: strict` / `  scratch_prefixes:` /
  `    - .next/`. Outcomes: A `{"kind":"valid","schema_version":1,"dispatch":"automatic","successor":"implementer"}`,
  B the same plus `"model_binding":"strict"`, C and D both
  `{"kind":"invalid","reason":"config_invalid"}`. A and B are the two current shapes the Constraints
  require to keep parsing; C and D are the shapes D1 admits.
- **E-8 — this repository's automatic write scope.** `parseAgentsPolicy` on the repository-root
  `AGENTS.md` returns `automatic_implementation_write_scope` of `["src/","tests/","docs/","skills/",`
  `"agent-skill/skills/spbridge/SKILL.md","spartan/","README.md","package.json","package-lock.json",`
  `"tsconfig.json"]`. `isPathAdmittedByScope` returns `false` for each of `dist`,
  `dist/cli/main.js`, `node_modules/.cache/x`, `.next/build`, `spartan-bridge/config.yaml`, and
  `AGENTS.md`. This is why the defaults are admissible under D3 here, why D8's evaluation holds, and
  why this repository cannot reproduce the defect.
- **E-9 — the support digest subtracts the omit list.** A collapsed support root's entry is
  `hash: await metadataTreeDigest(abs, rel, state.omitPrefixes)` (`src/core/snapshot.ts:213`), and
  `collectMetadataRecords` skips any descendant matching one of those prefixes
  (`src/core/snapshot.ts:289`). `node_modules/.cache/` is therefore load-bearing for every repository
  with a `node_modules/` support scope, which is what D2 turns on.
- **E-10 — one producer input, one prepared scratch value.** `producerInput` is constructed exactly
  once (`src/core/transition.ts:503`) with `writeScope` and `scratchPrefixes`. Producer preparation
  uses that list for support-scratch copy modes, missing-directory creation, and the baseline; returns
  it in `PreparedProducerWorkspace`; and the post-run snapshot (`src/core/transition.ts:766`) and
  merge capture (`src/core/transition.ts:838`) consume only that prepared value. This is the single
  path D5 requires.
- **E-11 — the pre-change baseline.** `node --import tsx --test tests/bridge-config.test.ts`
  `tests/producer-write-scope.test.ts`: 35 tests, 35 pass, 0 fail, 3.4 s. Criterion 12 measures
  against this number.
- **E-12 — focused mechanism checks.** `node --import tsx --test tests/bridge-config.test.ts`
  `tests/producer-write-scope.test.ts` `tests/transition.test.ts` passed after the implementation.
  The cases quote both admitted configuration documents and every rejected shape; assert the one
  exported grammar; exercise all four write-scope overlap relations and both protected-copy inputs
  before registry, launcher, or producer work; prove configured build output is discarded while `dist/` refuses; prove an inherited
  overlapping `dist/` is merged; carry one custom list through preparation, both snapshots, support
  digest, and capture; and pin full hashing plus both producer snapshot-cap sites.
- **E-13 — repository checks.** `npm run build` passed. `npm test` passed: 579 tests, 579 pass,
  0 fail. `npm run typecheck` passed, and `git diff --check` reported no error.
- **E-14 — authority paths untouched.** `git status --short -- AGENTS.md`
  `spartan-bridge/config.yaml` produced no output. The test configuration documents are written only
  under temporary fixture roots. Parsing this repository's unchanged `AGENTS.md` still returns the
  exact ten-entry automatic implementation write scope recorded in E-8.
- **E-15 — verification boundary.** The local suite proves the parser, resolution, snapshots,
  support digest, merge classifier, reason codes, and complete fake-adapter chains. It does not
  claim the external end-to-end observation in criterion 16; a chain in a repository whose build
  writes outside the defaults remains separate evidence and must be carried back only as sanitized
  counts, reason codes, state names, and event types.
- **E-16 — implementation-correction checks.** The focused parser, producer-workspace, and
  transition command passed: 98 tests, 97 pass, 0 fail, 1 expected sandbox skip. `npm run build`,
  the full `npm test` suite, and `npm run typecheck` passed; `git diff --check` reported no error;
  and `git status --short -- AGENTS.md spartan-bridge/config.yaml` produced no output.
- **E-17 — support-root scratch regression.** `node --import tsx --test`
  `tests/bridge-config.test.ts tests/producer-write-scope.test.ts tests/transition.test.ts` passed:
  101 tests, 100 pass, 0 fail, 1 expected sandbox skip. The parser admits
  `node_modules/.vite/` and refuses `node_modules/`, `node_modules/.git/out/`,
  `other/node_modules/out/`, and `.venv/cache/`; the workspace case changes existing and generated
  `.vite` files without changing either collapsed support digest and captures nothing; the complete
  fake-adapter chain reaches implementation-review pass without merging the scratch file.
- **E-18 — final repository checks.** `npm run build` passed; `npm test` passed with 582 tests,
  582 pass, and 0 failures; `npm run typecheck` passed; and `git diff --check` reported no error.
  `git status --short -- AGENTS.md spartan-bridge/config.yaml` produced no output.
- **E-19 — third-correction checks.** `node --import tsx --test`
  `tests/bridge-config.test.ts tests/producer-write-scope.test.ts tests/transition.test.ts` passed:
  102 tests, 101 pass, 0 fail, 1 expected sandbox skip. `npm run build` passed; `npm test` passed
  with 583 tests, 583 pass, and 0 failures; `npm run typecheck` passed; `git diff --check` reported no
  error; and `git status --short -- AGENTS.md spartan-bridge/config.yaml` produced no output.
- **E-20 — terminal verification on this checkout, 2026-09-12.** `npm run typecheck`: clean, no
  output. `npm run build`: clean. `npm test`: 583 tests, 583 pass, 0 fail.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-e0b71521-c2c4-4062-a354-a616b694a5cc execution_id=exec-0bf578f1-3b27-4fdb-9b3c-4fd95f3dd1ee review_kind=plan verdict=pass reason_code=review_passed host=codex launcher=codex-plan-reviewer-v1 model=gpt-5.6-sol effort=high model_observed=declared_unobserved policy_digest=sha256:c032b4cea31dd45976e0e4d6a6b689590f1f0a1a368378fd8a82e546eb9525a3 task_hash=sha256:5114e5a2346459e7d389c9a4b9c0a1bd6a97a1b1ffbbbfafb3b5fc38afeef94d agents_hash=sha256:6bd68578db8fd268d33c5847ff43bbf478ca1ed9c7a17c1a34df7ed723f5b8da timestamp=2026-09-12T01:49:58.829Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-c1a32b8c-9ec3-4824-a80b-71b262c04f02 execution_id=exec-4052fffa-8f6f-4527-9c4b-124930e56dd4 review_kind=implementation verdict=pass reason_code=review_passed host=claude launcher=claude-plan-reviewer-v1 model=claude-opus-5 effort=high model_observed=declared_unobserved policy_digest=sha256:e363264f72a848d870898b8d1d1abe453a4f1e519f622f4415d9531d867023f6 task_hash=sha256:8703097f2025d080966e39de7bff1a03b5009922d804497f2f498e4083027049 agents_hash=sha256:6bd68578db8fd268d33c5847ff43bbf478ca1ed9c7a17c1a34df7ed723f5b8da timestamp=2026-09-12T11:43:45.378Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

No implementation blocker. Criterion 16 deliberately leaves the separate consumer-repository
end-to-end observation unclaimed; it is not a condition this local implementation can reproduce.

Task `0079` is blocked behind this one. Its remaining criterion needs an auto-chain that reaches
`producer_finished`, then `reviewing`, with an `implementation_review_result` event recorded, in a
repository whose client context differs from the machine default. The one repository that satisfies
the client-context condition is the repository that meets this defect, so `0079` cannot close until
this ships and a chain completes there.

## Next Action

Auto-chain complete: implementation review passed (Bridge run run_id=run-c1a32b8c-9ec3-4824-a80b-71b262c04f02).
Review the worktree diff in the authorized implementation write scope, commit
when satisfied, then set this task to status: completed.

## Next Handoff

No outstanding handoff. The proposed review was consumed.
