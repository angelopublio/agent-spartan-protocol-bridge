import { spawn } from "node:child_process";
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  type Stats,
} from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ReasonCode, SnapshotDiffEntry, WorkspaceManifest, WorkspaceManifestFileEntry } from "./contracts.ts";
import { sha256Bytes } from "./serialize.ts";
import {
  isPrefixMember,
  producerPathDenied,
  snapshotTree,
  SnapshotCapError,
  workspaceDiff,
  type SnapshotEntryKind,
  type SnapshotTreeCaps,
  type TreeSnapshot,
} from "./snapshot.ts";
import { unicodeDefaultCaseFold } from "./unicode-casefold.ts";
import { writeWorkspaceManifestAtomic } from "../runtime/store.ts";
import { isAuthorityWritePath, isPathAdmittedByScope } from "../policy/agents-policy.ts";

export const GIT_EXECUTABLE = "git";
export const PATCH_BYTE_CAP = 1024 * 1024;
export const REVIEWER_WORKSPACE_DIR = "reviewer-workspace";
export const REVIEWER_ODB_DIR = "reviewer-odb";
export const WORKTREE_PREFIX = "worktree";
export const PRODUCER_SUPPORT_SCOPE = ["node_modules/"] as const;
export const PRODUCER_SCRATCH_PREFIXES = ["dist/", "node_modules/.cache/"] as const;
export const PRODUCER_MERGE_ENTRY_CAP = 2_000;
export const PRODUCER_MERGE_BYTE_CAP = 64 * 1024 * 1024;

const SOURCE_ENV_KEYS = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM"] as const;
const OID_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const REGULAR_GIT_MODES = new Set(["100644", "100755"]);
const DARWIN_O_NOFOLLOW_ANY = 0x20000000;
const UTF8_STRICT = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const DEFAULT_GIT_TIMEOUT_MS = 120_000;
const DEFAULT_GIT_STDOUT_CAP = 256 * 1024 * 1024;

export class ReviewerIsolationUnavailableError extends Error {
  override readonly name = "ReviewerIsolationUnavailableError";
  constructor() {
    super("reviewer_isolation_unavailable");
  }
}

export type PrepareWorkspaceInput = {
  repoRoot: string;
  runDir: string;
  scope: readonly string[];
};

export type PreparedWorkspace = {
  workspaceRoot: string;
  baseline: TreeSnapshot;
  manifest: WorkspaceManifest;
};

export type ImplementationReviewEnvelopeFile = {
  path: "AGENTS.md" | "task.md";
  bytes: Uint8Array;
};

export async function recordImplementationReviewEnvelope(
  runDir: string,
  manifest: WorkspaceManifest,
  envelope: readonly ImplementationReviewEnvelopeFile[],
): Promise<WorkspaceManifest> {
  const extra: WorkspaceManifestFileEntry[] = envelope.map((file) => ({
    path: file.path,
    kind: "product",
    size: file.bytes.byteLength,
    sha256: sha256Bytes(file.bytes),
  }));
  const known = new Set(manifest.entries.map((entry) => entry.path));
  for (const entry of extra) {
    if (known.has(entry.path)) {
      throw new ReviewerIsolationUnavailableError();
    }
    known.add(entry.path);
  }
  const updated: WorkspaceManifest = {
    baseCommit: manifest.baseCommit,
    patchByteLength: manifest.patchByteLength,
    entries: [...manifest.entries, ...extra].sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    ),
  };
  await writeWorkspaceManifestAtomic(runDir, updated);
  return updated;
}

export type GitSpawnRequest = {
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: Uint8Array;
  stdoutCap: number;
  timeoutMs: number;
};

export type SafeReadSeam = {
  beforeOpen?: (absPath: string) => void;
  afterFirstStat?: (absPath: string) => void;
};

export type WorkspaceDeps = {
  git?: (request: GitSpawnRequest) => Promise<Buffer>;
  safeReadSeam?: SafeReadSeam;
};

type ScopeRule =
  | { kind: "file"; path: string }
  | { kind: "dir"; prefix: string };

type HeadEntry = { mode: string; oid: string };
type IndexRecord = { tag: string; mode: string; oid: string; stage: number };
type IndexEntry = { mode: string; oid: string };
type Member = {
  path: string;
  h: HeadEntry | undefined;
  i: IndexEntry | undefined;
  w: { bytes: Buffer; gitMode: string } | undefined;
};

type TreeLevel = {
  blobs: Map<string, { mode: string; oid: string }>;
  trees: Map<string, TreeLevel>;
};

export function reviewerWorkspacePath(runDir: string): string {
  return path.join(runDir, REVIEWER_WORKSPACE_DIR);
}

export function reviewerObjectDatabasePath(runDir: string): string {
  return path.join(runDir, REVIEWER_ODB_DIR);
}

export function workspaceSafeOpenFlags(platform: string = process.platform): number {
  if (platform !== "darwin") {
    throw new ReviewerIsolationUnavailableError();
  }
  return fsConstants.O_RDONLY | DARWIN_O_NOFOLLOW_ANY | fsConstants.O_NONBLOCK;
}

export function validateRepositoryPath(posix: string): string {
  if (posix.includes("\0") || posix.includes("\\") || posix.startsWith("/")) {
    throw new ReviewerIsolationUnavailableError();
  }
  if (posix.normalize("NFC") !== posix) {
    throw new ReviewerIsolationUnavailableError();
  }
  const components = posix.split("/");
  if (components.length === 0) {
    throw new ReviewerIsolationUnavailableError();
  }
  for (const component of components) {
    if (component.length === 0 || component === "." || component === "..") {
      throw new ReviewerIsolationUnavailableError();
    }
    if (securityKey(component) === ".git") {
      throw new ReviewerIsolationUnavailableError();
    }
  }
  return posix;
}

export function parseGitPathBytes(bytes: Uint8Array): string {
  let decoded: string;
  try {
    decoded = UTF8_STRICT.decode(bytes);
  } catch {
    throw new ReviewerIsolationUnavailableError();
  }
  return validateRepositoryPath(decoded);
}

export async function cleanupReviewWorkspace(runDir: string): Promise<void> {
  await rmQuiet(reviewerWorkspacePath(runDir));
  await rmQuiet(reviewerObjectDatabasePath(runDir));
  await rmQuiet(path.join(runDir, "reviewer-git-staging"));
}

