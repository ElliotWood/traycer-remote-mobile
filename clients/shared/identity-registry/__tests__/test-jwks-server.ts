import { createServer, type Server } from "node:http";
import { generateKeyPairSync, type KeyObject } from "node:crypto";

/**
 * A real local HTTP server serving an OpenID metadata doc + JWKS, so the
 * validator's `fetch()` calls are genuine network round trips against a
 * locally generated keypair — not a mocked transport. Mirrors
 * `clients/teams-bot/src/auth/__tests__/test-jwks-server.ts`'s pattern
 * (same repo, same technique, different issuer).
 */
export interface TestJwksServer {
  readonly openIdMetadataUrl: string;
  readonly kid: string;
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
  close(): Promise<void>;
}

export async function startTestJwksServer(): Promise<TestJwksServer> {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const kid = "test-key-1";
  const jwk = {
    ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>),
    kid,
    use: "sig",
    alg: "RS256",
  };

  let port = 0;
  function baseUrl(): string {
    return `http://127.0.0.1:${port}`;
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    res.setHeader("content-type", "application/json");
    if (url.pathname === "/.well-known/openid-configuration") {
      res.end(JSON.stringify({ jwks_uri: `${baseUrl()}/keys` }));
      return;
    }
    if (url.pathname === "/keys") {
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolve();
    });
  });

  return {
    openIdMetadataUrl: `${baseUrl()}/.well-known/openid-configuration`,
    kid,
    privateKeyPem: exportPem(privateKey, "pkcs8"),
    publicKeyPem: exportPem(publicKey, "spki"),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

function exportPem(key: KeyObject, type: "pkcs8" | "spki"): string {
  return key.export({ type, format: "pem" }) as string;
}
