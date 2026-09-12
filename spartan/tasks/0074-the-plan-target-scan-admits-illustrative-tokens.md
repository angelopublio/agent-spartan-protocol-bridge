---
protocol: "1.1.0" # x-release-please-version
id: the-plan-target-scan-admits-illustrative-tokens
created_at: 2026-09-05
status: active
phase: planning
task_type: planning
risk: material
current_role: planner
next_role: implementer
updated_at: 2026-09-12
handoff_id: HX-002
next_handoff_id: none
---

# The plan-target scan reports illustrative tokens as unwritable plan targets

## Objective

`unwritable_plan_targets` names paths the approved plan proposes to write, not
every slash-bearing string its Decisions use to explain something. A plan that
illustrates a sandbox rule with `HOME/x` or `R/src/x`, names a filesystem shape
as `a/b`, installs `@scope/name`, or compares against `origin/main`, does not
produce an advisory naming those tokens.

## Context

Observed on task `0053`'s auto-chain on 2026-09-05
(`transition-b755de18-b0c2-423d-a723-5906999b8333`). The terminal transition
document carried twenty-two `unwritable_plan_targets`, of which these are not
repository paths at all:

- `HOME/x`, `HOME/alias`, `R/src/x` — the plan's D2 uses `HOME`, `TMPDIR`, `R`
  and `W` as symbolic roots defined in its own prose, exactly so the SBPL
  clauses can be discussed without naming a machine-local path.
- `a/b` — a two-level directory shape used to explain nested rollback.
- `agent-skill/skills/spbridge/NEW.md` — a file the plan says the merge must
  **refuse**, cited to show the protection still fires.
- `.bin/tsserver`, `.bin/esbuild`, `.bin/yaml`, `.bin/spartan-bridge` — link
  names quoted relative to `node_modules/`, not repo-relative paths.

**The fixture is reproducible from this checkout.** That transition record is no
longer on disk (`.spartan-bridge/transitions/` holds three unrelated ids), but
`planTargetsUnwritablePath` run over the current
`spartan/tasks/0053-run-the-producer-on-an-isolated-scope-copy.md` with this
repository's declared automatic implementation write scope returns exactly
twenty-two tokens, in this order:

```text
agent-skill/skills
agent-skill/skills/spbridge
agents/
node_modules/esbuild/bin/esbuild
node_modules/@esbuild/darwin-arm64/bin/esbuild
HOME/x
HOME/alias
R/src/x
AGENTS.md
spartan-bridge/config.yaml
node_modules/
.venv/
dist/
node_modules/.cache/
node_modules/.cache/x
node_modules/.bin
.bin/tsserver
.bin/esbuild
.bin/yaml
.bin/spartan-bridge
agent-skill/skills/spbridge/NEW.md
a/b
```

All twenty-two come from `## Decisions`; the same run restricted to `## Scope`
returns an empty list. That measurement decides D1 candidate four on its own.

**Why the existing fix does not cover this.** Task `0066` closed the
false-positive case for a **bare filename** in prose, by requiring a token
without a `/` to be in `KNOWN_TOP_LEVEL_NAMES`
(`src/core/plan-target-scan.ts:5-13`, `:107-112`). It left the other branch
untouched: `looksLikeRepoPath` returns `true` for *any* token containing a
slash. Every false positive above contains one, so `0066`'s fix cannot reach
them. `REPO_PATH_CHARS` (`:97`) filters quotes, spaces and parentheses, which
is why a code expression is excluded — but `HOME/x` is made only of legal path
characters.

**Severity, stated plainly.** Task `0067` made the scan advisory after a passed
review rather than a hard stop, so these tokens do not block a chain. The cost
is that the advisory is not trustworthy: an operator who reads twenty-two
entries, most of them nonsense, learns to skip the list, and the real entries
in it lose their audience. That is the defect — a signal diluted to the point of
being ignored, not a blocked round.

**Two further false-positive classes, observed 2026-09-12.** A private consumer
repository running the Bridge produced advisories carrying tokens of two shapes
this list does not contain, both made only of legal path characters and both
carrying a slash, so `looksLikeRepoPath` admits them exactly as it admits
`HOME/x`:

- A scoped package specifier, `@scope/name`, quoted where a plan names a
  dependency it installs rather than a file it writes. The leading `@` is the
  discriminator the scan does not look at.
- A git ref, `origin/main` and `origin/<branch>`, quoted where a plan names a
  branch it merges or compares against.

