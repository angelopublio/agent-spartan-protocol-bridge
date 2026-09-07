---
protocol: "1.0.0" # x-release-please-version
id: retract-the-handoff-a-review-consumed
created_at: 2026-08-19
status: completed
phase: complete
task_type: implementation
risk: high-impact
current_role: reviewer
next_role: none
updated_at: 2026-08-22
handoff_id: HX-008
next_handoff_id: none
---

# Retract the handoff a review consumed

## Objective

After either Bridge review kind reaches an accepted terminal verdict, the task artifact records that
the proposed review was consumed, stops proposing it, and carries one authoritative verdict instead
of retaining the task template's `PENDING` placeholder. The Bridge never authors the next proposal.

## Context

D-017 deliberately left `## Next Handoff` byte-identical while changing `next_role`. That produces a
self-contradictory artifact after every accepted plan verdict: frontmatter names the producer that
acts next while the matching handoff identifier and envelope still propose the reviewer that just
ran. The protocol's compare-before-change rule makes this unsafe rather than cosmetic because the
stale identifier still matches `next_handoff_id`.

Task `0020` made the defect routine by adding producer/reviewer chains. Tasks `0021` and `0023` then
needed manual envelope repair. Task `0028` exposed the sibling defect in `## Review`: the Bridge wrote
an approved region while the task template's unowned `Verdict: PENDING` block survived below it.

The repository has changed since this plan was first written. Task `0033` shipped implementation
review as a second review kind on the same writer. `src/core/task-write.ts` now supports distinct plan
and implementation regions, maps an implementation pass to `human-operator`, maps implementation
changes to `implementer`, and protects the other kind's region plus every positional human segment.
The retraction therefore applies to both review kinds and must preserve those protections. It may not
reuse the old plan-only assumption or turn the whole `## Review` or `## Next Handoff` suffix into an
unbounded writable area.

The current source still exhibits every target condition: `TASK_WRITE_FRONTMATTER_KEYS` contains only
`next_role` and `updated_at`; `preservedAuthorizedBytes` requires human review segments to remain
identical; the plan pass and changes tests require `## Next Handoff` to remain unchanged; D-017 says
the envelope stays byte-identical; and the security document says the document outside the written
review region is unchanged.

## Scope

- `src/core/task-write.ts`: the four allowlisted transition fields, deterministic handoff retraction,
  exact template-placeholder removal, composition, source-text verification, and the existing single
  restore path.
- `tests/task-write.test.ts`: plan and implementation verdicts, identifier movement, source-byte
  preservation, malformed-section refusal, placeholder handling, and no-outstanding-handoff cases.
- `AGENTS.md` and `tests/agents.test.ts`: one artifact-authoring rule for producer-authored role and
  envelope changes, without copying it into adoption or skill surfaces.
- `docs/DECISIONS.md`: a dated amendment to D-017 plus a current decision that records the complete
  four-delta write.
- `docs/AUTHENTICATION-AND-SECURITY.md`: the corrected source-text and one-writer invariant.

## Out of Scope

- Authoring a successor envelope, host, model, effort, bounded action, identifier, or invocation.
- Starting an implementer. A plan pass still ends at the human-started implementer boundary.
- Changing any plan or implementation transition mapping, review-kind resolution, chain rule, reason
  code, event, schema version, policy grant, or adapter.
- Rewriting `## Next Action`, `## Blockers`, work evidence, or arbitrary human review prose.
- Retrofitting completed task artifacts. The runtime repairs only the explicitly reviewed current
  artifact on a future accepted write.

## Constraints

- Every authorization check compares source text, not only parsed values.
- The write remains one composed replacement followed by one verification and one restore path.
- Any ambiguous frontmatter, review placeholder, review region, or handoff-section shape fails closed
  with `task_artifact_write_rejected` and restores the original bytes.
- `human_required` and `blocked` still skip the task write completely.
- The existing `task_artifact_write` grant literal is unchanged. No new reason code, event, policy
  field, protocol version, or schema version is introduced.

## Decisions

### D1 - Every accepted Bridge verdict consumes the outstanding review proposal

