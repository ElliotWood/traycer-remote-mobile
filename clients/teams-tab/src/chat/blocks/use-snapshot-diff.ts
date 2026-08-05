/**
 * `snapshots.readSnapshotDiff`, fetched when a card is opened.
 *
 * ONLY ON EXPAND. A transcript with fifty file changes must not issue fifty
 * diff requests to render — the card body mounts when the reader asks for it
 * (see `block-card.tsx`), and this hook lives inside that body, so the fetch
 * is gated by the disclosure rather than by a flag someone has to remember to
 * pass.
 *
 * Mobile drives the same call through TanStack Query. This client has no
 * query cache, and adding one to reuse a hook would be a far larger
 * dependency than the state machine below — the same trade `use-epics.ts`
 * made, for the same reason.
 *
 * The three states are modelled explicitly because `pending` and `failed` are
 * OPPOSITES that both render as "no diff on screen" if they collapse.
 */
import { useEffect, useState } from "react";
import type { EpicListClient } from "@traycer-clients/shared/epic/epic-list";
import type { SnapshotsReadSnapshotDiffResponse } from "@traycer/protocol/host/snapshot-schemas";

/**
 * Narrow by structure, not by name.
 *
 * `EpicListClient` is `Pick<HostRequester, "request">` — the whole unary
 * surface this file needs, already declared in shared. Re-aliasing it here
 * keeps the intent readable at the call site without inventing a second
 * structural type that would have to be kept in step with the first.
 */
export type SnapshotDiffClient = EpicListClient;

export type SnapshotDiffState =
  | { readonly kind: "pending" }
  | { readonly kind: "ready"; readonly diff: SnapshotsReadSnapshotDiffResponse }
  /** No answer. Never rendered as an empty diff — that would claim nothing changed. */
  | { readonly kind: "failed"; readonly detail: string };

/**
 * NOTHING IS SET DURING THE EFFECT BODY, and that shape is deliberate.
 *
 * `react-hooks/set-state-in-effect` is on in this package because its
 * defects have been hook defects — the shell remount and the 40-second
 * loading state were both an effect writing state during render. Five
 * existing violations are held open on purpose; adding a sixth to a file
 * written after the rule landed would be the wrong direction.
 *
 * So the two synchronous answers — no host, no snapshot — are DERIVED during
 * render rather than written, and staleness is handled by keying the stored
 * result to the request that produced it: a result for a different pair reads
 * as pending without anyone resetting it. Only the async resolution writes.
 */
export function useSnapshotDiff(
  client: SnapshotDiffClient | null,
  beforeHash: string | null,
  afterHash: string | null,
): SnapshotDiffState {
  const [result, setResult] = useState<{
    readonly key: string;
    readonly state: SnapshotDiffState;
  } | null>(null);

  const key = `${beforeHash ?? ""}|${afterHash ?? ""}`;
  const unavailable =
    client === null
      ? "No Traycer host is configured for this build."
      : beforeHash === null && afterHash === null
        ? "This change carries no snapshot to compare."
        : null;

  useEffect(() => {
    if (client === null || unavailable !== null) return;
    let disposed = false;
    client
      .request("snapshots.readSnapshotDiff", { beforeHash, afterHash })
      .then((diff) => {
        if (disposed) return;
        setResult({ key, state: { kind: "ready", diff } });
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setResult({
          key,
          state: {
            kind: "failed",
            detail:
              error instanceof Error && error.message.length > 0
                ? error.message
                : String(error),
          },
        });
      });
    return () => {
      disposed = true;
    };
  }, [client, beforeHash, afterHash, key, unavailable]);

  if (unavailable !== null) return { kind: "failed", detail: unavailable };
  // A result for a DIFFERENT hash pair is not this request's answer.
  if (result === null || result.key !== key) return { kind: "pending" };
  return result.state;
}
