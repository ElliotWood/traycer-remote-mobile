/**
 * M3 — reading an `@`/`/` trigger out of a plain textarea's value + caret, and
 * splicing the chosen token back in.
 *
 * Pure and synchronous on purpose. Desktop does this with a Tiptap extension
 * stack (node views, chips, a caret-anchored menu); M3 ruled that out for the
 * phone — porting it would put the composer's recently-fixed draft, prefill
 * and IME behaviour at risk for no wire benefit, because **a mention already
 * serializes to the agent as plain text** (`workspace/unary-schemas.ts:79-84`).
 * A token spliced into the textarea IS the payload. No schema, no node views.
 *
 * Everything here is a function of `(value, caret)` so it can be tested
 * without a DOM, a host or a keyboard.
 */

export type TriggerKind = "slash" | "mention";

export interface ComposerTrigger {
  readonly kind: TriggerKind;
  /** Index of the `@` / `/` character itself. */
  readonly start: number;
  /** Text between the trigger character and the caret — what to filter on. */
  readonly query: string;
}

const TRIGGERS: ReadonlyMap<string, TriggerKind> = new Map([
  ["/", "slash"],
  ["@", "mention"],
]);

/** Delimiters that can precede a token without being part of it. */
const OPENERS = /[("'`[{*<]/;

/**
 * Scripts written without word-separating spaces.
 *
 * The word-boundary rule exists to exclude `a@b.com` and `src/foo`, which are
 * ASCII by construction — no email or path has a CJK character before its `@`
 * or `/`. But CJK prose has no spaces, so a whitespace-only boundary means
 * `@` NEVER fires mid-sentence for those users: a CJK sentence ending in `@src` was `null`.
 *
 * That is a class-of-user exclusion rather than an edge case, which is why it
 * is worth a named rule rather than a note. Covers CJK punctuation, kana,
 * ideographs (incl. extension A), Hangul and fullwidth forms.
 */
const CJK_RANGES: readonly (readonly [number, number])[] = [
  [0x3000, 0x303f], // CJK symbols and punctuation
  [0x3040, 0x30ff], // hiragana + katakana
  [0x3400, 0x4dbf], // ideographs, extension A
  [0x4e00, 0x9fff], // ideographs
  [0xac00, 0xd7af], // hangul syllables
  [0xff00, 0xffef], // fullwidth forms
];

/**
 * Zero-width space, as a CODE POINT rather than a character literal — a
 * literal one is invisible in review and in a diff, which is the same property
 * that makes it a hazard in the input.
 */
const ZERO_WIDTH_SPACE = 0x200b;

/**
 * U+200B (zero-width space) is deliberately included and is NOT in `\s`: it
 * arrives via paste from rendered documentation, and a token silently refusing
 * to trigger is indistinguishable from the feature being broken.
 */
function isBoundary(char: string): boolean {
  if (/\s/.test(char)) return true;
  const code = char.codePointAt(0) ?? 0;
  if (code === ZERO_WIDTH_SPACE) return true;
  return CJK_RANGES.some(([lo, hi]) => code >= lo && code <= hi);
}

/**
 * The trigger the caret is currently inside, or `null`.
 *
 * A trigger only counts at a WORD BOUNDARY — index 0 or immediately after
 * whitespace. Without that rule an email address opens the mention sheet on
 * every `a@b`, and a file path opens the command sheet at every `/`. That is
 * not hypothetical for this composer: paths and URLs are most of what gets
 * typed into it.
 *
 * The query stops at whitespace, so the sheet closes when the user types past
 * the token rather than matching an ever-growing sentence.
 *
 * ## Why this asks about the TOKEN rather than scanning for a trigger char
 *
 * The first version scanned backwards for a trigger character and gave up the
 * moment it met one that was not itself at a word boundary. That is the same
 * rule as below for `a@b.com` and `src/foo`, and **wrong for `@src/app.ts`**:
 * the `/` inside the query is a non-boundary `/`, so the whole mention died as
 * soon as the user typed the separator. Measured on the shipped function —
 * `@src` was a trigger and `@src/` was `null` — on a feature whose entire
 * subject is file paths.
 *
 * It was not a coverage gap that mutation testing could have found. Both rules
 * were mutation-checked and both mutations reddened tests; mutation testing
 * shows the tests bind the rules that EXIST, never that the rule set is
 * complete.
 *
 * The host rewards the fix rather than merely tolerating it: measured,
 * `query: "chat/composer"` returns this very directory's files first where
 * bare `"composer"` returns another package's. A slash in the query is how the
 * feature becomes usable, so it has to survive to the wire.
 */
export function detectTrigger(
  value: string,
  caret: number,
): ComposerTrigger | null {
  // A caret outside the string is not a position in it. Clamping instead would
  // silently report a trigger for a stale caret after the value shrank.
  if (caret < 0 || caret > value.length) return null;

  // The token the caret sits in: back to the start of the string or to the
  // last boundary. Everything inside it — `/`, `.`, `@` — is query text.
  let start = caret;
  while (start > 0 && !isBoundary(value[start - 1])) start -= 1;
  // Caret at a token's start (or right after a space) is not inside a token,
  // so a trailing space closes the sheet on what was just completed.
  if (start === caret) return null;

  // An opening delimiter is not part of the token. `` `@src/app.ts` `` and
  // "the handler (@src/app.ts)" are ordinary in a coding composer, and both
  // opened no sheet at all before this. Only OPENERS are skipped, so
  // `a@b.com` and `src/foo` still open with an ordinary character and are
  // still not triggers however many `@`/`/` they contain further along.
  while (start < caret && OPENERS.test(value[start])) start += 1;

  const kind = TRIGGERS.get(value[start]);
  if (kind === undefined) return null;
  return { kind, start, query: value.slice(start + 1, caret) };
}

export interface TriggerCompletion {
  readonly value: string;
  /** Where the caret must be placed after the splice. */
  readonly caret: number;
}

/**
 * Replace the trigger and its query with `token`, leaving the caret after the
 * inserted text and a single trailing space.
 *
 * The trailing space is not cosmetic: without it the caret sits immediately
 * after the token, `detectTrigger` reads the token itself as the query, and
 * the sheet reopens on the thing that was just chosen.
 *
 * Only the trigger's own span is replaced — text after the caret survives, so
 * completing mid-sentence does not truncate the rest of the message.
 */
export function applyTrigger(
  value: string,
  trigger: ComposerTrigger,
  caret: number,
  token: string,
): TriggerCompletion {
  const before = value.slice(0, trigger.start);
  const after = value.slice(caret);
  const inserted = `${token} `;
  return {
    value: `${before}${inserted}${after}`,
    caret: before.length + inserted.length,
  };
}

/**
 * Case-insensitive substring filter over a display name.
 *
 * Deliberately NOT fuzzy: M3 puts client-side re-ranking out of scope, and for
 * `/` the host returns the whole catalogue unranked, so a fuzzy matcher here
 * would invent an ordering the host never expressed.
 */
export function filterByName<T>(
  items: readonly T[],
  query: string,
  nameOf: (item: T) => string,
): readonly T[] {
  if (query === "") return items;
  const needle = query.toLowerCase();
  return items.filter((item) => nameOf(item).toLowerCase().includes(needle));
}
