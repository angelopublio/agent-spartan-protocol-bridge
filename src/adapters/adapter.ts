import {
  PERMISSION_MODE,
  SCHEMA_VERSION,
  WORKSPACE_WRITE_PERMISSION_MODE,
  isReviewKind,
  type AdapterCapabilities,
  type AdapterFailureRecord,
  type AdapterProducerInput,
  type AdapterReviewInput,
  type ProducerCapabilities,
  type ReviewerWriteComparison,
  type SnapshotDiffEntry,
} from "../core/contracts.ts";
import type { ReviewStreamProgress } from "./review-stream.ts";

export const PRODUCER_ISOLATED_WORKSPACE_ENV = "SPARTAN_BRIDGE_PRODUCER_ISOLATED";

export function producerChildEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Repository tests use this non-secret marker to distinguish the intentionally
  // reduced producer copy from a live checkout whose authority files disappeared.
  return { ...env, [PRODUCER_ISOLATED_WORKSPACE_ENV]: "1" };
}

export type Adapter = {
  capabilities(): AdapterCapabilities;
  preflight(): Promise<void>;
  prepare(input: AdapterReviewInput): Promise<void>;
  start(input: AdapterReviewInput): Promise<void>;
  collect(): Promise<unknown>;
  observeStream?(sink: (info: ReviewStreamProgress) => void): void;
  verify(): Promise<void>;
  cancel(): Promise<void>;
  cleanup(): Promise<void>;
  observedModel(): string | null;
};

export type ProducerAdapter = {
  producerCapabilities(): ProducerCapabilities;
  producerPreflight(): Promise<void>;
  // Runtime-controlled and idempotent. The adapter only owns the profile;
  // preparation and merge-back remain runtime responsibilities.
  lockProducerIsolation(repoRoot: string, workspaceRoot: string): Promise<void>;
  startProducer(input: AdapterProducerInput): Promise<void>;
  waitProducer(): Promise<{ exitCode: number | null; timedOut: boolean }>;
  // Runtime-controlled: called after post-child capture and validation, or on
  // any earlier terminal path. The guard contains only the sandbox profile;
  // no live-tree modes are changed or restored.
  releaseProducerIsolation(): Promise<void>;
  cancelProducer(): Promise<void>;
  cleanupProducer(): Promise<void>;
};

export function isProducerAdapter(adapter: Adapter): adapter is Adapter & ProducerAdapter {
  const candidate = adapter as Adapter & Partial<ProducerAdapter>;
  return (
    typeof candidate.producerCapabilities === "function" &&
    typeof candidate.producerPreflight === "function" &&
    typeof candidate.lockProducerIsolation === "function" &&
    typeof candidate.startProducer === "function" &&
    typeof candidate.waitProducer === "function" &&
    typeof candidate.releaseProducerIsolation === "function" &&
    typeof candidate.cancelProducer === "function" &&
    typeof candidate.cleanupProducer === "function"
  );
}

export class AdapterIsolationError extends Error {
  override readonly name = "AdapterIsolationError";
  constructor(message = "reviewer_isolation_unavailable") {
    super(message);
  }
}

export class AdapterFailureError extends Error {
  override readonly name = "AdapterFailureError";
  readonly adapterFailure: AdapterFailureRecord;
  readonly stderr: Buffer;
  readonly output: Buffer;
  readonly payload: string | null;
  constructor(
    adapterFailure: AdapterFailureRecord,
    stderr: Buffer = Buffer.alloc(0),
    message = "adapter_error",
    payload: string | null = null,
    output: Buffer | undefined = undefined,
  ) {
    super(message);
    this.adapterFailure = adapterFailure;
    this.stderr = stderr;
    this.output = output ?? stderr;
    this.payload = payload;
  }
}

export class AdapterTimeoutError extends Error {
  override readonly name = "AdapterTimeoutError";
  readonly adapterFailure: AdapterFailureRecord | null;
  readonly stderr: Buffer;
  constructor(
    message = "adapter_timeout",
    adapterFailure: AdapterFailureRecord | null = null,
    stderr: Buffer = Buffer.alloc(0),
  ) {
    super(message);
    this.adapterFailure = adapterFailure;
    this.stderr = stderr;
  }
}

export class ReviewerWriteDetectedError extends Error {
  override readonly name = "ReviewerWriteDetectedError";
  readonly comparison: ReviewerWriteComparison;
  readonly entries: readonly SnapshotDiffEntry[];
  constructor(comparison: ReviewerWriteComparison, entries: readonly SnapshotDiffEntry[]) {
    if (entries.length === 0) {
      throw new TypeError("reviewer_write_detected requires a non-empty entry list");
    }
    super("reviewer_write_detected");
    this.comparison = comparison;
    this.entries = entries;
  }
}

export type LauncherCatalog = {
  resolve(launcherId: string): Adapter;
};

export function capabilitiesAllowed(capabilities: AdapterCapabilities): boolean {
  return (
    capabilities.review_kinds.length > 0 &&
    new Set(capabilities.review_kinds).size === capabilities.review_kinds.length &&
    capabilities.review_kinds.every((kind) => isReviewKind(kind)) &&
    capabilities.permission_modes.includes(PERMISSION_MODE) &&
    new Set(capabilities.permission_modes).size === capabilities.permission_modes.length &&
    capabilities.permission_modes.length > 0 &&
    capabilities.workspace_write === false &&
    capabilities.fresh_context === true &&
    capabilities.schema_version === SCHEMA_VERSION &&
    Number.isInteger(capabilities.schema_version)
  );
}

export function producerCapabilitiesAllowed(capabilities: ProducerCapabilities): boolean {
  return (
    capabilities.roles.length === 1 &&
    capabilities.roles[0] === "implementer" &&
    new Set(capabilities.roles).size === capabilities.roles.length &&
    capabilities.permission_modes.includes(WORKSPACE_WRITE_PERMISSION_MODE) &&
    new Set(capabilities.permission_modes).size === capabilities.permission_modes.length &&
    capabilities.permission_modes.length > 0 &&
    capabilities.workspace_write === true &&
    capabilities.fresh_context === true &&
    capabilities.isolated_producer_workspace === true &&
    capabilities.schema_version === SCHEMA_VERSION &&
    Number.isInteger(capabilities.schema_version)
  );
}
