/**
 * R2 groundwork — record what a file attachment ACTUALLY looks like arriving
 * from Teams, in each scope.
 *
 * This is a measurement, not a feature. The documented behaviour is that a
 * personal chat delivers `application/vnd.microsoft.teams.file.download.info`
 * with a `downloadUrl`, while a channel delivers a SharePoint reference that
 * needs Graph to fetch. If that is right, R2 and R7 are two different builds.
 * If it is wrong, designing from it wastes both.
 *
 * Documentation has already been wrong on this project — `Action.Execute` is
 * documented as supported and silently sends no invoke on Teams mobile,
 * Adaptive Cards 1.5 is documented as supported and renders as
 * "cards.unsupported", and this SDK family renamed `bot` to `agent` with the
 * v4 docs still saying `bot`. Every one of those failed SILENTLY. So the real
 * client answers this, not the documentation.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IT LOGS THE SHAPE. IT DOES NOT LOG THE VALUES.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The first version serialised the whole attachment with `JSON.stringify`,
 * reasoning that selecting fields would encode a guess about which ones
 * matter. That reasoning is right about the KEYS and wrong about the VALUES,
 * and the difference is the whole safety property:
 *
 *   a key      is protocol. `downloadUrl` existing is the finding.
 *   its value  is a customer's document — a pre-authorised link to it, or
 *              their file name — in a log that outlives the question.
 *
 * So EVERY key is reported, at every depth, and values are reported as their
 * type and size unless they are on a short list of enum-like fields whose
 * values are the answer (`contentType` is the entire question for R2 vs R7).
 *
 * URLs are reported as origin plus path DEPTH, never the path or the query.
 * A Teams `downloadUrl` carries its authorisation in the query string, so
 * `?...` redacted is the difference between a log line and a credential.
 *
 * Still gated on `TRAYCER_TEAMS_LOG_RAW_ATTACHMENTS`, off by default, and
 * still temporary. The gate is now defence in depth rather than the only
 * defence: with it off nothing is logged, and with it ON nothing logged is a
 * document.
 */
import { logInfo, logWarn } from "../logger";

export const RAW_ATTACHMENT_LOG_FLAG = "TRAYCER_TEAMS_LOG_RAW_ATTACHMENTS";

/**
 * Keys whose VALUES are reported verbatim, because the value is the finding
 * and the value is an enum, not user content.
 *
 * `contentType` decides whether R2 is a download or a Graph fetch — logging
 * it as `string(52)` would answer nothing. Compared lower-cased because the
 * wire has used both `contentType` and `contenttype` across SDK versions.
 *
 * Deliberately does NOT include `name`, `fileName` or `title`: a file name is
 * the customer's, and knowing the key exists is enough to build against.
 */
const ENUM_VALUE_KEYS: ReadonlySet<string> = new Set([
  "contenttype",
  "type",
  "@type",
  "filetype",
  "mimetype",
]);

/** Depth cap. A cycle or a deep tree must not become an unbounded log line. */
const MAX_DEPTH = 6;

/**
 * One value, described rather than reproduced.
 *
 * Numbers and booleans pass through: sizes are explicitly wanted, and a file
 * size is not a document. Strings become their length unless the key says the
 * value is an enum. URLs become origin + depth.
 */
function describeValue(key: string, value: unknown, depth: number): unknown {
  if (value === null) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (isUrlLike(value)) return describeUrl(value);
    if (ENUM_VALUE_KEYS.has(key.toLowerCase())) return value;
    return `string(${String(value.length)})`;
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return `array(${String(value.length)}) <depth cap>`;
    return value.map((item, i) => describeValue(String(i), item, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= MAX_DEPTH) return "<depth cap>";
    return describeObject(value as Record<string, unknown>, depth + 1);
  }
  return typeof value;
}

function describeObject(
  value: Record<string, unknown>,
  depth: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = describeValue(key, item, depth);
  }
  return out;
}

function isUrlLike(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * A URL as its origin and its shape.
 *
 * The QUERY is where a Teams download link carries its authorisation, and the
 * PATH carries the file name and often a tenant name. Neither is logged. What
 * survives — the host, how deep the path is, whether a query exists — is
 * enough to tell a `*.sharepoint.com` reference from a
 * `*.core.windows.net` blob link, which is the actual question.
 */
function describeUrl(value: string): string {
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter((s) => s.length > 0).length;
    return `url(${url.protocol}//${url.host}, pathSegments=${String(segments)}, query=${url.search.length > 0 ? "yes" : "no"})`;
  } catch {
    // Matched `^https?://` and still would not parse — worth knowing, and
    // still not worth printing.
    return `url(unparseable, ${String(value.length)} chars)`;
  }
}

export interface AttachmentCaptureInput {
  readonly attachments: readonly unknown[] | undefined;
  /** `personal`, `channel`, `groupChat` — the axis the question is about. */
  readonly conversationType: string | undefined;
  readonly enabled: boolean;
}

/**
 * Emits one record per attachment, tagged with the conversation type so the
 * two scopes can be told apart in the log without correlating timestamps.
 *
 * Returns the number of attachments seen, so the caller can act on presence
 * without re-reading the array — and so a test can assert the count rather
 * than scraping logs.
 */
export function captureRawAttachments(input: AttachmentCaptureInput): number {
  const attachments = input.attachments ?? [];
  if (attachments.length === 0) return 0;

  if (!input.enabled) {
    // Still record that files ARRIVED. The count and scope carry no customer
    // data and answer "did anything reach us at all", which is the first
    // question when a user says the bot ignored their file.
    logInfo("attachments received", {
      count: attachments.length,
      conversationType: input.conversationType ?? "unknown",
      raw: `disabled — set ${RAW_ATTACHMENT_LOG_FLAG}=1 to capture shapes`,
    });
    return attachments.length;
  }

  logWarn("attachment SHAPE capture is on — keys and sizes, never values", {
    flag: RAW_ATTACHMENT_LOG_FLAG,
    count: attachments.length,
  });

  attachments.forEach((attachment, index) => {
    logInfo("attachment shape", {
      index,
      conversationType: input.conversationType ?? "unknown",
      // `JSON.stringify` of the DESCRIBED shape, not of the attachment. The
      // logger takes primitives, and the ordering matters more than the type
      // error that forced it: the redaction happens first, so what is
      // serialised here has already had every value replaced by its size.
      // Stringifying the attachment and redacting the string afterwards is
      // the same mistake in the other order, and it is the one that ships.
      shape: JSON.stringify(describeAttachment(attachment)),
    });
  });

  return attachments.length;
}

/** Exported for the tests, which are the only place the output is asserted. */
export function describeAttachment(attachment: unknown): unknown {
  if (attachment === null || typeof attachment !== "object") {
    return describeValue("", attachment, 0);
  }
  return describeObject(attachment as Record<string, unknown>, 0);
}
