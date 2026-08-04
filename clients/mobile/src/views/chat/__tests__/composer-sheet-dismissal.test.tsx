// @vitest-environment jsdom
/**
 * H14 — `dismissedAt` used to be a bare trigger POSITION, shared by both the
 * `/` and `@` sheets, with exactly one writer and no reset. Dismissing a `/`
 * at position 0 — an empty or freshly-cleared draft, the single most common
 * trigger position there is — silently suppressed whatever landed on
 * position 0 next: a retyped `/`, or an `@` typed fresh after backspacing the
 * `/`. Renders identically to "no roots" / "no matches" — no error, nothing
 * on screen to point at.
 *
 * The fix scopes the dismissal to the LIVE OCCURRENCE: it clears the moment
 * `trigger` goes null, because that is what "the dismissed thing is gone"
 * actually means. See composer.tsx's `effectiveDismissedAt`.
 *
 * All three dismissal routes — ✕, backdrop tap, Escape — end up calling the
 * same `setSheetDismissed`, but they reach it by genuinely different code:
 * ✕ and the backdrop tap go through `BottomSheet` -> `useDismissLayer` ->
 * `NavHost.back()`; Escape is `composer.tsx`'s OWN `onKeyDown`, entirely
 * separate from `BottomSheet`/`NavHost`. A regression in the NavHost wiring
 * would leave ✕/backdrop silently inert while an Escape-only test stayed
 * green — so the cross-suppression fix is verified against all three.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  guiAgentCommandOptionSchema,
  type GuiAgentCommandOption,
} from "@traycer/protocol/host/agent/gui/unary-schemas";
import {
  workspaceFileMentionSuggestionSchema,
  type WorkspaceFileMentionSuggestion,
} from "@traycer/protocol/host/workspace/unary-schemas";
import { NavHost } from "@/router/nav-host";
import { Composer } from "@/views/chat/composer";
import { resetDraftsForTest } from "@/router/drafts";
import { createFakeHostClient, type FakeHostClient } from "@/test-utils/fakes";
import { fireEvent, render, screen, waitFor } from "@/test-utils/dom";

const ROOT_A = "C:\\repos\\alpha";

function command(name: string): GuiAgentCommandOption {
  return guiAgentCommandOptionSchema.parse({
    harnessId: "claude",
    name,
    description: "",
    kind: "slash-command",
    argumentHint: null,
    metadata: {},
  });
}

function fileRow(relPath: string): WorkspaceFileMentionSuggestion {
  return workspaceFileMentionSuggestionSchema.parse({
    kind: "file",
    id: `file:${ROOT_A}:${relPath}`,
    // The basename, not `relPath` — the sheet renders both the label and the
    // relPath as separate nodes, and giving them the same string makes
    // `getByText` ambiguous between them.
    label: relPath.slice(relPath.lastIndexOf("/") + 1),
    relPath,
    absolutePath: `${ROOT_A}\\${relPath}`,
    workspacePath: ROOT_A,
    description: "",
  });
}

/** One command, one file — enough to tell "sheet open, with real content" from "sheet open, empty". */
function host(): FakeHostClient {
  return createFakeHostClient((method, params) => {
    if (method === "agent.gui.listHarnesses") return Promise.resolve({ harnesses: [] });
    if (method === "agent.gui.listModels") {
      return Promise.resolve({ harnessId: "claude", models: [] });
    }
    if (method === "agent.gui.listCommands") {
      return Promise.resolve({ commands: [command("review")] });
    }
    if (method === "workspace.mentionFiles") {
      const { query } = params as { readonly query: string };
      const rows = [fileRow("src/app.tsx")].filter(
        (r) => query === "" || r.relPath.includes(query),
      );
      return Promise.resolve({ entries: rows });
    }
    if (method === "workspace.mentionFolders") return Promise.resolve({ entries: [] });
    return Promise.reject(new Error(`unexpected RPC in this test: ${method}`));
  });
}

function renderComposer(client: FakeHostClient): void {
  render(
    <NavHost routeDepth={1} onPopRoutes={() => {}}>
      <Composer
        chatId="c1"
        client={client.client}
        mentionRoots={[ROOT_A]}
        primaryMentionRoot={ROOT_A}
        prefillText={null}
        prefillNonce={0}
        chatSettings={null}
        // Snapshot HAS arrived; this chat simply has no settings chosen yet.
        settingsLoaded={true}
        canStop={false}
        stopping={false}
        accessRole="owner"
        connectionLive
        sendDisabledHint={null}
        onSend={() => {}}
        onStop={() => {}}
      />
    </NavHost>,
  );
}

function textarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText("Message this agent…") as HTMLTextAreaElement;
}

