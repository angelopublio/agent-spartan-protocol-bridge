import fs from "node:fs/promises";
import { accessSync, constants as fsConstants } from "node:fs";
import path from "node:path";
import {
  CLAUDE_LAUNCHER_ID,
  CODEX_LAUNCHER_ID,
  CURSOR_LAUNCHER_ID,
  FAKE_LAUNCHER_ID,
  GROK_LAUNCHER_ID,
  type CanonicalHost,
  type ReviewKind,
} from "./contracts.ts";
import type { AppDeps } from "./review.ts";
import { buildAdapterOutputExcerpt } from "./review.ts";
import { AdapterFailureError, capabilitiesAllowed, isProducerAdapter, producerCapabilitiesAllowed, type LauncherCatalog } from "../adapters/adapter.ts";
import {
  parseAgentsPolicy,
  type AgentsPolicyParse,
  type AgentsPolicyReason,
  type ReviewerBinding,
} from "../policy/agents-policy.ts";
import {
  loadRegistry,
  RegistryUnavailableError,
  resolveLauncherId,
  type ClientContextRegistry,
  type RegistrySource,
} from "../policy/registry.ts";
import { resolveReadableDirectory } from "../runtime/paths.ts";

export type DoctorPolicyReadiness = {
  configured: boolean;
  resolves: boolean;
  reason: AgentsPolicyReason | null;
  message: string | null;
};

export const BINDING_ADAPTER_REASONS = [
  "policy_unavailable",
  "binding_missing",
  "registry_unavailable",
  "registry_invalid",
  "client_context_unavailable",
  "launcher_unavailable",
  "capability_denied",
  "reviewer_output_unconstrained",
  "interface_unavailable",
] as const;

export type BindingAdapterReason = (typeof BINDING_ADAPTER_REASONS)[number];
export type BindingAdapterName = "reviewer.plan" | "reviewer.implementation" | "implementer";

export type BindingAdapterResult =
  | {
      binding: BindingAdapterName;
      available: true;
      launcher_id: string;
      reason: null;
      output_excerpt: null;
      failure_hint: null;
    }
  | {
      binding: BindingAdapterName;
      available: false;
      launcher_id: string | null;
      reason: BindingAdapterReason;
      output_excerpt: string | null;
      failure_hint: string | null;
    };

export const ADAPTER_FAILURE_SIGNATURE_HINTS: { pattern: RegExp; hint: string }[] = [
  {
    pattern: /wrap-official-client.*resolve-profile.*No such file or directory/,
    hint:
      "the isolated-profile launcher wrapper anchors `resolve-profile` to `$HOME`, which a relocated-HOME session breaks; anchor it to the wrapper's own directory — see `docs/AUTHENTICATION-AND-SECURITY.md` and `docs/examples/agent-profiles/wrap-official-client`.",
  },
];

const HOST_EXECUTABLE: Partial<Record<CanonicalHost, string>> = {
  claude: "claude",
  codex: "codex",
  cursor: "cursor-agent",
  grok: "grok",
};

export type DoctorReport = {
  repo_readable: boolean;
  policy: DoctorPolicyReadiness;
  registry: {
    readable: boolean;
    schema_valid: boolean;
  };
  launchers: { id: string; resolved: boolean }[];
  fake_interface: {
    available: boolean;
    review_kind_plan: boolean;
    permission_mode_read_only: boolean;
    workspace_write: boolean;
  };
  cursor_interface: {
    executable_resolved: boolean;
    interface_available: boolean;
  };
  codex_interface: {
    executable_resolved: boolean;
    interface_available: boolean;
  };
  grok_interface: {
    executable_resolved: boolean;
    interface_available: boolean;
  };
  claude_interface: {
    executable_resolved: boolean;
    interface_available: boolean;
  };
  bindings: [BindingAdapterResult, BindingAdapterResult, BindingAdapterResult];
  warnings: string[];
};

const POLICY_UNREAD: DoctorPolicyReadiness = {
  configured: false,
  resolves: false,
  reason: null,
  message: null,
};

