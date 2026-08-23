import { afterEach, describe, expect, it, vi } from "vitest";

import {
  execCommandCopy,
  installClipboardFallback,
  readClipboardWritePolicy,
  type ClipboardNavigator,
  type ClipboardSurface,
  type PolicyDocument,
} from "./clipboard-fallback";

function policyDoc(allowed: boolean): PolicyDocument {
  return { featurePolicy: { allowsFeature: () => allowed } };
}

/** A navigator whose native write resolves - the surface that needs nothing. */
function grantingNavigator(): {
  nav: ClipboardNavigator;
  writes: string[];
} {
  const writes: string[] = [];
  const nav: ClipboardNavigator = {
    clipboard: {
      writeText: (text: string) => {
        writes.push(text);
        return Promise.resolve();
      },
    },
  };
  return { nav, writes };
}

/** A navigator whose native write rejects - the Teams tab, measured. */
function refusingNavigator(cause: unknown): {
  nav: ClipboardNavigator;
  attempts: string[];
} {
  const attempts: string[] = [];
  const nav: ClipboardNavigator = {
    clipboard: {
      writeText: (text: string) => {
        attempts.push(text);
        return Promise.reject(cause);
      },
    },
  };
  return { nav, attempts };
}

function recorder(): {
  reported: ClipboardSurface[];
  report: (s: ClipboardSurface) => void;
} {
  const reported: ClipboardSurface[] = [];
  return { reported, report: (s) => reported.push(s) };
}

afterEach(() => {
  delete document.documentElement.dataset.clipboard;
  vi.restoreAllMocks();
});

describe("readClipboardWritePolicy", () => {
  it("reads a granted policy as true", () => {
    expect(readClipboardWritePolicy(policyDoc(true))).toBe(true);
  });

  it("reads a refused policy as false", () => {
    expect(readClipboardWritePolicy(policyDoc(false))).toBe(false);
  });

  it("answers NULL, not false, where there is no policy API to ask", () => {
    // The distinction the whole module rests on. `false` here would report
    // `policy-blocked` on Firefox and Safari, which were never asked - and the
    // attribute exists precisely to tell a measurement from its absence.
    expect(readClipboardWritePolicy({})).toBeNull();
  });

  it("answers null when the policy read throws", () => {
    expect(
      readClipboardWritePolicy({
        featurePolicy: {
          allowsFeature: () => {
            throw new Error("nope");
          },
        },
      }),
    ).toBeNull();
  });

  it("falls back to permissionsPolicy where featurePolicy is absent", () => {
    expect(
      readClipboardWritePolicy({
        permissionsPolicy: { allowsFeature: () => true },
      }),
    ).toBe(true);
  });

  it("asks about clipboard-write specifically", () => {
    // A read that asks about the wrong feature returns a well-formed boolean
    // and passes every assertion above it.
    const asked: string[] = [];
    readClipboardWritePolicy({
      featurePolicy: {
        allowsFeature: (feature) => {
          asked.push(feature);
          return true;
        },
      },
    });
    expect(asked).toEqual(["clipboard-write"]);
  });
});