export async function prepareReviewWorkspace(
  input: PrepareWorkspaceInput,
  deps: WorkspaceDeps = {},
): Promise<PreparedWorkspace> {
  const git = deps.git ?? spawnGit;
  const runDir = path.resolve(input.runDir);
  const workspaceRoot = reviewerWorkspacePath(runDir);
  const odbRoot = reviewerObjectDatabasePath(runDir);
  const stagingRoot = path.join(runDir, "reviewer-git-staging");
  let prepared = false;
  try {
    const canonicalRoot = await fs.realpath(path.resolve(input.repoRoot));
    const scope = parseScope(input.scope);
    const sourceEnv = buildSourceEnv();
    const gitIdentity = await bootstrapGitIdentity(git, canonicalRoot, sourceEnv);
    await refuseIfAlternatesExist(gitIdentity.commonDir);

    const headRecords = await readHeadEntries(git, canonicalRoot, gitIdentity, sourceEnv);
    const indexRecords = await readIndexEntries(git, canonicalRoot, gitIdentity, sourceEnv);
    const otherPaths = await readOtherPaths(git, canonicalRoot, gitIdentity, sourceEnv);
    const members = buildMembers(scope, headRecords, indexRecords, otherPaths);
    const extantCandidates = extantCandidatePaths(members, otherPaths, scope);

    await fs.mkdir(workspaceRoot, { recursive: false, mode: 0o700 });
    await fs.mkdir(path.join(workspaceRoot, WORKTREE_PREFIX), { recursive: false, mode: 0o700 });

    for (const member of members.values()) {
      if (!extantCandidates.has(member.path)) {
        continue;
      }
      const sourceAbs = joinUnder(canonicalRoot, member.path);
      const listedAsOther = otherPaths.has(member.path);
      let read: { bytes: Buffer; gitMode: string };
      try {
        read = safeReadFile(sourceAbs, deps.safeReadSeam);
      } catch (error) {
        if (isNotFound(error)) {
          if (listedAsOther) {
            throw new ReviewerIsolationUnavailableError();
          }
          continue;
        }
        throw toIsolationError(error);
      }
      member.w = read;
      const destAbs = joinUnder(path.join(workspaceRoot, WORKTREE_PREFIX), member.path);
      await fs.mkdir(path.dirname(destAbs), { recursive: true, mode: 0o755 });
      assertInside(path.join(workspaceRoot, WORKTREE_PREFIX), destAbs);
      await fs.writeFile(destAbs, read.bytes, { mode: 0o644 });
    }

    const isolated = await createIsolatedGit(git, runDir, stagingRoot, odbRoot);
    const baseCommit = await revParseHead(git, canonicalRoot, gitIdentity, sourceEnv);
    const neededOids = [...new Set(
      [...members.values()].flatMap((member) => (member.h ? [member.h.oid] : [])),
    )];
    const headBlobs = await catFileBatch(git, canonicalRoot, gitIdentity, sourceEnv, neededOids);

    const baselineEntries: { path: string; mode: string; oid: string }[] = [];
    const currentEntries: { path: string; mode: string; oid: string }[] = [];
    for (const member of members.values()) {
      if (member.h) {
        const blob = headBlobs.get(member.h.oid);
        if (!blob) {
          throw new ReviewerIsolationUnavailableError();
        }
        const oid = await hashObject(git, isolated, blob);
        baselineEntries.push({ path: member.path, mode: member.h.mode, oid });
      }
      if (member.i && member.w) {
        const oid = await hashObject(git, isolated, member.w.bytes);
        currentEntries.push({ path: member.path, mode: member.w.gitMode, oid });
      }
    }

    const baselineTree = await writeTree(git, isolated, baselineEntries);
    const currentTree = await writeTree(git, isolated, currentEntries);
    const patch = await diffTrees(git, isolated, baselineTree, currentTree);
    if (patch.length > PATCH_BYTE_CAP) {
      throw new ReviewerIsolationUnavailableError();
    }
    const changes = renderChanges(baseCommit, members, headBlobs);
    await fs.writeFile(path.join(workspaceRoot, "diff.patch"), patch, { mode: 0o644 });
    await fs.writeFile(path.join(workspaceRoot, "changes.txt"), changes, { mode: 0o644 });

    await fs.rm(odbRoot, { recursive: true, force: true });
    await fs.rm(stagingRoot, { recursive: true, force: true });
    try {
      await fs.lstat(odbRoot);
      throw new ReviewerIsolationUnavailableError();
    } catch (error) {
      if (!isNotFound(error)) {
        throw toIsolationError(error);
      }
    }

    await freezeWorkspace(workspaceRoot);
    let baseline: TreeSnapshot;
    try {
      baseline = await snapshotTree(workspaceRoot, { policy: "workspace" });
    } catch (error) {
      if (error instanceof SnapshotCapError) {
        throw new ReviewerIsolationUnavailableError();
      }
      throw toIsolationError(error);
    }
    const manifest = buildManifest(baseCommit, patch.length, baseline, members);
    await writeWorkspaceManifestAtomic(runDir, manifest);
    prepared = true;
    return { workspaceRoot, baseline, manifest };
  } catch (error) {
    throw toIsolationError(error);
  } finally {
    if (!prepared) {
      await rmQuiet(workspaceRoot);
      await rmQuiet(odbRoot);
      await rmQuiet(stagingRoot);
    }
  }
}

function parseScope(entries: readonly string[]): ScopeRule[] {
  const rules: ScopeRule[] = [];
  const keys = new Set<string>();
  for (const raw of entries) {
    if (raw.includes("\0") || raw.includes("\\")) {
      throw new ReviewerIsolationUnavailableError();
    }
    if (raw.endsWith("/")) {
      const dir = raw.slice(0, -1);
      const posix = validateRepositoryPath(dir);
      const prefix = `${posix}/`;
      const key = `dir:${prefix}`;
      if (keys.has(key)) {
        throw new ReviewerIsolationUnavailableError();
      }
      keys.add(key);
      rules.push({ kind: "dir", prefix });
      continue;
    }
    const posix = validateRepositoryPath(raw);
    const key = `file:${posix}`;
    if (keys.has(key)) {
      throw new ReviewerIsolationUnavailableError();
    }
    keys.add(key);
    rules.push({ kind: "file", path: posix });
  }
  return rules;
}

function isAdmitted(posix: string, scope: readonly ScopeRule[]): boolean {
  for (const rule of scope) {
    if (rule.kind === "file" && posix === rule.path) {
      return true;
    }
    if (rule.kind === "dir" && posix.startsWith(rule.prefix)) {
      return true;
    }
  }
  return false;
}

function securityKey(component: string): string {
  return unicodeDefaultCaseFold(component);
}

function pathSecurityKey(posix: string): string {
  return posix.split("/").map(securityKey).join("/");
}

function buildSourceEnv(from: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SOURCE_ENV_KEYS) {
    const value = from[key];
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_CONFIG_SYSTEM = "/dev/null";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_ATTR_NOSYSTEM = "1";
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_NO_REPLACE_OBJECTS = "1";
  env.GIT_NO_LAZY_FETCH = "1";
  return env;
}

type GitIdentity = { gitDir: string; commonDir: string };

