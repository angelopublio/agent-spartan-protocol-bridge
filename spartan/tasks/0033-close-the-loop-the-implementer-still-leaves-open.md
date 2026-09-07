---
protocol: "1.0.0" # x-release-please-version
id: close-the-loop-the-implementer-still-leaves-open
created_at: 2026-08-20
status: completed
phase: complete
task_type: implementation
risk: high-impact
current_role: reviewer
next_role: none
updated_at: 2026-08-21
handoff_id: HX-029
next_handoff_id: none
---

# Close the loop the implementer still leaves open

> Editorial note (2026-09-07): unused platform names and historical integration-document names were generalized for publication. The historical optional-integrations document refers to the former combined cockpit and Board documentation; its Board material is now in `docs/BOARD.md`. Any example path in this cleanup is a normalized placeholder. Original round outcomes, commands, and technical findings are retained; historical line references are not current navigation targets.

## Objective

An implementer round that finishes its work starts its own review in the mapped
`reviewer.implementation` host, and the human reads a verdict instead of pasting a prompt. The plan
loop and the implementation loop then close the same way.

## Context

Task `0032` made plan review real: `spartan-bridge review` dispatches a Codex session the operating
system holds read-only, and a producer round chains into it without a paste. The implementation loop
did not move. Every round of `0032` itself proved it — the implementer finished, and a human carried
the prompt to Codex by hand, twice.

Four things stand between here and that, and only the first is policy.

**The grant is narrower than the sentence reads.** `AGENTS.md` authorizes "a human-started Spartan
Bridge run may start the mapped reviewer automatically" — the mapped reviewer, not the mapped plan
reviewer. Its one prohibition is that "the Bridge may not start implementation automatically", which
is the planner-to-implementer transition, not this one.
`docs/ROUTING-AND-WORKFLOWS.md:247` already states the intent: "The Bridge may start
`reviewer.implementation` automatically after required checks pass." So the gap here is a sentence
that says plainly what is authorized, not a reversal. D6 settles which sentence, and why relying on
the existing one would authorize a new transition in every adopting repository without its consent.

**The runtime can represent only one review kind.** `src/core/contracts.ts:3` is
`export const REVIEW_KIND = "plan" as const`, and six contract types spell their field as
`review_kind: typeof REVIEW_KIND`. `capabilitiesAllowed` at `src/adapters/adapter.ts:86` rejects any
adapter whose `review_kinds` omits that constant, and `src/policy/agents-policy.ts:209` reads only
the `reviewer.plan` row, failing `reviewer_plan_row_missing` when it is absent. "implementation" is
not a value the runtime can hold; it is a literal in the type system.

**The runtime refuses an implementation task before any of that matters.**
`src/policy/task-frontmatter.ts:144` is `if (fm.phase !== "planning" || fm.task_type !== "planning")`,
and it throws `task_invalid`. An implementation task awaiting review does not carry that pair: when
task `0028` was handed to its implementation review at commit `875e843`, its frontmatter read
`phase: reviewing`, `task_type: implementation`, `current_role: implementer`, `next_role: reviewer`.
So the reason `0032` and `0028` were reviewed by hand is not only the missing grant — the runtime
cannot parse the artifact at all. This blocker was not in the draft this task opened with; it is the
first stop in the order the code actually runs, and D4 settles it.

**And the one that decides the task: the reviewer's workspace holds two files.** The Codex adapter
copies `AGENTS.md` and `task.md` into a 0555 directory at `src/adapters/codex.ts:261-262`, and its
prompt says "Review only the workspace files task.md and AGENTS.md. No other file is available for
this review."

That shape is why the read-only guarantee is cheap to make and cheap to check: two files in, a
`snapshotTree` baseline over a tiny tree, and any change inside it is the reviewer writing. **A plan
review reads two files. An implementation review must read the diff.** Whatever an implementation
reviewer is given has to carry the changed product files, so the isolation model and the record of
what the reviewer saw have to be decided again over a much larger surface. D1 settles it.

One correction the draft carried and this task retired: the snapshot caps at
`src/core/snapshot.ts:6-8` were never chosen for a two-file tree. `src/core/review.ts:344` and `:435`
call `snapshotTree(repoRoot, …)` before and after every review and terminate on
`reviewer_write_detected` with `comparison: "repository_worktree"`. Those caps already bound a
repository-sized walk on every run that has ever happened, which is why D1 changes none of them.

One thing did change, and it is what makes the question answerable now. Handing a reviewer more than
two files is only defensible if something other than the prompt stops it writing. The `0032` probe
observed exactly that: two write attempts refused by the operating system with
`zsh:1: operation not permitted`. Before the Codex adapter, this task could not have been made
honest.

## Scope

- `AGENTS.md`: the grant sentence for the implementer-to-`reviewer.implementation` transition, the
  `### Implementation review scope` heading and its entries (D6), and the wording of the prohibition
  sentence it sits beside.
- `src/core/contracts.ts`: `REVIEW_KIND` becomes a value with two members, the contract types that
  spell it follow, `AdapterReviewInput` carries the resolved kind, and `PROTOCOL_VERSION` moves (D8).
- `src/policy/task-frontmatter.ts`: the admission test at line 144 (D4).
- `src/policy/agents-policy.ts`: the `reviewer.implementation` binding row, the implementation grant
  sentence, and the implementation review scope with its path-entry syntax, alongside
  `reviewer.plan` (D4, D6, D1).
- `src/core/review.ts`: resolving the kind, carrying it through the run, the transition, and the
  artifact write (D3, D4, D7).
- `src/core/result.ts`: validating the reviewer's `review_kind` against the kind the run dispatched
  (D8).
- `src/core/task-write.ts`: kind-scoped region markers, the per-kind splice, the segment-wise
  preservation check, and the implementation transition map (D5, D7).
- Task `0034` owns `src/core/workspace.ts`, `src/core/snapshot.ts`, and the manifest. This task calls
  that module and does not build it.
- `src/adapters/adapter.ts`: what `capabilitiesAllowed` requires when the kind is not fixed (D3).
- `src/adapters/codex.ts`: the implementation workspace preparation, the resolved scope it passes to
  the workspace module, its prompt, and the kind-scoped output schema it advertises (D1, D8).
- `src/adapters/cursor.ts`, `src/adapters/fake.ts`: their declared `review_kinds` become explicit
  lists rather than the single constant (D3).
- `agent-skill/skills/spbridge/SKILL.md`: the sentence that today excludes an implementer round from the skill
  (D2).
- `docs/DECISIONS.md`, `docs/ROUTING-AND-WORKFLOWS.md` (line 247, D2 and D6),
  `docs/AUTHENTICATION-AND-SECURITY.md`.
- Tests over each of the above, including what an implementation reviewer is and is not given.
- `spartan/probes/git-change-class-rendering.md`, this task's round deliverable: the fixture script
  and verbatim output behind every cell of D1's agreement table. It is measurement, not handoff
  state; deleting it leaves the plan readable and the criteria still derivable from D1.

## Out of Scope

- The planner-to-implementer transition. `AGENTS.md` withholds it, and this task does not ask for it.
  D7 keeps the Bridge from ever starting an implementer round.
- Any Cursor-side change beyond its declared `review_kinds`. The implementer host is unchanged, and
  no Cursor implementation workspace is built; what changes is what happens after the implementer
  finishes.
- Judging content. The Bridge validates a verdict's shape and never decides whether a review is
  right. D2 keeps this true of the required checks as well.
- Letting a reviewer write product files, under any workspace shape.
- Widening `doctor`.
- `src/core/snapshot.ts`, the inclusion predicate, the copy procedure, the git invocation policy, and
  `workspace-manifest.json`. Task `0034` owns all of them.
- Renaming `CODEX_LAUNCHER_ID`. It reads `codex-plan-reviewer-v1` and now serves both kinds, but a
  launcher id names a launcher, and renaming it would invalidate every user-local registry that
  already resolves it.
- Submodules. D1 refuses a repository whose included set contains a gitlink rather than deciding what
  a reviewer should see of one.
- The template's `Verdict: PENDING` that survives below a Bridge region. Task `0024` records that
  leftover and owns the decision; D5 defines only where the boundary between Bridge-owned and
  human-written text lies once there are two regions, and leaves what happens to the text outside it
  exactly as it is today.

## Constraints

- The reviewer session stays read-only and technically enforced, whatever it is given to read.
- One writer. A reviewer returns findings; only the Bridge writes the artifact, and only what
  `task_artifact_write` already authorizes.
- The Bridge writes nothing inside the repository's `.git` directory, including an index refresh.
- Fail closed on an unresolvable kind, an unmapped binding, a missing grant, a missing adapter
  capability, a repository configured to run helper commands, or a workspace the adapter cannot
  prepare within its caps.
- No credential, token, account identifier, or auth path enters any input, argument, or log.
- The portable protocol is unchanged: a handoff must stay usable by hand when the Bridge is absent.
- What the plan loop accepts today, it still accepts. Every change below is additive to that path.

## Decisions

### D1 - A read-only copy of the working tree, bounded by one exclusion predicate

**The case for handing over the repository itself, made properly.** It is the only candidate with no
fidelity gap: the reviewer sees exactly what the implementer saw, including whatever no copy rule
thought to include. It costs nothing to prepare, nothing to clean up, and creates no second place for
product bytes to live. And two objections against it are weaker than the draft assumed.

The first is that its read-only guarantee is unobserved. It is observed. `0032` run B recorded
`zsh:1: operation not permitted: probe-write.txt` and `zsh:1: operation not permitted: AGENTS.md`.
That message is zsh's rendering of `EPERM`. A 0444 file or a 0555 directory would have failed with
`EACCES`, which zsh prints as `permission denied`. The refusal therefore reads as the sandbox's, not
the file modes' — the observation is stronger evidence than it was credited with. It was not isolated
by a controlled probe against a writable path, so it is inference from the error string rather than
proof, but it is inference from bytes we have.

The second is that the option leaves no second line of defence. It does not.
`src/core/review.ts:344` and `:435` already snapshot the whole repository worktree before and after
every review and terminate on `reviewer_write_detected` with `comparison: "repository_worktree"`.
That detector exists, runs on every run today, and would keep running.

**What defeats it is reads, not writes.**

1. `--sandbox read-only` stops writing. Nothing stops reading, and the working directory handed to a
   spawned reviewer is a Bridge input. This checkout contains paths outside the repository's explicit
   implementation-review allowlist, including `.git/` metadata and `.spartan-bridge/` run state.
   `AGENTS.md` requires that tokens, cookies, auth files, API keys, and credential environment
   variables "must never enter Bridge inputs, arguments, configuration, runtime state, fixtures, or
   logs". Option three fails that sentence on the read side, and a stronger sandbox cannot help,
   because reading is precisely what the sandbox permits.
2. The surviving detector cannot see the place a write would matter most.
   `src/core/snapshot.ts:9` skips `.git`, `node_modules`, and `.spartan-bridge`. Under option three
   the reviewer's own working directory is the repository, so `.git/hooks/` — where a written file
   becomes execution on the human's next commit — is watched by neither snapshot. Under a copy,
   `.git` is not present at all, so the class does not exist rather than being monitored for.
3. It collapses two detectors into one, and the survivor cannot attribute. A workspace diff means one
   thing exactly: the reviewer wrote, because nothing else holds that directory. A repository diff
   cannot distinguish a reviewer write from a concurrent edit by the human or by the producer session
   that chained the run. Option three deletes the unambiguous detector and keeps the ambiguous one.

**The diff alone** is rejected for the reason the draft gave — a reviewer that cannot open an
unchanged neighbouring file cannot judge whether a change is right — and for one more: adding
neighbours case by case is the same copy with a worse rule for what it contains.

**Settled: a copy.** The implementation workspace is a `mktemp` directory prepared like today's, with:

- `AGENTS.md` and `task.md`, unchanged from the plan workspace;
- `worktree/`, holding the working-tree content of the extant projection defined below, at each
  path's repository-relative location;
- `diff.patch`, the repository diff restricted to the included set;
- `changes.txt`, the base commit id, the changed paths with their status letters, and the included
  paths that are untracked, so a file added but not yet committed is named even though `diff.patch`
  does not carry it.

**One predicate, four consumers.** The included set is computed once and governs `worktree/`,
`diff.patch`, `changes.txt`, and the manifest. Nothing may enter one of them that the predicate
excluded from the others; that symmetry is the decision, and the finding that produced it was that
Git tracking and ignore state do not define confidentiality: either would let repository metadata
silently narrow or widen the path allowlist declared in `AGENTS.md`. The same explicit scope must
therefore govern every consumer, including an unrestricted Git diff that would otherwise print a
path outside the scope and an untracked path inside the scope that Git ignore machinery would hide.
**How that tree is assembled is task `0034`.** This decision settles what the reviewer is given and
what it may not contain. The predicate that computes the included set, the copy procedure, the git
invocation policy, the production of `diff.patch` and `changes.txt`, the workspace snapshot policy,
and `workspace-manifest.json` all moved there on 2026-08-20, after three review cycles of this plan
spent their whole error budget on them and the chain stopped at its limit with five open findings,
all in that surface.

What this task pins, as a contract `0034` must satisfy rather than a procedure it restates. Every
clause is stated over what a caller can observe of a prepared workspace, against a fixture
repository built for the purpose. That is the point of the rewriting: a clause phrased over the
module's own included set is satisfied by whatever set the module computed, so it tests agreement
with itself rather than the property the reviewer needs.

- **Shape.** The workspace holds exactly `AGENTS.md`, `task.md`, `worktree/`, `diff.patch`, and
  `changes.txt`. The plan workspace stays exactly two files.
- **Internal agreement.** One included set governs `worktree/`, `diff.patch`, `changes.txt`, and the
  manifest — but the four outputs answer different questions about a member, so the relation is
  directional per category and not an equality.

  Two gates, in this order. **Eligibility comes first and is not one of the three facts below**: a
  path the confidentiality boundary excludes appears in no output, in no form, whatever `HEAD`, the
  index, or the working tree holds. A tracked `private/secret.json` present in all three is
  ineligible when `private/` is outside the declared scope and is therefore not a member and not a
  row — it is not a deletion, and the table never speaks about it. Only eligible paths reach the
  enumeration. Ignore rules do not participate in this gate.

  The table below then enumerates the eligible repository file entries. It is an enumeration, not a list of
  interesting cases, and that is what makes it the completeness claim it is called. Three facts
  decide an eligible path, each observable of the repository rather than of the module: whether
  `HEAD` holds it (**H**), whether the index holds it (**I**), whether the working tree holds it
  (**W**). Eight combinations exist. Seven are members and are rows; the eighth, held by none of the
  three, is not a path in the repository at all. The first splits by whether the working-tree bytes
  or mode differ from `HEAD`, which is the only place a row needs a fourth fact.

  | H | I | W | The member is | `worktree/` | `changes.txt` | `diff.patch` |
  |---|---|---|---|---|---|---|
  | ✓ | ✓ | ✓ | tracked and modified — bytes or mode differ from `HEAD` | present, working-tree bytes | named as modified | represented |
  | ✓ | ✓ | ✓ | tracked and unchanged from `HEAD` | present | not named | absent |
  | ✓ | ✓ | ✗ | deleted from the working tree, deletion not staged | absent | named as deleted | represented |
  | ✓ | ✗ | ✓ | removed from the index, kept on disk (`git rm --cached`) | present, working-tree bytes | named as removed from the index and still on disk | represented, and git renders it as a deletion |
  | ✓ | ✗ | ✗ | deleted and the deletion staged (`git rm`) | absent | named as deleted | represented |
  | ✗ | ✓ | ✓ | added to the index, not yet committed | present | named as added | represented |
  | ✗ | ✓ | ✗ | staged, then removed from the working tree | absent | named as added and then removed | absent, and this is not a gap |
  | ✗ | ✗ | ✓ | untracked inside the declared scope, regardless of ignore state | present | named as untracked | absent, and this is not a gap |

  *Represented* is what `diff.patch` owes and is deliberately not "carries a hunk". A hunk is one of
  several forms git uses, and the plan must not require the form git will not emit: a binary change
  produces a binary marker or a binary patch and no textual hunk, and a mode-only change produces
  `old mode` and `new mode` lines and no hunk at all. What is required is that the member has a diff
  entry naming it — a `diff --git` header carrying its path — together with whatever git emits for
  that change class. The criterion asserts the entry and the path, not the shape of the body.

  Every cell above was measured rather than assumed;
  `spartan/probes/git-change-class-rendering.md` holds the fixture and its output. Three rows exist
  only because that measurement contradicted the shorter table this decision carried through three
  review cycles, and each is a case a real implementer round produces:

  - **`(✗, ✓, ✗)` — staged, then removed.** `git ls-files --cached` lists it, so it is a member,
    and `git diff HEAD` emits nothing for it in any form. It is the one member `diff.patch` cannot
    represent, which is why its cell says so rather than leaving a test to discover it.
  - **`(✓, ✗, ✓)` — removed from the index, kept on disk.** The declared scope still admits the
    extant working-tree path, while `git diff HEAD` renders it as a full deletion. It is the one row where
    `worktree/` and `diff.patch` disagree by construction, and the contract says so out loud.
  - **`(✓, ✗, ✗)` — an ordinary `git rm`.** Neither `git ls-files --cached` nor `git ls-files
    --others` reaches it, so a predicate assembled from those two lists alone loses a staged
    deletion entirely — the reviewer would never learn a product file was removed. The included set
    `0034` computes must cover this row; that is a widening of what the reviewer is given, which is
    this decision's to state, and not a choice of git invocation, which is `0034`'s.

  The rows are stated per path, so a change git is free to render as a rename is two members — the
  old path by `(✓, ✗, ✗)` and the new path by `(✗, ✓, ✓)` — and `changes.txt` owes a line for each.
  A single line naming both paths satisfies neither row.

  The manifest names exactly the regular file members under `worktree/`. The containment that makes it one set runs
  in the other direction: nothing appears in any output that is not a member, so every path named in
  `changes.txt` and every path `diff.patch` touches is a member, and a member absent from
  `worktree/` is absent for exactly one reason, which is that the working tree does not hold it.
  Directories are the sole structural exception to output-set equality: `worktree/` contains exactly
  the ancestor-directory closure required to materialize its regular file members, with no source
  bytes copied for a directory; directories appear in neither `changes.txt` nor `diff.patch` nor the
  file manifest.
