import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { PRODUCER_ISOLATED_WORKSPACE_ENV } from "../src/adapters/adapter.ts";
import {
  parseAgentsPolicy,
  type AgentsPolicyCheck,
  type AgentsPolicyReason,
  AUTOMATIC_CORRECTION_REVIEW_GRANT,
  AUTOMATIC_IMPLEMENTATION_GRANT,
  HUMAN_STARTS_PLANNER,
  IMPLEMENTATION_REVIEW_GRANT,
  IMPLEMENTATION_REVIEW_PROHIBITION,
  PRODUCER_ROLE_STOP_EXCEPTIONS,
  automaticImplementationAdmission,
  isAuthorityWritePath,
} from "../src/policy/agents-policy.ts";
import { validAgentsMd } from "./helpers.ts";

const IN_PRODUCER_WORKSPACE = process.env[PRODUCER_ISOLATED_WORKSPACE_ENV] === "1";

async function repositoryAgentsPolicy(): Promise<string> {
  return fs.readFile(new URL("../AGENTS.md", import.meta.url), "utf8");
}

test("pinned agent hosts table and automation literals authorize reviewer.plan", () => {
  const parsed = parseAgentsPolicy(validAgentsMd());
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.host, "cursor");
    assert.equal(parsed.client_context, "personal");
    assert.equal(parsed.model, "Composer-2.5");
    assert.equal(parsed.effort, "none");
    assert.equal(parsed.task_artifact_write_authorized, false);
    assert.equal(parsed.producer_chain_authorized, false);
    assert.equal(parsed.max_review_cycles, 3);
    assert.equal(parsed.implementation_review_authorized, false);
    assert.equal(parsed.implementation_review_scope, null);
    assert.equal(parsed.implementation_review_failure, "implementation_review_grant");
    assert.deepEqual(parsed.implementation, {
      host: "cursor",
      client_context: "personal",
      model: "Composer-2.5",
      effort: "none",
    });
    assert.deepEqual(parsed.implementer, {
      host: "cursor",
      client_context: "personal",
      model: "Composer-2.5",
      effort: "none",
    });
    assert.deepEqual(parsed.planner, {
      host: "codex",
      client_context: "personal",
      model: "gpt-5.6-terra",
      effort: "high",
    });
  }
});

test("parseAgentsPolicy captures a unique planner row and does not require it", () => {
  const captured = parseAgentsPolicy(validAgentsMd());
  assert.equal(captured.ok, true);
  if (captured.ok) {
    assert.deepEqual(captured.planner, {
      host: "codex",
      client_context: "personal",
      model: "gpt-5.6-terra",
      effort: "high",
    });
  }
  const absent = parseAgentsPolicy(`# X

## Agent hosts

| Binding | Host | Client context | Model | Effort |
| --- | --- | --- | --- | --- |
| reviewer.plan | Cursor | personal | Composer-2.5 | none |

## Spartan Bridge automation authority

- A human-started Spartan Bridge run may start the mapped reviewer automatically.
- The Bridge may return findings to the current planner session and repeat up to 3 plan-review cycles.
`);
  assert.equal(absent.ok, true);
  if (absent.ok) {
    assert.equal(absent.planner, null);
    assert.equal(absent.implementer, null);
  }
});

test("an unresolvable planner host fails parseAgentsPolicy the same way implementer does", () => {
  const markdown = `# X

## Agent hosts

| Binding | Host | Client context | Model | Effort |
| --- | --- | --- | --- | --- |
| planner | Windsurf | personal | grok-4.6 | high |
| reviewer.plan | Cursor | personal | Composer-2.5 | none |

## Spartan Bridge automation authority

- A human-started Spartan Bridge run may start the mapped reviewer automatically.
- The Bridge may return findings to the current planner session and repeat up to 3 plan-review cycles.
`;
  const parsed = parseAgentsPolicy(markdown);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.reason, "host_invalid");
    assert.equal(parsed.detail.check, "host_unknown");
  }
});

test("repository AGENTS.md declares a model and effort for every binding", { skip: IN_PRODUCER_WORKSPACE }, async () => {
  const text = await repositoryAgentsPolicy();
  const parsed = parseAgentsPolicy(text);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.host, "codex");
    assert.equal(parsed.client_context, "personal");
    assert.equal(parsed.model, "gpt-5.6-sol");
    assert.equal(parsed.effort, "high");
    assert.equal(parsed.producer_chain_authorized, true);
  }
});

