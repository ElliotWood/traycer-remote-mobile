/**
 * Unary mutations for the host notification feed — separate from
 * `use-host-notifications.ts` (which only owns the STREAM side), mirroring
 * this codebase's existing split between data-reading hooks and mutation
 * hooks (e.g. `use-node-mutations.ts`). The stream's own `readStateChanged`/
 * `removed` frames apply the resulting state change; these calls don't
 * optimistically mutate local state themselves.
 *
 * The REQUESTS moved to
 * `@traycer-clients/shared/epic/host-notification-mutations` when the Teams
 * tab needed the same writes. Mobile keeps this `useCallback` wrapper and
 * imports the calls back — the same split as `use-host-notifications`, which
 * already imports `applyFeedFrame` from shared.
 */
import { useCallback } from "react";
import {
  markAllNotificationsRead,
  markNotificationEntityRead,
  markNotificationsRead,
  resolveNotifications,
  type HostNotificationOccurrence,
} from "@traycer-clients/shared/epic/host-notification-mutations";
import type { MobileHostClient } from "./host-client-context";

export interface UseNotificationMutationsResult {
  readonly markRead: (ids: readonly string[]) => Promise<void>;
  readonly markEntityRead: (entity: { readonly epicId: string; readonly chatId?: string }) => Promise<void>;
  readonly markAllRead: () => Promise<void>;
  readonly resolve: (occurrences: readonly HostNotificationOccurrence[]) => Promise<void>;
}

export function useNotificationMutations(
  client: MobileHostClient | null,
): UseNotificationMutationsResult {
  const markRead = useCallback(
    async (ids: readonly string[]): Promise<void> => {
      if (client === null) return;
      await markNotificationsRead(client, ids);
    },
    [client],
  );

  const markEntityRead = useCallback(
    async (entity: { readonly epicId: string; readonly chatId?: string }): Promise<void> => {
      if (client === null) return;
      await markNotificationEntityRead(client, entity);
    },
    [client],
  );

  // The cutoff is read HERE, not inside the shared call: "everything up to the
  // moment the button was pressed" is this surface's decision, and the shared
  // function deliberately refuses to guess it.
  const markAllRead = useCallback(async (): Promise<void> => {
    if (client === null) return;
    await markAllNotificationsRead(client, Date.now());
  }, [client]);

  const resolve = useCallback(
    async (occurrences: readonly HostNotificationOccurrence[]): Promise<void> => {
      if (client === null) return;
      await resolveNotifications(client, occurrences);
    },
    [client],
  );

  return { markRead, markEntityRead, markAllRead, resolve };
}
