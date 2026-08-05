/**
 * A chat, rendered as the body of a canvas pane.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS DIALS, AND `canvas-screen.tsx` WARNS AGAINST TILES THAT DIAL — read
 * this before concluding one of the two is wrong
 * ─────────────────────────────────────────────────────────────────────────
 *
 * That warning is about the EPIC doc: every agent, chat and artifact in an
 * epic comes from ONE `epic.subscribe`, and a tile that opened its own would
 * multiply it per tab. This component does not open one — it takes `entry`
 * as a prop, read from that single doc upstream. **That invariant is intact.**
 *
 * A transcript is a different subscription. `chat.subscribe` is per-chat by
 * protocol; the epic doc does not carry messages, so there is no doc to read
 * this from and no version of a chat pane that dials nothing.
 *
 * The warning's own worked example is this case — *"the mobile client opens a
 * socket per chat and it takes a phone-sized browser down at around sixty"* —
 * so the bound matters and here it is: **`tile-canvas.tsx` mounts only the
 * ACTIVE tab of each pane**, so live chat streams equal the number of PANES,
 * not the number of open tabs. Twenty chats in a strip is one subscription.
 * Sixty is not reachable by opening tabs; it would take sixty panes, which
 * `split-affordance.ts` already refuses long before.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ONE CONTROLLER PER PANE, NOT ONE PER CHAT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Two panes on the same chat hold two controllers. `tile-ref.ts` mints
 * `instanceId` per open precisely so the same content can be open twice, and
 * a controller shared on the chat id would reintroduce the coupling that
 * `instanceId` exists to break: closing one pane would tear down the other's
 * stream. `use-chat.ts` disposes on unmount, so closing a tab closes its own
 * stream and only its own.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT `ChatRoute`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `app.tsx`'s `ChatRoute` is the same two lines — `useChat` then `ChatScreen`
 * — and they are deliberately not merged. `ChatRoute` owns the full-screen
 * chrome (`styles.screen` padding, a breadcrumb that navigates the router);
 * this owns pane chrome, which is none. Merging them would mean a `chrome`
 * prop threaded through a component whose only other job is to call one hook,
 * and the two would still diverge the moment either surface gains a wrapper.
 */
import { useRef, type ReactElement } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import type { EpicChatEntry } from "@traycer-clients/shared/epic/epic-doc-chats";
import type { HostStreamConnection } from "@traycer-clients/shared/host-transport/single-host-stream-connection";
import { ChatScreen } from "../chat/chat-screen";
import { useChat } from "../chat/use-chat";
import type { SnapshotDiffClient } from "../chat/blocks/use-snapshot-diff";
import { useAutoScrollToBottom } from "../chat/use-auto-scroll-to-bottom";
import { ScrollToBottomChip } from "../chat/scroll-to-bottom-chip";

const useStyles = makeStyles({
  /**
   * The pane is the scroll container, not the page.
   *
   * `app.tsx`'s `styles.screen` is deliberately NOT reused here: it is the
   * full-screen padding shared by eleven routes, and a pane is one cell of a
   * split. `minHeight: 0` is the load-bearing half — without it a flex child
   * refuses to shrink below its content and the transcript pushes the pane
   * past its allotted extent instead of scrolling inside it, which presents
   * as the split handle "not working".
   *
   * `position: relative` so the jump-to-latest chip below anchors to THIS
   * box's visible extent, not the scrolled content's full height — the same
   * reason mobile's `ScrollToBottomChip` lives inside its own scrollRef div.
   */
  body: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingVerticalM,
    minHeight: 0,
    height: "100%",
    overflowY: "auto",
    boxSizing: "border-box",
  },
});

export interface ChatTileProps {
  readonly streamConnection: HostStreamConnection | null;
  /** The unary client — the transcript's diff bodies are requests, not frames. */
  readonly diffClient: SnapshotDiffClient | null;
  readonly epicId: string;
  readonly chatId: string;
  /** The chat's epic-doc row, for locality. `null` when the list has not got there. */
  readonly entry: EpicChatEntry | null;
  readonly configuredHostId: string;
  readonly now: number;
}

export function ChatTile({
  streamConnection,
  diffClient,
  epicId,
  chatId,
  entry,
  configuredHostId,
  now,
}: ChatTileProps): ReactElement {
  const styles = useStyles();
  const controller = useChat(streamConnection, epicId, chatId);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { isAtBottom, handleScroll, scrollToBottom } = useAutoScrollToBottom(
    scrollRef,
    `${epicId}:${chatId}`,
    controller.state.kind === "ready" ? controller.state.messages : null,
  );

  return (
    <div ref={scrollRef} onScroll={handleScroll} className={styles.body}>
      <ChatScreen
        controller={controller}
        entry={entry}
        configuredHostId={configuredHostId}
        diffClient={diffClient}
        now={now}
        chrome={{ kind: "pane" }}
      />
      <ScrollToBottomChip visible={!isAtBottom} onClick={() => scrollToBottom(true)} />
    </div>
  );
}
