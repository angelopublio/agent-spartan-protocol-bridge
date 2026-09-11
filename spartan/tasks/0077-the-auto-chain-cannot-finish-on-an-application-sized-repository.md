---
protocol: "1.1.0" # x-release-please-version
id: the-auto-chain-cannot-finish-on-an-application-sized-repository
created_at: 2026-09-10
status: completed
phase: complete
task_type: implementation
risk: high-impact
current_role: human-operator
next_role: none
updated_at: 2026-09-11
handoff_id: HX-005
next_handoff_id: none
---

# The auto-chain cannot finish on an application-sized repository

## Objective

An approved plan reaches its implementation review in a repository whose installed dependency tree
is large. Today the chain runs the implementer to completion and then dies capturing its result,
because the capture walks a directory the Bridge itself placed in the workspace and then discards.

## Context

Observed on 2026-09-10 in a managed repository. The plan review passed with no findings. The
transition began 0.4 seconds later and stopped 3 minutes 43 seconds after that with
`reviewer_isolation_unavailable` and no producer diagnostic. The producer had already run; the
failure was in the capture that follows it.

The mechanism is four facts that only bite together:

- `src/core/workspace.ts:29` — `PRODUCER_SUPPORT_SCOPE` is `["node_modules/"]`. The Bridge copies
  the installed dependency tree into the producer workspace deliberately, so the producer can build
  and test. `copyDirectoryMembers` (`:1249-1291`) copies it byte for byte.
- `src/core/transition.ts:735` — after the producer finishes, the capture snapshots that workspace
  with `snapshotTree(workspaceRoot, { policy: "workspace" })`.
- `src/core/snapshot.ts:95` — the skip list is gated on `state.policy === "repository"`. Under the
  `workspace` policy nothing is skipped, including the dependency tree the Bridge just placed there.
  `:136` compounds it: under `workspace` every file is hashed in full regardless of size, because
  `hashFully` is `state.policy === "workspace" || stat.size <= SNAPSHOT_HASH_FILE_CAP`.
- `src/core/snapshot.ts:7` — `SNAPSHOT_ENTRY_CAP` is 20,000 entries, and that call site passes no
  override.

An installed dependency tree for an ordinary application routinely holds tens of thousands of
files, so the walk exceeds the cap. This repository's own tree holds 542 files, which is why the
defect has never appeared here.

### Two corrections this round established

The planner round checked the artifact's own premises against the source and the running code. Two
were wrong, and both change the shape of the fix.

**The capture does not discard a support-scope path. It refuses the round on one.** The previous
Context claimed `workspace.ts:1407-1411` "discards everything that is not `admitted`". Read in
full, that block has three dispositions, not two:

```
const classification = classifyProducerWorkspacePath(entry.path, input.writeScope, input.supportScope);
if (classification === "scratch") {
  continue;                                   // discarded — no merge action, no refusal
}
if (classification !== "admitted" || ...) {
  throw new ProducerMergeError();             // support lands HERE — the whole round stops
}
```

A changed `support` path throws `ProducerMergeError`, which `transition.ts:793` maps to a
`write_scope_violation` stop. So omitting support-scope paths outright would not be
outcome-neutral: it would convert a detected write-scope violation into silence. That is exactly
what the Constraint told this round to establish before omitting anything, and the answer is that
plain omission fails it. The set that genuinely changes no outcome is `scratch`, not `support`.

**Fixing only the capture moves the failure earlier rather than removing it.** The capture at
`transition.ts:735` is not the first `policy: "workspace"` walk of the producer copy.
`prepareProducerWorkspace` takes the *baseline* the same way at `workspace.ts:1141`, over the same
freshly copied support tree, before the producer starts. Measured on a 31,200-file tree it throws
`SnapshotCapError` at 1.8 seconds. Any fix confined to `:735` leaves that intact.

The observed run's `producer_diagnostic: null` does rule the baseline out — a baseline cap failure
is caught at `transition.ts:680-687` and *does* build a diagnostic, with `stage: "write_scope_lock"`.
But the artifact's Evidence claimed that null "distinguishes the capture stop at `transition.ts:739`
from the earlier write-scope-lock stop at `:682`", and that is incomplete: the pre-producer catch at
`:696` passes `diagnostic: null` too. From the persisted record alone, `:739` and `:696` are
indistinguishable. That is the concrete, already-paid cost the diagnostic decision below removes.

The walk is also pure waste for the paths that are genuinely discarded. The capture spends minutes
hashing files whose only possible outcome is to be thrown away, and then fails on their count.

## Scope

- `src/core/snapshot.ts` — `SnapshotTreeCaps` gains the two caller-supplied prefix lists (D4);
  `walk` consults them; `SnapshotCapError` carries which cap it exceeded (D6). The three existing
  `SNAPSHOT_POLICIES` and `SKIPPED_DIR_NAMES` are read but not edited.
- `src/core/workspace.ts` — the baseline snapshot at `:1141` (D5); `PreparedProducerWorkspace`
  at `:1062-1065` gains the resolved support scope (D4); `PRODUCER_SUPPORT_SCOPE` (`:29`) and
  `PRODUCER_SCRATCH_PREFIXES` (`:30`) are read as the single sources and not edited.
- `src/core/transition.ts` — the capture call at `:735` and the stop at `:739`; the pre-producer
  stop at `:696`; the write-scope-lock stop at `:680-687`; the two sites that name
  `PRODUCER_SUPPORT_SCOPE` a second and third time (`:674`, `:791`).
- `src/core/contracts.ts:288` and `:299-357` — `PRODUCER_DIAGNOSTIC_STAGES`, `ProducerDiagnostic`,
  `buildProducerDiagnostic`, and the two new closed enums (D6).
