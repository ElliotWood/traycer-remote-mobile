import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentConfig } from "./config";

/**
 * Resolves the Traycer Host's `pid.json` path from the agent's own config.
 * Mirrors the on-disk contract documented in
 * `clients/traycer-cli/src/store/paths.ts` (`hostPidMetadataPath`) and
 * `clients/traycer-cli/src/host/pid-metadata.ts` - reimplemented locally
 * (a few lines) rather than importing traycer-cli internals, since
 * traycer-cli exposes no public library surface for this path. This is not
 * new discovery, just the same documented contract.
 *
 *   production -> ~/.traycer/host/pid.json
 *   dev slot   -> ~/.traycer/host/dev-runs/<slot>/pid.json
 */
export function resolvePidJsonPath(
  config: Pick<AgentConfig, "traycerEnvironment" | "traycerDevSlot">,
): string {
  const hostHome = join(homedir(), ".traycer", "host");
  if (config.traycerEnvironment === "production") {
    return join(hostHome, "pid.json");
  }
  if (config.traycerDevSlot === undefined) {
    throw new Error(
      "traycer-remote: agent config traycerEnvironment is 'dev' but traycerDevSlot is not set",
    );
  }
  return join(hostHome, "dev-runs", config.traycerDevSlot, "pid.json");
}