test("repository AGENTS.md pins the seven-part automatic-implementation edit set", { skip: IN_PRODUCER_WORKSPACE }, async () => {
  const text = await repositoryAgentsPolicy();
  assert.equal(text.includes(HUMAN_STARTS_PLANNER), true);
  assert.equal(text.includes("The Bridge may return findings to the current planner session and repeat up to 3 plan-review cycles."), true);
  assert.equal(text.includes("After a persisted plan-review pass, the Bridge may return implementation findings to a fresh mapped implementer execution and repeat up to 3 implementation-review cycles."), true);
  assert.equal(text.includes(AUTOMATIC_IMPLEMENTATION_GRANT), true);
  assert.equal(text.includes(AUTOMATIC_CORRECTION_REVIEW_GRANT), true);
  assert.equal(text.includes(PRODUCER_ROLE_STOP_EXCEPTIONS), true);
  assert.equal(text.includes(IMPLEMENTATION_REVIEW_GRANT), true);
  assert.equal(text.includes(IMPLEMENTATION_REVIEW_PROHIBITION), false);
  assert.equal(text.includes("### Automatic implementation write scope"), true);
  assert.equal(text.includes("### Implementation review scope"), true);
  const parsed = parseAgentsPolicy(text);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    const admission = automaticImplementationAdmission(parsed);
    assert.equal(admission.ok, true);
    if (admission.ok) {
      for (const entry of admission.write_scope) {
        assert.notEqual(entry, "AGENTS.md");
        assert.notEqual(entry, "spartan-bridge/config.yaml");
        assert.equal(parsed.implementation_review_scope?.includes(entry), true);
      }
      assert.equal(parsed.implementation_review_scope?.includes("AGENTS.md"), true);
      assert.equal(parsed.implementation_review_scope?.includes("spartan-bridge/config.yaml"), true);
    }
  }
  const missingPlanner = validAgentsMd({ automaticImplementation: true }).replace(`- ${HUMAN_STARTS_PLANNER}\n`, "");
  const missingParsed = parseAgentsPolicy(missingPlanner);
  assert.equal(missingParsed.ok, true);
  if (missingParsed.ok) {
    assert.equal(automaticImplementationAdmission(missingParsed).ok, false);
  }
});

test("empty client context resolves to default", () => {
  const parsed = parseAgentsPolicy(validAgentsMd({ context: "" }));
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.client_context, "default");
  }
});

test("extra sections are ignored and a generic reviewer row is not a fallback", () => {
  const extra = parseAgentsPolicy(
    validAgentsMd({ extraSection: "## Other\n\n| Binding | Host |\n| --- | --- |\n| reviewer | Codex |\n" }),
  );
  assert.equal(extra.ok, true);
  const genericOnly = `# X\n\n## Agent hosts\n\n| Binding | Host | Client context | Model | Effort |\n| --- | --- | --- | --- | --- |\n| reviewer | Codex | personal | gpt-5.6-terra | high |\n\n## Spartan Bridge automation authority\n\n- A human-started Spartan Bridge run may start the mapped reviewer automatically.\n- The Bridge may return findings to the current planner session and repeat up to 3 plan-review cycles.\n`;
  const parsed = parseAgentsPolicy(genericOnly);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.reason, "reviewer_binding_missing");
  }
});

test("duplicate or malformed rows and conflict sentence fail closed", () => {
  const dup = parseAgentsPolicy(validAgentsMd({ extraPlan: true }));
  assert.equal(dup.ok, false);
  if (!dup.ok) {
    assert.equal(dup.reason, "agents_policy_invalid");
  }
  const conflict = parseAgentsPolicy(validAgentsMd({ conflict: true }));
  assert.equal(conflict.ok, false);
  if (!conflict.ok) {
    assert.equal(conflict.reason, "automatic_review_not_authorized");
  }
  const missing = parseAgentsPolicy(validAgentsMd({ omitPlan: true }));
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.reason, "reviewer_binding_missing");
  }
  const host = parseAgentsPolicy(validAgentsMd({ host: "cursor" }));
  assert.equal(host.ok, false);
  if (!host.ok) {
    assert.equal(host.reason, "host_invalid");
  }
});