- `src/core/serialize.ts:140-157` and `:238-247` — `serializeProducerDiagnostic`'s key whitelist
  and `parseTransitionStatusJson`'s normalization (D6).
- Tests: `tests/producer-write-scope.test.ts`, `tests/workspace.test.ts`,
  `tests/transition.test.ts`, `tests/write-detect.test.ts`, `tests/serialize.test.ts`.
- `docs/DECISIONS.md` — one dated entry, D-074.

Verified as unaffected and deliberately not in scope: `src/core/review.ts:608` and
`src/core/workspace.ts:287`, the reviewer-workspace `SnapshotCapError` catches — they catch the
error and never construct it, so D6's constructor change reaches them without an edit.

## Out of Scope

- Raising `SNAPSHOT_ENTRY_CAP`. That treats the count rather than the walk, and leaves the wasted
  minutes in place. The measurement in Evidence confirms why: with the cap lifted the same walk
  still costs 2.8 seconds and produces 33,643 entries that the merge cannot use.
- The reviewer workspace prepared for an implementation review. It copies only the declared
  implementation review scope, which does not admit a dependency tree, and is not affected.
- The plan-target scan's sixteen advisory tokens observed in the same run. That is task `0074`.
- `snapshotRuntimeOwnership` (`transition.ts:886-894`) snapshots `.spartan-bridge/` under the
  `workspace` policy and grows with run history, so it can reach the cap independently. D6 makes
  that case nameable; capping or pruning run history is not this task.

## Constraints

- The capture must still detect a producer that wrote into a support-scope path when that would
  change the merge outcome. Establish whether it can, before omitting anything.
- Omission must be derived from the same support-scope value the workspace was built from, never a
  second hardcoded list that can drift from it.
- A stop on this path currently carries `diagnostic: null`, so it names neither which of the three
  snapshots in that block failed nor which of the two caps was exceeded. Diagnosing the observed
  failure required reading the source and reasoning from elapsed time; the next operator must not
  have to. Whatever the fix, the stop records the failing snapshot and the exceeded cap, in closed
  values, and this is part of the change rather than a follow-up: the fix already edits that exact
  stop site, and leaving it mute there while three queued tasks ask for the same thing elsewhere
  would be a deliberate inconsistency.

## Decisions

- **D1 — `scratch` is omitted outright; `support` is collapsed, never omitted.**

  The merge has three dispositions and they are not interchangeable. `scratch`
  (`PRODUCER_SCRATCH_PREFIXES` = `dist/`, `node_modules/.cache/`) hits `continue` at
  `workspace.ts:1408`: no scratch entry can ever produce a merge action or a refusal, in any
  repository, for any producer. Omitting it from the walk is therefore provably outcome-neutral —
  the evidence is the `continue` itself, not a measurement. `support` (`node_modules/`) reaches
  `throw new ProducerMergeError()` at `:1410`, so omitting it would delete a live refusal.

  This is the round's answer to the Constraint's "establish whether it can, before omitting
  anything": for `support`, it cannot, so the plan does not omit it.

- **D2 — a collapsed support prefix is recorded as one metadata-digest entry that includes
  `ctime`, and that preserves detection of every write while giving up per-file granularity.**

  *Revised in cycle 1 against finding `SUPPORT_DIGEST_CONTENT`, which was correct.* The first draft
  of this decision reused `metadataTreeDigest` unchanged and claimed it "preserves the refusal
  exactly". It does not. That digest covers `(kind, rel, mode, size, mtime, linkTarget)` and reads no
  content, so a producer that rewrites a file to the same byte length and then restores its `mtime`
  leaves the digest unchanged, while today's full-content walk hashes the bytes and refuses the
  round. The claim was wrong and the criterion that was supposed to prove it tested an ordinary
  write, which changes size or mtime and so never probed the gap.

  The shape still collapses, but the digest record gains one field: `ctimeNs`, alongside the existing
  `mtimeNs`. This closes the finding's scenario at zero additional I/O, because `lstat` already
  returns it and no file is opened.

  `ctime` is the right field because it is the one timestamp with no setter. POSIX updates an
  inode's `ctime` on every write and every metadata change, and no syscall — `utimes`, `utimensat`,
  `futimes` — can set it; only changing the system clock moves it, which a sandboxed producer cannot
  do. `mtime` is restorable by design, so a digest resting on `mtime` alone rests on nothing.

  Measured, running the finding's exact attack — write 4,096 bytes of `0x61`, overwrite with 4,096
  bytes of `0x62`, restore `atime`/`mtime` with `utimesSync` — against the record shape shipped at
  `snapshot.ts:239-247`: `size` and `mode` are unchanged, and the content replacement is invisible to
  both. `ctime` moves by 175 µs and detects it. The probe's `mtime` also moved, by 400 ns, but only
  because Node's `fs.utimes` takes a double-precision seconds value and cannot express the
  nanosecond the walk recorded. That residue is an accident of one API, not a defense: a producer
  calling `utimensat(2)` through a native module restores `mtime` exactly. The plan does not rely on
  it, and no criterion asserts it.

  **The invariant, stated precisely.** After this change the capture detects *that* a support-scope
  path was written, for every write, and refuses the round exactly as it does today. It no longer
  verifies *what* the bytes are, and it names the support root rather than the individual file. The
  reason code is `write_scope_violation` either way. This is a real reduction in granularity and the
  plan states it rather than arguing it away; what it is not is a reduction in whether a write is
  caught.

  Cost, measured on a 31,200-file / 122 MB tree: 435 ms and 43 entries, against 2,756 ms and 33,643
  entries for the present full-hash walk — and against the 1,826 ms at which that walk throws today.
  The collapse costs roughly 0.9 s per round across the two snapshots of D5 and removes the cap
  failure by three orders of magnitude. Adding `ctimeNs` reads a field `lstat` already returned, so
  it does not move this number.

  Rejected: keeping full content hashing and raising only the cap. It preserves byte-level
  verification and leaves the 2,756 ms walk — the defect becomes slow instead of fatal, which is the
  outcome Out of Scope already refuses.

  Rejected: recording only the support root's own `lstat` with no descendant digest. A write deep
  inside changes neither the root's `mtime` nor its `ctime`, so the refusal would stop working while
  still appearing to be enforced. A detection that silently reports nothing is worse than one
  honestly removed — which is the same test this decision failed in cycle 1 and now passes.

