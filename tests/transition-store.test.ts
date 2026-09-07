import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  readContainedTransitionEvents,
  readContainedTransitionStatusBytes,
  TransitionReadError,
} from "../src/runtime/transition-store.ts";
import { makeRepo } from "./helpers.ts";

const TRANSITION_ID = "transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STATUS_BYTES = '{"document":"transition"}\n';
const EVENTS_BYTES = '{"type":"authorization"}\n';
const OUTSIDE_SECRET = "OUTSIDE-TRANSITION-RACE-SECRET\n";

async function seedTransition(root: string): Promise<void> {
  const dir = path.join(root, ".spartan-bridge", "transitions", TRANSITION_ID);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "status.json"), STATUS_BYTES, "utf8");
  await fs.writeFile(path.join(dir, "events.jsonl"), EVENTS_BYTES, "utf8");
}

test("an ordinary admitted transition read succeeds", async () => {
  const { root } = await makeRepo();
  const realRoot = await fs.realpath(root);
  await seedTransition(realRoot);
  const bytes = await readContainedTransitionStatusBytes(realRoot, TRANSITION_ID);
  assert.equal(bytes.toString("utf8"), STATUS_BYTES);
  const events = await readContainedTransitionEvents(realRoot, TRANSITION_ID);
  assert.equal(events, EVENTS_BYTES);
  await fs.rm(root, { recursive: true, force: true });
});

test("an unknown transition id fails closed as missing without touching the filesystem", async () => {
  const { root } = await makeRepo();
  const realRoot = await fs.realpath(root);
  await assert.rejects(
    () => readContainedTransitionStatusBytes(realRoot, "transition-not-a-real-id"),
    (error: unknown) => error instanceof TransitionReadError && error.code === "missing",
  );
  await fs.rm(root, { recursive: true, force: true });
});

// The transition-id directory is replaced by a symlink to an outside
// directory at the latest possible instant: after every path-shape check has
// already passed and immediately before the single whole-path no-follow
// `open`. A per-component `O_NOFOLLOW` on only the final path segment would
// still open the outside file through the swapped intermediate directory;
// Darwin whole-path no-follow refuses the entire call because a non-final
// component is now a symlink.
test("a transition-directory replacement raced in immediately before the atomic open cannot leak outside bytes", async () => {
  assert.equal(process.platform, "darwin");
  const { root } = await makeRepo();
  const realRoot = await fs.realpath(root);
  const outsideDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "spartan-transition-race-")));
  await fs.writeFile(path.join(outsideDir, "status.json"), OUTSIDE_SECRET, "utf8");
  await fs.writeFile(path.join(outsideDir, "events.jsonl"), OUTSIDE_SECRET, "utf8");
  const transitionIdDir = path.join(realRoot, ".spartan-bridge", "transitions", TRANSITION_ID);

  for (const readKind of ["status", "events"] as const) {
    await fs.rm(transitionIdDir, { recursive: true, force: true });
    await seedTransition(realRoot);
    const swap = async (): Promise<void> => {
      await fs.rm(transitionIdDir, { recursive: true, force: true });
      await fs.symlink(outsideDir, transitionIdDir);
    };
    const read =
      readKind === "status"
        ? readContainedTransitionStatusBytes(realRoot, TRANSITION_ID, { beforeOpen: swap })
        : readContainedTransitionEvents(realRoot, TRANSITION_ID, { beforeOpen: swap });
    await assert.rejects(
      read,
      (error: unknown) => error instanceof TransitionReadError && error.code === "missing",
      readKind,
    );
  }
  assert.equal(await fs.readFile(path.join(outsideDir, "status.json"), "utf8"), OUTSIDE_SECRET);
  assert.equal(await fs.readFile(path.join(outsideDir, "events.jsonl"), "utf8"), OUTSIDE_SECRET);
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outsideDir, { recursive: true, force: true });
});

// Same race, one level higher: the whole `transitions` directory (a shared
// ancestor of every transition id) is replaced. The final `status.json`
// component is a genuine regular file reached only through the swapped
// ancestor, which a naive re-check of just the leaf would miss entirely.
test("a transitions-root replacement raced in immediately before the atomic open cannot leak outside bytes", async () => {
  assert.equal(process.platform, "darwin");
  const { root } = await makeRepo();
  const realRoot = await fs.realpath(root);
  await seedTransition(realRoot);
  const outsideDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "spartan-transition-race-root-")));
  const outsideTransitionDir = path.join(outsideDir, TRANSITION_ID);
  await fs.mkdir(outsideTransitionDir, { recursive: true });
  await fs.writeFile(path.join(outsideTransitionDir, "status.json"), OUTSIDE_SECRET, "utf8");
  await fs.writeFile(path.join(outsideTransitionDir, "events.jsonl"), OUTSIDE_SECRET, "utf8");
  const transitionsDir = path.join(realRoot, ".spartan-bridge", "transitions");

  const swap = async (): Promise<void> => {
    await fs.rm(transitionsDir, { recursive: true, force: true });
    await fs.symlink(outsideDir, transitionsDir);
  };
  await assert.rejects(
    readContainedTransitionStatusBytes(realRoot, TRANSITION_ID, { beforeOpen: swap }),
    (error: unknown) => error instanceof TransitionReadError && error.code === "missing",
  );
  assert.equal(await fs.readFile(path.join(outsideTransitionDir, "status.json"), "utf8"), OUTSIDE_SECRET);
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outsideDir, { recursive: true, force: true });
});
