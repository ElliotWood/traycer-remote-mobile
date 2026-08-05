/**
 * @vitest-environment jsdom
 *
 * The comment-thread hook, asserted on **what goes onto the wire** and on
 * **which response is allowed to land** — the two properties that are
 * invisible on screen.
 *
 * `epic.replyToCommentThread` takes rich `JsonContent`, not a string. A reply
 * built as `{ content: text }` would be a type error, but one built as a
 * hand-rolled `{type:"doc"}` literal with an empty text node is *accepted by
 * TypeScript and rejected by the schema* — and the panel looks identical
 * either way, because the failure is on the host. Only the request can tell
 * them apart.
 *
 * The second property is ORDERING. Opening artifact A then B before A's
 * response lands is a defect that renders perfectly: B's title, B's reply
 * box, A's threads. Nothing on screen is wrong-looking, so a render assertion
 * cannot catch it — the test has to hold the two responses and choose the
 * order they resolve in.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { CommentThreadWire } from "@traycer/protocol/host/epic/unary-schemas";
import {
  useCommentThreads,
  type CommentThreadsClient,
  type CommentThreadsScope,
} from "../use-comment-threads";

afterEach(() => {
  cleanup();
});

interface RecordedCall {
  readonly method: string;
  readonly params: unknown;
}

/**
 * A fake `CommentThreadsClient`.
 *
 * Asserted onto `CommentThreadsClient["request"]` once rather than erasing the
 * whole object with `as unknown as` — this package's lint config bans the
 * chained form, and the narrow `Pick<HostRequester, "request">` seam is what
 * makes the single assertion honest: there is exactly one member to satisfy.
 */
function fakeClient(
  respond: (method: string, params: unknown) => Promise<unknown>,
): { readonly client: CommentThreadsClient; readonly calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const request = ((method: string, params: unknown) => {
    calls.push({ method, params });
    return respond(method, params);
  }) as CommentThreadsClient["request"];
  return { client: { request }, calls };
}

const SCOPE: CommentThreadsScope = {
  epicId: "epic-1",
  artifactType: "spec",
  artifactId: "artifact-1",
};

/**
 * `resolved` is explicit at every call site rather than defaulted — this
 * package's `no-restricted-syntax` bans default parameter values, and the
 * stated reason applies here exactly: the resolve toggle is what two of these
 * tests are about, so a caller that did not say which state it wanted would
 * be the least readable place in the file to hide it.
 */
function thread(
  threadId: string,
  createdAt: number,
  resolved: boolean,
): CommentThreadWire {
  return {
    threadId,
    resolved,
    createdAt,
    comments: [
      {
        commentId: `${threadId}-c1`,
        content: { type: "doc", content: [] },
        createdAt,
        updatedAt: null,
        author: { userId: "u-1", fallbackHandle: "Ada" },
      },
    ],
    data: { createdByUserId: "u-1", createdByHandle: "Ada" },
  };
}

describe("useCommentThreads — the read", () => {
  it("requests the artifact's threads and sorts them oldest-first", async () => {
    const { client, calls } = fakeClient(() =>
      Promise.resolve({ threads: [thread("t-late", 200, false), thread("t-early", 100, false)] }),
    );

    const { result } = renderHook(() => useCommentThreads(client, SCOPE));

    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });

    // The whole request object, not field-by-field: a dropped or extra field
    // is exactly what a partial assertion cannot see.
    expect(calls).toEqual([
      { method: "epic.listCommentThreads", params: SCOPE },
    ]);
    const state = result.current.state;
    if (state.kind !== "ready") throw new Error(`expected ready, got ${state.kind}`);
    expect(state.threads.map((t) => t.threadId)).toEqual(["t-early", "t-late"]);
  });

  it("distinguishes an artifact with no comments from a failed read", async () => {
    const empty = fakeClient(() => Promise.resolve({ threads: [] }));
    const { result: emptyResult } = renderHook(() =>
      useCommentThreads(empty.client, SCOPE),
    );
    await waitFor(() => {
      expect(emptyResult.current.state.kind).toBe("ready");
    });

    const broken = fakeClient(() => Promise.reject(new Error("host said no")));
    const { result: brokenResult } = renderHook(() =>
      useCommentThreads(broken.client, SCOPE),
    );
    await waitFor(() => {
      expect(brokenResult.current.state.kind).toBe("error");
    });

    // The positive half: "ready with zero threads" must not be reachable by a
    // hook that simply never resolved. Both states are asserted, because
    // `kind !== "error"` alone would pass for a permanent spinner.
    const state = emptyResult.current.state;
    if (state.kind !== "ready") throw new Error("expected ready");
    expect(state.threads).toEqual([]);
    const failed = brokenResult.current.state;
    if (failed.kind !== "error") throw new Error("expected error");
    expect(failed.detail).toBe("host said no");
  });

  it("reports no configured host rather than spinning forever", async () => {
    const { result } = renderHook(() => useCommentThreads(null, SCOPE));
    await waitFor(() => {
      expect(result.current.state.kind).toBe("error");
    });
  });
});

