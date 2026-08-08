/**
 * Prints the exact JSON this service puts on the wire, for every actionable
 * entry kind, to stdout.
 *
 * Its output IS `src/__tests__/__fixtures__/push-activation-envelopes.json`,
 * which two packages assert against from opposite ends — see that file's
 * `$comment`. Regenerate with:
 *
 *   bun run tools/print-wire-fixture.ts > src/__tests__/__fixtures__/push-activation-envelopes.json
 *
 * and then add the `$comment` and `hostId` keys back by hand, or just patch
 * the changed values. Deliberately NOT wired into the test run: a fixture a
 * test can rewrite is a fixture that cannot fail, which is the entire point of
 * checking it in.
 */
import type { HostNotificationEntry } from "@traycer/protocol/host/notifications/host-notifications";
import { buildPushPayload } from "../src/push-payload";
import {
  APPROVAL_ENTRY,
  INTERVIEW_ENTRY,
  STALLED_ENTRY,
  STOPPED_ENTRY,
  WORKSPACE_FAILED_ENTRY,
} from "../src/__tests__/fixtures";

const HOST_ID = "host-8f2c1d40";

/** Round-tripped through JSON because the wire, not the object graph, is the contract. */
function wire(entries: readonly HostNotificationEntry[]): unknown {
  return JSON.parse(
    JSON.stringify(
      buildPushPayload(
        entries.map((entry) => ({ id: entry.id, entry })),
        HOST_ID,
      ),
    ),
  );
}

process.stdout.write(
  `${JSON.stringify(
    {
      hostId: HOST_ID,
      approval: wire([APPROVAL_ENTRY]),
      interview: wire([INTERVIEW_ENTRY]),
      stalled: wire([STALLED_ENTRY]),
      stopped: wire([STOPPED_ENTRY]),
      workspaceFailed: wire([WORKSPACE_FAILED_ENTRY]),
      summary: wire([APPROVAL_ENTRY, INTERVIEW_ENTRY]),
    },
    null,
    2,
  )}\n`,
);