async function bootstrapGitIdentity(
  git: (request: GitSpawnRequest) => Promise<Buffer>,
  canonicalRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<GitIdentity> {
  const output = await git({
    args: [
      `--work-tree=${canonicalRoot}`,
      "-c",
      `core.worktree=${canonicalRoot}`,
      "rev-parse",
      "--path-format=absolute",
      "--absolute-git-dir",
      "--git-common-dir",
    ],
    cwd: canonicalRoot,
    env,
    stdoutCap: 64 * 1024,
    timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
  });
  const lines = output.toString("utf8").trimEnd().split("\n");
  const gitDir = lines[0];
  const commonDir = lines[1];
  if (!gitDir || !commonDir || !path.isAbsolute(gitDir) || !path.isAbsolute(commonDir)) {
    throw new ReviewerIsolationUnavailableError();
  }
  return { gitDir, commonDir };
}

function sourceArgs(identity: GitIdentity, canonicalRoot: string, extra: readonly string[]): string[] {
  return [
    `--git-dir=${identity.gitDir}`,
    `--work-tree=${canonicalRoot}`,
    "-c",
    `core.worktree=${canonicalRoot}`,
    ...extra,
  ];
}

async function refuseIfAlternatesExist(commonDir: string): Promise<void> {
  for (const name of ["alternates", "http-alternates"] as const) {
    try {
      lstatSync(path.join(commonDir, "objects", "info", name));
    } catch (error) {
      if (isNotFound(error)) {
        continue;
      }
      throw toIsolationError(error);
    }
    throw new ReviewerIsolationUnavailableError();
  }
}

async function readHeadEntries(
  git: (request: GitSpawnRequest) => Promise<Buffer>,
  canonicalRoot: string,
  identity: GitIdentity,
  env: NodeJS.ProcessEnv,
): Promise<Map<string, HeadEntry>> {
  const output = await git({
    args: sourceArgs(identity, canonicalRoot, ["ls-tree", "-r", "-z", "--full-tree", "HEAD"]),
    cwd: canonicalRoot,
    env,
    stdoutCap: DEFAULT_GIT_STDOUT_CAP,
    timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
  });
  const entries = new Map<string, HeadEntry>();
  for (const record of splitNul(output)) {
    const tab = record.indexOf(0x09);
    if (tab <= 0) {
      throw new ReviewerIsolationUnavailableError();
    }
    const header = record.subarray(0, tab).toString("latin1");
    const match = /^([0-7]{6}) (blob|tree|commit) ([0-9a-f]+)$/.exec(header);
    if (!match || !OID_RE.test(match[3] ?? "")) {
      throw new ReviewerIsolationUnavailableError();
    }
    const posix = parseGitPathBytes(record.subarray(tab + 1));
    if (entries.has(posix)) {
      throw new ReviewerIsolationUnavailableError();
    }
    entries.set(posix, { mode: match[1] ?? "", oid: match[3] ?? "" });
  }
  return entries;
}

async function readIndexEntries(
  git: (request: GitSpawnRequest) => Promise<Buffer>,
  canonicalRoot: string,
  identity: GitIdentity,
  env: NodeJS.ProcessEnv,
): Promise<Map<string, IndexRecord[]>> {
  const output = await git({
    args: sourceArgs(identity, canonicalRoot, [
      "-c",
      "feature.manyFiles=false",
      "-c",
      "core.untrackedCache=false",
      "-c",
      "core.fsmonitor=false",
      "ls-files",
      "--stage",
      "--sparse",
      "-t",
      "-z",
    ]),
    cwd: canonicalRoot,
    env,
    stdoutCap: DEFAULT_GIT_STDOUT_CAP,
    timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
  });
  const entries = new Map<string, IndexRecord[]>();
  for (const record of splitNul(output)) {
    const tab = record.indexOf(0x09);
    if (tab <= 0) {
      throw new ReviewerIsolationUnavailableError();
    }
    const header = record.subarray(0, tab).toString("latin1");
    const match = /^([A-Za-z]) ([0-7]{6}) ([0-9a-f]+) ([0-3])$/.exec(header);
    if (!match || !OID_RE.test(match[3] ?? "")) {
      throw new ReviewerIsolationUnavailableError();
    }
    const posix = parseGitPathBytes(record.subarray(tab + 1));
    const list = entries.get(posix) ?? [];
    list.push({
      tag: match[1] ?? "",
      mode: match[2] ?? "",
      oid: match[3] ?? "",
      stage: Number(match[4]),
    });
    entries.set(posix, list);
  }
  return entries;
}

async function readOtherPaths(
  git: (request: GitSpawnRequest) => Promise<Buffer>,
  canonicalRoot: string,
  identity: GitIdentity,
  env: NodeJS.ProcessEnv,
): Promise<Set<string>> {
  const output = await git({
    args: sourceArgs(identity, canonicalRoot, [
      "-c",
      "feature.manyFiles=false",
      "-c",
      "core.untrackedCache=false",
      "-c",
      "core.fsmonitor=false",
      "ls-files",
      "--others",
      "-z",
    ]),
    cwd: canonicalRoot,
    env,
    stdoutCap: DEFAULT_GIT_STDOUT_CAP,
    timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
  });
  const paths = new Set<string>();
  for (const record of splitNul(output)) {
    const posix = parseGitPathBytes(record);
    if (paths.has(posix)) {
      throw new ReviewerIsolationUnavailableError();
    }
    paths.add(posix);
  }
  return paths;
}

function buildMembers(
  scope: readonly ScopeRule[],
  headRecords: Map<string, HeadEntry>,
  indexRecords: Map<string, IndexRecord[]>,
  otherPaths: Set<string>,
): Map<string, Member> {
  const members = new Map<string, Member>();
  const securityKeys = new Map<string, string>();
  const allPaths = new Set<string>([...headRecords.keys(), ...indexRecords.keys(), ...otherPaths]);
  for (const posix of allPaths) {
    if (!isAdmitted(posix, scope)) {
      continue;
    }
    const key = pathSecurityKey(posix);
    const existing = securityKeys.get(key);
    if (existing !== undefined && existing !== posix) {
      throw new ReviewerIsolationUnavailableError();
    }
    securityKeys.set(key, posix);

    const head = headRecords.get(posix);
    if (head && !REGULAR_GIT_MODES.has(head.mode)) {
      throw new ReviewerIsolationUnavailableError();
    }

    const indexList = indexRecords.get(posix) ?? [];
    if (indexList.some((record) => record.stage !== 0)) {
      throw new ReviewerIsolationUnavailableError();
    }
    if (indexList.some((record) => record.tag !== "H")) {
      throw new ReviewerIsolationUnavailableError();
    }
    if (indexList.length > 1) {
      throw new ReviewerIsolationUnavailableError();
    }
    const indexOne = indexList[0];
    if (indexOne && !REGULAR_GIT_MODES.has(indexOne.mode)) {
      throw new ReviewerIsolationUnavailableError();
    }

    members.set(posix, {
      path: posix,
      h: head,
      i: indexOne ? { mode: indexOne.mode, oid: indexOne.oid } : undefined,
      w: undefined,
    });
  }
  return members;
}

function extantCandidatePaths(
  members: Map<string, Member>,
  otherPaths: Set<string>,
  scope: readonly ScopeRule[],
): Set<string> {
  const extant = new Set<string>();
  for (const posix of otherPaths) {
    if (isAdmitted(posix, scope)) {
      extant.add(posix);
    }
  }
  for (const member of members.values()) {
    if (member.i) {
      extant.add(member.path);
    }
  }
  return extant;
}

function safeReadFile(
  absPath: string,
  seam: SafeReadSeam | undefined = undefined,
): { bytes: Buffer; gitMode: string } {
  const flags = workspaceSafeOpenFlags();
  seam?.beforeOpen?.(absPath);
  let fd: number;
  try {
    fd = openSync(absPath, flags);
  } catch (error) {
    if (isNotFound(error)) {
      throw error;
    }
    throw new ReviewerIsolationUnavailableError();
  }
  try {
    const first = fstatSync(fd);
    if (!first.isFile() || first.isFIFO() || first.isSocket() || first.isCharacterDevice() || first.isBlockDevice()) {
      throw new ReviewerIsolationUnavailableError();
    }
    seam?.afterFirstStat?.(absPath);
    const bytes = readFd(fd, first.size);
    const second = fstatSync(fd);
    if (!sameIdentity(first, second)) {
      throw new ReviewerIsolationUnavailableError();
    }
    return { bytes, gitMode: gitModeFromStat(first.mode) };
  } finally {
    closeSync(fd);
  }
}

function readFd(fd: number, size: number): Buffer {
  if (size === 0) {
    return Buffer.alloc(0);
  }
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new ReviewerIsolationUnavailableError();
  }
  const buf = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const n = readSync(fd, buf, offset, size - offset, offset);
    if (n === 0) {
      throw new ReviewerIsolationUnavailableError();
    }
    offset += n;
  }
  return buf;
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    nsStamp(left, "mtime") === nsStamp(right, "mtime") &&
    nsStamp(left, "ctime") === nsStamp(right, "ctime")
  );
}

function nsStamp(stat: Stats, kind: "mtime" | "ctime"): string {
  const ns = kind === "mtime" ? (stat as Stats & { mtimeNs?: bigint }).mtimeNs : (stat as Stats & { ctimeNs?: bigint }).ctimeNs;
  if (typeof ns === "bigint") {
    return ns.toString();
  }
  const ms = kind === "mtime" ? stat.mtimeMs : stat.ctimeMs;
  return Math.round(ms * 1e6).toString();
}

function gitModeFromStat(mode: number): string {
  return (mode & 0o111) !== 0 ? "100755" : "100644";
}

type IsolatedGit = {
  env: NodeJS.ProcessEnv;
  cwd: string;
  gitDir: string;
  emptyTree: string;
  attributesFile: string;
};

async function createIsolatedGit(
  git: (request: GitSpawnRequest) => Promise<Buffer>,
  runDir: string,
  stagingRoot: string,
  odbRoot: string,
): Promise<IsolatedGit> {
  const home = path.join(stagingRoot, "home");
  const template = path.join(stagingRoot, "template");
  const cwd = path.join(stagingRoot, "cwd");
  const attributesFile = path.join(stagingRoot, "empty-attributes");
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  await fs.mkdir(template, { recursive: true, mode: 0o700 });
  await fs.mkdir(cwd, { recursive: true, mode: 0o700 });
  await fs.writeFile(attributesFile, Buffer.alloc(0), { mode: 0o600 });
  const env = buildSourceEnv();
  env.HOME = home;
  await git({
    args: ["init", "--bare", `--template=${template}`, odbRoot],
    cwd,
    env,
    stdoutCap: 64 * 1024,
    timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
  });
  const gitDir = await fs.realpath(odbRoot);
  try {
    lstatSync(path.join(gitDir, "info", "attributes"));
    throw new ReviewerIsolationUnavailableError();
  } catch (error) {
    if (error instanceof ReviewerIsolationUnavailableError) {
      throw error;
    }
    if (!isNotFound(error)) {
      throw toIsolationError(error);
    }
  }
  const emptyTree = (await git({
    args: [`--git-dir=${gitDir}`, "mktree"],
    cwd,
    env,
    stdin: Buffer.alloc(0),
    stdoutCap: 4096,
    timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
  }))
    .toString("utf8")
    .trim();
  if (!OID_RE.test(emptyTree)) {
    throw new ReviewerIsolationUnavailableError();
  }
  return { env, cwd, gitDir, emptyTree, attributesFile };
}

