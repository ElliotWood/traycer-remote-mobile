/**
 * The load-bearing test here is the FIRST one, and it is a contract test on
 * purpose.
 *
 * The tab recorded `epic.create` as blocked on "ABSOLUTE FILESYSTEM PATHS a
 * Teams user cannot supply". Rebutting that with a hand-written expectation
 * would prove only that this module builds the object this test expects. So
 * the request is parsed against the REAL `createEpicRequestSchema` imported
 * from the protocol package: if `workspaces: []` were genuinely invalid, the
 * parse fails and the claim this whole module rests on collapses.
 */
import { describe, expect, it, vi } from "vitest";
import { createEpicRequestSchema } from "@traycer/protocol/host/epic/unary-schemas";
import { RELEASED_FLOOR_METHOD_NAMES } from "@traycer/protocol/host/released-floor";
import {
  FOLDERLESS_WORKSPACE_MODE,
  NEW_EPIC_STATUS,
  buildCreateEpicRequest,
  createEpic,
  pendingEpicIdAfter,
  type CreateEpicInput,
} from "../create-epic";

const INPUT: CreateEpicInput = {
  epicId: "a1000000-0000-4000-8000-000000000001",
  chatId: "a1000000-0000-4000-8000-000000000002",
  hostId: "a1000000-0000-4000-8000-000000000003",
  title: "Audit the auth code",
  initialUserPrompt: "Audit the auth code\n\nStart with tokens.",
  createdBy: "a1000000-0000-4000-8000-000000000004",
  now: 1_770_000_000_000,
};

describe("buildCreateEpicRequest — the folderless claim", () => {
  it("parses against the real createEpicRequestSchema with NO workspaces", () => {
    const parsed = createEpicRequestSchema.safeParse(
      buildCreateEpicRequest(INPUT),
    );
    expect(parsed.success).toBe(true);
  });

  it("sends empty workspaces and repoIdentifiers, not omitted ones", () => {
    // Omission and emptiness are different requests. `workspaces` is not
    // optional in the schema, so leaving it out would fail the parse above
    // while an empty array is a positive statement of "no paths".
    const request = buildCreateEpicRequest(INPUT);
    expect(request.workspaces).toEqual([]);
    expect(request.repoIdentifiers).toEqual([]);
  });

  it("marks the folded chat folderless with no worktree intent", () => {
    const request = buildCreateEpicRequest(INPUT);
    expect(request.chat?.workspaceMode).toBe(FOLDERLESS_WORKSPACE_MODE);
    expect(request.chat?.worktreeIntent).toBeNull();
  });

  it("is on the released floor, so no host can be missing it", () => {
    // The other half of "buildable": a valid request to a method the host may
    // not expose is still not a feature. Asserted against the protocol's own
    // list rather than restated.
    expect(RELEASED_FLOOR_METHOD_NAMES).toContain("epic.create");
  });
});

describe("buildCreateEpicRequest — the epic body", () => {
  it("titles the epic and its first chat identically", () => {
    // Desktop stores the epic untitled and backfills with a server-side title
    // generation this client does not run, which would leave every epic
    // created here reading "Untitled epic" in the fleet.
    const request = buildCreateEpicRequest(INPUT);
    expect(request.epic.title).toBe(INPUT.title);
    expect(request.chat?.title).toBe(INPUT.title);
  });

  it("keeps the user's full prompt on the epic, not the truncated title", () => {
    expect(buildCreateEpicRequest(INPUT).epic.initialUserPrompt).toBe(
      INPUT.initialUserPrompt,
    );
  });

  it("stamps one clock reading on both timestamps", () => {
    const request = buildCreateEpicRequest(INPUT);
    expect(request.epic.createdAt).toBe(INPUT.now);
    expect(request.epic.updatedAt).toBe(INPUT.now);
  });

  it("stamps the acting user as creator, which is what the ownership filter reads", () => {
    expect(buildCreateEpicRequest(INPUT).epic.createdBy).toBe(INPUT.createdBy);
  });

  it("opens the epic in the same status desktop stamps", () => {
    expect(buildCreateEpicRequest(INPUT).epic.status).toBe(NEW_EPIC_STATUS);
  });

  it("carries the host id onto the folded chat, never a default", () => {
    expect(buildCreateEpicRequest(INPUT).chat?.hostId).toBe(INPUT.hostId);
  });

  it("sends no initialMessage rather than inventing an account context", () => {
    // Not an oversight: the field carries a billing `accountContext` this
    // client does not choose. `null` selects the documented
    // send-after-subscribe path. See the module docblock.
    expect(buildCreateEpicRequest(INPUT).chat?.initialMessage).toBeNull();
  });

  it("builds a byte-identical request from identical input, so a retry is one", () => {
    expect(buildCreateEpicRequest(INPUT)).toEqual(
      buildCreateEpicRequest(INPUT),
    );
  });
});

describe("createEpic", () => {
  it("returns the id it sent, because the response carries no epic id", () => {
    const client = {
      request: vi.fn().mockResolvedValue({ roomInfo: null, task: null }),
    };
    return expect(createEpic(client, INPUT)).resolves.toEqual({
      kind: "created",
      epicId: INPUT.epicId,
    });
  });

  it("calls epic.create with the built request", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({ roomInfo: null, task: null }),
    };
    await createEpic(client, INPUT);
    expect(client.request).toHaveBeenCalledWith(
      "epic.create",
      buildCreateEpicRequest(INPUT),
    );
  });

  it("reports a rejection as UNCONFIRMED, never as failed", async () => {
    // The distinction is the point: the request may well have landed.
    const client = {
      request: vi.fn().mockRejectedValue(new Error("socket closed")),
    };
    await expect(createEpic(client, INPUT)).resolves.toEqual({
      kind: "unconfirmed",
      reason: "socket closed",
    });
  });

  it("describes a non-Error rejection rather than rendering [object Object]", async () => {
    const client = { request: vi.fn().mockRejectedValue("gateway timeout") };
    const outcome = await createEpic(client, INPUT);
    expect(outcome).toEqual({ kind: "unconfirmed", reason: "gateway timeout" });
  });
});

describe("pendingEpicIdAfter", () => {
  it("keeps the id after an unconfirmed attempt so a retry is byte-identical", () => {
    expect(
      pendingEpicIdAfter(
        { kind: "unconfirmed", reason: "socket closed" },
        INPUT.epicId,
      ),
    ).toBe(INPUT.epicId);
  });

  it("clears it on success so the next create is a genuinely new epic", () => {
    expect(
      pendingEpicIdAfter(
        { kind: "created", epicId: INPUT.epicId },
        INPUT.epicId,
      ),
    ).toBeNull();
  });
});
