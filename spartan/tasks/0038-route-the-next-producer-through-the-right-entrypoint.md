---
protocol: "1.0.0" # x-release-please-version
id: route-the-next-producer-through-the-right-entrypoint
created_at: 2026-08-22
status: completed
phase: complete
task_type: implementation
risk: high-impact
current_role: human-operator
next_role: none
updated_at: 2026-08-22
handoff_id: HX-009
next_handoff_id: none
---

# Route the next producer through the right entrypoint

## Objective

Make the portable `spbridge` skill recommend the entrypoint that the next human-started producer
round actually needs after a passing review. A mapped planner or implementer whose later reviewer
is available through the Bridge must be opened through `/spbridge`, not through a manual `/spartan`
round that strands that review outside the Bridge.

## Context

Task `0025` exposed a contradiction in the installed skill. Its entry contract says both planner
and implementer producer rounds whose reviews the Bridge dispatches enter through the skill, while
step 7 maps every `review_passed` outcome to the next host's Spartan token. After the implementation
round for `0025`, that generic mapping told the human to open Codex with `$spartan` even though the
repository binding and runtime support required `/spbridge` for the next implementation-review
chain.

The runtime behaved correctly: it reviewed the finished implementation and stopped with
`review_passed`. The defect is in the outer skill's recommendation and in a test that asserts the
two conflicting sentences independently. It is not a runtime transition defect and does not require
a change to `AGENTS.md`.

This is also distinct from the future planner-to-implementer automation described in
`docs/ROUTING-AND-WORKFLOWS.md` and Phase 5 of [historical document omitted]. No active Spartan task
implements that transition. Repository policy still requires the human to open the implementer in a
fresh session and forbids the Bridge from starting it or crossing the producer role/host boundary.

## Scope

- `agent-skill/skills/spbridge/SKILL.md`: replace the universal `review_passed` recommendation with
  a closed routing decision for a Bridge-backed implementer, a manual fallback, a human operator,
  and genuinely manual agent rounds.
- `tests/spbridge-skill.test.ts`: make one regression test evaluate the routing cases together and
  reject the contradictory universal mapping.
- `src/core/doctor.ts`: add binding-relative adapter availability for `reviewer.plan` and
  `reviewer.implementation` by joining the already parsed policy binding to the already loaded
  registry and launcher catalog.
- `tests/doctor.test.ts` and `tests/cli.test.ts`: pin the additive structured/text contract, failure
  cases, non-secret boundary, and unchanged command exit semantics.
- The installed shared skill link used by Codex and Cursor: refresh it with the repository installer
  and verify it resolves to the canonical source. A new host session is required to reload skill
  instructions already read into a conversation.
- The active-task sequence: record `0039` for automatic planner-to-implementer transition immediately
  after this task and ahead of `0031`, `0026`, `0027`, and `0030`; do not create or modify those
  separate task artifacts inside this boundary.

## Out of Scope

- Starting an implementer automatically after plan approval.
- Adding the Phase 5 daemon, producer dispatch, worktree writer lock, crash recovery, or approved-plan
  hash gate.
- Changing runtime transitions, adapter implementations, `AGENTS.md`, or repository host bindings.
- Semantically inspecting producer edits or treating `doctor` as proof that repository checks passed.
- Installing the optional Codex plugin when it is not already installed, publishing a plugin, or
  changing marketplace metadata solely to invalidate a cache.
- Resolving the broader failed-chain recovery interface owned by task `0031`.

## Constraints

- The runtime remains the policy and capability authority. The skill may use only the artifact's
  recorded next role and the repository binding for that recorded role to form the post-stop
  recommendation. When that role is planner or implementer, it may additionally use the
  corresponding binding-relative `doctor` result defined by D6. `doctor`, not the skill, reads and
  resolves the future reviewer binding.
- A recommendation never starts an agent. The human decides and opens the fresh producer session.
- A fresh producer phase starts a new review chain and therefore carries no `--after-run`; that flag
  remains exclusive to another review cycle in the same producer phase.
