import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PRODUCER_ISOLATED_WORKSPACE_ENV } from "../src/adapters/adapter.ts";
import {
  applyProducerIsolation,
  ProducerWriteScopeError,
  producerIsolatedSandboxProfile,
} from "../src/adapters/producer-write-scope.ts";
import { createNodeProcessRunner, SANDBOX_EXEC_EXECUTABLE } from "../src/adapters/process.ts";
import { producerPathDenied, SNAPSHOT_HASH_FILE_CAP, snapshotTree, workspaceDiff } from "../src/core/snapshot.ts";
import { parseAgentsPolicy } from "../src/policy/agents-policy.ts";
import {
  applyProducerMerge,
  captureProducerMerge,
  type CapturedProducerChange,
  classifyProducerWorkspacePath,
  cleanupProducerWorkspace,
  isStructuralProducerDirectoryDiff,
  prepareProducerWorkspace,
  PRODUCER_AUTHORITY_FILE,
  PRODUCER_DEFAULT_BUILD_SCRATCH_PREFIXES,
  PRODUCER_DEFAULT_SCRATCH_PREFIXES,
  PRODUCER_MERGE_BYTE_CAP,
  PRODUCER_MERGE_ENTRY_CAP,
  ProducerMergeError,
  PRODUCER_SUPPORT_SCRATCH_PREFIXES,
  PRODUCER_SUPPORT_SCOPE,
  resolveProducerScratchPrefixes,
  resolveMergeDestinations,
} from "../src/core/workspace.ts";
import { validAgentsMd } from "./helpers.ts";

const SCOPE = ["src/", "spartan/", "agent-skill/skills/spbridge/SKILL.md"];
const IN_PRODUCER_WORKSPACE = process.env[PRODUCER_ISOLATED_WORKSPACE_ENV] === "1";
const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));
const IN_COPY_CHECK_MAX_BUFFER = 16 * 1024 * 1024;

function captured(
  pathName: string,
  change: CapturedProducerChange["change"],
  kind: CapturedProducerChange["kind"],
  options: { bytes?: Buffer | null; mode?: number; fields?: CapturedProducerChange["fields"] } = {},
): CapturedProducerChange {
  const bytes = options.bytes === undefined ? (kind === "file" && change !== "vanished" ? Buffer.from("new\n") : null) : options.bytes;
  return {
    path: pathName,
    change,
    kind,
    fields: options.fields ?? (change === "changed" ? ["hash"] : ["kind", "mode", "size", "hash"]),
    bytes,
    mode: options.mode ?? (kind === "directory" ? 0o755 : 0o644),
    sha256: bytes === null ? null : "captured",
  };
}

async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-producer-repo-"));
  await fs.mkdir(path.join(root, "src"));
  await fs.mkdir(path.join(root, "spartan"));
  await fs.mkdir(path.join(root, "agent-skill", "skills", "spbridge", "agents"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "a.ts"), "one\n");
  await fs.writeFile(path.join(root, "spartan", "task.md"), "plan\n");
  await fs.writeFile(path.join(root, "agent-skill", "skills", "spbridge", "SKILL.md"), "skill\n");
  await fs.writeFile(path.join(root, "agent-skill", "skills", "spbridge", "agents", "openai.yaml"), "hidden\n");
  return fs.realpath(root);
}

async function snapshotPreparedProducerWorkspace(prepared: {
  workspaceRoot: string;
  supportScope: readonly string[];
  scratchPrefixes: readonly string[];
}) {
  return snapshotTree(prepared.workspaceRoot, {
    policy: "workspace",
    collapsePrefixes: prepared.supportScope,
    omitPrefixes: prepared.scratchPrefixes,
  });
}

async function sandboxExecProfileUnavailable(): Promise<boolean> {
  const outcome = await createNodeProcessRunner().start({
    executable: SANDBOX_EXEC_EXECUTABLE,
    args: ["-p", "(version 1)\n(allow default)\n", "/usr/bin/true"],
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH ?? "" },
    timeoutMs: 5000,
    stdoutCapBytes: 1024,
  }).wait();
  return outcome.exitCode === 71 && outcome.stderr.toString().includes("sandbox_apply");
}

