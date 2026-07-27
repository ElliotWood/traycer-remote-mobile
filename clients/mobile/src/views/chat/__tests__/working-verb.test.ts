import { describe, expect, it } from "vitest";
import {
  ELAPSED_VERBS,
  WORKING_VERBS,
  formatUsd,
  formatWorkedFor,
  pickElapsedVerb,
  pickWorkingVerb,
} from "../working-verb";

describe("pickWorkingVerb / pickElapsedVerb", () => {
  it("is deterministic for the same seed", () => {
    expect(pickWorkingVerb("turn-1")).toBe(pickWorkingVerb("turn-1"));
    expect(pickElapsedVerb("turn-1")).toBe(pickElapsedVerb("turn-1"));
  });

  it("always returns a member of the corresponding list", () => {
    for (const seed of ["a", "b", "turn-42", "", "🎉"]) {
      expect(WORKING_VERBS).toContain(pickWorkingVerb(seed));
      expect(ELAPSED_VERBS).toContain(pickElapsedVerb(seed));
    }
  });

  it("the working and elapsed lists are the same length (present/past tense pairs)", () => {
    expect(WORKING_VERBS.length).toBe(ELAPSED_VERBS.length);
  });
});

describe("formatWorkedFor", () => {
  it("floors under a second to '<1s'", () => {
    expect(formatWorkedFor(0)).toBe("<1s");
    expect(formatWorkedFor(999)).toBe("<1s");
  });

  it("formats seconds only", () => {
    expect(formatWorkedFor(1000)).toBe("1s");
    expect(formatWorkedFor(45000)).toBe("45s");
  });

  it("formats minutes + seconds", () => {
    expect(formatWorkedFor(72000)).toBe("1m 12s");
  });

  it("formats hours + minutes + seconds", () => {
    expect(formatWorkedFor(3661000)).toBe("1h 1m 1s");
  });
});

describe("formatUsd", () => {
  it("formats >= $1 as 2 decimals", () => {
    expect(formatUsd(1)).toBe("$1.00");
    expect(formatUsd(12.3456)).toBe("$12.35");
  });

  it("formats a sub-cent amount below the 4dp floor as '<$0.0001'", () => {
    expect(formatUsd(0.00001)).toBe("<$0.0001");
  });

  it("formats a mid-range amount at 4 decimals", () => {
    expect(formatUsd(0.0056)).toBe("$0.0056");
  });

  it("collapses to 2dp when 4dp rounding pushes it to >= $1", () => {
    expect(formatUsd(0.99996)).toBe("$1.00");
  });
});
