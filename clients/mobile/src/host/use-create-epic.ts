/**
 * Start a NEW epic from the Fleet — the phone counterpart of desktop's landing
 * composer. Dispatches the unary `epic.create` with the user's instruction folded
 * in as the first chat's `initialMessage`, then hands the minted `epicId` back so
 * the caller drills straight into it.
 *
 * WHY THIS IS BUILDABLE (checked before any UI was designed):
 *   - `epic.create@1.0` is a real host RPC and a RELEASED-FLOOR method
 *     (`protocol/src/host/released-floor.ts`), so every host this client can
 *     legally handshake with exposes it — no capability probe needed, no
 *     E_HOST_UNSUPPORTED path to design around.
 *   - Its request is `{ epic, repoIdentifiers, workspaces, chat }`
 *     (`createEpicRequestSchema`), and the folded `chat` seed carries everything
 *     `epic.createChat` would minus `epicId`. That is the same shape
 *     `use-create-chat.ts` already builds, which is why the two share
 *     `buildInitialMessage` rather than duplicating the settings tuple.
 *
 * THE WORKSPACE PROBLEM, AND WHY FOLDERLESS IS THE HONEST ANSWER.
 * `workspaces` is a list of LOCAL filesystem paths on the host. A phone has no
 * folder picker and no view of the host's disk, so it cannot honestly produce
 * one. Rather than invent a path (which would create an epic bound to a
 * directory that may not exist), this sends the epic desktop itself calls
 * "folderless": `repoIdentifiers: []`, `workspaces: []`, and the chat seeded with
 * `workspaceMode: "folderless"` + `worktreeIntent: null`.
 *
 * That is not a mobile-only degradation — it is a first-class desktop flow,
 * exercised by gui-app's own "creates a folderless epic without a selected
 * workspace folder" test (`clients/gui-app/src/components/home/__tests__/
 * use-landing-composer-actions.test.tsx`) with byte-identical field values. The
 * agent runs without a bound repo, which is exactly right for the planning and
 * question-answering work a phone is actually used for.
 *
 * Model resolution reuses `resolveAuthorModel` with `epicId: null` — legal only
 * because `agent.listHarnessModels@2.0` made `epicId` nullable, which is what
 * lets the phone ask the host what it can run BEFORE the epic exists.
 */
