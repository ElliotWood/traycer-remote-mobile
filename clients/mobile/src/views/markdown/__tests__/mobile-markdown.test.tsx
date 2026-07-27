// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { screen, render } from "@/test-utils/dom";
import { MobileMarkdown } from "@/views/markdown/mobile-markdown";

describe("MobileMarkdown — structure", () => {
  it("renders headings, blockquote, nested list, and table as structured DOM", () => {
    const md = `# H1
## H2
### H3

> a quote

- top
  - nested

| A | B |
| --- | --- |
| 1 | 2 |
`;
    const { container } = render(<MobileMarkdown>{md}</MobileMarkdown>);

    expect(screen.getByRole("heading", { level: 1, name: "H1" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "H2" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "H3" })).toBeTruthy();
    expect(container.querySelector("blockquote")).toBeTruthy();
    expect(container.querySelector("li ul")).toBeTruthy();
    expect(container.querySelector("table")).toBeTruthy();
  });

  it("renders GFM task-list items as real, correctly-checked checkboxes", () => {
    const md = "- [x] done\n- [ ] todo\n";
    const { container } = render(<MobileMarkdown>{md}</MobileMarkdown>);
    const checkboxes = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    );
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0].disabled).toBe(true);
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);
  });

  it("wraps a table in a horizontally scroll-contained wrapper", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |\n";
    const { container } = render(<MobileMarkdown>{md}</MobileMarkdown>);
    const table = container.querySelector("table");
    expect(table?.parentElement?.getAttribute("style") ?? "").toContain("overflow-x: auto");
  });
});

describe("MobileMarkdown — sanitization (raw-HTML path, rehype-raw before rehype-sanitize)", () => {
  it("never renders a <script> element from an embedded <script> tag", () => {
    const md = "before <script>alert(1)</script> after";
    const { container } = render(<MobileMarkdown>{md}</MobileMarkdown>);
    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).not.toContain("alert(1)");
  });

  it("strips onerror from a raw <img onerror> tag", () => {
    const md = '<img src="x" onerror="alert(1)">';
    const { container } = render(<MobileMarkdown>{md}</MobileMarkdown>);
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("onerror")).toBeNull();
  });

  it("neutralizes a javascript: href", () => {
    const md = "[click me](javascript:alert(1))";
    const { container } = render(<MobileMarkdown>{md}</MobileMarkdown>);
    const a = container.querySelector("a");
    expect(a).toBeTruthy();
    expect(a?.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
  });
});

describe("MobileMarkdown — fenced code", () => {
  it("falls back to a plain code block for an unknown fence language, never throws", () => {
    const md = "```made-up-lang\nsome content\n```";
    expect(() => render(<MobileMarkdown>{md}</MobileMarkdown>)).not.toThrow();
    expect(screen.getByText("some content")).toBeTruthy();
  });

  it("renders inline code without the block container", () => {
    const md = "a `code span` inline";
    const { container } = render(<MobileMarkdown>{md}</MobileMarkdown>);
    const code = container.querySelector("code");
    expect(code?.textContent).toBe("code span");
    expect(container.querySelector("pre")).toBeNull();
  });
});
