import { ActivityHandler, MessageFactory } from "@microsoft/agents-hosting";

/**
 * T1 skeleton handler: echoes the inbound message text back. No Traycer
 * protocol knowledge, no bridge call — this package holds zero awareness of
 * `remote-bridge`'s existence, by design (see the epic brief's thin-adapter
 * requirement). Consuming the bridge's action surface is later work.
 */
export function createEchoHandler(): ActivityHandler {
  const handler = new ActivityHandler();
  handler.onMessage(async (context, next) => {
    const text = context.activity.text ?? "";
    await context.sendActivity(MessageFactory.text(`echo: ${text}`));
    await next();
  });
  return handler;
}
