// @vitest-environment jsdom
/**
 * M6 item 2 — "Review all".
 *
 * The ticket's verification for this item is *completeness*: on a change with
 * ≥10 files, every file must be reachable and the jump-list complete. So the
 * fixture is 12 files, not two — a jump-list that silently drops or truncates
 * entries is the failure this surface exists to avoid, and a two-file fixture
 * cannot see truncation at all.
 *
 * The other assertion is IDENTITY, and it needs the hazard present in the
 * fixture to mean anything: two artifact rows that share a `title`. A jump-list
 * keyed by the label it displays scrolls to the first of them for both, and
 * looks entirely correct doing it. Only distinct paths behind identical labels
 * can catch that.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatAccumulatedFileChangeSchema,
  type ChatAccumulatedFileChange,
} from "@traycer/protocol/host/agent/gui/subscribe";
import { NavHost } from "@/router/nav-host";
import { AccumulatedChangesPanel } from "@/views/chat/accumulated-changes-panel";
import { ReviewAllSheet } from "@/views/chat/review-all-sheet";
import { fireEvent, render, screen, waitFor } from "@/test-utils/dom";

/**
 * jsdom keeps ONE session history per file, so each test must mount onto a
 * fresh unstamped entry or `NavHost` correctly reads the leftovers as a
 * mid-stack reload. Same reason, same fix as `nav-host.test.tsx`.
 */
beforeEach(() => {
  window.history.pushState(null, "");
});

function fileChange(
  filePath: string,
  extra: Partial<ChatAccumulatedFileChange>,
): ChatAccumulatedFileChange {
  return chatAccumulatedFileChangeSchema.parse({
    filePath,
    operation: "edit",
    diffSource: "snapshot",
    beforeContent: "alpha\n",
    afterContent: "alpha\nbeta\n",
    reason: "snapshot",
    undoable: true,
    artifact: null,
    ...extra,
  });
}

/** 12 files — past the ticket's ≥10 bar — plus two same-titled artifacts. */
const CHANGES: readonly ChatAccumulatedFileChange[] = [
  ...Array.from({ length: 10 }, (_unused, i) => fileChange(`src/file-${String(i)}.ts`, {})),
  fileChange("epics/one/artifacts/plan/index.md", {
    artifact: { artifactId: "a1", kind: null, title: "Plan" },
  }),
  fileChange("epics/two/artifacts/plan/index.md", {
    artifact: { artifactId: "a2", kind: null, title: "Plan" },
  }),
];

function jumpEntries(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-jump-path]"));
}

function sections(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-review-path]"));
}

