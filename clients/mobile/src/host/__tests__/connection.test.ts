/**
 * B1 regression guard — drives the REAL `createHostConnection`.
 *
 * The whole reason T2 exists is: did we wire `bind(entry)` +
 * `setRequestContext(...)` (and re-thread it on auth changes) onto the
 * `HostClient`? So this guard calls the real factory through its messenger seam
 * and asserts the observable consequence of that wiring:
 *
 *   - a context present at construction → RPC resolves immediately
 *     (guards the constructor-time `bind` + `setRequestContext(auth.current())`);
 *   - no context (signed-out) → RPC rejects before touching the messenger;
 *   - `auth.onChange` firing a context → RPC starts resolving
 *     (guards the onChange re-thread), and firing `null` → rejects again.
 *
 * INVARIANT UNDER GUARD: delete the `bind` or the `setRequestContext(auth.current())`
 * line from `createHostConnection` and the "context at construction" test MUST
 * fail; delete the `onChange` subscription and the "reacts to onChange" test MUST
 * fail. (Verified by hand-removing each line.)
 */
import { describe, expect, it, vi, type Mock } from "vitest";
import type { HostRpcRegistry } from "@traycer/protocol/host/index";
import type { IHostMessenger } from "@traycer-clients/shared/host-transport/host-messenger";
import type { RequestContext } from "@traycer/protocol/auth/request-context";
import type { RequestContextListener } from "@traycer-clients/shared/auth/request-context-provider";
import type { OpenFrameBearerSource } from "@traycer-clients/shared/auth/bearer-source";
import type { RevalidateOutcome } from "@traycer-clients/shared/auth/bearer-revalidator";
import { createHostConnection, type HostConnectionAuth } from "../connection";

const HOST_WS_URL = "ws://test/rpc";

/**
 * Minimal live `RequestContext`: a non-released credential lease plus an
 * unaborted signal — the only fields `HostClient.captureAuthority` /
 * `readRequestPreflightError` read on the success path. The mock messenger
 * never inspects the bearer, so a fixed token is enough.
 */
function fakeContext(userId: string): RequestContext {
  const identity = { userId } as RequestContext["identity"];
  return {
    identity,
    origin: "renderer",
    connectionId: undefined,
    operationId: undefined,
    abortSignal: new AbortController().signal,
    credentials: {
      identity,
      isReleased: false,
      getBearerToken: () => "bearer-token",
      rotateBearerToken: () => {},
      release: () => {},
    },
    isAborted: false,
    abort: () => {},
    release: () => {},
  } as RequestContext;
}

/**
 * Controllable `HostConnectionAuth`: `current()` returns the live context, and
 * `emit(ctx)` sets it AND fires the `onChange` listeners — mirroring how
 * `MobileAuthService` transitions identity.
 */
function fakeAuth(initial: RequestContext | null): HostConnectionAuth & {
  emit(ctx: RequestContext | null): void;
} {
  let context = initial;
  const listeners = new Set<RequestContextListener>();
  return {
    current: () => context,
    onChange(listener: RequestContextListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    revalidateExpectedBearer: (
      _expected: OpenFrameBearerSource,
    ): Promise<RevalidateOutcome | "superseded"> => Promise.resolve("superseded"),
    emit(ctx: RequestContext | null): void {
      context = ctx;
      for (const listener of [...listeners]) {
        listener(ctx);
      }
    },
  };
}

/** Mock raw messenger that records calls and resolves — stands in for `WsRpcClient`. */
function mockMessenger(): {
  messenger: IHostMessenger<HostRpcRegistry>;
  request: Mock;
} {
  const request = vi.fn().mockResolvedValue({ ok: true });
  const messenger = {
    request,
    requestWithResponseTimeout: request,
  } as unknown as IHostMessenger<HostRpcRegistry>;
  return { messenger, request };
}

function connect(auth: HostConnectionAuth) {
  const { messenger, request } = mockMessenger();
  const connection = createHostConnection(auth, {
    messengerFactory: () => messenger,
    hostWsUrl: HOST_WS_URL,
  });
  if (connection === null) {
    throw new Error("expected a connection for a configured host URL");
  }
  return { connection, request };
}

describe("createHostConnection — B1 glue guard", () => {
  it("returns null when no host is configured", () => {
    const auth = fakeAuth(null);
    expect(
      createHostConnection(auth, {
        messengerFactory: () => mockMessenger().messenger,
        hostWsUrl: null,
      }),
    ).toBeNull();
  });

  it("resolves immediately when a context is present at construction", async () => {
    // Guards constructor-time bind + setRequestContext(auth.current()).
    const auth = fakeAuth(fakeContext("u1"));
    const { connection, request } = connect(auth);

    await expect(
      connection.hostClient.request("host.status", {} as never),
    ).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "host.status",
      expect.anything(),
      expect.objectContaining({ bearer: expect.anything() }),
    );

    connection.dispose();
  });

  it("rejects before any auth context (signed-out at construction)", async () => {
    const auth = fakeAuth(null);
    const { connection, request } = connect(auth);

    await expect(
      connection.hostClient.request("host.status", {} as never),
    ).rejects.toBeInstanceOf(Error);
    expect(request).not.toHaveBeenCalled();

    connection.dispose();
  });

  it("reacts to auth.onChange: resolves after sign-in, rejects after sign-out", async () => {
    // Guards the onChange re-thread wiring.
    const auth = fakeAuth(null);
    const { connection, request } = connect(auth);

    // Signed-out: rejects, messenger untouched.
    await expect(
      connection.hostClient.request("host.status", {} as never),
    ).rejects.toBeInstanceOf(Error);
    expect(request).not.toHaveBeenCalled();

    // Sign-in transition → onChange fires a context → RPC now resolves.
    auth.emit(fakeContext("u1"));
    await expect(
      connection.hostClient.request("host.status", {} as never),
    ).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(1);

    // Sign-out transition → onChange fires null → RPC rejects again.
    auth.emit(null);
    await expect(
      connection.hostClient.request("host.status", {} as never),
    ).rejects.toBeInstanceOf(Error);
    expect(request).toHaveBeenCalledTimes(1);

    connection.dispose();
  });
});
