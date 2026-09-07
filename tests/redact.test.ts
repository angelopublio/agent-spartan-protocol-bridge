import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ADAPTER_STDERR_CAP_BYTES, redactAdapterStderr, redactAdapterStderrText } from "../src/policy/redact.ts";

test("redaction removes named credential shapes and keeps the surrounding message", () => {
  const home = os.homedir();
  const homeFile = path.join(home, ".cursor", "config.json");
  const fixture = [
    "provider outage: rate limit exceeded.",
    "Bearer tok_secret_value",
    "Authorization: hdr_secret_value",
    "Authorization: Bearer tok_live_SECRETVALUE",
    "Authorization:Bearer compact_secret_value",
    "authorization: bearer lower_secret_value",
    "sk-live123secretvalue",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturepart",
    "api_key=supersecretvalue",
    "token: also-secret-value",
    homeFile,
  ].join(" ");
  const redacted = redactAdapterStderrText(fixture);
  assert.equal(redacted.includes("provider outage: rate limit exceeded."), true);
  assert.equal(redacted.includes("tok_secret_value"), false);
  assert.equal(redacted.includes("hdr_secret_value"), false);
  assert.equal(redacted.includes("tok_live_SECRETVALUE"), false);
  assert.equal(redacted.includes("compact_secret_value"), false);
  assert.equal(redacted.includes("lower_secret_value"), false);
  assert.equal(redacted.includes("sk-live123secretvalue"), false);
  assert.equal(redacted.includes("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturepart"), false);
  assert.equal(redacted.includes("supersecretvalue"), false);
  assert.equal(redacted.includes("also-secret-value"), false);
  assert.equal(redacted.includes(home), false);
  assert.equal(redacted.includes("Bearer [redacted]"), true);
  assert.equal(redacted.includes("Authorization: [redacted]"), true);
  assert.equal(redacted.includes("api_key=[redacted]"), true);
  assert.equal(redacted.includes("token: [redacted]"), true);
});

test("redaction keeps a tail of at most 16 KiB", () => {
  const body = `BANNER${"x".repeat(20 * 1024)}OUTAGE_MESSAGE`;
  const bytes = redactAdapterStderr(Buffer.from(body, "utf8"));
  assert.equal(bytes.length <= ADAPTER_STDERR_CAP_BYTES, true);
  assert.equal(bytes.length, ADAPTER_STDERR_CAP_BYTES);
  const text = bytes.toString("utf8");
  assert.equal(text.includes("OUTAGE_MESSAGE"), true);
  assert.equal(text.includes("BANNER"), false);
});

test("empty stderr redacts to empty bytes", () => {
  assert.equal(redactAdapterStderr(Buffer.alloc(0)).length, 0);
});
