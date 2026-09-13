import fs from "node:fs/promises";
import path from "node:path";
import type { RuntimeBuild } from "../core/contracts.ts";

const COMMIT_RE = /^[0-9a-f]{40}$/i;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,127}$/;
const RFC3339_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function normalizeRuntimeBuild(value: unknown): RuntimeBuild | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.version !== "string" ||
    !VERSION_RE.test(record.version) ||
    typeof record.built_at !== "string" ||
    !RFC3339_UTC_RE.test(record.built_at) ||
    !Number.isFinite(Date.parse(record.built_at))
  ) {
    return null;
  }
  if (record.commit === null) {
    if (record.dirty !== null) {
      return null;
    }
  } else if (
    typeof record.commit !== "string" ||
    !COMMIT_RE.test(record.commit) ||
    typeof record.dirty !== "boolean"
  ) {
    return null;
  }
  return {
    version: record.version,
    commit: record.commit === null ? null : record.commit.toLowerCase(),
    dirty: record.dirty as boolean | null,
    built_at: record.built_at,
  };
}

export async function readRuntimeBuild(packageRoot: string): Promise<RuntimeBuild | null> {
  try {
    const text = await fs.readFile(path.join(packageRoot, "dist", "build-info.json"), "utf8");
    return normalizeRuntimeBuild(JSON.parse(text));
  } catch {
    return null;
  }
}

export function formatRuntimeBuild(build: RuntimeBuild | null | undefined): string {
  const normalized = normalizeRuntimeBuild(build);
  if (normalized === null) {
    return "spartan-bridge build unknown";
  }
  const commit = normalized.commit === null ? "unknown" : normalized.commit;
  const dirty = normalized.dirty === null ? "unknown" : String(normalized.dirty);
  return `spartan-bridge version=${normalized.version} commit=${commit} dirty=${dirty} built_at=${normalized.built_at}`;
}