test("producer_chain grant is optional, exact, and unique", () => {
  const absent = parseAgentsPolicy(validAgentsMd());
  assert.equal(absent.ok, true);
  if (absent.ok) {
    assert.equal(absent.producer_chain_authorized, false);
  }
  const present = parseAgentsPolicy(validAgentsMd({ producerChain: true }));
  assert.equal(present.ok, true);
  if (present.ok) {
    assert.equal(present.producer_chain_authorized, true);
  }
  const duplicate = parseAgentsPolicy(validAgentsMd({ producerChain: true, duplicateProducerChain: true }));
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) {
    assert.equal(duplicate.reason, "agents_policy_invalid");
    assert.equal(duplicate.detail.check, "producer_chain_grant");
  }
});

test("task_artifact_write grant is optional, exact, and unique", () => {
  const absent = parseAgentsPolicy(validAgentsMd());
  assert.equal(absent.ok, true);
  if (absent.ok) {
    assert.equal(absent.task_artifact_write_authorized, false);
  }
  const present = parseAgentsPolicy(validAgentsMd({ taskWrite: true }));
  assert.equal(present.ok, true);
  if (present.ok) {
    assert.equal(present.task_artifact_write_authorized, true);
  }
  const duplicate = parseAgentsPolicy(validAgentsMd({ taskWrite: true, duplicateTaskWrite: true }));
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) {
    assert.equal(duplicate.reason, "agents_policy_invalid");
  }
});

test("host-binding table accepts exactly five columns and fails closed on any other width", () => {
  const three = parseAgentsPolicy(`# X

## Agent hosts

| Binding | Host | Client context |
| --- | --- | --- |
| reviewer.plan | Cursor | personal |

## Spartan Bridge automation authority

- A human-started Spartan Bridge run may start the mapped reviewer automatically.
- The Bridge may return findings to the current planner session and repeat up to 3 plan-review cycles.
`);
  assert.equal(three.ok, false);
  if (!three.ok) {
    assert.equal(three.reason, "agents_policy_invalid");
  }
  const four = parseAgentsPolicy(`# X

## Agent hosts

| Binding | Host | Client context | Model |
| --- | --- | --- | --- |
| reviewer.plan | Cursor | personal | Composer-2.5 |

## Spartan Bridge automation authority

- A human-started Spartan Bridge run may start the mapped reviewer automatically.
- The Bridge may return findings to the current planner session and repeat up to 3 plan-review cycles.
`);
  assert.equal(four.ok, false);
  if (!four.ok) {
    assert.equal(four.reason, "agents_policy_invalid");
  }
  const six = parseAgentsPolicy(`# X

## Agent hosts

| Binding | Host | Client context | Model | Effort | Extra |
| --- | --- | --- | --- | --- | --- |
| reviewer.plan | Cursor | personal | Composer-2.5 | none | x |

## Spartan Bridge automation authority

- A human-started Spartan Bridge run may start the mapped reviewer automatically.
- The Bridge may return findings to the current planner session and repeat up to 3 plan-review cycles.
`);
  assert.equal(six.ok, false);
  if (!six.ok) {
    assert.equal(six.reason, "agents_policy_invalid");
  }
});

test("declared model charset and effort vocabulary fail closed", () => {
  const cases = [
    { model: "-composer", effort: "none" },
    { model: "Composer 2.5", effort: "none" },
    { model: "Composer-2.5[effort=high]", effort: "none" },
    { model: "org/model", effort: "none" },
    { model: "Composer-2.5", effort: "" },
    { model: "Composer-2.5", effort: "None" },
    { model: "Composer-2.5", effort: "ultra" },
    { model: "", effort: "none" },
  ];
  for (const testCase of cases) {
    const parsed = parseAgentsPolicy(validAgentsMd(testCase));
    assert.equal(parsed.ok, false, JSON.stringify(testCase));
    if (!parsed.ok) {
      assert.equal(parsed.reason, "agents_policy_invalid", JSON.stringify(testCase));
    }
  }
  for (const effort of ["low", "medium", "high", "max", "none"] as const) {
    const parsed = parseAgentsPolicy(validAgentsMd({ model: "Composer-2.5", effort }));
    assert.equal(parsed.ok, true, effort);
    if (parsed.ok) {
      assert.equal(parsed.effort, effort);
    }
  }
});

