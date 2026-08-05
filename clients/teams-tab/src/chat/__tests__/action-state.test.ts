import { describe, expect, it } from "vitest";
import {
  actionPhaseMessage,
  actionsEnabled,
  type ActionPhase,
} from "../action-state";

/**
 * One value per member of the union, so the exhaustiveness assertions below
 * cover the whole type rather than the members someone remembered.
 */
const PHASES: Readonly<Record<ActionPhase["kind"], ActionPhase>> = {
  idle: { kind: "idle" },
  pending: { kind: "pending", verb: "Approving" },
  applied: { kind: "applied" },
  rejected: { kind: "rejected", reason: "the file moved" },
  unconfirmed: { kind: "unconfirmed", reason: "the socket dropped" },
};
const ALL: readonly ActionPhase[] = Object.values(PHASES);

describe("action-state — buttons", () => {
  it("CONTRACT: pending disables the buttons", () => {
    // A second click mints a second `clientActionId` and a second frame for
    // the same decision.
    expect(actionsEnabled(PHASES.pending)).toBe(false);
  });

  it("CONTRACT: a settled action does NOT re-arm the buttons", () => {
    // `applied` and `rejected` are answers. Re-enabling after either would
    // invite a second decision on something already decided.
    expect(actionsEnabled(PHASES.applied)).toBe(false);
    expect(actionsEnabled(PHASES.rejected)).toBe(false);
  });

  it("CONTRACT: unconfirmed leaves them live", () => {
    // Constraint 3. "We couldn't confirm this" with dead buttons leaves the
    // user with no move at all; the frame may never have landed.
    expect(actionsEnabled(PHASES.unconfirmed)).toBe(true);
  });

  it("idle is live — the control", () => {
    expect(actionsEnabled(PHASES.idle)).toBe(true);
  });

  it("covers every phase kind", () => {
    expect(new Set(ALL.map((p) => p.kind))).toEqual(
      new Set(["idle", "pending", "applied", "rejected", "unconfirmed"]),
    );
    for (const phase of ALL) {
      expect(typeof actionsEnabled(phase)).toBe("boolean");
    }
  });
});

describe("action-state — the line shown", () => {
  it("idle says nothing at all", () => {
    expect(actionPhaseMessage(PHASES.idle)).toBeNull();
  });

  it("every non-idle phase produces a non-empty line", () => {
    // Silence on a phase that is not idle is the "the button did nothing"
    // failure by omission.
    for (const phase of ALL) {
      if (phase.kind === "idle") continue;
      const line = actionPhaseMessage(phase);
      expect(line).not.toBeNull();
      expect((line ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  it("CONTRACT: pending claims an attempt, never an outcome", () => {
    const line = actionPhaseMessage(PHASES.pending) ?? "";
    expect(line).toContain("Approving");
    // Present continuous. A past tense here would assert the thing happened.
    expect(line).not.toMatch(/\b(approved|done|complete[d]?)\b/i);
  });

  it("names the verb it was given, so two actions in flight read differently", () => {
    expect(actionPhaseMessage({ kind: "pending", verb: "Rejecting" })).toContain(
      "Rejecting",
    );
  });

  it("CONTRACT: unconfirmed never says the action did not happen", () => {
    // Constraint 2. The frame may have landed with no way for this process
    // to learn it did, so "this didn't happen" is FALSE, not pessimistic.
    const line = actionPhaseMessage(PHASES.unconfirmed) ?? "";
    expect(line).not.toMatch(/didn[’']?t happen|did not happen|failed|no effect/i);
  });

  it("CONTRACT: unconfirmed ends with something to DO", () => {
    // Constraint 3. Accurate is not enough — "so do I click it again?" has
    // to be answered, and the honest answer is look first.
    expect(actionPhaseMessage(PHASES.unconfirmed) ?? "").toMatch(/check/i);
  });

  it("CONTRACT: unconfirmed and rejected never read the same", () => {
    // "The host said no" and "we don't know" are different facts, and only
    // one of them is an answer.
    expect(actionPhaseMessage(PHASES.unconfirmed)).not.toBe(
      actionPhaseMessage(PHASES.rejected),
    );
  });

  it("a rejection carries the host's reason when there is one", () => {
    expect(actionPhaseMessage(PHASES.rejected) ?? "").toContain(
      "the file moved",
    );
  });

  it("a rejection with no reason is still a complete sentence", () => {
    const line = actionPhaseMessage({ kind: "rejected", reason: null }) ?? "";
    expect(line.trim().length).toBeGreaterThan(0);
    // Never an empty tail like "The host declined this: ".
    expect(line).not.toMatch(/:\s*$/);
    expect(line).not.toContain("null");
  });

  it("applied is short and unambiguous", () => {
    expect(actionPhaseMessage(PHASES.applied)).toBe("Done.");
  });
});
