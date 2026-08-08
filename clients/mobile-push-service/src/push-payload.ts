import {
  formatHostNotificationPresentation,
  parseKnownHostNotificationPayloadForKind,
  type HostNotificationKnownPayload,
} from "@traycer/protocol/host/notifications/contracts";
import type { HostNotificationEntry } from "@traycer/protocol/host/notifications/host-notifications";
import type { ActionableTransition } from "./actionable-detector";
import {
  buildNotificationActivationEnvelope,
  type NotificationActivationEnvelopeV1,
  type NotificationActivationRoute,
} from "./notification-activation-envelope";
import type { PushPayload } from "./push-sender";

const MAX_SUMMARY_TITLES = 5;

/**
 * The key the coalesced-summary push uses for `tag`. Mirrors gui-app's own
 * batch replace key so a summary shown by the worker and a summary shown by
 * the foreground app collapse onto each other rather than stacking.
 */
const BATCH_REPLACE_KEY = "notification-batch";

/**
 * Builds the push payload for one coalesced batch. `formatHostNotificationPresentation`
 * is the only source of title/body — the same formatter the in-app feed uses,
 * so phone copy never drifts from desktop.
 *
 * - Exactly one transition → its normal presentation, carrying the activation
 *   envelope that lets a click land on the row's own destination.
 * - More than one → a single summary push with NO route. There is no single
 *   chat to land on, and gui-app answers a routeless activation by opening the
 *   notification centre — which shows all N rows. That is a better destination
 *   than an arbitrary one of them, so the absence is the feature.
 *
 * ## What changed, and why the previous shape never worked
 *
 * This used to emit `{title, body, data:{epicId, chatId}}`. Both halves of
 * that were wrong against the client that receives it, and neither was
 * visible from this package:
 *
 * - **Wrong key.** `clients/mobile/src/web/sw.ts` reads `record.payload`, not
 *   `record.data`, so the deep-link target was dropped before the notification
 *   was even constructed.
 * - **Wrong shape.** Even renamed, `{epicId, chatId}` carries no `kind`
 *   discriminator, and gui-app's `parseNotificationPayload` switches on
 *   `kind` and returns `null` for anything else. A bare id pair has never been
 *   a routable payload in that client.
 *
 * The failure was quiet in the worst way: title and body would have been
 * correct, so a push looked like it worked and only the tap went nowhere.
 *
 * ## The route is derived the way gui-app derives it, not the way the row is shaped
 *
 * `payloadFromHostEntry` in gui-app's `merged-notifications.ts` runs the
 * entry's payload through the protocol's `parseKnownHostNotificationPayloadForKind`
 * and maps the result. That is reproduced exactly below, via the same shared
 * function, so the destination a push click reaches and the destination the
 * same row reaches in-app are computed from one contract.
 *
 * **A row whose semantic parse fails gets NO route, and that is deliberate.**
 * `HostNotificationEntry` also carries top-level `epicId`/`chatId` columns,
 * and falling back to them would produce a deep link in more cases. gui-app
 * declines to do that on purpose — its own docblock calls the degradation
 * "the designed degradation rather than a guessed destination", because a row
 * minted by a NEWER host may address an entity this build would route wrongly.
 * Adding the fallback here would make a push click and an in-app click
 * disagree, which is precisely the parity this epic is trying to hold.
 */
export function buildPushPayload(
  transitions: readonly ActionableTransition[],
  originHostId: string | null,
): PushPayload {
  if (transitions.length === 1) {
    return buildSingleEntryPayload(transitions[0].entry, originHostId);
  }
  const titles = transitions.map(
    (t) => formatHostNotificationPresentation(t.entry).title,
  );
  const uniqueTitles = Array.from(new Set(titles));
  const shown = uniqueTitles.slice(0, MAX_SUMMARY_TITLES);
  const body =
    uniqueTitles.length > MAX_SUMMARY_TITLES
      ? `${shown.join(", ")}, and ${uniqueTitles.length - MAX_SUMMARY_TITLES} more`
      : shown.join(", ");
  return {
    title: `${transitions.length} chats need your attention`,
    body,
    payload: null,
    replaceKey: BATCH_REPLACE_KEY,
  };
}

