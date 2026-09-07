import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { FakeAdapter } from "../src/adapters/fake.ts";
import { runReview } from "../src/core/review.ts";
import { sha256Bytes } from "../src/core/serialize.ts";
import { mapReviewOutcome } from "../src/mcp/outcome.ts";
import { REVIEW_TOOL } from "../src/mcp/protocol.ts";
import { isRuntimeRunDirContained } from "../src/runtime/store.ts";
import {
  CountingAdapter,
  changesResult,
  constantSource,
  DEFAULT_REVIEW_SECTION,
  HookThrowAdapter,
  makeRepo,
  passResult,
  testClock,
  testDeps,
  validAgentsMd,
  validTaskMd,
} from "./helpers.ts";

const PARENT_ID = "run-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHILD_ID = "run-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const THIRD_ID = "run-cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TRAVERSAL = "run-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/../../../etc/passwd";

test("isRuntimeRunDirContained accepts a runs-directory candidate and rejects a repository candidate outside it", () => {
  const repoRoot = path.join(path.sep, "repo");
  const insideRuns = path.join(repoRoot, ".spartan-bridge", "runs", PARENT_ID);
  const insideRepoOutsideRuns = path.join(repoRoot, "docs", PARENT_ID);
  assert.equal(isRuntimeRunDirContained(repoRoot, insideRuns), true);
  assert.equal(isRuntimeRunDirContained(repoRoot, insideRepoOutsideRuns), false);
});

async function plantParent(
  root: string,
  taskRel: string,
  runId: string,
  mutate?: (status: Record<string, unknown>) => void,
): Promise<{ taskHash: string; agentsHash: string }> {
  const taskHash = sha256Bytes(new Uint8Array(await fs.readFile(path.join(root, taskRel))));
  const agentsHash = sha256Bytes(new Uint8Array(await fs.readFile(path.join(root, "AGENTS.md"))));
  const status: Record<string, unknown> = {
    schema_version: 2,
    run_id: runId,
    state: "changes_requested",
    review_kind: "plan",
    task_path: taskRel,
    host: "cursor",
    client_context: "personal",
    model: "Composer-2.5",
    effort: "none",
    model_observed: "declared_unobserved",
    policy_digest: "sha256:dead",
    artifact_hashes: { task: taskHash, agents: agentsHash },
    execution_id: "exec-1",
    verdict: "changes_requested",
    reason_code: "review_changes_requested",
    task_write_state: "written",
    task_hash_after_write: taskHash,
    reviewer_write: null,
    adapter_failure: null,
    review_chain: { after_run_id: null, cycle: 1, max_cycles: 3, refused: null },
    created_at: "2026-08-16T12:00:00.000Z",
    updated_at: "2026-08-16T12:00:01.000Z",
  };
  mutate?.(status);
  const runDir = path.join(root, ".spartan-bridge", "runs", runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "status.json"), `${JSON.stringify(status)}\n`, "utf8");
  return { taskHash, agentsHash };
}

async function reviseTask(root: string, taskRel: string): Promise<void> {
  const abs = path.join(root, taskRel);
  const text = await fs.readFile(abs, "utf8");
  const restored = text.replace(/^next_role: .+$/m, "next_role: reviewer");
  await fs.writeFile(abs, `${restored}\nProducer revision.\n`, "utf8");
}

function countingDeps(runId: string, source = constantSource(changesResult())) {
  const counting = new CountingAdapter(new FakeAdapter(source));
  return {
    counting,
    deps: testDeps({
      clock: testClock(runId),
      createAdapter: () => counting,
    }),
  };
}

test("unchained run records D7's first review_chain row after policy resolution", async () => {
  const { root, taskRel } = await makeRepo();
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(CHILD_ID) }),
  );
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.status?.state, "awaiting_implementer");
  assert.equal(outcome.status?.verdict, "pass");
  assert.equal(outcome.status?.reason_code, "review_passed");
  assert.equal(outcome.status?.task_write_state, "not_authorized");
  assert.deepEqual(outcome.status?.review_chain, {
    after_run_id: null,
    cycle: 1,
    max_cycles: 3,
    refused: null,
  });
  assert.equal(outcome.status?.policy_digest !== null, true);
  await fs.rm(root, { recursive: true, force: true });
});

test("review_chain is null when the run terminates before policy resolution", async () => {
  const { root } = await makeRepo();
  const outcome = await runReview(
    { repo: root, task: "../secret.md" },
    testDeps({ clock: testClock(CHILD_ID) }),
  );
  assert.equal(outcome.status?.reason_code, "path_invalid");
  assert.equal(outcome.status?.policy_digest, null);
  assert.equal(outcome.status?.review_chain, null);
  await fs.rm(root, { recursive: true, force: true });
});

