/**
 * The sign-in gate state machine (T4, Flow 1) as a pure projection.
 *
 * `App` renders exactly one screen; which one is a total function of the auth
 * status and whether a host is configured. Keeping the decision here (rather
 * than inline in the component) makes the gate unit-testable without a DOM and
 * keeps the render path a trivial exhaustive switch:
 *
 *   signed-out  → sign-in prompt (with the last terminal error, if any)
 *   signing-in  → device-flow progress (userCode + link) / "starting…"
 *   signed-in   → the app shell, UNLESS no host is configured, in which case
 *                 the "set VITE_HOST_WS_URL" prompt (RPCs can never reach a
 *                 host, so the fleet would be permanently empty — say why).
 */
import type {
  DeviceFlowProgress,
  MobileAuthError,
  MobileAuthStatus,
} from "@/host/auth-service";

export type AppScreen =
  | { readonly kind: "sign-in"; readonly error: MobileAuthError | null }
  | { readonly kind: "signing-in"; readonly progress: DeviceFlowProgress | null }
  | { readonly kind: "no-host" }
  | { readonly kind: "signed-in" };

/** The two pre-auth screens, narrowed for the sign-in view. */
export type SignInScreen = Extract<
  AppScreen,
  { kind: "sign-in" } | { kind: "signing-in" }
>;

export function selectAppScreen(
  status: MobileAuthStatus,
  hasHostClient: boolean,
): AppScreen {
  switch (status.kind) {
    case "signed-out":
      return { kind: "sign-in", error: status.error };
    case "signing-in":
      return { kind: "signing-in", progress: status.progress };
    case "signed-in":
      return hasHostClient ? { kind: "signed-in" } : { kind: "no-host" };
  }
}
