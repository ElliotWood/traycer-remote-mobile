#!/usr/bin/env node
/**
 * Mutation probe for the Teams theme path. A PROBE, NOT A GATE: it writes to
 * source and restores it, so never run it on a dirty tree.
 *
 * WHY IT EXISTS. This path's failure mode is a tab that renders in the WRONG
 * COLOURS - which is a legitimate state, not an error. Nothing throws, no
 * request fails, `tsc` is happy, and the shipped defect (a documented `onTheme`
 * option with zero callers) sat behind a green suite because every test of the
 * shell drove `initializeTeamsHost` directly and never asked whether the entry
 * point called it that way. So "the suite is green" says very little here; what
 * says something is that each defect, reintroduced, reddens a test that NAMES
 * it.
 *
 * It spans TWO packages on purpose - the seam in `clients/gui-app` and the
 * shell plus entry point in `clients/mobile` - because the defect lived
 * precisely in the gap between them, which is the one place a package-scoped
 * probe cannot look.
 *
 * TWO GUARDS, in the idiom of `mutate-web-storage.mjs`:
 *
 *  - Each pattern must match EXACTLY ONCE. A drifted pattern matches zero
 *    times and would otherwise "pass" by mutating nothing.
 *  - An abort exits NON-ZERO and says ABORT, because an aborting probe and a
 *    passing one look identical in a scroll-back otherwise.
 *
 * Usage:  node tools/mutate-teams-theme.mjs      (from clients/mobile)
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const guiAppRoot = resolve(packageRoot, "../gui-app");
const VITEST = resolve(packageRoot, "../../node_modules/vitest/vitest.mjs");

const APPLIER = resolve(guiAppRoot, "src/lib/theme-applier.ts");
const HOST = resolve(packageRoot, "src/web/teams-host.ts");
const MAIN = resolve(packageRoot, "src/web/main.tsx");
const PARAM = resolve(packageRoot, "src/web/teams-theme-param.ts");

/** The two suites, each scoped to the file that owns the mutated behaviour. */
const SUITES = {
  applier: {
    cwd: guiAppRoot,
    args: ["run", "--config", "vitest.config.ts", "src/lib/__tests__/theme-applier.test.ts"],
  },
  teams: {
    cwd: packageRoot,
    args: [
      "run",
      "--config",
      "vitest.config.ts",
      "src/web/teams-host.test.ts",
      // The URL-parameter channel's own suite. Both run together because
      // `main.tsx` is the one file BOTH assert about, so a mutation there has
      // to be able to redden a named test in either.
      "src/web/teams-theme-param.test.ts",
    ],
  },
};

/**
 * `mustRedden` is the point of the whole file. A mutation that merely turns a
 * suite red proves the suite notices something; a mutation that reddens the
 * test written for it proves the test is about what it claims.
 */
