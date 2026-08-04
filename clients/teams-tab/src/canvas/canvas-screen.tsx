/**
 * The canvas as a screen: one epic's tile layout, at its own URL.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS COMMIT DOES AND DOES NOT DO — read this before concluding the
 * canvas works
 * ─────────────────────────────────────────────────────────────────────────
 *
 * This makes the canvas REACHABLE. It does not make it useful, and the
 * distinction is the whole reason it is one commit and not three.
 *
 * The layout engine underneath is eleven commits old and fully tested:
 * splits, tab strips, preview tabs, activation history, resize with a pixel
 * floor, sanitize-on-read persistence. **Nothing in the UI can open a tab.**
 * There is no "+" on a strip, no split gesture, and `splitPane` — which
 * exists, is correct and is covered — is called by no component. So the only
 * state this screen can currently be in is empty, and it says so on screen
 * rather than rendering a blank rectangle.
 *
 * That is deliberate sequencing, not an oversight: the entry point is the
 * next step and it is where the questions live (what opens, from where, and
 * what "open" means when a chat already has its own route). Shipping the
 * route first means the plumbing is proven against a real URL before any of
 * that is decided.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IN-MEMORY STATE, ON PURPOSE, FOR EXACTLY ONE MORE COMMIT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `loadCanvas`/`saveCanvas` and `browserCanvasStorage(epicId)` all exist and
 * are not called here yet. Wiring them is the step after the entry point, and
 * it has a hazard worth arriving at deliberately: the storage key is
 * per-epic, so a `useState` initialiser — which runs once per component
 * lifetime, while epic A → epic B is a PROP change and not a remount — would
 * show A's layout under B and then save it to B's key. Persisting nothing is
 * the honest state until that is handled and tested.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE SUBSCRIPTION INVARIANT, WHICH A CANVAS MAKES EASY TO BREAK
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The tab derives every agent, chat and artifact in an epic from ONE
 * `epic.subscribe` Y.Doc, read through `readChatsFromEpicDoc(doc)` — one
 * subscription, already in memory, opened above this screen.
 *
 * **A tile that opens its own subscription breaks that**, and a canvas is
 * precisely the thing that encourages many tiles at once. The mobile client
 * opens a socket per chat and it takes a phone-sized browser down at around
 * sixty. `tile-canvas.tsx` already holds half the defence by mounting only
 * the active tab of each pane; the other half is that tile bodies must read
 * from the epic doc passed down, and must not dial anything themselves.
 */
import type { ReactElement, ReactNode } from "react";
import {
  Body1,
  Breadcrumb,
  BreadcrumbButton,
  BreadcrumbDivider,
  BreadcrumbItem,
  Caption1,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { v4 as uuidv4 } from "uuid";
import type { EpicChatEntry } from "@traycer-clients/shared/epic/epic-doc-chats";
import { TileCanvas } from "./tile-canvas";
import { makeBlankTile } from "./opener";
import { ChatTile } from "./chat-tile";
import { tileTitle, type TileRef } from "./tile-ref";
import { openTile, type CanvasState, type IdSource } from "./canvas-state";
import type { HostStreamConnection } from "@traycer-clients/shared/host-transport/single-host-stream-connection";
import type { SnapshotDiffClient } from "../chat/blocks/use-snapshot-diff";

/**
 * What a tile body needs that the tile itself does not carry.
 *
 * A `TileRef` is content IDENTITY — id, name, host — and deliberately nothing
 * else, so that persisting a layout persists no live state. Everything a body
 * needs to actually render is therefore ambient to the screen, and this is
 * the one place it is named.
 *
 * `chatEntry` is a LOOKUP, not a list, because the answer changes as the epic
 * doc streams in and a tile that captured a row at open time would go stale
 * against a rename or a locality change.
 */
interface TileDeps {
  readonly streamConnection: HostStreamConnection | null;
  readonly diffClient: SnapshotDiffClient | null;
  readonly epicId: string;
  readonly hostId: string;
  readonly now: number;
  readonly chatEntry: (chatId: string) => EpicChatEntry | null;
}

const useStyles = makeStyles({
  screen: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    // The containment pair. Without it the canvas grows to its content
    // instead of filling the frame, and a pane's tab strip leaves the screen
    // on a long transcript — the defect the shell contract exists to prevent,
    // arriving through a new screen that never read it.
    minHeight: 0,
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalM,
    boxSizing: "border-box",
  },
  canvasHost: {
    flexGrow: 1,
    minHeight: 0,
  },
  placeholder: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingVerticalL,
  },
  subtle: { color: tokens.colorNeutralForeground3 },
});

