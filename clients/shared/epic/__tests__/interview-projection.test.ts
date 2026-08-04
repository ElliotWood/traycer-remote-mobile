/**
 * THE INTERVIEW PROJECTION CARRIES WHAT THE REPLY IS BUILT FROM.
 *
 * `transcript.ts` is lossy on purpose — it exists to say what a block is
 * CALLED. It made one exception from the start, `interview`, and its docblock
 * gives the reason: the questions "can be found nowhere else", so a chip would
 * leave the user told a question exists and unable to read it.
 *
 * That argument covers `options` word for word, and until 2026-08-04 the
 * projection dropped them anyway — along with `header` and `multiSelect`. The
 * result was not a cosmetic loss. A client that cannot see the options cannot
 * submit one, so the Teams tab submitted free text, which is a LEGITIMATE
 * `values` member (desktop sends an explicit "Other" that way). Every Teams
 * answer to an option question therefore arrived as a considered refusal of
 * every option, from a user who was never shown them, and no layer could tell
 * the two apart — there is no validator missing, the value is simply valid.
 *
 * So these assertions are about REACHABILITY, not about rendering: whether the
 * fields a correct answer is assembled from survive the projection at all.
 */
import { describe, expect, it } from "vitest";
import type { ContentBlock } from "@traycer/protocol/persistence/epic/content-blocks";
import { toTranscriptBlock } from "../transcript";

function interview(
  questions: readonly Record<string, unknown>[],
): ContentBlock {
  return {
    type: "interview",
    blockId: "iv-1",
    status: "completed",
    timestamp: 0,
    parentBlockId: null,
    toolName: "AskUserQuestion",
    title: "One thing before I finish",
    description: null,
    questions,
    answers: [],
    error: null,
    metadata: null,
  } as unknown as ContentBlock;
}

function projectQuestions(questions: readonly Record<string, unknown>[]) {
  const block = toTranscriptBlock(interview(questions));
  if (block.kind !== "interview") throw new Error("not an interview");
  return block.questions;
}

describe("interview questions survive the label projection", () => {
  it("carries options, header and multiSelect", () => {
    const [q] = projectQuestions([
      {
        questionId: "q1",
        question: "Hard failure, or warn?",
        header: "Validation",
        multiSelect: true,
        options: [
          { label: "Keep it failing", description: "Always a mistake.", preview: null },
          { label: "Warn and continue", description: null, preview: null },
        ],
      },
    ]);

    expect(q.header).toBe("Validation");
    expect(q.multiSelect).toBe(true);
    expect(q.options).toEqual([
      { label: "Keep it failing", description: "Always a mistake." },
      { label: "Warn and continue", description: null },
    ]);
  });

  it("keeps a free-text question distinguishable from an option-bearing one", () => {
    // The client branches on `options.length`, so "no options" and "options we
    // dropped" must not look the same. This is the assertion that would have
    // failed before the fix — every question looked free-text.
    const [free] = projectQuestions([
      { questionId: "q1", question: "Anything else?", options: [] },
    ]);
    const [choice] = projectQuestions([
      {
        questionId: "q2",
        question: "Which one?",
        options: [{ label: "A", description: null, preview: null }],
      },
    ]);

    expect(free.options).toEqual([]);
    expect(choice.options).toHaveLength(1);
  });

  it("drops an option with no usable label rather than defaulting it", () => {
    // The label IS the submitted value. An option defaulted to "" would render
    // a blank button that answers the question with an empty string — a
    // silently wrong answer, which is the failure mode this whole row is about.
    const [q] = projectQuestions([
      {
        questionId: "q1",
        question: "Which one?",
        options: [
          { label: "A", description: null, preview: null },
          { description: "no label at all", preview: null },
          { label: "", description: "empty label", preview: null },
          "not an object",
        ],
      },
    ]);

    expect(q.options).toEqual([{ label: "A", description: null }]);
  });

  it("defaults a malformed question to free-text rather than inventing options", () => {
    // Sanitize-on-read: a question whose `options` is not an array must not
    // throw and must not become a choice with zero choosable answers.
    const [q] = projectQuestions([
      { questionId: "q1", question: "Which one?", options: "A, B", multiSelect: "yes" },
    ]);

    expect(q.options).toEqual([]);
    // `"yes"` is truthy but is not `true`; a loose check would make this a
    // multi-select on the strength of a string.
    expect(q.multiSelect).toBe(false);
  });
});
