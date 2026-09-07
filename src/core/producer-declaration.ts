import path from "node:path";
import { isCanonicalHandoffId, parseTaskFrontmatterDocument } from "../policy/task-frontmatter.ts";
import type { DeclarationInvalidDetail } from "./contracts.ts";
import { parseOutstandingHandoffSection } from "./task-write.ts";

export type ProducerDeclaration =
  | { ok: true }
  | { ok: false; reason: "producer_declaration_invalid"; detail: DeclarationInvalidDetail };

function invalid(detail: DeclarationInvalidDetail): ProducerDeclaration {
  return { ok: false, reason: "producer_declaration_invalid", detail };
}

export function validateProducerDeclaration(
  taskBytes: Uint8Array,
  filename: string,
  taskPath: string,
): ProducerDeclaration {
  let frontmatter;
  try {
    frontmatter = parseTaskFrontmatterDocument(taskBytes, filename);
  } catch {
    return invalid("frontmatter_unparseable");
  }
  if (frontmatter.task_type !== "implementation") {
    return invalid("frontmatter_task_type");
  }
  if (frontmatter.phase !== "reviewing") {
    return invalid("frontmatter_phase");
  }
  if (frontmatter.current_role !== "implementer") {
    return invalid("frontmatter_current_role");
  }
  if (frontmatter.next_role !== "reviewer") {
    return invalid("frontmatter_next_role");
  }
  if (frontmatter.next_handoff_id === "none" || !isCanonicalHandoffId(frontmatter.next_handoff_id)) {
    return invalid("frontmatter_next_handoff_id");
  }
  const text = Buffer.from(taskBytes).toString("utf8");
  const parsed = parseOutstandingHandoffSection(text, frontmatter.next_handoff_id);
  if ("reject" in parsed) {
    return invalid(parsed.reject);
  }
  const { advisory, prompt } = parsed;
  if (advisory.split("\n").filter((line) => line === "- Role: reviewer").length !== 1) {
    return invalid("advisory_role_line");
  }
  if (!prompt.includes("Open `" + taskPath + "`")) {
    return invalid("prompt_open_path");
  }
  if (!prompt.includes("Act as reviewer")) {
    return invalid("prompt_act_as_reviewer");
  }
  return { ok: true };
}

export function implementationHandoffEnvelope(taskPath: string, handoffId: string): string {
  return `## Next Handoff

\`\`\`text
Recommended execution (human decides):
- Host: Codex (mapped reviewer.implementation)
- Model and effort: gpt-5.6-terra, high
- Invocation: $spartan, passing the prompt block below as the argument
- Role: reviewer
- Handoff: ${handoffId}
\`\`\`

\`\`\`text
Open \`${taskPath}\`. (handoff ${handoffId})

Act as reviewer. Review the implementation against the approved plan and its acceptance criteria.
Run the relevant repository checks and update the same task file.

Return only the next handoff, or a completion notice if no work remains.
\`\`\`
`;
}

export function basenameTaskPath(taskPath: string): string {
  return path.posix.basename(taskPath.replaceAll("\\", "/"));
}
