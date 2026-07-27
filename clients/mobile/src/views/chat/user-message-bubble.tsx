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
import { ImageOff } from "lucide-react";
import type { JsonContent } from "@traycer/protocol/common/registry";
import type { UserMessageSender } from "@traycer/protocol/persistence/epic/senders";
import { userContentToMarkdown, userSenderProvenance } from "@/host/user-content";
import { extractImageAttachments } from "@/host/image-attachment";
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
              // A cache-seeded render has `b64content` stripped (never persisted to
              // localStorage — see `image-attachment.ts`'s `stripAttachmentPayloads`).
              // The next live snapshot always re-supplies it; this is a placeholder
              // for that window, never a permanent broken-image state.
              const src =
                attachment.b64content !== undefined
                  ? `data:${attachment.mimeType};base64,${attachment.b64content}`
                  : null;
              return (
                <button
                  key={attachment.id}
                  type="button"
                  aria-label={src !== null ? `View ${attachment.fileName}` : `${attachment.fileName} (not cached)`}
                  disabled={src === null}
                  onClick={() => src !== null && setLightboxSrc(src)}
                  style={{
                    width: 88,
                    height: 88,
                    borderRadius: 10,
                    overflow: "hidden",
                    border: "none",
                    padding: 0,
                    cursor: src !== null ? "pointer" : "default",
                    background: colors.border,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {src !== null ? (
                    <img src={src} alt={attachment.fileName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <ImageOff size={20} color={colors.muted} aria-hidden="true" />
                  )}
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