const GRANT = "A human-started Spartan Bridge run may start the mapped reviewer automatically.";
const CYCLE = "The Bridge may return findings to the current planner session and repeat up to 3 plan-review cycles.";

function hostsAndAutomation(options?: {
  hostsHeading?: string;
  headers?: string;
  separator?: string;
  rows?: string;
  automationHeading?: string | null;
  items?: string[];
  conflict?: boolean;
}): string {
  const hostsHeading = options?.hostsHeading ?? "## Agent hosts";
  const headers = options?.headers ?? "| Binding | Host | Client context | Model | Effort |";
  const separator = options?.separator ?? "| --- | --- | --- | --- | --- |";
  const rows = options?.rows ?? "| reviewer.plan | Cursor | personal | Composer-2.5 | none |";
  const automationHeading = options?.automationHeading;
  const items = options?.items ?? [GRANT, CYCLE];
  const conflict = options?.conflict ? "The human starts every round.\n" : "";
  const automation =
    automationHeading === null
      ? ""
      : `${automationHeading ?? "## Spartan Bridge automation authority"}\n\n${items.map((item) => `- ${item}`).join("\n")}\n`;
  return `# X

${hostsHeading}

${headers}
${separator}
${rows}

${automation}${conflict}`;
}

test("successful policy parse carries no failure detail", () => {
  const parsed = parseAgentsPolicy(validAgentsMd());
  assert.equal(parsed.ok, true);
  assert.equal("detail" in parsed, false);
});

const ALL_AGENTS_POLICY_CHECKS = {
  agent_hosts_section_missing: true,
  agent_hosts_section_duplicate: true,
  binding_table_missing: true,
  binding_table_shape: true,
  binding_row: true,
  binding_duplicate: true,
  reviewer_plan_row_missing: true,
  host_unknown: true,
  client_context_alias: true,
  model_identifier: true,
  effort_value: true,
  automation_section_missing: true,
  automation_section_duplicate: true,
  grant_sentence: true,
  cycle_sentence: true,
  implementation_cycle_sentence: true,
  task_artifact_write_grant: true,
  producer_chain_grant: true,
  automatic_correction_review_grant: true,
  automatic_implementation_grant: true,
  write_review_scope_contradiction: true,
  conflict_sentence: true,
  implementation_review_grant: true,
} as const satisfies Record<AgentsPolicyCheck, true>;

