/**
 * Lazy output-file fetch for an `autonomous_resume` trigger with an
 * `outputFile` (Sprint 2) — fires only on card expand.
 */
import { useQuery } from "@tanstack/react-query";
import type {
  WorkspaceReadFileRequest,
  WorkspaceReadFileResponse,
} from "@traycer/protocol/host/workspace/unary-schemas";
import { useHostClientOrNull } from "./host-client-context";

const MAX_BYTES = 500_000;

export interface UseResumeOutputArgs {
  readonly workspacePath: string;
  readonly filePath: string;
  readonly enabled: boolean;
}

export function useResumeOutput({ workspacePath, filePath, enabled }: UseResumeOutputArgs) {
  const client = useHostClientOrNull();
  const request: WorkspaceReadFileRequest = { workspacePath, filePath, maxBytes: MAX_BYTES };

  return useQuery<WorkspaceReadFileResponse>({
    queryKey: ["mobile", "workspace.readFile", workspacePath, filePath],
    queryFn: () => {
      if (client === null) throw new Error("no host client");
      return client.request("workspace.readFile", request);
    },
    enabled: enabled && client !== null,
    staleTime: Infinity,
    retry: false,
  });
}
