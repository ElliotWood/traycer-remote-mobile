/**
 * @vitest-environment jsdom
 *
 * The link policy in `artifact-markdown.tsx`.
 *
 * WHAT THESE ASSERT ON, and why it is not what renders. Every branch of the
 * policy renders an `<a>` that LOOKS THE SAME — same text, same styling, same
 * place on screen. The thing that decides whether a click destroys the user's
 * Teams tab is invisible: whether the default action was prevented, and
 * whether `target` was set. So every assertion here is on the click mechanism
 * and the anchor's attributes, never on the screen.
 *
 * jsdom does not navigate, so "the app is still mounted afterwards" would pass
 * against the shipped defect too. It is exactly the shape the parity contract
 * warns about — a defect that lands in a legitimate-looking state — and the
 * only observer that can tell the two apart is the anchor itself.
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { ReactElement, ReactNode } from "react";
import { ArtifactMarkdown } from "../artifact-markdown";
import {
  ArtifactLinkProvider,
  useArtifactLink,
  type ArtifactLinkValue,
} from "../artifact-link-context";

afterEach(() => {
  cleanup();
});

/**
 * A real artifact path of the shape agents actually emit, and the shape
 * `deriveArtifactPathLayoutRootAgnostic` recognises.
 */
const EPIC_ID = "9c9ddaf0-99ce-412a-b4b8-49e0b1d8a4ef";
const ARTIFACT_HREF = `/home/u/.traycer/epics/${EPIC_ID}/artifacts/rollout/index.md`;

/**
 * `null` means "rendered with no provider" — the real configuration on the
 * chat route, not just a test shorthand. Spelled as an explicit argument
 * rather than an optional parameter because this package bans those, and
 * because the provider-less case is one the tests deliberately exercise
 * rather than one they happen to omit.
 */
function renderMarkdown(body: string, value: ArtifactLinkValue | null): void {
  const inner: ReactElement = <ArtifactMarkdown body={body} />;
  const wrapped: ReactNode =
    value === null ? (
      inner
    ) : (
      <ArtifactLinkProvider value={value}>{inner}</ArtifactLinkProvider>
    );
  render(<FluentProvider theme={webLightTheme}>{wrapped}</FluentProvider>);
}

function anchor(name: string): HTMLAnchorElement {
  return screen.getByRole("link", { name }) as HTMLAnchorElement;
}

/**
 * Dispatches a real, cancelable click and reports whether the default was
 * prevented — i.e. whether the browser would have navigated.
 *
 * `fireEvent.click` returns exactly this, but going through a constructed
 * event keeps the cancelable-ness explicit: a non-cancelable event reports
 * `defaultPrevented: false` no matter what the handler does, which would make
 * every one of these assertions pass for the wrong reason.
 */
function clickAndReportNavigation(element: HTMLElement): boolean {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return !event.defaultPrevented;
}

