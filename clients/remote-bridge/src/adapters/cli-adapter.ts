/**
 * D3 — reference adapter proving {@link RemoteBridgeActions} is
 * implementable without touching the bridge's internals. No external
 * service, no network listener: `bridge watch` polls status on the agents
 * the bridge already knows about and prints a JSON line per CHANGE in what
 * is waiting on a human (see `watch-events.ts`);
 * `bridge approve <id>` / `bridge reject <id>` act on one by approval id
 * (searched across every chat the bridge is currently tracking — the CLI's
 * only bridge-specific convenience beyond the plain {@link RemoteBridgeActions}
 * surface, kept out of that interface itself so a channel adapter with its
 * own chat-id context never needs it).
 */
import { z } from "zod";
import { interviewAnswerSchema } from "@traycer/protocol/persistence/epic/content-blocks";
import type { BridgeClient, BridgePermissionMode } from "../bridge-client";
import type { ChatStatus } from "../action-surface";
import type { ILogger } from "../logger";
import { WatchEventTracker } from "./watch-events";

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
  reason: string | null,
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

/**
 * Answers a pending interview, addressed by chat id and block id.
 *
 * Takes an EXPLICIT `chatId` for the same reason `send` does: an approval id
 * is globally unique so `approve` can search for its chat, but a block id is
 * only unique within a chat's message list, so there is nothing safe to
 * search by. The destination has to be named.
 *
 * `answersJson` is parsed with the PROTOCOL'S OWN `interviewAnswerSchema`
 * rather than a shape defined here. A hand-rolled parse in this file would be
 * a second definition of a persisted protocol type living in an adapter, and
 * it would drift silently — the answers would still send, and the host would
 * store something subtly wrong. A parse failure is refused here, before any
 * frame is issued, because an interview can be answered exactly once.
 *
 * Retry semantics match `send`, not `approve`: the host settles this on the
 * interview leaving the pending set, so a repeat against an already-answered
 * interview fails with "not currently pending" rather than being deduped.
 * A non-`applied` outcome is "unknown", never "retry me".
 */
export async function runAnswer(
  bridge: BridgeClient,
  chatId: string,
  blockId: string,
  answersJson: string,
  logger: ILogger,
): Promise<void> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(answersJson);
  } catch (err) {
    process.stderr.write(
      `[bridge] --answers was not valid JSON: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
    return;
  }
  const parsed = z.array(interviewAnswerSchema).safeParse(parsedJson);
  if (!parsed.success) {
    process.stderr.write(
      `[bridge] --answers did not match InterviewAnswer[]: ${parsed.error.message}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const outcome = await bridge.answerInterview(chatId, blockId, parsed.data);
  logger.info("answer outcome", { chatId, blockId, outcome });
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
  if (outcome.kind !== "applied") process.exitCode = 1;
}

/**
 * Sends a message to a chat, addressed by chat id.
 *
 * Unlike `approve`/`reject` this takes an EXPLICIT `chatId` rather than
 * searching for one: an approval id is globally unique so finding its chat is
 * unambiguous, whereas "send this text" has no id to search by. A caller that
 * cannot name the destination does not have one.
 *
 * Note the asymmetry with approvals in the failure path: a repeated approval
 * is deduped by the host, so a retry is safe. A repeated SEND is not — it is
 * a second message the agent will act on. Callers must treat a non-`applied`
 * outcome as "unknown", not as "retry me".
 */
export async function runSend(
  bridge: BridgeClient,
  chatId: string,
  text: string,
  logger: ILogger,
  /** Only consulted for a chat with no settings yet — see `sendMessage`. */
  permissionMode?: BridgePermissionMode,
): Promise<void> {
  const outcome = await bridge.sendMessage(chatId, text, permissionMode);
  logger.info("send outcome", { chatId, outcome });
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
  if (outcome.kind !== "applied") process.exitCode = 1;
}

/**
 * A window of a chat's transcript as JSON.
 *
 * `offset` counts from the RECENT end, so `--offset 0` is the newest page.
 * Both bounds are validated here rather than trusted: they arrive from a
 * command line, and a negative or non-numeric offset would silently slice
 * from the wrong end via `Array.slice`'s negative-index behaviour.
 */
export async function runTranscript(
  bridge: BridgeClient,
  chatId: string,
  offset: number,
  limit: number,
): Promise<void> {
  if (!Number.isInteger(offset) || offset < 0) {
    process.stderr.write(`[bridge] --offset must be a non-negative integer\n`);
    process.exitCode = 1;
    return;
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    process.stderr.write(`[bridge] --limit must be a positive integer\n`);
    process.exitCode = 1;
    return;
  }
  const transcript = await bridge.getTranscript(chatId, offset, limit);
  process.stdout.write(`${JSON.stringify(transcript, null, 2)}\n`);
}

/**
 * Long-running: polls every tracked chat every `WATCH_POLL_MS` and prints one
 * {@link WatchEvent} JSON line per CHANGE — `appeared` when something starts
 * waiting on a human, `resolved` when it stops — until SIGINT/SIGTERM.
 *
 * It previously printed every pending approval on every tick, which made
 * "someone is newly blocked" and "someone is still blocked" the same line
 * fifteen times a minute. See `watch-events.ts` for why that distinction is
 * the bridge's to make and not a consumer's.
 *
 * ONE CHAT'S FAILURE MUST NOT BLIND THE OTHERS. `getStatus` is caught
 * per-chat rather than per-tick: a single unreadable chat used to abort the
 * whole sweep, so a genuinely new approval elsewhere went unannounced until
 * the bad chat recovered. The failed chat is OMITTED from the observation
 * set rather than passed as empty — {@link WatchEventTracker} treats absence
 * as unknown, and an empty status would read as "everything was answered".
 */
export function runWatch(
  bridge: BridgeClient,
  epicId: string,
  logger: ILogger,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let stopped = false;
    const tracker = new WatchEventTracker();
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
        const observed: ChatStatus[] = [];
        for (const agent of agents) {
          try {
            observed.push(await bridge.getStatus(agent.agentId));
          } catch (err) {
            logger.warn("watch: status unreadable, chat omitted this tick", {
              chatId: agent.agentId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        for (const event of tracker.diff(epicId, observed)) {
          process.stdout.write(`${JSON.stringify(event)}\n`);
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
