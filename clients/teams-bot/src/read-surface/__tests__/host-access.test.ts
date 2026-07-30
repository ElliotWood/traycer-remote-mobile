import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import {
  fetchChatStatus,
  fetchFleet,
  type HostAccessDeps,
} from "../host-access";
import { InMemoryEpicBindingStore } from "../epic-binding-store";
import type { BridgeCliConfig } from "../bridge-cli";
import type { OneShotSpawnFn, OneShotSpawnResult } from "../one-shot-spawn";

/**
 * Two layers, neither needing a live Teams tenant or live Azure AD:
 *
 * Layer 1 (identity resolution): mints two genuinely valid Entra ID tokens
 * against a local JWKS server, runs them through the REAL
 * `validateAadIdToken` (never a cast, per A2's seam obligation), and proves
 * `resolveTenant` maps each to a distinct tenant while a third, unmapped
 * principal is refused.
 *
 * Layer 2 (spawn plumbing): a fixture `OneShotSpawnFn` keyed on the REAL
 * `buildTenantEnvironment` output (not a mock of it) proves tenant A's
 * fetch can never return tenant B's fixture data.
 */

const AUDIENCE = "22222222-3333-4444-5555-666666666666";
const TENANT_A_OID = "aaaaaaaa-1111-1111-1111-111111111111";
const TENANT_B_OID = "bbbbbbbb-2222-2222-2222-222222222222";
const UNMAPPED_OID = "cccccccc-3333-3333-3333-333333333333";
const SENDER_AGENT_ID = "teams-bot";

