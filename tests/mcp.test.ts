import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLauncherCatalog, FakeAdapter } from "../src/adapters/fake.ts";
import { runReview, type AppDeps, type Clock } from "../src/core/review.ts";
import { serializeStatus } from "../src/core/serialize.ts";
import { MCP_PROTOCOL_VERSION, MAX_LINE_BYTES, REVIEW_TOOL, SERVER_NAME, SERVER_VERSION } from "../src/mcp/protocol.ts";
import { serveMcpStdio } from "../src/mcp/server.ts";
import { RegistryUnavailableError } from "../src/policy/registry.ts";
import {
  blockedResult,
  constantSource,
  fileExists,
  loadRun,
  makeRepo,
  passResult,
  snapshotFiles,
  testClock,
  testDeps,
  validAgentsMd,
  VALID_REGISTRY,
  withStructuredOutput,
} from "./helpers.ts";

const cli = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const mcpDir = fileURLToPath(new URL("../src/mcp", import.meta.url));
const coreDir = fileURLToPath(new URL("../src/core", import.meta.url));
const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));

type RpcObject = Record<string, unknown>;

function incrementingClock(): Clock {
  let seconds = 0;
  let runs = 0;
  let execs = 0;
  return {
    now: () => new Date(Date.UTC(2026, 7, 16, 12, 0, seconds++)),
    createRunId: () => {
      runs += 1;
      return `run-11111111-1111-4111-8111-${String(runs).padStart(12, "1")}`;
    },
    createExecutionId: () => {
      execs += 1;
      return `exec-22222222-2222-4222-8222-${String(execs).padStart(12, "2")}`;
    },
    createTransitionId: () => "transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  };
}

class McpHarness {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  stderrText = "";
  private buffer = "";
  private queued: string[] = [];
  private waiters: Array<(line: string) => void> = [];
  readonly done: Promise<number>;

  constructor(repoRoot: string, deps: AppDeps) {
    this.stderr.on("data", (chunk: Buffer) => {
      this.stderrText += chunk.toString("utf8");
    });
    this.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      let nl = this.buffer.indexOf("\n");
      while (nl !== -1) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        const waiter = this.waiters.shift();
        if (waiter) {
          waiter(line);
        } else {
          this.queued.push(line);
        }
        nl = this.buffer.indexOf("\n");
      }
    });
    this.done = serveMcpStdio({
      repoRoot,
      deps,
      stdin: this.stdin,
      stdout: this.stdout,
      stderr: this.stderr,
    });
  }

  async readLine(timeoutMs = 5000): Promise<string> {
    if (this.queued.length > 0) {
      return this.queued.shift()!;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for MCP stdout line")), timeoutMs);
      this.waiters.push((line) => {
        clearTimeout(timer);
        resolve(line);
      });
    });
  }

  writeRaw(text: string): void {
    this.stdin.write(text);
  }

  async request(id: string | number, method: string, params?: unknown): Promise<RpcObject> {
    const message: RpcObject = { jsonrpc: "2.0", id, method };
    if (params !== undefined) {
      message.params = params;
    }
    this.writeRaw(`${JSON.stringify(message)}\n`);
    const line = await this.readLine();
    assertStdoutHygiene(line);
    return JSON.parse(line) as RpcObject;
  }

  notify(method: string, params?: unknown): void {
    const message: RpcObject = { jsonrpc: "2.0", method };
    if (params !== undefined) {
      message.params = params;
    }
    this.writeRaw(`${JSON.stringify(message)}\n`);
  }

  async close(): Promise<number> {
    this.stdin.end();
    return this.done;
  }
}

function assertStdoutHygiene(line: string): void {
  assert.equal(line.includes("\n"), false);
  const parsed = JSON.parse(line) as RpcObject;
  assert.equal(parsed.jsonrpc, "2.0");
}

function rpcError(response: RpcObject): { code: number; message: string } {
  assert.equal(Object.prototype.hasOwnProperty.call(response, "result"), false);
  const error = response.error as { code: number; message: string };
  assert.deepEqual(Object.keys(error).sort(), ["code", "message"]);
  assert.equal(typeof error.code, "number");
  assert.equal(typeof error.message, "string");
  assert.doesNotMatch(error.message, /at\s+\S+\s+\(/);
  return error;
}

function toolResult(response: RpcObject): { content: Array<{ type: string; text: string }>; isError: boolean } {
  assert.equal(Object.prototype.hasOwnProperty.call(response, "error"), false);
  const result = response.result as {
    content: Array<{ type: string; text: string }>;
    isError: boolean;
  };
  assert.equal(Array.isArray(result.content), true);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0]?.type, "text");
  assert.equal(typeof result.content[0]?.text, "string");
  assert.equal(typeof result.isError, "boolean");
  return result;
}