- **D3 — the collapse digest excludes the scratch prefixes, including those nested inside a support
  prefix.**

  `node_modules/.cache/` is a scratch prefix nested inside the `node_modules/` support prefix, and
  `ensureWritableSupportScratch` (`workspace.ts:1156-1170`) deliberately chmods it to `0o700` so the
  producer can write build output there. If the D2 digest covered it, every producer that builds
  would change the digest, classify as `support`, and have its round refused — turning the expected
  case into a failure.

  So D1's omission rule applies inside the digest as well as at the top of the walk: the walk emits
  no entry for a scratch prefix and `metadataTreeDigest` contributes no record for one.

- **D4 — the walk is told by two caller-supplied prefix lists, carried from the single value the
  workspace was built from.**

  `snapshotTree`'s `policy` is the existing mechanism, and both non-`workspace` policies key off
  `SKIPPED_DIR_NAMES` (`snapshot.ts:95`, `:100`) — a module constant with no relation to the scope
  the workspace was built from. Selecting `policy: "producer"` for these call sites would fix the
  symptom and violate the Constraint, because `SKIPPED_DIR_NAMES` and `PRODUCER_SUPPORT_SCOPE`
  overlap on `node_modules` today by coincidence, not by construction.

  `SnapshotTreeCaps` therefore gains `collapsePrefixes` and `omitPrefixes`, both defaulting to
  empty. Every existing call site keeps its behaviour unchanged and the three policies are not
  edited.

  Drift is prevented by construction rather than by convention. `prepareProducerWorkspace` already
  resolves `input.supportScope ?? PRODUCER_SUPPORT_SCOPE` once, at `workspace.ts:1118`. It passes
  that resolved value to its own baseline snapshot and returns it on `PreparedProducerWorkspace`.
  `runGuardedRound` then reads the support scope off the prepared workspace for both the `copyAfter`
  snapshot and `captureProducerMerge`, instead of naming `PRODUCER_SUPPORT_SCOPE` independently at
  `transition.ts:674` and `:791`. One resolved value reaches the copy, both snapshots, and the
  merge. `PRODUCER_SCRATCH_PREFIXES` is already the single source `classifyProducerWorkspacePath`
  reads; the snapshot call sites take that same constant rather than restating its members.

- **D5 — the rules apply to both `workspace`-policy snapshots of the producer copy, and must be
  identical at each.**

  The baseline at `workspace.ts:1141` and the capture at `transition.ts:735` walk the same tree
  under the same policy and the same cap. Fixing only the capture relocates the failure into
  `prepareProducerWorkspace`, where it surfaces as `stage: "write_scope_lock"` instead.

  Symmetry is not a tidiness preference but a correctness requirement: `workspaceDiff` compares the
  two snapshots entry by entry, so a collapsed entry on one side and an expanded subtree on the
  other would report every dependency file as `appeared` or `vanished` and refuse every round.

- **D6 — the stop names the failing snapshot and the exceeded cap, as two closed fields on the
  existing `ProducerDiagnostic`.**

  Three facts are unavailable today. `SnapshotCapError` (`snapshot.ts:54-59`) takes no argument, so
  the entry cap (`:104`, `:160`) and the hash-byte cap (`:138`) are indistinguishable. Both capture
  catches pass `diagnostic: null` (`transition.ts:696`, `:739`), so neither the block nor the
  snapshot within it is recorded. And `producer_diagnostic: null` does not isolate `:739`, because
  `:696` is null too.

  - `SnapshotCapError` takes the exceeded cap as a constructor argument and exposes it as a closed
    value: `entries` or `hash_bytes`. The three construction sites supply it; the catch sites in
    `review.ts` and `workspace.ts` need no edit.
  - `ProducerDiagnostic` gains `snapshot_site` and `snapshot_cap`. `snapshot_site` is closed over
    the six `snapshotTree` / `snapshotRuntimeOwnership` calls that can throw inside a producer
    round: `workspace_baseline` (`workspace.ts:1141`), `repo_before` (`transition.ts:693`),
    `runtime_before` (`:694`), `workspace_after` (`:735`), `repo_after` (`:736`), `runtime_after`
    (`:737`). Six values name the failing snapshot exactly, including the `:739`/`:696` ambiguity
    the observed run could not resolve.
  - `PRODUCER_DIAGNOSTIC_STAGES` gains `capture`, used by both capture blocks. The baseline keeps
    `stage: "write_scope_lock"` and carries `snapshot_site: "workspace_baseline"`: the stage names
    the phase of the round, the site names the walk, and the baseline genuinely belongs to the
    prepare-and-lock phase where `write_scope_code` also lives. This is deliberate, not an omission.
  - Both fields are closed enums validated in `buildProducerDiagnostic` exactly as `write_scope_code`
    is, so the record's no-free-text property (`contracts.ts:295-298`) is preserved: neither field
    can carry a path, a message, or a class name.
  - `serializeProducerDiagnostic` rebuilds from an explicit key whitelist, so both keys are added
    there with the same per-field normalization to `null`.
  - `parseTransitionStatusJson` (`serialize.ts:238-247`) passes `producer_diagnostic` through
    without rebuilding it, so a document written before this change would yield `undefined` rather
    than `null` for the two new keys. It normalizes them to `null`, the way it already normalizes
    the whole record. `SCHEMA_VERSION` stays `2`: the addition is null-tolerant in both directions.

