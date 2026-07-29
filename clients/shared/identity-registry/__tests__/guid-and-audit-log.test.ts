import { describe, expect, it } from "vitest";
import { isCanonicalGuid } from "../guid";
import { emitAuditLine, sanitizeForLog } from "../audit-log";

const ESC = String.fromCharCode(0x1b);

describe("isCanonicalGuid", () => {
  it("accepts lowercase hyphenated 8-4-4-4-12", () => {
    expect(isCanonicalGuid("0b8f1c2e-8f3a-4a1b-9c2d-1e2f3a4b5c6d")).toBe(true);
  });

  it("rejects uppercase", () => {
    expect(isCanonicalGuid("0B8F1C2E-8F3A-4A1B-9C2D-1E2F3A4B5C6D")).toBe(
      false,
    );
  });

  it("rejects mixed case", () => {
    expect(isCanonicalGuid("0b8f1c2E-8f3a-4a1b-9c2d-1e2f3a4b5c6d")).toBe(
      false,
    );
  });

  it("rejects missing hyphens", () => {
    expect(isCanonicalGuid("0b8f1c2e8f3a4a1b9c2d1e2f3a4b5c6d")).toBe(false);
  });

  it("rejects leading/trailing whitespace", () => {
    expect(isCanonicalGuid(" 0b8f1c2e-8f3a-4a1b-9c2d-1e2f3a4b5c6d")).toBe(
      false,
    );
    expect(isCanonicalGuid("0b8f1c2e-8f3a-4a1b-9c2d-1e2f3a4b5c6d ")).toBe(
      false,
    );
  });

  it("rejects prototype-pollution-shaped strings", () => {
    expect(isCanonicalGuid("__proto__")).toBe(false);
    expect(isCanonicalGuid("constructor")).toBe(false);
    expect(isCanonicalGuid("toString")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isCanonicalGuid("")).toBe(false);
  });
});

describe("sanitizeForLog", () => {
  it("passes through a short clean string unchanged", () => {
    expect(sanitizeForLog("hello-world")).toBe("hello-world");
  });

  it("strips embedded newlines and carriage returns", () => {
    expect(sanitizeForLog("alice\nFAKE_AUDIT_LINE\rmore")).toBe(
      "aliceFAKE_AUDIT_LINEmore",
    );
  });

  it("strips ANSI escape sequences by removing the leading ESC byte", () => {
    const withEscape = `${ESC}[31mred${ESC}[0m`;
    expect(sanitizeForLog(withEscape)).toBe("[31mred[0m");
    expect(sanitizeForLog(withEscape)).not.toContain(ESC);
  });

  it("caps length at 64 characters", () => {
    const long = "a".repeat(10_000);
    const result = sanitizeForLog(long);
    expect(result.length).toBeLessThanOrEqual(64 + "...(truncated)".length);
    expect(result.startsWith("a".repeat(64))).toBe(true);
    expect(result.endsWith("...(truncated)")).toBe(true);
  });

  it("strips and caps together for a ~10KB payload full of control characters", () => {
    const payload = `\n\r${ESC}[31m`.repeat(2000) + "trailing";
    const result = sanitizeForLog(payload);
    expect(result.length).toBeLessThanOrEqual(64 + "...(truncated)".length);
    expect(result).not.toContain("\n");
    expect(result).not.toContain("\r");
    expect(result).not.toContain(ESC);
  });
});

describe("emitAuditLine", () => {
  it("logs the resolved-path input raw", () => {
    const lines: string[] = [];
    emitAuditLine((line) => lines.push(line), {
      direction: "forward",
      outcome: "resolved",
      reason: null,
      input: "0b8f1c2e-8f3a-4a1b-9c2d-1e2f3a4b5c6d",
      timestampMs: 1_700_000_000_000,
    });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as { input: string };
    expect(parsed.input).toBe("0b8f1c2e-8f3a-4a1b-9c2d-1e2f3a4b5c6d");
  });

  it("sanitizes the refusal-path input and never forges a second record", () => {
    const lines: string[] = [];
    emitAuditLine((line) => lines.push(line), {
      direction: "forward",
      outcome: "refused",
      reason: "unmapped_principal",
      input: "attacker\n" + JSON.stringify({ outcome: "resolved" }),
      timestampMs: 1_700_000_000_000,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
    const parsed = JSON.parse(lines[0]) as { outcome: string; input: string };
    expect(parsed.outcome).toBe("refused");
    expect(parsed.input).not.toContain("\n");
  });

  it("bounds a 10KB refusal input to one short, safe line", () => {
    const lines: string[] = [];
    const huge = "x".repeat(10_000);
    emitAuditLine((line) => lines.push(line), {
      direction: "reverse",
      outcome: "refused",
      reason: "unmapped_host_id",
      input: huge,
      timestampMs: 1_700_000_000_000,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].length).toBeLessThan(200);
  });
});
