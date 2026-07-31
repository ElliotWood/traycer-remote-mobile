/**
 * `epic.createArtifact` — request building, with no UI in it.
 *
 * NOT IDEMPOTENT, and that is the whole reason this is a separate module from
 * `./create-chat` rather than a second function inside it.
 *
 * `createChatRequestSchema` carries a client-supplied `chatId` and says in so
 * many words that the host resolver is idempotent on it. `createArtifactRequestSchema`
 * carries `{ epicId, parentId, artifactType, title }` and nothing else —
 * `artifactId` exists only on the RESPONSE, and no dedupe rule is stated
 * anywhere in the contract. So a resend after a create that did not come back
 * produces a SECOND artifact.
 *
 * Two neighbouring creates on the same screen, identical to look at, opposite
 * correct advice when they fail. The difference is visible only in the
 * schemas, which is why the retry-safety is stated here at the call site and
 * travels with the phase rather than being decided by whichever component
 * renders it.
 *
 * If the host ever gains a client-supplied artifact id, this becomes
 * idempotent and the advice must change with it — the constant below is the
 * single place that would need editing.
 */
import type { HostRequester } from "../host-client/host-client";
import type { HostRpcRegistry } from "@traycer/protocol/host/index";
import type { CreateArtifactRequest } from "@traycer/protocol/host/epic/unary-schemas";
import type { ArtifactKind } from "./epic-doc-artifacts";

/** Only `request` is needed, so tests can inject a fake. */
export type CreateArtifactClient = Pick<HostRequester<HostRpcRegistry>, "request">;

/**
 * Stated as a value, not a comment, so the UI reads it rather than restating
 * it. Read from the contract: no client-supplied id, no dedupe rule.
 */
export const CREATE_ARTIFACT_IS_IDEMPOTENT = false;

export const MAX_ARTIFACT_TITLE_LENGTH = 120;

export interface CreateArtifactInput {
  readonly epicId: string;
  readonly title: string;
  readonly artifactType: ArtifactKind;
  /** Top-level artifact when null. */
  readonly parentId?: string | null;
}

/**
 * A title the host will accept and a surface can render, or `null`.
 *
 * `null` rather than `""`: the host does not reject an empty title, so an
 * unnamed artifact would be created and stay unnamed. The refusal has to
 * happen here.
 */
export function normalizeArtifactTitle(title: string): string | null {
  const trimmed = title.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > MAX_ARTIFACT_TITLE_LENGTH
    ? `${trimmed.slice(0, MAX_ARTIFACT_TITLE_LENGTH - 1).trimEnd()}…`
    : trimmed;
}

export function buildCreateArtifactRequest(
  input: CreateArtifactInput,
): CreateArtifactRequest {
  return {
    epicId: input.epicId,
    parentId: input.parentId ?? null,
    artifactType: input.artifactType,
    title: input.title,
  };
}

export type CreateArtifactOutcome =
  | { readonly kind: "created"; readonly artifactId: string }
  /**
   * The request did not come back and the caller CANNOT resolve this by
   * retrying — see the module docblock. The only safe move is to look.
   */
  | { readonly kind: "unconfirmed"; readonly reason: string };

export async function createArtifact(
  client: CreateArtifactClient,
  input: CreateArtifactInput,
): Promise<CreateArtifactOutcome> {
  try {
    const response = await client.request(
      "epic.createArtifact",
      buildCreateArtifactRequest(input),
    );
    return { kind: "created", artifactId: response.artifactId };
  } catch (error) {
    return {
      kind: "unconfirmed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
