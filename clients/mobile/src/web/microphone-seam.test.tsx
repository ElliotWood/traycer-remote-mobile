/**
 * THE SEAM: upstream's REAL dictation classifier driving OUR REAL wrapper.
 *
 * Both ends are already green in isolation. gui-app tests `useVoiceDictation`
 * against a `getUserMedia` it controls; `microphone-policy.test.ts` tests the
 * wrapper against a stub navigator. Neither can see the thing that matters,
 * because the defect is what upstream's classifier CONCLUDES from the rejection
 * a cross-origin frame produces - which is only visible with both real halves
 * attached. Same shape as `clipboard-seam.test.tsx`.
 *
 * WHAT THE ARMS ARE FOR. Each is the same rejection, and only the policy and
 * the presence of the wrapper change:
 *
 *   granted, no fix     THE CONTROL. A user really did deny it, and
 *                       "Microphone access is blocked for Traycer" is TRUE.
 *                       If this row did not say that, nothing below would
 *                       distinguish a fix from a blanket suppression.
 *   refused, no fix     THE DEFECT, in the units a user experiences. It asserts
 *                       the BROKEN behaviour and never installs the wrapper, so
 *                       it passes whether or not the fix exists - a control,
 *                       not a regression waiting to happen.
 *   refused, fixed      The repair. This row could have been written, and would
 *                       have failed, before a line of `microphone-policy.ts`
 *                       existed.
 *
 * `permissionDenied` is asserted alongside the message in every arm because it
 * is the flag `use-composer-dictation.ts` gates the "Open Settings" button on -
 * the affordance that does nothing in this shell. A fix that corrected the
 * words and still raised that flag would leave the dead button in place.
 */
import "../../../gui-app/__tests__/test-browser-apis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useVoiceDictation } from "@/hooks/composer/use-voice-dictation";
import {
  installMicrophonePolicy,
  type PolicyDocument,
} from "./microphone-policy";

// The hook's true external boundaries: the speech transport, the runner-host
// permission IPC, and the Web Audio / getUserMedia browser APIs. Everything
// between them - including the classification under test - runs real.
const speech = vi.hoisted(() => {
  class FakeSpeechStreamClient {
    sendAudio(): void {}
    flush(): void {}
    close(): void {}
  }
  return { FakeSpeechStreamClient };
});

vi.mock("@traycer-clients/shared/host-transport/speech-stream-client", () => ({
  SpeechStreamClient: speech.FakeSpeechStreamClient,
}));

// Returns "granted" exactly as `MobileRunnerHost` does on this surface - which
// is the honest answer for a method whose contract is "drive the macOS OS-level
// prompt", since a browser has no such prompt. The wrapper, not this, is what
// tells the two refusals apart.
vi.mock("@/providers/use-runner-host", () => ({
  useRunnerHost: () => ({
    requestMicrophoneAccess: () => Promise.resolve("granted"),
  }),
}));

vi.mock("@/lib/host/stream-runtime-context", () => ({
  useWsStreamClient: () => ({}),
}));

class FakeScriptProcessor {
  onaudioprocess: unknown = null;
  connect(): void {}
  disconnect(): void {}
}

class FakeAudioContext {
  state = "running";
  readonly sampleRate = 16_000;
  readonly destination = {};
  createMediaStreamSource(): { connect(): void; disconnect(): void } {
    return { connect: () => undefined, disconnect: () => undefined };
  }
  createScriptProcessor(): FakeScriptProcessor {
    return new FakeScriptProcessor();
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = "closed";
    return Promise.resolve();
  }
}

function notAllowed(): Error {
  // What Chromium threw in the probe's refused arm, name and message.
  const error = new Error("Permission denied");
  error.name = "NotAllowedError";
  return error;
}

// A single assertion, not a chain through `unknown`. The hook stops every track
// it is handed, so `getTracks` is the one member that has to be real.
function fakeStream(): MediaStream {
  return { getTracks: () => [{ stop: () => undefined }] } as MediaStream;
}

