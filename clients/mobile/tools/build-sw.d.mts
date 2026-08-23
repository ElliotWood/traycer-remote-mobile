/**
 * Types for `build-sw.mjs`, which stays plain JS because it is a build script
 * the app never imports - `tsc` does not emit, so a `.ts` build tool would need
 * its own compile step to run.
 *
 * `sw.test.ts` imports it, and without this the whole suite is implicitly
 * `any`. That matters more than usual here: the test's entire value is that it
 * drives the REAL generator, so a signature drifting out from under it would be
 * silent.
 */

export interface GeneratedServiceWorker {
  /** Content-derived; changes exactly when the app changes. */
  readonly buildId: string;
  /** The injected list, sorted. */
  readonly precache: string[];
  /** The bytes written to `dist/web/sw.js`. */
  readonly text: string;
}

export declare function buildServiceWorkerText(
  mobileRoot: string,
  precache: readonly string[],
): Promise<GeneratedServiceWorker>;

export declare function generateServiceWorker(
  swJs: string,
  precache: readonly string[],
): GeneratedServiceWorker;
