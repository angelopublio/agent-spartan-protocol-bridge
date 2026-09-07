import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("README routes users to machine-local no-prompt review setup", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

  assert.match(
    readme,
    /docs\/AUTHENTICATION-AND-SECURITY\.md#pre-authorize-bridge-review-commands-on-producer-hosts/,
  );
  assert.match(readme, /`pass` stops after the current review/);
  assert.match(readme, /does\s+not make three reviews mandatory/);
});

test("security guide configures Codex Cursor and Claude without repository self-grants", async () => {
  const guide = await readFile(
    new URL("../docs/AUTHENTICATION-AND-SECURITY.md", import.meta.url),
    "utf8",
  );

  for (const expected of [
    'prefix_rule(pattern=["spartan-bridge", "review"], decision="allow")',
    "Shell(spartan-bridge:review *)",
    "Bash(spartan-bridge review *)",
    "~/.codex/rules/default.rules",
    "~/.cursor/cli-config.json",
    "$CLAUDE_CONFIG_DIR/settings.json",
    "A repository may authorize a workflow in `AGENTS.md`; it may not",
    "`max_review_cycles: 3` means at most three reviewer runs",
    "`pass` stops the chain after the current review",
  ]) {
    assert.ok(guide.includes(expected), expected);
  }

  assert.doesNotMatch(guide, /dangerously-bypass|bypassPermissions/);
});

test("the routing guide's host argv table matches the adapter constants", async () => {
  const doc = await readFile(new URL("../docs/ROUTING-AND-WORKFLOWS.md", import.meta.url), "utf8");
  const { CLAUDE_EXECUTABLE } = await import("../src/adapters/claude.ts");
  const { CURSOR_EXECUTABLE, CURSOR_MODEL_FLAG } = await import("../src/adapters/cursor.ts");
  const { CODEX_EXECUTABLE } = await import("../src/adapters/codex.ts");
  const { GROK_EXECUTABLE, GROK_MODEL_FLAG, GROK_EFFORT_FLAG } = await import(
    "../src/adapters/grok.ts"
  );

  for (const executable of [CLAUDE_EXECUTABLE, CURSOR_EXECUTABLE, CODEX_EXECUTABLE, GROK_EXECUTABLE]) {
    assert.ok(doc.includes(`\`${executable}\``), `routing guide names ${executable}`);
  }
  // The flags the table documents must be the flags the adapters actually send.
  assert.ok(doc.includes(`\`${GROK_MODEL_FLAG} <id>\``), "grok model flag");
  assert.ok(doc.includes(`\`${GROK_EFFORT_FLAG} <level>\``), "grok effort flag");
  assert.ok(doc.includes(`\`${CURSOR_MODEL_FLAG} <id>\``), "cursor model flag");
  assert.match(doc, /`-c model="<id>"`/);
  assert.match(doc, /`max` sent as `xhigh`/);
  assert.match(doc, /Cursor encodes effort in the model name/);
  assert.match(doc, /Changing a binding table is a human gate/);
});
