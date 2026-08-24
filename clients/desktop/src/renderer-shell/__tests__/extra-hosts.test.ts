import { describe, expect, it } from "vitest";
import { createExtraHostsFetcher, parseExtraHosts } from "../extra-hosts";

const REMOTE = "wss://host.example/rpc";

function json(value: unknown): string {
  return JSON.stringify(value);
}

describe("parseExtraHosts", () => {
  describe("returns no entries rather than throwing", () => {
    // Every one of these runs inside `HostDirectoryService.start()`, where a
    // throw aborts the initial refresh and leaves the app with no directory.
    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a non-string", 42],
      ["an empty string", ""],
      ["whitespace", "   "],
      ["invalid JSON", "{not json"],
      ["a JSON object", json({ hostId: "h", websocketUrl: REMOTE })],
      ["a JSON string", json("hello")],
      ["a JSON number", json(7)],
      ["JSON null", json(null)],
    ])("for %s", (_label, raw) => {
      expect(parseExtraHosts(raw)).toEqual([]);
    });
  });

  it("maps a full entry to exactly the HostDirectoryEntry shape", () => {
    // Asserting the whole object, not field-by-field: a dropped or renamed
    // field only fails if nothing is allowed to be missing.
    expect(
      parseExtraHosts(
        json([
          {
            hostId: "altra",
            label: "Altra (Australia East)",
            websocketUrl: REMOTE,
            version: "1.1.9",
          },
        ]),
      ),
    ).toEqual([
      {
        hostId: "altra",
        label: "Altra (Australia East)",
        kind: "local",
        websocketUrl: REMOTE,
        version: "1.1.9",
        status: "available",
      },
    ]);
  });

  it("falls back to the hostId when no usable label is given", () => {
    const entries = parseExtraHosts(
      json([
        { hostId: "a", websocketUrl: REMOTE },
        { hostId: "b", websocketUrl: REMOTE, label: "   " },
        { hostId: "c", websocketUrl: REMOTE, label: 99 },
      ]),
    );
    expect(entries.map((e) => e.label)).toEqual(["a", "b", "c"]);
  });

  it("reports an unknown version as null rather than inventing one", () => {
    const entries = parseExtraHosts(
      json([
        { hostId: "a", websocketUrl: REMOTE },
        { hostId: "b", websocketUrl: REMOTE, version: 1.19 },
      ]),
    );
    expect(entries.map((e) => e.version)).toEqual([null, null]);
  });

  describe("drops an entry whose id could never be selected back", () => {
    it.each([
      ["a missing hostId", { websocketUrl: REMOTE }],
      ["an empty hostId", { hostId: "", websocketUrl: REMOTE }],
      ["a whitespace hostId", { hostId: "   ", websocketUrl: REMOTE }],
      ["a non-string hostId", { hostId: 5, websocketUrl: REMOTE }],
    ])("%s", (_label, item) => {
      expect(parseExtraHosts(json([item]))).toEqual([]);
    });
  });

  describe("drops an entry the socket could not dial", () => {
    // `WsRpcClient` hands `websocketUrl` to the WebSocket factory verbatim, so
    // an http:// or garbage value surfaces as a dial failure against a picker
    // row that looks fine. Reject it where it can still be explained.
    it.each([
      ["a missing url", { hostId: "a" }],
      ["a non-string url", { hostId: "a", websocketUrl: 80 }],
      ["an unparseable url", { hostId: "a", websocketUrl: "not a url" }],
      ["an http url", { hostId: "a", websocketUrl: "http://host.example/rpc" }],
      [
        "an https url",
        { hostId: "a", websocketUrl: "https://host.example/rpc" },
      ],
      ["a file url", { hostId: "a", websocketUrl: "file:///rpc" }],
      ["an empty url", { hostId: "a", websocketUrl: "" }],
    ])("%s", (_label, item) => {
      expect(parseExtraHosts(json([item]))).toEqual([]);
    });

    it.each([
      ["ws", "ws://127.0.0.1:52439/rpc"],
      ["wss", "wss://host.example/rpc"],
    ])("keeps a %s url", (_label, websocketUrl) => {
      expect(parseExtraHosts(json([{ hostId: "a", websocketUrl }]))).toEqual([
        {
          hostId: "a",
          label: "a",
          kind: "local",
          websocketUrl,
          version: null,
          status: "available",
        },
      ]);
    });
  });

  it("skips unusable array members without losing the usable ones", () => {
    // A single bad entry must cost you that entry, not the whole list.
    const entries = parseExtraHosts(
      json([
        null,
        "a string",
        7,
        { hostId: "good-1", websocketUrl: REMOTE },
        { hostId: "no-url" },
        { hostId: "good-2", websocketUrl: REMOTE },
      ]),
    );
    expect(entries.map((e) => e.hostId)).toEqual(["good-1", "good-2"]);
  });

  it("keeps only the first of a duplicated hostId", () => {
    // `HostDirectoryService.findById` returns the first match, so a second row
    // with the same id is a picker entry that resolves to the other one.
    const entries = parseExtraHosts(
      json([
        { hostId: "dup", websocketUrl: "wss://first.example/rpc" },
        { hostId: "dup", websocketUrl: "wss://second.example/rpc" },
      ]),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.websocketUrl).toBe("wss://first.example/rpc");
  });

  it("marks entries kind:local so the WS clients dial the url as given", () => {
    // Not cosmetic: `kind` selects the dial strategy. Were these "remote", a
    // build carrying a relay path would route them through it instead.
    const entries = parseExtraHosts(
      json([{ hostId: "a", websocketUrl: REMOTE }]),
    );
    expect(entries.every((e) => e.kind === "local")).toBe(true);
  });
});

describe("createExtraHostsFetcher", () => {
  it("resolves to the parsed entries", async () => {
    const fetcher = createExtraHostsFetcher(
      json([{ hostId: "a", websocketUrl: REMOTE }]),
    );
    // The WHOLE outcome, not just its entries: `kind` is what
    // `HostDirectoryService` branches on to tell an empty registry from a
    // sign-out from a transient failure, so asserting only the array would
    // pass on a fetcher that reported the wrong one of the three.
    await expect(fetcher()).resolves.toEqual({
      kind: "hosts",
      entries: [
        {
          hostId: "a",
          label: "a",
          kind: "local",
          websocketUrl: REMOTE,
          version: null,
          status: "available",
        },
      ],
    });
  });

  it("resolves to an empty list when nothing is configured", async () => {
    await expect(createExtraHostsFetcher(undefined)()).resolves.toEqual({
      kind: "hosts",
      entries: [],
    });
  });

  it("rejects nothing, so a bad value cannot abort the initial refresh", async () => {
    await expect(createExtraHostsFetcher("{not json")()).resolves.toEqual({
      kind: "hosts",
      entries: [],
    });
  });
});
