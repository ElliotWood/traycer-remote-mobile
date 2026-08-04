/**
 * Author a new agent inside an already-open epic (T7, Flow 5): dispatch the
 * unary `epic.createChat` carrying the user's instruction as the folded
 * `initialMessage`, then hand the minted `chatId` back so the caller lands in
 * the new chat's detail (T6).
 *
 * The schema forced a design the ticket's "omit settings, host defaults" plan
 * did not anticipate (escalated + ratified): the folded
 * `createChatInitialMessageSchema.settings` is a REQUIRED full
 * `chatRunSettingsSchema` tuple, and `model` is a concrete slug with no
 * "use the harness default" sentinel — `foundation.ts` states the client itself
 * must resolve a real model (defaulting to the provider's first listed model)
 * before a turn is sent. So this:
 *   - resolves the model via `agent.listHarnessModels` for a default harness
 *     ("claude"), taking the first listed model (never a hardcoded slug — R2);
 *     an empty/unavailable list surfaces an inline error instead of sending;
 *   - stamps `permissionMode: "supervised"` (the mode that asks the user for
 *     approvals — the whole point of the phone surface is answering those) and
 *     `agentMode: "regular"`;
 *   - sources `sender.userId` from the bound client's live RequestContext
 *     (`getRequestContextUserId`), so no separate auth wiring is needed;
 *   - uses `DEFAULT_ACCOUNT_CONTEXT` (PERSONAL) for billing context.
 *
 * The top-level `workspaceMode` / `worktreeIntent` / `settings` are OMITTED so
 * the host reuses the epic's existing setup + host defaults (R1/R2) — the reason
 * the phone needs no workspace path.
 */
