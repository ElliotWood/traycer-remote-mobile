/**
 * HA-4 — the two-tier connection manager (driving vs watching).
 *
 * Governed by the Host Awareness tech plan's "governing mechanism" section
 * and the ticket's own sizing correction. Holds exactly ONE driving
 * connection (epic document, chat streams, approvals, sending — everything)
 * and N watching connections (status deltas only, via
 * `host.notifications.feed.subscribe`).
 *
 * The roster is deliberately NOT this module's problem: every chat in the
 * epic doc carries its own durable `hostId` (`chatSchema.hostId`,
 * `protocol/src/persistence/epic/chat.ts`), and epic docs are cloud-
 * replicated, so the DRIVING connection's own `epic.subscribe` already
 * enumerates every other machine's chats for free (`readChatsFromEpicDoc`,
 * `@traycer-clients/shared/epic/epic-doc-chats`). A watching connection is
 * not needed for the roster at all — only for status on a machine whose
 * chats you already know about from the driving doc.
 *
 * Invariant enforcement — made UNREPRESENTABLE, not merely guarded: a
 * watching-tier client is typed `WsStreamClient<WatchingStreamRpcRegistry>`
 * (`./watching-stream-registry`), whose registry has exactly one method.
 * Calling `.subscribe("epic.subscribe", …)` on one is a TypeScript compile
 * error — the method is not on the object — and the open-frame manifest
 * `WsStreamClient` sends on dial is derived from that SAME registry, so the
 * restriction is structural on the wire too: a watching connection's open
 * frame never declares `epic.subscribe` or `chat.subscribe`, observable by
 * whatever host it dials.
 *
 * `HostDirectoryEntry` (`../host-client/host-directory`) is a structural
 * subtype of the transport's own `HostTransportEndpoint` — checked, not
 * assumed — so directory entries feed both tiers' endpoints directly, with
 * no adapter. An adapter nobody needed would have been written by someone
 * who didn't check, and then it would have looked load-bearing.
 *
 * Deliberately OUT of scope (ticket's own "Out" section):
 *   - The UI for switching (HA-6) — this module exposes `promote()`, not a
 *     switcher.
 *   - Server-side routing and ownership (HA-5).
 *   - Populating `setKnownMachines` from a real directory (HA-2) — this
 *     module accepts whatever `HostDirectoryEntry[]` it's given. Called with
 *     `[]` (HA-2's current stub, and mobile's current reality with no
 *     runtime host binding), the manager degrades to exactly today's single-
 *     connection shape — see `setKnownMachines`'s own doc comment.
 */
import {
  HostStreamConnection,
  createStreamAuthRevalidator,
  OPEN_ACK_TIMEOUT_MS,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  INITIAL_BACKOFF_MS,
  MAX_BACKOFF_MS,
  StreamConnectionStateStore,
  toConnectionState,
  type StreamConnectionAuth,
  type StreamConnectionState,
} from "./single-host-stream-connection";
import { WsStreamClient } from "./ws-stream-client";
import { DEFAULT_DIAL_TIMEOUT_MS } from "./transport-config";
import { createWhatwgStreamWebSocketFactory } from "./whatwg-stream-ws-factory";
import type { HostEndpointProvider } from "./ws-rpc-client";
import type { IStreamSession, ServerFrameHandler } from "./i-stream-session";
import type { IStreamWebSocketFactory } from "./ws-stream-factory";
import type { HostDirectoryEntry } from "../host-client/host-directory";
import {
  watchingStreamRpcRegistry,
  type WatchingStreamRpcRegistry,
} from "./watching-stream-registry";

/** How long `promote()` waits for the fresh dial before reporting failure. */
const PROMOTE_DIAL_TIMEOUT_MS = 15_000;

/**
 * One machine's reachability, INCLUDING the promotion window — the arm
 * `state-models-need-an-unknown-arm` exists for. Both the demoted and the
 * promoted machine read `"promoting"` while a promotion is in flight: the
 * new one hasn't finished dialing (not safely "driving" yet), and the old
 * one's full-registry client is being torn down (not safely "watching"
 * yet, and briefly not represented in the watching map at all — see
 * `promote()`). A consumer forced to pick "driving" or "watching" during
 * this window would produce a confident wrong answer for one of the two
 * machines; `"promoting"` exists so it doesn't have to.
 */
export type ConnectionTier = "driving" | "watching" | "promoting" | "unknown";

