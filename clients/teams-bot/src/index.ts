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
import { ingestAttachments } from "./intake/attachment-fetch";
import { FileIntakeStore } from "./intake/intake-store";
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
   * WHERE A CUSTOMER'S DOCUMENT SITS ON DISK.
   *
   * Under the bot's own private state directory — the same place the
   * conversation references live — and NOT under any path nginx has a root
   * in. That is the enforcement of "the document must never become publicly
   * reachable": there is no route to it, the directory is `0700` and the
   * files `0600`, and both the bot and the Traycer host run as `traycer`, so
   * the skill's agent can read them and nothing else on the box can.
   *
   * The directory is deliberately derived from the same env var the
   * reference store uses, so a deployment cannot end up with one of them in
   * a private directory and the other somewhere a web server serves.
   */
  const stateDir =
    process.env.TRAYCER_TEAMS_STATE_DIR?.trim() ??
    "/srv/traycer/teams-bot/state";
  const intake = new FileIntakeStore(`${stateDir}/intake`);

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
  const assessmentHostId = process.env.TRAYCER_TEAMS_HOST_ID?.trim() ?? "";
  const startAssessment =
    assessmentHostId.length > 0 &&
    defaultEpicId !== undefined &&
    defaultEpicId.length > 0
      ? createStartAssessment({
          references: new DurableConversationReferenceStore(
            `${stateDir}/conversation-refs.json`,
            (message: string, detail: string) => {
              logWarn(message, { detail });
            },
          ),
          intake,
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
        })
      : undefined;

  if (startAssessment === undefined) {
    logWarn("assessment dispatch disabled — set TRAYCER_TEAMS_HOST_ID", {
      hasEpic: defaultEpicId !== undefined,
    });
  }

  const handler = createReadSurfaceHandler({
    registry,
    epicBindings,
    bridgeCliConfig,
    senderAgentId: requireEnv("TRAYCER_AGENT_ID"),
    parentEnv: process.env,
    resolvePrincipal,
    startAssessment,
    /*
     * The message-turn fetch. Returns `null` when nothing was retrievable, so
     * the card carries no handle rather than one that resolves to an empty
     * set — a button promising a document we do not have is the failure this
     * whole path exists to remove.
     *
     * A record IS still written when files arrived and could not be fetched:
     * the instruction names them as unavailable so the skill says so, rather
     * than answering as though the request had no attachment.
     */
    ingestAttachments: async (attachments) => {
      const result = await ingestAttachments(attachments, {});
      if (result.fetched.length === 0 && result.unavailable.length === 0) {
        return null;
      }
      const record = intake.put({
        fetched: result.fetched,
        unavailable: result.unavailable,
        now: Date.now(),
      });
      logInfo("documents stored for assessment", {
        files: record.files.length,
        unavailable: record.unavailable.length,
      });
      return { intakeId: record.intakeId, fileCount: record.files.length };
    },
    now: Date.now,
  });

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
