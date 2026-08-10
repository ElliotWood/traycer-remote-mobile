import {
  CloudAdapter,
  loadPrevAuthConfigFromEnv,
} from "@microsoft/agents-hosting";
import { IdentityRegistry } from "@traycer-clients/shared/identity-registry/registry";
import { defaultAuditSink } from "@traycer-clients/shared/identity-registry/audit-log";
import { loadBotFrameworkAuthConfigFromEnv } from "./auth/bot-framework-jwt";
import { loadServerConfigFromEnv } from "./config";
import { createHttpServer } from "./http-server";
import { logError, logInfo, logWarn } from "./logger";
import { defaultBridgeCliConfig } from "./read-surface/bridge-cli";
import {
  createDemoPrincipalSource,
  DEMO_IDENTITY_ENV_FLAG,
} from "./read-surface/demo-principal-source";
import {
  DefaultingEpicBindingStore,
  InMemoryEpicBindingStore,
  type EpicBindingStore,
} from "./read-surface/epic-binding-store";
import { createReadSurfaceHandler } from "./read-surface/read-surface-handler";
import { createStartAssessment } from "./intake/start-assessment";
import {
  stageAttachments,
  stagingRootFromEnv,
} from "./intake/attachment-staging";
import { isKnownTimeZone } from "./intake/deadline";
import { DurableProactiveStore } from "./proactive/proactive-store";
import { rememberProactiveTarget } from "./proactive/remember-target";
import { pushWatchEvent } from "./proactive/push-notifications";
import { createAdapterSend } from "./proactive/send-via-adapter";
import { createWatchRunner } from "./proactive/watch-runner";
import { nodeSpawnWatchFn } from "./proactive/spawn-watch";
import { proactiveCardFor } from "./proactive/render-card";
import { DurableConversationReferenceStore } from "./state/conversation-reference-store";
import { resolveTenantEnv } from "./read-surface/host-access";
import type { ResolvePrincipal } from "./read-surface/principal-source";

/**
 * The only `ResolvePrincipal` that ships today: it refuses.
 *
 * T1b (Teams SSO token exchange) is the sole legitimate way to obtain a
 * verified `oid` on the Teams path, and it is blocked on T0c (the bot App
 * ID, on the user's admin lead time). Until it lands, every command that
 * touches host data honestly reports that identity could not be verified,
 * rather than falling back to `activity.from.aadObjectId` — which is
 * unverified request-body data that A2's registry forbids by name.
 *
 * `help` still works without identity, so the bot is not mute.
 */
const refuseUntilSsoLands: ResolvePrincipal = async () => ({
  kind: "unavailable",
  reason:
    "Teams SSO sign-in isn't configured yet (T1b), so this bot can't yet confirm which Traycer host is yours.",
});

/**
 * Selects the identity source. Default is the refusal above. The demo
 * source activates ONLY on an explicit env flag and is deleted when T1b
 * lands — see `read-surface/demo-principal-source.ts` for the full terms
 * this was approved under.
 *
 * A misconfigured demo flag is FATAL, never a fallback: silently dropping
 * back to the refusal (or worse, to some other identity) when the operator
 * clearly intended demo mode is exactly the fail-quietly shape this epic
 * keeps finding.
 */
