export const PRODUCER_REFUSED_PATH_CAP = 20;
export const PRODUCER_REFUSED_PATH_BYTES = 256;

export function boundProducerRefusedPaths(paths: readonly string[]): string[] {
  return paths.slice(0, PRODUCER_REFUSED_PATH_CAP).map((token) => {
    const bytes = Buffer.from(token, "utf8");
    if (bytes.byteLength <= PRODUCER_REFUSED_PATH_BYTES) {
      return token;
    }
    // Bridge-produced lists pass through this bound once at capture and again
    // at serialization. The accepted marker ambiguity makes this convention
    // the only information available to keep that second pass byte-stable.
    if (token.startsWith(".../") && bytes.byteLength <= PRODUCER_REFUSED_PATH_BYTES + 4) {
      return token;
    }
    let start = bytes.byteLength - PRODUCER_REFUSED_PATH_BYTES;
    while (start < bytes.byteLength && (bytes[start]! & 0xc0) === 0x80) {
      start += 1;
    }
    return `.../${bytes.subarray(start).toString("utf8")}`;
  });
}
