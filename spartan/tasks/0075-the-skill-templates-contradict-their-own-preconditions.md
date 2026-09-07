---
protocol: "1.1.0" # x-release-please-version
id: the-skill-templates-contradict-their-own-preconditions
created_at: 2026-09-05
status: active
phase: planning
task_type: planning
risk: material
current_role: planner
next_role: planner
updated_at: 2026-09-05
handoff_id: none
next_handoff_id: HX-001
---

# The `/spbridge` step 7 templates contradict step 2 and the operator handover convention

Publication note (2026-09-06): the command and prompt handover convention is now embedded in root `AGENTS.md`. The local-tooling paths and consumer-repository example below are historical placeholders. The skill-template and model-binding corrections described by this task remain pending.

## Objective

Every prompt block `agent-skill/skills/spbridge/SKILL.md` step 7 tells a host to
print satisfies the preconditions the same file states elsewhere, and is
delimited the way the operator's own handover convention requires. A round
started from a step 7 block runs the checks a round started by hand would run.

## Context

Two defects, both in step 7's output shapes, both observed on 2026-09-05.

### 1. The correction template suppresses the skill's own model-binding check

Step 2 runs `spartan-bridge policy --repo <root> --role <role>` **only** "when
the paste's `Act as <role>` is `planner` or `implementer`"
(`agent-skill/skills/spbridge/SKILL.md:107`). Step 1 forbids filling a missing
role in: it says to write `role none stated`, and to neither infer a role from
the host nor open the artifact to find one.

Of step 7's three prompt shapes, two name a role — `Act as <artifact
next_role>` in both `review_passed` shapes (`:424`, `:442`) and `Act as
implementer` in the `producer_declaration_invalid` shape (`:474`). The
`review_changes_requested` shape names none. Its whole body is:

```text
Open `<path-from-step-1>`.

Revise against the recorded findings, then leave the review to this skill.
```

So a correction round entered from that block reports `acting as role none
stated`, skips the policy helper, and never compares the session model against
`binding_model`.

Observed on `spartan/tasks/0001-example-consumer-task.md`
in `anonymized-consumer-repository` on 2026-09-05: the session
printed `Round: ... — handoff none stated — acting as role none stated` and
then "The paste states no role, so the policy helper is skipped."

Under `model_binding_mode: advisory` this costs nothing. Under `warn` the
operator loses a warning; under `strict` — a mode the config accepts
(`src/policy/bridge-config.ts:13`) — the round that should abort on a wrong
model proceeds instead. Correction rounds are where a host or model most often
changes, because the operator is picking up work after a stop.

The template's omission is not obviously accidental: a correction round
continues in the role the artifact already records, so the shape may have been
written on the assumption that the role is implied. Step 1 rules that
assumption out by design, which is what turns the omission into a suppressed
check. The planner round decides whether the fix belongs in the template, in
step 2's precondition, or in step 1's rule — and says why the other two are
wrong.

### 2. The templates use markdown fences where the operator convention requires closed markers

`<local-tooling>/AGENTS.md` — the working conventions this
operator applies in every repository and host — requires a command or prompt the
human runs to sit between an opening and a closing marker:

```
######## RUN AS PROMPT ##################
<prompt>
######## END OF RUN AS PROMPT ##########
```

with nothing else inside the block, the explanation before it, and the host
named in that explanation. The reason it gives is specific: a prompt is
ordinary prose, so without a closing marker the reader cannot tell where it
ends.

Step 7's shapes use ` ```text ` fences instead — thirteen fenced blocks in the
file, including all eight in step 7. A host following the skill therefore emits
the handover in a form the convention rejects, and the operator has corrected
that formatting three times (2026-09-03 twice, 2026-09-05 once), the last time
against a session that was following this file.

The two conventions are not both satisfiable as written, and the skill is
downstream: `AGENTS.md` in `agent-scripts` is the operator's single source for
host-agnostic conventions, and `SKILL.md` is one consumer of it.

## Scope

To be pinned by the planner round.

- `agent-skill/skills/spbridge/SKILL.md` — step 7's shapes, and whichever of
  step 1 or step 2 the D1 decision touches.
- `tests/spbridge-skill.test.ts` — the assertions that pin step 7's shapes and
  step 2's precondition.
- `docs/DECISIONS.md` — one dated entry.
- Possibly `agent-skill/scripts/manage-install.sh`, only if the installed copy
  needs re-syncing as part of the change.

## Out of Scope

- The runtime. No file under `src/` changes; `spartan-bridge policy`, its JSON
  shape, and the three `model_binding_mode` values are unchanged.
- Adding a role to a round that genuinely has none, or letting the skill infer a
  role from the host. Step 1's prohibition stands.
- The `<local-tooling>` repository. If the convention there is
  incomplete, that is a separate change in a separate repository, and this task
  only consumes it.
- Task `0073`'s runtime diagnostics and the shared-`dist/` coupling.

## Constraints

- English artifact.
- The skill stays a thin adapter: it may not gain policy, a counter, or a new
  decision the runtime owns.
