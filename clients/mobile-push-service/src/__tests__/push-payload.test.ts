import { describe, expect, it } from "vitest";
import { formatHostNotificationPresentation } from "@traycer/protocol/host/notifications/presentation";
import { buildPushPayload } from "../push-payload";
import {
  ALL_ACTIONABLE_ENTRIES,
  APPROVAL_ENTRY,
  INTERVIEW_ENTRY,
  STALLED_ENTRY,
  WORKSPACE_FAILED_ENTRY,
} from "./fixtures";

describe("buildPushPayload — single transition", () => {
  it.each(ALL_ACTIONABLE_ENTRIES)(
    "matches formatHostNotificationPresentation byte-for-byte for kind=$kind",
    (entry) => {
      const expected = formatHostNotificationPresentation(entry);
      const payload = buildPushPayload([{ id: entry.id, entry }]);
      expect(payload.title).toBe(expected.title);
      expect(payload.body).toBe(expected.body);
    },
  );

  it("carries epicId/chatId as the deep-link target when the entry has both", () => {
    const payload = buildPushPayload([{ id: APPROVAL_ENTRY.id, entry: APPROVAL_ENTRY }]);
    expect(payload.data).toEqual({
      epicId: APPROVAL_ENTRY.epicId,
      chatId: APPROVAL_ENTRY.chatId,
    });
  });

  it("omits the deep-link target when the entry has no chatId", () => {
    const noChat = { ...WORKSPACE_FAILED_ENTRY, chatId: null };
    const payload = buildPushPayload([{ id: noChat.id, entry: noChat }]);
    expect(payload.data).toEqual({});
  });
});

describe("buildPushPayload — coalesced summary", () => {
  it("summarizes multiple transitions with no single deep-link target", () => {
    const payload = buildPushPayload([
      { id: APPROVAL_ENTRY.id, entry: APPROVAL_ENTRY },
      { id: INTERVIEW_ENTRY.id, entry: INTERVIEW_ENTRY },
      { id: STALLED_ENTRY.id, entry: STALLED_ENTRY },
    ]);
    expect(payload.title).toBe("3 chats need your attention");
    expect(payload.data).toEqual({});
    expect(payload.body.length).toBeGreaterThan(0);
  });
});
