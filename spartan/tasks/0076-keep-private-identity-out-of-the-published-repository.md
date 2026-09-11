---
protocol: "1.1.0" # x-release-please-version
id: keep-private-identity-out-of-the-published-repository
created_at: 2026-09-10
status: completed
phase: complete
task_type: implementation
risk: material
current_role: human-operator
next_role: none
updated_at: 2026-09-10
handoff_id: HX-001
next_handoff_id: none
---

# Keep private identity out of the published repository

## Objective

This repository is published. Dogfooding rounds run inside private repositories, so the evidence
most worth quoting here is the evidence most likely to identify one. Close the mechanical shapes
that can carry an identifier into tracked content, state honestly in the authoring rule what the
automation covers and what stays judgement, and record why the larger controls that were designed
for this were rejected — so they are not proposed again.

## Context

The prompting incident was a private repository's absolute path written into a session note while
that session's working directory was this repository. It never entered Git. That fact decided the
shape of everything below: no pre-push hook, commodity or bespoke, would have seen it.

Five review rounds across two vendors examined the problem. They converged on a much smaller answer
than the one first proposed, and both required that this work land before anything else begins.

## Scope

- `.githooks/pre-commit` — deleted.
- `tests/repo-hygiene.test.ts` — the four shape assertions.
- `AGENTS.md` — the authoring rule's coverage sentence.
- `tests/agents.test.ts` — the pinned rule text and the authoring-rule count.
- `.github/workflows/ci.yml` — every pushed ref; actions pinned by revision.
- `docs/PROVENANCE.md` — the two continuous-integration actions.

## Out of Scope

- A curated list of identifying words, in any repository or on any agent-readable disk.
- A machine-global pre-push scanner, remote classification, report files, bootstrap ceremony.
- A commodity secret scanner under a hook framework, adopted as the answer to this threat.
- Per-path conditional Git identity, and separating public from private development roots.
- A redacted-export subcommand of this runtime.

## Constraints

- Repository content may not name what it protects. A denylist in a public repository publishes the
  manifest of what must never be published; the same list on an agent-readable disk teaches the
  vocabulary to the agents whose context mixing is the problem.
- A detector may not print what it detects. Reporting a matched value or an offending path
  discloses it into logs and transcripts.
- Continuous integration on a public remote detects after publication. It is regression evidence,
  never a publication gate.

## Decisions

- **D1.** The repository-local pre-commit hook is deleted rather than fixed. It exited zero when
  dependencies were absent, and its own failure text advised the bypass flag. It was never
  installed. A control that fails open and advertises its own bypass is worse than none, because it
  is trusted.
- **D2.** The hygiene test reads the index and the object database, never the working filesystem. A
  symlink is read as the blob holding its target rather than followed out of the repository, and the
  bytes checked are the bytes a commit would carry. The operator-visible consequence, which should
  not have to be derived: the check inspects staged content only. An edit that is not staged, and a
  file that is not tracked, are not inspected at all — so a run that passes before `git add` says
  nothing about what the commit would carry.
- **D3.** All four assertions scan both tracked pathnames and tracked blob bytes. A filename is
  content, and an assertion that scanned only bytes would be the one place a name could sit. Blobs are
  decoded as UTF-8, so a tracked file in another encoding is scanned as whatever that decoding
  yields; the home-path assertion knows two POSIX layouts rather than every one; and the alias
  assertion knows quoted serialisations only, neither an unquoted plain scalar nor the command-line
  form. All three limits are stated in the test rather than implied.
- **D4.** The test scans its own entry. A file excluded from its own scan is the one place a later
  edit can hide something.
- **D5.** A finding names a position in the tracked listing and a count. Never the matched value, the
  tracked path, or the filename. Not a blob identifier either: that is derived from content, and a
  position is not. The test runner adds its own framing around a finding — this file's path, source
  lines, the assertion message — and that framing is public content, so the claim is about what a
  finding carries, not about everything the runner prints.
