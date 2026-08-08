import { beforeEach, describe, expect, it, vi } from "vitest";
import {
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
  return document.querySelector(`[data-testid="${NOTIFICATION_BANNER_TESTID}"]`);
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
  });
  return { container, outcomes, stored, result };
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
      document.querySelectorAll(`[data-testid="${NOTIFICATION_BANNER_TESTID}"]`),
    ).toHaveLength(1);
  });
});
