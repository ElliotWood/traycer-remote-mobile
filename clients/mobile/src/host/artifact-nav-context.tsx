/**
 * Cross-cutting "open this artifact" navigation, provided once at
 * `app-shell.tsx`'s root so deeply-nested consumers (the markdown renderer's
 * anchor handler, buried under ChatView/BlockList/TextBlock; the
 * `artifact_operation` card) can push the top-level `artifact` nav route
 * without threading a callback through every intermediate layer — mirrors
 * why `current-epic-context.tsx` uses a context rather than props.
 *
 * U1 fix: an artifact reference must never fall through to a real `<a href>`
 * navigation (that reboots the whole SPA) — every artifact-opening surface
 * routes through this one function instead.
 */
import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from "react";
import type { Dispatch } from "react";
import type { NavAction } from "@/router/nav";

export interface ArtifactNavValue {
  readonly openArtifact: (epicId: string, artifactId: string) => void;
}

const ArtifactNavContext = createContext<ArtifactNavValue | null>(null);

export function ArtifactNavProvider({
  dispatch,
  children,
}: {
  readonly dispatch: Dispatch<NavAction>;
  readonly children: ReactNode;
}): ReactElement {
  const value = useMemo<ArtifactNavValue>(
    () => ({
      openArtifact: (epicId, artifactId) => {
        dispatch({ type: "open-artifact", epicId, artifactId });
      },
    }),
    [dispatch],
  );
  return <ArtifactNavContext.Provider value={value}>{children}</ArtifactNavContext.Provider>;
}

/** Outside a provider (e.g. a unit test rendering a block in isolation), opening an artifact is a safe no-op rather than a throw — matches the "never a full page load" contract even in a degraded harness. */
export function useArtifactNav(): ArtifactNavValue {
  const ctx = useContext(ArtifactNavContext);
  return ctx ?? { openArtifact: () => {} };
}
