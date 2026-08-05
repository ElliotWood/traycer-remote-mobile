/**
 * @vitest-environment jsdom
 *
 * WHAT GETS SUBMITTED, not what gets rendered.
 *
 * This card had no test of any kind until 2026-08-04, and the defect it shipped
 * with is the reason the distinction matters. It rendered a textarea for every
 * question and never read `q.options`, so an answer to "which approach — A, B
 * or C?" went out as whatever the user typed. That string is a LEGITIMATE
 * `values` member — it is how desktop sends an explicit "Other" — so the wire
 * accepted it, nothing errored, and the agent received what looked like a
 * considered refusal of all three options.
 *
 * The consequence for testing is specific and worth stating: **a wire-level
 * assertion could not have caught it.** Both answers are valid frames. The only
 * place the two are distinguishable is the client that produced them, which is
 * here. So these tests assert on the `values` handed to `onAnswer`, and the
 * absence-of-a-textbox case is paired with a positive assertion, never left as
 * an absence on its own — `queryByRole` returning null also describes a card
 * that rendered nothing at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InterviewCard, type InterviewAnswerDraft } from "../interview-card";

afterEach(() => {
  cleanup();
});

const IDLE = { kind: "idle" } as const;
const ACTIONABLE = { kind: "actionable" } as const;

interface Question {
  readonly questionId: string | null;
  readonly question: string;
  readonly header: string | null;
  readonly options: readonly {
    readonly label: string;
    readonly description: string | null;
  }[];
  readonly multiSelect: boolean;
}

/**
 * Values chosen so nothing equals its own fallback: the labels are not
 * substrings of the question, each description differs from its label, and the
 * typed text in every case below is not any option's label. A fixture whose
 * option label happened to match what a broken card echoed back would go green
 * on the bug.
 */
const OPTIONS: readonly { readonly label: string; readonly description: string | null }[] = [
  { label: "Keep it failing", description: "A relative URL is a mistake." },
  { label: "Warn and continue", description: "Resolve against the origin." },
];

function optionQuestion(multiSelect: boolean): Question {
  return {
    questionId: "q1",
    question: "Should the relative-URL check stay a hard failure?",
    header: "Validation",
    options: OPTIONS,
    multiSelect,
  };
}

function freeTextQuestion(): Question {
  return {
    questionId: "q2",
    question: "Anything else to note?",
    header: null,
    options: [],
    multiSelect: false,
  };
}

/** The same question, before the host attached its options. */
function beforeOptions(): Question {
  return { ...optionQuestion(false), options: [] };
}

function renderCard(
  questions: readonly Question[],
  onAnswer: (answers: readonly InterviewAnswerDraft[]) => void,
): void {
  render(
    <InterviewCard
      title="Two things before I finish"
      questions={questions}
      phase={IDLE}
      actionability={ACTIONABLE}
      onAnswer={onAnswer}
    />,
  );
}

