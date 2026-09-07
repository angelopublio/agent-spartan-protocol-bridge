# Open-Source Policy

> This document is a project policy, not legal advice.

## Short answer

Evaluating tools and documented interfaces does not authorize incorporating their implementation or other materials into this repository.

The safe public approach is:

- when including a reference to another tool or project, describe it factually and link to its source;
- state that this project is independent and not endorsed by vendors;
- do not use vendor logos or imitate trade dress;
- develop project code with AI assistance permitted; incorporate external code, tests, or other material only with documented origin and explicit permission for the intended use through a compatible source license or another documented grant;
- preserve every applicable copyright, license, and NOTICE obligation for copied or adapted material;
- keep a per-source provenance ledger.

Before incorporation, record the upstream URL, exact version or commit, affected local files, relationship category, license or other permission, and local modifications in `docs/PROVENANCE.md`. Preserve all applicable copyright, license, and NOTICE material. A public repository or an AI-generated reproduction does not itself establish permission. If origin, permission, or compatibility with the intended distribution is unclear, stop before incorporation and report the uncertainty. Declared dependencies follow the same process. This policy does not expand task scope or bypass existing human gates.

## Copyright, license, and trademark are separate

### Copyright

Copyright protects original expression, including source code, substantial documentation, tests, prompts, and some creative structure. It generally does not protect the abstract idea of alternating a planner and a reviewer.

Short names and titles are generally not protected by copyright in the same way as code or documentation. The [U.S. Copyright Office FAQ](https://www.copyright.gov/help/faq/faq-protect.html) explains that names, titles, slogans, and short phrases are not protected by copyright, although trademark law may apply.

### Open-source license

A license grants permission subject to conditions. The [MIT License](https://opensource.org/license/mit) permits broad reuse but requires its copyright and permission notice to remain in copies or substantial portions.

Putting an MIT `LICENSE` in this repository licenses original material owned by this project's copyright holder. It does **not** convert copied third-party or previously unlicensed material into MIT.

### Trademark

Project and vendor names may be trademarks. Use them descriptively, avoid logos and implied sponsorship, and include the independence disclaimer. Before adopting a public brand for commercial use, consider a trademark search in the relevant jurisdictions, such as [Brazil's INPI](https://www.gov.br/inpi/pt-br/servicos/marcas) and WIPO's global databases.

## Relationship categories

Classify incorporated material, dependencies, and implemented integrations in [PROVENANCE.md](PROVENANCE.md). References may be recorded where useful; a catalog of every evaluated tool is not required:

| Category | Meaning | Required action |
| --- | --- | --- |
| `reference-only` | Read or evaluated; no material copied | Link and describe factually |
| `external-cli` | Invoked as a separately installed user tool | Document compatibility and vendor prerequisites |
| `dependency` | Imported package or linked library | Track version and include required license material in distributions |
| `adapted` | Code or expressive material modified from upstream | Preserve license/notice, identify source, and mark changes |
| `vendored` | Upstream material distributed in this repository/package | Preserve all applicable license and NOTICE files |

Evaluation or similarity alone does not establish incorporation. Classify material actually modified from an upstream source as `adapted`, document that source, and comply with its terms.

## MIT material

When copying or substantially adapting MIT-licensed material:

1. record repository URL and exact commit or release;
2. identify the affected local files;
3. preserve the upstream copyright and MIT permission notice;
4. mark local modifications;
5. include the notice in the relevant source or third-party notice bundle.

The Agent Spartan Protocol is MIT-licensed. The Bridge should normally consume its release as an external contract instead of duplicating its normative skill, schema, templates, tests, or documentation. If substantial protocol material is vendored, preserve its MIT notice.

## Apache-2.0 material

Apache-2.0 is compatible with using separate MIT-licensed original code, but copied Apache material keeps its Apache obligations. Under [Apache License 2.0, section 4](https://www.apache.org/licenses/LICENSE-2.0), redistribution of adapted work requires the license, preservation of relevant notices, prominent change notices, and inclusion of relevant upstream NOTICE content when one exists.

Do not remove an Apache header or label an adapted Apache file as exclusively MIT. If substantial Apache code is adopted, consider licensing the whole Bridge under Apache-2.0 to simplify administration while still preserving every upstream notice.

## Missing or unclear source permission

Do not incorporate material whose origin or permission for the intended use cannot be established. The source repository must provide a compatible license or another documented permission covering that use. Record the permission and retain all applicable third-party notices before incorporation. Adding this project's MIT license does not supply a missing upstream grant.

## Public repository files

Before executable code is published, maintain:

- `LICENSE` for original project material;
- `docs/PROVENANCE.md` for incorporated material, dependencies, and implemented integrations;
- `THIRD_PARTY_NOTICES.md` only when actual dependencies or copied material require it;
- `LICENSES/` when distributed third-party licenses cannot be represented cleanly in one notice file;
- lockfiles and, when useful, an SBOM for packaged dependencies;
- SPDX headers in adapted or independently licensed source files where provenance is otherwise ambiguous.

A bibliography of `reference-only` projects does not require copying every upstream license into this repository.

## Independence statement

Use this statement in public project surfaces:

> Agent Spartan Protocol Bridge is independently developed. Compatibility references do not imply affiliation with or endorsement by Anthropic, OpenAI, Cursor, or any other referenced project. Product and project names remain the property of their respective owners.

## Publication checklist

- [ ] No credentials, auth files, private paths, or private repository content are present.
- [ ] Every copied or adapted file has a recorded source and license.
- [ ] Required copyright, license, and NOTICE text is preserved.
- [ ] Each incorporated source explicitly permits the intended use; unresolved origin or permission questions block incorporation.
- [ ] Reference-only projects are described without implying endorsement.
- [ ] No third-party logo or trade dress is used.
- [ ] Package metadata declares the chosen license.
- [ ] Dependency lockfile and third-party notices match the distributed artifact.
- [ ] A private security-reporting path exists.
