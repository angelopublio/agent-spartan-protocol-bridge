# Claude Code Instructions

Read and follow the repository-root `AGENTS.md` before acting. `AGENTS.md` is the authoritative source for roles, host bindings, client contexts, automation grants, permissions, security boundaries, and human gates.

Resolve role assignments from the current Agent hosts table in `AGENTS.md`. Do not infer a role from the active host. Act only in that bound role, or when the human explicitly assigns a permitted role. Follow the command and prompt handover conventions in that file.

Keep all persisted repository content in English. Never request, inspect, copy, store, or forward provider credentials or authentication files.
