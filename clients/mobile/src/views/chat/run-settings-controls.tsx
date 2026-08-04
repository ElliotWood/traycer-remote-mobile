/**
 * M1 — the composer's model / harness / reasoning-effort / speed-tier chips
 * and their bottom sheets.
 *
 * Split out of `composer.tsx` rather than added to it: that file already owns
 * the draft store, the prefill-adoption dance, attachment ingest and the IME-
 * sensitive textarea, and four more controls inline would have made the part
 * with the delicate behaviour hard to find.
 *
 * ## Everything here is host-supplied
 *
 * No effort or tier label is written down in this file. The rows come from the
 * selected model's `supportedReasoningEfforts` / `supportedServiceTiers`, and a
 * model that advertises none renders no control at all. Hardcoding the
 * screenshot's "Fast · Low · Medium · High · Extra High · Max" would produce a
 * control that looks right on Claude and lies on every other harness — the
 * mobile catalogue really does differ per harness (measured: 420 models across
 * 11 harnesses, 20 of them advertising no efforts whatsoever).
 *
 * ## Why the model sheet has a search field
 *
 * Not a nicety. Measured live: `kilocode` returns **297** models and `opencode`
 * 26, against Claude's 5. A flat unsearchable list is fine for the harness the
 * composer used to hard-code and unusable for the one with 297 rows.
 */
import { useMemo, useState, type ReactElement } from "react";
import { Check, ChevronDown, Cpu, Gauge, Search, Zap } from "lucide-react";
import type { GuiHarnessId } from "@traycer/protocol/host/agent/shared";
import type {
  GuiAgentModelOption,
  GuiHarnessOption,
} from "@traycer/protocol/host/agent/gui/unary-schemas";
import {
  findReasoningLabel,
  findReasoningOptionsForModel,
  findUpgradeServiceTierForModel,
  type ReasoningLevel,
  type ServiceTier,
} from "@traycer-clients/shared/agent-models/model-selection";
import { BottomSheet } from "@/views/toolbar/bottom-sheet";
import { radius, theme, type } from "@/views/design-tokens";

/**
 * What a chip reads while the chat's settings are UNKNOWN — i.e. before its
 * snapshot has arrived. Shared by all seven run-settings controls so the row
 * says one thing rather than seven.
 *
 * ## Why an `unknown` FLAG and not a null value
 *
 * Several of these controls already give `null` a meaning: `ProfileChip`'s null
 * is AMBIENT (a real choice), and `ModelChip`'s is "the catalogue hasn't
 * resolved a slug yet". Overloading null with a third meaning would collide
 * with an existing one in exactly the way that makes a fixture polite — the
 * unknown state would be indistinguishable from a legitimate value, in the code
 * as well as on screen.
 *
 * ## Two different treatments, and the split is not cosmetic
 *
 * - **Existence known, value unknown** — permission, agent mode, harness, model.
 *   The control is rendered with this label. It will still be there afterwards,
 *   so showing it now promises nothing false.
 * - **Existence ITSELF unknown** — reasoning effort, service tier, account.
 *   These render NOTHING while unknown. All three are downstream of a harness
 *   or model the composer has not been told: 20 of 420 measured models advertise
 *   no reasoning efforts, a model may offer no upgrade tier, and `ProfileChip`
 *   hides itself below two profiles. A chip that appears and then VANISHES is a
 *   worse lie than one that arrives late.
 */
export const UNKNOWN_SETTING_LABEL = "Checking…";

