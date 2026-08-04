/**
 * Bottom-anchored scroll — ported from mobile's `chat-view.tsx`, not
 * reinvented. Jump (never smooth) on chat switch and on new content while
 * already at the bottom, so a user who has scrolled up to read history is
 * never yanked back down. The caller-rendered chip does the one smooth
 * scroll, on click.
 */
import { useEffect, useState, type RefObject } from "react";

const SCROLL_BOTTOM_THRESHOLD_PX = 48;

export interface AutoScrollToBottom {
  readonly isAtBottom: boolean;
  readonly handleScroll: () => void;
  readonly scrollToBottom: (smooth: boolean) => void;
}

/**
 * @param scrollRef The scrollable container — caller-owned, since the pane
 * and the full-screen route scroll two different elements.
 * @param switchKey Changes when the chat itself changes (e.g. `${epicId}:${chatId}`)
 * — triggers a jump, unconditionally.
 * @param contentKey Changes when new content arrives (e.g. the messages array
 * reference) — triggers a jump only while already at the bottom.
 */
export function useAutoScrollToBottom(
  scrollRef: RefObject<HTMLDivElement | null>,
  switchKey: string,
  contentKey: unknown,
): AutoScrollToBottom {
  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollToBottom = (smooth: boolean): void => {
    const el = scrollRef.current;
    if (el === null) return;
    // jsdom (tests) has no `scrollTo` — fall back to the plain assignment,
    // which every real DOM (and jsdom) supports.
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
    setIsAtBottom(true);
  };

  // Auto-scroll on open / chat switch.
  useEffect(() => {
    scrollToBottom(false);
    // Only on switch — not a dependency on every content change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switchKey]);

  // Auto-scroll on new content, but only while already at the bottom.
  useEffect(() => {
    if (isAtBottom) scrollToBottom(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey]);

  const handleScroll = (): void => {
    const el = scrollRef.current;
    if (el === null) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD_PX;
    setIsAtBottom(atBottom);
  };

  return { isAtBottom, handleScroll, scrollToBottom };
}
