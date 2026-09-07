import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { AdapterFailureError } from "../src/adapters/adapter.ts";
import {
  CODEX_EXECUTABLE,
  CODEX_HELP_TOKENS,
  CODEX_LAUNCHER_ID,
  CodexAdapter,
} from "../src/adapters/codex.ts";
import { FakeAdapter, createLauncherCatalog, fakeCapabilities } from "../src/adapters/fake.ts";
import { doctor, doctorExitCode, formatDoctorReport, wrapperLauncherWarnings } from "../src/core/doctor.ts";
import {
  constantSource,
  makeRepo,
  passResult,
  testDeps,
  VALID_REGISTRY,
  validAgentsMd,
} from "./helpers.ts";

const GRANT = "A human-started Spartan Bridge run may start the mapped reviewer automatically.";
const CYCLE = "The Bridge may return findings to the current planner session and repeat up to 3 plan-review cycles.";

function existingReportTail(formatted: string): string {
  const lines = formatted.split("\n");
  const registry = lines.findIndex((line) => line.startsWith("registry:"));
  assert.ok(registry >= 0);
  return lines.slice(registry).join("\n");
}

test("doctor reports configured policy after the repository line and leaves existing lines intact", async () => {
  const { root } = await makeRepo({ agents: validAgentsMd() });
  const report = await doctor(root, testDeps());
  assert.equal(report.repo_readable, true);
  assert.equal(report.policy.configured, true);
  assert.equal(report.policy.resolves, true);
  assert.equal(doctorExitCode(report), 0);
  const formatted = formatDoctorReport(report);
  const lines = formatted.split("\n");
  assert.equal(lines[0], "repo: readable");
  assert.equal(lines[1], "policy: configured; resolves");
  assert.match(existingReportTail(formatted), /^registry: readable; schema valid\n/);
  assert.match(formatted, /launcher fake-reviewer-v1: resolved/);
  assert.match(formatted, /cursor-plan-reviewer-v1:/);
  assert.match(formatted, /codex-plan-reviewer-v1:/);
  assert.match(formatted, /grok-plan-reviewer-v1:/);
  assert.equal(typeof report.codex_interface.executable_resolved, "boolean");
  assert.equal(typeof report.codex_interface.interface_available, "boolean");
  assert.equal(typeof report.grok_interface.executable_resolved, "boolean");
  assert.equal(typeof report.grok_interface.interface_available, "boolean");
  assert.deepEqual(report.bindings[0], {
    binding: "reviewer.plan",
    available: true,
    launcher_id: "fake-reviewer-v1",
    reason: null,
    output_excerpt: null,
    failure_hint: null,
  });
  assert.deepEqual(report.bindings[1], {
    binding: "reviewer.implementation",
    available: true,
    launcher_id: "fake-reviewer-v1",
    reason: null,
    output_excerpt: null,
    failure_hint: null,
  });
  assert.deepEqual(report.bindings[2], {
    binding: "implementer",
    available: true,
    launcher_id: "fake-reviewer-v1",
    reason: null,
    output_excerpt: null,
    failure_hint: null,
  });
  assert.match(
    formatted,
    /\ncursor-plan-reviewer-v1: executable unresolved; interface unavailable\ncodex-plan-reviewer-v1: executable unresolved; interface unavailable\ngrok-plan-reviewer-v1: executable unresolved; interface unavailable\nclaude-plan-reviewer-v1: executable unresolved; interface unavailable\nbinding reviewer\.plan: adapter available; launcher=fake-reviewer-v1\nbinding reviewer\.implementation: adapter available; launcher=fake-reviewer-v1\nbinding implementer: adapter available; launcher=fake-reviewer-v1\n$/,
  );
  assert.notEqual(report.bindings[0].launcher_id, "cursor-plan-reviewer-v1");
  assert.doesNotMatch(formatted, /billing/i);
  assert.doesNotMatch(formatted, /account identity/i);
  assert.doesNotMatch(formatted, /ready to review/i);
  assert.doesNotMatch(formatted, /authenti/i);
  assert.doesNotMatch(formatted, /entitlement/i);
  assert.doesNotMatch(formatted, /network/i);
  assert.doesNotMatch(formatted, /session ready/i);
  await fs.rm(root, { recursive: true, force: true });
});

