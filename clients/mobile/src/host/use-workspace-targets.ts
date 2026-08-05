/**
 * M5 item 3 — the pickable repos/worktrees for the create flows.
 *
 * Two RPCs, because one is not enough: `worktree.listAllForHost` gives the
 * worktrees but carries NO `workspacePath`, which every arm of
 * `worktreeFolderIntentSchema` requires. `workspace.resolvePathsByRepoIdentifiers`
 * supplies it. See `workspace-selection.ts` for the full reasoning.
 *
 * The resolve call is made ONLY for the identifiers actually present in the
 * listing, deduped — on the machine this was built against that is 4 requests'
 * worth of identifiers for 28 worktrees, rather than 28.
 *
 * Folderless is always available, even when both calls fail: a phone that
 * cannot reach the worktree list must still be able to start a folderless
 * epic, which is the thing it could always do. A failed lookup degrades the
 * picker to its previous behaviour rather than blocking creation.
 */
import { useEffect, useState } from "react";
import type { MobileHostClient } from "@/host/host-client-context";
import { useHostWorktrees } from "@/host/use-host-worktrees";
import {
  FOLDERLESS_TARGET,
  repoKey,
  selectableTargets,
  type WorkspaceTarget,
} from "@/host/workspace-selection";

export type WorkspaceTargetsPhase = "loading" | "loaded" | "error";

export interface UseWorkspaceTargetsResult {
  readonly phase: WorkspaceTargetsPhase;
  readonly targets: readonly WorkspaceTarget[];
  /** The host reported more worktrees than were fetched — say so rather than implying the list is complete. */
  readonly truncated: boolean;
}

export function useWorkspaceTargets(
  client: MobileHostClient | null,
  enabled: boolean,
): UseWorkspaceTargetsResult {
  const {
    phase: worktreesPhase,
    worktrees,
    truncated,
  } = useHostWorktrees(client, enabled);
  const [pathByRepo, setPathByRepo] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  const [resolvePhase, setResolvePhase] = useState<WorkspaceTargetsPhase>("loading");

  useEffect(() => {
    if (!enabled || client === null) return;
    if (worktreesPhase !== "loaded") return;

    const identifiers = new Map<string, { owner: string; repo: string }>();
    for (const entry of worktrees) {
      if (entry.repoIdentifier === null) continue;
      identifiers.set(repoKey(entry.repoIdentifier), entry.repoIdentifier);
    }
    if (identifiers.size === 0) {
      setPathByRepo(new Map());
      setResolvePhase("loaded");
      return;
    }

    let cancelled = false;
    setResolvePhase("loading");
    void (async (): Promise<void> => {
      try {
        const response = await client.request(
          "workspace.resolvePathsByRepoIdentifiers",
          { repoIdentifiers: [...identifiers.values()] },
        );
        if (cancelled) return;
        const next = new Map<string, string>();
        for (const mapping of response.mappings) {
          next.set(repoKey(mapping.repoIdentifier), mapping.workspacePath);
        }
        setPathByRepo(next);
        setResolvePhase("loaded");
      } catch {
        if (cancelled) return;
        setResolvePhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, enabled, worktreesPhase, worktrees]);

  const phase: WorkspaceTargetsPhase =
    worktreesPhase === "error" || resolvePhase === "error"
      ? "error"
      : worktreesPhase === "loaded" && resolvePhase === "loaded"
        ? "loaded"
        : "loading";

  return {
    // Folderless survives every failure — see this module's docblock.
    targets:
      phase === "loaded" ? selectableTargets(worktrees, pathByRepo) : [FOLDERLESS_TARGET],
    phase,
    truncated,
  };
}
