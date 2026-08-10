/**
 * Teams conversation -> the chat you are currently talking to.
 *
 * The sibling `epic-binding-store.ts` never had: that one answers "which epic
 * is this conversation about", this one answers "where does my next message
 * go". Both are per-conversation Teams-side state and neither belongs to the
 * identity registry, for the reason that file records — a chat is not a
 * property of a tenant.
 *
 * WHY IT EXISTS. Replying used to mean an `Input.Text` inside a card, so the
 * bot rendered a compose box directly above Teams' own compose box: two
 * inputs, one of them fake, and the real one did nothing. Elliot's words were
 * "reply being embedded in a card instead of being natural". Talking to an
 * agent should use the box Teams already gives you, and that needs somewhere
 * to remember who you are talking to.
 *
 * ────────────────────────────────────────────────────────────────────────
 * EXPIRY LIVES IN `get`, NOT IN THE CALLER. This is the whole reason `get`
 * takes a clock.
 *
 * The dangerous failure of this feature is a message going somewhere the
 * sender did not intend — a private thought into a customer's tender
 * assessment. Stale focus is exactly that failure with a delay on it: you
 * replied to an agent this morning, you type something unrelated this
 * afternoon, and it goes to the agent.
 *
 * If expiry were a rule the ROUTER applied, every future reader of this store
 * would have to remember to apply it, and the one that forgot would get the
 * unsafe answer while looking correct. Here, a caller cannot obtain expired
 * focus at all — the only way to skip the check is to delete the parameter.
 *
 * It fails in the safe direction by construction: an expired binding reads as
 * "not focused", so the message falls through to the command path and gets a
 * help card. Cheap, visible, and recoverable. The opposite mistake is not.
 * ────────────────────────────────────────────────────────────────────────
 */
import { DurableJsonStore } from "../state/durable-json-store";

/**
 * THIRTY MINUTES, and the number is a judgement rather than a measurement —
 * recorded as one so nobody quotes it back as evidence.
 *
 * It trades two costs that pull opposite ways. Too short and the feature is
 * annoying: you read an agent's answer, think for ten minutes, reply, and
 * your reply silently becomes a help card. Too long and the window in which
 * an unrelated message can be misdirected stretches across a working day.
 *
 * Half an hour is roughly "the same sitting". Move it if real use disagrees;
 * what must not change is which way it fails.
 */
export const FOCUS_IDLE_MS = 30 * 60 * 1000;

/**
 * A STRUCTURAL SUPERSET of `cards.ts`'s `ChatRef` — `chatId` + `title` — so
 * it can be passed straight to any card builder without an adapter.
 *
 * It was `chatTitle` for one round and that cost an adapter function at every
 * call site, each of which is a place the two shapes could drift. The field
 * is the same fact under two names; one name is better.
 */
export interface FocusedChat {
  readonly chatId: string;
  /** For naming the target back at the user. Never a routing signal. */
  readonly title: string | null;
  /**
   * Last time this focus was USED, not when it was set.
   *
   * Refreshed on every message sent through it, so a live conversation does
   * not expire mid-flow. `setAt` would have expired someone thirty minutes
   * into an active exchange, which is the annoying failure with none of the
   * safety benefit — the risk is idleness, not duration.
   */
  readonly touchedAt: number;
}

/**
 * THREE OUTCOMES, and `expired` deliberately carries NO `chatId`.
 *
 * A bare `null` for both "never focused" and "focus went stale" would make
 * expiry silent: the message falls through to the command path, the user gets
 * a help card, and nothing says their message did not reach the agent. The
 * supervisor's requirement is that where the typing went is always obvious,
 * and "it went nowhere" is one of the things that has to be obvious.
 *
 * So the expired branch exists to be SAID, and it carries a title for that
 * and nothing else. Not a convenience: a caller holding a `chatId` from an
 * expired focus could route a message to it, which is the precise failure
 * expiry exists to prevent. Giving the expired branch no destination makes
 * that a type error rather than a discipline.
 */
export type FocusLookup =
  | { readonly kind: "focused"; readonly chat: FocusedChat }
  | { readonly kind: "expired"; readonly title: string | null }
  | { readonly kind: "none" };

export interface FocusedChatStore {
  get(conversationId: string, now: number): Promise<FocusLookup>;
  set(conversationId: string, chat: FocusedChat): Promise<void>;
  clear(conversationId: string): Promise<void>;
}

function isFresh(chat: FocusedChat, now: number): boolean {
  // `now - touchedAt` and NOT `Math.abs`: a clock that jumps backwards should
  // read as fresh, not as expired. Expiring on a backwards jump would drop
  // focus mid-conversation for a reason nobody could see.
  return now - chat.touchedAt < FOCUS_IDLE_MS;
}

export class InMemoryFocusedChatStore implements FocusedChatStore {
  private readonly focused = new Map<string, FocusedChat>();

  async get(conversationId: string, now: number): Promise<FocusLookup> {
    const chat = this.focused.get(conversationId);
    if (chat === undefined) return { kind: "none" };
    if (!isFresh(chat, now)) {
      // Dropped rather than merely hidden, so a later clock change cannot
      // resurrect a binding the user has already been told is gone.
      this.focused.delete(conversationId);
      return { kind: "expired", title: chat.title };
    }
    return { kind: "focused", chat };
  }

  async set(conversationId: string, chat: FocusedChat): Promise<void> {
    this.focused.set(conversationId, chat);
  }

  async clear(conversationId: string): Promise<void> {
    this.focused.delete(conversationId);
  }
}

/**
 * Survives a restart, because the alternative is worse than it looks.
 *
 * `epic-binding-store.ts` is in-memory and says so plainly, with a docblock
 * telling the next person not to let it "quietly become the persistence layer
 * by accretion". Losing an epic binding on restart costs one retyped command.
 * Losing focus is different in kind: the user has no way to tell that the bot
 * forgot, so their next message goes to the command path and renders a help
 * card. That is the safe direction, but it is also silent and confusing.
 *
 * The mechanism already exists — `DurableJsonStore`, the same one the
 * conversation-reference and proactive stores use — so persisting costs a
 * constructor rather than a design.
 */
export class DurableFocusedChatStore implements FocusedChatStore {
  private readonly store: DurableJsonStore<FocusedChat>;

  constructor(
    filePath: string,
    // Explicit `| undefined`, not `?:` — the repo's `no-restricted-syntax`
    // rule, and the same reasoning as `canSend`: a caller should have to say
    // it wants no warnings rather than get that by omission.
    onWarn: ((message: string, detail: string) => void) | undefined,
  ) {
    this.store = new DurableJsonStore<FocusedChat>({ filePath, onWarn });
  }

  // `DurableJsonStore.set`/`delete` write through synchronously; the async
  // signature is the STORE INTERFACE's, kept so a future backing store can be
  // genuinely async without every caller changing.
  async get(conversationId: string, now: number): Promise<FocusLookup> {
    const chat = this.store.get(conversationId);
    if (chat === null) return { kind: "none" };
    if (!isFresh(chat, now)) {
      this.store.delete(conversationId);
      return { kind: "expired", title: chat.title };
    }
    return { kind: "focused", chat };
  }

  async set(conversationId: string, chat: FocusedChat): Promise<void> {
    this.store.set(conversationId, chat);
  }

  async clear(conversationId: string): Promise<void> {
    this.store.delete(conversationId);
  }
}
