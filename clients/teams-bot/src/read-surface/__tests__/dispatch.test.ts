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
import {
  dispatchActionInvoke,
  HANDLED_ACTION_VERBS,
} from "../dispatch-action";
import { ANSWER_VERB, SEND_VERB } from "../cards";
import { InMemoryEpicBindingStore } from "../epic-binding-store";
import { InMemoryFocusedChatStore } from "../focused-chat-store";
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
      focusedChats: new InMemoryFocusedChatStore(),
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

    // Asserts what this test is ABOUT — a card came back and no identity was
    // resolved to produce it. It used to pin the card's title string, which
    // made a copy change look like an identity-gating regression.
    expect(bodyOf(card).length).toBeGreaterThan(0);
    expect(bodyOf(card)).toContain("Ask in your own words");
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
            isLocal: true,
            hostId: "h-1",
            capabilities: { readTranscript: true, sendMessage: true },
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
      focusedChats: new InMemoryFocusedChatStore(),
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

  /**
   * THE CLAIM BEHIND EACH ENTRY, checked.
   *
   * `cards.test.ts` asserts every verb a card emits is in
   * `HANDLED_ACTION_VERBS`. That is only worth something if membership means
   * something — and the old hand-copied version of that list carried
   * `traycer/openChat` for a while BEFORE the verb had a handler, on the
   * strength of a comment claiming it was handled. The test passed both
   * before and after the handler existed.
   *
   * So: drive every verb in the set through the real dispatcher and require
   * it not to fall through to "Unknown card action". Deliberately asserts
   * nothing about the OUTCOME — most of these fail here, on a spawn that
   * returns `{}` or an identity that resolves to a stub — because what is
   * under test is routing, not behaviour. A verb that reaches a handler and
   * then reports a bridge failure has been routed; a verb that reaches the
   * fallback has not.
   */
  it("CONTRACT: every verb in HANDLED_ACTION_VERBS actually reaches a handler", async () => {
    const deps = sendDeps({
      resolvePrincipal: resolved,
      spawnFn: async () => ({
        code: 0,
        stdout: "{}",
        stderr: "",
        timedOut: false,
      }),
    });

    for (const verb of HANDLED_ACTION_VERBS) {
      const result = await dispatchActionInvoke(
        {
          verb,
          conversationId: "conv-1",
          // Enough payload that a handler is reached rather than refused for
          // a missing id — a "missing its chat id" card is still a handler
          // answering, but this keeps the failure mode one thing at a time.
          data: {
            chatId: CHAT_ID,
            approvalId: "ap-1",
            offset: "0",
            skill: "some-skill",
            messageText: "text",
          },
        },
        deps,
      );
      expect(
        JSON.stringify(result.card.content),
        `${verb} fell through to the unknown-verb branch`,
      ).not.toContain("Unknown card action");
    }
  });

  it("CONTROL: a verb outside the set DOES hit the unknown branch", async () => {
    // Without this the assertion above passes if `dispatchActionInvoke` stops
    // producing that string at all.
    const result = await dispatchActionInvoke(
      {
        verb: "traycer/notAThing",
        conversationId: "conv-1",
        data: { chatId: CHAT_ID },
      },
      sendDeps({
        resolvePrincipal: resolved,
        spawnFn: async () => ({
          code: 0,
          stdout: "{}",
          stderr: "",
          timedOut: false,
        }),
      }),
    );
    expect(JSON.stringify(result.card.content)).toContain("Unknown card action");
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

  /**
   * The interview path shares this describe's harness on purpose: it is the
   * same identity seam and the same spawn shape, and a test that built its
   * own would stop proving that.
   */
  describe("the interview path", () => {
    const BLOCK_ID = "iv-block-1";

    /** The card's own submit payload, as Teams relays it back. */
    function answerData(
      inputs: Readonly<Record<string, string>>,
      questions: readonly {
        index: number;
        questionId: string | null;
        question: string;
        multiSelect: boolean;
      }[],
    ): Readonly<Record<string, unknown>> {
      return {
        chatId: CHAT_ID,
        chatTitle: "My chat",
        interviewBlockId: BLOCK_ID,
        interviewQuestions: JSON.stringify(questions),
        ...inputs,
      };
    }

    const ONE_CHOICE = [
      {
        index: 0,
        questionId: "q-1",
        question: "Which environment first?",
        multiSelect: false,
      },
    ];

    it("CONTRACT: an unanswered question never reaches the bridge, and the refusal names it", async () => {
      // Exactly the composer's empty-message defect, and worse: an interview
      // can be answered ONCE, so an accidental tap that delivered `values: []`
      // could not be corrected afterwards.
      let spawned = false;
      const deps = sendDeps({
        resolvePrincipal: resolved,
        spawnFn: async () => {
          spawned = true;
          return { code: 0, stdout: "{}", stderr: "", timedOut: false };
        },
      });

      for (const blank of ["", "   ", "\n\n", "\t "]) {
        const result = await dispatchActionInvoke(
          {
            verb: ANSWER_VERB,
            conversationId: "conv-1",
            data: answerData({ answer_0: blank }, ONE_CHOICE),
          },
          deps,
        );
        expect(result.acted, JSON.stringify(blank)).toBe(false);
        expect(JSON.stringify(result.card.content)).toContain(
          "Which environment first?",
        );
      }
      expect(spawned).toBe(false);
    });

    it("sends `answer <chatId> <blockId> <json>`, with the answers as ONE argv element", async () => {
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
          verb: ANSWER_VERB,
          conversationId: "conv-1",
          data: answerData({ answer_0: "Staging" }, ONE_CHOICE),
        },
        deps,
      );

      expect(result.acted).toBe(true);
      expect(seen.slice(0, 3)).toEqual(["answer", CHAT_ID, BLOCK_ID]);
      expect(seen).toHaveLength(4);
      expect(JSON.parse(seen[3] ?? "null")).toEqual([
        {
          questionId: "q-1",
          question: "Which environment first?",
          values: ["Staging"],
          notes: null,
        },
      ]);
    });

    it("splits a multi-select's comma-joined value, and does NOT split a single-select's", async () => {
      // The single-select half is the one that matters: an agent's own option
      // label may legitimately contain a comma, and splitting it would send
      // two answers it never offered.
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

      await dispatchActionInvoke(
        {
          verb: ANSWER_VERB,
          conversationId: "conv-1",
          data: answerData(
            { answer_0: "Staging,Production", answer_1: "Yes, definitely" },
            [
              {
                index: 0,
                questionId: "q-1",
                question: "Which environments?",
                multiSelect: true,
              },
              {
                index: 1,
                questionId: "q-2",
                question: "Sure?",
                multiSelect: false,
              },
            ],
          ),
        },
        deps,
      );

      expect(JSON.parse(seen[3] ?? "null")).toEqual([
        {
          questionId: "q-1",
          question: "Which environments?",
          values: ["Staging", "Production"],
          notes: null,
        },
        {
          questionId: "q-2",
          question: "Sure?",
          values: ["Yes, definitely"],
          notes: null,
        },
      ]);
    });

    it("identity is resolved BEFORE the answers are issued", async () => {
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
          verb: ANSWER_VERB,
          conversationId: "conv-1",
          data: answerData({ answer_0: "Staging" }, ONE_CHOICE),
        },
        deps,
      );

      expect(result.acted).toBe(true);
      expect(calls).toEqual(["resolvePrincipal", "spawn"]);
    });

    it("CONTRACT: an unconfirmed answer does NOT invite a second attempt", async () => {
      // The opposite advice from the send path's, and the reason the outcome
      // card is a separate function. A repeated answer is not deduped — the
      // host settles this on the block leaving the pending set, so a retry
      // lands as "not currently pending".
      const deps = sendDeps({
        resolvePrincipal: resolved,
        // stdout MUST carry the outcome: a nonzero exit with nothing on
        // stdout is the bridge failing to run, which is a different card
        // ("Couldn't reach your Traycer host"). This is the host answering
        // "I cannot confirm what happened", which is the case under test.
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
          verb: ANSWER_VERB,
          conversationId: "conv-1",
          data: answerData({ answer_0: "Staging" }, ONE_CHOICE),
        },
        deps,
      );

      const body = JSON.stringify(result.card.content);
      expect(body).toContain("Couldn't confirm");
      expect(body).toContain("Do NOT answer again");
    });

    it("a card whose question list is unreadable is refused, not partially answered", async () => {
      let spawned = false;
      const deps = sendDeps({
        resolvePrincipal: resolved,
        spawnFn: async () => {
          spawned = true;
          return { code: 0, stdout: "{}", stderr: "", timedOut: false };
        },
      });

      for (const broken of ["not json", "[]", '[{"index":"one"}]']) {
        const result = await dispatchActionInvoke(
          {
            verb: ANSWER_VERB,
            conversationId: "conv-1",
            data: {
              chatId: CHAT_ID,
              interviewBlockId: BLOCK_ID,
              interviewQuestions: broken,
              answer_0: "Staging",
            },
          },
          deps,
        );
        expect(result.acted, broken).toBe(false);
      }
      expect(spawned).toBe(false);
    });
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
      focusedChats: new InMemoryFocusedChatStore(),
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
      focusedChats: new InMemoryFocusedChatStore(),
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

