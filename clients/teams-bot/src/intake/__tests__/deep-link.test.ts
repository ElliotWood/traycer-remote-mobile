import { describe, expect, it } from "vitest";
import { chatDeepLink } from "../deep-link";

const config = { tabBaseUrl: "https://example.invalid/tab" };

describe("chatDeepLink", () => {
  /**
   * PINS THE SHAPE AGAINST `clients/teams-tab/src/router/route.ts`.
   *
   * That file builds `${BASE}/epics/${epicId}/chats/${chatId}` for the chat
   * route. The two are separately deployed and cannot share a constant, so
   * this test is the join. If it fails, the tab's route shape changed and
   * this link now lands on the SPA fallback — which renders the epics list,
   * so a user sees the WRONG PAGE rather than an error.
   */
  it("CONTRACT: matches the tab's chat route shape", () => {
    expect(chatDeepLink(config, "epic-1", "chat-1")).toBe(
      "https://example.invalid/tab/epics/epic-1/chats/chat-1",
    );
  });

  it("tolerates a trailing slash on the configured base", () => {
    expect(chatDeepLink({ tabBaseUrl: "https://example.invalid/tab/" }, "e", "c")).toBe(
      "https://example.invalid/tab/epics/e/chats/c",
    );
  });

  it("CONTRACT: returns null when no base URL is configured", () => {
    // The caller must then render a card with NO button. A dead "Watch
    // progress" button is worse than none — it is the one thing the reply
    // tells the user to act on.
    expect(chatDeepLink({ tabBaseUrl: "" }, "e", "c")).toBeNull();
    expect(chatDeepLink({ tabBaseUrl: "   " }, "e", "c")).toBeNull();
  });

  it("returns null rather than a malformed link when an id is missing", () => {
    expect(chatDeepLink(config, "", "c")).toBeNull();
    expect(chatDeepLink(config, "e", "")).toBeNull();
  });

  it("encodes ids so an odd one cannot break the path", () => {
    expect(chatDeepLink(config, "a/b", "c d")).toBe(
      "https://example.invalid/tab/epics/a%2Fb/chats/c%20d",
    );
  });
});
