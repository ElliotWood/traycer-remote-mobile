import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

/**
 * Resolves a POSIX shell the TEST HARNESS can spawn.
 *
 * This is deliberately NOT the shell the product emits. `buildSystemdUnit` and
 * the launchd plist both hand `/bin/sh` to the service manager, and that string
 * is asserted verbatim elsewhere in these suites - it is a fact about the unit
 * file, not about the machine running the tests. Repointing the emitted value
 * at whatever shell happens to be installed would put a Windows path inside a
 * systemd unit, which is the fix that looks like a fix and ships a defect.
 *
 * What needed resolving is the other half: the suites verify the emitted script
 * by EXECUTING it (`sh -n` to parse, `sh -c` to run), and they hardcoded
 * `/bin/sh` as the binary to spawn. On Windows there is no `/bin/sh`, so every
 * one of those spawns died `ENOENT` and the tests read as product failures.
 * They were not - a POSIX shell is present on this platform, it is just not at
 * that path. Measured: the emitted ExecStart parses and runs under Git for
 * Windows' `sh`, and the F7 broken-quoting form it guards against still fails
 * to parse there ("unexpected EOF while looking for matching `'`"), so the
 * check keeps its teeth rather than being skipped into silence.
 *
 * Existence is not capability, so the candidate is PROBED once rather than
 * merely stat-ed - a file at the right path that cannot run a script would
 * otherwise turn an honest skip into a confusing failure.
 */
function probe(candidate: string): boolean {
  try {
    execFileSync(candidate, ["-c", "exit 0"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function candidates(): string[] {
  const found = ["/bin/sh"];

  // `sh` as resolved by PATH, if the platform puts one there.
  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    found.push(join(entry, "sh"), join(entry, "sh.exe"));
  }

  // Git for Windows ships a full POSIX shell but keeps it off PATH, so it has
  // to be derived from the `git` that IS on PATH: <root>/cmd/git.exe ->
  // <root>/usr/bin/sh.exe.
  for (const entry of pathEntries) {
    const gitExe = join(entry, "git.exe");
    if (existsSync(gitExe)) {
      found.push(join(dirname(dirname(gitExe)), "usr", "bin", "sh.exe"));
    }
  }

  return found;
}

let resolved: string | null | undefined;

/** Absolute path to a spawnable POSIX shell, or `null` if this machine has none. */
export function posixShell(): string | null {
  if (resolved === undefined) {
    resolved =
      candidates().find(
        (candidate) => existsSync(candidate) && probe(candidate),
      ) ?? null;
  }
  return resolved;
}

/**
 * `true` when no POSIX shell could be found, for `describe.skipIf`.
 *
 * A skip is the honest outcome only when the machine genuinely cannot run the
 * check. It must not become the outcome on every Windows machine, which is what
 * `skipIf(process.platform === "win32")` would have bought - coverage deleted on
 * a platform that can in fact run it.
 */
export const NO_POSIX_SHELL = posixShell() === null;
