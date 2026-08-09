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
import type { OpportunityDetails } from "./intake-form";

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
 * The documents, as the agent can actually reach them.
 *
 * `directory` is an ABSOLUTE path on the same machine the agent runs on, and
 * it is the whole of G2: the previous version of this file said "2 documents
 * attached" and gave no path, so an agent asked to assess a tender had no way
 * to open one.
 */
export interface StagedDocuments {
  readonly directory: string;
  readonly names: readonly string[];
}

/**
 * The first message, which is what actually invokes the skill.
 *
 * WHAT IT CARRIES, AND WHY EACH PART IS THERE:
 *
 *   the skill name        routing — `classify` decided this, nothing else
 *   the five fields       `new-bid.mjs` refuses without them
 *   the requester's words VERBATIM. The classifier decided the route; it did
 *                         not decide what they meant, and the skill should
 *                         read the question rather than our summary of it
 *   the staging path      where the bytes are
 *   the boundary          what this bot will not do, stated to the agent
 *
 * IT DOES NOT SAY WHERE THE DOCUMENTS BELONG. The skill's own SKILL.md tells
 * the agent to run `new-bid.mjs` and land them under the bid's source
 * directory "exactly as supplied". Repeating that layout here would couple
 * the bot to a path the pipeline owns and revalidates, and it would break
 * silently the first time the pipeline reorganises.
 */
export function buildInstruction(
  route: SkillRoute,
  spokenText: string,
  opportunity: OpportunityDetails,
  documents: StagedDocuments | null,
): string {
  const skill = route.skill ?? "(no skill configured for this route)";
  const files =
    documents === null
      ? ["No documents were attached to the request."]
      : [
          `The attached documents are staged on this machine at:\n${documents.directory}`,
          "",
          ...documents.names.map((name) => `  - ${name}`),
          "",
          "Take them from there exactly as supplied — do not rename them.",
        ];
  return [
    `Use the ${skill} skill.`,
    "",
    "New opportunity intake, captured in Microsoft Teams. These are the fields",
    "`new-bid.mjs` requires; they were entered and confirmed by a person:",
    "",
    `  slug:         ${opportunity.slug}`,
    `  buyer:        ${opportunity.buyer}`,
    `  deadline:     ${opportunity.deadline}`,
    `  jurisdiction: ${opportunity.jurisdiction}`,
    `  owner:        ${opportunity.owner}`,
    "",
    "The request, in the requester's own words:",
    spokenText,
    "",
    ...files,
    "",
    // THE BOUNDARY, stated to the agent as well as on the card. Teams is
    // intake-only: it starts assessments and delivers review copies. The
    // go/no-go decision, authorising a claim for a customer, and lodgement
    // all stay with a named human in the repo.
    "This request came from Teams, which is intake-only. Deciding go/no-go,",
    "authorising claims, and lodging are a named human's, in the repo — do not",
    "treat a Teams request as authority for any of them.",
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
    /** The five fields, already validated — see `./intake-form`. */
    readonly opportunity: OpportunityDetails;
    /** Where the staged documents are, or `null` when none were attached. */
    readonly documents: StagedDocuments | null;
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
      buildInstruction(
        input.route,
        input.spokenText,
        input.opportunity,
        input.documents,
      ),
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
