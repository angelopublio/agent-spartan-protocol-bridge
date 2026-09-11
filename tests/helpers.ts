import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLauncherCatalog, FakeAdapter, type Adapter, type FakeResultSource } from "../src/adapters/fake.ts";
import {
  AdapterIsolationError,
  AdapterTimeoutError,
  ReviewerWriteDetectedError,
} from "../src/adapters/adapter.ts";
import type {
  AdapterCapabilities,
  AdapterReviewInput,
  ReviewerWriteComparison,
  SnapshotDiffEntry,
} from "../src/core/contracts.ts";
import type { ReviewStreamProgress } from "../src/adapters/review-stream.ts";
import type { AppDeps, Clock } from "../src/core/review.ts";
import type { ReviewResult } from "../src/core/contracts.ts";
import { SCHEMA_VERSION, type ReviewKind } from "../src/core/contracts.ts";
import { implementationHandoffEnvelope } from "../src/core/producer-declaration.ts";
import {
  AUTOMATIC_CORRECTION_REVIEW_GRANT,
  AUTOMATIC_IMPLEMENTATION_GRANT,
  HUMAN_STARTS_PLANNER,
  IMPLEMENTATION_REVIEW_GRANT,
  PRODUCER_ROLE_STOP_EXCEPTIONS,
} from "../src/policy/agents-policy.ts";
import { createMemoryRegistrySource } from "../src/composition.ts";
import { readEventsParsed, readStatus } from "../src/runtime/store.ts";
import type { EventDocument, ReasonCode, RunState, StatusDocument } from "../src/core/contracts.ts";

// Cursor's real capabilities report `structured_output: false`, so `runReview`
// refuses a Cursor reviewer dispatch (D-043 / reviewer_output_unconstrained).
// Tests that exercise the Cursor adapter's own review mechanics through
// `runReview` wrap the instance so the dispatch proceeds; the refusal itself
// is covered by a dedicated test.
export function withStructuredOutput<T extends Adapter>(adapter: T): T {
  const original = adapter.capabilities.bind(adapter);
  adapter.capabilities = (): AdapterCapabilities => ({ ...original(), structured_output: true });
  return adapter;
}

// Every real reviewer adapter runs isolated, so `runReview` skips the
// repository-worktree diff (task 0051 / D-052). Tests that exercise that diff
// itself — a reviewer write on the live tree, the repo-snapshot cap — wrap the
// adapter so it reports the in-place path; the skip is covered by a dedicated
// test.
export function withInPlaceWorkspace<T extends Adapter>(adapter: T): T {
  const original = adapter.capabilities.bind(adapter);
  adapter.capabilities = (): AdapterCapabilities => ({ ...original(), isolated_workspace: false });
  return adapter;
}

export const TASK_REL = "spartan/tasks/0001-bootstrap-fixture.md";

export const VALID_REGISTRY = `schema_version: 1
client_contexts:
  personal:
    codex:
      launcher: fake-reviewer-v1
    claude:
      launcher: fake-reviewer-v1
    cursor:
      launcher: fake-reviewer-v1
    grok:
      launcher: fake-reviewer-v1
  company:
    codex:
      launcher: fake-reviewer-v1
    claude:
      launcher: fake-reviewer-v1
    cursor:
      launcher: fake-reviewer-v1
    grok:
      launcher: fake-reviewer-v1
  hobby:
    codex:
      launcher: fake-reviewer-v1
    claude:
      launcher: fake-reviewer-v1
    cursor:
      launcher: fake-reviewer-v1
    grok:
      launcher: fake-reviewer-v1
  client-a:
    codex:
      launcher: fake-reviewer-v1
    claude:
      launcher: fake-reviewer-v1
    cursor:
      launcher: fake-reviewer-v1
    grok:
      launcher: fake-reviewer-v1
  default:
    codex:
      launcher: fake-reviewer-v1
    claude:
      launcher: fake-reviewer-v1
    cursor:
      launcher: fake-reviewer-v1
    grok:
      launcher: fake-reviewer-v1
`;

export const FIXTURE_PLAN_MODEL = "Composer-2.5";
export const FIXTURE_PLAN_EFFORT = "none" as const;