export function chipStyle(disabled: boolean) {
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

/**
 * `200000` → `"200K"`, `1050000` → `"1.05M"`.
 *
 * Only ever called with a non-null `contextWindow`. Whether that field is
 * populated is entirely up to the adapter: measured across 11 harnesses, 47 of
 * 420 models carry it (all of opencode's 26, all of traycer's 20, grok's 1) and
 * Claude's carry none — which is why every render of it is conditional rather
 * than a formatted "unknown".
 */
export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${millions >= 10 ? millions.toFixed(0) : millions.toFixed(2).replace(/\.?0+$/, "")}M`;
  }
  if (tokens >= 1_000) return `${String(Math.round(tokens / 1_000))}K`;
  return String(tokens);
}

function SheetRow({
  title,
  subtitle,
  meta,
  notice,
  selected,
  onClick,
}: {
  readonly title: string;
  readonly subtitle?: string | null;
  readonly meta?: string | null;
  readonly notice?: string | null;
  readonly selected: boolean;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        width: "100%",
        textAlign: "left",
        padding: "10px 8px",
        border: "none",
        borderRadius: radius.md,
        background: selected ? theme.background : "transparent",
        color: theme.text,
        cursor: "pointer",
      }}
    >
      <span style={{ width: 16, flexShrink: 0, paddingTop: 2 }}>
        {selected && <Check size={14} aria-hidden="true" />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ ...type.bodySm, display: "block", color: theme.text }}>{title}</span>
        {subtitle != null && subtitle.length > 0 && (
          <span style={{ ...type.bodySm, display: "block", color: theme.mutedText, fontSize: 11 }}>
            {subtitle}
          </span>
        )}
        {meta != null && (
          <span style={{ display: "block", color: theme.mutedText, fontSize: 11, marginTop: 2 }}>
            {meta}
          </span>
        )}
        {notice != null && notice.length > 0 && (
          <span style={{ display: "block", color: theme.danger, fontSize: 11, marginTop: 2 }}>
            {notice}
          </span>
        )}
      </span>
    </button>
  );
}

export function HarnessChip({
  harnesses,
  value,
  probing,
  unknown,
  onChange,
  disabled,
}: {
  readonly harnesses: readonly GuiHarnessOption[];
  readonly value: GuiHarnessId;
  /** The host's availability probe is still running — say so rather than showing a short list as if it were the whole one. */
  readonly probing: boolean;
  /** The chat's settings have not arrived; `value` is the composer's default, not this chat's harness. */
  readonly unknown: boolean;
  readonly onChange: (id: GuiHarnessId) => void;
  readonly disabled: boolean;
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  if (harnesses.length === 0) return null;
  const current = harnesses.find((h) => h.id === value);
  return (
    <>
      <button
        type="button"
        aria-label="Harness"
        disabled={disabled}
        onClick={() => setOpen(true)}
        style={chipStyle(disabled)}
      >
        <Cpu size={13} aria-hidden="true" />
        {/* The harness LIST is host-wide, so this control will still be here
            once the snapshot lands — only which one is selected is unknown. */}
        {unknown ? UNKNOWN_SETTING_LABEL : current?.label ?? value}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <BottomSheet title="Harness" onClose={() => setOpen(false)}>
          {probing && (
            <p style={{ ...type.bodySm, color: theme.mutedText, margin: "0 0 8px" }}>
              Still checking which harnesses are available on your host…
            </p>
          )}
          {harnesses.map((h) => (
            <SheetRow
              key={h.id}
              title={h.label}
              selected={h.id === value}
              onClick={() => {
                onChange(h.id);
                setOpen(false);
              }}
            />
          ))}
        </BottomSheet>
      )}
    </>
  );
}

export function ModelChip({
  models,
  value,
  unknown,
  onChange,
  disabled,
}: {
  readonly models: readonly GuiAgentModelOption[];
  readonly value: string | null;
  /**
   * The chat's settings have not arrived. Distinct from `value === null`, which
   * means the catalogue has not yet resolved a slug — a state this control
   * already renders as the bare word "Model".
   */
  readonly unknown: boolean;
  readonly onChange: (slug: string) => void;
  readonly disabled: boolean;
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = models.find((m) => m.slug === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return models;
    return models.filter(
      (m) =>
        m.label.toLowerCase().includes(q) ||
        m.slug.toLowerCase().includes(q) ||
        (m.description ?? "").toLowerCase().includes(q),
    );
  }, [models, query]);

  if (models.length === 0) return null;
  return (
    <>
      <button
        type="button"
        aria-label="Model"
        disabled={disabled}
        onClick={() => setOpen(true)}
        style={chipStyle(disabled)}
      >
        {/* The LABEL, not the slug. This is the field that only the GUI
            catalogue carries, and the visible proof the RPC swap landed.

            Pre-snapshot the catalogue itself is fetched for the composer's
            DEFAULT harness, so `selected` may be a real model from the wrong
            one — which is why this suppresses on `unknown` rather than trusting
            a resolved slug to mean the chat's own model. */}
        {unknown ? UNKNOWN_SETTING_LABEL : selected?.label ?? value ?? "Model"}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <BottomSheet title="Model" onClose={() => setOpen(false)}>
          {/* Shown whenever the list is long enough to need it — with 297
              models on kilocode, scrolling to a known model is not a plan. */}
          {models.length > 8 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 8,
                padding: "0 8px",
                border: `1px solid ${theme.border}`,
                borderRadius: radius.md,
              }}
            >
              <Search size={14} aria-hidden="true" style={{ color: theme.mutedText, flexShrink: 0 }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${String(models.length)} models…`}
                aria-label="Search models"
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  color: theme.text,
                  fontSize: 14,
                  padding: "8px 0",
                  fontFamily: "inherit",
                }}
              />
            </div>
          )}
          {filtered.length === 0 ? (
            <p style={{ ...type.bodySm, color: theme.mutedText, margin: 8 }}>
              No model matches “{query}”.
            </p>
          ) : (
            filtered.map((m) => (
              <SheetRow
                key={m.slug}
                title={m.label}
                subtitle={m.description}
                // Conditional, never "unknown": most harnesses leave
                // `contextWindow` null and a rendered blank reads as a defect.
                meta={
                  m.contextWindow === null
                    ? null
                    : `${formatContextWindow(m.contextWindow)} context`
                }
                notice={m.deprecationNotice ?? null}
                selected={m.slug === value}
                onClick={() => {
                  onChange(m.slug);
                  setOpen(false);
                }}
              />
            ))
          )}
        </BottomSheet>
      )}
    </>
  );
}