function codexDoctorAdapter(options: { failSandbox?: boolean } = {}): CodexAdapter {
  return new CodexAdapter({
    runner: {
      start(request) {
        if (options.failSandbox && request.executable === "/usr/bin/sandbox-exec") {
          throw new Error("sandbox-exec unavailable");
        }
        return {
          wait: async () => ({
            exitCode: 0,
            stdout: Buffer.from(request.executable === CODEX_EXECUTABLE ? CODEX_HELP_TOKENS.join("\n") : ""),
            stderr: Buffer.alloc(0),
            timedOut: false,
            stdoutOverflow: false,
          }),
          cancel: async () => undefined,
        };
      },
    },
  });
}

test("doctor reports a Codex implementer binding available", async () => {
  const { root } = await makeRepo({
    agents: validAgentsMd({
      host: "Codex",
      model: "gpt-5.6-sol",
      effort: "high",
      implementerHost: "Codex",
    }),
  });
  const registryYaml = VALID_REGISTRY.replaceAll("fake-reviewer-v1", CODEX_LAUNCHER_ID);
  const deps = testDeps({ registryYaml });
  deps.catalog = createLauncherCatalog(
    () => new FakeAdapter(constantSource(passResult())),
    new Map([[CODEX_LAUNCHER_ID, () => codexDoctorAdapter()]]),
  );
  const report = await doctor(root, deps);
  const implementer = report.bindings.find((binding) => binding.binding === "implementer");
  assert.equal(implementer?.available, true);
  assert.equal(implementer?.launcher_id, CODEX_LAUNCHER_ID);
  assert.match(
    formatDoctorReport(report),
    /binding implementer: adapter available; launcher=codex-plan-reviewer-v1/,
  );
  await fs.rm(root, { recursive: true, force: true });
});

test("doctor reports a Codex implementer interface unavailable when producer preflight fails", async () => {
  const { root } = await makeRepo({
    agents: validAgentsMd({
      host: "Codex",
      model: "gpt-5.6-sol",
      effort: "high",
      implementerHost: "Codex",
    }),
  });
  const registryYaml = VALID_REGISTRY.replaceAll("fake-reviewer-v1", CODEX_LAUNCHER_ID);
  const deps = testDeps({ registryYaml });
  deps.catalog = createLauncherCatalog(
    () => new FakeAdapter(constantSource(passResult())),
    new Map([[CODEX_LAUNCHER_ID, () => codexDoctorAdapter({ failSandbox: true })]]),
  );
  const report = await doctor(root, deps);
  const implementer = report.bindings.find((binding) => binding.binding === "implementer");
  assert.equal(implementer?.available, false);
  assert.equal(implementer?.reason, "interface_unavailable");
  assert.match(
    formatDoctorReport(report),
    /binding implementer: adapter unavailable; reason=interface_unavailable/,
  );
  await fs.rm(root, { recursive: true, force: true });
});

test("a repository with no Agent hosts section reports as not configured and exits 0", async () => {
  const { root } = await makeRepo({ agents: "# Project\n\n## Role permissions\n\nNone.\n" });
  const report = await doctor(root, testDeps());
  assert.equal(report.policy.configured, false);
  assert.equal(report.policy.resolves, false);
  assert.equal(doctorExitCode(report), 0);
  assert.equal(formatDoctorReport(report).split("\n")[1], "policy: not configured");
  assert.equal(report.bindings[0].reason, "policy_unavailable");
  assert.equal(report.bindings[1].reason, "policy_unavailable");
  await fs.rm(root, { recursive: true, force: true });
});

