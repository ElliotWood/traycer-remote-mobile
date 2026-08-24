/**
 * Unit rows for the microphone policy wrapper.
 *
 * These assert the module's own API against a stub navigator, so most of them
 * could only have been written once the module was. The rows that state the
 * DEFECT in user-visible terms - a policy refusal being indistinguishable from
 * a user denial - live in `microphone-seam.test.tsx`, where upstream's real
 * classifier is attached.
 *
 * The negative rows are the load-bearing ones here. A wrapper that re-described
 * every rejection would be worse than no wrapper: it would mislabel "no
 * microphone attached" and, on the PWA where the policy IS granted, would
 * suppress the one message that is correct and actionable.
 */
import { describe, expect, it, vi } from "vitest";
import {
  installMicrophonePolicy,
  MicrophonePolicyError,
  readMicrophonePolicy,
  requestsAudio,
  type MediaDevicesLike,
  type MediaNavigator,
  type MicrophoneSurface,
  type PolicyDocument,
} from "./microphone-policy";

function policyDoc(allowed: boolean | "throws" | "absent"): PolicyDocument {
  if (allowed === "absent") return {};
  return {
    featurePolicy: {
      allowsFeature: (feature: string): boolean => {
        if (allowed === "throws") throw new Error("nope");
        // Asserted rather than ignored: a module that read `camera` here would
        // pass every other row in this file.
        expect(feature).toBe("microphone");
        return allowed;
      },
    },
  };
}

function named(name: string): Error {
  const error = new Error(`${name} raised`);
  error.name = name;
  return error;
}

// A single assertion, not a chain through `unknown`: `MediaStream` is
// assignable to this literal's type, so the downcast is one the compiler will
// take. Nothing here reads a member of it - identity is the whole assertion.
const STREAM = { id: "the-real-stream" } as MediaStream;

interface Harness {
  readonly nav: MediaNavigator;
  readonly surfaces: MicrophoneSurface[];
  readonly calls: (MediaStreamConstraints | undefined)[];
}

function install(
  doc: PolicyDocument,
  outcome: MediaStream | Error,
  // Required rather than defaulted - this package bans default parameter
  // values, and every call site saying which navigator it wants is the point.
  hasDevices: boolean,
): Harness {
  const surfaces: MicrophoneSurface[] = [];
  const calls: (MediaStreamConstraints | undefined)[] = [];
  const devices: MediaDevicesLike = {
    getUserMedia: (constraints: MediaStreamConstraints | undefined) => {
      calls.push(constraints);
      return outcome instanceof Error
        ? Promise.reject(outcome)
        : Promise.resolve(outcome);
    },
  };
  const nav: MediaNavigator = hasDevices ? { mediaDevices: devices } : {};
  installMicrophonePolicy({
    navigator: nav,
    document: doc,
    report: (surface) => surfaces.push(surface),
  });
  return { nav, surfaces, calls };
}

describe("readMicrophonePolicy", () => {
  it("reads featurePolicy", () => {
    expect(readMicrophonePolicy(policyDoc(true))).toBe(true);
    expect(readMicrophonePolicy(policyDoc(false))).toBe(false);
  });

  it("falls back to the spec name permissionsPolicy", () => {
    expect(
      readMicrophonePolicy({
        permissionsPolicy: { allowsFeature: () => false },
      }),
    ).toBe(false);
  });

  it("returns null - not false - when there is no API to ask", () => {
    // The distinction the whole module rests on: unmeasured is not refused.
    expect(readMicrophonePolicy(policyDoc("absent"))).toBeNull();
  });

  it("returns null when the read throws", () => {
    expect(readMicrophonePolicy(policyDoc("throws"))).toBeNull();
  });
});

describe("requestsAudio", () => {
  it("is true for the shapes a dictation request takes", () => {
    expect(requestsAudio({ audio: true })).toBe(true);
    expect(requestsAudio({ audio: { channelCount: 1 } })).toBe(true);
  });

  it("is false for no constraints, audio:false, and video-only", () => {
    expect(requestsAudio(undefined)).toBe(false);
    expect(requestsAudio({ audio: false })).toBe(false);
    expect(requestsAudio({ video: true })).toBe(false);
  });
});

describe("installMicrophonePolicy: the surface it stamps", () => {
  it.each([
    ["granted", policyDoc(true)],
    ["policy-blocked", policyDoc(false)],
    ["unmeasured", policyDoc("absent")],
  ] as const)("reports %s", (expected, doc) => {
    expect(install(doc, STREAM, true).surfaces).toEqual([expected]);
  });

  it("reports no-api when navigator.mediaDevices is absent", () => {
    expect(install(policyDoc(true), STREAM, false).surfaces).toEqual([
      "no-api",
    ]);
  });

  it("stamps at install, before any getUserMedia call", () => {
    // The `data-push` lesson: an attribute that waits for a button press is
    // absent for an unbounded stretch, and absent reads like a broken boot.
    const harness = install(policyDoc(false), STREAM, true);
    expect(harness.surfaces).toEqual(["policy-blocked"]);
    expect(harness.calls).toEqual([]);
  });
});