Both `plan` and `implementation` reviews retract on `pass` and `changes_requested`. Those are the four
paths on which the runtime already writes a validated verdict and transition metadata. The current
transition table remains exactly:

| Review kind | Verdict | `next_role` |
| --- | --- | --- |
| `plan` | `pass` | `implementer` |
| `plan` | `changes_requested` | `planner` |
| `implementation` | `pass` | `human-operator` |
| `implementation` | `changes_requested` | `implementer` |

Every row always changes the current kind's review region plus `next_role` and `updated_at`. It also
applies the D2 identifier move and D3 body retraction when an outstanding handoff exists, and applies
the D4 cleanup when the exact template placeholder exists. Those conditional deltas are omitted, not
approximated, when their before-shape is absent. Everything else stays byte-identical, including the
other review kind's region and every other human-written segment.

`human_required` and `blocked` do not carry an accepted verdict and therefore consume nothing and
write nothing.

### D2 - Accept the identifier before clearing the proposal

When `next_handoff_id` is an outstanding canonical `HX-NNN`, its value becomes `handoff_id` and
`next_handoff_id` becomes `none` in the same composition. With `handoff_id: HX-001` and
`next_handoff_id: HX-002`, the result is `handoff_id: HX-002` and `next_handoff_id: none`; a later
producer therefore issues `HX-003` and cannot reuse the consumed identifier.

The source must contain each identifier key exactly once and in its existing position. No key is
added, removed, or reordered. If `next_handoff_id` is already `none`, the writer does not change
either identifier and does not retract a body; this keeps direct human-started reviews of artifacts
with no proposed handoff valid.

### D3 - Retraction is one exact transform over one bounded section

An outstanding identifier requires exactly one `## Next Handoff` section whose body has this closed
source shape: one blank line after the heading; exactly one triple-backtick `text` advisory fence;
exactly one blank line; exactly one triple-backtick `text` prompt fence; and no byte other than the
final newline before the section ends. Neither payload may contain a fence. The advisory contains
exactly one `- Handoff: HX-NNN` line, the prompt contains exactly one `(handoff HX-NNN)` occurrence,
both values equal frontmatter `next_handoff_id`, and no other canonical handoff identifier occurs in
the section. Missing or duplicate headings, extra prose or fences, different fence markers or info
strings, whitespace outside that grammar, missing or repeated occurrences, mismatched identifiers,
and unbalanced fences are refused before commit.

The accepted section replaces the complete before-section with exactly these source bytes, including
the one blank line after the heading and one final newline after the notice:

```markdown
## Next Handoff

No outstanding handoff. The proposed review was consumed.
```

The fixed result contains no identifier, role, host, model, invocation, or next-round instruction.
Validation matches the advisory and prompt identifiers against the source/before
`next_handoff_id`; only after that match does the same in-memory composition apply D2 and set the
after-value to `none`. Equality to the complete quoted after-section is what the post-write check
authorizes; there is no generic permission for the suffix or section to differ. `## Next Action` is
outside this section and remains byte-identical.

### D4 - The exact task-template placeholder is consumed with the first real verdict

Inside `## Review`, the runtime may remove only the task template's exact final placeholder:

```markdown
Verdict: PENDING

Findings:

- None recorded.
```

The cleanup runs on the in-memory image after the current kind's region has been inserted or
replaced. Let `M` be the complete last kind-scoped region-end marker line in that image and let `H` be
the complete next level-one or level-two heading line, which ends `## Review`. The only admitted
before-slice is `M + "\n\nVerdict: PENDING\n\nFindings:\n\n- None recorded.\n\n" + H`. The only
admitted after-slice is `M + "\n\n" + H`. `M` and `H` themselves are byte-identical.

Therefore the removed source bytes are exactly
`"Verdict: PENDING\n\nFindings:\n\n- None recorded.\n\n"`, with two trailing newline bytes. The
second trailing newline is the empty line before `H` and is inside the match. The empty line that
remains between `M` and `H` comes exclusively from the preserved `"\n\n"` prefix after `M`; no
separator byte is borrowed from or returned to the placeholder. No additional newline, space, tab,
or other byte is admitted. When no region existed before composition, the newly inserted region
supplies `M` before this same transform is evaluated.

