import { describe, expect, it } from "vitest";
import {
  buildMentionedText,
  mentionsAreWellFormed,
  type MentionTarget,
} from "../mention";

const ELLIOT: MentionTarget = { id: "29:1abcdef", name: "Elliot Wood" };

describe("mention — the two halves must agree, or Teams notifies nobody", () => {
  it("CONTRACT: the entity's markup appears verbatim in the activity text", () => {
    /*
     * THE invariant. If the entity's `text` and the activity's `text` differ
     * by one character, Teams renders `<at>Elliot Wood</at>` as literal text
     * and sends no notification — no error on either side. This is the only
     * check for it that can run without Teams.
     */
    const built = buildMentionedText(ELLIOT, "", " — needs your approval.");
    expect(mentionsAreWellFormed(built)).toBe(true);
    expect(built.entities).toHaveLength(1);
    expect(built.text).toContain(built.entities[0].text);
  });

  it("emits the entity shape Bot Framework expects", () => {
    const built = buildMentionedText(ELLIOT, "", " — needs you.");
    expect(built.entities[0]).toEqual({
      type: "mention",
      text: "<at>Elliot Wood</at>",
      mentioned: { id: "29:1abcdef", name: "Elliot Wood" },
    });
    expect(built.text).toBe("<at>Elliot Wood</at> — needs you.");
  });

  it("CONTROL: the well-formedness check can actually fail", () => {
    // Without this, a checker that returned `true` unconditionally would pass
    // every assertion above and prove nothing. Hand-built to disagree in
    // exactly the way the real failure does.
    expect(
      mentionsAreWellFormed({
        text: "Someone needs you.",
        entities: [
          {
            type: "mention",
            text: "<at>Elliot Wood</at>",
            mentioned: { id: "29:1abcdef", name: "Elliot Wood" },
          },
        ],
      }),
    ).toBe(false);
  });

  it("puts the tag at the FRONT, where a lock screen preview shows it", () => {
    // Teams previews the start of `text`. A name at the end of a sentence is
    // a name nobody sees until they have already opened the app — which is
    // the thing the notification exists to make unnecessary.
    const built = buildMentionedText(ELLIOT, "", " — Acme RFP needs approval.");
    expect(built.text.startsWith("<at>")).toBe(true);
  });
});

describe("mention — degrading honestly", () => {
  it("CONTRACT: no target means a plain sentence, never empty markup", () => {
    // `<at></at>` is the literal-text failure, and it would look like a bug
    // in the message rather than a missing field. An untagged message is
    // still worth sending.
    const built = buildMentionedText(null, "", "Something needs you.");
    expect(built.entities).toEqual([]);
    expect(built.text).toBe("Something needs you.");
    expect(built.text).not.toContain("<at>");
  });

  it("refuses to tag on a missing id or a blank name", () => {
    for (const target of [
      { id: "", name: "Elliot Wood" },
      { id: "29:1abcdef", name: "" },
      { id: "29:1abcdef", name: "   " },
    ]) {
      const built = buildMentionedText(target, "", " needs you.");
      expect(built.entities, JSON.stringify(target)).toEqual([]);
      expect(built.text).not.toContain("<at>");
    }
  });

  it("strips angle brackets from a display name rather than escaping them", () => {
    /*
     * They are the markup's own delimiters. Escaping to `&lt;` would mean the
     * entity's text and the activity's text must both carry the identical
     * escaped form, and any layer that unescapes one breaks the match
     * invisibly. Stripping keeps ONE string in both places.
     */
    const built = buildMentionedText(
      { id: "29:1abcdef", name: "El<b>iot" },
      "",
      " needs you.",
    );
    expect(built.entities[0].text).toBe("<at>Elbiot</at>");
    expect(mentionsAreWellFormed(built)).toBe(true);
    // And the markup is still parseable — exactly one open and one close.
    expect(built.text.split("<at>")).toHaveLength(2);
    expect(built.text.split("</at>")).toHaveLength(2);
  });

  it("survives a name that is nothing but brackets, without emitting a hollow tag", () => {
    const built = buildMentionedText(
      { id: "29:1abcdef", name: "<<>>" },
      "",
      " needs you.",
    );
    expect(built.entities).toEqual([]);
  });
});