- **Entry types.** A path constraint is not a content constraint. Every entry under `worktree/` is a
  regular file or a directory, verified without following links, so no symlink reaches the reviewer
  to resolve somewhere the workspace does not contain and no gitlink invites a walk into a
  submodule. A member that is a symlink, a gitlink, or any other non-regular entry ends the run
  under the fail-closed clause rather than being copied, dereferenced, or skipped.
- **Confidentiality is an allowlist the repository declares, not a denial the Bridge invents.** Two
  constraints hold at once and neither yields. `AGENTS.md:82` is absolute — auth files and tokens
  must never enter a Bridge input — and no sentence a repository writes can waive it, because the
  prohibition is in the same policy the grant is read from. And the Bridge may not read a file in
  order to decide it is a secret, because that is the ingestion the same boundary forbids.

  Every earlier draft of this clause tried to satisfy both with a *denial*: a short exclusion the
  Bridge applies to everything else. A denial cannot satisfy an absolute non-ingestion rule, and the
  reason is structural rather than a matter of length. What a denial list admits is precisely
  everything it failed to name, so its incompleteness — already conceded, and correctly, as the
  reason a name list never terminates — is exactly the set of credentials it lets through. The draft
  before this one made that concrete and made it worse: having been told `.npmrc`, `.netrc`, and
  `credentials.json` were the leak, it wrote criteria *requiring* those three to be copied, so an
  implementation could satisfy every criterion in this task while ingesting real credentials. That is
  what finding `CREDENTIAL_BOUNDARY_UNSAFE` names, and it is right.

  The precedent this clause kept citing is an allowlist, and the correction is to take it literally.
  `CODEX_ENV_ALLOWLIST` does not deny `ANTHROPIC_API_KEY` by name. It admits six variables and
  excludes everything else, so a variable nobody thought of is excluded by default rather than
  admitted by default. That disposition is what makes it answerable to `AGENTS.md:82`, and it is the
  disposition the worktree copy takes here.

  **Settled: the repository declares a review scope, and nothing outside it is a member.**

  1. *Host stores are never collected, and are not part of the copy contract.* Keychain data, browser
     sessions, cookies, provider account identifiers, and credential environment variables are not
     worktree entries. They are already excluded by the child environment allowlist, by the refusal
     of credential-shaped configuration keys, and by the Bridge never taking an auth-file path as an
     input. `0034` does not rediscover them, and no workspace rule can reach them.
  2. *A member is a repository file entry the repository declared.* `AGENTS.md` carries an
     **implementation review scope**: a list of repository-relative path prefixes, under a heading of
     its own inside `## Spartan Bridge automation authority`, parsed the way the grant sentences are.
     A path no declared prefix reaches is not a member: it is not copied, not named in `changes.txt`,
     not represented in `diff.patch`, not in the manifest, and not a row of the agreement table.
     Tracking, staging, and ignore state do not change eligibility. There is no denial list and no
     authentication-filename or credential-directory classifier: if the repository explicitly puts
     `.env`, `.npmrc`, `.netrc`, `credentials.json`, `.ssh/`, or another name in scope, the Bridge
     copies its repository bytes without inspection as the repository's own code-review exposure.
  3. *A prefix is a path and can be nothing else.* A scope list item is exactly one Markdown inline
     code span. The parser removes that one pair of backtick delimiters and treats the inner bytes as
     the entry; it preserves those decoded path bytes exactly and rejects extra prose, multiple spans,
     or an empty span. An entry without a trailing slash admits exactly the repository-relative path
     whose bytes equal it. For an entry ending in `/`, remove that final slash to obtain its named
     directory: the entry admits every repository file entry whose path begins with the original
     slash-terminated bytes. Thus `src/` admits `src/a.ts` and `src/nested/b.ts`, but not `srcfoo`
     or `packages/src/a.ts`. Directories are not repository file entries and therefore carry no
     `(H, I, W)` triple and are not members. `worktree/` creates only the ancestor directories needed
     to contain admitted extant regular files; this structural closure is defined separately from
     file admission and cannot add a file. A nested prefix such as `packages/app/` follows the same
     rule. An absolute
     path, a `~` prefix, a `..` segment, a glob, a
     negation, and a regular expression are each refused. A malformed scope is refused as a whole
     rather than repaired by dropping the bad entry. No syntactically valid repository-relative name
     is rejected for resembling an authentication artifact; the parser validates path grammar and
     containment, not content or presumed purpose. This is also the sentence `AGENTS.md:31` requires of
     repository content: a prefix is a value the Bridge passes to a copy predicate and never
     something it executes, and the syntax makes it unable to name an authentication path outside the
     repository at all.
  4. *The dispositions are ordered, and the order is the partition.* A repository file entry under `.git` may also be
     outside the declared scope, so the predicates overlap. The classifier is therefore a first-match
     decision procedure with exactly three outcomes:

     1. under `.git` → **git metadata**, excluded;
     2. otherwise, reached by no declared prefix → **outside scope**, excluded;
     3. otherwise → **member**.

     Every repository file entry lands in exactly one category because the procedure is total and
     terminates, not because the predicates are disjoint. `.gitignore`, `.git/info/exclude`,
     `core.excludesFile`, and Git's skip-worktree bit are never consulted to change this disposition.
  5. *Exact in both directions.* `0034` may neither narrow the boundary nor widen it: a module that
     copies a path this procedure excludes fails the contract, and a module that withholds one it
     classifies as a member fails it just as hard. That is what lets the criteria reject a module
     shipping only what is written here — what is written here is the whole boundary, and both
     directions are asserted rather than one. The complete structural addition is ancestor
     directories required by extant regular members; creating any other directory or placing any
     file there is a widening and fails the same contract.
  6. *Outside scope means excluded, whatever Git says about the path.* A changed, staged, tracked,
     ignored, or untracked repository file path outside the declared scope remains outside every reviewer input and
     does not by itself refuse the run. Conversely, every extant regular path inside scope is copied,
     including an ignored or untracked one. This is the positive invariant in `AGENTS.md`: the scope
     is the complete admission authority, not a hint that Git metadata may narrow and not a baseline
     whose omissions the Bridge may widen. A repository that wants a new product path reviewed must
     declare a prefix that reaches it; a repository that omits a path has chosen not to disclose it.

  This clause is applied before the agreement table, and that ordering is part of the contract: an
  ineligible path is removed from consideration rather than classified by its `(H, I, W)` triple, so
  no row can be read as requiring an excluded file to be named, represented, or reported as deleted.

  **What this discharges, and what no copy-based design can.** A path reaches a Bridge input only
  because the repository named a scope containing it; the Bridge admits nothing on its own judgement
  and reads no byte to decide. It does not follow that a declared scope contains no credential, and
  this decision does not claim it does.

  Three review cycles across two chains have now asked for a boundary whose compliance does not
  depend on the declared paths being credential-free, and that requirement is unsatisfiable under the
  rest of the same policy. Deciding that a file is not a credential requires reading it, and
  `AGENTS.md:82` with `docs/AUTHENTICATION-AND-SECURITY.md:7` forbids the Bridge to read, copy, or
  store exactly that material — so a classifier strong enough to certify the scope would be the
  violation it was built to prevent. The options are therefore three and not more: certify by reading
  bytes, which the policy forbids; copy nothing, which ends implementation review; or admit only what
  the repository named, which is what this decision does and is the standard
  `CODEX_ENV_ALLOWLIST` already meets, since it does not prove `PATH` carries no secret and is not
  asked to. What an allowlist establishes is that anything admitted was named by the repository. It
  is not a waiver: under a denial the Bridge admitted paths on its own authority, and under an
  allowlist it never holds that authority at all.

  **Which of the three this repository takes was a human decision, and it is made.** On 2026-08-21
  the owner amended `AGENTS.md` rather than leave the sentence to be re-read every cycle. The
  prohibition at `AGENTS.md:82` is now stated over provenance — the Bridge never acquires that class
  from a credential store, an environment variable, a command-line argument, a configuration value,
  or an official client's private authentication state — and `AGENTS.md:83` states the disposition
  for repository files directly: contents are never read in order to classify a path, a repository
  file enters a Bridge input only when an explicit allowlist of paths admits it, and what the
  repository keeps under an admitted path, including a secret it committed or left in its working
  tree, is copied without inspection and is that repository's exposure exactly as under human code
  review. This decision takes the third option and the policy now says so.

  The fact that settled it was already in the product. `src/adapters/codex.ts:253-262` creates a
  temporary workspace and writes `AGENTS.md` and `task.md` into it with no inspection of their bytes:
  a fixed two-path allowlist, running on every plan review this task has been through, including the
  ones that reported the finding. The strict reading therefore did not merely withdraw implementation
  review; it condemned the shipped plan review reporting it. D1 generalises a disposition the product
  already has rather than introducing one, which is why the question was answerable at all.

  The allowlist is also the second thing that defeats option three, on the adopter's own terms:
  option three hands over a directory in which the adopter's scope means nothing, and the copy is
  what makes that allowlist take effect.
- **Completeness.** The rows of the agreement table are also the completeness claim, read the other
  way: a member the implementer never touched is present under `worktree/` anyway, because a reviewer
  that cannot open an unchanged neighbour cannot judge a change. That is what stops a repository's
  declared scope from being satisfied by copying only the changed files inside it.
  Membership does not depend on machine-local state: the same repository yields the same workspace
  on a machine whose `.git/info/exclude` or `core.excludesFile` would otherwise have changed it.
- **Fail-closed.** A repository the module cannot prepare within those rules ends the run
  `reviewer_isolation_unavailable`, no reviewer is spawned, and the run retains a manifest naming
  what was seen.

Confidentiality and completeness are the two directions of one boundary, and the contract states
both because a module can satisfy either alone trivially — by copying nothing, or by copying
everything.

`src/core/workspace.ts`, `src/core/snapshot.ts`, and the manifest are out of this task's scope. This
task is that module's only caller and does the wiring; it cannot be implemented before the module
exists, because an implementation review that runs against a stubbed preparation would demonstrate
the loop closing without ever showing a reviewer a product file.
### D2 - The Bridge never runs the checks, and the artifact state is the whole of the assertion

The Bridge does not run required checks, and does not read their result from anywhere. Running them
would mean taking a command out of repository content and spawning it. `AGENTS.md` draws exactly that
line for launchers — "Repository content may select this alias but may not define launcher commands"
— and the same reasoning applies with more force here, because `AGENTS.md` is also the file the Bridge
treats as policy. A policy file that can name an executable the Bridge runs is a policy file that can
run anything. Reading a result from a status file elsewhere was rejected for a smaller reason: it adds
a second source of truth about a claim the artifact already carries, and nothing would make that file
honest either.

The claim is about commands, not about executable names, so it is stated over both routes by which
one could run: the Bridge spawns only executables named by module constants, **and** where a spawned
tool would run a command on the repository's behalf, it is disabled or the run is refused.

It is a claim about commands and not about provenance. `AGENTS.md` is repository content and is
meant to decide the host, the model, the effort, and the client-context alias; those reach a
launcher's argv as values it already accepts, and nothing about them names something to execute. The
line this decision draws is between a value the Bridge passes and a command the Bridge would run:
repository content may choose the first and may not supply the second, whether directly as an
executable name or indirectly through a configuration key that makes a spawned tool run a helper. The second
half is task `0034`'s to implement and to prove — it is one of the five findings that sent the
assembly there — and this decision states it as a property the workspace module must have, not as a
procedure this task defines. An
enumeration of the argv tables is necessary and not sufficient, which is what the second cycle's
review established.

So the condition is the implementer round's own assertion, and the assertion is exactly the artifact
state, not the prose beside it. An implementer round whose checks pass records their outcomes in the
task file and, in the same edit, writes `task_type: implementation`, `phase: reviewing`,
`current_role: implementer`, `next_role: reviewer` — the state task `0028` in fact carried at commit
`875e843`. D4 makes that state the only one from which an implementation review is admissible, and D6
writes the grant against that state rather than against the act of recording, so that what authorizes
the transition is the same thing the runtime can check. The Bridge never reads the body looking for a
check outcome, and never treats its presence or absence as a condition. Recording the outcomes stays
an obligation on the implementer round — `AGENTS.md` already carries it under development
expectations — and it is an obligation the Bridge does not enforce.

The implementer round is then entered through `/spbridge`, the way a producer round whose review the
Bridge dispatches already is, and `agent-skill/skills/spbridge/SKILL.md` loses the sentence excluding an
implementer round from the skill. `/spbridge` is the producer-facing invocation and the only one a
handoff names; the `spartan-bridge review` call is internal to the skill, which spawns it once per
cycle after the producer round has written the artifact. `AGENTS.md` states the first as a rule —
"A producer round whose review the Bridge dispatches is entered through `/spbridge`" — and this task
does not create a second route into a review. `docs/ROUTING-AND-WORKFLOWS.md:247` is corrected in the same change: "after required checks
pass" reads as a condition the Bridge evaluates, and it never will.

**When the checks fail**, the round does not write that state and does not invoke. It leaves
`phase: implementing` and `next_role: implementer`, records what failed, and hands back — the same
thing a producer round does today when it cannot finish. If it invokes anyway, the run is refused at
frontmatter admission with `task_invalid` before any adapter is constructed and before anything is
spent. The named cost: `task_invalid` does not distinguish "not in a reviewable state" from
"malformed frontmatter". A dedicated reason code was considered and rejected — the human can read the
state off the artifact in one line, and a new code would add runtime surface without adding
information.

This is a place where the Bridge is deliberately not the guarantee, and `docs/` says so plainly: the
Bridge dispatches a review because the artifact says the implementer finished, and it never verified
that the checks behind that claim were run or passed.

### D3 - The kind becomes a value, not a second runtime

Whatever D1 settles, plan review and implementation review share the run lifecycle, the event log,
the transition rules, and the one-writer constraint. The difference is the binding row, the workspace,
and the prompt. This task therefore widens `REVIEW_KIND` rather than adding a parallel path, so that a
later reader finds one review with two kinds instead of two reviews that drifted.

The kind reaches the adapter as a field of `AdapterReviewInput`, which already exists and already
carries `review_kind`; today it is a constant, and it becomes the resolved value. `capabilitiesAllowed`
stops asserting a single constant and instead requires a non-empty, duplicate-free list drawn from the
two kinds; the run then requires its resolved kind to be in that list, failing `capability_denied`
when it is not. An adapter that supports one kind stays legal, which is what keeps Cursor declaring
`["plan"]` truthfully rather than claiming a workspace it does not build.

Legality of the list and support for this run are separate gates. After resolving the kind and the
adapter, but before preflight, preparation, or start, the run requires the resolved kind to occur in
that adapter's legal list. A plan-only adapter on an implementation artifact and an
implementation-only adapter on a plan artifact both end `capability_denied`; neither reaches a spawn.

