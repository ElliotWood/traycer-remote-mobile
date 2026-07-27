/**
 * Desktop-mirrored kind/status token system (Mobile v2, Sprint 1 / M1).
 *
 * Exact hex values, icon choices, and card treatment are pinned to
 * `clients/gui-app/src/lib/artifacts/node-display.ts` (`DEFAULT_EPIC_NODE_ICON_COLORS`,
 * `EPIC_NODE_ICONS`) and `artifact-card-segment.tsx`'s border+tint+icon-tile
 * treatment, per the Sprint 1 contract and rubric §1. `chat` intentionally gets
 * no card chrome — desktop's `ARTIFACT_KIND_CARD_CLASSES` only styles the four
 * backend artifact kinds (spec/ticket/story/review); giving chat a card would be
 * invented chrome the rubric explicitly rejects as "AI slop".
 */
import {
  BookOpen,
  ClipboardCheck,
  FileText,
  LoaderCircle,
  MessageCircleQuestionMark,
  MessageSquare,
  MessageSquareCheck,
  MessageSquareDot,
  MessageSquareLock,
  MessageSquareWarning,
  MessageSquareX,
  Ticket,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { LadderTier } from "@/host/agent-ladder";
import { colors } from "./ui";
import { theme } from "./design-tokens";

/** Backend artifact kinds that get the full kind-card treatment. */
export type CardKind = "spec" | "ticket" | "story" | "review";
/** Every node kind the mobile client shows an icon+color identity for. */
export type NodeKind = CardKind | "chat";

/** Status codes as the epic doc reports them: 0 todo, 1 in-progress, 2 done. */
export type ArtifactStatus = 0 | 1 | 2;

export const KIND_ICONS: Readonly<Record<NodeKind, LucideIcon>> = {
  spec: FileText,
  ticket: Ticket,
  story: BookOpen,
  review: ClipboardCheck,
  chat: MessageSquare,
};

/** Exact hex values from rubric §1 — do not adjust for "aesthetics". */
export const KIND_COLORS: Readonly<Record<NodeKind, string>> = {
  spec: "#fbbf24",
  ticket: "#a78bfa",
  story: "#34d399",
  review: "#fb7185",
  chat: "#38bdf8",
};

export const KIND_LABELS: Readonly<Record<NodeKind, string>> = {
  spec: "Spec",
  ticket: "Ticket",
  story: "Story",
  review: "Review",
  chat: "Chat",
};

/** Exact hex values from rubric §1 — ticket/story only. */
export const STATUS_DOT_COLORS: Readonly<Record<ArtifactStatus, string>> = {
  0: "#94a3b8",
  1: "#f59e0b",
  2: "#10b981",
};

export const STATUS_LABELS: Readonly<Record<ArtifactStatus, string>> = {
  0: "Todo",
  1: "In progress",
  2: "Done",
};

const CARD_KIND_SET: ReadonlySet<NodeKind> = new Set<NodeKind>([
  "spec",
  "ticket",
  "story",
  "review",
]);

function isCardKind(kind: NodeKind): kind is CardKind {
  return CARD_KIND_SET.has(kind);
}

/**
 * Status dots render ONLY on `ticket`/`story` (rubric §1: "status shown on
 * specs/reviews" is a named bad-practice smell). A `status` passed for any
 * other kind, or `undefined`, renders nothing.
 */
function showsStatusDot(kind: NodeKind, status: ArtifactStatus | undefined): boolean {
  return status !== undefined && (kind === "ticket" || kind === "story");
}

/**
 * `#rrggbb` (or `#rgb`) → `rgba(r, g, b, alpha)`. Backs the card's surface
 * tint and icon-tile alphas so they're computed from the single source-of-truth
 * hex rather than hand-authored a second time.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const expanded =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface StatusDotProps {
  readonly kind: NodeKind;
  readonly status: ArtifactStatus | undefined;
}

export function StatusDot({ kind, status }: StatusDotProps): ReactElement | null {
  if (!showsStatusDot(kind, status)) return null;
  const dotColor = STATUS_DOT_COLORS[status as ArtifactStatus];
  return (
    <span
      data-testid="status-dot"
      role="status"
      aria-label={STATUS_LABELS[status as ArtifactStatus]}
      title={STATUS_LABELS[status as ArtifactStatus]}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: dotColor,
        flexShrink: 0,
      }}
    />
  );
}

const ICON_TILE_SIZE = 32;

export interface KindCardProps {
  readonly kind: CardKind;
  readonly status?: ArtifactStatus;
  readonly title: string;
  readonly children?: ReactNode;
}

/**
 * Colored-left-border + tinted-surface + bordered-icon-tile treatment,
 * mirroring `artifact-card-segment.tsx`. Alphas are pinned (not eyeballed):
 * surface 0.08, icon-tile background 0.10, icon-tile border 0.25.
 */
export function KindCard({ kind, status, title, children }: KindCardProps): ReactElement {
  const color = KIND_COLORS[kind];
  const Icon = KIND_ICONS[kind];

  const cardStyle: CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    marginBottom: 8,
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    borderLeft: `3px solid ${color}`,
    background: hexToRgba(color, 0.08),
  };

  const tileStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: ICON_TILE_SIZE,
    height: ICON_TILE_SIZE,
    flexShrink: 0,
    borderRadius: 6,
    background: hexToRgba(color, 0.1),
    border: `1px solid ${hexToRgba(color, 0.25)}`,
  };

  return (
    <div data-testid="kind-card" data-kind={kind} style={cardStyle}>
      <span data-testid="kind-icon-tile" style={tileStyle}>
        <Icon size={18} color={color} aria-hidden="true" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, color: colors.text }}>{title}</span>
          <StatusDot kind={kind} status={status} />
        </div>
        {children}
      </div>
    </div>
  );
}

