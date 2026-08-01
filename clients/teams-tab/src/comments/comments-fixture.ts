/**
 * Comment threads for the shoot. Every thread is a claim that can fail.
 *
 *   OPEN with quoted text   the anchor renders, so a reply has its subject
 *   RESOLVED                recedes without disappearing
 *   marks + list            bold/italic/code/strike and a bullet list survive
 *   UNKNOWN NODE KIND       the specimen: a `calloutBox` this renderer has
 *                           never seen, wrapping real words. It must lose its
 *                           formatting and KEEP its text
 *   NO fallbackHandle       the author renders as a labelled short id, never
 *                           as a bare hex string reading like a name
 *   mention + hardBreak     inline kinds that are easy to drop silently
 *
 * A fixture of two plain paragraphs would render perfectly and prove none of
 * it — least of all the unknown node, which is the one that silently
 * shortens what a person said.
 */
import type { CommentThreadWire } from "@traycer/protocol/host/epic/unary-schemas";

export const COMMENTS_FIXTURE_NOW = 1_800_000_000_000;
const T = COMMENTS_FIXTURE_NOW;

const p = (...content: unknown[]) => ({ type: "paragraph", content });
const t = (text: string, ...marks: string[]) => ({
  type: "text",
  text,
  ...(marks.length > 0
    ? { marks: marks.map((type) => ({ type })) }
    : {}),
});

export const COMMENTS_FIXTURE: readonly CommentThreadWire[] = [
  {
    threadId: "th-1",
    resolved: false,
    createdAt: T - 3 * 3_600_000,
    data: {
      createdByUserId: "u-1",
      createdByHandle: "elliot",
      quotedText:
        "Re-dial, replay queue — the turn is recoverable",
    },
    comments: [
      {
        commentId: "c-1",
        createdAt: T - 3 * 3_600_000,
        updatedAt: null,
        author: { userId: "u-1", fallbackHandle: "elliot" },
        content: {
          type: "doc",
          content: [
            p(
              t("Is this true when the host "),
              t("restarts", "bold"),
              t("? Sequence numbers reset, so "),
              t("replay", "code"),
              t(" would resend."),
            ),
            {
              type: "bulletList",
              content: [
                { type: "listItem", content: [p(t("Same socket: fine"))] },
                { type: "listItem", content: [p(t("New host: not fine"))] },
              ],
            },
          ],
        },
      },
      {
        commentId: "c-2",
        createdAt: T - 90 * 60_000,
        updatedAt: null,
        // NO handle — must render as a labelled short id.
        author: { userId: "a3f2b1c49d0e", fallbackHandle: null },
        content: {
          type: "doc",
          content: [
            p(
              { type: "mention", attrs: { label: "elliot" } },
              t(" right — the table needs a third row."),
              { type: "hardBreak" },
              t("Struck this out", "strike"),
              t(" and italic", "italic"),
            ),
            // THE SPECIMEN: a node kind this renderer has never seen.
            {
              type: "calloutBox",
              attrs: { tone: "warning" },
              content: [
                p(
                  t(
                    "These words are inside an unknown node. They must still appear.",
                  ),
                ),
              ],
            },
          ],
        },
      },
    ],
  },
  {
    threadId: "th-2",
    resolved: true,
    createdAt: T - 30 * 3_600_000,
    data: { createdByUserId: "u-1", createdByHandle: "elliot" },
    comments: [
      {
        commentId: "c-3",
        createdAt: T - 30 * 3_600_000,
        updatedAt: null,
        author: { userId: "u-1", fallbackHandle: "elliot" },
        content: {
          type: "doc",
          content: [p(t("Fixed in the reconnect commit."))],
        },
      },
    ],
  },
];
