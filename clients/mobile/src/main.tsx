import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { AppRoot } from "@/app-root";
import "./global.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("missing #root element");
}

// Sprint 1 (M1/M2) proof surface: `?showcase=1` renders the kind-token +
// markdown-renderer showcase with NO auth/host dependency, so it stands alone
// as evidence of this sprint's substrate before Sprints 2-3 consume it.
const isShowcase = new URLSearchParams(window.location.search).get("showcase") === "1";

// Perf batch 2 (B2-2): was a static top-level import — a back-door into the
// markdown stack (mobile-markdown.tsx et al.) for the overwhelming majority
// of real sessions that never hit `?showcase=1`, and one that would have
// silently defeated B2-2's chat/artifact-body lazy-routing below (the
// markdown stack would still be in the eager bundle via THIS import, no
// matter how many other routes stopped statically importing it).
const ShowcaseView = lazy(() =>
  import("@/views/showcase-view").then((mod) => ({ default: mod.ShowcaseView })),
);

createRoot(container).render(
  <StrictMode>
    {isShowcase ? (
      <Suspense fallback={null}>
        <ShowcaseView />
      </Suspense>
    ) : (
      <AppRoot />
    )}
  </StrictMode>,
);