The repository's three declarations are pinned rather than left for an implementer to infer. Codex
declares `["plan", "implementation"]` because it prepares both workspaces; Cursor declares
`["plan"]` because this task builds no Cursor implementation workspace; and the deterministic fake
declares `["plan", "implementation"]` so the shared lifecycle can be exercised for either kind
without an official-client process. The two-member lists use that order.

### D4 - The kind is resolved from the artifact, and one admitted state is added

The kind is not a flag. `spartan-bridge review` keeps its two arguments, `/spbridge` keeps its rule
against passing a review kind, and nothing about which review runs depends on what a caller typed.

The kind is a function of the frontmatter state the artifact already carries. Today
`src/policy/task-frontmatter.ts:144` admits exactly `(task_type: planning, phase: planning)`, with no
constraint on the roles beyond their being roles. After this task it admits that state unchanged, and
one more: `(task_type: implementation, phase: reviewing)` **together with** `current_role: implementer`
and `next_role: reviewer`. The first resolves to `plan`, the second to `implementation`, and every
other combination is `task_invalid`.

`parseTaskFrontmatter` is that review-admission gate and only that gate. It does not admit a
post-write `next_role`. After a D7 write, `commitTaskArtifactWrite` validates the written document
with the frontmatter grammar — required keys, types, dates, `status`, risk, role membership, and
handoff identifiers — and does not re-apply the review-admission pair. A write that leaves
`next_role` as `implementer` or `human-operator` therefore commits; those same bytes remain
`task_invalid` for dispatch. The two checks share a parser for the grammar and diverge at admission.

The roles are part of the implementation test and not of the plan test, and the asymmetry is
deliberate. Requiring them on the plan path would refuse artifacts the runtime accepts today, which
this task does not ask for. Requiring them on the implementation path costs nothing, because that path
has no existing artifacts to break, and it is what makes the admitted state mean "the implementer
finished and handed to review" rather than merely "this is an implementation task". Without the roles,
an artifact carrying the pair but no handoff at all would dispatch a review, which is the transition
D6 grants read literally and not the one it means.

`src/policy/agents-policy.ts` resolves the row named by the kind. The reason code does not change:
`reviewer_binding_missing` already exists and already carries a detail naming the row, so the
implementation case is `reviewer_implementation_row_missing` beside `reviewer_plan_row_missing`. A
repository missing only the implementation row keeps working for plan review.

### D5 - One region per kind, named by kind, with the other kind's region held byte-identical

`## Review` becomes a section with up to two Bridge-owned regions. They are told apart by their
markers, not by their position: `<!-- spartan-bridge:review:plan:begin -->` and its `:end`,
`<!-- spartan-bridge:review:implementation:begin -->` and its `:end`. Position is then fixed as a
consequence rather than as an identity — a plan review always precedes the implementation review of
the same artifact, so a new region is appended after any existing one and an implementation region
above a plan region is refused.

A write of kind K modifies exactly one span inside `## Review`: the region of kind K. Stated as the
complete list of what a write may change: the region of kind K, the frontmatter values of `next_role`
and `updated_at`, and nothing else in the document. The other kind's region, its provenance line, and
every human-written line in the section are required to be identical, which is a strengthening of
today's rule rather than a relaxation of it, because the other region is now checked as protected text
rather than being absent. That enumeration is also the correction of a wording this task carried into
its second review: "every byte outside both regions" contradicted D7, which changes `next_role` on the
same write.

**The human text is compared as positional segments, not as one concatenation.** Today `humanBody` at
`src/core/task-write.ts` treats the human body as everything after the single region's end. With two
regions, concatenating what is left would let text move from above the first region to between the two
without being noticed. The section is therefore split at the region boundaries into an ordered list of
segments — before the first region, between the regions, after the last — and each segment is compared
with its counterpart in position. The boundary between Bridge-owned and human-written text is defined
by markers, and only by markers.

**A legacy unscoped region is the plan region.** `plan` is the only kind the runtime could have
written before this change, so an artifact carrying `<!-- spartan-bridge:review:begin -->` is read as
carrying a plan region. A plan write replaces it, which renames its markers to the scoped form. An
implementation write leaves it byte-identical and places its own region after it, because a write of
kind K may not touch another kind's span — including to tidy it. Migration therefore happens on the
next plan review or not at all, which is the correct trade for a rule that is otherwise absolute.

`REGION_BYTE_CAP` is unchanged and applies per region. `headingRejects` still requires exactly one
`## Review` heading. What this decision does **not** decide is what happens to text outside every
region: the template's `Verdict: PENDING`, observed on 2026-08-20 surviving below the region Bridge
run `run-2a15877b-42f4-43b0-987b-aa6d665a6fef` wrote into task `0028`, stays exactly as it is today.
Task `0024` owns that question, and this task gives it a section where the answer applies to a
marker-defined boundary rather than to a position.

### D6 - A separate grant sentence, written against a state the runtime can check

The existing literal at `src/policy/agents-policy.ts:62` reads "A human-started Spartan Bridge run may
start the mapped reviewer automatically." and, read on its own, already covers both kinds. Relying on
it was rejected, and not on principle. Every adopting repository that wrote that sentence wrote it
when plan review was the only review the runtime could dispatch. Reusing it would turn their existing
file into authorization for a transition they never considered, silently, on upgrade. A grant that
widens itself when the runtime gains a capability is a fail-open, whatever its wording.

`AGENTS.md` therefore gains one sentence in `## Spartan Bridge automation authority`, matched as a
literal beside the two grants already matched there:

```markdown
- A human-started Spartan Bridge run may start the mapped `reviewer.implementation` automatically when the current Spartan task artifact declares the implementer round finished and the reviewer round next; the Bridge takes that declaration as the implementer's assertion that the required checks passed, and does not verify it. That reviewer is given a read-only copy of the working-tree file content admitted by the implementation review scope declared below, excluding only `.git` metadata; repository ignore rules do not classify or remove files, ancestor directories are created only as containers for admitted files, and no repository file path outside that scope appears in the copy or in any other file the reviewer is given.
```

The sentence names the artifact state D4 admits, which is a thing the runtime checks, rather than the
act of recording check outcomes, which is a thing it cannot. An earlier wording conditioned the grant
on the implementer "having recorded its required checks in the task artifact"; that made the written
grant broader in obligation than anything enforced, so an artifact could satisfy the runtime while
failing the grant. The sentence now says what is enforced and says plainly what is not.

**Its second half is the other thing this grant has to carry.** Authorizing a reviewer to start
without saying what that reviewer is handed would be a notice failure of exactly the species the
first half of this decision refuses: a repository writing a sentence about starting a process, and
receiving a copy of its working tree. The two halves are one literal because they are one decision —
a repository cannot accept the transition and decline the copy, since the copy is what the transition
consists of.

**And this section is where the scope itself is declared.** D1's boundary is an allowlist, so the
grant is meaningless without the list it points at. `AGENTS.md` therefore carries a second heading
inside the automation-authority section:

```markdown
### Implementation review scope

- `src/`
- `tests/`
- `docs/`
- `skills/`
- `agent-skill/skills/spbridge/SKILL.md`
- `spartan/`
- `AGENTS.md`
- `package.json`
- `tsconfig.json`
```

`skills/` admits descendants of that named directory and does not reach a path that merely contains
a `skills/` segment, so `agent-skill/skills/spbridge/SKILL.md` is a separate exact-file entry. That
is the producer-facing skill D2 changes, and an implementation reviewer is given it because the
allowlist names it.

`parseAgentsPolicy` reads those list items as the scope, applying D1's clause 3 syntax. The grant and
the scope fail closed together and for the same reason: the grant sentence present with no scope
heading, a scope heading with no entries, or any entry the syntax refuses each leave the
implementation grant unreported, and an implementation review is refused
`automatic_review_not_authorized` with detail `implementation_review_scope_invalid` beside the
`implementation_review_grant` detail an absent sentence produces. A repository that has said nothing,
and a repository that said something the Bridge cannot read as a path, are both refused before any
adapter is constructed. Plan review is unaffected by either: the plan workspace is two files and
reads no scope.

`parseAgentsPolicy` reports the sentence as its own boolean, the way `task_artifact_write_authorized`
and `producer_chain_authorized` are reported, and reports the scope beside it. Both refusals land
before any adapter is constructed, and therefore before any workspace is prepared and before any
repository path is read for copying. That ordering is what makes refusal the default for a repository
that has said nothing, which is the fail-closed disposition D1's confidentiality clause rests on.

The prohibition list item beside it is replaced in full. Its current complete text is “The Bridge
may not start implementation automatically unless this file is amended with a separate explicit
grant for that transition.” Its exact replacement is “The Bridge may not start an implementer round
automatically.” The amendment clause is intentionally removed: this decision supplies the separate
grant it anticipated for automatic implementation *review*, while the rewritten prohibition is the
unconditional boundary that the Bridge still cannot start the next implementer round. Leaving the
clause attached would preserve a condition whose referent changed under the rewrite and would fail to
pin the exact prohibition this decision chooses. The sentence is not matched by the parser, so the
correction has no runtime effect; it exists so the file does not contradict itself. The
`task_artifact_write` grant is unchanged: persisting an implementation verdict into the region of one
identified artifact is the same power it already names.

### D7 - The implementation transition ends at the human, and never at the implementer

`pass` writes `next_role: human-operator` and stops the chain; `changes_requested` writes
`next_role: implementer`. The plan mapping is untouched.

`human-operator` rather than `verifier` or `completed`: the Bridge dispatches reviewers and nothing
else, so naming a role it cannot start would leave the artifact pointing at a round nobody begins, and
deciding a task is complete is a judgement `AGENTS.md` reserves. Task `0032` ended its own approved
implementation review at `next_role: human-operator`, so this is the observed convention rather than a
new one.

`changes_requested → implementer` is not the transition `AGENTS.md` withholds. That prohibition is
about starting implementation from an approved plan. Returning findings to the round that produced the
work is the chain the same file already grants — "The Bridge may return findings to the current
producer and repeat up to 3 review cycles" — and the producer here is the implementer. The Bridge
still never starts an implementer round: it writes the role and stops, exactly as it does when a plan
review passes and writes `next_role: implementer`.

**The loop, which one transition is not.** The Objective says the implementation loop closes the way
the plan loop closes, and a single verdict does not make a loop. What closes it is the chain the
runtime already has: an implementer session that receives `changes_requested`, revises the worktree
and the artifact, restores `next_role: reviewer`, and dispatches the next implementation review from
that same session under `--after-run`, counted against the same `max_review_cycles`. The
producer-chain grant stays kind-agnostic. `resolveReviewChain` stays the single chain function.

For an implementation run it additionally resolves the mapped `implementer` binding into a typed
producer identity `{ role: "implementer", host }`, records that identity on
`StatusDocument.producer_identity` from `policy_resolved` onward, and refuses `chain_refused` /
`not_authorized` when a chained continuation would resolve a different implementer host than the
parent recorded. That comparison runs after reviewer-host and kind equality and before
`artifact_hashes.agents`, so changing only the `implementer` row cannot be reported as
`agents_changed`. Reviewer `host`, kind, agents hash, task hash, cycle, and the no-producer-spawn
rule stay as they are; a reviewer-host mismatch is still `not_authorized` before adapter
construction. Plan runs record `producer_identity: null` and do not compare it. `EventDocument` is
unchanged. A missing `implementer` row fails implementation review `reviewer_binding_missing` with
detail `implementer_row_missing` before any adapter is constructed, and still resolves a plan review.

Four boundaries hold across those cycles, and they are what the criteria assert rather than the
happy path. The producer does not change: the chain continues inside the human-started implementer
session, and the Bridge never starts a second one. The host does not change: `AGENTS.md` requires the
Bridge to stop before changing the producer role or producer host, so a chain that would resolve a
different implementer host stops for the human. And the budget belongs to the chain rather than to the task or to the
kind: `resolveReviewChain` counts by following `--after-run`, so a run started without one is cycle 1
and a chain is exactly the sequence of runs a single human-started session produced. A chain of `max_review_cycles: 3`
therefore admits three reviews — cycles 1, 2, and 3 — and stops the *fourth* chained attempt on
`cycle_limit_reached`, because the guard compares `parent.cycle + 1` against the limit. An earlier
draft said the third review ends the chain, which finding `CYCLE_LIMIT_OFF_BY_ONE` correctly read
against the code. The count begins at 1 even for a task whose plan review already spent three.

An earlier draft of this decision claimed the opposite — one budget across both kinds — and finding
`CYCLE_BUDGET_CONTRADICTION` was right that it contradicts the prohibition beside it. A plan chain
cannot run on into implementation review, because reaching an implementer producer means starting an
implementer round, which `AGENTS.md` forbids the Bridge to do and D7 forbids twice over. The human
starts that round, and a human-started run is the root of a chain. So the two facts are one fact: the
budget resets because a person acted, and the reset is not a fail-open but the shape of the gate. A
shared budget would also have required a mechanism this task never proposed, since nothing in
`resolveReviewChain` carries a count across an unlinked run. The criterion that asked for a test
spending plan cycles before refusing the implementation chain asked for a bug, and is replaced by two
that assert what the runtime does.

And nothing the Bridge spawns is ever a producer. Across a whole chain — every verdict, every cycle,
and the cycle-limit stop — the only process the Bridge constructs or spawns is a reviewer adapter for
the kind the run resolved. `changes_requested → implementer` writes a role into frontmatter, which is
a word in a file and not a launch. That is stated as an observable rather than as an intention,
because it is the one boundary the prohibition in `AGENTS.md` is actually about, and the transition
map alone cannot show it: a map that writes `implementer` looks identical whether or not something
downstream acts on it.

### D8 - The reviewer's answer is validated against the kind the run dispatched

`src/core/result.ts:28` compares `review_kind` to the global constant. It instead compares against the
kind this run resolved. That is tighter than an enum membership test, not looser: a reviewer that
answers `"plan"` to an implementation run is rejected `result_schema_invalid` rather than accepted as
a valid member of the widened set. The Codex output schema's `const` follows the same value, so the
constraint is stated to the reviewer as well as checked after it.

