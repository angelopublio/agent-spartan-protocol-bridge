import { canonicalizeHost, isValidClientContextAlias } from "./task-frontmatter.ts";
import {
  isEffortLevel,
  isModelIdentifier,
  type CanonicalHost,
  type EffortLevel,
  type ProducerIdentity,
} from "../core/contracts.ts";

export type AgentsPolicyParse =
  | {
      ok: true;
      host: CanonicalHost;
      client_context: string;
      declared_client_contexts: readonly string[];
      model: string;
      effort: EffortLevel;
      automatic_review_authorized: true;
      task_artifact_write_authorized: boolean;
      producer_chain_authorized: boolean;
      max_review_cycles: 1 | 2 | 3;
      max_implementation_review_cycles: 1 | 2 | 3 | null;
      implementation_review_authorized: boolean;
      implementation_review_scope: readonly string[] | null;
      implementation_review_failure: ImplementationReviewFailureCheck | null;
      automatic_implementation_authorized: boolean;
      automatic_implementation_write_scope: readonly string[] | null;
      automatic_implementation_failure: AutomaticImplementationFailureCheck | null;
      automatic_correction_review_authorized: boolean;
      implementation: ReviewerBinding | null;
      implementer: ReviewerBinding | null;
      planner: ReviewerBinding | null;
    }
  | { ok: false; reason: AgentsPolicyReason; detail: AgentsPolicyFailureDetail };

export type ReviewerBinding = {
  host: CanonicalHost;
  client_context: string;
  model: string;
  effort: EffortLevel;
};

export type ImplementationReviewFailureCheck =
  | "implementation_review_grant"
  | "implementation_review_scope_invalid"
  | "implementation_cycle_sentence"
  | "reviewer_implementation_row_missing";

export type AutomaticImplementationFailureCheck =
  | "automatic_implementation_grant"
  | "automatic_write_scope_invalid"
  | "implementation_cycle_sentence"
  | "write_review_scope_contradiction"
  | "implementer_row_missing";

export type ImplementationProducerFailureCheck = "implementer_row_missing";

export type AgentsPolicyReason =
  | "agents_policy_invalid"
  | "automatic_review_not_authorized"
  | "reviewer_binding_missing"
  | "host_invalid";

export type AgentsPolicyCheck =
  | "agent_hosts_section_missing"
  | "agent_hosts_section_duplicate"
  | "binding_table_missing"
  | "binding_table_shape"
  | "binding_row"
  | "binding_duplicate"
  | "reviewer_plan_row_missing"
  | "host_unknown"
  | "client_context_alias"
  | "model_identifier"
  | "effort_value"
  | "automation_section_missing"
  | "automation_section_duplicate"
  | "grant_sentence"
  | "cycle_sentence"
  | "implementation_cycle_sentence"
  | "task_artifact_write_grant"
  | "producer_chain_grant"
  | "automatic_correction_review_grant"
  | "automatic_implementation_grant"
  | "write_review_scope_contradiction"
  | "conflict_sentence"
  | "implementation_review_grant";

export type AgentsPolicyFailureDetail = {
  check: AgentsPolicyCheck;
  message: string;
};

type AgentsPolicyFailure = {
  ok: false;
  reason: AgentsPolicyReason;
  detail: AgentsPolicyFailureDetail;
};

const AGENT_HOSTS = "## Agent hosts";
const AUTOMATION = "## Spartan Bridge automation authority";
const GRANT = "A human-started Spartan Bridge run may start the mapped reviewer automatically.";
export const TASK_ARTIFACT_WRITE_GRANT =
  "This run grants the Bridge `task_artifact_write` only for persisting validated reviewer findings and transition metadata to the explicitly identified current Spartan task artifact.";
export const PRODUCER_CHAIN_GRANT =
  "A producer round that received findings from a Spartan Bridge run may start the next review run automatically within the authorized cycle limit.";
export const IMPLEMENTATION_REVIEW_GRANT =
  "A human-started Spartan Bridge run may start the mapped `reviewer.implementation` automatically when the current Spartan task artifact declares the implementer round finished and the reviewer round next; the Bridge takes that declaration as the implementer's assertion that the required checks passed, and does not verify it. That reviewer is given a read-only copy of the working-tree file content admitted by the implementation review scope declared below, excluding only `.git` metadata; repository ignore rules do not classify or remove files, ancestor directories are created only as containers for admitted files, and no repository file path outside that scope appears in the copy or in any other file the reviewer is given.";
