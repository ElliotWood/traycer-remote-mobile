import { describe, expect, it } from "vitest";
import {
  createWatchRunner,
  HEALTHY_RUN_MS,
  RESTART_DELAYS_MS,
  type SpawnWatchFn,
  type WatchProcessHandlers,
} from "../watch-runner";
import { LineBuffer } from "../spawn-watch";
import type { WatchEvent } from "../watch-line";

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

/** A controllable clock and scheduler, so nothing here waits on real time. */
interface FakeClock {
  readonly now: () => number;
  readonly schedule: (fn: () => void, ms: number) => { cancel: () => void };
  /** Runs everything due at or before `now + ms`. */
  readonly advance: (ms: number) => void;
  readonly pendingCount: () => number;
}

function fakeClock(): FakeClock {
  let nowMs = 0;
  const pending: { at: number; fn: () => void; cancelled: boolean }[] = [];
  return {
    now: (): number => nowMs,
    schedule: (fn: () => void, ms: number): { cancel: () => void } => {
      const entry = { at: nowMs + ms, fn, cancelled: false };
      pending.push(entry);
      return {
        cancel: (): void => {
          entry.cancelled = true;
        },
      };
    },
    /** Runs everything due at or before `nowMs + ms`. */
    advance: (ms: number): void => {
      nowMs += ms;
      for (const entry of [...pending]) {
        if (!entry.cancelled && entry.at <= nowMs) {
          entry.cancelled = true;
          entry.fn();
        }
      }
    },
    pendingCount: (): number => pending.filter((e) => !e.cancelled).length,
  };
}

interface SpawnRecord {
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly handlers: WatchProcessHandlers;
  killed: boolean;
}

function fakeSpawn(): { fn: SpawnWatchFn; spawns: SpawnRecord[] } {
  const spawns: SpawnRecord[] = [];
  const fn: SpawnWatchFn = (_command, args, options, handlers) => {
    const record: SpawnRecord = {
      args,
      env: options.env,
      handlers,
      killed: false,
    };
    spawns.push(record);
    return {
      kill: (): void => {
        record.killed = true;
      },
    };
  };
  return { fn, spawns };
}

function runner(overrides: {
  readonly spawn: SpawnWatchFn;
  readonly clock: FakeClock;
  readonly onEvent: (event: WatchEvent) => Promise<void>;
  readonly buildEnv: () => Promise<NodeJS.ProcessEnv | null>;
  readonly warnings: string[];
}) {
  return createWatchRunner({
    command: "/absolute/traycer-remote-bridge",
    epicId: "epic-1",
    buildEnv: overrides.buildEnv,
    spawnWatch: overrides.spawn,
    onEvent: overrides.onEvent,
    onInfo: () => {},
    onWarn: (message, detail) => overrides.warnings.push(`${message}|${detail}`),
    schedule: overrides.clock.schedule,
    now: overrides.clock.now,
  });
}

const envOk = async (): Promise<NodeJS.ProcessEnv> => ({ TRAYCER_EPIC_ID: "epic-1" });

