---
name: spbridge
description: >-
  Run a Spartan producer round from a pasted handoff, then invoke the installed
  spartan-bridge runtime with that handoff's explicit task path, and continue
  inside this session while the runtime's status document says the review loop
  may continue. Use when the user invokes /spbridge or $spbridge, or pastes a
  Spartan handoff to be followed by the installed Bridge review. That includes
  a planner round and an implementer round whose review the Bridge dispatches.
  Do not use for an ordinary /spartan round that should stay manual.
---

# Spartan Bridge

Thin adapter. This skill does not implement the workflow. It does not
resolve policy from `AGENTS.md`, choose a host or model for the review, hold
state, or enforce permissions. It tells the current host how to run a Spartan
producer round and then how to invoke the installed runtime.

The runtime, not this skill, decides whether a review proceeds and whether a
chain may continue. This skill holds no counter of its own: the numbers it
compares both come from the status document it just read. Report what comes
back from each invocation.

A round is entered through this skill only when all three hold: the
repository declares the Bridge, the runtime is installed on the machine
running the round, and `spartan-bridge doctor` reports a working adapter for
the reviewer that round will dispatch. Do not infer adapter support from a
host name. A planner round and an implementer round whose review the Bridge
dispatches are both entered through this skill. The implementer round may
be human-started, or the runtime may start the mapped implementer after a
persisted plan-review pass when repository policy and operational config
both authorize that foreground successor. This skill never spawns Cursor,
never selects a producer host or model, and never synthesizes policy. After
the implementer writes `task_type: implementation`, `phase: reviewing`,
`current_role: implementer`, and `next_role: reviewer`, the runtime may start `reviewer.implementation`.

## Hard boundary

- Do not write to any task artifact. `/spartan` writes the producer round. The
  runtime may write the review region. This skill writes neither.
- Do not search for a task. Use only the explicit path in the pasted handoff.
- Do not inspect task frontmatter, `AGENTS.md`, or a binding table to decide
  whether to invoke. The exceptions before a verdict are the single
  `spartan-bridge doctor` binding line step 2 reads for the dispatched review
  kind, and the one JSON object from `spartan-bridge policy` when the paste
  role is planner or implementer. After a recorded verdict, those files may be read to
  name the round that follows: the artifact's `next_role` and the host
  `AGENTS.md` binds to that recorded role. When that role is planner or
  implementer, also run `spartan-bridge doctor --repo <workspace-root>`
  and read only the matching binding line for `reviewer.plan` or
  `reviewer.implementation`. Do not reconstruct the registry join, inspect
  capability flags, or infer a launcher from the host name.
- Do not keep or consult a list of admissible task states, roles, or bindings.
- Do not invoke, supervise, or spawn another model, agent, or subagent. The
  `/spartan` step is this same session following the installed Spartan skill.
- The `/spartan` round run inside this loop revises the artifact and returns
  its handoff into this session. It does not invoke the runtime and does not
  print an invocation for the human. Only this outer loop calls the CLI, and
  only when the loop stops does it print anything for the human to run.
- Do not commit, push, or perform another external action unless the human
  asked for that action in this round.

## Run

### 1. Take the explicit task path from the paste

The pasted handoff names the task on its `Open` line:

```text
Open `spartan/tasks/NNNN-slug.md`.
```

That repository-relative path is the only task identifier this skill may use.

If the paste has no such path, stop. Ask the human for an explicit
`spartan/tasks/<file>.md` path. Do not list or guess tasks.

Then, before running `doctor` or any other command, print one line naming what
this round is about to run:

```text
Round: spartan/tasks/NNNN-slug.md — handoff HX-00N — acting as <role>
```

