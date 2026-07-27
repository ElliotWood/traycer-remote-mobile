/**
 * Lazy full-plan fetch for `plan` blocks (Sprint 2) — the card shows
 * `markdownPreview` always; this fires only when "View full plan" expands.
 */
import { useQuery } from "@tanstack/react-query";
import type {
  GetGuiAgentPlanRequest,
  GetGuiAgentPlanResponse,
} from "@traycer/protocol/host/agent/gui/unary-schemas";
import { useHostClientOrNull } from "./host-client-context";

export interface UseAgentPlanArgs {
  readonly epicId: string;
  readonly chatId: string;
  readonly planId: string;
  readonly enabled: boolean;
}

export function useAgentPlan({ epicId, chatId, planId, enabled }: UseAgentPlanArgs) {
  const client = useHostClientOrNull();
  const request: GetGuiAgentPlanRequest = { epicId, chatId, planId };

  return useQuery<GetGuiAgentPlanResponse>({
    queryKey: ["mobile", "agent.gui.getPlan", epicId, chatId, planId],
    queryFn: () => {
      if (client === null) throw new Error("no host client");
      return client.request("agent.gui.getPlan", request);
    },
    enabled: enabled && client !== null,
    staleTime: Infinity,
    retry: false,
  });
}
