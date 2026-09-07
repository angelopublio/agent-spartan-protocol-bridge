---
protocol: "0.6.1"
id: git-baseline-for-review-evidence
created_at: 2026-08-17
status: completed
phase: complete
task_type: planning
risk: high-impact
current_role: reviewer
next_role: implementer
updated_at: 2026-08-17
handoff_id: HX-001
next_handoff_id: none
---

# Establish the first commit as a Git baseline for review evidence

> Editorial note (2026-09-07): unused platform names and historical integration-document names were generalized for publication. The historical optional-integrations document refers to the former combined cockpit and Board documentation; its Board material is now in `docs/BOARD.md`. Any example path in this cleanup is a normalized placeholder. Original round outcomes, commands, and technical findings are retained; historical line references are not current navigation targets.

## Objective

A closed plan for the repository's first commit that names exactly what it includes and
excludes, states what `.gitignore` must already cover and the one gap it does not, keeps the
commit itself behind the `AGENTS.md:82` human-only Git gate, and reports every
machine-local identifier found by reading the files that would enter it.

After the human performs that commit, `git diff` and `git status` become usable scope
evidence and `OBS-NO-GIT-BASELINE` is closed.

## Context

`OBS-NO-GIT-BASELINE` was recorded in `spartan/tasks/0005-readme-shipped-surface-wording.md`
and is still true: `main` has no commits, so every path is untracked and `git diff <file>`
returns empty. Two review rounds have already paid for this. Task 0005 verified a
three-edit `README.md` change by exact-string presence/absence plus a `+2` anchor shift;
task 0006's rounds verified scope by file hashes for the same reason. Neither could prove
byte-identity of the sentences they were required not to touch.

Facts a new session cannot infer from the repository:

- Nothing has ever been committed. `git log` fails with "your current branch 'main' does
  not have any commits yet". There is no baseline to amend, rebase, or squash onto.
- `.claude/settings.local.json` is invisible to `git status` on this machine only because
  the human's **global** ignore file (`~/.config/git/ignore`) excludes it. The repository's
  own `.gitignore` does not. That exclusion does not travel with a clone.
- This round read `spartan/tasks/0001`-`0004` and `docs/examples/agent-profiles/*` in full
  for publication. Those had never been reviewed for publication and are the largest bodies
  of prose in the repository. The findings are in **Content sweep** below.
- Automated pattern checks came back clean before that reading, which is why the reading was
  the deliverable: absolute home paths, credential-shaped strings, and personal e-mail
  addresses are not the remaining risk. Prose is (see Evidence).
- This is a publication decision, not a hygiene chore. Git history is effectively permanent,
  so a machine-local identifier committed once stays reachable even after a later edit.

## Scope

- The exact include set of the first commit, by path group and count.
- The exact exclude set, and the `.gitignore` line that already covers each excluded path.
- The one `.gitignore` gap that must be closed **before** the commit, with the line to add.
- A content sweep of every file entering the commit: each machine-local identifier found,
  reported with file, location, and a proposed neutral replacement, and left unaltered.
- How the commit stays behind the `AGENTS.md:82` human-only Git gate, including the exact
  command sequence for the human and the two checks that bracket it.
- The scoping decision that one commit of the current tree is correct.

## Out of Scope

- Running `git add`, `git commit`, `git tag`, `git push`, or creating a remote. No Spartan
  round performs any of them under this plan (see **The human gate**).
- Editing any file to apply a Content sweep proposal. Every value found is reported and left
  as written; the human decides each one.
- Editing `spartan/tasks/0001`-`0004`, which are `completed` artifacts. Two of the sweep
  findings sit inside them, and reopening a completed artifact is the human's call.
- `spartan/tasks/0006-doctor-scope-alignment.md`, which was neither opened nor updated in
  this round.
- `OBS-DOCTOR-SCOPE-NARROW`, tracked by task 0006.
- Adding a `.gitattributes` file. The tree is already LF-only and needs no normalization to
  commit safely; whether to pin `text=auto` for future contributors is a separate decision.
- Any `.gitignore` change beyond the one gap named below. The redundant `.idea` line is
  noted as cosmetic, not scheduled.
- Choosing or changing the committing Git identity, a licence header sweep, a `CHANGELOG`,
  release tooling, or publication of the repository to a remote host.

## Constraints

- `AGENTS.md:82` makes commit a human-only gate. Authorization for this planning round is
  not authorization to commit.
- The commit must not be a scope-expansion vehicle: it records the tree as it stands, with
  no accompanying product edit except the one `.gitignore` line, applied and verified as its
  own change before the commit is made.
