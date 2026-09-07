---
protocol: "0.6.1" # x-release-please-version
id: doctor-scope-alignment
created_at: 2026-08-17
status: completed
phase: complete
task_type: implementation
risk: material
current_role: reviewer
next_role: none
updated_at: 2026-08-17
handoff_id: HX-003
next_handoff_id: none
---

# Align the documented `doctor` scope with shipped behavior

> Editorial note (2026-09-07): unused platform names and historical integration-document names were generalized for publication. The historical optional-integrations document refers to the former combined cockpit and Board documentation; its Board material is now in `docs/BOARD.md`. Any example path in this cleanup is a normalized placeholder. Original round outcomes, commands, and technical findings are retained; historical line references are not current navigation targets.

## Objective

`README.md`, `AGENTS.md`, and `docs/AUTHENTICATION-AND-SECURITY.md` describe the same `doctor` scope, and that description matches what `spartan-bridge doctor` actually prints, with every authentication-boundary prohibition sentence preserved verbatim and still positioned so that it reads as scoping `doctor`.

## Context

`OBS-DOCTOR-SCOPE-NARROW`. `README.md:205` and `AGENTS.md:76` say `doctor` checks only executable and supported-interface availability. The shipped command also reports repository readability and registry readability plus schema validity. Neither of those is an executable nor a supported interface, so the two sentences misdescribe shipped behavior rather than merely understating it. `AGENTS.md` states the narrow scope as a policy permission (`may check only`), so the gap is a policy-versus-implementation mismatch, not a wording preference.

Keeping the narrow wording is therefore not an available option. The genuine fork was: widen the wording, or narrow what `doctor` prints. This round closes that fork (see Decisions).

`tests/cli.test.ts:104-107` already asserts that `doctor` output matches neither `authenti`, nor `billing`, nor `account identity`. The prohibition is covered by tests; only the positive scope wording is wrong.

## Scope

- `README.md:205`: replace the positive scope sentence.
- `AGENTS.md:76`: replace the positive scope clause of the `doctor` bullet.
- `docs/AUTHENTICATION-AND-SECURITY.md:332`: reference wording; expected to stay unchanged.

## Out of Scope

- Any change to `src/core/doctor.ts` or to `doctor` output.
- Any change to `tests/cli.test.ts`.
- `spartan/tasks/0005-readme-shipped-surface-wording.md`, which this task neither opens nor updates.
- Wording of `doctor` in `docs/ARCHITECTURE.md`, the historical optional-integrations document, [historical document omitted], and `docs/AUTHENTICATION-AND-SECURITY.md:120`, none of which assert a narrow scope.

## Constraints

- Documentation only. No product-code or test change.
- The prohibition sentences stay verbatim and keep their current position immediately after the `doctor` scope sentence in each file: `it must not inspect authentication, account identity, subscription, or billing.` (`AGENTS.md`) and `It must never inspect authentication, accounts, credential stores, or billing.` (`README.md`).
- No new fact may be introduced beyond the non-secret integration facts already documented at `docs/AUTHENTICATION-AND-SECURITY.md:332`.
- English only.
- The planner role may not edit product files; the edits belong to an authorized implementer round.

## Acceptance Criteria

- [x] `README.md:205` and `AGENTS.md:76` describe the same `doctor` scope as `docs/AUTHENTICATION-AND-SECURITY.md:332`.
- [x] The described scope covers every line `formatDoctorReport` emits: repository readability, registry readability and schema validity, launcher identifier resolution, fake-interface capability flags, Cursor launcher executable and interface availability.
- [x] Both prohibition sentences are byte-identical to their current text and still immediately follow the scope sentence.
- [x] `npm run typecheck` and `npm test` pass unchanged.

## Decisions

- **Widen the wording; do not narrow `doctor` output.** Repository readability and registry readability plus schema validity are the diagnostic core of the command — they are what tells an operator whether the Bridge can read the repository and the client-context registry at all. Removing them to satisfy a sentence would delete useful non-secret diagnostics and force test churn, in exchange for nothing: the facts are already public, already documented at `docs/AUTHENTICATION-AND-SECURITY.md:332`, and disclose no authentication, account, subscription, or billing state.
- **`docs/AUTHENTICATION-AND-SECURITY.md` is the reference text.** It is the only one of the three that already matches shipped behavior, so the other two align to it rather than a fourth phrasing being invented.
- **The boundary is untouched.** Widening describes what `doctor` does; it does not relax what `doctor` may not inspect. The prohibition clauses are reproduced verbatim in the exact replacement text below so an implementer round cannot drift them.

### Exact replacement text