test("isolated profile is ordered as a global deny followed by named allows and final repository denies", async () => {
  const root = await fixture();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-producer-workspace-"));
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-producer-home-"));
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-producer-tmp-"));
  const profile = producerIsolatedSandboxProfile(await fs.realpath(workspace), root, { HOME: home, TMPDIR: tmp });
  const clauses = [
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* (subpath \"${await fs.realpath(home)}\"))`,
    `(allow file-write* (subpath \"${await fs.realpath(tmp)}\"))`,
    `(allow file-write* (subpath \"${await fs.realpath(workspace)}\"))`,
    "(vnode-type SYMLINK)",
    `(deny file-write* (subpath \"${root}\"))`,
    `(deny file-link (subpath \"${root}\"))`,
  ];
  let prior = -1;
  for (const clause of clauses) {
    const next = profile.indexOf(clause);
    assert.ok(next > prior, clause);
    prior = next;
  }
  assert.doesNotMatch(profile, /require-not/);
  const omitted = producerIsolatedSandboxProfile(workspace, root, {});
  assert.equal((omitted.match(/\(allow file-write\*/g) ?? []).length, 1);
  assert.throws(() => producerIsolatedSandboxProfile(`${workspace}\"bad`, root, {}), ProducerWriteScopeError);
  assert.throws(() => producerIsolatedSandboxProfile(workspace, `${root}\\bad`, {}), ProducerWriteScopeError);
  await Promise.all([root, workspace, home, tmp].map((item) => fs.rm(item, { recursive: true, force: true })));
});

test("producer isolation refuses a workspace at or nested inside the repository root", async () => {
  const root = await fixture();
  const nested = path.join(root, "producer-workspace");
  await fs.mkdir(nested);
  try {
    for (const workspace of [root, nested]) {
      await assert.rejects(
        () => applyProducerIsolation(root, workspace, {}),
        (error: unknown) => error instanceof ProducerWriteScopeError && error.code === "confine_unavailable",
      );
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("prepared producer copy contains admitted files, mirrored exact-file ancestors, and bounded support links", async () => {
  const root = await fixture();
  await fs.symlink("/tmp/not-followed", path.join(root, "src", "escape"));
  await fs.mkdir(path.join(root, "node_modules", ".bin"), { recursive: true });
  await fs.mkdir(path.join(root, "node_modules", "typescript", "bin"), { recursive: true });
  await fs.writeFile(path.join(root, "node_modules", "typescript", "bin", "tsc"), "tool\n");
  await fs.symlink("../typescript/bin/tsc", path.join(root, "node_modules", ".bin", "tsc"));
  await fs.symlink("../../dist/cli/main.js", path.join(root, "node_modules", ".bin", "spartan-bridge"));
  const prepared = await prepareProducerWorkspace({ repoRoot: root, writeScope: SCOPE, supportScope: ["node_modules/"] });
  try {
    assert.equal(path.relative(root, prepared.workspaceRoot).startsWith(".."), true);
    assert.equal((await fs.stat(prepared.workspaceRoot)).mode & 0o777, 0o700);
    assert.equal(await fs.readFile(path.join(prepared.workspaceRoot, "src", "a.ts"), "utf8"), "one\n");
    await assert.rejects(fs.access(path.join(prepared.workspaceRoot, "src", "escape")));
    await assert.rejects(fs.access(path.join(prepared.workspaceRoot, "agent-skill", "skills", "spbridge", "agents")));
    assert.equal(await fs.readlink(path.join(prepared.workspaceRoot, "node_modules", ".bin", "tsc")), "../typescript/bin/tsc");
    await assert.rejects(fs.lstat(path.join(prepared.workspaceRoot, "node_modules", ".bin", "spartan-bridge")));
    assert.equal(prepared.baseline.entries.get("agent-skill/skills/spbridge")?.kind, "directory");
  } finally {
    await cleanupProducerWorkspace(prepared.workspaceRoot);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("prepared producer copy carries only the authority-file addition as a regular 0444 baseline entry", async () => {
  const root = await fixture();
  const authorityBytes = Buffer.from("# Repository authority\n\nclient-context declaration\n");
  await fs.writeFile(path.join(root, PRODUCER_AUTHORITY_FILE), authorityBytes, { mode: 0o755 });
  const prepared = await prepareProducerWorkspace({ repoRoot: root, writeScope: SCOPE, supportScope: [] });
  try {
    const authorityPath = path.join(prepared.workspaceRoot, PRODUCER_AUTHORITY_FILE);
    assert.deepEqual(await fs.readFile(authorityPath), authorityBytes);
    assert.equal((await fs.stat(authorityPath)).mode & 0o777, 0o444);
    assert.equal(prepared.baseline.entries.get(PRODUCER_AUTHORITY_FILE)?.kind, "file");

    const priorEntries = [
      ".",
      "agent-skill",
      "agent-skill/skills",
      "agent-skill/skills/spbridge",
      "agent-skill/skills/spbridge/SKILL.md",
      "spartan",
      "spartan/task.md",
      "src",
      "src/a.ts",
    ].sort();
    const currentEntries = [...prepared.baseline.entries.keys()].sort();
    assert.deepEqual(currentEntries.filter((entry) => entry !== PRODUCER_AUTHORITY_FILE), priorEntries);
    assert.deepEqual(currentEntries.filter((entry) => !priorEntries.includes(entry)), [PRODUCER_AUTHORITY_FILE]);
    assert.deepEqual([...PRODUCER_SUPPORT_SCOPE], ["node_modules/"]);
    assert.deepEqual([...PRODUCER_DEFAULT_BUILD_SCRATCH_PREFIXES], ["dist/"]);
    assert.deepEqual([...PRODUCER_SUPPORT_SCRATCH_PREFIXES], ["node_modules/.cache/"]);
    assert.deepEqual([...PRODUCER_DEFAULT_SCRATCH_PREFIXES], ["dist/", "node_modules/.cache/"]);
  } finally {
    await cleanupProducerWorkspace(prepared.workspaceRoot);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a contained support scratch symlink stays unchanged and does not abort producer preparation", async () => {
  const root = await fixture();
  await fs.mkdir(path.join(root, "node_modules", "cache-target"), { recursive: true });
  await fs.writeFile(path.join(root, "node_modules", "cache-target", "existing.bin"), "cache\n");
  await fs.symlink("cache-target", path.join(root, "node_modules", ".cache"));
  const prepared = await prepareProducerWorkspace({ repoRoot: root, writeScope: SCOPE });
  try {
    assert.equal(await fs.readlink(path.join(prepared.workspaceRoot, "node_modules", ".cache")), "cache-target");
    assert.equal(prepared.baseline.entries.has("node_modules/.cache"), false);
  } finally {
    await cleanupProducerWorkspace(prepared.workspaceRoot);
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function prepareAuthorityMergeCase(): Promise<{
  root: string;
  prepared: Awaited<ReturnType<typeof prepareProducerWorkspace>>;
  writeScope: readonly string[];
}> {
  const root = await fixture();
  await fs.writeFile(
    path.join(root, PRODUCER_AUTHORITY_FILE),
    validAgentsMd({ automaticImplementation: true, automaticWriteScope: SCOPE }),
  );
  const parsed = parseAgentsPolicy(await fs.readFile(path.join(root, PRODUCER_AUTHORITY_FILE), "utf8"));
  assert.equal(parsed.ok, true);
  if (!parsed.ok || parsed.automatic_implementation_write_scope === null) {
    throw new Error("fixture automatic implementation write scope unavailable");
  }
  const prepared = await prepareProducerWorkspace({
    repoRoot: root,
    writeScope: parsed.automatic_implementation_write_scope,
    supportScope: [],
  });
  return { root, prepared, writeScope: parsed.automatic_implementation_write_scope };
}

async function assertAuthorityMergeRefused(
  mutate: (authorityPath: string) => Promise<void>,
): Promise<void> {
  const { root, prepared, writeScope } = await prepareAuthorityMergeCase();
  try {
    const authorityPath = path.join(prepared.workspaceRoot, PRODUCER_AUTHORITY_FILE);
    await mutate(authorityPath);
    const after = await snapshotPreparedProducerWorkspace(prepared);
    await assert.rejects(
      () => captureProducerMerge({
        workspaceRoot: prepared.workspaceRoot,
        baseline: prepared.baseline,
        after,
        writeScope,
        supportScope: [],
      }),
      (error: unknown) => error instanceof ProducerMergeError && error.reason === "write_scope_violation",
    );
  } finally {
    await cleanupProducerWorkspace(prepared.workspaceRoot);
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("capture refuses a content edit of the carried authority file under the real automatic scope", async () => {
  await assertAuthorityMergeRefused(async (authorityPath) => {
    const replacement = `${authorityPath}.replacement`;
    await fs.writeFile(replacement, "changed authority\n", { mode: 0o444 });
    await fs.rename(replacement, authorityPath);
  });
});

test("capture refuses a mode-only edit of the carried authority file under the real automatic scope", async () => {
  await assertAuthorityMergeRefused(async (authorityPath) => fs.chmod(authorityPath, 0o644));
});

test("capture refuses deletion of the carried authority file under the real automatic scope", async () => {
  await assertAuthorityMergeRefused(async (authorityPath) => fs.rm(authorityPath));
});

test("the real prepared producer copy runs every declared repository check with the bounded tool links", { skip: IN_PRODUCER_WORKSPACE }, async () => {
  const policy = parseAgentsPolicy(await fs.readFile(path.join(REPOSITORY_ROOT, "AGENTS.md"), "utf8"));
  if (!policy.ok || policy.automatic_implementation_write_scope === null) {
    throw new Error("repository automatic implementation write scope is unavailable");
  }
  assert.deepEqual(policy.automatic_implementation_write_scope, [
    "src/",
    "tests/",
    "docs/",
    "skills/",
    "agent-skill/skills/spbridge/SKILL.md",
    "spartan/",
    "README.md",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
  ]);
  const prepared = await prepareProducerWorkspace({
    repoRoot: REPOSITORY_ROOT,
    writeScope: policy.automatic_implementation_write_scope,
  });
  try {
    const bin = path.join(prepared.workspaceRoot, "node_modules", ".bin");
    const expectedLinks = new Map([
      ["esbuild", "../esbuild/bin/esbuild"],
      ["tsc", "../typescript/bin/tsc"],
      ["tsserver", "../typescript/bin/tsserver"],
      ["tsx", "../tsx/dist/cli.mjs"],
      ["yaml", "../yaml/bin.mjs"],
    ]);
    for (const [name, target] of expectedLinks) {
      assert.equal(await fs.readlink(path.join(bin, name)), target);
    }
    await assert.rejects(fs.lstat(path.join(bin, "spartan-bridge")));

    const env = { ...process.env, [PRODUCER_ISOLATED_WORKSPACE_ENV]: "1" };
    for (const script of ["typecheck", "build", "test"]) {
      execFileSync("npm", ["run", script], {
        cwd: prepared.workspaceRoot,
        env,
        maxBuffer: IN_COPY_CHECK_MAX_BUFFER,
        stdio: "pipe",
        timeout: script === "test" ? 600_000 : 240_000,
      });
    }
  } finally {
    await cleanupProducerWorkspace(prepared.workspaceRoot);
  }
});

test("descriptor-backed copy never follows a source replaced by a symlink and accepts a multiply-linked inode", async () => {
  const root = await fixture();
  const outside = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "spartan-copy-outside-")), "secret");
  await fs.writeFile(outside, "secret\n");
  await fs.link(path.join(root, "src", "a.ts"), path.join(root, "src", "second.ts"));
  let swapped = false;
  const prepared = await prepareProducerWorkspace(
    { repoRoot: root, writeScope: ["src/"], supportScope: [] },
    { safeReadSeam: { beforeOpen(abs) {
      if (!swapped && abs.endsWith(`${path.sep}a.ts`)) {
        swapped = true;
        void fs.rm(abs).then(() => fs.symlink(outside, abs));
      }
    } } },
  );
  try {
    const second = path.join(prepared.workspaceRoot, "src", "second.ts");
    assert.equal(await fs.readFile(second, "utf8"), "one\n");
    assert.equal((await fs.stat(second)).nlink, 1);
    const copiedA = await fs.readFile(path.join(prepared.workspaceRoot, "src", "a.ts"), "utf8").catch(() => null);
    assert.notEqual(copiedA, "secret\n");
  } finally {
    await cleanupProducerWorkspace(prepared.workspaceRoot);
    await fs.rm(path.dirname(outside), { recursive: true, force: true });
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("classification is ordered and exact", () => {
  assert.deepEqual([...PRODUCER_DEFAULT_SCRATCH_PREFIXES], ["dist/", "node_modules/.cache/"]);
  assert.equal(classifyProducerWorkspacePath("dist/x", ["src/"]), "scratch");
  assert.equal(classifyProducerWorkspacePath("node_modules/.cache/x", ["src/"]), "scratch");
  assert.equal(classifyProducerWorkspacePath("node_modules/typescript/x", ["src/"]), "support");
  assert.equal(classifyProducerWorkspacePath("src/x", ["src/"]), "admitted");
  assert.equal(classifyProducerWorkspacePath("build/x", ["src/"]), "refused");
});

test("scratch resolution refuses write-scope overlap and required producer-copy inputs", () => {
  for (const [declared, scope] of [
    ["src/", ["src/"]],
    ["src/generated/", ["src/"]],
    ["s/", ["s/deep/"]],
    ["cfg/", ["cfg/app.json"]],
  ] as const) {
    assert.equal(resolveProducerScratchPrefixes([declared], scope), null, `${declared} against ${scope[0]}`);
  }
  for (const declared of ["AGENTS.md/", "node_modules/"] as const) {
    assert.equal(resolveProducerScratchPrefixes([declared], SCOPE), null, declared);
  }
});

test("declared support-root descendant follows the resolved scratch list through snapshots and merge", async () => {
  const root = await fixture();
  await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await fs.mkdir(path.join(root, "node_modules", ".vite"), { recursive: true });
  await fs.writeFile(path.join(root, "node_modules", "pkg", "index.js"), "support\n");
  await fs.writeFile(path.join(root, "node_modules", ".vite", "baseline.bin"), "before\n");
  const scratchPrefixes = resolveProducerScratchPrefixes(["node_modules/.vite/"], SCOPE);
  assert.deepEqual(scratchPrefixes, ["node_modules/.vite/", "node_modules/.cache/"]);
  assert.equal(
    classifyProducerWorkspacePath(
      "node_modules/.vite/generated.bin",
      SCOPE,
      PRODUCER_SUPPORT_SCOPE,
      scratchPrefixes!,
    ),
    "scratch",
  );
  const prepared = await prepareProducerWorkspace({
    repoRoot: root,
    writeScope: SCOPE,
    scratchPrefixes: scratchPrefixes!,
  });
  try {
    assert.deepEqual(prepared.scratchPrefixes, ["node_modules/.vite/", "node_modules/.cache/"]);
    const supportBefore = prepared.baseline.entries.get("node_modules")?.hash;
    await fs.writeFile(
      path.join(prepared.workspaceRoot, "node_modules", ".vite", "baseline.bin"),
      "after\n",
    );
    await fs.writeFile(
      path.join(prepared.workspaceRoot, "node_modules", ".vite", "generated.bin"),
      "generated\n",
    );
    const after = await snapshotPreparedProducerWorkspace(prepared);
    assert.equal(after.entries.get("node_modules")?.hash, supportBefore);
    assert.deepEqual(await captureProducerMerge({
      workspaceRoot: prepared.workspaceRoot,
      baseline: prepared.baseline,
      after,
      writeScope: SCOPE,
      supportScope: prepared.supportScope,
      scratchPrefixes: prepared.scratchPrefixes,
    }), []);
  } finally {
    await cleanupProducerWorkspace(prepared.workspaceRoot);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("declared build scratch replaces the default while support scratch stays effective", async () => {
  const root = await fixture();
  await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await fs.writeFile(path.join(root, "node_modules", "pkg", "index.js"), "support\n");
  const scratchPrefixes = resolveProducerScratchPrefixes(["build/"], SCOPE);
  assert.deepEqual(scratchPrefixes, ["build/", "node_modules/.cache/"]);
  const prepared = await prepareProducerWorkspace({
    repoRoot: root,
    writeScope: SCOPE,
    scratchPrefixes: scratchPrefixes!,
  });
  try {
    assert.deepEqual(prepared.scratchPrefixes, ["build/", "node_modules/.cache/"]);
    const supportBefore = prepared.baseline.entries.get("node_modules")?.hash;
    const cache = path.join(prepared.workspaceRoot, "node_modules", ".cache");
    await fs.writeFile(path.join(cache, "tool.cache"), "cache\n");
    await fs.mkdir(path.join(prepared.workspaceRoot, "build"));
    await fs.writeFile(path.join(prepared.workspaceRoot, "build", "built.js"), "built\n");
    let after = await snapshotPreparedProducerWorkspace(prepared);
    assert.equal(after.entries.get("node_modules")?.hash, supportBefore);
    assert.equal(after.entries.has("build"), false);
    assert.equal(after.entries.has("node_modules/.cache"), false);
    assert.deepEqual(await captureProducerMerge({
      workspaceRoot: prepared.workspaceRoot,
      baseline: prepared.baseline,
      after,
      writeScope: SCOPE,
      supportScope: prepared.supportScope,
      scratchPrefixes: prepared.scratchPrefixes,
    }), []);

    await fs.mkdir(path.join(prepared.workspaceRoot, "dist"));
    await fs.writeFile(path.join(prepared.workspaceRoot, "dist", "built.js"), "unexpected\n");
    after = await snapshotPreparedProducerWorkspace(prepared);
    await assert.rejects(
      () => captureProducerMerge({
        workspaceRoot: prepared.workspaceRoot,
        baseline: prepared.baseline,
        after,
        writeScope: SCOPE,
        supportScope: prepared.supportScope,
        scratchPrefixes: prepared.scratchPrefixes,
      }),
      (error: unknown) => error instanceof ProducerMergeError && error.reason === "write_scope_violation",
    );
  } finally {
    await cleanupProducerWorkspace(prepared.workspaceRoot);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("an inherited default overlapping write scope is product and merges back", async () => {
  const root = await fixture();
  const writeScope = [...SCOPE, "dist/"];
  const scratchPrefixes = resolveProducerScratchPrefixes(undefined, writeScope);
  assert.deepEqual(scratchPrefixes, ["node_modules/.cache/"]);
  const prepared = await prepareProducerWorkspace({
    repoRoot: root,
    writeScope,
    supportScope: [],
    scratchPrefixes: scratchPrefixes!,
  });
  try {
    await fs.mkdir(path.join(prepared.workspaceRoot, "dist"));
    await fs.writeFile(path.join(prepared.workspaceRoot, "dist", "built.js"), "product\n");
    const after = await snapshotPreparedProducerWorkspace(prepared);
    const captured = await captureProducerMerge({
      workspaceRoot: prepared.workspaceRoot,
      baseline: prepared.baseline,
      after,
      writeScope,
      supportScope: prepared.supportScope,
      scratchPrefixes: prepared.scratchPrefixes,
    });
    assert.deepEqual(captured.map((entry) => entry.path), ["dist", "dist/built.js"]);
    const destinations = await resolveMergeDestinations({ repoRoot: root, captured });
    await applyProducerMerge({ repoRoot: root, captured, destinations, runId: "inherited-default" });
    assert.equal(await fs.readFile(path.join(root, "dist", "built.js"), "utf8"), "product\n");
  } finally {
    await cleanupProducerWorkspace(prepared.workspaceRoot);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("workspace-policy baseline fully hashes large admitted files in the producer copy", async () => {
  const root = await fixture();
  await fs.writeFile(path.join(root, "src", "large.bin"), Buffer.alloc(SNAPSHOT_HASH_FILE_CAP + 1, 7));
  const prepared = await prepareProducerWorkspace({ repoRoot: root, writeScope: SCOPE, supportScope: [] });
  try {
    const entry = prepared.baseline.entries.get("src/large.bin");
    assert.equal(entry?.hash?.startsWith("sha256:"), true);
    assert.equal(entry?.mtimeNs, undefined);
  } finally {
    await cleanupProducerWorkspace(prepared.workspaceRoot);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("workspace diff catches tail-only content and structural directory entries are filtered", async () => {
  const root = await fixture();
  const prepared = await prepareProducerWorkspace({ repoRoot: root, writeScope: SCOPE, supportScope: [] });
  try {
    await fs.writeFile(path.join(prepared.workspaceRoot, "src", "a.ts"), "two\n");
    await fs.writeFile(path.join(prepared.workspaceRoot, "src", "new.ts"), "new\n");
    const after = await snapshotTree(prepared.workspaceRoot, { policy: "workspace" });
    const diff = workspaceDiff(prepared.baseline, after);
    assert.ok(diff.some((entry) => entry.path === "src/a.ts" && entry.fields.includes("hash")));
    const directory = diff.find((entry) => entry.path === "src");
    assert.ok(directory && isStructuralProducerDirectoryDiff(directory, prepared.baseline, after));
    const captured = await captureProducerMerge({ workspaceRoot: prepared.workspaceRoot, baseline: prepared.baseline, after, writeScope: SCOPE, supportScope: [] });
    assert.equal(captured.some((entry) => entry.path === "src"), false);
  } finally {
    await cleanupProducerWorkspace(prepared.workspaceRoot);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("merge writes only captured bytes even when the workspace changes after capture", async () => {
  const root = await fixture();
  const prepared = await prepareProducerWorkspace({ repoRoot: root, writeScope: SCOPE, supportScope: [] });
  try {
    const copyFile = path.join(prepared.workspaceRoot, "src", "a.ts");
    await fs.writeFile(copyFile, "captured\n");
    const after = await snapshotTree(prepared.workspaceRoot, { policy: "workspace" });
    const captured = await captureProducerMerge({ workspaceRoot: prepared.workspaceRoot, baseline: prepared.baseline, after, writeScope: SCOPE, supportScope: [] });
    const destinations = await resolveMergeDestinations({ repoRoot: root, captured });
    await fs.writeFile(copyFile, "substituted\n");
    await applyProducerMerge({ repoRoot: root, captured, destinations, runId: "test" });
    assert.equal(await fs.readFile(path.join(root, "src", "a.ts"), "utf8"), "captured\n");
  } finally {
    await cleanupProducerWorkspace(prepared.workspaceRoot);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("destination symlinks refuse before any merge output can escape", async () => {
  const root = await fixture();
  const prepared = await prepareProducerWorkspace({ repoRoot: root, writeScope: SCOPE, supportScope: [] });
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-merge-outside-"));
  const outside = path.join(outsideDir, "a.ts");
  await fs.writeFile(outside, "outside\n");
  try {
    await fs.writeFile(path.join(prepared.workspaceRoot, "src", "a.ts"), "changed\n");
    const after = await snapshotTree(prepared.workspaceRoot, { policy: "workspace" });
    const captured = await captureProducerMerge({ workspaceRoot: prepared.workspaceRoot, baseline: prepared.baseline, after, writeScope: SCOPE, supportScope: [] });
    await fs.rm(path.join(root, "src", "a.ts"));
    await fs.symlink(outside, path.join(root, "src", "a.ts"));
    await assert.rejects(() => resolveMergeDestinations({ repoRoot: root, captured }), ProducerMergeError);
    assert.equal(await fs.readFile(outside, "utf8"), "outside\n");
  } finally {
    await cleanupProducerWorkspace(prepared.workspaceRoot);
    await fs.rm(outsideDir, { recursive: true, force: true });
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("scratch output is discarded while any non-scratch support mutation refuses capture", async () => {
  const root = await fixture();
  await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await fs.writeFile(path.join(root, "node_modules", "pkg", "index.js"), "support\n");
  const prepared = await prepareProducerWorkspace({ repoRoot: root, writeScope: SCOPE });
  try {
    const supportEntry = prepared.baseline.entries.get("node_modules");
    assert.equal(typeof supportEntry?.hash, "string");
    assert.equal([...prepared.baseline.entries.keys()].some((entry) => entry.startsWith("node_modules/")), false);
    assert.equal([...prepared.baseline.entries.keys()].some((entry) => entry === "dist" || entry.startsWith("dist/")), false);
    const cache = path.join(prepared.workspaceRoot, "node_modules", ".cache");
    assert.equal((await fs.stat(cache)).mode & 0o777, 0o700);
    await fs.writeFile(path.join(cache, "tool.cache"), "cache\n");
    await fs.mkdir(path.join(prepared.workspaceRoot, "dist"));
    await fs.writeFile(path.join(prepared.workspaceRoot, "dist", "built.js"), "built\n");
    let after = await snapshotPreparedProducerWorkspace(prepared);
    assert.deepEqual(await captureProducerMerge({ workspaceRoot: prepared.workspaceRoot, baseline: prepared.baseline, after, writeScope: SCOPE }), []);
    await assert.rejects(fs.access(path.join(root, "dist", "built.js")));

    const support = path.join(prepared.workspaceRoot, "node_modules", "pkg", "index.js");
    const originalStat = await fs.stat(support);
    await fs.chmod(support, 0o644);
    await fs.writeFile(support, "changed\n");
    await fs.utimes(support, originalStat.atime, originalStat.mtime);
    await fs.chmod(support, originalStat.mode & 0o7777);
    after = await snapshotPreparedProducerWorkspace(prepared);
    await assert.rejects(
      () => captureProducerMerge({ workspaceRoot: prepared.workspaceRoot, baseline: prepared.baseline, after, writeScope: SCOPE }),
      ProducerMergeError,
    );
  } finally {
    await cleanupProducerWorkspace(prepared.workspaceRoot);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("custom support scope drives both collapsed snapshots without collapsing node_modules", async () => {
  const root = await fixture();
  await fs.mkdir(path.join(root, "vendor", "pkg"), { recursive: true });
  await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await fs.writeFile(path.join(root, "vendor", "pkg", "index.js"), "vendor\n");
  await fs.writeFile(path.join(root, "node_modules", "pkg", "index.js"), "module\n");
  const prepared = await prepareProducerWorkspace({
    repoRoot: root,
    writeScope: [...SCOPE, "node_modules/"],
    supportScope: ["vendor/"],
  });
  try {
    assert.deepEqual(prepared.supportScope, ["vendor/"]);
    assert.equal(typeof prepared.baseline.entries.get("vendor")?.hash, "string");
    assert.equal(prepared.baseline.entries.has("vendor/pkg/index.js"), false);
    assert.equal(prepared.baseline.entries.get("node_modules/pkg/index.js")?.kind, "file");
    await fs.readFile(path.join(prepared.workspaceRoot, "vendor", "pkg", "index.js"));
    const after = await snapshotPreparedProducerWorkspace(prepared);
    assert.deepEqual(workspaceDiff(prepared.baseline, after), []);
  } finally {
    await cleanupProducerWorkspace(prepared.workspaceRoot);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("an exact-file support collapse detects a same-size write with restored timestamps", async () => {
  const root = await fixture();
  await fs.writeFile(path.join(root, "tool.bin"), "aaaaaaaa");
  const prepared = await prepareProducerWorkspace({
    repoRoot: root,
    writeScope: SCOPE,
    supportScope: ["tool.bin"],
  });
  try {
    const target = path.join(prepared.workspaceRoot, "tool.bin");
    const original = await fs.stat(target);
    assert.equal(typeof prepared.baseline.entries.get("tool.bin")?.hash, "string");
    await fs.chmod(target, 0o644);
    await fs.writeFile(target, "bbbbbbbb");
    await fs.utimes(target, original.atime, original.mtime);
    await fs.chmod(target, original.mode & 0o7777);
    const after = await snapshotPreparedProducerWorkspace(prepared);
    await assert.rejects(
      () => captureProducerMerge({
        workspaceRoot: prepared.workspaceRoot,
        baseline: prepared.baseline,
        after,
        writeScope: SCOPE,
        supportScope: prepared.supportScope,
      }),
      ProducerMergeError,
    );
  } finally {
    await cleanupProducerWorkspace(prepared.workspaceRoot);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("source validation refuses aliases, hard links, authority, denied, and unclassified paths", async () => {
  const cases: Array<{ path: string; scope: string[]; make: (workspace: string, abs: string) => Promise<void> }> = [
    { path: "src/link", scope: ["src/"], make: async (_workspace, abs) => fs.symlink("target", abs) },
    { path: "src/fifo", scope: ["src/"], make: async (_workspace, abs) => { execFileSync("/usr/bin/mkfifo", [abs]); } },
    { path: "src/hard", scope: ["src/"], make: async (workspace, abs) => {
      await fs.writeFile(abs, "hard\n");
      await fs.link(abs, path.join(workspace, "src", "second"));
    } },
    { path: "AGENTS.md", scope: ["AGENTS.md"], make: async (_workspace, abs) => fs.writeFile(abs, "authority\n") },
    { path: ".git/config", scope: [".git/"], make: async (_workspace, abs) => {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, "denied\n");
    } },
    { path: "build/x", scope: ["src/"], make: async (_workspace, abs) => {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, "unclassified\n");
    } },
  ];
  for (const item of cases) {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-source-validation-"));
    await fs.mkdir(path.join(workspace, "src"), { recursive: true });
    const baseline = await snapshotTree(workspace, { policy: "workspace" });
    await item.make(workspace, path.join(workspace, ...item.path.split("/")));
    const after = await snapshotTree(workspace, { policy: "workspace" });
    await assert.rejects(
      () => captureProducerMerge({ workspaceRoot: workspace, baseline, after, writeScope: item.scope, supportScope: [] }),
      ProducerMergeError,
      item.path,
    );
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("destination validation rejects final and intermediate symlinks, hard links, and vanished-kind mismatches", async () => {
  const root = await fixture();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-destination-validation-"));
  try {
    await fs.symlink(path.join(outside, "target"), path.join(root, "src", "final"));
    await assert.rejects(() => resolveMergeDestinations({ repoRoot: root, captured: [captured("src/final", "changed", "file")] }), ProducerMergeError);

    await fs.mkdir(path.join(root, "src", "middle-real"));
    await fs.symlink(path.join(root, "src", "middle-real"), path.join(root, "src", "middle"));
    await assert.rejects(() => resolveMergeDestinations({ repoRoot: root, captured: [captured("src/middle/x", "appeared", "file")] }), ProducerMergeError);

    await fs.writeFile(path.join(root, "src", "hard"), "old\n");
    await fs.link(path.join(root, "src", "hard"), path.join(outside, "hard-alias"));
    await assert.rejects(() => resolveMergeDestinations({ repoRoot: root, captured: [captured("src/hard", "changed", "file")] }), ProducerMergeError);

    await fs.symlink("a.ts", path.join(root, "src", "gone-link"));
    await assert.rejects(() => resolveMergeDestinations({ repoRoot: root, captured: [captured("src/gone-link", "vanished", "file")] }), ProducerMergeError);
    await fs.mkdir(path.join(root, "src", "gone-dir"));
    await assert.rejects(() => resolveMergeDestinations({ repoRoot: root, captured: [captured("src/gone-dir", "vanished", "file")] }), ProducerMergeError);
    await fs.writeFile(path.join(root, "src", "gone-file"), "old\n");
    await assert.rejects(() => resolveMergeDestinations({ repoRoot: root, captured: [captured("src/gone-file", "vanished", "directory")] }), ProducerMergeError);
  } finally {
    await fs.rm(outside, { recursive: true, force: true });
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("planned topology admits complete directory plans and rejects missing or duplicate plans", async () => {
  const root = await fixture();
  try {
    const valid = [
      captured("src/new", "appeared", "directory", { mode: 0o755 }),
      captured("src/new/deep", "appeared", "directory", { mode: 0o755 }),
      captured("src/new/deep/file.ts", "appeared", "file", { bytes: Buffer.from("ok\n") }),
    ];
    const destinations = await resolveMergeDestinations({ repoRoot: root, captured: valid });
    await applyProducerMerge({ repoRoot: root, captured: valid, destinations });
    assert.equal(await fs.readFile(path.join(root, "src", "new", "deep", "file.ts"), "utf8"), "ok\n");

    await assert.rejects(
      () => resolveMergeDestinations({ repoRoot: root, captured: [captured("src/missing/deep/x", "appeared", "file")] }),
      ProducerMergeError,
    );
    await assert.rejects(
      () => resolveMergeDestinations({ repoRoot: root, captured: [captured("src/dup", "appeared", "directory"), captured("src/dup", "appeared", "directory")] }),
      ProducerMergeError,
    );

    const race = [captured("src/race", "appeared", "directory")];
    const raceDestinations = await resolveMergeDestinations({ repoRoot: root, captured: race });
    await fs.mkdir(path.join(root, "src", "race"));
    await assert.rejects(() => applyProducerMerge({ repoRoot: root, captured: race, destinations: raceDestinations }), ProducerMergeError);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("created modes are masked, replacements preserve live mode, and every existing mode delta refuses", async () => {
  const root = await fixture();
  try {
    await fs.chmod(path.join(root, "src", "a.ts"), 0o1640);
    const changes = [
      captured("src/mode-dir", "appeared", "directory", { mode: 0o7755 }),
      captured("src/mode-dir/new.ts", "appeared", "file", { mode: 0o6751, bytes: Buffer.from("new\n") }),
      captured("src/a.ts", "changed", "file", { mode: 0o777, bytes: Buffer.from("replacement\n"), fields: ["hash", "size"] }),
    ];
    const destinations = await resolveMergeDestinations({ repoRoot: root, captured: changes });
    await applyProducerMerge({ repoRoot: root, captured: changes, destinations });
    assert.equal((await fs.stat(path.join(root, "src", "mode-dir"))).mode & 0o7777, 0o755);
    assert.equal((await fs.stat(path.join(root, "src", "mode-dir", "new.ts"))).mode & 0o7777, 0o751);
    assert.equal((await fs.stat(path.join(root, "src", "a.ts"))).mode & 0o7777, 0o1640);

    const rejected = [captured("src/a.ts", "changed", "file", { bytes: Buffer.from("must-not-land\n") })];
    const rejectedDestinations = await resolveMergeDestinations({ repoRoot: root, captured: rejected });
    await assert.rejects(
      () => applyProducerMerge(
        { repoRoot: root, captured: rejected, destinations: rejectedDestinations },
        { afterFileChmod: (abs) => fs.chmod(abs, 0o640) },
      ),
      ProducerMergeError,
    );
    assert.equal(await fs.readFile(path.join(root, "src", "a.ts"), "utf8"), "replacement\n");
    assert.equal((await fs.stat(path.join(root, "src", "a.ts"))).mode & 0o7777, 0o1640);
    assert.equal((await fs.readdir(path.join(root, "src"))).some((name) => name.startsWith(".spartan-bridge-merge-")), false);

    for (const fields of [["mode"], ["hash", "mode"], ["size", "mode"]] as const) {
      const prepared = await prepareProducerWorkspace({ repoRoot: root, writeScope: ["src/"], supportScope: [] });
      try {
        const target = path.join(prepared.workspaceRoot, "src", "a.ts");
        if (fields.includes("hash")) await fs.writeFile(target, "content-and-mode\n");
        await fs.chmod(target, 0o744);
        const after = await snapshotTree(prepared.workspaceRoot, { policy: "workspace" });
        await assert.rejects(() => captureProducerMerge({ workspaceRoot: prepared.workspaceRoot, baseline: prepared.baseline, after, writeScope: ["src/"], supportScope: [] }), ProducerMergeError);
      } finally {
        await cleanupProducerWorkspace(prepared.workspaceRoot);
      }
    }
    await fs.mkdir(path.join(root, "src", "mode-existing"));
    for (const alsoChangeSize of [false, true]) {
      const prepared = await prepareProducerWorkspace({ repoRoot: root, writeScope: ["src/"], supportScope: [] });
      try {
        const directory = path.join(prepared.workspaceRoot, "src", "mode-existing");
        await fs.chmod(directory, 0o700);
        if (alsoChangeSize) await fs.writeFile(path.join(directory, "child"), "x");
        const after = await snapshotTree(prepared.workspaceRoot, { policy: "workspace" });
        await assert.rejects(() => captureProducerMerge({ workspaceRoot: prepared.workspaceRoot, baseline: prepared.baseline, after, writeScope: ["src/"], supportScope: [] }), ProducerMergeError);
      } finally {
        await cleanupProducerWorkspace(prepared.workspaceRoot);
      }
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("the exact-file scope deletes and replaces only the named leaf while sibling creation refuses", async () => {
  const root = await fixture();
  const exact = ["agent-skill/skills/spbridge/SKILL.md"];
  let prepared = await prepareProducerWorkspace({ repoRoot: root, writeScope: exact, supportScope: [] });
  try {
    for (const ancestor of ["agent-skill", "agent-skill/skills", "agent-skill/skills/spbridge"]) {
      assert.equal(prepared.baseline.entries.get(ancestor)?.mode, (await fs.stat(path.join(root, ...ancestor.split("/")))).mode & 0o7777);
    }
    await assert.rejects(fs.access(path.join(prepared.workspaceRoot, "agent-skill", "skills", "spbridge", "agents")));
    await fs.rm(path.join(prepared.workspaceRoot, ...exact[0]!.split("/")));
    let after = await snapshotTree(prepared.workspaceRoot, { policy: "workspace" });
    let changes = await captureProducerMerge({ workspaceRoot: prepared.workspaceRoot, baseline: prepared.baseline, after, writeScope: exact, supportScope: [] });
    assert.deepEqual(changes.map((entry) => entry.path), exact);
    await applyProducerMerge({ repoRoot: root, captured: changes, destinations: await resolveMergeDestinations({ repoRoot: root, captured: changes }) });
    await assert.rejects(fs.access(path.join(root, ...exact[0]!.split("/"))));
  } finally {
    await cleanupProducerWorkspace(prepared.workspaceRoot);
  }

  await fs.writeFile(path.join(root, ...exact[0]!.split("/")), "restored\n");
  prepared = await prepareProducerWorkspace({ repoRoot: root, writeScope: exact, supportScope: [] });
  try {
    await fs.writeFile(path.join(prepared.workspaceRoot, ...exact[0]!.split("/")), "replaced\n");
    let after = await snapshotTree(prepared.workspaceRoot, { policy: "workspace" });
    let changes = await captureProducerMerge({ workspaceRoot: prepared.workspaceRoot, baseline: prepared.baseline, after, writeScope: exact, supportScope: [] });
    await applyProducerMerge({ repoRoot: root, captured: changes, destinations: await resolveMergeDestinations({ repoRoot: root, captured: changes }) });
    assert.equal(await fs.readFile(path.join(root, ...exact[0]!.split("/")), "utf8"), "replaced\n");
    await fs.writeFile(path.join(prepared.workspaceRoot, "agent-skill", "skills", "spbridge", "NEW.md"), "no\n");
    after = await snapshotTree(prepared.workspaceRoot, { policy: "workspace" });
    await assert.rejects(() => captureProducerMerge({ workspaceRoot: prepared.workspaceRoot, baseline: prepared.baseline, after, writeScope: exact, supportScope: [] }), ProducerMergeError);
  } finally {
    await cleanupProducerWorkspace(prepared.workspaceRoot);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("replacement temporaries are journal-owned and pre-existing merge temporaries refuse validation", async () => {
  const root = await fixture();
  const change = captured("src/a.ts", "changed", "file", { bytes: Buffer.from("replacement\n") });
  try {
    let destinations = await resolveMergeDestinations({ repoRoot: root, captured: [change] });
    await assert.rejects(
      () => applyProducerMerge({ repoRoot: root, captured: [change], destinations, runId: "temporary" }, { afterTemporaryCreated: () => { throw new Error("injected"); } }),
      ProducerMergeError,
    );
    assert.equal(await fs.readFile(path.join(root, "src", "a.ts"), "utf8"), "one\n");
    assert.equal((await fs.readdir(path.join(root, "src"))).some((name) => name.startsWith(".spartan-bridge-merge-")), false);
    await fs.writeFile(path.join(root, "src", ".spartan-bridge-merge-leftover.tmp"), "leftover\n");
    await assert.rejects(() => resolveMergeDestinations({ repoRoot: root, captured: [change] }), ProducerMergeError);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("directory topology is applied parent-first, deleted child-first, and non-empty deletion rolls back", async () => {
  const root = await fixture();
  try {
    let changes = [captured("src/tree", "appeared", "directory", { mode: 0o1750 }), captured("src/tree/x", "appeared", "file")];
    await applyProducerMerge({ repoRoot: root, captured: changes, destinations: await resolveMergeDestinations({ repoRoot: root, captured: changes }) });
    assert.equal((await fs.stat(path.join(root, "src", "tree"))).mode & 0o7777, 0o750);
    changes = [captured("src/tree/x", "vanished", "file"), captured("src/tree", "vanished", "directory")];
    await applyProducerMerge({ repoRoot: root, captured: changes, destinations: await resolveMergeDestinations({ repoRoot: root, captured: changes }) });
    await assert.rejects(fs.access(path.join(root, "src", "tree")));

    await fs.mkdir(path.join(root, "src", "busy"));
    await fs.writeFile(path.join(root, "src", "busy", "known"), "known\n");
    const busy = [captured("src/busy/known", "vanished", "file"), captured("src/busy", "vanished", "directory")];
    const destinations = await resolveMergeDestinations({ repoRoot: root, captured: busy });
    await fs.writeFile(path.join(root, "src", "busy", "unseen"), "unseen\n");
    await assert.rejects(() => applyProducerMerge({ repoRoot: root, captured: busy, destinations }), ProducerMergeError);
    assert.equal(await fs.readFile(path.join(root, "src", "busy", "known"), "utf8"), "known\n");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rollback restores existing special modes, nested deleted directories, and reports unrestored entries", async () => {
  async function makeNested(): Promise<string> {
    const root = await fixture();
    await fs.mkdir(path.join(root, "src", "a", "b"), { recursive: true, mode: 0o750 });
    await fs.mkdir(path.join(root, "src", "z"), { mode: 0o700 });
    await fs.chmod(path.join(root, "src", "a"), 0o1750);
    await fs.chmod(path.join(root, "src", "a", "b"), 0o1750);
    return root;
  }
  let root = await fixture();
  await fs.chmod(path.join(root, "src", "a.ts"), 0o1640);
  let changes = [
    captured("src/a.ts", "changed", "file", { bytes: Buffer.from("replacement\n") }),
    captured("src/new.ts", "appeared", "file"),
  ];
  let destinations = await resolveMergeDestinations({ repoRoot: root, captured: changes });
  await assert.rejects(
    () => applyProducerMerge(
      { repoRoot: root, captured: changes, destinations },
      { beforeEntry: (_entry, index) => { if (index === 1) throw new Error("injected"); } },
    ),
    ProducerMergeError,
  );
  assert.equal(await fs.readFile(path.join(root, "src", "a.ts"), "utf8"), "one\n");
  assert.equal((await fs.stat(path.join(root, "src", "a.ts"))).mode & 0o7777, 0o1640);
  await fs.rm(root, { recursive: true, force: true });

  root = await fixture();
  await fs.mkdir(path.join(root, "src", "z"));
  await fs.chmod(path.join(root, "src", "a.ts"), 0o1640);
  changes = [
    captured("src/a.ts", "vanished", "file"),
    captured("src/z", "vanished", "directory"),
  ];
  destinations = await resolveMergeDestinations({ repoRoot: root, captured: changes });
  await assert.rejects(
    () => applyProducerMerge(
      { repoRoot: root, captured: changes, destinations },
      {
        beforeEntry: (_entry, index) => { if (index === 1) throw new Error("injected"); },
        afterFileChmod: (abs) => abs.includes(".rollback-") ? fs.chmod(abs, 0o640) : undefined,
      },
    ),
    (error: unknown) => error instanceof ProducerMergeError
      && error.reason === "runtime_state_violation"
      && error.unrestored.includes("src/a.ts"),
  );
  await assert.rejects(fs.access(path.join(root, "src", "a.ts")));
  assert.equal((await fs.readdir(path.join(root, "src"))).some((name) => name.includes(".rollback-")), false);
  await fs.rm(root, { recursive: true, force: true });

  changes = [
    captured("src/a/b", "vanished", "directory"),
    captured("src/a", "vanished", "directory"),
    captured("src/z", "vanished", "directory"),
  ];
  root = await makeNested();
  destinations = await resolveMergeDestinations({ repoRoot: root, captured: changes });
  await assert.rejects(
    () => applyProducerMerge({ repoRoot: root, captured: changes, destinations }, { beforeEntry: (_entry, index) => { if (index === 2) throw new Error("injected"); } }),
    ProducerMergeError,
  );
  assert.equal((await fs.stat(path.join(root, "src", "a", "b"))).isDirectory(), true);
  assert.equal((await fs.stat(path.join(root, "src", "a"))).mode & 0o7777, 0o1750);
  assert.equal((await fs.stat(path.join(root, "src", "a", "b"))).mode & 0o7777, 0o1750);
  await fs.rm(root, { recursive: true, force: true });

  root = await makeNested();
  destinations = await resolveMergeDestinations({ repoRoot: root, captured: changes });
  await assert.rejects(
    () => applyProducerMerge({ repoRoot: root, captured: changes, destinations }, {
      beforeEntry: (_entry, index) => { if (index === 2) throw new Error("injected"); },
      rollbackEntry: (entry) => { if (entry.path === "src/a/b") throw new Error("rollback injected"); },
    }),
    (error: unknown) => error instanceof ProducerMergeError && error.reason === "runtime_state_violation" && error.unrestored.includes("src/a/b"),
  );
  await fs.rm(root, { recursive: true, force: true });
});

test("merge entry and combined source-plus-undo byte caps refuse before a live write", async () => {
  const root = await fixture();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-cap-workspace-"));
  try {
    await fs.mkdir(path.join(workspace, "src"));
    const baseline = await snapshotTree(workspace, { policy: "workspace" });
    for (let index = 0; index <= PRODUCER_MERGE_ENTRY_CAP; index += 1) {
      await fs.writeFile(path.join(workspace, "src", `${index}.ts`), "x");
    }
    const after = await snapshotTree(workspace, { policy: "workspace" });
    await assert.rejects(() => captureProducerMerge({ workspaceRoot: workspace, baseline, after, writeScope: ["src/"], supportScope: [] }), ProducerMergeError);

    const oversizedSource = path.join(workspace, "src", "oversized.ts");
    await fs.writeFile(oversizedSource, "");
    await fs.truncate(oversizedSource, PRODUCER_MERGE_BYTE_CAP + 1);
    const oversizedStat = await fs.stat(oversizedSource);
    const oversizedAfter = { entries: new Map(baseline.entries) };
    oversizedAfter.entries.set("src/oversized.ts", {
      rel: "src/oversized.ts",
      kind: "file",
      mode: oversizedStat.mode & 0o7777,
      size: oversizedStat.size,
      hash: "oversized",
    });
    let sourceReadAttempted = false;
    await assert.rejects(
      () => captureProducerMerge(
        { workspaceRoot: workspace, baseline, after: oversizedAfter, writeScope: ["src/"], supportScope: [] },
        { beforeFileRead: () => { sourceReadAttempted = true; } },
      ),
      ProducerMergeError,
    );
    assert.equal(sourceReadAttempted, false);

    const sourceSize = PRODUCER_MERGE_BYTE_CAP - 1024;
    await fs.writeFile(path.join(root, "src", "large"), Buffer.alloc(2048));
    const before = await fs.readFile(path.join(root, "src", "a.ts"), "utf8");
    await assert.rejects(
      () => resolveMergeDestinations({ repoRoot: root, captured: [captured("src/large", "changed", "file", { bytes: Buffer.alloc(sourceSize) })] }),
      ProducerMergeError,
    );
    await fs.truncate(path.join(root, "src", "large"), PRODUCER_MERGE_BYTE_CAP + 1);
    let undoReadAttempted = false;
    await assert.rejects(
      () => resolveMergeDestinations(
        { repoRoot: root, captured: [captured("src/large", "changed", "file")] },
        { beforeFileRead: () => { undoReadAttempted = true; } },
      ),
      ProducerMergeError,
    );
    assert.equal(undoReadAttempted, false);
    assert.equal(await fs.readFile(path.join(root, "src", "a.ts"), "utf8"), before);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("producer snapshots detect skipped-tree writes even when size and mtime are restored", async () => {
  for (const skipped of ["node_modules", ".venv"]) {
    const root = await fixture();
    const target = path.join(root, skipped, "pkg", "x");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "before\n");
    const aliasDir = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-hardlink-alias-"));
    const alias = path.join(aliasDir, "alias");
    await fs.link(target, alias);
    const before = await snapshotTree(root, { policy: "producer" });
    await fs.writeFile(alias, "longer-after\n");
    const after = await snapshotTree(root, { policy: "producer" });
    const diff = workspaceDiff(before, after);
    assert.equal(diff.length, 1, skipped);
    assert.equal(diff[0]?.path, skipped);
    assert.equal(diff[0]?.fields.includes("hash"), true);
    assert.equal(producerPathDenied(diff[0]!.path), true);

    const stable = await fs.stat(target);
    const timestampReference = path.join(aliasDir, "timestamp-reference");
    execFileSync("/bin/cp", ["-p", target, timestampReference]);
    const beforeResidual = await snapshotTree(root, { policy: "producer" });
    await fs.writeFile(alias, Buffer.alloc(stable.size, 0x78));
    execFileSync("/usr/bin/touch", ["-r", timestampReference, alias]);
    const afterResidual = await snapshotTree(root, { policy: "producer" });
    const restoredDiff = workspaceDiff(beforeResidual, afterResidual);
    assert.equal(restoredDiff.length, 1, skipped);
    assert.equal(restoredDiff[0]?.path, skipped);
    assert.deepEqual(restoredDiff[0]?.fields, ["hash"]);
    await fs.rm(aliasDir, { recursive: true, force: true });
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("producer-policy metadata digest detects a ctime-only hard-link count change inside a skipped tree", async () => {
  const root = await fixture();
  const target = path.join(root, "node_modules", "pkg", "x");
  const aliasDir = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-ctime-alias-"));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, "same\n");
  const before = await snapshotTree(root, { policy: "producer" });
  await fs.link(target, path.join(aliasDir, "alias"));
  const after = await snapshotTree(root, { policy: "producer" });
  assert.deepEqual(workspaceDiff(before, after), [
    { path: "node_modules", change: "changed", fields: ["hash"] },
  ]);
  await fs.rm(aliasDir, { recursive: true, force: true });
  await fs.rm(root, { recursive: true, force: true });
});

test("real sandbox denies live and /tmp writes, permits workspace writes, and inherits across setsid", async (t) => {
  assert.equal(process.platform, "darwin");
  const root = await fixture();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-sandbox-workspace-"));
  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-sandbox-tmpdir-"));
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-sandbox-home-"));
  await fs.writeFile(path.join(root, "src", "link-source"), "r\n");
  await fs.writeFile(path.join(tmpdir, "link-source"), "t\n");
  await fs.writeFile(path.join(workspace, "link-source"), "w\n");
  await fs.mkdir(path.join(root, "build"));
  await fs.symlink(`/tmp/spartan-denied-alias-${process.pid}`, path.join(root, "build", "out"));
  const guard = await applyProducerIsolation(root, workspace, { HOME: home, TMPDIR: tmpdir });
  const script = `
    const fs = require("node:fs"); const cp = require("node:child_process");
    for (const [name, p] of [["repo", ${JSON.stringify(path.join(root, "src", "x"))}], ["tmp", "/tmp/spartan-denied"], ["alias", ${JSON.stringify(path.join(root, "build", "out"))}], ["work", ${JSON.stringify(path.join(workspace, "ok"))}]]) {
      try { fs.writeFileSync(p, "x"); process.stderr.write(name + ":OK\\n"); } catch (e) { process.stderr.write(name + ":" + e.code + "\\n"); }
    }
    for (const [name, from, to] of [
      ["r-home", ${JSON.stringify(path.join(root, "src", "link-source"))}, ${JSON.stringify(path.join(home, "linked"))}],
      ["tmp-r", ${JSON.stringify(path.join(tmpdir, "link-source"))}, ${JSON.stringify(path.join(root, "src", "linked"))}],
      ["w-w", ${JSON.stringify(path.join(workspace, "link-source"))}, ${JSON.stringify(path.join(workspace, "linked"))}],
    ]) { try { fs.linkSync(from, to); process.stderr.write(name + ":OK\\n"); } catch (e) { process.stderr.write(name + ":" + e.code + "\\n"); } }
    const child = cp.spawnSync(process.execPath, ["-e", ${JSON.stringify(`const fs=require("node:fs");for(const [n,p] of [["r",${JSON.stringify(path.join(root, "src", "grandchild"))}],["w",${JSON.stringify(path.join(workspace, "grandchild"))}]]){try{fs.writeFileSync(p,"x");process.stderr.write(n+":OK\\n")}catch(e){process.stderr.write(n+":"+e.code+"\\n")}}`)}], {detached:true, encoding:"utf8"});
    process.stderr.write(child.stderr.replace(/^.+$/gm, (line) => "grandchild:" + line));
  `;
  const outcome = await createNodeProcessRunner().start({ executable: process.execPath, args: ["-e", script], cwd: workspace, env: { PATH: process.env.PATH ?? "" }, timeoutMs: 5000, stdoutCapBytes: 1024, sandboxProfile: guard.sandboxProfile }).wait();
  const stderr = outcome.stderr.toString();
  if (outcome.exitCode === 71 && stderr.includes("sandbox_apply") && await sandboxExecProfileUnavailable()) {
    t.skip("the enclosing sandbox cannot apply even a known-good nested profile");
    await Promise.all([root, workspace, tmpdir, home].map((item) => fs.rm(item, { recursive: true, force: true })));
    return;
  }
  assert.match(stderr, /repo:EPERM/);
  assert.match(stderr, /tmp:EPERM/);
  assert.match(stderr, /alias:EPERM/);
  assert.match(stderr, /work:OK/);
  assert.match(stderr, /r-home:EPERM/);
  assert.match(stderr, /tmp-r:EPERM/);
  assert.match(stderr, /w-w:OK/);
  assert.match(stderr, /grandchild:r:EPERM/);
  assert.match(stderr, /grandchild:w:OK/);
  const aliasTarget = `/tmp/spartan-denied-alias-${process.pid}`;
  const legacyProfile = `(version 1)\n(allow default)\n(deny file-write* (subpath "${root}"))\n`;
  const legacy = await createNodeProcessRunner().start({
    executable: process.execPath,
    args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(path.join(root, "build", "out"))}, "legacy")`],
    cwd: workspace,
    env: { PATH: process.env.PATH ?? "" },
    timeoutMs: 5000,
    stdoutCapBytes: 1024,
    sandboxProfile: legacyProfile,
  }).wait();
  assert.equal(legacy.exitCode, 0, legacy.stderr.toString());
  assert.equal(await fs.readFile(aliasTarget, "utf8"), "legacy");
  await fs.rm(aliasTarget, { force: true });
  await Promise.all([root, workspace, tmpdir, home].map((item) => fs.rm(item, { recursive: true, force: true })));
});
