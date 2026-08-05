/**
 * The two constructors `tile-tree.test.ts` needs, lifted from gui-app's
 * `stores/epics/canvas/__tests__/canvas-test-fixtures.ts`.
 *
 * That file is 223 lines because it also builds whole `EpicCanvasState`
 * objects for the store tests — narrowing helpers, tile-ref builders, an
 * `EpicCanvasTileRef` union this package deliberately does not have. Only
 * `pane` and `group` are tree-level, and only those are copied.
 *
 * `pane()` mirrors the original exactly, INCLUDING the two fields that are
 * easy to drop as noise: `previewTabId` starts null and `activationHistory`
 * starts with the first tab. A fixture that omitted them would still satisfy
 * the type (both are required, but `null`/`[]` type-check) while making every
 * preview and focus-ordering assertion vacuously true — the polite-fixture
 * shape this project has now hit seven times.
 */
import type {
  SplitDirection,
  TileGroup,
  TileLayoutNode,
  TilePane,
} from "@/canvas/tile-tree";

export function pane(
  id: string,
  tabInstanceIds: ReadonlyArray<string>,
): TilePane {
  return {
    kind: "pane",
    id,
    tabInstanceIds,
    activeTabId: tabInstanceIds[0] ?? null,
    previewTabId: null,
    activationHistory: tabInstanceIds.length === 0 ? [] : [tabInstanceIds[0]],
  };
}

export function group(
  id: string,
  direction: SplitDirection,
  children: ReadonlyArray<TileLayoutNode>,
): TileGroup {
  return { kind: "group", id, direction, children };
}