const MUTATIONS = [
  {
    id: "MUT-1",
    file: APPLIER,
    suite: "applier",
    what: "the ambient signal ignores the host and reads the OS only — THE SHIPPED DEFECT, verbatim: a dark Teams client on a light OS renders a light tab",
    find: `  return hostThemeOverride ?? systemTheme;`,
    replace: `  return systemTheme;`,
    mustRedden:
      "applies the embedding host's dark theme when the user's preference is system",
  },
  {
    id: "MUT-2",
    file: APPLIER,
    suite: "applier",
    // NOT "the user's explicit choice gets overwritten" — that was this
    // mutation's first description and it was WRONG, which the probe caught by
    // reddening a different test. `resolve()` returns the explicit preference
    // whatever the ambient signal says, so removing this guard changes no
    // colour at all. What it changes is that every host theme push wakes every
    // subscriber for a value that did not move. See MUT-9 for the mutation
    // that DOES target the explicit-preference rows.
    what: "a host theme push wakes every subscriber even though the user's explicit preference means nothing resolved changed",
    find: `  if (useSettingsStore.getState().theme !== "system") return;\n  applyFromState();\n  notify();\n}`,
    replace: `  applyFromState();\n  notify();\n}`,
    mustRedden: "does not notify while the user's preference is explicit",
  },
  {
    id: "MUT-3",
    file: APPLIER,
    suite: "applier",
    // Same correction as MUT-2: `ambientTheme()` prefers the override, so the
    // COLOUR is unchanged by this and the DOM-asserting row stays green
    // correctly. The subscriber wake is the whole of what this guard buys.
    what: "an OS change re-applies and wakes every subscriber for a resolved theme the override has already fixed",
    find: `      if (hostThemeOverride !== null) return;\n`,
    replace: ``,
    mustRedden: "does not wake subscribers for an OS change the override outranks",
  },
  {
    id: "MUT-4",
    file: APPLIER,
    suite: "applier",
    what: "the unchanged-value early return is dropped, so every re-push of the same theme wakes every subscriber",
    find: `  if (next === hostThemeOverride) return;\n`,
    replace: ``,
    mustRedden:
      "notifies subscribers once per real change and not at all for a repeat",
  },
  {
    id: "MUT-5",
    file: APPLIER,
    suite: "applier",
    what: "getResolvedTheme keeps reading the OS while the DOM follows the host — the two readings of one fact silently disagree",
    find: `  return resolve(useSettingsStore.getState().theme, ambientTheme());`,
    replace: `  return resolve(useSettingsStore.getState().theme, systemTheme);`,
    mustRedden: "keeps getResolvedTheme in step with the document",
  },
  {
    id: "MUT-6",
    file: HOST,
    suite: "teams",
    what: "the decoder defaults unknown theme names to dark, blacking out a tab in a future light client",
    find: `  return theme === "dark" || theme === "contrast" ? "dark" : "light";`,
    replace: `  return theme === "default" || theme === "glass" ? "light" : "dark";`,
    mustRedden: "resolves an unrecognised future theme name to light, not dark",
  },
  {
    id: "MUT-7",
    file: HOST,
    suite: "teams",
    what: "high contrast resolves light, putting a light app inside Teams' black high-contrast client",
    find: `  return theme === "dark" || theme === "contrast" ? "dark" : "light";`,
    replace: `  return theme === "dark" ? "dark" : "light";`,
    mustRedden: "maps the high-contrast theme to dark, because it is black-backed",
  },
  {
    id: "MUT-8",
    file: MAIN,
    suite: "teams",
    what: "the entry point stops passing onTheme — THE SHIPPED DEFECT, verbatim: the shell decodes a theme that reaches nothing",
    find: `  void initializeTeamsHost({\n    onTheme: (theme) => {\n      setHostThemeOverride(teamsThemeToResolved(theme));\n    },\n  }).then((state) => {`,
    replace: `  void initializeTeamsHost({}).then((state) => {`,
    mustRedden: "passes an onTheme handler to initializeTeamsHost",
  },
  {
    id: "MUT-9",
    file: APPLIER,
    suite: "applier",
    what: "the ambient signal outranks the user's own explicit choice — the overreach the whole design exists to avoid, and the one MUT-2 was mistakenly written to target",
    find: `  return theme === "system" ? system : theme;`,
    replace: `  return system;`,
    mustRedden: "does NOT override an explicit light preference",
  },
  {
    id: "MUT-10",
    file: PARAM,
    suite: "teams",
    what: "the URL reader drops its closed list and accepts any value — so an UNSUBSTITUTED `{theme}` resolves to light and forces a light tab on a dark-Teams user, which is the shipped defect re-entered through its own fix",
    find: `  return TEAMS_THEME_NAMES.includes(value) ? value : null;`,
    replace: `  return value;`,
    mustRedden:
      "returns null for the UNSUBSTITUTED placeholder, which is the whole point",
  },
  {
    id: "MUT-11",
    file: MAIN,
    suite: "teams",
    // The mutation this whole feature is ABOUT, and the one every unit test in
    // the file passes over: the theme is still read, still decoded, still
    // applied, and still correct - just applied after the app has painted, so
    // the flash it was built to remove is back. Only the ordering row can see
    // it.
    what: "the URL theme is applied AFTER createRoot, so the tab still paints in the wrong colour first — the flash survives a green suite",
    edits: [
      {
        find: `  const urlTheme = resolveTeamsThemeParam(window.location.search);\n  if (urlTheme !== null) setHostThemeOverride(urlTheme);\n\n`,
        replace: ``,
      },
      {
        find: `    </StrictMode>,\n  );\n`,
        replace: `    </StrictMode>,\n  );\n\n  const urlTheme = resolveTeamsThemeParam(window.location.search);\n  if (urlTheme !== null) setHostThemeOverride(urlTheme);\n`,
      },
    ],
    mustRedden: "applies it BEFORE createRoot, which is the whole feature",
  },
  {
    id: "MUT-12",
    file: MAIN,
    suite: "teams",
    what: "the entry point never reads the URL at all — the pre-fix state, verbatim: the manifest substitutes a theme that reaches nothing",
    find: `  const urlTheme = resolveTeamsThemeParam(window.location.search);\n  if (urlTheme !== null) setHostThemeOverride(urlTheme);\n\n`,
    replace: ``,
    mustRedden:
      "resolves the theme from the URL and feeds it to the applier seam",
  },
];

