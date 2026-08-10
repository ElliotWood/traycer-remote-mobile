import { describe, expect, it, vi } from "vitest";
import { IdentityRegistry } from "@traycer-clients/shared/identity-registry/registry";
import { dispatchActionInvoke } from "../dispatch-action";
import type { DispatchDeps } from "../dispatch";
import { InMemoryEpicBindingStore } from "../epic-binding-store";
import {
  CONFIRM_ROUTE_VERB,
  SUBMIT_INTAKE_VERB,
  STAGED_NAMES_KEY,
  buildClarifyCard,
} from "../cards";
import {
  BUYER_INPUT_ID,
  DEADLINE_DATE_INPUT_ID,
  DEADLINE_TIME_INPUT_ID,
  JURISDICTION_INPUT_ID,
  OWNER_INPUT_ID,
  SLUG_INPUT_ID,
  TIME_ZONE_INPUT_ID,
} from "../../intake/intake-form";

const NOW = Date.UTC(2026, 0, 1);
const STAGING_ID = "1f0a2b3c-4d5e-4f60-8a91-b2c3d4e5f607";

type StartAssessment = NonNullable<DispatchDeps["startAssessment"]>;

/** A stub that records what the dispatcher handed it, and always succeeds. */
function startsFine(): StartAssessment {
  return vi.fn(async () => ({
    kind: "started" as const,
    card: { contentType: "application/vnd.microsoft.card.adaptive", content: {} },
  }));
}

/**
 * A REAL `DispatchDeps`.
 *
 * The bridge and the principal are wired to throw and to refuse, which is the
 * point rather than a shortcut: NOTHING on the intake path should reach a
 * host, and a deps object that could not have reached one proves less than one
 * that would have exploded if it tried.
 */
function makeDeps(opts: {
  readonly startAssessment: StartAssessment | undefined;
  readonly defaultTimeZone: string | undefined;
}): DispatchDeps {
  return {
    registry: IdentityRegistry.fromConfig(
      {
        tenants: [
          {
            home: "/tenants/alice",
            hostId: "alice-host",
            entraOid: "aaaaaaaa-1111-1111-1111-111111111111",
            traycerUserId: null,
          },
        ],
      },
      () => {},
    ),
    epicBindings: new InMemoryEpicBindingStore(),
    bridgeCliConfig: {
      command: "/absolute/traycer-remote-bridge",
      timeoutMs: 5000,
      spawnFn: async () => {
        throw new Error("the intake path must not reach the bridge");
      },
    },
    senderAgentId: "teams-bot",
    parentEnv: {},
    resolvePrincipal: async () => ({
      kind: "unavailable",
      reason: "the intake form needs no identity to render",
    }),
    startAssessment: opts.startAssessment,
    defaultTimeZone: opts.defaultTimeZone,
    now: () => NOW,
  };
}

function deps(): DispatchDeps {
  return makeDeps({
    startAssessment: startsFine(),
    defaultTimeZone: undefined,
  });
}

const ROUTE_DATA = {
  product: "sensormine",
  intent: "new-opportunity",
  skill: "smv4-opportunity-pipeline",
  text: "does this fit SensorMine?",
  stagingId: STAGING_ID,
  [STAGED_NAMES_KEY]: JSON.stringify(["Tender.pdf"]),
};

const FILLED = {
  ...ROUTE_DATA,
  [SLUG_INPUT_ID]: "acme-water-rfp",
  [BUYER_INPUT_ID]: "Acme Water",
  [DEADLINE_DATE_INPUT_ID]: "2026-09-15",
  [DEADLINE_TIME_INPUT_ID]: "17:00",
  [TIME_ZONE_INPUT_ID]: "Australia/Perth",
  [JURISDICTION_INPUT_ID]: "local",
  [OWNER_INPUT_ID]: "Elliot Wood",
};

function body(card: { readonly content?: unknown }): string {
  return JSON.stringify(card.content);
}

