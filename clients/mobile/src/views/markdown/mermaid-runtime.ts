/**
 * Thin lazy-loading façade over `mermaid`, scoped down from
 * `clients/gui-app/src/editor-core/nodes/mermaid/mermaid-service.ts` for the
 * mobile client: the desktop version tracks a live light/dark toggle via a
 * MutationObserver; the mobile client has no theme toggle (dark-first, fixed),
 * so this file skips the observer entirely — but still samples the LIVE
 * `traycer-green` palette off the DOM (via `resolveCssColor`) rather than
 * hardcoding it, same as desktop, and for the same reason: see `css-color.ts`.
 *
 * `import("mermaid")` only happens on first call to `ensureMermaidReady` — kept
 * out of the initial `vite build` chunk (contract M2 / rubric §5). Perf batch
 * 2 (B2-1): `./css-color` (and therefore culori's full parser registry) is
 * ALSO loaded via `import()` here now, not a static top-level import — a
 * static import would still drag culori into the eager bundle regardless of
 * `mermaid` itself being lazy, since `mobile-markdown.tsx` statically
 * imports this file's sibling `mermaid-block.tsx`. Measured −15,010 gzip
 * bytes off the entry chunk from this one change.
 */
type MermaidModule = (typeof import("mermaid"))["default"];

let readyPromise: Promise<MermaidModule> | null = null;

// Fallbacks mirror the `.dark[data-theme="traycer-green"]` block in
// `global.css` — the theme this app always renders in — so a jsdom test (no
// real stylesheet applied) still gets a sensible, on-brand palette.
const FALLBACK_BACKGROUND = "#121715";
const FALLBACK_FOREGROUND = "#ffffff";
const FALLBACK_BORDER = "#33433d";
const FALLBACK_MUTED = "#1a2421";

async function buildThemeVariables(): Promise<Record<string, string>> {
  const { resolveCssColor } = await import("./css-color");
  const background = resolveCssColor("--background", FALLBACK_BACKGROUND);
  const foreground = resolveCssColor("--foreground", FALLBACK_FOREGROUND);
  const border = resolveCssColor("--border", FALLBACK_BORDER);
  // Node/cluster/note fills read as distinct panels against the page
  // background rather than the "invisible dark-on-dark" the rubric calls
  // out — `--muted` (the same "distinct panel" surface design-tokens.tsx
  // uses elsewhere) does that job without hand-picking a shade.
  const panelFill = resolveCssColor("--muted", FALLBACK_MUTED);
  return {
    background,
    primaryColor: panelFill,
    primaryTextColor: foreground,
    primaryBorderColor: border,
    secondaryColor: panelFill,
    tertiaryColor: background,
    lineColor: border,
    textColor: foreground,
    mainBkg: panelFill,
    nodeBorder: border,
    clusterBkg: panelFill,
    clusterBorder: border,
    titleColor: foreground,
    edgeLabelBackground: background,
    noteBkgColor: panelFill,
    noteBorderColor: border,
    noteTextColor: foreground,
  };
}

/**
 * Lazy-load + initialize mermaid on first call; cached thereafter. A failed
 * import drops the cache so a later retry re-imports rather than replaying a
 * stuck rejection forever.
 */
export function ensureMermaidReady(): Promise<MermaidModule> {
  if (readyPromise !== null) return readyPromise;
  readyPromise = Promise.all([import("mermaid"), buildThemeVariables()])
    .then(([mod, themeVariables]) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        // Untrusted content (chat/artifact bodies) — no click-handlers, no
        // arbitrary HTML labels.
        securityLevel: "strict",
        // Without this, mermaid injects an "error diagram" SVG into a
        // temporary body-level div BEFORE rethrowing on a syntax error, and
        // only cleans it up on the success path. Streaming/incomplete fences
        // would otherwise leak orphan error divs into the page (mirrors the
        // desktop `mermaid-service.ts` fix for the same upstream bug).
        suppressErrorRendering: true,
        theme: "base",
        themeVariables,
        fontFamily: "system-ui, sans-serif",
      });
      return mermaid;
    })
    .catch((err: unknown) => {
      readyPromise = null;
      throw err;
    });
  return readyPromise;
}

let renderCounter = 0;

/**
 * Render mermaid source to an SVG string. `id` must be unique per call
 * (mermaid roots the SVG under it) — a monotonic counter suffices since the
 * mobile client never renders two diagrams from the same tick.
 */
export async function renderMermaidSvg(code: string): Promise<string> {
  const mermaid = await ensureMermaidReady();
  renderCounter += 1;
  const id = `mobile-mermaid-${renderCounter}`;
  try {
    const { svg } = await mermaid.render(id, code);
    return svg;
  } catch (err) {
    sweepStrandedContainers(id);
    throw err;
  }
}

/**
 * Defense-in-depth: remove any stranded measurement/error containers mermaid
 * left in `document.body` despite `suppressErrorRendering`.
 */
function sweepStrandedContainers(id: string): void {
  if (typeof document === "undefined") return;
  document.getElementById(`d${id}`)?.remove();
  document.getElementById(`i${id}`)?.remove();
}

export function deriveMermaidErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Failed to render diagram";
}
