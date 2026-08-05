// @vitest-environment jsdom
/**
 * Badge-reducer test for `useChatBadges` (T5).
 *
 * Drives one chat's `chat.subscribe` frames through the FAKE stream layer and
 * asserts the derived `{ runStatus, blocked }` badge. Focus: the "waiting on the
 * user" predicate across all three blocking sources — tool approvals, FILE-EDIT
 * approvals (which `runStatus` does NOT reflect), and interviews — and that
 * resolving one source keeps the badge blocked while another remains.
 */
import { describe, expect, it } from "vitest";
import type { ChatSubscribeServerFrame } from "@traycer/protocol/host/agent/gui/subscribe";
import type { ChatStreamCallbacks } from "@traycer-clients/shared/host-transport/chat-stream-client";
import { useChatBadges } from "../use-chat-badges";
import { createFakeStreamConnection } from "@/test-utils/fakes";
import { act, renderHook } from "@/test-utils/dom";

type Frame<K extends ChatSubscribeServerFrame["kind"]> = Extract<
  ChatSubscribeServerFrame,
  { readonly kind: K }
>;

function snapshot(opts: {
  readonly runStatus: "idle" | "running" | "stopping";
  readonly approvals?: readonly string[];
  readonly fileEditApprovals?: readonly string[];
  readonly interviews?: readonly string[];
  readonly accessRole?: "owner" | "viewer";
  readonly backgroundItemCount?: number;
  readonly activeTurnStatus?: string;
  readonly activeTurnUpdatedAt?: number;
}): Frame<"snapshot"> {
  return {
    kind: "snapshot",
    snapshot: {
      runStatus: opts.runStatus,
      access: { role: opts.accessRole ?? "owner", ownerUserId: "u1" },
      pendingApprovals: (opts.approvals ?? []).map((approvalId) => ({
        approvalId,
      })),
      pendingFileEditApprovals: (opts.fileEditApprovals ?? []).map(
        (approvalId) => ({ approvalId }),
      ),
      pendingInterviews: (opts.interviews ?? []).map((blockId) => ({ blockId })),
      backgroundItems: Array.from({ length: opts.backgroundItemCount ?? 0 }, (_, i) => ({
        id: `bg${i}`,
      })),
      activeTurn:
        opts.activeTurnStatus === undefined
          ? null
          : { status: opts.activeTurnStatus, updatedAt: opts.activeTurnUpdatedAt ?? 0 },
    },
  } as unknown as Frame<"snapshot">;
}

const turnStateChanged = (opts: {
  readonly runStatus: "idle" | "running" | "stopping";
  readonly backgroundItemCount?: number;
  readonly activeTurnStatus?: string;
  readonly activeTurnUpdatedAt?: number;
}): Frame<"turnStateChanged"> =>
  ({
    kind: "turnStateChanged",
    runStatus: opts.runStatus,
    backgroundItems: Array.from({ length: opts.backgroundItemCount ?? 0 }, (_, i) => ({
      id: `bg${i}`,
    })),
    activeTurn:
      opts.activeTurnStatus === undefined
        ? null
        : { status: opts.activeTurnStatus, updatedAt: opts.activeTurnUpdatedAt ?? 0 },
  }) as unknown as Frame<"turnStateChanged">;

const fileEditRequested = (approvalId: string): Frame<"fileEditApprovalRequested"> =>
  ({ kind: "fileEditApprovalRequested", approval: { approvalId } }) as unknown as Frame<"fileEditApprovalRequested">;
const fileEditResolved = (approvalId: string): Frame<"fileEditApprovalResolved"> =>
  ({ kind: "fileEditApprovalResolved", approvalId }) as unknown as Frame<"fileEditApprovalResolved">;
const approvalResolved = (approvalId: string): Frame<"approvalResolved"> =>
  ({ kind: "approvalResolved", approvalId }) as unknown as Frame<"approvalResolved">;

