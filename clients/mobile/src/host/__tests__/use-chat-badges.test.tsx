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
}): Frame<"snapshot"> {
  return {
    kind: "snapshot",
    snapshot: {
      runStatus: opts.runStatus,
      pendingApprovals: (opts.approvals ?? []).map((approvalId) => ({
        approvalId,
      })),
      pendingFileEditApprovals: (opts.fileEditApprovals ?? []).map(
        (approvalId) => ({ approvalId }),
      ),
      pendingInterviews: (opts.interviews ?? []).map((blockId) => ({ blockId })),
    },
  } as unknown as Frame<"snapshot">;
}

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
    drive: (kind, frame) => {
      act(() => {
        // Dispatch to the matching handler; the callback surface is typed per
        // frame kind, so we route by the discriminant.
        const cb = callbacks();
        switch (kind) {
          case "snapshot":
            cb.onSnapshot(frame as Frame<"snapshot">);
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
