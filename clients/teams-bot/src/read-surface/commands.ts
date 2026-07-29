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
  | { readonly kind: "help" };

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

  const chatMatch = /^(?:chat|status)\s+(\S+)$/i.exec(text);
  if (chatMatch) {
    return { kind: "chat", chatId: chatMatch[1] };
  }

  return { kind: "help" };
}
