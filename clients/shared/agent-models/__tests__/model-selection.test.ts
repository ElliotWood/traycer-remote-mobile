/**
 * Every fixture is built by PARSING through `guiAgentModelOptionSchema`, not
 * by writing an object literal shaped like it. Two reasons, both concrete:
 * the schema supplies `.default([])` / `.default(null)` for the service-tier
 * pair (a literal would have to restate them and could restate them wrongly),
 * and a fixture the host could never actually send would otherwise sail
 * through and "prove" behaviour on a shape that does not exist.
 *
 * The cases here are drawn from a live host, not invented: 420 models across
 * 11 harnesses, of which 20 advertise NO reasoning efforts, 342 carry a
 * non-null `defaultReasoningEffort` and 78 do not — including every Claude
 * model. That last group is why `unsupportedValue + nullDefault` has its own
 * test: the M1 ticket describes the clamp as "fall back to
 * `defaultReasoningEffort`" and stops there, which on those 78 models would
 * leave an unsupported effort unclamped and emit it.
 */
import { describe, expect, it } from "vitest";
import {
  guiAgentModelOptionSchema,
  type GuiAgentModelOption,
} from "@traycer/protocol/host/agent/gui/unary-schemas";
import {
  findReasoningLabel,
  findReasoningOptionsForModel,
  findUpgradeServiceTierForModel,
  normalizeReasoningForModel,
  normalizeServiceTierForModel,
} from "../model-selection";

function model(overrides: Record<string, unknown>): GuiAgentModelOption {
  return guiAgentModelOptionSchema.parse({
    harnessId: "claude",
    slug: "test-model",
    label: "Test Model",
    description: null,
    contextWindow: null,
    maxOutputTokens: null,
    defaultReasoningEffort: null,
    supportedReasoningEfforts: [],
    metadata: {},
    ...overrides,
  });
}

const EFFORTS = [
  { id: "low", label: "Low", description: null },
  { id: "medium", label: "Medium", description: null },
  { id: "high", label: "High", description: null },
];

describe("normalizeReasoningForModel", () => {
  it("passes the value through untouched while the catalogue is still resolving", () => {
    // `null` model = catalogue in flight. Clamping here would overwrite a
    // sticky preference on first paint, before the model is even known.
    expect(normalizeReasoningForModel("high", null)).toBe("high");
  });

  it("returns '' for a model that advertises NO efforts, so the control hides", () => {
    // Live case, not hypothetical: Claude's `haiku` is exactly this.
    const haikuLike = model({ supportedReasoningEfforts: [] });
    expect(normalizeReasoningForModel("high", haikuLike)).toBe("");
  });

  it("keeps a value the model still supports", () => {
    const m = model({ supportedReasoningEfforts: EFFORTS });
    expect(normalizeReasoningForModel("medium", m)).toBe("medium");
  });

  it("falls back to the model's declared default when the carried value is unsupported", () => {
    const m = model({
      supportedReasoningEfforts: EFFORTS,
      defaultReasoningEffort: "medium",
    });
    expect(normalizeReasoningForModel("extra-high", m)).toBe("medium");
  });

  it("falls back to the FIRST option when the carried value is unsupported and the model declares no default", () => {
    // THE BRANCH M1's PROSE OMITS. 78 of 420 live models (every Claude one)
    // report `defaultReasoningEffort: null`; an implementation written to the
    // ticket's wording alone would return the unsupported value here and emit
    // it on the turn, breaking the ticket's own "no unsupported effort is ever
    // emitted" guarantee.
    const m = model({
      supportedReasoningEfforts: EFFORTS,
      defaultReasoningEffort: null,
    });
    expect(normalizeReasoningForModel("extra-high", m)).toBe("low");
  });

  it("ignores a declared default that is not itself one of the options", () => {
    // A host that advertises a default outside its own option set must not
    // cause an unselectable value to be emitted.
    const m = model({
      supportedReasoningEfforts: EFFORTS,
      defaultReasoningEffort: "ludicrous",
    });
    expect(normalizeReasoningForModel("extra-high", m)).toBe("low");
  });

  it("never returns a value outside the model's options, across every input", () => {
    // The ticket's actual guarantee, asserted as a property rather than as
    // three examples that happen to hold.
    const m = model({ supportedReasoningEfforts: EFFORTS, defaultReasoningEffort: null });
    const ids = EFFORTS.map((e) => e.id);
    for (const input of ["low", "medium", "high", "extra-high", "", "MAX", "  high  "]) {
      expect(ids).toContain(normalizeReasoningForModel(input, m));
    }
  });
});

describe("findReasoningOptionsForModel / findReasoningLabel", () => {
  it("reports no options for a null model", () => {
    expect(findReasoningOptionsForModel(null)).toEqual([]);
  });

  it("renders the HOST's label, not a client-side guess", () => {
    expect(findReasoningLabel("medium", EFFORTS)).toBe("Medium");
  });

  it("falls back to the raw id when the host sends a level it did not describe", () => {
    expect(findReasoningLabel("mystery", EFFORTS)).toBe("mystery");
  });
});

describe("findUpgradeServiceTierForModel", () => {
  it("is null when the model advertises no tiers", () => {
    expect(findUpgradeServiceTierForModel(model({}))).toBeNull();
  });

  it("skips the model's DEFAULT tier rather than taking index 0", () => {
    // The whole point of this helper. `supportedServiceTiers[0]` here is the
    // ordinary tier; picking it would light up a "Fast" toggle that requests
    // the speed the model already runs at.
    const m = model({
      defaultServiceTier: "standard",
      supportedServiceTiers: [
        { id: "standard", label: "Standard", description: null },
        { id: "fast", label: "Fast", description: null },
      ],
    });
    expect(findUpgradeServiceTierForModel(m)?.id).toBe("fast");
  });

  it("falls through to the first option when the model declares no default", () => {
    // Live: `defaultServiceTier` was null on all 420 models probed, so this
    // — not the branch above — is the path that actually runs today.
    const m = model({
      defaultServiceTier: null,
      supportedServiceTiers: [{ id: "fast", label: "Fast", description: null }],
    });
    expect(findUpgradeServiceTierForModel(m)?.id).toBe("fast");
  });

  it("falls through to the first option when every advertised tier IS the default", () => {
    const m = model({
      defaultServiceTier: "only",
      supportedServiceTiers: [{ id: "only", label: "Only", description: null }],
    });
    expect(findUpgradeServiceTierForModel(m)?.id).toBe("only");
  });
});

describe("normalizeServiceTierForModel", () => {
  it("passes through while the catalogue is resolving", () => {
    expect(normalizeServiceTierForModel("fast", null)).toBe("fast");
  });

  it("clears a tier carried over from a model that does not advertise it", () => {
    // Codex's "priority" must not leak onto a Claude model whose upgrade is
    // "fast" — that would record a tier the turn never ran under.
    const claudeLike = model({
      supportedServiceTiers: [{ id: "fast", label: "Fast", description: null }],
    });
    expect(normalizeServiceTierForModel("priority", claudeLike)).toBe("");
  });

  it("keeps the tier when it IS this model's upgrade", () => {
    const m = model({
      supportedServiceTiers: [{ id: "fast", label: "Fast", description: null }],
    });
    expect(normalizeServiceTierForModel("fast", m)).toBe("fast");
  });

  it("clears any tier on a model that advertises none", () => {
    expect(normalizeServiceTierForModel("fast", model({}))).toBe("");
  });
});