export interface CanvasScreenProps {
  readonly epicId: string;
  /** The epic's name when known. `null` on a deep link, as everywhere else. */
  readonly epicName: string | null;
  readonly state: CanvasState;
  readonly onChange: (next: CanvasState) => void;
  readonly onBack: () => void;
  /** Bound onto every tile this screen mints, and carried for life. */
  readonly hostId: string;
  /**
   * Pane and group ids. Injected so a test can supply a counter and assert on
   * the tree it produced; `uuidIds` is what the app passes.
   */
  readonly ids: IdSource;
  /** The chat stream, for chat tiles. `null` when no host is configured. */
  readonly streamConnection: HostStreamConnection | null;
  /** The unary client — a transcript's diff bodies are requests, not frames. */
  readonly diffClient: SnapshotDiffClient | null;
  readonly now: number;
  /**
   * The epic-doc row for a chat, or `null` when the doc has not got there.
   *
   * A function rather than the rows themselves: the screen has no use for the
   * list, only for the row a given tile names, and passing the list would
   * invite a tile body to iterate it.
   */
  readonly chatEntry: (chatId: string) => EpicChatEntry | null;
}

/**
 * Real ids for the running app.
 *
 * Separate from the component so the injection has one obvious production
 * value rather than a default parameter — the package's lint bans those, and
 * the reason applies here: a defaulted `IdSource` is one a test can forget to
 * override while believing it did.
 */
export const uuidIds: IdSource = {
  paneId: () => uuidv4(),
  groupId: () => uuidv4(),
};

/**
 * A tile whose body is genuinely not built yet, saying which one and why.
 *
 * A COMPONENT, not a helper that calls `useStyles()` and returns JSX. The
 * first draft was the latter, invoked from `renderTile` as a plain function —
 * a hook call outside a render, which React permits right up until it does
 * not and which the strip's own `react-hooks` rules would have caught only
 * after eslint ran.
 */
function TilePlaceholder({
  tile,
  detail,
}: {
  readonly tile: TileRef;
  readonly detail: string;
}): ReactElement {
  const styles = useStyles();
  return (
    <div className={styles.placeholder}>
      <Body1>{tileTitle(tile)}</Body1>
      <Caption1 className={styles.subtle}>{detail}</Caption1>
    </div>
  );
}

/**
 * One tile's body — now a switch, and the `never` below is load-bearing.
 *
 * It was previously uniform across all six kinds, correctly: nothing could
 * open a tab, so every kind was equally unrenderable and six branches saying
 * "not yet" in different words would have been structure standing in for
 * capability. That is no longer true of `chat`, so the switch arrives with
 * the commit that gives a branch something to return, exactly as the previous
 * docblock said it would.
 *
 * **The artifact branches are still placeholders, and the reason changed
 * underneath this docblock — corrected rather than left stale.** The
 * `@tiptap/*` bundle-size blocker this paragraph used to name is gone: the
 * deps are now in `package.json` and `artifacts/use-artifact-body.ts` +
 * `artifacts/artifact-body/` (lifted from `clients/mobile`) render a real
 * artifact from the epic-tree door (`epic-detail.tsx` → `onOpenArtifact`) —
 * see `parity-contract` §*Two renderers with no door*.
 *
 * **What still blocks a CANVAS tile specifically** is narrower and
 * structural, not a dependency question: an artifact's `Y.Doc` bytes ride
 * the SAME `epic.subscribe` session as its `ArtifactRoomRegistry`, and that
 * registry is built by `useEpicAgents` inside `EpicScreen` — this screen's
 * own subscription invariant (see the file docblock above) forbids a tile
 * from opening a second one. Threading `EpicScreen`'s registry down to
 * `CanvasScreen` (the same way `chatEntry` is threaded, currently as
 * `() => null` for the same underlying reason) is the shape of the fix, not
 * a rendering change to this file.
 */
