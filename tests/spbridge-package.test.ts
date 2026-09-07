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
