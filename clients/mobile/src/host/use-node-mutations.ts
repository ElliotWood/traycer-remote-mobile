/**
 * P1 — the Epic tree's per-row "⋯" mutations (rename/delete for both chats
 * and artifacts, plus create-artifact for the Artifacts-section "+" action).
 * Follows `use-create-chat.ts`'s proven `client.request(method, request)`
 * pattern exactly — every RPC here (`epic.renameChat`/`epic.deleteChat`/
 * `epic.renameArtifact`/`epic.deleteArtifact`/`epic.createArtifact`) already
 * exists on the host (verified against `protocol/src/host/epic/contracts.ts`
 * + `unary-schemas.ts`); this file only adds the call sites.
 *
 * These are this client's FIRST destructive writes (Evaluator P1 tighten
 * #3) — delete callers MUST route through a real confirm (see
 * `confirm-delete-dialog.tsx`), never fire on a bare tap.
 */
import { useCallback, useState } from "react";
import type { EpicArtifactKind } from "@traycer/protocol/common/registry";
import type { MobileHostClient } from "@/host/host-client-context";

export type MutationPhase = "idle" | "submitting" | "error";

function toErrorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return "That didn't go through. Please try again.";
}

export interface UseRenameNodeResult {
  readonly phase: MutationPhase;
  readonly error: string | null;
  readonly rename: (title: string) => void;
}

/** Shared shape for `useRenameChat`/`useRenameArtifact` — same request/response contour, different RPC method. `client: null` (no host configured) no-ops instead of throwing — mirrors `useChatBadges`'s nullable-connection convention. */
function useRenameNode(
  client: MobileHostClient | null,
  method: "epic.renameChat" | "epic.renameArtifact",
  epicId: string,
  nodeId: string,
  onRenamed: () => void,
): UseRenameNodeResult {
  const [phase, setPhase] = useState<MutationPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  const rename = useCallback(
    (title: string): void => {
      const trimmed = title.trim();
      if (trimmed.length === 0 || phase === "submitting" || client === null) {
        return;
      }
      setPhase("submitting");
      setError(null);
      void (async (): Promise<void> => {
        try {
          // A computed `{ [nodeIdKey]: nodeId }` property defeats the
          // request schema's discriminated union — branch explicitly so
          // each RPC call gets its own concretely-typed request body.
          if (method === "epic.renameChat") {
            await client.request(method, { epicId, chatId: nodeId, title: trimmed });
          } else {
            await client.request(method, { epicId, artifactId: nodeId, title: trimmed });
          }
          setPhase("idle");
          onRenamed();
        } catch (cause) {
          setPhase("error");
          setError(toErrorMessage(cause));
        }
      })();
    },
    [client, method, epicId, nodeId, onRenamed, phase],
  );

  return { phase, error, rename };
}

export function useRenameChat(
  client: MobileHostClient | null,
  epicId: string,
  chatId: string,
  onRenamed: () => void,
): UseRenameNodeResult {
  return useRenameNode(client, "epic.renameChat", epicId, chatId, onRenamed);
}

export function useRenameArtifact(
  client: MobileHostClient | null,
  epicId: string,
  artifactId: string,
  onRenamed: () => void,
): UseRenameNodeResult {
  return useRenameNode(client, "epic.renameArtifact", epicId, artifactId, onRenamed);
}

export interface UseDeleteNodeResult {
  readonly phase: MutationPhase;
  readonly error: string | null;
  /** No confirmation here — the CALLER (a `ConfirmDeleteDialog`) is the only allowed trigger. */
  readonly deleteNode: () => void;
}

function useDeleteNode(
  client: MobileHostClient | null,
  method: "epic.deleteChat" | "epic.deleteArtifact",
  epicId: string,
  nodeId: string,
  onDeleted: () => void,
): UseDeleteNodeResult {
  const [phase, setPhase] = useState<MutationPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  const deleteNode = useCallback((): void => {
    if (phase === "submitting" || client === null) {
      return;
    }
    setPhase("submitting");
    setError(null);
    void (async (): Promise<void> => {
      try {
        // Same discriminated-union issue as `useRenameNode` — branch on
        // `method` explicitly rather than a computed property key.
        if (method === "epic.deleteChat") {
          await client.request(method, { epicId, chatId: nodeId });
        } else {
          await client.request(method, { epicId, artifactId: nodeId });
        }
        setPhase("idle");
        onDeleted();
      } catch (cause) {
        setPhase("error");
        setError(toErrorMessage(cause));
      }
    })();
  }, [client, method, epicId, nodeId, onDeleted, phase]);

  return { phase, error, deleteNode };
}

export function useDeleteChat(
  client: MobileHostClient | null,
  epicId: string,
  chatId: string,
  onDeleted: () => void,
): UseDeleteNodeResult {
  return useDeleteNode(client, "epic.deleteChat", epicId, chatId, onDeleted);
}

export function useDeleteArtifact(
  client: MobileHostClient | null,
  epicId: string,
  artifactId: string,
  onDeleted: () => void,
): UseDeleteNodeResult {
  return useDeleteNode(client, "epic.deleteArtifact", epicId, artifactId, onDeleted);
}

export interface UseCreateArtifactArgs {
  readonly client: MobileHostClient | null;
  readonly epicId: string;
  /** `null` creates a root-level artifact; a real id nests it (Artifacts-row "+" action). */
  readonly parentId: string | null;
  readonly onCreated: (artifactId: string) => void;
}

export interface UseCreateArtifactResult {
  readonly phase: MutationPhase;
  readonly error: string | null;
  readonly create: (kind: EpicArtifactKind, title: string) => void;
}

export function useCreateArtifact({
  client,
  epicId,
  parentId,
  onCreated,
}: UseCreateArtifactArgs): UseCreateArtifactResult {
  const [phase, setPhase] = useState<MutationPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    (kind: EpicArtifactKind, title: string): void => {
      if (phase === "submitting" || client === null) {
        return;
      }
      setPhase("submitting");
      setError(null);
      void (async (): Promise<void> => {
        try {
          const response = await client.request("epic.createArtifact", {
            epicId,
            parentId,
            artifactType: kind,
            title: title.trim(),
          });
          setPhase("idle");
          onCreated(response.artifactId);
        } catch (cause) {
          setPhase("error");
          setError(toErrorMessage(cause));
        }
      })();
    },
    [client, epicId, parentId, onCreated, phase],
  );

  return { phase, error, create };
}

