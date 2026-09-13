import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { AdapterFailureError, type Adapter } from "../src/adapters/adapter.ts";
import { FakeAdapter, fakeCapabilities } from "../src/adapters/fake.ts";
import { classifyProviderFailure } from "../src/adapters/provider-failure.ts";
import {
  ADAPTER_FAILURE_CAUSES,
  ADAPTER_FAILURE_PHASES,
  SCHEMA_VERSION,
  type AdapterFailureCause,
  type AdapterFailureRecord,
} from "../src/core/contracts.ts";
import { serializeStatus } from "../src/core/serialize.ts";
import { buildAdapterOutputExcerpt, OUTPUT_EXCERPT_CAP_BYTES, runReview } from "../src/core/review.ts";
import {
  constantSource,
  eventTypes,
  HookThrowAdapter,
  loadRun,
  makeRepo,
  passResult,
  testClock,
  testDeps,
} from "./helpers.ts";

const RUN_ID = "run-11111111-1111-4111-8111-111111111111";
const EVENT_KEYS = [
  "schema_version",
  "sequence",
  "timestamp",
  "run_id",
  "type",
  "state",
  "review_kind",
  "emitting_build",
  "policy_digest",
  "artifact_hashes",
  "execution_id",
  "verdict",
  "reason_code",
  "task_write_state",
  "task_hash_after_write",
  "task_write_rejection_cause",
  "pre_dispatch_diagnostic",
];

function wrapCollect(mutate: () => Promise<unknown>): Adapter {
  const inner = new FakeAdapter(constantSource(passResult()));
  return {
    // `post_review_snapshot` (the repository-worktree `after` capture) runs only
    // for an in-place adapter (task 0051 / D-052).
    capabilities: () => ({ ...inner.capabilities(), isolated_workspace: false }),
    preflight: () => inner.preflight(),
    prepare: (input) => inner.prepare(input),
    start: (input) => inner.start(input),
    collect: async () => {
      await mutate();
      return passResult();
    },
    verify: () => inner.verify(),
    cancel: () => inner.cancel(),
    cleanup: () => inner.cleanup(),
    observedModel: () => inner.observedModel(),
  };
}

test("adapter_failure is non-null exactly for hook throws and the two Bridge-owned phases", async () => {
  const hookRepo = await makeRepo();
  const hookOutcome = await runReview(
    { repo: hookRepo.root, task: hookRepo.taskRel },
    testDeps({
      clock: testClock(RUN_ID),
      createAdapter: () => new HookThrowAdapter(constantSource(passResult()), "collect", new Error("boom")),
    }),
  );
  const hookRun = await loadRun(hookRepo.root, RUN_ID);
  assert.equal(hookOutcome.status?.reason_code, "adapter_error");
  assert.equal(hookRun.status.adapter_failure == null, false);
  assert.equal(hookRun.status.adapter_failure?.phase, "collect");
  assert.equal(hookRun.status.schema_version, SCHEMA_VERSION);
  for (const event of hookRun.events) {
    assert.deepEqual(Object.keys(event), EVENT_KEYS);
    assert.equal("adapter_failure" in event, false);
  }

  const capRepo = await makeRepo();
  const capOutcome = await runReview(
    { repo: capRepo.root, task: capRepo.taskRel },
    testDeps({
      clock: testClock(RUN_ID),
      createAdapter: () =>
        new FakeAdapter(constantSource(passResult()), {
          ...fakeCapabilities(),
          workspace_write: true,
        }),
    }),
  );
  const capRun = await loadRun(capRepo.root, RUN_ID);
  assert.equal(capOutcome.status?.reason_code, "capability_denied");
  assert.equal(capRun.status.adapter_failure, null);
  for (const event of capRun.events) {
    assert.deepEqual(Object.keys(event), EVENT_KEYS);
  }

  const passRepo = await makeRepo();
  const passOutcome = await runReview(
    { repo: passRepo.root, task: passRepo.taskRel },
    testDeps({ clock: testClock(RUN_ID) }),
  );
  const passRun = await loadRun(passRepo.root, RUN_ID);
  assert.equal(passOutcome.status?.reason_code, "review_passed");
  assert.equal(passRun.status.adapter_failure, null);
  for (const event of passRun.events) {
    assert.deepEqual(Object.keys(event), EVENT_KEYS);
  }

  const pathRepo = await makeRepo();
  const pathOutcome = await runReview(
    { repo: pathRepo.root, task: "../secret.md" },
    testDeps({ clock: testClock(RUN_ID) }),
  );
  const pathRun = await loadRun(pathRepo.root, RUN_ID);
  assert.equal(pathOutcome.status?.reason_code, "path_invalid");
  assert.equal(pathRun.status.adapter_failure, null);

  await fs.rm(hookRepo.root, { recursive: true, force: true });
  await fs.rm(capRepo.root, { recursive: true, force: true });
  await fs.rm(passRepo.root, { recursive: true, force: true });
  await fs.rm(pathRepo.root, { recursive: true, force: true });
});

