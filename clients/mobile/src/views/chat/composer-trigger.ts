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
 */
export function detectTrigger(
  value: string,
  caret: number,
): ComposerTrigger | null {
  // A caret outside the string is not a position in it. Clamping instead would
  // silently report a trigger for a stale caret after the value shrank.
  if (caret < 0 || caret > value.length) return null;

  for (let i = caret - 1; i >= 0; i -= 1) {
    const char = value[i];
    if (/\s/.test(char)) return null;
    const kind = TRIGGERS.get(char);
    if (kind === undefined) continue;
    // `foo/bar` and `a@b` are not triggers: the character must open a word.
    if (i > 0 && !/\s/.test(value[i - 1])) return null;
    return { kind, start: i, query: value.slice(i + 1, caret) };
  }
  return null;
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
