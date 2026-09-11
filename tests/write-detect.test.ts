import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Adapter } from "../src/adapters/adapter.ts";
import { ReviewerWriteDetectedError } from "../src/adapters/adapter.ts";
import { createLauncherCatalog, FakeAdapter } from "../src/adapters/fake.ts";
import { CURSOR_LAUNCHER_ID, CursorAdapter } from "../src/adapters/cursor.ts";
import { sha256Bytes } from "../src/core/serialize.ts";
import {
  snapshotDiff,
  snapshotDiffers,
  snapshotTree,
  SnapshotCapError,
  SNAPSHOT_HASH_FILE_CAP,
  workspaceDiff,
  workspaceDiffers,
  type SnapshotEntry,
  type TreeSnapshot,
} from "../src/core/snapshot.ts";
import type { ReviewerWriteRecord, StatusDocument } from "../src/core/contracts.ts";
import { runReview } from "../src/core/review.ts";
import {
  VALID_REGISTRY,
  constantSource,
  eventTypes,
  loadRun,
  makeRepo,
  passResult,
  testClock,
  testDeps,
  withInPlaceWorkspace,
  withStructuredOutput,
} from "./helpers.ts";

const RUN_ID = "run-11111111-1111-4111-8111-111111111111";
const PRODUCT_PAYLOAD = "PAYLOAD_MUST_NOT_ENTER_WRITE_RECORD";
const WORKSPACE_PAYLOAD = "WORKSPACE_PAYLOAD_MUST_NOT_ENTER_WRITE_RECORD";

function assertReviewerWrite(
  status: StatusDocument | null | undefined,
  comparison: ReviewerWriteRecord["comparison"],
): ReviewerWriteRecord {
  assert.equal(status?.reviewer_write == null, false);
  const record = status!.reviewer_write!;
  assert.equal(record.comparison, comparison);
  assert.equal(record.entries.length > 0, true);
  return record;
}

function assertRelativePaths(record: ReviewerWriteRecord, roots: string[]): void {
  for (const entry of record.entries) {
    assert.equal(path.isAbsolute(entry.path), false, entry.path);
    for (const root of roots) {
      assert.equal(entry.path.includes(root), false, `${entry.path} vs ${root}`);
    }
  }
}

function assertNoContentKeys(record: ReviewerWriteRecord): void {
  for (const entry of record.entries) {
    assert.deepEqual(Object.keys(entry), ["path", "change", "fields"]);
  }
}

function wrapCollect(mutate: () => Promise<void>, opts: { isolated?: boolean } = {}): Adapter {
  const inner = new FakeAdapter(constantSource(passResult()));
  return {
    // Most of these tests exercise the repository-worktree write detector
    // itself, which `runReview` runs only for an in-place adapter (task 0051 /
    // D-052); one passes `isolated: true` to check the skip.
    capabilities: () => ({ ...inner.capabilities(), isolated_workspace: opts.isolated ?? false }),
    preflight: () => inner.preflight(),
    prepare: (input) => inner.prepare(input),
    start: (input) => inner.start(input),
    collect: async () => {
      await mutate();
      return passResult();
    },
    verify: () => inner.verify(),
    cancel: () => inner.cancel(),
    cleanup: () => inner.cleanup(),
    observedModel: () => inner.observedModel(),
  };
}

