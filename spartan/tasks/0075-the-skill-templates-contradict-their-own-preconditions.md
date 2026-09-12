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
updated_at: 2026-09-12
handoff_id: none
next_handoff_id: HX-001
---

# The `/spbridge` skill states preconditions its own steps do not make checkable

Publication note (2026-09-06): the command and prompt handover convention is now embedded in root `AGENTS.md`. The local-tooling paths and consumer-repository example below are historical placeholders. The skill-template and model-binding corrections described by this task remain pending.

Scope note (2026-09-12): a third defect was added to this task rather than queued
separately — step 2's stop condition at `:170`, with decision D5. It shares this
task's file, test file and decisions entry, and its planner round had not yet
run. The 2026-09-06 note above enumerates only the first two corrections and is
left as written.

## Objective

Every prompt block `agent-skill/skills/spbridge/SKILL.md` step 7 tells a host to
print satisfies the preconditions the same file states elsewhere, and is
delimited the way the operator's own handover convention requires. A round
started from a step 7 block runs the checks a round started by hand would run.
Every precondition the file tells a host to stop on names the test that decides
it, so a host cannot satisfy the instruction with a check that reports the
opposite of the truth.

## Context

Three defects in one file. The first two are in step 7's output shapes, both
observed on 2026-09-05. The third is in step 2's stop condition, observed on
2026-09-12.

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

### 3. Step 2's stop condition names no test, and the obvious one is wrong

`agent-skill/skills/spbridge/SKILL.md:170`, the last line of step 2, reads in
full:

```text
If the Spartan skill is not installed, stop and say so. Do not approximate it.
```

It states a stop condition and never says what decides it. A host that reaches
this line has to invent the test, and the obvious invention is a filesystem
search, which is wrong in both directions.

It is wrong downward because the documented install is a symbolic link. The
protocol package's own `docs/INSTALL-DEV.md` installs the skill by linking
`agent-skill/skills/spartan/` into `$HOME/.agents/skills/spartan`, and this
repository's profile isolation then links that path again into
`$CODEX_HOME/skills/spartan`, so under isolation the skill is two links from its
canonical folder. `rg --files` and `find` do not traverse a symlinked directory
without `-L`, so every such probe returns nothing while the skill is installed,
loaded, and working.

It is wrong upward because presence on disk does not mean the running session
has the skill. `docs/AUTHENTICATION-AND-SECURITY.md:311` already records the
opposite case: "An existing Codex TUI started before the wrapper mirrored the
skill will not see it until that process exits."

Observed on 2026-09-12 against
`spartan/tasks/0080-the-producer-copy-discards-only-this-repositorys-build-output.md`.
The mapped implementer round opened in Codex, reached step 2, and ran four
probes in sequence — `rg --files <skill homes> | rg '/spartan/SKILL\.md$'`,
`find <codex skill home> -maxdepth 3 -name SKILL.md`, a skills listing, and
`find <profile root> -path '*/spartan/SKILL.md'` — none of them following
symlinks. All four returned empty, which read as four independent confirmations
rather than one repeated blind spot. The round stopped before any producer work:
no file modified, no run created. The same paths resolve under `find -L`, and
`test -f "$CODEX_HOME/skills/spartan/SKILL.md"` — the form the protocol's own
install doc already prescribes — succeeds.

The cost is a spent operator turn and a stalled correction cycle, not a wrong
write. But the failure is silent and self-confirming, and it recurs on any
machine that follows the documented install, because that install is a symlink
by design.

## Scope

To be pinned by the planner round.

- `agent-skill/skills/spbridge/SKILL.md` — step 7's shapes, and whichever of
  step 1 or step 2 the D1 decision touches.
- `agent-skill/skills/spbridge/SKILL.md:170` — step 2's stop condition, per the
  D5 decision.
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
- The Agent Spartan Protocol package and its install documentation. Its
  `docs/INSTALL-DEV.md` already prescribes `test -f` against the linked path;
  nothing there is wrong and nothing there changes. Defect 3 is this skill
  failing to name a test, not the protocol failing to document one.
- The symlink install itself. It stays as documented; the fix is the deciding
  test the skill names, never a change to how the skill is installed.
- Task `0073`'s runtime diagnostics and the shared-`dist/` coupling.

## Constraints

- English artifact.
- The skill stays a thin adapter: it may not gain policy, a counter, or a new
  decision the runtime owns.
- Any template change must keep the block copy-pasteable verbatim into another
  host's prompt, with no leading indentation a paste would carry in.
- The deciding test D5 names must be one a host can apply with no shell command
  and no filesystem access, since the skill is read by hosts whose tool access
  varies. A diagnostic the human runs is separate from the test the host applies.
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
- **D5 — what decides step 2's stop condition.** `:170` states the condition and
  names no test, so the round must name one. The host's own skill listing is the
  candidate the file can rely on: the session either has the skill or it does
  not, and that is the fact the instruction is about. The filesystem is the
  candidate to reject, and the round must say why in both directions — it
  under-reports on the documented symlink install, and `:311` of
  `docs/AUTHENTICATION-AND-SECURITY.md` records it over-reporting for a process
  that started before the mirror. Two sub-questions the round decides rather
  than assumes: whether the sentence also carries a human-facing diagnostic
  (`test -f` against the linked path, or `find -L`) for the case where the skill
  really is absent, and whether the same "name the deciding test" treatment is
  owed to the file's other stop conditions — `:271` stops when the runtime is
  not installed and has the same shape.

