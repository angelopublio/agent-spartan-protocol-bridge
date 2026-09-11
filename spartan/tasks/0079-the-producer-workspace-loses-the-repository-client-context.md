---
protocol: "1.1.0" # x-release-please-version
id: the-producer-workspace-loses-the-repository-client-context
created_at: 2026-09-11
status: active
phase: reviewing
task_type: implementation
risk: high-impact
current_role: implementer
next_role: verifier
updated_at: 2026-09-11
handoff_id: HX-005
next_handoff_id: HX-006
---

# The producer workspace loses the repository's client context

## Objective

The Bridge runs the producer in a temporary directory outside every repository. A host launcher
that selects per-account configuration from the working directory therefore resolves the wrong
account, and the producer dies before writing anything. The reviewer adapters were already fixed
for this class; the producer path was not.

## Context

Observed on 2026-09-11 in a managed repository whose client context differs from the machine
default. The plan review passed and the auto-chain started the implementer, which exited 1 after
4.4 seconds having written no product file. The same client, same model and same machine succeed
when invoked with the repository as the working directory.

The mechanism is four facts that only bite together:

- `src/core/workspace.ts:1135` — the producer workspace is `fs.mkdtemp` under `os.tmpdir()`, a
  location that belongs to no repository.
- `src/adapters/producer-write-scope.ts:93` — `applyProducerIsolation` *refuses* a workspace inside
  the repository with `confine_unavailable`, so the producer can never run with the repository as
  its working directory. The placement is deliberate, not incidental.
- `src/adapters/cursor.ts:713` — the producer spawn sets `cwd: input.workspace_root` and passes that
  same path as `--workspace`. `src/adapters/codex.ts:642` and `src/adapters/grok.ts:578` do the same.
- The machine-local launcher wrapper resolves its profile from the working directory, and the
  producer copy carries nothing that lets it resolve otherwise. Every reviewer workspace does carry
  that declaration; the producer copy is the one workspace of this shape that does not.

**Why it stayed hidden.** In a repository whose client context *is* the machine default, the wrong
resolution and the right one coincide, so the auto-chain works. The defect only appears in a
repository belonging to a different context — which is exactly where adopting the Bridge matters.

## Scope

Nothing here edits an authority path. The repository authority file AGENTS.md is a read-and-copy
input to the producer workspace, never an edit target, and no path this plan changes lies outside
the automatic implementation write scope.

- `src/core/workspace.ts` — `prepareProducerWorkspace` gains the authority-file carriage; the
  merge classifiers and `PRODUCER_SUPPORT_SCOPE` are unchanged.
- `src/adapters/cursor.ts` — `CURSOR_ENV_ALLOWLIST` gains one key, for the separate nested-session
  reason named in D-3. The producer spawn's cwd and `--workspace` pair are unchanged.
- `src/core/doctor.ts` — `collectDoctorWarnings` and `wrapperLauncherWarnings`.
- `src/policy/agents-policy.ts` — retain the valid, non-empty context cells as declared, alongside
  the normalized binding values, so `doctor` can distinguish omission from explicit `default`.
- `src/adapters/producer-write-scope.ts` — read for the invariant in D-4; unchanged.
- `docs/AUTHENTICATION-AND-SECURITY.md` — the producer-copy contents sentence and the review-cwd
  sentence.
- `docs/DECISIONS.md` — one dated entry, and its relationship to D-055.
- `tests/producer-write-scope.test.ts`, `tests/workspace.test.ts`, `tests/doctor.test.ts`,
  `tests/cursor-adapter.test.ts`, `tests/agents.test.ts`.

## Out of Scope

- The producer diagnostic gap. The client wrote the reason to its stdout, the runner retained it
  (`retainStdout: true`) and `waitProducer` returned only `{ exitCode, timedOut }`. That is task
  `0073`, and it is what turned this diagnosis into six experiments.
- Reading, copying, storing or forwarding any credential or authentication file. The fix copies one
  tracked repository file and forwards configuration selectors only, exactly as the Codex and
  Claude allowlists already do.
- The plan-target scan's advisory tokens observed in the same runs. That is task `0074`.
- Changing which model or effort a binding declares. The failing account was the wrong account, not
  an exhausted one.
- Any change to where the producer workspace is placed, or to the sandbox profile's clauses. D-2
  and D-4 turn on both staying exactly as they are.

