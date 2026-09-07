import {
  CANONICAL_HOSTS,
  isRegistrySchemaVersion,
  REGISTRY_SCHEMA_VERSION,
  type CanonicalHost,
} from "../core/contracts.ts";
import { isSensitiveRegistryKey } from "./sensitive-fields.ts";
import { isValidClientContextAlias } from "./task-frontmatter.ts";
import { isMap, isPair, parseDocument } from "yaml";
import type { Node, Pair, YAMLMap } from "yaml";

export type RegistryHostEntry = { launcher: string };
export type RegistryContext = Record<CanonicalHost, RegistryHostEntry>;
export type ClientContextRegistry = {
  schema_version: typeof REGISTRY_SCHEMA_VERSION;
  client_contexts: Record<string, RegistryContext>;
};

export type RegistrySource = {
  load(): Promise<string>;
};

export class RegistryUnavailableError extends Error {
  override readonly name = "RegistryUnavailableError";
  constructor() {
    super("registry_unavailable");
  }
}

export class RegistrySensitiveFieldError extends Error {
  override readonly name = "RegistrySensitiveFieldError";
  constructor() {
    super("registry_sensitive_field");
  }
}

export class RegistrySchemaInvalidError extends Error {
  override readonly name = "RegistrySchemaInvalidError";
  constructor() {
    super("registry_schema_invalid");
  }
}

export class RegistryContextIncompleteError extends Error {
  override readonly name = "RegistryContextIncompleteError";
  constructor() {
    super("registry_context_incomplete");
  }
}

export async function loadRegistry(source: RegistrySource): Promise<ClientContextRegistry> {
  let raw: string;
  try {
    raw = await source.load();
  } catch (error) {
    if (error instanceof RegistryUnavailableError) {
      throw error;
    }
    throw new RegistryUnavailableError();
  }
  return parseRegistryYaml(raw);
}

export function parseRegistryYaml(raw: string): ClientContextRegistry {
  const doc = parseDocument(raw, {
    prettyErrors: true,
    uniqueKeys: true,
    merge: false,
    strict: true,
    stringKeys: true,
  });
  if (doc.errors.length > 0 || !isMap(doc.contents)) {
    throw new RegistrySchemaInvalidError();
  }
  const structuralKeys = collectStructuralKeys(doc.contents);
  if (structuralKeys.some((key) => isSensitiveRegistryKey(key))) {
    throw new RegistrySensitiveFieldError();
  }
  let parsed: unknown;
  try {
    parsed = doc.toJS({ mapAsMap: false, maxAliasCount: 0 });
  } catch {
    throw new RegistrySchemaInvalidError();
  }
  if (!isPlainObject(parsed)) {
    throw new RegistrySchemaInvalidError();
  }
  const keys = Object.keys(parsed);
  if (keys.length !== 2 || !keys.includes("schema_version") || !keys.includes("client_contexts")) {
    throw new RegistrySchemaInvalidError();
  }
  if (!isRegistrySchemaVersion(parsed.schema_version)) {
    throw new RegistrySchemaInvalidError();
  }
  const contexts = parsed.client_contexts;
  if (!isPlainObject(contexts)) {
    throw new RegistrySchemaInvalidError();
  }
  const client_contexts: Record<string, RegistryContext> = {};
  for (const [alias, value] of Object.entries(contexts)) {
    if (!isValidClientContextAlias(alias) || !isPlainObject(value)) {
      throw new RegistrySchemaInvalidError();
    }
    const hostKeys = Object.keys(value);
    for (const host of CANONICAL_HOSTS) {
      if (!hostKeys.includes(host)) {
        throw new RegistryContextIncompleteError();
      }
    }
    if (hostKeys.length !== CANONICAL_HOSTS.length) {
      throw new RegistrySchemaInvalidError();
    }
    const context = {} as RegistryContext;
    for (const host of CANONICAL_HOSTS) {
      const entry = value[host];
      if (!isPlainObject(entry)) {
        throw new RegistrySchemaInvalidError();
      }
      const entryKeys = Object.keys(entry);
      if (entryKeys.length !== 1 || entryKeys[0] !== "launcher") {
        throw new RegistrySchemaInvalidError();
      }
      if (typeof entry.launcher !== "string" || entry.launcher.length === 0) {
        throw new RegistrySchemaInvalidError();
      }
      context[host] = { launcher: entry.launcher };
    }
    client_contexts[alias] = context;
  }
  return { schema_version: REGISTRY_SCHEMA_VERSION, client_contexts };
}

export function resolveLauncherId(
  registry: ClientContextRegistry,
  clientContext: string,
  host: CanonicalHost,
): string {
  const context = registry.client_contexts[clientContext];
  if (!context) {
    throw new Error("client_context_unavailable");
  }
  const entry = context[host];
  if (!entry) {
    throw new RegistryContextIncompleteError();
  }
  return entry.launcher;
}

function collectStructuralKeys(root: YAMLMap): string[] {
  const keys: string[] = [];
  for (const item of root.items) {
    if (!isPair(item)) {
      continue;
    }
    const key = yamlKey(item);
    if (key != null) {
      keys.push(key);
    }
    if (key === "client_contexts" && isMap(item.value)) {
      for (const aliasPair of item.value.items) {
        if (!isPair(aliasPair) || !isMap(aliasPair.value)) {
          continue;
        }
        for (const hostPair of aliasPair.value.items) {
          if (!isPair(hostPair)) {
            continue;
          }
          const hostKey = yamlKey(hostPair);
          if (hostKey != null) {
            keys.push(hostKey);
          }
          if (isMap(hostPair.value)) {
            for (const field of hostPair.value.items) {
              if (!isPair(field)) {
                continue;
              }
              const fieldKey = yamlKey(field);
              if (fieldKey != null) {
                keys.push(fieldKey);
              }
            }
          }
        }
      }
    } else if (key !== "schema_version" && isMap(item.value)) {
      collectNestedStructuralKeys(item.value, keys);
    }
  }
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
