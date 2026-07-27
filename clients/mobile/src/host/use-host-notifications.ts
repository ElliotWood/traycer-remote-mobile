/**
 * The app-level notification bell + list — `host.notifications.feed.subscribe`
 * (host-local, JSON-frame notifications: agent stopped/stalled, workspace
 * op failed, approval/interview requested). This is a DIFFERENT system from
 * `notifications.subscribe` (the older per-user Yjs room) and from the
 * mobile-only `host/notifications.ts` (browser Notification API / SW
 * `showNotification` for the "chat became blocked" foreground alert) —
 * naming collision, not the same feature.
 *
 * No bespoke typed stream-client wrapper exists for this method (gui-app
 * itself calls `wsStreamClient.subscribe(...)` directly for the same
 * reason: it's the only consumer) — this hook does the same over
 * `HostStreamConnection.client`, hand-parsing frames against the contract's
 * own Zod schema, mirroring `NotificationsStreamClient`'s pattern in
 * `clients/shared/host-transport` for the sibling (older) stream.
 *
 * State model: `attention` and `recent` are two overlapping VIEWS the host
 * pages independently, but every entry carries a stable `id` — so rather
 * than tracking two separate cursor-paginated arrays, this hook merges
 * every entry it has ever seen into one `id`-keyed map and re-derives the
 * attention/recent split for display from each entry's own `severity`/
 * `resolvedAt` fields. `summary` (unreadCount/attentionCount) stays
 * server-authoritative — it is never recomputed client-side.
 */
import { useEffect, useState } from "react";
import {
  hostNotificationsSubscribeServerFrameSchema,
  type HostNotificationEntry,
  type HostNotificationsSummary,
} from "@traycer/protocol/host/notifications/host-notifications";
import type { StreamFrameEnvelope } from "@traycer-clients/shared/host-transport/i-stream-session";
import type { HostStreamConnection } from "./stream-connection";
import type { StreamConnectionState } from "./stream-connection";
import { toConnectionState } from "./stream-connection";

const INITIAL_ATTENTION_LIMIT = 100;
const INITIAL_RECENT_LIMIT = 100;

const DEFAULT_SUMMARY: HostNotificationsSummary = { unreadCount: 0, attentionCount: 0 };

export interface UseHostNotificationsResult {
  /** Every known entry, newest-first. */
  readonly entries: readonly HostNotificationEntry[];
  readonly summary: HostNotificationsSummary;
  readonly connection: StreamConnectionState;
}

/** Unread AND either blocking (`needs_action`) or a failure — the "Needs attention" section, never filtered out by the Recent/unread toggle. */
export function isAttentionEntry(entry: HostNotificationEntry): boolean {
  return entry.readAt === null && (entry.severity === "needs_action" || entry.severity === "failure");
}

export function useHostNotifications(
  streamConnection: HostStreamConnection | null,
): UseHostNotificationsResult {
  const [entriesById, setEntriesById] = useState<Readonly<Record<string, HostNotificationEntry>>>({});
  const [summary, setSummary] = useState<HostNotificationsSummary>(DEFAULT_SUMMARY);
  const [connection, setConnection] = useState<StreamConnectionState>("reconnecting");

  useEffect(() => {
    if (streamConnection === null) {
      setConnection("disconnected");
      return;
    }

    let disposed = false;
    const session = streamConnection.client.subscribe("host.notifications.feed.subscribe", {
      initialAttentionLimit: INITIAL_ATTENTION_LIMIT,
      initialRecentLimit: INITIAL_RECENT_LIMIT,
    });

    session.onServerFrame((envelope: StreamFrameEnvelope) => {
      if (disposed) return;
      const parsed = hostNotificationsSubscribeServerFrameSchema.safeParse(envelope);
      if (!parsed.success) return;
      const frame = parsed.data;
      switch (frame.kind) {
        case "snapshot": {
          const merged: Record<string, HostNotificationEntry> = {};
          for (const entry of [...frame.attention.entries, ...frame.recent.entries]) {
            merged[entry.id] = entry;
          }
          setEntriesById(merged);
          setSummary(frame.summary);
          return;
        }
        case "upserted": {
          setEntriesById((prev) => {
            const next = { ...prev };
            for (const id of frame.removedIds) delete next[id];
            next[frame.entry.id] = frame.entry;
            return next;
          });
          setSummary(frame.summary);
          return;
        }
        case "readStateChanged": {
          setEntriesById((prev) => {
            const next = { ...prev };
            for (const id of frame.removedIds) delete next[id];
            for (const id of frame.ids) {
              const existing = next[id];
              if (existing === undefined) continue;
              // `resolvedAt` only exists on the approval/interview variants
              // of the discriminated union — spreading it onto every kind
              // unconditionally would widen the type incorrectly.
              next[id] =
                "resolvedAt" in existing
                  ? { ...existing, readAt: frame.readAt, resolvedAt: frame.resolvedAt }
                  : { ...existing, readAt: frame.readAt };
            }
            return next;
          });
          setSummary(frame.summary);
          return;
        }
        case "removed": {
          setEntriesById((prev) => {
            const next = { ...prev };
            for (const id of frame.removedIds) delete next[id];
            return next;
          });
          setSummary(frame.summary);
          return;
        }
        case "cleared": {
          setEntriesById((prev) => {
            const next = { ...prev };
            for (const id of frame.removedIds) delete next[id];
            return next;
          });
          setSummary(frame.summary);
          return;
        }
        case "channelEmission":
        case "pong":
          // External-delivery-only (toast/push/hook) and heartbeat frames —
          // never change the in-app feed's own state.
          return;
      }
    });
    session.onStatusChange((status) => {
      if (disposed) return;
      setConnection(toConnectionState(status));
    });

    return () => {
      disposed = true;
      session.close();
    };
  }, [streamConnection]);

  const entries = Object.values(entriesById).sort((a, b) => b.updatedAt - a.updatedAt);

  return { entries, summary, connection };
}
