/**
 * G1 — the five fields `new-bid.mjs` needs, and the rules that make them
 * usable.
 *
 * WHY A FORM AND NOT A CONFIRM BUTTON. `classify` yields product × intent,
 * which is enough to choose a skill and nothing more. The pipeline's entry
 * point takes a slug, a buyer, a deadline, a jurisdiction and a named owner,
 * and it refuses without them. So the confirm step had to become the place
 * those are collected — and, incidentally, the place someone notices they
 * attached last quarter's tender.
 *
 * VALIDATION HAPPENS HERE, NOT IN THE CARD.
 *
 * Adaptive Cards 1.3 has `isRequired`/`errorMessage`, and we emit 1.2 because
 * Teams rendered 1.5 as "cards.unsupported" on desktop. Even at 1.3 it would
 * not be the guard: `Action.Submit` fires whether or not the user filled
 * anything in — the same property that forced the composer's empty-message
 * check and the interview's unanswered check. Client-side validation on a
 * surface we do not control is a hint. This is the gate.
 */
import { resolveDeadline, type DeadlineResult } from "./deadline";

/**
 * Input ids. Prefixed so they cannot collide with the composer's
 * `messageText` or an interview's `answer_0` if two cards are ever merged.
 */
export const SLUG_INPUT_ID = "intakeSlug";
export const BUYER_INPUT_ID = "intakeBuyer";
export const DEADLINE_DATE_INPUT_ID = "intakeDeadlineDate";
export const DEADLINE_TIME_INPUT_ID = "intakeDeadlineTime";
export const TIME_ZONE_INPUT_ID = "intakeTimeZone";
export const JURISDICTION_INPUT_ID = "intakeJurisdiction";
export const OWNER_INPUT_ID = "intakeOwner";

/** What `new-bid.mjs` is given. Every field is required; none has a default. */
export interface OpportunityDetails {
  readonly slug: string;
  readonly buyer: string;
  /** ISO 8601 WITH an explicit offset — see `./deadline`. */
  readonly deadline: string;
  readonly jurisdiction: string;
  readonly owner: string;
}

/** The raw strings a submitted card carries, echoed back on a re-render. */
export interface IntakeFormValues {
  readonly slug: string;
  readonly buyer: string;
  readonly deadlineDate: string;
  readonly deadlineTime: string;
  readonly timeZone: string;
  readonly jurisdiction: string;
  readonly owner: string;
}

export type IntakeField = keyof IntakeFormValues;

export interface IntakeFieldError {
  readonly field: IntakeField;
  readonly message: string;
}

export type IntakeFormResult =
  | { readonly kind: "ok"; readonly details: OpportunityDetails }
  | {
      readonly kind: "invalid";
      readonly errors: readonly IntakeFieldError[];
      /** What they typed, so the re-rendered form does not wipe the other five fields. */
      readonly values: IntakeFormValues;
    };

/**
 * The slug becomes a DIRECTORY NAME and a GIT BRANCH NAME (`feature/<initials>/<slug>`,
 * enforced by the sensormine repo's CI). So it is not a label with a
 * convention, it is an identifier that reaches a shell and a filesystem.
 *
 * Lowercase alphanumerics and single interior hyphens, nothing else. That
 * excludes, without needing a rule per case: path separators and `..`; a
 * leading `-`, which a git subcommand would read as an option — this repo has
 * already shipped a `--branch "-D"` that deleted a branch and reported
 * success; whitespace; and anything a shell would reinterpret if the value
 * ever stops being passed as its own argv element.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MIN = 3;
const SLUG_MAX = 48;

/**
 * Same shape as the slug, and for a weaker reason: `jurisdiction` is a token
 * the pipeline stores rather than one it executes. The contract's only worked
 * example is `local`.
 *
 * UNVERIFIED: nothing here has read `new-bid.mjs`'s accepted values, so this
 * accepts any short token rather than inventing an enum. If the tool has a
 * fixed list, this should become that list and this comment should go.
 */
const JURISDICTION_PATTERN = /^[a-z][a-z0-9-]{0,30}$/;

/** A buyer and an owner are free text, but a card is not a document. */
const NAME_MAX = 120;

function read(
  data: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const value = data[key];
  return typeof value === "string" ? value.trim() : "";
}

