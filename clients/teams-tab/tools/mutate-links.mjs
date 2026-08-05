/**
 * Mutation harness for the markdown link policy.
 *
 *     node tools/mutate-links.mjs external-without-target
 *
 * Applies one named mutation, ASSERTS IT LANDED (the pattern must match
 * exactly once, and the change must be readable back off disk), runs the
 * suite that owns the assertion, and restores the file in a `finally`.
 *
 * A PROBE, not a gate — same distinction `mutate-dispatch.mjs` states at
 * length and for the same reason: this writes to source and restores it, so
 * wiring it into `npm test` would mutate a working tree mid-build.
 *
 * WHY THIS ONE IS WORTH HAVING. Every branch of the link policy renders an
 * anchor that looks identical on screen, so the assertions all rest on
 * `defaultPrevented` and on attributes. That is precisely the kind of
 * assertion that can quietly stop meaning anything — an event dispatched
 * non-cancelable, a query that finds the wrong anchor, a `waitFor` that
 * resolves on the initial render. MUT-1 below reproduces the shipped defect
 * exactly, so if it ever prints GREEN the suite has stopped watching the thing
 * it was written for.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
const MD = join(ROOT, "src/artifacts/artifact-markdown.tsx");
const CTX = join(ROOT, "src/artifacts/artifact-link-context.tsx");
const LINKS = "src/artifacts/__tests__/artifact-markdown-links.test.tsx";

const MUTATIONS = {
  /*
   * MUT-1 — THE SHIPPED DEFECT, reproduced exactly. Every link in the tab was
   * a bare anchor with no `target`, so an external one replaced the app inside
   * Teams' iframe. If this prints GREEN the regression test is decorative.
   */
  "external-without-target": {
    file: MD,
    from: '      <a {...rest} href={href} target="_blank" rel="noopener noreferrer">',
    to: "      <a {...rest} href={href}>",
    expect: "an external link carries target=_blank and rel=noopener noreferrer",
    suite: LINKS,
  },
  /*
   * MUT-2 — the opposite error, and the reason the external branch has a
   * PAIRED assertion. Preventing the default everywhere also stops the iframe
   * being replaced, and silently breaks every external link in the product. A
   * suite that only checked "does not navigate" would call this a pass.
   */
  "prevent-every-click": {
    file: MD,
    from: "  if (EXTERNAL_URL_PATTERN.test(href)) {\n    return (\n      <a {...rest} href={href} target=\"_blank\" rel=\"noopener noreferrer\">",
    to: "  if (EXTERNAL_URL_PATTERN.test(href)) {\n    return (\n      <a {...rest} href={href} onClick={(e) => { e.preventDefault(); }} target=\"_blank\" rel=\"noopener noreferrer\">",
    expect: "an external link is still allowed to open",
    suite: LINKS,
  },
  /*
   * MUT-3 — the internal no-op branch falls through to a real navigation.
   * This is the branch that reads as least important: the href is not an
   * artifact and not external, so "let the browser have it" looks harmless.
   * It resolves against the tab's base, hits the SPA fallback, and lands the
   * reader on the epic list.
   */
  "internal-path-navigates": {
    file: MD,
    from: "  const onNoOpClick = (event: MouseEvent<HTMLAnchorElement>): void => {\n    event.preventDefault();\n  };",
    to: "  const onNoOpClick = (_event: MouseEvent<HTMLAnchorElement>): void => {};",
    expect: "a non-artifact internal path never navigates",
    suite: LINKS,
  },
  /*
   * MUT-4 — the artifact branch navigates instead of opening in-app. The
   * resolve still runs, so a test asserting only "resolveArtifact was called"
   * would pass.
   */
  "artifact-click-not-prevented": {
    file: MD,
    from: "    const onArtifactClick = (event: MouseEvent<HTMLAnchorElement>): void => {\n      event.preventDefault();",
    to: "    const onArtifactClick = (event: MouseEvent<HTMLAnchorElement>): void => {\n      void event;",
    expect: "an artifact link resolves in-app rather than navigating",
    suite: LINKS,
  },
  /*
   * MUT-5 — the epic id stops being parsed from the href and becomes the
   * whole href. Both arguments are strings, so nothing type-checks differently
   * and the call still happens; only a whole-argument assertion sees it.
   */
  "resolve-with-the-wrong-epic": {
    file: MD,
    from: "      resolveArtifact(layout.epicId, href)",
    to: "      resolveArtifact(href, href)",
    expect: "the epic id is parsed out of the path, not the path itself",
    suite: LINKS,
  },
  /*
   * MUT-6 — a refused open reports nothing. `openArtifact` returning false is
   * the foreign-epic and still-loading case; dropping the check leaves a click
   * that resolves, opens nothing, and says nothing. "The button did nothing",
   * which this epic's own standing requirements name as its most-repeated bug.
   */
  "silent-refusal": {
    file: MD,
    from: "          if (artifactId === null || !openArtifact(layout.epicId, artifactId)) {\n            setFailed(true);\n          }",
    to: "          if (artifactId === null) {\n            setFailed(true);\n            return;\n          }\n          openArtifact(layout.epicId, artifactId);",
    expect: "a refused open says so instead of doing nothing quietly",
    suite: LINKS,
  },
  /*
   * MUT-7 — the inert default becomes a success. Outside a provider the chat
   * transcript's artifact links would then swallow the click and claim to have
   * opened something.
   */
  "inert-default-claims-success": {
    file: CTX,
    from: "  openArtifact: () => false,",
    to: "  openArtifact: () => true,",
    expect: "with no provider the link reports it could not open",
    suite: LINKS,
  },
  /*
   * MUT-8 — the anchor goes back into the render body as an inline component.
   * This is the one that does NOT break a branch: every policy assertion still
   * passes, because the first render is correct. What breaks is state
   * SURVIVING a re-render, which is the only way the "couldn't open" message
   * reaches a reader. It is the mutation most likely to be made by someone
   * tidying, and the least likely to be noticed.
   *
   * FIRST WRITTEN AS `components={{ ...COMPONENTS }}` AND THAT WAS WRONG —
   * recorded because the mistake is instructive and the corrected probe would
   * otherwise read as though it had always been right. Spreading the map makes
   * a new OBJECT each render but leaves `AnchorRenderer` the same function, and
   * React reconciles by component identity, not by the identity of the map it
   * was looked up in. So that mutation preserved behaviour exactly, the suite
   * stayed green, and the green was correct — a surviving mutant that was a
   * fact about the mutation rather than about the tests.
   */
  "anchor-defined-inline": {
    file: MD,
    from: "        components={COMPONENTS}",
    to: "        components={{ ...COMPONENTS, a: (p) => <AnchorRenderer {...p} /> }}",
    expect: "the anchor keeps its state across a re-render",
    suite: LINKS,
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
 * Matching happens against an LF-NORMALISED copy — this tree checks out CRLF
 * on Windows, so every multi-line pattern would otherwise match ZERO times and
 * abort for a reason that has nothing to do with the code under test. The
 * `finally` restores `original` byte-for-byte.
 */
const normalized = original.replace(/\r\n/g, "\n");

try {
  const occurrences = normalized.split(mutation.from).length - 1;
  if (occurrences !== 1) {
    console.error(
      `ABORT: pattern found ${occurrences} time(s), expected exactly 1:\n  ${mutation.from}`,
    );
    process.exit(3);
  }

  const mutated = normalized.replace(mutation.from, mutation.to);
  writeFileSync(mutation.file, mutated);

  // Read BACK from disk — trusting the in-memory string would prove that
  // `String.replace` works, not that the file the runner loads has changed.
  const onDisk = readFileSync(mutation.file, "utf8");
  if (onDisk === original || !onDisk.includes(mutation.to)) {
    console.error("ABORT: mutation did not land on disk");
    process.exit(3);
  }
  console.log(`MUTATION LANDED [${name}]`);
  console.log(`EXPECT TO REDDEN: "${mutation.expect}"`);

  try {
    execFileSync(
      process.execPath,
      [join(ROOT, "../../node_modules/vitest/vitest.mjs"), "run", mutation.suite],
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
