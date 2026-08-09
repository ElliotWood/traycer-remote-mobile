import { describe, expect, it } from "vitest";
import {
  BUYER_INPUT_ID,
  DEADLINE_DATE_INPUT_ID,
  DEADLINE_TIME_INPUT_ID,
  JURISDICTION_INPUT_ID,
  OWNER_INPUT_ID,
  SLUG_INPUT_ID,
  TIME_ZONE_INPUT_ID,
  parseIntakeForm,
  readIntakeFormValues,
  type IntakeFormValues,
} from "../intake-form";

const NOW = Date.UTC(2026, 0, 1);

const GOOD: IntakeFormValues = {
  slug: "acme-water-rfp",
  buyer: "Acme Water Corporation",
  deadlineDate: "2026-09-15",
  deadlineTime: "17:00",
  timeZone: "Australia/Perth",
  jurisdiction: "local",
  owner: "Elliot Wood",
};

function fieldsWithErrors(values: IntakeFormValues): readonly string[] {
  const result = parseIntakeForm(values, NOW);
  return result.kind === "invalid"
    ? result.errors.map((error) => error.field)
    : [];
}

describe("intake form — the five fields new-bid.mjs needs", () => {
  it("CONTRACT: a complete form yields exactly the five fields, fully", () => {
    const result = parseIntakeForm(GOOD, NOW);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // The WHOLE object, not field by field. A field-by-field assertion only
    // covers fields somebody thought of, and the defect being closed here is
    // a field that never reached the agent.
    expect(result.details).toEqual({
      slug: "acme-water-rfp",
      buyer: "Acme Water Corporation",
      deadline: "2026-09-15T17:00:00+08:00",
      jurisdiction: "local",
      owner: "Elliot Wood",
    });
  });

  it("CONTRACT: every empty field is reported at once, not one per round-trip", () => {
    // A form that reports one problem at a time is five round-trips for a
    // user who left it blank, each one a new card in the chat log.
    const empty: IntakeFormValues = {
      slug: "",
      buyer: "",
      deadlineDate: "",
      deadlineTime: "",
      timeZone: "",
      jurisdiction: "",
      owner: "",
    };
    const fields = fieldsWithErrors(empty);
    expect(fields).toContain("slug");
    expect(fields).toContain("buyer");
    expect(fields).toContain("deadlineDate");
    expect(fields).toContain("jurisdiction");
    expect(fields).toContain("owner");
  });

  it("keeps what was typed, so a re-rendered form does not wipe the other fields", () => {
    const result = parseIntakeForm({ ...GOOD, slug: "NOT A SLUG" }, NOW);
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.values.buyer).toBe("Acme Water Corporation");
    expect(result.values.owner).toBe("Elliot Wood");
  });
});

describe("intake form — the slug is an identifier, not a label", () => {
  it("accepts lowercase words joined by single hyphens", () => {
    for (const slug of ["abc", "acme-water-rfp", "rfp2026", "a1-b2-c3"]) {
      expect(fieldsWithErrors({ ...GOOD, slug }), slug).toEqual([]);
    }
  });

  it("lowercases what the user typed rather than refusing it", () => {
    const result = parseIntakeForm({ ...GOOD, slug: "Acme-Water" }, NOW);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.details.slug).toBe("acme-water");
  });

  it("CONTRACT: refuses anything that could reach a shell, a path, or git as an option", () => {
    // The slug becomes a DIRECTORY and a BRANCH NAME. This repo has already
    // shipped a `--branch "-D"` that deleted a branch and reported success,
    // so a leading hyphen is not a hypothetical.
    const hostile = [
      "-D",
      "--upload-pack=x",
      "../escape",
      "a/b",
      "a\\b",
      "a b",
      "a;rm -rf /",
      "a$(id)",
      "a`id`",
      "a..b",
      "-",
      "acme-",
      "-acme",
      "acme--water",
    ];
    for (const slug of hostile) {
      expect(fieldsWithErrors({ ...GOOD, slug }), slug).toContain("slug");
    }
  });

  it("refuses a slug too short to name anything or too long for a branch", () => {
    expect(fieldsWithErrors({ ...GOOD, slug: "ab" })).toContain("slug");
    expect(fieldsWithErrors({ ...GOOD, slug: "a".repeat(49) })).toContain(
      "slug",
    );
  });
});

describe("intake form — the deadline and the owner", () => {
  it("CONTRACT: an unselected time zone fails the form", () => {
    // The one field a Teams date picker cannot supply. Defaulting it silently
    // is the missing offset dressed as a present one.
    expect(fieldsWithErrors({ ...GOOD, timeZone: "" })).toContain("timeZone");
  });

  it("CONTRACT: an emptied owner fails, prefill or no prefill", () => {
    // The card prefills whoever @-mentioned the bot, which is exactly why
    // this cannot be relaxed: a person can clear the field, and a bid with no
    // accountable human is worse than no bid.
    expect(fieldsWithErrors({ ...GOOD, owner: "" })).toContain("owner");
    expect(fieldsWithErrors({ ...GOOD, owner: "   " })).toContain("owner");
  });

  it("refuses a jurisdiction that is not a plain token", () => {
    expect(fieldsWithErrors({ ...GOOD, jurisdiction: "" })).toContain(
      "jurisdiction",
    );
    expect(fieldsWithErrors({ ...GOOD, jurisdiction: "New South Wales" })).toContain(
      "jurisdiction",
    );
  });
});

describe("intake form — reading a submitted card", () => {
  it("reads every input id the card emits, and trims them", () => {
    const values = readIntakeFormValues({
      [SLUG_INPUT_ID]: "  acme-water-rfp  ",
      [BUYER_INPUT_ID]: " Acme Water ",
      [DEADLINE_DATE_INPUT_ID]: "2026-09-15",
      [DEADLINE_TIME_INPUT_ID]: "17:00",
      [TIME_ZONE_INPUT_ID]: "Australia/Perth",
      [JURISDICTION_INPUT_ID]: "local",
      [OWNER_INPUT_ID]: " Elliot Wood ",
    });
    expect(values).toEqual({
      slug: "acme-water-rfp",
      buyer: "Acme Water",
      deadlineDate: "2026-09-15",
      deadlineTime: "17:00",
      timeZone: "Australia/Perth",
      jurisdiction: "local",
      owner: "Elliot Wood",
    });
  });

  it("treats a non-string value as absent rather than coercing it", () => {
    // The payload is relayed by Bot Service and is the same class of input as
    // `chatId`. `String(undefined)` would put "undefined" in a bid folder name.
    const values = readIntakeFormValues({
      [SLUG_INPUT_ID]: 42,
      [BUYER_INPUT_ID]: null,
    });
    expect(values.slug).toBe("");
    expect(values.buyer).toBe("");
  });
});
