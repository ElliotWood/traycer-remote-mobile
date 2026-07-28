import { homedir } from "node:os";
import { join } from "node:path";

/**
 * All push-service runtime state lives outside the repo, under the user's
 * `~/.traycer/` root (the same root the CLI/host/desktop use for their own
 * runtime state) — never inside the worktree, never committed.
 */
const PUSH_SERVICE_HOME = join(homedir(), ".traycer", "push-service");

export function pushServiceHomeDir(): string {
  return PUSH_SERVICE_HOME;
}

export function vapidKeysPath(): string {
  return join(PUSH_SERVICE_HOME, "vapid.json");
}

export function subscriptionsPath(): string {
  return join(PUSH_SERVICE_HOME, "subscriptions.json");
}

export function pushedStatePath(): string {
  return join(PUSH_SERVICE_HOME, "pushed-state.json");
}
