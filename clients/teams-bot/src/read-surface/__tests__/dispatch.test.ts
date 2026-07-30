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
import { dispatchActionInvoke } from "../dispatch-action";
import { SEND_VERB } from "../cards";
import { InMemoryEpicBindingStore } from "../epic-binding-store";
import type { OneShotSpawnFn } from "../one-shot-spawn";
import type { ResolvePrincipal } from "../principal-source";

const AUDIENCE = "22222222-3333-4444-5555-666666666666";
const ALICE_OID = "aaaaaaaa-1111-1111-1111-111111111111";
const UNMAPPED_OID = "cccccccc-3333-3333-3333-333333333333";

/** `dispatchCommand` returns one OR MORE cards; assert across all of them. */
function bodyOf(cards: readonly Attachment[]): string {
  return JSON.stringify(cards.map((c) => c.content));
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
      now: Date.now,
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
    // Recognised failure, so the card names it specifically rather than
    // falling back to the generic "couldn't reach your host".
    expect(body).toContain("isn't signed in");
    expect(body).not.toContain("No agents in this epic yet");
  });

  it("CONTRACT: a failure card NEVER contains raw subprocess output", async () => {
    // This shipped. `fleet` rendered a card containing a JSON log line, an
    // internal stream-client message, a tenant filesystem path and a user
    // id — a stack trace in a product surface, and a disclosure to anyone
    // looking at the screen. The fixture below is the real thing, trimmed.
    const realGarbage = [
      '{"timestamp":"2026-07-30T10:50:51.185Z","level":"info",',
      '"message":"identity resolved","fields":"{"userId":"3e3d1309-0000-4000-8000-000000000000",',
      '"home":"/srv/traycer/tenants/somebody"}"}',
      "[stream] WsStreamClient closed (client=stream-client-1, reason=bridge-shutdown, sessions=0)",
      '[bridge] fatal: "exp" claim timestamp check failed',
    ].join(" ");

    const epicBindings = new InMemoryEpicBindingStore();
    await epicBindings.set("conv-1", "epic-1");
    const deps = makeDeps({
      resolvePrincipal: resolvesTo(aliceP),
      spawnFn: async () => ({
        code: 1,
        stdout: "",
        stderr: realGarbage,
        timedOut: false,
      }),
      epicBindings,
    });

    const body = bodyOf(
      await dispatchCommand({ kind: "fleet" }, "conv-1", deps),
    );

    // Nothing from the subprocess, by any route.
    expect(body).not.toContain("WsStreamClient");
    expect(body).not.toContain("/srv/traycer");
    expect(body).not.toContain("3e3d1309");
    expect(body).not.toContain("stream-client");
    // Scoped to the actual leaked token, not the bare word: `"exp"` alone
    // also matches the legitimate word "expired" in the new copy, which is
    // the same over-broad-assertion mistake made once already on UUIDs.
    expect(body).not.toContain('"exp" claim');
    expect(body).not.toContain("2026-07-30T10:50");
    expect(body).not.toContain("nonzero_exit");
    // And it still says something useful — the expiry is recognised.
    expect(body).toContain("expired");
  });
});

