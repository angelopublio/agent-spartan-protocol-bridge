import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { FakeAdapter, fakeCapabilities } from "../src/adapters/fake.ts";
import { AdapterIsolationError, AdapterTimeoutError } from "../src/adapters/adapter.ts";
import type { Adapter } from "../src/adapters/adapter.ts";
import { runReview } from "../src/core/review.ts";
import {
  CountingAdapter,
  HookThrowAdapter,
  constantSource,
  eventTypes,
  loadRun,
  makeRepo,
  passResult,
  reviewerWriteError,
  testClock,
  testDeps,
} from "./helpers.ts";

const RUN_ID = "run-11111111-1111-4111-8111-111111111111";

test("typed errors map only from the hook that owns them", async () => {
  const cases: {
    name: string;
    hook: "preflight" | "prepare" | "start" | "collect" | "verify";
    error: Error;
    reason: string;
    state: string;
    phase: "preflight" | "prepare" | "start" | "collect" | "verify";
    events: string[];
  }[] = [
    {
      name: "isolation from prepare",
      hook: "prepare",
      error: new AdapterIsolationError(),
      reason: "reviewer_isolation_unavailable",
      state: "failed",
      phase: "prepare",
      events: ["run_requested", "policy_resolved", "run_terminal"],
    },
    {
      name: "timeout from start",
      hook: "start",
      error: new AdapterTimeoutError(),
      reason: "adapter_timeout",
      state: "failed",
      phase: "start",
      events: ["run_requested", "policy_resolved", "review_started", "run_terminal"],
    },
    {
      name: "timeout from collect",
      hook: "collect",
      error: new AdapterTimeoutError(),
      reason: "adapter_timeout",
      state: "failed",
      phase: "collect",
      events: ["run_requested", "policy_resolved", "review_started", "run_terminal"],
    },
    {
      name: "write-detected from verify",
      hook: "verify",
      error: reviewerWriteError(),
      reason: "reviewer_write_detected",
      state: "blocked",
      phase: "verify",
      events: ["run_requested", "policy_resolved", "review_started", "run_terminal"],
    },
    {
      name: "isolation from start is adapter_error",
      hook: "start",
      error: new AdapterIsolationError(),
      reason: "adapter_error",
      state: "failed",
      phase: "start",
      events: ["run_requested", "policy_resolved", "review_started", "run_terminal"],
    },
    {
      name: "timeout from prepare is adapter_error",
      hook: "prepare",
      error: new AdapterTimeoutError(),
      reason: "adapter_error",
      state: "failed",
      phase: "prepare",
      events: ["run_requested", "policy_resolved", "run_terminal"],
    },
    {
      name: "write-detected from collect is adapter_error",
      hook: "collect",
      error: reviewerWriteError(),
      reason: "adapter_error",
      state: "failed",
      phase: "collect",
      events: ["run_requested", "policy_resolved", "review_started", "run_terminal"],
    },
    {
      name: "isolation from preflight is adapter_error",
      hook: "preflight",
      error: new AdapterIsolationError(),
      reason: "adapter_error",
      state: "failed",
      phase: "preflight",
      events: ["run_requested", "policy_resolved", "run_terminal"],
    },
    {
      name: "untyped preflight stays capability_denied",
      hook: "preflight",
      error: new Error("nope"),
      reason: "capability_denied",
      state: "blocked",
      phase: "preflight",
      events: ["run_requested", "policy_resolved", "run_terminal"],
    },
    {
      name: "untyped prepare is adapter_error",
      hook: "prepare",
      error: new Error("nope"),
      reason: "adapter_error",
      state: "failed",
      phase: "prepare",
      events: ["run_requested", "policy_resolved", "run_terminal"],
    },
    {
      name: "untyped verify is adapter_error",
      hook: "verify",
      error: new Error("nope"),
      reason: "adapter_error",
      state: "failed",
      phase: "verify",
      events: ["run_requested", "policy_resolved", "review_started", "run_terminal"],
    },
  ];

  for (const testCase of cases) {
    const { root, taskRel } = await makeRepo();
    const outcome = await runReview(
      { repo: root, task: taskRel },
      testDeps({
        clock: testClock(RUN_ID),
        createAdapter: () => new HookThrowAdapter(constantSource(passResult()), testCase.hook, testCase.error),
      }),
    );
    assert.equal(outcome.exitCode, 1, testCase.name);
    const { status, events } = await loadRun(root, RUN_ID);
    assert.equal(status.reason_code, testCase.reason, testCase.name);
    assert.equal(status.state, testCase.state, testCase.name);
    assert.deepEqual(eventTypes(events), testCase.events, testCase.name);
    assert.equal(status.adapter_failure == null, false, testCase.name);
    assert.equal(status.adapter_failure?.phase, testCase.phase, testCase.name);
    assert.equal(status.adapter_failure?.cause, "unexpected_error", testCase.name);
    assert.equal(status.adapter_failure?.exit_code, null, testCase.name);
    assert.equal(status.adapter_failure?.stderr_bytes, 0, testCase.name);
    assert.equal(status.adapter_failure?.stderr_log, null, testCase.name);
    assert.equal(status.adapter_failure?.payload_log, null, testCase.name);
    if (testCase.reason === "reviewer_write_detected") {
      assert.equal(status.reviewer_write?.comparison, "reviewer_workspace", testCase.name);
      assert.equal((status.reviewer_write?.entries.length ?? 0) > 0, true, testCase.name);
    } else {
      assert.equal(status.reviewer_write, null, testCase.name);
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("cleanup runs once per attempt and cancel matches start-invoked failures", async () => {
  const success = new CountingAdapter(new FakeAdapter(constantSource(passResult())));
  const prepareThrow = new CountingAdapter(
    new HookThrowAdapter(constantSource(passResult()), "prepare", new AdapterIsolationError()),
  );
  const collectThrow = new CountingAdapter(
    new HookThrowAdapter(constantSource(passResult()), "collect", new Error("boom")),
  );
  const verifyThrow = new CountingAdapter(
    new HookThrowAdapter(constantSource(passResult()), "verify", reviewerWriteError()),
  );

  const cases = [
    { adapter: success, expectCancel: 0, expectCleanup: 1, name: "success" },
    { adapter: prepareThrow, expectCancel: 0, expectCleanup: 1, name: "prepare throw" },
    { adapter: collectThrow, expectCancel: 1, expectCleanup: 1, name: "collect failure" },
    { adapter: verifyThrow, expectCancel: 1, expectCleanup: 1, name: "verify write-detected" },
  ];

  for (const testCase of cases) {
    const { root, taskRel } = await makeRepo();
    await runReview(
      { repo: root, task: taskRel },
      testDeps({ clock: testClock(RUN_ID), createAdapter: () => testCase.adapter }),
    );
    assert.equal(testCase.adapter.cleanupCount, testCase.expectCleanup, `${testCase.name} cleanup`);
    assert.equal(testCase.adapter.cancelCount, testCase.expectCancel, `${testCase.name} cancel`);
    await fs.rm(root, { recursive: true, force: true });
  }

  const mutatingCount = new CountingAdapter(new FakeAdapter(constantSource(passResult())));
  const { root, taskRel } = await makeRepo();
  const mutating: Adapter = {
    capabilities: () => fakeCapabilities(),
    preflight: async () => undefined,
    prepare: async (input) => mutatingCount.prepare(input),
    start: async (input) => {
      await mutatingCount.start(input);
    },
    collect: async () => {
      mutatingCount.collectCount += 1;
      await fs.appendFile(path.join(root, taskRel), "\nmutated\n");
      return passResult();
    },
    verify: async () => mutatingCount.verify(),
    cancel: async () => mutatingCount.cancel(),
    cleanup: async () => mutatingCount.cleanup(),
    observedModel: () => mutatingCount.observedModel(),
  };
  await runReview(
    { repo: root, task: taskRel },
    testDeps({ clock: testClock(RUN_ID), createAdapter: () => mutating }),
  );
  assert.equal(mutatingCount.cleanupCount, 1, "integrity_mismatch cleanup");
  assert.equal(mutatingCount.cancelCount, 1, "integrity_mismatch cancel");
  await fs.rm(root, { recursive: true, force: true });
});

test("failure before prepare calls neither cancel nor cleanup", async () => {
  const counting = new CountingAdapter(
    new HookThrowAdapter(constantSource(passResult()), "preflight", new Error("nope")),
  );
  const { root, taskRel } = await makeRepo();
  await runReview(
    { repo: root, task: taskRel },
    testDeps({ clock: testClock(RUN_ID), createAdapter: () => counting }),
  );
  assert.equal(counting.cancelCount, 0);
  assert.equal(counting.cleanupCount, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test("throwing cancel and cleanup do not mask the propagating error", async () => {
  const inner = new HookThrowAdapter(constantSource(passResult()), "collect", new Error("boom"));
  inner.cancel = async () => {
    throw new Error("cancel failed");
  };
  inner.cleanup = async () => {
    throw new Error("cleanup failed");
  };
  const { root, taskRel } = await makeRepo();
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({ clock: testClock(RUN_ID), createAdapter: () => inner }),
  );
  assert.equal(outcome.status?.reason_code, "adapter_error");
  assert.equal(outcome.exitCode, 1);
  const { events } = await loadRun(root, RUN_ID);
  assert.deepEqual(eventTypes(events), ["run_requested", "policy_resolved", "review_started", "run_terminal"]);
  await fs.rm(root, { recursive: true, force: true });
});
