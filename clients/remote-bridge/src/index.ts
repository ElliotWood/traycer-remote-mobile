#!/usr/bin/env node
/**
 * `traycer-remote-bridge` — headless Node client + D3 CLI reference adapter.
 * stdout carries only command payloads; every diagnostic goes to stderr
 * (see `logger.ts`) so a future channel adapter piping this process's
 * output never has protocol noise mixed in.
 */
import { Command } from "commander";
import {
  BridgeClient,
  BRIDGE_PERMISSION_MODES,
  type BridgePermissionMode,
} from "./bridge-client";
import { createLogger } from "./logger";
import { checkDeleteTarget } from "./delete-guard";
import {
  runAnswer,
  runApprove,
  runList,
  runReject,
  runSend,
  runTranscript,
  runStatus,
  runWatch,
} from "./adapters/cli-adapter";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    process.stderr.write(
      `[bridge] ${name} is required (env var or --epic-id/--sender-agent-id)\n`,
    );
    process.exit(1);
  }
  return value;
}

async function withBridge<T>(
  opts: { epicId?: string; senderAgentId?: string },
  run: (bridge: BridgeClient) => Promise<T>,
): Promise<T> {
  const logger = createLogger(
    process.env.TRAYCER_BRIDGE_LOG_LEVEL === "debug" ? "debug" : "info",
  );
  const epicId = opts.epicId ?? requireEnv("TRAYCER_EPIC_ID");
  const senderAgentId = opts.senderAgentId ?? requireEnv("TRAYCER_AGENT_ID");
  const bridge = await BridgeClient.start({ epicId, senderAgentId, logger });

  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    process.off("SIGINT", cleanup);
    process.off("SIGTERM", cleanup);
    bridge.close();
  };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);

  try {
    return await run(bridge);
  } finally {
    cleanup();
  }
}

const program = new Command();
program
  .name("traycer-remote-bridge")
  .description(
    "Headless Node client speaking the Traycer host RPC protocol, with a channel-agnostic action surface any messaging adapter can build on.",
  );

program
  .command("list")
  .description("List agents visible in the epic")
  .option("--epic-id <id>", "Epic id (defaults to $TRAYCER_EPIC_ID)")
  .option(
    "--sender-agent-id <id>",
    "Sender agent id (defaults to $TRAYCER_AGENT_ID)",
  )
  .action(async (opts: { epicId?: string; senderAgentId?: string }) => {
    const logger = createLogger("info");
    await withBridge(opts, (bridge) => runList(bridge, logger));
  });

program
  .command("status <chatId>")
  .description("Print the live status of one chat")
  .option("--epic-id <id>", "Epic id (defaults to $TRAYCER_EPIC_ID)")
  .option(
    "--sender-agent-id <id>",
    "Sender agent id (defaults to $TRAYCER_AGENT_ID)",
  )
  .action(
    async (
      chatId: string,
      opts: { epicId?: string; senderAgentId?: string },
    ) => {
      await withBridge(opts, (bridge) => runStatus(bridge, chatId));
    },
  );

program
  .command("approve <approvalId>")
  .description("Approve a pending approval by id")
  .option("--epic-id <id>", "Epic id (defaults to $TRAYCER_EPIC_ID)")
  .option(
    "--sender-agent-id <id>",
    "Sender agent id (defaults to $TRAYCER_AGENT_ID)",
  )
  .action(
    async (
      approvalId: string,
      opts: { epicId?: string; senderAgentId?: string },
    ) => {
      const logger = createLogger("info");
      await withBridge(opts, (bridge) =>
        runApprove(bridge, approvalId, logger),
      );
    },
  );

program
  .command("reject <approvalId> [reason]")
  .description("Reject a pending approval by id")
  .option("--epic-id <id>", "Epic id (defaults to $TRAYCER_EPIC_ID)")
  .option(
    "--sender-agent-id <id>",
    "Sender agent id (defaults to $TRAYCER_AGENT_ID)",
  )
  .action(
    async (
      approvalId: string,
      reason: string | undefined,
      opts: { epicId?: string; senderAgentId?: string },
    ) => {
      const logger = createLogger("info");
      // commander's optional positional arg is `string | undefined` at
      // this framework boundary; converted to `string | null` here so it
      // can cross into `runReject`/`RemoteBridgeActions.reject`, which use
      // `| null` throughout (this repo bans optional parameters).
      await withBridge(opts, (bridge) =>
        runReject(bridge, approvalId, reason ?? null, logger),
      );
    },
  );

