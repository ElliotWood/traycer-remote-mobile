import { describe, expect, it } from "vitest";
import {
  byUrgency,
  displayName,
  fleetStatus,
  type FleetAgent,
} from "../fleet-types";

const base: FleetAgent = {
  agentId: "a1000000-0000-4000-8000-00000000beef",
  title: "An agent",
  harnessId: "claude",
  surface: "gui",
  active: false,
  isLocal: true,
  hostId: "h-local",
  pendingApprovals: 0,
  pendingInterviews: 0,
  lastActivityAt: null,
};

describe("fleet-types — status", () => {
  it("CONTRACT: blocked outranks running", () => {
    // An agent that is executing AND waiting on a decision is the thing the
    // user came to the fleet to find. Showing it as a green "Running" row is
    // how the card version hid the only actionable agent on screen.
    expect(fleetStatus({ ...base, active: true, pendingApprovals: 1 })).toBe(
      "blocked",
    );
  });

  it("counts a pending interview as blocked, not just approvals", () => {
    expect(fleetStatus({ ...base, pendingInterviews: 2 })).toBe("blocked");
  });

  it("running when executing with nothing pending", () => {
    expect(fleetStatus({ ...base, active: true })).toBe("running");
  });

  it("idle otherwise", () => {
    expect(fleetStatus(base)).toBe("idle");
  });
});

describe("fleet-types — ordering", () => {
  it("CONTRACT: blocked agents sort above running and idle ones", () => {
    const blocked = { ...base, agentId: "b", title: "Z", pendingApprovals: 1 };
    const running = { ...base, agentId: "r", title: "A", active: true };
    const idle = { ...base, agentId: "i", title: "A" };
    const sorted = [idle, running, blocked].sort(byUrgency);
    expect(sorted.map((a) => a.agentId)).toEqual(["b", "r", "i"]);
  });

  it("is stable by name within a status group, so rows don't jump around", () => {
    const a = { ...base, agentId: "1", title: "Beta", active: true };
    const b = { ...base, agentId: "2", title: "Alpha", active: true };
    expect([a, b].sort(byUrgency).map((x) => x.title)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });
});

describe("fleet-types — displayName never shows a bare UUID", () => {
  it("falls back to a readable label with a short id, not the raw id", () => {
    const name = displayName({ ...base, title: null, harnessId: null });
    expect(name).not.toBe(base.agentId);
    expect(name).toContain("Untitled");
    expect(name).toContain("a1000000");
    // The full id must not be readable — same rule the cards arrived at.
    expect(name).not.toContain(base.agentId);
  });

  it("treats a whitespace-only title as absent", () => {
    expect(displayName({ ...base, title: "   " })).toContain("Untitled");
  });

  it("names the harness when known so untitled rows still differ", () => {
    expect(displayName({ ...base, title: null })).toContain("claude");
  });
});

describe("fleet-types — a remote agent is never reported as idle", () => {
  /**
   * Measured against the real host: 53 of 56 agents in the epic run
   * elsewhere and every one reports `active: false`, correctly — the
   * activity tracker is local-only and does not replicate. Rendering those
   * as "Idle" would have told the user nothing was happening while agents
   * ran, with no dishonest line of code anywhere.
   */
  const remote: FleetAgent = {
    ...base,
    isLocal: false,
    hostId: "h-elsewhere",
    active: false,
  };

  it("CONTRACT: isLocal false yields 'remote', never 'idle'", () => {
    expect(fleetStatus(remote)).toBe("remote");
    expect(fleetStatus(remote)).not.toBe("idle");
  });

  it("locality outranks every other signal, because the others are unreadable", () => {
    // Even if pending counts arrived from somewhere, they cannot be trusted
    // for a host we cannot see. Locality is checked first for that reason.
    expect(fleetStatus({ ...remote, pendingApprovals: 3, active: true })).toBe(
      "remote",
    );
  });

  it("a LOCAL agent with the same values is genuinely idle", () => {
    // The control: this is what makes the test above about locality rather
    // than about the zeros.
    expect(fleetStatus({ ...remote, isLocal: true })).toBe("idle");
  });

  it("remote sorts last — least actionable, not middling", () => {
    const blocked = { ...base, agentId: "b", pendingApprovals: 1 };
    const idle = { ...base, agentId: "i" };
    const sorted = [remote, idle, blocked].sort(byUrgency);
    expect(sorted.map((a) => fleetStatus(a))).toEqual([
      "blocked",
      "idle",
      "remote",
    ]);
  });
});
