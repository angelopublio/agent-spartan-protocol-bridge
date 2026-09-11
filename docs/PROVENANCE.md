# Provenance

This ledger records the origin of repository material, declared dependencies, and implemented host integrations.

Development used AI coding agents under maintainer direction.

## Current repository material

| Material | Origin | Relationship | Status |
| --- | --- | --- | --- |
| Bridge README and design documentation | Original project material | `original` | MIT |
| Bridge runtime code (`src/`, `tests/`) | Independently developed with AI coding agents under maintainer direction | `original` | MIT |
| `yaml` 2.x | <https://github.com/eemeli/yaml> | `dependency` | ISC |
| `typescript` 5.x | <https://github.com/microsoft/TypeScript> | `dependency` (dev) | Apache-2.0 |
| `tsx` 4.x | <https://github.com/privatenumber/tsx> | `dependency` (dev) | MIT |
| `@types/node` | DefinitelyTyped | `dependency` (dev) | MIT |
| `actions/checkout` v4, pinned `11d5960a326750d5838078e36cf38b85af677262` | <https://github.com/actions/checkout> | `dependency` (CI, unmodified) | MIT |
| `actions/setup-node` v4, pinned `49933ea5288caeca8642d1e84afbd3f7d6820020` | <https://github.com/actions/setup-node> | `dependency` (CI, unmodified) | MIT |

The two continuous-integration actions are referenced by immutable commit revision rather than by tag, because a tag can be repointed at material this ledger has not recorded. Neither is modified, and the only local material they affect is `.github/workflows/ci.yml`.

## Protocol and host integrations

| Project | Upstream | Relationship | Upstream license or terms | Local material affected |
| --- | --- | --- | --- | --- |
| Agent Spartan Protocol | <https://github.com/angelopublio/agent-spartan-protocol> | External task and handoff contract | MIT | Bridge task parsing, validation, and compatibility documentation; no upstream source vendored |
| Claude Code | <https://docs.anthropic.com/en/docs/claude-code> | `external-cli` | Vendor terms | Independently developed adapter in `src/adapters/claude.ts`; client installed separately |
| Codex | <https://learn.chatgpt.com/docs/codex> | `external-cli` | Vendor terms; Codex client includes open-source components under their own terms | Independently developed adapter in `src/adapters/codex.ts`; client installed separately |
| Cursor | <https://www.cursor.com/> | `external-cli` | Vendor terms | Independently developed adapter in `src/adapters/cursor.ts`; client installed separately |
| Grok | <https://grok.com/> | `external-cli` | Vendor terms | Independently developed adapter in `src/adapters/grok.ts`; client installed separately |

The [agent instructions](../AGENTS.md) permit external material only with documented origin, permission for the intended use, and compliance with [the open-source policy](OPEN-SOURCE-POLICY.md). Record incorporated material and declared dependencies here; preserve all applicable license and notice obligations. These rules govern future contributions and do not change the origins recorded above.

Host and model names in task records identify the tools used, not corporate authorship, sponsorship, or endorsement.

## Updating this ledger

Before adding a dependency, copied file, adapted prompt, test fixture, or vendored component:

1. add its exact upstream URL;
2. record the commit, tag, or package version;
3. change the relationship category;
4. list every local file affected;
5. record the license and NOTICE obligations;
6. add the required license material before merging.

Do not incorporate external material unless its origin is documented and its source repository explicitly permits the intended use through a license, such as MIT, or another documented permission.
