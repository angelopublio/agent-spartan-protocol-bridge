---
protocol: "1.1.1" # x-release-please-version
id: the-bridge-projects-its-own-redacted-run-summary
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

# The Bridge projects its own redacted run summary

## Objective

A `/spbridge --summary` round produces, from the Bridge's own run records, a
block safe to paste into a session working on a different repository: the run
and transition facts a diagnosis needs, and nothing that identifies the
repository, the account, or the work those runs belong to. The projector lives
beside the document schema it mirrors, so a field added to a persisted document
and its disclosure decision are made in the same change and reviewed together.

## Context

The Bridge persists run state in `.spartan-bridge/runs/<run-id>/status.json` and
`events.jsonl`, and transition state alongside it. Diagnosing a failed round is
often only possible somewhere other than where it happened: the round that
failed is in a private repository, and the session that can read the runtime's
source is here. Moving those records by hand is what the rule against carrying
another repository's paths, names and aliases exists to prevent.

A projector for exactly this purpose already exists as a separate personal
skill, outside this repository, and is the working reference for what the
projection must do. This task reimplements that capability as a Bridge surface.
Nothing is copied: no path, identifier, fixture, or recorded run from where it
lives today enters this repository, and this artifact names neither its
repository nor its install location.

Two properties make the existing projector safe, and they are the properties to
reproduce rather than the code:

- **Positive allowlist.** Every emitted key is named in the projector. A field
  added to a persisted document later is absent by default rather than disclosed
  by default. A summary composed by reading the JSON has the opposite property.
- **Shape validation.** Selecting a key is not enough: persisted documents are
  parsed without membership checks, so a hand-edited or future-schema file could
  place arbitrary text in an emitted field. Every emitted value matches the
  shape of its field or is replaced with a marker. Shape rather than an enum
  list, so a reason code added upstream still passes while prose, paths and
  malformed timestamps do not.

Withheld keys are named, never valued, so a reader can tell "this run had no
adapter failure" from "this run's adapter failure was omitted".

The coupling that motivates the move is concrete. Task `0083` adds
`runtime_build` to the status documents and `emitting_build` to the event
documents. An allowlist maintained outside this repository does not carry them,
and does not even mark them as withheld, so the field a round most needs when
its runtime is in question is the field the summary silently drops. Co-located,
that is a review finding on the change that adds the field.

## Scope

To be settled by the planning round. The surface is `--summary`, reached from
`/spbridge`; whether that is a `spartan-bridge` subcommand, a flag on an
existing command, or both is a decision this task makes rather than assumes.

## Out of Scope

- Any change to the existing personal skill, wherever it lives. This task does
  not migrate, delete, or depend on it.
- Findings prose. A verdict's findings are sentences, and no field allowlist
  sanitises a sentence; the projection counts them by severity.
- Changing what the Bridge persists. This task projects existing records.

## Constraints

- English artifact.
- No identifier of any other repository enters this repository: not its name,
  path, install location, skill name, owner, or any alias that selects it. No
  recorded run, fixture, or output produced there is copied here.
- The repository's own hygiene rule applies unchanged: no absolute home path
  under a real user, no personal address, no client-context alias other than
  `personal` or `default`.
- The projection is mechanical. Its safety must not depend on anyone — or any
  model — remembering to omit something at the moment of writing.

## Decisions

To be settled by the planning round. The open questions this task must close:

- **D1 — the surface.** What `--summary` is mechanically, and how `/spbridge`
  reaches it without the skill growing a second runtime-selection path.
- **D2 — the allowlist's home.** Where the emitted-key lists live so that adding
  a persisted field forces a disclosure decision in the same change, and what
  makes that coupling fail loudly rather than silently.
- **D3 — shape validation.** The per-field shapes, and what an out-of-shape
  value is replaced with.
- **D4 — findings.** How severity counts are emitted without their prose, and
  whether a paraphrase is ever produced, by whose explicit request.

## Acceptance Criteria

To be derived from D1-D4 by the planning round, last and from the decisions,
per the repository's artifact-authoring rule.

## Work Completed

- 2026-09-13 (planner, Claude Code, claude-opus-5): queued at the owner's
  direction while task `0083` was in plan review. Recorded the objective, the
  two properties the projection must reproduce, the coupling that motivates
  moving it, and the disclosure constraint the owner set. Settled no decision
  and changed no product file.

## Evidence

- `0083` adds `runtime_build` to `StatusDocument` and `TransitionStatusDocument`
  and `emitting_build` to `EventDocument` and `TransitionEventDocument`. A
  projector whose allowlist is maintained elsewhere carries neither, and marks
  neither as withheld.
- `src/core/contracts.ts` holds the four persisted document types this task
  projects. Their fields are the allowlist's subject, which is the argument for
  co-location.

## Review

Verdict: PENDING

Findings:

- None recorded.

## Blockers

None. This task does not depend on `0083` landing, and `0083` does not depend on
this one.

## Next Action

A planning round that settles D1-D4 and derives the acceptance criteria from
them.

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
Open `spartan/tasks/0084-the-bridge-projects-its-own-redacted-run-summary.md` (handoff HX-001).

Act as planner. Settle D1-D4 and derive the acceptance criteria from them; the round succeeds when every criterion names the decision it follows from and no decision is left open.
Run the relevant repository checks and update the same task file.

Return only the next handoff, or a completion notice if no work remains.
```
