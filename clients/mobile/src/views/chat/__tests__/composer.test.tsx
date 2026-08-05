// @vitest-environment jsdom
/**
 * `canSubmit` requires a resolved model, but nothing told the user WHY when
 * the model catalogue fails: the hook leaves `models` empty, Send disables,
 * and the button's tooltip just read "Send" — a disabled control silently
 * unusable. Covers every disabling condition Composer knows about, not just
 * the models one, so this stays the one place that catches "Send is
 * disabled with no hint" for any of them.
 *
 * M1: the catalogue RPC is now `agent.gui.listModels` (was
 * `agent.listHarnessModels`) and the composer also fetches
 * `agent.gui.listHarnesses`, so the fake dispatches on method.
 *
 * FIXTURES PARSE THROUGH THE REAL SCHEMAS (`guiModel` / `guiHarness` below).
 * A hand-written object literal shaped like the row would let a test pass
 * against a shape the host cannot send — and the schema carries defaults
 * (`supportedServiceTiers`, `defaultServiceTier`) that a literal would have to
 * duplicate by hand and could get wrong.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  guiAgentModelOptionSchema,
  guiHarnessOptionSchema,
  type GuiAgentModelOption,
  type GuiHarnessOption,
} from "@traycer/protocol/host/agent/gui/unary-schemas";
import type { ChatRunSettings } from "@traycer/protocol/persistence/epic/foundation";
import { Composer, type ComposerProps } from "@/views/chat/composer";
import { resetDraftsForTest } from "@/router/drafts";
import { createFakeHostClient, type FakeHostClient } from "@/test-utils/fakes";
import { fireEvent, render, screen, waitFor } from "@/test-utils/dom";

/** Builds a model row THROUGH the protocol schema, so a fixture that the host could never send fails here rather than passing quietly. */
function guiModel(overrides: Record<string, unknown>): GuiAgentModelOption {
  return guiAgentModelOptionSchema.parse({
    harnessId: "claude",
    slug: "m1",
    label: "Model One",
    description: null,
    contextWindow: null,
    maxOutputTokens: null,
    defaultReasoningEffort: null,
    supportedReasoningEfforts: [],
    metadata: {},
    ...overrides,
  });
}

function guiHarness(overrides: Record<string, unknown>): GuiHarnessOption {
  return guiHarnessOptionSchema.parse({
    id: "claude",
    label: "Claude Code",
    available: true,
    error: null,
    modes: ["gui"],
    requiresApiKey: false,
    availabilityPending: false,
    ...overrides,
  });
}

/**
 * Routes by method. `models` may be a rejection to drive the error path.
 * Anything unrecognised rejects loudly rather than resolving to `{}` — a
 * catch-all that resolves would let a future RPC silently return a shape the
 * component then treats as empty.
 */
function hostWith(options: {
  readonly models?: readonly GuiAgentModelOption[] | Error | "pending";
  readonly harnesses?: readonly GuiHarnessOption[];
}): FakeHostClient {
  return createFakeHostClient((method) => {
    if (method === "agent.gui.listHarnesses") {
      return Promise.resolve({
        harnesses: options.harnesses ?? [guiHarness({})],
      });
    }
    if (method === "agent.gui.listModels") {
      const models = options.models;
      if (models === undefined) return Promise.resolve({ harnessId: "claude", models: [] });
      if (models === "pending") return new Promise(() => {});
      if (models instanceof Error) return Promise.reject(models);
      return Promise.resolve({ harnessId: "claude", models });
    }
    return Promise.reject(new Error(`unexpected RPC in this test: ${method}`));
  });
}

// The composer's draft text now outlives its component (see `drafts.ts`), so
// the store is module state one test could otherwise leak into the next.
beforeEach(() => {
  resetDraftsForTest();
});

function renderComposer(props: {
  readonly client: FakeHostClient["client"] | null;
  readonly connectionLive?: boolean;
  readonly accessRole?: "owner" | "viewer";
  readonly sendDisabledHint?: string | null;
}): void {
  render(
    <Composer
      chatId="c1"
      client={props.client}
      prefillText={null}
      prefillNonce={0}
      chatSettings={null}
      canStop={false}
      stopping={false}
      accessRole={props.accessRole ?? "owner"}
      connectionLive={props.connectionLive ?? true}
      sendDisabledHint={props.sendDisabledHint ?? null}
      onSend={() => {}}
      onStop={() => {}}
    />,
  );
}

