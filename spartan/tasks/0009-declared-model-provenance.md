---
protocol: "0.6.1" # x-release-please-version
id: declared-model-provenance
created_at: 2026-08-17
status: completed
phase: complete
task_type: implementation
risk: high-impact
current_role: reviewer
next_role: none
updated_at: 2026-08-17
handoff_id: HX-005
next_handoff_id: none
---

# Declared model provenance for Bridge-executed review rounds

## Objective

A Bridge-executed review round declares, passes, observes, and records the model it actually ran, so that a later reader can compare the producing round's model vendor with the reviewing round's model vendor and judge independence from the repository alone.

## Context

The portable protocol requires every round to record the model it actually ran, because independence is a property of model vendors rather than of host names. For a host that runs models from several vendors, the vendor is set by the model, not by the host: this repository binds plan review, implementation, and implementation review all to Cursor, so the host name carries no vendor information at all.

Three concrete gaps make a Bridge-executed review unable to satisfy that requirement today:

- `src/policy/agents-policy.ts` accepts a host-binding table of exactly three columns (`Binding | Host | Client context`) and rejects any other width, so no model can be declared.
- `--model` sits in `CURSOR_FORBIDDEN_ARGV_TOKENS` in `src/adapters/cursor.ts`, so no model is passed.
- `renderBridgeRunLine` in `src/core/task-write.ts` records `host` and `launcher` but no model.

The result is that automating a review makes its independence unverifiable, which is the opposite of what the automation is for.

This planning round ran in Claude Code using Claude Opus 5 (Anthropic).

## Scope

- `AGENTS.md`: host-binding table gains `Model` and `Effort` columns; the authentication boundary gains the preference/enumeration sentence.
- `src/policy/agents-policy.ts`: five-column table, model and effort validation, model and effort returned.
- `src/core/contracts.ts`: policy, adapter-input, capability, status, and reason-code additions.
- `src/core/serialize.ts`: `canonicalPolicyJson` and `serializeStatus`.
- `src/core/review.ts`: plumbing, the read-back comparison, and its terminal outcome.
- `src/adapters/adapter.ts`: one observation accessor on the `Adapter` type.
- `src/adapters/cursor.ts`: denylist split, model argv construction, and `observedModel()` returning `null` unconditionally.
- `src/adapters/fake.ts`: the same accessor, with a configurable observation so the compare's three outcomes are testable.
- `src/core/task-write.ts`: `TaskWriteMeta` and `renderBridgeRunLine` only.
- `docs/AUTHENTICATION-AND-SECURITY.md` and `docs/DECISIONS.md`: record the split and the fail-closed rules.
- Tests: `tests/agents.test.ts`, `tests/cursor-adapter.test.ts`, `tests/task-write.test.ts`, `tests/review.test.ts`, `tests/lifecycle.test.ts`, `tests/serialize.test.ts`, `tests/cli.test.ts`, `tests/fixtures/cursor-agent-stub.mjs`.

## Out of Scope

- Implementing review-cycle loops.
- Parsing `spartan-bridge/config.yaml`.
- The automatic implementer transition (`AGENTS.md` still withholds that grant).
- Any change to the portable protocol: the protocol's requirement is satisfied by recording the model, not by amending the protocol.
- Changes to `src/core/doctor.ts`. Task `0006` deliberately narrowed `doctor`'s surface, and a model-observability flag there would add no pre-run decision the human acts on.
- Widening the Cursor denylist beyond the one token named in D3. `update`, `create-chat`, `ls`, `resume`, `generate-rule`, `agent`, and `bedrock` sub-behaviours are observed but not touched here.
- Adding model fields to `EventDocument` / `serializeEvent`.
- Switching the Cursor adapter to `--output-format stream-json` to reach a model field. That format also reports `apiKeySource`, which the authentication boundary forbids inspecting, and its `model` value is a display name D1's charset cannot equal (D4).

## Constraints

- The Bridge never authenticates and never inspects account, subscription, or billing state. A change that reads what an account is entitled to is out of bounds regardless of convenience.
- Process spawning stays argument-array based with no shell interpolation.
- The reviewer stays technically read-only; the region write stays confined to the owned `<!-- spartan-bridge:review:* -->` region and within `REGION_BYTE_CAP` (16 KiB).
- Ambiguous authority and unsupported configuration fail closed.
- No credential, token, account identifier, or auth path enters inputs, argv, state, fixtures, or logs. A model identifier is a product name, not account material.