## Constraints

- A workspace inside the repository is refused for a structural reason, not a stylistic one: the
  sandbox profile allows writes under the workspace and then denies writes under the repository
  root, and the last matching rule wins. Any placement change must keep that deny effective.
- `.spartan-bridge/` is not a candidate location. A producer write there is a
  `runtime_state_violation` by design, and the directory is in `SKIPPED_DIR_NAMES`, so snapshots
  would not see the copy at all.
- Carrying an authority file into a producer copy the sandbox permits writing is a new surface. The
  merge must refuse a producer edit of that file, asserted by a test rather than assumed.
- The fix must not require the operator to export variables by hand before each round. A correction
  that works only when invoked a particular way has not fixed the auto-chain.
- **This repository cannot verify the fix end to end, and a criterion that assumes it can is
  unsatisfiable.** Its declared client context is the machine default, so the wrong resolution and
  the right one coincide here and the defect does not reproduce at all; separately, the account
  this repository resolves has no usable balance for a producer round. Verification therefore needs
  a repository whose declared client context differs from the machine default *and* whose resolved
  account can complete a producer round. Criteria are written so that the repository-local suite
  proves the mechanism — which selectors reach the child, what the producer copy holds, where the
  workspace is placed — while the end-to-end proof is a recorded observation from such a
  repository, carried back sanitized: counts, reason codes and state names, never a path, an alias,
  or an account detail.

## Decisions

**D-1. Adopt direction (a): carry the authority file into the producer copy. Refuse (b) and (c).**

(a) is not a new mechanism. Every reviewer adapter already writes a byte-identical copy of the
repository authority file at the root of a workspace under `os.tmpdir()`, at mode `0444`, and then
spawns the reviewer with that workspace as its working directory — `src/adapters/cursor.ts:445` and
`:506`, `src/adapters/codex.ts:378` and `:435`, `src/adapters/grok.ts:344` and `:400`,
`src/adapters/claude.ts:287` and `:336`. `docs/AUTHENTICATION-AND-SECURITY.md:668` already states
why, for review only. The wrapper's resolver prefers a unique declared context in the nearest
authority file over any path heuristic (Evidence E-2), so that copy is exactly what makes a
working-directory resolver land correctly from a temporary directory. The producer copy is the one
workspace of this shape that omits it. The change lands in `prepareProducerWorkspace`, whose single
call site is `src/core/transition.ts:673`, so one edit covers all four producer adapters and every
future one.

(b) is refused on evidence, not on preference. The wrapper's guard for the Cursor Agent CLI fires
only when `AGENT_CLI_CREDENTIAL_STORE` and `AGENT_PROFILES_REAL_HOME` are both set, over an already
relocated `HOME`. In the human-started planner session that spawns the producer, both are unset
(Evidence E-1): the wrapper exports them only in its own Cursor Agent branch, never in the branch
that starts a Claude Code session. Forwarding a variable the parent does not hold forwards nothing.
(b) is also per-adapter — four allowlists today, and a fifth host reintroduces the defect — while
Grok forwards no such selector at all.

(c) is refused twice over. An in-repository placement is refused by `applyProducerIsolation`
(`src/adapters/producer-write-scope.ts:93`) and that refusal is load-bearing: SBPL takes the last
matching rule, and the profile emits the repository-root deny after the workspace allow
(`producerIsolatedSandboxProfile`, `:46`), so a nested workspace would be unwritable unless the deny
were moved off the end. Any out-of-repository placement leaves the resolver walking up from a
directory the repository's authority file does not cover, so it does not close the defect either.
Placement is the largest change available and the only one that buys nothing.

**D-2. What is carried, and how.** One file: the repository root authority file, copied to the root
of the producer copy, byte-identical, mode `0444`, after the write-scope and support-scope copies
and before the baseline snapshot, inside `prepareProducerWorkspace`. It is a dedicated envelope
constant in `src/core/workspace.ts`, mirroring `ImplementationReviewEnvelopeFile` at `:70`. It is
*not* added to `PRODUCER_SUPPORT_SCOPE`: that constant is also passed as `collapsePrefixes` to the
baseline snapshot (`src/core/workspace.ts:1156`), which would record the authority file as a
collapsed metadata digest rather than a file entry and would couple it to the node_modules support
machinery. The copy uses the existing read-only path of `copyExactProducerFile`, which writes with
`flag: "wx"`; a collision is impossible because the resolved automatic write scope can never admit
an authority path (Evidence E-5). Placement does not change.

