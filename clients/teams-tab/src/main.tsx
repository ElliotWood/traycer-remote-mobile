import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { ErrorBoundary } from "./shell/error-boundary";

const root = document.getElementById("root");
if (root === null) throw new Error("#root missing from index.html");
createRoot(root).render(
  <StrictMode>
    {/*
      THE LAST RESORT, and the only boundary ABOVE `FluentProvider`.
      `App` renders the provider, the theme and the config gate, so a throw in
      any of them unmounts everything below this point — and below this point
      is the whole app. Without it that is a blank `<div id="root">`, which is
      what the tab did before.
    */}
    <ErrorBoundary label="Traycer">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
