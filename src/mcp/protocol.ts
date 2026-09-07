import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const SERVER_NAME = "spartan-bridge";
export const MAX_LINE_BYTES = 1024 * 1024;
export const REVIEW_TOOL_NAME = "review";

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;

export const PARSE_ERROR_MESSAGE = "Parse error";
export const INVALID_REQUEST_MESSAGE = "Invalid Request";
export const METHOD_NOT_FOUND_MESSAGE = "Method not found";
export const INVALID_PARAMS_MESSAGE = "Invalid params";
export const UNEXPECTED_REVIEW_FAILURE = "review failed";

export const CLOSED_METHODS = [
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
  "tools/call",
] as const;

export type ClosedMethod = (typeof CLOSED_METHODS)[number];

export const REVIEW_TOOL = {
  name: REVIEW_TOOL_NAME,
  description:
    "Create one plan-review run for a repository-relative Spartan task path and return the terminal status.json text.",
  inputSchema: {
    type: "object",
    properties: {
      task: {
        type: "string",
      },
    },
    required: ["task"],
    additionalProperties: false,
  },
} as const;

type PackageJson = {
  version: string;
};

function readServerVersion(): string {
  const packageJsonPath = fileURLToPath(new URL("../../package.json", import.meta.url));
  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
  return parsed.version;
}

export const SERVER_VERSION = readServerVersion();
