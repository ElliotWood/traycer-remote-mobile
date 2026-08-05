import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type {
  ActivityHandler,
  CloudAdapter,
  Request as HostingRequest,
} from "@microsoft/agents-hosting";
import type { JwtPayload } from "jsonwebtoken";
import {
  BotFrameworkAuthError,
  type BotFrameworkAuthConfig,
  validateBotFrameworkActivityRequest,
} from "./auth/bot-framework-jwt";
import { logError, logWarn } from "./logger";
import { toWebResponse } from "./web-response-adapter";

/** Minimal structural slices of the SDK types this module actually calls — keeps the dependency injectable for tests without a nominal-class mock. */
export type AdapterLike = Pick<CloudAdapter, "process">;
export type ActivityHandlerLike = Pick<ActivityHandler, "run">;

export interface CreateHttpServerDeps {
  readonly adapter: AdapterLike;
  readonly handler: ActivityHandlerLike;
  readonly authConfig: BotFrameworkAuthConfig;
}

/**
 * Bot Framework activities are small; this is generous. Enforced WHILE
 * streaming (`readJsonBody` destroys the socket the instant the running
 * total crosses this), not after buffering — an unauthenticated pre-auth
 * body-size cap is what stands between this endpoint, once public, and
 * trivial remote memory exhaustion. Measured before this existed: an
 * unauthenticated 64MB POST grew process RSS by ~93.5MB while never
 * reaching the adapter or handler — the auth boundary held, but the process
 * doesn't survive many of those concurrently.
 */
export const MAX_ACTIVITY_BODY_BYTES = 1024 * 1024;

export class RequestBodyTooLargeError extends Error {}

/**
 * Routes: `GET /healthz` (unauthenticated, minimal — no host/session detail,
 * safe to leave off a public tunnel or on it) and `POST /api/messages` (the
 * only path that matters once this is reachable from the internet — see the
 * T0a ticket). Every `/api/messages` request passes through
 * `validateBotFrameworkActivityRequest` before `adapter.process()` is ever
 * called; a rejection returns 403 and `next` is never reached, so the
 * activity handler cannot run on an unauthenticated request. There is no
 * other route that reaches the handler.
 */
export function createHttpServer(deps: CreateHttpServerDeps): Server {
  return createServer((req, res) => {
    void handleRequest(req, res, deps);
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: CreateHttpServerDeps,
): Promise<void> {
  const method = req.method ?? "GET";
  const path = new URL(req.url ?? "/", "http://localhost").pathname;

  try {
    if (method === "GET" && path === "/healthz") {
      sendJson(res, 200, { status: "ok" });
      return;
    }
    if (method === "POST" && path === "/api/messages") {
      await handleMessages(req, res, deps);
      return;
    }
    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    logError("unhandled request error", {
      message: err instanceof Error ? err.message : "unknown",
    });
    if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
  }
}

async function handleMessages(
  req: IncomingMessage,
  res: ServerResponse,
  deps: CreateHttpServerDeps,
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req, MAX_ACTIVITY_BODY_BYTES);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      sendJson(res, 413, { error: "request body too large" });
      return;
    }
    sendJson(res, 400, { error: "malformed request body" });
    return;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    sendJson(res, 400, { error: "request body must be a JSON object" });
    return;
  }
  const parsedBody = body as Record<string, unknown>;
  const activityServiceUrl =
    typeof parsedBody.serviceUrl === "string"
      ? parsedBody.serviceUrl
      : undefined;

  let identity: JwtPayload;
  try {
    identity = await validateBotFrameworkActivityRequest({
      authorizationHeader: singleHeaderValue(req.headers.authorization),
      activityServiceUrl,
      config: deps.authConfig,
      now: Date.now,
    });
  } catch (err) {
    const reason =
      err instanceof BotFrameworkAuthError ? err.reason : "invalid_token";
    logWarn("rejected inbound activity", { reason });
    // 403 per the Connector API auth spec. Body deliberately generic — the
    // specific rejection reason is logged server-side only, not handed back
    // to whoever is knocking on what is now a public endpoint.
    sendJson(res, 403, { error: "unauthorized" });
    return;
  }

  // `request.user` is what `CloudAdapter.process()` trusts as the caller's
  // identity — it performs no validation of its own (see bot-framework-jwt.ts's
  // docblock). This assignment IS the authentication boundary; every path
  // that reaches here has already passed validateBotFrameworkActivityRequest.
  const botRequest: HostingRequest = {
    body: parsedBody,
    headers: req.headers,
    method: req.method,
    user: identity,
  };

  await deps.adapter.process(
    botRequest,
    toWebResponse(res),
    async (context) => {
      await deps.handler.run(context);
    },
  );
}

function singleHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  let exceeded = false;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > maxBytes) {
      // Past the cap: stop growing `chunks` (that's the memory bound), but
      // keep draining the stream to completion rather than destroying the
      // socket mid-read. Destroying here races the client's in-flight
      // upload — the client can be left writing to an already-reset socket
      // before it ever sees the 413, which surfaces as a raw connection
      // error instead of a diagnosable response. Draining costs bounded
      // per-chunk memory (one Buffer at a time, immediately discarded), not
      // the unbounded accumulation this cap exists to prevent.
      exceeded = true;
      continue;
    }
    chunks.push(buf);
  }
  if (exceeded) {
    throw new RequestBodyTooLargeError(
      `request body exceeds ${maxBytes} bytes`,
    );
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) return {};
  return JSON.parse(raw);
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(payload);
}
