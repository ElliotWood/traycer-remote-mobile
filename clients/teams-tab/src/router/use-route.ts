/**
 * Binds {@link Route} to the address bar.
 *
 * `pushState` for navigation, `popstate` for the back button. Query params are
 * PRESERVED across navigation, because `?preview=`/`?theme=`/`?state=` are the
 * review affordances this project depends on — a drill-in that dropped them
 * would silently end the shoot-before-wire loop, which has already happened
 * once by another route.
 */
import { useCallback, useEffect, useState } from "react";
import { parseRoute, routeToPath, type Route } from "./route";

function currentRoute(): Route {
  if (typeof window === "undefined") return { name: "epics" };
  return parseRoute(window.location.pathname);
}

export interface RouteState {
  readonly route: Route;
  readonly navigate: (next: Route) => void;
  readonly back: () => void;
}

export function useRoute(): RouteState {
  const [route, setRoute] = useState<Route>(currentRoute);

  useEffect(() => {
    const onPop = (): void => {
      setRoute(currentRoute());
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  const navigate = useCallback((next: Route) => {
    // Search is carried over deliberately — see the module docblock.
    const url = `${routeToPath(next)}${window.location.search}`;
    window.history.pushState(null, "", url);
    setRoute(next);
  }, []);

  const back = useCallback(() => {
    window.history.back();
  }, []);

  return { route, navigate, back };
}
