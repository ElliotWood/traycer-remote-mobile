/**
 * Author a new agent from inside an open epic (T7, Flow 5).
 *
 * A deliberately minimal form — an instruction textarea + "Start agent" — that
 * dispatches `epic.createChat` (via `useCreateChat`) with the instruction folded
 * in as the initial message, then lands the user in the new chat's detail (T6).
 * The host reuses the epic's workspace setup, so the phone supplies no path; the
 * run model is resolved from the host (see `useCreateChat`), never hardcoded.
 *
 * A rejected create (or an unresolvable model) shows an inline error and keeps
 * the typed instruction, rather than failing silently.
 */
import { useState, type CSSProperties, type ReactElement } from "react";
import type { MobileHostClient } from "@/host/host-client-context";
import { useCreateChat } from "@/host/use-create-chat";
import { useStreamConnectionOrNull } from "@/host/stream-connection-context";
import { colors, primaryButton, screen, secondaryButton } from "./ui";

interface AuthorViewProps {
  readonly epicId: string;
  readonly client: MobileHostClient;
  /** P1: nests the new chat under this parent (Agents-row "+" action). `null`/omitted for a top-level chat. */
  readonly parentId?: string | null;
  /** Called with the minted chatId once the host accepts the create (→ T6). */
  readonly onCreated: (chatId: string) => void;
  readonly onCancel: () => void;
}

export function AuthorView({
  epicId,
  client,
  parentId = null,
  onCreated,
  onCancel,
}: AuthorViewProps): ReactElement {
  const [instruction, setInstruction] = useState("");
  // Only for the folded-first-turn fallback — the host reports the turn didn't
  // start far more often than not, and without a stream to re-send over this
  // form would land the user in a chat that will never do anything.
  const streamConnection = useStreamConnectionOrNull();
  const { phase, error, submit } = useCreateChat({
    client,
    epicId,
    parentId,
    streamConnection,
    onCreated,
  });

  const submitting = phase === "submitting";
  const canSubmit = instruction.trim().length > 0 && !submitting;

  return (
    <main style={screen}>
      <button
        type="button"
        style={{ ...secondaryButton, marginBottom: 16 }}
        onClick={onCancel}
        disabled={submitting}
      >
        ← Cancel
      </button>

      <header style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>New agent</h1>
        <p style={{ color: colors.muted, margin: "4px 0 0", fontSize: 13 }}>
          Describe what the agent should do. It runs in this epic's workspace.
        </p>
      </header>

      <textarea
        value={instruction}
        disabled={submitting}
        placeholder="e.g. Add a health-check endpoint and a test for it"
        aria-label="Instruction"
        rows={6}
        style={textarea}
        onChange={(e) => setInstruction(e.target.value)}
      />

      <button
        type="button"
        disabled={!canSubmit}
        style={{
          ...primaryButton,
          marginTop: 12,
          opacity: canSubmit ? 1 : 0.5,
          cursor: canSubmit ? "pointer" : "default",
        }}
        onClick={() => submit(instruction)}
      >
        {submitting ? "Starting…" : "Start agent"}
      </button>

      {error !== null && (
        <p role="alert" style={{ color: colors.danger, fontSize: 13, margin: "12px 0 0" }}>
          {error}
        </p>
      )}
    </main>
  );
}

const textarea: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  fontSize: 15,
  lineHeight: 1.4,
  borderRadius: 8,
  border: `1px solid ${colors.border}`,
  background: "transparent",
  color: colors.text,
  resize: "vertical",
  fontFamily: "inherit",
};
