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
import type { ListTasksResponse } from "@traycer/protocol/host/epic/unary-schemas";

/**
 * The request shape, cursor rule and row projection now live in
 * `@traycer-clients/shared/epic/epic-list` — MOVED there when the Teams tab
 * needed the same list, not copied. What stays here is the TanStack
 * `useInfiniteQuery` wrapper, which is genuinely mobile's: the shared module
 * has no query cache to assume.
 *
 * Re-exported so existing callers and tests keep their import path.
 */
export {
  DEFAULT_FLEET_SORT,
  EPIC_LIST_REQUEST,
  buildEpicListRequest,
  epicListNextCursor,
  fetchEpicListPage,
  formatEpicMeta,
  toFleetEpics,
  type EpicListOptions,
  type FleetEpic,
  type FleetSort,
} from "@traycer-clients/shared/epic/epic-list";

import {
  DEFAULT_FLEET_SORT,
  fetchEpicListPage,
  epicListNextCursor,
  toFleetEpics,
  type EpicListClient,
  type EpicListOptions,
  type FleetEpic,
} from "@traycer-clients/shared/epic/epic-list";

/** Shared prefix every fleet-list query key starts with, regardless of search/sort — TanStack's partial-key matching lets `use-epic-set-pinned-mutation.ts` invalidate every variant with one call. */
export const EPIC_LIST_QUERY_KEY_PREFIX = ["mobile", "epic.listTasks", "fleet"] as const;

function epicListQueryKey(options: EpicListOptions) {
  return [...EPIC_LIST_QUERY_KEY_PREFIX, options.query ?? "", options.sort ?? DEFAULT_FLEET_SORT] as const;
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

export function useEpicList(client: EpicListClient, options: EpicListOptions = {}): EpicListResult {
  const query = useInfiniteQuery<
    ListTasksResponse,
    Error,
    InfiniteData<ListTasksResponse, string | undefined>,
    ReturnType<typeof epicListQueryKey>,
    string | undefined
  >({
    queryKey: epicListQueryKey(options),
    queryFn: ({ pageParam }) => fetchEpicListPage(client, pageParam, options),
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
