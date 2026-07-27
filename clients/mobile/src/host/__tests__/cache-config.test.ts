import { describe, expect, it } from "vitest";
import { CACHE_MAX_AGE_MS, CACHE_SCHEMA_VERSION } from "@/host/cache-config";

// Check 14 (gcTime >= maxAge): app-root.tsx's QueryClient `gcTime` and the
// persister's `maxAge` both read `CACHE_MAX_AGE_MS` directly — the same
// identifier — so the inequality holds by construction, not by two
// independently-maintained numbers that could drift apart. Nothing further
// to assert at runtime beyond the constant itself being sane (below).
describe("cache-config", () => {
  it("CACHE_SCHEMA_VERSION is a non-empty string used as the cache buster everywhere", () => {
    expect(typeof CACHE_SCHEMA_VERSION).toBe("string");
    expect(CACHE_SCHEMA_VERSION.length).toBeGreaterThan(0);
  });

  it("CACHE_MAX_AGE_MS is a sane positive duration (guards a 0/negative typo silently disabling caching)", () => {
    expect(CACHE_MAX_AGE_MS).toBeGreaterThanOrEqual(60 * 60 * 1000); // >= 1 hour
  });
});
