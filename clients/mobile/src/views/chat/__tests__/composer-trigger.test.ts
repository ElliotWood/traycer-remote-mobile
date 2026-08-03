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