- The manual Spartan handoff remains usable when the Bridge or the required future reviewer adapter
  is unavailable.
- Product behavior, task state, host bindings, and install state must not be inferred from a host
  name alone.

## Decisions

### D1 - `review_passed` selects from a closed next-entrypoint matrix

After the outer loop receives `review_passed`, it reads the artifact's written `next_role` and the
repository bindings, then applies these cases as a set:

| Recorded next state | Capability evidence | Recommendation |
| --- | --- | --- |
| `next_role: implementer` with an `implementer` binding | `doctor` reports `adapter available` for `reviewer.implementation` | Open the `implementer` binding's host with `/spbridge` in a fresh session |
| `next_role: implementer` with an `implementer` binding | That exact `doctor` result is unavailable, missing, or unreadable | Open the `implementer` binding's host with its Spartan token and state that the later implementation review is manual |
| `next_role: implementer` without an `implementer` binding | No producer host can be selected without inference | Report the missing binding and print no agent invocation |
| `next_role: planner` with a `planner` binding | `doctor` reports `adapter available` for `reviewer.plan` | Open the `planner` binding's host with `/spbridge` in a fresh session |
| `next_role: planner` with a `planner` binding | That exact `doctor` result is unavailable, missing, or unreadable | Open the `planner` binding's host with its Spartan token and state that the later plan review is manual |
| `next_role: planner` without a `planner` binding | No producer host can be selected without inference | Report the missing binding and print no agent invocation |
| `next_role: human-operator`, `next_role: none`, or no readable next role | No agent binding is applicable | Report the terminal/human outcome and print no agent invocation |
| Any other readable next role with an `AGENTS.md` binding | The role is neither a Bridge-backed producer case nor a terminal/human state | Open that binding's host with its Spartan token and identify the round as manual |
| Any other readable next role without an `AGENTS.md` binding | No host can be selected without inference | Report the missing binding and print no agent invocation |

The matrix replaces, rather than supplements, the universal
`review_passed -> /spartan or $spartan` rule. Host-token syntax remains a presentation detail after
the case has selected a manual round; a host name never proves Bridge capability.

The binding-relative signal is D6's additive runtime contract. The skill consumes its final
`adapter available` or `adapter unavailable` result and does not reconstruct the registry join,
inspect individual capability flags, or pin a launcher id from the host name. Missing or ambiguous
evidence takes the manual fallback.

### D2 - `/spbridge` begins a human-started producer phase, not an automatic role transition

The successful-plan recommendation names `/spbridge`, but the skill does not invoke another agent,
host, or model. The human opens the mapped implementer in a fresh session. That new invocation is the
first producer round of a new chain and omits `--after-run`. The Bridge may later dispatch
`reviewer.implementation` only after the implementer records the finished implementation state that
repository policy already requires.

This preserves the current prohibition on automatic planner-to-implementer dispatch. Implementing
that future transition would require a separate task that first settles the explicit repository
grant, operational opt-in, unchanged approved-plan hash, exclusive writer lock, daemon lifecycle,
and adapter enforcement described by Phase 5.

### D3 - The regression test asserts the decision, not disconnected phrases

The skill will present the post-pass cases in one parseable Markdown decision table. The test
extracts that table and compares its normalized rows with the nine D1 outcomes. It separately
rejects language that sends every `review_passed` result to a Spartan token and pins both boundaries
from D2: the human starts the fresh session and the new producer phase does not reuse
`--after-run`.

Existing tests for the inner review-cycle continuation remain unchanged in meaning. They continue
to require `--after-run` only after `review_changes_requested` within the same chain.

The skill runs `spartan-bridge doctor --repo <workspace-root>` after a recorded pass only when the
next role is a planner or implementer. This is a non-mutating capability check, not a review spawn
or continuation, and never carries `--after-run`.

### D4 - Refresh installed discovery without inventing a second source