**D-3. One allowlist key, for a different reason than this defect.** `CURSOR_ENV_ALLOWLIST` gains
`AGENT_PROFILES_REAL_HOME`, forwarded only when the parent already exports it, matching what the
Codex (`src/adapters/codex.ts:104`) and Claude (`src/adapters/claude.ts:96`) allowlists already do.
This does not close this defect — E-1 shows the variable is absent in the session that reproduced
it — and the plan makes no claim that it does. It closes the adjacent case the wrapper's own comment
names: a Bridge spawned from a relocated-`HOME` Cursor Agent session, where the guard would fire if
the marker reached the child and instead re-resolves from a relocated home. The Bridge never sets,
defaults, or reads the value.

**D-4. The sandbox deny stays effective because nothing about placement or the profile changes.**
What stays the same: `prepareProducerWorkspace` still creates the workspace with `fs.mkdtemp` under
`os.tmpdir()`; `applyProducerIsolation` still refuses a workspace at or inside the repository root
with `confine_unavailable`; `producerIsolatedSandboxProfile` emits the same clauses in the same
order, so the repository-root `file-write*` deny and the repository-root `file-link` deny remain the
last clauses matching any repository path; `PRODUCER_SUPPORT_SCOPE`, `PRODUCER_SCRATCH_PREFIXES`,
`classifyProducerWorkspacePath`, and the producer spawn's cwd and workspace argument are untouched.
The complete list of what changes in the producer copy: it gains one regular file at its root, the
authority file, at mode `0444`, and the baseline snapshot gains the one matching file entry. The
sandbox permits writing that copy, because it lies under the workspace allow; D-5 is what refuses
the write. The repository's own authority file stays under the deny, unreachable to the producer.

**D-5. The merge already refuses a producer edit of a carried authority file, in two independent
places, and the carried case must be asserted rather than inherited.** `captureProducerMerge`
throws `ProducerMergeError` for any diff entry whose classification is not `admitted` and,
separately, for any entry `isAuthorityWritePath` matches (`src/core/workspace.ts:1427`);
`validateMissingTopology` repeats the authority check on the apply side (`:1623`). Both disjuncts
fire for a carried authority file, because the resolved automatic write scope can never admit one
(E-5), so the entry classifies as `refused` *and* matches the authority predicate. The reason code
is `write_scope_violation`. What is not asserted today is the carried shape: the one existing case
(`tests/producer-write-scope.test.ts:379`) covers a file *appearing* in a workspace under a
synthetic scope that admits it. The cases this plan creates are `changed`, mode-only `changed`, and
`vanished`, against a baseline that already holds the file, under the repository's real write scope.

**D-6. `doctor` can report the residual case before a round, and must not report the account.**
`doctor` already reads the machine-local wrapper script and warns on its shape —
`wrapperLauncherWarnings` (`src/core/doctor.ts:430`) detects the wrapper, checks that its resolver
sibling exists, and checks a `HOME` shape — so this class is inside its boundary and needs no new
one. Two bounded changes. First, `collectDoctorWarnings` (`:468`) stops skipping the `implementer`
binding at `:478`; that skip is why the producer host's launcher environment was never examined and
why `binding implementer: adapter available` was the only line the operator ever saw. Second, one
new warning fires when the producer binding's launcher is wrapper-shaped *and* the repository's
Agent hosts table declares more than one distinct client context across its bindings — the single
case the carried authority file cannot disambiguate, because the resolver takes its declared-context
rule only when the column yields exactly one alias (E-2). `doctor` gains no check of which account a
launcher reaches: that is account identity, which the authentication boundary forbids it. The
`adapter available` line keeps its current meaning, and the documentation says what it does and does
not prove.

**D-7. Verification splits at the repository boundary.** The repository-local suite proves the
mechanism: what the producer copy holds, at what mode, that the baseline records it, that the merge
refuses every edit shape, that placement and the profile are unchanged, that the allowlist forwards
the new key only when the parent holds it, and that `doctor` warns in the residual case and stays
silent otherwise. The end-to-end proof is one recorded observation from a repository whose declared
client context differs from the machine default and whose resolved account can complete a producer
round, carried back sanitized. "Complete a producer round" is observable, not inferred from the
absence of one failure: the transition reaches `producer_finished` and then `reviewing`, and an
`implementation_review_result` event is recorded for it. A timeout, a stop at any other stage, or a
run that never leaves `producer_running` is not a completion. The implementation round completes
when the local criteria pass; the task closes when that observation is recorded.

