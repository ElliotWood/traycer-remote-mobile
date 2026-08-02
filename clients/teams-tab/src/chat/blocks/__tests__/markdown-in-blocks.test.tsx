// @vitest-environment jsdom
/**
 * PROSE INSIDE A BLOCK IS MARKDOWN, and these renderers printed it as text.
 *
 * The live harness caught it against the deployed tab: `literalFences` went
 * 0 → 72 the moment the block renderers shipped, and the hits were
 * `fui-Body1` nodes reading *"…Here is my report. --- # How the Desktop GUI
 * renders…"* — headings and rules on screen as characters.
 *
 * This is the THIRD markdown-rendering defect on this project and the second
 * in the tab. Both earlier ones were invisible for the same reason: **the
 * fixture contained no markdown**, so the test could not fail on the claim it
 * was named after. So every specimen below carries a fence, a heading and a
 * horizontal rule.
 *
 * TWO DIFFERENT TRANSFORMATIONS OF THE SAME FIELD, which is the part that
 * would otherwise come back:
 *
 *   a BODY     renders it — a fence becomes a code block, a heading a heading
 *   a SUMMARY  strips it — it is one truncated line, so a `#` in it would be
 *              a heading marker inside a caption, and a fence would be opened
 *              and never closed
 *
 * ── Two things this suite has to do that the first draft of it did not ──
 *
 * **It opens the card.** `CollapsibleCard` is `defaultOpen = false` and mounts
 * its body only while open (`block-card.tsx`), so a subagent's `result` is not
 * in the document at all on first render. An assertion on the body that never
 * clicks fails *identically* before and after the fix — it measures the
 * collapse, not the markdown. `block-list.test.tsx` records the same trap
 * ("the first version of this test asserted on `Grep` directly and failed for
 * exactly that reason"), which is why the collapsed state is asserted here as
 * its own case rather than assumed.
 *
 * **It builds fixtures through the schemas.** A hand-written literal cast with
 * `as unknown as SubAgentBlock` omitted `workflowMeta`, and
 * `subagent-block.tsx` tests that with `meta !== null` — so `undefined` took
 * the truthy branch and the render died on a TypeError. That failure also
 * looks like "the test fails before the fix". Parsing the fixture applies the
 * schema's own defaults, so a field added to the protocol cannot quietly
 * un-build the specimen.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import {
  autonomousResumeBlockSchema,
  planBlockSchema,
  subAgentBlockSchema,
  todoBlockSchema,
  type AutonomousResumeBlock as AutonomousResumeBlockType,
  type PlanBlock as PlanBlockType,
  type SubAgentBlock as SubAgentBlockType,
  type TodoBlock as TodoBlockType,
} from "@traycer/protocol/persistence/epic/content-blocks";
import { AutonomousResumeBlock } from "../autonomous-resume-block";
import { PlanBlock } from "../plan-block";
import { SubagentBlock } from "../subagent-block";
import { TodoBlock } from "../todo-block";

// Testing Library's automatic cleanup hooks onto a global `afterEach`, which
// this package does not expose (`globals` is unset). Registered by hand, the
// same way `block-list.test.tsx` does.
afterEach(() => {
  cleanup();
});

/** Built rather than typed, so this file's source carries no bare fence. */
const FENCE = "`".repeat(3);

/** A real-shaped agent report: prose, a rule, a heading, and a fenced block. */
const MARKDOWN_REPORT = [
  "I have a comprehensive picture. Here is my report.",
  "",
  "---",
  "",
  "# How the renderer works",
  "",
  `${FENCE}ts`,
  "const x = 1;",
  FENCE,
].join("\n");

function subagent(): SubAgentBlockType {
  return subAgentBlockSchema.parse({
    type: "subagent",
    blockId: "sa-md",
    status: "completed",
    timestamp: 1,
    name: "Explore",
    agentType: "general-purpose",
    task: "Read the renderer",
    progressUpdates: [],
    result: MARKDOWN_REPORT,
  });
}

function plan(): PlanBlockType {
  return planBlockSchema.parse({
    type: "plan",
    blockId: "pl-md",
    status: "completed",
    timestamp: 1,
    planId: "plan-1",
    planStatus: "ready",
    harnessId: "claude",
    source: { harnessId: "claude", kind: "exit_plan_mode" },
    title: "The plan",
    summary: MARKDOWN_REPORT,
    steps: [
      {
        id: "s1",
        text: "Route **the result** through `ArtifactMarkdown`",
        status: "pending",
      },
    ],
  });
}

function todo(): TodoBlockType {
  return todoBlockSchema.parse({
    type: "todo",
    blockId: "td-md",
    status: "completed",
    timestamp: 1,
    items: [
      {
        id: "t1",
        text: "Strip **markdown** from the `summary`",
        status: "pending",
        priority: null,
        activeForm: null,
      },
    ],
  });
}

function draw(node: ReactElement): void {
  render(<FluentProvider theme={webLightTheme}>{node}</FluentProvider>);
}

/** Everything a reader can actually see, as characters. */
function onScreen(): string {
  return document.body.textContent ?? "";
}

