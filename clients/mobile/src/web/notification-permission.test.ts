import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMBEDDED_NOTE_DISMISS,
  EMBEDDED_NOTE_DISMISSED_KEY,
  EMBEDDED_NOTE_TESTID,
  EMBEDDED_NOTE_TEXT,
  NOTIFICATION_BANNER_ACTION,
  NOTIFICATION_BANNER_DISMISS,
  NOTIFICATION_BANNER_TESTID,
  NOTIFICATION_BANNER_TEXT,
  NOTIFICATION_PROMPT_DISMISSED_KEY,
  offerNotificationPermission,
  type NotificationPermissionOutcome,
} from "./notification-permission";

function mountContainer(): HTMLElement {
  document.body.innerHTML = "";
  const container = document.createElement("div");
  container.id = "root";
  document.body.append(container);
  return container;
}

function banner(): HTMLElement | null {
  return document.querySelector(
    `[data-testid="${NOTIFICATION_BANNER_TESTID}"]`,
  );
}

function buttonLabelled(label: string): HTMLButtonElement {
  const found = [...(banner()?.querySelectorAll("button") ?? [])].find(
    (element) => element.textContent === label,
  );
  if (found === undefined) throw new Error(`no button labelled "${label}"`);
  return found;
}

function harness(overrides: {
  permission?: string;
  stored?: Record<string, string>;
  requestPermission?: () => Promise<string>;
  isEmbedded?: boolean;
}) {
  const stored: Record<string, string> = { ...overrides.stored };
  const outcomes: NotificationPermissionOutcome[] = [];
  const container = mountContainer();
  const result = offerNotificationPermission({
    container,
    getPermission: () => overrides.permission ?? "default",
    requestPermission: overrides.requestPermission,
    read: (key) => stored[key] ?? null,
    write: (key, value) => {
      stored[key] = value;
    },
    report: (outcome) => outcomes.push(outcome),
    isEmbedded: () => overrides.isEmbedded ?? false,
  });
  return { container, outcomes, stored, result };
}

function embeddedNote(): HTMLElement | null {
  return document.querySelector(`[data-testid="${EMBEDDED_NOTE_TESTID}"]`);
}

describe("offerNotificationPermission", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("offers the banner when a grant is still obtainable", () => {
    const { outcomes } = harness({ permission: "default" });

    expect(banner()?.textContent).toContain(NOTIFICATION_BANNER_TEXT);
    expect(outcomes).toEqual(["default"]);
  });

  it("does not offer, and reports granted, when permission is already held", () => {
    const { outcomes, result } = harness({ permission: "granted" });

    expect(result).toBeNull();
    expect(banner()).toBeNull();
    expect(outcomes).toEqual(["granted"]);
  });

  it("does not offer when permission is DENIED - a button that cannot work is worse than none", () => {
    // A denied origin cannot ask again: `requestPermission()` resolves
    // "denied" immediately with no prompt shown. Rendering the offer anyway
    // would give the user a control whose only possible outcome is nothing
    // visible happening.
    const { outcomes, result } = harness({ permission: "denied" });

    expect(result).toBeNull();
    expect(outcomes).toEqual(["denied"]);
  });

  it("reports the four negative states DISTINCTLY", () => {
    // Kept apart on purpose, and this is the assertion that keeps them apart.
    // Collapsing "denied", "dismissed" and "unsupported" into one falsy reading
    // is how a later probe concludes the feature works because an attribute was
    // merely present - the trap `screen-wake-lock.ts` records for its own
    // four-state attribute.
    expect(harness({ permission: "denied" }).outcomes).toEqual(["denied"]);
    expect(harness({ permission: "granted" }).outcomes).toEqual(["granted"]);
    expect(harness({ permission: "unsupported" }).outcomes).toEqual([
      "unsupported",
    ]);
    expect(
      harness({
        permission: "default",
        stored: { [NOTIFICATION_PROMPT_DISMISSED_KEY]: "1" },
      }).outcomes,
    ).toEqual(["dismissed"]);
  });

  it("requests permission on the tap, never before it", async () => {
    // The gesture is the point. Chrome hard-denies a `requestPermission()` with
    // no user activation behind it and the origin cannot ask again, so an
    // eager request does not fail - it burns the grant.
    const requestPermission = vi.fn(async () => "granted");
    const { outcomes } = harness({ permission: "default", requestPermission });

    expect(requestPermission).not.toHaveBeenCalled();

    buttonLabelled(NOTIFICATION_BANNER_ACTION).click();
    await vi.waitFor(() => expect(outcomes).toContain("granted"));

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(banner()).toBeNull();
  });

  it("reports a refusal as denied", async () => {
    const { outcomes } = harness({
      permission: "default",
      requestPermission: async () => "denied",
    });

    buttonLabelled(NOTIFICATION_BANNER_ACTION).click();
    await vi.waitFor(() => expect(outcomes).toContain("denied"));
  });

  it("reports a REJECTED request as unsupported, not denied", async () => {
    // The two are different facts with different advice. `requestPermission`
    // rejects where the API exists but the surface forbids it - a cross-origin
    // frame without the `notifications` permission policy, i.e. exactly what a
    // Teams personal tab is. Recording that as "the user said no" would send
    // someone to reset a permission they were never asked for.
    const { outcomes } = harness({
      permission: "default",
      requestPermission: async () => {
        throw new Error("permissions policy");
      },
    });

    buttonLabelled(NOTIFICATION_BANNER_ACTION).click();
    await vi.waitFor(() => expect(outcomes).toContain("unsupported"));
    expect(outcomes).not.toContain("denied");
  });

  it("remembers a dismissal so the banner does not return every load", () => {
    const { stored, outcomes } = harness({ permission: "default" });

    buttonLabelled(NOTIFICATION_BANNER_DISMISS).click();

    expect(stored[NOTIFICATION_PROMPT_DISMISSED_KEY]).toBe("1");
    expect(outcomes).toEqual(["default", "dismissed"]);
    expect(banner()).toBeNull();
  });

  it("does not stack a second banner", () => {
    harness({ permission: "default" });
    const container = document.getElementById("root");
    if (container === null) throw new Error("no container");
    offerNotificationPermission({
      container,
      getPermission: () => "default",
      read: () => null,
      write: () => undefined,
      report: () => undefined,
    });

    expect(
      document.querySelectorAll(
        `[data-testid="${NOTIFICATION_BANNER_TESTID}"]`,
      ),
    ).toHaveLength(1);
  });
});