describe("useCommentThreads — the artifact changes", () => {
  it("re-reads when a different artifact is opened", async () => {
    const { client, calls } = fakeClient(() => Promise.resolve({ threads: [] }));

    const { result, rerender } = renderHook(
      ({ scope }: { scope: CommentThreadsScope }) => useCommentThreads(client, scope),
      { initialProps: { scope: SCOPE } },
    );
    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });

    const second: CommentThreadsScope = { ...SCOPE, artifactId: "artifact-2" };
    rerender({ scope: second });
    await waitFor(() => {
      expect(calls.length).toBe(2);
    });

    expect(calls[1]).toEqual({ method: "epic.listCommentThreads", params: second });
  });

  it("does not re-read when the same artifact re-renders", async () => {
    const { client, calls } = fakeClient(() => Promise.resolve({ threads: [] }));

    const { result, rerender } = renderHook(
      ({ scope }: { scope: CommentThreadsScope }) => useCommentThreads(client, scope),
      { initialProps: { scope: SCOPE } },
    );
    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });

    // A NEW object with the same values — the case a reference-equality guard
    // would get wrong, and the one React actually produces every render.
    rerender({ scope: { ...SCOPE } });
    rerender({ scope: { ...SCOPE } });

    expect(calls.length).toBe(1);
  });

  it("drops a stale response that lands after a newer one", async () => {
    const resolvers: ((value: { threads: CommentThreadWire[] }) => void)[] = [];
    const { client } = fakeClient(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const { result, rerender } = renderHook(
      ({ scope }: { scope: CommentThreadsScope }) => useCommentThreads(client, scope),
      { initialProps: { scope: SCOPE } },
    );

    // Open a second artifact while the first read is still outstanding.
    const second: CommentThreadsScope = { ...SCOPE, artifactId: "artifact-2" };
    rerender({ scope: second });
    await waitFor(() => {
      expect(resolvers.length).toBe(2);
    });

    // Resolve the SECOND read first, then let the first one land late.
    await act(async () => {
      resolvers[1]?.({ threads: [thread("belongs-to-2", 10, false)] });
      await Promise.resolve();
    });
    await act(async () => {
      resolvers[0]?.({ threads: [thread("belongs-to-1", 20, false)] });
      await Promise.resolve();
    });

    const state = result.current.state;
    if (state.kind !== "ready") throw new Error(`expected ready, got ${state.kind}`);
    expect(state.threads.map((t) => t.threadId)).toEqual(["belongs-to-2"]);
  });
});

