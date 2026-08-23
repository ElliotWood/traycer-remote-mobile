import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { teamsThemeToResolved } from "./teams-host";
import {
  readTeamsThemeParam,
  resolveTeamsThemeParam,
  TEAMS_THEME_PARAM,
} from "./teams-theme-param";

describe("readTeamsThemeParam", () => {
  it("reads each theme name Teams actually substitutes", () => {
    // The closed list, asserted member by member rather than as a set, so a
    // dropped entry names itself instead of failing a length check.
    expect(readTeamsThemeParam("?theme=default")).toBe("default");
    expect(readTeamsThemeParam("?theme=dark")).toBe("dark");
    expect(readTeamsThemeParam("?theme=contrast")).toBe("contrast");
    expect(readTeamsThemeParam("?theme=glass")).toBe("glass");
  });

  it("reads the parameter when it is not the first one", () => {
    // A real tab URL carries whatever else the manifest and the client add.
    expect(readTeamsThemeParam("?foo=1&theme=dark&bar=2")).toBe("dark");
  });

  it("works with or without the leading question mark", () => {
    // `window.location.search` includes it; a hand-built string may not.
    expect(readTeamsThemeParam("theme=dark")).toBe("dark");
  });

  it("returns null when there is no theme parameter at all", () => {
    // The PWA case, and the overwhelmingly common one.
    expect(readTeamsThemeParam("")).toBeNull();
    expect(readTeamsThemeParam("?other=dark")).toBeNull();
  });

  it("returns null for the UNSUBSTITUTED placeholder, which is the whole point", () => {
    // THE defect this file's closed list exists to prevent. A Teams client
    // that does not perform the substitution delivers the literal `{theme}`.
    // Treating that as "a theme we do not recognise" and resolving it to light
    // would force a light tab on a dark-Teams user - re-entering the exact bug
    // this feature fixes, through the fix.
    expect(readTeamsThemeParam("?theme=%7Btheme%7D")).toBeNull();
    expect(readTeamsThemeParam("?theme={theme}")).toBeNull();
    // The v2 placeholder name too: mobile Teams supports only the v1 names, so
    // a manifest written with `{app.theme}` reaches us unsubstituted there.
    expect(readTeamsThemeParam("?theme={app.theme}")).toBeNull();
  });

  it("returns null for an empty value", () => {
    // `?theme=` is what an empty substitution produces, and it is not a theme.
    expect(readTeamsThemeParam("?theme=")).toBeNull();
  });

  it("is case-sensitive, matching the SDK channel's own spelling", () => {
    // Deliberately narrow, and asserted so a future reader does not "fix" it
    // into a fuzzy match. `teamsThemeToResolved` is case-sensitive for the same
    // reason; the two channels must not disagree.
    expect(readTeamsThemeParam("?theme=Dark")).toBeNull();
  });

  it("returns null for an unrecognised name rather than guessing", () => {
    expect(readTeamsThemeParam("?theme=some-future-theme")).toBeNull();
  });

  it("exports the parameter name it reads", () => {
    // So the manifest half and this half cannot drift to different spellings.
    expect(TEAMS_THEME_PARAM).toBe("theme");
    expect(readTeamsThemeParam(`?${TEAMS_THEME_PARAM}=dark`)).toBe("dark");
  });
});

describe("resolveTeamsThemeParam", () => {
  it("resolves the two dark surfaces to dark", () => {
    expect(resolveTeamsThemeParam("?theme=dark")).toBe("dark");
    expect(resolveTeamsThemeParam("?theme=contrast")).toBe("dark");
  });

  it("resolves the two light surfaces to light", () => {
    expect(resolveTeamsThemeParam("?theme=default")).toBe("light");
    expect(resolveTeamsThemeParam("?theme=glass")).toBe("light");
  });

  it("yields null - NOT light - when there is no usable signal", () => {
    // The distinction the whole design rests on. `null` leaves the host
    // override unset, so the app keeps its existing behaviour (OS preference
    // now, SDK theme when the handshake lands). A `light` here would actively
    // overrule the OS and the handshake both.
    expect(resolveTeamsThemeParam("")).toBeNull();
    expect(resolveTeamsThemeParam("?theme={theme}")).toBeNull();
    expect(resolveTeamsThemeParam("?theme=some-future-theme")).toBeNull();
  });

  it("agrees with the SDK channel on every name they both accept", () => {
    // Not a restatement of the rows above: it asserts the two CHANNELS cannot
    // diverge, by comparing against the SDK decoder itself rather than against
    // a second hand-written copy of the mapping. A tab that painted dark from
    // the URL and flipped light when the handshake landed would read as a
    // rendering fault, not a stale theme.
    for (const name of ["default", "dark", "contrast", "glass"]) {
      expect(resolveTeamsThemeParam(`?theme=${name}`)).toBe(
        teamsThemeToResolved(name),
      );
    }
  });
});

describe("the entry point applies the URL theme before it paints", () => {
  /**
   * A SOURCE contract, in this package's existing idiom (see the sibling block
   * in `teams-host.test.ts`), because the property that matters here is an
   * ORDERING inside `main.tsx`, and `main.tsx` runs `createRoot` at import.
   * There is nothing to drive behaviourally without booting the whole app.
   *
   * Ordering is the entire feature. A version that applies the URL theme
   * AFTER `createRoot(...).render(...)` passes every unit test in this file,
   * sets the right colour, and still ships the flash it was built to remove -
   * which is indistinguishable, to a reader of the test names, from a fix.
   */
  const mainSource = readFileSync(
    join(process.cwd(), "src", "web", "main.tsx"),
    "utf8",
  );

  it("read the entry point it is asserting about", () => {
    // A wrong path throws above; this closes the "found but empty" case, so no
    // row below can pass by matching nothing.
    expect(mainSource.length).toBeGreaterThan(1000);
    expect(mainSource).toContain("createRoot");
  });

  it("resolves the theme from the URL and feeds it to the applier seam", () => {
    expect(mainSource).toMatch(
      /setHostThemeOverride\(\s*urlTheme\s*\)/,
    );
    expect(mainSource).toMatch(
      /resolveTeamsThemeParam\(\s*window\.location\.search\s*\)/,
    );
  });

  it("imports the resolver from the module that owns it", () => {
    expect(mainSource).toMatch(
      /import\s*\{[^}]*\bresolveTeamsThemeParam\b[^}]*\}\s*from\s*"\.\/teams-theme-param"/,
    );
  });

  it("applies it BEFORE createRoot, which is the whole feature", () => {
    const applied = mainSource.indexOf("resolveTeamsThemeParam(");
    const painted = mainSource.indexOf("createRoot(");
    expect(applied).toBeGreaterThan(-1);
    expect(painted).toBeGreaterThan(-1);
    expect(applied).toBeLessThan(painted);
  });

  it("still hands the SDK handshake to the same seam, for later changes", () => {
    // The URL covers first paint only. Teams pushes theme changes while the tab
    // is open, and that channel must survive this addition rather than be
    // replaced by it - a tab that ignored a live theme switch would be a new
    // defect of the same family.
    expect(mainSource).toMatch(/initializeTeamsHost\(\{[\s\S]*?onTheme:/);
  });
});
