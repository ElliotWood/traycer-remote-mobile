/**
 * The way INTO settings, published up from the screen that owns the route.
 *
 * Same seam and same reason as `./shell-notifications`, carrying only a
 * callback. Restated because the reason is easy to lose and expensive to
 * rediscover: `useRoute` holds its own `useState` per call site, so an account
 * menu in the header calling its own `useRoute().navigate` would push the URL
 * and update the HEADER's copy of the route, while the screen's copy — the one
 * that decides what renders — never heard. The address bar changes and the
 * page does not.
 *
 * WHY THIS DOES NOT ALSO CARRY SIGN-OUT, which is the load-bearing difference
 * from the bell. A published value is cleared on unmount, and the screen
 * unmounts when it throws — the in-frame `ErrorBoundary` replaces the screen
 * and leaves the header standing. A sign-out that travelled this way would
 * therefore disappear in exactly the state the sign-out button was built for:
 * "a screen erroring" is one of the three cases its own docblock names. So
 * sign-out is passed to the menu directly from `App`, which owns the auth
 * service and cannot unmount without the frame going with it, and only the
 * settings ROUTE — which genuinely is unavailable once the router's owner is
 * gone — travels through here.
 *
 * The consequence is deliberate and visible: when the screen has thrown, the
 * account menu keeps identity and sign-out and drops the "App settings" row.
 * That is honest — there is nothing to navigate with — and it is better than a
 * row that silently does nothing, which is the defect class this client keeps
 * finding.
 */
import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react";

export type ShellSettingsSetter = (open: (() => void) | null) => void;

/**
 * Defaults to a NO-OP rather than throwing, matching `shell-notifications`: a
 * screen rendered outside the frame — a preview, a test — should lose the row,
 * not crash.
 */
const ShellSettingsContext = createContext<ShellSettingsSetter>(
  () => undefined,
);

export function ShellSettingsProvider({
  setOpenSettings,
  children,
}: {
  readonly setOpenSettings: ShellSettingsSetter;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <ShellSettingsContext.Provider value={setOpenSettings}>
      {children}
    </ShellSettingsContext.Provider>
  );
}

/**
 * Publish the settings entry point into the frame's account menu.
 *
 * THE HANDLER MUST BE STABLE — it is the effect's only real dependency, so a
 * fresh closure each render republishes each render. `useCallback` over
 * `navigate` (itself stable) is what makes that true.
 */
export function useShellSettings(onOpenSettings: (() => void) | null): void {
  const setOpenSettings = useContext(ShellSettingsContext);
  useEffect(() => {
    setOpenSettings(onOpenSettings);
    return () => {
      setOpenSettings(null);
    };
  }, [setOpenSettings, onOpenSettings]);
}
