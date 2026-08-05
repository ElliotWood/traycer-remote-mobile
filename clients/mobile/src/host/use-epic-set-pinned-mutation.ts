/**
 * P4: pin/unpin an epic from the Fleet — thin `useMutation` wrapper over the
 * unary `epic.setPinned`. `pinned` is a real, server-persisted per-user field
 * on `ListTaskLight` (not a client-only `localStorage` preference — confirmed
 * against the protocol schema), so pin state syncs across desktop and mobile
 * the same way any other epic field does.
 *
 * No optimistic update (mirrors `use-comment-thread-mutations.ts`'s
 * reasoning): invalidates every fleet-list query variant (any search/sort
 * combination) via the shared key prefix on success, so the next read
 * reflects the host's authoritative state and re-applies `toFleetEpics`'
 * pinned-first ordering.
 */
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { HostRequester } from "@traycer-clients/shared/host-client/host-client";
import type { HostRpcRegistry } from "@traycer/protocol/host/index";
import type {
  SetEpicPinnedRequest,
  SetEpicPinnedResponse,
} from "@traycer/protocol/host/epic/unary-schemas";
import { EPIC_LIST_QUERY_KEY_PREFIX } from "./use-epic-list";

export type EpicSetPinnedClient = Pick<HostRequester<HostRpcRegistry>, "request">;

export function useEpicSetPinned(
  client: EpicSetPinnedClient,
): UseMutationResult<SetEpicPinnedResponse, Error, SetEpicPinnedRequest> {
  const queryClient = useQueryClient();
  return useMutation<SetEpicPinnedResponse, Error, SetEpicPinnedRequest>({
    mutationFn: (variables) => client.request("epic.setPinned", variables),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: EPIC_LIST_QUERY_KEY_PREFIX });
    },
  });
}
