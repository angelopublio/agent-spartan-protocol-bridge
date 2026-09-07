export type ParsedCli =
  | { kind: "help" }
  | { kind: "usage"; message: string }
  | { kind: "review"; repo: string; task: string; after_run?: string; detach?: boolean; run_id?: string }
  | { kind: "wait"; repo: string; run: string; timeout_ms?: number }
  | { kind: "resume"; repo: string }
  | { kind: "status"; repo: string; run?: string; task?: string }
  | { kind: "events"; repo: string; run: string }
  | { kind: "transition-status"; repo: string; transition: string }
  | { kind: "transition-events"; repo: string; transition: string }
  | { kind: "doctor"; repo: string }
  | { kind: "policy"; repo: string; role: "planner" | "implementer" }
  | { kind: "mcp-stdio"; repo?: string };

const COMMANDS = new Set([
  "review",
  "wait",
  "resume",
  "status",
  "events",
  "transition-status",
  "transition-events",
  "doctor",
  "policy",
  "mcp-stdio",
]);
const FORBIDDEN_REVIEW = new Set(["run", "kind", "review-kind"]);
const FORBIDDEN_MCP = new Set(["task", "run", "kind"]);

export function parseArgv(argv: string[]): ParsedCli {
  if (argv.length === 0) {
    return usage("missing command");
  }
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    return { kind: "help" };
  }
  const command = argv[0];
  if (!command || command.startsWith("-")) {
    return usage("missing command");
  }
  if (!COMMANDS.has(command)) {
    return usage(`unknown command '${command}'`);
  }
  let options: Map<string, string>;
  try {
    options = parseOptions(argv.slice(1));
  } catch (error) {
    return usage(error instanceof Error ? error.message : "invalid arguments");
  }
  if (command !== "review" && options.has("after-run")) {
    return usage(`option --after-run is not accepted by ${command}`);
  }
  if (command === "review") {
    for (const forbidden of FORBIDDEN_REVIEW) {
      if (options.has(forbidden)) {
        return usage(`option --${forbidden} is not accepted by review`);
      }
    }
    const repo = options.get("repo");
    const task = options.get("task");
    const afterRun = options.get("after-run");
    const detach = options.has("detach");
    const runId = options.get("run-id");
    if (!repo) {
      return usage("review requires --repo");
    }
    if (!task) {
      return usage("review requires --task");
    }
    // Allowed: --repo, --task, and any of --after-run, --detach (flag), --run-id.
    let allowed = 2;
    if (afterRun !== undefined) {
      allowed += 1;
    }
    if (detach) {
      allowed += 1;
    }
    if (runId !== undefined) {
      allowed += 1;
    }
    if (options.size !== allowed) {
      return usage("review accepts only --repo, --task, --after-run, --detach, --run-id");
    }
    const result: Extract<ParsedCli, { kind: "review" }> = { kind: "review", repo, task };
    if (afterRun !== undefined) {
      result.after_run = afterRun;
    }
    if (detach) {
      result.detach = true;
    }
    if (runId !== undefined) {
      result.run_id = runId;
    }
    return result;
  }
  if (command === "wait") {
    const repo = options.get("repo");
    const run = options.get("run");
    const timeoutRaw = options.get("timeout-ms");
    if (!repo) {
      return usage("wait requires --repo");
    }
    if (!run) {
      return usage("wait requires --run");
    }
    let allowed = 2;
    let timeoutMs: number | undefined;
    if (timeoutRaw !== undefined) {
      allowed += 1;
      const n = Number(timeoutRaw);
      if (!Number.isInteger(n) || n <= 0) {
        return usage("wait --timeout-ms must be a positive integer");
      }
      timeoutMs = n;
    }
    if (options.size !== allowed) {
      return usage("wait accepts only --repo, --run, and optional --timeout-ms");
    }
    return timeoutMs === undefined
      ? { kind: "wait", repo, run }
      : { kind: "wait", repo, run, timeout_ms: timeoutMs };
  }
  if (command === "resume") {
    const repo = options.get("repo");
    if (!repo) {
      return usage("resume requires --repo");
    }
    if (options.size !== 1) {
      return usage("resume accepts only --repo");
    }
    return { kind: "resume", repo };
  }
  if (command === "mcp-stdio") {
    for (const forbidden of FORBIDDEN_MCP) {
      if (options.has(forbidden)) {
        return usage(`option --${forbidden} is not accepted by mcp-stdio`);
      }
    }
    const repo = options.get("repo");
    if (repo !== undefined) {
      if (options.size !== 1) {
        return usage("mcp-stdio accepts only optional --repo");
      }
      return { kind: "mcp-stdio", repo };
    }
    if (options.size !== 0) {
      return usage("mcp-stdio accepts only optional --repo");
    }
    return { kind: "mcp-stdio" };
  }
  if (command === "status") {
    const repo = options.get("repo");
    const run = options.get("run");
    const task = options.get("task");
    if (!repo) {
      return usage("status requires --repo");
    }
    if ((run === undefined && task === undefined) || (run !== undefined && task !== undefined)) {
      return usage("status requires exactly one of --run or --task");
    }
    if (options.size !== 2) {
      return usage("status accepts only --repo and exactly one of --run or --task");
    }
    const result: Extract<ParsedCli, { kind: "status" }> = { kind: "status", repo };
    if (run !== undefined) {
      result.run = run;
    }
    if (task !== undefined) {
      result.task = task;
    }
    return result;
  }
  if (command === "events") {
    const repo = options.get("repo");
    const run = options.get("run");
    if (!repo) {
      return usage(`${command} requires --repo`);
    }
    if (!run) {
      return usage(`${command} requires --run`);
    }
    if (options.size !== 2) {
      return usage(`${command} accepts only --repo and --run`);
    }
    return { kind: command, repo, run };
  }
  if (command === "transition-status" || command === "transition-events") {
    const repo = options.get("repo");
    const transition = options.get("transition");
    if (!repo) {
      return usage(`${command} requires --repo`);
    }
    if (!transition) {
      return usage(`${command} requires --transition`);
    }
    if (options.size !== 2) {
      return usage(`${command} accepts only --repo and --transition`);
    }
    return { kind: command, repo, transition };
  }
  if (command === "policy") {
    const repo = options.get("repo");
    const role = options.get("role");
    if (!repo) {
      return usage("policy requires --repo");
    }
    if (!role) {
      return usage("policy requires --role");
    }
    if (role !== "planner" && role !== "implementer") {
      return usage("policy --role must be planner or implementer");
    }
    if (options.size !== 2) {
      return usage("policy accepts only --repo and --role");
    }
    return { kind: "policy", repo, role };
  }
  const repo = options.get("repo");
  if (!repo) {
    return usage("doctor requires --repo");
  }
  if (options.size !== 1) {
    return usage("doctor accepts only --repo");
  }
  return { kind: "doctor", repo };
}

