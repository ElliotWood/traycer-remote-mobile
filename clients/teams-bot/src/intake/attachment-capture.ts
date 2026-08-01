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
 * Documentation has already been wrong on this project today — `Action.Execute`
 * is documented as supported and silently sends no invoke on Teams mobile, and
 * Adaptive Cards 1.5 is documented as supported and rendered as
 * "cards.unsupported" on desktop. So this logs the RAW object and lets the
 * real client answer.
 *
 * WHY THE WHOLE OBJECT, not selected fields. We do not yet know which fields
 * matter — that is the question. Logging a summary would encode a guess about
 * the answer and then confirm it, which is the failure mode this project has
 * hit repeatedly: a check that is true about a neighbouring question.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS IS DELIBERATELY NOISY AND DELIBERATELY TEMPORARY.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * It is gated on `TRAYCER_TEAMS_LOG_RAW_ATTACHMENTS`, off by default, because
 * an attachment payload can carry a customer's file name and a tenant-scoped
 * URL. Turn it on, have someone send one file in each scope, read the shapes,
 * turn it off. It should not survive R2.
 *
 * `content` is included because that is where the download info lives — and it
 * is exactly why this must not be left on: a `downloadUrl` is a pre-authorised
 * link to a customer document, in a log file.
 */
import { logInfo, logWarn } from "../logger";

export const RAW_ATTACHMENT_LOG_FLAG = "TRAYCER_TEAMS_LOG_RAW_ATTACHMENTS";

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

  logWarn("RAW ATTACHMENT CAPTURE IS ON — this logs customer file metadata", {
    flag: RAW_ATTACHMENT_LOG_FLAG,
    count: attachments.length,
  });

  attachments.forEach((attachment, index) => {
    let serialised: string;
    try {
      serialised = JSON.stringify(attachment);
    } catch (error) {
      // A circular or otherwise unserialisable payload is itself a finding.
      serialised = `<unserialisable: ${
        error instanceof Error ? error.message : String(error)
      }>`;
    }
    logInfo("raw attachment", {
      index,
      conversationType: input.conversationType ?? "unknown",
      attachment: serialised,
    });
  });

  return attachments.length;
}
