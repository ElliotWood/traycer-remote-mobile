/**
 * The static tabs are, like the command list beside them, a surface Teams
 * renders WITHOUT EVER CALLING US — so nothing in the running bot can notice
 * when one goes wrong. `manifest-commands.test.ts` binds the command list to
 * the real parser for that reason; this does the same job for the tab URLs.
 *
 * The specific failure it exists to prevent is silent in every direction. A
 * tab whose `contentUrl` lost its `?theme={theme}` still loads, still renders,
 * still works — it just paints in the wrong colour first and corrects itself
 * once the teams-js handshake lands, which reads as a rendering quirk rather
 * than a missing feature. There is no error, no warning and no failing request
 * anywhere in that path. It went unnoticed on the app tab precisely because it
 * looks like nothing.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface StaticTab {
  readonly entityId: string;
  readonly name: string;
  readonly contentUrl: string;
  readonly websiteUrl: string;
  readonly scopes: readonly string[];
}

const manifest = JSON.parse(
  readFileSync(
    new URL("../../../appPackage/manifest.json", import.meta.url),
    "utf8",
  ),
) as { staticTabs: readonly StaticTab[] };

const tabs = manifest.staticTabs;

/**
 * The TeamsJS **v1** placeholder spelling. Mobile Teams substitutes only the v1
 * names, so `{app.theme}` would silently fail there — and "silently" is the
 * whole problem: the tab would load with an unsubstituted literal in its URL
 * and simply keep its default colours.
 */
const THEME_PLACEHOLDER = "?theme={theme}";

describe("appPackage/manifest static tabs", () => {
  it("declares the two tabs at all", () => {
    // Guards every row below: an empty array would make the `for` loops pass
    // by iterating nothing, which is how a suite reports green about a file it
    // never read.
    expect(tabs.length).toBe(2);
    expect(tabs.map((t) => t.entityId)).toEqual([
      "traycer.app",
      "traycer.help",
    ]);
  });

  it("gives EVERY tab its theme on the first paint, app tab included", () => {
    // The app tab is the one this was missing, and it is the one that needs it
    // most: its Teams shell races `app.initialize()` against a 4s timeout and
    // fires it AFTER the first render, deliberately, so the handshake cannot
    // colour the first paint even when it succeeds.
    for (const tab of tabs) {
      expect(
        tab.contentUrl,
        `${tab.entityId} contentUrl must carry ${THEME_PLACEHOLDER}`,
      ).toContain(THEME_PLACEHOLDER);
    }
  });

  it("uses the v1 placeholder spelling, which is the only one mobile honours", () => {
    // `{app.theme}` is valid TeamsJS v2 and silently unsubstituted on mobile.
    for (const tab of tabs) {
      expect(tab.contentUrl).not.toContain("{app.theme}");
    }
  });

  it("leaves websiteUrl plain, because there is no Teams to ask there", () => {
    // The "open in a browser" target. A `{theme}` there would be delivered to
    // an ordinary browser as a literal, and the page's own allow-list would
    // then correctly ignore it — so this is about not shipping a URL that
    // reads as configured when it is inert.
    for (const tab of tabs) {
      expect(tab.websiteUrl).not.toContain("{theme}");
    }
  });

  it("keeps every tab URL substitutable by make-package", () => {
    // `make-package.mjs` replaces REPLACE_WITH_TAB_HOST in both fields of every
    // tab and then fails loudly on any leftover. A hardcoded host would sail
    // past that check and ship a package pointing at someone else's VM.
    for (const tab of tabs) {
      expect(tab.contentUrl).toContain("https://REPLACE_WITH_TAB_HOST/");
      expect(tab.websiteUrl).toContain("https://REPLACE_WITH_TAB_HOST/");
    }
  });

  it("puts the query before any fragment, so gui-app's hash router still sees it", () => {
    // `/next/` is a subpath deploy and gui-app switches to hash history there.
    // `?theme=…#/route` is read by `window.location.search`; `#/route?theme=…`
    // is not, and would be a valid-looking URL that delivers nothing.
    for (const tab of tabs) {
      const hash = tab.contentUrl.indexOf("#");
      if (hash === -1) continue;
      expect(tab.contentUrl.indexOf("?")).toBeLessThan(hash);
    }
  });

  it("points the app tab at /next/ and the help tab at /help/", () => {
    // Pinned because the app tab pointed at the retired `/tab/` surface for
    // days after that package was deleted from the trunk.
    const byId = new Map(tabs.map((t) => [t.entityId, t]));
    expect(byId.get("traycer.app")?.contentUrl).toContain("/next/");
    expect(byId.get("traycer.help")?.contentUrl).toContain("/help/");
  });
});
