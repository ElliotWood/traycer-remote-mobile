import { describe, expect, it } from "vitest";
import type { TokenUsage } from "@traycer/protocol/persistence/epic/foundation";
import { effectiveContextPercentLeft } from "../context-usage-chip";

function usage(overrides: Partial<TokenUsage>): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, ...overrides };
}

describe("effectiveContextPercentLeft", () => {
  it("is null when usage is null", () => {
    expect(effectiveContextPercentLeft(null)).toBeNull();
  });

  it("is null when the harness reports no contextWindow (no real signal)", () => {
    expect(effectiveContextPercentLeft(usage({ totalTokens: 100 }))).toBeNull();
  });

  it("computes percent left from contextTokens over contextWindow", () => {
    expect(effectiveContextPercentLeft(usage({ contextTokens: 2000, contextWindow: 10000 }))).toBe(80);
  });

  it("falls back to totalTokens when contextTokens is absent", () => {
    expect(effectiveContextPercentLeft(usage({ totalTokens: 5000, contextWindow: 10000 }))).toBe(50);
  });

  it("folds contextBaselineTokens into the used total", () => {
    expect(
      effectiveContextPercentLeft(usage({ contextTokens: 1000, contextBaselineTokens: 1000, contextWindow: 10000 })),
    ).toBe(80);
  });

  it("clamps to 0% left when usage exceeds the window", () => {
    expect(effectiveContextPercentLeft(usage({ contextTokens: 20000, contextWindow: 10000 }))).toBe(0);
  });
});
