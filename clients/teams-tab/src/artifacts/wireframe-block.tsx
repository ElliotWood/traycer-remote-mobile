/**
 * A ```wireframe fence, as a sandboxed auto-sizing iframe.
 *
 * WHAT THE EMBEDDED HTML CAN REACH — established before writing the fixture,
 * because a friendly wireframe would not have surfaced it:
 *
 *   `sandbox="allow-scripts"` WITHOUT `allow-same-origin` gives the document
 *   an OPAQUE ORIGIN. Its scripts run — wireframes are interactive and the
 *   height reporter needs to — but cannot reach the parent DOM, storage or
 *   cookies. So "it runs script" is contained rather than a new conversation.
 *
 *   It also CANNOT fight the Teams theme, for the same reason: a separate
 *   document at an opaque origin can neither read nor alter the parent's CSS.
 *   The isolation runs both ways.
 *
 * WHICH CREATES THE ONE REAL PROBLEM. Because the parent cannot style the
 * document, a wireframe that paints no background of its own renders on the
 * iframe ELEMENT's background — and an unstyled iframe is white. In dark or
 * high-contrast Teams that is a bright rectangle in a dark page. So the
 * element's background is a Fluent token, not a default.
 *
 * THIS COMPONENT CANNOT BE VERIFIED BY SCREENSHOT. Chromium does not
 * composite an OPAQUE-ORIGIN iframe into a `fullPage` capture, so the shoot
 * photographs an empty box however well the wireframe renders. The first
 * capture looked exactly like a broken component.
 *
 * The same sandboxing that contains the document hides it from the camera —
 * so the verification for this one element is a DOM assertion, not an image:
 *
 *   frames().length === 2
 *   frame.body.innerText === the wireframe's own text
 *
 * Confirmed that way on 2026-07-31: srcdoc 873 bytes, sandbox
 * "allow-scripts", body text "Reconnecting… / Queue held: 3 messages". The
 * IMAGE still proves the surrounding fix — the element's background follows
 * the theme instead of rendering white — which is the half a picture can show.
 *
 * The height message is validated by SOURCE first, then marker, then shape.
 * Source first matters here specifically: a Teams tab is itself in an iframe
 * and receives postMessages from the Teams SDK, so a marker-only check would
 * be reading frames from the host chrome.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";

const MIN_HEIGHT_PX = 200;
const MAX_HEIGHT_MULTIPLIER = 3;
/** Namespaced to this client — mobile has its own, and they must not cross. */
const HEIGHT_MESSAGE_MARKER = "traycer:teams-tab:wireframe:height:v1";
const DOCTYPE_PATTERN = /^\s*<!doctype(?:\s+[^>]*)?>/i;

const useStyles = makeStyles({
  frame: {
    display: "block",
    width: "100%",
    maxWidth: "100%",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    // See the docblock: an unstyled iframe is white, and the document inside
    // cannot inherit the theme.
    backgroundColor: tokens.colorNeutralBackground1,
  },
});

function heightReporterScript(): string {
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
  // The reporter goes AFTER any doctype: a script before it would put the
  // document into quirks mode, silently changing the wireframe's own layout.
  const doctype = DOCTYPE_PATTERN.exec(htmlContent)?.[0] ?? "";
  return `${doctype}${heightReporterScript()}${htmlContent.slice(doctype.length)}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function WireframeBlock({ code }: { code: string }): ReactElement {
  const styles = useStyles();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(MIN_HEIGHT_PX);

  useEffect(() => {
    setHeight(MIN_HEIGHT_PX);
    function onMessage(event: MessageEvent<unknown>): void {
      // SOURCE FIRST — see the docblock. In Teams this window also receives
      // SDK messages from the host chrome.
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data;
      if (typeof data !== "object" || data === null) return;
      if (!("marker" in data) || data.marker !== HEIGHT_MESSAGE_MARKER) return;
      if (!("height" in data) || !isFiniteNumber(data.height)) return;
      const viewport =
        typeof window === "undefined" ? MIN_HEIGHT_PX : window.innerHeight;
      // Clamped: a runaway document must not grow the tab without bound.
      setHeight(
        Math.max(
          MIN_HEIGHT_PX,
          Math.min(viewport * MAX_HEIGHT_MULTIPLIER, data.height),
        ),
      );
    }
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [code]);

  return (
    <iframe
      ref={frameRef}
      title="Wireframe preview"
      sandbox="allow-scripts"
      srcDoc={buildDocument(code)}
      className={styles.frame}
      style={{ height }}
    />
  );
}
