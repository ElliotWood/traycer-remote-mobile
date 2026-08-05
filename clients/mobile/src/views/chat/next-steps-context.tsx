/**
 * "Put this next-step prompt in the composer" — provided by `ChatView`, used
 * by `NextStepsGroup` buried under BlockList/AssistantTurn/TextBlock.
 *
 * A context rather than props for the same reason as `artifact-nav-context`:
 * the consumer is many layers below the provider and threading a callback
 * through every intermediate block component would re-introduce exactly the
 * prop-churn that perf batch 2 (B2-3) memoized away.
 *
 * Deliberately fills the composer instead of sending immediately. A next step
 * is a *suggestion* — the user usually wants to edit it before sending, and a
 * one-tap irreversible send of text they didn't write is a bad trade for one
 * saved tap. This matches desktop.
 */
import { createContext, useContext, type ReactElement, type ReactNode } from "react";

export interface NextStepsValue {
  /** Replaces the composer draft with `prompt` and focuses it. */
  readonly insertPrompt: (prompt: string) => void;
}

const NextStepsContext = createContext<NextStepsValue | null>(null);

export function NextStepsProvider({
  value,
  children,
}: {
  readonly value: NextStepsValue;
  readonly children: ReactNode;
}): ReactElement {
  return <NextStepsContext.Provider value={value}>{children}</NextStepsContext.Provider>;
}

/**
 * `null` when no provider is mounted — the transcript renders in places
 * without a composer (the artifact route's inline previews, tests). Callers
 * must treat `null` as "not actionable" and render the options as plain
 * text rather than dead buttons.
 */
export function useNextSteps(): NextStepsValue | null {
  return useContext(NextStepsContext);
}