test("a missing AGENTS.md reports as not configured and still emits registry facts", async () => {
  const { root } = await makeRepo();
  await fs.rm(path.join(root, "AGENTS.md"));
  const report = await doctor(root, testDeps());
  assert.equal(report.policy.configured, false);
  assert.equal(doctorExitCode(report), 0);
  const formatted = formatDoctorReport(report);
  assert.equal(formatted.split("\n")[1], "policy: not configured");
  assert.match(formatted, /^repo: readable\npolicy: not configured\nregistry:/);
  await fs.rm(root, { recursive: true, force: true });
});

test("configured but invalid policy names the first failing check and exits 1", async () => {
  const { root } = await makeRepo({
    agents: `# X

## Agent hosts

| Binding | Host | Client context |
| --- | --- | --- |
| reviewer.plan | Cursor | personal |

## Spartan Bridge automation authority

- ${GRANT}
- ${CYCLE}
`,
  });
  const report = await doctor(root, testDeps());
  assert.equal(report.policy.configured, true);
  assert.equal(report.policy.resolves, false);
  assert.equal(report.policy.reason, "agents_policy_invalid");
  assert.match(report.policy.message ?? "", /Binding, Host, Client context, Model, Effort/);
  assert.equal(doctorExitCode(report), 1);
  const line = formatDoctorReport(report).split("\n")[1] ?? "";
  assert.match(line, /^policy: configured; invalid \(agents_policy_invalid\): /);
  assert.match(line, /Binding, Host, Client context, Model, Effort/);
  await fs.rm(root, { recursive: true, force: true });
});