async function handshake(harness: McpHarness, id: number = 1): Promise<RpcObject> {
  const response = await harness.request(id, "initialize", {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: { roots: { listChanged: true } },
    clientInfo: { name: "test-client", title: "Test Client", version: "1.0.0" },
  });
  harness.notify("notifications/initialized");
  return response;
}

async function listRunIds(root: string): Promise<string[]> {
  const runs = path.join(root, ".spartan-bridge", "runs");
  try {
    return (await fs.readdir(runs)).sort();
  } catch {
    return [];
  }
}

async function mcpSources(): Promise<string> {
  const names = await fs.readdir(mcpDir);
  let text = "";
  for (const name of names) {
    if (name.endsWith(".ts")) {
      text += await fs.readFile(path.join(mcpDir, name), "utf8");
    }
  }
  return text;
}

async function spawnProcess(
  args: string[],
  options?: { env?: NodeJS.ProcessEnv; cwd?: string; stdin?: "pipe" | "ignore" },
): Promise<{ child: ReturnType<typeof spawn>; stdout: () => string; stderr: () => string; wait: () => Promise<number> }> {
  const child = spawn(process.execPath, ["--import", tsxLoader, cli, ...args], {
    env: { ...process.env, NO_COLOR: "1", ...(options?.env ?? {}) },
    cwd: options?.cwd,
    stdio: [options?.stdin ?? "pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const wait = (): Promise<number> =>
    new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve(code ?? 1));
    });
  return { child, stdout: () => stdout, stderr: () => stderr, wait };
}

async function withXdgRegistry(): Promise<{ env: NodeJS.ProcessEnv; cleanup: () => Promise<void> }> {
  const xdg = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-xdg-"));
  await fs.mkdir(path.join(xdg, "spartan-bridge"), { recursive: true });
  await fs.writeFile(path.join(xdg, "spartan-bridge", "client-contexts.yaml"), VALID_REGISTRY, "utf8");
  return {
    env: { ...process.env, XDG_CONFIG_HOME: xdg },
    cleanup: async () => {
      await fs.rm(xdg, { recursive: true, force: true });
    },
  };
}

test("package version is the MCP serverInfo version and protocol constant is declared once", async () => {
  const pkg = JSON.parse(await fs.readFile(packageJsonPath, "utf8")) as { version: string };
  assert.equal(SERVER_VERSION, pkg.version);
  const sources = await mcpSources();
  const matches = sources.match(/MCP_PROTOCOL_VERSION/g);
  assert.ok(matches && matches.length >= 2);
  assert.equal([...sources.matchAll(/"2025-06-18"/g)].length, 1);
});