export async function doctor(repo: string, deps: AppDeps): Promise<DoctorReport> {
  let repo_readable = true;
  let repoRoot: string | undefined;
  try {
    repoRoot = await resolveReadableDirectory(repo);
  } catch {
    repo_readable = false;
  }

  let registry: ClientContextRegistry | undefined;
  let readable = true;
  let schema_valid = false;
  try {
    registry = await loadRegistry(deps.registry);
    schema_valid = true;
  } catch (error) {
    if (error instanceof RegistryUnavailableError) {
      readable = false;
    } else {
      readable = true;
      schema_valid = false;
    }
  }

  const launchers: { id: string; resolved: boolean }[] = [];
  if (registry) {
    const ids = new Set<string>();
    for (const context of Object.values(registry.client_contexts)) {
      for (const host of Object.values(context)) {
        ids.add(host.launcher);
      }
    }
    for (const id of ids) {
      launchers.push({ id, resolved: launcherKnown(deps.catalog, id) });
    }
  }
  if (!launchers.some((item) => item.id === FAKE_LAUNCHER_ID)) {
    launchers.push({
      id: FAKE_LAUNCHER_ID,
      resolved: launcherKnown(deps.catalog, FAKE_LAUNCHER_ID),
    });
  }
  if (!launchers.some((item) => item.id === CURSOR_LAUNCHER_ID)) {
    launchers.push({
      id: CURSOR_LAUNCHER_ID,
      resolved: launcherKnown(deps.catalog, CURSOR_LAUNCHER_ID),
    });
  }
  if (!launchers.some((item) => item.id === CODEX_LAUNCHER_ID)) {
    launchers.push({
      id: CODEX_LAUNCHER_ID,
      resolved: launcherKnown(deps.catalog, CODEX_LAUNCHER_ID),
    });
  }

  let fake_interface = {
    available: false,
    review_kind_plan: false,
    permission_mode_read_only: false,
    workspace_write: true,
  };
  try {
    const adapter = deps.catalog.resolve(FAKE_LAUNCHER_ID);
    const caps = adapter.capabilities();
    fake_interface = {
      available: capabilitiesAllowed(caps),
      review_kind_plan: caps.review_kinds.includes("plan"),
      permission_mode_read_only: caps.permission_modes.includes("read-only"),
      workspace_write: caps.workspace_write,
    };
  } catch {
    fake_interface = {
      available: false,
      review_kind_plan: false,
      permission_mode_read_only: false,
      workspace_write: false,
    };
  }

  let cursor_interface = {
    executable_resolved: launcherKnown(deps.catalog, CURSOR_LAUNCHER_ID),
    interface_available: false,
  };
  try {
    const adapter = deps.catalog.resolve(CURSOR_LAUNCHER_ID);
    await adapter.preflight();
    cursor_interface = {
      executable_resolved: true,
      interface_available: true,
    };
  } catch {
    cursor_interface = {
      executable_resolved: launcherKnown(deps.catalog, CURSOR_LAUNCHER_ID),
      interface_available: false,
    };
  }

  let codex_interface = {
    executable_resolved: launcherKnown(deps.catalog, CODEX_LAUNCHER_ID),
    interface_available: false,
  };
  try {
    const adapter = deps.catalog.resolve(CODEX_LAUNCHER_ID);
    await adapter.preflight();
    codex_interface = {
      executable_resolved: true,
      interface_available: true,
    };
  } catch {
    codex_interface = {
      executable_resolved: launcherKnown(deps.catalog, CODEX_LAUNCHER_ID),
      interface_available: false,
    };
  }

  let grok_interface = {
    executable_resolved: launcherKnown(deps.catalog, GROK_LAUNCHER_ID),
    interface_available: false,
  };
  try {
    const adapter = deps.catalog.resolve(GROK_LAUNCHER_ID);
    await adapter.preflight();
    grok_interface = {
      executable_resolved: true,
      interface_available: true,
    };
  } catch {
    grok_interface = {
      executable_resolved: launcherKnown(deps.catalog, GROK_LAUNCHER_ID),
      interface_available: false,
    };
  }

  let claude_interface = {
    executable_resolved: launcherKnown(deps.catalog, CLAUDE_LAUNCHER_ID),
    interface_available: false,
  };
  try {
    const adapter = deps.catalog.resolve(CLAUDE_LAUNCHER_ID);
    await adapter.preflight();
    claude_interface = {
      executable_resolved: true,
      interface_available: true,
    };
  } catch {
    claude_interface = {
      executable_resolved: launcherKnown(deps.catalog, CLAUDE_LAUNCHER_ID),
      interface_available: false,
    };
  }

  const policyRead = repoRoot === undefined ? undefined : await readPolicy(repoRoot);
  const policy = policyRead?.readiness ?? POLICY_UNREAD;
  const bindings: [BindingAdapterResult, BindingAdapterResult, BindingAdapterResult] = [
    await assessBinding({
      binding: "reviewer.plan",
      reviewKind: "plan",
      parsed: policyRead?.parsed ?? null,
      policy,
      registry,
      registryReadable: readable,
      registrySchemaValid: schema_valid,
      catalog: deps.catalog,
    }),
    await assessBinding({
      binding: "reviewer.implementation",
      reviewKind: "implementation",
      parsed: policyRead?.parsed ?? null,
      policy,
      registry,
      registryReadable: readable,
      registrySchemaValid: schema_valid,
      catalog: deps.catalog,
    }),
    await assessBinding({
      binding: "implementer",
      reviewKind: "plan",
      parsed: policyRead?.parsed ?? null,
      policy,
      registry,
      registryReadable: readable,
      registrySchemaValid: schema_valid,
      catalog: deps.catalog,
    }),
  ];
  const warnings = await collectDoctorWarnings(policyRead?.parsed ?? null, bindings);

  return {
    repo_readable,
    policy,
    registry: { readable, schema_valid },
    launchers,
    fake_interface,
    cursor_interface,
    codex_interface,
    grok_interface,
    claude_interface,
    bindings,
    warnings,
  };
}

