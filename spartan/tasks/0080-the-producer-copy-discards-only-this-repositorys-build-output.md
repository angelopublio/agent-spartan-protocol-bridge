---
protocol: "1.1.0" # x-release-please-version
id: the-producer-copy-discards-only-this-repositorys-build-output
created_at: 2026-09-11
status: active
phase: planning
task_type: planning
risk: high-impact
current_role: planner
next_role: planner
updated_at: 2026-09-11
handoff_id: HX-001
next_handoff_id: HX-002
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

Nothing here edits an authority path from a producer round; the configuration file this task most
likely extends is outside every automatic write scope, which the Constraints address.

- `src/core/workspace.ts` — the scratch-prefix constant and the resolution seam.
  `prepareProducerWorkspace` already accepts and returns a resolved support scope; scratch is the
  one that stayed fixed.
- `src/core/transition.ts` — the post-run snapshot's omit prefixes, and the reason code that a
  snapshot-cap stop reports.
- `src/policy/bridge-config.ts` — the producer key check and validation of a declared prefix list.
- `src/core/snapshot.ts` — read for the per-file hashing rule; changed only if a decision says so.
- `docs/AUTHENTICATION-AND-SECURITY.md` — the producer-copy and snapshot paragraphs.
- `docs/DECISIONS.md` — one dated entry, and its relationship to D-074.
- Tests covering the config parser, the two producer snapshots, and the merge classifier.

## Out of Scope

- Raising `SNAPSHOT_ENTRY_CAP`. Task `0077` already refused that, and the measurement in Evidence
  shows raising a cap is the wrong lever: the observed output is roughly thirty-six times the whole
  byte budget and grows with the project.
- The reviewer workspace prepared for an implementation review. It copies only the declared
  implementation review scope, which admits no build output, and is not affected. Task `0077`
  recorded the same exclusion.
- `snapshotRuntimeOwnership` reaching a cap from accumulated run history. Task `0077` named that
  residual in its own Out of Scope and it is still unowned; this task does not claim it. A planner
  may argue for folding it in, but must say so rather than absorb it silently.
- The redaction gap that hid this diagnosis. The summary tool that carries a run out of its
  repository dropped two of the nine closed diagnostic keys; that lives outside this repository and
  was fixed directly on 2026-09-11.

## Constraints

- A declared scratch prefix makes a producer write under it **silently discarded** rather than
  refused. Today a write outside the write scope is a visible `write_scope_violation`. A repository
  that could declare a prefix overlapping its own automatic write scope could therefore make
  product changes vanish with no error. The relationship between a declared prefix and the write
  scope must be decided and enforced, not left implicit.
- Both current configuration shapes must keep parsing unchanged. A repository that declares the new
  key against a runtime without support must fail closed and loudly, as it does today.
- The fix is only complete if the resolved value reaches all three use sites. Changing the two
  snapshots alone stops the cap failure and leaves the merge classifier refusing the same paths, so
  the round still dies — with a different reason code.
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

To be settled by the planner round.

- **Where the declaration lives.** The per-repository configuration file already carries a
  `producer` section, so extending it is smaller than a new authority-file section. The planner must
  weigh that against the fact that a repository's build output is arguably policy rather than
  operational configuration.
- **What guards an overlapping declaration.** Refusing the configuration when a declared prefix
  intersects the automatic write scope is the obvious guard; the planner must decide whether that is
  the rule, and what the refusal reports.
- **Whether the per-file hashing rule changes.** The live-tree walk stops hashing above 1 MiB and
  falls back to size and timestamps, a residual already documented and accepted. Applying the same
  rule to the copy would make the copy's budget survive a large file that no scratch declaration
  covers, at the cost of that same detection residual on the producer's own edits. This is a
  separate lever from the declaration and may be refused.
- **Whether a snapshot-cap stop keeps reporting a reviewer reason code.** The current mapping is
  the reason this failure was first read as an adapter problem.

## Acceptance Criteria

To be derived from the decisions, last.

## Work Completed

Not started.

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
- **E-4 — the reason code is a mapping, not a diagnosis.**
  `return error instanceof SnapshotCapError ? "reviewer_isolation_unavailable" : "adapter_error";`
  (`src/core/transition.ts:892`). The pair `stage: capture` with that reason code can mean nothing
  but an exhausted cap.
- **E-5 — configuration cannot express the fix today.** Adding any key beside `model_binding` under
  the producer section, or any fourth top-level key, returns `{ kind: "invalid", reason: "config_invalid" }`
  (`src/policy/bridge-config.ts:140` and the top-level count check above it). `dispatch` accepts
  `"automatic"` and `"manual"`, so a repository can stop the plan-pass successor from starting, but
  that suppresses the chain rather than fixing it and does not affect an implementation-correction
  execution.
- **E-6 — the second wall.** With the cap satisfied, `classifyProducerWorkspacePath` returns
  `refused` for a path that is neither scratch, support, nor admitted, and `captureProducerMerge`
  throws `ProducerMergeError` with `write_scope_violation`. Build output that is not declared
  scratch fails the round either way.

## Review

Verdict: PENDING

Findings:

- None recorded.

## Blockers

No planning blocker. One verification dependency, recorded in Constraints: the end-to-end proof
cannot be produced in this repository and must come from one whose declared build writes outside the
default prefixes.

Task `0079` is blocked behind this one. Its remaining criterion needs an auto-chain that reaches
`producer_finished`, then `reviewing`, with an `implementation_review_result` event recorded, in a
repository whose client context differs from the machine default. The one repository that satisfies
the client-context condition is the repository that meets this defect, so `0079` cannot close until
this ships and a chain completes there.

## Next Action

Plan the declarable scratch prefixes and let the Bridge dispatch the mapped `reviewer.plan` against
the result.

## Next Handoff

```text
Recommended execution (human decides):
- Host: the host this repository binds to `planner`
- Role: planner
- Handoff: HX-002
- Invocation: `/spbridge`
```

```text
Open `spartan/tasks/0080-the-producer-copy-discards-only-this-repositorys-build-output.md` (handoff HX-002).

Act as planner. Settle where a repository declares its producer scratch prefixes, what guards a
declaration that overlaps the automatic write scope, whether the per-file hashing rule of the copy's
snapshots changes, and whether a snapshot-cap stop keeps reporting a reviewer reason code. Establish
on evidence that a resolved declaration reaches all three use sites, and that both current
configuration shapes keep parsing. Note that a plan whose scope edits the per-repository
configuration file declares a human implementer. Derive the acceptance criteria from those
decisions, last.

Then let the Bridge dispatch the mapped `reviewer.plan` against this artifact and work the returned
findings in this same session, re-deriving every criterion whose decision a finding changes.

Return only the next handoff, or a completion notice if no work remains.
```
