// @vitest-environment jsdom
/**
 * Sprint 5 (A2/A3): the Fleet must self-refresh, not stay fetch-only-manual.
 *
 * Asserts the ACTUAL options TanStack registers for the query — not just that
 * `useEpicList` "compiles" — by reading them back off the live `QueryClient`
 * after the hook mounts. `refetchOnWindowFocus`/`refetchOnReconnect` are
 * already TanStack v5 defaults; this locks them in explicitly so a future
 * global `QueryClient` default change can't silently regress the S5 behavior.
 */
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderHook } from "@/test-utils/dom";
import { useEpicList } from "../use-epic-list";

/**
 * The core `Query.options` type (from `getQueryCache().findAll()`) is narrower
 * than what TanStack actually stores at runtime — `refetchInterval` and friends
 * are `QueryObserver`-level options that `defaultQueryOptions` merges into the
 * same object. This slice names only the fields this test reads.
 */
interface ObserverOptionsSlice {
  readonly refetchInterval?: unknown;
  readonly refetchIntervalInBackground?: unknown;
  readonly refetchOnWindowFocus?: unknown;
  readonly refetchOnReconnect?: unknown;
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useEpicList — self-refresh options (S5)", () => {
  it("registers a gentle 20s poll paused in the background, plus focus/reconnect refetch", async () => {
    const client = new QueryClient();
    const request = vi.fn().mockResolvedValue({ tasks: [], hasMore: false });

    renderHook(() => useEpicList({ request }, {}), { wrapper: wrapper(client) });

    // Wait for the query to register itself on the cache.
    await vi.waitFor(() => {
      expect(client.getQueryCache().findAll().length).toBeGreaterThan(0);
    });

    const query = client.getQueryCache().findAll()[0];
    const opts = query?.options as ObserverOptionsSlice | undefined;
    expect(opts?.refetchInterval).toBe(20_000);
    expect(opts?.refetchIntervalInBackground).toBe(false);
    expect(opts?.refetchOnWindowFocus).toBe(true);
    expect(opts?.refetchOnReconnect).toBe(true);
  });
});
