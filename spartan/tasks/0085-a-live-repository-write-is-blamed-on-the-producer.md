---
protocol: "1.1.1" # x-release-please-version
id: a-live-repository-write-is-blamed-on-the-producer
created_at: 2026-09-13
status: active
phase: planning
task_type: planning
risk: material
current_role: planner
next_role: planner
updated_at: 2026-09-13
handoff_id: none
next_handoff_id: HX-001
---

# A write to the live repository during a producer round is blamed on the producer

## Objective

When anything other than the automatic producer changes the live repository while a producer round
runs, the operator can tell that from the stop itself, and learns before dispatch that the
repository must stay quiet for the round. Today such a change stops the chain as
`write_scope_violation` and lists the changed paths as what the producer wrote, so the operator is
told the implementer misbehaved when it did not.

## Context

An automatic producer works in an isolated copy (D-072). Around that round the runtime takes two
snapshots of the live repository, `productBefore` and `productAfter`, to detect a write that escaped
the sandbox. Those snapshots cover the whole live tree except the fixed skipped directories, and any
difference between them stops the chain. They cannot say who made the difference, and the stop does
not say that either.

The same reason code, `write_scope_violation`, is also what the copy-side merge classifier reports
when the producer itself writes outside the automatic write scope. The two causes need different
responses — the first is an operator environment problem, the second is a plan or producer problem —
and a status document or the terminal line gives no way to tell them apart.

A repository's `producer.scratch_prefixes` declaration does not help here. It is applied to both
producer-copy snapshots and to merge classification, and by design not to the live snapshots, so a
declared build-cache directory that a development server rewrites during the round is still a live
difference.

The observed case (Evidence) cost a 20-minute producer round and a separate diagnosis to reach the
answer "stop the development server before dispatch".

## Scope

- `src/core/transition.ts` — the live-snapshot stop at `:851`–`:860`.
- `src/core/contracts.ts` — `ReasonCode`, if a distinct code is decided.
- `src/cli/main.ts` — the transition terminal line's `wrote=` rendering at `:214`–`:217`.
- `agent-skill/skills/spbridge/SKILL.md` — the `producer_refused_paths` sentence at `:289`–`:291`,
  and any pre-dispatch operator guidance decided in D3.
- `docs/AUTHENTICATION-AND-SECURITY.md` (`:637`), `docs/ROUTING-AND-WORKFLOWS.md` (`:209`), and a new
  `docs/DECISIONS.md` entry.
- `tests/` covering whatever is decided.

## Out of Scope

- Weakening the live-tree detection itself. A sandbox-escaped write into the live repository must
  still stop the chain.
- The copy-side behavior of `producer.scratch_prefixes` and the merge classifier.
- The residuals D-072 already names: a pre-existing cross-root hard link and a delayed write after
  `productAfter`.
- The plan-target scan and its `unwritable_plan_targets` advisory.
- Automatic retry of a stopped round.

## Constraints

- The live snapshot keeps detecting a change anywhere it detects one today; whatever is decided
  changes how a change is reported or prevented, not whether it stops the chain, unless D2 decides
  otherwise with its security consequence stated.
- Repository ignore rules do not classify files, and the Bridge does not read a file's contents to
  classify it (`AGENTS.md`, Authentication and security boundary).
- Evidence from another repository carries run and transition ids, reason codes, timings, and
  document shape only (`AGENTS.md`, Artifact authoring).

## Decisions

Open, for the planning round:

- **D1 — Attribution.** Whether a live-tree difference stops with its own reason code, distinct from
  the copy-side `write_scope_violation`, and how that change is carried through the persisted
  documents, the serializer, the skill, and any consumer that switches on the reason code.
- **D2 — Declared scratch in the live snapshot.** Whether declared `scratch_prefixes` may be omitted
  or folded in the live snapshots, weighed against D-072's detection purpose. Folding into a metadata
  digest would not avoid this stop, since a development server changes `ctimeNs`; omission removes
  detection for those paths.
