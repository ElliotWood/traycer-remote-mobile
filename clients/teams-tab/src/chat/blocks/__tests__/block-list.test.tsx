// @vitest-environment jsdom
/**
 * The transcript renders block PAYLOADS, not labels.
 *
 * What this suite is really guarding is the difference between the two
 * transcript projections. `shared/epic/transcript.ts` answers what a block is
 * CALLED and reduces everything non-prose to a label string; the tab read
 * only that, so twelve kinds could only ever be chips. These tests assert the
 * things a label cannot carry — a file's path AND its +N/−M counts, a
 * command's exit code, a to-do's items, a subagent's nested child — because
 * those are exactly the assertions that would go back to red if this surface
 * ever fell back to the wording projection.
 *
 * They run against the SHARED `buildBlockTree`, not a staged tree, so
 * suppression and nesting are properties of the projection under test rather
 * than of the fixture.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { ContentBlock } from "@traycer/protocol/persistence/epic/content-blocks";
import {
  buildBlockTree,
  partitionBlocks,
} from "@traycer-clients/shared/epic/transcript-tree";
import { BlockList } from "../block-list";
import {
  CHAT_FIXTURE_BLOCK_TREES,
  CHAT_FIXTURE_RAW_BLOCKS,
} from "../../chat-blocks-fixture";

// Testing Library's automatic cleanup hooks onto a global `afterEach`, which
// this package does not expose (`globals` is unset). Registered by hand, the
// same way `error-boundary.test.tsx` does.
afterEach(() => {
  cleanup();
});

function renderBlocks(blocks: readonly ContentBlock[]): void {
  render(
    <FluentProvider theme={webLightTheme}>
      <BlockList nodes={buildBlockTree(blocks)} client={null} />
    </FluentProvider>,
  );
}

function renderFixture(messageId: string): void {
  const nodes = CHAT_FIXTURE_BLOCK_TREES.get(messageId);
  if (nodes === undefined) throw new Error(`no fixture tree for ${messageId}`);
  render(
    <FluentProvider theme={webLightTheme}>
      <BlockList nodes={nodes} client={null} />
    </FluentProvider>,
  );
}

describe("the transcript renders every block kind", () => {
  it("draws a file change with its path and its line counts", () => {
    renderFixture("m2");
    // The SHORTENED path — the tenant prefix is what the shared rule strips,
    // and a fixture path without one would agree with the renderer without
    // testing it.
    expect(
      screen.getByText("clients/teams-tab/src/config.ts"),
    ).toBeDefined();
    expect(screen.getByText("+34")).toBeDefined();
    expect(screen.getByText("−6")).toBeDefined();
  });

  it("draws a command with its non-zero exit code", () => {
    renderFixture("m2");
    expect(screen.getByText("$ bun test clients/teams-tab")).toBeDefined();
    expect(screen.getByText("exit 1")).toBeDefined();
  });

  it("draws a to-do list's items, not its count", () => {
    renderFixture("m2");
    expect(screen.getByText("Write the zod schema")).toBeDefined();
    expect(screen.getByText("Drop the legacy loader")).toBeDefined();
    expect(screen.getByText("1 of 3 done")).toBeDefined();
  });

  it("draws an error's message inside an alert", () => {
    renderFixture("m2");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(
      "VITE_HOST_WS_URL is required and was not set.",
    );
    expect(alert.textContent).toContain("CONFIG_MISSING");
  });

  it("draws an A2A send as the message it sent", () => {
    renderFixture("m2");
    expect(screen.getByText("Sent message")).toBeDefined();
    expect(screen.getByText("reply expected")).toBeDefined();
  });

  it("draws a plan's steps and says how many it did not list", () => {
    renderFixture("m3");
    expect(screen.getByText("Move config onto zod")).toBeDefined();
    expect(screen.getByText("Add the schema")).toBeDefined();
    // Six steps, five shown. Silence here would leave the reader believing
    // the plan has five.
    expect(screen.getByText("+ 1 more step below")).toBeDefined();
  });

  it("draws a resolved approval, with its decision", () => {
    renderFixture("m3");
    expect(screen.getByText("✓")).toBeDefined();
    expect(screen.getByText("config.ts (+34 −6)")).toBeDefined();
  });

  it("draws an artifact operation by title", () => {
    renderFixture("m3");
    expect(
      screen.getByText("Teams ↔ Mobile parity contract"),
    ).toBeDefined();
  });

  it("draws a compaction as a divider carrying its token counts", () => {
    renderFixture("m3");
    expect(screen.getByText("Compacted · 180000→42000 tokens · 12s")).toBeDefined();
  });

  it("draws an autonomous resume by its trigger", () => {
    renderFixture("m4");
    expect(screen.getByText("Explore finished")).toBeDefined();
    expect(
      screen.getByText(
        "17 call sites, all under clients/. None outside the workspace.",
      ),
    ).toBeDefined();
  });
});

describe("structure, which is the half a renderer cannot supply", () => {
  /**
   * The reason `transcript-tree.ts` had to move to `shared` before any of
   * this could be written: the tab's own projection had already thrown the
   * `parentBlockId` away.
   */
  it("nests a subagent's child under it rather than beside it", () => {
    renderFixture("m4");
    /*
     * CLOSED FIRST, and that is itself the contract. Collapsed-by-default is
     * mandatory for these cards — a real chat runs to hundreds of activity
     * blocks — so a nested child is genuinely not in the document until the
     * reader opens its parent. The first version of this test asserted on
     * `Grep` directly and failed for exactly that reason.
     */
    expect(screen.queryByText("Grep")).toBeNull();

    const card = screen.getByLabelText("Sub-agent: Explore");
    fireEvent.click(card);

    // Now it is there — and it is INSIDE the subagent's card, not a sibling
    // row beside it. Containment is the assertion; adjacency would pass for a
    // flat list, which is the thing this is distinguishing itself from.
    expect(card.parentElement?.textContent).toContain("Grep");
  });

  it("suppresses the tool call a file change replaces", () => {
    renderFixture("m2");
    // `tc-edit` is a `toolName: "Edit"` call whose file_change is
    // `tc-edit:1`. Exactly one row mentions the edit — the file change —
    // because the suppression rule removed the other. Without it the reader
    // sees one edit twice and cannot tell it is one edit.
    expect(screen.queryAllByLabelText(/^Tool call: Edit$/)).toHaveLength(0);
    expect(
      screen.getByLabelText("Edit clients/teams-tab/src/config.ts"),
    ).toBeDefined();
  });

  it("suppresses the tool call that spawned a subagent", () => {
    renderFixture("m4");
    expect(screen.queryAllByLabelText(/^Tool call: Task$/)).toHaveLength(0);
    expect(screen.getByLabelText("Sub-agent: Explore")).toBeDefined();
  });
});

