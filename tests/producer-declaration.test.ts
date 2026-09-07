import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import {
  DECLARATION_INVALID_DETAILS,
  type DeclarationInvalidDetail,
} from "../src/core/contracts.ts";
import {
  implementationHandoffEnvelope,
  validateProducerDeclaration,
} from "../src/core/producer-declaration.ts";
import {
  describeNextHandoffRejection,
  NEXT_HANDOFF_REJECT_SLUGS,
  parseOutstandingHandoffSection,
  type NextHandoffRejectSlug,
} from "../src/core/task-write.ts";
import {
  DEFAULT_REVIEW_SECTION,
  implementationTaskMd,
  readyImplementationTask,
  TASK_REL,
  validTaskMd,
} from "./helpers.ts";

const FILENAME = "0001-bootstrap-fixture.md";
const TASK_PATH = TASK_REL;

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function validate(text: string, taskPath = TASK_PATH): ReturnType<typeof validateProducerDeclaration> {
  return validateProducerDeclaration(utf8(text), FILENAME, taskPath);
}

function fail(detail: DeclarationInvalidDetail): ReturnType<typeof validateProducerDeclaration> {
  return { ok: false, reason: "producer_declaration_invalid", detail };
}

function withHandoff(section: string, options?: Parameters<typeof implementationTaskMd>[0]): string {
  return `${implementationTaskMd({
    nextHandoffId: "HX-001",
    reviewSection: `\n${DEFAULT_REVIEW_SECTION}`,
    ...options,
  })}
${section}
`;
}

const ENVELOPE = implementationHandoffEnvelope(TASK_PATH, "HX-001").trimEnd();

const UNFENCED_ADVISORY = `## Next Handoff

Recommended execution (human decides):
- Role: reviewer
- Handoff: HX-001

\`\`\`text
Open \`${TASK_PATH}\`. (handoff HX-001)

Act as reviewer.
\`\`\``;

test("validateProducerDeclaration accepts a coherent implementation declaration", () => {
  assert.deepEqual(validate(readyImplementationTask(TASK_PATH)), { ok: true });
});

test("D1: frontmatter parse throw is frontmatter_unparseable", () => {
  assert.deepEqual(validate("not a task artifact\n"), fail("frontmatter_unparseable"));
});

test("D1: each frontmatter field slug is first-failure", () => {
  const cases: Array<[DeclarationInvalidDetail, Parameters<typeof implementationTaskMd>[0]]> = [
    ["frontmatter_task_type", { taskType: "planning" }],
    ["frontmatter_phase", { phase: "planning" }],
    ["frontmatter_current_role", { role: "planner" }],
    ["frontmatter_next_role", { nextRole: "implementer" }],
    ["frontmatter_next_handoff_id", { nextHandoffId: "none" }],
  ];
  for (const [slug, options] of cases) {
    assert.deepEqual(validate(withHandoff(ENVELOPE, options)), fail(slug), slug);
  }
});

test("D1: multiple wrong fields yield only the first slug", () => {
  assert.deepEqual(
    validate(withHandoff(ENVELOPE, { taskType: "planning", phase: "planning", role: "planner" })),
    fail("frontmatter_task_type"),
  );
});

test("D1: each extra needle uses the preserved predicates", () => {
  const ready = readyImplementationTask(TASK_PATH);
  assert.deepEqual(validate(ready.replace("- Role: reviewer\n", "")), fail("advisory_role_line"));
  assert.deepEqual(
    validate(ready.replace("- Role: reviewer\n", "- Role: reviewer\n- Role: reviewer\n")),
    fail("advisory_role_line"),
  );
  assert.deepEqual(
    validate(ready.replace("- Role: reviewer\n", "- Role: Reviewer\n")),
    fail("advisory_role_line"),
  );

  const openInAdvisoryOnly = ready
    .replace(`Open \`${TASK_PATH}\`. (handoff`, `Open \`wrong/path.md\`. (handoff`)
    .replace("- Role: reviewer\n", `- Role: reviewer\nOpen \`${TASK_PATH}\`\n`);
  assert.deepEqual(validate(openInAdvisoryOnly), fail("prompt_open_path"));

  const actInAdvisoryOnly = ready
    .replace("Act as reviewer. Review", "Act as planner. Review")
    .replace("- Role: reviewer\n", "- Role: reviewer\nAct as reviewer\n");
  assert.deepEqual(validate(actInAdvisoryOnly), fail("prompt_act_as_reviewer"));
});