describe("artifact markdown — link policy", () => {
  describe("external links", () => {
    it("opens in a new tab instead of replacing the app in Teams' iframe", () => {
      renderMarkdown("See [the docs](https://example.com/guide).", null);
      const link = anchor("the docs");

      // THIS IS THE REGRESSION TEST FOR THE SHIPPED DEFECT. Before the policy
      // this anchor had no `target`, so the click loaded example.com into the
      // iframe the tab is, in a frame with no address bar to get back from.
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    });

    it("is not turned into a no-op — an external link must still work", () => {
      renderMarkdown("See [the docs](https://example.com/guide).", null);
      // Paired with the assertion above deliberately. Preventing the default
      // on every anchor would also stop the iframe being replaced, and would
      // silently break every external link in the product. The policy has to
      // let this one through.
      expect(clickAndReportNavigation(anchor("the docs"))).toBe(true);
    });
  });

  describe("internal paths that are not artifacts", () => {
    it("never navigates — it would land the reader on the epic list", () => {
      renderMarkdown("Edited [src/foo.ts](src/foo.ts) today.", null);
      expect(clickAndReportNavigation(anchor("src/foo.ts"))).toBe(false);
    });
  });

  describe("hrefs that cannot load a page", () => {
    it("leaves mailto: to the mail client", () => {
      renderMarkdown("Mail [us](mailto:someone@example.com).", null);
      const link = anchor("us");
      expect(link.getAttribute("target")).toBeNull();
      expect(clickAndReportNavigation(link)).toBe(true);
    });

    it("leaves a same-document fragment alone", () => {
      renderMarkdown("Jump to [the section](#somewhere).", null);
      expect(clickAndReportNavigation(anchor("the section"))).toBe(true);
    });
  });

  describe("artifact links", () => {
    it("resolves the path and opens the artifact in-app", async () => {
      const resolveArtifact = vi.fn().mockResolvedValue("artifact-7");
      const openArtifact = vi.fn().mockReturnValue(true);
      renderMarkdown(`Read [the plan](${ARTIFACT_HREF}).`, {
        resolveArtifact,
        openArtifact,
      });

      expect(clickAndReportNavigation(anchor("the plan"))).toBe(false);

      // Whole-argument assertions: the epic id is parsed out of the href, and
      // the FULL href goes to the host as the path. Asserting only that it was
      // called would pass with either argument wrong.
      await waitFor(() => {
        expect(resolveArtifact).toHaveBeenCalledWith(EPIC_ID, ARTIFACT_HREF);
      });
      await waitFor(() => {
        expect(openArtifact).toHaveBeenCalledWith(EPIC_ID, "artifact-7");
      });
    });

    it("says so when the host resolves no artifact", async () => {
      const openArtifact = vi.fn().mockReturnValue(true);
      renderMarkdown(`Read [the plan](${ARTIFACT_HREF}).`, {
        resolveArtifact: () => Promise.resolve(null),
        openArtifact,
      });

      clickAndReportNavigation(anchor("the plan"));

      expect(await screen.findByText(/couldn't open that artifact/)).toBeTruthy();
      // The message must not be cover for having opened something anyway.
      expect(openArtifact).not.toHaveBeenCalled();
    });

    it("says so when the artifact resolves but this screen cannot open it", async () => {
      // The foreign-epic and still-loading cases both arrive here, as
      // `openArtifact` returning false. Without this branch the click would
      // resolve, do nothing, and report success by saying nothing at all —
      // "the button did nothing", which this epic has produced three times.
      renderMarkdown(`Read [the plan](${ARTIFACT_HREF}).`, {
        resolveArtifact: () => Promise.resolve("artifact-7"),
        openArtifact: () => false,
      });

      clickAndReportNavigation(anchor("the plan"));

      expect(await screen.findByText(/couldn't open that artifact/)).toBeTruthy();
    });

    it("says so when the resolve request fails outright", async () => {
      renderMarkdown(`Read [the plan](${ARTIFACT_HREF}).`, {
        resolveArtifact: () => Promise.reject(new Error("socket closed")),
        openArtifact: () => true,
      });

      clickAndReportNavigation(anchor("the plan"));

      expect(await screen.findByText(/couldn't open that artifact/)).toBeTruthy();
    });

    it("still refuses to navigate with no provider at all", async () => {
      // The chat transcript renders through this component on a sibling route
      // that holds no artifact screen, so this is a REAL configuration and not
      // just a test convenience. The never-navigate contract has to hold in
      // the degraded case too — that is the whole reason the default is inert
      // rather than absent.
      renderMarkdown(`Read [the plan](${ARTIFACT_HREF}).`, null);

      expect(clickAndReportNavigation(anchor("the plan"))).toBe(false);
      expect(await screen.findByText(/couldn't open that artifact/)).toBeTruthy();
    });
  });

  describe("the inert default", () => {
    /*
     * ASSERTED DIRECTLY, and the mutation probe is why. Through the renderer
     * the two inert members mask each other — `resolveArtifact` answers `null`
     * first, so `openArtifact` is never reached and its return value cannot be
     * observed from any anchor. Making `openArtifact` claim success there
     * changed nothing on screen and every test stayed green.
     *
     * The contract is still real: the `artifact_operation` card resolves
     * nothing and calls `openArtifact` directly, so a default that reports
     * success would give that card a button that quietly does nothing. Pinned
     * here, at the layer where it is visible at all.
     */
    it("resolves nothing and reports that it opened nothing", async () => {
      const { result } = renderHook(() => useArtifactLink());

      expect(await result.current.resolveArtifact(EPIC_ID, ARTIFACT_HREF)).toBeNull();
      expect(result.current.openArtifact(EPIC_ID, "artifact-7")).toBe(false);
    });
  });

  describe("the components map", () => {
    /*
     * The message must survive a re-render, and a re-render is the normal
     * case: any state change above this component produces one.
     *
     * This is the assertion that catches an `a:` entry written as an INLINE
     * arrow in the render body. That gives react-markdown a new component
     * identity every render, so React unmounts the anchor and remounts it —
     * discarding `failed`, and with it the only report the reader ever gets
     * that the link did not open. Nothing else here can see that: the first
     * render is correct, so every other assertion passes.
     */
    it("keeps the failure message across a re-render", async () => {
      const body = `Read [the plan](${ARTIFACT_HREF}).`;
      const { rerender } = render(
        <FluentProvider theme={webLightTheme}>
          <ArtifactMarkdown body={body} />
        </FluentProvider>,
      );

      clickAndReportNavigation(anchor("the plan"));
      expect(await screen.findByText(/couldn't open that artifact/)).toBeTruthy();

      rerender(
        <FluentProvider theme={webLightTheme}>
          <ArtifactMarkdown body={body} />
        </FluentProvider>,
      );

      expect(screen.getByText(/couldn't open that artifact/)).toBeTruthy();
    });

    it("keeps rendering fences and tables after the components map moved", () => {
      // The components map was hoisted to module scope in the same change.
      // A hoist that dropped the `code` entry would be invisible to every
      // assertion above.
      renderMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```\nplain fence\n```\n", null);
      expect(screen.getByText("plain fence")).toBeTruthy();
      expect(screen.getAllByRole("table").length).toBe(1);
    });
  });
});