`agent-skill/skills/spbridge/SKILL.md` remains the only content source. The implementation reruns
`./agent-skill/scripts/manage-install.sh install all` so the shared user-skill discovery link used by
the supported hosts is present and points at that source, then verifies the resolved link and the
installed text. Because the source is linked rather than copied, no content cachebuster belongs in
the repository.

`codex plugin list` currently reports `spbridge@spartan-bridge` as not installed, so this task does
not install it or change `agent-skill/.codex-plugin/plugin.json`. Codex and Cursor conversations that
already loaded the old skill must be replaced by fresh sessions after installation; relinking cannot
rewrite instructions already present in a live context.

### D5 - Fix routing before the explicitly authorized automatic-transition task

This task precedes all four active planning artifacts because its faulty recommendation affects how
their producer phases are entered. After `0038` is completed, committed, and pushed, the human has
explicitly requested a new task `0039` for automatic planner-to-implementer transition. It is created
and planned before the older backlog because it changes the producer handoff that those tasks would
otherwise exercise.

Task `0031` follows `0039` because its failed-chain recovery surface may touch the same skill and
runtime transition policy. Task `0026` follows to document the loop and recovery behavior after
`0031` settles it. Tasks `0027` and `0030` are independent payload-log and timestamp/quiet-line work
and follow without an ordering constraint between them. D5 authorizes only creating and planning
`0039` after this boundary; its implementation remains subject to its own approved decisions,
criteria, reviews, and explicit commit/push boundary.

### D6 - `doctor` owns the binding-to-adapter join

`DoctorReport` gains one additive result for each reviewer binding: `reviewer.plan` and
`reviewer.implementation`. For each, `doctor` takes the binding already returned by
`parseAgentsPolicy`, resolves that binding's `(client_context, host)` through the already loaded
registry, resolves that launcher through the catalog, validates the adapter's existing capability
contract for the required review kind and read-only/fresh-context constraints, and runs the same
non-secret preflight already authorized for official-client interface availability.

The formatted success line is:

```text
binding <reviewer.plan or reviewer.implementation>: adapter available; launcher=<launcher-id>
```

An unprovable join is explicit and closed:

```text
binding <reviewer.plan or reviewer.implementation>: adapter unavailable; reason=<stable-reason>
```

The stable reasons distinguish `policy_unavailable`, `binding_missing`, `registry_unavailable`,
`registry_invalid`, `client_context_unavailable`, `launcher_unavailable`, `capability_denied`, and
`interface_unavailable`. No line reports authentication, account identity, entitlements, network
success, or that a reviewer session is "ready". `adapter available` means only that the repository
binding resolves to a locally available adapter whose declared capabilities admit the required
read-only review kind and whose existing preflight succeeds.

The existing repository, policy, registry, launcher, fake-interface, Cursor-interface, and
Codex-interface lines remain byte-for-byte compatible and in their current order; the two binding
lines append after them. `doctorExitCode` retains its current semantics so this diagnostic addition
does not turn registry or adapter availability into a new command-level failure. The skill reads the
binding line rather than treating exit 0 as readiness.

## Acceptance Criteria

- [x] D1: after `review_passed`, the skill's single routing matrix recommends `/spbridge` for a
      human-started implementer only when a matching `implementer` binding exists and `doctor`
      reports `adapter available` for `reviewer.implementation`, and symmetrically recommends
      `/spbridge` for a planner only when a matching `planner` binding exists and `doctor` reports
      `adapter available` for `reviewer.plan`; missing or ambiguous producer binding or reviewer
      availability selects the applicable no-invocation or manual fallback and never infers the
      reviewer from the producer host.
- [x] D1: a missing `implementer` or `planner` binding produces no invocation instead of attempting
      to select a host; all nine matrix rows are mutually exclusive, and neither producer case can
      fall through to the generic mapped-role rows.
- [x] D1: `next_role: human-operator`, `none`, or unreadable produces no agent invocation; any other
      readable mapped agent role retains its host Spartan token and is identified as manual; an
      unmapped role produces no invocation; and no universal `review_passed -> Spartan` rule survives
      elsewhere in the skill.
