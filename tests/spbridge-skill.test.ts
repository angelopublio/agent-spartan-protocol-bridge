import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("spbridge skill authorizes the loop and names after-run and stop conditions", async () => {
  const skill = await fs.readFile(new URL("../agent-skill/skills/spbridge/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /--after-run/);
  assert.match(skill, /reason_code` is `review_changes_requested/);
  assert.match(skill, /review_kind` is `plan`/);
  assert.match(skill, /Do not continue with `--after-run` for implementation-review findings/);
  assert.match(skill, /review_chain\.cycle < review_chain\.max_cycles/);
  assert.match(skill, /review_chain` that is `null` is a stop/);
  assert.match(skill, /cycle == max_cycles` is a stop/);
  assert.match(skill, /cycle_limit_reached/);
  assert.match(skill, /review_passed/);
  assert.match(skill, /chain_refused/);
  assert.match(skill, /does not invoke the runtime/);
  assert.match(skill, /Only a stopping outer loop prints/);
  assert.match(skill, /producer round that returns into\nthe loop sets `next_role: reviewer`/);
  assert.match(skill, /transition_next_role_not_reviewer/);
  assert.doesNotMatch(skill, /Do not start a second `\/spartan` round/);
  assert.doesNotMatch(skill, /Do not add other flags/);
  assert.doesNotMatch(skill, /Invoke exactly once\. Do not retry/);
  assert.doesNotMatch(skill, /Invoke the installed runtime once/);
  assert.doesNotMatch(skill, /Do not start `\/spartan` again/);
  assert.doesNotMatch(skill, /invoke once and report what comes back/i);
  assert.doesNotMatch(skill, /\bcycle [0-9]+\b/);
});

test("spbridge skill states entry conditions and the review_passed print", async () => {
  const skill = await fs.readFile(new URL("../agent-skill/skills/spbridge/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /repository declares the Bridge/);
  assert.match(skill, /runtime is installed on the machine\nrunning the round/);
  assert.match(skill, /`spartan-bridge doctor` reports a working adapter for\nthe reviewer that round will dispatch/);
  assert.match(skill, /planner round and an implementer round whose review the Bridge\ndispatches are both entered through this skill/);
  assert.match(skill, /task_type: implementation/, "artifact state");
  assert.match(skill, /phase: reviewing/);
  assert.match(skill, /current_role: implementer/);
  assert.match(skill, /next_role: reviewer/);
  assert.match(skill, /runtime may start `reviewer\.implementation`/);
  assert.match(skill, /This skill never spawns Cursor/);
  assert.doesNotMatch(skill, /The Bridge still does not\nstart an implementer round by itself/);
  assert.doesNotMatch(skill, /Bridge dispatches plan review only/);
  assert.doesNotMatch(skill, /implementer round is not entered through this skill/);
  assert.match(skill, /Do not inspect task frontmatter, `AGENTS\.md`, or a binding table to decide\n  whether to invoke/);
  assert.match(skill, /After a recorded verdict, those files may be read to\n  name the round that follows/);
  assert.match(skill, /`\/spartan` for Claude Code and for Cursor, `\$spartan` for Codex/);
  assert.match(skill, /Act as <artifact next_role>/);
  assert.match(skill, /Do not write it to the artifact/);
});

test("spbridge skill routes review_passed through the closed next-entrypoint matrix", async () => {
  const skill = await fs.readFile(new URL("../agent-skill/skills/spbridge/SKILL.md", import.meta.url), "utf8");
  const header = "| Recorded next state | Capability evidence | Recommendation |";
  const start = skill.indexOf(header);
  assert.ok(start >= 0, "routing matrix table");
  const rows = skill
    .slice(start)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"))
    .slice(2, 11)
    .map((line) =>
      line
        .split("|")
        .slice(1, 4)
        .map((cell) => cell.trim()),
    );
  assert.deepEqual(rows, [
    [
      "`next_role: implementer` with an `implementer` binding",
      "`doctor` reports `adapter available` for `reviewer.implementation`",
      "Open the `implementer` binding's host with `/spbridge` in a fresh session",
    ],
    [
      "`next_role: implementer` with an `implementer` binding",
      "That exact `doctor` result is unavailable, missing, or unreadable",
      "Open the `implementer` binding's host with its Spartan token and state that the later implementation review is manual",
    ],
    [
      "`next_role: implementer` without an `implementer` binding",
      "No producer host can be selected without inference",
      "Report the missing binding and print no agent invocation",
    ],
    [
      "`next_role: planner` with a `planner` binding",
      "`doctor` reports `adapter available` for `reviewer.plan`",
      "Open the `planner` binding's host with `/spbridge` in a fresh session",
    ],
    [
      "`next_role: planner` with a `planner` binding",
      "That exact `doctor` result is unavailable, missing, or unreadable",
      "Open the `planner` binding's host with its Spartan token and state that the later plan review is manual",
    ],
    [
      "`next_role: planner` without a `planner` binding",
      "No producer host can be selected without inference",
      "Report the missing binding and print no agent invocation",
    ],
    [
      "`next_role: human-operator`, `next_role: none`, or no readable next role",
      "No agent binding is applicable",
      "Report the terminal/human outcome and print no agent invocation",
    ],
    [
      "Any other readable next role with an `AGENTS.md` binding",
      "The role is neither a Bridge-backed producer case nor a terminal/human state",
      "Open that binding's host with its Spartan token and identify the round as manual",
    ],
    [
      "Any other readable next role without an `AGENTS.md` binding",
      "No host can be selected without inference",
      "Report the missing binding and print no agent invocation",
    ],
  ]);
  assert.match(skill, /The matrix replaces, rather than supplements, the universal/);
  assert.doesNotMatch(skill, /Print that role, that host, and that\n  host's invocation token from the mapping below/);
  assert.match(skill, /Print no implementer recommendation/);
  assert.match(skill, /The[\s\S]*runtime already started or stopped the producer/);
  assert.match(skill, /fresh producer phase starts a new review chain\n  and therefore carries no `--after-run`/);
  assert.match(skill, /When that role is planner or\n  implementer, also run `spartan-bridge doctor --repo <workspace-root>`/);
  assert.match(skill, /never carries `--after-run`/);
  assert.match(skill, /Missing or\n  unreadable `doctor` output takes the manual fallback/);
  assert.match(skill, /Do not reconstruct the registry join/);
  assert.doesNotMatch(skill, /spartan-bridge doctor --repo <workspace-root> --after-run/);
  assert.match(skill, /reason_code` is `review_changes_requested/);
  assert.match(skill, /review_chain\.cycle < review_chain\.max_cycles/);
});

test("spbridge skill announces the task path, handoff and role before any command", async () => {
  const skill = await fs.readFile(new URL("../agent-skill/skills/spbridge/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /Round: spartan\/tasks\/NNNN-slug\.md — handoff HX-00N — acting as <role>/);
  assert.match(skill, /before running `doctor` or any other command, print one line/);
  assert.match(skill, /handoff none stated` or `role none stated/);
  assert.match(skill, /\[Pasted text #3 \+16 lines\]/);
  const announce = skill.indexOf("Round: spartan/tasks/NNNN-slug.md");
  const doctorStep = skill.indexOf("### 2. Check the reviewer binding");
  assert.ok(announce > 0 && announce < doctorStep, "the announcement must sit in step 1, before the doctor step");
});

test("spbridge skill recovers producer_declaration_invalid in a fresh implementer session", async () => {
  const skill = await fs.readFile(new URL("../agent-skill/skills/spbridge/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /Quote `declaration_invalid_detail` when that\n  field is a non-null string/);
  assert.match(skill, /Quote `unwritable_plan_targets` when that field is a\n  non-null array/);
  assert.match(
    skill,
    /Those tokens are an advisory that the approved plan mentioned\n  paths outside the automatic write scope; they are not a stop and do not replace\n  `state` or `reason_code`/,
  );
  assert.match(skill, /`producer_declaration_invalid` on a terminal transition document: a recoverable\n  producer-round failure/);
  assert.match(skill, /Print a `\/spbridge` invocation\n  on the same explicit task path for a fresh implementer session; never\n  `--after-run`/);
  assert.match(skill, /exception to the generic transition-document row\n  that prints no implementer recommendation/);
});

test("spbridge skill defers the stale-build refusal to the runtime", async () => {
  const skill = await fs.readFile(new URL("../agent-skill/skills/spbridge/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /Perform no comparison of `src\/` against `dist\/`/);
  assert.match(skill, /runtime refuses/);
  assert.doesNotMatch(skill, /If any file under `src\/` is newer than `dist\/cli\/main\.js`/);
  assert.doesNotMatch(skill, /step 3 did not stop/);
});

test("spbridge skill obtains parent-host permission before every review spawn", async () => {
  const skill = await fs.readFile(new URL("../agent-skill/skills/spbridge/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /Before \*\*every\*\* runtime spawn/);
  assert.match(skill, /initial review, every\n`--after-run` continuation/);
  assert.match(skill, /`spartan-bridge` executable on `PATH`/);
  assert.match(skill, /`node dist\/cli\/main\.js` fallback/);
  assert.doesNotMatch(skill, /exit 126|permission denied.*wait|wait dies with 126/i);
  assert.match(skill, /complete command process tree/);
  assert.match(skill, /machine-local session state or\nusing the network/);
  assert.match(skill, /request escalated sandbox permission on the shell invocation itself/);
  assert.match(skill, /stop before the CLI starts/);
  assert.match(skill, /No run was\ncreated, no cycle was spent/);
  assert.match(skill, /Do not retry the denied spawn automatically/);
  assert.doesNotMatch(skill, /\.agent-profiles|cursor-home|auth\.json/);
});

test("D5: spbridge skill states the double-fence and placeholder-or-region producer shape rules", async () => {
  const skill = await fs.readFile(new URL("../agent-skill/skills/spbridge/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /advisory block and the\n  prompt block \*\*each in its own ` ```text ` fence\*\*/);
  assert.match(skill, /an unfenced advisory\n  makes the consumed handoff unretractable and the whole write is refused/);
  assert.match(skill, /`## Review` is either the exact `Verdict: PENDING` \/ `Findings:` \//);
  assert.match(skill, /`- None recorded\.` placeholder or an existing marked region/);
  assert.match(skill, /Longer template placeholder text is refused the same way/);
});

test("D5: a double-fenced Next Handoff satisfies the shape gate and an unfenced advisory does not", async () => {
  const { checkArtifactWriteShape } = await import("../src/core/task-write.ts");
  const { validTaskMd, DEFAULT_REVIEW_SECTION } = await import("./helpers.ts");
  const doubleFenced = `## Next Handoff

\`\`\`text
Recommended execution (human decides):
- Role: reviewer
- Handoff: HX-009
\`\`\`

\`\`\`text
Open \`spartan/tasks/0001-bootstrap-fixture.md\`. (handoff HX-009)

Act as reviewer.
\`\`\``;
  const unfenced = `## Next Handoff

Recommended execution (human decides):
- Role: reviewer
- Handoff: HX-009

\`\`\`text
Open \`spartan/tasks/0001-bootstrap-fixture.md\`. (handoff HX-009)

Act as reviewer.
\`\`\``;
  const build = (handoff: string): string =>
    validTaskMd({ nextHandoffId: "HX-009", reviewSection: `\n${DEFAULT_REVIEW_SECTION}\n${handoff}` });
  assert.deepEqual(checkArtifactWriteShape(build(doubleFenced), "plan"), { ok: true });
  assert.deepEqual(checkArtifactWriteShape(build(unfenced), "plan"), {
    ok: false,
    cause: "composition_failed",
    detail: "next_handoff_not_retractable",
  });
});

test("D4: adapter_error reports closed scalars and recommends /spbridge only for a signalled empty capture", async () => {
  const skill = await fs.readFile(new URL("../agent-skill/skills/spbridge/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /When `reason_code` is `adapter_error` or `adapter_timeout` and\n`adapter_failure` is non-null/);
  assert.match(skill, /also name `adapter_failure\.cause`/);
  assert.match(skill, /`http_status` when it is a non-null integer/);
  assert.match(skill, /`signal` when it is a\nnon-null string/);
  assert.match(skill, /whether `output_excerpt` is null, and whether\n`payload_log` is null/);
  assert.match(skill, /Do not quote `output_excerpt` text or payload-log\ncontents/);
  assert.match(skill, /Do not remap the cause/);
  assert.match(skill, /`cause` is `provider_unavailable` or `provider_limit`/);
  assert.match(skill, /Print no start\. Provider-side; the operator retries when the provider recovers\./);
  assert.match(skill, /`payload_log` is non-null/);
  assert.match(skill, /Read `status\.json` \/ `adapter-payload\.log` before any re-run/);
  assert.match(skill, /`output_excerpt` is non-null and cause is not a provider_\* value/);
  assert.match(
    skill,
    /`output_excerpt` is null and `payload_log` is null and `signal` is non-null/,
  );
  assert.match(skill, /`\/spbridge` once on the same task path, no `--after-run` \(infra flake\)/);
  assert.match(
    skill,
    /`output_excerpt` is null and `payload_log` is null and `signal` is null/,
  );
  assert.match(skill, /Print no start\. Unknown; do not assume a flake\./);
  assert.match(skill, /Do not auto-retry/);
  const providerRow = skill.indexOf("`cause` is `provider_unavailable` or `provider_limit`");
  const payloadRow = skill.indexOf("| `payload_log` is non-null");
  const excerptRow = skill.indexOf("| `output_excerpt` is non-null and cause is not a provider_");
  const flakeRow = skill.indexOf("`output_excerpt` is null and `payload_log` is null and `signal` is non-null");
  const unknownRow = skill.indexOf("`output_excerpt` is null and `payload_log` is null and `signal` is null");
  assert.ok(
    providerRow > 0 &&
      payloadRow > providerRow &&
      excerptRow > payloadRow &&
      flakeRow > excerptRow &&
      unknownRow > flakeRow,
    "D4 table order",
  );
});

test("D6.1: spbridge skill runs doctor before the producer round and stops on reviewer_output_unconstrained", async () => {
  const skill = await fs.readFile(new URL("../agent-skill/skills/spbridge/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /Before any producer work, run `spartan-bridge doctor --repo <workspace-root>`/);
  assert.match(skill, /`reviewer\.plan` for a plan artifact, `reviewer\.implementation` for an\nimplementation artifact/);
  assert.match(skill, /If that line reports\n`reviewer_output_unconstrained`, stop here — run no producer round/);
  assert.match(skill, /rebind `reviewer\.<kind>` in `AGENTS\.md` to Codex,\nGrok, or Claude Code and then re-run `\/spbridge`/);
  assert.match(skill, /The exceptions before a verdict are the single\n  `spartan-bridge doctor` binding line step 2 reads/);
});

test("D3 D4 D6: spbridge skill checks producer model binding after doctor and before /spartan", async () => {
  const skill = await fs.readFile(new URL("../agent-skill/skills/spbridge/SKILL.md", import.meta.url), "utf8");
  const doctorStop = skill.indexOf("If that line reports\n`reviewer_output_unconstrained`, stop here — run no producer round");
  const policyHelper = skill.indexOf("`spartan-bridge policy --repo <workspace-root> --role <that-role>`");
  const spartanFollow = skill.indexOf("Follow the installed Spartan skill for the pasted handoff, in this session.");
  assert.ok(doctorStop > 0 && policyHelper > doctorStop && spartanFollow > policyHelper, "helper after doctor stop, before /spartan");
  assert.match(skill, /Take\n`--role` from the paste \(step 1\), not from frontmatter or `AGENTS\.md`/);
  assert.match(skill, /If\nthat role is not `planner` or `implementer`, skip this helper/);
  assert.match(skill, /`model_binding_mode` `advisory`: do not compare/);
  assert.match(skill, /compare the session model identifier this host has already exposed\nto `binding_model` with a case-insensitive trim/);
  assert.match(skill, /Do not compare\n`binding_effort` as a separate field/);
  assert.match(skill, /`MODEL_IDENTIFIER_RE` \(`\^\[A-Za-z0-9\]\[A-Za-z0-9\._-\]\{0,63\}\$`\)/);
  assert.match(skill, /proceed even if the mode is `strict`\. That `strict` case degrades to `warn`/);
  assert.match(skill, /When `binding_model` is `null` under `strict`, abort/);
  assert.match(
    skill,
    /When\n`binding_model` is `null` under `warn`, print one line that no bound model\nwas found and proceed/,
  );
  assert.match(
    skill,
    /These are the only `AGENTS\.md`\nfacts this skill reads before a verdict, and they come from `doctor` and\n`policy`, not from inspecting the binding table directly/,
  );
  assert.doesNotMatch(skill, /This is the one `AGENTS\.md`\nfact this skill reads before a verdict/);
  assert.match(skill, /exits non-zero or its stdout is not one JSON object/);
  assert.match(skill, /`warn` on a `binding_model` mismatch: print one line naming `binding_model`\nand `binding_effort`, then proceed/);
  assert.match(skill, /`strict` on a `binding_model` mismatch: stop the whole `\/spbridge`\ninvocation — no producer work, no review spawn/);
  assert.match(skill, /Tell the human to switch\nthe harness model to `binding_model`/);
  assert.match(skill, /When the paste role is `implementer`,\nalso name the Bridge-dispatched auto-chain successor as an alternative/);
  assert.match(skill, /Do not name auto-chain as a planner\nrecovery/);
  assert.match(skill, /This skill never\nswitches the model/);
  assert.match(skill, /It does not claim the Bridge\nverified the producer model/);
  assert.match(skill, /Do not re-run the step-2 model-binding\ncheck on this same-session continuation/);
  const step6 = skill.indexOf("### 6. Continue only from the status document");
  const recheck = skill.indexOf("Do not re-run the step-2 model-binding");
  assert.ok(step6 > 0 && recheck > step6, "step 6 does not re-check");
});

test("spbridge skill step 4 names the rebuild a finished chain leaves behind", async () => {
  const skill = await fs.readFile(new URL("../agent-skill/skills/spbridge/SKILL.md", import.meta.url), "utf8");
  // Task 0070 D4: the operator loop is where this defect is closed, so the
  // rule has to survive an edit to the skill, not only to the runtime.
  assert.match(skill, /the chain ran and left this checkout's\nruntime stale/);
  assert.match(skill, /Report `state` and `reason_code` exactly as step 5 requires/);
  assert.match(skill, /a non-terminal state there is the resume rule's business/);
  assert.match(skill, /run `npm run build` before the next `\/spbridge` round,\nwhich carries no `--after-run`/);
  assert.match(skill, /says nothing about whether that round succeeded/);
  // The claim the reviewer falsified: a dead child mid-round also prints a
  // terminal document that is neither `stale_build` nor empty.
  assert.doesNotMatch(skill, /the chain itself completed/);
});