The block is the task template's placeholder, not reviewer evidence. Leaving it beside a Bridge-owned
verdict gives one section two answers. Its absence is accepted. Any unowned `Verdict: PENDING`
outside that exact final-segment match — including before a region, between regions, duplicated, with
additional prose, with different surrounding whitespace, or overlapping a marker span — is ambiguous
and refuses the write. No other human segment may change.

This is independent of region kind: the placeholder is removed on the first accepted write that sees
it, while the writer still changes exactly one kind-scoped Bridge region. A later implementation
write must keep the plan region byte-identical and cannot use placeholder cleanup to modify it.

### D5 - Verification admits four deterministic deltas and nothing else

`preservedAuthorizedBytes` is extended as an equality over the before and after documents. It admits:

1. exactly one changed or inserted Bridge region, of the dispatched review kind;
2. `next_role` and `updated_at` changed to their already-decided transition values, plus either the
   exact D2 pair move derived from an outstanding source/before `next_handoff_id` or source-byte-
   identical `handoff_id` and `next_handoff_id` when that before-value is `none`; key order and every
   non-allowlisted frontmatter source line remain preserved;
3. either the exact D3 retraction or byte-identical `## Next Handoff` text when no proposal exists;
4. either the exact D4 source-slice transform through the preserved next heading with every earlier
   positional human segment preserved, or byte-identical human review text.

All four are composed in memory before the existing atomic rename. Parse or equality failure follows
the existing restore path, so no file can retain a verdict with only half of its identifiers or body
updated.

### D6 - Existing authority covers retraction; published narrower claims are amended

The matched grant already authorizes validated reviewer findings and transition metadata. Accepting
the consumed identifier, clearing its proposal, and replacing a template placeholder with the real
validated verdict are mechanical consequences of that verdict. They do not select or start the next
producer and do not widen the grant literal or its policy digest.

D-017 remains a dated record and gains a dated amendment rather than a silent rewrite. The amendment
states that task `0024` supersedes its plan-only and byte-identical-envelope limits, while D-033's two
review kinds and four transition mappings remain unchanged. The security document replaces its
single-region claim with the complete D5 source-text invariant.

### D7 - Producer-authored role changes and envelopes move together

Runtime retraction covers only Bridge-consumed proposals. A producer or human can still change
`next_role` and leave an old envelope. `AGENTS.md` therefore gains exactly this seventh single-line
rule under `## Artifact authoring`:

```markdown
- A role change and its envelope move together. A round that changes frontmatter `next_role`, or that finds it already changed, regenerates `## Next Handoff` in the same edit: the advisory, the prompt's `Act as <role>`, and the identifier all match the new role, or the section carries no envelope at all. An artifact whose frontmatter and envelope name different roles is telling a reader to run the wrong round.
```

The parser does not consume that section, so the rule does not change policy resolution. The existing
six-rule copy retained in completed task `0022` remains historical truth; tests pin those six and the
new repository-only seventh rule separately. The new rule is not copied into `README.md`,
`docs/ROUTING-AND-WORKFLOWS.md`, fixtures, or `agent-skill/skills/spbridge/SKILL.md`.

## Acceptance Criteria

- [x] D1: all four review-kind/verdict rows write their existing `next_role` mapping and current
      kind's region; each row also composes D2 plus D3 only when an outstanding proposal exists and
      D4 only when its exact placeholder exists, with absent conditional deltas left byte-identical.
- [x] D1: plan and implementation `human_required` and `blocked` outcomes still write no task bytes
      and emit no `task_artifact_written` event.
- [x] D2: `handoff_id: HX-001` plus `next_handoff_id: HX-002` becomes `handoff_id: HX-002` plus
      `next_handoff_id: none`; key positions and every non-allowlisted frontmatter source line,
      including comments and whitespace, remain byte-identical.
- [x] D2: an artifact with `next_handoff_id: none` and no proposed envelope still accepts a validated
      verdict, leaves both identifier fields and the `## Next Handoff` section byte-identical, and
      applies only the other applicable deltas.
