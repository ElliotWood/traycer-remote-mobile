/**
 * M1 — the GUI model catalogue for the composer's model picker.
 *
 * Replaces the `agent.listHarnessModels` hook this file used to be. That RPC
 * is the AGENT-FACING (A2A) catalogue and its row is
 * `{id, reasoningEfforts, fastModeAvailable}` (`agent/shared.ts:548-552`) —
 * enough to list slugs, which is why the picker showed slugs.
 * `agent.gui.listModels` is in the same released floor and carries `label`,
 * `description`, `contextWindow`, the reasoning-effort and service-tier option
 * rows, and `deprecationNotice`.
 *
 * Note for anyone judging whether the swap was worthwhile: reasoning effort
 * alone is NOT the evidence. The old row already carried `reasoningEfforts`,
 * so an effort selector was buildable without this change. `label` is the
 * field that only exists here.
 *
 * `workingDirectory` is nullable in the request (`unary-schemas.ts:239-242`),
 * so the catalogue needs no chat/worktree context — which is what lets the
 * composer fetch it before any binding is known.
 */
import { useEffect, useState } from "react";
import type { GuiHarnessId } from "@traycer/protocol/host/agent/shared";
import type { GuiAgentModelOption } from "@traycer/protocol/host/agent/gui/unary-schemas";
import type { MobileHostClient } from "@/host/host-client-context";

export type GuiModelsPhase = "loading" | "loaded" | "error";

export interface UseGuiModelsResult {
  readonly phase: GuiModelsPhase;
  readonly models: readonly GuiAgentModelOption[];
}

export function useGuiModels(
  client: MobileHostClient | null,
  harnessId: GuiHarnessId,
): UseGuiModelsResult {
  const [phase, setPhase] = useState<GuiModelsPhase>("loading");
  const [models, setModels] = useState<readonly GuiAgentModelOption[]>([]);

  useEffect(() => {
    if (client === null) {
      setPhase("error");
      return;
    }
    let cancelled = false;
    setPhase("loading");
    // Clear on harness change rather than leaving the previous harness's rows
    // on screen while the next fetch is in flight — otherwise the picker shows
    // Claude's models under a Codex header for as long as the round trip takes,
    // and a tap during that window commits a model the selected harness does
    // not have.
    setModels([]);
    void (async (): Promise<void> => {
      try {
        const response = await client.request("agent.gui.listModels", {
          harnessId,
          workingDirectory: null,
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
  }, [client, harnessId]);

  return { phase, models };
}