test("D1: a Role / Open / Act-as token only outside its fence still fails", () => {
  const ready = readyImplementationTask(TASK_PATH);
  const roleOnlyInPrompt = ready
    .replace("- Role: reviewer\n", "")
    .replace("Act as reviewer.", "- Role: reviewer\nAct as reviewer.");
  assert.deepEqual(validate(roleOnlyInPrompt), fail("advisory_role_line"));

  const openOnlyInAdvisory = ready
    .replace(`Open \`${TASK_PATH}\`. (handoff`, `Open \`wrong/path.md\`. (handoff`)
    .replace("- Role: reviewer\n", `- Role: reviewer\nOpen \`${TASK_PATH}\`\n`);
  assert.deepEqual(validate(openOnlyInAdvisory), fail("prompt_open_path"));

  const actOnlyInAdvisory = ready
    .replace("Act as reviewer. Review", "Act as planner. Review")
    .replace("- Role: reviewer\n", "- Role: reviewer\nAct as reviewer\n");
  assert.deepEqual(validate(actOnlyInAdvisory), fail("prompt_act_as_reviewer"));
});

test("D1: each NextHandoffRejectSlug the declaration path can reach", () => {
  const cases: Array<[NextHandoffRejectSlug, string]> = [
    ["section_absent", ""],
    ["opening_shape", ENVELOPE.replace("## Next Handoff\n\n```text", "## Next Handoff\n```text")],
    ["advisory_fence_nested", ENVELOPE.replace("- Handoff: HX-001\n```", "- Handoff: HX-001\n```text\n```")],
    [
      "advisory_fence_unclosed",
      "## Next Handoff\n\n```text\nRecommended execution (human decides):\n- Role: reviewer\n- Handoff: HX-001\n",
    ],
    ["prompt_block_missing", ENVELOPE.replace(/\n\n```text\nOpen[\s\S]*$/, "")],
    [
      "prompt_fence_nested",
      ENVELOPE.replace(
        "Return only the next handoff, or a completion notice if no work remains.\n```",
        "Return only the next handoff, or a completion notice if no work remains.\n```text\n```",
      ),
    ],
    ["prompt_fence_unclosed", `${ENVELOPE.slice(0, -4)}\n`],
    ["trailing_content", `${ENVELOPE}\n\nstray prose after the fence`],
    ["advisory_handoff_line", ENVELOPE.replace("- Handoff: HX-001\n", "")],
    ["prompt_handoff_mark", ENVELOPE.replace(" (handoff HX-001)", "")],
    ["stray_identifier", ENVELOPE.replace("Act as reviewer.", "Act as reviewer. See HX-777.")],
  ];
  for (const [slug, section] of cases) {
    assert.deepEqual(validate(withHandoff(section)), fail(slug), slug);
  }
});

test("D2: NEXT_HANDOFF_REJECT_SLUGS is a subset of DECLARATION_INVALID_DETAILS", () => {
  const persistable = new Set<string>(DECLARATION_INVALID_DETAILS);
  for (const slug of NEXT_HANDOFF_REJECT_SLUGS) {
    assert.equal(persistable.has(slug), true, slug);
  }
});

test("D2: the 0056 unfenced-advisory shape is opening_shape from both paths", () => {
  const planText = `${validTaskMd({ nextHandoffId: "HX-001", reviewSection: `\n${DEFAULT_REVIEW_SECTION}\n${UNFENCED_ADVISORY}` })}`;
  assert.equal(describeNextHandoffRejection(planText, "plan"), "opening_shape");
  assert.deepEqual(validate(withHandoff(UNFENCED_ADVISORY)), fail("opening_shape"));
});

test("D2: producer-declaration.ts calls the exported classifier and has no fence-walk", async () => {
  const declaration = await fs.readFile(new URL("../src/core/producer-declaration.ts", import.meta.url), "utf8");
  const taskWrite = await fs.readFile(new URL("../src/core/task-write.ts", import.meta.url), "utf8");
  assert.match(declaration, /parseOutstandingHandoffSection/);
  assert.doesNotMatch(declaration, /hasCoherentImplementationHandoff/);
  assert.doesNotMatch(declaration, /locateNextHandoff/);
  assert.doesNotMatch(declaration, /FENCE_OPEN_TEXT/);
  assert.doesNotMatch(taskWrite, /producer-declaration/);
});

test("D2: parseOutstandingHandoffSection success arm exposes advisory and prompt slices", () => {
  const text = readyImplementationTask(TASK_PATH);
  const parsed = parseOutstandingHandoffSection(text, "HX-001");
  assert.equal("located" in parsed, true);
  if (!("located" in parsed)) {
    return;
  }
  assert.match(parsed.advisory, /^- Role: reviewer$/m);
  assert.match(parsed.advisory, /^- Handoff: HX-001$/m);
  assert.match(parsed.prompt, /Open `spartan\/tasks\/0001-bootstrap-fixture\.md`/);
  assert.match(parsed.prompt, /Act as reviewer/);
});

test("D2: non-blank prose after the prompt fence is trailing_content; blank lines still pass", () => {
  assert.deepEqual(validate(withHandoff(`${ENVELOPE}\n\nstray prose after the fence`)), fail("trailing_content"));
  for (const suffix of ["", "\n", "\n\n", "\n\n\n"]) {
    assert.deepEqual(validate(withHandoff(`${ENVELOPE}${suffix}`)), { ok: true }, JSON.stringify(suffix));
  }
});