## Acceptance Criteria

- [x] `AGENTS.md` declares a model and an effort value for every binding, and `parseAgentsPolicy` accepts exactly the five-column table and fails closed on any other width.
- [x] `--model` is absent from `CURSOR_FORBIDDEN_ARGV_TOKENS`, `about` is present, and every other token in that list is unchanged.
- [x] The Cursor adapter passes `--model <value>` on every review spawn, built only from validated pieces, with no code path that omits it or substitutes a default.
- [x] The four-step guarantee is implemented: declare, pass, read back, compare; a mismatch is terminal and writes no task region; a null observation records `model_observed=declared_unobserved`.
- [x] `CursorAdapter.observedModel()` returns `null` on every path, `cursorCapabilities()` reports `observes_model: false`, and a Cursor run records `declared_unobserved`. No code path reads the model back from argv, from `AdapterReviewInput`, from the review result, or from `stream-json`.
- [x] `model_observed` is a closed `"observed" | "declared_unobserved"`, identical in the provenance line and in `status.json`, written only by the compare step; no code path assigns it a model identifier or a copy of `model`.
- [x] `tests/review.test.ts` covers all three compare outcomes through the fake adapter's configurable observation.
- [x] `renderBridgeRunLine` emits `model`, `effort`, and `model_observed`, the region is still replaced in full, and an over-cap region still returns `null`.
- [x] `status.json` carries `host`, `client_context`, `model`, `effort`, and `model_observed`; the first four hold declared values from `policy_resolved` onward and survive an `adapter_error` terminal, and `model_observed` is null until compare and stays null when compare never runs.
- [x] `npm run typecheck` and `npm test` both exit 0.

## Decisions

### D1 - The declaration lives in the committed `AGENTS.md`, as two columns

The host-binding table becomes `Binding | Host | Client context | Model | Effort`. Bindings are already per-role, so a different model for plan review and for implementation review falls out with no new concept.

Trade-off, recorded because it is the whole point of the feature: the committed file is auditable from the repository, which is exactly why the model is being recorded at all; the user-local registry at `~/.config/spartan-bridge/client-contexts.yaml` is invisible to any reviewer, its schema is deliberately closed to `{launcher}`, and it is guarded by a sensitive-key scanner. Putting the declaration there would make the declaration itself unverifiable and would reintroduce the problem one layer down. The cost is that a model name appears in a public file. A model name identifies a product, not an account, a plan, or a credential, so the cost is accepted.

The prompt's "fourth column, plus an optional effort level" is realised as a required fourth column and a required-cell fifth column whose vocabulary contains an explicit `none`. Effort is optional *by nature*: some models expose no effort selector at all. An empty cell cannot distinguish "this model has no selectable effort" from "the author forgot", and that ambiguity is the same silence this task exists to remove. So the accepted effort vocabulary is `low | medium | high | max | none`, where `none` is the positive, legitimate recording of "no selectable effort" — the value the current Cursor binding uses, since Composer 2.5 exposes no effort selector.

Table width is closed: `parseAgentsPolicy` accepts exactly five columns and returns `agents_policy_invalid` for three or four. A tolerated three-column table would silently reproduce today's unverifiable state, so there is no legacy-width fallback. This is a breaking policy-format change: the `AGENTS.md` edit and the parser change must land in the same commit.

Validation at parse time, applied to the declared model identifier:

- charset `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`.
- Injection is not the risk — the spawn already uses argument arrays with no shell. The risk is a value beginning with `-` being read as another flag, so the first character must be alphanumeric.
- `[`, `]`, `=`, `,`, `:`, whitespace, and `/` are excluded deliberately (see D5: bracket syntax is composed by the adapter, never authored in the policy file).
- Effort must be exactly one of the five vocabulary words.
- Any violation is `agents_policy_invalid`, which is already a `failed` terminal state.

### D2 - An unavailable declared model fails closed, with no fallback path in code

