import { describe, expect, it, vi } from "vitest";
import { HostRpcError } from "@traycer-clients/shared/host-transport/host-messenger";
import { withTransientRetry } from "../transient-retry";

/**
 * Regression coverage for a real one-off observed live against the actual
 * host: `bridge list` failed once with `"exp" claim timestamp check failed"`
 * against a bearer independently decoded and confirmed non-expired. That
 * message matches the documented `FatalErrorDetails.retryable` case verbatim
 * (`ws-protocol.ts`: "the host's JWKS fetch timed out while verifying the
 * bearer... NOT a statement about the credential's authenticity") — a
 * transient, host-side verification hiccup the host explicitly flags as safe
 * to just retry, not a dead token needing bearer recovery. Before this fix,
 * `BridgeClient` had no auth-aware/retry wrapping on the unary transport at
 * all, so this class of failure surfaced as an immediate fatal error on an
 * otherwise-healthy bearer - invisible in a quick manual check, fatal on an
 * unattended process the moment the host hiccups once.
 */

function retryableError(message: string): HostRpcError {
  return new HostRpcError({
    code: "UNAUTHORIZED",
    message,
    requestId: "req-1",
    method: "agent.list",
    fatalDetails: {
      code: "UNAUTHORIZED",
      reason: message,
      incompatibleMethods: null,
      upgradeGuidance: null,
      retryable: true,
    },
  });
}

function nonRetryableError(message: string): HostRpcError {
  return new HostRpcError({
    code: "UNAUTHORIZED",
    message,
    requestId: "req-1",
    method: "agent.list",
    fatalDetails: {
      code: "UNAUTHORIZED",
      reason: message,
      incompatibleMethods: null,
      upgradeGuidance: null,
      retryable: false,
    },
  });
}

describe("withTransientRetry", () => {
  it("retries exactly once on a host-flagged transient failure and returns the retry's result", async () => {
    const call = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        retryableError('"exp" claim timestamp check failed'),
      )
      .mockResolvedValueOnce("ok");
    const diagnostics: string[] = [];

    const result = await withTransientRetry({
      label: "agent.list",
      call,
      onDiagnostic: (message) => diagnostics.push(message),
      delayMs: 10,
      sleep: () => Promise.resolve(),
    });

    expect(result).toBe("ok");
    expect(call).toHaveBeenCalledTimes(2);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain("exp");
    expect(diagnostics[0]).toContain("retrying once");
  });

  it("propagates the error if the retry also fails - bounded to exactly one retry, never a loop", async () => {
    const err = retryableError("still hiccuping");
    const call = vi.fn<() => Promise<string>>().mockRejectedValue(err);

    await expect(
      withTransientRetry({
        label: "agent.list",
        call,
        onDiagnostic: () => {},
        delayMs: 10,
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toBe(err);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable HostRpcError - propagates immediately", async () => {
    const err = nonRetryableError("bearer is genuinely dead");
    const call = vi.fn<() => Promise<string>>().mockRejectedValue(err);

    await expect(
      withTransientRetry({
        label: "agent.list",
        call,
        onDiagnostic: () => {},
        delayMs: 10,
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toBe(err);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-HostRpcError - propagates immediately", async () => {
    const err = new Error("some other failure");
    const call = vi.fn<() => Promise<string>>().mockRejectedValue(err);

    await expect(
      withTransientRetry({
        label: "agent.list",
        call,
        onDiagnostic: () => {},
        delayMs: 10,
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toBe(err);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("returns the first attempt's result without retrying when it succeeds", async () => {
    const call = vi.fn<() => Promise<string>>().mockResolvedValue("first-try");
    const result = await withTransientRetry({
      label: "agent.list",
      call,
      onDiagnostic: () => {},
      delayMs: 10,
      sleep: () => Promise.resolve(),
    });
    expect(result).toBe("first-try");
    expect(call).toHaveBeenCalledTimes(1);
  });
});
