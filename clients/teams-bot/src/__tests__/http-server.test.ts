import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import jwt from "jsonwebtoken";
import {
  DEFAULT_AUTH_CONFIG,
  resetBotFrameworkJwtCachesForTests,
  type BotFrameworkAuthConfig,
} from "../auth/bot-framework-jwt";
import {
  startTestJwksServer,
  type TestJwksServer,
} from "../auth/__tests__/test-jwks-server";
import {
  createHttpServer,
  MAX_ACTIVITY_BODY_BYTES,
  type ActivityHandlerLike,
  type AdapterLike,
} from "../http-server";

const AUDIENCE = "11111111-2222-3333-4444-555555555555";
const SERVICE_URL = "https://smba.trafficmanager.net/amer/";

type ProcessFn = AdapterLike["process"];
type RunFn = ActivityHandlerLike["run"];

describe("http-server: /api/messages is gated end-to-end by the JWT validator", () => {
  let jwks: TestJwksServer;
  let config: BotFrameworkAuthConfig;
  let server: Server;
  let baseUrl: string;
  let processSpy: Mock<ProcessFn>;
  let runSpy: Mock<RunFn>;

  beforeAll(async () => {
    jwks = await startTestJwksServer();
    config = {
      ...DEFAULT_AUTH_CONFIG,
      openIdMetadataUrl: jwks.openIdMetadataUrl,
      audience: AUDIENCE,
    };
  });

  afterAll(async () => {
    await jwks.close();
  });

  beforeAll(async () => {
    const processImpl: ProcessFn = async (_request, res) => {
      res.status(200);
      res.send({ ok: true });
    };
    processSpy = vi.fn(processImpl);
    const runImpl: RunFn = async (_context) => {};
    runSpy = vi.fn(runImpl);
    const adapter: AdapterLike = { process: processSpy };
    const handler: ActivityHandlerLike = { run: runSpy };
    server = createHttpServer({ adapter, handler, authConfig: config });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(() => {
    resetBotFrameworkJwtCachesForTests();
    processSpy.mockClear();
    runSpy.mockClear();
  });

  function sign(claims: Record<string, unknown>): string {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      {
        iss: DEFAULT_AUTH_CONFIG.issuer,
        aud: AUDIENCE,
        serviceurl: SERVICE_URL,
        iat: now,
        exp: now + 600,
        ...claims,
      },
      jwks.privateKeyPem,
      { algorithm: "RS256", keyid: jwks.kid },
    );
  }

  it("GET /healthz responds 200 without auth and never touches the adapter", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(processSpy).not.toHaveBeenCalled();
  });

  it("valid token: reaches the adapter, which is where the activity handler runs", async () => {
    const res = await fetch(`${baseUrl}/api/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sign({})}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "message",
        text: "hi",
        serviceUrl: SERVICE_URL,
        conversation: { id: "c1" },
      }),
    });
    expect(res.status).toBe(200);
    expect(processSpy).toHaveBeenCalledTimes(1);
  });

  it("missing Authorization header: 403, adapter never called, handler never runs", async () => {
    const res = await fetch(`${baseUrl}/api/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "message",
        text: "hi",
        serviceUrl: SERVICE_URL,
        conversation: { id: "c1" },
      }),
    });
    expect(res.status).toBe(403);
    expect(processSpy).not.toHaveBeenCalled();
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("expired token: 403, adapter never called, handler never runs", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = sign({ iat: now - 4000, exp: now - 1000 });
    const res = await fetch(`${baseUrl}/api/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "message",
        text: "hi",
        serviceUrl: SERVICE_URL,
        conversation: { id: "c1" },
      }),
    });
    expect(res.status).toBe(403);
    expect(processSpy).not.toHaveBeenCalled();
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("wrong audience: 403, adapter never called", async () => {
    const token = sign({ aud: "not-our-app-id" });
    const res = await fetch(`${baseUrl}/api/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "message",
        text: "hi",
        serviceUrl: SERVICE_URL,
        conversation: { id: "c1" },
      }),
    });
    expect(res.status).toBe(403);
    expect(processSpy).not.toHaveBeenCalled();
  });

  it("serviceUrl claim mismatch: 403, adapter never called", async () => {
    const token = sign({});
    const res = await fetch(`${baseUrl}/api/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "message",
        text: "hi",
        serviceUrl: "https://attacker.example.com/",
        conversation: { id: "c1" },
      }),
    });
    expect(res.status).toBe(403);
    expect(processSpy).not.toHaveBeenCalled();
  });

  it("malformed JSON body: 400, adapter never called", async () => {
    const res = await fetch(`${baseUrl}/api/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sign({})}`,
        "content-type": "application/json",
      },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(processSpy).not.toHaveBeenCalled();
  });

  it("oversized body: 413, adapter never called — cap enforced pre-auth, even with no Authorization header at all", async () => {
    const oversized = "a".repeat(MAX_ACTIVITY_BODY_BYTES + 1024);
    const res = await fetch(`${baseUrl}/api/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padding: oversized }),
    });
    expect(res.status).toBe(413);
    expect(processSpy).not.toHaveBeenCalled();
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("response body never leaks the specific rejection reason", async () => {
    const res = await fetch(`${baseUrl}/api/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "message",
        serviceUrl: SERVICE_URL,
        conversation: { id: "c1" },
      }),
    });
    const body: unknown = await res.json();
    expect(JSON.stringify(body)).not.toMatch(
      /missing_authorization_header|audience_mismatch|issuer_mismatch/,
    );
  });
});