**D-8. One dated `docs/DECISIONS.md` entry, D-075, naming its relationship to D-055.** D-055 moved
the Codex *review* spawn's cwd to the workspace root so a working-directory resolver would run
there, and forwarded `CODEX_HOME` so it could be skipped. D-075 supplies the thing that makes such a
resolver land *correctly* from a workspace under `os.tmpdir()` — the repository's own declaration —
and does it for producers, host-neutrally, in core rather than per adapter. D-055's forwarding
remains the Codex-specific shortcut; D-075 is the general case that does not depend on the parent
environment holding anything.

## Acceptance Criteria

Derived from the decisions above, last. Each row names the decision it comes from.

| # | Criterion | From |
| --- | --- | --- |
| AC-1 | `prepareProducerWorkspace` places a copy of the repository root authority file at the root of the producer copy, byte-identical to the repository's, at mode `0444`. A test on the prepared copy asserts the bytes and the mode. | D-2 |
| AC-2 | The baseline snapshot of the prepared copy records that path as a regular file entry, not as a collapsed metadata digest, and `PRODUCER_SUPPORT_SCOPE` and `PRODUCER_SCRATCH_PREFIXES` are unchanged. A test asserts the entry kind and the two constants. | D-2 |
| AC-3 | The prepared copy's entry set equals the set it held before this change plus exactly that one path. A test asserts the set difference is a single element. | D-4 |
| AC-4 | `applyProducerIsolation` still throws `confine_unavailable` for a workspace at, or nested inside, the repository root, and `producerIsolatedSandboxProfile` still emits both repository-root deny clauses after the workspace allow clause. Tests assert both, so a later placement change cannot land silently. | D-4 |
| AC-5 | With the authority file present in the baseline and the repository's real automatic implementation write scope in force, `captureProducerMerge` rejects a content edit of it with `ProducerMergeError` carrying `write_scope_violation`. | D-5 |
| AC-6 | Under the same setup, `captureProducerMerge` rejects a mode-only change of that file, and rejects its deletion, each with `ProducerMergeError` carrying `write_scope_violation`. | D-5 |
| AC-7 | The existing appearing-file case at `tests/producer-write-scope.test.ts:379` still passes unchanged; AC-5 and AC-6 are added beside it rather than replacing it. | D-5 |
| AC-8 | `CURSOR_ENV_ALLOWLIST` forwards `AGENT_PROFILES_REAL_HOME` to the child when the parent exports it and omits the key entirely when the parent does not. A spawn-level test asserts both directions. The Bridge originates no value. | D-3 |
| AC-9 | `collectDoctorWarnings` evaluates the `implementer` binding's launcher, so a wrapper-shaped producer launcher can raise the existing wrapper warnings. A `doctor` test asserts a warning naming the `implementer` binding. | D-6 |
| AC-10 | `doctor` emits exactly one warning naming the `implementer` binding when its launcher is wrapper-shaped and the Agent hosts table declares more than one distinct client context across its bindings, and emits none when the table declares one. Two fixtures assert the two outcomes. | D-6 |
| AC-11 | That warning is produced from the launcher script's text and the parsed Agent hosts table alone. Its text names no account, no profile path, and no credential variable value. A test asserts the text and that no other input is read. | D-6 |
| AC-12 | Every `binding <name>: adapter available` line keeps its current wording and position, so the `/spbridge` skill's single-line read is unaffected. A test asserts the binding-line format is unchanged. | D-6 |
| AC-13 | `docs/AUTHENTICATION-AND-SECURITY.md` states that the producer copy holds a byte-identical authority-file copy at its root for the same reason the review workspace does, and that the merge refuses a producer edit of it. The existing review-cwd sentence at `:668` is extended rather than duplicated, and the producer-copy contents sentence at `:633` names the added file. | D-2, D-5 |
| AC-14 | `docs/DECISIONS.md` gains one dated entry, D-075, recording D-1 through D-6 and stating the relationship to D-055 as D-8 frames it. | D-8 |
| AC-15 | Repository check row: from a tree whose only modifications are this task's own, `npm run build` and `npm test` both succeed, with no failure and no test removed or skipped. The suite count rises by the tests AC-1 through AC-12 add, above the 561 recorded in E-8. The changes stay uncommitted; commit is a separate action the human authorizes at the task boundary. | repository check |
| AC-16 | Verification dependency, not an implementer gate. One sanitized observation from a repository whose declared client context differs from the machine default, recording a producer round that completed as D-7 defines it: the transition reached `producer_finished` and then `reviewing`, and an `implementation_review_result` event was recorded for it. Recorded as counts, reason codes, state names and event types only — never a path, an alias, or an account detail. | D-7 |

