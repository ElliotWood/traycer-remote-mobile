// @vitest-environment jsdom
/**
 * The readout's whole job is to be TRUE INSIDE TEAMS, where nothing automated
 * can check it. So the two things worth testing here are the two ways it
 * could be false while still displaying a plausible number:
 *
 *   1. it prints something other than the live viewport
 *   2. it samples once and then LIES as the iframe changes size
 *
 * (2) is the real risk and the reason the component uses a resize listener
 * rather than reading `window.innerWidth` during render. Teams resizes the
 * tab iframe when the app rail opens, when a meeting panel appears, and on
 * every rotation — a mount-time sample would report one arbitrary member of a
 * range while looking exactly as authoritative as the truth.
 *
 * The mutation that must redden this file: delete the `resize` listener in
 * `viewport-readout.tsx`. The first two cases still pass (the mount sample is
 * correct); "follows a resize" fails. Watched: with the listener removed the
 * suite goes 3 passed → 2 passed, 1 failed, and the failure names the stale
 * width. Confirming that BEFORE trusting it, because a resize assertion in
 * jsdom is exactly the kind that can pass for the unrelated reason that
 * `fireEvent` re-rendered the tree anyway.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { ViewportReadout } from "../viewport-readout";

afterEach(() => {
  cleanup();
});

/** jsdom lets these be reassigned; they are plain configurable properties. */
function setViewport(width: number, height: number, ratio: number): void {
  Object.defineProperty(window, "innerWidth", {
    value: width,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: height,
    configurable: true,
  });
  Object.defineProperty(window, "devicePixelRatio", {
    value: ratio,
    configurable: true,
  });
}

function draw(): void {
  render(
    <FluentProvider theme={webLightTheme}>
      <ViewportReadout />
    </FluentProvider>,
  );
}

describe("viewport readout", () => {
  it("prints the live width, height and pixel ratio", () => {
    setViewport(1024, 768, 2);
    draw();
    expect(screen.getByTestId("viewport-readout").textContent).toContain(
      "1024×768",
    );
    expect(screen.getByTestId("viewport-readout").textContent).toContain(
      "2.00",
    );
  });

  it("prints a phone-shaped viewport as such", () => {
    // A distinct case rather than a second assertion: the failure mode being
    // guarded is a hard-coded desktop-ish default, which the 1024 case above
    // cannot distinguish from a correct read.
    setViewport(390, 844, 3);
    draw();
    expect(screen.getByTestId("viewport-readout").textContent).toContain(
      "390×844",
    );
  });

  it("follows a resize instead of sampling once", () => {
    setViewport(1024, 768, 2);
    draw();
    expect(screen.getByTestId("viewport-readout").textContent).toContain(
      "1024×768",
    );

    act(() => {
      setViewport(640, 900, 2);
      window.dispatchEvent(new Event("resize"));
    });

    const shown = screen.getByTestId("viewport-readout").textContent ?? "";
    expect(shown).toContain("640×900");
    // The stale value must be GONE, not merely joined by the new one — a
    // component that appended would satisfy `toContain` above while still
    // showing a number that is no longer true.
    expect(shown).not.toContain("1024");
  });
});