- Machine-local values are reported only. Nothing is rewritten, redacted, or "cleaned up"
  by an agent host.
- No credential, token, auth path, account identifier, or e-mail is recorded in this
  artifact, including in the sweep findings.
- English only.

## Acceptance Criteria

- [x] The include set is stated as an exact path-group list with counts that sum to the
      `git status --porcelain --untracked-files=all` count observed this round.
- [x] Every excluded path is paired with the `.gitignore` line number that covers it.
- [x] The one uncovered machine-local path is named, with the exact line to add and the
      reason the current exclusion does not travel.
- [x] Every file entering the commit is swept, and each machine-local identifier found is
      reported with file, line, the value's nature, and a proposed neutral replacement.
- [x] No file was altered by this round except this new task artifact.
- [x] The plan states that automated home-path, credential-shape, and e-mail checks are
      clean, and that prose is the residual risk.
- [x] The human gate is stated as an explicit command sequence the human runs, with a
      pre-check and a post-check, and no agent-run Git mutation anywhere in it.
- [x] The one-commit scoping decision is recorded with its rationale.
- [x] Repository checks are run and their outcomes recorded.
- [x] A reviewer records an explicit verdict on this plan.

## Decisions

- **One commit of the current tree. No synthetic history.** The first commit's only job is
  to become a baseline that `git diff` can measure against. Curating the tree into a
  plausible sequence of several commits would fabricate a history that never happened, and
  would give every intermediate commit a message asserting an ordering no round can
  evidence. One commit is also strictly sufficient: a baseline is a single starting point,
  and the value arrives with the first commit regardless of how many precede it. Recorded as
  a decision so a later round does not "improve" it into a rewritten history.

- **Everything currently untracked and not ignored goes in.** There is no partial-commit
  case worth the complexity: the tree is coherent, `npm run typecheck` and `npm test` pass
  on it, and a partial first commit would leave the same missing-baseline problem for
  whatever was held back. The include set is therefore defined by the tool, not by taste:
  it is exactly what `git status --porcelain --untracked-files=all` lists.

- **Risk is `high-impact`, not `material`.** The plan is documentation-only and this round
  writes nothing else, but what it authorizes is hard to reverse: Git history is durable,
  and it is the step that turns machine-local prose into published prose. The routing guide
  says to take the higher level and record why.

- **The sweep reports, it does not fix.** Two of the three findings sit in `completed` task
  artifacts (0002 and 0004). Editing a completed artifact, and deciding whether the owner's
  own name and repository URLs belong in a public first commit, are both owner decisions.
  A planner that silently neutralized them would be making a publication decision on the
  owner's behalf and would also destroy the evidence trail the sweep exists to produce.

- **The `.gitignore` gap is closed before the commit, not by it.** Adding
  `.claude/settings.local.json` is a one-line product edit. It must land and be verified as
  its own change, so that the commit itself carries no bundled edit and the file it excludes
  was never a candidate for inclusion in the first place.

### Include set — 72 paths

Exactly what `git status --porcelain --untracked-files=all` lists (71 paths observed this
round), plus this new task artifact:

| Group | Count | Contents |
| --- | --- | --- |
| Root files | 9 | `.gitignore`, `AGENTS.md`, `CLAUDE.md`, `LICENSE`, `README.md`, `SECURITY.md`, `package.json`, `package-lock.json`, `tsconfig.json` |
| `docs/` | 8 | `ARCHITECTURE.md`, `AUTHENTICATION-AND-SECURITY.md`, the historical optional-integrations document, `DECISIONS.md`, [historical document omitted], `OPEN-SOURCE-POLICY.md`, `PROVENANCE.md`, `ROUTING-AND-WORKFLOWS.md` |
| `docs/examples/agent-profiles/` | 5 | `README.md`, `roots.example`, and the three scripts `install-agent-profiles`, `resolve-profile`, `wrap-official-client` |
| `spartan/` | 8 | `README.md` and tasks `0001`-`0007` |
| `src/` | 27 | `index.ts`, `composition.ts`, `adapters/` 4, `cli/` 2, `core/` 7, `mcp/` 6, `policy/` 4, `runtime/` 2 |
| `tests/` | 15 | 13 `*.test.ts`, `helpers.ts`, `fixtures/cursor-agent-stub.mjs` |

Two properties of the include set that the commit must preserve:

