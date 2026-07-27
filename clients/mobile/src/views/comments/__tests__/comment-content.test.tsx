// @vitest-environment jsdom
/**
 * `CommentContent` (S4, F4): every grammar element the gui-app-mirrored
 * walker supports, plus the never-throws fallback paths.
 */
import { describe, expect, it } from "vitest";
import type { JsonContent } from "@traycer/protocol/common/registry";
import { CommentContent } from "../comment-content";
import { render, screen } from "@/test-utils/dom";

function doc(content: JsonContent[]): JsonContent {
  return { type: "doc", content };
}

describe("CommentContent", () => {
  it("renders a paragraph with plain text", () => {
    render(
      <CommentContent
        content={doc([
          { type: "paragraph", content: [{ type: "text", text: "hello" }] },
        ])}
      />,
    );
    expect(screen.getByText("hello")).toBeTruthy();
  });

  it("renders a bullet list with a nested list item", () => {
    render(
      <CommentContent
        content={doc([
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "item one" }],
                  },
                ],
              },
            ],
          },
        ])}
      />,
    );
    const item = screen.getByText("item one");
    expect(item.closest("li")).toBeTruthy();
    expect(item.closest("ul")).toBeTruthy();
  });

  it("renders an ordered list", () => {
    render(
      <CommentContent
        content={doc([
          {
            type: "orderedList",
            content: [
              {
                type: "listItem",
                content: [{ type: "text", text: "first" }],
              },
            ],
          },
        ])}
      />,
    );
    expect(screen.getByText("first").closest("ol")).toBeTruthy();
  });

  it("renders a hardBreak as <br>", () => {
    const { container } = render(
      <CommentContent
        content={doc([
          {
            type: "paragraph",
            content: [
              { type: "text", text: "a" },
              { type: "hardBreak" },
              { type: "text", text: "b" },
            ],
          },
        ])}
      />,
    );
    expect(container.querySelector("br")).toBeTruthy();
  });

  it.each([
    ["bold", "strong"],
    ["italic", "em"],
    ["code", "code"],
    ["strike", "s"],
  ] as const)("renders the %s mark as <%s>", (markType, tag) => {
    const { container } = render(
      <CommentContent
        content={doc([
          {
            type: "paragraph",
            content: [
              { type: "text", text: "styled", marks: [{ type: markType }] },
            ],
          },
        ])}
      />,
    );
    const el = container.querySelector(tag);
    expect(el?.textContent).toBe("styled");
  });

  it("renders a mention using its label", () => {
    render(
      <CommentContent
        content={doc([
          {
            type: "paragraph",
            content: [
              {
                type: "mention",
                attrs: { id: "u1", label: "Ada" },
              },
            ],
          },
        ])}
      />,
    );
    expect(screen.getByText("@Ada")).toBeTruthy();
  });

  it("falls back to the id when a mention has no label", () => {
    render(
      <CommentContent
        content={doc([
          { type: "paragraph", content: [{ type: "mention", attrs: { id: "u1" } }] },
        ])}
      />,
    );
    expect(screen.getByText("@u1")).toBeTruthy();
  });

  it("recurses into an unknown node's children instead of dropping text", () => {
    render(
      <CommentContent
        content={doc([
          {
            type: "blockquote",
            content: [{ type: "text", text: "quoted aside" }],
          },
        ])}
      />,
    );
    expect(screen.getByText("quoted aside")).toBeTruthy();
  });

  it("falls back to the raw text field for a childless unknown leaf", () => {
    render(
      <CommentContent content={doc([{ type: "mysteryLeaf", text: "leaf text" }])} />,
    );
    expect(screen.getByText("leaf text")).toBeTruthy();
  });

  it("renders nothing (never throws) for empty/absent content", () => {
    expect(() => render(<CommentContent content={{ type: "doc" }} />)).not.toThrow();
    expect(() => render(<CommentContent content={doc([])} />)).not.toThrow();
  });
});
