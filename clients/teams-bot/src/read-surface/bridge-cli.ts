import type { ZodType } from "zod";
import {
  agentListSchema,
  chatStatusSchema,
  epicListSchema,
  type AgentSummary,
  type ChatStatus,
  type EpicSummary,
} from "./bridge-types";
import { nodeOneShotSpawnFn, type OneShotSpawnFn } from "./one-shot-spawn";

/**
 * One-shot `traycer-remote-bridge` CLI invocations — `list`, `status
 * <chatId>`, and the anticipated `epics` (see below). Each spawn is a
 * fresh process with the caller-supplied env, matching the CLI's own
 * reference-adapter shape (`clients/remote-bridge/src/index.ts`,
 * `adapters/cli-adapter.ts`) exactly — no new bridge-side code, no
 * long-running connection. `TenantConnectionManager`'s tracked child is a
 * different mechanism, for the `watch`/proactive path (T4), not this one.
 */

export type BridgeCliFailureReason =
  "spawn_timed_out" | "nonzero_exit" | "malformed_output";

export type BridgeCliResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  | {
      readonly kind: "failed";
      readonly reason: BridgeCliFailureReason;
      readonly detail: string;
    };

export interface BridgeCliConfig {
  /** Absolute path to the `traycer-remote-bridge` binary — never resolved via PATH. */
  readonly command: string;
  readonly timeoutMs: number;
  readonly spawnFn: OneShotSpawnFn;
}

export const DEFAULT_BRIDGE_CLI_TIMEOUT_MS = 20_000;

export function defaultBridgeCliConfig(command: string): BridgeCliConfig {
  return {
    command,
    timeoutMs: DEFAULT_BRIDGE_CLI_TIMEOUT_MS,
    spawnFn: nodeOneShotSpawnFn,
  };
}

async function runAndParse<T>(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  config: BridgeCliConfig,
  schema: ZodType<T>,
): Promise<BridgeCliResult<T>> {
  const result = await config.spawnFn(config.command, args, {
    env,
    timeoutMs: config.timeoutMs,
  });

  if (result.timedOut) {
    return {
      kind: "failed",
      reason: "spawn_timed_out",
      detail: `"${config.command} ${args.join(" ")}" did not exit within ${config.timeoutMs}ms`,
    };
  }
  if (result.code !== 0) {
    return {
      kind: "failed",
      reason: "nonzero_exit",
      detail: `exit code ${result.code ?? "null"}: ${result.stderr.trim()}`,
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(result.stdout);
  } catch (err) {
    return {
      kind: "failed",
      reason: "malformed_output",
      detail: `stdout was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const validated = schema.safeParse(parsedJson);
  if (!validated.success) {
    return {
      kind: "failed",
      reason: "malformed_output",
      detail: `stdout did not match the expected shape: ${validated.error.message}`,
    };
  }
  return { kind: "ok", value: validated.data };
}

export function listAgents(
  env: NodeJS.ProcessEnv,
  config: BridgeCliConfig,
): Promise<BridgeCliResult<readonly AgentSummary[]>> {
  return runAndParse(["list"], env, config, agentListSchema);
}

export function getChatStatus(
  chatId: string,
  env: NodeJS.ProcessEnv,
  config: BridgeCliConfig,
): Promise<BridgeCliResult<ChatStatus>> {
  return runAndParse(["status", chatId], env, config, chatStatusSchema);
}

/**
 * ANTICIPATED, NOT YET REAL. `remote-bridge` has no `epics` command today —
 * `list`/`status`/`approve`/`reject`/`watch` is the full surface (D3, on
 * `traycer-remote-bridge`). The underlying host RPC needs no `epicId`
 * (`epic.listTasks` — confirmed by the Planner, not assumed), so the
 * capability exists; only the bridge-side CLI wrapper doesn't yet.
 *
 * Intentionally not implemented in this package — see this ticket's own
 * escalation: a second implementation of a bridge command, in a package
 * that's meant to consume the bridge rather than reimplement it, is the
 * exact failure `tenant-environment.ts`'s docblock warns about. This
 * function is the seam `host-access.ts` calls through; this package's own
 * tests inject a fixture `spawnFn` for it. Once the bridge ships `epics`,
 * swap the fixture for a real spawn — no design change needed here.
 */
export function listEpics(
  env: NodeJS.ProcessEnv,
  config: BridgeCliConfig,
): Promise<BridgeCliResult<readonly EpicSummary[]>> {
  return runAndParse(["epics"], env, config, epicListSchema);
}