- Any template change must keep the block copy-pasteable verbatim into another
  host's prompt, with no leading indentation a paste would carry in.
- `npm run typecheck` / `npm run build` clean; `npm test` no new failure.

## Decisions

To be decided by the planner round:

- **D1 — where defect 1 is fixed.** Three candidates, and the round must say
  why the two it rejects are wrong: add `Act as implementer.` (or the artifact's
  recorded role) to the `review_changes_requested` template; widen step 2 so the
  helper also runs when the role is `none stated` but the artifact records one;
  or relax step 1 so a missing role is read from the artifact. The first keeps
  step 1 intact and is the smallest change; the second and third both move the
  skill closer to reading policy it is not supposed to read.
- **D2 — which role the template should name**, given that a correction round's
  artifact may record `implementer` or `planner`, and the block is written
  before that value is known to the reader.
- **D3 — the marker format.** Whether step 7's shapes adopt the `agent-scripts`
  markers, and whether the other five fenced blocks in the file (steps 1, 4 and
  the invocation examples) are in scope or deliberately left as documentation
  rather than handover.
- **D4 — how the convention stays in agreement.** Whether
  `tests/spbridge-skill.test.ts` pins the marker strings, so a later edit that
  reverts to a fence fails a test rather than reaching an operator.

## Acceptance Criteria

To be derived from the pinned decisions, last. At minimum: a
`review_changes_requested` round entered from the printed block reports a role
and runs the policy helper, and every step 7 block a human is meant to paste
carries both markers.

## Work Completed

- 2026-09-05 (human-operator, Claude Code, claude-opus-5): queued after both
  defects were observed the same day — defect 1 on the `0001` correction round
  in the anonymized consumer repository, defect 2 on this session's own handover blocks.
  The operator judged it critical because the suppressed check is silent.

## Evidence

- `agent-skill/skills/spbridge/SKILL.md:107` — "Then, when the paste's `Act as
  <role>` is `planner` or `implementer`, run `spartan-bridge policy ...`".
- Step 1 of the same file — write `role none stated` when the paste omits one;
  do not infer a role from the host; do not open the artifact to fill it in.
- `SKILL.md:424`, `:442` — the two `review_passed` prompt bodies, both
  beginning `Act as <artifact next_role>.`
- `SKILL.md:474` — the `producer_declaration_invalid` body, beginning `Act as
  implementer.`
- The `review_changes_requested` shape — two lines, no `Act as` sentence; the
  only step 7 shape without one.
- Transcript, `0001` round, 2026-09-05: `Round: ... — handoff none stated —
  acting as role none stated`, then "The paste states no role, so the policy
  helper is skipped."
- `src/policy/bridge-config.ts:13` — `MODEL_BINDING_MODES = ["advisory",
  "warn", "strict"]`; `:144` the parse that accepts all three.
- `<local-tooling>/AGENTS.md`, "Commands the human runs" and
  "Prompts the human runs" — the two marker blocks, the explanation-before rule,
  and the stated reason a prompt needs a closing marker.
- `agent-skill/skills/spbridge/SKILL.md` — thirteen ` ```text ` fences, eight of
  them in step 7.
- `tests/spbridge-skill.test.ts` — 322 lines; the existing pins on step 4 and
  step 7 wording.

## Review

Verdict: PENDING

Findings:

- None recorded.

## Blockers

None. Independent of tasks `0053`, `0073` and `0074`.

## Next Action

A planner round through `/spbridge`: pin D1 through D4, verify every quoted line
against this checkout, derive the acceptance criteria from the pinned decisions
last, then let the Bridge dispatch the plan review.

## Next Handoff

```text
Recommended execution (human decides):
- Host: Claude Code (AGENTS.md binds planner to Claude Code; fresh session)
- Model and effort: claude-opus-5 at effort high
- Role: planner
- Handoff: HX-001
- Permission: writable
- Invocation: /spbridge, passing the prompt block below as the argument
```

```text
Open `spartan/tasks/0075-the-skill-templates-contradict-their-own-preconditions.md` (handoff HX-001).

Act as planner. Refine this plan against `agent-skill/skills/spbridge/SKILL.md` in full — steps 1, 2 and 7 especially — `tests/spbridge-skill.test.ts`, `src/policy/bridge-config.ts` (the three model binding modes), and `<local-tooling>/AGENTS.md` (the two handover marker conventions and their stated reason).

Pin D1 by weighing the three candidates in the artifact and saying explicitly why the two you reject are wrong; the skill's thin-adapter boundary is the constraint that should decide it. Pin D2 knowing that a correction round's recorded role is not visible to the reader of the printed block. Pin D3, deciding whether the five fenced blocks outside step 7 are handover or documentation. Pin D4 so a later edit cannot silently revert either fix.

Verify every quoted line number and string against this checkout. Derive the acceptance criteria from the pinned decisions, last. Keep `## Review` as the `Verdict: PENDING` placeholder and `phase: planning`.

Then let the Bridge dispatch the plan review.
```
