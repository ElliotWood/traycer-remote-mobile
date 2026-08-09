/**
 * `clients/teams-help` replicates the bot's cards as hand-written HTML divs, so
 * every fixed phrase the bot says appears twice: once in `cards.ts`, where it
 * ships, and once on the Help page, where it is described. Nothing in the
 * running code reads the page, so nothing can notice when the two disagree —
 * the same blind spot as the manifest command list, arriving on the copy
 * instead of the verbs.
 *
 * This is not hypothetical. On 2026-08-09 the intake form and the ack card both
 * landed, and within hours the page was telling readers that documents are not
 * read (they are), that "Yes, go ahead" starts an assessment (it opens a form),
 * and quoting an ack subtitle that had been rewritten. Three claims, all stale
 * in the same direction, all found by a human reading both files side by side.
 *
 * The page's own README already names the mechanism that was supposed to catch
 * this: replicas are divs rather than screenshots because "a stale string is
 * greppable, where a stale screenshot rots silently". That was true and nobody
 * was grepping. This file is the grep.
 *
 * WHAT IS CHECKED, AND WHY IT IS OPT-OUT. Every `mock-eyebrow`, `mock-subtitle`
 * and `mock-btn` on the page must appear verbatim in the bot's source, unless
 * it carries `data-sample` — those three classes are the ones the bot itself
 * authors. A replica added tomorrow is therefore covered without anyone
 * remembering to opt it in, and exempting one costs a visible attribute in the
 * page rather than an invisible edit to a list in here. Excluded by design:
 * `mock-title` and `mock-meta`, which hold the user's own words, the host's
 * approval titles, and runtime-composed strings like "Requested 4m ago"; none
 * of those exist as a fixed phrase to compare against.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HELP_PAGE = fileURLToPath(
  new URL("../../../../teams-help/site/index.html", import.meta.url),
);

/**
 * Classes whose text the BOT writes. See the file docblock for what is left
 * out and why — the exclusions are the interesting half.
 */
const REPLICATED_CLASSES = ["mock-eyebrow", "mock-subtitle", "mock-btn"];

/**
 * The page is prose and uses typographic punctuation; the source is code and
 * uses ASCII. That difference is deliberate on both sides and is not drift, so
 * it is normalised away rather than asserted on. Everything else — wording,
 * order, every word of it — still has to match exactly.
 */
function normalise(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : readSourceFiles(full);
    }
    return entry.name.endsWith(".ts") ? [readFileSync(full, "utf8")] : [];
  });
}

/**
 * Comments are stripped before matching, and that is load-bearing rather than
 * tidiness. Written the obvious way — match against the raw file text — this
 * check passed on a phrase that exists nowhere in the shipping code and only
 * in a docblock discussing it. A comment is a description of the copy; it is
 * not the copy, and a page that agrees with a comment is still wrong.
 *
 * Only whole-line `//` comments go. A trailing one is left alone deliberately:
 * the pattern that would remove it also eats the `//` in every `https://` URL
 * inside a real string literal, which turns a correct page into a red build.
 */
const BOT_SOURCE = normalise(
  readSourceFiles(SOURCE_ROOT)
    .map((file) =>
      file.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, ""),
    )
    .join("\n"),
);

interface Replica {
  readonly className: string;
  readonly text: string;
  readonly isSample: boolean;
}

function extractReplicas(html: string): Replica[] {
  const found: Replica[] = [];
  for (const className of REPLICATED_CLASSES) {
    // Leaf elements only: `(?!</?(?:div|span))` stops the body at any nested
    // tag, so a container that happens to share the class prefix cannot drag
    // its children's text into one blob and match nothing.
    const pattern = new RegExp(
      `<(?:div|span) class="${className}[^"]*"([^>]*)>((?:(?!</?(?:div|span)).)*)</(?:div|span)>`,
      "gs",
    );
    for (const match of html.matchAll(pattern)) {
      const text = normalise(match[2] ?? "");
      if (text.length === 0) continue;
      found.push({
        className,
        text,
        isSample: /\bdata-sample\b/.test(match[1] ?? ""),
      });
    }
  }
  return found;
}

const replicas = extractReplicas(readFileSync(HELP_PAGE, "utf8"));
const checked = replicas.filter((replica) => !replica.isSample);

describe("Help page card copy matches the bot", () => {
  /**
   * Guards every assertion below. The extraction is a regex over someone
   * else's HTML: rename a class, reformat the file, and it starts returning
   * nothing — at which point `it.each` over an empty array is a green suite
   * that measured no cards at all. The floor is the count at the time of
   * writing, minus room to delete a card without a chore.
   */
  it("finds the page's card replicas at all", () => {
    expect(replicas.length).toBeGreaterThanOrEqual(12);
    expect(checked.length).toBeGreaterThanOrEqual(10);
  });

  /**
   * The opt-out has to stay narrow to mean anything: marking every replica
   * `data-sample` would satisfy the check above while checking nothing. Sample
   * text is the exception — placeholder epic and opportunity names — so it
   * stays a small minority of the page, and a change that makes it the
   * majority is a change to what this file is for.
   */
  it("keeps sample-marked replicas the exception", () => {
    const samples = replicas.length - checked.length;
    expect(samples).toBeLessThan(replicas.length / 3);
  });

  it.each(checked)(
    "$className — the bot really says $text",
    ({ text }: Replica) => {
      expect(
        BOT_SOURCE.includes(text),
        `The Help page shows this as bot copy, and no file under ` +
          `clients/teams-bot/src says it:\n\n  ${text}\n\n` +
          `Either the wording changed in the bot and the page went stale, or ` +
          `the text is example content — in which case mark that element ` +
          `data-sample in clients/teams-help/site/index.html.`,
      ).toBe(true);
    },
  );
});
