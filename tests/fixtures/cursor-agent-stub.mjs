#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

if (process.argv.includes("--help")) {
  process.stdout.write("--print --output-format --mode --sandbox --workspace --trust\n");
  process.exit(0);
}

const capture = {
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM", "CURSOR_API_KEY", "CURSOR_CONFIG_DIR", "AGENT_CLI_CREDENTIAL_STORE"].map(
      (key) => [key, process.env[key] ?? null],
    ),
  ),
  envKeys: Object.keys(process.env).sort(),
};
const id = createHash("sha256").update(process.cwd()).digest("hex").slice(0, 16);
fs.writeFileSync(path.join(os.tmpdir(), `spartan-bridge-stub-${id}.json`), JSON.stringify(capture));

const result = {
  schema_version: 2,
  review_kind: "plan",
  verdict: "pass",
  summary: "Stub reviewer accepted the plan.",
  findings: [],
};
process.stdout.write(`${JSON.stringify({ result: JSON.stringify(result) })}\n`);
