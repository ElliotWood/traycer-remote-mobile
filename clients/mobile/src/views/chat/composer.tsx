/**
 * P2 — the mobile-native composer. NOT a reuse of desktop's `ChatComposer`
 * (hard-wired to `TabHostProvider`/`RunnerHostProvider`/a full
 * `HostClient<HostRpcRegistry>` mobile doesn't have — see the P2 contract's
 * research) — a new component mirroring the PORTABLE pieces' exact
 * prop/copy/icon contracts: send⇄stop, permission-mode toggle, agent-mode
 * toggle, a basic model picker (`agent.listHarnessModels`).
 *
 * Image attachments: the wire contract is confirmed (see
 * `image-attachment.ts`'s docblock) — an `imageAttachment` node inlined
 * into the SAME `send` frame every message already uses, no new transport.
 * Two attach affordances (camera-capture input + library-picker input) — a
 * real mobile win over desktop's single "attach" button. No model-support
 * gate: desktop's own gate reads a `ModelOption.metadata` field that's
 * entirely client-local and, per a dedicated research pass, never actually
 * populated on any real model today — porting it would be faking a check
 * off data neither client has (flagged + approved, not silently skipped).
 * @-mention/slash pickers and mic input stay deferred per the accepted P2
 * contract (no file-search/command-list RPC, no STT infra).
 */
import { useRef, useState, type ChangeEvent, type ReactElement } from "react";
import {
  ArrowUp,
  Camera,
  Code,
  FileCheck,
  Image as ImageIcon,
  Layers,
  LoaderCircle,
  LockKeyholeOpen,
  ShieldCheck,
  Square,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ChatRunSettings, PermissionMode } from "@traycer/protocol/persistence/epic/foundation";
import type { AgentMode } from "@traycer/protocol/common/schemas";
import type { MobileHostClient } from "@/host/host-client-context";
import { useHarnessModels } from "@/host/use-harness-models";
import {
  AttachmentTooLargeError,
  MAX_ATTACHMENTS_PER_MESSAGE,
  prepareImageAttachment,
  type PreparedAttachment,
} from "@/host/image-attachment";
import { radius, theme, type } from "@/views/design-tokens";

interface AttachmentDraft {
  readonly localId: string;
  readonly fileName: string;
  readonly status: "ingesting" | "ready" | "error";
  readonly prepared: PreparedAttachment | null;
  readonly errorMessage: string | null;
}

let localAttachmentCounter = 0;
function nextLocalAttachmentId(): string {
  localAttachmentCounter += 1;
  return `pending-${localAttachmentCounter}`;
}

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
  /**
   * Perf fix: the composer owns its OWN draft text internally now (below) —
   * every keystroke used to live in `ChatView`'s state, re-rendering the
   * whole chat screen (transcript included) on every character. These two
   * props are the ONLY way a parent can still push text in from outside
   * (the "edit a queued item" flow): bump `prefillNonce` alongside a new
   * `prefillText` and it's adopted during render (not an effect — see the
   * comment at the adjustment site). A stable `prefillNonce` across renders
   * means "nothing to adopt" — typing never touches these.
   */
  readonly prefillText: string | null;
  readonly prefillNonce: number;
  readonly chatSettings: ChatRunSettings | null;
  readonly canStop: boolean;
  readonly stopping: boolean;
  readonly accessRole: "owner" | "viewer";
  readonly connectionLive: boolean;
  readonly sendDisabledHint: string | null;
  readonly onSend: (text: string, settings: ChatRunSettings, attachments: readonly PreparedAttachment[]) => void;
  readonly onStop: () => void;
}

