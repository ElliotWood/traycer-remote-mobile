/**
 * HA-4's watching-tier registry: a `WsStreamClient` constructed against
 * this can only ever ask for `host.notifications.feed.subscribe`.
 *
 * The tech plan's invariant — "anything subscribing to an epic document
 * must assert it is driving" — was originally going to be a runtime guard
 * around `subscribe()`. This registry makes the guard unnecessary instead:
 * `WsStreamClient<Registry>.subscribe<Method extends keyof Registry & string>`
 * is generic over the registry's own key set, so
 * `WsStreamClient<WatchingStreamRpcRegistry>.subscribe("epic.subscribe", …)`
 * is a TypeScript compile error, not a call a guard has to intercept. The
 * method simply is not on the object.
 *
 * It is also structural on the WIRE, not only in mobile's types:
 * `WsStreamClient` builds its open-frame manifest via
 * `buildStreamManifest(this.config.registry)` (`ws-stream-client.ts`), so a
 * watching-tier client's open frame declares only
 * `host.notifications.feed.subscribe` to the host it dials — observable by
 * the host, and surviving a later reimplementation of this client that
 * "simplifies" the two registries back into one. Don't merge them back
 * without re-deriving whether that observation still holds.
 *
 * Reuses `hostNotificationsFeedSubscribeV10` — the SAME contract object
 * `hostStreamRpcRegistry` (`@traycer/protocol/host/registry`) builds its own
 * `"host.notifications.feed.subscribe"` entry from. No new type, no new wire
 * protocol, no new schema version: this is a second, smaller *registry*
 * over an existing contract, not a new contract.
 */
import { defineVersionedStreamRpcRegistry } from "@traycer/protocol/framework/versioned-stream-rpc";
import { hostNotificationsFeedSubscribeV10 } from "@traycer/protocol/host/notifications/contracts";

export const watchingStreamRpcRegistry = defineVersionedStreamRpcRegistry({
  "host.notifications.feed.subscribe": {
    1: {
      latestMinor: 0,
      versions: {
        0: {
          contract: hostNotificationsFeedSubscribeV10,
        },
      },
    },
  },
});

export type WatchingStreamRpcRegistry = typeof watchingStreamRpcRegistry;
