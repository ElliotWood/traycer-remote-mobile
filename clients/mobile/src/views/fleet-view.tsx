/**
 * Fleet view (T4, Flow 2): the signed-in home listing the user's epics.
 *
 * Each row is a piece of work — title plus light metadata (artifact counts and
 * freeform lifecycle status). The list is fetch-based, not streamed, so the
 * freshness affordance is an explicit Refresh, NOT a live indicator (Flow 2.5:
 * don't imply liveness the data can't back). Tapping a row drills into the epic
 * (the epic detail itself arrives in T5). An empty fleet shows a clear empty
 * state rather than a blank screen.
 */
import type { ReactElement } from "react";
import {
  formatEpicMeta,
  useEpicList,
  type FleetEpic,
} from "@/host/use-epic-list";
import type { MobileHostClient } from "@/host/host-client-context";
import { colors, primaryButton, row, secondaryButton, screen } from "./ui";

interface FleetViewProps {
  readonly client: MobileHostClient;
  readonly onOpenEpic: (epicId: string) => void;
  readonly onSignOut: () => void;
}

export function FleetView({
  client,
  onOpenEpic,
  onSignOut,
}: FleetViewProps): ReactElement {
  const list = useEpicList(client);

  return (
    <main style={screen}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <h1 style={{ fontSize: 20, margin: 0 }}>Your work</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            style={secondaryButton}
            onClick={list.refetch}
            disabled={list.isRefetching || list.isLoading}
          >
            {list.isRefetching ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" style={secondaryButton} onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <FleetBody list={list} onOpenEpic={onOpenEpic} />
    </main>
  );
}

function FleetBody({
  list,
  onOpenEpic,
}: {
  readonly list: ReturnType<typeof useEpicList>;
  readonly onOpenEpic: (epicId: string) => void;
}): ReactElement {
  if (list.isLoading) {
    return <p style={{ color: colors.muted }}>Loading your epics…</p>;
  }
  if (list.isError) {
    return (
      <div>
        <p role="alert" style={{ color: colors.danger }}>
          Couldn't load your epics.
        </p>
        <button type="button" style={secondaryButton} onClick={list.refetch}>
          Try again
        </button>
      </div>
    );
  }
  // Only a truly terminal empty result is the empty state. A page can be all
  // phase rows (the wire response carries both; the fleet shows epics only), so
  // "no epics visible yet, but more pages remain" must still offer Show more
  // rather than dead-ending on the empty copy.
  if (list.epics.length === 0 && !list.hasNextPage) {
    return (
      <p style={{ color: colors.muted }}>
        No epics yet. Start one from the Traycer desktop app, then refresh here.
      </p>
    );
  }

  return (
    <div>
      {list.epics.map((epic) => (
        <EpicRow key={epic.id} epic={epic} onOpen={() => onOpenEpic(epic.id)} />
      ))}
      {list.hasNextPage ? (
        <button
          type="button"
          style={{ ...primaryButton, marginTop: 4 }}
          onClick={list.fetchNextPage}
          disabled={list.isFetchingNextPage}
        >
          {list.isFetchingNextPage ? "Loading…" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

function EpicRow({
  epic,
  onOpen,
}: {
  readonly epic: FleetEpic;
  readonly onOpen: () => void;
}): ReactElement {
  const meta = formatEpicMeta(epic);
  return (
    <button type="button" style={row} onClick={onOpen}>
      <div style={{ fontWeight: 600 }}>{epic.title || "Untitled epic"}</div>
      {meta.length > 0 ? (
        <div style={{ color: colors.muted, marginTop: 4, fontSize: 14 }}>
          {meta}
        </div>
      ) : null}
    </button>
  );
}
