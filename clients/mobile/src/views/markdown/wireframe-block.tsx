/**
 * Renders a ` ```wireframe ` fence as a sandboxed, auto-sizing preview iframe.
 * Scoped down from `clients/gui-app/src/editor-core/nodes/wireframe/wireframe-iframe.tsx`'s
 * `auto` mode: the manual drag-resize handle / fullscreen dialog are desktop-only
 * affordances the contract explicitly does not port (rubric §1/§2 flags
 * hover/drag-only chrome as a touch smell).
 *
 * `sandbox="allow-scripts"` WITHOUT `allow-same-origin` gives the document an
 * opaque origin: its scripts can run (wireframe interactions + the height
 * reporter below) but cannot reach the parent DOM, storage, or cookies.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { colors } from "../ui";

const MIN_HEIGHT_PX = 200;
const MAX_HEIGHT_MULTIPLIER = 3;
const HEIGHT_MESSAGE_MARKER = "traycer:mobile:wireframe:height:v1";
const DOCTYPE_PATTERN = /^\s*<!doctype(?:\s+[^>]*)?>/i;

function buildHeightReporterScript(): string {
  return `<script>(() => {
  const report = () => {
    const body = document.body;
    const height = Math.max(
      body ? body.scrollHeight : 0,
      document.documentElement.scrollHeight,
    );
    window.parent.postMessage({ marker: "${HEIGHT_MESSAGE_MARKER}", height }, "*");
  };
  const start = () => {
    const observer = new ResizeObserver(report);
    if (document.body) observer.observe(document.body);
    observer.observe(document.documentElement);
    report();
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
})();</script>`;
}

function buildDocument(htmlContent: string): string {
  const doctype = DOCTYPE_PATTERN.exec(htmlContent)?.[0] ?? "";
  return `${doctype}${buildHeightReporterScript()}${htmlContent.slice(doctype.length)}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export interface WireframeBlockProps {
  readonly code: string;
}

export function WireframeBlock({ code }: WireframeBlockProps): ReactElement {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(MIN_HEIGHT_PX);

  useEffect(() => {
    setHeight(MIN_HEIGHT_PX);

    function onMessage(event: MessageEvent<unknown>): void {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data;
      if (typeof data !== "object" || data === null) return;
      if (!("marker" in data) || data.marker !== HEIGHT_MESSAGE_MARKER) return;
      if (!("height" in data) || !isFiniteNumber(data.height)) return;
      const viewportHeight = typeof window === "undefined" ? MIN_HEIGHT_PX : window.innerHeight;
      const clamped = Math.max(
        MIN_HEIGHT_PX,
        Math.min(viewportHeight * MAX_HEIGHT_MULTIPLIER, data.height),
      );
      setHeight(clamped);
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [code]);

  return (
    <iframe
      ref={frameRef}
      data-testid="wireframe-frame"
      title="Wireframe preview"
      sandbox="allow-scripts"
      srcDoc={buildDocument(code)}
      style={{
        display: "block",
        width: "100%",
        maxWidth: "100%",
        height,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        background: "#fff",
      }}
    />
  );
}
