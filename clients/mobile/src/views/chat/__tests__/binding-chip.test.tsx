// @vitest-environment jsdom
/**
 * M5 — the binding chip's RENDER layer, which had no test at all.
 *
 * ## What this covers that `binding-model.test.ts` cannot
 *
 * The projections are already unit-tested without a DOM, so re-asserting them
 * here would be coverage theatre. Everything below is a rule that lives in the
 * component and is invisible to the model:
 *
 *   - a folderless chat renders NOTHING — not an empty chip, not a placeholder
 *   - the accessible name is exactly `Workspace binding`
 *   - `+N` reaches the screen, so a two-repo chat cannot look like a one-repo one
 *   - EITHER alarm signal alone changes the icon, and
 *   - the sheet lists one row per entry with the primary first
 *
 * ## Why `aria-label` is asserted as a contract rather than an implementation detail
 *
 * It is how every other tool finds this chip. The live harness locates a bound
 * chat by `getByRole("button", { name: "Workspace binding" })`, and its
 * ABSENCE is what the harness reads as "this chat is folderless" — so a rename
 * here does not merely fail a query, it silently reclassifies real bound chats
 * as folderless. That already happened once, from the other direction.
 *
 * ## Fixtures
 *
 * Two entries throughout, parsed through `worktreeBindingSchema`. One entry is
 * a world where "which entry does the chip represent", "+N", "primary first"
 * and "a failure on the SECOND repo is visible from the first" are all
 * unfalsifiable — and that last one is the rule the old `branch-chip` broke.
 */
import { describe, expect, it } from "vitest";
import {
  worktreeBindingSchema,
  type WorktreeBinding,
} from "@traycer/protocol/host/worktree-schemas";
import { BindingChip } from "@/views/chat/binding-chip";
import { fireEvent, render, screen } from "@/test-utils/dom";

