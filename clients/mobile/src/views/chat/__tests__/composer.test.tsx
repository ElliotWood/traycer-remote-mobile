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
import {
  chatRunSettingsSchema,
  type ChatRunSettings,
} from "@traycer/protocol/persistence/epic/foundation";
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
      mentionRoots={[]}
      prefillText={null}
      prefillNonce={0}
      chatSettings={null}
      settingsLoaded
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
    mentionRoots: [],
    prefillText: null,
    prefillNonce: 0,
    // Snapshot HAS arrived, this chat just has nothing chosen yet — the
    // new-chat case. The pre-snapshot `unknown` state is `settingsLoaded:
    // false` and is exercised deliberately, not inherited as a default.
    chatSettings: null,
    settingsLoaded: true,
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

/**
 * The chat's OWN run settings arrive LATE, and the composer is mounted before
 * they do.
 *
 * `chat-view.tsx` renders `<Composer>` unconditionally with
 * `chatSettings={chat.chatSettings}`, and `use-chat.ts` holds that at `null`
 * until the snapshot lands (`INITIAL_STATE`, and `seedFromCache` deliberately
 * does not carry it). So on every cold open of an EXISTING chat the composer
 * mounts with `chatSettings === null`.
 *
 * That matters because these are `useState` INITIALIZERS, which run once. The
 * question these tests ask is not "does seeding work" — it does, at mount —
 * but "what happens to a chat whose settings the client had not yet received",
 * which is every chat, every time.
 *
 * `handleSend` commits this state as the turn's settings, so this is a send-path
 * question, not a display one: whatever the chips end up holding is what the
 * next turn actually runs on.
 *
 * THE CONTROL IS LOAD-BEARING. Settings-present-at-mount is asserted alongside,
 * because without it a red late-arrival test is equally consistent with "the
 * fixture never seeds anything" — and the two have completely different fixes.
 */