/**
 * Reasoning effort. Renders NOTHING when the selected model advertises no
 * efforts — measured live, 20 of 420 models are in that state (Claude's
 * `haiku` among them), so this is a real branch and not a defensive one.
 */
export function ReasoningChip({
  model,
  value,
  unknown,
  onChange,
  disabled,
}: {
  readonly model: GuiAgentModelOption | null;
  readonly value: ReasoningLevel;
  /** The chat's settings have not arrived, so `model` is a guess and so is this control's very existence. */
  readonly unknown: boolean;
  readonly onChange: (level: ReasoningLevel) => void;
  readonly disabled: boolean;
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  const options = findReasoningOptionsForModel(model);
  // Nothing at all while unknown, rather than a suppressed value: `model` here
  // is derived from the composer's DEFAULT harness pre-snapshot, and 20 of 420
  // measured models advertise no efforts — so whether this control should exist
  // is itself unknown. A chip that appears and then vanishes is worse than one
  // that arrives late.
  if (unknown) return null;
  if (options.length === 0) return null;
  return (
    <>
      <button
        type="button"
        aria-label="Reasoning effort"
        disabled={disabled}
        onClick={() => setOpen(true)}
        style={chipStyle(disabled)}
      >
        <Gauge size={13} aria-hidden="true" />
        {findReasoningLabel(value, options)}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <BottomSheet title="Reasoning effort" onClose={() => setOpen(false)}>
          {options.map((o) => (
            <SheetRow
              key={o.id}
              title={o.label}
              subtitle={o.description}
              selected={o.id === value}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
            />
          ))}
        </BottomSheet>
      )}
    </>
  );
}

/**
 * Speed / service tier, as a toggle for the model's UPGRADE tier.
 *
 * `findUpgradeServiceTierForModel` decides which option that is — deliberately
 * NOT `supportedServiceTiers[0]`, whose ordering is not contractual and can
 * begin with a literal "default" row. A model advertising no tiers renders
 * nothing.
 */
export function ServiceTierChip({
  model,
  value,
  unknown,
  onChange,
  disabled,
}: {
  readonly model: GuiAgentModelOption | null;
  readonly value: ServiceTier;
  /** The chat's settings have not arrived, so `model` is a guess and so is this control's very existence. */
  readonly unknown: boolean;
  readonly onChange: (tier: ServiceTier) => void;
  readonly disabled: boolean;
}): ReactElement | null {
  const upgrade = findUpgradeServiceTierForModel(model);
  // Same reasoning as `ReasoningChip`, and stronger here: this control is NAMED
  // after the model's upgrade tier (`aria-label={upgrade.label}`), so while the
  // model is a guess the chip cannot even say what it is.
  if (unknown) return null;
  if (upgrade === null) return null;
  const on = value === upgrade.id;
  return (
    <button
      type="button"
      aria-label={upgrade.label}
      aria-pressed={on}
      title={upgrade.description ?? upgrade.label}
      disabled={disabled}
      onClick={() => onChange(on ? "" : upgrade.id)}
      style={{
        ...chipStyle(disabled),
        borderColor: on ? theme.primary : theme.border,
        color: on ? theme.primary : theme.mutedText,
      }}
    >
      <Zap size={13} aria-hidden="true" />
      {upgrade.label}
    </button>
  );
}
