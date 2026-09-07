# Agent Spartan Protocol - task artifacts

The [Agent Spartan Protocol](https://github.com/angelopublio/agent-spartan-protocol) uses this directory for repository-local, durable handoff state for software tasks. Each task lives in `tasks/` as one concise Markdown file named `NNNN-slug.md`, where the four-digit number records immutable creation order and the frontmatter records `created_at` and `updated_at`.

The task file, repository files, and check results are sufficient for a human-started next round. This directory does not contain runtime state, queues, logs, credentials, or automation.

A task's frontmatter MAY carry a compact `HX-NNN` handoff identifier (`handoff_id`, `next_handoff_id`) so a receiving round can detect a stale pasted prompt before acting on it; older tasks without these fields remain valid as written.

When a repository prefers particular hosts for particular Spartan roles, that preference belongs in the repository's own instructions file, such as `AGENTS.md`, not under `spartan/`.

When a task settles something about how information is presented, its point-in-time design material - a screen brief, a layout choice, a question left to a designer - lives in `design/`. Standards that must stay true as the product changes are maintained documentation and belong to this repository's own design documentation instead, and nothing a design tool returns is stored here.

`spartan/tasks/` is intentionally public and version-controlled. Completed tasks are living proof that the protocol remains understandable, reviewable, and manually continuable without private orchestration state; release housekeeping must not delete or hide them.

## History in the public snapshot

The initial public commit preserves the pre-publication task files. Machine-specific home paths, an unrelated private repository identifier and task path, and a private client-context alias have been replaced by generic placeholders. An editorial correction in task `0061` scopes reviewer observations to the recorded runs and corrects its count of exhausted chains. Unused platform names and historical integration-document names have also been generalized; the optional Board documentation is now in `docs/BOARD.md`. Task identifiers, technical decisions, findings, and reported check outcomes are retained.

Some historical source-document names are replaced with `[historical document omitted]`; those entries preserve the original review evidence and file counts without pointing to a current file.

Historical commit IDs and line references describe the checkout used for each round; they may not resolve or match the new public Git history. Recorded hashes describe the original artifacts before publication sanitization. These records are evidence of past rounds, not authorization to resume a private run in this new checkout. Pending tasks need a fresh, explicit handoff under the current policy.

Historical host/vendor labels describe the tools used, not project authorship or endorsement. Development used AI coding agents under maintainer direction. Historical attribution labels have been normalized to host and model descriptions. Implementation wording describes project-local work and dependency choices, not a certified development process or manual typing. See [PROVENANCE.md](../docs/PROVENANCE.md).

---

To adopt this human-mediated approach for software tasks, see the [Agent Spartan Protocol](https://github.com/angelopublio/agent-spartan-protocol).