program
  .command("send <chatId> <text>")
  .description("Send a message to a chat")
  .option("--epic-id <id>", "Epic id (defaults to $TRAYCER_EPIC_ID)")
  .option(
    "--sender-agent-id <id>",
    "Sender agent id (defaults to $TRAYCER_AGENT_ID)",
  )
  /**
   * The mode a chat is BROUGHT TO LIFE in, not a per-message flag: it is only
   * consulted for a chat that has no settings yet, which in practice is the
   * first send after `create-chat`.
   *
   * It exists because `supervised` — correct for a chat someone is sitting in
   * front of — silently strands one nobody is watching. An assessment
   * dispatched from Teams stops at its first tool call and waits for a tap
   * from a person who has been told to come back later, and (until the
   * completion reply is wired) is never told it stopped.
   *
   * Validated against the list rather than passed through: an unrecognised
   * mode would otherwise reach the host inside a settings tuple and be
   * rejected there, or worse accepted and ignored.
   */
  .option(
    "--permission-mode <mode>",
    `Run mode for a chat with no settings yet (${BRIDGE_PERMISSION_MODES.join(" | ")})`,
  )
  .action(
    async (
      chatId: string,
      text: string,
      opts: {
        epicId?: string;
        senderAgentId?: string;
        permissionMode?: string;
      },
    ) => {
      const logger = createLogger("info");
      const mode = opts.permissionMode;
      if (
        mode !== undefined &&
        !BRIDGE_PERMISSION_MODES.includes(mode as BridgePermissionMode)
      ) {
        process.stderr.write(
          `[bridge] --permission-mode must be one of: ${BRIDGE_PERMISSION_MODES.join(", ")}
`,
        );
        process.exitCode = 1;
        return;
      }
      await withBridge(opts, (bridge) =>
        runSend(bridge, chatId, text, logger, mode as BridgePermissionMode | undefined),
      );
    },
  );

program
  .command("answer <chatId> <blockId> <answersJson>")
  .description(
    "Answer a pending interview. <answersJson> is a JSON array of " +
      '{questionId, question, values, notes} — e.g. \'[{"questionId":"q1","question":null,"values":["Yes"],"notes":null}]\'. ' +
      "Run `status <chatId>` first: its pendingInterviews now carry the questions.",
  )
  .option("--epic-id <id>", "Epic id (defaults to $TRAYCER_EPIC_ID)")
  .option(
    "--sender-agent-id <id>",
    "Sender agent id (defaults to $TRAYCER_AGENT_ID)",
  )
  .action(
    async (
      chatId: string,
      blockId: string,
      answersJson: string,
      opts: { epicId?: string; senderAgentId?: string },
    ) => {
      const logger = createLogger("info");
      await withBridge(opts, (bridge) =>
        runAnswer(bridge, chatId, blockId, answersJson, logger),
      );
    },
  );

program
  /**
   * `chatId` is a REQUIRED ARGUMENT, not generated here, and that is the
   * whole safety property rather than an inconvenience.
   *
   * The host resolver is idempotent on this id, so a caller that does not
   * hear back re-runs the identical command and either finds the chat or
   * makes it. Generating the id inside this process would destroy that: every
   * retry would mint a new one and quietly create a second agent, and it
   * would look identical from the outside.
   *
   * So the caller owns the id, mints it once, and reuses it. See
   * `action-surface.ts`.
   */
  .command("create-chat <chatId> <title>")
  .description("Create a new agent (chat) in the epic. Idempotent on chatId.")
  .requiredOption("--host-id <id>", "Host the chat is bound to FOR LIFE")
  .option("--parent-id <id>", "Parent chat id, for a sub-agent")
  .option("--epic-id <id>", "Epic id (defaults to $TRAYCER_EPIC_ID)")
  .option(
    "--sender-agent-id <id>",
    "Sender agent id (defaults to $TRAYCER_AGENT_ID)",
  )
  .action(
    async (
      chatId: string,
      title: string,
      opts: {
        hostId: string;
        parentId?: string;
        epicId?: string;
        senderAgentId?: string;
      },
    ) => {
      await withBridge(opts, async (bridge) => {
        const result = await bridge.createChat({
          chatId,
          title,
          hostId: opts.hostId,
          parentId: opts.parentId ?? null,
        });
        // JSON on stdout, matching `list`: the caller is a program.
        process.stdout.write(`${JSON.stringify(result)}\n`);
      });
    },
  );

