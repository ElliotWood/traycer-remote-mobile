import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { svgToPngBlob } from "@/editor-core/nodes/mermaid/mermaid-service";
import { readMermaidPalette } from "@/editor-core/nodes/mermaid/mermaid-theme";
import {
  saveBlobToDisk,
  type SaveBlobOutcome,
} from "@/lib/files/save-blob-to-disk";
import { appLogger } from "@/lib/logger";
import { runnerMutationKeys } from "@/lib/query-keys";
import { reportableErrorToast } from "@/lib/reportable-error-toast";

export interface UseMermaidPngDownloadParams {
  readonly svg: string;
  readonly enabled: boolean;
}

export interface UseMermaidPngDownloadResult {
  readonly downloadMermaidPng: () => void;
  readonly isDownloading: boolean;
}

interface MermaidPngDownloadInput {
  readonly svg: string;
}

export function useMermaidPngDownload(
  params: UseMermaidPngDownloadParams,
): UseMermaidPngDownloadResult {
  const { svg, enabled } = params;
  const { mutate, isPending } = useMutation<
    SaveBlobOutcome,
    Error,
    MermaidPngDownloadInput
  >({
    mutationKey: runnerMutationKeys.mermaidPngDownload(),
    mutationFn: async (input) => {
      const palette = readMermaidPalette(document);
      const blob = await svgToPngBlob({
        svg: input.svg,
        backgroundColor: palette.background,
      });
      return saveBlobToDisk(blob, "mermaid-diagram.png");
    },
    onSuccess: (outcome) => {
      if (outcome.status === "saved") {
        toast.success(`Saved ${outcome.name}`);
      } else if (outcome.status === "started") {
        // The anchor path cannot confirm the browser took it, so this says
        // what was done, not what resulted. See `SaveBlobOutcome`.
        toast.info(`Downloading ${outcome.name}`, {
          description: "Check your browser downloads if it doesn't appear.",
        });
      }
    },
    onError: (err) => {
      appLogger.errorSummary("[mermaid] download failed", {}, err);
      reportableErrorToast("Failed to download diagram", undefined, {
        title: "Could not download diagram",
        message: null,
        code: null,
        source: "Mermaid diagram",
      });
    },
  });

  const downloadMermaidPng = useCallback(() => {
    if (!enabled || svg.length === 0) return;
    mutate({ svg });
  }, [enabled, mutate, svg]);

  return { downloadMermaidPng, isDownloading: isPending };
}
