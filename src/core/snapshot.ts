import fs from "node:fs/promises";
import path from "node:path";
import {
  SNAPSHOT_DIFF_FIELDS,
  type ProducerSnapshotCap,
  type SnapshotDiffEntry,
  type SnapshotDiffField,
} from "./contracts.ts";
import { sha256Bytes } from "./serialize.ts";
import { unicodeDefaultCaseFold } from "./unicode-casefold.ts";

export const SNAPSHOT_ENTRY_CAP = 20_000;
export const SNAPSHOT_HASH_BYTE_CAP = 256 * 1024 * 1024;
export const SNAPSHOT_HASH_FILE_CAP = 1024 * 1024;
// `.claude` and `.cursor` are per-project host-harness state (scheduled-task
// locks, session caches). Like `.spartan-bridge`, they are never product and a
// host driving `/spbridge` can touch them mid-review; excluding them keeps the
// one-writer integrity check from a false `reviewer_write_detected` (D-047).
// `.venv` / `venv` are Python virtualenvs: never product, gitignored,
// rebuildable, and full of symlinks to the system interpreter. Skipping them
// keeps the producer write-scope symlink walk from failing every Python
// consumer repo, and keeps a large venv from blowing the producer snapshot
// caps the way `node_modules` would (D-051). Their symlink residual is the same
// as `node_modules`', documented in `docs/AUTHENTICATION-AND-SECURITY.md`.
export const SKIPPED_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  ".spartan-bridge",
  ".claude",
  ".cursor",
  ".venv",
  "venv",
]);
export const SNAPSHOT_POLICIES = ["repository", "workspace", "producer"] as const;
export type SnapshotPolicy = (typeof SNAPSHOT_POLICIES)[number];

export type SnapshotTreeCaps = {
  entries?: number;
  hashBytes?: number;
  policy?: SnapshotPolicy;
  collapsePrefixes?: readonly string[];
  omitPrefixes?: readonly string[];
};

export type SnapshotEntryKind = "file" | "directory" | "symlink" | "other";

export type SnapshotEntry = {
  rel: string;
  kind: SnapshotEntryKind;
  mode: number;
  size: number;
  hash?: string;
  mtimeNs?: string;
  linkTarget?: string;
};

export type TreeSnapshot = {
  entries: Map<string, SnapshotEntry>;
};

export class SnapshotCapError extends Error {
  override readonly name = "SnapshotCapError";
  constructor(readonly cap: ProducerSnapshotCap) {
    super("reviewer_isolation_unavailable");
  }
}

type WalkState = {
  entries: Map<string, SnapshotEntry>;
  hashedBytes: number;
  entryCap: number;
  hashByteCap: number;
  policy: SnapshotPolicy;
  collapsePrefixes: readonly string[];
  omitPrefixes: readonly string[];
};

export async function snapshotTree(
  root: string,
  caps?: SnapshotTreeCaps,
): Promise<TreeSnapshot> {
  const realRoot = await fs.realpath(root);
  const state: WalkState = {
    entries: new Map(),
    hashedBytes: 0,
    entryCap: caps?.entries ?? SNAPSHOT_ENTRY_CAP,
    hashByteCap: caps?.hashBytes ?? SNAPSHOT_HASH_BYTE_CAP,
    policy: caps?.policy ?? "repository",
    collapsePrefixes: caps?.collapsePrefixes ?? [],
    omitPrefixes: caps?.omitPrefixes ?? [],
  };
  const rootStat = await fs.lstat(realRoot);
  state.entries.set(".", {
    rel: ".",
    kind: rootStat.isDirectory() ? "directory" : "other",
    mode: rootStat.mode & 0o7777,
    size: rootStat.size,
  });
  await walk(realRoot, "", state);
  return { entries: state.entries };
}

