import fs from "node:fs/promises";
import path from "node:path";
import { isAlias, isMap, isPair, isSeq, parseDocument } from "yaml";
import type { Document, Node, Pair, YAMLMap } from "yaml";
import { producerPathDenied } from "../core/snapshot.ts";
import { PRODUCER_SUPPORT_SCOPE } from "../core/workspace.ts";
import { isValidScopePath } from "./agents-policy.ts";
import { isSensitiveRegistryKey } from "./sensitive-fields.ts";

export const BRIDGE_CONFIG_SCHEMA_VERSION = 1 as const;
export const BRIDGE_CONFIG_REL = "spartan-bridge/config.yaml";
export const TRANSITION_REVIEW_PLAN_PASS = "review_plan_pass" as const;
export const TRANSITION_SUCCESSOR_IMPLEMENTER = "implementer" as const;
export const DISPATCH_MODES = ["automatic", "manual"] as const;
export type DispatchMode = (typeof DISPATCH_MODES)[number];
export const MODEL_BINDING_MODES = ["advisory", "warn", "strict"] as const;
export type ModelBindingMode = (typeof MODEL_BINDING_MODES)[number];

export type BridgeConfig =
  | { kind: "absent" }
  | {
      kind: "valid";
      schema_version: typeof BRIDGE_CONFIG_SCHEMA_VERSION;
      dispatch: DispatchMode;
      successor: typeof TRANSITION_SUCCESSOR_IMPLEMENTER;
      implementer_timeout_ms?: number;
      model_binding?: ModelBindingMode;
      scratch_prefixes?: readonly string[];
    }
  | { kind: "invalid"; reason: "config_invalid" };

export function resolveProducerTimeoutMs(config: BridgeConfig, defaultMs: number): number {
  if (config.kind !== "valid" || config.implementer_timeout_ms === undefined) {
    return defaultMs;
  }
  return Math.max(defaultMs, config.implementer_timeout_ms);
}

export function resolveModelBindingMode(config: BridgeConfig): ModelBindingMode {
  if (config.kind !== "valid" || config.model_binding === undefined) {
    return "advisory";
  }
  return config.model_binding;
}

export async function loadBridgeConfig(repoRoot: string): Promise<BridgeConfig> {
  const abs = path.join(repoRoot, ...BRIDGE_CONFIG_REL.split("/"));
  let raw: string;
  try {
    const stat = await fs.lstat(abs);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return { kind: "invalid", reason: "config_invalid" };
    }
    raw = await fs.readFile(abs, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { kind: "absent" };
    }
    return { kind: "invalid", reason: "config_invalid" };
  }
  return parseBridgeConfigYaml(raw);
}

