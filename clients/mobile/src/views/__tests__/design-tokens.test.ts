import { describe, expect, it } from "vitest";
import { statusToneColor, theme } from "@/views/design-tokens";

describe("statusToneColor", () => {
  it("maps blocked-language status to danger", () => {
    expect(statusToneColor("Blocked")).toBe(theme.danger);
  });
  it("maps done/complete-language status to success", () => {
    expect(statusToneColor("done")).toBe(theme.success);
    expect(statusToneColor("Completed")).toBe(theme.success);
  });
  it("maps progress/review-language status to warning", () => {
    expect(statusToneColor("in progress")).toBe(theme.warning);
    expect(statusToneColor("in review")).toBe(theme.warning);
  });
  it("falls back to muted for an unrecognized freeform status", () => {
    expect(statusToneColor("planning")).toBe(theme.mutedText);
  });
});