export const IMPLEMENTATION_REVIEW_SCOPE_HEADING = "### Implementation review scope";
export const AUTOMATIC_WRITE_SCOPE_HEADING = "### Automatic implementation write scope";
export const AUTOMATIC_IMPLEMENTATION_GRANT =
  "After a human-started planner phase and a persisted `reviewer.plan: pass`, the Bridge may start the mapped `implementer`, may start the mapped `reviewer.implementation` after the implementer's declaration, and may return implementation findings to a fresh mapped implementer execution within the independent implementation-review cycle ceiling. Automatic implementation requires an unchanged approved-plan hash and an exclusive worktree lock.";
export const AUTOMATIC_CORRECTION_REVIEW_GRANT =
  "After an automatic implementer correction declaration, the Bridge may start the next implementation review automatically within the authorized implementation-review cycle limit.";
export const HUMAN_STARTS_PLANNER =
  "The human starts the planner producer phase of a chain; later plan-correction cycles continue inside that same human-started planner session. Each authorized automatic implementation or correction producer uses a fresh mapped execution in the same foreground Bridge run.";
export const PRODUCER_ROLE_STOP_EXCEPTIONS =
  "The Bridge must stop before changing the producer role or producer host, except for the mapped plan-pass implementer transition and its mapped implementation correction executions.";
export const AUTHORITY_WRITE_PATHS = ["AGENTS.md", "spartan-bridge/config.yaml"] as const;

export function isAuthorityWritePath(posix: string): boolean {
  for (const authority of AUTHORITY_WRITE_PATHS) {
    if (posix === authority || posix.startsWith(`${authority}/`)) {
      return true;
    }
  }
  return false;
}
export const IMPLEMENTATION_REVIEW_PROHIBITION =
  "The Bridge may not start an implementer round automatically.";
const CONFLICT = "The human starts every round.";
const CYCLE = /^The Bridge may return findings to the current planner session and repeat up to ([123]) plan-review cycles\.$/;
const IMPLEMENTATION_CYCLE =
  /^After a persisted plan-review pass, the Bridge may return implementation findings to a fresh mapped implementer execution and repeat up to ([123]) implementation-review cycles\.$/;
const LIST_ITEM = /^(?:[-*+]|\d+\.) (.+)$/;

function fail(reason: AgentsPolicyReason, check: AgentsPolicyCheck, message: string): AgentsPolicyFailure {
  return { ok: false, reason, detail: { check, message } };
}

export function parseAgentsPolicy(markdown: string): AgentsPolicyParse {
  if (hasStandaloneConflict(markdown)) {
    const hosts = parseAgentHostsSection(markdown);
    if (!hosts.ok) {
      return hosts;
    }
    return fail(
      "automatic_review_not_authorized",
      "conflict_sentence",
      "Remove the standalone sentence 'The human starts every round.'; it denies automatic review while a grant is present.",
    );
  }
  const hosts = parseAgentHostsSection(markdown);
  if (!hosts.ok) {
    return hosts;
  }
  const automation = parseAutomationSection(markdown);
  if (!automation.ok) {
    return automation;
  }
  return {
    ok: true,
    host: hosts.host,
    client_context: hosts.client_context,
    declared_client_contexts: hosts.declared_client_contexts,
    model: hosts.model,
    effort: hosts.effort,
    automatic_review_authorized: true,
    task_artifact_write_authorized: automation.task_artifact_write_authorized,
    producer_chain_authorized: automation.producer_chain_authorized,
    max_review_cycles: automation.max_review_cycles,
    max_implementation_review_cycles: automation.max_implementation_review_cycles,
    implementation_review_authorized: automation.implementation_review_authorized,
    implementation_review_scope: automation.implementation_review_scope,
    implementation_review_failure: automation.implementation_review_failure,
    automatic_implementation_authorized: automation.automatic_implementation_authorized,
    automatic_implementation_write_scope: automation.automatic_implementation_write_scope,
    automatic_implementation_failure: automation.automatic_implementation_failure,
    automatic_correction_review_authorized: automation.automatic_correction_review_authorized,
    implementation: hosts.implementation,
    implementer: hosts.implementer,
    planner: hosts.planner,
  };
}

