import { describe, expect, it } from "vitest";
import { hostDisclosure } from "../authoring-scope";

const HOST = "a1000000-0000-4000-8000-000000000e91";

describe("hostDisclosure — creation is refused without a host", () => {
  it("CONTRACT: an unconfigured host id refuses the create", () => {
    // Creating anyway would stamp the local UI LABEL as the chat's durable
    // host, and that stamp is for life — a permanent wrong answer rather
    // than a temporary one. Mobile has already shipped this once: the chat
    // renders as an unreachable host on desktop.
    const d = hostDisclosure("");
    expect(d.canCreate).toBe(false);
    expect(d.hostId).toBeNull();
  });

  it("treats a whitespace-only host id as absent", () => {
    // A config var set to spaces is unset in every way that matters, and
    // `"   ".slice(0, 8)` would otherwise appear in the notice as a host.
    expect(hostDisclosure("   \t ").canCreate).toBe(false);
  });

  it("CONTRACT: canCreate and a known hostId agree in both directions", () => {
    for (const raw of ["", "  ", HOST, "h"]) {
      const d = hostDisclosure(raw);
      expect(d.canCreate).toBe(d.hostId !== null);
    }
  });

  it("blames the deployment, not the user", () => {
    // The user cannot fix a missing build-time variable, and reading it as
    // an account problem sends them somewhere with nothing to find.
    const notice = hostDisclosure("").notice;
    expect(notice.trim().length).toBeGreaterThan(0);
    expect(notice).toMatch(/nothing is wrong with your account/i);
  });
});

describe("hostDisclosure — the disclosure itself", () => {
  it("allows creation once a host is configured", () => {
    const d = hostDisclosure(HOST);
    expect(d.canCreate).toBe(true);
    expect(d.hostId).toBe(HOST);
  });

  it("CONTRACT: the notice says the host cannot be changed later", () => {
    // This is where "which machine" stops being a label on a read-only row
    // and becomes a choice the user is making. Shown at the point of
    // creation, never discovered afterwards.
    expect(hostDisclosure(HOST).notice).toMatch(/can[’']?t be changed later/i);
  });

  it("names the host so the choice is visible, without the full id", () => {
    const notice = hostDisclosure(HOST).notice;
    expect(notice).toContain(HOST.slice(0, 8));
    expect(notice).not.toContain(HOST);
  });

  it("never returns an empty notice for either outcome", () => {
    for (const raw of ["", HOST]) {
      expect(hostDisclosure(raw).notice.trim().length).toBeGreaterThan(0);
    }
  });

  it("CONTRACT: the two notices never read the same", () => {
    expect(hostDisclosure("").notice).not.toBe(hostDisclosure(HOST).notice);
  });
});
