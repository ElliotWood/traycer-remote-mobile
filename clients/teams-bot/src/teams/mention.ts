/**
 * The @-mention — the difference between a message and a NOTIFICATION.
 *
 * Elliot's report is two complaints, not one: "no approval reaches Teams" and
 * "expect a push notification with a tag to get my attention". The first is
 * the unwired watcher. This file is the second, and it is not decoration: in a
 * Teams CHANNEL a bot message with no mention lands silently in a tab nobody
 * is looking at. The card can be perfect and still never be seen.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE INVARIANT TEAMS ENFORCES, AND FAILS SILENTLY ON
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A mention is TWO things that must agree exactly:
 *
 *   1. an entity — `{ type: "mention", text: "<at>NAME</at>", mentioned: {…} }`
 *   2. the SAME `<at>NAME</at>` substring, character for character, in the
 *      activity's own `text`
 *
 * If they disagree — different name, missing entity, entity but no markup —
 * Teams does not error. It renders `<at>Elliot Wood</at>` as **literal text**
 * and sends no notification. That is this project's recurring failure shape:
 * the schema accepts it, our renderer would accept it, and the product does
 * something else. `Action.Execute`, `targetWidth` and Adaptive Cards 1.5 all
 * failed exactly this way.
 *
 * So the two halves are built HERE, together, from one string, and there is a
 * test asserting the entity's `text` occurs verbatim in the activity's `text`.
 * A caller cannot construct one without the other.
 */

/** Who to tag. `id` is the Teams channel account id (`29:1…`), not an AAD oid. */
export interface MentionTarget {
  readonly id: string;
  readonly name: string;
}

/** The mention entity, in the shape Bot Framework puts on `activity.entities`. */
export interface MentionEntityOut {
  readonly type: "mention";
  readonly text: string;
  readonly mentioned: { readonly id: string; readonly name: string };
}

export interface MentionedText {
  /** Goes on `activity.text`. Contains the markup verbatim. */
  readonly text: string;
  /** Goes on `activity.entities`. Empty when no mention could be made. */
  readonly entities: readonly MentionEntityOut[];
}

/**
 * `<` and `>` are stripped from the display name, not escaped.
 *
 * They are the markup's own delimiters, so a name containing one produces
 * `<at>a<b</at>` — which Teams may parse as far as the inner `<` and then
 * render the rest literally. Escaping to `&lt;` is worse, not better: the
 * entity's `text` and the activity's `text` would then have to carry the
 * identical escaped form to keep the invariant, and any layer that unescapes
 * one of them breaks the match invisibly.
 *
 * Stripping keeps ONE string used in both places, which is the property that
 * cannot silently drift. `mentioned.name` is display only — Teams resolves the
 * person from `mentioned.id` — so a stripped character costs nothing real.
 */
function safeDisplayName(name: string): string {
  return name.replace(/[<>]/g, "").trim();
}

/**
 * Builds the tagged line, or degrades HONESTLY to an untagged one.
 *
 * Returns no entity when there is no usable id or name. That is a real case:
 * a conversation reference captured before we recorded a display name, or a
 * channel post with no user on it. The alternative — emitting `<at></at>` or a
 * mention against an empty id — is the literal-text failure, and it would look
 * like a bug in the message rather than a missing field.
 *
 * `lead` and `trail` are the sentence around the tag. They are the caller's
 * because the wording differs by event, and the tag's POSITION matters: Teams
 * shows the first line of the text as the notification preview, so the name
 * belongs at the front where the person sees it on a lock screen.
 */
export function buildMentionedText(
  target: MentionTarget | null,
  lead: string,
  trail: string,
): MentionedText {
  const name = target === null ? "" : safeDisplayName(target.name);
  const id = target?.id ?? "";
  if (id.length === 0 || name.length === 0) {
    // No tag, and say the sentence anyway. A notification that cannot tag is
    // still a message worth sending; one that tags nobody with broken markup
    // is not.
    return { text: `${lead}${trail}`.trim(), entities: [] };
  }

  // ONE string, used twice. This is the whole invariant.
  const markup = `<at>${name}</at>`;
  return {
    text: `${lead}${markup}${trail}`,
    entities: [{ type: "mention", text: markup, mentioned: { id, name } }],
  };
}

/**
 * Does this activity's mention actually satisfy Teams' rule?
 *
 * Exported because it is the assertion the tests make, and because it is the
 * only check that can be run without Teams. It answers the exact question the
 * product fails silently on: is every entity's markup present in the text.
 */
export function mentionsAreWellFormed(activity: MentionedText): boolean {
  return activity.entities.every(
    (entity) =>
      entity.text.length > 0 &&
      entity.mentioned.id.length > 0 &&
      activity.text.includes(entity.text),
  );
}
