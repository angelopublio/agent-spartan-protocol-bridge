---
protocol: "1.0.0" # x-release-please-version
id: spbridge-host-skill
created_at: 2026-08-17
status: completed
phase: complete
task_type: implementation
risk: material
current_role: reviewer
next_role: none
updated_at: 2026-08-18
handoff_id: HX-004
next_handoff_id: none
---

# Ship the `/spbridge` host skill so a plan review runs without copied prompts

## Objective

A single host skill that runs a Spartan round and then hands the resulting artifact to the
installed runtime for plan review, so that one of the four rounds in a task's life stops
requiring a human to open a second host and paste a prompt.

## Context

The runtime already performs one plan review end to end: it resolves policy, mounts a
read-only workspace holding only the task artifact and the root `AGENTS.md`, spawns the
already-authenticated `cursor-agent` with the declared model, validates a schema-constrained
verdict, confirms nothing was written, and splices the verdict plus a provenance line into
the artifact's `## Review` region. What is missing is the last mile: a human still has to
remember the command, the explicit task path, and the preconditions.

The decisive fact that makes this buildable with no new authority: when the human pastes a
handoff into a host, **the human is the one starting the producer**. The runtime starts only
the mapped reviewer, which `AGENTS.md` already grants. Nothing here needs producer-start
authority, a Claude adapter, or `spartan-bridge/config.yaml`.

`README.md` already specifies the skill's shape and constrains it: "Thin host-specific
instructions that call the CLI or MCP adapter… The skill does not implement the workflow. It
does not parse authoritative policy, choose providers, hold state, or enforce permissions. It
only tells the current host how to invoke the installed runtime."

## Scope

- The skill package: `SKILL.md` plus any minimal assets, laid out to mirror the protocol
  package's `skills/<name>/` convention so it can be symlinked into a host's skills directory
  the same way.
- `README.md`: mark `/spbridge` as shipped and state how to link it.

## Out of Scope

- The review-cycle loop. It needs the runtime to report the effective cycle ceiling and the
  cycles already consumed, and `StatusDocument` carries neither. Separate task.
- Writing frontmatter or the handoff envelope after a dispatched review. Task `0013` decides
  whether the runtime does that under the transition-metadata authority it already holds.
- Producer start of any kind, a Claude Code adapter, a Codex adapter, and
  `spartan-bridge/config.yaml`.
- Any change to `src/` or to the portable protocol package.
- Reimplementing round semantics, admission rules, or binding resolution.

## Constraints

- The skill must not parse `AGENTS.md`, resolve policy, choose a host, decide a model, or
  decide which task states and roles are dispatchable. All of that belongs to the runtime, and
  a second copy can disagree with the first.
- The skill must never search for a task. It uses the explicit path carried in the handoff the
  human pasted, as `AGENTS.md` requires.
- The skill must not write to the task artifact itself. Only `/spartan` and the runtime write,
  each within its own boundary.
- The Spartan skill's boundary is untouched: it must not invoke, supervise, or coordinate
  another agent.
- No commit, push, or other external action.

## Acceptance Criteria

- [x] Invoking the skill with a pasted handoff runs the round through `/spartan` and leaves the
      artifact exactly as a manual round would.
- [x] It then invokes the installed runtime once, passing the explicit task path from the
      pasted handoff, and passing nothing it decided for itself.
- [x] It reports the outcome by name: the recorded verdict, or the runtime's own reason code
      when the runtime refused.
- [x] It never inspects frontmatter to decide whether to invoke, and contains no list of
      admissible states, roles, or bindings.
- [x] It does not modify the task artifact at any point.
- [x] After the run it prints the next invocation for the human, without writing it anywhere.
- [x] `README.md` no longer lists `/spbridge` as unimplemented.

## Decisions

Revised after the Bridge plan review recorded `SECOND_RESOLVER`, `ENVELOPE_WRITE`, and
`SKILL_NOT_RUNTIME`. All three are accepted; the decisions below replace the originals.

### D1 - The skill is an adapter, not the runtime

The earlier version called `/spbridge` "the Bridge" to argue that coordination needed no new
grant. That conflated two things `AGENTS.md` separates: the runtime owns policy resolution,
permissions, locks, and state transitions, while `/spbridge` is an optional adapter beside MCP.

The authority argument stands without the conflation, and is simpler. The human pasting a
handoff into a host **is** the producer start. The runtime then starts only the mapped
reviewer, which `AGENTS.md` already grants. No layer needs to borrow another's identity, and no
new grant is required.

So the skill's whole content is: run the round through `/spartan`, then tell the host to invoke
the installed runtime with an explicit path, then report. That is what `README.md` means by
instructions that "only tell the current host how to invoke the installed runtime". Sequencing
those two steps is ordering, not workflow ownership: the skill decides nothing about the work,
and holds no state between them.

### D2 - Invoke and report; never pre-judge

