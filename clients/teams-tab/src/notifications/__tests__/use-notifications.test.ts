/**
 * @vitest-environment jsdom
 *
 * The hook's one non-obvious rule: WHICH FRAMES END `loading`.
 *
 * A `pong` is a keepalive and a `channelEmission` is an external delivery
 * (toast / push / webhook). Neither is feed state, and `applyFeedFrame`
 * correctly returns the state unchanged for both. The bug this file pins was
 * one layer up: publishing anyway, which turned the first heartbeat into
 * `{ kind: "ready", entries: [], summary: null }` — rendered by the
 * notifications screen as "You're all caught up." and by the waiting screen as
 * "Nothing is waiting on you."
 *
 * That is a confident answer produced by having been told nothing, on the two
 * surfaces where being wrong in that direction matters most. It was found in
 * the preview images rather than here, which is why it gets a test now.
 */
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { HostStreamConnection } from "@traycer-clients/shared/host-transport/single-host-stream-connection";
import type {
  IStreamSession,
  ServerFrameHandler,
  StreamFrameEnvelope,
} from "@traycer-clients/shared/host-transport/i-stream-session";
import { useNotifications } from "../use-notifications";

interface FakeStream {
  readonly connection: HostStreamConnection;
  readonly emit: (frame: unknown) => void;
  readonly closed: () => number;
}

/**
 * A stream whose frames this test pushes by hand.
 *
 * The session is a REAL `IStreamSession` — all five members implemented — so
 * it needs no assertion at all. Only the connection wrapper gets one, because
 * the hook touches exactly `connection.client.subscribe` and nothing else.
 * That is the difference between narrowing and the chained `as unknown as`
 * this package's lint rule refuses: erase one seam, not the whole object.
 */
function fakeStream(): FakeStream {
  let handler: ServerFrameHandler | null = null;
  let closes = 0;
  const session: IStreamSession = {
    sendClientFrame() {},
    onServerFrame(cb) {
      handler = cb;
    },
    onStatusChange() {},
    requestReconnect() {},
    close() {
      closes += 1;
    },
  };
  /*
   * THE ONE ERASURE, and it is deliberate rather than lazy.
   *
   * `HostStreamConnection.client` is a concrete `WsStreamClient` carrying
   * `instanceId`, `options`, `ownedSessions`, `methodSupport` and fifteen
   * more members. The hook touches exactly one of them — `subscribe` — so a
   * faithful fake would stub twenty fields to exercise one, and every one of
   * those stubs would be a lie the compiler checked.
   *
   * The structural fix is a narrow injectable type, the way
   * `epic-list.ts` declares `EpicListClient = Pick<HostRequester, "request">`
   * for exactly this reason. The stream side has no such seam and adding one
   * is a change to the hook's signature and its call site, which is a larger
   * edit than this test should smuggle in. Recorded here as the reason the
   * rule is suppressed rather than satisfied.
   */
  /* eslint-disable no-restricted-syntax -- see above: no narrow stream-client
     seam exists yet, unlike `EpicListClient` on the unary side. A BLOCK
     disable, not `-next-line`: the assertion spans three lines and the
     directive's "next line" was the second line of its own justification
     comment, so the rule kept firing and the suppression silently did
     nothing. */
  const connection = {
    client: { subscribe: vi.fn(() => session) },
  } as unknown as HostStreamConnection;
  /* eslint-enable no-restricted-syntax */
  return {
    connection,
    emit: (frame) => {
      handler?.(frame as StreamFrameEnvelope, null);
    },
    closed: () => closes,
  };
}

/**
 * `hasBinaryPayload: false` is on EVERY frame in this union, `pong` included.
 *
 * Worth its own note: the first version of this file omitted it, so the
 * heartbeat below failed the schema and was dropped as malformed — and the
 * "stays loading" assertion passed for entirely the wrong reason, proving the
 * safeParse guard rather than the fix it was written for. A test that passes
 * before AND after the change it exists to pin is the defect this project
 * keeps finding, arriving in the test written to prevent it.
 */
const PONG = { kind: "pong", hasBinaryPayload: false };

const SNAPSHOT = {
  kind: "snapshot",
  hasBinaryPayload: false,
  attention: { entries: [], nextCursor: null },
  recent: { entries: [], nextCursor: null },
  summary: { unreadCount: 0, attentionCount: 0 },
};

describe("useNotifications", () => {
  it("stays LOADING through a heartbeat that arrives before the snapshot", () => {
    const stream = fakeStream();
    const { result } = renderHook(() =>
      useNotifications(stream.connection, null),
    );
    expect(result.current.kind).toBe("loading");

    act(() => {
      stream.emit(PONG);
    });

    // The assertion that matters. `ready` here would render "You're all
    // caught up." on the strength of a keepalive.
    expect(result.current.kind).toBe("loading");
  });

  it("becomes ready on the snapshot, carrying the host's summary", () => {
    const stream = fakeStream();
    const { result } = renderHook(() =>
      useNotifications(stream.connection, null),
    );
    act(() => {
      stream.emit(PONG);
      stream.emit(SNAPSHOT);
    });
    expect(result.current.kind).toBe("ready");
    if (result.current.kind !== "ready") throw new Error("unreachable");
    expect(result.current.summary).toEqual({ unreadCount: 0, attentionCount: 0 });
  });

  /**
   * A malformed frame is dropped, not fatal — one bad row must not take down
   * the only screen that lists what needs a human. It must also not be
   * mistaken for data.
   */
  it("stays loading on a frame that fails the schema", () => {
    const stream = fakeStream();
    const { result } = renderHook(() =>
      useNotifications(stream.connection, null),
    );
    act(() => {
      stream.emit({ kind: "snapshot", attention: "not an object" });
    });
    expect(result.current.kind).toBe("loading");
  });

  it("reports an error rather than loading forever when there is no host", () => {
    const { result } = renderHook(() => useNotifications(null, null));
    expect(result.current.kind).toBe("error");
  });

  it("closes the subscription on unmount", () => {
    const stream = fakeStream();
    const { unmount } = renderHook(() =>
      useNotifications(stream.connection, null),
    );
    expect(stream.closed()).toBe(0);
    unmount();
    expect(stream.closed()).toBe(1);
  });
});
