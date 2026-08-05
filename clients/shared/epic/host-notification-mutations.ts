/**
 * The four `host.notifications.*` write calls, with no React in them.
 *
 * EXTRACTED from `clients/mobile/src/host/use-notification-mutations.ts` when
 * the Teams tab needed the same writes. Moved rather than reimplemented, for
 * the reason the sibling `host-notifications-feed` module exists: the read
 * side of this feed already lives here, and a client that reads through shared
 * code while hand-rolling its own writes is the shape that lets two clients
 * disagree about the same feed.
 *
 * What stayed in each client is the React wrapper — mobile's `useCallback`
 * hook, the tab's own. Same split as `epic-list`: the protocol in shared, the
 * framework at the edge.
 *
 * `markAllRead` TAKES ITS CLOCK. Mobile's version called `Date.now()` inline,
 * which is how a test ends up reading the wall clock without anyone having
 * chosen that — the same defect `use-create-epic` had its default removed for.
 * `beforeUpdatedAt` is a real cutoff sent to the host: anything updated after
 * it stays unread, so the value is a decision, not an implementation detail.
 */
import type { HostRequester } from "../host-client/host-client";
import type { HostRpcRegistry } from "@traycer/protocol/host/index";

/** Only `request` is needed, kept narrow so tests inject a fake. */
export type HostNotificationMutationClient = Pick<
  HostRequester<HostRpcRegistry>,
  "request"
>;

/**
 * One resolvable occurrence. `sourceRef` is nullable on the wire and is
 * forwarded as-is — the host uses it to match the occurrence it recorded, and
 * substituting a value we invented would resolve the wrong thing.
 */
export interface HostNotificationOccurrence {
  readonly id: string;
  readonly updatedAt: number;
  readonly sourceRef: string | null;
}

/**
 * Marks specific entries read.
 *
 * An empty list is a NO-OP rather than a request. The host would accept it and
 * do nothing, so sending it costs a round trip to change nothing — and it is
 * the call a "mark these read" handler makes when its selection is empty.
 */
export async function markNotificationsRead(
  client: HostNotificationMutationClient,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  await client.request("host.notifications.markRead", {
    kind: "ids",
    ids: [...ids],
  });
}

/** Marks everything for one epic (optionally one chat) read. */
export async function markNotificationEntityRead(
  client: HostNotificationMutationClient,
  entity: { readonly epicId: string; readonly chatId?: string },
): Promise<void> {
  await client.request("host.notifications.markRead", { kind: "entity", entity });
}

/**
 * Marks everything updated at or before `beforeUpdatedAt` read.
 *
 * The cutoff is REQUIRED, not defaulted. It is what keeps a notification that
 * arrived while the user was reading the list from being marked read without
 * ever being seen — so it is the caller's decision which instant "all" means.
 */
export async function markAllNotificationsRead(
  client: HostNotificationMutationClient,
  beforeUpdatedAt: number,
): Promise<void> {
  await client.request("host.notifications.markAllRead", { beforeUpdatedAt });
}

/** Resolves occurrences (dismisses an approval/interview row). */
export async function resolveNotifications(
  client: HostNotificationMutationClient,
  occurrences: readonly HostNotificationOccurrence[],
): Promise<void> {
  if (occurrences.length === 0) return;
  await client.request("host.notifications.resolve", {
    occurrences: [...occurrences],
  });
}