The earlier version had the skill verify the task was `active` / `planning` / `planning` and
dispatch only for a plan review. Those rules are copies of `task-frontmatter` admission and of
the `reviewer.plan` binding, and a copy can drift from the original.

Instead the skill invokes the runtime and reports what comes back. The runtime already refuses
with named reasons — `task_invalid` when the state is wrong, `reviewer_binding_missing` when no
plan reviewer is bound, `agents_policy_invalid`, `registry_context_incomplete`,
`adapter_error`. Each of those is a better message than a reimplemented pre-check, because it
comes from the component that actually decides.

The skill therefore carries no list of admissible states, roles, or bindings. If a repository
is not configured for the Bridge, the human sees the runtime say so and the round is otherwise
unaffected.

### D3 - One environment check survives, and only because it resolves no policy

Build freshness is the exception. `package.json` points `bin` at `dist/`, nothing rebuilds it,
and a stale `dist/` silently runs older logic — it produced a wrong `task_invalid` during this
repository's own development, and the runtime cannot refuse it because the runtime *is* the
stale code. It is an environment fact, not a policy question, so checking it does not create a
second resolver.

The skill checks that `dist/` is not older than `src/` when invoked inside this repository, and
says so plainly if it is. Everywhere else there is nothing to check.

### D4 - The skill writes nothing to the artifact

The earlier version had the skill update frontmatter and the handoff envelope through a second
`/spartan` round. That was wrong twice: `/spartan` owns whole rounds rather than metadata
patches, and starting a second round in the same session is producer work this version
explicitly does not do.

After a dispatched review the artifact holds a fresh verdict beside a stale `next_role` and a
stale envelope. The skill states that plainly and prints the invocation that closes it. Making
the runtime write those transition fields is the right fix and is task `0013`, under the
`task_artifact_write` authority `AGENTS.md` already grants for "transition metadata" and which
nothing uses today.

### D5 - No loop, and why this is still worth shipping

Without the loop, a `CHANGES_REQUESTED` means the human revises and invokes once more. What the
skill removes is the context switch — opening a second host, pasting a prompt, waiting, copying
a verdict back — which is the expensive part. The loop would remove a keystroke and needs two
`StatusDocument` fields that do not exist.

## Work Completed

- Planner (Claude Code, Claude Opus 5, high effort, Anthropic): recorded D1-D5 against the
  shipped runtime, the `README.md` specification of the skill, and the authority already
  granted in `AGENTS.md`. No product file changed in this round.

- Planner (HX-001, Claude Code, Claude Opus 5, high effort, Anthropic): accepted matching
  envelope HX-001. Accepted all three Bridge findings and rewrote D1-D5, Scope, Constraints,
  and Acceptance Criteria around them. Envelope writing moved out to task `0013`. No product
  file changed.

- Plan review (HX-002, Cursor, cursor-grok-4.6-high-fast, effort none), dispatched by the runtime rather than pasted: `APPROVED`, no findings. Run
  `run-3469f5ae`, terminal `awaiting_implementer`, `task_write_state: written`. The preceding
  run on the same revision blocked on `reviewer_write_detected` and did not reproduce; recorded
  in Blockers as an open observation rather than a defect of this plan.

- Implementer (HX-003, Cursor, cursor-grok-4.6-high-fast, effort none): accepted matching envelope HX-003. Shipped `skills/spbridge/SKILL.md` and
  `skills/spbridge/agents/openai.yaml`. README marks `/spbridge` shipped and documents the
  symlink install. No `src/` change. This skill round did not invoke `review` against this
  artifact.

## Evidence

- `README.md` specifies the skill as thin instructions that must not implement workflow,
  parse policy, choose providers, hold state, or enforce permissions.
- `AGENTS.md` grants automatic start of the mapped reviewer only; producer start is withheld,
  and no grant sentence for it exists in `src/policy/agents-policy.ts`.
- `src/policy/task-frontmatter.ts` admits only `active` with `phase` and `task_type` both
  `planning`; anything else is `task_invalid`.
- `src/adapters/cursor.ts` mounts a workspace containing only `task.md` and `AGENTS.md` at
  mode `0444`, so a dispatched review judges the artifact and nothing else.
- `src/core/task-write.ts` replaces the owned region in full and verifies the bytes outside it
  are unchanged, which is why frontmatter and the envelope stay stale after a run.
- `src/core/contracts.ts` `StatusDocument` carries no cycle ceiling and no consumed count,
  which is what puts the loop out of scope here.
- `skills/spbridge/SKILL.md` sequences `/spartan` then one `spartan-bridge review --repo
  <workspace-root> --task <path-from-paste>`; forbids artifact writes, task search, and
  frontmatter inspection; reports `verdict` or `reason_code`; prints the next invocation only
  in the conversation.
- Grep of `skills/spbridge/` finds no admission, binding, or `reviewer.plan` list; the only
  hit for "admissible" is the prohibition.
