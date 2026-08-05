/**
 * Renders the N-ary split tree. Knows nothing about tile kinds.
 *
 * Panes render through the injected `PaneComponent`, so this layer is
 * testable on its own and cannot acquire an opinion about chats. Groups are
 * nested flex containers; each child wrapper gets `flexGrow: fraction`.
 *
 * ─── The three identity rules that stop remounts ───
 *
 * Every child is keyed by its NODE id, stable across reorder and resize —
 * keyed by index, a split would remount the surviving pane and a chat would
 * lose its scroll position for no visible reason.
 *
 * Groups never store sizes, so a resize commit changes only
 * `sizesByGroupId` and `root` keeps identity all the way down.
 *
 * `SplitNode` is memoized, so a structural change re-renders only the path
 * from the root to the touched node. That is what makes the previous two
 * rules pay: without the memo, identity-stable props still re-render.
 *
 * ─── `data-split-child` is load-bearing, not a test hook ───
 *
 * `resize-handle.tsx` finds the pair it moves via `previousElementSibling` /
 * `nextElementSibling` and verifies each with this attribute. Removing it, or
 * inserting any element between a handle and its neighbours, silently stops
 * every drag — `isSplitChild` returns false and pointer-down declines.
 */
import { Fragment, memo, type ComponentType } from "react";
import { makeStyles, mergeClasses } from "@fluentui/react-components";
import {
  sizesForGroup,
  type SizesByGroupId,
  type TileLayoutNode,
  type TilePane,
} from "./tile-tree";
import { ResizeHandle } from "./resize-handle";

const useStyles = makeStyles({
  group: {
    display: "flex",
    height: "100%",
    width: "100%",
    // The containment pair. Without `minHeight/minWidth: 0` a flex child
    // refuses to shrink below its content, so a long transcript pushes the
    // group past its container and the whole canvas scrolls instead of the
    // pane. Same defect the app shell was built around.
    minHeight: 0,
    minWidth: 0,
  },
  row: { flexDirection: "row" },
  column: { flexDirection: "column" },
  child: {
    position: "relative",
    minHeight: 0,
    minWidth: 0,
    flexBasis: 0,
    flexShrink: 1,
    overflow: "hidden",
  },
});

export interface SplitPaneComponentProps {
  readonly pane: TilePane;
}

export interface SplitContainerProps {
  readonly root: TileLayoutNode | null;
  readonly sizesByGroupId: SizesByGroupId;
  readonly PaneComponent: ComponentType<SplitPaneComponentProps>;
  readonly onResizeGroup: (
    groupId: string,
    sizes: ReadonlyArray<number>,
  ) => void;
}

export function SplitContainer(props: SplitContainerProps) {
  if (props.root === null) return null;
  return (
    <SplitNode
      node={props.root}
      sizesByGroupId={props.sizesByGroupId}
      PaneComponent={props.PaneComponent}
      onResizeGroup={props.onResizeGroup}
    />
  );
}

interface SplitNodeProps {
  readonly node: TileLayoutNode;
  readonly sizesByGroupId: SizesByGroupId;
  readonly PaneComponent: ComponentType<SplitPaneComponentProps>;
  readonly onResizeGroup: (
    groupId: string,
    sizes: ReadonlyArray<number>,
  ) => void;
}

const SplitNode = memo(function SplitNode(props: SplitNodeProps) {
  const { node, sizesByGroupId, PaneComponent, onResizeGroup } = props;
  const styles = useStyles();

  if (node.kind === "pane") {
    return <PaneComponent pane={node} />;
  }

  const sizes = sizesForGroup(sizesByGroupId, node);
  const horizontal = node.direction === "horizontal";

  return (
    <div
      data-testid="tile-split"
      data-split-id={node.id}
      data-axis={node.direction}
      className={mergeClasses(
        styles.group,
        horizontal ? styles.row : styles.column,
      )}
    >
      {node.children.map((child, index) => (
        <Fragment key={child.id}>
          {index > 0 ? (
            <ResizeHandle
              groupId={node.id}
              index={index - 1}
              direction={node.direction}
              sizes={sizes}
              onCommitSizes={onResizeGroup}
            />
          ) : null}
          <div
            data-split-child=""
            className={styles.child}
            style={{ flexGrow: sizes[index] }}
          >
            <SplitNode
              node={child}
              sizesByGroupId={sizesByGroupId}
              PaneComponent={PaneComponent}
              onResizeGroup={onResizeGroup}
            />
          </div>
        </Fragment>
      ))}
    </div>
  );
});