describe("reasoning, which had never rendered at all", () => {
  /**
   * `reasoning` carries its prose in `content`. The wording projection reads
   * `content` only when it is an OBJECT and otherwise falls back to `text`,
   * which this block does not have — so the tab produced an empty string and
   * correctly rendered nothing. The gap table counted this as one of the two
   * kinds that DID render.
   *
   * Reading `block.content` is the whole fix, and this is the assertion that
   * goes red if it is ever reverted to `text`.
   */
  it("renders the model's reasoning from `content`", () => {
    renderFixture("m2");
    expect(screen.getByText("Thought for 9s")).toBeDefined();
  });
});

describe("no silent drop", () => {
  /**
   * The chip did not go away — it moved to the end. Every declared kind now
   * has a renderer, so this fires only for a block type the protocol does not
   * declare, and it still NAMES it. A turn that ran three tools and wrote one
   * sentence must never read as a turn that wrote one sentence.
   */
  it("names a block type it does not recognise", () => {
    /*
     * Parsed rather than asserted. A future block type is something that
     * arrives OFF THE WIRE as JSON — a cast would be this test telling the
     * type system a lie in order to test what happens when reality does. It
     * also keeps the file clear of the chained/`as unknown` assertions this
     * package's eslint config restricts.
     */
    const unknown: readonly ContentBlock[] = JSON.parse(
      '[{"type":"quantum_entanglement","blockId":"qq-1","status":"completed","timestamp":0,"parentBlockId":null}]',
    );
    renderBlocks(unknown);
    expect(screen.getByTestId("unknown-block").textContent).toContain(
      "quantum_entanglement",
    );
  });

  /**
   * The partition, asserted rather than assumed: nothing in the fixture ends
   * up unaccounted for. `partitionBlocks` is the shared invariant and this is
   * the tab claiming it too.
   */
  it("accounts for every fixture block", () => {
    for (const [id, blocks] of Object.entries(CHAT_FIXTURE_RAW_BLOCKS)) {
      // `partitionBlocks` is the shared invariant — every source id lands in
      // exactly one of {rendered, alternatePath, suppressed}, and anything
      // left over is a genuine drop. Asserting it here is the tab claiming
      // the same property, not re-deriving it.
      const partition = partitionBlocks(blocks);
      expect(partition.dropped, `${id} dropped`).toEqual([]);
      // Both suppressions in the fixture are tool calls another card replaced.
      for (const [blockId] of partition.suppressed) {
        const block = blocks.find((b) => b.blockId === blockId);
        expect(block?.type, `${id}: ${blockId}`).toBe("tool_call");
      }
      expect(partition.suppressed.size, `${id} suppressed`).toBe(
        id === "m3" ? 0 : 1,
      );
    }
  });
});

/** Kept for the type checker: the render helper must return void, not JSX. */
export type _Unused = ReactElement;
