/**
 * Mutation probe for the comment-threads surface. A PROBE, not a gate —
 * it writes to source and restores, and is deliberately unwired.
 *
 * Same guards as `mutate-settings.mjs`, and for the same reasons recorded
 * there: exactly-once target assertion before the edit and zero after,
 * single-line targets so CRLF-vs-LF cannot silently match nothing, a green
 * baseline required before anything is mutated, and `restore()` in a
 * `finally`. Each mutation names the test that must redden — "the suite went
 * red" is a much weaker claim than "this named assertion went red".
 *
 * MUT-2 REPRODUCES THE DEFECT THIS FILE SHIPPED WITH: `beginWrite` returned a
 * flag set inside a `setState` updater, so every write was silently refused.
 * A probe that cannot reproduce the bug the tests actually caught is not
 * evidence about those tests.
 *
 *   node tools/mutate-comments.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..", "src");
const VITEST = join(import.meta.dirname, "..", "..", "..", "node_modules", "vitest", "vitest.mjs");

const FILE = "comments/use-comment-threads.ts";

const MUTATIONS = [
  {
    id: "MUT-1",
    file: FILE,
    why: "the sequence never advances, so a stale read lands over a newer one",
    expect: "drops a stale response that lands after a newer one",
    from: `    requestSeq.current += 1;`,
    to: `    requestSeq.current += 0;`,
  },
  {
    id: "MUT-2",
    file: FILE,
    why: "a write is permitted before the read lands — the shipped defect, inverted",
    expect: "refuses a write issued before the read has landed",
    from: `    if (!ready.current) return false;`,
    to: `    if (false) return false;`,
  },
  {
    id: "MUT-3",
    file: FILE,
    why: "threads render in host order rather than oldest-first",
    expect: "requests the artifact's threads and sorts them oldest-first",
    from: `          threads: [...response.threads].sort((a, b) => a.createdAt - b.createdAt),`,
    to: `          threads: [...response.threads],`,
  },
  {
    id: "MUT-4",
    file: FILE,
    why: "the reload key ignores the artifact, pinning the panel to the first one opened",
    expect: "re-reads when a different artifact is opened",
    from: '  const scopeKey = `${epicId}\\u0000${artifactType}\\u0000${artifactId}`;',
    to: '  const scopeKey = `${epicId}\\u0000${artifactType}`;',
  },
  {
    id: "MUT-5",
    file: FILE,
    why: "a whitespace-only reply reaches the host as an empty comment",
    expect: "sends nothing for a whitespace-only reply",
    from: `      if (text.trim().length === 0) return;`,
    to: `      if (false) return;`,
  },
  {
    id: "MUT-6",
    file: FILE,
    why: "the reply is sent untrimmed, so padding becomes part of the comment",
    expect: "sends a reply as JsonContent and re-reads the host's list",
    from: `          content: plainTextContent(text.trim()),`,
    to: `          content: plainTextContent(text),`,
  },
  {
    id: "MUT-7",
    file: FILE,
    why: "a failed write reports nothing, so the reply vanishes in silence",
    expect: "keeps the threads on screen when a write fails, and says why",
    from: `        ? { ...prev, busyThreadId: null, actionError: describe(error) }`,
    to: `        ? { ...prev, busyThreadId: null, actionError: null }`,
  },
  {
    id: "MUT-8",
    file: FILE,
    why: "the resolve toggle moves on the ack rather than on the host's own list",
    expect: "moves the resolved flag only after the host's own list says so",
    from: `          busyThreadId: null,`,
    to: `          busyThreadId: "",`,
  },
];

function run() {
  const result = spawnSync(process.execPath, [VITEST, "run"], {
    cwd: join(import.meta.dirname, ".."),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function occurrences(haystack, needle) {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

console.log("baseline...");
const baseline = run();
if (!/Test Files\s+\d+ passed/.test(baseline) || /failed/.test(baseline)) {
  console.error("ABORT: baseline is not green. A probe run against a red");
  console.error("suite reports every mutation as caught.");
  process.exit(1);
}
const baselineTests = /Tests\s+(\d+) passed/.exec(baseline)?.[1] ?? "?";
console.log(`baseline green: ${baselineTests} tests\n`);

let survivors = 0;
for (const mutation of MUTATIONS) {
  const path = join(SRC, mutation.file);
  const original = readFileSync(path, "utf8");
  const before = occurrences(original, mutation.from);
  if (before !== 1) {
    console.error(
      `ABORT ${mutation.id}: target appears ${before} times in ${mutation.file}, expected exactly 1.`,
    );
    console.error("  This is the guard, not a nuisance: a target that matches");
    console.error("  zero times produces a SURVIVED verdict about an unedited file.");
    process.exit(1);
  }

  try {
    const mutated = original.replace(mutation.from, mutation.to);
    if (occurrences(mutated, mutation.from) !== 0) {
      console.error(`ABORT ${mutation.id}: the edit did not land.`);
      process.exit(1);
    }
    writeFileSync(path, mutated);
    const output = run();
    const failed = /failed/.test(output);
    const named = output.includes(mutation.expect);
    if (failed && named) {
      console.log(`${mutation.id} CAUGHT  by "${mutation.expect}"`);
    } else if (failed) {
      console.log(
        `${mutation.id} caught, but NOT by the named test — ${mutation.expect}`,
      );
      console.log("        a mutation reddening an unrelated test proves nothing here");
      survivors += 1;
    } else {
      console.log(`${mutation.id} SURVIVED — ${mutation.why}`);
      survivors += 1;
    }
  } finally {
    writeFileSync(path, original);
    if (readFileSync(path, "utf8") !== original) {
      console.error(`RESTORE FAILED for ${mutation.file} — fix by hand.`);
      process.exit(1);
    }
  }
}

console.log(`\n${MUTATIONS.length} mutations, ${survivors} survivor(s).`);
process.exit(survivors === 0 ? 0 : 1);
