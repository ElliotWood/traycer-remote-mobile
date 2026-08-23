/**
 * A PROBE, NOT A GATE. It writes to source and restores; it is not wired into
 * CI and must not be. Run it by hand:
 *
 *   node tools/mutate-external-link.mjs
 *
 * Each mutation names the test that MUST redden. A mutation caught by "the
 * suite went red somewhere" is not caught in the sense that matters - it tells
 * you nothing about whether the assertion you believe covers a behaviour is the
 * one doing the work. This epic has twice found a row literally named after a
 * property that was in fact green while the property was broken.
 *
 * Every mutation aborts unless its pattern matches EXACTLY ONCE. A probe whose
 * pattern silently matches zero times reports a pass it never measured, and an
 * aborting probe and a passing one look identical in a scroll-back - which is
 * how a broken probe survived in this package before.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MODULE = join(ROOT, "src", "web", "external-link.ts");
const SHIM = join(ROOT, "src", "web", "capacitor-web-shim.ts");
const HOST = join(ROOT, "src", "web", "teams-host.ts");
const MAIN = join(ROOT, "src", "web", "main.tsx");

const MUTATIONS = [
  {
    id: "MUT-1",
    why: "the shipped defect, exactly: the shim opens its own window again",
    file: SHIM,
    from: "await openExternalUrl({ url: options.url });",
    to: 'window.open(options.url, "_blank", "noopener,noreferrer");',
    catcher: "the shim no longer calls window.open itself - THE SHIPPED DEFECT",
  },
  {
    id: "MUT-2",
    why: "THE TRAP: treat window.open's null return as a failure. This is the obvious fix, and it reports failure on every successful open",
    file: MODULE,
    from: "    window.open(url, \"_blank\", \"noopener,noreferrer\");\n    return true;",
    to: "    return window.open(url, \"_blank\", \"noopener,noreferrer\") !== null;",
    catcher: "DOES NOT treat window.open's null return as a failure",
  },
  {
    id: "MUT-3",
    why: "ignore the Teams opener entirely and always use the window path",
    file: MODULE,
    from: "  if (teamsOpen !== null) {",
    to: "  if (false as boolean) {",
    catcher:
      "uses the Teams opener when one is registered, and does not touch window.open",
  },
  {
    id: "MUT-4",
    why: "a Teams refusal renders no note, so the user is told nothing in a tab with no address bar",
    file: MODULE,
    from: "      renderBlockedNote(resolveContainer(options.container), options.url);",
    to: "      void resolveContainer(options.container);",
    catcher:
      "shows the user the URL when Teams refuses, because a Teams tab has no address bar",
  },
  {
    id: "MUT-5",
    why: "report a refusal as success - the silence this whole change removes, restored one layer up",
    file: MODULE,
    from: '      report("teams-refused");',
    to: '      report("teams");',
    catcher: "reports teams-refused - NOT unavailable - when the Teams host rejects",
  },
  {
    id: "MUT-6",
    why: "the unverifiable fallback overwrites the measured fact with a guess",
    file: MODULE,
    from: "      attemptWindow(options.url);\n      renderBlockedNote",
    to: '      attemptWindow(options.url);\n      report("window-unverified");\n      renderBlockedNote',
    catcher:
      "still attempts the window fallback after a Teams refusal, without changing the reported fact",
  },
  {
    id: "MUT-7",
    why: "hand the Teams opener over BEFORE the handshake succeeds, so the PWA routes every link into an SDK with no host",
    file: HOST,
    from: "  if (outcome !== \"ok\") return OUTSIDE_TEAMS;",
    to: "  options.onLinkOpener?.((url: string) => sdk.openLink(url));\n  if (outcome !== \"ok\") return OUTSIDE_TEAMS;",
    catcher:
      "hands over NOTHING when the handshake times out under a non-Teams parent",
  },
  {
    id: "MUT-8",
    why: "drop noopener,noreferrer - the opened page gets a live handle back into a signed-in app",
    file: MODULE,
    from: '    window.open(url, "_blank", "noopener,noreferrer");',
    to: '    window.open(url, "_blank");',
    catcher:
      "keeps noopener,noreferrer - the opened page must not get a handle back into a signed-in app",
  },
  {
    id: "MUT-9",
    why: "main.tsx never registers the opener - the caller-did-not-call defect this package shipped one module over",
    file: MAIN,
    from: "    onLinkOpener: setTeamsLinkOpener,",
    to: "",
    catcher: "main.tsx registers the Teams opener with the handshake",
  },
  {
    id: "MUT-10",
    why: "the note renders a fixed string instead of the URL that was clicked",
    file: MODULE,
    from: "  address.textContent = url;",
    to: '  address.textContent = "the link";',
    catcher:
      "shows the user the URL when Teams refuses, because a Teams tab has no address bar",
  },
];

const FILES = [MODULE, SHIM, HOST, MAIN];
const originals = new Map(FILES.map((f) => [f, readFileSync(f, "utf8")]));

function restore() {
  for (const [file, text] of originals) writeFileSync(file, text);
}

const OUT = join(ROOT, ".mutate-out.json");

/**
 * Returns the names of the tests that FAILED.
 *
 * `shell: true` is load-bearing on Windows: since the 2024 spawn hardening,
 * Node refuses to `execFileSync` a `.cmd` without it and throws EINVAL. The
 * first draft of this probe swallowed that in the same `catch` that absorbs a
 * legitimately red suite, so the runner never started and every mutation would
 * have been reported however the report happened to read. A failure path that
 * cannot be told from the success path is the defect this whole file is here to
 * hunt, so it is worth not shipping one inside the hunter.
 *
 * The report file is deleted before each run and its absence afterwards is a
 * hard abort - "the suite produced no report" and "the suite passed" must never
 * collapse into one reading.
 */
