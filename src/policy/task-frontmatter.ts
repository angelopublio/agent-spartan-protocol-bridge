import { parseDocument, isMap, isSeq, isAlias, isPair } from "yaml";
import type { Document, Node, Pair, YAMLMap } from "yaml";
import {
  HOST_DISPLAY_TO_CANONICAL,
  type CanonicalHost,
  type ReviewKind,
} from "../core/contracts.ts";

export type TaskFrontmatter = {
  protocol: string;
  id: string;
  created_at: string;
  status: string;
  phase: string;
  task_type: string;
  risk: string;
  current_role: string;
  next_role: string;
  updated_at: string;
  handoff_id: string;
  next_handoff_id: string;
};

export class TaskFrontmatterInvalidError extends Error {
  override readonly name = "TaskFrontmatterInvalidError";
  readonly detail: string;
  constructor(detail: string) {
    super("task_invalid");
    this.detail = detail;
  }
}

const REQUIRED_KEYS = [
  "protocol",
  "id",
  "created_at",
  "status",
  "phase",
  "task_type",
  "risk",
  "current_role",
  "next_role",
  "updated_at",
  "handoff_id",
  "next_handoff_id",
] as const;

const ROLES = new Set([
  "human-operator",
  "investigator",
  "planner",
  "implementer",
  "reviewer",
  "independent-reviewer",
  "verifier",
]);

const RISKS = new Set(["routine", "material", "high-impact"]);

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FILENAME_PATTERN = /^(\d{4})-(.+)\.md$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const HANDOFF_PATTERN = /^(?:none|HX-(?:[0-9]{3}|[1-9][0-9]{3,}))$/;
const CONTEXT_ALIAS_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function invalid(detail: string): never {
  throw new TaskFrontmatterInvalidError(detail);
}

export function isValidClientContextAlias(value: string): boolean {
  return CONTEXT_ALIAS_PATTERN.test(value);
}

export function parseTaskFrontmatterDocument(
  bytes: Uint8Array,
  filename: string,
): TaskFrontmatter {
  if (bytes.length < 4 || bytes[0] !== 0x2d || bytes[1] !== 0x2d || bytes[2] !== 0x2d || bytes[3] !== 0x0a) {
    invalid("frontmatter_delimiter_missing");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    invalid("frontmatter_utf8_invalid");
  }
  const lines = text.split("\n");
  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === "---") {
      close = i;
      break;
    }
  }
  if (close < 0) {
    invalid("frontmatter_unclosed");
  }
  const yamlText = lines.slice(1, close).join("\n");
  const doc = parseDocument(yamlText, {
    prettyErrors: true,
    uniqueKeys: true,
    merge: false,
    schema: "failsafe",
    strict: true,
    stringKeys: true,
  });
  if (doc.errors.length > 0 || hasForbiddenYaml(doc) || !isMap(doc.contents)) {
    invalid("frontmatter_yaml_invalid");
  }
  const map = doc.contents;
  const values = new Map<string, string>();
  for (const item of map.items) {
    if (!isPair(item) || typeof item.key !== "object" || item.key === null) {
      invalid("frontmatter_key_node_invalid");
    }
    const keyNode = item.key as Node;
    const valueNode = item.value as Node | null | undefined;
    if (typeof keyNode.toJSON !== "function") {
      invalid("frontmatter_key_node_invalid");
    }
    const key = keyNode.toJSON();
    const value = valueNode?.toJSON();
    if (typeof key !== "string" || typeof value !== "string") {
      invalid("frontmatter_scalar_required");
    }
    if (values.has(key)) {
      invalid("frontmatter_duplicate_key");
    }
    values.set(key, value);
  }
  if (values.size !== REQUIRED_KEYS.length) {
    invalid("frontmatter_key_count_wrong");
  }
  for (const key of REQUIRED_KEYS) {
    if (!values.has(key)) {
      invalid(`frontmatter_missing_required_key: ${key}`);
    }
  }
  const fm = Object.fromEntries(values) as TaskFrontmatter;
  if (!isSemanticVersion(fm.protocol)) {
    invalid("protocol_invalid");
  }
  if (!ID_PATTERN.test(fm.id)) {
    invalid("id_invalid");
  }
  const fileMatch = FILENAME_PATTERN.exec(filename);
  if (!fileMatch || fileMatch[2] !== fm.id) {
    invalid("filename_id_mismatch");
  }
  if (!isCalendarDate(fm.created_at) || !isCalendarDate(fm.updated_at)) {
    invalid("calendar_date_invalid");
  }
  if (fm.status !== "active") {
    invalid("status_not_active");
  }
  if (!RISKS.has(fm.risk)) {
    invalid("risk_invalid");
  }
  if (!ROLES.has(fm.current_role) || !ROLES.has(fm.next_role)) {
    invalid("role_invalid");
  }
  if (!isCanonicalHandoffId(fm.handoff_id) || !isCanonicalHandoffId(fm.next_handoff_id)) {
    invalid("handoff_id_invalid");
  }
  return fm;
}