function entry(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    workspacePath: "C:\\repos\\alpha",
    mode: "worktree",
    repoIdentifier: { owner: "acme", repo: "alpha" },
    worktreePath: "C:\\worktrees\\alpha-feature",
    branch: "feature/one",
    isPrimary: false,
    isImported: false,
    setupState: "succeeded",
    setupTerminalSessionId: null,
    setupExitCode: null,
    setupFailedAt: null,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

/** Two entries, primary LAST on the wire — so "primary first" is a real reordering, not the input order echoed back. */
function twoRepoBinding(overrides: {
  readonly first?: Record<string, unknown>;
  readonly second?: Record<string, unknown>;
}): WorktreeBinding {
  return worktreeBindingSchema.parse({
    entries: [
      entry({
        workspacePath: "C:\\repos\\beta",
        repoIdentifier: { owner: "acme", repo: "beta" },
        worktreePath: "C:\\worktrees\\beta-fix",
        branch: "fix/two",
        isPrimary: false,
        ...overrides.second,
      }),
      entry({ isPrimary: true, ...overrides.first }),
    ],
  });
}

describe("a folderless chat", () => {
  it("renders nothing at all — the absence IS the affordance", () => {
    const { container } = render(<BindingChip binding={null} missingWorktreePaths={[]} />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("button", { name: "Workspace binding" })).toBeNull();
  });

  it("renders nothing for a binding with zero entries, not an empty chip", () => {
    const empty = worktreeBindingSchema.parse({ entries: [] });
    const { container } = render(<BindingChip binding={empty} missingWorktreePaths={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("the collapsed chip", () => {
  it("is found by the accessible name every other tool locates it with", () => {
    render(<BindingChip binding={twoRepoBinding({})} missingWorktreePaths={[]} />);
    expect(screen.getByRole("button", { name: "Workspace binding" })).toBeTruthy();
  });

  it("shows the PRIMARY entry's repo, not the wire-order first", () => {
    render(<BindingChip binding={twoRepoBinding({})} missingWorktreePaths={[]} />);
    const chip = screen.getByRole("button", { name: "Workspace binding" });
    // `alpha` is primary and second on the wire; `beta` is first on the wire.
    expect(chip.textContent).toContain("alpha");
    expect(chip.textContent).not.toContain("beta");
  });

  it("states the count, so a two-repo chat cannot look like a one-repo chat", () => {
    render(<BindingChip binding={twoRepoBinding({})} missingWorktreePaths={[]} />);
    expect(screen.getByRole("button", { name: "Workspace binding" }).textContent).toContain("+1");
  });

  it("omits the count for a single-entry binding rather than showing +0", () => {
    const one = worktreeBindingSchema.parse({ entries: [entry({ isPrimary: true })] });
    render(<BindingChip binding={one} missingWorktreePaths={[]} />);
    expect(screen.getByRole("button", { name: "Workspace binding" }).textContent).not.toContain("+");
  });
});

/**
 * Two INDEPENDENT alarm signals, asserted independently.
 *
 * The old chip watched missing-on-disk only, so a failed setup script rendered
 * as healthy. Asserting them together would pass with either one wired up —
 * the exact shape of the defect this replaced.
 */
describe("the alarm state", () => {
  function iconCount(): number {
    return document.querySelectorAll("svg.lucide-triangle-alert").length;
  }

  it("is calm when both signals are clear", () => {
    render(<BindingChip binding={twoRepoBinding({})} missingWorktreePaths={[]} />);
    expect(iconCount()).toBe(0);
  });

  it("alarms on a failed setup script ALONE, with nothing missing on disk", () => {
    render(
      <BindingChip
        binding={twoRepoBinding({ second: { setupState: "failed", setupExitCode: 127 } })}
        missingWorktreePaths={[]}
      />,
    );
    expect(iconCount()).toBeGreaterThan(0);
  });

  it("alarms on a missing worktree ALONE, with every setup script healthy", () => {
    render(
      <BindingChip binding={twoRepoBinding({})} missingWorktreePaths={["C:\\worktrees\\beta-fix"]} />,
    );
    expect(iconCount()).toBeGreaterThan(0);
  });

  it("alarms from the SECOND repo — the chip is all you see before tapping", () => {
    // The failure is on `beta`, which the collapsed chip never names.
    render(
      <BindingChip
        binding={twoRepoBinding({ second: { setupState: "failed", setupExitCode: 1 } })}
        missingWorktreePaths={[]}
      />,
    );
    const chip = screen.getByRole("button", { name: "Workspace binding" });
    expect(chip.textContent).not.toContain("beta");
    expect(iconCount()).toBeGreaterThan(0);
  });
});

describe("the sheet", () => {
  function openSheet(binding: WorktreeBinding, missing: readonly string[]): void {
    render(<BindingChip binding={binding} missingWorktreePaths={missing} />);
    fireEvent.click(screen.getByRole("button", { name: "Workspace binding" }));
  }

  it("stays shut until the chip is tapped", () => {
    render(<BindingChip binding={twoRepoBinding({})} missingWorktreePaths={[]} />);
    expect(screen.queryByRole("dialog", { name: "Workspace" })).toBeNull();
  });

  it("lists EVERY entry, primary first, regardless of wire order", () => {
    openSheet(twoRepoBinding({}), []);
    const sheet = screen.getByRole("dialog", { name: "Workspace" });
    const text = sheet.textContent ?? "";
    expect(text).toContain("alpha");
    expect(text).toContain("beta");
    expect(text.indexOf("alpha")).toBeLessThan(text.indexOf("beta"));
  });

  it("badges only the primary entry", () => {
    openSheet(twoRepoBinding({}), []);
    expect(screen.getAllByText("Primary")).toHaveLength(1);
  });

  it("reports a failed setup script with its exit code", () => {
    openSheet(twoRepoBinding({ second: { setupState: "failed", setupExitCode: 127 } }), []);
    expect(screen.getByText("Setup script failed. Exit code 127.")).toBeTruthy();
  });

  /**
   * Both notes, on one entry, at once. They have different causes and different
   * fixes, and the component renders them from separate conditions — so a
   * regression that collapsed them into one `else` branch would still satisfy
   * either note asserted on its own.
   */
  it("shows missing-on-disk AND a setup failure together on the same entry", () => {
    openSheet(
      twoRepoBinding({ second: { setupState: "failed", setupExitCode: 2 } }),
      ["C:\\worktrees\\beta-fix"],
    );
    expect(screen.getByText(/missing on the host/i)).toBeTruthy();
    expect(screen.getByText("Setup script failed. Exit code 2.")).toBeTruthy();
  });
});
