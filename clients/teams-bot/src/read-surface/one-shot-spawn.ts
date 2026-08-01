import { spawn } from "node:child_process";

/**
 * A single bounded-wait, output-capturing child process invocation — the
 * shape `bridge-cli.ts`'s one-shot reads need (`list`, `status`, the
 * anticipated `epics`), distinct from A2's `TenantConnectionManager`'s
 * `SpawnFn` (long-running, no output capture, used for the `watch`/
 * proactive path only). Every call is bounded: this project's standing
 * rule is that every hop has a bounded wait and an honest failure state —
 * a spawn that never exits must not hang the caller forever.
 */

export interface OneShotSpawnResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface OneShotSpawnOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
}

export type OneShotSpawnFn = (
  command: string,
  args: readonly string[],
  options: OneShotSpawnOptions,
) => Promise<OneShotSpawnResult>;

/** Production default: the real `node:child_process.spawn`, stdio captured, bounded by `options.timeoutMs`. */
export const nodeOneShotSpawnFn: OneShotSpawnFn = (command, args, options) => {
  return new Promise<OneShotSpawnResult>((resolve) => {
    const child = spawn(command, args as string[], {
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);

    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", () => {
      finish(null);
    });
    child.on("exit", (code) => {
      finish(code);
    });
  });
};
