// Host resolution for the chat-transfer CLI.
//
// The local host is discovered from its own `pid.json`. Remote hosts come
// from an untracked config file: an endpoint or host id baked into a tracked
// file would be both a leak and a stale fact (see remote-host-bridge's README
// for the same reasoning).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const TRAYCER_ROOT = process.env.TRAYCER_ROOT ?? join(homedir(), ".traycer");
export const CONFIG_PATH = process.env.TRAYCER_CHAT_TRANSFER_HOSTS ?? join(TRAYCER_ROOT, "chat-transfer.hosts.json");

const CONFIG_TEMPLATE = {
  hosts: [
    {
      alias: "<short-name>",
      origin: "wss://<your-host>",
      hostId: "<uuid — run `hosts --epic <id>` to discover it>",
      insecureTls: false,
    },
  ],
};

export function bearerToken() {
  const path = join(TRAYCER_ROOT, "cli", "credentials");
  if (!existsSync(path)) {
    throw new Error(`no credentials at ${path} — run \`traycer login\` first`);
  }
  const token = JSON.parse(readFileSync(path, "utf8")).token;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error(`credentials at ${path} carry no token`);
  }
  return token;
}

function readLocalHost(token) {
  const path = join(TRAYCER_ROOT, "host", "pid.json");
  if (!existsSync(path)) return null;
  const pid = JSON.parse(readFileSync(path, "utf8"));
  const url = String(pid.websocketUrl ?? "");
  const origin = url.replace(/\/rpc$/, "");
  if (origin.length === 0 || typeof pid.hostId !== "string") return null;
  return { alias: "local", origin, hostId: pid.hostId, version: pid.version ?? null, isLocal: true, token };
}

function readConfig() {
  if (!existsSync(CONFIG_PATH)) return { hosts: [] };
  const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  if (!Array.isArray(parsed.hosts)) throw new Error(`${CONFIG_PATH} has no \`hosts\` array`);
  return parsed;
}

/**
 * Every host this machine can address: the local one (from `pid.json`) plus
 * the configured remotes. A configured `local` alias wins over discovery.
 */
export function listHosts() {
  const token = bearerToken();
  const configured = readConfig().hosts.map((h) => ({
    alias: String(h.alias),
    origin: String(h.origin).replace(/\/$/, ""),
    hostId: typeof h.hostId === "string" && !h.hostId.startsWith("<") ? h.hostId : null,
    version: null,
    isLocal: false,
    insecureTls: h.insecureTls === true,
    token,
  }));
  const local = readLocalHost(token);
  if (local !== null && !configured.some((h) => h.alias === local.alias)) configured.unshift(local);
  if (configured.some((h) => h.insecureTls)) enableInsecureTls();
  return configured;
}

export function resolveHost(alias) {
  const hosts = listHosts();
  const found = hosts.find((h) => h.alias === alias);
  if (found === undefined) {
    const known = hosts.map((h) => h.alias).join(", ") || "none";
    throw new Error(`unknown host "${alias}" — configured: ${known}. Edit ${CONFIG_PATH}`);
  }
  return found;
}

/**
 * Persist a discovered host id back into the config so the next run does not
 * re-derive it. Only touches the matching alias.
 */
export function rememberHostId(alias, hostId) {
  const config = existsSync(CONFIG_PATH) ? readConfig() : { hosts: [] };
  const row = config.hosts.find((h) => h.alias === alias);
  if (row === undefined) return false;
  row.hostId = hostId;
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
  return true;
}

export function configTemplate() {
  return `${JSON.stringify(CONFIG_TEMPLATE, null, 2)}\n`;
}

function enableInsecureTls() {
  // Process-wide: Node's built-in WebSocket has no per-socket TLS knob. Loud,
  // because it turns off the only thing authenticating the far end - needed
  // for a box behind an ACME-staging or self-signed certificate.
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") return;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  console.error("!! insecureTls is set for a configured host: upstream certificates are NOT verified");
}
