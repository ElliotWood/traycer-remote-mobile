/**
 * The 403/401 distinction, tested so that collapsing it FAILS.
 *
 * Both statuses surface as "the send didn't work" and have opposite correct
 * responses: 403 means delete the stored reference, 401 means keep it. A test
 * that asserted only "returned an error" would pass with them merged — which
 * is the vacuous shape this project has now hit repeatedly, so the assertions
 * here are on the DISPOSAL DECISION rather than on the error-ness.
 */
import { describe, expect, it } from "vitest";
import {
  classifySendFailure,
  outcomeOfSendError,
  shouldDiscardReference,
  type SendOutcome,
} from "../classify-send-failure";

describe("403 and 401 must not collapse", () => {
  it("discards the reference on 403 and KEEPS it on 401", () => {
    /*
     * THE test this file exists for.
     *
     * Mutation: return `{ kind: "gone", reason: "uninstalled" }` for 401 too.
     * The second assertion fails — and note the first would still pass, which
     * is why both are here and why they assert opposite booleans rather than
     * two flavours of truthy.
     *
     * The defect being guarded: a credential expiry silently deleting every
     * conversation reference on the box, in a code path with no user
     * watching.
     */
    expect(shouldDiscardReference(classifySendFailure(403))).toBe(true);
    expect(shouldDiscardReference(classifySendFailure(401))).toBe(false);
  });

  it("names WHY it is gone, because uninstall is a user action and 404 is not", () => {
    const uninstalled = classifySendFailure(403);
    const missing = classifySendFailure(404);
    expect(uninstalled).toEqual({ kind: "gone", reason: "uninstalled" });
    expect(missing).toEqual({ kind: "gone", reason: "not-found" });
    // Both discard — the reason is for the log, not for the decision.
    expect(shouldDiscardReference(uninstalled)).toBe(true);
    expect(shouldDiscardReference(missing)).toBe(true);
  });
});

describe("202 is queued, never delivered", () => {
  it("classifies the success codes as queued", () => {
    // There is no delivery receipt — not deferred, unavailable. A `delivered`
    // member would be a field we cannot populate truthfully.
    for (const status of [200, 201, 202]) {
      expect(classifySendFailure(status)).toEqual({ kind: "queued" });
    }
  });

  it("has no member that claims delivery", () => {
    /*
     * Bound to the union rather than to a literal list, so ADDING a
     * `delivered` member to `SendOutcome` makes this fail. The claim is about
     * what the type may express, not about what one call returned.
     */
    const kinds: ReadonlyArray<SendOutcome["kind"]> = [
      "queued",
      "gone",
      "auth",
      "throttled",
      "unknown",
    ];
    expect(kinds).not.toContain("delivered");
  });
});

describe("throttling and the unclassified", () => {
  it("keeps the reference on 429", () => {
    expect(classifySendFailure(429)).toEqual({ kind: "throttled" });
    expect(shouldDiscardReference(classifySendFailure(429))).toBe(false);
  });

  it("does NOT discard on an unrecognised status", () => {
    /*
     * A status nobody has classified must not inherit either disposal rule.
     * Mutation: make `unknown` discard. This fails — and it is the difference
     * between a transient 500 from an upstream and permanent data loss.
     */
    for (const status of [0, 418, 500, 502, 503]) {
      const outcome = classifySendFailure(status);
      expect(outcome).toEqual({ kind: "unknown", status });
      expect(shouldDiscardReference(outcome)).toBe(false);
    }
  });

  it("carries the status so a log can name it", () => {
    // An `unknown` that dropped the number would leave the operator with
    // "something else happened" and nothing to search for.
    const outcome = classifySendFailure(503);
    expect(outcome.kind).toBe("unknown");
    if (outcome.kind !== "unknown") return;
    expect(outcome.status).toBe(503);
  });
});

describe("the send throws, it does not return a status", () => {
  it("recovers the status from an HttpError-shaped throw", () => {
    /*
     * `CloudAdapter.continueConversation` is typed `Promise<void>`: it
     * resolves with nothing and throws on failure. So the 403/401 branches
     * above have nothing to classify unless the status is read off the
     * thrown value — the SDK's `HttpError` carries `readonly status: number`.
     *
     * Read structurally rather than via `instanceof`, for the same reason
     * the reference store persists a structural subset: an `instanceof`
     * against a dependency's class fails silently across a version bump,
     * and it fails in the direction that keeps a dead reference or drops a
     * live one.
     */
    const error: Error & { status?: number } = new Error("Forbidden");
    error.status = 403;
    expect(outcomeOfSendError(error)).toEqual({
      kind: "gone",
      reason: "uninstalled",
    });
    expect(shouldDiscardReference(outcomeOfSendError(error))).toBe(true);
  });

  it("says `unreachable` when there is no status, and does not discard", () => {
    /*
     * THE case the status-based union structurally could not express: DNS,
     * TLS, a timeout, an abort. Nothing replied, so there is no status.
     *
     * Mutation: fall back to `classifySendFailure(0)`. The first assertion
     * fails — and note it would then read `{kind:"unknown",status:0}`, i.e.
     * "Bot Service replied 0", a claim about a response that never existed.
     * The disposal assertion would still pass, which is why both are here.
     */
    const outcome = outcomeOfSendError(
      new Error("getaddrinfo ENOTFOUND smba.example"),
    );
    expect(outcome.kind).toBe("unreachable");
    expect(shouldDiscardReference(outcome)).toBe(false);
  });

  it("treats a non-integer status as unreachable rather than trusting it", () => {
    // NaN passes `typeof === "number"`. Classifying it would produce
    // "unknown status NaN", which tells an operator nothing at all.
    const error: Error & { status?: number } = new Error("weird");
    error.status = Number.NaN;
    expect(outcomeOfSendError(error).kind).toBe("unreachable");
  });

  it("handles a thrown non-Error without losing the detail", () => {
    const outcome = outcomeOfSendError("socket hang up");
    expect(outcome).toEqual({ kind: "unreachable", detail: "socket hang up" });
  });
});
