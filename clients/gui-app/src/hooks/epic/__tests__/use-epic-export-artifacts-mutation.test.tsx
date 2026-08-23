import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/logger", () => ({
  appLogger: { errorSummary: vi.fn() },
}));

vi.mock("@/lib/runner-error-toast", () => ({
  toastFromRunnerError: vi.fn(),
}));

vi.mock("@/lib/files/save-blob-to-disk", () => ({
  saveBlobToDisk: vi.fn(),
}));

vi.mock("@/lib/artifacts/artifact-export", () => ({
  createArtifactExport: vi.fn(),
}));

const track = vi.fn();
vi.mock("@/lib/analytics", () => ({
  Analytics: { getInstance: () => ({ track }) },
  AnalyticsEvent: { ArtifactExported: "artifact_exported" },
}));

vi.mock("@/providers/use-open-epic-handle", () => ({
  useOpenEpicHandle: () => ({
    store: {
      getState: () => ({
        getArtifactFragment: () => ({ id: "fragment" }),
        // Required by the hook: it takes a body lease per artifact and
        // releases it before the save dialog. Omitting it does not fail as a
        // missing mock - `mutationFn` throws a TypeError, the mutation
        // rejects, and `onSuccess` never runs, so every toast assertion below
        // reports "called 0 times" and reads as the export saying nothing.
        acquireArtifactBodyLease: () => () => undefined,
      }),
    },
  }),
}));

import { toast } from "sonner";
import { createArtifactExport } from "@/lib/artifacts/artifact-export";
import { saveBlobToDisk } from "@/lib/files/save-blob-to-disk";
import { useEpicExportArtifacts } from "@/hooks/epic/use-epic-export-artifacts-mutation";

function makeWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return ({ children }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

const SELECTION = {
  artifacts: [{ id: "a1", title: "Plan" }],
  format: "markdown",
  archive: true,
  archiveTitle: null,
} as const;

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.info).mockClear();
  track.mockClear();
  // No `as never`: on the stack this mock's shape did not match the real
  // return type and had to be forced past the compiler. On `main` it does
  // match, so the assertion is not merely redundant - keeping it would go on
  // hiding any future drift in that shape.
  vi.mocked(createArtifactExport).mockResolvedValue({
    blob: new Blob(["x"], { type: "application/zip" }),
    suggestedName: "epic-artifacts.zip",
  });
});

async function runExport(): Promise<void> {
  const { result } = renderHook(() => useEpicExportArtifacts(), {
    wrapper: makeWrapper(),
  });
  result.current.mutate({ ...SELECTION });
  await waitFor(() => {
    expect(result.current.isPending).toBe(false);
    expect(result.current.isIdle).toBe(false);
  });
}

describe("useEpicExportArtifacts", () => {
  it("rejects an empty artifact selection with the export validation error", async () => {
    const { result } = renderHook(() => useEpicExportArtifacts(), {
      wrapper: makeWrapper(),
    });

    await expect(
      result.current.mutateAsync({
        artifacts: [],
        format: "markdown",
        archive: true,
        archiveTitle: null,
      }),
    ).rejects.toThrow("Select at least one artifact to export.");
  });

  // The three arms below are the user-visible half of the outcome type. The
  // seam is what matters: the lib can distinguish a verified write from an
  // unobserved one, and that is worth nothing if the toast says "Saved"
  // either way — which is exactly what it did before 2026-08-14.
  it("says Saved only when something confirmed the write", async () => {
    vi.mocked(saveBlobToDisk).mockResolvedValue({
      status: "saved",
      name: "epic-artifacts.zip",
    });

    await runExport();

    expect(toast.success).toHaveBeenCalledWith("Saved epic-artifacts.zip");
    expect(toast.info).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("does NOT say Saved when the anchor download went unobserved", async () => {
    vi.mocked(saveBlobToDisk).mockResolvedValue({
      status: "started",
      name: "epic-artifacts.zip",
    });

    await runExport();

    // In a Teams tab this is the only path that runs, and the file may never
    // have been written. Claiming otherwise is the defect.
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      "Downloading epic-artifacts.zip",
      expect.objectContaining({
        description: "Check your browser downloads if it doesn't appear.",
      }),
    );
    // The user did export; only the claim about the disk changes.
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("announces nothing at all when the save was cancelled", async () => {
    vi.mocked(saveBlobToDisk).mockResolvedValue({ status: "cancelled" });

    await runExport();

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });
});
