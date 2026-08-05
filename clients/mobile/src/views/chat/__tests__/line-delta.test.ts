import { describe, expect, it } from "vitest";
import { computeLineDelta } from "../line-delta";

describe("computeLineDelta", () => {
  it("counts added and deleted lines for a snapshot-sourced change", () => {
    const before = "line1\nline2\nline3\n";
    const after = "line1\nline2 changed\nline3\nline4\n";
    const delta = computeLineDelta(before, after, "snapshot");
    expect(delta.added).toBeGreaterThan(0);
    expect(delta.deleted).toBeGreaterThan(0);
  });

  it("is {0,0} for a pure addition", () => {
    const delta = computeLineDelta("", "new file\ncontent\n", "snapshot");
    expect(delta.deleted).toBe(0);
    expect(delta.added).toBe(2);
  });

  it("is {0,0} for a non-snapshot reason (binary/too_large/etc — nothing to diff)", () => {
    expect(computeLineDelta("a", "b", "binary")).toEqual({ added: 0, deleted: 0 });
    expect(computeLineDelta(null, null, "denied")).toEqual({ added: 0, deleted: 0 });
  });
});
