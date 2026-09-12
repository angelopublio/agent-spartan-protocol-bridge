import {
  AUTHORITY_WRITE_PATHS,
  isAuthorityWritePath,
  isPathAdmittedByScope,
} from "../policy/agents-policy.ts";

const PLAN_TARGET_SECTIONS = new Set(["## Scope", "## Decisions"]);

const KNOWN_TOP_LEVEL_NAMES = new Set([
  "AGENTS.md",
  "README.md",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "LICENSE",
  "CHANGELOG.md",
]);

export function planTargetsUnwritablePath(
  markdown: string,
  writeScope: readonly string[],
  rootEntries: ReadonlySet<string>,
): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const section of collectPlanTargetSections(markdown)) {
    for (const token of extractProseBacktickTokens(section)) {
      const normalized = normalizeRepoPath(token);
      if (normalized === null || !looksLikeRepoPath(normalized, rootEntries)) {
        continue;
      }
      if (isUnwritablePlanTarget(normalized, writeScope) && !seen.has(normalized)) {
        seen.add(normalized);
        tokens.push(normalized);
      }
    }
  }
  return tokens;
}

function collectPlanTargetSections(markdown: string): string[] {
  const sections: string[] = [];
  for (const { heading, body } of collectLevel2Sections(markdown)) {
    if (PLAN_TARGET_SECTIONS.has(heading)) {
      sections.push(body);
    }
  }
  return sections;
}

function collectLevel2Sections(markdown: string): { heading: string; body: string }[] {
  const lines = markdown.split("\n");
  const indices: { heading: string; start: number; bodyStart: number }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^## /.test(line)) {
      indices.push({ heading: line, start: i, bodyStart: i + 1 });
    } else if (/^# /.test(line) && indices.length > 0) {
      indices.push({ heading: "", start: i, bodyStart: i });
    }
  }
  const sections: { heading: string; body: string }[] = [];
  for (let i = 0; i < indices.length; i += 1) {
    const current = indices[i];
    if (!current) {
      continue;
    }
    const next = indices[i + 1];
    const end = next ? next.start : lines.length;
    sections.push({
      heading: current.heading,
      body: lines.slice(current.bodyStart, end).join("\n"),
    });
  }
  return sections;
}

function extractProseBacktickTokens(sectionBody: string): string[] {
  const tokens: string[] = [];
  let inFence = false;
  for (const line of sectionBody.split("\n")) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    for (const match of line.matchAll(/`([^`\n]+)`/g)) {
      const token = match[1]?.trim();
      if (token) {
        tokens.push(token);
      }
    }
  }
  return tokens;
}

// A repo path segment is only these characters. A backtick token containing a
// quote, paren, space, `=`, etc. is quoted prose or code (a JS predicate, a
// config key expression) — not a write target. Guards against a plan that
// discusses the scanner's own code (`advisory.split("\n")...` normalizes to a
// token with a `/` and would otherwise look like a path).
const REPO_PATH_CHARS = /^[A-Za-z0-9._/@+-]+$/;

function normalizeRepoPath(token: string): string | null {
  const posix = token.replaceAll("\\", "/").trim();
  if (posix === "" || posix.startsWith("/") || posix.includes("..") || !REPO_PATH_CHARS.test(posix)) {
    return null;
  }
  return posix.startsWith("./") ? posix.slice(2) : posix;
}

function looksLikeRepoPath(posix: string, rootEntries: ReadonlySet<string>): boolean {
  if (isAuthorityWritePath(posix)) {
    return true;
  }
  if (!posix.includes("/")) {
    return KNOWN_TOP_LEVEL_NAMES.has(posix);
  }
  return rootEntries.has(posix.split("/")[0] ?? "");
}

function isUnwritablePlanTarget(posix: string, writeScope: readonly string[]): boolean {
  if ((AUTHORITY_WRITE_PATHS as readonly string[]).includes(posix)) {
    return true;
  }
  return !isPathAdmittedByScope(posix, writeScope);
}