export function Composer({
  epicId,
  client,
  prefillText,
  prefillNonce,
  chatSettings,
  canStop,
  stopping,
  accessRole,
  connectionLive,
  sendDisabledHint,
  onSend,
  onStop,
}: ComposerProps): ReactElement {
  const [draftText, setDraftText] = useState("");
  const [attachments, setAttachments] = useState<readonly AttachmentDraft[]>([]);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    chatSettings?.permissionMode ?? "full_access",
  );
  const [agentMode, setAgentMode] = useState<AgentMode>(chatSettings?.agentMode ?? "regular");
  const [modelSlug, setModelSlug] = useState<string | null>(chatSettings?.model ?? null);
  const { models, phase: modelsPhase } = useHarnessModels(client, epicId, DEFAULT_HARNESS);
  const resolvedModel = modelSlug ?? models[0]?.id ?? null;
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);

  // Adjusted DURING render, not in an effect that fires after commit — an
  // effect here means the render that bumps `prefillNonce` still paints the
  // OLD `draftText` for one frame before the correction lands (mild version
  // of the same class of mistake that crashed the interview form on this
  // sprint: reconciling a prop-driven value post-commit instead of before
  // paint). Comparing against `lastPrefillNonce` (React's documented
  // "adjust state when a prop changes" pattern) lets this fire exactly once
  // per bump, still cannot fight the user's own typing (a stable nonce
  // across renders never re-triggers it), with no intermediate frame.
  // `null` (never a real nonce value) so the FIRST render always counts as
  // "changed" — matching the effect this replaced, which always ran once on
  // mount too. Seeding from `prefillNonce` itself would silently skip
  // adoption on a mount that starts with an already-bumped nonce.
  const [lastPrefillNonce, setLastPrefillNonce] = useState<number | null>(null);
  if (prefillNonce !== lastPrefillNonce) {
    setLastPrefillNonce(prefillNonce);
    if (prefillNonce > 0 && prefillText !== null) setDraftText(prefillText);
  }

  const handleFilesPicked = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ""; // allow re-picking the same file later
    const room = MAX_ATTACHMENTS_PER_MESSAGE - attachments.length;
    const accepted = files.slice(0, Math.max(0, room));
    if (accepted.length === 0) return;

    const drafts: AttachmentDraft[] = accepted.map((file) => ({
      localId: nextLocalAttachmentId(),
      fileName: file.name,
      status: "ingesting",
      prepared: null,
      errorMessage: null,
    }));
    setAttachments((prev) => [...prev, ...drafts]);

    accepted.forEach((file, index) => {
      const localId = drafts[index].localId;
      prepareImageAttachment(file)
        .then((prepared) => {
          setAttachments((prev) =>
            prev.map((a) => (a.localId === localId ? { ...a, status: "ready", prepared } : a)),
          );
        })
        .catch((err: unknown) => {
          const message = err instanceof AttachmentTooLargeError ? err.message : "Couldn't attach this image.";
          setAttachments((prev) =>
            prev.map((a) => (a.localId === localId ? { ...a, status: "error", errorMessage: message } : a)),
          );
        });
    });
  };

  const removeAttachment = (localId: string): void => {
    setAttachments((prev) => prev.filter((a) => a.localId !== localId));
  };

  const readOnly = accessRole === "viewer";
  const canType = !readOnly;
  const readyAttachments = attachments.filter((a): a is AttachmentDraft & { prepared: PreparedAttachment } => a.status === "ready" && a.prepared !== null);
  const isIngestingAttachments = attachments.some((a) => a.status === "ingesting");
  const hasContent = draftText.trim().length > 0 || readyAttachments.length > 0;
  const canSubmit =
    canType && connectionLive && hasContent && !isIngestingAttachments && resolvedModel !== null;
  // `canSubmit` above already requires a resolved model, but `sendDisabledHint`
  // (the parent's reason: foreign host / offline / view-only) knows nothing
  // about the model fetch — when it's null and the ONLY thing blocking Send is
  // `agent.listHarnessModels` having failed, the button was disabled with a
  // tooltip that just said "Send", no cue why tapping did nothing. `"loading"`
  // is excluded on purpose: that's the ordinary first render, not a failure.
  const modelsUnavailableHint =
    modelsPhase === "error" && resolvedModel === null
      ? "Couldn't load available models — check your connection and try again."
      : null;
  const effectiveSendHint = sendDisabledHint ?? modelsUnavailableHint;

  const handleSend = (): void => {
    if (!canSubmit || resolvedModel === null) return;
    onSend(
      draftText,
      {
        harnessId: DEFAULT_HARNESS,
        model: resolvedModel,
        permissionMode,
        reasoningEffort: null,
        serviceTier: null,
        agentMode,
        profileId: null,
      },
      readyAttachments.map((a) => a.prepared),
    );
    setDraftText("");
    setAttachments([]);
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
        <>
          {attachments.length > 0 && (
            <AttachmentStrip attachments={attachments} onRemove={removeAttachment} />
          )}
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="Message this agent…"
            rows={2}
            // Gated on ACCESS, not on connection. Disabling a focused
            // textarea mid-typing is what the user experienced as the input
            // "locking up": a host/client hiccup flips `connectionLive`
            // false (after `use-settled-connection-state`'s 1500ms delay),
            // the browser drops focus, the on-screen keyboard dismisses, and
            // any in-progress IME composition is discarded. Losing what
            // you're typing because the socket blinked is never the right
            // trade — the transport recovers on its own in a second or two.
            // Sending is still correctly gated: `canSubmit` requires
            // `connectionLive`, and `sendDisabledHint` explains why.
            disabled={!canType}
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
        </>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {!readOnly && (
          <>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              style={{ display: "none" }}
              onChange={handleFilesPicked}
            />
            <input
              ref={libraryInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={handleFilesPicked}
            />
            <AttachButton
              icon={Camera}
              label="Take photo"
              disabled={!connectionLive || attachments.length >= MAX_ATTACHMENTS_PER_MESSAGE}
              onClick={() => cameraInputRef.current?.click()}
            />
            <AttachButton
              icon={ImageIcon}
              label="Add photo"
              disabled={!connectionLive || attachments.length >= MAX_ATTACHMENTS_PER_MESSAGE}
              onClick={() => libraryInputRef.current?.click()}
            />
            {/* Pure local draft state, applied only when the message is
                actually sent — there is nothing for a live connection to
                gate here, and greying them out during a blip just makes the
                composer feel broken alongside the textarea. */}
            <PermissionModeToggle value={permissionMode} onChange={setPermissionMode} disabled={!canType} />
            <AgentModeToggle value={agentMode} onChange={setAgentMode} disabled={!canType} />
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
          ingesting={!canStop && isIngestingAttachments}
          disabled={canStop ? false : !canSubmit}
          disabledHint={effectiveSendHint}
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

function AttachButton({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        border: `1px solid ${theme.border}`,
        borderRadius: radius.md,
        background: "transparent",
        color: theme.mutedText,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
      }}
    >
      <Icon size={14} aria-hidden="true" />
    </button>
  );
}

/** Horizontally scrollable so a full set of attachments never pushes the textarea/toolbar off-screen — capped height, no wrap. */
function AttachmentStrip({
  attachments,
  onRemove,
}: {
  readonly attachments: readonly AttachmentDraft[];
  readonly onRemove: (localId: string) => void;
}): ReactElement {
  return (
    <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6 }}>
      {attachments.map((attachment) => (
        <AttachmentChip key={attachment.localId} attachment={attachment} onRemove={() => onRemove(attachment.localId)} />
      ))}
    </div>
  );
}