function hasStandaloneConflict(markdown: string): boolean {
  return markdown.split(/\r?\n/).some((line) => line.trim() === CONFLICT);
}

function parseAgentHostsSection(
  markdown: string,
):
  | {
      ok: true;
      host: CanonicalHost;
      client_context: string;
      declared_client_contexts: readonly string[];
      model: string;
      effort: EffortLevel;
      implementation: ReviewerBinding | null;
      implementer: ReviewerBinding | null;
      planner: ReviewerBinding | null;
    }
  | AgentsPolicyFailure {
  const sections = collectLevel2Sections(markdown);
  const hostSections = sections.filter((section) => section.heading === AGENT_HOSTS);
  if (hostSections.length === 0) {
    return fail(
      "reviewer_binding_missing",
      "agent_hosts_section_missing",
      "Root AGENTS.md needs a ## Agent hosts section.",
    );
  }
  if (hostSections.length > 1) {
    return fail(
      "agents_policy_invalid",
      "agent_hosts_section_duplicate",
      "Root AGENTS.md must contain exactly one ## Agent hosts section.",
    );
  }
  const body = hostSections[0]?.body ?? "";
  const lines = skipLeadingBlanks(body.split("\n"));
  const table = readFirstTable(lines);
  if (!table) {
    return fail(
      "reviewer_binding_missing",
      "binding_table_missing",
      "The ## Agent hosts section must begin with a Markdown table.",
    );
  }
  if (table.invalid) {
    return fail(
      "agents_policy_invalid",
      "binding_table_shape",
      "The host-binding table must have exactly five columns headed Binding, Host, Client context, Model, Effort.",
    );
  }
  if (
    table.headers.length !== 5 ||
    table.headers[0] !== "Binding" ||
    table.headers[1] !== "Host" ||
    table.headers[2] !== "Client context" ||
    table.headers[3] !== "Model" ||
    table.headers[4] !== "Effort"
  ) {
    return fail(
      "agents_policy_invalid",
      "binding_table_shape",
      "The host-binding table must have exactly five columns headed Binding, Host, Client context, Model, Effort.",
    );
  }
  const bindings = new Set<string>();
  let planRow: { host: string; context: string; model: string; effort: EffortLevel } | undefined;
  let implementationRow: { host: string; context: string; model: string; effort: EffortLevel } | undefined;
  let implementerRow: { host: string; context: string; model: string; effort: EffortLevel } | undefined;
  let plannerRow: { host: string; context: string; model: string; effort: EffortLevel } | undefined;
  const declaredClientContexts: string[] = [];
  for (const row of table.rows) {
    if (row.length !== 5) {
      return fail(
        "agents_policy_invalid",
        "binding_table_shape",
        "The host-binding table must have exactly five columns headed Binding, Host, Client context, Model, Effort.",
      );
    }
    const binding = row[0] ?? "";
    const host = row[1] ?? "";
    const context = row[2] ?? "";
    const model = row[3] ?? "";
    const effort = row[4] ?? "";
    if (binding.length === 0 || host.length === 0) {
      return fail(
        "agents_policy_invalid",
        "binding_row",
        "Each host-binding row must include a non-empty Binding and Host.",
      );
    }
    if (!isModelIdentifier(model)) {
      return fail(
        "agents_policy_invalid",
        "model_identifier",
        "Each binding's model identifier must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}.",
      );
    }
    if (!isEffortLevel(effort)) {
      return fail(
        "agents_policy_invalid",
        "effort_value",
        "Each binding's effort must be one of low, medium, high, max, or none.",
      );
    }
    if (bindings.has(binding)) {
      return fail(
        "agents_policy_invalid",
        "binding_duplicate",
        "Each Binding value in the host-binding table must be unique.",
      );
    }
    bindings.add(binding);
    if (isValidClientContextAlias(context)) {
      declaredClientContexts.push(context);
    }
    if (binding === "reviewer.plan") {
      planRow = { host, context, model, effort };
    }
    if (binding === "reviewer.implementation") {
      implementationRow = { host, context, model, effort };
    }
    if (binding === "implementer") {
      implementerRow = { host, context, model, effort };
    }
    if (binding === "planner") {
      plannerRow = { host, context, model, effort };
    }
  }
  if (!planRow) {
    return fail(
      "reviewer_binding_missing",
      "reviewer_plan_row_missing",
      "The host-binding table must include a reviewer.plan row.",
    );
  }
  const planBinding = resolveHostBinding(planRow.host, planRow.context, planRow.model, planRow.effort, "reviewer.plan");
  if (!planBinding.ok) {
    return planBinding;
  }
  let implementation: ReviewerBinding | null = null;
  if (implementationRow) {
    const implBinding = resolveHostBinding(
      implementationRow.host,
      implementationRow.context,
      implementationRow.model,
      implementationRow.effort,
      "reviewer.implementation",
    );
    if (!implBinding.ok) {
      return implBinding;
    }
    implementation = implBinding.binding;
  }
  let implementer: ReviewerBinding | null = null;
  if (implementerRow) {
    const producerBinding = resolveHostBinding(
      implementerRow.host,
      implementerRow.context,
      implementerRow.model,
      implementerRow.effort,
      "implementer",
    );
    if (!producerBinding.ok) {
      return producerBinding;
    }
    implementer = producerBinding.binding;
  }
  let planner: ReviewerBinding | null = null;
  if (plannerRow) {
    const plannerBinding = resolveHostBinding(
      plannerRow.host,
      plannerRow.context,
      plannerRow.model,
      plannerRow.effort,
      "planner",
    );
    if (!plannerBinding.ok) {
      return plannerBinding;
    }
    planner = plannerBinding.binding;
  }
  return {
    ok: true,
    host: planBinding.binding.host,
    client_context: planBinding.binding.client_context,
    declared_client_contexts: declaredClientContexts,
    model: planBinding.binding.model,
    effort: planBinding.binding.effort,
    implementation,
    implementer,
    planner,
  };
}

