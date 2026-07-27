/**
 * Lazy diff fetch for `file_change`/`artifact_operation` blocks (Sprint 2).
 * Only called on card expand (`enabled`) — heavy content is never fetched
 * upfront for a transcript with dozens of file changes.
 */
import { useQuery } from "@tanstack/react-query";
import type {
  SnapshotsReadSnapshotDiffRequest,
  SnapshotsReadSnapshotDiffResponse,
} from "@traycer/protocol/host/snapshot-schemas";
import { useHostClientOrNull } from "./host-client-context";

export interface UseSnapshotDiffArgs {
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
  readonly enabled: boolean;
}

export function useSnapshotDiff({
  beforeHash,
  afterHash,
  enabled,
}: UseSnapshotDiffArgs) {
  const client = useHostClientOrNull();
  const request: SnapshotsReadSnapshotDiffRequest = { beforeHash, afterHash };

  return useQuery<SnapshotsReadSnapshotDiffResponse>({
    queryKey: ["mobile", "snapshots.readSnapshotDiff", beforeHash, afterHash],
    queryFn: () => {
      if (client === null) throw new Error("no host client");
      return client.request("snapshots.readSnapshotDiff", request);
    },
    enabled: enabled && client !== null && (beforeHash !== null || afterHash !== null),
    staleTime: Infinity,
    retry: false,
  });
}