const globalWithAudio = globalThis as { AudioContext?: unknown };
let originalAudioContext: unknown;
let originalMediaDevices: PropertyDescriptor | undefined;

/**
 * Installs a fresh `navigator.mediaDevices` for the arm and, when asked, our
 * real wrapper over it. A shared object would carry one arm's wrapper into the
 * next and quietly turn the "no fix" row into a fixed one.
 */
function arm(options: {
  readonly policy: boolean;
  readonly fix: boolean;
  readonly outcome?: "reject" | "resolve";
}): void {
  const devices = {
    getUserMedia: () =>
      options.outcome === "resolve"
        ? Promise.resolve(fakeStream())
        : Promise.reject(notAllowed()),
  };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: devices,
  });
  if (!options.fix) return;
  const doc: PolicyDocument = {
    featurePolicy: { allowsFeature: () => options.policy },
  };
  installMicrophonePolicy({
    navigator: navigator as { mediaDevices?: typeof devices },
    document: doc,
    report: () => undefined,
  });
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

async function startAndSettle(): Promise<{
  readonly errorMessage: string | null;
  readonly permissionDenied: boolean;
}> {
  const { result } = renderHook(() =>
    useVoiceDictation({ language: "en", onText: () => undefined }),
  );
  act(() => {
    result.current.start();
  });
  await flushAsync();
  await flushAsync();
  return {
    errorMessage: result.current.errorMessage,
    permissionDenied: result.current.permissionDenied,
  };
}

beforeEach(() => {
  originalAudioContext = globalWithAudio.AudioContext;
  globalWithAudio.AudioContext = FakeAudioContext;
  originalMediaDevices = Object.getOwnPropertyDescriptor(
    navigator,
    "mediaDevices",
  );
});

afterEach(() => {
  globalWithAudio.AudioContext = originalAudioContext;
  if (originalMediaDevices !== undefined) {
    Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
  } else {
    Reflect.deleteProperty(navigator, "mediaDevices");
  }
  vi.restoreAllMocks();
});

describe("the Teams tab's microphone, told in the words the user reads", () => {
  it("CONTROL: a granted surface that opens the mic reports no error at all", async () => {
    arm({ policy: true, fix: true, outcome: "resolve" });
    const seen = await startAndSettle();
    // Without this row, a wrapper that broke every acquisition would still
    // satisfy the two rows below.
    expect(seen.errorMessage).toBeNull();
    expect(seen.permissionDenied).toBe(false);
  });

  it("CONTROL: a real user denial on a granted surface still says so, and still offers Settings", async () => {
    arm({ policy: true, fix: true });
    const seen = await startAndSettle();
    expect(seen.errorMessage).toBe("Microphone access is blocked for Traycer.");
    // The PWA at top level: the user did refuse, and their browser's site
    // settings are the remedy. Suppressing this would be the fix overreaching.
    expect(seen.permissionDenied).toBe(true);
  });

  it("THE DEFECT: unfixed, a policy refusal is reported as the user's own denial", async () => {
    // No wrapper installed, so this row passes with or without the module and
    // records what the deployed Teams tab does today.
    arm({ policy: false, fix: false });
    const seen = await startAndSettle();
    expect(seen.errorMessage).toBe("Microphone access is blocked for Traycer.");
    // Which raises the "Open Settings" button - a no-op in this shell, for a
    // setting that would not help if it opened.
    expect(seen.permissionDenied).toBe(true);
  });

  it("THE FIX: a policy refusal names the host page and raises no Settings prompt", async () => {
    arm({ policy: false, fix: true });
    const seen = await startAndSettle();
    expect(seen.errorMessage).not.toBe(
      "Microphone access is blocked for Traycer.",
    );
    expect(seen.errorMessage).toContain("Could not access the microphone");
    expect(seen.errorMessage).toContain("host");
    // The whole point of the error NAME: upstream's `denied` branch is not
    // taken, so the dead button is never offered.
    expect(seen.permissionDenied).toBe(false);
  });
});
