/**
 * Controllable fakes for the render tests (T4+): a driveable auth-status source
 * and a mocked host client. Neither touches the network — the auth fake exposes
 * only the surface `App` reads (status / onStatusChange / signIn / cancelSignIn
 * / signOut) plus a `setStatus` to drive transitions; the host fake wraps a
 * caller-supplied `request` implementation in a spy.
 */
import { vi } from "vitest";
import type { EpicStreamCallbacks } from "@traycer-clients/shared/host-transport/epic-stream-client";
import type { ChatStreamCallbacks } from "@traycer-clients/shared/host-transport/chat-stream-client";
import type { MobileAuthService, MobileAuthStatus } from "@/host/auth-service";
import type { MobileHostClient } from "@/host/host-client-context";
import {
  HostStreamConnection,
  StreamConnectionStateStore,
} from "@/host/stream-connection";

export interface FakeAuth {
  /** Cast to the `MobileAuthService` prop `App` expects (uses only this surface). */
  readonly service: MobileAuthService;
  readonly signIn: ReturnType<typeof vi.fn>;
  readonly cancelSignIn: ReturnType<typeof vi.fn>;
  readonly signOut: ReturnType<typeof vi.fn>;
  /** Push a new status and notify subscribers (drives gate transitions). */
  setStatus(status: MobileAuthStatus): void;
}

export function createFakeAuth(initial: MobileAuthStatus): FakeAuth {
  let status = initial;
  const listeners = new Set<(status: MobileAuthStatus) => void>();
  const signIn = vi.fn();
  const cancelSignIn = vi.fn();
  const signOut = vi.fn();

  const service = {
    signIn,
    cancelSignIn,
    signOut,
    status: () => status,
    onStatusChange(listener: (status: MobileAuthStatus) => void): () => void {
      listeners.add(listener);
      listener(status);
      return () => {
        listeners.delete(listener);
      };
    },
  } as unknown as MobileAuthService;

  return {
    service,
    signIn,
    cancelSignIn,
    signOut,
    setStatus(next: MobileAuthStatus): void {
      status = next;
      for (const listener of [...listeners]) listener(next);
    },
  };
}

export interface FakeHostClient {
  /**
   * Cast to the `MobileHostClient` context value. `App`/fleet use only
   * `request`; the T7 author flow also reads `getRequestContextUserId`, so the
   * fake exposes both.
   */
  readonly client: MobileHostClient;
  readonly request: ReturnType<typeof vi.fn>;
  readonly getRequestContextUserId: ReturnType<typeof vi.fn>;
}

export function createFakeHostClient(
  requestImpl: (method: string, params: unknown) => Promise<unknown>,
  options: { readonly userId?: string | null } = {},
): FakeHostClient {
  const request = vi.fn(requestImpl);
  // Explicit `null` must survive (tests the signed-out branch); only an absent
  // option falls back to a default id.
  const getRequestContextUserId = vi.fn((): string | null =>
    options.userId === undefined ? "user-1" : options.userId,
  );
  return {
    request,
    getRequestContextUserId,
    client: { request, getRequestContextUserId } as unknown as MobileHostClient,
  };
}

/**
 * One opened epic stream captured by the fake: the callbacks the view bound (so
 * a test can push snapshot/update frames), the REAL connection-state store (so a
 * test can drive live/reconnecting/disconnected), and a `close` spy to assert
 * teardown on unmount.
 */
export interface FakeEpicSession {
  readonly epicId: string;
  readonly callbacks: EpicStreamCallbacks;
  readonly connection: StreamConnectionStateStore;
  readonly close: ReturnType<typeof vi.fn>;
}

/** Per-chat counterpart of {@link FakeEpicSession}. */
export interface FakeChatSession {
  readonly epicId: string;
  readonly chatId: string;
  readonly callbacks: ChatStreamCallbacks;
  readonly connection: StreamConnectionStateStore;
  readonly close: ReturnType<typeof vi.fn>;
  /** Records every client frame the view dispatches (T6 reply frames). */
  readonly sendAction: ReturnType<typeof vi.fn>;
}

export interface FakeStreamConnection {
  /** Cast to the `HostStreamConnection` the provider expects (uses only openEpic/openChat/reconnectAll). */
  readonly connection: HostStreamConnection;
  readonly epicSessions: FakeEpicSession[];
  readonly chatSessions: FakeChatSession[];
  /** S5: records every `reconnectAll(reason)` call the liveness-recovery wiring makes. */
  readonly reconnectAll: ReturnType<typeof vi.fn>;
}

/**
 * A `HostStreamConnection` that never touches the network. `openEpic`/`openChat`
 * record the session (callbacks + a real `StreamConnectionStateStore` + a close
 * spy) so a render test can feed decoded frames and connection transitions in,
 * and assert every stream is closed on unmount. The store is the production one
 * — its subscribe/getState is exactly what the hooks bind — so connection-state
 * wiring is exercised for real, only the transport is faked.
 */
export function createFakeStreamConnection(): FakeStreamConnection {
  const epicSessions: FakeEpicSession[] = [];
  const chatSessions: FakeChatSession[] = [];
  const reconnectAll = vi.fn();

  const connection = {
    reconnectAll,
    openEpic(params: { epicId: string; callbacks: EpicStreamCallbacks }) {
      const store = new StreamConnectionStateStore();
      const close = vi.fn();
      epicSessions.push({
        epicId: params.epicId,
        callbacks: params.callbacks,
        connection: store,
        close,
      });
      return { stream: { close }, connection: store };
    },
    openChat(params: {
      epicId: string;
      chatId: string;
      callbacks: ChatStreamCallbacks;
    }) {
      const store = new StreamConnectionStateStore();
      const close = vi.fn();
      const sendAction = vi.fn();
      chatSessions.push({
        epicId: params.epicId,
        chatId: params.chatId,
        callbacks: params.callbacks,
        connection: store,
        close,
        sendAction,
      });
      return { stream: { close, sendAction }, connection: store };
    },
  } as unknown as HostStreamConnection;

  return { connection, epicSessions, chatSessions, reconnectAll };
}
