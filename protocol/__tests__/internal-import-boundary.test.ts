import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Hard-enforces the `_internal/` privacy boundary for `@traycer/protocol`.
 *
 * Files under `protocol/<domain>/_internal/` host the raw Zod values for
 * registered records (e.g. `epicSchema`, `permissionRoleSchema`,
 * `userSchema`, `roomMetadataSchema`). Importing them directly bypasses
 * the registry's version stamp, which is exactly the drift this
 * framework was built to prevent.
 *
 * The rule is intentionally strict: **no file is allowed to import from
 * a `_internal/` path** except:
 *
 * - The owning registry - `protocol/<domain>/registry.ts` - which is
 *   the canonical entry that wraps records into versioned contracts.
 * - Other modules that already live under `_internal/` themselves.
 *
 * Everything else (including other modules inside `protocol/`) reaches
 * record schemas through `getRecordSchema(<registry>, "<record-name>")`.
 *
 * This test scans every `.ts`/`.tsx` file in the monorepo and fails on
 * any import path matching `@traycer/protocol/.../_internal/...` from a
 * file that is not an authorized importer.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nx",
  ".turbo",
  "coverage",
  "out",
  ".git",
  ".tanstack",
  ".agents",
  ".claude",
  ".codex",
]);

// Matches any import (runtime or type-only) referencing a path under
// `@traycer/protocol/.../_internal/...`. The privacy boundary is
// total: even type-only imports leak structural detail across the
// boundary. Recursive types that require a `z.ZodType<...>`
// annotation must be co-located with the owning registry, not
// imported from `_internal/`.
const FORBIDDEN_IMPORT_PATTERN =
  /["']@traycer\/protocol\/[^"']*\/_internal\/[^"']*["']/g;

/**
 * Files allowed to import from `_internal/`. Update the list below when
 * a new versioned-record domain is added - the registry file for that
 * domain is the single approved entry point.
 */
const AUTHORIZED_IMPORTERS = new Set<string>([
  path.join(REPO_ROOT, "protocol", "src", "auth", "registry.ts"),
  path.join(REPO_ROOT, "protocol", "src", "common", "registry.ts"),
  path.join(REPO_ROOT, "protocol", "src", "persistence", "registry.ts"),
]);

function isAuthorizedImporter(filePath: string): boolean {
  if (AUTHORIZED_IMPORTERS.has(filePath)) {
    return true;
  }
  // Files inside any `_internal/` directory are part of the private
  // surface and may freely cross-reference one another.
  return filePath.split(path.sep).includes("_internal");
}

function* walkSourceFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRS.has(entry)) continue;

    const fullPath = path.join(directory, entry);
    let entryStat;
    try {
      entryStat = statSync(fullPath);
    } catch {
      continue;
    }

    if (entryStat.isDirectory()) {
      yield* walkSourceFiles(fullPath);
      continue;
    }

    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      yield fullPath;
    }
  }
}

function findForbiddenImports(
  filePath: string,
): { lineNumber: number; line: string }[] {
  const contents = readFileSync(filePath, "utf8");
  const matches: { lineNumber: number; line: string }[] = [];

  contents.split("\n").forEach((line, index) => {
    FORBIDDEN_IMPORT_PATTERN.lastIndex = 0;
    if (FORBIDDEN_IMPORT_PATTERN.test(line)) {
      matches.push({ lineNumber: index + 1, line: line.trim() });
    }
  });

  return matches;
}

/**
 * This scan reads every `.ts`/`.tsx` file in the monorepo - ~4,300 files and
 * ~39 MB - so its cost is filesystem IO, and on Windows that IO contends with
 * the rest of the suite's workers. Measured on `main`: ~2.0s when this file
 * runs alone, but **7.9-8.2s inside a full `vitest run`**, against the 5s
 * default. So the gate was red on every full-suite run on Windows.
 *
 * It was still red for the *right* reason when a violation existed - the throw
 * beat the timeout to the reporter and named the file - but on a clean tree the
 * only available outcome was `Test timed out in 5000ms`. A gate that can report
 * "violation" but never "clean" cannot be read as a signal.
 *
 * The budget is raised rather than the work reduced, because the work is not
 * reducible without narrowing what is scanned. Two candidate speedups were
 * measured and both were rejected: testing the whole file before splitting it
 * into lines (7% faster) and a `Buffer.includes` prefilter before the utf8
 * decode (6% faster). Neither closes a 4x gap - the syscalls are the cost.
 *
 * 60s is ~7x the measured worst case, so a genuine hang in the walk still
 * fails rather than passing slowly.
 */
const BOUNDARY_SCAN_TIMEOUT_MS = 60_000;

describe("@traycer/protocol _internal/ privacy boundary", () => {
  it("only registries and _internal/ files import from a protocol _internal/ path", () => {
    const violations: string[] = [];

    for (const filePath of walkSourceFiles(REPO_ROOT)) {
      if (isAuthorizedImporter(filePath)) continue;

      const matches = findForbiddenImports(filePath);
      for (const match of matches) {
        const relPath = path.relative(REPO_ROOT, filePath);
        violations.push(`${relPath}:${match.lineNumber}: ${match.line}`);
      }
    }

    if (violations.length > 0) {
      throw new Error(
        [
          "Files are importing from `@traycer/protocol/.../_internal/...`",
          "outside the registry / _internal/ allow-list.",
          "",
          "Use `getRecordSchema(<registry>, \"<record-name>\")` instead.",
          "",
          ...violations,
        ].join("\n"),
      );
    }

    expect(violations).toEqual([]);
  }, BOUNDARY_SCAN_TIMEOUT_MS);
});