There is no code path that omits `--model`, retries without it, or substitutes the client's own default. The silence of a default is precisely what would destroy auditability, so the absence of that path is the guarantee.

If the account cannot run the declared model the client exits non-zero, which maps to the existing terminal `failed` / `adapter_error`. This is the one place a plan reviewer may reasonably push back, so the reasoning is stated rather than assumed: a dedicated `model_unavailable` reason code would require classifying vendor error text, which is unversioned, may change without notice, and is indistinguishable from other non-zero exits. A brittle classifier that mislabels an unrelated failure as "model unavailable" is worse for an audit than an honest generic reason paired with an explicit declared value. Mismatch, which *is* reliably detectable, does get its own code (D4).

**What substitutes for the missing reason code, stated precisely.** The generic `adapter_error` is only honest if the failed run's own record still names the model that was requested. That is a timing requirement on `status.json`, not a grouping of new fields, so D6 pins it: `model` and `effort` hold the declared values from `policy_resolved` onward and are never cleared by a later transition, so an `adapter_error` terminal status reads `model=<declared> effort=<declared> reason_code=adapter_error`. `model_observed` is null on that record, because compare never ran. A reader therefore sees "this model was requested and the run never got far enough to observe anything", which is the fact the discarded reason code would have asserted, without a classifier standing behind it.

### D3 - The denylist split

**The boundary, in one sentence: you may say which model you want; you may not ask which models the account is entitled to.**

Exactly one token leaves `CURSOR_FORBIDDEN_ARGV_TOKENS`: `--model`. Exactly one token joins it: `about`.

Why the original prohibition existed. The list was written as a single blanket "nothing that touches provider or account selection", and it mixed three different natures under one heading:

1. credential and endpoint control — `--api-key`, `--endpoint`, `--header`, `-H`;
2. account and subscription inspection — `--list-models`, `models`, `whoami`, `status`, `login`, `logout`;
3. safety and isolation bypass — `--yolo`, `--force`, `-f`, `--auto-review`, `--approve-mcps`, `--resume`, `--continue`, `-w`, `--worktree`, `--worktree-base`, `--add-dir`, `--plugin-dir`, `mcp`, `plugin`, `worker`, `bedrock`, the shell-integration commands, `disabled`.

`--model` was swept in beside `--list-models` and `models` because they look alike. They are not alike. The installed client's own help text is the evidence: `--model <model>` is "Model to use"; `--list-models` is "List available models and exit"; the `models` command is "List available models **for this account**". The first writes a preference into the request. The other two read the account's entitlements back out.

Why the split preserves the prohibition. All three natures above stay forbidden and are untouched by this change. `--model <id>` reads nothing and enumerates nothing: it states a preference, and if the account cannot run it the client errors. The only information that returns is "this request failed", which is already observable from any failed spawn and is not an enumeration. The authentication boundary in `AGENTS.md` forbids inspecting authentication, account identity, subscription, or billing; stating a preference inspects none of them.

Why `about` joins. The same help text documents `about` as "Display version, system, and **account information**". It is nature 2 and was simply missed. Correcting the boundary in the same change that relaxes it is the honest edit; leaving a known account-information command out of the list while arguing the list is principled would not be.

Value validation at the adapter, as defence in depth: the adapter re-applies the D1 charset to the model identifier and re-checks the effort vocabulary before building argv, and refuses to spawn on failure. The policy parser already rejected these values, so a second failure means the value was mutated in transit; the adapter does not attempt to repair it.

### D4 - The guarantee, which is not the declaration

Four steps, each with a named location:

1. **Declare** — `parseAgentsPolicy` returns `model` and `effort`; they enter `ResolvedPolicy` and therefore `canonicalPolicyJson`, so the policy digest binds the declaration. The existing mid-run digest recheck in `runReview` already turns a policy change under the run into `integrity_mismatch`.
2. **Pass explicitly** — `AdapterReviewInput` carries `model` and `effort`; the Cursor adapter translates them into argv (D5). No default path exists.
3. **Read back** — the adapter reports what the *client* said about the model it ran, exposed on the `Adapter` type as `observedModel(): string | null` and populated during `collect()`. An adapter may return a non-null value only from a field it has verified the installed client actually emits on the output format the adapter already consumes. Where no such field exists, the honest return is `null`.
4. **Compare** — when the observation is non-null, normalise both sides by trimming and lowercasing, then compare for equality. No prefix, substring, or fuzzy matching: a near-match is a mismatch.

