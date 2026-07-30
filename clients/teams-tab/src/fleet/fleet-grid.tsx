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
import type { ReactElement } from "react";
import {
  byUrgency,
  displayName,
  fleetStatus,
  type FleetAgent,
  type FleetStatus,
} from "./fleet-types";

/**
 * Below this width the grid becomes a list. 780 = the five columns' ideal
 * widths (740) plus the page padding (40), and the two numbers are tied
 * together on purpose.
 *
 * Chosen from the renders rather than from a breakpoint convention. At the
 * previous 460 the grid rendered at 500px by squeezing every column below its
 * stated minimum, so agent names read "Research: gui-app RPC …" — while the
 * list form gives the name the entire row. A grid that has to truncate its
 * most important column is worse than a list, so the grid now appears only
 * where it genuinely fits.
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
}

export function FleetGrid({
  agents,
  now,
  width,
  onOpen,
}: FleetGridProps): ReactElement {
  const styles = useStyles();
  const sorted = [...agents].sort(byUrgency);

  if (sorted.length === 0) {
    return (
      <div className={styles.empty}>
        <Text>No agents in this epic yet.</Text>
      </div>
    );
  }

  if (width < NARROW_PX) {
    return (
      <div className={styles.root}>
        {sorted.map((agent) => (
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

  return (
    <DataGrid
      className={styles.root}
      items={sorted}
      columns={columns}
      sortable
      resizableColumns
      getRowId={(agent) => agent.agentId}
      focusMode="composite"
      // Ideal widths must sum to NARROW_PX minus the page padding, or the
      // grid overflows its container — visible in the 800px render as row
      // separators running off the right edge. 260+130+150+90+110 = 740.
      columnSizingOptions={{
        name: { minWidth: 160, idealWidth: 260 },
        status: { minWidth: 120, idealWidth: 130 },
        waiting: { minWidth: 110, idealWidth: 150 },
        harness: { minWidth: 70, idealWidth: 90 },
        activity: { minWidth: 90, idealWidth: 110 },
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
  );
}
