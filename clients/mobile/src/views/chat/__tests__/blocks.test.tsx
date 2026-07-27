// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { ContentBlock } from "@traycer/protocol/persistence/epic/content-blocks";
import { HostClientProvider } from "@/host/host-client-context";
import { createFakeHostClient } from "@/test-utils/fakes";
import { fireEvent, render, screen, waitFor } from "@/test-utils/dom";
import { BlockList } from "@/views/chat/block-list";
import type { RenderableBlock } from "@/views/chat/transcript-model";
import { buildBlockTree } from "@/views/chat/transcript-model";

function Providers({
  children,
  request,
}: {
  readonly children: ReactNode;
  readonly request: (method: string, params: unknown) => Promise<unknown>;
}): ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { client } = createFakeHostClient(request);
  return (
    <QueryClientProvider client={queryClient}>
      <HostClientProvider client={client}>{children}</HostClientProvider>
    </QueryClientProvider>
  );
}

function renderBlocks(blocks: ContentBlock[], request?: (method: string, params: unknown) => Promise<unknown>) {
  const nodes: readonly RenderableBlock[] = buildBlockTree(blocks);
  const req = request ?? (() => Promise.reject(new Error("unexpected request")));
  return render(
    <Providers request={req}>
      <BlockList nodes={nodes} epicId="e1" chatId="c1" />
    </Providers>,
  );
}

describe("mandatory collapsed-by-default (reasoning/tool_call/file_change/subagent)", () => {
  it("reasoning starts collapsed and expands on tap", () => {
    const block: ContentBlock = {
      type: "reasoning",
      blockId: "r1",
      status: "completed",
      timestamp: 5000,
      parentBlockId: null,
      content: "because the tests failed",
      startedAt: 0,
    };
    renderBlocks([block]);
    expect(screen.queryByText("because the tests failed")).toBeNull();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("because the tests failed")).toBeTruthy();
  });

  it("tool_call starts collapsed, shows real inputSummary in the header", () => {
    const block: ContentBlock = {
      type: "tool_call",
      blockId: "t1",
      status: "completed",
      timestamp: 0,
      parentBlockId: null,
      toolName: "Bash",
      inputSummary: "ls -la /tmp",
      inputDetail: { kind: "command", command: "ls -la /tmp" },
      taskTodoItems: null,
      error: null,
      agentMessageSend: null,
      progress: null,
      backgroundOutput: null,
      startedAt: null,
      endedAt: null,
      backgroundTask: false,
      stopped: false,
    };
    renderBlocks([block]);
    expect(screen.getByText("ls -la /tmp")).toBeTruthy();
    expect(screen.queryByText("$ ls -la /tmp")).toBeNull();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("$ ls -la /tmp")).toBeTruthy();
  });

  it("subagent starts collapsed, its nested child does not render until expanded", () => {
    const blocks: ContentBlock[] = [
      {
        type: "subagent",
        blockId: "sa1",
        status: "completed",
        timestamp: 0,
        parentBlockId: null,
        name: "Explorer",
        agentType: null,
        task: null,
        progressUpdates: [],
        result: "found it",
        startedAt: 0,
        spawnToolCallId: null,
        stopped: false,
        workflowMeta: null,
      },
      {
        type: "command",
        blockId: "c1",
        status: "completed",
        timestamp: 0,
        parentBlockId: "sa1",
        command: "grep -r foo",
        cwd: null,
        exitCode: 0,
      },
    ];
    renderBlocks(blocks);
    expect(screen.queryByText(/grep -r foo/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText(/grep -r foo/)).toBeTruthy();
  });
});

describe("lazy fetch — only fires on expand, never on mount", () => {
  it("file_change diff fetch fires only after the card is expanded", async () => {
    let calls = 0;
    const request = () => {
      calls += 1;
      return Promise.resolve({ beforeContent: "old", afterContent: "new", reason: "snapshot" });
    };
    const block: ContentBlock = {
      type: "file_change",
      blockId: "f1",
      status: "completed",
      timestamp: 0,
      parentBlockId: null,
      filePath: "a.ts",
      operation: "edit",
      diffSource: "snapshot",
      beforeHash: "b",
      afterHash: "a",
      additions: 3,
      deletions: 1,
      reason: "snapshot",
    };
    renderBlocks([block], request);
    expect(calls).toBe(0);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(calls).toBe(1);
    await waitFor(() => expect(screen.getByTestId("diff-view")).toBeTruthy());
  });

  it("artifact_operation diff fetch fires only after 'View diff' is tapped", async () => {
    let calls = 0;
    const request = () => {
      calls += 1;
      return Promise.resolve({ beforeContent: "old", afterContent: "new", reason: "snapshot" });
    };
    const block: ContentBlock = {
      type: "artifact_operation",
      blockId: "ao1",
      status: "completed",
      timestamp: 0,
      parentBlockId: null,
      operation: "update",
      kind: "spec",
      artifactId: "art1",
      title: "My spec",
      beforeHash: "b",
      afterHash: "a",
    };
    renderBlocks([block], request);
    expect(calls).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "View diff" }));
    await waitFor(() => expect(calls).toBe(1));
  });
});

describe("artifact_operation — null title fallback", () => {
  it("falls back to the kind label, never renders blank", () => {
    const block: ContentBlock = {
      type: "artifact_operation",
      blockId: "ao2",
      status: "completed",
      timestamp: 0,
      parentBlockId: null,
      operation: "create",
      kind: "ticket",
      artifactId: "art2",
      title: null,
      beforeHash: null,
      afterHash: null,
    };
    renderBlocks([block]);
    // The title falls back to the kind label AND a separate kind badge also
    // shows it — two matches is the expected (non-blank) rendering.
    expect(screen.getAllByText("Ticket").length).toBeGreaterThan(0);
  });
});

describe("resolved interview/approval — real content, not the pending reply form", () => {
  it("interview shows 'Answered N/M questions' and the real answer text", () => {
    const block: ContentBlock = {
      type: "interview",
      blockId: "iv1",
      status: "completed",
      timestamp: 0,
      parentBlockId: null,
      toolName: null,
      title: "A decision",
      description: null,
      questions: [{ questionId: "q1", question: "Which?", header: null, options: [], multiSelect: false }],
      answers: [{ questionId: "q1", question: "Which?", values: ["Rewrite"], notes: null }],
      error: null,
      metadata: null,
    };
    renderBlocks([block]);
    expect(screen.getByText("Answered 1 of 1 questions")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("Rewrite")).toBeTruthy();
  });

  it("approval renders nothing for a still-pending decision (null)", () => {
    const block: ContentBlock = {
      type: "approval",
      blockId: "ap1",
      status: "streaming",
      timestamp: 0,
      parentBlockId: null,
      toolName: "Bash",
      description: "run a command",
      inputSummary: null,
      inputDetail: null,
      decision: null,
    };
    const { container } = renderBlocks([block]);
    expect(container.textContent).toBe("");
  });
});

describe("no-throw fallback", () => {
  it("renders a labeled placeholder for an unrecognized block shape, never throws", () => {
    const malformed = { type: "some_future_block", blockId: "x1" } as unknown as ContentBlock;
    expect(() => renderBlocks([malformed])).not.toThrow();
    expect(screen.getByTestId("unsupported-block")).toBeTruthy();
  });
});