`SCHEMA_VERSION` stays at `2`. `EventDocument` is unchanged. `StatusDocument` gains
`producer_identity` as D7's recorded implementer identity: `null` on plan runs, `{ role:
"implementer", host }` on implementation runs; serialize copies only `role` and `host`. The
`review_kind` value set widening remains additive: every consumer inside this repository reads that
field rather than switching on its literal. `PROTOCOL_VERSION` stays `"0.7.0"`. It remains the
signal for readers outside this repository, and it is pinned by a test so the version cannot be
forgotten.

## Acceptance Criteria

- [x] D1 shape: an implementation workspace contains exactly `AGENTS.md`, `task.md`, `diff.patch`,
      `changes.txt`, and a `worktree/` subtree, asserted by a test that reads the prepared workspace
      and names every top-level entry; a plan workspace over the same fixture contains exactly two
      files.
- [x] D7 loop: an implementer session that receives `changes_requested`, revises, restores
      `next_role: reviewer`, and dispatches again under `--after-run` reaches a second implementation
      review inside the same human-started session, asserted over the run chain rather than over one
      run. The test names the two run ids and asserts the second carries `review_chain.cycle` 2.
- [x] D7 loop, boundaries: a chained implementation review whose mapped `implementer` host differs
      from the `producer_identity` recorded on the parent run stops `chain_refused` /
      `not_authorized` before any adapter is constructed. The test changes only the `implementer`
      binding host, restores `next_role: reviewer`, and names `--after-run`. The refused cause is
      not `agents_changed`.
- [x] D7 loop, reviewer host remains guarded: changing only the `reviewer.implementation` host,
      with the `implementer` row held fixed, also stops `chain_refused` / `not_authorized` before
      adapter construction.
- [x] D7 producer identity: an implementation review resolves the `implementer` binding from the
      same host table. Absence fails `reviewer_binding_missing` with detail `implementer_row_missing`
      before any adapter is constructed; a repository missing only that row still resolves a plan
      review with `producer_identity: null`. A resolved implementation run records
      `{ role: "implementer", host }` on `status.json` from `policy_resolved` onward.
- [x] D7 loop, the budget belongs to the chain: a task whose plan review chain spent all three
      cycles, and whose implementer round a human then started, reaches its first implementation
      review at `review_chain.cycle` 1 with `after_run_id` null. The plan chain's count does not
      carry, asserted over the two chains' status documents, and the test crosses no producer
      transition because the implementer run is started as a fresh run rather than chained from a
      plan run.
- [x] D7 loop, the implementation chain's own limit: inside one human-started implementer session
      with `max_review_cycles: 3`, three implementation reviews are admitted at
      `review_chain.cycle` 1, 2, and 3, and the fourth chained attempt stops `cycle_limit_reached`
      with no reviewer spawned. The test names all four attempts, so an off-by-one in either
      direction fails it; every run after the first carries `--after-run`, and no plan run is among
      them.
- [x] D7 loop, no producer is spawned: every process the Bridge constructs or spawns is a reviewer
      adapter for the resolved kind, asserted over the recorded spawns rather than over the
      transition map, across three separate chains because a `pass` and a `cycle_limit_reached`
      cannot terminate the same one — a chain of two `changes_requested` cycles, a chain ending in
      `pass`, and a chain reaching the cycle-limit stop. A run that wrote `next_role: implementer`
      and also started an implementer fails, which the transition-map criterion above cannot
      detect.
- [x] D1 confidentiality, outside scope is absent: over a fixture repository whose declared scope is
      `src/` and `README.md`, a tracked and unchanged `credentials.json`, `.npmrc`, and `.netrc` at
      the repository root are each absent from `worktree/`, from
      `diff.patch` in any form git emits, from `changes.txt`, and from the manifest. Each assertion
      quotes the path it searched for and the bytes of the output it searched. The three the earlier
      finding named are asserted by name and in this direction because the criteria they replace
      required the opposite, which is the defect `CREDENTIAL_BOUNDARY_UNSAFE` found.
- [x] D1 confidentiality, declared paths are present regardless of Git metadata: over the same
      fixture, untouched `src/neighbour.ts`, tracked-and-ignored `src/secrets.json`, and ignored,
      untracked `src/.env.local` are each present under `worktree/` with their working-tree bytes.
      Their corresponding `changes.txt`, `diff.patch`, and manifest dispositions follow the D1 table,
      and changing `.gitignore`, `.git/info/exclude`, or `core.excludesFile` changes no output.
- [x] D1 confidentiality, outside scope stays absent regardless of change state: the fixture carries
      one tracked modification, one staged addition, one staged deletion, and one ignored untracked
      path outside `src/` and `README.md`. The review is prepared and the reviewer is spawned, while
      none of those paths appears in `worktree/`, `diff.patch`, `changes.txt`, or the manifest. The
      test proves that neither Git change state nor ignore state widens the declared allowlist and
      that an out-of-scope change is exclusion, not a refusal.
- [x] D1 confidentiality, closed classifier: the test enumerates every repository file entry and classifies
      each by D1 clause 4's ordered procedure — git metadata, outside scope, member — then asserts the
      prepared workspace agrees file by file. It separately asserts that the workspace directory set
      is exactly the ancestor closure of extant regular members. No call reads `.gitignore`, `.git/info/exclude`, or
      `core.excludesFile`, and no path is omitted for a fourth classifier outcome; an unreadable
      member, unsupported entry type, or cap overflow refuses the whole preparation instead.
- [x] D1 confidentiality, git metadata: over the same fixture, no `.git` entry and no path under one
      exists anywhere in the prepared workspace, including when a declared prefix would otherwise
      reach it. Asserted separately from the criteria above, because git will not hold an index entry
      under `.git` and the excluded content is therefore untracked metadata rather than a tracked
      file.
- [x] D1 confidentiality, scope syntax fails closed: a declaration carrying an absolute path, a `~`
      prefix, a `..` segment, a glob, a negation, or a regular expression is refused
      `automatic_review_not_authorized` with detail `implementation_review_scope_invalid`, one case
      per form, before any adapter is constructed. The whole scope is refused rather than the bad
      entry dropped, asserted by a case whose other entries are valid.
- [x] D1 confidentiality, scope matching is exact: the parser decodes one inline-code span per list
      item, preserving its inner bytes. An exact entry `README.md` admits that file and no other file;
      `src/` admits file entries `src/a.ts` and `src/nested/b.ts` but not `srcfoo` or
      `packages/src/a.ts`; and `packages/app/` admits `packages/app/index.ts` while excluding
      `packages/application/index.ts`. For those admitted extant files, `worktree/` contains exactly
      structural directories `src`, `src/nested`, `packages`, and `packages/app`; those directories
      are absent from `changes.txt`, `diff.patch`, and the regular-file manifest.
      Extra prose, multiple spans, an empty span, or unmatched backticks refuses the whole scope.
- [x] D1 confidentiality, syntax is not a credential-name classifier: the same parser accepts and
      preserves syntactically valid declarations ending `.env`, `.npmrc`, `.netrc`,
      `credentials.json`, `.ssh/config`, `.aws/config`, `.gnupg/key`, and `.config/client.json`.
      When declared, each follows the ordinary member disposition without content inspection; when
      outside scope, each follows the ordinary outside-scope disposition. The test pins that path
      grammar and containment are the complete parser concerns after `.git` metadata exclusion.
- [x] D1 confidentiality, declaration is the precondition: a fixture repository whose `AGENTS.md`
      carries D6's grant sentence but no scope heading, and one carrying the heading with no entries,
      each end an implementation review `automatic_review_not_authorized`, and no workspace is
      prepared — asserted by a workspace module stub that records every call and is asserted never to
      have been called, so the refusal is shown to precede the copy rather than merely to accompany
      it. A repository missing the grant sentence instead refuses with detail
      `implementation_review_grant`, and each of the three still runs plan review unchanged.
- [x] D1 agreement, enumeration: one fixture carries a member in each of the seven `(H, I, W)`
      combinations D1 tabulates, and every one of the twenty-one cells is asserted as written — per
      cell, not as an equality between the output sets. The test also asserts that only repository
      file entries enter this table; container directories have no triple. The fixture is built by the script in
      `spartan/probes/git-change-class-rendering.md`, so the states under test are the measured ones
      rather than states the test author believed git produces.
- [x] D1 agreement, the three rows measurement added: the `(✗, ✓, ✗)` member — staged, then removed
      — is asserted absent from `worktree/`, named in `changes.txt`, and absent from `diff.patch` in
      every form, with the test quoting the whole of `diff.patch` it searched. The `(✓, ✗, ✓)`
      member — `git rm --cached`, file kept — is asserted present under `worktree/` with its
      working-tree bytes *and* represented in `diff.patch` as a deletion, the two holding at once.
      The `(✓, ✗, ✗)` member — an ordinary `git rm` — is asserted named as deleted in `changes.txt`
      and represented in `diff.patch`, which fails against any included set assembled from
      `git ls-files --cached` and `git ls-files --others` alone.
- [x] D1 agreement, the rows that separate near-neighbours: the `(✗, ✓, ✓)` index-added member is
      asserted present under `worktree/`, named as added, and represented in `diff.patch`, while the
      `(✗, ✗, ✓)` untracked member is asserted present under `worktree/`, named as untracked, and
      *absent* from `diff.patch`; and the unchanged member is asserted present under `worktree/` and
      absent from both others.
- [x] D1 agreement, representation: the fixture carries one member whose change is binary content and
      one whose change is mode only, and each is asserted represented in `diff.patch` — a
      `diff --git` entry naming its path — with the assertion made over the entry and the path and
      not over the presence of a hunk, since git emits neither a hunk for a binary change nor a hunk
      for a mode-only one. The test quotes the `diff --git` line it matched for each.
- [x] D1 agreement, rename: over a fixture in which a tracked file's content moves to a new path,
      `changes.txt` names the old path as deleted and the new path as added on separate lines, and
      both are represented in `diff.patch`. The test quotes the `changes.txt` lines it matched, so a
      single line naming two paths fails the criterion rather than satisfying it.
- [x] D1 agreement, containment: every path named in `changes.txt` and every path `diff.patch`
      touches is present under `worktree/`, except the three members whose `W` is `✗`, which are the
      only permitted file absences and are asserted absent for that reason and no other; the manifest
      names exactly the regular files under `worktree/`; and the directories under `worktree/` are
      exactly the ancestor closure of those regular files. Asserted over the prepared workspace
      rather than against the module's own included set.
- [x] D1 entry types: every entry under `worktree/` is a regular file or a directory under a
      no-follow stat, asserted over the whole subtree; every directory is required by at least one
      regular file member and appears in no file-output record; and a fixture whose included set contains a
      tracked symlink, and one containing a gitlink, each end the run
      `reviewer_isolation_unavailable` with no entry copied for that member and no target
      dereferenced.
- [x] D1 completeness, machine-local state: the fixture prepared on a machine whose
      `.git/info/exclude` and `core.excludesFile` would exclude the untouched member yields a
      byte-identical workspace to the fixture prepared without them.
- [x] D1 fail-closed: a fixture the workspace module refuses ends the run
      `reviewer_isolation_unavailable`, no reviewer process is spawned, and the run retains a
      manifest naming what was seen.
- [x] D1: the implementation prompt names each workspace entry, tells the reviewer it may read
      anything under `worktree/`, and states that no other path is available; the plan prompt at
      `src/adapters/codex.ts:107` is byte-identical for a plan run. Both prompt texts are pinned.
- [x] D2: every executable this task's code spawns is identified by a module constant, and no argv
      element is a command, a command line, an executable path, or a flag naming one, drawn from
      repository content — asserted by a test enumerating the argv tables in `src/adapters/` and
      `src/core/review.ts`. The claim is over executable identity and helper-command mechanisms, not
      over argv provenance in general: `AGENTS.md` supplies the host, model, effort, and
      client-context alias, and those reach argv as values a launcher already accepts. The test
      names that distinction and asserts it in both directions, so a policy-supplied model still
      passes and a policy-supplied command name still fails.
- [x] D2: the second route — a repository configured to run a helper command — is closed by the
      workspace module and surfaced by this task's wiring: with a stub module returning that
      refusal, the run ends `reviewer_isolation_unavailable` and no reviewer is spawned. The refusal
      itself and its hostile-configuration coverage are task `0034`'s, under D1's fail-closed
      clause.
- [x] D2: `/spbridge` is the only producer-facing invocation this task documents. No handoff,
      advisory, or document it changes tells a producer round to call `spartan-bridge review`
      directly, asserted by a text test over `agent-skill/skills/spbridge/SKILL.md` and the
      documents in scope.
- [x] D2: an artifact that is not in the reviewable implementation state — `phase: implementing` with
      `next_role: implementer` is the state a failed check leaves behind — is refused `task_invalid`
      and no reviewer is spawned.
- [x] D2: `docs/ROUTING-AND-WORKFLOWS.md:247` no longer conditions the transition on anything the
      Bridge would have to know, and states in terms that the Bridge does not run or verify the
      required checks and that recording them is the implementer round's obligation.
- [x] D2: `agent-skill/skills/spbridge/SKILL.md` no longer states that an implementer round is not
      entered through the skill, states the artifact state under which it is, and
      `tests/spbridge-skill.test.ts` pins the replacement text.
- [x] D3: `capabilitiesAllowed` accepts an adapter declaring `["plan"]`, `["implementation"]`, or
      both, and refuses an empty list, a duplicated list, and any member outside the two kinds.
- [x] D3: support is checked against the resolved run kind after list validation and before spawn. An
      implementation artifact resolved to a plan-only adapter, and a plan artifact resolved to an
      implementation-only adapter, each end `capability_denied`; in both cases preflight, prepare,
      and start are asserted not called.
- [x] D3: the production declarations are exact and ordered: Codex and the fake each declare
      `["plan", "implementation"]`, while Cursor declares `["plan"]`. Adapter capability tests pin
      all three lists, so Cursor cannot claim a workspace this task does not build and Codex or the
      fake cannot silently omit the new kind.
- [x] D3: the run lifecycle is not duplicated per kind. `src/core/review.ts` gains no second
      request/resolve/spawn/collect/verify path, and the kind reaches the adapter as a field of
      `AdapterReviewInput` rather than as a branch.
- [x] D4: `parseTaskFrontmatter` admits exactly two states — `(task_type: planning,
      phase: planning)` under today's rules unchanged, and `(task_type: implementation,
      phase: reviewing)` only when `current_role` is `implementer` and `next_role` is `reviewer` —
      and refuses everything else with `task_invalid`. A table test names at least
      `(implementation, implementing)`, `(planning, reviewing)`, `(implementation, planning)`,
      `(implementation, reviewing)` with `current_role: planner`, `(implementation, reviewing)`
      with `next_role: implementer`, `(implementation, reviewing)` with `next_role: human-operator`,
      and `(implementation, reviewing)` with `next_role: verifier`. Dispatch of each refused
      implementation `next_role` ends `task_invalid` with no adapter constructed.
- [x] D4: the plan path admits exactly what it admits today, asserted by running the existing
      frontmatter fixtures unchanged, including a plan artifact whose `current_role` is not
      `planner`.
- [x] D4: the review kind is a function of the admitted state alone. The CLI gains no review-kind
      flag, asserted by a parse test in which `--review-kind implementation` is rejected.
- [x] D4: `reviewer.implementation` is resolved by the same parser that resolves `reviewer.plan`. Its
      absence fails `reviewer_binding_missing` with detail `reviewer_implementation_row_missing`, and
      a repository missing only that row still resolves a plan review unchanged.
- [x] D4: post-write validation is not review admission. After an implementation `pass` write and an
      implementation `changes_requested` write, the write reports `written`,
      `parseTaskFrontmatterDocument` accepts the written bytes, and `parseTaskFrontmatter` of those
      same bytes throws `task_invalid`. A subsequent `runReview` of each written artifact ends
      `task_invalid` with no adapter constructed.
- [x] D5: after a plan review and then an implementation review of one artifact, `## Review` holds
      exactly two Bridge regions, the plan region above the implementation one, each delimited by its
      own kind-scoped markers.
- [x] D5: the second write changes exactly the enumerated things. Across it, the implementation region
      differs, the frontmatter `next_role` and `updated_at` values differ, and every other byte of the
      document is identical — the plan region including its `Bridge run:` line, every other
      frontmatter line including its comment and quoting, and every section outside `## Review`.
- [x] D5: human text is preserved by position. A section carrying text above the first region, between
      the regions, and below the last is written to, and each segment is asserted to be identical and
      still in its own position; a document in which such text has moved across a region boundary is
      refused with `task_artifact_write_rejected` and restored byte-for-byte.
- [x] D5: a second review of one kind replaces its own region in place and leaves the other kind's
      region byte-identical, including its `Bridge run:` provenance line.
- [x] D5: a legacy unscoped `<!-- spartan-bridge:review:begin -->` region is treated as the plan
      region: a plan write replaces it with the kind-scoped form, and an implementation write leaves
      it byte-identical and places its own region after it.
- [x] D5: two regions of one kind, an unbalanced pair, a marker outside `## Review`, or an
      implementation region above a plan region is refused with `task_artifact_write_rejected` and
      the file is restored byte-for-byte.
- [x] D5: `REGION_BYTE_CAP` is unchanged and applies to each region separately.
- [x] D6: `AGENTS.md` carries D6's grant sentence byte-for-byte, both halves of it, and
      `parseAgentsPolicy` reports the implementation grant only when that exact sentence is a list
      item of `## Spartan Bridge automation authority`. A file carrying only the first half — the
      transition without the copy it authorizes — does not report the grant.
- [x] D6: `AGENTS.md` carries exactly one list item whose complete text is “The Bridge may not start
      an implementer round automatically.”, pinned byte-for-byte by a text test alongside the grant
      sentence. The existing complete sentence “The Bridge may not start implementation
      automatically unless this file is amended with a separate explicit grant for that transition.”
      does not satisfy that assertion, so the new implementation-review grant cannot coexist with
      the ambiguous prohibition this decision replaces.
- [x] D6: the grant sentence and D1's contract describe the same copy. A test reads the boundary out
      of the pinned sentence and asserts it is exactly the declared scope less `.git` metadata; it
      also asserts that the sentence says repository ignore rules do not classify or remove files
      and names no credential denial list. The test pins the complete structural addition as ancestor
      directories used only to contain admitted regular files, with no outside-scope repository file
      path, so the grant and D1 cannot drift into different copies.
- [x] D6: `parseAgentsPolicy` reads each `### Implementation review scope` list item as exactly one
      inline-code span, strips its backtick delimiters, and preserves the decoded path bytes in the
      resolved policy. It rejects duplicate decoded entries and any other list-item shape.
      `AGENTS.md` in this repository carries the heading and the marked-up entries D6 names, pinned
      by a test whose resolved values are `src/`, `tests/`, `docs/`, `skills/`,
      `agent-skill/skills/spbridge/SKILL.md`, `spartan/`, `AGENTS.md`, `package.json`, and
      `tsconfig.json` without backticks.
