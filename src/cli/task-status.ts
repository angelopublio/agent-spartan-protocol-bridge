import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseAgentsPolicy, automaticImplementationAdmission } from "../policy/agents-policy.ts";
import { resolveContainedTaskPath, resolveRuntimeLayout } from "../runtime/paths.ts";
import { readStatus, runDirFor } from "../runtime/store.ts";
import { readTransitionStatus } from "../runtime/transition-store.ts";
import type { StatusDocument, TransitionStatusDocument } from "../core/contracts.ts";

const execFileAsync = promisify(execFile);

export type TaskChainStatusReport = {
  task_path: string;
  transition_id: string | null;
  transition_state: string | null;
  implementation_review_run_id: string | null;
  implementation_review_verdict: string | null;
  implementation_review_reason_code: string | null;
  git_diff_stat: string | null;
  error: string | null;
};

async function findLatestCompletedTransition(
  repoRoot: string,
  taskPath: string,
): Promise<TransitionStatusDocument | null> {
  const { transitionsDir } = await resolveRuntimeLayout(repoRoot);
  let entries: string[];
  try {
    entries = await fs.readdir(transitionsDir);
  } catch {
    return null;
  }
  let latest: TransitionStatusDocument | null = null;
  for (const entry of entries) {
    try {
      const doc = await readTransitionStatus(path.join(transitionsDir, entry));
      if (doc.task_path !== taskPath || doc.state !== "completed") {
        continue;
      }
      if (latest === null || doc.updated_at > latest.updated_at) {
        latest = doc;
      }
    } catch {
      // skip unreadable entries
    }
  }
  return latest;
}

async function readImplementationReviewStatus(
  repoRoot: string,
  transition: TransitionStatusDocument,
): Promise<StatusDocument | null> {
  const reviewRunId =
    transition.linked_review_run_ids.at(-1) ?? transition.current_review_run_id;
  if (typeof reviewRunId !== "string") {
    return null;
  }
  try {
    return await readStatus(runDirFor(repoRoot, reviewRunId));
  } catch {
    return null;
  }
}

async function gitDiffStat(repoRoot: string, writeScope: readonly string[]): Promise<string | null> {
  const paths = writeScope.filter((entry) => entry.length > 0);
  if (paths.length === 0) {
    return null;
  }
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--stat", "--", ...paths], {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trimEnd();
  } catch (error) {
    if (error && typeof error === "object" && "stdout" in error) {
      const stdout = (error as { stdout?: string }).stdout;
      if (typeof stdout === "string") {
        return stdout.trimEnd();
      }
    }
    return null;
  }
}

export async function reportTaskChainStatus(repoRoot: string, taskPath: string): Promise<TaskChainStatusReport> {
  try {
    await resolveContainedTaskPath(repoRoot, taskPath);
  } catch {
    return {
      task_path: taskPath,
      transition_id: null,
      transition_state: null,
      implementation_review_run_id: null,
      implementation_review_verdict: null,
      implementation_review_reason_code: null,
      git_diff_stat: null,
      error: "task_not_found",
    };
  }

  const transition = await findLatestCompletedTransition(repoRoot, taskPath);
  if (transition === null) {
    return {
      task_path: taskPath,
      transition_id: null,
      transition_state: null,
      implementation_review_run_id: null,
      implementation_review_verdict: null,
      implementation_review_reason_code: null,
      git_diff_stat: null,
      error: "completed_transition_not_found",
    };
  }

  const reviewStatus = await readImplementationReviewStatus(repoRoot, transition);
  let gitStat: string | null = null;
  try {
    const agentsText = await fs.readFile(path.join(repoRoot, "AGENTS.md"), "utf8");
    const agentsPolicy = parseAgentsPolicy(agentsText);
    if (agentsPolicy.ok) {
      const admission = automaticImplementationAdmission(agentsPolicy);
      if (admission.ok) {
        gitStat = await gitDiffStat(repoRoot, admission.write_scope);
      }
    }
  } catch {
    gitStat = null;
  }

  return {
    task_path: taskPath,
    transition_id: transition.transition_id,
    transition_state: transition.state,
    implementation_review_run_id: reviewStatus?.run_id ?? null,
    implementation_review_verdict: reviewStatus?.verdict ?? null,
    implementation_review_reason_code: reviewStatus?.reason_code ?? null,
    git_diff_stat: gitStat,
    error: null,
  };
}

export function formatTaskChainStatusReport(report: TaskChainStatusReport): string {
  return `${JSON.stringify(report)}\n`;
}
