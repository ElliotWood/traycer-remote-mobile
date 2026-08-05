/**
 * P1 — the Artifacts-section "Add child" / root "+" flow: pick a kind
 * (spec/ticket/story/review) and a title, dispatch `epic.createArtifact`.
 * Mirrors `author-view.tsx`'s minimal-form shape for the chat side.
 */
import { useState, type CSSProperties, type ReactElement } from "react";
import type { MobileHostClient } from "@/host/host-client-context";
import { useCreateArtifact } from "@/host/use-node-mutations";
import { KIND_COLORS, KIND_ICONS, KIND_LABELS, type CardKind } from "./kind-tokens";
import { Button, radius, screen, theme, type } from "./design-tokens";

const KINDS: readonly CardKind[] = ["spec", "ticket", "story", "review"];

interface CreateArtifactViewProps {
  readonly epicId: string;
  readonly parentId: string | null;
  readonly client: MobileHostClient;
  readonly onCreated: (artifactId: string) => void;
  readonly onCancel: () => void;
}

export function CreateArtifactView({
  epicId,
  parentId,
  client,
  onCreated,
  onCancel,
}: CreateArtifactViewProps): ReactElement {
  const [kind, setKind] = useState<CardKind>("spec");
  const [title, setTitle] = useState("");
  const { phase, error, create } = useCreateArtifact({ client, epicId, parentId, onCreated });

  const submitting = phase === "submitting";
  const canSubmit = title.trim().length > 0 && !submitting;

  return (
    <main style={screen}>
      <Button variant="ghost" onClick={onCancel} disabled={submitting}>
        ← Cancel
      </Button>

      <header style={{ margin: "16px 0 12px" }}>
        <h1 style={{ ...type.titleMd, margin: 0, color: theme.text }}>
          New {parentId === null ? "" : "child "}artifact
        </h1>
      </header>

      <p style={{ ...type.bodySm, color: theme.mutedText, margin: "0 0 8px" }}>Kind</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {KINDS.map((k) => {
          const Icon = KIND_ICONS[k];
          const selected = k === kind;
          const color = KIND_COLORS[k];
          const chipStyle: CSSProperties = {
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 12px",
            borderRadius: radius.md,
            border: `1px solid ${selected ? color : theme.border}`,
            background: selected ? `${color}22` : "transparent",
            color: theme.text,
            cursor: "pointer",
            minHeight: 44,
          };
          return (
            <button key={k} type="button" style={chipStyle} onClick={() => setKind(k)} disabled={submitting}>
              <Icon size={16} color={color} aria-hidden="true" />
              {KIND_LABELS[k]}
            </button>
          );
        })}
      </div>

      <p style={{ ...type.bodySm, color: theme.mutedText, margin: "0 0 8px" }}>Title</p>
      <input
        autoFocus
        value={title}
        disabled={submitting}
        aria-label="Title"
        placeholder="e.g. Add a health-check endpoint"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && canSubmit) create(kind, title);
        }}
        style={{
          width: "100%",
          boxSizing: "border-box",
          minHeight: 44,
          padding: "0 12px",
          fontSize: 15,
          borderRadius: radius.md,
          border: `1px solid ${theme.border}`,
          background: theme.surface,
          color: theme.text,
          marginBottom: 16,
        }}
      />

      <Button variant="primary" fullWidth disabled={!canSubmit} onClick={() => create(kind, title)}>
        {submitting ? "Creating…" : "Create"}
      </Button>

      {error !== null && (
        <p role="alert" style={{ color: theme.danger, fontSize: 13, margin: "12px 0 0" }}>
          {error}
        </p>
      )}
    </main>
  );
}
