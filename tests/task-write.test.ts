import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PRODUCTION_FAKE_RESULT } from "../src/adapters/fake.ts";
import {
  COMPOSITION_FAILED_HINTS,
  PLAN_REVIEW_NEXT_ROLE,
  IMPLEMENTATION_REVIEW_NEXT_ROLE,
  REGION_BYTE_CAP,
  RETRACTED_NEXT_HANDOFF_SECTION,
  REVIEW_BEGIN,
  REVIEW_END,
  REVIEW_IMPLEMENTATION_BEGIN,
  REVIEW_IMPLEMENTATION_END,
  REVIEW_PLAN_BEGIN,
  REVIEW_PLAN_END,
  TASK_WRITE_FRONTMATTER_KEYS,
  TEMPLATE_PENDING_PLACEHOLDER,
  commitTaskArtifactWrite,
  checkArtifactWriteShape,
  describeNextHandoffRejection,
  type NextHandoffRejectSlug,
  checkTerminalCloseShape,
  composeTerminalCloseOut,
  renderCompletionNotice,
  TERMINAL_CLOSE_PROBE_RUN_ID,
  writeTerminalCloseOut,
  composeTaskArtifactWrite,
  decidePlanReviewTransition,
  decideReviewTransition,
  headingRejects,
  planReviewTransitionPrecondition,
  preservedAuthorizedBytes,
  renderRegion,
  spliceRegion,
  writeTaskReviewRegion,
  type TaskWriteMeta,
} from "../src/core/task-write.ts";
import { runReview } from "../src/core/review.ts";
import { sha256Bytes } from "../src/core/serialize.ts";
import { parseTaskFrontmatter } from "../src/policy/task-frontmatter.ts";
import {
  DEFAULT_REVIEW_SECTION,
  fileExists,
  blockedResult,
  changesResult,
  constantSource,
  eventTypes,
  loadRun,
  makeRepo,
  passResult,
  snapshotFiles,
  testClock,
  testDeps,
  validAgentsMd,
  validTaskMd,
  implementationTaskMd,
} from "./helpers.ts";

const RUN_ID = "run-55555555-5555-4555-8555-555555555555";

const PRESERVED_FRONTMATTER_KEYS = [
  "protocol",
  "id",
  "created_at",
  "status",
  "phase",
  "task_type",
  "risk",
  "current_role",
  "handoff_id",
  "next_handoff_id",
] as const;

const NEXT_HANDOFF_SECTION = `## Next Handoff

\`\`\`text
stale envelope remains
\`\`\`
`;

function transitionTaskMd(options?: { nextRole?: string }): string {
  return validTaskMd({
    protocol: "1.0.0",
    nextRole: options?.nextRole ?? "reviewer",
    reviewSection: `\n${DEFAULT_REVIEW_SECTION}\n${NEXT_HANDOFF_SECTION}`,
  })
    .replace(`protocol: "1.0.0"`, `protocol: "1.0.0" # x-release-please-version`)
    .replace("updated_at: 2026-08-16", "updated_at: 2020-01-01");
}

function writeRepo(options?: { task?: string; duplicateGrant?: boolean; agents?: string }) {
  return makeRepo({
    agents: options?.agents ?? validAgentsMd({ taskWrite: true, duplicateTaskWrite: options?.duplicateGrant }),
    task: options?.task ?? validTaskMd({ reviewSection: `\n${DEFAULT_REVIEW_SECTION}` }),
  });
}

