/**
 * Mutation probe for the subpath-deploy history selection.
 *
 * The defect this guards against was live on the trunk and invisible to every
 * gate: `tsc -b` is clean, eslint is clean, and 10,852 gui-app tests pass with
 * it, because the whole failure is "which history object did the router get",
 * and nothing asserted on that. It surfaced only as a real bundle serving a
 * signed-out user `<p>Not Found</p>`.
 *
 * A predicate is the easiest thing here to test hollowly: `isSubpathDeploy()`
 * can be perfectly correct and read by nobody, which is exactly the shape of
 * this epic's `onOpenArtifact={() => {}}`. So every mutation below is required
 * to redden a NAMED test, and each also names a control that must STAY green —
 * a mutation where everything fails is a broken harness, not a caught defect.
 *
 * Not a gate — it edits `router.tsx` and restores it. It aborts rather than
 * proceeding if its target does not appear exactly once, because a mutation
 * that matched zero times is indistinguishable in a scroll-back from one the
 * tests caught.
 *
 *   node clients/gui-app/tools/mutate-subpath-router.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const TARGET = "clients/gui-app/src/router.tsx";
const SPEC = "src/__tests__/router.test.ts";

const PREDICATE_BODY =
  '  return import.meta.env.BASE_URL.replace(/\\/+$/, "") !== "";\n';
const CALL_SITE =
  "      return isSubpathDeploy() ? createHashHistory() : undefined;\n";

const FRAGMENT_TEST =
  "reads the route from the fragment when served from a subpath";
const ROOT_TEST = "ignores the fragment when served from the root";
const PREDICATE_TEST = "treats BASE_URL";

const MUTATIONS = [
  {
    id: "MUT-1",
    what: "the shipped defect verbatim — subpath deploys never get hash history",
    find: CALL_SITE,
    replace: "      return undefined;\n",
    mustRedden: [FRAGMENT_TEST],
    // The predicate rows still pass: this is precisely the "correct value,
    // nobody reads it" state, and it is why the fragment test has to exist.
    mustStayGreen: [ROOT_TEST, PREDICATE_TEST],
  },
  {
    id: "MUT-2",
    what: "hash history is applied EVERYWHERE, including the root deploy",
    find: CALL_SITE,
    replace: "      return createHashHistory();\n",
    mustRedden: [ROOT_TEST],
    mustStayGreen: [FRAGMENT_TEST],
  },
  {
    id: "MUT-3",
    what: "the trailing-slash strip is dropped, so `/` reads as a subpath",
    find: PREDICATE_BODY,
    replace: '  return import.meta.env.BASE_URL !== "";\n',
    // Reddens the predicate row for "/" AND the root control - the predicate
    // is wrong and the wrongness reaches the router, which is the pair that
    // says the two layers are actually connected.
    mustRedden: [PREDICATE_TEST, ROOT_TEST],
    mustStayGreen: [FRAGMENT_TEST],
  },
  {
    id: "MUT-4",
    what: "the predicate is inverted",
    find: PREDICATE_BODY,
    replace: '  return import.meta.env.BASE_URL.replace(/\\/+$/, "") === "";\n',
    mustRedden: [PREDICATE_TEST, FRAGMENT_TEST, ROOT_TEST],
    mustStayGreen: [],
  },
];

const original = readFileSync(TARGET, "utf8");
let failures = 0;

for (const m of MUTATIONS) {
  const occurrences = original.split(m.find).length - 1;
  if (occurrences !== 1) {
    console.error(
      `ABORT ${m.id}: target appears ${occurrences} times, expected exactly 1`,
    );
    failures += 1;
    continue;
  }

  writeFileSync(TARGET, original.replace(m.find, m.replace));

  // The workspace's own vitest entry, invoked through `node`. `npx vitest`
  // is NOT equivalent here: npx resolves against its own view of the tree and
  // reports a startup error, which reads in this probe's output exactly like
  // a suite that failed to catch the mutation.
  const run = spawnSync(
    process.execPath,
    ["../../node_modules/vitest/vitest.mjs", "run", SPEC, "--reporter=verbose"],
    { cwd: "clients/gui-app", encoding: "utf8", shell: false },
  );
  writeFileSync(TARGET, original);

  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const reddened = m.mustRedden.every((name) =>
    new RegExp(`[×x]\\s.*${escapeRe(name)}`).test(out),
  );
  const stayedGreen = m.mustStayGreen.every((name) =>
    new RegExp(`[✓v]\\s.*${escapeRe(name)}`).test(out),
  );

  if (reddened && stayedGreen) {
    console.log(`CAUGHT  ${m.id}  ${m.what}`);
  } else {
    failures += 1;
    console.log(
      `SURVIVED ${m.id}  ${m.what}  (reddened=${reddened} controlGreen=${stayedGreen})`,
    );
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (failures > 0) process.exitCode = 1;
console.log(`\n${MUTATIONS.length - failures}/${MUTATIONS.length} caught`);