async function walk(absDir: string, relDir: string, state: WalkState): Promise<void> {
  const dirents = await fs.readdir(absDir, { withFileTypes: true });
  for (const dirent of dirents) {
    if (state.policy === "repository" && SKIPPED_DIR_NAMES.has(dirent.name)) {
      continue;
    }
    const rel = relDir.length === 0 ? dirent.name : `${relDir}/${dirent.name}`;
    const abs = path.join(absDir, dirent.name);
    if (state.omitPrefixes.some((prefix) => isPrefixMember(rel, prefix))) {
      continue;
    }
    if (state.collapsePrefixes.some((prefix) => isPrefixMember(rel, prefix))) {
      await recordCollapsedEntry(abs, rel, state);
      continue;
    }
    if (state.policy === "producer" && SKIPPED_DIR_NAMES.has(dirent.name)) {
      await recordSkippedProducerEntry(abs, rel, state);
      continue;
    }
    if (state.entries.size >= state.entryCap) {
      throw new SnapshotCapError("entries");
    }
    const stat = await fs.lstat(abs);
    const mode = stat.mode & 0o7777;
    if (stat.isSymbolicLink()) {
      state.entries.set(rel, {
        rel,
        kind: "symlink",
        mode,
        size: stat.size,
        linkTarget: await fs.readlink(abs),
      });
      continue;
    }
    if (stat.isDirectory()) {
      state.entries.set(rel, {
        rel,
        kind: "directory",
        mode,
        size: stat.size,
      });
      await walk(abs, rel, state);
      continue;
    }
    if (stat.isFile()) {
      const entry: SnapshotEntry = {
        rel,
        kind: "file",
        mode,
        size: stat.size,
      };
      const hashFully = state.policy === "workspace" || stat.size <= SNAPSHOT_HASH_FILE_CAP;
      if (hashFully) {
        if (state.hashedBytes + stat.size > state.hashByteCap) {
          throw new SnapshotCapError("hash_bytes");
        }
        const bytes = new Uint8Array(await fs.readFile(abs));
        entry.hash = sha256Bytes(bytes);
        state.hashedBytes += stat.size;
      } else {
        entry.mtimeNs = mtimeNs(stat);
      }
      state.entries.set(rel, entry);
      continue;
    }
    state.entries.set(rel, {
      rel,
      kind: "other",
      mode,
      size: stat.size,
    });
  }
}

async function recordSkippedProducerEntry(abs: string, rel: string, state: WalkState): Promise<void> {
  return recordCollapsedEntry(abs, rel, state, false);
}

async function recordCollapsedEntry(
  abs: string,
  rel: string,
  state: WalkState,
  includeLeafDigest = true,
): Promise<void> {
  if (state.entries.size >= state.entryCap) {
    throw new SnapshotCapError("entries");
  }
  const stat = await fs.lstat(abs);
  const mode = stat.mode & 0o7777;
  if (stat.isSymbolicLink()) {
    const linkTarget = await fs.readlink(abs);
    const entry: SnapshotEntry = {
      rel,
      kind: "symlink",
      mode,
      size: stat.size,
      mtimeNs: mtimeNs(stat),
      linkTarget,
    };
    if (includeLeafDigest) entry.hash = metadataEntryDigest("symlink", stat, linkTarget);
    state.entries.set(rel, entry);
    return;
  }
  if (stat.isDirectory()) {
    state.entries.set(rel, {
      rel,
      kind: "directory",
      mode,
      size: stat.size,
      mtimeNs: mtimeNs(stat),
      hash: await metadataTreeDigest(abs, rel, state.omitPrefixes),
    });
    return;
  }
  if (stat.isFile()) {
    const entry: SnapshotEntry = {
      rel,
      kind: "file",
      mode,
      size: stat.size,
      mtimeNs: mtimeNs(stat),
    };
    if (includeLeafDigest) entry.hash = metadataEntryDigest("file", stat);
    state.entries.set(rel, entry);
    return;
  }
  const entry: SnapshotEntry = {
    rel,
    kind: "other",
    mode,
    size: stat.size,
    mtimeNs: mtimeNs(stat),
  };
  if (includeLeafDigest) entry.hash = metadataEntryDigest("other", stat);
  state.entries.set(rel, entry);
}

function metadataEntryDigest(
  kind: SnapshotEntryKind,
  stat: { mode: number; size: number; mtimeNs?: bigint; mtimeMs: number; ctimeNs?: bigint; ctimeMs: number },
  linkTarget = "",
): string {
  return sha256Bytes([
    kind,
    String(stat.mode & 0o7777),
    String(stat.size),
    mtimeNs(stat),
    ctimeNs(stat),
    linkTarget,
  ].join("\0"));
}

export function producerPathDenied(posix: string): boolean {
  if (posix.normalize("NFC") !== posix) {
    return true;
  }
  for (const part of posix.split("/")) {
    if (SKIPPED_DIR_NAMES.has(unicodeDefaultCaseFold(part))) {
      return true;
    }
  }
  return false;
}

async function metadataTreeDigest(
  absDir: string,
  snapshotRel: string = "",
  omitPrefixes: readonly string[] = [],
): Promise<string> {
  const parts: string[] = [];
  await collectMetadataRecords(absDir, "", snapshotRel, omitPrefixes, parts);
  parts.sort();
  return sha256Bytes(parts.join("\n"));
}

