import { CardFactory } from "@microsoft/agents-hosting";
import type { Attachment } from "@microsoft/agents-activity";
import type { RefusalReason } from "@traycer-clients/shared/identity-registry/types";
import type { AgentSummary, ChatStatus, EpicSummary } from "./bridge-types";
import type { BridgeCliFailureReason } from "./bridge-cli";

/**
 * Pure Adaptive Card builders — data in, card JSON out, no business logic,
 * no theming (Fluent comes from the Teams host; hand-styling would break
 * it, per the rubric). Schema 1.5, the widest currently well-supported
 * baseline that isn't tied to `Action.Execute` (this ticket doesn't use
 * actions at all — T3's scope).
 */

const ADAPTIVE_CARD_SCHEMA =
  "http://adaptivecards.io/schemas/adaptive-card.json";
const ADAPTIVE_CARD_VERSION = "1.5";

function card(body: readonly unknown[]): Attachment {
  return CardFactory.adaptiveCard({
    $schema: ADAPTIVE_CARD_SCHEMA,
    type: "AdaptiveCard",
    version: ADAPTIVE_CARD_VERSION,
    body,
  });
}

interface TextBlockOptions {
  readonly weight: "bolder" | "default";
  readonly wrap: boolean;
  readonly isSubtle: boolean;
}

const DEFAULT_TEXT_BLOCK_OPTIONS: TextBlockOptions = {
  weight: "default",
  wrap: true,
  isSubtle: false,
};

function textBlock(text: string, options: Partial<TextBlockOptions>): unknown {
  const resolved: TextBlockOptions = {
    ...DEFAULT_TEXT_BLOCK_OPTIONS,
    ...options,
  };
  return {
    type: "TextBlock",
    text,
    wrap: resolved.wrap,
    weight: resolved.weight,
    isSubtle: resolved.isSubtle,
  };
}

export function buildFleetCard(agents: readonly AgentSummary[]): Attachment {
  if (agents.length === 0) {
    return card([
      textBlock("Fleet", { weight: "bolder" }),
      textBlock("No agents in this epic yet.", { isSubtle: true }),
    ]);
  }
  const rows = agents.map((agent) => ({
    type: "ColumnSet",
    columns: [
      {
        type: "Column",
        width: "stretch",
        items: [
          textBlock(agent.title ?? agent.agentId, { weight: "bolder" }),
          textBlock(
            `${agent.harnessId ?? "unknown harness"} · ${agent.surface} · ${agent.active ? "active" : "idle"}`,
            { isSubtle: true },
          ),
        ],
      },
    ],
  }));
  return card([textBlock("Fleet", { weight: "bolder" }), ...rows]);
}

/**
 * CONTRACT, not an intention: when `status.connected` is `false`, every
 * other field is potentially stale (see `ChatStatus`'s own docblock in
 * `bridge-types.ts`) and MUST NOT be rendered as current. This function
 * takes that branch first and returns a visually and textually distinct
 * card — there is no code path here that can accidentally fall through to
 * the live-status rendering while disconnected.
 */
export function buildChatCard(status: ChatStatus): Attachment {
  if (!status.connected) {
    return card([
      textBlock(status.title ?? status.chatId, { weight: "bolder" }),
      textBlock("⚠ Host unreachable — the status below is not current.", {
        weight: "bolder",
      }),
    ]);
  }

  const summaryLine = `${status.runStatus} · ${status.pendingApprovals.length} pending approval(s) · ${status.pendingInterviews.length} pending interview(s)`;
  const body: unknown[] = [
    textBlock(status.title ?? status.chatId, { weight: "bolder" }),
    textBlock(summaryLine, { isSubtle: true }),
  ];

  for (const approval of status.pendingApprovals) {
    body.push(
      textBlock(
        `Pending approval: ${approval.toolName} — ${approval.description}`,
        {},
      ),
    );
  }
  for (const interview of status.pendingInterviews) {
    body.push(textBlock(`Pending interview (block ${interview.blockId})`, {}));
  }
  return card(body);
}

/**
 * No `Action.Execute` — T2 is read-only, and epic picking is a plain-text
 * flow (reply with the epic id) rather than a card button, so it doesn't
 * cross into T3's territory by accident.
 */
export function buildEpicPickerCard(epics: readonly EpicSummary[]): Attachment {
  if (epics.length === 0) {
    return card([
      textBlock("No epics found for your account.", { isSubtle: true }),
    ]);
  }
  const lines = epics.map((epic) =>
    textBlock(
      `${epic.title ?? epic.epicId} — reply "epic ${epic.epicId}" to select`,
      {},
    ),
  );
  return card([textBlock("Pick an epic", { weight: "bolder" }), ...lines]);
}

export function buildEpicNotBoundCard(): Attachment {
  return card([
    textBlock("No epic selected for this chat yet.", { weight: "bolder" }),
    textBlock(
      'Reply "epics" to see your epics, then "epic <id>" to select one.',
      { isSubtle: true },
    ),
  ]);
}

export function buildPrincipalRefusedCard(reason: RefusalReason): Attachment {
  return card([
    textBlock("Access denied.", { weight: "bolder" }),
    textBlock(
      `Your account isn't mapped to a Traycer host (${reason}). Contact your administrator.`,
      {
        isSubtle: true,
      },
    ),
  ]);
}

export function buildBridgeUnavailableCard(
  reason: BridgeCliFailureReason,
  detail: string,
): Attachment {
  return card([
    textBlock("Couldn't reach your Traycer host.", { weight: "bolder" }),
    textBlock(`${reason}: ${detail}`, { isSubtle: true }),
    textBlock("Try again in a moment.", { isSubtle: true }),
  ]);
}

export function buildHelpCard(): Attachment {
  return card([
    textBlock("Traycer Remote", { weight: "bolder" }),
    textBlock("epics — list your epics", {}),
    textBlock("epic <id> — select an epic for this chat", {}),
    textBlock("fleet — list agents in the selected epic", {}),
    textBlock("chat <id> — show one chat's status", {}),
  ]);
}

export function buildEpicBoundCard(epicId: string): Attachment {
  return card([
    textBlock("Epic selected.", { weight: "bolder" }),
    textBlock(`${epicId} — reply "fleet" to see its agents.`, {
      isSubtle: true,
    }),
  ]);
}

/**
 * Shown when no verified principal could be obtained for the turn. This is
 * a REFUSAL, not a degraded mode — see `principal-source.ts` for why an
 * unverified identity is never substituted here.
 */
export function buildIdentityUnavailableCard(reason: string): Attachment {
  return card([
    textBlock("Couldn't verify who you are.", { weight: "bolder" }),
    textBlock(reason, { isSubtle: true }),
  ]);
}
