import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { z } from "zod";
import { validateAuthTokenIdentityAccessOnly } from "@traycer-clients/shared/auth/auth-validation";
import type { PushSubscriptionKeys } from "./subscription-store";
import type { SubscriptionStore } from "./subscription-store";
import { logWarn } from "./logger";

/**
 * The same production AuthnV3 base URL the mobile client validates itself
 * against by default (`clients/mobile/src/config.ts`'s `AUTHN_BASE_URL`) —
 * the push service is production-only (see `host-auth.ts`), so there is no
 * dev-override concept to thread here; the two must agree on the same
 * authority for a mobile bearer to validate.
 */
const AUTHN_BASE_URL = "https://authn.traycer.ai";

const subscribeBodySchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const unsubscribeBodySchema = z.object({
  endpoint: z.string().min(1),
});

/** Injectable seam over the real AuthnV3 access-only check, so auth-gating tests don't need a network round trip. */
export type ValidateBearerFn = (token: string) => Promise<boolean>;

const defaultValidateBearer: ValidateBearerFn = async (token) => {
  const result = await validateAuthTokenIdentityAccessOnly(
    AUTHN_BASE_URL,
    token,
  );
  return result.kind === "valid";
};

export interface HttpApiDeps {
  readonly vapidPublicKey: string;
  readonly subscriptionStore: SubscriptionStore;
  readonly validateBearer?: ValidateBearerFn;
  readonly now?: () => number;
}

/**
 * Routes mounted PREFIX-FREE (`/vapid-public-key`, `/subscribe`,
 * `/unsubscribe`) — `tailscale serve --set-path=/push` strips the `/push`
 * prefix before proxying (confirmed live by both the Planner and the
 * Evaluator against the real tailnet origin), so a server that expected the
 * prefix would 404 on every real client request while appearing to work
 * against `127.0.0.1` directly. Every route requires a valid bearer.
 */
export function createHttpApiServer(deps: HttpApiDeps): Server {
  const validateBearer = deps.validateBearer ?? defaultValidateBearer;
  const now = deps.now ?? (() => Date.now());
  return createServer((req, res) => {
    void handleRequest(req, res, { ...deps, validateBearer, now });
  });
}

interface ResolvedDeps extends HttpApiDeps {
  readonly validateBearer: ValidateBearerFn;
  readonly now: () => number;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ResolvedDeps,
): Promise<void> {
  const method = req.method ?? "GET";
  const path = new URL(req.url ?? "/", "http://localhost").pathname;

  try {
    if (method === "GET" && path === "/vapid-public-key") {
      if (!(await authorize(req, res, deps.validateBearer))) return;
      sendJson(res, 200, { publicKey: deps.vapidPublicKey });
      return;
    }
    if (method === "POST" && path === "/subscribe") {
      if (!(await authorize(req, res, deps.validateBearer))) return;
      const body = await readJsonBody(req);
      const parsed = subscribeBodySchema.safeParse(body);
      if (!parsed.success) {
        sendJson(res, 400, { error: "invalid subscribe body" });
        return;
      }
      await deps.subscriptionStore.upsert(
        parsed.data.endpoint,
        parsed.data.keys satisfies PushSubscriptionKeys,
        deps.now(),
      );
      sendJson(res, 200, {});
      return;
    }
    if (method === "POST" && path === "/unsubscribe") {
      if (!(await authorize(req, res, deps.validateBearer))) return;
      const body = await readJsonBody(req);
      const parsed = unsubscribeBodySchema.safeParse(body);
      if (!parsed.success) {
        sendJson(res, 400, { error: "invalid unsubscribe body" });
        return;
      }
      await deps.subscriptionStore.remove(parsed.data.endpoint);
      sendJson(res, 200, {});
      return;
    }
    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    logWarn("http-api request failed", {
      message: err instanceof Error ? err.message : "unknown",
    });
    sendJson(res, 400, { error: "malformed request" });
  }
}

/** Returns `true` and lets the caller proceed; writes a 401 and returns `false` on any missing/invalid bearer. */
async function authorize(
  req: IncomingMessage,
  res: ServerResponse,
  validateBearer: ValidateBearerFn,
): Promise<boolean> {
  const header = req.headers.authorization;
  const token = extractBearerToken(header);
  if (token === null) {
    sendJson(res, 401, { error: "missing bearer" });
    return false;
  }
  const valid = await validateBearer(token);
  if (!valid) {
    sendJson(res, 401, { error: "invalid bearer" });
    return false;
  }
  return true;
}

function extractBearerToken(
  header: string | string[] | undefined,
): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) return null;
  const match = /^Bearer (.+)$/.exec(value);
  return match !== null && match[1].length > 0 ? match[1] : null;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
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
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(payload);
}
