/**
 * The app-level notifications screen — bell → here.
 *
 * PARITY NOTE, since the contract had two rows that read like one. The tab
 * already had "Waiting on you", and that is NOT this screen: it renders the
 * feed's `attention` slice — the short list of things blocked on a human,
 * oldest first, with no read state. This screen is mobile's bell surface:
 * every entry, read state, day grouping, and the two writes that clear them.
 * Same feed, different question, which is why both exist here and on mobile.
 *
 * ROW COPY COMES FROM THE PROTOCOL. `formatHostNotificationPresentation` is
 * the same formatter the host and desktop use, so the wording of "Approval
 * requested" or a stopped-agent reason cannot drift between surfaces — and
 * unknown or malformed payloads degrade to safe generic copy there rather than
 * being hand-formatted (and hand-mis-formatted) here.
 *
 * SCOPED DOWN from desktop's category facets (Task activity / Collaboration /
 * System issues), for the reason mobile records: those are not derivable from
 * the wire's `kind` enum without inventing a mapping. This ships the same
 * unread-only toggle mobile does. Flagged, not silently missing.
 *
 * WHAT THIS SCREEN DOES NOT DO, stated so it is not read as complete: it does
 * not configure notification severities or the browser permission (mobile's
 * settings screen owns those, and the tab has no settings screen yet — see the
 * parity contract's remaining chrome rows).
 */
import { useCallback, useMemo, useState, type ReactElement } from "react";
import {
  Body1,
  Button,
  Caption1,
  Link,
  makeStyles,
  MessageBar,
  MessageBarBody,
  Spinner,
  Subtitle1,
  Subtitle2,
  Switch,
  tokens,
} from "@fluentui/react-components";
import {
  AlertOffRegular,
  CheckmarkCircleRegular,
  DismissRegular,
} from "@fluentui/react-icons";
import type { HostNotificationEntry } from "@traycer/protocol/host/notifications/host-notifications";
import { formatHostNotificationPresentation } from "@traycer/protocol/host/notifications/presentation";
import {
  formatNotificationAge,
  groupByDay,
  isAttentionEntry,
} from "@traycer-clients/shared/epic/host-notifications-grouping";
import {
  markAllNotificationsRead,
  markNotificationsRead,
  resolveNotifications,
  type HostNotificationMutationClient,
} from "@traycer-clients/shared/epic/host-notification-mutations";
import type { NotificationsState } from "./use-notifications";

const useStyles = makeStyles({
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    marginBottom: tokens.spacingVerticalM,
  },
  sectionLabel: {
    color: tokens.colorNeutralForeground3,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  list: { listStyle: "none", margin: 0, padding: 0 },
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: tokens.spacingHorizontalS,
    paddingTop: tokens.spacingVerticalS,
    paddingBottom: tokens.spacingVerticalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  /**
   * The severity stripe. A 3px bar rather than coloured text, so the signal
   * survives high-contrast themes — where foreground colours are overridden
   * and a "red title" silently stops being red.
   */
  stripe: {
    width: "3px",
    alignSelf: "stretch",
    borderRadius: tokens.borderRadiusSmall,
    flexShrink: 0,
  },
  stripeNeedsAction: { backgroundColor: tokens.colorPaletteYellowBorderActive },
  stripeFailure: { backgroundColor: tokens.colorPaletteRedBorderActive },
  stripeDone: { backgroundColor: tokens.colorBrandBackground },
  stripeInfo: { backgroundColor: tokens.colorNeutralStroke1 },
  body: { display: "flex", flexDirection: "column", minWidth: 0, flexGrow: 1 },
  titleRow: {
    display: "flex",
    alignItems: "baseline",
    gap: tokens.spacingHorizontalXS,
  },
  title: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  unreadDot: {
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    backgroundColor: tokens.colorBrandBackground,
    flexShrink: 0,
  },
  age: { color: tokens.colorNeutralForeground3, flexShrink: 0 },
  detail: { color: tokens.colorNeutralForeground2 },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: tokens.spacingVerticalS,
    paddingTop: tokens.spacingVerticalXXL,
    paddingBottom: tokens.spacingVerticalXXL,
    color: tokens.colorNeutralForeground3,
  },
});

