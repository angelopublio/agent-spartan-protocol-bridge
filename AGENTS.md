# Repository Instructions

## Project boundary

Agent Spartan Protocol Bridge is an independent local runtime that coordinates authorized Agent Spartan Protocol roles across already-authenticated official clients. The portable protocol remains manually usable when the Bridge is absent. Official-client profile isolation is machine-local Bridge setup, not a protocol change: keep Agent Spartan Protocol install paths unchanged, and let `docs/examples/agent-profiles/wrap-official-client` mirror `~/.agents/skills` into isolated `CODEX_HOME` and the Cursor Agent CLI `cursor-home`. See [User skills under isolation](docs/AUTHENTICATION-AND-SECURITY.md#user-skills-under-isolation).

- The Bridge runtime, not a host skill, owns policy resolution, state transitions, permissions, locks, and operational events.
- The `spartan-bridge` CLI is the host-neutral interface. MCP and `/spbridge` are optional adapters.
- The Agent Spartan Protocol Board is an optional integration, never a runtime dependency.
- AI-assisted implementation is permitted. External source code, tests, documentation examples, and other material may be copied, adapted, translated, or vendored only when the origin is documented and the source repository explicitly permits the intended use through a compatible license or another documented permission. Apply the same requirements to material incorporated through an AI coding agent.
- Follow `docs/OPEN-SOURCE-POLICY.md`: record the upstream URL, exact version or commit, affected local files, license or permission, and local modifications in `docs/PROVENANCE.md`; preserve all required copyright, license, and NOTICE material. Evaluation alone does not authorize incorporation. If origin, permission, or compatibility is unclear, stop before incorporating the material and report the uncertainty. Declared package dependencies follow the same provenance and license process. Existing task scope and human gates still apply.

## Commands and prompts handed to the human

These conventions apply in every host, including when `/spbridge` presents a next-round prompt. They are defined here and require no machine-local instruction file.

- Explain the target repository, host, and every prerequisite before presenting a command or prompt. When a build or other command must run before a prompt, give that command first; never put a prerequisite after the prompt it affects.
- For a command the human must run, use exactly one command between these markers, with no explanation inside:

```text
######## RUN ON TERMINAL ################
<command>
######## END OF RUN ON TERMINAL ########
```

- Make the command's working directory explicit when it matters. For multiple commands, explain their order and use a separate marked block for each.
- For a prompt the human must paste into another host, name the host and repository before the block and put only the prompt between these markers:

```text
######## RUN AS PROMPT ##################
<prompt>
######## END OF RUN AS PROMPT ##########
```

- Markdown fences may wrap these examples, but a fence alone does not replace the required opening and closing markers in a human handover. Adapt a skill's displayed examples to this presentation convention without changing the prompt's role, task path, handoff identifier, or runtime authority.

## Language and sources of truth

- Write all repository documentation, task artifacts, schemas, diagnostics, and user-facing messages in English.
- Treat product files and check results as implementation truth.
- Treat the explicit `spartan/tasks/<task>.md` file as portable handoff truth.
- Treat `.spartan-bridge/runs/<run-id>/events.jsonl` as operational runtime truth after the runtime exists.
- Use explicit task paths and run IDs. Never search for or act on a vague "latest handoff."

## Agent hosts

| Binding | Host | Client context | Model | Effort |
| --- | --- | --- | --- | --- |
| planner | Claude Code | personal | claude-opus-5 | high |
| reviewer.plan | Codex | personal | gpt-5.6-sol | high |
| implementer | Codex | personal | gpt-5.6-sol | high |
| reviewer.implementation | Claude Code | personal | claude-opus-5 | high |

A `reviewer.plan` or `reviewer.implementation` binding must name a host whose
adapter guarantees schema-constrained review output: Codex, Grok, or Claude
Code. Cursor is not eligible as a reviewer because its CLI has no
structured-output flag (D-043, D-046); the Bridge refuses such a dispatch with
`reviewer_output_unconstrained`. Revisit when `cursor-agent` exposes a
`--json-schema` / `--output-schema` flag. Cursor remains a valid `planner` and
`implementer` host.

`personal` is an opaque client-context alias. It identifies an externally prepared official-client launch context; it is not a credential, provider account ID, email address, or built-in Bridge account type. Repository content may select this alias but may not define launcher commands, authentication paths, credential variables, tokens, cookies, or API keys.

Each author round and the reviewer round that follows it must use fresh, separate execution contexts. Where one host holds both bindings, that separation is session isolation only, not cross-vendor independence.

This repository runs the Spartan Bridge. A producer round whose review the Bridge dispatches is
entered through `/spbridge`, and the handoff that precedes it is addressed to that producer rather
than to the reviewer. When the mapped `reviewer.plan` host has no working adapter, or the Bridge is
not installed here, the advisory names the host's own token instead.

## Spartan Bridge automation authority

- The human starts the planner producer phase of a chain; later plan-correction cycles continue inside that same human-started planner session. Each authorized automatic implementation or correction producer uses a fresh mapped execution in the same foreground Bridge run.
- A human-started Spartan Bridge run may start the mapped reviewer automatically.
- The reviewer must run in a fresh, technically enforced read-only session.
- The reviewer returns structured findings and does not write the worktree or Spartan task artifact.
- This run grants the Bridge `task_artifact_write` only for persisting validated reviewer findings and transition metadata to the explicitly identified current Spartan task artifact.
- A `task_artifact_write` may not modify product files, this `AGENTS.md`, host bindings, automation authority, commands, credentials, or another task.
- The Bridge may return findings to the current planner session and repeat up to 3 plan-review cycles.
- After a persisted plan-review pass, the Bridge may return implementation findings to a fresh mapped implementer execution and repeat up to 3 implementation-review cycles.
- A producer round that received findings from a Spartan Bridge run may start the next review run automatically within the authorized cycle limit.
- After an automatic implementer correction declaration, the Bridge may start the next implementation review automatically within the authorized implementation-review cycle limit.
- The Bridge must stop on `human_required`, `blocked`, a policy conflict, a stale artifact, an unavailable adapter, a cycle limit, an unauthorized chain, or an unvouchable chain reference.
- The Bridge must stop before changing the producer role or producer host, except for the mapped plan-pass implementer transition and its mapped implementation correction executions.
- After a human-started planner phase and a persisted `reviewer.plan: pass`, the Bridge may start the mapped `implementer`, may start the mapped `reviewer.implementation` after the implementer's declaration, and may return implementation findings to a fresh mapped implementer execution within the independent implementation-review cycle ceiling. Automatic implementation requires an unchanged approved-plan hash and an exclusive worktree lock.
- A human-started Spartan Bridge run may start the mapped `reviewer.implementation` automatically when the current Spartan task artifact declares the implementer round finished and the reviewer round next; the Bridge takes that declaration as the implementer's assertion that the required checks passed, and does not verify it. That reviewer is given a read-only copy of the working-tree file content admitted by the implementation review scope declared below, excluding only `.git` metadata; repository ignore rules do not classify or remove files, ancestor directories are created only as containers for admitted files, and no repository file path outside that scope appears in the copy or in any other file the reviewer is given.
- Authorization does not imply capability. If the mapped official-client adapter is not implemented or cannot enforce the required permission mode, the Bridge must stop for the human.

### Automatic implementation write scope

- `src/`
- `tests/`
- `docs/`
- `skills/`
- `agent-skill/skills/spbridge/SKILL.md`
- `spartan/`
- `README.md`
- `package.json`
- `package-lock.json`
- `tsconfig.json`

### Implementation review scope

- `src/`
- `tests/`
- `docs/`
- `skills/`
- `agent-skill/skills/spbridge/SKILL.md`
- `spartan/`
- `README.md`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `AGENTS.md`
- `spartan-bridge/config.yaml`

## Manual Spartan rounds

When continuing manually without the Bridge or without an available required adapter, every cross-host transfer is human-started. Automatic transfers are permitted only under the Spartan Bridge automation authority above. In a manual review round, the human may authorize the reviewer to update only the current Spartan task artifact while product files remain read-only.

## Role permissions

| Role | Permission |
| --- | --- |
| planner | Read product files and write planning artifacts only |
| reviewer | Read product files; return a verdict and findings; never fix reviewed work |
| implementer | Modify the worktree within the authorized task scope and run relevant checks |

Provider identity never determines authority. The explicit role and pinned repository policy determine authority.

## Development expectations

- Target Node.js 20 or newer with TypeScript ESM.
- Keep the application core independent of CLI, MCP, Board, and skill adapters.
- Use direct process spawning with argument arrays and no shell interpolation.
- Keep runtime dependencies narrow and record third-party licenses when adding them.
- Prefer deterministic fake adapters for core tests before enabling real provider adapters.
- Use the repository's documented package scripts once they exist. Until then, do not invent successful build, lint, typecheck, or test results.
- Update the active Spartan task with concise commands and outcomes for completed work.

## Authentication and security boundary

- The Bridge never authenticates a user or provider and never invokes login, logout, or account-selection flows.
- Tokens, cookies, provider authentication files, API keys, Keychain data, browser sessions, account identifiers, and credential environment variables must never enter Bridge inputs, arguments, configuration, runtime state, fixtures, or logs. This prohibition is over provenance: the Bridge never acquires that class from a credential store, an environment variable, a command-line argument, a configuration value, or an official client's private authentication state. `docs/AUTHENTICATION-AND-SECURITY.md` enumerates it.
- The Bridge never reads the contents of a repository file in order to classify it, because that reading is itself the ingestion this section forbids. A repository file enters a Bridge input only when an explicit allowlist of paths admits it, and a path no entry admits is excluded whatever it holds. What a repository keeps under an admitted path — including a secret it committed or left in its working tree — is copied without inspection, and is that repository's exposure exactly as it is under human code review.
- Official clients own authentication and access their own credential stores directly.
- A binding may declare which model to use; the Bridge must not enumerate, inspect, or query which models an account is entitled to.
- `doctor` may check only non-secret integration facts: repository readability, policy readiness, registry readability and schema validity, launcher identifier resolution, fake-interface capability flags, and Cursor, Codex, Grok, and Claude Code launcher executable and interface availability. Policy readiness covers repository content only: what a section says, what shape a table has, whether a required sentence is present, and whether a declared value satisfies a charset. It must not inspect authentication, account identity, subscription, billing, entitlements, or whether a client is signed in.
- Reviewer read-only behavior and one-writer constraints must be technically enforced, not merely prompted.
- Ambiguous authority, unsafe paths, stale hashes, missing client contexts, or unsupported permission modes fail closed.

## Commit sequencing

- Before starting work, if the working tree carries changes from a different task, stop and report them to the human instead of layering a second task on top. Once two tasks have edited the same file, no commit can separate them afterwards.
- Commit at task boundaries, not after every round. Several rounds of one task may share a working tree; the resulting diff is still attributable to that task.
- When a round is explicitly authorized to commit, the commit is its final action. Finish the task artifact first, including its outcome, evidence, verdict, and handoff envelope, then stage the artifact together with the work and commit once.

## Artifact authoring

- Write a plan's decisions first and its acceptance criteria last, deriving each criterion from a named decision. The one exception is a row that records only a repository check the round must run; everything else names its decision.
- When a decision changes, re-derive every criterion that touches it instead of editing the one a finding named. A criterion is a consequence of a decision, so editing it in place preserves what the old decision implied.
- State an invariant positively: what stays the same, and the complete list of what changes. A closed claim such as "the only difference is X" is where an undercount hides.
- Before requesting review, read the criteria against the decisions as a set.
- An Evidence row reproduces the input that produced it, or names the file holding it, so a later reader can re-run it. Describing an input in place of quoting it is how an acceptance criterion gets written from a case that already passes.
- A task file created for later work leaves its author with a complete handoff envelope: `next_handoff_id`, the advisory `- Handoff:`, and the prompt's `(handoff HX-NNN)`, all agreeing. Queued is not a reason to omit it; a queued task is the one most likely to be opened cold.
- A role change and its envelope move together. A round that changes frontmatter `next_role`, or that finds it already changed, regenerates `## Next Handoff` in the same edit: the advisory, the prompt's `Act as <role>`, and the identifier all match the new role, or the section carries no envelope at all. An artifact whose frontmatter and envelope name different roles is telling a reader to run the wrong round.
- Every repository path a plan names in its objective, context, scope, decisions, or criteria is confirmed to exist in the current checkout before the plan is written. A path a prior task removed is dead weight the implementer round stops on; name the file that exists, or state that the work is a follow-up outside this repository.
- A plan whose decisions or scope edit `AGENTS.md` or `spartan-bridge/config.yaml` declares a human implementer: frontmatter `next_role: human-operator` on the plan-review pass, not the plan-pass auto-chain. Those two paths are outside every automatic write scope, so a mapped implementer cannot satisfy such a plan; without the human-implementer declaration the round is spent discovering that at the implementation-review gate.

## Handoff authoring

- Name the invocation the next round actually uses. The declaration under Agent hosts, together with `spartan-bridge doctor` for whether the mapped `reviewer.plan` adapter works, decides whether the advisory names `/spbridge` or the host's own token. Do not infer adapter support from a host name. A reader must be able to tell from the advisory which kind of round comes next without inferring it.
- The prompt block stays host-neutral and executable without the Bridge, so a handoff remains usable when the runtime is absent.

## Human-only gates

Unless the human explicitly authorizes the action in the current round, stop before commit, push, pull-request creation, merge, release, deployment, publication, destructive Git or filesystem operations, credential changes, account changes, or scope expansion.