function selectPrincipalSource(env: NodeJS.ProcessEnv): ResolvePrincipal {
  const demo = createDemoPrincipalSource(env);
  switch (demo.kind) {
    case "misconfigured":
      throw new Error(`demo identity misconfigured: ${demo.reason}`);
    case "active":
      logWarn(
        "starting with DEMO IDENTITY enabled — single config-asserted principal, not multi-user",
        { flag: DEMO_IDENTITY_ENV_FLAG },
      );
      return demo.resolve;
    case "inactive":
      return refuseUntilSsoLands;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required — refusing to start without it.`);
  }
  return value;
}

async function main(): Promise<void> {
  // Fails fast, deliberately, before anything else: no anonymous/dev
  // fallback exists anywhere in this package's auth path (contract §5 — no
  // kill switch). MicrosoftAppId doubles as the inbound JWT audience and the
  // outbound Connector API client id, so this one check covers both.
  const inboundAuthConfig = loadBotFrameworkAuthConfigFromEnv(process.env);
  const outboundAuthConfig = loadPrevAuthConfigFromEnv();

  const serverConfig = loadServerConfigFromEnv(process.env);
  const adapter = new CloudAdapter(outboundAuthConfig);

  // Refuses to load rather than falling back to an empty/permissive
  // registry — see A2's `IdentityRegistry.fromFile`.
  const registry = IdentityRegistry.fromFile(
    requireEnv("TRAYCER_IDENTITY_REGISTRY"),
    defaultAuditSink,
  );

  // Optional convenience so a fresh chat can run `fleet` without first
  // typing an epic UUID. Not an auth shortcut — see the class docblock.
  const defaultEpicId = process.env.TRAYCER_TEAMS_DEFAULT_EPIC_ID?.trim();
  let epicBindings: EpicBindingStore = new InMemoryEpicBindingStore();
  if (defaultEpicId !== undefined && defaultEpicId.length > 0) {
    epicBindings = new DefaultingEpicBindingStore(epicBindings, defaultEpicId);
    logInfo("default epic configured for unbound conversations", {
      epicId: defaultEpicId,
    });
  }

  const bridgeCliConfig = defaultBridgeCliConfig(
    requireEnv("TRAYCER_REMOTE_BRIDGE_BIN"),
  );
  const resolvePrincipal = selectPrincipalSource(process.env);

  /*
   * `startAssessment` — the last wire, and OPTIONAL by construction.
   *
   * Composed only when a host id and an epic are configured. Without them the
   * confirm button refuses in words ("this deployment can't start
   * assessments yet") rather than appearing to work — the whole point of
   * making the dep optional rather than defaulting it to something.
   *
   * `TRAYCER_TEAMS_TAB_URL` is separately optional: no tab URL means the ack
   * card renders with NO "Watch progress" button, which is better than a
   * button that goes nowhere.
   */
  /*
   * WHERE CUSTOMER TENDER DOCUMENTS LAND.
   *
   * Owned by the `traycer` user this process runs as, `0700` on the
   * directories and `0600` on the files — a shared VM's default umask would
   * otherwise leave a customer's tender world-readable. Configurable because
   * the deploy, not this file, knows which filesystem has the room.
   *
   * Nothing here cleans it up. That is on purpose: a bot that deletes
   * customer documents on a timer it invented is worse than a directory that
   * grows, and the deploy notes hand over a `tmpfiles.d` line instead.
   */
  const stagingRoot = stagingRootFromEnv(process.env);
  logInfo("intake staging root", { directory: stagingRoot });

  /*
   * The intake form's preselected time zone.
   *
   * VALIDATED AGAINST THE OFFERED LIST AND OTHERWISE DROPPED, loudly. A typo
   * here would silently select nothing, which is the safe direction but reads
   * as the variable having no effect — so it says so.
   */
  const configuredZone = process.env.TRAYCER_TEAMS_DEFAULT_TIMEZONE?.trim();
  const defaultTimeZone =
    configuredZone !== undefined && isKnownTimeZone(configuredZone)
      ? configuredZone
      : undefined;
  if (configuredZone !== undefined && defaultTimeZone === undefined) {
    logWarn("TRAYCER_TEAMS_DEFAULT_TIMEZONE is not one of the offered zones", {
      value: configuredZone,
      consequence: "the intake form will open with no zone selected",
    });
  }

  const assessmentHostId = process.env.TRAYCER_TEAMS_HOST_ID?.trim() ?? "";
  const startAssessment =
    assessmentHostId.length > 0 &&
    defaultEpicId !== undefined &&
    defaultEpicId.length > 0
      ? createStartAssessment({
          references: new DurableConversationReferenceStore(
            process.env.TRAYCER_TEAMS_STATE_DIR !== undefined
              ? `${process.env.TRAYCER_TEAMS_STATE_DIR}/conversation-refs.json`
              : "/srv/traycer/teams-bot/state/conversation-refs.json",
            (message: string, detail: string) => {
              logWarn(message, { detail });
            },
          ),
          hostId: assessmentHostId,
          epicId: defaultEpicId,
          tabBaseUrl: process.env.TRAYCER_TEAMS_TAB_URL?.trim() ?? "",
          bridgeCliConfig,
          // Identity resolved per press, never cached — the same ordering
          // every other action uses: resolve, then act.
          buildEnv: async () => {
            const identity = await resolvePrincipal();
            if (identity.kind === "unavailable") return null;
            return resolveTenantEnv(identity.principal, defaultEpicId, {
              registry,
              epicBindings,
              bridgeCliConfig,
              senderAgentId: requireEnv("TRAYCER_AGENT_ID"),
              parentEnv: process.env,
            });
          },
          now: Date.now,
          stagingRoot,
        })
      : undefined;

  if (startAssessment === undefined) {
    logWarn("assessment dispatch disabled — set TRAYCER_TEAMS_HOST_ID", {
      hasEpic: defaultEpicId !== undefined,
    });
  }

  /*
   * ─────────────────────────────────────────────────────────────────────
   * THE PROACTIVE PATH — every piece of which existed and none of which ran
   * ─────────────────────────────────────────────────────────────────────
   *
   * `watch-line.ts`, `proactive-store.ts`, `push-notifications.ts`,
   * `classify-send-failure.ts` and `send-via-adapter.ts` were all built and
   * unit-tested, and a grep for their entry points outside tests returned
   * nothing. The producer existed too. This block is the composition that was
   * missing, and it is why Elliot's approvals never reached Teams.
   *
   * OPTIONAL, like every other long-running wire here: no epic configured
   * means nothing to watch, and it says so rather than starting a child that
   * can never succeed.
   */
  const stateDir =
    process.env.TRAYCER_TEAMS_STATE_DIR?.trim() ?? "/srv/traycer/teams-bot/state";
  const proactiveStore = new DurableProactiveStore(
    `${stateDir}/proactive-targets.json`,
    `${stateDir}/proactive-sent.json`,
    (message: string, detail: string) => {
      logWarn(message, { detail });
    },
  );

  const handler = createReadSurfaceHandler({
    registry,
    epicBindings,
    bridgeCliConfig,
    senderAgentId: requireEnv("TRAYCER_AGENT_ID"),
    parentEnv: process.env,
    resolvePrincipal,
    startAssessment,
    // The route a notification travels back along. Captured on a turn because
    // a conversation reference exists nowhere else; idempotent, so calling it
    // on every message costs a parse and a comparison.
    rememberProactiveTarget: (epicId, reference, user) => {
      const outcome = rememberProactiveTarget(
        proactiveStore,
        epicId,
        reference,
        user,
        Date.now(),
      );
      if (outcome.kind === "bound") {
        logInfo("proactive route bound", { epicId, tagged: user !== null });
      } else if (outcome.kind === "unusable") {
        logWarn("could not record where to send notifications for this epic", {
          epicId,
          consequence: "approvals in this epic will not reach Teams",
        });
      }
    },
    // `globalThis.fetch` rather than an HTTP client: the URL is absolute and
    // pre-authorised, so there is nothing to configure and nothing to add.
    stageAttachments: (attachments) =>
      stageAttachments(attachments, {
        stagingRoot,
        fetchImpl: globalThis.fetch,
      }),
    defaultTimeZone,
    now: Date.now,
  });

  /*
   * The watcher, started only when there is an epic to watch and an app id to
   * send as.
   *
   * `MicrosoftAppId` doubles as the outbound Connector client id — the same
   * value `loadBotFrameworkAuthConfigFromEnv` already refused to start
   * without — so its absence is impossible here rather than merely unlikely.
   *
   * INTERVIEWS ARE DELIBERATELY NOT WIRED YET. `bridge watch` does emit
   * `interview.requested`, but `InterviewAppeared` carries no `questions`,
   * and `buildInterviewCard` renders its `questions: null` branch as "Answer
   * it on the desktop" — advice that is wrong for an interview which is
   * perfectly answerable in Teams one tap away. Sending the right card with
   * the wrong instruction is worse than sending nothing, so the interview
   * branch throws to the journal until `buildInterviewWaitingCard` lands
   * (owned by the card surface, agreed 2026-08-10).
   */
  const watcher =
    defaultEpicId !== undefined && defaultEpicId.length > 0
      ? createWatchRunner({
          command: requireEnv("TRAYCER_REMOTE_BRIDGE_BIN"),
          epicId: defaultEpicId,
          buildEnv: async () => {
            // Rebuilt per attempt: it carries a token that expires and this
            // process is meant to run for weeks.
            const identity = await resolvePrincipal();
            if (identity.kind === "unavailable") return null;
            return resolveTenantEnv(identity.principal, defaultEpicId, {
              registry,
              epicBindings,
              bridgeCliConfig,
              senderAgentId: requireEnv("TRAYCER_AGENT_ID"),
              parentEnv: process.env,
            });
          },
          spawnWatch: nodeSpawnWatchFn,
          onEvent: (event) =>
            pushWatchEvent(
              {
                store: proactiveStore,
                send: createAdapterSend(
                  adapter,
                  inboundAuthConfig.audience,
                  (appeared) => proactiveCardFor(appeared, Date.now()),
                ),
                now: Date.now,
                onWarn: (message, detail) => {
                  logWarn(message, { detail });
                },
              },
              event,
            ).then((result) => {
              logInfo("proactive event", {
                kind: result.kind,
                type: event.type,
              });
            }),
          onInfo: (message, detail) => {
            logInfo(message, { detail });
          },
          onWarn: (message, detail) => {
            logWarn(message, { detail });
          },
          schedule: (fn, ms) => {
            const timer = setTimeout(fn, ms);
            // `unref` so a pending restart cannot hold the process open on a
            // shutdown that has already closed the server.
            timer.unref();
            return {
              cancel: () => {
                clearTimeout(timer);
              },
            };
          },
          now: Date.now,
        })
      : null;

  if (watcher === null) {
    logWarn("proactive notifications disabled — no epic configured", {
      variable: "TRAYCER_TEAMS_DEFAULT_EPIC_ID",
      consequence: "approvals will never reach Teams",
    });
  } else {
    watcher.start();
  }

  const server = createHttpServer({
    adapter,
    handler,
    authConfig: inboundAuthConfig,
  });
  await new Promise<void>((resolve) => {
    server.listen(serverConfig.port, serverConfig.host, resolve);
  });
  logInfo("teams-bot listening", {
    host: serverConfig.host,
    port: serverConfig.port,
  });
}

main().catch((err: unknown) => {
  logError("teams-bot exiting", {
    message: err instanceof Error ? err.message : "unknown error",
  });
  process.exitCode = 1;
});
