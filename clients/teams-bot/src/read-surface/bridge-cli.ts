import type { ZodType } from "zod";
import {
  actionOutcomeSchema,
  agentListSchema,
  chatStatusSchema,
  epicListSchema,
  type ActionOutcome,
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

/**
 * Runs an ACTION command (`approve` / `reject`) and parses its
 * {@link ActionOutcome} from stdout.
 *
 * Deliberately does NOT use {@link runAndParse}: the bridge's CLI adapter
 * sets `process.exitCode = 1` for any outcome that isn't `applied`
 * (`cli-adapter.ts`'s `runApprove`/`runReject`). So a legitimate `rejected`
 * outcome — the host declining the decision, a real and meaningful answer —
 * exits non-zero. Treating non-zero as failure would discard stdout and
 * report "the bridge failed" for what is actually "the host rejected it",
 * losing the outcome the user needs to see. Found by reading the adapter
 * before building against it.
 *
 * So: parse stdout FIRST, whatever the exit code. Only fall back to an
 * exit-code error when stdout carries no valid outcome.
 */
async function runAction(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  config: BridgeCliConfig,
): Promise<BridgeCliResult<ActionOutcome>> {
  const result = await config.spawnFn(config.command, args, {
    env,
    timeoutMs: config.timeoutMs,
  });

  if (result.timedOut) {
    return {
      kind: "failed",
      reason: "spawn_timed_out",
      detail: `"${config.command} ${args.join(" ")}" did not exit within ${config.timeoutMs}ms — the action may still have been applied`,
    };
  }

  const trimmed = result.stdout.trim();
  if (trimmed.length > 0) {
    try {
      const parsed = actionOutcomeSchema.safeParse(JSON.parse(trimmed));
      if (parsed.success) {
        return { kind: "ok", value: parsed.data };
      }
    } catch {
      // Fall through to the exit-code path below.
    }
  }

  return {
    kind: "failed",
    reason: result.code === 0 ? "malformed_output" : "nonzero_exit",
    detail:
      result.stderr.trim().length > 0
        ? result.stderr.trim()
        : `exit code ${result.code ?? "null"} with no parseable outcome on stdout`,
  };
}

export function approveAction(
  approvalId: string,
  env: NodeJS.ProcessEnv,
  config: BridgeCliConfig,
): Promise<BridgeCliResult<ActionOutcome>> {
  return runAction(["approve", approvalId], env, config);
}

/** `reason` is surfaced to the agent as the denial explanation; omit for none. */
export function rejectAction(
  approvalId: string,
  reason: string | null,
  env: NodeJS.ProcessEnv,
  config: BridgeCliConfig,
): Promise<BridgeCliResult<ActionOutcome>> {
  const args =
    reason === null || reason.length === 0
      ? ["reject", approvalId]
      : ["reject", approvalId, reason];
  return runAction(args, env, config);
}
