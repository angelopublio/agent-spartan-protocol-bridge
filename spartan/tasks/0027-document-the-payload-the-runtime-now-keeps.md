---
protocol: "1.0.0" # x-release-please-version
id: document-the-payload-the-runtime-now-keeps
created_at: 2026-08-19
status: completed
phase: complete
task_type: implementation
risk: routine
current_role: implementer
next_role: none
updated_at: 2026-08-23
handoff_id: HX-006
next_handoff_id: none
---

# Document the payload the runtime now keeps

## Objective

A reader of this repository's security boundary and decision record learns that a failed extraction
retains provider text on disk, where it lands, how large it can be, and what was done to it before it
was written. Today that behaviour ships and appears in neither document.

## Context

Task `0021` added retention on the `output_unparsable` path: on a failed extraction the candidate text
is redacted, truncated, and written into the run directory, and `AdapterFailureRecord` gained a
`payload_log` pointer to it. `docs/AUTHENTICATION-AND-SECURITY.md` and D-018 name only
`adapter-stderr.log`. Task `0026` (README) is completed and remains out of Scope.

## Scope

- `docs/AUTHENTICATION-AND-SECURITY.md`: retained-provider-text paragraphs.
- `docs/DECISIONS.md`: dated extension of D-018 (new entry naming D-018) for payload retention.
- `docs/ARCHITECTURE.md`: one paragraph on extraction/retention obligations for adapters.
- This task artifact.

## Out of Scope

- Behaviour change to caps, markers, redaction, modes, or pointers.
- `README.md` (task `0026`, completed) and unrelated `AGENTS.md` edits.
- Re-arguing whether retention should exist.

## Constraints

- Describe the build verified against `src/`.
- No retained provider text, absolute paths, or machine-specific detail in docs.
- D-018's original text is not silently rewritten; the extension is dated.

## Decisions

### D1 - Amend the homes that already make the claim

Correct `docs/AUTHENTICATION-AND-SECURITY.md` and `docs/DECISIONS.md` where stderr retention is
already described, rather than inventing a third home for retention.

### D2 - New dated decision entry extending D-018

D-018 documents stderr retention and does not claim exclusivity, but by omission readers treat
stderr as the only provider file. A new dated entry (D-040) extending D-018 records
`adapter-payload.log` without rewriting D-018's original rationale.

### D3 - Document the shared extraction/retention obligation

`extractReviewPayload` lives in `src/adapters/cursor.ts` and is reused by Grok; retention composition
and persistence live in core (`composeRetainedPayload`, `writeAdapterPayloadAtomic`). Architecture
states that a new stdout-parsing adapter reuses that extractor (or an equivalent) and the core
retention path rather than inventing a blank one, naming the `output_unparsable` failure they answer.

### D4 - Say what the payload file is for

On `output_unparsable`, when no verdict was recorded and stderr may be empty, `adapter-payload.log`
is the only copy of the adapter's stdout candidate the run keeps. That "only copy" claim is relative
to provider answer text, not to classification fields in `status.json`.

## Work Completed

- Implementer (Grok, grok-4.5, high), 2026-08-23: after plan pass and automatic producer_failure,
  documented adapter-payload.log in AUTH, added D-040, and stated extraction/retention reuse in
  ARCHITECTURE. After impl-review finding, named Codex alongside Cursor and Grok for artifact-only plan workspaces.


- Planner (Claude Code): created the task from `0021` completion notice.
- Planner (Claude Code), 2026-08-20: added D4 after the first live retained payload.
- Planner (Grok, grok-4.5, high), 2026-08-23: revalidated against `src/` constants; chose D-040 as a
  dated extension of D-018; updated D3 for Grok's reuse of `extractReviewPayload`; set envelope for
  Bridge plan review.

## Evidence

- AUTH names `adapter-payload.log`, mode `0600`, 16 KiB cap, truncation marker, redaction-before-truncation, and `payload_log`.
- `docs/DECISIONS.md` D-040 extends D-018.
- `docs/ARCHITECTURE.md` states stdout-parsing adapters reuse `extractReviewPayload` and core retention.
- `rg adapter-payload docs/` returns AUTH and DECISIONS hits; no sentence claims stderr is exclusive.
- Constants match `src/runtime/store.ts`, `src/policy/redact.ts`, and `src/core/review.ts`.
- Plan review `run-d6cbfdc8-0aaf-4a17-b650-cccb9c7ba701` passed.
- Repository checks: `npm run typecheck` exited 0.


## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-d6cbfdc8-0aaf-4a17-b650-cccb9c7ba701 execution_id=exec-c09a7cb2-b766-42a7-b35e-c42c47c1af9b review_kind=plan verdict=pass reason_code=review_passed host=grok launcher=grok-plan-reviewer-v1 model=grok-4.5 effort=high model_observed=declared_unobserved policy_digest=sha256:bd8320f1e4119cb68aac27f31b7904f6290842a8b8e5b4b22ce0b8437cecc140 task_hash=sha256:2d7d4d50c52b4fab3c319849b68f6ec21191d5bd489128779c423134b65fc6fb agents_hash=sha256:34a05624b8de1c1eb73989b6478e3d4c3f21618320d3d4ce833ac808965d3ab9 timestamp=2026-08-23T17:23:08.682Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-7a58e98c-64a0-467f-899e-4c2fca110277 execution_id=exec-368c6083-264d-4c29-ad2d-71859a2eb88f review_kind=implementation verdict=pass reason_code=review_passed host=grok launcher=grok-plan-reviewer-v1 model=grok-4.5 effort=high model_observed=declared_unobserved policy_digest=sha256:d690b4307d9d8413f4be8daf675a265e5318b5e18c29837967b091ebb339ae77 task_hash=sha256:5e705dfbd253ed93632d2c98060bd7c7ea8e964d106101117742a5973f28e0d2 agents_hash=sha256:34a05624b8de1c1eb73989b6478e3d4c3f21618320d3d4ce833ac808965d3ab9 timestamp=2026-08-23T17:30:24.157Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

None.

## Next Action

None. Task completed: payload retention is documented.


## Acceptance Criteria

- [x] D1/D4: AUTH doc names `adapter-payload.log`, when it exists, mode `0600`, 16 KiB cap, truncation
      marker, redaction-before-truncation, `payload_log` pointer, and that retained text does not enter
      `status.json`/`events.jsonl`/stdout/stderr; states the recoverable-answer purpose on
      `output_unparsable`.
- [x] D2: `docs/DECISIONS.md` gains dated D-040 extending D-018 for payload retention.
- [x] D3: `docs/ARCHITECTURE.md` states the reuse obligation for extraction/retention.
- [x] D1/D2: No sentence still implies `adapter-stderr.log` is the only provider-byte file a run may write.
- [x] Named values match `src/` constants.
- [x] `npm run typecheck` and `npm test` exit 0.

## Next Handoff

No outstanding handoff. Task completed.
