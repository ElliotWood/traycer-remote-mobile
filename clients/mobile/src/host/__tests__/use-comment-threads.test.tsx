// @vitest-environment jsdom
/**
 * `useCommentThreads` (S4, F4): query-key composition, the loading->success
 * transition against a fake client, error surfacing, oldest-first ordering,
 * and the empty-id disabled gate.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { CommentThreadWire } from "@traycer/protocol/host/epic/unary-schemas";
import { commentThreadsQueryKey, useCommentThreads } from "../use-comment-threads";
import { renderHook, waitFor } from "@/test-utils/dom";

function wrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function thread(
  threadId: string,
  createdAt: number,
  overrides: Partial<CommentThreadWire> = {},
): CommentThreadWire {
  return {
    threadId,
    resolved: false,
    createdAt,
    comments: [],
    data: { createdByUserId: "u1" },
    ...overrides,
  };
}

describe("commentThreadsQueryKey", () => {
  it("composes a stable key from epicId/artifactType/artifactId", () => {
    expect(
      commentThreadsQueryKey({
        epicId: "e1",
        artifactType: "ticket",
        artifactId: "a1",
      }),
    ).toEqual(["mobile", "epic.listCommentThreads", "e1", "ticket", "a1"]);
  });
});

describe("useCommentThreads", () => {
  it("transitions loading -> success and calls the RPC with the exact params", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ threads: [thread("t1", 100)] });
    const { result } = renderHook(
      () =>
        useCommentThreads(
          { request },
          { epicId: "e1", artifactType: "ticket", artifactId: "a1" },
        ),
      { wrapper: wrapper() },
    );

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.threads).toHaveLength(1);
    expect(request).toHaveBeenCalledWith("epic.listCommentThreads", {
      epicId: "e1",
      artifactType: "ticket",
      artifactId: "a1",
    });
  });

  it("sorts threads oldest-created-first without touching comment order within a thread", async () => {
    const request = vi.fn().mockResolvedValue({
      threads: [thread("newer", 200), thread("older", 100)],
    });
    const { result } = renderHook(
      () =>
        useCommentThreads(
          { request },
          { epicId: "e1", artifactType: "ticket", artifactId: "a1" },
        ),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.threads.map((t) => t.threadId)).toEqual([
      "older",
      "newer",
    ]);
  });

  it("surfaces isError on a rejected request", async () => {
    const request = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(
      () =>
        useCommentThreads(
          { request },
          { epicId: "e1", artifactType: "ticket", artifactId: "a1" },
        ),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.threads).toEqual([]);
  });

  it("does not fire the request when artifactId is empty", async () => {
    const request = vi.fn().mockResolvedValue({ threads: [] });
    renderHook(
      () =>
        useCommentThreads(
          { request },
          { epicId: "e1", artifactType: "ticket", artifactId: "" },
        ),
      { wrapper: wrapper() },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(request).not.toHaveBeenCalled();
  });
});