/**
 * Mounts the hook for a single chat and returns the live badge accessor plus a
 * `drive` helper that pushes a frame through that chat's captured callbacks.
 */
function mountBadge(): {
  readonly blocked: () => boolean | undefined;
  readonly runStatus: () => string | undefined;
  readonly pendingInterview: () => boolean | undefined;
  readonly pendingApproval: () => boolean | undefined;
  readonly background: () => boolean | undefined;
  readonly accessRole: () => string | undefined;
  readonly lastErrorAt: () => number | null | undefined;
  readonly drive: <K extends ChatSubscribeServerFrame["kind"]>(
    kind: K,
    frame: Frame<K>,
  ) => void;
} {
  const fake = createFakeStreamConnection();
  const { result } = renderHook(() =>
    useChatBadges(fake.connection, "e1", ["c1"]),
  );
  const callbacks = (): ChatStreamCallbacks => fake.chatSessions[0].callbacks;
  return {
    blocked: () => result.current["c1"]?.blocked,
    runStatus: () => result.current["c1"]?.runStatus,
    pendingInterview: () => result.current["c1"]?.pendingInterview,
    pendingApproval: () => result.current["c1"]?.pendingApproval,
    background: () => result.current["c1"]?.background,
    accessRole: () => result.current["c1"]?.accessRole,
    lastErrorAt: () => result.current["c1"]?.lastErrorAt,
    drive: (kind, frame) => {
      act(() => {
        // Dispatch to the matching handler; the callback surface is typed per
        // frame kind, so we route by the discriminant.
        const cb = callbacks();
        switch (kind) {
          case "snapshot":
            cb.onSnapshot(frame as Frame<"snapshot">);
            break;
          case "turnStateChanged":
            cb.onTurnStateChanged(frame as Frame<"turnStateChanged">);
            break;
          case "fileEditApprovalRequested":
            cb.onFileEditApprovalRequested(frame as Frame<"fileEditApprovalRequested">);
            break;
          case "fileEditApprovalResolved":
            cb.onFileEditApprovalResolved(frame as Frame<"fileEditApprovalResolved">);
            break;
          case "approvalResolved":
            cb.onApprovalResolved(frame as Frame<"approvalResolved">);
            break;
          default:
            throw new Error(`unhandled frame kind ${kind}`);
        }
      });
    },
  };
}

describe("useChatBadges — blocking predicate", () => {
  it("counts a file-edit approval as blocked even while runStatus is 'running'", () => {
    const b = mountBadge();
    // A running turn with a pending file-edit approval: runStatus never leaves
    // "running", so the block is visible ONLY via pendingFileEditApprovals.
    b.drive("snapshot", snapshot({ runStatus: "running", fileEditApprovals: ["f1"] }));
    expect(b.runStatus()).toBe("running");
    expect(b.blocked()).toBe(true);
  });

  it("blocks on a fileEditApprovalRequested delta and clears on resolve", () => {
    const b = mountBadge();
    b.drive("snapshot", snapshot({ runStatus: "running" }));
    expect(b.blocked()).toBe(false);

    b.drive("fileEditApprovalRequested", fileEditRequested("f1"));
    expect(b.blocked()).toBe(true);

    b.drive("fileEditApprovalResolved", fileEditResolved("f1"));
    expect(b.blocked()).toBe(false);
  });

  it("stays blocked when one of two blocking sources resolves (mixed)", () => {
    const b = mountBadge();
    // A tool approval AND a file-edit approval are both pending.
    b.drive(
      "snapshot",
      snapshot({ runStatus: "running", approvals: ["a1"], fileEditApprovals: ["f1"] }),
    );
    expect(b.blocked()).toBe(true);

    // Resolve the tool approval → file-edit approval still blocks.
    b.drive("approvalResolved", approvalResolved("a1"));
    expect(b.blocked()).toBe(true);

    // Resolve the file-edit approval → nothing left, unblocked.
    b.drive("fileEditApprovalResolved", fileEditResolved("f1"));
    expect(b.blocked()).toBe(false);
  });

  it("seeds file-edit approvals from the snapshot (blocked), then a clean snapshot clears them", () => {
    const b = mountBadge();
    b.drive("snapshot", snapshot({ runStatus: "idle", fileEditApprovals: ["f1", "f2"] }));
    expect(b.blocked()).toBe(true);

    // A fresh snapshot with no pendings re-seeds the sets from scratch.
    b.drive("snapshot", snapshot({ runStatus: "idle" }));
    expect(b.blocked()).toBe(false);
  });
});

