---
protocol: "1.1.0" # x-release-please-version
id: reconcile-config-yaml-docs-with-the-parser
created_at: 2026-08-30
status: completed
phase: done
task_type: implementation
risk: routine
current_role: human-operator
next_role: none
updated_at: 2026-08-30
handoff_id: HX-004
next_handoff_id: none
---

# Reconcile the `spartan-bridge/config.yaml` documentation with what the parser implements

## Objective

The documentation and `src/policy/bridge-config.ts` agree on what
`spartan-bridge/config.yaml` accepts. Either the parser grows the keys the docs
promise, or the docs move the unimplemented keys into a clearly-labelled
"planned, not yet parsed" note. A repository owner who copies a documented
example into their repo gets an accepted config, not `config_invalid`.

## Context

Discovered 2026-08-30 while enabling the plan-pass -> implementer auto-chain on
the `agent-spartan-protocol-board` repo.

`src/policy/bridge-config.ts` (`parseBridgeConfigYaml`) is strict and narrow:
the only accepted document has exactly the two top-level keys `schema_version`
and `transitions`, exactly one transition `review_plan_pass`, and exactly the
two entry keys `successor` and `dispatch`. Anything else is `config_invalid`.
The only consumer of `loadBridgeConfig` is `src/core/transition.ts`
(`continueAfterPlanReview`), which reads only `config.dispatch`.

`grep -rn "config\.yaml" README.md docs/*.md` (2026-08-30) returns exactly 17
matching lines, all prose — no code-block or YAML-example line contains the
literal string (the already-corrected ROUTING example uses `config.yaml` only in
a prose sentence, counted below). The 17 partition into three buckets:

**A. Inaccurate — describe an unimplemented broader schema (4, all edited by D2):**

- `docs/ROUTING-AND-WORKFLOWS.md:42` table row: "Operational ceilings such as
  cycle limits, timeouts, gates, and storage".
- `README.md:383`: "may set stricter limits, timeouts, gates, and storage
  paths. It may narrow `AGENTS.md` authority, never broaden it."
- `docs/DECISIONS.md:31` (D-004): "stores limits, timeouts, gates, and runtime
  paths".
- `docs/ARCHITECTURE.md:75` resolver list item 3: "optional
  `spartan-bridge/config.yaml` narrows limits and operational settings".

**B. Roadmap, correctly future-tense — left as-is (1):**

- [historical document omitted] (historical line 119) deliverables list: "parser for optional
  `spartan-bridge/config.yaml` limits".

**C. Already accurate — opt-in transition only, no credentials, cannot broaden
`AGENTS.md`; no change (12):** `README.md:3`, `README.md:259`, `README.md:384`,
`docs/ARCHITECTURE.md:173`, `docs/AUTHENTICATION-AND-SECURITY.md:67`,
`docs/AUTHENTICATION-AND-SECURITY.md:391`, `docs/DECISIONS.md:69`,
[historical document omitted] (historical line 230), `docs/ROUTING-AND-WORKFLOWS.md:76`,
`docs/ROUTING-AND-WORKFLOWS.md:148`, `docs/ROUTING-AND-WORKFLOWS.md:223`,
`docs/ROUTING-AND-WORKFLOWS.md:249`.

4 + 1 + 12 = 17. The `docs/ROUTING-AND-WORKFLOWS.md` "Optional operational
config" YAML example was already corrected on 2026-08-30 (it showed `limits:`,
`storage:`, `next_role:`, `gate:`, and a second `review_implementation_pass:`
transition, none parsed).

Today cycle limits come from `AGENTS.md` (`max_review_cycles`,
`max_implementation_review_cycles` in `src/policy/agents-policy.ts`); timeouts
are adapter/runtime defaults; the run directory is a fixed `.spartan-bridge/`
path. None are configurable per repository.

## Scope

- Documentation only. No change to `src/policy/bridge-config.ts` or its one
  consumer `src/core/transition.ts` (see Decisions: D1 relabels every broader
  key as planned).
- Edit the four inaccurate sites so each either describes the parsed shape or
  sits under an explicit "planned, not yet parsed" note:
  - `README.md:383` (Configuration principles bullet).
  - `docs/ROUTING-AND-WORKFLOWS.md:42` (source-responsibility table row).
  - `docs/ARCHITECTURE.md:75` (resolver list item 3).
  - `docs/DECISIONS.md` D-004: annotate as aspirational / not-yet-parsed.
- Add one dated reconciliation entry to `docs/DECISIONS.md`.
- Run `npm run typecheck`, `npm test`, `npm run build`.

## Out of Scope