- The three scripts under `docs/examples/agent-profiles/` are mode `0755`, and
  `docs/examples/agent-profiles/README.md` documents running `install-agent-profiles`
  directly. Git records mode `100755`, so the exec bit survives a normal commit; nothing
  extra is required, but a `chmod` before committing would break the documented usage.
- Every file is LF-only, and there is no `.gitattributes`. Committing as-is introduces no
  line-ending change.

`package-lock.json` is included deliberately: the package is `private: true` and is not
published, but the lockfile is what makes `npm install` reproducible for the documented
`build`, `typecheck`, and `test` scripts.

### Exclude set — already covered by `.gitignore`

| Excluded path | Covered by | Why it must stay out |
| --- | --- | --- |
| `node_modules/` | `.gitignore:6` | Installed dependencies; `package-lock.json` pins them |
| `dist/` | `.gitignore:8` | Build output of `npm run build`, regenerated from `src/` |
| `.spartan-bridge/` | `.gitignore:10` | Runtime state. Holds one local run directory (a `blocked` / `registry_unavailable` run) and is the location `AGENTS.md:17` names as operational truth, not repository content |
| `.idea/` | `.gitignore:2` (and a redundant `.idea` at `:11`) | JetBrains machine-local IDE state, including `workspace.xml` |
| `.DS_Store` | `.gitignore:1` | macOS Finder metadata |
| `coverage/` | `.gitignore:7` | Not currently produced; pre-covered |
| `*.log` | `.gitignore:9` | Local logs |
| `.env`, `.env.*` (except `.env.example`) | `.gitignore:3-5` | Credential-bearing by convention. `AGENTS.md:74` forbids such files entering Bridge inputs or repository content |

The redundant `.idea` at line 11 duplicates `.idea/` at line 2. Cosmetic; removing it is
optional and is not part of this plan.

### The one gap `.gitignore` does not yet cover

`.claude/settings.local.json` exists in the working tree and does not appear in
`git status`. It is excluded by `~/.config/git/ignore:1` — the human's **global** ignore
file — and by nothing in the repository. A global ignore is per-machine configuration: it
does not travel with a clone, so on CI, a second machine, or a contributor's checkout the
file is a normal untracked candidate. It is machine-local Claude Code permission state and
must never be committed.

Add to `.gitignore`, before the commit and as its own change:

```text
.claude/settings.local.json
```

Verify with `git check-ignore -v .claude/settings.local.json`, which must then report
`.gitignore` rather than `/Users/<user>/.config/git/ignore` as the source. Nothing else in
the tree depends on a global ignore rule: every other excluded path above resolves to a
repository `.gitignore` line, confirmed this round by `git check-ignore -v`.

### The human gate

`AGENTS.md:82` requires a stop before commit unless the human explicitly authorizes the
action in the current round. Authorization for this planning round is not authorization to
commit, and neither is a reviewer's `APPROVE` on this plan.

Under this plan, no Spartan round runs a Git mutation. The commit is performed by the human
in their own terminal, or by a host only in a round where the human explicitly authorizes
commit for that round and the round records that authorization. What a Spartan round may do
is what this round did: read files, read Git state, and run the repository's own checks.

Sequence for the human, once the `.gitignore` line is in place:

```sh
# Pre-check: the exact include set, and nothing ignored inside it.
git status --porcelain --untracked-files=all
git check-ignore -v .claude/settings.local.json

# The gated action.
git add -A
git commit

# Post-check: what actually landed.
git show --stat --oneline HEAD
git status --porcelain --untracked-files=all   # expected: empty
```

Three points for the human before running it:

- `git add -A` stages exactly the untracked-and-not-ignored set, which is why the pre-check
  runs first: the printed list is the commit's contents.
- The commit records an author name and e-mail from this machine's Git configuration, and
  that identity becomes part of a durable history. Confirming it is the identity intended
  for a public repository is a human decision; no round inspects or records it here.
- The post-check `git status` returning empty is the proof that the baseline is complete —
  and from that point `git diff` is scope evidence, which is the whole objective.

## Content sweep

Every file in the include set was swept. `spartan/tasks/0001`-`0004` and
`docs/examples/agent-profiles/*` were read in full, having never been reviewed for
publication. Automated checks for absolute home paths, credential-shaped strings, and
personal e-mail addresses came back clean beforehand (see Evidence), so prose that only
reading would surface was the residual risk. Every value below is reported and **left
unaltered**; the human decides each one.

**F1 — third-party repository identifier: `agent-spartans-worktrees`**

