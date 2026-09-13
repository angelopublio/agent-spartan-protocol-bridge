import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { PRODUCER_ISOLATED_WORKSPACE_ENV } from "../src/adapters/adapter.ts";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const packageRoot = path.join(repoRoot, "agent-skill");
const canonicalSkill = path.join(packageRoot, "skills", "spbridge");

const IN_PRODUCER_WORKSPACE = process.env[PRODUCER_ISOLATED_WORKSPACE_ENV] === "1";

test("package files has no entry that admits src", async () => {
  const manifest = JSON.parse(
    await fs.readFile(path.join(repoRoot, "package.json"), "utf8"),
  ) as { files: string[] };
  for (const entry of manifest.files) {
    const root = entry.replace(/^\.\//, "").split("/")[0] ?? "";
    assert.notEqual(root, "src", `files entry admits src: ${entry}`);
    assert.doesNotMatch(root, /[*?{}[\]]/, `files entry has a root glob that could admit src: ${entry}`);
  }
});

test("npm pack dry run contains no src path", { skip: IN_PRODUCER_WORKSPACE }, async () => {
  const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], { cwd: repoRoot });
  const reports = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
  assert.equal(reports.length, 1);
  assert.deepEqual(
    reports[0]!.files.filter((file) => file.path === "src" || file.path.startsWith("src/")),
    [],
  );
});

test("runtime promotion keeps every human command separate and gates packing after tests", async () => {
  const document = await fs.readFile(path.join(repoRoot, "docs", "RUNTIME-PROMOTION.md"), "utf8");
  const blockPattern = /######## RUN ON TERMINAL ################\n([\s\S]*?)\n######## END OF RUN ON TERMINAL ########/g;
  const commands = [...document.matchAll(blockPattern)].map((match) => match[1] ?? "");
  assert.ok(commands.length >= 10);
  for (const command of commands) {
    assert.equal(command.split("\n").length, 1, `marked block must contain one command: ${command}`);
    assert.doesNotMatch(command, /&&|;|\|/, `marked command must not chain: ${command}`);
  }
  assert.deepEqual(commands.slice(0, 7), [
    "npm ci",
    "npm run build",
    "npm test",
    "npm pack --pack-destination <a durable directory outside the repository>",
    "mv <that directory>/spartan-bridge-<version>.tgz <that directory>/spartan-bridge-<version>-<commit>-<built_at digits>[-dirty].tgz",
    "npm -g install <the tarball step 6 named>",
    "spartan-bridge --version",
  ]);

  const testAt = document.indexOf("npm test");
  const gateAt = document.indexOf("Step 4 is the promotion gate");
  const packAt = document.indexOf("npm pack --pack-destination");
  assert.ok(testAt >= 0 && testAt < gateAt && gateAt < packAt);
  const gate = document.slice(gateAt, packAt);
  assert.match(gate, /pre-existing\n`repo-hygiene` tilde failure tracked by task `0082`/);
  assert.match(gate, /any other failure stops the\npromotion/);
  assert.match(gate, /Once task `0082` lands, the accepted baseline becomes zero failures/);
  assert.match(document, /A `built_at` older than\nstep 2's build means the promotion did not land/);

  // C6: the rename is an ordered step and the filename form is stated with the
  // derivation of every field from the build stamp.
  assert.match(document, /eight steps in order: seven commands and one decision/);
  const renameAt = document.indexOf("Step 6 renames it");
  assert.ok(packAt >= 0 && packAt < renameAt);
  assert.match(document, /spartan-bridge-<version>-<commit>-<built_at digits>\[-dirty\]\.tgz/);
  assert.match(document, /every\s+non-digit removed and nothing truncated/);
  assert.match(document, /the literal `nocommit` when the\s+stamp recorded `null`/);
  assert.match(document, /Append `-dirty` when the stamp recorded\s+`dirty: true`/);
});

test("portable package is canonical and the Codex wrapper reuses it", { skip: IN_PRODUCER_WORKSPACE }, async () => {
  await fs.access(path.join(canonicalSkill, "SKILL.md"));
  await assert.rejects(fs.lstat(path.join(repoRoot, "skills", "spbridge")));

  const plugin = JSON.parse(
    await fs.readFile(path.join(packageRoot, ".codex-plugin", "plugin.json"), "utf8"),
  ) as { name: string; skills: string };
  assert.equal(plugin.name, "spbridge");
  assert.equal(plugin.skills, "./skills/");

  const marketplace = JSON.parse(
    await fs.readFile(path.join(repoRoot, ".agents", "plugins", "marketplace.json"), "utf8"),
  ) as { plugins: Array<{ name: string; source: { path: string } }> };
  assert.deepEqual(marketplace.plugins, [
    { name: "spbridge", source: { source: "local", path: "./agent-skill" }, policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category: "Productivity" },
  ]);
});

test("installer migrates only named spbridge links and uninstalls its own links", { skip: IN_PRODUCER_WORKSPACE }, async () => {
  const script = path.join(packageRoot, "scripts", "manage-install.sh");
  const installHome = await fs.mkdtemp(path.join(os.tmpdir(), "spbridge-install-"));
  const oldSource = path.join(installHome, "old-checkout", "skills", "spbridge");
  const agentsSkills = path.join(installHome, ".agents", "skills");
  const unrelatedTarget = path.join(installHome, "unrelated-source");
  const unrelatedLink = path.join(agentsSkills, "unrelated");
  await fs.mkdir(oldSource, { recursive: true });
  await fs.mkdir(agentsSkills, { recursive: true });
  await fs.mkdir(unrelatedTarget, { recursive: true });
  await fs.symlink(oldSource, path.join(agentsSkills, "spbridge"));
  await fs.symlink(unrelatedTarget, unrelatedLink);

  const env = { ...process.env, SPBRIDGE_INSTALL_HOME: installHome };
  await execFileAsync(script, ["install", "all"], { env });
  assert.equal(await fs.readlink(path.join(agentsSkills, "spbridge")), canonicalSkill);
  assert.equal(
    await fs.readlink(path.join(installHome, ".claude", "skills", "spbridge")),
    canonicalSkill,
  );
  assert.equal(await fs.readlink(unrelatedLink), unrelatedTarget);

  await execFileAsync(script, ["uninstall", "all"], { env });
  await assert.rejects(fs.lstat(path.join(agentsSkills, "spbridge")));
  await assert.rejects(fs.lstat(path.join(installHome, ".claude", "skills", "spbridge")));
  assert.equal(await fs.readlink(unrelatedLink), unrelatedTarget);
  await fs.rm(installHome, { recursive: true, force: true });
});
