import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  buildProducerDiagnostic,
  PRODUCER_SNAPSHOT_CAPS,
  PRODUCER_SNAPSHOT_SITES,
} from "../src/core/contracts.ts";
import {
  canonicalPolicyJson,
  parseStatusJson,
  parseTransitionStatusJson,
  policyDigest,
  serializeStatus,
  serializeTransitionEvent,
  serializeTransitionStatus,
} from "../src/core/serialize.ts";
import type {
  ProducerDiagnostic,
  ResolvedPolicy,
  SnapshotDiffEntry,
  StatusDocument,
  TransitionEventDocument,
  TransitionStatusDocument,
} from "../src/core/contracts.ts";

function baseTransitionStatus(producerDiagnostic: ProducerDiagnostic | null): TransitionStatusDocument {
  return {
    schema_version: 2,
    document: "transition",
    transition_id: "transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    state: "stopped",
    parent_run_id: "run-1",
    task_path: "spartan/tasks/x.md",
    approved_task_hash: "sha256:abc",
    policy_digest: "sha256:def",
    implementer_host: "cursor",
    implementer_launcher_id: "cursor-plan-reviewer-v1",
    lock_identity: "transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    reason_code: "producer_failure",
    producer_diagnostic: producerDiagnostic,
    unwritable_plan_targets: null,
    producer_refused_paths: null,
    declaration_invalid_detail: null,
    current_review_run_id: null,
    linked_review_run_ids: [],
    created_at: "2026-08-23T12:00:00.000Z",
    updated_at: "2026-08-23T12:00:01.000Z",
  };
}

const PINNED_POLICY: ResolvedPolicy = {
  schema_version: 2,
  review_kind: "plan",
  host: "cursor",
  client_context: "personal",
  model: "Composer-2.5",
  effort: "none",
  launcher_id: "fake-reviewer-v1",
  automatic_review_authorized: true,
  task_artifact_write_authorized: false,
  producer_chain_authorized: false,
  max_review_cycles: 3,
  permission_mode: "read-only",
};

const PINNED_JSON =
  '{"schema_version":2,"review_kind":"plan","host":"cursor","client_context":"personal","model":"Composer-2.5","effort":"none","launcher_id":"fake-reviewer-v1","automatic_review_authorized":true,"task_artifact_write_authorized":false,"producer_chain_authorized":false,"max_review_cycles":3,"permission_mode":"read-only"}';

test("canonical policy JSON key order is pinned for the digest", () => {
  assert.equal(canonicalPolicyJson(PINNED_POLICY), PINNED_JSON);
  assert.equal(policyDigest(PINNED_POLICY), `sha256:${createHash("sha256").update(PINNED_JSON).digest("hex")}`);
});

test("serializeStatus appends host client_context model effort and model_observed after task_path", () => {
  const status: StatusDocument = {
    schema_version: 2,
    run_id: "run-1",
    state: "policy_resolved",
    review_kind: "plan",
    task_path: "spartan/tasks/x.md",
    host: "cursor",
    client_context: "personal",
    model: "Composer-2.5",
    effort: "none",
    model_observed: null,
    policy_digest: "sha256:abc",
    artifact_hashes: { task: null, agents: null },
    execution_id: null,
    verdict: null,
    reason_code: null,
    task_write_state: null,
    task_hash_after_write: null,
    task_write_rejection_cause: null,
    review_verdict_log: null,
    reviewer_write: null,
    adapter_failure: null,
    pre_dispatch_diagnostic: null,
    producer_identity: null,
    review_chain: null,
    transition_id: null,
    created_at: "2026-08-16T12:00:00.000Z",
    updated_at: "2026-08-16T12:00:01.000Z",
  };
  const parsed = JSON.parse(serializeStatus(status)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed), [
    "schema_version",
    "run_id",
    "state",
    "review_kind",
    "task_path",
    "host",
    "client_context",
    "model",
    "effort",
    "model_observed",
    "policy_digest",
    "artifact_hashes",
    "execution_id",
    "verdict",
    "reason_code",
    "task_write_state",
    "task_hash_after_write",
    "task_write_rejection_cause",
    "review_verdict_log",
    "reviewer_write",
    "adapter_failure",
    "pre_dispatch_diagnostic",
    "producer_identity",
    "review_chain",
    "transition_id",
    "created_at",
    "updated_at",
  ]);
  assert.equal(parsed.model, "Composer-2.5");
  assert.equal(parsed.effort, "none");
  assert.equal(parsed.model_observed, null);
});