## Acceptance Criteria

To be derived from the pinned decisions, last. At minimum: a
`review_changes_requested` round entered from the printed block reports a role
and runs the policy helper; every step 7 block a human is meant to paste carries
both markers; and a host following step 2 under the documented symlink install,
isolated or not, does not stop on `:170` while the skill is loaded.

## Work Completed

- 2026-09-05 (human-operator, Claude Code, claude-opus-5): queued after both
  defects were observed the same day — defect 1 on the `0001` correction round
  in the anonymized consumer repository, defect 2 on this session's own handover blocks.
  The operator judged it critical because the suppressed check is silent.
- 2026-09-12 (planner, Claude Code, claude-opus-5): widened to carry defect 3 and
  D5 after a mapped implementer round on `0080` stopped on `:170` against an
  installed skill. Added the defect-3 context, the `:170` scope line, three Out of
  Scope exclusions, D5, one constraint, the third acceptance criterion, the
  reproduction evidence, and the `0080` sequencing note; retitled to cover all
  three defects. No change to `agent-skill/`: the fix is D5's to pin. Still
  `phase: planning`, `## Review` still `Verdict: PENDING`.

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
- `agent-skill/skills/spbridge/SKILL.md:170` — "If the Spartan skill is not
  installed, stop and say so. Do not approximate it."; step 2 spans `:94` to
  `:171`, so this is its closing line. `:271` is the same shape for the runtime.
- `docs/AUTHENTICATION-AND-SECURITY.md:311` — "An existing Codex TUI started
  before the wrapper mirrored the skill will not see it until that process
  exits."
- Reproduced 2026-09-12 on this checkout. Against the two skill homes step 2's
  host searched, `rg --files <homes> | rg '/spartan/SKILL\.md$'` exits 1 with no
  output and `rg --files -L <homes> | rg '/spartan/SKILL\.md$'` prints both
  `.../.agents/skills/spartan/SKILL.md` and
  `.../<profile>/codex/skills/spartan/SKILL.md`. Likewise
  `find <home> -maxdepth 3 -name SKILL.md` prints nothing where `find -L <home>
  -maxdepth 3 -name SKILL.md` prints both. `test -f
  "$HOME/.agents/skills/spartan/SKILL.md"` succeeds.
- `agent-spartan-protocol` `docs/INSTALL-DEV.md` — installs by `ln -s` into
  `$HOME/.agents/skills` and `$HOME/.claude/skills`, and verifies with `test -f
  "$HOME/.agents/skills/spartan/SKILL.md"`. The protocol already prescribes the
  correct check; only this skill omits it.
- `.spartan-bridge/runs/run-87ea8190-.../status.json` — the implementation
  review the stopped round was meant to answer: `changes_requested`, cycle 1 of
  3, `task_write_state: written`, no `reviewer_write`, no `adapter_failure`. The
  stopped round left that state untouched.

## Review

Verdict: PENDING

Findings:

- None recorded.

## Blockers

None. Independent of tasks `0053`, `0073` and `0074`.

Sequencing, not a blocker: task `0080` has an open implementation-review cycle
(cycle 1 of 3, `changes_requested`) with its correction round still pending, and
its diff is already in the worktree. Land nothing from this task into
`agent-skill/` until `0080` closes, so the correction cycle's review sees only
`0080`'s own scope.

## Next Action

A planner round through `/spbridge`: pin D1 through D5, verify every quoted line
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

Act as planner. Refine this plan against `agent-skill/skills/spbridge/SKILL.md` in full — steps 1, 2 and 7 especially — `tests/spbridge-skill.test.ts`, `src/policy/bridge-config.ts` (the three model binding modes), `docs/AUTHENTICATION-AND-SECURITY.md` (the "User skills under isolation" section, and `:311` on a process that predates the mirror), and `<local-tooling>/AGENTS.md` (the two handover marker conventions and their stated reason).

Pin D1 by weighing the three candidates in the artifact and saying explicitly why the two you reject are wrong; the skill's thin-adapter boundary is the constraint that should decide it. Pin D2 knowing that a correction round's recorded role is not visible to the reader of the printed block. Pin D3, deciding whether the five fenced blocks outside step 7 are handover or documentation. Pin D4 so a later edit cannot silently revert either fix. Pin D5 by naming the one test that decides step 2's stop condition and saying why the filesystem is wrong in both directions; then decide its two sub-questions — whether the sentence also carries a human-facing diagnostic for a genuinely missing skill, and whether `:271` gets the same treatment.

Verify every quoted line number and string against this checkout. Derive the acceptance criteria from the pinned decisions, last. Keep `## Review` as the `Verdict: PENDING` placeholder and `phase: planning`.

Then let the Bridge dispatch the plan review.
```
