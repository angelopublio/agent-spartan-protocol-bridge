import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { cliChildEnv, spawnCliChild } from "./helpers.ts";

const TESTS_ROOT = import.meta.dirname;
const NO_COLOR_ALLOWED_FILES = new Set(["child-env.test.ts", "helpers.ts"]);

async function regularFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await regularFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

test("cliChildEnv removes FORCE_COLOR, pins NO_COLOR, and leaves its input unchanged", () => {
  const input: NodeJS.ProcessEnv = { FORCE_COLOR: "1", NO_COLOR: "0", KEEP: "x" };
  const result = cliChildEnv(input);

  assert.equal(Object.hasOwn(result, "FORCE_COLOR"), false);
  assert.equal(result.NO_COLOR, "1");
  assert.equal(result.KEEP, "x");
  assert.deepEqual(input, { FORCE_COLOR: "1", NO_COLOR: "0", KEEP: "x" });
});

test("spawnCliChild finalizes the color environment at the child boundary", async () => {
  const child = spawnCliChild(
    [
      "-e",
      "process.stdout.write(JSON.stringify([process.env.FORCE_COLOR ?? null, process.env.NO_COLOR ?? null]))",
    ],
    {
      env: { ...process.env, FORCE_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  const code = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (childCode) => resolve(childCode ?? 1));
  });

  assert.equal(code, 0);
  assert.equal(stdout, '[null,"1"]');
});

test("only the child environment helper names NO_COLOR", async () => {
  for (const file of await regularFiles(TESTS_ROOT)) {
    const relative = path.relative(TESTS_ROOT, file).split(path.sep).join("/");
    if (NO_COLOR_ALLOWED_FILES.has(relative)) {
      continue;
    }
    assert.equal((await fs.readFile(file, "utf8")).includes("NO_COLOR"), false, relative);
  }
});
