// @vitest-environment jsdom
/**
 * The user requirement, end-to-end through a REAL `popstate`:
 *
 *   "the back button on phone needs to navigate back on the app not close the
 *    web or go all the way back to root"
 *
 * jsdom implements session history (`pushState`/`back`/`go`) and fires real
 * `popstate` events, so these drive the actual browser event rather than
 * invoking the handler directly — an important distinction, because a test that
 * called an exported handler would still pass if `NavHost` forgot to
 * `addEventListener`, which is precisely the bug class here.
 *
 * The harness below is a faithful miniature of `app-shell.tsx`: the same
 * `navReducer` stack, the same `NavHost` wiring, plus one `useDismissLayer`
 * layer standing in for a sheet/form. Every assertion is about observable
 * screen state, never about internal history bookkeeping.
 */
import { useCallback, useReducer, useState, type ReactElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  currentRoute,
  INITIAL_NAV_STACK,
  navReducer,
  routeDepth,
  type NavAction,
  type NavStack,
} from "../nav";
import { depthStamp, readForeignDepth } from "../back-stack";
import { NavHost, useDismissLayer, useNavBack } from "../nav-host";
import { resetDraftsForTest, useDraft } from "../drafts";
import { fireEvent, render, screen, waitFor } from "@/test-utils/dom";
import type { Dispatch } from "react";

/**
 * jsdom keeps ONE session history for the whole file, so without this each test
 * would mount on top of the previous test's stamped entries — which `NavHost`
 * correctly reads as "this tab reloaded mid-stack" and collapses, breaking the
 * test for a reason that cannot happen in a real fresh load. A pushed, unstamped
 * entry is exactly what the app really boots onto. (The collapse path itself is
 * covered deliberately, in its own test at the bottom.)
 */
beforeEach(() => {
  window.history.pushState(null, "");
  resetDraftsForTest();
});

/** Stands in for the chat composer / new-epic form: text that must survive a pop. */
function DraftBox(): ReactElement {
  const draft = useDraft("harness");
  return (
    <input aria-label="draft" value={draft.value} onChange={(event) => draft.set(event.target.value)} />
  );
}

function Screen({
  stack,
  dispatch,
}: {
  readonly stack: NavStack;
  readonly dispatch: Dispatch<NavAction>;
}): ReactElement {
  const [sheetOpen, setSheetOpen] = useState(false);
  const dismissSheet = useDismissLayer(sheetOpen, () => setSheetOpen(false));
  const back = useNavBack();
  const route = currentRoute(stack);

  return (
    <div>
      <span data-testid="route">{route.name}</span>
      <span data-testid="sheet">{sheetOpen ? "open" : "closed"}</span>
      {/* Only on the chat route, so popping genuinely unmounts it — the whole
          point of the draft test below. */}
      {route.name === "chat" && <DraftBox />}
      <button type="button" onClick={() => dispatch({ type: "open-epic", epicId: "e1", epicTitle: "E" })}>
        open epic
      </button>
      <button
        type="button"
        onClick={() => dispatch({ type: "open-chat", epicId: "e1", chatId: "c1", chatTitle: "C" })}
      >
        open chat
      </button>
      <button type="button" onClick={() => setSheetOpen(true)}>
        open sheet
      </button>
      <button type="button" onClick={dismissSheet}>
        dismiss sheet
      </button>
      <button type="button" onClick={back}>
        in-app back
      </button>
    </div>
  );
}

function Harness(): ReactElement {
  const [stack, dispatch] = useReducer(navReducer, INITIAL_NAV_STACK);
  const popRoutes = useCallback((count: number) => {
    for (let index = 0; index < count; index += 1) {
      dispatch({ type: "back" });
    }
  }, []);
  return (
    <NavHost routeDepth={routeDepth(stack)} onPopRoutes={popRoutes}>
      <Screen stack={stack} dispatch={dispatch} />
    </NavHost>
  );
}

function tap(label: string): void {
  fireEvent.click(screen.getByText(label));
}

const routeName = (): string => screen.getByTestId("route").textContent ?? "";
const sheetState = (): string => screen.getByTestId("sheet").textContent ?? "";

/** Drive the platform gesture itself: Android hardware back / iOS back-swipe both land as a `popstate`. */
async function osBack(expected: () => void): Promise<void> {
  window.history.back();
  await waitFor(expected);
}

describe("NavHost — OS back walks the app's own stack", () => {
  it("pops chat → epic → fleet, one level per back", async () => {
    render(<Harness />);
    tap("open epic");
    tap("open chat");
    expect(routeName()).toBe("chat");

    await osBack(() => {
      expect(routeName()).toBe("epic");
    });
    // The core of the requirement: one back from a deep screen lands on its
    // parent, NOT on the root.
    expect(routeName()).toBe("epic");

    await osBack(() => {
      expect(routeName()).toBe("fleet");
    });
  });

  it("does not jump to root from the deepest screen", async () => {
    render(<Harness />);
    tap("open epic");
    tap("open chat");

    await osBack(() => {
      expect(routeName()).toBe("epic");
    });
    // Assert the negative explicitly: "epic" is not merely the first thing
    // observed, it is still true after the dust settles.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(routeName()).toBe("epic");
  });

  it("closes an open sheet before touching the screen underneath it", async () => {
    render(<Harness />);
    tap("open epic");
    tap("open chat");
    tap("open sheet");
    expect(sheetState()).toBe("open");

    await osBack(() => {
      expect(sheetState()).toBe("closed");
    });
    // The route must be untouched — closing a modal is not leaving the screen.
    expect(routeName()).toBe("chat");

    await osBack(() => {
      expect(routeName()).toBe("epic");
    });
  });

  it("closes a layer opened at the FLEET root instead of leaving the app", async () => {
    // The create-epic screen's exact situation: a form on the stack root. Before
    // this module the OS gesture closed the whole PWA from here.
    render(<Harness />);
    tap("open sheet");
    expect(sheetState()).toBe("open");

    await osBack(() => {
      expect(sheetState()).toBe("closed");
    });
    expect(routeName()).toBe("fleet");
  });

  it("leaves the fleet root alone — the one place the platform default is correct", async () => {
    render(<Harness />);
    expect(routeName()).toBe("fleet");

    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Nothing to consume: no crash, no phantom route change. The browser has
    // already discarded the entry, which in an installed PWA is what closes it.
    expect(routeName()).toBe("fleet");
    expect(sheetState()).toBe("closed");
  });
});

