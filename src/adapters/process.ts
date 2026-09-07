import { spawn, type ChildProcess } from "node:child_process";

export const TERM_KILL_GRACE_MS = 5_000;

export const SANDBOX_EXEC_EXECUTABLE = "/usr/bin/sandbox-exec";

export type SpawnRequest = {
  executable: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  stdoutCapBytes: number;
  onStdoutChunk?: (chunk: Buffer) => void;
  retainStdout?: boolean;
  sandboxProfile?: string;
  detached?: boolean;
};

export function confinedSpawnTarget(request: SpawnRequest): { executable: string; args: string[] } {
  const profile = request.sandboxProfile;
  if (profile === undefined || process.platform !== "darwin") {
    return { executable: request.executable, args: [...request.args] };
  }
  return {
    executable: SANDBOX_EXEC_EXECUTABLE,
    args: ["-p", profile, request.executable, ...request.args],
  };
}

export type SpawnOutcome = {
  exitCode: number | null;
  signal: string | null;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
  stdoutOverflow: boolean;
};

export type ProcessHandle = {
  readonly groupId: number | null;
  wait(): Promise<SpawnOutcome>;
  cancel(): Promise<void>;
  terminateGroup(): void;
};

export type ProcessRunner = {
  start(request: SpawnRequest): ProcessHandle;
};

export function createNodeProcessRunner(): ProcessRunner {
  return {
    start(request: SpawnRequest): ProcessHandle {
      return new NodeProcessHandle(request);
    },
  };
}

class NodeProcessHandle implements ProcessHandle {
  private readonly outcome: Promise<SpawnOutcome>;
  private child: ChildProcess | undefined;
  private cancelled = false;
  private killTimer: ReturnType<typeof setTimeout> | undefined;
  private graceTimer: ReturnType<typeof setTimeout> | undefined;
  readonly groupId: number | null;

  constructor(request: SpawnRequest) {
    let spawnedGroupId: number | null = null;
    this.outcome = new Promise((resolve, reject) => {
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let timedOut = false;
      let stdoutOverflow = false;
      try {
        const confined = confinedSpawnTarget(request);
        this.child = spawn(confined.executable, confined.args, {
          cwd: request.cwd,
          env: request.env,
          stdio: ["ignore", "pipe", "pipe"],
          shell: false,
          detached: request.detached === true,
        });
        spawnedGroupId = request.detached === true ? (this.child.pid ?? null) : null;
      } catch (error) {
        reject(error);
        return;
      }
      this.killTimer = setTimeout(() => {
        timedOut = true;
        this.signalStop();
      }, request.timeoutMs);
      this.child.stdout?.on("data", (chunk: Buffer) => {
        request.onStdoutChunk?.(chunk);
        if (request.retainStdout === false) {
          return;
        }
        if (stdoutOverflow) {
          return;
        }
        if (stdout.length + chunk.length > request.stdoutCapBytes) {
          stdoutOverflow = true;
          const allowed = request.stdoutCapBytes - stdout.length;
          if (allowed > 0) {
            stdout = Buffer.concat([stdout, chunk.subarray(0, allowed)]);
          }
          return;
        }
        stdout = Buffer.concat([stdout, chunk]);
      });
      this.child.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length < 64 * 1024) {
          stderr = Buffer.concat([stderr, chunk.subarray(0, 64 * 1024 - stderr.length)]);
        }
      });
      this.child.on("error", (error) => {
        this.clearTimers();
        reject(error);
      });
      this.child.on("close", (code, closeSignal) => {
        this.clearTimers();
        resolve({
          exitCode: code,
          signal: typeof closeSignal === "string" && closeSignal.length > 0 ? closeSignal : null,
          stdout,
          stderr,
          timedOut: timedOut || this.cancelled,
          stdoutOverflow,
        });
      });
    });
    this.groupId = spawnedGroupId;
  }

  wait(): Promise<SpawnOutcome> {
    return this.outcome;
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    this.signalStop();
    try {
      await this.outcome;
    } catch {
      // best-effort
    }
  }

  terminateGroup(): void {
    if (this.groupId === null) {
      return;
    }
    try {
      process.kill(-this.groupId, "SIGTERM");
    } catch {
      // best-effort hygiene; confinement does not depend on group lifetime
    }
  }

  private signalStop(): void {
    if (!this.child) {
      return;
    }
    if (this.groupId !== null) {
      this.terminateGroup();
    } else if (!this.child.killed) {
      this.child.kill("SIGTERM");
    }
    this.graceTimer = setTimeout(() => {
      if (this.groupId !== null) {
        try {
          process.kill(-this.groupId, "SIGKILL");
        } catch {
          // best-effort
        }
      } else {
        this.child?.kill("SIGKILL");
      }
    }, TERM_KILL_GRACE_MS);
  }

  private clearTimers(): void {
    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = undefined;
    }
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = undefined;
    }
  }
}
