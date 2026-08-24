/**
 * R3 — where a conversation lives, so the bot can reply to it later.
 *
 * The use case is an assessment that takes minutes or hours: someone drops an
 * RFI into Teams, we acknowledge immediately, and the answer arrives long
 * after the turn that asked for it has ended. Bot Framework can only send
 * into a conversation it holds a `ConversationReference` for, and that
 * reference must therefore outlive both the turn AND the process — we
 * redeploy this bot by swapping a bundle and restarting it, and an assessment
 * in flight must survive that.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS STORE IS FOR ROUTING. IT IS NOT AN IDENTITY OR AUTHORISATION SOURCE.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A `ConversationReference` contains `user.aadObjectId`, and this project has
 * a standing rule that `activity.from.aadObjectId` is FORBIDDEN as an
 * identity source — it is attacker-controllable in the shapes we accept, and
 * the identity registry exists precisely so that identity comes from a
 * verified principal instead.
 *
 * Storing it here does not launder it. The reference answers exactly one
 * question — "where do I send this reply" — and every authorisation decision
 * must still go through `resolveTenant` on a verified principal, on the turn
 * that acts. If you ever find yourself reading `.user.aadObjectId` out of
 * this store to decide what someone may do, that is the bug this paragraph
 * exists to prevent.
 *
 * Keyed by WORK ID, not by conversation. One conversation can start several
 * assessments and each needs its own reply target; keying by conversation
 * would make the second overwrite the first, and the failure would look like
 * "the bot forgot" rather than a key collision.
 */
import { DurableJsonStore } from "./durable-json-store";

/**
 * The subset of `ConversationReference` we persist.
 *
 * Deliberately structural rather than importing the SDK type: this is what
 * gets written to disk, and a store whose on-disk shape silently tracks a
 * dependency's type is a store that breaks on an SDK upgrade with no
 * compile error. Widening this is a decision, not an accident.
 */
export interface StoredConversationReference {
  readonly channelId: string;
  readonly serviceUrl: string;
  readonly conversation: {
    readonly id: string;
    readonly conversationType?: string;
  };
  readonly bot: { readonly id: string; readonly name?: string };
  /** Present for routing only — see the docblock. Never an identity source. */
  readonly user?: { readonly id: string; readonly aadObjectId?: string };
  readonly tenantId?: string;
  /** When this reference was captured, so stale entries can be reaped. */
  readonly capturedAt: number;
}

export interface ConversationReferenceStore {
  /** Captured at intake, before any long-running work starts. */
  remember(workId: string, reference: StoredConversationReference): void;
  /** `null` when we have no way to reach that conversation any more. */
  recall(workId: string): StoredConversationReference | null;
  /** Called once the reply has been delivered. */
  forget(workId: string): void;
  /** Work ids we still hold a reply target for. */
  outstanding(): readonly string[];
}

export class DurableConversationReferenceStore implements ConversationReferenceStore {
  private readonly store: DurableJsonStore<StoredConversationReference>;

  constructor(
    filePath: string,
    onWarn: ((message: string, detail: string) => void) | undefined,
  ) {
    this.store = new DurableJsonStore<StoredConversationReference>({
      filePath,
      onWarn,
    });
  }

  remember(workId: string, reference: StoredConversationReference): void {
    this.store.set(workId, reference);
  }

  recall(workId: string): StoredConversationReference | null {
    return this.store.get(workId);
  }

  forget(workId: string): void {
    this.store.delete(workId);
  }

  outstanding(): readonly string[] {
    return this.store.keys();
  }
}

/**
 * Extracts what we persist from a Bot Framework conversation reference.
 *
 * Takes an unknown rather than the SDK type so the shape check is real: an
 * SDK that stops providing `serviceUrl` should fail HERE, loudly, at capture
 * time — not hours later when the reply cannot be sent and the work is
 * already done.
 */
export function toStoredReference(
  reference: unknown,
  capturedAt: number,
): StoredConversationReference | null {
  if (reference === null || typeof reference !== "object") return null;
  const r = reference as Record<string, unknown>;
  const conversation = r["conversation"];
  /*
   * `agent` FIRST, `bot` as the fallback — and this cost a live failure.
   *
   * This required `bot.id` and returned null for every real reference,
   * because `@microsoft/agents-activity` returns
   * `{ activityId, user, AGENT, conversation, channelId, locale, serviceUrl }`.
   * The SDK renamed Bot Framework v4's `bot` to `agent`; I carried the old
   * name in from the documentation I had read.
   *
   * The symptom was maximally misleading: the refusal path worked perfectly
   * and told Elliot it could not record where to send the result — a correct
   * message about a real absence, caused by looking for the wrong key. The
   * check was true about a neighbouring field name.
   *
   * Both are accepted because the stored shape must survive an SDK that
   * renames it back, and a reference written under one name and read under
   * the other is unrecoverable after the fact.
   */
  const bot = r["agent"] ?? r["bot"];
  if (
    typeof r["channelId"] !== "string" ||
    typeof r["serviceUrl"] !== "string" ||
    conversation === null ||
    typeof conversation !== "object" ||
    typeof (conversation as Record<string, unknown>)["id"] !== "string" ||
    bot === null ||
    typeof bot !== "object" ||
    typeof (bot as Record<string, unknown>)["id"] !== "string"
  ) {
    return null;
  }
  const conv = conversation as Record<string, unknown>;
  const botRef = bot as Record<string, unknown>;
  const user = r["user"];
  const userRef =
    user !== null && typeof user === "object"
      ? (user as Record<string, unknown>)
      : null;
  return {
    channelId: r["channelId"],
    serviceUrl: r["serviceUrl"],
    conversation: {
      id: conv["id"] as string,
      ...(typeof conv["conversationType"] === "string"
        ? { conversationType: conv["conversationType"] }
        : {}),
    },
    bot: {
      id: botRef["id"] as string,
      ...(typeof botRef["name"] === "string" ? { name: botRef["name"] } : {}),
    },
    ...(userRef !== null && typeof userRef["id"] === "string"
      ? {
          user: {
            id: userRef["id"],
            ...(typeof userRef["aadObjectId"] === "string"
              ? { aadObjectId: userRef["aadObjectId"] }
              : {}),
          },
        }
      : {}),
    /*
     * FOUND BY THE SWEEP, same source as the `bot`/`agent` defect: this read
     * `r["tenantId"]`, and the SDK's reference has no top-level `tenantId`.
     * It returns
     *   { activityId, user, agent, conversation, channelId, locale, serviceUrl }
     * and Teams carries the tenant on the CONVERSATION.
     *
     * So this was always `undefined`, and — being optional — degraded
     * silently. The same soft-fail shape as the field that cost a live
     * failure: nothing throws, nothing logs, the value is simply never there.
     * Both came from reading v4 documentation rather than the installed
     * package's types.
     */
    ...(typeof conv["tenantId"] === "string"
      ? { tenantId: conv["tenantId"] }
      : {}),
    capturedAt,
  };
}