/** Lets the runner's internal promise chain drain. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("watch-runner — it actually runs the watcher", () => {
  it("spawns `watch` for the configured epic, with the tenant env", async () => {
    const { fn, spawns } = fakeSpawn();
    const clock = fakeClock();
    const r = runner({
      spawn: fn,
      clock,
      onEvent: async () => {},
      buildEnv: envOk,
      warnings: [],
    });
    r.start();
    await settle();

    expect(spawns).toHaveLength(1);
    expect(spawns[0].args).toEqual(["watch", "--epic-id", "epic-1"]);
    expect(spawns[0].env.TRAYCER_EPIC_ID).toBe("epic-1");
    r.stop();
  });

  it("parses a line and hands the event on", async () => {
    const { fn, spawns } = fakeSpawn();
    const clock = fakeClock();
    const seen: WatchEvent[] = [];
    const r = runner({
      spawn: fn,
      clock,
      onEvent: async (event) => {
        seen.push(event);
      },
      buildEnv: envOk,
      warnings: [],
    });
    r.start();
    await settle();

    spawns[0].handlers.onLine(JSON.stringify(APPROVAL));
    await settle();

    expect(seen).toHaveLength(1);
    expect(seen[0].eventId).toBe("approval.requested:chat-1:ap-1");
    r.stop();
  });

  it("CONTRACT: events are handled ONE AT A TIME, never concurrently", async () => {
    /*
     * `pushWatchEvent` reads the sent-set, sends, then writes it. Two of
     * those running at once on the same id interleave the read and the write
     * and send twice — and a burst of lines from one poll tick makes that the
     * normal case, not a rare one.
     *
     * Asserted by observing overlap directly rather than by counting: a
     * counter would pass on a handler that happened to finish fast.
     */
    const { fn, spawns } = fakeSpawn();
    const clock = fakeClock();
    let inFlight = 0;
    let maxInFlight = 0;
    const r = runner({
      spawn: fn,
      clock,
      onEvent: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((res) => setTimeout(res, 1));
        inFlight -= 1;
      },
      buildEnv: envOk,
      warnings: [],
    });
    r.start();
    await settle();

    for (let i = 0; i < 5; i++) {
      spawns[0].handlers.onLine(
        JSON.stringify({ ...APPROVAL, eventId: `e${String(i)}` }),
      );
    }
    await new Promise((res) => setTimeout(res, 50));

    expect(maxInFlight).toBe(1);
    r.stop();
  });

  it("a handler that throws does not break the chain for later events", async () => {
    // An event lost is one missed notification. A dead chain is every future
    // notification.
    const { fn, spawns } = fakeSpawn();
    const clock = fakeClock();
    const warnings: string[] = [];
    const seen: string[] = [];
    const r = runner({
      spawn: fn,
      clock,
      onEvent: async (event) => {
        if (event.eventId === "bad") throw new Error("boom");
        seen.push(event.eventId);
      },
      buildEnv: envOk,
      warnings,
    });
    r.start();
    await settle();

    spawns[0].handlers.onLine(JSON.stringify({ ...APPROVAL, eventId: "bad" }));
    spawns[0].handlers.onLine(JSON.stringify({ ...APPROVAL, eventId: "good" }));
    await settle();
    await settle();

    expect(seen).toEqual(["good"]);
    expect(warnings.join()).toContain("notification lost");
    r.stop();
  });

  it("CONTRACT: a malformed line WARNS rather than being quietly skipped", async () => {
    // The bridge said something this bot cannot read, which means somebody is
    // blocked and will never be told. A blank line, by contrast, is routine.
    const { fn, spawns } = fakeSpawn();
    const clock = fakeClock();
    const warnings: string[] = [];
    const r = runner({
      spawn: fn,
      clock,
      onEvent: async () => {},
      buildEnv: envOk,
      warnings,
    });
    r.start();
    await settle();

    spawns[0].handlers.onLine("{not json");
    spawns[0].handlers.onLine("   ");
    await settle();

    expect(warnings.filter((w) => w.includes("unreadable line"))).toHaveLength(1);
    r.stop();
  });
});

