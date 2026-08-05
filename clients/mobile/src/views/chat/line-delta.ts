import { diffLines } from "diff";

export interface LineDelta {
  readonly added: number;
  readonly deleted: number;
}

/** Added/deleted line counts for a snapshot-sourced change; `{0,0}` for anything else (binary/too-large/etc — nothing to count). */
export function computeLineDelta(
  beforeContent: string | null,
  afterContent: string | null,
  reason: string,
): LineDelta {
  if (reason !== "snapshot") return { added: 0, deleted: 0 };
  const parts = diffLines(beforeContent ?? "", afterContent ?? "");
  let added = 0;
  let deleted = 0;
  for (const part of parts) {
    const lineCount = part.count ?? 0;
    if (part.added) added += lineCount;
    else if (part.removed) deleted += lineCount;
  }
  return { added, deleted };
}
