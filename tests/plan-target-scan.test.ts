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

const ROOT_ENTRIES = new Set([
  ".agents",
  ".git",
  ".github",
  ".gitignore",
  ".idea",
  ".spartan-bridge",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "agent-skill",
  "dist",
  "docs",
  "node_modules",
  "package-lock.json",
  "package.json",
  "spartan",
  "spartan-bridge",
  "src",
  "tests",
  "tsconfig.json",
]);

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
  assert.deepEqual(planTargetsUnwritablePath(markdown, WRITE_SCOPE, ROOT_ENTRIES), []);
});

test("bare AGENTS.md still classifies as an unwritable plan target", () => {
  const markdown = planMarkdown({
    decisions: "- Edit `AGENTS.md` D5 scopes.\n",
  });
  assert.deepEqual(planTargetsUnwritablePath(markdown, WRITE_SCOPE, ROOT_ENTRIES), ["AGENTS.md"]);
});

test("a prefixed out-of-scope path is still flagged", () => {
  const markdown = planMarkdown({
    decisions: "- Do not write `config/secret.env`.\n",
  });
  assert.deepEqual(planTargetsUnwritablePath(markdown, WRITE_SCOPE, new Set(["config"])), ["config/secret.env"]);
});

test("spartan-bridge/config.yaml still classifies as unwritable", () => {
  const markdown = planMarkdown({
    decisions: "- Edit `spartan-bridge/config.yaml`.\n",
  });
  assert.deepEqual(planTargetsUnwritablePath(markdown, WRITE_SCOPE, ROOT_ENTRIES), ["spartan-bridge/config.yaml"]);
});

test("bare README.md and package.json admitted by the write scope do not stop", () => {
  const markdown = planMarkdown({
    scope: "- `README.md` and `package.json`\n",
  });
  assert.deepEqual(planTargetsUnwritablePath(markdown, WRITE_SCOPE, ROOT_ENTRIES), []);
});

test("returns unique normalized tokens in first-seen order", () => {
  const markdown = planMarkdown({
    decisions: "- Edit `AGENTS.md`, `./AGENTS.md`, and `config/secret.env`.\n",
  });
  assert.deepEqual(planTargetsUnwritablePath(markdown, WRITE_SCOPE, new Set([...ROOT_ENTRIES, "config"])), [
    "AGENTS.md",
    "config/secret.env",
  ]);
});

test("a backtick token that is quoted code, not a path, is ignored", () => {
  const markdown = planMarkdown({
    scope:
      '- Row 8: `advisory.split("\\n").filter((line) => line === "- Role: reviewer").length !== 1` preserves the current predicate.\n',
    decisions: "- `type: {item_type}` and `create_item(..., item_type=None)` are prose examples.\n",
  });
  assert.deepEqual(planTargetsUnwritablePath(markdown, WRITE_SCOPE, ROOT_ENTRIES), []);
});

test("filters the illustrative slash-bearing tokens from task 0053 in first-seen order", () => {
  const tokens = [
    "agent-skill/skills",
    "agent-skill/skills/spbridge",
    "agents/",
    "node_modules/esbuild/bin/esbuild",
    "node_modules/@esbuild/darwin-arm64/bin/esbuild",
    "HOME/x",
    "HOME/alias",
    "R/src/x",
    "AGENTS.md",
    "spartan-bridge/config.yaml",
    "node_modules/",
    ".venv/",
    "dist/",
    "node_modules/.cache/",
    "node_modules/.cache/x",
    "node_modules/.bin",
    ".bin/tsserver",
    ".bin/esbuild",
    ".bin/yaml",
    ".bin/spartan-bridge",
    "agent-skill/skills/spbridge/NEW.md",
    "a/b",
  ];
  const markdown = planMarkdown({
    decisions: tokens.map((token) => `- Discuss \`${token}\`.`).join("\n"),
  });

  assert.deepEqual(planTargetsUnwritablePath(markdown, WRITE_SCOPE, ROOT_ENTRIES), [
    "agent-skill/skills",
    "agent-skill/skills/spbridge",
    "node_modules/esbuild/bin/esbuild",
    "node_modules/@esbuild/darwin-arm64/bin/esbuild",
    "AGENTS.md",
    "spartan-bridge/config.yaml",
    "node_modules/",
    "dist/",
    "node_modules/.cache/",
    "node_modules/.cache/x",
    "node_modules/.bin",
    "agent-skill/skills/spbridge/NEW.md",
  ]);
});

test("filters package specifiers and git refs whose leading segments are absent", () => {
  const markdown = planMarkdown({
    scope: "- Install `@scope/name`, compare `origin/main`, and merge `origin/feature-x`.\n",
  });
  assert.deepEqual(planTargetsUnwritablePath(markdown, WRITE_SCOPE, ROOT_ENTRIES), []);
});

test("accepts the named false negative for a new top-level directory", () => {
  const markdown = planMarkdown({ scope: "- Create `vendor/thing`.\n" });
  assert.deepEqual(planTargetsUnwritablePath(markdown, WRITE_SCOPE, ROOT_ENTRIES), []);
  assert.deepEqual(planTargetsUnwritablePath(markdown, WRITE_SCOPE, new Set([...ROOT_ENTRIES, "vendor"])), [
    "vendor/thing",
  ]);
});

test("authority paths bypass an empty root-entry set even in disclaiming prose", () => {
  const markdown = planMarkdown({
    decisions: "- Do not edit `AGENTS.md` or `spartan-bridge/config.yaml`.\n",
  });
  assert.deepEqual(planTargetsUnwritablePath(markdown, WRITE_SCOPE, new Set()), [
    "AGENTS.md",
    "spartan-bridge/config.yaml",
  ]);
});
