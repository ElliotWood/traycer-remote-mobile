import {
  ActivityHandler,
  MessageFactory,
  type TurnContext,
} from "@microsoft/agents-hosting";
import type {
  AdaptiveCardInvokeResponse,
  AdaptiveCardInvokeValue,
} from "@microsoft/agents-hosting";
import { parseCommand } from "./commands";
import { dispatchCommand, type DispatchDeps } from "./dispatch";
import { dispatchActionInvoke } from "./dispatch-action";
import { logInfo, logWarn } from "../logger";

/**
 * The activity handler — messages and card actions.
 *
 * Deliberately thin: everything decidable without a `TurnContext` lives in
 * `commands.ts` (parsing), `dispatch.ts` (reads) and `dispatch-action.ts`
 * (writes), all unit-tested. This file only adapts the SDK's turn to those,
 * so the part that's hard to test holds almost no logic.
 */
class ReadSurfaceHandler extends ActivityHandler {
  private readonly deps: DispatchDeps;

  constructor(deps: DispatchDeps) {
    super();
    this.deps = deps;
    this.onMessage(async (context, next) => {
      await this.handleMessage(context);
      await next();
    });
  }

  private async handleMessage(context: TurnContext): Promise<void> {
    const command = parseCommand(context.activity.text ?? "");
    const conversationId = context.activity.conversation?.id ?? "";

    if (conversationId === "") {
      logWarn("activity has no conversation id", { command: command.kind });
      await context.sendActivity(
        MessageFactory.text("Couldn't identify this conversation."),
      );
      return;
    }

    const cards = await dispatchCommand(command, conversationId, this.deps);
    // Logs the PARSED command kind and the reply size, never the message
    // text — the text can contain anything a user typed, including things
    // meant for an agent rather than for a log file.
    //
    // Added because a report of "one command produced two cards" could not
    // be confirmed or dismissed: nothing recorded which activities had
    // arrived, so there was no way to tell one command returning two cards
    // from two commands returning one each.
    logInfo("dispatched command", {
      command: command.kind,
      cards: cards.length,
    });
    for (const card of cards) {
      await context.sendActivity(MessageFactory.attachment(card));
    }
  }

  /**
   * `Action.Execute` from an approval card. Returns HTTP 200 with a fresh
   * card so Teams replaces the pressed card in place — that is the whole
   * point of Execute over Submit, and it is what stops a resolved approval
   * leaving live buttons behind.
   */
  protected async onAdaptiveCardInvoke(
    context: TurnContext,
    invokeValue: AdaptiveCardInvokeValue,
  ): Promise<AdaptiveCardInvokeResponse> {
    const conversationId = context.activity.conversation?.id ?? "";
    const verb = invokeValue.action?.verb ?? "";
    const data =
      (invokeValue.action?.data as Record<string, unknown> | undefined) ?? {};

    const result = await dispatchActionInvoke(
      { verb, conversationId, data },
      this.deps,
    );

    if (!result.acted) {
      logWarn("card action did not complete", { verb });
    }

    return {
      statusCode: 200,
      type: "application/vnd.microsoft.card.adaptive",
      value: asCardContent(result.card.content),
    };
  }
}

/**
 * `Attachment.content` is untyped at the SDK boundary; the invoke response
 * requires a `Record<string, unknown>`. Narrow it after a real runtime check
 * rather than asserting blindly — an empty object is a safe fallback that
 * Teams renders as an empty card instead of throwing.
 */
function asCardContent(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function createReadSurfaceHandler(deps: DispatchDeps): ActivityHandler {
  return new ReadSurfaceHandler(deps);
}
