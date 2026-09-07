import fs from "node:fs/promises";
import path from "node:path";
import { isInside, resolveRuntimeLayout, UnsafeRuntimePathError } from "./paths.ts";

export const WRITER_LOCK_NAME = "writer.lock";

export class WriterLockUnavailableError extends Error {
  override readonly name = "WriterLockUnavailableError";
  readonly transitionId: string | null;
  constructor(transitionId: string | null = null) {
    super("writer_lock_unavailable");
    this.transitionId = transitionId;
  }
}

export type WriterLock = {
  lockPath: string;
  identity: string;
  transitionId: string;
  repoIdentity: string;
};

export async function acquireWriterLock(
  repoRoot: string,
  transitionId: string,
  acquiredAt: string,
): Promise<WriterLock> {
  const { locksDir } = await resolveRuntimeLayout(repoRoot);
  await fs.mkdir(locksDir, { recursive: true, mode: 0o700 });
  const realLocks = await fs.realpath(locksDir);
  if (!isInside(repoRoot, realLocks)) {
    throw new UnsafeRuntimePathError();
  }
  const lockPath = path.join(realLocks, WRITER_LOCK_NAME);
  if (!isInside(repoRoot, lockPath) || !isInside(realLocks, lockPath)) {
    throw new UnsafeRuntimePathError();
  }
  try {
    const existing = await fs.lstat(lockPath);
    if (existing.isSymbolicLink() || existing.isDirectory()) {
      throw new WriterLockUnavailableError(await readHeldTransitionId(lockPath));
    }
    throw new WriterLockUnavailableError(await readHeldTransitionId(lockPath));
  } catch (error) {
    if (error instanceof WriterLockUnavailableError || error instanceof UnsafeRuntimePathError) {
      throw error;
    }
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw new WriterLockUnavailableError(null);
    }
  }
  const payload = `${JSON.stringify({
    transition_id: transitionId,
    // The pid of the process holding the lock (task 0055). `spartan-bridge
    // resume` releases the lock when this pid is dead and the transition is not
    // terminal. Old records without a pid are tolerated by readers.
    pid: process.pid,
    repo_identity: repoRoot,
    acquired_at: acquiredAt,
  })}\n`;
  try {
    await fs.writeFile(lockPath, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      throw new WriterLockUnavailableError(await readHeldTransitionId(lockPath));
    }
    throw new WriterLockUnavailableError(null);
  }
  const realLock = await fs.realpath(lockPath);
  if (!isInside(repoRoot, realLock) || !isInside(realLocks, realLock)) {
    await fs.rm(lockPath, { force: true });
    throw new UnsafeRuntimePathError();
  }
  return {
    lockPath: realLock,
    identity: `.spartan-bridge/locks/${WRITER_LOCK_NAME}`,
    transitionId,
    repoIdentity: repoRoot,
  };
}

export async function releaseWriterLock(lock: WriterLock): Promise<void> {
  const held = await readHeldTransitionId(lock.lockPath);
  if (held !== lock.transitionId) {
    return;
  }
  await fs.unlink(lock.lockPath);
}

async function readHeldTransitionId(lockPath: string): Promise<string | null> {
  try {
    const text = await fs.readFile(lockPath, "utf8");
    const parsed = JSON.parse(text) as { transition_id?: unknown };
    return typeof parsed.transition_id === "string" ? parsed.transition_id : null;
  } catch {
    return null;
  }
}
