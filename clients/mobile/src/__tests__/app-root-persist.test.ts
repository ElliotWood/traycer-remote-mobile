/**
 * P0 caching, layer A: `shouldDehydrateQuery` (app-root.tsx) decides which
 * queries survive into the localStorage-persisted cache. Only the fleet list
 * and comment threads are part of the empty-on-load bug — the three lazy,
 * on-expand unary queries (snapshot diff, resume output, agent plan) are
 * deliberately excluded so a warm cache doesn't balloon with content nobody
 * asked to see again.
 */
import { describe, expect, it } from "vitest";
import type { Query } from "@tanstack/react-query";
import { shouldDehydrateQuery } from "@/app-root";

function fakeQuery(queryKey: readonly unknown[], status: "success" | "pending" | "error" = "success"): Query {
  return { queryKey, state: { status } } as unknown as Query;
}

describe("shouldDehydrateQuery", () => {
  it("persists a successful fleet query", () => {
    expect(shouldDehydrateQuery?.(fakeQuery(["mobile", "epic.listTasks", "fleet"]))).toBe(true);
  });

  it("persists a successful comment-threads query", () => {
    expect(
      shouldDehydrateQuery?.(
        fakeQuery(["mobile", "epic.listCommentThreads", "e1", "ticket", "a1"]),
      ),
    ).toBe(true);
  });

  it("excludes the lazy on-expand queries — not part of the empty-on-load bug", () => {
    expect(shouldDehydrateQuery?.(fakeQuery(["mobile", "snapshots.readSnapshotDiff", "h1", "h2"]))).toBe(
      false,
    );
    expect(shouldDehydrateQuery?.(fakeQuery(["mobile", "workspace.readFile", "/w", "/f"]))).toBe(false);
    expect(
      shouldDehydrateQuery?.(fakeQuery(["mobile", "agent.gui.getPlan", "e1", "c1", "p1"])),
    ).toBe(false);
  });

  it("excludes a non-mobile-namespaced query key", () => {
    expect(shouldDehydrateQuery?.(fakeQuery(["epic.listTasks"]))).toBe(false);
  });

  it("excludes a query that hasn't succeeded yet — matches the default dehydrate rule", () => {
    expect(shouldDehydrateQuery?.(fakeQuery(["mobile", "epic.listTasks", "fleet"], "pending"))).toBe(
      false,
    );
    expect(shouldDehydrateQuery?.(fakeQuery(["mobile", "epic.listTasks", "fleet"], "error"))).toBe(false);
  });
});
