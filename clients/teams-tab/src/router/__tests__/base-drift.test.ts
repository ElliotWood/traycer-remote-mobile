import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BASE, routeToPath } from "../route";

/**
 * `BASE` is the same fact in THREE places, and the other two are not
 * TypeScript, so nothing else can notice when they drift:
 *
 *   route.ts            the paths the app emits and parses
 *   vite.config.ts      the prefix baked into every asset URL
 *   deploy/vm-serve-tab.sh   the nginx location that serves them
 *
 * A mismatch is invisible in dev — where the base is effectively `/` and
 * every path still resolves — and fatal in production, where either the
 * bundle 404s or every route parses as unknown and falls back to the list.
 * So a deep link lands on the wrong screen rather than failing loudly.
 *
 * This is the only test in the suite that reads files instead of calling
 * functions, and it is deliberate: unit tests written in terms of `BASE`
 * agree with any value of `BASE`. Changing the constant alone breaks nothing
 * they assert — verified with `tools/mutation-probe.mjs`, where that mutation
 * was the single survivor until this file existed.
 */
const TAB = resolve(import.meta.dirname, "..", "..", "..");
const read = (rel: string): string => readFileSync(resolve(TAB, rel), "utf8");

/** `/tab` → `/tab/`. Vite wants the trailing slash; the router does not. */
const withSlash = `${BASE}/`;

describe("BASE agrees with the build", () => {
  it("CONTRACT: vite.config.ts pins the same base", () => {
    const match = /base:\s*"([^"]+)"/.exec(read("vite.config.ts"));
    expect(match?.[1]).toBe(withSlash);
  });

  it("CONTRACT: the base is committed, not typed on the command line", () => {
    // It lived only in a hand-typed `--base=/tab/` until this was found: the
    // package's own `build` script defaulted to `/`, producing a bundle whose
    // asset URLs nginx could not serve from `/tab/`.
    expect(read("vite.config.ts")).toContain("base:");
  });
});

describe("BASE agrees with the deployment", () => {
  it("CONTRACT: nginx serves the app at exactly this prefix", () => {
    expect(read("deploy/vm-serve-tab.sh")).toContain(`location ${withSlash}`);
  });

  it("CONTRACT: the SPA fallback points at this prefix's index", () => {
    // `try_files … /tab/index.html` is what makes a deep link like
    // `/tab/epics/<id>` reach the app instead of 404ing. Pointing it at the
    // wrong prefix breaks every route except the entry point — which still
    // works, so it looks fine until someone follows a link.
    expect(read("deploy/vm-serve-tab.sh")).toContain(`${withSlash}index.html`);
  });
});

describe("BASE is well-formed", () => {
  it("is absolute and carries no trailing slash of its own", () => {
    // `routeToPath` concatenates, so a trailing slash here would emit
    // `/tab//epics` — which parses, and which no other system matches.
    expect(BASE.startsWith("/")).toBe(true);
    expect(BASE.endsWith("/")).toBe(false);
    expect(routeToPath({ name: "epics" })).toBe(`${BASE}/epics`);
  });
});