- **D7 — relationship to task `0073`, recorded so neither round re-litigates it.**

  `0073` is planned and unstarted, and its D1 edits the same three places: `ProducerDiagnostic`,
  `buildProducerDiagnostic`, and `serializeProducerDiagnostic`'s whitelist. It takes the record from
  seven keys to ten (`provider_cause`, `http_status`, `result_is_error`). D6 takes it to nine, or to
  twelve if both land.

  There is no name collision and no semantic overlap — `0073` explains why a producer *process*
  failed, D6 explains which *walk* exceeded which cap. Both are additive to a closed record. Whoever
  lands second rebases the key-count assertion in `tests/serialize.test.ts:354-375` and `:415`
  ("copy only the seven whitelisted producer_diagnostic keys") and adds its own fields to the
  same whitelist. Neither task blocks the other, and neither changes the other's decisions.

- **D8 — `ctimeNs` is added to the shared `metadataTreeDigest`, which also tightens the repo-side
  `producer` policy, and that is accepted deliberately.**

  `metadataTreeDigest` (`snapshot.ts:218-249`) is shared: `recordSkippedProducerEntry` already uses
  it for the `producer` policy, which is how `productBefore` / `productAfter` (`transition.ts:693`,
  `:736`) cover `SKIPPED_DIR_NAMES` in the real repository. Adding the field there rather than
  forking a second digest keeps one definition and prevents the two from drifting — the same
  argument D4 makes for the scope lists.

  The consequence is that the repo-side check becomes marginally stricter: it begins to notice an
  inode change that alters neither content-visible metadata nor `mtime`, essentially a `chmod`,
  `chown`, or hard-link count change inside `.git/`, `node_modules/`, `.claude/`, `.cursor/`,
  `.venv/` or `venv/` of the repository under review. Anything it newly catches is a real write to a
  directory the producer is forbidden to touch, so the stricter reading is correct rather than
  merely tolerable. It is named here because it is a behavior change outside this task's stated
  Scope, and the reviewer may refuse it: the alternative is a parameter that includes `ctimeNs` for
  the collapse path and omits it for the `producer` policy, at the cost of two digest shapes.

## Acceptance Criteria

Re-derived from D1-D8 after cycle 1 changed D2. The list is regenerated from the decisions rather
than patched row by row, so a criterion that D2 no longer supports is gone rather than weakened.

1. On a producer workspace whose support tree exceeds the entry cap, a full auto-chain completes:
   the baseline, the capture, and the merge all succeed, and the transition reaches its terminal
   state without `reviewer_isolation_unavailable`. *(D1, D2, D5)*
2. A producer that modifies a file under a support prefix, outside every scratch prefix, still has
   its round refused with `write_scope_violation`. *(D1, D2)*
3. That refusal survives the evasion D2 was revised for: a test replaces a support-scope file's
   contents with a different payload of identical byte length, restores its `atime` and `mtime` to
   the values the baseline recorded, leaves its mode unchanged, and asserts the round is still
   refused. A test that only performs an ordinary write does not satisfy this criterion, because an
   ordinary write changes size or mtime and never reaches the gap. *(D2)*
4. A producer that writes only under a scratch prefix — `dist/` or `node_modules/.cache/` — has its
   round merged, not refused, and no scratch path appears in the captured changes. *(D1, D3)*
5. No scratch or support path appears as an entry in either `workspace`-policy snapshot of the
   producer copy; a support prefix appears as exactly one entry carrying a digest. *(D1, D2, D3)*
6. Setting `supportScope` to a value other than `PRODUCER_SUPPORT_SCOPE` changes what both
   snapshots collapse, with no second edit: a test passes a custom support scope to
   `prepareProducerWorkspace` and asserts the capture collapses that prefix and not `node_modules/`.
   This is the executable form of the no-drift constraint. *(D4)*
7. The baseline and the capture produce identical treatment for the same path, so an unmodified
   workspace diffs empty. A test asserts `workspaceDiff(baseline, after)` is empty when the producer
   wrote nothing — including when the producer only read support-scope files, since a read updates
   `atime`, which no digest records. *(D5, D2)*
8. Existing call sites of `snapshotTree` that pass neither new list behave exactly as before, shown
   by the present snapshot and write-detection tests passing unchanged. *(D4)*
9. The `producer`-policy digest gains the same field: a test asserts that a `chmod` inside a
   `SKIPPED_DIR_NAMES` directory of the repository under review now changes the digest, confirming
   D8's accepted tightening is real rather than incidental. *(D8)*
10. A capture stop names its failing snapshot and its exceeded cap in closed values: for each of the
    six sites, a stop carries the matching `snapshot_site`, and a cap overflow carries `snapshot_cap`
    of `entries` or `hash_bytes` according to which was exceeded. No stop on these paths carries
    `producer_diagnostic: null`. *(D6)*
11. `buildProducerDiagnostic` throws a `TypeError` on an out-of-domain `snapshot_site` or
    `snapshot_cap`, and `serializeProducerDiagnostic` normalizes one to `null`, matching the existing
    treatment of `write_scope_code`. *(D6)*
12. A persisted document written before this change still parses, with both new keys read as `null`
    and every other field unchanged. *(D6)*
