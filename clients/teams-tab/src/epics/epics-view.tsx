/**
 * The Epics tab: the user's real epics from `epic.listTasks`.
 *
 * COLUMNS ARE WHAT THE RESPONSE CARRIES, nothing more. `epic.listTasks`
 * returns a title, four artifact counts, a freeform lifecycle status and
 * timestamps — so those are the row, and nothing else appears. The rule that
 * has held all week: if a column has no source, it does not exist. An empty
 * column is not neutral; it asserts a value.
 *
 * In particular there is no "waiting on you" here. That question is
 * user-scoped and cross-epic and belongs to `notifications.subscribe`; faking
 * it from a list call would be the `active: false` → "53 idle" defect one
 * surface over.
 */
import type { ReactElement } from "react";
import {
  Body1,
  Button,
  Caption1,
  Subtitle2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  formatEpicMeta,
  type FleetEpic,
} from "@traycer-clients/shared/epic/epic-list";
import { FleetEmpty, FleetError, FleetLoading, FleetStale } from "../fleet/fleet-state";
import type { EpicsState } from "./use-epics";
import { relativeTime } from "../fleet/fleet-grid";

const useStyles = makeStyles({
  list: {
    display: "flex",
    flexDirection: "column",
  },
  row: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    paddingTop: tokens.spacingVerticalM,
    paddingBottom: tokens.spacingVerticalM,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  // `minWidth: 0` lets the TITLE be what shrinks. Without it a long title
  // pushes the timestamp off the row instead of ellipsising itself.
  main: { minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" },
  title: {
    fontWeight: tokens.fontWeightSemibold,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  subtle: { color: tokens.colorNeutralForeground3 },
  when: { color: tokens.colorNeutralForeground3, flexShrink: 0 },
  more: { alignSelf: "flex-start", marginTop: tokens.spacingVerticalM },
});

export interface EpicsViewProps {
  readonly state: EpicsState;
  readonly now: number;
  readonly onReload: () => void;
  readonly onLoadMore: () => void;
  readonly onOpen: (epicId: string) => void;
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
  if (state.epics.length === 0) {
    return <FleetEmpty hostId="this host" />;
  }

  return (
    <>
      {/*
        Rows stay under the banner rather than being replaced. "We last saw
        this" and "you have none" are different claims and only one of them is
        still supportable once contact is lost.
      */}
      {state.stale ? <FleetStale onRetry={onReload} /> : null}
      <div className={styles.list}>
        {state.epics.map((epic: FleetEpic) => {
          const meta = formatEpicMeta(epic);
          return (
            <div
              key={epic.id}
              className={styles.row}
              role="button"
              tabIndex={0}
              onClick={() => {
                onOpen(epic.id);
              }}
              onKeyDown={(e) => {
                // Keyboard parity: a div with role="button" is not focusable
                // or activatable on its own, and a Teams tab is used with a
                // keyboard far more than a phone is.
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(epic.id);
                }
              }}
            >
              <div className={styles.main}>
                <Body1 className={styles.title}>{epic.title}</Body1>
                {meta.length > 0 ? (
                  <Caption1 className={styles.subtle}>{meta}</Caption1>
                ) : null}
              </div>
              <Caption1 className={styles.when}>
                {relativeTime(epic.updatedAt, now)}
              </Caption1>
            </div>
          );
        })}
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

export function EpicsHeading({ count }: { count: number | null }): ReactElement {
  return (
    <Subtitle2>{count === null ? "Epics" : `Epics · ${String(count)}`}</Subtitle2>
  );
}
