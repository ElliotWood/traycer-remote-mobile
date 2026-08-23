/**
 * THE SEAM: upstream's REAL emission controller driving OUR REAL notification
 * host. Nothing between them is mocked.
 *
 * Both ends of this seam are already green in isolation and have been for
 * weeks - upstream tests the controller against a stub `show()`, and
 * `web-notification-host.test.ts` tests `show()` against a stub registration.
 * The defect this file exists for lives in neither: it is what upstream's
 * retry policy DOES with the rejection our host produces on a surface where
 * the rejection is permanent. That is only visible with both real halves
 * attached, which is the shape recorded as "both ends green, seam untested".
 *
 * `sonner` is the one mock, and it is the MEASURING INSTRUMENT rather than a
 * stand-in for anything under test: a toast call is the user-visible event
 * being counted.
 */
import "../../../gui-app/__tests__/test-browser-apis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MockRunnerHost } from "@traycer-clients/shared/host-client/mock/mock-runner-host";
import type { INotificationHost } from "@traycer-clients/shared/platform/runner-host";
import { NotificationEmissionController } from "@/components/layout/bridges/notification-emission-controller";
import { RunnerHostProvider } from "@/providers/runner-host-provider";
import { useAppLocalNotificationsStore } from "@/stores/notifications/app-local-notifications-store";
import { useAuthStore } from "@/stores/auth/auth-store";
import {
  createWebNotificationHost,
  type NativeNotifyOutcome,
  type NotificationRegistrationLike,
} from "./web-notification-host";

const toastCalls = vi.hoisted((): string[] => []);

vi.mock("sonner", () => ({
  toast: (_title: ReactNode, options: { readonly id: string }): string => {
    toastCalls.push(options.id);
    return options.id;
  },
}));

vi.mock("@/hooks/notifications/use-notification-activation", () => ({
  useNotificationActivation: () => ({ activate: vi.fn(), pendingFeedId: null }),
}));

vi.mock("@/stores/notifications/merged-notifications", async (importActual) => {
  const actual =
    await importActual<
      typeof import("@/stores/notifications/merged-notifications")
    >();
  return {
    ...actual,
    useMergedNotificationsActions: () => ({
      markAsRead: vi.fn(),
      markAllAsRead: vi.fn(),
      loadMoreHost: vi.fn(),
      canLoadMoreHost: false,
      isLoadingMoreHost: false,
      hasHostLoadError: false,
      loadMoreAttention: vi.fn(),
      canLoadMoreAttention: false,
      isLoadingMoreAttention: false,
      hasAttentionLoadError: false,
      loadMoreUnreadRecent: vi.fn(),
      canLoadMoreUnreadRecent: false,
      isLoadingMoreUnreadRecent: false,
      hasUnreadRecentLoadError: false,
    }),
  };
});

/** Records what actually reached the service worker, so a "displayed" claim is checked rather than inferred from a resolved promise. */
function recordingRegistration(): {
  readonly registration: NotificationRegistrationLike;
  readonly shown: string[];
} {
  const shown: string[] = [];
  return {
    shown,
    registration: {
      showNotification: async (title): Promise<void> => {
        shown.push(title);
      },
    },
  };
}

function mountWith(notifications: INotificationHost): void {
  const runnerHost = new MockRunnerHost({
    signInUrl: "https://example.com",
    authnBaseUrl: "https://auth.example.com",
    localHost: null,
    hosts: [],
    workspaceFolderPickerPaths: undefined,
    hasLocalHost: undefined,
    traycerCli: undefined,
  });
  // `defineProperty` rather than a cast: `notifications` is `readonly` on the
  // mock, and a chained `as unknown` assertion is banned by this repo's lint.
  Object.defineProperty(runnerHost, "notifications", {
    value: notifications,
    configurable: true,
  });
  render(
    <RunnerHostProvider runnerHost={runnerHost}>
      <NotificationEmissionController />
    </RunnerHostProvider>,
  );
}

/** One app-local notification arriving, then settling. */
async function arrive(id: string, updatedAt: number): Promise<void> {
  await act(async () => {
    useAppLocalNotificationsStore.getState().upsert({
      id,
      updatedAt,
      readAt: null,
      kind: "host.error",
      sourceRef: id,
      payload: null,
      message: `Message ${id}`,
      detail: null,
    });
    await Promise.resolve();
    await Promise.resolve();
  });
}

function toastsFor(id: string): number {
  return toastCalls.filter((toastId) => toastId === id).length;
}

