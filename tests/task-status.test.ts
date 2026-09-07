import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { formatTaskChainStatusReport, reportTaskChainStatus } from "../src/cli/task-status.ts";
import { makeRepo, validAgentsMd, writeBridgeConfig } from "./helpers.ts";

const execFileAsync = promisify(execFile);

async function gitInitCommit(root: string): Promise<void> {
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@test"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: root });
  await execFileAsync("git", ["add", "-A"], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: root });
}

test("reportTaskChainStatus returns completed transition and implementation verdict", async () => {
  const { root: r0, taskRel } = await makeRepo({ agents: validAgentsMd({ automaticImplementation: true }) });
  const root = await fs.realpath(r0);
  await writeBridgeConfig(root);
  const planRunId = "run-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const reviewRunId = "run-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const transitionId = "transition-cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  await fs.mkdir(path.join(root, ".spartan-bridge", "runs", planRunId), { recursive: true });
  await fs.mkdir(path.join(root, ".spartan-bridge", "runs", reviewRunId), { recursive: true });
  await fs.mkdir(path.join(root, ".spartan-bridge", "transitions", transitionId), { recursive: true });
  await fs.writeFile(
    path.join(root, ".spartan-bridge", "runs", reviewRunId, "status.json"),
    `${JSON.stringify({
      schema_version: 2,
      run_id: reviewRunId,
      state: "awaiting_implementer",
      review_kind: "implementation",
      verdict: "pass",
      reason_code: "review_passed",
      task_path: taskRel,
      host: "claude",
      client_context: "personal",
      model: "claude-sonnet-5",
      effort: "medium",
      model_observed: "declared_unobserved",
      policy_digest: null,
      artifact_hashes: { task: null, agents: null },
      execution_id: null,
      task_write_state: "written",
      task_hash_after_write: null,
      task_write_rejection_cause: null,
      review_verdict_log: null,
      reviewer_write: null,
      adapter_failure: null,
      pre_dispatch_diagnostic: null,
      producer_identity: null,
      review_chain: null,
      transition_id: transitionId,
      created_at: "2026-09-02T00:00:00.000Z",
      updated_at: "2026-09-02T00:00:00.000Z",
    })}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(root, ".spartan-bridge", "transitions", transitionId, "status.json"),
    `${JSON.stringify({
      schema_version: 2,
      document: "transition",
      transition_id: transitionId,
      state: "completed",
      parent_run_id: planRunId,
      task_path: taskRel,
      approved_task_hash: null,
      policy_digest: null,
      implementer_host: null,
      implementer_launcher_id: null,
      lock_identity: null,
      reason_code: null,
      producer_diagnostic: null,
      unwritable_plan_targets: null,
      declaration_invalid_detail: null,
      current_review_run_id: reviewRunId,
      linked_review_run_ids: [reviewRunId],
      created_at: "2026-09-02T00:00:00.000Z",
      updated_at: "2026-09-02T01:00:00.000Z",
    })}\n`,
    "utf8",
  );

  const report = await reportTaskChainStatus(root, taskRel);
  assert.equal(report.error, null);
  assert.equal(report.transition_id, transitionId);
  assert.equal(report.transition_state, "completed");
  assert.equal(report.implementation_review_run_id, reviewRunId);
  assert.equal(report.implementation_review_verdict, "pass");
  assert.equal(report.implementation_review_reason_code, "review_passed");
  await fs.rm(root, { recursive: true, force: true });
});

test("reportTaskChainStatus reports completed_transition_not_found when no completed chain exists", async () => {
  const { root: r0, taskRel } = await makeRepo();
  const root = await fs.realpath(r0);
  const report = await reportTaskChainStatus(root, taskRel);
  assert.equal(report.error, "completed_transition_not_found");
  await fs.rm(root, { recursive: true, force: true });
});

test("reportTaskChainStatus reports task_not_found for an invalid task path", async () => {
  const { root: r0 } = await makeRepo();
  const root = await fs.realpath(r0);
  const report = await reportTaskChainStatus(root, "../outside.md");
  assert.equal(report.error, "task_not_found");
  await fs.rm(root, { recursive: true, force: true });
});

test("reportTaskChainStatus includes git diff --stat over the automatic write scope", async () => {
  const { root: r0, taskRel, productRel } = await makeRepo({ agents: validAgentsMd({ automaticImplementation: true }) });
  const root = await fs.realpath(r0);
  await writeBridgeConfig(root);
  await gitInitCommit(root);
  await fs.writeFile(path.join(root, productRel), "product-v2\n", "utf8");

  const planRunId = "run-dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const reviewRunId = "run-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const transitionId = "transition-ffffffff-ffff-4fff-8fff-ffffffffffff";
  await fs.mkdir(path.join(root, ".spartan-bridge", "runs", reviewRunId), { recursive: true });
  await fs.mkdir(path.join(root, ".spartan-bridge", "transitions", transitionId), { recursive: true });
  await fs.writeFile(
    path.join(root, ".spartan-bridge", "runs", reviewRunId, "status.json"),
    `${JSON.stringify({
      schema_version: 2,
      run_id: reviewRunId,
      state: "awaiting_implementer",
      review_kind: "implementation",
      verdict: "pass",
      reason_code: "review_passed",
      task_path: taskRel,
      host: "claude",
      client_context: "personal",
      model: "claude-sonnet-5",
      effort: "medium",
      model_observed: "declared_unobserved",
      policy_digest: null,
      artifact_hashes: { task: null, agents: null },
      execution_id: null,
      task_write_state: "written",
      task_hash_after_write: null,
      task_write_rejection_cause: null,
      review_verdict_log: null,
      reviewer_write: null,
      adapter_failure: null,
      pre_dispatch_diagnostic: null,
      producer_identity: null,
      review_chain: null,
      transition_id: transitionId,
      created_at: "2026-09-02T00:00:00.000Z",
      updated_at: "2026-09-02T00:00:00.000Z",
    })}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(root, ".spartan-bridge", "transitions", transitionId, "status.json"),
    `${JSON.stringify({
      schema_version: 2,
      document: "transition",
      transition_id: transitionId,
      state: "completed",
      parent_run_id: planRunId,
      task_path: taskRel,
      approved_task_hash: null,
      policy_digest: null,
      implementer_host: null,
      implementer_launcher_id: null,
      lock_identity: null,
      reason_code: null,
      producer_diagnostic: null,
      unwritable_plan_targets: null,
      declaration_invalid_detail: null,
      current_review_run_id: reviewRunId,
      linked_review_run_ids: [reviewRunId],
      created_at: "2026-09-02T00:00:00.000Z",
      updated_at: "2026-09-02T01:00:00.000Z",
    })}\n`,
    "utf8",
  );

  const report = await reportTaskChainStatus(root, taskRel);
  assert.equal(report.error, null);
  assert.match(report.git_diff_stat ?? "", /product\.txt/);
  const formatted = formatTaskChainStatusReport(report);
  assert.match(formatted, /"transition_state":"completed"/);
  assert.match(formatted, /"implementation_review_verdict":"pass"/);
  await fs.rm(root, { recursive: true, force: true });
});
