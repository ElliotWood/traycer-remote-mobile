/**
 * Shared entry point for the phone client's React render tests (T4+).
 *
 * Testing Library's automatic per-test cleanup hooks onto a GLOBAL `afterEach`,
 * which this suite doesn't expose (`globals: false`). Importing this module
 * registers cleanup for the importing test file, and re-exports the Testing
 * Library surface so a render test pulls `render` / `screen` / `waitFor` / etc.
 * from one place. Import this only from a `*.test.tsx` file that has opted into
 * jsdom via a `// @vitest-environment jsdom` docblock — it reaches into the DOM.
 */
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

export * from "@testing-library/react";
