/**
 * stderr-only diagnostic logger. stdout is reserved for the bridge's
 * payload output (see each adapter's own contract) — every log line, at
 * every level, goes to stderr so nothing here can pollute a channel
 * adapter's stdout-based protocol.
 *
 * Redaction patterns mirror `clients/traycer-cli/src/logger.ts` (bearer
 * tokens, `token=`/`secret=`/... key-value pairs) — duplicated rather than
 * imported since this package must not depend on `clients/traycer-cli`.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const SENSITIVE_TEXT_PATTERNS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly replacement: string;
}> = [
  {
    pattern: /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
    replacement: "Bearer [redacted]",
  },
  {
    pattern:
      /((?:access[_-]?token|accessToken|refresh[_-]?token|refreshToken|token|authorization|password|secret|cookie|code[_-]?verifier|codeVerifier|api[_-]?key|apiKey)\s*[:=]\s*)("[^"]*"|'[^']*'|[^&\s,}]+)/gi,
    replacement: "$1[redacted]",
  },
];

export function redact(text: string): string {
  let result = text;
  for (const { pattern, replacement } of SENSITIVE_TEXT_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export interface ILogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>, error?: Error): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function createLogger(threshold: LogLevel = "info"): ILogger {
  const write = (
    level: LogLevel,
    message: string,
    fields: Record<string, unknown> | undefined,
    error: Error | undefined,
  ): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[threshold]) return;
    const line = {
      timestamp: new Date().toISOString(),
      level,
      message: redact(message),
      ...(fields !== undefined ? { fields: redact(JSON.stringify(fields)) } : {}),
      ...(error !== undefined
        ? { error: { name: error.name, message: redact(error.message) } }
        : {}),
    };
    process.stderr.write(`${JSON.stringify(line)}\n`);
  };

  return {
    debug: (message, fields) => write("debug", message, fields, undefined),
    info: (message, fields) => write("info", message, fields, undefined),
    warn: (message, fields) => write("warn", message, fields, undefined),
    error: (message, fields, error) => write("error", message, fields, error),
  };
}
