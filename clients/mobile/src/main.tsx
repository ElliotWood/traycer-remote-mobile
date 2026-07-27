import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppRoot } from "@/app-root";
import { ShowcaseView } from "@/views/showcase-view";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("missing #root element");
}

// Sprint 1 (M1/M2) proof surface: `?showcase=1` renders the kind-token +
// markdown-renderer showcase with NO auth/host dependency, so it stands alone
// as evidence of this sprint's substrate before Sprints 2-3 consume it.
const isShowcase = new URLSearchParams(window.location.search).get("showcase") === "1";

createRoot(container).render(
  <StrictMode>{isShowcase ? <ShowcaseView /> : <AppRoot />}</StrictMode>,
);
