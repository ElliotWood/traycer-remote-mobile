/**
 * The manifest's command list is the bot's only DISCOVERY surface, and it is
 * the one part of the bot that Teams renders without ever calling us — so
 * nothing in the running code can notice when it goes stale.
 *
 * That is the failure this file exists to make impossible. A command list is
 * hand-typed JSON sitting beside a hand-written parser; the moment a verb is
 * renamed in `commands.ts`, the menu goes on advertising the old one, Teams
 * inserts it into the compose box, and `parseCommand` falls through to
 * `help`. The user selected a command from the bot's own menu and got the
 * help card — which reads as "the command doesn't exist", the exact
 * misreading `usage` was added to prevent.
 *
 * So the menu is bound to the parser rather than checked against it by eye:
 * every declared title is fed to the REAL `parseCommand`, and falling through
 * to the help fallback is a failure. A count in a comment would have been the
 * measurement-with-no-method this project keeps finding; this re-derives.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCommand } from "../commands";

interface ManifestCommand {
  readonly title: string;
  readonly description: string;
}

const manifest = JSON.parse(
  readFileSync(
    new URL("../../../appPackage/manifest.json", import.meta.url),
    "utf8",
  ),
) as {
  bots: readonly {
    commandLists?: readonly {
      scopes: readonly string[];
      commands: readonly ManifestCommand[];
    }[];
  }[];
};

const personalCommands: readonly ManifestCommand[] =
  manifest.bots[0]?.commandLists?.find((list) =>
    list.scopes.includes("personal"),
  )?.commands ?? [];

/**
 * Verbs that cannot act alone because they name a target. Selecting one from
 * the menu is a two-step interaction by construction: Teams puts the title in
 * the compose box, the user adds the id.
 *
 * Listed here rather than inferred, because "does this verb take an argument"
 * is a product decision. What is NOT hardcoded is what they parse to — that
 * comes from `parseCommand` below.
 */
const ARGUMENT_TAKING = new Set(["epic", "chat", "log", "say"]);

describe("appPackage/manifest command list", () => {
  it("declares a personal-scope command list at all", () => {
    // Guards the whole file: an empty list would make every `it.each` below
    // vacuous, and a suite that passes on zero cases is the instrument that
    // cannot fail.
    expect(personalCommands.length).toBeGreaterThan(0);
  });

  it.each(personalCommands.map((c) => c.title))(
    "%s is a verb the parser actually recognises",
    (title) => {
      const parsed = parseCommand(title);
      // `help` is the FALLBACK for unrecognised text, so "parsed as help" and
      // "not recognised" are the same observation for every title but one.
      if (title === "help") {
        expect(parsed.kind).toBe("help");
        return;
      }
      expect(parsed.kind).not.toBe("help");
    },
  );

  it.each(personalCommands.filter((c) => ARGUMENT_TAKING.has(c.title)))(
    "$title answers with its own syntax when sent bare from the menu",
    ({ title }) => {
      const parsed = parseCommand(title);
      // Not merely "recognised": selecting a menu entry must produce
      // actionable guidance, never silence and never the generic help card.
      expect(parsed.kind).toBe("usage");
      if (parsed.kind !== "usage") return;
      expect(parsed.usage).toContain(title);
    },
  );

  it("advertises no verb whose description contradicts its argument arity", () => {
    // The description is where the syntax lives, since the title is what gets
    // inserted into the compose box and must stay bare. An argument-taking
    // verb whose description shows no placeholder is a menu entry that looks
    // like a one-click action and is not.
    for (const command of personalCommands) {
      if (ARGUMENT_TAKING.has(command.title)) {
        expect(command.description).toContain("<");
      }
    }
  });
});
