/**
 * R4 — which skill should handle this, or should we ask?
 *
 * WHAT THIS IS AND, MORE IMPORTANTLY, WHAT IT IS NOT.
 *
 * This is a ROUTER. It decides which Traycer skill receives the work. It does
 * not assess the opportunity, judge product fit, or answer anything — all of
 * that is the skill's job, and the spec is explicit that the substance lives
 * there.
 *
 * The spec's open question was whether classification belongs in an agent or
 * in the bot, and it leaned agent-side to avoid putting product knowledge in
 * the client. That concern is real and this respects it: the knowledge here is
 * deliberately shallow — product NAMES and intent PHRASINGS, the vocabulary of
 * addressing, not of assessing. A new product is a row in a table. If routing
 * ever needs to understand a document to decide, that is the signal it has
 * outgrown this file and belongs in an agent.
 *
 * CLASSIFY ON TEXT, NOT ON DOCUMENTS. The intent is in the question — "does
 * this work with SensorMine" routes on its own words. The attachments are
 * input to the ASSESSMENT, not to the routing. That is why this ships before
 * R2 rather than behind it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE ASYMMETRY THAT SHAPES EVERYTHING BELOW
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Guessing wrong costs more than asking. A wrong skill on a customer RFP
 * spends real agent time and can produce a branded document answering a
 * question nobody asked. Asking costs one tap.
 *
 * So this REFUSES TO GUESS: it routes only when it has independent evidence of
 * BOTH a product and an intent. One signal is never enough, however strong it
 * looks. Everything else returns `uncertain` with a best guess for the card to
 * offer as a button — which is both the safe behaviour and the "bot-like
 * suggestion" the product asked for. The two goals coincide here; where they
 * ever diverge, safety wins.
 */

export type ProductId = "sensormine" | "dr-migrate";
export type IntentId =
  | "new-opportunity"
  | "product-query"
  | "feature-request"
  | "support";

export interface SkillRoute {
  readonly product: ProductId;
  readonly intent: IntentId;
  /** `null` when we know the route but no skill is built for it yet. */
  readonly skill: string | null;
}

/**
 * Product vocabulary. Names and their realistic spellings, nothing more.
 *
 * Kept as data so adding DR Migrate — or the next product — is a row rather
 * than a branch. This is the extensibility the roadmap depends on: a new
 * product must not be a new bot.
 */
const PRODUCT_TERMS: ReadonlyArray<{
  readonly product: ProductId;
  readonly terms: readonly string[];
}> = [
  { product: "sensormine", terms: ["sensormine", "sensor mine", "smv4", "sm v4"] },
  {
    product: "dr-migrate",
    terms: ["dr migrate", "dr-migrate", "drmigrate", "dr_migrate"],
  },
];

/**
 * Intent vocabulary.
 *
 * ORDER MATTERS: the first match wins, and the list runs most-specific first.
 * "can we support this RFP" contains "support" but is an opportunity, so
 * opportunity phrasings are tested before support ones. That ordering is
 * load-bearing and has its own test.
 */
const INTENT_TERMS: ReadonlyArray<{
  readonly intent: IntentId;
  readonly terms: readonly string[];
}> = [
  {
    intent: "new-opportunity",
    terms: [
      "rfi",
      "rfp",
      "tender",
      "does this work with",
      "does this fit",
      "match fit",
      "can we do this",
      "can we deliver",
      "opportunity",
      "bid",
    ],
  },
  {
    intent: "feature-request",
    terms: ["feature request", "can you add", "would be good if", "roadmap"],
  },
  {
    intent: "support",
    terms: ["not working", "broken", "error", "bug", "support ticket", "issue with"],
  },
  {
    intent: "product-query",
    terms: ["how does", "what is", "does it have", "can it", "question about"],
  },
];

/** Which routes have a skill built. Absent means "route known, skill not built". */
const SKILLS: ReadonlyArray<{
  readonly product: ProductId;
  readonly intent: IntentId;
  readonly skill: string;
}> = [
  {
    product: "sensormine",
    intent: "new-opportunity",
    skill: "smv4-new-opportunity",
  },
];

export type Classification =
  | { readonly kind: "routed"; readonly route: SkillRoute }
  /**
   * Not confident enough to spend agent time. `suggestion` is what the card
   * offers as a button — a question, not a decision.
   */
  | {
      readonly kind: "uncertain";
      readonly suggestion: SkillRoute | null;
      readonly reason: "no-product" | "no-intent" | "nothing-recognised";
    };

export interface ClassifyInput {
  /** Mention-stripped text — see `./mention`. */
  readonly text: string;
  /** Informs the ASSESSMENT, never the routing. Recorded for the card's wording. */
  readonly hasAttachments: boolean;
}

function findProduct(lower: string): ProductId | null {
  for (const entry of PRODUCT_TERMS) {
    if (entry.terms.some((term) => lower.includes(term))) return entry.product;
  }
  return null;
}

function findIntent(lower: string): IntentId | null {
  for (const entry of INTENT_TERMS) {
    if (entry.terms.some((term) => lower.includes(term))) return entry.intent;
  }
  return null;
}

function skillFor(product: ProductId, intent: IntentId): string | null {
  return (
    SKILLS.find((s) => s.product === product && s.intent === intent)?.skill ??
    null
  );
}

export function classify(input: ClassifyInput): Classification {
  const lower = input.text.toLowerCase();
  const product = findProduct(lower);
  const intent = findIntent(lower);

  if (product !== null && intent !== null) {
    return {
      kind: "routed",
      route: { product, intent, skill: skillFor(product, intent) },
    };
  }

  // BOTH signals are required. A product name alone is a mention, not a
  // request — "SensorMine is great" must not spend an agent — and an intent
  // alone does not say which product's skill to run.
  if (product === null && intent === null) {
    return { kind: "uncertain", suggestion: null, reason: "nothing-recognised" };
  }
  if (product === null) {
    return { kind: "uncertain", suggestion: null, reason: "no-product" };
  }
  return {
    kind: "uncertain",
    // We know the product; offer the most likely intent as a QUESTION. An
    // attachment makes an opportunity more plausible than a casual query,
    // which is the one place attachments touch routing — and only to shape
    // what we ask, never to decide without asking.
    suggestion: {
      product,
      intent: input.hasAttachments ? "new-opportunity" : "product-query",
      skill: skillFor(
        product,
        input.hasAttachments ? "new-opportunity" : "product-query",
      ),
    },
    reason: "no-intent",
  };
}