const CHIP_SIZE = 56;

function AttachmentChip({
  attachment,
  onRemove,
}: {
  readonly attachment: AttachmentDraft;
  readonly onRemove: () => void;
}): ReactElement {
  return (
    <div
      style={{
        position: "relative",
        flexShrink: 0,
        width: CHIP_SIZE,
        height: CHIP_SIZE,
        borderRadius: radius.md,
        border: `1px solid ${attachment.status === "error" ? theme.danger : theme.border}`,
        overflow: "hidden",
        background: theme.background,
      }}
      title={attachment.errorMessage ?? attachment.fileName}
    >
      {attachment.prepared !== null ? (
        <img
          src={attachment.prepared.dataUrl}
          alt={attachment.fileName}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: attachment.status === "error" ? theme.danger : theme.mutedText,
            fontSize: 10,
            textAlign: "center",
            padding: 4,
          }}
        >
          {attachment.status === "ingesting" ? "…" : "!"}
        </div>
      )}
      <button
        type="button"
        aria-label={`Remove ${attachment.fileName}`}
        onClick={onRemove}
        style={{
          position: "absolute",
          top: 2,
          right: 2,
          width: 18,
          height: 18,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
          border: "none",
          background: "rgba(0, 0, 0, 0.6)",
          color: "#fff",
          cursor: "pointer",
          padding: 0,
        }}
      >
        <X size={11} aria-hidden="true" />
      </button>
    </div>
  );
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
  ingesting,
  disabled,
  disabledHint,
  onSend,
  onStop,
}: {
  readonly running: boolean;
  readonly stopping: boolean;
  /** An attachment is still downscaling/encoding — desktop's own "pending-ingest" convention: a spinner replaces the send arrow rather than just disabling it. */
  readonly ingesting: boolean;
  readonly disabled: boolean;
  readonly disabledHint: string | null;
  readonly onSend: () => void;
  readonly onStop: () => void;
}): ReactElement {
  const stopMode = running || stopping;
  const label = stopping ? "Stopping" : running ? "Stop" : ingesting ? "Preparing attachment…" : "Send";
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
      title={stopMode ? "Stop assistant turn" : ingesting ? label : (disabledHint ?? "Send")}
      disabled={disabled}
      onClick={stopMode ? onStop : onSend}
      style={style}
    >
      {stopMode ? (
        <Square size={14} fill="currentColor" aria-hidden="true" />
      ) : ingesting ? (
        <LoaderCircle className="traycer-spinner" size={16} aria-hidden="true" />
      ) : (
        <ArrowUp size={16} aria-hidden="true" />
      )}
    </button>
  );
}