test("policy failure detail names each check distinctly without changing reason values", () => {
  const cases: { name: string; markdown: string; reason: AgentsPolicyReason; check: AgentsPolicyCheck }[] = [
    {
      name: "no Agent hosts section",
      markdown: "# X\n\n## Other\n\ntext\n",
      reason: "reviewer_binding_missing",
      check: "agent_hosts_section_missing",
    },
    {
      name: "duplicate Agent hosts section",
      markdown: `${hostsAndAutomation()}\n## Agent hosts\n\n| Binding | Host | Client context | Model | Effort |\n| --- | --- | --- | --- | --- |\n| reviewer.plan | Cursor | personal | Composer-2.5 | none |\n`,
      reason: "agents_policy_invalid",
      check: "agent_hosts_section_duplicate",
    },
    {
      name: "missing binding table",
      markdown: validAgentsMd({ omitTable: true }),
      reason: "reviewer_binding_missing",
      check: "binding_table_missing",
    },
    {
      name: "wrong table headers",
      markdown: hostsAndAutomation({ headers: "| Binding | Host | Client context |" }),
      reason: "agents_policy_invalid",
      check: "binding_table_shape",
    },
    {
      name: "empty host cell",
      markdown: hostsAndAutomation({ rows: "| reviewer.plan |  | personal | Composer-2.5 | none |" }),
      reason: "agents_policy_invalid",
      check: "binding_row",
    },
    {
      name: "duplicate Binding value",
      markdown: hostsAndAutomation({
        rows: "| reviewer.plan | Cursor | personal | Composer-2.5 | none |\n| planner | Codex | personal | gpt-5.6-terra | high |\n| planner | Claude Code | personal | claude-opus-5 | high |",
      }),
      reason: "agents_policy_invalid",
      check: "binding_duplicate",
    },
    {
      name: "missing reviewer.plan row",
      markdown: validAgentsMd({ omitPlan: true }),
      reason: "reviewer_binding_missing",
      check: "reviewer_plan_row_missing",
    },
    {
      name: "unknown host name",
      markdown: validAgentsMd({ host: "cursor" }),
      reason: "host_invalid",
      check: "host_unknown",
    },
    {
      name: "client-context alias failing pattern",
      markdown: validAgentsMd({ context: "Personal" }),
      reason: "agents_policy_invalid",
      check: "client_context_alias",
    },
    {
      name: "model identifier failing charset",
      markdown: validAgentsMd({ model: "Composer 2.5" }),
      reason: "agents_policy_invalid",
      check: "model_identifier",
    },
    {
      name: "effort value outside vocabulary",
      markdown: validAgentsMd({ effort: "ultra" }),
      reason: "agents_policy_invalid",
      check: "effort_value",
    },
    {
      name: "missing automation section",
      markdown: hostsAndAutomation({ automationHeading: null }),
      reason: "automatic_review_not_authorized",
      check: "automation_section_missing",
    },
    {
      name: "duplicate automation section",
      markdown: `${hostsAndAutomation()}\n## Spartan Bridge automation authority\n\n- ${GRANT}\n- ${CYCLE}\n`,
      reason: "agents_policy_invalid",
      check: "automation_section_duplicate",
    },
    {
      name: "missing grant sentence",
      markdown: hostsAndAutomation({ items: [CYCLE] }),
      reason: "automatic_review_not_authorized",
      check: "grant_sentence",
    },
    {
      name: "duplicated grant sentence",
      markdown: hostsAndAutomation({ items: [GRANT, GRANT, CYCLE] }),
      reason: "agents_policy_invalid",
      check: "grant_sentence",
    },
    {
      name: "missing cycle sentence",
      markdown: hostsAndAutomation({ items: [GRANT] }),
      reason: "automatic_review_not_authorized",
      check: "cycle_sentence",
    },
    {
      name: "malformed cycle sentence",
      markdown: hostsAndAutomation({
        items: [GRANT, "The Bridge may return findings to the current planner session and repeat up to 4 plan-review cycles."],
      }),
      reason: "automatic_review_not_authorized",
      check: "cycle_sentence",
    },
    {
      name: "duplicate task_artifact_write grant",
      markdown: validAgentsMd({ duplicateTaskWrite: true }),
      reason: "agents_policy_invalid",
      check: "task_artifact_write_grant",
    },
    {
      name: "duplicate producer_chain grant",
      markdown: validAgentsMd({ duplicateProducerChain: true }),
      reason: "agents_policy_invalid",
      check: "producer_chain_grant",
    },
    {
      name: "conflict sentence with grant present",
      markdown: validAgentsMd({ conflict: true }),
      reason: "automatic_review_not_authorized",
      check: "conflict_sentence",
    },
    {
      name: "duplicate implementation-review grant",
      markdown: validAgentsMd({ duplicateImplementationGrant: true }),
      reason: "agents_policy_invalid",
      check: "implementation_review_grant",
    },
    {
      name: "duplicate implementation-review cycle sentence",
      markdown: validAgentsMd({
        implementationGrant: true,
        extraSection:
          "- After a persisted plan-review pass, the Bridge may return implementation findings to a fresh mapped implementer execution and repeat up to 2 implementation-review cycles.\n",
      }),
      reason: "agents_policy_invalid",
      check: "implementation_cycle_sentence",
    },
    {
      name: "duplicate automatic implementation grant",
      markdown: validAgentsMd({ automaticImplementation: true, duplicateAutomaticImplementation: true }),
      reason: "agents_policy_invalid",
      check: "automatic_implementation_grant",
    },
    {
      name: "automatic implementation grant without correction grant",
      markdown: validAgentsMd({ automaticImplementation: true }).replace(
        "- After an automatic implementer correction declaration, the Bridge may start the next implementation review automatically within the authorized implementation-review cycle limit.\n",
        "",
      ),
      reason: "agents_policy_invalid",
      check: "automatic_correction_review_grant",
    },
    {
      name: "write scope contradicts review scope",
      markdown: validAgentsMd({
        automaticImplementation: true,
        automaticWriteScope: ["src/", "AGENTS.md"],
      }),
      reason: "agents_policy_invalid",
      check: "write_review_scope_contradiction",
    },
    {
      name: "write scope directory prefix admits authority config",
      markdown: validAgentsMd({
        automaticImplementation: true,
        automaticWriteScope: ["spartan-bridge/"],
        implementationScope: ["spartan-bridge/", "AGENTS.md", "spartan-bridge/config.yaml"],
      }),
      reason: "agents_policy_invalid",
      check: "write_review_scope_contradiction",
    },
    {
      name: "write scope trailing-slash AGENTS.md/ admits authority file",
      markdown: validAgentsMd({
        automaticImplementation: true,
        automaticWriteScope: ["AGENTS.md/"],
        implementationScope: ["AGENTS.md/", "AGENTS.md", "spartan-bridge/config.yaml"],
      }),
      reason: "agents_policy_invalid",
      check: "write_review_scope_contradiction",
    },
  ];
  const checks = new Set<string>();
  for (const testCase of cases) {
    const parsed = parseAgentsPolicy(testCase.markdown);
    assert.equal(parsed.ok, false, testCase.name);
    if (!parsed.ok) {
      assert.equal(parsed.reason, testCase.reason, testCase.name);
      assert.equal(parsed.detail.check, testCase.check, testCase.name);
      assert.equal(typeof parsed.detail.message, "string", testCase.name);
      assert.ok(parsed.detail.message.length > 0, testCase.name);
      checks.add(parsed.detail.check);
    }
  }
  assert.deepEqual([...checks].sort(), Object.keys(ALL_AGENTS_POLICY_CHECKS).sort());
});