test("Bridge-owned post-review failures persist runtime_error without remapping the reason", async () => {
  const snapshotRepo = await makeRepo();
  const poison = path.join(snapshotRepo.root, "poison-dir");
  const snapshotOutcome = await runReview(
    { repo: snapshotRepo.root, task: snapshotRepo.taskRel },
    testDeps({
      clock: testClock(RUN_ID),
      createAdapter: () =>
        wrapCollect(async () => {
          await fs.mkdir(poison);
          await fs.chmod(poison, 0o000);
        }),
    }),
  );
  assert.equal(snapshotOutcome.status?.reason_code, "adapter_error");
  assert.equal(snapshotOutcome.status?.adapter_failure?.phase, "post_review_snapshot");
  assert.equal(snapshotOutcome.status?.adapter_failure?.cause, "runtime_error");
  assert.equal(snapshotOutcome.status?.adapter_failure?.exit_code, null);
  try {
    await fs.chmod(poison, 0o700);
  } catch {
    // best-effort restore so cleanup can remove the tree
  }

  const persistRepo = await makeRepo();
  const persistOutcome = await runReview(
    { repo: persistRepo.root, task: persistRepo.taskRel },
    testDeps({
      clock: testClock(RUN_ID),
      createAdapter: () =>
        wrapCollect(async () => {
          const reviews = path.join(persistRepo.root, ".spartan-bridge", "runs", RUN_ID, "reviews");
          await fs.writeFile(reviews, "not-a-directory");
        }),
    }),
  );
  assert.equal(persistOutcome.status?.reason_code, "adapter_error");
  assert.equal(persistOutcome.status?.adapter_failure?.phase, "persist_result");
  assert.equal(persistOutcome.status?.adapter_failure?.cause, "runtime_error");
  assert.deepEqual(eventTypes((await loadRun(persistRepo.root, RUN_ID)).events), [
    "run_requested",
    "policy_resolved",
    "review_started",
    "run_terminal",
  ]);

  await fs.rm(snapshotRepo.root, { recursive: true, force: true });
  await fs.rm(persistRepo.root, { recursive: true, force: true });
});

test("a failed stderr write still terminates the run", async () => {
  const { root, taskRel } = await makeRepo();
  const runDir = path.join(root, ".spartan-bridge", "runs", RUN_ID);
  const inner = new FakeAdapter(constantSource(passResult()));
  const adapter: Adapter = {
    capabilities: () => inner.capabilities(),
    preflight: () => inner.preflight(),
    prepare: (input) => inner.prepare(input),
    start: (input) => inner.start(input),
    collect: async () => {
      await fs.mkdir(path.join(runDir, "adapter-stderr.log"));
      throw new AdapterFailureError(
        {
          phase: "collect",
          cause: "exit_nonzero",
          exit_code: 1,
          signal: null,
          http_status: null,
          stderr_bytes: 0,
          stderr_log: null,
          payload_log: null,
          output_excerpt_bytes: 0,
          output_excerpt: null,
        },
        Buffer.from("provider outage: rate limit exceeded.\n"),
      );
    },
    verify: () => inner.verify(),
    cancel: () => inner.cancel(),
    cleanup: () => inner.cleanup(),
    observedModel: () => inner.observedModel(),
  };
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({ clock: testClock(RUN_ID), createAdapter: () => adapter }),
  );
  assert.equal(outcome.status?.reason_code, "adapter_error");
  assert.equal(outcome.status?.adapter_failure?.phase, "collect");
  assert.equal(outcome.status?.adapter_failure?.cause, "exit_nonzero");
  assert.equal(outcome.status?.adapter_failure?.stderr_log, null);
  assert.equal(outcome.status?.adapter_failure?.stderr_bytes, 0);
  const run = await loadRun(root, RUN_ID);
  assert.equal(run.events.at(-1)?.type, "run_terminal");
  await fs.rm(root, { recursive: true, force: true });
});

