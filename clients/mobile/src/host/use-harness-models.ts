/**
 * P2 — basic model list for the composer's model picker. Reuses the exact
 * `agent.listHarnessModels` RPC `use-create-chat.ts`'s T7 author flow
 * already proved works, for a fixed default harness ("claude") — NOT the
 * desktop's full multi-provider catalog (`HarnessModelPicker`'s provider
 * rail + reasoning/service-tier footers), which is out of scope for P2
 * (see the P2 contract).
 */
import { useEffect, useState } from "react";
import type { AgentFacingHarnessId, HarnessModelSummary } from "@traycer/protocol/host/agent/shared";
import type { MobileHostClient } from "@/host/host-client-context";

export type HarnessModelsPhase = "loading" | "loaded" | "error";

export interface UseHarnessModelsResult {
  readonly phase: HarnessModelsPhase;
  readonly models: readonly HarnessModelSummary[];
}

export function useHarnessModels(
  client: MobileHostClient | null,
  epicId: string,
  harnessId: AgentFacingHarnessId,
): UseHarnessModelsResult {
  const [phase, setPhase] = useState<HarnessModelsPhase>("loading");
  const [models, setModels] = useState<readonly HarnessModelSummary[]>([]);

  useEffect(() => {
    if (client === null) {
      setPhase("error");
      return;
    }
    let cancelled = false;
    setPhase("loading");
    void (async (): Promise<void> => {
      try {
        const response = await client.request("agent.listHarnessModels", {
          epicId,
          senderAgentId: null,
          harnessId,
        });
        if (cancelled) return;
        setModels(response.models);
        setPhase("loaded");
      } catch {
        if (cancelled) return;
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, epicId, harnessId]);

  return { phase, models };
}
