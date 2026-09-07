---
protocol: "0.6.1"
id: phase-2a-dogfood-docs
created_at: 2026-08-17
status: completed
phase: complete
task_type: implementation
risk: material
current_role: reviewer
next_role: planner
updated_at: 2026-08-17
handoff_id: HX-004
next_handoff_id: none
---

# Record the Phase 2A live dogfood in documentation without weakening the hostile-probe limit

> Editorial note (2026-09-07): unused platform names and historical integration-document names were generalized for publication. The historical optional-integrations document refers to the former combined cockpit and Board documentation; its Board material is now in `docs/BOARD.md`. Any example path in this cleanup is a normalized placeholder. Original round outcomes, commands, and technical findings are retained; historical line references are not current navigation targets.

## Objective

Repository documentation states that a real Cursor plan review has run end-to-end on this repository through `cursor-plan-reviewer-v1`, and no longer states that a live dogfood review with an accepted task write is blocked on authentication, while every recorded limit of the hostile-prompt probe — above all that client-side write prevention by `--mode plan` and `--sandbox enabled` was not observed — survives unchanged.

## Context

The Phase 2A real-client dogfood succeeded: launcher `cursor-plan-reviewer-v1`, terminal state `awaiting_implementer`, reason code `review_passed`, `task_write_state: written`. That outcome is recorded in `spartan/tasks/0003-cursor-plan-review-dogfood.md`, which this round was explicitly instructed not to open or update.

Consequently this plan treats the dogfood facts as owner-supplied and unverified in this round. The implementer must read `0003` and confirm each fact before writing it into documentation.

Two facts found in this round that the implementer needs:

- The only committed run directory, `.spartan-bridge/runs/run-ca3a117f-c463-494d-a8b3-88bedf2f36f1/`, is an older `blocked` / `registry_unavailable` run against `spartan/tasks/0002-mcp-stdio-adapter.md`. It is **not** the dogfood run and must never be cited as such.
- Documentation currently carries the probe-limit language in four places (README banner, `ARCHITECTURE.md`, [historical document omitted], `AUTHENTICATION-AND-SECURITY.md`); only [historical document omitted] carries the explicit "remains blocked" sentence, but the other three imply the same thing by stating the probe as the only live evidence.

The distinction the whole change turns on: the dogfood proves the adapter can start and complete a real session, not that the client-side flags prevent writes. A compliant reviewer that attempts no write cannot demonstrate that a write would be refused. The one spawn that carried an adversarial prompt never started a session.

## Scope

Documentation-only edits in exactly four files:

- `README.md` — status banner (line 3) and "Project status and next milestone" (line 243).
- `docs/ARCHITECTURE.md` — the Phase 2A paragraph in "Permissions and isolation" (line 168).
- [historical document omitted] — "Phase 2A" status line (line 145) and the "Recorded probe limit" paragraph (line 156).
- `docs/AUTHENTICATION-AND-SECURITY.md` — "Permission enforcement", inserting a live-dogfood block before "What the recorded hostile-prompt probe demonstrated:" (line 359).

## Out of Scope

- Any change under `src/`, `tests/`, `dist/`, or `package.json`.
- Any change to `AGENTS.md`, `CLAUDE.md`, `SECURITY.md`, `docs/DECISIONS.md`, `docs/ROUTING-AND-WORKFLOWS.md`, the historical optional-integrations document, or `docs/examples/`.
- Opening or updating `spartan/tasks/0003-cursor-plan-review-dogfood.md` for anything other than reading it as evidence; it must not be edited.
- New documentation files, new sections beyond the one insertion named above, and any reorganization of existing sections.
- Committing, pushing, or any other external action.

## Constraints

- English only; no credentials, account identifiers, emails, or provider session material in any added text. Cite run IDs and state names only.
- Product files and check results are implementation truth; `0003` is the handoff truth for the dogfood outcome. If the two disagree with the owner-supplied facts above, stop and report rather than write the claim.
- Edits are surgical replacements of the named sentences. Surrounding sentences in the same paragraphs stay byte-identical.
- The change may not imply the Bridge acquired any authentication capability. The human authenticated the official client beforehand; the Bridge invoked an already-authenticated client.

## Acceptance Criteria