describe("read-surface/dispatch — no Send box on a chat that cannot receive one", () => {
  /**
   * The shape measured on the real host: the subscription is healthy (that
   * is how the transcript arrives) and the agent still cannot be sent to.
   * `connected` was the gate, and it is not evidence of sendability.
   */
  const CONNECTED_STATUS = JSON.stringify({
    chatId: "c-1",
    title: "A remote chat",
    runStatus: "idle",
    pendingApprovals: [],
    pendingInterviews: [],
    connected: true,
  });

  const agentRow = (sendMessage: boolean): string =>
    JSON.stringify([
      {
        agentId: "c-1",
        title: "A remote chat",
        harnessId: "claude",
        surface: "gui",
        active: false,
        isLocal: !sendMessage ? false : true,
        hostId: "h-1",
        capabilities: { readTranscript: true, sendMessage },
      },
    ]);

  async function chatBody(sendMessage: boolean): Promise<string> {
    const epicBindings = new InMemoryEpicBindingStore();
    await epicBindings.set("conv-1", "epic-1");
    const deps: DispatchDeps = {
      registry: gateRegistry,
      epicBindings,
      focusedChats: new InMemoryFocusedChatStore(),
      bridgeCliConfig: {
        command: "/absolute/traycer-remote-bridge",
        timeoutMs: 5000,
        // Routes on the subcommand so one fixture serves status, list and
        // transcript — the chat branch calls all three.
        spawnFn: async (_cmd, args) => {
          const sub = args[0];
          const stdout =
            sub === "list"
              ? agentRow(sendMessage)
              : sub === "transcript"
                ? JSON.stringify({
                    chatId: "c-1",
                    title: "A remote chat",
                    totalCount: 0,
                    offset: 0,
                    messages: [],
                  })
                : CONNECTED_STATUS;
          return { code: 0, stdout, stderr: "", timedOut: false };
        },
      },
      senderAgentId: "teams-bot",
      parentEnv: {},
      resolvePrincipal: async () => ({
        kind: "resolved",
        principal: gateAlice,
      }),
      now: () => 0,
    };
    const cards = await dispatchCommand(
      { kind: "chat", chatId: "c-1" },
      "conv-1",
      deps,
    );
    return JSON.stringify(cards.map((c) => c.content));
  }

  let jwks4: TestJwksServer;
  let gateAlice: VerifiedPrincipal;
  let gateRegistry: IdentityRegistry;

  beforeAll(async () => {
    jwks4 = await startTestJwksServer();
    const config: AadIdTokenConfig = {
      issuer: "https://login.microsoftonline.com/test-tenant/v2.0",
      openIdMetadataUrl: jwks4.openIdMetadataUrl,
      audience: AUDIENCE,
      clockSkewSeconds: 300,
      jwksCacheMaxAgeMs: 24 * 60 * 60 * 1000,
      fetchTimeoutMs: 5000,
    };
    const now = Math.floor(Date.now() / 1000);
    gateAlice = {
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
          jwks4.privateKeyPem,
          { algorithm: "RS256", keyid: jwks4.kid },
        ),
        config,
        now: Date.now,
      }),
    };
    gateRegistry = IdentityRegistry.fromConfig(
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
    await jwks4.close();
  });

  /**
   * REWRITTEN 2026-08-10, and what it is about did not change.
   *
   * These asserted the presence and absence of the COMPOSER CARD — an
   * `Input.Text` with its own Send button, rendered directly above Teams' own
   * compose box. That card is gone: replying is now focus, and the way in is
   * the status card's `Reply` button.
   *
   * The CONTRACT under test is unchanged and is the reason these exist: a
   * chat this host cannot send to must not offer a way to send to it, and
   * must say why rather than leaving an unexplained absence. Only the shape
   * of "a way to send" moved, from an input to a button.
   */
  it("CONTRACT: sendMessage=false offers no way to send, despite connected=true", async () => {
    const body = await chatBody(false);
    // No composer — that card no longer exists anywhere.
    expect(body).not.toContain("Input.Text");
    expect(body).not.toContain("traycer/send");
    // And no Reply button, which is what replaced it.
    expect(body).not.toContain("traycer/reply");
    // And says WHY — a missing box with no explanation reads as broken.
    expect(body).toContain("Read-only from here");
  });

  it("sendMessage=true offers Reply, and still no composer — the control", async () => {
    const body = await chatBody(true);
    expect(body).toContain("traycer/reply");
    expect(body).not.toContain("Read-only from here");
    // The composer is gone on BOTH branches, so its absence above is not
    // evidence of the gate. This is what makes that test discriminating.
    expect(body).not.toContain("Input.Text");
  });
});
