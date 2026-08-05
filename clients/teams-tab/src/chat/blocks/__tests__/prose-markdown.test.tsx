// @vitest-environment jsdom
/**
 * The ORDINARY prose path — `text` and `reasoning` — asserted at the layer a
 * user meets.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS WHEN `markdown-in-blocks.test.tsx` ALREADY COVERS
 * MARKDOWN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * That file is at the right layer and covers the right *way*. It covers the
 * wrong *kinds*: `subagent`, `plan`, `todo`, `autonomous_resume` — the four
 * that were new and interesting when it was written.
 *
 * **The plain `text` block is not among them.** It is the assistant's ordinary
 * prose, the most common thing in any transcript, and the thing Elliot
 * photographed when this defect last shipped (`271b76d7`). Its render was
 * repaired and never pinned, so it is one edit from regressing with a green
 * suite — the coverage equivalent of a fix without a test.
 *
 * `reasoning` is worse. It is the row the parity contract counted as
 * *rendering* while it produced an empty string for months, because the block
 * carries its prose in `content` and the projection read `text`. Both layers
 * behaved as written. Nothing failed.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ELEMENTS, NOT ABSENCE OF CHARACTERS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Asserting only `not.toContain("**")` passes for a renderer that DELETED the
 * text. Every case below therefore asserts the element that must exist — a
 * `<strong>`, a `<ul>` with `<li>` children, a `<pre>` — AND that the literal
 * marker is gone AND that the words survived. A defect can move in three
 * directions and one assertion covers one of them.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { TranscriptView } from "@/chat/transcript-view";
import type { TranscriptMessage } from "@traycer-clients/shared/epic/transcript";

afterEach(() => {
  cleanup();
});

const FENCE = "```";

/**
 * Carries every shape from the screenshot — bold, a dash list, a fence — plus
 * a heading. A fixture missing any of them cannot fail on the claim it is
 * named after, which is how the first chat fixture passed while the fence
 * defect was live.
 */
const PROSE = [
  "# Heading",
  "",
  "Here is **bold** text.",
  "",
  "- first item",
  "- second item",
  "",
  `${FENCE}ts`,
  "const x = 1;",
  FENCE,
].join("\n");

function draw(messages: readonly TranscriptMessage[]): void {
  render(
    <FluentProvider theme={webLightTheme}>
      <TranscriptView
        messages={messages}
        // EMPTY on purpose. An assistant turn with no block tree falls back to
        // the prose path, which is the path under test here — the tree path
        // has its own file. Passing a tree would silently test the other one.
        blockTrees={new Map()}
        client={null}
        now={1_000_000}
      />
    </FluentProvider>,
  );
}

function message(blocks: TranscriptMessage["blocks"]): TranscriptMessage {
  return {
    id: "m1",
    author: "Claude",
    role: "assistant",
    timestamp: 1_000_000,
    blocks,
  } as TranscriptMessage;
}

function shown(): string {
  return document.body.textContent ?? "";
}

describe("a plain text block renders as markdown, not as characters", () => {
  it("CONTRACT: bold becomes <strong> and the asterisks are gone", () => {
    draw([message([{ kind: "text", text: PROSE }] as TranscriptMessage["blocks"])]);

    // The element must EXIST. Without this the test passes for a renderer that
    // dropped the text entirely.
    expect(document.querySelectorAll("strong").length).toBeGreaterThan(0);
    expect(document.querySelector("strong")?.textContent).toBe("bold");
    expect(shown()).not.toContain("**");
    // And the words survived, which neither of the above guarantees.
    expect(shown()).toContain("bold");
  });

  it("CONTRACT: a dash list becomes <ul>/<li>, not lines beginning with a dash", () => {
    draw([message([{ kind: "text", text: PROSE }] as TranscriptMessage["blocks"])]);

    expect(document.querySelectorAll("ul").length).toBeGreaterThan(0);
    expect(document.querySelectorAll("li").length).toBe(2);
    expect(shown()).not.toContain("- first");
    expect(shown()).toContain("first item");
  });

  it("CONTRACT: a fence becomes <pre>, and its markers are not on screen", () => {
    draw([message([{ kind: "text", text: PROSE }] as TranscriptMessage["blocks"])]);

    expect(document.querySelectorAll("pre").length).toBeGreaterThan(0);
    expect(shown()).not.toContain(FENCE);
    expect(shown()).toContain("const x = 1;");
  });

  it("CONTRACT: a heading becomes <h1>, not a hash", () => {
    draw([message([{ kind: "text", text: PROSE }] as TranscriptMessage["blocks"])]);

    expect(document.querySelectorAll("h1").length).toBe(1);
    expect(shown()).not.toContain("# Heading");
    expect(shown()).toContain("Heading");
  });
});

describe("a reasoning block renders its prose at all", () => {
  it("CONTRACT: reasoning prose reaches the DOM as markdown", () => {
    /*
     * The row the parity contract counted as rendering while it was empty.
     * The projection reads `text`; the BLOCK carries `content`. This asserts
     * the prose-path shape the transcript actually receives — a non-empty
     * `text` — so a projection that goes back to producing "" fails here
     * rather than rendering nothing and looking tidy.
     */
    draw([
      message([
        { kind: "reasoning", text: "Weighing **two** options." },
      ] as TranscriptMessage["blocks"]),
    ]);

    expect(document.querySelectorAll("strong").length).toBe(1);
    expect(shown()).toContain("Weighing");
    expect(shown()).not.toContain("**");
  });

  it("CONTRACT: empty reasoning renders nothing rather than an empty card", () => {
    // The other direction, and the reason the defect survived: rendering an
    // empty box for absent prose is how "it renders" stayed true on paper.
    draw([
      message([{ kind: "reasoning", text: "   " }] as TranscriptMessage["blocks"]),
    ]);

    expect(document.querySelectorAll("strong").length).toBe(0);
    expect(shown()).not.toContain("Thought");
  });
});
