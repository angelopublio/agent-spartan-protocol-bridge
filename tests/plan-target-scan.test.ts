import assert from "node:assert/strict";
import test from "node:test";
import { planTargetsUnwritablePath } from "../src/core/plan-target-scan.ts";

const WRITE_SCOPE = [
  "src/",
  "tests/",
  "docs/",
  "skills/",
  "agent-skill/skills/spbridge/SKILL.md",
  "spartan/",
  "README.md",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
];

function planMarkdown(body: { scope?: string; decisions?: string }): string {
  return `## Scope

${body.scope ?? "- in-scope work.\n"}
## Decisions

${body.decisions ?? "- none.\n"}`;
}

test("bare DESIGN_SYSTEM.md with docs/ in scope is not a scan target", () => {
  const markdown = planMarkdown({
    scope:
      "- `docs/UI_PATTERNS.md` (and `DESIGN_SYSTEM.md` only if it still names the craft trio)\n",
  });
  assert.deepEqual(planTargetsUnwritablePath(markdown, WRITE_SCOPE), []);
});

test("bare AGENTS.md still classifies as an unwritable plan target", () => {
  const markdown = planMarkdown({
    decisions: "- Edit `AGENTS.md` D5 scopes.\n",
  });
  assert.deepEqual(planTargetsUnwritablePath(markdown, WRITE_SCOPE), ["AGENTS.md"]);
});

test("a prefixed out-of-scope path is still flagged", () => {
  const markdown = planMarkdown({
    decisions: "- Do not write `config/secret.env`.\n",
  });
  assert.deepEqual(planTargetsUnwritablePath(markdown, WRITE_SCOPE), ["config/secret.env"]);
});

test("spartan-bridge/config.yaml still classifies as unwritable", () => {
  const markdown = planMarkdown({
    decisions: "- Edit `spartan-bridge/config.yaml`.\n",
  });
  assert.deepEqual(planTargetsUnwritablePath(markdown, WRITE_SCOPE), ["spartan-bridge/config.yaml"]);
});

test("bare README.md and package.json admitted by the write scope do not stop", () => {
  const markdown = planMarkdown({
    scope: "- `README.md` and `package.json`\n",
  });
  assert.deepEqual(planTargetsUnwritablePath(markdown, WRITE_SCOPE), []);
});

test("returns unique normalized tokens in first-seen order", () => {
  const markdown = planMarkdown({
    decisions: "- Edit `AGENTS.md`, `./AGENTS.md`, and `config/secret.env`.\n",
  });
  assert.deepEqual(planTargetsUnwritablePath(markdown, WRITE_SCOPE), ["AGENTS.md", "config/secret.env"]);
});

test("a backtick token that is quoted code, not a path, is ignored", () => {
  const markdown = planMarkdown({
    scope:
      '- Row 8: `advisory.split("\\n").filter((line) => line === "- Role: reviewer").length !== 1` preserves the current predicate.\n',
    decisions: "- `type: {item_type}` and `create_item(..., item_type=None)` are prose examples.\n",
  });
  assert.deepEqual(planTargetsUnwritablePath(markdown, WRITE_SCOPE), []);
});
