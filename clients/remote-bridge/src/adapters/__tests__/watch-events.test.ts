/**
 * The properties that make `bridge watch` an event stream rather than a
 * repeating dump.
 *
 * Fixtures are typed as the REAL {@link ChatStatus}, not cast through
 * `unknown`, for the reason `transcript-projection.test.ts` already records: a
 * schema change should break these fixtures rather than let them drift from
 * what the tracker actually receives.
 *
 * Every assertion here is on WHICH EVENTS ARE EMITTED, never on "it returned
 * something" — the de-duplication and the two unknown-vs-empty guards all pass
 * vacuously against a length check.
 */
import { describe, expect, it } from "vitest";
import type {
  ChatStatus,
  PendingApproval,
  PendingInterview,
} from "../../action-surface";
import {
  WatchEventTracker,
  approvalEventId,
  interviewEventId,
  type WatchEvent,
} from "../watch-events";

const EPIC = "e-1";

function approval(approvalId: string): PendingApproval {
  return {
    approvalId,
    toolName: "Bash",
    description: "rm -rf build",
    requestedAt: 1000,
  };
}

function interview(blockId: string): PendingInterview {
  return {
    blockId,
    requestedAt: 2000,
    title: "Which database?",
    description: "Pick one",
    questions: null,
  };
}

function status(over: Partial<ChatStatus> & { chatId: string }): ChatStatus {
  return {
    title: "Agent A",
    runStatus: "running",
    pendingApprovals: [],
    pendingInterviews: [],
    connected: true,
    ...over,
  };
}

function ids(events: readonly WatchEvent[]): readonly string[] {
  return events.map((e) => `${e.type}:${e.eventId}`);
}

describe("a still-pending approval is announced once, not every tick", () => {
  it("emits on the tick it appears and nothing on identical later ticks", () => {
    /*
     * THE test this file exists for — the four-second repeat was the whole
     * defect.
     *
     * Mutation: delete `if (this.open.has(eventId)) continue`. The second and
     * third assertions fail. Note the FIRST would still pass, which is why
     * all three are here: "it emitted something" is true of the broken code.
     */
    const tracker = new WatchEventTracker();
    const tick = [status({ chatId: "c-1", pendingApprovals: [approval("a-1")] })];

    expect(ids(tracker.diff(EPIC, tick))).toEqual([
      `appeared:${approvalEventId("c-1", "a-1")}`,
    ]);
    expect(tracker.diff(EPIC, tick)).toEqual([]);
    expect(tracker.diff(EPIC, tick)).toEqual([]);
  });

  it("carries the fields a consumer needs to label the card, not just an id", () => {
    const tracker = new WatchEventTracker();
    const [event] = tracker.diff(EPIC, [
      status({ chatId: "c-1", pendingApprovals: [approval("a-1")] }),
    ]);
    expect(event).toEqual({
      type: "appeared",
      eventId: "approval.requested:c-1:a-1",
      kind: "approval.requested",
      epicId: EPIC,
      chatId: "c-1",
      chatTitle: "Agent A",
      approvalId: "a-1",
      toolName: "Bash",
      description: "rm -rf build",
      requestedAt: 1000,
    });
  });
});

describe("resolution", () => {
  it("emits resolved once the approval stops being pending", () => {
    const tracker = new WatchEventTracker();
    tracker.diff(EPIC, [
      status({ chatId: "c-1", pendingApprovals: [approval("a-1")] }),
    ]);

    expect(ids(tracker.diff(EPIC, [status({ chatId: "c-1" })]))).toEqual([
      `resolved:${approvalEventId("c-1", "a-1")}`,
    ]);
    // ...and only once. Resolution is an edge, not a state.
    expect(tracker.diff(EPIC, [status({ chatId: "c-1" })])).toEqual([]);
  });

  it("announces again if the same chat raises a NEW approval id", () => {
    const tracker = new WatchEventTracker();
    tracker.diff(EPIC, [
      status({ chatId: "c-1", pendingApprovals: [approval("a-1")] }),
    ]);
    tracker.diff(EPIC, [status({ chatId: "c-1" })]);

    expect(
      ids(
        tracker.diff(EPIC, [
          status({ chatId: "c-1", pendingApprovals: [approval("a-2")] }),
        ]),
      ),
    ).toEqual([`appeared:${approvalEventId("c-1", "a-2")}`]);
  });
});

