// @vitest-environment jsdom
/**
 * `use-comment-thread-mutations` (S4, F4): each hook calls `client.request`
 * with the exact RPC name + params, and invalidates the matching
 * `use-comment-threads` query key on success (mirrors gui-app's
 * onSuccess-invalidate pattern, no optimistic updates).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { commentThreadsQueryKey } from "../use-comment-threads";
import {
  useCreateCommentThread,
  useReplyToCommentThread,
  useSetCommentThreadResolved,
} from "../use-comment-thread-mutations";
import { act, renderHook, waitFor } from "@/test-utils/dom";

const SCOPE = { epicId: "e1", artifactType: "ticket" as const, artifactId: "a1" };

function makeWrapper(): {
  readonly wrapper: ({ children }: { children: ReactNode }) => ReactNode;
  readonly invalidateSpy: ReturnType<typeof vi.spyOn>;
} {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  return {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
    invalidateSpy,
  };
}

describe("useCreateCommentThread", () => {
  it("calls epic.createCommentThread and invalidates the thread list on success", async () => {
    const request = vi.fn().mockResolvedValue({ threadId: "t1" });
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useCreateCommentThread({ request }), {
      wrapper,
    });

    const variables = { ...SCOPE, content: { type: "doc" }, quotedText: "" };
    act(() => result.current.mutate(variables));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request).toHaveBeenCalledWith("epic.createCommentThread", variables);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: commentThreadsQueryKey(SCOPE),
    });
  });
});

describe("useReplyToCommentThread", () => {
  it("calls epic.replyToCommentThread and invalidates the thread list on success", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useReplyToCommentThread({ request }), {
      wrapper,
    });

    const variables = { ...SCOPE, threadId: "t1", content: { type: "doc" } };
    act(() => result.current.mutate(variables));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request).toHaveBeenCalledWith("epic.replyToCommentThread", variables);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: commentThreadsQueryKey(SCOPE),
    });
  });
});

describe("useSetCommentThreadResolved", () => {
  it("calls epic.setCommentThreadResolved and invalidates the thread list on success", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(
      () => useSetCommentThreadResolved({ request }),
      { wrapper },
    );

    const variables = { ...SCOPE, threadId: "t1", resolved: true };
    act(() => result.current.mutate(variables));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request).toHaveBeenCalledWith(
      "epic.setCommentThreadResolved",
      variables,
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: commentThreadsQueryKey(SCOPE),
    });
  });

  it("surfaces isError on a rejected request without invalidating", async () => {
    const request = vi.fn().mockRejectedValue(new Error("boom"));
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(
      () => useSetCommentThreadResolved({ request }),
      { wrapper },
    );

    act(() =>
      result.current.mutate({ ...SCOPE, threadId: "t1", resolved: true }),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