function fullProps(overrides: Partial<ComposerProps>): ComposerProps {
  return {
    chatId: "c1",
    client: null,
    prefillText: null,
    prefillNonce: 0,
    chatSettings: null,
    canStop: false,
    stopping: false,
    accessRole: "owner",
    connectionLive: true,
    sendDisabledHint: null,
    onSend: () => {},
    onStop: () => {},
    ...overrides,
  };
}

function textarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText("Message this agent…") as HTMLTextAreaElement;
}

function sendButton(): HTMLElement {
  return screen.getByRole("button", { name: "Send" });
}

describe("Composer — a disabled Send always says why", () => {
  it("shows a hint when agent.gui.listModels rejects (Finding C)", async () => {
    const fake = hostWith({ models: new Error("network down") });
    renderComposer({ client: fake.client });

    await waitFor(() => {
      expect(fake.request).toHaveBeenCalledWith("agent.gui.listModels", expect.anything());
    });

    await waitFor(() => {
      const button = sendButton();
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.getAttribute("title")).not.toBe("Send");
      expect(button.getAttribute("title")).toMatch(/couldn.t load/i);
    });
  });

  it("does NOT show the models-error hint while the model list is still loading (not yet resolved)", () => {
    const fake = hostWith({ models: "pending" }); // never resolves — still "loading"
    renderComposer({ client: fake.client });

    const button = sendButton();
    expect(button.getAttribute("title")).toBe("Send");
  });

  it("still shows a hint for a pre-existing disabling condition (view-only access)", () => {
    const fake = hostWith({ models: [guiModel({})] });
    renderComposer({ client: fake.client, accessRole: "viewer", sendDisabledHint: "You have view-only access" });

    // Viewer mode renders no composer controls at all — the read-only
    // notice IS the hint; nothing here is a silently-dead button.
    expect(screen.getByText("You have view-only access to this chat.")).toBeTruthy();
  });

  it("still shows a hint for a pre-existing disabling condition (disconnected)", () => {
    const fake = hostWith({ models: [guiModel({})] });
    renderComposer({ client: fake.client, connectionLive: false, sendDisabledHint: "Reconnecting to the host…" });

    const button = sendButton();
    expect(button.getAttribute("title")).toBe("Reconnecting to the host…");
  });
});