- [x] D6: a repository whose automation section lacks the sentence runs plan review unchanged and
      refuses an implementation review with `automatic_review_not_authorized`, detail
      `implementation_review_grant`, before any adapter is constructed.
- [x] D6: the grant's precondition is the artifact state D4 admits and nothing else. An artifact in
      that state whose body records no check outcomes at all is dispatched normally, asserted by a
      test, and no code path reads the body looking for one.
- [x] D7: an implementation review returning `pass` writes `next_role: human-operator` and terminates
      `review_passed` with the chain not continued; returning `changes_requested` writes
      `next_role: implementer`; the plan mapping `pass → implementer`,
      `changes_requested → planner` is unchanged.
- [x] D8: a reviewer answer whose `review_kind` is not the kind the run dispatched ends the run
      `result_schema_invalid`, asserted in both directions, each quoting the bytes the stub wrote.
- [x] D8: the Codex adapter advertises the dispatched kind before the reviewer answers. Over one plan
      artifact and one implementation artifact, a test reads the output-schema file passed to Codex
      and asserts `review_kind.const` is `"plan"` and `"implementation"` respectively, while every
      other schema member is deep-equal. The implementation case therefore cannot advertise
      `"plan"` and rely on the result validator to reject the only answer its own schema allowed.
- [x] D8: `status` and every record of `events.jsonl` carry the dispatched kind. Asserted over two
      artifacts rather than one, because D4 makes the kind a function of frontmatter and the two
      admitted states are mutually exclusive, so no single artifact can dispatch both: one carrying
      `(task_type: planning, phase: planning)` and one carrying `(task_type: implementation,
      phase: reviewing, current_role: implementer, next_role: reviewer)`, identical in every other
      byte, in a fixture repository whose `reviewer.plan` and `reviewer.implementation` rows name
      the same host, model, and effort. Across the two runs `review_kind` differs and reads `"plan"`
      and `"implementation"` respectively, `producer_identity` differs (`null` on the plan run and
      `{ role: "implementer", host }` matching the mapped implementer on the implementation run),
      and `schema_version`, `state`, `verdict`, `reason_code`, `host`, `client_context`, `model`,
      `effort`, and the ordered sequence of event names are equal. `run_id`, `execution_id`,
      `task_path`, `artifact_hashes`, and the timestamps are excluded from the comparison by name,
      since they cannot be equal across two runs of two files. Event records keep the same key set
      and do not carry `producer_identity`.
- [x] D8: `SCHEMA_VERSION` is `2` and `PROTOCOL_VERSION` is `"0.7.0"`, pinned by a test.
      `StatusDocument` serializes `producer_identity` immediately before `review_chain`;
      `EventDocument` is unchanged.
- [x] `npm run typecheck` and `npm test` exit 0.

## Work Completed

- Implementation reviewer (Codex, gpt-5.6-terra, effort high, OpenAI), 2026-08-21,
  `HX-029`: reviewed the complete D1-D8 implementation in a fresh technically read-only session,
  including the D7 producer-identity correction, reviewer-host separation, chain guards, plan
  compatibility, status serialization, and the decision to keep `SCHEMA_VERSION` at `2`. Returned
  `VERDICT: PASS` with no findings. The task is complete; no product file was written by the
  reviewer.

- Implementer (Cursor, cursor-grok-4.6-high-fast, effort none), 2026-08-21,
  `HX-028`: accepted the outstanding envelope after the fresh implementation reviewer returned
  `CHANGES_REQUESTED` with warning `D7_PRODUCER_HOST_UNTESTED`. The chain compared reviewer hosts
  and the D7 boundary test changed `reviewer.implementation` rather than the `implementer` binding.
  Parsed the mapped `implementer` row into a typed producer identity `{ role: "implementer", host }`,
  recorded it as `StatusDocument.producer_identity`, and compared it on implementation chains after
  reviewer-host and kind equality and before the agents-hash guard. Added a chained test that
  changes only the implementer host and refuses `not_authorized` before adapter construction; kept
  reviewer-host mismatch as a separate test. Re-derived D7's host-boundary criteria, D8's
  status/events and schema criteria, and D-033. Did not write the Bridge-owned review region. Did
  not commit.

- Implementer (Cursor, cursor-grok-4.6-high-fast, effort none), 2026-08-21,
  `HX-027`: accepted the outstanding envelope after the fresh implementation review returned
  `CHANGES_REQUESTED` with `D1_SCOPE_OMITS_SPBRIDGE_SKILL` and `D4_FRONTMATTER_ADMISSION_TOO_BROAD`.
  Added `agent-skill/skills/spbridge/SKILL.md` to the D6/AGENTS.md implementation-review allowlist
  and to every copy that must match it. Tightened `parseTaskFrontmatter` to the D4 review-admission
  4-tuple; post-write validation now uses `parseTaskFrontmatterDocument` for grammar only. Re-derived
  the D4 admission table (including `next_role: implementer`, `human-operator`, and `verifier`), the
  D4 post-write split criterion, the D6 resolved-scope list, and the D2 skill-path criteria. Did not
  write the Bridge-owned review region. Did not commit.

- Implementer (Cursor, cursor-grok-4.6-high-fast, effort none), 2026-08-21, `HX-026`: the pasted
  prompt named no handoff identifier, so this round adopted the artifact's outstanding `HX-026`
  envelope. Task `0034` is `status: completed` and its workspace library is in this worktree; the
  former 0034 blocker is closed. Implemented the approved D1–D8 scope: implementation workspaces
  are prepared as copies (`AGENTS.md`, `task.md`, `worktree/`, `diff.patch`, `changes.txt`) with
  one included set from the D6 allowlist; plan workspaces stay two files; Codex calls
  `prepareReviewWorkspace`. `REVIEW_KINDS` is `["plan", "implementation"]` under one lifecycle.
  Kind comes from frontmatter only (`--review-kind` is rejected). Dispatch admits
  `(task_type: implementation, phase: reviewing, current_role: implementer, next_role: reviewer)`;
  `parseTaskFrontmatter` also admits post-write `next_role: implementer` and `human-operator` so a
  D7 write is not rolled back, while `resolveReviewKind` still refuses those as `task_invalid`.
  Kind-scoped review markers; legacy unscoped markers remain the plan region and were not rewritten
  by this round. D6 grant sentence, prohibition, and `### Implementation review scope` are in
  `AGENTS.md`. Implementation `pass` maps to `next_role: human-operator`; `changes_requested` maps
  to `next_role: implementer`. Chains refuse kind/host mismatch and never spawn a producer. Result
  validation requires the dispatched kind. `/spbridge` now admits human-started implementer entry;
  the Bridge still does not start an implementer round. `PROTOCOL_VERSION` is `"0.7.0"`;
  `SCHEMA_VERSION` stays `2`. Did not write the Bridge-owned review region. Did not commit.

