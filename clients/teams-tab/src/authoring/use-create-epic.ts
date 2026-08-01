/**
 * Creating an epic, wired to `epic.create` as a FOLDERLESS epic.
 *
 * WHY THE RETRY ADVICE DIFFERS FROM `use-create-agent`, WHICH THIS OTHERWISE
 * MIRRORS. That hook says "press it again"; this one says "go and look". The
 * two calls are a line apart in the same schema file and only one of them
 * documents a dedupe:
 *
 *   createChatRequestSchema.chatId   "Client-supplied. The host resolver is
 *                                    idempotent on this id."
 *   epicLightSchema.id               nothing.
 *
 * `create-phase.ts` states the rule for precisely this case — default to
 * "verify", and claim retry-safety only where the schema says so. Copying the
 * neighbouring hook's `retry: "idempotent"` would look identical on screen,
 * pass every rendering test, and tell someone it is safe to press a button
 * that may leave two epics in their fleet.
 *
 * BOTH IDS ARE MINTED ONCE PER ATTEMPT SEQUENCE, exactly as the agent create
 * does, and for a reason that survives the advice being different: a
 * byte-identical retry is the only shape a host-side dedupe could ever absorb.
 * Reminting would foreclose that possibility outright. See
 * `shared/epic/create-epic.ts` → `pendingEpicIdAfter`.
 */
import { useCallback, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { titleFromInstruction } from "@traycer-clients/shared/epic/create-chat";
import {
  createEpic,
  pendingEpicIdAfter,
  type CreateEpicClient,
} from "@traycer-clients/shared/epic/create-epic";
import { EPIC_CREATE_RETRY, epicCreateRefusal } from "./epic-create-rules";
import type { CreatePhase } from "./create-phase";

export interface CreateEpicResult {
  readonly phase: CreatePhase;
  /** No-ops when no client, no host, no user or no usable title — see `canCreate`. */
  readonly create: (instruction: string) => void;
  /** The epic the last successful create produced, for navigation. */
  readonly createdEpicId: string | null;
}

export function useCreateEpic(
  client: CreateEpicClient | null,
  configuredHostId: string,
  /**
   * The signed-in user's id, stamped as `createdBy`. Empty when the identity
   * has not resolved yet, which blocks the create rather than substituting a
   * placeholder: `createdBy` is what `epic.listTasks`' ownership filter reads,
   * so a wrong value produces an epic the user cannot see in their own fleet.
   */
  createdBy: string,
  /**
   * Injected so the contract test is deterministic.
   *
   * No default: the clock a hook reads is exactly the kind of thing that
   * should be visible at the call site. A defaulted `Date.now` is how a test
   * ends up asserting against the real clock without anyone choosing that.
   */
  now: () => number,
): CreateEpicResult {
  const [phase, setPhase] = useState<CreatePhase>({ kind: "idle" });
  const [createdEpicId, setCreatedEpicId] = useState<string | null>(null);
  // Both survive a failed attempt on purpose. See the docblock.
  const pendingEpicId = useRef<string | null>(null);
  const pendingChatId = useRef<string | null>(null);
  // A second submit while one is in flight would mint nothing new but would
  // race two responses onto the same phase.
  const inFlight = useRef(false);

  const create = useCallback(
    (instruction: string) => {
      const title = titleFromInstruction(instruction);
      // Every reason to refuse lives in one tested function — see
      // `./epic-create-rules`. The host would ACCEPT a blank title and an
      // unowned epic; these are not validation errors it rejects for us.
      if (
        epicCreateRefusal({
          hasClient: client !== null,
          configuredHostId,
          userId: createdBy,
          title,
          inFlight: inFlight.current,
        }) !== null
      ) {
        return;
      }
      // Narrowed by the gate above; restated for the type checker.
      if (client === null || title === null) return;

      pendingEpicId.current ??= uuidv4();
      pendingChatId.current ??= uuidv4();
      const epicId = pendingEpicId.current;
      const chatId = pendingChatId.current;
      inFlight.current = true;
      setPhase({ kind: "submitting" });

      void createEpic(client, {
        epicId,
        chatId,
        hostId: configuredHostId,
        title,
        initialUserPrompt: instruction,
        createdBy,
        now: now(),
      }).then((outcome) => {
        inFlight.current = false;
        // The keep-or-clear rule is `pendingEpicIdAfter`, not an `if` here.
        // Both branches look the same on screen, so the decision lives in a
        // tested pure function and this callback only applies it.
        pendingEpicId.current = pendingEpicIdAfter(outcome, epicId);
        pendingChatId.current = outcome.kind === "created" ? null : chatId;
        if (outcome.kind === "created") {
          setCreatedEpicId(outcome.epicId);
          setPhase({ kind: "idle" });
          return;
        }
        // "may-duplicate" because `epicLightSchema.id` carries no dedupe rule,
        // NOT because a retry is known to be unsafe. The absence of the
        // guarantee is the reason, and it is the conservative direction the
        // contract module asks for.
        setPhase({
          kind: "unconfirmed",
          reason: outcome.reason,
          retry: EPIC_CREATE_RETRY,
        });
      });
    },
    [client, configuredHostId, createdBy, now],
  );

  return { phase, create, createdEpicId };
}