async function readPolicy(repoRoot: string): Promise<{
  readiness: DoctorPolicyReadiness;
  parsed: AgentsPolicyParse;
}> {
  let markdown = "";
  try {
    markdown = await fs.readFile(path.join(repoRoot, "AGENTS.md"), "utf8");
  } catch {
    markdown = "";
  }
  const parsed = parseAgentsPolicy(markdown);
  return { readiness: policyReadiness(parsed), parsed };
}

function reviewerBindingFromPolicy(
  parsed: AgentsPolicyParse,
  binding: BindingAdapterName,
): ReviewerBinding | null {
  if (!parsed.ok) {
    return null;
  }
  if (binding === "reviewer.plan") {
    return {
      host: parsed.host,
      client_context: parsed.client_context,
      model: parsed.model,
      effort: parsed.effort,
    };
  }
  if (binding === "implementer") {
    return parsed.implementer;
  }
  return parsed.implementation;
}

function unavailable(
  binding: BindingAdapterName,
  reason: BindingAdapterReason,
  launcher_id: string | null = null,
  output_excerpt: string | null = null,
  failure_hint: string | null = null,
): BindingAdapterResult {
  return { binding, available: false, launcher_id, reason, output_excerpt, failure_hint };
}

function available(binding: BindingAdapterName, launcher_id: string): BindingAdapterResult {
  return { binding, available: true, launcher_id, reason: null, output_excerpt: null, failure_hint: null };
}

function matchAdapterFailureHint(excerpt: string): string | null {
  for (const entry of ADAPTER_FAILURE_SIGNATURE_HINTS) {
    if (entry.pattern.test(excerpt)) {
      return entry.hint;
    }
  }
  return null;
}

function resolveExecutableOnPath(name: string, env: NodeJS.ProcessEnv): string | null {
  if (name.includes("/")) {
    return name;
  }
  const dirs = (env.PATH ?? "").split(path.delimiter).filter((d) => d.length > 0);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // not here; keep looking
    }
  }
  return null;
}

const CURSOR_HOME_PATH = /\/cursor-home(?:\/|$)/;

/**
 * True when the isolated-profile wrapper will restore the real `HOME` for the
 * nested official client, so a `cursor-home` `HOME` in the current environment
 * is not the environment `claude` / `codex` actually run under. The wrapper
 * (`docs/examples/agent-profiles/wrap-official-client`) restores `HOME` from
 * `AGENT_PROFILES_REAL_HOME` only when the per-host config var is already set —
 * `CLAUDE_CONFIG_DIR` for `claude`, `CODEX_HOME` for `codex` — and only when the
 * marker points somewhere other than a cursor-home path. Env names and paths
 * only; login-file contents are never inspected.
 */
function homeRestoreArmed(host: CanonicalHost, env: NodeJS.ProcessEnv): boolean {
  const marker = env.AGENT_PROFILES_REAL_HOME ?? "";
  if (marker === "" || CURSOR_HOME_PATH.test(marker)) {
    return false;
  }
  if (host === "claude") {
    return (env.CLAUDE_CONFIG_DIR ?? "") !== "";
  }
  if (host === "codex") {
    return (env.CODEX_HOME ?? "") !== "";
  }
  return false;
}

