/**
 * The app-level notifications screen (bell → here). Sections: "Needs
 * attention" (unread blocking/failure rows, never filtered out) then
 * "Recent activity" grouped Today/Yesterday/Earlier. Row copy comes from
 * the SHARED `formatHostNotificationPresentation` (protocol package) — the
 * exact formatter the host/desktop use, so copy never drifts.
 *
 * Scoped down from desktop's category facets (Task activity/Collaboration/
 * System issues): those aren't derivable from the wire's `kind` enum
 * without inventing a mapping, so this ships a simpler Unread-only toggle
 * instead of full category filtering. Flagged, not silently missing.
 */
import { useMemo, useState, type ReactElement } from "react";
import { Bell, BellOff, CheckCheck } from "lucide-react";
import type { HostNotificationEntry } from "@traycer/protocol/host/notifications/host-notifications";
import { formatHostNotificationPresentation } from "@traycer/protocol/host/notifications/presentation";
import { useStreamConnectionOrNull } from "@/host/stream-connection-context";
import { useHostClientOrNull } from "@/host/host-client-context";
import { useHostNotifications, isAttentionEntry } from "@/host/use-host-notifications";
import { useNotificationMutations } from "@/host/use-notification-mutations";
import { Button, radius, screen, theme, type } from "@/views/design-tokens";

export interface NotificationsScreenProps {
  readonly onBack: () => void;
  readonly onOpenChat: (epicId: string, chatId: string) => void;
  readonly onOpenEpic: (epicId: string) => void;
}

function dayBucket(updatedAt: number): "today" | "yesterday" | "earlier" {
  const now = new Date();
  const then = new Date(updatedAt);
  const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(then)) / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  return "earlier";
}

