/**
 * A PROBE, NOT A GATE. It writes to source and restores; it is not wired into
 * CI and must not be. Run it by hand:
 *
 *   node tools/mutate-clipboard.mjs
 *
 * Each mutation names the test that MUST redden. A mutation caught by "the
 * suite went red somewhere" is not caught in the sense that matters.
 *
 * MUT-1 IS THE MUTATION WORTH HAVING: it restores the shipped behaviour - the
 * wrapper installs and does nothing - and the row that reddens is the SEAM row,
 * stated in the units a user experiences: upstream's real copy button, on the
 * surface the probe measured, reporting failure. That row could have been
 * written, and would have failed, before a line of this module existed.
 *
 * MUT-11 is the quiet one. It gates the wrapper on the policy reading, which
 * looks like a tightening and is the module's own design note inverted. Every
 * assertion written against a refusing navigator plus a BLOCKED document passes
 * under it; only the row that pairs a refusing navigator with a GRANTED one
 * fails - the Firefox case, where a document holds the feature and the write is
 * refused regardless.
 *
 * Two test files are run together deliberately: the unit file cannot see MUT-1
 * at all, and the seam file cannot see the reporting mutations.
 *
 * Every mutation aborts unless its pattern matches EXACTLY ONCE. A probe whose
 * pattern silently matches zero times reports a pass it never measured.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MODULE = join(ROOT, "src", "web", "clipboard-fallback.ts");

const MUTATIONS = [
  {
    id: "MUT-1",
    why: "THE SHIPPED DEFECT: the wrapper is installed and passes straight through, so a refused write stays refused and every copy button in the Teams tab reports failure",
    from:
      "  const nativeWriteText = native.writeText.bind(native);\n" +
      "  native.writeText = (text: string): Promise<void> =>",
    to:
      "  const nativeWriteText = native.writeText.bind(native);\n" +
      "  native.writeText = (text: string): Promise<void> =>\n" +
      "    nativeWriteText(text); // eslint-disable-line\n" +
      "  const unusedWriteText = (text: string): Promise<void> =>",
    catcher:
      "THE REPAIR - with the shell fallback installed, the same surface copies",
  },
  {
    id: "MUT-2",
    why: "a bypass rather than a fallback: the native call is never attempted, so a granted surface loses rich clipboard types and the app copies through a hidden textarea forever",
    from: "    nativeWriteText(text).then(undefined, (cause: unknown) =>\n      fallbackWrite(text, cause),\n    );",
    to: '    fallbackWrite(text, new Error("skipped"));',
    catcher: "is installed on a GRANTED surface too, and is inert there",
  },
  {
    id: "MUT-3",
    why: "the original rejection is replaced with a new error, so whoever reads the log sees this module's invention instead of the browser's NotAllowedError",
    from: '    report("fallback-failed");\n    return Promise.reject(cause);',
    to: '    report("fallback-failed");\n    return Promise.reject(new Error("copy failed"));',
    catcher: "rejects with the ORIGINAL cause when the fallback also fails",
  },
  {
    id: "MUT-4",
    why: "the install-time stamp is dropped, so `<html data-clipboard>` is absent until someone presses a copy button - which on a session where nobody copies is never",
    from: "  report(installed);\n",
    to: "",
    catcher: "stamps granted, before any copy is attempted",
  },
  {
    id: "MUT-5",
    why: "an unreadable policy is reported as a measured refusal, so Firefox and Safari claim `policy-blocked` having never been asked",
    from: '      : allowed === null\n        ? "unmeasured"',
    to: '      : allowed === null\n        ? "policy-blocked"',
    catcher:
      "stamps unmeasured where the policy API is absent - NOT policy-blocked",
  },
  {
    id: "MUT-6",
    why: "the policy read answers false rather than null where there is no API, collapsing the measurement and its absence into one value",
    from: "  if (policy === undefined) return null;",
    to: "  if (policy === undefined) return false;",
    catcher: "answers NULL, not false, where there is no policy API to ask",
  },
  {
    id: "MUT-7",
    why: "the policy is asked about the wrong feature and its well-formed boolean is reported as this one's",
    from: '    return policy.allowsFeature("clipboard-write");',
    to: '    return policy.allowsFeature("clipboard-read");',
    catcher: "asks about clipboard-write specifically",
  },
  {
    id: "MUT-8",
    why: "the fallback claims success whatever it did, so a surface where copy is impossible reports a cheerful `fallback-copied` and the button lies",
    from: '    if (copy(text)) {\n      report("fallback-copied");\n      return Promise.resolve();\n    }',
    to: '    copy(text);\n    if (true) {\n      report("fallback-copied");\n      return Promise.resolve();\n    }',
    catcher:
      "and still reports failure honestly when the fallback cannot copy either",
  },
  {
    id: "MUT-9",
    why: "the textarea is never given the text, so the fallback copies an empty string and returns true - the exact shape of a green test over a silent data loss",
    from: "  area.value = text;",
    to: '  area.value = "";',
    catcher: "puts the text into the textarea it copies from",
  },
  {
    id: "MUT-10",
    why: "the absent clipboard is left absent, so an insecure context keeps throwing synchronously at ten of gui-app's eleven call sites",
    from: '      Object.defineProperty(nav, "clipboard", {\n        value: synthesized,\n        configurable: true,\n      });',
    to: "      void synthesized;",
    catcher: "synthesizes a writeText that copies through the fallback",
  },
  {
    id: "MUT-11",
    why: "the wrapper is gated on the policy reading - the module's own design note inverted - so a document that HOLDS the feature and is refused the write anyway (Firefox) keeps failing silently",
    from: "  const nativeWriteText = native.writeText.bind(native);",
    to: "  if (allowed !== false) return installed;\n  const nativeWriteText = native.writeText.bind(native);",
    catcher:
      "falls back on a GRANTED surface whose native write is refused anyway",
  },
];

const original = readFileSync(MODULE, "utf8");
const restore = () => writeFileSync(MODULE, original);

const OUT = join(ROOT, ".mutate-clipboard.json");

/**
 * Returns the names of the tests that FAILED.
 *
 * `shell: true` is load-bearing on Windows: Node refuses to `execFileSync` a
 * `.cmd` without it and throws EINVAL, and an earlier probe in this package
 * absorbed that into the same `catch` that absorbs a legitimately red suite -
 * so the runner never started and every mutation was "measured" against a
 * report that was never written. The absence of the report is therefore a hard
 * abort: "the suite produced no report" and "the suite passed" must never
 * collapse into one reading.
 */
function runSuite() {
  if (existsSync(OUT)) rmSync(OUT);
  try {
    execFileSync(
      "npx",
      [
        "vitest",
        "run",
        "src/web/clipboard-fallback.test.ts",
        "src/web/clipboard-seam.test.tsx",
        "--reporter=json",
        "--outputFile=.mutate-clipboard.json",
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      },
    );
  } catch (error) {
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
  console.log(
    `ABORT - control is already red:\n  ${controlFailures.join("\n  ")}`,
  );
  process.exit(1);
}
console.log("control: green\n");

let caught = 0;
let survived = 0;

for (const m of MUTATIONS) {
  const occurrences = original.split(m.from).length - 1;
  if (occurrences !== 1) {
    console.log(
      `${m.id} ABORT - pattern matched ${occurrences} times, expected exactly 1. ` +
        "The probe is wrong, not the code.",
    );
    restore();
    process.exit(1);
  }

  writeFileSync(MODULE, original.replace(m.from, m.to));
  const failures = runSuite();
  restore();

  if (failures.includes(m.catcher)) {
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
if (existsSync(OUT)) rmSync(OUT);
console.log(`\n${caught}/${MUTATIONS.length} caught, ${survived} survived`);
process.exit(survived === 0 ? 0 : 1);
