/**
 * The deadline, WITH ITS OFFSET — the one field in the intake form that
 * cannot be collected by asking for it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE PROBLEM
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `new-bid.mjs` refuses a deadline that carries no explicit timezone offset,
 * and it is right to: a tender closing "5pm on the 15th" is a different
 * instant in Perth and in Sydney, and getting it wrong by two hours loses the
 * bid rather than producing a visible error.
 *
 * An Adaptive Card `Input.Date` returns `YYYY-MM-DD` and an `Input.Time`
 * returns `HH:MM`. NEITHER carries an offset, and there is no card input that
 * does. So the offset has to come from somewhere else, and the candidates are
 * all worse than they look:
 *
 *   the bot's own clock   — the VM is in whatever region Azure put it in.
 *                           Reading a customer's tender deadline off our
 *                           server's `TZ` is a fact about our hosting.
 *   the Teams client      — not sent. `activity.localTimezone` exists in the
 *                           schema and is absent in practice on the surfaces
 *                           we have measured; building on it is the
 *                           `Action.Execute` mistake again.
 *   a fixed offset list   — "+10:00" is right for Brisbane all year and right
 *                           for Sydney for half of it. A user choosing
 *                           "AEST (+10:00)" for a January deadline is off by
 *                           an hour, and nothing tells them.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT WE DO INSTEAD
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The user picks a PLACE, not an offset. The offset is then DERIVED for the
 * specific instant they chose, through the platform's own tz database. Perth
 * in January and Sydney in January give different answers, and Sydney in
 * January and Sydney in July give different answers, without the user having
 * to know that DST exists.
 *
 * A missing offset is therefore impossible rather than discouraged: there is
 * no path through {@link resolveDeadline} that returns a timestamp without
 * one. An unknown or unselected zone is a validation failure, not a default.
 */

/**
 * The zones offered. Deliberately SHORT.
 *
 * A picker of 400 IANA zones is unusable in a card, and this is a bid
 * deadline rather than a calendar app — the set of jurisdictions Altra tenders
 * into is small and known. Adding one is a row here.
 *
 * `UTC` is included last and only for the case where a tender document itself
 * states a UTC deadline. It is NOT a fallback: nothing selects it implicitly.
 */
export const DEADLINE_TIME_ZONES: readonly {
  readonly id: string;
  readonly label: string;
}[] = [
  { id: "Australia/Perth", label: "Perth (WA)" },
  { id: "Australia/Adelaide", label: "Adelaide (SA/NT)" },
  { id: "Australia/Brisbane", label: "Brisbane (QLD)" },
  { id: "Australia/Sydney", label: "Sydney / Melbourne / Canberra / Hobart" },
  { id: "Pacific/Auckland", label: "Auckland (NZ)" },
  { id: "UTC", label: "UTC" },
];

export function isKnownTimeZone(id: string): boolean {
  return DEADLINE_TIME_ZONES.some((zone) => zone.id === id);
}

/**
 * The zone's offset from UTC, in minutes, AT A GIVEN INSTANT.
 *
 * "At a given instant" is the whole point — a zone does not have an offset,
 * an instant in a zone does. Returns `null` when the platform does not know
 * the zone, which is treated as a validation failure by the caller rather
 * than as zero.
 *
 * Reads the offset out of `Intl` rather than shipping a tz table: the
 * platform already has one, it is kept current by the runtime, and a table
 * copied into this file would be wrong the first time a government moved a
 * DST boundary.
 */
export function zoneOffsetMinutes(
  timeZone: string,
  instantMs: number,
): number | null {
  let formatted: string;
  try {
    formatted =
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "longOffset",
      })
        .formatToParts(new Date(instantMs))
        .find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    // `Intl` throws `RangeError` on an unknown zone. That is a real answer —
    // we cannot resolve an offset — and it must not become 0.
    return null;
  }
  // `GMT` with nothing after it is how `longOffset` renders a zero offset.
  if (formatted === "GMT" || formatted === "UTC") return 0;
  const match = /^(?:GMT|UTC)([+-])(\d{2}):(\d{2})$/.exec(formatted);
  if (match === null) return null;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

/** `+08:00`, `-03:30`, `+00:00` — never a bare `Z`, because the tool wants an offset. */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

export type DeadlineField = "date" | "time" | "timeZone";