function resolveHostBinding(
  host: string,
  context: string,
  model: string,
  effort: EffortLevel,
  binding: "reviewer.plan" | "reviewer.implementation" | "implementer" | "planner",
): { ok: true; binding: ReviewerBinding } | AgentsPolicyFailure {
  const canonical = canonicalizeHost(host);
  if (!canonical) {
    return fail(
      "host_invalid",
      "host_unknown",
      `The ${binding} host must be one of Codex, Claude Code, or Cursor.`,
    );
  }
  let client_context: string;
  if (context.length === 0) {
    client_context = "default";
  } else if (isValidClientContextAlias(context)) {
    client_context = context;
  } else {
    return fail(
      "agents_policy_invalid",
      "client_context_alias",
      `The ${binding} client-context alias must be empty or match [a-z0-9][a-z0-9._-]{0,63}.`,
    );
  }
  return {
    ok: true,
    binding: {
      host: canonical,
      client_context,
      model,
      effort,
    },
  };
}

function parseAutomationSection(
  markdown: string,
):
  | {
      ok: true;
      max_review_cycles: 1 | 2 | 3;
      max_implementation_review_cycles: 1 | 2 | 3 | null;
      task_artifact_write_authorized: boolean;
      producer_chain_authorized: boolean;
      implementation_review_authorized: boolean;
      implementation_review_scope: readonly string[] | null;
      implementation_review_failure: ImplementationReviewFailureCheck | null;
      automatic_implementation_authorized: boolean;
      automatic_implementation_write_scope: readonly string[] | null;
      automatic_implementation_failure: AutomaticImplementationFailureCheck | null;
      automatic_correction_review_authorized: boolean;
    }
  | AgentsPolicyFailure {
  const sections = collectLevel2Sections(markdown);
  const autoSections = sections.filter((section) => section.heading === AUTOMATION);
  if (autoSections.length === 0) {
    return fail(
      "automatic_review_not_authorized",
      "automation_section_missing",
      "Root AGENTS.md needs a ## Spartan Bridge automation authority section.",
    );
  }
  if (autoSections.length > 1) {
    return fail(
      "agents_policy_invalid",
      "automation_section_duplicate",
      "Root AGENTS.md must contain exactly one ## Spartan Bridge automation authority section.",
    );
  }
  const items = (autoSections[0]?.body ?? "")
    .split("\n")
    .map((line) => LIST_ITEM.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[1] ?? "");
  const grants = items.filter((item) => item === GRANT);
  const implementationGrants = items.filter((item) => item === IMPLEMENTATION_REVIEW_GRANT);
  const taskWrites = items.filter((item) => item === TASK_ARTIFACT_WRITE_GRANT);
  const producerChains = items.filter((item) => item === PRODUCER_CHAIN_GRANT);
  const automaticImplementationGrants = items.filter((item) => item === AUTOMATIC_IMPLEMENTATION_GRANT);
  const automaticCorrectionGrants = items.filter((item) => item === AUTOMATIC_CORRECTION_REVIEW_GRANT);
  const cycles = items
    .map((item) => CYCLE.exec(item))
    .filter((match): match is RegExpExecArray => match !== null);
  const implementationCycles = items
    .map((item) => IMPLEMENTATION_CYCLE.exec(item))
    .filter((match): match is RegExpExecArray => match !== null);
  if (grants.length > 1) {
    return fail(
      "agents_policy_invalid",
      "grant_sentence",
      "The automation section must contain exactly one grant sentence: A human-started Spartan Bridge run may start the mapped reviewer automatically.",
    );
  }
  if (cycles.length > 1) {
    return fail(
      "agents_policy_invalid",
      "cycle_sentence",
      "The automation section must contain exactly one plan-review cycle sentence of the form: The Bridge may return findings to the current planner session and repeat up to N plan-review cycles.",
    );
  }
  if (implementationCycles.length > 1) {
    return fail(
      "agents_policy_invalid",
      "implementation_cycle_sentence",
      "The automation section must contain at most one implementation-review cycle sentence.",
    );
  }
  if (taskWrites.length > 1) {
    return fail(
      "agents_policy_invalid",
      "task_artifact_write_grant",
      "The automation section must contain at most one task_artifact_write grant sentence.",
    );
  }
  if (producerChains.length > 1) {
    return fail(
      "agents_policy_invalid",
      "producer_chain_grant",
      "The automation section must contain at most one producer-chain grant sentence.",
    );
  }
  if (automaticCorrectionGrants.length > 1) {
    return fail(
      "agents_policy_invalid",
      "automatic_correction_review_grant",
      "The automation section must contain at most one automatic correction-review grant sentence.",
    );
  }
  if (automaticImplementationGrants.length > 1) {
    return fail(
      "agents_policy_invalid",
      "automatic_implementation_grant",
      "The automation section must contain at most one automatic implementation grant sentence.",
    );
  }
  if (implementationGrants.length > 1) {
    return fail(
      "agents_policy_invalid",
      "implementation_review_grant",
      "The automation section must contain at most one implementation-review grant sentence.",
    );
  }
  if (grants.length !== 1) {
    return fail(
      "automatic_review_not_authorized",
      "grant_sentence",
      "The automation section must contain exactly one grant sentence: A human-started Spartan Bridge run may start the mapped reviewer automatically.",
    );
  }
  if (cycles.length !== 1) {
    return fail(
      "automatic_review_not_authorized",
      "cycle_sentence",
      "The automation section must contain exactly one plan-review cycle sentence of the form: The Bridge may return findings to the current planner session and repeat up to N plan-review cycles.",
    );
  }
  const n = Number(cycles[0]?.[1]);
  if (n !== 1 && n !== 2 && n !== 3) {
    return fail(
      "automatic_review_not_authorized",
      "cycle_sentence",
      "The automation section must contain exactly one plan-review cycle sentence of the form: The Bridge may return findings to the current planner session and repeat up to N plan-review cycles.",
    );
  }
  let implementationCycleCount: 1 | 2 | 3 | null = null;
  if (implementationCycles.length === 1) {
    const implN = Number(implementationCycles[0]?.[1]);
    if (implN !== 1 && implN !== 2 && implN !== 3) {
      return fail(
        "automatic_review_not_authorized",
        "implementation_cycle_sentence",
        "The automation section must contain an implementation-review cycle sentence of the form: After a persisted plan-review pass, the Bridge may return implementation findings to a fresh mapped implementer execution and repeat up to N implementation-review cycles.",
      );
    }
    implementationCycleCount = implN;
  }
  const automationBody = autoSections[0]?.body ?? "";
  if (automaticImplementationGrants.length !== automaticCorrectionGrants.length) {
    return fail(
      "agents_policy_invalid",
      automaticImplementationGrants.length === 1 ? "automatic_correction_review_grant" : "automatic_implementation_grant",
      "The automatic implementation grant and the automatic correction-review grant must both be present or both absent.",
    );
  }
  const implementation = resolveImplementationReviewGrant(
    automationBody,
    implementationGrants.length === 1,
    implementationCycleCount,
  );
  const automatic = resolveAutomaticImplementationGrant(
    automationBody,
    automaticImplementationGrants.length === 1,
    items,
    implementationCycleCount,
    implementation.scope,
  );
  if (automatic.failure === "write_review_scope_contradiction") {
    return fail(
      "agents_policy_invalid",
      "write_review_scope_contradiction",
      "Automatic implementation write scope must be contained by implementation review scope and must not include AGENTS.md or spartan-bridge/config.yaml.",
    );
  }
  return {
    ok: true,
    max_review_cycles: n,
    max_implementation_review_cycles: implementationCycleCount,
    task_artifact_write_authorized: taskWrites.length === 1,
    producer_chain_authorized: producerChains.length === 1,
    implementation_review_authorized: implementation.authorized,
    implementation_review_scope: implementation.scope,
    implementation_review_failure: implementation.failure,
    automatic_implementation_authorized: automatic.authorized,
    automatic_implementation_write_scope: automatic.scope,
    automatic_implementation_failure: automatic.failure,
    automatic_correction_review_authorized: automaticCorrectionGrants.length === 1,
  };
}

