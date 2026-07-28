/**
 * D3 — reference adapter proving {@link RemoteBridgeActions} is
 * implementable without touching the bridge's internals. No external
 * service, no network listener: `bridge watch` polls status on the agents
 * the bridge already knows about and prints pending approvals to stdout;
 * `bridge approve <id>` / `bridge reject <id>` act on one by approval id
 * (searched across every chat the bridge is currently tracking — the CLI's
 * only bridge-specific convenience beyond the plain {@link RemoteBridgeActions}
 * surface, kept out of that interface itself so a channel adapter with its
 * own chat-id context never needs it).
 */
import type { BridgeClient } from "../bridge-client";
import type { ILogger } from "../logger";

const WATCH_POLL_MS = 4_000;

export async function runList(
  bridge: BridgeClient,
  logger: ILogger,
): Promise<void> {
  const agents = await bridge.listAgents();
  process.stdout.write(`${JSON.stringify(agents, null, 2)}\n`);
  logger.info("listed agents", { count: agents.length });
}

export async function runStatus(
  bridge: BridgeClient,
  chatId: string,
): Promise<void> {
  const status = await bridge.getStatus(chatId);
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
}

export async function runApprove(
  bridge: BridgeClient,
  approvalId: string,
  logger: ILogger,
): Promise<void> {
  const chatId = await bridge.findChatForApproval(approvalId);
  if (chatId === null) {
    process.stderr.write(
      `[bridge] approval ${approvalId} is not currently pending on any tracked chat\n`,
    );
    process.exitCode = 1;
    return;
  }
  const outcome = await bridge.approve(chatId, approvalId);
  logger.info("approve outcome", { chatId, approvalId, outcome });
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
  if (outcome.kind !== "applied") process.exitCode = 1;
}

export async function runReject(
  bridge: BridgeClient,
  approvalId: string,
  reason: string | undefined,
  logger: ILogger,
): Promise<void> {
  const chatId = await bridge.findChatForApproval(approvalId);
  if (chatId === null) {
    process.stderr.write(
      `[bridge] approval ${approvalId} is not currently pending on any tracked chat\n`,
    );
    process.exitCode = 1;
    return;
  }
  const outcome = await bridge.reject(chatId, approvalId, reason);
  logger.info("reject outcome", { chatId, approvalId, outcome });
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
  if (outcome.kind !== "applied") process.exitCode = 1;
}

/** Long-running: prints every currently-pending approval/interview across tracked chats every `WATCH_POLL_MS`, until SIGINT/SIGTERM. */
export function runWatch(bridge: BridgeClient, logger: ILogger): Promise<void> {
  return new Promise<void>((resolve) => {
    let stopped = false;
    const cleanup = (): void => {
      if (stopped) return;
      stopped = true;
      process.off("SIGINT", cleanup);
      process.off("SIGTERM", cleanup);
      clearInterval(timer);
      resolve();
    };
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);

    const tick = async (): Promise<void> => {
      if (stopped) return;
      try {
        const agents = await bridge.listAgents();
        for (const agent of agents) {
          const status = await bridge.getStatus(agent.agentId);
          for (const approval of status.pendingApprovals) {
            process.stdout.write(
              `${JSON.stringify({
                chatId: agent.agentId,
                chatTitle: status.title,
                approvalId: approval.approvalId,
                toolName: approval.toolName,
                description: approval.description,
              })}\n`,
            );
          }
          for (const interview of status.pendingInterviews) {
            process.stdout.write(
              `${JSON.stringify({
                chatId: agent.agentId,
                chatTitle: status.title,
                interviewBlockId: interview.blockId,
              })}\n`,
            );
          }
        }
      } catch (err) {
        logger.warn("watch tick failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    const timer = setInterval(() => {
      void tick();
    }, WATCH_POLL_MS);
    void tick();
  });
}