Both reproduce against this checkout: a `## Scope` body backticking
`@scope/name`, `origin/main` and `origin/feature-x` returns all three.

The same repository also produced a terminal transition whose three
`unwritable_plan_targets` were `AGENTS.md`, `spartan-bridge/config.yaml`, and
one genuine repository directory — the first two quoted in a sentence stating
that the round does **not** edit them. D2 below resolves that case against the
framing this file previously gave it: those two tokens are correct reports, not
false positives, and the operator's misreading came from the run's unrelated
`write_scope_violation`, not from the advisory.

These shapes matter to D1 beyond adding rows to a fixture. A discrimination
built on "the token looks like a path" cannot separate them, because they are
well-formed paths; only their leading segment distinguishes them, and only
against knowledge the scan does not have. That is the finding that selects D1:
the missing knowledge is what the repository root actually contains.

**Why a sentence-level discrimination is not available.** Context above
describes `NEW.md` and the three-target case as tokens a disclaiming sentence
should silence. Two currently passing tests pin the opposite:

- `tests/plan-target-scan.test.ts:42` — a Decisions bullet reading "Do not
  write" before the backticked token `config/secret.env` must return
  `["config/secret.env"]`.
- `tests/transition.test.ts:775` — a Decisions bullet reading "Mention"
  before the backticked token `AGENTS.md`, and "in prose" after it, must
  record `unwritable_plan_targets: ["AGENTS.md"]`.

Both are disclaimers. A rule that reads intent from the surrounding sentence
therefore contradicts the pinned behavior of the scan and, for the second, D2.
A plan that says it will not write a path is not evidence that it will not:
board/bridge `0050` is the case where a passed plan review preceded an
implementer round that tried exactly that. D1 is a rule over token knowledge,
not over sentence meaning.

**The tension the planner round must weigh.** Every candidate discrimination is
heuristic, and a plan is prose. Requiring a token to name an existing path
would silence a plan that proposes creating a file. Requiring a leading known
top-level directory would silence a consumer repository whose layout this
repository does not know. Deciding what the scan may not do is as much of the
deliverable as deciding what it does.

## Scope

- `src/core/plan-target-scan.ts` — `planTargetsUnwritablePath` (`:15-31`) gains
  a third parameter; `looksLikeRepoPath` (`:107-112`) gains the D1 gate.
  `KNOWN_TOP_LEVEL_NAMES` (`:5-13`), `REPO_PATH_CHARS` (`:97`),
  `normalizeRepoPath` (`:99-105`), `isUnwritablePlanTarget` (`:114-119`),
  `collectPlanTargetSections` (`:33-41`) and `extractProseBacktickTokens`
  (`:70-90`) are unchanged.
- `src/core/transition.ts:400` — the single call site, inside
  `continueAfterPlanReview`, supplies the new argument. `repoRoot` and `fs` are
  already in scope there.
- `docs/DECISIONS.md` — one dated amendment to `D-053`, after the 2026-09-03
  (task `0067`) amendment. No new top-level decision number.
- `docs/ROUTING-AND-WORKFLOWS.md:312` — the sentence describing token
  classification.
- Tests: `tests/plan-target-scan.test.ts` (seven tests today, all passing) and
  the two advisory cases in `tests/transition.test.ts` (`:424`, `:775`).

## Out of Scope

- Making the scan a hard stop again. Task `0067` decided that deliberately.
- `continueAfterPlanReview`'s control flow, the transition record's shape, or
  the `unwritable_plan_targets` field itself.
- Scanning any section other than `## Scope` and `## Decisions`.
- Requiring plan authors to change how they write. The scan adapts to the
  artifacts, not the reverse.
- Any new `ReasonCode`, `TransitionEventType`, or `SCHEMA_VERSION` change.
- The producer write-scope guard, which remains the write boundary (`0067` D1).

## Decisions

