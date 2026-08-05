/**
 * HA-4 — the two-tier connection manager.
 *
 * Two layers of test here, deliberately separated:
 *
 * 1. `WatchingConnection` against a REAL `WsStreamClient` + a stub socket
 *    (mirrors `ws-stream-client.test.ts`'s own harness — no shared export
 *    exists to reuse, so this redefines the minimum). This is the wire-
 *    level evidence: the open frame a watching connection actually sends.
 * 2. `TwoTierHostConnectionManager`'s orchestration (promote/demote,
 *    degradation, the promotion-window unknown arm) against FAKE driving/
 *    watching connections injected via `TwoTierHostConnectionManagerDeps`.
 *    `HostStreamConnection` hardcodes a real socket factory internally
 *    (same reason `stream-connection.test.ts` mocks at the `WsStreamClient`
 *    level rather than constructing a real `HostStreamConnection`), so the
 *    manager's own bookkeeping is exercised through the same seam.
 *
 * Every mutation asserted below was round-tripped green → red → green by
 * hand against the source (removing the assertion's own guarantee and
 * confirming the test failed) before being kept — see the HA-4 report for
 * the specific mutations run outside this file (the type-level one especially,
 * since `@ts-expect-error` below is checked by `tsc`, not by vitest).
 */
import { describe, expect, it, vi } from "vitest";
import { buildStreamManifest } from "@traycer/protocol/framework/stream-compat";
import {
  createRequestContext,
  identityFromAuthenticatedUser,
  type RequestContext,
} from "@traycer/protocol/auth/request-context";
import { createAuthenticatedUserFixture } from "../../test-fixtures/authenticated-user";
import type {
  IStreamSession,
  StatusChangeHandler,
  StreamCloseReason,
  StreamConnectionStatus,
} from "../i-stream-session";
import type {
  IStreamWebSocketFactory,
  StreamWebSocketLike,
  StreamWebSocketMessageEvent,
} from "../ws-stream-factory";
import type {
  WebSocketCloseEvent,
  WebSocketErrorEvent,
  WebSocketOpenEvent,
} from "../ws-factory";
import { WsStreamClient } from "../ws-stream-client";
import type { HostStreamConnection } from "../single-host-stream-connection";
import type { StreamConnectionAuth } from "../single-host-stream-connection";
import { watchingStreamRpcRegistry } from "../watching-stream-registry";
import {
  describeTier,
  TwoTierHostConnectionManager,
  WatchingConnection,
  type ConnectionTier,
  type MachineEndpoint,
} from "../two-tier-host-connection";

// ---------------------------------------------------------------------------
// Wire-level harness — mirrors ws-stream-client.test.ts's own StubStreamWebSocket.
// ---------------------------------------------------------------------------

class StubStreamWebSocket implements StreamWebSocketLike {
  onopen: ((event: WebSocketOpenEvent) => void) | null = null;
  onmessage: ((event: StreamWebSocketMessageEvent) => void) | null = null;
  onerror: ((event: WebSocketErrorEvent) => void) | null = null;
  onclose: ((event: WebSocketCloseEvent) => void) | null = null;
  readonly textSent: string[] = [];

  send(data: string | Uint8Array): void {
    if (typeof data === "string") this.textSent.push(data);
  }
  close(): void {}
  fireOpen(): void {
    this.onopen?.({ type: "open" });
  }
  fireText(data: unknown): void {
    this.onmessage?.({ type: "text", data: JSON.stringify(data) });
  }
}

function makeFactory(): {
  readonly factory: IStreamWebSocketFactory;
  readonly sockets: StubStreamWebSocket[];
} {
  const sockets: StubStreamWebSocket[] = [];
  return {
    factory: {
      create(_url: string): StreamWebSocketLike {
        const socket = new StubStreamWebSocket();
        sockets.push(socket);
        return socket;
      },
    },
    sockets,
  };
}

function makeRequestContext(bearer: string): RequestContext {
  const fixture = createAuthenticatedUserFixture(undefined);
  return createRequestContext({
    identity: identityFromAuthenticatedUser(fixture),
    bearerToken: bearer,
    origin: "renderer",
    connectionId: undefined,
    operationId: undefined,
    externalAbortSignal: undefined,
  });
}

function makeAuth(bearer: string): StreamConnectionAuth {
  const ctx = makeRequestContext(bearer);
  return {
    current: () => ctx,
    onBearerRotated: () => () => undefined,
    revalidateCurrentContext: () => Promise.resolve(null),
  };
}

