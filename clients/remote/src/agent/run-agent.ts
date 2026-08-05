import { loadAgentConfig } from "./config";
import { resolvePidJsonPath } from "./pid-json-path";
import { readHostPidMetadata } from "./pid-metadata";
import { startTunnelServer } from "./tunnel-server";
import { HeartbeatClient } from "./heartbeat-client";
import type { AgentRegisterRequest } from "../shared/wire-schemas";

const DEFAULT_HEARTBEAT_TIMEOUT_MS = 45_000;

export async function runAgent(configPath: string): Promise<void> {
  const config = await loadAgentConfig(configPath);
  const pidJsonPath = resolvePidJsonPath(config);

  const server = startTunnelServer({
    host: config.tunnelListen.host,
    port: config.tunnelListen.port,
    token: config.token,
    pidJsonPath: () => pidJsonPath,
    onEvent: (event) => {
      // eslint-disable-next-line no-console
      console.log(`[traycer-remote agent] tunnel: ${JSON.stringify(event)}`);
    },
  });

  const currentState = async (): Promise<AgentRegisterRequest> => {
    const metadata = await readHostPidMetadata(pidJsonPath);
    return {
      agentId: config.agentId,
      // hostId/version reflect the CURRENT pid.json read fresh every call -
      // a host reinstall changing hostId does not require re-provisioning
      // the agent (M1 contract, agentId-vs-hostId trust split).
      hostId: metadata?.hostId ?? config.agentId,
      label: config.label,
      version: metadata?.version ?? "unknown",
      reachableUrl: config.reachableUrl,
    };
  };

  // HeartbeatClient's `currentState` is synchronous by design (simple,
  // no double-fetch races); resolve pid.json once per heartbeat tick by
  // wrapping the async read in a cached-per-tick synchronous snapshot.
  let latestState: AgentRegisterRequest = await currentState();
  const heartbeat = new HeartbeatClient({
    gatewayRegistrationUrl: config.gatewayRegistrationUrl,
    token: config.token,
    heartbeatTimeoutMs: DEFAULT_HEARTBEAT_TIMEOUT_MS,
    currentState: () => latestState,
    onEvent: (event) => {
      // eslint-disable-next-line no-console
      console.log(`[traycer-remote agent] heartbeat: ${JSON.stringify(event)}`);
    },
  });

  const refreshState = setInterval(() => {
    void currentState().then((state) => {
      latestState = state;
    });
  }, 5_000);

  heartbeat.start();

  const shutdown = async (): Promise<void> => {
    clearInterval(refreshState);
    await heartbeat.stop();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
