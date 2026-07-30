/**
 * Plain-text command parsing for the read-only surface. Deliberately text
 * commands rather than card buttons: `Action.Execute` handling is T3's
 * scope, and adding a button here would quietly cross that boundary.
 *
 * Pure function, no I/O — so command routing is testable without
 * constructing a `TurnContext`.
 */

export type Command =
  | { readonly kind: "fleet" }
  | { readonly kind: "epics" }
  | { readonly kind: "bind_epic"; readonly epicId: string }
  | { readonly kind: "chat"; readonly chatId: string }
  | { readonly kind: "help" }
  /**
   * A recognised command word used wrongly (e.g. bare `epic` with no id).
   * Distinct from `help` on purpose: the user's live test typed `epic`, got
   * the help card, and reasonably read that as "the command doesn't exist".
   * Silently falling back to help hides a usage error.
   */
  | { readonly kind: "usage"; readonly usage: string };

export function parseCommand(rawText: string): Command {
  // Teams prefixes @-mentions into `activity.text`; strip a leading mention
  // and normalise whitespace before matching.
  const text = rawText
    .replace(/<at>.*?<\/at>/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
  const lower = text.toLowerCase();

  if (lower === "" || lower === "help" || lower === "?") {
    return { kind: "help" };
  }
  if (lower === "fleet" || lower === "agents" || lower === "list") {
    return { kind: "fleet" };
  }
  if (lower === "epics") {
    return { kind: "epics" };
  }

  const bindMatch = /^epic\s+(\S+)$/i.exec(text);
  if (bindMatch) {
    return { kind: "bind_epic", epicId: bindMatch[1] };
  }
  if (lower === "epic") {
    return { kind: "usage", usage: "epic <id> — select an epic for this chat" };
  }

  const chatMatch = /^(?:chat|status)\s+(\S+)$/i.exec(text);
  if (chatMatch) {
    return { kind: "chat", chatId: chatMatch[1] };
  }
  if (lower === "chat" || lower === "status") {
    return {
      kind: "usage",
      usage: `${lower} <id> — show one chat's status (get ids from "fleet")`,
    };
  }

  return { kind: "help" };
}
