import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { RuntimeBuild } from "../core/contracts.ts";

const execFileAsync = promisify(execFile);
const GIT_ENV_KEYS = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM"] as const;

function gitEnvironment(from: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { GIT_OPTIONAL_LOCKS: "0" };
  for (const key of GIT_ENV_KEYS) {
    const value = from[key];
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  return env;
}

async function git(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      env: gitEnvironment(process.env),
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function writeBuildStamp(packageRoot: string): Promise<RuntimeBuild> {
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8")) as {
    version?: unknown;
  };
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error("package version is missing");
  }

  const commitValue = await git(["rev-parse", "HEAD"], packageRoot);
  const candidateCommit =
    commitValue !== null && /^[0-9a-f]{40}$/i.test(commitValue) ? commitValue.toLowerCase() : null;
  const status = candidateCommit === null ? null : await git(["status", "--porcelain"], packageRoot);
  const commit = status === null ? null : candidateCommit;
  const build: RuntimeBuild = {
    version: manifest.version,
    commit,
    dirty: commit === null || status === null ? null : status.length > 0,
    built_at: new Date().toISOString(),
  };
  await fs.mkdir(path.join(packageRoot, "dist"), { recursive: true });
  await fs.writeFile(path.join(packageRoot, "dist", "build-info.json"), `${JSON.stringify(build)}\n`, "utf8");
  return build;
}

const sourceFile = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === sourceFile) {
  const packageRoot = path.resolve(path.dirname(sourceFile), "..", "..");
  await writeBuildStamp(packageRoot);
}
