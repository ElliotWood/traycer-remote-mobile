/**
 * Start a new epic from the Epics tab — the tab's counterpart of desktop's
 * landing composer and the phone's "New epic".
 *
 * WHAT IS DISCLOSED BEFORE THE BUTTON, and why it is two things rather than
 * one: the host binding is permanent, and the epic is FOLDERLESS. The second
 * is the one a user cannot discover by looking — a folderless epic renders in
 * the fleet exactly like a repo-bound one, and its agents simply cannot read
 * any code. Saying so afterwards would be a confession; saying so here is a
 * choice they get to make. See `./authoring-scope`.
 */
import { useState, type ReactElement } from "react";
import {
  Button,
  Caption1,
  Field,
  MessageBar,
  MessageBarBody,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { epicCreateDisclosure } from "./authoring-scope";
import { retryAdvice, type CreatePhase } from "./create-phase";

const useStyles = makeStyles({
  form: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    maxWidth: "56ch",
  },
  notice: { color: tokens.colorNeutralForeground3 },
  failed: { color: tokens.colorPaletteDarkOrangeForeground1 },
});

export interface CreateEpicFormProps {
  readonly configuredHostId: string;
  readonly userId: string;
  readonly phase: CreatePhase;
  readonly onCreate: (instruction: string) => void;
}

export function CreateEpicForm({
  configuredHostId,
  userId,
  phase,
  onCreate,
}: CreateEpicFormProps): ReactElement {
  const styles = useStyles();
  const [instruction, setInstruction] = useState("");
  const disclosure = epicCreateDisclosure(configuredHostId, userId);
  const busy = phase.kind === "submitting";

  if (!disclosure.canCreate) {
    // No form at all — not a disabled one. A disabled field still says "this
    // is the thing you would do here", and the honest message is that this
    // build cannot do it safely.
    return (
      <MessageBar intent="warning">
        <MessageBarBody>{disclosure.notice}</MessageBarBody>
      </MessageBar>
    );
  }

  return (
    <div className={styles.form}>
      <Field
        label="What’s the work?"
        hint="The epic and its first agent are both named from the first line."
      >
        <Textarea
          value={instruction}
          disabled={busy}
          resize="vertical"
          onChange={(_, data) => {
            setInstruction(data.value);
          }}
        />
      </Field>

      {/* Stated BEFORE the button: one part is permanent, one is invisible. */}
      <Caption1 className={styles.notice}>{disclosure.notice}</Caption1>

      <div>
        <Button
          appearance="primary"
          disabled={busy || instruction.trim().length === 0}
          onClick={() => {
            onCreate(instruction.trim());
          }}
        >
          {busy ? "Creating…" : "Create epic"}
        </Button>
      </div>

      {/*
        The advice comes from the PHASE. This surface's is "go and look", which
        is the OPPOSITE of the neighbouring agent form's — `epic.create`
        documents no dedupe on the epic id while `epic.createChat` documents
        one on the chat id. See `./create-phase` and `use-create-epic`.
      */}
      {phase.kind === "unconfirmed" ? (
        <Caption1 className={styles.failed} role="alert">
          Couldn’t confirm this epic was created. {retryAdvice(phase.retry, "epic")}{" "}
          ({phase.reason})
        </Caption1>
      ) : null}
    </div>
  );
}
