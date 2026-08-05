/**
 * Pure-logic coverage for the Fleet's `epic.listTasks` data source (T4):
 *
 *   - the request body sent through the host client (mocked `request`) matches
 *     gui-app's proven `LIST_CLOUD_TASKS_REQUEST`, and threads the cursor;
 *   - `epicListNextCursor` gates pagination on `hasMore` + a real cursor;
 *   - `toFleetEpics` keeps epic rows, drops phases / null lights, and de-dupes;
 *   - `formatEpicMeta` renders non-zero counts + status.
 *
 * The `useInfiniteQuery` wiring itself is TanStack's; these are the seams this
 * ticket owns, exercised without a DOM.
 */
import { describe, expect, it, vi } from "vitest";
import type {
  ListTaskLight,
  ListTasksResponse,
} from "@traycer/protocol/host/epic/unary-schemas";
import {
  EPIC_LIST_REQUEST,
  buildEpicListRequest,
  epicListNextCursor,
  fetchEpicListPage,
  formatEpicMeta,
  toFleetEpics,
  type FleetEpic,
} from "../use-epic-list";

function epicRow(
  id: string,
  overrides: Partial<{
    title: string;
    ticketCount: number;
    specCount: number;
    storyCount: number;
    reviewCount: number;
    status: string;
    createdAt: number;
    updatedAt: number;
    pinned: boolean;
  }>,
): ListTaskLight {
  return {
    epic: {
      light: {
        id,
        title: overrides.title ?? `Epic ${id}`,
        initialUserPrompt: "",
        ticketCount: overrides.ticketCount ?? 0,
        specCount: overrides.specCount ?? 0,
        storyCount: overrides.storyCount ?? 0,
        reviewCount: overrides.reviewCount ?? 0,
        status: overrides.status ?? "in progress",
        createdAt: overrides.createdAt ?? 1,
        updatedAt: overrides.updatedAt ?? 1,
        createdBy: "u1",
        version: "2.0.0",
      },
      permission: null,
      repos: [],
      workspaces: [],
      roomInfo: null,
    },
    pinned: overrides.pinned,
  };
}

function response(
  tasks: ListTaskLight[],
  extra: Partial<ListTasksResponse>,
): ListTasksResponse {
  return { tasks, hasMore: false, ...extra };
}

describe("EPIC_LIST_REQUEST / buildEpicListRequest / fetchEpicListPage", () => {
  it("mirrors gui-app's cloud-tasks request shape", () => {
    expect(EPIC_LIST_REQUEST).toEqual({
      limit: 20,
      filters: null,
      sort: "recent",
      extensionPhaseVersion: "1.0.0",
      extensionEpicVersion: "2.0.0",
    });
  });

  it("omits cursor on the first page and includes it on later pages", () => {
    expect(buildEpicListRequest(undefined, {})).not.toHaveProperty("cursor");
    expect(buildEpicListRequest("c1", {})).toMatchObject({ cursor: "c1" });
  });

  it("invokes epic.listTasks on the host client with the built request", async () => {
    const request = vi.fn().mockResolvedValue(response([], {}));
    await fetchEpicListPage({ request }, undefined, {});
    expect(request).toHaveBeenCalledWith("epic.listTasks", {
      limit: 20,
      filters: null,
      sort: "recent",
      extensionPhaseVersion: "1.0.0",
      extensionEpicVersion: "2.0.0",
    });

    await fetchEpicListPage({ request }, "next-cursor", {});
    expect(request).toHaveBeenLastCalledWith("epic.listTasks", {
      limit: 20,
      filters: null,
      sort: "recent",
      extensionPhaseVersion: "1.0.0",
      extensionEpicVersion: "2.0.0",
      cursor: "next-cursor",
    });
  });
});

describe("epicListNextCursor", () => {
  it("returns the cursor only when hasMore and a non-empty cursor are present", () => {
    expect(
      epicListNextCursor(response([], { hasMore: true, nextCursor: "c2" })),
    ).toBe("c2");
    expect(epicListNextCursor(response([], { hasMore: false, nextCursor: "c2" }))).toBeUndefined();
    expect(epicListNextCursor(response([], { hasMore: true }))).toBeUndefined();
    expect(
      epicListNextCursor(response([], { hasMore: true, nextCursor: "" })),
    ).toBeUndefined();
  });
});

describe("toFleetEpics", () => {
  it("keeps epic rows, drops phase / null-light rows, and de-dupes by id", () => {
    const tasks: ListTaskLight[] = [
      epicRow("a", { title: "Alpha" }),
      { phase: { light: null, permission: null, repos: [], workspaces: [], roomInfo: null } },
      { epic: null },
      epicRow("a", { title: "Alpha duplicate (later page)" }),
      epicRow("b", { title: "Beta" }),
    ];
    const epics = toFleetEpics(tasks);
    expect(epics.map((e) => e.id)).toEqual(["a", "b"]);
    expect(epics[0]?.title).toBe("Alpha");
  });

  it("projects updatedAt and pinned, defaulting pinned to false when the wire omits it", () => {
    const epics = toFleetEpics([epicRow("a", { updatedAt: 42, pinned: true }), epicRow("b", { updatedAt: 7 })]);
    expect(epics.find((e) => e.id === "a")).toMatchObject({ updatedAt: 42, pinned: true });
    expect(epics.find((e) => e.id === "b")).toMatchObject({ updatedAt: 7, pinned: false });
  });

  it("sorts pinned rows first, stable within each group", () => {
    const tasks = [
      epicRow("a", { title: "A" }),
      epicRow("b", { title: "B", pinned: true }),
      epicRow("c", { title: "C" }),
      epicRow("d", { title: "D", pinned: true }),
    ];
    expect(toFleetEpics(tasks).map((e) => e.id)).toEqual(["b", "d", "a", "c"]);
  });
});

describe("formatEpicMeta", () => {
  const base: FleetEpic = {
    id: "x",
    title: "X",
    ticketCount: 0,
    specCount: 0,
    storyCount: 0,
    reviewCount: 0,
    status: "",
    createdAt: 0,
    updatedAt: 0,
    pinned: false,
  };

  it("joins non-zero counts and status, pluralizing correctly", () => {
    expect(
      formatEpicMeta({
        ...base,
        ticketCount: 6,
        specCount: 1,
        storyCount: 2,
        status: "in progress",
      }),
    ).toBe("6 tickets · 1 spec · 2 stories · in progress");
  });

  it("omits zero counts and an empty status", () => {
    expect(formatEpicMeta({ ...base, ticketCount: 1 })).toBe("1 ticket");
    expect(formatEpicMeta(base)).toBe("");
  });
});