test("doctor names each D4 malformation distinctly", async () => {
  const cases: { name: string; agents: string; check: string }[] = [
    { name: "no Agent hosts section", agents: "# X\n", check: "agent_hosts_section_missing" },
    {
      name: "wrong table headers",
      agents: validAgentsMd().replace(
        "| Binding | Host | Client context | Model | Effort |",
        "| Binding | Host | Client context |",
      ),
      check: "binding_table_shape",
    },
    { name: "missing reviewer.plan row", agents: validAgentsMd({ omitPlan: true }), check: "reviewer_plan_row_missing" },
    { name: "unknown host name", agents: validAgentsMd({ host: "cursor" }), check: "host_unknown" },
    {
      name: "client-context alias failing pattern",
      agents: validAgentsMd({ context: "Personal" }),
      check: "client_context_alias",
    },
    {
      name: "model identifier failing charset",
      agents: validAgentsMd({ model: "Composer 2.5" }),
      check: "model_identifier",
    },
    { name: "effort value outside vocabulary", agents: validAgentsMd({ effort: "ultra" }), check: "effort_value" },
    {
      name: "missing automation section",
      agents: `# X

## Agent hosts

| Binding | Host | Client context | Model | Effort |
| --- | --- | --- | --- | --- |
| reviewer.plan | Cursor | personal | Composer-2.5 | none |
`,
      check: "automation_section_missing",
    },
    {
      name: "missing grant sentence",
      agents: validAgentsMd().replace(`- ${GRANT}\n`, ""),
      check: "grant_sentence",
    },
    {
      name: "duplicated grant sentence",
      agents: validAgentsMd().replace(`- ${GRANT}\n`, `- ${GRANT}\n- ${GRANT}\n`),
      check: "grant_sentence",
    },
    {
      name: "missing cycle sentence",
      agents: validAgentsMd().replace(`- ${CYCLE}\n`, ""),
      check: "cycle_sentence",
    },
    {
      name: "malformed cycle sentence",
      agents: validAgentsMd().replace(CYCLE, "The Bridge may return findings to the current planner session and repeat up to 4 plan-review cycles."),
      check: "cycle_sentence",
    },
    {
      name: "conflict sentence with grant present",
      agents: validAgentsMd({ conflict: true }),
      check: "conflict_sentence",
    },
  ];
  const seen = new Set<string>();
  for (const testCase of cases) {
    const { root } = await makeRepo({ agents: testCase.agents });
    const report = await doctor(root, testDeps());
    if (testCase.check === "agent_hosts_section_missing") {
      assert.equal(report.policy.configured, false, testCase.name);
      assert.equal(doctorExitCode(report), 0, testCase.name);
      assert.equal(formatDoctorReport(report).split("\n")[1], "policy: not configured", testCase.name);
    } else {
      assert.equal(report.policy.configured, true, testCase.name);
      assert.equal(report.policy.resolves, false, testCase.name);
      assert.equal(doctorExitCode(report), 1, testCase.name);
      assert.ok((report.policy.message ?? "").length > 0, testCase.name);
      assert.match(formatDoctorReport(report).split("\n")[1] ?? "", /^policy: configured; invalid \(/, testCase.name);
    }
    const { parseAgentsPolicy } = await import("../src/policy/agents-policy.ts");
    const parsed = parseAgentsPolicy(testCase.agents);
    assert.equal(parsed.ok, false, testCase.name);
    if (!parsed.ok) {
      assert.equal(parsed.detail.check, testCase.check, testCase.name);
      seen.add(parsed.detail.check);
    }
    await fs.rm(root, { recursive: true, force: true });
  }
  assert.equal(seen.size, 11);
});

test("doctor calls parseAgentsPolicy and contains no policy parsing of its own", async () => {
  const doctorPath = fileURLToPath(new URL("../src/core/doctor.ts", import.meta.url));
  const source = await fs.readFile(doctorPath, "utf8");
  assert.match(source, /parseAgentsPolicy/);
  assert.match(source, /resolveLauncherId/);
  assert.doesNotMatch(source, /## Agent hosts/);
  assert.doesNotMatch(source, /Spartan Bridge automation authority/);
  assert.doesNotMatch(source, /The human starts every round/);
  assert.doesNotMatch(source, /readFirstTable/);
  assert.doesNotMatch(source, /collectLevel2Sections/);
  assert.doesNotMatch(source, /isModelIdentifier/);
  assert.doesNotMatch(source, /isEffortLevel/);
  assert.doesNotMatch(source, /canonicalizeHost/);
});

test("doctor appends binding-relative adapter results without changing exit semantics", async () => {
  const { root } = await makeRepo({ agents: validAgentsMd({ omitImplementationRow: true }) });
  const report = await doctor(root, testDeps());
  assert.equal(doctorExitCode(report), 0);
  assert.equal(report.bindings[0].available, true);
  assert.deepEqual(report.bindings[1], {
    binding: "reviewer.implementation",
    available: false,
    launcher_id: null,
    reason: "binding_missing",
    output_excerpt: null,
    failure_hint: null,
  });
  const formatted = formatDoctorReport(report);
  assert.match(formatted, /binding reviewer\.implementation: adapter unavailable; reason=binding_missing\nbinding implementer: adapter available; launcher=fake-reviewer-v1\n$/);
  assert.doesNotMatch(formatted, /ready to review/i);
  assert.doesNotMatch(formatted, /authenti/i);
  await fs.rm(root, { recursive: true, force: true });
});

test("a Cursor binding reports the registry launcher rather than a host-derived id", async () => {
  const { root } = await makeRepo({
    agents: validAgentsMd({ host: "Cursor", implementerHost: "Cursor" }),
  });
  const report = await doctor(root, testDeps());
  assert.equal(report.bindings[0].available, true);
  assert.equal(report.bindings[0].launcher_id, "fake-reviewer-v1");
  assert.equal(report.bindings[1].launcher_id, "fake-reviewer-v1");
  assert.notEqual(report.bindings[0].launcher_id, "cursor-plan-reviewer-v1");
  await fs.rm(root, { recursive: true, force: true });
});

test("binding results name one closed reason and leave doctorExitCode unchanged", async () => {
  const invalidPolicy = await makeRepo({ agents: validAgentsMd({ omitPlan: true }) });
  const invalidPolicyReport = await doctor(invalidPolicy.root, testDeps());
  assert.equal(invalidPolicyReport.bindings[0].reason, "policy_unavailable");
  assert.equal(invalidPolicyReport.bindings[1].reason, "policy_unavailable");
  assert.equal(doctorExitCode(invalidPolicyReport), 1);
  await fs.rm(invalidPolicy.root, { recursive: true, force: true });

  const unavailableRepo = await makeRepo();
  const unavailableDeps = {
    ...testDeps(),
    registry: {
      async load(): Promise<string> {
        const { RegistryUnavailableError } = await import("../src/policy/registry.ts");
        throw new RegistryUnavailableError();
      },
    },
  };
  const unavailableReport = await doctor(unavailableRepo.root, unavailableDeps);
  assert.equal(unavailableReport.bindings[0].reason, "registry_unavailable");
  assert.equal(unavailableReport.bindings[1].reason, "registry_unavailable");
  assert.equal(doctorExitCode(unavailableReport), 0);
  await fs.rm(unavailableRepo.root, { recursive: true, force: true });

  const invalidRepo = await makeRepo();
  const invalidReport = await doctor(invalidRepo.root, testDeps({ registryYaml: "schema_version: 1\n" }));
  assert.equal(invalidReport.bindings[0].reason, "registry_invalid");
  assert.equal(invalidReport.bindings[1].reason, "registry_invalid");
  assert.equal(doctorExitCode(invalidReport), 0);
  await fs.rm(invalidRepo.root, { recursive: true, force: true });

  const missingContext = await makeRepo({ agents: validAgentsMd({ context: "unknownctx" }) });
  const missingContextReport = await doctor(missingContext.root, testDeps());
  assert.equal(missingContextReport.bindings[0].reason, "client_context_unavailable");
  assert.equal(missingContextReport.bindings[1].reason, "client_context_unavailable");
  assert.equal(doctorExitCode(missingContextReport), 0);
  await fs.rm(missingContext.root, { recursive: true, force: true });

  const missingLauncher = await makeRepo();
  const missingLauncherReport = await doctor(
    missingLauncher.root,
    testDeps({ registryYaml: VALID_REGISTRY.replaceAll("fake-reviewer-v1", "missing-launcher") }),
  );
  assert.equal(missingLauncherReport.bindings[0].reason, "launcher_unavailable");
  assert.equal(missingLauncherReport.bindings[1].reason, "launcher_unavailable");
  assert.equal(doctorExitCode(missingLauncherReport), 0);
  await fs.rm(missingLauncher.root, { recursive: true, force: true });

  const denied = await makeRepo();
  const deniedReport = await doctor(
    denied.root,
    testDeps({
      createAdapter: () =>
        new FakeAdapter(constantSource(passResult()), {
          ...fakeCapabilities(),
          workspace_write: true,
        }),
    }),
  );
  assert.equal(deniedReport.bindings[0].reason, "capability_denied");
  assert.equal(deniedReport.bindings[1].reason, "capability_denied");
  assert.equal(deniedReport.bindings[2].available, true);
  assert.equal(doctorExitCode(deniedReport), 0);
  await fs.rm(denied.root, { recursive: true, force: true });

  const kindDenied = await makeRepo();
  const kindDeniedReport = await doctor(
    kindDenied.root,
    testDeps({
      createAdapter: () =>
        new FakeAdapter(constantSource(passResult()), {
          ...fakeCapabilities(),
          review_kinds: ["plan"],
        }),
    }),
  );
  assert.equal(kindDeniedReport.bindings[0].available, true);
  assert.equal(kindDeniedReport.bindings[1].reason, "capability_denied");
  assert.equal(kindDeniedReport.bindings[2].available, true);
  assert.equal(doctorExitCode(kindDeniedReport), 0);
  await fs.rm(kindDenied.root, { recursive: true, force: true });

  const preflight = await makeRepo();
  const preflightReport = await doctor(
    preflight.root,
    testDeps({
      createAdapter: () => {
        const adapter = new FakeAdapter(constantSource(passResult()));
        adapter.preflight = async () => {
          throw new Error("preflight failed");
        };
        return adapter;
      },
    }),
  );
  assert.equal(preflightReport.bindings[0].reason, "interface_unavailable");
  assert.equal(preflightReport.bindings[1].reason, "interface_unavailable");
  assert.equal(preflightReport.bindings[2].available, true);
  assert.equal(doctorExitCode(preflightReport), 0);
  const preflightText = formatDoctorReport(preflightReport);
  assert.match(preflightText, /binding reviewer\.plan: adapter unavailable; reason=interface_unavailable/);
  assert.doesNotMatch(preflightText, /authenti/i);
  assert.doesNotMatch(preflightText, /entitlement/i);
  assert.doesNotMatch(preflightText, /ready to review/i);
  await fs.rm(preflight.root, { recursive: true, force: true });
});

test("assessBinding reports capability_denied when capabilities() throws or is malformed", async () => {
  const thrown = await makeRepo();
  const thrownReport = await doctor(
    thrown.root,
    testDeps({
      createAdapter: () => {
        const adapter = new FakeAdapter(constantSource(passResult()));
        adapter.capabilities = () => {
          throw new Error("capabilities failed");
        };
        return adapter;
      },
    }),
  );
  assert.equal(thrownReport.bindings[0].available, false);
  assert.equal(thrownReport.bindings[0].reason, "capability_denied");
  assert.equal(thrownReport.bindings[1].available, false);
  assert.equal(thrownReport.bindings[1].reason, "capability_denied");
  assert.equal(thrownReport.bindings[2].available, true);
  assert.equal(thrownReport.bindings[2].binding, "implementer");
  assert.equal(doctorExitCode(thrownReport), 0);
  const thrownText = formatDoctorReport(thrownReport);
  assert.match(thrownText, /binding reviewer\.plan: adapter unavailable; reason=capability_denied/);
  assert.match(thrownText, /binding reviewer\.implementation: adapter unavailable; reason=capability_denied/);
  assert.doesNotMatch(thrownText, /authenti/i);
  assert.doesNotMatch(thrownText, /ready to review/i);
  await fs.rm(thrown.root, { recursive: true, force: true });

  const malformed = await makeRepo();
  const malformedReport = await doctor(
    malformed.root,
    testDeps({
      createAdapter: () => {
        const adapter = new FakeAdapter(constantSource(passResult()));
        adapter.capabilities = () => ({}) as ReturnType<FakeAdapter["capabilities"]>;
        return adapter;
      },
    }),
  );
  assert.equal(malformedReport.bindings[0].available, false);
  assert.equal(malformedReport.bindings[0].reason, "capability_denied");
  assert.equal(malformedReport.bindings[1].available, false);
  assert.equal(malformedReport.bindings[1].reason, "capability_denied");
  assert.equal(malformedReport.bindings[2].available, true);
  assert.equal(doctorExitCode(malformedReport), 0);
  await fs.rm(malformed.root, { recursive: true, force: true });
});

test("doctor prints preflight output_excerpt and the wrapper-crash signature hint", async () => {
  const { root } = await makeRepo();
  const stderrLine =
    "wrap-official-client: line 12: /tmp/relocated/.agent-profiles/resolve-profile: No such file or directory\n";
  const report = await doctor(
    root,
    testDeps({
      createAdapter: () => {
        const adapter = new FakeAdapter(constantSource(passResult()));
        adapter.preflight = async () => {
          throw new AdapterFailureError(
            {
              phase: "preflight",
              cause: "exit_nonzero",
              exit_code: 1,
              signal: null,
              http_status: null,
              stderr_bytes: 0,
              stderr_log: null,
              payload_log: null,
              output_excerpt_bytes: 0,
              output_excerpt: null,
            },
            Buffer.alloc(0),
            "adapter_error",
            null,
            Buffer.from(stderrLine, "utf8"),
          );
        };
        return adapter;
      },
    }),
  );
  assert.equal(report.bindings[0].reason, "interface_unavailable");
  assert.match(report.bindings[0].output_excerpt ?? "", /wrap-official-client.*resolve-profile/);
  assert.match(report.bindings[0].failure_hint ?? "", /AUTHENTICATION-AND-SECURITY\.md/);
  const formatted = formatDoctorReport(report);
  assert.match(formatted, /binding reviewer\.plan output_excerpt:/);
  assert.match(formatted, /binding reviewer\.plan hint:.*wrap-official-client/);
  await fs.rm(root, { recursive: true, force: true });
});

test("doctor warns when a wrapper launcher resolve-profile path is missing and stays silent when it exists", async () => {
  const layoutRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-bridge-doctor-wrapper-"));
  const binDir = path.join(layoutRoot, "bin");
  await fs.mkdir(binDir, { recursive: true });
  const wrapper = path.join(binDir, "claude");
  await fs.writeFile(
    wrapper,
    `#!/bin/sh
# resolve-profile probe
profiles_root=$(dirname "$0")/..
resolve="$profiles_root/resolve-profile"
exec true
`,
    { mode: 0o755 },
  );
  const env = { ...process.env, PATH: binDir };
  const missingWarnings = await wrapperLauncherWarnings("claude", env);
  assert.ok(missingWarnings.some((line) => line.includes("resolve-profile") && line.includes("does not exist")));
  await fs.writeFile(path.join(layoutRoot, "resolve-profile"), "#!/bin/sh\necho personal\n", { mode: 0o755 });
  const presentWarnings = await wrapperLauncherWarnings("claude", env);
  assert.equal(presentWarnings.length, 0);
  await fs.rm(layoutRoot, { recursive: true, force: true });
});

test("doctor cursor-home HOME warning fires only when the wrapper HOME restore is not armed", async () => {
  const layoutRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spartan-bridge-doctor-cursorhome-"));
  const binDir = path.join(layoutRoot, "bin");
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    path.join(binDir, "claude"),
    `#!/bin/sh\n# resolve-profile probe\nexec true\n`,
    { mode: 0o755 },
  );
  await fs.writeFile(path.join(layoutRoot, "resolve-profile"), "#!/bin/sh\necho personal\n", { mode: 0o755 });
  const base = { ...process.env, PATH: binDir };
  const relocatedHome = path.join(layoutRoot, "cursor-home");
  const realHome = path.join(layoutRoot, "real-home");
  const fires = (line: string) => line.includes("HOME matches a cursor-home path");

  // (a) no marker → warn
  const a = await wrapperLauncherWarnings("claude", { ...base, HOME: relocatedHome, AGENT_PROFILES_REAL_HOME: "", CLAUDE_CONFIG_DIR: "" });
  assert.ok(a.some(fires));
  // (b) marker set to a real home AND CLAUDE_CONFIG_DIR set → armed, no warn
  const b = await wrapperLauncherWarnings("claude", { ...base, HOME: relocatedHome, AGENT_PROFILES_REAL_HOME: realHome, CLAUDE_CONFIG_DIR: path.join(realHome, ".claude") });
  assert.ok(!b.some(fires));
  // (c) marker set but CLAUDE_CONFIG_DIR unset → not armed, warn
  const c = await wrapperLauncherWarnings("claude", { ...base, HOME: relocatedHome, AGENT_PROFILES_REAL_HOME: realHome, CLAUDE_CONFIG_DIR: "" });
  assert.ok(c.some(fires));
  // (d) marker itself under cursor-home → restore is a no-op, warn
  const d = await wrapperLauncherWarnings("claude", { ...base, HOME: relocatedHome, AGENT_PROFILES_REAL_HOME: relocatedHome, CLAUDE_CONFIG_DIR: path.join(relocatedHome, ".claude") });
  assert.ok(d.some(fires));

  await fs.rm(layoutRoot, { recursive: true, force: true });
});