import { useCallback, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { DEFAULT_ACCOUNT_CONTEXT } from "@traycer/protocol/common/schemas";
import type {
  CreateChatInitialMessage,
  CreateChatRequest,
} from "@traycer/protocol/host/epic/unary-schemas";
import type { ChatRunSettings } from "@traycer/protocol/persistence/epic/foundation";
import type { MobileHostClient } from "@/host/host-client-context";
import type { HostStreamConnection } from "@/host/stream-connection";
import {
  FIRST_TURN_ACK_TIMEOUT_MS,
  startFoldedFirstTurn,
} from "@/host/first-turn-fallback";
// HA-1: `MOBILE_HOST_ID` is deliberately NOT imported here any more. It stays a
// valid local UI label in `connection.ts`, but nothing in this module may reach
// for it as a durable `hostId` — the absence of the import is the guardrail.
import { CONFIGURED_HOST_ID } from "@/config";

/**
 * Default harness for a phone-authored agent. "claude" is a member of both
 * `guiHarnessIdSchema` (what `chatRunSettings.harnessId` accepts) and
 * `agentFacingHarnessIdSchema` (what `agent.listHarnessModels` accepts), and
 * matches the project's Claude default. Verified against
 * `protocol/src/persistence/epic/foundation.ts` + `protocol/src/host/agent/shared.ts`.
 */
export const AUTHOR_HARNESS_ID = "claude";

/**
 * `supervised` is the `permissionModeSchema` member that routes tool/file-edit
 * approvals back to the user — exactly what the phone surface (T6) answers. The
 * alternatives (`auto_accept_edits`, `full_access`) would run unattended.
 */
const AUTHOR_PERMISSION_MODE = "supervised";

/** Cap for a title derived from the instruction's first line. */
const MAX_TITLE_LENGTH = 80;

/** The one unary surface the authoring flows need; kept narrow so tests inject a fake. */
export type AuthoringClient = Pick<MobileHostClient, "request">;

/**
 * Resolves a concrete model for the default harness (R2): the host's first
 * listed model, never a hardcoded slug. `null` when the host lists none — the
 * callers surface that inline instead of guessing a slug.
 *
 * `epicId` is `null` for the create-epic flow, where no epic exists yet:
 * `listHarnessModelsRequestSchemaV20` made both `epicId` and `senderAgentId`
 * nullable precisely so a caller can ask the HOST what it can run before any
 * epic is bound.
 */
export async function resolveAuthorModel(
  client: AuthoringClient,
  epicId: string | null,
): Promise<string | null> {
  const harnessModels = await client.request("agent.listHarnessModels", {
    epicId,
    senderAgentId: null,
    harnessId: AUTHOR_HARNESS_ID,
  });
  const model = harnessModels.models[0]?.id;
  return model === undefined || model.length === 0 ? null : model;
}

export interface BuildInitialMessageArgs {
  readonly messageId: string;
  readonly clientActionId: string;
  readonly userId: string;
  readonly model: string;
  readonly instruction: string;
  /**
   * M1 item 6, inherited by M5: the run settings the user actually chose.
   *
   * `null` (or omitted) keeps the historical behaviour — `model` as resolved
   * by the caller, `supervised`, `regular`, and every capacity setting null.
   * When present, `model` here is authoritative over the `model` argument,
   * because a caller that resolved a whole settings tuple has already chosen
   * a slug and the two disagreeing silently would be worse than either.
   */
  readonly settings?: ChatRunSettings | null;
}

/**
 * The folded first message, shared by `epic.createChat` and `epic.create`'s
 * chat seed — both carry the identical required `createChatInitialMessageSchema`
 * tuple, so "how a phone-authored turn is configured" is answered here once.
 */
export function buildInitialMessage(
  args: BuildInitialMessageArgs,
): CreateChatInitialMessage {
  return {
    messageId: args.messageId,
    clientActionId: args.clientActionId,
    content: plainTextContent(args.instruction),
    sender: { type: "user", userId: args.userId },
    settings: args.settings ?? {
      harnessId: AUTHOR_HARNESS_ID,
      model: args.model,
      permissionMode: AUTHOR_PERMISSION_MODE,
      reasoningEffort: null,
      serviceTier: null,
      agentMode: "regular",
      profileId: null,
    },
    accountContext: DEFAULT_ACCOUNT_CONTEXT,
  };
}

/**
 * The `hostId` to stamp on a phone-created chat, or `null` to REFUSE (HA-1).
 *
 * H1: this is a durable, for-life binding (`chatSchema.hostId`,
 * `protocol/src/persistence/epic/chat.ts:34-52`) — NOT the connection's own
 * `HostDirectoryEntry.hostId` label (`MOBILE_HOST_ID`, which exists only so
 * `HostClient.bind()` has something to key on). The real value is unreachable
 * over the wire protocol itself (checked exhaustively — no handshake field, no
 * bootstrap-safe RPC), so it can only arrive via this out-of-band config value.
 *
 * It used to fall back to `MOBILE_HOST_ID`. That is now a refusal, for two
 * reasons:
 *
 * 1. A chat stamped that way renders on desktop as a dead
 *    `Host "mobile-host" is unreachable` tile — permanently, and visibly to
 *    everyone on the account.
 * 2. `MOBILE_HOST_ID` is a SINGLE SHARED CONSTANT across every mobile client and
 *    every user. Substituting any such constant — this one or a new one — is
 *    strictly worse than refusing: one id owned by many people collides with the
 *    per-owner uniqueness the routing design depends on. A replacement must be
 *    unique per installed client or stay deliberately unroutable. So this
 *    returns the real per-machine id or nothing at all; it never invents one.
 *
 * `MOBILE_HOST_ID` itself stays — it remains a legitimate LOCAL UI label for the
 * connection (`connection.ts`). The defect was only ever using it as a durable id.
 */
export function authoredChatHostId(): string | null {
  return CONFIGURED_HOST_ID;
}

/**
 * Shown when `VITE_HOST_ID` was not supplied to this build. Lives here (the
 * lower-level authoring module) rather than in `use-create-epic.ts` so the chat
 * and epic flows share one wording without a circular import.
 */
export const MISSING_HOST_ID_ERROR =
  "This build doesn't know the host's real ID (VITE_HOST_ID is unset), so anything created here would be permanently unreachable from the desktop app. Rebuild with VITE_HOST_ID set, or create it from the desktop app instead.";

/**
 * A minimal ProseMirror-style `doc` carrying the instruction as one paragraph.
 *
 * This docblock used to end "there is no shared/protocol plain-text→JsonContent
 * helper", which is why it was hand-built here rather than reusing gui-app's
 * across a client boundary. That is no longer true: the Teams tab needed the
 * same shape, so it MOVED to `@traycer-clients/shared/epic/comment-content`
 * and this re-exports it.
 *
 * The reasoning was right and its premise expired — worth leaving visible
 * rather than deleting, because "no shared helper exists" is exactly the kind
 * of justification that outlives the condition it describes.
 */
export { plainTextContent } from "@traycer-clients/shared/epic/comment-content";
import { plainTextContent } from "@traycer-clients/shared/epic/comment-content";

/** Chat title from the instruction: its first non-empty line, trimmed + capped. */
export function deriveChatTitle(instruction: string): string {
  const firstLine = (instruction.split("\n", 1)[0] ?? "").trim();
  if (firstLine.length === 0) {
    return "New agent";
  }
  return firstLine.length > MAX_TITLE_LENGTH
    ? `${firstLine.slice(0, MAX_TITLE_LENGTH - 1)}…`
    : firstLine;
}

export interface BuildCreateChatRequestArgs {
  readonly epicId: string;
  readonly chatId: string;
  readonly messageId: string;
  readonly clientActionId: string;
  readonly userId: string;
  readonly model: string;
  readonly instruction: string;
  /**
   * HA-1: the host's REAL, durable id. An explicit argument rather than a
   * config read inside the builder, so no code path can silently substitute a
   * shared placeholder — the caller must have obtained a real one from
   * `authoredChatHostId()` or refused.
   */
  readonly hostId: string;
  /** P1: the Agents-row "+" add-child action passes the parent chat's id; the root "+ New agent here" flow omits it (defaults to a top-level chat). */
  readonly parentId?: string | null;
}

/**
 * Assembles the exact `epic.createChat` request body. Pure + exported so the
 * contract test can parse it against the real `createChatRequestSchema`. Every
 * required field is present; `workspaceMode` / `worktreeIntent` / top-level
 * `settings` are deliberately absent (R1/R2).
 */
export function buildCreateChatRequest(
  args: BuildCreateChatRequestArgs,
): CreateChatRequest {
  const initialMessage: CreateChatInitialMessage = buildInitialMessage({
    messageId: args.messageId,
    clientActionId: args.clientActionId,
    userId: args.userId,
    model: args.model,
    instruction: args.instruction,
  });
  return {
    epicId: args.epicId,
    parentId: args.parentId ?? null,
    hostId: args.hostId,
    title: deriveChatTitle(args.instruction),
    chatId: args.chatId,
    initialMessage,
  };
}

export type CreateChatPhase = "idle" | "submitting" | "error";

export interface UseCreateChatResult {
  readonly phase: CreateChatPhase;
  readonly error: string | null;
  /** Ignored when the instruction is blank or a submit is already in flight. */
  readonly submit: (instruction: string) => void;
}

export interface UseCreateChatArgs {
  readonly client: MobileHostClient;
  readonly epicId: string;
  /** P1: nests the new chat under this parent (Agents-row "+" action). Omitted/`null` for a top-level chat. */
  readonly parentId?: string | null;
  /**
   * Used ONLY for the send-after-subscribe fallback when the host reports the
   * folded first turn didn't start. `null` (no host stream) degrades to an
   * honest "created but not running" error rather than a silent no-op.
   */
  readonly streamConnection: HostStreamConnection | null;
  /** Called with the minted `chatId` once the host accepts the create. */
  readonly onCreated: (chatId: string) => void;
}

export function useCreateChat({
  client,
  epicId,
  parentId = null,
  streamConnection,
  onCreated,
}: UseCreateChatArgs): UseCreateChatResult {
  const [phase, setPhase] = useState<CreateChatPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    (instruction: string): void => {
      const text = instruction.trim();
      if (text.length === 0 || phase === "submitting") {
        return;
      }
      setPhase("submitting");
      setError(null);

      void (async (): Promise<void> => {
        try {
          const userId = client.getRequestContextUserId();
          if (userId === null) {
            setPhase("error");
            setError("You must be signed in to start an agent.");
            return;
          }

          // HA-1: refuse rather than stamp the shared synthetic placeholder —
          // the binding is for life, and a chat carrying it is a permanently
          // unreachable tile on desktop.
          const hostId = authoredChatHostId();
          if (hostId === null) {
            setPhase("error");
            setError(MISSING_HOST_ID_ERROR);
            return;
          }

          // Resolve a concrete model (R2): first listed model for the default
          // harness — never a hardcoded slug. An empty list is a dead end, not
          // a fallback-to-guess.
          const model = await resolveAuthorModel(client, epicId);
          if (model === null) {
            setPhase("error");
            setError("Couldn't resolve a model for this host.");
            return;
          }

          const chatId = uuidv4();
          const request = buildCreateChatRequest({
            epicId,
            chatId,
            messageId: uuidv4(),
            clientActionId: uuidv4(),
            userId,
            model,
            instruction: text,
            hostId,
            parentId,
          });

          const response = await client.request("epic.createChat", request);
          /**
           * `initialTurnStarted === true` → the host already kicked the turn from
           * `initialMessage` and there is nothing more to send. FALSE is the case
           * that used to be discarded here (`void response.initialTurnStarted`),
           * and discarding it made "Start agent" a SILENT NO-OP: the chat exists,
           * the instruction is persisted on it, nothing is running, and both
           * branches navigated into the chat identically — so a started turn and a
           * dead one were indistinguishable to the user. Worse than a failed send,
           * which at least tells you to try again.
           *
           * Measured on a real host, `initialTurnStarted` comes back FALSE, so
           * this is the NORMAL path and not an edge case. Epic creation already
           * handled it (`use-create-epic.ts`); chat creation did not, and that
           * inconsistency between two adjacent paths is the whole defect.
           *
           * Re-sending is idempotent — the frame reuses the folded message's
           * `messageId` and the host dedupes on it. See `first-turn-fallback.ts`,
           * whose mechanism this REUSES rather than reimplementing.
           */
          if (response.initialTurnStarted !== true) {
            /**
             * Narrowing, not defensive padding: `initialMessage` is optional on
             * the wire even though `buildCreateChatRequest` always supplies it.
             *
             * Absent lands in the SAME error arm rather than skipping the
             * fallback, which is where this deliberately differs from
             * `use-create-epic.ts`. There, a missing folded message means the
             * epic was created without a chat seed and navigating is correct.
             * Here we are already inside "the host did not start a turn", so no
             * message to re-send means nothing is running and nothing can be —
             * exactly the state the user must be told about.
             */
            const foldedMessage = request.initialMessage ?? null;
            const outcome =
              foldedMessage === null
                ? "no-connection"
                : await startFoldedFirstTurn(
                    streamConnection,
                    { epicId, chatId, initialMessage: foldedMessage },
                    FIRST_TURN_ACK_TIMEOUT_MS,
                  );
            if (outcome !== "accepted") {
              // The chat and its message exist but nothing is acting on them.
              // Say so rather than navigating into apparent success — replacing a
              // silent no-op with a differently-silent one would not be a fix.
              setPhase("error");
              setError(
                "Agent created, but it didn't start. Open it from this epic and send the message again.",
              );
              return;
            }
          }
          onCreated(chatId);
        } catch (cause) {
          setPhase("error");
          setError(toErrorMessage(cause));
        }
      })();
    },
    [client, epicId, parentId, streamConnection, onCreated, phase],
  );

  return { phase, error, submit };
}

function toErrorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return "Couldn't start the agent. Please try again.";
}
