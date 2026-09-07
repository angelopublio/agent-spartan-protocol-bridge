import type { Readable, Writable } from "node:stream";
import { once } from "node:events";
import type { AppDeps } from "../core/review.ts";
import { encodeError, parseJsonRpcMessage } from "./jsonrpc.ts";
import {
  PARSE_ERROR,
  PARSE_ERROR_MESSAGE,
} from "./protocol.ts";
import { McpSession } from "./session.ts";
import { frameStdin } from "./transport.ts";

export type ServeMcpStdioOptions = {
  repoRoot: string;
  deps: AppDeps;
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
};

async function writeLine(stdout: Writable, line: string): Promise<void> {
  if (!stdout.write(line)) {
    await once(stdout, "drain");
  }
}

export async function serveMcpStdio(options: ServeMcpStdioOptions): Promise<number> {
  const session = new McpSession(options.repoRoot, options.deps);
  let shuttingDown = false;

  const onSignal = (): void => {
    shuttingDown = true;
    if (typeof options.stdin.destroy === "function") {
      options.stdin.destroy();
    }
  };

  const installSignals = options.stdin === process.stdin;
  if (installSignals) {
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  }

  try {
    for await (const framed of frameStdin(options.stdin)) {
      if (shuttingDown) {
        break;
      }
      let response: string | null;
      if (framed.kind === "oversize") {
        response = encodeError(null, PARSE_ERROR, PARSE_ERROR_MESSAGE);
      } else {
        response = await session.dispatch(parseJsonRpcMessage(framed.text));
      }
      if (response !== null) {
        await writeLine(options.stdout, response);
      }
    }
    return 0;
  } catch {
    if (shuttingDown) {
      return 0;
    }
    options.stderr.write("error: mcp adapter failed\n");
    return 1;
  } finally {
    if (installSignals) {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    }
  }
}