- [x] D1: every row is decidable only from the recorded next role and its matching repository
      binding, plus D6's binding-relative result for planner or implementer; the skill does not read
      another binding or reconstruct policy, registry, launcher, or capability resolution.
- [x] D2: the recommendation says the human starts the implementer in a fresh session, the Bridge
      still does not start or cross into that producer role, and the new phase begins without
      `--after-run`.
- [x] D3: `tests/spbridge-skill.test.ts` extracts and compares all nine routing-table outcomes together,
      forbids the universal mapping, pins the human gate and fresh unchained phase, and preserves the
      existing same-chain continuation assertions; it also requires the post-pass binding-relative
      `doctor` check, requires missing/unreadable output to take the manual fallback, and forbids the
      skill from reconstructing the policy/registry join.
- [x] D4: the canonical skill is refreshed through `manage-install.sh install all`; the installed
      shared skill resolves to `agent-skill/skills/spbridge`, its bytes contain the new matrix, and
      the handoff tells users to open fresh Codex and Cursor sessions. The uninstalled optional Codex
      plugin and its manifest remain unchanged.
- [x] D5: the task artifact records the order
      `0038 -> 0039 (automatic planner-to-implementer) -> 0031 -> 0026 -> {0027, 0030}`; task `0039`
      is created only after `0038` is completed, committed, and pushed, and remains a separate
      reviewed boundary.
- [x] D6: `DoctorReport` and formatted output append results for `reviewer.plan` and
      `reviewer.implementation` that join the parsed binding, registry-selected launcher, catalog,
      required review-kind/read-only capabilities, and existing preflight without host-name
      inference.
- [x] D6: a binding result reports `adapter available` only when every join and capability step
      succeeds; otherwise it reports one stable non-secret reason from the closed set, including a
      missing optional implementation binding, and tests cover a registry mapping whose launcher id
      cannot be inferred from the host name.
- [x] D6: all existing `doctor` lines and `doctorExitCode` semantics remain compatible, the two new
      lines are additive, and neither output nor tests claim authentication, network, entitlement,
      repository-check, or end-to-end reviewer-session readiness.
- [x] Repository check: `git diff --check`, `npm run typecheck`, `npm run build`, and `npm test` exit
      0.

## Work Completed

- Inspected every active Spartan task and the documented automatic-transition roadmap.
- Confirmed there is no active task for automatic planner-to-implementer dispatch and placed this
  bounded routing correction ahead of the four active planning artifacts.
- Reproduced the contradictory skill/test contract and inspected current host discovery and optional
  plugin state without changing product or machine-local installation files.
- Incorporated both findings from the first Bridge review, closing the matrix over terminal and
  unmapped states and replacing the invented readiness phrase with the current `doctor` signals.
- Incorporated cycle 1 findings from the fresh review chain: made planner routing symmetric with
  implementer routing, separated missing producer bindings from capability fallback, and replaced
  the elided active-task evidence command with its complete input.
- Incorporated cycle 2 findings: made the successful Bridge rows require their producer bindings so
  all nine cases are disjoint, and removed the launcher-id assertion that the recorded evidence did
  not tie to `reviewer.implementation`.
- Incorporated the cycle 3 finding by adding the corresponding future reviewer binding to the
  skill's closed set of permitted post-verdict inputs and re-deriving the D1 criterion from both the
  producer and reviewer bindings.
- Requested the human-authorized Cursor Agent second opinion after the formal chain reached its
  limit. It confirmed that the current `doctor` output cannot associate a binding with the launcher
  and interface facts it prints, leaving D1 undecidable without a runtime signal or prohibited
  inference.
- Recorded the human's authorization to change the Bridge implementation and expanded the plan with
  D6's minimal binding-relative `doctor` result; no transition, adapter, policy, or authentication
  behavior is added.
