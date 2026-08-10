/**
 * What a typed message MEANS while a chat is focused.
 *
 * Pure, and separate from the handler on purpose: this is the one decision in
 * the feature that can misdirect a message, so it is the one that has to be
 * testable without standing up a turn.
 *
 * ════════════════════════════════════════════════════════════════════════
 * THE PRECEDENCE RULE, AND THE ARGUMENT FOR IT
 *
 * While focused, text is sent to the agent UNLESS its first word is in a
 * short, fixed reserved list. Commands win.
 *
 * The argument is an ASYMMETRY, not a preference:
 *
 *   A command wrongly read as a message  -> unrecoverable. `cards.ts` says
 *     it three times and means it: "a message to an agent cannot be unsent".
 *     It lands in a running agent's queue and it acts on it.
 *
 *   A message wrongly read as a command  -> visible and free. You typed
 *     "fleet" meaning to say the word, you get the fleet card, you can see
 *     exactly what happened, and you say it again with `send fleet`.
 *
 * When one direction is unrecoverable and the other is a visible no-op, the
 * default belongs on the recoverable side. This is the same reasoning
 * `parseCommand` already records for refusing to treat unrecognised text as
 * a message — "making the destructive reading the DEFAULT for typos is the
 * wrong way round" — applied one layer up, where focus has changed what the
 * default is.
 *
 * THE LIST IS EXPLICIT AND SHORT, NOT "whatever `parseCommand` recognises".
 * That distinction is load-bearing. `parseCommand` returns `help` for
 * ANYTHING it does not recognise, so deferring to it would make every
 * sentence a command and nothing would ever reach the agent. The reserved set
 * has to be enumerated, and being enumerated is what makes it small enough to
 * tell someone in one line.
 *
 * THE ESCAPE HATCH IS `send <text>`, and the cost of the rule is paid at the
 * moment it bites: when a reserved word is intercepted, the caller is
 * expected to say so and name the escape. A rule the user discovers by having
 * a message silently not arrive is not a rule, it is a trap.
 * ════════════════════════════════════════════════════════════════════════
 */

/**
 * Words that keep their command meaning while focused.
 *
 * Deliberately the NAVIGATION and ESCAPE verbs only. Everything here either
 * moves you somewhere else or gets you out; none of them is a thing you would
 * plausibly say to an agent as a whole first word, and each has a visible
 * result if intercepted wrongly.
 *
 * `say` and `chat` stay because they name their own target explicitly, so
 * they are unambiguous even while focus points elsewhere — and a user who has
 * typed an explicit destination should get that destination, not this one.
 */
export const RESERVED_WHILE_FOCUSED: readonly string[] = [
  // Navigation
  "fleet",
  "agents",
  "list",
  "epic",
  "epics",
  "chat",
  "log",
  "say",
  "help",
  // Escape
  "done",
  "stop",
  "exit",
  "leave",
];

/** The words that END focus rather than merely surviving it. */
export const FOCUS_EXIT_WORDS: readonly string[] = [
  "done",
  "stop",
  "exit",
  "leave",
];

/** Forces the rest of the line to the agent, reserved first word or not. */
export const FOCUS_SEND_PREFIX = "send";

export type FocusRouting =
  /** Send this text to the focused chat. */
  | { readonly kind: "send"; readonly text: string }
  /** Leave focus, then answer normally. */
  | { readonly kind: "exit" }
  /**
   * Run it as a command. `intercepted` is the reserved word that caused it,
   * so the caller can say WHY the message did not go to the agent — the half
   * of the rule that stops it being a trap.
   */
  | { readonly kind: "command"; readonly intercepted: string };

function firstWord(text: string): string {
  return text.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
}

/**
 * ATTACHMENTS ALWAYS LEAVE THE FOCUS PATH, and that is honesty rather than
 * caution.
 *
 * Nothing in the send path carries bytes — `sendChatMessage` takes a string.
 * So a document dropped while focused cannot reach the agent however it is
 * routed, and treating it as a message would deliver the caption and silently
 * drop the file. A dropped attachment is an intake gesture; it belongs to the
 * classifier, which is where it goes when focus is not in the way.
 */
export function routeWhileFocused(input: {
  readonly text: string;
  readonly hasAttachments: boolean;
}): FocusRouting {
  if (input.hasAttachments) {
    return { kind: "command", intercepted: "" };
  }

  const trimmed = input.text.trim();
  if (trimmed.length === 0) {
    // An empty message is not a message. `Action.Submit` and stray whitespace
    // both produce these, and the composer's own guard refuses them for the
    // same reason: an accidental empty send reaches a blocked agent's queue.
    return { kind: "command", intercepted: "" };
  }

  const first = firstWord(trimmed);

  if (first === FOCUS_SEND_PREFIX) {
    // `send` alone is not an escape, it is the word "send". Only `send <text>`
    // forces, and the forced text is everything after it.
    const rest = trimmed.slice(FOCUS_SEND_PREFIX.length).trim();
    if (rest.length > 0) return { kind: "send", text: rest };
  }

  if (FOCUS_EXIT_WORDS.includes(first)) {
    return { kind: "exit" };
  }
  if (RESERVED_WHILE_FOCUSED.includes(first)) {
    return { kind: "command", intercepted: first };
  }
  return { kind: "send", text: trimmed };
}
