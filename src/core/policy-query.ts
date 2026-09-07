import fs from "node:fs/promises";
import path from "node:path";
import type { EffortLevel } from "./contracts.ts";
import { parseAgentsPolicy } from "../policy/agents-policy.ts";
import {
  loadBridgeConfig,
  resolveModelBindingMode,
  type ModelBindingMode,
} from "../policy/bridge-config.ts";
import { resolveReadableDirectory } from "../runtime/paths.ts";

export const POLICY_QUERY_ROLES = ["planner", "implementer"] as const;
export type PolicyQueryRole = (typeof POLICY_QUERY_ROLES)[number];

export type PolicyQueryDocument = {
  role: PolicyQueryRole;
  model_binding_mode: ModelBindingMode;
  binding_model: string | null;
  binding_effort: EffortLevel | null;
};

export type PolicyQueryResult =
  | { ok: true; document: PolicyQueryDocument }
  | { ok: false; reason: "repo_unreadable" | "config_invalid" };

export function isPolicyQueryRole(value: string): value is PolicyQueryRole {
  return value === "planner" || value === "implementer";
}

export function serializePolicyQuery(document: PolicyQueryDocument): string {
  return `${JSON.stringify({
    role: document.role,
    model_binding_mode: document.model_binding_mode,
    binding_model: document.binding_model,
    binding_effort: document.binding_effort,
  })}\n`;
}

export async function queryProducerPolicy(repo: string, role: PolicyQueryRole): Promise<PolicyQueryResult> {
  let repoRoot: string;
  try {
    repoRoot = await resolveReadableDirectory(repo);
  } catch {
    return { ok: false, reason: "repo_unreadable" };
  }
  const config = await loadBridgeConfig(repoRoot);
  if (config.kind === "invalid") {
    return { ok: false, reason: "config_invalid" };
  }
  const model_binding_mode = resolveModelBindingMode(config);
  let markdown = "";
  try {
    markdown = await fs.readFile(path.join(repoRoot, "AGENTS.md"), "utf8");
  } catch {
    markdown = "";
  }
  const parsed = parseAgentsPolicy(markdown);
  const binding = parsed.ok ? (role === "planner" ? parsed.planner : parsed.implementer) : null;
  return {
    ok: true,
    document: {
      role,
      model_binding_mode,
      binding_model: binding?.model ?? null,
      binding_effort: binding?.effort ?? null,
    },
  };
}