test("task_artifact_write grant absence, presence, and duplication", async () => {
  const missing = await makeRepo({
    agents: validAgentsMd(),
    task: validTaskMd({ reviewSection: `\n${DEFAULT_REVIEW_SECTION}` }),
  });
  const missingOutcome = await runReview(
    { repo: missing.root, task: missing.taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
  );
  assert.equal(missingOutcome.status?.reason_code, "review_passed");
  assert.equal(missingOutcome.status?.task_write_state, "not_authorized");
  assert.equal(missingOutcome.exitCode, 0);
  await fs.rm(missing.root, { recursive: true, force: true });

  const granted = await writeRepo();
  const grantedOutcome = await runReview(
    { repo: granted.root, task: granted.taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
  );
  assert.equal(grantedOutcome.status?.task_write_state, "written");
  assert.equal(grantedOutcome.exitCode, 0);
  await fs.rm(granted.root, { recursive: true, force: true });

  const dup = await writeRepo({ duplicateGrant: true });
  const dupOutcome = await runReview(
    { repo: dup.root, task: dup.taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
  );
  assert.equal(dupOutcome.status?.reason_code, "agents_policy_invalid");
  assert.equal(dupOutcome.status?.state, "failed");
  await fs.rm(dup.root, { recursive: true, force: true });
});

test("pass and changes_requested write the owned region; human_required and blocked skip it", async () => {
  const passRepo = await writeRepo({ task: transitionTaskMd() });
  const beforePass = await fs.readFile(path.join(passRepo.root, passRepo.taskRel), "utf8");
  const passOutcome = await runReview(
    { repo: passRepo.root, task: passRepo.taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
  );
  assert.equal(passOutcome.status?.reason_code, "review_passed");
  assert.equal(passOutcome.status?.task_write_state, "written");
  assert.equal(passOutcome.status?.task_hash_after_write?.startsWith("sha256:"), true);
  const passText = await fs.readFile(path.join(passRepo.root, passRepo.taskRel), "utf8");
  assert.match(passText, /^Verdict: APPROVED$/m);
  assert.match(passText, /- None recorded\./);
  assert.match(passText, /model=Composer-2\.5 effort=none model_observed=declared_unobserved/);
  assert.match(passText, /Human notes stay below the Bridge region\./);
  assert.equal(passText.includes(REVIEW_PLAN_BEGIN), true);
  assert.equal((passText.match(new RegExp(REVIEW_PLAN_BEGIN, "g")) ?? []).length, 1);
  assert.equal(preservedAuthorizedBytes(beforePass, passText), true);
  assertFrontmatterLine(passText, "next_role", "next_role: implementer");
  assertFrontmatterLine(passText, "updated_at", "updated_at: 2026-08-16");
  assertFrontmatterLine(passText, "current_role", frontmatterKeyLine(beforePass, "current_role"));
  assertPreservedFrontmatterLines(beforePass, passText);
  assert.equal(nextHandoffSection(passText), nextHandoffSection(beforePass));
  const passRun = await loadRun(passRepo.root, RUN_ID);
  assert.deepEqual(eventTypes(passRun.events), [
    "run_requested",
    "policy_resolved",
    "review_started",
    "review_result_accepted",
    "task_artifact_written",
    "run_terminal",
  ]);
  const accepted = passRun.events.find((event) => event.type === "review_result_accepted");
  const written = passRun.events.find((event) => event.type === "task_artifact_written");
  const terminal = passRun.events.find((event) => event.type === "run_terminal");
  assert.equal(accepted?.task_write_state, null);
  assert.equal(accepted?.task_hash_after_write, null);
  assert.equal(accepted?.reason_code, "review_passed");
  assert.equal(written?.task_write_state, "written");
  assert.equal(written?.reason_code, "review_passed");
  assert.equal(written?.task_hash_after_write, passOutcome.status?.task_hash_after_write);
  assert.equal(terminal?.task_write_state, "written");
  await fs.rm(passRepo.root, { recursive: true, force: true });

  const changesRepo = await writeRepo({ task: transitionTaskMd() });
  const beforeChanges = await fs.readFile(path.join(changesRepo.root, changesRepo.taskRel), "utf8");
  const changesOutcome = await runReview(
    { repo: changesRepo.root, task: changesRepo.taskRel },
    testDeps({ source: constantSource(changesResult()), clock: testClock(RUN_ID) }),
  );
  assert.equal(changesOutcome.status?.reason_code, "review_changes_requested");
  const changesText = await fs.readFile(path.join(changesRepo.root, changesRepo.taskRel), "utf8");
  assert.match(changesText, /^Verdict: CHANGES_REQUESTED$/m);
  assert.match(changesText, /- `F1` \(warning\): Pin the remaining contract\./);
  assertFrontmatterLine(changesText, "next_role", "next_role: planner");
  assertFrontmatterLine(changesText, "updated_at", "updated_at: 2026-08-16");
  assertPreservedFrontmatterLines(beforeChanges, changesText);
  assert.equal(nextHandoffSection(changesText), nextHandoffSection(beforeChanges));
  await fs.rm(changesRepo.root, { recursive: true, force: true });

  for (const [source, reason, writeState] of [
    [constantSource(PRODUCTION_FAKE_RESULT), "review_human_required", "skipped_human_gate"],
    [constantSource(blockedResult()), "review_blocked", "skipped_human_gate"],
  ] as const) {
    const repo = await writeRepo({ task: transitionTaskMd() });
    const before = await snapshotFiles(repo.root, [repo.taskRel, repo.productRel, "AGENTS.md"]);
    const beforeText = await fs.readFile(path.join(repo.root, repo.taskRel), "utf8");
    const outcome = await runReview(
      { repo: repo.root, task: repo.taskRel },
      testDeps({ source, clock: testClock(RUN_ID) }),
    );
    assert.equal(outcome.status?.reason_code, reason);
    assert.equal(outcome.status?.task_write_state, writeState);
    assert.equal(outcome.exitCode, 0);
    const after = await snapshotFiles(repo.root, [repo.taskRel, repo.productRel, "AGENTS.md"]);
    assert.deepEqual(after, before);
    const afterText = await fs.readFile(path.join(repo.root, repo.taskRel), "utf8");
    assertAllTwelveFrontmatterLinesUnchanged(beforeText, afterText);
    const { events } = await loadRun(repo.root, RUN_ID);
    assert.equal(events.some((event) => event.type === "task_artifact_written"), false);
    await fs.rm(repo.root, { recursive: true, force: true });
  }
});

test("two successive accepted reviews replace the owned region in full", async () => {
  const { root, taskRel } = await writeRepo();
  await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
  );
  const afterFirst = await fs.readFile(path.join(root, taskRel), "utf8");
  await fs.writeFile(
    path.join(root, taskRel),
    afterFirst.replace(/^next_role: implementer$/m, "next_role: reviewer"),
  );
  await runReview(
    { repo: root, task: taskRel },
    testDeps({
      source: constantSource(changesResult()),
      clock: testClock("run-66666666-6666-4666-8666-666666666666"),
    }),
  );
  const text = await fs.readFile(path.join(root, taskRel), "utf8");
  assert.equal((text.match(new RegExp(REVIEW_PLAN_BEGIN, "g")) ?? []).length, 1);
  assert.equal((text.match(new RegExp(REVIEW_PLAN_END, "g")) ?? []).length, 1);
  assert.match(text, /^Verdict: CHANGES_REQUESTED$/m);
  assert.doesNotMatch(text, /^Verdict: APPROVED$/m);
  assert.match(text, /Human notes stay below the Bridge region\./);
  await fs.rm(root, { recursive: true, force: true });
});

test("heading matcher rejects trailing space, closing hashes, suffix, fences, zero, and two headings", async () => {
  const fixtures = [
    "## Review \n\nbody\n",
    "## Review ##\n\nbody\n",
    "## Review notes\n\nbody\n",
    "```\n## Review\n```\n",
    "# Fixture\n\nNo review heading.\n",
    "## Review\n\nbody\n\n## Review\n\nagain\n",
  ];
  for (const body of fixtures) {
    assert.equal(headingRejects(`---\nstatus: active\n---\n\n${body}`), true, body);
    const { root, taskRel } = await writeRepo({ task: `${validTaskMd()}\n${body}` });
    const before = await fs.readFile(path.join(root, taskRel));
    const outcome = await runReview(
      { repo: root, task: taskRel },
      testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
    );
    // D1/D2 (task 0046): an unrecognisable `## Review` shape is now refused
    // before the adapter is constructed — no verdict, no `task_write_state`,
    // and the named cause is `composition_failed`.
    assert.equal(outcome.status?.reason_code, "task_artifact_write_rejected", body);
    assert.equal(outcome.status?.state, "human_required");
    assert.equal(outcome.status?.verdict, null);
    assert.equal(outcome.status?.task_write_state, null);
    assert.equal(outcome.status?.task_write_rejection_cause, "composition_failed", body);
    assert.equal(outcome.status?.execution_id, null, body);
    assert.equal(outcome.exitCode, 1);
    assert.equal(await fileExists(path.join(root, ".spartan-bridge", "runs", RUN_ID, "reviews")), false, body);
    const after = await fs.readFile(path.join(root, taskRel));
    assert.deepEqual(after, before);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("forbidden tokens, unbalanced markers, and markers outside the section reject the write", async () => {
  const forbidden = {
    schema_version: 2 as const,
    review_kind: "plan" as const,
    verdict: "pass" as const,
    summary: "contains <!-- token",
    findings: [],
  };
  const { root, taskRel } = await writeRepo();
  const before = await fs.readFile(path.join(root, taskRel));
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(forbidden), clock: testClock(RUN_ID) }),
  );
  assert.equal(outcome.status?.reason_code, "task_artifact_write_rejected");
  assert.deepEqual(await fs.readFile(path.join(root, taskRel)), before);
  await fs.rm(root, { recursive: true, force: true });

  const outside = await writeRepo({
    task: `${validTaskMd({ reviewSection: `\n${DEFAULT_REVIEW_SECTION}` })}\n${REVIEW_BEGIN}\n`,
  });
  const outsideBefore = await fs.readFile(path.join(outside.root, outside.taskRel));
  const outsideOutcome = await runReview(
    { repo: outside.root, task: outside.taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
  );
  assert.equal(outsideOutcome.status?.reason_code, "task_artifact_write_rejected");
  assert.deepEqual(await fs.readFile(path.join(outside.root, outside.taskRel)), outsideBefore);
  await fs.rm(outside.root, { recursive: true, force: true });

  const unbalanced = `## Review\n\n${REVIEW_BEGIN}\nnot closed\n`;
  assert.equal(spliceRegion(`---\n---\n${unbalanced}`, `${REVIEW_BEGIN}\nx\n${REVIEW_END}\n`), null);
});

test("status.json key order includes the new write fields as null before the write decision", async () => {
  const { root, taskRel } = await makeRepo();
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
  );
  const raw = await fs.readFile(path.join(root, ".spartan-bridge", "runs", RUN_ID, "status.json"), "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed), [
    "schema_version",
    "run_id",
    "state",
    "review_kind",
    "task_path",
    "host",
    "client_context",
    "model",
    "effort",
    "model_observed",
    "policy_digest",
    "artifact_hashes",
    "execution_id",
    "verdict",
    "reason_code",
    "task_write_state",
    "task_hash_after_write",
    "task_write_rejection_cause",
    "review_verdict_log",
    "reviewer_write",
    "adapter_failure",
    "pre_dispatch_diagnostic",
    "producer_identity",
    "review_chain",
    "transition_id",
    "created_at",
    "updated_at",
  ]);
  assert.equal(parsed.schema_version, 2);
  assert.equal(parsed.host, "cursor");
  assert.equal(parsed.client_context, "personal");
  assert.equal(parsed.model, "Composer-2.5");
  assert.equal(parsed.effort, "none");
  assert.equal(parsed.model_observed, "declared_unobserved");
  assert.equal(parsed.task_write_state, "not_authorized");
  assert.equal(parsed.task_hash_after_write, null);
  const { events } = await loadRun(root, RUN_ID);
  for (const event of events) {
    assert.deepEqual(Object.keys(event), [
      "schema_version",
      "sequence",
      "timestamp",
      "run_id",
      "type",
      "state",
      "review_kind",
      "policy_digest",
      "artifact_hashes",
      "execution_id",
      "verdict",
      "reason_code",
      "task_write_state",
      "task_hash_after_write",
      "task_write_rejection_cause",
      "pre_dispatch_diagnostic",
    ]);
  }
  const accepted = events.find((event) => event.type === "review_result_accepted");
  assert.equal(accepted?.task_write_state, null);
  assert.equal(outcome.exitCode, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test("transition mapping writes only next_role and updated_at and never current_role", async () => {
  assert.deepEqual(Object.keys(PLAN_REVIEW_NEXT_ROLE), ["pass", "changes_requested"]);
  assert.equal(PLAN_REVIEW_NEXT_ROLE.pass, "implementer");
  assert.equal(PLAN_REVIEW_NEXT_ROLE.changes_requested, "planner");
  assert.deepEqual(Object.keys(IMPLEMENTATION_REVIEW_NEXT_ROLE), ["pass", "changes_requested"]);
  assert.equal(IMPLEMENTATION_REVIEW_NEXT_ROLE.pass, "human-operator");
  assert.equal(IMPLEMENTATION_REVIEW_NEXT_ROLE.changes_requested, "implementer");
  assert.equal("human_required" in PLAN_REVIEW_NEXT_ROLE, false);
  assert.equal("blocked" in PLAN_REVIEW_NEXT_ROLE, false);
  assert.deepEqual([...TASK_WRITE_FRONTMATTER_KEYS], ["next_role", "updated_at", "handoff_id", "next_handoff_id"]);
  assert.equal((TASK_WRITE_FRONTMATTER_KEYS as readonly string[]).includes("current_role"), false);
  assert.equal((TASK_WRITE_FRONTMATTER_KEYS as readonly string[]).includes("status"), false);
  assert.equal((TASK_WRITE_FRONTMATTER_KEYS as readonly string[]).includes("phase"), false);
  assert.equal((TASK_WRITE_FRONTMATTER_KEYS as readonly string[]).includes("task_type"), false);

  const passDecision = decidePlanReviewTransition({
    reviewKind: "plan",
    currentNextRole: "reviewer",
    verdict: "pass",
  });
  const changesDecision = decidePlanReviewTransition({
    reviewKind: "plan",
    currentNextRole: "reviewer",
    verdict: "changes_requested",
  });
  assert.deepEqual(passDecision, { ok: true, next_role: "implementer" });
  assert.deepEqual(changesDecision, { ok: true, next_role: "planner" });
  assert.deepEqual(
    decideReviewTransition({ reviewKind: "implementation", currentNextRole: "reviewer", verdict: "pass" }),
    { ok: true, next_role: "human-operator" },
  );
  assert.deepEqual(
    decideReviewTransition({
      reviewKind: "implementation",
      currentNextRole: "reviewer",
      verdict: "changes_requested",
    }),
    { ok: true, next_role: "implementer" },
  );

  const { root, taskRel } = await writeRepo({ task: transitionTaskMd() });
  const before = await fs.readFile(path.join(root, taskRel), "utf8");
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
  );
  assert.equal(outcome.status?.task_write_state, "written");
  const after = await fs.readFile(path.join(root, taskRel), "utf8");
  assert.equal(frontmatterKeyLine(after, "current_role"), frontmatterKeyLine(before, "current_role"));
  assert.equal(frontmatterKeyLine(after, "current_role"), "current_role: planner");
  await fs.rm(root, { recursive: true, force: true });
});

test("planReviewTransitionPrecondition and decidePlanReviewTransition agree on every refusal", () => {
  const kinds = ["plan", "implementation"];
  const roles = [
    "human-operator",
    "investigator",
    "planner",
    "implementer",
    "reviewer",
    "independent-reviewer",
    "verifier",
  ];
  const verdicts = ["pass", "changes_requested"] as const;
  for (const reviewKind of kinds) {
    for (const currentNextRole of roles) {
      const precondition = planReviewTransitionPrecondition({ reviewKind, currentNextRole });
      for (const verdict of verdicts) {
        const transition = decidePlanReviewTransition({ reviewKind, currentNextRole, verdict });
        if (!precondition.ok) {
          assert.equal(transition.ok, false, `${reviewKind}/${currentNextRole}/${verdict}`);
          if (!transition.ok) {
            assert.equal(transition.reason, precondition.reason, `${reviewKind}/${currentNextRole}/${verdict}`);
          }
        } else if (reviewKind !== "plan") {
          assert.deepEqual(transition, { ok: false, reason: "transition_review_kind_refused" });
        } else {
          assert.deepEqual(transition, { ok: true, next_role: PLAN_REVIEW_NEXT_ROLE[verdict] });
        }
      }
    }
  }
});

test("decidePlanReviewTransition still refuses implementation; decideReviewTransition maps it", async () => {
  const { root, taskRel } = await writeRepo({ task: transitionTaskMd() });
  const taskAbs = path.join(root, taskRel);
  const original = new Uint8Array(await fs.readFile(taskAbs));
  const written = await writeTaskReviewRegion({
    taskAbs,
    expectedHash: sha256Bytes(original),
    result: passResult("implementation"),
    meta: sampleMeta({ review_kind: "implementation" }),
  });
  assert.equal(written.ok, true);
  const after = await fs.readFile(taskAbs, "utf8");
  assert.match(after, /^next_role: human-operator$/m);
  assert.equal(
    decidePlanReviewTransition({
      reviewKind: "implementation",
      currentNextRole: "reviewer",
      verdict: "pass",
    }).ok,
    false,
  );
  await fs.rm(root, { recursive: true, force: true });
});

test("next_role other than reviewer is refused with a named reason and writes nothing", async () => {
  const { root, taskRel } = await writeRepo({ task: transitionTaskMd({ nextRole: "planner" }) });
  const before = await fs.readFile(path.join(root, taskRel));
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
  );
  assert.equal(outcome.status?.reason_code, "transition_next_role_not_reviewer");
  assert.equal(outcome.status?.state, "human_required");
  assert.equal(outcome.status?.verdict, null);
  assert.equal(outcome.status?.execution_id, null);
  assert.equal(outcome.status?.model_observed, null);
  assert.equal(outcome.status?.task_write_state, "rejected");
  assert.equal(outcome.exitCode, 1);
  assert.deepEqual(await fs.readFile(path.join(root, taskRel)), before);
  await fs.rm(root, { recursive: true, force: true });
});

test("a second plan review without resetting next_role is refused and leaves the first write intact", async () => {
  const { root, taskRel } = await writeRepo({ task: transitionTaskMd() });
  const first = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
  );
  assert.equal(first.status?.task_write_state, "written");
  const afterFirst = await fs.readFile(path.join(root, taskRel));
  const second = await runReview(
    { repo: root, task: taskRel },
    testDeps({
      source: constantSource(changesResult()),
      clock: testClock("run-66666666-6666-4666-8666-666666666666"),
    }),
  );
  assert.equal(second.status?.reason_code, "transition_next_role_not_reviewer");
  assert.deepEqual(await fs.readFile(path.join(root, taskRel)), afterFirst);
  const text = Buffer.from(afterFirst).toString("utf8");
  assertFrontmatterLine(text, "next_role", "next_role: implementer");
  assert.match(text, /^Verdict: APPROVED$/m);
  await fs.rm(root, { recursive: true, force: true });
});

test("source-text check rejects comment, quoting, and whitespace mutations on a non-allowlisted key", async () => {
  const { root, taskRel } = await writeRepo({ task: transitionTaskMd() });
  const before = await fs.readFile(path.join(root, taskRel), "utf8");
  const filename = path.basename(taskRel);
  const parsedBefore = parseTaskFrontmatter(new TextEncoder().encode(before), filename);
  const sourceOnlyMutations = [
    before.replace(`protocol: "1.0.0" # x-release-please-version`, `protocol: "1.0.0" # mutated`),
    before.replace(`protocol: "1.0.0" # x-release-please-version`, `protocol: 1.0.0 # x-release-please-version`),
    before.replace("id: bootstrap-fixture", "id:  bootstrap-fixture"),
  ];
  for (const mutated of sourceOnlyMutations) {
    const parsedMutated = parseTaskFrontmatter(new TextEncoder().encode(mutated), filename);
    assert.deepEqual(parsedMutated, parsedBefore);
  }
  const region = renderRegion(passResult(), sampleMeta());
  const composed = composeTaskArtifactWrite(before, region ?? "", {
    next_role: "implementer",
    updated_at: "2026-08-16",
  });
  assert.notEqual(composed, null);
  const validAfter = composed ?? "";
  assert.equal(preservedAuthorizedBytes(before, validAfter), true);
  const commentMutated = validAfter.replace(
    `protocol: "1.0.0" # x-release-please-version`,
    `protocol: "1.0.0" # mutated`,
  );
  const quotingMutated = validAfter.replace(
    `protocol: "1.0.0" # x-release-please-version`,
    `protocol: 1.0.0 # x-release-please-version`,
  );
  const whitespaceMutated = validAfter.replace("id: bootstrap-fixture", "id:  bootstrap-fixture");
  for (const mutated of [commentMutated, quotingMutated, whitespaceMutated]) {
    assert.equal(preservedAuthorizedBytes(before, mutated), false);
  }
  const taskAbs = path.join(root, taskRel);
  const original = new Uint8Array(await fs.readFile(taskAbs));
  const rejected = await commitTaskArtifactWrite({
    taskAbs,
    original,
    composed: commentMutated,
  });
  assert.equal(rejected.ok, false);
  assert.deepEqual(new Uint8Array(await fs.readFile(taskAbs)), original);
  await fs.rm(root, { recursive: true, force: true });
});

test("a failed check restores both the verdict region and next_role", async () => {
  const { root, taskRel } = await writeRepo({ task: transitionTaskMd() });
  const before = await fs.readFile(path.join(root, taskRel), "utf8");
  const region = renderRegion(passResult(), sampleMeta());
  const composed = composeTaskArtifactWrite(before, region ?? "", {
    next_role: "implementer",
    updated_at: "2026-08-16",
  });
  assert.notEqual(composed, null);
  assert.match(composed ?? "", /^Verdict: APPROVED$/m);
  assertFrontmatterLine(composed ?? "", "next_role", "next_role: implementer");
  const mutated = (composed ?? "").replace(
    `protocol: "1.0.0" # x-release-please-version`,
    `protocol: "1.0.0" # mutated`,
  );
  const taskAbs = path.join(root, taskRel);
  const original = new Uint8Array(await fs.readFile(taskAbs));
  const result = await commitTaskArtifactWrite({ taskAbs, original, composed: mutated });
  assert.equal(result.ok, false);
  const restored = await fs.readFile(taskAbs, "utf8");
  assert.equal(restored, before);
  assert.equal(restored.includes("Verdict: APPROVED"), false);
  assertFrontmatterLine(restored, "next_role", "next_role: reviewer");
  await fs.rm(root, { recursive: true, force: true });
});

test("parse failure after write restores the original file", async () => {
  const { root, taskRel } = await writeRepo({ task: transitionTaskMd() });
  const before = await fs.readFile(path.join(root, taskRel), "utf8");
  const region = renderRegion(passResult(), sampleMeta());
  const composed = composeTaskArtifactWrite(before, region ?? "", {
    next_role: "implementer",
    updated_at: "not-a-date",
  });
  const taskAbs = path.join(root, taskRel);
  const original = new Uint8Array(await fs.readFile(taskAbs));
  const result = await commitTaskArtifactWrite({ taskAbs, original, composed: composed ?? "" });
  assert.equal(result.ok, false);
  const restored = await fs.readFile(taskAbs, "utf8");
  assert.equal(restored, before);
  assert.equal(restored.includes("Verdict: APPROVED"), false);
  assertFrontmatterLine(restored, "next_role", "next_role: reviewer");
  await fs.rm(root, { recursive: true, force: true });
});

test("renderRegion returns null when the owned region exceeds the byte cap", () => {
  const region = renderRegion(
    {
      schema_version: 2,
      review_kind: "plan",
      verdict: "pass",
      summary: "ok",
      findings: [{ id: "F1", severity: "error", message: "x".repeat(REGION_BYTE_CAP) }],
    },
    {
      run_id: "run-1",
      execution_id: "exec-1",
      review_kind: "plan",
      verdict: "pass",
      reason_code: "review_passed",
      host: "cursor",
      launcher_id: "fake-reviewer-v1",
      model: "Composer-2.5",
      effort: "none",
      model_observed: "declared_unobserved",
      policy_digest: "sha256:abc",
      task_hash: "sha256:def",
      agents_hash: "sha256:ghi",
      timestamp: "2026-08-16T12:00:00.000Z",
    },
  );
  assert.equal(region, null);
});

function sampleMeta(overrides?: Partial<TaskWriteMeta>): TaskWriteMeta {
  return {
    run_id: "run-1",
    execution_id: "exec-1",
    review_kind: "plan",
    verdict: "pass",
    reason_code: "review_passed",
    host: "cursor",
    launcher_id: "fake-reviewer-v1",
    model: "Composer-2.5",
    effort: "none",
    model_observed: "declared_unobserved",
    policy_digest: "sha256:abc",
    task_hash: "sha256:def",
    agents_hash: "sha256:ghi",
    timestamp: "2026-08-16T12:00:00.000Z",
    ...overrides,
  };
}

function frontmatterKeyLine(text: string, key: string): string | undefined {
  const lines = text.split("\n");
  if ((lines[0] ?? "") !== "---") {
    return undefined;
  }
  const pattern = new RegExp(`^${key}[ \\t]*:`);
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line === "---") {
      break;
    }
    if (pattern.test(line)) {
      return line;
    }
  }
  return undefined;
}