test("after-run without the grant is chain_refused not_authorized and starts no reviewer", async () => {
  const { root, taskRel } = await makeRepo();
  const { counting, deps } = countingDeps(CHILD_ID);
  const outcome = await runReview({ repo: root, task: taskRel, after_run: PARENT_ID }, deps);
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.status?.state, "blocked");
  assert.equal(outcome.status?.reason_code, "chain_refused");
  assert.deepEqual(outcome.status?.review_chain, {
    after_run_id: PARENT_ID,
    cycle: null,
    max_cycles: 3,
    refused: "not_authorized",
  });
  assert.equal(counting.prepareCount, 0);
  assert.equal(counting.startCount, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test("granted after-run with a valid parent starts the reviewer at cycle 2", async () => {
  const { root, taskRel } = await makeRepo({ agents: validAgentsMd({ producerChain: true }) });
  await plantParent(root, taskRel, PARENT_ID);
  await reviseTask(root, taskRel);
  const { counting, deps } = countingDeps(CHILD_ID, constantSource(passResult()));
  const outcome = await runReview({ repo: root, task: taskRel, after_run: PARENT_ID }, deps);
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.status?.review_chain?.cycle, 2);
  assert.equal(outcome.status?.review_chain?.after_run_id, PARENT_ID);
  assert.equal(outcome.status?.review_chain?.max_cycles, 3);
  assert.equal(outcome.status?.review_chain?.refused, null);
  assert.equal(counting.startCount, 1);
  await fs.rm(root, { recursive: true, force: true });
});

test("each chain refusal cause terminates blocked and starts no reviewer", async () => {
  const cases: { name: string; afterRun: string; mutate?: (status: Record<string, unknown>) => void; revise?: boolean; extra?: (root: string) => Promise<void>; refused: string }[] = [
    {
      name: "run_unreadable missing file",
      afterRun: PARENT_ID,
      refused: "run_unreadable",
      revise: true,
    },
    {
      name: "task_mismatch",
      afterRun: PARENT_ID,
      mutate: (status) => {
        status.task_path = "spartan/tasks/other.md";
      },
      revise: true,
      refused: "task_mismatch",
    },
    {
      name: "verdict_not_chainable",
      afterRun: PARENT_ID,
      mutate: (status) => {
        status.verdict = "pass";
      },
      revise: true,
      refused: "verdict_not_chainable",
    },
    {
      name: "agents_changed",
      afterRun: PARENT_ID,
      revise: true,
      extra: async (root) => {
        const agents = await fs.readFile(path.join(root, "AGENTS.md"), "utf8");
        await fs.writeFile(path.join(root, "AGENTS.md"), `${agents}\n## Extra\n\nnote\n`, "utf8");
      },
      refused: "agents_changed",
    },
    {
      name: "task_unchanged",
      afterRun: PARENT_ID,
      refused: "task_unchanged",
    },
  ];
  for (const testCase of cases) {
    const { root, taskRel } = await makeRepo({ agents: validAgentsMd({ producerChain: true }) });
    if (testCase.name !== "run_unreadable missing file") {
      await plantParent(root, taskRel, PARENT_ID, testCase.mutate);
    }
    if (testCase.revise) {
      await reviseTask(root, taskRel);
    }
    await testCase.extra?.(root);
    const { counting, deps } = countingDeps(CHILD_ID);
    const outcome = await runReview({ repo: root, task: taskRel, after_run: testCase.afterRun }, deps);
    assert.equal(outcome.exitCode, 1, testCase.name);
    assert.equal(outcome.status?.state, "blocked", testCase.name);
    assert.equal(outcome.status?.reason_code, "chain_refused", testCase.name);
    assert.equal(outcome.status?.review_chain?.refused, testCase.refused, testCase.name);
    assert.equal(outcome.status?.review_chain?.cycle, null, testCase.name);
    assert.equal(counting.startCount, 0, testCase.name);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("traversal after-run is run_unreadable before any file is opened", async () => {
  const { root, taskRel } = await makeRepo({ agents: validAgentsMd({ producerChain: true }) });
  await plantParent(root, taskRel, PARENT_ID);
  await reviseTask(root, taskRel);
  const { counting, deps } = countingDeps(CHILD_ID);
  const outcome = await runReview({ repo: root, task: taskRel, after_run: TRAVERSAL }, deps);
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.status?.reason_code, "chain_refused");
  assert.equal(outcome.status?.review_chain?.refused, "run_unreadable");
  assert.equal(outcome.status?.review_chain?.after_run_id, TRAVERSAL);
  assert.equal(counting.startCount, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test("a referenced document missing chain fields is run_unreadable including a pre-change status", async () => {
  const { root, taskRel } = await makeRepo({ agents: validAgentsMd({ producerChain: true }) });
  await plantParent(root, taskRel, PARENT_ID, (status) => {
    delete status.review_chain;
  });
  await reviseTask(root, taskRel);
  const { counting, deps } = countingDeps(CHILD_ID);
  const outcome = await runReview({ repo: root, task: taskRel, after_run: PARENT_ID }, deps);
  assert.equal(outcome.status?.reason_code, "chain_refused");
  assert.equal(outcome.status?.review_chain?.refused, "run_unreadable");
  assert.equal(counting.startCount, 0);

  const other = await makeRepo({ agents: validAgentsMd({ producerChain: true }) });
  const runDir = path.join(other.root, ".spartan-bridge", "runs", PARENT_ID);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "status.json"), '{"hello":true}\n', "utf8");
  await reviseTask(other.root, other.taskRel);
  const incomplete = countingDeps(CHILD_ID);
  const parsed = await runReview(
    { repo: other.root, task: other.taskRel, after_run: PARENT_ID },
    incomplete.deps,
  );
  assert.equal(parsed.status?.review_chain?.refused, "run_unreadable");
  assert.equal(incomplete.counting.startCount, 0);
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(other.root, { recursive: true, force: true });
});

test("an accepted chain that fails after start keeps review_chain and is not chainable", async () => {
  const { root, taskRel } = await makeRepo({ agents: validAgentsMd({ producerChain: true }) });
  await plantParent(root, taskRel, PARENT_ID);
  await reviseTask(root, taskRel);
  const failed = await runReview(
    { repo: root, task: taskRel, after_run: PARENT_ID },
    testDeps({
      clock: testClock(CHILD_ID),
      createAdapter: () => new HookThrowAdapter(constantSource(passResult()), "collect", new Error("boom")),
    }),
  );
  assert.equal(failed.status?.reason_code, "adapter_error");
  assert.equal(failed.status?.verdict, null);
  assert.deepEqual(failed.status?.review_chain, {
    after_run_id: PARENT_ID,
    cycle: 2,
    max_cycles: 3,
    refused: null,
  });
  await reviseTask(root, taskRel);
  const { counting, deps } = countingDeps(THIRD_ID);
  const later = await runReview({ repo: root, task: taskRel, after_run: CHILD_ID }, deps);
  assert.equal(later.exitCode, 1);
  assert.equal(later.status?.reason_code, "chain_refused");
  assert.equal(later.status?.review_chain?.refused, "verdict_not_chainable");
  assert.equal(counting.startCount, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test("the first chained request is refused at the limit when max_review_cycles is 1", async () => {
  const { root, taskRel } = await makeRepo({
    agents: validAgentsMd({ producerChain: true, cycles: 1 }),
  });
  await plantParent(root, taskRel, PARENT_ID, (status) => {
    status.review_chain = { after_run_id: null, cycle: 1, max_cycles: 1, refused: null };
  });
  await reviseTask(root, taskRel);
  const { counting, deps } = countingDeps(CHILD_ID);
  const outcome = await runReview({ repo: root, task: taskRel, after_run: PARENT_ID }, deps);
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.status?.state, "human_required");
  assert.equal(outcome.status?.reason_code, "cycle_limit_reached");
  assert.deepEqual(outcome.status?.review_chain, {
    after_run_id: PARENT_ID,
    cycle: null,
    max_cycles: 1,
    refused: null,
  });
  assert.equal(counting.startCount, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test("with up to 3 cycles, cycles 2 and 3 are accepted and cycle 4 is not", async () => {
  for (const [parentCycle, expectedCycle, starts] of [
    [1, 2, true],
    [2, 3, true],
    [3, null, false],
  ] as const) {
    const { root, taskRel } = await makeRepo({ agents: validAgentsMd({ producerChain: true, cycles: 3 }) });
    await plantParent(root, taskRel, PARENT_ID, (status) => {
      status.review_chain = { after_run_id: null, cycle: parentCycle, max_cycles: 3, refused: null };
    });
    await reviseTask(root, taskRel);
    const { counting, deps } = countingDeps(CHILD_ID, constantSource(passResult()));
    const outcome = await runReview({ repo: root, task: taskRel, after_run: PARENT_ID }, deps);
    if (starts) {
      assert.equal(outcome.status?.review_chain?.cycle, expectedCycle, `parent ${parentCycle}`);
      assert.equal(outcome.status?.review_chain?.refused, null, `parent ${parentCycle}`);
      assert.equal(counting.startCount, 1, `parent ${parentCycle}`);
    } else {
      assert.equal(outcome.exitCode, 1, `parent ${parentCycle}`);
      assert.equal(outcome.status?.reason_code, "cycle_limit_reached", `parent ${parentCycle}`);
      assert.equal(outcome.status?.review_chain?.cycle, null, `parent ${parentCycle}`);
      assert.equal(outcome.status?.review_chain?.refused, null, `parent ${parentCycle}`);
      assert.equal(counting.startCount, 0, `parent ${parentCycle}`);
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("AGENTS.md files differing only by the grant sentence produce different policy digests", async () => {
  const without = await makeRepo({ agents: validAgentsMd() });
  const granted = await makeRepo({ agents: validAgentsMd({ producerChain: true }) });
  const a = await runReview(
    { repo: without.root, task: without.taskRel },
    testDeps({ clock: testClock(PARENT_ID) }),
  );
  const b = await runReview(
    { repo: granted.root, task: granted.taskRel },
    testDeps({ clock: testClock(PARENT_ID) }),
  );
  assert.notEqual(a.status?.policy_digest, b.status?.policy_digest);
  assert.deepEqual(a.status?.review_chain, {
    after_run_id: null,
    cycle: 1,
    max_cycles: 3,
    refused: null,
  });
  assert.deepEqual(b.status?.review_chain, a.status?.review_chain);
  await fs.rm(without.root, { recursive: true, force: true });
  await fs.rm(granted.root, { recursive: true, force: true });
});

test("0015 adoption example still parses and runs unchained", async () => {
  const readme = await fs.readFile(new URL("../README.md", import.meta.url), "utf8");
  const block = /```markdown\n(## Agent hosts\n[\s\S]*?repeat up to 3 plan-review cycles\.\n)```/.exec(readme);
  assert.ok(block?.[1], "adoption example fence");
  const { root, taskRel } = await makeRepo({ agents: block[1] });
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(CHILD_ID) }),
  );
  assert.equal(outcome.status?.reason_code, "review_passed");
  assert.equal(outcome.status?.review_chain?.cycle, 1);
  assert.equal(outcome.status?.review_chain?.after_run_id, null);
  await fs.rm(root, { recursive: true, force: true });
});

test("MCP review tool input schema is unchanged", () => {
  assert.deepEqual(REVIEW_TOOL.inputSchema, {
    type: "object",
    properties: {
      task: {
        type: "string",
      },
    },
    required: ["task"],
    additionalProperties: false,
  });
});

test("chain_refused and cycle_limit_reached exit 1 and map as MCP errors", async () => {
  const refusedRepo = await makeRepo();
  const refused = await runReview(
    { repo: refusedRepo.root, task: refusedRepo.taskRel, after_run: PARENT_ID },
    testDeps({ clock: testClock(CHILD_ID) }),
  );
  assert.equal(refused.exitCode, 1);
  assert.equal(refused.status?.reason_code, "chain_refused");
  assert.equal(mapReviewOutcome(refused).isError, true);

  const limitRepo = await makeRepo({ agents: validAgentsMd({ producerChain: true, cycles: 1 }) });
  await plantParent(limitRepo.root, limitRepo.taskRel, PARENT_ID, (status) => {
    status.review_chain = { after_run_id: null, cycle: 1, max_cycles: 1, refused: null };
  });
  await reviseTask(limitRepo.root, limitRepo.taskRel);
  const limit = await runReview(
    { repo: limitRepo.root, task: limitRepo.taskRel, after_run: PARENT_ID },
    testDeps({ clock: testClock(CHILD_ID) }),
  );
  assert.equal(limit.exitCode, 1);
  assert.equal(limit.status?.reason_code, "cycle_limit_reached");
  assert.equal(mapReviewOutcome(limit).isError, true);
  await fs.rm(refusedRepo.root, { recursive: true, force: true });
  await fs.rm(limitRepo.root, { recursive: true, force: true });
});

test("live two-cycle chain continues with after-run then stops at the limit", async () => {
  const { root, taskRel } = await makeRepo({
    agents: validAgentsMd({ producerChain: true, taskWrite: true, cycles: 2 }),
    task: validTaskMd({ reviewSection: `\n${DEFAULT_REVIEW_SECTION}` }),
  });
  const first = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(changesResult()), clock: testClock(PARENT_ID) }),
  );
  assert.equal(first.status?.verdict, "changes_requested");
  assert.equal(first.status?.reason_code, "review_changes_requested");
  assert.equal(first.status?.task_write_state, "written");
  assert.equal(first.status?.review_chain?.cycle, 1);
  assert.equal(first.status?.review_chain?.after_run_id, null);
  await reviseTask(root, taskRel);
  const second = await runReview(
    { repo: root, task: taskRel, after_run: PARENT_ID },
    testDeps({ source: constantSource(changesResult()), clock: testClock(CHILD_ID) }),
  );
  assert.equal(second.status?.verdict, "changes_requested");
  assert.equal(second.status?.reason_code, "review_changes_requested");
  assert.equal(second.status?.task_write_state, "written");
  assert.equal(second.status?.review_chain?.cycle, 2);
  assert.equal(second.status?.review_chain?.after_run_id, PARENT_ID);
  await reviseTask(root, taskRel);
  const { counting, deps } = countingDeps(THIRD_ID);
  const third = await runReview({ repo: root, task: taskRel, after_run: CHILD_ID }, deps);
  assert.equal(third.exitCode, 1);
  assert.equal(third.status?.reason_code, "cycle_limit_reached");
  assert.equal(third.status?.review_chain?.cycle, null);
  assert.equal(counting.startCount, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test("task_unchanged with next_role planner is chain_refused not a transition refusal", async () => {
  const { root, taskRel } = await makeRepo({
    agents: validAgentsMd({ producerChain: true, taskWrite: true }),
    task: validTaskMd({ nextRole: "planner" }),
  });
  await plantParent(root, taskRel, PARENT_ID);
  const inner = testDeps({ source: constantSource(passResult()), clock: testClock(CHILD_ID) });
  const resolved: string[] = [];
  const outcome = await runReview(
    { repo: root, task: taskRel, after_run: PARENT_ID },
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
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.status?.state, "blocked");
  assert.equal(outcome.status?.reason_code, "chain_refused");
  assert.equal(outcome.status?.review_chain?.refused, "task_unchanged");
  assert.notEqual(outcome.status?.reason_code, "transition_next_role_not_reviewer");
  assert.deepEqual(resolved, []);
  await fs.rm(root, { recursive: true, force: true });
});

test("healthy cycle 2 with next_role planner refuses before the reviewer", async () => {
  const { root, taskRel } = await makeRepo({
    agents: validAgentsMd({ producerChain: true, taskWrite: true }),
    task: validTaskMd({ nextRole: "planner" }),
  });
  await plantParent(root, taskRel, PARENT_ID);
  const abs = path.join(root, taskRel);
  await fs.writeFile(abs, `${await fs.readFile(abs, "utf8")}\nProducer revision.\n`, "utf8");
  const inner = testDeps({ source: constantSource(passResult()), clock: testClock(CHILD_ID) });
  const resolved: string[] = [];
  const outcome = await runReview(
    { repo: root, task: taskRel, after_run: PARENT_ID },
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
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.status?.state, "human_required");
  assert.equal(outcome.status?.reason_code, "transition_next_role_not_reviewer");
  assert.equal(outcome.status?.review_chain?.cycle, 2);
  assert.equal(outcome.status?.review_chain?.after_run_id, PARENT_ID);
  assert.equal(outcome.status?.review_chain?.refused, null);
  assert.deepEqual(resolved, []);
  await fs.rm(root, { recursive: true, force: true });
});


test("after an accepted child fails without a verdict, retrying the same parent is admitted at the same cycle", async () => {
  const { root, taskRel } = await makeRepo({ agents: validAgentsMd({ producerChain: true }) });
  await plantParent(root, taskRel, PARENT_ID);
  await reviseTask(root, taskRel);
  const failed = await runReview(
    { repo: root, task: taskRel, after_run: PARENT_ID },
    testDeps({
      clock: testClock(CHILD_ID),
      createAdapter: () => new HookThrowAdapter(constantSource(passResult()), "collect", new Error("boom")),
    }),
  );
  assert.equal(failed.status?.state, "failed");
  assert.equal(failed.status?.verdict, null);
  assert.deepEqual(failed.status?.review_chain, {
    after_run_id: PARENT_ID,
    cycle: 2,
    max_cycles: 3,
    refused: null,
  });
  await reviseTask(root, taskRel);
  const { counting, deps } = countingDeps(THIRD_ID, constantSource(passResult()));
  const retry = await runReview({ repo: root, task: taskRel, after_run: PARENT_ID }, deps);
  assert.equal(retry.status?.review_chain?.refused, null);
  assert.equal(retry.status?.review_chain?.after_run_id, PARENT_ID);
  assert.equal(retry.status?.review_chain?.cycle, 2);
  assert.equal(counting.startCount, 1);
  await fs.rm(root, { recursive: true, force: true });
});

