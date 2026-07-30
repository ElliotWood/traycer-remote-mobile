/**
 * Unsent text survives a back navigation.
 *
 * ## Why this lives next to the router
 *
 * Popping a screen unmounts it, and every text input in this app holds its
 * value in the unmounting component's own `useState` — so before this module,
 * backing out of a chat with a half-typed message destroyed it. That is a
 * navigation problem, not a form problem, which is why it is solved here
 * alongside `nav-host.tsx` rather than inside each screen.
 *
 * ## The rule: PRESERVE, never confirm
 *
 * The pop happens immediately and the text is still there when the user comes
 * back. There is deliberately no "discard changes?" dialog. Three reasons, in
 * order of how much they settle it:
 *
 *   1. Confirm-before-discard is not honestly implementable for the OS gesture.
 *      There is no `beforepopstate` — by the time `popstate` fires the entry is
 *      already gone and, on iOS, the back-swipe animation has already finished.
 *      "Confirming" would mean re-pushing a fake entry to undo a navigation the
 *      user has already seen complete. It would work for the in-app back button
 *      and not for the gesture, which is exactly the two-models-that-drift
 *      outcome the whole navigation rework exists to prevent.
 *   2. It matches what native messaging apps do. Back out of a thread in iOS
 *      Messages, WhatsApp or Slack and the draft is waiting when you return.
 *      Users already expect their text to be kept, not to be interrogated.
 *   3. A modal on every back-out of any screen where a single character was
 *      typed is worse than the problem it guards against — and the thing it
 *      guards against (losing work) is fully solved by keeping the text.
 *
 * Drafts are per-key, so two chats never share one, and are cleared explicitly
 * on a successful send/submit — the point at which the text has become a real
 * message and a leftover draft would be a duplicate-looking bug.
 *
 * In-memory for the tab's lifetime: it is the pop/return round trip that has to
 * survive, and keeping unsent user prose out of `localStorage` means sign-out
 * and `clearLocalData()` have nothing extra to sweep, and a shared phone leaks
 * nothing across a reload. A hard refresh therefore does lose a draft — the
 * same as the reload dropping the nav stack, and the platform already warns
 * about reloading a page with unsubmitted input.
 */
import { useCallback, useState } from "react";

const drafts = new Map<string, string>();

/** Stable draft key for a chat's composer. */
export function chatDraftKey(chatId: string): string {
  return `chat:${chatId}`;
}

/** Stable draft key for the Fleet's new-epic form (there is only one). */
export const NEW_EPIC_DRAFT_KEY = "new-epic";

/** Stable draft key for the new-agent form, which differs per parent within an epic. */
export function newAgentDraftKey(epicId: string, parentId: string | null): string {
  return `new-agent:${epicId}:${parentId ?? "root"}`;
}

export function readDraft(key: string): string {
  return drafts.get(key) ?? "";
}

export function writeDraft(key: string, value: string): void {
  if (value === "") {
    // Don't retain an empty string: an emptied field is indistinguishable from
    // a never-typed one, and keeping the entry would grow the map for every
    // chat merely *visited*.
    drafts.delete(key);
    return;
  }
  drafts.set(key, value);
}

export function clearDraft(key: string): void {
  drafts.delete(key);
}

/** Test-only reset, so one test's leftover draft can never leak into the next. */
export function resetDraftsForTest(): void {
  drafts.clear();
}

export interface Draft {
  readonly value: string;
  readonly set: (next: string) => void;
  /** Call on a successful send/submit — see the docblock on why that is the one place drafts are dropped. */
  readonly clear: () => void;
}

/**
 * A text value that outlives its component. Drop-in for a
 * `useState("")` + `onChange` pair.
 *
 * The `key`-change reconciliation is the "adjust state when a prop changes"
 * pattern already used in `composer.tsx`: it makes the hook correct even if a
 * caller ever reuses one mounted input for two different draft identities,
 * rather than relying on the caller remounting (which today's callers do, via
 * their route `key`) and silently showing the wrong chat's text if that ever
 * stops being true.
 */
export function useDraft(key: string): Draft {
  const [value, setValue] = useState(() => readDraft(key));
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setValue(readDraft(key));
  }

  const set = useCallback(
    (next: string): void => {
      writeDraft(key, next);
      setValue(next);
    },
    [key],
  );
  const clear = useCallback((): void => {
    clearDraft(key);
    setValue("");
  }, [key]);

  // A render-phase `setValue` above makes React re-run this component before
  // committing, so `value` is already the new key's text by the render that
  // actually paints — the same guarantee `composer.tsx` relies on.
  return { value, set, clear };
}
