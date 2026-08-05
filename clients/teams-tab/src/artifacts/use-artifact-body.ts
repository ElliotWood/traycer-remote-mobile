/**
 * Lazy, per-artifact body markdown state — ported from mobile's
 * `host/use-artifact-body.ts`. Reads the room replica `useEpicAgents`
 * already maintains via its `ArtifactRoomRegistry` — never a second
 * `epic.subscribe`. The expensive work (dynamic-import the tiptap
 * serializer, walk the Y.XmlFragment, serialize to markdown) runs only for
 * the artifact currently passed in, and only while this hook is mounted for
 * it.
 */
import { useEffect, useRef, useState } from "react";
import { artifactBodyFragmentName } from "@traycer/protocol/persistence/epic/artifacts";
import type { ArtifactRoomRegistry } from "@traycer-clients/shared/epic/artifact-room-registry";

export type ArtifactBodyState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly markdown: string }
  | { readonly kind: "unavailable" }
  | { readonly kind: "retrying" }
  | { readonly kind: "error"; readonly message: string };

const LOADING: ArtifactBodyState = { kind: "loading" };

/**
 * Bumped by hand whenever the persisted shape changes. Mobile ties this to
 * its broader client-persistence layer's `CACHE_SCHEMA_VERSION`; the tab has
 * no such layer today, so this is its own, narrower constant rather than
 * inventing one.
 */
const ARTIFACT_BODY_CACHE_SCHEMA_VERSION = "1";

function artifactBodyStorageKey(artifactRoomId: string, artifactId: string): string {
  return `artifact-body:v${ARTIFACT_BODY_CACHE_SCHEMA_VERSION}:${artifactRoomId}:${artifactId}`;
}

/**
 * Synchronous localStorage read, used both as `useState`'s lazy initializer
 * (zero-gap on mount) and from the effect's id-change reset. Corrupt JSON /
 * no `window` degrade to "no cache", never throw.
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
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { markdown?: unknown }).markdown !== "string"
    ) {
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
  // Dedupes the cache write against a burst of Yjs frames — only re-writes
  // when the serialized markdown actually changed.
  const lastWrittenMarkdownRef = useRef<string | null>(null);

  // Re-seed from cache when the artifact identity itself changes — the
  // render-phase reset pattern (see `epicId` in `app.tsx`'s `EpicScreen`),
  // not an Effect: `useState`'s lazy initializer above only ever runs once,
  // so switching artifacts needs this to re-run, and the value is already
  // knowable during render. The REF, below, stays out of this branch —
  // `react-hooks/refs` disallows writing one during render; a ref may only
  // be read or written from an effect or an event handler.
  const identityKey = `${artifactRoomId}:${artifactId}`;
  const [seededFor, setSeededFor] = useState(identityKey);
  if (identityKey !== seededFor) {
    setSeededFor(identityKey);
    setState(readCachedArtifactBody(artifactRoomId, artifactId) ?? LOADING);
  }
  useEffect(() => {
    const reseed = readCachedArtifactBody(artifactRoomId, artifactId);
    lastWrittenMarkdownRef.current = reseed?.kind === "ready" ? reseed.markdown : null;
  }, [artifactRoomId, artifactId]);

  useEffect(() => {
    // No registry to read — nothing to subscribe to. `registry === null` is
    // handled at render time below (the return statement), not by mirroring
    // it into `state` here: that would be exactly the "adjust state when a
    // prop changes" shape an Effect doesn't need for a value already
    // knowable during render.
    if (registry === null) return;

    let disposed = false;

    const recompute = (): void => {
      if (disposed) return;
      const roomState = registry.getState(artifactRoomId);
      if (roomState !== "ready") {
        const placeholder: ArtifactBodyState =
          roomState === "retrying" ? { kind: "retrying" } : { kind: "unavailable" };
        // While the host has never reported anything about this room (dead/
        // slow host, or hasn't got to it yet), don't downgrade an
        // already-`ready` cached render. The moment it HAS reported
        // anything real, honor it unconditionally — including a genuine
        // downgrade.
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
      // in here, on-demand — never from a static top-level import a
      // tree/list view could reach on initial load.
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
            message: err instanceof Error ? err.message : "Couldn't render this artifact.",
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

  return registry === null ? LOADING : state;
}
