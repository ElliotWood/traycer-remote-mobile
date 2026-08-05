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
import { useEffect, useRef, useState } from "react";
import { artifactBodyFragmentName } from "@traycer/protocol/persistence/epic/artifacts";
import { CACHE_SCHEMA_VERSION } from "./cache-config";
import type { ArtifactRoomRegistry } from "./artifact-room-registry";

export type ArtifactBodyState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly markdown: string }
  | { readonly kind: "unavailable" }
  | { readonly kind: "retrying" }
  | { readonly kind: "error"; readonly message: string };

const LOADING: ArtifactBodyState = { kind: "loading" };

/**
 * P0 caching, layer D: the last successfully-serialized markdown, keyed by
 * (artifactRoomId, artifactId). The registry's `Y.Doc` replicas are NOT
 * separately persisted (no `y-indexeddb` here) — this string cache already
 * updates in lockstep with every successful serialize below, so a second
 * persistence mechanism for the raw doc would only add lifecycle complexity
 * (interacting with `ArtifactRoomRegistry.applyState`'s doc-replacement
 * branch) for zero marginal coverage.
 */
function artifactBodyStorageKey(artifactRoomId: string, artifactId: string): string {
  return `artifact-body:v${CACHE_SCHEMA_VERSION}:${artifactRoomId}:${artifactId}`;
}

/**
 * Synchronous localStorage read, used both as `useState`'s lazy initializer
 * (zero-gap on mount) and from the effect's id-change reset (that line runs
 * on every effect invocation, including the first, so it must seed from
 * cache too or it would blank the lazy-initialized state a moment after
 * mount). Corrupt JSON / no `window` degrade to "no cache", never throw.
 */
export function readCachedArtifactBody(
  artifactRoomId: string,
  artifactId: string,
): ArtifactBodyState | null {
  if (typeof window === "undefined" || !("localStorage" in window)) return null;
  try {
    const raw = window.localStorage.getItem(artifactBodyStorageKey(artifactRoomId, artifactId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || typeof (parsed as { markdown?: unknown }).markdown !== "string") {
      return null;
    }
    return { kind: "ready", markdown: (parsed as { markdown: string }).markdown };
  } catch {
    return null;
  }
}

function writeCachedArtifactBody(artifactRoomId: string, artifactId: string, markdown: string): void {
  if (typeof window === "undefined" || !("localStorage" in window)) return;
  try {
    window.localStorage.setItem(
      artifactBodyStorageKey(artifactRoomId, artifactId),
      JSON.stringify({ markdown }),
    );
  } catch {
    // Quota exceeded / private-mode write rejection — degrade to "no cache
    // written this time", never throw.
  }
}

export function useArtifactBody(
  registry: ArtifactRoomRegistry | null,
  artifactRoomId: string,
  artifactId: string,
): ArtifactBodyState {
  const [state, setState] = useState<ArtifactBodyState>(
    () => readCachedArtifactBody(artifactRoomId, artifactId) ?? LOADING,
  );
  // Dedupes the cache write against a burst of Yjs frames (S1) — only
  // re-writes when the serialized markdown actually changed.
  const lastWrittenMarkdownRef = useRef<string | null>(null);

  useEffect(() => {
    if (registry === null) {
      setState(LOADING);
      return;
    }

    let disposed = false;
    const seed = readCachedArtifactBody(artifactRoomId, artifactId);
    setState(seed ?? LOADING);
    lastWrittenMarkdownRef.current = seed?.kind === "ready" ? seed.markdown : null;

    const recompute = (): void => {
      if (disposed) return;
      const roomState = registry.getState(artifactRoomId);
      if (roomState !== "ready") {
        const placeholder: ArtifactBodyState =
          roomState === "retrying" ? { kind: "retrying" } : { kind: "unavailable" };
        // R4: `getState()` defaults an unreported room to "unavailable"
        // indistinguishably from a real host report. `hasReported` tells them
        // apart — while the host has never determined this room's state at
        // all (dead/slow host, or just hasn't gotten to it yet), don't
        // downgrade an already-`ready` cached render. The MOMENT the host has
        // reported anything real (`hasReported` true — whether that happened
        // before this mount or arrives live via `registry.subscribe` below),
        // honor it unconditionally, including a genuine downgrade (the
        // artifact really was deleted, the room really dropped).
        if (!registry.hasReported(artifactRoomId)) {
          setState((prev) => (prev.kind === "ready" ? prev : placeholder));
        } else {
          setState(placeholder);
        }
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
          if (markdown !== lastWrittenMarkdownRef.current) {
            lastWrittenMarkdownRef.current = markdown;
            writeCachedArtifactBody(artifactRoomId, artifactId, markdown);
          }
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
