#!/usr/bin/env -S bun
import { Command } from "commander";
import { runAgent } from "./agent/run-agent";
import { runGateway } from "./gateway/run-gateway";

const program = new Command();
program
  .name("traycer-remote")
  .description("Traycer Remote - multi-host agent and gateway");

program
  .command("agent")
  .description("Run the remote-agent for this machine's Traycer Host")
  .requiredOption("--config <path>", "path to agent-config.json")
  .action(async (opts: { config: string }) => {
    await runAgent(opts.config);
  });

program
  .command("gateway")
  .description("Run the traycer-remote gateway (primary machine)")
  .requiredOption("--config <path>", "path to gateway-config.json")
  .action(async (opts: { config: string }) => {
    await runGateway(opts.config);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
