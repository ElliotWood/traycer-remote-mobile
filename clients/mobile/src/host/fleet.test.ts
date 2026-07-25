import type { ListTasksResponse } from "@traycer/protocol/host/epic/unary-schemas";
import { expect, test } from "vitest";
import { toFleetItems } from "@/host/fleet";

function epicRow(
  id: string,
  title: string,
  status: string,
): ListTasksResponse["tasks"][number] {
  return {
    epic: {
      light: {
        id,
        title,
        initialUserPrompt: "",
        ticketCount: 0,
        specCount: 0,
        storyCount: 0,
        reviewCount: 0,
        status,
        createdAt: 0,
        updatedAt: 0,
        createdBy: "user-1",
        version: "2.0.0",
      },
      permission: null,
      repos: [],
      workspaces: [],
      roomInfo: null,
    },
    phase: null,
  };
}

test("toFleetItems maps epic rows to fleet items", () => {
  const response: ListTasksResponse = {
    tasks: [epicRow("e1", "Alpha", "running"), epicRow("e2", "Beta", "blocked")],
    hasMore: false,
  };
  expect(toFleetItems(response)).toEqual([
    { id: "e1", title: "Alpha", status: "running", kind: "epic" },
    { id: "e2", title: "Beta", status: "blocked", kind: "epic" },
  ]);
});

test("toFleetItems skips rows with no epic or phase light", () => {
  const response: ListTasksResponse = {
    tasks: [{ epic: null, phase: null }],
    hasMore: false,
  };
  expect(toFleetItems(response)).toEqual([]);
});
