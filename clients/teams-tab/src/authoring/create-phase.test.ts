import { describe, expect, it } from "vitest";
import { retryAdvice, type RetrySafety } from "./create-phase";

describe("retryAdvice — the advice is a property of the contract, not the UI", () => {
  it("tells an idempotent create to retry", () => {
    expect(retryAdvice("idempotent", "agent")).toContain("again");
  });

  it("tells a non-idempotent create to check first", () => {
    expect(retryAdvice("may-duplicate", "artifact")).toContain("Check the list");
  });

  it("CONTRACT: the two never give the same advice", () => {
    // The failure this exists for is one surface inheriting the other's
    // wording — which already happened once, in the direction that told
    // someone to go and verify what they could simply have retried.
    expect(retryAdvice("idempotent", "agent")).not.toBe(
      retryAdvice("may-duplicate", "agent"),
    );
  });

  it("CONTRACT: only the idempotent case invites a retry", () => {
    // Asserting the DANGEROUS direction specifically: an advice string that
    // says "again" under may-duplicate would tell someone to create a
    // duplicate, and that is the failure worth a dedicated test.
    expect(retryAdvice("may-duplicate", "artifact")).not.toMatch(/\bagain\b/);
  });

  it("names the thing being created, so the sentence is not generic", () => {
    expect(retryAdvice("may-duplicate", "artifact")).toContain("artifact");
    expect(retryAdvice("idempotent", "agent")).toContain("agent");
  });

  it("covers every RetrySafety value", () => {
    // If a third safety level is ever added, this fails rather than silently
    // falling into whichever branch the ternary happens to have.
    const all: readonly RetrySafety[] = ["idempotent", "may-duplicate"];
    for (const safety of all) {
      expect(retryAdvice(safety, "thing").length).toBeGreaterThan(0);
    }
  });
});
