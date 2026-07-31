/**
 * Creating an agent, wired to `epic.createChat`.
 *
 * THE CHAT ID IS MINTED ONCE PER ATTEMPT SEQUENCE, NOT PER ATTEMPT.
 *
 * That is the entire safety argument and it is easy to destroy by accident.
 * `chatId` is client-supplied and the host resolver is idempotent on it, so
 * resending an identical request after an unconfirmed create either finds the
 * chat already made or makes it. Minting a fresh id on retry would look
 * identical in the UI, pass every rendering test, and quietly create two
 * agents — so the id lives in a ref that survives the failed attempt and is
 * cleared only on success.
 *
 * WHY THIS UNCONFIRMED STATE READS DIFFERENTLY FROM THE CHAT ONE.
 *
 * `ActionTracker`'s unconfirmed approvals must tell the user to go and LOOK,
 * because a duplicate approve acks `accepted` and the client genuinely cannot
 * distinguish "I did this" from "someone already had". Here the client can
 * make the situation true by repeating itself. Same word, opposite advice —
 * so the copy says try again rather than check first, and it says so because
 * of the idempotency, not to sound reassuring.
 */
import { useCallback, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  createChat,
  pendingChatIdAfter,
  titleFromInstruction,
  type CreateChatClient,
} from "@traycer-clients/shared/epic/create-chat";
import type { CreatePhase } from "./create-phase";

export interface CreateAgentResult {
  readonly phase: CreatePhase;
  /** No-ops when no client, no host or no usable title — see `canCreate`. */
  readonly create: (instruction: string) => void;
  /** The chat the last successful create produced, for navigation. */
  readonly createdChatId: string | null;
}

export function useCreateAgent(
  client: CreateChatClient | null,
  epicId: string,
  configuredHostId: string,
): CreateAgentResult {
  const [phase, setPhase] = useState<CreatePhase>({ kind: "idle" });
  const [createdChatId, setCreatedChatId] = useState<string | null>(null);
  // Survives a failed attempt on purpose. See the docblock.
  const pendingChatId = useRef<string | null>(null);
  // A second submit while one is in flight would mint nothing new but would
  // race two responses onto the same phase.
  const inFlight = useRef(false);

  const create = useCallback(
    (instruction: string) => {
      if (client === null) return;
      if (configuredHostId.trim().length === 0) return;
      if (inFlight.current) return;
      const title = titleFromInstruction(instruction);
      // `null` means no usable first line. The host would accept an empty
      // title and the agent would be unnamed for life, so this stops here.
      if (title === null) return;

      pendingChatId.current ??= uuidv4();
      const chatId = pendingChatId.current;
      inFlight.current = true;
      setPhase({ kind: "submitting" });

      void createChat(client, {
        epicId,
        chatId,
        hostId: configuredHostId,
        title,
      }).then((outcome) => {
        inFlight.current = false;
        // The keep-or-clear rule is `pendingChatIdAfter`, not an `if` here.
        // Both branches look the same on screen, so the decision lives in a
        // tested pure function and this callback only applies it.
        pendingChatId.current = pendingChatIdAfter(outcome, chatId);
        if (outcome.kind === "created") {
          setCreatedChatId(outcome.chatId);
          setPhase({ kind: "idle" });
          return;
        }
        // "idempotent" because `createChatRequestSchema` takes a client-supplied
        // `chatId` and states the resolver dedupes on it — not because retrying
        // feels safe. The neighbouring artifact create reads the opposite from
        // its own contract.
        setPhase({
          kind: "unconfirmed",
          reason: outcome.reason,
          retry: "idempotent",
        });
      });
    },
    [client, epicId, configuredHostId],
  );

  return { phase, create, createdChatId };
}
