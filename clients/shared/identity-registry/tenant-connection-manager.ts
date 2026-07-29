import { spawn } from "node:child_process";
import { buildTenantEnvironment } from "./tenant-environment";
import type { IdentityRegistry } from "./registry";
import type { TenantMapping } from "./types";

/**
 * Holds one long-running `remote-bridge` CLI child process per
 * actively-mapped identity — the connection-lifecycle decision for A2's
 * open design question, approved by the Planner. See `registry.ts`'s
 * module doc for why this exists in A2 at all rather than purely in A1.
 *
 * WHY A CHILD PROCESS PER TENANT, NOT N IN-PROCESS CLIENTS: `remote-bridge`
 * (`clients/remote-bridge` on the `traycer-remote-bridge` branch) resolves
 * its host endpoint and credentials via `node:os`'s `homedir()`, called
 * fresh inside async function bodies — never cached, never parameterized.
 * `homedir()` reads `process.env.HOME`/`USERPROFILE` at call time, which is
 * PROCESS-GLOBAL mutable state. Holding N `BridgeClient` instances for N
 * tenants in one Node process would require mutating that global across
 * interleaved `await`s — not a rare race, GUARANTEED interleaving under
 * Node's event loop the moment two tenants' connections are being
 * established concurrently, in the one place a mistake hands someone
 * another person's credentials. Spawning a real OS process per tenant, with
 * `HOME`/`USERPROFILE` fixed for that process's entire lifetime via its
 * `env` (see `tenant-environment.ts` — NEVER via mutating this process's
 * own `process.env`), sidesteps the race entirely and needs zero changes to
 * `remote-bridge`.
 *
 * LIFETIME IS BOUND TO REGISTRY MEMBERSHIP, NOT INBOUND ACTIVITY. An
 * earlier idle-timeout design was rejected: `remote-bridge` also carries
 * the OUTBOUND notification path (`host.notifications.feed.subscribe`), so
 * a tenant with no inbound messages but a live agent producing events still
 * needs its connection up. Idleness measured only against inbound activity
 * would reap exactly that connection, and the failure would present as
 * silence — nobody reports a notification they never knew was coming. A
 * connection is created lazily on first need (inbound OR outbound) and
 * stays up for as long as {@link IdentityRegistry.resolveIdentity} still
 * maps its `hostId` — checked at every {@link ensureConnection} call, not
 * just once at first spawn, so a registry reload that removes a tenant
 * mid-session is honored.
 */

export interface ChildProcessLike {
  readonly pid?: number;
  on(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): void;
  kill(signal: NodeJS.Signals | undefined): boolean;
}

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { readonly env: NodeJS.ProcessEnv },
) => ChildProcessLike;

/** Production default: the real `node:child_process.spawn`. */
export const nodeSpawnFn: SpawnFn = (command, args, options) =>
  spawn(command, args as string[], { env: options.env });

export type EnsureConnectionResult =
  | { readonly kind: "connected"; readonly hostId: string }
  | { readonly kind: "refused"; readonly reason: "unmapped_host_id" }
  | { readonly kind: "refused"; readonly reason: "crash_loop_exhausted" };

export type TimerHandle = unknown;

interface TenantConnectionManagerOptions {
  readonly registry: IdentityRegistry;
  /** Absolute path to the `remote-bridge` entry point — never resolved via `PATH`. */
  readonly command: string;
  readonly args?: readonly string[];
  /** Per-spawn values (e.g. `TRAYCER_EPIC_ID`) — never inherited from this process's own env. */
  readonly buildExtraEnv?: (tenant: TenantMapping) => Record<string, string>;
  readonly parentEnv?: NodeJS.ProcessEnv;
  readonly spawnFn?: SpawnFn;
  readonly setTimer?: (handler: () => void, ms: number) => TimerHandle;
  readonly clearTimer?: (handle: TimerHandle) => void;
  readonly maxConsecutiveFailures?: number;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
  /** Called once a tenant's crash-loop bound is exhausted — surfaces the failure instead of retrying forever. */
  readonly onTerminal?: (hostId: string, reason: string) => void;
}

interface TrackedChild {
  child: ChildProcessLike;
  consecutiveFailures: number;
  terminal: boolean;
  backoffTimer: TimerHandle | null;
  closing: boolean;
}

const DEFAULT_MAX_CONSECUTIVE_FAILURES = 5;
const DEFAULT_INITIAL_BACKOFF_MS = 500;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