function resolveImplementationReviewGrant(
  automationBody: string,
  grantPresent: boolean,
  implementationCycleCount: 1 | 2 | 3 | null,
): {
  authorized: boolean;
  scope: readonly string[] | null;
  failure: ImplementationReviewFailureCheck | null;
} {
  if (!grantPresent) {
    return { authorized: false, scope: null, failure: "implementation_review_grant" };
  }
  const scope = parseScopeHeading(automationBody, IMPLEMENTATION_REVIEW_SCOPE_HEADING);
  if (scope === null) {
    return { authorized: false, scope: null, failure: "implementation_review_scope_invalid" };
  }
  if (implementationCycleCount === null) {
    return { authorized: false, scope, failure: "implementation_cycle_sentence" };
  }
  return { authorized: true, scope, failure: null };
}

function resolveAutomaticImplementationGrant(
  automationBody: string,
  grantPresent: boolean,
  items: readonly string[],
  implementationCycleCount: 1 | 2 | 3 | null,
  reviewScope: readonly string[] | null,
): {
  authorized: boolean;
  scope: readonly string[] | null;
  failure: AutomaticImplementationFailureCheck | null;
} {
  if (!grantPresent) {
    return { authorized: false, scope: null, failure: "automatic_implementation_grant" };
  }
  const scope = parseScopeHeading(automationBody, AUTOMATIC_WRITE_SCOPE_HEADING);
  if (scope === null) {
    return { authorized: false, scope: null, failure: "automatic_write_scope_invalid" };
  }
  if (implementationCycleCount === null) {
    return { authorized: false, scope, failure: "implementation_cycle_sentence" };
  }
  if (
    !items.includes(HUMAN_STARTS_PLANNER) ||
    !items.includes(PRODUCER_ROLE_STOP_EXCEPTIONS) ||
    items.includes(IMPLEMENTATION_REVIEW_PROHIBITION)
  ) {
    return { authorized: false, scope, failure: "automatic_implementation_grant" };
  }
  if (writeScopeContradictsReviewScope(scope, reviewScope)) {
    return { authorized: false, scope, failure: "write_review_scope_contradiction" };
  }
  return { authorized: true, scope, failure: null };
}

