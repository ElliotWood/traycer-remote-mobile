import { describe, expect, it, vi } from "vitest";
import {
  MAX_TITLE_LENGTH,
  buildCreateChatRequest,
  createChat,
  pendingChatIdAfter,
  titleFromInstruction,
} from "../create-chat";

describe("titleFromInstruction", () => {
  it("takes the first non-empty line, not the first N characters", () => {
    expect(
      titleFromInstruction("Audit the auth code\n\nStart with tokens."),
    ).toBe("Audit the auth code");
  });

  it("skips leading blank lines rather than titling an agent with nothing", () => {
    expect(titleFromInstruction("\n\n  Fix the deploy gate  \nthen ship")).toBe(
      "Fix the deploy gate",
    );
  });

  it("returns null when there is no usable line, so a blank title cannot reach the host", () => {
    // The host would ACCEPT "" — it is not a validation error it rejects for
    // us — and the agent would be unnamed for life. Hence null, not "".
    expect(titleFromInstruction("")).toBeNull();
    expect(titleFromInstruction("   \n\t\n  ")).toBeNull();
  });

  it("caps a long first line with an ellipsis and stays within the cap", () => {
    const title = titleFromInstruction("x".repeat(400));
    expect(title).not.toBeNull();
    expect(title?.length).toBe(MAX_TITLE_LENGTH);
    expect(title?.endsWith("…")).toBe(true);
  });

  it("does not cap a line that is exactly at the limit", () => {
    const exact = "y".repeat(MAX_TITLE_LENGTH);
    expect(titleFromInstruction(exact)).toBe(exact);
  });
});

describe("buildCreateChatRequest", () => {
  it("defaults parentId to null — a top-level agent, never undefined", () => {
    const request = buildCreateChatRequest({
      epicId: "e1",
      chatId: "c1",
      hostId: "h1",
      title: "t",
    });
    expect(request.parentId).toBeNull();
  });

  it("CONTRACT: builds the identical request twice, which is what makes a retry safe", () => {
    const input = { epicId: "e1", chatId: "c1", hostId: "h1", title: "t" };
    expect(buildCreateChatRequest(input)).toEqual(
      buildCreateChatRequest(input),
    );
  });
});

describe("pendingChatIdAfter — the rule that stands between a retry and two agents", () => {
  it("keeps the id after unconfirmed, so the retry is the SAME request", () => {
    expect(
      pendingChatIdAfter(
        { kind: "unconfirmed", reason: "socket closed" },
        "c1",
      ),
    ).toBe("c1");
  });

  it("clears the id after created, so the NEXT create is a new agent", () => {
    // The inverse failure: holding the id would make a second, deliberate
    // create resolve idempotently to the first chat and appear to do nothing.
    expect(
      pendingChatIdAfter({ kind: "created", chatId: "c1" }, "c1"),
    ).toBeNull();
  });
});

describe("createChat", () => {
  it("reports created and prefers the host's chat id over the one we sent", async () => {
    const request = vi.fn().mockResolvedValue({ chatId: "host-authoritative" });
    const outcome = await createChat({ request } as never, {
      epicId: "e1",
      chatId: "client-minted",
      hostId: "h1",
      title: "t",
    });
    expect(outcome).toEqual({ kind: "created", chatId: "host-authoritative" });
  });

  it("sends the client-minted chatId, so the host can dedupe a retry", async () => {
    const request = vi.fn().mockResolvedValue({ chatId: "c1" });
    await createChat({ request } as never, {
      epicId: "e1",
      chatId: "c1",
      hostId: "h1",
      title: "t",
    });
    expect(request).toHaveBeenCalledWith(
      "epic.createChat",
      expect.objectContaining({ chatId: "c1", hostId: "h1" }),
    );
  });

  it("reports unconfirmed rather than throwing, and carries the reason", async () => {
    const request = vi.fn().mockRejectedValue(new Error("socket closed"));
    const outcome = await createChat({ request } as never, {
      epicId: "e1",
      chatId: "c1",
      hostId: "h1",
      title: "t",
    });
    expect(outcome).toEqual({ kind: "unconfirmed", reason: "socket closed" });
  });

  it("CONTRACT: a retry after unconfirmed sends the SAME chatId — the whole idempotency argument", async () => {
    // The failure this guards is minting a fresh id per attempt, which turns
    // one safe retry into two agents and would pass every other test here.
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket closed"))
      .mockResolvedValueOnce({ chatId: "c1" });
    const input = { epicId: "e1", chatId: "c1", hostId: "h1", title: "t" };

    const first = await createChat({ request } as never, input);
    expect(first.kind).toBe("unconfirmed");
    const second = await createChat({ request } as never, input);
    expect(second).toEqual({ kind: "created", chatId: "c1" });

    const [, firstBody] = request.mock.calls[0] as [string, { chatId: string }];
    const [, secondBody] = request.mock.calls[1] as [
      string,
      { chatId: string },
    ];
    expect(secondBody.chatId).toBe(firstBody.chatId);
  });
});