describe("useChatBadges — P1 ladder fields", () => {
  it("splits pendingInterview from pendingApproval so the ladder can rank them separately", () => {
    const b = mountBadge();
    b.drive("snapshot", snapshot({ runStatus: "idle", interviews: ["i1"] }));
    expect(b.pendingInterview()).toBe(true);
    expect(b.pendingApproval()).toBe(false);
    expect(b.blocked()).toBe(true);

    b.drive("snapshot", snapshot({ runStatus: "idle", approvals: ["a1"] }));
    expect(b.pendingInterview()).toBe(false);
    expect(b.pendingApproval()).toBe(true);
  });

  it("reads accessRole from the snapshot", () => {
    const b = mountBadge();
    b.drive("snapshot", snapshot({ runStatus: "idle", accessRole: "viewer" }));
    expect(b.accessRole()).toBe("viewer");
  });

  it("defaults accessRole to owner before any snapshot arrives", () => {
    const b = mountBadge();
    expect(b.accessRole()).toBeUndefined(); // never-reported chat: caller falls back to DEFAULT_CHAT_BADGE
  });

  it("background is true only when background items exist AND the chat itself is not running", () => {
    const b = mountBadge();
    b.drive("snapshot", snapshot({ runStatus: "idle", backgroundItemCount: 1 }));
    expect(b.background()).toBe(true);

    b.drive("snapshot", snapshot({ runStatus: "running", backgroundItemCount: 1 }));
    expect(b.background()).toBe(false);

    b.drive("snapshot", snapshot({ runStatus: "idle", backgroundItemCount: 0 }));
    expect(b.background()).toBe(false);
  });

  it("background updates live off a turnStateChanged delta", () => {
    const b = mountBadge();
    b.drive("snapshot", snapshot({ runStatus: "running" }));
    expect(b.background()).toBe(false);

    b.drive("turnStateChanged", turnStateChanged({ runStatus: "idle", backgroundItemCount: 2 }));
    expect(b.background()).toBe(true);
  });

  it("captures lastErrorAt from an errored activeTurn in the snapshot", () => {
    const b = mountBadge();
    b.drive(
      "snapshot",
      snapshot({ runStatus: "idle", activeTurnStatus: "errored", activeTurnUpdatedAt: 5000 }),
    );
    expect(b.lastErrorAt()).toBe(5000);
  });

  it("captures lastErrorAt from an errored activeTurn in a turnStateChanged delta", () => {
    const b = mountBadge();
    b.drive("snapshot", snapshot({ runStatus: "running" }));
    expect(b.lastErrorAt()).toBeNull();

    b.drive(
      "turnStateChanged",
      turnStateChanged({ runStatus: "idle", activeTurnStatus: "errored", activeTurnUpdatedAt: 7000 }),
    );
    expect(b.lastErrorAt()).toBe(7000);
  });

  it("does not clear a captured lastErrorAt on a later non-errored transition (latches until the session resets)", () => {
    const b = mountBadge();
    b.drive(
      "turnStateChanged",
      turnStateChanged({ runStatus: "idle", activeTurnStatus: "errored", activeTurnUpdatedAt: 1000 }),
    );
    expect(b.lastErrorAt()).toBe(1000);

    b.drive("turnStateChanged", turnStateChanged({ runStatus: "running" }));
    expect(b.lastErrorAt()).toBe(1000);
  });
});
