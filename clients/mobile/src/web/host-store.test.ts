import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addStoredHost, readStoredHosts, removeStoredHost } from "./host-store";

const BAKED_ID = "11111111-1111-1111-1111-111111111111";

function validInput(overrides: Partial<Record<string, string>>) {
  return {
    hostId: "22222222-2222-2222-2222-222222222222",
    label: "Tonberry",
    websocketUrl: "wss://host.example/rpc",
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("host store", () => {
  it("starts empty and round-trips an added host", () => {
    expect(readStoredHosts()).toEqual([]);
    const result = addStoredHost(validInput({}), [BAKED_ID]);
    expect(result.kind).toBe("added");
    expect(readStoredHosts()).toEqual([
      {
        hostId: "22222222-2222-2222-2222-222222222222",
        label: "Tonberry",
        websocketUrl: "wss://host.example/rpc",
      },
    ]);
  });

  it("rejects a duplicate of the baked host id", () => {
    // Two entries with one id would make `selectById` ambiguous.
    const result = addStoredHost(validInput({ hostId: BAKED_ID }), [BAKED_ID]);
    expect(result).toEqual({
      kind: "rejected",
      reason: "A host with that id is already listed.",
    });
    expect(readStoredHosts()).toEqual([]);
  });

  it("rejects a duplicate of an already-stored host id", () => {
    addStoredHost(validInput({}), [BAKED_ID]);
    const result = addStoredHost(validInput({ label: "Other" }), [BAKED_ID]);
    expect(result.kind).toBe("rejected");
    expect(readStoredHosts()).toHaveLength(1);
  });

  it("rejects a non-WebSocket scheme rather than silently coercing it", () => {
    const result = addStoredHost(
      validInput({ websocketUrl: "https://host.example/rpc" }),
      [BAKED_ID],
    );
    expect(result).toEqual({
      kind: "rejected",
      reason: "URL must start with ws:// or wss://.",
    });
  });

  it("rejects a malformed URL", () => {
    const result = addStoredHost(validInput({ websocketUrl: "not a url" }), [
      BAKED_ID,
    ]);
    expect(result).toEqual({
      kind: "rejected",
      reason: "That is not a valid URL.",
    });
  });

  it("requires a label and a host id", () => {
    expect(addStoredHost(validInput({ label: "   " }), [BAKED_ID])).toEqual({
      kind: "rejected",
      reason: "Give the host a name.",
    });
    expect(addStoredHost(validInput({ hostId: "  " }), [BAKED_ID])).toEqual({
      kind: "rejected",
      reason: "Host id is required.",
    });
  });

  it("trims surrounding whitespace instead of storing it", () => {
    addStoredHost(
      validInput({ label: "  Tonberry  ", websocketUrl: " wss://h.example/rpc " }),
      [BAKED_ID],
    );
    expect(readStoredHosts()[0].label).toBe("Tonberry");
    expect(readStoredHosts()[0].websocketUrl).toBe("wss://h.example/rpc");
  });

  it("removes only the named host", () => {
    addStoredHost(validInput({}), [BAKED_ID]);
    addStoredHost(
      validInput({
        hostId: "33333333-3333-3333-3333-333333333333",
        label: "Third",
      }),
      [BAKED_ID],
    );
    const remaining = removeStoredHost("22222222-2222-2222-2222-222222222222");
    expect(remaining.map((host) => host.label)).toEqual(["Third"]);
    expect(readStoredHosts().map((host) => host.label)).toEqual(["Third"]);
  });

  it("cannot remove the baked host, because it was never in the store", () => {
    // The guarantee is structural, not a check someone has to remember: the
    // baked entry lives in the build config, so there is nothing to delete.
    addStoredHost(validInput({}), [BAKED_ID]);
    const remaining = removeStoredHost(BAKED_ID);
    expect(remaining).toHaveLength(1);
  });

  it("rejects a ws:// host from an https page, naming the real cause", () => {
    // Mixed content: the browser blocks this, and the failure would
    // otherwise surface much later as an unexplained connection error with
    // no hint that the scheme was the problem.
    vi.stubGlobal("location", { protocol: "https:" });
    const result = addStoredHost(
      validInput({ websocketUrl: "ws://127.0.0.1:60407/rpc" }),
      [BAKED_ID],
    );
    expect(result.kind).toBe("rejected");
    expect(
      result.kind === "rejected" ? result.reason : "",
    ).toContain("cannot dial a ws:// host");
    expect(readStoredHosts()).toEqual([]);
  });

  it("allows a ws:// host from an http page, where it genuinely works", () => {
    vi.stubGlobal("location", { protocol: "http:" });
    const result = addStoredHost(
      validInput({ websocketUrl: "ws://127.0.0.1:60407/rpc" }),
      [BAKED_ID],
    );
    expect(result.kind).toBe("added");
  });

  it("degrades to an empty list on a corrupted store rather than throwing", () => {
    localStorage.setItem("traycer.web.hosts.v1", "{not json");
    expect(readStoredHosts()).toEqual([]);
  });

  it("drops malformed entries but keeps the well-formed ones", () => {
    localStorage.setItem(
      "traycer.web.hosts.v1",
      JSON.stringify([
        { hostId: "a", label: "Good", websocketUrl: "wss://h/rpc" },
        { hostId: "b", label: "" },
        null,
        "nonsense",
      ]),
    );
    expect(readStoredHosts()).toEqual([
      { hostId: "a", label: "Good", websocketUrl: "wss://h/rpc" },
    ]);
  });
});