- [x] D3: a consumed proposal leaves exactly the complete quoted D3 after-section from its heading
      through its final newline — including one blank separator, the fixed notice, no fence, and no
      `HX-NNN` — after validating both occurrences against the source/before identifier and before
      the same composition clears it.
- [x] D3: every deviation from the closed before-shape — missing or duplicate section, extra prose or
      fence, different marker or info string, outside-whitespace difference, payload fence, missing or
      repeated occurrence, mismatched or extra canonical identifier, or unbalanced fence — is refused
      with `task_artifact_write_rejected` and restored byte-for-byte.
- [x] D3: `preservedAuthorizedBytes` returns false when the handoff section is neither byte-identical
      to the before-section nor exactly D3's fixed after-image of a valid before-shape.
- [x] D4: after region composition, tests pin the complete source transform from
      `M + "\n\nVerdict: PENDING\n\nFindings:\n\n- None recorded.\n\n" + H` to
      `M + "\n\n" + H`, with `M` and `H` preserved; the exact two-trailing-newline placeholder is
      removed on the first accepted plan or implementation write and absence is accepted later.
- [x] D4: an unowned `Verdict: PENDING` before or between regions, duplicated, overlapping a marker,
      sharing its final segment with other prose, or carrying different surrounding whitespace is
      refused and restored byte-for-byte; tests prove the blank before `H` is inside the removed match,
      the remaining blank comes from the prefix after `M`, and every earlier segment is preserved.
- [x] D5: tests mutate each protected domain independently — the other kind's region, human segments
      before, between, and after regions, `## Next Action`, `## Blockers`, frontmatter key order, and a
      non-allowlisted source line — and each mutation makes `preservedAuthorizedBytes` return false.
- [x] D5: `TASK_WRITE_FRONTMATTER_KEYS` is exactly
      `["next_role", "updated_at", "handoff_id", "next_handoff_id"]`; tests accept only the exact D2
      identifier pair move on an outstanding source value and require both identifier source lines
      byte-identical on the `none` path; `current_role`, `status`, `phase`, and `task_type` remain
      outside the allowlist.
- [x] D5: every refusal after temporary replacement uses the existing restore path and leaves no
      half-cleared proposal or partially updated identifier pair.
- [x] D6: `docs/DECISIONS.md` carries a dated amendment to D-017 and a current decision enumerating
      D5's four deltas for both review kinds; D-033's mappings remain unchanged.
- [x] D6: `docs/AUTHENTICATION-AND-SECURITY.md` states the same complete allowlist, atomicity, and
      restore invariant, and the matched `task_artifact_write` grant literal is unchanged.
- [x] D7: `AGENTS.md` contains the exact seventh rule once; `tests/agents.test.ts` pins it separately
      from task `0022`'s historical six-rule block and proves policy parsing is invariant.
- [x] D7: the seventh rule is absent from README, routing documentation, fixtures, and the portable
      `spbridge` skill.
- [x] `git diff --check`, `npm run typecheck`, `npm run build`, and `npm test` exit 0.

## Work Completed

- Planner (Claude Code, `claude-opus-5`, effort high, Anthropic), 2026-08-19: created the initial
  plan from the observed stale-envelope and duplicate-placeholder failures. No product file changed.
- Planner (Codex, `gpt-5.6-sol`, effort high, OpenAI), 2026-08-21: accepted handoff `HX-002` and
  re-derived the plan against tasks `0033` and `0034`. Expanded retraction from plan-only to both
  review kinds, preserved D-033's transition map, made the template placeholder an exact fourth
  delta, replaced the old three-delta preservation claim with a complete four-delta invariant, and
  revised the artifact-authoring test strategy so completed task `0022` remains historical truth.
  No product file changed.
- Planner (Codex, `gpt-5.6-sol`, effort high, OpenAI), 2026-08-21: revised against cycle 1 findings
  from Bridge run `run-5f470c1c-6e71-4934-92c9-baed7616d238`. Closed D3's before-grammar, replaced its
  next-round sentence with a role-free notice, made D1's conditional deltas explicit, and defined D4
  as one exact normalized final-segment subtraction with all earlier positional segments preserved.
  Accepted handoff `HX-003` and issued `HX-004`. No product file changed.
