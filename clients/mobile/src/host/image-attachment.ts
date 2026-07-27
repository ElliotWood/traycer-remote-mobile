/**
 * Chat composer image attachments — client-side prepare (downscale/re-encode
 * to base64) and the shared strip helper that keeps raw image bytes out of
 * the localStorage transcript cache.
 *
 * Wire contract (confirmed against gui-app's real send path, not guessed):
 * an attachment is an `imageAttachment` TipTap/ProseMirror node —
 * `{type: "imageAttachment", attrs: {id, fileName, mimeType, size, b64content}}`
 * — inlined directly into the message's `JsonContent` doc and sent over the
 * SAME `send` client frame every other message uses. No separate upload RPC
 * exists; the host rewrites `b64content` to a `hash` reference AFTER
 * persistence, but the client always sends raw base64 on submit.
 *
 * Mobile-specific risk desktop mostly avoids (screenshots are small; a phone
 * camera photo is 3-12 MB, ~33% larger again once base64-encoded): this
 * downscales every image to a vision-model-appropriate working resolution
 * BEFORE encoding, both to keep the `send` frame small and — just as
 * important — to keep the localStorage chat-transcript cache
 * (`use-chat.ts`'s `serializeChatCache`) from blowing its ~5-10MB quota on a
 * single attached photo. `stripAttachmentPayloads` below is the second half
 * of that: even a downscaled image's base64 is excluded from what gets
 * cached, replaced with a placeholder the cache-seeded render can show
 * instead of a broken image.
 */
import { v4 as uuidv4 } from "uuid";
import type { JsonContent } from "@traycer/protocol/common/registry";

/** ~1568px is the working resolution most vision models resample to internally — a larger image buys no fidelity, only bytes. */
export const MAX_IMAGE_EDGE_PX = 1568;
export const IMAGE_JPEG_QUALITY = 0.8;
export const MAX_ATTACHMENTS_PER_MESSAGE = 4;
/**
 * Hard ceiling on the POST-downscale base64 payload, applied client-side
 * regardless of the wire's own frame limit — keeps a single attachment from
 * dominating the cache quota even if the transport itself would allow more.
 */
export const MAX_ATTACHMENT_BASE64_BYTES = 4 * 1024 * 1024;

export const IMAGE_ATTACHMENT_NODE_TYPE = "imageAttachment";

export interface PreparedAttachment {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  /** Byte length of the base64 payload (not the original file size). */
  readonly size: number;
  readonly base64: string;
  /** `data:` URL for local thumbnail preview — same bytes as `base64`, just prefixed. */
  readonly dataUrl: string;
}

export class AttachmentTooLargeError extends Error {}

function loadImage(objectUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = objectUrl;
  });
}

function scaledDimensions(width: number, height: number, maxEdge: number): { readonly width: number; readonly height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Reads an image `File`, downscales it to `MAX_IMAGE_EDGE_PX` on the longest
 * edge via canvas, and re-encodes as JPEG at `IMAGE_JPEG_QUALITY`. Throws
 * {@link AttachmentTooLargeError} if the result is still over the hard cap
 * (an unusually complex/high-entropy image) — callers show this inline
 * rather than silently dropping the attachment.
 */
export async function prepareImageAttachment(file: File): Promise<PreparedAttachment> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const { width, height } = scaledDimensions(img.naturalWidth, img.naturalHeight, MAX_IMAGE_EDGE_PX);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("Canvas 2D context unavailable");
    ctx.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", IMAGE_JPEG_QUALITY);
    const commaIndex = dataUrl.indexOf(",");
    const base64 = commaIndex === -1 ? "" : dataUrl.slice(commaIndex + 1);
    if (base64.length > MAX_ATTACHMENT_BASE64_BYTES) {
      throw new AttachmentTooLargeError(
        `This image is too large even after compression (${Math.round(base64.length / 1024 / 1024)} MB) — try a different photo.`,
      );
    }
    return {
      id: uuidv4(),
      fileName: file.name,
      mimeType: "image/jpeg",
      size: base64.length,
      base64,
      dataUrl,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Builds the message doc: a text paragraph (if any) followed by one `imageAttachment` node per attachment — the exact shape gui-app's editor inserts. */
export function messageContentWithAttachments(
  text: string,
  attachments: readonly PreparedAttachment[],
): JsonContent {
  const content: JsonContent[] = [];
  if (text.length > 0) {
    content.push({ type: "paragraph", content: [{ type: "text", text }] });
  }
  for (const attachment of attachments) {
    content.push({
      type: IMAGE_ATTACHMENT_NODE_TYPE,
      attrs: {
        id: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        b64content: attachment.base64,
      },
    });
  }
  if (content.length === 0) {
    content.push({ type: "paragraph", content: [] });
  }
  return { type: "doc", content };
}

export interface ImageAttachmentAttrs {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly size: number;
  readonly b64content?: string;
}

function readImageAttachmentAttrs(attrs: Record<string, unknown> | undefined): ImageAttachmentAttrs | null {
  if (
    attrs === undefined ||
    typeof attrs.id !== "string" ||
    typeof attrs.fileName !== "string" ||
    typeof attrs.mimeType !== "string" ||
    typeof attrs.size !== "number"
  ) {
    return null;
  }
  return {
    id: attrs.id,
    fileName: attrs.fileName,
    mimeType: attrs.mimeType,
    size: attrs.size,
    b64content: typeof attrs.b64content === "string" ? attrs.b64content : undefined,
  };
}

/** Every `imageAttachment` node in a message doc, in document order. `null`/malformed attrs are skipped rather than throwing (rubric: never crash the transcript on a malformed block). */
export function extractImageAttachments(content: JsonContent): readonly ImageAttachmentAttrs[] {
  const out: ImageAttachmentAttrs[] = [];
  const walk = (node: JsonContent): void => {
    if (node.type === IMAGE_ATTACHMENT_NODE_TYPE) {
      const attrs = readImageAttachmentAttrs(node.attrs);
      if (attrs !== null) out.push(attrs);
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(content);
  return out;
}

/**
 * Deep-clones a message doc with every `imageAttachment` node's `b64content`
 * removed — the ONLY thing excluded from the localStorage transcript cache
 * (`use-chat.ts`'s `serializeChatCache`). A cache-seeded render of a message
 * carrying a stripped attachment shows a "photo not cached" placeholder
 * (`user-message-bubble.tsx`) rather than a broken image — the next live
 * snapshot always re-supplies the real bytes (this only affects the
 * cache-seed window before `hasSnapshot` flips true).
 */
export function stripAttachmentPayloads(content: JsonContent): JsonContent {
  if (content.type === IMAGE_ATTACHMENT_NODE_TYPE && content.attrs !== undefined) {
    const { b64content: _b64content, ...rest } = content.attrs;
    return { ...content, attrs: rest };
  }
  if (content.content === undefined) return content;
  return { ...content, content: content.content.map(stripAttachmentPayloads) };
}
