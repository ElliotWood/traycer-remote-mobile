/**
 * Pure-logic tests for the fail-loud startup config gate (`app-root.tsx`).
 * No DOM/env needed — `computeConfigProblems` takes its inputs as plain
 * values, mirroring `app-screen.ts`'s existing pure-projection test style.
 */
import { describe, expect, it } from "vitest";
import { computeConfigProblems } from "../config-diagnostics";

const PRODUCTION_ORIGIN = "https://platform.traycer.ai";
const TAILNET_ORIGIN = "https://tonberry.tail267a92.ts.net";

describe("computeConfigProblems", () => {
  it("reports nothing when authn is configured and a host URL is set", () => {
    expect(
      computeConfigProblems({
        authnConfigured: true,
        hostWsUrl: "wss://example/rpc",
        origin: TAILNET_ORIGIN,
      }),
    ).toEqual([]);
  });

  it("reports nothing when authn is unconfigured but served from the canonical production origin", () => {
    expect(
      computeConfigProblems({
        authnConfigured: false,
        hostWsUrl: "wss://example/rpc",
        origin: PRODUCTION_ORIGIN,
      }),
    ).toEqual([]);
  });

  it("flags an unconfigured authn base on any non-production origin — the CORS trap", () => {
    const problems = computeConfigProblems({
      authnConfigured: false,
      hostWsUrl: "wss://example/rpc",
      origin: TAILNET_ORIGIN,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].id).toBe("authn-cross-origin-default");
  });

  it("flags a missing host WS URL", () => {
    const problems = computeConfigProblems({
      authnConfigured: true,
      hostWsUrl: null,
      origin: TAILNET_ORIGIN,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].id).toBe("host-ws-url-missing");
  });

  it("reports both problems at once when both are wrong", () => {
    const problems = computeConfigProblems({
      authnConfigured: false,
      hostWsUrl: null,
      origin: TAILNET_ORIGIN,
    });
    expect(problems.map((p) => p.id).sort()).toEqual(
      ["authn-cross-origin-default", "host-ws-url-missing"].sort(),
    );
  });
});
