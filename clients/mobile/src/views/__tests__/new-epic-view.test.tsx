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

/**
 * `epic.create`'s reply, parameterized on whether the host started the
 * folded turn. No test may get this value by accident — see `requestImpl`.
 */
function createEpicReply(
  initialTurnStarted: boolean,
): () => Promise<{ roomInfo: null; task: null; initialTurnStarted: boolean }> {
  return () => Promise.resolve({ roomInfo: null, task: null, initialTurnStarted });
}

/**
 * A `request` fake routed by method: models list, then a create echo.
 *
 * `createEpic` has NO default. It used to fall back to
 * `initialTurnStarted: true` — the branch the real host does not take
 * (same measured evidence as `author-view.test.tsx`'s sibling fixture: a
 * real chatId from a live host, see
 * phone-authored-chat-lands-with-no-turn-running's Evidence section) — so
 * every call site that omitted it was silently exercising the rare path.
 * As in that file, the fix is NOT flipping the default: a `false` reply
 * arms the same `startFoldedFirstTurn` / `FIRST_TURN_ACK_TIMEOUT_MS` (20s)
 * fallback `use-create-epic.ts` reuses from `use-create-chat.ts`, and a
 * test that doesn't drive it to completion would be left with a real timer
 * running unobserved. Stating it at every call site is the fix.
 */
