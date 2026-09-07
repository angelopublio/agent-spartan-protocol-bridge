export const REVIEW_PROGRESS_CLASSES = ["working", "tool", "result", "quiet"] as const;
export type ReviewProgressClass = (typeof REVIEW_PROGRESS_CLASSES)[number];

export type ReviewStreamProgress = {
  class: ReviewProgressClass;
  records: number;
  tools: number;
};

const KIND_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function classForRecordType(type: string): ReviewProgressClass | null {
  switch (type) {
    case "tool_call":
    case "tool_use":
      return "tool";
    case "result":
    case "turn.completed":
      return "result";
    case "thinking":
    case "assistant":
    case "system":
    case "thread.started":
    case "turn.started":
    case "item.started":
    case "item.completed":
      return "working";
    default:
      return null;
  }
}

export function formatReviewStreamLine(info: ReviewStreamProgress): string {
  return `${info.class} records=${info.records} tools=${info.tools}\n`;
}

export class ReviewStreamParser {
  records = 0;
  tools = 0;
  observedBytes = 0;
  overflow = false;
  resultText: string | undefined;
  residual = "";

  private lineBuffer = "";
  private currentClass: ReviewProgressClass = "working";
  private readonly cap: number;
  private readonly onProgress: ((info: ReviewStreamProgress) => void) | undefined;

  constructor(cap: number, onProgress?: (info: ReviewStreamProgress) => void) {
    this.cap = cap;
    this.onProgress = onProgress;
  }

  snapshot(): ReviewStreamProgress {
    return {
      class: this.records === 0 ? "quiet" : this.currentClass,
      records: this.records,
      tools: this.tools,
    };
  }

  retainedBytes(): number {
    return (
      Buffer.byteLength(this.lineBuffer, "utf8") +
      Buffer.byteLength(this.residual, "utf8") +
      Buffer.byteLength(this.resultText ?? "", "utf8")
    );
  }

  feed(chunk: Buffer): void {
    if (this.overflow) {
      return;
    }
    this.observedBytes += chunk.length;
    this.lineBuffer += chunk.toString("utf8");
    if (this.retainedBytes() > this.cap) {
      this.overflow = true;
      return;
    }
    this.consumeLines(false);
  }

  end(): void {
    if (this.overflow) {
      return;
    }
    this.consumeLines(true);
  }

  private consumeLines(flush: boolean): void {
    const parts = this.lineBuffer.split("\n");
    if (!flush) {
      this.lineBuffer = parts.pop() ?? "";
    } else {
      this.lineBuffer = "";
    }
    for (const part of parts) {
      if (part.length === 0) {
        continue;
      }
      this.ingestLine(part);
      if (this.retainedBytes() > this.cap) {
        this.overflow = true;
        return;
      }
    }
  }

  private ingestLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.appendResidual(line);
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      this.appendResidual(line);
      return;
    }
    const record = parsed as Record<string, unknown>;
    const type = typeof record.type === "string" && KIND_RE.test(record.type) ? record.type : null;
    if (type === null) {
      this.appendResidual(line);
      return;
    }
    this.records += 1;
    const mapped = classForRecordType(type);
    if (mapped !== null) {
      this.currentClass = mapped;
    }
    if ((type === "tool_call" || type === "tool_use") && record.subtype !== "completed") {
      this.tools += 1;
    }
    if (type === "item.started") {
      const item = record.item;
      if (
        typeof item === "object" &&
        item !== null &&
        !Array.isArray(item) &&
        typeof (item as Record<string, unknown>).type === "string" &&
        (item as Record<string, unknown>).type === "command_execution"
      ) {
        this.tools += 1;
      }
    }
    if (type === "result") {
      if (typeof record.result === "string") {
        this.resultText = record.result;
      } else if (typeof record.result === "object" && record.result !== null && !Array.isArray(record.result)) {
        this.resultText = JSON.stringify(record.result);
      }
    }
    this.onProgress?.(this.snapshot());
  }

  private appendResidual(line: string): void {
    this.residual = this.residual.length === 0 ? line : `${this.residual}\n${line}`;
  }
}