test("product file, live task, and workspace copy stay on disjoint reason codes", async () => {
  const { root, taskRel, productRel } = await makeRepo();
  const productOutcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({
      clock: testClock(RUN_ID),
      createAdapter: () => wrapCollect(async () => {
        await fs.appendFile(path.join(root, productRel), `${PRODUCT_PAYLOAD}\n`);
      }),
    }),
  );
  assert.equal(productOutcome.status?.reason_code, "reviewer_write_detected");
  assert.equal(productOutcome.status?.state, "blocked");
  assert.equal(productOutcome.exitCode, 1);
  const productRun = await loadRun(root, RUN_ID);
  const productWrite = assertReviewerWrite(productRun.status, "repository_worktree");
  assertRelativePaths(productWrite, [root]);
  assert.equal(
    productWrite.entries.some((entry) => entry.path === productRel && entry.change === "changed"),
    true,
  );
  const productRaw = await fs.readFile(path.join(root, ".spartan-bridge", "runs", RUN_ID, "status.json"), "utf8");
  assert.equal(productRaw.includes(PRODUCT_PAYLOAD), false);
  assertNoContentKeys(productWrite);
  assert.deepEqual(eventTypes(productRun.events), [
    "run_requested",
    "policy_resolved",
    "review_started",
    "run_terminal",
  ]);
  await fs.rm(root, { recursive: true, force: true });

  const taskRepo = await makeRepo();
  const taskOutcome = await runReview(
    { repo: taskRepo.root, task: taskRepo.taskRel },
    testDeps({
      clock: testClock(RUN_ID),
      createAdapter: () => wrapCollect(async () => {
        await fs.appendFile(path.join(taskRepo.root, taskRepo.taskRel), "\nmutated-task\n");
      }),
    }),
  );
  assert.equal(taskOutcome.status?.reason_code, "integrity_mismatch");
  assert.equal(taskOutcome.status?.state, "failed");
  assert.equal(taskOutcome.status?.reviewer_write, null);
  await fs.rm(taskRepo.root, { recursive: true, force: true });

  const workspaceRepo = await makeRepo();
  const liveTaskBefore = await fs.readFile(path.join(workspaceRepo.root, workspaceRepo.taskRel));
  const workspaceOutcome = await runReview(
    { repo: workspaceRepo.root, task: workspaceRepo.taskRel },
    {
      ...testDeps({
        registryYaml: VALID_REGISTRY.replaceAll("fake-reviewer-v1", CURSOR_LAUNCHER_ID),
        clock: testClock(RUN_ID),
      }),
      catalog: createLauncherCatalog(
        () => {
          throw new Error("fake unused");
        },
        new Map([[CURSOR_LAUNCHER_ID, () => withStructuredOutput(cursorAdapterMutatingWorkspaceCopy())]]),
      ),
    },
  );
  assert.equal(workspaceOutcome.status?.reason_code, "reviewer_write_detected");
  assert.equal(workspaceOutcome.status?.state, "blocked");
  const workspaceRun = await loadRun(workspaceRepo.root, RUN_ID);
  const workspaceWrite = assertReviewerWrite(workspaceRun.status, "reviewer_workspace");
  assert.notEqual(workspaceWrite.comparison, productWrite.comparison);
  assertRelativePaths(workspaceWrite, [workspaceRepo.root, os.tmpdir()]);
  assert.equal(
    workspaceWrite.entries.some((entry) => entry.path === "task.md" && entry.change === "changed"),
    true,
  );
  const workspaceRaw = await fs.readFile(
    path.join(workspaceRepo.root, ".spartan-bridge", "runs", RUN_ID, "status.json"),
    "utf8",
  );
  assert.equal(workspaceRaw.includes(WORKSPACE_PAYLOAD), false);
  assertNoContentKeys(workspaceWrite);
  assert.deepEqual(await fs.readFile(path.join(workspaceRepo.root, workspaceRepo.taskRel)), liveTaskBefore);
  await fs.rm(workspaceRepo.root, { recursive: true, force: true });
});

