import { ActivityHandler, MessageFactory } from "@microsoft/agents-hosting";
import { parseCommand } from "./commands";
import { dispatchCommand, type DispatchDeps } from "./dispatch";
import { logWarn } from "../logger";

/**
 * The read-only activity handler — replaced the T1 echo handler.
 *
 * Deliberately thin: everything that can be decided without a
 * `TurnContext` lives in `commands.ts` (parsing) and `dispatch.ts`
 * (routing, identity gating, card selection), both fully unit-tested. This
 * file only adapts the SDK's turn to those, so the part that's hard to
 * test is the part with almost no logic in it.
 */
export function createReadSurfaceHandler(deps: DispatchDeps): ActivityHandler {
  const handler = new ActivityHandler();
  handler.onMessage(async (context, next) => {
    const command = parseCommand(context.activity.text ?? "");
    const conversationId = context.activity.conversation?.id ?? "";

    if (conversationId === "") {
      // No conversation id means no epic binding is possible and nothing
      // can be scoped correctly — refuse rather than guessing a key.
      logWarn("activity has no conversation id", { command: command.kind });
      await context.sendActivity(
        MessageFactory.text("Couldn't identify this conversation."),
      );
      await next();
      return;
    }

    const card = await dispatchCommand(command, conversationId, deps);
    await context.sendActivity(MessageFactory.attachment(card));
    await next();
  });
  return handler;
}
