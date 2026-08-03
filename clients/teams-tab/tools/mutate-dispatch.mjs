/**
 * Mutation harness for the route-dispatch contract.
 *
 *     node tools/mutate-dispatch.mjs drop-a-case
 *
 * Applies one named mutation, ASSERTS IT LANDED (the pattern must match
 * exactly once, and the change must be readable back off disk), runs the
 * suite, and restores the file in a `finally`.
 *
 * The landed-check is the point. A mutation run has two silent failure modes
 * pointing opposite ways: an assertion that cannot redden, and a mutation that
 * never applied. The second prints GREEN — which is exactly what a correct
 * mutation run must not print — and is indistinguishable from the first at the
 * point of reading the result.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DELIBERATELY NOT WIRED TO ANY TARGET, AND THAT IS NOT THE `check-canvas-core`
 * MISTAKE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The canvas review's first finding was a drift checker that was correct and
 * invoked by nothing — an instrument that never runs, which reads exactly like
 * one that passes. Adding a second unwired script in the same package needs an
 * answer, so: **that one was a GATE and this is a PROBE.**
 *
 * A gate answers "is the tree good right now" and belongs on every run. This
 * writes to source files and restores them; running it inside `npm test` would
 * mutate a developer's working tree mid-build, and an interrupted run leaves a
 * corrupted file behind. It answers "do these four assertions still mean
 * something", which is a question asked when the assertions are written or
 * doubted, not on every commit.
 *
 * The distinction is only honest if the difference is real, so the test it
 * probes carries no dependency on this file, and this file is not required for
 * `route-dispatch-contract.test.ts` to be meaningful — it is what was used to
 * DEMONSTRATE that it is.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
const APP = join(ROOT, "src/app.tsx");
const ROUTE = join(ROOT, "src/router/route.ts");
const SCREEN = join(ROOT, "src/canvas/canvas-screen.tsx");
const CANVAS = join(ROOT, "src/canvas/tile-canvas.tsx");
const STRIP = join(ROOT, "src/canvas/tab-strip.tsx");
const HOOK = join(ROOT, "src/canvas/use-canvas.ts");
const PERSIST = join(ROOT, "src/canvas/canvas-persistence.ts");
const PANES = "src/canvas/__tests__/pane-controls.test.tsx";

const MUTATIONS = {
  "drop-a-case": {
    file: APP,
    from: 'case "waiting":',
    to: 'case "waiting" as string:',
    expect: "app.tsx cases every Route member",
  },
  "drop-the-never": {
    file: APP,
    from: "const unhandled: never = route;",
    to: "const unhandled = route;",
    expect: "the dispatch is a switch with a never default",
  },
  "reintroduce-the-if-chain": {
    file: APP,
    from: "  switch (route.name) {",
    to: '  if (route.name === "epics") return <div />;\n  switch (route.name) {',
    expect: "no `if (route.name ===` chain returns anywhere",
  },
  "canvas-prefix-match": {
    file: ROUTE,
    from: 'if (segments[2] === "canvas" && segments.length === 3) {',
    to: 'if (segments[2]?.startsWith("canvas") === true && segments.length === 3) {',
    expect: "a word merely starting with `canvas` is the epic, not the canvas",
  },
  "canvas-drop-length-check": {
    file: ROUTE,
    from: 'if (segments[2] === "canvas" && segments.length === 3) {',
    to: 'if (segments[2] === "canvas") {',
    expect: "a segment AFTER `canvas` is not the canvas",
  },
  "unattributed-empty-label": {
    file: SCREEN,
    from: 'emptyLabel="Nothing open yet — opening tabs from the epic lands next."',
    to: 'emptyLabel="Nothing open"',
    expect: "the empty state says WHY it is empty",
    suite: "src/canvas/__tests__/canvas-screen.test.tsx",
  },
  "drop-the-epic-name-fallback": {
    file: SCREEN,
    from: "const title = epicName ?? `Epic ${epicId.slice(0, 8)}`;",
    to: 'const title = epicName ?? "";',
    expect: "a deep link with no epic name shows a short id",
    suite: "src/canvas/__tests__/canvas-screen.test.tsx",
  },
  "new-tab-as-preview": {
    file: CANVAS,
    from: "              // an explicit \"give me a tab\".\n              preview: false,",
    to: "              preview: true,",
    expect: "makes the new tab active and permanent, not a preview",
    suite: PANES,
  },
  "both-splits-go-right": {
    file: STRIP,
    from: '            onSplit("bottom");',
    to: '            onSplit("right");',
    expect: "splitting down produces a VERTICAL group",
    suite: PANES,
  },
  "one-boolean-for-both-splits": {
    file: CANVAS,
    from: 'canSplitDown={canSplitPane(state, pane.id, "bottom")}',
    to: 'canSplitDown={canSplitPane(state, pane.id, "right")}',
    expect: "disables the refused direction and leaves the other one alone",
    suite: PANES,
  },
  "no-empty-canvas-recovery": {
    file: CANVAS,
    from: "          {props.onOpenFirst === undefined ? null : (",
    to: "          {true ? null : (",
    expect: "closing the LAST pane leaves a way back in",
    suite: PANES,
  },
  "blank-tile-without-host": {
    file: CANVAS,
    // Two call sites mint a blank tile (new tab, split), so the pattern
    // carries the following line to name ONE of them. The harness aborts on a
    // 2-match pattern rather than mutating both — which is how this was
    // caught, instead of a run that quietly changed more than it claimed.
    from: "tile: makeBlankTile(hostId),\n              paneId: pane.id,",
    to: 'tile: makeBlankTile(""),\n              paneId: pane.id,',
    expect: "binds the configured host onto the tile it mints",
    suite: PANES,
  },
  /*
   * THE ONE THAT MATTERS. Reverts `useCanvas` to the naive shape — a
   * `useState` initialiser and no handling of `epicId` changing — which is
   * what every reasonable person writes first and what silently writes epic
   * A's layout into epic B's key.
   */
  "naive-usestate-initialiser": {
    file: HOOK,
    from:
      "  let current = held;\n" +
      "  if (held.epicId !== epicId) {\n" +
      "    current = { epicId, state: load(epicId, storageFor) };\n" +
      "    setHeld(current);\n" +
      "  }",
    to: "  const current = held;",
    expect: "navigating A to B does not carry A's layout",
    suite: "src/canvas/__tests__/use-canvas.test.tsx",
  },
  "empty-string-for-no-epic": {
    file: HOOK,
    from: "  return epicId === null ? EMPTY_CANVAS : loadCanvas(storageFor(epicId));",
    to: '  return loadCanvas(storageFor(epicId ?? ""));',
    expect: "a route with no epic touches no key at all",
    suite: "src/canvas/__tests__/use-canvas.test.tsx",
  },
  "save-on-visit": {
    file: HOOK,
    from: "  const setState = useCallback(",
    to:
      "  useEffect(() => {\n" +
      "    if (epicId !== null) saveCanvas(storageFor(epicId), current.state);\n" +
      "  });\n" +
      "  const setState = useCallback(",
    expect: "does not rewrite storage merely because the canvas was visited",
    suite: "src/canvas/__tests__/use-canvas.test.tsx",
  },
  /*
   * The defence that had never been executed. Removing the read guard is the
   * boot failure this client would show in Teams and nowhere else.
   */
  "storage-read-unguarded": {
    file: PERSIST,
    from:
      "      try {\n" +
      "        return window.localStorage.getItem(key);\n" +
      "      } catch {\n" +
      "        return null;\n" +
      "      }",
    to: "      return window.localStorage.getItem(key);",
    expect: "a throwing PROPERTY ACCESS degrades to no stored layout",
    suite: "src/canvas/__tests__/browser-canvas-storage.test.ts",
  },
  "storage-write-unguarded": {
    file: PERSIST,
    from: "      try {\n        window.localStorage.setItem(key, value);\n      } catch {",
    to: "      window.localStorage.setItem(key, value);\n      if (false) try { } catch {",
    expect: "a throwing setItem - the quota case",
    suite: "src/canvas/__tests__/browser-canvas-storage.test.ts",
  },
  "break-the-union-parse": {
    file: ROUTE,
    from: '| { readonly name: "waiting" }',
    to: '| { readonly name: "waiting-RENAMED" }',
    expect: "parses the union rather than trusting a list written here",
  },
};