describe("read-surface/dispatch-action — the send path", () => {
  const CHAT_ID = "a1000000-0000-4000-8000-000000000004";

  function sendDeps(opts: {
    readonly resolvePrincipal: ResolvePrincipal;
    readonly spawnFn: OneShotSpawnFn;
    readonly bound?: boolean;
  }): DispatchDeps {
    const epicBindings = new InMemoryEpicBindingStore();
    if (opts.bound !== false) void epicBindings.set("conv-1", "epic-a");
    return {
      registry: sendRegistry,
      epicBindings,
      bridgeCliConfig: {
        command: "/absolute/traycer-remote-bridge",
        timeoutMs: 5000,
        spawnFn: opts.spawnFn,
      },
      senderAgentId: "teams-bot",
      parentEnv: {},
      resolvePrincipal: opts.resolvePrincipal,
      now: () => 0,
    };
  }

  let sendRegistry: IdentityRegistry;
  let alice: VerifiedPrincipal;
  let jwks2: TestJwksServer;

  beforeAll(async () => {
    jwks2 = await startTestJwksServer();
    const config: AadIdTokenConfig = {
      issuer: "https://login.microsoftonline.com/test-tenant/v2.0",
      openIdMetadataUrl: jwks2.openIdMetadataUrl,
      audience: AUDIENCE,
      clockSkewSeconds: 300,
      jwksCacheMaxAgeMs: 24 * 60 * 60 * 1000,
      fetchTimeoutMs: 5000,
    };
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      {
        iss: config.issuer,
        aud: AUDIENCE,
        oid: ALICE_OID,
        iat: now,
        exp: now + 600,
      },
      jwks2.privateKeyPem,
      { algorithm: "RS256", keyid: jwks2.kid },
    );
    alice = {
      kind: "entra",
      oid: await validateAadIdToken({ token, config, now: Date.now }),
    };
    sendRegistry = IdentityRegistry.fromConfig(
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
    await jwks2.close();
  });

  const resolved: ResolvePrincipal = async () => ({
    kind: "resolved",
    principal: alice,
  });

  it("CONTRACT: an empty message never reaches the bridge", async () => {
    // Action.Submit fires whether or not anything was typed, so an
    // accidental tap on an untouched composer would otherwise deliver an
    // empty message into a running agent's queue — unsendable once away.
    let spawned = false;
    const deps = sendDeps({
      resolvePrincipal: resolved,
      spawnFn: async () => {
        spawned = true;
        return { code: 0, stdout: "{}", stderr: "", timedOut: false };
      },
    });

    for (const text of ["", "   ", "\n\n", "\t "]) {
      const result = await dispatchActionInvoke(
        {
          verb: SEND_VERB,
          conversationId: "conv-1",
          data: { chatId: CHAT_ID, messageText: text },
        },
        deps,
      );
      expect(result.acted, JSON.stringify(text)).toBe(false);
      expect(JSON.stringify(result.card.content)).toContain("Nothing to send");
    }
    expect(spawned).toBe(false);
  });

  it("CONTRACT: identity is resolved BEFORE the message is issued", async () => {
    // Asserts ORDER, not merely "an unavailable identity doesn't spawn" —
    // that weaker check passes even if the guard is deleted, because
    // `resolveTenant` would refuse downstream anyway and the spawn still
    // wouldn't happen. So this runs the SUCCESS path and records the
    // sequence: if the send were issued first and identity checked after,
    // an unauthorised message would already have landed on a host by the
    // time it was refused.
    const calls: string[] = [];
    const deps = sendDeps({
      resolvePrincipal: async () => {
        calls.push("resolvePrincipal");
        return { kind: "resolved", principal: alice };
      },
      spawnFn: async () => {
        calls.push("spawn");
        return {
          code: 0,
          stdout: JSON.stringify({ kind: "applied" }),
          stderr: "",
          timedOut: false,
        };
      },
    });

    const result = await dispatchActionInvoke(
      {
        verb: SEND_VERB,
        conversationId: "conv-1",
        data: { chatId: CHAT_ID, messageText: "real text" },
      },
      deps,
    );

    expect(result.acted).toBe(true);
    expect(calls).toEqual(["resolvePrincipal", "spawn"]);
  });

  it("an unavailable identity is refused, and nothing is spawned", async () => {
    let spawned = false;
    const deps = sendDeps({
      resolvePrincipal: async () => ({
        kind: "unavailable",
        reason: "no_principal",
      }),
      spawnFn: async () => {
        spawned = true;
        return { code: 0, stdout: "{}", stderr: "", timedOut: false };
      },
    });

    const result = await dispatchActionInvoke(
      {
        verb: SEND_VERB,
        conversationId: "conv-1",
        data: { chatId: CHAT_ID, messageText: "real text" },
      },
      deps,
    );

    expect(result.acted).toBe(false);
    expect(spawned).toBe(false);
  });

  it("passes the message as a single argv element, so quotes and newlines are data", async () => {
    // No shell is involved; this pins that the text is never split or
    // reinterpreted on its way to the bridge.
    const nasty = 'a "quoted" thing; rm -rf /\nsecond `line`';
    let seen: readonly string[] = [];
    const deps = sendDeps({
      resolvePrincipal: resolved,
      spawnFn: async (_cmd, args) => {
        seen = args;
        return {
          code: 0,
          stdout: JSON.stringify({ kind: "applied" }),
          stderr: "",
          timedOut: false,
        };
      },
    });

    const result = await dispatchActionInvoke(
      {
        verb: SEND_VERB,
        conversationId: "conv-1",
        data: { chatId: CHAT_ID, messageText: nasty },
      },
      deps,
    );

    expect(seen).toEqual(["send", CHAT_ID, nasty]);
    expect(result.acted).toBe(true);
  });

  it("a missing chat id is refused rather than guessed at", async () => {
    const deps = sendDeps({
      resolvePrincipal: resolved,
      spawnFn: async () => {
        throw new Error("must not spawn");
      },
    });
    const result = await dispatchActionInvoke(
      { verb: SEND_VERB, conversationId: "conv-1", data: { messageText: "x" } },
      deps,
    );
    expect(result.acted).toBe(false);
    expect(JSON.stringify(result.card.content)).toContain("chat id");
  });

  it("an over-long message is refused locally, before it costs a spawn", async () => {
    let spawned = false;
    const deps = sendDeps({
      resolvePrincipal: resolved,
      spawnFn: async () => {
        spawned = true;
        return { code: 0, stdout: "{}", stderr: "", timedOut: false };
      },
    });
    const result = await dispatchActionInvoke(
      {
        verb: SEND_VERB,
        conversationId: "conv-1",
        data: { chatId: CHAT_ID, messageText: "x".repeat(5000) },
      },
      deps,
    );
    expect(result.acted).toBe(false);
    expect(spawned).toBe(false);
  });

  it("an unconfirmed send advises checking, NOT resending — a duplicate is a real second message", async () => {
    const deps = sendDeps({
      resolvePrincipal: resolved,
      spawnFn: async () => ({
        code: 1,
        stdout: JSON.stringify({
          kind: "failed",
          reason: "reconcile window expired",
        }),
        stderr: "",
        timedOut: false,
      }),
    });

    const result = await dispatchActionInvoke(
      {
        verb: SEND_VERB,
        conversationId: "conv-1",
        data: { chatId: CHAT_ID, messageText: "hello", chatTitle: "My chat" },
      },
      deps,
    );

    const body = JSON.stringify(result.card.content);
    expect(body).toContain("Couldn't confirm");
    expect(body).toContain("not a no-op");
    expect(body).not.toContain("try again");
  });
});

