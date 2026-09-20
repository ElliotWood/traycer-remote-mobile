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
  runFinishedEventId,
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
    const tick = [
      status({ chatId: "c-1", pendingApprovals: [approval("a-1")] }),
    ];

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
    // `in` rather than `e.kind`: the union now carries a `finished` member
    // with no `kind` at all, and that is deliberate — see `watch-events.ts`.
    expect(events.map((e) => ("kind" in e ? e.kind : null))).toEqual([
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

describe("a run that finishes", () => {
  it("emits finished on the running → idle tick, and only that tick", () => {
    /*
     * The defect this exists for: an assessment started from Teams runs for
     * minutes or hours, finishes, and nobody is told. `wpro-retail-run`
     * records the live instance — the answer was produced and the requester
     * had to come and ask for it.
     *
     * Mutation: emit on `runStatus === "idle"` without the `running.delete`
     * guard. The first assertion still passes and the third fails — which is
     * why the third is here. A level test announces a completion every tick
     * for the rest of the chat's life.
     */
    const tracker = new WatchEventTracker();

    expect(
      ids(tracker.diff(EPIC, [status({ chatId: "c-1" })])),
    ).toEqual([]);
    expect(
      ids(tracker.diff(EPIC, [status({ chatId: "c-1", runStatus: "idle" })])),
    ).toEqual([`finished:${runFinishedEventId("c-1")}`]);
    expect(
      tracker.diff(EPIC, [status({ chatId: "c-1", runStatus: "idle" })]),
    ).toEqual([]);
  });

  it("says nothing about a chat that was already idle when watching began", () => {
    // A bridge restart re-reads every chat in the epic. Firing on the level
    // would announce a completion for each of them, for work that finished
    // before anyone was listening.
    const tracker = new WatchEventTracker();
    expect(
      tracker.diff(EPIC, [
        status({ chatId: "c-1", runStatus: "idle" }),
        status({ chatId: "c-2", runStatus: "idle" }),
      ]),
    ).toEqual([]);
  });

  it("does not call a stopping run finished", () => {
    // A cancellation still has to land. Reporting it as done would tell the
    // requester there is an answer waiting when there is not.
    const tracker = new WatchEventTracker();
    tracker.diff(EPIC, [status({ chatId: "c-1" })]);
    expect(
      tracker.diff(EPIC, [status({ chatId: "c-1", runStatus: "stopping" })]),
    ).toEqual([]);
    expect(
      ids(tracker.diff(EPIC, [status({ chatId: "c-1", runStatus: "idle" })])),
    ).toEqual([`finished:${runFinishedEventId("c-1")}`]);
  });

  it("stays silent for a disconnected chat, which is unknown rather than idle", () => {
    // Same guard as `resolved`: a dropped subscription reports the last frame
    // the bridge saw, so treating it as idle would announce a completion for
    // a run that is still going.
    const tracker = new WatchEventTracker();
    tracker.diff(EPIC, [status({ chatId: "c-1" })]);
    expect(
      tracker.diff(EPIC, [
        status({ chatId: "c-1", runStatus: "idle", connected: false }),
      ]),
    ).toEqual([]);
  });

  it("carries the chat title, so the reply can name what finished", () => {
    const tracker = new WatchEventTracker();
    tracker.diff(EPIC, [status({ chatId: "c-1", title: "Wipro retail" })]);
    const [event] = tracker.diff(EPIC, [
      status({ chatId: "c-1", title: "Wipro retail", runStatus: "idle" }),
    ]);
    expect(event).toEqual({
      type: "finished",
      eventId: "run.finished:c-1",
      epicId: EPIC,
      chatId: "c-1",
      chatTitle: "Wipro retail",
    });
  });

  it("reports the approval's resolution before the run's end", () => {
    // Order is the message order in Teams: "that approval has been handled",
    // then "it finished". The reverse reads as a completion that still wants
    // something from you.
    const tracker = new WatchEventTracker();
    tracker.diff(EPIC, [
      status({ chatId: "c-1", pendingApprovals: [approval("a-1")] }),
    ]);
    expect(
      ids(tracker.diff(EPIC, [status({ chatId: "c-1", runStatus: "idle" })])),
    ).toEqual([
      `resolved:${approvalEventId("c-1", "a-1")}`,
      `finished:${runFinishedEventId("c-1")}`,
    ]);
  });
});
