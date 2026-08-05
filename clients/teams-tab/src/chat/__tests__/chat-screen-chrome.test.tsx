// @vitest-environment jsdom
/**
 * The chat screen's chrome, which is now two things and used to be one.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ASSERTED ON ABSENCE, AND WHAT MAKES THAT SAFE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Most of these check that something is NOT rendered, which is the weakest
 * shape of assertion available: a component that rendered nothing at all
 * passes every one of them. So every absence here is PAIRED with a positive
 * assertion on the same render — the transcript's own heading — so a blank
 * body fails rather than passes.
 *
 * This is the same pairing the interview card's no-textbox case needed, and
 * for the same reason: `queryByRole` returning null equally describes a card
 * that rendered nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { ChatScreen, type ChatChrome } from "@/chat/chat-screen";
import type { ChatController } from "@/chat/use-chat";
import {
  CHAT_FIXTURE,
  CHAT_FIXTURE_NOW,
  CHAT_FIXTURE_TITLE,
} from "@/chat/chat-fixture";

afterEach(() => {
  cleanup();
});

/**
 * A ready chat with no approvals and no interviews.
 *
 * Deliberately the PLAIN case: this file is about chrome, and an approval
 * card would put a second heading on screen that the title assertions would
 * then have to work around.
 */
function readyController(): ChatController {
  return {
    state: {
      kind: "ready",
      approvals: [],
      messages: CHAT_FIXTURE,
      blockTrees: new Map(),
      title: CHAT_FIXTURE_TITLE,
      access: { canAct: true, role: "owner" },
    },
    phases: {},
    approve: () => undefined,
    reject: () => undefined,
    answerInterview: () => undefined,
  };
}

function draw(chrome: ChatChrome): ReactElement {
  return (
    <FluentProvider theme={webLightTheme}>
      <ChatScreen
        controller={readyController()}
        entry={null}
        configuredHostId="host-1"
        diffClient={null}
        now={CHAT_FIXTURE_NOW}
        chrome={chrome}
      />
    </FluentProvider>
  );
}

/**
 * The positive half of every absence assertion below. If the screen rendered
 * nothing, this is what fails first.
 */
function expectTheChatActuallyRendered(): void {
  expect(screen.getByText("Conversation")).toBeTruthy();
}

describe("chat screen chrome — screen", () => {
  it("draws a breadcrumb", () => {
    render(draw({ kind: "screen", onBack: () => undefined }));
    expectTheChatActuallyRendered();
    expect(screen.getByLabelText("Location")).toBeTruthy();
  });

  it("its breadcrumb goes back", () => {
    const onBack = vi.fn<() => void>();
    render(draw({ kind: "screen", onBack }));
    fireEvent.click(screen.getByText("Epics"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("names the chat twice — crumb and heading — which is correct HERE", () => {
    /*
     * Pinned as the CONTROL for the pane case below. Without it, "the pane
     * shows the title once" could pass because the screen shows it once too,
     * and the whole change would be untested.
     */
    render(draw({ kind: "screen", onBack: () => undefined }));
    expect(screen.getAllByText(CHAT_FIXTURE_TITLE).length).toBe(2);
  });
});

describe("chat screen chrome — pane", () => {
  it("CONTRACT: draws NO breadcrumb — the canvas screen already has one", () => {
    render(draw({ kind: "pane" }));
    expectTheChatActuallyRendered();
    expect(screen.queryByLabelText("Location")).toBeNull();
  });

  it("CONTRACT: does not repeat the title — the tab strip already shows it", () => {
    /*
     * The defect this exists for is not subtle once seen and is invisible in a
     * diff: render the screen inside a pane unchanged and the user gets two
     * breadcrumbs stacked and the chat's name three times (strip, crumb,
     * heading). Zero here, against two in the screen case above.
     */
    render(draw({ kind: "pane" }));
    expectTheChatActuallyRendered();
    expect(screen.queryAllByText(CHAT_FIXTURE_TITLE).length).toBe(0);
  });

  it("still renders the transcript — chrome is all that differs", () => {
    render(draw({ kind: "pane" }));
    expect(screen.getByText("Conversation")).toBeTruthy();
  });
});
