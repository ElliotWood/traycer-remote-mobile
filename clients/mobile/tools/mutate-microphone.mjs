/**
 * A PROBE, NOT A GATE. It writes to source and restores; it is not wired into
 * CI and must not be. Run it by hand:
 *
 *   node tools/mutate-microphone.mjs
 *
 * Each mutation names the test that MUST redden. A mutation caught by "the
 * suite went red somewhere" is not caught in the sense that matters.
 *
 * MUT-1 IS THE MUTATION WORTH HAVING: it restores the shipped behaviour - the
 * wrapper installs and passes straight through - and the row that reddens is
 * the SEAM row, stated in the units a user reads: upstream's real classifier
 * telling a Teams user they denied a microphone nobody asked them about. That
 * row could have been written, and would have failed, before a line of this
 * module existed.
 *
 * MUT-4 AND MUT-10 ARE THE TWO OVERREACH MUTATIONS, and they are here because
 * the danger in this module is not that it does too little. MUT-4 drops the
 * policy re-check so EVERY denial is re-described - which silently suppresses
 * the one message that is correct and actionable on the PWA. MUT-10 rejects
 * early on the policy reading instead of after a real failure, which looks like
 * a tightening and hands a false-negative reading the power to disable a
 * WORKING microphone. Both are caught by rows that pair a refusing document
 * with a succeeding device, or a granted document with a refusing one - the
 * combinations a module tested only on the broken surface would never have.
 *
 * Two test files are run together deliberately: the unit file cannot see MUT-1
 * at all, and the seam file cannot see the reporting mutations.
 *
 * Every mutation aborts unless its pattern matches EXACTLY ONCE. A probe whose
 * pattern silently matches zero times reports a pass it never measured.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MODULE = join(ROOT, "src", "web", "microphone-policy.ts");

const MUTATIONS = [
  {
    id: "MUT-1",
    why: "THE SHIPPED DEFECT: the wrapper installs and passes straight through, so a policy refusal reaches upstream as NotAllowedError and the Teams user is told they blocked the microphone",
    from:
      "  const nativeGetUserMedia = devices.getUserMedia.bind(devices);\n" +
      "  devices.getUserMedia = (\n" +
      "    constraints: MediaStreamConstraints | undefined,\n" +
      "  ): Promise<MediaStream> =>",
    to:
      "  const nativeGetUserMedia = devices.getUserMedia.bind(devices);\n" +
      "  devices.getUserMedia = (\n" +
      "    constraints: MediaStreamConstraints | undefined,\n" +
      "  ): Promise<MediaStream> =>\n" +
      "    nativeGetUserMedia(constraints); // eslint-disable-line\n" +
      "  const unusedGetUserMedia = (\n" +
      "    constraints: MediaStreamConstraints | undefined,\n" +
      "  ): Promise<MediaStream> =>",
    catcher:
      "THE FIX: a policy refusal names the host page and raises no Settings prompt",
  },
  {
    id: "MUT-2",
    why: "the error NAME is no longer checked, so a NotFoundError - there is no microphone attached - is re-described as the host page withholding one",
    from: "      if (!isDenial || !requestsAudio(constraints)) throw cause;",
    to: "      if (!requestsAudio(constraints)) throw cause;",
    catcher: "propagates a non-denial rejection even on a refused document",
  },
  {
    id: "MUT-3",
    why: "the audio guard is dropped, so a video-only refusal is blamed on the microphone policy this module never measured for it",
    // WRITTEN WRONG THE FIRST TIME, and the probe's own "caught, but not by its
    // named test" branch is what said so. The first version mutated the
    // `isDenial` definition, which is MUT-2's defect wearing MUT-3's
    // description - so it reddened MUT-2's row and the audio guard stayed
    // unmeasured. A duplicate mutation reads as coverage while testing nothing
    // new, and only the named-catcher check can tell the difference.
    from: "      if (!isDenial || !requestsAudio(constraints)) throw cause;",
    to: "      if (!isDenial) throw cause;",
    catcher:
      "propagates a video-only denial - that is the camera policy, unmeasured here",
  },
  {
    id: "MUT-4",
    why: "OVERREACH: the policy re-check is dropped, so a genuine user denial on a granted surface is re-described too - suppressing the one message that is true and the one remedy that works",
    from: "      if (readMicrophonePolicy(doc) !== false) throw cause;",
    to: "      void readMicrophonePolicy;",
    catcher: "propagates a user denial on a GRANTED document",
  },
  {
    id: "MUT-5",
    why: "the replacement error is named NotAllowedError, so upstream classifies it as a user denial exactly as before and the dead Open Settings button returns - the fix that changes the words and not the outcome",
    from: "    this.name = \"TraycerMicrophonePolicyError\";",
    to: "    this.name = \"NotAllowedError\";",
    catcher:
      "THE FIX: a policy refusal names the host page and raises no Settings prompt",
  },
  {
    id: "MUT-6",
    why: "the install-time stamp is dropped, so `<html data-microphone>` is absent until someone presses the mic button - which on a session where nobody dictates is never",
    from: "  report(installed);\n",
    to: "",
    catcher: "stamps at install, before any getUserMedia call",
  },
  {
    id: "MUT-7",
    why: "an unreadable policy is reported as a measured refusal, so Firefox and Safari claim `policy-blocked` having never been asked",
    from: "      : allowed === null\n        ? \"unmeasured\"",
    to: "      : allowed === null\n        ? \"policy-blocked\"",
    catcher: "reports unmeasured",
  },
  {
    id: "MUT-8",
    why: "the policy read answers false rather than null where there is no API, collapsing the measurement and its absence into one value",
    from: "  if (policy === undefined) return null;",
    to: "  if (policy === undefined) return false;",
    catcher: "returns null - not false - when there is no API to ask",
  },
  {
    id: "MUT-9",
    why: "the policy is asked about the wrong feature and its well-formed boolean is reported as the microphone's",
    from: "    return policy.allowsFeature(\"microphone\");",
    to: "    return policy.allowsFeature(\"camera\");",
    catcher: "reads featurePolicy",
  },
  {
    id: "MUT-10",
    why: "OVERREACH: the refusal is decided BEFORE the native call rather than after a real failure, so a false-negative policy reading disables a microphone that works",
    from: "    nativeGetUserMedia(constraints).then(undefined, (cause: unknown) => {",
    to:
      "    (allowed === false && requestsAudio(constraints)\n" +
      "      ? Promise.reject(new MicrophonePolicyError(POLICY_BLOCKED_MESSAGE))\n" +
      "      : nativeGetUserMedia(constraints)\n" +
      "    ).then(undefined, (cause: unknown) => {",
    catcher: "passes a resolved stream through untouched",
  },
  {
    id: "MUT-11",
    why: "the install-time reading is closed over instead of re-read, so a document whose policy changed after boot is answered with a stale fact",
    from: "      if (readMicrophonePolicy(doc) !== false) throw cause;",
    to: "      if (allowed !== false) throw cause;",
    catcher: "uses the reading at CALL time, not the one taken at install",
  },
  {
    id: "MUT-12",
    why: "the absent mediaDevices is left absent, so an insecure context reports a leaked TypeError string instead of a sentence",
    from:
      "      Object.defineProperty(nav, \"mediaDevices\", {\n" +
      "        value: synthesized,\n" +
      "        configurable: true,\n" +
      "      });",
    to: "      void synthesized;",
    catcher: "synthesizes a rejecting mediaDevices rather than leaving it absent",
  },
];

const original = readFileSync(MODULE, "utf8");
const restore = () => writeFileSync(MODULE, original);

const OUT = join(ROOT, ".mutate-microphone.json");

/**
 * Returns the names of the tests that FAILED.
 *
 * `shell: true` is load-bearing on Windows: Node refuses to `execFileSync` a
 * `.cmd` without it and throws EINVAL, which an earlier probe in this package
 * absorbed into the same `catch` that absorbs a legitimately red suite - so the
 * runner never started and every mutation was "measured" against a report that
 * was never written. The absence of the report is therefore a hard abort.
 */
