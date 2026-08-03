// @vitest-environment jsdom
/**
 * Render + contract tests for creating a new epic from the Fleet.
 *
 * The load-bearing one is the LAST test: the body this client builds is parsed
 * against the REAL `createEpicRequestSchema` from `@traycer/protocol`. If the
 * host contract moves — a new required field, a tightened enum — that test goes
 * red here rather than the phone silently shipping a button the host rejects.
 *
 * The render tests cover the wiring the schema cannot see: that a model is
 * resolved from the HOST (`epicId: null`, legal only on
 * `agent.listHarnessModels@2.0`) before anything is created, that success
 * navigates into the minted epic, and that both failure modes (rejected create,
 * no resolvable model) surface inline WITHOUT navigating.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { createEpicRequestSchema } from "@traycer/protocol/host/epic/unary-schemas";
import type { ListHarnessModelsResponse } from "@traycer/protocol/host/agent/shared";
import type { ReactNode } from "react";
import { StreamConnectionProvider } from "@/host/stream-connection-context";
import { NewEpicView } from "@/views/new-epic-view";
import { FOLDERLESS_TARGET } from "@/host/workspace-selection";
import { buildCreateEpicRequest, useCreateEpic } from "@/host/use-create-epic";
import {
  createFakeHostClient,
  createFakeStreamConnection,
  type FakeHostClient,
  type FakeStreamConnection,
} from "@/test-utils/fakes";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@/test-utils/dom";

/**
 * The host's REAL id, as `VITE_HOST_ID` would supply it. Deliberately NOT
 * `"mobile-host"`: asserting the synthetic fallback here is what made an earlier
 * version of this suite blind to the phantom-host defect — a test that bakes in
 * the degraded value can never fail on it. Every assertion below checks for THIS
 * value, so collapsing the expression back to the fallback goes red.
 */
const CONFIGURED_HOST_ID = "85a4a272-315f-4953-a282-9a33fe24c815";

/**
 * `config.ts` reads build-time `import.meta.env`, so the configured/unconfigured
 * split is only reachable in a test by mocking the module. Mutable so individual
 * tests can drive the unconfigured case.
 */
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

/** A `request` fake routed by method: models list, then a create echo. */
function requestImpl(opts: {
  readonly models?: ListHarnessModelsResponse;
  readonly createEpic?: () => Promise<unknown>;
}): (method: string, params: unknown) => Promise<unknown> {
  return (method) => {
    if (method === "agent.listHarnessModels") {
      return Promise.resolve(opts.models ?? MODELS_RESPONSE);
    }
    if (method === "epic.create") {
      return opts.createEpic !== undefined
        ? opts.createEpic()
        : Promise.resolve({ roomInfo: null, task: null, initialTurnStarted: true });
    }
    throw new Error(`unexpected method ${method}`);
  };
}

function renderNewEpic(
  fake: FakeHostClient,
  onCreated: (epicId: string, epicTitle: string) => void,
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
    <NewEpicView client={fake.client} onCreated={onCreated} onCancel={() => {}} />,
    { wrapper: Wrapper },
  );
}

/** The single `epic.create` request body the flow dispatched. */
function createEpicBody(fake: FakeHostClient): Record<string, unknown> {
  const call = fake.request.mock.calls.find((c) => c[0] === "epic.create");
  if (call === undefined) {
    throw new Error("epic.create was never called");
  }
  return call[1] as Record<string, unknown>;
}

async function typeAndSubmit(instruction: string): Promise<void> {
  const user = userEvent.setup();
  const field = screen.getByLabelText("What should this epic do?");
  // The instruction is draft-backed by a MODULE-SCOPE map (`router/drafts.ts`),
  // so text from an earlier test in this file survives into the next render.
  // Clearing first keeps each test's assertions about the built request honest
  // rather than dependent on execution order.
  await user.clear(field);
  await user.type(field, instruction);
  await user.click(screen.getByRole("button", { name: "Create epic" }));
}

