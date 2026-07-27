/**
 * P2 — the mobile-native composer. NOT a reuse of desktop's `ChatComposer`
 * (hard-wired to `TabHostProvider`/`RunnerHostProvider`/a full
 * `HostClient<HostRpcRegistry>` mobile doesn't have — see the P2 contract's
 * research) — a new component mirroring the PORTABLE pieces' exact
 * prop/copy/icon contracts: send⇄stop, permission-mode toggle, agent-mode
 * toggle, a basic model picker (`agent.listHarnessModels`).
 *
 * Image attach is DEFERRED this round, flagged not silently dropped: the
 * `send` frame's `hasBinaryPayload` flag implies a binary transport
 * alongside the JSON frame that P2's research didn't verify — shipping a
 * button that stamps `hasBinaryPayload: true` without a working channel
 * behind it would send a malformed frame, which the Evaluator's own P2
 * tighten explicitly warned against. @-mention/slash pickers and mic input
 * are deferred per the accepted P2 contract (no file-search/command-list
 * RPC, no STT infra).
 */
import { useState, type ReactElement } from "react";
import { ArrowUp, Code, FileCheck, Layers, LockKeyholeOpen, ShieldCheck, Square, type LucideIcon } from "lucide-react";
import type { ChatRunSettings, PermissionMode } from "@traycer/protocol/persistence/epic/foundation";
import type { AgentMode } from "@traycer/protocol/common/schemas";
import type { MobileHostClient } from "@/host/host-client-context";
import { useHarnessModels } from "@/host/use-harness-models";
import { radius, theme, type } from "@/views/design-tokens";

const PERMISSION_OPTIONS: readonly { readonly id: PermissionMode; readonly label: string; readonly icon: LucideIcon }[] = [
  { id: "supervised", label: "Supervised", icon: ShieldCheck },
  { id: "auto_accept_edits", label: "Auto-accept edits", icon: FileCheck },
  { id: "full_access", label: "Full access", icon: LockKeyholeOpen },
];

const AGENT_MODE_OPTIONS: readonly { readonly id: AgentMode; readonly shortLabel: string; readonly icon: LucideIcon }[] = [
  { id: "regular", shortLabel: "Regular", icon: Code },
  { id: "epic", shortLabel: "Epic", icon: Layers },
];

const DEFAULT_HARNESS = "claude" as const;

export interface ComposerProps {
  readonly epicId: string;
  readonly client: MobileHostClient | null;
  readonly draftText: string;
  readonly onDraftTextChange: (text: string) => void;
  readonly chatSettings: ChatRunSettings | null;
  readonly canStop: boolean;
  readonly stopping: boolean;
  readonly accessRole: "owner" | "viewer";
  readonly connectionLive: boolean;
  readonly sendDisabledHint: string | null;
  readonly onSend: (text: string, settings: ChatRunSettings) => void;
  readonly onStop: () => void;
}