- Planner (Codex, `gpt-5.6-sol`, effort high, OpenAI), 2026-08-21: revised against cycle 2 findings
  from Bridge run `run-bec93eff-8f5f-458b-b23f-6e76e01cc11e`. Quoted D3's complete after-section,
  ordered its source-identifier validation before the same composition clears that value, and
  narrowed D5's identifier allowance to either the exact D2 pair move or byte-identical source lines
  on the `none` path. Accepted `HX-004` and issued `HX-005`. No product file changed.
- Planner (Codex, `gpt-5.6-sol`, effort high, OpenAI), 2026-08-21: after the first chain reached its
  three-cycle ceiling, the human started a new chain against the persisted finding from
  `run-418d254f-5f29-4cc4-b995-28bb3350088c`. Defined D4's final segment as an exact escaped byte
  string, assigned its trailing newline to the single empty line before the next section boundary,
  and quoted the complete before/after source relation through that preserved heading. Accepted
  `HX-005` and issued `HX-006`. No product file changed.
- Planner (Codex, `gpt-5.6-sol`, effort high, OpenAI), 2026-08-21: consumed the unpersisted
  `D4_BYTE_MISCOUNT` finding recovered from
  `.spartan-bridge/runs/run-a7dc5090-2ce3-480f-bf96-85019cc27ee7/reviews/exec-8d24c76f-90a0-4a2d-a866-cc31098a3999.json`.
  Replaced the inconsistent normalized-segment account with one complete source transform through
  preserved lines `M` and `H`; the removed string now has the required two trailing newlines and says
  exactly which blank is consumed. Accepted `HX-006` and issued `HX-007`. No product file changed.
- Implementer (Cursor, `cursor-grok-4.6-high-fast`, effort none), 2026-08-21: the
  pasted prompt carried no identifier; accepted artifact envelope `HX-007` and implemented D1-D7.
  Extended `src/core/task-write.ts` to the four-delta write: `TASK_WRITE_FRONTMATTER_KEYS` is
  `["next_role", "updated_at", "handoff_id", "next_handoff_id"]`; outstanding `HX-NNN` proposals move
  the identifier pair and retract `## Next Handoff` to the fixed consumed notice; the exact template
  `Verdict: PENDING` final segment is removed on the first accepted write; `none` and absent-
  placeholder paths stay byte-identical. Amended D-017, added D-034, updated the security source-text
  invariant, and added the seventh `AGENTS.md` artifact-authoring rule. Did not commit or push.
- Implementer (Cursor, `cursor-grok-4.6-high-fast`, effort none), 2026-08-21: addressed
  two pre-review findings on the same D1-D7 write. Restricted the D4 `TEMPLATE_PENDING_TOKEN` ambiguity
  scan to human text inside `## Review` outside Bridge regions so outside-section occurrences stay
  byte-identical; `parseOutstandingHandoffSection` now refuses a live envelope whose closing prompt
  fence is the last byte with no final newline. Added the outside-Review PENDING regression and the
  missing-final-newline D3 mutation. Did not commit or push. Advisory-only correction of `HX-008`.
- Reviewer (Codex, `gpt-5.6-terra`, effort high, OpenAI), 2026-08-22: accepted `HX-008` in a fresh,
  technically enforced read-only implementation review. Bridge run
  `run-0956b342-f24b-4cf1-905c-109383063cb1` approved D1-D7 without findings, persisted the
  implementation region, consumed the handoff, removed the template placeholder, and moved the
  identifier pair to `handoff_id: HX-008` plus `next_handoff_id: none`.

## Evidence

- Implementer checks, 2026-08-21: `git diff --check` exit 0; `npm run typecheck` exit 0; `npm run build`
  exit 0; `npm test` exit 0 with 272 passed and 0 failed.
