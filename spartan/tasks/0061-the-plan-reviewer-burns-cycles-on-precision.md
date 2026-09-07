---
protocol: "1.1.0" # x-release-please-version
id: the-plan-reviewer-burns-cycles-on-precision
created_at: 2026-09-02
status: completed
phase: complete
task_type: planning
risk: material
current_role: human-operator
next_role: none
updated_at: 2026-09-02
handoff_id: none
next_handoff_id: none
---

# Plan-review chains reach the cycle limit on wording and consistency findings

Two related frictions observed under this repository's configured prompts:
plan-review chains that reach the cycle limit while resolving wording,
evidence, and consistency findings, and a `## Next Handoff` block shape that
takes repeated producer attempts to satisfy. These observations describe the
recorded Bridge runs, not the general quality of a host or model.

## Objective

A plan whose D-decisions are sound reaches `APPROVED` within the 3-cycle limit.
The plan reviewer blocks on substance (a decision that is wrong, contradictory,
or unimplementable) and on genuine internal contradiction, and it does **not**
send a plan back a third time for wording it would accept if the plan simply
said it one row earlier. A producer round that regenerates `## Next Handoff`
correctly on the first try is not the exception.

## Context

The records below cover four bridge/protocol tasks using the configured
`claude-plan-reviewer-v1` chain. Three exhausted the three-cycle limit and
required an owner override; bridge `0059` passed after two cycles:

| Task | Cycles | Every cycle's findings |
| --- | --- | --- |
| bridge `0055` | 3 → owner override | prose precision (`STALE_SCOPE_D7`, `DOCS_CRITERION_UNDERIVED`, `PATHS_UNVERIFIED` info) |
| protocol `0031` | 3 → owner override | AC self-consistency, "restate not relocate", placeholder-literal, legacy carve-out, verification-grep vocabulary |
| bridge `0058` | 3 → owner override | `TERMINAL_CLOSE_FRONTMATTER_KEYS` gating, D3 branch scoping, `## Next Handoff` retraction, `checkTerminalCloseShape` scoping, one stale Tests-row row |
| bridge `0059` | 2 → passed | close call — serialize-scope gap, schema compat, criterion tags |

The recorded findings improved the plans, including by identifying real
consistency and scope gaps. The maintainer observed that the configured
severity policy did not clearly separate wording improvements from defects
that would change implementation. This task addresses that prompt calibration
while retaining blocking review of wrong, contradictory, or unimplementable
decisions. It does not establish that the findings were all cosmetic.

Second friction, same sessions: the `/spartan` producer round repeatedly hits
`composition_failed` / `next_handoff_not_retractable` regenerating
`## Next Handoff` — trailing newline after the closing fence, a bare `HX-NNN`
in the prompt body (not the `(handoff HX-NNN)` parenthetical), fence count,
advisory/prompt block ordering. Task `0057` added the `detail` discriminant
which names *which* of the four `checkArtifactWriteShape` gates failed; it does
not name *which sub-rule* of `retractNextHandoffSection` rejected the section,
so the producer still guesses.

## Scope

- `src/adapters/claude.ts` (`CLAUDE_REVIEW_PROMPT`) / any shared reviewer prompt
  - Add explicit guidance to the plan-review prompt: block only on a decision
    that is wrong / contradictory / unimplementable, or a contradiction an
    implementer would actually resolve the wrong way; a wording improvement
    that does not change what gets built is at most `info` and never
    `CHANGES_REQUESTED` on its own; when the plan is implementable as written,
    return `APPROVED` even if it could be tightened.
  - Mirror into `src/adapters/grok.ts` / `codex.ts` review prompts for parity.
- `src/core/task-write.ts` (`retractNextHandoffSection` / the composition probe)
  - Split `next_handoff_not_retractable` into named sub-details (unfenced
    advisory, identifier mismatch, stray `HX-NNN` in body, fence count, block
    order, trailing-content) so `pre_dispatch_diagnostic` tells the producer
    exactly what to fix. Consider tolerating a single trailing newline after
    the closing fence (the most common miss) rather than rejecting it.
