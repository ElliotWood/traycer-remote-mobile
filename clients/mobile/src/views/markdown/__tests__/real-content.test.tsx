// @vitest-environment jsdom
/**
 * Contract requirement (Sprint 1, negotiated with the Evaluator): the
 * renderer must survive arbitrary REAL artifact markdown, not just a
 * hand-tuned sample that could be shaped to pass, and never throw on
 * punctuation-heavy real content (nested brackets/colons inside a mermaid
 * node label, inline code mixed with plain text in one table cell).
 *
 * Originally read a real epic artifact via an absolute, machine-local path
 * (`C:\Users\...\9c9ddaf0-...\tech-plan\index.md`) — reasoned as "fails
 * loudly rather than silently skips", which is right, but the loud failure
 * fired on every machine that wasn't the one that wrote it, including CI —
 * the first time this package ever ran there. `fixtures/real-content-sample.md`
 * is committed alongside this test instead, reproducing the same
 * constructs (established by reading the original before replacing it), so
 * it's real-shaped content rather than a hand-tuned one-liner, while
 * working on every machine.
 *
 * WHAT THIS TEST DOES NOT PROVE, stated plainly so nobody reads more into
 * it later: the "no throw" property covers the WHOLE fixture (mermaid
 * fence + table) — a parser regression on the fence's punctuation fails
 * this test even though the two assertions below can't see it directly.
 * But mermaid DIAGRAM FIDELITY (does `graph TD` with this exact subgraph
 * actually render correctly) is not assertable here at all: real mermaid
 * cannot render in jsdom — verified directly, a syntactically valid
 * diagram and a broken one both settle to the SAME `mermaid-error` state
 * under real (unmocked) mermaid. The mermaid assertion below only proves
 * the fence was routed to `MermaidBlock` instead of being inlined as
 * literal fenced text — `mermaid-block.test.tsx` covers wiring/config
 * against a MOCKED mermaid for the same reason (see its own docblock);
 * neither test is the live-diagram-rendering gate. That gate is a real
 * browser, not jsdom.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "@/test-utils/dom";
import { MobileMarkdown } from "@/views/markdown/mobile-markdown";

const FIXTURE_PATH = join(import.meta.dirname, "fixtures", "real-content-sample.md");

/** A `<td>` that mixes an inline `<code>` span with plain text alongside it — the exact shape the fixture's icon table exercises (`` `#fbbf24` `` amber-400``). */
function isMixedContentCell(cell: Element): boolean {
  if (cell.querySelector("code") === null) return false;
  const withoutCode = cell.cloneNode(true) as Element;
  withoutCode.querySelectorAll("code").forEach((code) => code.remove());
  return (withoutCode.textContent ?? "").trim() !== "";
}

describe("MobileMarkdown — real artifact content", () => {
  it("renders a real-shaped artifact doc (subgraph mermaid + mixed-content table) without throwing", () => {
    const markdown = readFileSync(FIXTURE_PATH, "utf8");
    expect(markdown).toContain("```mermaid");
    expect(markdown.toLowerCase()).toContain("graph td");

    const { container } = render(<MobileMarkdown>{markdown}</MobileMarkdown>);

    // Proves the fence was routed to MermaidBlock, not inlined as literal
    // fenced text — NOT diagram fidelity, see the docblock above.
    expect(
      container.querySelector(
        '[data-testid="mermaid-loading"], [data-testid="mermaid-diagram"], [data-testid="mermaid-error"]',
      ),
    ).toBeTruthy();

    const table = container.querySelector("table");
    expect(table).toBeTruthy();
    expect(table?.parentElement?.getAttribute("style") ?? "").toContain("overflow-x: auto");

    // Discriminating, unlike the two checks above: a trivial single-value
    // table has zero of these; the real fixture's icon table has several.
    // This is what actually makes the table's "mixed content in one cell"
    // shape load-bearing rather than illustrative.
    const mixedContentCells = Array.from(container.querySelectorAll("td")).filter(isMixedContentCell);
    expect(mixedContentCells.length).toBeGreaterThan(0);
  });
});