- **D1 — the discrimination is a repository-root gate on the leading segment,
  supplied by the caller.** `planTargetsUnwritablePath` becomes
  `(markdown, writeScope, rootEntries: ReadonlySet<string>) => string[]` and
  still performs no filesystem access of its own. `looksLikeRepoPath` becomes:

  ```ts
  function looksLikeRepoPath(posix: string, rootEntries: ReadonlySet<string>): boolean {
    if (isAuthorityWritePath(posix)) {
      return true;
    }
    if (!posix.includes("/")) {
      return KNOWN_TOP_LEVEL_NAMES.has(posix);
    }
    return rootEntries.has(posix.split("/")[0] ?? "");
  }
  ```

  `isAuthorityWritePath` is imported from `src/policy/agents-policy.ts:121-128`
  beside the existing `AUTHORITY_WRITE_PATHS` / `isPathAdmittedByScope`
  imports. `continueAfterPlanReview` builds the set from one
  `fs.readdir(repoRoot)`; if that read throws, it passes a sentinel that
  reports every slash-bearing token, preserving today's behavior rather than
  silencing the advisory, and does not stop the transition.

  Keeping the listing at the call site preserves task `0066` D2's property that
  the scan is a pure function with no repository access — the knowledge is
  injected, so the unit tests stay literal-markdown tests.

  Measured over the twenty-two-token `0053` fixture plus the three 2026-09-12
  shapes (`@scope/name`, `origin/main`, `origin/feature-x`):

  | Candidate | Reports of 25 | What it silences that should not be silenced |
  | --- | --- | --- |
  | **A. Leading segment exists in the repository root** (pinned) | 12 | A plan that proposes creating a **new top-level directory** outside the write scope (`vendor/thing` where `vendor/` does not yet exist). A file created under an existing directory is unaffected, so the residual is the narrowest of the four. Also silences `.venv/` and `agents/` in the `0053` fixture, neither of which exists here. |
  | A′. Leading segment is a leading segment of a declared write-scope entry | 5 | Every out-of-scope directory the repository genuinely has — `node_modules/`, `dist/`, `.venv/`, and `spartan-bridge/config.yaml` itself. Without an authority bypass it silences D2 outright; with one it still deletes the whole "a path the scope declaration omits" half of `0054`. |
  | B. Report only tokens resolving under a scope line or an authority path | 2 | Everything except the two authority paths. A consumer plan naming a real out-of-scope source file under a narrow scope — the advisory's most useful case in a consumer repository — stops being reported at all. Reduces the scan to an authority-path detector. |
  | C. Deny set of symbolic roots (`HOME`, `TMPDIR`, `R`, `W`) | 22 | A repository whose source root is literally `R/` (the R-language convention) or that has a `W/` directory. It also silences nothing else: `a/b`, `.bin/*`, `@scope/name` and `origin/<ref>` all survive, so the class stays open and the set grows with every plan's naming convention. |
  | D. Report only `## Scope`, treat `## Decisions` as prose | 0 of the 22 | All twenty-two, `AGENTS.md` and `spartan-bridge/config.yaml` included — measured, not predicted. It silences D2 on the exact fixture this task exists to fix, because `0053` declares its targets in Decisions. |

  A is pinned because it is the only candidate that separates `origin/main` from
  a real `origin/` directory and `@scope/name` from a real `@scope/` directory
  without a hardcoded name list, and the only one that keeps a consumer
  repository's genuine out-of-scope paths reported. Its cost is stated above and
  accepted: task `0066` D2 refused an existence check because a stop would have
  blocked a passed plan; `0067` removed the stop, so the same check now costs a
  false negative on an advisory instead of a blocked round.

- **D2 — what the scan must never do: stop reporting an authority path.** A
  plan whose `## Scope` or `## Decisions` backticks `AGENTS.md` or
  `spartan-bridge/config.yaml` reports that token, in any sentence, including a
  sentence that disclaims editing it, and regardless of the root-entry set —
  including an empty set. That is the case task `0054` built the scan for
  (board/bridge `0050`: a passed plan review whose D1 only edited `AGENTS.md`,
  then a ~6.5-minute implementer round and an implementation-review cycle spent
  discovering the mapped implementer could not do it), and it is why the gate in
  D1 is bypassed by `isAuthorityWritePath` before any other test runs.

  Consequences for the fixture, stated so the criteria can be checked:

  - **Must survive** — `AGENTS.md`, `spartan-bridge/config.yaml`.
  - **Must be silenced** — `HOME/x`, `HOME/alias`, `R/src/x`, `a/b`,
    `.bin/tsserver`, `.bin/esbuild`, `.bin/yaml`, `.bin/spartan-bridge`,
    `@scope/name`, `origin/main`, `origin/feature-x`. Eleven of the twelve
    tokens Context names as not being repository paths.
  - **May be silenced, and is** — `agents/` and `.venv/`: neither exists in this
    checkout, both are exclusion-list mentions rather than write targets, and
    neither is an authority path.
  - **Still reported, and correctly so** — `agent-skill/skills`,
    `agent-skill/skills/spbridge`, `agent-skill/skills/spbridge/NEW.md`, and the
    six `node_modules/*` and `dist/` entries. These are real repository paths
    outside the automatic write scope. `NEW.md` is reclassified here as a true
    positive: it is a well-formed path under an existing directory, and the only
    thing marking it "illustrative" is the disclaiming sentence around it, which
    D2 forbids the scan from reading.

  Twelve of twenty-five is not silence; it is an advisory whose every remaining
  entry is a real path in this repository outside the write scope. That is the
  bar this task sets, and the `node_modules/` volume is a property of `0053`'s
  subject matter, not of the heuristic.

