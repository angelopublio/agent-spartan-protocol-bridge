---
protocol: "1.0.0" # x-release-please-version
id: describe-the-loop-the-readme-still-hides
created_at: 2026-08-19
status: completed
phase: complete
task_type: implementation
risk: routine
current_role: implementer
next_role: none
updated_at: 2026-08-23
handoff_id: HX-008
next_handoff_id: none
---

# Describe the loop the README still hides

## Objective

Someone reading `README.md` learns that a plan review can continue into the next producer round and
where that stops, instead of a single-cycle command surface the runtime has outgrown.

## Context

Task `0020` shipped `--after-run`, a counted chain of up to `max_review_cycles`, two new stop
conditions, and a `/spbridge` that loops in one session. `README.md` was out of its Scope and no
acceptance criterion covered it, so the file still documents the runtime as it was before that work.

Two blocks are wrong rather than merely incomplete:

- the shipped-commands block lists `review --repo <path> --task <path>` with no `--after-run`, and
  omits the transition inspection commands that `HELP_TEXT` already ships;
- the "How a host reaches the Bridge" flow ends at "The skill prints the next invocation", which is
  now true only when the loop stops — after a `changes_requested` with cycles remaining, the skill
  continues instead of printing anything.

A third block is missing: what an operator does when a cycle returns no verdict. Task `0031` now
ships the CLI recovery line; this task documents that shipped surface in the README. Task `0022`
(adoption section) is completed, so that section stays untouched.

Inside this repository, `/spbridge` is also discoverable from the project's own `skills/spbridge/`
and `agent-skill/skills/spbridge/` trees. The README install path into `~/.agents/skills` remains
what an adopting repository needs; the file should not imply this checkout depends on that link alone.

## Scope

- `README.md`, limited to these four surfaces:
  1. the shipped-commands block;
  2. the stderr status-line paragraph if it still implies a single-cycle run;
  3. the "How a host reaches the Bridge" flow (continuation, stops, and null-verdict recovery);
  4. at most one clarifying sentence in the existing portable-skill discovery paragraph.
- This task artifact.

## Out of Scope

- The adoption section of `README.md` (task `0022`, completed).
- `docs/ROUTING-AND-WORKFLOWS.md` and `docs/DECISIONS.md`.
- Any behaviour change. Runtime recovery wording already shipped in task `0031`.
- The `runs` listing and unrelated README sections.

## Constraints

- Every statement is checked against `src/` (and the shipped CLI recovery helpers), not only against
  older task prose.
- No credential, launcher command, absolute path, or machine-specific detail enters the file.
- The phase banner and adapter claims stay accurate for the hosts that currently ship.

## Decisions

### D1 - Document the build, not the plan

Every statement added is checked against `src/`. The shipped-commands block lists every `Usage:`
command line from `HELP_TEXT` in `src/cli/parse.ts` with the same tokens — including
`review` with optional `--after-run`, `status`, `events`, `transition-status`,
`transition-events`, `doctor`, and `mcp-stdio` — and invents no command the CLI rejects.

### D2 - Name the edit surfaces and leave the rest of the file alone

This task may edit only:

1. the shipped-commands block;
2. the related stderr paragraph when it still implies a single-cycle run;
3. the "How a host reaches the Bridge" flow; and
4. at most one clarifying sentence inside the existing portable-skill discovery paragraph near the
   top of the README (the paragraph that already names `agent-skill/skills/spbridge`), never the
   adoption section.

The adoption section stays byte-identical. No other README section changes.

### D3 - The flow shows continuation and the stops

The flow names both outcomes after a review: continuation within the cycle limit after
`changes_requested`, and a stop that reports the human's next invocation. Stop conditions named in
the flow use the status-document spellings `review_passed`, `cycle_limit_reached`, and
`chain_refused`. The cycle limit bounds one `--after-run` chain, not an unchained task lifetime
(D-020).

### D4 - Document recovery after a null-verdict failed cycle

A failed plan-review continuation with `verdict: null` cannot be the next `--after-run` reference
(`resolveReviewChain` refuses non-`changes_requested` parents). Retrying the last
`changes_requested` parent reuses that parent's derived child cycle, so the failed attempt does not
consume the limit. Task `0031` prints that instruction on stderr when eligible; the README states
those facts and points operators at that CLI line rather than inventing a second procedure.

### D5 - Distinguish this checkout's skill discovery from adopting installs

Inside the D2-allowed portable-skill paragraph only, state that this checkout can discover
`spbridge` from its own skill trees while the documented `~/.agents/skills` / `~/.claude/skills`
install remains the adopting-repository path. The adoption section stays untouched.

## Work Completed

- Implementer (Grok, grok-4.5, high), 2026-08-23: after Bridge plan pass and automatic producer
  failure (`producer_failure` / exit_nonzero), applied the README edits on the four D2 surfaces —
  HELP_TEXT-aligned shipped commands including `--after-run` and transition commands; stderr
  recovery paragraph for null-verdict failures; host-reaches flow with continuation/stops/recovery;
  one checkout-vs-adopting skill-discovery sentence. Adoption section unchanged. Automatic
  implementer transition `transition-f4309226-7092-4f9b-bbc0-da97d8bf6624` stopped before product
  edits; this same-session implementer finished the approved plan. After implementation-review
  findings, added the missing `--help` Usage line, corrected the stop-path `/spbridge`
  wording to match the skill, and refreshed Evidence.


