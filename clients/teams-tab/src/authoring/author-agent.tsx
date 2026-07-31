/**
 * Author a new agent in the open epic.
 *
 * THE HOST IS NAMED BEFORE THE BUTTON, not discovered afterwards. `hostId` is
 * stamped on the chat FOR LIFE, so this is the one moment the user can act on
 * it — see `./authoring-scope`.
 *
 * And when no host id is configured this REFUSES rather than degrading. Every
 * other gate in this client prevents a false statement, which a client fix
 * repairs. This one prevents a durable wrong fact in the user's data: a chat
 * stamped with a UI label instead of a real host id renders as an unreachable
 * host on desktop, permanently. Different severity, different answer.
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
import { hostDisclosure } from "./authoring-scope";
import type { CreatePhase } from "./create-artifact";

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

export interface AuthorAgentProps {
  readonly configuredHostId: string;
  readonly phase: CreatePhase;
  readonly onCreate: (instruction: string) => void;
}

export function AuthorAgent({
  configuredHostId,
  phase,
  onCreate,
}: AuthorAgentProps): ReactElement {
  const styles = useStyles();
  const [instruction, setInstruction] = useState("");
  const disclosure = hostDisclosure(configuredHostId);
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
        label="What should it do?"
        hint="The first message the agent receives. Its title comes from the first line."
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

      {/* Stated BEFORE the button, because the choice is permanent. */}
      <Caption1 className={styles.notice}>{disclosure.notice}</Caption1>

      <div>
        <Button
          appearance="primary"
          disabled={busy || instruction.trim().length === 0}
          onClick={() => {
            onCreate(instruction.trim());
          }}
        >
          {busy ? "Creating…" : "Create agent"}
        </Button>
      </div>

      {/*
        WORDING CHANGED once `epic.createChat` was actually wired. This used to
        say "check the agents list before creating it again" — the correct
        advice for an unconfirmed APPROVAL, and the wrong advice here.

        The chat id is minted before the first attempt and reused, and the host
        resolver is idempotent on it, so pressing the button again cannot
        produce a second agent. Sending someone off to verify by hand would be
        asking them to do work the protocol already guarantees. Same
        "unconfirmed", opposite instruction — which is why the reason is stated
        rather than just the reassurance.
      */}
      {phase.kind === "unconfirmed" ? (
        <Caption1 className={styles.failed} role="alert">
          Couldn’t confirm this agent was created. Press Create agent again —
          it’s the same request, so it can’t make a second agent. ({phase.reason})
        </Caption1>
      ) : null}
    </div>
  );
}