async function collectMetadataRecords(
  absDir: string,
  relDir: string,
  snapshotRel: string,
  omitPrefixes: readonly string[],
  parts: string[],
): Promise<void> {
  const dirents = await fs.readdir(absDir, { withFileTypes: true });
  for (const dirent of dirents) {
    const rel = relDir.length === 0 ? dirent.name : `${relDir}/${dirent.name}`;
    const wholeRel = snapshotRel.length === 0 ? rel : `${snapshotRel}/${rel}`;
    if (omitPrefixes.some((prefix) => isPrefixMember(wholeRel, prefix))) {
      continue;
    }
    const abs = path.join(absDir, dirent.name);
    const stat = await fs.lstat(abs);
    const mode = String(stat.mode & 0o7777);
    const size = String(stat.size);
    const stamp = mtimeNs(stat);
    const changeStamp = ctimeNs(stat);
    if (stat.isSymbolicLink()) {
      parts.push(["symlink", rel, mode, size, stamp, changeStamp, await fs.readlink(abs)].join("\0"));
      continue;
    }
    if (stat.isDirectory()) {
      parts.push(["directory", rel, mode, size, stamp, changeStamp, ""].join("\0"));
      await collectMetadataRecords(abs, rel, snapshotRel, omitPrefixes, parts);
      continue;
    }
    if (stat.isFile()) {
      parts.push(["file", rel, mode, size, stamp, changeStamp, ""].join("\0"));
      continue;
    }
    parts.push(["other", rel, mode, size, stamp, changeStamp, ""].join("\0"));
  }
}

export function isPrefixMember(posix: string, prefix: string): boolean {
  const root = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  return posix === root || posix.startsWith(`${root}/`);
}

function mtimeNs(stat: { mtimeNs?: bigint; mtimeMs: number }): string {
  if (typeof stat.mtimeNs === "bigint") {
    return stat.mtimeNs.toString();
  }
  return Math.round(stat.mtimeMs * 1e6).toString();
}

function ctimeNs(stat: { ctimeNs?: bigint; ctimeMs: number }): string {
  if (typeof stat.ctimeNs === "bigint") {
    return stat.ctimeNs.toString();
  }
  return Math.round(stat.ctimeMs * 1e6).toString();
}

export function snapshotDiff(
  before: TreeSnapshot,
  after: TreeSnapshot,
  excluded: Set<string>,
): SnapshotDiffEntry[] {
  const keys = new Set<string>();
  for (const key of before.entries.keys()) {
    if (!excluded.has(key)) {
      keys.add(key);
    }
  }
  for (const key of after.entries.keys()) {
    if (!excluded.has(key)) {
      keys.add(key);
    }
  }
  const diffs: SnapshotDiffEntry[] = [];
  for (const key of [...keys].sort()) {
    const left = before.entries.get(key);
    const right = after.entries.get(key);
    if (!left && right) {
      diffs.push({ path: key, change: "appeared", fields: presentFields(right) });
      continue;
    }
    if (left && !right) {
      diffs.push({ path: key, change: "vanished", fields: presentFields(left) });
      continue;
    }
    if (left && right) {
      const fields = differingFields(left, right);
      if (fields.length > 0) {
        diffs.push({ path: key, change: "changed", fields });
      }
    }
  }
  return diffs;
}

export function snapshotDiffers(before: TreeSnapshot, after: TreeSnapshot, excluded: Set<string>): boolean {
  return snapshotDiff(before, after, excluded).length > 0;
}

function presentFields(entry: SnapshotEntry): SnapshotDiffField[] {
  return SNAPSHOT_DIFF_FIELDS.filter((field) => entry[field] !== undefined);
}

function differingFields(left: SnapshotEntry, right: SnapshotEntry): SnapshotDiffField[] {
  return SNAPSHOT_DIFF_FIELDS.filter((field) => left[field] !== right[field]);
}

export function posixRel(repoRoot: string, absPath: string): string {
  return path.relative(repoRoot, absPath).split(path.sep).join("/");
}

export function workspaceDiff(before: TreeSnapshot, after: TreeSnapshot): SnapshotDiffEntry[] {
  return snapshotDiff(before, after, new Set());
}

export function workspaceDiffers(before: TreeSnapshot, after: TreeSnapshot): boolean {
  return workspaceDiff(before, after).length > 0;
}