async function revParseHead(
  git: (request: GitSpawnRequest) => Promise<Buffer>,
  canonicalRoot: string,
  identity: GitIdentity,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const output = await git({
    args: sourceArgs(identity, canonicalRoot, ["rev-parse", "HEAD"]),
    cwd: canonicalRoot,
    env,
    stdoutCap: 4096,
    timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
  });
  const oid = output.toString("utf8").trim();
  if (!OID_RE.test(oid)) {
    throw new ReviewerIsolationUnavailableError();
  }
  return oid;
}

async function catFileBatch(
  git: (request: GitSpawnRequest) => Promise<Buffer>,
  canonicalRoot: string,
  identity: GitIdentity,
  env: NodeJS.ProcessEnv,
  oids: string[],
): Promise<Map<string, Buffer>> {
  const blobs = new Map<string, Buffer>();
  if (oids.length === 0) {
    return blobs;
  }
  const stdin = Buffer.from(`${oids.join("\n")}\n`, "utf8");
  const output = await git({
    args: sourceArgs(identity, canonicalRoot, ["cat-file", "--batch"]),
    cwd: canonicalRoot,
    env,
    stdin,
    stdoutCap: DEFAULT_GIT_STDOUT_CAP,
    timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
  });
  let offset = 0;
  while (offset < output.length) {
    const nl = output.indexOf(0x0a, offset);
    if (nl < 0) {
      throw new ReviewerIsolationUnavailableError();
    }
    const header = output.subarray(offset, nl).toString("utf8");
    if (header.endsWith(" missing")) {
      throw new ReviewerIsolationUnavailableError();
    }
    const match = /^([0-9a-f]+) blob ([0-9]+)$/.exec(header);
    if (!match) {
      throw new ReviewerIsolationUnavailableError();
    }
    const oid = match[1] ?? "";
    const size = Number(match[2]);
    const start = nl + 1;
    const end = start + size;
    if (output.length < end + 1 || output[end] !== 0x0a) {
      throw new ReviewerIsolationUnavailableError();
    }
    blobs.set(oid, Buffer.from(output.subarray(start, end)));
    offset = end + 1;
  }
  if (blobs.size !== oids.length) {
    throw new ReviewerIsolationUnavailableError();
  }
  return blobs;
}

async function hashObject(
  git: (request: GitSpawnRequest) => Promise<Buffer>,
  isolated: IsolatedGit,
  bytes: Uint8Array,
): Promise<string> {
  const output = await git({
    args: [`--git-dir=${isolated.gitDir}`, "hash-object", "-w", "--stdin", "--no-filters"],
    cwd: isolated.cwd,
    env: isolated.env,
    stdin: bytes,
    stdoutCap: 4096,
    timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
  });
  const oid = output.toString("utf8").trim();
  if (!OID_RE.test(oid)) {
    throw new ReviewerIsolationUnavailableError();
  }
  return oid;
}

async function writeTree(
  git: (request: GitSpawnRequest) => Promise<Buffer>,
  isolated: IsolatedGit,
  entries: { path: string; mode: string; oid: string }[],
): Promise<string> {
  const root: TreeLevel = { blobs: new Map(), trees: new Map() };
  for (const entry of entries) {
    insertTreeEntry(root, entry.path.split("/"), entry.mode, entry.oid);
  }
  return writeTreeLevel(git, isolated, root);
}

function insertTreeEntry(node: TreeLevel, parts: string[], mode: string, oid: string): void {
  const name = parts[0];
  if (!name) {
    throw new ReviewerIsolationUnavailableError();
  }
  if (parts.length === 1) {
    if (node.trees.has(name) || node.blobs.has(name)) {
      throw new ReviewerIsolationUnavailableError();
    }
    node.blobs.set(name, { mode, oid });
    return;
  }
  if (node.blobs.has(name)) {
    throw new ReviewerIsolationUnavailableError();
  }
  let child = node.trees.get(name);
  if (!child) {
    child = { blobs: new Map(), trees: new Map() };
    node.trees.set(name, child);
  }
  insertTreeEntry(child, parts.slice(1), mode, oid);
}

async function writeTreeLevel(
  git: (request: GitSpawnRequest) => Promise<Buffer>,
  isolated: IsolatedGit,
  node: TreeLevel,
): Promise<string> {
  type SortEntry = { name: string; isTree: boolean; payload: Buffer };
  const records: SortEntry[] = [];
  for (const [name, blob] of node.blobs) {
    records.push({
      name,
      isTree: false,
      payload: Buffer.from(`${blob.mode} blob ${blob.oid}\t${name}\0`, "utf8"),
    });
  }
  for (const [name, child] of node.trees) {
    const oid = await writeTreeLevel(git, isolated, child);
    records.push({
      name,
      isTree: true,
      payload: Buffer.from(`040000 tree ${oid}\t${name}\0`, "utf8"),
    });
  }
  records.sort((a, b) => {
    const left = Buffer.from(a.isTree ? `${a.name}/` : a.name, "utf8");
    const right = Buffer.from(b.isTree ? `${b.name}/` : b.name, "utf8");
    return Buffer.compare(left, right);
  });
  const stdin = records.length === 0 ? Buffer.alloc(0) : Buffer.concat(records.map((record) => record.payload));
  const output = await git({
    args: [`--git-dir=${isolated.gitDir}`, "mktree", "-z"],
    cwd: isolated.cwd,
    env: isolated.env,
    stdin,
    stdoutCap: 4096,
    timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
  });
  const oid = output.toString("utf8").trim();
  if (!OID_RE.test(oid)) {
    throw new ReviewerIsolationUnavailableError();
  }
  return oid;
}

async function diffTrees(
  git: (request: GitSpawnRequest) => Promise<Buffer>,
  isolated: IsolatedGit,
  baselineTree: string,
  currentTree: string,
): Promise<Buffer> {
  return git({
    args: [
      `--git-dir=${isolated.gitDir}`,
      "-c",
      `core.attributesFile=${isolated.attributesFile}`,
      "-c",
      `attr.tree=${isolated.emptyTree}`,
      "diff-tree",
      "-r",
      "-p",
      "--binary",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      baselineTree,
      currentTree,
    ],
    cwd: isolated.cwd,
    env: isolated.env,
    stdoutCap: PATCH_BYTE_CAP + 1,
    timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
  });
}