- Planner continuation (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-21, artifact proposal
  `HX-025`: started a fresh producer round after the prior chain stopped at cycle 3 of 3 and revised
  only `D1_DIR_MEMBER_TABLE` from Bridge run `run-3207afaa-95e1-4448-b413-ab226a9e0be1`. D1 now
  defines members and the `(H, I, W)` table solely over repository file entries; directories under
  `worktree/` are exactly the ancestor closure of extant regular members, carry no source bytes, and
  appear in no file-output record or manifest. Re-derived matching, classifier, enumeration,
  containment, entry-type, and D6 same-copy criteria, plus the full grant sentence. No product file,
  unrelated decision, or Bridge-owned review text was changed by the producer.

- Planner continuation (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-21, artifact proposal
  `HX-024`: revised only `D1_PREFIX_DIR_CONFLICT` from Bridge run
  `run-d14d5155-5ee6-4608-ae4f-e5be15fac276`, cycle 2 of 3. A scope entry now explicitly reaches
  the ancestor directories required to materialize it; a trailing-slash entry additionally reaches
  its named directory and all descendants. Those directories are members under the same classifier,
  not out-of-scope structural exceptions. Re-derived the exact-matching criterion with top-level,
  nested, ancestor, descendant, and near-neighbour cases. No product file, unrelated decision, or
  Bridge-owned review text was changed by the producer.

- Planner continuation (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-21, artifact proposal
  `HX-023`: revised only D1/D6 against `D1_PREFIX_MATCH_UNPINNED` and
  `D6_SCOPE_ENTRY_MARKUP` from Bridge run `run-220691d7-188d-4ff1-ab5f-8a0d9b7605f2`, cycle 1 of
  3. D1 now defines exact-file and trailing-slash descendant matching, including positive, nested,
  and near-neighbour cases. D1/D6 now agree that each list item is one inline-code span whose
  delimiters are stripped and whose inner path bytes are preserved. Re-derived the scope-matching
  and policy-parser criteria; no product file, unrelated decision, or Bridge-owned review text was
  changed by the producer.

- Planner correction (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-21, artifact proposal
  `HX-022`: accepted the outstanding handoff after the owner authorized end-to-end completion and
  reopened only the cross-task contract that subsequent task `0034` proved inconsistent. D1 now
  implements the repository policy literally: the declared implementation review scope is the sole
  content-blind admission allowlist, `.git` metadata is excluded, paths outside scope are excluded
  whatever they hold, and paths inside scope are included across tracked, staged, untracked, and
  ignored states. Removed ignore-source classification, the out-of-scope-change refusal, and every
  credential-looking name exception; re-derived every D1 and D6 criterion that touched those
  decisions. D6's proposed grant sentence now describes the same copy. No product file or
  Bridge-owned review text changed in this round.

- Planner continuation (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-21, artifact proposal
  `HX-021`: the Bridge continuation carried no newly pasted handoff identifier, so this round adopted
  the artifact's outstanding `HX-021` envelope. Revised only D6 against
  `D6_PROHIBITION_CLAUSE_DROPPED` from Bridge run
  `run-044eaf94-d3ad-4a80-bae7-8d87d59221ea`, cycle 1 of 3. The finding correctly identified that
  D6's “sentence stays” wording did not authorize the criterion's shorter exact sentence. D6 now
  explicitly replaces the old list item in full, gives the exact replacement, and explains why the
  amendment clause is intentionally removed; its already re-derived criterion now follows that
  decision. D1, D3, D8, task `0034`, previously resolved findings, product files, and the
  Bridge-owned review region were not changed. Relevant check outcomes are recorded in Evidence.

- Planner continuation (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-21, artifact proposal
  `HX-020`: accepted the matching handoff and revised only D6 against
  `D6_PROHIBITION_UNPINNED` from Bridge run `run-e4a2b6ed-b81e-49b3-8b4b-3e8a0c3fc22a`. Added a
  criterion that pins the exact complete prohibition “The Bridge may not start an implementer round
  automatically.” in `AGENTS.md` and makes the former ambiguous sentence fail the assertion. The new
  criterion takes the set from 61 to 62. D1, D3, D8, task `0034`, all previously resolved findings,
  product files, and the Bridge-owned review region were not changed. Relevant check outcomes are
  recorded in Evidence.

- Planner continuation (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-21, artifact proposal
  `HX-019`: the Bridge continuation carried no newly pasted handoff identifier, so this round
  adopted the artifact's outstanding `HX-019` envelope. Revised against the two warnings from run
  `run-7514df88-e382-4b7f-b633-0e75e7dea710`, cycle 2 of 3. `D1_REACH_UNPINNED` was right: clause 3
  now defines “would reach” as matching any complete component, and its re-derived criterion covers
  an exact directory, a nested prefix, a descendant, and a nested descendant while retaining the
  three accepted filename cases. `D8_SCHEMA_UNPINNED` was also right: added the Codex advertised
  schema to Scope and a D8 criterion that reads the schema file for both admitted states, requires
  the dispatched kind as `review_kind.const`, and holds every other schema member equal. The new D8
  criterion takes the set from 60 to 61. No product file, task `0034` decision, or Bridge-owned
  review text changed. `git diff --check`, `npm run typecheck`, and `npm test` exited 0; 204 tests
  passed.

- Planner continuation (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-21, artifact proposal
  `HX-018`: the Bridge continuation carried no newly pasted handoff identifier, so this round
  adopted the artifact's outstanding `HX-018` envelope. Revised against the two warnings from run
  `run-a8b16ff6-75af-47b6-8ab0-860a96f19a1e`, cycle 1 of 3. `D1_AUTH_FILENAME_SET_OPEN` was right:
  the undefined “well-known authentication filename” category is removed, the four credential-store
  directory names are explicitly the whole name rule, and the criterion now asserts both their
  refusal and ordinary admission of three filename examples so no hidden open set can pass.
  `D3_CAPABILITY_DENIED_GAP` was also right: D3 now separates legal-list validation from resolved-run
  membership, asserts both mismatch directions before preflight/prepare/start, and pins Codex and the
  fake to `["plan", "implementation"]` and Cursor to `["plan"]`. Re-derived the two affected D1/D3
  criteria and added two D3 criteria, taking the set from 58 to 60 without changing task `0034`'s
  assembly contract. No product file or Bridge-owned review text changed. `git diff --check`,
  `npm run typecheck`, and `npm test` exited 0; 204 tests passed.

- Planner pre-review audit (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-21, handoff
  `HX-017`: audited the current revision against each of the five findings in the Bridge-owned
  `## Review` region and found no correction still required. `CREDENTIAL_BOUNDARY_UNSAFE` is
  answered by the human-amended provenance policy and D1's declared-scope boundary;
  `SCOPE_DISPOSITIONS_OVERLAP` by the first-match order git metadata, withheld, undeclared, member;
  `OUT_OF_SCOPE_NAME_CONFLICT` by keeping the actionable path string in a run-level refusal before
  any reviewer workspace exists; `CYCLE_LIMIT_OFF_BY_ONE` by admitting cycles 1 through 3 and
  refusing the fourth chained attempt; and `INCOMPATIBLE_TERMINALS` by asserting three separate
  chain scenarios. Read the affected criteria back against D1, D6, and D7 as a set; they reproduce
  those decisions without reopening task `0034`'s assembly procedure. No decision, acceptance
  criterion, product file, or Bridge-owned review text changed in this round. `git diff --check`,
  `npm run typecheck`, and `npm test` exited 0; 204 tests passed.

- Planner pre-review audit (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-21, handoff
  `HX-016`: audited the current revision against all five findings in the Bridge-owned `## Review`
  region and found no remaining decision or criterion correction. `CREDENTIAL_BOUNDARY_UNSAFE` is
  answered by the human-amended provenance policy and the explicit-scope contract;
  `SCOPE_DISPOSITIONS_OVERLAP` by the first-match order git metadata, withheld, undeclared, member;
  `OUT_OF_SCOPE_NAME_CONFLICT` by keeping the diagnostic in the run record and terminal before any
  reviewer workspace exists; `CYCLE_LIMIT_OFF_BY_ONE` by admitting cycles 1 through 3 and refusing
  the fourth attempt; and `INCOMPATIBLE_TERMINALS` by using three separate chain scenarios. Corrected
  one stale Evidence sentence that claimed no round of this task had edited a product file, after
  the human policy amendment and authorized test-pin update made that statement false. No decision,
  acceptance criterion, product file, or Bridge-owned review text changed in this round.
  `git diff --check`, `npm run typecheck`, and `npm test` exited 0; 201 tests passed.

- Planner pre-review (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-21: verified the Cursor
  implementer diff against its narrow authorization: only the two live `reviewer.plan` host/model
  pins changed in `tests/agents.test.ts`, and the implementer evidence records the exact inputs and
  outcomes. Closed the now-satisfied host-binding blocker and refreshed the `HX-016` prompt to audit
  the already-revised plan against the recorded findings before the Bridge dispatches review.

- Implementer (Cursor, cursor-grok-4.6-high-fast, effort none), 2026-08-21: the pasted prompt carried no identifier; this round did not consume `HX-016`. Updated only the two live-policy pin assertions in `tests/agents.test.ts` so they match the human-changed `reviewer.plan` row (host `cursor`, model `cursor-grok-4.6-high-fast`, effort `high`). Did not modify `AGENTS.md`, generic fixtures, README examples, historical artifacts, or parser behavior. `git diff --check` exited 0. `npm run typecheck` exited 0. `npm test` exited 0, 201 passed, 0 failed.

- Planner follow-up (Codex, gpt-5.6-sol, effort high, OpenAI), 2026-08-21: audited the
  uncommitted `HX-015` revision after the planner host changed from Claude Code to Codex and a
  manual read-only Cursor `reviewer.plan` round returned `CHANGES_REQUESTED`. Corrected the stale
  disposition order in `## Next Action`, closed the human credential-policy question that `HX-015`
  already records as decided, advanced the consumed handoff to `HX-016`, and addressed its envelope
  to the live Codex planner binding. `npm run typecheck` exited 0. `npm test` ran 201 tests: 199
  passed and the two repository-policy pin assertions in `tests/agents.test.ts` failed because they
  still expect the former Codex `reviewer.plan` binding. A planner may not edit those tests, so the
  host-binding change is not ready to commit until an authorized implementer updates those two
  assertions and the full suite passes.

- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-21, handoff `HX-015`:
  answered Bridge run `run-db2c8ef1-…`, which returned `human_required` on `CREDENTIAL_POLICY_GATE`
  rather than `changes_requested`, and closed the question it escalated.

  The escalation was correct and not a defect in the plan: the reviewer refused to choose between
  three readings of one policy sentence and handed the choice back. It had also recurred in four
  cycles across three chains, because the reviewer is given `task.md` and `AGENTS.md` and nothing
  else (`src/adapters/codex.ts:105`), so neither the document enumerating the credential class nor
  the adapter that already copies repository files was ever in its input.

  The human decided the narrow reading and amended the policy rather than restate it here.
  `AGENTS.md:82` is now stated over provenance, and a new `AGENTS.md:83` states the disposition for
  repository files: contents are never read to classify a path, an explicit path allowlist is the
  only way in, and a secret under an admitted path is copied uninspected and is the repository's own
  exposure. D1's residual paragraph and two Evidence rows now record that, together with
  `src/adapters/codex.ts:253-262` — the shipped plan review is itself a fixed two-path allowlist over
  repository files, so the strict reading condemned the command that was reporting the finding.
  Amending before the next review also changes `agents_hash`, so the next reviewer reads the
  delimited sentence instead of raising this a fifth time.

  Clause 4's ordering was wrong and is corrected: **withheld** now precedes **undeclared**. The
  previous order reasoned that an unreached path has less said about it than an ignored one, which
  inverts the fact — an ignore rule *is* the statement, so it is consulted first. Ordered the other
  way, an ignored path no prefix reaches never reached the withheld branch, classified undeclared,
  and clause 6 refused the run on it, since a file present on disk carries `(✗, ✗, ✓)` and is
  therefore *changed*. Every entry in this repository's `.gitignore` qualifies — `.env.*`,
  `node_modules/`, `dist/`, `coverage/`, `*.log`, `.DS_Store`, and `.spartan-bridge/`, the Bridge's
  own run directory, written by the run being prepared. No implementation review could have started
  on any real checkout. Clause 6 is restated so the refusal fires on one population only: changed,
  reached by no prefix, named by no ignore rule.

  Criteria re-derived from those two clauses rather than patched: the nothing-changed-is-hidden
  criterion now names the population instead of the disposition, the ordered-precedence criterion
  carries the new order and its adjacent pairs, and a new criterion asserts that an ignored path
  outside the scope is withheld and not refused, named with `.env.local` and `build/` because that is
  the case the old order broke. 57 criteria to 58.

  Citations corrected: `AGENTS.md:101` to `:102` and the auth-document enumeration to `:7-16` and
  `:9-16`, both shifted or short by the amendment and by a dropped final bullet.
  `npm run typecheck` and `npm test` exit 0, 201 tests passing. No product file was edited.

- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-21, handoff `HX-014`:
  revised against the five findings of Bridge run `run-0a33518e-…`, cycle 2. Four were mechanical and
  correct, and the fifth is the recurring one.

  `SCOPE_DISPOSITIONS_OVERLAP` was right that "exactly one of four dispositions" is false of the
  predicates: a path under `.git` is also outside most scopes, and an ignored path may be outside one
  too. The clause is now an ordered decision procedure — git metadata, undeclared, withheld, member,
  first match winning — so it partitions because it terminates rather than because the predicates are
  disjoint. That round ordered it `.git`, undeclared, withheld, member, which the round after it
  corrected; the reasoning is recorded in clause 4 and in the `HX-015` entry below. The totality
  criterion split in two and the fixture now carries a path matching each adjacent pair at once.

  `OUT_OF_SCOPE_NAME_CONFLICT` caught D6's sentence claiming no out-of-scope path is "copied, named,
  or read" while clause 5 required naming one in a refusal. The grant now claims only what the
  reviewer is given, and the clause says where the name goes: the run record and the terminal, at a
  point where no workspace exists, as a path string and never a byte. A criterion asserts both halves.

  `CYCLE_LIMIT_OFF_BY_ONE` read `src/core/review.ts:857-867` against D7 and won. The guard compares
  `parent.cycle + 1` to the limit, so a limit of three admits three reviews and stops the fourth
  attempt; D7 said the third review ends the chain. Decision and criterion now name all four attempts.

  `INCOMPATIBLE_TERMINALS` was right that one chain cannot hold both a `pass` and a later
  `cycle_limit_reached`. The no-producer-spawn criterion is now three chains.

  `CREDENTIAL_BOUNDARY_UNSAFE` returned for the fourth time across three chains, now demanding a
  boundary whose compliance does not depend on declared paths being credential-free. That is
  unsatisfiable under the rest of the policy, and this round stopped reformulating and said so:
  certifying a path is not a credential means reading it, which the authentication boundary forbids,
  so the options are three — certify by reading, copy nothing, or admit only what the repository
  named. Two things changed rather than none. The declaration syntax now refuses credential-shaped
  entries, which is `docs/AUTHENTICATION-AND-SECURITY.md:83`'s registry rule applied to a declared
  string rather than to file contents. And the choice among the three is recorded in `## Blockers` as
  an open question for the human, framed as which reading of `AGENTS.md:82` governs, since the
  in-chain reviewer cannot see the document that enumerates the class.

  Criteria went 54 to 57. `npm run typecheck` and `npm test` both exited 0, 201 passing. No product
  file was edited.

- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20, handoff `HX-013`:
  revised against the two findings of Bridge run `run-d5a3e7ed-…`, cycle 1 of a new chain. Both were
  errors and both were right, and the first one condemned text `HX-012` had written that same day.

  `CREDENTIAL_BOUNDARY_UNSAFE` found that `HX-012` had answered a demand for a fail-closed boundary
  with a boundary that was still a denial, and had then derived criteria *requiring* a tracked
  `.npmrc`, `.netrc`, and `credentials.json` to be copied — turning the previous finding's examples
  of a leak into mandated ingestion. The structural point is what makes this the last shape change
  the clause needs: what a denial list admits is exactly what it failed to name, so its conceded
  incompleteness *is* the set of credentials it lets through, and no length repairs that. The
  precedent both previous rounds cited is an allowlist — `CODEX_ENV_ALLOWLIST` admits six variables
  and excludes everything else rather than denying `ANTHROPIC_API_KEY` by name — and this round took
  it literally. `AGENTS.md` now declares an implementation review scope of repository-relative path
  prefixes; a member is a path some prefix reaches, less in-tree ignore rules and less `.git`; and
  nothing else is copied. The `.env` exception is deleted rather than defended. Clause 5 keeps the
  scope from becoming a hiding place: a *changed* path no prefix reaches ends the run naming it,
  while an ignore rule still excludes silently, because one is the repository speaking about a path
  and the other is its silence. The limit is stated rather than hidden — an allowlist does not
  establish that a declared scope holds no credential, and neither does the environment allowlist
  this repository already ships.

  `CYCLE_BUDGET_CONTRADICTION` was right that D7's shared budget contradicted the prohibition beside
  it. A plan chain cannot reach an implementer producer without starting an implementer round, which
  the Bridge may not do, so the human starts it and a human-started run is the root of a chain.
  `resolveReviewChain` already works that way: a run without `--after-run` is cycle 1, and no count
  crosses an unlinked run. The criterion asking for a test that spends plan cycles and then finds the
  implementation chain refused was asking for a bug; it is replaced by one asserting the reset and
  one asserting the implementation chain's own limit inside a single session.

  Criteria went 48 to 54, re-derived from the changed clauses. `npm run typecheck` and `npm test`
  both exited 0, 201 passing. No product file was edited.

- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20, handoff `HX-012`:
  re-answered the two findings of Bridge run `run-9eb5a285-…` after the previous round's answer to
  the first one was wrong in a way that round did not see, and opened a new chain, the third having
  stopped at its limit.

  `D1_CREDENTIAL_BOUNDARY` asked for a complete fail-closed boundary, and `HX-011` returned a
  complete boundary that was not fail-closed. Its provenance framing was right and is kept: a name
  list never terminates, and closing the gap by inspecting bytes is what the authentication boundary
  forbids. What it got wrong was the disposition. Both precedents it cited are fail-closed —
  `docs/AUTHENTICATION-AND-SECURITY.md:83` *refuses the file* on a credential-shaped key, and
  `CODEX_ENV_ALLOWLIST` excludes by default — and `HX-011` borrowed the mechanism while inverting the
  disposition: never inspect a value, but admit every path no rule named, and book the difference as
  an accepted residual. Naming that inversion is what let the finding be answered without lengthening
  the list, which is the move it had already rejected.

  The repair is at two levels. The exclusion is unchanged in content — in-tree ignore rules, `.git`,
  the `.env` basename — and becomes **exact and total**: a decision procedure over every path with
  four dispositions and no unclassified remainder, which `0034` may neither narrow nor widen. That is
  what makes the finding's second half answerable, because "only the stated floor" and "the boundary"
  become one object and both directions can be asserted. And the exposure that remains is closed by
  declaration rather than by classification: D6's grant sentence now names the copy and names the
  exclusion verbatim, so a repository that has said nothing gets `automatic_review_not_authorized`
  before any adapter is constructed and therefore before any workspace is prepared. Refusal is the
  default for silence, which is the disposition the two precedents share.

  `IMPLEMENTATION_CYCLE_UNPINNED` was substantially answered by `HX-011`'s D7 loop, but its third
  clause — that no new implementer round is started — had no criterion, and the transition map alone
  cannot show it: a run that writes `next_role: implementer` looks identical whether or not something
  acts on it. D7 gained a fourth boundary stated as an observable over recorded spawns, and a
  criterion asserting it across a whole chain including the `pass` and the cycle-limit stop.

  Criteria went 44 to 48, re-derived from the changed clauses rather than patched. `npm run
  typecheck` and `npm test` both exited 0, 201 passing. No product file was edited.

- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20, handoff `HX-011`: answered
  the two findings of Bridge run `run-9eb5a285-…`, the third chain's limit.

  `D1_CREDENTIAL_BOUNDARY` was answered by changing what the clause is, not by lengthening it. A
  second opinion was taken from a Cursor session with the repository open, because the in-chain
  reviewer sees only this artifact and `AGENTS.md` and cannot judge a division of work between two
  tasks. It rejected the planner's first answer — pointing the contract at task `0034`'s future test
  suite — with a test the planner had not applied: if `0034` can ship the present floor, name it the
  confidentiality suite, and satisfy this task, then this task did not decide the boundary. It also
  corrected a category error, that "judging content" in D2 is about verdict quality while the
  authentication rule is about non-ingestion, and named the two places this repository already
  answers the same problem by provenance — the registry refusing credential-shaped keys rather than
  values, and the adapters copying an environment allowlist rather than inspecting variables.

  The clause is now provenance isolation with the residual stated as a decision: host stores are
  never collected and are not part of the copy contract; a member is a git-declared product path
  minus in-tree ignore rules and `.git`; and an eligible path is copied without its bytes being
  inspected, including a tracked `credentials.json`, which is the exposure a human code review of the
  committed tree already has. The `.env` denial stays and is labelled as the one Bridge-added
  exception that does not generalise, which is why `.npmrc` and its neighbours are not added beside
  it. The new criterion asserts the residual in the *positive* direction — the tracked
  `credentials.json` is present — because the failure the other criteria cannot catch is a module
  satisfying confidentiality by hiding product.

  `IMPLEMENTATION_CYCLE_UNPINNED` was answered in D7, which described one verdict transition where
  the Objective promises a loop. The loop is the chain the runtime already has, stated as applying
  rather than rebuilt, and the two new criteria assert the boundaries rather than the happy path: the
  producer and host do not change across cycles, and plan and implementation reviews draw on one
  `max_review_cycles` budget rather than one each.

  Criteria went 41 to 44. No product file was edited.

- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20, handoff `HX-010`:
  revised against the two findings of Bridge run `run-9840c9a6-…`, both errors and both correct.
  `D1_CONFIDENTIAL_ENUM` caught a defect the previous round introduced while fixing another: **W**
  was defined as working-tree presence *after* the confidentiality floor, which made a tracked
  `.env` read as `(✓, ✓, ✗)` — a row the table declares an included deletion, named in
  `changes.txt` and represented in `diff.patch`, while the confidentiality clause requires it to
  appear nowhere. Folding a filter into an observable made the table contradict the clause beside
  it. Eligibility is now a gate stated before the enumeration and outside it: an excluded path is
  removed from consideration rather than classified, the table speaks only of eligible paths, and
  the three facts are again plain presence in `HEAD`, the index, and the working tree. The
  confidentiality clause carries the ordering, and a new criterion pins it by giving the fixture's
  `.env` all three of `H`, `I`, and `W` and requiring it to be absent from every output anyway.

  `D8_SAME_ARTIFACT_KIND` was the same species of error in a criterion rather than a decision: it
  asked for a plan run and an implementation run "over the same artifact", which D4 makes
  impossible, since the kind is a function of frontmatter and the two admitted states are mutually
  exclusive. It is now two artifacts identical but for those frontmatter lines, bound to the same
  host, model, and effort, with the fields that must stay equal enumerated and the five that cannot
  be equal across two runs excluded by name. Forty-one criteria, up from forty. No product file was
  edited.

- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20, handoff `HX-009`:
  revised against the two findings of Bridge run `run-c8100c44-…`. `D1_INDEX_ADD_DELETE` was right,
  and running it down showed the defect was larger than the finding: a path staged and then deleted
  from the working tree is listed by `git ls-files --cached`, so it is a member, and it fits none of
  the five rows. The repair is not a sixth row. The table is now an enumeration over three
  observable facts — whether `HEAD`, the index, and the working tree each hold the path — which has
  eight combinations, seven of them members and one of them not a path at all. Exhaustiveness is now
  a property of how the table is built rather than a claim made beside it.

  Building it that way surfaced two states no row had covered and no finding had named. `git rm
  --cached` with the file kept on disk makes a member that `worktree/` holds and `diff.patch`
  renders as a deletion — the two outputs disagreeing by construction, now stated in its cell rather
  than left for a test to hit. And an ordinary `git rm` is reached by neither `git ls-files
  --cached` nor `git ls-files --others`, so an included set assembled from those two lists loses a
  staged deletion outright and the reviewer never learns a product file was removed. That is a
  widening of what the reviewer must be given, which is this decision's to state; the predicate that
  produces it stays `0034`'s.

  `EVIDENCE_INPUTS_MISSING` was correct against `AGENTS.md:102`: the previous round described its
  fixtures instead of reproducing them. The fixture is now a round deliverable at
  `spartan/probes/git-change-class-rendering.md`, holding the script and its verbatim output, named
  in `## Scope` and cited by every Evidence row drawn from it. It is what caught the two extra
  states, so the warning paid for itself. The agreement criteria were re-derived from the new table
  rather than patched: forty criteria, up from thirty-eight. No product file was edited.

- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20, handoff `HX-008`: opened
  a fresh chain after the previous one stopped at its cycle limit, and closed the two things the
  `HX-007` revision left behind. The first was a contradiction of exactly the kind the last three
  cycles kept finding: `## Next Action` still described D1's agreement clause as "a table of four
  member categories" after the table became five rows, so the section telling the reviewer what to
  judge disagreed with the decision it pointed at. The second was that `HX-007` asserted what git
  emits for a binary change, a mode-only change, and an index-added file without ever having run it;
  those three claims are now measured in throwaway fixtures and quoted in `## Evidence`, and all
  three hold as written.

  Measuring them surfaced one real hole in the answer to `D1_TRACKED_ADDITION`. That finding called
  the table the completeness claim, and adding a fifth row does not make it one — nothing said the
  rows were exhaustive or how they carve up the included set. They now do: the partition is whether
  the path is in `HEAD` crossed with what the working tree holds, which yields exactly these five and
  leaves the sixth combination outside the included set entirely. Stating it per path settled a case
  no row covered, because `git diff HEAD --name-status` renders a rename as one line naming two paths
  (`R100`), under which the old path is named as neither deleted nor anything else. The contract now
  requires a line for each path, as an observable of `changes.txt` rather than as a git flag, which
  stays `0034`'s. Thirty-eight criteria, up from thirty-seven. No product file was edited.

- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20, handoff `HX-007`: revised
  against the two findings of Bridge run `run-82bd3645-…`, the third cycle of a chain that stopped at
  its limit. Both were the same defect in the agreement table, pointing in two directions.
  `D1_DIFF_HUNK_COVERAGE`: the table required `diff.patch` to "carry a hunk", which git does not emit
  for a binary change or a mode-only one. The cell is now *represented*, defined as a `diff --git`
  entry naming the path plus whatever git emits for that change class, and the criterion asserts the
  entry and the path rather than the shape of the body. `D1_TRACKED_ADDITION`: a file added to the
  index but not yet committed was missing, and it is not the untracked row renamed — `git ls-files
  --cached` lists it, so it joins by the predicate's first branch, and `git diff HEAD` carries it
  where an untracked file it does not. The table is five rows, and both new categories gained
  criteria re-derived from it rather than a row patched in place.

  Two confidentiality clauses carried the same defect in the other direction, enumerating "a header
  line or a hunk of `diff.patch`" as the forms a forbidden file must not take. An enumeration of
  forms is exactly what the finding rejected, so both now read "anywhere in `diff.patch` in any form
  git emits". No product file was edited.

- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20, handoff `HX-006`:
  revised against the five findings of Bridge run `run-a7912cc1-…`, four of them on text the
  previous round had just written. `D1_SET_CONTRADICTION` was right that the agreement clause could
  not be an equality: an untracked addition is named in `changes.txt` and cannot appear in
  `diff.patch`, and an untouched file is in `worktree/` and in neither. The clause is now a table of
  four member categories with a containment rule running one way — nothing appears in an output that
  is not a member — and its criteria are asserted per category. `D1_SYMLINK_ESCAPE` found the
  contract constraining path names but never entry types, so a copied symlink could satisfy every
  confidentiality clause and still resolve outside the workspace; an entry-types clause was added
  and the regular-files-only rule is now pinned here as contract rather than living only in `0034`'s
  procedure. `D1_GIT_FIXTURE_INVALID` was a factual error: git will not hold an index entry under
  `.git`, so the fixture as written could not be built, and the floor is now two clauses — trackable
  content, tested with a tracked `.env` and a tracked ignored path, and git metadata, tested as
  absence. `D2_ARGUMENT_CONFLICT` was correct that the criterion had overreached past its own
  decision into forbidding any argv element from repository content, which `AGENTS.md` relies on for
  the model and effort; both D2 and the criterion now draw the line at a value the Bridge passes
  versus a command it would run. `DEPENDENCY_STATUS` was a real gap in handoff truth: `## Blockers`
  said none while the body said implementation could not begin, so the dependency on `0034` is now
  recorded with its verified status and with what it gates — the implementer round, not this review.
  Thirty-six criteria, up from thirty-three. No product file was edited.

- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20, handoff `HX-005`:
  revised against the four findings of Bridge run `run-9ab4aedf-…`. `D1_CONTRACT_UNDEFINED` was the
  one that mattered: the contract handed to `0034` was phrased over that module's own included set,
  so any set it computed would satisfy it. It is now four clauses stated over what a caller can
  observe of a prepared workspace — shape, internal agreement, confidentiality, completeness — plus
  the fail-closed clause, with the classification itself left to `0034` and a floor pinned here that
  it may widen and not narrow. Five criteria replaced the one circular criterion.
  `D2_DELEGATED_CRITERION` pointed at a criterion citing hostile-configuration cases that left with
  the assembly; it became three caller-level criteria — the argv enumeration this task owns, the
  refusal this task only surfaces, and the invocation rule. Both warnings were correct against
  `AGENTS.md:35-37`: `/spbridge` is now stated as the producer-facing invocation with the
  `spartan-bridge review` call named as internal to the skill, and the envelope is addressed to the
  producer. Thirty-three criteria, up from twenty-seven. No product file was edited.

- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20, handoff `HX-004`: split
  the assembly half of D1 into task `0034` after the chain stopped at its cycle limit with five open
  findings, all in that half. What stays is what the reviewer is given; what left is how the tree is
  built. D1 now pins a contract `0034` must satisfy — the five workspace entries, one included set
  governing every output, nothing declared non-product reaching the reviewer and nothing declared
  product hidden from it, and the fail-closed reason code — and D2's helper-command half is stated as
  a property that module must have rather than a procedure restated here. Eleven D1 criteria left with
  it; twenty-seven remain.

  Two of the planner's own claims were corrected by a second opinion taken from a Cursor session with
  the repository open, and both corrections are carried here. First, D2 through D8 were not approved
  by three cycles: cycle 3 never reached them, because D1 filled the window. That is saturation, not a
  verdict, so the remainder still needs one focused review with D1 out of the way. Second,
  `SNAPSHOT_EXCLUSION_MISMATCH` is a snapshot-policy problem rather than a copy-hardening one, and
  aligning the two predicates by starving the copy would hide an adopter's tracked file from its own
  reviewer; it goes to `0034` framed that way.

  This task can be reviewed now and cannot be implemented until `0034` ships: an implementation review
  dispatched against a stubbed preparation would show the loop closing without ever showing a reviewer
  a product file. No product file was edited.

- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20: created this task and
  recorded three blockers with their code anchors. Left D1 and D2 open on purpose. No product file
  was edited.
- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20: settled D1 and D2, added
  D4 through D8, and derived every acceptance criterion from a named decision. Found and recorded a
  fourth blocker the first round missed — `parseTaskFrontmatter` refuses an implementation task
  outright — and retired the draft's claim that the snapshot caps were sized for a two-file tree.
  Ran the repository checks. No product file was edited.
- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20: revised against the six
  findings of Bridge run `run-66972327-…`. D1 gained the exclusion predicate and its four consumers,
  the pathspec-restricted diff, and the regular-files-only rule, and lost the unsound "strict subset"
  claim; D4 gained the two role fields on the implementation path only; D6's grant sentence was
  rewritten against the artifact state instead of an unverifiable act; D2 was made to say that the
  Bridge never reads the body for a check outcome; D8 chose `0.7.0`. No product file was edited.
- Planner (Claude Code, claude-opus-5, effort high, Anthropic), 2026-08-20: revised against the six
  findings of Bridge run `run-8a600fd4-…`. D1 gained the logical and extant projections of the one
  included set, the git helper-execution measures — flags for what a flag reaches, a refusal for what
  it does not — the `--no-optional-locks` guarantee that no `git` call writes `.git/index`, and
  `--no-renames` in place of an undefined rename policy; D2's claim was restated over commands rather
  than executable names; D5's invariant was narrowed to an enumerated list of what a write may change
  and its human-text comparison made positional. `## Decisions` was moved above
  `## Acceptance Criteria`, overriding the task template's order, because `AGENTS.md` requires a
  plan's decisions first and its criteria last. The `## Next Handoff` advisory was corrected: the
  prompt block is the manual fallback the portable protocol requires, not what the Bridge sends its
  reviewer, and it no longer reads as an instruction to a read-only dispatched session. No product
  file was edited.

## Evidence

- Implementation review `HX-029`, 2026-08-21: fresh Codex `gpt-5.6-terra` read-only review returned
  `VERDICT: PASS` after checking D1-D8 and the final D7 producer-host correction. Its focused
  read-only diagnostics ran `npm run typecheck` and 11 serialization/CLI tests successfully.
- Final producer checks before `HX-029`, 2026-08-21: `git diff --check` exited 0;
  `npm run typecheck` exited 0; `npm test` exited 0 with 262 tests passed and 0 failed.
- Implementer `HX-028` checks, 2026-08-21: `git diff --check` exited 0; `npm run typecheck` exited
  0; `npm test` exited 0 with 262 tests passed and 0 failed.
- Implementer `HX-027` checks, 2026-08-21: `git diff --check` exited 0; `npm run typecheck` exited
  0; `npm test` exited 0 with 260 tests passed and 0 failed.
- Implementer `HX-026` checks, 2026-08-21: `git diff --check` exited 0; `npm run typecheck` exited
  0; `npm test` exited 0 with 259 tests passed and 0 failed.
- Task `0034` status, read 2026-08-21 from
  `spartan/tasks/0034-assemble-a-review-workspace-that-hides-nothing-and-leaks-nothing.md`:
  `status: completed`, `phase: complete`, `next_role: none`. The workspace library is present in
  this worktree as `src/core/workspace.ts`.

- Bridge run `run-3207afaa-95e1-4448-b413-ab226a9e0be1`, cycle 3 of 3, 2026-08-21: Cursor
  `cursor-grok-4.6-high-fast` at effort high returned `changes_requested` with the single finding
  `D1_DIR_MEMBER_TABLE`. The chain stopped at its limit. The current revision starts a new unchained
  review proposal and answers the finding across every criterion it named.
- `HX-025` producer checks, 2026-08-21: `git diff --check` exited 0; the artifact carries 58
  decision-derived criteria; `npm run typecheck` exited 0; and `npm test` exited 0 with 204 tests
  passed and 0 failed.

- Bridge run `run-d14d5155-5ee6-4608-ae4f-e5be15fac276`, cycle 2 of 3, 2026-08-21: Cursor
  `cursor-grok-4.6-high-fast` at effort high returned `changes_requested` with the single finding
  `D1_PREFIX_DIR_CONFLICT`. D1 and its matching criterion now place every materialized directory in
  the same positive member set as the entry that requires it.
- `HX-024` producer checks, 2026-08-21: `git diff --check` exited 0; the artifact carries 58
  decision-derived criteria; `npm run typecheck` exited 0; and `npm test` exited 0 with 204 tests
  passed and 0 failed.

- Bridge run `run-220691d7-188d-4ff1-ab5f-8a0d9b7605f2`, cycle 1 of 3, 2026-08-21: Cursor
  `cursor-grok-4.6-high-fast` at effort high returned `changes_requested` with findings
  `D1_PREFIX_MATCH_UNPINNED` and `D6_SCOPE_ENTRY_MARKUP`. The current D1/D6 text and their
  re-derived criteria address both and keep `next_role: reviewer` for the chained review.
- `HX-023` producer checks, 2026-08-21: `git diff --check` exited 0; the artifact carries 58
  decision-derived criteria; `npm run typecheck` exited 0; and `npm test` exited 0 with 204 tests
  passed and 0 failed.

- Cross-task audit, 2026-08-21: `AGENTS.md` states that an explicit path allowlist is the only
  repository-file admission authority, that a path no entry admits is excluded whatever it holds,
  and that admitted bytes are copied without inspection. The pre-correction D1 additionally read
  in-tree ignore rules, refused changed undeclared paths, and rejected four credential-store
  directory names; task `0034` independently chose tracked-only admission. Those three definitions
  could not be implemented together. The revised D1/D6 contract removes both metadata classifiers
  and leaves one scope-based boundary shared by the tasks.
- `HX-022` producer checks, 2026-08-21: `git diff --check` exited 0; the revised artifact carries 57
  decision-derived criteria; `npm run typecheck` exited 0; and `npm test` exited 0 with 204 tests
  passed and 0 failed.

- Planner `HX-021`, 2026-08-21: `D6_PROHIBITION_CLAUSE_DROPPED` was checked against the revised D6
  decision and its prohibition criterion. Both now specify the same exact complete replacement and
  intentional removal of the old amendment clause. `git diff --check` exited 0; `npm run typecheck`
  exited 0; `npm test` exited 0 with 204 passed and 0 failed.
- Planner `HX-020`, 2026-08-21: `D6_PROHIBITION_UNPINNED` was checked against D6 and the complete
  current prohibition in `AGENTS.md`. The new criterion pins exactly one list item with the exact
  rewritten complete text and expressly rejects the old complete text. `git diff --check` exited 0;
  `npm run typecheck` exited 0; `npm test` exited 0 with 204 passed and 0 failed.
- Bridge run `run-7514df88-e382-4b7f-b633-0e75e7dea710`, cycle 2 of 3, 2026-08-21: Cursor
  `cursor-grok-4.6-high-fast` at effort high returned `changes_requested` in 3m25s with warnings
  `D1_REACH_UNPINNED` and `D8_SCHEMA_UNPINNED`. Both are addressed in D1 clause 3, Scope, D8, and
  their re-derived criteria. After the revision, `git diff --check` exited 0;
  `npm run typecheck` exited 0; `npm test` exited 0 with 204 passed and 0 failed.
- Bridge run `run-a8b16ff6-75af-47b6-8ab0-860a96f19a1e`, cycle 1 of 3, 2026-08-21: Cursor
  `cursor-grok-4.6-high-fast` at effort high returned `changes_requested` in 4m20s with warnings
  `D3_CAPABILITY_DENIED_GAP` and `D1_AUTH_FILENAME_SET_OPEN`. Both are addressed in D3 and D1 clause
  3 respectively, with their criteria re-derived. After the revision, `git diff --check` exited 0;
  `npm run typecheck` exited 0; `npm test` exited 0 with 204 passed and 0 failed.
- Planner `HX-017`, 2026-08-21: the five Bridge findings were checked against D1, D6, D7, and the
  criteria derived from them. No unresolved contradiction or missing acceptance case remained;
  task `0034`'s assembly procedure was not re-opened. `git diff --check` exited 0;
  `npm run typecheck` exited 0; `npm test` exited 0 with 204 passed and 0 failed.
- Implementer 2026-08-21: `tests/agents.test.ts` now expects resolved `reviewer.plan` `host: "cursor"` and `model: "cursor-grok-4.6-high-fast"` in `repository AGENTS.md declares a model and effort for every binding` and in the repository-policy object of `declaration paragraph copies are identical and parse-invariant`; effort remains `"high"`.
- `git diff --check` → exit 0.
- `npm run typecheck` → exit 0.
- `npm test` → exit 0; 201 tests, 201 passed, 0 failed.

- `src/core/contracts.ts:3`: `export const REVIEW_KIND = "plan" as const;`, spelled as
  `review_kind: typeof REVIEW_KIND` at lines 174, 185, 193, 220, and 259.
  `src/core/contracts.ts:8`: `export const PROTOCOL_VERSION = "0.6.1" as const;`.
- `src/adapters/adapter.ts:86`: `capabilities.review_kinds.includes(REVIEW_KIND) &&`.
- `src/policy/agents-policy.ts:209` and `:215`: `planRow = { host, context, model, effort };` guarded
  by `if (binding === "reviewer.plan")`, with `reviewer_plan_row_missing` when no such row exists.
- `src/policy/task-frontmatter.ts:144`:
  `if (fm.phase !== "planning" || fm.task_type !== "planning") {`, throwing `task_invalid`. The same
  parser constrains `current_role` and `next_role` only to membership in `ROLES` (`:150`).
- `git show 875e843:spartan/tasks/0028-refuse-to-review-from-a-stale-build.md`, frontmatter at the
  moment that task was handed to implementation review: `status: active`, `phase: reviewing`,
  `task_type: implementation`, `current_role: implementer`, `next_role: reviewer`. The same file at
  `c40fdef`, awaiting plan review: `phase: planning`, `task_type: planning`,
  `current_role: planner`, `next_role: reviewer`.
- `src/adapters/codex.ts:261-262`: the workspace receives exactly `AGENTS.md` and `task.md`.
  `src/adapters/cursor.ts:309-321` prepares the same two files the same way, which is the duplication
  D1's shared module removes.
- `src/adapters/codex.ts:107`: "Review only the workspace files task.md and AGENTS.md. No other file
  is available for this review."
- `src/adapters/codex.ts:57` and `:169-181`: `CODEX_ENV_ALLOWLIST` is
  `["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM"]` and `childEnvironment` copies only those, so
  no `GIT_*` variable reaches a child today.
- `src/core/snapshot.ts:6-8`: `SNAPSHOT_ENTRY_CAP = 20_000`,
  `SNAPSHOT_HASH_BYTE_CAP = 256 * 1024 * 1024`, `SNAPSHOT_HASH_FILE_CAP = 1024 * 1024`.
  `src/core/snapshot.ts:9`: `SKIPPED_DIR_NAMES = new Set([".git", "node_modules", ".spartan-bridge"])`.
- `src/core/review.ts:344`: `baseline = await snapshotTree(repoRoot, deps.snapshotCaps);` and `:435`
  the matching post-review call, terminating at `:451` with
  `{ comparison: "repository_worktree", entries }`. The repository walk already runs twice per run.
- Measured 2026-08-20 in this checkout:
  `find . -path ./.git -prune -o -path ./node_modules -prune -o -path ./.spartan-bridge -prune -o -print | wc -l`
  → `235`; `git ls-files --cached --others --exclude-standard | wc -l` → `112`, totalling
  `1540715` bytes; `git ls-files -s | awk '$1=="120000"' | wc -l` → `0`.
- `.gitignore`, in full: `.DS_Store`, `.idea/`, `.env`, `.env.*`, `!.env.example`, `node_modules/`,
  `coverage/`, `dist/`, `*.log`, `.spartan-bridge/`, `.idea`, `.claude/settings.local.json`. Nothing
  tracked in this checkout matches those rules today, which is why D1's step 3 is a rule for adopters
  and for the future rather than a fix for an observed leak here.
- `src/core/task-write.ts:8-10`: `REVIEW_BEGIN = "<!-- spartan-bridge:review:begin -->"`,
  `REVIEW_END = "<!-- spartan-bridge:review:end -->"`, `REGION_BYTE_CAP = 16 * 1024`. `:237`
  `if (markers.unbalanced || markers.count > 1) {` refuses a second region, `:414`
  `if (afterScan.markers.count !== 1 || afterScan.markers.unbalanced) {` refuses to accept a written
  file carrying one, and `:33` `TASK_WRITE_FRONTMATTER_KEYS = ["next_role", "updated_at"]` is the
  existing frontmatter allowlist D5 enumerates alongside the region.
- `src/policy/agents-policy.ts:62`:
  `const GRANT = "A human-started Spartan Bridge run may start the mapped reviewer automatically.";`,
  with `TASK_ARTIFACT_WRITE_GRANT` and `PRODUCER_CHAIN_GRANT` matched the same way at `:63-66`.
- `src/core/result.ts:28`: `if (value.review_kind !== REVIEW_KIND) {`.
- `src/policy/registry.ts:133-147`: `resolveLauncherId(registry, clientContext, host)` keys on client
  context and host only, so one launcher id serves both kinds and the registry needs no change.
- `docs/ROUTING-AND-WORKFLOWS.md:247`: "The Bridge may start `reviewer.implementation` automatically
  after required checks pass."
- `AGENTS.md`, automation authority: "A human-started Spartan Bridge run may start the mapped
  reviewer automatically." and "The Bridge may not start implementation automatically unless this
  file is amended with a separate explicit grant for that transition."
- `AGENTS.md`, project boundary: "Repository content may select this alias but may not define
  launcher commands, authentication paths, credential variables, tokens, cookies, or API keys." —
  the sentence D2 reasons from.
- `AGENTS.md`, handoff authoring: "The prompt block stays host-neutral and executable without the
  Bridge, so a handoff remains usable when the runtime is absent." — why the envelope's prompt block
  keeps the manual reviewer's instruction while the advisory now says it is a fallback.
- Task `0032`, probe run B: two write attempts refused by the operating system,
  `zsh:1: operation not permitted: probe-write.txt` and `zsh:1: operation not permitted: AGENTS.md`.
- Task `0032` frontmatter as closed: `current_role: reviewer`, `next_role: human-operator` — the
  convention D7 follows.
- Planner checks, 2026-08-20: `npm run typecheck` exited 0; `npm test` exited 0, 201 passing tests.
  Re-run after every revision through `HX-012`: both exited 0 each time, 201 passing. Those planner
  rounds did not edit product files; later the human amended `AGENTS.md` and an authorized
  implementer updated the two live-policy pins in `tests/agents.test.ts`, with their outcomes
  recorded at the top of this section.
- Bridge run `run-66972327-bd96-475a-a543-3969ee253e9b`, cycle 1 of 3, 2026-08-20: Codex
  `gpt-5.6-sol` at effort high returned `changes_requested` in 2m24s with six findings —
  `D1_EXCLUSION_GAP`, `REVIEW_ADMISSION_STATE`, `GRANT_CONDITION_UNENFORCED` as errors and
  `D1_ACCEPTANCE_COVERAGE`, `WORKSPACE_FILE_TYPES`, `PROTOCOL_VERSION_UNDERIVED` as warnings. All six
  are addressed above.
- Bridge run `run-a7912cc1-b54e-4275-be2e-e2f368ed2592`, cycle 2 of 3, 2026-08-20: the same host and
  model returned `changes_requested` in 2m37s with five findings — `D1_SET_CONTRADICTION`,
  `D1_SYMLINK_ESCAPE`, `D1_GIT_FIXTURE_INVALID`, `D2_ARGUMENT_CONFLICT` as errors and
  `DEPENDENCY_STATUS` as a warning. Their text is recorded verbatim in `## Review` and all five are
  addressed above.
- `spartan/tasks/0034-assemble-a-review-workspace-that-hides-nothing-and-leaks-nothing.md`
  frontmatter, read 2026-08-20: `status: active`, `phase: planning`, `task_type: planning`,
  `next_role: planner`. Its `## Acceptance Criteria` opens "Draft." The dependency `## Blockers`
  records is open on that evidence, not inferred.
- Bridge run `run-9ab4aedf-fabe-4069-9f83-ca0c2e43a440`, cycle 1 of 3 of a new chain, 2026-08-20:
  Codex `gpt-5.6-sol` at effort high returned `changes_requested` in 1m18s with four findings —
  `D1_CONTRACT_UNDEFINED` and `D2_DELEGATED_CRITERION` as errors, `PRODUCER_INVOCATION_MISMATCH` and
  `HANDOFF_ROLE_MISMATCH` as warnings. Their text is recorded verbatim in `## Review` and all four
  are addressed above.
- `AGENTS.md:35-37`, in full: "This repository runs the Spartan Bridge. A producer round whose
  review the Bridge dispatches is entered through `/spbridge`, and the handoff that precedes it is
  addressed to that producer rather than to the reviewer." — the sentence both warnings cite.
- `src/core/task-write.ts:115-126`: `planReviewTransitionPrecondition` returns
  `transition_next_role_not_reviewer` unless `currentNextRole === "reviewer"`, which is why the
  frontmatter reads `reviewer` while the envelope is addressed to the producer.
- Bridge run `run-8a600fd4-80b1-42a7-9360-58ec8ad4de3f`, cycle 2 of 3, 2026-08-20: the same host and
  model returned `changes_requested` in 2m16s with six further findings — `DELETED_PATH_COPY`,
  `GIT_HELPER_EXECUTION`, `REGION_BYTE_CONFLICT`, `HANDOFF_PERMISSIONS` as errors and
  `RENAME_DIFF_HUNK`, `CRITERIA_ORDER` as warnings. Their text is recorded verbatim in `## Review`
  and all six are addressed above.
- Bridge run `run-82bd3645-56d7-4366-a207-8920f11bdff7`, cycle 3 of 3, 2026-08-20: Codex
  `gpt-5.6-sol` at effort high returned `changes_requested` with two findings —
  `D1_DIFF_HUNK_COVERAGE` and `D1_TRACKED_ADDITION`, both errors. The chain stopped at its cycle
  limit, which is why this round starts a new one. Their text is recorded verbatim in `## Review`
  and both are addressed above.
- `spartan/probes/git-change-class-rendering.md`, produced 2026-08-20: the fixture script that
  builds one repository holding a path in each of the seven `(H, I, W)` combinations, and the
  verbatim output of `git status --porcelain`, `git ls-files --cached`,
  `git ls-files --others --exclude-standard`, `git diff HEAD --name-status`, the same
  `--no-renames`, and `git diff HEAD --no-renames`. Re-runnable as `sh <script> <throwaway-dir>`;
  measured with `git version 2.50.1 (Apple Git-155)`. Every cell of D1's agreement table is read off
  that output, and the three claims below are the ones that changed the table.
- From that probe, `staged-then-removed.txt` — staged, then deleted from the working tree — is
  listed by `git ls-files --cached` and appears in `git diff HEAD` not at all, in any form. A member
  `diff.patch` cannot represent, which is the state finding `D1_INDEX_ADD_DELETE` named.
- From that probe, `uncached.txt` — `git rm --cached` with the file kept on disk — is listed by
  `git ls-files --others --exclude-standard`, and `git diff HEAD` renders it as
  `diff --git a/uncached.txt b/uncached.txt`, `deleted file mode 100644`, `-c`, while the file is
  present in the working tree. `worktree/` and `diff.patch` disagree about it by construction.
- From that probe, `git-rm.txt` — an ordinary `git rm` — is listed by neither
  `git ls-files --cached` nor `git ls-files --others --exclude-standard`, while
  `git diff HEAD --name-status` prints `D	git-rm.txt`. An included set assembled from those two
  lists alone loses a staged deletion outright.
- From that probe, `binary.bin` emits `diff --git a/binary.bin b/binary.bin`,
  `index 742c16a..b3351dc 100644`, `Binary files a/binary.bin and b/binary.bin differ`, and
  `mode.sh` emits `diff --git a/mode.sh b/mode.sh`, `old mode 100644`, `new mode 100755` — neither
  with an `@@` hunk, which is what D1's *represented* is written for. `index-added.txt` is carried
  by `git diff HEAD` as `new file mode 100644` with a `+new` hunk where `untracked.txt` is carried
  not at all, and `git mv` prints the single tab-separated line `R100	renamed-from.txt	renamed-to.txt`
  under the default rendering against `D	renamed-from.txt` and `A	renamed-to.txt` under
  `--no-renames`.
- Bridge run `run-c8100c44-c706-4f5f-809d-104e4e79a55d`, cycle 1 of 3 of a new chain, 2026-08-20:
  Codex `gpt-5.6-sol` at effort high returned `changes_requested` in 1m30s with two findings —
  `D1_INDEX_ADD_DELETE` as an error and `EVIDENCE_INPUTS_MISSING` as a warning. Their text is
  recorded verbatim in `## Review` and both are addressed above.
- Bridge run `run-9840c9a6-c849-4c65-978f-da252be407b4`, cycle 2 of 3, 2026-08-20: the same host and
  model returned `changes_requested` in 1m39s with two further findings — `D1_CONFIDENTIAL_ENUM`
  and `D8_SAME_ARTIFACT_KIND`, both errors. Their text is recorded verbatim in `## Review` and both
  are addressed above.
- Bridge run `run-9eb5a285-948e-4eca-af3a-f4f33b62ca00`, cycle 3 of 3, 2026-08-20: the same host and
  model returned `changes_requested` with two findings — `D1_CREDENTIAL_BOUNDARY` as an error and
  `IMPLEMENTATION_CYCLE_UNPINNED` as a warning. The chain stopped at its cycle limit, which is why
  the round after it revised outside a chain and this one opens a new chain. Their text is recorded
  verbatim in `## Review` and both are addressed above.
- `AGENTS.md:82`, in full after the 2026-08-21 amendment: "Tokens, cookies, provider authentication
  files, API keys, Keychain data, browser sessions, account identifiers, and credential environment
  variables must never enter Bridge inputs, arguments, configuration, runtime state, fixtures, or
  logs. This prohibition is over provenance: the Bridge never acquires that class from a credential
  store, an environment variable, a command-line argument, a configuration value, or an official
  client's private authentication state. `docs/AUTHENTICATION-AND-SECURITY.md` enumerates it."
- `AGENTS.md:83`, in full, added by the same amendment: "The Bridge never reads the contents of a
  repository file in order to classify it, because that reading is itself the ingestion this section
  forbids. A repository file enters a Bridge input only when an explicit allowlist of paths admits
  it, and a path no entry admits is excluded whatever it holds. What a repository keeps under an
  admitted path — including a secret it committed or left in its working tree — is copied without
  inspection, and is that repository's exposure exactly as it is under human code review." — the
  sentence D1's confidentiality clause is answerable to, and the one that closes the question four
  review cycles reopened.
- `src/adapters/codex.ts:253-262`: `await fs.mkdtemp(path.join(os.tmpdir(), "spartan-bridge-review-"))`,
  then `await fs.writeFile(path.join(workspace, "AGENTS.md"), agentsBytes, ...)` and the same for
  `task.md`. The shipped plan review copies two repository files into a Bridge input and inspects
  neither. It is a fixed two-path allowlist, and it is the fact that decided which reading of
  `AGENTS.md:82` this repository holds: the strict one condemns the review command that was
  reporting the finding.
- `src/core/review.ts:810-820` and `:857-876`: `resolveReviewChain` returns `cycle: 1` when
  `afterRun === undefined`, and otherwise `parent.cycle + 1` read from the referenced run's
  `status.json`, stopping `cycle_limit_reached` when that exceeds `max_cycles`. No count crosses a
  run started without `--after-run`, which is the runtime fact D7's budget ownership is stated
  against.
- `docs/AUTHENTICATION-AND-SECURITY.md:7-16`, the enumeration of the class `AGENTS.md:82` names:
  the sentence introduces data that must never be "accepted, received, read, copied, selected,
  stored, logged, proxied, or persisted by the Bridge", and the list under it is "API keys or bearer
  tokens", "cookies or browser session values", "Keychain or other operating-system credential
  records", "account identifiers obtained from provider credential stores", and credential variables such as
  `CURSOR_API_KEY`, and login URLs or callbacks the Bridge controls. Every member names a
  provider-authentication artifact held in a host store. That this is the whole of the class was the
  question four cycles reopened, and it is the document the in-chain reviewer, given only this
  artifact and `AGENTS.md`, cannot read — which is why the amendment states the disposition in
  `AGENTS.md` itself rather than leaving it here.
- Bridge run `run-0a33518e-c837-406d-a570-f06163b9c83e`, cycle 2 of 3, 2026-08-21: the same host and
  model returned `changes_requested` in 2m2s with five findings — `CREDENTIAL_BOUNDARY_UNSAFE`,
  `SCOPE_DISPOSITIONS_OVERLAP`, `OUT_OF_SCOPE_NAME_CONFLICT`, `CYCLE_LIMIT_OFF_BY_ONE`, and
  `INCOMPATIBLE_TERMINALS`, all errors. Their text is recorded verbatim in `## Review` and all five
  are addressed above.
- Bridge run `run-d5a3e7ed-0f63-4085-9635-3bd6cff32b16`, cycle 1 of 3 of a new chain, 2026-08-20:
  Codex `gpt-5.6-sol` at effort high returned `changes_requested` in 2m19s with two findings —
  `CREDENTIAL_BOUNDARY_UNSAFE` and `CYCLE_BUDGET_CONTRADICTION`, both errors. Their text is recorded
  verbatim in `## Review` and both are addressed above.
- `docs/AUTHENTICATION-AND-SECURITY.md:83`: "Unknown keys, duplicate YAML keys, missing hosts, and
  credential-shaped field names (`api_key`, `token`, `auth_file`, and similar) fail closed." — the
  precedent D1 borrows. What it establishes is not only that the rule reads a *key* rather than a
  value, but that its disposition on an unvouched key is refusal, which is the half the clause it
  replaced had dropped. `src/adapters/codex.ts:57`'s `CODEX_ENV_ALLOWLIST`, recorded above, is the
  same disposition in its other form: excluded by default, admitted only by name.
- Planner audit, 2026-08-21, handoff `HX-016`: the five current findings were checked against D1,
  D6, D7, and their derived criteria as a set; all five have an explicit decision answer and an
  executable criterion, with no incompatible terminal states left in one chain. `git diff --check`,
  `npm run typecheck`, and `npm test` each exited 0; the test run reported 201 passed and 0 failed.

## Review

<!-- spartan-bridge:review:begin -->
Verdict: APPROVED

Findings:

- None recorded.

Bridge run: run_id=run-68070d85-3150-4ac8-9157-b0688af1e040 execution_id=exec-51b8bb7f-6b9a-4a66-83c8-7c099c162d7a review_kind=plan verdict=pass reason_code=review_passed host=cursor launcher=cursor-plan-reviewer-v1 model=cursor-grok-4.6-high-fast effort=high model_observed=declared_unobserved policy_digest=sha256:8c6d3a4883d80ad20ae76298efa931aa0b90536f6e3ec15c401631a0d90e5288 task_hash=sha256:1a7b11957ca3ed6b82cd9c69582fe5dff7abb7d14419a484c34cd19fcc68292b agents_hash=sha256:b9f1f8227a3dde75b4b97c959d02d314ad4b590697340acb8b1c138d120998d3 timestamp=2026-08-21T14:53:35.855Z
<!-- spartan-bridge:review:end -->

### Implementation review

Verdict: APPROVED

Findings:

- None recorded.

Reviewer: Codex `gpt-5.6-terra`, effort high, fresh read-only session, handoff `HX-029`, 2026-08-21.

## Blockers

None. Task `0034` completed on 2026-08-21; its workspace library is present. The credential-policy
question and the host-binding consistency change remain closed as previously recorded.

## Next Action

None. The approved D1-D8 implementation is complete and ready to commit and integrate.

## Next Handoff

```text
No outstanding handoff. Task `0033` is complete after implementation review `HX-029` passed.
```