Take all three from the paste itself: the `Open` line's path, the `(handoff
HX-00N)` marker when it carries one, and the role the `Act as <role>` sentence
names. Write `handoff none stated` or `role none stated` when the paste omits
one; do not open the artifact to fill in a missing value, and do not infer a
role from the host. A terminal collapses a long pasted block to a placeholder
such as `[Pasted text #3 +16 lines]`, so this line is the human's only view of
which task is running. It comes first for that reason.

### 2. Check the reviewer binding, then run the producer round through `/spartan`

Before any producer work, run `spartan-bridge doctor --repo <workspace-root>`
and read only the binding line for the review kind this round will dispatch:
`reviewer.plan` for a plan artifact, `reviewer.implementation` for an
implementation artifact. If that line reports
`reviewer_output_unconstrained`, stop here — run no producer round. Print, for
the human: which binding it is, that its host's CLI has no structured-output
flag, and that the fix is to rebind `reviewer.<kind>` in `AGENTS.md` to Codex,
Grok, or Claude Code and then re-run `/spbridge`. These are the only `AGENTS.md`
facts this skill reads before a verdict, and they come from `doctor` and
`policy`, not from inspecting the binding table directly.

Then, when the paste's `Act as <role>` is `planner` or `implementer`, run
`spartan-bridge policy --repo <workspace-root> --role <that-role>`. Take
`--role` from the paste (step 1), not from frontmatter or `AGENTS.md`. If
that role is not `planner` or `implementer`, skip this helper. If the helper
exits non-zero or its stdout is not one JSON object with `role`,
`model_binding_mode`, `binding_model`, and `binding_effort`, abort the
invocation — run no producer work and spawn no review.

`model_binding_mode` `advisory`: do not compare; continue to the shape
requirements and `/spartan`.

Otherwise compare the session model identifier this host has already exposed
to `binding_model` with a case-insensitive trim. Do not compare
`binding_effort` as a separate field, do not compare host, and do not invent
a mapping from display names to argv ids. Do not query entitlements or list
models. The session identifier is knowable only when it already matches
`MODEL_IDENTIFIER_RE` (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`). A display name
with a space (`Grok 4.6`), an empty value, or no exposed identifier is
unknowable: print one line that the model could not be confirmed, then
proceed even if the mode is `strict`. That `strict` case degrades to `warn`.

When `binding_model` is `null` under `strict`, abort — there is no bound
model to match. That is not the unknowable-session case. When
`binding_model` is `null` under `warn`, print one line that no bound model
was found and proceed.

`warn` on a `binding_model` mismatch: print one line naming `binding_model`
and `binding_effort`, then proceed.

`strict` on a `binding_model` mismatch: stop the whole `/spbridge`
invocation — no producer work, no review spawn. Tell the human to switch
the harness model to `binding_model`. When the paste role is `implementer`,
also name the Bridge-dispatched auto-chain successor as an alternative; that
successor always passes `--model`. Do not name auto-chain as a planner
recovery; the planner phase is always human-started. This skill never
switches the model.

This check is a pre-round string compare. It does not claim the Bridge
verified the producer model.

The producer round must also emit shapes the Bridge write can consume:

- A `## Next Handoff` the Bridge will consume puts the advisory block and the
  prompt block **each in its own ` ```text ` fence** — an unfenced advisory
  makes the consumed handoff unretractable and the whole write is refused
  (`task_artifact_write_rejected`, cause `composition_failed`).
- `## Review` is either the exact `Verdict: PENDING` / `Findings:` /
  `- None recorded.` placeholder or an existing marked region, and no other
  prose. Longer template placeholder text is refused the same way.

Follow the installed Spartan skill for the pasted handoff, in this session.

Leave the artifact exactly as that manual round would: `/spartan` updates the
task file; this skill does not. Do not return Spartan's handoff yet. Continue
to the next step.

If this step is a continuation after review findings, revise against those
findings on the same explicit task path. A producer round that returns into
the loop sets `next_role: reviewer` in the same edit that regenerates the
envelope; the next review otherwise reports
`transition_next_role_not_reviewer`. The inner `/spartan` round invokes
no CLI and prints no invocation for the human.

If the Spartan skill is not installed, stop and say so. Do not approximate it.

### 3. Leave the stale-build check to the runtime

Perform no comparison of `src/` against `dist/`. The runtime refuses `review`
and `mcp-stdio` when `dist/` is older than `src/`: it writes `dist/ is older
than src/; run npm run build` to stderr, exits 1, and creates no run. If the
CLI reports that message, tell the human to run `npm run build` and invoke
`/spbridge` again.

### 4. Invoke the installed runtime

Spawn the installed CLI with an argument array. No shell interpolation. Do not
redirect the CLI's stdout or stderr to a path under `<workspace-root>`, and do
not write, edit, or commit anything under that repository while a `review` is
running: a file that appears in the worktree during a review can be attributed
to the reviewer and block the run. Let the CLI's output reach the terminal, or
redirect it outside the repository.

Before **every** runtime spawn, use the current host's command-level approval or
escalation mechanism when its sandbox would otherwise block the Bridge process
tree from writing the selected official client's machine-local session state or
using the network. This applies independently to the initial review, every
`--after-run` continuation, the `spartan-bridge` executable on `PATH`, and the
`node dist/cli/main.js` fallback.

In Codex, request escalated sandbox permission on the shell invocation itself,
for the complete command process tree. Ask before starting the command; do not
start it inside the restricted sandbox and retry after `EPERM`. Keep the request
scoped to this review spawn. Do not encode a client-profile path, credential
location, Codex approval value, or permanent full-access setting in repository
files or runtime arguments.

If the host denies approval or cannot grant both the required machine-local
client-state writes and network access, stop before the CLI starts. No run was
created, no cycle was spent, and there is no run id to pass as `--after-run`.
Do not retry the denied spawn automatically.

An authorized chain (plan review, then the mapped implementer, then
implementation-review cycles) runs 8-15 minutes — longer than most hosts'
command timeout. Do not block a shell tool on it. Start it detached and follow
it with a bounded `wait` loop.

Start the chain with `--detach`. The command prints one JSON ack
`{ "detached": true, "run_id": "...", "pid": ... }` and exits 0:

```text
spartan-bridge review --repo <workspace-root> --task <path-from-step-1> --detach
```

Then loop `wait` with the `run_id` from the ack until it prints a terminal
document instead of `{ "state": "running", ... }`:

```text
spartan-bridge wait --repo <workspace-root> --run <run_id> --timeout-ms 25000
```

Each `wait` returns within the timeout: either `{ "state": "running", ... }`
(invoke `wait` again) or the same status / transition document a blocking
`review` would have printed (stop looping, go to step 5). This is the same
loop shape as `--after-run` — invoke, read the document, invoke again — and it
holds no chain counter. A `running` document whose `phase` changes between polls
(or whose `phase_since` is recent) signals a healthy chain — keep looping; total
wall-clock elapsed time alone is not a stall.

Each plan-review continuation is also detached:

```text
spartan-bridge review --repo <workspace-root> --task <path-from-step-1> --after-run <run_id> --detach
```

and is followed by the same `wait` loop on its own ack `run_id`.

If `wait` ever prints `error: the detached chain never created a run`, run
`spartan-bridge resume --repo <workspace-root>` once: it releases a stale
writer lock and marks an interrupted transition, printing the operator's
one-line recovery. Do not re-run the same `review --detach` — a re-run against
a dirty worktree is a second implementer round.

If `wait` prints a terminal document with `"reason_code": "stale_build"`, the
detached chain refused because `dist/` is older than `src/`. Tell the human to
run `npm run build` and invoke `/spbridge` again in a fresh session. Do not
pass `--after-run` — a rebuild is not a review cycle.

If `wait` prints a terminal document that is neither the `stale_build` document
above nor the "never created a run" error, and then one stderr line saying the
chain left `dist/` older than `src/`, the chain ran and left this checkout's
runtime stale. Report `state` and `reason_code` exactly as step 5 requires —
a non-terminal state there is the resume rule's business, not this line's —
and tell the human to run `npm run build` before the next `/spbridge` round,
which carries no `--after-run`. Do not run the build in this session, and do
not treat the line itself as a stop: it names what the round left behind, and
says nothing about whether that round succeeded.

`<workspace-root>` is the repository this session is already in. Do not search
for a repository. Do not pass `--run` to `review`, a review kind, a host, a
model, or a role. Do not pass a run id to `review` except as `--after-run` on a
continuation.

Prefer the `spartan-bridge` executable on `PATH`. If it is missing and this
checkout has `dist/cli/main.js`, invoke that file with `node` instead; it is
the same CLI. If neither exists, stop and say the runtime is not installed.

Invoke the CLI once per cycle. Do not retry a failed invocation.

### 5. Report the runtime's own outcome

After step 4's `wait` loop returns a terminal document, report that document's
outcome. Do not stop early on a non-null `transition_id` or a transition-shaped
intermediate status while `wait` still reports `{ "state": "running" }`; only
the terminal document from step 4 drives this step.

`review` writes one JSON document to stdout when it created a run or a
producer transition.

- If the terminal document has `"document": "transition"`, report `transition_id`,
  `state`, and `reason_code` by name. Quote `declaration_invalid_detail` when that
  field is a non-null string. Quote `unwritable_plan_targets` when that field is a
  non-null array. Those tokens are an advisory that the approved plan mentioned
  paths outside the automatic write scope; they are not a stop and do not replace
  `state` or `reason_code`. Print no implementer recommendation.
- If `verdict` is not null, report that verdict by name.
- Otherwise report `reason_code` by name.

Quote the values as the document spelled them. Do not remap, translate, or
filter them. Also name `run_id` and `state` when present, and name
`transition_id` when that field is a non-null string.

When `reason_code` is `adapter_error` or `adapter_timeout` and
`adapter_failure` is non-null, also name `adapter_failure.cause`,
`http_status` when it is a non-null integer, `signal` when it is a
non-null string, whether `output_excerpt` is null, and whether
`payload_log` is null. Do not quote `output_excerpt` text or payload-log
contents. Do not remap the cause.

If stdout is not that document, report the CLI's stderr (or that the
executable was missing). Do not invent a reason code.

### 6. Continue only from the status document

After the CLI returns, do not edit the task file.

A `review_chain` that is `null` is a stop. Do not read through it: a run that
failed before policy resolution carries no record at all, so check the
record's presence before its fields.

Continue inside this session only when all four hold:

1. `review_kind` is `plan`;
2. `reason_code` is `review_changes_requested`;
3. `review_chain.cycle` is not `null`;
4. `review_chain.cycle < review_chain.max_cycles`.

Then run one further `/spartan` round on the same explicit task path and
invoke the CLI exactly once more with `--after-run <run_id from the document
just read>`. Repeat from step 5. Do not re-run the step-2 model-binding
check on this same-session continuation.

Do not continue with `--after-run` for implementation-review findings. The
runtime owns that correction loop inside the same foreground `review`
invocation.

On anything else, stop. That includes a `null` `review_chain`, a
`changes_requested` whose `cycle` equals `max_cycles`, `cycle_limit_reached`,
`review_passed`, `chain_refused`, any other
`reason_code`, a null `verdict` with a `reason_code`, or a document this
skill cannot read. A
`changes_requested` at `cycle == max_cycles` is a stop and not a continuation.
A non-null `transition_id` on an otherwise terminal status document is not,
by itself, a stop: step 4 already followed the successor to its terminal
document before this step runs.

### 7. Print the next invocation for the human

Only a stopping outer loop prints an invocation. Print it in this conversation
only. Do not write it to the artifact, a handoff envelope, or any other file.

Use the status document's `reason_code` as the runtime emitted it. Do not
infer a code the document did not emit.

- `review_passed` on a plan-review status document: the automatic successor
  did not start. Read the artifact's written `next_role` and the host
  `AGENTS.md` binds to that recorded role. When that role is planner or
  implementer, also run `spartan-bridge doctor --repo <workspace-root>`
  after the recorded pass. That command is a non-mutating capability check,
  not a review spawn or continuation, and never carries `--after-run`.
  Read only the matching binding line for `reviewer.plan` or
  `reviewer.implementation`. Do not reconstruct the registry join, inspect
  capability flags, or infer a launcher from the host name. Missing or
  unreadable `doctor` output takes the manual fallback. Then apply this
  closed matrix:

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
  `review_passed -> /spartan or $spartan` rule. Host-token syntax remains a
  presentation detail after the case has selected a manual round; a host
  name never proves Bridge capability. The binding table has no invocation
  column; this skill carries the mapping: `/spartan` for Claude Code and for Cursor, `$spartan` for Codex.

  The recommendation never starts an agent. The human decides and opens the
  fresh producer session. A fresh producer phase starts a new review chain
  and therefore carries no `--after-run`.
- `producer_declaration_invalid` on a terminal transition document: a recoverable
  producer-round failure, not a review finding. Print a `/spbridge` invocation
  on the same explicit task path for a fresh implementer session; never
  `--after-run`. This is an exception to the generic transition-document row
  that prints no implementer recommendation.
- a terminal transition document from step 4's `wait` loop, when that document
  has `"document": "transition"`: report that `transition_id` and the
  document's `state`/`reason_code`. Print no implementer recommendation. The
  runtime already started or stopped the producer.
- `review_passed` on an implementation-review status document: report the
  terminal outcome. Print no implementer recommendation.
- `review_changes_requested`: print a `/spbridge` invocation on the same
  explicit task path, for a fresh unchained session the human may start.
- `adapter_error` or `adapter_timeout` when `adapter_failure` is non-null,
  applied in this order so a non-null `payload_log` cannot fall into the
  flake or unknown rows:

  | Shape | Recommendation |
  | --- | --- |
  | `cause` is `provider_unavailable` or `provider_limit` | Print no start. Provider-side; the operator retries when the provider recovers. |
  | `payload_log` is non-null | Print no start. Read `status.json` / `adapter-payload.log` before any re-run. |
  | `output_excerpt` is non-null and cause is not a provider_* value | Print no start. Read `status.json` / `adapter-payload.log` before any re-run. |
  | `output_excerpt` is null and `payload_log` is null and `signal` is non-null | `/spbridge` once on the same task path, no `--after-run` (infra flake). |
  | `output_excerpt` is null and `payload_log` is null and `signal` is null | Print no start. Unknown; do not assume a flake. |

  Do not auto-retry.
- Any other `reason_code`, a null `verdict` with a `reason_code`, or no
  status document: print that outcome and print no start.

Shape for a `review_passed` row that names `/spbridge`:

```text
Recommended next invocation (human decides; not written to the artifact):
- Host: <host AGENTS.md binds to the artifact's next_role>
- Role: <artifact next_role>
- Invocation: /spbridge in a fresh session, passing the prompt block below
```

```text
Open `<path-from-step-1>`.

Act as <artifact next_role>. Continue from the recorded verdict. Do not paste the stale Next Handoff.
Run the relevant repository checks and update the same task file.

Return only the next handoff, or a completion notice if no work remains.
```

Shape for a `review_passed` row that names a Spartan token:

```text
Recommended next invocation (human decides; not written to the artifact):
- Host: <host AGENTS.md binds to the artifact's next_role>
- Role: <artifact next_role>
- Invocation: </spartan or $spartan from the mapping above> in a fresh session, passing the prompt block below
```

```text
Open `<path-from-step-1>`.

Act as <artifact next_role>. Continue from the recorded verdict. Do not paste the stale Next Handoff.
Run the relevant repository checks and update the same task file.

Return only the next handoff, or a completion notice if no work remains.
```

Shape for a `review_passed` row that prints no agent invocation: print that
outcome and print no start.

Shape for `review_changes_requested`:

```text
Recommended next invocation (human decides; not written to the artifact):
- Invocation: /spbridge in a fresh session, passing the prompt block below
```

```text
Open `<path-from-step-1>`.

Revise against the recorded findings, then leave the review to this skill.
```

Shape for `producer_declaration_invalid`:

```text
Recommended next invocation (human decides; not written to the artifact):
- Invocation: /spbridge in a fresh implementer session, passing the prompt block below
```

```text
Open `<path-from-step-1>`.

Act as implementer. Fix the declaration named by declaration_invalid_detail, then leave the review to this skill.
```