function parseText(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

const ENTRY_B: MachineEndpoint = {
  hostId: "machine-b",
  websocketUrl: "ws://127.0.0.1:4917/rpc",
};

describe("WatchingConnection — the restriction proving itself on the wire", () => {
  it("declares ONLY host.notifications.feed.subscribe in its open frame", async () => {
    const { factory, sockets } = makeFactory();
    const auth = makeAuth("token-b");

    const watching = new WatchingConnection(auth, ENTRY_B, factory);

    await Promise.resolve();
    expect(sockets).toHaveLength(1);
    sockets[0].fireOpen();

    expect(sockets[0].textSent).toHaveLength(1);
    const openFrame = parseText(sockets[0].textSent[0]);
    expect(openFrame.kind).toBe("open");

    // Hostile per verification-practices #8: assert the manifest's key set
    // WHOLE, not "contains the feed method" — a manifest carrying the feed
    // method PLUS epic.subscribe would still "contain" the right key.
    expect(Object.keys(openFrame.manifest as object)).toEqual([
      "host.notifications.feed.subscribe",
    ]);
    expect(openFrame.manifest).toEqual(
      buildStreamManifest(watchingStreamRpcRegistry),
    );

    watching.close("test-teardown");
  });

  // Type-level companion to the wire-level test above, checked by `tsc`
  // (this package's own `compile` script), NOT by vitest — vitest transpiles
  // test files without typechecking them. Verified in isolation before being
  // kept: pasting this exact call into the source file and running
  // `tsc --noEmit` produced exactly one error,
  // `TS2345: Argument of type '"epic.subscribe"' is not assignable to
  // parameter of type '"host.notifications.feed.subscribe"'` — the only
  // reason it fails is the missing key, not a params-shape mismatch (per
  // hollow-green-checks #16's warning that a `@ts-expect-error` can be
  // satisfied by an unrelated reason).
  it("cannot even name epic.subscribe on a watching-tier client (type-level, checked by tsc)", () => {
    // Body is never CALLED — vitest transpiles without typechecking, so an
    // invoked line here would throw at runtime against a real client for no
    // reason relevant to this test. `tsc` (this package's `compile` script)
    // still checks the function body regardless of whether it runs.
    function typeOnlyAssertion(
      client: WsStreamClient<typeof watchingStreamRpcRegistry>,
    ): void {
      // @ts-expect-error -- "epic.subscribe" is not a key of WatchingStreamRpcRegistry
      client.subscribe("epic.subscribe", { epicId: "x" });
    }
    void typeOnlyAssertion;
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Manager orchestration — fake driving/watching connections via deps.
// ---------------------------------------------------------------------------

class FakeSession implements IStreamSession {
  private statusHandler: StatusChangeHandler | null = null;
  sendClientFrame(): void {}
  onServerFrame(): void {}
  onStatusChange(handler: StatusChangeHandler): void {
    this.statusHandler = handler;
  }
  requestReconnect(): void {}
  close(): void {}
  emitStatus(
    status: StreamConnectionStatus,
    reason: StreamCloseReason | null = null,
  ): void {
    this.statusHandler?.(status, reason);
  }
}

interface FakeDrivingHandle {
  readonly connection: HostStreamConnection;
  readonly session: FakeSession;
  readonly closeSpy: ReturnType<typeof vi.fn>;
}

function fakeDrivingFactory(): {
  readonly createDriving: (
    auth: StreamConnectionAuth,
    entry: MachineEndpoint,
  ) => HostStreamConnection;
  readonly byHostId: Map<string, FakeDrivingHandle>;
} {
  const byHostId = new Map<string, FakeDrivingHandle>();
  const createDriving = (
    _auth: StreamConnectionAuth,
    entry: MachineEndpoint,
  ): HostStreamConnection => {
    const session = new FakeSession();
    const closeSpy = vi.fn();
    const client = {
      subscribe: vi.fn(() => session),
    } as unknown as HostStreamConnection["client"];
    const connection = { client, close: closeSpy } as unknown as HostStreamConnection;
    byHostId.set(entry.hostId, { connection, session, closeSpy });
    return connection;
  };
  return { createDriving, byHostId };
}

interface FakeWatchingHandle {
  readonly connection: WatchingConnection;
  readonly closeSpy: ReturnType<typeof vi.fn>;
}

function fakeWatchingFactory(): {
  readonly createWatching: (
    auth: StreamConnectionAuth,
    entry: MachineEndpoint,
  ) => WatchingConnection;
  readonly byHostId: Map<string, FakeWatchingHandle>;
} {
  const byHostId = new Map<string, FakeWatchingHandle>();
  const createWatching = (
    _auth: StreamConnectionAuth,
    entry: MachineEndpoint,
  ): WatchingConnection => {
    const closeSpy = vi.fn();
    const connection = { hostId: entry.hostId, close: closeSpy } as unknown as WatchingConnection;
    byHostId.set(entry.hostId, { connection, closeSpy });
    return connection;
  };
  return { createWatching, byHostId };
}

const ENTRY_A: MachineEndpoint = { hostId: "machine-a", websocketUrl: "ws://a/rpc" };
const ENTRY_C: MachineEndpoint = { hostId: "machine-c", websocketUrl: "ws://c/rpc" };

describe("TwoTierHostConnectionManager — setKnownMachines degradation", () => {
  it("starts with zero watching connections when given none (today's shape)", () => {
    const auth = makeAuth("t");
    const { createDriving } = fakeDrivingFactory();
    const manager = new TwoTierHostConnectionManager(auth, ENTRY_A, {
      createDriving,
    });

    expect(manager.watchingHostIds()).toEqual([]);
    expect(manager.tierFor(ENTRY_A.hostId)).toBe("driving");
  });

  it("setKnownMachines([]) closes every existing watching connection — the property that makes shipping ahead of HA-2 safe", () => {
    const auth = makeAuth("t");
    const { createDriving } = fakeDrivingFactory();
    const { createWatching, byHostId } = fakeWatchingFactory();
    const manager = new TwoTierHostConnectionManager(auth, ENTRY_A, {
      createDriving,
      createWatching,
    });

    manager.setKnownMachines([
      { ...ENTRY_B, label: "B", kind: "remote", version: null, status: "available" },
      { ...ENTRY_C, label: "C", kind: "remote", version: null, status: "available" },
    ]);
    expect([...manager.watchingHostIds()].sort()).toEqual(["machine-b", "machine-c"]);

    const closeB = byHostId.get("machine-b")!.closeSpy;
    const closeC = byHostId.get("machine-c")!.closeSpy;
    expect(closeB).not.toHaveBeenCalled();
    expect(closeC).not.toHaveBeenCalled();

    manager.setKnownMachines([]);

    expect(manager.watchingHostIds()).toEqual([]);
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(closeC).toHaveBeenCalledTimes(1);
    // Degraded shape now matches a fresh manager constructed with no
    // directory at all — the actual claim, not just "the map is empty".
    expect(manager.tierFor("machine-b")).toBe("unknown");
    expect(manager.tierFor("machine-c")).toBe("unknown");
    expect(manager.tierFor(ENTRY_A.hostId)).toBe("driving");
  });

  it("never gives the driving machine a watching entry of its own", () => {
    const auth = makeAuth("t");
    const { createDriving } = fakeDrivingFactory();
    const { createWatching } = fakeWatchingFactory();
    const manager = new TwoTierHostConnectionManager(auth, ENTRY_A, {
      createDriving,
      createWatching,
    });

    manager.setKnownMachines([
      { ...ENTRY_A, label: "A", kind: "remote", version: null, status: "available" },
      { ...ENTRY_B, label: "B", kind: "remote", version: null, status: "available" },
    ]);

    expect(manager.watchingHostIds()).toEqual(["machine-b"]);
  });
});

describe("TwoTierHostConnectionManager — promote()", () => {
  it("promoting the current driving machine is a no-op", async () => {
    const auth = makeAuth("t");
    const { createDriving } = fakeDrivingFactory();
    const manager = new TwoTierHostConnectionManager(auth, ENTRY_A, {
      createDriving,
    });

    const result = await manager.promote({
      ...ENTRY_A,
      label: "A",
      kind: "remote",
      version: null,
      status: "available",
    });
    expect(result.elapsedMs).toBe(0);
    expect(manager.drivingHostId).toBe(ENTRY_A.hostId);
  });

  it("the promotion window: BOTH machines read 'promoting', neither reads a binary tier, until the dial settles", async () => {
    const auth = makeAuth("t");
    const { createDriving, byHostId: drivingByHostId } = fakeDrivingFactory();
    const { createWatching } = fakeWatchingFactory();
    const manager = new TwoTierHostConnectionManager(auth, ENTRY_A, {
      createDriving,
      createWatching,
    });

    const promotion = manager.promote({
      ...ENTRY_B,
      label: "B",
      kind: "remote",
      version: null,
      status: "available",
    });

    // Synchronous portion of promote() has run; the new driving client's
    // dial has not yet reported "live".
    expect(manager.tierFor(ENTRY_A.hostId)).toBe("promoting");
    expect(manager.tierFor(ENTRY_B.hostId)).toBe("promoting");
    // The unknown-arm claim, made concrete: neither a naive "is it driving"
    // nor "is it watching" read is true for either machine right now.
    const readAsBoolean = (id: string): boolean =>
      manager.tierFor(id) === "driving";
    expect(readAsBoolean(ENTRY_A.hostId)).toBe(false);
    expect(readAsBoolean(ENTRY_B.hostId)).toBe(false);

    drivingByHostId.get(ENTRY_B.hostId)!.session.emitStatus("open", null);
    await promotion;

    expect(manager.tierFor(ENTRY_B.hostId)).toBe("driving");
    expect(manager.tierFor(ENTRY_A.hostId)).toBe("watching");
  });

  it("closes the demoted machine's full-registry client and re-creates it as watching — the actual 'at most one driving' invariant", async () => {
    const auth = makeAuth("t");
    const { createDriving, byHostId: drivingByHostId } = fakeDrivingFactory();
    const { createWatching, byHostId: watchingByHostId } = fakeWatchingFactory();
    const manager = new TwoTierHostConnectionManager(auth, ENTRY_A, {
      createDriving,
      createWatching,
    });
    // Captured BEFORE promoting: this is the fake `createDriving` produced
    // for A at CONSTRUCTION time. `createDriving` is never called for A a
    // second time — the whole point is that this exact original handle is
    // the one that must be torn down, not a fresh substitute for it.
    const closeSpyA = drivingByHostId.get(ENTRY_A.hostId)!.closeSpy;

    const promotion = manager.promote({
      ...ENTRY_B,
      label: "B",
      kind: "remote",
      version: null,
      status: "available",
    });
    drivingByHostId.get(ENTRY_B.hostId)!.session.emitStatus("open", null);
    const result = await promotion;

    expect(typeof result.elapsedMs).toBe("number");
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);

    // The OLD driving connection's (A's) full-registry client was closed —
    // not left open alongside the new one. This is the real "at most one
    // driving" invariant: not that the field is singular (trivially true),
    // but that only one LIVE full-registry client is ever open.
    expect(closeSpyA).toHaveBeenCalledWith("demoted");
    expect(manager.drivingHostId).toBe(ENTRY_B.hostId);
    // A now has a watching connection — the demote half of promote/demote.
    expect(manager.watchingHostIds()).toEqual([ENTRY_A.hostId]);
    expect(watchingByHostId.get(ENTRY_A.hostId)).toBeDefined();
  });

  it("rejects a second promote() while one is already in flight", async () => {
    const auth = makeAuth("t");
    const { createDriving, byHostId: drivingByHostId } = fakeDrivingFactory();
    const { createWatching } = fakeWatchingFactory();
    const manager = new TwoTierHostConnectionManager(auth, ENTRY_A, {
      createDriving,
      createWatching,
    });

    const first = manager.promote({
      ...ENTRY_B,
      label: "B",
      kind: "remote",
      version: null,
      status: "available",
    });

    await expect(
      manager.promote({
        ...ENTRY_C,
        label: "C",
        kind: "remote",
        version: null,
        status: "available",
      }),
    ).rejects.toThrow(/already in flight/);

    drivingByHostId.get(ENTRY_B.hostId)!.session.emitStatus("open", null);
    await first;
  });

  it("a dial that never reports live leaves the manager on the ORIGINAL driving machine, not a half-promoted one", async () => {
    const auth = makeAuth("t");
    const { createDriving, byHostId: drivingByHostId } = fakeDrivingFactory();
    const closeSpyFor = (id: string) => drivingByHostId.get(id)!.closeSpy;
    const manager = new TwoTierHostConnectionManager(auth, ENTRY_A, {
      createDriving,
      promoteDialTimeoutMs: 20,
    });

    await expect(
      manager.promote({
        ...ENTRY_B,
        label: "B",
        kind: "remote",
        version: null,
        status: "available",
      }),
    ).rejects.toThrow(/did not report live/);

    expect(manager.drivingHostId).toBe(ENTRY_A.hostId);
    expect(manager.tierFor(ENTRY_A.hostId)).toBe("driving");
    // The failed dial's client was closed rather than left dangling.
    expect(closeSpyFor(ENTRY_B.hostId)).toHaveBeenCalledWith(
      "promotion-dial-failed",
    );
  });
});

describe("describeTier — exhaustive by construction", () => {
  it.each<[ConnectionTier, string]>([
    ["driving", "driving"],
    ["watching", "watching"],
    ["promoting", "promoting"],
    ["unknown", "unknown"],
  ])("routes %s to its own branch", (tier, expected) => {
    const result = describeTier(tier, {
      driving: () => "driving",
      watching: () => "watching",
      promoting: () => "promoting",
      unknown: () => "unknown",
    });
    expect(result).toBe(expected);
  });
});