test("preflight exit_nonzero surfaces output_excerpt from stdout and stderr", async () => {
  const { root, taskRel } = await makeRepo();
  const adapter: Adapter = {
    capabilities: () => new FakeAdapter(constantSource(passResult())).capabilities(),
    preflight: async () => {
      throw new AdapterFailureError(
        {
          phase: "preflight",
          cause: "exit_nonzero",
          exit_code: 1,
          signal: null,
          http_status: null,
          stderr_bytes: 0,
          stderr_log: null,
          payload_log: null,
          output_excerpt_bytes: 0,
          output_excerpt: null,
        },
        Buffer.from("stderr tail\n", "utf8"),
        "adapter_error",
        null,
        // `output` is the combined stream a real adapter builds via
        // `Buffer.concat([stdout, stderr])` in its `fail()` helper.
        Buffer.from("stdout head\nstderr tail\n", "utf8"),
      );
    },
    prepare: async () => undefined,
    start: async () => undefined,
    collect: async () => passResult(),
    verify: async () => undefined,
    cancel: async () => undefined,
    cleanup: async () => undefined,
    observedModel: () => null,
  };
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({ clock: testClock(RUN_ID), createAdapter: () => adapter }),
  );
  assert.equal(outcome.status?.reason_code, "capability_denied");
  assert.equal(outcome.status?.adapter_failure?.output_excerpt, "stdout head\nstderr tail\n");
  assert.equal(outcome.status?.adapter_failure?.output_excerpt_bytes, Buffer.byteLength("stdout head\nstderr tail\n", "utf8"));
  await fs.rm(root, { recursive: true, force: true });
});

test("collect exit_nonzero with empty stderr quotes stdout and leaves stderr_log null", async () => {
  const { root, taskRel } = await makeRepo();
  const adapter: Adapter = {
    capabilities: () => new FakeAdapter(constantSource(passResult())).capabilities(),
    preflight: async () => undefined,
    prepare: async () => undefined,
    start: async () => undefined,
    collect: async () => {
      throw new AdapterFailureError(
        {
          phase: "collect",
          cause: "exit_nonzero",
          exit_code: 1,
          signal: null,
          http_status: null,
          stderr_bytes: 0,
          stderr_log: null,
          payload_log: null,
          output_excerpt_bytes: 0,
          output_excerpt: null,
        },
        Buffer.alloc(0),
        "adapter_error",
        null,
        Buffer.from("Not logged in\n", "utf8"),
      );
    },
    verify: async () => undefined,
    cancel: async () => undefined,
    cleanup: async () => undefined,
    observedModel: () => null,
  };
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({ clock: testClock(RUN_ID), createAdapter: () => adapter }),
  );
  assert.equal(outcome.status?.adapter_failure?.output_excerpt, "Not logged in\n");
  assert.equal(outcome.status?.adapter_failure?.stderr_log, null);
  await fs.rm(root, { recursive: true, force: true });
});

