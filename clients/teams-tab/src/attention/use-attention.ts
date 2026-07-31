/**
 * "Waiting on you" — `host.notifications.feed.subscribe`, user-scoped.
 *
 * NO Y.DOC on this surface. The feed sends typed JSON frames, so the epic
 * doc's 50.6 MB / ~40s host-side serialisation cannot repeat here. Phases are
 * still logged on first load: the shape says it should be fast, and "should"
 * is what put the last estimate 12x out.
 *
 * THE TITLE JOIN IS NON-BLOCKING, and that is the design point. The feed
 * answers the question — what needs me. Epic titles are context. Rows render
 * the moment the feed lands and upgrade in place when the join resolves, so a
 * slow or failed `epic.listTasks` costs a nicer label and never the answer.
 * Same principle as consuming `earlyMeta`: show what you have when you have
 * it.
 */
import { useEffect, useRef, useState } from "react";
import {
  hostNotificationsSubscribeServerFrameSchema,
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
  toAttentionItems,
  type AttentionItem,
} from "@traycer-clients/shared/epic/attention";
import {
  fetchEpicListPage,
  toFleetEpics,
  type EpicListClient,
} from "@traycer-clients/shared/epic/epic-list";

/**
 * How many attention rows to ask for.
 *
 * Generous, because this list is the reason the screen exists and a truncated
 * one silently understates what is waiting. `recent` is asked for at the
 * minimum the schema allows — v1 does not render it, and requesting a large
 * slice we discard would cost the host work for nothing.
 */
const INITIAL_ATTENTION_LIMIT = 200;
const INITIAL_RECENT_LIMIT = 1;

export type AttentionState =
  /** Subscribed, no snapshot yet. NOT "nothing is waiting". */
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly items: readonly AttentionItem[];
      /** From the host's own `summary`, never derived here. */
      readonly summary: HostNotificationsSummary | null;
      /** `epicId` → title, filled in as the join resolves. May be empty. */
      readonly epicTitles: Readonly<Record<string, string>>;
    }
  | { readonly kind: "error"; readonly detail: string };

export function useAttention(
  streamConnection: HostStreamConnection | null,
  listClient: EpicListClient | null,
): AttentionState {
  const [state, setState] = useState<AttentionState>({ kind: "loading" });
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
        items: toAttentionItems(feedEntries(feedRef.current)),
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
      feedRef.current = applyFeedFrame(feedRef.current, parsed.data);
      if (!sawSnapshot && parsed.data.kind === "snapshot") {
        sawSnapshot = true;
        // eslint-disable-next-line no-console -- a Teams tab has no timeline
        // anyone will open; this is the channel that produced the 47s answer.
        console.info(
          `[attention] snapshot=${String(Date.now() - t0)}ms attention=${String(parsed.data.attention.entries.length)}`,
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
      void fetchEpicListPage(listClient, undefined)
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
