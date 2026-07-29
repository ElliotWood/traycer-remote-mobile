// @vitest-environment jsdom
/**
 * `composer.tsx:176` — `canSubmit` requires a resolved model, but nothing
 * told the user WHY when `agent.listHarnessModels` fails: `useHarnessModels`
 * leaves `models` empty (`use-harness-models.ts:45-48`), Send disables, and
 * the button's tooltip just read "Send" — a disabled control silently
 * unusable. Covers every disabling condition Composer knows about, not just
 * the models one, so this stays the one place that catches "Send is
 * disabled with no hint" for any of them.
 */
import { describe, expect, it } from "vitest";
import { Composer } from "@/views/chat/composer";
import { createFakeHostClient, type FakeHostClient } from "@/test-utils/fakes";
import { render, screen, waitFor } from "@/test-utils/dom";

function renderComposer(props: {
  readonly client: FakeHostClient["client"] | null;
  readonly connectionLive?: boolean;
  readonly accessRole?: "owner" | "viewer";
  readonly sendDisabledHint?: string | null;
}): void {
  render(
    <Composer
      epicId="e1"
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

function sendButton(): HTMLElement {
  return screen.getByRole("button", { name: "Send" });
}

describe("Composer — a disabled Send always says why", () => {
  it("shows a hint when agent.listHarnessModels rejects (Finding C)", async () => {
    const fake = createFakeHostClient(() => Promise.reject(new Error("network down")));
    renderComposer({ client: fake.client });

    await waitFor(() => {
      expect(fake.request).toHaveBeenCalledWith("agent.listHarnessModels", expect.anything());
    });

    await waitFor(() => {
      const button = sendButton();
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.getAttribute("title")).not.toBe("Send");
      expect(button.getAttribute("title")).toMatch(/couldn.t load/i);
    });
  });

  it("does NOT show the models-error hint while the model list is still loading (not yet resolved)", () => {
    const fake = createFakeHostClient(() => new Promise(() => {})); // never resolves — still "loading"
    renderComposer({ client: fake.client });

    const button = sendButton();
    expect(button.getAttribute("title")).toBe("Send");
  });

  it("still shows a hint for a pre-existing disabling condition (view-only access)", () => {
    const fake = createFakeHostClient(() =>
      Promise.resolve({ harnessId: "claude", models: [{ id: "m1", reasoningEfforts: [], fastModeAvailable: false }] }),
    );
    renderComposer({ client: fake.client, accessRole: "viewer", sendDisabledHint: "You have view-only access" });

    // Viewer mode renders no composer controls at all — the read-only
    // notice IS the hint; nothing here is a silently-dead button.
    expect(screen.getByText("You have view-only access to this chat.")).toBeTruthy();
  });

  it("still shows a hint for a pre-existing disabling condition (disconnected)", () => {
    const fake = createFakeHostClient(() =>
      Promise.resolve({ harnessId: "claude", models: [{ id: "m1", reasoningEfforts: [], fastModeAvailable: false }] }),
    );
    renderComposer({ client: fake.client, connectionLive: false, sendDisabledHint: "Reconnecting to the host…" });

    const button = sendButton();
    expect(button.getAttribute("title")).toBe("Reconnecting to the host…");
  });
});
