import { describe, expect, it } from "vitest";
import { stripMentions } from "../mention";

const BOT_ID = "28:bot-app-id";

function mention(text: string, id: string, name: string) {
  return { type: "mention", text, mentioned: { id, name } };
}

describe("stripMentions — entities are the contract, the regex is the fallback", () => {
  it("removes the bot mention using the entity's exact text", () => {
    const result = stripMentions(
      "<at>Traycer</at> does this fit SensorMine?",
      [mention("<at>Traycer</at>", BOT_ID, "Traycer")],
      BOT_ID,
    );
    expect(result.text).toBe("does this fit SensorMine?");
    expect(result.strippedByEntity).toBe(true);
    expect(result.usedFallback).toBe(false);
  });

  it("CONTRACT: removes a mention with NO tags — the case the regex cannot see", () => {
    // Some clients send the display name without `<at>` markup. The old
    // regex-only path left "Traycer" at the front of the question, which was
    // harmless against a verb list and is not harmless as classifier input.
    const result = stripMentions(
      "Traycer does this fit SensorMine?",
      [mention("Traycer", BOT_ID, "Traycer")],
      BOT_ID,
    );
    expect(result.text).toBe("does this fit SensorMine?");
    expect(result.strippedByEntity).toBe(true);
  });

  it("CONTRACT: keeps mentions of OTHER people — they are part of what was said", () => {
    // "ask @Sam about pricing" loses its meaning if Sam is deleted. Only the
    // bot's own mention is addressing; the rest is content.
    const result = stripMentions(
      "<at>Traycer</at> assess this and copy <at>Sam</at>",
      [
        mention("<at>Traycer</at>", BOT_ID, "Traycer"),
        mention("<at>Sam</at>", "29:sam", "Sam"),
      ],
      BOT_ID,
    );
    // Sam survives as a NAME, not as markup: meaning kept, tags gone, and the
    // classifier sees a person rather than an XML fragment.
    expect(result.text).toBe("assess this and copy Sam");
  });

  it("CONTRACT: two mentions do not swallow the text between them", () => {
    // The old expression was `<at>.*?<\/at>` applied globally; with two
    // mentions and no bot id to discriminate, a greedy variant loses the
    // middle. Asserted directly because it reads as correct either way.
    const result = stripMentions(
      "<at>Traycer</at> assess this and copy <at>Sam</at>",
      undefined,
      undefined,
    );
    expect(result.text).toBe("assess this and copy");
    expect(result.usedFallback).toBe(true);
  });

  it("falls back to the regex when no entities are supplied", () => {
    const result = stripMentions("<at>Traycer</at> fleet", undefined, undefined);
    expect(result.text).toBe("fleet");
    expect(result.strippedByEntity).toBe(false);
    expect(result.usedFallback).toBe(true);
  });

  it("strips every bot mention when the same one appears twice", () => {
    const result = stripMentions(
      "<at>Traycer</at> hello <at>Traycer</at>",
      [mention("<at>Traycer</at>", BOT_ID, "Traycer")],
      BOT_ID,
    );
    expect(result.text).toBe("hello");
  });

  it("normalises the whitespace a removal leaves behind", () => {
    const result = stripMentions(
      "  <at>Traycer</at>   does   this   fit?  ",
      [mention("<at>Traycer</at>", BOT_ID, "Traycer")],
      BOT_ID,
    );
    expect(result.text).toBe("does this fit?");
  });

  it("ignores non-mention entities", () => {
    const result = stripMentions(
      "does this fit?",
      [{ type: "clientInfo", text: "does" }],
      BOT_ID,
    );
    expect(result.text).toBe("does this fit?");
    expect(result.strippedByEntity).toBe(false);
  });

  it("leaves a message with no mention untouched", () => {
    const result = stripMentions("does this fit SensorMine?", [], BOT_ID);
    expect(result.text).toBe("does this fit SensorMine?");
  });

  /**
   * THE PROPERTY THAT MATTERS, and it is not "does stripping work".
   *
   * The Chat tab and an @mention in a channel are the same conversation with
   * the same bot. In PERSONAL scope Teams adds no mention at all — every
   * message is implicitly addressed to the bot — so:
   *
   *   - intake that REQUIRES a mention makes the Chat tab silently dead:
   *     every message ignored, nothing logged, because the code decided it
   *     was not being spoken to;
   *   - intake that strips unconditionally eats channel text.
   *
   * So the assertion is CONVERGENCE: the same question, asked either way,
   * must reach the classifier as identical text and therefore take an
   * identical route. Testing the two scopes separately would pass on a
   * version where they diverge.
   */
  it("CONTRACT: personal scope and channel scope converge on the same text", () => {
    const personal = stripMentions(
      "does this fit SensorMine?",
      undefined,
      BOT_ID,
    );
    const channel = stripMentions(
      "<at>Traycer</at> does this fit SensorMine?",
      [mention("<at>Traycer</at>", BOT_ID, "Traycer")],
      BOT_ID,
    );
    expect(personal.text).toBe(channel.text);
    expect(personal.text).toBe("does this fit SensorMine?");
  });

  it("CONTRACT: a personal-scope message is never treated as unaddressed", () => {
    // The silent-death case. No entities, no tags, nothing to strip — and the
    // text must survive intact rather than being discarded for lack of a
    // mention. There is deliberately no "was I addressed" signal in the
    // result for a caller to gate on.
    const result = stripMentions("what's waiting on me?", undefined, BOT_ID);
    expect(result.text).toBe("what's waiting on me?");
    expect(result.strippedByEntity).toBe(false);
    expect(result.usedFallback).toBe(false);
  });

  it("tolerates an entity whose text is not present in the message", () => {
    const result = stripMentions(
      "does this fit?",
      [mention("<at>Absent</at>", BOT_ID, "Absent")],
      BOT_ID,
    );
    expect(result.text).toBe("does this fit?");
    expect(result.strippedByEntity).toBe(false);
  });

  it("without a botId, strips every mention entity — the addressing case is unknown", () => {
    const result = stripMentions(
      "<at>Traycer</at> assess this and copy <at>Sam</at>",
      [
        mention("<at>Traycer</at>", BOT_ID, "Traycer"),
        mention("<at>Sam</at>", "29:sam", "Sam"),
      ],
      // The absent bot id, now stated. The test is named for this case and
      // used to express it by omission — which is what the rule is about.
      undefined,
    );
    expect(result.text).toBe("assess this and copy");
  });
});