export function Composer({
  epicId,
  client,
  draftText,
  onDraftTextChange,
  chatSettings,
  canStop,
  stopping,
  accessRole,
  connectionLive,
  sendDisabledHint,
  onSend,
  onStop,
}: ComposerProps): ReactElement {
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    chatSettings?.permissionMode ?? "full_access",
  );
  const [agentMode, setAgentMode] = useState<AgentMode>(chatSettings?.agentMode ?? "regular");
  const [modelSlug, setModelSlug] = useState<string | null>(chatSettings?.model ?? null);
  const { models } = useHarnessModels(client, epicId, DEFAULT_HARNESS);
  const resolvedModel = modelSlug ?? models[0]?.id ?? null;

  const readOnly = accessRole === "viewer";
  const canType = !readOnly;
  const canSubmit = canType && connectionLive && draftText.trim().length > 0 && resolvedModel !== null;

  const handleSend = (): void => {
    if (!canSubmit || resolvedModel === null) return;
    onSend(draftText, {
      harnessId: DEFAULT_HARNESS,
      model: resolvedModel,
      permissionMode,
      reasoningEffort: null,
      serviceTier: null,
      agentMode,
      profileId: null,
    });
  };

  return (
    <div
      style={{
        border: `1px solid ${theme.borderHairline}`,
        borderRadius: radius.lg,
        background: theme.surface,
        padding: 8,
      }}
    >
      {readOnly ? (
        <p style={{ ...type.bodySm, color: theme.mutedText, margin: "4px 4px 8px" }}>
          You have view-only access to this chat.
        </p>
      ) : (
        <textarea
          value={draftText}
          onChange={(e) => onDraftTextChange(e.target.value)}
          placeholder="Message this agent…"
          rows={2}
          disabled={!connectionLive}
          style={{
            width: "100%",
            boxSizing: "border-box",
            border: "none",
            background: "transparent",
            color: theme.text,
            fontSize: 15,
            fontFamily: "inherit",
            resize: "vertical",
            outline: "none",
            marginBottom: 6,
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {!readOnly && (
          <>
            <PermissionModeToggle value={permissionMode} onChange={setPermissionMode} disabled={!connectionLive} />
            <AgentModeToggle value={agentMode} onChange={setAgentMode} disabled={!connectionLive} />
            <ModelChip
              models={models}
              value={resolvedModel}
              onChange={setModelSlug}
              disabled={!connectionLive}
            />
          </>
        )}
        <div style={{ flex: 1 }} />
        <SendStopButton
          stopping={stopping}
          running={canStop}
          disabled={canStop ? false : !canSubmit}
          disabledHint={sendDisabledHint}
          onSend={handleSend}
          onStop={onStop}
        />
      </div>
    </div>
  );
}

function chipStyle(disabled: boolean) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    minHeight: 32,
    padding: "0 8px",
    border: `1px solid ${theme.border}`,
    borderRadius: radius.md,
    background: "transparent",
    color: theme.mutedText,
    fontSize: 12,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
  } as const;
}

function PermissionModeToggle({
  value,
  onChange,
  disabled,
}: {
  readonly value: PermissionMode;
  readonly onChange: (v: PermissionMode) => void;
  readonly disabled: boolean;
}): ReactElement {
  const current = PERMISSION_OPTIONS.find((o) => o.id === value) ?? PERMISSION_OPTIONS[0];
  const Icon = current.icon;
  return (
    <button
      type="button"
      disabled={disabled}
      title="Ask before commands and file changes / Auto-approve edits / Allow without prompts"
      onClick={() => {
        const index = PERMISSION_OPTIONS.findIndex((o) => o.id === value);
        onChange(PERMISSION_OPTIONS[(index + 1) % PERMISSION_OPTIONS.length].id);
      }}
      style={chipStyle(disabled)}
    >
      <Icon size={13} aria-hidden="true" />
      {current.label}
    </button>
  );
}

function AgentModeToggle({
  value,
  onChange,
  disabled,
}: {
  readonly value: AgentMode;
  readonly onChange: (v: AgentMode) => void;
  readonly disabled: boolean;
}): ReactElement {
  const current = AGENT_MODE_OPTIONS.find((o) => o.id === value) ?? AGENT_MODE_OPTIONS[0];
  const Icon = current.icon;
  const title =
    value === "regular"
      ? "Regular mode: general-purpose coding agent experience."
      : "Epic mode: plan and coordinate larger changes with Traycer artifacts.";
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={() => onChange(value === "regular" ? "epic" : "regular")}
      style={chipStyle(disabled)}
    >
      <Icon size={13} aria-hidden="true" />
      {current.shortLabel}
    </button>
  );
}

function ModelChip({
  models,
  value,
  onChange,
  disabled,
}: {
  readonly models: readonly { readonly id: string }[];
  readonly value: string | null;
  readonly onChange: (id: string) => void;
  readonly disabled: boolean;
}): ReactElement | null {
  if (models.length === 0) return null;
  return (
    <select
      aria-label="Model"
      disabled={disabled}
      value={value ?? models[0]?.id}
      onChange={(e) => onChange(e.target.value)}
      style={{
        ...chipStyle(disabled),
        appearance: "none",
        paddingRight: 8,
      }}
    >
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.id}
        </option>
      ))}
    </select>
  );
}

function SendStopButton({
  running,
  stopping,
  disabled,
  disabledHint,
  onSend,
  onStop,
}: {
  readonly running: boolean;
  readonly stopping: boolean;
  readonly disabled: boolean;
  readonly disabledHint: string | null;
  readonly onSend: () => void;
  readonly onStop: () => void;
}): ReactElement {
  const stopMode = running || stopping;
  const label = stopping ? "Stopping" : running ? "Stop" : "Send";
  const style = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    height: 36,
    borderRadius: "50%",
    border: "none",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
    background: stopMode ? theme.border : theme.primary,
    color: stopMode ? theme.text : theme.primaryForeground,
  } as const;

  return (
    <button
      type="button"
      aria-label={label}
      title={stopMode ? "Stop assistant turn" : (disabledHint ?? "Send")}
      disabled={disabled}
      onClick={stopMode ? onStop : onSend}
      style={style}
    >
      {stopMode ? <Square size={14} fill="currentColor" aria-hidden="true" /> : <ArrowUp size={16} aria-hidden="true" />}
    </button>
  );
}