export class TenantConnectionManager {
  private readonly registry: IdentityRegistry;
  private readonly command: string;
  private readonly args: readonly string[];
  private readonly buildExtraEnv: (tenant: TenantMapping) => Record<string, string>;
  private readonly parentEnv: NodeJS.ProcessEnv;
  private readonly spawnFn: SpawnFn;
  private readonly setTimer: (handler: () => void, ms: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;
  private readonly maxConsecutiveFailures: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly onTerminal: (hostId: string, reason: string) => void;
  private readonly children = new Map<string, TrackedChild>();

  constructor(options: TenantConnectionManagerOptions) {
    this.registry = options.registry;
    this.command = options.command;
    this.args = options.args ?? [];
    this.buildExtraEnv = options.buildExtraEnv ?? (() => ({}));
    this.parentEnv = options.parentEnv ?? process.env;
    this.spawnFn = options.spawnFn ?? nodeSpawnFn;
    this.setTimer = options.setTimer ?? ((handler, ms) => setTimeout(handler, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
    this.maxConsecutiveFailures =
      options.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;
    this.initialBackoffMs = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.onTerminal = options.onTerminal ?? (() => {});
  }

  /**
   * Fail-closed at spawn time, not just at resolution time: re-checks
   * registry membership on every call via `resolveIdentity`, so a tenant
   * removed from the registry after this manager last saw it is refused
   * rather than reusing a stale mapping.
   */
  ensureConnection(hostId: string): EnsureConnectionResult {
    const existing = this.children.get(hostId);
    if (existing !== undefined) {
      if (existing.terminal) {
        return { kind: "refused", reason: "crash_loop_exhausted" };
      }
      return { kind: "connected", hostId };
    }

    const resolution = this.registry.resolveIdentity(hostId);
    if (resolution.kind !== "resolved") {
      return { kind: "refused", reason: "unmapped_host_id" };
    }

    this.spawnFor(resolution.tenant);
    return { kind: "connected", hostId };
  }

  /** First spawn for a tenant this manager has never tracked (or has fully torn down) — starts a fresh failure count. */
  private spawnFor(tenant: TenantMapping): void {
    const child = this.launch(tenant);
    const tracked: TrackedChild = {
      child,
      consecutiveFailures: 0,
      terminal: false,
      backoffTimer: null,
      closing: false,
    };
    this.children.set(tenant.hostId, tracked);
    child.on("exit", () => {
      this.handleExit(tenant.hostId);
    });
  }

  private launch(tenant: TenantMapping): ChildProcessLike {
    const env = buildTenantEnvironment({
      tenant,
      parentEnv: this.parentEnv,
      extra: this.buildExtraEnv(tenant),
    });
    return this.spawnFn(this.command, this.args, { env });
  }

  private handleExit(hostId: string): void {
    const tracked = this.children.get(hostId);
    if (tracked === undefined || tracked.closing) {
      // Deliberate teardown (close/closeAll) already removed bookkeeping —
      // an exit after that is expected, not a crash to react to.
      return;
    }
    tracked.consecutiveFailures += 1;
    if (tracked.consecutiveFailures >= this.maxConsecutiveFailures) {
      tracked.terminal = true;
      this.onTerminal(hostId, "crash_loop_exhausted");
      return;
    }
    const delay = Math.min(
      this.initialBackoffMs * 2 ** (tracked.consecutiveFailures - 1),
      this.maxBackoffMs,
    );
    // Reuses the SAME TrackedChild across the backoff/respawn — the failure
    // count must survive a respawn, or a crash-looping tenant would never
    // hit the bound (each respawn would silently reset it to zero).
    tracked.backoffTimer = this.setTimer(() => {
      tracked.backoffTimer = null;
      const resolution = this.registry.resolveIdentity(hostId);
      if (resolution.kind !== "resolved") {
        // Tenant was removed from the registry while we were backing off —
        // stop trying to reconnect it, but leave no terminal error (this
        // isn't a crash-loop, it's an intentional offboarding).
        this.children.delete(hostId);
        return;
      }
      const newChild = this.launch(resolution.tenant);
      tracked.child = newChild;
      newChild.on("exit", () => {
        this.handleExit(hostId);
      });
    }, delay);
  }

  /** Tears down one tenant's child, awaited — used for explicit offboarding, not crash handling. */
  async close(hostId: string): Promise<void> {
    const tracked = this.children.get(hostId);
    if (tracked === undefined) return;
    tracked.closing = true;
    if (tracked.backoffTimer !== null) {
      this.clearTimer(tracked.backoffTimer);
    }
    await killAndAwaitExit(tracked.child);
    this.children.delete(hostId);
  }

  /**
   * No orphans on parent shutdown: kills and AWAITS every tracked child's
   * exit before resolving, so a killed parent never leaves a tenant child
   * still holding credentials and an open socket.
   */
  async closeAll(): Promise<void> {
    const hostIds = [...this.children.keys()];
    await Promise.all(hostIds.map((hostId) => this.close(hostId)));
  }
}

const EXIT_WAIT_TIMEOUT_MS = 5_000;

function killAndAwaitExit(child: ChildProcessLike): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timeout = setTimeout(finish, EXIT_WAIT_TIMEOUT_MS);
    child.on("exit", () => {
      clearTimeout(timeout);
      finish();
    });
    child.kill("SIGTERM");
  });
}
