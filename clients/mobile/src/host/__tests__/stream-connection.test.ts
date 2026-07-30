/**
 * Connection-state surface for the mobile `/stream` transport (T3).
 *
 * Drives the transport-status → UI-state projection with a MOCK `WsStreamClient`
 * (no real socket): opening a chat session and firing status transitions through
 * the mock session proves open→live, drop→reconnecting, close→disconnected, that
 * the caller's own `onConnectionStatus` still fires alongside, and that the
 * `StreamConnectionStateStore` notifies subscribers only on a real change. Also
 * pins `createStreamAuthRevalidator`'s outcome mapping.
 */
import { describe, expect, it, vi } from "vitest";
import type {
  IStreamSession,
  ServerFrameHandler,
  StatusChangeHandler,
  StreamCloseReason,
  StreamConnectionStatus,
} from "@traycer-clients/shared/host-transport/i-stream-session";
import type { WsStreamClient } from "@traycer-clients/shared/host-transport/ws-stream-client";
import type { HostStreamRpcRegistry } from "@traycer/protocol/host/registry";
import type { ChatStreamCallbacks } from "@traycer-clients/shared/host-transport/chat-stream-client";
import type { AuthIdentityValidationResult } from "@traycer-clients/shared/auth/auth-validation";
import {
  createStreamAuthRevalidator,
  openChatStream,
  StreamConnectionStateStore,
  toConnectionState,
} from "../stream-connection";
import type { MobileAuthService } from "@traycer-clients/shared/auth/browser-device-auth-service";

/** A minimal `IStreamSession` that just records handlers and lets a test emit. */
class MockStreamSession implements IStreamSession {
  private statusHandler: StatusChangeHandler | null = null;

  sendClientFrame(): void {}
  onServerFrame(_handler: ServerFrameHandler): void {}
  onStatusChange(handler: StatusChangeHandler): void {
    this.statusHandler = handler;
  }
  requestReconnect(): void {}
  close(): void {}

  emitStatus(
    status: StreamConnectionStatus,
    reason: StreamCloseReason | null,
  ): void {
    this.statusHandler?.(status, reason);
  }
}

/**
 * A stand-in `WsStreamClient` whose `subscribe` hands back one mock session. The
 * chat wrapper only ever calls `subscribe(...)` on the client, so this is enough
 * to exercise the full connection-state path with no socket.
 */
function mockWsStreamClient(session: MockStreamSession): {
  readonly client: WsStreamClient<HostStreamRpcRegistry>;
  readonly subscribe: ReturnType<typeof vi.fn>;
} {
  const subscribe = vi.fn(() => session);
  const client = { subscribe } as unknown as WsStreamClient<HostStreamRpcRegistry>;
  return { client, subscribe };
}

describe("toConnectionState", () => {
  it("collapses the four transport statuses to three UI states", () => {
    expect(toConnectionState("open")).toBe("live");
    expect(toConnectionState("connecting")).toBe("reconnecting");
    expect(toConnectionState("reconnecting")).toBe("reconnecting");
    expect(toConnectionState("closed")).toBe("disconnected");
  });
});

describe("StreamConnectionStateStore", () => {
  it("starts reconnecting and notifies subscribers only on a real change", () => {
    const store = new StreamConnectionStateStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    expect(store.getState()).toBe("reconnecting");

    // connecting → still "reconnecting": no state change, no notification.
    store.applyStatus("connecting", null);
    expect(store.getState()).toBe("reconnecting");
    expect(listener).not.toHaveBeenCalled();

    store.applyStatus("open", null);
    expect(store.getState()).toBe("live");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.applyStatus("closed", { kind: "caller" });
    expect(store.getState()).toBe("disconnected");
    // Still only the one call — the unsubscribed listener does not fire.
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.reason()).toEqual({ kind: "caller" });
  });
});

describe("openChatStream connection-state surface", () => {
  it("maps open→live, drop→reconnecting, close→disconnected and forwards to the caller", () => {
    const session = new MockStreamSession();
    const { client, subscribe } = mockWsStreamClient(session);

    const seen: Array<{
      status: StreamConnectionStatus;
      reason: StreamCloseReason | null;
    }> = [];
    const callbacks = {
      onConnectionStatus: (
        status: StreamConnectionStatus,
        reason: StreamCloseReason | null,
      ) => seen.push({ status, reason }),
    } as unknown as ChatStreamCallbacks;

    const { connection } = openChatStream(client, {
      epicId: "epic-1",
      chatId: "chat-1",
      callbacks,
    });

    expect(subscribe).toHaveBeenCalledWith("chat.subscribe", {
      epicId: "epic-1",
      chatId: "chat-1",
    });
    expect(connection.getState()).toBe("reconnecting");

    session.emitStatus("open", null);
    expect(connection.getState()).toBe("live");

    // A transport drop: the raw client re-declares the method and reports
    // "reconnecting" while it backs off.
    session.emitStatus("reconnecting", null);
    expect(connection.getState()).toBe("reconnecting");

    const fatal: StreamCloseReason = { kind: "caller" };
    session.emitStatus("closed", fatal);
    expect(connection.getState()).toBe("disconnected");

    // The caller's own status callback still saw every raw transition.
    expect(seen).toEqual([
      { status: "open", reason: null },
      { status: "reconnecting", reason: null },
      { status: "closed", reason: fatal },
    ]);
  });
});

describe("createStreamAuthRevalidator", () => {
  // The revalidator reads only `outcome.kind`, so a cast stub is faithful.
  function revalidatorOver(
    outcome: AuthIdentityValidationResult | null,
  ): ReturnType<typeof createStreamAuthRevalidator> {
    const auth = {
      revalidateCurrentContext: () => Promise.resolve(outcome),
    } as unknown as MobileAuthService;
    return createStreamAuthRevalidator(auth);
  }

  const kindOf = (kind: string): AuthIdentityValidationResult =>
    ({ kind }) as unknown as AuthIdentityValidationResult;

  it("maps the revalidation outcome to the transport's normalized signal", async () => {
    await expect(revalidatorOver(null).revalidateForReconnect()).resolves.toBe(
      "rejected",
    );
    await expect(
      revalidatorOver(kindOf("valid")).revalidateForReconnect(),
    ).resolves.toBe("rotated");
    await expect(
      revalidatorOver(kindOf("network-error")).revalidateForReconnect(),
    ).resolves.toBe("network-error");
    await expect(
      revalidatorOver(kindOf("rejected")).revalidateForReconnect(),
    ).resolves.toBe("rejected");
  });
});
