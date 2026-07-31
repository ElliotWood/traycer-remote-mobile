import { describe, expect, it } from "vitest";
import type { EpicChatEntry } from "@traycer-clients/shared/epic/epic-doc-chats";
import {
  actionabilityReason,
  chatActionability,
  type Actionability,
} from "../actionability";

const HOST = "host-aaaa-bbbb";

function chat(hostId: string | null): EpicChatEntry {
  return {
    chatId: "c1",
    title: "An agent",
    parentId: null,
    createdAt: 0,
    updatedAt: 0,
    hostId,
  };
}

const OWNER_LIVE = { canAct: true, role: "owner" } as const;

describe("actionability — the two gates answer different questions", () => {
  it("owner + live stream + this host is the only actionable combination", () => {
    expect(chatActionability(chat(HOST), HOST, OWNER_LIVE)).toEqual({
      kind: "actionable",
    });
  });

  it("CONTRACT: a viewer is a viewer even on a local, live chat", () => {
    // Gating on locality alone would show approve and reject to someone who
    // is not allowed to use them.
    expect(
      chatActionability(chat(HOST), HOST, { canAct: true, role: "viewer" }),
    ).toEqual({ kind: "viewer" });
  });

  it("CONTRACT: permission is checked before locality, so the reason is the right one", () => {
    // A viewer looking at a chat on another machine is told they are a
    // viewer. "It runs elsewhere" would explain the wrong reason, and
    // fixing that would not make the buttons work.
    expect(
      chatActionability(chat("host-elsewhere"), HOST, {
        canAct: true,
        role: "viewer",
      }),
    ).toEqual({ kind: "viewer" });
  });

  it("CONTRACT: a viewer on a dead stream is told they are a viewer", () => {
    // The two gates can both be closed at once, and the ORDER decides which
    // sentence the user gets. "Reconnecting — approving is paused until the
    // connection is back" promises a viewer something that will never
    // arrive; being a viewer is the durable fact and the reconnect is not.
    //
    // This case is the only one that distinguishes the two orderings: with
    // the checks swapped, every other assertion in this file still passes.
    expect(
      chatActionability(chat(HOST), HOST, { canAct: false, role: "viewer" }),
    ).toEqual({ kind: "viewer" });
  });

  it("CONTRACT: canAct === false is 'stream not live', not 'other host'", () => {
    // `canAct` folds role and connection. For a non-viewer it means the
    // stream is not currently open — a temporary state with a different
    // remedy from a chat that lives somewhere else.
    expect(
      chatActionability(chat(HOST), HOST, { canAct: false, role: "owner" }),
    ).toEqual({ kind: "stream-not-live" });
  });

  it("CONTRACT: neither gate implies the other", () => {
    // Live stream, foreign chat → not actionable. Local chat, dead stream →
    // not actionable. The first version of this module had only the second
    // gate.
    expect(
      chatActionability(chat("host-elsewhere"), HOST, OWNER_LIVE).kind,
    ).not.toBe("actionable");
    expect(
      chatActionability(chat(HOST), HOST, { canAct: false, role: "owner" })
        .kind,
    ).not.toBe("actionable");
  });
});

describe("actionability — locality", () => {
  it("a chat bound to another host is 'other-host'", () => {
    expect(chatActionability(chat("host-elsewhere"), HOST, OWNER_LIVE)).toEqual({
      kind: "other-host",
    });
  });

  it("CONTRACT: an unreplicated hostId is 'unknown', never 'actionable'", () => {
    // `null` means not-yet-replicated. Absence of a proven capability is not
    // a capability, so the frame is not sent.
    expect(chatActionability(chat(null), HOST, OWNER_LIVE)).toEqual({
      kind: "unknown",
    });
  });

  it("CONTRACT: a build with no configured host id is 'unknown', not 'actionable'", () => {
    // Defaulting to this-host on an unconfigured build would render every
    // agent as actionable — approve buttons that reach nothing and report
    // success twice over.
    expect(chatActionability(chat(HOST), "", OWNER_LIVE)).toEqual({
      kind: "unknown",
    });
  });

  it("CONTRACT: 'unknown' and 'other-host' stay distinct states", () => {
    // They are treated the same for ACTING and worded differently, because
    // "runs elsewhere" and "we don't know" are different facts and only one
    // of them is something we observed.
    expect(chatActionability(chat(null), HOST, OWNER_LIVE).kind).not.toBe(
      chatActionability(chat("host-elsewhere"), HOST, OWNER_LIVE).kind,
    );
  });
});

describe("actionability — what the user is told", () => {
  const ALL: readonly Actionability[] = [
    { kind: "actionable" },
    { kind: "viewer" },
    { kind: "stream-not-live" },
    { kind: "other-host" },
    { kind: "unknown" },
  ];

  it("CONTRACT: only the actionable state is silent", () => {
    // The absence of a button has to be explained BEFORE the user reaches
    // for it — an unexplained missing control is this project's most
    // repeated bug wearing a different hat.
    for (const state of ALL) {
      const reason = actionabilityReason(state);
      if (state.kind === "actionable") {
        expect(reason).toBeNull();
      } else {
        expect((reason ?? "").trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("CONTRACT: every non-actionable state gives a DIFFERENT reason", () => {
    // Four states collapsing onto one sentence would tell the user nothing
    // about which of four remedies applies.
    const reasons = ALL.filter((s) => s.kind !== "actionable").map((s) =>
      actionabilityReason(s),
    );
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it("CONTRACT: no reason claims the chat itself is read-only or unreachable", () => {
    // Both would be claims about the chat. All this client knows is its own
    // position.
    for (const state of ALL) {
      expect(actionabilityReason(state) ?? "").not.toMatch(
        /read-only|unreachable/i,
      );
    }
  });

  it("the other-host reason points at something that would actually work", () => {
    expect(actionabilityReason({ kind: "other-host" }) ?? "").toMatch(
      /desktop|that host/i,
    );
  });

  it("the unknown reason says we cannot tell, not that it runs elsewhere", () => {
    const reason = actionabilityReason({ kind: "unknown" }) ?? "";
    expect(reason).toMatch(/can[’']?t tell|don[’']?t know/i);
    expect(reason).not.toMatch(/runs on another machine/i);
  });

  it("the viewer reason is about access, and the stream one about the connection", () => {
    expect(actionabilityReason({ kind: "viewer" }) ?? "").toMatch(
      /view-only|access/i,
    );
    expect(actionabilityReason({ kind: "stream-not-live" }) ?? "").toMatch(
      /reconnect/i,
    );
  });
});