function press(name: RegExp): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("InterviewCard — option questions", () => {
  it("submits the option LABEL, not typed text", () => {
    const onAnswer = vi.fn<(a: readonly InterviewAnswerDraft[]) => void>();
    renderCard([optionQuestion(false)], onAnswer);

    press(/Keep it failing/);
    press(/Send answer/);

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer.mock.calls[0][0]).toEqual([
      {
        questionId: "q1",
        question: "Should the relative-URL check stay a hard failure?",
        values: ["Keep it failing"],
      },
    ]);
  });

  it("offers no free-text path at all when options exist", () => {
    renderCard([optionQuestion(false)], vi.fn());

    // POSITIVE first: the options really are on screen. Without this, the
    // absence below is satisfied by a card that rendered nothing.
    expect(screen.getByRole("button", { name: /Keep it failing/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Warn and continue/ })).toBeDefined();

    // The defect: any textbox here is a second answer path, and anything typed
    // into it lands in the same legitimate `values` slot as a real choice.
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows each option's description, which is what makes a choice choosable", () => {
    renderCard([optionQuestion(false)], vi.fn());
    expect(screen.getByText("A relative URL is a mistake.")).toBeDefined();
    expect(screen.getByText("Resolve against the origin.")).toBeDefined();
  });

  it("renders the question's header", () => {
    renderCard([optionQuestion(false)], vi.fn());
    expect(screen.getByText("Validation")).toBeDefined();
  });

  it("single-select replaces rather than accumulates", () => {
    const onAnswer = vi.fn<(a: readonly InterviewAnswerDraft[]) => void>();
    renderCard([optionQuestion(false)], onAnswer);

    press(/Keep it failing/);
    press(/Warn and continue/);
    press(/Send answer/);

    expect(onAnswer.mock.calls[0][0][0].values).toEqual(["Warn and continue"]);
  });

  it("multi-select accumulates both labels", () => {
    const onAnswer = vi.fn<(a: readonly InterviewAnswerDraft[]) => void>();
    renderCard([optionQuestion(true)], onAnswer);

    press(/Keep it failing/);
    press(/Warn and continue/);
    press(/Send answer/);

    expect(onAnswer.mock.calls[0][0][0].values).toEqual([
      "Keep it failing",
      "Warn and continue",
    ]);
  });

  it("marks the chosen option as pressed, so the choice is visible to a screen reader", () => {
    renderCard([optionQuestion(false)], vi.fn());
    expect(
      screen.getByRole("button", { name: /Keep it failing/ }).getAttribute("aria-pressed"),
    ).toBe("false");
    press(/Keep it failing/);
    expect(
      screen.getByRole("button", { name: /Keep it failing/ }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("cannot send until every question is answered", () => {
    const onAnswer = vi.fn<(a: readonly InterviewAnswerDraft[]) => void>();
    renderCard([optionQuestion(false), freeTextQuestion()], onAnswer);

    press(/Keep it failing/);
    press(/Send answer/);
    // One of two answered — the wire would accept the partial set and the
    // agent would simply ask again.
    expect(onAnswer).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "nothing further" },
    });
    press(/Send answer/);
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });
});

describe("InterviewCard — free-text questions", () => {
  it("submits typed text as a single value when there are no options", () => {
    const onAnswer = vi.fn<(a: readonly InterviewAnswerDraft[]) => void>();
    renderCard([freeTextQuestion()], onAnswer);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "  export it  " },
    });
    press(/Send answer/);

    expect(onAnswer.mock.calls[0][0][0].values).toEqual(["export it"]);
  });

  it("treats whitespace-only text as unanswered", () => {
    const onAnswer = vi.fn<(a: readonly InterviewAnswerDraft[]) => void>();
    renderCard([freeTextQuestion()], onAnswer);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    press(/Send answer/);
    expect(onAnswer).not.toHaveBeenCalled();
  });
});

describe("InterviewCard — options arriving after the user has typed", () => {
  /**
   * The host can extend a question with options in a later snapshot. The card
   * flips to buttons and the typed text stops counting; without a word, it
   * simply vanishes from screen with the textarea it was typed into.
   */
  function renderThenAttachOptions(
    onAnswer: (answers: readonly InterviewAnswerDraft[]) => void,
    typed: string,
  ): void {
    const view = render(
      <InterviewCard
        title={null}
        questions={[beforeOptions()]}
        phase={IDLE}
        actionability={ACTIONABLE}
        onAnswer={onAnswer}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: typed } });
    view.rerender(
      <InterviewCard
        title={null}
        questions={[optionQuestion(false)]}
        phase={IDLE}
        actionability={ACTIONABLE}
        onAnswer={onAnswer}
      />,
    );
  }

  it("tells the user their typed answer no longer counts, and does not submit it", () => {
    const onAnswer = vi.fn<(a: readonly InterviewAnswerDraft[]) => void>();
    renderThenAttachOptions(onAnswer, "keep failing please");

    // Told, in words, and quoting what they typed back so it is recognisable.
    const warning = screen.getByRole("alert");
    expect(warning.textContent).toContain("keep failing please");
    expect(warning.textContent).toContain("pick one below");

    // And the stranded text is genuinely unreachable, not merely hidden: the
    // send is gated, and choosing an option submits the LABEL.
    press(/Send answer/);
    expect(onAnswer).not.toHaveBeenCalled();

    press(/Keep it failing/);
    press(/Send answer/);
    expect(onAnswer.mock.calls[0][0][0].values).toEqual(["Keep it failing"]);
  });

  it("drops the warning once an option is chosen", () => {
    renderThenAttachOptions(vi.fn(), "stranded");
    expect(screen.getByRole("alert")).toBeDefined();
    press(/Keep it failing/);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