program
  .command("delete-chat <chatId>")
  .description(
    "Delete a chat. Requires --expect-title matching the chat's current title.",
  )
  /**
   * THE GUARD, and it is required rather than optional.
   *
   * `epic.deleteChat` takes an id and deletes whatever that id names. A chat
   * id is a UUID: nothing about it is checkable by the person typing it, and
   * a transposed character addresses somebody's real agent rather than
   * failing. Every other verb here is recoverable — a wrong `send` is an
   * embarrassing message, a wrong `create-chat` is a spare chat. This one is
   * not, and the transcript goes with it.
   *
   * So the caller states what they believe they are deleting, and the bridge
   * checks that belief against the host's own title before acting. The id
   * says WHICH; the title says WHAT, and only the title can be wrong in a way
   * a human notices.
   */
  .requiredOption(
    "--expect-title <title>",
    "The chat's exact current title. Refuses if it does not match.",
  )
  .option("--epic-id <id>", "Epic id (defaults to $TRAYCER_EPIC_ID)")
  .option(
    "--sender-agent-id <id>",
    "Sender agent id (defaults to $TRAYCER_AGENT_ID)",
  )
  .action(
    async (
      chatId: string,
      opts: { expectTitle: string; epicId?: string; senderAgentId?: string },
    ) => {
      await withBridge(opts, async (bridge) => {
        const agents = await bridge.listAgents();
        const check = checkDeleteTarget(agents, chatId, opts.expectTitle);
        if (!check.ok) {
          throw new Error(`remote-bridge: ${check.reason}`);
        }
        const result = await bridge.deleteChat(chatId);
        process.stdout.write(`${JSON.stringify(result)}\n`);
      });
    },
  );

program
  .command("transcript <chatId>")
  .description("Print a window of a chat's transcript (newest first)")
  .option("--offset <n>", "Messages to skip from the NEWEST end", "0")
  .option("--limit <n>", "Window size", "5")
  .option("--epic-id <id>", "Epic id (defaults to $TRAYCER_EPIC_ID)")
  .option(
    "--sender-agent-id <id>",
    "Sender agent id (defaults to $TRAYCER_AGENT_ID)",
  )
  .action(
    async (
      chatId: string,
      opts: {
        offset: string;
        limit: string;
        epicId?: string;
        senderAgentId?: string;
      },
    ) => {
      // `Number.parseInt` rather than `Number`: commander hands these over as
      // strings and `runTranscript` rejects anything that isn't a
      // non-negative integer, so "abc" becomes NaN and is refused there
      // rather than silently becoming 0.
      await withBridge(opts, (bridge) =>
        runTranscript(
          bridge,
          chatId,
          Number.parseInt(opts.offset, 10),
          Number.parseInt(opts.limit, 10),
        ),
      );
    },
  );

program
  .command("watch")
  .description(
    "Long-running: print one JSON line per CHANGE (appeared/resolved) in what is waiting on a human, until stopped",
  )
  .option("--epic-id <id>", "Epic id (defaults to $TRAYCER_EPIC_ID)")
  .option(
    "--sender-agent-id <id>",
    "Sender agent id (defaults to $TRAYCER_AGENT_ID)",
  )
  .action(async (opts: { epicId?: string; senderAgentId?: string }) => {
    const logger = createLogger("info");
    await withBridge(opts, (bridge) =>
      runWatch(bridge, bridge.epicId, logger),
    );
  });

function isBridgeCliEntrypoint(argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  const basename = argv1.split(/[/\\]/).pop() ?? "";
  return (
    basename === "index.ts" ||
    basename === "traycer-remote-bridge" ||
    basename === "traycer-remote-bridge.exe"
  );
}

if (isBridgeCliEntrypoint(process.argv[1])) {
  program.parseAsync(process.argv).catch((err: unknown) => {
    process.stderr.write(
      `[bridge] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}

export { BridgeClient } from "./bridge-client";
export type {
  ActionOutcome,
  AgentSummary,
  ChatStatus,
  PendingApproval,
  PendingInterview,
  RemoteBridgeActions,
} from "./action-surface";