- **D6.** Every pattern captures permissively and judges strictly. A capture narrowed to the
  admissible alphabet misses a value outside it entirely, and truncates a longer token onto a pinned
  exception, exempting it. The home, tilde and alias captures therefore end at whitespace, a quote or
  a backtick, never at an assumed alphabet. The address pattern is the one exception: it ends at the
  last label it can read, so what follows a match is inspected instead, and that inspection is
  deliberately conservative — a continuation of periods alone is sentence punctuation, anything else
  is treated as a longer address and reported even where a human would read it otherwise. The tilde exception compares the whole captured token, and a leading dot exempts
  a dotfile only when no segment of the token is a traversal. Where a capture legitimately runs past
  its value — an escape sequence, a regular-expression anchor or an interpolation in source — the
  address assertion checks the character after a match, because its pattern can end at the last
  label it can read and a prefix must never satisfy an exception. The home-path assertion takes the
  first non-empty segment, so a doubled separator cannot present an empty one and be read as the
  bare shape.
- **D7.** A fourth assertion requires every client-context alias in a quoted serialisation of the
  singular field, and in this repository's Agent hosts table, to be `personal` or `default`. The
  unquoted plain scalar and the command-line form are not detected and the limit is stated rather
  than gated: in source both appear inside string literals, where an escape sequence or an
  interpolation can transform a captured value after the fact, and no character-class boundary
  distinguishes that syntax from an alias. The alternatives were a loophole or a false positive on
  every literal. No
  assertion is gated on a file extension: renaming a file, removing its extension, or changing its
  case would walk around such a gate. Two
  fixed literals, not derived from the policy document: derivation would ratify a leak the moment it
  was committed into the table it reads. The plural registry map and the example binding tables in
  product documentation are exempt, because their generic aliases exist to show that resolution is
  not a two-value list.
- **D8.** A companion assertion that every task path named in tracked content exists in this
  checkout is rejected. Completed task records legitimately cite files a later task removed, and
  some are already recorded as omitted historical documents.
- **D9.** The authoring rule stays whole and gains a sentence naming the four shapes the check
  covers and stating that names written as prose are not scanned. Replacing the rule with the three
  or four checkable shapes would delete the only written control for names.
- **D10.** Continuous integration runs on every pushed ref. Third-party actions are pinned to
  immutable revisions and recorded in the provenance ledger, because a tag can be repointed at
  material the ledger has not recorded.
- **D11.** Per-path conditional Git identity is not adopted. Measured: the global commit address is
  on a personal domain, this repository's effective address is the hosting provider's no-reply form,
  and the published commit already carries that no-reply address in both author and committer
  fields. There is no work address configured anywhere for a conditional rule to stop.
- **D12.** Separating public from private development roots is not adopted. The private tree was
  read by typing its absolute path, not by a recursive scan of a shared parent, so the migration
  would not have prevented the incident. Its remaining justification was enabling D11.
- **D13.** The session boundary is asymmetric and is practice, not enforcement: a session whose
  workspace is this repository never receives or accesses private-tree data; a session holding
  private identifiers may read this project's public source but does not write this checkout,
  including through the user-level skill and executable symlinks that resolve into it. A run that
  happened in a private tree is diagnosed inside that tree's own session, and only a fixed positive
  schema crosses.
- **D14.** That schema is: run and transition identifiers, state, verdict, reason code, review kind,
  cycle accounting, timestamps, task-write state and rejection cause, chain-refusal reason, the
  producer diagnostic in full, the invalid-declaration slug, and adapter phase, cause, exit code,
  http status and byte counts. Excluded: every free-text field, log paths, reviewer finding text,
  path lists, artifact hashes and policy digests, the task path, the client-context alias, the
  launcher identifier, and the adapter signal, which is an open string rather than a closed
  enumeration. A policy digest is a hash over twelve fields of which eleven come from small
  enumerable spaces, so publishing it makes the twelfth recoverable.

## Acceptance Criteria

- [x] **C1 (D1)** No repository-local hook file remains, and no hook path is configured.
- [x] **C2 (D2, D3, D4)** The hygiene test enumerates tracked index entries, reads their bytes from
      the object database, scans pathnames and blob bytes, and includes its own entry.
- [x] **C3 (D5)** A finding carries a position and a count, and nothing that identifies a path, a
      filename, the matched value, or content it is derived from.
- [x] **C10 (D6, D7)** A prefix of an allowed value never satisfies an exception: an address
      continuing into another address character, and a home layout prefix followed by a doubled
      separator, are both reported.