test("isAuthorityWritePath matches exact authority paths and descendants only", () => {
  assert.equal(isAuthorityWritePath("AGENTS.md"), true);
  assert.equal(isAuthorityWritePath("spartan-bridge/config.yaml"), true);
  assert.equal(isAuthorityWritePath("AGENTS.md/foo"), true);
  assert.equal(isAuthorityWritePath("spartan-bridge/config.yaml/foo"), true);
  assert.equal(isAuthorityWritePath("spartan-bridge"), false);
  assert.equal(isAuthorityWritePath("agents.md"), false);
  assert.equal(isAuthorityWritePath("src/AGENTS.md"), false);
});

test("README adoption example is accepted by the parser", async () => {
  const readme = await fs.readFile(new URL("../README.md", import.meta.url), "utf8");
  const block = /```markdown\n(## Agent hosts\n[\s\S]*?repeat up to 3 plan-review cycles\.\n)```/.exec(readme);
  assert.ok(block?.[1], "adoption example fence");
  const parsed = parseAgentsPolicy(block[1] ?? "");
  assert.equal(parsed.ok, true);
});

const D3_DECLARATION_FENCE = /### D3[^\n]*\n[\s\S]*?```markdown\n([\s\S]*?)\n```/;
// Six shared rules (byte-identical to task 0022's copy) then the AGENTS.md-only
// rules; the full section is ten bullets. SEVEN is the whole-section match
// (name kept for history; it now requires ten).
const ARTIFACT_AUTHORING_SIX = /## Artifact authoring\n\n(?:- .+\n){6}/;
const ARTIFACT_AUTHORING_SEVEN = /## Artifact authoring\n\n(?:- .+\n){10}(?=\n|## |```|$)/;
const ARTIFACT_AUTHORING_SEVENTH =
  "- A role change and its envelope move together. A round that changes frontmatter `next_role`, or that finds it already changed, regenerates `## Next Handoff` in the same edit: the advisory, the prompt's `Act as <role>`, and the identifier all match the new role, or the section carries no envelope at all. An artifact whose frontmatter and envelope name different roles is telling a reader to run the wrong round.\n";
const ARTIFACT_AUTHORING_PATH_RULE =
  "- Every repository path a plan names in its objective, context, scope, decisions, or criteria is confirmed to exist in the current checkout before the plan is written. A path a prior task removed is dead weight the implementer round stops on; name the file that exists, or state that the work is a follow-up outside this repository.\n";