function cursorAdapterMutatingWorkspaceCopy(): CursorAdapter {
  return new CursorAdapter({
    runner: {
      start(request) {
        if (request.args[0] === "--help") {
          return {
            wait: async () => ({
              exitCode: 0,
              stdout: Buffer.from("--print --output-format --mode --sandbox --workspace --trust\n"),
              stderr: Buffer.alloc(0),
              timedOut: false,
              stdoutOverflow: false,
            }),
            cancel: async () => undefined,
          };
        }
        return {
          wait: async () => {
            const copy = path.join(request.cwd, "task.md");
            await fs.chmod(copy, 0o644);
            await fs.appendFile(copy, `${WORKSPACE_PAYLOAD}\n`);
            return {
              exitCode: 0,
              stdout: Buffer.from(JSON.stringify(passResult())),
              stderr: Buffer.alloc(0),
              timedOut: false,
              stdoutOverflow: false,
            };
          },
          cancel: async () => undefined,
        };
      },
    },
  });
}

test("snapshot skips .git node_modules and .spartan-bridge, records symlinks, and uses mtime for large files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-snap-"));
  await fs.mkdir(path.join(root, ".git"));
  await fs.writeFile(path.join(root, ".git", "secret"), "nope");
  await fs.mkdir(path.join(root, "node_modules"));
  await fs.writeFile(path.join(root, "node_modules", "pkg.js"), "nope");
  await fs.mkdir(path.join(root, ".spartan-bridge"));
  await fs.writeFile(path.join(root, ".spartan-bridge", "run.json"), "nope");
  await fs.mkdir(path.join(root, ".claude"));
  await fs.writeFile(path.join(root, ".claude", "scheduled_tasks.lock"), "nope");
  await fs.mkdir(path.join(root, ".cursor"));
  await fs.writeFile(path.join(root, ".cursor", "state.json"), "nope");
  await fs.writeFile(path.join(root, "keep.txt"), "keep");
  await fs.symlink("keep.txt", path.join(root, "link.txt"));
  const large = path.join(root, "large.bin");
  await fs.writeFile(large, Buffer.alloc(SNAPSHOT_HASH_FILE_CAP + 1, 7));
  const snap = await snapshotTree(root);
  assert.equal(snap.entries.has(".git"), false);
  assert.equal(snap.entries.has(".git/secret"), false);
  assert.equal(snap.entries.has("node_modules"), false);
  assert.equal(snap.entries.has(".spartan-bridge"), false);
  assert.equal(snap.entries.has(".claude"), false);
  assert.equal(snap.entries.has(".claude/scheduled_tasks.lock"), false);
  assert.equal(snap.entries.has(".cursor"), false);
  assert.equal(snap.entries.get("keep.txt")?.hash?.startsWith("sha256:"), true);
  assert.equal(snap.entries.get("link.txt")?.kind, "symlink");
  assert.equal(snap.entries.get("link.txt")?.linkTarget, "keep.txt");
  assert.equal(snap.entries.get("large.bin")?.hash, undefined);
  assert.equal(typeof snap.entries.get("large.bin")?.mtimeNs, "string");
  await fs.rm(root, { recursive: true, force: true });
});

test("producer snapshot records skipped names without hashing .git content", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-prod-snap-"));
  await fs.mkdir(path.join(root, ".git"));
  await fs.writeFile(path.join(root, ".git", "secret"), "nope");
  await fs.mkdir(path.join(root, "node_modules"));
  await fs.writeFile(path.join(root, "node_modules", "pkg.js"), "nope");
  await fs.mkdir(path.join(root, ".spartan-bridge"));
  await fs.writeFile(path.join(root, ".spartan-bridge", "run.json"), "nope");
  await fs.writeFile(path.join(root, "keep.txt"), "keep");
  const snap = await snapshotTree(root, { policy: "producer" });
  const secretBytes = new Uint8Array(await fs.readFile(path.join(root, ".git", "secret")));
  assert.equal(snap.entries.get(".git")?.kind, "directory");
  assert.equal(snap.entries.has(".git/secret"), false);
  assert.equal(typeof snap.entries.get(".git")?.hash, "string");
  assert.notEqual(snap.entries.get(".git")?.hash, sha256Bytes(secretBytes));
  assert.equal(snap.entries.get("node_modules")?.kind, "directory");
  assert.equal(snap.entries.has("node_modules/pkg.js"), false);
  assert.equal(snap.entries.get(".spartan-bridge")?.kind, "directory");
  assert.equal(snap.entries.has(".spartan-bridge/run.json"), false);
  assert.equal(snap.entries.get("keep.txt")?.hash?.startsWith("sha256:"), true);
  await fs.rm(root, { recursive: true, force: true });
});

