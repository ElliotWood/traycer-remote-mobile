// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  useCreateArtifact,
  useDeleteArtifact,
  useDeleteChat,
  useRenameArtifact,
  useRenameChat,
} from "../use-node-mutations";
import { createFakeHostClient } from "@/test-utils/fakes";
import { act, renderHook, waitFor } from "@/test-utils/dom";

describe("useRenameChat", () => {
  it("dispatches epic.renameChat with the trimmed title and calls onRenamed", async () => {
    const fake = createFakeHostClient(async () => ({ updated: true }));
    const onRenamed = vi.fn();
    const { result } = renderHook(() => useRenameChat(fake.client, "e1", "c1", onRenamed));

    act(() => result.current.rename("  New title  "));

    await waitFor(() => expect(onRenamed).toHaveBeenCalledTimes(1));
    expect(fake.request).toHaveBeenCalledWith("epic.renameChat", {
      epicId: "e1",
      chatId: "c1",
      title: "New title",
    });
  });

  it("ignores a blank title without dispatching", () => {
    const fake = createFakeHostClient(async () => ({ updated: true }));
    const { result } = renderHook(() => useRenameChat(fake.client, "e1", "c1", vi.fn()));

    act(() => result.current.rename("   "));

    expect(fake.request).not.toHaveBeenCalled();
  });

  it("surfaces a rejected rename as an inline error, not a thrown exception", async () => {
    const fake = createFakeHostClient(async () => {
      throw new Error("host unreachable");
    });
    const { result } = renderHook(() => useRenameChat(fake.client, "e1", "c1", vi.fn()));

    act(() => result.current.rename("New title"));

    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error).toBe("host unreachable");
  });
});

describe("useDeleteChat", () => {
  it("dispatches epic.deleteChat and calls onDeleted on success — the caller (a confirm dialog) is the only trigger", async () => {
    const fake = createFakeHostClient(async () => ({ deleted: true }));
    const onDeleted = vi.fn();
    const { result } = renderHook(() => useDeleteChat(fake.client, "e1", "c1", onDeleted));

    act(() => result.current.deleteNode());

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(fake.request).toHaveBeenCalledWith("epic.deleteChat", { epicId: "e1", chatId: "c1" });
  });

  it("does not fire a second request while one is already in flight (double-tap guard)", async () => {
    let resolveRequest: (() => void) | undefined;
    const fake = createFakeHostClient(
      () =>
        new Promise((resolve) => {
          resolveRequest = () => resolve({ deleted: true });
        }),
    );
    const { result } = renderHook(() => useDeleteChat(fake.client, "e1", "c1", vi.fn()));

    act(() => result.current.deleteNode());
    act(() => result.current.deleteNode());
    expect(fake.request).toHaveBeenCalledTimes(1);

    resolveRequest?.();
    await waitFor(() => expect(result.current.phase).toBe("idle"));
  });
});

describe("useRenameArtifact / useDeleteArtifact", () => {
  it("dispatches epic.renameArtifact keyed by artifactId", async () => {
    const fake = createFakeHostClient(async () => ({ updated: true }));
    const onRenamed = vi.fn();
    const { result } = renderHook(() => useRenameArtifact(fake.client, "e1", "a1", onRenamed));

    act(() => result.current.rename("Design doc"));

    await waitFor(() => expect(onRenamed).toHaveBeenCalledTimes(1));
    expect(fake.request).toHaveBeenCalledWith("epic.renameArtifact", {
      epicId: "e1",
      artifactId: "a1",
      title: "Design doc",
    });
  });

  it("dispatches epic.deleteArtifact keyed by artifactId", async () => {
    const fake = createFakeHostClient(async () => ({ deleted: true }));
    const onDeleted = vi.fn();
    const { result } = renderHook(() => useDeleteArtifact(fake.client, "e1", "a1", onDeleted));

    act(() => result.current.deleteNode());

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(fake.request).toHaveBeenCalledWith("epic.deleteArtifact", { epicId: "e1", artifactId: "a1" });
  });
});

describe("useCreateArtifact", () => {
  it("dispatches epic.createArtifact with the given parentId and calls onCreated with the minted id", async () => {
    const fake = createFakeHostClient(async () => ({ artifactId: "a-new" }));
    const onCreated = vi.fn();
    const { result } = renderHook(() =>
      useCreateArtifact({ client: fake.client, epicId: "e1", parentId: "a-parent", onCreated }),
    );

    act(() => result.current.create("ticket", "Fix bug"));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("a-new"));
    expect(fake.request).toHaveBeenCalledWith("epic.createArtifact", {
      epicId: "e1",
      parentId: "a-parent",
      artifactType: "ticket",
      title: "Fix bug",
    });
  });

  it("passes parentId: null for a root-level create", async () => {
    const fake = createFakeHostClient(async () => ({ artifactId: "a-new" }));
    const { result } = renderHook(() =>
      useCreateArtifact({ client: fake.client, epicId: "e1", parentId: null, onCreated: vi.fn() }),
    );

    act(() => result.current.create("spec", "Design"));

    await waitFor(() =>
      expect(fake.request).toHaveBeenCalledWith("epic.createArtifact", {
        epicId: "e1",
        parentId: null,
        artifactType: "spec",
        title: "Design",
      }),
    );
  });
});
