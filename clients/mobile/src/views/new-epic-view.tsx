/**
 * Start a new epic from the Fleet — the entry point the phone was missing
 * ("no button to create new epics on the first page").
 *
 * Deliberately the same shape as `AuthorView` (instruction textarea + one
 * primary action + inline error), because it is the same act one level up: the
 * epic is created with its first agent folded in, so there is exactly one thing
 * to type. Built on the design-token primitives so it reads as the same app as
 * the Fleet it launches from, rather than `author-view.tsx`'s older `ui.ts`
 * styling.
 *
 * The copy states plainly that the agent runs without a repo — this creates a
 * FOLDERLESS epic (see `use-create-epic.ts` for why that is the honest option
 * from a device with no view of the host's filesystem), and the user should not
 * have to discover that by watching an agent fail to find their code.
 */
import type { CSSProperties, ReactElement } from "react";
import type { MobileHostClient } from "@/host/host-client-context";
import { useStreamConnectionOrNull } from "@/host/stream-connection-context";
import {
  hostIdOrRefuse,
  MISSING_HOST_ID_ERROR,
  useCreateEpic,
} from "@/host/use-create-epic";
import { NEW_EPIC_DRAFT_KEY, useDraft } from "@/router/drafts";
import { Button, SectionHeading, radius, screen, theme, type } from "./design-tokens";

interface NewEpicViewProps {
  readonly client: MobileHostClient;
  /** Called with the minted epicId + derived title once the host accepts the create. */
  readonly onCreated: (epicId: string, epicTitle: string) => void;
  readonly onCancel: () => void;
}

export function NewEpicView({
  client,
  onCreated,
  onCancel,
}: NewEpicViewProps): ReactElement {
  // Draft-backed, not `useState("")`: backing out of this form unmounts it, and
  // a paragraph of typed intent must not be the price of a stray back gesture.
  // Cleared only once the host accepts the create — see `drafts.ts` for why the
  // rule is "preserve" and not "confirm before discarding".
  const instruction = useDraft(NEW_EPIC_DRAFT_KEY);
  const streamConnection = useStreamConnectionOrNull();
  const { phase, error, submit } = useCreateEpic({
    client,
    streamConnection,
    onCreated: (epicId, epicTitle) => {
      instruction.clear();
      onCreated(epicId, epicTitle);
    },
  });

  const submitting = phase === "submitting";
  const canSubmit = instruction.value.trim().length > 0 && !submitting;

  // Refused up front, not on submit: without the host's real id anything created
  // here would be permanently unreachable (see `hostIdOrRefuse`), so don't invite
  // the user to type a paragraph first. `useCreateEpic` refuses independently —
  // this is the explanation, not the enforcement.
  if (hostIdOrRefuse() === null) {
    return (
      <main style={screen}>
        <SectionHeading>New epic</SectionHeading>
        <p role="alert" style={{ ...type.body, color: theme.danger, margin: "8px 0 16px" }}>
          {MISSING_HOST_ID_ERROR}
        </p>
        <Button variant="secondary" onClick={onCancel}>
          Back
        </Button>
      </main>
    );
  }

  return (
    <main style={screen}>
      <header style={{ marginBottom: 12 }}>
        <SectionHeading>New epic</SectionHeading>
        <p style={{ ...type.bodySm, color: theme.mutedText, margin: "4px 0 0" }}>
          Describe the work. Traycer starts an epic with a first agent on it. The
          agent runs without a repo attached — attach folders from the desktop app
          when it needs your code.
        </p>
      </header>

      <textarea
        value={instruction.value}
        disabled={submitting}
        placeholder="e.g. Plan how we'd migrate the billing service off Stripe"
        aria-label="What should this epic do?"
        rows={6}
        style={textarea}
        onChange={(e) => instruction.set(e.target.value)}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <Button variant="primary" disabled={!canSubmit} onClick={() => submit(instruction.value)}>
          {submitting ? "Creating…" : "Create epic"}
        </Button>
        <Button variant="ghost" disabled={submitting} onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {error !== null && (
        <p role="alert" style={{ ...type.bodySm, color: theme.danger, margin: "12px 0 0" }}>
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
  borderRadius: radius.row,
  border: `1px solid ${theme.border}`,
  background: "transparent",
  color: theme.text,
  resize: "vertical",
  fontFamily: "inherit",
};