test("producer snapshot detects a descendant write under .git when the directory mtime is restored", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-prod-head-"));
  const gitDir = path.join(root, ".git");
  await fs.mkdir(gitDir);
  const head = path.join(gitDir, "HEAD");
  await fs.writeFile(head, "ref: a\n", "utf8");
  const before = await snapshotTree(root, { policy: "producer" });
  const gitStat = await fs.stat(gitDir);
  await fs.writeFile(head, "ref: b\n", "utf8");
  await fs.utimes(gitDir, gitStat.atime, gitStat.mtime);
  const after = await snapshotTree(root, { policy: "producer" });
  const diffs = snapshotDiff(before, after, new Set());
  assert.equal(
    diffs.some((entry) => entry.path === ".git" && entry.change === "changed"),
    true,
  );
  await fs.rm(root, { recursive: true, force: true });
});

test("exceeding the snapshot cap is reviewer_isolation_unavailable before review_started", async () => {
  const { root, taskRel } = await makeRepo();
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({
      clock: testClock(RUN_ID),
      snapshotCaps: { entries: 3 },
      createAdapter: () => withInPlaceWorkspace(new FakeAdapter(constantSource(passResult()))),
    }),
  );
  assert.equal(outcome.status?.reason_code, "reviewer_isolation_unavailable");
  assert.equal(outcome.exitCode, 1);
  const { events } = await loadRun(root, RUN_ID);
  assert.deepEqual(eventTypes(events), ["run_requested", "policy_resolved", "run_terminal"]);
  await fs.rm(root, { recursive: true, force: true });
});

test("snapshot hash-byte cap overflow throws SnapshotCapError", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-cap-"));
  await fs.writeFile(path.join(root, "a.bin"), Buffer.alloc(64, 1));
  await fs.writeFile(path.join(root, "b.bin"), Buffer.alloc(64, 2));
  await assert.rejects(() => snapshotTree(root, { hashBytes: 80 }), (error: unknown) => {
    assert.equal(error instanceof SnapshotCapError, true);
    assert.equal((error as SnapshotCapError).cap, "hash_bytes");
    return true;
  });
  await fs.rm(root, { recursive: true, force: true });
});

test("snapshot entry cap overflow identifies the entries cap", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-entry-cap-"));
  await fs.writeFile(path.join(root, "a"), "a");
  await fs.writeFile(path.join(root, "b"), "b");
  await assert.rejects(() => snapshotTree(root, { entries: 2 }), (error: unknown) => {
    assert.equal(error instanceof SnapshotCapError, true);
    assert.equal((error as SnapshotCapError).cap, "entries");
    return true;
  });
  await fs.rm(root, { recursive: true, force: true });
});

test("writes under .spartan-bridge by the Bridge do not trigger write detection", async () => {
  const { root, taskRel } = await makeRepo();
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({ source: constantSource(passResult()), clock: testClock(RUN_ID) }),
  );
  assert.equal(outcome.status?.reason_code, "review_passed");
  assert.equal(outcome.status?.reviewer_write, null);
  assert.equal(outcome.exitCode, 0);
  await fs.rm(root, { recursive: true, force: true });
});