/**
 * Exhaustive-by-construction reducer over `ConnectionTier`. Any caller that
 * needs to render or branch on a tier should route through something built
 * this way (or a `switch` with a `never` default) rather than a binary
 * `tier === "driving" ? … : …` — the latter silently folds `"promoting"`
 * and `"unknown"` into whichever branch happens to run, which is exactly
 * the collapse this type exists to prevent.
 */
export function describeTier<T>(
  tier: ConnectionTier,
  cases: {
    readonly driving: () => T;
    readonly watching: () => T;
    readonly promoting: () => T;
    readonly unknown: () => T;
  },
): T {
  switch (tier) {
    case "driving":
      return cases.driving();
    case "watching":
      return cases.watching();
    case "promoting":
      return cases.promoting();
    case "unknown":
      return cases.unknown();
  }
}

export interface PromoteResult {
  /** Wall-clock time from the call to the new driving client reporting live. */
  readonly elapsedMs: number;
}

interface SteadyState {
  readonly phase: "steady";
  readonly drivingHostId: string;
}

interface PromotingState {
  readonly phase: "promoting";
  readonly from: string;
  readonly to: string;
}

type ManagerState = SteadyState | PromotingState;

/**
 * The minimal shape either tier's transport actually reads — `hostId` and
 * `websocketUrl`, nothing else. `HostDirectoryEntry` (label/kind/version/
 * status) is a structural superset, so a real directory entry satisfies
 * this with no conversion; kept separate from `HostDirectoryEntry` itself
 * so a demoted machine's own connection can be rebuilt from what the
 * manager already tracked internally, without needing the CALLER's
 * directory to still list it.
 */
export interface MachineEndpoint {
  readonly hostId: string;
  readonly websocketUrl: string | null;
}

function endpointFor(entry: MachineEndpoint): HostEndpointProvider {
  return () =>
    entry.websocketUrl !== null && entry.websocketUrl !== ""
      ? { hostId: entry.hostId, websocketUrl: entry.websocketUrl }
      : null;
}

/**
 * Resolves once `store` reports `"live"`, or rejects after `timeoutMs`. Used
 * both by `promote()` (dial latency) and available to tests that need to
 * drive a stub socket to "open" and then observe the store settle.
 */