- **D3 — a suppressed token is dropped, not recorded anywhere.** No second
  field on `TransitionStatusDocument` or `TransitionEventDocument`, no new event
  type, no new reason code; `SCHEMA_VERSION` stays `2`. Task `0066` D3 paid a
  construction-site tax across `tests/serialize.test.ts`,
  `tests/transition.test.ts`, `tests/detach.test.ts`, `tests/cli.test.ts` and
  `tests/task-status.test.ts` to add `unwritable_plan_targets`; a second
  advisory field recording what the first one deliberately omitted would repeat
  that cost to produce noise about noise, and no operator decision turns on it.
  The suppressed tokens remain readable in the approved artifact itself, which
  the transition already pins by hash. The gate is deterministic and covered by
  the D1 fixture test, so a wrong suppression is found in the suite rather than
  in a run.

## Acceptance Criteria

Derived from D1, D2 and D3 after they were pinned.

- [ ] (D1) `planTargetsUnwritablePath` in `src/core/plan-target-scan.ts` takes
      `(markdown: string, writeScope: readonly string[], rootEntries: ReadonlySet<string>)`
      and contains no `node:fs` import or other filesystem access.
- [ ] (D1) `looksLikeRepoPath` matches the predicate in D1: `isAuthorityWritePath`
      first, then the unchanged `KNOWN_TOP_LEVEL_NAMES` branch for a token with
      no `/`, then `rootEntries.has` on the leading segment.
      `isAuthorityWritePath` is imported from `src/policy/agents-policy.ts`.
- [ ] (D1) `src/core/transition.ts:400` passes a set built from one
      `fs.readdir(repoRoot)`. When that read throws, the call receives the
      report-everything sentinel and `continueAfterPlanReview` still reaches the
      existing `authorization` event; no new stop and no new reason code.
      `tests/transition.test.ts` covers the unreadable-root path.
- [ ] (D1) `tests/plan-target-scan.test.ts` gains a fixture test whose
      `## Decisions` body backticks the twenty-two `0053` tokens quoted in
      Context, in that order, with a root-entry set equal to this repository's
      root listing. It asserts the returned array is exactly:
      `["agent-skill/skills", "agent-skill/skills/spbridge",
      "node_modules/esbuild/bin/esbuild",
      "node_modules/@esbuild/darwin-arm64/bin/esbuild", "AGENTS.md",
      "spartan-bridge/config.yaml", "node_modules/", "dist/",
      "node_modules/.cache/", "node_modules/.cache/x", "node_modules/.bin",
      "agent-skill/skills/spbridge/NEW.md"]` — twelve entries, first-seen order
      preserved.
- [ ] (D1) A second test asserts `@scope/name`, `origin/main` and
      `origin/feature-x` in `## Scope` return `[]` against that same set, and a
      third asserts `vendor/thing` returns `[]` when `vendor` is absent from the
      set and `["vendor/thing"]` when it is present — the named false negative,
      pinned so it cannot change silently.
- [ ] (D2) A test asserts `AGENTS.md` and `spartan-bridge/config.yaml` are
      returned from a `## Decisions` body against an **empty** root-entry set,
      and from a sentence that disclaims editing them.
- [ ] (D2) The six existing `tests/plan-target-scan.test.ts` cases keep their
      assertions; only the root-entry argument is added. The `config/secret.env`
      case passes a set containing `config`, since that directory does not exist
      in this checkout.
- [ ] (D2) `tests/transition.test.ts:424` and `:775` pass unchanged in their
      assertions: a plan naming `AGENTS.md` in Decisions still spawns the
      implementer and records `unwritable_plan_targets: ["AGENTS.md"]`, and an
      implementer that writes `AGENTS.md` still terminates
      `write_scope_violation` with that advisory intact.