function assertFrontmatterLine(text: string, key: string, expected: string | undefined): void {
  assert.equal(frontmatterKeyLine(text, key), expected, key);
}

function assertPreservedFrontmatterLines(before: string, after: string): void {
  for (const key of PRESERVED_FRONTMATTER_KEYS) {
    assert.equal(frontmatterKeyLine(after, key), frontmatterKeyLine(before, key), key);
  }
}

function assertAllTwelveFrontmatterLinesUnchanged(before: string, after: string): void {
  assertPreservedFrontmatterLines(before, after);
  assert.equal(frontmatterKeyLine(after, "next_role"), frontmatterKeyLine(before, "next_role"));
  assert.equal(frontmatterKeyLine(after, "updated_at"), frontmatterKeyLine(before, "updated_at"));
}

function nextHandoffSection(text: string): string {
  const heading = "## Next Handoff";
  const at = text.indexOf(heading);
  assert.notEqual(at, -1);
  return text.slice(at);
}

function outstandingEnvelope(id: string): string {
  return `## Next Handoff

\`\`\`text
Recommended execution (human decides):
- Host: Cursor
- Model and effort: Composer-2.5, none
- Role: reviewer
- Handoff: ${id}
- Invocation: /spartan
\`\`\`

\`\`\`text
Open \`spartan/tasks/0001-bootstrap-fixture.md\` (handoff ${id}).

Act as reviewer. Review the work without editing product files.
Run only read-only repository checks compatible with the reviewer sandbox.
Return a structured verdict and actionable findings.
\`\`\``;
}

