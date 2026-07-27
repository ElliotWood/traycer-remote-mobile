/**
 * The Fleet view's data source (T4, Flow 2): paginated `epic.listTasks`.
 *
 * `epic.listTasks` is a request/response unary call, NOT a stream (Flow 2.5) —
 * the list reflects the last fetch, refreshed on demand, with no live badge.
 * Pagination mirrors gui-app's cloud-tasks query: a fixed page `limit`, a
 * cursor threaded from the previous page's `nextCursor`, and `sort: "recent"`.
 * The request shape is byte-identical to gui-app's `LIST_CLOUD_TASKS_REQUEST`
 * (`clients/gui-app/src/lib/cloud-epic-tasks-query/query.ts`) so the phone hits
 * the same proven host path.
 *
 * The wire response carries both epic and phase rows (`filters: null`); the
 * Fleet shows epics only (core-flows Flow 2), so `toFleetEpics` projects each
 * row's `epic.light` and drops phases / unreadable rows. The heavy accumulation
 * machinery gui-app needs (a Zustand page store surviving host remounts, pin
 * reconciliation) buys nothing here — mobile has one host and no pinning — so
 * this leans on TanStack `useInfiniteQuery` directly.
 */
import { useMemo } from "react";
import {
  useInfiniteQuery,
  type InfiniteData,
} from "@tanstack/react-query";
import type { HostRequester } from "@traycer-clients/shared/host-client/host-client";
import type { HostRpcRegistry } from "@traycer/protocol/host/index";
import type {
  ListTaskLight,
  ListTasksRequest,
  ListTasksResponse,
} from "@traycer/protocol/host/epic/unary-schemas";
import {
  CURRENT_EPIC_VERSION,
  CURRENT_PHASE_VERSION,
} from "@traycer-clients/shared/epic/epic-version";

/** Page size. Matches gui-app's `PAGE_LIMIT` for the same board query. */
const PAGE_LIMIT = 20;

/** Only `request` is needed to fetch a page; kept narrow so tests inject a fake. */
type EpicListClient = Pick<HostRequester<HostRpcRegistry>, "request">;

/**
 * The cursor-less base request, mirroring gui-app's `LIST_CLOUD_TASKS_REQUEST`.
 * `filters: null` (no server-side taskType filter, exactly as gui-app sends);
 * the epic/phase split is handled client-side in `toFleetEpics`.
 */
export const EPIC_LIST_REQUEST: Omit<ListTasksRequest, "cursor"> = {
  limit: PAGE_LIMIT,
  filters: null,
  sort: "recent",
  extensionPhaseVersion: String(CURRENT_PHASE_VERSION),
  extensionEpicVersion: String(CURRENT_EPIC_VERSION),
};

const EPIC_LIST_QUERY_KEY = ["mobile", "epic.listTasks", "fleet"] as const;

export function buildEpicListRequest(
  cursor: string | undefined,
): ListTasksRequest {
  return cursor === undefined
    ? { ...EPIC_LIST_REQUEST }
    : { ...EPIC_LIST_REQUEST, cursor };
}

export function fetchEpicListPage(
  client: EpicListClient,
  cursor: string | undefined,
): Promise<ListTasksResponse> {
  return client.request("epic.listTasks", buildEpicListRequest(cursor));
}

/**
 * The cursor for the next page, or `undefined` when there is none. A response
 * with `hasMore` but a missing/empty `nextCursor` is treated as terminal rather
 * than looping on the same page.
 */
export function epicListNextCursor(page: ListTasksResponse): string | undefined {
  if (!page.hasMore) return undefined;
  return typeof page.nextCursor === "string" && page.nextCursor.length > 0
    ? page.nextCursor
    : undefined;
}

/** One Fleet row: an epic's title, artifact counts, and freeform status. */
export interface FleetEpic {
  readonly id: string;
  readonly title: string;
  readonly ticketCount: number;
  readonly specCount: number;
  readonly storyCount: number;
  readonly reviewCount: number;
  readonly status: string;
  readonly createdAt: number;
}