/** Always sets the caret to the END, matching this suite's siblings — good enough to place a trigger at a chosen position by choosing the string. */
function type(text: string): void {
  fireEvent.change(textarea(), { target: { value: text, selectionStart: text.length } });
}

function dismissViaClose(): void {
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
}

/** `BottomSheet`'s backdrop: `role="presentation"`, wired to the SAME `dismiss` the ✕ uses. */
function dismissViaBackdrop(): void {
  const backdrop = document.querySelector('[role="presentation"]');
  if (backdrop === null) throw new Error("dismissViaBackdrop: no sheet is open");
  fireEvent.click(backdrop);
}

/** composer.tsx's OWN `onKeyDown` — does not touch `BottomSheet`/`NavHost` at all. */
function dismissViaEscape(): void {
  fireEvent.keyDown(textarea(), { key: "Escape" });
}

beforeEach(() => {
  resetDraftsForTest();
  // `NavHost.back()` calls the real `window.history.back()` — the ✕/backdrop
  // routes need a fresh entry to go back to, or they'd navigate the test page.
  window.history.pushState(null, "");
});

describe.each([
  ["the ✕ button", dismissViaClose],
  ["a backdrop tap", dismissViaBackdrop],
  ["Escape", dismissViaEscape],
] as const)("dismissing `/` via %s no longer cross-suppresses `@`", (_label, dismiss) => {
  it("lets `@` open at the same position the `/` was dismissed at", async () => {
    const fake = host();
    renderComposer(fake);

    type("/rev");
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Commands" })).toBeTruthy();
    });

    dismiss();
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Commands" })).toBeNull();
    });

    // Backspace the `/` to empty (the sheet is already closed — unrelated to
    // `dismissedAt`), then type `@` fresh at the SAME position 0.
    type("");
    type("@");

    // The defect: `dismissedAt (0) === mentionTrigger.start (0)` kept this
    // sheet closed forever. Fixed: `dismissedAt` was cleared when the `/`
    // trigger went null on the empty draft in between.
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Files" })).toBeTruthy();
    });
    // The 250ms query debounce hasn't resolved yet when the sheet first
    // mounts (it opens showing "Searching…") — its own wait, not folded into
    // the one above.
    await waitFor(() => {
      expect(screen.getByText("src/app.tsx")).toBeTruthy();
    });
  });
});

describe("dismissing `/` does not permanently suppress a RETYPED `/` at the same position", () => {
  it("reopens on the same-kind recurrence, once the draft goes through empty", async () => {
    const fake = host();
    renderComposer(fake);

    type("/rev");
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Commands" })).toBeTruthy();
    });

    dismissViaEscape();
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Commands" })).toBeNull();
    });

    type("");
    type("/rev");

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Commands" })).toBeTruthy();
    });
    expect(screen.getByText("/review")).toBeTruthy();
  });
});

describe("a same-position KIND SWAP via a single paste (no intermediate null) is not suppressed", () => {
  it("opens `@` after a select-all-replace paste over a dismissed `/` at the same start", async () => {
    const fake = host();
    renderComposer(fake);

    type("/rev");
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Commands" })).toBeTruthy();
    });

    dismissViaEscape();
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Commands" })).toBeNull();
    });

    // A single change event, as a select-all-replace paste delivers: the
    // draft goes straight from "/rev" to "@foo" in one `onChange`, never
    // passing through an intermediate value `detectTrigger` would read as
    // null. If dismissal were keyed on position alone, `dismissedAt (0) ===
    // mentionTrigger.start (0)` would suppress this exactly like the
    // cross-suppression defect it was fixed alongside.
    fireEvent.change(textarea(), { target: { value: "@foo", selectionStart: 4 } });

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Files" })).toBeTruthy();
    });
  });
});

describe("the property the dismissal exists for is preserved", () => {
  it("stays closed while the SAME trigger is still in the text — no unfreeze on the next keystroke", async () => {
    const fake = host();
    renderComposer(fake);

    type("/rev");
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Commands" })).toBeTruthy();
    });

    dismissViaEscape();
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Commands" })).toBeNull();
    });

    // Still the same trigger (kind "slash", start 0) — never went through
    // null — so a fix that "reopens on any keystroke" would wrongly show
    // this. Give it a moment for anything async to (wrongly) resolve.
    type("/revi");
    type("/review");
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(screen.queryByRole("dialog", { name: "Commands" })).toBeNull();

    // And it is still recoverable: send disabled isn't a dead end. Clearing
    // the draft and starting over reopens it — the earlier test's property.
    type("");
    type("/rev");
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Commands" })).toBeTruthy();
    });
  });
});
