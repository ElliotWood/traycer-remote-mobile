/**
 * The one mapping in the proactive path that can lose a field with no error.
 *
 * `StoredConversationReference.bot` → `ConversationReference.agent`. Every
 * member of the SDK's interface is optional, so the natural spread compiles,
 * runs, and drops the field. This asserts it did not.
 */
import { describe, expect, it } from "vitest";
import { toConversationReference } from "../send-via-adapter";
import type { StoredConversationReference } from "../../state/conversation-reference-store";

const STORED: StoredConversationReference = {
  channelId: "msteams",
  serviceUrl: "https://smba.example/au/",
  conversation: { id: "conv-1", conversationType: "personal" },
  bot: { id: "agent-1", name: "Traycer" },
  user: { id: "user-1", aadObjectId: "aad-1" },
  tenantId: "tenant-1",
  capturedAt: 1,
};

describe("the bot -> agent rename", () => {
  it("populates `agent`, which a spread of our stored shape would not", () => {
    /*
     * THE test this file exists for.
     *
     * Mutation: replace the explicit mapping in `toConversationReference`
     * with `{ ...stored }`. This assertion fails with `agent: undefined` —
     * and nothing else in the suite, or in `tsc`, notices, because the SDK
     * field is optional. That is the whole hazard.
     */
    const reference = toConversationReference(STORED);
    expect(reference.agent).toEqual({ id: "agent-1", name: "Traycer" });
  });

  it("carries the routing fields the send needs", () => {
    const reference = toConversationReference(STORED);
    expect(reference.channelId).toBe("msteams");
    expect(reference.serviceUrl).toBe("https://smba.example/au/");
    expect(reference.conversation.id).toBe("conv-1");
  });

  it("does not copy aadObjectId into the outbound reference", () => {
    /*
     * The store's header forbids reading `user.aadObjectId` back out as an
     * identity source. Routing needs `user.id` and nothing more, so the
     * narrower projection is also the one that cannot launder an identity
     * into a downstream consumer.
     */
    const reference = toConversationReference(STORED);
    expect(reference.user).toEqual({ id: "user-1" });
  });
});
