/**
 * Lazy, per-artifact body markdown state (Mobile v2, Sprint 3 / F2).
 *
 * Reads the room replica maintained by the SAME `epic.subscribe` session
 * `useEpicDoc` already opened (via its `ArtifactRoomRegistry`) — never a
 * second `openEpic` call. The expensive work (dynamic-import the tiptap
 * serializer, walk the Y.XmlFragment, serialize to markdown) runs ONLY for
 * the artifact currently passed in, and only while this hook is mounted for
 * it — "bounded ... torn down on close" (contract) refers to this derived
 * state, not the underlying `Y.Doc` replicas the registry keeps for the
 * whole session.
 */
import { useEffect, useState } from "react";
import { artifactBodyFragmentName } from "@traycer/protocol/persistence/epic/artifacts";
import type { ArtifactRoomRegistry } from "./artifact-room-registry";

export type ArtifactBodyState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly markdown: string }
  | { readonly kind: "unavailable" }
  | { readonly kind: "retrying" }
  | { readonly kind: "error"; readonly message: string };

const LOADING: ArtifactBodyState = { kind: "loading" };

export function useArtifactBody(
  registry: ArtifactRoomRegistry | null,
  artifactRoomId: string,
  artifactId: string,
): ArtifactBodyState {
  const [state, setState] = useState<ArtifactBodyState>(LOADING);

  useEffect(() => {
    if (registry === null) {
      setState(LOADING);
      return;
    }

    let disposed = false;
    setState(LOADING);

    const recompute = (): void => {
      if (disposed) return;
      const roomState = registry.getState(artifactRoomId);
      if (roomState !== "ready") {
        setState(roomState === "retrying" ? { kind: "retrying" } : { kind: "unavailable" });
        return;
      }
      const doc = registry.getDoc(artifactRoomId);
      if (doc === null) {
        setState(LOADING);
        return;
      }
      // Lazy: the tiptap/prosemirror serializer module is only ever pulled
      // in here, on-demand — never from a static top-level import a tree/
      // list view could reach on initial load.
      import("./artifact-body/artifact-body-markdown")
        .then(({ serializeArtifactBody }) => {
          if (disposed) return;
          const fragment = doc.getXmlFragment(artifactBodyFragmentName(artifactId));
          const markdown = serializeArtifactBody(fragment);
          setState({ kind: "ready", markdown });
        })
        .catch((err: unknown) => {
          if (disposed) return;
          setState({
            kind: "error",
            message:
              err instanceof Error
                ? err.message
                : "Couldn't render this artifact.",
          });
        });
    };

    recompute();
    const unsubscribe = registry.subscribe(artifactRoomId, recompute);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [registry, artifactRoomId, artifactId]);

  return state;
}