describe("ReviewAllSheet", () => {
  it("renders every file's diff on one surface, with a jump entry for each", () => {
    render(<ReviewAllSheet changes={CHANGES} onClose={() => {}} />);

    // Every file reachable: a section per change, in the same order.
    expect(sections().map((el) => el.dataset.reviewPath)).toEqual(
      CHANGES.map((c) => c.filePath),
    );
    // ...and its diff really rendered, not just its heading.
    expect(screen.getAllByTestId("diff-view")).toHaveLength(CHANGES.length);

    // Jump-list complete: one entry per change, and every entry points at a
    // section that exists. A jump entry with no target is the silent half of
    // an incomplete list — it renders fine and does nothing when tapped.
    const targets = new Set(sections().map((el) => el.dataset.reviewPath));
    const jumps = jumpEntries().map((el) => el.dataset.jumpPath);
    expect(jumps).toEqual(CHANGES.map((c) => c.filePath));
    for (const jump of jumps) expect(targets.has(jump)).toBe(true);
  });

  it("jumps to the section for the tapped PATH, not the first row sharing its label", () => {
    render(<ReviewAllSheet changes={CHANGES} onClose={() => {}} />);

    // Both artifacts display "Plan"; only the path tells them apart.
    const labels = jumpEntries().map((el) => el.textContent ?? "");
    expect(labels.filter((text) => text.startsWith("Plan"))).toHaveLength(2);

    const scrolled: (string | undefined)[] = [];
    for (const section of sections()) {
      section.scrollIntoView = vi.fn(() => {
        scrolled.push(section.dataset.reviewPath);
      });
    }

    const second = jumpEntries().find(
      (el) => el.dataset.jumpPath === "epics/two/artifacts/plan/index.md",
    );
    if (second === undefined) throw new Error("no jump entry for the second artifact");
    fireEvent.click(second);

    expect(scrolled).toEqual(["epics/two/artifacts/plan/index.md"]);
  });

  it("survives a browser with no scrollIntoView", () => {
    // jsdom has none, and neither did every browser this ships to. The jump
    // degrades to nothing; it must not take the screen down with it.
    //
    // `expect(...).not.toThrow()` is NOT the assertion here, and that is a
    // measurement, not a preference: with the guard removed the handler DOES
    // throw and `.not.toThrow()` still passes, because React reports a
    // handler's error as an unhandled window error rather than propagating it
    // to the caller. Vitest prints "This might cause false positive tests" and
    // means it. So the window error is what gets asserted on.
    const errors: string[] = [];
    const onError = (event: ErrorEvent): void => {
      errors.push(event.message);
    };
    window.addEventListener("error", onError);
    try {
      render(<ReviewAllSheet changes={CHANGES} onClose={() => {}} />);
      for (const section of sections()) {
        // @ts-expect-error — removing an optional DOM method the guard exists for.
        delete section.scrollIntoView;
      }

      const first = jumpEntries()[0];
      if (first === undefined) throw new Error("no jump entries");
      fireEvent.click(first);

      expect(errors).toEqual([]);
    } finally {
      window.removeEventListener("error", onError);
    }
  });

  /*
   * Closing is deliberately NOT a local state flip: the ✕ and the OS back
   * gesture both route through `NavHost`, which is the only reason back cannot
   * pop the chat route out from under an open review. A test that called
   * `onClose` directly would pass against a ✕ wired straight to the callback —
   * and that version leaves an orphan history entry, so the user's next back
   * tap appears to do nothing.
   */
  describe("dismissal goes through the navigation model", () => {
    function renderInNavHost(onClose: () => void, onPopRoutes: (count: number) => void): void {
      render(
        <NavHost routeDepth={1} onPopRoutes={onPopRoutes}>
          <ReviewAllSheet changes={CHANGES} onClose={onClose} />
        </NavHost>,
      );
    }

    it("closes on the ✕, without popping the route underneath", async () => {
      const onClose = vi.fn();
      const onPopRoutes = vi.fn();
      renderInNavHost(onClose, onPopRoutes);

      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(1);
      });
      // The chat is still there behind it — one back, one level.
      expect(onPopRoutes).not.toHaveBeenCalled();
    });

    it("closes on the OS back gesture, which is the same path", async () => {
      const onClose = vi.fn();
      const onPopRoutes = vi.fn();
      renderInNavHost(onClose, onPopRoutes);

      window.history.back();

      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(1);
      });
      expect(onPopRoutes).not.toHaveBeenCalled();
    });
  });

  it("totals the whole changeset, not one file", () => {
    render(<ReviewAllSheet changes={CHANGES} onClose={() => {}} />);

    const header = screen.getByRole("dialog", { name: "Review all changes" });
    // 12 files, one added line each: a per-file total would read +1.
    expect(header.textContent).toContain("12 files");
    expect(header.textContent).toContain("+12");
  });
});

/*
 * The seam this epic keeps finding: a fully-tested component nobody reaches.
 * Every assertion above holds against a panel that never renders the sheet, so
 * the panel's own control gets its own test.
 */
describe("AccumulatedChangesPanel — the Review all control reaches the sheet", () => {
  const panel = (): void => {
    render(
      <AccumulatedChangesPanel
        changes={CHANGES}
        canMutate={false}
        undoAllStatus={undefined}
        undoStatusFor={() => undefined}
        onUndoAll={() => {}}
        onUndoFile={() => {}}
      />,
    );
  };

  it("opens the review surface, with every file in it", () => {
    panel();
    expect(screen.queryByRole("dialog", { name: "Review all changes" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Review all" }));

    expect(screen.getByRole("dialog", { name: "Review all changes" })).toBeTruthy();
    expect(sections()).toHaveLength(CHANGES.length);
  });

  it("offers review to a viewer who cannot mutate — reading is not a mutation", () => {
    // `canMutate: false` above. Undo is correctly disabled here; Review must
    // not be, or a read-only user loses the one affordance that costs nothing.
    panel();
    const review = screen.getByRole("button", { name: "Review all" });
    expect(review.hasAttribute("disabled")).toBe(false);

    fireEvent.click(review);
    expect(screen.getByRole("dialog", { name: "Review all changes" })).toBeTruthy();
  });

});
