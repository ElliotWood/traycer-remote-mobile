/**
 * The seam between two panes: drag to resize, arrows to nudge, double-click
 * to equalize.
 *
 * ─── Zero React renders during a drag ───
 *
 * The handle mutates `style.flexGrow` on its two adjacent sibling wrappers
 * per pointer frame and commits ONCE on release. That is not an optimisation
 * flourish — it is the render half of the same decision that keeps sizes out
 * of the tree. Committing per frame re-renders every tile in the canvas on
 * every mouse move, which presents as "the canvas is sluggish" and is
 * untraceable months later.
 *
 * The siblings are resolved from the DOM at pointer-down rather than held as
 * refs, because the handle's position in the group is the thing that defines
 * which pair it moves — `previousElementSibling` IS the relationship, and a
 * ref would be a second copy of it that can disagree.
 *
 * ─── Pointer capture, not a window listener ───
 *
 * `setPointerCapture` keeps the drag alive when the pointer leaves the
 * handle, and `lostpointercapture` ends it. The window-listener version of
 * this leaks a listener whenever a component unmounts mid-drag — which is
 * exactly what happens when a resize causes a pane to close.
 *
 * ─── Keyboard is not an afterthought ───
 *
 * The canvas ships without drag-and-drop on purpose (a pointer model Teams
 * mobile does not share), so keyboard resize is not an accessibility
 * courtesy here — for some users it is the only resize. Arrows commit
 * immediately; there is no drag phase to defer.
 */
import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { MIN_SPLIT_SIZE, MIN_PANE_PX } from "./tile-tree-constants";
import { evenSizes, type SplitDirection } from "./tile-tree";
import { computeResizeHandleSizes, resizeHandleSizesEqual } from "./resize-sizes";
import { SPLIT_HANDLE_PX } from "./split-affordance";

const KEYBOARD_STEP_RATIO = 0.05;

/**
 * Hit area, in px. Wider than the visible line, which is 1px of divider.
 *
 * Imported rather than declared, because `split-affordance.ts` subtracts this
 * same thickness before halving a pane. Two copies of the number would agree
 * today and drift the first time either is tuned — and the failure would be
 * a split allowed at exactly the width where it produces an under-minimum
 * pane, which no test asserting round numbers would notice.
 */
const GRAB_PX = SPLIT_HANDLE_PX;

const useStyles = makeStyles({
  handle: {
    position: "relative",
    zIndex: 1,
    flexShrink: 0,
    backgroundColor: tokens.colorNeutralStroke2,
    backgroundClip: "content-box",
    ":hover": { backgroundColor: tokens.colorBrandStroke1 },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "-2px",
    },
  },
  horizontal: {
    width: `${GRAB_PX}px`,
    cursor: "col-resize",
    paddingTop: 0,
    paddingBottom: 0,
    paddingLeft: `${(GRAB_PX - 1) / 2}px`,
    paddingRight: `${(GRAB_PX - 1) / 2}px`,
  },
  vertical: {
    height: `${GRAB_PX}px`,
    cursor: "row-resize",
    paddingLeft: 0,
    paddingRight: 0,
    paddingTop: `${(GRAB_PX - 1) / 2}px`,
    paddingBottom: `${(GRAB_PX - 1) / 2}px`,
  },
});

export interface ResizeHandleProps {
  readonly groupId: string;
  /** Index of the child BEFORE this handle. */
  readonly index: number;
  readonly direction: SplitDirection;
  /** The group's committed fractions, one per child. */
  readonly sizes: ReadonlyArray<number>;
  readonly onCommitSizes: (
    groupId: string,
    sizes: ReadonlyArray<number>,
  ) => void;
}

interface DragState {
  readonly containerSize: number;
  readonly minSize: number;
  readonly startCoord: number;
  readonly previousChild: HTMLElement;
  readonly nextChild: HTMLElement;
  latestSizes: ReadonlyArray<number>;
}

function isSplitChild(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLElement && element.dataset.splitChild !== undefined
  );
}

