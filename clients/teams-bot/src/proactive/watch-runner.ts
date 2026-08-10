/**
 * THE MISSING CALLER.
 *
 * Every other file in `proactive/` was built, tested, and never invoked:
 * `grep -rn "watchLine|startWatch|watch(" clients/teams-bot/src` outside tests
 * returned nothing. The producer existed too — `bridge watch` prints one JSON
 * line per change in what is waiting on a human. Both ends were finished and
 * the wire between them was never run, which is why Elliot reports that no
 * approval has ever reached Teams.
 *
 * This is that wire: spawn the watcher, read its stdout a line at a time, and
 * hand each parsed event to `pushWatchEvent`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE LIFECYCLE RULE, WHICH IS THE ONLY HARD PART
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `bridge watch`'s de-duplication tracker is PROCESS-LIFETIME. Every spawn
 * starts with an empty tracker, so its first tick sees every currently-pending
 * approval as new and announces all of them as `appeared`.
 *
 * That is not a bug to work around — **it is the reconnect snapshot**, and it
 * is what makes "do not lose events across a restart" free. Anything that
 * started waiting while this bot was down is announced the moment the watcher
 * comes back, because from a fresh tracker's point of view it has just
 * appeared.
 *
 * The cost is that it is ALSO a full replay, on every single respawn. That is
 * what the durable sent-set in `proactive-store.ts` is for, and the two guards
 * are not redundant: the bridge's tracker suppresses repeats within one
 * process, ours suppresses repeats across processes. Neither can do the
 * other's job. Together they give: notify once per thing that is waiting,
 * however many times either process restarts.
 *
 * So the rule this file implements is deliberately NOT "remember where we got
 * to". There is no cursor, no offset, no last-seen id — a cursor would have to
 * be advanced before or after handling, and both orders are wrong in the way
 * `push-notifications.ts` documents. Instead: **replay everything, suppress on
 * a durable set keyed by an id the producer derives rather than mints.** The
 * event id is `approval.requested:<chatId>:<approvalId>`, stable across a
 * restart of either process, which is the property the whole scheme rests on.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EVENTS ARE HANDLED ONE AT A TIME, ON PURPOSE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `pushWatchEvent` reads the sent-set, sends, then writes the sent-set.
 * Running two of those concurrently on the same event id — which a burst of
 * lines from one tick makes easy — interleaves the read and the write and
 * sends twice. So lines are queued onto a promise chain and drained in order.
 * Throughput is irrelevant here; a human is the consumer.
 */
import { parseWatchLine, type WatchEvent } from "./watch-line";

/** A running `bridge watch` child, as this file needs to see it. */
export interface WatchProcess {
  kill(): void;
}

export interface WatchProcessHandlers {
  /** One complete stdout line, newline stripped. */
  readonly onLine: (line: string) => void;
  /** The bridge logs to stderr; it is diagnostic, never events. */
  readonly onStderr: (chunk: string) => void;
  readonly onExit: (code: number | null) => void;
}

/**
 * Injected so every branch below is testable with no child process.
 *
 * Deliberately NOT `OneShotSpawnFn`: that captures all output and resolves on
 * exit, which for a long-running watcher means the events arrive only once the
 * process has died. `bridge-cli.ts`'s own docblock already says the watch path
 * needs a different mechanism.
 */
export type SpawnWatchFn = (
  command: string,
  args: readonly string[],
  options: { readonly env: NodeJS.ProcessEnv },
  handlers: WatchProcessHandlers,
) => WatchProcess;

/**
 * Restart delays, in order, then the last one repeats.
 *
 * Starts fast because the common exit is a transient host blip and a human is
 * waiting; ends slow because the other common exit is a misconfiguration that
 * will never succeed, and a tight respawn loop against Bot Service or a host
 * is how a deployment gets throttled. Reset to the front once a run has lasted
 * {@link HEALTHY_RUN_MS}.
 */
export const RESTART_DELAYS_MS: readonly number[] = [
  1_000, 5_000, 15_000, 60_000, 300_000,
];

/**
 * A run that lasted this long counts as healthy, so the NEXT failure starts
 * the backoff from the beginning.
 *
 * Without this, a watcher that runs happily for a week and then hits one blip
 * would wait five minutes to come back, because the backoff index never went
 * home. With it, sustained failure still backs off and recovered failure
 * forgets.
 */
export const HEALTHY_RUN_MS = 60_000;

export interface WatchRunnerDeps {
  /** Absolute path to the bridge binary — never resolved via PATH. */
  readonly command: string;
  readonly epicId: string;
  /**
   * The tenant env for the watching principal, rebuilt per attempt.
   *
   * Per attempt, not once: it carries a token that expires, and this process
   * is meant to run for weeks. `null` means identity could not be resolved —
   * which is a REFUSAL, not a retry-forever: see the handling below.
   */
  readonly buildEnv: () => Promise<NodeJS.ProcessEnv | null>;
  readonly spawnWatch: SpawnWatchFn;
  /** Where a parsed event goes. Awaited, one at a time. */
  readonly onEvent: (event: WatchEvent) => Promise<void>;
  readonly onInfo: (message: string, detail: string) => void;
  readonly onWarn: (message: string, detail: string) => void;
  /** Injected so tests advance time instead of waiting. */
  readonly schedule: (fn: () => void, ms: number) => { cancel: () => void };
  readonly now: () => number;
}

