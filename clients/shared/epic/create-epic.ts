/**
 * `epic.create` — request building for a FOLDERLESS epic, with no UI in it.
 *
 * WHY THIS EXISTS AT ALL, GIVEN IT WAS RECORDED AS IMPOSSIBLE.
 *
 * `teams-tab/src/authoring/authoring-scope.ts` stated that `epic.create`
 * "requires `workspaces: [{ workspacePath }]` — ABSOLUTE FILESYSTEM PATHS on a
 * specific machine", and concluded the create was blocked rather than unbuilt
 * because a Teams user cannot browse a directory on the host. The premise is
 * true and the conclusion does not follow, because the answer is not to supply
 * a path — it is to need none:
 *
 *   - `createEpicRequestSchema.workspaces` is `z.array(...)` with NO `.min(1)`,
 *     so `[]` is a valid request, not a degraded one.
 *   - Desktop calls it that way itself. gui-app's landing composer has two
 *     tests named "creates a folderless epic without a selected workspace
 *     folder", sending `repoIdentifiers: []`, `workspaces: []` and a chat seed
 *     with `workspaceMode: "folderless"`.
 *   - `epic.create` is on the RELEASED FLOOR (`protocol/src/host/released-floor.ts`),
 *     so every host this client may handshake with exposes it. No capability
 *     probe, no `E_HOST_UNSUPPORTED` path to design around.
 *
 * So a folderless epic is a first-class host flow that happens to be the only
 * one a pathless client can honestly express. The agent runs without a bound
 * repo, which is right for the planning and question-answering work done from
 * a tab or a phone.
 *
 * WHY THERE IS NO `initialMessage`, matching `./create-chat`.
 *
 * The field lets the host schedule the provider turn during the create, but it
 * carries `settings` and a billing `accountContext` — an app-wide selection
 * this client does not make and would have to invent. `createEpicChatSeedSchema`
 * declares it `.nullable()`, and sending the first message after `chat.subscribe`
 * is the documented alternative rather than a way around one. The cost is
 * latency on a create; the cost of the other route is guessing at somebody's
 * billing context.
 *
 * WHY A CHAT IS FOLDED IN AT ALL. `chat` is `.nullable().optional()`, so an
 * epic-only create is legal — and produces an epic containing no agent, which
 * reads in the fleet as an empty container the user then has to populate
 * through a second, differently-shaped flow. The folded seed gives the new epic
 * its first agent atomically, which is what desktop and the phone both do.
 *
 * `hostId` is stamped on that chat FOR LIFE. This module requires it and will
 * not default it — see `teams-tab/src/authoring/authoring-scope.ts` for why a
 * wrong value here is permanent rather than merely inconvenient.
 */
import { CURRENT_EPIC_VERSION } from "./epic-version";
import type { HostRequester } from "../host-client/host-client";
import type { HostRpcRegistry } from "@traycer/protocol/host/index";
import type { CreateEpicRequest } from "@traycer/protocol/host/epic/unary-schemas";

/** Only `request` is needed, so tests can inject a fake. */
export type CreateEpicClient = Pick<HostRequester<HostRpcRegistry>, "request">;

/**
 * `epicLightSchema.status` is a freeform string. `"todo"` is what desktop's
 * landing composer stamps on a fresh epic, so an epic created here is
 * indistinguishable from a desktop-created one in the fleet list.
 */
export const NEW_EPIC_STATUS = "todo";

/**
 * The `workspaceMode` that makes "no paths" an explicit statement rather than
 * an omission. Named because the string appears in the host's own tests and a
 * typo would silently create a differently-shaped epic.
 */
export const FOLDERLESS_WORKSPACE_MODE = "folderless";

export interface CreateEpicInput {
  /**
   * Minted ONCE by the caller and reused across retries. See
   * {@link pendingEpicIdAfter} for what that does and does not buy.
   */
  readonly epicId: string;
  /** The folded first chat's id, likewise minted once. */
  readonly chatId: string;
  /** Stamped on the folded chat for life. No default, deliberately. */
  readonly hostId: string;
  /** Both the epic's title and its first chat's. */
  readonly title: string;
  /** What the user typed, kept verbatim on the epic. */
  readonly initialUserPrompt: string;
  /**
   * The acting user's own id, which is what `epic.listTasks`' ownership filter
   * compares against. The cloud create step is authoritative for the persisted
   * creator; this is the honest client-side value.
   */
  readonly createdBy: string;
  /** Stamped on `createdAt` and `updatedAt`; injected so tests are deterministic. */
  readonly now: number;
}

/** The request, built in one place so a retry sends a byte-identical one. */
export function buildCreateEpicRequest(
  input: CreateEpicInput,
): CreateEpicRequest {
  return {
    epic: {
      id: input.epicId,
      title: input.title,
      initialUserPrompt: input.initialUserPrompt,
      ticketCount: 0,
      specCount: 0,
      storyCount: 0,
      reviewCount: 0,
      status: NEW_EPIC_STATUS,
      createdAt: input.now,
      updatedAt: input.now,
      createdBy: input.createdBy,
      version: CURRENT_EPIC_VERSION,
    },
    // Folderless: no local paths, therefore no repo identifiers to derive.
    repoIdentifiers: [],
    workspaces: [],
    chat: {
      chatId: input.chatId,
      parentId: null,
      hostId: input.hostId,
      title: input.title,
      workspaceMode: FOLDERLESS_WORKSPACE_MODE,
      worktreeIntent: null,
      initialMessage: null,
    },
  };
}

export type CreateEpicOutcome =
  | { readonly kind: "created"; readonly epicId: string }
  /**
   * The request did not come back. The epic MAY exist. Unlike
   * `epic.createChat`, the caller CANNOT be told a retry is free — see
   * {@link pendingEpicIdAfter}.
   */
  | { readonly kind: "unconfirmed"; readonly reason: string };

/**
 * What the caller should keep as its pending epic id after an attempt.
 *
 * READ THIS BEFORE COPYING `create-chat`'s RETRY ADVICE. The two look
 * identical and the contracts are not:
 *
 *   createChatRequestSchema.chatId   "Client-supplied. The host resolver is
 *                                    idempotent on this id." (stated, in the
 *                                    schema, at the field)
 *   epicLightSchema.id               says NOTHING about dedupe.
 *
 * `create-phase.ts` gives the rule for exactly this situation: "if this is
 * ever unclear for a new call, DEFAULT TO 'verify' — read the contract, and
 * only claim retry-safety when the schema says so". So the surface wired to
 * this module must use `retry: "may-duplicate"`, and the absence of a comment
 * is the reason. If the host later documents a dedupe on `epic.id`, this is
 * the one place that changes.
 *
 * The id is still kept across attempts rather than reminted, because a
 * byte-identical retry is the only shape a host-side dedupe COULD absorb, and
 * reminting would foreclose it. Keeping it maximises the chance a retry is
 * harmless; it does not license telling the user that it is.
 */
export function pendingEpicIdAfter(
  outcome: CreateEpicOutcome,
  attemptedEpicId: string,
): string | null {
  return outcome.kind === "created" ? null : attemptedEpicId;
}

export async function createEpic(
  client: CreateEpicClient,
  input: CreateEpicInput,
): Promise<CreateEpicOutcome> {
  try {
    await client.request("epic.create", buildCreateEpicRequest(input));
    // `createEpicResponseSchema` carries `roomInfo` and a list-shape `task`,
    // but no epic id of its own — the id we sent IS the epic's id, which is
    // why it is minted client-side rather than read back.
    return { kind: "created", epicId: input.epicId };
  } catch (error) {
    return {
      kind: "unconfirmed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