describe("unknown is not empty — the two guards that prevent a false retraction", () => {
  it("does NOT resolve on a disconnected chat, and does not re-announce on reconnect", () => {
    /*
     * `ChatStatus.connected: false` means the pending lists are the last frame
     * seen before the subscription dropped. A dropped subscription is
     * indistinguishable from "everything was just answered" if you diff
     * against it — and the consequence is a retracted card for a decision
     * nobody made.
     *
     * Mutation: delete `if (!status.connected) continue`. The first assertion
     * fails with a spurious `resolved`, and the third then fails too, because
     * the reconnect re-announces an approval the consumer was already told
     * about.
     */
    const tracker = new WatchEventTracker();
    tracker.diff(EPIC, [
      status({ chatId: "c-1", pendingApprovals: [approval("a-1")] }),
    ]);

    const dropped = tracker.diff(EPIC, [
      status({ chatId: "c-1", connected: false, pendingApprovals: [] }),
    ]);
    expect(dropped).toEqual([]);

    // Still open, so the reconnect — with the approval genuinely still
    // pending — is silent rather than a duplicate announcement.
    const reconnected = tracker.diff(EPIC, [
      status({ chatId: "c-1", pendingApprovals: [approval("a-1")] }),
    ]);
    expect(reconnected).toEqual([]);
  });

  it("does NOT resolve a chat that was absent from this tick's observations", () => {
    /*
     * `runWatch` omits a chat whose `getStatus` threw. Treating that absence
     * as resolution would retract cards for every chat during a host blip.
     *
     * Mutation: delete `if (!usableChats.has(record.chatId)) continue`. The
     * first assertion fails.
     */
    const tracker = new WatchEventTracker();
    tracker.diff(EPIC, [
      status({ chatId: "c-1", pendingApprovals: [approval("a-1")] }),
      status({ chatId: "c-2", pendingApprovals: [approval("a-2")] }),
    ]);

    // c-1 read fine and is genuinely clear; c-2 could not be read at all.
    expect(ids(tracker.diff(EPIC, [status({ chatId: "c-1" })]))).toEqual([
      `resolved:${approvalEventId("c-1", "a-1")}`,
    ]);

    // c-2 comes back still pending — and is not re-announced.
    expect(
      tracker.diff(EPIC, [
        status({ chatId: "c-2", pendingApprovals: [approval("a-2")] }),
      ]),
    ).toEqual([]);
  });
});

describe("the two blocking kinds stay distinguishable", () => {
  it("gives interviews their own id namespace and kind", () => {
    const tracker = new WatchEventTracker();
    const events = tracker.diff(EPIC, [
      status({
        chatId: "c-1",
        pendingApprovals: [approval("x")],
        pendingInterviews: [interview("x")],
      }),
    ]);

    // Same raw id, different events — a bare `x` key would collapse them and
    // silently drop the interview.
    expect(ids(events)).toEqual([
      `appeared:${approvalEventId("c-1", "x")}`,
      `appeared:${interviewEventId("c-1", "x")}`,
    ]);
    expect(events.map((e) => e.kind)).toEqual([
      "approval.requested",
      "interview.requested",
    ]);
  });

  it("tracks two approvals in one chat as two events", () => {
    const tracker = new WatchEventTracker();
    tracker.diff(EPIC, [
      status({
        chatId: "c-1",
        pendingApprovals: [approval("a-1"), approval("a-2")],
      }),
    ]);

    // One answered, one not: exactly one resolution.
    expect(
      ids(
        tracker.diff(EPIC, [
          status({ chatId: "c-1", pendingApprovals: [approval("a-2")] }),
        ]),
      ),
    ).toEqual([`resolved:${approvalEventId("c-1", "a-1")}`]);
  });
});