export function validAgentsMd(options?: {
  host?: string;
  context?: string;
  model?: string;
  effort?: string;
  cycles?: 1 | 2 | 3;
  extraSection?: string;
  omitPlan?: boolean;
  omitTable?: boolean;
  omitGrant?: boolean;
  conflict?: boolean;
  extraPlan?: boolean;
  taskWrite?: boolean;
  duplicateTaskWrite?: boolean;
  producerChain?: boolean;
  duplicateProducerChain?: boolean;
  implementationGrant?: boolean;
  implementationScope?: readonly string[] | "missing" | "empty";
  omitImplementationRow?: boolean;
  duplicateImplementationGrant?: boolean;
  implementerHost?: string;
  omitImplementerRow?: boolean;
  automaticImplementation?: boolean;
  duplicateAutomaticImplementation?: boolean;
  automaticWriteScope?: readonly string[] | "missing" | "empty";
  implementationCycles?: 1 | 2 | 3;
  omitImplementationCycle?: boolean;
}): string {
  const host = options?.host ?? "Cursor";
  const context = options?.context ?? "personal";
  const model = options?.model ?? FIXTURE_PLAN_MODEL;
  const effort = options?.effort ?? FIXTURE_PLAN_EFFORT;
  const cycles = options?.cycles ?? 3;
  const implementationRow = options?.omitImplementationRow
    ? ""
    : `| reviewer.implementation | ${host} | ${context} | ${model} | ${effort} |\n`;
  const implementerRow = options?.omitImplementerRow
    ? ""
    : `| implementer | ${options?.implementerHost ?? "Cursor"} | personal | Composer-2.5 | none |\n`;
  const rows = options?.omitPlan
    ? "| planner | Codex | personal | gpt-5.6-terra | high |"
    : options?.extraPlan
      ? `| reviewer.plan | ${host} | ${context} | ${model} | ${effort} |\n| reviewer.plan | Codex | personal | gpt-5.6-terra | high |\n| planner | Codex | personal | gpt-5.6-terra | high |`
      : `| planner | Codex | personal | gpt-5.6-terra | high |\n| reviewer.plan | ${host} | ${context} | ${model} | ${effort} |\n${implementerRow}${implementationRow}`;
  const table = options?.omitTable
    ? ""
    : `| Binding | Host | Client context | Model | Effort |\n| --- | --- | --- | --- | --- |\n${rows}\n`;
  const grant = options?.omitGrant
    ? ""
    : `- A human-started Spartan Bridge run may start the mapped reviewer automatically.\n- The Bridge may return findings to the current planner session and repeat up to ${cycles} plan-review cycles.\n`;
  const implementationCycleN = options?.implementationCycles ?? cycles;
  const implementationCycle =
    options?.omitImplementationCycle || (!options?.implementationGrant && !options?.automaticImplementation)
      ? ""
      : `- After a persisted plan-review pass, the Bridge may return implementation findings to a fresh mapped implementer execution and repeat up to ${implementationCycleN} implementation-review cycles.\n`;
  const taskWriteLine =
    "- This run grants the Bridge `task_artifact_write` only for persisting validated reviewer findings and transition metadata to the explicitly identified current Spartan task artifact.\n";
  const taskWrite = options?.duplicateTaskWrite ? `${taskWriteLine}${taskWriteLine}` : options?.taskWrite ? taskWriteLine : "";
  const producerChainLine =
    "- A producer round that received findings from a Spartan Bridge run may start the next review run automatically within the authorized cycle limit.\n";
  const producerChain = options?.duplicateProducerChain
    ? `${producerChainLine}${producerChainLine}`
    : options?.producerChain
      ? producerChainLine
      : "";
  const implementationGrantLine = `- ${IMPLEMENTATION_REVIEW_GRANT}\n`;
  const implementationGrant = options?.duplicateImplementationGrant
    ? `${implementationGrantLine}${implementationGrantLine}`
    : options?.implementationGrant || options?.automaticImplementation
      ? implementationGrantLine
      : "";
  const automaticGrantLine = `- ${AUTOMATIC_IMPLEMENTATION_GRANT}\n`;
  const automaticCorrectionLine = `- ${AUTOMATIC_CORRECTION_REVIEW_GRANT}\n`;
  const automaticCompanionLines = `- ${HUMAN_STARTS_PLANNER}\n- ${PRODUCER_ROLE_STOP_EXCEPTIONS}\n`;
  const automaticGrants = options?.duplicateAutomaticImplementation
    ? `${automaticGrantLine}${automaticGrantLine}${automaticCorrectionLine}${automaticCompanionLines}`
    : options?.automaticImplementation
      ? `${automaticGrantLine}${automaticCorrectionLine}${automaticCompanionLines}`
      : "";
  const defaultWriteScope = [
    "src/",
    "tests/",
    "docs/",
    "skills/",
    "agent-skill/skills/spbridge/SKILL.md",
    "spartan/",
    "README.md",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
  ];
  const defaultReviewScope = [...defaultWriteScope, "AGENTS.md", "spartan-bridge/config.yaml"];
  let implementationScope = "";
  if (options?.implementationScope === "empty") {
    implementationScope = "### Implementation review scope\n\n";
  } else if (Array.isArray(options?.implementationScope)) {
    implementationScope = `### Implementation review scope\n\n${options.implementationScope.map((entry) => `- \`${entry}\``).join("\n")}\n`;
  } else if (options?.automaticImplementation && options?.implementationScope !== "missing") {
    implementationScope = `### Implementation review scope\n\n${defaultReviewScope.map((entry) => `- \`${entry}\``).join("\n")}\n`;
  } else if (options?.implementationGrant && options?.implementationScope !== "missing") {
    implementationScope = `### Implementation review scope\n\n- \`src/\`\n- \`README.md\`\n`;
  }
  let automaticWriteScope = "";
  if (options?.automaticWriteScope === "empty") {
    automaticWriteScope = "### Automatic implementation write scope\n\n";
  } else if (Array.isArray(options?.automaticWriteScope)) {
    automaticWriteScope = `### Automatic implementation write scope\n\n${options.automaticWriteScope.map((entry) => `- \`${entry}\``).join("\n")}\n`;
  } else if (options?.automaticImplementation) {
    automaticWriteScope = `### Automatic implementation write scope\n\n${defaultWriteScope.map((entry) => `- \`${entry}\``).join("\n")}\n`;
  }
  const conflict = options?.conflict ? "The human starts every round.\n" : "";
  return `# Fixture

## Agent hosts

${table}
## Spartan Bridge automation authority

${grant}${implementationCycle}${taskWrite}${producerChain}${automaticGrants}${implementationGrant}- The human starts each producer phase.
${automaticWriteScope}${implementationScope}${conflict}
${options?.extraSection ?? ""}
`;
}

