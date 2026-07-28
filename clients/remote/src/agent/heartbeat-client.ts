import type { AgentRegisterRequest } from "../shared/wire-schemas";

// Capped low (B6): a gateway restart must be followed by prompt
// re-registration, not a multi-second-to-30s exponential wait - rubric §4
// requires reconnect to be prompt with no backoff wait.
const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 5_000;
const HEARTBEAT_INTERVAL_DIVISOR = 3;

export interface HeartbeatClientOptions {
  readonly gatewayRegistrationUrl: string;
  readonly token: string;
  readonly heartbeatTimeoutMs: number;
  readonly currentState: () => AgentRegisterRequest;
  readonly onEvent?: (event: HeartbeatClientEvent) => void;
}

export type HeartbeatClientEvent =
  | { readonly kind: "registered" }
  | { readonly kind: "heartbeat-sent" }
  | { readonly kind: "request-failed"; readonly op: "register" | "heartbeat" | "unregister"; readonly status: number | null };

async function postJson(
  baseUrl: string,
  path: string,
  token: string,
  body: unknown,
): Promise<Response> {
  return fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Registers on startup, heartbeats on an interval, unregisters on clean
 * shutdown. Backoff is capped low (see `MAX_BACKOFF_MS`) so a gateway
 * restart is followed by prompt re-registration rather than a long wait.
 */
export class HeartbeatClient {
  private readonly options: HeartbeatClientOptions;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = INITIAL_BACKOFF_MS;
  private stopped = false;

  constructor(options: HeartbeatClientOptions) {
    this.options = options;
  }

  start(): void {
    this.stopped = false;
    void this.registerLoop();
  }

  /** Best-effort unregister, then stops the heartbeat loop. Idempotent. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    try {
      await postJson(
        this.options.gatewayRegistrationUrl,
        "/agents/unregister",
        this.options.token,
        { agentId: this.options.currentState().agentId },
      );
    } catch {
      // Best-effort per the M1 contract - a failed unregister just means the
      // gateway finds out via a lapsed heartbeat instead.
    }
  }

  private async registerLoop(): Promise<void> {
    while (!this.stopped) {
      const res = await this.tryRequest("register", "/agents/register");
      if (res) {
        this.options.onEvent?.({ kind: "registered" });
        this.backoffMs = INITIAL_BACKOFF_MS;
        this.scheduleHeartbeat();
        return;
      }
      await this.sleepWithBackoff();
    }
  }

  private scheduleHeartbeat(): void {
    if (this.stopped) return;
    const intervalMs = Math.max(
      1_000,
      Math.floor(this.options.heartbeatTimeoutMs / HEARTBEAT_INTERVAL_DIVISOR),
    );
    this.timer = setTimeout(() => void this.sendHeartbeat(), intervalMs);
  }

  private async sendHeartbeat(): Promise<void> {
    if (this.stopped) return;
    const res = await this.tryRequest("heartbeat", "/agents/heartbeat");
    if (res) {
      this.options.onEvent?.({ kind: "heartbeat-sent" });
      this.scheduleHeartbeat();
      return;
    }
    // A failed heartbeat (e.g. gateway restarted) falls back to the
    // register loop's capped backoff so re-registration stays prompt.
    void this.registerLoop();
  }

  private async tryRequest(
    op: "register" | "heartbeat",
    path: string,
  ): Promise<boolean> {
    try {
      const res = await postJson(
        this.options.gatewayRegistrationUrl,
        path,
        this.options.token,
        this.options.currentState(),
      );
      if (!res.ok) {
        this.options.onEvent?.({ kind: "request-failed", op, status: res.status });
        return false;
      }
      return true;
    } catch {
      this.options.onEvent?.({ kind: "request-failed", op, status: null });
      return false;
    }
  }

  private async sleepWithBackoff(): Promise<void> {
    const delay = this.backoffMs;
    this.backoffMs = Math.min(MAX_BACKOFF_MS, this.backoffMs * 2);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
