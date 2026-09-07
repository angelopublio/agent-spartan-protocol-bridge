import { runReview, type AppDeps } from "../core/review.ts";
import {
  encodeError,
  encodeResult,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type ParsedMessage,
} from "./jsonrpc.ts";
import { mapReviewOutcome } from "./outcome.ts";
import {
  INVALID_PARAMS,
  INVALID_PARAMS_MESSAGE,
  INVALID_REQUEST,
  INVALID_REQUEST_MESSAGE,
  MCP_PROTOCOL_VERSION,
  METHOD_NOT_FOUND,
  METHOD_NOT_FOUND_MESSAGE,
  REVIEW_TOOL,
  REVIEW_TOOL_NAME,
  SERVER_NAME,
  SERVER_VERSION,
  UNEXPECTED_REVIEW_FAILURE,
} from "./protocol.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function initializeProtocolVersion(params: unknown): { ok: true; version: string } | { ok: false } {
  if (params === undefined) {
    return { ok: false };
  }
  if (!isRecord(params)) {
    return { ok: false };
  }
  const version = params.protocolVersion;
  if (typeof version !== "string") {
    return { ok: false };
  }
  return { ok: true, version };
}

function reviewTask(argumentsValue: unknown): { ok: true; task: string } | { ok: false } {
  if (!isRecord(argumentsValue)) {
    return { ok: false };
  }
  const keys = Object.keys(argumentsValue);
  if (keys.length !== 1 || keys[0] !== "task") {
    return { ok: false };
  }
  const task = argumentsValue.task;
  if (typeof task !== "string" || task.length === 0) {
    return { ok: false };
  }
  return { ok: true, task };
}

export class McpSession {
  private initialized = false;

  constructor(
    private readonly repoRoot: string,
    private readonly deps: AppDeps,
  ) {}

  async dispatch(parsed: ParsedMessage): Promise<string | null> {
    if (parsed.kind === "error") {
      return encodeError(parsed.id, parsed.code, parsed.message);
    }
    if (parsed.kind === "notification") {
      this.handleNotification(parsed.notification);
      return null;
    }
    return this.handleRequest(parsed.request);
  }

  private handleNotification(notification: JsonRpcNotification): void {
    if (notification.method === "notifications/initialized") {
      return;
    }
  }

  private async handleRequest(request: JsonRpcRequest): Promise<string> {
    const { method, id, params } = request;
    if (method === "initialize") {
      return this.initialize(id, params);
    }
    if (method === "ping") {
      return encodeResult(id, {});
    }
    if (method === "tools/list") {
      if (!this.initialized) {
        return encodeError(id, INVALID_REQUEST, INVALID_REQUEST_MESSAGE);
      }
      return encodeResult(id, { tools: [REVIEW_TOOL] });
    }
    if (method === "tools/call") {
      if (!this.initialized) {
        return encodeError(id, INVALID_REQUEST, INVALID_REQUEST_MESSAGE);
      }
      return this.callTool(id, params);
    }
    return encodeError(id, METHOD_NOT_FOUND, METHOD_NOT_FOUND_MESSAGE);
  }

  private initialize(id: JsonRpcRequest["id"], params: unknown): string {
    if (this.initialized) {
      return encodeError(id, INVALID_REQUEST, INVALID_REQUEST_MESSAGE);
    }
    const parsed = initializeProtocolVersion(params);
    if (!parsed.ok) {
      return encodeError(id, INVALID_PARAMS, INVALID_PARAMS_MESSAGE);
    }
    this.initialized = true;
    const protocolVersion =
      parsed.version === MCP_PROTOCOL_VERSION ? parsed.version : MCP_PROTOCOL_VERSION;
    return encodeResult(id, {
      protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    });
  }

  private async callTool(id: JsonRpcRequest["id"], params: unknown): Promise<string> {
    if (!isRecord(params) || typeof params.name !== "string") {
      return encodeError(id, INVALID_PARAMS, INVALID_PARAMS_MESSAGE);
    }
    if (params.name !== REVIEW_TOOL_NAME) {
      return encodeError(id, METHOD_NOT_FOUND, METHOD_NOT_FOUND_MESSAGE);
    }
    if (!Object.prototype.hasOwnProperty.call(params, "arguments")) {
      return encodeError(id, INVALID_PARAMS, INVALID_PARAMS_MESSAGE);
    }
    const task = reviewTask(params.arguments);
    if (!task.ok) {
      return encodeError(id, INVALID_PARAMS, INVALID_PARAMS_MESSAGE);
    }
    let outcome;
    try {
      outcome = await runReview({ repo: this.repoRoot, task: task.task }, this.deps);
    } catch {
      return encodeResult(id, {
        content: [{ type: "text", text: UNEXPECTED_REVIEW_FAILURE }],
        isError: true,
      });
    }
    const mapped = mapReviewOutcome(outcome);
    return encodeResult(id, {
      content: [{ type: "text", text: mapped.text }],
      isError: mapped.isError,
    });
  }
}
