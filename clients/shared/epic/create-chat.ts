/**
 * `epic.createChat` — request building and the title rule, with no UI in it.
 *
 * WHY THIS CREATE IS SAFE TO RETRY AND THE APPROVAL ACTIONS ARE NOT.
 *
 * `chatId` is CLIENT-SUPPLIED, and the contract states the host resolver is
 * idempotent on it. That single fact inverts the problem `ActionTracker`
 * exists to solve. There, a duplicate approve acks `accepted` and the client
 * cannot tell "I did this" from "someone already did", so an unconfirmed
 * action can only be reported as unconfirmed and handed back to the user.
 *
 * Here, the client mints the id BEFORE the first attempt and reuses it. A
 * retry either finds the chat already made and returns it, or makes it. Both
 * answers are the same answer. So the honest UX for a create that did not
 * confirm is RETRY THE SAME REQUEST, not "check whether it worked" — and that
 * only holds because the id is minted once, up front. Minting a fresh id per
 * attempt would silently convert a safe retry into a duplicate-agent bug, so
 * `chatId` is a required input here rather than something this module
 * generates.
 *
 * WHY THERE IS NO `initialMessage`.
 *
 * The field exists so the landing flow can overlap ~3s of provider cold-start
 * with the renderer's `chat.subscribe` round trip. It carries run settings and
 * billing `accountContext` — an app-wide selection this client does not make
 * and would have to invent. The response's `initialTurnStarted` documents the
 * alternative explicitly: `false`/absent means the caller sends the message
 * after `chat.subscribe`. That is a supported path, not a shortcut around one.
 * The cost is latency on a create; the cost of the other route is guessing at
 * somebody's billing context.
 *
 * `hostId` is stamped on the chat FOR LIFE. This module requires it and will
 * not default it — see `teams-tab/src/authoring/authoring-scope.ts` for why a
 * wrong value here is permanent rather than merely inconvenient.
 */
import type { HostRequester } from "../host-client/host-client";
import type { HostRpcRegistry } from "@traycer/protocol/host/index";
import type { CreateChatRequest } from "@traycer/protocol/host/epic/unary-schemas";

/** Only `request` is needed, so tests can inject a fake. */
export type CreateChatClient = Pick<HostRequester<HostRpcRegistry>, "request">;

/**
 * Longest chat title we will send.
 *
 * The host does not impose this; it is a display decision made at the source
 * so a pasted paragraph does not become a title no surface can render.
 */
export const MAX_TITLE_LENGTH = 120;

/**
 * The title rule: first line of the instruction, trimmed and capped.
 *
 * The first line is what the person wrote as their opening thought, which is
 * a better title than the first N characters of a paragraph — that cuts
 * mid-sentence and reads as truncation rather than a name.
 *
 * Returns `null` for an instruction with no usable first line, so the caller
 * decides what to do rather than a blank title reaching the host. An empty
 * title is not a validation error the host will reject for us — it would be
 * accepted and render as an unnamed agent forever.
 */
export function titleFromInstruction(instruction: string): string | null {
  const firstLine = instruction
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine === undefined) return null;
  return firstLine.length > MAX_TITLE_LENGTH
    ? `${firstLine.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
    : firstLine;
}

export interface CreateChatInput {
  readonly epicId: string;
  /**
   * Minted ONCE by the caller and reused across retries — the whole basis of
   * the idempotency argument above.
   */
  readonly chatId: string;
  /** Stamped for life. No default, deliberately. */
  readonly hostId: string;
  readonly title: string;
  /** Top-level agent when null. */
  readonly parentId?: string | null;
}

/** The request, built in one place so the retry sends a byte-identical one. */
export function buildCreateChatRequest(
  input: CreateChatInput,
): CreateChatRequest {
  return {
    epicId: input.epicId,
    parentId: input.parentId ?? null,
    hostId: input.hostId,
    title: input.title,
    chatId: input.chatId,
  };
}

export type CreateChatOutcome =
  | { readonly kind: "created"; readonly chatId: string }
  /**
   * The request did not come back. The chat MAY exist — but unlike an
   * approval, the caller can resolve this by sending the identical request
   * again, because `chatId` was minted before the first attempt.
   */
  | { readonly kind: "unconfirmed"; readonly reason: string };

/**
 * What the caller should keep as its pending chat id after an attempt.
 *
 * This is a two-line rule and it is the ONLY thing standing between an
 * unconfirmed create and two agents, so it lives here — pure and tested —
 * rather than as an `if` inside a promise callback where the wrong branch
 * looks identical in every screenshot and passes every render test.
 *
 * Clear on success so the next create is a genuinely new agent. Keep on
 * unconfirmed so the retry is the same request.
 */
export function pendingChatIdAfter(
  outcome: CreateChatOutcome,
  attemptedChatId: string,
): string | null {
  return outcome.kind === "created" ? null : attemptedChatId;
}

export async function createChat(
  client: CreateChatClient,
  input: CreateChatInput,
): Promise<CreateChatOutcome> {
  try {
    const response = await client.request(
      "epic.createChat",
      buildCreateChatRequest(input),
    );
    // Trust the host's id over the one we sent: they are the same today, and
    // if they ever diverge the host's is the real one.
    return { kind: "created", chatId: response.chatId };
  } catch (error) {
    return {
      kind: "unconfirmed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
