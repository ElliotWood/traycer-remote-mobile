/**
 * M3 item 3 — the pure rules behind `@`.
 *
 * Fixtures are parsed through `worktreeBindingEntrySchema`, and every claim
 * about SELECTING among things is made against at least two entries: with one
 * entry, "picks the worktree over the workspace" and "picks the first entry"
 * are the same test, and the second is not what the code should be doing.
 */
import { describe, expect, it } from "vitest";
import {
  worktreeBindingEntrySchema,
  type WorktreeBinding,
  type WorktreeBindingEntry,
} from "@traycer/protocol/host/worktree-schemas";
import {
  mentionEmptyState,
  mentionRootsForBinding,
  mentionToken,
  partiallyUnavailableRoots,
  type MentionRootStatus,
  type MentionSuggestion,
} from "@/views/chat/mention-model";

function entry(overrides: Record<string, unknown>): WorktreeBindingEntry {
  return worktreeBindingEntrySchema.parse({
    workspacePath: "C:\\repos\\alpha",
    mode: "worktree",
    repoIdentifier: null,
    worktreePath: null,
    branch: null,
    isPrimary: true,
    isImported: false,
    setupState: "not_required",
    setupTerminalSessionId: null,
    setupExitCode: null,
    setupFailedAt: null,
    createdAt: 1_700_000_000_000,
    ...overrides,
  });
}

function binding(entries: readonly WorktreeBindingEntry[]): WorktreeBinding {
  return { entries } as WorktreeBinding;
}

describe("mentionRootsForBinding", () => {
  it("is empty for a folderless chat — which is what hides the affordance", () => {
    expect(mentionRootsForBinding(null)).toEqual([]);
    expect(mentionRootsForBinding(binding([]))).toEqual([]);
  });

  it("prefers the worktree over the source workspace", () => {
    // The agent runs IN the worktree, and the two check out different
    // branches: a file that exists only on this chat's branch is absent from
    // the source workspace, so searching the workspace would answer "no
    // matches" for a file the agent can see.
    const roots = mentionRootsForBinding(
      binding([entry({ workspacePath: "C:\\repos\\alpha", worktreePath: "C:\\wt\\feature" })]),
    );
    expect(roots).toEqual(["C:\\wt\\feature"]);
  });

  it("falls back to the workspace when an entry has no worktree", () => {
    // A `local`-mode entry. Two entries so this proves the choice is made per
    // entry rather than once for the whole binding.
    const roots = mentionRootsForBinding(
      binding([
        entry({ workspacePath: "C:\\repos\\alpha", worktreePath: "C:\\wt\\feature" }),
        entry({ workspacePath: "C:\\repos\\beta", worktreePath: null, isPrimary: false }),
      ]),
    );
    expect(roots).toEqual(["C:\\wt\\feature", "C:\\repos\\beta"]);
  });

  it("de-duplicates, so one directory does not get two canaries and two rows", () => {
    const roots = mentionRootsForBinding(
      binding([
        entry({ workspacePath: "C:\\repos\\alpha" }),
        entry({ workspacePath: "C:\\repos\\alpha", isPrimary: false }),
      ]),
    );
    expect(roots).toEqual(["C:\\repos\\alpha"]);
  });
});

describe("mentionToken", () => {
  it("is @<relPath> — not the label, which would not resolve", () => {
    const file = {
      kind: "file",
      relPath: "src/deep/app.tsx",
      label: "app.tsx",
    } as MentionSuggestion;
    expect(mentionToken(file)).toBe("@src/deep/app.tsx");
  });

  it("leaves a folder's trailing slash alone — the host's own convention", () => {
    const folder = { kind: "folder", relPath: "src/views/", label: "views" } as MentionSuggestion;
    expect(mentionToken(folder)).toBe("@src/views/");
  });
});