const BOOLEAN_FLAGS = new Set(["detach"]);

function parseOptions(tokens: string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? "";
    if (token === "--help" || token === "-h") {
      throw new Error("unknown option '--help'");
    }
    if (!token.startsWith("--")) {
      throw new Error(`unexpected argument '${token}'`);
    }
    let name: string;
    let value: string | undefined;
    const eq = token.indexOf("=");
    if (eq >= 0) {
      name = token.slice(2, eq);
      value = token.slice(eq + 1);
    } else {
      name = token.slice(2);
      if (BOOLEAN_FLAGS.has(name)) {
        value = "";
      } else {
        const next = tokens[i + 1];
        if (next == null || next.startsWith("--")) {
          throw new Error(`option --${name} requires a value`);
        }
        value = next;
        i += 1;
      }
    }
    if (name.length === 0) {
      throw new Error("unknown option");
    }
    if (options.has(name)) {
      throw new Error(`duplicate option --${name}`);
    }
    options.set(name, value);
  }
  return options;
}

function usage(message: string): ParsedCli {
  return { kind: "usage", message };
}

export const HELP_TEXT = `spartan-bridge — Agent Spartan Protocol Bridge CLI

Usage:
  spartan-bridge --help
  spartan-bridge review --repo <path> --task <repo-relative-contained-path> [--after-run <run-id>] [--detach]
  spartan-bridge wait --repo <path> --run <run-id> [--timeout-ms <n>]
  spartan-bridge resume --repo <path>
  spartan-bridge status --repo <path> (--run <run-id> | --task <repo-relative-contained-path>)
  spartan-bridge events --repo <path> --run <run-id>
  spartan-bridge transition-status --repo <path> --transition <transition-id>
  spartan-bridge transition-events --repo <path> --transition <transition-id>
  spartan-bridge doctor --repo <path>
  spartan-bridge policy --repo <path> --role <planner|implementer>
  spartan-bridge mcp-stdio [--repo <path>]

Commands:
  review              Create one plan-review run and, when authorized, continue the foreground successor chain
  wait                Block up to --timeout-ms for a detached review chain to reach a terminal state, then print its document
  resume              Recover an interrupted detached chain: release a stale writer lock, finish a checkpointed transition, or stop
  status              Print persisted status.json for an existing run, or a task chain recovery report
  events              Print persisted events.jsonl for an existing run
  transition-status   Print persisted status.json for an existing producer transition
  transition-events   Print persisted events.jsonl for an existing producer transition
  doctor              Report registry readability, launcher resolution, fake-interface availability, and binding-relative adapters
  policy              Print the producer model-binding mode and the named role's Model / Effort as one JSON object
  mcp-stdio           Serve the MCP stdio adapter with one review tool
`;
