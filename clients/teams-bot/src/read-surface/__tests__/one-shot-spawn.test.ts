import { describe, expect, it } from "vitest";
import { nodeOneShotSpawnFn } from "../one-shot-spawn";

const NODE_BIN = process.execPath;

describe("read-surface/one-shot-spawn — real process, real timing", () => {
  it("captures stdout and a zero exit code for a process that exits quickly", async () => {
    const result = await nodeOneShotSpawnFn(
      NODE_BIN,
      ["-e", "process.stdout.write(JSON.stringify({hello: 'world'}))"],
      { env: {}, timeoutMs: 5000 },
    );
    expect(result.code).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(JSON.parse(result.stdout)).toEqual({ hello: "world" });
  });

  it("captures a nonzero exit code and stderr", async () => {
    const result = await nodeOneShotSpawnFn(
      NODE_BIN,
      ["-e", "process.stderr.write('boom'); process.exit(3)"],
      { env: {}, timeoutMs: 5000 },
    );
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("boom");
    expect(result.timedOut).toBe(false);
  });

  it("BOUNDED WAIT, proven against a real process: a process that never exits is killed at the configured timeout, not left to hang", async () => {
    const start = Date.now();
    const result = await nodeOneShotSpawnFn(
      NODE_BIN,
      ["-e", "setInterval(() => {}, 1000)"], // never exits on its own
      { env: {}, timeoutMs: 300 },
    );
    const elapsedMs = Date.now() - start;

    expect(result.timedOut).toBe(true);
    // Generous upper bound — proves the wait is bounded by the timeout, not
    // by however long the never-exiting process would otherwise have run.
    expect(elapsedMs).toBeLessThan(3000);
  });
});
