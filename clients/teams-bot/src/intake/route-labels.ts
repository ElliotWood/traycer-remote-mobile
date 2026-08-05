/**
 * Human wording for a route, used in the clarifying question.
 *
 * Separate from `classify.ts` on purpose: the classifier decides, this
 * decides how to SAY it, and one changing should not force the other. The
 * ids are stable routing keys and must never be shown to a person —
 * "sensormine / new-opportunity" is not a sentence anyone should read in a
 * chat.
 *
 * Phrased to complete "Looks like …. Is that right?", so the label is a noun
 * phrase rather than a sentence.
 */
import type { IntentId, ProductId, SkillRoute } from "./classify";

const PRODUCT_LABELS: Readonly<Record<ProductId, string>> = {
  sensormine: "SensorMine",
  "dr-migrate": "DR Migrate",
};

const INTENT_LABELS: Readonly<Record<IntentId, string>> = {
  "new-opportunity": "a new opportunity",
  "product-query": "a product question",
  "feature-request": "a feature request",
  support: "a support issue",
};

/** e.g. "a new SensorMine opportunity" → "Looks like a new SensorMine opportunity." */
export function describeRoute(route: SkillRoute): string {
  const product = PRODUCT_LABELS[route.product];
  const intent = INTENT_LABELS[route.intent];
  // "a new opportunity" + "SensorMine" reads better as "a new SensorMine
  // opportunity" than as "SensorMine — a new opportunity".
  if (route.intent === "new-opportunity") return `a new ${product} opportunity`;
  return `${intent} about ${product}`;
}