describe("intake — confirming a route OPENS A FORM and starts nothing", () => {
  it("CONTRACT: the confirm button no longer starts an agent", () => {
    // It used to. That was the gap: `classify` yields product × intent, and
    // `new-bid.mjs` refuses without five more fields, so a confirm button
    // could never have supplied them.
    const d = deps();
    return dispatchActionInvoke(
      { verb: CONFIRM_ROUTE_VERB, conversationId: "c1", data: ROUTE_DATA },
      d,
    ).then((result) => {
      expect(d.startAssessment).not.toHaveBeenCalled();
      expect(body(result.card)).toContain(SUBMIT_INTAKE_VERB);
    });
  });

  it("renders every field new-bid.mjs needs, and no others", async () => {
    const result = await dispatchActionInvoke(
      { verb: CONFIRM_ROUTE_VERB, conversationId: "c1", data: ROUTE_DATA },
      deps(),
    );
    const content = body(result.card);
    for (const id of [
      SLUG_INPUT_ID,
      BUYER_INPUT_ID,
      DEADLINE_DATE_INPUT_ID,
      DEADLINE_TIME_INPUT_ID,
      TIME_ZONE_INPUT_ID,
      JURISDICTION_INPUT_ID,
      OWNER_INPUT_ID,
    ]) {
      expect(content, id).toContain(id);
    }
  });

  it("CONTRACT: the owner is prefilled with whoever @-mentioned the bot", async () => {
    // Settled by Elliot, 2026-08-09. It is a VALUE on an ordinary input, not
    // a silent default — the field is on screen, filled in, and replaceable.
    const result = await dispatchActionInvoke(
      {
        verb: CONFIRM_ROUTE_VERB,
        conversationId: "c1",
        data: { ...ROUTE_DATA, requesterName: "Elliot Wood" },
      },
      deps(),
    );
    expect(body(result.card)).toContain("Elliot Wood");
  });

  it("CONTRACT: the time zone is unselected unless the deployment configured one", async () => {
    // An unselected zone is a red message on the card. A wrongly-guessed one
    // is an hour or eight of silent error on a tender deadline.
    const unset = await dispatchActionInvoke(
      { verb: CONFIRM_ROUTE_VERB, conversationId: "c1", data: ROUTE_DATA },
      deps(),
    );
    const parsedUnset = JSON.parse(body(unset.card)) as {
      body: { id?: string; value?: string }[];
    };
    const zoneInput = parsedUnset.body.find((e) => e.id === TIME_ZONE_INPUT_ID);
    expect(zoneInput?.value).toBeUndefined();

    const preset = await dispatchActionInvoke(
      { verb: CONFIRM_ROUTE_VERB, conversationId: "c1", data: ROUTE_DATA },
      makeDeps({ startAssessment: startsFine(), defaultTimeZone: "Australia/Perth" }),
    );
    expect(body(preset.card)).toContain("Australia/Perth");
  });

  it("CONTRACT: jurisdiction is a picker over the tool's four values, unselected", async () => {
    // Free text would let a typo through the form and fail at scaffold time.
    // And nothing is preselected: a compact-looking first-option-chosen would
    // put `commonwealth` on a bid nobody chose it for, and `new-bid.mjs`'s own
    // default of `state` is deliberately not copied here.
    const result = await dispatchActionInvoke(
      { verb: CONFIRM_ROUTE_VERB, conversationId: "c1", data: ROUTE_DATA },
      deps(),
    );
    const parsed = JSON.parse(body(result.card)) as {
      body: {
        id?: string;
        type?: string;
        style?: string;
        value?: string;
        choices?: { value: string }[];
      }[];
    };
    const input = parsed.body.find((e) => e.id === JURISDICTION_INPUT_ID);
    expect(input?.type).toBe("Input.ChoiceSet");
    expect(input?.style).toBe("expanded");
    expect(input?.value).toBeUndefined();
    expect(input?.choices?.map((c) => c.value)).toEqual([
      "commonwealth",
      "state",
      "local",
      "enterprise",
    ]);
  });

  it("lists the staged documents by name, so the wrong one can be spotted", async () => {
    // The contract calls intake "the natural place to catch the case where
    // the user attached the wrong document". A count cannot do that.
    const result = await dispatchActionInvoke(
      { verb: CONFIRM_ROUTE_VERB, conversationId: "c1", data: ROUTE_DATA },
      deps(),
    );
    expect(body(result.card)).toContain("Tender.pdf");
  });

  it("refuses to open a form for a route with no skill built", async () => {
    const d = deps();
    const result = await dispatchActionInvoke(
      { verb: CONFIRM_ROUTE_VERB, conversationId: "c1", data: { ...ROUTE_DATA, skill: "" } },
      d,
    );
    expect(result.acted).toBe(false);
    expect(d.startAssessment).not.toHaveBeenCalled();
  });

  it("says so when the deployment cannot start assessments at all", async () => {
    const result = await dispatchActionInvoke(
      { verb: CONFIRM_ROUTE_VERB, conversationId: "c1", data: ROUTE_DATA },
      makeDeps({ startAssessment: undefined, defaultTimeZone: undefined }),
    );
    expect(result.acted).toBe(false);
    expect(body(result.card)).toContain("can't start assessments");
  });
});

