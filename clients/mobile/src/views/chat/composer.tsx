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
 *
 * M1: the model / harness / reasoning-effort / speed-tier controls now come
 * from `agent.gui.listModels` + `agent.gui.listHarnesses` and live in
 * `run-settings-controls.tsx`. `reasoningEffort`, `serviceTier` and the
 * harness are no longer hard-coded — see `handleSend`.
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
import type { GuiHarnessId } from "@traycer/protocol/host/agent/shared";
import {
  normalizeReasoningForModel,
  normalizeServiceTierForModel,
} from "@traycer-clients/shared/agent-models/model-selection";
import type { MobileHostClient } from "@/host/host-client-context";
import { useGuiModels } from "@/host/use-gui-models";
import { selectableHarnesses, useGuiHarnesses } from "@/host/use-gui-harnesses";
import {
  HarnessChip,
  ModelChip,
  ReasoningChip,
  ServiceTierChip,
} from "@/views/chat/run-settings-controls";
import { ProfileChip } from "@/views/chat/profile-chip";
import { RateLimitBanner } from "@/views/chat/rate-limit-banner";
import { useProviders } from "@/host/use-provider-usage";
import { guiHarnessIdToProviderId } from "@traycer-clients/shared/providers/provider-ordering";
import { chatDraftKey, useDraft } from "@/router/drafts";
import {
  AttachmentTooLargeError,
  MAX_ATTACHMENTS_PER_MESSAGE,
  prepareImageAttachment,
  type PreparedAttachment,
} from "@/host/image-attachment";
import { chipStyle } from "@/views/chat/run-settings-controls";
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
  /**
   * No `epicId`: it existed only to satisfy `agent.listHarnessModels`, whose
   * request took one. `agent.gui.listModels` is scoped by harness and takes a
   * nullable `workingDirectory` instead, so the composer no longer needs to
   * know which epic it is in. M3 may reintroduce it for `epic.mention*`.
   */
  /** Scopes the preserved draft, so backing out of two chats keeps two separate unsent messages. */
  readonly chatId: string;
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
  chatId,
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
  // Draft-backed rather than `useState("")`: popping the chat route unmounts
  // this component, and a half-typed message must survive that round trip. The
  // store is keyed per chat and cleared on a successful send — see `drafts.ts`.
  const draft = useDraft(chatDraftKey(chatId));
  const draftText = draft.value;
  const setDraftText = draft.set;
  const [attachments, setAttachments] = useState<readonly AttachmentDraft[]>([]);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    chatSettings?.permissionMode ?? "full_access",
  );
  const [agentMode, setAgentMode] = useState<AgentMode>(chatSettings?.agentMode ?? "regular");
  const [modelSlug, setModelSlug] = useState<string | null>(chatSettings?.model ?? null);
  const [harnessId, setHarnessId] = useState<GuiHarnessId>(
    chatSettings?.harnessId ?? DEFAULT_HARNESS,
  );
  /**
   * The user's RAW effort / tier preference, kept sticky across model changes
   * and clamped only on the way out (below). Storing the clamped value instead
   * would silently forget a preference the moment you passed through a model
   * that doesn't support it — desktop keeps the raw value in its toolbar store
   * for the same reason.
   */
  const [reasoningRaw, setReasoningRaw] = useState<string>(
    chatSettings?.reasoningEffort ?? "",
  );
  const [serviceTierRaw, setServiceTierRaw] = useState<string>(
    chatSettings?.serviceTier ?? "",
  );
  /**
   * M2 item 2. `null` is AMBIENT, not "unset" — the wire's ambient sentinel
   * never reaches this state (see `profile-chip.tsx`), so seeding from
   * `chatSettings` is safe and `null` round-trips as the host's own default.
   */
  const [profileId, setProfileId] = useState<string | null>(
    chatSettings?.profileId ?? null,
  );

  // M2 item 3: the banner is derived from `providers.list`, which mobile
  // already polls — there is no rate-limit signal on `chat.subscribe`.
  const { providers } = useProviders(client);
  const bannerProfiles =
    providers.find((p) => p.providerId === guiHarnessIdToProviderId(harnessId))?.profiles ?? [];

  const { harnesses, probing: harnessesProbing } = useGuiHarnesses(client);
  const availableHarnesses = selectableHarnesses(harnesses);
  const { models, phase: modelsPhase } = useGuiModels(client, harnessId);
  const resolvedModel = modelSlug ?? models[0]?.slug ?? null;
  const selectedModel = models.find((m) => m.slug === resolvedModel) ?? null;

  /**
   * Derived, never stored. `selectedModel` is null while the catalogue is in
   * flight, and both normalizers pass the value straight through in that case
   * rather than clamping against a model they can't see — otherwise the first
   * paint after a harness switch would overwrite a valid preference with "".
   *
   * These are what `handleSend` emits, so what is displayed and what is sent
   * cannot disagree.
   */
  const effectiveReasoning = normalizeReasoningForModel(reasoningRaw, selectedModel);
  const effectiveServiceTier = normalizeServiceTierForModel(serviceTierRaw, selectedModel);
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
        harnessId,
        model: resolvedModel,
        permissionMode,
        // `""` is this client's "no selection"; the wire's is `null`. Emitting
        // the empty string would persist a reasoning effort of "" on the turn,
        // which is neither a valid option id nor the absence of one.
        reasoningEffort: effectiveReasoning === "" ? null : effectiveReasoning,
        serviceTier: effectiveServiceTier === "" ? null : effectiveServiceTier,
        agentMode,
        // Already mapped through `profileCommitId()` at selection time, so
        // ambient is `null` here and never the `"ambient"` sentinel. Nothing
        // downstream would reject the sentinel, which is why the mapping
        // happens at the chip rather than being trusted to a schema.
        profileId,
      },
      readyAttachments.map((a) => a.prepared),
    );
    // The text is now a real message: drop the preserved draft, or returning to
    // this chat would show the sent message still sitting in the composer.
    draft.clear();
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
      {!readOnly && (
        <RateLimitBanner
          profiles={bannerProfiles}
          currentProfileId={profileId}
          model={selectedModel}
          onSwitchProfile={setProfileId}
        />
      )}
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
            <HarnessChip
              harnesses={availableHarnesses}
              value={harnessId}
              probing={harnessesProbing}
              onChange={(id) => {
                setHarnessId(id);
                // The catalogue is per harness, so the old slug is meaningless
                // here. Null resets to the new harness's first model rather
                // than carrying a slug the new harness has never heard of.
                setModelSlug(null);
              }}
              disabled={!connectionLive}
            />
            <ModelChip
              models={models}
              value={resolvedModel}
              onChange={setModelSlug}
              disabled={!connectionLive}
            />
            <ReasoningChip
              model={selectedModel}
              value={effectiveReasoning}
              onChange={setReasoningRaw}
              disabled={!connectionLive}
            />
            <ServiceTierChip
              model={selectedModel}
              value={effectiveServiceTier}
              onChange={setServiceTierRaw}
              disabled={!connectionLive}
            />
            <ProfileChip
              client={client}
              harnessId={harnessId}
              value={profileId}
              onChange={setProfileId}
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
