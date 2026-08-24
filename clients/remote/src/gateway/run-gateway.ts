import http from "node:http";
import { loadGatewayConfig } from "./config";
import { Registry } from "./registry";
import { startRegistrationServer } from "./registration-server";
import { createPublicRequestHandler } from "./public-request-handler";
import { attachProxy } from "./proxy";

export async function runGateway(configPath: string): Promise<void> {
  const config = await loadGatewayConfig(configPath);
  const registry = new Registry(config.heartbeatTimeoutMs);

  const registrationServer = startRegistrationServer(config, registry);
  // eslint-disable-next-line no-console
  console.log(
    `[traycer-remote gateway] internal registration listener on ${config.internalListen.host}:${config.internalListen.port} (not publicly served)`,
  );

  const publicServer = http.createServer(
    createPublicRequestHandler(config, registry),
  );

  attachProxy(publicServer, {
    registry,
    config,
    onEvent: (event) => {
      // eslint-disable-next-line no-console
      console.log(`[traycer-remote gateway] proxy: ${JSON.stringify(event)}`);
    },
  });

  publicServer.listen(
    config.publicListen.port,
    config.publicListen.host,
    () => {
      // eslint-disable-next-line no-console
      console.log(
        `[traycer-remote gateway] public listener on ${config.publicListen.host}:${config.publicListen.port}`,
      );
    },
  );

  const shutdown = (): void => {
    publicServer.close();
    registrationServer.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