**Cursor observes nothing, and that is the recorded answer.** The client is spawned with `--output-format json`, whose documented success object is `type`, `subtype`, `is_error`, `duration_ms`, `duration_api_ms`, `result`, `session_id`, `request_id`. There is no model key on it, and the in-repo stub emits `{ result: ... }` alone. So `CursorAdapter.observedModel()` returns `null` unconditionally, `cursorCapabilities()` declares `observes_model: false`, and every Cursor run records `model_observed = declared_unobserved`. This is the finding's second option taken deliberately: an honest permanent gap on this adapter is the correct record, and the earlier "outer JSON envelope" wording named a source that does not exist.

Four sources are closed off by rule, not by preference:

- **Argv, or anything derived from `AdapterReviewInput`.** Reading back what the Bridge itself just passed is recording declared as observed with extra steps. It is the exact failure this decision exists to prevent.
- **The reviewer's prose, or the review result.** `RESULT_KEYS` in `src/core/result.ts` stays closed at five keys. A model field the reviewed model wrote about itself is self-description, not provenance.
- **The `stream-json` `system/init` event.** Out of scope for this task on two independent grounds. That format also reports `apiKeySource`, which is authentication-source metadata the `AGENTS.md` boundary forbids inspecting; and its `model` field is a spaced display name, which D1's charset can never equal and step 4 forbids fuzzy-matching into equality.
- **A default or inferred value of any kind.** Absent is `null`, and `null` maps to `declared_unobserved`.

Three outcomes:

- **Non-null and equal** → `model_observed = "observed"`. The recorded model is audit-grade.
- **Non-null and different** → fail closed. Terminal state `failed`, new reason code `model_mismatch`, `model_observed` left null, no task-artifact region written, no `task_artifact_written` event, no `review_result_accepted` event. This sits beside `integrity_mismatch` in kind: the run did not do what the policy said it would, so it yields no verdict at all. The compare therefore runs in `runReview` immediately after the existing task/agents/policy-digest integrity recheck and before `validateReviewResult`, which is where its sibling check already lives.
- **Null** → `model_observed = "declared_unobserved"`. The run continues to its normal verdict, and the record states that the model was declared but not observed. A declared value must never occupy a slot that reads as observed; that would be a claim the Bridge cannot support, and a false provenance record is worse than an honest gap.

**The vocabulary is closed and is the same in both artifacts.** `ModelObserved = "observed" | "declared_unobserved"` in `src/core/contracts.ts`, used verbatim by `renderBridgeRunLine` and by `status.json`. Three rules follow and are worth asserting in tests, because each is a way the invariant could be lost:

- `model_observed` is only ever assigned one of those two literals. It never holds a model identifier, and no code path copies `model` into it.
- Only the compare step writes it. Nothing earlier in the run sets it, and `status.json` carries `null` until compare completes (D6).
- The declared identifier lives in `model` and nowhere else.

`renderBridgeRunLine` only renders on a path that writes the region, which a mismatch never reaches, so the provenance line always shows one of the two literals and never a null. `status.json` additionally has the `null` state, which means "compare did not run" — the state that carries D2's failed-spawn record.

**Cursor cannot exercise the observed or mismatch branch, so the fake adapter does.** `AGENTS.md` already directs the repository to "prefer deterministic fake adapters for core tests before enabling real provider adapters", which is exactly this situation: the compare is core behaviour in `src/core/review.ts` reached through the `Adapter` seam, and the fake is how core behaviour is tested before a real adapter supports it. `FakeAdapter` therefore takes a configurable observation (default `null`, capability `observes_model` following it), and `tests/review.test.ts` covers all three outcomes. The Cursor tests assert the opposite and equally important fact: `observedModel()` is null on every path, and the run records `declared_unobserved`.

The provenance line in `renderBridgeRunLine` gains three fields, placed after `launcher`:

