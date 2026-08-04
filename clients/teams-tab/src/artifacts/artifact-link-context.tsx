/**
 * "Open this artifact", available to any depth of the tree without threading a
 * callback through every intermediate layer.
 *
 * WHY A CONTEXT, when this package threads its host client as props
 * everywhere else. The consumers are the markdown ANCHOR renderer — buried
 * under ChatScreen → TranscriptView → BlockList → a block → ArtifactMarkdown →
 * react-markdown's own component map — and the `artifact_operation` card. The
 * anchor is the binding case: `ArtifactMarkdown` is reached from NINE call
 * sites in this package, so a prop would have to be added to all nine plus
 * every layer above them, and react-markdown's `components` map is the one
 * boundary a prop cannot cross at all. Mobile reached the same conclusion for
 * the same renderer and recorded it in `artifact-nav-context.tsx`.
 *
 * WHY THE EPIC ID IS AN ARGUMENT rather than baked into the provider: an
 * agent-authored link carries its OWN `epics/<id>/artifacts/...` path, and
 * that id is not necessarily the epic on screen. Binding the provider's epic
 * silently would turn a cross-epic link into a lookup against the wrong
 * registry — which finds nothing and renders as "this artifact does not
 * exist", a wrong answer that looks like a right one. The provider refuses a
 * foreign epic explicitly instead.
 *
 * THE INVARIANT THIS SEAM EXISTS TO HOLD, stated because it is easy to lose
 * while "simplifying": no path through it ever performs a real `<a href>`
 * navigation. Mobile's U1 fix records why on a phone — it reboots the SPA and
 * drops the nav stack. In a Teams personal tab the app IS an iframe with no
 * address bar and no back button, so a navigation that leaves the app leaves
 * the user with nothing to press. The failure is strictly worse here than on
 * the surface where it was originally fixed.
 */
import { createContext, useContext, type ReactElement, type ReactNode } from "react";

export interface ArtifactLinkValue {
  /**
   * Resolves an agent-authored on-disk artifact path to an artifact id.
   *
   * `null` means "no artifact answers to that path" — a real answer from the
   * host, or an inert provider. Either way the caller must degrade, never
   * navigate.
   */
  readonly resolveArtifact: (epicId: string, filePath: string) => Promise<string | null>;
  /** Opens an already-resolved artifact in-app. Returns `false` when it cannot. */
  readonly openArtifact: (epicId: string, artifactId: string) => boolean;
}

/**
 * Outside a provider — a unit test rendering one block, or the canvas route,
 * which holds no artifact screen to open into — resolving finds nothing and
 * opening reports that it did nothing.
 *
 * A no-op rather than a throw, matching mobile: a degraded harness must still
 * honour the never-navigate contract, and a throw inside react-markdown's
 * component map would take out the whole transcript to report a dead link.
 *
 * `openArtifact` returns `false` rather than `void` so the anchor can tell
 * "opened" from "did nothing" and say so. A silent no-op here is the shape
 * this epic keeps re-finding: the click appears to work, and nothing happens.
 */
const INERT: ArtifactLinkValue = {
  resolveArtifact: () => Promise.resolve(null),
  openArtifact: () => false,
};

const ArtifactLinkContext = createContext<ArtifactLinkValue | null>(null);

export function ArtifactLinkProvider({
  value,
  children,
}: {
  readonly value: ArtifactLinkValue;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <ArtifactLinkContext.Provider value={value}>{children}</ArtifactLinkContext.Provider>
  );
}

export function useArtifactLink(): ArtifactLinkValue {
  return useContext(ArtifactLinkContext) ?? INERT;
}
