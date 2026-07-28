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
import type { JsonContent } from "@traycer/protocol/common/registry";
import type {
  CreateChatInitialMessage,
  CreateChatRequest,
} from "@traycer/protocol/host/epic/unary-schemas";
import type { MobileHostClient } from "@/host/host-client-context";
import { MOBILE_HOST_ID } from "@/host/connection";
import { CONFIGURED_HOST_ID } from "@/config";

/**
 * Default harness for a phone-authored agent. "claude" is a member of both
 * `guiHarnessIdSchema` (what `chatRunSettings.harnessId` accepts) and
 * `agentFacingHarnessIdSchema` (what `agent.listHarnessModels` accepts), and
 * matches the project's Claude default. Verified against
 * `protocol/src/persistence/epic/foundation.ts` + `protocol/src/host/agent/shared.ts`.
 */
const AUTHOR_HARNESS_ID = "claude";

/**
 * `supervised` is the `permissionModeSchema` member that routes tool/file-edit
 * approvals back to the user — exactly what the phone surface (T6) answers. The
 * alternatives (`auto_accept_edits`, `full_access`) would run unattended.
 */
const AUTHOR_PERMISSION_MODE = "supervised";

/** Cap for a title derived from the instruction's first line. */
const MAX_TITLE_LENGTH = 80;

/**
 * A minimal ProseMirror-style `doc` carrying the instruction as one paragraph.
 * Hand-built (not reusing gui-app's `plainTextPromptContent`) because that
 * helper lives in the `gui-app` client, which the mobile client does not — and
 * should not — import across the client boundary; there is no shared/protocol
 * plain-text→JsonContent helper. Shape matches the canonical builder exactly and
 * is validated by `createChatRequestSchema` (see the contract test).
 */
export function plainTextContent(text: string): JsonContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: text.length === 0 ? [] : [{ type: "text", text }],
      },
    ],
  };
}

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
  const initialMessage: CreateChatInitialMessage = {
    messageId: args.messageId,
    clientActionId: args.clientActionId,
    content: plainTextContent(args.instruction),
    sender: { type: "user", userId: args.userId },
    settings: {
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
  return {
    epicId: args.epicId,
    parentId: args.parentId ?? null,
    // H1: `hostId` is a durable, for-life binding (`chatSchema.hostId`,
    // `protocol/src/persistence/epic/chat.ts:34-52`) — NOT the connection's
    // own `HostDirectoryEntry.hostId` label (`MOBILE_HOST_ID`, which exists
    // only so `HostClient.bind()` has something to key on). The real value
    // is unreachable over the wire protocol itself (checked exhaustively —
    // no handshake field, no bootstrap-safe RPC), so it can only arrive via
    // this out-of-band config value. `MOBILE_HOST_ID` remains the fallback
    // for a host that hasn't supplied one — a chat created that way renders
    // as an unreachable host on desktop, a real protocol gap tracked
    // separately, not something faked here.
    hostId: CONFIGURED_HOST_ID ?? MOBILE_HOST_ID,
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
  /** Called with the minted `chatId` once the host accepts the create. */
  readonly onCreated: (chatId: string) => void;
}

export function useCreateChat({
  client,
  epicId,
  parentId = null,
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

          // Resolve a concrete model (R2): first listed model for the default
          // harness — never a hardcoded slug. An empty list is a dead end, not
          // a fallback-to-guess.
          const harnessModels = await client.request("agent.listHarnessModels", {
            epicId,
            senderAgentId: null,
            harnessId: AUTHOR_HARNESS_ID,
          });
          const model = harnessModels.models[0]?.id;
          if (model === undefined || model.length === 0) {
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
            parentId,
          });

          const response = await client.request("epic.createChat", request);
          // `initialTurnStarted === true` → the host already kicked the turn
          // from `initialMessage`, so there is nothing more to send. When it is
          // false/absent the send-after-subscribe fallback would be needed; that
          // second path is a documented follow-up (not built in T7). Either way
          // the chat now exists, so land in it.
          // ponytail: no send-after-subscribe fallback when initialTurnStarted is false — T7 follow-up.
          void response.initialTurnStarted;
          onCreated(chatId);
        } catch (cause) {
          setPhase("error");
          setError(toErrorMessage(cause));
        }
      })();
    },
    [client, epicId, parentId, onCreated, phase],
  );

  return { phase, error, submit };
}

function toErrorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return "Couldn't start the agent. Please try again.";
}