## Work Completed

- Added the byte-identical, fixed-mode `AGENTS.md` carriage to producer workspace preparation before
  the baseline snapshot, without changing placement, support/scratch scope, classification, or the
  sandbox profile.
- Forwarded parent-provided `AGENT_PROFILES_REAL_HOME` through Cursor's closed environment and made
  `doctor` inspect implementer wrappers, including a single redacted multi-context ambiguity warning.
- Added regressions for copy bytes/mode/entry shape, exact entry-set delta, placement/profile order,
  all three carried-authority mutation shapes, Cursor selector presence/absence, implementer wrapper
  warnings, and unchanged binding-line placement. Updated the security and decision records.
- Corrected the `run-d6111fe2-921b-4de4-8304-d7de74832212` findings: policy parsing now retains
  raw declared context cells so an omitted cell is not mistaken for an explicit `default`, and the
  ambiguity warning is appended without suppressing the wrapper's existing diagnostics. Added
  regressions for omitted and explicit-default cells and for concurrent wrapper warnings.

Human-operator verification round, 2026-09-11, after implementation review cycle 2 terminated
`human_required` on AC-15's measurement. Ran `npm run build` and the full suite in the repository
worktree, the environment the producer copy cannot supply, closing AC-15 at 569 tests / 569 pass /
0 fail / 0 skipped. Re-read the shipped code to confirm the two actionable cycle-1 findings rather
than accepting the correction round's report. No source file was edited in this round, so the
reviewed diff is the diff on disk. AC-16 remains open by construction and is not an implementer
gate; `next_role` is set to `verifier` so the runtime refuses to admit a further review round for a
criterion that is already met.

## Evidence

- **E-1 — the selectors direction (b) would forward are absent.** Run in the human-started planner
  session that spawns the producer, in this repository:
  `for v in CLAUDE_CONFIG_DIR CODEX_HOME AGENT_PROFILES_REAL_HOME AGENT_CLI_CREDENTIAL_STORE CURSOR_CONFIG_DIR CURSOR_API_KEY AGENT_PROFILE_ACTIVE AGENT_PROFILES_RESOLVE; do ... done`
  reporting only whether each name is set. Result: `CLAUDE_CONFIG_DIR: SET`, `CODEX_HOME: SET`, and
  the other six `unset`. The Cursor Agent guard needs the two that are unset, over a relocated
  `HOME` that is also absent. No value was read or recorded.
- **E-2 — the resolver prefers the declared context over the path heuristic.** The example resolver
  `docs/examples/agent-profiles/resolve-profile` states its own order in its header: "1) unique
  Client context in the nearest AGENTS.md 2) longest matching prefix in ~/.agent-profiles/roots
  3) personal". Its declared-context branch is taken only when the column yields exactly one alias
  (`if [ "$count" -eq 1 ]`), which is the residual case AC-10 covers. Walking up from a directory
  under `os.tmpdir()` reaches no authority file, so a producer copy falls to the prefix rule, which
  no entry covers, and lands on the default.
- **E-3 — the reviewer already does what direction (a) proposes.** All four adapters write the
  authority file at the workspace root at `*_WORKSPACE_FILE_MODE = 0o444` and spawn with
  `cwd: this.workspaceRoot`: `src/adapters/cursor.ts:445`/`:506`, `src/adapters/codex.ts:378`/`:435`,
  `src/adapters/grok.ts:344`/`:400`, `src/adapters/claude.ts:287`/`:336`. Both review kinds do it,
  not only implementation review. `docs/AUTHENTICATION-AND-SECURITY.md:668` already records the
  reason: the review cwd "holds a byte-identical `AGENTS.md` copy so a machine-local wrapper can
  still resolve the client context from `$PWD`".
