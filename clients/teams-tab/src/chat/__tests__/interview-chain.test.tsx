/**
 * @vitest-environment jsdom
 *
 * THE JOIN, which neither neighbouring suite covers.
 *
 * `interview-card.test.tsx` builds props by hand. `interview-projection.test.ts`
 * calls the projection and inspects its output. Both pass with the two halves
 * wired to nothing — the only thing connecting them is `tsc`, and a type error
 * "fixed" by widening a type would leave both suites green while the data
 * stopped arriving. That is the same shape as everything else this row has
 * produced, so it gets an assertion rather than a note.
 *
 * So this drives a REAL `ContentBlock` through the REAL projection into the
 * REAL card, and asserts the thing the user cares about: the option the agent
 * offered is on screen, and pressing it submits that option's label.
 *
 * Deliberately NOT a second copy of the unit tests. It asserts only what the
 * seam can break — that the fields survive the crossing — because a defect
 * inside either half is already covered next door.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { InterviewBlock } from "@traycer/protocol/persistence/epic/content-blocks";
import { toTranscriptBlock } from "@traycer-clients/shared/epic/transcript";
import { InterviewCard, type InterviewAnswerDraft } from "../interview-card";

afterEach(() => {
  cleanup();
});

/**
 * A block shaped as the host emits it. The labels are deliberately unlike the
 * question text and unlike each other's descriptions: if any of this arrived by
 * accident — echoed from the question, defaulted, or matched on a substring —
 * the assertions below would still be able to tell.
 */
const HOST_BLOCK: InterviewBlock = {
  type: "interview",
  blockId: "iv-chain",
  status: "completed",
  timestamp: 0,
  parentBlockId: null,
  toolName: "AskUserQuestion",
  title: "One thing before I finish",
  description: null,
  questions: [
    {
      questionId: "q1",
      question: "Should the relative-URL check stay a hard failure?",
      header: "Validation",
      multiSelect: false,
      options: [
        {
          label: "Keep it failing",
          description: "A relative URL is always a config mistake here.",
          preview: null,
        },
        {
          label: "Warn and continue",
          description: "Resolve against the host origin instead.",
          preview: null,
        },
      ],
    },
  ],
  answers: [],
  error: null,
  metadata: null,
};

function renderFromHostBlock(
  onAnswer: (answers: readonly InterviewAnswerDraft[]) => void,
): void {
  const projected = toTranscriptBlock(HOST_BLOCK);
  if (projected.kind !== "interview") {
    throw new Error(`projection returned ${projected.kind}, not an interview`);
  }
  render(
    <InterviewCard
      title={projected.title}
      questions={projected.questions}
      phase={{ kind: "idle" }}
      actionability={{ kind: "actionable" }}
      onAnswer={onAnswer}
    />,
  );
}

describe("a host interview block reaches the card with its options intact", () => {
  it("renders the options the agent actually offered", () => {
    renderFromHostBlock(vi.fn());

    expect(screen.getByRole("button", { name: /Keep it failing/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Warn and continue/ })).toBeDefined();
    // The description is what makes a choice choosable, and it crosses the
    // seam as a nested field — the part most likely to be dropped quietly.
    expect(
      screen.getByText("A relative URL is always a config mistake here."),
    ).toBeDefined();
    expect(screen.getByText("Validation")).toBeDefined();
  });

  it("submits the label the agent named, end to end", () => {
    const onAnswer = vi.fn<(a: readonly InterviewAnswerDraft[]) => void>();
    renderFromHostBlock(onAnswer);

    fireEvent.click(screen.getByRole("button", { name: /Warn and continue/ }));
    fireEvent.click(screen.getByRole("button", { name: /Send answer/ }));

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer.mock.calls[0][0]).toEqual([
      {
        questionId: "q1",
        question: "Should the relative-URL check stay a hard failure?",
        values: ["Warn and continue"],
      },
    ]);
  });

  it("gives an option-bearing question no free-text path once projected", () => {
    // The whole defect, expressed at the seam: if the projection stops
    // carrying `options`, the card falls back to free text and the answer
    // becomes a valid-but-wrong `values` member that nothing downstream can
    // distinguish from a deliberate "Other".
    renderFromHostBlock(vi.fn());
    expect(screen.getByRole("button", { name: /Keep it failing/ })).toBeDefined();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