test("collect exit_nonzero with retained payload keeps output_excerpt null", async () => {
  const { root, taskRel } = await makeRepo();
  const adapter: Adapter = {
    capabilities: () => new FakeAdapter(constantSource(passResult())).capabilities(),
    preflight: async () => undefined,
    prepare: async () => undefined,
    start: async () => undefined,
    collect: async () => {
      throw new AdapterFailureError(
        {
          phase: "collect",
          cause: "output_unparsable",
          exit_code: 0,
          signal: null,
          http_status: null,
          stderr_bytes: 0,
          stderr_log: null,
          payload_log: null,
          output_excerpt_bytes: 0,
          output_excerpt: null,
        },
        Buffer.alloc(0),
        "adapter_error",
        '{"verdict":"pass"}',
        Buffer.from("partial stdout\n", "utf8"),
      );
    },
    verify: async () => undefined,
    cancel: async () => undefined,
    cleanup: async () => undefined,
    observedModel: () => null,
  };
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({ clock: testClock(RUN_ID), createAdapter: () => adapter }),
  );
  assert.equal(outcome.status?.adapter_failure?.output_excerpt, null);
  assert.equal(outcome.status?.adapter_failure?.payload_log, "adapter-payload.log");
  await fs.rm(root, { recursive: true, force: true });
});

test("closed vocabularies stay the seven phases and eleven causes", () => {
  assert.deepEqual([...ADAPTER_FAILURE_PHASES], [
    "preflight",
    "prepare",
    "start",
    "collect",
    "verify",
    "post_review_snapshot",
    "persist_result",
  ]);
  const causes: AdapterFailureCause[] = [...ADAPTER_FAILURE_CAUSES];
  assert.deepEqual(causes, [
    "not_spawned",
    "spawn_failed",
    "timed_out",
    "exit_nonzero",
    "output_overflow",
    "output_unparsable",
    "interface_unrecognized",
    "unexpected_error",
    "runtime_error",
    "provider_unavailable",
    "provider_limit",
  ]);
  assert.equal(SCHEMA_VERSION, 2);
});

function collectExcerptFixture(): { head: string; tail: string; bytes: Buffer } {
  const head = '{"type":"system","subtype":"init","cwd":"/tmp"}'.padEnd(512, "x");
  const tail = '{"type":"result","is_error":true,"api_error":true}'.padStart(512, "y");
  return { head, tail, bytes: Buffer.from(`${head}${tail}`, "utf8") };
}

test("D1: collect excerpt longer than 512 bytes keeps the redacted tail", () => {
  const { head, tail, bytes } = collectExcerptFixture();
  assert.equal(OUTPUT_EXCERPT_CAP_BYTES, 512);
  assert.equal(head.includes("system"), true);
  assert.equal(head.includes("api_error"), false);
  assert.equal(tail.includes("api_error"), true);
  assert.equal(tail.includes("system"), false);
  const excerpt = buildAdapterOutputExcerpt("collect", Buffer.alloc(0), bytes, null);
  assert.equal(excerpt.output_excerpt?.includes("api_error"), true);
  assert.equal(excerpt.output_excerpt?.includes("system"), false);
  assert.equal(excerpt.output_excerpt?.includes("[truncated: earlier bytes dropped]"), false);
  assert.equal(excerpt.output_excerpt_bytes, OUTPUT_EXCERPT_CAP_BYTES);
  const withPayload = buildAdapterOutputExcerpt("collect", Buffer.alloc(0), bytes, "retained");
  assert.equal(withPayload.output_excerpt, null);
  assert.equal(withPayload.output_excerpt_bytes, 0);
});

test("D1a: last result 529/429 remap; prose and 401 do not", () => {
  const overloaded = [
    '{"type":"system","subtype":"init","cwd":"/tmp"}',
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: true,
      api_error_status: 529,
      terminal_reason: "api_error",
      result: "API Error: 529 Overloaded. https://status.claude.com",
    }),
  ].join("\n");
  assert.deepEqual(classifyProviderFailure(overloaded), {
    cause: "provider_unavailable",
    http_status: 529,
  });
  assert.deepEqual(
    classifyProviderFailure(
      JSON.stringify({ type: "result", is_error: true, api_error_status: 429, result: "rate limited" }),
    ),
    { cause: "provider_limit", http_status: 429 },
  );
  assert.deepEqual(
    classifyProviderFailure(
      JSON.stringify({ type: "result", is_error: true, terminal_reason: "api_error" }),
    ),
    { cause: "provider_unavailable", http_status: null },
  );
  assert.deepEqual(
    classifyProviderFailure(JSON.stringify({ type: "result", is_error: true, api_error_status: 401 })),
    { cause: null, http_status: 401 },
  );
  assert.deepEqual(classifyProviderFailure("You've hit your usage limit\n"), {
    cause: null,
    http_status: null,
  });
});

