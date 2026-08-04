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
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { createChatRequestSchema } from "@traycer/protocol/host/epic/unary-schemas";
import type { ListHarnessModelsResponse } from "@traycer/protocol/host/agent/shared";
import type { ReactNode } from "react";
import { StreamConnectionProvider } from "@/host/stream-connection-context";
import { AuthorView } from "@/views/author-view";
import { buildCreateChatRequest } from "@/host/use-create-chat";
import {
  createFakeHostClient,
  createFakeStreamConnection,
  type FakeHostClient,
  type FakeStreamConnection,
} from "@/test-utils/fakes";
import { render, screen, waitFor } from "@/test-utils/dom";

/**
 * HA-1: the host's REAL id, as `VITE_HOST_ID` supplies it. This test used to
 * assert `hostId === "mobile-host"` — baking the synthetic fallback in as the
 * EXPECTED value, which made the suite structurally blind to the defect where
 * every phone-authored chat became a permanently unreachable tile on desktop.
 * Asserting the configured id means collapsing back to the fallback goes red.
 */
const CONFIGURED_HOST_ID = "85a4a272-315f-4953-a282-9a33fe24c815";

const configMock = { hostId: CONFIGURED_HOST_ID as string | null };
vi.mock("@/config", () => ({
  get CONFIGURED_HOST_ID() {
    return configMock.hostId;
  },
  HOST_WS_URL: null,
  AUTHN_CONFIGURED: false,
  AUTHN_BASE_URL: "https://authn.example.test",
  PUSH_BASE_URL: null,
}));

beforeEach(() => {
  configMock.hostId = CONFIGURED_HOST_ID;
});

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

/**
 * `streams` is REQUIRED rather than defaulted — "no host stream to fall back
 * over" is a real scenario with its own test below, so it gets chosen at every
 * call site rather than inherited silently. (ESLint bans default parameter
 * values here anyway.)
 */