describe("installMicrophonePolicy: what it re-describes", () => {
  it("re-describes a NotAllowedError on a refused document", async () => {
    const harness = install(policyDoc(false), named("NotAllowedError"), true);
    const error = await harness.nav.mediaDevices
      ?.getUserMedia({ audio: true })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MicrophonePolicyError);
    // The NAME is the mechanism - it must not be the string upstream reads as
    // "the user denied it".
    expect((error as Error).name).toBe("TraycerMicrophonePolicyError");
    expect((error as Error).name).not.toBe("NotAllowedError");
    expect((error as Error).message).toContain("host");
  });

  it("passes a resolved stream through untouched", async () => {
    const harness = install(policyDoc(false), STREAM, true);
    await expect(
      harness.nav.mediaDevices?.getUserMedia({ audio: true }),
    ).resolves.toBe(STREAM);
  });
});

describe("installMicrophonePolicy: what it leaves alone", () => {
  it("propagates a user denial on a GRANTED document", async () => {
    // The PWA at top level: the user really did refuse, "Microphone access is
    // blocked for Traycer" is true, and Open Settings is the right remedy.
    const denial = named("NotAllowedError");
    const harness = install(policyDoc(true), denial, true);
    await expect(
      harness.nav.mediaDevices?.getUserMedia({ audio: true }),
    ).rejects.toBe(denial);
  });

  it("propagates a denial when the policy is UNMEASURED", async () => {
    const denial = named("NotAllowedError");
    const harness = install(policyDoc("absent"), denial, true);
    await expect(
      harness.nav.mediaDevices?.getUserMedia({ audio: true }),
    ).rejects.toBe(denial);
  });

  it("propagates a non-denial rejection even on a refused document", async () => {
    // "There is no microphone attached" is a different fact and not ours to
    // overwrite.
    const missing = named("NotFoundError");
    const harness = install(policyDoc(false), missing, true);
    await expect(
      harness.nav.mediaDevices?.getUserMedia({ audio: true }),
    ).rejects.toBe(missing);
  });

  it("propagates a video-only denial - that is the camera policy, unmeasured here", async () => {
    const denial = named("NotAllowedError");
    const harness = install(policyDoc(false), denial, true);
    await expect(
      harness.nav.mediaDevices?.getUserMedia({ video: true }),
    ).rejects.toBe(denial);
  });
});

describe("installMicrophonePolicy: the policy is re-read per call", () => {
  it("uses the reading at CALL time, not the one taken at install", async () => {
    // A tab framed after load, or a policy read that was unavailable during
    // boot: closing over the install-time value would answer with a fact that
    // has since changed.
    let allowed = true;
    const doc: PolicyDocument = {
      featurePolicy: { allowsFeature: () => allowed },
    };
    const harness = install(doc, named("NotAllowedError"), true);
    expect(harness.surfaces).toEqual(["granted"]);
    allowed = false;
    const error = await harness.nav.mediaDevices
      ?.getUserMedia({ audio: true })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MicrophonePolicyError);
  });
});

describe("installMicrophonePolicy: no API at all", () => {
  it("synthesizes a rejecting mediaDevices rather than leaving it absent", async () => {
    const harness = install(policyDoc(true), STREAM, false);
    const error = await harness.nav.mediaDevices
      ?.getUserMedia({ audio: true })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MicrophonePolicyError);
    expect((error as Error).message).toContain("secure");
  });

  it("leaves the app as it was when the navigator refuses the definition", () => {
    const frozen = Object.freeze({}) as MediaNavigator;
    const surfaces: MicrophoneSurface[] = [];
    expect(() =>
      installMicrophonePolicy({
        navigator: frozen,
        document: policyDoc(true),
        report: (surface) => surfaces.push(surface),
      }),
    ).not.toThrow();
    expect(surfaces).toEqual(["no-api"]);
  });
});

describe("installMicrophonePolicy: the default report", () => {
  it("stamps html[data-microphone]", () => {
    const nav: MediaNavigator = {
      mediaDevices: { getUserMedia: () => Promise.resolve(STREAM) },
    };
    installMicrophonePolicy({ navigator: nav, document: policyDoc(false) });
    expect(document.documentElement.dataset.microphone).toBe("policy-blocked");
    delete document.documentElement.dataset.microphone;
    vi.restoreAllMocks();
  });
});
