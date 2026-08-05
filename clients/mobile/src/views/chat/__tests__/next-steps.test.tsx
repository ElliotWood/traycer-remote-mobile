// @vitest-environment jsdom
/**
 * The user-visible bug this covers: a `<TRAYCER_NEXT_STEPS>` block used to
 * render as raw `- [] some text` markdown, because mobile had no handling
 * for it at all. These pin the rendering + the composer wiring; the GRAMMAR
 * itself is tested once, in the shared parser's own suite, deliberately not
 * duplicated here.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { fireEvent, render, screen } from "@/test-utils/dom";
import { TextBlock } from "@/views/chat/blocks/text-block";
import { NextStepsProvider } from "@/views/chat/next-steps-context";

function textBlock(text: string): Parameters<typeof TextBlock>[0]["block"] {
  return { type: "text", text, providerNotice: null } as Parameters<
    typeof TextBlock
  >[0]["block"];
}

const WITH_OPTIONS = [
  "Here is the summary.",
  "",
  "<TRAYCER_NEXT_STEPS>",
  "Pick one:",
  "",
  "- [] Run the tests",
  "- [] Ship it",
  "</TRAYCER_NEXT_STEPS>",
].join("\n");

function renderWithProvider(text: string, insertPrompt: (p: string) => void): ReactElement {
  return render(
    <NextStepsProvider value={{ insertPrompt }}>
      <TextBlock block={textBlock(text)} />
    </NextStepsProvider>,
  ) as unknown as ReactElement;
}

describe("next-steps rendering", () => {
  it("renders options as tappable rows, not raw markdown", () => {
    renderWithProvider(WITH_OPTIONS, () => {});

    const options = screen.getAllByTestId("next-step-option");
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain("Run the tests");
    expect(options[1].textContent).toContain("Ship it");

    // The raw markup must NOT survive anywhere in the output — that literal
    // string is exactly what the user reported seeing.
    expect(document.body.textContent).not.toContain("- []");
    expect(document.body.textContent).not.toContain("TRAYCER_NEXT_STEPS");
  });

  it("keeps the surrounding prose", () => {
    renderWithProvider(WITH_OPTIONS, () => {});
    expect(document.body.textContent).toContain("Here is the summary.");
    expect(document.body.textContent).toContain("Pick one:");
  });

  it("sends the option's prompt to the composer when tapped", () => {
    const insertPrompt = vi.fn();
    renderWithProvider(WITH_OPTIONS, insertPrompt);

    fireEvent.click(screen.getAllByTestId("next-step-option")[1]);

    expect(insertPrompt).toHaveBeenCalledTimes(1);
    expect(insertPrompt).toHaveBeenCalledWith("Ship it");
  });

  it("renders inert rows — never dead buttons — with no provider mounted", () => {
    render(<TextBlock block={textBlock(WITH_OPTIONS)} />);

    // A button that does nothing when tapped is worse than obviously-inert
    // text, so the actionable variant must be absent entirely.
    expect(screen.queryAllByTestId("next-step-option")).toHaveLength(0);
    expect(screen.getAllByTestId("next-step-option-inert")).toHaveLength(2);
  });

  it("leaves an ordinary message completely untouched", () => {
    render(<TextBlock block={textBlock("Just a normal reply.")} />);
    expect(screen.queryByTestId("next-steps-group")).toBeNull();
    expect(document.body.textContent).toContain("Just a normal reply.");
  });
});