export interface NotificationsScreenProps {
  readonly state: NotificationsState;
  /** `null` under preview, which disables the writes rather than faking them. */
  readonly client: HostNotificationMutationClient | null;
  /** One clock for the whole render, so two rows never disagree about "now". */
  readonly now: number;
  readonly onOpenChat: (epicId: string, chatId: string) => void;
  readonly onOpenEpic: (epicId: string) => void;
}

export function NotificationsScreen({
  state,
  client,
  now,
  onOpenChat,
  onOpenEpic,
}: NotificationsScreenProps): ReactElement {
  const styles = useStyles();
  const [unreadOnly, setUnreadOnly] = useState(false);

  const summary = state.kind === "ready" ? state.summary : null;

  /**
   * Derived INSIDE the memo, from `state` itself. Hoisting
   * `state.kind === "ready" ? state.entries : []` to a const above allocates a
   * fresh `[]` on every non-ready render, so every downstream memo keyed on it
   * recomputes every render — the memo silently doing nothing while looking
   * like it works.
   */
  const visible = useMemo(() => {
    const all = state.kind === "ready" ? state.entries : [];
    return unreadOnly ? all.filter((e) => e.readAt === null) : all;
  }, [state, unreadOnly]);
  const attention = useMemo(() => visible.filter(isAttentionEntry), [visible]);
  const recent = useMemo(
    () => visible.filter((e) => !isAttentionEntry(e)),
    [visible],
  );
  const grouped = useMemo(() => groupByDay(recent, now), [recent, now]);

  const handleOpen = useCallback(
    (entry: HostNotificationEntry): void => {
      // Marked read on OPEN, not on render. A row you scrolled past is not a
      // row you dealt with, and clearing it would drop the one signal telling
      // you to come back to it.
      if (entry.readAt === null && client !== null) {
        void markNotificationsRead(client, [entry.id]);
      }
      if (entry.chatId !== null && entry.epicId !== null) {
        onOpenChat(entry.epicId, entry.chatId);
      } else if (entry.epicId !== null) {
        onOpenEpic(entry.epicId);
      }
      // No epic and no chat: the row is informational and there is nowhere to
      // go. It is still marked read above, which is the whole of what opening
      // it can mean.
    },
    [client, onOpenChat, onOpenEpic],
  );

  const handleDismiss = useCallback(
    (entry: HostNotificationEntry): void => {
      if (client === null) return;
      // `resolvedAt` exists only on the approval/interview variants, and for
      // those "dismiss" means RESOLVE the occurrence — marking one read would
      // hide the row while leaving the agent still waiting.
      if ("resolvedAt" in entry) {
        void resolveNotifications(client, [
          { id: entry.id, updatedAt: entry.updatedAt, sourceRef: entry.sourceRef },
        ]);
      } else {
        void markNotificationsRead(client, [entry.id]);
      }
    },
    [client],
  );

  const handleMarkAllRead = useCallback((): void => {
    if (client === null) return;
    // The cutoff is THIS render's clock, so a notification that arrives while
    // the list is open is not marked read without ever having been seen.
    void markAllNotificationsRead(client, now);
  }, [client, now]);

  if (state.kind === "loading") {
    return (
      <>
        <Subtitle1>Notifications</Subtitle1>
        <Spinner size="tiny" label="Loading notifications…" />
      </>
    );
  }

  if (state.kind === "error") {
    return (
      <>
        <Subtitle1>Notifications</Subtitle1>
        <MessageBar intent="error">
          <MessageBarBody>{state.detail}</MessageBarBody>
        </MessageBar>
      </>
    );
  }

  return (
    <>
      <div className={styles.header}>
        <Subtitle1>Notifications</Subtitle1>
        <Button
          size="small"
          appearance="subtle"
          icon={<CheckmarkCircleRegular />}
          // Driven by the HOST's count, not by what this page holds. We hold a
          // paged slice, so "nothing unread here" and "nothing unread" are
          // different facts and only one of them should disable the button.
          disabled={client === null || (summary?.unreadCount ?? 0) === 0}
          onClick={handleMarkAllRead}
        >
          Mark all read
        </Button>
      </div>

      <div className={styles.toolbar}>
        <Switch
          checked={unreadOnly}
          onChange={(_, data) => {
            setUnreadOnly(data.checked);
          }}
          label="Unread only"
        />
      </div>

      {visible.length === 0 ? (
        <div className={styles.empty}>
          <AlertOffRegular fontSize={28} aria-hidden="true" />
          <Body1>
            {unreadOnly ? "Nothing unread." : "You’re all caught up."}
          </Body1>
        </div>
      ) : (
        <>
          {/*
            "Needs attention" is NOT narrowed by the unread toggle, because its
            own definition already includes unread. Filtering it again would
            let the toggle empty the section it exists to protect.
          */}
          <Section
            label="Needs attention"
            entries={attention}
            now={now}
            canWrite={client !== null}
            onOpen={handleOpen}
            onDismiss={handleDismiss}
          />
          <Section
            label="Today"
            entries={grouped.today}
            now={now}
            canWrite={client !== null}
            onOpen={handleOpen}
            onDismiss={handleDismiss}
          />
          <Section
            label="Yesterday"
            entries={grouped.yesterday}
            now={now}
            canWrite={client !== null}
            onOpen={handleOpen}
            onDismiss={handleDismiss}
          />
          <Section
            label="Earlier"
            entries={grouped.earlier}
            now={now}
            canWrite={client !== null}
            onOpen={handleOpen}
            onDismiss={handleDismiss}
          />
        </>
      )}
    </>
  );
}