test("serializeStatus copies only comparison path change and fields from reviewer_write", () => {
  const status: StatusDocument = {
    schema_version: 2,
    run_id: "run-1",
    state: "blocked",
    review_kind: "plan",
    task_path: "spartan/tasks/x.md",
    host: "cursor",
    client_context: "personal",
    model: "Composer-2.5",
    effort: "none",
    model_observed: null,
    policy_digest: "sha256:abc",
    artifact_hashes: { task: null, agents: null },
    execution_id: null,
    verdict: null,
    reason_code: "reviewer_write_detected",
    task_write_state: null,
    task_hash_after_write: null,
    task_write_rejection_cause: null,
    review_verdict_log: null,
    reviewer_write: {
      comparison: "reviewer_workspace",
      entries: [
        {
          path: "task.md",
          change: "changed",
          fields: ["hash"],
          content: "SECRET_FILE_BYTES",
        } as SnapshotDiffEntry & { content: string },
      ],
    },
    adapter_failure: null,
    pre_dispatch_diagnostic: null,
    producer_identity: null,
    review_chain: null,
    transition_id: null,
    created_at: "2026-08-16T12:00:00.000Z",
    updated_at: "2026-08-16T12:00:01.000Z",
  };
  const raw = serializeStatus(status);
  assert.equal(raw.includes("SECRET_FILE_BYTES"), false);
  const parsed = JSON.parse(raw) as {
    reviewer_write: { comparison: string; entries: Array<Record<string, unknown>> };
  };
  assert.deepEqual(Object.keys(parsed.reviewer_write.entries[0]!), ["path", "change", "fields"]);
});

test("serializeStatus copies only the closed adapter_failure fields", () => {
  const status: StatusDocument = {
    schema_version: 2,
    run_id: "run-1",
    state: "failed",
    review_kind: "plan",
    task_path: "spartan/tasks/x.md",
    host: "cursor",
    client_context: "personal",
    model: "Composer-2.5",
    effort: "none",
    model_observed: null,
    policy_digest: "sha256:abc",
    artifact_hashes: { task: null, agents: null },
    execution_id: "exec-1",
    verdict: null,
    reason_code: "adapter_error",
    task_write_state: null,
    task_hash_after_write: null,
    task_write_rejection_cause: null,
    review_verdict_log: null,
    reviewer_write: null,
    adapter_failure: {
      phase: "collect",
      cause: "exit_nonzero",
      exit_code: 1,
      signal: "SIGTERM",
      http_status: 401,
      stderr_bytes: 12,
      stderr_log: "adapter-stderr.log",
      payload_log: "adapter-payload.log",
      output_excerpt_bytes: 0,
      output_excerpt: null,
      stderr_text: "SECRET_STDERR",
      payload_text: "SECRET_PAYLOAD",
      result: "SECRET_RESULT",
      terminal_reason: "SECRET_REASON",
    } as StatusDocument["adapter_failure"] & {
      stderr_text: string;
      payload_text: string;
      result: string;
      terminal_reason: string;
    },
    producer_identity: {
      role: "implementer",
      host: "cursor",
      session: "SECRET_SESSION",
    } as StatusDocument["producer_identity"] & { session: string },
    review_chain: {
      after_run_id: "run-1",
      cycle: 2,
      max_cycles: 3,
      refused: null,
      parent_verdict: "SECRET_PARENT",
    } as StatusDocument["review_chain"] & { parent_verdict: string },
    transition_id: null,
    created_at: "2026-08-16T12:00:00.000Z",
    updated_at: "2026-08-16T12:00:01.000Z",
  };
  const raw = serializeStatus(status);
  assert.equal(raw.includes("SECRET_STDERR"), false);
  assert.equal(raw.includes("SECRET_PAYLOAD"), false);
  assert.equal(raw.includes("SECRET_PARENT"), false);
  assert.equal(raw.includes("SECRET_SESSION"), false);
  const parsed = JSON.parse(raw) as {
    schema_version: number;
    adapter_failure: Record<string, unknown>;
    producer_identity: Record<string, unknown>;
    review_chain: Record<string, unknown>;
  };
  assert.equal(parsed.schema_version, 2);
  assert.deepEqual(Object.keys(parsed.adapter_failure), [
    "phase",
    "cause",
    "exit_code",
    "signal",
    "http_status",
    "stderr_bytes",
    "stderr_log",
    "payload_log",
    "output_excerpt_bytes",
    "output_excerpt",
  ]);
  assert.equal(parsed.adapter_failure.phase, "collect");
  assert.equal(parsed.adapter_failure.cause, "exit_nonzero");
  assert.equal(parsed.adapter_failure.signal, "SIGTERM");
  assert.equal(parsed.adapter_failure.http_status, 401);
  assert.equal(parsed.adapter_failure.payload_log, "adapter-payload.log");
  assert.equal("result" in parsed.adapter_failure, false);
  assert.equal("terminal_reason" in parsed.adapter_failure, false);
  assert.equal(raw.includes("SECRET_RESULT"), false);
  assert.equal(raw.includes("SECRET_REASON"), false);
  assert.deepEqual(Object.keys(parsed.producer_identity), ["role", "host"]);
  assert.equal(parsed.producer_identity.role, "implementer");
  assert.equal(parsed.producer_identity.host, "cursor");
  assert.deepEqual(Object.keys(parsed.review_chain), ["after_run_id", "cycle", "max_cycles", "refused"]);
});