describe("NewEpicView", () => {
  it("resolves a host-scoped model then dispatches epic.create as a folderless epic", async () => {
    const fake = createFakeHostClient(requestImpl({}));
    renderNewEpic(fake, () => {}, createFakeStreamConnection());

    await typeAndSubmit("Plan the billing migration");

    await waitFor(() => {
      expect(fake.request.mock.calls.some((c) => c[0] === "epic.create")).toBe(true);
    });

    // Model resolution ran first, and asked the HOST — `epicId: null`, since
    // the epic being created does not exist yet.
    expect(fake.request).toHaveBeenCalledWith("agent.listHarnessModels", {
      epicId: null,
      senderAgentId: null,
      harnessId: "claude",
    });

    const body = createEpicBody(fake);
    const epic = body.epic as Record<string, unknown>;
    expect(typeof epic.id).toBe("string");
    expect(epic.title).toBe("Plan the billing migration");
    expect(epic.initialUserPrompt).toBe("Plan the billing migration");
    expect(epic.createdBy).toBe("user-1");

    // Folderless: the phone invents no filesystem path.
    expect(body.repoIdentifiers).toEqual([]);
    expect(body.workspaces).toEqual([]);

    const chat = body.chat as Record<string, unknown>;
    expect(chat.workspaceMode).toBe("folderless");
    expect(chat.worktreeIntent).toBeNull();
    expect(chat.parentId).toBeNull();
    // The host's REAL configured id — never the synthetic "mobile-host", which
    // would make the epic's only agent permanently unreachable on desktop.
    expect(chat.hostId).toBe(CONFIGURED_HOST_ID);
    expect(chat.hostId).not.toBe("mobile-host");

    // The instruction rides as the folded first turn, on the RESOLVED model.
    const initialMessage = chat.initialMessage as {
      content: unknown;
      sender: { type: string; userId: string };
      settings: { harnessId: string; model: string; permissionMode: string };
    };
    expect(JSON.stringify(initialMessage.content)).toContain(
      "Plan the billing migration",
    );
    expect(initialMessage.sender).toEqual({ type: "user", userId: "user-1" });
    expect(initialMessage.settings.model).toBe("test-model");
    expect(initialMessage.settings.permissionMode).toBe("supervised");
  });

  it("navigates into the minted epic on a successful create", async () => {
    const fake = createFakeHostClient(requestImpl({}));
    const onCreated = vi.fn();
    renderNewEpic(fake, onCreated, createFakeStreamConnection());

    await typeAndSubmit("Do the thing");

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    // The epic opened is the one whose id was minted into the request body,
    // carrying the same title the request stamped (so the fleet row and the
    // opened screen agree without waiting for a refetch).
    const epic = createEpicBody(fake).epic as { id: string; title: string };
    expect(onCreated).toHaveBeenCalledWith(epic.id, epic.title);
  });

  it("shows an inline error and does not navigate when the create is rejected", async () => {
    const fake = createFakeHostClient(
      requestImpl({ createEpic: () => Promise.reject(new Error("host said no")) }),
    );
    const onCreated = vi.fn();
    renderNewEpic(fake, onCreated, createFakeStreamConnection());

    await typeAndSubmit("Break something");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("host said no");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("shows an inline error and never creates when no model can be resolved", async () => {
    const fake = createFakeHostClient(
      requestImpl({ models: { harnessId: "claude", models: [] } }),
    );
    const onCreated = vi.fn();
    renderNewEpic(fake, onCreated, createFakeStreamConnection());

    await typeAndSubmit("No model here");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").toMatch(/couldn't resolve a model/i);
    expect(fake.request.mock.calls.some((c) => c[0] === "epic.create")).toBe(false);
    expect(onCreated).not.toHaveBeenCalled();
  });

  // ── The phantom-host blocker ────────────────────────────────────────────
  // `.env.example` ships VITE_HOST_ID empty and the deployed Azure build has it
  // unset, so this is the DEFAULT state, not an edge case. Stamping the
  // synthetic "mobile-host" would make the new epic's only agent render on
  // desktop as a permanently unreachable dead tile.

  it("refuses to create at all when the host's real id is not configured", async () => {
    configMock.hostId = null;
    const fake = createFakeHostClient(requestImpl({}));
    const onCreated = vi.fn();
    renderNewEpic(fake, onCreated, createFakeStreamConnection());

    // The form is replaced by the explanation — the user is never invited to
    // type a paragraph that cannot be honoured.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").toMatch(/VITE_HOST_ID is unset/i);
    expect(screen.queryByLabelText("What should this epic do?")).toBeNull();
    expect(screen.queryByRole("button", { name: "Create epic" })).toBeNull();
    expect(fake.request.mock.calls.some((c) => c[0] === "epic.create")).toBe(false);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("never stamps the synthetic mobile-host placeholder on a created epic", () => {
    // Enforced in the builder's own contract: the id is an explicit argument, so
    // there is no code path that can silently substitute a placeholder.
    const request = buildCreateEpicRequest({
      epicId: "epic-1",
      chatId: "chat-1",
      messageId: "msg-1",
      clientActionId: "action-1",
      userId: "user-1",
      model: "test-model",
      instruction: "Anything",
      target: FOLDERLESS_TARGET,
      settings: null,
      hostId: CONFIGURED_HOST_ID,
      now: 1,
    });
    expect(request.chat?.hostId).toBe(CONFIGURED_HOST_ID);
    expect(request.chat?.hostId).not.toBe("mobile-host");
  });

  // ── The turn-less first run ─────────────────────────────────────────────
  // Measured on a real host: `initialTurnStarted` comes back FALSE, so without
  // a fallback "Create epic" yields a persisted message nothing is acting on.

  it("re-sends the folded message over the chat stream when the host didn't start the turn", async () => {
    const fake = createFakeHostClient(
      requestImpl({
        createEpic: () =>
          Promise.resolve({ roomInfo: null, task: null, initialTurnStarted: false }),
      }),
    );
    const streams = createFakeStreamConnection();
    const onCreated = vi.fn();
    renderNewEpic(fake, onCreated, streams);

    await typeAndSubmit("Start the work");

    // A chat session is opened for the just-created chat.
    await waitFor(() => expect(streams.chatSessions.length).toBe(1));
    const session = streams.chatSessions[0];
    const body = createEpicBody(fake);
    const chat = body.chat as { chatId: string; initialMessage: { messageId: string } };
    expect(session?.chatId).toBe(chat.chatId);

    // Nothing is written while the session is still connecting — the transport
    // DROPS frames when it isn't subscribed, so an eager write would vanish.
    expect(session?.sendAction).not.toHaveBeenCalled();

    // Once live, the folded message is re-sent carrying the SAME messageId,
    // which is what makes the re-send idempotent (the host dedupes on it).
    session?.connection.applyStatus("open", null);
    await waitFor(() => expect(session?.sendAction).toHaveBeenCalledTimes(1));
    const frame = session?.sendAction.mock.calls[0]?.[0] as {
      kind: string;
      messageId: string;
    };
    expect(frame.kind).toBe("send");
    expect(frame.messageId).toBe(chat.initialMessage.messageId);

    // Only once the host acks does the user get navigated into the epic.
    expect(onCreated).not.toHaveBeenCalled();

    // An ack for a DIFFERENT message must not be mistaken for this turn
    // starting — a racing send elsewhere in the app would otherwise resolve the
    // fallback early and report success for a turn that never began.
    session?.callbacks.onMessageAccepted({
      kind: "messageAccepted",
      message: { messageId: "some-other-message" },
    } as unknown as never);
    await Promise.resolve();
    expect(onCreated).not.toHaveBeenCalled();

    // The ack carries the accepted MESSAGE (the frame schema has no flat
    // `messageId`), so the fallback must match on `message.messageId`.
    session?.callbacks.onMessageAccepted({
      kind: "messageAccepted",
      message: { messageId: chat.initialMessage.messageId },
    } as unknown as never);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });

  it("does not re-send when the host reports the folded turn already started", async () => {
    const fake = createFakeHostClient(requestImpl({}));
    const streams = createFakeStreamConnection();
    const onCreated = vi.fn();
    renderNewEpic(fake, onCreated, streams);

    await typeAndSubmit("Already running");

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    // No fallback session at all — re-sending would be needless traffic.
    expect(streams.chatSessions.length).toBe(0);
  });

  it("reports honestly instead of navigating when the first turn cannot be started", async () => {
    const fake = createFakeHostClient(
      requestImpl({
        createEpic: () =>
          Promise.resolve({ roomInfo: null, task: null, initialTurnStarted: false }),
      }),
    );
    const onCreated = vi.fn();
    // No stream connection to fall back over.
    renderNewEpic(fake, onCreated, null);

    await typeAndSubmit("Nothing can run this");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").toMatch(/didn't start/i);
    // The epic DOES exist, so the copy must not claim the create failed.
    expect(alert.textContent ?? "").toMatch(/Epic created/i);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("creates exactly one epic when submit is dispatched twice in one tick", async () => {
    // The button's `disabled` attribute is one layer of double-submit
    // protection, and RTL's `fireEvent` flushes React between clicks — so a
    // DOM-level double-tap can never reach the hook's own guard, and passes
    // even if that guard is broken. Driving the hook directly is the only way
    // to measure it: two synchronous calls share one closure, so a guard that
    // reads `phase` from state sees a stale "idle" both times.
    const fake = createFakeHostClient(requestImpl({}));
    const streams = createFakeStreamConnection();
    const { result } = renderHook(() =>
      useCreateEpic({
        client: fake.client,
        streamConnection: streams.connection,
        onCreated: () => {},
      }),
    );

    act(() => {
      result.current.submit("Twice in one tick");
      result.current.submit("Twice in one tick");
    });

    await waitFor(() => {
      expect(fake.request.mock.calls.some((c) => c[0] === "epic.create")).toBe(true);
    });
    expect(fake.request.mock.calls.filter((c) => c[0] === "epic.create").length).toBe(1);
  });

  it("creates exactly one epic when the button is double-tapped", async () => {
    const fake = createFakeHostClient(requestImpl({}));
    renderNewEpic(fake, () => {}, createFakeStreamConnection());

    const user = userEvent.setup();
    const field = screen.getByLabelText("What should this epic do?");
    await user.clear(field);
    await user.type(field, "Twice");
    const button = screen.getByRole("button", { name: "Create epic" });
    // `fireEvent`, NOT `userEvent.click`: userEvent awaits and lets React flush
    // between clicks, so by the second one the button is already disabled and a
    // stale-state guard would pass the test while measuring nothing. Two
    // synchronous dispatches in one tick is the real double-tap — no re-render
    // in between, so only a synchronously-flipped guard can stop the second.
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => {
      expect(fake.request.mock.calls.some((c) => c[0] === "epic.create")).toBe(true);
    });
    expect(fake.request.mock.calls.filter((c) => c[0] === "epic.create").length).toBe(1);
  });

  it("builds a request body that parses against the real createEpicRequestSchema", () => {
    const request = buildCreateEpicRequest({
      epicId: "epic-1",
      chatId: "chat-1",
      messageId: "msg-1",
      clientActionId: "action-1",
      userId: "user-1",
      model: "test-model",
      instruction: "First line of the instruction\nsecond line",
      target: FOLDERLESS_TARGET,
      settings: null,
      hostId: CONFIGURED_HOST_ID,
      now: 1_700_000_000_000,
    });

    // The strongest contract guard: the real host schema accepts the body verbatim.
    expect(() => createEpicRequestSchema.parse(request)).not.toThrow();

    // Title derives from the first line, and the epic and its first chat agree.
    expect(request.epic.title).toBe("First line of the instruction");
    expect(request.chat?.title).toBe("First line of the instruction");
    // The FULL prompt is preserved, not the truncated title.
    expect(request.epic.initialUserPrompt).toBe(
      "First line of the instruction\nsecond line",
    );
    expect(request.epic.createdAt).toBe(1_700_000_000_000);
    expect(request.epic.updatedAt).toBe(1_700_000_000_000);
  });
});
