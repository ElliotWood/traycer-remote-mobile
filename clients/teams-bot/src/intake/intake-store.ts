/**
 * Where a fetched document lands so the skill can read it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY A LOCAL PATH IS THE WHOLE ANSWER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The bot and the Traycer host run on the SAME BOX, as the SAME OS USER.
 * That is not an assumption — `deploy/vm-deploy.sh` sets `User=traycer` on
 * the bot's unit precisely because the bot spawns `traycer-remote-bridge`,
 * which shares the host's credentials file. The agent the bot starts runs
 * under that host. So an absolute path written here is a path the skill's
 * agent can open, and no transport, upload, share link or object store is
 * needed to get a document from the bot to the skill.
 *
 * That is worth stating plainly because the alternatives all end in the same
 * place: a URL. A blob with a SAS, a share link, a tab endpoint that serves
 * the file — every one of them makes the customer's document reachable by
 * anyone holding a string, which is the one outcome this flow must not have.
 * The filesystem hands the skill the bytes and creates no new reachability at
 * all.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE INTAKE ID CROSSES A TRUST BOUNDARY. THE FILE NAME ALWAYS DID.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `intakeId` rides in an Adaptive Card's payload, so it comes back through
 * Bot Service as request data — the same class of input as `chatId`, which
 * `dispatch-action.ts` already validates rather than trusts. Here it is
 * joined into a FILESYSTEM PATH, so an unvalidated one is a traversal:
 * `../../../etc` as an intake id would have `resolve` read whatever sat
 * there. It is required to be a UUID, matched against a pattern, before it
 * is allowed near `join`.
 *
 * The file NAME is worse, because it never had a shape to check: it is
 * whatever the user called their file, relayed verbatim. It is sanitised to
 * a single path segment and re-checked after joining, so a name that
 * survives sanitising and still escapes the directory cannot be written.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { FetchedFile } from "./attachment-fetch";

/** One stored document, as the instruction will name it. */
export interface IntakeFile {
  /** The user's own file name, sanitised. What the skill sees in the prompt. */
  readonly name: string;
  /** Absolute. What the skill opens. */
  readonly path: string;
  readonly bytes: number;
}

export interface IntakeRecord {
  readonly intakeId: string;
  readonly files: readonly IntakeFile[];
  /** Files that arrived and could not be fetched — carried so the skill is told. */
  readonly unavailable: readonly { readonly name: string; readonly reason: string }[];
  readonly capturedAt: number;
}

export interface IntakeStore {
  put(input: {
    readonly fetched: readonly FetchedFile[];
    readonly unavailable: readonly { readonly name: string; readonly reason: string }[];
    readonly now: number;
  }): IntakeRecord;
  /** `null` for an unknown or malformed id — never a throw, never a guess. */
  get(intakeId: string): IntakeRecord | null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Length cap well under any filesystem's, leaving room for the directory prefix. */
const MAX_NAME_LENGTH = 120;

/**
 * A user's file name reduced to one safe path segment.
 *
 * Separators, `..`, control characters and leading dots all go. The
 * EXTENSION is deliberately preserved: the skill is being handed a `.pptx`
 * and the tool that opens it dispatches on the extension, so stripping it
 * would produce a file nothing can read — a "safe" name that breaks the
 * feature is not the trade being made here.
 */
export function sanitiseFileName(raw: string): string {
  const collapsed = raw
    // eslint-disable-next-line no-control-regex -- control chars are exactly what is being removed
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "_")
    // `:` and the Windows-reserved set: this repo is developed on Windows and
    // tested there, so a name that is legal on Linux and fatal on Windows
    // would fail only in the test suite, which is the worst place to find it.
    .replace(/[<>:"|?*]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  const capped = collapsed.slice(0, MAX_NAME_LENGTH).trim();
  // Everything removable was removed and nothing was left. A name is
  // required — the file still has to be written somewhere nameable.
  return capped.length > 0 ? capped : "document";
}

/**
 * Filesystem-backed store under a directory the deployment owns.
 *
 * Directories are created `0700` and files `0600`, so even on a box where
 * something else is served from a neighbouring path, the bytes are readable
 * only by the user that runs both the bot and the host. The mode is a no-op
 * on Windows and load-bearing on the Linux VM this deploys to.
 */
export class FileIntakeStore implements IntakeStore {
  private readonly root: string;

  /**
   * @param root Absolute directory. MUST NOT sit under anything a web server
   *   serves — the deployment puts it beside the conversation-reference store
   *   in the bot's private state directory, which nginx has no root in.
   */
  constructor(root: string) {
    this.root = resolve(root);
  }

  put(input: {
    readonly fetched: readonly FetchedFile[];
    readonly unavailable: readonly { readonly name: string; readonly reason: string }[];
    readonly now: number;
  }): IntakeRecord {
    // Unguessable by construction, which is the second half of the safety
    // story: even if the directory were somehow reachable, the id is not
    // enumerable. It is NOT relied on as the only control — the mode bits are.
    const intakeId = randomUUID();
    const dir = join(this.root, intakeId);
    // Documents live in their own subdirectory so a user's file called
    // `manifest.json` cannot overwrite the manifest. Sanitising makes that
    // name reachable, and a collision there would swap the record for the
    // document and lose both.
    const filesDir = join(dir, "files");
    mkdirSync(filesDir, { recursive: true, mode: 0o700 });

    const files: IntakeFile[] = [];
    const used = new Set<string>();
    for (const file of input.fetched) {
      // Two attachments called `report.pdf` must not silently become one.
      let name = sanitiseFileName(file.name);
      if (used.has(name)) {
        const dot = name.lastIndexOf(".");
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : "";
        let n = 2;
        while (used.has(`${stem} (${String(n)})${ext}`)) n++;
        name = `${stem} (${String(n)})${ext}`;
      }
      used.add(name);

      const path = join(filesDir, name);
      // The traversal backstop. `sanitiseFileName` should make this
      // unreachable; it is checked anyway because "should" is how the file
      // name got trusted in the first place. `filesDir` is already absolute
      // and normalised, so this is a plain equality on the parent directory.
      if (dirname(resolve(path)) !== filesDir) continue;
      writeFileSync(path, file.bytes, { mode: 0o600 });
      files.push({ name, path, bytes: file.bytes.byteLength });
    }

    const record: IntakeRecord = {
      intakeId,
      files,
      unavailable: input.unavailable,
      capturedAt: input.now,
    };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(record), {
      mode: 0o600,
    });
    return record;
  }

  get(intakeId: string): IntakeRecord | null {
    // BEFORE `join`. See the docblock — this id arrives from a card payload.
    if (!UUID_PATTERN.test(intakeId)) return null;
    try {
      const raw = readFileSync(join(this.root, intakeId, "manifest.json"), "utf8");
      const parsed: unknown = JSON.parse(raw);
      return isIntakeRecord(parsed) ? parsed : null;
    } catch {
      // Absent, unreadable or corrupt. All mean the same thing to the caller:
      // there is no document to hand the skill, and it must say so rather
      // than start an assessment claiming one.
      return null;
    }
  }
}

function isIntakeRecord(value: unknown): value is IntakeRecord {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["intakeId"] === "string" &&
    Array.isArray(record["files"]) &&
    Array.isArray(record["unavailable"]) &&
    typeof record["capturedAt"] === "number"
  );
}