- **D3 — Operator guidance before dispatch.** Where the requirement that nothing writes the live
  repository during a producer round is stated before the chain starts (the skill's step 4, the
  routing documentation, `doctor`), and whether any check can detect an active writer or only warn.
- **D4 — Wording of refused paths.** What `producer_refused_paths` and the `wrote=` terminal token
  claim for a live-tree difference, since the skill today says they "name what the producer wrote".

## Acceptance Criteria

To be derived from D1–D4 by the planning round, last and from the decisions, per the repository's
artifact-authoring rule.

## Work Completed

- 2026-09-13 (planner, Claude Code, `claude-opus-5`): queued at the owner's direction after
  diagnosing an auto-chain stop in another repository from sanitized yes/no answers. Recorded the
  mechanism, the code and documentation it rests on, and four open decisions. Settled no decision and
  changed no product file.

## Evidence

- Occurrence, 2026-09-13, another repository: transition
  `transition-efd68797-cdf2-4c10-bdbb-5f9b82dd7308`, `state` `stopped`, `reason_code`
  `write_scope_violation`, created `2026-09-13T12:25:11.864Z`, updated `2026-09-13T12:45:17.902Z`,
  `unwritable_plan_targets_count` 1, `producer_refused_paths` with 2 entries. The operator reports a
  framework development server was running against that repository's working tree during the round.
  Asked yes/no per path in that repository's own session, without transferring any path: both
  refused paths lie under the server's build-cache directory (one is the directory itself), which
  that repository declares in `producer.scratch_prefixes`; neither is the unwritable plan target.
- `src/core/transition.ts:736` and `:798`: `productBefore` and `productAfter` are
  `snapshotTree(input.repoRoot, { policy: "producer", ... })` with no omitted prefixes; `:789`–`:791`:
  the copy snapshot passes `omitPrefixes: prepared.scratchPrefixes`.
- `src/core/transition.ts:851`–`:860`: any live difference other than `.` returns
  `reason: "write_scope_violation"` with those paths as `refusedPaths`.
- `src/core/workspace.ts:1565`: the copy-side merge classifier throws
  `new ProducerMergeError("write_scope_violation", [], ...)` for a producer write outside scope — the
  same reason code for the other cause.
- `src/core/snapshot.ts:25`: the skipped directory names are `.git`, `node_modules`,
  `.spartan-bridge`, `.claude`, `.cursor`, `.venv`, `venv`; `:118` folds them for the `producer`
  policy.
- `docs/ROUTING-AND-WORKFLOWS.md:209`: "Declared scratch is discarded from both producer-copy
  snapshots, the collapsed support digest, and merge classification."
- `docs/AUTHENTICATION-AND-SECURITY.md:637`: the live `productBefore`/`productAfter` snapshots
  "detect changes only within their time window; they do not attribute the actor".
- `agent-skill/skills/spbridge/SKILL.md:290`–`:291`: "Those tokens name what the producer wrote".
- `src/cli/main.ts:214`–`:217`: the terminal line renders `producer_refused_paths` as `wrote=` for
  `write_scope_violation` and `runtime_state_violation`.

## Review

Verdict: PENDING

Findings:

- None recorded.

## Blockers

None. The operator workaround is to stop development servers, watchers, and builds in the
repository before dispatching an auto-chain.

## Next Action

A planning round that settles D1–D4 and derives the acceptance criteria from them.

## Next Handoff

```text
Recommended execution (human decides):
- Host: Claude Code — the `planner` binding in AGENTS.md
- Model and effort: claude-opus-5, effort high
- Role: planner
- Handoff: HX-001
- Permission: writable
- Invocation: `/spbridge` in a fresh session, passing the prompt block below as the argument — `spartan-bridge doctor` reports the `reviewer.plan` adapter available, so the Bridge dispatches the review
```

```text
Open `spartan/tasks/0085-a-live-repository-write-is-blamed-on-the-producer.md` (handoff HX-001).

Act as planner. Settle D1-D4 and derive the acceptance criteria from them; the round succeeds when every criterion names the decision it follows from and no decision is left open.
Run the relevant repository checks and update the same task file.

Return only the next handoff, or a completion notice if no work remains.
```
