/**
 * Fleet as a real Fluent `DataGrid` — the thing the card version could not be.
 *
 * What a grid buys over 8 stacked cards: sortable columns, a scannable status
 * column, consistent row height, keyboard navigation, and selection — all from
 * the host's own design system rather than hand-built. The card fleet had to
 * encode status in prose ("active"/"idle") because a card has no columns.
 *
 * WHAT IT COSTS, and why the phone width is shot rather than assumed: a data
 * grid is a desktop control. At 320px, columns either overflow or squeeze to
 * uselessness, and a list is genuinely better. So this renders a grid at
 * comfortable widths and switches to a list below `NARROW_PX` — decided from
 * the images, not from taste.
 *
 * `resizableColumns` IS on, and not for the resizing. Fluent's
 * `columnSizingOptions` is part of the column-resizing feature and is ignored
 * entirely without it — the first render had it off "because a five-column
 * grid already fits", and the result was every agent name truncated to
 * "A2 Identity Registr…" at 800px while a third of the row sat empty. The
 * sizing hints were being silently discarded and the comment justifying the
 * choice was the reason nobody looked. Caught in the screenshot.
 */
import {
  Badge,
  Button,
  createTableColumn,
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridRow,
  makeStyles,
  Text,
  tokens,
  type TableColumnDefinition,
} from "@fluentui/react-components";
import { useState, type ReactElement } from "react";
import {
  byUrgency,
  displayName,
  fleetStatus,
  type FleetAgent,
  type FleetStatus,
} from "./fleet-types";

/**
 * Below this width the grid becomes a list.
 *
 * Measured, not derived. The grid's fixed layout is ~808px wide whatever the
 * column hints say, so anything narrower than that makes it scroll sideways
 * inside `gridScroll`. Scrolling to read a row is worse than a list that
 * gives the agent name the whole width — at 500 the grid rendered names as
 * "Research: gui-app RPC …" while the list showed them in full.
 *
 * An earlier version of this comment did the arithmetic on paper (740 ideal
 * widths + 40 padding) and was simply wrong; see `gridScroll`. If this number
 * changes, re-measure `scrollWidth` rather than recomputing it.
 */
export const NARROW_PX = 780;

const useStyles = makeStyles({
  root: { width: "100%" },
  name: { fontWeight: tokens.fontWeightSemibold },
  // A row is a target, so it gets a pointer and a hover — a grid that looks
  // inert reads as a report rather than as navigation.
  row: { cursor: "pointer" },
  listItem: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    paddingTop: tokens.spacingVerticalS,
    paddingBottom: tokens.spacingVerticalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    cursor: "pointer",
  },
  listTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalS,
    // `minWidth: 0` lets the NAME be the thing that shrinks. Without it a
    // flex item refuses to go below its content width, so the row squeezed
    // the badge instead and "Waiting on you" wrapped and spilled outside its
    // own pill at 320px. Only visible in a render.
    minWidth: 0,
  },
  listName: { minWidth: 0, flexShrink: 1 },
  /** The badge is a fixed affordance: it truncates nothing and shrinks never. */
  badgeCell: { flexShrink: 0 },
  subtle: { color: tokens.colorNeutralForeground3 },
  idleToggle: { alignSelf: "flex-start", marginTop: tokens.spacingVerticalS },
  /**
   * The grid scrolls sideways INSIDE this box rather than pushing the page.
   *
   * Measured, after two wrong guesses. `resizableColumns` makes Fluent give
   * the table a FIXED total width computed from the column hints — it does
   * not fluidly fit its container. So the choice is really:
   *   - no `resizableColumns`: fluid, but every sizing hint is discarded and
   *     the agent name truncates to nothing;
   *   - `resizableColumns`: sizing works, but the table can be wider than the
   *     space it is given.
   * Shrinking the hints did not help — `scrollWidth` stayed at 808 for an
   * 800px viewport whatever the numbers were, because the overflow is the
   * table's own padding and borders on a fixed-width layout.
   *
   * A horizontally scrolling GRID is a normal control. A horizontally
   * scrolling PAGE is a defect, and that is what was shipping.
   */
  gridScroll: { width: "100%", overflowX: "auto" },
  empty: {
    padding: tokens.spacingVerticalXXL,
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
});

/** Semantic colour only — never a hex. Same rule the cards settled on. */
function StatusBadge({
  status,
}: {
  readonly status: FleetStatus;
}): ReactElement {
  switch (status) {
    case "blocked":
      return (
        <Badge appearance="filled" color="danger">
          Waiting on you
        </Badge>
      );
    case "running":
      return (
        <Badge appearance="filled" color="success">
          Running
        </Badge>
      );
    case "idle":
      return (
        <Badge appearance="outline" color="informative">
          Idle
        </Badge>
      );
    case "remote":
      // NOT "Idle". This host cannot see a remote agent's activity at all —
      // `active` is local-only — so "Idle" would be a claim we have no basis
      // for. "On another host" says exactly what we know and no more.
      return (
        <Badge appearance="tint" color="informative">
          On another host
        </Badge>
      );
  }
}

