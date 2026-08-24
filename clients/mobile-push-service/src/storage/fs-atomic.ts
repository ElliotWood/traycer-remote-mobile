import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Reads and JSON-parses a file, returning `null` on a missing file or invalid
 * JSON (both treated as "no persisted state yet" by every caller here — this
 * store is best-effort local cache, not a durable ledger with a recovery
 * story). Any other I/O error (EACCES, EIO, ...) throws, so a genuinely
 * unreadable file surfaces rather than silently behaving like "empty".
 */
export async function readJsonFileOrNull<T>(path: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if (errorCode(err) === "ENOENT") return null;
    throw err;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Atomically writes JSON to `path`: parent dir ensured at 0700, temp file
 * written + chmod 0600, then renamed into place. Mirrors the credentials
 * file's write discipline (`protocol/src/config/credentials.ts`) minus the
 * mutation-lock/WAL machinery that file needs and this single-writer,
 * single-process store does not.
 */
export async function writeJsonFileAtomic(
  path: string,
  data: unknown,
): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => {});
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(tmp, 0o600).catch(() => {});
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

function errorCode(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}