function outstandingTaskMd(options?: {
  nextRole?: string;
  role?: string;
  phase?: string;
  taskType?: string;
  reviewBody?: string;
  handoffId?: string;
  nextHandoffId?: string;
  pending?: boolean;
  extrasAfterReview?: string;
}): string {
  const nextId = options?.nextHandoffId ?? "HX-002";
  const extras = options?.extrasAfterReview ?? `## Blockers

None.

## Next Action

Wait.

`;
  const intro = options?.pending
    ? `## Review

`
    : `## Review

Human notes stay below the Bridge region.

`;
  const pending = options?.pending ? TEMPLATE_PENDING_PLACEHOLDER : "";
  const reviewBody = options?.reviewBody ?? `${intro}${pending}${extras}${outstandingEnvelope(nextId)}`;
  return validTaskMd({
    protocol: "1.0.0",
    nextRole: options?.nextRole ?? "reviewer",
    role: options?.role,
    phase: options?.phase,
    taskType: options?.taskType,
    reviewSection: `\n${reviewBody}`,
  })
    .replace(`protocol: "1.0.0"`, `protocol: "1.0.0" # x-release-please-version`)
    .replace("updated_at: 2026-08-16", "updated_at: 2020-01-01")
    .replace("handoff_id: none", `handoff_id: ${options?.handoffId ?? "HX-001"}`)
    .replace("next_handoff_id: none", `next_handoff_id: ${nextId}`);
}

function sliceThrough(text: string, startToken: string, endToken: string): string {
  const start = text.indexOf(startToken);
  const end = text.indexOf(endToken, start);
  assert.notEqual(start, -1, startToken);
  assert.notEqual(end, -1, endToken);
  return text.slice(start, end + endToken.length);
}

