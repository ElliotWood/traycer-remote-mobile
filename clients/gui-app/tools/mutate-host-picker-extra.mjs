/**
 * Mutation probe for the shell-supplied host-picker slot.
 *
 * A registration API is the easiest thing in this repo to test hollowly:
 * `registerHostPickerExtra` is a module-level setter, so a test that calls it
 * and reads `getHostPickerExtra()` back passes whether or not `<HostPicker />`
 * ever renders the result. This probe writes the two ways the consumer can be
 * wrong into the real source and requires a NAMED test to redden for each.
 *
 * Not a gate — it edits `host-picker.tsx` and restores it. It aborts rather
 * than proceeding if its target does not appear exactly once, because a
 * mutation that matched zero times is indistinguishable in a scroll-back from
 * one the tests caught.
 *
 *   node clients/gui-app/tools/mutate-host-picker-extra.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const TARGET = "clients/gui-app/src/components/layout/header/host-picker.tsx";
const SPEC =
  "src/components/layout/header/__tests__/host-picker-extra.test.tsx";

const SLOT = "        {getHostPickerExtra()}\n";
const LIST_OPEN = "        <HostPickerList\n";

const MUTATIONS = [
  {
    id: "MUT-1",
    what: "the slot is never rendered — registration silently dropped",
    find: SLOT,
    replace: "",
    mustRedden: ["renders a registered node, under the host list"],
    mustStayGreen: ["CONTROL: a shell that registers nothing"],
  },
  {
    id: "MUT-2",
    what: "the slot renders ABOVE the host list instead of under it",
    find: SLOT,
    replace: "",
    // Re-inserted before the list by the second edit below, so the node IS
    // rendered and only its position is wrong. Without this arm, a test that
    // merely asserted `getByTestId` would look load-bearing while saying
    // nothing about the placement the slot's docblock promises.
    hoistSlot: true,
    mustRedden: ["renders a registered node, under the host list"],
    mustStayGreen: ["CONTROL: a shell that registers nothing"],
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

  let mutated = original.replace(m.find, m.replace);
  if (m.hoistSlot === true) {
    // Put it back, but before the list — same node, wrong place.
    mutated = mutated.replace(LIST_OPEN, SLOT + LIST_OPEN);
  }
  writeFileSync(TARGET, mutated);

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
