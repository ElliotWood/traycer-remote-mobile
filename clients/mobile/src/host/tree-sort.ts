/**
 * P1 — the Epic tree's shared sort control (updated/created/name x asc/desc,
 * default updated-desc). Mirrors desktop's `epic-sort.ts` `SORT_FIELD`/
 * `SORT_DIRECTION`/`DEFAULT_SORT_MODE`, generalized over both
 * `ChatTree`/`ArtifactTree` (same node shape: id/title/createdAt/updatedAt)
 * since one control drives both sections.
 *
 * Re-sorts `roots`/`childrenByParent` in place of the tree's own built-in
 * comparator (`buildChatTree`/`buildArtifactTree`'s default is exactly
 * `DEFAULT_SORT_MODE`, so the no-op fast path below keeps today's order
 * byte-identical when nothing has changed the sort).
 */
export type SortField = "updated" | "created" | "name";
export type SortDirection = "asc" | "desc";

export interface SortMode {
  readonly field: SortField;
  readonly direction: SortDirection;
}

export const DEFAULT_SORT_MODE: SortMode = { field: "updated", direction: "desc" };

interface SortableEntry {
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface SortableTree<T> {
  readonly roots: readonly string[];
  readonly childrenByParent: Readonly<Record<string, readonly string[]>>;
  readonly byId: Readonly<Record<string, T>>;
}

function compareEntries(
  mode: SortMode,
  aId: string,
  a: SortableEntry,
  bId: string,
  b: SortableEntry,
): number {
  let cmp: number;
  switch (mode.field) {
    case "updated":
      cmp = a.updatedAt - b.updatedAt;
      break;
    case "created":
      cmp = a.createdAt - b.createdAt;
      break;
    case "name":
      cmp = a.title.localeCompare(b.title);
      break;
  }
  if (cmp === 0) {
    cmp = aId < bId ? -1 : aId > bId ? 1 : 0;
  }
  return mode.direction === "asc" ? cmp : -cmp;
}

/** Re-sorts every level of `tree` by `mode`, WITHOUT changing parent/child membership. */
export function resortTree<T extends SortableEntry>(
  tree: SortableTree<T>,
  mode: SortMode,
): SortableTree<T> {
  if (mode.field === DEFAULT_SORT_MODE.field && mode.direction === DEFAULT_SORT_MODE.direction) {
    return tree;
  }
  const sortIds = (ids: readonly string[]): readonly string[] =>
    [...ids].sort((aId, bId) => {
      const a = tree.byId[aId];
      const b = tree.byId[bId];
      if (a === undefined || b === undefined) return 0;
      return compareEntries(mode, aId, a, bId, b);
    });

  const childrenByParent: Record<string, readonly string[]> = {};
  for (const [parentId, ids] of Object.entries(tree.childrenByParent)) {
    childrenByParent[parentId] = sortIds(ids);
  }
  return { roots: sortIds(tree.roots), childrenByParent, byId: tree.byId };
}

const CYCLE: readonly SortMode[] = [
  { field: "updated", direction: "desc" },
  { field: "updated", direction: "asc" },
  { field: "created", direction: "desc" },
  { field: "created", direction: "asc" },
  { field: "name", direction: "asc" },
  { field: "name", direction: "desc" },
];

export function nextSortMode(current: SortMode): SortMode {
  const index = CYCLE.findIndex((m) => m.field === current.field && m.direction === current.direction);
  return CYCLE[(index + 1) % CYCLE.length] ?? DEFAULT_SORT_MODE;
}

const FIELD_LABEL: Readonly<Record<SortField, string>> = {
  updated: "Updated",
  created: "Created",
  name: "Name",
};

export function describeSortMode(mode: SortMode): string {
  return `${FIELD_LABEL[mode.field]} ${mode.direction === "desc" ? "↓" : "↑"}`;
}
