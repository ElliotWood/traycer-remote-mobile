/**
 * M5 items 1 + 2. Fixtures are parsed through `worktreeBindingEntrySchema`,
 * not written as literals — `repoIdentifier` is a structured `{owner, repo}`
 * and reading it as a string yields `undefined` rather than throwing, so a
 * literal that got it wrong would produce a test that passes against a shape
 * the host cannot send.
 *
 * The multi-entry cases matter most: the defect these replace is invisible
 * with one entry, which is exactly why it survived.
 */
import { describe, expect, it } from "vitest";
import {
  worktreeBindingEntrySchema,
  type WorktreeBindingEntry,
} from "@traycer/protocol/host/worktree-schemas";
import {
  bindingSummary,
  isMissingOnDisk,
  orderedEntries,
  pathBasename,
  repoLabelForEntry,
  setupDetailForEntry,
  setupHealthForEntry,
  worktreeNameForEntry,
} from "@/views/chat/binding-model";

function entry(overrides: Record<string, unknown>): WorktreeBindingEntry {
  return worktreeBindingEntrySchema.parse({
    workspacePath: "/src/acme-web",
    mode: "worktree",
    repoIdentifier: { owner: "acme", repo: "acme-web" },
    worktreePath: "/src/wt/feature-a",
    branch: "feature-a",
    isPrimary: true,
    isImported: false,
    setupState: "succeeded",
    setupTerminalSessionId: null,
    setupExitCode: null,
    setupFailedAt: null,
    createdAt: 1_700_000_000_000,
    ...overrides,
  });
}

describe("pathBasename", () => {
  it("handles POSIX and Windows separators, because the host may be either", () => {
    expect(pathBasename("/src/wt/feature-a")).toBe("feature-a");
    expect(pathBasename("C:\\src\\wt\\feature-a")).toBe("feature-a");
  });

  it("ignores a trailing separator rather than returning empty", () => {
    expect(pathBasename("/src/wt/feature-a/")).toBe("feature-a");
    expect(pathBasename("C:\\src\\wt\\feature-a\\")).toBe("feature-a");
  });
});

describe("repoLabelForEntry", () => {
  it("uses the structured repoIdentifier's repo name", () => {
    expect(repoLabelForEntry(entry({}))).toBe("acme-web");
  });

  it("falls back to the workspacePath basename when repoIdentifier is null", () => {
    // Nullable on the wire, so this is a real row, not a defensive branch.
    const e = entry({ repoIdentifier: null, workspacePath: "/src/other-repo" });
    expect(repoLabelForEntry(e)).toBe("other-repo");
  });
});

describe("worktreeNameForEntry", () => {
  it("names the worktree directory", () => {
    expect(worktreeNameForEntry(entry({}))).toBe("feature-a");
  });

  it("is null when there is no worktree path", () => {
    expect(worktreeNameForEntry(entry({ worktreePath: null }))).toBeNull();
  });

  it("suppresses a worktree name that merely repeats the repo label", () => {
    // Otherwise the chip reads "acme-web · acme-web · main", which looks broken.
    const e = entry({ worktreePath: "/src/acme-web" });
    expect(worktreeNameForEntry(e)).toBeNull();
  });
});