/** Renders nothing at all when empty — an empty heading is a section lying. */
function Section({
  label,
  entries,
  now,
  canWrite,
  onOpen,
  onDismiss,
}: {
  readonly label: string;
  readonly entries: readonly HostNotificationEntry[];
  readonly now: number;
  readonly canWrite: boolean;
  readonly onOpen: (entry: HostNotificationEntry) => void;
  readonly onDismiss: (entry: HostNotificationEntry) => void;
}): ReactElement | null {
  const styles = useStyles();
  if (entries.length === 0) return null;
  return (
    <section className={styles.section}>
      <Subtitle2 as="h2" className={styles.sectionLabel}>
        <Caption1>{label}</Caption1>
      </Subtitle2>
      <ul className={styles.list}>
        {entries.map((entry) => (
          <Row
            key={entry.id}
            entry={entry}
            now={now}
            canWrite={canWrite}
            onOpen={onOpen}
            onDismiss={onDismiss}
          />
        ))}
      </ul>
    </section>
  );
}

function Row({
  entry,
  now,
  canWrite,
  onOpen,
  onDismiss,
}: {
  readonly entry: HostNotificationEntry;
  readonly now: number;
  readonly canWrite: boolean;
  readonly onOpen: (entry: HostNotificationEntry) => void;
  readonly onDismiss: (entry: HostNotificationEntry) => void;
}): ReactElement {
  const styles = useStyles();
  // The protocol's own copy. See the module docblock.
  const { title, body } = formatHostNotificationPresentation(entry);
  const unread = entry.readAt === null;
  const stripe =
    entry.severity === "needs_action"
      ? styles.stripeNeedsAction
      : entry.severity === "failure"
        ? styles.stripeFailure
        : entry.severity === "done"
          ? styles.stripeDone
          : styles.stripeInfo;

  return (
    <li className={styles.row}>
      <span className={`${styles.stripe} ${stripe}`} aria-hidden="true" />
      <div className={styles.body}>
        <div className={styles.titleRow}>
          {unread ? <span className={styles.unreadDot} aria-hidden="true" /> : null}
          {/*
            A LINK, not a whole-row click target. The row also carries a
            dismiss button, and nesting an interactive control inside a
            clickable region is how a "dismiss" ends up also navigating.
          */}
          <Link
            className={styles.title}
            appearance="subtle"
            onClick={() => {
              onOpen(entry);
            }}
          >
            {title}
          </Link>
          <Caption1 className={styles.age}>
            {formatNotificationAge(entry.updatedAt, now)}
          </Caption1>
        </div>
        <Caption1 className={styles.detail}>{body}</Caption1>
      </div>
      <Button
        size="small"
        appearance="subtle"
        icon={<DismissRegular />}
        // Absent under preview rather than dead: there is no host to write to,
        // and a button that silently does nothing is the defect this client
        // keeps finding.
        disabled={!canWrite}
        aria-label={`Dismiss: ${title}`}
        onClick={() => {
          onDismiss(entry);
        }}
      />
    </li>
  );
}
