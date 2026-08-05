/**
 * `127.0.0.1` only, by convention with every other loopback service in this
 * repo (`clients/mobile-push-service`) — this process never binds a public
 * interface itself. Public reachability, if the user chooses it, is a tunnel
 * (see the T0a ticket) fronting this loopback port, not this process
 * listening on `0.0.0.0`.
 */
export interface TeamsBotConfig {
  readonly host: string;
  readonly port: number;
}

export function loadServerConfigFromEnv(
  env: NodeJS.ProcessEnv,
): TeamsBotConfig {
  const host = env.TEAMS_BOT_HOST?.trim() || "127.0.0.1";
  const rawPort = env.TEAMS_BOT_PORT?.trim();
  const port = rawPort ? Number.parseInt(rawPort, 10) : 3978;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(
      `TEAMS_BOT_PORT must be a valid port number, got "${rawPort}"`,
    );
  }
  return { host, port };
}