describe("markdown inside a subagent block", () => {
  it("does not mount the result until the card is opened", () => {
    /*
     * A CONTROL, and the only test here that is not expected to fail on the
     * defect. It exists to keep the next test honest: `pre > 0` only means
     * "the fence rendered" while it is established that a closed card has no
     * `pre` for an unrelated reason. Without this, a regression that stopped
     * mounting the body entirely would read as the markdown fix failing.
     *
     * Keyed on `aria-expanded` rather than on text, because the closed card's
     * caption draws from the same `result` field — so text cannot distinguish
     * "unmounted" from "mounted".
     */
    draw(<SubagentBlock block={subagent()} childNodes={[]} client={null} />);
    const card = screen.getByLabelText("Sub-agent: Explore");

    expect(card.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelectorAll("pre")).toHaveLength(0);

    fireEvent.click(card);
    expect(card.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders the opened result as markdown, not as characters", () => {
    draw(<SubagentBlock block={subagent()} childNodes={[]} client={null} />);
    fireEvent.click(screen.getByLabelText("Sub-agent: Explore"));

    // A fence became a code block and a heading became a heading.
    expect(document.querySelectorAll("pre").length).toBeGreaterThan(0);
    expect(document.querySelectorAll("h1").length).toBeGreaterThan(0);
    // And the code survived the trip — an empty `pre` would satisfy the count
    // above while having dropped the payload.
    expect(onScreen()).toContain("const x = 1;");
  });

  it("never shows a fence, a heading marker or a rule as text", () => {
    draw(<SubagentBlock block={subagent()} childNodes={[]} client={null} />);
    fireEvent.click(screen.getByLabelText("Sub-agent: Explore"));

    const shown = onScreen();
    expect(shown).not.toContain(FENCE);
    expect(shown).not.toContain("# How the renderer works");
    expect(shown).not.toContain("---");
  });

  it("strips markdown from the one-line summary rather than rendering it", () => {
    // Left CLOSED deliberately: with the body unmounted, the only text drawn
    // from `result` is the caption — so this reads the caption without naming
    // a style class or out-guessing `getByText`'s ancestor matching.
    draw(<SubagentBlock block={subagent()} childNodes={[]} client={null} />);

    const caption = onScreen();
    expect(caption).toContain("comprehensive picture");
    expect(caption).toContain("How the renderer works"); // the words survive
    expect(caption).not.toContain(FENCE);
    expect(caption).not.toContain("#");
    expect(caption).not.toContain("---");
    // A summary carries the PROSE. Code inside a fence is not prose, and a
    // caption that quotes it is the raw dump this replaced — the closed card
    // was drawing the entire report, `const x = 1;` included.
    expect(caption).not.toContain("const x = 1;");
  });
});

describe("markdown inside a plan block", () => {
  it("renders the summary as markdown and strips it from a step", () => {
    draw(<PlanBlock block={plan()} />);

    // The SUMMARY is a paragraph — a body, so it renders.
    expect(document.querySelectorAll("pre").length).toBeGreaterThan(0);
    expect(document.querySelectorAll("h1").length).toBeGreaterThan(0);

    // A STEP is one line in a list — so it is stripped, not rendered. The
    // words survive and the syntax is gone.
    const shown = onScreen();
    expect(shown).toContain("Route the result through ArtifactMarkdown");
    expect(shown).not.toContain("**");
    expect(shown).not.toContain(FENCE);
  });
});

describe("markdown inside a todo block", () => {
  it("strips markdown from an item's text", () => {
    draw(<TodoBlock block={todo()} />);

    const shown = onScreen();
    expect(shown).toContain("Strip markdown from the summary");
    expect(shown).not.toContain("**");
  });
});

/**
 * The two fields the LIVE harness traced, added after the first fix moved the
 * deployed count 72 -> 50 rather than to 0.
 *
 * The first of these is the one that was actually costing the 50. It was found
 * by matching the label the harness saw — `"subagent · completed"` — to the
 * source that composes it (`{trigger.kind} · {trigger.status}`), rather than
 * by picking the most plausible of four candidate `Body1 as="p"` sites. The
 * plausible pick was wrong and moved no number.
 */
describe("markdown in the fields the live harness traced", () => {
  it("renders an autonomous-resume trigger summary as markdown", () => {
    const block = autonomousResumeBlockSchema.parse({
      type: "autonomous_resume",
      blockId: "ar-md",
      status: "completed",
      timestamp: 1,
      triggers: [
        {
          kind: "subagent",
          status: "completed",
          title: "Explore finished",
          summary: MARKDOWN_REPORT,
        },
      ],
    }) as AutonomousResumeBlockType;

    draw(<AutonomousResumeBlock block={block} />);

    expect(document.querySelectorAll("pre").length).toBeGreaterThan(0);
    const shown = onScreen();
    expect(shown).not.toContain(FENCE);
    expect(shown).not.toContain("# How the renderer works");
  });

  it("renders a sub-agent TASK as markdown", () => {
    /*
     * EVIDENCED BY TEST, NOT BY THE LIVE COUNT. Routing the task through the
     * markdown renderer moved the deployed number not at all — because no
     * sampled sub-agent happened to have markdown in its task. That is a fact
     * about the sample, not about the code: a task IS authored markdown, and
     * this fixture is the specimen the live transcript did not supply.
     */
    const block = subAgentBlockSchema.parse({
      type: "subagent",
      blockId: "sa-task-md",
      status: "completed",
      timestamp: 1,
      name: "Explore",
      task: MARKDOWN_REPORT,
      progressUpdates: [],
      result: null,
    });

    draw(<SubagentBlock block={block} childNodes={[]} client={null} />);
    fireEvent.click(screen.getByLabelText("Sub-agent: Explore"));

    expect(document.querySelectorAll("pre").length).toBeGreaterThan(0);
    expect(onScreen()).not.toContain(FENCE);
  });
});