/**
 * Projects list rows to Fleet epics: keeps rows carrying an `epic.light`
 * (dropping phase rows and rows whose light is null — deleted / not permitted),
 * and de-dupes by id (first occurrence wins) so an id repeated across page
 * boundaries never renders twice.
 */
export function toFleetEpics(
  tasks: readonly ListTaskLight[],
): readonly FleetEpic[] {
  const seen = new Set<string>();
  const epics: FleetEpic[] = [];
  for (const task of tasks) {
    const light = task.epic?.light;
    if (light === undefined || light === null) continue;
    if (seen.has(light.id)) continue;
    seen.add(light.id);
    epics.push({
      id: light.id,
      title: light.title,
      ticketCount: light.ticketCount,
      specCount: light.specCount,
      storyCount: light.storyCount,
      reviewCount: light.reviewCount,
      status: light.status,
      createdAt: light.createdAt,
    });
  }
  return epics;
}

function pluralize(n: number, singular: string, plural?: string): string {
  return `${n} ${n === 1 ? singular : (plural ?? `${singular}s`)}`;
}

/**
 * The row's metadata line: non-zero artifact counts followed by the freeform
 * status, joined with " · " (e.g. "6 tickets · 2 specs · in progress"). Zero
 * counts and an empty status are omitted; an all-empty epic yields "".
 */
export function formatEpicMeta(epic: FleetEpic): string {
  const parts: string[] = [];
  if (epic.ticketCount > 0) parts.push(pluralize(epic.ticketCount, "ticket"));
  if (epic.specCount > 0) parts.push(pluralize(epic.specCount, "spec"));
  if (epic.storyCount > 0)
    parts.push(pluralize(epic.storyCount, "story", "stories"));
  if (epic.reviewCount > 0) parts.push(pluralize(epic.reviewCount, "review"));
  const status = epic.status.trim();
  if (status.length > 0) parts.push(status);
  return parts.join(" · ");
}

export interface EpicListResult {
  readonly epics: readonly FleetEpic[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  /**
   * True while a fetch attempt (initial OR an automatic retry) is actually
   * in flight. UX fix: `isError` alone flips true on the FIRST failed
   * attempt's frame, before TanStack's default retries have run — showing
   * the hard "Couldn't load" error then reads as broken even though a
   * retry is already queued. Callers should treat `isError && isFetching`
   * as "still retrying" (render loading), and only `isError && !isFetching`
   * as the genuine, retries-exhausted failure.
   */
  readonly isFetching: boolean;
  readonly error: Error | null;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly fetchNextPage: () => void;
  readonly refetch: () => void;
  readonly isRefetching: boolean;
}

/**
 * Sprint 5 (S5 A2/A3): the fleet is no longer manual-refresh-only. `refetchInterval`
 * is the "gentle poll" (20s — TanStack pauses it automatically while the tab is
 * hidden/unfocused via `refetchIntervalInBackground: false`, so it never busy-loops
 * in the background). `refetchOnWindowFocus`/`refetchOnReconnect` are already
 * TanStack v5 defaults; set explicitly so a future global `QueryClient` default
 * change can't silently regress them. The manual Refresh button stays — this is
 * additive, not a replacement.
 */
const FLEET_REFETCH_INTERVAL_MS = 20_000;

export function useEpicList(client: EpicListClient): EpicListResult {
  const query = useInfiniteQuery<
    ListTasksResponse,
    Error,
    InfiniteData<ListTasksResponse, string | undefined>,
    typeof EPIC_LIST_QUERY_KEY,
    string | undefined
  >({
    queryKey: EPIC_LIST_QUERY_KEY,
    queryFn: ({ pageParam }) => fetchEpicListPage(client, pageParam),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => epicListNextCursor(lastPage),
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: FLEET_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const epics = useMemo<readonly FleetEpic[]>(
    () => toFleetEpics((query.data?.pages ?? []).flatMap((page) => page.tasks)),
    [query.data],
  );

  return {
    epics,
    isLoading: query.isPending,
    isError: query.isError,
    isFetching: query.isFetching,
    error: query.error,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: () => void query.fetchNextPage(),
    refetch: () => void query.refetch(),
    isRefetching: query.isRefetching,
  };
}
