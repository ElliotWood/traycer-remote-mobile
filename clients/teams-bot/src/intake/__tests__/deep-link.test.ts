import { describe, expect, it } from "vitest";
import { APP_TAB_ENTITY_ID, chatDeepLink } from "../deep-link";
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
    const link = chatDeepLink(
      { tabBaseUrl: "https://example.invalid" },
      "e",
      "c",
    );
    expect(link).not.toContain("#");
  });

  it("tolerates a trailing slash on the configured base", () => {
    expect(
      chatDeepLink({ tabBaseUrl: "https://example.invalid/next///" }, "e", "c"),
    ).toBe(
      chatDeepLink({ tabBaseUrl: "https://example.invalid/next" }, "e", "c"),
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

  /**
   * THE TEAMS-NATIVE FORM. Everything above only makes the URL resolve; these
   * rows are about whether pressing it keeps the user inside Teams.
   */
  describe("with a Teams app id configured", () => {
    const arm = WIRE.teamsEntity;

    /**
     * THE PRODUCED LINK, not the fixture's copy of it.
     *
     * The first draft of the three rows below parsed `arm.link` — they read as
     * checks on the builder and were assertions about the fixture agreeing
     * with itself. `tools/mutate-entity-link.mjs` MUT-6 found it: renaming
     * `subEntityId` in the builder reddened only the whole-string row, while
     * the row literally named "carries the route as `subEntityId`" stayed
     * green. The fixture is still the seam with gui-app; it is joined to the
     * builder by the whole-string row alone, which is enough because that row
     * asserts every byte.
     */
    function produced(): URL {
      const link = chatDeepLink(
        { tabBaseUrl: arm.tabBaseUrl, teamsAppId: arm.teamsAppId },
        arm.epicId,
        arm.chatId,
      );
      // Not `??` onto a placeholder: a null here means the builder refused,
      // and parsing a stand-in would report the refusal as a wrong URL.
      if (link === null) throw new Error("builder returned null");
      return new URL(link);
    }

    it("CONTRACT: emits the golden entity link", () => {
      // Whole string again, and for a sharper reason here than above: the
      // parameter names, their ORDER and the JSON envelope are all copied from
      // @microsoft/teams-js's own `createTeamsAppLink`. A field-by-field check
      // would not notice the day one of them stops matching the SDK.
      expect(
        chatDeepLink(
          { tabBaseUrl: arm.tabBaseUrl, teamsAppId: arm.teamsAppId },
          arm.epicId,
          arm.chatId,
        ),
      ).toBe(arm.link);
    });

    it("carries the web link as the `webUrl` fallback, unchanged", () => {
      // The old behaviour is not lost, it is demoted: a client that cannot open
      // the tab (Outlook, a browser with no Teams) still gets somewhere real.
      expect(produced().searchParams.get("webUrl")).toBe(WIRE.subpath.link);
    });

    it("carries the route as `subEntityId`, the tab's only inbound channel", () => {
      const context = JSON.parse(
        produced().searchParams.get("context") ?? "{}",
      ) as { subEntityId?: string };
      expect(context.subEntityId).toBe(arm.subEntityId);
      // And it is the SAME route the web link puts in its fragment. One route
      // shape in the builder; the tab applies it verbatim.
      expect(
        `${WIRE.subpath.tabBaseUrl.replace(/\/+$/, "")}/#${context.subEntityId ?? ""}`,
      ).toBe(WIRE.subpath.link);
    });

    it("addresses the manifest's own static tab", () => {
      expect(produced().pathname.endsWith(`/${APP_TAB_ENTITY_ID}`)).toBe(true);
    });

    /**
     * CONTROL. A placeholder that survived deployment must fail CLOSED, back to
     * the web link — which merely leaves Teams — rather than build a link to
     * app `00000000-…`, which opens nothing and reports nothing.
     */
    it("CONTROL: falls back to the web link for the manifest's nil app id", () => {
      const nil = WIRE.unsubstitutedAppId;
      expect(
        chatDeepLink(
          { tabBaseUrl: nil.tabBaseUrl, teamsAppId: nil.teamsAppId },
          nil.epicId,
          nil.chatId,
        ),
      ).toBe(nil.link);
    });

    it("falls back to the web link for an app id that is not a uuid", () => {
      for (const bad of ["", "   ", "REPLACE_WITH_APP_ID", "not-a-uuid"]) {
        expect(
          chatDeepLink(
            { tabBaseUrl: arm.tabBaseUrl, teamsAppId: bad },
            arm.epicId,
            arm.chatId,
          ),
        ).toBe(WIRE.subpath.link);
      }
    });

    it("still returns null when the base URL is missing", () => {
      // The app id does not rescue an unconfigured tab: there would be no
      // `webUrl` and no origin to open.
      expect(
        chatDeepLink(
          { tabBaseUrl: "", teamsAppId: arm.teamsAppId },
          arm.epicId,
          arm.chatId,
        ),
      ).toBeNull();
    });
  });

  it("encodes ids so an odd one cannot break the route", () => {
    // gui-app matches each route segment as `[^/]+` and does NOT decode it, so
    // an id containing a slash must arrive percent-encoded or it splits the
    // route into three segments and stops matching. Real ids are uuids, which
    // makes this a guard rather than a live case.
    expect(
      chatDeepLink(
        { tabBaseUrl: "https://example.invalid/next" },
        "a/b",
        "c d",
      ),
    ).toBe(
      "https://example.invalid/next/#/epics/a%2Fb/a%2Fb?focusArtifactId=c%20d",
    );
  });
});