function buildSingleEntryPayload(
  entry: HostNotificationEntry,
  originHostId: string | null,
): PushPayload {
  const presentation = formatHostNotificationPresentation(entry);
  const route = routeFromHostEntry(entry);
  const payload: NotificationActivationEnvelopeV1 | null =
    route === null
      ? null
      : buildNotificationActivationEnvelope({
          route,
          feed: { source: "host", id: entry.id },
          originHostId,
        });
  return {
    title: presentation.title,
    body: presentation.body,
    payload,
    replaceKey: replaceKeyForEntry(entry, route),
  };
}

/**
 * Second-stage semantic parse, then the same mapping gui-app applies. A
 * payload this build cannot parse, or one contradicting its row's kind, yields
 * `null` — degrade, never error.
 */
function routeFromHostEntry(
  entry: HostNotificationEntry,
): NotificationActivationRoute | null {
  const known = parseKnownHostNotificationPayloadForKind(
    entry.kind,
    entry.payload,
  );
  return known === null ? null : routeFromKnownPayload(known);
}

/**
 * Mirrors gui-app's `navigationPayloadFromKnown`. The switch is exhaustive
 * over `HostNotificationKnownPayload["kind"]`, so a new arm in the protocol
 * fails to compile here until it declares a destination — which is the point
 * of restating the mapping rather than sharing a loose record.
 */
function routeFromKnownPayload(
  known: HostNotificationKnownPayload,
): NotificationActivationRoute {
  switch (known.kind) {
    case "chat":
      return {
        kind: "chat",
        epicId: known.epicId,
        chatId: known.chatId ?? undefined,
      };
    case "agent_stalled":
      return { kind: "chat", epicId: known.epicId, chatId: known.chatId };
    case "workspace_operation_failed":
      return { kind: "chat", epicId: known.epicId, chatId: known.chatId };
    // A TUI agent-stopped row persists the `epic` payload shape, but its
    // actionable entity is the terminal agent. gui-app routes it through the
    // chat-shaped route with `tuiAgentId` as the chat id rather than degrading
    // the click to the owning epic; same here, for the same reason.
    case "epic":
      return {
        kind: "chat",
        epicId: known.epicId,
        chatId: known.tuiAgentId,
      };
    case "approval":
      return {
        kind: "approval",
        epicId: known.epicId,
        chatId: known.chatId,
        approvalId: known.approvalId,
        sessionId: undefined,
        artifactId: undefined,
      };
    case "interview":
      return {
        kind: "interview",
        epicId: known.epicId,
        chatId: known.chatId,
        interviewBlockId: known.interviewBlockId,
      };
    // No focus hint: the row's worktree has just been deleted, so the list is
    // the only honest destination.
    case "worktree_deletion":
      return {
        kind: "hostSurface",
        surface: "worktreeSettings",
        focus: undefined,
      };
  }
}

/**
 * The notification `tag`, mirroring gui-app's `notificationReplaceKey`.
 *
 * Coalescing by ENTITY is what stops a chat that transitions twice from
 * stacking two notifications on a lock screen. Rows with no entity-shaped
 * destination fall back to a per-row key, because two finished operations are
 * two separate results and replacing the first with the second would hide one.
 */
function replaceKeyForEntry(
  entry: HostNotificationEntry,
  route: NotificationActivationRoute | null,
): string {
  return entityReplaceKey(route) ?? `host:id:${entry.id}`;
}

function entityReplaceKey(
  route: NotificationActivationRoute | null,
): string | null {
  if (route === null) return null;
  switch (route.kind) {
    case "approval":
    case "chat":
      return chatOrEpicReplaceKey(route.chatId, route.epicId);
    case "interview":
      return `host:chat:${route.chatId}`;
    case "hostSurface":
      return null;
  }
}

function chatOrEpicReplaceKey(
  chatId: string | undefined,
  epicId: string | undefined,
): string | null {
  if (chatId !== undefined) return `host:chat:${chatId}`;
  return epicId === undefined ? null : `host:epic:${epicId}`;
}
