/**
 * `serializeArtifactBody` exact-match tests (Sprint 3 contract round-2 MUST-1).
 *
 * Fragments are built via `@tiptap/y-tiptap`'s `prosemirrorJSONToYXmlFragment`
 * — the SAME construction desktop's own oracle test
 * (`gui-app/__tests__/editor-core/artifact-document-bundle.test.ts`) uses —
 * so this module's output is directly comparable to desktop's. The first
 * case below reuses that exact test's input JSON and expected output
 * verbatim, proving byte-identical (newline-normalized) parity.
 */
import { describe, expect, it } from "vitest";
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { schema, serializeArtifactBody } from "../artifact-body-markdown";

function fragmentFor(json: unknown): Y.XmlFragment {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("artifact-body:test");
  prosemirrorJSONToYXmlFragment(schema, json, fragment);
  return fragment;
}

describe("serializeArtifactBody", () => {
  it("matches the desktop oracle's exact output for heading + taskList + mermaidBlock", () => {
    // Verbatim input/output from gui-app's artifact-document-bundle.test.ts.
    const fragment = fragmentFor({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Export me" }],
        },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Keep formatting" }],
                },
              ],
            },
          ],
        },
        {
          type: "mermaidBlock",
          attrs: { code: "graph TD\n  A --> B" },
        },
      ],
    });

    expect(serializeArtifactBody(fragment)).toBe(
      [
        "# Export me",
        "",
        "- [ ] Keep formatting",
        "",
        "```mermaid",
        "graph TD",
        "  A --> B",
        "```",
      ].join("\n"),
    );
  });

  it("emits the actual mermaid code, not an empty fence", () => {
    const fragment = fragmentFor({
      type: "doc",
      content: [{ type: "mermaidBlock", attrs: { code: "graph TD\n  X --> Y" } }],
    });
    const out = serializeArtifactBody(fragment);
    expect(out).toContain("```mermaid");
    expect(out).toContain("graph TD");
    expect(out).toContain("X --> Y");
  });

  it("emits the actual wireframe HTML, not an empty fence", () => {
    const fragment = fragmentFor({
      type: "doc",
      content: [
        {
          type: "uiPreviewBlock",
          attrs: { htmlContent: "<div class=\"card\">real html</div>", title: "UI Preview" },
        },
      ],
    });
    const out = serializeArtifactBody(fragment);
    expect(out).toContain("```wireframe");
    expect(out).toContain('<div class="card">real html</div>');
  });

  it("round-2 (e): an unpromoted codeBlock(language=mermaid|wireframe) still fences correctly", () => {
    const fragment = fragmentFor({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "mermaid" },
          content: [{ type: "text", text: "graph TD\n  A --> B" }],
        },
      ],
    });
    const out = serializeArtifactBody(fragment);
    expect(out).toBe(["```mermaid", "graph TD", "  A --> B", "```"].join("\n"));
  });

  it("renders both taskItem checked states correctly paired to their item", () => {
    const fragment = fragmentFor({
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Done thing" }] }],
            },
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Not done" }] }],
            },
          ],
        },
      ],
    });
    const out = serializeArtifactBody(fragment);
    expect(out).toContain("- [x] Done thing");
    expect(out).toContain("- [ ] Not done");
  });

  it("serializes a blockquote to a '>' prefixed line, not the chat serializer's tag", () => {
    const fragment = fragmentFor({
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "quoted text" }] }],
        },
      ],
    });
    const out = serializeArtifactBody(fragment);
    expect(out).toMatch(/^>\s*quoted text/m);
    expect(out).not.toContain("user_quoted_section");
  });

  it("a threadAnchor-marked span serializes to its inner text with no throw and no leaked tag", () => {
    const fragment = fragmentFor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "commented text",
              marks: [{ type: "threadAnchor", attrs: { threadId: "t1" } }],
            },
          ],
        },
      ],
    });
    expect(() => serializeArtifactBody(fragment)).not.toThrow();
    const out = serializeArtifactBody(fragment);
    expect(out).toContain("commented text");
    expect(out).not.toContain("threadAnchor");
    expect(out).not.toContain("t1");
  });

  it("a table renders as a GFM table", () => {
    const fragment = fragmentFor({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "H" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "v" }] }] },
              ],
            },
          ],
        },
      ],
    });
    const out = serializeArtifactBody(fragment);
    expect(out).toMatch(/\|\s*H\s*\|/);
    expect(out).toMatch(/\|\s*v\s*\|/);
    expect(out).toContain("---"); // header separator row
  });
});
