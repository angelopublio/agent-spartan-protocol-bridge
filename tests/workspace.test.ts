import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  lstatSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sha256Bytes } from "../src/core/serialize.ts";
import { unicodeDefaultCaseFold } from "../src/core/unicode-casefold.ts";
import {
  SNAPSHOT_HASH_FILE_CAP,
  snapshotTree,
  snapshotDiffers,
  SnapshotCapError,
} from "../src/core/snapshot.ts";
import { WORKSPACE_MANIFEST_FILE } from "../src/runtime/store.ts";
import {
  GIT_EXECUTABLE,
  PATCH_BYTE_CAP,
  ReviewerIsolationUnavailableError,
  cleanupReviewWorkspace,
  parseGitPathBytes,
  prepareReviewWorkspace,
  recordImplementationReviewEnvelope,
  reviewerObjectDatabasePath,
  reviewerWorkspacePath,
  validateRepositoryPath,
  workspaceSafeOpenFlags,
  type GitSpawnRequest,
  type PreparedWorkspace,
} from "../src/core/workspace.ts";

const ZERO = "0000000000000000000000000000000000000000";
const FIXTURE_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  ...(typeof process.env.HOME === "string" ? { HOME: process.env.HOME } : {}),
  ...(typeof process.env.TMPDIR === "string" ? { TMPDIR: process.env.TMPDIR } : {}),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

async function repoGit(cwd: string, args: readonly string[], stdin?: Uint8Array): Promise<Buffer> {
  return spawnGit({
    args,
    cwd,
    env: FIXTURE_ENV,
    stdin,
    stdoutCap: 32 * 1024 * 1024,
    timeoutMs: 60_000,
  });
}