- `spartan/tasks/0002-mcp-stdio-adapter.md:32`, `:69`, `:143`.
- A second local private repository, named as one the owner authorized reuse from. Its
  sibling `agent-spartans-workbench` is a deliberate public reference — `AGENTS.md:10`,
  `docs/ARCHITECTURE.md:207`, `docs/OPEN-SOURCE-POLICY.md`, and `docs/PROVENANCE.md:47` all
  name it as a provenance gate. `agent-spartans-worktrees` appears **only** inside task
  0002 and in no document, so the first commit would publish a private repository name that
  the repository's own provenance record never accounts for.
- Proposed neutral replacement: `a second local historical repository`, keeping the
  surrounding statement (searched, nothing to reuse, gate untouched) intact. Alternative,
  if the owner prefers the name kept: add a row for it to the `docs/PROVENANCE.md`
  not-imported table so the mention is deliberate rather than incidental.
- Note: 0002 is `completed`; either option needs the owner's decision to touch it.

**F2 — machine-local client install fact and build hash**

- `spartan/tasks/0003-cursor-plan-review-dogfood.md:36`.
- "The Cursor Agent CLI is installed on **the planning machine** as `cursor-agent` (also
  `agent`), version `2026.08.11-e8db854`." This states what is installed on the owner's
  machine and pins an exact client build hash. The `--help` surface it introduces is
  legitimate design evidence; the machine attribution and the build suffix are not needed
  for it.
- Proposed neutral replacement: "The Cursor Agent CLI exposes `cursor-agent` (also
  `agent`); the `--help` surface below was observed in this round at version `2026.08.11`."
  — dropping "on the planning machine" and the `-e8db854` suffix.
- Lowest-severity of the three: a client version is not personal data. Reported because it
  is a machine-local fact stated as one.

**F3 — machine-local run identifier for a path the commit excludes**

- `spartan/tasks/0004-phase-2a-dogfood-docs.md:30`, `:157`, `:173`, `:185`.
- The run ID `run-ca3a117f-c463-494d-a8b3-88bedf2f36f1` appears four times, and line 30
  calls it "The only **committed** run directory". Two problems, one of which the first
  commit makes worse:
  1. The directory lives under `.spartan-bridge/`, excluded by `.gitignore:10`. After the
     first commit it is still excluded, so the artifact publishes four references to a path
     no reader of the repository can ever open.
  2. "committed" is false today — there are no commits — and stays false after the first
     commit, because the path remains ignored.
- Proposed neutral replacement: "the one local run directory present in the working tree at
  the time — a `blocked` / `registry_unavailable` run against task 0002, under ignored
  `.spartan-bridge/`" — dropping the UUID and the word "committed". If the owner wants the
  identifier kept as evidence, the minimum correction is "committed" → "local, gitignored".
- Note: 0004 is `completed`. The four mentions are load-bearing there — they exist to stop a
  later round citing that run as the dogfood — so any edit must preserve that warning.

Identified and judged intentional, no replacement proposed, owner confirms:

- The owner's real name in `LICENSE:3` (copyright holder) and the account in the
  `github.com/<owner>/agent-spartan-protocol` links at `README.md:5`,
  `spartan/README.md:3` and `:17`, and `docs/PROVENANCE.md:23`. These are the normal
  identity surface of a public repository under an MIT licence, not leakage.
- "Angelo identities as the human authors" at `docs/OPEN-SOURCE-POLICY.md:74` and
  `docs/PROVENANCE.md:50`, describing provenance of the local source chain. Consistent with
  `LICENSE:3`; could read as "the owner's identities" if the owner prefers one identity
  surface only.

Swept and clean, recorded so a later round need not re-derive it:

- **No real branch name appears anywhere in the include set.** The only branch is the
  default `main`, and no file names a branch at all.
- **No machine or user name appears in any file.** The machine's own host name does not
  occur in the tree.
- **No path outside the repository resolves to a real location.** The only absolute paths
  are the commented placeholder `/Users/you/example-projects` at
  `docs/examples/agent-profiles/roots.example:6` (the roots format requires an absolute
  path, and `you` is not a real user), the standard macOS application path
  `/Applications/Cursor.app/...` at `docs/examples/agent-profiles/wrap-official-client:30-31`,
  the synthetic fixture value `HOME: "/home/user"` at `tests/cursor-adapter.test.ts:190`,
  and `/tmp/r`-style synthetic arguments in `tests/parse.test.ts`. Everything else is
  `$HOME`- or `~`-relative by construction.