`AGENTS.md:76` — replace the whole bullet with:

```text
- `doctor` may check only non-secret integration facts: repository readability, registry readability and schema validity, launcher identifier resolution, fake-interface capability flags, and Cursor launcher executable and interface availability; it must not inspect authentication, account identity, subscription, or billing.
```

`README.md:205` — replace only the third sentence of the paragraph (`spartan-bridge doctor` checks only executable and supported-interface availability.) with:

```text
`spartan-bridge doctor` checks only non-secret integration facts: repository readability, registry readability and schema validity, launcher identifier resolution, fake-interface capability flags, and Cursor launcher executable and interface availability.
```

The rest of that paragraph, including `It must never inspect authentication, accounts, credential stores, or billing.` and the sentences before and after, stays unchanged.

## Work Completed

- Confirmed the mismatch against implementation truth rather than against the reported output alone: `src/core/doctor.ts:141-147` builds `repo: <readable|unreadable>` and `registry: <readable|unreadable>; schema <valid|invalid>` as the first two report lines, neither of which is an executable or a supported interface.
- Confirmed the three documentation sites and their exact current text (`README.md:205`, `AGENTS.md:76`, `docs/AUTHENTICATION-AND-SECURITY.md:330-343`).
- Confirmed no other documentation file asserts the narrow scope, so the fix is bounded to two sentences.
- Confirmed `tests/cli.test.ts:100-107` asserts the prohibition but asserts nothing about the positive scope, so no test needs to change and none guards the widened sentence.
- Closed the fork and recorded the exact replacement text above, so the implementer round is a mechanical edit with no remaining judgment.
- Round executed in Claude Code on Claude Opus 5.
- Plan review (HX-001) recorded `APPROVE`. Round executed in Cursor on Grok 4.6, a different vendor from the Claude Code planner.
- Accepted matching handoff HX-002. Applied the two Exact replacement text edits to `AGENTS.md:76` (whole `doctor` bullet) and `README.md:205` (third sentence of the auth paragraph only). `docs/AUTHENTICATION-AND-SECURITY.md` was not written.
- Implementation round executed in Cursor on Grok 4.6.
- Accepted matching handoff HX-003. Implementation review recorded `APPROVE`; both replacements are byte-identical to the Exact replacement text, both prohibition sentences are unchanged and still immediately follow the scope sentence, and `docs/AUTHENTICATION-AND-SECURITY.md` is unchanged.
- Implementation review executed in Claude Code on Claude Opus 5, not the recommended Cursor/Composer 2.5 round. The human explicitly assigned the reviewer role for this round, which is the admission path for a host `AGENTS.md` binds to another role. Vendor independence from the Grok 4.6 implementer round is preserved and is stronger than the recommended same-host, fresh-context separation. The reviewer wrote only this task artifact; no product file was modified.

## Evidence

- Reported `doctor` run against this repository (accepted as already observed, not re-run): prints `repo: readable`, `registry: readable; schema valid`, `launcher fake-reviewer-v1: resolved`, `launcher cursor-plan-reviewer-v1: resolved`, `fake-reviewer-v1: interface available; review_kind=plan:true; permission_mode=read-only:true; workspace_write:false`, `cursor-plan-reviewer-v1: executable resolved; interface available`. Matches `docs/AUTHENTICATION-AND-SECURITY.md:334-341` exactly.
- `src/core/doctor.ts:139-150` (`formatDoctorReport`): confirms the two non-executable, non-interface lines independently of that run.
- `npm run typecheck`: pass, no output.
- `npm test`: pass, 77/77 tests, 0 failures.
- `grep -n doctor README.md AGENTS.md docs/*.md`: only `README.md:205` and `AGENTS.md:76` state a narrow scope.
- Plan reviewer and implementer both recorded `npm run typecheck` pass (no output) and `npm test` pass (77/77, 0 failures).
- Implementation reviewer byte-check (Python, reading the files on disk): `AGENTS.md:76` equals the Exact replacement bullet exactly (`True`), and its prohibition sentence `it must not inspect authentication, account identity, subscription, or billing.` is preceded only by `...e and interface availability; `. `README.md:205` contains the Exact replacement scope sentence, followed by exactly one space, then `It must never inspect authentication, accounts, credential stores, or billing.` Each prohibition sentence occurs exactly once in its file. The README sentences before (`There are no Bridge login commands.` / `API keys, auth files, cookies, and Keychain data are never valid Bridge input or repository configuration.`) and after (`If an invoked official client reports that external authentication is required, the run stops with a sanitized status.`) are unchanged.
- `docs/AUTHENTICATION-AND-SECURITY.md` unchanged: sha256 `d1f2b74468f72c922a23ce344cd0c6e15af5f8d4123c6344b6d82d1e202a80ab`, size 32743 bytes — identical to the implementer round's recorded hash; line 332 still the reference wording.
- `src/core/doctor.ts:139-150` (`formatDoctorReport`) re-read by the implementation reviewer: emits repo readability, registry readability plus schema validity, per-launcher identifier resolution, fake-interface capability flags, and Cursor executable plus interface availability — the five fact classes the replacement text lists, in that order, with nothing emitted that the replacement omits.
- Implementation reviewer `npm run typecheck`: pass, no output.
- Implementation reviewer `npm test`: pass, 77/77 tests, 0 failures. `src/` and `tests/` untouched by the documentation round.

