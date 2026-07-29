// @vitest-environment jsdom
/**
 * Render + contract tests for authoring a new agent (T7, Flow 5).
 *
 * Mocks the host client's `request`: the flow first resolves a model via
 * `agent.listHarnessModels`, then dispatches `epic.createChat` with the typed
 * instruction folded into `initialMessage`. Asserts the request body carries
 * every required field with the optional workspace/settings knobs ABSENT
 * (R1/R2), that a successful create navigates to the minted chat, that a
 * rejected create (or an empty model list) shows an inline error without
 * navigating, and — the strongest guard — that the built body parses against the
 * REAL `createChatRequestSchema`.
 */
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { createChatRequestSchema } from "@traycer/protocol/host/epic/unary-schemas";
import type { ListHarnessModelsResponse } from "@traycer/protocol/host/agent/shared";
import { AuthorView } from "@/views/author-view";
import { buildCreateChatRequest } from "@/host/use-create-chat";
import { createFakeHostClient, type FakeHostClient } from "@/test-utils/fakes";
import { render, screen, waitFor } from "@/test-utils/dom";

const MODELS_RESPONSE: ListHarnessModelsResponse = {
  harnessId: "claude",
  models: [
    { id: "test-model", reasoningEfforts: [], fastModeAvailable: false },
    { id: "other-model", reasoningEfforts: [], fastModeAvailable: false },
  ],
};

/** A `request` fake routed by method: models list then a create echo. */
function requestImpl(opts: {
  readonly models?: ListHarnessModelsResponse;
  readonly createChat?: (params: {
    readonly chatId: string;
  }) => Promise<{ chatId: string; initialTurnStarted?: boolean }>;
}): (method: string, params: unknown) => Promise<unknown> {
  return (method, params) => {
    if (method === "agent.listHarnessModels") {
      return Promise.resolve(opts.models ?? MODELS_RESPONSE);
    }
    if (method === "epic.createChat") {
      const p = params as { chatId: string };
      return opts.createChat !== undefined
        ? opts.createChat(p)
        : Promise.resolve({ chatId: p.chatId, initialTurnStarted: true });
    }
    throw new Error(`unexpected method ${method}`);
  };
}

function renderAuthor(
  fake: FakeHostClient,
  onCreated: (chatId: string) => void,
): void {
  render(
    <AuthorView
      epicId="e1"
      client={fake.client}
      onCreated={onCreated}
      onCancel={() => {}}
    />,
  );
}

/** The single `epic.createChat` request body the flow dispatched. */
function createChatBody(fake: FakeHostClient): Record<string, unknown> {
  const call = fake.request.mock.calls.find((c) => c[0] === "epic.createChat");
  if (call === undefined) {
    throw new Error("epic.createChat was never called");
  }
  return call[1] as Record<string, unknown>;
}

describe("AuthorView", () => {
  it("resolves a model then dispatches epic.createChat with the instruction and no workspace/settings", async () => {
    const fake = createFakeHostClient(requestImpl({}));
    renderAuthor(fake, () => {});

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Instruction"), "Add a health check");
    await user.click(screen.getByRole("button", { name: "Start agent" }));

    await waitFor(() => {
      expect(
        fake.request.mock.calls.some((c) => c[0] === "epic.createChat"),
      ).toBe(true);
    });

    // Model resolution ran first, for the default harness, with no senderAgentId.
    expect(fake.request).toHaveBeenCalledWith("agent.listHarnessModels", {
      epicId: "e1",
      senderAgentId: null,
      harnessId: "claude",
    });

    const body = createChatBody(fake);
    // Required top-level fields all present.
    expect(body.epicId).toBe("e1");
    expect(body.parentId).toBeNull();
    expect(body.hostId).toBe("mobile-host");
    expect(typeof body.title).toBe("string");
    expect((body.title as string).length).toBeGreaterThan(0);
    expect(typeof body.chatId).toBe("string");
    // Optional workspace/settings knobs deliberately omitted (R1/R2).
    expect("workspaceMode" in body).toBe(false);
    expect("worktreeIntent" in body).toBe(false);
    expect("settings" in body).toBe(false);

    // initialMessage carries the instruction + the resolved (not hardcoded) model.
    const initialMessage = body.initialMessage as {
      content: unknown;
      sender: { type: string; userId: string };
      settings: { harnessId: string; model: string; permissionMode: string };
    };
    expect(JSON.stringify(initialMessage.content)).toContain("Add a health check");
    expect(initialMessage.sender).toEqual({ type: "user", userId: "user-1" });
    expect(initialMessage.settings.harnessId).toBe("claude");
    expect(initialMessage.settings.model).toBe("test-model");
    expect(initialMessage.settings.permissionMode).toBe("supervised");
  });

  it("navigates to the minted chat on a successful create", async () => {
    const fake = createFakeHostClient(requestImpl({}));
    const onCreated = vi.fn();
    renderAuthor(fake, onCreated);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Instruction"), "Do the thing");
    await user.click(screen.getByRole("button", { name: "Start agent" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    // The chat opened is the one whose id was minted into the request body.
    expect(onCreated).toHaveBeenCalledWith(createChatBody(fake).chatId);
  });

  it("shows an inline error and does not navigate when the create is rejected", async () => {
    const fake = createFakeHostClient(
      requestImpl({
        createChat: () => Promise.reject(new Error("host said no")),
      }),
    );
    const onCreated = vi.fn();
    renderAuthor(fake, onCreated);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Instruction"), "Break something");
    await user.click(screen.getByRole("button", { name: "Start agent" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("host said no");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("shows an inline error and never creates when no model can be resolved", async () => {
    const fake = createFakeHostClient(
      requestImpl({ models: { harnessId: "claude", models: [] } }),
    );
    const onCreated = vi.fn();
    renderAuthor(fake, onCreated);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Instruction"), "No model here");
    await user.click(screen.getByRole("button", { name: "Start agent" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").toMatch(/couldn't resolve a model/i);
    expect(
      fake.request.mock.calls.some((c) => c[0] === "epic.createChat"),
    ).toBe(false);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("builds a request body that parses against the real createChatRequestSchema", () => {
    const request = buildCreateChatRequest({
      epicId: "e1",
      chatId: "chat-1",
      messageId: "msg-1",
      clientActionId: "action-1",
      userId: "user-1",
      model: "test-model",
      instruction: "First line of the instruction\nsecond line",
    });

    // The strongest contract guard: the real schema accepts the body verbatim.
    expect(() => createChatRequestSchema.parse(request)).not.toThrow();

    // Title derives from the first line; optional knobs stay absent.
    expect(request.title).toBe("First line of the instruction");
    expect("workspaceMode" in request).toBe(false);
    expect("worktreeIntent" in request).toBe(false);
    expect("settings" in request).toBe(false);
    // The folded settings ARE required and fully populated.
    expect(request.initialMessage?.settings.model).toBe("test-model");
  });
});