describe("mentionEmptyState", () => {
  const rows = [{ kind: "file", relPath: "a.ts", label: "a.ts" } as MentionSuggestion];
  const status = (root: string, health: MentionRootStatus["health"]): MentionRootStatus => ({
    root,
    health,
  });

  it("says nothing while there are rows to show", () => {
    expect(mentionEmptyState({ connected: true, loading: false, suggestions: rows, statuses: [status("a", "unavailable")] })).toBeNull();
  });

  it("waits for the canaries rather than guessing mid-probe", () => {
    // Reporting `unavailable` here would flash "no files" at someone whose
    // workspace is fine, every time the sheet opens.
    expect(mentionEmptyState({ connected: true, loading: false, suggestions: [], statuses: [status("a", "checking")] })).toBe("loading");
  });

  it("separates a true no-match from an unreadable root", () => {
    expect(mentionEmptyState({ connected: true, loading: false, suggestions: [], statuses: [status("a", "readable")] })).toBe("no-matches");
    expect(mentionEmptyState({ connected: true, loading: false, suggestions: [], statuses: [status("a", "unavailable")] })).toBe("unavailable");
  });

  it("calls it a no-match when ANY root is readable", () => {
    // The half-broken binding: results are still trustworthy from the healthy
    // root, so "unavailable" would be a lie about the whole chat.
    expect(
      mentionEmptyState({ connected: true, loading: false, suggestions: [], statuses: [status("a", "readable"), status("b", "unavailable")] }),
    ).toBe("no-matches");
  });

  /**
   * The Evidence Gate's finding on `98304215`, and the tests that would have
   * caught it. The old rule was `if (statuses.length === 0) return
   * "unavailable"` — a LENGTH read as a verdict about the user's workspace.
   */
  it("says UNDETERMINED, not unavailable, when there is no client", () => {
    // The true fact is "the socket is not connected". Calling that an
    // unreadable workspace is the exact confusion the transport-failure catch
    // in `use-mention-files.ts` refuses to make — the guard was on the
    // exception, and this path never threw.
    expect(
      mentionEmptyState({ connected: false, loading: false, suggestions: [], statuses: [] }),
    ).toBe("undetermined");
  });

  it("stays undetermined without a client even once statuses exist", () => {
    expect(
      mentionEmptyState({
        connected: false,
        loading: false,
        suggestions: [],
        statuses: [status("a", "readable")],
      }),
    ).toBe("undetermined");
  });

  it("does not pass judgement on the first paint, before any canary reports", () => {
    // Both effects run post-commit, so the first render with a live trigger
    // has `loading: false` and no statuses. Silence is not a finding.
    expect(
      mentionEmptyState({ connected: true, loading: false, suggestions: [], statuses: [] }),
    ).toBe("loading");
  });

  it("says undetermined when a probe could not answer at all", () => {
    // `unknown` is a settled "we cannot tell", not a spinner: a permanently
    // failing socket used to sit in `checking` forever, which is
    // indistinguishable from a slow probe.
    expect(
      mentionEmptyState({ connected: true, loading: false, suggestions: [], statuses: [status("a", "unknown")] }),
    ).toBe("undetermined");
  });

  it("refuses BOTH verdicts when one root is unreadable and another is unknown", () => {
    // No root was successfully searched, so "no matches" would be a lie; not
    // every root is known-broken, so "unavailable" would be one too.
    expect(
      mentionEmptyState({
        connected: true,
        loading: false,
        suggestions: [],
        statuses: [status("a", "unavailable"), status("b", "unknown")],
      }),
    ).toBe("undetermined");
  });

  it("still says no-matches when a readable root sits beside an unknown one", () => {
    // One root genuinely answered, so the query did reach a workspace.
    expect(
      mentionEmptyState({
        connected: true,
        loading: false,
        suggestions: [],
        statuses: [status("a", "readable"), status("b", "unknown")],
      }),
    ).toBe("no-matches");
  });
});

describe("partiallyUnavailableRoots", () => {
  const status = (root: string, health: MentionRootStatus["health"]): MentionRootStatus => ({
    root,
    health,
  });

  it("names the broken root while another still works", () => {
    expect(
      partiallyUnavailableRoots([status("good", "readable"), status("bad", "unavailable")]),
    ).toEqual(["bad"]);
  });

  it("says nothing when EVERY root is broken — that is the empty state, not a footnote", () => {
    expect(
      partiallyUnavailableRoots([status("a", "unavailable"), status("b", "unavailable")]),
    ).toEqual([]);
  });

  it("says nothing when every root is fine", () => {
    expect(partiallyUnavailableRoots([status("a", "readable")])).toEqual([]);
  });

  it("does not call an all-broken binding partial just because one root is unknown", () => {
    // Naming one root here would imply the others were fine — ignorance
    // dressed as a verdict, the same defect one function up.
    expect(
      partiallyUnavailableRoots([status("a", "unavailable"), status("b", "unknown")]),
    ).toEqual([]);
  });
});
