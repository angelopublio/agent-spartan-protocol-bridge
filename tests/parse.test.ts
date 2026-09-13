import assert from "node:assert/strict";
import test from "node:test";
import { HELP_TEXT, parseArgv } from "../src/cli/parse.ts";

test("help is accepted as the only token", () => {
  assert.equal(parseArgv(["--help"]).kind, "help");
  assert.equal(parseArgv(["-h"]).kind, "help");
});

test("version is accepted as the only token", () => {
  assert.deepEqual(parseArgv(["--version"]), { kind: "version" });
  assert.deepEqual(parseArgv(["-v"]), { kind: "version" });
  assert.equal(parseArgv(["--version", "extra"]).kind, "usage");
  assert.match(HELP_TEXT, /spartan-bridge --version/);
});

test("unknown command and unknown options are usage errors", () => {
  assert.equal(parseArgv([]).kind, "usage");
  assert.equal(parseArgv(["start"]).kind, "usage");
  assert.equal(parseArgv(["review", "--repo", "x", "--task", "y", "--kind", "plan"]).kind, "usage");
  assert.equal(parseArgv(["review", "--repo", "x", "--task", "y", "--review-kind", "implementation"]).kind, "usage");
  assert.equal(parseArgv(["review", "--repo", "x", "--task", "y", "--run", "r"]).kind, "usage");
  assert.equal(parseArgv(["review", "--repo", "x", "--unknown", "z"]).kind, "usage");
  assert.equal(parseArgv(["review", "--repo", "x", "--task", "y", "--allow-stale", "1"]).kind, "usage");
  assert.equal(parseArgv(["review", "--repo", "x", "--task", "y", "--force", "1"]).kind, "usage");
  assert.equal(parseArgv(["review", "--repo", "x", "--repo", "y", "--task", "z"]).kind, "usage");
  assert.equal(parseArgv(["review", "--repo"]).kind, "usage");
});

test("review requires repo and task and accepts optional after-run", () => {
  const parsed = parseArgv(["review", "--repo", "/tmp/r", "--task", "spartan/tasks/a.md"]);
  assert.deepEqual(parsed, {
    kind: "review",
    repo: "/tmp/r",
    task: "spartan/tasks/a.md",
  });
  const chained = parseArgv([
    "review",
    "--repo",
    "/tmp/r",
    "--task",
    "spartan/tasks/a.md",
    "--after-run",
    "run-11111111-1111-4111-8111-111111111111",
  ]);
  assert.deepEqual(chained, {
    kind: "review",
    repo: "/tmp/r",
    task: "spartan/tasks/a.md",
    after_run: "run-11111111-1111-4111-8111-111111111111",
  });
  assert.equal(parseArgv(["review", "--repo", "x", "--task", "y", "--run", "r"]).kind, "usage");
  assert.equal(parseArgv(["status", "--repo", "/tmp/r", "--run", "run-1", "--after-run", "run-2"]).kind, "usage");
  assert.equal(parseArgv(["events", "--repo", "/tmp/r", "--run", "run-1", "--after-run", "run-2"]).kind, "usage");
  assert.equal(parseArgv(["doctor", "--repo", "/tmp/r", "--after-run", "run-1"]).kind, "usage");
  assert.equal(parseArgv(["mcp-stdio", "--after-run", "run-1"]).kind, "usage");
});

test("status, events, and transition reads require their identifiers", () => {
  assert.deepEqual(parseArgv(["status", "--repo", "/tmp/r", "--run", "run-1"]), {
    kind: "status",
    repo: "/tmp/r",
    run: "run-1",
  });
  assert.equal(parseArgv(["status", "--repo", "/tmp/r"]).kind, "usage");
  assert.equal(parseArgv(["events", "--repo", "/tmp/r", "--run", "run-1", "--task", "x"]).kind, "usage");
  assert.deepEqual(parseArgv(["transition-status", "--repo", "/tmp/r", "--transition", "transition-1"]), {
    kind: "transition-status",
    repo: "/tmp/r",
    transition: "transition-1",
  });
  assert.deepEqual(parseArgv(["transition-events", "--repo", "/tmp/r", "--transition", "transition-1"]), {
    kind: "transition-events",
    repo: "/tmp/r",
    transition: "transition-1",
  });
  assert.equal(parseArgv(["transition-status", "--repo", "/tmp/r"]).kind, "usage");
  assert.equal(parseArgv(["transition-events", "--repo", "/tmp/r", "--run", "run-1"]).kind, "usage");
});

test("doctor requires repo and accepts no run id", () => {
  assert.deepEqual(parseArgv(["doctor", "--repo", "/tmp/r"]), { kind: "doctor", repo: "/tmp/r" });
  assert.equal(parseArgv(["doctor", "--repo", "/tmp/r", "--run", "run-1"]).kind, "usage");
  assert.equal(parseArgv(["doctor", "--repo", "/tmp/r", "--role", "planner"]).kind, "usage");
});

test("policy requires repo and planner or implementer role", () => {
  assert.deepEqual(parseArgv(["policy", "--repo", "/tmp/r", "--role", "planner"]), {
    kind: "policy",
    repo: "/tmp/r",
    role: "planner",
  });
  assert.deepEqual(parseArgv(["policy", "--repo", "/tmp/r", "--role", "implementer"]), {
    kind: "policy",
    repo: "/tmp/r",
    role: "implementer",
  });
  assert.equal(parseArgv(["policy", "--repo", "/tmp/r"]).kind, "usage");
  assert.equal(parseArgv(["policy", "--role", "planner"]).kind, "usage");
  assert.equal(parseArgv(["policy", "--repo", "/tmp/r", "--role", "reviewer"]).kind, "usage");
  assert.equal(parseArgv(["policy", "--repo", "/tmp/r", "--role", "planner", "--run", "run-1"]).kind, "usage");
  assert.equal(parseArgv(["policy", "--repo", "/tmp/r", "--after-run", "run-1"]).kind, "usage");
});

test("help text names the policy command", () => {
  assert.match(HELP_TEXT, /spartan-bridge policy --repo <path> --role <planner\|implementer>/);
  assert.match(HELP_TEXT, /^ {2}policy {14}Print the producer model-binding mode/m);
});

test("mcp-stdio accepts only optional --repo", () => {
  assert.deepEqual(parseArgv(["mcp-stdio"]), { kind: "mcp-stdio" });
  assert.deepEqual(parseArgv(["mcp-stdio", "--repo", "/tmp/r"]), { kind: "mcp-stdio", repo: "/tmp/r" });
  assert.equal(parseArgv(["mcp-stdio", "--task", "x"]).kind, "usage");
  assert.equal(parseArgv(["mcp-stdio", "--run", "r"]).kind, "usage");
  assert.equal(parseArgv(["mcp-stdio", "--kind", "plan"]).kind, "usage");
  assert.equal(parseArgv(["mcp-stdio", "--unknown", "z"]).kind, "usage");
  assert.equal(parseArgv(["mcp-stdio", "--repo", "/tmp/r", "--repo", "/tmp/s"]).kind, "usage");
  assert.equal(parseArgv(["mcp-stdio", "--repo"]).kind, "usage");
});
