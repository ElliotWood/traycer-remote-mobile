import { describe, expect, it } from "vitest";
import { DEFAULT_SORT_MODE, describeSortMode, nextSortMode, resortTree, type SortMode } from "../tree-sort";

interface Entry {
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

function tree(byId: Record<string, Entry>, roots: readonly string[]) {
  return { roots, childrenByParent: {}, byId };
}

describe("resortTree", () => {
  it("is a no-op (same reference) for the default updated-desc mode", () => {
    const t = tree({ a: { title: "A", createdAt: 1, updatedAt: 1 } }, ["a"]);
    expect(resortTree(t, DEFAULT_SORT_MODE)).toBe(t);
  });

  it("sorts by name ascending", () => {
    const t = tree(
      {
        b: { title: "Bravo", createdAt: 1, updatedAt: 1 },
        a: { title: "Alpha", createdAt: 2, updatedAt: 2 },
      },
      ["b", "a"],
    );
    const sorted = resortTree(t, { field: "name", direction: "asc" });
    expect(sorted.roots).toEqual(["a", "b"]);
  });

  it("sorts by created ascending, id tie-break", () => {
    const t = tree(
      {
        x: { title: "X", createdAt: 5, updatedAt: 5 },
        y: { title: "Y", createdAt: 5, updatedAt: 5 },
      },
      ["y", "x"],
    );
    const sorted = resortTree(t, { field: "created", direction: "asc" });
    expect(sorted.roots).toEqual(["x", "y"]);
  });

  it("preserves childrenByParent membership while re-sorting each level", () => {
    const t = {
      roots: ["root"],
      childrenByParent: { root: ["c-late", "c-early"] },
      byId: {
        root: { title: "Root", createdAt: 0, updatedAt: 0 },
        "c-early": { title: "Early", createdAt: 1, updatedAt: 1 },
        "c-late": { title: "Late", createdAt: 2, updatedAt: 2 },
      },
    };
    const sorted = resortTree(t, { field: "created", direction: "asc" });
    expect(sorted.childrenByParent.root).toEqual(["c-early", "c-late"]);
    expect(sorted.roots).toEqual(t.roots);
  });
});

describe("nextSortMode", () => {
  it("cycles through all 6 modes and back to the default", () => {
    let mode: SortMode = DEFAULT_SORT_MODE;
    const seen: SortMode[] = [mode];
    for (let i = 0; i < 6; i++) {
      mode = nextSortMode(mode);
      seen.push(mode);
    }
    expect(seen[6]).toEqual(DEFAULT_SORT_MODE);
    // All 6 intermediate modes are distinct.
    const unique = new Set(seen.slice(0, 6).map((m) => `${m.field}:${m.direction}`));
    expect(unique.size).toBe(6);
  });
});

describe("describeSortMode", () => {
  it("renders a short label with a direction arrow", () => {
    expect(describeSortMode({ field: "updated", direction: "desc" })).toBe("Updated ↓");
    expect(describeSortMode({ field: "name", direction: "asc" })).toBe("Name ↑");
  });
});
