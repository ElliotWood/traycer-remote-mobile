/**
 * Sprint 5 (A): forces the shared `HostStreamConnection` to reconnect fast on
 * wake signals, instead of waiting out the raw ~30s backoff ceiling.
 *
 * `WsStreamClient.reconnectAll` already exists (built for gui-app's
 * device-wake case) and already proves recovery is real: `EpicStreamClient`/
 * `ChatStreamClient` re-send a full snapshot on every resubscribe, so forcing
 * a reconnect is enough to refresh a view's data with no new decode logic.
 * This module only decides WHEN to call it:
 *
 *   - `focus` / `visibilitychange`→visible / `online` / `pageshow` —
 *     unconditional. A backgrounded mobile tab can have a silently-dead
 *     socket the status store hasn't noticed yet, so these fire even if
 *     `connection` still reads "live" (gating them on liveness would miss
 *     exactly that case). `pageshow` covers iOS Safari/PWA's
 *     back-forward-cache restore specifically — a long background
 *     suspension there can resurrect the page via bfcache in a tick where
 *     `visibilitychange`/`focus` don't reliably fire first.
 *   - A gentle interval backstop, gated on `!isLive()` (true no-op while
 *     healthy) — nudges a still-stuck session if neither wake signal fired.
 *
 * All five routes share ONE cooldown so a burst (`focus` + `visibilitychange`
 * firing together, or the backstop ticking moments after a wake signal
 * already reconnected) collapses into a single `reconnectAll` call rather than
 * hammering the transport.
 *
 * Callers wire this into the SAME effect that opens/closes their stream
 * (`useEpicDoc`, `useChat`) — never into `useChatBadges`, which opens N
 * per-chat sessions; wiring it there would fire N redundant `reconnectAll`
 * calls per wake signal. `reconnectAll` already reconnects every session on
 * the shared client in one call, so one instance per mounted stream-view is
 * sufficient.
 */

export interface AddRemoveEventTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface VisibilityTarget extends AddRemoveEventTarget {
  readonly visibilityState: string;
}

export interface LivenessRecoveryOptions {
  /** Forces a reconnect of every open session, tagged with the trigger reason. */
  readonly reconnect: (reason: string) => void;
  /** Reads the CURRENT connection state; the backstop only fires when this is false. */
  readonly isLive: () => boolean;
  /** Shared debounce across every trigger. Default 5000ms. */
  readonly cooldownMs?: number;
  /** Backstop poll cadence. Default 20000ms. */
  readonly backstopIntervalMs?: number;
  readonly windowTarget?: AddRemoveEventTarget;
  readonly documentTarget?: VisibilityTarget;
  readonly now?: () => number;
  readonly setIntervalFn?: (handler: () => void, ms: number) => IntervalHandle;
  readonly clearIntervalFn?: (handle: IntervalHandle) => void;
}

/**
 * Opaque interval handle. Browsers return `number`; Node's ambient types (
 * pulled in transitively by this workspace's tsconfig) return a `Timeout`
 * object — this module only ever runs in a browser, so the globals are cast
 * to this shape at the default-value site rather than threading the
 * environment-specific type through the whole module.
 */
export type IntervalHandle = number;

const DEFAULT_COOLDOWN_MS = 5_000;
const DEFAULT_BACKSTOP_INTERVAL_MS = 20_000;

/**
 * Wires the wake-signal + backstop triggers and returns a cleanup function
 * that removes every listener and clears the interval. Idempotent to call the
 * returned cleanup more than once (matches the codebase's other teardown
 * functions).
 */
export function startLivenessRecovery(options: LivenessRecoveryOptions): () => void {
  const {
    reconnect,
    isLive,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    backstopIntervalMs = DEFAULT_BACKSTOP_INTERVAL_MS,
    windowTarget = window,
    documentTarget = document,
    now = Date.now,
    setIntervalFn = setInterval as unknown as (
      handler: () => void,
      ms: number,
    ) => IntervalHandle,
    clearIntervalFn = clearInterval as unknown as (handle: IntervalHandle) => void,
  } = options;

  let lastTriggeredAt = -Infinity;

  // Every route (the three wake signals + the backstop) funnels through this
  // one gate, so the 5s cooldown bounds ALL of them together — the backstop
  // cannot fire a redundant reconnect seconds after a wake signal already did.
  const trigger = (reason: string): void => {
    const t = now();
    if (t - lastTriggeredAt < cooldownMs) {
      return;
    }
    lastTriggeredAt = t;
    reconnect(reason);
  };

  const onFocus = (): void => trigger("window-focus");
  const onOnline = (): void => trigger("network-online");
  const onPageShow = (): void => trigger("page-show");
  const onVisibilityChange = (): void => {
    if (documentTarget.visibilityState === "visible") {
      trigger("visibility-visible");
    }
  };

  windowTarget.addEventListener("focus", onFocus);
  windowTarget.addEventListener("online", onOnline);
  windowTarget.addEventListener("pageshow", onPageShow);
  documentTarget.addEventListener("visibilitychange", onVisibilityChange);

  const backstopHandle = setIntervalFn(() => {
    if (!isLive()) {
      trigger("liveness-backstop");
    }
  }, backstopIntervalMs);

  let torn = false;
  return (): void => {
    if (torn) return;
    torn = true;
    windowTarget.removeEventListener("focus", onFocus);
    windowTarget.removeEventListener("online", onOnline);
    windowTarget.removeEventListener("pageshow", onPageShow);
    documentTarget.removeEventListener("visibilitychange", onVisibilityChange);
    clearIntervalFn(backstopHandle);
  };
}