test("serializeAdapterFailure normalizes out-of-shape signal and http_status", () => {
  const status: StatusDocument = {
    schema_version: 2,
    run_id: "run-1",
    state: "failed",
    review_kind: "plan",
    task_path: "spartan/tasks/x.md",
    host: "cursor",
    client_context: "personal",
    model: "Composer-2.5",
    effort: "none",
    model_observed: null,
    policy_digest: "sha256:abc",
    artifact_hashes: { task: null, agents: null },
    execution_id: "exec-1",
    verdict: null,
    reason_code: "adapter_error",
    task_write_state: null,
    task_hash_after_write: null,
    task_write_rejection_cause: null,
    review_verdict_log: null,
    reviewer_write: null,
    adapter_failure: {
      phase: "collect",
      cause: "exit_nonzero",
      exit_code: 1,
      signal: "",
      http_status: Number.NaN,
      stderr_bytes: 0,
      stderr_log: null,
      payload_log: null,
      output_excerpt_bytes: 0,
      output_excerpt: null,
    },
    producer_identity: null,
    review_chain: null,
    transition_id: null,
    created_at: "2026-08-16T12:00:00.000Z",
    updated_at: "2026-08-16T12:00:01.000Z",
  };
  const parsed = JSON.parse(serializeStatus(status)) as { adapter_failure: Record<string, unknown> };
  assert.equal(parsed.adapter_failure.signal, null);
  assert.equal(parsed.adapter_failure.http_status, null);
  const diagnosticKeys = Object.keys(
    JSON.parse(
      serializeTransitionStatus(
        baseTransitionStatus({
          stage: "exit_nonzero",
          exit_code: 1,
          timed_out: false,
          write_scope_code: null,
          adapter_phase: "collect",
          adapter_cause: "provider_limit",
          waited_ms: null,
        }),
      ),
    ).producer_diagnostic as object,
  );
  assert.equal(diagnosticKeys.includes("http_status"), false);
});

test("producer_chain_authorized enters the policy digest", () => {
  assert.match(PINNED_JSON, /"producer_chain_authorized":false/);
  const granted = { ...PINNED_POLICY, producer_chain_authorized: true };
  assert.notEqual(canonicalPolicyJson(granted), PINNED_JSON);
  assert.notEqual(policyDigest(granted), policyDigest(PINNED_POLICY));
});

test("serializeTransitionStatus emits a null producer_diagnostic unchanged", () => {
  const raw = serializeTransitionStatus(baseTransitionStatus(null));
  const parsed = JSON.parse(raw) as TransitionStatusDocument;
  assert.equal(parsed.producer_diagnostic, null);
});

test("serializeTransitionStatus and serializeTransitionEvent copy only the nine whitelisted producer_diagnostic keys", () => {
  const diagnostic: ProducerDiagnostic = {
    stage: "spawn",
    exit_code: 17,
    timed_out: false,
    write_scope_code: null,
    adapter_phase: "start",
    adapter_cause: "spawn_failed",
    waited_ms: null,
    snapshot_site: null,
    snapshot_cap: null,
  };
  const statusRaw = serializeTransitionStatus(baseTransitionStatus(diagnostic));
  const parsedStatus = JSON.parse(statusRaw) as TransitionStatusDocument;
  assert.deepEqual(Object.keys(parsedStatus.producer_diagnostic as object), [
    "stage",
    "exit_code",
    "timed_out",
    "write_scope_code",
    "adapter_phase",
    "adapter_cause",
    "waited_ms",
    "snapshot_site",
    "snapshot_cap",
  ]);
  assert.deepEqual(parsedStatus.producer_diagnostic, diagnostic);

  const event: TransitionEventDocument = {
    schema_version: 2,
    sequence: 3,
    timestamp: "2026-08-23T12:00:01.000Z",
    transition_id: "transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    type: "terminal_stop",
    state: "stopped",
    reason_code: "producer_failure",
    producer_diagnostic: diagnostic,
    unwritable_plan_targets: null,
    declaration_invalid_detail: null,
    review_run_id: null,
  };
  const eventRaw = serializeTransitionEvent(event);
  const parsedEvent = JSON.parse(eventRaw) as TransitionEventDocument;
  assert.deepEqual(parsedEvent.producer_diagnostic, diagnostic);
});

