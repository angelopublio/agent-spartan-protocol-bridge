import type { Readable } from "node:stream";
import { MAX_LINE_BYTES } from "./protocol.ts";

export type FramedLine = { kind: "line"; text: string } | { kind: "oversize" };

function asBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  if (typeof chunk === "string") {
    return Buffer.from(chunk, "utf8");
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }
  return Buffer.from(String(chunk), "utf8");
}

export async function* frameStdin(stdin: Readable): AsyncGenerator<FramedLine> {
  let buffer: Buffer = Buffer.alloc(0);
  let skipping = false;

  const takeLines = function* (): Generator<FramedLine> {
    while (true) {
      const nl = buffer.indexOf(0x0a);
      if (nl === -1) {
        if (!skipping && buffer.length > MAX_LINE_BYTES) {
          skipping = true;
          buffer = Buffer.alloc(0);
          yield { kind: "oversize" };
        }
        return;
      }
      const raw = buffer.subarray(0, nl);
      buffer = buffer.subarray(nl + 1);
      if (skipping) {
        skipping = false;
        continue;
      }
      if (raw.length > MAX_LINE_BYTES) {
        yield { kind: "oversize" };
        continue;
      }
      let text = raw.toString("utf8");
      if (text.endsWith("\r")) {
        text = text.slice(0, -1);
      }
      if (text.trim().length === 0) {
        continue;
      }
      yield { kind: "line", text };
    }
  };

  for await (const chunk of stdin) {
    const piece = asBuffer(chunk);
    if (skipping) {
      const nl = piece.indexOf(0x0a);
      if (nl === -1) {
        continue;
      }
      skipping = false;
      buffer = piece.subarray(nl + 1);
    } else {
      buffer = buffer.length === 0 ? piece : Buffer.concat([buffer, piece]);
    }
    yield* takeLines();
  }
}
