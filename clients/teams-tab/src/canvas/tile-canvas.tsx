/**
 * The canvas: a split tree of panes, each a tab strip over one body.
 *
 * Controlled, not stateful. `state` and `onChange` come from the caller, so
 * the same component serves the live app, a test, and a screenshot fixture
 * without a store in the middle. Every transition is a pure function from
 * `canvas-state.ts`; this file only decides which one a gesture means.
 *
 * ─── The body is injected ───
 *
 * `renderTile` is a prop. The canvas has no idea what a chat looks like, and
 * keeping it that way is what let the layout engine lift verbatim from the
 * desktop client. It is also what makes the four deferred tile kinds additive
 * rather than a rewrite.
 *
 * ─── Only the active tab of each pane is mounted ───
 *
 * Background tabs are NOT rendered. Mounting them would mean N live epic
 * subscriptions for N open tabs — the tab already had a bug where two
 * subscriptions ran for one screen, and this is the shape that scales it.
 * The cost is that a background tab loses transient view state (scroll
 * position); that is a known trade and the reason gui-app has a scroll-anchor
 * store, which is a later problem and not this one.
 */
import { useCallback, type ReactNode } from "react";
import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { SplitContainer, type SplitPaneComponentProps } from "./split-container";
import { TabStrip } from "./tab-strip";
import {
  closeTab,
  promotePreview,
  resizeSplit,
  setActivePane,
  setActiveTab,
  type CanvasState,
} from "./canvas-state";
import type { TilePane } from "./tile-tree";
import type { TileRef } from "./tile-ref";

const useStyles = makeStyles({
  canvas: {
    height: "100%",
    width: "100%",
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground2,
  },
  pane: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    width: "100%",
    minHeight: 0,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  focusedPane: { outline: `1px solid ${tokens.colorBrandStroke2}` },
  body: {
    flexGrow: 1,
    // The containment pair again: without `minHeight: 0` the body grows to
    // its content and the pane stops clipping, which puts the tab strip off
    // screen on a long transcript.
    minHeight: 0,
    overflowY: "auto",
  },
  empty: {
    display: "flex",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    color: tokens.colorNeutralForeground3,
    fontFamily: tokens.fontFamilyBase,
    fontSize: tokens.fontSizeBase200,
  },
});

export interface TileCanvasProps {
  readonly state: CanvasState;
  readonly onChange: (next: CanvasState) => void;
  /** Draws one tile's body. The canvas never inspects the ref itself. */
  readonly renderTile: (tile: TileRef) => ReactNode;
  /** Shown when the canvas holds nothing. */
  readonly emptyLabel?: string;
}

export function TileCanvas(props: TileCanvasProps) {
  const { state, onChange, renderTile } = props;
  const styles = useStyles();

  const onResizeGroup = useCallback(
    (groupId: string, sizes: ReadonlyArray<number>) => {
      onChange(resizeSplit(state, groupId, sizes));
    },
    [onChange, state],
  );

  /*
   * `PaneComponent` is defined inline and passed to a MEMOIZED SplitContainer
   * subtree, so it must be stable or the memo never bails out. `useCallback`
   * on the component itself is the wrong tool (it would still be a new
   * component identity per render of the closure's deps); instead the pane
   * reads everything it needs from props threaded through a single object
   * that changes only when the state does.
   */
  const PaneComponent = useCallback(
    function Pane(paneProps: SplitPaneComponentProps) {
      return (
        <PaneView
          pane={paneProps.pane}
          state={state}
          onChange={onChange}
          renderTile={renderTile}
        />
      );
    },
    [state, onChange, renderTile],
  );

  if (state.root === null) {
    return (
      <div className={styles.canvas} data-testid="tile-canvas">
        <div className={styles.empty} data-testid="canvas-empty">
          {props.emptyLabel ?? "Nothing open"}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.canvas} data-testid="tile-canvas">
      <SplitContainer
        root={state.root}
        sizesByGroupId={state.sizesByGroupId}
        PaneComponent={PaneComponent}
        onResizeGroup={onResizeGroup}
      />
    </div>
  );
}

interface PaneViewProps {
  readonly pane: TilePane;
  readonly state: CanvasState;
  readonly onChange: (next: CanvasState) => void;
  readonly renderTile: (tile: TileRef) => ReactNode;
}

function PaneView(props: PaneViewProps) {
  const { pane, state, onChange, renderTile } = props;
  const styles = useStyles();
  const focused = state.activePaneId === pane.id;

  const activeTile =
    pane.activeTabId === null
      ? null
      : (state.tilesByInstanceId[pane.activeTabId] ?? null);

  return (
    <div
      className={mergeClasses(styles.pane, focused && styles.focusedPane)}
      data-testid="canvas-pane"
      data-pane-id={pane.id}
      data-focused={focused ? "true" : undefined}
      // Capture phase, so focusing a pane happens BEFORE the click that
      // caused it is handled. A bubbling handler would set the active pane
      // after `setActiveTab` had already run against the old one, and the
      // accent would trail the user's click by one interaction.
      onPointerDownCapture={() => {
        onChange(setActivePane(state, pane.id));
      }}
    >
      <TabStrip
        pane={pane}
        tiles={state.tilesByInstanceId}
        paneFocused={focused}
        onActivate={(instanceId) => {
          onChange(setActiveTab(state, pane.id, instanceId));
        }}
        onPromote={() => {
          onChange(promotePreview(state, pane.id));
        }}
        onClose={(instanceId) => {
          onChange(closeTab(state, pane.id, instanceId));
        }}
      />
      <div className={styles.body} data-testid="canvas-pane-body">
        {activeTile === null ? null : renderTile(activeTile)}
      </div>
    </div>
  );
}