const name = process.argv[2];
const mutation = MUTATIONS[name];
if (mutation === undefined) {
  console.error(`unknown mutation: ${name}`);
  console.error(`known: ${Object.keys(MUTATIONS).join(", ")}`);
  process.exit(2);
}

const original = readFileSync(mutation.file, "utf8");

/*
 * Matching happens against an LF-NORMALISED copy.
 *
 * This tree checks out CRLF on Windows, so every multi-line pattern here
 * matched ZERO times and the harness aborted — correctly, and for a reason
 * that had nothing to do with the code under test. Worth the note because the
 * failure is indistinguishable from "the code you meant to mutate is not
 * there", and the tempting response to that is to weaken the pattern until it
 * matches something.
 *
 * The mutated file is written as LF; `original` is restored byte-for-byte in
 * the `finally`, so the working tree ends exactly as it started.
 */
const normalized = original.replace(/\r\n/g, "\n");

try {
  const occurrences = normalized.split(mutation.from).length - 1;
  if (occurrences !== 1) {
    // NOT a warning. A pattern matching zero times mutates nothing and the
    // suite then reports green about unmutated code; matching twice mutates
    // more than the mutation claims. Either way the run means nothing.
    console.error(
      `ABORT: pattern found ${occurrences} time(s), expected exactly 1:\n  ${mutation.from}`,
    );
    process.exit(3);
  }

  const mutated = normalized.replace(mutation.from, mutation.to);
  writeFileSync(mutation.file, mutated);

  // Read BACK from disk. Trusting the in-memory string would prove that
  // `String.replace` works, not that the file the runner loads has changed.
  const onDisk = readFileSync(mutation.file, "utf8");
  if (onDisk === original || !onDisk.includes(mutation.to)) {
    console.error("ABORT: mutation did not land on disk");
    process.exit(3);
  }
  console.log(`MUTATION LANDED [${name}]: ${mutation.from}  ->  ${mutation.to}`);
  console.log(`EXPECT TO REDDEN: "${mutation.expect}"`);

  try {
    execFileSync(
      process.execPath,
      [
        join(ROOT, "../../node_modules/vitest/vitest.mjs"),
        "run",
        // The suite that OWNS the assertion. Running the whole package would
        // still go red, and it would go red for a mutation that happened to
        // break something unrelated — a red you did not cause reads exactly
        // like the one you did.
        mutation.suite ?? "src/router",
      ],
      { stdio: "inherit", cwd: ROOT },
    );
    console.log(`RESULT [${name}]: GREEN — the assertion could not fail`);
  } catch {
    console.log(`RESULT [${name}]: RED — as intended`);
  }
} finally {
  writeFileSync(mutation.file, original);
  const restored = readFileSync(mutation.file, "utf8") === original;
  console.log(`restored: ${restored}`);
  if (!restored) process.exitCode = 4;
}