describe("installClipboardFallback - the surface is stamped at install", () => {
  it("stamps granted, before any copy is attempted", () => {
    const { nav } = grantingNavigator();
    const { reported, report } = recorder();
    const surface = installClipboardFallback({
      navigator: nav,
      document: policyDoc(true),
      copy: () => true,
      report,
    });
    expect(surface).toBe("granted");
    // Exactly one report, and it happened without anything calling writeText.
    // An attribute that only appears on the first copy is absent for an
    // unbounded stretch, and absent reads the same as never wired.
    expect(reported).toEqual(["granted"]);
  });

  it("stamps policy-blocked on the measured Teams surface", () => {
    const { nav } = refusingNavigator(new Error("x"));
    const { reported, report } = recorder();
    expect(
      installClipboardFallback({
        navigator: nav,
        document: policyDoc(false),
        copy: () => true,
        report,
      }),
    ).toBe("policy-blocked");
    expect(reported).toEqual(["policy-blocked"]);
  });

  it("stamps unmeasured where the policy API is absent - NOT policy-blocked", () => {
    const { nav } = grantingNavigator();
    const { reported, report } = recorder();
    expect(
      installClipboardFallback({
        navigator: nav,
        document: {},
        copy: () => true,
        report,
      }),
    ).toBe("unmeasured");
    expect(reported).toEqual(["unmeasured"]);
  });

  it("stamps no-api where navigator.clipboard is absent", () => {
    const nav: ClipboardNavigator = {};
    const { reported, report } = recorder();
    expect(
      installClipboardFallback({
        navigator: nav,
        document: policyDoc(true),
        copy: () => true,
        report,
      }),
    ).toBe("no-api");
    expect(reported).toEqual(["no-api"]);
  });

  it("writes the surface to <html data-clipboard> by default", () => {
    const { nav } = refusingNavigator(new Error("x"));
    installClipboardFallback({
      navigator: nav,
      document: policyDoc(false),
      copy: () => true,
    });
    expect(document.documentElement.dataset.clipboard).toBe("policy-blocked");
  });
});

describe("installClipboardFallback - the wrapper", () => {
  it("is installed on a GRANTED surface too, and is inert there", async () => {
    // The control for the whole design: behaviour does not branch on the policy
    // reading, so a wrong reading cannot break a working surface. If this row
    // needed a `policy-blocked` document to pass, the reading would be load
    // bearing and every browser without the API would be at its mercy.
    const { nav, writes } = grantingNavigator();
    const { reported, report } = recorder();
    const fallback = vi.fn(() => true);
    installClipboardFallback({
      navigator: nav,
      document: policyDoc(true),
      copy: fallback,
      report,
    });
    await nav.clipboard?.writeText("hello");
    expect(writes).toEqual(["hello"]);
    expect(fallback).not.toHaveBeenCalled();
    // And nothing was reported after the install stamp.
    expect(reported).toEqual(["granted"]);
  });

  it("falls back on a GRANTED surface whose native write is refused anyway", async () => {
    // The other half of "the wrapper does not branch on the policy reading",
    // and a real case rather than a symmetry: Firefox gates `writeText` on a
    // permission the permissions policy knows nothing about, so a document can
    // be granted the FEATURE and refused the WRITE. An install that only
    // wrapped `policy-blocked` surfaces leaves this one broken, and every
    // assertion written against a refusing NAVIGATOR plus a blocked DOCUMENT
    // passes while it does.
    const { nav } = refusingNavigator(new DOMException("no", "NotAllowedError"));
    const copied: string[] = [];
    installClipboardFallback({
      navigator: nav,
      document: policyDoc(true),
      copy: (text) => {
        copied.push(text);
        return true;
      },
      report: () => {},
    });
    await expect(nav.clipboard?.writeText("hello")).resolves.toBeUndefined();
    expect(copied).toEqual(["hello"]);
  });

  it("does not report fallback-copied when the native write succeeded", async () => {
    // `.catch()` in place of `then(undefined, ...)` would run the fallback
    // AFTER a successful write, copy twice, and claim the fallback on a surface
    // that never needed it.
    const { nav } = grantingNavigator();
    const { reported, report } = recorder();
    installClipboardFallback({
      navigator: nav,
      document: policyDoc(true),
      copy: () => true,
      report,
    });
    await nav.clipboard?.writeText("hello");
    expect(reported).not.toContain("fallback-copied");
  });

  it("falls back when the native write is refused, and resolves", async () => {
    const { nav, attempts } = refusingNavigator(
      new DOMException("denied", "NotAllowedError"),
    );
    const copied: string[] = [];
    installClipboardFallback({
      navigator: nav,
      document: policyDoc(false),
      copy: (text) => {
        copied.push(text);
        return true;
      },
      report: () => {},
    });
    await expect(nav.clipboard?.writeText("command --flag")).resolves.toBeUndefined();
    // The native call is still tried first - this is a fallback, not a bypass.
    expect(attempts).toEqual(["command --flag"]);
    // And the fallback gets the SAME text. A wrapper that copied the wrong
    // value resolves just as cleanly.
    expect(copied).toEqual(["command --flag"]);
  });

  it("reports fallback-copied after a successful fallback", async () => {
    const { nav } = refusingNavigator(new Error("x"));
    const { reported, report } = recorder();
    installClipboardFallback({
      navigator: nav,
      document: policyDoc(false),
      copy: () => true,
      report,
    });
    await nav.clipboard?.writeText("x");
    expect(reported).toEqual(["policy-blocked", "fallback-copied"]);
  });

  it("rejects with the ORIGINAL cause when the fallback also fails", async () => {
    const cause = new DOMException("denied", "NotAllowedError");
    const { nav } = refusingNavigator(cause);
    installClipboardFallback({
      navigator: nav,
      document: policyDoc(false),
      copy: () => false,
      report: () => {},
    });
    // Not a new Error: `use-clipboard-copy.ts` logs whatever arrives here, and
    // `NotAllowedError` from the real API is worth more to whoever reads that
    // log than anything invented in this module.
    await expect(nav.clipboard?.writeText("x")).rejects.toBe(cause);
  });

  it("reports fallback-failed when neither path copied", async () => {
    const { nav } = refusingNavigator(new Error("x"));
    const { reported, report } = recorder();
    installClipboardFallback({
      navigator: nav,
      document: policyDoc(false),
      copy: () => false,
      report,
    });
    await nav.clipboard?.writeText("x").catch(() => {});
    expect(reported).toEqual(["policy-blocked", "fallback-failed"]);
  });
});