- **E-4 — the producer copy holds no such file.** `prepareProducerWorkspace`
  (`src/core/workspace.ts:1122`) copies only the parsed write scope and `PRODUCER_SUPPORT_SCOPE`
  (`:38`, `["node_modules/"]`). The repository's own `### Automatic implementation write scope` has
  no root-level authority entry, so the file is never copied. The producer spawn's cwd is that copy
  (`src/adapters/cursor.ts:713`, `src/adapters/codex.ts:642`, `src/adapters/grok.ts:578`).
- **E-5 — an authority path can never be in a resolved automatic write scope.**
  `writeScopeContradictsReviewScope` (`src/policy/agents-policy.ts:656`) returns true when
  `AUTHORITY_WRITE_PATHS.some((p) => isPathAdmittedByScope(p, writeScope))`, refusing the policy.
  `AUTHORITY_WRITE_PATHS` is `["AGENTS.md", "spartan-bridge/config.yaml"]`
  (`src/policy/agents-policy.ts:117`). This is why the carried copy cannot collide with a scope copy
  and why the carried path always classifies as `refused` as well as matching the authority
  predicate.
- **E-6 — the merge refusal exists but the carried shape is untested.** The guard is
  `if (classification !== "admitted" || isAuthorityWritePath(entry.path) || producerPathDenied(entry.path)) { throw new ProducerMergeError(); }`
  (`src/core/workspace.ts:1427`), repeated for ancestors at `:1623`. The only test naming an
  authority path is the tuple
  `{ path: "AGENTS.md", scope: ["AGENTS.md"], make: async (_workspace, abs) => fs.writeFile(abs, "authority\n") }`
  in `tests/producer-write-scope.test.ts:379` — a file that *appears*, under a scope invented to
  admit it. No case starts from a baseline that already holds the file.
