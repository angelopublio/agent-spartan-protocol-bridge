import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";
import { createNodeProcessRunner } from "../src/adapters/process.ts";

test("SpawnOutcome.signal is the Node close signal or null", async () => {
  const runner = createNodeProcessRunner();
  const clean = runner.start({
    executable: process.execPath,
    args: ["-e", "process.exit(1)"],
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH },
    timeoutMs: 5_000,
    stdoutCapBytes: 1024,
  });
  const cleanOutcome = await clean.wait();
  assert.equal(cleanOutcome.exitCode, 1);
  assert.equal(cleanOutcome.signal, null);

  const killed = runner.start({
    executable: process.execPath,
    args: ["-e", "process.kill(process.pid, 'SIGKILL')"],
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH },
    timeoutMs: 5_000,
    stdoutCapBytes: 1024,
  });
  const killedOutcome = await killed.wait();
  assert.equal(killedOutcome.signal, "SIGKILL");
  assert.equal(killedOutcome.exitCode, null);
});
