/**
 * Moved to `clients/shared/markdown/traycer-next-steps.ts`.
 *
 * WHY: `clients/mobile` needs the identical parse. Two copies of this
 * grammar would drift, and the phone and desktop would then disagree about
 * what counts as a next-step option — same assistant message, different UI.
 * The parser is pure TypeScript with no React and no shell dependency, so it
 * belongs in the shared package.
 *
 * This file stays as a re-export so every existing gui-app import path keeps
 * working unchanged (`chat-find-projection.ts`, `text-segment.tsx`,
 * `next-steps-action-group.tsx`, `chat-tile.tsx`, and the test suite). Prefer
 * importing from `@traycer-clients/shared/markdown/traycer-next-steps`
 * directly in new code.
 */
export type {
  TraycerNextStepOption,
  TraycerNextStepsPart,
} from "@traycer-clients/shared/markdown/traycer-next-steps";
export {
  parseTraycerNextStepsMarkdown,
  repairTraycerNextStepsMarkdown,
} from "@traycer-clients/shared/markdown/traycer-next-steps";
