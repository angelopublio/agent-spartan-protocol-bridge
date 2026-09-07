# Contributing

Agent Spartan Protocol Bridge is an early-stage project maintained by Angelo Publio. Small bug fixes, documentation improvements, and reproducible bug reports are welcome. Discuss new features, adapters, dependencies, and architecture changes in an issue before starting substantial work. Review timing depends on maintainer availability.

## Report a bug

Include the affected commit, operating system, Node.js version, relevant client version, expected behavior, and a minimal reproduction. Use synthetic task files and client-context aliases. Remove private paths and project details from diagnostics. Report security issues privately through [SECURITY.md](SECURITY.md).

## Prepare a change

Read [AGENTS.md](AGENTS.md) and keep the change focused. The runtime owns policy, state, permissions, and autochain; the skill and MCP adapter remain thin interfaces. Preserve the portable task contract and existing human gates.

Use Node.js 20 or newer. From the repository root, install dependencies with `npm ci`, then run `npm run typecheck`, `npm run build`, and `npm test`. Describe the checks you actually ran and any relevant limitations in the pull request. Prefer deterministic fake adapters and synthetic fixtures; contributing does not require a paid agent subscription or a live provider account. The maintainer can handle relevant official-client integration checks.

AI-assisted contributions are welcome. Understand the change you submit, review the generated code, and explain its behavior and validation. External code, tests, and other material may be incorporated only when their origin is documented and the source repository explicitly permits the intended use through a compatible license or another documented permission. Record the upstream URL, version or commit, affected files, and modifications in [the provenance ledger](docs/PROVENANCE.md), and preserve all required copyright, license, and NOTICE material. If origin, permission, or compatibility is unclear, do not incorporate the material. Follow [the open-source policy](docs/OPEN-SOURCE-POLICY.md) for reused material and declared dependencies.

Existing `spartan/tasks/` files record the project's development history. Preserve them. Contributors may use ordinary issues and pull requests; the maintainer will coordinate any Spartan task record needed for the change.
