/**
 * The reducer that decides whether the epic screen knows its socket dropped.
 *
 * It lived inline in a `setState` callback, inside an effect, inside a hook
 * wired to a Y.Doc and a websocket — and a mutation to it **reddened
 * nothing**, because nothing could reach it. Extracting it is the same lesson
 * as `parseTileRef` earlier today: **assert the mechanism at its own level,
 * not through the composite that three layers jointly produce.**
 */
import { describe, expect, it } from "vitest";
import {
  applyConnectionStatus,
  type EpicAgentsState,
} from "../use-epic-agents";
import { buildChatTree } from "@traycer-clients/shared/epic/epic-doc-chats";
import { buildArtifactTree } from "@traycer-clients/shared/epic/epic-doc-artifacts";

function ready(connected: boolean, updatedAt: number): EpicAgentsState {
  return {
    kind: "ready",
    chats: [],
    tree: buildChatTree([]),
    artifacts: buildArtifactTree([]),
    updatedAt,
    connected,
  };
}

describe("a READY epic learns that its socket dropped", () => {
  it("flips connected to false on a non-open status", () => {
    /*
     * THE BUG. The old reducer began `if (prev.kind !== "loading") return
     * prev`, so a ready epic ignored every status change and the status
     * strip's `stale` branch — which renders the age, the whole basis for
     * trusting what is on screen — was unreachable.
     *
     * Mutation: restore that early return. This flips to `true` and the two
     * cases below stay green, which is why this one stands alone.
     */
    const next = applyConnectionStatus(ready(true, 1_000), "closed");
    expect(next.kind).toBe("ready");
    if (next.kind !== "ready") return;
    expect(next.connected).toBe(false);
  });

  it("flips back to true when the socket reopens", () => {
    const next = applyConnectionStatus(ready(false, 1_000), "open");
    expect(next.kind).toBe("ready");
    if (next.kind !== "ready") return;
    expect(next.connected).toBe(true);
  });

  it("does NOT touch updatedAt — a reconnect is not new data", () => {
    /*
     * Reconnecting proves the socket is up; it proves nothing about the rows
     * on screen. Refreshing `updatedAt` here would reset the age to "0s ago"
     * on every reconnect, which is the one number the user is being asked to
     * judge with — and it would be a lie precisely when the connection is
     * flapping and the data really is old.
     */
    const next = applyConnectionStatus(ready(false, 1_000), "open");
    if (next.kind !== "ready") return;
    expect(next.updatedAt).toBe(1_000);
  });

  it("returns the SAME reference when nothing changed", () => {
    /*
     * This fires on every status emit, not only on transitions. A fresh
     * object each time re-renders every consumer of the epic for no reason —
     * asserted by identity, because that is the only form the property has.
     */
    const before = ready(true, 1_000);
    expect(applyConnectionStatus(before, "open")).toBe(before);
  });
});

describe("a LOADING epic still tracks its phase", () => {
  it("advances to subscribing when the socket opens", () => {
    expect(
      applyConnectionStatus({ kind: "loading", phase: "connecting" }, "open"),
    ).toEqual({ kind: "loading", phase: "subscribing" });
  });

  it("falls back to connecting when it does not", () => {
    // A reconnect mid-load must not report "downloading" when the socket
    // just dropped.
    expect(
      applyConnectionStatus({ kind: "loading", phase: "subscribing" }, "closed"),
    ).toEqual({ kind: "loading", phase: "connecting" });
  });
});

describe("an ERRORED epic is left alone", () => {
  it("does not resurrect itself on a socket open", () => {
    // Recovery from `error` is a resubscribe, not a status ping — treating
    // the ping as recovery would show stale rows under a "live" label.
    const errored: EpicAgentsState = { kind: "error", detail: "gone" };
    expect(applyConnectionStatus(errored, "open")).toBe(errored);
  });
});
