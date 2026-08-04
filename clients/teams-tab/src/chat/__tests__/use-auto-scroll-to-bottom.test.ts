/**
 * @vitest-environment jsdom
 *
 * Ported from mobile's `chat-view.tsx` bottom-anchored scroll. The one rule
 * that matters, and the one a naive "scroll on every render" would violate:
 * new content jumps the scroll ONLY while already at the bottom — a user who
 * has scrolled up to read history must never be yanked back down.
 */
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { RefObject } from "react";
import { useAutoScrollToBottom } from "../use-auto-scroll-to-bottom";

/**
 * `scrollTo` is deliberately shadowed to `undefined` rather than left to
 * whatever this jsdom version happens to implement — the hook's fallback
 * path (`el.scrollTop = el.scrollHeight`) only runs when `scrollTo` is
 * absent, and a jsdom that silently ships a no-op `scrollTo` would make
 * these assertions pass for the wrong reason.
 */
function fakeScrollDiv(props: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): HTMLDivElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollTo", { value: undefined, configurable: true });
  Object.defineProperty(el, "scrollHeight", {
    value: props.scrollHeight,
    configurable: true,
  });
  Object.defineProperty(el, "clientHeight", {
    value: props.clientHeight,
    configurable: true,
  });
  let scrollTop = props.scrollTop;
  Object.defineProperty(el, "scrollTop", {
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v;
    },
    configurable: true,
  });
  return el;
}

describe("useAutoScrollToBottom", () => {
  it("jumps to the new bottom on content while already at the bottom", () => {
    const el = fakeScrollDiv({ scrollHeight: 1000, scrollTop: 1000, clientHeight: 500 });
    const ref: RefObject<HTMLDivElement | null> = { current: el };
    const { rerender } = renderHook(
      ({ contentKey }: { contentKey: string }) =>
        useAutoScrollToBottom(ref, "chat-1", contentKey),
      { initialProps: { contentKey: "a" } },
    );

    Object.defineProperty(el, "scrollHeight", { value: 1400, configurable: true });
    act(() => {
      rerender({ contentKey: "b" });
    });

    expect(el.scrollTop).toBe(1400);
  });

  it("does NOT yank a user who has scrolled up to read history", () => {
    const el = fakeScrollDiv({ scrollHeight: 1000, scrollTop: 1000, clientHeight: 500 });
    const ref: RefObject<HTMLDivElement | null> = { current: el };
    const { result, rerender } = renderHook(
      ({ contentKey }: { contentKey: string }) =>
        useAutoScrollToBottom(ref, "chat-1", contentKey),
      { initialProps: { contentKey: "a" } },
    );

    act(() => {
      el.scrollTop = 100; // well past the 48px threshold
      result.current.handleScroll();
    });
    expect(result.current.isAtBottom).toBe(false);

    Object.defineProperty(el, "scrollHeight", { value: 1400, configurable: true });
    act(() => {
      rerender({ contentKey: "b" });
    });

    // Untouched — still where the user left it, not yanked to the new bottom.
    expect(el.scrollTop).toBe(100);
  });

  it("jumps unconditionally on chat switch, even mid-read", () => {
    const el = fakeScrollDiv({ scrollHeight: 1000, scrollTop: 1000, clientHeight: 500 });
    const ref: RefObject<HTMLDivElement | null> = { current: el };
    const { result, rerender } = renderHook(
      ({ switchKey }: { switchKey: string }) =>
        useAutoScrollToBottom(ref, switchKey, "same-content"),
      { initialProps: { switchKey: "chat-1" } },
    );

    act(() => {
      el.scrollTop = 100;
      result.current.handleScroll();
    });
    expect(result.current.isAtBottom).toBe(false);

    act(() => {
      rerender({ switchKey: "chat-2" });
    });

    expect(el.scrollTop).toBe(1000);
  });

  it("the chip's visibility flips with scroll position, via handleScroll", () => {
    const el = fakeScrollDiv({ scrollHeight: 1000, scrollTop: 1000, clientHeight: 500 });
    const ref: RefObject<HTMLDivElement | null> = { current: el };
    const { result } = renderHook(() => useAutoScrollToBottom(ref, "chat-1", "content"));

    expect(result.current.isAtBottom).toBe(true);

    act(() => {
      el.scrollTop = 0;
      result.current.handleScroll();
    });
    expect(result.current.isAtBottom).toBe(false);

    act(() => {
      el.scrollTop = 1000;
      result.current.handleScroll();
    });
    expect(result.current.isAtBottom).toBe(true);
  });
});
