import { describe, expect, it } from "vitest";
import type { BackgroundItem } from "@traycer/protocol/host/agent/gui/subscribe";
import { backgroundItemDisplayTitle } from "../background-items-panel";

describe("backgroundItemDisplayTitle", () => {
  it("plain title for subagent/command/monitor", () => {
    const item = { kind: "subagent", taskId: "t1", title: "Fix the bug", blockId: "b1", parentTaskId: null, scheduledFor: null } as BackgroundItem;
    expect(backgroundItemDisplayTitle(item)).toBe("Fix the bug");
  });

  it("wakeup: 'Waiting until HH:MM · title'", () => {
    const scheduledFor = new Date(2026, 0, 1, 14, 5).getTime();
    const item = { kind: "wakeup", taskId: "t1", title: "Check on deploy", blockId: "b1", parentTaskId: null, scheduledFor } as BackgroundItem;
    expect(backgroundItemDisplayTitle(item)).toBe("Waiting until 14:05 · Check on deploy");
  });

  it("workflow: title alone when no progress fields are set", () => {
    const item = {
      kind: "workflow",
      taskId: "t1",
      title: "Refactor auth",
      blockId: "b1",
      parentTaskId: null,
      phase: null,
      activeLabel: null,
      agentsStarted: null,
      agentsFinished: null,
    } as BackgroundItem;
    expect(backgroundItemDisplayTitle(item)).toBe("Refactor auth");
  });

  it("workflow: joins phase/activeLabel/progress with the desktop separators", () => {
    const item = {
      kind: "workflow",
      taskId: "t1",
      title: "Refactor auth",
      blockId: "b1",
      parentTaskId: null,
      phase: "Review",
      activeLabel: "checking types",
      agentsStarted: 3,
      agentsFinished: 1,
    } as BackgroundItem;
    expect(backgroundItemDisplayTitle(item)).toBe("Refactor auth — Review · checking types · 1/3 done");
  });

  it("mcp: 'serverName · toolName' (overrides the generic title)", () => {
    const item = {
      kind: "mcp",
      taskId: "t1",
      title: "ignored",
      blockId: "b1",
      parentTaskId: null,
      serverName: "github",
      toolName: "search_issues",
      startedAt: null,
    } as BackgroundItem;
    expect(backgroundItemDisplayTitle(item)).toBe("github · search_issues");
  });
});