describe("read-surface/dispatch — an unreachable chat never gets an actionable card", () => {
  /**
   * Verified against the real bridge on the VM: `status hi` returns
   *   {"chatId":"hi","title":null,"runStatus":"idle",...,"connected":false}
   * i.e. a well-formed, entirely plausible status for an id that does not
   * exist. `connected` is the ONLY thing distinguishing it from a real chat,
   * which is why these tests use exactly that fixture.
   */
  const UNREACHABLE = JSON.stringify({
    chatId: "hi",
    title: null,
    runStatus: "idle",
    pendingApprovals: [],
    pendingInterviews: [],
    connected: false,
  });

  let jwks3: TestJwksServer;
  let alice3: VerifiedPrincipal;
  let registry3: IdentityRegistry;

  beforeAll(async () => {
    jwks3 = await startTestJwksServer();
    const config: AadIdTokenConfig = {
      issuer: "https://login.microsoftonline.com/test-tenant/v2.0",
      openIdMetadataUrl: jwks3.openIdMetadataUrl,
      audience: AUDIENCE,
      clockSkewSeconds: 300,
      jwksCacheMaxAgeMs: 24 * 60 * 60 * 1000,
      fetchTimeoutMs: 5000,
    };
    const now = Math.floor(Date.now() / 1000);
    alice3 = {
      kind: "entra",
      oid: await validateAadIdToken({
        token: jwt.sign(
          {
            iss: config.issuer,
            aud: AUDIENCE,
            oid: ALICE_OID,
            iat: now,
            exp: now + 600,
          },
          jwks3.privateKeyPem,
          { algorithm: "RS256", keyid: jwks3.kid },
        ),
        config,
        now: Date.now,
      }),
    };
    registry3 = IdentityRegistry.fromConfig(
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
    await jwks3.close();
  });

  async function dispatchAgainstUnreachable(
    command: Parameters<typeof dispatchCommand>[0],
  ): Promise<string> {
    const epicBindings = new InMemoryEpicBindingStore();
    await epicBindings.set("conv-1", "epic-1");
    const deps: DispatchDeps = {
      registry: registry3,
      epicBindings,
      bridgeCliConfig: {
        command: "/absolute/traycer-remote-bridge",
        timeoutMs: 5000,
        spawnFn: async () => ({
          code: 0,
          stdout: UNREACHABLE,
          stderr: "",
          timedOut: false,
        }),
      },
      senderAgentId: "teams-bot",
      parentEnv: {},
      resolvePrincipal: async () => ({
        kind: "resolved",
        principal: alice3,
      }),
      now: () => 0,
    };
    const cards = await dispatchCommand(command, "conv-1", deps);
    return JSON.stringify(cards.map((c) => c.content));
  }

  it("CONTRACT: `say hi` does not render a composer bound to a chat named 'hi'", async () => {
    // The shipped behaviour: a card headed "Reply to hi", pointing nowhere.
    const body = await dispatchAgainstUnreachable({
      kind: "compose",
      chatId: "hi",
    });
    expect(body).toContain("doesn't look like a chat");
    expect(body).not.toContain("Reply to");
    expect(body).not.toContain("Input.Text");
  });

  it("CONTRACT: `say hi there` does not deliver 'there' to a chat named 'hi'", async () => {
    const body = await dispatchAgainstUnreachable({
      kind: "say",
      chatId: "hi",
      text: "there",
    });
    expect(body).toContain("doesn't look like a chat");
    expect(body).not.toContain("Message sent");
  });

  it("CONTRACT: `log in` does not render a history card for a chat named 'in'", async () => {
    // Verified on the real bridge: `transcript in` answers a bogus id with
    //   {"chatId":"in","title":null,"totalCount":0,"messages":[]}
    // — a valid, empty transcript, which rendered as a history card for a
    // chat that does not exist. Found by asking what ELSE someone might
    // type, not by a bug report.
    const body = await dispatchAgainstUnreachable({
      kind: "log",
      chatId: "in",
      offset: 0,
    });
    expect(body).toContain("doesn't look like a chat");
    expect(body).not.toContain("messages");
  });

  it("exactly ONE card comes back — a single command is a single reply", async () => {
    const epicBindings = new InMemoryEpicBindingStore();
    await epicBindings.set("conv-1", "epic-1");
    const deps: DispatchDeps = {
      registry: registry3,
      epicBindings,
      bridgeCliConfig: {
        command: "/absolute/traycer-remote-bridge",
        timeoutMs: 5000,
        spawnFn: async () => ({
          code: 0,
          stdout: UNREACHABLE,
          stderr: "",
          timedOut: false,
        }),
      },
      senderAgentId: "teams-bot",
      parentEnv: {},
      resolvePrincipal: async () => ({ kind: "resolved", principal: alice3 }),
      now: () => 0,
    };
    const cards = await dispatchCommand(
      { kind: "compose", chatId: "hi" },
      "conv-1",
      deps,
    );
    expect(cards).toHaveLength(1);
  });
});