export interface KindIconProps {
  readonly kind: NodeKind;
  readonly label: string;
}

/**
 * Icon + color identity with NO card chrome (no border/tint/tile) — the
 * treatment `chat` gets, matching desktop's absence of a chat card accent.
 */
export function KindIcon({ kind, label }: KindIconProps): ReactElement {
  const color = KIND_COLORS[kind];
  const Icon = KIND_ICONS[kind];
  return (
    <span
      data-testid="kind-icon"
      data-kind={kind}
      style={{ display: "inline-flex", alignItems: "center", gap: 8, color: colors.text }}
    >
      <Icon size={18} color={color} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

/**
 * The title to render for an artifact row: the raw stored title when
 * non-empty, else a per-kind "Untitled {kind}" fallback (mirrors desktop's
 * `display-title.ts` `displayTitle()`, scoped to the four backend artifact
 * kinds) — so a real artifact created but never titled never renders a
 * blank row (Sprint 3 contract, round 2 SHOULD-7).
 */
export function displayArtifactTitle(title: string, kind: CardKind): string {
  return title.length > 0 ? title : `Untitled ${KIND_LABELS[kind]}`;
}

export { isCardKind };

/**
 * P1 — the Agents-section live-state ladder icon set. Static glyphs per
 * `notification-indicator-tones.ts` (failure/interview/approval/done) plus
 * mobile's own background/read-only tiles; `running`/`idle` have no entry
 * here — running renders a spinner, idle renders the plain `KIND_ICONS.chat`
 * glyph, exactly like desktop's `defaultIcon` fallback.
 */
export const LADDER_ICONS: Readonly<
  Record<Exclude<LadderTier, "running" | "idle">, LucideIcon>
> = {
  failed: MessageSquareX,
  "needs-interview": MessageCircleQuestionMark,
  "needs-approval": MessageSquareWarning,
  background: MessageSquareDot,
  "done-unread": MessageSquareCheck,
  "read-only": MessageSquareLock,
};

/** Tone color per ladder tier, sourced from the Sprint 6 `design-tokens` theme (not `./ui`) since P1 is the desktop-fidelity rebuild. */
export const LADDER_TONE_COLORS: Readonly<Record<LadderTier, string>> = {
  failed: theme.danger,
  "needs-interview": theme.warning,
  "needs-approval": theme.warning,
  running: theme.primary,
  background: theme.mutedText,
  "done-unread": theme.success,
  "read-only": theme.mutedText,
  idle: KIND_COLORS.chat,
};

export const LADDER_TIER_LABELS: Readonly<Record<LadderTier, string>> = {
  failed: "Needs attention",
  "needs-interview": "Waiting for your response",
  "needs-approval": "Waiting for your approval",
  running: "Running",
  background: "Running in background",
  "done-unread": "Task completed",
  "read-only": "Read-only",
  idle: "Idle",
};

export interface LadderIconProps {
  readonly tier: LadderTier;
  /** Muted (opacity-60) collapsed-parent rollup variant — mirrors `NestedChatStatusIcon`. */
  readonly muted?: boolean;
  readonly size?: number;
}

/**
 * The Agents-row live-state glyph: a static tone icon for failed/interview/
 * approval/background/done-unread/read-only, a CSS spinner for `running`,
 * and the plain chat glyph for `idle` — mirrors `NotificationIndicatorIcon`'s
 * precedence-resolved single-icon-slot rendering.
 */
export function LadderIcon({ tier, muted = false, size = 16 }: LadderIconProps): ReactElement {
  const color = LADDER_TONE_COLORS[tier];
  const opacity = muted ? 0.6 : 1;

  if (tier === "running") {
    return (
      <LoaderCircle
        className="traycer-spinner"
        size={size}
        color={color}
        aria-hidden="true"
        style={{ opacity }}
      />
    );
  }
  if (tier === "idle") {
    return <MessageSquare size={size} color={color} aria-hidden="true" style={{ opacity }} />;
  }
  const Icon = LADDER_ICONS[tier];
  return <Icon size={size} color={color} aria-hidden="true" style={{ opacity }} />;
}
