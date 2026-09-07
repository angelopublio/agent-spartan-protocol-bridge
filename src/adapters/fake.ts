import {
  FAKE_LAUNCHER_ID,
  PERMISSION_MODE,
  SCHEMA_VERSION,
  WORKSPACE_WRITE_PERMISSION_MODE,
  type AdapterCapabilities,
  type AdapterProducerInput,
  type AdapterReviewInput,
  type ProducerCapabilities,
  type ReviewResult,
} from "../core/contracts.ts";
import { type Adapter, type LauncherCatalog, type ProducerAdapter } from "./adapter.ts";

export type { Adapter, LauncherCatalog } from "./adapter.ts";
export { capabilitiesAllowed } from "./adapter.ts";

export type FakeResultSource = {
  result(): ReviewResult | Promise<ReviewResult>;
};

export const PRODUCTION_FAKE_RESULT: ReviewResult = {
  schema_version: SCHEMA_VERSION,
  review_kind: "plan",
  verdict: "human_required",
  summary: "No real reviewer adapter exists in Phase 1A.",
  findings: [
    {
      id: "NO_REAL_ADAPTER",
      severity: "warning",
      message: "Phase 1A provides only the in-process fake reviewer.",
    },
  ],
};

export const PRODUCTION_FAKE_SOURCE: FakeResultSource = {
  result: () => structuredClone(PRODUCTION_FAKE_RESULT),
};

export function fakeCapabilities(launcherId = FAKE_LAUNCHER_ID): AdapterCapabilities {
  return {
    schema_version: SCHEMA_VERSION,
    launcher_id: launcherId,
    review_kinds: ["plan", "implementation"],
    permission_modes: [PERMISSION_MODE],
    workspace_write: false,
    fresh_context: true,
    observes_model: false,
    structured_output: true,
    isolated_workspace: true,
  };
}

export function fakeProducerCapabilities(launcherId = FAKE_LAUNCHER_ID): ProducerCapabilities {
  return {
    schema_version: SCHEMA_VERSION,
    launcher_id: launcherId,
    roles: ["implementer"],
    permission_modes: [WORKSPACE_WRITE_PERMISSION_MODE],
    workspace_write: true,
    fresh_context: true,
    isolated_producer_workspace: true,
  };
}

export type FakeProducerHook = {
  exitCode?: number | null;
  timedOut?: boolean;
  mutate?: (input: AdapterProducerInput) => Promise<void>;
  wait?: () => Promise<{ exitCode: number | null; timedOut: boolean }>;
};

export class FakeAdapter implements Adapter, ProducerAdapter {
  readonly instanceId = Math.random();
  private started = false;
  private cancelled = false;
  private producerStarted = false;
  private producerCancelled = false;
  private producerInput: AdapterProducerInput | undefined;

  constructor(
    private readonly source: FakeResultSource,
    private readonly caps: AdapterCapabilities = fakeCapabilities(),
    private readonly observation: string | null = null,
    private readonly producer: FakeProducerHook | false = {},
    private readonly producerCaps: ProducerCapabilities = fakeProducerCapabilities(),
  ) {}

  capabilities(): AdapterCapabilities {
    return {
      schema_version: this.caps.schema_version,
      launcher_id: this.caps.launcher_id,
      review_kinds: [...this.caps.review_kinds],
      permission_modes: [...this.caps.permission_modes],
      workspace_write: this.caps.workspace_write,
      fresh_context: this.caps.fresh_context,
      observes_model: this.observation !== null,
      structured_output: this.caps.structured_output,
      isolated_workspace: this.caps.isolated_workspace,
    };
  }

  async preflight(): Promise<void> {
    return;
  }

  async prepare(input: AdapterReviewInput): Promise<void> {
    void input;
  }

  async start(input: AdapterReviewInput): Promise<void> {
    void input;
    this.started = true;
  }

  async collect(): Promise<unknown> {
    if (!this.started || this.cancelled) {
      throw new Error("adapter_not_started");
    }
    return this.source.result();
  }

  async verify(): Promise<void> {
    return;
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
  }

  async cleanup(): Promise<void> {
    return;
  }

  observedModel(): string | null {
    return this.observation;
  }

  producerCapabilities(): ProducerCapabilities {
    if (this.producer === false) {
      throw new Error("producer_unavailable");
    }
    return {
      schema_version: this.producerCaps.schema_version,
      launcher_id: this.producerCaps.launcher_id,
      roles: [...this.producerCaps.roles],
      permission_modes: [...this.producerCaps.permission_modes],
      workspace_write: true,
      fresh_context: this.producerCaps.fresh_context,
      isolated_producer_workspace: this.producerCaps.isolated_producer_workspace,
    };
  }

  async producerPreflight(): Promise<void> {
    if (this.producer === false) {
      throw new Error("producer_unavailable");
    }
  }

  async lockProducerIsolation(repoRoot: string, workspaceRoot: string): Promise<void> {
    void repoRoot;
    void workspaceRoot;
  }

  async startProducer(input: AdapterProducerInput): Promise<void> {
    if (this.producer === false) {
      throw new Error("producer_unavailable");
    }
    this.producerInput = input;
    this.producerStarted = true;
  }

  async waitProducer(): Promise<{ exitCode: number | null; timedOut: boolean }> {
    if (this.producer === false || !this.producerStarted || this.producerCancelled) {
      throw new Error("adapter_not_started");
    }
    if (this.producer.wait) {
      return this.producer.wait();
    }
    if (this.producer.mutate && this.producerInput) {
      await this.producer.mutate(this.producerInput);
    }
    return {
      exitCode: this.producer.exitCode === undefined ? 0 : this.producer.exitCode,
      timedOut: this.producer.timedOut === true,
    };
  }

  async releaseProducerIsolation(): Promise<void> {
    return;
  }

  async cancelProducer(): Promise<void> {
    this.producerCancelled = true;
  }

  async cleanupProducer(): Promise<void> {
    this.producerStarted = false;
    this.producerInput = undefined;
  }
}

export class MaliciousAdapter implements Adapter {
  constructor(private readonly payload: unknown) {}

  capabilities(): AdapterCapabilities {
    return fakeCapabilities();
  }

  async preflight(): Promise<void> {
    return;
  }

  async prepare(): Promise<void> {
    return;
  }

  async start(): Promise<void> {
    return;
  }

  async collect(): Promise<unknown> {
    return this.payload;
  }

  async verify(): Promise<void> {
    return;
  }

  async cancel(): Promise<void> {
    return;
  }

  async cleanup(): Promise<void> {
    return;
  }

  observedModel(): string | null {
    return null;
  }
}

export function createLauncherCatalog(
  createFake: () => Adapter,
  extra = new Map<string, () => Adapter>(),
): LauncherCatalog {
  return {
    resolve(launcherId: string): Adapter {
      if (launcherId === FAKE_LAUNCHER_ID) {
        return createFake();
      }
      const factory = extra.get(launcherId);
      if (!factory) {
        throw new Error("launcher_unavailable");
      }
      return factory();
    },
  };
}
