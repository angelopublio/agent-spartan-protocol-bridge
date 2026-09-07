import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { PRODUCER_WRITE_SCOPE_FAILURES, type ProducerWriteScopeFailure } from "../core/contracts.ts";
import { SANDBOX_EXEC_EXECUTABLE } from "./process.ts";

export { PRODUCER_WRITE_SCOPE_FAILURES, type ProducerWriteScopeFailure };

export class ProducerWriteScopeError extends Error {
  override readonly name = "ProducerWriteScopeError";
  readonly code: ProducerWriteScopeFailure;
  constructor(code: ProducerWriteScopeFailure) {
    super(code);
    this.code = code;
  }
}

export type ProducerIsolationGuard = { sandboxProfile: string };

function sandboxPathLiteral(value: string): string {
  if (
    value.length === 0 ||
    value.includes("\"") ||
    value.includes("\\") ||
    value.includes("\n") ||
    value.includes("\r") ||
    value.includes("\0")
  ) {
    throw new ProducerWriteScopeError("confine_unavailable");
  }
  return `"${value}"`;
}

function optionalRealRoot(value: string | undefined): string | null {
  if (value === undefined || value.length === 0) {
    return null;
  }
  try {
    return realpathSync(value);
  } catch {
    return null;
  }
}

/** An allow-list-shaped Darwin sandbox. SBPL uses last-match precedence. */
export function producerIsolatedSandboxProfile(
  realWorkspaceRoot: string,
  realRoot: string,
  env: NodeJS.ProcessEnv,
): string {
  const workspaceLiteral = sandboxPathLiteral(realWorkspaceRoot);
  const rootLiteral = sandboxPathLiteral(realRoot);
  const clauses = ["(version 1)", "(allow default)", "(deny file-write*)"];
  const home = optionalRealRoot(env.HOME);
  const tmpdir = optionalRealRoot(env.TMPDIR);
  if (home !== null) {
    clauses.push(`(allow file-write* (subpath ${sandboxPathLiteral(home)}))`);
  }
  if (tmpdir !== null) {
    clauses.push(`(allow file-write* (subpath ${sandboxPathLiteral(tmpdir)}))`);
  }
  clauses.push(
    `(allow file-write* (subpath ${workspaceLiteral}))`,
    `(deny file-write* (require-all (subpath ${workspaceLiteral}) (vnode-type SYMLINK)))`,
    `(deny file-write* (subpath ${rootLiteral}))`,
    `(deny file-link (subpath ${rootLiteral}))`,
    "",
  );
  return clauses.join("\n");
}

export async function applyProducerIsolation(
  repoRoot: string,
  workspaceRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<ProducerIsolationGuard> {
  if (process.platform !== "darwin") {
    throw new ProducerWriteScopeError("confine_unavailable");
  }
  try {
    await fs.access(SANDBOX_EXEC_EXECUTABLE, fs.constants.X_OK);
  } catch {
    throw new ProducerWriteScopeError("confine_unavailable");
  }
  let realRoot: string;
  let realWorkspaceRoot: string;
  try {
    realRoot = await fs.realpath(path.resolve(repoRoot));
    realWorkspaceRoot = await fs.realpath(path.resolve(workspaceRoot));
  } catch {
    throw new ProducerWriteScopeError("confine_unavailable");
  }
  const relative = path.relative(realRoot, realWorkspaceRoot);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new ProducerWriteScopeError("confine_unavailable");
  }
  return { sandboxProfile: producerIsolatedSandboxProfile(realWorkspaceRoot, realRoot, env) };
}