- **All other run/execution UUIDs in the tree are synthetic test fixtures**
  (`run-11111111-…`, `run-aaaaaaaa-…`, and similar), not real local run IDs.
- The remaining `docs/` references to WebStorm, the macOS Dock, "on this Mac",
  and the `company` alias are generic product and hypothetical-alias references, naming no
  real organization.
- Typographic quotation marks and em dashes occur in several `docs/` files and in tasks
  0002 and 0003. Not machine-local and not a publication risk; noted only so a reviewer
  does not report it as a finding.

## Work Completed

Planner (Claude Code, Opus 5, effort high, vendor Anthropic, client context `personal`):
produced this plan and the content sweep. Read `AGENTS.md`, the Spartan protocol and routing
references, `spartan/tasks/0005`, and — in full, for the sweep — `spartan/tasks/0001`
through `0004` and all five files under `docs/examples/agent-profiles/`. Swept the remaining
files in the include set by pattern. Read Git and ignore state. Ran the repository checks.

No file was modified except this new artifact. No Git mutation was performed or staged.
`spartan/tasks/0006-doctor-scope-alignment.md` was neither opened nor updated.

Reviewer (Cursor, Grok 4.6, effort high, client context `personal`): accepted matching envelope HX-001. Read-only plan review. Independently re-derived the include-set count and the `.gitignore` mapping rather than trusting the recorded ones. Did not alter any reported value and performed no Git mutation. Verdict `APPROVE`. The commit remains a human gate and is out of scope for this planning task.

## Evidence

Git and ignore state:

- `git log`: fails, "your current branch 'main' does not have any commits yet".
- `git status --porcelain --untracked-files=all`: 71 paths, all `??`. Matches the include
  set above before this artifact was added.
- `git branch -a` / `git symbolic-ref HEAD`: one branch, `refs/heads/main`, no remote.
- `git check-ignore -v` on `dist/index.js`, `node_modules/.package-lock.json`,
  `.spartan-bridge/runs`, `.idea/workspace.xml`, `.DS_Store`, `coverage/x`: each resolves to
  the repository `.gitignore` line recorded in the exclude table.
- `git check-ignore -v .claude/settings.local.json`: resolves to
  `~/.config/git/ignore:1`, the human's global ignore — the gap.
- `.git/info/exclude`: comments only. `git config core.excludesfile`: unset locally.
- No `.gitattributes`; a `\r` scan over the include set found none, so the tree is LF-only.
- `ls -l docs/examples/agent-profiles/`: the three scripts are `0755`; the two documents are
  `0644`.

Automated sweep patterns over all 71 files (clean, so reading was the deliverable):

- Absolute home paths (`/Users/`, `/home/<user>`, `C:\Users`): 2 hits, both accounted for in
  Content sweep as a placeholder and a synthetic fixture. No real home path.
- Credential-shaped strings (`sk-…`, `ghp_…`, `xox[baprs]-`, `AKIA…`, `-----BEGIN …`): 0 hits.
- E-mail addresses: 0 hits anywhere in the include set.
- Machine/host names, `.local` host suffixes: 0 hits.
- `branch`, `origin/`: no real branch name; every hit is prose about worktrees or bindings.
- Real run/execution UUIDs: 1, reported as F3. All others are test fixtures.
- IP addresses, `localhost:<port>`, `/var/folders`, `/private/var`: 0 hits.

Repository checks, run this round on the working tree:

- `npm run typecheck`: exit 0, no output.
- `npm test`: exit 0, 77 tests, 77 pass, 0 fail, 0 skipped.

Independent re-derivation, this review round (Cursor isolated `HOME`; no Git mutation):

- Path-group table 9+8+5+8+27+15 = 72. Each group matches the live untracked paths of that group. Recorded include-set table left unaltered.
- `git status --porcelain --untracked-files=all`: 73 paths, all `??`. The extra path is `.claude/settings.local.json`.
- `git check-ignore -v .claude/settings.local.json`: exit 1, no rule. This `HOME` has no `~/.config/git/ignore` and `core.excludesfile` is unset locally, globally, and at system. The planner's global-ignore observation did not reproduce here; the gap itself did.
- Exclude mapping, independently: `dist/` → `.gitignore:8`; `node_modules/` → `:6`; `.spartan-bridge/` → `:10`; `.DS_Store` → `:1`; `coverage/` → `:7`; `*.log` → `:9`; `.env` / `.env.*` / `!.env.example` → `:3-5`. `.idea/workspace.xml` wins at `:11:.idea` (last match); `:2:.idea/` also matches. Recorded table left unaltered.
- Scripts under `docs/examples/agent-profiles/`: three `0755`, two `0644`. Include-set `\r` scan: none.
- F1, F2, F3 present at the cited sites; values not altered. F1 only in task 0002. F2 only in task 0003. F3 full UUID at 0004 `:30`, `:157`, `:173`; `:185` uses the shortened grep needle `run-ca3a117f`.
- Targeted re-check: no e-mail addresses in the include set; `/Users/` only the `roots.example` placeholder; `/home/` only the synthetic fixture. No additional machine-local identifier found that the sweep missed.
- `npm run typecheck`: exit 0, no output.
- `npm test`: exit 0, 77 tests, 77 pass, 0 fail, 0 skipped.