test("mcp adapter calls runReview, ignores CLI, and does not live in core", async () => {
  const sources = await mcpSources();
  assert.match(sources, /runReview/);
  assert.doesNotMatch(sources, /from ["'][^"']*cli\//);
  assert.doesNotMatch(sources, /console\.log/);
  assert.doesNotMatch(sources, /validateReviewResult/);
  assert.doesNotMatch(sources, /parseAgentsPolicy/);
  assert.doesNotMatch(sources, /VERDICT_TO_TERMINAL/);
  assert.match(sources, /exitCode === 1/);
  assert.doesNotMatch(sources, /status\.state/);
  assert.doesNotMatch(sources, /status\.reason_code/);
  const coreNames = await fs.readdir(coreDir);
  for (const name of coreNames) {
    if (!name.endsWith(".ts")) {
      continue;
    }
    const text = await fs.readFile(path.join(coreDir, name), "utf8");
    assert.doesNotMatch(text, /from ["'][^"']*mcp\//);
  }
});

test("initialize handshake, version echo, ping, and tools/list contract", async () => {
  const { root } = await makeRepo();
  const harness = new McpHarness(root, testDeps());
  try {
    const init = await handshake(harness);
    assert.equal(init.id, 1);
    const result = init.result as RpcObject;
    assert.equal(result.protocolVersion, MCP_PROTOCOL_VERSION);
    assert.deepEqual(result.capabilities, { tools: {} });
    assert.deepEqual(result.serverInfo, { name: SERVER_NAME, version: SERVER_VERSION });
    const pingEmpty = await harness.request(2, "ping");
    assert.deepEqual(pingEmpty.result, {});
    const pingExtra = await harness.request(3, "ping", { unexpected: true });
    assert.deepEqual(pingExtra.result, {});
    const pingOmitted = await harness.request(4, "ping");
    assert.deepEqual(pingOmitted.result, {});
    const listed = await harness.request(5, "tools/list", { cursor: "ignored" });
    const listResult = listed.result as { tools: unknown; nextCursor?: unknown };
    assert.equal(Object.prototype.hasOwnProperty.call(listResult, "nextCursor"), false);
    assert.deepEqual(listResult.tools, [REVIEW_TOOL]);
    const extraInit = await harness.request(6, "initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      extra: true,
    });
    assert.equal(rpcError(extraInit).code, -32600);
  } finally {
    await harness.close();
    await fs.rm(root, { recursive: true, force: true });
  }
  const { root: otherRoot } = await makeRepo();
  const otherHarness = new McpHarness(otherRoot, testDeps());
  try {
    const otherVersion = await otherHarness.request(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "other", version: "0" },
    });
    const echoed = (otherVersion.result as RpcObject).protocolVersion;
    assert.equal(echoed, MCP_PROTOCOL_VERSION);
    assert.notEqual(echoed, "2024-11-05");
  } finally {
    await otherHarness.close();
    await fs.rm(otherRoot, { recursive: true, force: true });
  }
});

test("initialize requires a string protocolVersion and ignores unused members", async () => {
  const { root } = await makeRepo();
  const harness = new McpHarness(root, testDeps());
  try {
    assert.equal(rpcError(await harness.request(1, "initialize")).code, -32602);
    assert.equal(rpcError(await harness.request(2, "initialize", { protocolVersion: 1 })).code, -32602);
    const ok = await harness.request(3, "initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { sampling: {} },
      clientInfo: { name: "host", version: "9" },
      unexpected: { nested: true },
    });
    assert.equal((ok.result as RpcObject).protocolVersion, MCP_PROTOCOL_VERSION);
  } finally {
    await harness.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("initialization gate, unknown methods, and closed-key rejection only on tool arguments", async () => {
  const { root } = await makeRepo();
  const harness = new McpHarness(root, testDeps());
  try {
    assert.equal(rpcError(await harness.request(1, "tools/list")).code, -32600);
    assert.equal(rpcError(await harness.request(2, "tools/call", { name: "review", arguments: { task: "x" } })).code, -32600);
    const ping = await harness.request(3, "ping", { extra: true });
    assert.deepEqual(ping.result, {});
    assert.equal(rpcError(await harness.request(4, "resources/list")).code, -32601);
    await handshake(harness, 5);
    const listed = await harness.request(6, "tools/list", { extra: true, cursor: "c" });
    assert.equal(Object.prototype.hasOwnProperty.call(listed, "error"), false);
    assert.equal(
      rpcError(
        await harness.request(7, "tools/call", {
          name: "review",
          arguments: { task: "spartan/tasks/x.md", repo: root },
        }),
      ).code,
      -32602,
    );
    assert.equal(rpcError(await harness.request(8, "tools/call", { name: "status", arguments: {} })).code, -32601);
    assert.equal(rpcError(await harness.request(9, "tools/call", { name: "review" })).code, -32602);
    assert.equal(rpcError(await harness.request(10, "tools/call", { name: "review", arguments: "x" })).code, -32602);
    assert.equal(rpcError(await harness.request(11, "tools/call", { name: "review", arguments: {} })).code, -32602);
    assert.equal(rpcError(await harness.request(12, "tools/call", { name: "review", arguments: { task: 1 } })).code, -32602);
    assert.equal(rpcError(await harness.request(13, "tools/call", { name: "review", arguments: { task: "" } })).code, -32602);
  } finally {
    await harness.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("jsonrpc parse invalid request batch and notifications produce the closed error surface", async () => {
  const { root } = await makeRepo();
  const harness = new McpHarness(root, testDeps());
  try {
    harness.writeRaw("{not-json\n");
    const parseErrorLine = await harness.readLine();
    assertStdoutHygiene(parseErrorLine);
    const parseError = JSON.parse(parseErrorLine) as RpcObject;
    assert.equal(parseError.id, null);
    assert.equal(rpcError(parseError).code, -32700);
    harness.writeRaw("[]\n");
    const batch = JSON.parse(await harness.readLine()) as RpcObject;
    assert.equal(batch.id, null);
    assert.equal(rpcError(batch).code, -32600);
    harness.writeRaw(`${JSON.stringify({ id: 1, method: "ping" })}\n`);
    const missingVersion = JSON.parse(await harness.readLine()) as RpcObject;
    assert.equal(missingVersion.id, 1);
    assert.equal(rpcError(missingVersion).code, -32600);
    const before = await harness.request(2, "ping");
    assert.deepEqual(before.result, {});
    harness.notify("notifications/initialized");
    harness.notify("notifications/unknown");
    const after = await harness.request(3, "ping");
    assert.equal(after.id, 3);
    assert.deepEqual(after.result, {});
  } finally {
    await harness.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("transport ignores blank lines, tolerates CR, and answers oversize lines with parse error", async () => {
  const { root } = await makeRepo();
  const harness = new McpHarness(root, testDeps());
  try {
    harness.writeRaw("\n\n   \n\r\n");
    harness.writeRaw(`{"jsonrpc":"2.0","id":1,"method":"ping"}\r\n`);
    const ping = JSON.parse(await harness.readLine()) as RpcObject;
    assert.equal(ping.id, 1);
    assert.deepEqual(ping.result, {});
    harness.writeRaw("x".repeat(MAX_LINE_BYTES + 1));
    const oversize = JSON.parse(await harness.readLine()) as RpcObject;
    assert.equal(oversize.id, null);
    assert.equal(rpcError(oversize).code, -32700);
    harness.writeRaw("rest-of-oversize-line\n");
    const resumed = await harness.request(2, "ping");
    assert.deepEqual(resumed.result, {});
  } finally {
    await harness.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("reviewer-terminal blocked is isError false and pre-review blocked is isError true", async () => {
  const blockedRepo = await makeRepo();
  const preReviewRepo = await makeRepo();
  const failedRepo = await makeRepo();
  const blockedHarness = new McpHarness(
    blockedRepo.root,
    testDeps({ source: constantSource(blockedResult()), clock: testClock("run-11111111-1111-4111-8111-111111111111") }),
  );
  const preReviewHarness = new McpHarness(preReviewRepo.root, {
    registry: {
      async load(): Promise<string> {
        throw new RegistryUnavailableError();
      },
    },
    catalog: createLauncherCatalog(() => new FakeAdapter(constantSource(passResult()))),
    clock: testClock("run-11111111-1111-4111-8111-111111111112"),
  });
  const failedHarness = new McpHarness(
    failedRepo.root,
    testDeps({ clock: testClock("run-11111111-1111-4111-8111-111111111113") }),
  );
  try {
    await handshake(blockedHarness);
    const blocked = toolResult(
      await blockedHarness.request(2, "tools/call", {
        name: "review",
        arguments: { task: blockedRepo.taskRel },
      }),
    );
    assert.equal(blocked.isError, false);
    const blockedStatus = JSON.parse(blocked.content[0]!.text) as { state: string; reason_code: string; run_id: string };
    assert.equal(blockedStatus.state, "blocked");
    assert.equal(blockedStatus.reason_code, "review_blocked");
    const { status: persistedBlocked } = await loadRun(blockedRepo.root, blockedStatus.run_id);
    assert.equal(blocked.content[0]!.text, serializeStatus(persistedBlocked));

    await handshake(preReviewHarness);
    const preReview = toolResult(
      await preReviewHarness.request(2, "tools/call", {
        name: "review",
        arguments: { task: preReviewRepo.taskRel },
      }),
    );
    assert.equal(preReview.isError, true);
    const preStatus = JSON.parse(preReview.content[0]!.text) as { state: string; reason_code: string };
    assert.equal(preStatus.state, "blocked");
    assert.equal(preStatus.reason_code, "registry_unavailable");
    assert.notEqual(blocked.isError, preReview.isError);

    await handshake(failedHarness);
    const failed = toolResult(
      await failedHarness.request(2, "tools/call", {
        name: "review",
        arguments: { task: "spartan/tasks/missing.md" },
      }),
    );
    assert.equal(failed.isError, true);
    const failedStatus = JSON.parse(failed.content[0]!.text) as { state: string; reason_code: string };
    assert.equal(failedStatus.state, "failed");
    assert.equal(failedStatus.reason_code, "task_unreadable");
  } finally {
    await blockedHarness.close();
    await preReviewHarness.close();
    await failedHarness.close();
    await fs.rm(blockedRepo.root, { recursive: true, force: true });
    await fs.rm(preReviewRepo.root, { recursive: true, force: true });
    await fs.rm(failedRepo.root, { recursive: true, force: true });
  }
});

test("createdRun false and unexpected core exceptions map to sanitized tool errors", async () => {
  const noRunRepo = await makeRepo();
  const throwRepo = await makeRepo();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-bridge-outside-"));
  await fs.symlink(outside, path.join(noRunRepo.root, ".spartan-bridge"));
  const noRunHarness = new McpHarness(noRunRepo.root, testDeps());
  const throwingHarness = new McpHarness(
    throwRepo.root,
    testDeps({
      clock: {
        now: () => new Date(),
        createRunId: () => {
          throw new Error("internal boom stack at fake.ts:1");
        },
        createExecutionId: () => "exec-x",
        createTransitionId: () => "transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      },
    }),
  );
  try {
    await handshake(noRunHarness);
    const beforeRuns = await fs.readdir(outside);
    const noRun = toolResult(
      await noRunHarness.request(2, "tools/call", { name: "review", arguments: { task: noRunRepo.taskRel } }),
    );
    assert.equal(noRun.isError, true);
    assert.equal(noRun.content[0]!.text.includes("{"), false);
    assert.doesNotMatch(noRun.content[0]!.text, /internal boom|stack|at fake/i);
    assert.deepEqual(await fs.readdir(outside), beforeRuns);
    assert.equal(await fileExists(path.join(noRunRepo.root, ".spartan-bridge", "runs")), false);

    await handshake(throwingHarness);
    const unexpected = await throwingHarness.request(2, "tools/call", {
      name: "review",
      arguments: { task: throwRepo.taskRel },
    });
    assert.equal(Object.prototype.hasOwnProperty.call(unexpected, "error"), false);
    const mapped = toolResult(unexpected);
    assert.equal(mapped.isError, true);
    assert.equal(mapped.content[0]!.text, "review failed");
    assert.doesNotMatch(mapped.content[0]!.text, /internal boom|stack|fake\.ts/);
    assert.deepEqual(await listRunIds(throwRepo.root), []);
  } finally {
    await noRunHarness.close();
    await throwingHarness.close();
    await fs.rm(noRunRepo.root, { recursive: true, force: true });
    await fs.rm(throwRepo.root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("sequential tools/call creates distinct runs matching CLI status text", async () => {
  const { root, taskRel, productRel } = await makeRepo();
  const before = await snapshotFiles(root, [taskRel, productRel, "AGENTS.md"]);
  const harness = new McpHarness(root, testDeps({ source: constantSource(passResult()), clock: incrementingClock() }));
  try {
    await handshake(harness);
    harness.writeRaw(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "review", arguments: { task: taskRel } },
      })}\n${JSON.stringify({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "review", arguments: { task: taskRel } },
      })}\n`,
    );
    const first = JSON.parse(await harness.readLine()) as RpcObject;
    const second = JSON.parse(await harness.readLine()) as RpcObject;
    assert.equal(first.id, 10);
    assert.equal(second.id, 11);
    const firstResult = toolResult(first);
    const secondResult = toolResult(second);
    assert.equal(firstResult.isError, false);
    assert.equal(secondResult.isError, false);
    const firstStatus = JSON.parse(firstResult.content[0]!.text) as {
      run_id: string;
      execution_id: string;
      reason_code: string;
    };
    const secondStatus = JSON.parse(secondResult.content[0]!.text) as {
      run_id: string;
      execution_id: string;
    };
    assert.notEqual(firstStatus.run_id, secondStatus.run_id);
    assert.notEqual(firstStatus.execution_id, secondStatus.execution_id);
    const persisted = await loadRun(root, firstStatus.run_id);
    assert.equal(firstResult.content[0]!.text, serializeStatus(persisted.status));
    assert.deepEqual(
      persisted.events.map((event) => event.type),
      ["run_requested", "policy_resolved", "review_started", "review_result_accepted", "run_terminal"],
    );
    assert.equal(firstStatus.reason_code, "review_passed");
    const after = await snapshotFiles(root, [taskRel, productRel, "AGENTS.md"]);
    assert.deepEqual(after, before);
    assert.equal((await listRunIds(root)).length, 2);
  } finally {
    await harness.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("MCP-created run matches a CLI-created run over identical fixtures", async () => {
  const mcpRepo = await makeRepo();
  const cliRepo = await makeRepo();
  const xdg = await withXdgRegistry();
  const harness = new McpHarness(mcpRepo.root, testDeps({ clock: testClock("run-aaaaaaaa-1111-4111-8111-111111111111") }));
  try {
    const cliClock = testClock("run-bbbbbbbb-1111-4111-8111-111111111111");
    const cliOutcome = await runReview({ repo: cliRepo.root, task: cliRepo.taskRel }, testDeps({ clock: cliClock }));
    assert.equal(cliOutcome.createdRun, true);
    await handshake(harness);
    const mcp = toolResult(
      await harness.request(2, "tools/call", { name: "review", arguments: { task: mcpRepo.taskRel } }),
    );
    const mcpStatus = JSON.parse(mcp.content[0]!.text) as RpcObject;
    const cliStatus = cliOutcome.status!;
    assert.equal(mcpStatus.state, cliStatus.state);
    assert.equal(mcpStatus.reason_code, cliStatus.reason_code);
    assert.equal(mcpStatus.verdict, cliStatus.verdict);
    assert.equal(mcpStatus.review_kind, cliStatus.review_kind);
    assert.equal(mcpStatus.task_path, mcpRepo.taskRel);
    assert.equal(cliStatus.task_path, cliRepo.taskRel);
    const mcpRun = await loadRun(mcpRepo.root, String(mcpStatus.run_id));
    const cliRun = await loadRun(cliRepo.root, cliStatus.run_id);
    assert.deepEqual(
      mcpRun.events.map((event) => event.type),
      cliRun.events.map((event) => event.type),
    );
    assert.equal(mcp.content[0]!.text, serializeStatus(mcpRun.status));
    assert.equal(serializeStatus(cliStatus), serializeStatus(cliRun.status));
  } finally {
    await harness.close();
    await xdg.cleanup();
    await fs.rm(mcpRepo.root, { recursive: true, force: true });
    await fs.rm(cliRepo.root, { recursive: true, force: true });
  }
});

test("failure paths print no secret-shaped value", async () => {
  const { root, taskRel, productRel } = await makeRepo();
  const before = await snapshotFiles(root, [taskRel, productRel, "AGENTS.md"]);
  const harness = new McpHarness(
    root,
    testDeps({
      registryYaml: VALID_REGISTRY.replace("launcher: fake-reviewer-v1", "launcher: fake-reviewer-v1\n      api_key: leaked-secret-value"),
    }),
  );
  try {
    await handshake(harness);
    const response = await harness.request(2, "tools/call", {
      name: "review",
      arguments: { task: "../secret.md" },
    });
    const text = JSON.stringify(response);
    assert.doesNotMatch(text, /leaked-secret-value/);
    assert.doesNotMatch(text, /api_key/);
    assert.doesNotMatch(harness.stderrText, /leaked-secret-value|api_key|Bearer /);
    const after = await snapshotFiles(root, [taskRel, productRel, "AGENTS.md"]);
    assert.deepEqual(after, before);
  } finally {
    await harness.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("closing stdin exits 0 after the in-flight request completes", async () => {
  const { root, taskRel } = await makeRepo();
  const harness = new McpHarness(root, testDeps({ source: constantSource(passResult()) }));
  try {
    await handshake(harness);
    const pending = harness.request(2, "tools/call", { name: "review", arguments: { task: taskRel } });
    const codePromise = harness.close();
    const result = toolResult(await pending);
    assert.equal(result.isError, false);
    assert.equal(await codePromise, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("spawned mcp-stdio binds the root at startup and serves a real review over stdio", async () => {
  const { root, taskRel } = await makeRepo({ agents: validAgentsMd() });
  const other = await makeRepo();
  const xdg = await withXdgRegistry();
  const { child, stderr, wait } = await spawnProcess(["mcp-stdio", "--repo", root], {
    env: xdg.env,
    cwd: other.root,
  });
  let buffer = "";
  const queued: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let nl = buffer.indexOf("\n");
    while (nl !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      const waiter = waiters.shift();
      if (waiter) {
        waiter(line);
      } else {
        queued.push(line);
      }
      nl = buffer.indexOf("\n");
    }
  });
  const nextLine = (): Promise<string> => {
    if (queued.length > 0) {
      return Promise.resolve(queued.shift()!);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("spawned MCP timed out")), 8000);
      waiters.push((line) => {
        clearTimeout(timer);
        resolve(line);
      });
    });
  };
  const write = (obj: unknown): void => {
    child.stdin?.write(`${JSON.stringify(obj)}\n`);
  };
  try {
    write({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "e2e", version: "1" },
      },
    });
    const initLine = await nextLine();
    assertStdoutHygiene(initLine);
    const init = JSON.parse(initLine) as RpcObject;
    assert.equal((init.result as RpcObject).protocolVersion, MCP_PROTOCOL_VERSION);
    write({ jsonrpc: "2.0", method: "notifications/initialized" });
    write({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "review", arguments: { task: taskRel } },
    });
    const callLine = await nextLine();
    assertStdoutHygiene(callLine);
    const called = toolResult(JSON.parse(callLine) as RpcObject);
    assert.equal(called.isError, false);
    const status = JSON.parse(called.content[0]!.text) as { run_id: string; reason_code: string };
    assert.equal(status.reason_code, "review_human_required");
    assert.equal(await fileExists(path.join(root, ".spartan-bridge", "runs", status.run_id, "status.json")), true);
    assert.equal(await fileExists(path.join(other.root, ".spartan-bridge")), false);
    child.stdin?.end();
    assert.equal(await wait(), 0);
    assert.doesNotMatch(stderr(), /stack|Bearer |api_key/i);
  } finally {
    if (!child.killed) {
      child.kill("SIGKILL");
    }
    await xdg.cleanup();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(other.root, { recursive: true, force: true });
  }
});

test("mcp-stdio without --repo binds process.cwd()", async () => {
  const { root, taskRel } = await makeRepo({ agents: validAgentsMd() });
  const xdg = await withXdgRegistry();
  const { child, stdout, wait } = await spawnProcess(["mcp-stdio"], { env: xdg.env, cwd: root });
  try {
    child.stdin?.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "cwd", version: "1" } },
      })}\n${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n${JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "review", arguments: { task: taskRel } },
      })}\n`,
    );
    child.stdin?.end();
    assert.equal(await wait(), 0);
    const lines = stdout()
      .split("\n")
      .filter((line) => line.length > 0);
    assert.equal(lines.length, 2);
    for (const line of lines) {
      assertStdoutHygiene(line);
    }
    const called = toolResult(JSON.parse(lines[1]!) as RpcObject);
    const status = JSON.parse(called.content[0]!.text) as { run_id: string };
    assert.equal(await fileExists(path.join(root, ".spartan-bridge", "runs", status.run_id, "status.json")), true);
  } finally {
    if (!child.killed) {
      child.kill("SIGKILL");
    }
    await xdg.cleanup();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("mcp-stdio usage errors exit 2 and unreadable roots exit 1 with no stdout", async () => {
  const { root } = await makeRepo();
  try {
    for (const args of [
      ["mcp-stdio", "--task", "x"],
      ["mcp-stdio", "--run", "r"],
      ["mcp-stdio", "--kind", "plan"],
      ["mcp-stdio", "--unknown", "z"],
      ["mcp-stdio", "--repo"],
    ]) {
      const { child, stdout, stderr, wait } = await spawnProcess(args);
      child.stdin?.end();
      const code = await wait();
      assert.equal(code, 2, args.join(" "));
      assert.equal(stdout(), "");
      assert.match(stderr(), /^error: /);
    }
    const missing = await spawnProcess(["mcp-stdio", "--repo", path.join(root, "no-such-root")]);
    missing.child.stdin?.end();
    assert.equal(await missing.wait(), 1);
    assert.equal(missing.stdout(), "");
    assert.equal(missing.stderr().trim().split("\n").length, 1);
    const notDir = await spawnProcess(["mcp-stdio", "--repo", path.join(root, "AGENTS.md")]);
    notDir.child.stdin?.end();
    assert.equal(await notDir.wait(), 1);
    assert.equal(notDir.stdout(), "");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("SIGINT and SIGTERM exit without a partial stdout message", async () => {
  const { root } = await makeRepo();
  try {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const { child, stdout, wait } = await spawnProcess(["mcp-stdio", "--repo", root]);
      child.stdin?.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: MCP_PROTOCOL_VERSION } })}\n`,
      );
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${signal} initialize timed out`)), 8000);
        const onData = (): void => {
          if (stdout().includes("\n")) {
            clearTimeout(timer);
            child.stdout?.off("data", onData);
            resolve();
          }
        };
        child.stdout?.on("data", onData);
        onData();
      });
      child.kill(signal);
      const code = await wait();
      assert.equal(code, 0, signal);
      const text = stdout();
      const parts = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
      for (const line of parts) {
        if (line.length > 0) {
          assertStdoutHygiene(line);
        }
      }
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("MCP stdio review with AppDeps writes no progress to stderr", async () => {
  const { root, taskRel } = await makeRepo();
  const harness = new McpHarness(root, testDeps({ source: constantSource(passResult()), clock: testClock() }));
  try {
    await handshake(harness);
    const result = toolResult(
      await harness.request(2, "tools/call", { name: "review", arguments: { task: taskRel } }),
    );
    assert.equal(result.isError, false);
    const status = JSON.parse(result.content[0]!.text) as { reason_code: string };
    assert.equal(status.reason_code, "review_passed");
    assert.equal(harness.stderrText, "");
    assert.doesNotMatch(result.content[0]!.text, /elapsed |quiet |client-context=/);
    assert.doesNotMatch(result.content[0]!.text, /working records=|tool records=|result records=/);
  } finally {
    await harness.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("MCP review with a streaming Cursor stub still writes no progress", async () => {
  const { CursorAdapter, CURSOR_LAUNCHER_ID } = await import("../src/adapters/cursor.ts");
  const payload = {
    schema_version: 2,
    review_kind: "plan",
    verdict: "pass",
    summary: "ok",
    findings: [],
  };
  const help = "--print --output-format text | json | stream-json --mode --sandbox --workspace --trust\n";
  const chunks = [
    `${JSON.stringify({ type: "thinking", subtype: "delta", text: "secret-prose" })}\n`,
    `${JSON.stringify({ type: "result", subtype: "success", result: JSON.stringify(payload) })}\n`,
  ];
  const adapter = new CursorAdapter({
    runner: {
      start(request) {
        if (request.args[0] === "--help") {
          return {
            wait: async () => ({
              exitCode: 0,
              stdout: Buffer.from(help),
              stderr: Buffer.alloc(0),
              timedOut: false,
              stdoutOverflow: false,
            }),
            cancel: async () => undefined,
          };
        }
        return {
          wait: async () => {
            for (const chunk of chunks) {
              request.onStdoutChunk?.(Buffer.from(chunk));
            }
            return {
              exitCode: 0,
              stdout: Buffer.alloc(0),
              stderr: Buffer.alloc(0),
              timedOut: false,
              stdoutOverflow: false,
            };
          },
          cancel: async () => undefined,
        };
      },
    },
  });
  const { root, taskRel } = await makeRepo();
  const harness = new McpHarness(
    root,
    {
      ...testDeps({
        registryYaml: VALID_REGISTRY.replaceAll("fake-reviewer-v1", CURSOR_LAUNCHER_ID),
        clock: testClock(),
      }),
      catalog: createLauncherCatalog(() => {
        throw new Error("fake unused");
      }, new Map([[CURSOR_LAUNCHER_ID, () => withStructuredOutput(adapter)]])),
    },
  );
  try {
    await handshake(harness);
    const result = toolResult(
      await harness.request(2, "tools/call", { name: "review", arguments: { task: taskRel } }),
    );
    assert.equal(result.isError, false);
    const status = JSON.parse(result.content[0]!.text) as { reason_code: string };
    assert.equal(status.reason_code, "review_passed");
    assert.equal(harness.stderrText, "");
    assert.doesNotMatch(result.content[0]!.text, /working records=|secret-prose|elapsed |quiet /);
  } finally {
    await harness.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
