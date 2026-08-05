/**
 * The canvas as pure data plus pure transitions. No React, no store, no
 * persistence — those wrap this, they are not part of it.
 *
 * Written rather than copied: gui-app's equivalent (`actions.ts`, 1,443 lines)
 * is fused to a zustand store, a header-tab layer, terminals, worktrees and
 * six drag sources. What is content-agnostic there already lives in
 * `tile-tree.ts` and lifted verbatim. This file is the rest, at the size this
 * client's four tile kinds actually need.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE THREE INVARIANTS. Every function below preserves them or returns state.
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  I1  the key set of `tilesByInstanceId` is EXACTLY the instanceIds reachable
 *      from `root`. A payload with no tab leaks; a tab with no payload renders
 *      as a blank strip entry nothing can close.
 *
 *  I2  `activePaneId` names a pane that exists, or is null iff `root` is null.
 *
 *  I3  within a pane: `activeTabId` and `previewTabId` are members of
 *      `tabInstanceIds` or null, and `activationHistory` is a duplicate-free
 *      subsequence of it.
 *
 * `reconcile()` re-establishes all three from untrusted input. The transitions
 * maintain them incrementally instead, because a full walk on every keystroke
 * is how a canvas becomes sluggish.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PREVIEW AND ACTIVATION HISTORY ARE BUILT IN, NOT RETROFITTED
 * ─────────────────────────────────────────────────────────────────────────
 *
 * These are the two things that make a canvas FEEL like the desktop rather
 * than LOOK like it, and neither is visible in a screenshot:
 *
 *   PREVIEW      single-click opens a tab in italics that the NEXT single
 *                click replaces. Without it, browsing ten artifacts leaves
 *                ten tabs and the user starts closing things instead of
 *                looking at them.
 *
 *   ACTIVATION   closing the active tab focuses the one you were on BEFORE
 *   HISTORY      it, not its left neighbour. Left-neighbour focus is the
 *                default that feels wrong and nobody can say why.
 *
 * Both are cheap here and expensive later: retrofitting focus ordering means
 * revisiting every close path, and by then there are several.
 */
import {
  collectPanes,
  findPaneById,
  firstPaneId,
  insertPaneAtEdge,
  normalizeSizes,
  pruneSizes,
  removePaneFromTree,
  replacePane,
  type EdgeDropPosition,
  type SizesByGroupId,
  type TileLayoutNode,
  type TilePane,
} from "./tile-tree";
import { pruneActivationHistory } from "./activation-history";
import type { TileRef } from "./tile-ref";

export type TilesByInstanceId = Readonly<Record<string, TileRef | undefined>>;

export interface CanvasState {
  readonly root: TileLayoutNode | null;
  readonly activePaneId: string | null;
  readonly tilesByInstanceId: TilesByInstanceId;
  readonly sizesByGroupId: SizesByGroupId;
}

export const EMPTY_CANVAS: CanvasState = {
  root: null,
  activePaneId: null,
  tilesByInstanceId: {},
  sizesByGroupId: {},
};

/**
 * Id minting is injected, never imported.
 *
 * Tests need deterministic ids to assert tree shape, and a module-level
 * `uuidv4()` forces every test to either match a regex or stub a module. The
 * cost of the seam is one parameter; the cost of not having it is assertions
 * that cannot name what they expect.
 */
export interface IdSource {
  readonly paneId: () => string;
  readonly groupId: () => string;
}

// ---------------------------------------------------------------------------
// Pane-local helpers — the only place I3 is enforced
// ---------------------------------------------------------------------------

/**
 * Record `instanceId` as the most recent activation. MOST RECENT FIRST, so
 * `activationHistory[0]` after removing a tab is the one to focus.
 */
function pushActivation(
  history: ReadonlyArray<string>,
  instanceId: string,
): ReadonlyArray<string> {
  return [instanceId, ...history.filter((entry) => entry !== instanceId)];
}

function activateInPane(pane: TilePane, instanceId: string): TilePane {
  if (!pane.tabInstanceIds.includes(instanceId)) return pane;
  if (pane.activeTabId === instanceId) return pane;
  return {
    ...pane,
    activeTabId: instanceId,
    activationHistory: pushActivation(pane.activationHistory, instanceId),
  };
}

/**
 * Remove `instanceId` from a pane and choose the next active tab.
 *
 * THE FOCUS RULE, and the reason `activationHistory` exists: the next active
 * tab is the most recently activated SURVIVOR, not the left neighbour. Only
 * when the history is exhausted does it fall back to position — and then to
 * the tab that took the closed one's index, which is the "the list closed up
 * under my cursor" behaviour, not "jump to the far left".
 */
