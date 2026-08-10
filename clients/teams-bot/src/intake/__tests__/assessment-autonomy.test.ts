/**
 * An assessment must be dispatched UNATTENDED, and interactive sends must not
 * be.
 *
 * The bridge mints every chat `supervised` (`DEFAULT_PERMISSION_MODE` in
 * `clients/remote-bridge/src/bridge-client.ts`), which is right for a chat a
 * person is sitting in front of and strands one nobody is watching: the agent
 * stops at its first tool call and waits for a tap from someone who has been
 * told to come back later. Observed live on 2026-08-09 — an assessment sat on
 * "Waiting on you: Bash — Search filesystem for smv4-related files" having
 * done no work, and because the completion reply is still unwired, nothing
 * said so.
 *
 * These assert on the ARGV the bot hands the bridge, because that is the whole
 * mechanism: `--permission-mode` either reaches the bridge or it does not.
 */
import { describe, expect, it } from "vitest";
import { sendMessageAction } from "../../read-surface/bridge-cli";
import { createStartAssessment } from "../start-assessment";
import type { OneShotSpawnFn } from "../../read-surface/one-shot-spawn";

function recordingSpawn(): {
  readonly spawn: OneShotSpawnFn;
  readonly calls: string[][];
} {
  const calls: string[][] = [];
  const spawn: OneShotSpawnFn = (_command, args) => {
    calls.push([...args]);
    // Answer in the shape each verb actually returns. `create-chat` yields
    // `{ chatId }`, not an ActionOutcome — a single canned reply makes the
    // create look malformed, the dispatch bails before sending, and the
    // assertion below fails for a reason that has nothing to do with
    // permissions. (It did exactly that on the first run.)
    const stdout =
      args[0] === "create-chat"
        ? JSON.stringify({ chatId: args[1] })
        : JSON.stringify({ kind: "applied" });
    return Promise.resolve({ code: 0, stdout, stderr: "", timedOut: false });
  };
  return { spawn, calls };
}

function configWith(spawn: OneShotSpawnFn) {
  return { command: "traycer-remote-bridge", spawnFn: spawn, timeoutMs: 1000 };
}

describe("assessment autonomy", () => {
  it("asks for full_access when a mode is given", async () => {
    const { spawn, calls } = recordingSpawn();
    await sendMessageAction(
      "chat-1",
      "do the thing",
      {},
      configWith(spawn),
      "full_access",
    );

    const args = calls[0] ?? [];
    expect(args).toContain("--permission-mode");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("full_access");
  });

  /**
   * The negative half, and the one that actually protects anything. Without
   * it, "always pass full_access" would satisfy the test above while quietly
   * removing the approval prompt from every human reply in the composer —
   * the exact behaviour the mode is scoped to avoid.
   */
  it("says nothing about permissions for an ordinary send", async () => {
    const { spawn, calls } = recordingSpawn();
    await sendMessageAction("chat-1", "just a reply", {}, configWith(spawn));

    const args = calls[0] ?? [];
    expect(args).toEqual(["send", "chat-1", "just a reply"]);
    expect(args).not.toContain("--permission-mode");
  });

  /**
   * THE ONE THAT MATTERS. The three above prove the plumbing exists; none of
   * them would notice `"full_access"` being deleted from `start-assessment.ts`,
   * which is the only place that uses it and therefore the only way the
   * defect comes back. So this drives the real dispatch and reads the argv it
   * actually hands the bridge.
   */
  it("dispatches a real assessment unattended", async () => {
    const { spawn, calls } = recordingSpawn();
    const start = createStartAssessment({
      references: { remember: () => undefined } as never,
      hostId: "host-1",
      epicId: "epic-1",
      tabBaseUrl: "",
      bridgeCliConfig: configWith(spawn),
      buildEnv: () => Promise.resolve({}),
      now: () => 0,
      stagingRoot: "/tmp/staging",
      listStaged: () => Promise.resolve([]),
    });

    await start({
      conversationId: "conv-1",
      skill: "smv4-opportunity-pipeline",
      product: "sensormine",
      intent: "new-opportunity",
      conversationReference: {
        conversation: { id: "conv-1" },
        serviceUrl: "https://example.invalid",
        channelId: "msteams",
        bot: { id: "bot" },
      },
      spokenText: "does this fit SensorMine?",
      opportunity: {
        slug: "acme-water-rfp",
        buyer: "Acme Water",
        deadlineIso: "2026-09-14T17:00:00+10:00",
        jurisdiction: "local",
        owner: "Sam Lowe",
      } as never,
    });

    const send = calls.find((args) => args[0] === "send");
    expect(send, "the dispatch never sent the instruction").toBeDefined();
    expect(
      send,
      "an assessment was dispatched WITHOUT full_access — it will stop at its " +
        "first tool call and wait for a person who has been told to come back later",
    ).toContain("--permission-mode");
    expect((send ?? [])[(send ?? []).indexOf("--permission-mode") + 1]).toBe(
      "full_access",
    );
  });

  /**
   * The message is passed as one argv element, so a mode flag can never be
   * smuggled in through message text — the spawn uses no shell, but an
   * argument-splitting regression would be invisible without this.
   */
  it("keeps a message that looks like a flag as message text", async () => {
    const { spawn, calls } = recordingSpawn();
    await sendMessageAction(
      "chat-1",
      "--permission-mode full_access",
      {},
      configWith(spawn),
    );

    expect(calls[0]).toEqual([
      "send",
      "chat-1",
      "--permission-mode full_access",
    ]);
  });
});