// Task 0051 / D-052: an isolated adapter's review is not blocked by a file that
// appears under the repo root while it runs — a launcher log, a sibling
// session's commit. The default FakeAdapter reports `isolated_workspace: true`.
test("an isolated adapter's review is not blocked by a concurrent external write", async () => {
  const { root, taskRel } = await makeRepo();
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({
      clock: testClock(RUN_ID),
      createAdapter: () =>
        wrapCollect(async () => {
          await fs.writeFile(path.join(root, "err.log"), "reviewer stderr\n");
          await fs.mkdir(path.join(root, "spartan", "tasks"), { recursive: true });
          await fs.writeFile(path.join(root, "spartan", "tasks", "9999-sibling.md"), "queued\n");
        }, { isolated: true }),
    }),
  );
  assert.equal(outcome.status?.reason_code, "review_passed");
  assert.equal(outcome.status?.reviewer_write, null);
  assert.equal(outcome.exitCode, 0);
  await fs.rm(root, { recursive: true, force: true });
});

function tree(entries: SnapshotEntry[]): TreeSnapshot {
  return { entries: new Map(entries.map((entry) => [entry.rel, entry])) };
}

function fileEntry(rel: string, extra: Partial<SnapshotEntry> = {}): SnapshotEntry {
  return { rel, kind: "file", mode: 0o644, size: 4, hash: "sha256:aaaa", ...extra };
}

test("snapshotDiff reports appeared, vanished, and each changed field", () => {
  const baseline = tree([
    fileEntry("keep.txt"),
    fileEntry("gone.txt"),
    fileEntry("mode.txt"),
    fileEntry("size.txt"),
    fileEntry("hash.txt"),
    { rel: "kind.txt", kind: "file", mode: 0o644, size: 4, hash: "sha256:aaaa" },
    { rel: "mtime.bin", kind: "file", mode: 0o644, size: 8, mtimeNs: "1" },
    { rel: "link.txt", kind: "symlink", mode: 0o644, size: 8, linkTarget: "keep.txt" },
  ]);
  const after = tree([
    fileEntry("keep.txt"),
    fileEntry("new.txt"),
    fileEntry("mode.txt", { mode: 0o444 }),
    fileEntry("size.txt", { size: 8 }),
    fileEntry("hash.txt", { hash: "sha256:bbbb" }),
    { rel: "kind.txt", kind: "directory", mode: 0o644, size: 4 },
    { rel: "mtime.bin", kind: "file", mode: 0o644, size: 8, mtimeNs: "2" },
    { rel: "link.txt", kind: "symlink", mode: 0o644, size: 8, linkTarget: "new.txt" },
  ]);
  const diffs = snapshotDiff(baseline, after, new Set());
  assert.deepEqual(
    diffs.map((entry) => [entry.path, entry.change, entry.fields]),
    [
      ["gone.txt", "vanished", ["kind", "mode", "size", "hash"]],
      ["hash.txt", "changed", ["hash"]],
      ["kind.txt", "changed", ["kind", "hash"]],
      ["link.txt", "changed", ["linkTarget"]],
      ["mode.txt", "changed", ["mode"]],
      ["mtime.bin", "changed", ["mtimeNs"]],
      ["new.txt", "appeared", ["kind", "mode", "size", "hash"]],
      ["size.txt", "changed", ["size"]],
    ],
  );
  assert.equal(snapshotDiffers(baseline, after, new Set()), true);
  assert.equal(workspaceDiffers(baseline, after), true);
  assert.deepEqual(workspaceDiff(baseline, after), diffs);
  const excluded = snapshotDiff(baseline, after, new Set(["gone.txt", "new.txt", "mode.txt"]));
  assert.equal(
    excluded.some((entry) => entry.path === "gone.txt" || entry.path === "new.txt" || entry.path === "mode.txt"),
    false,
  );
  const unchanged = tree([fileEntry("keep.txt")]);
  assert.deepEqual(snapshotDiff(unchanged, unchanged, new Set()), []);
  assert.equal(snapshotDiffers(unchanged, unchanged, new Set()), false);
});

test("ReviewerWriteDetectedError cannot be constructed without differing entries", () => {
  assert.throws(
    () => new ReviewerWriteDetectedError("reviewer_workspace", []),
    (error: unknown) => {
      assert.equal(error instanceof TypeError, true);
      return true;
    },
  );
});