function renderTile(tile: TileRef, deps: TileDeps): ReactNode {
  switch (tile.type) {
    case "chat":
      return (
        <ChatTile
          streamConnection={deps.streamConnection}
          diffClient={deps.diffClient}
          epicId={deps.epicId}
          chatId={tile.id}
          entry={deps.chatEntry(tile.id)}
          configuredHostId={deps.hostId}
          now={deps.now}
        />
      );

    case "spec":
    case "ticket":
    case "story":
    case "review":
      return (
        <TilePlaceholder
          tile={tile}
          detail="Open this from the epic's Artifacts list for now — a canvas pane can't reach an artifact's document yet."
        />
      );

    case "blank":
      return (
        <TilePlaceholder
          tile={tile}
          detail="Pick something to show here. Opening content into a blank tab lands next."
        />
      );

    default: {
      /*
       * Load-bearing, not decorative. A new member of `TileRef` fails the
       * BUILD here rather than rendering an empty pane — the same device
       * `TILE_KIND_LABELS` uses one file over, and the reason `tile-ref.ts`
       * says deferring a kind "costs nothing and is reversible".
       */
      const unreachable: never = tile;
      return unreachable;
    }
  }
}

export function CanvasScreen({
  epicId,
  epicName,
  state,
  onChange,
  onBack,
  hostId,
  ids,
  streamConnection,
  diffClient,
  now,
  chatEntry,
}: CanvasScreenProps): ReactElement {
  const styles = useStyles();
  const title = epicName ?? `Epic ${epicId.slice(0, 8)}`;

  /*
   * NOT memoised, deliberately. `now` ticks, so a `useMemo` keyed on these
   * deps would rebuild on every tick anyway — the memo would cost a
   * comparison and buy nothing. `renderTile` is called during render by
   * `tile-canvas.tsx`, not stored, so identity does not matter here; the
   * moment it is passed to something memoised, this comment is the thing to
   * revisit.
   */
  const deps: TileDeps = {
    streamConnection,
    diffClient,
    epicId,
    hostId,
    now,
    chatEntry,
  };

  return (
    <div className={styles.screen}>
      {/*
        Breadcrumb rather than browser back, matching the epic detail screen:
        a Teams tab is chrome inside chrome and the browser's back control is
        not where a Teams user looks. Back still works.
      */}
      <Breadcrumb aria-label="Location">
        <BreadcrumbItem>
          <BreadcrumbButton onClick={onBack}>{title}</BreadcrumbButton>
        </BreadcrumbItem>
        <BreadcrumbDivider />
        <BreadcrumbItem>
          <BreadcrumbButton current>Canvas</BreadcrumbButton>
        </BreadcrumbItem>
      </Breadcrumb>

      <div className={styles.canvasHost}>
        <TileCanvas
          state={state}
          onChange={onChange}
          renderTile={(tile) => renderTile(tile, deps)}
          ids={ids}
          hostId={hostId}
          // Names WHY it is empty rather than that it is. "Nothing open" is
          // true and tells a user who just navigated here that the screen is
          // working as intended, which is the opposite of what they need to
          // know.
          emptyLabel="Nothing open yet — opening epic content in a pane lands next."
          onOpenFirst={() => {
            onChange(
              openTile({
                state,
                tile: makeBlankTile(hostId),
                preview: false,
                ids,
              }),
            );
          }}
        />
      </div>
    </div>
  );
}
