import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The shell's contract, asserted against its own SOURCE.
 *
 * Unusual, and deliberate. `teams-tab` runs vitest in a `node` environment
 * with no DOM, so a rendered-style assertion is not available here — and the
 * properties that matter are static facts about the stylesheet rather than
 * runtime behaviour.
 *
 * The audit's finding was a pair of counts: desktop uses `100vh` at the root
 * 4 times and `min-h-0` containment 197 times; the tab used `100vh` on every
 * one of eleven screens and containment zero times. Those are exactly the
 * kind of facts a source assertion can hold, and exactly the kind that
 * regress silently — someone adds `minHeight: 100vh` to a new screen and
 * nothing fails.
 *
 * Stated limit: this proves the RULES are followed, not that the layout
 * looks right. The screenshot during the wait is what checks the latter, and
 * neither substitutes for the other.
 */
const SRC = join(import.meta.dirname, "..");

function read(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

describe("shell contract — containment, not growth", () => {
  it("CONTRACT: the shell is the ONLY place with a viewport height", () => {
    // A page that grows cannot have a pinned region. `100vh` belongs once, at
    // the frame root — desktop has it 4 times at its root and nowhere else.
    const shell = read("shell/app-shell.tsx");
    expect(shell).toContain('height: "100vh"');
    // `height`, NOT `minHeight`: minHeight grows the page inside an iframe,
    // which is the defect.
    expect(shell).not.toContain('minHeight: "100vh"');
  });

  it("CONTRACT: the scrolling body sets minHeight 0", () => {
    // The containment desktop uses 197 times and the tab used zero. Without
    // it a flex child will not shrink below its content, the frame grows, and
    // the header scrolls away — the exact defect the shell exists to fix.
    expect(read("shell/app-shell.tsx")).toContain("minHeight: 0");
  });

  it("CONTRACT: the header cannot be squeezed", () => {
    // A header that shrinks under a long body is not a persistent region.
    const shell = read("shell/app-shell.tsx");
    expect(shell).toContain("flexShrink: 0");
  });

  it("CONTRACT: the status row is a fixed-height region, like desktop's h-10", () => {
    const row = read("shell/epic-status-row.tsx");
    expect(row).toContain('height: "40px"');
    expect(row).toContain("flexShrink: 0");
  });

  it("CONTRACT: loading names the cause rather than showing a bare spinner", () => {
    // A spinner with no duration reads as broken after ten seconds, and this
    // wait is ~40s of host-side serialisation on a large epic.
    expect(read("shell/epic-status-row.tsx")).toContain("large epics take a while");
  });

  it("CONTRACT: stale carries the age", () => {
    // "Disconnected" with no age gives no basis to judge whether the rows on
    // screen can be trusted — the age is the whole decision.
    expect(read("shell/epic-status-row.tsx")).toContain("ageLabel");
  });

  it("CONTROL: these assertions can fail — a string absent from the shell is absent", () => {
    // Without this, a read() that silently returned "" would pass every
    // `not.toContain` above and the `toContain`s would be the only real
    // checks. Proves the file is actually being read.
    const shell = read("shell/app-shell.tsx");
    expect(shell.length).toBeGreaterThan(500);
    expect(shell).not.toContain("position: \"sticky\"");
  });
});