13. The evidence measures the elapsed time a capture takes before and after the change, on a tree
    large enough to have failed, so the change is shown to remove the cost and not only the failure.
    The planner's pre-change numbers in Evidence are the baseline to measure against. *(D1, D2)*
14. `npm run build` and `npm test` pass, and `docs/DECISIONS.md` carries one dated D-074 entry
    recording D1's three-disposition finding, D2's `ctime` rationale and the granularity the
    collapse gives up, and D4's no-drift mechanism.

## Work Completed

Planner round, 2026-09-10. Read the four source anchors and the merge, capture, diagnostic, and
serialization paths around them; corrected two premises that changed the shape of the fix (see
Context); measured the candidate walk strategies against a synthetic application-sized tree; settled
D1-D7 and derived the acceptance criteria from them afterwards. No source file was edited.

Plan-review cycle 1, 2026-09-11, `codex` / `gpt-5.6-sol`: one error finding,
`SUPPORT_DIGEST_CONTENT`, correctly identifying that a metadata-only digest cannot see a same-size
content replacement with a restored `mtime`, so D2's "preserves the refusal exactly" was false and
the criterion meant to prove it never probed the gap. Reproduced the evasion against the shipped
record shape, established that `ctime` closes it and why, revised D2, added D8 for the shared-digest
consequence, and re-derived the whole criteria list from the changed decisions.

Implementer round, 2026-09-11, approved plan run
`run-9362410d-6890-4aec-8a1e-e8dec1657231`: added caller-supplied collapse and omission prefixes to
workspace snapshots; made collapsed support records ctime-aware while excluding nested scratch;
threaded the one resolved support scope through copy, baseline, capture, and merge; and split the six
producer snapshot catches into closed site/cap diagnostics with backward-compatible serialization.
Added D-074 and regression coverage for application-sized support, custom support scope, scratch-only
output, same-size/restored-time writes, exact-file support, producer-policy chmod, cap identity, and
old transition records. No Bridge command, commit, push, build output, or out-of-scope write was made.

Correction implementer round, 2026-09-11, after implementation review
`run-d6f6d021-86f1-4ac0-b98e-d8c6e8c919e2`: added per-site snapshot-cap seams and an end-to-end
six-site diagnostic regression, including the distinct `workspace_baseline` stage; consolidated the
prefix-membership helper; replaced the non-discriminating chmod check with a ctime-only hard-link
count change; corrected the guard-seam comment and the architecture, security, and decision prose to
state the live-window attribution limit, support-digest granularity, and nine-key diagnostic shape.
The pre-existing `spartan/.DS_Store` was left untouched under this round's no-destructive-operation
constraint.

Human-operator verification round, 2026-09-11, after implementation review
`run-14f1ff99-4d54-4cf5-9188-1dd7b5e9f757` terminated `human_required` on acceptance criterion 14.
Ran the two checks neither the producer sandbox nor a read-only review could reach, established that
the ten remaining `npm test` failures are a terminal-only `FORCE_COLOR` artifact of pre-existing
stderr-byte assertions rather than a product failure, and closed criterion 14. No source file was
edited in this round, so the reviewed diff is the committed diff.

## Evidence

- The source anchors, read at `main` on 2026-09-10: `snapshot.ts:7`, `:54-59`, `:92-157`,
  `:159-204`; `workspace.ts:29-30`, `:1062-1065`, `:1112-1152`, `:1156-1170`, `:1249-1291`,
  `:1363-1378`, `:1392-1463`; `transition.ts:669-745`, `:786-800`, `:849-851`, `:886-894`;
  `contracts.ts:288-357`; `serialize.ts:140-157`, `:238-247`.
- Merge classification, probed against the built runtime with `writeScope: ["src/"]`:
  `node_modules/left-pad/index.js` → `support`; `node_modules/.cache/build/x.bin` → `scratch`;
  `dist/main.js` → `scratch`; `src/core/snapshot.ts` → `admitted`; `docs/README.md` → `refused`.
  Read with `captureProducerMerge`'s `continue`/`throw` arms, this is the basis for D1.
- Walk cost, measured against `dist/core/snapshot.js` on a synthetic tree of 31,200 dependency
  files across 1,200 packages, 122 MB, plus 40 source files (warm cache, local SSD):

  | Strategy | Elapsed | Entries |
  | --- | --- | --- |
  | `workspace` policy, cap 20,000 (today) | 1,826 ms | throws `SnapshotCapError` |
  | `workspace` policy, cap lifted (cost only) | 2,756 ms | 33,643 |
  | `producer` policy — metadata-digest collapse (D2 shape) | 435 ms | 43 |
  | `repository` policy — omit outright (D1 shape) | 3 ms | 42 |

  The middle row is the Out of Scope evidence against raising the cap; the third is D2's.
- The failing transition's projected record: `state: stopped`,
  `reason_code: reviewer_isolation_unavailable`, `producer_diagnostic: null`,
  `linked_review_run_ids: []`, elapsed 3 minutes 43 seconds. `producer_diagnostic: null` rules out
  the baseline stop at `transition.ts:682`, which builds a diagnostic, but does not distinguish
  `:739` from `:696`, which is also null.
- `find node_modules -type f | wc -l` in this repository: 542.
- Cycle-1 evasion probe, run against the record shape shipped at `snapshot.ts:239-247` and the
  `mtimeNs` helper at `:251-256`, using the walk's own non-bigint `lstat`: write 4,096 bytes of
  `0x61`; overwrite with 4,096 bytes of `0x62`; `utimesSync` back to the recorded `atime`/`mtime`.
  Result — `size` 4096 → 4096 unchanged, `mode` 420 → 420 unchanged, so the shipped digest's
  content-blind fields do not see the replacement; `ctime` 1789088060584337400 → 1789088060584512300,
  which does. The probe's `mtime` moved 400 ns as well, but only because `fs.utimes` takes a
  double-precision seconds value; that is an API precision artifact and the plan rests no claim on
  it.