```
Bridge run: run_id=… execution_id=… review_kind=… verdict=… reason_code=… host=… launcher=… model=… effort=… model_observed=observed|declared_unobserved policy_digest=… task_hash=… agents_hash=… timestamp=…
```

The region is still rendered and replaced in full, and `renderRegion` still returns `null` when the result exceeds `REGION_BYTE_CAP`. The addition is roughly 60 bytes against a 16 KiB cap, so the cap is not raised. `TaskWriteMeta` gains `model`, `effort`, and `model_observed`; `renderRegion`'s forbidden-token check is unchanged because these values come from a validated closed charset and vocabulary, not from reviewer text.

### D5 - Host neutrality: one policy field, per-adapter translation

The declaration is host-neutral: a model identifier and an effort level. How that becomes process arguments is the adapter's business, and each adapter separately decides whether it can observe the model. `AdapterCapabilities` gains `observes_model: boolean`, which is descriptive only — `capabilitiesAllowed` must not gate on it, because an adapter that cannot observe the model still produces a valid run whose record honestly says `declared_unobserved`.

**Cursor.** The installed client's help documents `--model <model>` and adds: "Parameterized models accept quoted bracket overrides, e.g. `claude-opus-4-8[context=1m,effort=high,fast=false]`". So on this client effort is expressed *inside* the model token, not as a separate flag. The adapter therefore composes the value: `<model>` when effort is `none`, and `<model>[effort=<level>]` otherwise. The bracket syntax is constructed by the adapter from two already-validated pieces and never authored in `AGENTS.md`, which is why the D1 charset can stay conservative and exclude brackets and `=` outright. The composed value cannot begin with `-`, because the first character of the model identifier must be alphanumeric. Argv becomes `[...CURSOR_REVIEW_ARGV_PREFIX, workspace, "--model", value, prompt]`, or equivalently a `--model value` pair inserted before `--workspace`; the flag token itself lives in a named constant so the existing "no constant argv table contains a forbidden token" test keeps passing by construction rather than by exemption.

If the bracket override is later found not to apply to the declared model, the run fails closed rather than running at the client's default effort: an effort the client silently ignored is the same unverifiable silence D2 rejects.

Cursor passes the model but observes nothing back, so its `observes_model` is `false` and its `observedModel()` returns `null` unconditionally (D4). The two halves are independent by design: this adapter demonstrates that declaring and passing a model is useful even where reading it back is impossible, because the record then says so in the one word `declared_unobserved` instead of staying silent.

**Codex.** The Codex adapter does not exist. Nothing in this task configures it; the Codex side is design, not configuration. Do not assume the Codex CLI selects a model the way the Cursor CLI does — in particular, do not assume the bracket-override syntax, do not assume effort travels inside the model token, and do not assume a model appears in its JSON envelope. When that adapter is built, its argument translation and its observation source must be verified against the installed client's own `--help`, exactly as the Cursor translation above was.

### D6 - `status.json` gains reviewer host and client-context alias: scoped IN

`status.json` currently carries no host and no client-context alias, so a dashboard cannot label an in-flight or failed run that never produced an accepted verdict. That is the same auditability gap this task exists to close, one artifact over, and both values are already resolved into `ResolvedPolicy` before the review starts. `personal` is an opaque client-context alias that `AGENTS.md` explicitly defines as not a credential, account ID, or email address, so recording it discloses nothing.

`StatusDocument` and `serializeStatus` gain `host`, `client_context`, `model`, `effort`, and `model_observed`, appended after `task_path` to keep the existing key-order assertions legible. `EventDocument` is deliberately not extended: events are the append-only stream, the status snapshot is what a dashboard reads, and every event already carries `policy_digest`, which pins the declaration that produced the run.

**The five fields do not share one timing, and grouping them was the defect.** They fall into two groups, because a declaration and an observation become known at different moments and one must not be readable as the other:

| Fields | Null until | Written at | Afterwards |
|---|---|---|---|
| `host`, `client_context`, `model`, `effort` | the `policy_resolved` emit | `policy_resolved`, from `ResolvedPolicy` | never cleared or overwritten; survive every later transition, including `adapter_error`, `model_mismatch`, and `integrity_mismatch` |
| `model_observed` | the compare step | compare, and only there | `"observed"`, `"declared_unobserved"`, or still null if compare never ran |

