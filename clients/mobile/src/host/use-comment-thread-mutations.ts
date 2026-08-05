/**
 * Comment-thread write hooks (S4, F4): thin `useMutation` wrappers over the
 * unary `epic.createCommentThread` / `epic.replyToCommentThread` /
 * `epic.setCommentThreadResolved`. Each mutation invalidates the matching
 * `use-comment-threads` query key on success so the next read reflects the
 * host's authoritative state.
 *
 * No optimistic updates (mirrors gui-app's `use-comment-thread-mutations.ts`):
 * the host ack is fast and there is no push stream here to race against, so an
 * optimistic local write would only add complexity for a case that resolves
 * in one round-trip anyway.
 *
 * `epic.deleteCommentThread` is deliberately NOT wrapped here — this sprint's
 * panel has no delete-thread affordance (contract non-goal); the live-probe
 * script calls that RPC directly for its own test-thread cleanup instead.
 */
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { HostRequester } from "@traycer-clients/shared/host-client/host-client";
import type { HostRpcRegistry } from "@traycer/protocol/host/index";
import type {
  CreateCommentThreadRequest,
  CreateCommentThreadResponse,
  ReplyToCommentThreadRequest,
  ReplyToCommentThreadResponse,
  SetCommentThreadResolvedRequest,
  SetCommentThreadResolvedResponse,
} from "@traycer/protocol/host/epic/unary-schemas";
import { commentThreadsQueryKey } from "./use-comment-threads";

/** Only `request` is needed to mutate; kept narrow so tests inject a fake. */
export type CommentThreadsMutationClient = Pick<
  HostRequester<HostRpcRegistry>,
  "request"
>;

interface ThreadScope {
  readonly epicId: string;
  readonly artifactType: "spec" | "ticket" | "story" | "review";
  readonly artifactId: string;
}

function useThreadInvalidator(): (scope: ThreadScope) => void {
  const queryClient = useQueryClient();
  return (scope) => {
    void queryClient.invalidateQueries({
      queryKey: commentThreadsQueryKey(scope),
    });
  };
}

export function useCreateCommentThread(
  client: CommentThreadsMutationClient,
): UseMutationResult<CreateCommentThreadResponse, Error, CreateCommentThreadRequest> {
  const invalidate = useThreadInvalidator();
  return useMutation<CreateCommentThreadResponse, Error, CreateCommentThreadRequest>({
    mutationFn: (variables) => client.request("epic.createCommentThread", variables),
    onSuccess: (_data, variables) => invalidate(variables),
  });
}

export function useReplyToCommentThread(
  client: CommentThreadsMutationClient,
): UseMutationResult<ReplyToCommentThreadResponse, Error, ReplyToCommentThreadRequest> {
  const invalidate = useThreadInvalidator();
  return useMutation<ReplyToCommentThreadResponse, Error, ReplyToCommentThreadRequest>({
    mutationFn: (variables) => client.request("epic.replyToCommentThread", variables),
    onSuccess: (_data, variables) => invalidate(variables),
  });
}

export function useSetCommentThreadResolved(
  client: CommentThreadsMutationClient,
): UseMutationResult<
  SetCommentThreadResolvedResponse,
  Error,
  SetCommentThreadResolvedRequest
> {
  const invalidate = useThreadInvalidator();
  return useMutation<
    SetCommentThreadResolvedResponse,
    Error,
    SetCommentThreadResolvedRequest
  >({
    mutationFn: (variables) =>
      client.request("epic.setCommentThreadResolved", variables),
    onSuccess: (_data, variables) => invalidate(variables),
  });
}
