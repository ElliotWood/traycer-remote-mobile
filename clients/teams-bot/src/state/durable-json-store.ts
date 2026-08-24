/**
 * A small durable key/value store on disk, for state that must outlive the
 * process.
 *
 * WHY THIS EXISTS NOW. `read-surface/epic-binding-store.ts` is in-memory and
 * says so plainly, and it named this ticket:
 *
 *   "a real deployment needs a persisted store (same shape of problem T4's
 *    proactive conversation-reference store will need, likely the same
 *    mechanism) … Do not let this implementation quietly become 'the'
 *    persistence layer by accretion; replace it deliberately when T4 needs a
 *    real one."
 *
 * This is that deliberate replacement, built once so both callers use it.
 *
 * WHAT IT PROTECTS AGAINST
 *
 * A partial write. The whole point of the store is that an assessment started
 * on Monday can be answered on Tuesday, possibly after a redeploy — and we
 * redeploy this bot by replacing a bundle and restarting it, which is exactly
 * when a half-written file would be created. Every write goes to a temp file
 * in the same directory and is then `rename`d over the target, which is
 * atomic on POSIX. A crash leaves either the old file or the new one, never
 * a truncated one.
 *
 * Reads tolerate a missing or unparseable file by returning empty rather than
 * throwing. A bot that will not start because its state file is corrupt is a
 * worse outcome than one that has forgotten a conversation.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface DurableStoreOptions {
  /** Absolute path to the JSON file backing this store. */
  readonly filePath: string;
  /** Called when a read fails in a way worth knowing about. */
  readonly onWarn?: (message: string, detail: string) => void;
}

/**
 * File mode 0600.
 *
 * A conversation reference carries a tenant id, a service URL and a user's
 * Entra object id. That is not a credential, but it is not something to leave
 * world-readable on a shared host either, and this host has other tenants'
 * directories on it.
 */
const FILE_MODE = 0o600;

export class DurableJsonStore<T> {
  private readonly filePath: string;
  private readonly onWarn: (message: string, detail: string) => void;
  /** Written through to disk on every mutation; read on construction. */
  private cache: Record<string, T>;

  constructor(options: DurableStoreOptions) {
    this.filePath = options.filePath;
    this.onWarn = options.onWarn ?? ((): void => {});
    this.cache = this.load();
  }

  private load(): Record<string, T> {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch {
      // Absent is the normal first-run case, not a problem.
      return {};
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        this.onWarn(
          "state file is not a JSON object — starting empty",
          this.filePath,
        );
        return {};
      }
      return parsed as Record<string, T>;
    } catch (error) {
      // Do NOT throw. A corrupt state file must not stop the bot booting.
      this.onWarn(
        "state file could not be parsed — starting empty",
        error instanceof Error ? error.message : String(error),
      );
      return {};
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    // Temp file in the SAME directory: `rename` is only atomic within a
    // filesystem, and /tmp is frequently a different one.
    const temp = join(
      dirname(this.filePath),
      `.${String(process.pid)}.${String(this.writes)}.tmp`,
    );
    writeFileSync(temp, JSON.stringify(this.cache), { mode: FILE_MODE });
    renameSync(temp, this.filePath);
    this.writes += 1;
  }

  /** Distinguishes temp files within one process, so two writes cannot collide. */
  private writes = 0;

  get(key: string): T | null {
    return this.cache[key] ?? null;
  }

  set(key: string, value: T): void {
    this.cache = { ...this.cache, [key]: value };
    this.persist();
  }

  delete(key: string): void {
    if (!(key in this.cache)) return;
    const next = { ...this.cache };
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete next[key];
    this.cache = next;
    this.persist();
  }

  keys(): readonly string[] {
    return Object.keys(this.cache);
  }
}
