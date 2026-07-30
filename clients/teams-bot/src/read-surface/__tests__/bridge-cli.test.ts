import { describe, expect, it } from "vitest";
import { getChatStatus, listAgents, type BridgeCliConfig } from "../bridge-cli";
import type { OneShotSpawnFn, OneShotSpawnResult } from "../one-shot-spawn";

function configWith(spawnFn: OneShotSpawnFn): BridgeCliConfig {
  return {
    command: "/absolute/traycer-remote-bridge",
    timeoutMs: 5000,
    spawnFn,
  };
}

function fixedResult(result: OneShotSpawnResult): OneShotSpawnFn {
  return async () => result;
}

describe("read-surface/bridge-cli", () => {
  it("parses valid list output", async () => {
    const agents = [
      {
        agentId: "a-1",
        title: "t",
        harnessId: "claude",
        surface: "gui" as const,
        active: true,
        isLocal: true,
        hostId: "h-1",
        capabilities: { readTranscript: true, sendMessage: true },
      },
    ];
    const config = configWith(
      fixedResult({
        code: 0,
        stdout: JSON.stringify(agents),
        stderr: "",
        timedOut: false,
      }),
    );

    const result = await listAgents({}, config);

    expect(result).toEqual({ kind: "ok", value: agents });
  });

  it("rejects malformed JSON as malformed_output, not a thrown exception", async () => {
    const config = configWith(
      fixedResult({
        code: 0,
        stdout: "{not json",
        stderr: "",
        timedOut: false,
      }),
    );

    const result = await listAgents({}, config);

    expect(result).toEqual({
      kind: "failed",
      reason: "malformed_output",
      detail: expect.stringContaining("not valid JSON"),
    });
  });

  it("rejects valid JSON that doesn't match the schema", async () => {
    const config = configWith(
      fixedResult({
        code: 0,
        stdout: JSON.stringify([{ wrong: "shape" }]),
        stderr: "",
        timedOut: false,
      }),
    );

    const result = await listAgents({}, config);

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.reason).toBe("malformed_output");
  });

  it("surfaces a nonzero exit as nonzero_exit with the process's stderr", async () => {
    const config = configWith(
      fixedResult({
        code: 1,
        stdout: "",
        stderr: "remote-bridge: not signed in",
        timedOut: false,
      }),
    );

    const result = await listAgents({}, config);

    expect(result).toEqual({
      kind: "failed",
      reason: "nonzero_exit",
      detail: expect.stringContaining("not signed in"),
    });
  });

  it("surfaces a spawn timeout as spawn_timed_out, distinct from a nonzero exit", async () => {
    const config = configWith(
      fixedResult({ code: null, stdout: "", stderr: "", timedOut: true }),
    );

    const result = await listAgents({}, config);

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.reason).toBe("spawn_timed_out");
  });

  it("getChatStatus passes chatId as a positional arg to the spawn", async () => {
    let capturedArgs: readonly string[] = [];
    const spawnFn: OneShotSpawnFn = async (_command, args) => {
      capturedArgs = args;
      return {
        code: 0,
        stdout: JSON.stringify({
          chatId: "c-1",
          title: null,
          runStatus: "idle",
          pendingApprovals: [],
          pendingInterviews: [],
          connected: true,
        }),
        stderr: "",
        timedOut: false,
      };
    };

    await getChatStatus("c-1", {}, configWith(spawnFn));

    expect(capturedArgs).toEqual(["status", "c-1"]);
  });
});
