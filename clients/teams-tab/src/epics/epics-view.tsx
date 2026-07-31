/**
 * The Epics tab: the user's real epics from `epic.listTasks`.
 *
 * COLUMNS ARE WHAT THE RESPONSE CARRIES, nothing more. `epic.listTasks`
 * returns a title, four artifact counts, a freeform lifecycle status and
 * timestamps — so those are the row, and nothing else appears. If a column has
 * no source it does not exist: an empty column is not neutral, it asserts a
 * value. There is deliberately no "waiting on you" here; that question is
 * user-scoped and cross-epic and belongs to `notifications.subscribe`.
 *
 * ICONS CARRY SPEED, TEXT CARRIES MEANING. Every icon here sits beside its
 * label, never instead of it. Teams high contrast strips badge colour
 * entirely, and an icon-only status fails the same way for anyone who does
 * not already recognise the glyph — so the icon makes the line scannable and
 * the text makes it correct. An icon that distinguishes nothing is left out:
 * a column of identical glyphs is noise that costs vertical space at 320px.
 */
import type { ReactElement } from "react";
import {
  Body1,
  Button,
  Caption1,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  BookOpenRegular,
  ChevronRightRegular,
  CircleHintHalfVerticalRegular,
  ClipboardTaskListLtrRegular,
  CommentMultipleRegular,
  DocumentBulletListRegular,
} from "@fluentui/react-icons";
import {
  epicDisplayName,
  type FleetEpic,
} from "@traycer-clients/shared/epic/epic-list";
import {
  FleetEmpty,
  FleetError,
  FleetLoading,
  FleetStale,
} from "../fleet/fleet-state";
import type { EpicsState } from "./use-epics";
import { relativeTime } from "../fleet/fleet-grid";

const useStyles = makeStyles({
  list: { display: "flex", flexDirection: "column" },
  /**
   * The row is a real `<button>`, not a div with a click handler.
   *
   * "(not clickable)" was the first thing Elliot said about this list — the
   * row WAS interactive and neither looked nor behaved like it. A button gets
   * keyboard focus, Enter and Space, and the platform focus ring for free; a
   * div needs all three hand-rolled and usually ends up with two.
   */
  row: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    width: "100%",
    textAlign: "left",
    background: "none",
    border: "none",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalS}`,
    cursor: "pointer",
    color: tokens.colorNeutralForeground1,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
    ":active": { backgroundColor: tokens.colorNeutralBackground1Pressed },
  },
  leadIcon: { flexShrink: 0, color: tokens.colorNeutralForeground3 },
  // `minWidth: 0` lets the TITLE shrink. Without it a long title pushes the
  // timestamp and chevron off the row instead of ellipsising itself.
  main: {
    minWidth: 0,
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  title: {
    fontWeight: tokens.fontWeightSemibold,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    color: tokens.colorNeutralForeground3,
  },
  metaItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    whiteSpace: "nowrap",
  },
  when: { color: tokens.colorNeutralForeground3, flexShrink: 0 },
  chevron: { flexShrink: 0, color: tokens.colorNeutralForeground3 },
  more: { alignSelf: "flex-start", marginTop: tokens.spacingVerticalM },
});

/**
 * The metadata line as icon+count pairs rather than one run-on string.
 *
 * "39 tickets · 64 specs · 9 stories · 31 reviews" counts four different
 * things, and as plain text it reads as one smear of numbers. Each kind gets
 * its own glyph so the line can be scanned, and keeps its word so it can be
 * read. Zero counts stay omitted — "0 specs" is furniture, not information.
 */
function EpicMeta({ epic }: { epic: FleetEpic }): ReactElement | null {
  const styles = useStyles();
  const items: { key: string; icon: ReactElement; label: string }[] = [];
  if (epic.ticketCount > 0) {
    items.push({
      key: "tickets",
      icon: <ClipboardTaskListLtrRegular fontSize={14} />,
      label: `${String(epic.ticketCount)} ${epic.ticketCount === 1 ? "ticket" : "tickets"}`,
    });
  }
  if (epic.specCount > 0) {
    items.push({
      key: "specs",
      icon: <DocumentBulletListRegular fontSize={14} />,
      label: `${String(epic.specCount)} ${epic.specCount === 1 ? "spec" : "specs"}`,
    });
  }
  if (epic.storyCount > 0) {
    items.push({
      key: "stories",
      icon: <BookOpenRegular fontSize={14} />,
      label: `${String(epic.storyCount)} ${epic.storyCount === 1 ? "story" : "stories"}`,
    });
  }
  if (epic.reviewCount > 0) {
    items.push({
      key: "reviews",
      icon: <CommentMultipleRegular fontSize={14} />,
      label: `${String(epic.reviewCount)} ${epic.reviewCount === 1 ? "review" : "reviews"}`,
    });
  }
  const status = epic.status.trim();
  if (status.length > 0) {
    items.push({
      key: "status",
      icon: <CircleHintHalfVerticalRegular fontSize={14} />,
      label: status,
    });
  }
  if (items.length === 0) return null;

  return (
    <Caption1 className={styles.meta}>
      {items.map((item) => (
        // `aria-hidden` on the glyph: the word beside it already says what it
        // is, and announcing both makes every row read itself twice.
        <span key={item.key} className={styles.metaItem}>
          <span aria-hidden className={styles.leadIcon}>
            {item.icon}
          </span>
          {item.label}
        </span>
      ))}
    </Caption1>
  );
}

export interface EpicsViewProps {
  readonly state: EpicsState;
  readonly now: number;
  readonly onReload: () => void;
  readonly onLoadMore: () => void;
  readonly onOpen: (epic: FleetEpic) => void;
}

export function EpicsView({
  state,
  now,
  onReload,
  onLoadMore,
  onOpen,
}: EpicsViewProps): ReactElement {
  const styles = useStyles();

  if (state.kind === "loading") return <FleetLoading />;
  if (state.kind === "error") {
    return <FleetError detail={state.detail} onRetry={onReload} />;
  }
  if (state.epics.length === 0) return <FleetEmpty hostId="this host" />;

  return (
    <>
      {/*
        Rows stay UNDER the banner rather than being replaced. "We last saw
        this" and "you have none" are different claims, and only one of them
        survives losing contact.
      */}
      {state.stale ? (
        <FleetStale
          since={relativeTime(state.loadedAt, now)}
          onRetry={onReload}
        />
      ) : null}
      <div className={styles.list}>
        {state.epics.map((epic: FleetEpic) => (
          <button
            key={epic.id}
            type="button"
            className={styles.row}
            onClick={() => {
              onOpen(epic);
            }}
          >
            <span aria-hidden className={styles.leadIcon}>
              <ClipboardTaskListLtrRegular fontSize={20} />
            </span>
            <span className={styles.main}>
              <Body1 className={styles.title}>{epicDisplayName(epic)}</Body1>
              <EpicMeta epic={epic} />
            </span>
            <Caption1 className={styles.when}>
              {relativeTime(epic.updatedAt, now)}
            </Caption1>
            {/*
              The affordance whose absence produced "(not clickable)".
              `aria-hidden` because the row is already a button with an
              accessible name; announcing a second control inside it would
              imply two targets where there is one.
            */}
            <span aria-hidden className={styles.chevron}>
              <ChevronRightRegular fontSize={16} />
            </span>
          </button>
        ))}
      </div>
      {state.hasMore ? (
        <Button
          className={styles.more}
          appearance="subtle"
          disabled={state.loadingMore}
          onClick={onLoadMore}
        >
          {state.loadingMore ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </>
  );
}