describe("Composer — M1 model & capacity controls", () => {
  it("shows the host's LABEL on the model chip, not the slug", async () => {
    // The evidence that the RPC swap actually landed. Reasoning effort is NOT
    // that evidence: the old `agent.listHarnessModels` row already carried
    // `reasoningEfforts`, so an effort control was buildable without changing
    // RPC. `label` exists only on `agent.gui.listModels`.
    const fake = hostWith({
      models: [guiModel({ slug: "opus[1m]", label: "Opus 5 (1M context)" })],
    });
    renderComposer({ client: fake.client });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Model" }).textContent).toContain(
        "Opus 5 (1M context)",
      );
    });
    expect(screen.getByRole("button", { name: "Model" }).textContent).not.toContain("opus[1m]");
  });

  it("renders NO reasoning control for a model advertising no efforts", async () => {
    // Claude's `haiku` is exactly this shape on a real host.
    const fake = hostWith({
      models: [guiModel({ slug: "haiku", label: "Haiku 4.5", supportedReasoningEfforts: [] })],
    });
    renderComposer({ client: fake.client });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Model" })).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Reasoning effort" })).toBeNull();
  });

  it("renders the reasoning control, labelled by the host, when the model advertises efforts", async () => {
    const fake = hostWith({
      models: [
        guiModel({
          supportedReasoningEfforts: [
            { id: "low", label: "Low", description: null },
            { id: "max", label: "Max", description: null },
          ],
        }),
      ],
    });
    renderComposer({ client: fake.client });

    await waitFor(() => {
      // "Low" is the host's label for the first option, which is where the
      // clamp lands with no default declared.
      expect(screen.getByRole("button", { name: "Reasoning effort" }).textContent).toContain("Low");
    });
  });

  it("emits a null reasoningEffort — never '' — for a model with no efforts", async () => {
    // `""` is this client's internal "no selection". Sending it would persist
    // an effort of "" on the turn, which is neither a valid option id nor the
    // absence of one.
    const sent: ChatRunSettings[] = [];
    const fake = hostWith({
      models: [guiModel({ slug: "haiku", label: "Haiku 4.5", supportedReasoningEfforts: [] })],
    });
    render(
      <Composer
        {...fullProps({ client: fake.client, onSend: (_t, settings) => sent.push(settings) })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Model" })).toBeTruthy();
    });
    fireEvent.change(textarea(), { target: { value: "go" } });
    fireEvent.click(sendButton());

    expect(sent).toHaveLength(1);
    expect(sent[0].reasoningEffort).toBeNull();
    expect(sent[0].serviceTier).toBeNull();
    expect(sent[0].model).toBe("haiku");
  });

  it("emits the harness the user is actually on, not a hardcoded 'claude'", async () => {
    const sent: ChatRunSettings[] = [];
    const fake = hostWith({
      harnesses: [guiHarness({ id: "codex", label: "Codex" })],
      models: [guiModel({ harnessId: "codex", slug: "gpt-5", label: "GPT-5" })],
    });
    render(
      <Composer
        {...fullProps({ client: fake.client, onSend: (_t, settings) => sent.push(settings) })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Model" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Harness" }));
    fireEvent.click(screen.getByRole("button", { name: /Codex/ }));

    // Switching harness clears the model list and re-fetches — deliberately,
    // so a slug from the previous harness can never be committed. Send is
    // disabled during that window, so wait for the new catalogue rather than
    // racing it. (The first version of this test clicked straight through and
    // asserted on zero sends.)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Model" }).textContent).toContain("GPT-5");
    });
    fireEvent.change(textarea(), { target: { value: "go" } });
    fireEvent.click(sendButton());

    expect(sent).toHaveLength(1);
    expect(sent[0].harnessId).toBe("codex");
  });

  it("shows contextWindow only when the host populates it", async () => {
    // 47 of 420 live models carry it; Claude's carry none. A rendered blank
    // would read as a defect, so the row omits it entirely.
    const fake = hostWith({
      models: [
        guiModel({ slug: "with-ctx", label: "With Context", contextWindow: 200_000 }),
        guiModel({ slug: "no-ctx", label: "No Context", contextWindow: null }),
      ],
    });
    renderComposer({ client: fake.client });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Model" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Model" }));

    expect(screen.getByText("200K context")).toBeTruthy();
    expect(screen.queryByText(/null context|undefined context|NaN/)).toBeNull();
  });
});

describe("Composer — prefill (queue-edit)", () => {
  it("adopts a new prefillText when prefillNonce bumps", () => {
    const { rerender } = render(<Composer {...fullProps({ prefillText: null, prefillNonce: 0 })} />);
    expect(textarea().value).toBe("");

    rerender(<Composer {...fullProps({ prefillText: "edited queue item", prefillNonce: 1 })} />);
    expect(textarea().value).toBe("edited queue item");
  });

  it("does not clobber the user's own typing on a re-render with a STABLE nonce", () => {
    const { rerender } = render(<Composer {...fullProps({ prefillText: "first", prefillNonce: 1 })} />);
    expect(textarea().value).toBe("first");

    fireEvent.change(textarea(), { target: { value: "user is typing something else" } });
    expect(textarea().value).toBe("user is typing something else");

    // Same props, same nonce, re-rendered for an unrelated reason (e.g. a
    // parent state change) — must not re-adopt prefillText and stomp on
    // what the user just typed.
    rerender(<Composer {...fullProps({ prefillText: "first", prefillNonce: 1 })} />);
    expect(textarea().value).toBe("user is typing something else");
  });

  it("adopts a SECOND prefill bump even if the user typed in between", () => {
    const { rerender } = render(<Composer {...fullProps({ prefillText: "first", prefillNonce: 1 })} />);
    fireEvent.change(textarea(), { target: { value: "user edit" } });

    rerender(<Composer {...fullProps({ prefillText: "second edit", prefillNonce: 2 })} />);
    expect(textarea().value).toBe("second edit");
  });
});
