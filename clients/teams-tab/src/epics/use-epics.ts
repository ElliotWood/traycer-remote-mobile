/**
 * The Epics tab's data source: `epic.listTasks` over the bound `HostClient`.
 *
 * The request/projection is shared (`@traycer-clients/shared/epic/epic-list`),
 * moved out of mobile rather than reimplemented, so this client hits the same
 * host path gui-app and the PWA do. What's here is the state machine, which is
 * genuinely the tab's: mobile drives the same call through TanStack, and
 * adding a query cache to this client to reuse a hook would be a much larger
 * dependency than the twenty lines it saves.
 *
 * WHY THIS AND NOT `agent.list`. Listing AGENTS needs
 * `{ epicId, senderAgentId }` and answers as a caller that is itself an agent.
 * A signed-in human has neither — which is why the bot could do it (it runs as
 * the fenced demo agent inside one epic) and this tab cannot. `epic.listTasks`
 * takes no epic and no agent identity; the user is inferred from the auth
 * context. Agents belong inside an epic, where `epicId` exists.
 *
 * The four states are modelled explicitly rather than derived from a pile of
 * booleans, because the pair that matters — `empty` and `error` — are
 * OPPOSITES that render as the same zero rows if you let them collapse.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  epicListNextCursor,
  fetchEpicListPage,
  toFleetEpics,
  type EpicListClient,
  type FleetEpic,
} from "@traycer-clients/shared/epic/epic-list";
import type { ListTasksResponse } from "@traycer/protocol/host/epic/unary-schemas";

export type EpicsState =
  /** We have not got an answer yet. Not "there are none". */
  | { readonly kind: "loading" }
  /** The host answered. `epics` may be empty, and that is a real answer. */
  | {
      readonly kind: "ready";
      readonly epics: readonly FleetEpic[];
      readonly hasMore: boolean;
      readonly loadingMore: boolean;
      /** Set once a refresh fails while rows are already on screen — see below. */
      readonly stale: boolean;
    }
  /** No answer. Never worded as a fact about the user's epics. */
  | { readonly kind: "error"; readonly detail: string };

export interface EpicsResult {
  readonly state: EpicsState;
  readonly reload: () => void;
  readonly loadMore: () => void;
}

function describe(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return String(error);
}

export function useEpics(client: EpicListClient | null): EpicsResult {
  const [state, setState] = useState<EpicsState>({ kind: "loading" });
  const cursor = useRef<string | undefined>(undefined);
  // Guards against a response from a superseded request overwriting a newer
  // one — a reload that resolves after the request it replaced would otherwise
  // reinstate the older page.
  const generation = useRef(0);

  const load = useCallback(
    (mode: "initial" | "more") => {
      if (client === null) {
        setState({
          kind: "error",
          detail: "No Traycer host is configured for this build.",
        });
        return;
      }
      const gen = ++generation.current;
      if (mode === "initial") {
        cursor.current = undefined;
        setState((prev) =>
          // A reload with rows on screen keeps them rather than flashing the
          // skeleton: replacing real content with a placeholder is a visible
          // regression to the user even though it is "more correct".
          prev.kind === "ready" ? prev : { kind: "loading" },
        );
      } else {
        setState((prev) =>
          prev.kind === "ready" ? { ...prev, loadingMore: true } : prev,
        );
      }

      const previous =
        mode === "more" && state.kind === "ready" ? state.epics : [];

      fetchEpicListPage(client, mode === "more" ? cursor.current : undefined)
        .then((page: ListTasksResponse) => {
          if (gen !== generation.current) return;
          cursor.current = epicListNextCursor(page);
          const fetched = toFleetEpics(page.tasks);
          setState({
            kind: "ready",
            epics: mode === "more" ? [...previous, ...fetched] : fetched,
            hasMore: cursor.current !== undefined,
            loadingMore: false,
            stale: false,
          });
        })
        .catch((error: unknown) => {
          if (gen !== generation.current) return;
          setState((prev) => {
            // A failure with rows already on screen is DISCONNECTED, not
            // error: we had an answer and lost contact, and blanking the list
            // would assert the user has no epics — a claim we no longer have
            // any basis for. Only a failure with nothing on screen is the
            // hard error state.
            if (prev.kind === "ready") {
              return { ...prev, loadingMore: false, stale: true };
            }
            return { kind: "error", detail: describe(error) };
          });
        });
    },
    [client, state],
  );

  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    load("initial");
  }, [load]);

  return {
    state,
    reload: useCallback(() => {
      load("initial");
    }, [load]),
    loadMore: useCallback(() => {
      load("more");
    }, [load]),
  };
}