function runSuite() {
  if (existsSync(OUT)) rmSync(OUT);
  try {
    execFileSync(
      "npx",
      [
        "vitest",
        "run",
        "src/web/microphone-policy.test.ts",
        "src/web/microphone-seam.test.tsx",
        "--reporter=json",
        "--outputFile=.mutate-microphone.json",
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      },
    );
  } catch (error) {
    void error;
  }
  if (!existsSync(OUT)) {
    console.log(
      "ABORT - vitest produced no report. The probe measured nothing; do not " +
        "read any result above as a pass.",
    );
    restore();
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(OUT, "utf8"));
  const failed = [];
  for (const suite of report.testResults ?? []) {
    for (const t of suite.assertionResults ?? []) {
      if (t.status === "failed") failed.push(t.title);
    }
  }
  return failed;
}

console.log("control: the suite must be GREEN before any mutation is believed");
const controlFailures = runSuite();
if (controlFailures.length > 0) {
  console.log(
    `ABORT - control is already red:\n  ${controlFailures.join("\n  ")}`,
  );
  process.exit(1);
}
console.log("control: green\n");

let caught = 0;
let survived = 0;

for (const m of MUTATIONS) {
  const occurrences = original.split(m.from).length - 1;
  if (occurrences !== 1) {
    console.log(
      `${m.id} ABORT - pattern matched ${occurrences} times, expected exactly 1. ` +
        "The probe is wrong, not the code.",
    );
    restore();
    process.exit(1);
  }

  writeFileSync(MODULE, original.replace(m.from, m.to));
  const failures = runSuite();
  restore();

  if (failures.includes(m.catcher)) {
    caught += 1;
    console.log(`${m.id} caught by its named test  (${failures.length} red)`);
  } else if (failures.length > 0) {
    caught += 1;
    console.log(
      `${m.id} caught, but NOT by "${m.catcher}" - by:\n    ${failures.slice(0, 4).join("\n    ")}\n` +
        "    ^ the named assertion is not the one doing the work. Investigate.",
    );
  } else {
    survived += 1;
    console.log(`${m.id} SURVIVED - ${m.why}`);
  }
}

restore();
if (existsSync(OUT)) rmSync(OUT);
console.log(`\n${caught}/${MUTATIONS.length} caught, ${survived} survived`);
process.exit(survived === 0 ? 0 : 1);
