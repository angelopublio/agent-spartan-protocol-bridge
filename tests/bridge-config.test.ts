import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import {
  BRIDGE_CONFIG_SCHEMA_VERSION,
  loadBridgeConfig,
  parseBridgeConfigYaml,
  resolveModelBindingMode,
  resolveProducerTimeoutMs,
} from "../src/policy/bridge-config.ts";
import { BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS } from "../src/core/contracts.ts";
import { makeRepo } from "./helpers.ts";

test("absent config is a distinct kind and never invents dispatch", async () => {
  const { root } = await makeRepo();
  assert.deepEqual(await loadBridgeConfig(root), { kind: "absent" });
  await fs.rm(root, { recursive: true, force: true });
});

test("schema-1 automatic and manual configs are accepted", () => {
  assert.deepEqual(
    parseBridgeConfigYaml(`schema_version: 1
transitions:
  review_plan_pass:
    successor: implementer
    dispatch: automatic
`),
    { kind: "valid", schema_version: 1, dispatch: "automatic", successor: "implementer" },
  );
  assert.deepEqual(
    parseBridgeConfigYaml(`schema_version: 1
transitions:
  review_plan_pass:
    successor: implementer
    dispatch: manual
`),
    { kind: "valid", schema_version: 1, dispatch: "manual", successor: "implementer" },
  );
  assert.deepEqual(
    parseBridgeConfigYaml(`schema_version: 1
transitions:
  review_plan_pass:
    successor: implementer
    dispatch: automatic
    implementer_timeout_ms: 3600000
`),
    {
      kind: "valid",
      schema_version: 1,
      dispatch: "automatic",
      successor: "implementer",
      implementer_timeout_ms: 3_600_000,
    },
  );
});

test("resolveProducerTimeoutMs raises only and clamps below-floor values", () => {
  const defaultMs = BRIDGE_DEFAULT_PRODUCER_TIMEOUT_MS;
  assert.equal(resolveProducerTimeoutMs({ kind: "absent" }, defaultMs), defaultMs);
  assert.equal(
    resolveProducerTimeoutMs({ kind: "valid", schema_version: 1, dispatch: "automatic", successor: "implementer" }, defaultMs),
    defaultMs,
  );
  assert.equal(
    resolveProducerTimeoutMs(
      {
        kind: "valid",
        schema_version: 1,
        dispatch: "automatic",
        successor: "implementer",
        implementer_timeout_ms: 600_000,
      },
      defaultMs,
    ),
    defaultMs,
  );
  assert.equal(
    resolveProducerTimeoutMs(
      {
        kind: "valid",
        schema_version: 1,
        dispatch: "automatic",
        successor: "implementer",
        implementer_timeout_ms: 3_600_000,
      },
      defaultMs,
    ),
    3_600_000,
  );
});

test("invalid implementer_timeout_ms values are config_invalid", () => {
  const cases = [
    "schema_version: 1\ntransitions:\n  review_plan_pass:\n    successor: implementer\n    dispatch: automatic\n    implementer_timeout_ms: 0\n",
    "schema_version: 1\ntransitions:\n  review_plan_pass:\n    successor: implementer\n    dispatch: automatic\n    implementer_timeout_ms: -1\n",
    "schema_version: 1\ntransitions:\n  review_plan_pass:\n    successor: implementer\n    dispatch: automatic\n    implementer_timeout_ms: 1.5\n",
    "schema_version: 1\ntransitions:\n  review_plan_pass:\n    successor: implementer\n    dispatch: automatic\n    implementer_timeout_ms: one_hour\n",
  ];
  for (const raw of cases) {
    assert.deepEqual(parseBridgeConfigYaml(raw), { kind: "invalid", reason: "config_invalid" }, raw);
  }
});

test("producer model_binding is accepted and resolveModelBindingMode defaults to advisory", () => {
  assert.equal(BRIDGE_CONFIG_SCHEMA_VERSION, 1);
  const base = `schema_version: 1
transitions:
  review_plan_pass:
    successor: implementer
    dispatch: automatic
`;
  for (const mode of ["advisory", "warn", "strict"] as const) {
    assert.deepEqual(
      parseBridgeConfigYaml(`${base}producer:\n  model_binding: ${mode}\n`),
      {
        kind: "valid",
        schema_version: 1,
        dispatch: "automatic",
        successor: "implementer",
        model_binding: mode,
      },
    );
  }
  assert.equal(resolveModelBindingMode({ kind: "absent" }), "advisory");
  assert.equal(
    resolveModelBindingMode({ kind: "valid", schema_version: 1, dispatch: "automatic", successor: "implementer" }),
    "advisory",
  );
  assert.equal(
    resolveModelBindingMode({
      kind: "valid",
      schema_version: 1,
      dispatch: "automatic",
      successor: "implementer",
      model_binding: "strict",
    }),
    "strict",
  );
});

test("empty producer, sibling keys, and non-enum model_binding are config_invalid", () => {
  const cases = [
    "schema_version: 1\ntransitions:\n  review_plan_pass:\n    successor: implementer\n    dispatch: automatic\nproducer: {}\n",
    "schema_version: 1\ntransitions:\n  review_plan_pass:\n    successor: implementer\n    dispatch: automatic\nproducer:\n  model_binding: warn\n  extra: 1\n",
    "schema_version: 1\ntransitions:\n  review_plan_pass:\n    successor: implementer\n    dispatch: automatic\nproducer:\n  model_binding: enforce\n",
    "schema_version: 1\ntransitions:\n  review_plan_pass:\n    successor: implementer\n    dispatch: automatic\nproducer: advisory\n",
    "schema_version: 1\ntransitions:\n  review_plan_pass:\n    successor: implementer\n    dispatch: automatic\nhost: cursor\nproducer:\n  model_binding: warn\n",
  ];
  for (const raw of cases) {
    assert.deepEqual(parseBridgeConfigYaml(raw), { kind: "invalid", reason: "config_invalid" }, raw);
  }
});

test("aliases, merge keys, unexpected keys, and sensitive fields are config_invalid", () => {
  const cases = [
    "schema_version: 2\ntransitions:\n  review_plan_pass:\n    successor: implementer\n    dispatch: automatic\n",
    "schema_version: 1\ntransitions:\n  review_plan_pass:\n    successor: planner\n    dispatch: automatic\n",
    "schema_version: 1\ntransitions:\n  review_plan_pass:\n    successor: implementer\n    dispatch: always\n",
    "schema_version: 1\nhost: cursor\ntransitions:\n  review_plan_pass:\n    successor: implementer\n    dispatch: automatic\n",
    "schema_version: 1\ntransitions:\n  review_plan_pass:\n    successor: implementer\n    dispatch: automatic\n    token: secret\n",
    "schema_version: 1\ntransitions: &root\n  review_plan_pass:\n    successor: implementer\n    dispatch: automatic\n",
    "schema_version: 1\ntransitions:\n  review_plan_pass:\n    <<: { successor: implementer, dispatch: automatic }\n",
  ];
  for (const raw of cases) {
    assert.deepEqual(parseBridgeConfigYaml(raw), { kind: "invalid", reason: "config_invalid" }, raw);
  }
});
