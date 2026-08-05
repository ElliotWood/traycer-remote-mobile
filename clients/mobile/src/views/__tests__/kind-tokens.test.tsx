// @vitest-environment jsdom
/**
 * Sprint 1 / M1 — token exactness + card treatment. Rubric §1 is
 * NON-NEGOTIABLE: wrong hex, missing icon tile, or a status dot on a
 * spec/review card is "AI slop" the contract requires a real assertion
 * against, not just "doesn't crash".
 */
import { describe, expect, it } from "vitest";
import {
  KIND_COLORS,
  KindCard,
  KindIcon,
  STATUS_DOT_COLORS,
  hexToRgba,
  type ArtifactStatus,
  type CardKind,
} from "@/views/kind-tokens";
import { screen, render } from "@/test-utils/dom";

describe("KIND_COLORS / STATUS_DOT_COLORS — exact hex", () => {
  it("matches the rubric hex list for every kind", () => {
    expect(KIND_COLORS.spec.toLowerCase()).toBe("#fbbf24");
    expect(KIND_COLORS.ticket.toLowerCase()).toBe("#a78bfa");
    expect(KIND_COLORS.story.toLowerCase()).toBe("#34d399");
    expect(KIND_COLORS.review.toLowerCase()).toBe("#fb7185");
    expect(KIND_COLORS.chat.toLowerCase()).toBe("#38bdf8");
  });

  it("matches the rubric hex list for every status", () => {
    expect(STATUS_DOT_COLORS[0].toLowerCase()).toBe("#94a3b8");
    expect(STATUS_DOT_COLORS[1].toLowerCase()).toBe("#f59e0b");
    expect(STATUS_DOT_COLORS[2].toLowerCase()).toBe("#10b981");
  });
});

describe("hexToRgba", () => {
  it("converts a 6-digit hex + alpha", () => {
    expect(hexToRgba("#fbbf24", 0.08)).toBe("rgba(251, 191, 36, 0.08)");
  });
});

/**
 * jsdom's CSSOM normalizes any hex color set via inline `style` to
 * `rgb(r, g, b)` on read-back (via `getAttribute("style")` or
 * `getComputedStyle`) — it never echoes the original `#rrggbb`. Assertions
 * against a literal color therefore compare against THIS, not the hex string.
 */
function hexToRgbCss(hex: string): string {
  return hexToRgba(hex, 1).replace(/^rgba\(([^)]+), 1\)$/, "rgb($1)");
}

const CARD_KINDS: readonly CardKind[] = ["spec", "ticket", "story", "review"];

describe("KindCard — border + tint + icon tile", () => {
  it.each(CARD_KINDS)("renders the icon tile and surface tint for %s", (kind) => {
    render(<KindCard kind={kind} title={`a ${kind}`} />);
    const card = screen.getByTestId("kind-card");
    expect(card.dataset.kind).toBe(kind);

    const style = card.getAttribute("style") ?? "";
    // Surface tint: an rgba wash of the kind color, not a flat/generic gray.
    expect(style).toContain(hexToRgba(KIND_COLORS[kind], 0.08));
    // Colored left border (3px), distinct from the outer 1px border on the
    // other three sides. The outer border's WIDTH is asserted via
    // `getComputedStyle` (kind-tokens.tsx sets it as a separate `borderWidth`
    // longhand rather than the `border` shorthand specifically so this keeps
    // working even though `borderColor` resolves to `var(--border)` — a CSS
    // custom property jsdom's cssstyle can't substitute outside a real
    // browser with `global.css` loaded).
    const computed = getComputedStyle(card);
    expect(computed.borderLeftWidth).toBe("3px");
    expect(computed.borderLeftColor).toBe(hexToRgbCss(KIND_COLORS[kind]));
    expect(computed.borderTopWidth).toBe("1px");

    const tile = screen.getByTestId("kind-icon-tile");
    const tileStyle = tile.getAttribute("style") ?? "";
    expect(tileStyle).toContain(hexToRgba(KIND_COLORS[kind], 0.1));
    expect(tileStyle).toContain(hexToRgba(KIND_COLORS[kind], 0.25));

    // The icon itself renders inside the tile (an <svg> from lucide-react).
    expect(tile.querySelector("svg")).toBeTruthy();
  });
});

describe("StatusDot — negative case (spec/review never show a dot)", () => {
  it.each(["spec", "review"] as const)(
    "does not render a status dot for %s even when status is passed",
    (kind) => {
      render(<KindCard kind={kind} status={1} title={`a ${kind}`} />);
      expect(screen.queryByTestId("status-dot")).toBeNull();
    },
  );
});

describe("StatusDot — positive case (ticket/story render the exact per-status color)", () => {
  const cases: ReadonlyArray<[CardKind, ArtifactStatus]> = [
    ["ticket", 0],
    ["ticket", 1],
    ["ticket", 2],
    ["story", 0],
    ["story", 1],
    ["story", 2],
  ];

  it.each(cases)("%s at status %d renders the matching dot color", (kind, status) => {
    render(<KindCard kind={kind} status={status} title={`a ${kind}`} />);
    const dot = screen.getByTestId("status-dot");
    expect(getComputedStyle(dot).backgroundColor).toBe(hexToRgbCss(STATUS_DOT_COLORS[status]));
  });

  it("omits the dot when status is undefined even for ticket/story", () => {
    render(<KindCard kind="ticket" title="untriaged" />);
    expect(screen.queryByTestId("status-dot")).toBeNull();
  });
});

describe("chat — no card chrome", () => {
  it("KindIcon renders icon+color with no border/tint/tile", () => {
    render(<KindIcon kind="chat" label="a chat" />);
    expect(screen.queryByTestId("kind-card")).toBeNull();
    expect(screen.queryByTestId("kind-icon-tile")).toBeNull();
    expect(screen.queryByTestId("status-dot")).toBeNull();

    const icon = screen.getByTestId("kind-icon");
    expect(icon.dataset.kind).toBe("chat");
    expect(icon.querySelector("svg")).toBeTruthy();
  });
});