test("accepted plan and implementation verdicts compose D2-D4 only when those before-shapes exist", async () => {
  const outstandingPlan = outstandingTaskMd({ pending: true });
  const planRepo = await writeRepo({ task: outstandingPlan });
  const beforePlan = await fs.readFile(path.join(planRepo.root, planRepo.taskRel), "utf8");
  const planOutcome = await runReview(
    { repo: planRepo.root, task: planRepo.taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
  );
  assert.equal(planOutcome.status?.task_write_state, "written");
  const afterPlan = await fs.readFile(path.join(planRepo.root, planRepo.taskRel), "utf8");
  assertFrontmatterLine(afterPlan, "next_role", "next_role: implementer");
  assertFrontmatterLine(afterPlan, "handoff_id", "handoff_id: HX-002");
  assertFrontmatterLine(afterPlan, "next_handoff_id", "next_handoff_id: none");
  assertFrontmatterLine(afterPlan, "current_role", frontmatterKeyLine(beforePlan, "current_role"));
  assert.equal(frontmatterKeyLine(beforePlan, "protocol"), frontmatterKeyLine(afterPlan, "protocol"));
  assert.equal(nextHandoffSection(afterPlan), RETRACTED_NEXT_HANDOFF_SECTION);
  assert.equal(nextHandoffSection(afterPlan).includes("HX-"), false);
  assert.equal(afterPlan.includes(TEMPLATE_PENDING_TOKEN_LINE()), false);
  assert.equal(beforePlan.includes(`${TEMPLATE_PENDING_PLACEHOLDER}## Blockers`), true);
  assert.equal(sliceThrough(afterPlan, REVIEW_PLAN_END, "## Blockers"), `${REVIEW_PLAN_END}\n\n## Blockers`);
  assert.equal(preservedAuthorizedBytes(beforePlan, afterPlan), true);
  await fs.rm(planRepo.root, { recursive: true, force: true });

  const changesOutstanding = outstandingTaskMd();
  const changesRepo = await writeRepo({ task: changesOutstanding });
  const beforeChanges = await fs.readFile(path.join(changesRepo.root, changesRepo.taskRel), "utf8");
  const changesOutcome = await runReview(
    { repo: changesRepo.root, task: changesRepo.taskRel },
    testDeps({ source: constantSource(changesResult()), clock: testClock(RUN_ID) }),
  );
  assert.equal(changesOutcome.status?.task_write_state, "written");
  const afterChanges = await fs.readFile(path.join(changesRepo.root, changesRepo.taskRel), "utf8");
  assertFrontmatterLine(afterChanges, "next_role", "next_role: planner");
  assertFrontmatterLine(afterChanges, "handoff_id", "handoff_id: HX-002");
  assertFrontmatterLine(afterChanges, "next_handoff_id", "next_handoff_id: none");
  assert.equal(nextHandoffSection(afterChanges), RETRACTED_NEXT_HANDOFF_SECTION);
  assert.equal(afterChanges.includes("Human notes stay below the Bridge region."), true);
  assert.equal(preservedAuthorizedBytes(beforeChanges, afterChanges), true);
  await fs.rm(changesRepo.root, { recursive: true, force: true });

  const implPassTask = outstandingTaskMd({
    role: "implementer",
    phase: "reviewing",
    taskType: "implementation",
    pending: true,
  });
  const implPassRepo = await writeRepo({
    task: implPassTask,
    agents: implWriteAgents(),
  });
  const beforeImplPass = await fs.readFile(path.join(implPassRepo.root, implPassRepo.taskRel), "utf8");
  const implPass = await writeTaskReviewRegion({
    taskAbs: path.join(implPassRepo.root, implPassRepo.taskRel),
    expectedHash: sha256Bytes(new TextEncoder().encode(beforeImplPass)),
    result: passResult("implementation"),
    meta: sampleMeta({ review_kind: "implementation", verdict: "pass" }),
  });
  assert.equal(implPass.ok, true);
  const afterImplPass = await fs.readFile(path.join(implPassRepo.root, implPassRepo.taskRel), "utf8");
  assertFrontmatterLine(afterImplPass, "next_role", "next_role: human-operator");
  assertFrontmatterLine(afterImplPass, "handoff_id", "handoff_id: HX-002");
  assertFrontmatterLine(afterImplPass, "next_handoff_id", "next_handoff_id: none");
  assert.equal(afterImplPass.includes(REVIEW_IMPLEMENTATION_BEGIN), true);
  assert.equal(nextHandoffSection(afterImplPass), RETRACTED_NEXT_HANDOFF_SECTION);
  assert.equal(afterImplPass.includes("Verdict: PENDING"), false);
  assert.equal(preservedAuthorizedBytes(beforeImplPass, afterImplPass), true);
  await fs.rm(implPassRepo.root, { recursive: true, force: true });

  const implChangesTask = outstandingTaskMd({
    role: "implementer",
    phase: "reviewing",
    taskType: "implementation",
  });
  const implChangesRepo = await writeRepo({
    task: implChangesTask,
    agents: implWriteAgents(),
  });
  const beforeImplChanges = await fs.readFile(path.join(implChangesRepo.root, implChangesRepo.taskRel), "utf8");
  const implChanges = await writeTaskReviewRegion({
    taskAbs: path.join(implChangesRepo.root, implChangesRepo.taskRel),
    expectedHash: sha256Bytes(new TextEncoder().encode(beforeImplChanges)),
    result: changesResult("implementation"),
    meta: sampleMeta({ review_kind: "implementation", verdict: "changes_requested" }),
  });
  assert.equal(implChanges.ok, true);
  const afterImplChanges = await fs.readFile(path.join(implChangesRepo.root, implChangesRepo.taskRel), "utf8");
  assertFrontmatterLine(afterImplChanges, "next_role", "next_role: implementer");
  assert.equal(nextHandoffSection(afterImplChanges), RETRACTED_NEXT_HANDOFF_SECTION);
  await fs.rm(implChangesRepo.root, { recursive: true, force: true });
});

function TEMPLATE_PENDING_TOKEN_LINE(): string {
  return "Verdict: PENDING";
}

function implWriteAgents(): string {
  return validAgentsMd({ taskWrite: true, implementationGrant: true });
}

test("none-path identifiers and handoff section stay byte-identical", async () => {
  const before = transitionTaskMd();
  const region = renderRegion(passResult(), sampleMeta()) ?? "";
  const composed = composeTaskArtifactWrite(before, region, {
    next_role: "implementer",
    updated_at: "2026-08-16",
  });
  assert.notEqual(composed, null);
  const after = composed ?? "";
  assertFrontmatterLine(after, "handoff_id", "handoff_id: none");
  assertFrontmatterLine(after, "next_handoff_id", "next_handoff_id: none");
  assert.equal(frontmatterKeyLine(after, "handoff_id"), frontmatterKeyLine(before, "handoff_id"));
  assert.equal(frontmatterKeyLine(after, "next_handoff_id"), frontmatterKeyLine(before, "next_handoff_id"));
  assert.equal(nextHandoffSection(after), nextHandoffSection(before));
  assert.equal(preservedAuthorizedBytes(before, after), true);
});

test("D2 moves HX-001/HX-002 exactly and preserves key positions", () => {
  const before = outstandingTaskMd();
  const region = renderRegion(passResult(), sampleMeta()) ?? "";
  const composed = composeTaskArtifactWrite(before, region, {
    next_role: "implementer",
    updated_at: "2026-08-16",
  });
  assert.notEqual(composed, null);
  const after = composed ?? "";
  assertFrontmatterLine(after, "handoff_id", "handoff_id: HX-002");
  assertFrontmatterLine(after, "next_handoff_id", "next_handoff_id: none");
  const beforeKeys = frontmatterKeys(before);
  const afterKeys = frontmatterKeys(after);
  assert.deepEqual(afterKeys, beforeKeys);
  assert.equal(frontmatterKeyLine(after, "protocol"), frontmatterKeyLine(before, "protocol"));
  assert.match(frontmatterKeyLine(after, "protocol") ?? "", /# x-release-please-version/);
});

test("D3 refuses every closed-shape deviation and restores original bytes", async () => {
  const valid = outstandingTaskMd();
  const region = renderRegion(passResult(), sampleMeta()) ?? "";
  const mutations = [
    valid.replace("## Next Handoff\n", ""),
    `${valid}\n## Next Handoff\n`,
    valid.replace(
      outstandingEnvelope("HX-002"),
      `## Next Handoff

extra prose

${outstandingEnvelope("HX-002").slice("## Next Handoff\n\n".length)}`,
    ),
    valid.replace("```text\nRecommended", "````text\nRecommended"),
    valid.replace("```text\nRecommended", "```json\nRecommended"),
    valid.replace("- Handoff: HX-002\n", "- Handoff: HX-002 \n"),
    valid.replace("(handoff HX-002)", "(handoff HX-002) (handoff HX-002)"),
    valid.replace("- Handoff: HX-002", "- Handoff: HX-003"),
    valid.replace("Act as reviewer.", "Act as reviewer. Also see HX-009."),
    valid.replace("```text\nRecommended execution", "```text\n```\nRecommended execution"),
    valid.replace("```\n\n```text\nOpen", "```\n\n\n```text\nOpen"),
  ];
  for (const mutated of mutations) {
    const composed = composeTaskArtifactWrite(mutated, region, {
      next_role: "implementer",
      updated_at: "2026-08-16",
    });
    assert.equal(composed, null, mutated.slice(0, 80));
  }

  // 0061 D3 revised: blank-only variation after the closing fence (extra blank
  // line, or none) is tolerated — the section is fully replaced on retract.
  for (const tolerated of [`${valid}\n`, valid.replace(/\n$/, "")]) {
    assert.notEqual(
      composeTaskArtifactWrite(tolerated, region, { next_role: "implementer", updated_at: "2026-08-16" }),
      null,
      tolerated.slice(-40),
    );
  }

  const { root, taskRel } = await writeRepo({ task: valid.replace("- Handoff: HX-002", "- Handoff: HX-003") });
  const taskAbs = path.join(root, taskRel);
  const original = new Uint8Array(await fs.readFile(taskAbs));
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
  );
  assert.equal(outcome.status?.reason_code, "task_artifact_write_rejected");
  assert.deepEqual(new Uint8Array(await fs.readFile(taskAbs)), original);
  await fs.rm(root, { recursive: true, force: true });
});

test("preservedAuthorizedBytes rejects a handoff section that is neither identical nor D3 after-image", () => {
  const before = outstandingTaskMd();
  const region = renderRegion(passResult(), sampleMeta()) ?? "";
  const composed = composeTaskArtifactWrite(before, region, {
    next_role: "implementer",
    updated_at: "2026-08-16",
  });
  assert.notEqual(composed, null);
  const after = composed ?? "";
  assert.equal(preservedAuthorizedBytes(before, after), true);
  const mutatedNotice = after.replace(
    "No outstanding handoff. The proposed review was consumed.",
    "No outstanding handoff.",
  );
  assert.equal(preservedAuthorizedBytes(before, mutatedNotice), false);
  const mutatedKeepEnvelope = after.replace(RETRACTED_NEXT_HANDOFF_SECTION, nextHandoffSection(before));
  assert.equal(preservedAuthorizedBytes(before, mutatedKeepEnvelope), false);
});

test("D4 pins the M/H source transform and refuses unowned PENDING shapes", async () => {
  const planBlock = `${REVIEW_PLAN_BEGIN}\nVerdict: APPROVED\n\nFindings:\n\n- None recorded.\n\nBridge run: leftover\n${REVIEW_PLAN_END}\n`;
  const exact = outstandingTaskMd({
    reviewBody: `## Review

${planBlock}
${TEMPLATE_PENDING_PLACEHOLDER}## Blockers

None.

## Next Action

Wait.

${outstandingEnvelope("HX-002")}`,
  });
  const before = exact;
  assert.equal(
    sliceThrough(before, REVIEW_PLAN_END, "## Blockers"),
    `${REVIEW_PLAN_END}\n\n${TEMPLATE_PENDING_PLACEHOLDER}## Blockers`,
  );
  const region = renderRegion(changesResult(), sampleMeta()) ?? "";
  const composed = composeTaskArtifactWrite(before, region, {
    next_role: "planner",
    updated_at: "2026-08-16",
  });
  assert.notEqual(composed, null);
  const after = composed ?? "";
  assert.equal(sliceThrough(after, REVIEW_PLAN_END, "## Blockers"), `${REVIEW_PLAN_END}\n\n## Blockers`);
  assert.equal(after.includes("Verdict: PENDING"), false);
  assert.equal(TEMPLATE_PENDING_PLACEHOLDER.endsWith("\n\n"), true);
  assert.equal(preservedAuthorizedBytes(before, after), true);

  const absentLater = composeTaskArtifactWrite(after, renderRegion(passResult(), sampleMeta()) ?? "", {
    next_role: "implementer",
    updated_at: "2026-08-16",
  });
  assert.notEqual(absentLater, null);
  assert.equal((absentLater ?? "").includes("Verdict: PENDING"), false);

  const resetRole = after.replace(/^next_role: planner$/m, "next_role: reviewer");
  const second = composeTaskArtifactWrite(resetRole, renderRegion(passResult(), sampleMeta()) ?? "", {
    next_role: "implementer",
    updated_at: "2026-08-16",
  });
  assert.notEqual(second, null);
  assert.equal((second ?? "").includes("Verdict: PENDING"), false);

  const refusals = [
    outstandingTaskMd({
      reviewBody: `## Review

Verdict: PENDING

Findings:

- None recorded.

${planBlock}## Blockers

${outstandingEnvelope("HX-002")}`,
    }),
    outstandingTaskMd({
      reviewBody: `## Review

${planBlock}Notes beside the placeholder.

${TEMPLATE_PENDING_PLACEHOLDER}## Blockers

${outstandingEnvelope("HX-002")}`,
    }),
    outstandingTaskMd({
      reviewBody: `## Review

${planBlock}Verdict: PENDING

Findings:

- None recorded.
## Blockers

${outstandingEnvelope("HX-002")}`,
    }),
    outstandingTaskMd({
      reviewBody: `## Review

${planBlock}
${TEMPLATE_PENDING_PLACEHOLDER}${TEMPLATE_PENDING_PLACEHOLDER}## Blockers

${outstandingEnvelope("HX-002")}`,
    }),
  ];
  for (const mutated of refusals) {
    assert.equal(
      composeTaskArtifactWrite(mutated, region, { next_role: "planner", updated_at: "2026-08-16" }),
      null,
    );
  }

  const { root, taskRel } = await writeRepo({ task: refusals[0] ?? exact });
  const original = new Uint8Array(await fs.readFile(path.join(root, taskRel)));
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
  );
  assert.equal(outcome.status?.reason_code, "task_artifact_write_rejected");
  assert.deepEqual(new Uint8Array(await fs.readFile(path.join(root, taskRel))), original);
  await fs.rm(root, { recursive: true, force: true });
});

