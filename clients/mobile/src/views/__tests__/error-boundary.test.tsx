// @vitest-environment jsdom
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { render, screen } from "@/test-utils/dom";
import { ErrorBoundary } from "../error-boundary";

function Throws({ message }: { readonly message: string }): never {
  throw new Error(message);
}

describe("ErrorBoundary", () => {
  let consoleErrorSpy: MockInstance;

  beforeEach(() => {
    // React logs the caught error to console.error too — expected noise,
    // silenced so it doesn't fail the suite under a strict console reporter.
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("shows the generic retry fallback for an ordinary render error", () => {
    render(
      <ErrorBoundary label="this chat">
        <Throws message="boom" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong in this chat.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  it.each([
    "Failed to fetch dynamically imported module: https://example.com/assets/chat-view-OLD.js",
    "error loading dynamically imported module: https://example.com/assets/chat-view-OLD.js",
    "Importing a module script failed.",
    "Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of \"text/html\".",
  ])("shows the reload fallback for a chunk-load failure: %s", async (message) => {
    render(
      <ErrorBoundary label="this chat">
        <Throws message={message} />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/new version is available/i)).toBeTruthy();
    const reloadButton = screen.getByRole("button", { name: /reload/i });
    expect(reloadButton).toBeTruthy();
    // Does NOT show the generic "Retry" copy for this case — retrying a
    // React.lazy() import would just replay the same cached-rejected promise.
    expect(screen.queryByText(/something went wrong/i)).toBeNull();
  });

  it("reloads the page when the reload button is clicked", async () => {
    const reload = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload },
    });

    render(
      <ErrorBoundary label="this chat">
        <Throws message="Failed to fetch dynamically imported module: https://example.com/x.js" />
      </ErrorBoundary>,
    );
    await userEvent.click(screen.getByRole("button", { name: /reload/i }));
    expect(reload).toHaveBeenCalledTimes(1);

    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });
});
