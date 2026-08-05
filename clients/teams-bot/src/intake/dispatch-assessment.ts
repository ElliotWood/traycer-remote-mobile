/**
 * R5 — turn a confirmed route into a running agent, and tell the user where
 * to watch it.
 *
 * ORDER IS THE DESIGN HERE, not an implementation detail:
 *
 *   1. mint the chat id
 *   2. RECORD THE CONVERSATION REFERENCE
 *   3. create the chat
 *   4. send the instruction
 *   5. ack with a deep link
 *
 * The reference is recorded at step 2, BEFORE anything that can fail. It is
 * how the completion reply finds its way back hours later, and it is
 * unrecoverable if not captured on this turn — the turn that asked is the
 * only moment we hold it. Recording it after a successful create would lose
 * exactly the case that matters: the assessment that started and whose ack
 * never arrived.
 *
 * The id is minted ONCE, at step 1, and reused across retries. `epic.createChat`
 * is idempotent on a client-supplied `chatId`, so a retry either finds the chat
 * or makes it — but only if the id is fixed. Minting per attempt looks
 * identical here and quietly creates two agents.
 */
import {
  toStoredReference,
  type ConversationReferenceStore,
} from "../state/conversation-reference-store";
import type { SkillRoute } from "./classify";
import type { IntakeFile } from "./intake-store";

export interface DispatchDeps {
  /** Bridge `create-chat`. Idempotent on `chatId`. */
  readonly createChat: (input: {
    readonly chatId: string;
    readonly title: string;
  }) => Promise<{ readonly chatId: string }>;
  /** Bridge `send`. Starts the turn that runs the skill. */
  readonly sendMessage: (chatId: string, text: string) => Promise<void>;
  readonly references: ConversationReferenceStore;
  /** Minted once per attempt SEQUENCE by the caller — never per attempt. */
  readonly chatId: string;
  readonly now: number;
}

export type DispatchOutcome =
  | { readonly kind: "started"; readonly chatId: string }
  /**
   * UNCONFIRMED, and — unlike an artifact create — SAFE TO RETRY. The chat id
   * was minted before the first attempt and the host dedupes on it, so
   * pressing again cannot produce a second agent. The card must say that
   * rather than sending someone to go and look; the sibling case
   * (`createArtifact`) has the opposite answer and the same appearance.
   */
  | { readonly kind: "unconfirmed"; readonly reason: string };

/**
 * The first message, which is what actually invokes the skill.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IT NAMES PATHS, NOT A COUNT.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * This took `attachmentCount: number` and rendered "2 documents attached to
 * the request." An agent reading that has been told a document exists and
 * given no way whatsoever to open it, so the best it can do is answer from
 * the request text and hope — which is indistinguishable, in the transcript,
 * from an assessment that read the document and disagreed with it.
 *
 * Two defects met there. The count was also always `0`, because the confirm
 * card's payload never carried one, so `?? 0` in `start-assessment.ts` won
 * every time and the skill was told "No documents were attached" about
 * documents that had arrived. Fixing only the drop would have produced a
 * correct number attached to nothing openable.
 *
 * So the instruction carries ABSOLUTE PATHS. The bot and the host run on the
 * same box as the same user (`deploy/vm-deploy.sh`, `User=traycer`), so a
 * path here is a path the agent can open — see `intake-store.ts` for why
 * that, rather than any kind of URL, is the transport.
 */
export function buildInstruction(
  route: SkillRoute,
  spokenText: string,
  attachments: {
    readonly files: readonly IntakeFile[];
    /** Files that arrived and could not be fetched. Named, never hidden. */
    readonly unavailable?: readonly { readonly name: string; readonly reason: string }[];
  },
): string {
  const skill = route.skill ?? "(no skill configured for this route)";
  const unavailable = attachments.unavailable ?? [];

  const documents: string[] = [];
  if (attachments.files.length === 0) {
    documents.push("No documents were attached.");
  } else {
    documents.push(
      `${String(attachments.files.length)} document${attachments.files.length === 1 ? " was" : "s were"} attached. Read ${attachments.files.length === 1 ? "it" : "them"} before answering:`,
    );
    for (const file of attachments.files) {
      documents.push(`- ${file.name} — ${file.path}`);
    }
  }
  if (unavailable.length > 0) {
    // TOLD, not omitted. An agent that knows a document exists and cannot be
    // read can say so; one that was never told will answer as though the
    // request had no attachment, and nobody downstream can tell the
    // difference.
    documents.push("");
    documents.push(
      "These were attached but could not be retrieved — say so rather than answering as if they did not exist:",
    );
    for (const file of unavailable) {
      documents.push(`- ${file.name} (${file.reason})`);
    }
  }

  // The user's own words are included VERBATIM and marked as theirs. The
  // classifier decided the route; it did not decide what they meant, and the
  // skill should read the question rather than our summary of it.
  return [
    `Use the ${skill} skill.`,
    "",
    "The request, in the requester's own words:",
    spokenText,
    "",
    ...documents,
  ].join("\n");
}

/** A short, human title. The chat is a thing someone will scan in a list. */
export function buildChatTitle(route: SkillRoute, spokenText: string): string {
  const first = spokenText.split("\n")[0]?.trim() ?? "";
  const trimmed = first.length > 60 ? `${first.slice(0, 59).trimEnd()}…` : first;
  if (trimmed.length > 0) return trimmed;
  // Never an empty title: the host accepts one and the agent stays unnamed
  // for life.
  return `${route.product} — ${route.intent}`;
}

export async function dispatchAssessment(
  deps: DispatchDeps,
  input: {
    readonly route: SkillRoute;
    readonly spokenText: string;
    /** Documents already fetched and on disk. See {@link buildInstruction}. */
    readonly attachments: {
      readonly files: readonly IntakeFile[];
      readonly unavailable?: readonly {
        readonly name: string;
        readonly reason: string;
      }[];
    };
    /** Raw Bot Framework conversation reference for this turn. */
    readonly conversationReference: unknown;
  },
): Promise<DispatchOutcome> {
  // STEP 2 — before anything that can fail. See the docblock.
  const stored = toStoredReference(input.conversationReference, deps.now);
  if (stored === null) {
    // Refuse rather than start work we cannot report on. An assessment whose
    // result has nowhere to go is worse than one that never began: it spends
    // agent time and produces a document nobody receives.
    return {
      kind: "unconfirmed",
      reason: "no usable conversation reference — cannot reply later",
    };
  }
  deps.references.remember(deps.chatId, stored);

  try {
    const created = await deps.createChat({
      chatId: deps.chatId,
      title: buildChatTitle(input.route, input.spokenText),
    });
    await deps.sendMessage(
      created.chatId,
      buildInstruction(input.route, input.spokenText, input.attachments),
    );
    return { kind: "started", chatId: created.chatId };
  } catch (error) {
    // The reference is deliberately KEPT. A retry reuses the same chat id and
    // the same reply target; forgetting here would strand a chat that may
    // well have been created.
    return {
      kind: "unconfirmed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
