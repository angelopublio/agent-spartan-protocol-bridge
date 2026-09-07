import fs from "node:fs/promises";
import path from "node:path";
import type { TransitionEventDocument, TransitionStatusDocument } from "../core/contracts.ts";
import { parseTransitionStatusJson, serializeTransitionEvent, serializeTransitionStatus } from "../core/serialize.ts";
import { workspaceSafeOpenFlags } from "../core/workspace.ts";
import { createExclusiveRunDir, isInside } from "./paths.ts";

export const RUNTIME_TRANSITION_ID_RE =
  /^transition-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const TRANSITION_STATUS_FILE = "status.json";
export const TRANSITION_EVENTS_FILE = "events.jsonl";

export type TransitionReadFailure = "missing" | "not_contained";

export class TransitionReadError extends Error {
  override readonly name = "TransitionReadError";
  readonly code: TransitionReadFailure;
  constructor(code: TransitionReadFailure) {
    super(code === "not_contained" ? "transition path is not contained" : "transition does not exist");
    this.code = code;
  }
}

export function isRuntimeTransitionId(value: string): boolean {
  return RUNTIME_TRANSITION_ID_RE.test(value);
}

export function transitionDirFor(repoRoot: string, transitionId: string): string {
  return path.join(repoRoot, ".spartan-bridge", "transitions", transitionId);
}

export function isRuntimeTransitionDirContained(repoRoot: string, candidate: string): boolean {
  return isInside(path.join(repoRoot, ".spartan-bridge", "transitions"), candidate);
}

export async function createExclusiveTransitionDir(
  transitionsDir: string,
  repoRoot: string,
  transitionId: string,
): Promise<string> {
  return createExclusiveRunDir(transitionsDir, repoRoot, transitionId);
}

export async function writeTransitionStatusAtomic(
  transitionDir: string,
  status: TransitionStatusDocument,
): Promise<void> {
  const target = path.join(transitionDir, TRANSITION_STATUS_FILE);
  const temp = path.join(transitionDir, `.status.json.${process.pid}.tmp`);
  await fs.writeFile(temp, serializeTransitionStatus(status), { encoding: "utf8", mode: 0o600 });
  await fs.rename(temp, target);
}

export async function appendTransitionEvent(
  transitionDir: string,
  event: TransitionEventDocument,
): Promise<void> {
  const file = path.join(transitionDir, TRANSITION_EVENTS_FILE);
  await fs.appendFile(file, serializeTransitionEvent(event), { encoding: "utf8", mode: 0o600 });
}

export async function readTransitionStatusBytes(transitionDir: string): Promise<Buffer> {
  return fs.readFile(path.join(transitionDir, TRANSITION_STATUS_FILE));
}

export async function readTransitionStatus(transitionDir: string): Promise<TransitionStatusDocument> {
  const text = await fs.readFile(path.join(transitionDir, TRANSITION_STATUS_FILE), "utf8");
  return parseTransitionStatusJson(text);
}

export async function readTransitionEvents(transitionDir: string): Promise<string> {
  return fs.readFile(path.join(transitionDir, TRANSITION_EVENTS_FILE), "utf8");
}

// Test-only hook fired after every path-shape/containment check has passed but
// immediately before the single whole-path no-follow `open`, so a regression
// test can plant a parent-directory symlink at the most adversarial instant:
// the exact moment a naive check-then-open implementation would have already
// finished checking and would be about to follow the swapped component.
export type TransitionReadSeam = {
  beforeOpen?: (absPath: string) => void | Promise<void>;
};

export async function readContainedTransitionStatusBytes(
  repoRoot: string,
  transitionId: string,
  seam?: TransitionReadSeam,
): Promise<Buffer> {
  return readContainedTransitionFile(repoRoot, transitionId, TRANSITION_STATUS_FILE, seam);
}

export async function readContainedTransitionEvents(
  repoRoot: string,
  transitionId: string,
  seam?: TransitionReadSeam,
): Promise<string> {
  return (await readContainedTransitionFile(repoRoot, transitionId, TRANSITION_EVENTS_FILE, seam)).toString("utf8");
}

// A separate `lstat` of the transition directory followed later by a distinct
// `open` of the file leaves a window in which a parent directory can be
// replaced by a symlink between the two syscalls; only the final path
// component was ever protected by plain `O_NOFOLLOW`. `workspaceSafeOpenFlags`
// reuses the same Darwin whole-path no-follow mechanism already relied on by
// the reviewer workspace reader (`core/workspace.ts`) instead of a second,
// weaker constant: the kernel refuses the single `open` call atomically if any
// component of the path - not just the last one - is a symlink, so no
// replacement race between a check and a later open exists to win. There is no
// portable equivalent, so this fails closed off Darwin rather than falling
// back to the racy per-component check.
async function readContainedTransitionFile(
  repoRoot: string,
  transitionId: string,
  filename: typeof TRANSITION_STATUS_FILE | typeof TRANSITION_EVENTS_FILE,
  seam?: TransitionReadSeam,
): Promise<Buffer> {
  if (!isRuntimeTransitionId(transitionId)) {
    throw new TransitionReadError("missing");
  }
  const transitionDir = transitionDirFor(repoRoot, transitionId);
  if (!isRuntimeTransitionDirContained(repoRoot, transitionDir)) {
    throw new TransitionReadError("not_contained");
  }
  const abs = path.join(transitionDir, filename);
  if (!isInside(transitionDir, abs) || path.basename(abs) !== filename) {
    throw new TransitionReadError("not_contained");
  }
  let flags: number;
  try {
    flags = workspaceSafeOpenFlags();
  } catch {
    throw new TransitionReadError("missing");
  }
  await seam?.beforeOpen?.(abs);
  let handle;
  try {
    handle = await fs.open(abs, flags);
  } catch {
    throw new TransitionReadError("missing");
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) {
      throw new TransitionReadError("missing");
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