export async function wrapperLauncherWarnings(
  host: CanonicalHost,
  env: NodeJS.ProcessEnv,
  options: {
    binding?: BindingAdapterName | CanonicalHost;
    declaredClientContexts?: readonly string[];
  } = {},
): Promise<string[]> {
  const executableName = HOST_EXECUTABLE[host];
  if (executableName === undefined) {
    return [];
  }
  const executablePath = resolveExecutableOnPath(executableName, env);
  if (executablePath === null) {
    return [];
  }
  let text: string;
  try {
    text = await fs.readFile(executablePath, "utf8");
  } catch {
    return [];
  }
  if (!text.startsWith("#!") || (!text.includes("resolve-profile") && !text.includes("wrap-official-client"))) {
    return [];
  }
  const binding = options.binding ?? host;
  const warnings: string[] = [];
  if (new Set(options.declaredClientContexts ?? []).size > 1) {
    warnings.push(
      `binding ${binding}: wrapper launcher ${executableName} cannot resolve a unique client context because the Agent hosts table declares more than one distinct client context`,
    );
  }
  const scriptDir = path.dirname(executablePath);
  const profilesRoot = path.dirname(scriptDir);
  const resolveProfile = env.AGENT_PROFILES_RESOLVE ?? path.join(profilesRoot, "resolve-profile");
  try {
    await fs.access(resolveProfile);
  } catch {
    warnings.push(
      `binding ${binding}: wrapper launcher ${executableName} references resolve-profile but ${resolveProfile} does not exist from the current environment`,
    );
  }
  const home = env.HOME ?? "";
  if (host === "claude" && CURSOR_HOME_PATH.test(home) && !homeRestoreArmed(host, env)) {
    warnings.push(
      `binding ${binding}: HOME matches a cursor-home path while the reviewer host is Claude Code; the launcher environment may not match what the wrapper expects`,
    );
  }
  return warnings;
}

async function collectDoctorWarnings(
  parsed: AgentsPolicyParse | null,
  bindings: [BindingAdapterResult, BindingAdapterResult, BindingAdapterResult],
): Promise<string[]> {
  if (parsed === null || !parsed.ok) {
    return [];
  }
  const warnings: string[] = [];
  const seenReviewerHosts = new Set<CanonicalHost>();
  for (const binding of bindings) {
    const selected = reviewerBindingFromPolicy(parsed, binding.binding);
    if (selected === null) {
      continue;
    }
    if (binding.binding !== "implementer" && seenReviewerHosts.has(selected.host)) {
      continue;
    }
    if (binding.binding !== "implementer") {
      seenReviewerHosts.add(selected.host);
    }
    warnings.push(...(await wrapperLauncherWarnings(selected.host, process.env, {
      binding: binding.binding,
      ...(binding.binding === "implementer"
        ? { declaredClientContexts: parsed.declared_client_contexts }
        : {}),
    })));
  }
  return warnings;
}

async function assessBinding(input: {
  binding: BindingAdapterName;
  reviewKind: ReviewKind;
  parsed: AgentsPolicyParse | null;
  policy: DoctorPolicyReadiness;
  registry: ClientContextRegistry | undefined;
  registryReadable: boolean;
  registrySchemaValid: boolean;
  catalog: LauncherCatalog;
}): Promise<BindingAdapterResult> {
  if (input.parsed === null || !input.parsed.ok || !input.policy.configured || !input.policy.resolves) {
    return unavailable(input.binding, "policy_unavailable");
  }
  const selected = reviewerBindingFromPolicy(input.parsed, input.binding);
  if (selected === null) {
    return unavailable(input.binding, "binding_missing");
  }
  if (!input.registryReadable) {
    return unavailable(input.binding, "registry_unavailable");
  }
  if (!input.registrySchemaValid || input.registry === undefined) {
    return unavailable(input.binding, "registry_invalid");
  }
  let launcherId: string;
  try {
    launcherId = resolveLauncherId(input.registry, selected.client_context, selected.host);
  } catch {
    return unavailable(input.binding, "client_context_unavailable");
  }
  let adapter;
  try {
    adapter = input.catalog.resolve(launcherId);
  } catch {
    return unavailable(input.binding, "launcher_unavailable");
  }
  if (input.binding === "implementer") {
    if (!isProducerAdapter(adapter)) {
      return unavailable(input.binding, "capability_denied");
    }
    try {
      const producerCaps = adapter.producerCapabilities();
      if (!producerCapabilitiesAllowed(producerCaps) || producerCaps.launcher_id !== launcherId) {
        return unavailable(input.binding, "capability_denied");
      }
    } catch {
      return unavailable(input.binding, "capability_denied");
    }
    try {
      await adapter.producerPreflight();
    } catch {
      return unavailable(input.binding, "interface_unavailable");
    }
    return available(input.binding, launcherId);
  }
  try {
    const capabilities = adapter.capabilities();
    if (
      !capabilitiesAllowed(capabilities) ||
      capabilities.launcher_id !== launcherId ||
      !capabilities.review_kinds.includes(input.reviewKind)
    ) {
      return unavailable(input.binding, "capability_denied", launcherId);
    }
    if (!capabilities.structured_output) {
      return unavailable(input.binding, "reviewer_output_unconstrained", launcherId);
    }
  } catch {
    return unavailable(input.binding, "capability_denied", launcherId);
  }
  try {
    await adapter.preflight();
  } catch (error) {
    let output_excerpt: string | null = null;
    let failure_hint: string | null = null;
    if (error instanceof AdapterFailureError) {
      const excerpt = buildAdapterOutputExcerpt("preflight", error.stderr, error.output, error.payload);
      output_excerpt = excerpt.output_excerpt;
      if (output_excerpt !== null) {
        failure_hint = matchAdapterFailureHint(output_excerpt);
      }
    }
    return unavailable(input.binding, "interface_unavailable", launcherId, output_excerpt, failure_hint);
  }
  return available(input.binding, launcherId);
}