test("D1a/D2: persisted adapter_failure copies signal and http_status and drops provider prose", async () => {
  const { root, taskRel } = await makeRepo();
  const record: AdapterFailureRecord = {
    phase: "collect",
    cause: "provider_unavailable",
    exit_code: 1,
    signal: "SIGKILL",
    http_status: 529,
    stderr_bytes: 0,
    stderr_log: null,
    payload_log: null,
    output_excerpt_bytes: 0,
    output_excerpt: null,
  };
  const adapter: Adapter = {
    capabilities: () => new FakeAdapter(constantSource(passResult())).capabilities(),
    preflight: async () => undefined,
    prepare: async () => undefined,
    start: async () => undefined,
    collect: async () => {
      throw new AdapterFailureError(
        record,
        Buffer.alloc(0),
        "adapter_error",
        null,
        Buffer.from('{"type":"result","is_error":true,"api_error_status":529,"result":"API Error: 529 Overloaded."}\n'),
      );
    },
    verify: async () => undefined,
    cancel: async () => undefined,
    cleanup: async () => undefined,
    observedModel: () => null,
  };
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({ clock: testClock(RUN_ID), createAdapter: () => adapter }),
  );
  assert.equal(outcome.status?.adapter_failure?.cause, "provider_unavailable");
  assert.equal(outcome.status?.adapter_failure?.http_status, 529);
  assert.equal(outcome.status?.adapter_failure?.signal, "SIGKILL");
  assert.equal(outcome.status?.adapter_failure?.output_excerpt?.includes("api_error_status"), true);
  assert.equal("result" in (outcome.status?.adapter_failure ?? {}), false);
  assert.equal("terminal_reason" in (outcome.status?.adapter_failure ?? {}), false);
  const parsed = JSON.parse(serializeStatus(outcome.status!)) as {
    schema_version: number;
    adapter_failure: Record<string, unknown>;
  };
  assert.equal(parsed.schema_version, 2);
  assert.equal(parsed.adapter_failure.signal, "SIGKILL");
  assert.equal(parsed.adapter_failure.http_status, 529);
  assert.equal("result" in parsed.adapter_failure, false);
  assert.equal("terminal_reason" in parsed.adapter_failure, false);
  await fs.rm(root, { recursive: true, force: true });
});

test("D2: a clean exit 1 records signal null", async () => {
  const { root, taskRel } = await makeRepo();
  const adapter: Adapter = {
    capabilities: () => new FakeAdapter(constantSource(passResult())).capabilities(),
    preflight: async () => undefined,
    prepare: async () => undefined,
    start: async () => undefined,
    collect: async () => {
      throw new AdapterFailureError(
        {
          phase: "collect",
          cause: "exit_nonzero",
          exit_code: 1,
          signal: null,
          http_status: null,
          stderr_bytes: 0,
          stderr_log: null,
          payload_log: null,
          output_excerpt_bytes: 0,
          output_excerpt: null,
        },
        Buffer.alloc(0),
        "adapter_error",
        null,
        Buffer.alloc(0),
      );
    },
    verify: async () => undefined,
    cancel: async () => undefined,
    cleanup: async () => undefined,
    observedModel: () => null,
  };
  const outcome = await runReview(
    { repo: root, task: taskRel },
    testDeps({ clock: testClock(RUN_ID), createAdapter: () => adapter }),
  );
  assert.equal(outcome.status?.adapter_failure?.cause, "exit_nonzero");
  assert.equal(outcome.status?.adapter_failure?.signal, null);
  assert.equal(outcome.status?.adapter_failure?.http_status, null);
  await fs.rm(root, { recursive: true, force: true });
});
