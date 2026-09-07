import os from "node:os";
import path from "node:path";
import { isSensitiveRegistryKey } from "./sensitive-fields.ts";

export const ADAPTER_STDERR_CAP_BYTES = 16 * 1024;
export const RETAINED_PAYLOAD_CAP_BYTES = 16 * 1024;
export const RETAINED_PAYLOAD_TRUNCATION_MARKER = "[truncated: earlier bytes dropped]";
const REDACTED = "[redacted]";

export function redactAdapterStderr(input: Buffer): Buffer {
  if (input.length === 0) {
    return Buffer.alloc(0);
  }
  const redacted = redactAdapterStderrText(input.toString("utf8"));
  const bytes = Buffer.from(redacted, "utf8");
  if (bytes.length <= ADAPTER_STDERR_CAP_BYTES) {
    return bytes;
  }
  return bytes.subarray(bytes.length - ADAPTER_STDERR_CAP_BYTES);
}

export function redactAdapterStderrText(text: string): string {
  let output = text;
  for (const prefix of homePrefixes()) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    output = output.replace(new RegExp(`${escaped}(?:[^\\s]*)?`, "g"), REDACTED);
  }
  output = output.replace(/Authorization\s*:\s*(?:Bearer\s+)?\S+/gi, `Authorization: ${REDACTED}`);
  output = output.replace(/Bearer\s+\S+/gi, `Bearer ${REDACTED}`);
  output = output.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED);
  output = output.replace(/\bsk-[A-Za-z0-9][A-Za-z0-9_-]*/g, REDACTED);
  output = output.replace(/\b([A-Za-z][A-Za-z0-9_-]*)(\s*[=:]\s*)(\S+)/g, (match, key: string, sep: string) => {
    if (!isSensitiveRegistryKey(key)) {
      return match;
    }
    return `${key}${sep}${REDACTED}`;
  });
  return output;
}

function homePrefixes(): string[] {
  const prefixes = new Set<string>();
  for (const candidate of [os.homedir(), process.env.HOME]) {
    if (typeof candidate === "string" && candidate.length > 0 && path.isAbsolute(candidate)) {
      prefixes.add(candidate);
    }
  }
  return [...prefixes].sort((left, right) => right.length - left.length);
}
