import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runReview } from "../src/core/review.ts";
import { testClock, testDeps, validTaskMd } from "./helpers.ts";
import { makeRepo } from "./helpers.ts";

const RUN_ID = "run-11111111-1111-4111-8111-111111111111";

test("runtime-path traversal is rejected with no run", async () => {
  const { root, taskRel } = await makeRepo();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-bridge-out-"));
  await fs.rm(path.join(root, ".spartan-bridge"), { force: true, recursive: true });
  await fs.symlink(outside, path.join(root, ".spartan-bridge"));
  const outcome = await runReview({ repo: root, task: taskRel }, testDeps({ clock: testClock(RUN_ID) }));
  assert.equal(outcome.createdRun, false);
  assert.equal(outcome.exitCode, 1);
  const entries = await fs.readdir(outside);
  assert.equal(entries.length, 0);
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

test("task path traversal is path_invalid after run_requested", async () => {
  const { root } = await makeRepo();
  const outcome = await runReview(
    { repo: root, task: "../outside.md" },
    testDeps({ clock: testClock(RUN_ID) }),
  );
  assert.equal(outcome.createdRun, true);
  assert.equal(outcome.status?.reason_code, "path_invalid");
  await fs.rm(root, { recursive: true, force: true });
});

test("exact host allowlist does not lowercase or abbreviate", async () => {
  const { parseAgentsPolicy } = await import("../src/policy/agents-policy.ts");
  const { validAgentsMd } = await import("./helpers.ts");
  for (const host of ["cursor", "CURSOR", "Codex CLI", "Claude"]) {
    const parsed = parseAgentsPolicy(validAgentsMd({ host }));
    assert.equal(parsed.ok, false);
  }
});

test("client-context matching is exact and length-bounded", async () => {
  const { isValidClientContextAlias } = await import("../src/policy/task-frontmatter.ts");
  assert.equal(isValidClientContextAlias("personal"), true);
  assert.equal(isValidClientContextAlias("Personal"), false);
  assert.equal(isValidClientContextAlias("a".repeat(65)), false);
  assert.equal(isValidClientContextAlias(""), false);
});

void validTaskMd;
void os;
void path;