test("serializeTransitionStatus rejects injected secret/prose/path properties and out-of-domain values", () => {
  const poisoned = {
    stage: "wait",
    exit_code: 1,
    timed_out: false,
    write_scope_code: null,
    adapter_phase: "collect",
    adapter_cause: "exit_nonzero",
    stdout: "SECRET_STDOUT",
    stderr: "SECRET_STDERR",
    prompt: "SECRET_PROMPT",
    payload: "SECRET_PAYLOAD",
    path: "/etc/passwd",
    model: "SECRET_MODEL",
    account: "SECRET_ACCOUNT",
    snapshot_site: "not_a_site",
    snapshot_cap: "not_a_cap",
  } as unknown as ProducerDiagnostic;
  const raw = serializeTransitionStatus(baseTransitionStatus(poisoned));
  assert.equal(raw.includes("SECRET"), false);
  assert.equal(raw.includes("/etc/passwd"), false);
  const parsed = JSON.parse(raw) as TransitionStatusDocument;
  assert.deepEqual(Object.keys(parsed.producer_diagnostic as object), [
    "stage",
    "exit_code",
    "timed_out",
    "write_scope_code",
    "adapter_phase",
    "adapter_cause",
    "waited_ms",
    "snapshot_site",
    "snapshot_cap",
  ]);
});

test("serializeTransitionStatus nulls an out-of-enum stage to a whole-record null, and nulls a bad exit code, out-of-enum write-scope/adapter values, and normalizes a non-boolean timeout flag", () => {
  const badStage = { stage: "unknown_stage", exit_code: 1, timed_out: false, write_scope_code: null, adapter_phase: null, adapter_cause: null } as unknown as ProducerDiagnostic;
  const rawBadStage = serializeTransitionStatus(baseTransitionStatus(badStage));
  assert.equal((JSON.parse(rawBadStage) as TransitionStatusDocument).producer_diagnostic, null);

  const badFields = {
    stage: "exit_nonzero",
    exit_code: 1.5,
    timed_out: "yes",
    write_scope_code: "not_a_real_code",
    adapter_phase: "not_a_real_phase",
    adapter_cause: "not_a_real_cause",
    snapshot_site: "not_a_real_site",
    snapshot_cap: "not_a_real_cap",
  } as unknown as ProducerDiagnostic;
  const rawBadFields = serializeTransitionStatus(baseTransitionStatus(badFields));
  const parsedBadFields = JSON.parse(rawBadFields) as TransitionStatusDocument;
  assert.deepEqual(parsedBadFields.producer_diagnostic, {
    stage: "exit_nonzero",
    exit_code: null,
    timed_out: false,
    write_scope_code: null,
    adapter_phase: null,
    adapter_cause: null,
    waited_ms: null,
    snapshot_site: null,
    snapshot_cap: null,
  });
});

test("buildProducerDiagnostic rejects out-of-domain snapshot fields", () => {
  assert.throws(
    () => buildProducerDiagnostic({ stage: "capture", snapshotSite: "somewhere" as never }),
    TypeError,
  );
  assert.throws(
    () => buildProducerDiagnostic({ stage: "capture", snapshotCap: "files" as never }),
    TypeError,
  );
  assert.deepEqual(buildProducerDiagnostic({
    stage: "capture",
    snapshotSite: "workspace_after",
    snapshotCap: "entries",
  }), {
    stage: "capture",
    exit_code: null,
    timed_out: false,
    write_scope_code: null,
    adapter_phase: null,
    adapter_cause: null,
    waited_ms: null,
    snapshot_site: "workspace_after",
    snapshot_cap: "entries",
  });
});

