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
  /**
   * The EXPLICIT typed send path. There is deliberately no implicit one:
   * unrecognised text falls through to `help` below, so if bare text meant
   * "send to the agent", every mistyped command would be delivered to a
   * running agent and could not be unsent. See `buildComposeCard`.
   *
   * It also has to name its chat, because a conversation is bound to an
   * EPIC, which holds many chats — there is no "current agent" to infer.
   */
  | { readonly kind: "say"; readonly chatId: string; readonly text: string }
  | { readonly kind: "compose"; readonly chatId: string }
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

  // `say <chatId> <text>` — note the text is taken from the ORIGINAL string,
  // not the lowercased one, and its internal spacing is whatever survived
  // the whitespace normalisation above. Matching on `text` keeps the
  // message's own capitalisation, which a lowercased match would destroy.
  const sayMatch = /^(?:say|reply|send)\s+(\S+)\s+([\s\S]+)$/i.exec(text);
  if (sayMatch) {
    return { kind: "say", chatId: sayMatch[1], text: sayMatch[2] };
  }
  // `say <chatId>` with no text opens the composer rather than erroring:
  // the user has named a destination and clearly intends to write to it.
  const composeMatch = /^(?:say|reply|send)\s+(\S+)$/i.exec(text);
  if (composeMatch) {
    return { kind: "compose", chatId: composeMatch[1] };
  }
  if (lower === "say" || lower === "reply" || lower === "send") {
    return {
      kind: "usage",
      usage: `${lower} <chat-id> [message] — message an agent (omit the message for a compose box)`,
    };
  }

  return { kind: "help" };
}
