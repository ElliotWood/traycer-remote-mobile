/**
 * Attention rows for the screenshots.
 *
 * SHAPED from the real feed, INVENTED in content. The shape that matters:
 * both blocking kinds, items from DIFFERENT epics (this is the only surface
 * where that happens), and one whose epic title has not resolved — so the
 * labelled-id fallback is visible in the shot rather than assumed.
 *
 * Ages span minutes to days on purpose: the list sorts OLDEST first, and a
 * fixture where everything is recent would not show that the three-day-old
 * approval leads.
 */
import type { AttentionItem } from "@traycer-clients/shared/epic/attention";

const T = 1_800_000_000_000;

export const ATTENTION_NOW = T;

export const ATTENTION_FIXTURE: readonly AttentionItem[] = [
  {
    id: "n1",
    kind: "approval.requested",
    epicId: "e1000000-0000-4000-8000-000000000001",
    chatId: "c1",
    updatedAt: T - 3 * 86_400_000,
    unread: true,
  },
  {
    id: "n2",
    kind: "interview.requested",
    // Title deliberately NOT in the preview map — renders "Epic e2000000".
    epicId: "e2000000-0000-4000-8000-000000000002",
    chatId: "c2",
    updatedAt: T - 5 * 3_600_000,
    unread: true,
  },
  {
    id: "n3",
    kind: "approval.requested",
    epicId: "e1000000-0000-4000-8000-000000000001",
    chatId: "c3",
    updatedAt: T - 12 * 60_000,
    unread: false,
  },
];
