import { readJsonFileOrNull, writeJsonFileAtomic } from "./storage/fs-atomic";
import { subscriptionsPath } from "./storage/paths";

export interface PushSubscriptionKeys {
  readonly p256dh: string;
  readonly auth: string;
}

/** One browser's `PushSubscription`, persisted keyed by `endpoint`. */
export interface StoredPushSubscription {
  readonly endpoint: string;
  readonly keys: PushSubscriptionKeys;
  readonly subscribedAt: number;
}

/**
 * Registered push subscriptions, persisted to `~/.traycer/push-service/subscriptions.json`.
 * Single-writer, single-process — every mutation reads the in-memory list and
 * rewrites the whole file, which is fine at this scale (a handful of devices
 * per user, subscribe/unsubscribe calls are rare).
 */
export class SubscriptionStore {
  private readonly path: string;
  private subscriptions: StoredPushSubscription[] = [];
  private loaded = false;

  /** `path` defaults to the real `~/.traycer/push-service/subscriptions.json`; tests inject a temp path so they never touch real runtime state. */
  constructor(path: string = subscriptionsPath()) {
    this.path = path;
  }

  async load(): Promise<void> {
    const stored = await readJsonFileOrNull<StoredPushSubscription[]>(this.path);
    this.subscriptions = Array.isArray(stored) ? stored : [];
    this.loaded = true;
  }

  private assertLoaded(): void {
    if (!this.loaded) {
      throw new Error("SubscriptionStore.load() must be awaited before use");
    }
  }

  list(): readonly StoredPushSubscription[] {
    this.assertLoaded();
    return this.subscriptions;
  }

  /** Upserts by `endpoint`: re-subscribing the same endpoint refreshes `subscribedAt`, never duplicates. */
  async upsert(
    endpoint: string,
    keys: PushSubscriptionKeys,
    now: number,
  ): Promise<void> {
    this.assertLoaded();
    const next: StoredPushSubscription = { endpoint, keys, subscribedAt: now };
    const existingIndex = this.subscriptions.findIndex(
      (s) => s.endpoint === endpoint,
    );
    if (existingIndex === -1) {
      this.subscriptions = [...this.subscriptions, next];
    } else {
      this.subscriptions = this.subscriptions.map((s, i) =>
        i === existingIndex ? next : s,
      );
    }
    await this.persist();
  }

  /** Removes by `endpoint`. Idempotent — a no-op (not an error) when absent. */
  async remove(endpoint: string): Promise<void> {
    this.assertLoaded();
    this.subscriptions = this.subscriptions.filter(
      (s) => s.endpoint !== endpoint,
    );
    await this.persist();
  }

  private async persist(): Promise<void> {
    await writeJsonFileAtomic(this.path, this.subscriptions);
  }
}
