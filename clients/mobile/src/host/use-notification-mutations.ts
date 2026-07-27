/**
 * Unary mutations for the host notification feed — separate from
 * `use-host-notifications.ts` (which only owns the STREAM side), mirroring
 * this codebase's existing split between data-reading hooks and mutation
 * hooks (e.g. `use-node-mutations.ts`). The stream's own `readStateChanged`/
 * `removed` frames apply the resulting state change; these calls don't
 * optimistically mutate local state themselves.
 */
import { useCallback } from "react";
import type { MobileHostClient } from "./host-client-context";

export interface UseNotificationMutationsResult {
  readonly markRead: (ids: readonly string[]) => Promise<void>;
  readonly markEntityRead: (entity: { readonly epicId: string; readonly chatId?: string }) => Promise<void>;
  readonly markAllRead: () => Promise<void>;
  readonly resolve: (
    occurrences: readonly { readonly id: string; readonly updatedAt: number; readonly sourceRef: string | null }[],
  ) => Promise<void>;
}

export function useNotificationMutations(
  client: MobileHostClient | null,
): UseNotificationMutationsResult {
  const markRead = useCallback(
    async (ids: readonly string[]): Promise<void> => {
      if (client === null || ids.length === 0) return;
      await client.request("host.notifications.markRead", { kind: "ids", ids: [...ids] });
    },
    [client],
  );

  const markEntityRead = useCallback(
    async (entity: { readonly epicId: string; readonly chatId?: string }): Promise<void> => {
      if (client === null) return;
      await client.request("host.notifications.markRead", { kind: "entity", entity });
    },
    [client],
  );

  const markAllRead = useCallback(async (): Promise<void> => {
    if (client === null) return;
    await client.request("host.notifications.markAllRead", { beforeUpdatedAt: Date.now() });
  }, [client]);

  const resolve = useCallback(
    async (
      occurrences: readonly { readonly id: string; readonly updatedAt: number; readonly sourceRef: string | null }[],
    ): Promise<void> => {
      if (client === null || occurrences.length === 0) return;
      await client.request("host.notifications.resolve", { occurrences: [...occurrences] });
    },
    [client],
  );

  return { markRead, markEntityRead, markAllRead, resolve };
}
