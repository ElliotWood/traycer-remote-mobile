/**
 * THE SEAM: upstream's REAL copy paths driving OUR REAL platform object.
 *
 * Both ends are already green in isolation. gui-app tests `useClipboardCopy`
 * against a `writeText` that resolves; `clipboard-fallback.test.ts` tests the
 * wrapper against a stub navigator. Neither can see the thing that matters,
 * because the defect is what upstream's call sites DO with the rejection that
 * a cross-origin frame produces - which is only visible with both real halves
 * attached. Same shape as `native-notify-retry.test.tsx`.
 *
 * WHAT THE ARMS ARE FOR. Each path is measured three ways:
 *
 *   granted, no fix     THE CONTROL. If a copy cannot be observed to succeed
 *                       here, nothing below distinguishes anything.
 *   refused, no fix     THE DEFECT, stated in the units a user experiences.
 *                       This row asserts the BROKEN behaviour and passes
 *                       whether or not the fix exists, because it never
 *                       installs it - which is what makes it a control rather
 *                       than a regression waiting to happen.
 *   refused, fixed      The repair. This is the row that could have been
 *                       written, and would have failed, before a line of
 *                       `clipboard-fallback.ts` was written.
 *
 * `sonner` and `reportable-error-toast` are mocked as MEASURING INSTRUMENTS,
 * not as stand-ins for anything under test: what the user is told is the
 * observable.
 */
import "../../../gui-app/__tests__/test-browser-apis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useClipboardCopy } from "@/hooks/ui/use-clipboard-copy";
import { copyTerminalCommand } from "@/components/settings/panels/host-doctor-actions";
import {
  installClipboardFallback,
  type ClipboardNavigator,
} from "./clipboard-fallback";

const successToasts = vi.hoisted((): string[] => []);
const errorToasts = vi.hoisted((): string[] => []);

vi.mock("sonner", () => ({
  toast: Object.assign(() => "", {
    success: (message: string): string => {
      successToasts.push(message);
      return message;
    },
  }),
}));

vi.mock("@/lib/reportable-error-toast", () => ({
  reportableErrorToast: (message: string): void => {
    errorToasts.push(message);
  },
}));

/**
 * The real `navigator.clipboard`, swapped per arm and restored after. The
 * wrapper mutates whatever object it is given, so every arm gets a fresh one -
 * a shared object would carry one arm's wrapper into the next and quietly turn
 * the "no fix" rows into fixed ones.
 */
function useNavigator(clipboard: ClipboardNavigator["clipboard"]): void {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: clipboard,
    configurable: true,
    writable: true,
  });
}

function granting(): { writes: string[] } {
  const writes: string[] = [];
  useNavigator({
    writeText: (text: string) => {
      writes.push(text);
      return Promise.resolve();
    },
  });
  return { writes };
}

/** Exactly what the cross-origin arm of the probe measured. */
function refusing(): void {
  useNavigator({
    writeText: () =>
      Promise.reject(new DOMException("Write permission denied.", "NotAllowedError")),
  });
}

/** A permissions policy that refuses, so `installClipboardFallback` stamps honestly. */
const BLOCKED_DOC = { featurePolicy: { allowsFeature: () => false } };

interface Probe {
  copied: boolean;
  errors: number;
  press: () => Promise<void>;
}

/**
 * Renders the REAL `useClipboardCopy` and returns what a user could observe:
 * whether the button flipped to its copied state, and whether the error path
 * ran.
 */
function renderCopyHook(value: string): Probe {
  const state: Probe = {
    copied: false,
    errors: 0,
    press: async () => {},
  };
  function Harness(): null {
    const { copied, copy } = useClipboardCopy({
      resetMs: 1000,
      onSuccess: null,
      onError: () => {
        state.errors += 1;
      },
    });
    state.copied = copied;
    state.press = async () => {
      await act(async () => {
        copy(value);
        // One turn for the native rejection, one for the fallback's resolve.
        await Promise.resolve();
        await Promise.resolve();
      });
    };
    return null;
  }
  render(<Harness />);
  return state;
}

beforeEach(() => {
  successToasts.length = 0;
  errorToasts.length = 0;
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.clipboard;
  vi.restoreAllMocks();
});

describe("seam: useClipboardCopy (EIGHTEEN gui-app components copy through it)", () => {
  it("CONTROL - a granted surface copies, and the harness can see it", async () => {
    const { writes } = granting();
    const probe = renderCopyHook("hello");
    await probe.press();
    expect(writes).toEqual(["hello"]);
    expect(probe.copied).toBe(true);
    expect(probe.errors).toBe(0);
  });

  it("THE DEFECT - on the Teams surface, unfixed, the copy button reports failure", async () => {
    refusing();
    const probe = renderCopyHook("hello");
    await probe.press();
    // Not installed on purpose. This is the shipped Teams tab.
    expect(probe.copied).toBe(false);
    expect(probe.errors).toBe(1);
  });

  it("THE REPAIR - with the shell fallback installed, the same surface copies", async () => {
    refusing();
    const copied: string[] = [];
    installClipboardFallback({
      document: BLOCKED_DOC,
      copy: (text) => {
        copied.push(text);
        return true;
      },
    });
    const probe = renderCopyHook("hello");
    await probe.press();
    expect(copied).toEqual(["hello"]);
    expect(probe.copied).toBe(true);
    expect(probe.errors).toBe(0);
  });

  it("and still reports failure honestly when the fallback cannot copy either", async () => {
    // The repair is not "always claim success". A surface where neither path
    // works must still reach `onError`, or the button lies.
    refusing();
    installClipboardFallback({ document: BLOCKED_DOC, copy: () => false });
    const probe = renderCopyHook("hello");
    await probe.press();
    expect(probe.copied).toBe(false);
    expect(probe.errors).toBe(1);
  });
});

describe("seam: copyTerminalCommand (a direct call site, with its own toasts)", () => {
  const COMMAND = "traycer host restart --port 4123";

  it("CONTROL - a granted surface toasts success", async () => {
    granting();
    await act(async () => {
      copyTerminalCommand(COMMAND);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(successToasts).toEqual(["Command copied to clipboard"]);
    expect(errorToasts).toEqual([]);
  });

  it("THE DEFECT - on the Teams surface, unfixed, the user is told it failed", async () => {
    refusing();
    await act(async () => {
      copyTerminalCommand(COMMAND);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(successToasts).toEqual([]);
    expect(errorToasts).toEqual(["Could not copy command"]);
  });

  it("THE REPAIR - the same surface toasts success and copies the command", async () => {
    refusing();
    const copied: string[] = [];
    installClipboardFallback({
      document: BLOCKED_DOC,
      copy: (text) => {
        copied.push(text);
        return true;
      },
    });
    await act(async () => {
      copyTerminalCommand(COMMAND);
      await Promise.resolve();
      await Promise.resolve();
    });
    // The command itself, not just "something was copied" - a fallback wired to
    // the wrong value toasts success just as convincingly.
    expect(copied).toEqual([COMMAND]);
    expect(successToasts).toEqual(["Command copied to clipboard"]);
    expect(errorToasts).toEqual([]);
  });

  it("stamps the surface on <html> before any of this is pressed", () => {
    refusing();
    installClipboardFallback({ document: BLOCKED_DOC, copy: () => true });
    // The reading a real Teams install answers: `policy-blocked` says Teams
    // does not delegate `clipboard-write` and this module is why copy works.
    expect(document.documentElement.dataset.clipboard).toBe("policy-blocked");
  });
});
