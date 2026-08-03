/**
 * M3 item 3 — `workspace.mentionFiles` / `mentionFolders` behind the composer's
 * `@` sheet, plus the per-root canary that makes an empty answer mean anything.
 *
 * The rules this hook exists to enforce are stated in `mention-model.ts`; the
 * short version is that the host returns an empty SUCCESS for a genuine
 * no-match, a nonexistent root and `roots: []` alike, so the client has to
 * manufacture its own evidence that the root is readable.
 *
 * ## Two requests, on two different clocks
 *
 * - **The canary** is a property of the ROOT. It runs once per root when the
 *   sheet first opens and again only if the binding changes — not per
 *   keystroke, which is what the ticket's aggregate design implied. `query: ""`
 *   with `limit: 1`, measured to be honoured exactly, so it is a single-row
 *   request.
 * - **The query** is debounced by 250 ms, matching desktop's
 *   `use-mention-items.ts:54`, and asks all roots at once because the result
 *   list is merged anyway.
 *
 * Folders are requested alongside files and listed first: a folder is the
 * coarser unit and there are far fewer of them, so burying them under 25 files
 * would make them unreachable. No client-side re-ranking beyond that — the
 * ticket puts fuzzy re-ordering out of scope and the host's order is a real
 * ranking (measured: `chat/composer` puts this package's files above another's).
 *
 * The canary runs on FILES only. A root holding folders but not one file would
 * be called unavailable — but `mentionEmptyState` only speaks when the merged
 * list is empty, which in that case means there was nothing to mention anyway.
 */
import { useEffect, useMemo, useState } from "react";
import type { MobileHostClient } from "@/host/host-client-context";
import type {
  MentionRootStatus,
  MentionSuggestion,
} from "@/views/chat/mention-model";

/** Matches desktop's mention debounce (`use-mention-items.ts:54`). */
const QUERY_DEBOUNCE_MS = 250;
const QUERY_LIMIT = 25;

export interface UseMentionFilesResult {
  readonly suggestions: readonly MentionSuggestion[];
  readonly loading: boolean;
  readonly rootStatuses: readonly MentionRootStatus[];
}

export function useMentionFiles(
  client: MobileHostClient | null,
  roots: readonly string[],
  query: string,
  /** False whenever no `@` trigger is live — nothing is requested at all then. */
  active: boolean,
): UseMentionFilesResult {
  const [suggestions, setSuggestions] = useState<readonly MentionSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [rootStatuses, setRootStatuses] = useState<readonly MentionRootStatus[]>([]);

  // Identity for the effect deps: `roots` is rebuilt every render by the
  // caller's projection, so depending on the array itself would re-issue every
  // canary on every keystroke.
  //
  // Newline-joined, not space-joined: a Windows home directory routinely
  // contains a space, so a space separator would split one root into two bogus
  // ones — each failing its own canary, reporting a healthy workspace as
  // broken. A newline cannot occur in a Windows path.
  const rootsKey = roots.join("\n");
  const rootList = useMemo(
    () => (rootsKey === "" ? [] : rootsKey.split("\n")),
    [rootsKey],
  );

  useEffect(() => {
    if (!active || client === null || rootList.length === 0) {
      setRootStatuses([]);
      return;
    }
    let cancelled = false;
    setRootStatuses(rootList.map((root) => ({ root, health: "checking" })));
    void (async (): Promise<void> => {
      const settled = await Promise.all(
        rootList.map(async (root): Promise<MentionRootStatus> => {
          try {
            const response = await client.request("workspace.mentionFiles", {
              roots: [root],
              query: "",
              limit: 1,
            });
            return {
              root,
              health: response.entries.length > 0 ? "readable" : "unavailable",
            };
          } catch {
            // A transport failure is not evidence about the root. Reporting it
            // as `unavailable` would blame the workspace for a dropped socket.
            //
            // `unknown`, not `checking`: `checking` means a probe is still in
            // flight, so a permanently failing socket spun a loading state
            // forever — correct, and indistinguishable from a slow probe, with
            // no copy able to say which. `unknown` settles, and settles into
            // honest wording.
            return { root, health: "unknown" };
          }
        }),
      );
      if (cancelled) return;
      setRootStatuses(settled);
    })();
    return () => {
      cancelled = true;
    };
  }, [active, client, rootList]);

  useEffect(() => {
    if (!active || client === null || rootList.length === 0) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      void (async (): Promise<void> => {
        try {
          const [folders, files] = await Promise.all([
            client.request("workspace.mentionFolders", {
              roots: rootList,
              query,
              limit: QUERY_LIMIT,
            }),
            client.request("workspace.mentionFiles", {
              roots: rootList,
              query,
              limit: QUERY_LIMIT,
            }),
          ]);
          if (cancelled) return;
          setSuggestions([...folders.entries, ...files.entries]);
        } catch {
          if (cancelled) return;
          // Cleared rather than left stale: rows from the previous query would
          // read as results for this one, and tapping one inserts a path the
          // user never searched for.
          setSuggestions([]);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, QUERY_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, client, rootList, query]);

  return { suggestions, loading, rootStatuses };
}
