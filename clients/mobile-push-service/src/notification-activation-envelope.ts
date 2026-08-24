/**
 * The wire contract this service must satisfy to be understood by the client
 * it pushes to.
 *
 * WHY IT IS RESTATED HERE RATHER THAN IMPORTED. The consumer is
 * `clients/gui-app/src/lib/notifications/notification-activation-envelope.ts`
 * and `.../payload.ts`, whose parsers are the authority. Neither is importable
 * from a Node service: `payload.ts` value-imports `@/lib/tab-navigation`,
 * `@/lib/commands/actions/open-system-tab` and `@/stores/epics/canvas/store`,
 * so reaching the ~170 lines of pure parsing drags in React Router, the canvas
 * store and the command palette. Those types are ALSO not a shared package —
 * `@traycer-clients/shared` carries transport and auth, not renderer routing.
 *
 * So this is a deliberate restatement of a versioned wire format, not a
 * convenience copy, and it is kept honest in two ways rather than by comment:
 *
 * 1. `push-payload.ts` derives every route through the protocol's own
 *    `parseKnownHostNotificationPayloadForKind`, which IS shared and IS
 *    compile-linked to the producer schemas — so the only thing restated here
 *    is the envelope wrapper, not the semantics of a notification.
 * 2. `scratch/next-probe/push-envelope-probe.mjs` feeds this module's real
 *    output through the real built service worker in a real browser, so the
 *    claim "the client understands this" is measured against shipped bytes
 *    rather than against this file's good intentions.
 *
 * If gui-app ever bumps `version`, the probe is what fails.
 */

/** Mirrors gui-app's `ENVELOPE_KIND`. */
const ENVELOPE_KIND = "notificationActivation";
/** Mirrors gui-app's `ENVELOPE_VERSION`. Bumping this is a client change first. */
const ENVELOPE_VERSION = 1;

/**
 * The feed a row came from. This service only ever produces `"host"` rows —
 * it subscribes to one host's notification stream and nothing else — but the
 * union is stated whole because a narrower type here would silently become
 * wrong the day a second source is relayed.
 */
export type NotificationActivationFeedSource =
  "host" | "cloud" | "app-local" | "global";

export interface NotificationActivationFeed {
  readonly source: NotificationActivationFeedSource;
  readonly id: string;
}

/**
 * The navigation target, mirroring gui-app's `NotificationPayload`.
 *
 * Only the arms this service can produce from a host notification entry are
 * modelled. `session` and `terminal` are absent because no actionable host
 * entry maps to them (`session` is not even routable — gui-app's
 * `isNotificationPayloadRoutable` returns `false` for it), and `epic` is
 * absent because the host's `epic`-shaped payload routes as a CHAT, which is
 * gui-app's decision and is reproduced in `push-payload.ts`.
 *
 * `undefined` fields are dropped by `JSON.stringify` and read back as
 * `undefined` by gui-app's `readString`-based parsers, so their absence on the
 * wire is the same value — asserted in `push-payload.test.ts` rather than
 * assumed.
 */
export type NotificationActivationRoute =
  | {
      readonly kind: "chat";
      readonly epicId: string;
      readonly chatId: string | undefined;
    }
  | {
      readonly kind: "approval";
      readonly epicId: string | undefined;
      readonly chatId: string | undefined;
      readonly approvalId: string | undefined;
      readonly sessionId: undefined;
      readonly artifactId: undefined;
    }
  | {
      readonly kind: "interview";
      readonly epicId: string;
      readonly chatId: string;
      readonly interviewBlockId: string | undefined;
    }
  | {
      readonly kind: "hostSurface";
      readonly surface: "worktreeSettings";
      readonly focus: undefined;
    };

export interface NotificationActivationEnvelopeV1 {
  readonly kind: typeof ENVELOPE_KIND;
  readonly version: typeof ENVELOPE_VERSION;
  readonly route: NotificationActivationRoute;
  readonly feed: NotificationActivationFeed;
  /**
   * The machine the notification happened on, captured at emission time.
   *
   * NOT decoration and not optional in practice: gui-app's
   * `routeOpenChatNotification` refuses to reuse a chat tile whose `hostId`
   * differs from this value, so a click can never land on a same-id chat
   * replicated onto a different host. `null` means "no origin known", which
   * gui-app treats as the legacy host-agnostic route — correct as a fallback,
   * wrong as a default, which is why `index.ts` reads the live host id per
   * batch instead of passing `null`.
   */
  readonly originHostId: string | null;
}

export function buildNotificationActivationEnvelope(input: {
  readonly route: NotificationActivationRoute;
  readonly feed: NotificationActivationFeed;
  readonly originHostId: string | null;
}): NotificationActivationEnvelopeV1 {
  return {
    kind: ENVELOPE_KIND,
    version: ENVELOPE_VERSION,
    route: input.route,
    feed: input.feed,
    originHostId: input.originHostId,
  };
}