describe("installClipboardFallback - no clipboard object at all", () => {
  it("synthesizes a writeText that copies through the fallback", async () => {
    const nav: ClipboardNavigator = {};
    const copied: string[] = [];
    installClipboardFallback({
      navigator: nav,
      document: {},
      copy: (text) => {
        copied.push(text);
        return true;
      },
      report: () => {},
    });
    // gui-app reads `navigator.clipboard.writeText` with no guard, so an absent
    // object throws SYNCHRONOUSLY at ten of its eleven call sites. Defining one
    // is what turns that into a copy.
    await expect(nav.clipboard?.writeText("hi")).resolves.toBeUndefined();
    expect(copied).toEqual(["hi"]);
  });

  it("rejects from the synthesized writeText when the fallback fails", async () => {
    const nav: ClipboardNavigator = {};
    installClipboardFallback({
      navigator: nav,
      document: {},
      copy: () => false,
      report: () => {},
    });
    await expect(nav.clipboard?.writeText("hi")).rejects.toBeInstanceOf(Error);
  });
});

describe("execCommandCopy", () => {
  it("copies through a textarea and cleans it up", () => {
    const exec = vi.fn(() => true);
    // jsdom has no `execCommand`; this is the seam the real browser provides.
    Object.defineProperty(document, "execCommand", {
      value: exec,
      configurable: true,
      writable: true,
    });
    const before = document.body.childElementCount;
    expect(execCommandCopy(document, "payload")).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
    // No orphan textarea left in the DOM.
    expect(document.body.childElementCount).toBe(before);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("returns false and still cleans up when execCommand throws", () => {
    Object.defineProperty(document, "execCommand", {
      value: () => {
        throw new Error("no");
      },
      configurable: true,
      writable: true,
    });
    expect(execCommandCopy(document, "payload")).toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("reports a refused copy as false", () => {
    Object.defineProperty(document, "execCommand", {
      value: () => false,
      configurable: true,
      writable: true,
    });
    expect(execCommandCopy(document, "payload")).toBe(false);
  });

  it("puts the text into the textarea it copies from", () => {
    let seen: string | null = null;
    Object.defineProperty(document, "execCommand", {
      value: () => {
        seen = document.querySelector("textarea")?.value ?? null;
        return true;
      },
      configurable: true,
      writable: true,
    });
    execCommandCopy(document, "payload");
    // A copy that ran against an EMPTY textarea returns true just the same.
    expect(seen).toBe("payload");
  });
});
