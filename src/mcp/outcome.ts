import type { ReviewOutcome } from "../core/review.ts";
import { serializeStatus } from "../core/serialize.ts";

export function mapReviewOutcome(outcome: ReviewOutcome): { isError: boolean; text: string } {
  const isError = outcome.exitCode === 1;
  if (!outcome.createdRun) {
    return { isError, text: outcome.error ?? "review did not create a run" };
  }
  return { isError, text: serializeStatus(outcome.status!) };
}