This is what D2 depends on. A run whose spawn fails because the account cannot run the declared model terminates at `adapter_error` with `model` and `effort` already populated and `model_observed` still null. The declared value is on the record; nothing on the record claims it was observed.

The existing `emit` merge in `src/core/review.ts` already gives the first group its behaviour: `policy_digest` uses a sticky `??` merge and is therefore carried forward from `policy_resolved` through every later emit without any `terminate()` call site re-passing it. The four declaration fields join that same sticky set, so no `terminate()` signature grows. `model_observed` is passed once, by the compare step.

Three timings and three values would be a state machine if they were free-form. They are not: `model_observed`'s two literals come from D4's closed vocabulary, and `null` is the absence of a write rather than a third value the code chooses between.

### D7 - Coordination facts

**`src/core/task-write.ts` is shared with the verdict-vocabulary adoption work.** That work changes the verdict line inside `renderRegion` (`Verdict: APPROVE` / `CHANGES` → `APPROVED` / `CHANGES_REQUESTED`); this task changes `renderBridgeRunLine` and `TaskWriteMeta`. Different functions in the same file, low conflict risk — but whichever lands second rebases.

**The verdict-vocabulary work should go first.** It is the smaller change, it touches no policy parser and no security boundary, and it alters the same rendered region this task extends. Landing it first means this task rebases onto the settled verdict spelling once, and this task's new region assertions are written against final text. In the other order, a vocabulary rename would have to update assertions this task had just introduced, and the higher-risk change would be reviewed against region text that was already known to be about to change.

**The repository now has a first commit** (`6de9165`, with `75ce1f7` on top). The implementation round's reviewer can and should verify scope with `git diff` rather than by exact-string archaeology. This matters most for the denylist: a removal from a list leaves no trace in the list's final state, so reading the finished `CURSOR_FORBIDDEN_ARGV_TOKENS` can never show that exactly one token left it. The concrete check is `git diff -- src/adapters/cursor.ts`, which must show exactly one deleted line (`"--model",`) and exactly one added line (`"about",`) inside that array, and no other deletion from it.

## Work Completed

- Planner (Claude Code, Claude Opus 5, Anthropic): recorded D1–D7.
- Reviewer (HX-001, Cursor, Grok 4.6, no user-selectable effort): `CHANGES_REQUESTED` on D4 observation source and D2/D6 status timing.
- Planner (HX-002, Claude Code, Claude Opus 5, Anthropic): closed those findings in D2, D4, D5, and D6. No product file changed.
- Reviewer (HX-003, Cursor, Grok 4.6, no user-selectable effort): `APPROVED`.
- Implementer (HX-004, Cursor, Grok 4.6, no user-selectable effort): accepted matching envelope HX-004. Implemented D1–D7 in the named scope: five-column `AGENTS.md` parser and table, denylist split, Cursor `--model` argv composition, `observedModel()` seam, compare in `runReview`, sticky `status.json` declaration fields, provenance line, fake-adapter observation, and docs D-016.

## Evidence

- Implementer `npm run typecheck`: exit 0.
- Implementer `npm test`: exit 0, 89 passed, 0 failed.
- `git diff -- src/adapters/cursor.ts` inside `CURSOR_FORBIDDEN_ARGV_TOKENS`: exactly one deleted line (`"--model",`) and exactly one added line (`"about",`); no other deletion from that array.
- Cursor review argv is `[...CURSOR_REVIEW_ARGV_PREFIX, workspace, "--model", composed, prompt]`. Effort `none` passes the bare identifier; any other effort composes `<model>[effort=<level>]`.
- `CursorAdapter.observedModel()` returns `null`; `cursorCapabilities().observes_model` is `false`; Cursor runs record `model_observed=declared_unobserved`. Fake adapter covers observed, mismatch (`model_mismatch`, no region write), and `declared_unobserved`.
- `status.json` key order after `task_path` is `host`, `client_context`, `model`, `effort`, `model_observed`. Declaration fields survive `adapter_error`; `model_observed` stays null when compare never runs.
- Phase 1A `parseTaskFrontmatter` still admits only `phase: planning` and `task_type: planning`. This artifact now records the implementation round, so that parser rejects it by that pre-existing closed grammar.