describe("watch-runner — lifecycle", () => {
  it("restarts after the child exits, with a backoff", async () => {
    const { fn, spawns } = fakeSpawn();
    const clock = fakeClock();
    const r = runner({
      spawn: fn,
      clock,
      onEvent: async () => {},
      buildEnv: envOk,
      warnings: [],
    });
    r.start();
    await settle();
    expect(spawns).toHaveLength(1);

    spawns[0].handlers.onExit(1);
    expect(r.state()).toBe("waiting");
    // Not yet — the delay has to elapse.
    clock.advance(RESTART_DELAYS_MS[0] - 1);
    await settle();
    expect(spawns).toHaveLength(1);

    clock.advance(1);
    await settle();
    expect(spawns).toHaveLength(2);
    r.stop();
  });

  it("CONTRACT: exit code 0 also restarts — there is no clean way to stop watching", async () => {
    // A watcher that exits 0 has still stopped watching. Treating 0 as "done"
    // is how notifications stop silently and permanently.
    const { fn, spawns } = fakeSpawn();
    const clock = fakeClock();
    const r = runner({
      spawn: fn,
      clock,
      onEvent: async () => {},
      buildEnv: envOk,
      warnings: [],
    });
    r.start();
    await settle();
    spawns[0].handlers.onExit(0);
    clock.advance(RESTART_DELAYS_MS[0]);
    await settle();
    expect(spawns).toHaveLength(2);
    r.stop();
  });

  it("backs off further on repeated failure, and resets after a healthy run", async () => {
    const { fn, spawns } = fakeSpawn();
    const clock = fakeClock();
    const r = runner({
      spawn: fn,
      clock,
      onEvent: async () => {},
      buildEnv: envOk,
      warnings: [],
    });
    r.start();
    await settle();

    // Two immediate failures: the second waits longer than the first.
    spawns[0].handlers.onExit(1);
    clock.advance(RESTART_DELAYS_MS[0]);
    await settle();
    expect(spawns).toHaveLength(2);

    spawns[1].handlers.onExit(1);
    clock.advance(RESTART_DELAYS_MS[0]);
    await settle();
    expect(spawns, "second failure must wait longer than the first").toHaveLength(2);
    clock.advance(RESTART_DELAYS_MS[1] - RESTART_DELAYS_MS[0]);
    await settle();
    expect(spawns).toHaveLength(3);

    /*
     * Now a HEALTHY run, then a failure. Without the reset, a watcher that
     * ran happily for a week would wait five minutes to come back from one
     * blip, because the backoff index never went home.
     */
    clock.advance(HEALTHY_RUN_MS);
    spawns[2].handlers.onExit(1);
    clock.advance(RESTART_DELAYS_MS[0]);
    await settle();
    expect(spawns, "a healthy run resets the backoff").toHaveLength(4);
    r.stop();
  });

  it("CONTRACT: an unresolved identity backs off rather than abandoning", async () => {
    /*
     * The realistic cause is a token that expired and will be refreshed.
     * Giving up would mean a bot that silently stops notifying forever after
     * one blip — the failure being fixed, reintroduced one layer up. It is
     * loud every time, because the other realistic cause is that SSO was
     * never configured.
     */
    const { fn, spawns } = fakeSpawn();
    const clock = fakeClock();
    const warnings: string[] = [];
    const r = runner({
      spawn: fn,
      clock,
      onEvent: async () => {},
      buildEnv: async () => null,
      warnings,
    });
    r.start();
    await settle();

    expect(spawns).toHaveLength(0);
    expect(warnings.join()).toContain("identity unresolved");
    clock.advance(RESTART_DELAYS_MS[0]);
    await settle();
    expect(warnings.filter((w) => w.includes("identity unresolved"))).toHaveLength(2);
    r.stop();
  });

  it("stop() kills the child and cancels a pending restart", async () => {
    const { fn, spawns } = fakeSpawn();
    const clock = fakeClock();
    const r = runner({
      spawn: fn,
      clock,
      onEvent: async () => {},
      buildEnv: envOk,
      warnings: [],
    });
    r.start();
    await settle();
    r.stop();
    expect(spawns[0].killed).toBe(true);

    // And the kill's own exit callback must not schedule a restart — the flag
    // is set before the kill precisely so a deliberate shutdown stays down.
    spawns[0].handlers.onExit(null);
    expect(clock.pendingCount()).toBe(0);
    clock.advance(RESTART_DELAYS_MS[RESTART_DELAYS_MS.length - 1]);
    await settle();
    expect(spawns).toHaveLength(1);
  });

  it("start() twice does not produce two watchers", async () => {
    const { fn, spawns } = fakeSpawn();
    const clock = fakeClock();
    const r = runner({
      spawn: fn,
      clock,
      onEvent: async () => {},
      buildEnv: envOk,
      warnings: [],
    });
    r.start();
    r.start();
    await settle();
    expect(spawns).toHaveLength(1);
    r.stop();
  });
});

describe("LineBuffer — a chunk boundary must not corrupt an event", () => {
  it("CONTRACT: a JSON object split across chunks arrives as one line", () => {
    /*
     * `child.stdout` emits chunks, not lines, and a boundary can fall
     * anywhere. Parsing chunks directly would report `malformed` for a
     * perfectly good event — intermittently, load-dependently, and looking
     * exactly like the bridge emitting garbage.
     */
    const buffer = new LineBuffer();
    const json = JSON.stringify(APPROVAL);
    const cut = Math.floor(json.length / 2);

    expect(buffer.push(json.slice(0, cut))).toEqual([]);
    expect(buffer.push(`${json.slice(cut)}\n`)).toEqual([json]);
    expect(buffer.remainder()).toBe("");
  });

  it("returns every complete line in a chunk carrying several", () => {
    const buffer = new LineBuffer();
    expect(buffer.push("a\nb\nc")).toEqual(["a", "b"]);
    expect(buffer.remainder()).toBe("c");
  });

  it("strips a trailing CR, so a CRLF producer is not all-malformed", () => {
    // The bridge writes `\n`, but this is a pipe from another process and
    // assuming its line ending is how a Windows-hosted bridge would break
    // every single event with no error anywhere.
    const buffer = new LineBuffer();
    expect(buffer.push('{"a":1}\r\n')).toEqual(['{"a":1}']);
  });

  it("holds a partial tail rather than emitting it", () => {
    const buffer = new LineBuffer();
    expect(buffer.push('{"partial"')).toEqual([]);
    expect(buffer.remainder()).toBe('{"partial"');
  });
});