function waitingLabel(agent: FleetAgent): string {
  const total = agent.pendingApprovals + agent.pendingInterviews;
  if (total === 0) return "—";
  const parts: string[] = [];
  if (agent.pendingApprovals > 0) {
    parts.push(
      `${String(agent.pendingApprovals)} approval${agent.pendingApprovals === 1 ? "" : "s"}`,
    );
  }
  if (agent.pendingInterviews > 0) {
    parts.push(
      `${String(agent.pendingInterviews)} interview${agent.pendingInterviews === 1 ? "" : "s"}`,
    );
  }
  return parts.join(", ");
}

export function relativeTime(at: number | null, now: number): string {
  if (at === null) return "—";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${String(seconds)}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  return `${String(Math.round(hours / 24))}d ago`;
}

interface FleetGridProps {
  readonly agents: readonly FleetAgent[];
  readonly now: number;
  readonly width: number;
  readonly onOpen: (agentId: string) => void;
  /**
   * Forces grid or list regardless of width. Exists so the two can be
   * screenshotted side by side at the SAME width and the choice made from
   * images rather than from preference — "Fluent" is the commitment, "data
   * grid" is a per-surface decision.
   */
  readonly forceView?: "grid" | "list";
}

export function FleetGrid({
  agents,
  now,
  width,
  onOpen,
  forceView,
}: FleetGridProps): ReactElement {
  const styles = useStyles();
  const [showIdle, setShowIdle] = useState(false);

  const sorted = [...agents].sort(byUrgency);
  /**
   * Collapse what you CANNOT ACT ON, not what is merely quiet.
   *
   * This collapsed `idle` when idle was the only inert state. Then `remote`
   * arrived, and against the real fleet the result was exactly inverted: the
   * 53 rows this host cannot touch were all expanded, and the 3 local agents
   * — the only ones you can do anything with — were hidden behind "Show 3
   * idle agents". Caught in the render with the real 53/3 distribution; the
   * friendly 8-agent fixture could never have shown it, because it had no
   * remote rows at all.
   *
   * The rule that survives both distributions: hide the unactionable tail,
   * whatever is currently making it unactionable.
   */
  const hiddenCount = sorted.filter((a) => fleetStatus(a) === "remote").length;
  const visible = showIdle
    ? sorted
    : sorted.filter((a) => fleetStatus(a) !== "remote");

  if (sorted.length === 0) {
    return (
      <div className={styles.empty}>
        <Text>No agents in this epic yet.</Text>
      </div>
    );
  }

  const idleToggle =
    hiddenCount === 0 ? null : (
      <Button
        appearance="subtle"
        size="small"
        className={styles.idleToggle}
        onClick={() => {
          setShowIdle((v) => !v);
        }}
      >
        {showIdle
          ? `Hide the ${String(hiddenCount)} on other hosts`
          : `Show ${String(hiddenCount)} agent${hiddenCount === 1 ? "" : "s"} on other hosts`}
      </Button>
    );

  const useList =
    forceView === "list" || (forceView !== "grid" && width < NARROW_PX);

  if (useList) {
    return (
      <div className={styles.root}>
        {visible.map((agent) => (
          <div
            key={agent.agentId}
            className={styles.listItem}
            role="button"
            tabIndex={0}
            onClick={() => {
              onOpen(agent.agentId);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onOpen(agent.agentId);
            }}
          >
            <div className={styles.listTop}>
              <Text
                className={`${styles.name} ${styles.listName}`}
                truncate
                wrap={false}
              >
                {displayName(agent)}
              </Text>
              <span className={styles.badgeCell}>
                <StatusBadge status={fleetStatus(agent)} />
              </span>
            </div>
            <Text size={200} className={styles.subtle}>
              {[
                agent.harnessId ?? agent.surface,
                waitingLabel(agent) === "—" ? null : waitingLabel(agent),
                relativeTime(agent.lastActivityAt, now),
              ]
                .filter((p): p is string => p !== null)
                .join(" · ")}
            </Text>
          </div>
        ))}
        {idleToggle}
      </div>
    );
  }

  const columns: TableColumnDefinition<FleetAgent>[] = [
    createTableColumn<FleetAgent>({
      columnId: "name",
      compare: (a, b) => displayName(a).localeCompare(displayName(b)),
      renderHeaderCell: () => "Agent",
      renderCell: (agent) => (
        <Text className={styles.name} truncate wrap={false}>
          {displayName(agent)}
        </Text>
      ),
    }),
    createTableColumn<FleetAgent>({
      columnId: "status",
      compare: (a, b) => byUrgency(a, b),
      renderHeaderCell: () => "Status",
      renderCell: (agent) => <StatusBadge status={fleetStatus(agent)} />,
    }),
    createTableColumn<FleetAgent>({
      columnId: "waiting",
      compare: (a, b) =>
        a.pendingApprovals +
        a.pendingInterviews -
        (b.pendingApprovals + b.pendingInterviews),
      renderHeaderCell: () => "Waiting on you",
      renderCell: (agent) => <Text>{waitingLabel(agent)}</Text>,
    }),
    createTableColumn<FleetAgent>({
      columnId: "harness",
      compare: (a, b) =>
        (a.harnessId ?? a.surface).localeCompare(b.harnessId ?? b.surface),
      renderHeaderCell: () => "Harness",
      renderCell: (agent) => <Text>{agent.harnessId ?? agent.surface}</Text>,
    }),
    createTableColumn<FleetAgent>({
      columnId: "activity",
      compare: (a, b) => (a.lastActivityAt ?? 0) - (b.lastActivityAt ?? 0),
      renderHeaderCell: () => "Last activity",
      renderCell: (agent) => (
        <Text className={styles.subtle}>
          {relativeTime(agent.lastActivityAt, now)}
        </Text>
      ),
    }),
  ];

  /**
   * The name column's width, derived from the viewport rather than fixed.
   *
   * The subtractions are the MEASURED overheads from the note below — ~68px
   * of grid chrome and 40px of page padding — not fresh arithmetic. At 800px
   * this yields 242, i.e. essentially the 240 that was measured not to
   * overflow, so widening cannot reintroduce the horizontal page scrollbar it
   * replaced. Above that the name simply takes the room that was going spare.
   *
   * Capped, because a 1400px name column on an ultrawide monitor is its own
   * kind of wrong — past a point the line becomes hard to track back to its
   * row rather than easier to read.
   */
  const FIXED_COLUMNS = 130 + 140 + 80 + 100;
  const GRID_CHROME = 68;
  const PAGE_PADDING = 40;
  const nameWidth = Math.min(
    800,
    Math.max(240, width - PAGE_PADDING - GRID_CHROME - FIXED_COLUMNS),
  );

  return (
    <>
      <div className={styles.gridScroll}>
        <DataGrid
          className={styles.root}
          items={visible}
          columns={columns}
          sortable
          resizableColumns
          getRowId={(agent) => agent.agentId}
          focusMode="composite"
          /**
           * MEASURED, not calculated. The previous values summed to 740 and the
           * comment here claimed that fit inside 760 — it did not.
           * `document.documentElement.scrollWidth` came back **808** at an
           * 800px viewport, because the grid adds its own cell padding and
           * borders on top of the column widths (~68px across five columns).
           * The arithmetic was asserted and never checked, which is how a
           * horizontal page scrollbar shipped in a layout I had "verified".
           *
           * The fixed hints then caused the OPPOSITE defect at the other end.
           * Because `resizableColumns` gives the table a fixed total width,
           * the grid stayed ~690px wide however wide the window was — so at
           * 1200px the agent name truncated to "Research: cache invalidation
           * strateg…" with roughly half the viewport sitting empty beside it.
           * Elliot's own screenshot of the live tab shows it. Truncating the
           * one column carrying the information, while the space it needs is
           * visibly unused, is the sort of thing that reads as broken.
           *
           * So the name column ABSORBS the slack and the others stay fixed:
           * name is the only column whose content is unbounded, and the only
           * one that gets better with more room. `status`/`waiting` are short
           * labels that would just gain padding.
           */
          columnSizingOptions={{
            name: { minWidth: 160, idealWidth: nameWidth },
            status: { minWidth: 120, idealWidth: 130 },
            waiting: { minWidth: 110, idealWidth: 140 },
            harness: { minWidth: 70, idealWidth: 80 },
            activity: { minWidth: 90, idealWidth: 100 },
          }}
        >
          <DataGridHeader>
            <DataGridRow>
              {({ renderHeaderCell }) => (
                <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
              )}
            </DataGridRow>
          </DataGridHeader>
          <DataGridBody<FleetAgent>>
            {({ item, rowId }) => (
              <DataGridRow<FleetAgent>
                key={rowId}
                className={styles.row}
                onClick={() => {
                  onOpen(item.agentId);
                }}
              >
                {({ renderCell }) => (
                  <DataGridCell>{renderCell(item)}</DataGridCell>
                )}
              </DataGridRow>
            )}
          </DataGridBody>
        </DataGrid>
      </div>
      {idleToggle}
    </>
  );
}