- `README.md` states the CLI, MCP adapter, and `/spbridge` skill ship in Phase 2A, and shows
  `ln -s …/skills/spbridge` into `~/.claude/skills` and `~/.agents/skills`.
- `npm run typecheck` and `npm test`: exit 0, 93 tests passed. No `src/` files in this diff.

## Review

<!-- spartan-bridge:review:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-3469f5ae-50d2-4ca9-8089-1adb866c1dfd execution_id=exec-f867ae18-293e-489b-9b4a-dff749e41dec review_kind=plan verdict=pass reason_code=review_passed host=cursor launcher=cursor-plan-reviewer-v1 model=cursor-grok-4.6-high-fast effort=none model_observed=declared_unobserved policy_digest=sha256:5ce5ce183767d86bbd03d6217f03b8849dd70c4a7609b5b84f750ecbb1d0100f task_hash=sha256:f165eaa25beb5d985138c01002fe84fd94ee55245a738ca041c5f126b05436e3 agents_hash=sha256:e4037aeeb5f4aeab8092de705270dac3d80aae2698bf7a51ce7bf0870b251e5e timestamp=2026-08-18T08:45:49.208Z
<!-- spartan-bridge:review:end -->

Verdict: PENDING

Findings:

- None recorded.

### Implementation review (HX-004, Claude Code, Claude Opus 5, high effort, Anthropic)

Verdict: APPROVED. Accepted matching envelope HX-004; product files were read only, and only
this artifact was written.

The decisive criterion was `SECOND_RESOLVER`, and it is verifiably met: searching the shipped
`SKILL.md` for any admissible task state, phase, or binding name returns nothing. The skill
carries no copy of the runtime's admission rules, so there is no second resolver to drift.

Against the rest:

- **D1** holds. The file opens by denying itself policy parsing, host and model choice, state,
  and permissions, and says the runtime decides whether a review proceeds.
- **D2** holds. Step 5 reports `verdict` or `reason_code` "as the document spelled them", with an
  explicit ban on remapping or filtering. Step 7 branches on the code the runtime emitted rather
  than on a judgement of its own, and forbids inferring a code the document did not emit — the
  right side of that line.
- **D3** holds, and is correctly fenced. The build-freshness check runs only when the workspace
  is this checkout, and is skipped everywhere else, so it does not leak an environment
  assumption into other repositories.
- **D4** holds. The hard boundary, step 6, and step 7 each forbid writing, and step 6 requires
  stating the stale-frontmatter fact plainly rather than quietly leaving it.
- **D5** holds. One invocation, no retry, no second `/spartan` round in session.
- `README.md` now lists the skill as shipped and documents how to link it.
- `npm run typecheck` clean; `npm test` 93 pass, 0 fail.

Findings:

- `PRINTED-PROMPT-UNIDENTIFIED` (warning): the `review_passed` block prints an `Open` line with
  no `(handoff HX-NNN)` parenthetical while the artifact still proposes a stale
  `next_handoff_id`. The handoff contract covers that case — a pasted prompt carrying no
  identifier is treated as acceptance of the artifact's current envelope — so the receiving round
  adopts the stale identifier as its `handoff_id`, advancing the task's high-water mark to an
  envelope whose prompt was never executed. The printed instruction "Do not paste the stale Next
  Handoff" is therefore contradicted by what the receiving round actually does. This is not a
  defect of the skill: it exists because the runtime leaves the envelope stale, which is exactly
  what task `0013` is for. Recorded here so `0013` closes it deliberately rather than by
  accident.
- `OPEN-LINE-SHAPE` (info): step 1 illustrates the `Open` line without the `(handoff HX-NNN)`
  parenthetical that every handoff this repository issues actually carries. Path extraction still
  works, but the shape shown does not match the shape produced.

## Blockers

None for this task.

One observation carried for a later round, not blocking here: run `run-1346c03b`, on this exact
revision, terminated `blocked` with `reviewer_write_detected`, and the immediately following run
passed. A faithful reproduction — same temp-dir workspace, same `0444` / `0555` modes, same
flags, same prompt, compared with the runtime's own `snapshotTree` and `workspaceDiffers` —
reported no differing entry. So the guard is intermittent on this client, and one attempt does
not establish whether the client writes transiently into the workspace or something else
touches the temp directory. It fails closed either way, but an isolation guard that fires
spuriously teaches people to ignore it, which is the worst outcome for a safety control.

## Next Action

None. Every acceptance criterion is checked, `npm run typecheck` and `npm test` have recorded
outcomes, the plan review and the implementation review are both `APPROVED`, and no blocker
remains. Committing and linking the skill are human-only actions outside this task's scope.

## Next Handoff

No outstanding proposal. This task is closed.

Non-binding note for the human: the skill is shipped but not linked. Linking it into a host
skills home is the step that makes `/spbridge` usable, and the command is in `README.md`.
