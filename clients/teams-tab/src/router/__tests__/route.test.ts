import { describe, expect, it } from "vitest";
import { BASE, parseRoute, routeToPath, type Route } from "../route";

/**
 * Every route the tab can be at, as data, so the round-trip and the
 * prefix rule are asserted over the whole union rather than a sample.
 * A fifth route added without a case here fails the exhaustiveness test.
 */
const ALL_ROUTES: readonly Route[] = [
  { name: "epics" },
  { name: "epic", epicId: "a1000000-0000-4000-8000-000000000e91" },
  {
    name: "chat",
    epicId: "a1000000-0000-4000-8000-000000000e91",
    chatId: "a1000000-0000-4000-8000-000000000c4a",
  },
  { name: "waiting" },
  { name: "notifications" },
  { name: "canvas", epicId: "a1000000-0000-4000-8000-000000000e91" },
];

describe("route — round-trip", () => {
  it("CONTRACT: parse(toPath(r)) === r for every route", () => {
    // The manifest points `contentUrl` at a path and Teams deep links
    // address a tab by URL, so a route that cannot survive being written
    // out and read back is a deep link that lands somewhere else.
    for (const route of ALL_ROUTES) {
      expect(parseRoute(routeToPath(route))).toEqual(route);
    }
  });

  it("covers every member of the Route union", () => {
    expect(new Set(ALL_ROUTES.map((r) => r.name))).toEqual(
      new Set(["epics", "epic", "chat", "waiting", "notifications", "canvas"]),
    );
  });

  /**
   * The canvas and the epic detail address the SAME epic and must not collapse
   * onto one path — the canvas sits beside the drill-in rather than replacing
   * it, so both have to be reachable at once. This is the `waiting` /
   * `notifications` rule one drilldown down, and it is the failure that shipped
   * once already: two manifest entries collapsing onto one screen.
   */
  it("keeps the canvas and the epic detail on distinct paths", () => {
    const epicId = "a1000000-0000-4000-8000-000000000e91";
    expect(routeToPath({ name: "canvas", epicId })).not.toBe(
      routeToPath({ name: "epic", epicId }),
    );
  });

  /**
   * `waiting` and `notifications` are DIFFERENT screens on the same feed —
   * the attention slice versus the app-level bell — so they must not collapse
   * onto one path. Two manifest entries collapsing onto one screen is exactly
   * what happened while there was no router.
   */
  it("keeps the two notification surfaces on distinct paths", () => {
    expect(routeToPath({ name: "waiting" })).not.toBe(
      routeToPath({ name: "notifications" }),
    );
  });
});

describe("route — the BASE prefix", () => {
  it("CONTRACT: every emitted path starts with BASE", () => {
    // BASE and the Vite `--base` are the same fact in two places. A path
    // emitted without it is invisible in dev (base `/`) and fatal in
    // production, where every route would parse as unknown.
    for (const route of ALL_ROUTES) {
      expect(routeToPath(route).startsWith(BASE)).toBe(true);
    }
  });

  it("parses a path that already carries the prefix", () => {
    expect(parseRoute(`${BASE}/waiting`)).toEqual({ name: "waiting" });
  });

  it("parses an unprefixed path too, so dev (base `/`) still routes", () => {
    expect(parseRoute("/waiting")).toEqual({ name: "waiting" });
    expect(parseRoute("/epics/e1")).toEqual({ name: "epic", epicId: "e1" });
  });
});

describe("route — unknown paths fall back rather than fail", () => {
  it("CONTRACT: /tab/fleet resolves to epics, not an error", () => {
    // The concrete case this rule was written for: the URL Elliot already
    // has open, from before the screen was renamed. Under an SPA fallback
    // an unmatched path is far more likely to be a stale link than a
    // mistake worth an error page.
    expect(parseRoute(`${BASE}/fleet`)).toEqual({ name: "epics" });
  });

  it("falls back for the root, an empty string and a nonsense path", () => {
    expect(parseRoute(BASE)).toEqual({ name: "epics" });
    expect(parseRoute("")).toEqual({ name: "epics" });
    expect(parseRoute("/no/such/screen")).toEqual({ name: "epics" });
  });

  it("never throws, whatever it is handed", () => {
    for (const p of ["", "/", "//", `${BASE}//epics//`, "/epics"]) {
      expect(() => parseRoute(p)).not.toThrow();
    }
  });
});

