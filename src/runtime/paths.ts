import fs from "node:fs/promises";
import { lstatSync } from "node:fs";
import path from "node:path";

export class UnsafeRuntimePathError extends Error {
  override readonly name = "UnsafeRuntimePathError";
  constructor(message = "unsafe runtime path") {
    super(message);
  }
}

export class TaskPathInvalidError extends Error {
  override readonly name = "TaskPathInvalidError";
  constructor() {
    super("path_invalid");
  }
}

export async function resolveReadableDirectory(input: string): Promise<string> {
  try {
    const resolved = path.resolve(input);
    const stats = await fs.stat(resolved);
    if (!stats.isDirectory()) {
      throw new Error("not a directory");
    }
    await fs.access(resolved, fs.constants.R_OK);
    return await fs.realpath(resolved);
  } catch {
    throw new Error("repo_unreadable");
  }
}

export async function resolveRuntimeLayout(repoRoot: string): Promise<{
  bridgeDir: string;
  runsDir: string;
  transitionsDir: string;
  locksDir: string;
}> {
  const bridgeDir = path.join(repoRoot, ".spartan-bridge");
  await assertExistingOrCreatable(repoRoot, bridgeDir);
  const runsDir = path.join(bridgeDir, "runs");
  await assertExistingOrCreatable(repoRoot, runsDir);
  const transitionsDir = path.join(bridgeDir, "transitions");
  await assertExistingOrCreatable(repoRoot, transitionsDir);
  const locksDir = path.join(bridgeDir, "locks");
  await assertExistingOrCreatable(repoRoot, locksDir);
  return { bridgeDir, runsDir, transitionsDir, locksDir };
}

export async function createExclusiveRunDir(runsDir: string, repoRoot: string, runId: string): Promise<string> {
  if (!/^[A-Za-z0-9._-]+$/.test(runId) || runId.includes("..")) {
    throw new UnsafeRuntimePathError();
  }
  await fs.mkdir(runsDir, { recursive: true });
  const realRuns = await fs.realpath(runsDir);
  if (!isInside(repoRoot, realRuns)) {
    throw new UnsafeRuntimePathError();
  }
  const runDir = path.join(realRuns, runId);
  await assertExistingOrCreatable(repoRoot, runDir);
  try {
    await fs.mkdir(runDir, { recursive: false });
  } catch {
    throw new UnsafeRuntimePathError();
  }
  const realRun = await fs.realpath(runDir);
  if (!isInside(repoRoot, realRun)) {
    await fs.rm(runDir, { recursive: true, force: true });
    throw new UnsafeRuntimePathError();
  }
  return realRun;
}

export async function resolveContainedTaskPath(repoRoot: string, taskPath: string): Promise<string> {
  if (path.isAbsolute(taskPath) || taskPath.length === 0) {
    throw new TaskPathInvalidError();
  }
  const posix = taskPath.replaceAll("\\", "/");
  if (posix.startsWith("/") || posix.split("/").includes("..") || posix.split("/").includes("")) {
    throw new TaskPathInvalidError();
  }
  const abs = path.resolve(repoRoot, taskPath);
  if (!isInside(repoRoot, abs)) {
    throw new TaskPathInvalidError();
  }
  try {
    const stat = lstatSync(abs);
    if (stat.isSymbolicLink()) {
      const real = await fs.realpath(abs);
      if (!isInside(repoRoot, real)) {
        throw new TaskPathInvalidError();
      }
    }
  } catch (error) {
    if (error instanceof TaskPathInvalidError) {
      throw error;
    }
  }
  if (!isInside(repoRoot, abs)) {
    throw new TaskPathInvalidError();
  }
  return abs;
}

export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function assertExistingOrCreatable(root: string, target: string): Promise<void> {
  if (!isInside(root, target)) {
    throw new UnsafeRuntimePathError();
  }
  try {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) {
      const real = await fs.realpath(target);
      if (!isInside(root, real)) {
        throw new UnsafeRuntimePathError();
      }
    } else if (stat.isFile()) {
      throw new UnsafeRuntimePathError();
    } else if (stat.isDirectory()) {
      const real = await fs.realpath(target);
      if (!isInside(root, real)) {
        throw new UnsafeRuntimePathError();
      }
    }
  } catch (error) {
    if (error instanceof UnsafeRuntimePathError) {
      throw error;
    }
    const parent = path.dirname(target);
    if (parent !== root && parent !== target) {
      try {
        const parentStat = lstatSync(parent);
        if (parentStat.isSymbolicLink()) {
          const realParent = await fs.realpath(parent);
          if (!isInside(root, realParent)) {
            throw new UnsafeRuntimePathError();
          }
        }
      } catch (parentError) {
        if (parentError instanceof UnsafeRuntimePathError) {
          throw parentError;
        }
      }
    }
  }
}