- Incorporated the new chain's cycle 1 finding by reducing D1 to the artifact next role, its producer
  binding, and D6's single binding-relative availability result. The skill no longer reconstructs
  separate repository/runtime readiness signals.
- Incorporated cycle 2's input-set finding by permitting the binding for whichever next role the
  artifact records, while reserving D6's reviewer-adapter signal for planner and implementer cases.
- Completed two implementation-review cycles: fixed the reviewer's `CAPABILITY_THROW` finding by
  making capability evaluation fail closed, then received an implementation verdict of APPROVED.
- Re-ran the full required check set in the parent checkout after the approved review and finalized
  this task for the authorized task-boundary commit and push.
- Implemented D1-D6 in this Cursor implementer round (`cursor-grok-4.6`): binding-relative `doctor`
  results, the closed `review_passed` matrix, regression coverage, and the authorized installed-skill
  refresh. Did not create task `0039`.
- The pasted implementer prompt carried no handoff identifier while the artifact had
  `next_handoff_id: none`; this round proceeded under that empty proposal.
- Addressed `CAPABILITY_THROW` from implementation-review run
  `run-42948d74-bdc4-449f-8067-22a567fdd846` in this Cursor implementer round
  (`cursor-grok-4.6`): `assessBinding` now treats a thrown or malformed
  `adapter.capabilities()` result as `capability_denied` and keeps `doctorExitCode`
  unchanged. Added focused doctor regression coverage. Did not change D1-D6, the
  skill matrix, or existing closed-reason cases. Did not invoke Spartan Bridge.

## Evidence

- `for f in spartan/tasks/*.md; do if rg -q '^status: (draft|active|in_progress|blocked|reviewing|approved)$' "$f"; then printf '%s\n' "$f"; rg '^(status|phase|task_type|current_role|next_role):' "$f"; fi; done`,
  2026-08-22: before this task was created, the only active artifacts were `0026`, `0027`, `0030`,
  and `0031`; all were planning tasks, and none owned automatic implementer start.
- `docs/ROUTING-AND-WORKFLOWS.md`, "Current manual producer transition", "Automatic implementation
  review", and "Future automatic implementation transition": the current release stops before
  implementer start; future automation requires an explicit grant plus operational capability.
- [historical document omitted], Phase 5: automatic producer transition is coupled to a daemon,
  crash recovery, exclusive writer locks, and risk gates rather than being an omitted skill token.
- `agent-skill/skills/spbridge/SKILL.md:25-34,178-213`: entry conditions require Bridge-backed
  planner and implementer rounds to use the skill, while step 7 maps every pass to a Spartan token.
- `tests/spbridge-skill.test.ts:29-48`: one test independently requires both sides of that
  contradiction and does not relate the next role to its required entrypoint.
- `spartan-bridge doctor --repo /path/to/agent-spartan-protocol-bridge`,
  2026-08-22: repository readable; policy configured and resolved; registry schema valid; Cursor and
  Codex launchers resolved with their interfaces available. This is capability evidence, not proof
  of checks or of an authenticated end-to-end session.
- `readlink /Users/example/.agents/skills/spbridge`, 2026-08-22: resolves to this checkout's
  `agent-skill/skills/spbridge`; `codex plugin list` reports `spbridge@spartan-bridge` not installed.
- Bridge run `run-1d717a15-0a3a-4c3a-a1ff-64a999a5a00f`, cycle 1, 2026-08-22: Cursor returned
  `changes_requested` with `D1_MATRIX_HOLE` and `D1_ADAPTER_EVIDENCE`. The runtime retained those
  findings in its review record but stopped at `human_required` with
  `task_artifact_write_rejected` because the proposed HX-001 envelope was not in the writer's
  canonical two-fence form. No reviewer write reached this artifact and no continuation was run.
- Bridge run `run-6526ebf3-a33e-47a7-886a-1c193c130630`, cycle 1, 2026-08-22: Cursor returned
  `changes_requested` with `D1_PLANNER_ROUTE`, `D1_IMPLEMENTER_UNBOUND`, and
  `EVIDENCE_TASK_GLOB`; the Bridge persisted the findings and transitioned the artifact back to the
  planner.