- Any change to `bridge-config.ts` or `transition.ts` (D1: nothing new is
  parsed this task).
- The `review_plan_pass` / `dispatch` opt-in itself (already implemented and
  documented correctly).
- Any change to how `AGENTS.md` cycle limits are parsed or applied.
- [historical document omitted] (historical line 119) — already future-tense roadmap copy; left
  as-is.
- The two pre-existing `tests/agents.test.ts` failures about the "Artifact
  authoring" rules block (unrelated to config.yaml; belongs to task 0022).
- The board repo (only consumes the file; its `config.yaml` is already the
  minimal valid shape).

## Constraints

- English artifact.
- The config file must never broaden `AGENTS.md` authority, hold credentials,
  or select providers `AGENTS.md` already defines — any implemented key
  preserves that.
- The strict-parser posture (reject unknown keys, anchors, aliases, merge
  keys, sensitive key names) is a security property; new keys extend the
  allowlist, they do not loosen the rejection of everything else.

## Decisions

**D1 — Relabel every broader-schema key as planned; implement nothing this
task.** The only consumer of `loadBridgeConfig` is
`src/core/transition.ts` (`continueAfterPlanReview`), which reads only
`config.dispatch`. `limits`, `timeouts`, `gates`, and `storage`/`run_directory`
have no consumer and no requested use case; cycle limits already come from
`AGENTS.md` (`max_review_cycles`, `max_implementation_review_cycles`). Adding a
key widens a strict allowlist that is a security property (Constraints), for no
caller. Owner default lean stands: no per-repo cycle limits now.

**D2 — Fix the four inaccurate prose sites** (README.md:383,
ROUTING-AND-WORKFLOWS.md:42, ARCHITECTURE.md:75, DECISIONS.md D-004). Each is
edited to describe only the parsed shape, with unimplemented keys moved under an
explicit "planned, not yet parsed" note. [historical document omitted] (historical line 119) is already
correct future-tense and is not touched.

**D3 — One dated reconciliation entry** is added to `docs/DECISIONS.md`; D-004
is annotated, not rewritten (it remains the record of the original aspiration).

### Per-key table (doc reference -> parsed today? -> decision)

| Doc reference | Key(s) described | Parsed today? | Decision |
| --- | --- | --- | --- |
| — (parser) | `schema_version` (must be `1`) | Yes | Keep; canonical shape |
| `ROUTING:249`, `README:259`, `DECISIONS:69` | `transitions.review_plan_pass.successor` (`implementer`) | Yes | Keep |
| `ROUTING:249`, `README:259`, `DECISIONS:69` | `transitions.review_plan_pass.dispatch` (`automatic`\|`manual`) | Yes | Keep |
| `README:383`, `DECISIONS:31`, `ROUTING:42`, `ARCHITECTURE:75` | `limits` / cycle limits | No | Relabel as planned (D1) |
| `README:383`, `DECISIONS:31`, `ROUTING:42` | `timeouts` | No | Relabel as planned (D1) |
| `README:383`, `DECISIONS:31`, `ROUTING:42` | `gates` | No | Relabel as planned (D1) |
| `README:383`, `DECISIONS:31`, `ROUTING:42` | `storage` / `run_directory` / "runtime paths" (fixed `.spartan-bridge/`) | No | Relabel as planned (D1) |
| `README:383`, `ARCHITECTURE:75`, `ROUTING:76`/`148` | "narrows / never broadens `AGENTS.md` authority" | No parsed key; it is a design constraint, not config input | Keep as a stated principle; make clear it is not a parsed key (D2) |
| [historical document omitted] (historical line 119) | "parser for optional config.yaml limits" | No | Leave — roadmap deliverable, already future-tense |

## Acceptance Criteria

Each item below is a consequence of the decision it names; the final item is the
repository-check exception and names no decision.

- [x] (D1) `git diff` touches no file under `src/` — nothing is newly parsed —
      and the per-key table above is unchanged from what review approved.
- [x] (D2) After the edits, the bucket-A sites (`README.md:383`,
      `docs/ROUTING-AND-WORKFLOWS.md:42`, `docs/ARCHITECTURE.md:75`,
      `docs/DECISIONS.md` D-004) each describe only the parsed shape
      (`schema_version` + `transitions.review_plan_pass.{successor, dispatch}`,
      no credentials, cannot broaden `AGENTS.md`), with `limits`/`timeouts`/
      `gates`/`storage` under an explicit "planned, not yet parsed" note. No
      bucket-B or bucket-C site (Context) is edited.
- [x] (D3) `docs/DECISIONS.md` carries exactly one new dated (2026-08-30) entry
      (D-049), and the existing D-004 gains a "not yet parsed as of 2026-08-30"
      Status annotation without rewriting its Decision/Rationale/Consequence
      text.
