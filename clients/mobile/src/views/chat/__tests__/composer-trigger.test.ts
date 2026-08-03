/**
 * M3 — the trigger reader, tested where the defects actually are.
 *
 * The interesting cases are all NEGATIVE: a trigger detector that fires
 * everywhere passes every positive test. `a@b.com` and `src/foo` are the
 * shapes this composer sees constantly, so "does not fire" carries more of the
 * behaviour than "does fire".
 */
import { describe, expect, it } from "vitest";
import {
  applyTrigger,
  detectTrigger,
  filterByName,
} from "@/views/chat/composer-trigger";

describe("detectTrigger — fires at a word boundary", () => {
  it("fires on a bare slash at the start", () => {
    expect(detectTrigger("/", 1)).toEqual({ kind: "slash", start: 0, query: "" });
  });

  it("carries the typed query", () => {
    expect(detectTrigger("/rev", 4)).toEqual({ kind: "slash", start: 0, query: "rev" });
  });

  it("fires after whitespace, mid-message", () => {
    expect(detectTrigger("look at @comp", 13)).toEqual({
      kind: "mention",
      start: 8,
      query: "comp",
    });
  });

  it("reads the trigger the caret is INSIDE, not the last one in the string", () => {
    // Caret sits inside the first token. A detector scanning forward from 0,
    // or taking the last trigger in the value, reports the second one.
    const value = "@alpha @beta";
    expect(detectTrigger(value, 3)).toEqual({ kind: "mention", start: 0, query: "al" });
  });
});

describe("detectTrigger — a mention query is a PATH", () => {
  /**
   * These are the cases that were broken in `e57975fc` and are the reason the
   * scan was replaced by a token-start rule. The first implementation gave up
   * on the `/` inside the query, so `@src` was a trigger and `@src/` was not —
   * on the feature whose entire subject is file paths.
   *
   * Nothing about the old tests was wrong; nobody wrote these because `@` had
   * no consumer when the trigger was written, so the negative fixtures were
   * complete against the world as it stood. That is the ceiling on the two
   * mutation checks that commit reported: they proved the rules present were
   * load-bearing, which is not evidence that no rule is missing.
   */
  it("keeps the trigger alive across the path separator", () => {
    expect(detectTrigger("@src/", 5)).toEqual({
      kind: "mention",
      start: 0,
      query: "src/",
    });
  });

  it("carries a multi-segment path as the query", () => {
    // Measured on the live host: `chat/composer` returns this directory's
    // files first where bare `composer` returns another package's. The slash
    // has to reach the wire.
    expect(detectTrigger("look at @clients/mobile/src/views", 33)).toEqual({
      kind: "mention",
      start: 8,
      query: "clients/mobile/src/views",
    });
  });

  it("carries dots and dashes — a filename, not a word", () => {
    expect(detectTrigger("@composer-trigger.ts", 20)).toEqual({
      kind: "mention",
      start: 0,
      query: "composer-trigger.ts",
    });
  });

  it("does not turn a path query into a slash command", () => {
    // The kind comes from the character that OPENS the token, so an inner `/`
    // cannot re-key a mention as a command mid-query.
    expect(detectTrigger("@src/app.ts", 11)?.kind).toBe("mention");
  });
});

