#!/usr/bin/env node
// Prints the eslint error/warning FILE LIST for a package, not just the count.
//
// Rule 3 of verification-practices: a count cannot see a one-in-one-out swap.
// Both packages this repo's Teams work touches have held baselines that moved
// while the total did not (teams-tab 5->8 and 5->7; shared 0->2). Quote what
// this prints, never "unchanged".
//
//   node tools/lint-list.mjs            # lint the cwd package
//   node tools/lint-list.mjs ../shared  # lint another package
import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";

const target = resolve(process.argv[2] ?? ".");
const eslint = resolve(
  import.meta.dirname,
  "../../../node_modules/eslint/bin/eslint.js",
);

let raw = "";
try {
  raw = execFileSync(process.execPath, [eslint, ".", "--format", "json"], {
    cwd: target,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  // eslint exits non-zero when it finds errors; that is the normal path here.
  if (typeof err.stdout !== "string" || err.stdout === "") throw err;
  raw = err.stdout;
}

const results = JSON.parse(raw);
const rows = [];
let errors = 0;
let warnings = 0;
for (const file of results) {
  errors += file.errorCount;
  warnings += file.warningCount;
  for (const message of file.messages) {
    rows.push({
      file: relative(target, file.filePath).replaceAll("\\", "/"),
      line: message.line,
      rule: message.ruleId ?? "(no rule)",
      severity: message.severity === 2 ? "error" : "warn",
    });
  }
}

rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
console.log(`${relative(resolve(target, "../.."), target).replaceAll("\\", "/")}: ${errors} errors, ${warnings} warnings`);
for (const row of rows) {
  console.log(`  ${row.severity} ${row.file}:${row.line} ${row.rule}`);
}
process.exitCode = 0;