export type DeadlineResult =
  | {
      readonly kind: "ok";
      /** `2026-09-15T17:00:00+08:00` — an offset is present by construction. */
      readonly iso: string;
      /** Milliseconds since epoch, for comparisons the caller wants to make. */
      readonly instantMs: number;
      readonly offset: string;
    }
  | {
      readonly kind: "invalid";
      readonly field: DeadlineField;
      readonly message: string;
    };

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
/** `Input.Time` emits `HH:MM`; seconds are accepted because some clients add them. */
const TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

export interface DeadlineInput {
  readonly date: string;
  readonly time: string;
  readonly timeZone: string;
  /** Now, injected — a deadline already past is refused. See below. */
  readonly nowMs: number;
}

export function resolveDeadline(input: DeadlineInput): DeadlineResult {
  const date = DATE_PATTERN.exec(input.date.trim());
  if (date === null) {
    return {
      kind: "invalid",
      field: "date",
      message: "Pick the date the tender closes.",
    };
  }
  const time = TIME_PATTERN.exec(input.time.trim());
  if (time === null) {
    return {
      kind: "invalid",
      field: "time",
      message: "Pick the time it closes, e.g. 17:00.",
    };
  }
  const zone = input.timeZone.trim();
  if (!isKnownTimeZone(zone)) {
    // NOT defaulted. A silently assumed zone is exactly the missing offset
    // this file exists to prevent, dressed as a present one.
    return {
      kind: "invalid",
      field: "timeZone",
      message: "Choose which time zone that deadline is in.",
    };
  }

  const year = Number(date[1]);
  const month = Number(date[2]);
  const day = Number(date[3]);
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  const second = time[3] === undefined ? 0 : Number(time[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return {
      kind: "invalid",
      field: "date",
      message: "That isn't a real date.",
    };
  }
  if (hour > 23 || minute > 59 || second > 59) {
    return {
      kind: "invalid",
      field: "time",
      message: "That isn't a real time.",
    };
  }

  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  // Round-trip guard: `Date.UTC` happily rolls 31 February into 3 March, and
  // a deadline silently moved by two days is precisely the class of failure
  // this whole field is about.
  const roundTrip = new Date(naive);
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    return {
      kind: "invalid",
      field: "date",
      message: "That isn't a real date.",
    };
  }

  /*
   * TWO PASSES, and the second one is the correct answer.
   *
   * We hold a WALL CLOCK time and need the instant it denotes, but the offset
   * we must subtract depends on the instant we are trying to find. So: guess
   * the offset by asking what it is at the same numbers read as UTC, apply
   * it, and ask again at the resulting instant. The second reading is taken
   * within an hour or so of the true instant, which is enough to land on the
   * right side of every DST boundary except one that falls inside the
   * correction itself.
   *
   * At a DST boundary a wall time can be ambiguous (it happens twice) or
   * nonexistent (it is skipped). This resolves to a definite instant in both
   * cases rather than refusing — a 2am tender deadline on a changeover
   * Sunday is not a real scenario, and refusing a legitimate deadline is a
   * worse failure than an hour's ambiguity on one that is not.
   */
  const firstGuess = zoneOffsetMinutes(zone, naive);
  if (firstGuess === null) {
    return {
      kind: "invalid",
      field: "timeZone",
      message: "Choose which time zone that deadline is in.",
    };
  }
  const instantMs = naive - firstGuess * 60_000;
  const offsetMinutes = zoneOffsetMinutes(zone, instantMs) ?? firstGuess;
  const trueInstantMs = naive - offsetMinutes * 60_000;

  if (trueInstantMs <= input.nowMs) {
    /*
     * REFUSED, deliberately, and this is a judgement worth recording.
     *
     * The realistic failure is a mistyped year — 2025 for 2026 — which
     * produces a bid whose whole schedule is wrong and which nothing
     * downstream would question. The cost of the refusal is that an
     * opportunity cannot be registered after its close, which is not a thing
     * anyone starts an assessment for.
     */
    return {
      kind: "invalid",
      field: "date",
      message: "That deadline has already passed — check the date.",
    };
  }

  const offset = formatOffset(offsetMinutes);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return {
    kind: "ok",
    iso: `${date[1]}-${date[2]}-${date[3]}T${pad(hour)}:${pad(minute)}:${pad(second)}${offset}`,
    instantMs: trueInstantMs,
    offset,
  };
}