- Bridge run `run-187ff6db-a938-4df7-8b26-be2c2e370e3c`, cycle 2, 2026-08-22: Cursor returned
  `changes_requested` with `D1_BOUND_PRECONDITION` and `D1_LAUNCHER_UNEVIDENCED`; the Bridge
  persisted the findings and transitioned the artifact back to the planner.
- Bridge run `run-842ac95f-68c8-4a1b-8c7b-20edceab5267`, cycle 3, 2026-08-22: Cursor returned
  `changes_requested` with `D1_ALLOWED_INPUTS`; the Bridge persisted the finding and stopped the
  authorized chain at its three-cycle ceiling.
- Second-opinion input, 2026-08-22: `cursor-agent -p --force --sandbox enabled --trust
  --output-format text --model cursor-grok-4.6-high-fast --workspace
  /path/to/agent-spartan-protocol-bridge` with the prompt: `Open
  spartan/tasks/0038-route-the-next-producer-through-the-right-entrypoint.md and AGENTS.md. Act as a
  second-opinion plan reviewer after the formal Bridge chain reached its three-cycle limit. Inspect
  D1-D5 and the acceptance criteria as a set, especially whether D1_ALLOWED_INPUTS is fully resolved
  and the nine routing cases are mutually exclusive and implementable using only current skill inputs
  and current doctor output. Do not edit any file, do not run Spartan Bridge, and do not implement.
  Return only SECOND_OPINION_CLEAR or SECOND_OPINION_FINDINGS followed by concise finding IDs and
  reasons.`
- Second-opinion output: `SECOND_OPINION_FINDINGS / D1_ALLOWED_INPUTS`. Current `doctor` prints the
  registry's launcher ids and separate built-in host-interface lines but not the launcher selected by
  the future reviewer binding's `(client_context, host)` join. D1 therefore cannot prove the
  requested `/spbridge` case from its closed inputs without reading the registry, inferring from the
  host name, or adding a binding-relative runtime signal.
- Human authorization, 2026-08-22: "pode alterar a implementacao do bridge". This resolves the
  scope choice in favor of D6's minimal runtime-owned binding signal rather than weakening the
  requested `/spbridge` behavior.
- Human sequencing authorization, 2026-08-22: after `0038` completes and is committed and pushed,
  create, plan, review, implement, review, commit, and push the separate automatic
  planner-to-implementer task before returning to the older backlog.
- Bridge run `run-1f720d40-71ef-4728-a464-b0a17af4a4f4`, cycle 1, 2026-08-22: Cursor returned
  `changes_requested` with `D1_UNOBSERVABLE_SIGNAL`; the Bridge persisted the finding and
  transitioned the artifact back to the planner.
- Bridge run `run-3d99248f-0598-4371-ae4d-17979a2f5353`, cycle 2, 2026-08-22: Cursor returned
  `changes_requested` with `D1_CONSTRAINT_INPUTS`; the Bridge persisted the finding and transitioned
  the artifact back to the planner.
- `git diff --check`, 2026-08-22: exit 0 after the CAPABILITY_THROW fix.
- `npm run typecheck`, 2026-08-22: exit 0 after the CAPABILITY_THROW fix.
- `npm run build`, 2026-08-22: exit 0 after the CAPABILITY_THROW fix.
- `npm test`, 2026-08-22: first full run after the CAPABILITY_THROW fix exit 1;
  278 pass, 1 fail: `D1 Unicode default casefold refuses a nontrivial
  admitted-path collision` in `tests/workspace.test.ts` with `Error: write EPIPE`.
  Isolated `node --import tsx --test tests/workspace.test.ts` exit 0. Isolated
  `node --import tsx --test tests/doctor.test.ts` exit 0; 10 pass, including
  `assessBinding reports capability_denied when capabilities() throws or is
  malformed`. Second `npm test` exit 0; 279 tests pass.