- Planner baseline before implementation: `npm run build` exited 0; `npm test` ran 552 tests with
  552 pass and 0 fail.
- Post-change capture benchmark, using 20,001 one-byte files under `node_modules/pkg` (one more than
  `SNAPSHOT_ENTRY_CAP`) in a prepared producer workspace: `265.9 ms`, four snapshot entries, one
  `node_modules` digest entry. The planner's pre-change baseline above failed at 20,000 entries after
  1,826 ms and took 2,756 ms with the cap lifted. The full auto-chain regression over the same
  20,001-file shape completed in 7,454.6 ms in the focused run.
- `npm run typecheck`: exit 0.
- Focused implementation suite:
  `node --import tsx --test tests/producer-write-scope.test.ts tests/write-detect.test.ts tests/serialize.test.ts tests/transition.test.ts`
  — 104 tests, 102 pass, 0 fail, 2 expected sandbox skips.
- All non-Git test files in one run — 489 tests, 479 pass, 0 fail, 10 expected sandbox skips.
- `npm test` was invoked three times. Each run reached 559 tests with 518 pass, 29 fail, and 12 skip;
  every failure was in `tests/implementation-review.test.ts`, `tests/repo-hygiene.test.ts`,
  `tests/task-status.test.ts`, or `tests/workspace.test.ts`, and every one failed at `git init` or
  `git ls-files` because the enclosing foreground sandbox returns
  `fatal: could not open '/dev/null' for reading and writing: Operation not permitted`. This is the
  declared sandbox boundary, not a product assertion failure. `npm run build` was not invoked because
  it emits to repository `dist/`, outside this round's authorized write scope; `npm run typecheck`
  exercised the same TypeScript compilation without emitting there.
- Trailing-whitespace scan across every edited file: no findings.
- Correction-round `npm run typecheck`: exit 0.
- Correction-round focused suite,
  `node --import tsx --test tests/producer-write-scope.test.ts tests/transition.test.ts`: 76 tests,
  74 pass, 0 fail, 2 expected sandbox skips. This includes one real terminal stop for each of
  `workspace_baseline`, `repo_before`, `runtime_before`, `workspace_after`, `repo_after`, and
  `runtime_after`, all with `snapshot_cap: entries`; the existing `repo_before` regression also
  covers `snapshot_cap: hash_bytes`.
- Correction-round non-Git suite (all test files except `implementation-review`, `repo-hygiene`,
  `task-status`, and `workspace`): 491 tests, 481 pass, 0 fail, 10 expected sandbox skips.
- Correction-round full `npm test`, invoked twice: 561 tests, 520 pass, 29 fail, 12 skip. All 29
  failures remain in the four excluded Git-backed files above and fail at `git init` or
  `git ls-files` because Git cannot open `/dev/null` in the enclosing sandbox. No product assertion
  failed. `npm run build` remains intentionally uninvoked because its configured output is `dist/`,
  outside the declared automatic write scope; `npm run typecheck` exercises the same compiler
  without emitting an unauthorized path.
- Static recheck: `src/core/snapshot.ts` is the sole definition of `isPrefixMember`; current
  architecture/security prose names all nine diagnostic keys, includes `ctimeNs` in skipped-tree
  digests, and distinguishes full-hashed admitted files from metadata-collapsed support.
- Final `validateProducerDeclaration` check returned `{"ok":true}`; the final TypeScript check
  exited 0 and the trailing-whitespace scan across the edited set found nothing.
- Implementation review cycle 2, `run-14f1ff99-4d54-4cf5-9188-1dd7b5e9f757`,
  `execution_id=exec-d882d60a-3953-4a68-a33f-1506bca65efc`, host `claude`, launcher
  `claude-plan-reviewer-v1`, model `claude-opus-5`, effort high: terminated `human_required` /
  `review_human_required` with `task_write_state: skipped_human_gate`, so the Bridge wrote no
  verdict region for this cycle. The reviewer recorded all seven cycle-1 findings resolved and no
  new correctness defect across the collapse/omit walk, `metadataTreeDigest`, the six catch arms,
  the serializer, and `captureProducerMerge`. Its one error finding, `BUILD_AND_TEST_UNVERIFIED`,
  held that criterion 14 was unreachable from both the producer sandbox and a read-only review.
