/**
 * The mapping that had a hole nothing could see.
 *
 * `EpicConnectionState` has four members; the ternary chain in `app.tsx`
 * produced three. `stale` — the only one carrying an age — was never
 * constructed, so the status strip's `stale` branch was a correct renderer
 * for a state that did not exist.
 *
 * That is why the first test here is an EXHAUSTIVENESS test rather than a
 * case: the defect was not a wrong branch, it was a MISSING one, and no
 * per-case test catches a member nobody produces. A chain is exactly where
 * that hides — adding a union member does not break one, it just quietly
 * never produces it.
 */
import { describe, expect, it } from "vitest";
import { toEpicConnectionState } from "../epic-connection";
import type { EpicConnectionState } from "../epic-status-row";
import type { EpicAgentsState } from "@/epics/use-epic-agents";
import { buildChatTree } from "@traycer-clients/shared/epic/epic-doc-chats";
import { buildArtifactTree } from "@traycer-clients/shared/epic/epic-doc-artifacts";

const NOW = 1_700_000_000_000;

function ready(args: {
  readonly connected: boolean;
  readonly updatedAt: number;
}): EpicAgentsState {
  /*
   * BUILT THROUGH THE REAL BUILDERS, not cast into shape.
   *
   * The first version of this fixture read
   * `{ roots: [], byId: {} } as unknown as ... extends ... ? T : never` -
   * a chained assertion that compiles against ANY shape, which is the exact
   * fixture trap this project has now hit five times and the one the lint
   * rules deliberately do NOT cover. eslint caught it here (chained
   * assertion + `as unknown`) where a rule written for it would have needed
   * to be unlivably broad.
   */
  return {
    kind: "ready",
    chats: [],
    tree: buildChatTree([]),
    artifacts: buildArtifactTree([]),
    connected: args.connected,
    updatedAt: args.updatedAt,
  };
}

describe("every member of EpicConnectionState is reachable", () => {
  it("produces all four kinds, so none is a renderer for nothing", () => {
    /*
     * THE test this file exists for. `stale` was unreachable for the whole
     * life of the status strip, and every existing test passed throughout.
     *
     * Bound to a Set comparison rather than four assertions, so the failure
     * message names WHICH kind is missing rather than which line broke.
     */
    const produced = new Set<EpicConnectionState["kind"]>([
      toEpicConnectionState({
        agents: { kind: "loading", phase: "connecting" } as EpicAgentsState,
        now: NOW,
      }).kind,
      toEpicConnectionState({
        agents: { kind: "error", detail: "gone" },
        now: NOW,
      }).kind,
      toEpicConnectionState({
        agents: ready({ connected: true, updatedAt: NOW }),
        now: NOW,
      }).kind,
      toEpicConnectionState({
        agents: ready({ connected: false, updatedAt: NOW - 5_000 }),
        now: NOW,
      }).kind,
    ]);

    expect([...produced].sort()).toEqual([
      "error",
      "live",
      "loading",
      "stale",
    ]);
  });
});

describe("staleness is DISCONNECTION, not age", () => {
  it("calls a long-idle but connected epic LIVE, not stale", () => {
    /*
     * Nothing changed for an hour: the rows on screen are current, and a
     * warning here would be false. Getting this backwards puts a banner on
     * every healthy idle epic, which trains people to ignore the banner —
     * and a warning everyone ignores still looks like coverage.
     *
     * Mutation: trigger on `now - updatedAt > threshold`. This flips to
     * "stale".
     */
    const state = toEpicConnectionState({
      agents: ready({ connected: true, updatedAt: NOW - 3_600_000 }),
      now: NOW,
    });
    expect(state.kind).toBe("live");
  });

  it("calls a just-disconnected epic STALE, however recent the data", () => {
    // The instant the socket drops, every row becomes a claim about the past.
    const state = toEpicConnectionState({
      agents: ready({ connected: false, updatedAt: NOW }),
      now: NOW,
    });
    expect(state.kind).toBe("stale");
  });
});

describe("the age is the payload, and it is never omitted", () => {
  it("carries a real age rather than an empty or placeholder label", () => {
    /*
     * "Disconnected" alone asks the user to judge whether what they see is
     * still true while withholding the only fact that decides it. Eight
     * seconds and eight hours produce identical banners and OPPOSITE correct
     * actions.
     *
     * Asserted as two distinct inputs producing two DIFFERENT labels, not as
     * one label matching a string: a mapping that hard-coded "a while ago"
     * would satisfy any single-value assertion.
     */
    const recent = toEpicConnectionState({
      agents: ready({ connected: false, updatedAt: NOW - 8_000 }),
      now: NOW,
    });
    const old = toEpicConnectionState({
      agents: ready({ connected: false, updatedAt: NOW - 8 * 3_600_000 }),
      now: NOW,
    });

    expect(recent.kind).toBe("stale");
    expect(old.kind).toBe("stale");
    if (recent.kind !== "stale" || old.kind !== "stale") return;

    expect(recent.ageLabel).toBe("8s ago");
    expect(old.ageLabel).not.toBe(recent.ageLabel);
    expect(old.ageLabel).not.toBe("");
    // The placeholder `relativeTime` returns for a null timestamp. Seeing it
    // here would mean the age never reached the mapping.
    expect(recent.ageLabel).not.toBe("—");
  });
});

describe("loading and error are unchanged by the split", () => {
  it("maps loading through", () => {
    expect(
      toEpicConnectionState({
        agents: { kind: "loading", phase: "subscribing" } as EpicAgentsState,
        now: NOW,
      }),
    ).toEqual({ kind: "loading" });
  });

  it("maps error through", () => {
    expect(
      toEpicConnectionState({
        agents: { kind: "error", detail: "stream closed" },
        now: NOW,
      }),
    ).toEqual({ kind: "error" });
  });
});
