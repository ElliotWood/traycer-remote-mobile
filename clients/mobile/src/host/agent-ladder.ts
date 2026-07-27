/**
 * The P1 live-state ladder (Epic tree, Agents section) — a mobile port of
 * desktop's `attentionTone`/`NotificationIndicatorIcon` precedence
 * (`notification-indicator-tones.ts`, `notification-indicator-icon.tsx`) and
 * the sidebar's collapsed-parent rollup (`chatDescendantKind`,
 * `nestedChatStatusSummary` in `epic-sidebar-chat-tree.tsx`).
 *
 * Pure, React-free, fully unit-testable by design — the Evaluator's P1
 * tighten #4: live verification will mostly show idle/read-only chats (no
 * autobuild chat is currently erroring/blocked/running), so the tiers that
 * CAN'T be staged live are proven here instead.
 */
import type { ChatBadgeState } from "./use-chat-badges";

export type LadderTier =
  | "failed"
  | "needs-interview"
  | "needs-approval"
  | "running"
  | "background"
  | "done-unread"
  | "read-only"
  | "idle";

export interface LadderInput {
  readonly badge: ChatBadgeState;
  /** `badge.lastErrorAt` compared against the read-tracking store — see `read-tracking-store.ts`. */
  readonly hasUnreadFailure: boolean;
  /** The chat's `updatedAt` compared against the read-tracking store. */
  readonly hasUnreadDone: boolean;
}

/**
 * Precedence mirrors `attentionTone`: failure > interview > approval, then
 * desktop's running/background/unreadDone/idle fallthrough
 * (`notification-indicator-icon.tsx`). `read-only` is mobile's rendering of
 * desktop's `isReadOnly` idle-slot lock icon — it only shows once nothing
 * more urgent applies.
 *
 * NOTE (P1 contract): `done-unread` here is an APPROXIMATION, not exact
 * desktop parity. Desktop's `unreadDone` is an explicit host "task
 * completed" indicator; this is "unread activity + settled" (no
 * pending/running/background state) — it will also fire for an idle chat
 * with unseen messages that never errored, not only a completed turn.
 * Accepted: mobile has no host completion indicator to read instead.
 */
export function resolveLadderTier(input: LadderInput): LadderTier {
  const { badge } = input;
  if (input.hasUnreadFailure) return "failed";
  if (badge.pendingInterview) return "needs-interview";
  if (badge.pendingApproval) return "needs-approval";
  if (badge.runStatus === "running" || badge.runStatus === "stopping") return "running";
  if (badge.background) return "background";
  if (input.hasUnreadDone) return "done-unread";
  if (badge.accessRole === "viewer") return "read-only";
  return "idle";
}

/** The six tiers that participate in the collapsed-parent rollup (mirrors `ChatDescendantStatusKind`). Read-only/idle carry no rollup signal — same as desktop. */
export type DescendantStatusKind =
  | "failure"
  | "interview"
  | "approval"
  | "running"
  | "background"
  | "done";

const DESCENDANT_RANK: Readonly<Record<DescendantStatusKind, number>> = {
  failure: 6,
  interview: 5,
  approval: 4,
  running: 3,
  background: 2,
  done: 1,
};

export function ladderTierToDescendantKind(tier: LadderTier): DescendantStatusKind | null {
  switch (tier) {
    case "failed":
      return "failure";
    case "needs-interview":
      return "interview";
    case "needs-approval":
      return "approval";
    case "running":
      return "running";
    case "background":
      return "background";
    case "done-unread":
      return "done";
    case "read-only":
    case "idle":
      return null;
  }
}

/**
 * Depth-first descendant ids under `nodeId`, cycle-guarded (a malformed
 * `parentId` cycle can never infinite-loop this). Shared by both the chat
 * rollup and the artifact unread rollup below.
 */
export function collectDescendantIds(
  nodeId: string,
  childrenByParent: Readonly<Record<string, readonly string[]>>,
): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>([nodeId]);
  const stack = [...(childrenByParent[nodeId] ?? [])];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    stack.push(...(childrenByParent[id] ?? []));
  }
  return out;
}

export interface ChatDescendantRollup {
  readonly kind: DescendantStatusKind | null;
  readonly counts: Readonly<Record<DescendantStatusKind, number>>;
}

const EMPTY_COUNTS: Readonly<Record<DescendantStatusKind, number>> = {
  failure: 0,
  interview: 0,
  approval: 0,
  running: 0,
  background: 0,
  done: 0,
};

/** Classifies every chat descendant onto the urgency ladder and picks the highest-ranked non-empty bucket — mirrors `chatDescendantKind`/`CHAT_STATUS_ORDER.find`. */
export function computeChatDescendantRollup(
  nodeId: string,
  childrenByParent: Readonly<Record<string, readonly string[]>>,
  tierOf: (descendantId: string) => LadderTier,
): ChatDescendantRollup {
  const counts: Record<DescendantStatusKind, number> = { ...EMPTY_COUNTS };
  for (const id of collectDescendantIds(nodeId, childrenByParent)) {
    const kind = ladderTierToDescendantKind(tierOf(id));
    if (kind !== null) counts[kind] += 1;
  }
  let best: DescendantStatusKind | null = null;
  let bestRank = 0;
  for (const kind of Object.keys(counts) as DescendantStatusKind[]) {
    if (counts[kind] > 0 && DESCENDANT_RANK[kind] > bestRank) {
      best = kind;
      bestRank = DESCENDANT_RANK[kind];
    }
  }
  return { kind: best, counts };
}

/** Ties go to the parent — the nested (muted) rollup icon only renders when it OUTRANKS the parent's own tier, mirroring `chatSelfStatusRank` comparison. */
export function rollupOutranksSelf(rollup: ChatDescendantRollup, selfTier: LadderTier): boolean {
  if (rollup.kind === null) return false;
  const selfKind = ladderTierToDescendantKind(selfTier);
  const selfRank = selfKind === null ? 0 : DESCENDANT_RANK[selfKind];
  return DESCENDANT_RANK[rollup.kind] > selfRank;
}

/** Accessible summary text for the nested rollup icon — mirrors `nestedChatStatusSummary`'s "Nested: 1 need attention · 2 running" shape. */
export function summarizeChatDescendantRollup(rollup: ChatDescendantRollup): string {
  const parts: string[] = [];
  const attention = rollup.counts.failure + rollup.counts.interview + rollup.counts.approval;
  if (attention > 0) {
    parts.push(`${attention} need${attention === 1 ? "s" : ""} attention`);
  }
  if (rollup.counts.running > 0) {
    parts.push(`${rollup.counts.running} running`);
  }
  if (rollup.counts.background > 0) {
    parts.push(`${rollup.counts.background} background`);
  }
  if (rollup.counts.done > 0) {
    parts.push(`${rollup.counts.done} done`);
  }
  return parts.length === 0 ? "Nested" : `Nested: ${parts.join(" · ")}`;
}

/** Binary rollup for the artifact tree's unread bar: does ANY descendant read unread? Mirrors `collectDescendantArtifactEntries`'s presence check (single axis, no priority ladder — artifacts have no urgency tiers). */
export function anyDescendantUnread(
  nodeId: string,
  childrenByParent: Readonly<Record<string, readonly string[]>>,
  isUnreadFn: (descendantId: string) => boolean,
): boolean {
  return collectDescendantIds(nodeId, childrenByParent).some(isUnreadFn);
}
