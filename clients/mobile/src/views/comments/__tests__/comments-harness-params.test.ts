/**
 * `parseCommentsHarnessParams` (S4): pure query-string parsing for the
 * `?comments=1&epicId=&artifactType=&artifactId=` harness route.
 */
import { describe, expect, it } from "vitest";
import { parseCommentsHarnessParams } from "../comments-harness-params";

describe("parseCommentsHarnessParams", () => {
  it("parses a complete, valid query string", () => {
    expect(
      parseCommentsHarnessParams(
        "?comments=1&epicId=e1&artifactType=ticket&artifactId=a1",
      ),
    ).toEqual({ epicId: "e1", artifactType: "ticket", artifactId: "a1" });
  });

  it("returns null when comments!=1", () => {
    expect(
      parseCommentsHarnessParams(
        "?epicId=e1&artifactType=ticket&artifactId=a1",
      ),
    ).toBeNull();
  });

  it("returns null on a missing epicId or artifactId", () => {
    expect(
      parseCommentsHarnessParams("?comments=1&artifactType=ticket&artifactId=a1"),
    ).toBeNull();
    expect(
      parseCommentsHarnessParams("?comments=1&epicId=e1&artifactType=ticket"),
    ).toBeNull();
  });

  it("returns null on an invalid artifactType", () => {
    expect(
      parseCommentsHarnessParams(
        "?comments=1&epicId=e1&artifactType=chat&artifactId=a1",
      ),
    ).toBeNull();
  });

  it.each(["spec", "ticket", "story", "review"])(
    "accepts artifactType=%s",
    (artifactType) => {
      expect(
        parseCommentsHarnessParams(
          `?comments=1&epicId=e1&artifactType=${artifactType}&artifactId=a1`,
        ),
      ).toEqual({ epicId: "e1", artifactType, artifactId: "a1" });
    },
  );
});
