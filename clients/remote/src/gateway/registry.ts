export type UnavailableReason = "heartbeat_lapsed" | "stopped";

export interface RegistryEntry {
  readonly agentId: string;
  readonly hostId: string;
  readonly label: string;
  readonly version: string;
  readonly reachableUrl: string;
  readonly lastHeartbeatAt: number;
  readonly unavailableReason: UnavailableReason | null;
}

export type HostAvailability = "available" | "unavailable";

/**
 * In-memory agent registry. **[B3]** Entries are never deleted by a lapsed
 * heartbeat or a graceful unregister - only status/reason changes. This is
 * the fix for "the user turned their machine off": it stays listed and
 * honestly `unavailable`, never disappears into "unknown host" (rubric §1).
 */
export class Registry {
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly heartbeatTimeoutMs: number;

  constructor(heartbeatTimeoutMs: number) {
    this.heartbeatTimeoutMs = heartbeatTimeoutMs;
  }

  /** Register or heartbeat - same effect: upsert the entry, clear any unavailable reason. */
  upsert(params: {
    readonly agentId: string;
    readonly hostId: string;
    readonly label: string;
    readonly version: string;
    readonly reachableUrl: string;
  }): void {
    this.entries.set(params.agentId, {
      ...params,
      lastHeartbeatAt: Date.now(),
      unavailableReason: null,
    });
  }

  /** Clean shutdown - marks `unavailable` with reason `stopped`, does NOT delete. */
  markStopped(agentId: string): void {
    const existing = this.entries.get(agentId);
    if (existing === undefined) return;
    this.entries.set(agentId, { ...existing, unavailableReason: "stopped" });
  }

  get(agentId: string): RegistryEntry | null {
    return this.entries.get(agentId) ?? null;
  }

  findByHostId(hostId: string): RegistryEntry | null {
    for (const entry of this.entries.values()) {
      if (entry.hostId === hostId) return entry;
    }
    return null;
  }

  /** All ever-registered entries, each with its derived `status`. */
  list(): ReadonlyArray<RegistryEntry & { readonly status: HostAvailability }> {
    return [...this.entries.values()].map((entry) => ({
      ...entry,
      status: this.statusOf(entry),
    }));
  }

  statusFor(hostId: string): HostAvailability | "unknown" {
    const entry = this.findByHostId(hostId);
    if (entry === null) return "unknown";
    return this.statusOf(entry);
  }

  private statusOf(entry: RegistryEntry): HostAvailability {
    if (entry.unavailableReason !== null) return "unavailable";
    const lapsed = Date.now() - entry.lastHeartbeatAt >= this.heartbeatTimeoutMs;
    return lapsed ? "unavailable" : "available";
  }

  /**
   * Lazily flips a lapsed-but-not-yet-marked entry's reason to
   * `heartbeat_lapsed` so `list()`/external readers see a stable reason,
   * not just a derived status. Called opportunistically (e.g. before
   * serving `GET /hosts`) rather than on a timer - correctness doesn't
   * depend on when this runs, only that `statusOf` is timer-independent.
   */
  reconcileLapsedHeartbeats(): void {
    const now = Date.now();
    for (const [agentId, entry] of this.entries) {
      if (
        entry.unavailableReason === null &&
        now - entry.lastHeartbeatAt >= this.heartbeatTimeoutMs
      ) {
        this.entries.set(agentId, { ...entry, unavailableReason: "heartbeat_lapsed" });
      }
    }
  }
}