describe("useCommentThreads — the writes", () => {
  it("sends a reply as JsonContent and re-reads the host's list", async () => {
    let listed = 0;
    const { client, calls } = fakeClient((method) => {
      if (method === "epic.listCommentThreads") {
        listed += 1;
        return Promise.resolve({
          threads: listed === 1 ? [thread("t-1", 100, false)] : [thread("t-1", 100, false), thread("t-2", 150, false)],
        });
      }
      return Promise.resolve({ ok: true });
    });

    const { result } = renderHook(() => useCommentThreads(client, SCOPE));
    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });

    act(() => {
      result.current.reply("t-1", "  looks right to me  ");
    });

    await waitFor(() => {
      expect(listed).toBe(2);
    });

    // The WHOLE request. `content` is the field a hand-rolled literal gets
    // subtly wrong, and the trim is applied before it is built — a reply of
    // trailing whitespace must not reach the host as one.
    expect(calls[1]).toEqual({
      method: "epic.replyToCommentThread",
      params: {
        ...SCOPE,
        threadId: "t-1",
        content: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "looks right to me" }] },
          ],
        },
      },
    });

    // The refetch is what makes the new thread appear — nothing was appended
    // locally.
    const state = result.current.state;
    if (state.kind !== "ready") throw new Error("expected ready");
    expect(state.threads.map((t) => t.threadId)).toEqual(["t-1", "t-2"]);
  });

  it("sends nothing for a whitespace-only reply", async () => {
    const { client, calls } = fakeClient(() => Promise.resolve({ threads: [thread("t-1", 1, false)] }));
    const { result } = renderHook(() => useCommentThreads(client, SCOPE));
    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });

    act(() => {
      result.current.reply("t-1", "   ");
    });

    expect(calls.map((c) => c.method)).toEqual(["epic.listCommentThreads"]);
  });

  it("moves the resolved flag only after the host's own list says so", async () => {
    let listed = 0;
    let resolveWrite: (() => void) | null = null;
    const { client, calls } = fakeClient((method) => {
      if (method === "epic.listCommentThreads") {
        listed += 1;
        return Promise.resolve({ threads: [thread("t-1", 100, listed > 1)] });
      }
      return new Promise((resolve) => {
        resolveWrite = () => {
          resolve({ ok: true });
        };
      });
    });

    const { result } = renderHook(() => useCommentThreads(client, SCOPE));
    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });

    act(() => {
      result.current.setResolved("t-1", true);
    });

    // WHILE THE WRITE IS IN FLIGHT: busy, and the flag has NOT moved. This is
    // the assertion an optimistic implementation fails.
    const mid = result.current.state;
    if (mid.kind !== "ready") throw new Error("expected ready");
    expect(mid.busyThreadId).toBe("t-1");
    expect(mid.threads[0]?.resolved).toBe(false);

    expect(calls[1]).toEqual({
      method: "epic.setCommentThreadResolved",
      params: { ...SCOPE, threadId: "t-1", resolved: true },
    });

    await act(async () => {
      resolveWrite?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      const after = result.current.state;
      if (after.kind !== "ready") throw new Error("expected ready");
      expect(after.threads[0]?.resolved).toBe(true);
      expect(after.busyThreadId).toBe(null);
    });
  });

  it("keeps the threads on screen when a write fails, and says why", async () => {
    const { client } = fakeClient((method) => {
      if (method === "epic.listCommentThreads") {
        return Promise.resolve({ threads: [thread("t-1", 100, false)] });
      }
      return Promise.reject(new Error("write refused"));
    });

    const { result } = renderHook(() => useCommentThreads(client, SCOPE));
    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });

    act(() => {
      result.current.reply("t-1", "hello");
    });

    await waitFor(() => {
      const state = result.current.state;
      if (state.kind !== "ready") throw new Error(`expected ready, got ${state.kind}`);
      expect(state.actionError).toBe("write refused");
    });

    // Still `ready`, still showing the host's last good answer — a failed
    // write must not blank the list the user is mid-reply on.
    const state = result.current.state;
    if (state.kind !== "ready") throw new Error("expected ready");
    expect(state.threads.map((t) => t.threadId)).toEqual(["t-1"]);
    expect(state.busyThreadId).toBe(null);
  });

  it("refuses a write issued before the read has landed", async () => {
    const { client, calls } = fakeClient(
      () => new Promise(() => {
        /* never resolves — the read is still outstanding */
      }),
    );

    const { result } = renderHook(() => useCommentThreads(client, SCOPE));
    expect(result.current.state.kind).toBe("loading");

    act(() => {
      result.current.reply("t-1", "too early");
      result.current.setResolved("t-1", true);
    });

    // Only the read. A write sent now has no list to refetch into and no row
    // to disable, so it is refused rather than sent blind.
    expect(calls.map((c) => c.method)).toEqual(["epic.listCommentThreads"]);
  });
});
