/**
 * G2 — attachments become BYTES ON DISK, and the agent is told where.
 *
 * `attachment-capture.ts` next door measures the SHAPE of an arriving
 * attachment and downloads nothing; that was the right thing to build first
 * and it is not this. Before this file, `buildInstruction` said "2 documents
 * attached" and gave no path, so an agent asked to assess a tender had no way
 * to reach the tender.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS DOES NOT DO, AND WHY
 * ─────────────────────────────────────────────────────────────────────────
 *
 * It does NOT run `new-bid.mjs`, and it does not write into
 * `Sales/rfp/bids/<slug>/source/`. Scaffolding a bid is the skill's job — its
 * SKILL.md instructs the agent to run the tool and land the documents "exactly
 * as supplied". Two consequences of writing there ourselves: the bot would
 * break the moment the pipeline reorganises its directories, and a directory
 * the pipeline validates would have a second author.
 *
 * So the bot stages the files somewhere it owns and puts the ABSOLUTE PATH in
 * the instruction. The skill decides where they belong.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SCOPE: PERSONAL CHAT ONLY, AND IT SAYS SO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A personal chat delivers `application/vnd.microsoft.teams.file.download.info`
 * carrying a `downloadUrl` we can GET directly. A CHANNEL delivers a
 * SharePoint reference, which needs a Graph token and a driveItem fetch —
 * different auth, different build, not this one.
 *
 * The channel path therefore FAILS LOUDLY. It would otherwise stage zero
 * files and start an assessment that reads nothing, which is the worst
 * available outcome: a confident answer about a document nobody read.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DOWNLOAD URL IS A CREDENTIAL
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A Teams `downloadUrl` carries its authorisation IN THE QUERY STRING. It is
 * never logged, never put in a card payload, and never echoed to the user —
 * the same line `attachment-capture.ts` holds, for the same reason. What is
 * logged here is counts and outcomes; what is shown to the user is file names
 * they already chose.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { logInfo, logWarn } from "../logger";

export const STAGING_DIR_ENV = "TRAYCER_TEAMS_STAGING_DIR";
export const STATE_DIR_ENV = "TRAYCER_TEAMS_STATE_DIR";

/**
 * Where staged documents live.
 *
 * Follows the same precedence the conversation-reference store uses, so an
 * operator who has set `TRAYCER_TEAMS_STATE_DIR` does not have to discover a
 * second variable. The final fallback matches that store's own default rather
 * than `$HOME`: the bot's `$HOME` on the VM is `/srv/traycer/tenants`, NOT
 * `/srv/traycer`, and assuming otherwise has already caused one bug here.
 */
export function stagingRootFromEnv(env: NodeJS.ProcessEnv): string {
  const explicit = env[STAGING_DIR_ENV]?.trim();
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const stateDir = env[STATE_DIR_ENV]?.trim();
  if (stateDir !== undefined && stateDir.length > 0) {
    return path.posix.join(stateDir, "intake");
  }
  return "/srv/traycer/teams-bot/state/intake";
}

/**
 * A staging id is a UUID and is checked as one BEFORE it is joined to a path.
 *
 * It travels in a card payload that Bot Service relays and that a client can
 * therefore influence. Joining an unchecked value to the staging root is a
 * path traversal; this is the boundary that stops it, and it is a whitelist
 * rather than a `..` blacklist because `..` is not the only way.
 */
const STAGING_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isStagingId(value: string): boolean {
  return STAGING_ID_PATTERN.test(value);
}

/** `null` for anything that is not a well-formed id — never a joined path. */
export function stagingDirectory(root: string, id: string): string | null {
  return isStagingId(id) ? path.posix.join(root, id) : null;
}

/**
 * A file name that is safe to write and that the pipeline can keep AS SUPPLIED.
 *
 * REJECTED, not sanitised. The skill lands documents "exactly as supplied", so
 * a bot that quietly renames `Schedule A.pdf` has broken the contract it was
 * built to feed — and a rename is unreviewable, whereas a refusal names the
 * file and puts a human in the loop. Teams itself forbids `/` and `\` in file
 * names, so nothing legitimate is being turned away.
 */
const MAX_NAME_LENGTH = 200;

