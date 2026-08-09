/**
 * Interview fixtures for the screenshot harness — IN TYPESCRIPT, for exactly
 * the reason `shoot-agents.ts` gives one file over.
 *
 * They were plain literals in `tools/shoot.mjs` reading
 * `{ blockId, requestedAt }`, which is the shape `PendingInterview` had
 * BEFORE it gained `title`, `description` and `questions`. So `15-interview`
 * threw on every run and the harness — which fails the whole shoot rather
 * than skipping a card — rendered nothing at all.
 *
 * The consequence worth recording: the ANSWERABLE interview card, the one
 * with the form in it, had never been screenshotted. Every review of "the
 * interview card" looked at the refusal variant, because that is the only one
 * an untyped fixture could produce.
 *
 * `readonly PendingInterview[]` makes the next such drift a compile error.
 *
 * Content invented, shape realistic: one multi-select, one single-select with
 * option descriptions long enough to wrap at 320px, one free-text.
 */
import type { PendingInterview } from "../bridge-types";

/** Fixed offsets from `now`, applied by the harness — see `shoot.mjs`. */
export const INTERVIEW_AGE_MS = 30_000;

export function shootInterviews(now: number): {
  readonly answerable: PendingInterview;
  readonly unreadable: PendingInterview;
  readonly empty: PendingInterview;
} {
  const requestedAt = now - INTERVIEW_AGE_MS;
  return {
    answerable: {
      blockId: "iv-22",
      requestedAt,
      title: "Before I start the gap audit",
      description:
        "Two things I can't infer from the RFI, and one I'd rather you decided.",
      questions: [
        {
          questionId: "q-scope",
          question: "Which modules should the gap audit cover?",
          header: "Scope",
          multiSelect: true,
          options: [
            {
              label: "Telemetry ingest",
              description: "MQTT and the LoRaWAN bridge",
              preview: null,
            },
            {
              label: "Alarm routing",
              description: "Including the escalation matrix",
              preview: null,
            },
            { label: "Reporting", description: null, preview: null },
            {
              label: "Asset register",
              description: "Only the parts the RFI names explicitly",
              preview: null,
            },
          ],
        },
        {
          questionId: "q-branch",
          question: "Audit against which build branch?",
          header: "Baseline",
          multiSelect: false,
          options: [
            {
              label: "main",
              description: "Shipped, but three sprints behind the demo",
              preview: null,
            },
            {
              label: "release/4.2",
              description: "What the customer would actually receive",
              preview: null,
            },
          ],
        },
        {
          questionId: null,
          question: "Anything the RFI leaves out that I should assume?",
          header: null,
          multiSelect: false,
          options: [],
        },
      ],
    },
    /** Bridge could not resolve the block, or predates the passthrough. */
    unreadable: {
      blockId: "iv-23",
      requestedAt,
      title: "Waiting on an answer",
      description: null,
      questions: null,
    },
    /** Arrived with a question list that is empty — a different refusal. */
    empty: {
      blockId: "iv-24",
      requestedAt,
      title: null,
      description: null,
      questions: [],
    },
  };
}
