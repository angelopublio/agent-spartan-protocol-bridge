import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CLAUDE_LAUNCHER_ID, ClaudeAdapter } from "./adapters/claude.ts";
import { CODEX_LAUNCHER_ID, CodexAdapter } from "./adapters/codex.ts";
import { CURSOR_LAUNCHER_ID, CursorAdapter } from "./adapters/cursor.ts";
import { GROK_LAUNCHER_ID, GrokAdapter } from "./adapters/grok.ts";
import type { Adapter } from "./adapters/adapter.ts";
import {
  createLauncherCatalog,
  FakeAdapter,
  PRODUCTION_FAKE_SOURCE,
} from "./adapters/fake.ts";
import { createNodeProcessRunner } from "./adapters/process.ts";
import type { AppDeps, Clock } from "./core/review.ts";
import type { RuntimeBuild } from "./core/contracts.ts";
import { RegistryUnavailableError, type RegistrySource } from "./policy/registry.ts";

export function registryPathFromEnv(env: NodeJS.ProcessEnv): string {
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) {
    return path.join(xdg, "spartan-bridge", "client-contexts.yaml");
  }
  const home = env.HOME;
  if (!home) {
    throw new RegistryUnavailableError();
  }
  return path.join(home, ".config", "spartan-bridge", "client-contexts.yaml");
}

export function createFileRegistrySource(env: NodeJS.ProcessEnv = process.env): RegistrySource {
  return {
    async load(): Promise<string> {
      const file = registryPathFromEnv(env);
      try {
        return await fs.readFile(file, "utf8");
      } catch {
        throw new RegistryUnavailableError();
      }
    },
  };
}

export function createProductionClock(): Clock {
  return {
    now: () => new Date(),
    createRunId: () => `run-${randomUUID()}`,
    createExecutionId: () => `exec-${randomUUID()}`,
    createTransitionId: () => `transition-${randomUUID()}`,
  };
}

export function createProductionDeps(
  env: NodeJS.ProcessEnv = process.env,
  runtimeBuild: RuntimeBuild | null = null,
): AppDeps {
  const runner = createNodeProcessRunner();
  return {
    registry: createFileRegistrySource(env),
    catalog: createLauncherCatalog(
      () => new FakeAdapter(PRODUCTION_FAKE_SOURCE),
      new Map<string, () => Adapter>([
        [CURSOR_LAUNCHER_ID, () => new CursorAdapter({ runner, env })],
        [CODEX_LAUNCHER_ID, () => new CodexAdapter({ runner, env })],
        [GROK_LAUNCHER_ID, () => new GrokAdapter({ runner, env })],
        [CLAUDE_LAUNCHER_ID, () => new ClaudeAdapter({ runner, env })],
      ]),
    ),
    clock: createProductionClock(),
    runtimeBuild,
  };
}

export function createMemoryRegistrySource(yaml: string): RegistrySource {
  return {
    async load(): Promise<string> {
      return yaml;
    },
  };
}