const ARTIFACT_AUTHORING_AGENTS_TARGET_RULE =
  "- A plan whose decisions or scope edit `AGENTS.md` or `spartan-bridge/config.yaml` declares a human implementer: frontmatter `next_role: human-operator` on the plan-review pass, not the plan-pass auto-chain. Those two paths are outside every automatic write scope, so a mapped implementer cannot satisfy such a plan; without the human-implementer declaration the round is spent discovering that at the implementation-review gate.\n";
const ARTIFACT_AUTHORING_PRIVATE_IDENTITY_RULE =
  "- Repository content names no private identity. This repository is published, so a path under a contributor's home directory, a personal e-mail address, or a client-context alias that is not `personal` or `default` is a disclosure the moment it is committed. An Evidence row citing a Bridge run in another repository carries the run id, reason code, verdict, timings and document shape, and never that repository's path, its name, the organisation or product it belongs to, or the alias that selected its launcher. Write the conventional placeholder instead: a `~` path names a dotfile, an absolute home path names a placeholder user, and an address is `t@t.invalid`. The dogfooding rounds that produce the most useful evidence run in private repositories, so the line most worth quoting is the line most likely to disclose. The repository's hygiene check covers four shapes in tracked pathnames and tracked blobs \u2014 an absolute home path whose user segment is not a placeholder, a `~` path that names neither a dotfile nor the single pinned negative fixture, an e-mail address that is not the synthetic one, and a client-context alias in a quoted serialisation that is neither `personal` nor `default`. It does not detect a person, an organisation, a product, a repository or an alias written as prose, nor an alias in an unquoted or command-line form, where an escape sequence or an interpolation can transform the value after the fact; those remain judgement, and passing the check is not evidence that a round has met this rule.\n";
const D6_RULE_PHRASES = [
  "deriving each criterion from a named decision",
  "re-derive every criterion that touches it",
  "A closed claim such as",
  "read the criteria against the decisions as a set",
  "Describing an input in place of quoting it",
  "Queued is not a reason to omit it",
] as const;

function extractMatch(text: string, pattern: RegExp, label: string): string {
  const match = pattern.exec(text);
  assert.ok(match?.[0], label);
  return match[0];
}

function extractD3Declaration(task: string): string {
  const match = D3_DECLARATION_FENCE.exec(task);
  assert.ok(match?.[1], "D3 declaration fence");
  return match[1];
}

test("declaration paragraph copies are identical and parse-invariant", { skip: IN_PRODUCER_WORKSPACE }, async () => {
  const repositoryAgents = await repositoryAgentsPolicy();
  const [agents, readme, fixture, task] = await Promise.all([
    Promise.resolve(repositoryAgents),
    fs.readFile(new URL("../README.md", import.meta.url), "utf8"),
    fs.readFile(new URL("./fixtures/agents-with-bridge-declaration.md", import.meta.url), "utf8"),
    fs.readFile(new URL("../spartan/tasks/0022-say-which-invocation-a-bridge-repo-uses.md", import.meta.url), "utf8"),
  ]);
  const declaration = extractD3Declaration(task);
  assert.ok(agents.includes(declaration), "AGENTS.md declaration");
  assert.ok(readme.includes(declaration), "README declaration");
  assert.ok(fixture.includes(declaration), "fixture declaration");

  const repoParsed = parseAgentsPolicy(agents);
  assert.deepEqual(repoParsed, {
    ok: true,
    host: "codex",
    client_context: "personal",
    model: "gpt-5.6-sol",
    effort: "high",
    automatic_review_authorized: true,
    task_artifact_write_authorized: true,
    producer_chain_authorized: true,
    max_review_cycles: 3,
    max_implementation_review_cycles: 3,
    implementation_review_authorized: true,
    implementation_review_scope: [
      "src/",
      "tests/",
      "docs/",
      "skills/",
      "agent-skill/skills/spbridge/SKILL.md",
      "spartan/",
      "README.md",
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "AGENTS.md",
      "spartan-bridge/config.yaml",
    ],
    implementation_review_failure: null,
    automatic_implementation_authorized: true,
    automatic_implementation_write_scope: [
      "src/",
      "tests/",
      "docs/",
      "skills/",
      "agent-skill/skills/spbridge/SKILL.md",
      "spartan/",
      "README.md",
      "package.json",
      "package-lock.json",
      "tsconfig.json",
    ],
    automatic_implementation_failure: null,
    automatic_correction_review_authorized: true,
    implementation: {
      host: "claude",
      client_context: "personal",
      model: "claude-opus-5",
      effort: "high",
    },
    implementer: {
      host: "codex",
      client_context: "personal",
      model: "gpt-5.6-sol",
      effort: "high",
    },
    planner: {
      host: "claude",
      client_context: "personal",
      model: "claude-opus-5",
      effort: "high",
    },
  });

  const baseline = parseAgentsPolicy(validAgentsMd());
  const withParagraph = parseAgentsPolicy(
    validAgentsMd().replace(
      "## Spartan Bridge automation authority",
      `${declaration}\n\n## Spartan Bridge automation authority`,
    ),
  );
  const withAuthoring = parseAgentsPolicy(validAgentsMd({ extraSection: extractMatch(agents, ARTIFACT_AUTHORING_SEVEN, "AGENTS.md Artifact authoring") }));
  const fixtureParsed = parseAgentsPolicy(fixture);
  assert.deepEqual(withParagraph, baseline);
  assert.deepEqual(withAuthoring, baseline);
  assert.deepEqual(fixtureParsed, baseline);
});