- Human-operator round resolving that gate, 2026-09-11. `npm run build`: exit 0, reaching the
  `postbuild` `chmod +x dist/cli/main.js`. `npm test`: 561 tests, 551 pass, 10 fail, 0 skip,
  54.2 s. Criterion 1's regression, `application-sized support tree does not exhaust producer
  snapshot entries`, passed in 9,779 ms; the criterion 3, 6, 9, 10 and 12 regressions passed with
  it.
- The ten failures are one environment artifact, not a product assertion. Node's test runner
  exports `FORCE_COLOR` when its output is a terminal; the affected tests spawn the CLI with
  `env: { ...process.env, NO_COLOR: "1" }` (`tests/cli.test.ts:75`, `:338`, `:615`;
  `tests/mcp.test.ts:202`), and the child then prefixes stderr with `Warning: The 'NO_COLOR' env is
  ignored due to the 'FORCE_COLOR' env being set.` while those assertions compare stderr bytes
  exactly. Verified rather than assumed:
  `node --import tsx --test tests/cli.test.ts tests/mcp.test.ts` with no terminal attached ran
  60 tests, 60 pass, 0 fail, while the same `tests/mcp.test.ts` under a pseudo-terminal reproduced
  both the warning and the failure. `git diff -U0` over the `NO_COLOR` lines of both files is
  empty, so those assertions are pre-existing and untouched here, and none of the ten exercises
  `snapshot.ts`, `workspace.ts`, `serialize.ts`, `review.ts`, `transition.ts`, or `contracts.ts`.
- The cycle-2 info findings, rechecked against the live worktree. `DS_STORE_UNTRACKED` does not
  hold: `.gitignore:1` ignores `.DS_Store` and `git status --porcelain` reports no untracked path,
  so the reviewer was reading `changes.txt` from the producer copy rather than the worktree.
  `PARSE_WAITED_MS_NOT_NORMALIZED` does hold and is deliberately not fixed here, so that the
  reviewed diff stays the committed diff.
- Pre-commit identity scan over the tracked tree: no user name, host name, or e-mail address; every
  absolute home path is a placeholder (`<user>`, `example`, `real`, `someone`, `you`), and every
  occurrence of the maintainer handle is part of the repository's own public GitHub URL. The test
  results above are recorded as counts and repository-relative paths for the same reason.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-9362410d-6890-4aec-8a1e-e8dec1657231 execution_id=exec-eab69fb7-da06-454c-9d9e-f7aef24f4812 review_kind=plan verdict=pass reason_code=review_passed host=codex launcher=codex-plan-reviewer-v1 model=gpt-5.6-sol effort=high model_observed=declared_unobserved policy_digest=sha256:c032b4cea31dd45976e0e4d6a6b689590f1f0a1a368378fd8a82e546eb9525a3 task_hash=sha256:624cc7f5df96ff6f96a900372f1fdaed201d8c5cf5a6f667815004a549e3a92d agents_hash=sha256:6bd68578db8fd268d33c5847ff43bbf478ca1ed9c7a17c1a34df7ed723f5b8da timestamp=2026-09-11T00:59:19.514Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: CHANGES_REQUESTED

Findings:

- `BUILD_AND_TEST_UNVERIFIED` (error): Acceptance criterion 14 requires `npm run build` and `npm test` to pass. Evidence records neither. `npm run build` was never invoked (the producer sandbox forbids writing repository `dist/`), and all three `npm test` runs ended 518 pass / 29 fail. `npm run typecheck` is not a substitute: it emits nothing, so `dist/` still holds the pre-change build while `src/core/snapshot.ts`, `workspace.ts`, `transition.ts`, `contracts.ts` and `serialize.ts` have all changed. Failure scenario: run `spartan-bridge review` on this checkout and it takes the shipped stale-build refuse (`reason_code: "stale_build"`, `staleBuildMessage` at `src/cli/main.ts:401`, `src/cli/detach.ts:186-192`) — exit 1, no run directory — before any reviewer is dispatched. The implementer named this in Blockers and asked the reviewer to run it; this review is read-only and has no shell, so the criterion stays objectively unmet. Run `npm run build`, then `npm test` where Git may open `/dev/null`, and record both results.
- `CTIME_WINDOW_ATTRIBUTION` (warning): D8 justifies extending the shared `metadataTreeDigest` to the repo-side `producer` policy with: "Anything it newly catches is a real write to a directory the producer is forbidden to touch." The diff disproves that. `productBefore`/`productAfter` (`transition.ts:705`, `:760`) detect any change in a time window; they do not attribute it to the producer. Evidence is in this diff: `ChflagsBridgeLockAdapter` was moved from `startProducer` to `lockProducerIsolation` (`tests/transition.test.ts:1130`). `chflags uchg` updates the inode's ctime on `.spartan-bridge`, a `SKIPPED_DIR_NAMES` tree folded into the now-ctime-aware digest. Left in `startProducer` it lands between the two snapshots, so a Bridge-side metadata change would now stop the round as `write_scope_violation` — the "released before the runtime persists a successful producer_finished record" test would fail. The relocation is absent from Work Completed and Evidence, and the comment at `tests/transition.test.ts:1115-1116` still names the `startProducer` seam. Either take D8's offered alternative (ctime for the collapse path only) or correct D-074 to state the window-attribution limit, and fix the stale comment.
- `SECURITY_DOC_CONTRADICTS_CODE` (warning): `docs/AUTHENTICATION-AND-SECURITY.md` now contradicts the code in both directions, and the diff touches only `docs/DECISIONS.md`. Line 637 states the folded digest covers "kind, path, mode, size, `mtimeNs`, and link target" and "Consequently a size-preserving write that restores `mtimeNs` is invisible in the metadata-only tiers" — the implementer's own rewritten test (`tests/producer-write-scope.test.ts`, "producer snapshots detect skipped-tree writes even when size and mtime are restored") inverts exactly that assertion from `deepEqual([])` to a detected `hash` diff. Line 639 states merge-back "snapshots the copy with full workspace hashes" — false now that support trees collapse to one metadata entry, which is precisely the granularity D2 admits giving up. The second direction is the dangerous one: a reader of the published security boundary would believe a support-scope byte change is content-verified when it is metadata-only. D2 says the plan "states it rather than arguing it away"; the document where that boundary is stated to users still argues it away.
- `SNAPSHOT_SITE_COVERAGE` (warning): Criterion 10 requires that "for each of the six sites, a stop carries the matching `snapshot_site`". Only two are covered end to end. `tests/transition.test.ts` asserts `repo_before` (labels "pre-child snapshot cap" → `entries`, "pre-child snapshot hash cap" → `hash_bytes`) and `repo_after` ("producer repo_after snapshot cap", "post-child snapshot filesystem error" → cap `null`). No test drives a real stop through `workspace_baseline`, `runtime_before`, `workspace_after`, or `runtime_after`; the new serialize test only round-trips all six through `buildProducerDiagnostic` and the serializer, which exercises the enum, not the call sites. `workspace_baseline` is the notable gap: it is the one site with a different stage (`write_scope_lock`, not `capture`), D6 calls that pairing "deliberate, not an omission", and D5 identifies it as where the original defect relocates. It is also untestable as written, because the baseline `snapshotTree` at `workspace.ts:1143` accepts no injected caps unlike the `policy: "producer"` sites that spread `input.deps.snapshotCaps`. Thread a cap seam through the baseline, or state in the artifact which sites are covered only at the constructor.
- `CHMOD_TEST_NOT_DISCRIMINATING` (warning): Criterion 9 asks for a test "confirming D8's accepted tightening is real rather than incidental", and the new test is "producer-policy metadata digest detects chmod inside a skipped tree" (`tests/producer-write-scope.test.ts`). It cannot confirm anything about `ctimeNs`. The pre-change digest record was `["file", rel, mode, size, stamp, ""]` — `mode` was already present, so a `chmod` already changed the digest. Failure scenario: revert `ctimeNs` from `collectMetadataRecords` (`snapshot.ts:297`, `:299-311`) and this test still passes, so it would not catch a regression that drops the field. The property is in fact covered, but by a different test — the rewritten hard-link case that restores size and mtime and leaves ctime as the only signal. Either point criterion 9 at that test or change the chmod test to a metadata change the old digest could not see (for example `chflags`, or a hard-link count change), so the assertion discriminates.
- `DS_STORE_UNTRACKED` (info): `changes.txt` lists `untracked "spartan/.DS_Store"` in this round's change set. A file only appears as untracked if Git is not ignoring it, so a `git add -A` on this tree would commit a macOS Finder artifact into `spartan/`. Work Completed asserts "No Bridge command, commit, push, build output, or out-of-scope write was made", which does not account for it. Remove it before the commit, and if `.DS_Store` is genuinely unignored, that belongs in `.gitignore` (task 0008's territory) rather than in this task.
- `ISPREFIXMEMBER_DUPLICATED` (info): `isPrefixMember` is now defined twice with identical bodies: `src/core/snapshot.ts:315-318` (new) and `src/core/workspace.ts:1364-1367` (existing). The two must agree for the collapse/omit rules to match `classifyProducerWorkspacePath`'s dispositions — that agreement is what makes D1 outcome-neutral — yet nothing links them. `workspace.ts:19` already imports from `snapshot.ts`, so exporting the one in `snapshot.ts` and deleting the copy costs nothing and removes a silent-divergence path of exactly the kind D4 argues against for the scope lists.
- `DIAGNOSTIC_KEY_COUNT_DOCS` (info): `docs/ARCHITECTURE.md:183` and `docs/AUTHENTICATION-AND-SECURITY.md:730` and `:734` each describe `producer_diagnostic` as "exactly six closed scalar keys" and enumerate `stage`, `exit_code`, `timed_out`, `write_scope_code`, `adapter_phase`, `adapter_cause`. The record was already seven with `waited_ms`, so this drift predates the change; `snapshot_site` and `snapshot_cap` take it to nine and widen an existing gap. Not introduced here and outside the stated Scope, but D7 already anticipates a rebase of the key-count assertion when 0073 lands, so the prose count is worth folding into whichever of the two tasks lands second.

Bridge run: run_id=run-d6f6d021-86f1-4ac0-b98e-d8c6e8c919e2 execution_id=exec-ec21df67-dc25-414d-9e39-ed6c515f6e56 review_kind=implementation verdict=changes_requested reason_code=review_changes_requested host=claude launcher=claude-plan-reviewer-v1 model=claude-opus-5 effort=high model_observed=declared_unobserved policy_digest=sha256:e363264f72a848d870898b8d1d1abe453a4f1e519f622f4415d9531d867023f6 task_hash=sha256:b64727f5785e5a132c32f1bcfa26a0dfd7aa43a0a6fa594424e3e6a3069353d2 agents_hash=sha256:6bd68578db8fd268d33c5847ff43bbf478ca1ed9c7a17c1a34df7ed723f5b8da timestamp=2026-09-11T01:31:24.189Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None. Acceptance criterion 14's two checks ran in an authorized environment on 2026-09-11:
`npm run build` exited 0, and `npm test` reached 551 of 561 passing with the ten remaining failures
attributed to a pre-existing terminal-only assertion artifact and reproduced as passing off a
terminal. The sandbox limitation recorded through the correction round no longer applies.

## Next Action

None. The task is complete. Every acceptance criterion has a recorded outcome, the implementation
review's only error finding was criterion 14 and it is now satisfied, and no blocker remains.

The implementation review's Bridge-owned region holds the cycle-1 `CHANGES_REQUESTED` record.
Cycle 2 returned `human_required` and the Bridge wrote no region for it, so none was synthesized in
its place: the closing verdict is recorded as human-operator in Work Completed and Evidence, where
the evidence for it actually is.

## Next Handoff

No outstanding handoff. Task closed by the human operator on the implementation-review human gate.

Non-binding suggestion. Two residuals outlive this task and belong in their own work rather than in
a post-review edit here. `parseTransitionStatusJson` still leaves `waited_ms` un-normalized while
normalizing the two newer `producer_diagnostic` keys, which suits task `0073` if it lands next. Ten
CLI and MCP tests fail for anyone running `npm test` attached to a terminal, because they compare
stderr bytes exactly while the test runner exports `FORCE_COLOR`; that is a standing trap for every
future round in this repository and deserves a task of its own.