function writeScopeContradictsReviewScope(
  writeScope: readonly string[],
  reviewScope: readonly string[] | null,
): boolean {
  if (AUTHORITY_WRITE_PATHS.some((p) => isPathAdmittedByScope(p, writeScope))) {
    return true;
  }
  if (reviewScope === null) {
    return true;
  }
  const review = new Set(reviewScope);
  return writeScope.some((entry) => !review.has(entry));
}

function parseScopeHeading(automationBody: string, heading: string): readonly string[] | null {
  const headings = collectLevel3Sections(automationBody);
  const scopes = headings.filter((section) => section.heading === heading);
  if (scopes.length !== 1) {
    return null;
  }
  const entries: string[] = [];
  const seen = new Set<string>();
  for (const line of (scopes[0]?.body ?? "").split("\n")) {
    const match = LIST_ITEM.exec(line);
    if (!match) {
      continue;
    }
    const decoded = decodeScopeEntry(match[1] ?? "");
    if (decoded === null) {
      return null;
    }
    if (seen.has(decoded)) {
      return null;
    }
    seen.add(decoded);
    entries.push(decoded);
  }
  if (entries.length === 0) {
    return null;
  }
  return entries;
}

function decodeScopeEntry(item: string): string | null {
  if (!/^`[^`]+`$/.test(item)) {
    return null;
  }
  const inner = item.slice(1, -1);
  if (!isValidScopePath(inner)) {
    return null;
  }
  return inner;
}

function isValidScopePath(value: string): boolean {
  if (value.startsWith("/") || value.startsWith("~") || value.startsWith("!")) {
    return false;
  }
  if (value.includes("\0") || value.includes("\\")) {
    return false;
  }
  if (/[*?[\]{}]/.test(value)) {
    return false;
  }
  if (value.startsWith("/") && value.endsWith("/") && value.length >= 2) {
    return false;
  }
  if (/[()|^$]/.test(value)) {
    return false;
  }
  const trimmed = value.endsWith("/") ? value.slice(0, -1) : value;
  if (trimmed.length === 0) {
    return false;
  }
  for (const segment of trimmed.split("/")) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      return false;
    }
  }
  return true;
}

export function isPathAdmittedByScope(posix: string, scope: readonly string[]): boolean {
  for (const entry of scope) {
    if (entry.endsWith("/")) {
      const prefix = entry.slice(0, -1);
      if (posix === prefix || posix.startsWith(`${prefix}/`)) {
        return true;
      }
      continue;
    }
    if (posix === entry) {
      return true;
    }
  }
  return false;
}

function collectLevel3Sections(body: string): { heading: string; body: string }[] {
  const lines = body.split("\n");
  const indices: { heading: string; start: number; bodyStart: number }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^### /.test(line)) {
      indices.push({ heading: line, start: i, bodyStart: i + 1 });
    }
  }
  const sections: { heading: string; body: string }[] = [];
  for (let i = 0; i < indices.length; i += 1) {
    const current = indices[i];
    if (!current) {
      continue;
    }
    const next = indices[i + 1];
    const end = next ? next.start : lines.length;
    sections.push({
      heading: current.heading,
      body: lines.slice(current.bodyStart, end).join("\n"),
    });
  }
  return sections;
}

export function implementationReviewAdmission(
  policy: Extract<AgentsPolicyParse, { ok: true }>,
):
  | { ok: true; binding: ReviewerBinding; scope: readonly string[] }
  | {
      ok: false;
      reason: "automatic_review_not_authorized" | "reviewer_binding_missing";
      detail: { check: ImplementationReviewFailureCheck; message: string };
    } {
  if (!policy.implementation_review_authorized || policy.implementation_review_scope === null) {
    const check = policy.implementation_review_failure ?? "implementation_review_grant";
    return {
      ok: false,
      reason: "automatic_review_not_authorized",
      detail: {
        check,
        message:
          check === "implementation_review_scope_invalid"
            ? "Implementation review scope is missing or invalid."
            : "The automation section must contain the implementation-review grant sentence.",
      },
    };
  }
  if (policy.implementation === null) {
    return {
      ok: false,
      reason: "reviewer_binding_missing",
      detail: {
        check: "reviewer_implementation_row_missing",
        message: "The host-binding table must include a reviewer.implementation row.",
      },
    };
  }
  return { ok: true, binding: policy.implementation, scope: policy.implementation_review_scope };
}

export function implementationProducerIdentity(
  policy: Extract<AgentsPolicyParse, { ok: true }>,
):
  | { ok: true; identity: ProducerIdentity }
  | {
      ok: false;
      reason: "reviewer_binding_missing";
      detail: { check: ImplementationProducerFailureCheck; message: string };
    } {
  if (policy.implementer === null) {
    return {
      ok: false,
      reason: "reviewer_binding_missing",
      detail: {
        check: "implementer_row_missing",
        message: "The host-binding table must include an implementer row.",
      },
    };
  }
  return {
    ok: true,
    identity: { role: "implementer", host: policy.implementer.host },
  };
}

export function automaticImplementationAdmission(
  policy: Extract<AgentsPolicyParse, { ok: true }>,
):
  | { ok: true; binding: ReviewerBinding; write_scope: readonly string[]; max_cycles: 1 | 2 | 3 }
  | {
      ok: false;
      reason: "automatic_review_not_authorized" | "reviewer_binding_missing";
      detail: { check: AutomaticImplementationFailureCheck; message: string };
    } {
  if (
    !policy.automatic_implementation_authorized ||
    policy.automatic_implementation_write_scope === null ||
    policy.max_implementation_review_cycles === null ||
    !policy.automatic_correction_review_authorized
  ) {
    const check = policy.automatic_implementation_failure ?? "automatic_implementation_grant";
    return {
      ok: false,
      reason: "automatic_review_not_authorized",
      detail: {
        check,
        message:
          check === "automatic_write_scope_invalid"
            ? "Automatic implementation write scope is missing or invalid."
            : check === "write_review_scope_contradiction"
              ? "Automatic implementation write scope contradicts implementation review scope."
              : check === "implementation_cycle_sentence"
                ? "Automatic implementation requires an independent implementation-review cycle sentence."
                : "The automation section must contain the automatic implementation grant sentence.",
      },
    };
  }
  if (policy.implementer === null) {
    return {
      ok: false,
      reason: "reviewer_binding_missing",
      detail: {
        check: "implementer_row_missing",
        message: "The host-binding table must include an implementer row.",
      },
    };
  }
  return {
    ok: true,
    binding: policy.implementer,
    write_scope: policy.automatic_implementation_write_scope,
    max_cycles: policy.max_implementation_review_cycles,
  };
}

function collectLevel2Sections(markdown: string): { heading: string; body: string }[] {
  const lines = markdown.split("\n");
  const indices: { heading: string; start: number; bodyStart: number }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^## /.test(line) || /^# /.test(line)) {
      if (/^## /.test(line)) {
        indices.push({ heading: line, start: i, bodyStart: i + 1 });
      } else if (indices.length > 0) {
        indices.push({ heading: "", start: i, bodyStart: i });
      }
    }
  }
  const sections: { heading: string; body: string }[] = [];
  for (let i = 0; i < indices.length; i += 1) {
    const current = indices[i];
    if (!current || !current.heading.startsWith("## ")) {
      continue;
    }
    const next = indices[i + 1];
    const end = next ? next.start : lines.length;
    sections.push({
      heading: current.heading,
      body: lines.slice(current.bodyStart, end).join("\n"),
    });
  }
  return sections;
}

function skipLeadingBlanks(lines: string[]): string[] {
  let i = 0;
  while (i < lines.length && (lines[i] ?? "").trim() === "") {
    i += 1;
  }
  return lines.slice(i);
}

function readFirstTable(
  lines: string[],
): { headers: string[]; rows: string[][]; invalid?: boolean } | null {
  if (lines.length < 2) {
    return null;
  }
  const header = parseTableRow(lines[0] ?? "");
  const separator = parseTableRow(lines[1] ?? "");
  if (!header || !separator) {
    return null;
  }
  if (!separator.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")))) {
    return { headers: header, rows: [], invalid: true };
  }
  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      break;
    }
    if (!line.trim().startsWith("|")) {
      break;
    }
    const row = parseTableRow(line);
    if (!row) {
      return { headers: header, rows, invalid: true };
    }
    rows.push(row);
  }
  return { headers: header, rows };
}

function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) {
    return null;
  }
  const inner = trimmed.endsWith("|") ? trimmed.slice(1, -1) : trimmed.slice(1);
  return inner.split("|").map((cell) => cell.trim());
}
