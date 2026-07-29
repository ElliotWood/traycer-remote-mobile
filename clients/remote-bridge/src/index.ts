#!/usr/bin/env node
/**
 * `traycer-remote-bridge` — headless Node client + D3 CLI reference adapter.
 * stdout carries only command payloads; every diagnostic goes to stderr
 * (see `logger.ts`) so a future channel adapter piping this process's
 * output never has protocol noise mixed in.
 */
import { Command } from "commander";
import { BridgeClient } from "./bridge-client";
import { createLogger } from "./logger";
import {
  runApprove,
  runList,
  runReject,
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
      await withBridge(opts, (bridge) => runApprove(bridge, approvalId, logger));
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
  .command("watch")
  .description(
    "Long-running: print every pending approval/interview across tracked agents until stopped",
  )
  .option("--epic-id <id>", "Epic id (defaults to $TRAYCER_EPIC_ID)")
  .option(
    "--sender-agent-id <id>",
    "Sender agent id (defaults to $TRAYCER_AGENT_ID)",
  )
  .action(async (opts: { epicId?: string; senderAgentId?: string }) => {
    const logger = createLogger("info");
    await withBridge(opts, (bridge) => runWatch(bridge, logger));
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