describe("intake — submitting the form", () => {
  it("CONTRACT: a complete form reaches startAssessment with all five fields", async () => {
    const d = deps();
    const result = await dispatchActionInvoke(
      { verb: SUBMIT_INTAKE_VERB, conversationId: "c1", data: FILLED },
      d,
    );
    expect(result.acted).toBe(true);
    expect(d.startAssessment).toHaveBeenCalledOnce();
    const call = vi.mocked(d.startAssessment as StartAssessment).mock.calls[0][0];
    // The WHOLE object. Field-by-field only covers fields someone thought of,
    // and a dropped field is precisely the defect being closed.
    expect(call.opportunity).toEqual({
      slug: "acme-water-rfp",
      buyer: "Acme Water",
      deadline: "2026-09-15T17:00:00+08:00",
      jurisdiction: "local",
      owner: "Elliot Wood",
    });
    expect(call.stagingId).toBe(STAGING_ID);
  });

  it("CONTRACT: an untouched form starts NOTHING", async () => {
    // `Action.Submit` fires whether or not anything was filled in — the same
    // property that makes the composer send empty messages. Client-side
    // required-ness was never going to be the gate.
    const d = deps();
    const result = await dispatchActionInvoke(
      { verb: SUBMIT_INTAKE_VERB, conversationId: "c1", data: ROUTE_DATA },
      d,
    );
    expect(d.startAssessment).not.toHaveBeenCalled();
    expect(result.acted).toBe(false);
    expect(body(result.card)).toContain("to fix before I start");
  });

  it("CONTRACT: a deadline with no zone chosen is refused, not defaulted", async () => {
    const d = deps();
    const result = await dispatchActionInvoke(
      {
        verb: SUBMIT_INTAKE_VERB,
        conversationId: "c1",
        data: { ...FILLED, [TIME_ZONE_INPUT_ID]: "" },
      },
      d,
    );
    expect(d.startAssessment).not.toHaveBeenCalled();
    expect(body(result.card)).toContain("time zone");
  });

  it("gives the form back with what was typed rather than clearing it", async () => {
    const result = await dispatchActionInvoke(
      {
        verb: SUBMIT_INTAKE_VERB,
        conversationId: "c1",
        data: { ...FILLED, [SLUG_INPUT_ID]: "NOT A SLUG" },
      },
      deps(),
    );
    const content = body(result.card);
    expect(content).toContain("Acme Water");
    expect(content).toContain("Elliot Wood");
    expect(content).toContain("2026-09-15");
  });

  it("keeps the staging handle across a validation round-trip", async () => {
    // Losing it would silently turn a request WITH documents into one
    // without, which the instruction cannot distinguish.
    const result = await dispatchActionInvoke(
      {
        verb: SUBMIT_INTAKE_VERB,
        conversationId: "c1",
        data: { ...FILLED, [BUYER_INPUT_ID]: "" },
      },
      deps(),
    );
    expect(body(result.card)).toContain(STAGING_ID);
  });

  it("a malformed staged-names payload costs a label, not a document", async () => {
    // The names in the payload are display only; the instruction's list comes
    // from reading the staging directory.
    const d = deps();
    await dispatchActionInvoke(
      {
        verb: SUBMIT_INTAKE_VERB,
        conversationId: "c1",
        data: { ...FILLED, [STAGED_NAMES_KEY]: "{not json" },
      },
      d,
    );
    expect(d.startAssessment).toHaveBeenCalledOnce();
  });
});

/**
 * TEAMS IS INTAKE-ONLY. Settled by Elliot, 2026-08-09.
 *
 * The card half of this prohibition — that no card EMITS such a verb, and
 * that no source file names the tools — lives in `cards.test.ts` beside the
 * enumeration contract it extends. This is the other half: the dispatcher
 * takes its verb from a payload Bot Service relays, not from our cards, so a
 * handler could exist with nothing rendering a button for it.
 */
describe("PROHIBITION: the dispatcher cannot authorise, close out, or lodge", () => {
  it("has no handler for a verb that means any of them", async () => {
    const d = deps();
    for (const verb of [
      "traycer/authorise",
      "traycer/authorize",
      "traycer/closeout",
      "traycer/lodge",
      "traycer/approveBid",
    ]) {
      const result = await dispatchActionInvoke(
        { verb, conversationId: "c1", data: FILLED },
        d,
      );
      expect(result.acted, verb).toBe(false);
      expect(body(result.card), verb).toContain("Unknown card action");
    }
    // And nothing was started along the way — an "unknown verb" that had
    // already spawned an agent would be the failure, not the message.
    expect(d.startAssessment).not.toHaveBeenCalled();
  });

  it("CONTROL: the check can fail — a verb that IS handled does not say unknown", async () => {
    // Without this, a dispatcher that answered "Unknown card action" to
    // everything would pass the test above while being completely broken.
    const result = await dispatchActionInvoke(
      { verb: CONFIRM_ROUTE_VERB, conversationId: "c1", data: ROUTE_DATA },
      deps(),
    );
    expect(body(result.card)).not.toContain("Unknown card action");
  });
});

describe("intake — the clarify card feeds the form", () => {
  it("carries the staging handle, the file names and the requester through the button", () => {
    // The confirm press arrives as its OWN activity, with no attachments and
    // — in a channel — no reliable sender name. Nothing downstream can
    // re-derive any of these.
    const content = JSON.stringify(
      buildClarifyCard({
        suggestionLabel: "a SensorMine opportunity",
        product: "sensormine",
        intent: "new-opportunity",
        skill: "smv4-opportunity-pipeline",
        spokenText: "does this fit?",
        stagingId: STAGING_ID,
        stagedNames: ["Tender.pdf"],
        requesterName: "Elliot Wood",
      }).content,
    );
    expect(content).toContain(STAGING_ID);
    expect(content).toContain("Tender.pdf");
    expect(content).toContain("Elliot Wood");
  });
});
