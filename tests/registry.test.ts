import assert from "node:assert/strict";
import test from "node:test";
import { parseRegistryYaml } from "../src/policy/registry.ts";
import { isSensitiveRegistryKey } from "../src/policy/sensitive-fields.ts";
import { VALID_REGISTRY } from "./helpers.ts";

test("accepted schema keys remain accepted", () => {
  const registry = parseRegistryYaml(VALID_REGISTRY);
  assert.equal(registry.schema_version, 1);
  assert.ok(registry.client_contexts.personal);
  assert.equal(registry.client_contexts.personal?.cursor.launcher, "fake-reviewer-v1");
});

test("sensitive camelCase snake_case and hyphenated keys fail registry_sensitive_field", () => {
  assert.equal(isSensitiveRegistryKey("apiKey"), true);
  assert.equal(isSensitiveRegistryKey("api_key"), true);
  assert.equal(isSensitiveRegistryKey("api-key"), true);
  assert.equal(isSensitiveRegistryKey("authFile"), true);
  assert.equal(isSensitiveRegistryKey("token"), true);
  assert.equal(isSensitiveRegistryKey("author"), false);
  assert.equal(isSensitiveRegistryKey("authority"), false);
  assert.equal(isSensitiveRegistryKey("envelope"), false);
  const sensitive = `schema_version: 1
client_contexts:
  personal:
    codex:
      launcher: fake-reviewer-v1
    claude:
      launcher: fake-reviewer-v1
    cursor:
      launcher: fake-reviewer-v1
    grok:
      launcher: fake-reviewer-v1
      api_key: nope
`;
  assert.throws(() => parseRegistryYaml(sensitive), /registry_sensitive_field/);
  const camel = sensitive.replace("api_key", "apiKey");
  assert.throws(() => parseRegistryYaml(camel), /registry_sensitive_field/);
  const hyphen = sensitive.replace("api_key", "api-key");
  assert.throws(() => parseRegistryYaml(hyphen), /registry_sensitive_field/);
});

test("author and envelope are ordinary unknown fields", () => {
  const author = `schema_version: 1
client_contexts:
  personal:
    codex:
      launcher: fake-reviewer-v1
    claude:
      launcher: fake-reviewer-v1
    cursor:
      launcher: fake-reviewer-v1
    grok:
      launcher: fake-reviewer-v1
      author: x
`;
  assert.throws(() => parseRegistryYaml(author), /registry_schema_invalid/);
  const envelope = author.replace("author:", "envelope:");
  assert.throws(() => parseRegistryYaml(envelope), /registry_schema_invalid/);
});

test("string schema_version, schema_version 2, and incomplete hosts fail closed", () => {
  assert.throws(
    () => parseRegistryYaml("schema_version: \"1\"\nclient_contexts: {}\n"),
    /registry_schema_invalid/,
  );
  assert.throws(
    () => parseRegistryYaml("schema_version: 2\nclient_contexts: {}\n"),
    /registry_schema_invalid/,
  );
  const incomplete = `schema_version: 1
client_contexts:
  personal:
    codex:
      launcher: fake-reviewer-v1
    claude:
      launcher: fake-reviewer-v1
`;
  assert.throws(() => parseRegistryYaml(incomplete), /registry_context_incomplete/);
});