describe("Composer — the chat's settings arrive after mount", () => {
  /**
   * EVERY FIELD DIFFERS FROM THE FALLBACK IT WOULD OTHERWISE COLLIDE WITH.
   *
   * This is load-bearing and it is the easiest way to under-report this defect.
   * A polite fixture — `harnessId: "claude"`, `agentMode: "regular"`,
   * `profileId: null` — matches the very defaults the broken code falls back
   * to, so those fields look correct while being entirely unread. The result is
   * a finding that is true and TOO SMALL, and a red test gets audited far less
   * than a green one.
   *
   * So: a non-default harness, a model that is NOT `models[0]` (which is why
   * the fake below advertises two codex models), the non-default agent mode and
   * permission mode, a real profile id rather than ambient, and an effort/tier
   * the model actually advertises so normalization cannot clamp them to "".
   *
   * Parsed through the real schema, per this file's docblock.
   */
  function settings(overrides: Record<string, unknown>): ChatRunSettings {
    return chatRunSettingsSchema.parse({
      harnessId: "codex",
      model: "gpt-5-codex",
      permissionMode: "supervised",
      agentMode: "epic",
      reasoningEffort: "high",
      serviceTier: "priority",
      profileId: "profile-9",
      ...overrides,
    });
  }

  /**
   * Dispatches `listModels` on the REQUESTED harness, so a harness the composer
   * never switches to cannot supply the model that makes a test pass. Codex
   * advertises TWO models and the chat's is the SECOND — with one, `models[0]`
   * is the chat's model and the slug assertion passes without ever being read.
   */
  function twoHarnessHost(): FakeHostClient {
    const codexModel = (slug: string, label: string): GuiAgentModelOption =>
      guiModel({
        harnessId: "codex",
        slug,
        label,
        supportedReasoningEfforts: [
          { id: "high", label: "High", description: null },
          { id: "low", label: "Low", description: null },
        ],
        supportedServiceTiers: [
          { id: "priority", label: "Priority", description: null },
          { id: "standard", label: "Standard", description: null },
        ],
      });
    return createFakeHostClient((method, params) => {
      if (method === "agent.gui.listHarnesses") {
        return Promise.resolve({
          harnesses: [guiHarness({}), guiHarness({ id: "codex", label: "Codex" })],
        });
      }
      if (method === "agent.gui.listModels") {
        const harnessId = (params as { readonly harnessId: string }).harnessId;
        return Promise.resolve({
          harnessId,
          models:
            harnessId === "codex"
              ? [codexModel("gpt-5-first", "GPT-5 First"), codexModel("gpt-5-codex", "GPT-5 Codex")]
              : [guiModel({ slug: "m1", label: "Model One" })],
        });
      }
      return Promise.reject(new Error(`unexpected RPC in this test: ${method}`));
    });
  }

  it("CONTROL: settings present at mount seed the harness chip", async () => {
    const fake = twoHarnessHost();
    render(<Composer {...fullProps({ client: fake.client, chatSettings: settings({}) })} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Harness" }).textContent).toContain("Codex");
    });
  });

  it("adopts settings that arrive after mount, the way the live sequence delivers them", async () => {
    const fake = twoHarnessHost();
    // t=0: chat-view has no snapshot, so it passes null. This is the ONLY
    // state a cold open ever mounts in.
    const { rerender } = render(
      <Composer {...fullProps({ client: fake.client, chatSettings: null })} />,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Model" })).toBeTruthy();
    });

    // The snapshot lands. `chat.chatSettings` flips from null to the chat's
    // real settings and the composer re-renders with them.
    rerender(<Composer {...fullProps({ client: fake.client, chatSettings: settings({}) })} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Harness" }).textContent).toContain("Codex");
    });
  });

  it("SENDS on the chat's own harness after a late arrival, not on the mount-time default", async () => {
    // The consequence, and why this is not a cosmetic defect: `handleSend`
    // commits the composer's own state. A chat configured for one harness,
    // opened cold, would run its next turn somewhere else entirely — with no
    // interaction from the user and nothing on screen admitting it.
    const sent: ChatRunSettings[] = [];
    const fake = twoHarnessHost();
    const { rerender } = render(
      <Composer
        {...fullProps({
          client: fake.client,
          chatSettings: null,
          onSend: (_t, s) => sent.push(s),
        })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Model" })).toBeTruthy();
    });

    rerender(
      <Composer
        {...fullProps({
          client: fake.client,
          chatSettings: settings({}),
          onSend: (_t, s) => sent.push(s),
        })}
      />,
    );
    // Wait for the adopted harness's catalogue rather than racing it — Send is
    // disabled while a harness switch re-fetches models (see the M1 test above).
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Model" }).textContent).toContain("GPT-5");
    });

    fireEvent.change(textarea(), { target: { value: "go" } });
    fireEvent.click(sendButton());

    expect(sent).toHaveLength(1);
    // ALL SEVEN, not just the harness. Every one of them rides the same path,
    // and a repair that adopts `harnessId` alone would go green on a narrower
    // assertion while the turn still runs at the wrong privilege, on the wrong
    // profile, in the wrong mode.
    expect(sent[0]).toMatchObject({
      harnessId: "codex",
      model: "gpt-5-codex",
      permissionMode: "supervised",
      agentMode: "epic",
      reasoningEffort: "high",
      serviceTier: "priority",
      profileId: "profile-9",
    });
  });

  /**
   * THE SAME ASSUMPTION, MEETING A CHANGED CHAT RATHER THAN A LATE ARRIVAL.
   *
   * The root is that the composer treated `chatSettings` as an INITIAL VALUE
   * rather than as the chat's IDENTITY. Cold-open is that assumption meeting a
   * late arrival; this is it meeting a different chat.
   *
   * Today nothing leaks, because `app-shell.tsx:353` keys an ErrorBoundary on
   * `chat:${chatId}` and the whole subtree remounts. But that boundary's
   * declared purpose is ERROR ISOLATION (`label="this chat"`) — nothing marks
   * it load-bearing for run-settings correctness, and hoisting or sharing it
   * (an entirely reasonable refactor) would silently carry a `full_access`
   * chat's permission mode into a `supervised` one.
   *
   * This test locks the property at the level that actually owns it, so the
   * separation survives a refactor of that key: the SAME instance, given a new
   * chat, emits the new chat's values. Derivation gives this for free; the old
   * initializer form cannot pass it at all.
   */
  it("emits the NEW chat's settings when reused across chats, without a remount", async () => {
    const sent: ChatRunSettings[] = [];
    const fake = twoHarnessHost();
    const chatA = settings({ harnessId: "claude", model: "m1", permissionMode: "full_access" });
    const chatB = settings({});
    const { rerender } = render(
      <Composer
        {...fullProps({
          chatId: "chat-a",
          client: fake.client,
          chatSettings: chatA,
          onSend: (_t, s) => sent.push(s),
        })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Model" }).textContent).toContain("Model One");
    });

    // Same component instance — no key, no unmount. Only the props change.
    rerender(
      <Composer
        {...fullProps({
          chatId: "chat-b",
          client: fake.client,
          chatSettings: chatB,
          onSend: (_t, s) => sent.push(s),
        })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Model" }).textContent).toContain("GPT-5 Codex");
    });

    fireEvent.change(textarea(), { target: { value: "go" } });
    fireEvent.click(sendButton());

    expect(sent).toHaveLength(1);
    /**
     * THE WHOLE TUPLE, and `toEqual` rather than `toMatchObject`.
     *
     * This assertion used to name `permissionMode` and `harnessId` only. A
     * per-field mutation showed what that costs: `permissionMode` was bound by
     * two tests and `agentMode` by exactly ONE, so reverting `agentMode`'s
     * derivation alone left this test — the only one that watches a REUSED
     * instance — green. A field bound by one assertion in one place is how a
     * field gets quietly dropped from a later fix.
     *
     * `toEqual` because the failure mode is a field going MISSING (or a new one
     * arriving unnoticed), and `toMatchObject` is blind to both: it checks the
     * keys it is given and ignores the rest of the object. The emitted tuple is
     * exactly these seven — `handleSend`'s payload — so pinning it exactly makes
     * "the composer stopped emitting X" a test failure rather than a silence.
     */
    expect(sent[0]).toEqual({
      harnessId: "codex",
      model: "gpt-5-codex",
      permissionMode: "supervised",
      agentMode: "epic",
      reasoningEffort: "high",
      serviceTier: "priority",
      profileId: "profile-9",
    });
  });

  /**
   * THE SAFETY PROPERTY, and it is separate from the two above.
   *
   * Deriving settings instead of seeding them fixes the case where the composer
   * never corrects. It does NOT fix the window BEFORE they arrive: a composer
   * reading `chatSettings?.permissionMode ?? "full_access"` still commits
   * `full_access` during it. Making the screen honest and making the window
   * safe are different fixes, and only this assertion binds the second.
   *
   * The window is reachable — `canSubmit` is
   * `canType && connectionLive && hasContent && !isIngestingAttachments &&
   * resolvedModel !== null`, which has no snapshot term in it. The model
   * catalogue is a unary RPC racing the chat stream's snapshot, and the
   * transcript paints from cache before `hasSnapshot` flips, so a cold open of
   * a cached chat looks completely ready while the settings are still absent.
   *
   * Not asserted as "the button is disabled" — that would pass against a screen
   * disabled for any unrelated reason. Asserted as: nothing was EMITTED.
   */
  it("does not run a turn on settings it has not received yet", async () => {
    const sent: ChatRunSettings[] = [];
    const fake = twoHarnessHost();
    render(
      <Composer
        {...fullProps({
          client: fake.client,
          chatSettings: null,
          // The snapshot has NOT arrived. Distinct from the new-chat case
          // (`settingsLoaded: true`, settings null), which must stay sendable —
          // that is the one turn only this composer can send.
          settingsLoaded: false,
          onSend: (_t, s) => sent.push(s),
        })}
      />,
    );
    // The catalogue lands first. Everything else `canSubmit` asks about is now
    // satisfied, and the chat's own settings are still unknown.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Model" })).toBeTruthy();
    });

    fireEvent.change(textarea(), { target: { value: "go" } });
    fireEvent.click(sendButton());

    expect(sent).toHaveLength(0);
    // A disabled Send must never be silent about why — this file's opening
    // docblock exists because one was.
    expect(sendButton().getAttribute("title")).toMatch(/loading this chat/i);
  });

  /**
   * THE CONTRAST, and it is what stops the gate above from being an
   * over-correction. `settingsLoaded` is deliberately NOT `chatSettings !==
   * null`: a brand-new chat's settings are legitimately null once its snapshot
   * arrives, because nothing has picked a harness or model yet — and H5
   * measured that the CLI cannot send that first turn (`snapshot.chat.settings`
   * is null, so the host answers MALFORMED_FRAME), which makes this composer
   * the only surface that can.
   *
   * A fix that gated on `chatSettings !== null` would pass the safety test
   * above and silently make new chats unusable. Only the pair discriminates.
   */
  it("still sends the FIRST turn of a new chat, whose settings are null by nature", async () => {
    const sent: ChatRunSettings[] = [];
    const fake = twoHarnessHost();
    render(
      <Composer
        {...fullProps({
          client: fake.client,
          chatSettings: null,
          settingsLoaded: true,
          onSend: (_t, s) => sent.push(s),
        })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Model" })).toBeTruthy();
    });

    fireEvent.change(textarea(), { target: { value: "go" } });
    fireEvent.click(sendButton());

    expect(sent).toHaveLength(1);
  });
});
