/**
 * The REAL spawn, against a REAL child process.
 *
 * `watch-runner.test.ts` proves the lifecycle with a fake spawn, which is the
 * right way to test backoff and ordering. It cannot prove the thing this file
 * is about: that `nodeSpawnWatchFn` correctly reassembles lines off an actual
 * OS pipe, where chunk boundaries are decided by the kernel rather than by a
 * test.
 *
 * That distinction has burned this project before — a mock that behaves as the
 * author expects proves the author's expectation, not the system. So the child
 * here is a real `node` process writing real bytes, deliberately split
 * mid-JSON, and the assertion is that the event arrives intact.
 *
 * What this still does NOT cover, and no test here can: the actual
 * `traycer-remote-bridge` binary, and Bot Service. Those are named in the
 * deploy notes as the unexercised steps rather than papered over.
 */
import { describe, expect, it } from "vitest";
import { execPath } from "node:process";
import { nodeSpawnWatchFn } from "../spawn-watch";
import { parseWatchLine } from "../watch-line";

const APPROVAL = {
  type: "appeared",
  kind: "approval.requested",
  eventId: "approval.requested:chat-1:ap-1",
  epicId: "epic-1",
  chatId: "chat-1",
  chatTitle: "Acme RFP",
  approvalId: "ap-1",
  toolName: "edit_file",
  description: "write the thing",
  requestedAt: 1000,
};

/** Runs a snippet as a real child and collects everything the spawn reports. */
function runChild(script: string): Promise<{
  readonly lines: readonly string[];
  readonly stderr: readonly string[];
  readonly code: number | null;
}> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    const stderr: string[] = [];
    nodeSpawnWatchFn(
      execPath,
      ["-e", script],
      { env: process.env },
      {
        onLine: (line) => lines.push(line),
        onStderr: (chunk) => stderr.push(chunk),
        onExit: (code) => {
          resolve({ lines, stderr, code });
        },
      },
    );
  });
}

describe("nodeSpawnWatchFn — against a real child process", () => {
  it("CONTRACT: a JSON event split across real pipe writes arrives intact", async () => {
    /*
     * The split is forced mid-object and flushed as two separate writes with
     * a tick between them, so the kernel really does deliver two chunks. A
     * consumer that parsed chunks would see `malformed` here — intermittently
     * in production, load-dependently, and looking exactly like the bridge
     * emitting garbage.
     */
    const json = JSON.stringify(APPROVAL);
    const cut = Math.floor(json.length / 2);
    const script = `
      process.stdout.write(${JSON.stringify(json.slice(0, cut))});
      setTimeout(() => {
        process.stdout.write(${JSON.stringify(json.slice(cut))} + "\\n");
      }, 20);
    `;
    const result = await runChild(script);

    expect(result.lines).toHaveLength(1);
    const parsed = parseWatchLine(result.lines[0]);
    expect(parsed.kind).toBe("event");
    if (parsed.kind !== "event") return;
    expect(parsed.event.eventId).toBe("approval.requested:chat-1:ap-1");
    expect(result.code).toBe(0);
  });

  it("delivers several events written in one burst, in order", async () => {
    const script = `
      for (let i = 0; i < 5; i++) {
        process.stdout.write(JSON.stringify({ ...${JSON.stringify(APPROVAL)}, eventId: "e" + i }) + "\\n");
      }
    `;
    const result = await runChild(script);
    expect(result.lines).toHaveLength(5);
    const ids = result.lines.map((line) => {
      const parsed = parseWatchLine(line);
      return parsed.kind === "event" ? parsed.event.eventId : "?";
    });
    expect(ids).toEqual(["e0", "e1", "e2", "e3", "e4"]);
  });

  it("CONTRACT: a truncated final line is REPORTED, never parsed", async () => {
    // A half-written line is not an event, and guessing at one is how a
    // truncated payload becomes a wrong notification.
    const script = `process.stdout.write('{"type":"appea');`;
    const result = await runChild(script);

    expect(result.lines).toEqual([]);
    expect(result.stderr.join()).toContain("incomplete line");
  });

  it("reports a non-zero exit rather than swallowing it", async () => {
    const result = await runChild(`process.exit(3);`);
    expect(result.code).toBe(3);
  });

  it("CONTRACT: a missing binary reports an exit, so the runner can back off", async () => {
    /*
     * The most likely misconfiguration — a wrong `TRAYCER_REMOTE_BRIDGE_BIN` —
     * and `spawn` signals it with an `error` event that never fires `exit`.
     * Without the explicit handler the runner would sit in `starting` forever
     * and never retry, which is a bot that silently stops notifying.
     */
    const code = await new Promise<number | null>((resolve) => {
      nodeSpawnWatchFn(
        "/absolutely/not/a/real/binary-xyzzy",
        ["watch"],
        { env: process.env },
        {
          onLine: () => {},
          onStderr: () => {},
          onExit: resolve,
        },
      );
    });
    expect(code).toBeNull();
  });

  it("kill() stops the child", async () => {
    const exit = new Promise<number | null>((resolve) => {
      const child = nodeSpawnWatchFn(
        execPath,
        ["-e", "setInterval(() => {}, 1000);"],
        { env: process.env },
        {
          onLine: () => {},
          onStderr: () => {},
          onExit: resolve,
        },
      );
      setTimeout(() => {
        child.kill();
      }, 20);
    });
    // The code is platform-dependent on a signal; that it EXITS is the claim.
    await expect(exit).resolves.toBeDefined();
  });
});