function waitForLive(
  store: StreamConnectionStateStore,
  timeoutMs: number,
): Promise<void> {
  if (store.getState() === "live") {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`dial did not report live within ${timeoutMs}ms`));
    }, timeoutMs);
    const unsubscribe = store.subscribe(() => {
      if (store.getState() === "live") {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

/**
 * One watching-tier connection to a machine that is not being driven.
 * Opens its `host.notifications.feed.subscribe` session immediately on
 * construction — a watching connection exists to carry exactly that, so
 * there is no separate "open" step for callers to forget.
 */
export class WatchingConnection {
  readonly hostId: string;
  readonly client: WsStreamClient<WatchingStreamRpcRegistry>;
  readonly connection: StreamConnectionStateStore;
  private readonly session: IStreamSession;
  private readonly unsubscribeBearerRotation: () => void;

  constructor(
    auth: StreamConnectionAuth,
    entry: MachineEndpoint,
    webSocketFactory: IStreamWebSocketFactory,
  ) {
    this.hostId = entry.hostId;
    this.client = new WsStreamClient<WatchingStreamRpcRegistry>({
      registry: watchingStreamRpcRegistry,
      endpoint: endpointFor(entry),
      bearer: () => auth.current()?.credentials ?? null,
      auth: createStreamAuthRevalidator(auth),
      // No delegated host-credential-provisioning policy for this watching-tier
      // connection either — see the matching note in
      // `single-host-stream-connection.ts`.
      hostCredentialMint: null,
      webSocketFactory,
      dialTimeoutMs: DEFAULT_DIAL_TIMEOUT_MS,
      openAckTimeoutMs: OPEN_ACK_TIMEOUT_MS,
      pingIntervalMs: PING_INTERVAL_MS,
      pongTimeoutMs: PONG_TIMEOUT_MS,
      initialBackoffMs: INITIAL_BACKOFF_MS,
      maxBackoffMs: MAX_BACKOFF_MS,
    });

    this.connection = new StreamConnectionStateStore();
    this.session = this.client.subscribe("host.notifications.feed.subscribe", {
      initialAttentionLimit: 100,
      initialRecentLimit: 100,
    });
    this.session.onStatusChange((status, reason) => {
      this.connection.applyStatus(status, reason);
    });

    this.unsubscribeBearerRotation = auth.onBearerRotated(() => {
      this.client.notifyBearerRotated();
    });
  }

  /** Raw per-frame access for a caller building the fleet's status feed. */
  onServerFrame(handler: ServerFrameHandler): void {
    this.session.onServerFrame(handler);
  }

  close(reason: string): void {
    this.unsubscribeBearerRotation();
    this.client.close(reason);
  }
}

/**
 * Construction seams for tests — production code gets the real
 * `HostStreamConnection` / `WatchingConnection` (both of which dial a real
 * socket) by leaving these unset. Mirrors the pattern one layer down:
 * `WsStreamClientOptions.webSocketFactory` is already an injected
 * constructor option, not a hardcoded global; this is the same seam at the
 * connection-manager's own construction boundary, needed because
 * `HostStreamConnection` itself has no such option to forward.
 */
export interface TwoTierHostConnectionManagerDeps {
  readonly createDriving?: (
    auth: StreamConnectionAuth,
    entry: MachineEndpoint,
  ) => HostStreamConnection;
  readonly createWatching?: (
    auth: StreamConnectionAuth,
    entry: MachineEndpoint,
  ) => WatchingConnection;
  /** Overrides `PROMOTE_DIAL_TIMEOUT_MS` — tests use a small value rather than waiting out the real 15s. */
  readonly promoteDialTimeoutMs?: number;
}

/**
 * Owns exactly one driving connection and zero-or-more watching
 * connections. "At most one connection is in the driving tier" is not
 * merely a runtime check here — there is exactly one field
 * (`driving: HostStreamConnection`) capable of the full registry, and
 * `promote()` closes the previous holder before returning, so at no
 * observable instant are two full-registry clients open simultaneously.
 */
export class TwoTierHostConnectionManager {
  private driving: HostStreamConnection;
  /** `{hostId, websocketUrl}` for whatever `driving` currently points at — tracked so a FUTURE demotion of THIS machine can rebuild it as a watching connection without depending on the caller's directory still listing it. */
  private drivingEntry: MachineEndpoint;
  private readonly watching = new Map<string, WatchingConnection>();
  private state: ManagerState;
  private readonly createDriving: Required<TwoTierHostConnectionManagerDeps>["createDriving"];
  private readonly createWatching: Required<TwoTierHostConnectionManagerDeps>["createWatching"];
  private readonly promoteDialTimeoutMs: number;

  constructor(
    private readonly auth: StreamConnectionAuth,
    drivingEntry: MachineEndpoint,
    deps: TwoTierHostConnectionManagerDeps,
  ) {
    this.createDriving =
      deps.createDriving ??
      ((a, e) =>
        new HostStreamConnection(a, {
          hostWsUrl: e.websocketUrl,
          hostId: e.hostId,
        }));
    this.createWatching =
      deps.createWatching ??
      ((a, e) =>
        new WatchingConnection(a, e, createWhatwgStreamWebSocketFactory()));
    this.promoteDialTimeoutMs = deps.promoteDialTimeoutMs ?? PROMOTE_DIAL_TIMEOUT_MS;
    this.driving = this.createDriving(auth, drivingEntry);
    this.drivingEntry = drivingEntry;
    this.state = { phase: "steady", drivingHostId: drivingEntry.hostId };
  }

  get drivingHostId(): string {
    return this.state.phase === "steady" ? this.state.drivingHostId : this.state.to;
  }

  /** The single driving connection — epic doc, chat streams, everything. */
  get drivingConnection(): HostStreamConnection {
    return this.driving;
  }

  watchingHostIds(): readonly string[] {
    return Array.from(this.watching.keys());
  }

  watchingConnectionFor(hostId: string): WatchingConnection | null {
    return this.watching.get(hostId) ?? null;
  }

  /** See `ConnectionTier`'s doc comment for the promotion-window semantics. */
  tierFor(hostId: string): ConnectionTier {
    if (this.state.phase === "promoting") {
      if (hostId === this.state.from || hostId === this.state.to) {
        return "promoting";
      }
    } else if (hostId === this.state.drivingHostId) {
      return "driving";
    }
    return this.watching.has(hostId) ? "watching" : "unknown";
  }

  /**
   * Reconciles the watching set against a directory snapshot. A machine no
   * longer present is closed and dropped; a newly-known one gets a fresh
   * watching connection. The driving machine is never given a watching
   * entry of its own — it is represented by `driving`, not by an entry in
   * this map.
   *
   * Called with `[]` — which is what happens today, since HA-2's directory
   * fetch is still a stub and mobile has no runtime host binding to
   * populate one by hand — this closes every existing watching connection
   * and leaves the manager observably identical to a bare, single-
   * connection `HostStreamConnection`: HA-4 ships ahead of HA-2 rather than
   * waiting on it.
   */
  setKnownMachines(entries: readonly HostDirectoryEntry[]): void {
    const nextIds = new Set(
      entries
        .filter((entry) => entry.hostId !== this.drivingHostId)
        .map((entry) => entry.hostId),
    );

    for (const [hostId, conn] of Array.from(this.watching)) {
      if (!nextIds.has(hostId)) {
        conn.close("removed-from-directory");
        this.watching.delete(hostId);
      }
    }

    for (const entry of entries) {
      if (entry.hostId === this.drivingHostId) continue;
      if (this.watching.has(entry.hostId)) continue;
      this.watching.set(entry.hostId, this.createWatching(this.auth, entry));
    }
  }

  /**
   * Promotes `entry.hostId` to driving, demoting the current driving
   * machine. A FRESH DIAL, not a subscription flip — the tech plan's
   * "promotion is a subscription change" claim was refuted against source
   * (there is no per-machine connection object to promote; `endpoint` is a
   * constructor option). This measures the transport handshake only
   * (dial → open → openAck → subscribe-ack on a cheap
   * `host.notifications.feed.subscribe` probe) — NOT the epic-document
   * snapshot, which is the caller's concern once it learns the driving
   * machine changed, and which the perf artifact separately clocks at 8.3s.
   * Conflating the two would misreport which cost this manager owns.
   */
  async promote(entry: HostDirectoryEntry): Promise<PromoteResult> {
    if (entry.hostId === this.drivingHostId) {
      return { elapsedMs: 0 };
    }
    if (this.state.phase === "promoting") {
      throw new Error(
        `promote(${entry.hostId}) rejected: a promotion to ${this.state.to} is already in flight`,
      );
    }

    const fromHostId = this.drivingHostId;
    const started = Date.now();
    this.state = { phase: "promoting", from: fromHostId, to: entry.hostId };

    // Drop any existing watching connection for the promotion target BEFORE
    // dialing its driving replacement, so the same machine is never
    // reachable through two live clients at once.
    const existingWatching = this.watching.get(entry.hostId);
    if (existingWatching !== undefined) {
      existingWatching.close("promoted-to-driving");
      this.watching.delete(entry.hostId);
    }

    const nextDriving = this.createDriving(this.auth, entry);
    const probe = new StreamConnectionStateStore();
    const probeSession = nextDriving.client.subscribe(
      "host.notifications.feed.subscribe",
      { initialAttentionLimit: 100, initialRecentLimit: 100 },
    );
    probeSession.onStatusChange((status, reason) => {
      probe.applyStatus(status, reason);
    });

    try {
      await waitForLive(probe, this.promoteDialTimeoutMs);
    } catch (error) {
      // Dial failed: stay on the original driving connection rather than
      // leaving the manager pointed at a client that never came up.
      nextDriving.close("promotion-dial-failed");
      this.state = { phase: "steady", drivingHostId: fromHostId };
      throw error;
    }

    const previousDriving = this.driving;
    const previousDrivingEntry = this.drivingEntry;
    this.driving = nextDriving;
    this.drivingEntry = { hostId: entry.hostId, websocketUrl: entry.websocketUrl };
    this.state = { phase: "steady", drivingHostId: entry.hostId };

    // The demoted machine's full-registry client is closed immediately —
    // this is the actual "at most one driving" invariant: not that one
    // field exists (trivially true), but that only one LIVE, full-registry
    // client is ever open. `previousDriving.close` tears down every session
    // it owned, including any epic/chat streams the app had opened on it.
    previousDriving.close("demoted");

    // The tech plan describes this as "promote its watching connection to
    // driving, demote the current one" — symmetric. Rebuild the demoted
    // machine as a fresh watching connection from what THIS manager already
    // tracked about it, independent of whether the caller's last
    // `setKnownMachines` snapshot still lists it. A later `setKnownMachines`
    // call (e.g. reporting it's gone) will close this again correctly.
    this.watching.set(
      previousDrivingEntry.hostId,
      this.createWatching(this.auth, previousDrivingEntry),
    );

    return { elapsedMs: Date.now() - started };
  }

  close(reason: string): void {
    this.driving.close(reason);
    for (const conn of this.watching.values()) {
      conn.close(reason);
    }
    this.watching.clear();
  }
}

export { toConnectionState };
export type { StreamConnectionState };
