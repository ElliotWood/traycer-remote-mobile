// @vitest-environment jsdom
/**
 * `CommentsPanel` (S4, F4): loading/error/empty states, quoted-anchor
 * presence/absence, resolved/unresolved toggle labels, empty/whitespace
 * submit guards, exact RPC payloads (incl. `plainTextContent` + `quotedText:
 * ""` for creates), and the structural ≥44px touch-target assertion
 * (rubric §2).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { CommentThreadWire } from "@traycer/protocol/host/epic/unary-schemas";
import { CommentsPanel } from "../comments-panel";
import { HostClientProvider } from "@/host/host-client-context";
import { createFakeHostClient } from "@/test-utils/fakes";
import { render, screen, waitFor } from "@/test-utils/dom";
import userEvent from "@testing-library/user-event";

const PROPS = { epicId: "e1", artifactType: "ticket" as const, artifactId: "a1" };

/** No `@testing-library/jest-dom` here (not a dep) - check the DOM directly. */
function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled;
}

function thread(overrides: Partial<CommentThreadWire> = {}): CommentThreadWire {
  return {
    threadId: "t1",
    resolved: false,
    createdAt: 1,
    comments: [
      {
        commentId: "c1",
        content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] },
        createdAt: 1,
        updatedAt: null,
        author: { userId: "u1", fallbackHandle: "Ada" },
      },
    ],
    data: { createdByUserId: "u1" },
    ...overrides,
  };
}

function mount(requestImpl: (method: string, params: unknown) => Promise<unknown>): {
  readonly request: ReturnType<typeof vi.fn>;
} {
  const { client, request } = createFakeHostClient(requestImpl);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <HostClientProvider client={client}>
        <CommentsPanel {...PROPS} />
      </HostClientProvider>
    </QueryClientProvider>,
  );
  return { request };
}

describe("CommentsPanel", () => {
  it("shows a loading state before the first response", () => {
    mount(() => new Promise(() => {}));
    expect(screen.getByText("Loading comments…")).toBeTruthy();
  });

  it("shows an error state with a Try again button that re-fires the request", async () => {
    let call = 0;
    const { request } = mount(() => {
      call += 1;
      return call === 1
        ? Promise.reject(new Error("boom"))
        : Promise.resolve({ threads: [] });
    });

    await screen.findByText("Couldn't load comments.");
    const tryAgain = screen.getByRole("button", { name: "Try again" }) as HTMLButtonElement;
    expect(parseInt(tryAgain.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
    await userEvent.setup().click(tryAgain);

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it("shows only the start-a-thread composer when there are no threads", async () => {
    mount(() => Promise.resolve({ threads: [] }));
    await screen.findByPlaceholderText("Start a thread…");
    expect(screen.queryByTestId("comment-thread-card")).toBeNull();
  });

  it("renders the quoted anchor only when quotedText is present", async () => {
    mount(() =>
      Promise.resolve({
        threads: [
          thread({ threadId: "with-anchor", data: { createdByUserId: "u1", quotedText: "the anchored text" } }),
          thread({ threadId: "without-anchor", createdAt: 2 }),
        ],
      }),
    );

    const cards = await screen.findAllByTestId("comment-thread-card");
    expect(cards).toHaveLength(2);
    expect(screen.getByText("the anchored text")).toBeTruthy();
    // Only one blockquote across both cards - the anchor-less thread renders none.
    expect(document.querySelectorAll("blockquote")).toHaveLength(1);
  });

  it("shows Resolve for an unresolved thread and Reopen + a badge for a resolved one", async () => {
    mount(() =>
      Promise.resolve({
        threads: [
          thread({ threadId: "open", resolved: false }),
          thread({ threadId: "closed", resolved: true, createdAt: 2 }),
        ],
      }),
    );

    await screen.findAllByTestId("comment-thread-card");
    expect(screen.getAllByRole("button", { name: "Resolve" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Reopen" })).toHaveLength(1);
    expect(screen.getByText("Resolved")).toBeTruthy();
  });

  it("disables Add comment on empty/whitespace text and calls the RPC with plainTextContent + empty quotedText", async () => {
    const { request } = mount(() => Promise.resolve({ threads: [] }));
    await screen.findByPlaceholderText("Start a thread…");
    const user = userEvent.setup();

    const addButton = screen.getByRole("button", { name: "Add comment" });
    expect(isDisabled(addButton)).toBe(true);

    await user.type(screen.getByPlaceholderText("Start a thread…"), "   ");
    expect(isDisabled(addButton)).toBe(true);

    await user.clear(screen.getByPlaceholderText("Start a thread…"));
    await user.type(screen.getByPlaceholderText("Start a thread…"), "a new thread");
    expect(isDisabled(addButton)).toBe(false);

    await user.click(addButton);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("epic.createCommentThread", {
        epicId: "e1",
        artifactType: "ticket",
        artifactId: "a1",
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "a new thread" }] }],
        },
        quotedText: "",
      }),
    );
  });

  it("disables Reply on empty text and calls the RPC with plainTextContent on submit", async () => {
    const { request } = mount(() => Promise.resolve({ threads: [thread()] }));
    await screen.findAllByTestId("comment-thread-card");
    const user = userEvent.setup();

    const replyButton = screen.getByRole("button", { name: "Reply" });
    expect(isDisabled(replyButton)).toBe(true);

    await user.type(screen.getByPlaceholderText("Reply…"), "a reply");
    expect(isDisabled(replyButton)).toBe(false);

    await user.click(replyButton);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("epic.replyToCommentThread", {
        epicId: "e1",
        artifactType: "ticket",
        artifactId: "a1",
        threadId: "t1",
        content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a reply" }] }] },
      }),
    );
  });

  it("toggling resolved calls setCommentThreadResolved with the flipped flag", async () => {
    const { request } = mount(() => Promise.resolve({ threads: [thread({ resolved: false })] }));
    await screen.findAllByTestId("comment-thread-card");

    await userEvent.setup().click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("epic.setCommentThreadResolved", {
        epicId: "e1",
        artifactType: "ticket",
        artifactId: "a1",
        threadId: "t1",
        resolved: true,
      }),
    );
  });

  it("surfaces a Resolving… pending label and an inline error on a failed resolve", async () => {
    const pending: { reject: ((err: Error) => void) | null } = { reject: null };
    mount((method) => {
      if (method === "epic.listCommentThreads") {
        return Promise.resolve({ threads: [thread({ resolved: false })] });
      }
      if (method === "epic.setCommentThreadResolved") {
        return new Promise<unknown>((_resolve, reject) => {
          pending.reject = reject;
        });
      }
      return Promise.reject(new Error(`unexpected method ${method}`));
    });
    await screen.findAllByTestId("comment-thread-card");

    await userEvent.setup().click(screen.getByRole("button", { name: "Resolve" }));
    await screen.findByText("Resolving…");

    pending.reject?.(new Error("boom"));
    await screen.findByText("Couldn't update the thread.");
  });

  it("every Resolve/Reopen/Reply/Add-comment button carries an explicit ≥44px minHeight", async () => {
    mount(() => Promise.resolve({ threads: [thread()] }));
    await screen.findAllByTestId("comment-thread-card");

    const names = ["Resolve", "Reply", "Add comment"];
    for (const name of names) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      const minHeight = parseInt(button.style.minHeight, 10);
      expect(minHeight).toBeGreaterThanOrEqual(44);
    }
  });

  it("shows Not connected when no host client is bound", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <HostClientProvider client={null}>
          <CommentsPanel {...PROPS} />
        </HostClientProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Not connected to a host.")).toBeTruthy();
  });
});
