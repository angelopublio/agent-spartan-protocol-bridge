#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const HELP_TOKENS =
  "--sandbox --cd --config --skip-git-repo-check --ephemeral --output-schema --output-last-message --json --color\n";

if (process.argv.includes("--help")) {
  process.stdout.write(HELP_TOKENS);
  process.exit(0);
}

function flagValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return null;
  }
  return process.argv[index + 1];
}

const lastMessagePath = flagValue("--output-last-message");
const capture = {
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM", "CODEX_API_KEY", "OPENAI_API_KEY"].map((key) => [
      key,
      process.env[key] ?? null,
    ]),
  ),
  envKeys: Object.keys(process.env).sort(),
  lastMessagePath,
};
const id = createHash("sha256").update(process.cwd()).digest("hex").slice(0, 16);
fs.writeFileSync(path.join(os.tmpdir(), `spartan-bridge-codex-stub-${id}.json`), JSON.stringify(capture));

const override = process.env.TMPDIR
  ? path.join(process.env.TMPDIR, "spartan-bridge-codex-stub-last-message")
  : null;
let payload;
if (override && fs.existsSync(override)) {
  payload = fs.readFileSync(override);
} else {
  payload = Buffer.from(
    `${JSON.stringify({
      schema_version: 2,
      review_kind: "plan",
      verdict: "pass",
      summary: "Stub reviewer accepted the plan.",
      findings: [],
    })}\n`,
  );
}
if (lastMessagePath) {
  fs.writeFileSync(lastMessagePath, payload);
}
