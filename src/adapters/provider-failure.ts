import type { AdapterFailureCause } from "../core/contracts.ts";

export type ProviderFailureCause = Extract<AdapterFailureCause, "provider_unavailable" | "provider_limit">;

export type ProviderFailureClassification = {
  cause: ProviderFailureCause | null;
  http_status: number | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function lastResultObject(stdout: string): Record<string, unknown> | null {
  let last: Record<string, unknown> | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }
    const obj = parseJsonObject(line);
    if (obj !== null && obj.type === "result") {
      last = obj;
    }
  }
  const whole = parseJsonObject(stdout);
  if (whole !== null && whole.type === "result") {
    last = whole;
  }
  return last;
}

function httpStatusFrom(value: unknown): number | null {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value >= 100 &&
    value <= 599
  ) {
    return value;
  }
  return null;
}

export function classifyProviderFailure(stdout: Buffer | string): ProviderFailureClassification {
  const text = typeof stdout === "string" ? stdout : stdout.toString("utf8");
  const result = lastResultObject(text);
  if (result === null) {
    return { cause: null, http_status: null };
  }
  const http_status = httpStatusFrom(result.api_error_status);
  const isError = result.is_error === true;
  if (isError && http_status === 429) {
    return { cause: "provider_limit", http_status: 429 };
  }
  if (isError && http_status !== null && http_status >= 500) {
    return { cause: "provider_unavailable", http_status };
  }
  if (isError && result.terminal_reason === "api_error" && http_status === null) {
    return { cause: "provider_unavailable", http_status: null };
  }
  return { cause: null, http_status };
}