test("D4 removes the exact Review placeholder and preserves a PENDING literal outside Review", () => {
  const outsideLiteral = "The decision quotes Verdict: PENDING as the template token.";
  const planBlock = `${REVIEW_PLAN_BEGIN}\nVerdict: APPROVED\n\nFindings:\n\n- None recorded.\n\nBridge run: leftover\n${REVIEW_PLAN_END}\n`;
  const before = outstandingTaskMd({
    role: "implementer",
    phase: "reviewing",
    taskType: "implementation",
    reviewBody: `## Review

${planBlock}
${TEMPLATE_PENDING_PLACEHOLDER}## Blockers

None.

## Next Action

Wait.

${outstandingEnvelope("HX-002")}`,
  }).replace("Body is opaque.", outsideLiteral);
  assert.equal(before.includes(`${TEMPLATE_PENDING_PLACEHOLDER}## Blockers`), true);
  assert.equal(before.slice(before.indexOf("# Fixture task"), before.indexOf("## Review")).includes(outsideLiteral), true);
  const region =
    renderRegion(passResult("implementation"), sampleMeta({ review_kind: "implementation", verdict: "pass" })) ?? "";
  const composed = composeTaskArtifactWrite(before, region, {
    next_role: "human-operator",
    updated_at: "2026-08-16",
  });
  assert.notEqual(composed, null);
  const after = composed ?? "";
  assert.equal(after.includes(REVIEW_IMPLEMENTATION_BEGIN), true);
  assert.equal(sliceThrough(after, REVIEW_IMPLEMENTATION_END, "## Blockers"), `${REVIEW_IMPLEMENTATION_END}\n\n## Blockers`);
  assert.equal(
    sliceThrough(after, REVIEW_PLAN_BEGIN, REVIEW_PLAN_END),
    sliceThrough(before, REVIEW_PLAN_BEGIN, REVIEW_PLAN_END),
  );
  const beforeOutsideReview = before.slice(before.indexOf("# Fixture task"), before.indexOf("## Review"));
  const afterOutsideReview = after.slice(after.indexOf("# Fixture task"), after.indexOf("## Review"));
  assert.equal(afterOutsideReview, beforeOutsideReview);
  assert.equal(afterOutsideReview.includes(outsideLiteral), true);
  assert.equal(preservedAuthorizedBytes(before, after), true);
});

test("D5 mutations of protected domains fail preservation; restore leaves no half-cleared proposal", async () => {
  const planBlock = `${REVIEW_PLAN_BEGIN}\nVerdict: APPROVED\n\nFindings:\n\n- None recorded.\n\nBridge run: leftover\n${REVIEW_PLAN_END}\n`;
  const before = outstandingTaskMd({
    role: "implementer",
    phase: "reviewing",
    taskType: "implementation",
    reviewBody: `## Review

Above the first region.

${planBlock}Between the regions.

Below the last.

## Blockers

None.

## Next Action

Wait.

${outstandingEnvelope("HX-002")}`,
  });
  const region = renderRegion(changesResult("implementation"), sampleMeta({ review_kind: "implementation" })) ?? "";
  const composed = composeTaskArtifactWrite(before, region, {
    next_role: "implementer",
    updated_at: "2026-08-16",
  });
  assert.notEqual(composed, null);
  const after = composed ?? "";
  assert.equal(preservedAuthorizedBytes(before, after), true);
  assert.equal(after.includes(REVIEW_PLAN_BEGIN), true);
  const planBefore = sliceThrough(before, REVIEW_PLAN_BEGIN, REVIEW_PLAN_END);
  const planAfter = sliceThrough(after, REVIEW_PLAN_BEGIN, REVIEW_PLAN_END);
  assert.equal(planAfter, planBefore);

  const mutations = [
    after.replace("Above the first region.", "Above the first region mutated."),
    after.replace("Between the regions.", "Between the regions mutated."),
    after.replace("Below the last.", "Below the last mutated."),
    after.replace("## Next Action\n\nWait.", "## Next Action\n\nWait mutated."),
    after.replace("## Blockers\n\nNone.", "## Blockers\n\nMutated."),
    after.replace(`protocol: "1.0.0" # x-release-please-version`, `protocol: "1.0.0" # mutated`),
    swapFrontmatterKeys(after, "current_role", "status"),
    after.replace(planBefore, planBefore.replace("Verdict: APPROVED", "Verdict: CHANGES_REQUESTED")),
  ];
  for (const mutated of mutations) {
    assert.equal(preservedAuthorizedBytes(before, mutated), false);
  }

  const halfCleared = after.replace("next_handoff_id: none", "next_handoff_id: HX-002");
  assert.equal(preservedAuthorizedBytes(before, halfCleared), false);
  const halfId = after.replace("handoff_id: HX-002", "handoff_id: HX-001");
  assert.equal(preservedAuthorizedBytes(before, halfId), false);

  const { root, taskRel } = await writeRepo({
    task: before,
    agents: implWriteAgents(),
  });
  const taskAbs = path.join(root, taskRel);
  const original = new Uint8Array(await fs.readFile(taskAbs));
  const rejected = await commitTaskArtifactWrite({
    taskAbs,
    original,
    composed: after.replace(`protocol: "1.0.0" # x-release-please-version`, `protocol: "1.0.0" # mutated`),
  });
  assert.equal(rejected.ok, false);
  const restored = await fs.readFile(taskAbs, "utf8");
  assert.equal(restored, before);
  assertFrontmatterLine(restored, "handoff_id", "handoff_id: HX-001");
  assertFrontmatterLine(restored, "next_handoff_id", "next_handoff_id: HX-002");
  assert.equal(nextHandoffSection(restored).includes("```text"), true);
  await fs.rm(root, { recursive: true, force: true });
});

