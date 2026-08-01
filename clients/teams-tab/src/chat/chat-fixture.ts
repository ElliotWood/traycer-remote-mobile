/**
 * A chat with a realistic block mix, for the shoot.
 *
 * SHAPED from what a real turn produces, INVENTED in content. The shape that
 * matters, and why each piece is here:
 *
 *   - `text` and `reasoning` together, so the subordinate styling is visible
 *     against real prose rather than asserted
 *   - SEVERAL chip kinds — a turn that ran tools, changed files and wrote a
 *     to-do list. One chip proves the mechanism; five prove it does not
 *     dominate the row at 320px
 *   - an UNANSWERED interview with two questions, which is the only way to
 *     see the card, the multi-question layout and the all-required send gate
 *   - an ANSWERED interview, so history rendering is proven rather than
 *     assumed — it must NOT re-ask
 *   - code in the prose, because `pre-wrap` exists for it and collapsing
 *     whitespace would be invisible in a fixture of ordinary sentences
 */
import type { TranscriptMessage } from "@traycer-clients/shared/epic/transcript";

export const CHAT_FIXTURE_NOW = 1_800_000_000_000;
const T = CHAT_FIXTURE_NOW;

export const CHAT_FIXTURE_TITLE = "Migrate config loader to zod";

export const CHAT_FIXTURE: readonly TranscriptMessage[] = [
  {
    id: "m1",
    role: "user",
    author: "You",
    timestamp: T - 40 * 60_000,
    blocks: [
      {
        kind: "text",
        text: "Move the config loader onto zod. Keep the error messages we already have — they name the missing variable and that's the useful part.",
      },
    ],
  },
  {
    id: "m2",
    role: "assistant",
    author: "Claude",
    timestamp: T - 36 * 60_000,
    blocks: [
      {
        kind: "reasoning",
        text: "The existing loader throws a bare Error. zod's default message would lose the variable name, so the schema needs an explicit message per field.",
      },
      {
        kind: "text",
        text: "Reading the current loader first.\n\n    const raw = process.env.VITE_HOST_WS_URL;\n    if (!raw) throw new Error(\"VITE_HOST_WS_URL is required\");\n\nThat message is the thing to preserve.",
      },
      /*
       * MARKDOWN-HOSTILE, deliberately. Every text block here was clean prose,
       * so the fixture could not fail on the claim that chat renders markdown
       * — and it did not, for as long as chat printed a plain text node and
       * a user saw literal fences.
       *
       * A fence, a table and a heading: the three things the artifact renderer
       * already handled and chat did not.
       */
      {
        kind: "text",
        text: "## Result\n\n```sh\nhostname\nwhoami\nuname -sr\n```\n\n| check | value |\n| --- | --- |\n| host | reachable |\n| user | traycer |\n",
      },
      /*
       * LABELS AS `toTranscript` PRODUCES THEM, not as they used to read.
       *
       * These said "Tool call" and "File change" flat, which is what the
       * projection emitted before `blockDetail` landed in shared. It now
       * appends the tool's name and the file's path, so the fixture was
       * showing a state the live client can no longer produce — a preview
       * that under-reports the product rather than over-reports it, which is
       * the rarer direction and just as wrong.
       *
       * Found in the gallery only after `fullPage` was fixed: the chips sit
       * at the bottom of a 1533px transcript and every previous shot stopped
       * at 900.
       *
       * The path is deliberately one the shortener acts on — the tenant
       * prefix is gone here because `shortenWorkspacePath` removes it, and a
       * fixture that skipped the prefix would agree with the renderer without
       * testing it.
       */
      {
        kind: "other",
        blockType: "tool_call",
        label: "Tool call: traycer send message",
      },
      {
        kind: "other",
        blockType: "file_change",
        label: "File change: clients/teams-tab/src/config.ts",
      },
      { kind: "other", blockType: "todo", label: "To-do list" },
    ],
  },
  {
    id: "m3",
    role: "assistant",
    author: "Claude",
    timestamp: T - 22 * 60_000,
    blocks: [
      {
        kind: "interview",
        blockId: "iv-answered",
        title: "Which behaviour should a missing variable keep?",
        questions: [
          { questionId: "q1", question: "Throw on load, or degrade?" },
        ],
        // ANSWERED — history. Must render as prose, never as a live prompt.
        answered: true,
      },
      {
        kind: "text",
        text: "Taking the throw-on-load path, matching the current behaviour.",
      },
      { kind: "other", blockType: "plan", label: "Plan" },
    ],
  },
  {
    id: "m4",
    role: "assistant",
    author: "Claude",
    timestamp: T - 4 * 60_000,
    blocks: [
      {
        kind: "interview",
        blockId: "iv-open",
        title: "Two things before I finish",
        questions: [
          {
            questionId: "q2",
            question: "Should the relative-URL check stay a hard failure?",
          },
          {
            questionId: "q3",
            question: "Do you want the schema exported for the tests?",
          },
        ],
        answered: false,
      },
      { kind: "other", blockType: "subagent", label: "Subagent" },
    ],
  },
];
