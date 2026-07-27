/**
 * Thin lazy-loading façade over `mermaid`, scoped down from
 * `clients/gui-app/src/editor-core/nodes/mermaid/mermaid-service.ts` for the
 * mobile client: the desktop version tracks a live light/dark toggle via a
 * MutationObserver; the mobile client has no theme toggle (dark-first, fixed),
 * so this file hardcodes a dark palette derived from `views/ui.ts` and skips
 * the observer entirely.
 *
 * `import("mermaid")` only happens on first call to `ensureMermaidReady` — kept
 * out of the initial `vite build` chunk (contract M2 / rubric §5).
 */
import { colors } from "../ui";

type MermaidModule = (typeof import("mermaid"))["default"];

let readyPromise: Promise<MermaidModule> | null = null;

// Node fill/cluster fills need to read as distinct panels against the page
// background (#111) rather than the accidental "invisible dark-on-dark" the
// rubric calls out — a shade lighter than the page, not derived from a
// theme-variable sample (mobile has none).
const NODE_FILL = "#1c2a3a";
const NOTE_FILL = "#332b1a";
const CLUSTER_FILL = "#1a1a1a";

function buildThemeVariables(): Record<string, string> {
  return {
    background: colors.bg,
    primaryColor: NODE_FILL,
    primaryTextColor: colors.text,
    primaryBorderColor: colors.border,
    secondaryColor: CLUSTER_FILL,
    tertiaryColor: colors.bg,
    lineColor: colors.border,
    textColor: colors.text,
    mainBkg: NODE_FILL,
    nodeBorder: colors.border,
    clusterBkg: CLUSTER_FILL,
    clusterBorder: colors.border,
    titleColor: colors.text,
    edgeLabelBackground: colors.bg,
    noteBkgColor: NOTE_FILL,
    noteBorderColor: colors.border,
    noteTextColor: colors.text,
  };
}

/**
 * Lazy-load + initialize mermaid on first call; cached thereafter. A failed
 * import drops the cache so a later retry re-imports rather than replaying a
 * stuck rejection forever.
 */
export function ensureMermaidReady(): Promise<MermaidModule> {
  if (readyPromise !== null) return readyPromise;
  readyPromise = import("mermaid")
    .then((mod) => {
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
        themeVariables: buildThemeVariables(),
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
