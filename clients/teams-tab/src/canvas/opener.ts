/**
 * Turning "the user picked a thing" into "a tab exists".
 *
 * Pure, and deliberately separate from both the canvas and the lists that
 * call it. The lists know what a chat is; the canvas knows what a pane is;
 * **this is the only place that knows both**, which is what keeps
 * `tile-canvas.tsx` free of an opinion about chats and `agents-list.tsx` free
 * of an opinion about panes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * FOCUS-IF-OPEN, AND WHY IT LIVES HERE RATHER THAN IN `openTile`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `openTile` deliberately does NOT dedup: two tabs may show the same content,
 * which is what `instanceId` exists for, and a dedup down there is the defect
 * that presents as *"the second copy won't open"*.
 *
 * But clicking the same chat in a list twice should not make a second tab —
 * that is a different question with a different answer, and the difference is
 * **who asked**. A list click means "show me this"; a split or a duplicate
 * means "give me another view of this". Same content id, opposite intent.
 *
 * So the policy is a parameter (`onAlreadyOpen`) and the caller states which
 * it means. A default here would be the same mistake as a default parameter
 * in a fixture: it would silently pick one intent for callers who never
 * considered that there were two.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SINGLE CLICK PREVIEWS, DOUBLE CLICK KEEPS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The gesture-to-intent mapping lives in the caller; what lives here is that
 * a preview open and a permanent open are the same operation with one flag.
 * Keeping them one function is what stops the two paths drifting — which is
 * how a "preview" ends up permanent for one entry point and not another.
 */
import { v4 as uuidv4 } from "uuid";
import {
  openTile,
  setActiveTab,
  type CanvasState,
  type IdSource,
} from "./canvas-state";
import { collectPanes } from "./tile-tree";
import type { ArtifactTileKind, TileRef } from "./tile-ref";

/**
 * What a caller knows about the thing being opened. NOT a `TileRef` — the
 * `instanceId` is minted here, on purpose: a caller that supplies one has
 * either invented it (and may reuse it) or lifted it from an existing tab
 * (and will collide with it). Minting at the open point makes "per open"
 * true by construction rather than by convention.
 */
export interface OpenRequest {
  readonly type: "chat" | ArtifactTileKind;
  /** Content identity — the chat id or artifact id. */
  readonly id: string;
  readonly name: string;
  readonly hostId: string;
}

export type AlreadyOpenPolicy =
  /** A list click: show me this. Focus the existing tab, open nothing. */
  | "focus-existing"
  /** A split or duplicate: give me another view. Always a new tab. */
  | "always-new";

export interface OpenInCanvasArgs {
  readonly state: CanvasState;
  readonly request: OpenRequest;
  readonly onAlreadyOpen: AlreadyOpenPolicy;
  /** Single click. The tab is italic and the next preview replaces it. */
  readonly preview: boolean;
  /** Target pane. Defaults to the active one inside `openTile`. */
  readonly paneId: string | null;
  readonly ids: IdSource;
}

export interface OpenInCanvasResult {
  readonly state: CanvasState;
  /**
   * The tab now showing the content — whether freshly opened or focused.
   * Callers need it to scroll a strip or announce a change; returning it is
   * cheaper than making them search the tree for what they just did.
   */
  readonly instanceId: string;
  /** False when an existing tab was focused instead. */
  readonly opened: boolean;
}

/**
 * The first pane holding a tab whose CONTENT id matches, in tree order, with
 * that pane's id. Tree order rather than activation order: the answer must
 * not depend on where the user has been, or clicking the same list row twice
 * in a row could focus two different tabs.
 */
function findByContentId(
  state: CanvasState,
  id: string,
): { readonly paneId: string; readonly instanceId: string } | null {
  for (const pane of collectPanes(state.root)) {
    for (const instanceId of pane.tabInstanceIds) {
      if (state.tilesByInstanceId[instanceId]?.id === id) {
        return { paneId: pane.id, instanceId };
      }
    }
  }
  return null;
}

export function openInCanvas(args: OpenInCanvasArgs): OpenInCanvasResult {
  const { state, request, onAlreadyOpen, preview, paneId, ids } = args;

  if (onAlreadyOpen === "focus-existing") {
    const existing = findByContentId(state, request.id);
    if (existing !== null) {
      return {
        state: setActiveTab(state, existing.paneId, existing.instanceId),
        instanceId: existing.instanceId,
        opened: false,
      };
    }
  }

  const tile: TileRef = {
    type: request.type,
    id: request.id,
    instanceId: uuidv4(),
    name: request.name,
    hostId: request.hostId,
  };

  return {
    state: openTile({
      state,
      tile,
      preview,
      ...(paneId === null ? {} : { paneId }),
      ids,
    }),
    instanceId: tile.instanceId,
    opened: true,
  };
}

/**
 * A new blank tab in `paneId` — what "split this pane" puts in the new one,
 * and what a "+" on a strip opens.
 *
 * Separate from `openInCanvas` because a blank tab has no content: it has no
 * `id` to dedup on, no name to show, and no host to bind. Forcing it through
 * `OpenRequest` would mean inventing all three, and an invented content id is
 * one that a later focus-if-open could match against.
 */
export function makeBlankTile(hostId: string): TileRef {
  const instanceId = uuidv4();
  return {
    type: "blank",
    // The content id IS the instance id for a blank tab. Deliberate: it
    // guarantees no two blanks share a content id, so `focus-existing` can
    // never resolve one blank tab to another.
    id: instanceId,
    instanceId,
    name: "",
    hostId,
  };
}
