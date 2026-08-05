/**
 * What a canvas tab can hold in THIS client.
 *
 * The one file in `src/canvas/` that is deliberately NOT a copy of gui-app's.
 * `tile-tree.ts` is content-agnostic and lifts verbatim; this is the content,
 * and the content is where the two clients differ on purpose.
 *
 * ─── The four kinds, and the four that are missing ───
 *
 * gui-app has eight tile kinds. Four are deferred with reasons recorded in the
 * canvas audit, not "not done yet":
 *
 *   terminal (xterm)   an xterm inside a Teams iframe is a different product
 *                      question wearing a tile's clothes - host filesystem,
 *                      keyboard capture, a security surface nobody has scoped
 *   workspace-file     same: a host-filesystem surface
 *   git-diff           a review tool; the tab shows diffs INSIDE transcript
 *                      cards, which is what a reader there needs
 *   snapshot-diff      as above
 *
 * **Deferring costs nothing and is reversible precisely because the tree is
 * content-agnostic** - adding a kind is additive, and the layout engine never
 * has to hear about it.
 *
 * ─── Two model facts carried deliberately from the desktop ───
 *
 * `instanceId` is minted PER OPEN and is not the content `id`. The same
 * artifact can be open in two panes at once. Key tab identity - React keys,
 * active/preview selection, close, move - on `instanceId`; key dedup and
 * rename on `id`. Getting this backwards does not error: it silently dedups,
 * and presents as **"the second copy won't open"**.
 *
 * `hostId` is bound at open time and for life. The Teams tab is single-host
 * today, so this field looks like dead weight - it is not. Multi-host is the
 * product's direction, and a layout persisted WITHOUT the field needs a
 * migration to gain it while sanitize-on-read invents a value. Carrying it is
 * cheap now and irreversible-shaped later.
 */

/** Artifact kinds this client can render as a canvas tab. */
export const ARTIFACT_TILE_KINDS = [
  "spec",
  "ticket",
  "story",
  "review",
] as const;

export type ArtifactTileKind = (typeof ARTIFACT_TILE_KINDS)[number];

export function isArtifactTileKind(value: string): value is ArtifactTileKind {
  return (ARTIFACT_TILE_KINDS as ReadonlyArray<string>).includes(value);
}

interface TileRefBase {
  /** Content identity. Two tabs on the same content share this. */
  readonly id: string;
  /** Per-open identity. Minted fresh on every open; never reused. */
  readonly instanceId: string;
  readonly name: string;
  /** The host the content lives on, bound at open time and for life. */
  readonly hostId: string;
}

export interface ChatTileRef extends TileRefBase {
  readonly type: "chat";
}

export interface ArtifactTileRef extends TileRefBase {
  readonly type: ArtifactTileKind;
}

/**
 * A tab with nothing in it yet - a real, titled, closable tab whose body is
 * the opener. Picking content replaces it in place.
 *
 * It exists so that "split this pane" has something to put in the new pane.
 * Without it a split either duplicates the current tab (wrong - two live
 * views of one thing by default) or opens an empty pane the tree considers
 * invalid outside the root.
 */
export interface BlankTileRef extends TileRefBase {
  readonly type: "blank";
}

export type TileRef = ChatTileRef | ArtifactTileRef | BlankTileRef;

export type TileKind = TileRef["type"];

/**
 * Bound to the union, not to a hand-written list. Adding a member to `TileRef`
 * without adding a label here is a COMPILE ERROR rather than a tab that
 * renders as `undefined` - the same device that guards `ContentBlock`'s
 * fifteen members in the transcript renderers.
 */
export const TILE_KIND_LABELS: Readonly<Record<TileKind, string>> = {
  chat: "Chat",
  spec: "Spec",
  ticket: "Ticket",
  story: "Story",
  review: "Review",
  blank: "New tab",
};

export function isBlankTile(ref: TileRef): ref is BlankTileRef {
  return ref.type === "blank";
}

/**
 * The display title. A blank tab shows its kind label rather than its `name`,
 * because a blank tab has no content to be named after and an empty string in
 * a tab strip reads as a rendering bug.
 */
export function tileTitle(ref: TileRef): string {
  if (isBlankTile(ref)) return TILE_KIND_LABELS.blank;
  return ref.name.trim() === "" ? TILE_KIND_LABELS[ref.type] : ref.name;
}