## Review

### Plan review — Verdict: APPROVE

Widening the `doctor` scope wording in `README.md` and `AGENTS.md` is the right call versus narrowing `doctor` output. Repo and registry/schema lines are the command's diagnostic core, already documented at `docs/AUTHENTICATION-AND-SECURITY.md:332`, and they disclose no authentication, account, subscription, or billing state. Narrowing the command would delete useful non-secret diagnostics and churn tests to satisfy a stale sentence. `AGENTS.md`'s `may check only` remains a closed permission ceiling after the recorded expansion; the boundary is the prohibition clauses, which this plan does not relax.

Both prohibition sentences stay verbatim and immediately after the scope sentence: `AGENTS.md` keeps `; it must not inspect authentication, account identity, subscription, or billing.` in the same bullet; `README.md` replaces only the third sentence of the paragraph, leaving `It must never inspect authentication, accounts, credential stores, or billing.` as the next sentence.

Findings: none blocking. The recorded replacements are not a byte copy of `docs/AUTHENTICATION-AND-SECURITY.md:332` (`schema validity` instead of `schema`; `executable and interface availability` instead of `executable/interface availability via cursor-agent --help`). That delta is justified: policy and the README auth paragraph must not pin probe argv, and `schema validity` matches `formatDoctorReport`. Implement against the Exact replacement text, not by copying line 332.

### Implementation review — Verdict: APPROVE

Both edits are exactly the recorded Exact replacement text and nothing more. `AGENTS.md:76` is byte-identical to the planned bullet; `README.md:205` replaced only the third sentence, leaving the two sentences before it and the one after it intact. Both prohibition sentences are byte-identical to the Constraints quotes, each occurs exactly once in its file, and each still sits immediately after the scope sentence — separated by `; ` in `AGENTS.md` and by a single space in `README.md`. `docs/AUTHENTICATION-AND-SECURITY.md` is untouched, confirmed by a hash identical to the implementer round's.

The widened wording is accurate against implementation truth: `formatDoctorReport` emits exactly the five fact classes named, and no sixth. The permission ceiling in `AGENTS.md` (`may check only`) stays closed, and the boundary is unchanged in both direction and wording.

Findings: none. The delta from `docs/AUTHENTICATION-AND-SECURITY.md:332` (`schema validity`, and `executable and interface availability` without the `cursor-agent --help` probe argv) is the one the plan review already justified and accepted; policy and the README auth paragraph correctly avoid pinning probe arguments.

## Blockers

None.

## Next Action

None. All acceptance criteria are satisfied, both reviews are `APPROVE`, and the task is complete.

## Next Handoff

Non-binding suggestion for a possible new task; this artifact is complete and must not be reopened.

```text
Recommended execution (human decides):
- Host: Claude Code, the `AGENTS.md` binding for `planner`
- Model and effort: Opus 5, effort high, because the baseline decides what enters the repository's first commit and touches the human-only Git gate (fallback: Sonnet, effort high)
- Role: planner
- Invocation: `/spartan`, passing the prompt block below as the argument
```

```text
Create a uniquely numbered artifact from `assets/task-template.md` in `spartan/tasks/`, suggested slug `git-baseline-for-review-evidence`. Do not open or update `spartan/tasks/0006-doctor-scope-alignment.md`.

Act as planner. Plan how to close `OBS-NO-GIT-BASELINE`, recorded in task 0005 and still true: the repository has no commit, so every path is untracked and `git diff` gives review rounds no scope evidence — tasks 0005 and 0006 both had to verify scope by exact-string checks and file hashes instead. Success: a closed plan naming what the first commit includes and excludes, what `.gitignore` must already cover, and how the commit itself stays behind the `AGENTS.md` human-only Git gate.
Run the relevant repository checks and update the new task file.

Return only the next handoff, or a completion notice if no work remains.
```
