/**
 * Minimal stderr logger. Deliberately takes only primitive/string fields —
 * never a raw `Error`/`unknown` object — so a caller can't accidentally log
 * something that turns out to carry the VAPID private key (verification §13c
 * checks stdout/stderr across a full send cycle for exactly this).
 */
export function logInfo(message: string, fields: Record<string, string | number | boolean> = {}): void {
  write("info", message, fields);
}

export function logWarn(message: string, fields: Record<string, string | number | boolean> = {}): void {
  write("warn", message, fields);
}

export function logError(message: string, fields: Record<string, string | number | boolean> = {}): void {
  write("error", message, fields);
}

function write(
  level: "info" | "warn" | "error",
  message: string,
  fields: Record<string, string | number | boolean>,
): void {
  const suffix = Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
  process.stderr.write(`[push-service] ${level} ${message}${suffix}\n`);
}
