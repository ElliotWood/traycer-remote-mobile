import { describe, expect, it } from "vitest";
import { classify } from "../classify";

const noFiles = { hasAttachments: false };
const withFiles = { hasAttachments: true };

describe("classify — routes only on independent product AND intent evidence", () => {
  it("routes Elliot's own phrasing to the SensorMine opportunity skill", () => {
    const result = classify({
      text: "does this work with sensormine",
      ...withFiles,
    });
    expect(result).toEqual({
      kind: "routed",
      route: {
        product: "sensormine",
        intent: "new-opportunity",
        skill: "smv4-opportunity-pipeline",
      },
    });
  });

  it("routes on an RFP mention with the product named", () => {
    const result = classify({
      text: "customer RFP attached — can we deliver this on SMv4?",
      ...withFiles,
    });
    expect(result.kind).toBe("routed");
    if (result.kind !== "routed") return;
    expect(result.route.skill).toBe("smv4-opportunity-pipeline");
  });
});

describe("classify — the dangerous direction: never spend an agent on one signal", () => {
  it("CONTRACT: a product name ALONE does not route", () => {
    // "SensorMine is great" is a remark, not a request. Routing it would
    // start a customer-opportunity assessment because somebody said a word.
    const result = classify({ text: "sensormine is great", ...noFiles });
    expect(result.kind).toBe("uncertain");
  });

  it("CONTRACT: an intent ALONE does not route", () => {
    // We know they want an opportunity assessed; we do not know for which
    // product, and picking one would be inventing the answer.
    const result = classify({
      text: "here is an RFP, can we do this?",
      ...withFiles,
    });
    expect(result.kind).toBe("uncertain");
    if (result.kind !== "uncertain") return;
    expect(result.reason).toBe("no-product");
    expect(result.suggestion).toBeNull();
  });

  it("CONTRACT: attachments alone never route — files are input, not intent", () => {
    // The most tempting shortcut: a file arrived, so it must be an RFP.
    // People paste files into chats constantly.
    const result = classify({ text: "here you go", ...withFiles });
    expect(result.kind).toBe("uncertain");
    if (result.kind !== "uncertain") return;
    expect(result.reason).toBe("nothing-recognised");
  });

  it("CONTRACT: an unbuilt route is reported as routed-with-null-skill, never as a different skill", () => {
    // DR Migrate has no opportunity skill yet. The failure to guard against
    // is falling back to the SensorMine one because it is the only entry.
    const result = classify({
      text: "RFP for dr migrate — can we deliver?",
      ...withFiles,
    });
    expect(result.kind).toBe("routed");
    if (result.kind !== "routed") return;
    expect(result.route.product).toBe("dr-migrate");
    expect(result.route.skill).toBeNull();
  });
});

describe("classify — intent ordering is load-bearing", () => {
  it("CONTRACT: 'can we support this RFP' is an opportunity, not a support ticket", () => {
    // Both vocabularies match. Opportunity is tested first on purpose, and
    // this asserts the ordering rather than trusting the array's shape.
    const result = classify({
      text: "can we support this RFP for sensormine?",
      ...withFiles,
    });
    expect(result.kind).toBe("routed");
    if (result.kind !== "routed") return;
    expect(result.route.intent).toBe("new-opportunity");
  });

  it("a genuine support message still classifies as support", () => {
    const result = classify({
      text: "sensormine dashboard is broken for one tenant",
      ...noFiles,
    });
    expect(result.kind).toBe("routed");
    if (result.kind !== "routed") return;
    expect(result.route.intent).toBe("support");
    expect(result.route.skill).toBeNull();
  });
});

describe("classify — the low-confidence suggestion the card turns into a button", () => {
  it("offers an opportunity when a product is named AND files arrived", () => {
    const result = classify({ text: "sensormine — thoughts?", ...withFiles });
    expect(result.kind).toBe("uncertain");
    if (result.kind !== "uncertain") return;
    expect(result.reason).toBe("no-intent");
    expect(result.suggestion?.intent).toBe("new-opportunity");
  });

  it("offers a product query for the same words with NO files", () => {
    // The single place attachments touch routing — and only to shape what we
    // ASK, never to decide without asking.
    const result = classify({ text: "sensormine — thoughts?", ...noFiles });
    expect(result.kind).toBe("uncertain");
    if (result.kind !== "uncertain") return;
    expect(result.suggestion?.intent).toBe("product-query");
  });

  it("CONTRACT: a suggestion is still uncertain — it is a question, not a route", () => {
    // The failure this guards: a caller reading `suggestion` and dispatching
    // it. `kind` is the decision; `suggestion` is only what to put on a button.
    const result = classify({ text: "sensormine — thoughts?", ...withFiles });
    expect(result.kind).not.toBe("routed");
  });

  it("says nothing was recognised on an unrelated message", () => {
    const result = classify({ text: "morning all", ...noFiles });
    expect(result.kind).toBe("uncertain");
    if (result.kind !== "uncertain") return;
    expect(result.reason).toBe("nothing-recognised");
    expect(result.suggestion).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(
      classify({ text: "DOES THIS FIT SENSORMINE", ...noFiles }).kind,
    ).toBe("routed");
  });

  it("empty text is not recognised rather than routed", () => {
    const result = classify({ text: "", ...withFiles });
    expect(result.kind).toBe("uncertain");
  });
});
