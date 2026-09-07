import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { main } from "../src/cli/main.ts";
import { queryProducerPolicy, serializePolicyQuery } from "../src/core/policy-query.ts";
import { makeRepo, validAgentsMd, writeBridgeConfig } from "./helpers.ts";

const cliModule = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));

async function runPolicy(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const code = await main(args, process.env, cliModule, {
    stdout: {
      write(chunk) {
        stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
        return true;
      },
    },
    stderr: {
      write(chunk) {
        stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
        return true;
      },
    },
  });
  return { code, stdout, stderr };
}

test("policy prints one JSON object for planner and implementer", async () => {
  const { root } = await makeRepo();
  const planner = await queryProducerPolicy(root, "planner");
  assert.equal(planner.ok, true);
  if (planner.ok) {
    assert.deepEqual(planner.document, {
      role: "planner",
      model_binding_mode: "advisory",
      binding_model: "gpt-5.6-terra",
      binding_effort: "high",
    });
    assert.equal(
      serializePolicyQuery(planner.document),
      '{"role":"planner","model_binding_mode":"advisory","binding_model":"gpt-5.6-terra","binding_effort":"high"}\n',
    );
  }
  const implementer = await queryProducerPolicy(root, "implementer");
  assert.equal(implementer.ok, true);
  if (implementer.ok) {
    assert.deepEqual(implementer.document, {
      role: "implementer",
      model_binding_mode: "advisory",
      binding_model: "Composer-2.5",
      binding_effort: "none",
    });
  }
  const cli = await runPolicy(["policy", "--repo", root, "--role", "planner"]);
  assert.equal(cli.code, 0);
  assert.equal(cli.stderr, "");
  assert.deepEqual(JSON.parse(cli.stdout), {
    role: "planner",
    model_binding_mode: "advisory",
    binding_model: "gpt-5.6-terra",
    binding_effort: "high",
  });
  await fs.rm(root, { recursive: true, force: true });
});

test("missing role row and unresolved policy still fill the mode with null model fields", async () => {
  const { root } = await makeRepo({
    agents: `# X

## Agent hosts

| Binding | Host | Client context | Model | Effort |
| --- | --- | --- | --- | --- |
| reviewer.plan | Cursor | personal | Composer-2.5 | none |

## Spartan Bridge automation authority

- A human-started Spartan Bridge run may start the mapped reviewer automatically.
- The Bridge may return findings to the current planner session and repeat up to 3 plan-review cycles.
`,
  });
  await writeBridgeConfig(
    root,
    `schema_version: 1
transitions:
  review_plan_pass:
    successor: implementer
    dispatch: automatic
producer:
  model_binding: warn
`,
  );
  const missing = await queryProducerPolicy(root, "planner");
  assert.equal(missing.ok, true);
  if (missing.ok) {
    assert.deepEqual(missing.document, {
      role: "planner",
      model_binding_mode: "warn",
      binding_model: null,
      binding_effort: null,
    });
  }
  const unresolvedRoot = await makeRepo({ agents: validAgentsMd({ omitPlan: true }) });
  const unresolved = await queryProducerPolicy(unresolvedRoot.root, "implementer");
  assert.equal(unresolved.ok, true);
  if (unresolved.ok) {
    assert.deepEqual(unresolved.document, {
      role: "implementer",
      model_binding_mode: "advisory",
      binding_model: null,
      binding_effort: null,
    });
  }
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(unresolvedRoot.root, { recursive: true, force: true });
});

test("policy usage errors, unreadable repo, and config_invalid print no JSON", async () => {
  const usage = await runPolicy(["policy", "--repo", "/tmp/r"]);
  assert.equal(usage.code, 1);
  assert.equal(usage.stdout, "");
  assert.match(usage.stderr, /^error: /);
  assert.doesNotMatch(usage.stdout, /\{/);

  const missingRepo = await runPolicy(["policy", "--repo", "/no/such/repo", "--role", "planner"]);
  assert.equal(missingRepo.code, 1);
  assert.equal(missingRepo.stdout, "");
  assert.equal(missingRepo.stderr, "error: repository root is not an existing readable directory\n");

  const { root } = await makeRepo();
  await writeBridgeConfig(
    root,
    `schema_version: 1
transitions:
  review_plan_pass:
    successor: implementer
    dispatch: automatic
host: cursor
`,
  );
  const invalid = await runPolicy(["policy", "--repo", root, "--role", "planner"]);
  assert.equal(invalid.code, 1);
  assert.equal(invalid.stdout, "");
  assert.equal(invalid.stderr, "error: operational config is invalid\n");
  await fs.rm(root, { recursive: true, force: true });
});

test("ProducerIdentity and compareObservedModel stay the existing observation path", async () => {
  const contracts = await fs.readFile(new URL("../src/core/contracts.ts", import.meta.url), "utf8");
  const review = await fs.readFile(new URL("../src/core/review.ts", import.meta.url), "utf8");
  const policyQuery = await fs.readFile(new URL("../src/core/policy-query.ts", import.meta.url), "utf8");
  assert.match(contracts, /export type ProducerIdentity = \{\n  role: ProducerRole;\n  host: CanonicalHost;\n\};/);
  assert.match(review, /function compareObservedModel\(declared: string, observed: string \| null\)/);
  assert.doesNotMatch(policyQuery, /model_observed/);
  assert.doesNotMatch(policyQuery, /ProducerIdentity/);
});