- [x] (check only) `npm run typecheck` and `npm run build` are clean; `npm test`
      shows exactly the two failures pre-existing on `24c16aa` (`declaration
      paragraph copies are identical and parse-invariant`, `Artifact authoring
      stays out of adoption, skill, and routing` — both from the `b535dbb`
      AGENTS.md "Artifact authoring" edit, tracked separately) and no new
      failure (382 pass).

## Work Completed

- 2026-08-30: corrected the one actively-misleading copy-pasteable YAML example
  in `docs/ROUTING-AND-WORKFLOWS.md` ("Optional operational config" section) to
  the parser's real shape, with a strict-parser note and a cross-reference to
  "Foreground automatic implementation transition".
- 2026-08-30 (planner, HX-001): full `grep` audit of every `config.yaml`
  reference; per-key table built and decision locked (D1-D3). Decision:
  documentation-only, relabel `limits`/`timeouts`/`gates`/`storage` as planned,
  no parser change. Checks run (see Evidence).
- 2026-08-30 (planner, HX-002 -> HX-003, cycle 1 CHANGES_REQUESTED): resolved
  all three findings — corrected the grep count to 17 with a full A/B/C bucket
  reconciliation (`GREP_AUDIT_INCOMPLETE`), relabelled the checks criterion as
  check-only and dropped the "in order" 1:1 claim (`AC_D4_NO_DECISION`), moved
  Acceptance Criteria to follow Decisions (`SECTION_ORDER`).
- 2026-08-30 (planner, HX-003 -> HX-004, cycle 2 CHANGES_REQUESTED): fixed the
  malformed envelope (`HANDOFF_INVOCATION_ROLE_MISMATCH`) — the continuation
  handoff is addressed to the planner (producer) and entered through `/spbridge`,
  which runs the producer round and lets the Bridge dispatch `reviewer.plan`;
  frontmatter `next_role` stays `reviewer`.
- 2026-08-30 (owner override + implementation, Claude Code / claude-sonnet-5):
  plan review reached cycle 3 of 3 (`run-7288fea7`), all three cycle-3 findings
  warning/info artifact-authoring (`PLANNER_HOST_BINDING_MISMATCH`,
  `ENVELOPE_ROLE_VS_NEXT_ROLE`, `PATHS_UNVERIFIED_IN_REVIEW`); the
  documentation-only decision D1-D3 was never challenged across three cycles.
  Owner overrode to implementation. Applied D2 to the four bucket-A sites:
  `README.md` Configuration-principles bullet, `docs/ROUTING-AND-WORKFLOWS.md:42`
  source table row, `docs/ARCHITECTURE.md` resolver list item 3, and a Status
  annotation on `docs/DECISIONS.md` D-004. Added `docs/DECISIONS.md` D-049.
  No `src/` change. `PLANNER_HOST_BINDING_MISMATCH` is moot — the successor is
  now `implementer` (bridge `AGENTS.md` binds it to Cursor), not a planner
  round. Paths re-verified with repo access (`PATHS_UNVERIFIED_IN_REVIEW`):
  every cited file and section exists.
- `npm run typecheck` clean, `npm run build` clean, `npm test` 382 pass / 2
  fail (the two pre-existing `tests/agents.test.ts` failures, see Evidence);
  `git diff --stat` touches no `src/` file.

## Evidence

- `src/policy/bridge-config.ts:66-94`: exactly `{schema_version, transitions}`,
  exactly `review_plan_pass`, exactly `{successor, dispatch}`;
  `dispatch in {automatic, manual}`, `successor === "implementer"`,
  `schema_version === 1`.
- `grep -rn "loadBridgeConfig\|BridgeConfig" src/ | grep -v test`: only
  `src/core/transition.ts` consumes it, and only `config.dispatch`.
- `grep -rn "config\.yaml" README.md docs/*.md` (2026-08-30): 17 matching
  lines, all prose — README 4 (L3, L259, L383, L384), ARCHITECTURE 2 (L75,
  L173), AUTHENTICATION-AND-SECURITY 2 (L67, L391), [historical document omitted] 2 (L119,
  L230), DECISIONS 2 (L31, L69), ROUTING-AND-WORKFLOWS 5 (L42, L76, L148, L223,
  L249). Full A/B/C partition in Context: 4 inaccurate (edit), 1 roadmap
  (leave), 12 already accurate. 4 + 1 + 12 = 17.
