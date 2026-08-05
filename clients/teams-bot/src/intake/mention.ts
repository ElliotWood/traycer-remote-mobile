/**
 * R1 — what the person actually said, with the @mention removed.
 *
 * CORRECTION TO THE SPEC. It records "@mention handling — nothing … mention
 * text is not stripped". That is not accurate: `parseCommand` has always done
 * `text.replace(/<at>.*?<\/at>/gi, " ")`. Stripping exists.
 *
 * What does not exist is stripping that is CORRECT. The regex assumes the
 * mention arrives wrapped in `<at>` tags, and that is a rendering detail
 * rather than a contract:
 *
 *   - Teams sends the authoritative form in `activity.entities` — one entry
 *     per mention, each carrying the EXACT substring it occupies in
 *     `activity.text`. That is the thing designed to be removed.
 *   - The tag form varies. Mobile clients and some channel posts send the
 *     display name without tags, and a bot addressed as "Traycer, does this
 *     fit?" has no `<at>` anywhere.
 *   - The regex is greedy across tags in a message mentioning two people, so
 *     `<at>Traycer</at> ask <at>Sam</at>` loses the middle.
 *
 * A leftover "Traycer" at the front of an RFI question is not cosmetic once
 * the text is being CLASSIFIED rather than matched against a verb list: it is
 * a token in the input to a decision about a customer document.
 *
 * So: entities first, because they are the contract. The regex stays as a
 * fallback for the shapes entities do not cover, rather than as the mechanism.
 */

/** One mention as Teams reports it. Only the fields we rely on. */
export interface MentionEntity {
  readonly type: string;
  /** The exact substring occupied in `activity.text`, e.g. `<at>Traycer</at>`. */
  readonly text?: string;
  readonly mentioned?: { readonly id?: string; readonly name?: string };
}

export interface StripMentionsResult {
  /** What the person said, with mentions removed and whitespace normalised. */
  readonly text: string;
  /** True when at least one mention was removed by ENTITY, not by regex. */
  readonly strippedByEntity: boolean;
  /** True when the fallback regex had to remove something entities missed. */
  readonly usedFallback: boolean;
}

/**
 * Removes every mention from the message text.
 *
 * `botId` is optional and, when given, limits entity-based removal to mentions
 * OF THE BOT. Mentions of other people are part of what the person said —
 * "ask @Sam about the pricing section" loses its meaning if Sam is deleted —
 * and the whole point of this ticket is that the remaining text is now the
 * input to a classifier rather than a command lookup.
 */
export function stripMentions(
  rawText: string,
  entities: readonly MentionEntity[] | undefined,
  // `| undefined`, not `botId?:`. The rule exists because an optional
  // parameter and a parameter that may be undefined read identically at the
  // call site and differ in what the compiler demands — and this one is read
  // by a caller that genuinely has no bot id in a personal chat.
  botId: string | undefined,
): StripMentionsResult {
  let text = rawText;
  let strippedByEntity = false;
  let sawMentionEntity = false;

  for (const entity of entities ?? []) {
    if (entity.type.toLowerCase() !== "mention") continue;
    if (entity.text === undefined || entity.text === "") continue;
    sawMentionEntity = true;
    if (!text.includes(entity.text)) continue;

    const addressesBot =
      botId === undefined ||
      entity.mentioned?.id === undefined ||
      entity.mentioned.id === botId;

    if (addressesBot) {
      // Addressing, not content. Remove it.
      text = text.split(entity.text).join(" ");
    } else {
      // Someone ELSE, which is part of what was said — but the markup is not.
      // "copy <at>Sam</at>" becomes "copy Sam": meaning kept, tags gone, and
      // the classifier sees a name rather than an XML fragment.
      text = text.split(entity.text).join(entity.mentioned?.name ?? " ");
    }
    strippedByEntity = true;
  }

  // FALLBACK ONLY WHEN ENTITIES DID NOT COVER IT.
  //
  // Running this unconditionally undoes the decision above: the entity pass
  // deliberately keeps a mention of another person, and then the regex
  // deletes it anyway. Caught by the test that asserts Sam survives — it
  // failed the first time for exactly this reason, which is the argument for
  // asserting the keep case and not only the strip case.
  let usedFallback = false;
  if (!sawMentionEntity) {
    const beforeFallback = text;
    text = text.replace(/<at>[^<]*<\/at>/gi, " ");
    usedFallback = text !== beforeFallback;
  }

  return {
    text: text.trim().replace(/\s+/g, " "),
    strippedByEntity,
    usedFallback,
  };
}