function requestImpl(opts: {
  readonly models?: ListHarnessModelsResponse;
  readonly createEpic: () => Promise<unknown>;
  readonly worktrees?: readonly unknown[];
  readonly mappings?: readonly unknown[];
}): (method: string, params: unknown) => Promise<unknown> {
  return (method) => {
    if (method === "agent.listHarnessModels") {
      return Promise.resolve(opts.models ?? MODELS_RESPONSE);
    }
    if (method === "epic.create") {
      return opts.createEpic();
    }
    // M5: the workspace picker's two RPCs. Absent by default, so the existing
    // folderless tests exercise the honest-degrade path (picker unavailable,
    // creation still works) rather than silently gaining a repo.
    if (method === "worktree.listAllForHost") {
      return opts.worktrees === undefined
        ? Promise.reject(new Error("no worktrees in this test"))
        : Promise.resolve({ worktrees: opts.worktrees, nextCursor: null });
    }
    if (method === "workspace.resolvePathsByRepoIdentifiers") {
      return opts.mappings === undefined
        ? Promise.reject(new Error("no mappings in this test"))
        : Promise.resolve({ mappings: opts.mappings });
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
    // `true`: this test only inspects the dispatched request body, never the
    // create's outcome — `true` resolves the flow synchronously so nothing is
    // left running after the assertions.
    const fake = createFakeHostClient(requestImpl({ createEpic: createEpicReply(true) }));
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
    // `true`: exercises the (rare) case where the host already started the
    // folded turn, so navigation is immediate with no fallback session. The
    // common case — `false` — gets its own dedicated coverage below.
    const fake = createFakeHostClient(requestImpl({ createEpic: createEpicReply(true) }));
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
    // `createEpic` is never invoked — the flow dead-ends at model resolution
    // — but the field is required so every call site says so.
    const fake = createFakeHostClient(
      requestImpl({
        models: { harnessId: "claude", models: [] },
        createEpic: createEpicReply(true),
      }),
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
    // `createEpic` is never invoked — the flow refuses before the host id
    // check even reaches a request — but the field is required regardless.
    const fake = createFakeHostClient(requestImpl({ createEpic: createEpicReply(true) }));
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
  //
  // `requestImpl` has no default for `initialTurnStarted` any more — every
  // call site above states it explicitly, all choosing `true` because none of
  // them observe this outcome and `false` would leave the 20s ack-wait
  // fallback armed and unobserved for the rest of that test. These two are
  // where `false` — the branch the host actually takes — gets its own
  // dedicated, mutation-verified coverage.

  it("re-sends the folded message over the chat stream when the host didn't start the turn", async () => {
    const fake = createFakeHostClient(
      requestImpl({
        createEpic: createEpicReply(false),
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
    // `true` is load-bearing here: this is the contrast that stops the test
    // above from passing against a hook that re-sends unconditionally.
    const fake = createFakeHostClient(requestImpl({ createEpic: createEpicReply(true) }));
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
        createEpic: createEpicReply(false),
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
    // `true`: this test only counts `epic.create` invocations, never awaits
    // the outcome — `true` resolves synchronously so nothing is left running.
    const fake = createFakeHostClient(requestImpl({ createEpic: createEpicReply(true) }));
    const streams = createFakeStreamConnection();
    const { result } = renderHook(() =>
      useCreateEpic({
        client: fake.client,
        streamConnection: streams.connection,
        onCreated: () => {},
      }),
    );

    act(() => {
      result.current.submit("Twice in one tick", FOLDERLESS_TARGET);
      result.current.submit("Twice in one tick", FOLDERLESS_TARGET);
    });

    await waitFor(() => {
      expect(fake.request.mock.calls.some((c) => c[0] === "epic.create")).toBe(true);
    });
    expect(fake.request.mock.calls.filter((c) => c[0] === "epic.create").length).toBe(1);
  });

  it("creates exactly one epic when the button is double-tapped", async () => {
    // `true`: this test only counts `epic.create` invocations, never awaits
    // the outcome — `true` resolves synchronously so nothing is left running.
    const fake = createFakeHostClient(requestImpl({ createEpic: createEpicReply(true) }));
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

/**
 * M5 item 3/4 — the picker is the whole point of the ticket: before it, every
 * epic started from a phone was folderless, i.e. one that could not touch code.
 *
 * These assert the REQUEST, not the sheet: a picker that renders rows but
 * still sends `repoIdentifiers: []` would look correct and change nothing.
 */
describe("NewEpicView — workspace picker (M5)", () => {
  const WORKTREE = {
    worktreePath: "/src/wt/feature-a",
    repoLabel: "acme-web",
    repoIdentifier: { owner: "acme", repo: "acme-web" },
    branch: "feature-a",
    inUse: false,
    uncommittedCount: 0,
    gitRemovable: true,
    scripts: null,
  };
  const MAPPING = {
    repoIdentifier: { owner: "acme", repo: "acme-web" },
    workspacePath: "/src/acme-web",
  };

  it("still defaults to folderless, and says so", async () => {
    // `createEpic` is unexercised beyond request construction in this block —
    // `true` keeps each test fast and side-effect-free.
    const fake = createFakeHostClient(
      requestImpl({ worktrees: [WORKTREE], mappings: [MAPPING], createEpic: createEpicReply(true) }),
    );
    renderNewEpic(fake, () => {}, createFakeStreamConnection());

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Workspace" }).textContent).toContain(
        "No repo (folderless)",
      );
    });
    await typeAndSubmit("Plan something");
    await waitFor(() => {
      expect(fake.request.mock.calls.some((c) => c[0] === "epic.create")).toBe(true);
    });
    const body = createEpicBody(fake);
    expect(body.repoIdentifiers).toEqual([]);
    expect(body.workspaces).toEqual([]);
  });

  it("binds the epic to a picked REPO — the capability the phone did not have", async () => {
    const fake = createFakeHostClient(
      requestImpl({ worktrees: [WORKTREE], mappings: [MAPPING], createEpic: createEpicReply(true) }),
    );
    renderNewEpic(fake, () => {}, createFakeStreamConnection());

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Workspace" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    await waitFor(() => {
      expect(screen.getByText("Repositories")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /Runs against the checked-out repository/ }));

    await typeAndSubmit("Fix the billing bug");
    await waitFor(() => {
      expect(fake.request.mock.calls.some((c) => c[0] === "epic.create")).toBe(true);
    });

    const body = createEpicBody(fake);
    expect(body.repoIdentifiers).toEqual([{ owner: "acme", repo: "acme-web" }]);
    expect(body.workspaces).toEqual([{ workspacePath: "/src/acme-web" }]);
    // Parsed against the REAL schema so a shape the host rejects fails here.
    const parsed = createEpicRequestSchema.parse(body);
    expect(parsed.chat?.workspaceMode).toBe("inherit");
    expect(parsed.chat?.worktreeIntent?.entries[0].kind).toBe("local");
  });

  it("binds to a picked WORKTREE as an `import` intent, never a `worktree` one", async () => {
    // `import` adopts an existing worktree; `worktree` would CREATE one, which
    // this ticket forbids from a phone.
    const fake = createFakeHostClient(
      requestImpl({ worktrees: [WORKTREE], mappings: [MAPPING], createEpic: createEpicReply(true) }),
    );
    renderNewEpic(fake, () => {}, createFakeStreamConnection());

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Workspace" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    await waitFor(() => {
      expect(screen.getByText("Existing worktrees")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /acme-web · feature-a/ }));

    await typeAndSubmit("Work on feature a");
    await waitFor(() => {
      expect(fake.request.mock.calls.some((c) => c[0] === "epic.create")).toBe(true);
    });

    const parsed = createEpicRequestSchema.parse(createEpicBody(fake));
    const entry = parsed.chat?.worktreeIntent?.entries[0];
    expect(entry?.kind).toBe("import");
    if (entry?.kind !== "import") throw new Error("expected an import arm");
    expect(entry.worktreePath).toBe("/src/wt/feature-a");
  });

  it("still creates folderless when the host's worktree list is unreachable", async () => {
    // Honest degrade: a phone that cannot read the repo list must still be
    // able to do the thing it could always do.
    const fake = createFakeHostClient(requestImpl({ createEpic: createEpicReply(true) }));
    renderNewEpic(fake, () => {}, createFakeStreamConnection());

    await typeAndSubmit("Plan something anyway");
    await waitFor(() => {
      expect(fake.request.mock.calls.some((c) => c[0] === "epic.create")).toBe(true);
    });
    expect(createEpicBody(fake).workspaces).toEqual([]);
  });
});
