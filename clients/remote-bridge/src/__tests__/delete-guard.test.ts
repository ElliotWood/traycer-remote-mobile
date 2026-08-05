/**
 * The guard on the one verb with no undo.
 *
 * Each case is a way a delete goes to the wrong chat, written as the mistake
 * rather than as the branch: a mistyped id, a stale title, an id that is not
 * visible. A test named after the `if` it covers agrees with the `if`; one
 * named after the accident can disagree with it.
 */
import { describe, expect, it } from "vitest";
import { checkDeleteTarget } from "../delete-guard";
import type { AgentSummary } from "../action-surface";

/**
 * Built to the REAL `AgentSummary`, which is why this is typed rather than
 * cast. The first draft invented `hostLabel` and `parentAgentId` and gave
 * `hostId: null` — `tsc` rejected it, `vitest` did not, and the tests passed
 * against a shape the host never sends. A fixture that does not typecheck is
 * a fixture testing something that cannot arrive.
 */
const agent = (agentId: string, title: string | null): AgentSummary => ({
  agentId,
  title,
  harnessId: "claude",
  surface: "gui",
  active: false,
  isLocal: true,
  hostId: "h-1",
  capabilities: { readTranscript: true, sendMessage: true },
});

const PROBE = agent("c-probe", "R5 idempotency probe - safe to delete");
const REAL = agent("c-real", "Teams P0 — Foundations");

describe("checkDeleteTarget", () => {
  it("permits the chat the caller named, when the title agrees", () => {
    const check = checkDeleteTarget(
      [PROBE, REAL],
      "c-probe",
      "R5 idempotency probe - safe to delete",
    );
    expect(check.ok).toBe(true);
  });

  it("refuses when the id is right and the title is somebody else's", () => {
    // The transposed-character case. The id resolves — to the wrong chat —
    // and only the title reveals it.
    const check = checkDeleteTarget(
      [PROBE, REAL],
      "c-real",
      "R5 idempotency probe - safe to delete",
    );
    expect(check.ok).toBe(false);
    if (check.ok) return;
    // The message must name BOTH titles. "Refused" alone leaves the caller
    // guessing whether they mistyped the id or the title.
    expect(check.reason).toContain("Teams P0");
    expect(check.reason).toContain("R5 idempotency probe");
  });

  it("refuses an id it cannot see rather than calling it already gone", () => {
    // `agent.list` is scoped, so absence is ambiguous between "deleted" and
    // "not visible to me". Reporting success on that ambiguity is how a
    // cleanup command claims to have tidied something that is still there.
    const check = checkDeleteTarget([REAL], "c-probe", "anything");
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toContain("cannot see");
  });

  it("refuses a chat whose title is null against any expectation", () => {
    // An untitled chat cannot be confirmed by title, so it cannot be deleted
    // through this path. Deliberate: the guard has nothing to check, and a
    // guard with nothing to check must not pass.
    const check = checkDeleteTarget([agent("c-x", null)], "c-x", "");
    expect(check.ok).toBe(false);
  });

  it("does not accept a title that merely contains the expectation", () => {
    // Exact match. "probe" must not authorise deleting "probe (production)".
    const check = checkDeleteTarget(
      [agent("c-y", "R5 idempotency probe - safe to delete (production)")],
      "c-y",
      "R5 idempotency probe - safe to delete",
    );
    expect(check.ok).toBe(false);
  });
});
