/**
 * Fleet view (T4, Flow 2): the signed-in home listing the user's epics.
 *
 * Each row is a piece of work — title plus light metadata (artifact counts and
 * freeform lifecycle status). The list is fetch-based, not streamed, so the
 * freshness affordance is an explicit Refresh, NOT a live indicator (Flow 2.5:
 * don't imply liveness the data can't back). Tapping a row drills into the epic
 * (the epic detail itself arrives in T5). An empty fleet shows a clear empty
 * state rather than a blank screen.
 *
 * Sprint 6 (round 1): restyled on the ported desktop design tokens
 * (`design-tokens.ts`) — real card surfaces, teal-green primary buttons, and
 * status-language coloring on rows (epics aren't kind-typed like artifacts,
 * so this is the desktop's status-text idiom, not artifact kind colors).
 */
import { Layers } from "lucide-react";
import type { ReactElement } from "react";
import {
  formatEpicMeta,
  useEpicList,
  type FleetEpic,
} from "@/host/use-epic-list";
import type { MobileHostClient } from "@/host/host-client-context";
import {
  Button,
  Card,
  SectionHeading,
  radius,
  screen,
  statusToneColor,
  theme,
  type,
} from "./design-tokens";

interface FleetViewProps {
  readonly client: MobileHostClient;
  readonly onOpenEpic: (epicId: string, epicTitle: string) => void;
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
          marginBottom: 16,
        }}
      >
        <SectionHeading>Your work</SectionHeading>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            variant="secondary"
            onClick={list.refetch}
            disabled={list.isRefetching || list.isLoading}
          >
            {list.isRefetching ? "Refreshing…" : "Refresh"}
          </Button>
          <Button variant="ghost" onClick={onSignOut}>
            Sign out
          </Button>
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
  readonly onOpenEpic: (epicId: string, epicTitle: string) => void;
}): ReactElement {
  if (list.isLoading) {
    return <p style={{ ...type.body, color: theme.mutedText }}>Loading your epics…</p>;
  }
  if (list.isError) {
    return (
      <div>
        <p role="alert" style={{ ...type.body, color: theme.danger }}>
          Couldn't load your epics.
        </p>
        <Button variant="secondary" onClick={list.refetch}>
          Try again
        </Button>
      </div>
    );
  }
  // Only a truly terminal empty result is the empty state. A page can be all
  // phase rows (the wire response carries both; the fleet shows epics only), so
  // "no epics visible yet, but more pages remain" must still offer Show more
  // rather than dead-ending on the empty copy.
  if (list.epics.length === 0 && !list.hasNextPage) {
    return (
      <p style={{ ...type.body, color: theme.mutedText }}>
        No epics yet. Start one from the Traycer desktop app, then refresh here.
      </p>
    );
  }

  return (
    <div>
      {list.epics.map((epic) => (
        <EpicRow
          key={epic.id}
          epic={epic}
          onOpen={() => onOpenEpic(epic.id, epic.title || "Untitled epic")}
        />
      ))}
      {list.hasNextPage ? (
        <Button
          variant="primary"
          fullWidth
          onClick={list.fetchNextPage}
          disabled={list.isFetchingNextPage}
        >
          {list.isFetchingNextPage ? "Loading…" : "Show more"}
        </Button>
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
  const statusColor = epic.status.trim().length > 0 ? statusToneColor(epic.status) : null;
  return (
    <Card onClick={onOpen} accentColor={statusColor ?? undefined}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            flexShrink: 0,
            borderRadius: radius.md,
            background: "rgba(255, 255, 255, 0.06)",
            border: `1px solid ${theme.borderHairline}`,
          }}
        >
          <Layers size={16} color={theme.mutedText} aria-hidden="true" />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...type.titleSm, color: theme.textRow }}>
            {epic.title || "Untitled epic"}
          </div>
          {meta.length > 0 ? (
            <div style={{ ...type.bodySm, color: statusColor ?? theme.mutedText, marginTop: 2 }}>
              {meta}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
