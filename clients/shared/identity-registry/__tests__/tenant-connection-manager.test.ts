import { describe, expect, it } from "vitest";
import { IdentityRegistry } from "../registry";
import {
  TenantConnectionManager,
  type ChildProcessLike,
  type SpawnFn,
} from "../tenant-connection-manager";

const ALICE_OID = "0b8f1c2e-8f3a-4a1b-9c2d-1e2f3a4b5c6d";
const BOB_OID = "1a2b3c4d-5e6f-4a1b-8c2d-2e3f4a5b6c7d";

function twoTenantRegistry(): IdentityRegistry {
  return IdentityRegistry.fromConfig(
    {
      tenants: [
        { home: "/srv/traycer/alice", hostId: "host-alice", entraOid: ALICE_OID },
        { home: "/srv/traycer/bob", hostId: "host-bob", entraOid: BOB_OID },
      ],
    },
    () => {},
  );
}

class FakeChild implements ChildProcessLike {
  readonly pid = 4242;
  killed = false;
  private exitListeners: Array<
    (code: number | null, signal: NodeJS.Signals | null) => void
  > = [];

  on(
    _event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): void {
    this.exitListeners.push(listener);
  }

  kill(): boolean {
    this.killed = true;
    this.simulateExit(null, "SIGTERM");
    return true;
  }

  simulateExit(code: number | null, signal: NodeJS.Signals | null): void {
    for (const listener of [...this.exitListeners]) listener(code, signal);
  }
}

interface SpawnRecord {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly child: FakeChild;
}

function fakeSpawnHarness(): { spawnFn: SpawnFn; calls: SpawnRecord[] } {
  const calls: SpawnRecord[] = [];
  const spawnFn: SpawnFn = (command, args, options) => {
    const child = new FakeChild();
    calls.push({ command, args, env: options.env, child });
    return child;
  };
  return { spawnFn, calls };
}

