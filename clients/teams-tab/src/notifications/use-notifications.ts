/**
 * The app-level notification feed — `host.notifications.feed.subscribe`,
 * user-scoped, ONE subscription for the whole tab.
 *
 * MOVED HERE from `attention/use-attention.ts`, which opened this stream
 * itself. That was correct while "Waiting on you" was the only consumer and
 * became wrong the moment the bell existed: the bell lives in the frame and
 * must carry a count on EVERY screen, while `useAttention` only ran on the one
 * route that rendered it. Leaving it there and adding a second subscription
 * for the bell would put two streams on one feed, paged independently — two
 * readers of the same data that can disagree, which is the defect this
 * client's own `host-notifications-feed` docblock exists to prevent.
 *
 * So the subscription is hoisted to the screen that owns the connection, and
 * both surfaces project from one state. `attention/attention-state.ts` is that
 * projection for the waiting screen; the bell reads `summary` directly.
 *
 * NO Y.DOC on this surface. The feed sends typed JSON frames, so the epic
 * doc's 50.6 MB / ~40s host-side serialisation cannot repeat here. The first
 * snapshot is still logged, because the shape saying "this should be fast" is
 * what put the last estimate 12x out.
 *
 * THE TITLE JOIN IS NON-BLOCKING, and that is the design point. The feed
 * answers the question — what needs me. Epic titles are context. Rows render
 * the moment the feed lands and upgrade in place when the join resolves, so a
 * slow or failed `epic.listTasks` costs a nicer label and never the answer.
 */
import { useEffect, useRef, useState } from "react";
import {
  hostNotificationsSubscribeServerFrameSchema,
  type HostNotificationEntry,
  type HostNotificationsSummary,
} from "@traycer/protocol/host/notifications/host-notifications";
import type { StreamFrameEnvelope } from "@traycer-clients/shared/host-transport/i-stream-session";
import type { HostStreamConnection } from "@traycer-clients/shared/host-transport/single-host-stream-connection";
import {
  applyFeedFrame,
  feedEntries,
  EMPTY_FEED_STATE,
  type FeedState,
} from "@traycer-clients/shared/epic/host-notifications-feed";
import {
  fetchEpicListPage,
  toFleetEpics,
  type EpicListClient,
} from "@traycer-clients/shared/epic/epic-list";

/**
 * How many rows to ask for on the first snapshot.
 *
 * `attention` is generous because that list is the reason the feature exists
 * and a truncated one silently understates what is waiting.
 *
 * `recent` WAS 1. That was right when the only consumer rendered the attention
 * slice and discarded the rest — asking for a large slice we throw away costs
 * the host work for nothing. The notifications screen renders `recent`, so the
 * number is now a real bound on what that screen can show, and 100 matches
 * what the mobile client asks for on the identical surface.
 */
const INITIAL_ATTENTION_LIMIT = 200;
const INITIAL_RECENT_LIMIT = 100;

export type NotificationsState =
  /** Subscribed, no snapshot yet. NOT "nothing is waiting". */
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      /** Every entry the feed has sent, newest-first. */
      readonly entries: readonly HostNotificationEntry[];
      /** From the host's own `summary`, never derived here. */
      readonly summary: HostNotificationsSummary | null;
      /** `epicId` → title, filled in as the join resolves. May be empty. */
      readonly epicTitles: Readonly<Record<string, string>>;
    }
  | { readonly kind: "error"; readonly detail: string };

export function useNotifications(
  streamConnection: HostStreamConnection | null,
  listClient: EpicListClient | null,
): NotificationsState {
  const [state, setState] = useState<NotificationsState>({ kind: "loading" });
  const feedRef = useRef<FeedState>(EMPTY_FEED_STATE);
  const titlesRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (streamConnection === null) {
      setState({
        kind: "error",
        detail: "No Traycer host is configured for this build.",
      });
      return;
    }

    let disposed = false;
    feedRef.current = EMPTY_FEED_STATE;
    setState({ kind: "loading" });

    const t0 = Date.now();
    let sawSnapshot = false;

    const publish = (): void => {
      if (disposed) return;
      setState({
        kind: "ready",
        // Newest-first, matching mobile's ordering on the same feed. The
        // waiting screen re-sorts oldest-first for its own reason (see
        // `shared/epic/attention.ts`), which is a property of that projection
        // rather than of the feed.
        entries: [...feedEntries(feedRef.current)].sort(
          (a, b) => b.updatedAt - a.updatedAt,
        ),
        summary: feedRef.current.summary,
        epicTitles: { ...titlesRef.current },
      });
    };

    const session = streamConnection.client.subscribe(
      "host.notifications.feed.subscribe",
      {
        initialAttentionLimit: INITIAL_ATTENTION_LIMIT,
        initialRecentLimit: INITIAL_RECENT_LIMIT,
      },
    );

    session.onServerFrame((envelope: StreamFrameEnvelope) => {
      if (disposed) return;
      const parsed =
        hostNotificationsSubscribeServerFrameSchema.safeParse(envelope);
      // A frame that fails the schema is DROPPED, not fatal. The alternative
      // is that one malformed row takes down the only screen that lists what
      // needs a human.
      if (!parsed.success) return;
      const next = applyFeedFrame(feedRef.current, parsed.data);
      /**
       * A FRAME THAT CHANGED NOTHING DOES NOT MOVE US OUT OF `loading`.
       *
       * `applyFeedFrame` returns the SAME OBJECT for `pong` and
       * `channelEmission` — a heartbeat and an external delivery, neither of
       * which is feed state. Publishing on them anyway turned the very first
       * heartbeat into `{ kind: "ready", entries: [], summary: null }`, and
       * both surfaces render that as an answer: *"You're all caught up."* and
       * *"Nothing is waiting on you."*
       *
       * So a keepalive arriving before the snapshot produced a confident
       * "nothing needs you" on the screen whose whole promise is the
       * opposite — the empty-versus-loading conflation the bell's nullable
       * summary was built to avoid, reintroduced one layer below it. Caught in
       * the preview images, not in a test.
       *
       * Reference equality is exact here rather than approximate: every frame
       * kind that IS feed state constructs a new object.
       */
      if (next === feedRef.current) return;
      feedRef.current = next;
      if (!sawSnapshot && parsed.data.kind === "snapshot") {
        sawSnapshot = true;
        // eslint-disable-next-line no-console -- a Teams tab has no timeline
        // anyone will open; this is the channel that produced the 47s answer.
        console.info(
          `[notifications] snapshot=${String(Date.now() - t0)}ms attention=${String(parsed.data.attention.entries.length)} recent=${String(parsed.data.recent.entries.length)}`,
        );
      }
      publish();
    });

    /**
     * The title join, fired in PARALLEL and never awaited by the rows.
     *
     * Failure is swallowed deliberately: rows already render with a labelled
     * short id, and an error here would replace a working answer with a
     * failure state over a cosmetic lookup.
     */
    if (listClient !== null) {
      // `{}` — unsearched, default sort. This join only needs id → title.
      void fetchEpicListPage(listClient, undefined, {})
        .then((page) => {
          if (disposed) return;
          const next: Record<string, string> = { ...titlesRef.current };
          for (const epic of toFleetEpics(page.tasks)) {
            next[epic.id] = epic.title;
          }
          titlesRef.current = next;
          publish();
        })
        .catch(() => {
          // Rows keep their short-id labels. Nothing to report to the user:
          // the screen still answers its question.
        });
    }

    return () => {
      disposed = true;
      session.close();
    };
  }, [streamConnection, listClient]);

  return state;
}
