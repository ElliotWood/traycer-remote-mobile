/**
 * The sign-in gate + drilldown navigation as state machines (T4).
 *
 * `selectAppScreen` is the whole Flow-1 gate: which single screen renders for a
 * given auth status × host configuration. `navReducer` is the Fleet → Epic →
 * Chat stack. Both are pure, so this pins the behavior without a DOM — the
 * component render paths are trivial exhaustive switches over these outputs.
 */
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@traycer/protocol/auth";
import type {
  DeviceFlowProgress,
  MobileAuthStatus,
} from "../host/auth-service";
import { selectAppScreen } from "../app-screen";
import {
  INITIAL_NAV_STACK,
  currentRoute,
  navReducer,
  type NavStack,
} from "../router/nav";
import { signInErrorMessage } from "../views/sign-in-view";

const USER = { user: { id: "u1" } } as unknown as AuthenticatedUser;
const PROGRESS: DeviceFlowProgress = {
  userCode: "WDJB-MJHT",
  verificationUri: "https://traycer.ai/device",
  verificationUriComplete: "https://traycer.ai/device?code=WDJB-MJHT",
  expiresAtMs: 1_000,
};

describe("selectAppScreen — the sign-in gate", () => {
  it("signed-out → sign-in, carrying the terminal error", () => {
    const status: MobileAuthStatus = { kind: "signed-out", error: null };
    expect(selectAppScreen(status, true)).toEqual({
      kind: "sign-in",
      error: null,
    });
    expect(
      selectAppScreen({ kind: "signed-out", error: "device-expired" }, true),
    ).toEqual({ kind: "sign-in", error: "device-expired" });
  });

  it("signing-in → signing-in, carrying device-flow progress", () => {
    expect(
      selectAppScreen({ kind: "signing-in", progress: null }, true),
    ).toEqual({ kind: "signing-in", progress: null });
    expect(
      selectAppScreen({ kind: "signing-in", progress: PROGRESS }, true),
    ).toEqual({ kind: "signing-in", progress: PROGRESS });
  });

  it("signed-in → shell when a host is configured, else the no-host prompt", () => {
    const status: MobileAuthStatus = { kind: "signed-in", user: USER };
    expect(selectAppScreen(status, true)).toEqual({ kind: "signed-in" });
    expect(selectAppScreen(status, false)).toEqual({ kind: "no-host" });
  });
});

describe("signInErrorMessage", () => {
  it("maps every terminal error to distinct, non-empty copy", () => {
    const errors = [
      "session-expired",
      "sign-in-failed",
      "device-denied",
      "device-expired",
      "launch-failed",
    ] as const;
    const messages = errors.map((e) => signInErrorMessage(e));
    for (const m of messages) expect(m.length).toBeGreaterThan(0);
    expect(new Set(messages).size).toBe(errors.length);
  });
});

describe("navReducer — Fleet → Epic → Chat stack", () => {
  it("starts at the Fleet root", () => {
    expect(currentRoute(INITIAL_NAV_STACK)).toEqual({ name: "fleet" });
  });

  it("drills in and backs out through the stack", () => {
    let stack: NavStack = INITIAL_NAV_STACK;
    stack = navReducer(stack, { type: "open-epic", epicId: "e1", epicTitle: "Epic 1" });
    expect(currentRoute(stack)).toEqual({ name: "epic", epicId: "e1", epicTitle: "Epic 1" });

    stack = navReducer(stack, {
      type: "open-chat",
      epicId: "e1",
      chatId: "c1",
    });
    expect(currentRoute(stack)).toEqual({
      name: "chat",
      epicId: "e1",
      chatId: "c1",
    });

    stack = navReducer(stack, { type: "back" });
    expect(currentRoute(stack)).toEqual({ name: "epic", epicId: "e1", epicTitle: "Epic 1" });

    stack = navReducer(stack, { type: "back" });
    expect(currentRoute(stack)).toEqual({ name: "fleet" });
  });

  it("never pops below the Fleet root", () => {
    const stack = navReducer(INITIAL_NAV_STACK, { type: "back" });
    expect(currentRoute(stack)).toEqual({ name: "fleet" });
    expect(stack).toHaveLength(1);
  });
});
