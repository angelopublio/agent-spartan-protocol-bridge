import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { parseTaskFrontmatter, parseTaskFrontmatterDocument, resolveReviewKind } from "../src/policy/task-frontmatter.ts";
import { validTaskMd, implementationTaskMd } from "./helpers.ts";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

test("accepts the closed Phase-1A frontmatter grammar", () => {
  const fm = parseTaskFrontmatter(bytes(validTaskMd()), "0001-bootstrap-fixture.md");
  assert.equal(fm.id, "bootstrap-fixture");
  assert.equal(fm.current_role, "planner");
});

test("rejects missing, extra, duplicate, coerced, and incompatible fields", () => {
  const filename = "0001-bootstrap-fixture.md";
  assert.throws(() => parseTaskFrontmatter(bytes("id: x\n"), filename));
  assert.throws(() => parseTaskFrontmatter(bytes(validTaskMd({ extra: "\nfoo: bar" })), filename));
  assert.throws(() => parseTaskFrontmatter(bytes(validTaskMd().replace("status: active", "status: active\nstatus: active")), filename));
  assert.throws(() => parseTaskFrontmatter(bytes(validTaskMd({ status: "completed" })), filename));
  assert.throws(() => parseTaskFrontmatter(bytes(validTaskMd({ phase: "implementing" })), filename));
  assert.throws(() => parseTaskFrontmatter(bytes(validTaskMd({ id: "other" })), filename));
  assert.throws(() => parseTaskFrontmatter(bytes("\uFEFF" + validTaskMd()), filename));
});

test("rejects non-canonical handoff identifiers and invalid calendar dates", () => {
  const filename = "0001-bootstrap-fixture.md";
  const withHandoff = validTaskMd().replace("handoff_id: none", "handoff_id: HX-000");
  assert.throws(() => parseTaskFrontmatter(bytes(withHandoff), filename));
  const padded = validTaskMd().replace("next_handoff_id: none", "next_handoff_id: HX-0999");
  assert.throws(() => parseTaskFrontmatter(bytes(padded), filename));
  const badDate = validTaskMd().replace("created_at: 2026-08-16", "created_at: 2026-02-29");
  assert.throws(() => parseTaskFrontmatter(bytes(badDate), filename));
});

test("valid current_role and next_role values are accepted without routing meaning", () => {
  const filename = "0001-bootstrap-fixture.md";
  const fm = parseTaskFrontmatter(
    bytes(validTaskMd({ role: "implementer", nextRole: "verifier" })),
    filename,
  );
  assert.equal(fm.current_role, "implementer");
  assert.equal(fm.next_role, "verifier");
});

test("admits any well-formed protocol birth-stamp and rejects a malformed or absent stamp", () => {
  const filename = "0001-bootstrap-fixture.md";
  for (const protocol of ["0.6.1", "1.0.0", "2.3.4"]) {
    const fm = parseTaskFrontmatter(bytes(validTaskMd({ protocol })), filename);
    assert.equal(fm.protocol, protocol);
  }
  for (const protocol of ["not-a-version", "1.0", "v1.0.0", "01.0.0"]) {
    assert.throws(
      () => parseTaskFrontmatter(bytes(validTaskMd({ protocol })), filename),
      { message: "task_invalid" },
    );
  }
  const absent = validTaskMd().replace(/^protocol: ".*"\n/m, "");
  assert.equal(absent.includes("protocol:"), false);
  assert.throws(() => parseTaskFrontmatter(bytes(absent), filename), { message: "task_invalid" });
});

test("task-frontmatter does not pin protocol to PROTOCOL_VERSION", async () => {
  const source = await fs.readFile(new URL("../src/policy/task-frontmatter.ts", import.meta.url), "utf8");
  assert.equal(source.includes("PROTOCOL_VERSION"), false);
});

test("admits plan and implementation-review frontmatter and refuses the D4 table", () => {
  const filename = "0001-bootstrap-fixture.md";
  const plan = parseTaskFrontmatter(bytes(validTaskMd()), filename);
  assert.equal(resolveReviewKind(plan), "plan");
  const impl = parseTaskFrontmatter(bytes(implementationTaskMd()), filename);
  assert.equal(resolveReviewKind(impl), "implementation");
  parseTaskFrontmatterDocument(bytes(implementationTaskMd({ nextRole: "implementer" })), filename);
  parseTaskFrontmatterDocument(bytes(implementationTaskMd({ nextRole: "human-operator" })), filename);

  const refused = [
    validTaskMd({ taskType: "implementation", phase: "implementing", role: "implementer", nextRole: "reviewer" }),
    validTaskMd({ taskType: "planning", phase: "reviewing", role: "planner", nextRole: "reviewer" }),
    validTaskMd({ taskType: "implementation", phase: "planning", role: "implementer", nextRole: "reviewer" }),
    implementationTaskMd({ role: "planner" }),
    implementationTaskMd({ nextRole: "implementer" }),
    implementationTaskMd({ nextRole: "human-operator" }),
    implementationTaskMd({ nextRole: "verifier" }),
  ];
  for (const text of refused) {
    assert.throws(() => parseTaskFrontmatter(bytes(text), filename), { message: "task_invalid" }, text);
  }
});

test("TaskFrontmatterInvalidError carries admission and structural detail strings", () => {
  const filename = "0001-bootstrap-fixture.md";
  try {
    parseTaskFrontmatter(
      bytes(validTaskMd({ taskType: "planning", phase: "reviewing", role: "planner", nextRole: "reviewer" })),
      filename,
    );
    assert.fail("expected review admission denial");
  } catch (error) {
    assert.match((error as Error).message, /task_invalid/);
    assert.match((error as { detail: string }).detail, /phase 'reviewing' requires task_type 'implementation'/);
    assert.match((error as { detail: string }).detail, /task_type 'planning'/);
  }
  try {
    parseTaskFrontmatter(bytes("id: x\n"), filename);
    assert.fail("expected delimiter failure");
  } catch (error) {
    assert.equal((error as { detail: string }).detail, "frontmatter_delimiter_missing");
  }
});