function renderAuthor(
  fake: FakeHostClient,
  onCreated: (chatId: string) => void,
  streams: FakeStreamConnection | null,
): void {
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <StreamConnectionProvider connection={streams === null ? null : streams.connection}>
        {children}
      </StreamConnectionProvider>
    );
  }
  render(
    <AuthorView
      epicId="e1"
      client={fake.client}
      onCreated={onCreated}
      onCancel={() => {}}
    />,
    { wrapper: Wrapper },
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
    renderAuthor(fake, () => {}, createFakeStreamConnection());

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
    // The REAL configured id — never the shared synthetic placeholder.
    expect(body.hostId).toBe(CONFIGURED_HOST_ID);
    expect(body.hostId).not.toBe("mobile-host");
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
    renderAuthor(fake, onCreated, createFakeStreamConnection());

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
    renderAuthor(fake, onCreated, createFakeStreamConnection());

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
    renderAuthor(fake, onCreated, createFakeStreamConnection());

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

  it("refuses to create a chat when the host's real id is not configured (HA-1)", async () => {
    configMock.hostId = null;
    const fake = createFakeHostClient(requestImpl({}));
    const onCreated = vi.fn();
    renderAuthor(fake, onCreated, createFakeStreamConnection());

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Instruction"), "Would be unreachable");
    await user.click(screen.getByRole("button", { name: "Start agent" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").toMatch(/VITE_HOST_ID is unset/i);
    // Nothing durable was stamped: no chat exists to be unreachable.
    expect(fake.request.mock.calls.some((c) => c[0] === "epic.createChat")).toBe(false);
    expect(onCreated).not.toHaveBeenCalled();
  });

  // ── The turn-less agent ─────────────────────────────────────────────────
  // Measured on a real host: `initialTurnStarted` comes back FALSE. This flow
  // used to DISCARD that (`void response.initialTurnStarted`) and navigate
  // regardless, so "Start agent" produced a chat holding a persisted
  // instruction that nothing was acting on — no turn, no error, no spinner.
  // A silent no-op, and indistinguishable from success.
  //
  // NOTE on the fixture above: `requestImpl`'s default is
  // `initialTurnStarted: true`, which is the branch the real host does NOT
  // take. Every test before this point therefore exercises the path that
  // rarely happens live; these three cover the one that does.

  it("re-sends the folded message over the chat stream when the host didn't start the turn", async () => {
    const fake = createFakeHostClient(
      requestImpl({
        createChat: (p) => Promise.resolve({ chatId: p.chatId, initialTurnStarted: false }),
      }),
    );
    const streams = createFakeStreamConnection();
    const onCreated = vi.fn();
    renderAuthor(fake, onCreated, streams);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Instruction"), "Start the work");
    await user.click(screen.getByRole("button", { name: "Start agent" }));

    // A chat session is opened for the just-created chat.
    await waitFor(() => expect(streams.chatSessions.length).toBe(1));
    const session = streams.chatSessions[0];
    const body = createChatBody(fake);
    const folded = body.initialMessage as { messageId: string };
    expect(session?.chatId).toBe(body.chatId);
    expect(session?.epicId).toBe("e1");

    // Nothing is written while the session is still connecting — the transport
    // DROPS frames when it isn't subscribed, so an eager write would vanish
    // and the fallback would be a no-op wearing a success.
    expect(session?.sendAction).not.toHaveBeenCalled();

    // Once live, the folded message is re-sent carrying the SAME messageId,
    // which is what makes the re-send idempotent (the host dedupes on it)
    // rather than a duplicate-turn risk.
    session?.connection.applyStatus("open", null);
    await waitFor(() => expect(session?.sendAction).toHaveBeenCalledTimes(1));
    const frame = session?.sendAction.mock.calls[0]?.[0] as {
      kind: string;
      messageId: string;
      chatId: string;
    };
    expect(frame.kind).toBe("send");
    expect(frame.messageId).toBe(folded.messageId);
    expect(frame.chatId).toBe(body.chatId);

    // Navigation waits for the host's ack — landing the user in the chat before
    // then is the very thing this fixes.
    expect(onCreated).not.toHaveBeenCalled();

    // An ack for a DIFFERENT message must not be mistaken for this turn
    // starting; a racing send elsewhere in the app would otherwise resolve the
    // fallback early and report success for a turn that never began.
    session?.callbacks.onMessageAccepted({
      kind: "messageAccepted",
      message: { messageId: "some-other-message" },
    } as unknown as never);
    await Promise.resolve();
    expect(onCreated).not.toHaveBeenCalled();

    session?.callbacks.onMessageAccepted({
      kind: "messageAccepted",
      message: { messageId: folded.messageId },
    } as unknown as never);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onCreated).toHaveBeenCalledWith(body.chatId);
  });

  it("does not re-send when the host reports the folded turn already started", async () => {
    const fake = createFakeHostClient(requestImpl({}));
    const streams = createFakeStreamConnection();
    const onCreated = vi.fn();
    renderAuthor(fake, onCreated, streams);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Instruction"), "Already running");
    await user.click(screen.getByRole("button", { name: "Start agent" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    // No fallback session at all — re-sending would be needless traffic, and
    // this is the contrast that stops the test above from passing against a
    // hook that re-sends unconditionally.
    expect(streams.chatSessions.length).toBe(0);
  });

  it("reports honestly instead of navigating when the first turn cannot be started", async () => {
    const fake = createFakeHostClient(
      requestImpl({
        createChat: (p) => Promise.resolve({ chatId: p.chatId, initialTurnStarted: false }),
      }),
    );
    const onCreated = vi.fn();
    // No stream connection to fall back over. The failure mode of the FALLBACK
    // itself: replacing a silent no-op with a differently-silent one would not
    // be a fix, so this asserts the user is told.
    renderAuthor(fake, onCreated, null);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Instruction"), "Nothing can run this");
    await user.click(screen.getByRole("button", { name: "Start agent" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").toMatch(/didn't start/i);
    // The chat DOES exist, so the copy must not claim the create failed — it
    // has to point the user at the thing that is really there.
    expect(alert.textContent ?? "").toMatch(/created/i);
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
      hostId: CONFIGURED_HOST_ID,
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