function runSuite() {
  if (existsSync(OUT)) rmSync(OUT);
  try {
    execFileSync(
      "npx",
      ["vitest", "run", "src/web", "--reporter=json", "--outputFile=.mutate-out.json"],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: true },
    );
  } catch (error) {
    // A red suite exits non-zero, which is the expected case here - but so does
    // a runner that never started, and those are opposite facts. The report
    // file below is what tells them apart.
    void error;
  }
  if (!existsSync(OUT)) {
    console.log(
      "ABORT - vitest produced no report. The probe measured nothing; do not " +
        "read any result above as a pass.",
    );
    restore();
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(OUT, "utf8"));
  const failed = [];
  for (const suite of report.testResults ?? []) {
    for (const t of suite.assertionResults ?? []) {
      if (t.status === "failed") failed.push(t.title);
    }
  }
  return failed;
}

console.log("control: the suite must be GREEN before any mutation is believed");
const controlFailures = runSuite();
if (controlFailures.length > 0) {
  console.log(`ABORT - control is already red:\n  ${controlFailures.join("\n  ")}`);
  process.exit(1);
}
console.log("control: green\n");

let caught = 0;
let survived = 0;

for (const m of MUTATIONS) {
  const source = originals.get(m.file);
  const occurrences = source.split(m.from).length - 1;
  if (occurrences !== 1) {
    console.log(
      `${m.id} ABORT - pattern matched ${occurrences} times, expected exactly 1. ` +
        "The probe is wrong, not the code.",
    );
    restore();
    process.exit(1);
  }

  writeFileSync(m.file, source.replace(m.from, m.to));
  const failures = runSuite();
  restore();

  const byName = failures.includes(m.catcher);
  if (byName) {
    caught += 1;
    console.log(`${m.id} caught by its named test  (${failures.length} red)`);
  } else if (failures.length > 0) {
    caught += 1;
    console.log(
      `${m.id} caught, but NOT by "${m.catcher}" - by:\n    ${failures.slice(0, 4).join("\n    ")}\n` +
        "    ^ the named assertion is not the one doing the work. Investigate.",
    );
  } else {
    survived += 1;
    console.log(`${m.id} SURVIVED - ${m.why}`);
  }
}

restore();
console.log(`\n${caught}/${MUTATIONS.length} caught, ${survived} survived`);
process.exit(survived === 0 ? 0 : 1);