export function validTaskMd(options?: {
  id?: string;
  extra?: string;
  role?: string;
  nextRole?: string;
  protocol?: string;
  status?: string;
  phase?: string;
  taskType?: string;
  nextHandoffId?: string;
  reviewSection?: string;
}): string {
  const id = options?.id ?? "bootstrap-fixture";
  const extra = options?.extra ?? "";
  const review =
    options?.reviewSection === undefined
      ? ""
      : options.reviewSection;
  return `---
protocol: "${options?.protocol ?? "0.6.1"}"
id: ${id}
created_at: 2026-08-16
status: ${options?.status ?? "active"}
phase: ${options?.phase ?? "planning"}
task_type: ${options?.taskType ?? "planning"}
risk: high-impact
current_role: ${options?.role ?? "planner"}
next_role: ${options?.nextRole ?? "reviewer"}
updated_at: 2026-08-16
handoff_id: none
next_handoff_id: ${options?.nextHandoffId ?? "none"}${extra}
---

# Fixture task

Body is opaque.
${review}
`;
}

export const DEFAULT_REVIEW_SECTION = `## Review

Human notes stay below the Bridge region.
`;

export async function makeRepo(options?: {
  agents?: string;
  task?: string;
  taskRel?: string;
  product?: string;
}): Promise<{ root: string; taskRel: string; productRel: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-bridge-"));
  const taskRel = options?.taskRel ?? TASK_REL;
  const productRel = "docs/product.txt";
  await fs.mkdir(path.join(root, path.dirname(taskRel)), { recursive: true });
  await fs.mkdir(path.join(root, "docs"), { recursive: true });
  await fs.writeFile(path.join(root, "AGENTS.md"), options?.agents ?? validAgentsMd(), "utf8");
  await fs.writeFile(path.join(root, taskRel), options?.task ?? validTaskMd(), "utf8");
  await fs.writeFile(path.join(root, productRel), options?.product ?? "product-v1\n", "utf8");
  return { root, taskRel, productRel };
}

