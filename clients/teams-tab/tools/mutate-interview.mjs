/**
 * Mutation probe for the interview options port. A PROBE, NOT A GATE — it
 * writes to source and restores, so it is deliberately unwired from CI.
 *
 * Same contract as `mutate-dispatch.mjs`: a mutation whose pattern does not
 * match EXACTLY ONCE aborts rather than running, because a pattern that
 * matches nothing prints green about unmutated code — which is the failure
 * this whole workstream keeps cataloguing. Matching is LF-normalised; this
 * tree checks out CRLF.
 *
 * It reports the NAMED tests that reddened, not just that the suite went red.
 * A suite-level red tells you something broke; it does not tell you the
 * assertion you were relying on is the one that caught it.
 *
 *   node tools/mutate-interview.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tabRoot = resolve(here, "..");
const repoRoot = resolve(tabRoot, "../..");

const CARD = resolve(tabRoot, "src/chat/interview-card.tsx");
const PROJECTION = resolve(repoRoot, "clients/shared/epic/transcript.ts");

const CARD_TESTS = "src/chat/__tests__/interview-card.test.tsx";
const PROJECTION_TESTS = "epic/__tests__/interview-projection.test.ts";

/** @type {{name: string, file: string, from: string, to: string, suite: "tab"|"shared", expect: string}[]} */
const MUTATIONS = [
  {
    name: "render every question as a textarea (the shipped defect, exactly)",
    file: CARD,
    from: "{q.options.length > 0 ? (",
    to: "{false ? (",
    suite: "tab",
    expect: "the no-free-text-path and label-submission cases",
  },
  {
    name: "render every question as options (free-text branch unreachable)",
    file: CARD,
    from: "{q.options.length > 0 ? (",
    to: "{q.options.length >= 0 ? (",
    suite: "tab",
    expect: "the free-text cases",
  },
  {
    name: "submit typed text even when the question has options",
    file: CARD,
    from: "if (question.options.length > 0) return selected[index] ?? [];",
    to: "if (question.options.length > 99) return selected[index] ?? [];",
    suite: "tab",
    expect: "every values assertion",
  },
  {
    name: "single-select accumulates like multi-select",
    file: CARD,
    from: "      if (!multiSelect) {",
    to: "      if (false) {",
    suite: "tab",
    expect: "single-select replaces rather than accumulates",
  },
  {
    name: "never warn about stranded text",
    file: CARD,
    from: "        const stranded =\n",
    to: "        const stranded = false && \n",
    suite: "tab",
    expect: "the options-arriving-late cases",
  },
  {
    name: "projection drops options again (the state before this port)",
    file: PROJECTION,
    from: "            options: rawOptions.flatMap((o) => {",
    to: "            options: [].flatMap((o) => {",
    suite: "shared",
    expect: "carries options / free-text distinguishable / label dropping",
  },
  {
    name: "projection keeps an option with an empty label",
    file: PROJECTION,
    from: 'if (typeof label !== "string" || label.length === 0) return [];',
    to: 'if (typeof label !== "string") return [];',
    suite: "shared",
    expect: "drops an option with no usable label",
  },
  {
    name: "projection reads multiSelect loosely",
    file: PROJECTION,
    from: 'multiSelect: question["multiSelect"] === true,',
    to: 'multiSelect: Boolean(question["multiSelect"]),',
    suite: "shared",
    expect: "defaults a malformed question to free-text",
  },
];

function occurrences(haystack, needle) {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

function runSuite(suite) {
  const cwd = suite === "tab" ? tabRoot : resolve(repoRoot, "clients/shared");
  const file = suite === "tab" ? CARD_TESTS : PROJECTION_TESTS;
  try {
    const out = execFileSync(
      process.execPath,
      [resolve(repoRoot, "node_modules/vitest/vitest.mjs"), "run", file, "--reporter=json"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return parse(out);
  } catch (error) {
    return parse(String(error.stdout ?? ""));
  }
}

function parse(stdout) {
  const start = stdout.indexOf("{");
  if (start === -1) return { ok: false, failed: ["<no json from vitest>"] };
  let report;
  try {
    report = JSON.parse(stdout.slice(start));
  } catch {
    return { ok: false, failed: ["<unparseable vitest json>"] };
  }
  const failed = [];
  for (const suite of report.testResults ?? []) {
    for (const test of suite.assertionResults ?? []) {
      if (test.status === "failed") failed.push(test.title);
    }
  }
  return { ok: failed.length === 0, failed };
}

let survivors = 0;

for (const mutation of MUTATIONS) {
  const original = readFileSync(mutation.file, "utf8");
  const normalised = original.replace(/\r\n/g, "\n");
  const hits = occurrences(normalised, mutation.from);
  if (hits !== 1) {
    console.error(
      `ABORT  ${mutation.name}\n       pattern matched ${hits} times, expected exactly 1.`,
    );
    process.exitCode = 1;
    continue;
  }

  writeFileSync(mutation.file, normalised.replace(mutation.from, mutation.to), "utf8");
  let result;
  try {
    result = runSuite(mutation.suite);
  } finally {
    writeFileSync(mutation.file, original, "utf8");
  }

  if (result.ok) {
    survivors += 1;
    console.log(`SURVIVED  ${mutation.name}`);
    console.log(`          nothing reddened. Expected: ${mutation.expect}`);
  } else {
    console.log(`CAUGHT    ${mutation.name}`);
    for (const title of result.failed) console.log(`          × ${title}`);
  }
}

console.log(
  `\n${MUTATIONS.length} mutations, ${survivors} survived.` +
    (survivors === 0 ? "" : "  A SURVIVOR IS A HOLE IN THE TESTS, NOT A PASS."),
);
