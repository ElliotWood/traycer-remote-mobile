// Fleet = the list of Traycer epics/phases the user is running. Sourced from the
// real host RPC `epic.listTasks` — the same call gui-app's home screen uses
// (clients/gui-app/src/lib/cloud-epic-tasks-query/query.ts).

import {
  CURRENT_EPIC_VERSION,
  CURRENT_PHASE_VERSION,
} from "@traycer-clients/shared/epic/epic-version";
import type {
  ListTasksRequest,
  ListTasksResponse,
} from "@traycer/protocol/host/epic/unary-schemas";
import type { HostConnection } from "@/host/connection";

export interface FleetItem {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly kind: "epic" | "phase";
}

// First page, most-recent first — mirrors gui-app's default listing request.
const LIST_TASKS_REQUEST: ListTasksRequest = {
  limit: 20,
  filters: null,
  sort: "recent",
  extensionPhaseVersion: String(CURRENT_PHASE_VERSION),
  extensionEpicVersion: String(CURRENT_EPIC_VERSION),
};

/** Maps a real `epic.listTasks` response to flat, renderable fleet items. */
export function toFleetItems(response: ListTasksResponse): FleetItem[] {
  const items: FleetItem[] = [];
  for (const task of response.tasks) {
    const epic = task.epic?.light ?? null;
    if (epic !== null) {
      items.push({
        id: epic.id,
        title: epic.title,
        status: epic.status,
        kind: "epic",
      });
      continue;
    }
    const phase = task.phase?.light ?? null;
    if (phase !== null) {
      items.push({
        id: phase.id,
        title: phase.title,
        status: phase.status,
        kind: "phase",
      });
    }
  }
  return items;
}

/** Fetches the fleet from the real host over the given connection. */
export async function listFleet(
  connection: HostConnection,
  signal?: AbortSignal,
): Promise<FleetItem[]> {
  const response = await connection.request(
    "epic.listTasks",
    LIST_TASKS_REQUEST,
    signal,
  );
  return toFleetItems(response);
}
