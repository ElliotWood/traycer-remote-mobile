import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Attachment } from "@microsoft/agents-activity";
import jwt from "jsonwebtoken";
import { IdentityRegistry } from "@traycer-clients/shared/identity-registry/registry";
import {
  validateAadIdToken,
  type AadIdTokenConfig,
} from "@traycer-clients/shared/identity-registry/aad-id-token";
import type { VerifiedPrincipal } from "@traycer-clients/shared/identity-registry/types";
import {
  startTestJwksServer,
  type TestJwksServer,
} from "../../auth/__tests__/test-jwks-server";
import { dispatchCommand, type DispatchDeps } from "../dispatch";
import { InMemoryEpicBindingStore } from "../epic-binding-store";
import type { OneShotSpawnFn } from "../one-shot-spawn";
import type { ResolvePrincipal } from "../principal-source";

const AUDIENCE = "22222222-3333-4444-5555-666666666666";
const ALICE_OID = "aaaaaaaa-1111-1111-1111-111111111111";
const UNMAPPED_OID = "cccccccc-3333-3333-3333-333333333333";

function bodyOf(attachment: Attachment): string {
  return JSON.stringify(attachment.content);
}

describe("read-surface/dispatch — routing and identity gating", () => {
  let jwks: TestJwksServer;
  let aliceP: VerifiedPrincipal;
  let unmappedP: VerifiedPrincipal;
  let registry: IdentityRegistry;

  beforeAll(async () => {
    jwks = await startTestJwksServer();
    const config: AadIdTokenConfig = {
      issuer: "https://login.microsoftonline.com/test-tenant/v2.0",
      openIdMetadataUrl: jwks.openIdMetadataUrl,
      audience: AUDIENCE,
      clockSkewSeconds: 300,
      jwksCacheMaxAgeMs: 24 * 60 * 60 * 1000,
      fetchTimeoutMs: 5000,
    };
    const sign = (oid: string): string => {
      const now = Math.floor(Date.now() / 1000);
      return jwt.sign(
        { iss: config.issuer, aud: AUDIENCE, oid, iat: now, exp: now + 600 },
        jwks.privateKeyPem,
        { algorithm: "RS256", keyid: jwks.kid },
      );
    };
    aliceP = {
      kind: "entra",
      oid: await validateAadIdToken({
        token: sign(ALICE_OID),
        config,
        now: Date.now,
      }),
    };
    unmappedP = {
      kind: "entra",
      oid: await validateAadIdToken({
        token: sign(UNMAPPED_OID),
        config,
        now: Date.now,
      }),
    };
    registry = IdentityRegistry.fromConfig(
      {
        tenants: [
          {
            home: "/tenants/alice",
            hostId: "alice-host",
            entraOid: ALICE_OID,
            traycerUserId: null,
          },
        ],
      },
      () => {},
    );
  });

  afterAll(async () => {
    await jwks.close();
  });

  function makeDeps(opts: {
    readonly resolvePrincipal: ResolvePrincipal;
    readonly spawnFn: OneShotSpawnFn;
    readonly epicBindings: InMemoryEpicBindingStore;
  }): DispatchDeps {
    return {
      registry,
      epicBindings: opts.epicBindings,
      bridgeCliConfig: {
        command: "/absolute/traycer-remote-bridge",
        timeoutMs: 5000,
        spawnFn: opts.spawnFn,
      },
      senderAgentId: "teams-bot",
      parentEnv: {},
      resolvePrincipal: opts.resolvePrincipal,
    };
  }

  const resolvesTo = (principal: VerifiedPrincipal): ResolvePrincipal => {
    return async () => ({ kind: "resolved", principal });
  };

  const neverSpawns: OneShotSpawnFn = async () => {
    throw new Error("spawn must not be reached in this test");
  };

  it("help renders without resolving an identity at all — no identity needed to learn the commands", async () => {
    let resolveCalled = false;
    const resolvePrincipal: ResolvePrincipal = async () => {
      resolveCalled = true;
      return { kind: "unavailable", reason: "should not be called" };
    };
    const deps = makeDeps({
      resolvePrincipal,
      spawnFn: neverSpawns,
      epicBindings: new InMemoryEpicBindingStore(),
    });

    const card = await dispatchCommand({ kind: "help" }, "conv-1", deps);

    expect(bodyOf(card)).toContain("Traycer Remote");
    expect(resolveCalled).toBe(false);
  });

  it("INVARIANT: when identity is unavailable, no host data is fetched for any data command", async () => {
    const resolvePrincipal: ResolvePrincipal = async () => ({
      kind: "unavailable",
      reason: "SSO token exchange not configured",
    });
    const epicBindings = new InMemoryEpicBindingStore();
    await epicBindings.set("conv-1", "epic-1");
    const deps = makeDeps({
      resolvePrincipal,
      spawnFn: neverSpawns,
      epicBindings,
    });

    for (const command of [
      { kind: "fleet" } as const,
      { kind: "epics" } as const,
      { kind: "chat", chatId: "c-1" } as const,
      { kind: "bind_epic", epicId: "e-1" } as const,
    ]) {
      const card = await dispatchCommand(command, "conv-1", deps);
      // `neverSpawns` throwing would fail the test; reaching here means no
      // fetch was attempted. The card must also say so honestly.
      expect(bodyOf(card)).toContain("Couldn't verify who you are");
    }
  });

  it("an unmapped-but-verified principal is refused, and never reaches a spawn", async () => {
    const epicBindings = new InMemoryEpicBindingStore();
    await epicBindings.set("conv-1", "epic-1");
    const deps = makeDeps({
      resolvePrincipal: resolvesTo(unmappedP),
      spawnFn: neverSpawns,
      epicBindings,
    });

    const card = await dispatchCommand({ kind: "fleet" }, "conv-1", deps);

    expect(bodyOf(card)).toContain("Access denied");
    expect(bodyOf(card)).toContain("unmapped_principal");
  });

  it("an unmapped principal cannot write an epic binding it could never use", async () => {
    const epicBindings = new InMemoryEpicBindingStore();
    const deps = makeDeps({
      resolvePrincipal: resolvesTo(unmappedP),
      spawnFn: neverSpawns,
      epicBindings,
    });

    const card = await dispatchCommand(
      { kind: "bind_epic", epicId: "e-1" },
      "conv-1",
      deps,
    );

    expect(bodyOf(card)).toContain("Access denied");
    expect(await epicBindings.get("conv-1")).toBeNull();
  });

  it("a mapped principal binds an epic, then fleet renders that tenant's agents", async () => {
    const epicBindings = new InMemoryEpicBindingStore();
    const spawnFn: OneShotSpawnFn = async (_cmd, _args, options) => {
      expect(options.env.HOME).toBe("/tenants/alice");
      expect(options.env.TRAYCER_EPIC_ID).toBe("epic-42");
      return {
        code: 0,
        stdout: JSON.stringify([
          {
            agentId: "a-1",
            title: "Alice's agent",
            harnessId: "claude",
            surface: "gui",
            active: true,
          },
        ]),
        stderr: "",
        timedOut: false,
      };
    };
    const deps = makeDeps({
      resolvePrincipal: resolvesTo(aliceP),
      spawnFn,
      epicBindings,
    });

    const bound = await dispatchCommand(
      { kind: "bind_epic", epicId: "epic-42" },
      "conv-1",
      deps,
    );
    expect(bodyOf(bound)).toContain("Epic selected");

    const fleet = await dispatchCommand({ kind: "fleet" }, "conv-1", deps);
    expect(bodyOf(fleet)).toContain("Alice's agent");
  });

  it("fleet before an epic is bound tells the user how to bind one, rather than failing opaquely", async () => {
    const deps = makeDeps({
      resolvePrincipal: resolvesTo(aliceP),
      spawnFn: neverSpawns,
      epicBindings: new InMemoryEpicBindingStore(),
    });

    const card = await dispatchCommand({ kind: "fleet" }, "conv-1", deps);

    expect(bodyOf(card)).toContain("No epic selected");
  });

  it("a bridge failure renders an honest error card, not an empty fleet", async () => {
    const epicBindings = new InMemoryEpicBindingStore();
    await epicBindings.set("conv-1", "epic-1");
    const spawnFn: OneShotSpawnFn = async () => ({
      code: 1,
      stdout: "",
      stderr: "remote-bridge: not signed in",
      timedOut: false,
    });
    const deps = makeDeps({
      resolvePrincipal: resolvesTo(aliceP),
      spawnFn,
      epicBindings,
    });

    const card = await dispatchCommand({ kind: "fleet" }, "conv-1", deps);

    const body = bodyOf(card);
    expect(body).toContain("Couldn't reach your Traycer host");
    expect(body).not.toContain("No agents in this epic yet");
  });
});