test("Artifact authoring stays out of adoption, skill, and routing", { skip: IN_PRODUCER_WORKSPACE }, async () => {
  const repositoryAgents = await repositoryAgentsPolicy();
  const [agents, readme, skill, routing, task, fixture] = await Promise.all([
    Promise.resolve(repositoryAgents),
    fs.readFile(new URL("../README.md", import.meta.url), "utf8"),
    fs.readFile(new URL("../agent-skill/skills/spbridge/SKILL.md", import.meta.url), "utf8"),
    fs.readFile(new URL("../docs/ROUTING-AND-WORKFLOWS.md", import.meta.url), "utf8"),
    fs.readFile(new URL("../spartan/tasks/0022-say-which-invocation-a-bridge-repo-uses.md", import.meta.url), "utf8"),
    fs.readFile(new URL("./fixtures/agents-with-bridge-declaration.md", import.meta.url), "utf8"),
  ]);
  assert.equal(
    extractMatch(agents, ARTIFACT_AUTHORING_SIX, "AGENTS.md six Artifact authoring rules"),
    extractMatch(task, ARTIFACT_AUTHORING_SIX, "task 0022 six Artifact authoring rules"),
  );
  const seven = extractMatch(agents, ARTIFACT_AUTHORING_SEVEN, "AGENTS.md ten Artifact authoring rules");
  assert.equal(seven.endsWith(ARTIFACT_AUTHORING_PRIVATE_IDENTITY_RULE), true);
  for (const rule of [ARTIFACT_AUTHORING_SEVENTH, ARTIFACT_AUTHORING_PATH_RULE, ARTIFACT_AUTHORING_AGENTS_TARGET_RULE, ARTIFACT_AUTHORING_PRIVATE_IDENTITY_RULE]) {
    assert.equal(agents.split(rule).length - 1, 1);
    assert.equal(task.includes(rule.trim()), false);
    assert.equal(fixture.includes(rule.trim()), false);
  }
  assert.doesNotMatch(readme, ARTIFACT_AUTHORING_SEVEN);
  assert.doesNotMatch(skill, ARTIFACT_AUTHORING_SEVEN);
  assert.doesNotMatch(routing, ARTIFACT_AUTHORING_SEVEN);
  assert.doesNotMatch(fixture, ARTIFACT_AUTHORING_SEVEN);
  assert.doesNotMatch(readme, ARTIFACT_AUTHORING_SIX);
  assert.doesNotMatch(skill, ARTIFACT_AUTHORING_SIX);
  assert.doesNotMatch(routing, ARTIFACT_AUTHORING_SIX);
  assert.equal(routing.includes(extractD3Declaration(task)), false);
  assert.match(routing, /immediately under the table/);
  for (const phrase of [...D6_RULE_PHRASES, "A role change and its envelope move together", "confirmed to exist in the current checkout", "declares a human implementer"]) {
    assert.equal(readme.includes(phrase), false, phrase);
    assert.equal(skill.includes(phrase), false, phrase);
    assert.equal(routing.includes(phrase), false, phrase);
  }
  assert.doesNotMatch(agents, /spartan-bridge review/);
});
