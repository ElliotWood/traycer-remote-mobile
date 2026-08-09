import { describe, it, expect } from "vitest";
import { Registry } from "../registry";

const AGENT_A = "11111111-1111-1111-1111-111111111111";

// No `hostId` parameter: all six call sites took the default, so the argument
// only ever described one host.
function upsertA(registry: Registry): void {
  registry.upsert({
    agentId: AGENT_A,
    hostId: "host-a",
    label: "machine a",
    version: "1.0.0",
    reachableUrl: "http://100.0.0.1:6001",
  });
}

describe("Registry (M1 contract B3 - never delete, honest offline)", () => {
  it("a fresh registration is available", () => {
    const registry = new Registry(1_000);
    upsertA(registry);
    expect(registry.statusFor("host-a")).toBe("available");
  });

  it("an unregistered agentId reads as unknown, not unavailable", () => {
    const registry = new Registry(1_000);
    expect(registry.statusFor("never-seen")).toBe("unknown");
  });

  it("a lapsed heartbeat is unavailable, entry NOT removed", () => {
    const registry = new Registry(10); // 10ms timeout for the test
    upsertA(registry);
    expect(registry.list()).toHaveLength(1);

    // Simulate the timeout elapsing without another heartbeat.
    const before = Date.now();
    while (Date.now() - before < 20) {
      /* busy-wait past the 10ms heartbeat timeout */
    }
    registry.reconcileLapsedHeartbeats();

    expect(registry.statusFor("host-a")).toBe("unavailable");
    // Still present - this is the fix for "the user turned their machine
    // off must never read as unknown host".
    expect(registry.list()).toHaveLength(1);
    expect(registry.get(AGENT_A)?.unavailableReason).toBe("heartbeat_lapsed");
  });

  it("a clean unregister marks unavailable with reason 'stopped', entry NOT removed", () => {
    const registry = new Registry(60_000);
    upsertA(registry);
    registry.markStopped(AGENT_A);

    expect(registry.statusFor("host-a")).toBe("unavailable");
    expect(registry.list()).toHaveLength(1);
    expect(registry.get(AGENT_A)?.unavailableReason).toBe("stopped");
  });

  it("re-registration after either unavailable path clears the reason back to available", () => {
    const registry = new Registry(60_000);
    upsertA(registry);
    registry.markStopped(AGENT_A);
    expect(registry.statusFor("host-a")).toBe("unavailable");

    upsertA(registry); // agent comes back, heartbeats resume
    expect(registry.statusFor("host-a")).toBe("available");
    expect(registry.get(AGENT_A)?.unavailableReason).toBeNull();
  });

  it("list() never omits an entry regardless of status", () => {
    const registry = new Registry(60_000);
    upsertA(registry);
    registry.markStopped(AGENT_A);
    const entries = registry.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("unavailable");
  });
});