function formatRelativeTime(timestamp: number): string {
  const diff = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function NotificationsScreen({ onBack, onOpenChat, onOpenEpic }: NotificationsScreenProps): ReactElement {
  const streamConnection = useStreamConnectionOrNull();
  const hostClient = useHostClientOrNull();
  const { entries, summary } = useHostNotifications(streamConnection);
  const { markRead, markAllRead, resolve } = useNotificationMutations(hostClient);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const visible = useMemo(
    () => (unreadOnly ? entries.filter((e) => e.readAt === null) : entries),
    [entries, unreadOnly],
  );
  const attention = useMemo(() => visible.filter(isAttentionEntry), [visible]);
  const recent = useMemo(() => visible.filter((e) => !isAttentionEntry(e)), [visible]);
  const grouped = useMemo(() => {
    const groups: Record<"today" | "yesterday" | "earlier", HostNotificationEntry[]> = {
      today: [],
      yesterday: [],
      earlier: [],
    };
    for (const entry of recent) groups[dayBucket(entry.updatedAt)].push(entry);
    return groups;
  }, [recent]);

  const handleOpen = (entry: HostNotificationEntry): void => {
    if (entry.readAt === null) void markRead([entry.id]);
    if (entry.chatId !== null) onOpenChat(entry.epicId ?? "", entry.chatId);
    else if (entry.epicId !== null) onOpenEpic(entry.epicId);
  };

  const handleDismiss = (entry: HostNotificationEntry): void => {
    if ("resolvedAt" in entry) {
      void resolve([{ id: entry.id, updatedAt: entry.updatedAt, sourceRef: entry.sourceRef }]);
    } else {
      void markRead([entry.id]);
    }
  };

  return (
    <main style={screen}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <Button variant="ghost" onClick={onBack}>
          ← Back
        </Button>
        <Button variant="ghost" onClick={() => void markAllRead()} disabled={summary.unreadCount === 0}>
          <CheckCheck size={14} aria-hidden="true" style={{ marginRight: 4 }} />
          Mark all read
        </Button>
      </header>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{ ...type.titleMd, margin: 0, color: theme.text }}>Notifications</h1>
        <button
          type="button"
          onClick={() => setUnreadOnly((v) => !v)}
          aria-pressed={unreadOnly}
          style={{
            minHeight: 32,
            padding: "0 10px",
            borderRadius: radius.md,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: unreadOnly ? theme.primary : theme.border,
            background: unreadOnly ? "color-mix(in oklch, var(--primary) 12%, transparent)" : "transparent",
            color: unreadOnly ? theme.primary : theme.mutedText,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Unread only
        </button>
      </div>

      {visible.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 16px", color: theme.mutedText }}>
          <BellOff size={28} aria-hidden="true" style={{ opacity: 0.6, marginBottom: 8 }} />
          <p style={{ ...type.bodySm, margin: 0 }}>You're all caught up</p>
        </div>
      ) : (
        <>
          {attention.length > 0 && (
            <NotificationSection
              label="Needs attention"
              entries={attention}
              onOpen={handleOpen}
              onDismiss={handleDismiss}
            />
          )}
          {grouped.today.length > 0 && (
            <NotificationSection label="Today" entries={grouped.today} onOpen={handleOpen} onDismiss={handleDismiss} />
          )}
          {grouped.yesterday.length > 0 && (
            <NotificationSection
              label="Yesterday"
              entries={grouped.yesterday}
              onOpen={handleOpen}
              onDismiss={handleDismiss}
            />
          )}
          {grouped.earlier.length > 0 && (
            <NotificationSection
              label="Earlier"
              entries={grouped.earlier}
              onOpen={handleOpen}
              onDismiss={handleDismiss}
            />
          )}
        </>
      )}
    </main>
  );
}

function NotificationSection({
  label,
  entries,
  onOpen,
  onDismiss,
}: {
  readonly label: string;
  readonly entries: readonly HostNotificationEntry[];
  readonly onOpen: (entry: HostNotificationEntry) => void;
  readonly onDismiss: (entry: HostNotificationEntry) => void;
}): ReactElement {
  return (
    <section style={{ marginBottom: 16 }}>
      <h2
        style={{
          ...type.bodyXs,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: theme.mutedText,
          margin: "0 0 6px",
        }}
      >
        {label}
      </h2>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {entries.map((entry) => (
          <NotificationRow key={entry.id} entry={entry} onOpen={() => onOpen(entry)} onDismiss={() => onDismiss(entry)} />
        ))}
      </ul>
    </section>
  );
}

const SEVERITY_COLOR: Readonly<Record<HostNotificationEntry["severity"], string>> = {
  info: theme.mutedText,
  needs_action: theme.warning,
  failure: theme.danger,
  done: theme.primary,
};

function NotificationRow({
  entry,
  onOpen,
  onDismiss,
}: {
  readonly entry: HostNotificationEntry;
  readonly onOpen: () => void;
  readonly onDismiss: () => void;
}): ReactElement {
  const presentation = formatHostNotificationPresentation(entry);
  const unread = entry.readAt === null;
  return (
    <li
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 4px",
        borderTop: `1px solid ${theme.borderHairline}`,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 3,
          alignSelf: "stretch",
          borderRadius: 2,
          background: unread ? theme.primary : "transparent",
          flexShrink: 0,
        }}
      />
      <Bell size={14} color={SEVERITY_COLOR[entry.severity]} aria-hidden="true" style={{ marginTop: 3, flexShrink: 0 }} />
      <button
        type="button"
        onClick={onOpen}
        style={{
          flex: 1,
          minWidth: 0,
          textAlign: "left",
          border: "none",
          background: "transparent",
          padding: 0,
          cursor: "pointer",
        }}
      >
        <div style={{ ...type.bodySm, fontWeight: unread ? 700 : 500, color: theme.text }}>{presentation.title}</div>
        <div style={{ ...type.bodyXs, color: theme.mutedText, marginTop: 2 }}>{presentation.body}</div>
      </button>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
        <span style={{ ...type.bodyXs, color: theme.mutedText }}>{formatRelativeTime(entry.updatedAt)}</span>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            border: "none",
            background: "transparent",
            color: theme.mutedText,
            fontSize: 11,
            cursor: "pointer",
            padding: 0,
          }}
        >
          {unread ? "Mark read" : "Dismiss"}
        </button>
      </div>
    </li>
  );
}
