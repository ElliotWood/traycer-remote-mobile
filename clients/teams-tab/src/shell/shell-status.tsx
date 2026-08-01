/**
 * The slot the shell exposes to a descendant — and the reason the epic status
 * row could not be pinned until now.
 *
 * THE CONSTRAINT. The shell must be ONE instance (a second one costs the
 * frame's whole purpose — measured at `mounts 1 -> 2` when it happened), so
 * it lives at the top of `App`. But the status it displays is derived from
 * `epic.subscribe`, whose hook lives several levels down in `EpicScreen`,
 * because a subscription cannot be opened behind a conditional. State that is
 * born below the frame has to travel UP to be rendered inside it.
 *
 * So the row sat at the top of the screen content instead, and scrolled away
 * the moment the epic's rows arrived. That was the disclosed cost of taking
 * one shell; this file pays it.
 *
 * DATA TRAVELS, NOT A NODE. The obvious version publishes a `ReactNode` into
 * the shell. That makes every render a new element, so the effect that
 * publishes it either re-fires forever or needs its dependencies lied about.
 * `EpicConnectionState` is a four-member union with one string field: its
 * identity is `kind` plus `ageLabel`, both comparable, and the shell renders
 * the row itself. The seam carries the fact; the frame owns the presentation.
 *
 * A SCREEN THAT PUBLISHES NOTHING GETS NO ROW. `null` is the default and the
 * unmount value, so leaving the epic screen removes the strip rather than
 * stranding a "live" pill over a list it no longer describes.
 */
import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import type { EpicConnectionState } from "./epic-status-row";

export type ShellStatusSetter = (state: EpicConnectionState | null) => void;

/**
 * Defaults to a NO-OP rather than throwing.
 *
 * A screen rendered outside the shell — a preview harness, a test — should
 * lose its status strip, not crash. The strip is a disclosure about a
 * connection; the connection is what matters, and a missing frame is a
 * developer's problem rather than a user's.
 */
const ShellStatusContext = createContext<ShellStatusSetter>(() => undefined);

export function ShellStatusProvider({
  setStatus,
  children,
}: {
  readonly setStatus: ShellStatusSetter;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <ShellStatusContext.Provider value={setStatus}>
      {children}
    </ShellStatusContext.Provider>
  );
}

/**
 * Publish this screen's connection state into the shell's status region.
 *
 * The dependency list is the state's FIELDS, not the object, because the
 * object is rebuilt on every render of the screen that owns it. Depending on
 * the object would publish on every render — harmless in effect but a render
 * loop through the parent, and the kind of thing that is diagnosed as "the
 * shell is slow" three weeks later.
 *
 * Cleanup clears the slot. React runs the outgoing screen's cleanup before
 * the incoming screen's effect, so navigating between two screens that both
 * publish does not blink through an empty strip.
 */
export function useShellStatus(state: EpicConnectionState | null): void {
  const setStatus = useContext(ShellStatusContext);
  const kind = state?.kind ?? null;
  const ageLabel = state !== null && state.kind === "stale" ? state.ageLabel : null;
  useEffect(() => {
    setStatus(state);
    return () => {
      setStatus(null);
    };
    // `state` is deliberately absent: see above. `kind` and `ageLabel` are
    // its entire identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setStatus, kind, ageLabel]);
}
