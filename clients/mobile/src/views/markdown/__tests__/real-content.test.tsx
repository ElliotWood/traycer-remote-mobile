// @vitest-environment jsdom
/**
 * Contract requirement (Sprint 1, negotiated with the Evaluator): the
 * renderer must survive arbitrary REAL artifact markdown, not just a
 * hand-tuned sample that could be shaped to pass. Reads this epic's own
 * tech-plan artifact — which contains a real `graph TD` mermaid block and a
 * real table — and asserts it renders without throwing.
 *
 * The path is absolute and machine-local to this autobuild run by design
 * (the Evaluator specified this exact artifact). `readFileSync` fails loudly
 * if it's missing rather than silently skipping — a green run here must mean
 * it actually exercised real content.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render } from "@/test-utils/dom";
import { MobileMarkdown } from "@/views/markdown/mobile-markdown";

const TECH_PLAN_PATH =
  "C:\\Users\\gigaf\\.traycer\\epics\\9c9ddaf0-99ce-412a-b4b8-49e0b1d8a4ef\\artifacts\\traycer-remote-mobile\\v2-desktop-companion\\tech-plan\\index.md";

describe("MobileMarkdown — real artifact content", () => {
  it("renders the epic's own tech-plan doc without throwing", () => {
    const markdown = readFileSync(TECH_PLAN_PATH, "utf8");
    expect(markdown).toContain("```mermaid");
    expect(markdown.toLowerCase()).toContain("graph td");

    const { container } = render(<MobileMarkdown>{markdown}</MobileMarkdown>);

    // The mermaid fence rendered as a distinct block (loading/diagram/error
    // state) — never inlined as plain fenced text.
    expect(
      container.querySelector(
        '[data-testid="mermaid-loading"], [data-testid="mermaid-diagram"], [data-testid="mermaid-error"]',
      ),
    ).toBeTruthy();

    const table = container.querySelector("table");
    expect(table).toBeTruthy();
    expect(table?.parentElement?.getAttribute("style") ?? "").toContain("overflow-x: auto");
  });
});