- `npm run typecheck`: clean. `npm run build`: clean.
- `npm test`: tests 384, pass 382, fail 2 (unchanged by this task's edits —
  same count with the working tree stashed). `declaration paragraph copies are
  identical and parse-invariant` and `Artifact authoring stays out of adoption,
  skill, and routing` (`tests/agents.test.ts`). Root cause: commit `b535dbb`
  added a bullet to the `AGENTS.md` "Artifact authoring" block, which those
  tests require to be byte-identical to the copy in task `0022` and structured
  as a fixed 6+1 rule set. Not config.yaml-related and out of this task's
  scope; tracked for a separate fix (revert the bullet or thread it through all
  synced copies + the test constants).

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: CHANGES_REQUESTED

Findings:

- `PLANNER_HOST_BINDING_MISMATCH` (warning): The `## Next Handoff` block states "Host: Claude Code (repository binds planner to Claude Code and dispatches reviewer.plan through the Bridge)" and "Model and effort: claude-sonnet-5, effort medium (fallback: latest Claude Sonnet)". AGENTS.md "Agent hosts" binds `planner` to Cursor / composer-2.5 / effort none, and binds only `reviewer.plan` to Claude Code / claude-sonnet-5 / medium. AGENTS.md states check results and repository policy are implementation truth and that the handoff must "Name the invocation the next round actually uses." This round is addressed to the planner (producer) per the /spbridge pattern, so the recommended host/model must match the planner binding (Cursor / composer-2.5), or the envelope must justify a deviation. As written the advisory would send the human to run the planner round on the wrong host with the wrong model. Correct the Host, Model and effort lines (and the parenthetical claim that the repo binds planner to Claude Code) to match the AGENTS.md planner binding.
- `ENVELOPE_ROLE_VS_NEXT_ROLE` (info): Frontmatter `next_role: reviewer`, but the `## Next Handoff` prompt says "Act as planner" and "keep next_role reviewer". The HX-003→HX-004 note explains this as the intended Bridge pattern (handoff addressed to the producer, entered via /spbridge, Bridge dispatches reviewer.plan), and AGENTS.md's "Spartan Bridge" paragraph supports addressing the producer. This is acceptable under that pattern, but it sits in tension with the AGENTS.md "Artifact authoring" rule that the advisory, the prompt's `Act as <role>`, and the identifier all match the frontmatter role. Consider adding a one-line pointer in `## Next Handoff` noting that the envelope is intentionally producer-addressed under the Bridge dispatch pattern so a cold reader does not read it as a malformed envelope.
- `PATHS_UNVERIFIED_IN_REVIEW` (info): AGENTS.md "Artifact authoring" requires every repository path a plan names to be confirmed to exist in the current checkout before the plan is written (README.md line targets, docs/ROUTING-AND-WORKFLOWS.md, docs/ARCHITECTURE.md, docs/DECISIONS.md, src/policy/bridge-config.ts, src/core/transition.ts, src/policy/agents-policy.ts, tests/agents.test.ts). This review was restricted to task.md and AGENTS.md, so those paths and line numbers could not be independently confirmed. The plan's Evidence section cites greps and line ranges; a writable round or reviewer with repo access should re-run them before persisting.

Bridge run: run_id=run-7288fea7-3fc7-4c6c-bd7e-7205f57e3c6a execution_id=exec-646aafe5-83d0-4880-bc19-15ecdc1027b9 review_kind=plan verdict=changes_requested reason_code=review_changes_requested host=claude launcher=claude-plan-reviewer-v1 model=claude-sonnet-5 effort=medium model_observed=declared_unobserved policy_digest=sha256:20fcfa7c8df758f5b260cdddb5dfbf86c1d202fcecff22e1ed15e24e6cabf2e0 task_hash=sha256:43b4ec380e9a0c7c745d91ab66e462ce287dade7ef131aab4a3aedab4352d322 agents_hash=sha256:e7a4562a59df9b2c7a7c5d09858802881ad8cb9527826651688da92a911c646e timestamp=2026-08-30T19:20:46.040Z
<!-- spartan-bridge:review:plan:end -->

## Blockers

None.

## Next Action

None. Task completed 2026-08-30. Plan reached the 3-cycle plan-review limit with
all cycle-3 findings warning/info artifact-authoring and the documentation-only
decision (D1-D3) never challenged; owner overrode to implementation. The four
bucket-A doc sites now describe only the parsed opt-in with the broader keys
marked planned; `docs/DECISIONS.md` carries D-049 and a D-004 Status
annotation; no `src/` change. typecheck / build clean; `npm test` 382 pass /
2 fail (the pre-existing `b535dbb` `tests/agents.test.ts` failures, tracked
separately).

## Next Handoff

No outstanding handoff. The task is complete.
