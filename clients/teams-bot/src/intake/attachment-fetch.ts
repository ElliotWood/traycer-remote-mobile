/**
 * R2 — actually GET THE BYTES of a file someone dropped into Teams.
 *
 * `attachment-capture.ts` next door answered the measurement question ("what
 * arrives?"). This is the build that follows from the answer, and the answer
 * narrowed the job considerably:
 *
 *   In a PERSONAL chat Teams delivers the file inline, as an attachment with
 *   `contentType: application/vnd.microsoft.teams.file.download.info` whose
 *   `content.downloadUrl` is PRE-AUTHORISED. A plain GET returns the bytes.
 *   No Graph call, no app permission, no admin consent.
 *
 * That matters because the bot's Entra app registration has
 * `requiredResourceAccess: []` — verified, not assumed — so it holds no Graph
 * permission of any kind and could not make a Graph call today even if the
 * design wanted one. The personal-chat path is the one that works with the
 * credentials this bot actually has, and the deployed manifest scopes the bot
 * to `personal` anyway.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DOWNLOAD URL IS A CREDENTIAL. TREAT IT AS ONE.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * "Pre-authorised" means anyone holding the URL can fetch the document with
 * no sign-in. Its query string IS the bearer token. So it is:
 *
 *   - never logged (the sibling capture module already redacts queries for
 *     exactly this reason — this module holds the same line),
 *   - never written to disk,
 *   - never put in an Adaptive Card payload. Card data round-trips through
 *     Bot Service and back through an ingress we do not control; a capability
 *     URL in there is a customer document one relay hop from a log nobody
 *     owns. The card carries an opaque local intake id instead.
 *
 * It is consumed once, here, on the turn it arrives, and then dropped.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE URL COMES FROM THE REQUEST BODY, SO THE FETCH IS AN SSRF SINK.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `activity.attachments` is inbound request data. JWT validation proves the
 * caller is Bot Service; it proves nothing about the CONTENT of the activity.
 * A `downloadUrl` of `http://169.254.169.254/metadata/identity/oauth2/token`
 * would, unguarded, make this process fetch the VM's managed-identity token
 * and store it as "the customer's document" — on the same box that runs the
 * Traycer host.
 *
 * So the host is allowlisted by SUFFIX before the socket is opened, and
 * redirects are followed MANUALLY with the same check on every hop. A
 * `redirect: "follow"` would validate hop 0 and let SharePoint's own 302
 * chain land anywhere; that is the whole class of bypass this avoids.
 */
import { logInfo, logWarn } from "../logger";

/** The personal-chat file attachment. The finding `attachment-capture` was built to make. */
export const TEAMS_FILE_DOWNLOAD_CONTENT_TYPE =
  "application/vnd.microsoft.teams.file.download.info";

/**
 * The channel / group-chat shape: a SharePoint item reference with no
 * pre-authorised URL. Recognised so it can be REFUSED IN WORDS rather than
 * counted as zero files — see `classifyAttachment`.
 */
export const TEAMS_FILE_INFO_CONTENT_TYPE =
  "application/vnd.microsoft.teams.file.info";

/**
 * Hosts a Teams download URL is allowed to resolve to, as DNS suffixes.
 *
 * Matched as a suffix on a label boundary — `evil-sharepoint.com` must not
 * pass because it ends in `sharepoint.com`. Deliberately short: this list is
 * the SSRF gate, and every entry added to it on a hunch widens the sink.
 * Extend it when a real fetch is observed being refused, not before.
 */
export const ALLOWED_DOWNLOAD_HOST_SUFFIXES: readonly string[] = [
  "sharepoint.com",
  "sharepoint-df.com",
  "svc.ms",
  "onedrive.com",
];

/** Teams caps bot attachments far below this; the cap is a backstop, not a policy. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 30_000;
/** SharePoint's own download chain is short. More hops than this is a redirector loop. */
const MAX_REDIRECTS = 5;

export interface FetchedFile {
  /** As Teams reported it. UNSANITISED — the store owns making it a safe path. */
  readonly name: string;
  readonly bytes: Uint8Array;
  /** From the response, for the manifest. Never trusted for anything. */
  readonly contentType: string | null;
}