describe("detectTrigger — boundaries that are not spaces", () => {
  /**
   * All measured by the Evidence Gate against the previous version, where
   * every case here returned `null`. They were conservative failures — no
   * sheet, nothing wrong on the wire — so they are missing affordances rather
   * than the canary's bug class. Two of them are ordinary in a coding
   * composer, and one excludes a class of user rather than an edge case.
   */
  it.each([
    ["a backtick, as in inline code", "`@src/app.ts", 12],
    ["a paren, as in prose (@file)", "the handler (@src/app.ts", 24],
    ["a double quote", '"@src/app.ts', 12],
    ["a bracket", "[@src/app.ts", 12],
    ["an asterisk, as in bold", "*@src/app.ts", 12],
  ])("fires after %s", (_label, value, caret) => {
    const trigger = detectTrigger(value, caret);
    expect(trigger?.kind).toBe("mention");
    expect(trigger?.query).toBe("src/app.ts");
  });

  it("fires mid-sentence in a script written without spaces", () => {
    // CJK prose has no word-separating spaces, so a whitespace-only boundary
    // meant `@` never fired mid-sentence for those users at all. The
    // word-boundary rule exists to exclude `a@b.com` and `src/foo`, which are
    // ASCII by construction — no email or path carries a CJK character before
    // its `@`, so admitting one costs nothing.
    const value = "これは@src";
    const trigger = detectTrigger(value, value.length);
    expect(trigger).toEqual({ kind: "mention", start: 3, query: "src" });
  });

  it("fires after a zero-width space, which `\\s` does not match", () => {
    // Arrives by paste from rendered docs. A token silently refusing to
    // trigger is indistinguishable from the feature being broken.
    const value = "see​@src";
    const trigger = detectTrigger(value, value.length);
    expect(trigger).toEqual({ kind: "mention", start: 4, query: "src" });
  });

  it("still refuses an email whose local part ends in a bracket-free word", () => {
    // The openers are skipped only at the START of a token, so nothing here
    // loosens the rule that keeps `a@b.com` quiet.
    expect(detectTrigger("(mail a@b.com", 13)).toBeNull();
  });

  it("still refuses a parenthesised path", () => {
    expect(detectTrigger("(src/foo", 8)).toBeNull();
  });
});

describe("detectTrigger — does NOT fire", () => {
  it("ignores the slash inside a path", () => {
    // The single most common thing typed into a coding composer.
    expect(detectTrigger("src/foo", 7)).toBeNull();
  });

  it("ignores the at-sign inside an email address", () => {
    expect(detectTrigger("mail a@b.com", 12)).toBeNull();
  });

  it("closes once the query runs past whitespace", () => {
    expect(detectTrigger("/review the diff", 16)).toBeNull();
  });

  it("returns null when the caret is before the trigger", () => {
    expect(detectTrigger("/review", 0)).toBeNull();
  });

  it("returns null for a caret outside the string rather than clamping", () => {
    // A stale caret after the value shrank. Clamping would report a trigger
    // for a position that no longer exists.
    expect(detectTrigger("/rev", 99)).toBeNull();
    expect(detectTrigger("/rev", -1)).toBeNull();
  });
});

describe("applyTrigger", () => {
  it("replaces the trigger span and leaves the caret after the token", () => {
    const value = "/rev";
    const trigger = detectTrigger(value, 4);
    expect(trigger).not.toBeNull();
    const result = applyTrigger(value, trigger!, 4, "/review");
    expect(result.value).toBe("/review ");
    expect(result.caret).toBe(8);
  });

  it("preserves text after the caret — completing mid-sentence does not truncate", () => {
    const value = "see @comp for details";
    const trigger = detectTrigger(value, 9);
    const result = applyTrigger(value, trigger!, 9, "@composer.tsx");
    expect(result.value).toBe("see @composer.tsx  for details");
    // Caret lands right after the inserted token + its space, NOT at the end.
    expect(result.caret).toBe(18);
    expect(result.value.slice(result.caret)).toBe(" for details");
  });

  it("leaves a trailing space, so the sheet does not reopen on the token just chosen", () => {
    // This is the whole reason for the space. Without it the caret sits
    // against the token and the next detect reads it back as a query.
    const value = "/rev";
    const result = applyTrigger(value, detectTrigger(value, 4)!, 4, "/review");
    expect(detectTrigger(result.value, result.caret)).toBeNull();
  });
});

describe("filterByName", () => {
  const items = [{ name: "review" }, { name: "Revise" }, { name: "deploy" }];
  const nameOf = (i: { name: string }): string => i.name;

  it("returns everything for an empty query", () => {
    expect(filterByName(items, "", nameOf)).toHaveLength(3);
  });

  it("matches case-insensitively and keeps host order", () => {
    // Two matches, so this also proves it does not stop at the first.
    expect(filterByName(items, "rev", nameOf).map(nameOf)).toEqual([
      "review",
      "Revise",
    ]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterByName(items, "zzz", nameOf)).toEqual([]);
  });
});