/** The raw values off a submitted card, before any judgement about them. */
export function readIntakeFormValues(
  data: Readonly<Record<string, unknown>>,
): IntakeFormValues {
  return {
    slug: read(data, SLUG_INPUT_ID),
    buyer: read(data, BUYER_INPUT_ID),
    deadlineDate: read(data, DEADLINE_DATE_INPUT_ID),
    deadlineTime: read(data, DEADLINE_TIME_INPUT_ID),
    timeZone: read(data, TIME_ZONE_INPUT_ID),
    jurisdiction: read(data, JURISDICTION_INPUT_ID),
    owner: read(data, OWNER_INPUT_ID),
  };
}

/**
 * EVERY field is checked before returning, rather than stopping at the first
 * failure. A form that reports one problem per round-trip is five round-trips
 * for a user who mistyped two things, on a surface where each round-trip is a
 * new card in a chat log.
 */
export function parseIntakeForm(
  raw: IntakeFormValues,
  nowMs: number,
): IntakeFormResult {
  const errors: IntakeFieldError[] = [];

  // TRIMMED HERE, not only in `readIntakeFormValues`. This is the gate, and a
  // gate that depends on its caller having cleaned the input is one call site
  // away from letting an owner of `"   "` through — a bid with a whitespace
  // string where the accountable human should be.
  const values: IntakeFormValues = {
    slug: raw.slug.trim(),
    buyer: raw.buyer.trim(),
    deadlineDate: raw.deadlineDate.trim(),
    deadlineTime: raw.deadlineTime.trim(),
    timeZone: raw.timeZone.trim(),
    jurisdiction: raw.jurisdiction.trim(),
    owner: raw.owner.trim(),
  };

  const slug = values.slug.toLowerCase();
  if (slug.length === 0) {
    errors.push({ field: "slug", message: "Give the bid a short name." });
  } else if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) {
    errors.push({
      field: "slug",
      message: `Use between ${String(SLUG_MIN)} and ${String(SLUG_MAX)} characters.`,
    });
  } else if (!SLUG_PATTERN.test(slug)) {
    errors.push({
      field: "slug",
      message:
        "Lowercase letters, numbers and hyphens only — it becomes a folder and a branch name.",
    });
  }

  if (values.buyer.length === 0) {
    errors.push({ field: "buyer", message: "Who is the customer?" });
  } else if (values.buyer.length > NAME_MAX) {
    errors.push({
      field: "buyer",
      message: `Keep it under ${String(NAME_MAX)} characters.`,
    });
  }

  const deadline: DeadlineResult = resolveDeadline({
    date: values.deadlineDate,
    time: values.deadlineTime,
    timeZone: values.timeZone,
    nowMs,
  });
  if (deadline.kind === "invalid") {
    errors.push({
      field:
        deadline.field === "date"
          ? "deadlineDate"
          : deadline.field === "time"
            ? "deadlineTime"
            : "timeZone",
      message: deadline.message,
    });
  }

  const jurisdiction = values.jurisdiction.toLowerCase();
  if (jurisdiction.length === 0) {
    errors.push({
      field: "jurisdiction",
      message: "Which jurisdiction does this tender sit in?",
    });
  } else if (!JURISDICTION_PATTERN.test(jurisdiction)) {
    errors.push({
      field: "jurisdiction",
      message: "Lowercase letters, numbers and hyphens only — e.g. local.",
    });
  }

  /*
   * The owner is a NAMED ACCOUNTABLE HUMAN, and the card prefills whoever
   * @-mentioned the bot. That prefill is why this check cannot be relaxed to
   * "non-empty": a person can clear the field, and an empty owner on a bid
   * whose whole point is that a person decided it is worse than no bid at
   * all. It is also why the prefill is a VALUE rather than a silent default —
   * the field is on screen, filled in, and can be replaced.
   */
  if (values.owner.length === 0) {
    errors.push({
      field: "owner",
      message: "Name the person accountable for this bid.",
    });
  } else if (values.owner.length > NAME_MAX) {
    errors.push({
      field: "owner",
      message: `Keep it under ${String(NAME_MAX)} characters.`,
    });
  }

  if (errors.length > 0 || deadline.kind !== "ok") {
    return { kind: "invalid", errors, values };
  }

  return {
    kind: "ok",
    details: {
      slug,
      buyer: values.buyer,
      deadline: deadline.iso,
      jurisdiction,
      owner: values.owner,
    },
  };
}