function removeFromPane(pane: TilePane, instanceId: string): TilePane {
  const index = pane.tabInstanceIds.indexOf(instanceId);
  if (index === -1) return pane;

  const tabInstanceIds = pane.tabInstanceIds.filter(
    (entry) => entry !== instanceId,
  );
  const activationHistory = pruneActivationHistory(
    pane.activationHistory,
    tabInstanceIds,
  );
  const previewTabId =
    pane.previewTabId === instanceId ? null : pane.previewTabId;

  if (pane.activeTabId !== instanceId) {
    return { ...pane, tabInstanceIds, activationHistory, previewTabId };
  }

  const byHistory = activationHistory[0] ?? null;
  const byPosition =
    tabInstanceIds[Math.min(index, tabInstanceIds.length - 1)] ?? null;
  const activeTabId = byHistory ?? byPosition;

  return {
    ...pane,
    tabInstanceIds,
    previewTabId,
    activeTabId,
    activationHistory:
      activeTabId === null
        ? activationHistory
        : pushActivation(activationHistory, activeTabId),
  };
}

function makePane(id: string, instanceId: string | null): TilePane {
  if (instanceId === null) {
    return {
      kind: "pane",
      id,
      tabInstanceIds: [],
      activeTabId: null,
      previewTabId: null,
      activationHistory: [],
    };
  }
  return {
    kind: "pane",
    id,
    tabInstanceIds: [instanceId],
    activeTabId: instanceId,
    previewTabId: null,
    activationHistory: [instanceId],
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function activePane(state: CanvasState): TilePane | null {
  if (state.activePaneId === null) return null;
  return findPaneById(state.root, state.activePaneId);
}

export function tileAt(state: CanvasState, instanceId: string): TileRef | null {
  return state.tilesByInstanceId[instanceId] ?? null;
}

/** Every instanceId reachable from the tree, in pane-then-strip order. */
export function reachableInstanceIds(
  state: CanvasState,
): ReadonlyArray<string> {
  return collectPanes(state.root).flatMap((pane) => [...pane.tabInstanceIds]);
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export interface OpenTileArgs {
  readonly state: CanvasState;
  readonly tile: TileRef;
  /** Target pane; defaults to the active one, then to the first. */
  readonly paneId?: string;
  /**
   * A single click. Replaces the pane's existing preview tab IN PLACE rather
   * than accumulating tabs. A double-click (or an edit) promotes it.
   */
  readonly preview?: boolean;
  readonly ids: IdSource;
}

/**
 * Open `tile` as a tab.
 *
 * Deliberately does NOT dedup on content `id`. Two tabs may show the same
 * artifact — that is what `instanceId` is for, and a dedup here is the defect
 * that presents as "the second copy won't open". A caller that wants
 * focus-if-open should look for the id first and call `setActiveTab`.
 */
export function openTile(args: OpenTileArgs): CanvasState {
  const { state, tile, preview = false, ids } = args;

  if (state.root === null) {
    const paneId = ids.paneId();
    const pane = makePane(paneId, tile.instanceId);
    return {
      // `preview` is honoured HERE too, and originally was not. The empty
      // branch is the first tab a user ever opens, so the bug was "the very
      // first single-click produces a permanent tab" — invisible in the
      // canvas-state suite, which always previewed into a canvas that
      // already had something in it. Found by the opener's tests.
      root: preview ? { ...pane, previewTabId: tile.instanceId } : pane,
      activePaneId: paneId,
      tilesByInstanceId: { [tile.instanceId]: tile },
      sizesByGroupId: {},
    };
  }

  const targetPaneId =
    args.paneId ?? state.activePaneId ?? firstPaneId(state.root);
  const target = findPaneById(state.root, targetPaneId);
  if (target === null) return state;

  // The preview tab being REPLACED, if any. Removing it before inserting is
  // what makes browsing cost one tab instead of one per click.
  const replacedId = preview ? target.previewTabId : null;

  const root = replacePane(state.root, targetPaneId, (pane) => {
    const withoutPreview =
      replacedId === null ? pane : removeFromPane(pane, replacedId);
    const tabInstanceIds = [...withoutPreview.tabInstanceIds, tile.instanceId];
    return {
      ...withoutPreview,
      tabInstanceIds,
      activeTabId: tile.instanceId,
      previewTabId: preview ? tile.instanceId : withoutPreview.previewTabId,
      activationHistory: pushActivation(
        withoutPreview.activationHistory,
        tile.instanceId,
      ),
    };
  });

  const tilesByInstanceId = { ...state.tilesByInstanceId };
  if (replacedId !== null) delete tilesByInstanceId[replacedId];
  tilesByInstanceId[tile.instanceId] = tile;

  return { ...state, root, activePaneId: targetPaneId, tilesByInstanceId };
}

/**
 * Make a preview tab permanent. Idempotent, and a no-op when the pane has no
 * preview — so a double-click on an already-permanent tab does nothing rather
 * than clearing somebody else's preview.
 */
export function promotePreview(
  state: CanvasState,
  paneId: string,
): CanvasState {
  if (state.root === null) return state;
  const pane = findPaneById(state.root, paneId);
  if (pane === null || pane.previewTabId === null) return state;
  return {
    ...state,
    root: replacePane(state.root, paneId, (target) => ({
      ...target,
      previewTabId: null,
    })),
  };
}

export function setActiveTab(
  state: CanvasState,
  paneId: string,
  instanceId: string,
): CanvasState {
  if (state.root === null) return state;
  const pane = findPaneById(state.root, paneId);
  if (pane === null || !pane.tabInstanceIds.includes(instanceId)) return state;
  return {
    ...state,
    root: replacePane(state.root, paneId, (target) =>
      activateInPane(target, instanceId),
    ),
    activePaneId: paneId,
  };
}

export function setActivePane(state: CanvasState, paneId: string): CanvasState {
  if (findPaneById(state.root, paneId) === null) return state;
  if (state.activePaneId === paneId) return state;
  return { ...state, activePaneId: paneId };
}

/**
 * Close one tab. Closing the last tab in a pane closes the PANE — an empty
 * pane is valid only at the root, where it is the drop zone.
 */
export function closeTab(
  state: CanvasState,
  paneId: string,
  instanceId: string,
): CanvasState {
  if (state.root === null) return state;
  const pane = findPaneById(state.root, paneId);
  if (pane === null || !pane.tabInstanceIds.includes(instanceId)) return state;

  if (pane.tabInstanceIds.length === 1) return closePane(state, paneId);

  const root = replacePane(state.root, paneId, (target) =>
    removeFromPane(target, instanceId),
  );
  const tilesByInstanceId = { ...state.tilesByInstanceId };
  delete tilesByInstanceId[instanceId];
  return { ...state, root, tilesByInstanceId };
}

/** Close a pane and everything in it. The last pane leaves an empty canvas. */
export function closePane(state: CanvasState, paneId: string): CanvasState {
  if (state.root === null) return state;
  const pane = findPaneById(state.root, paneId);
  if (pane === null) return state;

  const result = removePaneFromTree(
    { root: state.root, sizesByGroupId: state.sizesByGroupId },
    paneId,
  );
  if (result === null) return state;

  const tilesByInstanceId = { ...state.tilesByInstanceId };
  for (const instanceId of pane.tabInstanceIds) {
    delete tilesByInstanceId[instanceId];
  }

  // I2: the active pane may have been the one removed, or may have been
  // DISSOLVED as a single-child parent. Re-resolve against the new tree
  // rather than assuming the id survived.
  const activePaneId =
    result.root === null
      ? null
      : findPaneById(result.root, state.activePaneId ?? "") !== null
        ? state.activePaneId
        : firstPaneId(result.root);

  return {
    root: result.root,
    sizesByGroupId: result.sizesByGroupId,
    tilesByInstanceId,
    activePaneId,
  };
}

export interface SplitPaneArgs {
  readonly state: CanvasState;
  readonly paneId: string;
  readonly position: EdgeDropPosition;
  /** What to put in the new pane. Callers pass a blank tile for a bare split. */
  readonly tile: TileRef;
  readonly ids: IdSource;
}

/**
 * Split `paneId` and put `tile` in the new pane.
 *
 * Returns state UNCHANGED when the split would exceed `MAX_TREE_DEPTH` —
 * `insertPaneAtEdge` returns null and this propagates the refusal rather than
 * throwing. A depth limit that crashes is worse than one that declines.
 */
export function splitPane(args: SplitPaneArgs): CanvasState {
  const { state, paneId, position, tile, ids } = args;
  if (state.root === null) return state;
  if (findPaneById(state.root, paneId) === null) return state;

  const newPaneId = ids.paneId();
  const result = insertPaneAtEdge({
    state: { root: state.root, sizesByGroupId: state.sizesByGroupId },
    targetPaneId: paneId,
    newPane: makePane(newPaneId, tile.instanceId),
    position,
    createGroupId: ids.groupId,
  });
  if (result === null) return state;

  return {
    root: result.root,
    sizesByGroupId: result.sizesByGroupId,
    tilesByInstanceId: {
      ...state.tilesByInstanceId,
      [tile.instanceId]: tile,
    },
    activePaneId: newPaneId,
  };
}

/**
 * Would `splitPane` at this position do anything?
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IT ASKS THE TRANSITION RATHER THAN RESTATING THE RULE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A UI needs this to disable a split control, and the obvious implementation
 * is to measure the pane's depth and compare it to `MAX_TREE_DEPTH`. That
 * would be **wrong on its own terms**, not merely fragile: a same-direction
 * split MERGES into the parent group instead of deepening, so a pane at the
 * limit can still split one way and not the other. A depth comparison says
 * "no" to both.
 *
 * Even a correct reimplementation would be two rules that agree by
 * coincidence — the shape this codebase has already been bitten by, where a
 * runtime guard and its compile-time twin drifted apart. So this runs the real
 * transition against a throwaway tile and asks whether anything changed.
 * `splitPane` returns the input state BY IDENTITY when it declines, which is
 * what makes the check exact.
 *
 * The probe ids never escape: a declined split returns the original state, and
 * an accepted one is discarded here — the caller re-runs the real `splitPane`
 * with the real `IdSource`.
 */
export function canSplitPane(
  state: CanvasState,
  paneId: string,
  position: EdgeDropPosition,
): boolean {
  const probed = splitPane({
    state,
    paneId,
    position,
    tile: {
      type: "blank",
      id: "split-probe",
      instanceId: "split-probe",
      name: "",
      hostId: "",
    },
    ids: { paneId: () => "split-probe-pane", groupId: () => "split-probe-group" },
  });
  return probed !== state;
}

/**
 * Commit a resize. Sizes live OUTSIDE the tree on purpose: this returns a new
 * `sizesByGroupId` and the SAME `root` reference, so layout subscribers do not
 * re-render on a drag. Folding sizes into the tree makes every resize
 * re-render every tile — a defect that presents as "the canvas is sluggish"
 * long after anyone remembers why.
 */
export function resizeSplit(
  state: CanvasState,
  groupId: string,
  sizes: ReadonlyArray<number>,
): CanvasState {
  return {
    ...state,
    sizesByGroupId: {
      ...state.sizesByGroupId,
      [groupId]: normalizeSizes(sizes, sizes.length),
    },
  };
}

// ---------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------

/**
 * Re-establish I1–I3 over untrusted input. DROPS malformed entries, never
 * throws — the same contract as gui-app's persistence layer, for the same
 * reason: a stored layout is user data from an older build, and refusing to
 * load it strands the user with a canvas they cannot open or clear.
 */
export function reconcile(state: CanvasState): CanvasState {
  if (state.root === null) {
    const clean =
      Object.keys(state.tilesByInstanceId).length === 0 &&
      Object.keys(state.sizesByGroupId).length === 0 &&
      state.activePaneId === null;
    return clean ? state : EMPTY_CANVAS;
  }

  let root: TileLayoutNode = state.root;
  for (const pane of collectPanes(state.root)) {
    const tabInstanceIds = pane.tabInstanceIds.filter((instanceId) =>
      Object.hasOwn(state.tilesByInstanceId, instanceId),
    );
    const activationHistory = pruneActivationHistory(
      pane.activationHistory,
      tabInstanceIds,
    );
    const activeTabId =
      pane.activeTabId !== null && tabInstanceIds.includes(pane.activeTabId)
        ? pane.activeTabId
        : (activationHistory[0] ?? tabInstanceIds[0] ?? null);
    const previewTabId =
      pane.previewTabId !== null && tabInstanceIds.includes(pane.previewTabId)
        ? pane.previewTabId
        : null;
    root = replacePane(root, pane.id, (target) => ({
      ...target,
      tabInstanceIds,
      activeTabId,
      previewTabId,
      activationHistory,
    }));
  }

  // Panes emptied by the filter above are removed, which may dissolve their
  // parent group. Done AFTER the per-pane pass so a pane whose tabs all
  // vanished is detected rather than left as an invalid empty non-root pane.
  for (const pane of collectPanes(root)) {
    if (pane.tabInstanceIds.length > 0) continue;
    const removed = removePaneFromTree(
      { root, sizesByGroupId: state.sizesByGroupId },
      pane.id,
    );
    if (removed === null || removed.root === null) return EMPTY_CANVAS;
    root = removed.root;
  }

  const live = new Set(
    collectPanes(root).flatMap((pane) => [...pane.tabInstanceIds]),
  );
  const tilesByInstanceId: Record<string, TileRef> = {};
  for (const [instanceId, tile] of Object.entries(state.tilesByInstanceId)) {
    if (tile !== undefined && live.has(instanceId)) {
      tilesByInstanceId[instanceId] = tile;
    }
  }
  if (live.size === 0) return EMPTY_CANVAS;

  const activePaneId =
    state.activePaneId !== null && findPaneById(root, state.activePaneId)
      ? state.activePaneId
      : firstPaneId(root);

  return {
    root,
    activePaneId,
    tilesByInstanceId,
    sizesByGroupId: pruneSizes(root, state.sizesByGroupId),
  };
}