- [x] `README.md` line 3 states the completed real Cursor review and keeps an explicit statement that client-side write prevention is still unobserved.
- [x] `README.md` "Project status and next milestone" records the completed live review in one sentence and still names Codex/Claude adapters and review-cycle loops as later milestones.
- [x] `docs/ARCHITECTURE.md` line 168 replaces the "recorded live probe did not start a reviewer session" clause with the dogfood plus the reason it still does not demonstrate the flags; the defense-in-depth sentence, residual-gap list, and "none was observed" sentence are unchanged.
- [x] [historical document omitted] no longer contains the sentence "A live dogfood review with an accepted task write remains blocked on the same authentication gate."
- [x] [historical document omitted] carries both a "Recorded live dogfood" paragraph and a "Recorded probe limit" paragraph, the latter still stating that write prevention by `--mode plan` and `--sandbox enabled` was not observed.
- [x] `docs/AUTHENTICATION-AND-SECURITY.md` keeps its three numbered "demonstrated" items and its three "did not demonstrate" bullets verbatim, with a live-dogfood block added before them.
- [x] Every dogfood fact written into documentation is traceable to `0003` (or to a run's `status.json` / `events.jsonl`), and the implementer records where it was traced. (HX-003 corrected `DOC-FINDINGS` to the validated review result with verdict `APPROVE` and no findings recorded; HX-004 re-traced all three corrected clauses directly against `0003` HX-021.)
- [x] `npm run typecheck` and `npm test` pass after the edits.
- [x] `grep -rn "remains blocked on the same authentication gate" README.md docs/` returns nothing.

## Decisions

- **Risk is `material`, not `routine`.** The edits are documentation-only and reversible, but their failure mode is overstating an unproven security property. The higher level is recorded deliberately.
- **Four files, no fifth.** The stale implication lives only where the probe is presented as the sole live evidence. `docs/DECISIONS.md`, `docs/ROUTING-AND-WORKFLOWS.md`, and `README.md` line 197 describe the authentication boundary in general terms that remain true, so they are untouched.
- **Add the dogfood beside the probe rather than rewriting the probe.** The probe record is the repository's honest limit statement; a replacement would risk diluting it. The insertion is additive and the probe text stays as written.
- **The dogfood is evidence of reachability, not of enforcement.** Every place the dogfood is added must carry the reason it does not upgrade the flag claim, so a later reader cannot mistake a completed run for observed write prevention.
- **`0003` is read, not edited.** The dogfood outcome stays recorded in its own task; this task records only the documentation change.
- **HX-001 honesty narrowings.** `0003` records a throwaway fixture worktree in the OS temporary directory, not a live write on this repository, and it does not record snapshot comparison results. Planned "on this repository" wording was dropped; AUTH dogfood item 3 was dropped as the plan allows; ARCHITECTURE's "no mutation reported by either snapshot" was narrowed to the terminal reason codes `0003` does record (`awaiting_implementer` / `review_passed`, not `reviewer_write_detected` or `integrity_mismatch`).
- **HX-003 applied `DOC-FINDINGS` and `OBS-ARCH-FIXTURE`.** "validated findings" in the two dogfood-run sentences is now "validated review result"; [historical document omitted] also names verdict `APPROVE` and no findings recorded. ARCHITECTURE now carries the same "throwaway fixture worktree" qualifier as the other three files. The README banner's general capability sentence ("persist validated findings onto the named Spartan task") was left unchanged: it describes the write mechanism, not this run.

## Planned edits

### 1. `README.md` line 3 (status banner)

Replace:

> The recorded live probe did not start a reviewer session, so client-side write prevention was not observed.

With:

> A real Cursor plan review has completed on this repository through `cursor-plan-reviewer-v1` against the already-authenticated official client, reaching `awaiting_implementer` / `review_passed` with `task_write_state: written`. The separate hostile-prompt probe never started a session, so client-side write prevention by `--mode plan` and `--sandbox enabled` is still unobserved.

Every other sentence in the banner stays as written.

### 2. `README.md` line 243 (Project status and next milestone)

Insert one sentence before "Codex/Claude adapters and review-cycle loops remain later milestones.":

> One real Cursor plan review has completed end-to-end through that adapter, with the validated findings written into the named Spartan task artifact.

### 3. `docs/ARCHITECTURE.md` line 168

Replace:

> The recorded live probe did not start a reviewer session, so client-side write prevention by those flags was not observed.

With:

> A real Cursor plan review has since completed with those flags on the argv and no mutation reported by either snapshot. That is consistent with the flags but does not demonstrate them: the reviewer attempted no write, and the one spawn that carried a hostile prompt never started a session, so client-side write prevention by `--mode plan` and `--sandbox enabled` remains unobserved.

The rest of the paragraph — defense in depth, the residual gaps, and "Documentation claims no OS-level sandboxing; none was observed." — stays byte-identical.

### 4. [historical document omitted] line 145

Replace:

> Status: implemented, with the recorded probe limit.

With:

> Status: implemented and exercised end-to-end against the real Cursor client, with the recorded hostile-probe limit.

### 5. [historical document omitted] line 156

Replace the whole "Recorded probe limit:" paragraph with two paragraphs:

> Recorded live dogfood: a real plan review ran on this repository through `cursor-plan-reviewer-v1` against the already-authenticated official `cursor-agent` client and reached terminal state `awaiting_implementer` with reason code `review_passed` and `task_write_state: written`; validated findings were persisted into the named task artifact. The human authenticated the official client beforehand; the Bridge authenticated nothing.
>
> Recorded probe limit: the separate hostile-prompt probe against real `cursor-agent` did not start a reviewer session (the client reported authentication required). Fixture workspace, live-task, and product-file hashes were unchanged because no session started. Client-side write prevention by `--mode plan` and `--sandbox enabled` was not observed, and the completed dogfood does not supply that observation either, because a compliant reviewer that attempts no write cannot show that a write would be refused. The Bridge does not authenticate.

The sentence "A live dogfood review with an accepted task write remains blocked on the same authentication gate." is deleted and has no replacement.

### 6. `docs/AUTHENTICATION-AND-SECURITY.md`, before line 359

Insert immediately before "What the recorded hostile-prompt probe demonstrated:":

> What the recorded live dogfood run demonstrated:
>
> 1. `cursor-plan-reviewer-v1` started a real session against the already-authenticated official `cursor-agent` client and returned a structured result the Bridge accepted;
> 2. the run reached terminal state `awaiting_implementer` with reason code `review_passed`, and the schema-constrained task write reported `task_write_state: written`;
> 3. no snapshot reported a mutation, so neither `reviewer_write_detected` nor `integrity_mismatch` was raised.
>
> What that run did not demonstrate: write prevention by `--mode plan` or `--sandbox enabled`. The reviewer attempted no write, so a compliant run cannot distinguish a refused write from an unattempted one. The hostile-prompt probe below remains the only spawn that carried an adversarial prompt, and it never started a session.

Item 3 is written only if `0003` records both snapshots as clean; otherwise the implementer narrows it to what `0003` actually records, or drops it.

## What must remain honest

The implementer may not weaken any of the following, in any file:

1. Client-side write prevention by `--mode plan` and `--sandbox enabled` is **not observed**. The dogfood does not change this.
2. No OS-level sandbox is claimed anywhere.
3. Snapshot comparison stays labelled defense in depth, with its residual gaps intact: same-UID `chmod`, restored content and `mtime`, writes inside skipped `.git` / `node_modules` / `.spartan-bridge`, and size/`mtimeNs`-only comparison above the 1 MiB hash cap.
4. The hostile-prompt probe's three demonstrated items and three not-demonstrated bullets in `docs/AUTHENTICATION-AND-SECURITY.md` stay verbatim, as does "They are not a substitute for an observed client-side permission mode."
5. The Bridge does not authenticate, and `doctor` inspects no authentication, account, or billing state. The dogfood is evidence about the adapter, not about a new Bridge capability.
6. The dogfood is one plan review, one launcher, one machine. It is not generalized to `reviewer.implementation`, review-cycle loops, or Codex/Claude adapters, all of which remain unimplemented.
7. No claim is written that `0003` does not record. The older committed run `run-ca3a117f-c463-494d-a8b3-88bedf2f36f1` is `blocked` / `registry_unavailable` and is not the dogfood.

## Work Completed

Planning (Claude Code, Opus 5, high effort) located the four-file surface and six edit sites, confirmed the committed run directory is not the dogfood run, and left `0003` unread by instruction.

HX-001 accepted matching envelope HX-001. Implementer round in Cursor on Grok 4.6, client context `personal`. Read `0003` as evidence only; did not edit it. Applied the six documentation edits in the four scoped files, with the honesty narrowings recorded under Decisions. No file outside Scope was modified. No commit.

HX-002 accepted matching envelope HX-002. Review round in Claude Code on Opus 5, effort high, vendor Anthropic, client context `personal`. The HX-001 advisory recommended Cursor with GPT-5.6 Terra; the human ran Claude Code instead, which still separates the reviewing vendor (Anthropic) from the implementation using Grok 4.6 in Cursor. Read-only on product files: all six edit sites were read, all seven honesty items and all nine acceptance criteria were checked, and the repository checks were re-run. Only this task artifact was written, under the `AGENTS.md` manual-review-round authorization. Verdict `CHANGES` on one finding; one non-blocking observation raised.

HX-003 accepted matching envelope HX-003. Implementer round in Cursor on Grok 4.6, client context `personal`. Applied the two `DOC-FINDINGS` clauses exactly as suggested under Review, plus the optional `OBS-ARCH-FIXTURE` insertion. No other sentence in the four scoped files was changed. `docs/AUTHENTICATION-AND-SECURITY.md` was not edited. No file outside Scope was modified. No commit.

HX-004 accepted matching envelope HX-004. Re-review round in Claude Code on Opus 5, effort high, vendor Anthropic, client context `personal` — the recommended host and model, and a different vendor from the Grok 4.6 implementer round. Read-only on product files: the three corrected clauses were read at their sites, re-traced directly against `0003` HX-021 rather than against the HX-002 finding text, all seven honesty items were re-checked, and the repository checks were re-run. Only this task artifact was written, under the `AGENTS.md` manual-review-round authorization. Verdict `APPROVE`; the task is closed with no blocker and no required next action.

## Evidence

Fact traces from `spartan/tasks/0003-cursor-plan-review-dogfood.md` HX-021 Work Completed and Evidence (not from `run-ca3a117f-c463-494d-a8b3-88bedf2f36f1`, which remains `blocked` / `registry_unavailable` against task 0002):

- launcher `cursor-plan-reviewer-v1`, policy digest matching that identifier, elapsed 39s: HX-021.
- terminal `awaiting_implementer` / `review_passed` / verdict `pass` / `task_write_state: written`; events R, P, S, A, W, X; owned region written on the fixture task: HX-021.
- throwaway fixture repository in the OS temporary directory; not a live `spartan/tasks/` write: HX-021.
- no pinned flag relaxed: HX-021.
- human authenticated the official client beforehand; no agent host authenticated any client: HX-010 and HX-021.
- snapshot comparison results: not recorded in `0003`; AUTH dogfood item 3 dropped; ARCHITECTURE narrowed to the recorded terminal reason codes rather than "no mutation reported by either snapshot".
- hostile-prompt probe unchanged: HX-006 probe evidence; `0003` states that evidence is unchanged.

Checks, run independently in HX-001, HX-002, HX-003, and HX-004, with the same outcome every time: `npm run typecheck` exit 0, no output; `npm test` exit 0, 77 passed, 0 failed, 0 skipped.

Deleted-claim greps over `README.md` and `docs/`, all returning no hits (exit 1) in HX-002 and again in HX-004: `remains blocked on the same authentication gate`; the sibling phrasings `authentication gate` and `remains blocked`; and `run-ca3a117f`, so the `blocked` / `registry_unavailable` run is nowhere cited as the dogfood.

HX-002 scope check: the repository has no commits, so no diff baseline exists; scope was verified by modification time instead. Files modified in the implementer window (2026-08-17 05:53) are exactly `README.md`, `docs/ARCHITECTURE.md`, `docs/AUTHENTICATION-AND-SECURITY.md`, and [historical document omitted]. Nothing under `src/`, `tests/`, `dist/`, `package.json`, `AGENTS.md`, `CLAUDE.md`, `SECURITY.md`, `docs/DECISIONS.md`, `docs/ROUTING-AND-WORKFLOWS.md`, the historical optional-integrations document, or `docs/examples/` was touched. `spartan/tasks/0003-cursor-plan-review-dogfood.md` last changed at 00:03:57, before this task file was created at 00:09:54, so the implementer round did not edit it. Absent a baseline, byte-identity of the untouched surrounding sentences inside the four edited files could not be proven; each was read and found intact in content.

HX-002 honesty audit, all seven items verified present after the edits: (1) "not observed" survives in `README.md` line 3, `docs/ARCHITECTURE.md` line 168, [historical document omitted] line 158, `docs/AUTHENTICATION-AND-SECURITY.md` line 364; (2) no OS-level sandbox is claimed anywhere; (3) defense-in-depth labelling plus the four residual gaps survive in `docs/ARCHITECTURE.md` line 168, `docs/AUTHENTICATION-AND-SECURITY.md` line 382, and the `README.md` banner; (4) the probe's three numbered items (lines 368–370), three bullets (lines 374–376), and "They are not a substitute for an observed client-side permission mode." (line 378) are intact; (5) every dogfood sentence attributes authentication to the human and the already-authenticated official client, and no `doctor` claim changed; (6) [historical document omitted] "Out of this slice" and the `README.md` banner still name Codex/Claude adapters and review-cycle loops as unimplemented, and no text generalizes the run to `reviewer.implementation`; (7) traceability holds for every written fact except `DOC-FINDINGS`.

HX-002 note on an unplanned improvement, accepted rather than flagged: all three "does not demonstrate" sentences replaced the planned "the reviewer attempted no write" with "the completed dogfood was not an adversarial write attempt". `0003` does not record whether the reviewer attempted a write, only that none was detected, so the shipped wording is more traceable than the planned wording.

HX-003 product edits, clauses only:
- `README.md` line 243: "validated findings written" → "validated review result written".
- [historical document omitted] line 156: "validated findings were persisted into that fixture's named task artifact" → "the validated review result was persisted into that fixture's named task artifact, with verdict `APPROVE` and no findings recorded".
- `docs/ARCHITECTURE.md` line 168: inserted "in a throwaway fixture worktree" after "has since completed" (`OBS-ARCH-FIXTURE`).

HX-004 `DOC-FINDINGS` closure grep: `grep -rn "findings were persisted\|validated findings written\|findings written into\|findings into" README.md docs/` returns no hits (exit 1). The only surviving `validated findings` string in the four scoped files is the `README.md` banner's general capability sentence ("Schema-constrained task-artifact writes persist validated findings onto the named Spartan task when `AGENTS.md` grants that capability"), which describes the write mechanism, names no run, and mirrors the `AGENTS.md` grant literal. No scoped file claims findings were persisted into the fixture's task artifact.

HX-004 re-trace of the three corrected clauses against `0003` HX-021, read directly rather than via the HX-002 finding text: HX-021 Work Completed and Evidence record "One validated review record with the closed five keys, verdict `pass`, and zero findings was persisted" and an owned region carrying `Verdict: APPROVE` and `- None recorded.`, which support both the "validated review result" wording and the added "with verdict `APPROVE` and no findings recorded"; and "A new throwaway fixture repository was created in the OS temporary directory ... it was not a live `spartan/tasks/` write", which supports the `docs/ARCHITECTURE.md` "in a throwaway fixture worktree" insertion. `docs/ARCHITECTURE.md`'s "did not terminate with `reviewer_write_detected` or `integrity_mismatch`" stays within the recorded terminal `awaiting_implementer` / `review_passed`.

HX-004 change-containment check. The repository still has no commits, so byte-level diffing remains impossible; modification time was used again. Only `README.md`, `docs/ARCHITECTURE.md`, and [historical document omitted] carry the HX-003 timestamp (06:07:47). `docs/AUTHENTICATION-AND-SECURITY.md` still carries the HX-001 timestamp (05:53:41), which corroborates the HX-003 claim that it was not edited and makes its probe block byte-identical by construction. Nothing else in the working tree changed after this task was created. Within the three edited files, all six edit sites were re-read: each matches the text HX-002 recorded, plus exactly the three clauses HX-003 recorded and nothing else. Absent a baseline, byte-identity of the surrounding sentences is corroborated by reading rather than proven.

HX-004 honesty re-audit, all seven items still holding: (1) `README.md` line 3 "still unobserved", `docs/ARCHITECTURE.md` line 168 "remains unobserved", [historical document omitted] line 158 "was not observed", and `docs/AUTHENTICATION-AND-SECURITY.md` "What that run did not demonstrate: write prevention by `--mode plan` or `--sandbox enabled`"; (2) no OS-level sandbox is claimed — every hit denies one; (3) defense-in-depth labelling and the four residual gaps survive in the `README.md` banner, `docs/ARCHITECTURE.md` line 168, and `docs/AUTHENTICATION-AND-SECURITY.md` line 382; (4) the probe's three numbered items, three "did not demonstrate" bullets, and "They are not a substitute for an observed client-side permission mode." are untouched at the HX-002 line numbers; (5) every dogfood sentence attributes authentication to the human and the already-authenticated official client, and no `doctor` claim changed; (6) [historical document omitted] "Out of this slice" still names `reviewer.implementation`, review-cycle loops, and Codex/Claude adapters, and the `README.md` banner still calls them not implemented; (7) traceability now holds for every written fact, including the clauses that `DOC-FINDINGS` had flagged.

## Review

Verdict: APPROVE (HX-004, Claude Code, Opus 5, effort high, vendor Anthropic)

The HX-003 correction is complete and contained. `DOC-FINDINGS` is closed: no scoped file states that findings were persisted into the fixture's task artifact, and the only surviving "validated findings" string is the `README.md` banner's general capability sentence, which names no run and mirrors the `AGENTS.md` grant literal. `OBS-ARCH-FIXTURE` is closed: `docs/ARCHITECTURE.md` line 168 now carries the "in a throwaway fixture worktree" qualifier, so all four files agree. Both corrected clauses were re-traced to `0003` HX-021 directly, not to the HX-002 finding text. All seven honesty items hold, all nine acceptance criteria are satisfied, and `npm run typecheck` and `npm test` pass at exit 0. The three recorded clauses are the only differences from the HX-002 read of the six edit sites; `docs/AUTHENTICATION-AND-SECURITY.md` was not edited at all.

No new findings. No observation carried forward.

Prior review history, retained because it explains the shipped wording: HX-002 recorded `CHANGES` on `DOC-FINDINGS` — `README.md` line 243 and [historical document omitted] line 156 claimed "the validated findings" were written, while the run recorded zero findings — and raised `OBS-ARCH-FIXTURE` as a non-blocking consistency observation. HX-003 applied the suggested clause for each finding plus the optional insertion. Both are resolved above and are not reopened.

Standing limitation, recorded rather than resolved: the repository has no commits, so no round in this task could diff against a baseline. Containment was established by modification time plus a full re-read of the six edit sites. A first commit would remove this limitation for future rounds; it is a human gate and was not requested here.

## Blockers

None.

## Next Action

None. Every acceptance criterion is satisfied, checks have recorded outcomes, the required review is `APPROVE`, and no blocker remains.

## Next Handoff

Non-binding suggestion for a possible new task; this artifact is complete and must not be reopened.

```text
Recommended execution (human decides):
- Host: Claude Code, the `AGENTS.md` binding for `planner`
- Model and effort: Sonnet, effort high — routine, narrow documentation staleness (fallback: Opus 5, effort high)
- Role: planner
- Invocation: `/spartan`, passing the prompt block below as the argument
```

```text
Create a uniquely numbered artifact from `assets/task-template.md` in `spartan/tasks/`, suggested slug `readme-shipped-surface-wording`. Do not open or update `spartan/tasks/0004-phase-2a-dogfood-docs.md` or `spartan/tasks/0003-cursor-plan-review-dogfood.md`.

Act as planner. Plan the documentation-only correction of `OBS-README-PLANNED`, raised in task 0003: `README.md` line 28 calls the public surfaces "planned" and line 203 says `spartan-bridge doctor` "is planned to", while the Phase 2A status banner and the recorded dogfood show both as shipped. Success: a closed plan naming each stale sentence, its replacement, and what must remain unchanged — above all the authentication boundary text around line 203 and the recorded hostile-probe limit.
Run the relevant repository checks and update the new task file.

Return only the next handoff, or a completion notice if no work remains.
```