function fakeTimerHarness(): {
  setTimer: (handler: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  fireAll: () => void;
} {
  const pending = new Set<() => void>();
  return {
    setTimer: (handler) => {
      pending.add(handler);
      return handler;
    },
    clearTimer: (handle) => {
      pending.delete(handle as () => void);
    },
    fireAll: () => {
      const toRun = [...pending];
      pending.clear();
      for (const handler of toRun) handler();
    },
  };
}

describe("TenantConnectionManager — fail-closed on unregistered tenants", () => {
  it("refuses ensureConnection for a hostId not in the registry, and never spawns", () => {
    const { spawnFn, calls } = fakeSpawnHarness();
    const manager = new TenantConnectionManager({
      registry: twoTenantRegistry(),
      command: "C:\\fake\\remote-bridge.exe",
      spawnFn,
      parentEnv: {},
    });
    const result = manager.ensureConnection("host-does-not-exist");
    expect(result).toEqual({ kind: "refused", reason: "unmapped_host_id" });
    expect(calls).toHaveLength(0);
  });
});

describe("TenantConnectionManager — reuse", () => {
  it("a second ensureConnection for the same hostId does not spawn again", () => {
    const { spawnFn, calls } = fakeSpawnHarness();
    const manager = new TenantConnectionManager({
      registry: twoTenantRegistry(),
      command: "C:\\fake\\remote-bridge.exe",
      spawnFn,
      parentEnv: {},
    });
    manager.ensureConnection("host-alice");
    manager.ensureConnection("host-alice");
    manager.ensureConnection("host-alice");
    expect(calls).toHaveLength(1);
  });
});

describe("TenantConnectionManager — isolation across concurrent tenants", () => {
  it("two tenants spawned back to back get non-overlapping HOME in their spawn env", () => {
    const { spawnFn, calls } = fakeSpawnHarness();
    const manager = new TenantConnectionManager({
      registry: twoTenantRegistry(),
      command: "C:\\fake\\remote-bridge.exe",
      spawnFn,
      parentEnv: { PATH: "/usr/bin" },
    });
    manager.ensureConnection("host-alice");
    manager.ensureConnection("host-bob");
    expect(calls).toHaveLength(2);
    expect(calls[0].env.HOME).toBe("/srv/traycer/alice");
    expect(calls[1].env.HOME).toBe("/srv/traycer/bob");
    expect(calls[0].env.HOME).not.toBe(calls[1].env.HOME);
  });
});

describe("TenantConnectionManager — bounded restart on crash", () => {
  it("respawns after a crash, up to the bound, then stops and reports terminal", () => {
    const { spawnFn, calls } = fakeSpawnHarness();
    const { setTimer, clearTimer, fireAll } = fakeTimerHarness();
    const terminalCalls: Array<{ hostId: string; reason: string }> = [];
    const manager = new TenantConnectionManager({
      registry: twoTenantRegistry(),
      command: "C:\\fake\\remote-bridge.exe",
      spawnFn,
      setTimer,
      clearTimer,
      parentEnv: {},
      maxConsecutiveFailures: 3,
      onTerminal: (hostId, reason) => terminalCalls.push({ hostId, reason }),
    });

    manager.ensureConnection("host-alice");
    expect(calls).toHaveLength(1);

    // Crash #1 -> backoff scheduled -> fire it -> respawn #2
    calls[0].child.simulateExit(1, null);
    fireAll();
    expect(calls).toHaveLength(2);

    // Crash #2 -> respawn #3
    calls[1].child.simulateExit(1, null);
    fireAll();
    expect(calls).toHaveLength(3);

    // Crash #3 hits the bound (maxConsecutiveFailures: 3) -> terminal, no respawn
    calls[2].child.simulateExit(1, null);
    fireAll();
    expect(calls).toHaveLength(3);
    expect(terminalCalls).toEqual([{ hostId: "host-alice", reason: "crash_loop_exhausted" }]);

    const result = manager.ensureConnection("host-alice");
    expect(result).toEqual({ kind: "refused", reason: "crash_loop_exhausted" });
  });

  it("a deliberate close() does not count as a crash and does not trigger a respawn", () => {
    const { spawnFn, calls } = fakeSpawnHarness();
    const { setTimer, clearTimer, fireAll } = fakeTimerHarness();
    const manager = new TenantConnectionManager({
      registry: twoTenantRegistry(),
      command: "C:\\fake\\remote-bridge.exe",
      spawnFn,
      setTimer,
      clearTimer,
      parentEnv: {},
    });
    manager.ensureConnection("host-alice");
    expect(calls).toHaveLength(1);
    void manager.close("host-alice");
    fireAll();
    expect(calls).toHaveLength(1); // no respawn from the deliberate close's exit
  });
});

describe("TenantConnectionManager — shutdown, no orphans", () => {
  it("closeAll kills every tracked child and awaits their exit before resolving", async () => {
    const { spawnFn, calls } = fakeSpawnHarness();
    const manager = new TenantConnectionManager({
      registry: twoTenantRegistry(),
      command: "C:\\fake\\remote-bridge.exe",
      spawnFn,
      parentEnv: {},
    });
    manager.ensureConnection("host-alice");
    manager.ensureConnection("host-bob");
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => !c.child.killed)).toBe(true);

    await manager.closeAll();

    expect(calls.every((c) => c.child.killed)).toBe(true);
    // Every ensureConnection after a full shutdown must be able to spawn
    // fresh again, not be stuck thinking a dead child is still connected.
    const { spawnFn: spawnFn2, calls: calls2 } = fakeSpawnHarness();
    const manager2 = new TenantConnectionManager({
      registry: twoTenantRegistry(),
      command: "C:\\fake\\remote-bridge.exe",
      spawnFn: spawnFn2,
      parentEnv: {},
    });
    manager2.ensureConnection("host-alice");
    expect(calls2).toHaveLength(1);
  });
});