test("all six producer snapshot sites and both cap values survive the closed serializer", () => {
  assert.deepEqual([...PRODUCER_SNAPSHOT_SITES], [
    "workspace_baseline",
    "repo_before",
    "runtime_before",
    "workspace_after",
    "repo_after",
    "runtime_after",
  ]);
  assert.deepEqual([...PRODUCER_SNAPSHOT_CAPS], ["entries", "hash_bytes"]);
  for (const site of PRODUCER_SNAPSHOT_SITES) {
    for (const cap of PRODUCER_SNAPSHOT_CAPS) {
      const diagnostic = buildProducerDiagnostic({
        stage: site === "workspace_baseline" ? "write_scope_lock" : "capture",
        snapshotSite: site,
        snapshotCap: cap,
      });
      const serialized = JSON.parse(
        serializeTransitionStatus(baseTransitionStatus(diagnostic)),
      ) as TransitionStatusDocument;
      assert.equal(serialized.producer_diagnostic?.snapshot_site, site);
      assert.equal(serialized.producer_diagnostic?.snapshot_cap, cap);
    }
  }
});

test("parseTransitionStatusJson normalizes a missing producer_diagnostic key to null and leaves old bytes otherwise readable", () => {
  const oldBytes = '{"document":"transition","transition_id":"transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","state":"stopped","reason_code":"producer_failure"}';
  const parsed = parseTransitionStatusJson(oldBytes);
  assert.equal(parsed.producer_diagnostic, null);
  assert.equal(parsed.unwritable_plan_targets, null);
  assert.equal(parsed.producer_refused_paths, null);
  assert.equal(parsed.declaration_invalid_detail, null);
  assert.equal(parsed.transition_id, "transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(parsed.state, "stopped");
});

test("producer_refused_paths normalizes malformed persisted values and bounds valid strings", () => {
  const values = Array.from({ length: 25 }, (_, index) => `${String(index).padStart(2, "0")}.txt`);
  const raw = serializeTransitionStatus({
    ...baseTransitionStatus(null),
    reason_code: "write_scope_violation",
    producer_refused_paths: [values[0]!, 12 as never, ...values.slice(1)],
  });
  const persisted = JSON.parse(raw) as TransitionStatusDocument;
  assert.equal(persisted.producer_refused_paths?.length, 20);
  assert.deepEqual(persisted.producer_refused_paths, values.slice(0, 20));

  const exact = "x".repeat(256);
  const exactPersisted = JSON.parse(serializeTransitionStatus({
    ...baseTransitionStatus(null),
    producer_refused_paths: [exact],
  })) as TransitionStatusDocument;
  assert.deepEqual(exactPersisted.producer_refused_paths, [exact]);

  const long = `prefix/${"😀".repeat(100)}/tail.txt`;
  const longPersisted = JSON.parse(serializeTransitionStatus({
    ...baseTransitionStatus(null),
    reason_code: "write_scope_violation",
    producer_refused_paths: [long],
  })) as TransitionStatusDocument;
  assert.equal(longPersisted.producer_refused_paths?.length, 1);
  assert.equal(Buffer.byteLength(longPersisted.producer_refused_paths![0]!, "utf8") <= 260, true);
  assert.equal(longPersisted.producer_refused_paths?.[0]?.startsWith(".../"), true);
  assert.equal(long.endsWith(longPersisted.producer_refused_paths![0]!.slice(4)), true);

  const event = JSON.parse(serializeTransitionEvent({
    schema_version: 2,
    sequence: 1,
    timestamp: "2026-08-23T12:00:01.000Z",
    transition_id: "transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    type: "terminal_stop",
    state: "stopped",
    reason_code: "write_scope_violation",
    producer_diagnostic: null,
    unwritable_plan_targets: null,
    producer_refused_paths: ["one", 2 as never, "two"],
    declaration_invalid_detail: null,
    review_run_id: null,
  })) as TransitionEventDocument;
  assert.deepEqual(event.producer_refused_paths, ["one", "two"]);

  for (const producer_refused_paths of [undefined, "x", [], [1, false]]) {
    const parsed = parseTransitionStatusJson(JSON.stringify({
      ...baseTransitionStatus(null),
      producer_refused_paths,
    }));
    assert.equal(parsed.producer_refused_paths, null);
  }
});

test("a historical transition without producer_refused_paths parses unchanged except for null defaults", () => {
  const historical = { ...baseTransitionStatus(null) } as Record<string, unknown>;
  delete historical.producer_refused_paths;
  const parsed = parseTransitionStatusJson(JSON.stringify(historical));
  assert.equal(parsed.producer_refused_paths, null);
  assert.equal(parsed.transition_id, historical.transition_id);
  assert.equal(parsed.reason_code, historical.reason_code);
  assert.equal(parsed.unwritable_plan_targets, historical.unwritable_plan_targets);
});

test("serializeTransitionStatus copies unwritable_plan_targets and parse normalizes missing or empty to null", () => {
  const withTokens: TransitionStatusDocument = {
    ...baseTransitionStatus(null),
    reason_code: "plan_targets_unwritable_path",
    unwritable_plan_targets: ["AGENTS.md", "config/secret.env"],
    declaration_invalid_detail: null,
  };
  const raw = serializeTransitionStatus(withTokens);
  const parsed = JSON.parse(raw) as TransitionStatusDocument;
  assert.deepEqual(parsed.unwritable_plan_targets, ["AGENTS.md", "config/secret.env"]);
  assert.equal(parsed.producer_diagnostic, null);

  const emptyRaw = serializeTransitionStatus({ ...baseTransitionStatus(null), unwritable_plan_targets: [] });
  assert.equal((JSON.parse(emptyRaw) as TransitionStatusDocument).unwritable_plan_targets, null);

  const missing = parseTransitionStatusJson(
    '{"document":"transition","transition_id":"transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","state":"stopped","reason_code":"plan_targets_unwritable_path"}',
  );
  assert.equal(missing.unwritable_plan_targets, null);
});

test("serializeTransitionStatus copies declaration_invalid_detail and parse normalizes missing or out-of-union to null", () => {
  const withSlug: TransitionStatusDocument = {
    ...baseTransitionStatus(null),
    reason_code: "producer_declaration_invalid",
    declaration_invalid_detail: "opening_shape",
  };
  const raw = serializeTransitionStatus(withSlug);
  const parsed = JSON.parse(raw) as TransitionStatusDocument;
  assert.equal(parsed.declaration_invalid_detail, "opening_shape");
  assert.equal(parsed.producer_diagnostic, null);

  const eventRaw = serializeTransitionEvent({
    schema_version: 2,
    sequence: 1,
    timestamp: "2026-08-23T12:00:01.000Z",
    transition_id: "transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    type: "terminal_stop",
    state: "stopped",
    reason_code: "producer_declaration_invalid",
    producer_diagnostic: null,
    unwritable_plan_targets: null,
    producer_refused_paths: null,
    declaration_invalid_detail: "artifact_unchanged",
    review_run_id: null,
  });
  assert.equal((JSON.parse(eventRaw) as TransitionEventDocument).declaration_invalid_detail, "artifact_unchanged");

  const missing = parseTransitionStatusJson(
    '{"document":"transition","transition_id":"transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","state":"stopped","reason_code":"producer_declaration_invalid"}',
  );
  assert.equal(missing.declaration_invalid_detail, null);

  const outOfUnion = parseTransitionStatusJson(
    '{"document":"transition","transition_id":"transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","state":"stopped","reason_code":"producer_declaration_invalid","declaration_invalid_detail":"not_a_slug"}',
  );
  assert.equal(outOfUnion.declaration_invalid_detail, null);
});

test("parseStatusJson leaves a historical implementation-pass awaiting_implementer unchanged", () => {
  const parsed = parseStatusJson(JSON.stringify({
    schema_version: 2,
    run_id: "run-hist",
    state: "awaiting_implementer",
    review_kind: "implementation",
    reason_code: "review_passed",
  }));
  assert.equal(parsed.state, "awaiting_implementer");
  assert.equal(parsed.review_kind, "implementation");
  assert.equal(parsed.reason_code, "review_passed");
});

test("parseStatusJson does not throw on an unknown state string", () => {
  const parsed = parseStatusJson(JSON.stringify({
    schema_version: 2,
    run_id: "run-unknown",
    state: "not_a_run_state",
    review_kind: "plan",
  }));
  assert.equal(parsed.state, "not_a_run_state");
});

test("parseTransitionStatusJson normalizes new keys on an older present producer_diagnostic", () => {
  const diagnostic: ProducerDiagnostic = {
    stage: "write_scope_lock",
    exit_code: null,
    timed_out: false,
    write_scope_code: "hardlink",
    adapter_phase: null,
    adapter_cause: null,
    waited_ms: null,
  } as ProducerDiagnostic;
  const raw = JSON.stringify(baseTransitionStatus(diagnostic));
  const parsed = parseTransitionStatusJson(raw);
  assert.deepEqual(parsed.producer_diagnostic, {
    ...diagnostic,
    snapshot_site: null,
    snapshot_cap: null,
  });
});