export function parseBridgeConfigYaml(raw: string): BridgeConfig {
  const doc = parseDocument(raw, {
    prettyErrors: true,
    uniqueKeys: true,
    merge: false,
    strict: true,
    stringKeys: true,
  });
  if (doc.errors.length > 0 || hasForbiddenYaml(doc) || !isMap(doc.contents)) {
    return { kind: "invalid", reason: "config_invalid" };
  }
  const structuralKeys = collectStructuralKeys(doc.contents);
  if (structuralKeys.some((key) => isSensitiveRegistryKey(key))) {
    return { kind: "invalid", reason: "config_invalid" };
  }
  let parsed: unknown;
  try {
    parsed = doc.toJS({ mapAsMap: false, maxAliasCount: 0 });
  } catch {
    return { kind: "invalid", reason: "config_invalid" };
  }
  if (!isPlainObject(parsed)) {
    return { kind: "invalid", reason: "config_invalid" };
  }
  const keys = Object.keys(parsed);
  const hasProducer = keys.includes("producer");
  if (!keys.includes("schema_version") || !keys.includes("transitions")) {
    return { kind: "invalid", reason: "config_invalid" };
  }
  if (hasProducer ? keys.length !== 3 : keys.length !== 2) {
    return { kind: "invalid", reason: "config_invalid" };
  }
  if (parsed.schema_version !== BRIDGE_CONFIG_SCHEMA_VERSION) {
    return { kind: "invalid", reason: "config_invalid" };
  }
  const transitions = parsed.transitions;
  if (!isPlainObject(transitions)) {
    return { kind: "invalid", reason: "config_invalid" };
  }
  const transitionKeys = Object.keys(transitions);
  if (transitionKeys.length !== 1 || transitionKeys[0] !== TRANSITION_REVIEW_PLAN_PASS) {
    return { kind: "invalid", reason: "config_invalid" };
  }
  const entry = transitions[TRANSITION_REVIEW_PLAN_PASS];
  if (!isPlainObject(entry)) {
    return { kind: "invalid", reason: "config_invalid" };
  }
  const entryKeys = Object.keys(entry);
  if (
    entryKeys.length < 2 ||
    entryKeys.length > 3 ||
    !entryKeys.includes("successor") ||
    !entryKeys.includes("dispatch")
  ) {
    return { kind: "invalid", reason: "config_invalid" };
  }
  if (entryKeys.length === 3 && !entryKeys.includes("implementer_timeout_ms")) {
    return { kind: "invalid", reason: "config_invalid" };
  }
  if (entry.successor !== TRANSITION_SUCCESSOR_IMPLEMENTER) {
    return { kind: "invalid", reason: "config_invalid" };
  }
  if (entry.dispatch !== "automatic" && entry.dispatch !== "manual") {
    return { kind: "invalid", reason: "config_invalid" };
  }
  let implementer_timeout_ms: number | undefined;
  if (entryKeys.includes("implementer_timeout_ms")) {
    const configured = entry.implementer_timeout_ms;
    if (typeof configured !== "number" || !Number.isInteger(configured) || configured <= 0) {
      return { kind: "invalid", reason: "config_invalid" };
    }
    implementer_timeout_ms = configured;
  }
  let model_binding: ModelBindingMode | undefined;
  let scratch_prefixes: readonly string[] | undefined;
  if (hasProducer) {
    const producer = parsed.producer;
    if (!isPlainObject(producer)) {
      return { kind: "invalid", reason: "config_invalid" };
    }
    const producerKeys = Object.keys(producer);
    if (
      producerKeys.length < 1 ||
      producerKeys.length > 2 ||
      producerKeys.some((key) => key !== "model_binding" && key !== "scratch_prefixes")
    ) {
      return { kind: "invalid", reason: "config_invalid" };
    }
    if (producerKeys.includes("model_binding")) {
      const configured = producer.model_binding;
      if (configured !== "advisory" && configured !== "warn" && configured !== "strict") {
        return { kind: "invalid", reason: "config_invalid" };
      }
      model_binding = configured;
    }
    if (producerKeys.includes("scratch_prefixes")) {
      const configured = producer.scratch_prefixes;
      if (
        !Array.isArray(configured) ||
        configured.length === 0 ||
        configured.some(
          (value) =>
            typeof value !== "string" ||
            !value.endsWith("/") ||
            !isValidScopePath(value) ||
            !isDeclarableProducerScratchPrefix(value),
        )
      ) {
        return { kind: "invalid", reason: "config_invalid" };
      }
      scratch_prefixes = configured as string[];
    }
  }
  return {
    kind: "valid",
    schema_version: BRIDGE_CONFIG_SCHEMA_VERSION,
    dispatch: entry.dispatch,
    successor: TRANSITION_SUCCESSOR_IMPLEMENTER,
    ...(implementer_timeout_ms === undefined ? {} : { implementer_timeout_ms }),
    ...(model_binding === undefined ? {} : { model_binding }),
    ...(scratch_prefixes === undefined ? {} : { scratch_prefixes }),
  };
}

function isDeclarableProducerScratchPrefix(value: string): boolean {
  const prefix = value.slice(0, -1);
  if (!producerPathDenied(prefix)) {
    return true;
  }
  return PRODUCER_SUPPORT_SCOPE.some((supportPrefix) => {
    const supportRoot = supportPrefix.slice(0, -1);
    if (!prefix.startsWith(`${supportRoot}/`)) {
      return false;
    }
    const descendant = prefix.slice(supportRoot.length + 1);
    return descendant.length > 0 && !producerPathDenied(descendant);
  });
}

function collectStructuralKeys(root: YAMLMap): string[] {
  const keys: string[] = [];
  collectNestedStructuralKeys(root, keys);
  return keys;
}

function collectNestedStructuralKeys(map: YAMLMap, keys: string[]): void {
  for (const item of map.items) {
    if (!isPair(item)) {
      continue;
    }
    const key = yamlKey(item);
    if (key != null) {
      keys.push(key);
    }
    if (isMap(item.value)) {
      collectNestedStructuralKeys(item.value, keys);
    }
  }
}

function yamlKey(pair: Pair): string | null {
  const key = pair.key as Node;
  if (key && typeof key.toJSON === "function") {
    const value = key.toJSON();
    return typeof value === "string" ? value : null;
  }
  return null;
}

function hasForbiddenYaml(doc: Document.Parsed): boolean {
  if (doc.warnings.length > 0) {
    return true;
  }
  return yamlNodeForbidden(doc.contents);
}

function yamlNodeForbidden(node: Node | null | undefined): boolean {
  if (node == null) {
    return false;
  }
  if (isAlias(node)) {
    return true;
  }
  if (node.anchor) {
    return true;
  }
  if (node.tag && !node.tag.startsWith("tag:yaml.org,2002:")) {
    return true;
  }
  if (isMap(node)) {
    return yamlMapForbidden(node);
  }
  if (isSeq(node)) {
    return node.items.some((item) => yamlNodeForbidden(item as Node));
  }
  return false;
}

function yamlMapForbidden(map: YAMLMap): boolean {
  for (const item of map.items) {
    const pair = item as Pair;
    const key = pair.key as Node;
    const value = pair.value as Node | null | undefined;
    if (typeof key === "object" && key !== null && "value" in key && key.value === "<<") {
      return true;
    }
    if (yamlNodeForbidden(key) || yamlNodeForbidden(value ?? null)) {
      return true;
    }
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