function spawnGit(request: GitSpawnRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(GIT_EXECUTABLE, [...request.args], {
      cwd: request.cwd,
      env: request.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    let stdout = Buffer.alloc(0);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = Buffer.concat([stdout, chunk]);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`git ${request.args.join(" ")} exited ${code}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin?.end(request.stdin ? Buffer.from(request.stdin) : Buffer.alloc(0));
  });
}

async function makeGitRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-ws-repo-"));
  await repoGit(root, ["init", "-b", "main", "-q"]);
  await repoGit(root, ["config", "user.email", "t@t.invalid"]);
  await repoGit(root, ["config", "user.name", "t"]);
  await repoGit(root, ["config", "core.autocrlf", "false"]);
  return root;
}

async function commitAll(root: string, message: string): Promise<void> {
  await repoGit(root, ["add", "-A"]);
  await repoGit(root, ["commit", "-qm", message, "--allow-empty"]);
}

async function withRunDir<T>(fn: (runDir: string) => Promise<T>): Promise<T> {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-ws-run-"));
  try {
    return await fn(runDir);
  } finally {
    await fs.rm(runDir, { recursive: true, force: true });
  }
}

async function prepare(
  repoRoot: string,
  scope: readonly string[],
  git?: (request: GitSpawnRequest) => Promise<Buffer>,
): Promise<{ prepared: PreparedWorkspace; runDir: string }> {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-ws-run-"));
  const prepared = await prepareReviewWorkspace({ repoRoot, runDir, scope }, git ? { git } : {});
  return { prepared, runDir };
}

async function writeFile(root: string, rel: string, contents: string | Uint8Array): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, contents);
}

function worktreeFile(prepared: PreparedWorkspace, rel: string): string {
  return path.join(prepared.workspaceRoot, "worktree", rel);
}

async function readUtf8(abs: string): Promise<string> {
  return fs.readFile(abs, "utf8");
}

function modeOf(abs: string): number {
  return lstatSync(abs).mode & 0o777;
}

async function listRegularFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(abs: string, rel: string): Promise<void> {
    const names = await fs.readdir(abs);
    for (const name of names) {
      const childAbs = path.join(abs, name);
      const childRel = rel.length === 0 ? name : `${rel}/${name}`;
      const stat = lstatSync(childAbs);
      assert.equal(stat.isSymbolicLink(), false, childRel);
      if (stat.isDirectory()) {
        await walk(childAbs, childRel);
        continue;
      }
      assert.equal(stat.isFile(), true, childRel);
      files.push(childRel);
    }
  }
  await walk(root, "");
  return files.sort();
}

async function removePrepared(runDir: string): Promise<void> {
  await cleanupReviewWorkspace(runDir);
  await fs.rm(runDir, { recursive: true, force: true });
}

function changeLine(status: string, posix: string): string {
  return `${status}\t${JSON.stringify(posix)}\n`;
}

function argMaxBytes(): number {
  const raw = execFileSync("getconf", ["ARG_MAX"], { encoding: "utf8" }).trim();
  const value = Number(raw);
  assert.equal(Number.isInteger(value) && value > 0, true, raw);
  return value;
}

function restoreNsTimestamps(abs: string, from: { atimeNs: bigint; mtimeNs: bigint }): void {
  const result = spawnSync(
    "python3",
    [
      "-c",
      "import os, sys; os.utime(sys.argv[1], ns=(int(sys.argv[2]), int(sys.argv[3])))",
      abs,
      from.atimeNs.toString(),
      from.mtimeNs.toString(),
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || "utime failed");
  }
}

async function snapshotObjectStore(repoRoot: string): Promise<Map<string, string>> {
  const common = (await repoGit(repoRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]))
    .toString("utf8")
    .trim();
  const objects = path.join(common, "objects");
  const map = new Map<string, string>();
  async function walk(abs: string, rel: string): Promise<void> {
    let names: string[];
    try {
      names = await fs.readdir(abs);
    } catch {
      return;
    }
    for (const name of names) {
      const childAbs = path.join(abs, name);
      const childRel = rel.length === 0 ? name : `${rel}/${name}`;
      const stat = lstatSync(childAbs);
      if (stat.isDirectory()) {
        await walk(childAbs, childRel);
        continue;
      }
      if (stat.isFile()) {
        map.set(childRel, sha256Bytes(new Uint8Array(await fs.readFile(childAbs))));
      }
    }
  }
  await walk(objects, "");
  return map;
}

async function buildSevenRowRepo(): Promise<{ root: string; scope: string[] }> {
  const root = await makeGitRepo();
  await writeFile(root, "src/modified.txt", "a\n");
  await writeFile(root, "src/binary.bin", Buffer.from("\x00\x01\x02binary\n"));
  await writeFile(root, "src/mode.sh", "#!/bin/sh\n");
  await writeFile(root, "src/unchanged.txt", "x\n");
  await writeFile(root, "src/deleted.txt", "d\n");
  await writeFile(root, "src/uncached.txt", "c\n");
  await writeFile(root, "src/git-rm.txt", "r\n");
  await writeFile(root, "src/renamed-from.txt", "from\n");
  await writeFile(root, "src/diff.patch", "product-patch\n");
  await writeFile(root, "src/changes.txt", "product-changes\n");
  await writeFile(root, "node_modules/pkg/index.js", "tracked-nm\n");
  await writeFile(root, ".spartan-bridge/kept.txt", "tracked-sb\n");
  await writeFile(root, "private/secret.txt", "out-of-scope\n");
  await writeFile(root, ".gitignore", "src/.env.local\nignored-out.txt\n");
  await repoGit(root, ["add", "-A"]);
  await repoGit(root, ["add", "-f", "node_modules/pkg/index.js", ".spartan-bridge/kept.txt"]);
  await repoGit(root, ["commit", "-qm", "base"]);

  await writeFile(root, "src/modified.txt", "a\nb\n");
  await writeFile(root, "src/binary.bin", Buffer.from("\x00\x01\x03BINARY\n"));
  await fs.chmod(path.join(root, "src/mode.sh"), 0o755);
  await fs.rm(path.join(root, "src/deleted.txt"));
  await writeFile(root, "src/index-added.txt", "new\n");
  await repoGit(root, ["add", "src/index-added.txt"]);
  await writeFile(root, "src/staged-then-removed.txt", "ghost\n");
  await repoGit(root, ["add", "src/staged-then-removed.txt"]);
  await fs.rm(path.join(root, "src/staged-then-removed.txt"));
  await writeFile(root, "src/untracked.txt", "u\n");
  await writeFile(root, "src/.env.local", "ignored-untracked\n");
  await writeFile(root, "ignored-out.txt", "ignored-outside\n");
  await repoGit(root, ["rm", "-q", "--cached", "src/uncached.txt"]);
  await repoGit(root, ["rm", "-q", "src/git-rm.txt"]);
  await repoGit(root, ["mv", "src/renamed-from.txt", "src/renamed-to.txt"]);
  return {
    root,
    scope: ["src/", "node_modules/", ".spartan-bridge/"],
  };
}

test("path grammar refuses unsafe components and admits NFC names", () => {
  assert.equal(validateRepositoryPath("src/a.ts"), "src/a.ts");
  assert.equal(validateRepositoryPath("é.txt"), "é.txt");
  assert.equal(validateRepositoryPath("src/ß.txt"), "src/ß.txt");
  for (const bad of ["", ".", "..", "/abs", "a/../b", "a/./b", "a\\b", "src/.git/x", "src/.GIT/x", "e\u0301.txt"]) {
    assert.throws(() => validateRepositoryPath(bad), ReviewerIsolationUnavailableError);
  }
  assert.throws(() => parseGitPathBytes(Buffer.from([0xff, 0x2e, 0x74, 0x78, 0x74])), ReviewerIsolationUnavailableError);
  assert.throws(() => parseGitPathBytes(Buffer.from("/tmp/x")), ReviewerIsolationUnavailableError);
  const bomPath = "\uFEFFkeep.txt";
  const bomBytes = Buffer.from([0xef, 0xbb, 0xbf, 0x6b, 0x65, 0x65, 0x70, 0x2e, 0x74, 0x78, 0x74]);
  assert.equal(parseGitPathBytes(bomBytes), bomPath);
  assert.notEqual(parseGitPathBytes(bomBytes), "keep.txt");
  assert.throws(() => workspaceSafeOpenFlags("linux"), ReviewerIsolationUnavailableError);
  const flags = workspaceSafeOpenFlags("darwin");
  assert.equal((flags & 0x20000000) !== 0, true);
});

test("D1 Unicode default casefold refuses a nontrivial admitted-path collision", async () => {
  assert.notEqual("ß".toLocaleLowerCase("en-US"), "ss".toLocaleLowerCase("en-US"));
  assert.equal(unicodeDefaultCaseFold("ß"), "ss");
  assert.equal(unicodeDefaultCaseFold("ß"), unicodeDefaultCaseFold("ss"));
  assert.equal(unicodeDefaultCaseFold(".GIT"), ".git");

  const root = await makeGitRepo();
  await writeFile(root, "src/keep.txt", "keep\n");
  await commitAll(root, "base");
  const oid = (await repoGit(root, ["rev-parse", "HEAD:src/keep.txt"])).toString("utf8").trim();
  const colliding = Buffer.concat([
    Buffer.from(`100644 blob ${oid}\tsrc/ss.txt\0`, "utf8"),
    Buffer.from(`100644 blob ${oid}\tsrc/ß.txt\0`, "utf8"),
  ]);
  await withRunDir(async (runDir) => {
    await assert.rejects(
      () =>
        prepareReviewWorkspace(
          { repoRoot: root, runDir, scope: ["src/"] },
          {
            git: async (request) => {
              if (request.args.includes("ls-tree")) {
                const real = await spawnGit(request);
                return Buffer.concat([real, colliding]);
              }
              return spawnGit(request);
            },
          },
        ),
      ReviewerIsolationUnavailableError,
    );
  });
  await fs.rm(root, { recursive: true, force: true });
});

test("D1 seven-row agreement, ignore independence, and generated-name coexistence", async () => {
  const { root, scope } = await buildSevenRowRepo();
  const objectsBefore = await snapshotObjectStore(root);
  const { prepared, runDir } = await prepare(root, scope);
  const objectsAfter = await snapshotObjectStore(root);
  assert.deepEqual(objectsAfter, objectsBefore);

  const changes = await readUtf8(path.join(prepared.workspaceRoot, "changes.txt"));
  const patch = await readUtf8(path.join(prepared.workspaceRoot, "diff.patch"));
  const files = await listRegularFiles(prepared.workspaceRoot);

  assert.equal(files.includes("diff.patch"), true);
  assert.equal(files.includes("changes.txt"), true);
  assert.equal(await readUtf8(worktreeFile(prepared, "src/diff.patch")), "product-patch\n");
  assert.equal(await readUtf8(worktreeFile(prepared, "src/changes.txt")), "product-changes\n");

  assert.equal(await readUtf8(worktreeFile(prepared, "src/modified.txt")), "a\nb\n");
  assert.equal(await readUtf8(worktreeFile(prepared, "src/unchanged.txt")), "x\n");
  assert.equal(await readUtf8(worktreeFile(prepared, "src/uncached.txt")), "c\n");
  assert.equal(await readUtf8(worktreeFile(prepared, "src/untracked.txt")), "u\n");
  assert.equal(await readUtf8(worktreeFile(prepared, "src/.env.local")), "ignored-untracked\n");
  assert.equal(await readUtf8(worktreeFile(prepared, "src/index-added.txt")), "new\n");
  assert.equal(await readUtf8(worktreeFile(prepared, "src/renamed-to.txt")), "from\n");
  assert.equal(await readUtf8(worktreeFile(prepared, "node_modules/pkg/index.js")), "tracked-nm\n");
  assert.equal(await readUtf8(worktreeFile(prepared, ".spartan-bridge/kept.txt")), "tracked-sb\n");

  await assert.rejects(() => fs.access(worktreeFile(prepared, "src/deleted.txt")), { code: "ENOENT" });
  await assert.rejects(() => fs.access(worktreeFile(prepared, "src/git-rm.txt")), { code: "ENOENT" });
  await assert.rejects(() => fs.access(worktreeFile(prepared, "src/staged-then-removed.txt")), { code: "ENOENT" });
  await assert.rejects(() => fs.access(worktreeFile(prepared, "src/renamed-from.txt")), { code: "ENOENT" });
  await assert.rejects(() => fs.access(worktreeFile(prepared, "private/secret.txt")), { code: "ENOENT" });
  await assert.rejects(() => fs.access(worktreeFile(prepared, "ignored-out.txt")), { code: "ENOENT" });

  assert.match(changes, /^base [0-9a-f]{40}\n/);
  assert.equal(changes.includes(changeLine("modified", "src/modified.txt")), true);
  assert.equal(changes.includes("src/unchanged.txt"), false);
  assert.equal(changes.includes(changeLine("deleted", "src/deleted.txt")), true);
  assert.equal(changes.includes(changeLine("removed-from-index", "src/uncached.txt")), true);
  assert.equal(changes.includes(changeLine("deleted", "src/git-rm.txt")), true);
  assert.equal(changes.includes(changeLine("added", "src/index-added.txt")), true);
  assert.equal(changes.includes(changeLine("added-then-removed", "src/staged-then-removed.txt")), true);
  assert.equal(changes.includes(changeLine("untracked", "src/untracked.txt")), true);
  assert.equal(changes.includes(changeLine("untracked", "src/.env.local")), true);
  assert.equal(changes.includes(changeLine("deleted", "src/renamed-from.txt")), true);
  assert.equal(changes.includes(changeLine("added", "src/renamed-to.txt")), true);
  assert.equal(changes.includes("private/secret"), false);

  assert.match(patch, /^diff --git a\/src\/modified\.txt b\/src\/modified\.txt$/m);
  assert.equal(patch.includes("src/unchanged.txt"), false);
  assert.match(patch, /^diff --git a\/src\/deleted\.txt b\/src\/deleted\.txt$/m);
  assert.match(patch, /^diff --git a\/src\/uncached\.txt b\/src\/uncached\.txt$/m);
  assert.match(patch, /^diff --git a\/src\/git-rm\.txt b\/src\/git-rm\.txt$/m);
  assert.match(patch, /^diff --git a\/src\/index-added\.txt b\/src\/index-added\.txt$/m);
  assert.equal(patch.includes("src/staged-then-removed.txt"), false);
  assert.equal(patch.includes("src/untracked.txt"), false);
  assert.equal(patch.includes("src/.env.local"), false);
  assert.match(patch, /^diff --git a\/src\/binary\.bin b\/src\/binary\.bin$/m);
  assert.match(patch, /^diff --git a\/src\/mode\.sh b\/src\/mode\.sh$/m);
  assert.match(patch, /old mode 100644/);
  assert.match(patch, /new mode 100755/);
  assert.match(patch, /^diff --git a\/src\/renamed-from\.txt b\/src\/renamed-from\.txt$/m);
  assert.match(patch, /^diff --git a\/src\/renamed-to\.txt b\/src\/renamed-to\.txt$/m);

  const manifestPaths = prepared.manifest.entries.map((entry) => entry.path).sort();
  assert.equal(manifestPaths.includes("diff.patch"), true);
  assert.equal(manifestPaths.includes("changes.txt"), true);
  assert.equal(manifestPaths.includes("worktree/src/modified.txt"), true);
  assert.equal(manifestPaths.includes("worktree/node_modules/pkg/index.js"), true);
  assert.equal(manifestPaths.includes("worktree/.spartan-bridge/kept.txt"), true);
  assert.equal(
    prepared.manifest.entries.find((entry) => entry.path === "diff.patch")?.kind,
    "patch",
  );
  assert.equal(
    prepared.manifest.entries.find((entry) => entry.path === "changes.txt")?.kind,
    "change-list",
  );
  assert.equal(
    prepared.manifest.entries.find((entry) => entry.path === "worktree/src/modified.txt")?.kind,
    "product",
  );

  assert.equal(modeOf(path.join(prepared.workspaceRoot, "diff.patch")), 0o444);
  assert.equal(modeOf(prepared.workspaceRoot), 0o555);
  assert.equal(modeOf(path.join(prepared.workspaceRoot, "worktree")), 0o555);
  const frozen = await snapshotTree(prepared.workspaceRoot, { policy: "workspace" });
  assert.equal(snapshotDiffers(prepared.baseline, frozen, new Set()), false);
  for (const entry of prepared.baseline.entries.values()) {
    if (entry.kind === "file") {
      assert.equal(entry.mode, 0o444, entry.rel);
    }
    if (entry.kind === "directory") {
      assert.equal(entry.mode, 0o555, entry.rel);
    }
  }

  await assert.rejects(() => fs.lstat(reviewerObjectDatabasePath(runDir)), { code: "ENOENT" });
  const retained = path.join(runDir, WORKSPACE_MANIFEST_FILE);
  const written = JSON.parse(await readUtf8(retained)) as { baseCommit: string };
  assert.equal(written.baseCommit, prepared.manifest.baseCommit);

  await cleanupReviewWorkspace(runDir);
  await assert.rejects(() => fs.lstat(reviewerWorkspacePath(runDir)), { code: "ENOENT" });
  assert.equal((await fs.readFile(retained, "utf8")).includes(written.baseCommit), true);
  await fs.rm(runDir, { recursive: true, force: true });

  const excludes = path.join(root, ".git", "info", "exclude");
  await fs.mkdir(path.dirname(excludes), { recursive: true });
  await fs.writeFile(excludes, "src/untracked.txt\nsrc/.env.local\n");
  const excludeFile = path.join(root, "hostile-excludes");
  await fs.writeFile(excludeFile, "src/modified.txt\n");
  await repoGit(root, ["config", "core.excludesFile", excludeFile]);
  await writeFile(root, ".gitignore", "src/\n");
  const second = await prepare(root, scope);
  assert.equal(await readUtf8(worktreeFile(second.prepared, "src/untracked.txt")), "u\n");
  assert.equal(await readUtf8(worktreeFile(second.prepared, "src/.env.local")), "ignored-untracked\n");
  assert.equal(await readUtf8(worktreeFile(second.prepared, "src/modified.txt")), "a\nb\n");
  await removePrepared(second.runDir);
  await fs.rm(root, { recursive: true, force: true });
});

test("D2 non-converting plumbing ignores filters, parent env, and worktree redirects", async () => {
  const root = await makeGitRepo();
  await writeFile(root, "src/raw.txt", "raw-bytes\n");
  await writeFile(root, ".gitattributes", "*.txt filter=evil diff=evil -diff\n");
  await commitAll(root, "base");
  await writeFile(root, "src/raw.txt", "raw-bytes-changed\n");
  const sentinel = path.join(root, "SENTINEL_HELPER");
  await repoGit(root, ["config", "filter.evil.clean", `touch "${sentinel}" && cat`]);
  await repoGit(root, ["config", "filter.evil.smudge", `touch "${sentinel}" && cat`]);
  await repoGit(root, ["config", "filter.evil.process", `touch "${sentinel}"`]);
  await repoGit(root, ["config", "diff.evil.command", `touch "${sentinel}"`]);
  await repoGit(root, ["config", "diff.evil.textconv", `touch "${sentinel}"`]);
  await repoGit(root, ["config", "core.fsmonitor", "true"]);

  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-ws-outside-"));
  await writeFile(outside, "leaked.txt", "outside-bytes\n");
  await repoGit(root, ["config", "core.worktree", outside]);

  const saved: Record<string, string | undefined> = {};
  const hostile: Record<string, string> = {
    GIT_DIR: path.join(outside, "not-a-git"),
    GIT_WORK_TREE: outside,
    GIT_OBJECT_DIRECTORY: path.join(outside, "objects"),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(outside, "alt"),
    GIT_CONFIG_PARAMETERS: "'core.worktree'='/tmp'",
    GIT_CONFIG_COUNT: "1",
    GIT_EXEC_PATH: outside,
    XDG_CONFIG_HOME: outside,
  };
  for (const [key, value] of Object.entries(hostile)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    const objectsBefore = await snapshotObjectStore(root);
    const { prepared, runDir } = await prepare(root, ["src/"]);
    assert.equal(await readUtf8(worktreeFile(prepared, "src/raw.txt")), "raw-bytes-changed\n");
    await assert.rejects(() => fs.access(worktreeFile(prepared, "leaked.txt")), { code: "ENOENT" });
    await assert.rejects(() => fs.access(sentinel), { code: "ENOENT" });
    assert.equal((await readUtf8(path.join(prepared.workspaceRoot, "diff.patch"))).includes("src/raw.txt"), true);
    assert.deepEqual(await snapshotObjectStore(root), objectsBefore);
    await removePrepared(runDir);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await fs.rm(outside, { recursive: true, force: true });
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("D2 refuses source alternates metadata without reading it", async () => {
  const root = await makeGitRepo();
  await writeFile(root, "src/a.txt", "a\n");
  await commitAll(root, "base");
  const common = (await repoGit(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]))
    .toString("utf8")
    .trim();
  const alternates = path.join(common, "objects", "info", "alternates");
  await fs.mkdir(path.dirname(alternates), { recursive: true });
  await fs.writeFile(alternates, "/this/must/not/be/read\n");
  await withRunDir(async (runDir) => {
    await assert.rejects(
      () => prepareReviewWorkspace({ repoRoot: root, runDir, scope: ["src/"] }),
      ReviewerIsolationUnavailableError,
    );
    await assert.rejects(() => fs.lstat(reviewerWorkspacePath(runDir)), { code: "ENOENT" });
  });
  assert.equal(await readUtf8(alternates), "/this/must/not/be/read\n");
  await fs.rm(root, { recursive: true, force: true });
});

test("D2 missing object refuses without lazy fetch", async () => {
  const root = await makeGitRepo();
  await writeFile(root, "src/a.txt", "missing-me\n");
  await commitAll(root, "base");
  const oid = (await repoGit(root, ["rev-parse", "HEAD:src/a.txt"])).toString("utf8").trim();
  await fs.rm(path.join(root, ".git", "objects", oid.slice(0, 2), oid.slice(2)));
  await withRunDir(async (runDir) => {
    await assert.rejects(
      () => prepareReviewWorkspace({ repoRoot: root, runDir, scope: ["src/"] }),
      ReviewerIsolationUnavailableError,
    );
  });
  await fs.rm(root, { recursive: true, force: true });
});

test("D1/D2 untracked cache and fsmonitor cannot hide an in-scope ignored file", async () => {
  const root = await makeGitRepo();
  await writeFile(root, "src/keep.txt", "keep\n");
  await writeFile(root, ".gitignore", "hidden.txt\n");
  await commitAll(root, "base");
  await repoGit(root, ["config", "feature.manyFiles", "true"]);
  await repoGit(root, ["config", "core.untrackedCache", "true"]);
  await repoGit(root, ["config", "core.fsmonitor", "true"]);
  await repoGit(root, ["update-index", "--untracked-cache"]);
  await repoGit(root, ["status", "-z"]);
  await writeFile(root, "src/hidden.txt", "visible-to-reviewer\n");
  await repoGit(root, ["status", "-z"]);
  const { prepared, runDir } = await prepare(root, ["src/"]);
  assert.equal(await readUtf8(worktreeFile(prepared, "src/hidden.txt")), "visible-to-reviewer\n");
  await removePrepared(runDir);
  await fs.rm(root, { recursive: true, force: true });
});

test("D1/D3 refuse non-regular HEAD, index, worktree, unmerged, skip-worktree, and FIFO members", async () => {
  async function refusePrep(setup: (root: string) => Promise<void>): Promise<void> {
    const root = await makeGitRepo();
    await setup(root);
    const objectsBefore = await snapshotObjectStore(root);
    await withRunDir(async (runDir) => {
      await assert.rejects(
        () => prepareReviewWorkspace({ repoRoot: root, runDir, scope: ["src/"] }),
        ReviewerIsolationUnavailableError,
      );
    });
    assert.deepEqual(await snapshotObjectStore(root), objectsBefore);
    await fs.rm(root, { recursive: true, force: true });
  }

  await refusePrep(async (root) => {
    await writeFile(root, "src/a.txt", "a\n");
    await commitAll(root, "base");
    await fs.rm(path.join(root, "src/a.txt"));
    await fs.symlink("gone", path.join(root, "src/a.txt"));
    await repoGit(root, ["add", "-A"]);
    await repoGit(root, ["commit", "-qm", "symlink"]);
    await repoGit(root, ["rm", "-q", "src/a.txt"]);
  });

  await refusePrep(async (root) => {
    await writeFile(root, "src/a.txt", "a\n");
    await commitAll(root, "base");
    const oid = (await repoGit(root, ["rev-parse", "HEAD"])).toString("utf8").trim();
    await repoGit(root, ["update-index", "--add", "--cacheinfo", `160000,${oid},src/sub`]);
    await repoGit(root, ["commit", "-qm", "gitlink"]);
    await repoGit(root, ["rm", "--cached", "-q", "src/sub"]);
  });

  await refusePrep(async (root) => {
    await writeFile(root, "src/a.txt", "target\n");
    await fs.rm(path.join(root, "src/a.txt"));
    await fs.symlink("target", path.join(root, "src/a.txt"));
    await commitAll(root, "symlink");
    await fs.rm(path.join(root, "src/a.txt"));
    await writeFile(root, "src/a.txt", "now-regular\n");
  });

  await refusePrep(async (root) => {
    await writeFile(root, "src/a.txt", "a\n");
    await commitAll(root, "base");
    const oid = (await repoGit(root, ["rev-parse", "HEAD"])).toString("utf8").trim();
    await repoGit(root, ["update-index", "--add", "--cacheinfo", `160000,${oid},src/sub`]);
    await repoGit(root, ["commit", "-qm", "gitlink"]);
  });

  await refusePrep(async (root) => {
    await writeFile(root, "src/a.txt", "a\n");
    await commitAll(root, "base");
    await fs.symlink("a.txt", path.join(root, "src/now.txt"));
  });

  await refusePrep(async (root) => {
    await writeFile(root, "src/a.txt", "a\n");
    await commitAll(root, "base");
    const oid = (await repoGit(root, ["rev-parse", "HEAD:src/a.txt"])).toString("utf8").trim();
    await repoGit(
      root,
      ["update-index", "--index-info"],
      Buffer.from(`0 ${ZERO} 0\tsrc/a.txt\n100644 ${oid} 1\tsrc/a.txt\n100644 ${oid} 2\tsrc/a.txt\n100644 ${oid} 3\tsrc/a.txt\n`),
    );
  });

  await refusePrep(async (root) => {
    await writeFile(root, "src/a.txt", "a\n");
    await commitAll(root, "base");
    await repoGit(root, ["update-index", "--skip-worktree", "src/a.txt"]);
  });

  await refusePrep(async (root) => {
    await writeFile(root, "src/a.txt", "a\n");
    await commitAll(root, "base");
    await fs.rm(path.join(root, "src/a.txt"));
    await new Promise<void>((resolve, reject) => {
      const child = spawn("mkfifo", [path.join(root, "src/a.txt")], { shell: false });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error("mkfifo failed"));
      });
    });
  });

  await refusePrep(async (root) => {
    await writeFile(root, "src/dir/file.txt", "inside\n");
    await commitAll(root, "base");
    const dir = path.join(root, "src/dir");
    const real = path.join(root, "src/dir.real");
    await fs.rename(dir, real);
    await fs.symlink(real, dir);
  });
});

test("D3 initial ancestor symlink cannot leak outside bytes", async () => {
  const root = await makeGitRepo();
  await writeFile(root, "src/dir/file.txt", "inside\n");
  await commitAll(root, "base");
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-ws-leak-"));
  await writeFile(outside, "file.txt", "LEAKED\n");
  const dir = path.join(root, "src/dir");
  const real = path.join(root, "src/dir.real");
  await fs.rename(dir, real);
  await fs.symlink(outside, dir);
  await withRunDir(async (runDir) => {
    await assert.rejects(
      () => prepareReviewWorkspace({ repoRoot: root, runDir, scope: ["src/"] }),
      ReviewerIsolationUnavailableError,
    );
    try {
      const leaked = await fs.readFile(path.join(runDir, "reviewer-workspace", "worktree", "src/dir/file.txt"), "utf8");
      assert.notEqual(leaked, "LEAKED\n");
    } catch {
      // workspace cleaned on failure
    }
  });
  await fs.rm(outside, { recursive: true, force: true });
  await fs.rm(root, { recursive: true, force: true });
});

test("D3 ancestor replacement at the safe-reader open seam cannot leak outside bytes", async () => {
  const root = await makeGitRepo();
  await writeFile(root, "src/dir/file.txt", "inside\n");
  await commitAll(root, "base");
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-ws-seam-leak-"));
  writeFileSync(path.join(outside, "file.txt"), "LEAKED\n");
  let replaced = false;
  await withRunDir(async (runDir) => {
    await assert.rejects(
      () =>
        prepareReviewWorkspace(
          { repoRoot: root, runDir, scope: ["src/"] },
          {
            safeReadSeam: {
              beforeOpen(absPath) {
                if (replaced || !absPath.endsWith(`${path.sep}src${path.sep}dir${path.sep}file.txt`)) {
                  return;
                }
                const dir = path.dirname(absPath);
                renameSync(dir, `${dir}.real`);
                symlinkSync(outside, dir);
                replaced = true;
              },
            },
          },
        ),
      ReviewerIsolationUnavailableError,
    );
    try {
      const leaked = await fs.readFile(
        path.join(runDir, "reviewer-workspace", "worktree", "src/dir/file.txt"),
        "utf8",
      );
      assert.notEqual(leaked, "LEAKED\n");
    } catch {
      // workspace cleaned on failure
    }
  });
  assert.equal(replaced, true);
  await fs.rm(outside, { recursive: true, force: true });
  await fs.rm(root, { recursive: true, force: true });
});

test("D3 changing file at the safe-reader stat seam refuses", async () => {
  const root = await makeGitRepo();
  await writeFile(root, "src/a.txt", "stable\n");
  await commitAll(root, "base");
  let mutated = false;
  await withRunDir(async (runDir) => {
    await assert.rejects(
      () =>
        prepareReviewWorkspace(
          { repoRoot: root, runDir, scope: ["src/"] },
          {
            safeReadSeam: {
              afterFirstStat(absPath) {
                if (mutated || !absPath.endsWith(`${path.sep}src${path.sep}a.txt`)) {
                  return;
                }
                appendFileSync(absPath, "changed-after-stat\n");
                mutated = true;
              },
            },
          },
        ),
      ReviewerIsolationUnavailableError,
    );
  });
  assert.equal(mutated, true);
  await fs.rm(root, { recursive: true, force: true });
});

test("D3 regular-file-to-FIFO swap at the safe-reader open seam refuses", async () => {
  const root = await makeGitRepo();
  await writeFile(root, "src/a.txt", "regular\n");
  await commitAll(root, "base");
  let swapped = false;
  await withRunDir(async (runDir) => {
    await assert.rejects(
      () =>
        prepareReviewWorkspace(
          { repoRoot: root, runDir, scope: ["src/"] },
          {
            safeReadSeam: {
              beforeOpen(absPath) {
                if (swapped || !absPath.endsWith(`${path.sep}src${path.sep}a.txt`)) {
                  return;
                }
                rmSync(absPath);
                const made = spawnSync("mkfifo", [absPath], { shell: false });
                if (made.status !== 0) {
                  throw new Error("mkfifo failed");
                }
                swapped = true;
              },
            },
          },
        ),
      ReviewerIsolationUnavailableError,
    );
  });
  assert.equal(swapped, true);
  await fs.rm(root, { recursive: true, force: true });
});

test("D1 exact scope preserves a leading UTF-8 BOM path and does not alias it", async () => {
  const root = await makeGitRepo();
  const bomPath = "\uFEFFkeep.txt";
  await writeFile(root, bomPath, "bom-bytes\n");
  await writeFile(root, "keep.txt", "plain-bytes\n");
  await commitAll(root, "base");
  const { prepared, runDir } = await prepare(root, [bomPath]);
  assert.equal(await readUtf8(worktreeFile(prepared, bomPath)), "bom-bytes\n");
  await assert.rejects(() => fs.access(worktreeFile(prepared, "keep.txt")), { code: "ENOENT" });
  const files = await listRegularFiles(path.join(prepared.workspaceRoot, "worktree"));
  assert.deepEqual(files, [bomPath]);
  assert.equal(
    prepared.manifest.entries.some((entry) => entry.path === `worktree/${bomPath}`),
    true,
  );
  assert.equal(
    prepared.manifest.entries.some((entry) => entry.path === "worktree/keep.txt"),
    false,
  );
  await removePrepared(runDir);
  await fs.rm(root, { recursive: true, force: true });
});

test("D4 isolated diff argv is only tree OIDs and ignores in-tree attributes", async () => {
  const root = await makeGitRepo();
  for (let i = 0; i < 80; i += 1) {
    const name = `src/f${String(i).padStart(3, "0")}_${"p".repeat(40)}.txt`;
    await writeFile(root, name, `body-${i}\n`);
  }
  await writeFile(root, ".gitattributes", "*.txt -diff\n");
  await commitAll(root, "base");
  await writeFile(root, "src/f000_pppppppppppppppppppppppppppppppppppppppp.txt", "changed-0\n");
  const calls: string[][] = [];
  const { prepared, runDir } = await prepare(root, ["src/"], async (request) => {
    calls.push([...request.args]);
    return spawnGit(request);
  });
  const diffCalls = calls.filter((args) => args.includes("diff-tree"));
  assert.equal(diffCalls.length >= 1, true);
  for (const args of diffCalls) {
    const command = args.lastIndexOf("diff-tree");
    const after = args.slice(command);
    assert.deepEqual(after.slice(0, 7), ["diff-tree", "-r", "-p", "--binary", "--no-renames", "--no-ext-diff", "--no-textconv"]);
    assert.equal(after.length, 9);
    assert.match(after[7] ?? "", /^[0-9a-f]{40,64}$/);
    assert.match(after[8] ?? "", /^[0-9a-f]{40,64}$/);
    assert.equal(after.some((arg) => arg.includes("src/")), false);
  }
  const patch = await readUtf8(path.join(prepared.workspaceRoot, "diff.patch"));
  assert.match(patch, /changed-0/);
  await removePrepared(runDir);
  await fs.rm(root, { recursive: true, force: true });
});

test("D4 synthetic tree siblings sort in Git UTF-8 byte order", async () => {
  const root = await makeGitRepo();
  const bmpPrivate = "src/\uE000.txt";
  const astral = "src/\u{10000}.txt";
  assert.equal("\uE000.txt" > "\u{10000}.txt", true);
  assert.equal(Buffer.compare(Buffer.from("\uE000.txt", "utf8"), Buffer.from("\u{10000}.txt", "utf8")) < 0, true);
  await writeFile(root, bmpPrivate, "bmp\n");
  await writeFile(root, astral, "astral\n");
  await commitAll(root, "base");
  const mktreeInputs: Buffer[] = [];
  const { prepared, runDir } = await prepare(root, ["src/"], async (request) => {
    if (request.args.includes("mktree") && request.stdin) {
      mktreeInputs.push(Buffer.from(request.stdin));
    }
    return spawnGit(request);
  });
  const siblingInput = mktreeInputs.find(
    (buf) => buf.includes(Buffer.from("\uE000.txt", "utf8")) && buf.includes(Buffer.from("\u{10000}.txt", "utf8")),
  );
  assert.equal(siblingInput !== undefined, true);
  const bmpMarker = Buffer.from("\t\uE000.txt\0", "utf8");
  const astralMarker = Buffer.from("\t\u{10000}.txt\0", "utf8");
  const bmpAt = siblingInput?.indexOf(bmpMarker) ?? -1;
  const astralAt = siblingInput?.indexOf(astralMarker) ?? -1;
  assert.equal(bmpAt >= 0 && astralAt >= 0, true);
  assert.equal(bmpAt < astralAt, true);
  assert.equal(await readUtf8(worktreeFile(prepared, bmpPrivate)), "bmp\n");
  assert.equal(await readUtf8(worktreeFile(prepared, astral)), "astral\n");
  await removePrepared(runDir);
  await fs.rm(root, { recursive: true, force: true });
});

test("D4 changes.txt is unambiguous for tab and newline filenames", async () => {
  const root = await makeGitRepo();
  const tabPath = "src/tab\tname.txt";
  const newlinePath = "src/new\nline.txt";
  await writeFile(root, tabPath, "tab-bytes\n");
  await writeFile(root, newlinePath, "nl-bytes\n");
  await commitAll(root, "base");
  await writeFile(root, tabPath, "tab-changed\n");
  await writeFile(root, newlinePath, "nl-changed\n");
  const { prepared, runDir } = await prepare(root, ["src/"]);
  const changes = await readUtf8(path.join(prepared.workspaceRoot, "changes.txt"));
  const rows = new Map<string, string>();
  for (const line of changes.trimEnd().split("\n").slice(1)) {
    const tab = line.indexOf("\t");
    assert.equal(tab > 0, true, line);
    rows.set(JSON.parse(line.slice(tab + 1)) as string, line.slice(0, tab));
  }
  assert.equal(rows.get(tabPath), "modified");
  assert.equal(rows.get(newlinePath), "modified");
  assert.equal(rows.size, 2);
  assert.equal(changes.includes(changeLine("modified", tabPath)), true);
  assert.equal(changes.includes(changeLine("modified", newlinePath)), true);
  assert.equal(await readUtf8(worktreeFile(prepared, tabPath)), "tab-changed\n");
  assert.equal(await readUtf8(worktreeFile(prepared, newlinePath)), "nl-changed\n");
  await removePrepared(runDir);
  await fs.rm(root, { recursive: true, force: true });
});

test("D4 included set above ARG_MAX succeeds without per-path argv", { timeout: 180_000 }, async () => {
  const root = await makeGitRepo();
  const argMax = argMaxBytes();
  const dirA = "a".repeat(240);
  const dirB = "b".repeat(240);
  const prefix = `src/${dirA}/${dirB}`;
  await fs.mkdir(path.join(root, prefix), { recursive: true });
  const paths: string[] = [];
  let encodedBytes = 0;
  let i = 0;
  while (encodedBytes <= argMax) {
    const rel = `${prefix}/${String(i).padStart(5, "0")}_${"p".repeat(200)}.txt`;
    writeFileSync(path.join(root, rel), `${i}\n`);
    paths.push(rel);
    encodedBytes += rel.length + 1;
    i += 1;
  }
  await commitAll(root, "base");
  await writeFile(root, paths[0] ?? `${prefix}/missing.txt`, "changed-0\n");
  const calls: string[][] = [];
  const { prepared, runDir } = await prepare(root, ["src/"], async (request) => {
    calls.push([...request.args]);
    return spawnGit(request);
  });
  assert.equal(encodedBytes > argMax, true);
  assert.equal(paths.length >= 2, true);
  const diffCalls = calls.filter((args) => args.includes("diff-tree"));
  assert.equal(diffCalls.length >= 1, true);
  for (const args of diffCalls) {
    const command = args.lastIndexOf("diff-tree");
    const after = args.slice(command);
    assert.deepEqual(after.slice(0, 7), ["diff-tree", "-r", "-p", "--binary", "--no-renames", "--no-ext-diff", "--no-textconv"]);
    assert.equal(after.length, 9);
    assert.match(after[7] ?? "", /^[0-9a-f]{40,64}$/);
    assert.match(after[8] ?? "", /^[0-9a-f]{40,64}$/);
    assert.equal(
      after.some((arg) => arg.includes("src/") || arg.includes(dirA) || arg.includes(dirB)),
      false,
    );
  }
  assert.equal(
    prepared.manifest.entries.filter((entry) => entry.kind === "product").length,
    paths.length,
  );
  const patch = await readUtf8(path.join(prepared.workspaceRoot, "diff.patch"));
  assert.match(patch, /changed-0/);
  await removePrepared(runDir);
  await fs.rm(root, { recursive: true, force: true });
});

test("D4 patch overflow refuses rather than truncating", async () => {
  const root = await makeGitRepo();
  await writeFile(root, "src/small.txt", "ok\n");
  await commitAll(root, "base");
  await writeFile(root, "src/huge.bin", Buffer.alloc(PATCH_BYTE_CAP + 4096, 7));
  await repoGit(root, ["add", "src/huge.bin"]);
  await withRunDir(async (runDir) => {
    await assert.rejects(
      () => prepareReviewWorkspace({ repoRoot: root, runDir, scope: ["src/"] }),
      ReviewerIsolationUnavailableError,
    );
  });
  await fs.rm(root, { recursive: true, force: true });
});

test("D5 workspace snapshot hashes skipped repository names and large tails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-ws-snap-"));
  await fs.mkdir(path.join(root, "node_modules"));
  await fs.writeFile(path.join(root, "node_modules", "pkg.js"), "nm\n");
  await fs.mkdir(path.join(root, ".spartan-bridge"));
  await fs.writeFile(path.join(root, ".spartan-bridge", "run.json"), "sb\n");
  await fs.mkdir(path.join(root, ".git"));
  await fs.writeFile(path.join(root, ".git", "secret"), "git\n");
  await fs.writeFile(path.join(root, "small.txt"), "small-prefix\n");
  const large = path.join(root, "large.bin");
  const bytes = Buffer.alloc(SNAPSHOT_HASH_FILE_CAP + 24, 3);
  await fs.writeFile(large, bytes);
  const repoSnap = await snapshotTree(root);
  assert.equal(repoSnap.entries.has("node_modules"), false);
  assert.equal(repoSnap.entries.has(".spartan-bridge"), false);
  assert.equal(repoSnap.entries.has(".git"), false);
  assert.equal(repoSnap.entries.get("large.bin")?.hash, undefined);
  assert.equal(repoSnap.entries.get("small.txt")?.hash?.startsWith("sha256:"), true);

  const workSnap = await snapshotTree(root, { policy: "workspace" });
  assert.equal(workSnap.entries.has("node_modules/pkg.js"), true);
  assert.equal(workSnap.entries.has(".spartan-bridge/run.json"), true);
  assert.equal(workSnap.entries.has(".git/secret"), true);
  assert.equal(workSnap.entries.get("large.bin")?.hash?.startsWith("sha256:"), true);

  await fs.writeFile(path.join(root, "small.txt"), "small-prefix-changed\n");
  const afterPrefix = await snapshotTree(root);
  assert.equal(snapshotDiffers(repoSnap, afterPrefix, new Set()), true);

  await fs.writeFile(path.join(root, "small.txt"), "small-prefix\n");
  const restored = await snapshotTree(root);
  const beforeTail = lstatSync(large, { bigint: true });
  bytes[bytes.length - 1] = 8;
  await fs.writeFile(large, bytes);
  restoreNsTimestamps(large, beforeTail);
  const afterTail = await snapshotTree(root);
  assert.equal(snapshotDiffers(restored, afterTail, new Set()), false);
  const workBefore = await snapshotTree(root, { policy: "workspace" });
  const beforeWorkTail = lstatSync(large, { bigint: true });
  bytes[bytes.length - 1] = 9;
  await fs.writeFile(large, bytes);
  restoreNsTimestamps(large, beforeWorkTail);
  const workAfter = await snapshotTree(root, { policy: "workspace" });
  assert.equal(snapshotDiffers(workBefore, workAfter, new Set()), true);

  await fs.writeFile(path.join(root, "a.bin"), Buffer.alloc(64, 1));
  await fs.writeFile(path.join(root, "b.bin"), Buffer.alloc(64, 2));
  await assert.rejects(
    () => snapshotTree(root, { policy: "workspace", hashBytes: 80 }),
    SnapshotCapError,
  );
  await fs.rm(root, { recursive: true, force: true });
});

test("public workspace input carries resolved scope without parsing repository policy", async () => {
  const sourcePath = fileURLToPath(new URL("../src/core/workspace.ts", import.meta.url));
  const source = await fs.readFile(sourcePath, "utf8");
  assert.equal(/from ["']\.\.\/policy\//.test(source), true);
  assert.equal(/parseAgentsPolicy|task-frontmatter/.test(source), false);
  const root = await makeGitRepo();
  await writeFile(root, "src/a.txt", "a\n");
  await commitAll(root, "base");
  const { prepared, runDir } = await prepare(root, ["src/"]);
  assert.equal(prepared.manifest.entries.some((entry) => entry.path === "worktree/src/a.txt"), true);
  await removePrepared(runDir);
  await fs.rm(root, { recursive: true, force: true });
});

test("D6 cleanup does not chmod or delete through a reviewer-planted symlink", async () => {
  const root = await makeGitRepo();
  await writeFile(root, "src/a.txt", "inside\n");
  await commitAll(root, "base");
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-ws-cleanup-"));
  const victim = path.join(outside, "secret.txt");
  writeFileSync(victim, "do-not-touch\n", { mode: 0o444 });
  chmodSync(outside, 0o555);
  const { prepared, runDir } = await prepare(root, ["src/"]);
  chmodSync(prepared.workspaceRoot, 0o700);
  const worktree = path.join(prepared.workspaceRoot, "worktree");
  chmodSync(worktree, 0o700);
  symlinkSync(outside, path.join(worktree, "escape"));
  const victimMode = lstatSync(victim).mode & 0o777;
  const outsideMode = lstatSync(outside).mode & 0o777;
  await cleanupReviewWorkspace(runDir);
  await assert.rejects(() => fs.lstat(reviewerWorkspacePath(runDir)), { code: "ENOENT" });
  assert.equal(await readUtf8(victim), "do-not-touch\n");
  assert.equal(lstatSync(victim).mode & 0o777, victimMode);
  assert.equal(lstatSync(outside).mode & 0o777, outsideMode);
  chmodSync(outside, 0o700);
  await fs.rm(outside, { recursive: true, force: true });
  await fs.rm(runDir, { recursive: true, force: true });
  await fs.rm(root, { recursive: true, force: true });
});

test("D1 exact scope matching does not admit prefix neighbours", async () => {
  const root = await makeGitRepo();
  await writeFile(root, "README.md", "root-readme\n");
  await writeFile(root, "src/a.ts", "a\n");
  await writeFile(root, "src/nested/b.ts", "b\n");
  await writeFile(root, "srcfoo", "nope\n");
  await writeFile(root, "packages/src/a.ts", "nope\n");
  await writeFile(root, "packages/app/index.ts", "app\n");
  await writeFile(root, "packages/application/index.ts", "nope\n");
  await commitAll(root, "base");
  const { prepared, runDir } = await prepare(root, ["README.md", "src/", "packages/app/"]);
  assert.equal(await readUtf8(worktreeFile(prepared, "README.md")), "root-readme\n");
  assert.equal(await readUtf8(worktreeFile(prepared, "src/a.ts")), "a\n");
  assert.equal(await readUtf8(worktreeFile(prepared, "src/nested/b.ts")), "b\n");
  assert.equal(await readUtf8(worktreeFile(prepared, "packages/app/index.ts")), "app\n");
  await assert.rejects(() => fs.access(worktreeFile(prepared, "srcfoo")), { code: "ENOENT" });
  await assert.rejects(() => fs.access(worktreeFile(prepared, "packages/src/a.ts")), { code: "ENOENT" });
  await assert.rejects(() => fs.access(worktreeFile(prepared, "packages/application/index.ts")), { code: "ENOENT" });
  const files = await listRegularFiles(path.join(prepared.workspaceRoot, "worktree"));
  assert.deepEqual(
    files.filter((rel) => !rel.includes(".") || rel.endsWith(".ts") || rel === "README.md" || rel.endsWith("index.ts")),
    files,
  );
  await removePrepared(runDir);
  await fs.rm(root, { recursive: true, force: true });
});

test("recordImplementationReviewEnvelope appends AGENTS.md and task.md to the retained manifest", async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-envelope-"));
  const agents = Buffer.from("agents-body\n");
  const task = Buffer.from("task-body\n");
  const updated = await recordImplementationReviewEnvelope(
    runDir,
    {
      baseCommit: "0".repeat(40),
      patchByteLength: 4,
      entries: [{ path: "changes.txt", kind: "change-list", size: 1, sha256: "sha256:aa" }],
    },
    [
      { path: "AGENTS.md", bytes: agents },
      { path: "task.md", bytes: task },
    ],
  );
  assert.deepEqual(
    updated.entries.map((entry) => entry.path),
    ["AGENTS.md", "changes.txt", "task.md"],
  );
  assert.equal(updated.entries[0]?.sha256, sha256Bytes(agents));
  assert.equal(updated.entries[2]?.sha256, sha256Bytes(task));
  const written = JSON.parse(await fs.readFile(path.join(runDir, WORKSPACE_MANIFEST_FILE), "utf8")) as {
    entries: { path: string }[];
  };
  assert.deepEqual(
    written.entries.map((entry) => entry.path),
    ["AGENTS.md", "changes.txt", "task.md"],
  );
  await assert.rejects(
    () =>
      recordImplementationReviewEnvelope(runDir, updated, [{ path: "AGENTS.md", bytes: agents }]),
    (error: unknown) => error instanceof ReviewerIsolationUnavailableError,
  );
  await fs.rm(runDir, { recursive: true, force: true });
});
