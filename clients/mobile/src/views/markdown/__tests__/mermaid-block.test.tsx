// @vitest-environment jsdom
/**
 * jsdom cannot lay out real SVG, so this proves wiring/config/error-handling
 * only — a live browser render (Evaluator, per the Sprint 1 contract) is the
 * hard gate for "an actual diagram renders, legible on dark".
 */
import { describe, expect, it, vi } from "vitest";
import { screen, render, waitFor } from "@/test-utils/dom";
import { MermaidBlock } from "@/views/markdown/mermaid-block";

const initializeMock = vi.fn();
const renderMock = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: (config: unknown) => initializeMock(config),
    render: (id: string, code: string) => renderMock(id, code),
  },
}));

describe("MermaidBlock", () => {
  it("shows loading, then initializes mermaid strict+dark and renders the svg", async () => {
    renderMock.mockResolvedValueOnce({ svg: '<svg data-mock="1"></svg>' });
    render(<MermaidBlock code="graph TD; A-->B;" />);

    expect(screen.getByTestId("mermaid-loading")).toBeTruthy();

    await waitFor(() => expect(screen.getByTestId("mermaid-diagram")).toBeTruthy());
    expect(screen.getByTestId("mermaid-diagram").querySelector("svg")).toBeTruthy();

    expect(initializeMock).toHaveBeenCalledTimes(1);
    const config = initializeMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config.securityLevel).toBe("strict");
    expect(config.startOnLoad).toBe(false);
    expect(config.suppressErrorRendering).toBe(true);
    expect(config.themeVariables).toBeTruthy();
  });

  it("shows a labeled error, never throws, on a rejected render", async () => {
    renderMock.mockRejectedValueOnce(new Error("bad syntax"));
    render(<MermaidBlock code="not valid" />);

    await waitFor(() => expect(screen.getByTestId("mermaid-error")).toBeTruthy());
    expect(screen.getByText(/bad syntax/)).toBeTruthy();
    expect(screen.queryByTestId("mermaid-diagram")).toBeNull();
  });

  it("resets to loading immediately when `code` changes, not the stale previous diagram", async () => {
    renderMock.mockResolvedValueOnce({ svg: '<svg data-mock="A"></svg>' });
    const { rerender } = render(<MermaidBlock code="graph TD; A-->B;" />);
    await waitFor(() => expect(screen.getByTestId("mermaid-diagram")).toBeTruthy());
    expect(screen.getByTestId("mermaid-diagram").querySelector('[data-mock="A"]')).toBeTruthy();

    let resolveSecond: (value: { svg: string }) => void = () => {};
    renderMock.mockReturnValueOnce(new Promise((resolve) => (resolveSecond = resolve)));
    rerender(<MermaidBlock code="graph TD; C-->D;" />);

    // Loading shown right away, on the SAME render — not a stale "A" diagram
    // held over for a frame while an effect catches up.
    expect(screen.getByTestId("mermaid-loading")).toBeTruthy();
    expect(screen.queryByTestId("mermaid-diagram")).toBeNull();

    resolveSecond({ svg: '<svg data-mock="B"></svg>' });
    await waitFor(() => expect(screen.getByTestId("mermaid-diagram")).toBeTruthy());
    expect(screen.getByTestId("mermaid-diagram").querySelector('[data-mock="B"]')).toBeTruthy();
  });
});
