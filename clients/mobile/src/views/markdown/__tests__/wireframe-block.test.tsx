// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import { screen, render } from "@/test-utils/dom";
import { WireframeBlock } from "@/views/markdown/wireframe-block";

const HEIGHT_MESSAGE_MARKER = "traycer:mobile:wireframe:height:v1";

describe("WireframeBlock", () => {
  it("renders a sandboxed iframe (allow-scripts, no allow-same-origin) carrying the raw HTML", () => {
    const html = "<!doctype html><html><body><button>Tap target</button></body></html>";
    render(<WireframeBlock code={html} />);

    const frame = screen.getByTestId("wireframe-frame") as HTMLIFrameElement;
    const sandbox = frame.getAttribute("sandbox") ?? "";
    expect(sandbox.split(/\s+/)).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
    expect(frame.getAttribute("srcdoc")).toContain("<button>Tap target</button>");
  });

  it("resets height to the minimum immediately when `code` changes, not the previous frame's grown height", () => {
    const html = "<!doctype html><html><body>A</body></html>";
    const { rerender } = render(<WireframeBlock code={html} />);
    const frame = screen.getByTestId("wireframe-frame") as HTMLIFrameElement;

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: { marker: HEIGHT_MESSAGE_MARKER, height: 900 },
        }),
      );
    });
    expect(frame.style.height).toBe("900px");

    rerender(<WireframeBlock code="<!doctype html><html><body>B</body></html>" />);

    // Reset on the SAME render the code prop changed — not held over into
    // the new frame's first paint waiting for an effect to catch up.
    expect(frame.style.height).toBe("200px");
  });
});
