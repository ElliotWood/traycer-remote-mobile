/**
 * M5 item 5 — the host's existing worktrees, for the create-flow picker.
 *
 * ## The request shape is not what the ticket says
 *
 * M5 cites `worktree.listAllForHost@1.1`. The host negotiates **v1.3+**, which
 * adds a REQUIRED `forceRefresh` (`worktree-schemas.ts:977-994`). That is not
 * pedantry: a call built to the ticket's version is rejected for the missing
 * field, and the rejection looks exactly like the `superRefine` refusal item 5
 * asks you to demonstrate — so a probe written to the ticket produces a green
 * that proves nothing. Measured, not assumed.
 *
 * ## Why the arguments are what they are
 *
 * - `includeActivity: false` — a phone does not need per-worktree git activity,
 *   and the probes are the expensive part of this call.
 * - `limit` finite — with `activityPaths: null`, the host's `superRefine`
 *   rejects `includeActivity: true` alongside `limit: null`. We pass neither
 *   an activity probe nor an unbounded limit, so paging here is a real
 *   constraint of the API rather than a decorative one.
 * - `forceRefresh: false` — cached read. A picker opening is not a reason to
 *   make the host re-stat every worktree on disk.
 *
 * ## `repoIdentifier` is structured
 *
 * `{owner, repo}`, not a string. Reading it as a string yields `undefined`
 * rather than throwing, so a consumer that gets this wrong degrades silently
 * instead of failing — which is how the first version of the probe behind this
 * module reported success against an empty set.
 */
import { useEffect, useState } from "react";
import type { WorktreeHostEntry } from "@traycer/protocol/host/worktree-schemas";
import type { MobileHostClient } from "@/host/host-client-context";

export type HostWorktreesPhase = "loading" | "loaded" | "error";

export interface UseHostWorktreesResult {
  readonly phase: HostWorktreesPhase;
  readonly worktrees: readonly WorktreeHostEntry[];
  /** True when the host reported more pages than this hook fetched — the picker says so rather than implying the list is complete. */
  readonly truncated: boolean;
}

/**
 * Page size, and the cap on how many pages are walked.
 *
 * 28 worktrees on the machine this was built against, so one page of 50 covers
 * it comfortably today. The page walk exists because "today" is not a
 * guarantee, and the cap exists so a host with thousands does not turn opening
 * a picker into an unbounded fetch. When the cap binds, `truncated` says so —
 * a silently-short list reads as "these are all my repos".
 */
const PAGE_SIZE = 50;
const MAX_PAGES = 6;

export function useHostWorktrees(
  client: MobileHostClient | null,
  enabled: boolean,
): UseHostWorktreesResult {
  const [phase, setPhase] = useState<HostWorktreesPhase>("loading");
  const [worktrees, setWorktrees] = useState<readonly WorktreeHostEntry[]>([]);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    if (client === null) {
      setPhase("error");
      return;
    }
    let cancelled = false;
    setPhase("loading");

    void (async (): Promise<void> => {
      try {
        const collected: WorktreeHostEntry[] = [];
        let cursor: string | null = null;
        let page = 0;
        let more = false;
        for (; page < MAX_PAGES; page += 1) {
          // Annotated rather than inferred: `cursor` is assigned FROM the
          // response and passed INTO the next request, so letting TypeScript
          // infer this makes `response` depend on its own initializer
          // (TS7022). Naming the shape breaks the cycle.
          const response: {
            readonly worktrees: readonly WorktreeHostEntry[];
            readonly nextCursor: string | null;
          } = await client.request("worktree.listAllForHost", {
            includeActivity: false,
            activityPaths: null,
            cursor,
            limit: PAGE_SIZE,
            forceRefresh: false,
          });
          if (cancelled) return;
          collected.push(...response.worktrees);
          cursor = response.nextCursor ?? null;
          if (cursor === null) break;
          more = true;
        }
        if (cancelled) return;
        setWorktrees(collected);
        setTruncated(more && cursor !== null);
        setPhase("loaded");
      } catch {
        if (cancelled) return;
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, enabled]);

  return { phase, worktrees, truncated };
}