export type AttachmentClassification =
  /** A personal-chat file with a pre-authorised URL. Fetchable now. */
  | {
      readonly kind: "downloadable";
      readonly name: string;
      readonly downloadUrl: string;
    }
  /**
   * A file we can SEE but cannot GET: the channel/SharePoint reference, which
   * needs a Graph token this bot does not have. Named rather than dropped —
   * a file silently counted as zero is the exact defect this epic is fixing.
   */
  | { readonly kind: "needs_graph"; readonly name: string }
  /** Not a file at all. `text/html` message formatting lands here, which is most of them. */
  | { readonly kind: "not_a_file" };

export type FetchOutcome =
  | { readonly kind: "fetched"; readonly file: FetchedFile }
  /** Refused on OUR rules — allowlist, size. Not a transport failure. */
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

function readString(
  source: Record<string, unknown>,
  key: string,
): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * What kind of thing this attachment is, without fetching anything.
 *
 * Exported because it is also the honest answer to "does this message have a
 * document?" — a question `classify` was previously asking as
 * `attachments.length > 0`, which is TRUE for the `text/html` blob Teams
 * attaches to every formatted message. Measured on the live bot: the one
 * shape ever captured in production was
 * `{"contentType":"text/html","content":"string(11)"}` on a plain text
 * message. Length was never a file count.
 */
export function classifyAttachment(attachment: unknown): AttachmentClassification {
  if (attachment === null || typeof attachment !== "object") {
    return { kind: "not_a_file" };
  }
  const record = attachment as Record<string, unknown>;
  // Both spellings: the wire has used `contentType` and `contenttype` across
  // SDK versions, which is why the sibling capture module lower-cases too.
  const contentType = (
    readString(record, "contentType") ?? readString(record, "contenttype") ?? ""
  ).toLowerCase();
  const name = readString(record, "name") ?? "document";

  if (contentType === TEAMS_FILE_DOWNLOAD_CONTENT_TYPE) {
    const content = record["content"];
    const downloadUrl =
      content !== null && typeof content === "object"
        ? readString(content as Record<string, unknown>, "downloadUrl")
        : null;
    if (downloadUrl === null) {
      // The contentType promises a download and the payload has none. Report
      // it as a file we cannot fetch rather than as no file — the user
      // attached something either way.
      return { kind: "needs_graph", name };
    }
    return { kind: "downloadable", name, downloadUrl };
  }

  if (contentType === TEAMS_FILE_INFO_CONTENT_TYPE) {
    return { kind: "needs_graph", name };
  }

  return { kind: "not_a_file" };
}

/** Suffix match on a LABEL BOUNDARY, so `evil-sharepoint.com` does not pass. */
export function isAllowedDownloadHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_DOWNLOAD_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

/**
 * `https` only, and on an allowlisted host.
 *
 * `http` is refused separately from the allowlist because the reason differs:
 * a plaintext hop would put the capability token on the wire, and the IMDS
 * endpoint that makes this an SSRF sink is plain `http` in the first place.
 */
function checkUrl(raw: string): { readonly url: URL } | { readonly refused: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { refused: "download URL was not parseable" };
  }
  if (url.protocol !== "https:") {
    return { refused: `download URL was ${url.protocol}, not https` };
  }
  if (!isAllowedDownloadHost(url.hostname)) {
    // The HOST is named — it is not customer data and it is the whole
    // diagnostic. The path and query are not, and are not logged anywhere.
    return { refused: `download host "${url.hostname}" is not allowlisted` };
  }
  return { url };
}

export type FetchFn = typeof globalThis.fetch;

/** Every field optional; the ARGUMENT is not, so a caller never forgets it exists. */
export interface FetchOptions {
  readonly fetchFn?: FetchFn;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
}

/**
 * Fetches one file, following redirects by hand so every hop is checked.
 *
 * Nothing about the URL reaches the logs — only its host, its status, and the
 * byte count.
 */