- [ ] (D3) `git grep` shows no new key on `TransitionStatusDocument` or
      `TransitionEventDocument`, no new `TransitionEventType` member, and no new
      `ReasonCode` member; `SCHEMA_VERSION` is still `2`.
- [ ] (D1, D2) `docs/DECISIONS.md` `D-053` gains a dated 2026-09-12 amendment
      stating the leading-segment root gate, the authority bypass, and the
      accepted false negative. `docs/ROUTING-AND-WORKFLOWS.md:312` replaces its
      classification sentence with one naming the same three rules.
- [ ] `npm run typecheck` and `npm run build` clean; `npm test` adds no new
      failure against the pre-change baseline.

## Work Completed

- 2026-09-05 (human-operator, Claude Code, claude-opus-5): queued from the
  `0053` auto-chain observed the same day. `plan-target-scan.ts` was read in
  this checkout before this file was written, and `0066`'s fix confirmed to
  cover only the no-slash branch.
- 2026-09-12 (planner, Claude Code, claude-opus-5): added two further
  false-positive classes to Context and their evidence, after a chain in a
  private consumer repository stopped on `write_scope_violation` and its
  advisory was read as the cause. Names no path, repository, organisation or
  product of that repository, per `AGENTS.md` "Repository content names no
  private identity". No decision pinned and no code changed.
- 2026-09-12 (planner, Claude Code, claude-opus-5): pinned D1, D2 and D3 and
  derived the acceptance criteria from them. Reproduced the twenty-two-token
  fixture by running `planTargetsUnwritablePath` over task `0053`'s artifact in
  this checkout, measured all four D1 candidates against it plus the three
  2026-09-12 shapes, and measured the `## Scope` / `## Decisions` split that
  decides candidate D. Corrected five stale line references in Scope and
  Evidence. Raised `risk` from `minor` to `material`: the change cannot widen a
  write boundary or stop a chain, but a wrong gate silences a genuine
  out-of-scope target on the operator's only pre-spawn signal. No code changed.

## Evidence

- `transition-b755de18-b0c2-423d-a723-5906999b8333` — the terminal document's
  `unwritable_plan_targets`, twenty-two entries, quoted in Context. The record
  is no longer under `.spartan-bridge/transitions/`, which holds three
  unrelated ids; the list is reproduced instead, below.
- Reproduction, this checkout, 2026-09-12: `planTargetsUnwritablePath` over
  `spartan/tasks/0053-run-the-producer-on-an-isolated-scope-copy.md` with
  `["src/", "tests/", "docs/", "skills/",
  "agent-skill/skills/spbridge/SKILL.md", "spartan/", "README.md",
  "package.json", "package-lock.json", "tsconfig.json"]` returns exactly the
  twenty-two tokens in Context, in that order. Restricted to `## Scope` it
  returns `[]`; restricted to `## Decisions` it returns all twenty-two.
- `src/core/plan-target-scan.ts:15-31` — `planTargetsUnwritablePath`.
  `:33-41` — `collectPlanTargetSections`, the `## Scope` / `## Decisions`
  restriction. `:70-90` — `extractProseBacktickTokens`, the fenced-block skip.
  `:97` — `REPO_PATH_CHARS`, which admits `@`, `.`, `+` and `-`.
  `:99-105` — `normalizeRepoPath`. `:107-112` — `looksLikeRepoPath`:
  `if (posix.includes("/")) { return true; }`, then the `KNOWN_TOP_LEVEL_NAMES`
  check. `:5-13` — `KNOWN_TOP_LEVEL_NAMES`, seven names, task `0066`'s fix.
  `:114-119` — `isUnwritablePlanTarget`.
- `src/policy/agents-policy.ts:119` — `AUTHORITY_WRITE_PATHS`, the two-element
  const tuple. `:121-128` — `isAuthorityWritePath` (task `0067` D1).
  `:742-756` — `isPathAdmittedByScope`, trailing-slash prefix match or exact
  file match, no filesystem access.
- `src/core/transition.ts:400` — the single call site,
  `planTargetsUnwritablePath(approvedTaskText, admission.write_scope)`, inside
  `continueAfterPlanReview`, after the approved-bytes gate and before
  `resolveLauncherId`. `repoRoot` is in scope; `fs` is already imported.
- `AGENTS.md` "Automatic implementation write scope" — the ten entries quoted
  above, re-read on this checkout 2026-09-12.