function renderChanges(
  baseCommit: string,
  members: Map<string, Member>,
  headBlobs: Map<string, Buffer>,
): string {
  const lines = [`base ${baseCommit}`];
  const paths = [...members.keys()].sort();
  for (const posix of paths) {
    const member = members.get(posix);
    if (!member) {
      continue;
    }
    const h = Boolean(member.h);
    const i = Boolean(member.i);
    const w = Boolean(member.w);
    let status: string | undefined;
    if (h && i && w) {
      const headBytes = member.h ? headBlobs.get(member.h.oid) : undefined;
      const unchanged =
        headBytes !== undefined &&
        member.w !== undefined &&
        member.h !== undefined &&
        headBytes.equals(member.w.bytes) &&
        member.h.mode === member.w.gitMode;
      if (!unchanged) {
        status = "modified";
      }
    } else if (h && i && !w) {
      status = "deleted";
    } else if (h && !i && w) {
      status = "removed-from-index";
    } else if (h && !i && !w) {
      status = "deleted";
    } else if (!h && i && w) {
      status = "added";
    } else if (!h && i && !w) {
      status = "added-then-removed";
    } else if (!h && !i && w) {
      status = "untracked";
    }
    if (status) {
      lines.push(`${status}\t${JSON.stringify(posix)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function freezeWorkspace(root: string): Promise<void> {
  const files: string[] = [];
  const dirs: string[] = [];
  async function walk(abs: string, isRoot: boolean): Promise<void> {
    const stat = await fs.lstat(abs);
    if (stat.isSymbolicLink()) {
      throw new ReviewerIsolationUnavailableError();
    }
    if (stat.isDirectory()) {
      if (!isRoot) {
        dirs.push(abs);
      }
      const names = await fs.readdir(abs);
      for (const name of names) {
        await walk(path.join(abs, name), false);
      }
      return;
    }
    if (stat.isFile()) {
      files.push(abs);
      return;
    }
    throw new ReviewerIsolationUnavailableError();
  }
  await walk(root, true);
  for (const file of files) {
    await fs.chmod(file, 0o444);
  }
  dirs.sort((a, b) => b.length - a.length);
  for (const dir of dirs) {
    await fs.chmod(dir, 0o555);
  }
  await fs.chmod(root, 0o555);
}

function buildManifest(
  baseCommit: string,
  patchByteLength: number,
  baseline: TreeSnapshot,
  members: Map<string, Member>,
): WorkspaceManifest {
  const entries: WorkspaceManifestFileEntry[] = [];
  for (const entry of [...baseline.entries.values()].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))) {
    if (entry.kind !== "file" || entry.hash === undefined) {
      continue;
    }
    if (entry.rel === "diff.patch") {
      entries.push({ path: entry.rel, kind: "patch", size: entry.size, sha256: entry.hash });
      continue;
    }
    if (entry.rel === "changes.txt") {
      entries.push({ path: entry.rel, kind: "change-list", size: entry.size, sha256: entry.hash });
      continue;
    }
    if (!entry.rel.startsWith(`${WORKTREE_PREFIX}/`)) {
      throw new ReviewerIsolationUnavailableError();
    }
    const posix = entry.rel.slice(WORKTREE_PREFIX.length + 1);
    const member = members.get(posix);
    const gitMode = member?.w?.gitMode;
    if (gitMode === undefined) {
      entries.push({ path: entry.rel, kind: "product", size: entry.size, sha256: entry.hash });
    } else {
      entries.push({ path: entry.rel, kind: "product", size: entry.size, sha256: entry.hash, gitMode });
    }
  }
  return { baseCommit, patchByteLength, entries };
}

export type PreparedProducerWorkspace = {
  workspaceRoot: string;
  baseline: TreeSnapshot;
  supportScope: readonly string[];
};

export type ProducerWorkspaceClass = "scratch" | "support" | "admitted" | "refused";

export type CapturedProducerChange = {
  path: string;
  change: SnapshotDiffEntry["change"];
  fields: readonly SnapshotDiffEntry["fields"][number][];
  kind: SnapshotEntryKind;
  bytes: Buffer | null;
  mode: number;
  sha256: string | null;
};

type UndoState =
  | { kind: "absent" }
  | { kind: "file"; bytes: Buffer; mode: number }
  | { kind: "directory"; mode: number };

export type ProducerMergeDestination = {
  path: string;
  abs: string;
  undo: UndoState;
};

export class ProducerMergeError extends Error {
  override readonly name = "ProducerMergeError";
  readonly reason: Extract<ReasonCode, "write_scope_violation" | "runtime_state_violation">;
  readonly unrestored: readonly string[];
  constructor(
    reason: Extract<ReasonCode, "write_scope_violation" | "runtime_state_violation"> = "write_scope_violation",
    unrestored: readonly string[] = [],
  ) {
    super(reason);
    this.reason = reason;
    this.unrestored = [...unrestored];
  }
}

export type ProducerWorkspaceDeps = {
  safeReadSeam?: SafeReadSeam;
};

export type ProducerMergeReadDeps = {
  beforeFileRead?: (abs: string, size: number) => void;
};

export async function prepareProducerWorkspace(
  input: {
    repoRoot: string;
    writeScope: readonly string[];
    supportScope?: readonly string[];
    snapshotCaps?: Pick<SnapshotTreeCaps, "entries" | "hashBytes">;
  },
  deps: ProducerWorkspaceDeps = {},
): Promise<PreparedProducerWorkspace> {
  const repoRoot = await fs.realpath(path.resolve(input.repoRoot));
  const writeRules = parseScope(input.writeScope);
  const supportScope = [...(input.supportScope ?? PRODUCER_SUPPORT_SCOPE)];
  const supportRules = parseScope(supportScope);
  let workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-bridge-producer-"));
  let complete = false;
  try {
    workspaceRoot = await fs.realpath(workspaceRoot);
    await fs.chmod(workspaceRoot, 0o700);
    for (const rule of writeRules) {
      if (rule.kind === "file") {
        await copyExactProducerFile(repoRoot, workspaceRoot, rule.path, deps.safeReadSeam);
      } else {
        const rel = rule.prefix.slice(0, -1);
        await copyProducerTree(repoRoot, workspaceRoot, rel, true, false, deps.safeReadSeam);
      }
    }
    for (const rule of supportRules) {
      if (rule.kind === "file") {
        await copyExactProducerFile(repoRoot, workspaceRoot, rule.path, deps.safeReadSeam, true);
      } else {
        const rel = rule.prefix.slice(0, -1);
        await copyProducerTree(repoRoot, workspaceRoot, rel, false, true, deps.safeReadSeam);
      }
    }
    await ensureWritableSupportScratch(workspaceRoot, supportRules);
    const baseline = await snapshotTree(workspaceRoot, {
      ...input.snapshotCaps,
      policy: "workspace",
      collapsePrefixes: supportScope,
      omitPrefixes: PRODUCER_SCRATCH_PREFIXES,
    });
    complete = true;
    return { workspaceRoot, baseline, supportScope };
  } catch (error) {
    if (error instanceof SnapshotCapError) {
      throw error;
    }
    throw error instanceof ReviewerIsolationUnavailableError ? error : new ReviewerIsolationUnavailableError();
  } finally {
    if (!complete) {
      await cleanupProducerWorkspace(workspaceRoot);
    }
  }
}

async function ensureWritableSupportScratch(workspaceRoot: string, supportRules: readonly ScopeRule[]): Promise<void> {
  if (!supportRules.some((rule) => rule.kind === "dir" && rule.prefix === "node_modules/")) {
    return;
  }
  const supportRoot = path.join(workspaceRoot, "node_modules");
  try {
    const stat = await fs.lstat(supportRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    await fs.chmod(supportRoot, 0o755);
    const cache = path.join(supportRoot, ".cache");
    await fs.mkdir(cache, { recursive: true, mode: 0o700 });
    await fs.chmod(cache, 0o700);
    await fs.chmod(supportRoot, 0o555);
  } catch {
    // An absent support root stays absent; support is not an authority grant.
  }
}

async function copyExactProducerFile(
  sourceRoot: string,
  destinationRoot: string,
  rel: string,
  seam?: SafeReadSeam,
  readOnly = false,
): Promise<void> {
  const parts = validateRepositoryPath(rel).split("/");
  let sourceParent = sourceRoot;
  const ancestorModes: number[] = [];
  for (const part of parts.slice(0, -1)) {
    sourceParent = path.join(sourceParent, part);
    let stat: Stats;
    try {
      stat = await fs.lstat(sourceParent);
    } catch {
      return;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return;
    }
    ancestorModes.push(stat.mode & 0o777);
  }

  let destinationParent = destinationRoot;
  const ancestors: { abs: string; mode: number }[] = [];
  try {
    for (const [index, part] of parts.slice(0, -1).entries()) {
      destinationParent = path.join(destinationParent, part);
      const mode = ancestorModes[index] ?? 0o755;
      await mkdirIfAbsent(destinationParent, mode | 0o700);
      await fs.chmod(destinationParent, mode | 0o700);
      ancestors.push({ abs: destinationParent, mode });
    }
    const leaf = parts.at(-1);
    if (leaf === undefined) {
      return;
    }
    await copyProducerRegularFile(
      path.join(sourceParent, leaf),
      path.join(destinationParent, leaf),
      readOnly,
      seam,
    );
  } finally {
    for (const ancestor of [...ancestors].reverse()) {
      await fs.chmod(ancestor.abs, ancestor.mode);
    }
  }
}

async function copyProducerTree(
  sourceRoot: string,
  destinationRoot: string,
  rel: string,
  writable: boolean,
  support: boolean,
  seam?: SafeReadSeam,
): Promise<void> {
  validateRepositoryPath(rel);
  const source = joinUnder(sourceRoot, rel);
  const destination = joinUnder(destinationRoot, rel);
  let rootStat: Stats;
  try {
    rootStat = await fs.lstat(source);
  } catch {
    return;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    return;
  }
  await fs.mkdir(destination, { recursive: true, mode: writable ? ((rootStat.mode & 0o777) | 0o700) : 0o755 });
  await copyDirectoryMembers(sourceRoot, destinationRoot, rel, writable, support, seam);
}

async function copyDirectoryMembers(
  sourceRoot: string,
  destinationRoot: string,
  relDir: string,
  writable: boolean,
  support: boolean,
  seam?: SafeReadSeam,
): Promise<void> {
  const sourceDir = joinUnder(sourceRoot, relDir);
  const destinationDir = joinUnder(destinationRoot, relDir);
  const names = await fs.readdir(sourceDir);
  for (const name of names) {
    const rel = `${relDir}/${name}`;
    validateRepositoryPath(rel);
    const source = joinUnder(sourceRoot, rel);
    const destination = joinUnder(destinationRoot, rel);
    let stat: Stats;
    try {
      stat = await fs.lstat(source);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) {
      if (support) {
        await recreateContainedSupportLink(source, destination, rel);
      }
      continue;
    }
    if (stat.isDirectory()) {
      await fs.mkdir(destination, { mode: 0o755 });
      await copyDirectoryMembers(sourceRoot, destinationRoot, rel, writable, support, seam);
      const scratch = isPrefixMember(rel, "node_modules/.cache/");
      await fs.chmod(destination, writable || scratch ? ((stat.mode & 0o777) | 0o700) : 0o555);
      continue;
    }
    if (stat.isFile()) {
      await copyProducerRegularFile(source, destination, !writable && !isPrefixMember(rel, "node_modules/.cache/"), seam);
    }
  }
  const dirStat = await fs.stat(sourceDir);
  const scratch = isPrefixMember(relDir, "node_modules/.cache/");
  await fs.chmod(destinationDir, writable || scratch ? ((dirStat.mode & 0o777) | 0o700) : 0o555);
}

async function recreateContainedSupportLink(source: string, destination: string, rel: string): Promise<void> {
  const target = await fs.readlink(source);
  if (path.posix.isAbsolute(target)) {
    return;
  }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), target));
  if (!isPrefixMember(resolved, "node_modules/")) {
    return;
  }
  await fs.symlink(target, destination);
}

async function copyProducerRegularFile(
  source: string,
  destination: string,
  readOnly: boolean,
  seam?: SafeReadSeam,
): Promise<void> {
  const read = safeReadProducerFile(source, seam);
  if (read === null) return;
  const sourceMode = Number.parseInt(read.gitMode, 8) & 0o777;
  const mode = readOnly ? (0o444 | (sourceMode & 0o111)) : (sourceMode | 0o600);
  await fs.writeFile(destination, read.bytes, { flag: "wx", mode });
  await fs.chmod(destination, mode);
}

function safeReadProducerFile(
  absPath: string,
  seam: SafeReadSeam | undefined,
): { bytes: Buffer; gitMode: string } | null {
  seam?.beforeOpen?.(absPath);
  let fd: number;
  try {
    fd = openSync(absPath, workspaceSafeOpenFlags());
  } catch (error) {
    // A member that vanished or became a symlink during traversal is recorded
    // absent. Other open failures make preparation fail closed.
    if (isNotFound(error) || isCode(error, "ELOOP")) return null;
    throw new ReviewerIsolationUnavailableError();
  }
  try {
    const first = fstatSync(fd);
    if (!first.isFile() || first.isFIFO() || first.isSocket() || first.isCharacterDevice() || first.isBlockDevice()) {
      return null;
    }
    seam?.afterFirstStat?.(absPath);
    const bytes = readFd(fd, first.size);
    const second = fstatSync(fd);
    if (!sameIdentity(first, second)) throw new ReviewerIsolationUnavailableError();
    return { bytes, gitMode: gitModeFromStat(first.mode) };
  } finally {
    closeSync(fd);
  }
}

async function mkdirIfAbsent(abs: string, mode: number): Promise<void> {
  try {
    await fs.mkdir(abs, { mode });
  } catch (error) {
    if (!isCode(error, "EEXIST")) {
      throw error;
    }
  }
}

export function classifyProducerWorkspacePath(
  posix: string,
  writeScope: readonly string[],
  supportScope: readonly string[] = PRODUCER_SUPPORT_SCOPE,
): ProducerWorkspaceClass {
  if (PRODUCER_SCRATCH_PREFIXES.some((prefix) => isPrefixMember(posix, prefix))) {
    return "scratch";
  }
  if (supportScope.some((prefix) => isPrefixMember(posix, prefix))) {
    return "support";
  }
  if (isPathAdmittedByScope(posix, writeScope)) {
    return "admitted";
  }
  return "refused";
}

export function isStructuralProducerDirectoryDiff(
  entry: SnapshotDiffEntry,
  baseline: TreeSnapshot,
  after: TreeSnapshot,
): boolean {
  if (entry.change !== "changed" || entry.fields.some((field) => field !== "size" && field !== "mtimeNs")) {
    return false;
  }
  const left = baseline.entries.get(entry.path);
  const right = after.entries.get(entry.path);
  return left?.kind === "directory" && right?.kind === "directory" && left.mode === right.mode;
}

export async function captureProducerMerge(input: {
  workspaceRoot: string;
  baseline: TreeSnapshot;
  after: TreeSnapshot;
  writeScope: readonly string[];
  supportScope?: readonly string[];
}, deps: ProducerMergeReadDeps = {}): Promise<CapturedProducerChange[]> {
  const workspaceRoot = await fs.realpath(input.workspaceRoot);
  const captured: CapturedProducerChange[] = [];
  let capturedBytes = 0;
  const diff = workspaceDiff(input.baseline, input.after).filter(
    (entry) => entry.path !== "." && !isStructuralProducerDirectoryDiff(entry, input.baseline, input.after),
  );
  for (const entry of diff) {
    const classification = classifyProducerWorkspacePath(entry.path, input.writeScope, input.supportScope);
    if (classification === "scratch") {
      continue;
    }
    if (classification !== "admitted" || isAuthorityWritePath(entry.path) || producerPathDenied(entry.path)) {
      throw new ProducerMergeError();
    }
    try {
      validateRepositoryPath(entry.path);
    } catch {
      throw new ProducerMergeError();
    }
    if (entry.change === "changed" && entry.fields.includes("mode")) {
      throw new ProducerMergeError();
    }
    if (captured.length >= PRODUCER_MERGE_ENTRY_CAP) {
      throw new ProducerMergeError();
    }
    if (entry.change === "vanished") {
      const kind = input.baseline.entries.get(entry.path)?.kind;
      if (kind !== "file" && kind !== "directory") {
        throw new ProducerMergeError();
      }
      captured.push({ path: entry.path, change: entry.change, fields: entry.fields, kind, bytes: null, mode: 0, sha256: null });
      continue;
    }
    const snapshot = input.after.entries.get(entry.path);
    if (snapshot?.kind !== "file" && snapshot?.kind !== "directory") {
      throw new ProducerMergeError();
    }
    const abs = joinUnder(workspaceRoot, entry.path);
    if (snapshot.kind === "directory") {
      const stat = safeOpenStat(abs, true);
      captured.push({ path: entry.path, change: entry.change, fields: entry.fields, kind: "directory", bytes: null, mode: stat.mode & 0o7777, sha256: null });
      continue;
    }
    const remainingBytes = PRODUCER_MERGE_BYTE_CAP - capturedBytes;
    if (snapshot.size > remainingBytes) {
      throw new ProducerMergeError();
    }
    const read = safeOpenRegular(abs, remainingBytes, deps.beforeFileRead);
    if (read.stat.nlink !== 1) {
      throw new ProducerMergeError();
    }
    capturedBytes += read.bytes.byteLength;
    if (capturedBytes > PRODUCER_MERGE_BYTE_CAP) {
      throw new ProducerMergeError();
    }
    captured.push({
      path: entry.path,
      change: entry.change,
      fields: entry.fields,
      kind: "file",
      bytes: read.bytes,
      mode: read.stat.mode & 0o7777,
      sha256: sha256Bytes(read.bytes),
    });
  }
  return captured;
}

function safeOpenStat(abs: string, directory: boolean): Stats {
  let fd: number;
  try {
    fd = openSync(abs, workspaceSafeOpenFlags() | (directory ? fsConstants.O_DIRECTORY : 0));
  } catch {
    throw new ProducerMergeError();
  }
  try {
    const stat = fstatSync(fd);
    if ((directory && !stat.isDirectory()) || (!directory && !stat.isFile())) {
      throw new ProducerMergeError();
    }
    return stat;
  } finally {
    closeSync(fd);
  }
}

function safeOpenRegular(
  abs: string,
  maxBytes: number,
  beforeFileRead?: (abs: string, size: number) => void,
): { stat: Stats; bytes: Buffer } {
  let fd: number;
  try {
    fd = openSync(abs, workspaceSafeOpenFlags());
  } catch {
    throw new ProducerMergeError();
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) {
      throw new ProducerMergeError();
    }
    beforeFileRead?.(abs, stat.size);
    return { stat, bytes: readFd(fd, stat.size) };
  } finally {
    closeSync(fd);
  }
}

export async function resolveMergeDestinations(input: {
  repoRoot: string;
  captured: readonly CapturedProducerChange[];
}, deps: ProducerMergeReadDeps = {}): Promise<ProducerMergeDestination[]> {
  const repoRoot = await fs.realpath(path.resolve(input.repoRoot));
  const unique = new Set<string>();
  const plannedDirectories = new Set(
    input.captured.filter((entry) => entry.change === "appeared" && entry.kind === "directory").map((entry) => entry.path),
  );
  let bytes = input.captured.reduce((total, entry) => total + (entry.bytes?.byteLength ?? 0), 0);
  const destinations: ProducerMergeDestination[] = [];
  for (const entry of input.captured) {
    if (unique.has(entry.path)) {
      throw new ProducerMergeError();
    }
    unique.add(entry.path);
    const abs = joinUnder(repoRoot, entry.path);
    const existing = trySafeDestination(abs, PRODUCER_MERGE_BYTE_CAP - bytes, deps.beforeFileRead);
    let undo: UndoState;
    if (existing === null) {
      if (entry.change !== "appeared") {
        throw new ProducerMergeError();
      }
      await validateMissingTopology(repoRoot, entry.path, plannedDirectories);
      undo = { kind: "absent" };
    } else if (entry.change === "appeared") {
      throw new ProducerMergeError();
    } else if (entry.kind === "file") {
      if (!existing.stat.isFile() || existing.stat.nlink !== 1) {
        throw new ProducerMergeError();
      }
      bytes += existing.bytes?.byteLength ?? 0;
      undo = { kind: "file", bytes: existing.bytes ?? Buffer.alloc(0), mode: existing.stat.mode & 0o7777 };
    } else {
      if (!existing.stat.isDirectory()) {
        throw new ProducerMergeError();
      }
      undo = { kind: "directory", mode: existing.stat.mode & 0o7777 };
    }
    if (bytes > PRODUCER_MERGE_BYTE_CAP) {
      throw new ProducerMergeError();
    }
    const parent = path.dirname(abs);
    try {
      const names = await fs.readdir(parent);
      if (names.some((name) => name.startsWith(".spartan-bridge-merge-"))) {
        throw new ProducerMergeError();
      }
    } catch (error) {
      if (error instanceof ProducerMergeError) throw error;
      if (!isNotFound(error)) throw new ProducerMergeError();
    }
    destinations.push({ path: entry.path, abs, undo });
  }
  return destinations;
}

function trySafeDestination(
  abs: string,
  maxFileBytes?: number,
  beforeFileRead?: (abs: string, size: number) => void,
): { stat: Stats; bytes: Buffer | null } | null {
  let fd: number;
  try {
    fd = openSync(abs, workspaceSafeOpenFlags());
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw new ProducerMergeError();
  }
  try {
    const stat = fstatSync(fd);
    if (stat.isFile() && maxFileBytes !== undefined && stat.size > maxFileBytes) {
      throw new ProducerMergeError();
    }
    if (stat.isFile() && maxFileBytes !== undefined) {
      beforeFileRead?.(abs, stat.size);
    }
    const bytes = stat.isFile() && maxFileBytes !== undefined ? readFd(fd, stat.size) : null;
    return { stat, bytes };
  } finally {
    closeSync(fd);
  }
}

async function validateMissingTopology(repoRoot: string, posix: string, planned: Set<string>): Promise<void> {
  const parts = posix.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const rel = parts.slice(0, index).join("/");
    const abs = joinUnder(repoRoot, rel);
    const existing = trySafeDestination(abs);
    if (existing !== null) {
      if (!existing.stat.isDirectory()) {
        throw new ProducerMergeError();
      }
      continue;
    }
    if (!planned.has(rel) || isAuthorityWritePath(rel) || producerPathDenied(rel)) {
      throw new ProducerMergeError();
    }
    validateRepositoryPath(rel);
  }
}

type JournalEntry =
  | { action: "unlink"; abs: string; path: string }
  | { action: "rmdir"; abs: string; path: string }
  | { action: "restore-file"; abs: string; path: string; bytes: Buffer; mode: number }
  | { action: "restore-directory"; abs: string; path: string; mode: number };

export type ApplyProducerMergeDeps = {
  afterTemporaryCreated?: (abs: string) => void | Promise<void>;
  afterFileChmod?: (abs: string, expectedMode: number) => void | Promise<void>;
  beforeEntry?: (entry: CapturedProducerChange, index: number) => void | Promise<void>;
  rollbackEntry?: (entry: JournalEntry) => void | Promise<void>;
};

export async function applyProducerMerge(
  input: {
    repoRoot: string;
    captured: readonly CapturedProducerChange[];
    destinations: readonly ProducerMergeDestination[];
    runId?: string;
  },
  deps: ApplyProducerMergeDeps = {},
): Promise<void> {
  if (input.captured.length !== input.destinations.length) {
    throw new ProducerMergeError();
  }
  const destinationByPath = new Map(input.destinations.map((item) => [item.path, item]));
  const ordered = orderProducerChanges(input.captured);
  const journal: JournalEntry[] = [];
  try {
    for (let index = 0; index < ordered.length; index += 1) {
      const entry = ordered[index];
      if (entry === undefined) continue;
      await deps.beforeEntry?.(entry, index);
      const destination = destinationByPath.get(entry.path);
      if (destination === undefined) throw new ProducerMergeError();
      await applyOneProducerChange(entry, destination, journal, input.runId ?? "round", index, deps);
    }
  } catch {
    const unrestored = await rollbackProducerJournal(journal, deps);
    if (unrestored.length > 0) {
      throw new ProducerMergeError("runtime_state_violation", unrestored);
    }
    throw new ProducerMergeError();
  }
}

function orderProducerChanges(changes: readonly CapturedProducerChange[]): CapturedProducerChange[] {
  const depth = (entry: CapturedProducerChange): number => entry.path.split("/").length;
  const rank = (entry: CapturedProducerChange): number => {
    if (entry.change === "appeared" && entry.kind === "directory") return 0;
    if (entry.kind === "file" && entry.change !== "vanished") return 1;
    if (entry.kind === "file") return 2;
    return 3;
  };
  return [...changes].sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? depth(a) - depth(b) : rank(a) === 3 ? depth(b) - depth(a) : a.path.localeCompare(b.path)));
}

async function applyOneProducerChange(
  entry: CapturedProducerChange,
  destination: ProducerMergeDestination,
  journal: JournalEntry[],
  runId: string,
  index: number,
  deps: ApplyProducerMergeDeps,
): Promise<void> {
  if (entry.change === "appeared" && entry.kind === "directory") {
    await fs.mkdir(destination.abs, { mode: entry.mode & 0o777 });
    journal.push({ action: "rmdir", abs: destination.abs, path: entry.path });
    safeChmod(destination.abs, entry.mode & 0o777, true);
    return;
  }
  if (entry.change === "appeared" && entry.kind === "file") {
    const handle = await safeCreate(destination.abs, entry.mode & 0o777);
    journal.push({ action: "unlink", abs: destination.abs, path: entry.path });
    try {
      await handle.writeFile(entry.bytes ?? Buffer.alloc(0));
      await handle.chmod(entry.mode & 0o777);
    } finally {
      await handle.close();
    }
    return;
  }
  if (entry.change === "changed" && entry.kind === "file") {
    if (destination.undo.kind !== "file") throw new ProducerMergeError();
    const temp = path.join(path.dirname(destination.abs), `.spartan-bridge-merge-${safeRunId(runId)}-${index}.tmp`);
    const handle = await safeCreate(temp, destination.undo.mode & 0o7777);
    const tempJournal: JournalEntry = { action: "unlink", abs: temp, path: path.basename(temp) };
    journal.push(tempJournal);
    try {
      await deps.afterTemporaryCreated?.(temp);
      await handle.writeFile(entry.bytes ?? Buffer.alloc(0));
      await chmodProducerFileVerified(handle, temp, destination.undo.mode, deps);
    } finally {
      await handle.close();
    }
    await fs.rename(temp, destination.abs);
    journal[journal.length - 1] = { action: "restore-file", abs: destination.abs, path: entry.path, bytes: destination.undo.bytes, mode: destination.undo.mode };
    return;
  }
  if (entry.change === "changed" && entry.kind === "directory") {
    return;
  }
  if (entry.change === "vanished" && entry.kind === "file") {
    if (destination.undo.kind !== "file") throw new ProducerMergeError();
    await fs.unlink(destination.abs);
    journal.push({ action: "restore-file", abs: destination.abs, path: entry.path, bytes: destination.undo.bytes, mode: destination.undo.mode });
    return;
  }
  if (entry.change === "vanished" && entry.kind === "directory") {
    if (destination.undo.kind !== "directory") throw new ProducerMergeError();
    await fs.rmdir(destination.abs);
    journal.push({ action: "restore-directory", abs: destination.abs, path: entry.path, mode: destination.undo.mode });
    return;
  }
  throw new ProducerMergeError();
}

async function safeCreate(abs: string, mode: number): Promise<Awaited<ReturnType<typeof fs.open>>> {
  try {
    return await fs.open(abs, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | DARWIN_O_NOFOLLOW_ANY, mode);
  } catch {
    throw new ProducerMergeError();
  }
}

async function chmodProducerFileVerified(
  handle: Awaited<ReturnType<typeof fs.open>>,
  abs: string,
  mode: number,
  deps: ApplyProducerMergeDeps,
): Promise<void> {
  const expectedMode = mode & 0o7777;
  await handle.chmod(expectedMode);
  await deps.afterFileChmod?.(abs, expectedMode);
  const stat = await handle.stat();
  if (!stat.isFile() || (stat.mode & 0o7777) !== expectedMode) {
    throw new ProducerMergeError();
  }
}

function safeRunId(runId: string): string {
  return runId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
}

async function rollbackProducerJournal(journal: readonly JournalEntry[], deps: ApplyProducerMergeDeps): Promise<string[]> {
  const unrestored: string[] = [];
  for (const entry of [...journal].reverse()) {
    try {
      await deps.rollbackEntry?.(entry);
      if (entry.action === "unlink") await fs.unlink(entry.abs);
      if (entry.action === "rmdir") await fs.rmdir(entry.abs);
      if (entry.action === "restore-directory") {
        await fs.mkdir(entry.abs, { mode: entry.mode & 0o7777 });
        safeChmod(entry.abs, entry.mode & 0o7777, true);
      }
      if (entry.action === "restore-file") {
        const temp = `${entry.abs}.rollback-${process.pid}`;
        let tempCreated = false;
        try {
          const handle = await safeCreate(temp, entry.mode & 0o7777);
          tempCreated = true;
          try {
            await handle.writeFile(entry.bytes);
            await chmodProducerFileVerified(handle, temp, entry.mode, deps);
          } finally {
            await handle.close();
          }
          await fs.rename(temp, entry.abs);
          tempCreated = false;
        } catch (error) {
          if (tempCreated) {
            try {
              await fs.unlink(temp);
            } catch {
              unrestored.push(`${entry.path}.rollback-${process.pid}`);
            }
          }
          throw error;
        }
      }
    } catch {
      unrestored.push(entry.path);
    }
  }
  return unrestored;
}

function safeChmod(abs: string, mode: number, directory: boolean): void {
  let fd: number;
  try {
    fd = openSync(abs, workspaceSafeOpenFlags() | (directory ? fsConstants.O_DIRECTORY : 0));
  } catch {
    throw new ProducerMergeError();
  }
  try {
    const stat = fstatSync(fd);
    if ((directory && !stat.isDirectory()) || (!directory && !stat.isFile())) {
      throw new ProducerMergeError();
    }
    fchmodSync(fd, mode);
    if ((fstatSync(fd).mode & 0o7777) !== (mode & 0o7777)) {
      throw new ProducerMergeError();
    }
  } finally {
    closeSync(fd);
  }
}

export async function cleanupProducerWorkspace(workspaceRoot: string | undefined): Promise<void> {
  if (workspaceRoot === undefined || workspaceRoot.length === 0) return;
  try {
    await rmQuiet(workspaceRoot);
  } catch {
    // best-effort; the workspace is outside the repository and disposable
  }
}

function isCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function joinUnder(root: string, posix: string): string {
  const abs = path.resolve(root, ...posix.split("/"));
  assertInside(root, abs);
  return abs;
}

function assertInside(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative === "") {
    return;
  }
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new ReviewerIsolationUnavailableError();
  }
}

function splitNul(buffer: Buffer): Buffer[] {
  const records: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] === 0) {
      if (i > start) {
        records.push(buffer.subarray(start, i));
      }
      start = i + 1;
    }
  }
  if (start !== buffer.length) {
    throw new ReviewerIsolationUnavailableError();
  }
  return records;
}

async function spawnGit(request: GitSpawnRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(GIT_EXECUTABLE, [...request.args], {
        cwd: request.cwd,
        env: request.env,
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      });
    } catch {
      reject(new ReviewerIsolationUnavailableError());
      return;
    }
    let stdout = Buffer.alloc(0);
    let overflow = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, request.timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (overflow) {
        return;
      }
      if (stdout.length + chunk.length > request.stdoutCap) {
        overflow = true;
        child.kill("SIGKILL");
        return;
      }
      stdout = Buffer.concat([stdout, chunk]);
    });
    child.stderr?.on("data", () => {
      // discarded: git diagnostics must not enter Bridge logs from this path
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new ReviewerIsolationUnavailableError());
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (overflow || code !== 0) {
        reject(new ReviewerIsolationUnavailableError());
        return;
      }
      resolve(stdout);
    });
    child.stdin?.on("error", () => {
      // EPIPE after a refusing child is mapped on close
    });
    child.stdin?.end(request.stdin ? Buffer.from(request.stdin) : Buffer.alloc(0));
  });
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function toIsolationError(error: unknown): ReviewerIsolationUnavailableError {
  if (error instanceof ReviewerIsolationUnavailableError) {
    return error;
  }
  return new ReviewerIsolationUnavailableError();
}

async function rmQuiet(target: string): Promise<void> {
  let abs = target;
  try {
    abs = path.join(realpathSync(path.dirname(target)), path.basename(target));
    chmodDirsNoFollow(abs);
  } catch {
    // missing parents, planted root symlinks, and unsupported opens skip chmod
  }
  await fs.rm(abs, { recursive: true, force: true });
}

function chmodDirsNoFollow(abs: string): void {
  const flags = fsConstants.O_RDONLY | DARWIN_O_NOFOLLOW_ANY | fsConstants.O_NONBLOCK;
  let fd: number;
  try {
    fd = openSync(abs, flags);
  } catch {
    return;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isDirectory()) {
      return;
    }
    fchmodSync(fd, 0o700);
  } finally {
    closeSync(fd);
  }
  let names: string[];
  try {
    names = readdirSync(abs);
  } catch {
    return;
  }
  for (const name of names) {
    if (name === "." || name === ".." || name.includes("/") || name.includes("\0")) {
      continue;
    }
    chmodDirsNoFollow(path.join(abs, name));
  }
}