/**
 * The embedded surface. Every test here holds ONE variable against the suite
 * above: the permission reading is the same `denied` in both, and only
 * `isEmbedded` differs - which is the whole claim being made, and the only
 * arrangement in which a test can show it.
 */
describe("offerNotificationPermission, embedded cross-origin", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("reports surface-blocked, NOT denied, when embedded", () => {
    expect(
      harness({ permission: "denied", isEmbedded: true }).outcomes,
    ).toEqual(["surface-blocked"]);
  });

  it("still reports denied for the SAME reading when not embedded", () => {
    // The control, and the reason the test above means anything. Without it,
    // `surface-blocked` could be produced by the permission alone and the
    // embedding check could be dead code.
    expect(
      harness({ permission: "denied", isEmbedded: false }).outcomes,
    ).toEqual(["denied"]);
  });

  it("shows a note that explains it, with no Enable button", () => {
    harness({ permission: "denied", isEmbedded: true });
    const note = embeddedNote();
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain(EMBEDDED_NOTE_TEXT);
    // Positive assertion FIRST (above), because "no Enable button" is equally
    // true of a note that rendered nothing at all.
    const labels = [...(note?.querySelectorAll("button") ?? [])].map(
      (b) => b.textContent,
    );
    expect(labels).toEqual([EMBEDDED_NOTE_DISMISS]);
    expect(labels).not.toContain(NOTIFICATION_BANNER_ACTION);
  });

  it("never renders the Enable offer on an embedded surface", () => {
    harness({ permission: "denied", isEmbedded: true });
    expect(banner()).toBeNull();
  });

  it("does not ask again once the note is dismissed", () => {
    const first = harness({ permission: "denied", isEmbedded: true });
    const dismiss = [
      ...(embeddedNote()?.querySelectorAll("button") ?? []),
    ].find((b) => b.textContent === EMBEDDED_NOTE_DISMISS);
    expect(dismiss).toBeDefined();
    dismiss?.click();
    expect(embeddedNote()).toBeNull();
    expect(first.stored[EMBEDDED_NOTE_DISMISSED_KEY]).toBe("1");
    // The dismissal reports NOTHING further. Asserted on the session that
    // actually dismissed, which is the only one that can see it - checking the
    // reloaded session below let a real mutation survive, because a session
    // that never clicks cannot observe what clicking reports.
    expect(first.outcomes).toEqual(["surface-blocked"]);

    const second = harness({
      permission: "denied",
      isEmbedded: true,
      stored: { [EMBEDDED_NOTE_DISMISSED_KEY]: "1" },
    });
    expect(embeddedNote()).toBeNull();
    // STILL surface-blocked. Dismissing the note does not mean notifications
    // began working, and this is where the two paths deliberately differ from
    // each other - the offer's dismissal IS its final outcome, this one is not.
    expect(second.outcomes).toEqual(["surface-blocked"]);
  });

  it("uses a different dismissal key from the offer", () => {
    // Same origin, same storage: a dismissal in the embedded surface must not
    // suppress the offer in the browser tab the note tells the user to open.
    const { outcomes } = harness({
      permission: "default",
      isEmbedded: false,
      stored: { [EMBEDDED_NOTE_DISMISSED_KEY]: "1" },
    });
    expect(outcomes).toEqual(["default"]);
    expect(banner()).not.toBeNull();
  });

  it("leaves an embedded GRANTED reading alone", () => {
    // The platform does not produce this - measured, all three arms - so the
    // branch must not claim it. Asserted so a later widening to "any embedded
    // reading" reddens here rather than shipping.
    expect(
      harness({ permission: "granted", isEmbedded: true }).outcomes,
    ).toEqual(["granted"]);
    expect(embeddedNote()).toBeNull();
  });

  it("leaves an embedded DEFAULT reading as a real offer", () => {
    const { outcomes } = harness({ permission: "default", isEmbedded: true });
    expect(outcomes).toEqual(["default"]);
    expect(banner()).not.toBeNull();
    expect(embeddedNote()).toBeNull();
  });
});
