/** Minimal stderr logger, mirroring clients/mobile-push-service's — never logs a raw Error/unknown object. */
export function logInfo(
  message: string,
  fields: Record<string, string | number | boolean>,
): void {
  write("info", message, fields);
}

export function logWarn(
  message: string,
  fields: Record<string, string | number | boolean>,
): void {
  write("warn", message, fields);
}

export function logError(
  message: string,
  fields: Record<string, string | number | boolean>,
): void {
  write("error", message, fields);
}

function write(
  level: "info" | "warn" | "error",
  message: string,
  fields: Record<string, string | number | boolean>,
): void {
  const suffix =
    Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
  process.stderr.write(`[teams-bot] ${level} ${message}${suffix}\n`);
}