describe("read-surface/host-access — identity resolution + spawn isolation", () => {
  let jwks: TestJwksServer;
  let aadConfig: AadIdTokenConfig;
  let principalA: VerifiedPrincipal;
  let principalB: VerifiedPrincipal;
  let principalUnmapped: VerifiedPrincipal;
  let registry: IdentityRegistry;

  beforeAll(async () => {
    jwks = await startTestJwksServer();
    aadConfig = {
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
        { iss: aadConfig.issuer, aud: AUDIENCE, oid, iat: now, exp: now + 600 },
        jwks.privateKeyPem,
        { algorithm: "RS256", keyid: jwks.kid },
      );
    };

    const oidA = await validateAadIdToken({
      token: sign(TENANT_A_OID),
      config: aadConfig,
      now: Date.now,
    });
    const oidB = await validateAadIdToken({
      token: sign(TENANT_B_OID),
      config: aadConfig,
      now: Date.now,
    });
    const oidUnmapped = await validateAadIdToken({
      token: sign(UNMAPPED_OID),
      config: aadConfig,
      now: Date.now,
    });
    principalA = { kind: "entra", oid: oidA };
    principalB = { kind: "entra", oid: oidB };
    principalUnmapped = { kind: "entra", oid: oidUnmapped };

    registry = IdentityRegistry.fromConfig(
      {
        tenants: [
          {
            home: "/tenants/alice",
            hostId: "alice-host",
            entraOid: TENANT_A_OID,
            traycerUserId: null,
          },
          {
            home: "/tenants/bob",
            hostId: "bob-host",
            entraOid: TENANT_B_OID,
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

  it("Layer 1: two genuinely valid, differently-issued principals resolve to two distinct tenants", () => {
    const resolutionA = registry.resolveTenant(principalA);
    const resolutionB = registry.resolveTenant(principalB);
    expect(resolutionA.kind).toBe("resolved");
    expect(resolutionB.kind).toBe("resolved");
    if (resolutionA.kind !== "resolved" || resolutionB.kind !== "resolved")
      return;
    expect(resolutionA.tenant.hostId).toBe("alice-host");
    expect(resolutionB.tenant.hostId).toBe("bob-host");
    expect(resolutionA.tenant.hostId).not.toBe(resolutionB.tenant.hostId);
  });

  it("Layer 1: a third, unmapped principal is refused — no default host, no fallback", () => {
    const resolution = registry.resolveTenant(principalUnmapped);
    expect(resolution.kind).toBe("refused");
    if (resolution.kind !== "refused") return;
    expect(resolution.reason).toBe("unmapped_principal");
  });

  function makeFixtureSpawnFn(
    fixtures: ReadonlyMap<string, unknown>,
  ): OneShotSpawnFn {
    return async (_command, _args, options): Promise<OneShotSpawnResult> => {
      const home = options.env.HOME;
      const fixture = home !== undefined ? fixtures.get(home) : undefined;
      if (fixture === undefined) {
        return {
          code: 1,
          stdout: "",
          stderr: `no fixture for HOME=${String(home)}`,
          timedOut: false,
        };
      }
      return {
        code: 0,
        stdout: JSON.stringify(fixture),
        stderr: "",
        timedOut: false,
      };
    };
  }

  function makeDeps(
    spawnFn: OneShotSpawnFn,
    epicBindings: InMemoryEpicBindingStore,
  ): HostAccessDeps {
    const bridgeCliConfig: BridgeCliConfig = {
      command: "/absolute/path/to/traycer-remote-bridge",
      timeoutMs: 5000,
      spawnFn,
    };
    return {
      registry,
      epicBindings,
      bridgeCliConfig,
      senderAgentId: SENDER_AGENT_ID,
      parentEnv: {},
    };
  }

  it("Layer 2: fetchFleet spawns with the REAL buildTenantEnvironment HOME, and tenant A's data never reaches tenant B's request", async () => {
    const fleetA = [
      {
        agentId: "a-1",
        title: "Alice's agent",
        harnessId: "claude",
        surface: "gui" as const,
        active: true,
        isLocal: true,
        hostId: "h-1",
      },
    ];
    const fleetB = [
      {
        agentId: "b-1",
        title: "Bob's agent",
        harnessId: "codex",
        surface: "tui" as const,
        active: false,
        isLocal: true,
        hostId: "h-1",
      },
    ];
    const spawnFn = makeFixtureSpawnFn(
      new Map<string, unknown>([
        ["/tenants/alice", fleetA],
        ["/tenants/bob", fleetB],
      ]),
    );
    const epicBindings = new InMemoryEpicBindingStore();
    await epicBindings.set("conversation-a", "epic-a");
    await epicBindings.set("conversation-b", "epic-b");
    const deps = makeDeps(spawnFn, epicBindings);

    const resultA = await fetchFleet(principalA, "conversation-a", deps);
    const resultB = await fetchFleet(principalB, "conversation-b", deps);

    expect(resultA).toEqual({ kind: "ok", agents: fleetA });
    expect(resultB).toEqual({ kind: "ok", agents: fleetB });
    expect(resultA).not.toEqual(resultB);
  });

  it("Layer 2: an unmapped principal never reaches the spawn at all — refused before any process runs", async () => {
    let spawnCalled = false;
    const spawnFn: OneShotSpawnFn = async () => {
      spawnCalled = true;
      return { code: 0, stdout: "[]", stderr: "", timedOut: false };
    };
    const epicBindings = new InMemoryEpicBindingStore();
    await epicBindings.set("conversation-x", "epic-x");
    const deps = makeDeps(spawnFn, epicBindings);

    const result = await fetchFleet(principalUnmapped, "conversation-x", deps);

    expect(result).toEqual({
      kind: "principal_refused",
      reason: "unmapped_principal",
    });
    expect(spawnCalled).toBe(false);
  });

  it("a conversation with no epic binding refuses before spawning, for a mapped principal", async () => {
    let spawnCalled = false;
    const spawnFn: OneShotSpawnFn = async () => {
      spawnCalled = true;
      return { code: 0, stdout: "[]", stderr: "", timedOut: false };
    };
    const deps = makeDeps(spawnFn, new InMemoryEpicBindingStore());

    const result = await fetchFleet(principalA, "unbound-conversation", deps);

    expect(result).toEqual({ kind: "epic_not_bound" });
    expect(spawnCalled).toBe(false);
  });

  it("fetchChatStatus carries the same isolation guarantee as fetchFleet", async () => {
    const statusA = {
      chatId: "chat-a",
      title: "Alice's chat",
      runStatus: "running" as const,
      pendingApprovals: [],
      pendingInterviews: [],
      connected: true,
    };
    const spawnFn = makeFixtureSpawnFn(
      new Map<string, unknown>([["/tenants/alice", statusA]]),
    );
    const epicBindings = new InMemoryEpicBindingStore();
    await epicBindings.set("conversation-a", "epic-a");
    const deps = makeDeps(spawnFn, epicBindings);

    const result = await fetchChatStatus(
      principalA,
      "conversation-a",
      "chat-a",
      deps,
    );

    // `epicId` comes back alongside the status so cards can show which epic a
    // decision belongs to without re-reading the binding store.
    expect(result).toEqual({ kind: "ok", status: statusA, epicId: "epic-a" });
  });

  it("a nonzero bridge exit surfaces as bridge_unavailable, not a thrown error or silent empty result", async () => {
    const spawnFn: OneShotSpawnFn = async () => ({
      code: 1,
      stdout: "",
      stderr: "remote-bridge: not signed in",
      timedOut: false,
    });
    const epicBindings = new InMemoryEpicBindingStore();
    await epicBindings.set("conversation-a", "epic-a");
    const deps = makeDeps(spawnFn, epicBindings);

    const result = await fetchFleet(principalA, "conversation-a", deps);

    expect(result.kind).toBe("bridge_unavailable");
  });
});
