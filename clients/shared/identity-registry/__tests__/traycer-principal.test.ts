import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import {
  verifyTraycerPrincipal,
  inFlightVerificationsForTests,
  DEFAULT_MAX_CONCURRENT_VERIFICATIONS,
} from "../traycer-principal";
import { IdentityRegistry } from "../registry";

/**
 * Real local HTTP server standing in for Traycer's authn, so the verifier's
 * `fetch` is a genuine network round trip rather than a stubbed function —
 * the same technique `aad-id-token.test.ts` uses for JWKS. What is synthetic
 * here is the authn service, not the transport.
 */
interface FakeAuthn {
  readonly baseUrl: string;
  setResponse(status: number, body: unknown): void;
  lastAuthorization(): string | null;
  requestCount(): number;
  close(): Promise<void>;
}

async function startFakeAuthn(): Promise<FakeAuthn> {
  let status = 200;
  let body: unknown = { user: { id: "traycer-user-alice" } };
  let lastAuth: string | null = null;
  let count = 0;

  const server: Server = createServer((req, res) => {
    count += 1;
    lastAuth = req.headers.authorization ?? null;
    if (req.url !== "/api/v3/user") {
      res.statusCode = 404;
      res.end("{}");
      return;
    }
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  });

  let port = 0;
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolve();
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    setResponse: (s, b) => {
      status = s;
      body = b;
    },
    lastAuthorization: () => lastAuth,
    requestCount: () => count,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

let authn: FakeAuthn;

beforeEach(async () => {
  authn = await startFakeAuthn();
});

afterEach(async () => {
  await authn.close();
});

function verifyAt(bearer: string, baseUrl: string) {
  return verifyTraycerPrincipal({
    bearer,
    authnBaseUrl: baseUrl,
    timeoutMs: 5000,
    fetchImpl: fetch,
    maxConcurrent: DEFAULT_MAX_CONCURRENT_VERIFICATIONS,
  });
}

function verify(bearer: string) {
  return verifyAt(bearer, authn.baseUrl);
}

describe("verifyTraycerPrincipal — the identity comes from the issuer, not the client", () => {
  it("mints a traycer principal from the user id the authn service returns", async () => {
    authn.setResponse(200, { user: { id: "traycer-user-alice" } });
    const result = await verify("a-real-looking-bearer");
    expect(result).toEqual({
      kind: "verified",
      principal: { kind: "traycer", userId: "traycer-user-alice" },
    });
  });

  it("presents the bearer as an Authorization header to authn", async () => {
    await verify("the-presented-token");
    expect(authn.lastAuthorization()).toBe("Bearer the-presented-token");
  });

  it("THE CORE PROPERTY: the caller's token does not determine the identity — authn does", async () => {
    // Same bearer string, two different authn verdicts, two different
    // identities. Proves the returned identity is read from the issuer's
    // response and never parsed out of the token the client supplied.
    authn.setResponse(200, { user: { id: "traycer-user-alice" } });
    const asAlice = await verify("identical-token");
    authn.setResponse(200, { user: { id: "traycer-user-bob" } });
    const asBob = await verify("identical-token");

    if (asAlice.kind !== "verified" || asBob.kind !== "verified") {
      throw new Error("expected both verified");
    }
    if (asAlice.principal.kind !== "traycer" || asBob.principal.kind !== "traycer") {
      throw new Error("expected traycer principals");
    }
    expect(asAlice.principal.userId).toBe("traycer-user-alice");
    expect(asBob.principal.userId).toBe("traycer-user-bob");
  });

  it("a self-signed JWT naming another user is worth nothing — only authn's answer counts", async () => {
    // The attack the local-decode prohibition exists to stop: an attacker
    // mints an unsigned JWT whose payload claims to be alice. This verifier
    // never reads the token's contents, so authn's rejection is the whole
    // story.
    const forged =
      Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url") +
      "." +
      Buffer.from(JSON.stringify({ sub: "traycer-user-alice" })).toString("base64url") +
      ".";
    authn.setResponse(401, { error: "unauthorized" });
    const result = await verify(forged);
    expect(result).toEqual({ kind: "failed", reason: "rejected" });
  });
});

describe("verifyTraycerPrincipal — fails closed on every non-success", () => {
  it("401 -> rejected", async () => {
    authn.setResponse(401, { error: "unauthorized" });
    expect(await verify("t")).toEqual({ kind: "failed", reason: "rejected" });
  });

  it("403 -> rejected", async () => {
    authn.setResponse(403, {});
    expect(await verify("t")).toEqual({ kind: "failed", reason: "rejected" });
  });

  it("500 -> network_error (transient, still refused)", async () => {
    authn.setResponse(500, {});
    expect(await verify("t")).toEqual({ kind: "failed", reason: "network_error" });
  });

  it("authn unreachable -> network_error, never a guessed identity", async () => {
    const result = await verifyAt("t", "http://127.0.0.1:1");
    expect(result).toEqual({ kind: "failed", reason: "network_error" });
  });

  it("empty bearer -> rejected without even calling authn", async () => {
    const before = authn.requestCount();
    expect(await verify("")).toEqual({ kind: "failed", reason: "rejected" });
    expect(authn.requestCount()).toBe(before);
  });

  it("200 with a malformed body -> malformed_response", async () => {
    authn.setResponse(200, { user: {} });
    expect(await verify("t")).toEqual({ kind: "failed", reason: "malformed_response" });
  });

  it("200 with a non-string user id -> malformed_response", async () => {
    authn.setResponse(200, { user: { id: 12345 } });
    expect(await verify("t")).toEqual({ kind: "failed", reason: "malformed_response" });
  });

  it("200 with an empty-string user id -> malformed_response, never an empty identity", async () => {
    authn.setResponse(200, { user: { id: "" } });
    expect(await verify("t")).toEqual({ kind: "failed", reason: "malformed_response" });
  });

  it("200 with unparseable JSON -> malformed_response", async () => {
    authn.setResponse(200, "not json at all{{{");
    expect(await verify("t")).toEqual({ kind: "failed", reason: "malformed_response" });
  });
});

describe("verifyTraycerPrincipal + IdentityRegistry — the full browser routing path", () => {
  it("routes two different verified identities to two different tenants, end to end", async () => {
    const registry = IdentityRegistry.fromConfig(
      {
        tenants: [
          {
            home: "/srv/traycer/tenants/alice",
            hostId: "host-alice",
            traycerUserId: "traycer-user-alice",
          },
          {
            home: "/srv/traycer/tenants/bob",
            hostId: "host-bob",
            traycerUserId: "traycer-user-bob",
          },
        ],
      },
      () => {},
    );

    authn.setResponse(200, { user: { id: "traycer-user-alice" } });
    const aliceVerified = await verify("alice-token");
    if (aliceVerified.kind !== "verified") throw new Error("expected verified");
    const aliceTenant = registry.resolveTenant(aliceVerified.principal);

    authn.setResponse(200, { user: { id: "traycer-user-bob" } });
    const bobVerified = await verify("bob-token");
    if (bobVerified.kind !== "verified") throw new Error("expected verified");
    const bobTenant = registry.resolveTenant(bobVerified.principal);

    if (aliceTenant.kind !== "resolved" || bobTenant.kind !== "resolved") {
      throw new Error("expected both resolved");
    }
    expect(aliceTenant.tenant.home).toBe("/srv/traycer/tenants/alice");
    expect(bobTenant.tenant.home).toBe("/srv/traycer/tenants/bob");
    expect(aliceTenant.tenant.home).not.toBe(bobTenant.tenant.home);
  });

  it("a verified identity absent from the registry is refused — authentic but unmapped is still no route", async () => {
    const registry = IdentityRegistry.fromConfig(
      {
        tenants: [
          {
            home: "/srv/traycer/tenants/alice",
            hostId: "host-alice",
            traycerUserId: "traycer-user-alice",
          },
        ],
      },
      () => {},
    );
    authn.setResponse(200, { user: { id: "traycer-user-stranger" } });
    const verified = await verify("a-perfectly-valid-token-for-someone-unmapped");
    if (verified.kind !== "verified") throw new Error("expected verified");
    expect(registry.resolveTenant(verified.principal)).toEqual({
      kind: "refused",
      reason: "unmapped_principal",
    });
  });
});

describe("verifyTraycerPrincipal — the concurrency ceiling (amplification guard)", () => {
  /**
   * An authn that blocks until released, so real verifications can be held
   * in flight simultaneously rather than simulated with a counter.
   */
  async function startBlockingAuthn(): Promise<{
    baseUrl: string;
    release: () => void;
    close: () => Promise<void>;
  }> {
    const waiting: Array<() => void> = [];
    let holding = true;
    const respond = (res: import("node:http").ServerResponse): void => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ user: { id: "traycer-user-alice" } }));
    };
    const server = createServer((_req, res) => {
      // Once released, stop holding — otherwise the post-release recovery
      // call blocks too and the test measures the harness, not the cap.
      if (!holding) {
        respond(res);
        return;
      }
      waiting.push(() => respond(res));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    return {
      baseUrl: `http://127.0.0.1:${port}`,
      release: () => {
        holding = false;
        for (const w of waiting.splice(0)) w();
      },
      close: () =>
        new Promise<void>((resolve) => {
          holding = false;
          for (const w of waiting.splice(0)) w();
          server.close(() => resolve());
        }),
    };
  }

  it("refuses past the ceiling WITHOUT calling authn, then recovers once slots free", async () => {
    const blocking = await startBlockingAuthn();
    try {
      const cap = 3;
      const held = Array.from({ length: cap }, () =>
        verifyTraycerPrincipal({
          bearer: "t",
          authnBaseUrl: blocking.baseUrl,
          timeoutMs: 5000,
          fetchImpl: fetch,
          maxConcurrent: cap,
        }),
      );
      // Let the three in-flight requests actually reach the server.
      await new Promise((r) => setTimeout(r, 300));

      // The (cap+1)th must be refused immediately, without a network call.
      const overflow = await verifyTraycerPrincipal({
        bearer: "t",
        authnBaseUrl: blocking.baseUrl,
        timeoutMs: 5000,
        fetchImpl: fetch,
        maxConcurrent: cap,
      });
      expect(overflow).toEqual({ kind: "failed", reason: "capacity_exhausted" });

      blocking.release();
      const settled = await Promise.all(held);
      expect(settled.every((r) => r.kind === "verified")).toBe(true);

      // Slots freed: a fresh call succeeds again rather than staying wedged.
      const after = await verifyAt("t", blocking.baseUrl);
      expect(after.kind).toBe("verified");
    } finally {
      await blocking.close();
    }
  }, 20_000);

  it("leaks no slot on ANY exit path — the cap must not wedge itself closed", async () => {
    // Every failure mode in turn. A decrement missed on one of these would
    // permanently shrink the ceiling, turning the DoS guard into a DoS.
    authn.setResponse(401, {});
    await verify("t");
    authn.setResponse(500, {});
    await verify("t");
    authn.setResponse(200, { user: {} });
    await verify("t");
    authn.setResponse(200, "not json{{{");
    await verify("t");
    await verifyAt("t", "http://127.0.0.1:1"); // unreachable
    authn.setResponse(200, { user: { id: "traycer-user-alice" } });
    await verify("t"); // success path too
    expect(inFlightVerificationsForTests()).toBe(0);
  });

  it("the shipped default ceiling is a real bound, not unlimited", () => {
    expect(Number.isInteger(DEFAULT_MAX_CONCURRENT_VERIFICATIONS)).toBe(true);
    expect(DEFAULT_MAX_CONCURRENT_VERIFICATIONS).toBeGreaterThan(0);
    expect(DEFAULT_MAX_CONCURRENT_VERIFICATIONS).toBeLessThan(1000);
  });
});
