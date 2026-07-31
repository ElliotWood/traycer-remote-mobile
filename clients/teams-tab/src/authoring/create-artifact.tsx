/**
 * Create an artifact in the open epic.
 *
 * THE ONLY AUTHORING SURFACE WITH NO HOST QUESTION. Its request is
 * `{ epicId, parentId, artifactType, title }` — nothing machine-specific, so
 * it neither stamps a durable host nor needs a filesystem path. That is why
 * it is built and the other two are not; see `./authoring-scope`.
 *
 * The kind is CHOSEN, not defaulted. `LatestEpicArtifactKindSchema` has four
 * members and they behave differently downstream — a ticket carries a
 * lifecycle status, a spec does not. Silently defaulting to "spec" would make
 * every artifact created here the one kind that tracks nothing.
 */
import { useState, type ReactElement } from "react";
import {
  Button,
  Caption1,
  Dropdown,
  Field,
  Input,
  Option,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { ArtifactKind } from "@traycer-clients/shared/epic/epic-doc-artifacts";

const KINDS: readonly { readonly kind: ArtifactKind; readonly label: string }[] =
  [
    { kind: "ticket", label: "Ticket — tracked work with a status" },
    { kind: "spec", label: "Spec — durable context and decisions" },
    { kind: "story", label: "Story — a user-facing journey" },
    { kind: "review", label: "Review — structured critique" },
  ];

const useStyles = makeStyles({
  form: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    maxWidth: "48ch",
  },
  actions: { display: "flex", gap: tokens.spacingHorizontalS },
  failed: { color: tokens.colorPaletteDarkOrangeForeground1 },
});

export type CreatePhase =
  | { readonly kind: "idle" }
  | { readonly kind: "submitting" }
  /** UNCONFIRMED, not "failed" — the request may have landed. */
  | { readonly kind: "unconfirmed"; readonly reason: string };

export interface CreateArtifactProps {
  readonly phase: CreatePhase;
  readonly onCreate: (input: {
    readonly title: string;
    readonly artifactType: ArtifactKind;
  }) => void;
}

export function CreateArtifact({
  phase,
  onCreate,
}: CreateArtifactProps): ReactElement {
  const styles = useStyles();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ArtifactKind>("ticket");
  const busy = phase.kind === "submitting";

  return (
    <div className={styles.form}>
      <Field label="Title" hint="What this artifact is about.">
        <Input
          value={title}
          disabled={busy}
          onChange={(_, data) => {
            setTitle(data.value);
          }}
        />
      </Field>

      <Field label="Kind">
        <Dropdown
          disabled={busy}
          value={KINDS.find((k) => k.kind === kind)?.label ?? ""}
          selectedOptions={[kind]}
          onOptionSelect={(_, data) => {
            const next = KINDS.find((k) => k.kind === data.optionValue);
            if (next !== undefined) setKind(next.kind);
          }}
        >
          {KINDS.map((k) => (
            <Option key={k.kind} value={k.kind} text={k.label}>
              {k.label}
            </Option>
          ))}
        </Dropdown>
      </Field>

      <div className={styles.actions}>
        <Button
          appearance="primary"
          // A title is REQUIRED, unlike the reject reason: an artifact with no
          // title is a row that reads as "Untitled" forever, and the person
          // best placed to name it is the one creating it.
          disabled={busy || title.trim().length === 0}
          onClick={() => {
            onCreate({ title: title.trim(), artifactType: kind });
          }}
        >
          {busy ? "Creating…" : "Create"}
        </Button>
      </div>

      {phase.kind === "unconfirmed" ? (
        <Caption1 className={styles.failed} role="alert">
          Couldn’t confirm this was created. It may have gone through — check
          the artifacts list before creating it again. ({phase.reason})
        </Caption1>
      ) : null}
    </div>
  );
}