export function parseTaskFrontmatter(
  bytes: Uint8Array,
  filename: string,
): TaskFrontmatter {
  const fm = parseTaskFrontmatterDocument(bytes, filename);
  if (!isReviewAdmittedFrontmatter(fm)) {
    invalid(reviewAdmissionDeniedDetail(fm));
  }
  return fm;
}

function reviewAdmissionDeniedDetail(fm: TaskFrontmatter): string {
  if (fm.phase === "reviewing") {
    const got: string[] = [];
    if (fm.task_type !== "implementation") {
      got.push(`task_type '${fm.task_type}'`);
    }
    if (fm.current_role !== "implementer") {
      got.push(`current_role '${fm.current_role}'`);
    }
    if (fm.next_role !== "reviewer") {
      got.push(`next_role '${fm.next_role}'`);
    }
    const suffix = got.length > 0 ? got.join(", ") : "incompatible tuple";
    return `phase 'reviewing' requires task_type 'implementation', current_role 'implementer', and next_role 'reviewer' (got ${suffix})`;
  }
  return `phase 'planning' requires task_type 'planning' (got task_type '${fm.task_type}')`;
}

function isReviewAdmittedFrontmatter(fm: TaskFrontmatter): boolean {
  if (fm.phase === "planning" && fm.task_type === "planning") {
    return true;
  }
  return (
    fm.phase === "reviewing" &&
    fm.task_type === "implementation" &&
    fm.current_role === "implementer" &&
    fm.next_role === "reviewer"
  );
}

export function resolveReviewKind(fm: TaskFrontmatter): ReviewKind {
  if (fm.task_type === "planning" && fm.phase === "planning") {
    return "plan";
  }
  if (
    fm.task_type === "implementation" &&
    fm.phase === "reviewing" &&
    fm.current_role === "implementer" &&
    fm.next_role === "reviewer"
  ) {
    return "implementation";
  }
  invalid(reviewAdmissionDeniedDetail(fm));
}

export function isCanonicalHandoffId(value: string): boolean {
  if (value === "none") {
    return true;
  }
  if (!HANDOFF_PATTERN.test(value)) {
    return false;
  }
  const digits = value.slice(3);
  if (digits.length === 3) {
    return digits !== "000";
  }
  return true;
}

export function isSemanticVersion(value: string): boolean {
  return SEMVER_PATTERN.test(value);
}

export function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function canonicalizeHost(display: string): CanonicalHost | null {
  if (display in HOST_DISPLAY_TO_CANONICAL) {
    return HOST_DISPLAY_TO_CANONICAL[display as keyof typeof HOST_DISPLAY_TO_CANONICAL];
  }
  return null;
}

function hasForbiddenYaml(doc: Document.Parsed): boolean {
  if (doc.warnings.length > 0) {
    return true;
  }
  return yamlNodeForbidden(doc.contents);
}

function yamlNodeForbidden(node: Node | null | undefined): boolean {
  if (node == null) {
    return false;
  }
  if (isAlias(node)) {
    return true;
  }
  if (node.anchor) {
    return true;
  }
  if (node.tag && !node.tag.startsWith("tag:yaml.org,2002:")) {
    return true;
  }
  if (isMap(node)) {
    return yamlMapForbidden(node);
  }
  if (isSeq(node)) {
    return node.items.some((item) => yamlNodeForbidden(item as Node));
  }
  return false;
}

function yamlMapForbidden(map: YAMLMap): boolean {
  for (const item of map.items) {
    const pair = item as Pair;
    const key = pair.key as Node;
    const value = pair.value as Node | null | undefined;
    if (typeof key === "object" && key !== null && "value" in key && key.value === "<<") {
      return true;
    }
    if (yamlNodeForbidden(key) || yamlNodeForbidden(value ?? null)) {
      return true;
    }
  }
  return false;
}