export function ResizeHandle(props: ResizeHandleProps) {
  const { groupId, index, direction, sizes, onCommitSizes } = props;
  const styles = useStyles();
  const horizontal = direction === "horizontal";
  const dragRef = useRef<DragState | null>(null);

  const restore = useCallback(
    (drag: DragState) => {
      drag.previousChild.style.flexGrow = String(sizes[index]);
      drag.nextChild.style.flexGrow = String(sizes[index + 1]);
    },
    [sizes, index],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      // Primary button only. A right-click opening a context menu mid-drag
      // leaves the pair mutated with no pointerup to restore it.
      if (event.button !== 0) return;
      const handle = event.currentTarget;
      const container = handle.parentElement;
      const previousChild = handle.previousElementSibling;
      const nextChild = handle.nextElementSibling;
      if (
        container === null ||
        !isSplitChild(previousChild) ||
        !isSplitChild(nextChild)
      ) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const containerSize = horizontal ? rect.width : rect.height;
      if (containerSize <= 0) return;

      dragRef.current = {
        containerSize,
        // The px floor FOLLOWS the live container: a pane never shrinks below
        // MIN_PANE_PX while the container can afford it, and never below the
        // fraction floor regardless. In a container too narrow to honour the
        // px floor, `Math.max` leaves the fraction floor in charge rather
        // than locking the drag entirely.
        minSize: Math.max(MIN_SPLIT_SIZE, MIN_PANE_PX / containerSize),
        startCoord: horizontal ? event.clientX : event.clientY,
        previousChild,
        nextChild,
        latestSizes: sizes,
      };
      handle.setPointerCapture(event.pointerId);
    },
    [horizontal, sizes],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (drag === null) return;
      const coord = horizontal ? event.clientX : event.clientY;
      const nextSizes = computeResizeHandleSizes({
        sizes,
        index,
        deltaRatio: (coord - drag.startCoord) / drag.containerSize,
        minSize: drag.minSize,
      });
      drag.latestSizes = nextSizes;
      drag.previousChild.style.flexGrow = String(nextSizes[index]);
      drag.nextChild.style.flexGrow = String(nextSizes[index + 1]);
    },
    [horizontal, sizes, index],
  );

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag === null) return;
    if (resizeHandleSizesEqual(drag.latestSizes, sizes)) {
      // Nothing moved. The pair was still mutated (a 0px drag writes the same
      // numbers back as strings), so restore rather than commit a no-op that
      // would re-render the canvas for nothing.
      restore(drag);
      return;
    }
    onCommitSizes(groupId, drag.latestSizes);
  }, [groupId, onCommitSizes, restore, sizes]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const decrease = horizontal ? "ArrowLeft" : "ArrowUp";
      const increase = horizontal ? "ArrowRight" : "ArrowDown";
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onCommitSizes(groupId, evenSizes(sizes.length));
        return;
      }
      if (event.key !== decrease && event.key !== increase) return;
      event.preventDefault();
      onCommitSizes(
        groupId,
        computeResizeHandleSizes({
          sizes,
          index,
          deltaRatio: (event.key === increase ? 1 : -1) * KEYBOARD_STEP_RATIO,
          // The fraction floor only: a keyboard nudge has no live container
          // measurement, and guessing one would make the floor wrong in a way
          // the user cannot see.
          minSize: MIN_SPLIT_SIZE,
        }),
      );
    },
    [groupId, horizontal, index, onCommitSizes, sizes],
  );

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      aria-label="Resize panes"
      aria-valuenow={Math.round((sizes[index] ?? 0) * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      data-testid="resize-handle"
      data-resize-group-id={groupId}
      data-handle-index={index}
      className={mergeClasses(
        styles.handle,
        horizontal ? styles.horizontal : styles.vertical,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onLostPointerCapture={endDrag}
      onDoubleClick={() => {
        onCommitSizes(groupId, evenSizes(sizes.length));
      }}
      onKeyDown={onKeyDown}
    />
  );
}
