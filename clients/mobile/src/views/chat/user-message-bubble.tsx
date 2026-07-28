/**
 * A user-role row (Sprint 2) — right-aligned bubble, visually distinct from
 * assistant blocks. Real text is extracted from the row's `JsonContent` via
 * `userContentToMarkdown` (never a flattened string), rendered through S1's
 * `MobileMarkdown`. An agent-sender row (agent-to-agent messaging) shows a
 * provenance line instead of a plain "You" label. A `steer` block renders
 * through this SAME component with a "steered" badge — it is never a block
 * card (matches desktop's `BLOCK_HANDLERS.steer => null`).
 */
import { memo, useState, type ReactElement } from "react";
import { ImageIcon } from "lucide-react";
import type { JsonContent } from "@traycer/protocol/common/registry";
import type { UserMessageSender } from "@traycer/protocol/persistence/epic/senders";
import { userContentToMarkdown, userSenderProvenance } from "@/host/user-content";
import { extractImageAttachments, getRememberedAttachmentDataUrl } from "@/host/image-attachment";
import { MobileMarkdown } from "../markdown/mobile-markdown";
import { colors } from "../ui";

export interface UserMessageBubbleProps {
  readonly content: JsonContent;
  readonly sender: UserMessageSender | null;
  readonly steered?: boolean;
}

function UserMessageBubbleImpl({
  content,
  sender,
  steered = false,
}: UserMessageBubbleProps): ReactElement {
  const markdown = userContentToMarkdown(content);
  const provenance = sender !== null ? userSenderProvenance(sender) : null;
  const attachments = extractImageAttachments(content);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
      <div style={{ maxWidth: "85%" }}>
        {(provenance !== null || steered) && (
          <div style={{ textAlign: "right", fontSize: 11, color: colors.muted, marginBottom: 2 }}>
            {provenance !== null ? provenance : null}
            {steered && (
              <span
                style={{
                  marginLeft: 6,
                  border: `1px solid ${colors.accent}`,
                  color: colors.accent,
                  borderRadius: 999,
                  padding: "0 6px",
                }}
              >
                steered
              </span>
            )}
          </div>
        )}
        {attachments.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", marginBottom: markdown.trim().length > 0 ? 6 : 0 }}>
            {attachments.map((attachment) => {
              // Fresh live data (b64content still present) wins; else fall
              // back to the sender's own remembered bytes (see
              // `rememberSentAttachments`'s docblock — the host rewrites
              // `b64content` to a `hash` after persistence, and there is no
              // read-by-hash RPC to fetch it back). Neither present means
              // this client never held the bytes at all (a cache-seeded
              // render before the live snapshot lands, or an attachment
              // authored on another device/session) — that degrades to the
              // SAME honest labeled chip desktop's `renderImageAttachment`
              // shows unconditionally (desktop never renders a thumbnail).
              const src =
                attachment.b64content !== undefined
                  ? `data:${attachment.mimeType};base64,${attachment.b64content}`
                  : getRememberedAttachmentDataUrl(attachment.id);
              if (src === null) {
                return (
                  <span
                    key={attachment.id}
                    aria-label={`Attached ${attachment.fileName}`}
                    title={attachment.fileName}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      maxWidth: 160,
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: `1px solid ${colors.border}`,
                      color: colors.text,
                      fontSize: 12,
                    }}
                  >
                    <ImageIcon size={14} color={colors.muted} aria-hidden="true" style={{ flexShrink: 0 }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {attachment.fileName}
                    </span>
                  </span>
                );
              }
              return (
                <button
                  key={attachment.id}
                  type="button"
                  aria-label={`View ${attachment.fileName}`}
                  onClick={() => setLightboxSrc(src)}
                  style={{
                    width: 88,
                    height: 88,
                    borderRadius: 10,
                    overflow: "hidden",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    background: colors.border,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <img src={src} alt={attachment.fileName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </button>
              );
            })}
          </div>
        )}
        {markdown.trim().length > 0 && (
          <div
            data-testid="user-bubble"
            style={{
              background: "#1f2b3a",
              borderRadius: 12,
              padding: "8px 12px",
            }}
          >
            <MobileMarkdown>{markdown}</MobileMarkdown>
          </div>
        )}
      </div>
      {lightboxSrc !== null && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  );
}

/** Minimal full-screen viewer — tap anywhere to dismiss. */
function ImageLightbox({ src, onClose }: { readonly src: string; readonly onClose: () => void }): ReactElement {
  return (
    <div
      role="button"
      aria-label="Close image"
      tabIndex={0}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " " || e.key === "Escape") onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.9)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
    >
      <img src={src} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8 }} />
    </div>
  );
}

/** Perf fix: memoized so an unrelated transcript update (a new message appended elsewhere) doesn't re-render every prior bubble — see `transcript-view.tsx`'s docblock. */
export const UserMessageBubble = memo(UserMessageBubbleImpl);