describe("setupHealthForEntry / setupDetailForEntry", () => {
  it("treats succeeded and not_required as healthy, with no note", () => {
    for (const setupState of ["succeeded", "not_required"]) {
      const e = entry({ setupState });
      expect(setupHealthForEntry(e)).toBe("healthy");
      expect(setupDetailForEntry(e)).toBeNull();
    }
  });

  it("reports a FAILED setup — the state the old chip rendered as healthy", () => {
    const e = entry({ setupState: "failed", setupExitCode: 127 });
    expect(setupHealthForEntry(e)).toBe("unhealthy");
    // 127 is worth surfacing verbatim: it means "command not found".
    expect(setupDetailForEntry(e)).toBe("Setup script failed. Exit code 127.");
  });

  it("reports a failure with no exit code without inventing one", () => {
    const e = entry({ setupState: "failed", setupExitCode: null });
    expect(setupDetailForEntry(e)).toBe("Setup script failed.");
  });

  it("treats cancelled as unhealthy and says so distinctly", () => {
    const e = entry({ setupState: "cancelled" });
    expect(setupHealthForEntry(e)).toBe("unhealthy");
    expect(setupDetailForEntry(e)).toBe("Setup script was cancelled.");
  });

  it("separates in-progress from broken", () => {
    // Colouring a running script like a failure would be a false alarm.
    expect(setupHealthForEntry(entry({ setupState: "running" }))).toBe("in_progress");
    expect(setupDetailForEntry(entry({ setupState: "running" }))).toBe(
      "Setup script is running…",
    );
    expect(setupHealthForEntry(entry({ setupState: "pending" }))).toBe("in_progress");
  });
});

describe("isMissingOnDisk", () => {
  it("matches on worktreePath", () => {
    expect(isMissingOnDisk(entry({}), ["/src/wt/feature-a"])).toBe(true);
  });

  it("ALSO matches on workspacePath, so a local-mode entry can be flagged", () => {
    // A `local` entry has no worktreePath at all; checking only that field
    // would mean such an entry could never be reported missing.
    const local = entry({ worktreePath: null, mode: "local" });
    expect(isMissingOnDisk(local, ["/src/acme-web"])).toBe(true);
  });

  it("does not match an unrelated path", () => {
    expect(isMissingOnDisk(entry({}), ["/src/wt/something-else"])).toBe(false);
  });
});

describe("orderedEntries / bindingSummary — the multi-entry defect", () => {
  const primary = entry({ isPrimary: true, repoIdentifier: { owner: "acme", repo: "acme-web" } });
  const secondary = entry({
    isPrimary: false,
    repoIdentifier: { owner: "acme", repo: "acme-api" },
    workspacePath: "/src/acme-api",
    worktreePath: "/src/wt/api-work",
    branch: "api-work",
  });

  it("returns null for a folderless chat, so no chip renders", () => {
    expect(bindingSummary({ entries: [] }, [])).toBeNull();
    expect(bindingSummary(null, [])).toBeNull();
  });

  it("puts the primary entry first even when it is not first on the wire", () => {
    const ordered = orderedEntries({ entries: [secondary, primary] });
    expect(ordered[0]?.isPrimary).toBe(true);
    expect(repoLabelForEntry(ordered[0])).toBe("acme-web");
  });

  it("COUNTS the other entries — a two-repo chat must not look single-repo", () => {
    // The whole point of M5 item 1. With one entry this assertion is vacuous,
    // which is how the original defect survived.
    const summary = bindingSummary({ entries: [primary, secondary] }, []);
    expect(summary?.additionalCount).toBe(1);
  });

  it("reports additionalCount 0 for a single-entry binding", () => {
    expect(bindingSummary({ entries: [primary] }, [])?.additionalCount).toBe(0);
  });

  it("raises the alarm for a failure on a NON-displayed entry", () => {
    // The chip shows the primary; if only the second repo's setup failed, a
    // summary that looked at the head alone would render everything healthy.
    const brokenSecondary = entry({
      isPrimary: false,
      workspacePath: "/src/acme-api",
      setupState: "failed",
      setupExitCode: 1,
    });
    const summary = bindingSummary({ entries: [primary, brokenSecondary] }, []);
    expect(summary?.anyUnhealthy).toBe(true);
  });

  it("raises the alarm for a MISSING non-displayed entry", () => {
    const summary = bindingSummary({ entries: [primary, secondary] }, ["/src/wt/api-work"]);
    expect(summary?.anyMissing).toBe(true);
  });

  it("is quiet when everything is healthy and present", () => {
    const summary = bindingSummary({ entries: [primary, secondary] }, []);
    expect(summary?.anyUnhealthy).toBe(false);
    expect(summary?.anyMissing).toBe(false);
  });
});
