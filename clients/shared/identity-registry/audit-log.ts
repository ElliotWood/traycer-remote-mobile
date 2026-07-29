import type { RefusalReason } from "./types";

const MAX_LOGGED_INPUT_LENGTH = 64;

export interface AuditLogEntry {
  readonly direction: "forward" | "reverse";
  readonly outcome: "resolved" | "refused";
  readonly reason: RefusalReason | null;
  readonly input: string;
  readonly timestampMs: number;
}

export type AuditSink = (line: string) => void;

/** Diagnostics-only convention this repo already follows (`remote-bridge`'s CLI: "every diagnostic goes to stderr"). Never stdout — a channel adapter piping this process's output must not see audit noise mixed into a protocol stream. */
export const defaultAuditSink: AuditSink = (line: string) => {
  process.stderr.write(`${line}\n`);
};

/**
 * Strips ASCII control characters (0x00-0x1F, 0x7F — this removes `\n`,
 * `\r`, and the ESC byte that begins any ANSI escape sequence) and caps
 * length. Applied ONLY to refusal-path input, which is by definition
 * unvalidated and attacker-controlled: an unstripped, unbounded value here
 * is a log-injection vector (forged records via embedded newlines,
 * corrupted terminal output via ANSI escapes, log-volume amplification via
 * a multi-kilobyte string) reaching A6's log aggregator. A resolved-path
 * input already matched a configured tenant, so it's known-shape and safe
 * to log raw.
 */
export function sanitizeForLog(raw: string): string {
  let stripped = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) {
      stripped += ch;
    }
  }
  return stripped.length > MAX_LOGGED_INPUT_LENGTH
    ? `${stripped.slice(0, MAX_LOGGED_INPUT_LENGTH)}...(truncated)`
    : stripped;
}

export function emitAuditLine(sink: AuditSink, entry: AuditLogEntry): void {
  const safeInput =
    entry.outcome === "refused" ? sanitizeForLog(entry.input) : entry.input;
  sink(JSON.stringify({ ...entry, input: safeInput }));
}