- Planner (Claude Code, claude-opus-5, effort high, Anthropic): created this task from the completion
  notice and implementation review of task `0020`. No product file was edited.
- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20: added D4 and its criterion
  after operating the chain on task `0029` through a failed cycle. No product file was edited.
- Planner (Grok, grok-4.5, high), 2026-08-23: revalidated decisions against current `HELP_TEXT`,
  `resolveReviewChain`, and task `0031`'s shipped recovery line; recorded that task `0022` completed;
  re-derived D4/D5 and acceptance criteria; advanced the envelope for Bridge plan review. After plan-review findings, re-derived D1 to
  require every HELP_TEXT Usage line (including transition commands), closed D2/D5 so the
  skill-discovery note lands only in the existing portable-skill paragraph, and re-issued review.

## Evidence

- Compared every `Usage:` line in `src/cli/parse.ts` `HELP_TEXT` to the README shipped-commands
  block after the edit; all eight lines are present with matching tokens, including
  `spartan-bridge --help` and `review ... [--after-run <run-id>]`.
- `git diff -- README.md` touches only the portable-skill paragraph, shipped-commands block,
  stderr paragraph, and "How a host reaches the Bridge" flow; adoption section hash unchanged
  vs pre-edit snapshot.
- `src/core/review.ts`: `parent.verdict !== "changes_requested"` → `verdict_not_chainable`;
  `cycle = parent.cycle + 1`.
- `src/cli/main.ts`: `formatPlanReviewRecoveryLine` emits the recovery line documented in README.
- Repository checks, 2026-08-23: `npm run typecheck` exited 0; `npm test` exited 0 with all
  `tests/*.test.ts` suites passing.
- Plan review `run-b0980f4d-e4e4-4e13-b3d9-91475df11d0e` passed; automatic producer
  `transition-f4309226-7092-4f9b-bbc0-da97d8bf6624` stopped `producer_failure`.
- Task `0031` and `0022` are `completed` on `main`.


## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-b0980f4d-e4e4-4e13-b3d9-91475df11d0e execution_id=exec-2a3681ed-4118-4f8e-981a-2d07dd289cf1 review_kind=plan verdict=pass reason_code=review_passed host=grok launcher=grok-plan-reviewer-v1 model=grok-4.5 effort=high model_observed=declared_unobserved policy_digest=sha256:bd8320f1e4119cb68aac27f31b7904f6290842a8b8e5b4b22ce0b8437cecc140 task_hash=sha256:9420925fe7e76ede933775fb767681be135b0522348472308980a7d452f5138e agents_hash=sha256:34a05624b8de1c1eb73989b6478e3d4c3f21618320d3d4ce833ac808965d3ab9 timestamp=2026-08-23T14:40:14.782Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-533b7be1-b012-4955-877c-07ea12f7f24a execution_id=exec-fa563cf8-e46e-4e2b-a763-b5600a3bc8a0 review_kind=implementation verdict=pass reason_code=review_passed host=grok launcher=grok-plan-reviewer-v1 model=grok-4.5 effort=high model_observed=declared_unobserved policy_digest=sha256:d690b4307d9d8413f4be8daf675a265e5318b5e18c29837967b091ebb339ae77 task_hash=sha256:74a7c463e063ccef33fefe9b33bf7b99e6ca281a6bd4c476d4ff0197c3e71ba4 agents_hash=sha256:34a05624b8de1c1eb73989b6478e3d4c3f21618320d3d4ce833ac808965d3ab9 timestamp=2026-08-23T17:18:55.607Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None.

## Next Action

None. Task completed: README documents the plan-review loop, stops, and null-verdict recovery.


## Acceptance Criteria

- [x] D1: Every `Usage:` command line from `HELP_TEXT` appears in the shipped-commands block with
      matching tokens (including `review` with `[--after-run <run-id>]` and the transition
      commands), asserted by comparing the HELP_TEXT usage lines to the README block.
- [x] D2: Diff touches only the four D2 surfaces; the adoption section is byte-identical.
- [x] D3: The flow shows continuation within the cycle limit and a stop that prints the human's next
      invocation; named stop conditions use `review_passed`, `cycle_limit_reached`, and
      `chain_refused`; the README states the cycle limit bounds one chain.
- [x] D4: The flow (or adjacent stderr paragraph) states that a null-verdict failed cycle cannot be
      the `--after-run` reference, that retry uses the last `changes_requested` parent, that the
      failed attempt does not consume the limit, and that the CLI prints the `0031` recovery line when
      eligible — each checked against `src/core/review.ts` and `src/cli/main.ts`.
- [x] D5: The portable-skill paragraph carries the checkout-vs-adopting discovery distinction; the
      adoption section is untouched.
- [x] `npm run typecheck` and `npm test` exit 0.

## Next Handoff

No outstanding handoff. Task completed.
