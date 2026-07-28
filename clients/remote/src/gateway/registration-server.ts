import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  agentRegisterRequestSchema,
  agentHeartbeatRequestSchema,
  agentUnregisterRequestSchema,
} from "../shared/wire-schemas";
import type { Registry } from "./registry";
import type { GatewayConfig } from "./config";

function timingSafeTokenEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Resolves a bearer token to the `agentId` it belongs to, or `null`. The
 * agent's identity IS the token match - a body's claimed `agentId` is never
 * trusted on its own (M1 contract). */
function resolveAgentIdFromToken(
  token: string,
  config: GatewayConfig,
): string | null {
  for (const [agentId, entry] of Object.entries(config.agents)) {
    if (timingSafeTokenEquals(token, entry.token)) return agentId;
  }
  return null;
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Internal agent registration/heartbeat listener. **Never** added to the
 * public serve map - it binds whatever interface `internalListen.host`
 * names (a private interface, never `0.0.0.0`) - and every call additionally
 * requires a per-agent bearer, so reachability on that interface alone is
 * not sufficient (M1 contract, rubric §3).
 */
export function startRegistrationServer(
  config: GatewayConfig,
  registry: Registry,
): http.Server {
  const server = http.createServer((req, res) => {
    void handleRequest(req, res, config, registry);
  });
  server.listen(config.internalListen.port, config.internalListen.host);
  return server;
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: GatewayConfig,
  registry: Registry,
): Promise<void> {
  const authHeader = req.headers.authorization ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader);
  const agentId = match === null ? null : resolveAgentIdFromToken(match[1], config);
  if (agentId === null) {
    sendJson(res, 401, { error: "UNAUTHORIZED" });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "INVALID_BODY" });
    return;
  }

  if (req.method === "POST" && req.url === "/agents/register") {
    const parsed = agentRegisterRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(res, 400, { error: "INVALID_BODY" });
      return;
    }
    // The resolved agentId (from the bearer) is authoritative, not the
    // body's claimed agentId - the payload otherwise updates hostId/label/
    // reachableUrl/version freely.
    registry.upsert({ ...parsed.data, agentId });
    sendJson(res, 200, {});
    return;
  }

  if (req.method === "POST" && req.url === "/agents/heartbeat") {
    const parsed = agentHeartbeatRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(res, 400, { error: "INVALID_BODY" });
      return;
    }
    registry.upsert({ ...parsed.data, agentId });
    sendJson(res, 200, {});
    return;
  }

  if (req.method === "POST" && req.url === "/agents/unregister") {
    const parsed = agentUnregisterRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(res, 400, { error: "INVALID_BODY" });
      return;
    }
    registry.markStopped(agentId);
    sendJson(res, 200, {});
    return;
  }

  sendJson(res, 404, { error: "NOT_FOUND" });
}
