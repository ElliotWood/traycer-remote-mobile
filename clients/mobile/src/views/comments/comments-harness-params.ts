/**
 * Parses the Sprint 4 harness route's query params: `?comments=1&epicId=&
 * artifactType=&artifactId=`. Reachable only AFTER the normal sign-in gate
 * (`AppShell` renders it in place of the Fleet→Epic→Chat drilldown) - unlike
 * Sprint 1's no-auth `?showcase=1`, this harness needs a REAL bearer, so no
 * auth bypass is introduced here.
 *
 * Pure and independently testable: malformed/missing params return `null`
 * and the caller falls through to the normal app shell.
 */
import type { EpicArtifactKind } from "@traycer/protocol/common/registry";

export interface CommentsHarnessParams {
  readonly epicId: string;
  readonly artifactType: EpicArtifactKind;
  readonly artifactId: string;
}

const VALID_ARTIFACT_TYPES: ReadonlySet<string> = new Set([
  "spec",
  "ticket",
  "story",
  "review",
]);

function isEpicArtifactKind(value: string): value is EpicArtifactKind {
  return VALID_ARTIFACT_TYPES.has(value);
}

export function parseCommentsHarnessParams(
  search: string,
): CommentsHarnessParams | null {
  const params = new URLSearchParams(search);
  if (params.get("comments") !== "1") {
    return null;
  }
  const epicId = params.get("epicId");
  const artifactType = params.get("artifactType");
  const artifactId = params.get("artifactId");
  if (epicId === null || epicId.length === 0) return null;
  if (artifactId === null || artifactId.length === 0) return null;
  if (artifactType === null || !isEpicArtifactKind(artifactType)) return null;
  return { epicId, artifactType, artifactId };
}
