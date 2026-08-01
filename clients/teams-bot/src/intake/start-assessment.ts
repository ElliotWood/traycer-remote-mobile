/**
 * Composes the pieces R5 built into the thing the "Yes, go ahead" button
 * actually does.
 *
 * The order is the design, and it is the same order `dispatchAssessment`
 * documents: mint the id, RECORD THE CONVERSATION REFERENCE, create, send,
 * ack. The reference is written before anything that can fail, because this
 * turn is the only moment it exists and the case that matters is the
 * assessment that started and whose ack never arrived.
 *
 * WIRED HERE RATHER THAN IN THE HANDLER so there is one routing site for card
 * verbs. A verb handled in the handler would be invisible to the enumeration
 * test that walks cards against `dispatchActionInvoke` — the gate built to
 * catch exactly the defect this file is the last instance of.
 */
import { randomUUID } from "node:crypto";
import type { Attachment } from "@microsoft/agents-activity";
import { createChatAction } from "../read-surface/bridge-cli";
import type { BridgeCliConfig } from "../read-surface/bridge-cli";
import { sendMessageAction } from "../read-surface/bridge-cli";
import {
  buildAssessmentStartedCard,
  buildAssessmentUnconfirmedCard,
} from "../read-surface/cards";
import { chatDeepLink } from "./deep-link";
import { toStoredReference } from "../state/conversation-reference-store";
import type { ConversationReferenceStore } from "../state/conversation-reference-store";
import { buildInstruction, buildChatTitle } from "./dispatch-assessment";
import type { ProductId, IntentId } from "./classify";

export interface StartAssessmentConfig {
  readonly references: ConversationReferenceStore;
  readonly hostId: string;
  readonly epicId: string;
  readonly tabBaseUrl: string;
  readonly bridgeCliConfig: BridgeCliConfig;
  /** The tenant env for the acting principal — built by the caller. */
  readonly buildEnv: () => Promise<NodeJS.ProcessEnv | null>;
  readonly now: () => number;
}

export function createStartAssessment(config: StartAssessmentConfig) {
  return async (input: {
    readonly conversationId: string;
    readonly skill: string;
    readonly product: string;
    readonly intent: string;
    readonly conversationReference: unknown;
    /** The words the person used. Carried verbatim into the instruction. */
    readonly spokenText?: string;
    readonly attachmentCount?: number;
  }): Promise<{ readonly kind: "started" | "unconfirmed"; readonly card: Attachment }> => {
    // STEP 1 — minted ONCE, before anything can fail, and reused on retry.
    // `epic.createChat` is idempotent on it, so a repeat cannot make a second
    // agent. Minting per attempt would look identical here and would.
    const chatId = randomUUID();

    // STEP 2 — before the create. Unrecoverable afterwards.
    const stored = toStoredReference(input.conversationReference, config.now());
    if (stored === null) {
      // Refuse rather than start work we cannot report on: an assessment
      // whose result has nowhere to go spends agent time on a customer
      // document and produces something nobody receives.
      return {
        kind: "unconfirmed",
        card: buildAssessmentUnconfirmedCard(
          "I couldn't record where to send the result.",
          // CERTAIN: we refused before creating anything, so this path knows.
          { certain: true },
        ),
      };
    }
    config.references.remember(chatId, stored);

    const env = await config.buildEnv();
    if (env === null) {
      return {
        kind: "unconfirmed",
        card: buildAssessmentUnconfirmedCard(
          "I couldn't verify who you are.",
          { certain: true },
        ),
      };
    }

    const route = {
      product: input.product as ProductId,
      intent: input.intent as IntentId,
      skill: input.skill,
    };
    const spoken = input.spokenText ?? "";
    const title = buildChatTitle(route, spoken);

    const created = await createChatAction(
      { chatId, title, hostId: config.hostId },
      env,
      config.bridgeCliConfig,
    );
    if (created.kind !== "ok") {
      // The reference is deliberately KEPT — a retry reuses the same id and
      // the same reply target.
      return {
        kind: "unconfirmed",
        card: buildAssessmentUnconfirmedCard(created.detail),
      };
    }

    const sent = await sendMessageAction(
      created.value.chatId,
      buildInstruction(route, spoken, input.attachmentCount ?? 0),
      env,
      config.bridgeCliConfig,
    );
    if (sent.kind !== "ok") {
      // The chat EXISTS and is empty. Say that rather than implying nothing
      // happened — "it started" would be wrong and "nothing happened" would
      // leave an orphan the user never hears about again.
      return {
        kind: "unconfirmed",
        card: buildAssessmentUnconfirmedCard(
          `The agent was created but I couldn't give it the request: ${sent.detail}`,
        ),
      };
    }

    return {
      kind: "started",
      card: buildAssessmentStartedCard({
        title,
        deepLink: chatDeepLink(
          { tabBaseUrl: config.tabBaseUrl },
          config.epicId,
          created.value.chatId,
        ),
      }),
    };
  };
}
