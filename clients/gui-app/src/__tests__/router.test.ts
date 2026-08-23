import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppRouter, isSubpathDeploy } from "@/router";

describe("createAppRouter", () => {
  it("boots from the desktop initial route without relying on the URL hash", () => {
    const router = createAppRouter("/epics/epic-a", null);

    expect(router.state.location.pathname).toBe("/epics/epic-a");
  });
});

// The route tree is root-relative, so a build served from `/next/` matches
// nothing and every URL renders "Not Found" - measured on a real bundle, not
// inferred: `main`'s web build served a signed-out user a literal
// `<p>Not Found</p>` while the `/next/` stack's build served the sign-in page.
// The fix has lived on that stack for weeks and never came to the trunk.
describe("subpath deploys", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    window.location.hash = "";
  });

  // The predicate. `/` is the CONTROL and the important row: every desktop
  // renderer and the dev server run at `/`, so a `true` here would change
  // behaviour for every surface that is currently working.
  it.each([
    ["/", false],
    ["", false],
    ["/next/", true],
    ["/next", true],
    ["/tab/", true],
  ])("treats BASE_URL %j as subpath=%s", (base, expected) => {
    vi.stubEnv("BASE_URL", base);

    expect(isSubpathDeploy()).toBe(expected);
  });

  // The load-bearing one. A correct predicate that nothing reads is this
  // epic's most-repeated shape - `onOpenArtifact={() => {}}`, the host-picker
  // slot with no door. So this asserts on where the router actually READS its
  // route from, which is the only thing that decides Not Found vs the app.
  //
  // Under hash history the fragment IS the route; under the browser default it
  // is ignored and the document path wins. Setting the fragment to something
  // the document path can never be makes the two readings distinguishable.
  it("reads the route from the fragment when served from a subpath", () => {
    vi.stubEnv("BASE_URL", "/next/");
    window.location.hash = "#/epics";

    const router = createAppRouter(null, null);

    expect(router.state.location.pathname).toBe("/epics");
  });

  it("ignores the fragment when served from the root", () => {
    vi.stubEnv("BASE_URL", "/");
    window.location.hash = "#/epics";

    const router = createAppRouter(null, null);

    // Not `/epics`: at the root the browser default history is left in place,
    // which is what keeps the desktop renderer and the dev server unchanged.
    expect(router.state.location.pathname).not.toBe("/epics");
    expect(router.state.location.pathname).toBe(window.location.pathname);
  });
});
