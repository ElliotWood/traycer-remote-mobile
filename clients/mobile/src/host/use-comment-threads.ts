/**
 * Comment-thread read hook (S4, F4): a thin `useQuery` wrapper over the unary
 * `epic.listCommentThreads`, mirroring `use-epic-list.ts`'s house style —
 * direct `@tanstack/react-query`, not gui-app's `useHostQuery` wrapper (mobile
 * has no shared query-hook abstraction).
 *
 * Pull-based (tech-plan F4): there is no push stream for comments, so a write
 * is only reflected once `use-comment-thread-mutations.ts` invalidates this
 * query's key and the next fetch lands. `staleTime`/`refetchOnWindowFocus`
 * mirror gui-app's `useEpicCommentThreads` so a backgrounded tab re-checks on
 * refocus without polling.
 */
import { useQuery } from "@tanstack/react-query";
import type { HostRequester } from "@traycer-clients/shared/host-client/host-client";
import type { HostRpcRegistry } from "@traycer/protocol/host/index";
import type {
  CommentThreadWire,
  ListCommentThreadsRequest,
  ListCommentThreadsResponse,
} from "@traycer/protocol/host/epic/unary-schemas";

/** Only `request` is needed to fetch threads; kept narrow so tests inject a fake. */
export type CommentThreadsClient = Pick<HostRequester<HostRpcRegistry>, "request">;

/** Shared with the mutation hooks so a write invalidates the exact same key. */
export function commentThreadsQueryKey(
  params: ListCommentThreadsRequest,
): readonly unknown[] {
  return [
    "mobile",
    "epic.listCommentThreads",
    params.epicId,
    params.artifactType,
    params.artifactId,
  ] as const;
}

export interface UseCommentThreadsResult {
  readonly threads: readonly CommentThreadWire[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

/**
 * Reads the comment threads for one artifact. Disabled (fires no request)
 * when either id is empty — a defensive gate for a harness/embedder passing
 * an unresolved id rather than a real one.
 */
export function useCommentThreads(
  client: CommentThreadsClient,
  params: ListCommentThreadsRequest,
): UseCommentThreadsResult {
  const query = useQuery<ListCommentThreadsResponse, Error>({
    queryKey: commentThreadsQueryKey(params),
    queryFn: () => client.request("epic.listCommentThreads", params),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    enabled: params.epicId.length > 0 && params.artifactId.length > 0,
  });

  return {
    // Oldest-created-first, stable. Comments WITHIN a thread are left in host
    // order (authoritative) - only the thread list itself is re-ordered here.
    threads: [...(query.data?.threads ?? [])].sort(
      (a, b) => a.createdAt - b.createdAt,
    ),
    isLoading: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
