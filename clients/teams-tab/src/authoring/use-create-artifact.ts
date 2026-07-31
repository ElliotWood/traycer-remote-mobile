/**
 * Creating an artifact, wired to `epic.createArtifact`.
 *
 * Deliberately NOT symmetrical with `use-create-agent`. There is no minted id
 * held across a failure here, because there is no client-supplied id to mint:
 * the contract takes none and states no dedupe rule, so a retry is a second
 * artifact. The phase therefore carries `retry: "may-duplicate"`, and the
 * component renders the advice that follows from it.
 *
 * The asymmetry is the correct outcome, not an inconsistency to tidy up. See
 * `./create-phase`.
 */
import { useCallback, useRef, useState } from "react";
import {
  createArtifact,
  normalizeArtifactTitle,
  CREATE_ARTIFACT_IS_IDEMPOTENT,
  type CreateArtifactClient,
} from "@traycer-clients/shared/epic/create-artifact";
import type { ArtifactKind } from "@traycer-clients/shared/epic/epic-doc-artifacts";
import type { CreatePhase } from "./create-phase";

export interface CreateArtifactResult {
  readonly phase: CreatePhase;
  readonly create: (input: {
    readonly title: string;
    readonly artifactType: ArtifactKind;
  }) => void;
  readonly createdArtifactId: string | null;
}

export function useCreateArtifact(
  client: CreateArtifactClient | null,
  epicId: string,
): CreateArtifactResult {
  const [phase, setPhase] = useState<CreatePhase>({ kind: "idle" });
  const [createdArtifactId, setCreatedArtifactId] = useState<string | null>(null);
  // Matters MORE here than for chats: without a client id there is no dedupe,
  // so two in-flight requests from a double-click are two artifacts.
  const inFlight = useRef(false);

  const create = useCallback(
    (input: { readonly title: string; readonly artifactType: ArtifactKind }) => {
      if (client === null) return;
      if (inFlight.current) return;
      const title = normalizeArtifactTitle(input.title);
      if (title === null) return;

      inFlight.current = true;
      setPhase({ kind: "submitting" });

      void createArtifact(client, {
        epicId,
        title,
        artifactType: input.artifactType,
      }).then((outcome) => {
        inFlight.current = false;
        if (outcome.kind === "created") {
          setCreatedArtifactId(outcome.artifactId);
          setPhase({ kind: "idle" });
          return;
        }
        setPhase({
          kind: "unconfirmed",
          reason: outcome.reason,
          // Read from the contract module, not asserted here, so this cannot
          // drift from the protocol if the host ever gains an id parameter.
          retry: CREATE_ARTIFACT_IS_IDEMPOTENT ? "idempotent" : "may-duplicate",
        });
      });
    },
    [client, epicId],
  );

  return { phase, create, createdArtifactId };
}