- `tests/plan-target-scan.test.ts` — seven tests, all passing on this checkout
  (`node --import tsx --test tests/plan-target-scan.test.ts`: 7 pass, 0 fail).
  `:42` pins a "Do not write" bullet whose backticked token is
  `config/secret.env`, returning `["config/secret.env"]`. `config/` does not
  exist in this checkout.
- `tests/transition.test.ts:424` — a plan whose Decisions say
  "Edit … D5 scopes" around the backticked token `AGENTS.md` still spawns the
  implementer and records `["AGENTS.md"]`. `:775` — a plan whose Decisions say
  "Mention … in prose" around the same token records the advisory on a
  `write_scope_violation` stop.
- Repository root listing, 2026-09-12: `.agents`, `.git`, `.github`,
  `.gitignore`, `.idea`, `.spartan-bridge`, `AGENTS.md`, `CLAUDE.md`,
  `CONTRIBUTING.md`, `LICENSE`, `README.md`, `SECURITY.md`, `agent-skill`,
  `dist`, `docs`, `node_modules`, `package-lock.json`, `package.json`,
  `spartan`, `spartan-bridge`, `src`, `tests`, `tsconfig.json`. Absent:
  `agents`, `.venv`, `.bin`, `HOME`, `R`, `a`, `config`, `@scope`, `origin`.
- Task `0054` — why the scan exists, and the `0050` round it was built to buy
  back. Task `0066` — D2's bare-filename fix and its explicit refusal of a
  repo-walk existence check, on the grounds that a *stop* would false-positive
  a file the implementer is about to create. Task `0067` — D2 made the scan
  advisory after a passed review, which is what changes `0066`'s calculus.
- `docs/DECISIONS.md:869` — `D-053`, with amendments dated 2026-09-02 (task
  `0066`) and 2026-09-03 (task `0067`). `D-073` is unused; this task adds a
  third amendment rather than a new number, per its own Scope.
- `docs/ROUTING-AND-WORKFLOWS.md:312` — the sentence stating the current
  classification rule and that the scan is not the write boundary.
- `transition-1683c04d-250e-4f0d-a816-fe1a17e0d6d2`, 2026-09-12T11:05:09Z to
  T11:09:12Z — `state: stopped`, `reason_code: write_scope_violation`,
  `unwritable_plan_targets_count: 3`. Its plan review,
  `run-d39e5309-0ff6-458c-9638-0b3d0a87f316`, was `verdict: pass`,
  `reason_code: review_passed`, `task_write_state: written`, cycle 1 of 3, and
  left the chain `awaiting_implementer`. Read from a redacted
  `/spbridge-summary` document, per the rule that a run in another repository
  is cited by id, reason code, verdict and timings only.
- The `@scope/name` and `origin/<ref>` shapes were reported by the operator from
  advisories in that same repository. No transition id was captured for those
  two, so they are recorded here as shapes to cover, not as a citable document.
  Both reproduce on this checkout: a `## Scope` body backticking `@scope/name`,
  `origin/main` and `origin/feature-x` returns all three, alongside `AGENTS.md`,
  `spartan-bridge/config.yaml` and `vendor/thing` from a disclaiming
  `## Decisions` sentence.

## Review

<!-- spartan-bridge:review:plan:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-c7ae0e74-c1a1-4f8d-a0d0-3c0a323d20bd execution_id=exec-fd5bdbbb-b950-4c58-9f09-0e5ad51dec08 review_kind=plan verdict=pass reason_code=review_passed host=codex launcher=codex-plan-reviewer-v1 model=gpt-5.6-sol effort=high model_observed=declared_unobserved policy_digest=sha256:c032b4cea31dd45976e0e4d6a6b689590f1f0a1a368378fd8a82e546eb9525a3 task_hash=sha256:7895b34f72c4f10597a9c652b45ae59a9cd834f1142e976e227c790fdfb8a732 agents_hash=sha256:6bd68578db8fd268d33c5847ff43bbf478ca1ed9c7a17c1a34df7ed723f5b8da timestamp=2026-09-12T13:05:52.205Z
<!-- spartan-bridge:review:plan:end -->

## Blockers

None.

## Next Action

Implement D1, D2 and D3: the leading-segment root gate with its authority
bypass in `src/core/plan-target-scan.ts`, the one-line listing at
`src/core/transition.ts:400`, the fixture and false-negative tests, the
`D-053` amendment, and the `docs/ROUTING-AND-WORKFLOWS.md` sentence.

## Next Handoff

No outstanding handoff. The proposed review was consumed.