export const AUTOMATIC_BRIDGE_CONFIG = `schema_version: 1
transitions:
  review_plan_pass:
    successor: implementer
    dispatch: automatic
`;

export const MANUAL_BRIDGE_CONFIG = `schema_version: 1
transitions:
  review_plan_pass:
    successor: implementer
    dispatch: manual
`;

export async function writeBridgeConfig(root: string, contents = AUTOMATIC_BRIDGE_CONFIG): Promise<void> {
  await fs.mkdir(path.join(root, "spartan-bridge"), { recursive: true });
  await fs.writeFile(path.join(root, "spartan-bridge", "config.yaml"), contents, "utf8");
}

export function readyImplementationTask(taskRel: string, handoffId = "HX-001", stamp = ""): string {
  const review = `\n${DEFAULT_REVIEW_SECTION}${stamp}`;
  return `${implementationTaskMd({ nextHandoffId: handoffId, reviewSection: review })}
## Blockers

None.

## Next Action

Re-review the implementation against all acceptance criteria.

${implementationHandoffEnvelope(taskRel, handoffId)}`;
}

export async function declareImplementationReady(
  root: string,
  taskRel: string,
  handoffId = "HX-001",
  stamp = "",
): Promise<void> {
  await fs.writeFile(path.join(root, taskRel), readyImplementationTask(taskRel, handoffId, stamp), "utf8");
}

export function implementationTaskMd(options?: {
  id?: string;
  extra?: string;
  protocol?: string;
  nextRole?: string;
  role?: string;
  phase?: string;
  taskType?: string;
  nextHandoffId?: string;
  reviewSection?: string;
}): string {
  return validTaskMd({
    id: options?.id,
    extra: options?.extra,
    protocol: options?.protocol,
    role: options?.role ?? "implementer",
    nextRole: options?.nextRole ?? "reviewer",
    phase: options?.phase ?? "reviewing",
    taskType: options?.taskType ?? "implementation",
    nextHandoffId: options?.nextHandoffId,
    reviewSection: options?.reviewSection,
  });
}

export function passResult(kind: ReviewKind = "plan"): ReviewResult {
  return {
    schema_version: SCHEMA_VERSION,
    review_kind: kind,
    verdict: "pass",
    summary: "Plan is implementable.",
    findings: [],
  };
}

export function changesResult(kind: ReviewKind = "plan"): ReviewResult {
  return {
    schema_version: SCHEMA_VERSION,
    review_kind: kind,
    verdict: "changes_requested",
    summary: "Plan needs changes.",
    findings: [{ id: "F1", severity: "warning", message: "Pin the remaining contract." }],
  };
}

export function blockedResult(kind: ReviewKind = "plan"): ReviewResult {
  return {
    schema_version: SCHEMA_VERSION,
    review_kind: kind,
    verdict: "blocked",
    summary: "Reviewer blocked.",
    findings: [{ id: "B1", severity: "error", message: "Missing authority." }],
  };
}

export function constantSource(result: ReviewResult): FakeResultSource {
  return { result: () => structuredClone(result) };
}

export function testClock(runId = "run-11111111-1111-4111-8111-111111111111"): Clock {
  let seconds = 0;
  let exec = 0;
  let transitions = 0;
  return {
    now: () => new Date(Date.UTC(2026, 7, 16, 12, 0, seconds++)),
    createRunId: () => runId,
    createExecutionId: () => {
      exec += 1;
      return `exec-22222222-2222-4222-8222-22222222222${exec}`;
    },
    createTransitionId: () => {
      transitions += 1;
      return `transition-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${transitions}`;
    },
  };
}

export function testDeps(options?: {
  registryYaml?: string;
  source?: FakeResultSource;
  createAdapter?: () => Adapter;
  clock?: Clock;
  snapshotCaps?: { entries?: number; hashBytes?: number };
  producerSnapshotCaps?: AppDeps["producerSnapshotCaps"];
}): AppDeps {
  const source = options?.source ?? constantSource(passResult());
  return {
    registry: createMemoryRegistrySource(options?.registryYaml ?? VALID_REGISTRY),
    catalog: createLauncherCatalog(options?.createAdapter ?? (() => new FakeAdapter(source))),
    clock: options?.clock ?? testClock(),
    snapshotCaps: options?.snapshotCaps,
    producerSnapshotCaps: options?.producerSnapshotCaps,
  };
}

