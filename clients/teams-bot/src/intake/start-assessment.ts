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
import type { IntakeFile, IntakeStore } from "./intake-store";
import { logInfo, logWarn } from "../logger";

export interface StartAssessmentConfig {
  readonly references: ConversationReferenceStore;
  readonly hostId: string;
  readonly epicId: string;
  readonly tabBaseUrl: string;
  readonly bridgeCliConfig: BridgeCliConfig;
  /** The tenant env for the acting principal — built by the caller. */
  readonly buildEnv: () => Promise<NodeJS.ProcessEnv | null>;
  /**
   * Where the documents fetched on the MESSAGE turn were put.
   *
   * Optional: a deployment without an intake directory still starts
   * assessments, and the instruction honestly says no documents were
   * attached. Absent is a configuration, not a failure.
   */
  readonly intake?: IntakeStore;
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
    /**
     * Opaque handle to the documents fetched on the message turn.
     *
     * This is what the card carries INSTEAD OF the download URL, and the
     * substitution is the design. A Teams `downloadUrl` is a bearer
     * capability for a customer's document; putting it in a card payload
     * would relay it through Bot Service and back through an ingress we do
     * not own. It is also short-lived, so a card pressed twenty minutes
     * later would carry a dead one. A UUID naming a local directory has
     * neither problem.
     */
    readonly intakeId?: string;
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

    /*
     * Resolve the documents BEFORE the chat is created.
     *
     * A record that cannot be found is REPORTED, not defaulted to "no
     * documents". That distinction is the entire bug being fixed: the old
     * code's `?? 0` turned every missing value into a confident claim that
     * nothing was attached, and the skill believed it. An intake id that was
     * issued and cannot be read means we lost a file the user sent, and the
     * only honest thing to do is refuse rather than start an assessment that
     * will silently answer without it.
     */
    let attachments: {
      files: readonly IntakeFile[];
      unavailable: readonly { name: string; reason: string }[];
    } = { files: [], unavailable: [] };
    if (input.intakeId !== undefined && input.intakeId.length > 0) {
      const record = config.intake?.get(input.intakeId) ?? null;
      if (record === null) {
        logWarn("intake record could not be read for a confirmed route", {
          hasStore: config.intake !== undefined,
        });
        return {
          kind: "unconfirmed",
          card: buildAssessmentUnconfirmedCard(
            "I couldn't find the file you attached any more, so I haven't started — send it again and I'll pick it up.",
            // CERTAIN: nothing was created. We refused before the create.
            { certain: true },
          ),
        };
      }
      attachments = {
        files: record.files,
        unavailable: record.unavailable.map((entry) => ({ ...entry })),
      };
      logInfo("assessment starting with documents", {
        files: record.files.length,
        unavailable: record.unavailable.length,
      });
    }

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
        card: buildAssessmentUnconfirmedCard(created.detail, undefined),
      };
    }

    const sent = await sendMessageAction(
      created.value.chatId,
      buildInstruction(route, spoken, attachments),
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
          undefined,
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
