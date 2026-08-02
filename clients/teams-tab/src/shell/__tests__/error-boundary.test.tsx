// @vitest-environment jsdom
/**
 * The FIRST render test in `clients/teams-tab`.
 *
 * The package ran vitest in a `node` environment collecting `.test.ts` files
 * only, so no `.tsx` test could have run even if one had been written — which
 * is why `shell-contract.test.ts` asserts against the shell's SOURCE TEXT and
 * says so in its own docblock. Source assertions were the only tool available.
 *
 * A boundary cannot be checked that way. "The file contains
 * `getDerivedStateFromError`" is exactly the hollow green check this epic keeps
 * finding: it passes against a boundary wired to nothing, wrapped around
 * nothing, or one whose fallback throws. The property is behavioural — a child
 * throws and the app does not go blank — so the environment had to change
 * before the test could mean anything.
 *
 * Follows `clients/mobile`'s precedent exactly rather than inventing a second
 * one: jsdom is opted into PER FILE by the docblock above, so the package's
 * existing node-environment logic tests are untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider, tokens, webLightTheme } from "@fluentui/react-components";
import { AppShell } from "../app-shell";
import { ErrorBoundary, FALLBACK_TOKEN_NAMES } from "../error-boundary";

// Testing Library's automatic cleanup hooks onto a global `afterEach`, which
// this suite does not expose (`globals` is unset). Registered by hand, as
// `clients/mobile/src/test-utils/dom.ts` does for the same reason.
afterEach(() => {
  cleanup();
});

function Throws({ message }: { readonly message: string }): never {
  throw new Error(message);
}

describe("ErrorBoundary", () => {
  /**
   * Every `console.error` argument list seen during a test.
   *
   * `clients/mobile`'s equivalent holds the spy in a
   * `ReturnType<typeof vi.spyOn>` variable, which cannot be copied here — this
   * package's new eslint config restricts `ReturnType`, and the config landing
   * is the reason this file exists. Collecting the calls into a plain array
   * needs no spy type at all, and reads better besides.
   */
  let logged: unknown[][] = [];

  beforeEach(() => {
    logged = [];
    // React logs every caught error to console.error itself — expected noise,
    // silenced here so it does not bury the real output.
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders its children when nothing throws", () => {
    render(
      <ErrorBoundary label="Traycer">
        <p>the app</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("the app")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("CONTROL: without the boundary the same throw escapes render", () => {
    // Without this, every assertion below would also pass against a component
    // that swallowed errors by accident, or against a `Throws` that did not
    // actually throw. It establishes that the child is hostile and that
    // catching it is the boundary's doing.
    expect(() => render(<Throws message="boom" />)).toThrow("boom");
  });

  it("catches a render throw and keeps something on screen", () => {
    render(
      <ErrorBoundary label="Traycer">
        <Throws message="boom" />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toBeTruthy();
    expect(screen.getByText("Something went wrong in Traycer.")).toBeTruthy();
    // The defect being fixed is a BLANK tab, so "the container is not empty"
    // is the assertion that actually tracks it.
    expect(document.body.textContent).not.toBe("");
  });

  it("shows the error message, because Teams has no console to read it in", () => {
    render(
      <ErrorBoundary label="Traycer">
        <Throws message="Cannot read properties of undefined (reading 'epicId')" />
      </ErrorBoundary>,
    );
    expect(
      screen.getByText("Cannot read properties of undefined (reading 'epicId')"),
    ).toBeTruthy();
  });

  it("omits the label from the copy when none is given", () => {
    render(
      <ErrorBoundary>
        <Throws message="boom" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong.")).toBeTruthy();
  });

  it("logs the error and the component stack for whoever attaches a debugger", () => {
    render(
      <ErrorBoundary label="Traycer">
        <Throws message="boom" />
      </ErrorBoundary>,
    );
    const line = logged.find((args) => args[0] === "[teams-tab]");
    expect(line).toBeTruthy();
    expect(line?.[1]).toBe("Traycer");
    // Stringified rather than asserted as an Error — this package restricts
    // type assertions, and `String(error)` is "Error: boom" regardless.
    expect(String(line?.[2])).toContain("boom");
  });

  it("Retry re-renders the subtree, so a transient throw recovers", () => {
    let shouldThrow = true;
    function Flaky(): ReactElement {
      if (shouldThrow) throw new Error("transient");
      return <p>recovered</p>;
    }
    render(
      <ErrorBoundary label="Traycer">
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();

    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(screen.getByText("recovered")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Reload re-fetches the app — the only way out of a bad bundle, and Teams has no address bar", () => {
    const reload = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload },
    });

    render(
      <ErrorBoundary label="Traycer">
        <Throws message="Failed to fetch dynamically imported module" />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: /reload/i }));
    expect(reload).toHaveBeenCalledTimes(1);

    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });
});