export interface WatchRunner {
  /** Idempotent: a second call while running is a no-op, not a second child. */
  start(): void;
  /** Stops the child and cancels any pending restart. Safe to call twice. */
  stop(): void;
  /** Test/diagnostic view. Never used to decide anything. */
  readonly state: () => "stopped" | "starting" | "running" | "waiting";
}

export function createWatchRunner(deps: WatchRunnerDeps): WatchRunner {
  let stopped = true;
  let child: WatchProcess | null = null;
  let pendingRestart: { cancel: () => void } | null = null;
  let failureCount = 0;
  let startedAt = 0;
  let phase: "stopped" | "starting" | "running" | "waiting" = "stopped";

  /**
   * The serial queue. Every line's handling is chained onto the previous
   * one's completion — see the header on why concurrency here sends twice.
   *
   * A handler that throws must not break the chain: it is caught and the next
   * line still runs. An event lost is one missed notification; a dead chain is
   * every future notification.
   */
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (event: WatchEvent): void => {
    queue = queue.then(async () => {
      try {
        await deps.onEvent(event);
      } catch (error) {
        deps.onWarn(
          "proactive event handler threw — notification lost",
          `eventId=${event.eventId} error=${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  };

  const handleLine = (line: string): void => {
    const parsed = parseWatchLine(line);
    switch (parsed.kind) {
      case "blank":
        return;
      case "malformed":
        // NOT a quiet `continue`. The bridge said something this bot cannot
        // read, which means somebody is blocked and will never be told —
        // `watch-line.ts` exists to keep these two cases apart.
        deps.onWarn(
          "unreadable line from bridge watch — a notification may be lost",
          parsed.detail,
        );
        return;
      case "event":
        enqueue(parsed.event);
        return;
    }
  };

  const scheduleRestart = (reason: string): void => {
    if (stopped) return;
    const ranFor = deps.now() - startedAt;
    if (ranFor >= HEALTHY_RUN_MS) failureCount = 0;
    const delay =
      RESTART_DELAYS_MS[Math.min(failureCount, RESTART_DELAYS_MS.length - 1)];
    failureCount += 1;
    phase = "waiting";
    deps.onWarn(
      "bridge watch stopped — restarting",
      `reason=${reason} ranForMs=${String(ranFor)} delayMs=${String(delay)} attempt=${String(failureCount)}`,
    );
    pendingRestart = deps.schedule(() => {
      pendingRestart = null;
      void launch();
    }, delay);
  };

  const launch = async (): Promise<void> => {
    if (stopped) return;
    phase = "starting";

    const env = await deps.buildEnv();
    if (env === null) {
      /*
       * Identity could not be resolved. Backed off like any other failure
       * rather than abandoned, because the realistic cause is a token that
       * has expired and will be refreshed — and abandoning would mean a bot
       * that silently stops notifying forever after one blip, which is the
       * failure being fixed rather than a new one.
       *
       * It is LOUD every time, because the other realistic cause is that SSO
       * is not configured and no notification will ever be sent.
       */
      scheduleRestart("no tenant environment — identity unresolved");
      return;
    }
    if (stopped) return;

    startedAt = deps.now();
    phase = "running";
    deps.onInfo("watching for approvals", `epicId=${deps.epicId}`);

    child = deps.spawnWatch(
      deps.command,
      ["watch", "--epic-id", deps.epicId],
      { env },
      {
        onLine: handleLine,
        onStderr: (chunk) => {
          const trimmed = chunk.trim();
          // The bridge's own logger. Diagnostic, never events — recorded so a
          // watcher that is failing to read a chat is visible, rather than
          // discarded because it is not on the happy path.
          if (trimmed.length > 0) {
            deps.onInfo("bridge watch stderr", trimmed.slice(0, 500));
          }
        },
        onExit: (code) => {
          child = null;
          // A watcher that exits 0 has still stopped watching. There is no
          // "clean" exit for a process whose whole job is to not stop.
          scheduleRestart(`exit code ${code === null ? "null" : String(code)}`);
        },
      },
    );
  };

  return {
    start(): void {
      if (!stopped) return;
      stopped = false;
      failureCount = 0;
      void launch();
    },
    stop(): void {
      stopped = true;
      phase = "stopped";
      pendingRestart?.cancel();
      pendingRestart = null;
      // Killing triggers `onExit`, which returns early because `stopped` is
      // already true. Order matters: setting the flag first is what stops a
      // deliberate shutdown from scheduling a restart.
      child?.kill();
      child = null;
    },
    state: () => phase,
  };
}
