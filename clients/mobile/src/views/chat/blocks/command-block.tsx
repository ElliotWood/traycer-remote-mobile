/**
 * `command` block (Sprint 2). stdout/stderr are never persisted (the host
 * comment: "the load-bearing signal" is command+cwd+exitCode+status) — the
 * body just re-shows the command, there is nothing else to lazy-fetch.
 */
import type { ReactElement } from "react";
import type { CommandBlock as CommandBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { colors } from "../../ui";
import { CollapsibleCard } from "../collapsible-card";
import { StatusBadge } from "../status-badge";

export function CommandBlock({
  block,
}: {
  readonly block: CommandBlockType;
}): ReactElement {
  const header = (
    <>
      <span
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          fontSize: 12,
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        $ {block.command}
      </span>
      {block.exitCode !== null && block.exitCode !== 0 && (
        <span style={{ color: colors.danger, fontSize: 11 }}>exit {block.exitCode}</span>
      )}
      <StatusBadge status={block.status} />
    </>
  );

  return (
    <CollapsibleCard header={header}>
      <pre
        style={{
          margin: 0,
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          fontSize: 12,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {block.command}
      </pre>
      {block.cwd !== null && (
        <p style={{ color: colors.muted, fontSize: 12, margin: "6px 0 0" }}>cwd: {block.cwd}</p>
      )}
    </CollapsibleCard>
  );
}