function policyReadiness(parsed: AgentsPolicyParse): DoctorPolicyReadiness {
  if (parsed.ok) {
    return { configured: true, resolves: true, reason: null, message: null };
  }
  if (parsed.detail.check === "agent_hosts_section_missing") {
    return { configured: false, resolves: false, reason: parsed.reason, message: parsed.detail.message };
  }
  return {
    configured: true,
    resolves: false,
    reason: parsed.reason,
    message: parsed.detail.message,
  };
}

function launcherKnown(catalog: LauncherCatalog, id: string): boolean {
  try {
    catalog.resolve(id);
    return true;
  } catch {
    return false;
  }
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [
    `repo: ${report.repo_readable ? "readable" : "unreadable"}`,
    formatPolicyLine(report),
    `registry: ${report.registry.readable ? "readable" : "unreadable"}; schema ${report.registry.schema_valid ? "valid" : "invalid"}`,
    ...report.launchers.map(
      (launcher) => `launcher ${launcher.id}: ${launcher.resolved ? "resolved" : "unresolved"}`,
    ),
    `fake-reviewer-v1: ${report.fake_interface.available ? "interface available" : "interface unavailable"}; review_kind=plan:${report.fake_interface.review_kind_plan}; permission_mode=read-only:${report.fake_interface.permission_mode_read_only}; workspace_write:${report.fake_interface.workspace_write}`,
    `cursor-plan-reviewer-v1: executable ${report.cursor_interface.executable_resolved ? "resolved" : "unresolved"}; interface ${report.cursor_interface.interface_available ? "available" : "unavailable"}`,
    `codex-plan-reviewer-v1: executable ${report.codex_interface.executable_resolved ? "resolved" : "unresolved"}; interface ${report.codex_interface.interface_available ? "available" : "unavailable"}`,
    `grok-plan-reviewer-v1: executable ${report.grok_interface.executable_resolved ? "resolved" : "unresolved"}; interface ${report.grok_interface.interface_available ? "available" : "unavailable"}`,
    `claude-plan-reviewer-v1: executable ${report.claude_interface.executable_resolved ? "resolved" : "unresolved"}; interface ${report.claude_interface.interface_available ? "available" : "unavailable"}`,
    ...report.bindings.map(formatBindingLine),
    ...report.warnings.map((warning) => `warning: ${warning}`),
  ];
  return `${lines.join("\n")}\n`;
}

function formatBindingLine(result: BindingAdapterResult): string {
  if (result.available) {
    return `binding ${result.binding}: adapter available; launcher=${result.launcher_id}`;
  }
  const lines = [`binding ${result.binding}: adapter unavailable; reason=${result.reason}`];
  if (result.output_excerpt !== null) {
    lines.push(`binding ${result.binding} output_excerpt: ${result.output_excerpt}`);
  }
  if (result.failure_hint !== null) {
    lines.push(`binding ${result.binding} hint: ${result.failure_hint}`);
  }
  return lines.join("\n");
}

function formatPolicyLine(report: DoctorReport): string {
  if (!report.repo_readable) {
    return "policy: unread";
  }
  if (!report.policy.configured) {
    return "policy: not configured";
  }
  if (report.policy.resolves) {
    return "policy: configured; resolves";
  }
  return `policy: configured; invalid (${report.policy.reason}): ${report.policy.message}`;
}

export function doctorExitCode(report: DoctorReport): 0 | 1 {
  if (!report.repo_readable) {
    return 1;
  }
  if (report.policy.configured && !report.policy.resolves) {
    return 1;
  }
  return 0;
}

export type { RegistrySource };