describe("the emission controller's retry against our real notification host", () => {
  beforeEach(() => {
    toastCalls.length = 0;
    window.localStorage.clear();
    useAuthStore.setState({
      status: "signed-in",
      profile: {
        userId: "user-1",
        userName: "user-1",
        email: "user@example.com",
      },
      contextMetadata: { userId: "user-1", username: "user-1" },
      shareableTeams: [],
    });
    useAppLocalNotificationsStore.getState().resetForTests();
    useAppLocalNotificationsStore.getState().activateIdentity("user-1");
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    useAppLocalNotificationsStore.getState().resetForTests();
  });

  /**
   * THE CONTROL THAT MAKES THE REST MEAN ANYTHING. A granted surface must
   * display once and stop. Without this row, "toasted once" in the treatment
   * would be indistinguishable from a controller that never retries anything.
   */
  it("granted: displays a row once, and later arrivals do not re-display it", async () => {
    const { registration, shown } = recordingRegistration();
    mountWith(
      createWebNotificationHost({
        serviceWorker: {
          ready: Promise.resolve(registration),
          controller: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        },
        getPermission: () => "granted",
      }),
    );

    await arrive("first", 10);
    expect(toastsFor("first")).toBe(1);
    expect(shown).toEqual(["Message first"]);

    await arrive("second", 20);
    await arrive("third", 30);

    // The point of the row: `first` did not toast again when `second` and
    // `third` arrived.
    expect(toastsFor("first")).toBe(1);
    expect(shown).toEqual(["Message first", "Message second", "Message third"]);
  });

  /**
   * THE SECOND CONTROL, and the one that stops the fix from being a
   * regression dressed as a repair. A top-level browser whose user has not
   * granted permission is TRANSIENTLY denied: the grant can change, so
   * upstream's retry is correct and the receipt must stay pending. If the fix
   * had simply stopped rejecting, this row would drop to 1 and the backlog
   * would be swallowed the moment permission was finally granted - which is
   * the exact failure upstream's `.catch()` comment exists to prevent.
   */
  it("transiently denied: keeps retrying, because the grant can still change", async () => {
    const { registration, shown } = recordingRegistration();
    const outcomes: NativeNotifyOutcome[] = [];
    mountWith(
      createWebNotificationHost({
        serviceWorker: {
          ready: Promise.resolve(registration),
          controller: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        },
        getPermission: () => "denied",
        isSurfaceBlocked: () => false,
        report: (outcome) => outcomes.push(outcome),
      }),
    );

    await arrive("first", 10);
    await arrive("second", 20);
    await arrive("third", 30);

    expect(shown).toEqual([]);
    // Still retried - unchanged from the shipped behaviour, deliberately.
    expect(toastsFor("first")).toBe(3);
    expect(outcomes).toEqual(["idle", ...Array(6).fill("permission")]);
  });

  /**
   * THE FIX. A cross-origin embedded surface reads `denied` permanently -
   * measured, four arms, and `allow="notifications *"` does not restore it.
   * There is no later mount at which retrying could succeed, so the row is
   * settled rather than left pending, and the backlog drains.
   *
   * Before the fix this read 3 / 2 / 6 against the identical harness.
   */
  it("permanently blocked: displays once and does not re-toast on later arrivals", async () => {
    const { registration, shown } = recordingRegistration();
    const outcomes: NativeNotifyOutcome[] = [];
    mountWith(
      createWebNotificationHost({
        serviceWorker: {
          ready: Promise.resolve(registration),
          controller: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        },
        getPermission: () => "denied",
        isSurfaceBlocked: () => true,
        report: (outcome) => outcomes.push(outcome),
      }),
    );

    await arrive("first", 10);
    expect(toastsFor("first")).toBe(1);

    await arrive("second", 20);
    await arrive("third", 30);

    // Nothing reached the worker, which is correct and unchanged: the fix is
    // about the RETRY, not about pretending a notification was drawn.
    expect(shown).toEqual([]);

    // Each row toasted exactly once - the user is still told, once, in-app.
    expect(toastsFor("first")).toBe(1);
    expect(toastsFor("second")).toBe(1);
    expect(toastCalls.length).toBe(3);

    // And the surface said WHY, distinctly from a transient refusal.
    expect(outcomes).toEqual([
      "idle",
      "surface-blocked",
      "surface-blocked",
      "surface-blocked",
    ]);
  });
});
