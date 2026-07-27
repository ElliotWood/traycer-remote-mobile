/**
 * P1 — the Artifacts-section filter panel: status (multi) + kind (multi) +
 * read state (single), mirrors desktop's `ARTIFACT_STATUS`/kind checkboxes +
 * read radio (`epic-sidebar-filter-menu.tsx`). Agents get NO filter this
 * round (only one type — "chat" — exists until terminal-agents land; a
 * fake single-value control would be worse than none, per the P1 contract).
 */
import type { ReactElement } from "react";
import { KIND_COLORS, KIND_LABELS, STATUS_LABELS, type ArtifactStatus, type CardKind } from "@/views/kind-tokens";
import { radius, theme, type } from "@/views/design-tokens";
import { DEFAULT_ARTIFACT_FILTER, type ArtifactFilter } from "./artifacts-section";

const STATUSES: readonly ArtifactStatus[] = [0, 1, 2];
const KINDS: readonly CardKind[] = ["spec", "ticket", "story", "review"];
const READ_OPTIONS: readonly ArtifactFilter["read"][] = ["all", "unread", "read"];

function chipStyle(active: boolean, color: string) {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 10px",
    minHeight: 32,
    borderRadius: radius.md,
    border: `1px solid ${active ? color : theme.border}`,
    background: active ? `${color}22` : "transparent",
    color: theme.text,
    fontSize: 13,
    cursor: "pointer",
  } as const;
}

export function ArtifactFilterPanel({
  filter,
  onChange,
}: {
  readonly filter: ArtifactFilter;
  readonly onChange: (next: ArtifactFilter) => void;
}): ReactElement {
  const toggleStatus = (s: ArtifactStatus): void => {
    const next = new Set(filter.statuses);
    next.has(s) ? next.delete(s) : next.add(s);
    onChange({ ...filter, statuses: next });
  };
  const toggleKind = (k: CardKind): void => {
    const next = new Set(filter.kinds);
    next.has(k) ? next.delete(k) : next.add(k);
    onChange({ ...filter, kinds: next });
  };

  return (
    <div
      style={{
        background: theme.surface,
        border: `1px solid ${theme.borderHairline}`,
        borderRadius: radius.lg,
        padding: 12,
        marginBottom: 12,
      }}
    >
      <p style={{ ...type.bodyXs, color: theme.mutedText, margin: "0 0 6px" }}>Status</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {STATUSES.map((s) => (
          <button key={s} type="button" style={chipStyle(filter.statuses.has(s), theme.primary)} onClick={() => toggleStatus(s)}>
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <p style={{ ...type.bodyXs, color: theme.mutedText, margin: "0 0 6px" }}>Kind</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {KINDS.map((k) => (
          <button key={k} type="button" style={chipStyle(filter.kinds.has(k), KIND_COLORS[k])} onClick={() => toggleKind(k)}>
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>

      <p style={{ ...type.bodyXs, color: theme.mutedText, margin: "0 0 6px" }}>Read</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {READ_OPTIONS.map((r) => (
          <button
            key={r}
            type="button"
            style={chipStyle(filter.read === r, theme.primary)}
            onClick={() => onChange({ ...filter, read: r })}
          >
            {r === "all" ? "All" : r === "unread" ? "Unread" : "Read"}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onChange(DEFAULT_ARTIFACT_FILTER)}
        style={{ border: "none", background: "transparent", color: theme.mutedText, fontSize: 13, cursor: "pointer", padding: 0 }}
      >
        Clear filter
      </button>
    </div>
  );
}
