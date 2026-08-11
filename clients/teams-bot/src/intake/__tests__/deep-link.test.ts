import { describe, expect, it } from "vitest";
import { chatDeepLink } from "../deep-link";
import WIRE from "./__fixtures__/watch-progress-links.json" with { type: "json" };

describe("chatDeepLink", () => {
  /**
   * THE PRODUCER HALF of the link contract. The consumer half is
   * `clients/gui-app/src/lib/__tests__/teams-card-link-contract.test.ts`,
   * which parses these same bytes with the app's own route parsers.
   *
   * Asserting the WHOLE string rather than its parts on purpose: every part of
   * this link is load-bearing and a field-by-field check only covers the
   * fields someone thought of. The previous version of this test asserted a
   * whole string too — and passed for weeks over a link that could not work,
   * because nothing on the other side of the seam ever read it.
   */
  it.each([
    ["subpath deploy — hash history", WIRE.subpath],
    ["root deploy — browser history", WIRE.root],
  ])("CONTRACT: emits the golden link for a %s", (_label, arm) => {
    expect(
      chatDeepLink({ tabBaseUrl: arm.tabBaseUrl }, arm.epicId, arm.chatId),
    ).toBe(arm.link);
  });

  /**
   * The two defects this builder shipped with, pinned separately so a
   * regression names which one came back.
   */
  it("REGRESSION: never emits the retired tab's three-segment chat route", () => {
    const link = chatDeepLink(
      { tabBaseUrl: "https://example.invalid/next/" },
      "epic-1",
      "chat-1",
    );
    expect(link).not.toContain("/chats/");
    expect(link).not.toBe(WIRE.retiredTabShape.link);
  });

  it("REGRESSION: puts the route in the fragment for a subpath base", () => {
    // gui-app switches to hash history for any vite base but `/`. A path-shaped
    // link addresses no route there at all, whatever segments it carries.
    const link = chatDeepLink(
      { tabBaseUrl: "https://example.invalid/next/" },
      "e",
      "c",
    );
    expect(link).toContain("/#/epics/");
  });

  it("keeps a root-served tab on a plain path — no fragment", () => {
    const link = chatDeepLink({ tabBaseUrl: "https://example.invalid" }, "e", "c");
    expect(link).not.toContain("#");
  });

  it("tolerates a trailing slash on the configured base", () => {
    expect(
      chatDeepLink({ tabBaseUrl: "https://example.invalid/next///" }, "e", "c"),
    ).toBe(chatDeepLink({ tabBaseUrl: "https://example.invalid/next" }, "e", "c"));
  });

  it("CONTRACT: returns null when no base URL is configured", () => {
    // The caller must then render a card with NO button. A dead "Watch
    // progress" button is worse than none — it is the one thing the reply
    // tells the user to act on.
    expect(chatDeepLink({ tabBaseUrl: "" }, "e", "c")).toBeNull();
    expect(chatDeepLink({ tabBaseUrl: "   " }, "e", "c")).toBeNull();
  });

  it("returns null rather than a malformed link when an id is missing", () => {
    const config = { tabBaseUrl: "https://example.invalid/next" };
    expect(chatDeepLink(config, "", "c")).toBeNull();
    expect(chatDeepLink(config, "e", "")).toBeNull();
  });

  it("returns null for a base it cannot classify as root or subpath", () => {
    // The classification decides the history mode, which decides whether the
    // link works at all. A guess here is a 50% chance of a dead button.
    expect(chatDeepLink({ tabBaseUrl: "not-a-url" }, "e", "c")).toBeNull();
    expect(chatDeepLink({ tabBaseUrl: "/next/" }, "e", "c")).toBeNull();
    expect(
      chatDeepLink({ tabBaseUrl: "javascript:alert(1)" }, "e", "c"),
    ).toBeNull();
  });

  it("encodes ids so an odd one cannot break the route", () => {
    // gui-app matches each route segment as `[^/]+` and does NOT decode it, so
    // an id containing a slash must arrive percent-encoded or it splits the
    // route into three segments and stops matching. Real ids are uuids, which
    // makes this a guard rather than a live case.
    expect(
      chatDeepLink({ tabBaseUrl: "https://example.invalid/next" }, "a/b", "c d"),
    ).toBe(
      "https://example.invalid/next/#/epics/a%2Fb/a%2Fb?focusArtifactId=c%20d",
    );
  });
});