- `agent-skill/skills/spbridge/SKILL.md` (or the Spartan skill's handoff rules)
  - A short, literal "`## Next Handoff` block shape" checklist a producer round
    applies before dispatch — the four things that keep failing.
- `src/core/doctor.ts` (`wrapperLauncherWarnings`, added by `0057` D5)
  - The `HOME matches a cursor-home path while the reviewer host is Claude Code`
    warning fires on the pattern alone and is now noisy on every Cursor-session
    `/spbridge` run, even though `0057`'s `AGENT_PROFILES_REAL_HOME` forward +
    wrapper `HOME` restore already make that path safe (proven on `0031`,
    `0057`, `0059` impl reviews). Downgrade to `info`, or suppress entirely,
    when `AGENT_PROFILES_REAL_HOME` is set in the environment (the wrapper will
    restore the real `HOME` for the nested `claude` child). Keep the
    `resolve-profile`-path-missing warning unchanged.
- `docs/DECISIONS.md`
  - Record the reviewer-severity policy (substance vs wording) and the
    handoff-shape sub-details.
- Out of scope unless the plan decides otherwise: raising `max_review_cycles`,
  or a Bridge-side "owner override" command (the human already overrides by
  editing the artifact).
- Tests: `tests/claude-adapter.test.ts` (the prompt carries the severity
  guidance), `tests/task-write.test.ts` (each new `next_handoff` sub-detail;
  trailing-newline tolerance if adopted).

## Out of Scope

- The `producer_timeout` (`0059`) and stale-`dist` (`0060`) frictions.
- Changing the 3-cycle ceiling itself, or adding a Bridge override verb.
- The reviewer *model* choice — this is prompt / severity policy, not routing.
- Making the reviewer lenient on substance. A wrong decision still blocks.

## Constraints

- English artifact.
- The reviewer must still return `CHANGES_REQUESTED` for a real substance or
  contradiction defect; "be less pedantic" must not become "rubber-stamp."
- `reason_code` and verdict vocabulary unchanged.
- `npm run typecheck` / `npm run build` clean; `npm test` no new failure.

## Decisions

- **D1 (open) — the plan-review prompt gets an explicit severity rule:**
  substance and would-be-misbuilt contradiction → `CHANGES_REQUESTED`; wording
  that does not change the build → `info` at most; implementable-as-written →
  `APPROVED`.
- **D2 (open) — `next_handoff_not_retractable` splits into named sub-details**
  surfaced in `pre_dispatch_diagnostic`.
- **D3 (open) — tolerate one trailing newline after the closing fence** (or
  document why not).
- **D4 (open) — the `0057` D5 `cursor-home` doctor warning downgrades to `info`
  (or is suppressed) when `AGENT_PROFILES_REAL_HOME` is set.**

## Acceptance Criteria

- [ ] (D1) `CLAUDE_REVIEW_PROMPT` (and the Grok/Codex equivalents) contain the
      severity rule; a test asserts the text.
- [ ] (D1) A fixture plan that is implementable but has a tightenable wording
      row is reviewed `APPROVED` (or the finding is `info`), not
      `CHANGES_REQUESTED` — validated against a recorded reviewer transcript or
      a stubbed reviewer honouring the prompt.
- [ ] (D2) Each `## Next Handoff` rejection reason (unfenced advisory,
      identifier mismatch, stray body `HX-NNN`, fence count, block order,
      trailing content) yields a distinct `pre_dispatch_diagnostic`; a
      `tests/task-write.test.ts` case covers each.
- [ ] (D3) A `## Next Handoff` that differs from canonical only by one trailing
      newline is admitted (or the plan records the rejection is intentional and
      the diagnostic says "remove the blank line after the closing fence").
- [ ] (D4) `doctor` from a Cursor session with `AGENT_PROFILES_REAL_HOME` set
      does not emit the `cursor-home` / Claude-reviewer warning at `warning`
      severity; `tests/doctor.test.ts` covers set vs unset.
- [ ] `npm run typecheck` / `npm run build` clean; `npm test` adds no new
      failure.

## Work Completed

- 2026-09-02: task created after bridge `0058`'s plan review exhausted its
  3-cycle limit (`run-54d30469`, `human_required`) — the third exhausted chain
  in the four-task comparison above. Bridge `0059` passed after two cycles.
  The same sessions needed several producer attempts on `## Next Handoff`
  shape. This count and the scope of the observation were clarified for the
  public snapshot on 2026-09-06; the table's outcomes are unchanged.
- 2026-09-02: implemented directly (owner-approved out-of-band; friction task
  from the dogfooding loop, no `/spbridge` round). D1 — severity paragraph
  appended to `CLAUDE_REVIEW_PROMPT` / `GROK_REVIEW_PROMPT` / `CODEX_REVIEW_PROMPT`
  (plan only; implementation prompts untouched); prompt-content assertions in
  the three adapter tests + the hard-coded copy in `implementation-review.test.ts`.
  D2 — `parseOutstandingHandoffSection` now returns a closed
  `NextHandoffRejectSlug` union (12 slugs); `describeNextHandoffRejection`
  appends `[slug]` to the `next_handoff_not_retractable` `pre_dispatch_diagnostic`
  in `review.ts`; `CompositionFailedDetail` / `reason_code` unchanged.
  D3 — `trailing_content` slug carries an explicit "remove the blank line(s)
  after the closing fence" note; no silent byte normalisation near the write.
  D4 — `wrapperLauncherWarnings` keys the cursor-home warning on armed HOME
  restore (`homeRestoreArmed`), not on `AGENT_PROFILES_REAL_HOME` alone.
  D-060 + D-061 recorded. Evidence: `npm run typecheck` / `npm run build`
  exit 0; `npm test` 433/433 pass (+6). The SKILL `## Next Handoff` checklist
  from Scope was not added — the bracketed diagnostic now names the sub-rule
  directly, which is the substantive fix.

## Evidence

- `src/adapters/claude.ts` `CLAUDE_REVIEW_PROMPT` — the current plan-review
  instruction, with no severity guidance.
- `src/core/task-write.ts` `retractNextHandoffSection` and the
  `next_handoff_not_retractable` composition detail (added by `0057`).
- Bridge run ids: `0055` `run-c81a606b`; `0031` `run-739bd748` / `run-3e589588`
  / `run-a468e0d2`; `0058` `run-54d5a07d` / `run-cf3606af` / `run-fbe2d88a` /
  `run-7d39abca` / `run-54d30469`.
- Memory pattern `claude-reviewer-nitpicks-artifact-authoring`.

## Review

Verdict: APPROVED (owner sign-off — implemented directly, no Bridge plan review)

Findings:

- None recorded.

## Blockers

None. Independent of every other open task.

## Next Action

None. Implemented and shipped 2026-09-02; `npm test` 433/433. D-060 / D-061 recorded.

## Next Handoff

No outstanding handoff. The task is complete.
