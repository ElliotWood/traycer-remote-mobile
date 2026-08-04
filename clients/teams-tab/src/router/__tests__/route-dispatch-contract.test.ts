import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every member of `Route` reaches a screen — asserted against source, and the
 * list of members READ from the union rather than typed here.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS WHEN `tsc` ALREADY HAS A `never` GUARD
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The two catch different things, and the difference is the whole reason this
 * file was written:
 *
 *   - `tsc` catches **a member added and not handled**. The `never` in
 *     `app.tsx`'s default branch does that, and it was proven to: adding a
 *     probe member produced `TS2322` naming the renderer.
 *   - **Nothing catches the switch being turned back into an `if` chain.** An
 *     `if (route.name === …)` chain with a trailing `return` compiles
 *     perfectly. That is the state this repo was in until 2026-08-03, and it
 *     is why a new route would have rendered the epics list in silence.
 *
 * The second is the one that regresses without a sound. It is also the one a
 * type system cannot express, because the defect is the ABSENCE of a
 * construct, and absence type-checks.
 *
 * And the practical half: **no automated gate on this repo runs `tsc`.** No CI
 * job compiles, the pre-commit gate fires only on `pull_request` / `push:
 * main`, and local worktree work hits neither. The `never` guard is real and
 * fires only when a human types `tsc -b --force`. The vitest suite is the gate
 * that actually runs, so the property is asserted where it will be read.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE MEMBER LIST IS DERIVED, NOT COPIED
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A hardcoded `["epics", "epic", "chat", …]` here would be a count whose
 * method has been thrown away — it agrees with the union on the day it is
 * written and never again, and a member added to both the union and this list
 * but NOT to `app.tsx` would pass. Parsing the union means the specimen and
 * the claim cannot drift: a sixth member makes this test fail until it is
 * cased, whether or not anyone runs the compiler.
 *
 * Stated limit: this proves each member has a `case`, not that the case
 * renders the RIGHT screen. `case "epic": return <WaitingScreen/>` passes
 * here. That is what the component tests and the screenshots are for, and
 * neither substitutes for the other.
 */
const SRC = join(import.meta.dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

/**
 * The file with its comments removed.
 *
 * NOT a refinement — the first version of this file failed without it, and it
 * failed for the right reason. `app.tsx`'s new docblock QUOTES the defect it
 * replaced (`if (route.name === "waiting")`) in order to explain it, so the
 * assertion banning that construct matched the explanation of why it is
 * banned. The instrument was reading prose about the code as the code.
 *
 * The tempting repair was to reword the comment. That is the "loosen the
 * question" move with the specimen instead of the assertion: it turns the
 * check green by making the file stop saying a true thing, and every future
 * comment that mentions the defect re-breaks it.
 *
 * It matters in the positive direction too, and more: `toContain("switch
 * (route.name) {")` would be satisfied by a comment SAYING there is a switch,
 * long after someone deleted the switch. A contract test that a docblock can
 * satisfy is a contract test about docblocks.
 *
 * Stated limit: this is a lexical strip, not a parser. A `//` inside a string
 * literal would eat the rest of that line. No such literal exists in the file
 * under test, and if one appears the failure is a false alarm here rather than
 * a false pass — the safe direction for a gate to be wrong in.
 */
function readCode(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/**
 * The `name` literal of every member of the `Route` union.
 *
 * Sliced to the type declaration first, because `route.ts` also contains
 * `routeToPath`'s own switch — reading `case "chat":` out of THAT and calling
 * it a union member would make this test agree with itself. The slice ends at
 * `export const BASE`, the next top-level declaration.
 */
function routeMemberNames(): ReadonlyArray<string> {
  const source = read("router/route.ts");
  const start = source.indexOf("export type Route =");
  const end = source.indexOf("export const BASE");
  expect(start, "`export type Route =` not found in router/route.ts").toBeGreaterThan(-1);
  expect(end, "`export const BASE` not found in router/route.ts").toBeGreaterThan(start);

  const declaration = source.slice(start, end);
  const names = [...declaration.matchAll(/readonly name:\s*"([^"]+)"/g)].map(
    (match) => match[1] ?? "",
  );
  // A parse that finds nothing must FAIL, not vacuously pass. Without this the
  // whole file becomes a no-op the moment the union is reformatted — the exact
  // "instrument cannot fail" shape it was written to close.
  expect(names.length, "parsed no members out of the Route union").toBeGreaterThan(0);
  return names;
}

describe("route dispatch — every member reaches a screen", () => {
  it("parses the union rather than trusting a list written here", () => {
    // The count is asserted so a REFORMAT that silently halves the parse is
    // visible. It is a fact about today's union and is expected to change with
    // it — when it does, the number moves and the reader sees why.
    expect(routeMemberNames()).toEqual([
      "epics",
      "epic",
      "chat",
      "waiting",
      "notifications",
      // Added with the App settings screen. Failed on the commit that added
      // the union member, before the `case` existed — the SECOND time this
      // assertion has been exercised by real work rather than by a deliberate
      // mutation, which is the only evidence that a contract test is load
      // -bearing rather than decorative.
      "settings",
      // Added with the canvas. This assertion failed on the commit that added
      // it, before the case existed — which is the test working, and is the
      // first time it has been exercised by something other than a deliberate
      // mutation.
      "canvas",
    ]);
  });

  it("CONTRACT: app.tsx cases every Route member", () => {
    const app = readCode("app.tsx");
    for (const name of routeMemberNames()) {
      expect(app, `Route member "${name}" has no case in app.tsx`).toContain(
        `case "${name}":`,
      );
    }
  });

  it("CONTRACT: the dispatch is a switch with a never default", () => {
    const app = readCode("app.tsx");
    // The switch itself. An `if` chain is what this replaced.
    expect(app).toContain("switch (route.name) {");
    // The exhaustiveness guard. A switch WITHOUT this compiles fine when a
    // member is added and renders nothing for it — a blank screen instead of
    // the wrong one, which is better and still wrong.
    expect(app).toContain("const unhandled: never = route;");
  });

  it("CONTRACT: no `if (route.name ===` chain returns anywhere", () => {
    const app = readCode("app.tsx");
    // The defect in its original form. Kept as its own assertion rather than
    // folded into the one above, because a half-revert — a switch PLUS an
    // early `if` that returns before it — leaves both other assertions green
    // while restoring exactly the behaviour they exist to prevent.
    expect(app).not.toMatch(/if\s*\(\s*route\.name\s*===/);
  });
});