- [x] **C4 (D6)** A path beneath the pinned tilde fixture fails the assertion; the fixture itself
      passes.
- [x] **C5 (D7)** A client-context alias outside the two public values fails in a quoted
      serialisation of the singular field and in this repository's own host-binding table;
      documentation example tables and the registry map do not. An unquoted or command-line form is
      not judged at all.
- [x] **C6 (D8)** No task-path existence assertion is present.
- [x] **C7 (D9)** The authoring rule is intact, claims no enforcement, and its coverage sentence
      names each shape with the exemption that applies to it — the pinned tilde fixture, the quoted
      serialisation, the placeholder user; the pinned rule text and the authoring-rule count agree
      with it.
- [x] **C8 (D10)** The workflow triggers on every pushed ref, both actions are pinned by revision,
      and both are recorded in the provenance ledger with origin, revision, licence, and the local
      material they affect.
- [x] **C9** The full suite passes.

## Work Completed

- Deleted `.githooks/pre-commit` and its directory.
- Rewrote `tests/repo-hygiene.test.ts` against the index and object database, scanning pathnames and
  blob bytes, including its own entry, capturing to a real delimiter, naming a position in the
  tracked listing rather than any identifier derived from content, and adding the client-context
  assertion.
- Appended the coverage sentence to the authoring rule in `AGENTS.md` and regenerated the pinned
  literal in `tests/agents.test.ts` from the file itself.
- Set the workflow to every pushed ref, pinned both actions by revision, and recorded them in
  `docs/PROVENANCE.md` with a note on why a revision rather than a tag.

## Evidence

- Regression, each planted in the index and reverted: a filename shaped like an e-mail address with
  clean content fails the address assertion; a path beneath the pinned tilde fixture fails the tilde
  assertion; a client-context value outside the two public literals fails the alias assertion; a
  home path planted in the test file itself fails, confirming the self-scan. Each finding was
  `tracked entry <n> of <total>` and nothing else.
- The cases every audit round required are retained as inputs in
  `tests/repo-hygiene.test.ts`, in four tables asserted against the same judgements the
  tracked-content scan uses, rather than described here. They cover, as reported: a layout prefix
  with a doubled and with a tripled separator; an address continuing past the synthetic value into a
  hyphenated and into an underscored suffix; a tilde token truncated by legal pathname punctuation
  onto the pinned fixture; a traversal after a dot-prefixed first segment; an alias containing a dot
  and an alias in single quotes. And, as passing: the bare layout prefix, the synthetic address
  alone, the synthetic address ending a sentence, a dotfile path, the pinned fixture itself, and a
  null alias value.
- Earlier edge cases exercised against tracked content, each planted in the index and reverted: a tilde token truncated
  onto the pinned fixture, first by a character outside the old capture alphabet and then by legal
  pathname punctuation; a traversal sitting after a dot-prefixed first segment; an alias containing a
  dot, which an earlier narrowed capture did not match at all; two address exceptions that admitted
  more than the synthetic value; an alias in a Markdown file, in a file with no extension, and in a
  file with an upper-case extension, each of which an earlier extension gate would have skipped; an
  alias in a tracked pathname rather than in a blob; and a home path truncated before an excluded
  character; an address that continues past the synthetic value into a hyphenated or underscored
  suffix; and a layout prefix followed by a doubled separator. Every one of them fails the suite,
  and the two negative controls — the bare layout prefix, and the synthetic address alone — pass.
- `npm test`: 552 pass, 0 fail.
- `npm run typecheck`: exit 0.
- Action revisions and licences resolved from the upstream repositories at pin time.

## Review

This task was implemented directly by the human operator and was not dispatched through the Bridge.
Its design was reviewed out of band across five rounds by two vendors' reviewers, whose rulings are
recorded as D1-D14 above. No Bridge verdict exists for it and none is synthesised here.

## Blockers

None.

## Next Action

None. Follow-up work recorded elsewhere: the remaining active tasks, and the observation that a
task's plan-review history is not addressable by any existing command, so a chain that stops and
restarts is invisible to the cycle ceiling.

## Next Handoff

None.