## Review

Verdict: APPROVE (HX-001, Cursor, Grok 4.6, effort high)

The include set, the exclude set with its `.gitignore` line mapping, the single
uncovered `.claude/settings.local.json` gap, the human-gate sequence, the one-commit
scoping decision, and the three reported machine-local findings are together sufficient
to close `OBS-NO-GIT-BASELINE` once the human commits after the named `.gitignore` line
is in place. Independent re-derivation confirms the 72-path table and the ignore
mapping; it does not require any recorded value to be rewritten.

The 72-path include set is the intended commit set and matches the live untracked
paths of every named group. Live `git status --porcelain --untracked-files=all` in this
Cursor isolated `HOME` is 73 because `.claude/settings.local.json` is untracked here
(`git check-ignore` exit 1). That confirms the gap rather than contradicting the
include table: after the named line is added, the same command in this environment
must list those 72 paths and no other. The planner's "invisible on this machine"
observation is host-environment-specific and was not reproduced here; the conclusion
that repository `.gitignore` must cover the file, because a global ignore does not
travel, is independently confirmed and is immediately load-bearing on this host.

The exclude mapping independently resolves every named path to a repository
`.gitignore` line. The human-gate sequence is the right fail-closed order: the
`.gitignore` line first, then the pre-check, then `git add -A` / `git commit` by the
human, then the empty post-check. An `APPROVE` on this plan is not authorization to
commit. One commit of the current tree is the correct baseline; fabricating
intermediate history would not make `git diff` available any sooner. F1, F2, and F3
are present at the cited sites, correctly left unaltered, and are owner publication
decisions, not blockers on a baseline.

Findings:

- Non-blocking. Live status count in this host is 73, not the recorded 72, solely
  because the named gap file is untracked here. The 72-path table is still the
  include set. Do not rewrite the recorded count.
- Non-blocking. `git check-ignore -v .idea/workspace.xml` reports the winning rule
  as `.gitignore:11:.idea`, not `:2`. Both lines exclude the path. Cosmetic
  redundancy already noted in the plan.
- Non-blocking. F3's full UUID appears three times in task 0004 (`:30`, `:157`,
  `:173`); `:185` uses the shortened grep needle `run-ca3a117f`. The finding's
  substance is unchanged. Values not altered.

## Blockers

None. The commit itself is gated on the human, which is the designed behavior, not a
blocker on this plan.

## Next Action

None. Every acceptance criterion is satisfied, checks have recorded outcomes, the
required review is `APPROVE`, and no blocker remains. The commit is out of scope for
this planning task.

## Next Handoff

Non-binding suggestion for a possible new task; this artifact is complete and must not be reopened.

```text
Recommended execution (human decides):
- Host: Cursor, the `AGENTS.md` binding for `implementer`
- Model and effort: Composer 2.5, no user-selectable effort — one specified `.gitignore` line (fallback: Grok 4.6, effort high)
- Role: implementer
- Invocation: `/spartan`, passing the prompt block below as the argument
```

```text
Create a uniquely numbered artifact from `assets/task-template.md` in `spartan/tasks/`, suggested slug `gitignore-settings-local-before-baseline`. Do not open or update `spartan/tasks/0007-git-baseline-for-review-evidence.md`.

Act as implementer. Add only the one `.gitignore` line named in completed task 0007, `.claude/settings.local.json`, and verify that `git check-ignore -v` reports the repository `.gitignore` as the source and that `git status --porcelain --untracked-files=all` then lists exactly the 72-path include set from that plan. Do not run `git add`, `git commit`, or any other Git mutation; the commit remains the `AGENTS.md` human-only gate. Success: the gap file is ignored by the repository ignore file and is not a commit candidate.
Run the relevant repository checks and update the new task file.

Return only the next handoff, or a completion notice if no work remains.
```