describe("route — the epic/chat drilldown", () => {
  it("an epic id with no chat segment is the epic route", () => {
    expect(parseRoute(`${BASE}/epics/e1`)).toEqual({
      name: "epic",
      epicId: "e1",
    });
  });

  it("CONTRACT: a dangling `chats` with no id degrades to the epic, not a chat with an empty id", () => {
    // A chat route carrying `chatId: ""` would subscribe to nothing and
    // render an empty transcript that looks like a chat with no messages
    // — the misleading outcome rather than the incomplete one.
    expect(parseRoute(`${BASE}/epics/e1/chats`)).toEqual({
      name: "epic",
      epicId: "e1",
    });
    expect(parseRoute(`${BASE}/epics/e1/chats/`)).toEqual({
      name: "epic",
      epicId: "e1",
    });
  });

  it("ignores empty segments from doubled slashes", () => {
    expect(parseRoute(`${BASE}//epics//e1//chats//c1//`)).toEqual({
      name: "chat",
      epicId: "e1",
      chatId: "c1",
    });
  });

  it("a segment after the chat id does not change the route", () => {
    expect(parseRoute(`${BASE}/epics/e1/chats/c1/anything`)).toEqual({
      name: "chat",
      epicId: "e1",
      chatId: "c1",
    });
  });

  it("`epics` alone is the list, not an epic with an empty id", () => {
    expect(parseRoute(`${BASE}/epics`)).toEqual({ name: "epics" });
    expect(parseRoute(`${BASE}/epics/`)).toEqual({ name: "epics" });
  });
});

describe("route — the canvas segment", () => {
  const epicId = "a1000000-0000-4000-8000-000000000e91";

  it("parses the canvas without disturbing the epic beside it", () => {
    expect(parseRoute(`${BASE}/epics/${epicId}/canvas`)).toEqual({
      name: "canvas",
      epicId,
    });
    // The regression this pair exists for: the canvas check sits between the
    // `chats` branch and the epic fallback, so getting it wrong shows up as
    // the DRILL-IN breaking, not as the canvas failing to open.
    expect(parseRoute(`${BASE}/epics/${epicId}`)).toEqual({
      name: "epic",
      epicId,
    });
  });

  it("CONTRACT: a word merely starting with `canvas` is the epic, not the canvas", () => {
    // `segments[2] === "canvas"`, never `startsWith`. A prefix test would
    // claim every future third segment beginning with those six letters, and
    // it would do it silently — the user lands on a canvas having asked for
    // something else.
    expect(parseRoute(`${BASE}/epics/${epicId}/canvassed`)).toEqual({
      name: "epic",
      epicId,
    });
  });

  it("CONTRACT: a segment AFTER `canvas` is not the canvas", () => {
    // Deliberately the OPPOSITE of the chat rule one describe up, where
    // `/chats/c1/anything` resolves to the chat. There, the id is the last
    // thing that carries meaning and trailing junk is noise. Here, a fourth
    // segment is a URL this build does not define — a tile deep link is the
    // obvious future use — and resolving it to the bare canvas would invent a
    // meaning that a later version has to take back.
    expect(parseRoute(`${BASE}/epics/${epicId}/canvas/tile-7`)).toEqual({
      name: "epic",
      epicId,
    });
  });

  it("survives doubled slashes, as the chat route does", () => {
    expect(parseRoute(`${BASE}//epics//${epicId}//canvas//`)).toEqual({
      name: "canvas",
      epicId,
    });
  });
});