- **E-7 — `doctor` already models the wrapper and already skips the producer binding.**
  `wrapperLauncherWarnings` (`src/core/doctor.ts:430`) reads the launcher on `PATH`, returns early
  unless the text starts `#!` and mentions `resolve-profile` or `wrap-official-client`, then warns
  when the resolver sibling is missing or when `HOME` has a cursor-home shape. Its caller
  `collectDoctorWarnings` (`:468`) begins each iteration with
  `if (binding.binding === "implementer") { continue; }`, so the producer host is never examined.
  This repository's own `doctor` run reports `binding implementer: adapter available;
  launcher=codex-plan-reviewer-v1` and no warning.
- **E-8 — baseline.** `npm test` in this checkout: `tests 561 / pass 561 / fail 0`, 62.7 s. The
  installed `spartan-bridge` on `PATH` resolves to this checkout's `dist/cli/main.js`, and the build
  is current: newest `src/` mtime `2026-09-11T01:44:45Z` against `dist/cli/main.js`
  `2026-09-11T08:21:45Z`.
- **E-9 — implementation checks.** `npm run typecheck` and `npm run build` each exited 0. The focused
  `producer-write-scope`, Cursor, and doctor run reported 81 tests / 77 pass / 0 fail / 4 existing
  sandbox-dependent skips; the adjusted transition authority-write regression separately passed
  1/1. A non-Git full-suite partition reported 498 tests / 488 pass / 0 fail / 10 existing skips.
- **E-10 — enclosing-workspace limit on the literal full-suite row.** `npm test` enumerated 567
  tests before the final placement regression was added and reported 526 pass / 29 fail / 12 skip;
  the final rerun enumerated 568 and reported 527 pass / 29 fail / 12 skip.
  All 29 failures were confined to `tests/implementation-review.test.ts`,
  `tests/repo-hygiene.test.ts`, `tests/task-status.test.ts`, and `tests/workspace.test.ts`: this
  producer copy has no `.git`, and its enclosing sandbox refuses the fixtures' configured
  `/dev/null` access. The one product-related transition failure initially exposed by that run was
  corrected and passes independently. No failing assertion remains in the runnable partition.
- **E-11 — correction checks.** `npm run typecheck` and `npm run build` exited 0. The affected
  agents-policy, doctor, producer-write-scope, Cursor, and transition run reported 153 tests / 145
  pass / 0 fail / 8 existing sandbox-dependent skips. The full `npm test` enumerated 569 tests and
  reported 528 pass / 29 fail / 12 existing skips; all 29 failures again came from the four
  Git-dependent suites named in E-10 and failed because Git could not open the sandbox-denied
  `/dev/null`. Excluding exactly those four environment-dependent files yielded 499 tests / 489
  pass / 0 fail / 10 existing skips. The test count is eight above E-8's 561 baseline.
- **E-12.** Human-operator measurement closing AC-15, run in the repository worktree on
  2026-09-11 from a tree carrying only this task's modifications. `npm run build` succeeded.
  `npm test` reported **569 tests, 569 pass, 0 fail, 0 skipped**, 60.4 s. Zero skips is the part
  AC-15 asks for and the producer copy could not give: `tests/producer-write-scope.test.ts:259`
  carries `skip: IN_PRODUCER_WORKSPACE`, so the one regression that prepares a real producer copy
  and runs the declared checks inside it ran here and self-skipped there. The count is eight above
  E-8's 561 baseline, matching the tests AC-1 through AC-12 add. The suite was run with stdout not
  attached to a terminal; attached to one, ten pre-existing CLI and MCP assertions fail on an
  inherited `FORCE_COLOR`, which is task `0078` and unrelated to this change.
- **E-13.** The two actionable cycle-1 findings were confirmed fixed by reading the shipped code,
  not by accepting the correction round's report. `DOCTOR_OMITTED_CONTEXT_WARN`:
  `src/policy/agents-policy.ts` now carries `declared_client_contexts` as its own field, populated
  from the raw declared cells, and `src/core/doctor.ts:457` counts that set rather than the
  normalized `client_context`, so an omitted cell no longer contributes the literal `default`.
  `AMBIGUITY_SUPPRESSES_WRAPPER`: `doctor.ts:458` now pushes and the flow continues to the
  remaining wrapper checks before the single `return` at `:478`; the early return is gone.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-e62aba2e-5841-47ae-a59d-c7621d679e0c execution_id=exec-5fa36fcc-7329-4326-968a-ad163c8ffb82 review_kind=plan verdict=pass reason_code=review_passed host=codex launcher=codex-plan-reviewer-v1 model=gpt-5.6-sol effort=high model_observed=declared_unobserved policy_digest=sha256:c032b4cea31dd45976e0e4d6a6b689590f1f0a1a368378fd8a82e546eb9525a3 task_hash=sha256:29fbed223bcc4db619eca27e8a002360ef93c913b8f78626c81dd3831c5fe441 agents_hash=sha256:6bd68578db8fd268d33c5847ff43bbf478ca1ed9c7a17c1a34df7ed723f5b8da timestamp=2026-09-11T13:03:38.487Z
<!-- spartan-bridge:review:plan:end -->
<!-- spartan-bridge:review:implementation:begin -->
Verdict: CHANGES_REQUESTED

Findings:

- `DOCTOR_OMITTED_CONTEXT_WARN` (warning): src/core/doctor.ts:490 builds declaredClientContexts from parsed.client_context plus implementation/implementer/planner, but src/policy/agents-policy.ts:390 normalizes an empty Client-context cell to the literal "default". The resolver rule AC-10 and E-2 are built on (docs/examples/agent-profiles/resolve-profile:30) prints only cells matching the alias regex, so an omitted cell contributes no alias. A legal table that declares one alias and leaves one row's cell empty — planner/reviewer.plan/reviewer.implementation "personal" with `| implementer | Codex |  | gpt-5.6-sol | high |` — yields {"personal","default"}, size 2, so doctor reports that the Agent hosts table "declares more than one distinct client context" while resolve-profile counts exactly one alias and resolves it correctly. The warning is false, and via the early return it also replaces that binding's real wrapper warnings. Count the raw declared cells (distinguishing omitted from declared) instead of the normalized value; dropping "default" instead would create the opposite false negative for a table that writes `default` explicitly in one row.
- `AC15_FULL_SUITE_UNVERIFIED` (warning): AC-15 requires `npm run build` and `npm test` to both succeed, no failure and nothing skipped or removed, from a tree whose only modifications are this task's own. E-10 records the opposite: the only literal `npm test` enumerated 568 tests and reported 527 pass / 29 fail / 12 skip, inside the producer copy (no .git, enclosing sandbox denies the fixtures' /dev/null). E-9's clean rows are a focused run (81 tests) and a non-Git partition (498 of 568), and Blockers acknowledges the row is outstanding. This matters more than usual here because the change alters what the real prepared producer copy contains, and the one regression that runs the declared repository checks inside such a copy — tests/producer-write-scope.test.ts:259 — carries `skip: IN_PRODUCER_WORKSPACE`, so it was skipped in the environment the implementer used. Rerun build plus the full suite in the repository worktree and record the count before closing; AC-16 remains a separate verification dependency.
- `AMBIGUITY_SUPPRESSES_WRAPPER` (info): src/core/doctor.ts:456-460 returns the ambiguity warning instead of appending it, so in a multi-context repository the implementer binding never reports a missing resolve-profile sibling or the cursor-home HOME shape — the pre-round diagnostics D-6 exists to surface. The new doctor test pins that suppression: it asserts deepEqual on a single warning while sensitiveResolvePath does not yet exist, then creates it only for the single-context case. AC-10's "exactly one warning" reads as one ambiguity warning, not as a cap on the binding's other wrapper warnings. Pushing onto `warnings` and continuing satisfies AC-10 in the fixture (where the resolver exists) without losing the other checks.

Bridge run: run_id=run-d6111fe2-921b-4de4-8304-d7de74832212 execution_id=exec-acf02ee2-aaa1-421e-acbb-f23d034aaf12 review_kind=implementation verdict=changes_requested reason_code=review_changes_requested host=claude launcher=claude-plan-reviewer-v1 model=claude-opus-5 effort=high model_observed=declared_unobserved policy_digest=sha256:e363264f72a848d870898b8d1d1abe453a4f1e519f622f4415d9531d867023f6 task_hash=sha256:ba32b572f249780eca2e9b8d4cb9c6110a2ea1a63193a19e53938ba2c98e322a agents_hash=sha256:6bd68578db8fd268d33c5847ff43bbf478ca1ed9c7a17c1a34df7ed723f5b8da timestamp=2026-09-11T13:25:18.030Z
<!-- spartan-bridge:review:implementation:end -->

## Blockers

No implementation blocker. AC-15 is closed by E-12: `npm run build` succeeded and `npm test`
reported 569 tests, 569 pass, 0 fail and 0 skipped in the repository worktree, eight above the
E-8 baseline. Every cycle-1 finding is resolved, the two actionable ones confirmed against the
shipped code in E-13.

One verification dependency remains, and it is the one this task was written knowing it could not
discharge here: AC-16's sanitized end-to-end observation from a repository whose declared client
context differs from the machine default and whose resolved account can complete the D-7 round.
This repository's context is the machine default, so the wrong resolution and the right one
coincide here and the fix cannot be observed working no matter what is run.

The fix is already present in `dist/`, so the next auto-chain in such a repository is itself the
observation. Nothing further need be built or installed to produce it.

## Next Action

Record AC-16 from the next auto-chain run in a repository whose declared client context differs
from the machine default, then close this task as human-operator. The implementation review already
ran: cycle 1 returned three findings, all now resolved, and cycle 2 terminated `human_required`
solely on AC-15's measurement, which E-12 has since supplied. No further review round is needed,
and none should be dispatched to re-litigate a criterion that is already met.

## Next Handoff

```text
Recommended execution (human decides):
- Host: the host this repository binds to `verifier`
- Role: verifier
- Handoff: HX-006
- Invocation: `/spartan`
```

```text
Open `spartan/tasks/0079-the-producer-workspace-loses-the-repository-client-context.md`. (handoff HX-006)

Act as verifier. AC-1 through AC-15 are met and every review finding is resolved; do not
re-run the implementation review and do not re-derive a criterion that is already satisfied.

Record AC-16 from an auto-chain run in a repository whose declared client context differs from the
machine default: the transition reached `producer_finished` and then `reviewing`, and an
`implementation_review_result` event was recorded for it. Carry that observation back as counts,
reason codes, state names and event types only — never a path, an alias, or an account detail.

Then close this task: write the outcome into Evidence and Work Completed, leave the Bridge-owned
review region historical rather than synthesizing a verdict the Bridge never wrote, and set the
frontmatter to a completed human-operator close-out.

Return only the next handoff, or a completion notice if no work remains.
```
