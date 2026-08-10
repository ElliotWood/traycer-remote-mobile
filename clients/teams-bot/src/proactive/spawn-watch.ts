/**
 * The real `bridge watch` child, and the line splitter it needs.
 *
 * Separate from `watch-runner.ts` so the runner's lifecycle — backoff, the
 * serial queue, the restart rule — is testable with no child process at all.
 * What is left here is a spawn and a buffer, and the buffer has its own test
 * because it is the one place a notification can be silently mangled.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY LINE ASSEMBLY IS NOT INCIDENTAL
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `child.stdout` emits CHUNKS, not lines. A chunk boundary can fall anywhere,
 * including the middle of a JSON object. Handing chunks straight to
 * `parseWatchLine` would produce `malformed` for a perfectly good event that
 * happened to be split across a pipe read — and the failure would be
 * intermittent, load-dependent, and would look like the bridge emitting
 * garbage.
 *
 * So a partial tail is held until its newline arrives. It is NOT parsed
 * optimistically, and it is NOT discarded on exit without a mention: a
 * remainder sitting in the buffer when the process dies is an event that was
 * half-written, and saying so beats dropping it silently.
 */
import { spawn } from "node:child_process";
import type { SpawnWatchFn, WatchProcess } from "./watch-runner";

/**
 * Splits a stream of chunks into complete lines, holding any partial tail.
 *
 * A tiny class rather than a closure because the leftover is state with a
 * lifetime, and naming it makes the "what happens to the remainder" question
 * answerable rather than hidden in a captured `let`.
 */
export class LineBuffer {
  private buffered = "";

  /** Every COMPLETE line in this chunk. The tail is kept for next time. */
  push(chunk: string): readonly string[] {
    this.buffered += chunk;
    const parts = this.buffered.split("\n");
    // The last element is either "" (the chunk ended on a newline) or a
    // partial line. Either way it is not ready.
    this.buffered = parts.pop() ?? "";
    // `\r` is stripped so a CRLF-emitting producer does not turn every line
    // into malformed JSON. The bridge writes `\n`, but this is a pipe from
    // another process and assuming its line ending is how a Windows-hosted
    // bridge would break every event with no error anywhere.
    return parts.map((line) => line.replace(/\r$/, ""));
  }

  /** What is still held, or `""`. Read on exit so a truncated line is visible. */
  remainder(): string {
    return this.buffered;
  }
}

export const nodeSpawnWatchFn: SpawnWatchFn = (
  command,
  args,
  options,
  handlers,
): WatchProcess => {
  const child = spawn(command, args as string[], {
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const buffer = new LineBuffer();
  let exited = false;

  child.stdout?.on("data", (chunk: Buffer) => {
    for (const line of buffer.push(chunk.toString("utf8"))) {
      handlers.onLine(line);
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    handlers.onStderr(chunk.toString("utf8"));
  });

  const finish = (code: number | null): void => {
    if (exited) return;
    exited = true;
    const tail = buffer.remainder().trim();
    if (tail.length > 0) {
      // Reported, not parsed. A half-written line is not an event, and
      // guessing at one is how a truncated payload becomes a wrong
      // notification.
      handlers.onStderr(
        `bridge watch exited holding an incomplete line (${String(tail.length)} chars)`,
      );
    }
    handlers.onExit(code);
  };

  // `error` fires when the binary is missing or not executable — the most
  // likely misconfiguration, and one that never emits `exit`. Reported as a
  // null exit code so the runner's backoff treats it like any other failure.
  child.on("error", () => {
    finish(null);
  });
  child.on("exit", (code) => {
    finish(code);
  });

  return {
    kill(): void {
      // SIGTERM: `runWatch` installs a handler for it and resolves cleanly.
      child.kill("SIGTERM");
    },
  };
};