test("implementation human_required and blocked still write no task bytes", async () => {
  for (const [source, reason] of [
    [constantSource({ ...PRODUCTION_FAKE_RESULT, review_kind: "implementation" }), "review_human_required"],
    [constantSource(blockedResult("implementation")), "review_blocked"],
  ] as const) {
    const repo = await makeRepo({
      agents: implWriteAgents(),
      task: implementationTaskMd({ reviewSection: `\n${DEFAULT_REVIEW_SECTION}` }),
    });
    const before = await snapshotFiles(repo.root, [repo.taskRel, repo.productRel, "AGENTS.md"]);
    const beforeText = await fs.readFile(path.join(repo.root, repo.taskRel), "utf8");
    const outcome = await runReview(
      { repo: repo.root, task: repo.taskRel },
      testDeps({ source, clock: testClock(RUN_ID) }),
    );
    assert.equal(outcome.status?.reason_code, reason);
    assert.equal(outcome.status?.task_write_state, "skipped_human_gate");
    const after = await snapshotFiles(repo.root, [repo.taskRel, repo.productRel, "AGENTS.md"]);
    assert.deepEqual(after, before);
    const afterText = await fs.readFile(path.join(repo.root, repo.taskRel), "utf8");
    assertAllTwelveFrontmatterLinesUnchanged(beforeText, afterText);
    const { events } = await loadRun(repo.root, RUN_ID);
    assert.equal(events.some((event) => event.type === "task_artifact_written"), false);
    await fs.rm(repo.root, { recursive: true, force: true });
  }
});

function frontmatterKeys(text: string): string[] {
  const lines = text.split("\n");
  const keys: string[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line === "---") {
      break;
    }
    const key = /^([A-Za-z0-9_]+)[ \t]*:/.exec(line)?.[1];
    if (key !== undefined) {
      keys.push(key);
    }
  }
  return keys;
}

function swapFrontmatterKeys(text: string, left: string, right: string): string {
  const leftLine = frontmatterKeyLine(text, left);
  const rightLine = frontmatterKeyLine(text, right);
  if (leftLine === undefined || rightLine === undefined) {
    return text;
  }
  return text.replace(leftLine, "\0").replace(rightLine, leftLine).replace("\0", rightLine);
}

// ---------------------------------------------------------------------------
// Task 0046: D1/D2 pre-dispatch shape gate, D3 named causes, D4 retained verdict
// ---------------------------------------------------------------------------

const WELL_FORMED_NEXT_HANDOFF = `## Next Handoff

\`\`\`text
Recommended execution (human decides):
- Role: reviewer
- Handoff: HX-001
\`\`\`

\`\`\`text
Open \`spartan/tasks/0001-bootstrap-fixture.md\`. (handoff HX-001)

Act as reviewer.
\`\`\``;

const UNFENCED_ADVISORY_NEXT_HANDOFF = `## Next Handoff

Recommended execution (human decides):
- Role: reviewer
- Handoff: HX-001

\`\`\`text
Open \`spartan/tasks/0001-bootstrap-fixture.md\`. (handoff HX-001)

Act as reviewer.
\`\`\``;

function taskWithOutstandingHandoff(handoffSection: string, review = `\n${DEFAULT_REVIEW_SECTION}`): string {
  return `${validTaskMd({ nextHandoffId: "HX-001", reviewSection: `${review}\n${handoffSection}` })}`;
}

test("D2: checkArtifactWriteShape accepts a well-formed artifact and composeTaskArtifactWrite then succeeds", () => {
  const text = taskWithOutstandingHandoff(WELL_FORMED_NEXT_HANDOFF);
  assert.deepEqual(checkArtifactWriteShape(text, "plan"), { ok: true });
  const region = renderRegion(passResult(), sampleMeta());
  assert.ok(region);
  const composed = composeTaskArtifactWrite(text, region!, { next_role: "implementer", updated_at: "2026-08-30" });
  assert.notEqual(composed, null);
});

test("D2: a shape checkArtifactWriteShape rejects, composeTaskArtifactWrite also rejects (no divergence)", () => {
  const region = renderRegion(passResult(), sampleMeta());
  assert.ok(region);
  for (const [text, detail] of [
    [taskWithOutstandingHandoff(UNFENCED_ADVISORY_NEXT_HANDOFF), "next_handoff_not_retractable"],
    [
      `${validTaskMd({ reviewSection: `\n## Review\n\nVerdict: PENDING\n\nFindings:\n\nThe reviewer records the outcome here with a full paragraph of template guidance prose.\n` })}`,
      "review_placeholder_not_canonical",
    ],
    [validTaskMd(), "review_section_unrecognized"],
  ] as const) {
    const shape = checkArtifactWriteShape(text, "plan");
    assert.equal(shape.ok, false, text);
    assert.equal(shape.cause, "composition_failed", text);
    assert.equal(shape.detail, detail, text);
    assert.equal(composeTaskArtifactWrite(text, region!, { next_role: "implementer", updated_at: "2026-08-30" }), null, text);
  }
});

test("0061 D2/D3: describeNextHandoffRejection names each distinct Next Handoff sub-rule", () => {
  const cases: Array<[NextHandoffRejectSlug, string]> = [
    ["section_absent", ""],
    ["opening_shape", WELL_FORMED_NEXT_HANDOFF.replace("## Next Handoff\n\n```text", "## Next Handoff\n```text")],
    ["advisory_fence_nested", WELL_FORMED_NEXT_HANDOFF.replace("- Handoff: HX-001\n```", "- Handoff: HX-001\n```text\n```")],
    ["advisory_fence_unclosed", "## Next Handoff\n\n```text\nRecommended execution (human decides):\n- Role: reviewer\n- Handoff: HX-001\n"],
    ["prompt_block_missing", WELL_FORMED_NEXT_HANDOFF.replace(/\n\n```text\nOpen[\s\S]*$/, "")],
    ["prompt_fence_nested", WELL_FORMED_NEXT_HANDOFF.replace("Act as reviewer.\n```", "Act as reviewer.\n```text\n```")],
    ["prompt_fence_unclosed", `${WELL_FORMED_NEXT_HANDOFF.slice(0, -4)}\n`],
    ["trailing_content", `${WELL_FORMED_NEXT_HANDOFF}\n\nstray prose after the fence`],
    ["advisory_handoff_line", WELL_FORMED_NEXT_HANDOFF.replace("- Handoff: HX-001\n", "")],
    ["prompt_handoff_mark", WELL_FORMED_NEXT_HANDOFF.replace(" (handoff HX-001)", "")],
    ["stray_identifier", WELL_FORMED_NEXT_HANDOFF.replace("Act as reviewer.", "Act as reviewer. See HX-777.")],
  ];
  for (const [slug, section] of cases) {
    const text = taskWithOutstandingHandoff(section);
    assert.equal(describeNextHandoffRejection(text, "plan"), slug, slug);
  }
  assert.equal(describeNextHandoffRejection(taskWithOutstandingHandoff(WELL_FORMED_NEXT_HANDOFF), "plan"), null);
});

test("0061 D3 revised: one or more blank lines after the closing fence are tolerated", () => {
  for (const suffix of ["\n", "\n\n", "\n\n\n"]) {
    const text = taskWithOutstandingHandoff(`${WELL_FORMED_NEXT_HANDOFF}${suffix}`);
    assert.equal(describeNextHandoffRejection(text, "plan"), null, JSON.stringify(suffix));
    assert.deepEqual(checkArtifactWriteShape(text, "plan"), { ok: true }, JSON.stringify(suffix));
  }
});

test("D1/D3: the board 0022 unfenced-advisory artifact is refused before the adapter, cause composition_failed", async () => {
  const { root, taskRel } = await writeRepo({ task: taskWithOutstandingHandoff(UNFENCED_ADVISORY_NEXT_HANDOFF) });
  const before = await fs.readFile(path.join(root, taskRel));
  const resolved: string[] = [];
  const inner = testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) });
  const outcome = await runReview(
    { repo: root, task: taskRel },
    { ...inner, catalog: { resolve: (id: string) => (resolved.push(id), inner.catalog.resolve(id)) } },
  );
  assert.equal(outcome.status?.reason_code, "task_artifact_write_rejected");
  assert.equal(outcome.status?.state, "human_required");
  assert.equal(outcome.status?.task_write_state, null);
  assert.equal(outcome.status?.task_write_rejection_cause, "composition_failed");
  assert.equal(outcome.status?.verdict, null);
  assert.equal(outcome.status?.execution_id, null);
  assert.deepEqual(resolved, []);
  assert.equal(await fileExists(path.join(root, ".spartan-bridge", "runs", RUN_ID, "reviews")), false);
  assert.deepEqual(await fs.readFile(path.join(root, taskRel)), before);
  const { events } = await loadRun(root, RUN_ID);
  const terminal = events.find((event) => event.type === "run_terminal");
  assert.equal(terminal?.task_write_rejection_cause, "composition_failed");
  await fs.rm(root, { recursive: true, force: true });
});