export function isSafeFileName(name: string): boolean {
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  // A name that is nothing but dots is `.`, `..`, or a curiosity. None of them
  // are a document.
  if (/^\.+$/.test(name)) return false;
  // Control characters, including the NUL a path API would truncate on.
  // Checked by code point rather than by a regex literal: an escape typed
  // into a source file can land as a REAL control byte, which turns the file
  // binary and the check into a no-op that every gate still passes.
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/** 100 MB. A tender is a document; anything larger is a mistake or an attack. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export type ClassifiedAttachment =
  /** Personal chat: a direct, pre-authorised download. */
  | { readonly kind: "file"; readonly name: string; readonly downloadUrl: string }
  /** Channel/group: a SharePoint reference. Needs Graph; not built. */
  | { readonly kind: "needs-graph"; readonly name: string }
  /** Looks like a file and is missing what we would need to fetch it. */
  | { readonly kind: "unreadable"; readonly name: string }
  /** Teams attaches the message's own HTML body. Not a document. */
  | { readonly kind: "not-a-file" };

const DOWNLOAD_INFO_CONTENT_TYPE =
  "application/vnd.microsoft.teams.file.download.info";

/**
 * `contentType` — read case-insensitively AND under both spellings.
 *
 * The wire has used `contentType` and `contenttype` across SDK versions;
 * `attachment-capture.ts` records the same finding and compares lower-cased
 * for the same reason. Reading only one spelling would classify every file in
 * one scope as "not a file" and stage nothing, silently.
 */
function readField(
  record: Record<string, unknown>,
  ...names: readonly string[]
): string | null {
  const lowered = new Map<string, unknown>();
  for (const [key, value] of Object.entries(record)) {
    lowered.set(key.toLowerCase(), value);
  }
  for (const name of names) {
    const value = lowered.get(name.toLowerCase());
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

export function classifyAttachment(raw: unknown): ClassifiedAttachment {
  if (raw === null || typeof raw !== "object") return { kind: "not-a-file" };
  const record = raw as Record<string, unknown>;
  const contentType = (readField(record, "contentType") ?? "").toLowerCase();
  const name = readField(record, "name", "fileName") ?? "";

  if (contentType === DOWNLOAD_INFO_CONTENT_TYPE) {
    const content = record["content"];
    const downloadUrl =
      content !== null && typeof content === "object"
        ? readField(content as Record<string, unknown>, "downloadUrl")
        : null;
    if (downloadUrl === null || !/^https:\/\//i.test(downloadUrl)) {
      // A file attachment we cannot fetch. NOT `not-a-file`: the user
      // attached something and it must not vanish from the count.
      return { kind: "unreadable", name };
    }
    return { kind: "file", name, downloadUrl };
  }

  // Channel and group scope. `reference` is the documented shape; the host
  // check catches a SharePoint link arriving under some other contentType,
  // because the consequence of missing one is staging nothing and saying
  // nothing.
  const contentUrl = readField(record, "contentUrl");
  const isSharePoint =
    contentUrl !== null && /^https:\/\/[^/]*sharepoint\.com\//i.test(contentUrl);
  if (contentType === "reference" || isSharePoint) {
    return { kind: "needs-graph", name };
  }

  return { kind: "not-a-file" };
}

export interface StagedFile {
  readonly name: string;
  readonly bytes: number;
}

export type StagingOutcome =
  /** No document attachments on the message at all. A valid intake. */
  | { readonly kind: "none" }
  | {
      readonly kind: "staged";
      readonly stagingId: string;
      readonly directory: string;
      readonly files: readonly StagedFile[];
    }
  /**
   * A refusal, with the user-facing reason already in the user's language.
   * ALL-OR-NOTHING: a partial stage would run an assessment against some of a
   * tender, which reads as a complete answer.
   */
  | { readonly kind: "refused"; readonly reason: string };

export interface StagingDeps {
  readonly stagingRoot: string;
  /** Injected so tests never touch the network. */
  readonly fetchImpl: typeof fetch;
  readonly mkdirImpl?: (dir: string) => Promise<void>;
  readonly writeFileImpl?: (file: string, data: Uint8Array) => Promise<void>;
  readonly newId?: () => string;
}

/**
 * Downloads every document on the message into a fresh directory.
 *
 * A FRESH DIRECTORY PER MESSAGE, named by a UUID. That answers the retry
 * question without a lock: pressing "yes" twice, or re-sending the files,
 * stages into a new directory rather than half-overwriting the first, and no
 * later intake can collide with an earlier one.
 *
 * Within a single message, two files sharing a name are REFUSED. The
 * pipeline's own `assemble-bundle` treats a basename collision as a hard
 * failure that only a human rename can fix; inventing `Tender (2).pdf` here
 * would push that same collision one stage downstream while destroying the
 * "exactly as supplied" property on the way.
 */
export async function stageAttachments(
  attachments: readonly unknown[] | undefined,
  deps: StagingDeps,
): Promise<StagingOutcome> {
  const classified = (attachments ?? []).map(classifyAttachment);
  const files = classified.filter(
    (item): item is Extract<ClassifiedAttachment, { kind: "file" }> =>
      item.kind === "file",
  );
  const needsGraph = classified.filter((item) => item.kind === "needs-graph");
  const unreadable = classified.filter((item) => item.kind === "unreadable");

  if (needsGraph.length > 0) {
    logWarn("attachment in a scope this bot cannot fetch from", {
      count: needsGraph.length,
      // The NAMES are the customer's; the count and the fact are ours.
      scope: "sharepoint-reference",
    });
    return {
      kind: "refused",
      reason:
        "Files posted in a channel are stored in SharePoint, and I can't read those yet. Send them to me in a direct message instead.",
    };
  }
  if (unreadable.length > 0) {
    return {
      kind: "refused",
      reason:
        "One of those attachments arrived without a way for me to download it. Try attaching it again.",
    };
  }
  if (files.length === 0) return { kind: "none" };

  for (const file of files) {
    if (!isSafeFileName(file.name)) {
      return {
        kind: "refused",
        reason:
          "One of those file names has characters I can't write to disk. Rename it and attach it again.",
      };
    }
  }
  const names = new Set<string>();
  for (const file of files) {
    if (names.has(file.name)) {
      return {
        kind: "refused",
        reason: `Two of those files are both called “${file.name}”. Rename one and attach them again — the bid pack can't hold two documents with the same name.`,
      };
    }
    names.add(file.name);
  }

  const stagingId = (deps.newId ?? randomUUID)();
  const directory = stagingDirectory(deps.stagingRoot, stagingId);
  if (directory === null) {
    // Only reachable if `newId` is overridden with something that is not a
    // UUID — a test seam, not a runtime path. Refuse rather than join it.
    return { kind: "refused", reason: "I couldn't create a place to put them." };
  }

  const mkdirImpl = deps.mkdirImpl ?? defaultMkdir;
  const writeFileImpl = deps.writeFileImpl ?? defaultWriteFile;

  try {
    await mkdirImpl(directory);
  } catch {
    logWarn("could not create staging directory", { directory });
    return { kind: "refused", reason: "I couldn't create a place to put them." };
  }

  const staged: StagedFile[] = [];
  for (const file of files) {
    let bytes: Uint8Array;
    try {
      const response = await deps.fetchImpl(file.downloadUrl);
      if (!response.ok) {
        // The STATUS is ours to log. The URL is not — it is the credential.
        logWarn("attachment download rejected", { status: response.status });
        return {
          kind: "refused",
          reason:
            "I couldn't download one of those files from Teams. Try attaching it again.",
        };
      }
      const declared = Number(response.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) {
        return { kind: "refused", reason: tooLarge(file.name) };
      }
      bytes = new Uint8Array(await response.arrayBuffer());
      // Checked again after reading: a missing or lying `content-length` is
      // not a reason to accept an unbounded body.
      if (bytes.byteLength > MAX_FILE_BYTES) {
        return { kind: "refused", reason: tooLarge(file.name) };
      }
    } catch {
      logWarn("attachment download failed", { staged: staged.length });
      return {
        kind: "refused",
        reason:
          "I couldn't download one of those files from Teams. Try attaching it again.",
      };
    }

    try {
      await writeFileImpl(path.posix.join(directory, file.name), bytes);
    } catch {
      logWarn("could not write staged attachment", { directory });
      return {
        kind: "refused",
        reason: "I couldn't save one of those files. Nothing has been started.",
      };
    }
    staged.push({ name: file.name, bytes: bytes.byteLength });
  }

  logInfo("attachments staged", {
    count: staged.length,
    totalBytes: staged.reduce((sum, file) => sum + file.bytes, 0),
    // The directory is ours, not the customer's, and it is the one thing that
    // makes a support question answerable.
    directory,
  });
  return { kind: "staged", stagingId, directory, files: staged };
}

function tooLarge(name: string): string {
  return `“${name}” is larger than ${String(MAX_FILE_BYTES / (1024 * 1024))} MB, which is more than I can stage.`;
}

/**
 * `0o700` on the directory and `0o600` on the files. These are customer
 * tender documents on a shared VM, and the default umask would leave them
 * world-readable.
 *
 * `recursive: true` so a first run does not depend on the deploy having
 * created the root. The mode applies to the leaves it creates; an operator
 * pre-creating the root should still chmod it, which is in the deploy notes.
 */
async function defaultMkdir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

async function defaultWriteFile(file: string, data: Uint8Array): Promise<void> {
  // `wx` — fail if it exists. Within one message duplicates are already
  // refused above; this makes a collision from any other cause loud rather
  // than a silent overwrite of a customer document.
  await writeFile(file, data, { mode: 0o600, flag: "wx" });
}

/**
 * What is ACTUALLY on disk in a staging directory, read at dispatch time.
 *
 * The names also travel in the card payload, and this is deliberately not
 * that: telling an agent a path exists is a claim, and this is the only place
 * that can check it. `null` means the directory is not there — a staging id
 * that expired, was cleaned up, or never existed.
 */
export async function listStagedFiles(
  directory: string,
): Promise<readonly string[] | null> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return null;
  }
}
