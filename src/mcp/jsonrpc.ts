import {
  INVALID_REQUEST,
  INVALID_REQUEST_MESSAGE,
  PARSE_ERROR,
  PARSE_ERROR_MESSAGE,
} from "./protocol.ts";

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  method: string;
  params: unknown;
  id: JsonRpcId;
};

export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params: unknown;
};

export type ParsedMessage =
  | { kind: "request"; request: JsonRpcRequest }
  | { kind: "notification"; notification: JsonRpcNotification }
  | { kind: "error"; id: JsonRpcId; code: number; message: string };

function isFiniteIdNumber(value: number): boolean {
  return Number.isFinite(value);
}

function extractId(value: Record<string, unknown>): { hasId: boolean; id: JsonRpcId | undefined } {
  if (!Object.prototype.hasOwnProperty.call(value, "id")) {
    return { hasId: false, id: undefined };
  }
  const raw = value.id;
  if (raw === null || typeof raw === "string") {
    return { hasId: true, id: raw };
  }
  if (typeof raw === "number" && isFiniteIdNumber(raw)) {
    return { hasId: true, id: raw };
  }
  return { hasId: true, id: undefined };
}

export function parseJsonRpcMessage(text: string): ParsedMessage {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: "error", id: null, code: PARSE_ERROR, message: PARSE_ERROR_MESSAGE };
  }
  if (Array.isArray(value) || value === null || typeof value !== "object") {
    return { kind: "error", id: null, code: INVALID_REQUEST, message: INVALID_REQUEST_MESSAGE };
  }
  const obj = value as Record<string, unknown>;
  const extracted = extractId(obj);
  if (extracted.hasId && extracted.id === undefined) {
    return { kind: "error", id: null, code: INVALID_REQUEST, message: INVALID_REQUEST_MESSAGE };
  }
  const id = extracted.hasId ? extracted.id! : null;
  if (obj.jsonrpc !== "2.0") {
    return { kind: "error", id, code: INVALID_REQUEST, message: INVALID_REQUEST_MESSAGE };
  }
  if (typeof obj.method !== "string" || obj.method.length === 0) {
    return { kind: "error", id, code: INVALID_REQUEST, message: INVALID_REQUEST_MESSAGE };
  }
  let params: unknown;
  if (Object.prototype.hasOwnProperty.call(obj, "params")) {
    params = obj.params;
    if (params === null || typeof params !== "object") {
      return { kind: "error", id, code: INVALID_REQUEST, message: INVALID_REQUEST_MESSAGE };
    }
  }
  if (!extracted.hasId) {
    return {
      kind: "notification",
      notification: { jsonrpc: "2.0", method: obj.method, params },
    };
  }
  return {
    kind: "request",
    request: { jsonrpc: "2.0", method: obj.method, params, id: extracted.id! },
  };
}

export function encodeResult(id: JsonRpcId, result: unknown): string {
  return `${JSON.stringify({ jsonrpc: "2.0", result, id })}\n`;
}

export function encodeError(id: JsonRpcId, code: number, message: string): string {
  return `${JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id })}\n`;
}