test("D3/D4: a forbidden-token verdict is rejected post-dispatch with a named cause and a retained verdict file", async () => {
  const forbidden = {
    schema_version: 2 as const,
    review_kind: "plan" as const,
    verdict: "pass" as const,
    summary: "contains <!-- token",
    findings: [],
  };
  const { root, taskRel } = await writeRepo();
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(forbidden), clock: testClock(RUN_ID) }),
  );
  assert.equal(outcome.status?.reason_code, "task_artifact_write_rejected");
  assert.equal(outcome.status?.task_write_state, "rejected");
  assert.equal(outcome.status?.task_write_rejection_cause, "review_region_unrenderable");
  assert.equal(outcome.status?.review_verdict_log, "review-verdict.json");
  const verdictPath = path.join(root, ".spartan-bridge", "runs", RUN_ID, "review-verdict.json");
  assert.equal(await fileExists(verdictPath), true);
  const contents = await fs.readFile(verdictPath, "utf8");
  const parsed = JSON.parse(contents) as { verdict: string };
  assert.equal(parsed.verdict, "pass");
  const { redactAdapterStderrText } = await import("../src/policy/redact.ts");
  assert.equal(redactAdapterStderrText(contents), contents);
  await fs.rm(root, { recursive: true, force: true });
});

test("D1: each CompositionFailedDetail is distinct and maps to COMPOSITION_FAILED_HINTS", () => {
  const identifiersShape = checkArtifactWriteShape(validTaskMd({ nextHandoffId: "HX-000" }), "plan");
  assert.equal(identifiersShape.ok, false);
  if (!identifiersShape.ok) {
    assert.equal(identifiersShape.detail, "frontmatter_identifiers_unreadable");
  }
  const badReviewShape = checkArtifactWriteShape(validTaskMd(), "plan");
  assert.equal(badReviewShape.ok, false);
  if (!badReviewShape.ok) {
    assert.equal(badReviewShape.detail, "review_section_unrecognized");
  }
  const badPlaceholderShape = checkArtifactWriteShape(
    validTaskMd({
      reviewSection: `\n## Review\n\nVerdict: PENDING\n\nFindings:\n\n- None recorded.\nExtra prose.\n`,
    }),
    "plan",
  );
  assert.equal(badPlaceholderShape.ok, false);
  if (!badPlaceholderShape.ok) {
    assert.equal(badPlaceholderShape.detail, "review_placeholder_not_canonical");
  }
  const badHandoffShape = checkArtifactWriteShape(taskWithOutstandingHandoff(UNFENCED_ADVISORY_NEXT_HANDOFF), "plan");
  assert.equal(badHandoffShape.ok, false);
  if (!badHandoffShape.ok) {
    assert.equal(badHandoffShape.detail, "next_handoff_not_retractable");
  }
  for (const detail of [
    "frontmatter_identifiers_unreadable",
    "review_section_unrecognized",
    "review_placeholder_not_canonical",
    "next_handoff_not_retractable",
  ] as const) {
    assert.equal(typeof COMPOSITION_FAILED_HINTS[detail], "string");
    assert.ok(COMPOSITION_FAILED_HINTS[detail].length > 0);
  }
});

test("D2/D3: pre_dispatch_diagnostic is set for task_invalid and composition_failed refusals", async () => {
  const invalidRepo = await makeRepo({
    task: validTaskMd({ taskType: "planning", phase: "reviewing", role: "planner", nextRole: "reviewer" }),
  });
  const invalidOutcome = await runReview(
    { repo: invalidRepo.root, task: invalidRepo.taskRel },
    testDeps({ clock: testClock(RUN_ID) }),
  );
  assert.equal(invalidOutcome.status?.reason_code, "task_invalid");
  assert.match(invalidOutcome.status?.pre_dispatch_diagnostic ?? "", /phase 'reviewing' requires task_type 'implementation'/);
  assert.equal(invalidOutcome.status?.adapter_failure, null);

  const compositionRepo = await writeRepo({
    task: validTaskMd({
      reviewSection: `\n## Review\n\nVerdict: PENDING\n\nFindings:\n\n- None recorded.\nExtra prose.\n`,
    }),
  });
  const compositionOutcome = await runReview(
    { repo: compositionRepo.root, task: compositionRepo.taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
  );
  assert.equal(compositionOutcome.status?.reason_code, "task_artifact_write_rejected");
  assert.equal(compositionOutcome.status?.task_write_rejection_cause, "composition_failed");
  assert.equal(
    compositionOutcome.status?.pre_dispatch_diagnostic,
    COMPOSITION_FAILED_HINTS.review_placeholder_not_canonical,
  );
  assert.equal(compositionOutcome.status?.execution_id, null);

  const passRepo = await makeRepo();
  const passOutcome = await runReview(
    { repo: passRepo.root, task: passRepo.taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
  );
  assert.equal(passOutcome.status?.pre_dispatch_diagnostic, null);

  await fs.rm(invalidRepo.root, { recursive: true, force: true });
  await fs.rm(compositionRepo.root, { recursive: true, force: true });
  await fs.rm(passRepo.root, { recursive: true, force: true });
});

test("0061 D2: a next_handoff_not_retractable refusal names the failing sub-rule in the diagnostic", async () => {
  const repo = await writeRepo({ task: taskWithOutstandingHandoff(UNFENCED_ADVISORY_NEXT_HANDOFF) });
  const outcome = await runReview(
    { repo: repo.root, task: repo.taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
  );
  assert.equal(outcome.status?.task_write_rejection_cause, "composition_failed");
  assert.match(outcome.status?.pre_dispatch_diagnostic ?? "", /\[opening_shape\]/);
  await fs.rm(repo.root, { recursive: true, force: true });
});

test("checkTerminalCloseShape admits completion-notice rewrite and handoff retraction", () => {
  const artifact = outstandingTaskMd({
    nextRole: "reviewer",
    role: "implementer",
    phase: "reviewing",
    taskType: "implementation",
  });
  assert.equal(checkTerminalCloseShape(artifact).ok, true);
  const notice = renderCompletionNotice(TERMINAL_CLOSE_PROBE_RUN_ID);
  assert.notEqual(notice, null);
  const composed = composeTerminalCloseOut(artifact, TERMINAL_CLOSE_PROBE_RUN_ID, "2026-09-02");
  assert.notEqual(composed, null);
  assert.match(composed ?? "", /Auto-chain complete: implementation review passed/);
  assert.match(composed ?? "", /status: active/);
  assert.match(composed ?? "", /phase: complete/);
  assert.match(composed ?? "", /current_role: human-operator/);
  assert.equal((composed ?? "").includes("## Next Handoff"), true);
});

test("ordinary review dispatch cannot change status, phase, or current_role", async () => {
  const repo = await writeRepo({ task: outstandingTaskMd({ nextRole: "reviewer" }) });
  const before = await fs.readFile(path.join(repo.root, repo.taskRel), "utf8");
  const outcome = await runReview(
    { repo: repo.root, task: repo.taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
  );
  assert.equal(outcome.status?.task_write_state, "written");
  const after = await fs.readFile(path.join(repo.root, repo.taskRel), "utf8");
  for (const key of ["status", "phase", "current_role"] as const) {
    const beforeLine = before.split("\n").find((line) => line.startsWith(`${key}:`));
    const afterLine = after.split("\n").find((line) => line.startsWith(`${key}:`));
    assert.equal(beforeLine, afterLine, key);
  }
  await fs.rm(repo.root, { recursive: true, force: true });
});

test("writeTerminalCloseOut rewrites Next Action and retracts Next Handoff", async () => {
  const repo = await writeRepo({
    task: outstandingTaskMd({
      nextRole: "human-operator",
      role: "implementer",
      phase: "reviewing",
      taskType: "implementation",
      nextHandoffId: "HX-002",
    }),
  });
  const taskAbs = path.join(repo.root, repo.taskRel);
  const beforeHash = sha256Bytes(new Uint8Array(await fs.readFile(taskAbs)));
  const written = await writeTerminalCloseOut({
    taskAbs,
    expectedHash: beforeHash,
    runId: RUN_ID,
    updatedAt: "2026-09-02",
  });
  assert.equal(written.ok, true, written.ok ? "" : JSON.stringify(written));
  const after = await fs.readFile(taskAbs, "utf8");
  assert.match(after, /Auto-chain complete: implementation review passed \(Bridge run run_id=run-/);
  assert.match(after, /No outstanding handoff/);
  assert.doesNotMatch(after, /Re-review the implementation/);
  await fs.rm(repo.root, { recursive: true, force: true });
});
