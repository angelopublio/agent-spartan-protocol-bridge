import fs from "node:fs/promises";
import path from "node:path";
import type { EventDocument, ReviewResult, StatusDocument, WorkspaceManifest } from "../core/contracts.ts";
import { parseEventJson, parseStatusJson, serializeEvent, serializeStatus } from "../core/serialize.ts";
import { isInside } from "./paths.ts";

export const ADAPTER_STDERR_LOG = "adapter-stderr.log";
export const ADAPTER_PAYLOAD_LOG = "adapter-payload.log";
export const WORKSPACE_MANIFEST_FILE = "workspace-manifest.json";
export const REVIEW_VERDICT_LOG = "review-verdict.json";

// D4 (task 0046): retain an accepted-but-unwritten reviewer verdict in the run
// directory when a post-write rejection still occurs despite the pre-dispatch
// shape gate, so the operator recovers the judgement without paying for the
// review again. Same shape as `adapter-payload.log` for `output_unparsable`:
// mode 0600, atomic, gitignored with the run directory. Returns the file name
// for the pointer on the failure record.
export async function writeReviewVerdictAtomic(runDir: string, result: ReviewResult): Promise<{ review_verdict_log: string }> {
  const payload = `${JSON.stringify({
    schema_version: result.schema_version,
    review_kind: result.review_kind,
    verdict: result.verdict,
    summary: result.summary,
    findings: result.findings.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      message: finding.message,
    })),
  })}\n`;
  const target = path.join(runDir, REVIEW_VERDICT_LOG);
  const temp = path.join(runDir, `.${REVIEW_VERDICT_LOG}.${process.pid}.tmp`);
  await fs.writeFile(temp, payload, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temp, target);
  return { review_verdict_log: REVIEW_VERDICT_LOG };
}

export async function writeStatusAtomic(runDir: string, status: StatusDocument): Promise<void> {
  const target = path.join(runDir, "status.json");
  const temp = path.join(runDir, `.status.json.${process.pid}.tmp`);
  await fs.writeFile(temp, serializeStatus(status), { encoding: "utf8", mode: 0o600 });
  await fs.rename(temp, target);
}

export async function appendEvent(runDir: string, event: EventDocument): Promise<void> {
  const file = path.join(runDir, "events.jsonl");
  await fs.appendFile(file, serializeEvent(event), { encoding: "utf8", mode: 0o600 });
}

export async function readStatusBytes(runDir: string): Promise<Buffer> {
  return fs.readFile(path.join(runDir, "status.json"));
}

export async function readStatus(runDir: string): Promise<StatusDocument> {
  const text = await fs.readFile(path.join(runDir, "status.json"), "utf8");
  return parseStatusJson(text);
}

export async function writeAdapterStderrAtomic(
  runDir: string,
  bytes: Uint8Array,
): Promise<{ stderr_log: string | null; stderr_bytes: number }> {
  if (bytes.length === 0) {
    return { stderr_log: null, stderr_bytes: 0 };
  }
  const target = path.join(runDir, ADAPTER_STDERR_LOG);
  const temp = path.join(runDir, `.adapter-stderr.log.${process.pid}.tmp`);
  await fs.writeFile(temp, bytes, { mode: 0o600 });
  await fs.rename(temp, target);
  return { stderr_log: ADAPTER_STDERR_LOG, stderr_bytes: bytes.length };
}

export async function writeAdapterPayloadAtomic(
  runDir: string,
  bytes: Uint8Array,
): Promise<{ payload_log: string | null }> {
  if (bytes.length === 0) {
    return { payload_log: null };
  }
  const target = path.join(runDir, ADAPTER_PAYLOAD_LOG);
  const temp = path.join(runDir, `.adapter-payload.log.${process.pid}.tmp`);
  await fs.writeFile(temp, bytes, { mode: 0o600 });
  await fs.rename(temp, target);
  return { payload_log: ADAPTER_PAYLOAD_LOG };
}

export async function writeReviewAtomic(runDir: string, executionId: string, result: ReviewResult): Promise<void> {
  if (!/^[A-Za-z0-9._-]+$/.test(executionId) || executionId.includes("..")) {
    throw new Error("execution_id_invalid");
  }
  const reviewsDir = path.join(runDir, "reviews");
  await fs.mkdir(reviewsDir, { recursive: true, mode: 0o700 });
  const target = path.join(reviewsDir, `${executionId}.json`);
  const temp = path.join(reviewsDir, `.${executionId}.json.${process.pid}.tmp`);
  const payload = `${JSON.stringify({
    schema_version: result.schema_version,
    review_kind: result.review_kind,
    verdict: result.verdict,
    summary: result.summary,
    findings: result.findings.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      message: finding.message,
    })),
  })}\n`;
  await fs.writeFile(temp, payload, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temp, target);
}

export async function readEvents(runDir: string): Promise<string> {
  return fs.readFile(path.join(runDir, "events.jsonl"), "utf8");
}

export async function readEventsParsed(runDir: string): Promise<EventDocument[]> {
  const text = await readEvents(runDir);
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map(parseEventJson);
}

export async function writeWorkspaceManifestAtomic(
  runDir: string,
  manifest: WorkspaceManifest,
): Promise<void> {
  const target = path.join(runDir, WORKSPACE_MANIFEST_FILE);
  const temp = path.join(runDir, `.workspace-manifest.json.${process.pid}.tmp`);
  const entries = manifest.entries.map((entry) => {
    if (entry.gitMode === undefined) {
      return {
        path: entry.path,
        kind: entry.kind,
        size: entry.size,
        sha256: entry.sha256,
      };
    }
    return {
      path: entry.path,
      kind: entry.kind,
      size: entry.size,
      sha256: entry.sha256,
      gitMode: entry.gitMode,
    };
  });
  const payload = `${JSON.stringify({
    baseCommit: manifest.baseCommit,
    patchByteLength: manifest.patchByteLength,
    entries,
  })}\n`;
  await fs.writeFile(temp, payload, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temp, target);
}

export const RUNTIME_RUN_ID_RE =
  /^run-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isRuntimeRunId(value: string): boolean {
  return RUNTIME_RUN_ID_RE.test(value);
}

export function runDirFor(repoRoot: string, runId: string): string {
  return path.join(repoRoot, ".spartan-bridge", "runs", runId);
}

export function isRuntimeRunDirContained(repoRoot: string, candidate: string): boolean {
  return isInside(path.join(repoRoot, ".spartan-bridge", "runs"), candidate);
}