export async function fetchAttachment(
  file: { readonly name: string; readonly downloadUrl: string },
  options: FetchOptions,
): Promise<FetchOutcome> {
  const doFetch = options.fetchFn ?? globalThis.fetch;
  const maxBytes = options.maxBytes ?? MAX_ATTACHMENT_BYTES;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;

  let current = file.downloadUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = checkUrl(current);
    if ("refused" in checked) return { kind: "refused", reason: checked.refused };

    let response: Response;
    try {
      response = await doFetch(checked.url, {
        // MANUAL. See the docblock: `follow` would check hop 0 and let the
        // rest of the chain go anywhere.
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "*/*" },
      });
    } catch (error) {
      return {
        kind: "failed",
        reason: error instanceof Error ? error.message : "fetch threw",
      };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null) {
        return { kind: "failed", reason: `redirect ${String(response.status)} with no location` };
      }
      // Resolved against the current URL so a relative `Location` cannot
      // escape the check by being un-parseable on its own.
      current = new URL(location, checked.url).toString();
      logInfo("attachment download redirected", {
        hop,
        status: response.status,
        toHost: new URL(current).hostname,
      });
      continue;
    }

    if (!response.ok) {
      return { kind: "failed", reason: `download returned HTTP ${String(response.status)}` };
    }

    // `content-length` is a hint, not a guarantee — it can be absent or lie.
    // Checked first as a cheap early refusal, and enforced again while
    // reading, which is the check that actually holds.
    const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    if (Number.isInteger(declared) && declared > maxBytes) {
      return {
        kind: "refused",
        reason: `file is ${String(declared)} bytes; the limit is ${String(maxBytes)}`,
      };
    }

    const body = await readCapped(response, maxBytes);
    if ("refused" in body) return { kind: "refused", reason: body.refused };
    if ("failed" in body) return { kind: "failed", reason: body.failed };

    logInfo("attachment downloaded", {
      host: checked.url.hostname,
      bytes: body.bytes.byteLength,
      redirects: hop,
    });
    return {
      kind: "fetched",
      file: {
        name: file.name,
        bytes: body.bytes,
        contentType: response.headers.get("content-type"),
      },
    };
  }

  return { kind: "failed", reason: `more than ${String(MAX_REDIRECTS)} redirects` };
}

/**
 * Reads the body, stopping at the cap.
 *
 * Streams rather than `arrayBuffer()`: the point of a cap is not to allocate
 * the oversized thing before rejecting it. A body that lied in
 * `content-length` is caught here.
 */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<
  | { readonly bytes: Uint8Array }
  | { readonly refused: string }
  | { readonly failed: string }
> {
  const stream = response.body;
  if (stream === null) return { failed: "download had no body" };

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return {
          refused: `file exceeded the ${String(maxBytes)} byte limit while downloading`,
        };
      }
      chunks.push(value);
    }
  } catch (error) {
    return { failed: error instanceof Error ? error.message : "read failed" };
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes: out };
}

export interface IngestResult {
  readonly fetched: readonly FetchedFile[];
  /** Files we saw and could not get, by name — so the skill is told the truth. */
  readonly unavailable: readonly { readonly name: string; readonly reason: string }[];
}

/**
 * Classifies every attachment on a turn and fetches the ones that can be
 * fetched. Never throws: a message with one good file and one bad one still
 * delivers the good one.
 */
export async function ingestAttachments(
  attachments: readonly unknown[] | undefined,
  options: FetchOptions,
): Promise<IngestResult> {
  const fetched: FetchedFile[] = [];
  const unavailable: { name: string; reason: string }[] = [];

  for (const attachment of attachments ?? []) {
    const classified = classifyAttachment(attachment);
    if (classified.kind === "not_a_file") continue;
    if (classified.kind === "needs_graph") {
      // NOT silently skipped. This bot holds no Graph permission
      // (`requiredResourceAccess: []`, verified against the tenant), so a
      // channel-scoped file is genuinely unreachable — and saying so beats a
      // skill that reports "no documents were attached" about a document the
      // user watched themselves upload.
      logWarn("attachment needs Graph and this bot has no Graph permission", {
        reason: "channel/SharePoint reference, no pre-authorised downloadUrl",
      });
      unavailable.push({
        name: classified.name,
        reason: "the bot cannot read files shared in a channel yet",
      });
      continue;
    }

    const outcome = await fetchAttachment(classified, options);
    if (outcome.kind === "fetched") {
      fetched.push(outcome.file);
      continue;
    }
    // The REASON is logged, never the URL that produced it.
    logWarn("attachment download did not complete", {
      kind: outcome.kind,
      reason: outcome.reason,
    });
    unavailable.push({ name: classified.name, reason: outcome.reason });
  }

  return { fetched, unavailable };
}