import { useCallback, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { CURRENT_EPIC_VERSION } from "@traycer-clients/shared/epic/epic-version";
import type { CreateEpicRequest } from "@traycer/protocol/host/epic/unary-schemas";
import type { ChatRunSettings } from "@traycer/protocol/persistence/epic/foundation";
import {
  toEpicWorkspaceFields,
  toWorktreeIntent,
  type WorkspaceTarget,
} from "@/host/workspace-selection";
import type { MobileHostClient } from "@/host/host-client-context";
import type { HostStreamConnection } from "@/host/stream-connection";
import {
  FIRST_TURN_ACK_TIMEOUT_MS,
  startFoldedFirstTurn,
} from "@/host/first-turn-fallback";
import {
  authoredChatHostId,
  buildInitialMessage,
  deriveChatTitle,
  MISSING_HOST_ID_ERROR,
  resolveAuthorModel,
} from "@/host/use-create-chat";

/**
 * `epicLightSchema.status` is a freeform string; `"todo"` is the value desktop's
 * landing composer stamps on a fresh epic (`buildEpicLight`), so a phone-created
 * epic is indistinguishable from a desktop-created one in the fleet list.
 */
const NEW_EPIC_STATUS = "todo";

/**
 * Re-exported so `new-epic-view.tsx` imports its copy from the same module as
 * the rest of this flow. Defined in `use-create-chat.ts` (which this module
 * already depends on) so the chat and epic refusals share one wording.
 */
export { MISSING_HOST_ID_ERROR };

export interface BuildCreateEpicRequestArgs {
  readonly epicId: string;
  readonly chatId: string;
  readonly messageId: string;
  readonly clientActionId: string;
  readonly userId: string;
  readonly model: string;
  readonly instruction: string;
  /**
   * The host's REAL, durable id. Passed in rather than read from config here so
   * the caller is forced to confront the unconfigured case (`hostIdOrRefuse`)
   * and so this stays a pure function the contract test can drive.
   */
  readonly hostId: string;
  /** Stamped on both `createdAt` and `updatedAt`; injected so the contract test is deterministic. */
  readonly now: number;
  /**
   * M5 item 3/4: what the user picked. `FOLDERLESS_TARGET` reproduces the
   * exact request this flow sent before a picker existed, so the folderless
   * path is preserved rather than re-derived.
   */
  readonly target: WorkspaceTarget;
  /**
   * M5's inherited M1 item 6: the run settings to stamp on the folded first
   * message. `null` keeps the previous behaviour (first model of the default
   * harness, every other setting null).
   */
  readonly settings: ChatRunSettings | null;
}

/**
 * The host id to stamp on the new epic's first chat, or `null` to refuse.
 *
 * `chatSchema.hostId` is a durable, FOR-LIFE binding. The synthetic
 * `MOBILE_HOST_ID` ("mobile-host") placeholder that `use-create-chat.ts` falls
 * back to is not a cosmetic default: desktop resolves an unknown hostId to a
 * dead tile reading `Host "mobile-host" is unreachable`, with only a Clone
 * action. For a chat added to an existing epic that is one dead tile among
 * healthy ones. For a NEW epic the folded chat is the epic's ONLY agent, so the
 * whole epic opens on desktop as a container holding nothing but a dead,
 * host-unreachable agent — silently, permanently, and visibly to everyone else
 * on the account.
 *
 * This is live, not hypothetical: `.env.example` ships `VITE_HOST_ID=` empty,
 * and the build currently served from the Azure VM has it unset (verified in the
 * deployed bundle, where the expression is constant-folded to `mobile-host`).
 *
 * So the phone refuses to create rather than manufacturing that state. Gap 1 in
 * the protocol-gaps ticket is the real fix — a client cannot learn the host's id
 * over the wire — and until it lands, `VITE_HOST_ID` is the only honest source.
 */
export function hostIdOrRefuse(): string | null {
  return authoredChatHostId();
}

/**
 * Assembles the exact `epic.create` request body. Pure + exported so the contract
 * test can parse it against the REAL `createEpicRequestSchema`.
 */
export function buildCreateEpicRequest(
  args: BuildCreateEpicRequestArgs,
): CreateEpicRequest {
  // One title for both the epic and its first chat: desktop stores the epic
  // untitled ("") and backfills via a server-side title generation the phone
  // does not run, which would leave every phone-created epic reading "Untitled
  // epic" in the fleet. Deriving from the instruction's first line is the same
  // rule `deriveChatTitle` already applies to phone-authored chats.
  //
  // Its blank-instruction fallback ("New agent" — chat wording, wrong for an
  // epic) is unreachable from `useCreateEpic`: `submit` trims and bails on an
  // empty instruction, so the first line is always non-empty by the time it
  // gets here.
  const title = deriveChatTitle(args.instruction);
  const workspaceFields = toEpicWorkspaceFields(args.target);
  return {
    epic: {
      id: args.epicId,
      title,
      initialUserPrompt: args.instruction,
      ticketCount: 0,
      specCount: 0,
      storyCount: 0,
      reviewCount: 0,
      status: NEW_EPIC_STATUS,
      createdAt: args.now,
      updatedAt: args.now,
      // The acting user's own id, which is also what `epic.listTasks`'
      // ownership filter compares `createdBy` against. (gui-app stamps an
      // email here instead — either way the cloud create step is authoritative
      // for the persisted creator; this is the honest client-side value.)
      createdBy: args.userId,
      version: CURRENT_EPIC_VERSION,
    },
    // M5: derived from the pick rather than hardcoded empty. Folderless still
    // yields `[]` / `[]` / `"folderless"`, so that path is byte-identical to
    // what this flow sent before the picker existed.
    repoIdentifiers: [...workspaceFields.repoIdentifiers],
    workspaces: [...workspaceFields.workspaces],
    chat: {
      chatId: args.chatId,
      parentId: null,
      hostId: args.hostId,
      title,
      workspaceMode: workspaceFields.workspaceMode,
      worktreeIntent: toWorktreeIntent(args.target),
      initialMessage: buildInitialMessage({
        messageId: args.messageId,
        clientActionId: args.clientActionId,
        userId: args.userId,
        model: args.model,
        instruction: args.instruction,
        settings: args.settings,
      }),
    },
  };
}

export type CreateEpicPhase = "idle" | "submitting" | "error";

export interface UseCreateEpicResult {
  readonly phase: CreateEpicPhase;
  readonly error: string | null;
  /** Ignored when the instruction is blank or a submit is already in flight. */
  readonly submit: (instruction: string, target: WorkspaceTarget) => void;
}

export interface UseCreateEpicArgs {
  readonly client: MobileHostClient;
  /**
   * Used ONLY for the send-after-subscribe fallback when the host reports the
   * folded first turn didn't start. `null` (no host stream) degrades to an
   * honest "created but not running" error rather than a silent no-op.
   */
  readonly streamConnection: HostStreamConnection | null;
  /** Called with the minted `epicId` and its derived title once the host accepts the create. */
  readonly onCreated: (epicId: string, epicTitle: string) => void;
}

export function useCreateEpic({
  client,
  streamConnection,
  onCreated,
}: UseCreateEpicArgs): UseCreateEpicResult {
  const [phase, setPhase] = useState<CreateEpicPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  /**
   * The real double-submit guard. Reading `phase` from the closure is NOT
   * sufficient: two taps dispatched before React re-renders both observe the
   * stale `"idle"`, and the failure mode is two persistent epics from one
   * double-tap. A ref flips synchronously, so the second tap sees it.
   */
  const inFlightRef = useRef(false);

  const submit = useCallback(
    (instruction: string, target: WorkspaceTarget): void => {
      const text = instruction.trim();
      if (text.length === 0 || inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      setPhase("submitting");
      setError(null);

      const fail = (message: string): void => {
        inFlightRef.current = false;
        setPhase("error");
        setError(message);
      };

      void (async (): Promise<void> => {
        try {
          const userId = client.getRequestContextUserId();
          if (userId === null) {
            fail("You must be signed in to start an epic.");
            return;
          }

          // Refuse rather than stamp the synthetic placeholder — an epic whose
          // only agent is permanently host-unreachable is worse than no epic.
          const hostId = hostIdOrRefuse();
          if (hostId === null) {
            fail(MISSING_HOST_ID_ERROR);
            return;
          }

          // `epicId: null` — the epic being created does not exist yet, so this
          // is a host-scoped lookup (see this module's docblock).
          const model = await resolveAuthorModel(client, null);
          if (model === null) {
            fail("Couldn't resolve a model for this host.");
            return;
          }

          const epicId = uuidv4();
          const request = buildCreateEpicRequest({
            epicId,
            chatId: uuidv4(),
            messageId: uuidv4(),
            clientActionId: uuidv4(),
            userId,
            model,
            instruction: text,
            hostId,
            now: Date.now(),
            // Until the picker UI lands, this flow still creates folderless
            // epics — but the request is now DERIVED from a target rather than
            // hardcoded, so wiring the picker is a prop change, not a rewrite.
            target,
            settings: null,
          });

          const response = await client.request("epic.create", request);
          // Narrowing, not defensive padding: the seed's `initialMessage` is
          // `nullable()` on the wire even though this builder always supplies it.
          const foldedMessage = request.chat?.initialMessage ?? null;
          const foldedChatId = request.chat?.chatId ?? null;
          // The host reports whether it actually scheduled the folded turn.
          // Measured on a real host: this comes back FALSE, so the fallback is
          // the normal path, not an edge case. Re-sending is idempotent (the
          // host dedupes on `messageId`) — see `first-turn-fallback.ts`.
          if (
            response.initialTurnStarted !== true &&
            foldedChatId !== null &&
            foldedMessage !== null
          ) {
            const outcome = await startFoldedFirstTurn(
              streamConnection,
              {
                epicId,
                chatId: foldedChatId,
                initialMessage: foldedMessage,
              },
              FIRST_TURN_ACK_TIMEOUT_MS,
            );
            if (outcome !== "accepted") {
              // The epic and its message exist but nothing is acting on them.
              // Say so instead of navigating into apparent success — the epic is
              // still reachable from the fleet.
              fail(
                "Epic created, but its first agent didn't start. Open it from your work list and send the message again.",
              );
              return;
            }
          }
          inFlightRef.current = false;
          onCreated(epicId, request.epic.title);
        } catch (cause) {
          fail(toErrorMessage(cause));
        }
      })();
    },
    [client, streamConnection, onCreated],
  );

  return { phase, error, submit };
}

function toErrorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return "Couldn't create the epic. Please try again.";
}
