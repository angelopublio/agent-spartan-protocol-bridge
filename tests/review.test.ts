import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FakeAdapter, MaliciousAdapter, PRODUCTION_FAKE_RESULT, fakeCapabilities } from "../src/adapters/fake.ts";
import { runReview } from "../src/core/review.ts";
import { planReviewTransitionPrecondition } from "../src/core/task-write.ts";
import { validateReviewResult } from "../src/core/result.ts";
import {
  assertNullability,
  blockedResult,
  changesResult,
  constantSource,
  DEFAULT_REVIEW_SECTION,
  eventTypes,
  HookThrowAdapter,
  loadRun,
  makeRepo,
  passResult,
  snapshotFiles,
  testClock,
  testDeps,
  validAgentsMd,
  validTaskMd,
  VALID_REGISTRY,
} from "./helpers.ts";

const RUN_ID = "run-11111111-1111-4111-8111-111111111111";

test("injected pass changes_requested human_required and blocked results map through the closed table", async () => {
  for (const [source, reason, state] of [
    [constantSource(passResult()), "review_passed", "awaiting_implementer"],
    [constantSource(changesResult()), "review_changes_requested", "changes_requested"],
    [constantSource(PRODUCTION_FAKE_RESULT), "review_human_required", "human_required"],
    [constantSource(blockedResult()), "review_blocked", "blocked"],
  ] as const) {
    const { root, taskRel, productRel } = await makeRepo();
    const before = await snapshotFiles(root, [taskRel, productRel, "AGENTS.md"]);
    const outcome = await runReview({ repo: root, task: taskRel }, testDeps({ source, clock: testClock(RUN_ID) }));
    assert.equal(outcome.exitCode, 0);
    const { status, events } = await loadRun(root, RUN_ID);
    assert.deepEqual(eventTypes(events), [
      "run_requested",
      "policy_resolved",
      "review_started",
      "review_result_accepted",
      "run_terminal",
    ]);
    assertNullability(status, { reason, state, D: true, T: true, G: true, E: true, V: true });
    const after = await snapshotFiles(root, [taskRel, productRel, "AGENTS.md"]);
    assert.deepEqual(after, before);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("personal company hobby and an arbitrary alias use the same resolution path", async () => {
  for (const context of ["personal", "company", "hobby", "client-a"]) {
    const { root, taskRel } = await makeRepo({ agents: validAgentsMd({ context }) });
    const outcome = await runReview(
      { repo: root, task: taskRel },
      testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
    );
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.status?.reason_code, "review_passed");
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("valid current_role values do not change reviewer.plan routing", async () => {
  const { root, taskRel } = await makeRepo({
    task: validTaskMd({ role: "implementer", nextRole: "verifier" }),
  });
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
  );
  assert.equal(outcome.status?.reason_code, "review_passed");
  await fs.rm(root, { recursive: true, force: true });
});

test("post-run_requested failure matrix", async () => {
  const cases: {
    name: string;
    setup: () => Promise<{ root: string; taskRel: string; deps?: ReturnType<typeof testDeps> }>;
    reason: string;
    state: string;
    events: string[];
    D: boolean;
    T: boolean;
    G: boolean;
    E: boolean;
    V: boolean;
  }[] = [
    {
      name: "path_invalid",
      setup: async () => {
        const repo = await makeRepo();
        return { ...repo, taskRel: "../secret.md" };
      },
      reason: "path_invalid",
      state: "failed",
      events: ["run_requested", "run_terminal"],
      D: false,
      T: false,
      G: false,
      E: false,
      V: false,
    },
    {
      name: "task_unreadable",
      setup: async () => {
        const repo = await makeRepo();
        return { ...repo, taskRel: "spartan/tasks/missing.md" };
      },
      reason: "task_unreadable",
      state: "failed",
      events: ["run_requested", "run_terminal"],
      D: false,
      T: false,
      G: false,
      E: false,
      V: false,
    },
    {
      name: "task_invalid",
      setup: async () => makeRepo({ task: "not-frontmatter\n" }),
      reason: "task_invalid",
      state: "failed",
      events: ["run_requested", "run_terminal"],
      D: false,
      T: true,
      G: false,
      E: false,
      V: false,
    },
    {
      name: "agents_unreadable",
      setup: async () => {
        const repo = await makeRepo();
        await fs.rm(path.join(repo.root, "AGENTS.md"));
        return repo;
      },
      reason: "agents_unreadable",
      state: "failed",
      events: ["run_requested", "run_terminal"],
      D: false,
      T: true,
      G: false,
      E: false,
      V: false,
    },
    {
      name: "agents_policy_invalid",
      setup: async () => makeRepo({ agents: validAgentsMd({ extraPlan: true }) }),
      reason: "agents_policy_invalid",
      state: "failed",
      events: ["run_requested", "run_terminal"],
      D: false,
      T: true,
      G: true,
      E: false,
      V: false,
    },
    {
      name: "automatic_review_not_authorized",
      setup: async () => makeRepo({ agents: validAgentsMd({ conflict: true }) }),
      reason: "automatic_review_not_authorized",
      state: "blocked",
      events: ["run_requested", "run_terminal"],
      D: false,
      T: true,
      G: true,
      E: false,
      V: false,
    },
    {
      name: "reviewer_binding_missing",
      setup: async () => makeRepo({ agents: validAgentsMd({ omitPlan: true }) }),
      reason: "reviewer_binding_missing",
      state: "blocked",
      events: ["run_requested", "run_terminal"],
      D: false,
      T: true,
      G: true,
      E: false,
      V: false,
    },
    {
      name: "host_invalid",
      setup: async () => makeRepo({ agents: validAgentsMd({ host: "VS Code" }) }),
      reason: "host_invalid",
      state: "blocked",
      events: ["run_requested", "run_terminal"],
      D: false,
      T: true,
      G: true,
      E: false,
      V: false,
    },
    {
      name: "registry_schema_invalid",
      setup: async () => ({
        ...(await makeRepo()),
        deps: testDeps({
          registryYaml: "schema_version: \"1\"\nclient_contexts: {}\n",
          clock: testClock(RUN_ID),
        }),
      }),
      reason: "registry_schema_invalid",
      state: "failed",
      events: ["run_requested", "run_terminal"],
      D: false,
      T: true,
      G: true,
      E: false,
      V: false,
    },
    {
      name: "registry_sensitive_field",
      setup: async () => ({
        ...(await makeRepo()),
        deps: testDeps({
          registryYaml: VALID_REGISTRY.replace("launcher: fake-reviewer-v1", "launcher: fake-reviewer-v1\n      api_key: x"),
          clock: testClock(RUN_ID),
        }),
      }),
      reason: "registry_sensitive_field",
      state: "failed",
      events: ["run_requested", "run_terminal"],
      D: false,
      T: true,
      G: true,
      E: false,
      V: false,
    },
    {
      name: "registry_context_incomplete",
      setup: async () => ({
        ...(await makeRepo()),
        deps: testDeps({
          registryYaml: `schema_version: 1
client_contexts:
  personal:
    codex:
      launcher: fake-reviewer-v1
    claude:
      launcher: fake-reviewer-v1
`,
          clock: testClock(RUN_ID),
        }),
      }),
      reason: "registry_context_incomplete",
      state: "failed",
      events: ["run_requested", "run_terminal"],
      D: false,
      T: true,
      G: true,
      E: false,
      V: false,
    },
    {
      name: "client_context_unavailable",
      setup: async () => makeRepo({ agents: validAgentsMd({ context: "unknownctx" }) }),
      reason: "client_context_unavailable",
      state: "blocked",
      events: ["run_requested", "run_terminal"],
      D: false,
      T: true,
      G: true,
      E: false,
      V: false,
    },
    {
      name: "launcher_unavailable",
      setup: async () => ({
        ...(await makeRepo()),
        deps: testDeps({
          registryYaml: VALID_REGISTRY.replaceAll("fake-reviewer-v1", "missing-launcher"),
          clock: testClock(RUN_ID),
        }),
      }),
      reason: "launcher_unavailable",
      state: "blocked",
      events: ["run_requested", "policy_resolved", "run_terminal"],
      D: true,
      T: true,
      G: true,
      E: false,
      V: false,
    },
    {
      name: "capability_denied",
      setup: async () => ({
        ...(await makeRepo()),
        deps: testDeps({
          clock: testClock(RUN_ID),
          createAdapter: () =>
            new FakeAdapter(constantSource(passResult()), {
              ...fakeCapabilities(),
              workspace_write: true,
            }),
        }),
      }),
      reason: "capability_denied",
      state: "blocked",
      events: ["run_requested", "policy_resolved", "run_terminal"],
      D: true,
      T: true,
      G: true,
      E: false,
      V: false,
    },
    {
      name: "result_schema_invalid",
      setup: async () => ({
        ...(await makeRepo()),
        deps: testDeps({
          clock: testClock(RUN_ID),
          createAdapter: () =>
            new MaliciousAdapter({
              schema_version: 1,
              review_kind: "plan",
              verdict: "pass",
              summary: "bad",
              findings: [],
              patch: "diff --git",
            }),
        }),
      }),
      reason: "result_schema_invalid",
      state: "failed",
      events: ["run_requested", "policy_resolved", "review_started", "run_terminal"],
      D: true,
      T: true,
      G: true,
      E: true,
      V: false,
    },
    {
      name: "adapter_error",
      setup: async () => ({
        ...(await makeRepo()),
        deps: testDeps({
          clock: testClock(RUN_ID),
          createAdapter: () =>
            new FakeAdapter({
              result() {
                throw new Error("boom");
              },
            }),
        }),
      }),
      reason: "adapter_error",
      state: "failed",
      events: ["run_requested", "policy_resolved", "review_started", "run_terminal"],
      D: true,
      T: true,
      G: true,
      E: true,
      V: false,
    },
  ];

  for (const testCase of cases) {
    const { root, taskRel, deps } = await testCase.setup();
    const outcome = await runReview({ repo: root, task: taskRel }, deps ?? testDeps({ clock: testClock(RUN_ID) }));
    assert.equal(outcome.exitCode, 1, testCase.name);
    const { status, events } = await loadRun(root, RUN_ID);
    assert.deepEqual(eventTypes(events), testCase.events, testCase.name);
    assertNullability(status, {
      reason: testCase.reason as never,
      state: testCase.state as never,
      D: testCase.D,
      T: testCase.T,
      G: testCase.G,
      E: testCase.E,
      V: testCase.V,
    });
    assert.equal(status.reason_code, testCase.reason);
    if (testCase.name === "adapter_error") {
      assert.equal(status.adapter_failure == null, false);
      assert.equal(status.adapter_failure?.cause, "unexpected_error");
    } else if (testCase.name === "capability_denied") {
      assert.equal(status.adapter_failure, null);
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("integrity_mismatch when the task changes before result acceptance", async () => {
  const { root, taskRel } = await makeRepo();
  const mutating = {
    result() {
      const abs = path.join(root, taskRel);
      const current = fs.readFile(abs, "utf8");
      return current.then(async (text) => {
        await fs.writeFile(abs, `${text}\nmutated\n`);
        return passResult();
      });
    },
  };
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: mutating, clock: testClock(RUN_ID) }),
  );
  assert.equal(outcome.exitCode, 1);
  const { status, events } = await loadRun(root, RUN_ID);
  assert.deepEqual(eventTypes(events), ["run_requested", "policy_resolved", "review_started", "run_terminal"]);
  assertNullability(status, {
    reason: "integrity_mismatch",
    state: "failed",
    D: true,
    T: true,
    G: true,
    E: true,
    V: false,
  });
  await fs.rm(root, { recursive: true, force: true });
});

test("two sequential fake attempts get distinct execution ids and adapter instances", async () => {
  const seen: { id: string; instance: number }[] = [];
  const { root, taskRel } = await makeRepo();
  let n = 0;
  const deps = testDeps({
    clock: {
      now: () => new Date(),
      createRunId: () => `run-11111111-1111-4111-8111-11111111111${(n += 1)}`,
      createExecutionId: () => `exec-${n}`,
      createTransitionId: () => "transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    },
    createAdapter: () => {
      const adapter = new FakeAdapter(constantSource(passResult()));
      const originalStart = adapter.start.bind(adapter);
      adapter.start = async (input) => {
        seen.push({ id: input.execution_id, instance: adapter.instanceId });
        return originalStart(input);
      };
      return adapter;
    },
  });
  await runReview({ repo: root, task: taskRel }, deps);
  await runReview({ repo: root, task: taskRel }, deps);
  assert.equal(seen.length, 2);
  assert.notEqual(seen[0]?.id, seen[1]?.id);
  assert.notEqual(seen[0]?.instance, seen[1]?.instance);
  await fs.rm(root, { recursive: true, force: true });
});

test("protocol birth-stamps 0.6.1 and 1.0.0 are both admitted", async () => {
  for (const protocol of ["0.6.1", "1.0.0"]) {
    const { root, taskRel } = await makeRepo({ task: validTaskMd({ protocol }) });
    const outcome = await runReview(
      { repo: root, task: taskRel },
      testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
    );
    assert.equal(outcome.status?.reason_code, "review_passed", protocol);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Spartan APPROVED is not a runtime verdict", () => {
  assert.throws(() =>
    validateReviewResult({
      schema_version: 2,
      review_kind: "plan",
      verdict: "APPROVED",
      summary: "nope",
      findings: [],
    }, "plan"),
  );
});

test("core review does not import the CLI adapter", async () => {
  const source = await fs.readFile(new URL("../src/core/review.ts", import.meta.url), "utf8");
  assert.equal(source.includes("cli/"), false);
});

test("Bridge never starts an implementer round", async () => {
  const review = await fs.readFile(new URL("../src/core/review.ts", import.meta.url), "utf8");
  assert.doesNotMatch(review, /awaiting_implementer.*start/s);
  assert.doesNotMatch(review, /startImplementer/);
  assert.doesNotMatch(review, /spawn.*implementer/i);
});

test("review calls planReviewTransitionPrecondition and contains no copy of its rule", async () => {
  const source = await fs.readFile(new URL("../src/core/review.ts", import.meta.url), "utf8");
  assert.match(source, /planReviewTransitionPrecondition/);
  assert.doesNotMatch(source, /"reviewer"/);
  assert.doesNotMatch(source, /transition_next_role_not_reviewer/);
});

test("granted review with next_role planner refuses before the adapter is constructed", async () => {
  const { root, taskRel } = await makeRepo({
    agents: validAgentsMd({ taskWrite: true }),
    task: validTaskMd({ nextRole: "planner" }),
  });
  const before = await fs.readFile(path.join(root, taskRel));
  const inner = testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) });
  const resolved: string[] = [];
  const outcome = await runReview(
    { repo: root, task: taskRel },
    {
      ...inner,
      catalog: {
        resolve(launcherId: string) {
          resolved.push(launcherId);
          return inner.catalog.resolve(launcherId);
        },
      },
    },
  );
  assert.deepEqual(resolved, []);
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.status?.state, "human_required");
  assert.equal(outcome.status?.reason_code, "transition_next_role_not_reviewer");
  assert.equal(outcome.status?.task_write_state, "rejected");
  assert.equal(outcome.status?.verdict, null);
  assert.equal(outcome.status?.execution_id, null);
  assert.equal(outcome.status?.model_observed, null);
  assert.equal(outcome.status?.review_kind, "plan");
  assert.deepEqual(await fs.readFile(path.join(root, taskRel)), before);
  const { status, events } = await loadRun(root, RUN_ID);
  assert.deepEqual(eventTypes(events), ["run_requested", "policy_resolved", "run_terminal"]);
  assert.equal(events.some((event) => event.type === "review_started"), false);
  assert.deepEqual(status.review_chain, {
    after_run_id: null,
    cycle: 1,
    max_cycles: 3,
    refused: null,
  });
  assert.deepEqual(
    planReviewTransitionPrecondition({
      reviewKind: status.review_kind,
      currentNextRole: "reviewer",
    }),
    { ok: true },
  );
  await fs.rm(root, { recursive: true, force: true });
});

test("granted runReview constructs the adapter exactly when the precondition accepts", async () => {
  const roles = [
    "human-operator",
    "investigator",
    "planner",
    "implementer",
    "reviewer",
    "independent-reviewer",
    "verifier",
  ];
  for (const nextRole of roles) {
    const { root, taskRel } = await makeRepo({
      agents: validAgentsMd({ taskWrite: true }),
      task: validTaskMd({ nextRole, reviewSection: `\n${DEFAULT_REVIEW_SECTION}` }),
    });
    const inner = testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) });
    const resolved: string[] = [];
    const outcome = await runReview(
      { repo: root, task: taskRel },
      {
        ...inner,
        catalog: {
          resolve(launcherId: string) {
            resolved.push(launcherId);
            return inner.catalog.resolve(launcherId);
          },
        },
      },
    );
    const expected = planReviewTransitionPrecondition({
      reviewKind: outcome.status?.review_kind ?? "",
      currentNextRole: nextRole,
    });
    if (expected.ok) {
      assert.equal(resolved.length, 1, nextRole);
    } else {
      assert.deepEqual(resolved, [], nextRole);
      assert.equal(outcome.status?.reason_code, expected.reason, nextRole);
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("registry_unavailable uses an injected missing source", async () => {
  const { root, taskRel } = await makeRepo();
  const outcome = await runReview(
    { repo: root, task: taskRel },
    {
      ...testDeps({ clock: testClock(RUN_ID) }),
      registry: {
        async load() {
          throw new Error("missing");
        },
      },
    },
  );
  assert.equal(outcome.status?.reason_code, "registry_unavailable");
  assert.equal(outcome.status?.state, "blocked");
  const { events } = await loadRun(root, RUN_ID);
  assert.deepEqual(eventTypes(events), ["run_requested", "run_terminal"]);
  await fs.rm(root, { recursive: true, force: true });
});

test("model observation compare covers observed, mismatch, and declared_unobserved", async () => {
  const observedRepo = await makeRepo({
    agents: validAgentsMd({ taskWrite: true }),
    task: validTaskMd({ reviewSection: `\n${DEFAULT_REVIEW_SECTION}` }),
  });
  const observedOutcome = await runReview(
    { repo: observedRepo.root, task: observedRepo.taskRel },
    testDeps({
      clock: testClock(RUN_ID),
      createAdapter: () => new FakeAdapter(constantSource(passResult()), fakeCapabilities(), " Composer-2.5 "),
    }),
  );
  assert.equal(observedOutcome.status?.reason_code, "review_passed");
  assert.equal(observedOutcome.status?.model, "Composer-2.5");
  assert.equal(observedOutcome.status?.effort, "none");
  assert.equal(observedOutcome.status?.model_observed, "observed");
  assert.notEqual(observedOutcome.status?.model_observed, observedOutcome.status?.model);
  const observedCaps = new FakeAdapter(constantSource(passResult()), fakeCapabilities(), "Composer-2.5").capabilities();
  assert.equal(observedCaps.observes_model, true);
  const observedText = await fs.readFile(path.join(observedRepo.root, observedRepo.taskRel), "utf8");
  assert.match(observedText, /model=Composer-2\.5 effort=none model_observed=observed/);
  assert.doesNotMatch(observedText, /model_observed=Composer-2\.5/);
  await fs.rm(observedRepo.root, { recursive: true, force: true });

  const mismatchRepo = await makeRepo({
    agents: validAgentsMd({ taskWrite: true }),
    task: validTaskMd({ reviewSection: `\n${DEFAULT_REVIEW_SECTION}` }),
  });
  const beforeMismatch = await fs.readFile(path.join(mismatchRepo.root, mismatchRepo.taskRel));
  const mismatchOutcome = await runReview(
    { repo: mismatchRepo.root, task: mismatchRepo.taskRel },
    testDeps({
      clock: testClock(RUN_ID),
      createAdapter: () => new FakeAdapter(constantSource(passResult()), fakeCapabilities(), "other-model"),
    }),
  );
  assert.equal(mismatchOutcome.exitCode, 1);
  assert.equal(mismatchOutcome.status?.reason_code, "model_mismatch");
  assert.equal(mismatchOutcome.status?.state, "failed");
  assert.equal(mismatchOutcome.status?.model, "Composer-2.5");
  assert.equal(mismatchOutcome.status?.effort, "none");
  assert.equal(mismatchOutcome.status?.model_observed, null);
  assert.deepEqual(await fs.readFile(path.join(mismatchRepo.root, mismatchRepo.taskRel)), beforeMismatch);
  const mismatchRun = await loadRun(mismatchRepo.root, RUN_ID);
  assert.deepEqual(eventTypes(mismatchRun.events), [
    "run_requested",
    "policy_resolved",
    "review_started",
    "run_terminal",
  ]);
  assert.equal(mismatchRun.events.some((event) => event.type === "review_result_accepted"), false);
  assert.equal(mismatchRun.events.some((event) => event.type === "task_artifact_written"), false);
  await fs.rm(mismatchRepo.root, { recursive: true, force: true });

  const unobservedRepo = await makeRepo();
  const unobservedOutcome = await runReview(
    { repo: unobservedRepo.root, task: unobservedRepo.taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
  );
  assert.equal(unobservedOutcome.status?.reason_code, "review_passed");
  assert.equal(unobservedOutcome.status?.model, "Composer-2.5");
  assert.equal(unobservedOutcome.status?.model_observed, "declared_unobserved");
  assert.equal(new FakeAdapter(constantSource(passResult())).capabilities().observes_model, false);
  await fs.rm(unobservedRepo.root, { recursive: true, force: true });
});

test("declaration fields survive adapter_error and stay unset before policy_resolved", async () => {
  const failedRepo = await makeRepo();
  const failedOutcome = await runReview(
    { repo: failedRepo.root, task: failedRepo.taskRel },
    testDeps({
      clock: testClock(RUN_ID),
      createAdapter: () =>
        new FakeAdapter({
          result() {
            throw new Error("boom");
          },
        }),
    }),
  );
  assert.equal(failedOutcome.status?.reason_code, "adapter_error");
  assert.equal(failedOutcome.status?.host, "cursor");
  assert.equal(failedOutcome.status?.client_context, "personal");
  assert.equal(failedOutcome.status?.model, "Composer-2.5");
  assert.equal(failedOutcome.status?.effort, "none");
  assert.equal(failedOutcome.status?.model_observed, null);
  await fs.rm(failedRepo.root, { recursive: true, force: true });

  const earlyRepo = await makeRepo({ agents: validAgentsMd({ extraPlan: true }) });
  const earlyOutcome = await runReview(
    { repo: earlyRepo.root, task: earlyRepo.taskRel },
    testDeps({ clock: testClock(RUN_ID) }),
  );
  assert.equal(earlyOutcome.status?.reason_code, "agents_policy_invalid");
  assert.equal(earlyOutcome.status?.host, null);
  assert.equal(earlyOutcome.status?.model, null);
  assert.equal(earlyOutcome.status?.effort, null);
  assert.equal(earlyOutcome.status?.model_observed, null);
  await fs.rm(earlyRepo.root, { recursive: true, force: true });
});

test("optional progress is called once at review_started and skipped when prepare fails", async () => {
  const started: unknown[] = [];
  const { root, taskRel } = await makeRepo();
  const outcome = await runReview({ repo: root, task: taskRel }, testDeps({ clock: testClock(RUN_ID) }), {
    started(info) {
      started.push(info);
    },
  });
  assert.equal(outcome.status?.reason_code, "review_passed");
  assert.equal(started.length, 1);
  assert.deepEqual(started[0], {
    run_id: RUN_ID,
    host: "cursor",
    model: "Composer-2.5",
    effort: "none",
    client_context: "personal",
    created_at: outcome.status!.created_at,
  });
  assert.deepEqual(Object.keys(started[0] as object).sort(), [
    "client_context",
    "created_at",
    "effort",
    "host",
    "model",
    "run_id",
  ]);
  await fs.rm(root, { recursive: true, force: true });

  const prepareCalls: unknown[] = [];
  const prepareRepo = await makeRepo();
  const prepareOutcome = await runReview(
    { repo: prepareRepo.root, task: prepareRepo.taskRel },
    testDeps({
      clock: testClock(RUN_ID),
      createAdapter: () => new HookThrowAdapter(constantSource(passResult()), "prepare", new Error("nope")),
    }),
    {
      started(info) {
        prepareCalls.push(info);
      },
    },
  );
  assert.equal(prepareOutcome.status?.reason_code, "adapter_error");
  assert.deepEqual(prepareCalls, []);
  await fs.rm(prepareRepo.root, { recursive: true, force: true });
});

void os;
