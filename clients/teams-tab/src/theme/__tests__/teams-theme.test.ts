import { describe, expect, it } from "vitest";
import {
  teamsDarkTheme,
  teamsHighContrastTheme,
  teamsLightTheme,
} from "@fluentui/react-components";
import { normaliseThemeName, themeFor, type TeamsThemeName } from "../teams-theme";

const ALL: readonly TeamsThemeName[] = ["default", "dark", "contrast"];

describe("teams-theme — the mapping", () => {
  it("maps each name to Fluent's own Teams theme", () => {
    expect(themeFor("default")).toBe(teamsLightTheme);
    expect(themeFor("dark")).toBe(teamsDarkTheme);
    expect(themeFor("contrast")).toBe(teamsHighContrastTheme);
  });

  it("CONTRACT: high contrast is NOT the dark theme", () => {
    // It is a distinct accessibility mode, not "dark with more contrast".
    // A tab that maps it onto dark is inaccessible to the people who turned
    // it on, and `teamsHighContrastTheme` exists — using it is free.
    expect(themeFor("contrast")).not.toBe(themeFor("dark"));
  });

  it("the three names resolve to three different themes", () => {
    expect(new Set(ALL.map((n) => themeFor(n))).size).toBe(3);
  });

  it("returns a real theme for every name", () => {
    for (const name of ALL) {
      expect(themeFor(name)).toBeDefined();
    }
  });
});

describe("teams-theme — normalising what the host reports", () => {
  it("passes the three documented values through", () => {
    for (const name of ALL) {
      expect(normaliseThemeName(name)).toBe(name);
    }
  });

  it("CONTRACT: an unknown value falls back to light rather than throwing", () => {
    // Teams has historically sent values beyond the documented three. A tab
    // that fails to start because it did not recognise a theme name would
    // be a poor trade, and outside Teams there is no reported theme at all.
    for (const raw of [undefined, "", "midnight", "Dark", "DEFAULT", "light"]) {
      expect(normaliseThemeName(raw)).toBe("default");
    }
  });

  it("CONTRACT: an unrecognised value never resolves to contrast", () => {
    // The dangerous direction: silently putting a user into high contrast
    // (or out of it) on a value nobody recognised.
    expect(normaliseThemeName("high-contrast")).not.toBe("contrast");
  });

  it("composes with themeFor for any input, including junk", () => {
    for (const raw of [undefined, "dark", "contrast", "nonsense"]) {
      expect(() => themeFor(normaliseThemeName(raw))).not.toThrow();
    }
  });
});
