# Fixture

## Agent hosts

| Binding | Host | Client context | Model | Effort |
| --- | --- | --- | --- | --- |
| planner | Codex | personal | gpt-5.6-terra | high |
| reviewer.plan | Cursor | personal | Composer-2.5 | none |
| implementer | Cursor | personal | Composer-2.5 | none |
| reviewer.implementation | Cursor | personal | Composer-2.5 | none |

This repository runs the Spartan Bridge. A producer round whose review the Bridge dispatches is
entered through `/spbridge`, and the handoff that precedes it is addressed to that producer rather
than to the reviewer. When the mapped `reviewer.plan` host has no working adapter, or the Bridge is
not installed here, the advisory names the host's own token instead.

## Spartan Bridge automation authority

- A human-started Spartan Bridge run may start the mapped reviewer automatically.
- The Bridge may return findings to the current planner session and repeat up to 3 plan-review cycles.
- The human starts each producer phase.

## Artifact authoring

- Write a plan's decisions first and its acceptance criteria last, deriving each criterion from a named decision. The one exception is a row that records only a repository check the round must run; everything else names its decision.
- When a decision changes, re-derive every criterion that touches it instead of editing the one a finding named. A criterion is a consequence of a decision, so editing it in place preserves what the old decision implied.
- State an invariant positively: what stays the same, and the complete list of what changes. A closed claim such as "the only difference is X" is where an undercount hides.
- Before requesting review, read the criteria against the decisions as a set.
- An Evidence row reproduces the input that produced it, or names the file holding it, so a later reader can re-run it. Describing an input in place of quoting it is how an acceptance criterion gets written from a case that already passes.
- A task file created for later work leaves its author with a complete handoff envelope: `next_handoff_id`, the advisory `- Handoff:`, and the prompt's `(handoff HX-NNN)`, all agreeing. Queued is not a reason to omit it; a queued task is the one most likely to be opened cold.