describe("the boundary is WIRED, not merely written", () => {
  /**
   * The gap this closes is named in this file's own docblock: every test above
   * passes against a boundary that is wrapped around nothing. A component that
   * catches errors it is never given is the hollow green check in its purest
   * form, and it is the failure mode with no symptom — the tab goes blank
   * exactly as before while a suite reports the boundary works.
   *
   * The first is behavioural. The second and third are SOURCE assertions, the
   * same tool `shell-contract.test.ts` uses and for the same stated reason:
   * rendering `App` needs the Teams SDK, a host connection and the config
   * gate, so what is cheaply checkable is that the two wrappers exist at the
   * two positions. Stated limit — they prove the wiring is written, not that
   * `App` survives a throw end to end. That is the screenshot's job.
   */
  const read = (rel: string): string =>
    readFileSync(join(import.meta.dirname, "..", "..", rel), "utf8");

  it("keeps the frame when the content inside it throws", () => {
    // The in-frame boundary's whole claim: lose the screen, keep the shell.
    // Composed exactly as `app.tsx` composes it.
    render(
      <FluentProvider theme={webLightTheme}>
        <AppShell leading={<span>Traycer</span>}>
          <ErrorBoundary label="this screen">
            <Throws message="boom" />
          </ErrorBoundary>
        </AppShell>
      </FluentProvider>,
    );
    // The header survived...
    expect(screen.getByText("Traycer")).toBeTruthy();
    // ...and so did the scrolling region, which is the frame proper.
    expect(document.querySelector('[data-shell-region="body"]')).toBeTruthy();
    // ...while the screen was replaced by the fallback.
    expect(screen.getByText("Something went wrong in this screen.")).toBeTruthy();
  });

  it("CONTRACT: main.tsx wraps App — the last resort, above FluentProvider", () => {
    const main = read("main.tsx");
    expect(main).toContain('import { ErrorBoundary } from "./shell/error-boundary"');
    expect(main).toMatch(/<ErrorBoundary[^>]*>[\s\S]*<App \/>[\s\S]*<\/ErrorBoundary>/);
  });

  it("CONTRACT: the shell() helper wraps content — ONE boundary, inside AppShell", () => {
    const app = read("app.tsx");
    expect(app).toContain('import { ErrorBoundary } from "./shell/error-boundary"');
    // Inside `AppShell`, not around it: outside would mean a content throw
    // takes the header with it, which is the property this position exists
    // to protect.
    expect(app).toMatch(
      /<AppShell[^>]*>[\s\S]*?<ErrorBoundary[^>]*>\{content\}<\/ErrorBoundary>[\s\S]*?<\/AppShell>/,
    );
    // And exactly one, so nobody "fixes" a screen by adding a twelfth
    // wrapper and quietly reintroduces the twelve-shells defect one layer
    // down.
    expect(app.match(/<ErrorBoundary/g)?.length).toBe(1);
  });
});

describe("the fallback survives a Fluent failure", () => {
  const SOURCE = readFileSync(
    join(import.meta.dirname, "..", "error-boundary.tsx"),
    "utf8",
  );

  it("CONTRACT: the boundary imports react and NOTHING else", () => {
    // The whole point of the plain-DOM fallback: a FluentProvider or theme
    // throw is one of the failures this must survive, and a Fluent fallback
    // would be taken down by the error it is reporting. This is a property of
    // the module graph, so the module graph is what gets asserted.
    //
    // The whole import LIST, not an absence of "@fluentui". A text search for
    // the package name failed against this very file, whose docblock names
    // Fluent in prose to explain the rule — a check that cannot tell an
    // import from an explanation of why there is no import. Asserting the
    // list also catches the next dependency, which is the real risk: nobody
    // adding an icon set will think to re-read a rule phrased about Fluent.
    const imported = [...SOURCE.matchAll(/^import[^;]*?from\s+"([^"]+)";/gm)].map(
      (match) => match[1],
    );
    expect(imported).toEqual(["react"]);
  });

  it("CONTROL: that import check can fail — it sees this test file's own imports", () => {
    // Without this the regex could match nothing at all and `toEqual([...])`
    // would be the only thing standing between a green test and a boundary
    // that imports the entire design system.
    const own = [
      ...readFileSync(import.meta.filename, "utf8").matchAll(
        /^import[^;]*?from\s+"([^"]+)";/gm,
      ),
    ].map((match) => match[1]);
    expect(own).toContain("@fluentui/react-components");
  });

  it("CONTRACT: every themed colour still resolves to a REAL Fluent token", () => {
    // Writing the CSS variables out by hand is what buys the no-import
    // property, and it trades an import error for silent drift: a Fluent
    // rename would leave the fallback permanently on its literal colour and
    // nothing would say so. Pinned against Fluent's own export, so a rename is
    // a red test.
    for (const name of FALLBACK_TOKEN_NAMES) {
      expect(tokens[name]).toBe(`var(--${name})`);
      // ...and the boundary references that same name, with a literal default.
      expect(SOURCE).toContain(`var(--${name}, `);
    }
  });
});