## Review

Plan review verdict: APPROVED (HX-003, Cursor, Grok 4.6, no user-selectable effort).

Implementation review verdict: APPROVED (HX-005, Claude Code, Claude Opus 5, high effort, Anthropic — a different vendor from the Cursor/Grok implementing round). Accepted matching envelope HX-005. Product files read-only; only this artifact was written.

Verified against the acceptance criteria:

- The denylist split is exactly as D3 specifies, and this is the one criterion that only a diff can establish. `git diff -- src/adapters/cursor.ts` shows exactly one deletion inside `CURSOR_FORBIDDEN_ARGV_TOKENS` (`"--model",`) and one addition (`"about",`); the other two deletions in that file are `void input;` and the old `args:` line, both outside the array. The remaining 29 tokens are present and unreordered, so all three forbidden natures — credential and endpoint control, account and subscription inspection, safety and isolation bypass — are intact.
- Five-column admission is closed: `agents-policy.ts` rejects any width other than five and any header other than `Binding`, `Host`, `Client context`, `Model`, `Effort`, per-row as well as per-header, returning `agents_policy_invalid`.
- The compare sits where D4 requires: immediately after the integrity recheck and before `validateReviewResult`. A mismatch terminates `failed` / `model_mismatch` and passes no region, so no task-artifact write occurs. `model_observed` is assigned only there.
- The vocabulary is closed: `ModelObserved = "observed" | "declared_unobserved"`, with `| null` only on the status document, which is the "compare did not run" state D2 depends on.
- `CursorAdapter.observedModel()` returns `null` unconditionally and `observes_model` is `false`, so a Cursor run records `declared_unobserved` rather than presenting a declared value as observed.
- The provenance line carries `model`, `effort`, and `model_observed` positioned after `launcher`, and `status.json` carries the five fields.
- `npm run typecheck` clean; `npm test` 89 pass, 0 fail.

Findings:

- `F1` (process, not code, and not the implementer's doing): task `0010`'s implementation was never committed. `HEAD` is `bbd5a51`, the plan commit, so `0010`'s code changes and this task's changes sit commingled in one working tree, and `0010`'s own artifact is uncommitted at 88 insertions and 39 deletions. D7 asked the reviewer to verify scope with `git diff`; for `src/core/task-write.ts`, `src/policy/task-frontmatter.ts`, `tests/helpers.ts`, `tests/review.test.ts`, `tests/task-write.test.ts`, and `tests/frontmatter.test.ts` that diff is a blend of two tasks and cannot attribute a line to either. It did not block the security-critical check, because `0010` never touched `src/adapters/cursor.ts` and that diff is clean. The repair is a commit split, not a code change, and it should happen before another round layers a third task onto the same tree.
- `F2` (info, carried over): `PROTOCOL_VERSION` remains referenced by no source file and unexported from `src/index.ts` after `0010`. Adjacent to this task rather than caused by it; a later round touching `contracts.ts` should either re-export it or drop it.

## Blockers

None.

## Next Action

None. Every acceptance criterion is checked, `npm run typecheck` and `npm test` have recorded
outcomes, the plan review and the implementation review are both `APPROVED`, and no blocker
remains. Committing is the human-only gate in `AGENTS.md` and was never in this task's scope.

## Next Handoff

No outstanding proposal. This task is closed.

Non-binding note for the human, carrying finding `F1` rather than proposing a round: the
approved work of this task and of task `0010` sit uncommitted in one working tree, and a
per-task commit split is no longer available. Both tasks edited `src/core/task-write.ts`,
`tests/helpers.ts`, `tests/review.test.ts`, and `tests/task-write.test.ts`, so no file holds
only one task's change and a path-scoped commit cannot separate them. Hunk-level staging
could, but the changes interleave and the operation is interactive, which is a poor trade
against the benefit.

The honest close is one commit naming both tasks. Per-task attribution in git history is
lost for this pair; the two artifacts remain the record of what each task decided and
changed, which is the property the protocol actually relies on. The lesson worth carrying is
the sequencing one: commit an approved task before starting the next round, or the baseline
that task `0007` established stops being able to attribute a line to a task.
