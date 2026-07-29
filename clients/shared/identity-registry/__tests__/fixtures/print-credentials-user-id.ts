// @ts-nocheck -- runtime-only probe, executed directly by `bun` in a spawned
// child process (see `tenant-environment.real-spawn.test.ts`), never
// imported by any TypeScript file in this project. Its explicit `.ts`
// import extensions are required for that runtime's module resolution and
// are deliberately outside this package's own `tsconfig.json` conventions
// (which does not set `allowImportingTsExtensions`) — excluding it from
// type-checking here is correct, not a suppressed real error.
/**
 * Prints ONLY the resolved `user.id` (or the literal string `NONE`) to
 * stdout, so the parent test can assert on it without parsing anything
 * else. Exercises the exact production credentials-resolution code path
 * (`cliCredentialsPath` -> `homedir()` -> `readCredentialsFile`), proving
 * the isolation property `buildTenantEnvironment` exists for: two child
 * processes with two different `HOME`s resolve two different
 * `StoredCredentials.user.id`s, using REAL protocol code, not a
 * reimplementation of it.
 */
import { cliCredentialsPath } from "../../../../../protocol/src/config/paths.ts";
import { readCredentialsFile } from "../../../../../protocol/src/config/credentials.ts";

async function main(): Promise<void> {
  const path = cliCredentialsPath("production");
  const credentials = await readCredentialsFile(path);
  process.stdout.write(credentials === null ? "NONE" : credentials.user.id);
}

void main();
