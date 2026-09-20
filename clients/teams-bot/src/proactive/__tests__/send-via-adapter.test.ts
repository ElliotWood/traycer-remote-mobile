/**
 * The one mapping in the proactive path that can lose a field with no error.
 *
 * `StoredConversationReference.bot` → `ConversationReference.agent`. Every
 * member of the SDK's interface is optional, so the natural spread compiles,
 * runs, and drops the field. This asserts it did not.
 */
import { describe, expect, it } from "vitest";
import { finishedLead, toConversationReference } from "../send-via-adapter";
import { runFinishedSchema } from "../watch-line";
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

describe("what a finished run says", () => {
  const finished = runFinishedSchema.parse({
    type: "finished",
    eventId: "run.finished:chat-1",
    epicId: "epic-1",
    chatId: "chat-1",
    chatTitle: "Wipro retail",
  });

  it("names the chat and carries the link, because this IS the lock-screen preview", () => {
    /*
     * `wpro-retail-run`: "the deliverable ended up somewhere the requester
     * does not look". A completion that does not say WHERE is the same
     * failure one step later.
     */
    expect(finishedLead(finished, "https://tab.example/#/x")).toEqual({
      lead: "",
      trail: " — Wipro retail has finished. Read the result: https://tab.example/#/x",
    });
  });

  it("still speaks when no tab URL is configured", () => {
    /*
     * The current deployment. `chatDeepLink` returns null rather than a link
     * that goes nowhere, and a completion withheld for a missing link is the
     * original defect preserved by a cosmetic one.
     *
     * Mutation: return early on `link === null`. This fails.
     */
    expect(finishedLead(finished, null)).toEqual({
      lead: "",
      trail: " — Wipro retail has finished. Open it to read the result.",
    });
  });

  it("does not render a null chat title as the word null", () => {
    const untitled = runFinishedSchema.parse({
      type: "finished",
      eventId: "run.finished:chat-2",
      epicId: "epic-1",
      chatId: "chat-2",
      chatTitle: null,
    });
    expect(finishedLead(untitled, null).trail).toBe(
      " — your assessment has finished. Open it to read the result.",
    );
  });
});