- Implementer checks after the two pre-review findings, 2026-08-21: `git diff --check` exit 0;
  `npm run typecheck` exit 0; `npm run build` exit 0; `npm test` exit 0 with 273 passed and 0 failed.
- `src/core/task-write.ts`: `TASK_WRITE_FRONTMATTER_KEYS` is
  `["next_role", "updated_at", "handoff_id", "next_handoff_id"]`; `composeTaskArtifactWrite` applies D4
  then D3 then the D2 pair move in one composition; `preservedAuthorizedBytes` admits those four deltas
  and no others. After D4 cleanup, `TEMPLATE_PENDING_TOKEN` is classified only in unowned `## Review`
  human segments; a live envelope whose prompt close is the last byte with no final newline is refused.
- `tests/task-write.test.ts` covers all four review-kind/verdict rows, the `none` path, D3 refusals
  including a missing-final-newline mutation, the D4 `M`/`H` source transform, an exact removable Review
  placeholder plus a `Verdict: PENDING` literal outside Review, independent D5 mutations, restore of a
  half-cleared proposal, and implementation `human_required` / `blocked` skip-write.
- `docs/DECISIONS.md` D-017 keeps its original text and carries the 2026-08-22 task `0024` amendment;
  D-034 records the four-delta write; D-033's mappings are unchanged.
- `docs/AUTHENTICATION-AND-SECURITY.md` states the same four-delta allowlist, atomicity, and restore
  invariant. The `task_artifact_write` grant literal in `AGENTS.md` is unchanged.
- `AGENTS.md` contains the seventh artifact-authoring rule once; `tests/agents.test.ts` pins it
  separately from task `0022`'s historical six-rule block.
- Parent-session `spartan-bridge doctor --repo /path/to/agent-spartan-protocol-bridge`,
  2026-08-21: repository and policy resolve; Cursor launcher interface available; `codex-plan-reviewer-v1`
  executable resolved and interface available.
- Bridge implementation review `run-0956b342-f24b-4cf1-905c-109383063cb1`, 2026-08-22:
  `review_kind=implementation`, `verdict=pass`, `reason_code=review_passed`, and
  `task_write_state=written`; the fresh Codex reviewer recorded no findings.
- Final checks on the completed artifact, 2026-08-22: `git diff --check`, `npm run typecheck`, and
  `npm run build` exited 0; `npm test` exited 0 with 273 passed and 0 failed.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-528481ef-e400-4398-beda-21ea35f81148 execution_id=exec-83add5f6-d907-4269-bdd4-0dc685be55e4 review_kind=plan verdict=pass reason_code=review_passed host=cursor launcher=cursor-plan-reviewer-v1 model=cursor-grok-4.6-high-fast effort=high model_observed=declared_unobserved policy_digest=sha256:8c6d3a4883d80ad20ae76298efa931aa0b90536f6e3ec15c401631a0d90e5288 task_hash=sha256:380f40693066f8e9bcdc36e138f383a0672823a0975b05c737a386ef2f9836b1 agents_hash=sha256:5a299ac92bd65c4852aa162f0f5e1980371cddc2b70de5ec9d35b2b89fef54a2 timestamp=2026-08-22T02:43:51.583Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-0956b342-f24b-4cf1-905c-109383063cb1 execution_id=exec-1425ab79-1377-48cb-abb6-464a0f1bf50e review_kind=implementation verdict=pass reason_code=review_passed host=codex launcher=codex-plan-reviewer-v1 model=gpt-5.6-terra effort=high model_observed=declared_unobserved policy_digest=sha256:a87802e6639f0b051a993cd2cad0d8b035a8b5ef64288ea1ab2f2f83500480b9 task_hash=sha256:153c4441b8ca4da3ea7270e0fcea9028d6404fdc3bc30b6834879aa5ebae9840 agents_hash=sha256:ca1bb93a4a6aa25b46e7a11e4bdc04a2f0ae81d05a4fb4a4e61659a17282f9b1 timestamp=2026-08-22T03:06:16.489Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None.

## Next Action

None. Task `0024` passed plan and implementation review and is ready to commit and push.

## Next Handoff

No outstanding handoff. The proposed review was consumed.
