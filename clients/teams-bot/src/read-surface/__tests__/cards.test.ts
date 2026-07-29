import { describe, expect, it } from "vitest";
import type { Attachment } from "@microsoft/agents-activity";
import {
  buildBridgeUnavailableCard,
  buildChatCard,
  buildEpicNotBoundCard,
  buildEpicPickerCard,
  buildFleetCard,
  buildPrincipalRefusedCard,
} from "../cards";
import type { ChatStatus } from "../bridge-types";

function cardBody(attachment: Attachment): string {
  return JSON.stringify(attachment.content);
}

describe("read-surface/cards", () => {
  it("CONTRACT: a disconnected ChatStatus never renders the live-status view, even with populated fields", () => {
    const disconnectedButPopulated: ChatStatus = {
      chatId: "chat-1",
      title: "Looks busy",
      runStatus: "running",
      pendingApprovals: [
        {
          approvalId: "ap-1",
          toolName: "edit_file",
          description: "do the thing",
          requestedAt: 0,
        },
      ],
      pendingInterviews: [{ blockId: "b-1", requestedAt: 0 }],
      connected: false,
    };

    const body = cardBody(buildChatCard(disconnectedButPopulated));

    expect(body).toContain("Host unreachable");
    // The stale approval/interview text must NOT leak into the disconnected card —
    // that would be exactly the silent-stale-data failure this contract exists to prevent.
    expect(body).not.toContain("edit_file");
    expect(body).not.toContain("do the thing");
  });

  it("a connected ChatStatus renders its pending approvals and interviews", () => {
    const connected: ChatStatus = {
      chatId: "chat-1",
      title: "Real chat",
      runStatus: "running",
      pendingApprovals: [
        {
          approvalId: "ap-1",
          toolName: "edit_file",
          description: "do the thing",
          requestedAt: 0,
        },
      ],
      pendingInterviews: [],
      connected: true,
    };

    const body = cardBody(buildChatCard(connected));

    expect(body).toContain("edit_file");
    expect(body).toContain("do the thing");
    expect(body).not.toContain("Host unreachable");
  });

  it("fleet card renders each agent's title and status", () => {
    const body = cardBody(
      buildFleetCard([
        {
          agentId: "a-1",
          title: "My Agent",
          harnessId: "claude",
          surface: "gui",
          active: true,
        },
      ]),
    );
    expect(body).toContain("My Agent");
    expect(body).toContain("active");
  });

  it("fleet card handles an empty fleet without throwing or rendering nothing", () => {
    const body = cardBody(buildFleetCard([]));
    expect(body).toContain("No agents");
  });

  it("epic picker lists epics without any Action.Execute — plain text only, matching the read-only scope", () => {
    const body = cardBody(
      buildEpicPickerCard([{ epicId: "e-1", title: "My Epic" }]),
    );
    expect(body).toContain("My Epic");
    expect(body).not.toContain("Action.Execute");
  });

  it("every honest-failure card renders distinguishable, non-empty content", () => {
    expect(cardBody(buildEpicNotBoundCard())).toContain("No epic selected");
    expect(cardBody(buildPrincipalRefusedCard("unmapped_principal"))).toContain(
      "unmapped_principal",
    );
    expect(
      cardBody(buildBridgeUnavailableCard("spawn_timed_out", "took too long")),
    ).toContain("took too long");
  });
});