- `./agent-skill/scripts/manage-install.sh install all`, 2026-08-22: already installed at
  `$HOME/.agents/skills/spbridge` and `$HOME/.claude/skills/spbridge` in this isolated profile, and
  again with `SPBRIDGE_INSTALL_HOME=/Users/example` for the shared user-skill links. Both
  `readlink /Users/example/.agents/skills/spbridge` and
  `readlink /Users/example/.claude/skills/spbridge` resolve to this checkout's
  `agent-skill/skills/spbridge`. The installed `SKILL.md` contains the D1 matrix. `git status --short
  -- agent-skill/.codex-plugin/plugin.json` is empty.
- `spartan-bridge doctor --repo /path/to/agent-spartan-protocol-bridge`,
  2026-08-22: existing repo, policy, registry, launcher, and interface lines retained their prior
  order; the two additive lines were
  `binding reviewer.plan: adapter unavailable; reason=registry_unavailable` and
  `binding reviewer.implementation: adapter unavailable; reason=registry_unavailable`; exit 0. This
  is capability evidence, not proof of checks or of an authenticated session.
- The same `spartan-bridge doctor --repo
  /path/to/agent-spartan-protocol-bridge` in the parent Codex profile,
  2026-08-22: `binding reviewer.plan: adapter available; launcher=cursor-plan-reviewer-v1` and
  `binding reviewer.implementation: adapter available; launcher=codex-plan-reviewer-v1`; exit 0.
- Implementation review run `run-42948d74-bdc4-449f-8067-22a567fdd846`, cycle 1, 2026-08-22:
  `changes_requested` with `CAPABILITY_THROW`; the Bridge persisted the finding and returned the
  artifact to the Cursor implementer.
- Implementation review run `run-e2a5358a-9652-402b-a50c-2f896f260cd0`, cycle 2, 2026-08-22:
  `pass`, `review_passed`, `task_write_state=written`; the Codex reviewer recorded no findings.
- Parent final verification, 2026-08-22: `git diff --check`, `npm run typecheck`, and
  `npm run build` exited 0; `npm test` exited 0 with 279 tests passed and 0 failed.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-e6311265-0204-4a3d-87d1-a425982d4661 execution_id=exec-a444987c-9d87-46de-b833-5e022774bf2e review_kind=plan verdict=pass reason_code=review_passed host=cursor launcher=cursor-plan-reviewer-v1 model=cursor-grok-4.6-high-fast effort=high model_observed=declared_unobserved policy_digest=sha256:8c6d3a4883d80ad20ae76298efa931aa0b90536f6e3ec15c401631a0d90e5288 task_hash=sha256:e411a4acfbe2e34e21b9fe802da59b2883b27fa0598922178695d27508178cc0 agents_hash=sha256:ca1bb93a4a6aa25b46e7a11e4bdc04a2f0ae81d05a4fb4a4e61659a17282f9b1 timestamp=2026-08-22T04:46:43.732Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-e2a5358a-9652-402b-a50c-2f896f260cd0 execution_id=exec-e26275a5-c559-4346-b187-8a144f1e6a11 review_kind=implementation verdict=pass reason_code=review_passed host=codex launcher=codex-plan-reviewer-v1 model=gpt-5.6-terra effort=high model_observed=declared_unobserved policy_digest=sha256:a87802e6639f0b051a993cd2cad0d8b035a8b5ef64288ea1ab2f2f83500480b9 task_hash=sha256:8b031241441260c4def183605960a0c2eaac3118a46e07c2d5c491019855cc29 agents_hash=sha256:ca1bb93a4a6aa25b46e7a11e4bdc04a2f0ae81d05a4fb4a4e61659a17282f9b1 timestamp=2026-08-22T05:04:27.779Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None.

## Next Action

Commit and push this completed task boundary. Then create task `0039` for automatic
planner-to-implementer transition before returning to `0031`, `0026`, and `{0027, 0030}`.

## Next Handoff

No outstanding handoff. The proposed review was consumed.
