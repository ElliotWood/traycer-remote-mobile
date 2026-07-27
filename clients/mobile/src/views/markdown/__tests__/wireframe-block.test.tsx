// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { screen, render } from "@/test-utils/dom";
import { WireframeBlock } from "@/views/markdown/wireframe-block";

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
});