export async function snapshotFiles(root: string, rels: string[]): Promise<Map<string, string>> {
  const { sha256Bytes } = await import("../src/core/serialize.ts");
  const map = new Map<string, string>();
  for (const rel of rels) {
    const bytes = new Uint8Array(await fs.readFile(path.join(root, rel)));
    map.set(rel, sha256Bytes(bytes));
  }
  return map;
}

export async function loadRun(root: string, runId: string): Promise<{
  status: StatusDocument;
  events: EventDocument[];
}> {
  const runDir = path.join(root, ".spartan-bridge", "runs", runId);
  return {
    status: await readStatus(runDir),
    events: await readEventsParsed(runDir),
  };
}

export function assertNullability(
  status: StatusDocument,
  expected: {
    reason: ReasonCode;
    state: RunState;
    D: boolean;
    T: boolean;
    G: boolean;
    E: boolean;
    V: boolean;
  },
): void {
  assert.equal(status.reason_code, expected.reason);
  assert.equal(status.state, expected.state);
  assert.equal(status.policy_digest !== null, expected.D, "policy_digest");
  assert.equal(status.artifact_hashes.task !== null, expected.T, "task hash");
  assert.equal(status.artifact_hashes.agents !== null, expected.G, "agents hash");
  assert.equal(status.execution_id !== null, expected.E, "execution_id");
  assert.equal(status.verdict !== null, expected.V, "verdict");
}

export function eventTypes(events: EventDocument[]): string[] {
  return events.map((event) => event.type);
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export class CountingAdapter implements Adapter {
  prepareCount = 0;
  startCount = 0;
  collectCount = 0;
  verifyCount = 0;
  cancelCount = 0;
  cleanupCount = 0;
  preflightCount = 0;

  constructor(private readonly inner: Adapter) {}

  capabilities() {
    return this.inner.capabilities();
  }

  preflight() {
    this.preflightCount += 1;
    return this.inner.preflight();
  }

  async prepare(input: AdapterReviewInput) {
    this.prepareCount += 1;
    return this.inner.prepare(input);
  }

  async start(input: AdapterReviewInput) {
    this.startCount += 1;
    return this.inner.start(input);
  }

  async collect() {
    this.collectCount += 1;
    return this.inner.collect();
  }

  observeStream(sink: (info: ReviewStreamProgress) => void) {
    this.inner.observeStream?.(sink);
  }

  async verify() {
    this.verifyCount += 1;
    return this.inner.verify();
  }

  async cancel() {
    this.cancelCount += 1;
    return this.inner.cancel();
  }

  async cleanup() {
    this.cleanupCount += 1;
    return this.inner.cleanup();
  }

  observedModel() {
    return this.inner.observedModel();
  }
}

export class HookThrowAdapter extends FakeAdapter {
  constructor(
    source: FakeResultSource,
    private readonly hook: "preflight" | "prepare" | "start" | "collect" | "verify",
    private readonly error: Error,
  ) {
    super(source);
  }

  override async preflight(): Promise<void> {
    if (this.hook === "preflight") {
      throw this.error;
    }
    return super.preflight();
  }

  override async prepare(input: AdapterReviewInput): Promise<void> {
    if (this.hook === "prepare") {
      throw this.error;
    }
    return super.prepare(input);
  }

  override async start(input: AdapterReviewInput): Promise<void> {
    if (this.hook === "start") {
      throw this.error;
    }
    return super.start(input);
  }

  override async collect(): Promise<unknown> {
    if (this.hook === "collect") {
      throw this.error;
    }
    return super.collect();
  }

  override async verify(): Promise<void> {
    if (this.hook === "verify") {
      throw this.error;
    }
    return super.verify();
  }
}

export { AdapterIsolationError, AdapterTimeoutError, ReviewerWriteDetectedError };

export function reviewerWriteError(
  comparison: ReviewerWriteComparison = "reviewer_workspace",
  entries: readonly SnapshotDiffEntry[] = [{ path: "task.md", change: "changed", fields: ["hash"] }],
): ReviewerWriteDetectedError {
  return new ReviewerWriteDetectedError(comparison, entries);
}