function runSuite(name) {
  const suite = SUITES[name];
  try {
    const stdout = execFileSync(process.execPath, [VITEST, ...suite.args], {
      cwd: suite.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { failed: false, output: stdout };
  } catch (error) {
    return { failed: true, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

const pristine = new Map(
  [APPLIER, HOST, MAIN, PARAM].map((file) => [file, readFileSync(file, "utf8")]),
);

function restoreAll() {
  for (const [file, source] of pristine) writeFileSync(file, source);
}

function abort(message) {
  restoreAll();
  console.error(`ABORT: ${message}`);
  console.error("Source restored. This is NOT a pass.");
  process.exit(2);
}

// The control. A probe whose baseline is red measures nothing, and every
// "survivor" it then reports is a lie in the safe direction.
for (const name of Object.keys(SUITES)) {
  process.stdout.write(`control (unmutated) ${name} ... `);
  const control = runSuite(name);
  if (control.failed) abort(`the ${name} suite is RED before any mutation`);
  console.log("green");
}

const survivors = [];
for (const mutation of MUTATIONS) {
  const source = pristine.get(mutation.file);
  // One mutation may need SEVERAL edits: moving a call from before a line to
  // after it is a delete plus an insert, and it cannot be expressed as one
  // find/replace. Every edit keeps the exactly-once guard independently, so a
  // multi-edit mutation cannot half-apply and report a survivor
  // ("an alias treatment that never bound" is the failure being avoided).
  const edits = mutation.edits ?? [
    { find: mutation.find, replace: mutation.replace },
  ];

  let mutated = source;
  for (const [index, edit] of edits.entries()) {
    const occurrences = mutated.split(edit.find).length - 1;
    if (occurrences !== 1) {
      abort(
        `${mutation.id} edit ${index + 1}/${edits.length} matched ${occurrences} times, expected exactly 1. The source has drifted; fix the pattern.`,
      );
    }
    mutated = mutated.replace(edit.find, edit.replace);
  }

  writeFileSync(mutation.file, mutated);
  const result = runSuite(mutation.suite);
  writeFileSync(mutation.file, source);

  const namedTestReddened =
    result.failed && result.output.includes(mutation.mustRedden);

  if (namedTestReddened) {
    console.log(`${mutation.id} caught by "${mutation.mustRedden}"`);
  } else if (result.failed) {
    survivors.push(mutation);
    console.log(
      `${mutation.id} SUITE RED BUT WRONG TEST — "${mutation.mustRedden}" stayed green`,
    );
  } else {
    survivors.push(mutation);
    console.log(`${mutation.id} SURVIVED — ${mutation.what}`);
  }
}

restoreAll();
console.log(
  `\n${MUTATIONS.length - survivors.length}/${MUTATIONS.length} caught by their named test, ${survivors.length} survivors`,
);
process.exit(survivors.length === 0 ? 0 : 1);