describe("NavHost — the in-app affordance and the OS gesture are one model", () => {
  it("the in-app back button pops exactly one level, like the gesture", async () => {
    render(<Harness />);
    tap("open epic");
    tap("open chat");

    tap("in-app back");
    await waitFor(() => {
      expect(routeName()).toBe("epic");
    });
    // Not two levels: an in-app back that both dispatched AND touched history
    // would double-pop and land here on "fleet".
    expect(routeName()).toBe("epic");
  });

  it("an in-app sheet dismissal keeps history in step, so the NEXT gesture still pops a route", async () => {
    // The drift bug: if closing a sheet bypassed history it would leave an
    // orphan entry, and this second back would consume the orphan and appear to
    // do nothing instead of popping chat → epic.
    render(<Harness />);
    tap("open epic");
    tap("open chat");
    tap("open sheet");

    tap("dismiss sheet");
    await waitFor(() => {
      expect(sheetState()).toBe("closed");
    });
    expect(routeName()).toBe("chat");

    await osBack(() => {
      expect(routeName()).toBe("epic");
    });
  });
});

describe("NavHost — a hard refresh mid-stack restores sanely", () => {
  it("recovers from stale entries left by a reload, so back still works afterwards", async () => {
    // Reconstruct the history a real reload leaves behind: entries stamped by a
    // PREVIOUS page load (hence a foreign session id), one per level the user
    // had drilled to — fleet → epic → chat. Reloading here boots the app at
    // Fleet while the current entry still claims depth 2.
    const previousLoad = "session-before-the-refresh";
    window.history.replaceState(depthStamp(0, previousLoad), "");
    window.history.pushState(depthStamp(1, previousLoad), "");
    window.history.pushState(depthStamp(2, previousLoad), "");
    render(<Harness />);
    await waitFor(() => {
      expect(routeName()).toBe("fleet");
    });

    // The proof it recovered: depth bookkeeping is consistent again, so a layer
    // opened now is still closed by exactly one back. Without session-scoped
    // stamps the stale depth-2 entry reads as deeper than our committed depth,
    // `unitsToConsume` clamps to zero, and this back does nothing.
    tap("open sheet");
    await osBack(() => {
      expect(sheetState()).toBe("closed");
    });
    expect(routeName()).toBe("fleet");
  });

  it("collapses the stale entries, so back at the root is not swallowed by dead taps", async () => {
    const previousLoad = "session-before-the-refresh";
    window.history.replaceState(depthStamp(0, previousLoad), "");
    window.history.pushState(depthStamp(1, previousLoad), "");
    window.history.pushState(depthStamp(2, previousLoad), "");
    expect(readForeignDepth(window.history.state, "any-current-session")).toBe(2);

    // The collapse is a real traversal, so wait for it to land rather than
    // assuming it is synchronous.
    const collapsed = new Promise<void>((resolve) => {
      window.addEventListener("popstate", () => resolve(), { once: true });
    });
    render(<Harness />);
    await collapsed;

    // Back on the app's true root: the two entries describing screens that no
    // longer exist are behind us, not between the user and leaving the app.
    expect(readForeignDepth(window.history.state, "any-current-session")).toBe(0);
  });

  it("still pops one level at a time after a reload — stale entries do not become app levels", async () => {
    const previousLoad = "session-before-the-refresh";
    window.history.replaceState(depthStamp(0, previousLoad), "");
    window.history.pushState(depthStamp(1, previousLoad), "");
    render(<Harness />);
    tap("open epic");
    tap("open chat");

    await osBack(() => {
      expect(routeName()).toBe("epic");
    });
    expect(routeName()).toBe("epic");
  });
});

describe("NavHost — unsent text survives a pop", () => {
  it("keeps a typed draft when the screen is popped and re-entered", async () => {
    render(<Harness />);
    tap("open epic");
    tap("open chat");
    fireEvent.change(screen.getByLabelText("draft"), {
      target: { value: "half-written thought" },
    });
    expect(screen.getByLabelText<HTMLInputElement>("draft").value).toBe("half-written thought");

    // Popping the chat UNMOUNTS the input (it is only rendered on the chat
    // route), which is what used to destroy the text.
    await osBack(() => {
      expect(routeName()).toBe("epic");
    });
    expect(screen.queryByLabelText("draft")).toBeNull();

    // No confirm dialog was shown, and re-entering finds the text intact.
    tap("open chat");
    expect(screen.getByLabelText<HTMLInputElement>("draft").value).toBe("half-written thought");
  });
});
