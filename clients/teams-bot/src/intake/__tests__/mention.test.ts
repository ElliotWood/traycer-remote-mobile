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
    );
    expect(result.text).toBe("assess this and copy");
    expect(result.usedFallback).toBe(true);
  });

  it("falls back to the regex when no entities are supplied", () => {
    const result = stripMentions("<at>Traycer</at> fleet", undefined);
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
    );
    expect(result.text).toBe("assess this and copy");
  });
});
